// FCP XML v1.10 serializer — Action[] → XML for DaVinci Resolve 18+ / Premiere Pro
// Minimal implementation: video spine + audio lane, cut/trim/caption/bgm/transition mapping.
// Does NOT execute ffmpeg — read-only export for NLE handoff.

import type { Action, Footage } from "./action-types";

interface FcpXmlOptions {
  projectName?: string;
  eventName?: string;
}

/**
 * Serialize Action[] to FCP XML v1.10.
 * @param actions - Applied actions (trim/cut/caption/bgm/transition)
 * @param footage - Source footage metadata
 * @param options - Project/event naming
 * @returns FCP XML string
 */
export function serializeFcpXml(
  actions: Action[],
  footage: Footage,
  options: FcpXmlOptions = {},
): string {
  const projectName = options.projectName ?? "MyMovie Project";
  const eventName = options.eventName ?? "MyMovie Export";

  // Derive format from footage
  const { width, height, durationMs } = footage;
  const durationSec = (durationMs / 1000).toFixed(3);
  const frameDuration = "100/3000s"; // 30fps default

  // Collect clips after applying cuts
  const cuts = actions.filter((a) => a.type === "cut");
  const clipSegments = deriveClipSegments(footage.id, durationMs, cuts);

  // Apply trims
  const trims = actions.filter((a) => a.type === "trim");
  for (const seg of clipSegments) {
    const trim = trims.find((t) => t.type === "trim" && t.clipId === footage.id);
    if (trim && trim.type === "trim") {
      seg.start = trim.start;
      seg.end = trim.end;
    }
  }

  // Build resources
  const formatId = "r1";
  const assetId = "r2";
  const resourcesXml = `
    <format id="${formatId}" name="FFVideoFormat${height}p30" frameDuration="${frameDuration}" width="${width}" height="${height}"/>
    <asset id="${assetId}" name="${footage.id}" src="file:///${escapeXml(footage.path)}" start="0s" duration="${durationSec}s" hasVideo="1" hasAudio="1" format="${formatId}"/>
  `;

  // Build spine (video clips)
  const spineClips = clipSegments
    .map((seg, i) => {
      const startSec = (seg.start / 1000).toFixed(3);
      const durSec = ((seg.end - seg.start) / 1000).toFixed(3);
      const offsetSec = i === 0 ? "0s" : ""; // offset is cumulative, simplified here
      return `      <clip name="${footage.id}-${i}" ref="${assetId}" offset="${offsetSec}" start="${startSec}s" duration="${durSec}s"/>`;
    })
    .join("\n");

  // Captions → title elements (simplified: inline after clip)
  const captions = actions.filter((a) => a.type === "caption");
  const captionXml = captions
    .map((cap) => {
      if (cap.type !== "caption") return "";
      const startSec = (cap.start / 1000).toFixed(3);
      const durSec = ((cap.end - cap.start) / 1000).toFixed(3);
      return `      <title name="Caption" offset="${startSec}s" duration="${durSec}s" start="0s">
        <text>${escapeXml(cap.text)}</text>
      </title>`;
    })
    .join("\n");

  // BGM → audio lane (simplified: single audio clip)
  const bgm = actions.find((a) => a.type === "bgm");
  let audioLaneXml = "";
  if (bgm && bgm.type === "bgm") {
    const bgmStart = bgm.start ?? 0;
    const bgmEnd = bgm.end ?? durationMs;
    const bgmDur = ((bgmEnd - bgmStart) / 1000).toFixed(3);
    audioLaneXml = `
      <audio lane="-1" offset="0s">
        <audio-clip name="BGM" ref="${assetId}" offset="0s" duration="${bgmDur}s" start="0s"/>
      </audio>`;
  }

  // Transitions: not implemented (requires clip-pair analysis), TODO comment
  const transitions = actions.filter((a) => a.type === "transition");
  const transitionComment =
    transitions.length > 0
      ? `\n      <!-- TODO: ${transitions.length} transition(s) omitted (requires clip-pair analysis) -->`
      : "";

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>${resourcesXml}
  </resources>
  <library>
    <event name="${escapeXml(eventName)}">
      <project name="${escapeXml(projectName)}">
        <sequence format="${formatId}" duration="${durationSec}s">
          <spine>
${spineClips}${captionXml}${transitionComment}
          </spine>${audioLaneXml}
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;

  return xml;
}

// Derive clip segments after cut actions (split timeline into N clips)
interface ClipSegment {
  start: number; // ms
  end: number; // ms
}

function deriveClipSegments(
  clipId: string,
  durationMs: number,
  cuts: Action[],
): ClipSegment[] {
  const cutPoints = cuts
    .filter((c) => c.type === "cut" && c.clipId === clipId)
    .map((c) => (c.type === "cut" ? c.at : 0)) // at is already in ms (TimeMs)
    .sort((a, b) => a - b);

  if (cutPoints.length === 0) return [{ start: 0, end: durationMs }];

  const segments: ClipSegment[] = [];
  let prev = 0;
  for (const cut of cutPoints) {
    if (cut > prev) segments.push({ start: prev, end: cut });
    prev = cut;
  }
  if (prev < durationMs) segments.push({ start: prev, end: durationMs });

  return segments;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
