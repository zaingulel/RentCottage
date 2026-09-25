import { isAbsolute, join } from "node:path";

import { defineConfig } from "@playwright/test";

const baseURL = process.env.SCHEDULED_EXPIRY_PROBE_BASE_URL;
const outputDir = process.env.SCHEDULED_EXPIRY_PROBE_OUTPUT_DIR;
if (!baseURL || !outputDir || !isAbsolute(outputDir)) {
  throw new Error(
    "Scheduled expiry probe requires a base URL and owned output directory.",
  );
}
const target = new URL(baseURL);
if (
  target.protocol !== "http:" ||
  target.hostname !== "127.0.0.1" ||
  target.pathname !== "/" ||
  target.search ||
  target.hash
) {
  throw new Error(
    "Scheduled expiry probe requires the existing local Worker URL.",
  );
}

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: "scheduled-expiry-interruption.ts",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 30_000,
  outputDir: join(outputDir, "output"),
  reporter: [["json", { outputFile: join(outputDir, "report.json") }]],
  projects: [{ name: "worker", use: { baseURL } }],
});
