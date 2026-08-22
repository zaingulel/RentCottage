import { describe, expect, it, vi } from "vitest";
import {
  planRentCottageReconciliation,
  runRentCottageReconciliation,
} from "./lib/rentcottage-reconciliation.mjs";
import {
  main,
  parseReconciliationArgs,
  verifyBoard,
} from "./reconcile-rentcottage-project.mjs";
import { createRentCottageTrackerPolicy } from "./lib/rentcottage-tracker-policy.mjs";
import {
  canonicalBlockedByNumbers,
  canonicalBlockedBySectionCount,
} from "./lib/rentcottage-issue-body.mjs";
import { obsoleteProjectIssueNumbers } from "./lib/rentcottage-tracker-constants.mjs";

function policy() {
  return {
    repository: "zaingulel/RentCottage",
    projectOwner: "zaingulel",
    projectNumber: 4,
    issues: new Map([
      [
        55,
        {
          number: 55,
          title: "Automate tracker reconciliation and Project 4 transitions",
          area: "Foundation & quality",
          labels: ["ready-for-agent"],
          blockers: [],
        },
      ],
    ]),
  };
}

function observedState(overrides = {}) {
  return {
    complete: true,
    repository: "zaingulel/RentCottage",
    project: {
      id: "project-4",
      owner: "zaingulel",
      number: 4,
      fields: {
        Area: {
          id: "field-area",
          options: new Map([["Foundation & quality", "area-foundation"]]),
        },
        Status: {
          id: "field-status",
          options: new Map([
            ["Backlog", "status-backlog"],
            ["In progress", "status-in-progress"],
            ["In review", "status-in-review"],
            ["Done", "status-done"],
          ]),
        },
      },
      items: [],
    },
    issues: [
      {
        id: 550,
        nodeId: "issue-node-55",
        number: 55,
        title: "Automate tracker reconciliation and Project 4 transitions",
        state: "OPEN",
        body: "## Blocked by\n\n- None.\n",
        labels: ["ready-for-agent"],
        assignees: [],
        blockers: [],
      },
    ],
    pullRequests: [],
    ...overrides,
  };
}

function addOrdinaryProjectIssue(
  observed,
  {
    number = 63,
    state = "OPEN",
    area = "Foundation & quality",
    status = "Backlog",
    blockers = [],
    body = "## Blocked by\n\n- None.\n",
    assignees = [],
    labels = ["ready-for-agent"],
  } = {},
) {
  observed.issues.push({
    id: number * 10,
    nodeId: `issue-node-${number}`,
    number,
    title: "New delivery ticket",
    state,
    body,
    labels,
    assignees,
    blockers,
  });
  observed.project.items.push({
    id: `item-${number}`,
    issueNumber: number,
    area,
    status,
  });
}

