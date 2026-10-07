import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dir = path.dirname(__filename);

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/api/apps/hd-cleaner/proxy";

const nextConfig: NextConfig = {
  ...(BASE_PATH ? { basePath: BASE_PATH } : {}),
  transpilePackages: ["@mycrew/ai-client"],
  turbopack: {
    // 모노레포 루트를 turbopack root로 지정해야 packages/ai-client(외부 file: 의존성)가
    // 컴파일 범위에 포함되어 transpilePackages가 동작한다.
    root: path.resolve(__dir, "../.."),
  },
};

export default nextConfig;
