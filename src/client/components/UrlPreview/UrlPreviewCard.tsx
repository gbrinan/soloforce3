import React, { useEffect, useState } from 'react';
import { fetchUrlPreview, type UrlPreviewData } from '../../utils/api';

const CACHE = new Map<string, UrlPreviewData>();
const INFLIGHT = new Map<string, Promise<UrlPreviewData>>();

function getPreview(url: string): Promise<UrlPreviewData> {
  const cached = CACHE.get(url);
  if (cached) return Promise.resolve(cached);
  const inflight = INFLIGHT.get(url);
  if (inflight) return inflight;
  const p = fetchUrlPreview(url)
    .then((data) => {
      CACHE.set(url, data);
      INFLIGHT.delete(url);
      return data;
    })
    .catch((e) => {
      INFLIGHT.delete(url);
      const data: UrlPreviewData = { url, ok: false, error: e instanceof Error ? e.message : 'unknown' };
      CACHE.set(url, data);
      return data;
    });
  INFLIGHT.set(url, p);
  return p;
}

interface Props {
  url: string;
}

export default function UrlPreviewCard({ url }: Props) {
  const [data, setData] = useState<UrlPreviewData | null>(CACHE.get(url) ?? null);
  const [loading, setLoading] = useState(!CACHE.has(url));

  useEffect(() => {
    let canceled = false;
    if (CACHE.has(url)) {
      setData(CACHE.get(url)!);
      setLoading(false);
      return;
    }
    setLoading(true);
    getPreview(url).then((d) => {
      if (canceled) return;
      setData(d);
      setLoading(false);
    });
    return () => {
      canceled = true;
    };
  }, [url]);

  if (loading) {
    return (
      <div className="url-preview-card url-preview-loading">
        <div className="url-preview-skeleton-line" style={{ width: '60%' }} />
        <div className="url-preview-skeleton-line" style={{ width: '90%' }} />
      </div>
    );
  }

  const host = (() => {
    try { return new URL((data && (data.finalUrl || data.url)) || url).hostname; } catch { return ''; }
  })();

  // OG 메타가 비거나 fetch 실패면 fallback 카드(호스트 + URL)로 렌더.
  // 다중 링크 메시지에서 한 쪽 카드만 사라지는 회귀 차단(가이드 명시).
  const hasMeta = !!(data && data.ok && (data.title || data.description || data.image));
  if (!hasMeta) {
    return (
      <a
        className="url-preview-card url-preview-fallback"
        href={data?.url || url}
        target="_blank"
        rel="noopener noreferrer"
        title={data?.url || url}
      >
        <div className="url-preview-body">
          {host && <div className="url-preview-site">{host}</div>}
          <div className="url-preview-title">{data?.url || url}</div>
        </div>
      </a>
    );
  }

  return (
    <a
      className="url-preview-card"
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      title={data.url}
    >
      {data.image && (
        <div className="url-preview-thumb">
          <img
            src={data.image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}
      <div className="url-preview-body">
        {data.siteName && <div className="url-preview-site">{data.siteName}</div>}
        {!data.siteName && host && <div className="url-preview-site">{host}</div>}
        {data.title && <div className="url-preview-title">{data.title}</div>}
        {data.description && <div className="url-preview-desc">{data.description}</div>}
      </div>
    </a>
  );
}
