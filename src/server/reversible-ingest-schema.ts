import { z } from "zod";

export const ProjectIdSchema = z.string().min(1).max(200).brand<"ProjectId">();
export const ConnectionIdSchema = z.string().min(1).max(200).brand<"ConnectionId">();
export const OperationIdSchema = z.string().min(1).max(200).brand<"OperationId">();
export const ManifestIdSchema = z.string().regex(/^[a-f0-9]{64}$/).brand<"ManifestId">();
export const RevisionIdSchema = z.string().regex(/^[a-f0-9]{64}$/).brand<"RevisionId">();

export const TargetPathSchema = z.string().min(1).max(500).refine((value) => {
  if (value.startsWith("/") || value.includes("\\")) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}, "targetPath must be a normalized relative POSIX path");

export const PrepareIngestInputSchema = z.object({
  operationId: OperationIdSchema,
  connectionId: ConnectionIdSchema,
  targetPath: TargetPathSchema,
  content: z.string(),
}).strict();

export const ManifestSchema = z.object({
  version: z.literal(1),
  manifestId: ManifestIdSchema,
  previousManifestId: ManifestIdSchema.nullable(),
  operationId: OperationIdSchema.nullable(),
  projectId: ProjectIdSchema,
  connectionId: ConnectionIdSchema.nullable(),
  revisionId: RevisionIdSchema.nullable(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  targetPath: TargetPathSchema.nullable(),
}).strict();

export const PointerSchema = z.object({
  version: z.literal(1),
  manifestId: ManifestIdSchema,
}).strict();

const JournalBaseSchema = z.object({
  operationId: OperationIdSchema,
  manifestId: ManifestIdSchema,
  recordedAt: z.string().datetime(),
});

export const PreparedJournalEventSchema = JournalBaseSchema.extend({
  kind: z.literal("prepared"),
}).strict();

export const JournalEventSchema = z.discriminatedUnion("kind", [
  PreparedJournalEventSchema,
  JournalBaseSchema.extend({ kind: z.literal("committed") }).strict(),
  JournalBaseSchema.extend({ kind: z.literal("rolled_back") }).strict(),
]);

export type PrepareIngestInput = z.input<typeof PrepareIngestInputSchema>;
export type IngestManifest = z.infer<typeof ManifestSchema>;
export type JournalEvent = z.infer<typeof JournalEventSchema>;
export type PreparedJournalEvent = z.infer<typeof PreparedJournalEventSchema>;
export type OperationId = z.infer<typeof OperationIdSchema>;
export type ManifestId = z.infer<typeof ManifestIdSchema>;

export type OperationResult =
  | { readonly kind: "prepared" | "committed" | "rolled_back"; readonly operationId: string; readonly manifestId: string }
  | {
      readonly kind: "conflict";
      readonly reason: "operation_input_mismatch" | "base_changed" | "not_found";
      readonly operationId: string;
    };
