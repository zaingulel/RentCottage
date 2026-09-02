import { describe, expect, it, vi } from "vitest";

import { classifyBoard, fetchBoard, formatBoard } from "./board.mjs";

function connection(nodes, overrides = {}) {
  return {
    totalCount: nodes.length,
    nodes,
    pageInfo: { hasNextPage: false, endCursor: null },
    ...overrides,
  };
}

function fieldValue(field, name) {
  return { name, field: { name: field } };
}

function issueItem({
  number = 147,
  title = "Fail fast and retry access verification independently",
  state = "OPEN",
  labels = ["ready-for-agent"],
  assignees = [],
  blockers = [],
  status = "Backlog",
  area = "Foundation & quality",
} = {}) {
  return {
    id: `item-${number}`,
    type: "ISSUE",
    isArchived: false,
    content: {
      __typename: "Issue",
      id: `issue-${number}`,
      number,
      title,
      state,
      repository: { nameWithOwner: "zaingulel/RentCottage" },
      labels: connection(labels.map((name) => ({ name }))),
      assignees: connection(assignees.map((login) => ({ login }))),
      blockedBy: connection(
        blockers.map(({ number: blockerNumber, state: blockerState }) => ({
          id: `issue-${blockerNumber}`,
          number: blockerNumber,
          state: blockerState,
          repository: { nameWithOwner: "zaingulel/RentCottage" },
        })),
      ),
    },
    fieldValues: connection([
      fieldValue("Status", status),
      fieldValue("Area", area),
    ]),
  };
}

function projectPage(
  items,
  { totalCount = items.length, hasNextPage = false, endCursor = null } = {},
) {
  return JSON.stringify({
    data: {
      user: {
        login: "zaingulel",
        projectV2: {
          id: "project-4",
          number: 4,
          title: "RentCottage",
          closed: false,
          owner: { login: "zaingulel" },
          fields: connection([
            {
              id: "status-field",
              name: "Status",
              dataType: "SINGLE_SELECT",
              options: [
                "Backlog",
                "Ready",
                "In progress",
                "In review",
                "Done",
              ].map((name) => ({ id: `${name}-id`, name })),
            },
            {
              id: "area-field",
              name: "Area",
              dataType: "SINGLE_SELECT",
              options: [
                "Foundation & quality",
                "Customer marketplace",
                "Owner backoffice",
                "Booking lifecycle",
                "Administration & governance",
              ].map((name) => ({ id: `${name}-id`, name })),
            },
          ]),
          items: connection(items, {
            totalCount,
            pageInfo: { hasNextPage, endCursor },
          }),
        },
      },
    },
  });
}

