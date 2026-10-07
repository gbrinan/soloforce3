// 로케일 읽기 — I18nProvider와 동일한 키('jarvis-lang')를 직접 읽어 호출부 시그니처 유지.
// SSR/localStorage 미가용 환경에서는 'ko' fallback.
type FmtLocale = 'ko' | 'en' | 'ja';

function readLocale(): FmtLocale {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem('jarvis-lang');
      if (v === 'ko' || v === 'en' || v === 'ja') return v;
    }
  } catch { /* localStorage 접근 불가 시 ko fallback */ }
  return 'ko';
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.floor(diff / 1000));
  const rtf = new Intl.RelativeTimeFormat(readLocale(), { numeric: 'auto' });
  if (sec < 60) return rtf.format(-sec, 'second');
  const min = Math.floor(sec / 60);
  if (min < 60) return rtf.format(-min, 'minute');
  const hr = Math.floor(min / 60);
  if (hr < 24) return rtf.format(-hr, 'hour');
  const day = Math.floor(hr / 24);
  return rtf.format(-day, 'day');
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

export function formatTime(d: Date): string {
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

export function formatDate(d: Date): string {
  return new Intl.DateTimeFormat(readLocale(), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(d);
}

const FILE_ICONS: Record<string, string> = {
  xlsx: '📊', xls: '📊', pptx: '📑', ppt: '📑',
  pdf: '📄', md: '📝', txt: '📝', json: '📋', csv: '📋',
  png: '🖼️', jpg: '🖼️', jpeg: '🖼️',
};

export function fileIcon(ext: string): string {
  return FILE_ICONS[ext] || '📎';
}
