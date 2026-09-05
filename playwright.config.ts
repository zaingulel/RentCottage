import { defineConfig, devices } from "@playwright/test";

const workerPreview = process.env.PLAYWRIGHT_SERVER === "worker";
const workerPortValue = process.env.PLAYWRIGHT_WORKER_PORT ?? "8788";
const workerPort = Number(workerPortValue);
if (
  !/^\d+$/.test(workerPortValue) ||
  !Number.isInteger(workerPort) ||
  workerPort < 1025 ||
  workerPort > 65_535
) {
  throw new Error(
    "PLAYWRIGHT_WORKER_PORT must be an integer from 1025 to 65535",
  );
}
const workerOrigin = `http://127.0.0.1:${workerPort}`;

export const workerPreviewServer = {
  command: `WRANGLER_LOG_PATH=/tmp/rentcottage-wrangler-logs WRANGLER_REGISTRY_PATH=/tmp/rentcottage-wrangler-registry npm run preview -- --env test --test-scheduled --port ${workerPort} --var APP_ENVIRONMENT:test --var "SUPABASE_PROJECT_REF:\${SUPABASE_PROJECT_REF:?}" --var "SUPABASE_URL:\${SUPABASE_URL:?}" --var "SUPABASE_PUBLISHABLE_KEY:\${SUPABASE_PUBLISHABLE_KEY:?}" --var "SUPABASE_SECRET_KEY:\${SUPABASE_SECRET_KEY:?}" --var "PRIVILEGED_AUDIT_HMAC_KEY:\${PRIVILEGED_AUDIT_HMAC_KEY:?}"`,
  url: `${workerOrigin}/api/health`,
  reuseExistingServer: false,
  timeout: 180_000,
};

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: workerPreview ? workerOrigin : "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: workerPreview
    ? {
        ...workerPreviewServer,
        command: `npm run build:worker && ${workerPreviewServer.command}`,
      }
    : {
        command: "npm run build && npm run start -- -p 3000",
        url: "http://127.0.0.1:3000/ar",
        reuseExistingServer: false,
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
