import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  agentRules: false,
  outputFileTracingIncludes: {
    "/api/finshield/files/process": ["./src/lib/finshield/files/parser-worker.mjs", "./.github/scripts/file-safety-inspector.mjs"],
  },
};

export default withWorkflow(nextConfig);
