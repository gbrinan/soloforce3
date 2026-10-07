import { existsSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { Hono, type Context } from "hono";
import { getConnInfo } from '@hono/node-server/conninfo';
import { z } from "zod";
import { HISTORY_DIR, PROJECTS_DIR } from "../config.js";
import { getCurrentSession, isSsoEnabled } from "./auth-google.js";
import { EncryptedConnectionSecretBroker } from "./connection-secret-broker.js";
import type { ConnectedIngestCredential } from "./connected-ingest-auth.js";
import { GoogleConnectionRegistry } from "./google-connection-registry.js";
import {
  GoogleReadonlyHttpProvider,
  type GoogleReadonlyProvider,
} from "./google-readonly-provider.js";
import { createGoogleReadonlyRoutes } from "./google-readonly-routes.js";
import { GoogleReadonlyConnectionService } from "./google-readonly-service.js";
import { OwnerPrincipalStore } from "./owner-principal-store.js";
import { getCorpusService, registerCorpusDriveAccess } from './corpus/runtime.js';
import type { CorpusService } from './corpus/service.js';

const CALLBACK_PATH = "/api/connections/google-drive/oauth/callback";
const RECENT_AUTH_MS = 15 * 60 * 1000;

const ProjectPathSchema = z.string().min(1).max(200).refine((value) => {
  const segments = value.split("/");
  return segments.length <= 2
    && segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes(":"))
    && !value.includes("\\");
});

const EncryptionKeySchema = z.string()
  .regex(/^[A-Za-z0-9+/]{43}=$/)
  .transform((value) => Buffer.from(value, "base64"))
  .refine((value) => value.byteLength === 32);

const ConnectorConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  callbackUrl: z.string().url().refine((value) => {
    const url = new URL(value);
    const localHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    return (url.protocol === "https:" || localHttp)
      && url.pathname === CALLBACK_PATH
      && url.search === ""
      && url.hash === "";
  }),
  projectId: ProjectPathSchema,
  encryptionKey: EncryptionKeySchema,
}).strict();

type ServerRouteOptions = {
  readonly corpus?: CorpusService;
  readonly resolveRemoteAddress?: (context: Context) => string | undefined;
  readonly env: NodeJS.ProcessEnv;
  readonly storage: {
    readonly historyDirectory: string;
    readonly projectsDirectory: string;
  };
  readonly provider?: GoogleReadonlyProvider;
  readonly now?: () => string;
};

type CredentialResolverOptions = {
  readonly resolveRemoteAddress: (context: Context) => string | undefined;
  readonly registry: GoogleConnectionRegistry;
  readonly trustedOrigins: readonly string[];
  readonly allowedTailscaleLogins: readonly string[];
  readonly localOwnerAllowed: boolean;
  readonly now: () => string;
};

