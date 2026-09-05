import { defineConfig } from "@playwright/test";

import config, { workerPreviewServer } from "./playwright.config";

if (process.env.PLAYWRIGHT_SERVER !== "worker") {
  throw new Error("Prebuilt preview requires PLAYWRIGHT_SERVER=worker");
}

export default defineConfig({
  ...config,
  webServer: workerPreviewServer,
});
