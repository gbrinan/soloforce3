import type { Context, MiddlewareHandler } from "hono";

export type ProjectId = { readonly value: string };
export type ConnectionId = { readonly value: string };

export type ConnectionResource = {
  readonly projectId: ProjectId;
  readonly connectionId: ConnectionId;
};

export type ConnectionCapability = "ingest.run" | "ingest.read_status" | "connection.revoke";

export type ConnectedIngestCredential =
  | { readonly kind: "none" }
  | { readonly kind: "invalid" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "owner"; readonly csrfValid: boolean; readonly recentAuth: boolean }
  | {
      readonly kind: "agent_grant";
      readonly state: "active" | "expired" | "revoked";
      readonly capability: ConnectionCapability;
      readonly resource: ConnectionResource;
    }
  | {
      readonly kind: "oauth_transaction";
      readonly state: "active" | "expired" | "used";
      readonly provider: string;
    };

export type ConnectedIngestPolicy =
  | { readonly kind: "owner_read" }
  | { readonly kind: "owner_mutation" }
  | { readonly kind: "oauth_callback"; readonly provider: string }
  | {
      readonly kind: "agent_or_owner";
      readonly capability: "ingest.run" | "ingest.read_status";
      readonly resource: ConnectionResource;
    };

export type AuthorizationDecision =
  | { readonly kind: "allow" }
  | {
      readonly kind: "deny";
      readonly status: 400 | 401 | 403;
      readonly error:
        | "ambiguous_credentials"
        | "missing_credentials"
        | "invalid_credentials"
        | "owner_required"
        | "csrf_required"
        | "recent_auth_required"
        | "invalid_oauth_transaction"
        | "resource_forbidden"
        | "capability_forbidden";
    };

type ConnectedIngestAuthOptions = {
  readonly resolvePolicy: (context: Context) => ConnectedIngestPolicy | Promise<ConnectedIngestPolicy>;
  readonly resolveCredential: (context: Context) => ConnectedIngestCredential | Promise<ConnectedIngestCredential>;
  readonly onDecision?: (decision: AuthorizationDecision) => void;
};

function assertNever(value: never): never {
  throw new TypeError(`Unhandled connected-ingest authorization variant: ${JSON.stringify(value)}`);
}

function unauthenticated(credential: ConnectedIngestCredential): AuthorizationDecision | null {
  switch (credential.kind) {
    case "none":
      return { kind: "deny", status: 401, error: "missing_credentials" };
    case "invalid":
      return { kind: "deny", status: 401, error: "invalid_credentials" };
    case "agent_grant":
      return credential.state === "active"
        ? null
        : { kind: "deny", status: 401, error: "invalid_credentials" };
    case "ambiguous":
    case "owner":
    case "oauth_transaction":
      return null;
    default:
      return assertNever(credential);
  }
}

function authorizeOwner(
  credential: ConnectedIngestCredential,
  mutation: boolean,
): AuthorizationDecision {
  const unauthenticatedDecision = unauthenticated(credential);
  if (unauthenticatedDecision !== null) return unauthenticatedDecision;
  if (credential.kind !== "owner") {
    return { kind: "deny", status: 403, error: "owner_required" };
  }
  if (mutation && !credential.csrfValid) {
    return { kind: "deny", status: 403, error: "csrf_required" };
  }
  if (mutation && !credential.recentAuth) {
    return { kind: "deny", status: 403, error: "recent_auth_required" };
  }
  return { kind: "allow" };
}

function sameResource(left: ConnectionResource, right: ConnectionResource): boolean {
  return left.projectId.value === right.projectId.value
    && left.connectionId.value === right.connectionId.value;
}

function authorizeAgentOrOwner(
  credential: ConnectedIngestCredential,
  policy: Extract<ConnectedIngestPolicy, { readonly kind: "agent_or_owner" }>,
): AuthorizationDecision {
  const unauthenticatedDecision = unauthenticated(credential);
  if (unauthenticatedDecision !== null) return unauthenticatedDecision;
  if (credential.kind === "owner") return { kind: "allow" };
  if (credential.kind !== "agent_grant") {
    return { kind: "deny", status: 403, error: "capability_forbidden" };
  }
  if (!sameResource(credential.resource, policy.resource)) {
    return { kind: "deny", status: 403, error: "resource_forbidden" };
  }
  if (credential.capability !== policy.capability) {
    return { kind: "deny", status: 403, error: "capability_forbidden" };
  }
  return { kind: "allow" };
}

function authorizeCallback(
  credential: ConnectedIngestCredential,
  provider: string,
): AuthorizationDecision {
  if (
    credential.kind === "oauth_transaction"
    && credential.state === "active"
    && credential.provider === provider
  ) {
    return { kind: "allow" };
  }
  return { kind: "deny", status: 400, error: "invalid_oauth_transaction" };
}

export function authorizeConnectedIngest(
  policy: ConnectedIngestPolicy,
  credential: ConnectedIngestCredential,
): AuthorizationDecision {
  if (credential.kind === "ambiguous") {
    return { kind: "deny", status: 400, error: "ambiguous_credentials" };
  }

  switch (policy.kind) {
    case "owner_read":
      return authorizeOwner(credential, false);
    case "owner_mutation":
      return authorizeOwner(credential, true);
    case "oauth_callback":
      return authorizeCallback(credential, policy.provider);
    case "agent_or_owner":
      return authorizeAgentOrOwner(credential, policy);
    default:
      return assertNever(policy);
  }
}

export function connectedIngestAuth(options: ConnectedIngestAuthOptions): MiddlewareHandler {
  return async (context, next) => {
    const [policy, credential] = await Promise.all([
      options.resolvePolicy(context),
      options.resolveCredential(context),
    ]);
    const decision = authorizeConnectedIngest(policy, credential);
    options.onDecision?.(decision);
    if (decision.kind === "deny") {
      return context.json({ error: decision.error }, decision.status);
    }
    await next();
  };
}
