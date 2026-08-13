// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("GitHub Actions delivery checks", () => {
  it("checks source quality, the Worker build, local smoke, and preview smoke", () => {
    const workflow = parse(
      readFileSync(resolve(".github/workflows/ci.yml"), "utf8"),
    );

    const qualityCommands = workflow.jobs.quality.steps
      .map((step: { run?: string }) => step.run)
      .filter(Boolean)
      .join("\n");
    expect(qualityCommands).toContain("npm run format:check");
    expect(qualityCommands).toContain("npm run lint");
    expect(qualityCommands).toContain("npm run typecheck");
    expect(qualityCommands).toContain("npm test");
    expect(qualityCommands).toContain("npm run test:browser");
    expect(qualityCommands).toContain("npm run build:worker");
    expect(qualityCommands).toContain("npm run smoke:preview");

    const preview = workflow.jobs.preview;
    expect(preview.needs).toBe("quality");
    expect(preview.if).toBe("github.event_name == 'workflow_dispatch'");
    expect(JSON.stringify(preview.steps)).toContain(
      "versions upload --env preview",
    );
    expect(JSON.stringify(preview.steps)).toContain("/api/health");
    expect(JSON.stringify(preview.steps)).toContain("/ar");
  });
});