describe("Project 4 board intake", () => {
  it("reads a complete snapshot in one GraphQL request without per-card calls", () => {
    const execute = vi.fn(() => projectPage([issueItem()]));

    const board = fetchBoard(execute);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].slice(0, 3)).toEqual([
      "api",
      "graphql",
      "-f",
    ]);
    expect(board).toMatchObject({
      project: {
        owner: "zaingulel",
        number: 4,
        title: "RentCottage",
        itemCount: 1,
      },
      items: [
        {
          number: 147,
          status: "Backlog",
          area: "Foundation & quality",
          labels: ["ready-for-agent"],
          assignees: [],
          blockers: [],
        },
      ],
    });
  });

  it("continues the Project items connection without issuing per-card requests", () => {
    const execute = vi
      .fn()
      .mockReturnValueOnce(
        projectPage([issueItem()], {
          totalCount: 2,
          hasNextPage: true,
          endCursor: "next-page",
        }),
      )
      .mockReturnValueOnce(
        projectPage([issueItem({ number: 160 })], { totalCount: 2 }),
      );

    const board = fetchBoard(execute);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0][3]).toContain('after:"next-page"');
    expect(board.items.map(({ number }) => number)).toEqual([147, 160]);
  });

  it("classifies every open item from status, ownership, labels, and native blockers", () => {
    const execute = vi.fn(() =>
      projectPage([
        issueItem({ number: 147 }),
        issueItem({
          number: 148,
          labels: ["ready-for-agent", "owner-gated"],
        }),
        issueItem({ number: 79, labels: ["ready-for-human"] }),
        issueItem({
          number: 161,
          status: "In progress",
          assignees: ["zaingulel"],
        }),
        issueItem({
          number: 157,
          blockers: [{ number: 147, state: "OPEN" }],
        }),
        issueItem({ number: 18, labels: [] }),
        issueItem({ number: 162, labels: ["needs-info"] }),
        issueItem({ number: 163, labels: ["wontfix"] }),
      ]),
    );

    const report = classifyBoard(fetchBoard(execute));

    expect(
      report.items.map(({ number, classification, openBlockers }) => ({
        number,
        classification,
        openBlockers,
      })),
    ).toEqual([
      { number: 18, classification: "needs-triage", openBlockers: [] },
      { number: 79, classification: "ready-for-human", openBlockers: [] },
      { number: 147, classification: "ready", openBlockers: [] },
      { number: 148, classification: "owner-gated", openBlockers: [] },
      { number: 157, classification: "blocked", openBlockers: [147] },
      { number: 161, classification: "active-owned", openBlockers: [] },
      { number: 162, classification: "needs-info", openBlockers: [] },
      { number: 163, classification: "wontfix", openBlockers: [] },
    ]);
  });

  it("fails when a Ready item regains an open native blocker", () => {
    const execute = vi.fn(() =>
      projectPage([
        issueItem({
          number: 160,
          status: "Ready",
          blockers: [{ number: 159, state: "OPEN" }],
        }),
      ]),
    );

    expect(() => classifyBoard(fetchBoard(execute))).toThrow(
      "#160 cannot be Ready while native blockers remain open",
    );
  });

  it("fails loudly instead of following a truncated per-card connection", () => {
    const item = issueItem();
    item.content.labels = connection([{ name: "ready-for-agent" }], {
      totalCount: 2,
      pageInfo: { hasNextPage: true, endCursor: "labels-page" },
    });
    const execute = vi.fn(() => projectPage([item]));

    expect(() => fetchBoard(execute)).toThrow(
      "#147 labels connection is truncated",
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("accepts unrelated Project field types while requiring the two routing fields", () => {
    const serialized = JSON.parse(projectPage([issueItem()]));
    serialized.data.user.projectV2.fields.nodes.push({
      id: "iteration-field",
      name: "Iteration",
      dataType: "ITERATION",
    });
    serialized.data.user.projectV2.fields.totalCount += 1;
    const execute = vi.fn(() => JSON.stringify(serialized));

    expect(classifyBoard(fetchBoard(execute)).items[0].classification).toBe(
      "ready",
    );
  });

  it("rejects a missing Project identity at the provider boundary", () => {
    const serialized = JSON.parse(projectPage([issueItem()]));
    serialized.data.user.projectV2.id = null;
    const execute = vi.fn(() => JSON.stringify(serialized));

    expect(() => fetchBoard(execute)).toThrow(
      "RentCottage Project 4 identity or open state is invalid",
    );
  });

  it("formats the same classified items for the human board intake", () => {
    const execute = vi.fn(() =>
      projectPage([
        issueItem({ number: 147, title: "Retry access verification" }),
        issueItem({
          number: 157,
          title: "Record the walkthrough",
          blockers: [{ number: 147, state: "OPEN" }],
        }),
      ]),
    );

    expect(formatBoard(classifyBoard(fetchBoard(execute)))).toContain(
      "ready (1)\n#147 [Backlog] Retry access verification",
    );
    expect(formatBoard(classifyBoard(fetchBoard(execute)))).toContain(
      "blocked (1)\n#157 [Backlog] Record the walkthrough — open blockers: #147",
    );
  });
});
