// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = {
  env?: Record<string, string>;
  id?: string;
  if?: string;
  name?: string;
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
      env?: Record<string, string>;
      environment?: string;
      name?: string;
      permissions?: Record<string, unknown>;
      steps?: Step[];
    }
  >;
};

function loadWorkflow(path = ".github/workflows/ci.yml"): {
  source: string;
  workflow: Workflow;
} {
  const source = readFileSync(resolve(path), "utf8");
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
    expect(readySteps(steps)).toHaveLength(4);
  });

  it("tests GitHub's merge result through the same verification command used locally", () => {
    const { source, workflow } = loadWorkflow();
    const steps = readySteps(workflow.jobs?.test.steps ?? []);
    const checkout = steps.find(
      (step) =>
        step.uses ===
        "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    );
    const setupNode = steps.find(
      (step) =>
        step.uses ===
        "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
    );

    expect(checkout).toBeDefined();
    expect(checkout?.with).toEqual({
      "fetch-depth": 0,
      "persist-credentials": false,
    });
    expect(setupNode).toBeDefined();
    expect(steps).toContainEqual(expect.objectContaining({ run: "npm ci" }));
    expect(steps).toContainEqual(
      expect.objectContaining({
        env: {
          VERIFY_BASE_SHA: "${{ github.event.pull_request.base.sha }}",
          VERIFY_SOURCE_SHA: "${{ github.event.pull_request.head.sha }}",
        },
        run: "npm run verify",
      }),
    );
    expect(source).not.toContain("npx playwright install");

    expect(source).not.toContain("workflow_dispatch");
    expect(source).not.toContain("check-runs");
    expect(source).not.toContain("pull_request_number");
    expect(source).not.toContain("expected_head_oid");
    expect(source).not.toContain("${{ secrets.");
  });
});

describe("preview deployment boundary", () => {
  it("remains manual, owner-only, pinned, and secret-isolated", () => {
    const { source, workflow } = loadWorkflow(".github/workflows/preview.yml");
    const preview = workflow.jobs?.preview;
    const steps = preview?.steps ?? [];

    expect(workflow.on).toEqual({ workflow_dispatch: null });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(preview?.if).toBe("github.actor == github.repository_owner");
    expect(preview?.environment).toBe("preview");
    expect(preview?.permissions).toEqual({
      contents: "read",
      deployments: "write",
    });
    expect(preview?.env).toEqual({
      APP_ENVIRONMENT: "preview",
      NEXTJS_ENV: "preview",
    });
    expect(source).not.toContain("pull_request:");
    expect(source).not.toContain("pull_request_review:");

    expect(steps).toContainEqual(
      expect.objectContaining({
        uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
        with: { "persist-credentials": false },
      }),
    );
    expect(steps).toContainEqual(
      expect.objectContaining({
        uses: "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
        with: expect.objectContaining({ "package-manager-cache": false }),
      }),
    );
    expect(steps).toContainEqual(
      expect.objectContaining({
        uses: "cloudflare/wrangler-action@ebbaa1584979971c8614a24965b4405ff95890e0",
      }),
    );

    const prepare = steps.find(
      (step) => step.name === "Prepare preview deployment secrets",
    );
    const deploy = steps.find((step) => step.id === "deploy");
    const cleanup = steps.find(
      (step) => step.name === "Remove preview deployment secrets",
    );
    const verifyDeployment = steps.find(
      (step) => step.name === "Verify active Cloudflare version",
    );
    const verifyPreview = steps.find(
      (step) => step.name === "Verify Cloudflare preview",
    );

    expect(
      steps.filter((step) =>
        JSON.stringify(step.env ?? {}).includes("SUPABASE_SECRET_KEY"),
      ),
    ).toEqual([prepare]);
    expect(prepare?.env).toEqual({
      SUPABASE_PROJECT_REF: "${{ vars.SUPABASE_PROJECT_REF }}",
      SUPABASE_URL: "${{ vars.SUPABASE_URL }}",
      SUPABASE_SECRET_KEY: "${{ secrets.SUPABASE_SECRET_KEY }}",
      PRIVILEGED_AUDIT_HMAC_KEY: "${{ secrets.PRIVILEGED_AUDIT_HMAC_KEY }}",
    });
    expect(prepare?.run).toContain("npm run verify:supabase-secret");
    expect(prepare?.run).toContain("write-preview-deployment-secrets.mjs");
    expect(deploy?.env).toBeUndefined();
    expect(deploy?.with?.secrets).toBeUndefined();
    expect(deploy?.with?.environment).toBe("preview");
    expect(deploy?.with?.command).toContain("deploy --env preview");
    expect(deploy?.with?.command).toContain(
      "--secrets-file ${{ runner.temp }}/muntajaa-preview-secrets.json",
    );
    expect(deploy?.with?.command).toContain("--tag ${{ github.sha }}");
    expect(deploy?.with?.command).toContain(
      "--var SUPABASE_PROJECT_REF:${{ vars.SUPABASE_PROJECT_REF }}",
    );
    expect(deploy?.with?.command).toContain(
      "--var SUPABASE_URL:${{ vars.SUPABASE_URL }}",
    );
    expect(deploy?.with?.command).toContain(
      "--var SUPABASE_PUBLISHABLE_KEY:${{ vars.SUPABASE_PUBLISHABLE_KEY }}",
    );
    expect(deploy?.with?.command).toContain(
      "--var DEPLOYMENT_COMMIT:${{ github.sha }}",
    );
    expect(cleanup).toEqual(
      expect.objectContaining({
        if: "always()",
        run: 'rm -f "$RUNNER_TEMP/muntajaa-preview-secrets.json"',
      }),
    );
    expect(steps.indexOf(cleanup as Step)).toBeGreaterThan(
      steps.indexOf(deploy as Step),
    );
    expect(steps.indexOf(cleanup as Step)).toBeLessThan(
      steps.indexOf(verifyDeployment as Step),
    );
    expect(verifyDeployment?.env).toEqual({
      CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}",
      CLOUDFLARE_ACCOUNT_ID: "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
    });
    expect(verifyDeployment?.run).toBe(
      'npm run verify:cloudflare-deployment -- preview "${{ github.sha }}"',
    );
    expect(verifyPreview?.env).toEqual({
      PREVIEW_URL: "${{ steps.deploy.outputs.deployment-url }}",
    });
    expect(verifyPreview?.run).toBe('npm run verify:preview -- "$PREVIEW_URL"');

    const wrangler = readFileSync(resolve("wrangler.jsonc"), "utf8");
    for (const workerName of [
      "muntajaa-development",
      "muntajaa-test",
      "muntajaa-preview",
      "muntajaa-production",
    ]) {
      expect(wrangler).toContain(`"name": "${workerName}"`);
    }
  });
});
