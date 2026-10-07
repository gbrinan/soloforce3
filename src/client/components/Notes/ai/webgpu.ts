// WebGPU 지원 감지 — WebLLM 생성 AI는 WebGPU 필수.
// 미지원(CPU 전용 기기) 시 AI 기능 숨김(폴백 없음, 스펙 Phase 3-3).
let cached: boolean | null = null;

interface GPULike { requestAdapter(): Promise<unknown | null> }

export async function hasWebGPU(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    const gpu = (navigator as Navigator & { gpu?: GPULike }).gpu;
    if (!gpu) { cached = false; return false; }
    const adapter = await gpu.requestAdapter();
    cached = !!adapter;
    return cached;
  } catch {
    cached = false;
    return false;
  }
}
