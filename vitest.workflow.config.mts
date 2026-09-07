import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { workflow } from "workflow/vite";

/** 실행 중인 격리 Next 서버와 같은 Local World를 사용하는 선택적 시험. Provider 호출 없음. */
export default defineConfig({
  plugins: [workflow()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src",import.meta.url)),
    "server-only": fileURLToPath(new URL("./src/test/empty-module.ts",import.meta.url)) } },
  test: { include: ["src/lib/finshield/__tests__/workflow.server.spec.ts"], testTimeout: 30000,
    setupFiles: ["./src/test/setup-env.ts"] },
});
