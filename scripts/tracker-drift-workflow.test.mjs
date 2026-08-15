import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

describe("tracker drift workflow", () => {
  it("runs detection-only reconciliation on a schedule with read-only repository permissions", () => {
    const workflow = parse(
      readFileSync(".github/workflows/tracker-drift.yml", "utf8"),
    );
    const job = workflow.jobs.audit;

    expect(workflow.on).toEqual({
      schedule: [{ cron: "17 7 * * *" }],
    });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(job.permissions).toBeUndefined();
    expect(job.env).toBeUndefined();
    expect(job.steps.slice(0, -1).every((step) => step.env === undefined)).toBe(
      true,
    );
    expect(job.steps[0].with).toEqual({
      "persist-credentials": false,
      ref: "${{ github.event.repository.default_branch }}",
    });
    const auditStep = job.steps.at(-1);
    expect(auditStep).toEqual({
      name: "Detect tracker drift",
      env: {
        GH_TOKEN: "${{ secrets.RENTCOTTAGE_PROJECT_READ_TOKEN }}",
      },
      run: expect.stringContaining("npm run reconcile:board"),
    });
    expect(auditStep.run).toContain("set +e");
    expect(auditStep.run).toContain("status=$?");
    expect(auditStep.run).toContain("set -e");
    expect(auditStep.run).toContain('if [ "$status" -eq 5 ]; then exit 0; fi');
    expect(auditStep.run).toContain('exit "$status"');
  });
});
