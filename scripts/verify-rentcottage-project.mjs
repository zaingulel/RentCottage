#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  projectNumber,
  projectOwner,
  replacementIssues,
  repository,
  specialIssues,
  verifyRentCottageProject,
} from "./lib/rentcottage-project-contract.mjs";
import {
  paginatedRestArgs,
  parsePaginatedPages,
} from "./lib/github-pagination.mjs";

function gh(args) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = `${error.stderr ?? ""}${error.stdout ?? ""}`.trim();
    throw new Error(
      `gh ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`,
    );
  }
}

const query = `
query($login: String!, $number: Int!) {
  user(login: $login) {
    projectV2(number: $number) {
      id number title closed readme
      fields(first: 100) {
        totalCount
        nodes {
          ... on ProjectV2Field { id name }
          ... on ProjectV2SingleSelectField { id name options { id name } }
        }
      }
      items(first: 100) {
        totalCount
        nodes {
          id type isArchived
          content {
            ... on Issue {
              number title state body
              repository { nameWithOwner }
              labels(first: 20) { nodes { name } }
              assignees(first: 20) { nodes { login } }
            }
          }
          fieldValues(first: 100) {
            totalCount
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ... on ProjectV2SingleSelectField { name } }
              }
            }
          }
        }
      }
    }
  }
}`;

const projectResponse = JSON.parse(
  gh([
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-F",
    `login=${projectOwner}`,
    "-F",
    `number=${projectNumber}`,
  ]),
);
if (projectResponse.errors?.length)
  throw new Error(
    `Project query failed: ${JSON.stringify(projectResponse.errors)}`,
  );
const project = projectResponse.data?.user?.projectV2;
if (!project)
  throw new Error(`Project ${projectOwner}/${projectNumber} was unavailable`);

const issues = parsePaginatedPages(
  gh(paginatedRestArgs(`repos/${repository}/issues?state=all&per_page=100`)),
  "Issue",
)
  .filter((issue) => !issue.pull_request)
  .map((issue) => ({ ...issue, state: issue.state.toUpperCase() }));

const nativeBlockersByIssue = new Map();
const dependencyNumbers = new Set([
  ...replacementIssues.map(({ number }) => number),
  ...[...specialIssues]
    .filter(([, policy]) => policy.blockers)
    .map(([number]) => number),
]);
for (const number of dependencyNumbers) {
  nativeBlockersByIssue.set(
    number,
    parsePaginatedPages(
      gh(
        paginatedRestArgs(
          `repos/${repository}/issues/${number}/dependencies/blocked_by?per_page=100`,
        ),
      ),
      `#${number} dependency`,
    ),
  );
}

const result = verifyRentCottageProject({
  project,
  issues,
  nativeBlockersByIssue,
});
if (result.failures.length > 0) {
  console.error(
    `RentCottage Project verification failed with ${result.failures.length} difference(s):`,
  );
  for (const failure of result.failures)
    console.error(`- [${failure.code}] ${failure.message}`);
  process.exit(1);
}

console.log(
  `Verified Project 4: ${result.summary.itemCount} exact items, 33 unique D tickets, Project fields, issue integrity, blocker text, native dependencies, and durable Status invariants.`,
);
console.log(
  `Current replacement dependency frontier: ${result.summary.dependencyFrontier.map((number) => `#${number}`).join(", ") || "none"}.`,
);
console.log(
  `Current Project Ready items: ${result.summary.readyItems.map((number) => `#${number}`).join(", ") || "none"}.`,
);
