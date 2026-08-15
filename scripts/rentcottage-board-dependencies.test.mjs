import { describe, expect, it } from "vitest";
import { dependencyIssueNumbers } from "./lib/rentcottage-board-dependencies.mjs";

describe("RentCottage board dependency evidence", () => {
  it("includes ordinary repository issues discovered from Project 4", () => {
    const project = {
      items: {
        nodes: [
          {
            type: "ISSUE",
            content: {
              number: 63,
              repository: { nameWithOwner: "zaingulel/RentCottage" },
            },
          },
          {
            type: "ISSUE",
            content: {
              number: 70,
              repository: { nameWithOwner: "other/repository" },
            },
          },
          {
            type: "PULL_REQUEST",
            content: {
              number: 64,
              repository: { nameWithOwner: "zaingulel/RentCottage" },
            },
          },
          {
            type: "ISSUE",
            content: {
              repository: { nameWithOwner: "zaingulel/RentCottage" },
            },
          },
          {
            type: "ISSUE",
            content: {
              number: 64.5,
              repository: { nameWithOwner: "zaingulel/RentCottage" },
            },
          },
        ],
      },
    };

    expect(
      dependencyIssueNumbers({
        project,
        repository: "zaingulel/RentCottage",
        requiredIssueNumbers: [19, 55],
      }),
    ).toEqual([19, 55, 63]);
  });
});
