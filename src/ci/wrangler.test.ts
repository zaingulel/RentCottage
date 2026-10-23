import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function config() {
  const source = readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8");
  return JSON.parse(source.replace(/,\s*([}\]])/g, "$1"));
}

describe("Worker schedule configuration", () => {
  it("hosted demo guards every request and schedules native processing every minute", () => {
    const wrangler = config();
    const demo = wrangler.env.demo;

    expect(demo).toBeDefined();
    expect(demo.main).toBe("hosted-demo-worker.ts");
    expect(demo.name).toBe("halabeekom-demo");
    expect(demo.preview_urls).toBe(false);
    expect(demo.assets).toEqual({
      directory: ".open-next/assets",
      binding: "ASSETS",
      run_worker_first: true,
    });
    expect(demo.vars).toEqual({
      APP_ENVIRONMENT: "preview",
      HOSTED_DEMO: "true",
    });
    expect(demo.triggers).toEqual({ crons: ["* * * * *"] });
    expect(demo.routes).toBeUndefined();
    expect(wrangler.triggers).toBeUndefined();
    const worker = readFileSync(join(process.cwd(), demo.main), "utf8");
    expect(worker).toMatch(/\bscheduled\b/);
  });

  it("routes through the custom Worker and schedules expiry only in test", () => {
    const wrangler = config();

    expect(wrangler.main).toBe("custom-worker.ts");
    expect(wrangler.env.test.triggers).toEqual({ crons: ["* * * * *"] });
    expect(wrangler.triggers).toBeUndefined();
    expect(wrangler.env.preview.triggers).toBeUndefined();
    expect(wrangler.env.production.triggers).toBeUndefined();
  });
});