export function createGoogleReadonlyServerRoutes(options: ServerRouteOptions = productionOptions()): Hono {
  const app = new Hono();
  const config = ConnectorConfigSchema.safeParse({
    clientId: options.env.GOOGLE_DRIVE_CONNECTOR_CLIENT_ID,
    clientSecret: options.env.GOOGLE_DRIVE_CONNECTOR_CLIENT_SECRET,
    callbackUrl: options.env.GOOGLE_DRIVE_CONNECTOR_CALLBACK_URL,
    projectId: options.env.GOOGLE_DRIVE_CONNECTOR_PROJECT_ID,
    encryptionKey: options.env.SOLOFORCE_CONNECTION_ENCRYPTION_KEY,
  });
  if (!config.success) return disabledRoutes(app);
  const projectRoot = resolveProjectRoot(options.storage.projectsDirectory, config.data.projectId);
  if (projectRoot === null) return disabledRoutes(app);

  const now = options.now ?? (() => new Date().toISOString());
  const registry = new GoogleConnectionRegistry({ projectRoot, now });
  const broker = new EncryptedConnectionSecretBroker({
    rootDirectory: resolve(projectRoot, ".connections", "secrets"),
    encryptionKey: config.data.encryptionKey,
  });
  const provider = options.provider ?? new GoogleReadonlyHttpProvider({
    clientId: config.data.clientId,
    clientSecret: config.data.clientSecret,
    redirectUri: config.data.callbackUrl,
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    userinfoEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
    driveFilesEndpoint: "https://www.googleapis.com/drive/v3/files",
  });
  const service = new GoogleReadonlyConnectionService({
    projectRoot,
    projectId: config.data.projectId,
    registry,
    broker,
    provider,
    now,
  });
  if (options.corpus) registerCorpusDriveAccess(id => service.isConnectionActive(id));
  const ownerPrincipals = new OwnerPrincipalStore({
    historyDirectory: options.storage.historyDirectory,
    now,
  });
  const callback = new URL(config.data.callbackUrl);
  const credentialResolverOptions: CredentialResolverOptions = {
    resolveRemoteAddress: options.resolveRemoteAddress ?? ((context) => { try { return getConnInfo(context).remote.address; } catch { return undefined; } }),
    registry,
    trustedOrigins: buildTrustedOrigins(callback.origin, options.env.SOLOFORCE_TAILSCALE_ORIGIN),
    allowedTailscaleLogins: (options.env.SOLOFORCE_TAILSCALE_ALLOWED_LOGINS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
    localOwnerAllowed: callback.hostname === "localhost" || callback.hostname === "127.0.0.1",
    now,
  };

  app.get("/status", (context) => context.json({ configured: true, projectId: config.data.projectId }));
  app.route("/", createGoogleReadonlyRoutes({
    corpus: options.corpus,
    projectId: config.data.projectId,
    service,
    resolveCredential: (context) => resolveCredential(context, credentialResolverOptions),
    resolveOwnerPrincipalId: () => ownerPrincipals.getOrCreate(),
  }));
  return app;
}

function productionOptions(): ServerRouteOptions {
  return {
    corpus: getCorpusService(),
    env: process.env,
    storage: { historyDirectory: HISTORY_DIR, projectsDirectory: PROJECTS_DIR },
  };
}

function disabledRoutes(app: Hono): Hono {
  app.get("/status", (context) => context.json({ configured: false }));
  app.all("*", (context) => context.json({ error: "google_connector_not_configured" }, 503));
  return app;
}

function resolveProjectRoot(projectsDirectory: string, projectId: string): string | null {
  if (!existsSync(projectsDirectory)) return null;
  const root = realpathSync(projectsDirectory);
  const candidate = resolve(root, ...projectId.split("/"));
  if (!existsSync(candidate) || !statSync(candidate).isDirectory()) return null;
  const projectRoot = realpathSync(candidate);
  return projectRoot.startsWith(`${root}/`) || projectRoot.startsWith(`${root}\\`)
    ? projectRoot
    : null;
}

// tailnet 경유 접속 허용 — 소유자 인증이 콜백 URL(localhost)의 origin 하나로만 판정돼
// Tailscale 호스트명으로 들어온 요청이 전부 거부되던 문제(맥북·폰에서 구글 연동 불가)를 푼다.
// SOLOFORCE_TAILSCALE_ORIGIN에 적힌 주소를 신뢰 목록에 추가하며, 프록시가 http로 전달하는
// 경우까지 커버하려고 http/https 양쪽 형태를 모두 등록한다.
function buildTrustedOrigins(callbackOrigin: string, tailscaleOrigin: string | undefined): string[] {
  const origins = new Set<string>([callbackOrigin]);
  if (tailscaleOrigin) {
    try {
      const url = new URL(tailscaleOrigin);
      origins.add(url.origin);
      origins.add(`http://${url.host}`);
      origins.add(`https://${url.host}`);
    } catch {
      // 형식이 잘못된 값은 무시 — 기존 localhost 경로는 그대로 동작한다.
    }
  }
  return [...origins];
}

// Tailscale serve가 신원 헤더를 붙여 보내면 허용 로그인 목록과 대조한다.
// 헤더가 없으면(구버전 serve 등) tailnet 도달 자체를 신뢰한다 — tailnet은 본인 기기만 들어온다는 전제.
function tailscaleIdentityAllowed(context: Context, allowedLogins: readonly string[]): boolean {
  const login = context.req.header("Tailscale-User-Login");
  if (!login) return true;
  return allowedLogins.length === 0 || allowedLogins.includes(login);
}

function resolveCredential(
  context: Context,
  options: CredentialResolverOptions,
): ConnectedIngestCredential {
  if (context.req.path.endsWith("/oauth/callback")) {
    return options.registry.hasActiveTransaction(context.req.query("state") ?? "")
      ? { kind: "oauth_transaction", state: "active", provider: "google-drive" }
      : { kind: "invalid" };
  }
  const origin = context.req.header("Origin");
  const csrfValid = origin !== undefined && options.trustedOrigins.includes(origin);
  if (context.req.header('Sec-Fetch-Site') === 'cross-site') return { kind: 'none' };
  if (!isSsoEnabled()) {
    return options.localOwnerAllowed
      && options.trustedOrigins.includes(new URL(context.req.url).origin)
      && tailscaleIdentityAllowed(context, options.allowedTailscaleLogins)
      && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(options.resolveRemoteAddress(context) ?? '')
      ? { kind: "owner", csrfValid, recentAuth: true }
      : { kind: "none" };
  }
  const session = getCurrentSession(context);
  if (session === null) return { kind: "none" };
  return {
    kind: "owner",
    csrfValid,
    recentAuth: Date.parse(options.now()) - session.createdAt <= RECENT_AUTH_MS,
  };
}
