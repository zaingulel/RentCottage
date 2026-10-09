import { defineConfig } from "@playwright/test";

import config, { nextServer } from "./playwright.config";

if (process.env.PLAYWRIGHT_SERVER !== "next") {
  throw new Error("Prebuilt Next.js start requires PLAYWRIGHT_SERVER=next");
}

export default defineConfig({
  ...config,
  webServer: nextServer,
});
