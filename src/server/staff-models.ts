import type { AdapterModelCatalog } from "../adapters/types.js";

export function validateWorkerModel(
  adapterId: string,
  model: string,
  catalog: AdapterModelCatalog,
): boolean {
  if (!adapterId.trim() || !model.trim()) return false;
  return catalog.models.some((option) => option.id === model);
}
