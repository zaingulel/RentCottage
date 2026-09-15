import { defineConfig, devices } from "@playwright/test";

import config from "./playwright.config";

if (process.env.PLAYWRIGHT_SERVER !== "worker") {
  throw new Error("The demo walkthrough requires PLAYWRIGHT_SERVER=worker");
}

export default defineConfig({
  ...config,
  retries: 0,
  testMatch: "demo-walkthrough.spec.ts",
  webServer: undefined,
  workers: 1,
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
