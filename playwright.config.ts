import { defineConfig, devices } from "@playwright/test";

const workerPreview = process.env.PLAYWRIGHT_SERVER === "worker";

function readPort(name: string, fallback: string) {
  const value = process.env[name] ?? fallback;
  const port = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isInteger(port) ||
    port < 1025 ||
    port > 65_535
  ) {
    throw new Error(`${name} must be an integer from 1025 to 65535`);
  }
  return port;
}

const workerPort = readPort("PLAYWRIGHT_WORKER_PORT", "8788");
const workerOrigin = `http://127.0.0.1:${workerPort}`;
const nextPort = readPort("PLAYWRIGHT_NEXT_PORT", "3000");
const nextOrigin = `http://127.0.0.1:${nextPort}`;

export const workerPreviewServer = {
  command: `WRANGLER_LOG_PATH=/tmp/rentcottage-wrangler-logs WRANGLER_REGISTRY_PATH=/tmp/rentcottage-wrangler-registry npm run preview -- --env test --test-scheduled --port ${workerPort} --var APP_ENVIRONMENT:test --var "SUPABASE_PROJECT_REF:\${SUPABASE_PROJECT_REF:?}" --var "SUPABASE_URL:\${SUPABASE_URL:?}" --var "SUPABASE_PUBLISHABLE_KEY:\${SUPABASE_PUBLISHABLE_KEY:?}" --var "SUPABASE_SECRET_KEY:\${SUPABASE_SECRET_KEY:?}" --var "PRIVILEGED_AUDIT_HMAC_KEY:\${PRIVILEGED_AUDIT_HMAC_KEY:?}"`,
  url: `${workerOrigin}/api/health`,
  reuseExistingServer: false,
  timeout: 180_000,
};

export const nextServer = {
  command: `npm run start -- -p ${nextPort}`,
  url: `${nextOrigin}/ar`,
  reuseExistingServer: false,
  timeout: 120_000,
};

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Two local checks share one machine, which measured about three times slower than a hosted runner.
  timeout: process.env.CI ? 30_000 : 90_000,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: workerPreview ? workerOrigin : nextOrigin,
    trace: "on-first-retry",
  },
  webServer: workerPreview
    ? {
        ...workerPreviewServer,
        command: `npm run build:worker && ${workerPreviewServer.command}`,
      }
    : {
        ...nextServer,
        command: `npm run build && ${nextServer.command}`,
      },
  projects: [
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "desktop",
      grepInvert: [
        /^desktop customer-reviews\.spec\.ts administrator review return (?:en|ar|ckb) (?:signed-out|aal1) administrator review return keeps the chosen language and MFA$/,
        /^desktop access\.spec\.ts an empty administrator password is recorded as a failed attempt$/,
        /^desktop access\.spec\.ts failed administrator sign-in gives no privileged access$/,
        /^desktop administrator-records\.spec\.ts marketplace users and AAL1 administrators cannot discover administrator records$/,
        /^desktop administrator-payment-history\.spec\.ts AAL2 support sees ordered redacted history in every launch language$/,
        /^desktop customer-reviews\.spec\.ts Customer review publishes, paginates, survives moderation audit, and disappears publicly$/,
      ],
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