describe("RentCottage reconciliation planner", () => {
  it("ignores an embedded marker before the real canonical blocker section", () => {
    expect(
      canonicalBlockedByNumbers(
        "Inline example: ## Blocked by\r\n\r\n- #999\r\n\r\n## Blocked by\r\n\r\n- #52\r\n- #19\r\n\r\n## Notes\r\n\r\n- #888\r\n",
      ),
    ).toEqual([52, 19]);
  });

  it("counts adjacent canonical blocker headings separately", () => {
    expect(
      canonicalBlockedBySectionCount(
        "## Blocked by\r\n\r\n## Blocked by\r\n\r\n- #52\r\n",
      ),
    ).toBe(2);
  });

  it.each(["ordinary", "protected"])(
    "uses the real canonical blocker section for %s reconciliation",
    (issueType) => {
      const observed = observedState();
      observed.project.items = [
        {
          id: "item-55",
          issueNumber: 55,
          area: "Foundation & quality",
          status: "Backlog",
        },
      ];
      const body =
        "Inline example: ## Blocked by\n\n- #999\n\n## Blocked by\n\n- None.\n";
      let target = 55;
      if (issueType === "ordinary") {
        target = 999;
        addOrdinaryProjectIssue(observed, { number: target, body });
      } else {
        observed.issues[0].body = body;
      }

      const result = planRentCottageReconciliation({
        intent: { type: "audit" },
        observed,
        policy: policy(),
      });

      expect(result.discrepancies).toEqual([]);
      expect(result.dependencyFrontier).toContain(target);
    },
  );

  it.each(["ordinary", "protected"])(
    "fails closed on adjacent canonical blocker headings for %s reconciliation",
    (issueType) => {
      const observed = observedState();
      observed.project.items = [
        {
          id: "item-55",
          issueNumber: 55,
          area: "Foundation & quality",
          status: "Backlog",
        },
      ];
      const body = "## Blocked by\n\n## Blocked by\n\n- None.\n";
      let target = 55;
      if (issueType === "ordinary") {
        target = 63;
        addOrdinaryProjectIssue(observed, { number: target, body });
      } else {
        observed.issues[0].body = body;
      }

      const result = planRentCottageReconciliation({
        intent: { type: "audit" },
        observed,
        policy: policy(),
      });

      expect(result.discrepancies).toContainEqual(
        expect.objectContaining({ code: "issue.blocker_section" }),
      );
      expect(result.dependencyFrontier).not.toContain(target);
    },
  );

  it("builds the reconciliation policy from the existing tracker contract", () => {
    const approved = createRentCottageTrackerPolicy();

    expect(approved).toMatchObject({
      repository: "zaingulel/RentCottage",
      projectOwner: "zaingulel",
      projectNumber: 4,
    });
    expect(approved.issues.get(55)).toEqual({
      number: 55,
      title: "Automate tracker reconciliation and Project 4 transitions",
      area: "Foundation & quality",
      labels: ["ready-for-agent"],
      blockers: [52],
      ownerGated: false,
    });
    expect(approved.excludedProjectIssueNumbers).toEqual(
      new Set(obsoleteProjectIssueNumbers),
    );
  });

  it("plans deterministic publication for an approved issue missing from Project 4", () => {
    const result = planRentCottageReconciliation({
      intent: { type: "publish", issueNumber: 55 },
      observed: observedState(),
      policy: policy(),
    });

    expect(result.outcome).toBe("plan");
    expect(result.operations).toEqual([
      {
        type: "add-project-item",
        issueNumber: 55,
        contentNodeId: "issue-node-55",
        reason: "#55 is approved but missing from Project 4",
      },
      {
        type: "set-project-field",
        issueNumber: 55,
        field: "Area",
        value: "Foundation & quality",
        reason: "#55 must use its approved Area",
      },
      {
        type: "set-project-field",
        issueNumber: 55,
        field: "Status",
        value: "Backlog",
        reason: "A newly published issue starts in Backlog",
      },
    ]);
    expect(result.planId).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("excludes a protected issue missing from Project 4 from the dependency frontier", () => {
    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed: observedState(),
      policy: policy(),
    });

    expect(result.dependencyFrontier).not.toContain(55);
  });

  it.each([
    { name: "wrong Area", item: { area: "Owner backoffice" } },
    { name: "missing Status", item: { status: null } },
    { name: "unknown Status", item: { status: "Unknown status" } },
    { name: "wrong labels", issue: { labels: ["needs-info"] } },
    {
      name: "native blocker drift",
      issue: {
        blockers: [{ id: 520, number: 52, state: "CLOSED" }],
      },
    },
  ])(
    "excludes a protected issue with $name from the dependency frontier",
    ({ item: itemChange = {}, issue: issueChange = {} }) => {
      const observed = observedState();
      observed.project.items = [
        {
          id: "item-55",
          issueNumber: 55,
          area: "Foundation & quality",
          status: "Backlog",
          ...itemChange,
        },
      ];
      Object.assign(observed.issues[0], issueChange);

      const result = planRentCottageReconciliation({
        intent: { type: "audit" },
        observed,
        policy: policy(),
      });

      expect(result.dependencyFrontier).not.toContain(55);
    },
  );

  it.each([
    { name: "missing Blocked by section", body: "## Notes\n\nNone.\n" },
    {
      name: "duplicate Blocked by sections",
      body: "## Blocked by\n\n- None.\n\n## Notes\n\nNone.\n\n## Blocked by\n\n- None.\n",
    },
  ])(
    "excludes a protected issue with $name from the dependency frontier",
    ({ body }) => {
      const observed = observedState();
      observed.project.items = [
        {
          id: "item-55",
          issueNumber: 55,
          area: "Foundation & quality",
          status: "Backlog",
        },
      ];
      observed.issues[0].body = body;

      const result = planRentCottageReconciliation({
        intent: { type: "audit" },
        observed,
        policy: policy(),
      });

      expect(result.dependencyFrontier).not.toContain(55);
    },
  );

  it.each([
    {
      name: "wrong title",
      issue: { title: "Changed protected title" },
    },
    {
      name: "changed acceptance criterion",
      policy: { acceptanceCriteria: ["Expected protected criterion"] },
      issue: {
        body: "## Acceptance criteria\n\n- [ ] Changed protected criterion\n\n## Blocked by\n\n- None.\n",
      },
    },
  ])(
    "excludes a protected issue with $name policy drift from the dependency frontier",
    ({ issue: issueChange, policy: policyChange = {} }) => {
      const observed = observedState();
      observed.project.items = [
        {
          id: "item-55",
          issueNumber: 55,
          area: "Foundation & quality",
          status: "Backlog",
        },
      ];
      Object.assign(observed.issues[0], issueChange);
      const approved = policy();
      Object.assign(approved.issues.get(55), policyChange);

      const result = planRentCottageReconciliation({
        intent: { type: "audit" },
        observed,
        policy: approved,
      });

      expect(result.dependencyFrontier).not.toContain(55);
    },
  );

  it("corrects Area without resetting an existing lifecycle Status", () => {
    const observed = observedState();
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Owner backoffice",
        status: "Ready",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "publish", issueNumber: 55 },
      observed,
      policy: policy(),
    });

    expect(result.operations).toEqual([
      {
        type: "set-project-field",
        issueNumber: 55,
        field: "Area",
        value: "Foundation & quality",
        reason: "#55 must use its approved Area",
      },
    ]);
  });

  it("repairs an existing Project item whose Status is missing", () => {
    const observed = observedState();
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: null,
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "plan",
      discrepancies: [],
      operations: [
        {
          type: "set-project-field",
          issueNumber: 55,
          field: "Status",
          value: "Backlog",
        },
      ],
    });
  });

  it("fails closed when the named issue is unavailable", () => {
    const result = planRentCottageReconciliation({
      intent: { type: "publish", issueNumber: 55 },
      observed: observedState({ issues: [] }),
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "issue.missing",
          message: "Approved issue #55 is unavailable",
        },
      ],
    });
  });

  it("publishes an ordinary issue from its live triage label and blocker text", () => {
    const observed = observedState();
    observed.issues.push(
      {
        id: 640,
        nodeId: "issue-node-64",
        number: 64,
        title: "Improve shared controls",
        state: "OPEN",
        body: "## Blocked by\n\n- #52\n",
        labels: ["ready-for-agent"],
        assignees: [],
        blockers: [],
      },
      {
        id: 520,
        nodeId: "issue-node-52",
        number: 52,
        title: "Standards",
        state: "CLOSED",
        body: "## Blocked by\n\n- None.\n",
        labels: ["ready-for-agent"],
        assignees: [],
        blockers: [],
      },
    );
    const result = planRentCottageReconciliation({
      intent: {
        type: "publish",
        issueNumber: 64,
        area: "Foundation & quality",
      },
      observed,
      policy: policy(),
    });

    expect(result.outcome).toBe("plan");
    expect(result.operations).toEqual([
      {
        type: "add-native-blocker",
        issueNumber: 64,
        blockerNumber: 52,
        blockerDatabaseId: 520,
        reason: "#52 is declared as a blocker for #64",
      },
      {
        type: "add-project-item",
        issueNumber: 64,
        contentNodeId: "issue-node-64",
        reason: "#64 is approved for publication but missing from Project 4",
      },
      {
        type: "set-project-field",
        issueNumber: 64,
        field: "Area",
        value: "Foundation & quality",
        reason: "#64 must use the explicitly approved Area",
      },
      {
        type: "set-project-field",
        issueNumber: 64,
        field: "Status",
        value: "Backlog",
        reason: "A newly published issue starts in Backlog",
      },
    ]);
  });

  it.each([
    {
      name: "unknown Area",
      area: "Not a Project Area",
      labels: ["ready-for-agent"],
      body: "## Blocked by\n\n- None.\n",
      code: "publication.area.unknown",
    },
    {
      name: "ambiguous triage labels",
      area: "Foundation & quality",
      labels: ["ready-for-agent", "needs-info"],
      body: "## Blocked by\n\n- None.\n",
      code: "publication.triage_label",
    },
    {
      name: "duplicate Blocked by sections",
      area: "Foundation & quality",
      labels: ["ready-for-agent"],
      body: "## Blocked by\n\n- None.\n\n## Notes\n\nText.\n\n## Blocked by\n\n- None.\n",
      code: "publication.blocker_section",
    },
  ])("fails closed for ordinary publication with $name", (scenario) => {
    const observed = observedState();
    observed.issues.push({
      id: 640,
      nodeId: "issue-node-64",
      number: 64,
      title: "Improve shared controls",
      state: "OPEN",
      body: scenario.body,
      labels: scenario.labels,
      assignees: [],
      blockers: [],
    });

    const result = planRentCottageReconciliation({
      intent: { type: "publish", issueNumber: 64, area: scenario.area },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [expect.objectContaining({ code: scenario.code })],
    });
  });

  it("rejects a contradictory Area for a protected issue", () => {
    const result = planRentCottageReconciliation({
      intent: { type: "publish", issueNumber: 55, area: "Owner backoffice" },
      observed: observedState(),
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "publication.area.protected",
          message: "Protected #55 requires Area Foundation & quality",
        },
      ],
    });
  });

  it("plans an explicit claim for an open unblocked issue", () => {
    const observed = observedState();
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "claim", issueNumber: 55, assignee: "zaingulel" },
      observed,
      policy: policy(),
    });

    expect(result.operations).toEqual([
      {
        type: "add-assignee",
        issueNumber: 55,
        assignee: "zaingulel",
        reason: "The explicit claim records active ownership for #55",
      },
      {
        type: "set-project-field",
        issueNumber: 55,
        field: "Status",
        value: "In progress",
        reason: "Explicitly selected work belongs in In progress",
      },
    ]);
  });

  it("refuses to claim work while a native blocker is open", () => {
    const approved = policy();
    approved.issues.get(55).blockers = [52];
    const observed = observedState();
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];
    observed.issues[0].body = "## Blocked by\n\n- #52\n";
    observed.issues[0].blockers = [{ id: 520, number: 52, state: "OPEN" }];

    const result = planRentCottageReconciliation({
      intent: { type: "claim", issueNumber: 55, assignee: "zaingulel" },
      observed,
      policy: approved,
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "claim.blocked",
          message: "#55 cannot be claimed while open blockers=#52",
        },
      ],
    });
  });

  it("claims a well-formed ordinary issue without a checked-in policy entry", () => {
    const observed = observedState();
    addOrdinaryProjectIssue(observed);

    const result = planRentCottageReconciliation({
      intent: { type: "claim", issueNumber: 63, assignee: "zaingulel" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "plan",
      discrepancies: [],
      operations: [
        {
          type: "add-assignee",
          issueNumber: 63,
          assignee: "zaingulel",
        },
        {
          type: "set-project-field",
          issueNumber: 63,
          field: "Status",
          value: "In progress",
        },
      ],
    });
  });

  it("refuses to claim a closed issue", () => {
    const observed = observedState();
    observed.issues[0].state = "CLOSED";
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "claim", issueNumber: 55, assignee: "zaingulel" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "claim.issue_ineligible",
        },
      ],
    });
  });

  it("refuses to move an open issue backward from Done to In progress", () => {
    const observed = observedState();
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Done",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "claim", issueNumber: 55, assignee: "zaingulel" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [{ code: "claim.status_invalid" }],
    });
  });

  it("blocks lifecycle writes when publication metadata is incomplete", () => {
    const observed = observedState();
    observed.issues[0].labels = [];
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "claim", issueNumber: 55, assignee: "zaingulel" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "lifecycle.publication_incomplete",
          message:
            "#55 must match its approved publication state before a lifecycle transition",
        },
      ],
    });
  });

  it("blocks lifecycle writes when the issue is missing from Project 4", () => {
    const result = planRentCottageReconciliation({
      intent: { type: "claim", issueNumber: 55, assignee: "zaingulel" },
      observed: observedState(),
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "lifecycle.publication_incomplete",
        },
      ],
    });
  });

  it.each(["review", "closeout"])(
    "blocks ordinary %s when repository issue evidence is missing",
    (type) => {
      const observed = observedState({ issues: [] });
      observed.project.items = [
        {
          id: "item-63",
          issueNumber: 63,
          area: "Foundation & quality",
          status: type === "review" ? "In progress" : "In review",
        },
      ];

      const result = planRentCottageReconciliation({
        intent: { type, issueNumber: 63, pullRequestNumber: 70 },
        observed,
        policy: policy(),
      });

      expect(result).toMatchObject({
        outcome: "blocked",
        operations: [],
        discrepancies: [
          {
            code: "issue.missing",
            message: "Selected issue #63 is unavailable",
          },
        ],
      });
    },
  );

  it("blocks lifecycle writes when Project 4 contains duplicate named items", () => {
    const observed = observedState();
    observed.project.items = ["a", "b"].map((suffix) => ({
      id: `item-55-${suffix}`,
      issueNumber: 55,
      area: "Foundation & quality",
      status: "Backlog",
    }));

    const result = planRentCottageReconciliation({
      intent: { type: "claim", issueNumber: 55, assignee: "zaingulel" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "project.item.duplicate",
          message: "Project 4 contains duplicate item #55",
        },
      ],
    });
  });

  it("plans In review only for the named active pull request with a closing reference", () => {
    const observed = observedState({
      pullRequests: [
        {
          number: 70,
          repository: "zaingulel/RentCottage",
          state: "OPEN",
          draft: false,
          mergedAt: null,
          closingIssues: [55],
        },
      ],
    });
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "In progress",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "review", issueNumber: 55, pullRequestNumber: 70 },
      observed,
      policy: policy(),
    });

    expect(result.operations).toEqual([
      {
        type: "set-project-field",
        issueNumber: 55,
        field: "Status",
        value: "In review",
        reason: "Active delivery pull request #70 closes #55",
      },
    ]);
  });

  it("moves an ordinary Project issue into review without a policy entry", () => {
    const observed = observedState({
      pullRequests: [
        {
          number: 70,
          repository: "zaingulel/RentCottage",
          state: "OPEN",
          draft: false,
          mergedAt: null,
          closingIssues: [63],
        },
      ],
    });
    addOrdinaryProjectIssue(observed, { status: "In progress" });

    const result = planRentCottageReconciliation({
      intent: { type: "review", issueNumber: 63, pullRequestNumber: 70 },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "plan",
      discrepancies: [],
      operations: [
        {
          type: "set-project-field",
          issueNumber: 63,
          field: "Status",
          value: "In review",
        },
      ],
    });
  });

  it("plans In review for one explicit Project-linked delivery pull request", () => {
    const observed = observedState({
      pullRequests: [
        {
          number: 70,
          repository: "zaingulel/RentCottage",
          state: "OPEN",
          draft: false,
          mergedAt: null,
          closingIssues: [],
          linkedIssues: [55],
        },
      ],
    });
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "In progress",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "review", issueNumber: 55, pullRequestNumber: 70 },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "plan",
      discrepancies: [],
      operations: [
        {
          type: "set-project-field",
          issueNumber: 55,
          field: "Status",
          value: "In review",
        },
      ],
    });
  });

  it("fails closed when a delivery pull request ambiguously closes more than one issue", () => {
    const observed = observedState({
      pullRequests: [
        {
          number: 70,
          repository: "zaingulel/RentCottage",
          state: "OPEN",
          draft: false,
          mergedAt: null,
          closingIssues: [55, 56],
        },
      ],
    });
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "In progress",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "review", issueNumber: 55, pullRequestNumber: 70 },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "review.pull_request_invalid",
          message:
            "Pull request #70 is not an active unambiguous delivery link for #55",
        },
      ],
    });
  });

  it("fails closed when two active delivery pull requests close the same issue", () => {
    const observed = observedState({
      pullRequests: [70, 71].map((number) => ({
        number,
        repository: "zaingulel/RentCottage",
        state: "OPEN",
        draft: false,
        mergedAt: null,
        closingIssues: [55],
      })),
    });
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "In progress",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "review", issueNumber: 55, pullRequestNumber: 70 },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "review.pull_request_invalid",
        },
      ],
    });
  });

  it("treats a draft closing pull request as a conflicting delivery link", () => {
    const observed = observedState({
      pullRequests: [
        {
          number: 70,
          repository: "zaingulel/RentCottage",
          state: "OPEN",
          draft: false,
          mergedAt: null,
          closingIssues: [55],
        },
        {
          number: 71,
          repository: "zaingulel/RentCottage",
          state: "OPEN",
          draft: true,
          mergedAt: null,
          closingIssues: [55],
        },
      ],
    });
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "In progress",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "review", issueNumber: 55, pullRequestNumber: 70 },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [{ code: "review.pull_request_invalid" }],
    });
  });

  it.each([
    ["blocked", "OPEN", [{ id: 520, number: 52, state: "OPEN" }]],
    ["closed", "CLOSED", []],
  ])("refuses to move %s work into review", (_case, state, blockers) => {
    const approved = policy();
    approved.issues.get(55).blockers = blockers.map(({ number }) => number);
    const observed = observedState({
      pullRequests: [
        {
          number: 70,
          repository: "zaingulel/RentCottage",
          state: "OPEN",
          draft: false,
          mergedAt: null,
          closingIssues: [55],
        },
      ],
    });
    observed.issues[0].state = state;
    observed.issues[0].blockers = blockers;
    if (blockers.length > 0)
      observed.issues[0].body = "## Blocked by\n\n- #52\n";
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "In progress",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "review", issueNumber: 55, pullRequestNumber: 70 },
      observed,
      policy: approved,
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "review.issue_ineligible",
        },
      ],
    });
  });

  it("plans Done only after the named closing pull request is merged and the issue is closed", () => {
    const observed = observedState({
      pullRequests: [
        {
          number: 70,
          repository: "zaingulel/RentCottage",
          state: "MERGED",
          draft: false,
          mergedAt: "2026-08-14T20:00:00Z",
          closingIssues: [55],
        },
      ],
    });
    observed.issues[0].state = "CLOSED";
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "In review",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "closeout", issueNumber: 55, pullRequestNumber: 70 },
      observed,
      policy: policy(),
    });

    expect(result.operations).toEqual([
      {
        type: "set-project-field",
        issueNumber: 55,
        field: "Status",
        value: "Done",
        reason: "Merged delivery pull request #70 closed #55",
      },
    ]);
  });

  it("closes out an ordinary Project issue without a policy entry", () => {
    const observed = observedState({
      pullRequests: [
        {
          number: 70,
          repository: "zaingulel/RentCottage",
          state: "MERGED",
          draft: false,
          mergedAt: "2026-08-14T20:00:00Z",
          closingIssues: [63],
        },
      ],
    });
    addOrdinaryProjectIssue(observed, {
      state: "CLOSED",
      status: "In review",
    });

    const result = planRentCottageReconciliation({
      intent: { type: "closeout", issueNumber: 63, pullRequestNumber: 70 },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "plan",
      discrepancies: [],
      operations: [
        {
          type: "set-project-field",
          issueNumber: 63,
          field: "Status",
          value: "Done",
        },
      ],
    });
  });

  it("fails closeout when another active pull request also closes the issue", () => {
    const observed = observedState({
      pullRequests: [
        {
          number: 70,
          repository: "zaingulel/RentCottage",
          state: "MERGED",
          draft: false,
          mergedAt: "2026-08-14T20:00:00Z",
          closingIssues: [55],
        },
        {
          number: 71,
          repository: "zaingulel/RentCottage",
          state: "OPEN",
          draft: false,
          mergedAt: null,
          closingIssues: [55],
        },
      ],
    });
    observed.issues[0].state = "CLOSED";
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "In review",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "closeout", issueNumber: 55, pullRequestNumber: 70 },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "closeout.delivery_invalid",
        },
      ],
    });
  });

  it("accepts a well-formed new repository issue already on Project 4", () => {
    const observed = observedState();
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];
    addOrdinaryProjectIssue(observed, { number: 999 });

    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "noop",
      operations: [],
      dependencyFrontier: [55, 999],
      discrepancies: [],
    });
  });

  it("normalizes lowercase blocker state before checking active Project status", () => {
    const observed = observedState();
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];
    addOrdinaryProjectIssue(observed, {
      number: 999,
      status: "Ready",
      body: "## Blocked by\n\n- #52\n",
      blockers: [{ id: 520, number: 52, state: "open" }],
    });

    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      discrepancies: [
        {
          code: "project.status.blocked",
          message: "#999 cannot be Ready while blockers are open",
        },
      ],
    });
  });

  it("blocks textual and native dependency drift on an ordinary Project issue", () => {
    const observed = observedState();
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];
    addOrdinaryProjectIssue(observed, {
      body: "## Blocked by\n\n- #52\n",
      blockers: [],
    });

    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "issue.blockers.mismatch",
          message: "#63 textual blockers do not match its native dependencies",
        },
      ],
    });
  });

  it("requires ordinary Project issues to declare their blocker section", () => {
    const observed = observedState();
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];
    addOrdinaryProjectIssue(observed, { body: "## Acceptance criteria\n" });

    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "issue.blocker_section",
          message: "#63 requires exactly one canonical Blocked by section",
        },
      ],
    });
  });

  it("audits ordinary triage shape and excludes malformed work from the dependency frontier", () => {
    const observed = observedState();
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];
    addOrdinaryProjectIssue(observed, { number: 63, labels: [] });

    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      discrepancies: [
        {
          code: "issue.triage_label",
          message: "#63 requires exactly one canonical triage label",
        },
      ],
    });
    expect(result.dependencyFrontier).not.toContain(63);
  });

  it.each(["needs-triage", "needs-info", "ready-for-human", "wontfix"])(
    "excludes an ordinary %s issue from the dependency frontier",
    (label) => {
      const observed = observedState();
      observed.project.items = [
        {
          id: "item-55",
          issueNumber: 55,
          area: "Foundation & quality",
          status: "Backlog",
        },
      ];
      addOrdinaryProjectIssue(observed, { labels: [label] });

      const result = planRentCottageReconciliation({
        intent: { type: "audit" },
        observed,
        policy: policy(),
      });

      expect(result.dependencyFrontier).not.toContain(63);
    },
  );

  it.each([
    { name: "missing Area", area: null },
    { name: "unknown Area", area: "Unknown area" },
    { name: "missing Status", status: null },
    { name: "unknown Status", status: "Unknown status" },
    {
      name: "textual and native blocker drift",
      body: "## Blocked by\n\n- #52\n",
      blockers: [],
    },
  ])(
    "excludes an ordinary issue with $name from the dependency frontier",
    (scenario) => {
      const observed = observedState();
      observed.project.items = [
        {
          id: "item-55",
          issueNumber: 55,
          area: "Foundation & quality",
          status: "Backlog",
        },
      ];
      addOrdinaryProjectIssue(observed, scenario);

      const result = planRentCottageReconciliation({
        intent: { type: "audit" },
        observed,
        policy: policy(),
      });

      expect(result.dependencyFrontier).not.toContain(63);
    },
  );

  it.each([
    {
      name: "multiple triage labels",
      labels: ["ready-for-agent", "needs-info"],
      body: "## Blocked by\n\n- None.\n",
      code: "issue.triage_label",
    },
    {
      name: "duplicate Blocked by sections",
      labels: ["ready-for-agent"],
      body: "## Blocked by\n\n- None.\n\n## Notes\n\nText.\n\n## Blocked by\n\n- None.\n",
      code: "issue.blocker_section",
    },
  ])("audits ordinary issue with $name", (scenario) => {
    const observed = observedState();
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];
    addOrdinaryProjectIssue(observed, scenario);

    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed,
      policy: policy(),
    });

    expect(result.discrepancies).toContainEqual(
      expect.objectContaining({ code: scenario.code }),
    );
    expect(result.dependencyFrontier).not.toContain(63);
  });

  it("blocks an added Project issue whose Area is missing", () => {
    const observed = observedState();
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];
    addOrdinaryProjectIssue(observed, { number: 999, area: null });

    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "project.area.missing",
          message: "Project item #999 has no Area",
        },
      ],
    });
  });

  it("blocks an added Project issue whose Status is missing", () => {
    const observed = observedState();
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];
    addOrdinaryProjectIssue(observed, { number: 999, status: null });

    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "project.status.missing",
          message: "Project item #999 has no Status",
        },
      ],
    });
  });

  it("blocks a Project item whose repository issue is unavailable", () => {
    const observed = observedState();
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
      {
        id: "item-999",
        issueNumber: 999,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "project.issue.missing",
          message: "Project item #999 has no repository issue evidence",
        },
      ],
    });
  });

  it("rejects a historical issue that must stay off Project 4", () => {
    const approved = policy();
    approved.excludedProjectIssueNumbers = new Set([2]);
    const observed = observedState();
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];
    addOrdinaryProjectIssue(observed, {
      number: 2,
      state: "OPEN",
      status: "Backlog",
    });

    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed,
      policy: approved,
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      dependencyFrontier: [55],
      discrepancies: [
        {
          code: "project.item.obsolete",
          message: "Historical issue #2 must not remain on Project 4",
        },
      ],
    });
  });

  it.each([
    {
      type: "claim",
      state: "OPEN",
      status: "Backlog",
      pullRequests: [],
    },
    {
      type: "review",
      state: "OPEN",
      status: "In progress",
      pullRequests: [
        {
          number: 70,
          repository: "zaingulel/RentCottage",
          state: "OPEN",
          draft: false,
          mergedAt: null,
          closingIssues: [2],
        },
      ],
    },
    {
      type: "closeout",
      state: "CLOSED",
      status: "In review",
      pullRequests: [
        {
          number: 70,
          repository: "zaingulel/RentCottage",
          state: "MERGED",
          draft: false,
          mergedAt: "2026-08-14T20:00:00Z",
          closingIssues: [2],
        },
      ],
    },
  ])("rejects explicit $type for an obsolete historical issue", (scenario) => {
    const approved = policy();
    approved.excludedProjectIssueNumbers = new Set([2]);
    const observed = observedState({ pullRequests: scenario.pullRequests });
    addOrdinaryProjectIssue(observed, {
      number: 2,
      state: scenario.state,
      status: scenario.status,
    });
    const intent = {
      type: scenario.type,
      issueNumber: 2,
      ...(scenario.type === "claim"
        ? { assignee: "zaingulel" }
        : { pullRequestNumber: 70 }),
    };

    const result = planRentCottageReconciliation({
      intent,
      observed,
      policy: approved,
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "project.item.obsolete",
          message: "Historical issue #2 must not remain on Project 4",
        },
      ],
    });
  });

  it("keeps an ordinary owner-gated issue out of active status and the dependency frontier", () => {
    const observed = observedState();
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];
    addOrdinaryProjectIssue(observed, {
      number: 63,
      status: "Ready",
      labels: ["ready-for-agent", "owner-gated"],
    });

    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      discrepancies: [
        {
          code: "project.status.owner_gated",
          message: "Owner-gated #63 cannot be Ready without an approved claim",
        },
      ],
      dependencyFrontier: [55],
    });
  });

  it("fails closed on an unknown dependency state and excludes it from the frontier", () => {
    const observed = observedState();
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];
    addOrdinaryProjectIssue(observed, {
      number: 63,
      body: "## Blocked by\n\n- #52\n",
      blockers: [{ number: 52, state: "UNKNOWN" }],
    });

    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "issue.blocker_state",
          message: "#63 native dependency #52 has unknown state UNKNOWN",
        },
      ],
      dependencyFrontier: [55],
    });
  });

  it("preserves an optional owner gate on a protected issue", () => {
    const observed = observedState();
    observed.issues[0].labels.push("owner-gated");
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "noop",
      operations: [],
      discrepancies: [],
      dependencyFrontier: [],
    });
  });

  it("rejects an unknown protected label without removing the optional owner gate", () => {
    const observed = observedState();
    observed.issues[0].labels.push("owner-gated", "unknown-role");
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed,
      policy: policy(),
    });

    expect(result.outcome).toBe("plan");
    expect(result.operations).toContainEqual({
      type: "set-issue-labels",
      issueNumber: 55,
      labels: ["ready-for-agent", "owner-gated"],
      reason: "#55 labels must match the approved tracker policy",
    });
    expect(result.dependencyFrontier).not.toContain(55);
  });

  it("audits every approved issue and plans missing Project membership", () => {
    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed: observedState(),
      policy: policy(),
    });

    expect(result.outcome).toBe("plan");
    expect(
      result.operations.map(({ type, issueNumber }) => [type, issueNumber]),
    ).toEqual([
      ["add-project-item", 55],
      ["set-project-field", 55],
      ["set-project-field", 55],
    ]);
  });

  it("plans exact labels plus textual and native blockers during publication", () => {
    const approved = policy();
    approved.issues.get(55).blockers = [52];
    const observed = observedState();
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];
    observed.issues[0].labels = [];
    observed.issues.push({
      id: 520,
      nodeId: "issue-node-52",
      number: 52,
      title: "Standards",
      state: "CLOSED",
      body: "",
      labels: [],
      assignees: [],
      blockers: [],
    });

    const result = planRentCottageReconciliation({
      intent: { type: "publish", issueNumber: 55 },
      observed,
      policy: approved,
    });

    expect(result.operations).toEqual([
      {
        type: "set-issue-labels",
        issueNumber: 55,
        labels: ["ready-for-agent"],
        reason: "#55 labels must match the approved tracker policy",
      },
      {
        type: "set-blocker-text",
        issueNumber: 55,
        blockers: [52],
        blockedBySection: "## Blocked by\n\n- #52\n",
        body: "## Blocked by\n\n- #52\n",
        reason: "#55 blocker text must match its native dependencies",
      },
      {
        type: "add-native-blocker",
        issueNumber: 55,
        blockerNumber: 52,
        blockerDatabaseId: 520,
        reason: "#52 is an approved blocker for #55",
      },
    ]);
  });

  it("updates only the real canonical blocker section during protected publication", () => {
    const approved = policy();
    approved.issues.get(55).blockers = [52];
    const observed = observedState();
    observed.issues[0].body =
      "Inline example: ## Blocked by\n\n- #999\n\n## Blocked by\n\n- None.\n";
    observed.issues.push({
      id: 520,
      nodeId: "issue-node-52",
      number: 52,
      title: "Standards",
      state: "CLOSED",
      body: "",
      labels: [],
      assignees: [],
      blockers: [],
    });

    const result = planRentCottageReconciliation({
      intent: { type: "publish", issueNumber: 55 },
      observed,
      policy: approved,
    });

    expect(
      result.operations.find(({ type }) => type === "set-blocker-text"),
    ).toMatchObject({
      body: "Inline example: ## Blocked by\n\n- #999\n\n## Blocked by\n\n- #52\n",
    });
  });

  it("fails publication before writes when an approved blocker issue is unavailable", () => {
    const approved = policy();
    approved.issues.get(55).blockers = [52];
    const observed = observedState();
    observed.issues[0].body = "## Blocked by\n\n- #52\n";
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "publish", issueNumber: 55 },
      observed,
      policy: approved,
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "publication.blocker_unavailable",
          message: "Approved blocker #52 for #55 is unavailable",
        },
      ],
    });
  });

  it("fails named publication when Project 4 contains duplicate items", () => {
    const observed = observedState();
    observed.project.items = ["a", "b"].map((suffix) => ({
      id: `item-55-${suffix}`,
      issueNumber: 55,
      area: "Foundation & quality",
      status: "Backlog",
    }));

    const result = planRentCottageReconciliation({
      intent: { type: "publish", issueNumber: 55 },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [{ code: "project.item.duplicate" }],
    });
  });

  it("fails closed instead of planning a no-op body write when the blocker section is missing", () => {
    const approved = policy();
    approved.issues.get(55).blockers = [52];
    const observed = observedState();
    observed.issues[0].body =
      "## Acceptance criteria\n\n- [ ] Keep the tracker correct.\n";
    observed.issues.push({
      id: 520,
      nodeId: "issue-node-52",
      number: 52,
      title: "Standards",
      state: "CLOSED",
      body: "",
      labels: [],
      assignees: [],
      blockers: [],
    });

    const result = planRentCottageReconciliation({
      intent: { type: "publish", issueNumber: 55 },
      observed,
      policy: approved,
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "issue.blocker_section",
          message: "#55 is missing the canonical Blocked by section",
        },
      ],
    });
  });

  it("fails closed when an issue title contradicts the approved policy", () => {
    const observed = observedState();
    observed.issues[0].title = "A different outcome";

    const result = planRentCottageReconciliation({
      intent: { type: "publish", issueNumber: 55 },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "issue.title",
          message: "#55 title does not match the approved tracker policy",
        },
      ],
    });
  });

  it("fails closed when replacement-ticket acceptance criteria contradict the approved policy", () => {
    const approved = policy();
    approved.issues.get(55).acceptanceCriteria = [
      "A stable dry-run command prints an ordered plan.",
    ];
    const observed = observedState();
    observed.issues[0].body =
      "## Acceptance criteria\n\n- [ ] A different criterion.\n\n## Blocked by\n\n- None.\n";

    const result = planRentCottageReconciliation({
      intent: { type: "publish", issueNumber: 55 },
      observed,
      policy: approved,
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "issue.criteria",
          message:
            "#55 acceptance criteria do not match the approved tracker policy",
        },
      ],
    });
  });

  it("fails closed when any authoritative read is incomplete", () => {
    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed: observedState({
        complete: false,
        evidenceErrors: ["Project items pagination was truncated"],
      }),
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "evidence.incomplete",
          message: "Project items pagination was truncated",
        },
      ],
    });
  });

  it("fails closed when Project 4 contains a duplicate item", () => {
    const observed = observedState();
    observed.project.items = [
      {
        id: "item-55-a",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
      {
        id: "item-55-b",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "project.item.duplicate",
          message: "Project 4 contains duplicate item #55",
        },
      ],
    });
  });

  it("reports a merged closing pull request whose issue remains open", () => {
    const observed = observedState({
      pullRequests: [
        {
          number: 70,
          repository: "zaingulel/RentCottage",
          state: "MERGED",
          draft: false,
          mergedAt: "2026-08-14T20:00:00Z",
          closingIssues: [55],
        },
      ],
    });
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "In review",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      discrepancies: [
        {
          code: "delivery.merged_issue_open",
          message: "Merged pull request #70 closes still-open issue #55",
        },
      ],
    });
  });

  it("reports a merged Project-linked pull request whose issue remains open", () => {
    const observed = observedState({
      pullRequests: [
        {
          number: 70,
          repository: "zaingulel/RentCottage",
          state: "MERGED",
          draft: false,
          mergedAt: "2026-08-14T20:00:00Z",
          closingIssues: [],
          linkedIssues: [55],
        },
      ],
    });
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "In review",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      discrepancies: [
        {
          code: "delivery.merged_issue_open",
          message: "Merged pull request #70 is linked to still-open issue #55",
        },
      ],
    });
  });

  it("reports conflicting active delivery links during the global audit", () => {
    const observed = observedState({
      pullRequests: [70, 71].map((number) => ({
        number,
        repository: "zaingulel/RentCottage",
        state: "OPEN",
        draft: false,
        mergedAt: null,
        closingIssues: [55],
      })),
    });
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "In progress",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "delivery.link_ambiguous",
          message: "Issue #55 has ambiguous or conflicting delivery links",
        },
      ],
    });
  });

  it("fails closed when a closed issue retains an active Project status", () => {
    const observed = observedState();
    observed.issues[0].state = "CLOSED";
    observed.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "In progress",
      },
    ];

    const result = planRentCottageReconciliation({
      intent: { type: "audit" },
      observed,
      policy: policy(),
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      discrepancies: [
        {
          code: "project.status.closed",
          message: "Closed #55 cannot remain In progress",
        },
      ],
    });
  });
});

