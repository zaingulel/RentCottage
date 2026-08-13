import { describe, expect, it } from "vitest";
import {
  acceptanceCriteriaByIssue,
  expectedMembership,
  normalizeIssueBody,
  replacementIssues,
  sameMembers,
  specialIssues,
  verifyRentCottageProject,
} from "./lib/rentcottage-project-contract.mjs";
import {
  assertSupportedGhVersion,
  paginatedRestArgs,
  parsePaginatedPages,
} from "./lib/github-pagination.mjs";

const statusOptions = ["Backlog", "Ready", "In progress", "In review", "Done"];
const areaOptions = [
  "Foundation & quality",
  "Customer marketplace",
  "Owner backoffice",
  "Booking lifecycle",
  "Administration & governance",
];

function issueBody({ ticketId, criteria = [], blockers = [] } = {}) {
  const criteriaText = criteria
    .map((criterion) => `- [ ] ${criterion}`)
    .join("\n");
  const blockedBy =
    blockers.length > 0
      ? blockers.map((number) => `- #${number}`).join("\n")
      : "- None. This ticket can start immediately.";
  return `## Acceptance criteria\n\n${criteriaText}\n\n## Blocked by\n\n${blockedBy}${ticketId ? `\n\n<!-- rentcottage-ticket-id:${ticketId} -->` : ""}\n`;
}

function fakeState({
  projectMembership = [...expectedMembership],
  statusByNumber = {},
  closedIssues = [],
  nativeEvidenceAsMap = false,
  lineEnding = "\n",
  nullBodyIssue = null,
  projectReadme = "#19 through #51; #1, #18, #52, #55, #59; native dependencies; active ownership; verifier",
} = {}) {
  const closed = new Set(closedIssues);
  const replacementByNumber = new Map(
    replacementIssues.map((issue) => [issue.number, issue]),
  );
  const issuePolicies = new Map([
    ...replacementIssues.map((issue) => [
      issue.number,
      { ...issue, labels: ["ready-for-agent"] },
    ]),
    ...[...specialIssues].map(([number, policy]) => [
      number,
      { number, title: `Special issue ${number}`, blockers: [], ...policy },
    ]),
  ]);

  const issueNumbers = new Set([
    ...Array.from({ length: 18 }, (_, index) => index + 1),
    ...replacementIssues.map(({ number }) => number),
    ...specialIssues.keys(),
  ]);
  const issues = [];
  for (const number of [...issueNumbers].sort((a, b) => a - b)) {
    const replacement = replacementByNumber.get(number);
    const policy = issuePolicies.get(number);
    const historical = number >= 2 && number <= 17;
    issues.push({
      number,
      title:
        replacement?.title ?? policy?.title ?? `Historical issue ${number}`,
      state: historical || closed.has(number) ? "CLOSED" : "OPEN",
      body: replacement
        ? issueBody({
            ticketId: replacement.ticketId,
            criteria: acceptanceCriteriaByIssue.get(number),
            blockers: replacement.blockers,
          })
        : policy?.blockers.length
          ? issueBody({ blockers: policy.blockers })
          : "",
      labels: (policy?.labels ?? (historical ? ["ready-for-agent"] : [])).map(
        (name) => ({ name }),
      ),
      assignees: [],
    });
  }

  for (const issue of issues) {
    if (issue.number === nullBodyIssue) issue.body = null;
    else issue.body = issue.body.replaceAll("\n", lineEnding);
  }

  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const nativeBlockersByIssue = {};
  for (const expected of replacementIssues) {
    nativeBlockersByIssue[expected.number] = expected.blockers.map(
      (number) => ({
        number,
        state: byNumber.get(number).state.toLowerCase(),
      }),
    );
  }
  for (const [number, policy] of specialIssues) {
    nativeBlockersByIssue[number] = policy.blockers.map((blocker) => ({
      number: blocker,
      state: byNumber.get(blocker).state.toLowerCase(),
    }));
  }

  const areaFor = (number) =>
    replacementByNumber.get(number)?.area ?? specialIssues.get(number)?.area;
  const items = projectMembership.map((number) => ({
    id: `item-${number}`,
    type: "ISSUE",
    isArchived: false,
    content: {
      number,
      title: byNumber.get(number).title,
      state: byNumber.get(number).state,
      body: byNumber.get(number).body,
      repository: { nameWithOwner: "zaingulel/RentCottage" },
      labels: { nodes: byNumber.get(number).labels },
      assignees: { nodes: [] },
    },
    fieldValues: {
      totalCount: 2,
      nodes: [
        {
          name:
            statusByNumber[number] ??
            (number === 19 ? "In progress" : "Backlog"),
          field: { name: "Status" },
        },
        { name: areaFor(number), field: { name: "Area" } },
      ],
    },
  }));

  const project = {
    number: 4,
    title: "RentCottage",
    closed: false,
    readme: projectReadme,
    fields: {
      totalCount: 2,
      nodes: [
        { name: "Status", options: statusOptions.map((name) => ({ name })) },
        { name: "Area", options: areaOptions.map((name) => ({ name })) },
      ],
    },
    items: { totalCount: items.length, nodes: items },
  };

  return {
    project,
    issues,
    nativeBlockersByIssue: nativeEvidenceAsMap
      ? new Map(
          Object.entries(nativeBlockersByIssue).map(([number, evidence]) => [
            Number(number),
            evidence,
          ]),
        )
      : nativeBlockersByIssue,
  };
}

