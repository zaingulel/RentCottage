import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

function workflowAuditStep() {
  return parse(
    readFileSync(".github/workflows/tracker-drift.yml", "utf8"),
  ).jobs.audit.steps.at(-1);
}

function runAuditScript(run, reconcileStatus, verifyStatus) {
  const harness = `
npm() {
  printf '%s\n' "$*"
  if [ "$*" = "run reconcile:board" ]; then return "$RECONCILE_STATUS"; fi
  if [ "$*" = "run verify:board" ]; then return "$VERIFY_STATUS"; fi
  return 99
}
${run}`;
  return spawnSync("bash", ["-c", harness], {
    encoding: "utf8",
    env: {
      ...process.env,
      GH_TOKEN: "test-token",
      RECONCILE_STATUS: String(reconcileStatus),
      VERIFY_STATUS: String(verifyStatus),
    },
  });
}

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
    const auditStep = workflowAuditStep();
    expect(auditStep).toEqual({
      name: "Detect tracker drift",
      env: {
        GH_TOKEN: "${{ secrets.RENTCOTTAGE_PROJECT_READ_TOKEN }}",
      },
      run: expect.stringContaining("npm run reconcile:board"),
    });
    expect(auditStep.run).toContain("set +e");
    expect(auditStep.run).toContain("reconcile_status=$?");
    expect(auditStep.run).toContain("npm run verify:board");
    expect(auditStep.run).toContain("verify_status=$?");
    expect(auditStep.run).toContain("set -e");
  });

  it.each([
    ["accepts a clean audit only when verification passes", 5, 0, 0],
    ["preserves reconciliation execution failure", 1, 0, 1],
    ["preserves reconciliation usage failure", 2, 0, 2],
    ["preserves reconciliation proposed-plan status", 3, 0, 3],
    ["preserves reconciliation evidence failure", 4, 0, 4],
    ["fails a clean audit when verification fails", 5, 1, 1],
    ["preserves drift status when both checks fail", 4, 1, 4],
  ])("%s", (_name, reconcileStatus, verifyStatus, expectedStatus) => {
    const result = runAuditScript(
      workflowAuditStep().run,
      reconcileStatus,
      verifyStatus,
    );

    expect(result.stdout.trim().split("\n")).toEqual([
      "run reconcile:board",
      "run verify:board",
    ]);
    expect(result.status).toBe(expectedStatus);
  });
});
