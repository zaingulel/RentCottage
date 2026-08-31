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
const retiredStackProvider = ["graph", "ite"].join("");
const retiredLegacyProvider = ["code", "rabbit"].join("");
const retiredRouteLabel = ["graph", "ite", "-review"].join("");

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

function sectionUnder(source: string, heading: string) {
  const startMarker = `${heading}\n`;
  const start = source.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`Missing Markdown heading: ${heading}`);
  }

  const contentStart = start + startMarker.length;
  const remaining = source.slice(contentStart);
  const nextHeading = remaining.search(/^#{1,6} /m);
  return nextHeading === -1 ? remaining : remaining.slice(0, nextHeading);
}

function parseMarkdownTable(source: string, heading: string) {
  const section = sectionUnder(source, heading);
  const lines = section.split("\n");
  const tableStart = lines.findIndex((line) => line.trim().startsWith("|"));
  if (tableStart === -1) {
    throw new Error(`Missing Markdown table under: ${heading}`);
  }

  const tableEnd = lines.findIndex(
    (line, index) => index > tableStart && !line.trim().startsWith("|"),
  );
  const tableLines = lines.slice(
    tableStart,
    tableEnd === -1 ? undefined : tableEnd,
  );
  const cells = tableLines.map((line) =>
    line
      .trim()
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim()),
  );
  if (
    cells.length < 3 ||
    cells[1].some((cell) => !/^:?-{3,}:?$/.test(cell)) ||
    cells.some((row) => row.length !== cells[0].length)
  ) {
    throw new Error(`Malformed Markdown table under: ${heading}`);
  }

  return { headers: cells[0], rows: cells.slice(2) };
}

