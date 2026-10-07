import React, { useMemo } from 'react';
import UrlPreviewCard from './UrlPreviewCard';
import YouTubePreviewCard, { extractYouTubeId } from './YouTubePreviewCard';

const URL_RE = /\bhttps?:\/\/[^\s<>"'`)]+/gi;
const TRAILING_PUNCT = /[.,;:!?)\]}>'"`]+$/;

export function extractUrls(text: string, max = 3): string[] {
  if (!text) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  const matches = text.match(URL_RE);
  if (!matches) return [];
  for (const raw of matches) {
    let url = raw.replace(TRAILING_PUNCT, '');
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      const normalized = u.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      found.push(normalized);
      if (found.length >= max) break;
    } catch { /* skip */ }
  }
  return found;
}

interface Props {
  text: string;
  max?: number;
}

export default function UrlPreviewList({ text, max = 3 }: Props) {
  const urls = useMemo(() => extractUrls(text, max), [text, max]);
  if (urls.length === 0) return null;
  return (
    <div className="url-preview-list">
      {urls.map((u) => {
        const ytId = extractYouTubeId(u);
        if (ytId) return <YouTubePreviewCard key={u} videoId={ytId} url={u} />;
        return <UrlPreviewCard key={u} url={u} />;
      })}
    </div>
  );
}
