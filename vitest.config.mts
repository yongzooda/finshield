import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Next.js 경로 별칭 — 소스와 동일하게 맞춘다
      "@": r("./src"),
      // 아래 주석 참조: 테스트에서만 무력화한다
      "server-only": r("./src/test/empty-module.ts"),
    },
  },
  test: {
    // .tsx도 포함한다 — S-04는 렌더 결과를 검사해야 F-306 「한 벌」을 지킬 수 있다
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test/setup-env.ts"],
    // 실 DB(Session pooler) 왕복이 있는 테스트가 있어 여유를 둔다
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
