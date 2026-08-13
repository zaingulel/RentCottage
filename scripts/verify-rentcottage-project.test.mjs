import { describe, expect, it } from "vitest";
import {
  acceptanceCriteriaByIssue,
  expectedMembership,
  replacementIssues,
  specialIssues,
  verifyRentCottageProject,
} from "./lib/rentcottage-project-contract.mjs";
import {
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

  const issues = [];
  for (let number = 1; number <= 52; number += 1) {
    const replacement = replacementByNumber.get(number);
    const policy = issuePolicies.get(number);
    if (number > 18 && number < 52 && !replacement) continue;
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
        : number === 52
          ? issueBody({ blockers: [19] })
          : "",
      labels: (policy?.labels ?? (historical ? ["ready-for-agent"] : [])).map(
        (name) => ({ name }),
      ),
      assignees: [],
    });
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
    readme:
      "#19 through #51; #1, #18, #52; native dependencies; active ownership; verifier",
    fields: {
      totalCount: 2,
      nodes: [
        { name: "Status", options: statusOptions.map((name) => ({ name })) },
        { name: "Area", options: areaOptions.map((name) => ({ name })) },
      ],
    },
    items: { totalCount: items.length, nodes: items },
  };

  return { project, issues, nativeBlockersByIssue };
}

describe("RentCottage Project contract", () => {
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

  it("rejects an open issue presented as Done", () => {
    const result = verifyRentCottageProject(
      fakeState({ statusByNumber: { 19: "Done" } }),
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
