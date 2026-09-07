import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/finshield/files/process": ["./src/lib/finshield/files/parser-worker.mjs", "./.github/scripts/file-safety-inspector.mjs"],
  },
};

export default nextConfig;
