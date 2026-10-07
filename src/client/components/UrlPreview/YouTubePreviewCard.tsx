import React, { useState } from 'react';
import MediaActions from '../Chat/MediaActions';
import { useT } from '../../i18n/I18nProvider';

/**
 * YouTube URL에서 VIDEO_ID를 추출한다.
 * 지원 형식:
 *   https://youtu.be/VIDEO_ID
 *   https://www.youtube.com/watch?v=VIDEO_ID
 *   https://youtube.com/watch?v=VIDEO_ID
 */
export function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    // youtu.be 단축 URL
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      return id || null;
    }
    // youtube.com/watch?v=
    if (
      (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') &&
      u.pathname === '/watch'
    ) {
      const v = u.searchParams.get('v');
      return v || null;
    }
    return null;
  } catch {
    return null;
  }
}

interface Props {
  videoId: string;
  url: string;
}

export default function YouTubePreviewCard({ videoId, url }: Props) {
  const t = useT();
  const [playing, setPlaying] = useState(false);

  const thumbUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1`;

  if (playing) {
    return (
      <div className="yt-preview-card yt-preview-player">
        <iframe
          src={embedUrl}
          title="YouTube video player"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
        <a href={url} target="_blank" rel="noopener noreferrer" className="yt-preview-link">
          <span className="url-preview-site">YouTube</span>
          <span style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {url}
          </span>
        </a>
        <MediaActions kind="video" url={url} variant="bar" mode="url" />
      </div>
    );
  }

  return (
    <div className="yt-preview-card">
      <button
        className="yt-preview-thumb-btn"
        onClick={() => setPlaying(true)}
        aria-label={t('urlpreview.playYoutubeVideo')}
        title={url}
      >
        <img
          src={thumbUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(e) => {
            const img = e.target as HTMLImageElement;
            if (!img.dataset.fallback) {
              img.dataset.fallback = '1';
              img.src = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
            }
          }}
        />
        <span className="yt-preview-play-btn" aria-hidden="true">
          <svg viewBox="0 0 68 48" width="68" height="48">
            <path
              className="yt-play-bg"
              d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55c-2.93.78-4.63 3.26-5.42 6.19C.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z"
              fill="rgba(0,0,0,0.75)"
            />
            <path d="M45 24 27 14v20z" fill="#fff" />
          </svg>
        </span>
      </button>
      <a href={url} target="_blank" rel="noopener noreferrer" className="yt-preview-link">
        <span className="url-preview-site">YouTube</span>
        <span style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {url}
        </span>
      </a>
      <MediaActions kind="video" url={url} variant="bar" mode="url" />
    </div>
  );
}
