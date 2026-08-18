// @vitest-environment node

import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const expectedHead = "0123456789abcdef0123456789abcdef01234567";
const retiredProvider = ["code", "rabbit"].join("");

type ShellResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  calls: string[];
  outputs: string;
};

function loadWorkflow(path = ".github/workflows/ci.yml") {
  const source = readFileSync(resolve(path), "utf8");
  return { source, workflow: parse(source) };
}

function runWorkflowShell(
  script: string,
  environment: Record<string, string>,
): ShellResult {
  const directory = mkdtempSync(resolve(tmpdir(), "rentcottage-ci-test-"));
  const ghPath = resolve(directory, "gh");
  const callsPath = resolve(directory, "gh-calls");
  const outputPath = resolve(directory, "github-output");

  writeFileSync(
    ghPath,
    `#!/usr/bin/env bash
set -u
printf '%s\\n' "$*" >> "$GH_CALLS"
if [[ "$*" == *"/pulls/"* ]]; then
  if [[ "\${FAKE_PR_EXIT:-0}" != "0" ]]; then
    exit "$FAKE_PR_EXIT"
  fi
  if [[ "$*" == *".base.ref"* ]]; then
    printf '%s\\n' "\${FAKE_PR_TSV:-}"
  else
    printf '%s\\n' "\${FAKE_FINAL_PR_TSV:-}"
  fi
elif [[ "$*" == *"check-runs"* && "$*" == *"POST"* ]]; then
  printf '%s\\n' "\${FAKE_CHECK_ID:-9001}"
elif [[ "$*" == *"check-runs/"* && "$*" == *"PATCH"* ]]; then
  exit "\${FAKE_PATCH_EXIT:-0}"
else
  exit 91
fi
`,
  );
  chmodSync(ghPath, 0o755);

  const result = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH ?? ""}`,
      GITHUB_OUTPUT: outputPath,
      GH_CALLS: callsPath,
      GITHUB_REPOSITORY: "zaingulel/RentCottage",
      GITHUB_REF: "refs/heads/main",
      PULL_REQUEST_NUMBER: "88",
      EXPECTED_HEAD_OID: expectedHead,
      FAKE_PR_TSV: `open\t${expectedHead}\tzaingulel/RentCottage\tmain`,
      FAKE_FINAL_PR_TSV: `open\t${expectedHead}\tzaingulel/RentCottage`,
      FAKE_CHECK_ID: "9001",
      ...environment,
    },
  });

  const response = {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    calls: existsSync(callsPath)
      ? readFileSync(callsPath, "utf8").trim().split("\n").filter(Boolean)
      : [],
    outputs: readFileSync(outputPath, { encoding: "utf8", flag: "a+" }),
  };
  rmSync(directory, { recursive: true, force: true });
  return response;
}

describe("GitHub Actions delivery checks", () => {
  it("keeps terminal delivery release progressively registered from the document map", () => {
    const agents = readFileSync(resolve("AGENTS.md"), "utf8");
    const delivery = readFileSync(resolve("docs/agents/delivery.md"), "utf8");
    const implementation = readFileSync(
      resolve("scripts/release-delivery.mjs"),
      "utf8",
    );
    const behaviourTest = readFileSync(
      resolve("scripts/release-delivery.test.mjs"),
      "utf8",
    );
    const packageJson = JSON.parse(
      readFileSync(resolve("package.json"), "utf8"),
    );

    expect(agents).toContain("docs/agents/delivery.md");
    expect(agents).toContain("only when preparing or executing");
    expect(agents).not.toContain("git update-ref");
    expect(agents).not.toContain("worktree remove");
    expect(delivery).toContain("Load trigger:");
    expect(delivery).toContain("Owns:");
    expect(delivery).toContain("terminal release");
    expect(delivery).toContain("Does not own:");
    expect(delivery).toContain("Required inputs:");
    expect(delivery).toContain("Stop conditions:");
    expect(delivery).toContain("Next route:");
    expect(delivery).toContain("release:delivery");
    expect(delivery).toContain("scripts/release-delivery.mjs");
    expect(delivery).toContain("scripts/release-delivery.test.mjs");
    expect(packageJson.scripts["release:delivery"]).toBe(
      "node scripts/release-delivery.mjs",
    );
    expect(implementation).toContain("export function releaseDelivery(input)");
    expect(behaviourTest).toContain('describe("releaseDelivery"');
    expect(behaviourTest).toContain(
      "releases the exact clean secondary worktree and compare-deletes its branch",
    );
    expect(behaviourTest).toContain(
      "refuses an active writer before reading GitHub or mutating the target",
    );
  });

  it("declares a trusted-main exact-head dispatch contract", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve("package.json"), "utf8"),
    );
    expect(packageJson.devDependencies.esbuild).toBe("0.27.7");
    expect(packageJson.scripts["audit:production"]).toBe(
      "npm audit --omit=dev --audit-level=moderate",
    );
    expect(packageJson.scripts["scan:client-secrets"]).toContain(
      ".next/static .open-next/assets",
    );
    expect(packageJson.scripts.typecheck).toBe("next typegen && tsc --noEmit");
    expect(packageJson.scripts.verify).toBe("node scripts/verify.mjs");
    expect(packageJson.scripts["verify:preview"]).toBe(
      "node scripts/verify-preview.mjs",
    );
    expect(packageJson.scripts["verify:cloudflare-deployment"]).toBe(
      "node scripts/verify-cloudflare-deployment.mjs",
    );
    expect(packageJson.scripts["verify:supabase-secret"]).toBe(
      "node scripts/verify-supabase-secret.mjs",
    );

    const { source: ciSource, workflow } = loadWorkflow();
    expect(workflow.on.workflow_dispatch.inputs).toEqual({
      pull_request_number: {
        description: "Same-repository pull request number",
        required: true,
        type: "string",
      },
      expected_head_oid: {
        description: "Reviewed 40-character pull request head OID",
        required: true,
        type: "string",
      },
    });
    expect(workflow.on.pull_request).toBeUndefined();
    expect(workflow.on.pull_request_review).toBeUndefined();
    expect(workflow.on.push).toBeUndefined();
    expect(workflow.concurrency.group).toBe(
      "quality-${{ github.repository }}-pr-${{ inputs.pull_request_number }}",
    );
    expect(workflow.concurrency["cancel-in-progress"]).toBe(true);

    expect(workflow.permissions).toEqual({});
    expect(Object.keys(workflow.jobs)).toEqual([
      "validate",
      "verify",
      "finalize",
    ]);

    const validation = workflow.jobs.validate;
    expect(validation.name).toBe("Validate quality request");
    expect(validation.if).toBe("github.ref == 'refs/heads/main'");
    expect(validation.permissions).toEqual({
      contents: "read",
      "pull-requests": "read",
      checks: "write",
    });

    const verification = workflow.jobs.verify;
    expect(verification.name).toBe("Verify exact pull request head");
    expect(verification.needs).toBe("validate");
    expect(verification.permissions).toEqual({ contents: "read" });

    const finalization = workflow.jobs.finalize;
    expect(finalization.name).toBe("Finalize quality check");
    expect(finalization.needs).toEqual(["validate", "verify"]);
    expect(finalization.if).toBe(
      "always() && needs.validate.result == 'success'",
    );
    expect(finalization.permissions).toEqual({
      contents: "read",
      "pull-requests": "read",
      checks: "write",
    });

    for (const job of [validation, verification, finalization]) {
      expect(JSON.stringify(job)).not.toContain("secrets.");
      expect(job.env).toBeUndefined();
    }

    expect(ciSource.toLowerCase()).not.toContain(retiredProvider);
    expect(ciSource).not.toMatch(/graphite.*(?:comment|status|review|bot)/i);
    expect(ciSource).not.toMatch(/pull_request_review|issue_comment/);
    expect(ciSource).not.toMatch(/fallback|hidden marker/i);
  });

  it("isolates pull request execution from privileged GitHub permissions and tokens", () => {
    const { workflow } = loadWorkflow();
    const validation = workflow.jobs.validate;
    const verification = workflow.jobs.verify;
    const finalization = workflow.jobs.finalize;

    for (const privileged of [validation, finalization]) {
      const serialized = JSON.stringify(privileged);
      expect(serialized).not.toContain("actions/checkout@");
      expect(serialized).not.toContain("actions/setup-node@");
      expect(serialized).not.toContain("npm ci");
      expect(serialized).not.toContain("playwright");
      expect(serialized).not.toContain("npm run verify");
    }

    expect(verification.permissions).toEqual({ contents: "read" });
    expect(JSON.stringify(verification.permissions)).not.toContain("checks");
    expect(JSON.stringify(verification.permissions)).not.toContain(
      "pull-requests",
    );
    expect(JSON.stringify(verification)).not.toContain("github.token");
    expect(JSON.stringify(verification)).not.toContain("GH_TOKEN");
    expect(
      verification.steps.some((step: { uses?: string }) =>
        step.uses?.startsWith("actions/checkout@"),
      ),
    ).toBe(true);
  });

  it("documents Graphite submission before review and source-bound quality enforcement", () => {
    const delivery = readFileSync(resolve("docs/agents/delivery.md"), "utf8");
    const architecture = readFileSync(
      resolve("docs/adr/0001-cloudflare-workers-supabase-stack.md"),
      "utf8",
    );

    expect(delivery).toContain("`gt submit`");
    expect(delivery.indexOf("`gt submit`")).toBeLessThan(
      delivery.indexOf("wait for Graphite Agent"),
    );
    for (const authority of [delivery, architecture]) {
      expect(authority).toContain("observed GitHub Actions source");
      expect(authority).toContain("not the `quality` check name alone");
    }
  });

  it("rejects malformed inputs before reading GitHub", () => {
    const { workflow } = loadWorkflow();
    const validation = workflow.jobs.validate.steps.find(
      (step: { id?: string }) => step.id === "validate",
    );

    const malformedInputs: Record<string, string>[] = [
      { PULL_REQUEST_NUMBER: "not-a-number" },
      { PULL_REQUEST_NUMBER: "0" },
      { EXPECTED_HEAD_OID: "short" },
      { EXPECTED_HEAD_OID: `${expectedHead.slice(0, -1)}g` },
      { GITHUB_REPOSITORY: "outside/RentCottage" },
      { GITHUB_REF: "refs/heads/topic" },
    ];
    for (const environment of malformedInputs) {
      const result = runWorkflowShell(validation.run, environment);
      expect(result.status, JSON.stringify({ environment, result })).not.toBe(
        0,
      );
      expect(result.calls).toEqual([]);
    }
  });

  it("rejects unavailable, closed, foreign, stale, and temporary-base pull requests before creating quality", () => {
    const { workflow } = loadWorkflow();
    const validation = workflow.jobs.validate.steps.find(
      (step: { id?: string }) => step.id === "validate",
    );
    const invalidEvidence: Record<string, string>[] = [
      { FAKE_PR_EXIT: "1" },
      {
        FAKE_PR_TSV: `closed\t${expectedHead}\tzaingulel/RentCottage\tmain`,
      },
      {
        FAKE_PR_TSV: `open\t${expectedHead}\toutside/RentCottage\tmain`,
      },
      {
        FAKE_PR_TSV: `open\t${"f".repeat(40)}\tzaingulel/RentCottage\tmain`,
      },
      {
        FAKE_PR_TSV: `open\t${expectedHead}\tzaingulel/RentCottage\tgraphite-base/88`,
      },
      {
        FAKE_PR_TSV: `open\t${expectedHead}\tzaingulel/RentCottage\tgt/88/graphite-base/88`,
      },
    ];

    for (const environment of invalidEvidence) {
      const result = runWorkflowShell(validation.run, environment);
      expect(result.status, JSON.stringify({ environment, result })).not.toBe(
        0,
      );
      expect(
        result.calls.filter((call) => call.includes("check-runs")),
      ).toEqual([]);
      expect(result.calls.length).toBeLessThanOrEqual(1);
    }
  });

  it("accepts ordinary and upstack pull requests and creates quality on the exact head", () => {
    const { workflow } = loadWorkflow();
    const validation = workflow.jobs.validate.steps.find(
      (step: { id?: string }) => step.id === "validate",
    );

    for (const base of ["main", "codex/issue-87-lower-stack"]) {
      const result = runWorkflowShell(validation.run, {
        FAKE_PR_TSV: `open\t${expectedHead}\tzaingulel/RentCottage\t${base}`,
      });
      expect(result.status).toBe(0);
      expect(result.outputs).toContain("check_run_id=9001");
      expect(result.calls).toHaveLength(2);
      expect(result.calls[0]).toContain("repos/zaingulel/RentCottage/pulls/88");
      expect(result.calls[1]).toContain(
        "repos/zaingulel/RentCottage/check-runs",
      );
      expect(result.calls[1]).toContain("name=quality");
      expect(result.calls[1]).toContain(`head_sha=${expectedHead}`);
      expect(result.calls[1]).toContain("status=in_progress");
    }
  });

  it("checks out the exact OID with pinned actions before stable verification", () => {
    const { workflow } = loadWorkflow();
    const quality = workflow.jobs.verify;

    const checkout = quality.steps.find(
      (step: { uses?: string }) => step.uses === "actions/checkout@v7",
    );
    expect(checkout).toBeUndefined();
    const pinnedCheckout = quality.steps.find(
      (step: { uses?: string }) =>
        step.uses ===
        "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    );
    expect(pinnedCheckout.with.ref).toBe("${{ inputs.expected_head_oid }}");
    expect(pinnedCheckout.with["persist-credentials"]).toBe(false);
    expect(
      quality.steps.some(
        (step: { uses?: string }) =>
          step.uses ===
          "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
      ),
    ).toBe(true);

    const qualityCommands = quality.steps
      .map((step: { run?: string }) => step.run)
      .filter(Boolean)
      .join("\n");
    expect(qualityCommands).not.toContain("gh api");
    expect(qualityCommands).toContain("npm ci");
    expect(qualityCommands).toContain(
      "npx playwright install --with-deps chromium",
    );
    expect(qualityCommands).toContain("npm run verify");
  });

  it("finalizes quality from a fresh exact-head pull-request read", () => {
    const { workflow } = loadWorkflow();
    const finalizer = workflow.jobs.finalize.steps.find(
      (step: { id?: string }) => step.id === "finalize",
    );
    expect(finalizer.if).toBeUndefined();

    const success = runWorkflowShell(finalizer.run, {
      CHECK_RUN_ID: "9001",
      VERIFY_RESULT: "success",
    });
    expect(success.status, JSON.stringify(success)).toBe(0);
    expect(success.calls.at(-1)).toContain("conclusion=success");

    const failedJob = runWorkflowShell(finalizer.run, {
      CHECK_RUN_ID: "9001",
      VERIFY_RESULT: "failure",
    });
    expect(failedJob.status).toBe(0);
    expect(failedJob.calls.at(-1)).toContain("conclusion=failure");

    const cancelledJob = runWorkflowShell(finalizer.run, {
      CHECK_RUN_ID: "9001",
      VERIFY_RESULT: "cancelled",
    });
    expect(cancelledJob.status).toBe(0);
    expect(cancelledJob.calls.at(-1)).toContain("conclusion=cancelled");

    const stale = runWorkflowShell(finalizer.run, {
      CHECK_RUN_ID: "9001",
      VERIFY_RESULT: "success",
      FAKE_PR_TSV: `open\t${"f".repeat(40)}\tzaingulel/RentCottage\tmain`,
      FAKE_FINAL_PR_TSV: `open\t${"f".repeat(40)}\tzaingulel/RentCottage`,
    });
    expect(stale.status).not.toBe(0);
    expect(stale.calls.at(-1)).toContain("conclusion=failure");

    const unavailable = runWorkflowShell(finalizer.run, {
      CHECK_RUN_ID: "9001",
      VERIFY_RESULT: "success",
      FAKE_PR_EXIT: "1",
    });
    expect(unavailable.status).not.toBe(0);
    expect(unavailable.calls.at(-1)).toContain("conclusion=failure");

    const closed = runWorkflowShell(finalizer.run, {
      CHECK_RUN_ID: "9001",
      VERIFY_RESULT: "success",
      FAKE_FINAL_PR_TSV: `closed\t${expectedHead}\tzaingulel/RentCottage`,
    });
    expect(closed.status).not.toBe(0);
    expect(closed.calls.at(-1)).toContain("conclusion=failure");

    const foreign = runWorkflowShell(finalizer.run, {
      CHECK_RUN_ID: "9001",
      VERIFY_RESULT: "success",
      FAKE_FINAL_PR_TSV: `open\t${expectedHead}\toutside/RentCottage`,
    });
    expect(foreign.status).not.toBe(0);
    expect(foreign.calls.at(-1)).toContain("conclusion=failure");

    const abandoned = runWorkflowShell(finalizer.run, {
      CHECK_RUN_ID: "",
      VERIFY_RESULT: "success",
    });
    expect(abandoned.status).not.toBe(0);
    expect(abandoned.calls).toEqual([]);

    const finalizationFailure = runWorkflowShell(finalizer.run, {
      CHECK_RUN_ID: "9001",
      VERIFY_RESULT: "success",
      FAKE_PATCH_EXIT: "1",
    });
    expect(finalizationFailure.status).not.toBe(0);
  });

  it("keeps preview manual", () => {
    const { workflow: previewWorkflow } = loadWorkflow(
      ".github/workflows/preview.yml",
    );

    expect(previewWorkflow.on.workflow_dispatch).toBeNull();
    expect(previewWorkflow.on.pull_request).toBeUndefined();
    expect(previewWorkflow.on.pull_request_review).toBeUndefined();
    expect(previewWorkflow.jobs.quality).toBeUndefined();

    const preview = previewWorkflow.jobs.preview;
    expect(preview.if).toBe("github.actor == github.repository_owner");
    expect(JSON.stringify(preview).toLowerCase()).not.toContain(
      retiredProvider,
    );
    expect(JSON.stringify(preview.env)).not.toContain("SUPABASE_");
    expect(JSON.stringify(preview.steps)).toContain(
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    );
    expect(JSON.stringify(preview.steps)).toContain(
      "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
    );
    expect(JSON.stringify(preview.steps)).toContain(
      "cloudflare/wrangler-action@ebbaa1584979971c8614a24965b4405ff95890e0",
    );
    const previewSetupNode = preview.steps.find(
      (step: { uses?: string }) =>
        step.uses ===
        "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
    );
    expect(previewSetupNode.with["package-manager-cache"]).toBe(false);
    expect(previewSetupNode.with.cache).toBeUndefined();
    const deploy = preview.steps.find(
      (step: { id?: string }) => step.id === "deploy",
    );
    const prepareSecrets = preview.steps.find(
      (step: { name?: string }) =>
        step.name === "Prepare preview deployment secrets",
    );
    expect(
      preview.steps.filter((step: { env?: Record<string, string> }) =>
        JSON.stringify(step.env ?? {}).includes("SUPABASE_SECRET_KEY"),
      ),
    ).toEqual([prepareSecrets]);
    expect(prepareSecrets.env.SUPABASE_SECRET_KEY).toBe(
      "${{ secrets.SUPABASE_SECRET_KEY }}",
    );
    expect(prepareSecrets.env.SUPABASE_PROJECT_REF).toBe(
      "${{ vars.SUPABASE_PROJECT_REF }}",
    );
    expect(prepareSecrets.env.SUPABASE_URL).toBe("${{ vars.SUPABASE_URL }}");
    expect(prepareSecrets.env.PRIVILEGED_AUDIT_HMAC_KEY).toBe(
      "${{ secrets.PRIVILEGED_AUDIT_HMAC_KEY }}",
    );
    expect(prepareSecrets.run).toContain("npm run verify:supabase-secret");
    expect(prepareSecrets.run).toContain(
      'node scripts/write-preview-deployment-secrets.mjs "$RUNNER_TEMP/muntajaa-preview-secrets.json"',
    );
    expect(prepareSecrets.run.indexOf("verify:supabase-secret")).toBeLessThan(
      prepareSecrets.run.indexOf("write-preview-deployment-secrets.mjs"),
    );
    expect(deploy.env).toBeUndefined();
    expect(deploy.with.secrets).toBeUndefined();
    expect(deploy.with.environment).toBe("preview");
    expect(deploy.with.command).toContain("deploy --env preview");
    expect(deploy.with.command).toContain(
      "--secrets-file ${{ runner.temp }}/muntajaa-preview-secrets.json",
    );
    expect(deploy.with.command).toContain("--tag ${{ github.sha }}");
    expect(deploy.with.command).toContain(
      "DEPLOYMENT_COMMIT:${{ github.sha }}",
    );
    expect(deploy.with.command).not.toContain("versions upload");
    expect(deploy.with.command).toContain(
      "SUPABASE_PROJECT_REF:${{ vars.SUPABASE_PROJECT_REF }}",
    );
    expect(deploy.with.command).toContain(
      "SUPABASE_URL:${{ vars.SUPABASE_URL }}",
    );
    expect(deploy.with.command).toContain(
      "SUPABASE_PUBLISHABLE_KEY:${{ vars.SUPABASE_PUBLISHABLE_KEY }}",
    );
    expect(JSON.stringify(preview.steps)).toContain("deploy --env preview");
    const cleanupSecrets = preview.steps.find(
      (step: { name?: string }) =>
        step.name === "Remove preview deployment secrets",
    );
    expect(cleanupSecrets.if).toBe("always()");
    expect(cleanupSecrets.run).toBe(
      'rm -f "$RUNNER_TEMP/muntajaa-preview-secrets.json"',
    );
    expect(preview.steps.indexOf(cleanupSecrets)).toBeGreaterThan(
      preview.steps.indexOf(deploy),
    );
    const deploymentVerification = preview.steps.find(
      (step: { name?: string }) =>
        step.name === "Verify active Cloudflare version",
    );
    expect(deploymentVerification.env.CLOUDFLARE_API_TOKEN).toBe(
      "${{ secrets.CLOUDFLARE_API_TOKEN }}",
    );
    expect(deploymentVerification.env.CLOUDFLARE_ACCOUNT_ID).toBe(
      "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
    );
    expect(deploymentVerification.run).toBe(
      'npm run verify:cloudflare-deployment -- preview "${{ github.sha }}"',
    );
    expect(preview.steps.indexOf(cleanupSecrets)).toBeLessThan(
      preview.steps.indexOf(deploymentVerification),
    );
    const previewVerification = preview.steps.find(
      (step: { name?: string }) => step.name === "Verify Cloudflare preview",
    );
    expect(previewVerification.env.PREVIEW_URL).toBe(
      "${{ steps.deploy.outputs.deployment-url }}",
    );
    expect(previewVerification.run).toBe(
      'npm run verify:preview -- "$PREVIEW_URL"',
    );
  });

  it("keeps every Cloudflare deployment target on the owner-approved Muntajaa name", () => {
    const wrangler = readFileSync(resolve("wrangler.jsonc"), "utf8");

    expect(wrangler).toContain('"name": "muntajaa-development"');
    expect(wrangler).toContain('"name": "muntajaa-test"');
    expect(wrangler).toContain('"name": "muntajaa-preview"');
    expect(wrangler).toContain('"name": "muntajaa-production"');
    expect(wrangler).not.toMatch(/"name": "rentcottage-/);
    expect(wrangler).not.toMatch(/"preview":\s*\{[^}]*"keep_vars"/s);
  });
});
