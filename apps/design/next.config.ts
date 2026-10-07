import type { NextConfig } from "next";

// mycrew 포털 iframe은 호스트 동일출처 프록시(`/api/apps/design/proxy/`)로 이 앱을 임베드한다.
// basePath를 그 프리픽스로 맞춰야 _next 에셋·페이지 라우팅이 프록시 경유로 해석된다.
// (호스트 app-proxy 는 design 앱에 proxyMode:"passthrough" 로 프리픽스를 유지해 전달한다.)
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "/api/apps/design/proxy";

const nextConfig: NextConfig = {
  ...(BASE_PATH ? { basePath: BASE_PATH } : {}),
  transpilePackages: ["@mycrew/ai-client"],
  // Boolean 연산은 brower-only paper.js, PDF 내보내기는 svg2pdf.js 를 사용한다.
  // 두 라이브러리 모두 Node 전용 native deps(`canvas` 등)를 트리 안에 갖고 있어
  // Next SSR 단계에서 import 평가가 일어나면 module-not-found 가 난다. 서버에서
  // 외부화해 SSR 번들에서 제외한다 (클라이언트 dynamic import 만 허용).
  serverExternalPackages: ["paper", "canvas", "svg2pdf.js", "jspdf"],
  experimental: {
    serverActions: { bodySizeLimit: "64mb" },
  },
};

export default nextConfig;
