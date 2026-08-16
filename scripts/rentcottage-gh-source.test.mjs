import { describe, expect, it, vi } from "vitest";
import {
  createRentCottageGhSource,
  runGh,
} from "./lib/rentcottage-gh-source.mjs";

const repository = "zaingulel/RentCottage";

function connection(nodes, options = {}) {
  return {
    totalCount: options.totalCount ?? nodes.length,
    nodes,
    pageInfo: {
      hasNextPage: options.hasNextPage ?? false,
      endCursor: options.endCursor ?? null,
    },
  };
}

function connectionPage(nodes, pageIndex, pageSize, cursorPrefix) {
  const start = pageIndex * pageSize;
  const pageNodes = nodes.slice(start, start + pageSize);
  const hasNextPage = start + pageNodes.length < nodes.length;
  return connection(pageNodes, {
    totalCount: nodes.length,
    hasNextPage,
    endCursor: hasNextPage ? `${cursorPrefix}-${pageIndex + 1}` : null,
  });
}

function fields() {
  return [
    {
      __typename: "ProjectV2SingleSelectField",
      id: "field-area",
      name: "Area",
      options: [{ id: "area-foundation", name: "Foundation & quality" }],
    },
    {
      __typename: "ProjectV2SingleSelectField",
      id: "field-status",
      name: "Status",
      options: [
        { id: "status-backlog", name: "Backlog" },
        { id: "status-progress", name: "In progress" },
      ],
    },
    {
      __typename: "ProjectV2Field",
      id: "field-linked",
      name: "Linked pull requests",
    },
    {
      __typename: "ProjectV2Field",
      id: "field-notes",
      name: "Notes",
    },
  ];
}

function singleSelect(field, name) {
  return {
    __typename: "ProjectV2ItemFieldSingleSelectValue",
    field: { id: field.id, name: field.name },
    name,
    optionId: field.options.find((option) => option.name === name)?.id,
  };
}

function linkedPullRequests(nodes = [], options = {}) {
  return {
    __typename: "ProjectV2ItemFieldPullRequestValue",
    field: { id: "field-linked", name: "Linked pull requests" },
    pullRequests: connection(nodes, options),
  };
}

function textValue(text = "Internal delivery note") {
  return {
    __typename: "ProjectV2ItemFieldTextValue",
    field: { id: "field-notes", name: "Notes" },
    text,
  };
}

function projectItem(number = 55, overrides = {}) {
  const projectFields = fields();
  return {
    id: `item-${number}`,
    content: {
      __typename: "Issue",
      id: `issue-${number}`,
      number,
      repository: { nameWithOwner: repository },
      labels: connection([{ id: `label-${number}`, name: "ready-for-agent" }]),
    },
    fieldValues: connection([
      singleSelect(projectFields[0], "Foundation & quality"),
      singleSelect(projectFields[1], "Backlog"),
      linkedPullRequests(),
      textValue(),
    ]),
    ...overrides,
  };
}

function projectResponse({ fieldConnection, itemConnection } = {}) {
  return {
    data: {
      user: {
        login: "zaingulel",
        projectV2: {
          id: "project-4",
          number: 4,
          closed: false,
          owner: { login: "zaingulel" },
          fields: fieldConnection ?? connection(fields()),
          items: itemConnection ?? connection([projectItem()]),
        },
      },
    },
  };
}

function fieldValuePage(item, fieldValues) {
  return {
    data: {
      node: {
        ...item,
        fieldValues,
      },
    },
  };
}

function sourceWith(run) {
  return createRentCottageGhSource({
    repository,
    projectOwner: "zaingulel",
    projectNumber: 4,
    run,
  });
}

function variables(args) {
  return Object.fromEntries(
    args
      .filter((arg) => /^[A-Za-z][A-Za-z0-9]*=/.test(arg))
      .map((arg) => {
        const separator = arg.indexOf("=");
        return [arg.slice(0, separator), arg.slice(separator + 1)];
      }),
  );
}

function queryFrom(args) {
  const query = args.find((arg) => arg.startsWith("query="));
  expect(query).toBeDefined();
  return query.slice("query=".length);
}

function connectionFirst(query, name, { required = true } = {}) {
  const match = query.match(new RegExp(`${name}\\(first:\\s*(\\d+)`));
  if (!required && !match) return 0;
  expect(match, `${name} connection is missing`).not.toBeNull();
  return Number(match[1]);
}

