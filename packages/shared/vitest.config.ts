import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test-setup.ts"],
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
    // Supabase cold start + multi-step seeding easily exceeds 5s default
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
