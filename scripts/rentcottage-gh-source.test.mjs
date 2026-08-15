import { describe, expect, it, vi } from "vitest";
import {
  createRentCottageGhSource,
  runGh,
} from "./lib/rentcottage-gh-source.mjs";

function expectVariableFlag(args, variable, flag) {
  const index = args.findIndex((arg) => arg.startsWith(`${variable}=`));
  expect(index).toBeGreaterThan(0);
  expect(args[index - 1]).toBe(flag);
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

  it("summarizes GraphQL semantic errors without exposing response messages", async () => {
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
    const source = createRentCottageGhSource({
      repository: "zaingulel/RentCottage",
      projectOwner: "zaingulel",
      projectNumber: 4,
      run,
    });

    let message;
    try {
      await source.listLinkedPullRequests("item-55");
    } catch (error) {
      message = error.message;
    }

    expect(message).toContain(
      "Project item item-55 linked pull requests failed",
    );
    expect(message).toContain("FORBIDDEN");
    expect(message).not.toContain(privateBody);
    expect(message).not.toContain(secret);
    expect(message).not.toContain(codeSecret);
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
      const source = createRentCottageGhSource({
        repository: "zaingulel/RentCottage",
        projectOwner: "zaingulel",
        projectNumber: 4,
        run,
      });

      let message;
      try {
        await source.listLinkedPullRequests("item-55");
      } catch (error) {
        message = error.message;
      }

      expect(message).toContain(
        "Project item item-55 linked pull requests returned malformed GraphQL errors evidence",
      );
      expect(message).not.toContain(secret);
      expect(message.length).toBeLessThan(1_500);
    },
  );

  it("bounds and redacts provider-derived malformed GraphQL context", async () => {
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    const itemId = `item-55\u0000 Bearer ${secret} ${"context".repeat(5_000)}`;
    const run = vi.fn(() => JSON.stringify({ errors: {} }));
    const source = createRentCottageGhSource({
      repository: "zaingulel/RentCottage",
      projectOwner: "zaingulel",
      projectNumber: 4,
      run,
    });

    let message;
    try {
      await source.listLinkedPullRequests(itemId);
    } catch (error) {
      message = error.message;
    }

    expect(message).toContain("Bearer [REDACTED]");
    expect(message).not.toContain(secret);
    expect(message).not.toContain("\u0000");
    expect(message.length).toBeLessThan(500);
  });

  it.each([
    {
      identity: "database ID",
      duplicate: { id: 550, number: 56 },
    },
    {
      identity: "repository issue number",
      duplicate: { id: 551, number: 55 },
    },
  ])(
    "rejects contradictory duplicate REST issue $identity across pages",
    async ({ duplicate }) => {
      const issue = {
        id: 550,
        number: 55,
        state: "open",
        body: "approved body",
      };
      const run = vi
        .fn()
        .mockReturnValue(
          JSON.stringify([
            [issue],
            [{ ...issue, ...duplicate, state: "closed", body: "changed body" }],
          ]),
        );
      const source = createRentCottageGhSource({
        repository: "zaingulel/RentCottage",
        projectOwner: "zaingulel",
        projectNumber: 4,
        run,
      });

      await expect(source.listIssues()).rejects.toThrow(
        "Issue pagination returned a duplicate stable identity",
      );
    },
  );

  it.each([
    {
      identity: "database ID",
      duplicate: { id: 520, number: 53 },
    },
    {
      identity: "repository issue number",
      duplicate: { id: 521, number: 52 },
    },
  ])(
    "rejects contradictory duplicate REST dependency $identity across pages",
    async ({ duplicate }) => {
      const dependency = { id: 520, number: 52, state: "open" };
      const run = vi
        .fn()
        .mockReturnValue(
          JSON.stringify([
            [dependency],
            [{ ...dependency, ...duplicate, state: "closed" }],
          ]),
        );
      const source = createRentCottageGhSource({
        repository: "zaingulel/RentCottage",
        projectOwner: "zaingulel",
        projectNumber: 4,
        run,
      });

      await expect(source.listBlockedBy(55)).rejects.toThrow(
        "#55 dependency pagination returned a duplicate stable identity",
      );
    },
  );

  it("paginates pull-request closing references until totalCount is proven", async () => {
    const base = {
      number: 70,
      state: "OPEN",
      isDraft: false,
      mergedAt: null,
      url: "https://github.com/zaingulel/RentCottage/pull/70",
    };
    const run = vi
      .fn()
      .mockReturnValueOnce(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                ...base,
                closingIssuesReferences: {
                  totalCount: 2,
                  nodes: [
                    {
                      number: 55,
                      repository: {
                        name: "RentCottage",
                        owner: { login: "zaingulel" },
                      },
                    },
                  ],
                  pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
                },
              },
            },
          },
        }),
      )
      .mockReturnValueOnce(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                ...base,
                closingIssuesReferences: {
                  totalCount: 2,
                  nodes: [
                    {
                      number: 64,
                      repository: {
                        name: "RentCottage",
                        owner: { login: "zaingulel" },
                      },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        }),
      );
    const source = createRentCottageGhSource({
      repository: "zaingulel/RentCottage",
      projectOwner: "zaingulel",
      projectNumber: 4,
      run,
    });

    const pullRequest = await source.readPullRequest(70);

    expect(pullRequest.closingIssuesReferences).toEqual([
      {
        number: 55,
        repository: {
          name: "RentCottage",
          owner: { login: "zaingulel" },
        },
      },
      {
        number: 64,
        repository: {
          name: "RentCottage",
          owner: { login: "zaingulel" },
        },
      },
    ]);
    expect(run).toHaveBeenCalledTimes(2);
    const secondArgs = run.mock.calls[1][0];
    expectVariableFlag(secondArgs, "owner", "-f");
    expectVariableFlag(secondArgs, "name", "-f");
    expectVariableFlag(secondArgs, "pullRequestNumber", "-F");
    expectVariableFlag(secondArgs, "cursor", "-f");
  });

  it("paginates Project linked pull requests until totalCount is proven", async () => {
    const connection = (nodes, hasNextPage, endCursor) => ({
      data: {
        node: {
          fieldValueByName: {
            pullRequests: {
              totalCount: 2,
              nodes,
              pageInfo: { hasNextPage, endCursor },
            },
          },
        },
      },
    });
    const run = vi
      .fn()
      .mockReturnValueOnce(
        JSON.stringify(
          connection(
            [
              {
                number: 70,
                url: "https://github.com/zaingulel/RentCottage/pull/70",
                repository: { nameWithOwner: "zaingulel/RentCottage" },
              },
            ],
            true,
            "cursor-1",
          ),
        ),
      )
      .mockReturnValueOnce(
        JSON.stringify(
          connection(
            [
              {
                number: 71,
                url: "https://github.com/zaingulel/RentCottage/pull/71",
                repository: { nameWithOwner: "zaingulel/RentCottage" },
              },
            ],
            false,
            null,
          ),
        ),
      );
    const source = createRentCottageGhSource({
      repository: "zaingulel/RentCottage",
      projectOwner: "zaingulel",
      projectNumber: 4,
      run,
    });

    const pullRequests = await source.listLinkedPullRequests("item-55");

    expect(pullRequests.map(({ number }) => number)).toEqual([70, 71]);
    expect(run).toHaveBeenCalledTimes(2);
    const secondArgs = run.mock.calls[1][0];
    expectVariableFlag(secondArgs, "itemId", "-F");
    expectVariableFlag(secondArgs, "cursor", "-f");
  });

  it("rejects duplicate linked pull-request identities across pages", async () => {
    const linkedPullRequest = {
      number: 70,
      url: "https://github.com/zaingulel/RentCottage/pull/70",
      repository: { nameWithOwner: "zaingulel/RentCottage" },
    };
    const response = (hasNextPage, endCursor) =>
      JSON.stringify({
        data: {
          node: {
            fieldValueByName: {
              pullRequests: {
                totalCount: 2,
                nodes: [linkedPullRequest],
                pageInfo: { hasNextPage, endCursor },
              },
            },
          },
        },
      });
    const run = vi
      .fn()
      .mockReturnValueOnce(response(true, "cursor-1"))
      .mockReturnValueOnce(response(false, null));
    const source = createRentCottageGhSource({
      repository: "zaingulel/RentCottage",
      projectOwner: "zaingulel",
      projectNumber: 4,
      run,
    });

    await expect(source.listLinkedPullRequests("item-55")).rejects.toThrow(
      "Project item item-55 linked pull requests returned a duplicate identity",
    );
  });

  it("rejects duplicate closing-issue identities across pages", async () => {
    const closingIssue = {
      number: 55,
      repository: {
        name: "RentCottage",
        owner: { login: "zaingulel" },
      },
    };
    const response = (hasNextPage, endCursor) =>
      JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              number: 70,
              state: "OPEN",
              isDraft: false,
              mergedAt: null,
              url: "https://github.com/zaingulel/RentCottage/pull/70",
              closingIssuesReferences: {
                totalCount: 2,
                nodes: [closingIssue],
                pageInfo: { hasNextPage, endCursor },
              },
            },
          },
        },
      });
    const run = vi
      .fn()
      .mockReturnValueOnce(response(true, "cursor-1"))
      .mockReturnValueOnce(response(false, null));
    const source = createRentCottageGhSource({
      repository: "zaingulel/RentCottage",
      projectOwner: "zaingulel",
      projectNumber: 4,
      run,
    });

    await expect(source.readPullRequest(70)).rejects.toThrow(
      "Pull request #70 closing references returned a duplicate identity",
    );
  });

  it("rejects provider connections over the safety cap", async () => {
    const run = vi.fn().mockReturnValue(
      JSON.stringify({
        data: {
          node: {
            fieldValueByName: {
              pullRequests: {
                totalCount: 1_001,
                nodes: [],
                pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
              },
            },
          },
        },
      }),
    );
    const source = createRentCottageGhSource({
      repository: "zaingulel/RentCottage",
      projectOwner: "zaingulel",
      projectNumber: 4,
      run,
    });

    await expect(source.listLinkedPullRequests("item-55")).rejects.toThrow(
      "Project item item-55 linked pull requests exceeds the 1000-item safety limit",
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("rejects a provider connection that ends before totalCount", async () => {
    const run = vi.fn().mockReturnValue(
      JSON.stringify({
        data: {
          node: {
            fieldValueByName: {
              pullRequests: {
                totalCount: 2,
                nodes: [
                  {
                    number: 70,
                    url: "https://github.com/zaingulel/RentCottage/pull/70",
                    repository: { nameWithOwner: "zaingulel/RentCottage" },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      }),
    );
    const source = createRentCottageGhSource({
      repository: "zaingulel/RentCottage",
      projectOwner: "zaingulel",
      projectNumber: 4,
      run,
    });

    await expect(source.listLinkedPullRequests("item-55")).rejects.toThrow(
      "Project item item-55 linked pull requests pagination was truncated",
    );
  });

  it("resolves fresh Project item, field, and option IDs before a field write", async () => {
    const run = vi
      .fn()
      .mockReturnValueOnce(
        JSON.stringify({
          id: "project-fresh",
          number: 4,
          owner: { login: "zaingulel" },
          closed: false,
          items: { totalCount: 1 },
          fields: { totalCount: 2 },
        }),
      )
      .mockReturnValueOnce(
        JSON.stringify({
          totalCount: 2,
          fields: [
            {
              id: "status-field-fresh",
              name: "Status",
              options: [{ id: "in-progress-fresh", name: "In progress" }],
            },
            { id: "area-field", name: "Area", options: [] },
          ],
        }),
      )
      .mockReturnValueOnce(
        JSON.stringify({
          totalCount: 1,
          items: [
            {
              id: "item-55-fresh",
              content: {
                number: 55,
                type: "Issue",
                repository: "zaingulel/RentCottage",
              },
            },
          ],
        }),
      )
      .mockReturnValueOnce(JSON.stringify({ data: { update: {} } }));
    const source = createRentCottageGhSource({
      repository: "zaingulel/RentCottage",
      projectOwner: "zaingulel",
      projectNumber: 4,
      run,
    });

    await source.execute({
      type: "set-project-field",
      issueNumber: 55,
      field: "Status",
      value: "In progress",
    });

    expect(run).toHaveBeenCalledTimes(4);
    expect(run.mock.calls[3][0]).toEqual(
      expect.arrayContaining([
        "projectId=project-fresh",
        "itemId=item-55-fresh",
        "fieldId=status-field-fresh",
        "optionId=in-progress-fresh",
      ]),
    );
    const mutationArgs = run.mock.calls[3][0];
    expectVariableFlag(mutationArgs, "projectId", "-F");
    expectVariableFlag(mutationArgs, "itemId", "-F");
    expectVariableFlag(mutationArgs, "fieldId", "-F");
    expectVariableFlag(mutationArgs, "optionId", "-f");
  });

  it("rejects malformed fresh Project coordinates before a field mutation", async () => {
    const run = vi.fn().mockReturnValueOnce(JSON.stringify({ number: 4 }));
    const source = createRentCottageGhSource({
      repository: "zaingulel/RentCottage",
      projectOwner: "zaingulel",
      projectNumber: 4,
      run,
    });

    await expect(
      source.execute({
        type: "set-project-field",
        issueNumber: 55,
        field: "Status",
        value: "In progress",
      }),
    ).rejects.toThrow("Fresh Project response is invalid");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "wrong Project identity",
      responses: [
        {
          id: "project-fresh",
          number: 5,
          owner: { login: "someone-else" },
          closed: false,
          items: { totalCount: 1 },
          fields: { totalCount: 1 },
        },
      ],
      message: "Fresh Project response is invalid",
      calls: 1,
    },
    {
      name: "truncated fields",
      responses: [
        {
          id: "project-fresh",
          number: 4,
          owner: { login: "zaingulel" },
          closed: false,
          items: { totalCount: 1 },
          fields: { totalCount: 2 },
        },
        {
          totalCount: 2,
          fields: [
            {
              id: "status-field",
              name: "Status",
              options: [{ id: "in-progress", name: "In progress" }],
            },
          ],
        },
      ],
      message: "Fresh Project fields response is invalid",
      calls: 2,
    },
    {
      name: "malformed field options",
      responses: [
        {
          id: "project-fresh",
          number: 4,
          owner: { login: "zaingulel" },
          closed: false,
          items: { totalCount: 1 },
          fields: { totalCount: 1 },
        },
        {
          totalCount: 1,
          fields: [
            {
              id: "status-field",
              name: "Status",
              options: [{ id: 7, name: "In progress" }],
            },
          ],
        },
      ],
      message: "Fresh Project fields response is invalid",
      calls: 2,
    },
    {
      name: "duplicate field coordinates",
      responses: [
        {
          id: "project-fresh",
          number: 4,
          owner: { login: "zaingulel" },
          closed: false,
          items: { totalCount: 1 },
          fields: { totalCount: 2 },
        },
        {
          totalCount: 2,
          fields: [
            {
              id: "duplicate-field",
              name: "Status",
              options: [{ id: "in-progress", name: "In progress" }],
            },
            {
              id: "duplicate-field",
              name: "Area",
              options: [{ id: "foundation", name: "Foundation & quality" }],
            },
          ],
        },
      ],
      message: "Fresh Project fields response is invalid",
      calls: 2,
    },
    {
      name: "duplicate items",
      responses: [
        {
          id: "project-fresh",
          number: 4,
          owner: { login: "zaingulel" },
          closed: false,
          items: { totalCount: 2 },
          fields: { totalCount: 1 },
        },
        {
          totalCount: 1,
          fields: [
            {
              id: "status-field",
              name: "Status",
              options: [{ id: "in-progress", name: "In progress" }],
            },
          ],
        },
        {
          totalCount: 2,
          items: ["a", "b"].map((suffix) => ({
            id: `item-${suffix}`,
            content: {
              number: 55,
              type: "Issue",
              repository: "zaingulel/RentCottage",
            },
          })),
        },
      ],
      message: "Fresh Project items response is invalid",
      calls: 3,
    },
  ])(
    "rejects $name before a field mutation",
    async ({ responses, message, calls }) => {
      const run = vi.fn();
      for (const response of responses)
        run.mockReturnValueOnce(JSON.stringify(response));
      const source = createRentCottageGhSource({
        repository: "zaingulel/RentCottage",
        projectOwner: "zaingulel",
        projectNumber: 4,
        run,
      });

      await expect(
        source.execute({
          type: "set-project-field",
          issueNumber: 55,
          field: "Status",
          value: "In progress",
        }),
      ).rejects.toThrow(message);
      expect(run).toHaveBeenCalledTimes(calls);
    },
  );
});