function projectQueryMaximumPossibleNodes(query) {
  const fields = connectionFirst(query, "fields", { required: false });
  const items = connectionFirst(query, "items");
  const labelsPerItem = connectionFirst(query, "labels");
  const fieldValuesPerItem = connectionFirst(query, "fieldValues");
  const pullRequestsPerFieldValue = connectionFirst(query, "pullRequests");

  return (
    fields +
    items +
    items * labelsPerItem +
    items * fieldValuesPerItem +
    items * fieldValuesPerItem * pullRequestsPerFieldValue
  );
}

describe("RentCottage gh source", () => {
  it("bounds every real gh subprocess and reports timeout explicitly", () => {
    const execute = vi.fn((_file, _args, options) => {
      expect(options.timeout).toBe(60_000);
      throw Object.assign(new Error("spawn timed out"), { code: "ETIMEDOUT" });
    });

    expect(() => runGh(["project", "view"], { execute })).toThrow(
      "gh project view timed out after 60000ms",
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("bounds and redacts provider errors without exposing stdout", () => {
    const privateBody = "private-body-marker";
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    const execute = vi.fn(() => {
      throw Object.assign(new Error("provider failed"), {
        status: 1,
        signal: null,
        stdout: `${privateBody} ${secret} ${"body".repeat(5_000)}`,
        stderr: `request failed\u0000 Bearer ${secret} ${"detail".repeat(5_000)}`,
      });
    });

    let message;
    try {
      runGh(["api", "repos/zaingulel/RentCottage/issues/55"], { execute });
    } catch (error) {
      message = error.message;
    }

    expect(message).toContain("status=1");
    expect(message).toContain("stderr=request failed Bearer [REDACTED]");
    expect(message).not.toContain(privateBody);
    expect(message).not.toContain(secret);
    expect(message.length).toBeLessThan(1_500);
  });

  it.each([
    ["object", { message: "reviewer-reproduced-object" }],
    ["string", "malformed-errors-string"],
    ["null", null],
  ])(
    "rejects a present non-array GraphQL errors %s without exposing it",
    async (_shape, errors) => {
      const secret = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
      const run = vi.fn(() =>
        JSON.stringify({
          errors:
            typeof errors === "string"
              ? `${errors} ${secret} ${"detail".repeat(5_000)}`
              : errors && typeof errors === "object"
                ? {
                    ...errors,
                    private: `${secret} ${"detail".repeat(5_000)}`,
                  }
                : errors,
        }),
      );

      let message;
      try {
        await sourceWith(run).readProjectEvidence();
      } catch (error) {
        message = error.message;
      }

      expect(message).toContain(
        "Project evidence returned malformed GraphQL errors evidence",
      );
      expect(message).not.toContain(secret);
      expect(message.length).toBeLessThan(1_500);
    },
  );

  it("bounds and redacts provider-derived malformed GraphQL context", async () => {
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    const pullRequestNumber = `70\u0000 Bearer ${secret} ${"context".repeat(5_000)}`;
    const run = vi.fn(() => JSON.stringify({ errors: {} }));

    let message;
    try {
      await sourceWith(run).readPullRequest(pullRequestNumber);
    } catch (error) {
      message = error.message;
    }

    expect(message).toContain("Bearer [REDACTED]");
    expect(message).not.toContain(secret);
    expect(message).not.toContain("\u0000");
    expect(message.length).toBeLessThan(500);
  });

  it("reads multiple Project items with one lean GraphQL call and no broad or per-item query", async () => {
    const run = vi.fn(() =>
      JSON.stringify(
        projectResponse({
          itemConnection: connection([projectItem(55), projectItem(63)]),
        }),
      ),
    );

    const evidence = await sourceWith(run).readProjectEvidence();

    expect(evidence.items.items.map(({ content }) => content.number)).toEqual([
      55, 63,
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0].slice(0, 2)).toEqual(["api", "graphql"]);
    const invocation = run.mock.calls[0][0].join(" ");
    expect(invocation).not.toMatch(/project (view|field-list|item-list)/);
    expect(invocation).not.toContain("fieldValueByName");
    expect(invocation).toContain("ProjectV2ItemFieldValueCommon");
    for (const typename of [
      "ProjectV2ItemFieldLabelValue",
      "ProjectV2ItemFieldMilestoneValue",
      "ProjectV2ItemFieldPullRequestValue",
      "ProjectV2ItemFieldRepositoryValue",
      "ProjectV2ItemFieldReviewerValue",
      "ProjectV2ItemFieldUserValue",
      "ProjectV2ItemIssueFieldValue",
    ]) {
      expect(invocation).toContain(typename);
    }
  });

  it("keeps every Project-items query within GitHub's possible-node limit", async () => {
    const providerMaximumPossibleNodes = 500_000;
    const first = projectResponse({
      itemConnection: connection([projectItem(55)], {
        totalCount: 2,
        hasNextPage: true,
        endCursor: "items-1",
      }),
    });
    const overflow = projectResponse({
      itemConnection: connection([projectItem(63)], { totalCount: 2 }),
    });
    const run = vi
      .fn()
      .mockReturnValueOnce(JSON.stringify(first))
      .mockReturnValueOnce(JSON.stringify(overflow));

    await sourceWith(run).readProjectEvidence();

    const itemQueries = run.mock.calls.map(([args]) => queryFrom(args));
    expect(itemQueries).toHaveLength(2);
    for (const query of itemQueries) {
      expect(connectionFirst(query, "items")).toBe(100);
      expect(projectQueryMaximumPossibleNodes(query)).toBeLessThanOrEqual(
        providerMaximumPossibleNodes,
      );
    }
  });

  it("tolerates a populated unconsumed Text field without normalizing it", async () => {
    const response = projectResponse();

    const evidence = await sourceWith(
      vi.fn(() => JSON.stringify(response)),
    ).readProjectEvidence();

    expect(evidence.items.items[0]).toMatchObject({
      area: "Foundation & quality",
      status: "Backlog",
      "linked pull requests": [],
    });
    expect(evidence.items.items[0]).not.toHaveProperty("Notes");
  });

  it.each([
    [
      "missing coordinate",
      (value) => {
        delete value.field;
      },
      "field values returned an invalid identity",
    ],
    [
      "unknown coordinate",
      (value) => {
        value.field.id = "field-notes-unknown";
      },
      "Notes field identity changed",
    ],
  ])(
    "rejects an unconsumed Text value with a $name",
    async (_name, mutate, message) => {
      const response = projectResponse();
      mutate(response.data.user.projectV2.items.nodes[0].fieldValues.nodes[3]);

      await expect(
        sourceWith(vi.fn(() => JSON.stringify(response))).readProjectEvidence(),
      ).rejects.toThrow(message);
    },
  );

  it("paginates only Project fields when only fields overflow", async () => {
    const allFields = fields();
    const first = projectResponse({
      fieldConnection: connection([allFields[0]], {
        totalCount: 4,
        hasNextPage: true,
        endCursor: "fields-1",
      }),
    });
    const overflow = projectResponse({
      fieldConnection: connection(allFields.slice(1), { totalCount: 4 }),
    });
    const run = vi
      .fn()
      .mockReturnValueOnce(JSON.stringify(first))
      .mockReturnValueOnce(JSON.stringify(overflow));

    const evidence = await sourceWith(run).readProjectEvidence();

    expect(evidence.fields.fields).toHaveLength(4);
    expect(run).toHaveBeenCalledTimes(2);
    expect(variables(run.mock.calls[1][0])).toMatchObject({
      cursor: "fields-1",
    });
    expect(run.mock.calls[1][0].join(" ")).not.toContain("items(first:");
  });

  it("paginates only Project items when only items overflow", async () => {
    const first = projectResponse({
      itemConnection: connection([projectItem(55)], {
        totalCount: 2,
        hasNextPage: true,
        endCursor: "items-1",
      }),
    });
    const overflow = projectResponse({
      itemConnection: connection([projectItem(63)], { totalCount: 2 }),
    });
    const run = vi
      .fn()
      .mockReturnValueOnce(JSON.stringify(first))
      .mockReturnValueOnce(JSON.stringify(overflow));

    const evidence = await sourceWith(run).readProjectEvidence();

    expect(evidence.items.items.map(({ content }) => content.number)).toEqual([
      55, 63,
    ]);
    expect(variables(run.mock.calls[1][0])).toMatchObject({
      cursor: "items-1",
    });
    expect(run.mock.calls[1][0].join(" ")).not.toContain("fields(first:");
  });

  it("paginates item field values independently without replaying completed connections", async () => {
    const item = projectItem();
    const [area, status, linked, notes] = item.fieldValues.nodes;
    item.fieldValues = connection([area], {
      totalCount: 4,
      hasNextPage: true,
      endCursor: "field-values-1",
    });
    const initial = projectResponse({ itemConnection: connection([item]) });
    const overflow = {
      data: {
        node: {
          ...item,
          fieldValues: connection([status, linked, notes], { totalCount: 4 }),
        },
      },
    };
    const run = vi
      .fn()
      .mockReturnValueOnce(JSON.stringify(initial))
      .mockReturnValueOnce(JSON.stringify(overflow));

    const evidence = await sourceWith(run).readProjectEvidence();

    expect(evidence.items.items[0]).toMatchObject({
      area: "Foundation & quality",
      status: "Backlog",
      "linked pull requests": [],
    });
    expect(variables(run.mock.calls[1][0])).toMatchObject({
      itemId: "item-55",
      cursor: "field-values-1",
    });
    const overflowQuery = run.mock.calls[1][0].join(" ");
    expect(overflowQuery).toContain("ProjectV2ItemFieldValueCommon");
    expect(overflowQuery).not.toContain("labels(first:");
    expect(overflowQuery).not.toContain("items(first:");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("normalizes field values after more than ten provider-sized pages", async () => {
    const item = projectItem();
    const extraFields = Array.from({ length: 197 }, (_, index) => ({
      __typename: "ProjectV2Field",
      id: `field-extra-${index + 1}`,
      name: `Extra ${index + 1}`,
    }));
    const allFields = [...fields(), ...extraFields];
    const allValues = [
      ...item.fieldValues.nodes,
      ...extraFields.map((field) => ({
        __typename: "ProjectV2ItemFieldTextValue",
        field: { id: field.id, name: field.name },
        text: "Unconsumed evidence",
      })),
    ];
    item.fieldValues = connectionPage(allValues, 0, 20, "field-values");
    const initial = projectResponse({
      fieldConnection: connectionPage(allFields, 0, 100, "fields"),
      itemConnection: connection([item]),
    });
    const fieldPages = [1, 2].map((pageIndex) =>
      projectResponse({
        fieldConnection: connectionPage(allFields, pageIndex, 100, "fields"),
      }),
    );
    const fieldValuePages = Array.from({ length: 10 }, (_, index) =>
      fieldValuePage(
        item,
        connectionPage(allValues, index + 1, 20, "field-values"),
      ),
    );
    const run = vi
      .fn()
      .mockReturnValueOnce(JSON.stringify(initial))
      .mockReturnValueOnce(JSON.stringify(fieldPages[0]))
      .mockReturnValueOnce(JSON.stringify(fieldPages[1]));
    for (const page of fieldValuePages)
      run.mockReturnValueOnce(JSON.stringify(page));

    const evidence = await sourceWith(run).readProjectEvidence();

    expect(evidence.items.items[0]).toMatchObject({
      area: "Foundation & quality",
      status: "Backlog",
      "linked pull requests": [],
    });
    expect(variables(run.mock.calls.at(-1)[0])).toMatchObject({
      itemId: "item-55",
      cursor: "field-values-10",
    });
  });

  it("uses the field-value page cursor when a later linked-PR value overflows", async () => {
    const item = projectItem();
    const [area, status, , notes] = item.fieldValues.nodes;
    const firstPullRequest = {
      id: "pr-70",
      number: 70,
      url: "https://github.com/zaingulel/RentCottage/pull/70",
      repository: { nameWithOwner: repository },
    };
    const secondPullRequest = {
      ...firstPullRequest,
      id: "pr-71",
      number: 71,
      url: "https://github.com/zaingulel/RentCottage/pull/71",
    };
    item.fieldValues = connection([area], {
      totalCount: 4,
      hasNextPage: true,
      endCursor: "field-values-1",
    });
    const linkedOverflow = linkedPullRequests([firstPullRequest], {
      totalCount: 2,
      hasNextPage: true,
      endCursor: "pull-requests-1",
    });
    const fieldOverflow = fieldValuePage(
      item,
      connection([status, linkedOverflow, notes], { totalCount: 4 }),
    );
    const pullRequestOverflow = fieldValuePage(item, {
      nodes: [
        linkedPullRequests([secondPullRequest], {
          totalCount: 2,
        }),
      ],
    });
    const run = vi
      .fn()
      .mockReturnValueOnce(
        JSON.stringify(projectResponse({ itemConnection: connection([item]) })),
      )
      .mockReturnValueOnce(JSON.stringify(fieldOverflow))
      .mockReturnValueOnce(JSON.stringify(pullRequestOverflow));

    const evidence = await sourceWith(run).readProjectEvidence();

    expect(
      evidence.items.items[0]["linked pull requests"].map(
        ({ number }) => number,
      ),
    ).toEqual([70, 71]);
    expect(variables(run.mock.calls[2][0])).toMatchObject({
      itemId: "item-55",
      fieldCursor: "field-values-1",
      pullRequestCursor: "pull-requests-1",
    });
  });

  it("normalizes linked pull requests after more than ten provider-sized pages", async () => {
    const item = projectItem();
    const pullRequests = Array.from({ length: 201 }, (_, index) => ({
      id: `pr-${index + 1}`,
      number: index + 1,
      url: `https://github.com/zaingulel/RentCottage/pull/${index + 1}`,
      repository: { nameWithOwner: repository },
    }));
    const firstPage = connectionPage(pullRequests, 0, 20, "pull-requests");
    item.fieldValues.nodes[2] = linkedPullRequests(firstPage.nodes, {
      totalCount: firstPage.totalCount,
      hasNextPage: firstPage.pageInfo.hasNextPage,
      endCursor: firstPage.pageInfo.endCursor,
    });
    const overflowPages = Array.from({ length: 10 }, (_, index) => {
      const page = connectionPage(pullRequests, index + 1, 20, "pull-requests");
      return {
        data: {
          node: {
            ...item,
            fieldValues: {
              nodes: [
                linkedPullRequests(page.nodes, {
                  totalCount: page.totalCount,
                  hasNextPage: page.pageInfo.hasNextPage,
                  endCursor: page.pageInfo.endCursor,
                }),
              ],
            },
          },
        },
      };
    });
    const run = vi
      .fn()
      .mockReturnValueOnce(
        JSON.stringify(projectResponse({ itemConnection: connection([item]) })),
      );
    for (const page of overflowPages)
      run.mockReturnValueOnce(JSON.stringify(page));

    const evidence = await sourceWith(run).readProjectEvidence();

    expect(
      evidence.items.items[0]["linked pull requests"].map(
        ({ number }) => number,
      ),
    ).toEqual(pullRequests.map(({ number }) => number));
    expect(variables(run.mock.calls.at(-1)[0])).toMatchObject({
      itemId: "item-55",
      pullRequestCursor: "pull-requests-10",
    });
  });

  it.each([
    {
      name: "cross-page truncation",
      page(values) {
        return connection(values.slice(0, 2), { totalCount: 4 });
      },
      message: "field values pagination was truncated",
    },
    {
      name: "duplicate field ID",
      page(values, area) {
        return connection([area, ...values], { totalCount: 4 });
      },
      message: "field values returned a duplicate identity",
    },
    {
      name: "changed total",
      page(values) {
        return connection(values, { totalCount: 5 });
      },
      message: "field values totalCount changed during pagination",
    },
    {
      name: "repeated cursor",
      page(values) {
        return connection([values[0]], {
          totalCount: 4,
          hasNextPage: true,
          endCursor: "field-values-1",
        });
      },
      message: "field values pagination cursor was repeated",
    },
  ])("rejects field-value $name", async ({ page, message }) => {
    const item = projectItem();
    const [area, ...remaining] = item.fieldValues.nodes;
    item.fieldValues = connection([area], {
      totalCount: 4,
      hasNextPage: true,
      endCursor: "field-values-1",
    });
    const run = vi
      .fn()
      .mockReturnValueOnce(
        JSON.stringify(projectResponse({ itemConnection: connection([item]) })),
      )
      .mockReturnValueOnce(
        JSON.stringify(fieldValuePage(item, page(remaining, area))),
      );

    await expect(sourceWith(run).readProjectEvidence()).rejects.toThrow(
      message,
    );
  });

  it("rejects missing field-value cursors and changed item or repository anchors", async () => {
    const missingCursorItem = projectItem();
    missingCursorItem.fieldValues.pageInfo.hasNextPage = true;
    await expect(
      sourceWith(
        vi.fn(() =>
          JSON.stringify(
            projectResponse({
              itemConnection: connection([missingCursorItem]),
            }),
          ),
        ),
      ).readProjectEvidence(),
    ).rejects.toThrow("field values pagination cursor is unavailable");

    for (const changeAnchor of [
      (item) => {
        item.id = "item-changed";
      },
      (item) => {
        item.content.repository.nameWithOwner = "other/repository";
      },
    ]) {
      const item = projectItem();
      const [area, ...remaining] = item.fieldValues.nodes;
      item.fieldValues = connection([area], {
        totalCount: 4,
        hasNextPage: true,
        endCursor: "field-values-1",
      });
      const overflowItem = structuredClone(item);
      changeAnchor(overflowItem);
      const run = vi
        .fn()
        .mockReturnValueOnce(
          JSON.stringify(
            projectResponse({ itemConnection: connection([item]) }),
          ),
        )
        .mockReturnValueOnce(
          JSON.stringify(
            fieldValuePage(
              overflowItem,
              connection(remaining, { totalCount: 4 }),
            ),
          ),
        );

      await expect(sourceWith(run).readProjectEvidence()).rejects.toThrow(
        "item or issue identity changed during pagination",
      );
    }
  });

  it("keeps independent nested cursors for labels and linked pull requests on different items", async () => {
    const labelItem = projectItem(55);
    labelItem.content.labels = connection([{ id: "label-a", name: "one" }], {
      totalCount: 2,
      hasNextPage: true,
      endCursor: "labels-55",
    });
    const pullRequest = {
      id: "pr-70",
      number: 70,
      url: "https://github.com/zaingulel/RentCottage/pull/70",
      repository: { nameWithOwner: repository },
    };
    const pullRequestTwo = {
      ...pullRequest,
      id: "pr-71",
      number: 71,
      url: "https://github.com/zaingulel/RentCottage/pull/71",
    };
    const pullRequestItem = projectItem(63);
    pullRequestItem.fieldValues.nodes[2] = linkedPullRequests([pullRequest], {
      totalCount: 2,
      hasNextPage: true,
      endCursor: "prs-63",
    });
    const initial = projectResponse({
      itemConnection: connection([labelItem, pullRequestItem]),
    });
    const labelPage = {
      data: {
        node: {
          ...labelItem,
          content: {
            ...labelItem.content,
            labels: connection([{ id: "label-b", name: "two" }], {
              totalCount: 2,
            }),
          },
        },
      },
    };
    const pullRequestPage = {
      data: {
        node: {
          ...pullRequestItem,
          fieldValues: {
            nodes: [linkedPullRequests([pullRequestTwo], { totalCount: 2 })],
          },
        },
      },
    };
    const run = vi
      .fn()
      .mockReturnValueOnce(JSON.stringify(initial))
      .mockReturnValueOnce(JSON.stringify(labelPage))
      .mockReturnValueOnce(JSON.stringify(pullRequestPage));

    const evidence = await sourceWith(run).readProjectEvidence();

    expect(evidence.items.items[0].labels).toEqual(["one", "two"]);
    expect(
      evidence.items.items[1]["linked pull requests"].map(
        ({ number }) => number,
      ),
    ).toEqual([70, 71]);
    expect(variables(run.mock.calls[1][0])).toMatchObject({
      itemId: "item-55",
      cursor: "labels-55",
    });
    expect(variables(run.mock.calls[2][0])).toMatchObject({
      itemId: "item-63",
      pullRequestCursor: "prs-63",
    });
  });

  it.each([
    [
      "malformed pageInfo",
      (response) =>
        delete response.data.user.projectV2.items.pageInfo.hasNextPage,
      "pagination evidence is invalid",
    ],
    [
      "missing cursor",
      (response) => {
        response.data.user.projectV2.items.pageInfo.hasNextPage = true;
      },
      "pagination cursor is unavailable",
    ],
    [
      "truncation",
      (response) => {
        response.data.user.projectV2.items.totalCount = 2;
      },
      "pagination was truncated",
    ],
    [
      "duplicate field coordinate",
      (response) => {
        response.data.user.projectV2.fields.nodes[1].id = "field-area";
      },
      "Project fields returned a duplicate identity",
    ],
    [
      "duplicate item field value",
      (response) => {
        const values = response.data.user.projectV2.items.nodes[0].fieldValues;
        values.nodes.push(structuredClone(values.nodes[0]));
        values.totalCount += 1;
      },
      "duplicate identity",
    ],
    [
      "wrong field name",
      (response) => {
        response.data.user.projectV2.items.nodes[0].fieldValues.nodes[0].field.name =
          "Status";
      },
      "Area field identity changed",
    ],
    [
      "wrong field ID",
      (response) => {
        response.data.user.projectV2.items.nodes[0].fieldValues.nodes[0].field.id =
          "field-area-changed";
      },
      "Area field identity changed",
    ],
    [
      "wrong field type",
      (response) => {
        response.data.user.projectV2.items.nodes[0].fieldValues.nodes[0].__typename =
          "ProjectV2ItemFieldTextValue";
      },
      "Area field value type is invalid",
    ],
    [
      "wrong option identity",
      (response) => {
        response.data.user.projectV2.items.nodes[0].fieldValues.nodes[0].optionId =
          "area-changed";
      },
      "Area option identity is invalid",
    ],
    [
      "safety limit",
      (response) => {
        response.data.user.projectV2.items.totalCount = 1_001;
      },
      "1000-item safety limit",
    ],
  ])("fails closed for %s evidence", async (_name, mutate, message) => {
    const response = projectResponse();
    mutate(response);
    const source = sourceWith(vi.fn(() => JSON.stringify(response)));

    await expect(source.readProjectEvidence()).rejects.toThrow(message);
  });

  it.each([
    [
      "missing Area coordinate",
      (response) => {
        const fieldsConnection = response.data.user.projectV2.fields;
        fieldsConnection.nodes = fieldsConnection.nodes.filter(
          ({ name }) => name !== "Area",
        );
        fieldsConnection.totalCount -= 1;
      },
      "Project Area field coordinate is unavailable or ambiguous",
    ],
    [
      "duplicate Status coordinate",
      (response) => {
        const fieldsConnection = response.data.user.projectV2.fields;
        fieldsConnection.nodes.push({
          ...structuredClone(fieldsConnection.nodes[1]),
          id: "field-status-two",
        });
        fieldsConnection.totalCount += 1;
      },
      "coordinates are invalid or ambiguous",
    ],
  ])("rejects %s", async (_name, mutate, message) => {
    const response = projectResponse();
    mutate(response);

    await expect(
      sourceWith(vi.fn(() => JSON.stringify(response))).readProjectEvidence(),
    ).rejects.toThrow(message);
  });

  it("treats missing Area, Status, and linked-pull-request values as null or empty", async () => {
    const response = projectResponse();
    response.data.user.projectV2.items.nodes[0].fieldValues = connection([]);

    const evidence = await sourceWith(
      vi.fn(() => JSON.stringify(response)),
    ).readProjectEvidence();

    expect(evidence.items.items[0]).toMatchObject({
      area: null,
      status: null,
      "linked pull requests": [],
    });
  });

  it("rejects repeated identities, changed totals, and wrong Project anchors", async () => {
    const first = projectResponse({
      itemConnection: connection([projectItem(55)], {
        totalCount: 2,
        hasNextPage: true,
        endCursor: "items-1",
      }),
    });
    const repeated = projectResponse({
      itemConnection: connection([projectItem(55)], { totalCount: 2 }),
    });
    const duplicateRun = vi
      .fn()
      .mockReturnValueOnce(JSON.stringify(first))
      .mockReturnValueOnce(JSON.stringify(repeated));
    await expect(
      sourceWith(duplicateRun).readProjectEvidence(),
    ).rejects.toThrow("Project items returned a duplicate identity");

    const changed = projectResponse({
      itemConnection: connection([projectItem(63)], { totalCount: 3 }),
    });
    const totalRun = vi
      .fn()
      .mockReturnValueOnce(JSON.stringify(first))
      .mockReturnValueOnce(JSON.stringify(changed));
    await expect(sourceWith(totalRun).readProjectEvidence()).rejects.toThrow(
      "Project items totalCount changed during pagination",
    );

    const wrongAnchor = projectResponse({
      itemConnection: connection([projectItem(63)], { totalCount: 2 }),
    });
    wrongAnchor.data.user.projectV2.id = "project-changed";
    const anchorRun = vi
      .fn()
      .mockReturnValueOnce(JSON.stringify(first))
      .mockReturnValueOnce(JSON.stringify(wrongAnchor));
    await expect(sourceWith(anchorRun).readProjectEvidence()).rejects.toThrow(
      "Project items Project identity changed during pagination",
    );
  });

  it("rejects a repeated pagination cursor before replaying a completed page", async () => {
    const first = projectResponse({
      itemConnection: connection([projectItem(55)], {
        totalCount: 3,
        hasNextPage: true,
        endCursor: "items-repeated",
      }),
    });
    const repeatedCursor = projectResponse({
      itemConnection: connection([projectItem(63)], {
        totalCount: 3,
        hasNextPage: true,
        endCursor: "items-repeated",
      }),
    });
    const run = vi
      .fn()
      .mockReturnValueOnce(JSON.stringify(first))
      .mockReturnValueOnce(JSON.stringify(repeatedCursor));

    await expect(sourceWith(run).readProjectEvidence()).rejects.toThrow(
      "Project items pagination cursor was repeated",
    );
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("summarizes GraphQL errors without exposing provider messages", async () => {
    const privateBody = "private-graphql-body";
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    const codeSecret = "github_pat_abcdefghijklmnopqrstuvwxyz1234567890";
    const run = vi.fn(() =>
      JSON.stringify({
        errors: [
          {
            message: `${privateBody} Bearer ${secret} ${"detail".repeat(5_000)}`,
            extensions: { code: "FORBIDDEN" },
          },
          { message: "secondary failure", extensions: { code: codeSecret } },
        ],
      }),
    );

    try {
      await sourceWith(run).readProjectEvidence();
      throw new Error("expected Project evidence to fail");
    } catch (error) {
      expect(error.message).toContain("Project evidence failed");
      expect(error.message).toContain("FORBIDDEN");
      expect(error.message).not.toContain(privateBody);
      expect(error.message).not.toContain(secret);
      expect(error.message).not.toContain(codeSecret);
      expect(error.message.length).toBeLessThan(1_500);
    }
  });

  it("rejects contradictory duplicate REST issue identities across pages", async () => {
    const issue = { id: 550, number: 55, state: "open", body: "approved" };
    const run = vi.fn(() =>
      JSON.stringify([[issue], [{ ...issue, id: 551, state: "closed" }]]),
    );

    await expect(sourceWith(run).listIssues()).rejects.toThrow(
      "Issue pagination returned a duplicate stable identity",
    );
  });

  it("paginates pull-request closing references until totalCount is proven", async () => {
    const pullRequest = (nodes, hasNextPage, endCursor) => ({
      data: {
        repository: {
          pullRequest: {
            number: 70,
            state: "OPEN",
            isDraft: false,
            mergedAt: null,
            url: "https://github.com/zaingulel/RentCottage/pull/70",
            closingIssuesReferences: connection(nodes, {
              totalCount: 2,
              hasNextPage,
              endCursor,
            }),
          },
        },
      },
    });
    const closingIssue = (number) => ({
      number,
      repository: { name: "RentCottage", owner: { login: "zaingulel" } },
    });
    const run = vi
      .fn()
      .mockReturnValueOnce(
        JSON.stringify(pullRequest([closingIssue(55)], true, "closing-1")),
      )
      .mockReturnValueOnce(
        JSON.stringify(pullRequest([closingIssue(63)], false, null)),
      );

    const result = await sourceWith(run).readPullRequest(70);

    expect(result.closingIssuesReferences.map(({ number }) => number)).toEqual([
      55, 63,
    ]);
    expect(variables(run.mock.calls[1][0])).toMatchObject({
      cursor: "closing-1",
    });
  });

  it("uses freshly read lean evidence coordinates before a field mutation", async () => {
    const run = vi
      .fn()
      .mockReturnValueOnce(JSON.stringify(projectResponse()))
      .mockReturnValueOnce(
        JSON.stringify({
          data: { update: { projectV2Item: { id: "item-55" } } },
        }),
      );

    await sourceWith(run).execute({
      type: "set-project-field",
      issueNumber: 55,
      field: "Status",
      value: "In progress",
    });

    expect(run).toHaveBeenCalledTimes(2);
    expect(variables(run.mock.calls[1][0])).toMatchObject({
      projectId: "project-4",
      itemId: "item-55",
      fieldId: "field-status",
      optionId: "status-progress",
    });
    expect(run.mock.calls[0][0].join(" ")).not.toMatch(
      /project (view|field-list|item-list)/,
    );
  });
});
