import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  acceptanceCriteriaByIssue,
  requiredMembership,
  normalizeIssueBody,
  replacementIssues,
  sameMembers,
  specialIssues,
  verifyRentCottageProject,
} from "./lib/rentcottage-project-contract.mjs";
import { obsoleteProjectIssueNumbers } from "./lib/rentcottage-tracker-constants.mjs";
import { createRentCottageTrackerPolicy } from "./lib/rentcottage-tracker-policy.mjs";
import {
  assertSupportedGhVersion,
  paginatedRestArgs,
  parsePaginatedPages,
  parseUniqueRepositoryIssuePages,
} from "./lib/github-pagination.mjs";
import {
  parseRentCottageVerifierArgs,
  runRentCottageProjectVerifier,
  runRentCottageProjectVerifierCommand,
} from "./lib/rentcottage-verifier.mjs";

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
  projectMembership = [...requiredMembership],
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
        : policy
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

function addCurrentProjectIssue(
  state,
  {
    number = 63,
    body = "## Blocked by\n\n- None.\n",
    area = "Foundation & quality",
    status = "Backlog",
    nativeBlockers = [],
    includeNativeEvidence = true,
    labels = ["ready-for-agent"],
    assignees = [],
  } = {},
) {
  state.issues.push({
    number,
    title: "Add a new delivery ticket",
    state: "OPEN",
    body,
    labels: labels.map((name) => ({ name })),
    assignees,
  });
  if (includeNativeEvidence)
    state.nativeBlockersByIssue[number] = nativeBlockers;
  const template = state.project.items.nodes.find(
    ({ content }) => content.number === 55,
  );
  if (!template)
    throw new Error(
      "addCurrentProjectIssue requires the #55 Project item template",
    );
  const item = structuredClone(template);
  item.id = `item-${number}`;
  item.content.number = number;
  item.content.title = "Add a new delivery ticket";
  item.content.body = body;
  item.content.labels.nodes = labels.map((name) => ({ name }));
  item.content.assignees.nodes = assignees;
  item.fieldValues.nodes.find(({ field }) => field.name === "Area").name = area;
  item.fieldValues.nodes.find(({ field }) => field.name === "Status").name =
    status;
  state.project.items.nodes.push(item);
  state.project.items.totalCount += 1;
}

function page(nodes) {
  return {
    totalCount: nodes.length,
    nodes,
    pageInfo: { hasNextPage: false, endCursor: null },
  };
}

function verifierGraphqlFixture(state) {
  const project = structuredClone(state.project);
  project.id = "project-4";
  project.owner = { login: "zaingulel" };
  project.fields = page(
    project.fields.nodes.map((field, index) => ({
      id: field.id ?? `field-${index}`,
      ...field,
    })),
  );
  const rawByNumber = new Map(
    state.issues.map((issue, index) => [
      issue.number,
      {
        ...issue,
        id: issue.id ?? index + 1,
        node_id: issue.node_id ?? `issue-node-${issue.number}`,
        state: issue.state.toLowerCase(),
      },
    ]),
  );
  const graphIssue = (number) => {
    const issue = rawByNumber.get(number);
    const blockers =
      state.nativeBlockersByIssue instanceof Map
        ? (state.nativeBlockersByIssue.get(number) ?? [])
        : (state.nativeBlockersByIssue[number] ?? []);
    return {
      id: issue.node_id,
      number,
      title: issue.title,
      state: issue.state.toUpperCase(),
      body: issue.body,
      repository: { nameWithOwner: "zaingulel/RentCottage" },
      labels: page(
        issue.labels.map(({ name }, index) => ({
          id: `label-${number}-${index}`,
          name,
        })),
      ),
      assignees: page(
        issue.assignees.map(({ login }, index) => ({
          id: `assignee-${number}-${index}`,
          login,
        })),
      ),
      blockedBy: page(
        blockers.map((blocker) => ({
          id: `issue-node-${blocker.number}`,
          databaseId: blocker.id ?? blocker.number * 10,
          number: blocker.number,
          state: blocker.state.toUpperCase(),
          repository: { nameWithOwner: "zaingulel/RentCottage" },
        })),
      ),
    };
  };
  project.items = page(
    project.items.nodes.map((item) => ({
      ...item,
      content: graphIssue(item.content.number),
      fieldValues: page(
        item.fieldValues.nodes.map((value, index) => ({
          ...value,
          field: {
            id: value.field.id ?? `field-value-${value.field.name}-${index}`,
            ...value.field,
          },
        })),
      ),
    })),
  );
  const targetNumbers = new Set([
    ...replacementIssues.map(({ number }) => number),
    ...specialIssues.keys(),
  ]);
  return {
    project,
    issues: [...rawByNumber.values()],
    targets: [...targetNumbers].map(graphIssue),
  };
}

