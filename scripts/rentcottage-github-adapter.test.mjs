import { describe, expect, it, vi } from "vitest";
import { createRentCottageGitHubAdapter } from "./lib/rentcottage-github-adapter.mjs";

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
          ownerGated: false,
        },
      ],
    ]),
  };
}

function completeSource() {
  const evidence = {
    project: {
      id: "project-4",
      number: 4,
      owner: { login: "zaingulel" },
      closed: false,
      items: { totalCount: 1 },
      fields: { totalCount: 3 },
    },
    fields: {
      totalCount: 3,
      fields: [
        {
          id: "field-area",
          name: "Area",
          options: [{ id: "area-foundation", name: "Foundation & quality" }],
        },
        {
          id: "field-status",
          name: "Status",
          options: [
            { id: "status-backlog", name: "Backlog" },
            { id: "status-ready", name: "Ready" },
            { id: "status-progress", name: "In progress" },
            { id: "status-review", name: "In review" },
            { id: "status-done", name: "Done" },
          ],
        },
        {
          id: "field-linked",
          name: "Linked pull requests",
        },
      ],
    },
    items: {
      totalCount: 1,
      items: [
        {
          id: "item-55",
          area: "Foundation & quality",
          status: "Backlog",
          content: {
            number: 55,
            type: "Issue",
            repository: "zaingulel/RentCottage",
          },
          "linked pull requests": [],
        },
      ],
    },
  };
  return {
    assertSupported: vi.fn().mockResolvedValue(undefined),
    readProjectEvidence: vi.fn().mockResolvedValue(evidence),
    listIssues: vi.fn().mockResolvedValue([
      {
        id: 550,
        node_id: "issue-node-55",
        number: 55,
        title: "Automate tracker reconciliation and Project 4 transitions",
        state: "open",
        body: "## Blocked by\n\n- None.\n",
        labels: [{ name: "ready-for-agent" }],
        assignees: [],
      },
    ]),
    listBlockedBy: vi.fn().mockResolvedValue([]),
    readPullRequest: vi.fn(),
    execute: vi.fn(),
  };
}

