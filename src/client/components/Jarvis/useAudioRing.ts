import { useEffect, useRef } from 'react';

// 오디오 반응 링 — AnalyserNode 시간 도메인 데이터를 읽어 canvas에 파동을 그린다.
// analyserRef.current가 없으면(발화 전/침묵) target을 0으로 서서히 감쇠시킨다.

export function useAudioRing(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  analyserRef: React.MutableRefObject<AnalyserNode | null>,
  colorRef: React.MutableRefObject<string>,
) {
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let level = 0;
    let target = 0;
    let buf: Uint8Array<ArrayBuffer> | null = null;
    const t0 = performance.now();

    const draw = () => {
      const t = (performance.now() - t0) / 1000;
      const analyser = analyserRef.current;
      if (analyser) {
        if (!buf || buf.length !== analyser.fftSize) buf = new Uint8Array(new ArrayBuffer(analyser.fftSize));
        analyser.getByteTimeDomainData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          s += v * v;
        }
        target = Math.min(1, Math.sqrt(s / buf.length) * 6);
      } else {
        target = 0;
      }
      level += (target - level) * (target > level ? 0.35 : 0.12);

      const W = canvas.width;
      const H = canvas.height;
      const cx = W / 2;
      const cy = H / 2;
      const R = Math.min(W, H) * 0.34;
      const color = colorRef.current;

      ctx2d.clearRect(0, 0, W, H);
      for (let i = 0; i < 2; i++) {
        ctx2d.beginPath();
        ctx2d.strokeStyle = color;
        ctx2d.globalAlpha = 0.18 + i * 0.08;
        ctx2d.lineWidth = 1;
        ctx2d.setLineDash([6, 10]);
        ctx2d.lineDashOffset = reduced ? 0 : -t * 18 * (i ? 1 : -1);
        ctx2d.arc(cx, cy, R + 18 + i * 16, 0, Math.PI * 2);
        ctx2d.stroke();
      }
      ctx2d.setLineDash([]);
      ctx2d.beginPath();
      const pts = 120;
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2;
        const w = Math.sin(a * 6 + t * 5) * 0.5 + Math.sin(a * 11 - t * 3) * 0.5;
        const r = R + 8 + level * (26 + 16 * w);
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i) ctx2d.lineTo(x, y); else ctx2d.moveTo(x, y);
      }
      ctx2d.closePath();
      ctx2d.strokeStyle = color;
      ctx2d.globalAlpha = 0.35 + level * 0.6;
      ctx2d.lineWidth = 1.5 + level * 2;
      ctx2d.shadowColor = color;
      ctx2d.shadowBlur = 14 + level * 30;
      ctx2d.stroke();
      ctx2d.shadowBlur = 0;
      ctx2d.globalAlpha = 1;

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef]);
}