describe("RentCottage Project contract", () => {
  it("onboards supplementary Foundation and quality issues with their approved policies", () => {
    expect(expectedMembership).toContain(55);
    expect(specialIssues.get(55)).toEqual({
      title: "Automate tracker reconciliation and Project 4 transitions",
      area: "Foundation & quality",
      labels: ["ready-for-agent"],
      blockers: [52],
    });
    expect(expectedMembership).toContain(59);
    expect(specialIssues.get(59)).toEqual({
      title: "Keep RentCottage resume intake bounded and selection-only",
      area: "Foundation & quality",
      labels: ["ready-for-agent"],
      blockers: [],
      ownerGated: true,
    });
  });

  it("accepts the repaired issue graph and exact Project membership", () => {
    const result = verifyRentCottageProject(fakeState());
    expect(result.failures).toEqual([]);
  });

  it("rejects the escaped defect when every issue and dependency is correct but replacement Project membership is missing", () => {
    const result = verifyRentCottageProject(
      fakeState({ projectMembership: [1, 18, 52] }),
    );
    expect(result.failures).toEqual([
      expect.objectContaining({ code: "project.membership" }),
    ]);
  });

  it("rejects a blocked issue presented as Ready", () => {
    const result = verifyRentCottageProject(
      fakeState({ statusByNumber: { 20: "Ready" } }),
    );
    expect(result.failures).toContainEqual(
      expect.objectContaining({ code: "project.status.invalid" }),
    );
  });

  it("rejects issue 59 in In progress while owner-gated", () => {
    const result = verifyRentCottageProject(
      fakeState({ statusByNumber: { 59: "In progress" } }),
    );
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        code: "project.status.owner_gated",
        message: expect.stringContaining("#59"),
      }),
    );
  });

  it("reports one Status defect for a closed issue presented as active", () => {
    const result = verifyRentCottageProject(
      fakeState({
        closedIssues: [19],
        statusByNumber: { 19: "In progress" },
      }),
    );
    expect(
      result.failures.filter(({ code }) => code.startsWith("project.status")),
    ).toEqual([expect.objectContaining({ code: "project.status.closed" })]);
  });

  it("rejects an open issue presented as Done", () => {
    const result = verifyRentCottageProject(
      fakeState({ statusByNumber: { 19: "Done" } }),
    );
    expect(result.failures).toContainEqual(
      expect.objectContaining({ code: "project.status.done" }),
    );
  });

  it("keeps Status checks active when dependency evidence is missing", () => {
    const state = fakeState({ statusByNumber: { 19: "Done" } });
    delete state.nativeBlockersByIssue[19];
    const result = verifyRentCottageProject(state);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ code: "issues.native_evidence_missing" }),
    );
    expect(result.failures).toContainEqual(
      expect.objectContaining({ code: "project.status.done" }),
    );
  });

  it("rejects missing native dependency evidence even when the manifest expects no blockers", () => {
    const state = fakeState();
    delete state.nativeBlockersByIssue[19];
    const result = verifyRentCottageProject(state);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ code: "issues.native_evidence_missing" }),
    );
  });

  it("rejects an altered acceptance criterion", () => {
    const state = fakeState();
    const issue = state.issues.find(({ number }) => number === 19);
    const approvedCriterion = acceptanceCriteriaByIssue.get(19)[0];
    issue.body = issue.body.replace(
      `- [ ] ${approvedCriterion}`,
      "- [ ] A substituted criterion",
    );
    const result = verifyRentCottageProject(state);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ code: "issues.criteria" }),
    );
  });

  it("compares exact values as multisets", () => {
    expect(sameMembers(["a", "a", "b"], ["a", "b", "b"])).toBe(false);
  });

  it("requires a standalone README reference to issue 1", () => {
    const result = verifyRentCottageProject(
      fakeState({
        projectReadme:
          "#19 through #51; #18, #52, #55, #59; native dependencies; active ownership; verifier",
      }),
    );
    expect(result.failures).toContainEqual(
      expect.objectContaining({ code: "project.readme" }),
    );
  });

  it("requires the Project README to mention the bounded resume issue", () => {
    const result = verifyRentCottageProject(
      fakeState({
        projectReadme:
          "#19 through #51; #1, #18, #52, #55; native dependencies; active ownership; verifier",
      }),
    );
    expect(result.failures).toContainEqual(
      expect.objectContaining({ code: "project.readme" }),
    );
  });

  it("accepts production body shapes and Map dependency evidence", () => {
    const state = fakeState({
      lineEnding: "\r\n",
      nullBodyIssue: 1,
      nativeEvidenceAsMap: true,
    });
    expect(normalizeIssueBody(null)).toBe("");
    expect(normalizeIssueBody("first\r\nsecond")).toBe("first\nsecond");
    const result = verifyRentCottageProject(state);
    expect(result.failures).toEqual([]);
  });

  it("derives the next frontier after completed work instead of hard-coding issue 19", () => {
    const state = fakeState({
      closedIssues: [19],
      statusByNumber: { 19: "Done" },
    });
    const completedIssue = state.issues.find(({ number }) => number === 19);
    completedIssue.body = completedIssue.body.replaceAll("- [ ] ", "- [x] ");
    const result = verifyRentCottageProject(state);
    expect(result.failures).toEqual([]);
    expect(result.summary.dependencyFrontier).toEqual([20, 30]);
  });
});

