import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "access-journey-boundary.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
});
