import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(appDirectory, "../.."),
  transpilePackages: ["@process-copilot/ui"],
};

export default nextConfig;
