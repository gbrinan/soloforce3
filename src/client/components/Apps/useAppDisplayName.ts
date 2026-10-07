import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages";
import type { AppManifestClient } from "../../utils/appRegistry";

// 앱 표시명을 로케일별로 결정. manifest.name(앱 내부 식별자 MySign/MyMovie/MyPhoto)은
// 절대 변경하지 않고, UI 표시 레이어에서만 'appLauncher.label.<id>' 키로 오버라이드.
// 키가 등록되지 않은 앱은 manifest.name 그대로 fallback.
const LAUNCHER_DISPLAY_IDS = new Set(["sign", "movie", "photo", "design", "pdf", "notes", "hd-cleaner"]);

export function useAppDisplayName(): (m: AppManifestClient) => string {
  const { t } = useI18n();
  return (manifest: AppManifestClient) => {
    if (!LAUNCHER_DISPLAY_IDS.has(manifest.id)) return manifest.name;
    const key = `appLauncher.label.${manifest.id}` as MessageKey;
    const v = t(key);
    return v === key ? manifest.name : v;
  };
}
