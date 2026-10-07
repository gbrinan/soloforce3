import { z } from "zod";
import {
  ConnectionIdSchema,
  OperationIdSchema,
  ProjectIdSchema,
  TargetPathSchema,
} from "./reversible-ingest-schema.js";

export const OwnerPrincipalIdSchema = z.string().min(1).max(200).brand<"OwnerPrincipalId">();
export const ProviderSubjectSchema = z.string().min(1).max(255).brand<"ProviderSubject">();
export const CredentialHandleSchema = z.string().uuid().brand<"CredentialHandle">();
export const OAuthStateSchema = z.string().regex(/^[a-f0-9]{64}$/).brand<"OAuthState">();
export const CodeVerifierSchema = z.string().min(43).max(128).brand<"CodeVerifier">();

export const GoogleConnectionStateSchema = z.enum(["active", "revoked"]);

export const GoogleConnectionSchema = z.object({
  version: z.literal(1),
  connectionId: ConnectionIdSchema,
  projectId: ProjectIdSchema,
  ownerPrincipalId: OwnerPrincipalIdSchema,
  provider: z.literal("google-drive"),
  providerSubject: ProviderSubjectSchema,
  displayEmail: z.string().email(),
  credentialHandle: CredentialHandleSchema,
  state: GoogleConnectionStateSchema,
  connectedAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
}).strict();

const OAuthTransactionBaseSchema = z.object({
  version: z.literal(1),
  state: OAuthStateSchema,
  projectId: ProjectIdSchema,
  ownerPrincipalId: OwnerPrincipalIdSchema,
  expiresAt: z.string().datetime(),
});

export const ActiveOAuthTransactionSchema = OAuthTransactionBaseSchema.extend({
  codeVerifier: CodeVerifierSchema,
  status: z.literal("active"),
  usedAt: z.null(),
}).strict();

export const OAuthTransactionSchema = z.discriminatedUnion("status", [
  ActiveOAuthTransactionSchema,
  OAuthTransactionBaseSchema.extend({
    codeVerifier: z.null(),
    status: z.literal("used"),
    usedAt: z.string().datetime(),
  }).strict(),
]);

export const GoogleTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  token_type: z.string().min(1),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
}).passthrough();

export const GoogleUserinfoSchema = z.object({
  sub: ProviderSubjectSchema,
  email: z.string().email(),
  email_verified: z.boolean(),
}).passthrough();

export const GoogleDriveFileSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  mimeType: z.string().min(1),
  modifiedTime: z.string().datetime().optional(),
  parents: z.array(z.string().min(1)).default([]),
}).strict();

export const GoogleDriveFileListSchema = z.object({
  files: z.array(GoogleDriveFileSchema).default([]),
  nextPageToken: z.string().min(1).optional(),
}).passthrough();

export const EncryptedSecretRecordSchema = z.object({
  version: z.literal(1),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  ciphertext: z.string().min(1),
}).strict();

export const ConnectionSecretSchema = z.object({
  refreshToken: z.string().min(1),
}).strict();

export const StartGoogleConnectionInputSchema = z.object({
  ownerPrincipalId: OwnerPrincipalIdSchema,
}).strict();

export const CompleteGoogleConnectionInputSchema = z.object({
  state: OAuthStateSchema,
  code: z.string().min(1).max(2048),
}).strict();

export const GoogleMetadataIngestInputSchema = z.object({
  connectionId: ConnectionIdSchema,
  operationId: OperationIdSchema,
  targetPath: TargetPathSchema,
}).strict();

export type OwnerPrincipalId = z.infer<typeof OwnerPrincipalIdSchema>;
export type OAuthState = z.infer<typeof OAuthStateSchema>;
export type OAuthTransaction = z.infer<typeof OAuthTransactionSchema>;
export type ActiveOAuthTransaction = z.infer<typeof ActiveOAuthTransactionSchema>;
export type GoogleConnection = z.infer<typeof GoogleConnectionSchema>;
export type CredentialHandle = z.infer<typeof CredentialHandleSchema>;
export type ConnectionSecret = z.infer<typeof ConnectionSecretSchema>;
export type GoogleDriveFile = z.infer<typeof GoogleDriveFileSchema>;
export type StartGoogleConnectionInput = z.input<typeof StartGoogleConnectionInputSchema>;
export type CompleteGoogleConnectionInput = z.input<typeof CompleteGoogleConnectionInputSchema>;
export type GoogleMetadataIngestInput = z.input<typeof GoogleMetadataIngestInputSchema>;
