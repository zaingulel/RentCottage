import { defineConfig, devices } from "@playwright/test";

const workerPreview = process.env.PLAYWRIGHT_SERVER === "worker";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: workerPreview ? "http://127.0.0.1:8788" : "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: workerPreview
    ? {
        command:
          "npm run build:worker && WRANGLER_LOG_PATH=/tmp/rentcottage-wrangler-logs WRANGLER_REGISTRY_PATH=/tmp/rentcottage-wrangler-registry npm run preview -- --env test --port 8788 --var APP_ENVIRONMENT:test --var SUPABASE_PROJECT_REF:$SUPABASE_PROJECT_REF --var SUPABASE_URL:$SUPABASE_URL --var SUPABASE_PUBLISHABLE_KEY:$SUPABASE_PUBLISHABLE_KEY --var SUPABASE_SECRET_KEY:$SUPABASE_SECRET_KEY",
        url: "http://127.0.0.1:8788/api/health",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      }
    : {
        command: "npm run build && npm run start -- -p 3000",
        url: "http://127.0.0.1:3000/ar",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "worker",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
