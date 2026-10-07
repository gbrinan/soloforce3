import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dir = path.dirname(__filename);

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/api/apps/leads/proxy";

const nextConfig: NextConfig = {
  ...(BASE_PATH ? { basePath: BASE_PATH } : {}),
  turbopack: { root: __dir },
};

export default nextConfig;