function emptyVerifierProject() {
  return {
    data: {
      user: {
        login: "zaingulel",
        projectV2: {
          id: "project-4",
          number: 4,
          closed: false,
          owner: { login: "zaingulel" },
          fields: page([]),
          items: page([]),
        },
      },
      nodes: [],
    },
  };
}

describe("RentCottage Project contract", () => {
  it("names the retired pre-map issue range without requiring membership", () => {
    expect(obsoleteProjectIssueNumbers).toEqual(
      Array.from({ length: 16 }, (_, index) => index + 2),
    );
    expect(
      obsoleteProjectIssueNumbers.every(
        (number) => !requiredMembership.has(number),
      ),
    ).toBe(true);
    expect(
      createRentCottageTrackerPolicy().excludedProjectIssueNumbers,
    ).toEqual(new Set(obsoleteProjectIssueNumbers));
  });

  it("fails clearly when the current-issue helper cannot find its #55 template", () => {
    const state = fakeState();
    state.project.items.nodes = state.project.items.nodes.filter(
      ({ content }) => content.number !== 55,
    );

    expect(() => addCurrentProjectIssue(state)).toThrow(
      "addCurrentProjectIssue requires the #55 Project item template",
    );
  });

  it("onboards supplementary Foundation and quality issues with their approved policies", () => {
    expect(requiredMembership).toContain(55);
    expect(specialIssues.get(55)).toEqual({
      title: "Automate tracker reconciliation and Project 4 transitions",
      area: "Foundation & quality",
      labels: ["ready-for-agent"],
      blockers: [52],
    });
    expect(requiredMembership).toContain(59);
    expect(specialIssues.get(59)).toEqual({
      title: "Keep RentCottage resume intake bounded and selection-only",
      area: "Foundation & quality",
      labels: ["ready-for-agent"],
      blockers: [],
      ownerGated: true,
    });
  });

  it("accepts the repaired issue graph and required Project membership", () => {
    const result = verifyRentCottageProject(fakeState());
    expect(result.failures).toEqual([]);
  });

  it("keeps a protected issue missing from Project 4 out of the dependency frontier", () => {
    const state = fakeState({
      projectMembership: [...requiredMembership].filter(
        (number) => number !== 52,
      ),
    });

    const result = verifyRentCottageProject(state);

    expect(result.summary.dependencyFrontier).not.toContain(52);
  });

  it.each([
    { name: "wrong Area", area: "Owner backoffice" },
    { name: "missing Status", status: null },
    { name: "unknown Status", status: "Unknown status" },
    { name: "wrong labels", labels: ["needs-info"] },
    {
      name: "native blocker drift",
      nativeBlockers: [{ number: 55, state: "closed" }],
    },
  ])(
    "excludes a protected issue with $name from the dependency frontier",
    (scenario) => {
      const state = fakeState({ closedIssues: [19] });
      const issue = state.issues.find(({ number }) => number === 52);
      const item = state.project.items.nodes.find(
        ({ content }) => content.number === 52,
      );
      if (Object.hasOwn(scenario, "area"))
        item.fieldValues.nodes.find(({ field }) => field.name === "Area").name =
          scenario.area;
      if (Object.hasOwn(scenario, "status"))
        item.fieldValues.nodes.find(
          ({ field }) => field.name === "Status",
        ).name = scenario.status;
      if (scenario.labels) {
        issue.labels = scenario.labels.map((name) => ({ name }));
        item.content.labels.nodes = issue.labels;
      }
      if (scenario.nativeBlockers)
        state.nativeBlockersByIssue[52] = scenario.nativeBlockers;

      const result = verifyRentCottageProject(state);

      expect(result.summary.dependencyFrontier).not.toContain(52);
    },
  );

  it.each(["wrong title", "changed acceptance criterion"])(
    "excludes a protected issue with %s policy drift from the dependency frontier",
    (scenario) => {
      const state = fakeState({ closedIssues: [19] });
      const issue = state.issues.find(({ number }) => number === 20);
      if (scenario === "wrong title") {
        issue.title = "Changed protected title";
      } else {
        issue.body = issue.body.replace(
          /^- \[ \] .+$/m,
          "- [ ] Changed protected criterion",
        );
      }

      const result = verifyRentCottageProject(state);

      expect(result.summary.dependencyFrontier).not.toContain(20);
    },
  );

  it.each(["missing", "duplicate"])(
    "excludes a protected issue with %s canonical Blocked by section from the dependency frontier",
    (scenario) => {
      const state = fakeState();
      const issue = state.issues.find(({ number }) => number === 19);
      if (scenario === "missing") {
        issue.body = issue.body.replace(/\n\n## Blocked by[\s\S]*$/, "\n");
      } else {
        issue.body += "\n## Blocked by\n\n- None.\n";
      }

      const result = verifyRentCottageProject(state);

      expect(result.summary.dependencyFrontier).not.toContain(19);
    },
  );

  it("accepts a well-formed new repository issue added to Project 4", () => {
    const state = fakeState();
    addCurrentProjectIssue(state);

    const result = verifyRentCottageProject(state);

    expect(result.failures).toEqual([]);
    expect(result.summary.dependencyFrontier).toContain(63);
  });

  it("exhaustively partitions every evidenced unblocked unassigned issue by its readiness gate", () => {
    const state = fakeState();
    addCurrentProjectIssue(state, { number: 63 });
    addCurrentProjectIssue(state, {
      number: 64,
      labels: ["ready-for-agent", "owner-gated"],
    });
    addCurrentProjectIssue(state, {
      number: 65,
      labels: ["ready-for-human"],
    });
    addCurrentProjectIssue(state, { number: 66, labels: ["needs-triage"] });
    addCurrentProjectIssue(state, { number: 67, labels: ["needs-info"] });
    addCurrentProjectIssue(state, { number: 68, labels: ["wontfix"] });
    addCurrentProjectIssue(state, {
      number: 69,
      assignees: [{ login: "active-writer" }],
    });

    const result = verifyRentCottageProject(state);

    expect(result.failures).toEqual([]);
    expect(result.summary).toMatchObject({
      dependencyFrontier: [19, 63],
      ownerGated: [1, 18, 59, 64],
      readyForHuman: [65],
      needsTriage: [66],
      needsInfo: [67],
      wontfix: [68],
    });
    const partition = [
      result.summary.dependencyFrontier,
      result.summary.ownerGated,
      result.summary.readyForHuman,
      result.summary.needsTriage,
      result.summary.needsInfo,
      result.summary.wontfix,
    ].flat();
    expect(partition).toEqual([19, 63, 1, 18, 59, 64, 65, 66, 67, 68]);
    expect(new Set(partition).size).toBe(partition.length);
  });

  it.each(["ordinary", "protected"])(
    "uses the real canonical blocker section for %s verification",
    (issueType) => {
      const state = fakeState();
      const body =
        "Inline example: ## Blocked by\n\n- #999\n\n## Blocked by\n\n- None.\n";
      let target = 19;
      if (issueType === "ordinary") {
        target = 63;
        addCurrentProjectIssue(state, { body });
      } else {
        const issue = state.issues.find(({ number }) => number === target);
        issue.body = issue.body.replace(
          "## Blocked by\n\n- None.",
          body.trimEnd(),
        );
        const item = state.project.items.nodes.find(
          ({ content }) => content.number === target,
        );
        item.content.body = issue.body;
      }

      const result = verifyRentCottageProject(state);

      expect(result.failures).toEqual([]);
      expect(result.summary.dependencyFrontier).toContain(target);
    },
  );

  it.each(["ordinary", "protected"])(
    "fails closed on adjacent canonical blocker headings for %s verification",
    (issueType) => {
      const state = fakeState();
      const body =
        "## Blocked by\n\n## Blocked by\n\n- None. This ticket can start immediately.\n";
      let target = 19;
      let code = "issues.blocker_section";
      if (issueType === "ordinary") {
        target = 63;
        code = "issues.blocker_text";
        addCurrentProjectIssue(state, { number: target, body });
      } else {
        const issue = state.issues.find(({ number }) => number === target);
        issue.body = issue.body.replace(
          "## Blocked by\n\n- None. This ticket can start immediately.",
          body.trimEnd(),
        );
        const item = state.project.items.nodes.find(
          ({ content }) => content.number === target,
        );
        item.content.body = issue.body;
      }

      const result = verifyRentCottageProject(state);

      expect(result.failures).toContainEqual({
        code,
        message: `#${target} requires exactly one canonical Blocked by section`,
      });
      expect(result.summary.dependencyFrontier).not.toContain(target);
    },
  );

  it("rejects malformed ordinary issue shape and excludes it from the dependency frontier", () => {
    const state = fakeState();
    addCurrentProjectIssue(state, { labels: [] });

    const result = verifyRentCottageProject(state);

    expect(result.failures).toContainEqual(
      expect.objectContaining({
        code: "issues.triage_label",
        message: "#63 requires exactly one canonical triage label",
      }),
    );
    expect(result.summary.dependencyFrontier).not.toContain(63);
  });

  it.each(["needs-triage", "needs-info", "ready-for-human", "wontfix"])(
    "excludes an ordinary %s issue from the dependency frontier",
    (label) => {
      const state = fakeState();
      addCurrentProjectIssue(state, { labels: [label] });

      const result = verifyRentCottageProject(state);

      expect(result.summary.dependencyFrontier).not.toContain(63);
    },
  );

  it.each([
    { name: "missing Area", area: null },
    { name: "unknown Area", area: "Unknown area" },
    { name: "missing Status", status: null },
    { name: "unknown Status", status: "Unknown status" },
    { name: "missing native blocker evidence", includeNativeEvidence: false },
    {
      name: "textual and native blocker drift",
      body: "## Blocked by\n\n- #52\n",
      nativeBlockers: [],
    },
  ])(
    "excludes an ordinary issue with $name from the dependency frontier",
    (scenario) => {
      const state = fakeState();
      addCurrentProjectIssue(state, scenario);

      const result = verifyRentCottageProject(state);

      expect(result.summary.dependencyFrontier).not.toContain(63);
    },
  );

  it.each([
    ["unknown", "UNKNOWN"],
    ["malformed", null],
  ])(
    "fails closed when dependency evidence has an %s state",
    (_name, stateValue) => {
      const state = fakeState();
      addCurrentProjectIssue(state, {
        number: 63,
        body: "## Blocked by\n\n- #52\n",
        nativeBlockers: [{ number: 52, state: stateValue }],
      });

      const result = verifyRentCottageProject(state);

      expect(result.failures).toContainEqual({
        code: "issues.native_state",
        message: `#63 native dependency #52 has unknown state ${String(stateValue)}`,
      });
      expect(result.summary.dependencyFrontier).not.toContain(63);
      expect(result.summary.ownerGated).not.toContain(63);
      expect(result.summary.readyForHuman).not.toContain(63);
      expect(result.summary.needsTriage).not.toContain(63);
      expect(result.summary.needsInfo).not.toContain(63);
      expect(result.summary.wontfix).not.toContain(63);
    },
  );

  it.each([
    {
      name: "multiple triage labels",
      labels: ["ready-for-agent", "needs-info"],
      body: "## Blocked by\n\n- None.\n",
      code: "issues.triage_label",
    },
    {
      name: "duplicate Blocked by sections",
      labels: ["ready-for-agent"],
      body: "## Blocked by\n\n- None.\n\n## Notes\n\nText.\n\n## Blocked by\n\n- None.\n",
      code: "issues.blocker_text",
    },
  ])("rejects ordinary issue with $name", (scenario) => {
    const state = fakeState();
    addCurrentProjectIssue(state, scenario);

    const result = verifyRentCottageProject(state);

    expect(result.failures).toContainEqual(
      expect.objectContaining({ code: scenario.code }),
    );
    expect(result.summary.dependencyFrontier).not.toContain(63);
  });

  it("rejects a new Project issue without an Area", () => {
    const state = fakeState();
    addCurrentProjectIssue(state, { area: null });

    const result = verifyRentCottageProject(state);

    expect(result.failures).toContainEqual(
      expect.objectContaining({ code: "project.area.unknown" }),
    );
  });

  it("rejects a new Project issue when native blocker evidence is missing", () => {
    const state = fakeState();
    addCurrentProjectIssue(state, { includeNativeEvidence: false });

    const result = verifyRentCottageProject(state);

    expect(result.failures).toContainEqual(
      expect.objectContaining({
        code: "issues.native_evidence_missing",
        message: expect.stringContaining("#63"),
      }),
    );
  });

  it("rejects textual and native dependency drift on a new Project issue", () => {
    const state = fakeState();
    addCurrentProjectIssue(state, { body: "## Blocked by\n\n- #52\n" });

    const result = verifyRentCottageProject(state);

    expect(result.failures).toContainEqual(
      expect.objectContaining({
        code: "issues.blocker_text",
        message: expect.stringContaining("#63"),
      }),
    );
  });

  it("requires a new Project issue to declare its blocker section", () => {
    const state = fakeState();
    addCurrentProjectIssue(state, { body: "## Acceptance criteria\n" });

    const result = verifyRentCottageProject(state);

    expect(result.failures).toContainEqual(
      expect.objectContaining({
        code: "issues.blocker_text",
        message: expect.stringContaining("#63"),
      }),
    );
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

  it("keeps an ordinary owner-gated issue out of active status and the dependency frontier", () => {
    const state = fakeState();
    addCurrentProjectIssue(state, {
      status: "Ready",
      labels: ["ready-for-agent", "owner-gated"],
    });

    const result = verifyRentCottageProject(state);

    expect(result.failures).toContainEqual(
      expect.objectContaining({
        code: "project.status.owner_gated",
        message: expect.stringContaining("#63"),
      }),
    );
    expect(result.summary.dependencyFrontier).not.toContain(63);
  });

  it("accepts an optional owner gate on a protected issue and classifies it before its triage role", () => {
    const state = fakeState({
      closedIssues: [19],
      statusByNumber: { 19: "Done" },
    });
    const completedIssue = state.issues.find(({ number }) => number === 19);
    completedIssue.body = completedIssue.body.replaceAll("- [ ] ", "- [x] ");
    const issue = state.issues.find(({ number }) => number === 52);
    issue.labels.push({ name: "owner-gated" });

    const result = verifyRentCottageProject(state);

    expect(result.failures).toEqual([]);
    expect(result.summary.ownerGated).toContain(52);
    expect(result.summary.dependencyFrontier).not.toContain(52);
  });

  it("rejects an unknown protected label and excludes the issue from every readiness category", () => {
    const state = fakeState({
      closedIssues: [19],
      statusByNumber: { 19: "Done" },
    });
    const completedIssue = state.issues.find(({ number }) => number === 19);
    completedIssue.body = completedIssue.body.replaceAll("- [ ] ", "- [x] ");
    const issue = state.issues.find(({ number }) => number === 52);
    issue.labels.push({ name: "unknown-role" });

    const result = verifyRentCottageProject(state);

    expect(result.failures).toContainEqual({
      code: "issues.special.labels",
      message: "Special issue #52 labels do not match the contract",
    });
    const partition = [
      result.summary.dependencyFrontier,
      result.summary.ownerGated,
      result.summary.readyForHuman,
      result.summary.needsTriage,
      result.summary.needsInfo,
      result.summary.wontfix,
    ].flat();
    expect(partition).not.toContain(52);
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

  it("rejects a closed issue left in Backlog", () => {
    const result = verifyRentCottageProject(
      fakeState({
        closedIssues: [19],
        statusByNumber: { 19: "Backlog" },
      }),
    );
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        code: "project.status.closed",
        message: "Closed #19 must be Done, not Backlog",
      }),
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

  it("keeps returning-customer Booking History in issue 37 rather than completed issue 20", () => {
    const state = fakeState();
    const approvedBodies = new Map([
      [
        20,
        issueBody({
          ticketId: "D02",
          blockers: [19],
          criteria: [
            "A customer can verify a phone number and receives only customer permissions.",
            "A prospective or approved Cottage Owner can verify a phone number and receives only the owner permissions appropriate to their current approval state.",
            "Platform Administrator access requires multi-factor authentication and is never granted by a public self-service role change.",
            "Supabase Row Level Security covers every exposed customer, owner and administrator data path introduced by this slice.",
            "Denial tests prove cross-account, cross-cottage and cross-role reads and writes fail.",
            "Successful and failed privileged sign-in attempts are attributed and timestamped in the audit record.",
          ],
        }),
      ],
      [
        37,
        issueBody({
          ticketId: "D19",
          blockers: [35],
          criteria: [
            "Customer Booking History distinguishes pending, confirmed, declined, expired, withdrawn, cancelled and completed outcomes.",
            "A returning customer who verifies the same phone number regains the same Customer Account and authorised Booking History without creating a duplicate account.",
            "Owner Booking History shows the equivalent authorised records for that owner's cottages and never another owner's bookings.",
            "Each entry opens the preserved details appropriate to its state without leaking exact location or contact information before payment.",
            "A reminder is sent 24 hours before the first booked Cottage Shift for an active Confirmed Booking only.",
            "Reminder timing uses Iraq time and repeated scheduler delivery cannot send duplicate reminders.",
            "Notification delivery and failure state are visible for operational follow-up.",
          ],
        }),
      ],
    ]);
    for (const [number, body] of approvedBodies) {
      state.issues.find((issue) => issue.number === number).body = body;
      state.project.items.nodes.find(
        (item) => item.content.number === number,
      ).content.body = body;
    }

    const result = verifyRentCottageProject(state);

    expect(
      result.failures.filter(({ code }) => code === "issues.criteria"),
    ).toEqual([]);
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
      nullBodyIssue: 2,
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
    expect(result.summary.dependencyFrontier).toEqual([20, 30, 52]);
  });
});

describe("GitHub pagination boundary", () => {
  it("forwards JSON and invalid arguments through the executable entrypoint", () => {
    const directory = mkdtempSync(join(tmpdir(), "rentcottage-verifier-cli-"));
    const fixturePath = join(directory, "fixture.json");
    const markerPath = join(directory, "provider-called");
    const ghPath = join(directory, "gh");
    const state = fakeState();
    const graph = verifierGraphqlFixture(state);
    const fixture = {
      project: graph.project,
      issues: graph.issues,
      targetIssues: graph.targets,
    };
    writeFileSync(fixturePath, JSON.stringify(fixture));
    writeFileSync(
      ghPath,
      `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
appendFileSync(process.env.RENTCOTTAGE_GH_MARKER, "called\\n");
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("gh version 2.48.0");
  process.exit(0);
}
const fixture = JSON.parse(readFileSync(process.env.RENTCOTTAGE_GH_FIXTURE, "utf8"));
if (args.includes("graphql")) {
  writeFileSync(1, JSON.stringify({ data: { user: { login: "zaingulel", projectV2: fixture.project }, nodes: fixture.targetIssues } }));
  process.exit(0);
}
const endpoint = args.at(-1);
if (endpoint.includes("?state=all")) {
  console.log(JSON.stringify([fixture.issues]));
  process.exit(0);
}
const match = endpoint.match(/issues\\/(\\d+)\\/dependencies/);
if (match) {
  console.log(JSON.stringify([fixture.nativeBlockersByIssue[match[1]] ?? []]));
  process.exit(0);
}
process.exit(1);
`,
      { mode: 0o755 },
    );
    const options = {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH}`,
        RENTCOTTAGE_GH_FIXTURE: fixturePath,
        RENTCOTTAGE_GH_MARKER: markerPath,
      },
    };

    try {
      const jsonResult = spawnSync(
        process.execPath,
        ["scripts/verify-rentcottage-project.mjs", "--json"],
        options,
      );

      expect(jsonResult.status, jsonResult.stderr).toBe(0);
      expect(jsonResult.stderr).toBe("");
      expect(JSON.parse(jsonResult.stdout)).toEqual({
        schemaVersion: 1,
        dependencyFrontier: [19],
        ownerGated: [1, 18, 59],
        readyForHuman: [],
        needsTriage: [],
        needsInfo: [],
        wontfix: [],
      });
      expect(existsSync(markerPath)).toBe(true);
      rmSync(markerPath);

      const invalidResult = spawnSync(
        process.execPath,
        ["scripts/verify-rentcottage-project.mjs", "--invalid"],
        options,
      );

      expect(invalidResult.status).toBe(2);
      expect(invalidResult.stdout).toBe("");
      expect(invalidResult.stderr).toBe(
        "Usage: npm run verify:board -- [--json]\n",
      );
      expect(existsSync(markerPath)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("accepts only the optional JSON command flag before provider access", () => {
    expect(parseRentCottageVerifierArgs([])).toEqual({ json: false });
    expect(parseRentCottageVerifierArgs(["--json"])).toEqual({ json: true });

    const stderr = vi.fn();
    const run = vi.fn();
    const result = runRentCottageProjectVerifierCommand(["--unknown"], {
      run,
      stderr,
    });

    expect(result.status).toBe(2);
    expect(run).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(
      "Usage: npm run verify:board -- [--json]",
    );
  });

  it("emits a schema-versioned bounded JSON readiness inventory on success", () => {
    const run = vi.fn((args) => {
      if (args[0] === "--version") return "gh version 2.48.0";
      if (args.includes("graphql")) {
        return JSON.stringify(emptyVerifierProject());
      }
      return "[[]]";
    });
    const summary = {
      dependencyFrontier: [19],
      ownerGated: [1, 18],
      readyForHuman: [63],
      needsTriage: [64],
      needsInfo: [65],
      wontfix: [66],
      readyItems: [19],
      itemCount: 7,
    };
    const stdout = vi.fn();

    const result = runRentCottageProjectVerifier({
      run,
      verify: vi.fn(() => ({ failures: [], summary })),
      json: true,
      stdout,
      stderr: vi.fn(),
    });

    expect(result.status).toBe(0);
    expect(stdout).toHaveBeenCalledTimes(1);
    expect(JSON.parse(stdout.mock.calls[0][0])).toEqual({
      schemaVersion: 1,
      dependencyFrontier: [19],
      ownerGated: [1, 18],
      readyForHuman: [63],
      needsTriage: [64],
      needsInfo: [65],
      wontfix: [66],
    });
  });

  it("builds native blocker evidence from the shared Project page with zero per-card REST calls", () => {
    const issue = {
      id: 550,
      node_id: "issue-node-55",
      number: 55,
      title: "Ticket",
      state: "open",
      body: "## Blocked by\n\n- #52\n",
      labels: [{ name: "ready-for-agent" }],
      assignees: [],
    };
    const graphIssue = {
      id: "issue-node-55",
      number: 55,
      title: "Ticket",
      state: "OPEN",
      body: issue.body,
      repository: { nameWithOwner: "zaingulel/RentCottage" },
      labels: {
        totalCount: 1,
        nodes: [{ id: "label-ready", name: "ready-for-agent" }],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
      assignees: {
        totalCount: 0,
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
      blockedBy: {
        totalCount: 1,
        nodes: [
          {
            id: "issue-node-52",
            databaseId: 520,
            number: 52,
            state: "CLOSED",
            repository: { nameWithOwner: "zaingulel/RentCottage" },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
    const run = vi.fn((args) => {
      if (args[0] === "--version") return "gh version 2.48.0";
      if (args.includes("graphql"))
        return JSON.stringify({
          data: {
            user: {
              login: "zaingulel",
              projectV2: {
                id: "project-4",
                number: 4,
                closed: false,
                owner: { login: "zaingulel" },
                fields: {
                  totalCount: 0,
                  nodes: [],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
                items: {
                  totalCount: 1,
                  nodes: [
                    {
                      id: "item-55",
                      type: "ISSUE",
                      isArchived: false,
                      content: graphIssue,
                      fieldValues: {
                        totalCount: 0,
                        nodes: [],
                        pageInfo: { hasNextPage: false, endCursor: null },
                      },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
            nodes: [graphIssue],
          },
        });
      const endpoint = args.at(-1);
      if (endpoint.includes("?state=all")) return JSON.stringify([[issue]]);
      throw new Error(`Unexpected per-card request ${endpoint}`);
    });
    const verify = vi.fn(({ nativeBlockersByIssue }) => {
      expect(nativeBlockersByIssue.get(55)).toEqual([
        { id: 520, nodeId: "issue-node-52", number: 52, state: "closed" },
      ]);
      return {
        failures: [],
        summary: {
          itemCount: 1,
          dependencyFrontier: [],
          ownerGated: [],
          readyForHuman: [],
          needsTriage: [],
          needsInfo: [],
          wontfix: [],
          readyItems: [],
        },
      };
    });

    const result = runRentCottageProjectVerifier({
      run,
      verify,
      stdout: vi.fn(),
      stderr: vi.fn(),
    });

    expect(result.status).toBe(0);
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls.flat().join(" ")).not.toContain("blocked_by");
  });

  it("keeps human output concise while reporting every unblocked category", () => {
    const run = vi.fn((args) => {
      if (args[0] === "--version") return "gh version 2.48.0";
      if (args.includes("graphql")) {
        return JSON.stringify(emptyVerifierProject());
      }
      return "[[]]";
    });
    const stdout = vi.fn();

    const result = runRentCottageProjectVerifier({
      run,
      verify: vi.fn(() => ({
        failures: [],
        summary: {
          itemCount: 6,
          dependencyFrontier: [19],
          ownerGated: [1],
          readyForHuman: [63],
          needsTriage: [64],
          needsInfo: [65],
          wontfix: [66],
          readyItems: [],
        },
      })),
      stdout,
      stderr: vi.fn(),
    });

    expect(result.status).toBe(0);
    expect(stdout.mock.calls.map(([line]) => line)).toEqual([
      expect.stringContaining("Verified Project 4: 6 current items"),
      "Current dependency frontier: #19.",
      "Current unblocked owner-gated items: #1.",
      "Current unblocked ready-for-human items: #63.",
      "Current unblocked needs-triage items: #64.",
      "Current unblocked needs-info items: #65.",
      "Current unblocked wontfix items: #66.",
      "Current Project Ready items: none.",
    ]);
  });

  it.each(["issue", "dependency"])(
    "fails closed on duplicate %s pages before contract normalization",
    (duplicateType) => {
      const state = fakeState();
      const rawIssues = state.issues.map((issue, index) => ({
        ...issue,
        id: index + 1,
        node_id: `issue-node-${issue.number}`,
        state: issue.state.toLowerCase(),
      }));
      const firstIssue = rawIssues[0];
      const duplicateIssues = [
        [firstIssue],
        [{ ...firstIssue, id: firstIssue.id + 1, title: "Contradiction" }],
      ];
      const graph = verifierGraphqlFixture(state);
      if (duplicateType === "dependency") {
        const issue = graph.project.items.nodes[0].content;
        issue.blockedBy = page([
          {
            id: "blocker-a",
            databaseId: 520,
            number: 52,
            state: "OPEN",
            repository: { nameWithOwner: "zaingulel/RentCottage" },
          },
          {
            id: "blocker-b",
            databaseId: 521,
            number: 52,
            state: "CLOSED",
            repository: { nameWithOwner: "zaingulel/RentCottage" },
          },
        ]);
      }
      const run = vi.fn((args) => {
        if (args[0] === "--version") return "gh version 2.48.0";
        if (args.includes("graphql"))
          return JSON.stringify({
            data: {
              user: { login: "zaingulel", projectV2: graph.project },
              nodes: graph.targets,
            },
          });
        const endpoint = args.at(-1);
        if (endpoint.includes("?state=all"))
          return JSON.stringify(
            duplicateType === "issue" ? duplicateIssues : [rawIssues],
          );
        throw new Error(`Unexpected verifier request ${endpoint}`);
      });
      const verify = vi.fn();
      const stderr = vi.fn();

      const result = runRentCottageProjectVerifier({
        run,
        verify,
        stdout: vi.fn(),
        stderr,
      });

      expect(result.status).toBe(1);
      expect(verify).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledWith(
        expect.stringContaining("duplicate stable identity"),
      );
    },
  );

  it("bounds and redacts standalone verifier provider failures", () => {
    const privateStdout = "private-issue-body";
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    const execute = vi.fn((_file, _args, options) => {
      expect(options.timeout).toBe(60_000);
      throw Object.assign(new Error("provider failed"), {
        status: 1,
        stdout: `${privateStdout} ${secret} ${"body".repeat(5_000)}`,
        stderr: `request failed\u0000 Bearer ${secret} ${"detail".repeat(5_000)}`,
      });
    });
    const stderr = vi.fn();
    const verify = vi.fn();

    const result = runRentCottageProjectVerifier({
      execute,
      verify,
      stdout: vi.fn(),
      stderr,
    });
    const diagnostic = stderr.mock.calls.flat().join(" ");

    expect(result.status).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(verify).not.toHaveBeenCalled();
    expect(diagnostic).toContain("stderr=request failed Bearer [REDACTED]");
    expect(diagnostic).not.toContain(privateStdout);
    expect(diagnostic).not.toContain(secret);
    expect(diagnostic.length).toBeLessThan(1_500);
  });

  it("bounds and redacts standalone verifier GraphQL semantic failures", () => {
    const privateBody = "private-graphql-body";
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    const codeSecret = "github_pat_abcdefghijklmnopqrstuvwxyz1234567890";
    const run = vi.fn((args) => {
      if (args[0] === "--version") return "gh version 2.48.0";
      if (!args.includes("graphql")) return "[[]]";
      return JSON.stringify({
        errors: [
          {
            message: `${privateBody} Bearer ${secret} ${"detail".repeat(5_000)}`,
            extensions: { code: "FORBIDDEN" },
          },
          { message: "secondary failure", extensions: { code: codeSecret } },
        ],
      });
    });
    const stderr = vi.fn();
    const verify = vi.fn();

    const result = runRentCottageProjectVerifier({
      run,
      verify,
      stdout: vi.fn(),
      stderr,
    });
    const diagnostic = stderr.mock.calls.flat().join(" ");

    expect(result.status).toBe(1);
    expect(verify).not.toHaveBeenCalled();
    expect(diagnostic).toContain("Project query failed");
    expect(diagnostic).toContain("FORBIDDEN");
    expect(diagnostic).not.toContain(privateBody);
    expect(diagnostic).not.toContain(secret);
    expect(diagnostic).not.toContain(codeSecret);
    expect(diagnostic.length).toBeLessThan(1_500);
  });

  it.each([
    ["object", { message: "reviewer-reproduced-object" }],
    ["string", "malformed-errors-string"],
    ["null", null],
  ])(
    "rejects a present non-array GraphQL errors %s at the verifier boundary",
    (_shape, errors) => {
      const secret = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
      const run = vi.fn((args) => {
        if (args[0] === "--version") return "gh version 2.48.0";
        if (!args.includes("graphql")) return "[[]]";
        return JSON.stringify({
          errors:
            typeof errors === "string"
              ? `${errors} ${secret} ${"detail".repeat(5_000)}`
              : errors && typeof errors === "object"
                ? {
                    ...errors,
                    private: `${secret} ${"detail".repeat(5_000)}`,
                  }
                : errors,
        });
      });
      const stderr = vi.fn();
      const verify = vi.fn();

      const result = runRentCottageProjectVerifier({
        run,
        verify,
        stdout: vi.fn(),
        stderr,
      });
      const diagnostic = stderr.mock.calls.flat().join(" ");

      expect(result.status).toBe(1);
      expect(verify).not.toHaveBeenCalled();
      expect(diagnostic).toContain(
        "Project query returned malformed GraphQL errors evidence",
      );
      expect(diagnostic).not.toContain(secret);
      expect(diagnostic.length).toBeLessThan(1_500);
    },
  );

  it("rejects duplicate REST identities before independent verifier Map construction", () => {
    expect(() =>
      parseUniqueRepositoryIssuePages(
        '[[{"id":550,"number":55}],[{"id":551,"number":55}]]',
        "Issue",
        "zaingulel/RentCottage",
      ),
    ).toThrow("Issue pagination returned a duplicate stable identity");
  });

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