describe("RentCottage GitHub adapter", () => {
  it("normalizes complete Project, issue, and dependency evidence", async () => {
    const source = completeSource();
    const github = createRentCottageGitHubAdapter({
      source,
      policy: policy(),
    });

    const observed = await github.observe({ type: "audit" });

    expect(observed).toMatchObject({
      complete: true,
      repository: "zaingulel/RentCottage",
      project: {
        id: "project-4",
        owner: "zaingulel",
        number: 4,
        items: [
          {
            id: "item-55",
            issueNumber: 55,
            area: "Foundation & quality",
            status: "Backlog",
          },
        ],
      },
      issues: [
        {
          id: 550,
          nodeId: "issue-node-55",
          number: 55,
          state: "OPEN",
          labels: ["ready-for-agent"],
          assignees: [],
          blockers: [],
        },
      ],
      pullRequests: [],
    });
    expect(source.listBlockedBy).toHaveBeenCalledWith(55);
  });

  it("reads native blockers for new issues discovered from Project 4", async () => {
    const source = completeSource();
    const evidence = await source.readProjectEvidence();
    const { project, items } = evidence;
    project.items.totalCount = 2;
    items.totalCount = 2;
    items.items.push({
      id: "item-63",
      area: "Foundation & quality",
      status: "Backlog",
      content: {
        number: 63,
        type: "Issue",
        repository: "zaingulel/RentCottage",
      },
      "linked pull requests": [],
    });
    const issues = await source.listIssues();
    issues.push({
      id: 630,
      node_id: "issue-node-63",
      number: 63,
      title: "New delivery ticket",
      state: "open",
      body: "## Blocked by\n\n- #52\n",
      labels: [{ name: "ready-for-agent" }],
      assignees: [],
    });
    source.listIssues.mockResolvedValue(issues);
    source.listBlockedBy.mockImplementation(async (number) =>
      number === 63 ? [{ id: 520, number: 52, state: "open" }] : [],
    );
    const github = createRentCottageGitHubAdapter({
      source,
      policy: policy(),
    });

    const observed = await github.observe({ type: "audit" });

    expect(source.listBlockedBy).toHaveBeenCalledWith(55);
    expect(source.listBlockedBy).toHaveBeenCalledWith(63);
    expect(observed.issues).toContainEqual(
      expect.objectContaining({
        number: 63,
        blockers: [{ id: 520, number: 52, state: "OPEN" }],
      }),
    );
  });

  it("rejects duplicate dependency identities before normalization", async () => {
    const source = completeSource();
    source.listBlockedBy.mockResolvedValue([
      { id: 520, number: 52, state: "open" },
      { id: 521, number: 52, state: "closed" },
    ]);
    const github = createRentCottageGitHubAdapter({
      source,
      policy: policy(),
    });

    const observed = await github.observe({ type: "audit" });

    expect(observed).toMatchObject({
      complete: false,
      evidenceErrors: [
        "Dependencies response contains duplicate stable identities",
      ],
    });
  });

  it("rejects contradictory duplicate issue identities before normalization", async () => {
    const source = completeSource();
    const issues = await source.listIssues();
    issues.push({
      ...structuredClone(issues[0]),
      id: 551,
      state: "closed",
      body: "contradictory body",
    });
    source.listIssues.mockResolvedValue(issues);
    const github = createRentCottageGitHubAdapter({
      source,
      policy: policy(),
    });

    const observed = await github.observe({ type: "audit" });

    expect(observed).toMatchObject({
      complete: false,
      evidenceErrors: ["Issues response contains duplicate stable identities"],
    });
    expect(source.listBlockedBy).not.toHaveBeenCalled();
  });

  it("preserves the Project item to pull-request association", async () => {
    const source = completeSource();
    const { items } = await source.readProjectEvidence();
    items.items[0]["linked pull requests"] = [
      {
        number: 70,
        url: "https://github.com/zaingulel/RentCottage/pull/70",
        repository: { nameWithOwner: "zaingulel/RentCottage" },
      },
    ];
    source.readPullRequest.mockResolvedValue({
      number: 70,
      state: "OPEN",
      isDraft: false,
      mergedAt: null,
      closingIssuesReferences: [],
    });
    const github = createRentCottageGitHubAdapter({
      source,
      policy: policy(),
    });

    const observed = await github.observe({ type: "audit" });

    expect(observed.pullRequests).toEqual([
      expect.objectContaining({ number: 70, linkedIssues: [55] }),
    ]);
    expect(source.readProjectEvidence).toHaveBeenCalledTimes(2);
  });

  it("observes multiple items once and reads each distinct linked or explicit pull request once", async () => {
    const source = completeSource();
    const evidence = await source.readProjectEvidence();
    evidence.project.items.totalCount = 2;
    evidence.items.totalCount = 2;
    evidence.items.items[0]["linked pull requests"] = [
      {
        number: 70,
        url: "https://github.com/zaingulel/RentCottage/pull/70",
        repository: { nameWithOwner: "zaingulel/RentCottage" },
      },
    ];
    evidence.items.items.push({
      ...structuredClone(evidence.items.items[0]),
      id: "item-63",
      content: {
        number: 63,
        type: "Issue",
        repository: "zaingulel/RentCottage",
      },
      "linked pull requests": [
        {
          number: 70,
          url: "https://github.com/zaingulel/RentCottage/pull/70",
          repository: { nameWithOwner: "zaingulel/RentCottage" },
        },
        {
          number: 71,
          url: "https://github.com/zaingulel/RentCottage/pull/71",
          repository: { nameWithOwner: "zaingulel/RentCottage" },
        },
      ],
    });
    const issues = await source.listIssues();
    issues.push({
      ...structuredClone(issues[0]),
      id: 630,
      node_id: "issue-node-63",
      number: 63,
      title: "Second ticket",
    });
    source.readPullRequest.mockImplementation(async (number) => ({
      number,
      state: "OPEN",
      isDraft: false,
      mergedAt: null,
      closingIssuesReferences: [],
    }));
    source.readProjectEvidence.mockClear();
    source.listIssues.mockClear();
    const github = createRentCottageGitHubAdapter({
      source,
      policy: policy(),
    });

    const observed = await github.observe({
      type: "audit",
      pullRequestNumber: 70,
    });

    expect(observed.complete).toBe(true);
    expect(source.readProjectEvidence).toHaveBeenCalledTimes(1);
    expect(source.readPullRequest.mock.calls.map(([number]) => number)).toEqual(
      [70, 71],
    );
  });

  it("rejects a Project item link to a pull request in another repository", async () => {
    const source = completeSource();
    const { items } = await source.readProjectEvidence();
    items.items[0]["linked pull requests"] = [
      {
        number: 70,
        url: "https://github.com/other/repository/pull/70",
        repository: { nameWithOwner: "other/repository" },
      },
    ];
    const github = createRentCottageGitHubAdapter({
      source,
      policy: policy(),
    });

    const observed = await github.observe({ type: "audit" });

    expect(observed).toMatchObject({
      complete: false,
      evidenceErrors: [
        "Project item #55 has an invalid or foreign linked pull request",
      ],
    });
    expect(source.readPullRequest).not.toHaveBeenCalled();
  });

  it("rejects a closing issue reference from another repository", async () => {
    const source = completeSource();
    const { items } = await source.readProjectEvidence();
    items.items[0]["linked pull requests"] = [
      {
        number: 70,
        url: "https://github.com/zaingulel/RentCottage/pull/70",
        repository: { nameWithOwner: "zaingulel/RentCottage" },
      },
    ];
    source.readPullRequest.mockResolvedValue({
      number: 70,
      state: "OPEN",
      isDraft: false,
      mergedAt: null,
      closingIssuesReferences: [
        {
          number: 55,
          repository: {
            name: "repository",
            owner: { login: "other" },
          },
        },
      ],
    });
    const github = createRentCottageGitHubAdapter({
      source,
      policy: policy(),
    });

    const observed = await github.observe({ type: "audit" });

    expect(observed).toMatchObject({
      complete: false,
      evidenceErrors: [
        "Pull request closing references include a foreign repository",
      ],
    });
  });

  it("marks evidence incomplete when a required Project option is missing", async () => {
    const source = completeSource();
    const { fields } = await source.readProjectEvidence();
    fields.fields.find(({ name }) => name === "Status").options = [
      { id: "status-backlog", name: "Backlog" },
    ];
    const github = createRentCottageGitHubAdapter({
      source,
      policy: policy(),
    });

    const observed = await github.observe({ type: "audit" });

    expect(observed).toMatchObject({
      complete: false,
      evidenceErrors: ["Project Status options do not match the contract"],
    });
  });

  it.each([
    {
      name: "duplicate Area field",
      change(fields, project) {
        fields.fields.push({
          ...structuredClone(fields.fields[0]),
          id: "field-area-duplicate",
        });
        fields.totalCount = 4;
        project.fields.totalCount = 4;
      },
    },
    {
      name: "duplicate field ID",
      change(fields) {
        fields.fields[1].id = fields.fields[0].id;
      },
    },
    {
      name: "duplicate option name",
      change(fields) {
        fields.fields[1].options.push({
          id: "status-backlog-duplicate",
          name: "Backlog",
        });
      },
    },
    {
      name: "duplicate option ID",
      change(fields) {
        fields.fields[1].options[1].id = fields.fields[1].options[0].id;
      },
    },
  ])("rejects $name before field normalization", async ({ change }) => {
    const source = completeSource();
    const { fields, project } = await source.readProjectEvidence();
    change(fields, project);
    const github = createRentCottageGitHubAdapter({
      source,
      policy: policy(),
    });

    const observed = await github.observe({ type: "audit" });

    expect(observed).toMatchObject({
      complete: false,
      evidenceErrors: [
        "Project field or option coordinates contain duplicates",
      ],
    });
  });

  it("marks draft or foreign Project items as incomplete evidence", async () => {
    const source = completeSource();
    const evidence = await source.readProjectEvidence();
    evidence.items = {
      totalCount: 1,
      items: [
        {
          id: "draft-item",
          content: { type: "DraftIssue" },
          area: "Foundation & quality",
          status: "Backlog",
        },
      ],
    };
    const github = createRentCottageGitHubAdapter({
      source,
      policy: policy(),
    });

    const observed = await github.observe({ type: "audit" });

    expect(observed).toMatchObject({
      complete: false,
      evidenceErrors: [
        "Project contains a draft, pull request, foreign item, or unavailable item",
      ],
    });
  });

  it("rejects an Issue item whose repository provenance is unavailable", async () => {
    const source = completeSource();
    const { items } = await source.readProjectEvidence();
    delete items.items[0].content.repository;
    const github = createRentCottageGitHubAdapter({
      source,
      policy: policy(),
    });

    const observed = await github.observe({ type: "audit" });

    expect(observed).toMatchObject({
      complete: false,
      evidenceErrors: [
        "Project items response does not match the expected GitHub schema",
      ],
    });
  });

  it("marks the wrong Project identity as incomplete evidence", async () => {
    const source = completeSource();
    const evidence = await source.readProjectEvidence();
    evidence.project = {
      id: "project-5",
      number: 5,
      owner: { login: "someone-else" },
      closed: false,
      items: { totalCount: 1 },
      fields: { totalCount: 3 },
    };
    const github = createRentCottageGitHubAdapter({
      source,
      policy: policy(),
    });

    const observed = await github.observe({ type: "audit" });

    expect(observed).toMatchObject({
      complete: false,
      evidenceErrors: ["Project identity does not match RentCottage Project 4"],
    });
  });

  it("turns malformed provider JSON into explicit incomplete evidence", async () => {
    const source = completeSource();
    const evidence = await source.readProjectEvidence();
    evidence.project = { id: "project-4", owner: null };
    const github = createRentCottageGitHubAdapter({
      source,
      policy: policy(),
    });

    const observed = await github.observe({ type: "audit" });

    expect(observed).toMatchObject({
      complete: false,
      evidenceErrors: [
        "Project response does not match the expected GitHub schema",
      ],
      project: { items: [] },
      issues: [],
      pullRequests: [],
    });
  });

  it("turns an unavailable GitHub API into explicit incomplete evidence", async () => {
    const source = completeSource();
    source.readProjectEvidence.mockRejectedValue(
      new Error("permission denied"),
    );
    const github = createRentCottageGitHubAdapter({
      source,
      policy: policy(),
    });

    const observed = await github.observe({ type: "audit" });

    expect(observed).toMatchObject({
      complete: false,
      evidenceErrors: ["GitHub evidence unavailable: permission denied"],
    });
  });

  it("marks an unknown Project item Status as incomplete evidence", async () => {
    const source = completeSource();
    const { items } = await source.readProjectEvidence();
    items.items[0].status = "Unexpected";
    const github = createRentCottageGitHubAdapter({
      source,
      policy: policy(),
    });

    const observed = await github.observe({ type: "audit" });

    expect(observed).toMatchObject({
      complete: false,
      evidenceErrors: ["Project item #55 has an unknown Status"],
    });
  });
});
