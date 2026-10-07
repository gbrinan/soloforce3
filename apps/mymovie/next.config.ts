import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dir = path.dirname(__filename);

// mycrew 포털 iframe은 호스트 동일출처 프록시(`/api/apps/movie/proxy/`)로 이 앱을 임베드한다.
// basePath를 그 프리픽스로 맞춰야 _next 에셋·페이지 라우팅이 프록시 경유로 해석된다.
// (호스트 app-proxy 는 movie 앱에 proxyMode:"passthrough" 로 프리픽스를 유지해 전달한다.)
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  ...(BASE_PATH ? { basePath: BASE_PATH } : {}),
  transpilePackages: ["@mycrew/ai-client", "@mycrew/whisper-local"],
  turbopack: {
    // 모노레포 루트를 turbopack root로 지정해야 packages/ai-client(외부 file: 의존성)가
    // 컴파일 범위에 포함되어 transpilePackages가 동작한다.
    root: path.resolve(__dir, "../.."),
  },
  // 업로드 라우트 — 멀티파트 동영상 파일(최대 2GB)을 받기 위해 본문 크기 제한 해제.
  experimental: {
    serverActions: { bodySizeLimit: "2gb" },
  },
};

export default nextConfig;
