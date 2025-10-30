/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/tests/setup.ts"],
    onConsoleLog: (log) => {
      // Suppress React act warnings in tests
      if (log.includes("Warning: An update to") && log.includes("was not wrapped in act")) {
        return false;
      }
    },

    testTimeout: 10000,
    hookTimeout: 10000,
    css: true,

    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "src/tests/", "**/*.d.ts", "**/*.config.*"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
