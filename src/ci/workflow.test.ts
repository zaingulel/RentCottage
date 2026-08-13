// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const approvedReview = {
  review: {
    state: "approved",
    commit_id: "current-head",
    user: { login: "coderabbitai[bot]", id: 136622811 },
  },
  pull_request: {
    number: 53,
    head: {
      sha: "current-head",
      ref: "codex/issue-19-trilingual-shell",
      repo: { full_name: "zaingulel/RentCottage" },
    },
  },
  repository: { full_name: "zaingulel/RentCottage" },
};

function routeConditionMatches(
  condition: string,
  event: typeof approvedReview,
) {
  const expression = condition
    .replace(/^\$\{\{\s*/, "")
    .replace(/\s*\}\}$/, "")
    .replaceAll("github.event.", "event.")
    .replaceAll("github.repository", "repository");

  return runInNewContext(expression, {
    event,
    repository: event.repository.full_name,
  }) as boolean | string;
}

const normalizedExpression = (value: string) =>
  value.replace(/\s+/g, " ").trim();

describe("GitHub Actions delivery checks", () => {
  it("makes CodeRabbit approval the CI sequencing signal without waiting on GitHub Checks", () => {
    const codeRabbit = parse(readFileSync(resolve(".coderabbit.yaml"), "utf8"));

    expect(codeRabbit.reviews.request_changes_workflow).toBe(true);
    expect(
      codeRabbit.reviews.auto_review.auto_pause_after_reviewed_commits,
    ).toBe(0);
    expect(codeRabbit.reviews.tools["github-checks"].enabled).toBe(false);
    expect(codeRabbit.reviews.pre_merge_checks.docstrings.mode).toBe("off");
  });

  it("runs pinned quality only for exact CodeRabbit approval and keeps preview manual", () => {
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

    const workflow = parse(
      readFileSync(resolve(".github/workflows/ci.yml"), "utf8"),
    );
    expect(workflow.on.pull_request_review.types).toEqual(["submitted"]);
    expect(workflow.on.pull_request).toBeUndefined();
    expect(workflow.on.workflow_dispatch).toBeUndefined();
    expect(workflow.concurrency).toBeUndefined();

    const quality = workflow.jobs.quality;
    expect(quality.concurrency.group).toBe(
      "quality-${{ github.event.pull_request.number }}",
    );
    expect(quality.concurrency["cancel-in-progress"]).toBe(true);

    const routeCondition = quality.if.trim();
    const jobNameCondition = quality.name
      .replace(/^\$\{\{\s*/, "")
      .replace(/\s*&&\s*'quality'\s*\|\|\s*'review-router'\s*\}\}$/, "")
      .trim();
    expect(normalizedExpression(jobNameCondition)).toBe(
      normalizedExpression(routeCondition),
    );
    expect(routeConditionMatches(routeCondition, approvedReview)).toBe(true);
    expect(routeConditionMatches(quality.name, approvedReview)).toBe("quality");
    expect(
      routeConditionMatches(routeCondition, {
        ...approvedReview,
        review: {
          ...approvedReview.review,
          user: { login: "helpful-human", id: 42 },
        },
      }),
    ).toBe(false);
    expect(
      routeConditionMatches(quality.name, {
        ...approvedReview,
        review: {
          ...approvedReview.review,
          user: { login: "helpful-human", id: 42 },
        },
      }),
    ).toBe("review-router");
    const nonMatchingReviews = [
      {
        ...approvedReview,
        review: { ...approvedReview.review, state: "changes_requested" },
      },
      {
        ...approvedReview,
        review: { ...approvedReview.review, commit_id: "previous-head" },
      },
      {
        ...approvedReview,
        pull_request: {
          ...approvedReview.pull_request,
          head: {
            ...approvedReview.pull_request.head,
            repo: { full_name: "outside-contributor/RentCottage" },
          },
        },
      },
    ];
    for (const review of nonMatchingReviews) {
      expect(routeConditionMatches(routeCondition, review)).toBe(false);
      expect(routeConditionMatches(quality.name, review)).toBe("review-router");
    }

    expect(workflow.permissions).toEqual({
      contents: "read",
      "pull-requests": "read",
    });
    expect(JSON.stringify(quality)).not.toContain("secrets.");
    expect(quality.env.SUPABASE_SECRET_KEY).not.toBe(
      quality.env.SUPABASE_PUBLISHABLE_KEY,
    );

    const checkout = quality.steps.find(
      (step: { uses?: string }) => step.uses === "actions/checkout@v7",
    );
    expect(checkout.with.ref).toBe("${{ github.event.pull_request.head.sha }}");
    expect(checkout.with["persist-credentials"]).toBe(false);
    expect(
      quality.steps.some(
        (step: { uses?: string }) => step.uses === "actions/setup-node@v6",
      ),
    ).toBe(true);

    const liveHead = quality.steps.find(
      (step: { name?: string }) => step.name === "Require current PR head",
    );
    expect(liveHead.env.GH_TOKEN).toBe("${{ github.token }}");
    expect(liveHead.env.EXPECTED_HEAD_SHA).toBe(
      "${{ github.event.pull_request.head.sha }}",
    );
    expect(liveHead.env.PULL_REQUEST_NUMBER).toBe(
      "${{ github.event.pull_request.number }}",
    );
    expect(liveHead.run).toContain("gh api");
    expect(liveHead.run).toContain('test "$live_head" = "$EXPECTED_HEAD_SHA"');

    const qualityCommands = quality.steps
      .map((step: { run?: string }) => step.run)
      .filter(Boolean)
      .join("\n");
    expect(qualityCommands).not.toContain("coderabbit");
    expect(qualityCommands.indexOf("gh api")).toBeLessThan(
      qualityCommands.indexOf("npm ci"),
    );
    expect(qualityCommands).toContain("npm run format:check");
    expect(qualityCommands).toContain("npm run audit:production");
    expect(qualityCommands).toContain("npm run lint");
    expect(qualityCommands).toContain("npm run typecheck");
    expect(qualityCommands).toContain("npm test");
    expect(qualityCommands).toContain("npm run test:browser");
    expect(qualityCommands).toContain("npm run build:worker");
    expect(qualityCommands).toContain("npm run scan:client-secrets");
    expect(qualityCommands).toContain("npm run smoke:preview");

    expect(qualityCommands.indexOf("npm run build:worker")).toBeLessThan(
      qualityCommands.indexOf("npm run cf-typegen"),
    );
    expect(qualityCommands.indexOf("npm run build:worker")).toBeLessThan(
      qualityCommands.indexOf("npm run scan:client-secrets"),
    );
    expect(qualityCommands).toContain(
      "git diff --exit-code --ignore-space-at-eol -- cloudflare-env.d.ts",
    );

    expect(workflow.jobs.preview).toBeUndefined();

    const previewWorkflow = parse(
      readFileSync(resolve(".github/workflows/preview.yml"), "utf8"),
    );
    expect(previewWorkflow.on.workflow_dispatch).toBeNull();
    expect(previewWorkflow.on.pull_request).toBeUndefined();
    expect(previewWorkflow.on.pull_request_review).toBeUndefined();
    expect(previewWorkflow.jobs.quality).toBeUndefined();

    const preview = previewWorkflow.jobs.preview;
    expect(preview.if).toBe("github.actor == github.repository_owner");
    expect(JSON.stringify(preview)).not.toContain("coderabbit");
    expect(JSON.stringify(preview.steps)).toContain("actions/checkout@v7");
    expect(JSON.stringify(preview.steps)).toContain("actions/setup-node@v6");
    expect(JSON.stringify(preview.steps)).toContain(
      "versions upload --env preview",
    );
    expect(JSON.stringify(preview.steps)).toContain("/api/health");
    expect(JSON.stringify(preview.steps)).toContain("/ar");
  });
});