describe("RentCottage reconciliation command", () => {
  it("returns a dry-run plan after one authoritative read and performs no writes", async () => {
    const github = {
      observe: vi.fn().mockResolvedValue(observedState()),
      execute: vi.fn(),
    };
    const verify = vi.fn();

    const result = await runRentCottageReconciliation(
      {
        intent: { type: "publish", issueNumber: 55 },
        apply: false,
      },
      { github, policy: policy(), verify },
    );

    expect(result.outcome).toBe("plan");
    expect(github.observe).toHaveBeenCalledTimes(1);
    expect(github.execute).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it("refuses every write when the supplied plan fingerprint is stale", async () => {
    const github = {
      observe: vi.fn().mockResolvedValue(observedState()),
      execute: vi.fn(),
    };
    const verify = vi.fn();

    const result = await runRentCottageReconciliation(
      {
        intent: { type: "publish", issueNumber: 55 },
        apply: true,
        planId: `sha256:${"0".repeat(64)}`,
      },
      { github, policy: policy(), verify },
    );

    expect(result).toMatchObject({
      outcome: "blocked",
      discrepancies: [
        {
          code: "apply.plan_mismatch",
          message: "Apply requires the exact current dry-run plan fingerprint",
        },
      ],
    });
    expect(github.execute).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it("applies one current operation at a time, re-reads after each write, and verifies the final state", async () => {
    const initial = observedState();
    initial.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];
    const claimed = structuredClone(initial);
    claimed.issues[0].assignees = ["zaingulel"];
    const inProgress = structuredClone(claimed);
    inProgress.project.items[0].status = "In progress";
    const intent = { type: "claim", issueNumber: 55, assignee: "zaingulel" };
    const dryRun = planRentCottageReconciliation({
      intent,
      observed: initial,
      policy: policy(),
    });
    const github = {
      observe: vi
        .fn()
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(claimed)
        .mockResolvedValueOnce(inProgress),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const verify = vi.fn().mockResolvedValue({ ok: true });

    const result = await runRentCottageReconciliation(
      { intent, apply: true, planId: dryRun.planId },
      { github, policy: policy(), verify },
    );

    expect(result).toMatchObject({ outcome: "applied", appliedOperations: 2 });
    expect(github.execute).toHaveBeenCalledTimes(2);
    expect(github.observe).toHaveBeenCalledTimes(3);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("changes the plan fingerprint with Set membership but not insertion order", () => {
    const observed = observedState();
    const leftPolicy = policy();
    leftPolicy.fingerprintEvidence = new Set(["alpha", "beta"]);
    const reorderedPolicy = policy();
    reorderedPolicy.fingerprintEvidence = new Set(["beta", "alpha"]);
    const changedPolicy = policy();
    changedPolicy.fingerprintEvidence = new Set(["alpha", "gamma"]);
    const intent = { type: "audit" };

    const left = planRentCottageReconciliation({
      intent,
      observed,
      policy: leftPolicy,
    });
    const reordered = planRentCottageReconciliation({
      intent,
      observed,
      policy: reorderedPolicy,
    });
    const changed = planRentCottageReconciliation({
      intent,
      observed,
      policy: changedPolicy,
    });

    expect(reordered.planId).toBe(left.planId);
    expect(changed.planId).not.toBe(left.planId);
  });

  it("stops when the authoritative re-read changes the approved remaining operation list", async () => {
    const approved = policy();
    approved.issues.get(55).blockers = [52];
    const initial = observedState();
    initial.issues[0].labels = [];
    initial.issues.push({
      id: 520,
      nodeId: "issue-node-52",
      number: 52,
      title: "Standards",
      state: "CLOSED",
      body: "## Blocked by\n\n- None.\n",
      labels: [],
      assignees: [],
      blockers: [],
    });
    const changed = structuredClone(initial);
    changed.issues[0].labels = ["ready-for-agent"];
    changed.issues[0].body = "## Blocked by\n\n- #52\n";
    const intent = { type: "publish", issueNumber: 55 };
    const dryRun = planRentCottageReconciliation({
      intent,
      observed: initial,
      policy: approved,
    });
    const github = {
      observe: vi
        .fn()
        .mockResolvedValue(changed)
        .mockResolvedValueOnce(initial),
      execute: vi.fn().mockResolvedValue(undefined),
    };

    const result = await runRentCottageReconciliation(
      { intent, apply: true, planId: dryRun.planId },
      {
        github,
        policy: approved,
        verify: vi.fn(),
      },
    );

    expect(result).toMatchObject({
      outcome: "failed",
      operations: [],
      discrepancies: [
        {
          code: "apply.plan_drift",
          message:
            "Authoritative re-read changed the approved remaining operation list; run a new dry-run",
        },
      ],
    });
    expect(github.execute).toHaveBeenCalledTimes(1);
    expect(github.observe).toHaveBeenCalledTimes(2);
  });

  it("stops when the authoritative re-read reorders the approved remaining operations", async () => {
    const initial = observedState();
    initial.issues.push({
      id: 640,
      nodeId: "issue-node-64",
      number: 64,
      title: "Improve shared controls",
      state: "OPEN",
      body: "## Blocked by\n\n- None.\n",
      labels: ["ready-for-agent"],
      assignees: [],
      blockers: [52, 53, 54].map((number) => ({
        id: number * 10,
        number,
        state: "CLOSED",
      })),
    });
    const reordered = structuredClone(initial);
    reordered.issues.find(({ number }) => number === 64).blockers = [
      54, 53,
    ].map((number) => ({ id: number * 10, number, state: "CLOSED" }));
    const intent = {
      type: "publish",
      issueNumber: 64,
      area: "Foundation & quality",
    };
    const approved = policy();
    const dryRun = planRentCottageReconciliation({
      intent,
      observed: initial,
      policy: approved,
    });
    const github = {
      observe: vi
        .fn()
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(reordered),
      execute: vi.fn().mockResolvedValue(undefined),
    };

    const result = await runRentCottageReconciliation(
      { intent, apply: true, planId: dryRun.planId },
      { github, policy: approved, verify: vi.fn() },
    );

    expect(result).toMatchObject({
      outcome: "failed",
      operations: [],
      discrepancies: [
        {
          code: "apply.plan_drift",
          message:
            "Authoritative re-read changed the approved remaining operation list; run a new dry-run",
        },
      ],
    });
    expect(github.execute).toHaveBeenCalledTimes(1);
  });

  it("treats a timed-out write as successful only when the authoritative re-read proves it landed", async () => {
    const initial = observedState({
      pullRequests: [
        {
          number: 70,
          repository: "zaingulel/RentCottage",
          state: "MERGED",
          draft: false,
          mergedAt: "2026-08-14T20:00:00Z",
          closingIssues: [55],
        },
      ],
    });
    initial.issues[0].state = "CLOSED";
    initial.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "In review",
      },
    ];
    const done = structuredClone(initial);
    done.project.items[0].status = "Done";
    const intent = {
      type: "closeout",
      issueNumber: 55,
      pullRequestNumber: 70,
    };
    const dryRun = planRentCottageReconciliation({
      intent,
      observed: initial,
      policy: policy(),
    });
    const github = {
      observe: vi
        .fn()
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(done),
      execute: vi.fn().mockRejectedValue(new Error("request timed out")),
    };

    const result = await runRentCottageReconciliation(
      { intent, apply: true, planId: dryRun.planId },
      {
        github,
        policy: policy(),
        verify: vi.fn().mockResolvedValue({ ok: true }),
      },
    );

    expect(result).toMatchObject({ outcome: "applied", appliedOperations: 1 });
    expect(github.observe).toHaveBeenCalledTimes(2);
  });

  it("reports plan drift when an uncertain write leaves the attempted operation required", async () => {
    const initial = observedState();
    initial.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];
    const intent = { type: "claim", issueNumber: 55, assignee: "zaingulel" };
    const dryRun = planRentCottageReconciliation({
      intent,
      observed: initial,
      policy: policy(),
    });
    const github = {
      observe: vi.fn().mockResolvedValue(initial),
      execute: vi.fn().mockRejectedValue(new Error("request timed out")),
    };

    const result = await runRentCottageReconciliation(
      { intent, apply: true, planId: dryRun.planId },
      {
        github,
        policy: policy(),
        verify: vi.fn(),
      },
    );

    expect(result).toMatchObject({
      outcome: "failed",
      operations: [],
      discrepancies: [
        {
          code: "apply.plan_drift",
          message:
            "Authoritative re-read changed the approved remaining operation list; run a new dry-run",
        },
      ],
    });
    expect(github.execute).toHaveBeenCalledTimes(1);
    expect(github.observe).toHaveBeenCalledTimes(2);
  });

  it("reports apply.write_unconfirmed when the exact remaining plan is blocked after a write", async () => {
    const initial = observedState({
      pullRequests: [
        {
          number: 70,
          repository: "zaingulel/RentCottage",
          state: "MERGED",
          draft: false,
          mergedAt: "2026-08-14T20:00:00Z",
          closingIssues: [55],
        },
      ],
    });
    initial.issues[0].state = "CLOSED";
    initial.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "In review",
      },
    ];
    const unavailable = observedState({
      complete: false,
      evidenceErrors: ["Authoritative GitHub evidence became unavailable"],
    });
    const intent = {
      type: "closeout",
      issueNumber: 55,
      pullRequestNumber: 70,
    };
    const dryRun = planRentCottageReconciliation({
      intent,
      observed: initial,
      policy: policy(),
    });
    const github = {
      observe: vi
        .fn()
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(unavailable),
      execute: vi.fn().mockRejectedValue(new Error("request timed out")),
    };

    const result = await runRentCottageReconciliation(
      { intent, apply: true, planId: dryRun.planId },
      { github, policy: policy(), verify: vi.fn() },
    );

    expect(result).toMatchObject({
      outcome: "failed",
      operations: [],
      discrepancies: expect.arrayContaining([
        {
          code: "apply.write_unconfirmed",
          message:
            "Write could not be confirmed after re-read: request timed out",
        },
      ]),
    });
    expect(github.execute).toHaveBeenCalledTimes(1);
  });

  it("reports apply.verification_failed after the exact applied plan converges", async () => {
    const initial = observedState({
      pullRequests: [
        {
          number: 70,
          repository: "zaingulel/RentCottage",
          state: "MERGED",
          draft: false,
          mergedAt: "2026-08-14T20:00:00Z",
          closingIssues: [55],
        },
      ],
    });
    initial.issues[0].state = "CLOSED";
    initial.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "In review",
      },
    ];
    const done = structuredClone(initial);
    done.project.items[0].status = "Done";
    const intent = {
      type: "closeout",
      issueNumber: 55,
      pullRequestNumber: 70,
    };
    const dryRun = planRentCottageReconciliation({
      intent,
      observed: initial,
      policy: policy(),
    });
    const verify = vi.fn().mockResolvedValue({
      ok: false,
      message: "Independent board verification failed",
    });

    const result = await runRentCottageReconciliation(
      { intent, apply: true, planId: dryRun.planId },
      {
        github: {
          observe: vi
            .fn()
            .mockResolvedValueOnce(initial)
            .mockResolvedValueOnce(done),
          execute: vi.fn().mockResolvedValue(undefined),
        },
        policy: policy(),
        verify,
      },
    );

    expect(result).toMatchObject({
      outcome: "failed",
      discrepancies: [
        {
          code: "apply.verification_failed",
          message: "Independent board verification failed",
        },
      ],
    });
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("reports apply.operation_limit before a fifty-first write", async () => {
    const blockerNumbers = Array.from(
      { length: 51 },
      (_, index) => index + 100,
    );
    const approved = policy();
    approved.issues.get(55).blockers = blockerNumbers;
    const initial = observedState();
    initial.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];
    initial.issues[0].body = `## Blocked by\n\n${blockerNumbers
      .map((number) => `- #${number}`)
      .join("\n")}\n`;
    initial.issues.push(
      ...blockerNumbers.map((number) => ({
        id: number * 10,
        nodeId: `issue-node-${number}`,
        number,
        title: `Blocker ${number}`,
        state: "CLOSED",
        body: "## Blocked by\n\n- None.\n",
        labels: [],
        assignees: [],
        blockers: [],
      })),
    );
    const states = Array.from({ length: 51 }, (_, count) => {
      const state = structuredClone(initial);
      state.issues[0].blockers = blockerNumbers
        .slice(0, count)
        .map((number) => ({ id: number * 10, number, state: "CLOSED" }));
      return state;
    });
    const intent = { type: "publish", issueNumber: 55 };
    const dryRun = planRentCottageReconciliation({
      intent,
      observed: states[0],
      policy: approved,
    });
    expect(dryRun.operations).toHaveLength(51);
    let read = 0;
    const github = {
      observe: vi.fn(async () => states[Math.min(read++, 50)]),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const verify = vi.fn();

    const result = await runRentCottageReconciliation(
      { intent, apply: true, planId: dryRun.planId },
      { github, policy: approved, verify },
    );

    expect(result).toMatchObject({
      outcome: "failed",
      discrepancies: [
        {
          code: "apply.operation_limit",
          message: "Reconciliation exceeded the 50-operation safety limit",
        },
      ],
    });
    expect(github.execute).toHaveBeenCalledTimes(50);
    expect(verify).not.toHaveBeenCalled();
  });

  it("returns a verified no-op when the same reconciliation is repeated", async () => {
    const converged = observedState();
    converged.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];
    const intent = { type: "publish", issueNumber: 55 };
    const dryRun = planRentCottageReconciliation({
      intent,
      observed: converged,
      policy: policy(),
    });
    const github = {
      observe: vi.fn().mockResolvedValue(converged),
      execute: vi.fn(),
    };
    const verify = vi.fn().mockResolvedValue({ ok: true });

    const result = await runRentCottageReconciliation(
      { intent, apply: true, planId: dryRun.planId },
      { github, policy: policy(), verify },
    );

    expect(result).toMatchObject({ outcome: "noop", appliedOperations: 0 });
    expect(github.execute).not.toHaveBeenCalled();
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("rejects global audit apply before reading GitHub", async () => {
    const observed = observedState();
    const intent = { type: "audit" };
    const github = {
      observe: vi.fn().mockResolvedValue(observed),
      execute: vi.fn(),
    };

    const result = await runRentCottageReconciliation(
      { intent, apply: true, planId: `sha256:${"0".repeat(64)}` },
      {
        github,
        policy: policy(),
        verify: vi.fn(),
      },
    );

    expect(result).toMatchObject({
      outcome: "blocked",
      discrepancies: [
        {
          code: "apply.intent_not_specific",
          message: "Global audit is detection-only and cannot apply mutations",
        },
      ],
    });
    expect(github.observe).not.toHaveBeenCalled();
    expect(github.execute).not.toHaveBeenCalled();
  });
});

describe("RentCottage reconciliation CLI", () => {
  it.each(["-leading", "z".repeat(40), "invalid_login"])(
    "rejects invalid GitHub assignee login %s",
    (assignee) => {
      expect(() =>
        parseReconciliationArgs([
          "--intent",
          "claim",
          "--issue",
          "55",
          "--assignee",
          assignee,
        ]),
      ).toThrow("--assignee requires a GitHub login");
    },
  );

  it.each(["z", "zain-gulel", "legacy-", "z".repeat(39)])(
    "accepts valid GitHub assignee login %s",
    (assignee) => {
      expect(
        parseReconciliationArgs([
          "--intent",
          "claim",
          "--issue",
          "55",
          "--assignee",
          assignee,
        ]).intent.assignee,
      ).toBe(assignee);
    },
  );

  it("bounds final verification through the supported npm executable", () => {
    const execute = vi.fn();

    expect(verifyBoard({ execute })).toEqual({ ok: true });
    expect(execute).toHaveBeenCalledWith("npm", ["run", "verify:board"], {
      stdio: "inherit",
      timeout: 60_000,
    });
  });

  it("reports a bounded final verification timeout explicitly", () => {
    const execute = vi.fn(() => {
      throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
    });

    expect(verifyBoard({ execute })).toEqual({
      ok: false,
      message: "npm run verify:board timed out after 60000ms",
    });
  });

  it("reports final verification exit status without provider output", () => {
    const execute = vi.fn(() => {
      throw Object.assign(new Error("failed"), {
        status: 7,
        stdout: "private body",
        stderr: "private provider details",
      });
    });

    expect(verifyBoard({ execute })).toEqual({
      ok: false,
      message: "npm run verify:board exited 7",
    });
  });

  it("bounds and redacts unexpected provider errors at the public boundary", async () => {
    const privateBody = "private-graphql-body";
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    const stderr = vi.fn();

    const exitCode = await main([], {
      github: {
        observe: vi
          .fn()
          .mockRejectedValue(
            new Error(
              `Project query failed: ${privateBody} Bearer ${secret} ${"detail".repeat(5_000)}`,
            ),
          ),
        execute: vi.fn(),
      },
      policy: policy(),
      verify: vi.fn(),
      stdout: vi.fn(),
      stderr,
    });
    const diagnostic = stderr.mock.calls.flat().join(" ");

    expect(exitCode).toBe(1);
    expect(diagnostic).toContain("Project query failed");
    expect(diagnostic).not.toContain(secret);
    expect(diagnostic.length).toBeLessThan(1_500);
  });

  it("rejects invalid apply arguments before any GitHub read", async () => {
    const github = { observe: vi.fn(), execute: vi.fn() };
    const stderr = vi.fn();

    const exitCode = await main(
      [
        "--intent",
        "claim",
        "--issue",
        "55",
        "--assignee",
        "zaingulel",
        "--apply",
      ],
      {
        github,
        policy: policy(),
        verify: vi.fn(),
        stdout: vi.fn(),
        stderr,
      },
    );

    expect(exitCode).toBe(2);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("--apply requires --plan-id"),
    );
    expect(github.observe).not.toHaveBeenCalled();
  });

  it("rejects global audit apply arguments before any GitHub read", async () => {
    const github = { observe: vi.fn(), execute: vi.fn() };
    const stderr = vi.fn();

    const exitCode = await main(
      ["--apply", "--plan-id", `sha256:${"0".repeat(64)}`],
      {
        github,
        policy: policy(),
        verify: vi.fn(),
        stdout: vi.fn(),
        stderr,
      },
    );

    expect(exitCode).toBe(2);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("audit does not accept --apply"),
    );
    expect(github.observe).not.toHaveBeenCalled();
  });

  it("rejects identifiers that do not belong to the selected intent", async () => {
    const github = { observe: vi.fn(), execute: vi.fn() };
    const stderr = vi.fn();

    const exitCode = await main(
      ["--intent", "publish", "--issue", "55", "--assignee", "zaingulel"],
      {
        github,
        policy: policy(),
        verify: vi.fn(),
        stdout: vi.fn(),
        stderr,
      },
    );

    expect(exitCode).toBe(2);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("publish does not accept --assignee"),
    );
    expect(github.observe).not.toHaveBeenCalled();
  });

  it("requires an explicit Area only for publication", async () => {
    const github = { observe: vi.fn(), execute: vi.fn() };
    const stderr = vi.fn();

    const missingArea = await main(["--intent", "publish", "--issue", "64"], {
      github,
      policy: policy(),
      verify: vi.fn(),
      stdout: vi.fn(),
      stderr,
    });
    const claimWithArea = await main(
      [
        "--intent",
        "claim",
        "--issue",
        "64",
        "--assignee",
        "zaingulel",
        "--area",
        "Foundation & quality",
      ],
      {
        github,
        policy: policy(),
        verify: vi.fn(),
        stdout: vi.fn(),
        stderr,
      },
    );

    expect(missingArea).toBe(2);
    expect(claimWithArea).toBe(2);
    expect(stderr.mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining("publish requires --issue and --area"),
      expect.stringContaining("claim does not accept --area"),
    ]);
    expect(github.observe).not.toHaveBeenCalled();
  });

  it("uses distinct exit statuses for an applied change and a verified no-op", async () => {
    const converged = observedState();
    converged.project.items = [
      {
        id: "item-55",
        issueNumber: 55,
        area: "Foundation & quality",
        status: "Backlog",
      },
    ];

    const noOpExitCode = await main([], {
      github: {
        observe: vi.fn().mockResolvedValue(converged),
        execute: vi.fn(),
      },
      policy: policy(),
      verify: vi.fn(),
      stdout: vi.fn(),
      stderr: vi.fn(),
    });

    expect(noOpExitCode).toBe(5);

    const initial = structuredClone(converged);
    initial.issues[0].assignees = ["zaingulel"];
    const applied = structuredClone(initial);
    applied.project.items[0].status = "In progress";
    const intent = { type: "claim", issueNumber: 55, assignee: "zaingulel" };
    const dryRun = planRentCottageReconciliation({
      intent,
      observed: initial,
      policy: policy(),
    });
    const appliedExitCode = await main(
      [
        "--intent",
        "claim",
        "--issue",
        "55",
        "--assignee",
        "zaingulel",
        "--apply",
        "--plan-id",
        dryRun.planId,
      ],
      {
        github: {
          observe: vi
            .fn()
            .mockResolvedValueOnce(initial)
            .mockResolvedValueOnce(applied),
          execute: vi.fn().mockResolvedValue(undefined),
        },
        policy: policy(),
        verify: vi.fn().mockResolvedValue({ ok: true }),
        stdout: vi.fn(),
        stderr: vi.fn(),
      },
    );

    expect(appliedExitCode).toBe(0);
  });

  it("bounds issue-body data in dry-run output", async () => {
    const approved = policy();
    approved.issues.get(55).blockers = [52];
    const observed = observedState();
    const privateMarker = "private-marker-".repeat(2_000);
    observed.issues[0].body = `${privateMarker}\n\n## Blocked by\n\n- None.\n`;
    observed.issues.push({
      id: 520,
      nodeId: "issue-node-52",
      number: 52,
      title: "Standards",
      state: "CLOSED",
      body: "",
      labels: [],
      assignees: [],
      blockers: [],
    });
    const stdout = vi.fn();

    const exitCode = await main(["--intent", "publish", "--issue", "55"], {
      github: {
        observe: vi.fn().mockResolvedValue(observed),
        execute: vi.fn(),
      },
      policy: approved,
      verify: vi.fn(),
      stdout,
      stderr: vi.fn(),
    });

    const output = stdout.mock.calls[0][0];
    expect(exitCode).toBe(3);
    expect(output).not.toContain(privateMarker);
    expect(output).toContain('"bodySha256"');
    expect(output.length).toBeLessThan(10_000);
  });

  it("requires the identifiers needed by each explicit lifecycle intent", async () => {
    const github = { observe: vi.fn(), execute: vi.fn() };
    const stderr = vi.fn();

    const exitCode = await main(["--intent", "review", "--issue", "55"], {
      github,
      policy: policy(),
      verify: vi.fn(),
      stdout: vi.fn(),
      stderr,
    });

    expect(exitCode).toBe(2);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("review requires --issue and --pull-request"),
    );
    expect(github.observe).not.toHaveBeenCalled();
  });
});