function parseNumberedSequence(source: string, heading: string) {
  return sectionUnder(source, heading)
    .split("\n")
    .map((line) => line.match(/^(\d+)\. \*\*([^*]+):\*\* (.+)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      number: Number(match[1]),
      label: match[2],
      text: match[3],
    }));
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
  if [[ -n "\${CHECK_RUN_ID:-}" ]]; then
    printf '%s\\n' "\${FAKE_FINAL_PR_TSV:-}"
  else
    printf '%s\\n' "\${FAKE_VALIDATION_PR_TSV:-}"
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
      FAKE_VALIDATION_PR_TSV: `open\t${expectedHead}\tzaingulel/RentCottage\tmain`,
      FAKE_FINAL_PR_TSV: `open\t${expectedHead}\tzaingulel/RentCottage\tmain`,
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
  it("defines Greptile as the sole best-effort external reviewer", () => {
    const agents = readFileSync(resolve("AGENTS.md"), "utf8");
    const policy = sectionUnder(agents, "### External review");

    expect(policy).toContain("Greptile is the sole external reviewer");
    expect(policy).toContain("best-effort");
    expect(policy).toContain("exact current pull-request head");
    expect(policy).toContain("`COMPLETE` or `UNAVAILABLE`");
    expect(policy).toContain("does not relax or replace");
    expect(policy).toContain(
      "No paid plan, billing change, purchase, or upgrade",
    );
    expect(agents).toContain(
      "settled Greptile attempt state and concise supporting evidence",
    );
    expect(agents).toContain(
      "finished implementation bundle and locally knowable evidence in one delivery packet",
    );
    expect(agents).not.toContain("two evidence stages");
  });

  it("keeps security review scoped to classification and managed review", () => {
    const agents = readFileSync(resolve("AGENTS.md"), "utf8");
    const securityReview = readFileSync(
      resolve(".agents/skills/security-code-review/SKILL.md"),
      "utf8",
    );
    const delivery = readFileSync(resolve("docs/agents/delivery.md"), "utf8");

    expect(securityReview).toContain("substantive finished RentCottage change");
    expect(securityReview).toContain(
      "report the aggregate `UNKNOWN`, `ANY_YES`, or `ALL_NO` to the coordinator",
    );
    expect(securityReview).toContain(
      "does not operate Greptile, change provider configuration, or broaden the managed review",
    );
    expect(securityReview).toContain(
      "If every classification is `NO`, invoke those managed Standards and Spec contracts unchanged",
    );
    expect(securityReview).toContain(
      "If any classification is `YES`, spawn the managed Standards and Spec reviewers together with the configured `security_reviewer`",
    );

    expect(agents).not.toContain("### External-review route");
    expect(securityReview).not.toContain("| Security input |");
    expect(delivery).not.toContain("| Security input |");
    expect(securityReview).toContain(
      "Greptile `UNAVAILABLE` never relaxes an internal review, executable verification, Continuous Integration, conversation, ownership, tracker, merge, or release gate",
    );
  });

  it("uses ordinary GitHub delivery and records one settled Greptile attempt", () => {
    const delivery = readFileSync(resolve("docs/agents/delivery.md"), "utf8");
    const sequence = parseNumberedSequence(
      delivery,
      "## External review and exact-head quality",
    );
    const stateTable = parseMarkdownTable(
      delivery,
      "### Greptile attempt states",
    );

    expect(sequence.map(({ number, label }) => ({ number, label }))).toEqual([
      { number: 1, label: "Create draft" },
      { number: 2, label: "Publish" },
      { number: 3, label: "Attempt Greptile" },
      { number: 4, label: "Fresh exact-head internal review" },
      { number: 5, label: "Exact-head quality" },
    ]);
    expect(sequence[0].text).toContain("`git commit -m <MESSAGE>`");
    expect(sequence[0].text).toContain(
      "`git push origin refs/heads/<LOCAL_TOPIC_BRANCH>:refs/heads/<PR_HEAD_BRANCH>`",
    );
    expect(sequence[0].text).toContain("exact pushed commit OID");
    expect(sequence[0].text).toContain(
      "`gh pr create --repo zaingulel/RentCottage --draft --base main --head zaingulel:<PR_HEAD_BRANCH> --title <TITLE> --body-file /absolute/path/to/approved-pr-body.md --label independent-review`",
    );
    expect(sequence[0].text).toContain("exact pushed head");
    expect(sequence[0].text).toContain("current remote branch metadata");
    expect(sequence[1].text).toContain("freshly read");
    expect(sequence[1].text).toContain("same repository");
    expect(sequence[1].text).toContain("`isCrossRepository=false`");
    expect(sequence[1].text).toContain("draft");
    expect(sequence[1].text).toContain("base `main`");
    expect(sequence[1].text).toContain("exact head");
    expect(sequence[1].text).toContain("exactly `independent-review`");
    expect(sequence[1].text).toContain(
      "`gh pr view <PR_NUMBER> --repo zaingulel/RentCottage --json",
    );
    expect(sequence[1].text).toContain(
      "`gh pr ready <PR_NUMBER> --repo zaingulel/RentCottage`",
    );
    expect(sequence[2].text).toContain("`head=CURRENT_PR_HEAD`");
    expect(sequence[2].text).toContain("`COMPLETE` or `UNAVAILABLE`");
    expect(sequence[3].text).toContain("`after=settled Greptile attempt`");
    expect(sequence[3].text).toContain("`security-code-review`");
    expect(sequence[3].text).toContain("exact pushed head");
    expect(sequence[3].text).toContain(
      "entirely fresh Standards and Specification reviewers",
    );
    expect(sequence[3].text).toContain("fresh Security reviewer");
    expect(sequence[3].text).toContain(
      "Pre-outward review verdicts are ineligible",
    );
    expect(sequence[4].text).toContain(
      "`after=fresh exact-head internal review`",
    );
    expect(sequence[4].text).toContain("required local verification");
    expect(sequence[4].text).toContain(
      "`gh workflow run ci.yml --repo zaingulel/RentCottage --ref main -f pull_request_number=<PR_NUMBER> -f expected_head_oid=<CURRENT_PR_HEAD>`",
    );

    expect(stateTable).toEqual({
      headers: ["State", "Required evidence"],
      rows: [
        [
          "`COMPLETE`",
          "An exact-current-head completion artifact that identifies Greptile's installed GitHub App as actor and source, its provider-produced GitHub artifact URL, complete changed-file coverage, and an evidence-based disposition for every finding.",
        ],
        [
          "`UNAVAILABLE`",
          "Exactly one reason: `ALLOWANCE_EXHAUSTED`, `PROVIDER_UNAVAILABLE`, or `NO_EXACT_HEAD_COMPLETION`; the attempted and current head; observation time and source; artifact or exact error; and owner/coordinator notice.",
        ],
      ],
    });
    expect(delivery).toContain(
      "Partial or incomplete exact-head coverage is `UNAVAILABLE` with reason `NO_EXACT_HEAD_COMPLETION`",
    );
    expect(delivery).toContain("changed, reviewed, and missing files");
    expect(delivery).toContain(
      "dispositions for every finding that was emitted",
    );
    expect(delivery).toContain(
      "Missing, unknown, stale, or unattributed attempt evidence stops delivery",
    );
    expect(delivery).toContain(
      "Self-authored, wrong-provider, missing, untrusted, or unattributed artifacts cannot be `COMPLETE` and stop delivery",
    );
    expect(delivery).toContain(
      "A push invalidates Greptile, internal-review, and Continuous Integration evidence",
    );
    expect(delivery).toContain(
      "A repair push receives a fresh exact-head Greptile attempt when allowance permits, or a new exact-head `UNAVAILABLE` record otherwise",
    );
    expect(delivery).toContain(
      "Every repair uses an ordinary Git commit and `git push origin refs/heads/<LOCAL_TOPIC_BRANCH>:refs/heads/<PR_HEAD_BRANCH>`",
    );
    expect(delivery).toContain(
      "restarts the exact-head Greptile attempt, `security-code-review` classification, entirely new internal reviewers, and exact-head quality",
    );
    expect(delivery).toContain(
      "No paid plan, billing change, purchase, or upgrade",
    );

    const scopedSources = [
      "AGENTS.md",
      "docs/agents/delivery.md",
      ".agents/skills/security-code-review/SKILL.md",
      "docs/adr/0001-cloudflare-workers-supabase-stack.md",
      "docs/commercial/muntajaa-cost-plan.md",
      ".github/workflows/ci.yml",
      "src/ci/workflow.test.ts",
    ].map((path) => readFileSync(resolve(path), "utf8").toLowerCase());
    for (const source of scopedSources) {
      for (const retiredProvider of [
        retiredStackProvider,
        retiredLegacyProvider,
      ]) {
        expect(source).not.toContain(retiredProvider);
      }
      expect(source).not.toContain(retiredRouteLabel);
    }
  });

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
    expect(delivery).toContain("Required inputs at start:");
    expect(delivery).toContain("Acquired during delivery:");
    expect(delivery).toContain("Stop conditions:");
    expect(delivery).toContain("Next route:");
    const route = sectionUnder(delivery, "## Route");
    const requiredInputs = route
      .split("\n")
      .find((line) => line.startsWith("- **Required inputs at start:**"));
    const acquiredEvidence = route
      .split("\n")
      .find((line) => line.startsWith("- **Acquired during delivery:**"));

    expect(requiredInputs).toContain("owner-approved finished bundle");
    expect(requiredInputs).toContain("exact authorised actions");
    expect(requiredInputs).toContain("issue identity");
    expect(requiredInputs).toContain(
      "absolute registered secondary-worktree path",
    );
    expect(requiredInputs).toContain("exact local topic branch");
    expect(requiredInputs).toContain("stopped-writer ownership evidence");
    expect(requiredInputs).not.toMatch(
      /commit Object ID|pushed head|pull-request identity|Greptile|internal review|quality|merge/i,
    );

    for (const evidence of [
      "materialized commit Object ID",
      "current pushed-head Object ID",
      "remote branch metadata",
      "pull-request identity and state",
      "settled exact-head Greptile attempt",
      "fresh exact-head internal reviews",
      "exact-head quality",
      "merge",
      "tracker reconciliation",
      "terminal release",
    ]) {
      expect(acquiredEvidence).toContain(evidence);
    }
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

  it("retains semantic owner approval through its authorized delivery sequence", () => {
    const agents = readFileSync(resolve("AGENTS.md"), "utf8");
    const delivery = readFileSync(resolve("docs/agents/delivery.md"), "utf8");
    const approval = sectionUnder(
      delivery,
      "### Approval scope and persistence",
    );
    const ownerDecisions = sectionUnder(
      agents,
      "### Owner decisions and evidence",
    );

    for (const contract of [
      "semantic, contextual, cumulative, and persistent",
      "no prescribed phrase",
      "clear contextual directive or request authorises the outward actions it names",
      "clear affirmative response authorises the exact coordinator-proposed action list",
      "Incidental, hypothetical, or capability-only mentions do not authorise outward action",
      "latest clear owner instruction supersedes earlier narrower coordinator wording",
      "without asking the owner to repeat or restate approval",
      "Time passing and progress between delivery stages do not make approval stale",
      "The ordinary commit of the unchanged approved finished bundle materializes `CURRENT_PR_HEAD` and does not make approval stale",
      "A materially altered bundle or any later head not freshly validated against the approved finished bundle makes approval stale and stops delivery",
      "must not add an exclusion such as `No merge` unless the owner requested it",
      "tracker reconciliation and guarded terminal release continue automatically under the same approval",
    ]) {
      expect(approval).toContain(contract);
    }

    const staleConditions = [
      "the approved finished bundle or scope changes materially;",
      "a later head has not been freshly validated against the approved finished bundle;",
      "a new unresolved finding appears;",
      "a required safety, ownership, review, or Continuous Integration gate fails;",
      "the owner withdraws or narrows approval.",
    ];
    for (const condition of staleConditions) {
      expect(approval).toContain(`- ${condition}`);
    }
    expect(approval.match(/^- /gm)).toHaveLength(staleConditions.length);

    expect(ownerDecisions).toContain(
      "Delivery approval must explicitly authorise outward action",
    );
    expect(ownerDecisions).toContain(
      "semantic and persistent approval scope and staleness",
    );
    expect(ownerDecisions).toContain("docs/agents/delivery.md");
    expect(ownerDecisions).not.toContain("capability-only");
    expect(ownerDecisions).toContain(
      "review the finished implementation bundle and locally knowable evidence in one delivery packet before any commit or outward action",
    );
    expect(ownerDecisions).toContain(
      "The same delivery packet is progressively completed with evidence acquired during delivery",
    );
    expect(ownerDecisions).toContain(
      "No second routine owner approval is required while the original approval remains current",
    );

    const externalReview = sectionUnder(agents, "### External review");
    const ownerApprovedDelivery = sectionUnder(
      delivery,
      "## Owner-approved delivery",
    );
    const deliveryPacket = sectionUnder(
      delivery,
      "## Delivery packet and maintenance evidence",
    );
    for (const authority of [ownerDecisions, externalReview]) {
      expect(authority).toContain("same delivery packet");
    }
    expect(ownerApprovedDelivery).toContain(
      "one delivery packet containing the finished implementation bundle and locally knowable evidence",
    );
    expect(ownerApprovedDelivery).toContain(
      "The same packet progressively gains the evidence acquired during delivery",
    );
    expect(deliveryPacket).toContain(
      "The same delivery packet is progressively completed",
    );
    for (const authority of [agents, delivery]) {
      expect(authority).toContain(
        "does not create a second record or staged manifest",
      );
    }
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

    expect(ciSource.toLowerCase()).not.toContain(retiredStackProvider);
    expect(ciSource.toLowerCase()).not.toContain(retiredLegacyProvider);
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

  it("documents ordinary GitHub merge and source-bound quality enforcement", () => {
    const delivery = readFileSync(resolve("docs/agents/delivery.md"), "utf8");
    const architecture = readFileSync(
      resolve("docs/adr/0001-cloudflare-workers-supabase-stack.md"),
      "utf8",
    );

    expect(delivery).toContain(
      "`gh pr merge <PR_NUMBER> --repo zaingulel/RentCottage --squash --match-head-commit <CURRENT_PR_HEAD>`",
    );
    expect(delivery).toContain(
      "`gh pr view <PR_NUMBER> --repo zaingulel/RentCottage --json",
    );
    const publish = parseNumberedSequence(
      delivery,
      "## External review and exact-head quality",
    )[1].text;
    const preMerge = delivery.slice(delivery.indexOf("Before merge,"));
    expect(publish).toContain("isCrossRepository");
    expect(publish).toContain("`isCrossRepository=false`");
    expect(preMerge).toContain("isCrossRepository");
    expect(preMerge).toContain("`isCrossRepository=false`");
    expect(delivery).toContain("Do not use `--admin`");
    for (const authority of [delivery, architecture]) {
      expect(authority).toContain("observed GitHub Actions source");
      expect(authority).toContain("not the `quality` check name alone");
    }
  });

  it("keeps the commercial delivery-review allowance at the settled zero-cost policy", () => {
    const commercial = readFileSync(
      resolve("docs/commercial/muntajaa-cost-plan.md"),
      "utf8",
    );
    const monthlyCosts = parseMarkdownTable(
      commercial,
      "### 2.1 Core monthly costs",
    );
    const annualCosts = parseMarkdownTable(
      commercial,
      "### 2.4 Annual and one-off costs",
    );
    const greptileCost = monthlyCosts.rows.find(
      ([cost]) => cost === "Greptile external review",
    );
    const greptileLines = commercial
      .split("\n")
      .filter((line) => line.includes("Greptile"))
      .join("\n");
    const greptileCostRows = [...monthlyCosts.rows, ...annualCosts.rows].filter(
      ([cost]) => cost.includes("Greptile"),
    );

    expect(commercial).toContain("**$234/month**");
    expect(commercial).toContain("**$230/month**");
    expect(greptileCost).toEqual([
      "Greptile external review",
      "**$0 working assumption**",
      "Working assumption",
      "Use best-effort while the free allowance is available. Exhausted or unavailable access is reported. No paid plan, overage, billing change, purchase, or upgrade without explicit owner approval",
    ]);
    expect(greptileCostRows).toEqual([greptileCost]);
    expect(greptileLines).not.toMatch(
      /trial|hobby|credit|cadence|live billing|renewal|monthly|annual/i,
    );
    expect(greptileLines).toContain(
      "No paid plan, overage, billing change, purchase, or upgrade without explicit owner approval",
    );
    expect(commercial.toLowerCase()).not.toContain(retiredStackProvider);
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

  it("rejects unavailable, closed, foreign, stale, and every non-main base before creating quality", () => {
    const { workflow } = loadWorkflow();
    const validation = workflow.jobs.validate.steps.find(
      (step: { id?: string }) => step.id === "validate",
    );
    const invalidEvidence: Record<string, string>[] = [
      { FAKE_PR_EXIT: "1" },
      {
        FAKE_VALIDATION_PR_TSV: `closed\t${expectedHead}\tzaingulel/RentCottage\tmain`,
      },
      {
        FAKE_VALIDATION_PR_TSV: `open\t${expectedHead}\toutside/RentCottage\tmain`,
      },
      {
        FAKE_VALIDATION_PR_TSV: `open\t${"f".repeat(40)}\tzaingulel/RentCottage\tmain`,
      },
      {
        FAKE_VALIDATION_PR_TSV: `open\t${expectedHead}\tzaingulel/RentCottage\ttopic/base`,
      },
      {
        FAKE_VALIDATION_PR_TSV: `open\t${expectedHead}\tzaingulel/RentCottage\trelease`,
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

  it("accepts only a main-based pull request and creates quality on the exact head", () => {
    const { workflow } = loadWorkflow();
    const validation = workflow.jobs.validate.steps.find(
      (step: { id?: string }) => step.id === "validate",
    );

    const result = runWorkflowShell(validation.run, {});
    expect(result.status).toBe(0);
    expect(result.outputs).toContain("check_run_id=9001");
    expect(result.calls).toHaveLength(2);
    expect(result.calls[0]).toContain("repos/zaingulel/RentCottage/pulls/88");
    expect(result.calls[1]).toContain("repos/zaingulel/RentCottage/check-runs");
    expect(result.calls[1]).toContain("name=quality");
    expect(result.calls[1]).toContain(`head_sha=${expectedHead}`);
    expect(result.calls[1]).toContain("status=in_progress");
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
      FAKE_VALIDATION_PR_TSV: `open\t${expectedHead}\tzaingulel/RentCottage\tmain`,
      FAKE_FINAL_PR_TSV: `open\t${"f".repeat(40)}\tzaingulel/RentCottage\tmain`,
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
      FAKE_FINAL_PR_TSV: `closed\t${expectedHead}\tzaingulel/RentCottage\tmain`,
    });
    expect(closed.status).not.toBe(0);
    expect(closed.calls.at(-1)).toContain("conclusion=failure");

    const foreign = runWorkflowShell(finalizer.run, {
      CHECK_RUN_ID: "9001",
      VERIFY_RESULT: "success",
      FAKE_FINAL_PR_TSV: `open\t${expectedHead}\toutside/RentCottage\tmain`,
    });
    expect(foreign.status).not.toBe(0);
    expect(foreign.calls.at(-1)).toContain("conclusion=failure");

    const retargeted = runWorkflowShell(finalizer.run, {
      CHECK_RUN_ID: "9001",
      VERIFY_RESULT: "success",
      FAKE_VALIDATION_PR_TSV: `open\t${expectedHead}\tzaingulel/RentCottage\tmain`,
      FAKE_FINAL_PR_TSV: `open\t${expectedHead}\tzaingulel/RentCottage\ttopic/base`,
    });
    expect(retargeted.status).not.toBe(0);
    expect(retargeted.calls.at(-1)).toContain("conclusion=failure");

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
      retiredStackProvider,
    );
    expect(JSON.stringify(preview).toLowerCase()).not.toContain(
      retiredLegacyProvider,
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
