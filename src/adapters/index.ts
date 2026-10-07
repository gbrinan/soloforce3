import type { AdapterModelCatalog, AgentAdapter } from "./types.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { codexCliAdapter } from "./codex-cli.js";
import { antigravityCliAdapter } from "./antigravity-cli.js";

const registry = new Map<string, AgentAdapter>([
  [claudeCodeAdapter.id, claudeCodeAdapter],
  [codexCliAdapter.id, codexCliAdapter],
  [antigravityCliAdapter.id, antigravityCliAdapter],
]);

const MODEL_CATALOG_TTL_MS = 5 * 60 * 1000;
const modelCatalogCache = new Map<string, { expiresAt: number; catalog: AdapterModelCatalog }>();

export function registerAdapter(adapter: AgentAdapter): void {
  registry.set(adapter.id, adapter);
}

export function getAdapter(id?: string): AgentAdapter {
  const key = id ?? "claude-code";
  const adapter = registry.get(key);
  if (!adapter) {
    console.warn(`[Adapter] "${key}" 없음 — claude-code로 폴백`);
    return claudeCodeAdapter;
  }
  return adapter;
}

export async function resolveAdapterModelCatalog(
  adapter: AgentAdapter,
  force = false,
): Promise<AdapterModelCatalog> {
  const now = Date.now();
  const cached = modelCatalogCache.get(adapter.id);
  if (!force && cached && cached.expiresAt > now) return cached.catalog;

  let catalog: AdapterModelCatalog;
  if (!adapter.listModels) {
    catalog = { models: adapter.supportedModels, source: "static" };
  } else {
    try {
      const models = await adapter.listModels();
      catalog = models.length > 0
        ? { models, source: "live" }
        : { models: adapter.supportedModels, source: "fallback" };
    } catch {
      catalog = { models: adapter.supportedModels, source: "fallback" };
    }
  }

  modelCatalogCache.set(adapter.id, { expiresAt: now + MODEL_CATALOG_TTL_MS, catalog });
  return catalog;
}

export async function getAdapterModelCatalog(id?: string, force = false): Promise<AdapterModelCatalog> {
  return resolveAdapterModelCatalog(getAdapter(id), force);
}

export function clearAdapterModelCatalogCache(): void {
  modelCatalogCache.clear();
}

export type { AdapterModelCatalog, AdapterModelOption, AgentAdapter, AdapterOptions, AdapterResult } from "./types.js";
