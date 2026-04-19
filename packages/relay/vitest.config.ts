import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test-setup.ts"],
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
