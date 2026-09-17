import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["frontend/renderer/src/**/*.test.ts"],
  },
});
