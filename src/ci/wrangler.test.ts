import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function config() {
  const source = readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8");
  return JSON.parse(source.replace(/,\s*([}\]])/g, "$1"));
}

describe("Worker schedule configuration", () => {
  it("routes through the custom Worker and schedules expiry only in test", () => {
    const wrangler = config();

    expect(wrangler.main).toBe("custom-worker.ts");
    expect(wrangler.env.test.triggers).toEqual({ crons: ["* * * * *"] });
    expect(wrangler.triggers).toBeUndefined();
    expect(wrangler.env.preview.triggers).toBeUndefined();
    expect(wrangler.env.production.triggers).toBeUndefined();
  });
});
