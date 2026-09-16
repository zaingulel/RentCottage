// @vitest-environment node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
      needs?: string[];
      "runs-on"?: string;
      "timeout-minutes"?: number;
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

// A sentinel no job result can take, so "absent" stays distinct from "empty".
const UNSET = "@unset";

// Not a tab: tab is IFS whitespace, so bash folds a run of tabs into one delimiter and
// an empty result shifts every later field left. The unit separator is not whitespace.
const SEPARATOR = "\x1f";

// Reads one combination per line and prints back the values it actually read with the
// exit status they produced. Echoing the values, not the input line number, makes a
// garbled combination key its own result rather than masquerade as the intended one.
// The body is sourced under `set -e`, as the workflow's default `bash -e` shell runs
// it, so its `exit 1` leaves the subshell exactly as it leaves `bash -c`.
const DRIVER = [
  "while IFS=$'\\x1f' read -r baseline database browser; do",
  `  ( if [[ "$baseline" == "${UNSET}" ]]; then unset BASELINE_RESULT; else export BASELINE_RESULT="$baseline"; fi`,
  `    if [[ "$database" == "${UNSET}" ]]; then unset DATABASE_RESULT; else export DATABASE_RESULT="$database"; fi`,
  `    if [[ "$browser" == "${UNSET}" ]]; then unset BROWSER_RESULT; else export BROWSER_RESULT="$browser"; fi`,
  "    set -e",
  "    set -o pipefail",
  '    . "$AGGREGATE_SCRIPT" ) >/dev/null 2>&1',
  `  printf '%s\\x1f%s\\x1f%s\\x1f%s\\n' "$baseline" "$database" "$browser" "$?"`,
  "done",
].join("\n");

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

    expect(Object.keys(jobs)).toEqual([
      "baseline",
      "database",
      "browser",
      "test",
    ]);
    expect(jobs.test.name).toBe(
      "${{ github.event.pull_request.draft == false && 'test' || 'ci-control-no-test' }}",
    );
    expect(jobs.test.if).toBe("${{ always() }}");
    expect(jobs.test.needs).toEqual(["baseline", "database", "browser"]);
    expect(jobs.test["timeout-minutes"]).toBe(5);
    expect(jobs.test.permissions).toEqual({ contents: "read" });

    const steps = jobs.test.steps ?? [];
    expect(steps).toContainEqual({
      name: "Record a draft without exposing the required check",
      if: "github.event.pull_request.draft == true",
      run: expect.stringContaining("no check named test"),
    });
    expect(readySteps(steps)).toHaveLength(1);
    expect(steps).toHaveLength(2);
  });

  it.each(["baseline", "database", "browser"])(
    "independently tests GitHub's merge result through the %s verification command",
    (mode) => {
      const { source, workflow } = loadWorkflow();
      const job = workflow.jobs?.[mode];
      expect(job?.if).toBe("github.event.pull_request.draft == false");
      expect(job?.needs).toBeUndefined();
      expect(job?.["runs-on"]).toBe("ubuntu-latest");
      expect(job?.["timeout-minutes"]).toBe(60);
      const steps = job?.steps ?? [];
      expect(steps).toHaveLength(4);
      expect(steps.every((step) => step.if === undefined)).toBe(true);
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
        ref: "${{ github.sha }}",
        "fetch-depth": 0,
        "persist-credentials": false,
      });
      expect(setupNode).toBeDefined();
      expect(setupNode?.with).toEqual({
        "node-version-file": ".nvmrc",
        cache: "npm",
      });
      expect(steps).toContainEqual(expect.objectContaining({ run: "npm ci" }));
      expect(steps).toContainEqual(
        expect.objectContaining({
          env: {
            VERIFY_BASE_SHA: "${{ github.event.pull_request.base.sha }}",
            VERIFY_SOURCE_SHA: "${{ github.event.pull_request.head.sha }}",
          },
          run: `npm run verify -- --${mode}`,
        }),
      );
      expect(source).not.toContain("npx playwright install");

      expect(source).not.toContain("workflow_dispatch");
      expect(source).not.toContain("check-runs");
      expect(source).not.toContain("pull_request_number");
      expect(source).not.toContain("expected_head_oid");
      expect(source).not.toContain("${{ secrets.");
    },
  );

  // The budget sits far above the work: this asserts which exit status each combination
  // produces, never how fast a subprocess returns, so load must not be able to fail it
  // (#294).
  it("accepts only complete successful evidence in the actual aggregate shell", () => {
    const { workflow } = loadWorkflow();
    const aggregate = readySteps(workflow.jobs?.test.steps ?? [])[0];
    expect(aggregate?.env).toEqual({
      BASELINE_RESULT: "${{ needs.baseline.result }}",
      DATABASE_RESULT: "${{ needs.database.result }}",
      BROWSER_RESULT: "${{ needs.browser.result }}",
    });
    expect(aggregate?.run).toBeTypeOf("string");
    const results = [
      "success",
      "failure",
      "cancelled",
      "skipped",
      "",
      undefined,
    ];
    const combinations: {
      baseline?: string;
      database?: string;
      browser?: string;
    }[] = [];
    for (const baseline of results) {
      for (const database of results) {
        for (const browser of results) {
          combinations.push({ baseline, database, browser });
        }
      }
    }

    // Every combination still runs the real step body, but as a subshell inside one
    // bash rather than its own `bash -c`, so the cost is a fork per combination and
    // not an exec of the bash binary (#294).
    const directory = mkdtempSync(join(tmpdir(), "aggregate-shell-"));
    const script = join(directory, "aggregate.sh");
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.BASELINE_RESULT;
    delete env.DATABASE_RESULT;
    delete env.BROWSER_RESULT;
    env.AGGREGATE_SCRIPT = script;
    const cell = (value?: string) => (value === undefined ? UNSET : value);
    // Keyed through `cell` because `JSON.stringify` drops an undefined-valued key, so a
    // raw label could never match the `@unset` the shell echoes back.
    const label = ({
      baseline,
      database,
      browser,
    }: (typeof combinations)[number]) =>
      JSON.stringify({
        baseline: cell(baseline),
        database: cell(database),
        browser: cell(browser),
      });
    let statuses: Record<string, number>;
    try {
      writeFileSync(script, aggregate.run as string);
      const result = spawnSync(
        "bash",
        ["--noprofile", "--norc", "-c", DRIVER],
        {
          encoding: "utf8",
          env,
          // Trailing newline: `read` reports failure on an unterminated final line
          // and the loop would skip the last combination.
          input: `${combinations
            .map(({ baseline, database, browser }) =>
              [cell(baseline), cell(database), cell(browser)].join(SEPARATOR),
            )
            .join("\n")}\n`,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.stderr).toBe("");
      statuses = Object.fromEntries(
        result.stdout
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => {
            const [baseline, database, browser, status] = line.split(SEPARATOR);
            return [
              JSON.stringify({ baseline, database, browser }),
              Number(status),
            ];
          }),
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }

    expect(statuses).toEqual(
      Object.fromEntries(
        combinations.map((combination) => [
          label(combination),
          combination.baseline === "success" &&
          combination.database === "success" &&
          combination.browser === "success"
            ? 0
            : 1,
        ]),
      ),
    );
  }, 30_000);
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
