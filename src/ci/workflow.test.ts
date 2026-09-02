// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = {
  if?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
};

type Workflow = {
  on?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  concurrency?: Record<string, unknown>;
  jobs?: Record<
    string,
    {
      if?: string;
      name?: string;
      permissions?: Record<string, unknown>;
      steps?: Step[];
    }
  >;
};

function loadWorkflow(): { source: string; workflow: Workflow } {
  const source = readFileSync(resolve(".github/workflows/ci.yml"), "utf8");
  return { source, workflow: parse(source) as Workflow };
}

function readySteps(steps: Step[]): Step[] {
  return steps.filter(
    (step) => step.if === "github.event.pull_request.draft == false",
  );
}

describe("pull-request CI", () => {
  it("runs from pull-request events and has no manual quality dispatch", () => {
    const { workflow } = loadWorkflow();

    expect(workflow.on).toEqual({
      pull_request: {
        types: ["opened", "synchronize", "reopened", "ready_for_review"],
      },
    });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency).toEqual({
      group:
        "${{ github.workflow }}-pr-${{ github.event.pull_request.number }}",
      "cancel-in-progress": true,
    });
  });

  it("emits the required test check only for a ready pull request", () => {
    const { workflow } = loadWorkflow();
    const jobs = workflow.jobs ?? {};

    expect(Object.keys(jobs)).toEqual(["test"]);
    expect(jobs.test.name).toBe(
      "${{ github.event.pull_request.draft == false && 'test' || 'ci-control-no-test' }}",
    );
    expect(jobs.test.if).toBeUndefined();
    expect(jobs.test.permissions).toEqual({ contents: "read" });

    const steps = jobs.test.steps ?? [];
    expect(steps).toContainEqual({
      name: "Record a draft without exposing the required check",
      if: "github.event.pull_request.draft == true",
      run: expect.stringContaining("no check named test"),
    });
    expect(readySteps(steps)).toHaveLength(5);
  });

  it("tests GitHub's merge result through the same full verification command used locally", () => {
    const { source, workflow } = loadWorkflow();
    const steps = readySteps(workflow.jobs?.test.steps ?? []);
    const checkout = steps.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );

    expect(checkout).toBeDefined();
    expect(checkout?.with).toEqual({ "persist-credentials": false });
    expect(steps).toContainEqual(expect.objectContaining({ run: "npm ci" }));
    expect(steps).toContainEqual(
      expect.objectContaining({
        run: "npx playwright install --with-deps chromium",
      }),
    );
    expect(steps).toContainEqual(
      expect.objectContaining({ run: "npm run verify" }),
    );

    expect(source).not.toContain("workflow_dispatch");
    expect(source).not.toContain("check-runs");
    expect(source).not.toContain("pull_request_number");
    expect(source).not.toContain("expected_head_oid");
  });
});