describe("GitHub pagination boundary", () => {
  it("requires a GitHub CLI version that supports slurped pagination", () => {
    expect(() => assertSupportedGhVersion("gh version 2.48.0")).not.toThrow();
    expect(() => assertSupportedGhVersion("gh version 2.47.0")).toThrow(
      "require 2.48.0 or newer",
    );
    expect(() => assertSupportedGhVersion("gh version 2.47.99")).toThrow(
      "require 2.48.0 or newer",
    );
    expect(() => assertSupportedGhVersion("gh version 3.0.0")).not.toThrow();
    expect(() => assertSupportedGhVersion("unknown")).toThrow(
      "Unable to determine the GitHub CLI version",
    );
  });

  it("requests every REST page and combines injected pages", () => {
    const endpoint =
      "repos/zaingulel/RentCottage/issues?state=all&per_page=100";
    expect(paginatedRestArgs(endpoint)).toEqual([
      "api",
      "--paginate",
      "--slurp",
      "-H",
      "X-GitHub-Api-Version: 2022-11-28",
      endpoint,
    ]);
    expect(
      parsePaginatedPages('[[{"number":19}],[{"number":20}]]', "Issue"),
    ).toEqual([{ number: 19 }, { number: 20 }]);
  });

  it("fails closed for an unknown pagination shape", () => {
    expect(() => parsePaginatedPages('[{"number":19}]', "Issue")).toThrow(
      "Issue pagination returned an unknown shape",
    );
  });
});
