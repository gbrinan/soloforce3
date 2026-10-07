import type { NextConfig } from "next";
import { fileURLToPath } from "url";
import { dirname } from "path";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// 이 앱 디렉토리 (next.config.ts 위치 = apps/isenssign)
const APP_DIR = dirname(fileURLToPath(import.meta.url));

// mycrew 포털 iframe은 호스트 동일출처 프록시(`/api/apps/sign/proxy/`)로 이 앱을 임베드한다.
// basePath를 그 프리픽스로 맞춰야 _next 에셋·페이지 라우팅이 프록시 경유로 해석된다.
// (호스트 app-proxy 는 sign 앱에 proxyMode:"passthrough" 로 프리픽스를 유지해 전달한다.)
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@mycrew/ai-client"],
  // standalone trace root를 모노레포 루트로 명시 (2026-06-26) — lockfile 다중으로 인한 root 추론 경고 제거.
  // (next-intl 의존성 트리는 build-sign.sh가 standalone에 명시 복사 — trace 누락 보완.)
  outputFileTracingRoot: dirname(dirname(APP_DIR)),
  ...(BASE_PATH ? { basePath: BASE_PATH } : {}),
  // 바로-루트(`/` = basePath 루트)는 next-intl 미들웨어가 matcher의 `api` 제외 규칙에
  // 걸려(basePath가 /api/...로 시작) 로케일 리다이렉트를 못 한다 → 404. 미들웨어와 무관한
  // config redirects 로 로케일을 보낸다. (source/destination 은 basePath 자동 프리픽스)
  //
  // 표준 언어 감지 규칙: Accept-Language 순회 첫 매치(ko/ja/en), 미지원 언어는 en 폴백.
  // has.value 는 Next가 `^값$` 앵커드 정규식으로 전체 헤더에 매치하므로,
  // "en/ja(en/ko)로 시작하지 않는 항목들을 건너뛴 뒤 ko(ja)가 나오는" 첫-매치 패턴을 쓴다.
  async redirects() {
    return [
      {
        source: "/",
        has: [{ type: "header" as const, key: "accept-language", value: "(?:(?!\\s*(?:en|ja))[^,]*,\\s*)*ko.*" }],
        destination: "/ko",
        permanent: false,
      },
      {
        source: "/",
        has: [{ type: "header" as const, key: "accept-language", value: "(?:(?!\\s*(?:en|ko))[^,]*,\\s*)*ja.*" }],
        destination: "/ja",
        permanent: false,
      },
      { source: "/", destination: "/en", permanent: false },
    ];
  },
  serverExternalPackages: ["pdfjs-dist", "canvas"],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default withNextIntl(nextConfig);
