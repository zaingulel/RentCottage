import {
  projectNumber,
  projectOwner,
  normalizeIssueBody,
  replacementIssues,
  repository,
  specialIssues,
  verifyRentCottageProject,
} from "./rentcottage-project-contract.mjs";
import { dependencyIssueNumbers } from "./rentcottage-board-dependencies.mjs";
import {
  assertSupportedGhVersion,
  paginatedRestArgs,
  parseUniqueRepositoryIssuePages,
} from "./github-pagination.mjs";
import {
  errorDiagnostic,
  graphqlResponseError,
  graphqlResponseErrors,
  runGh,
} from "./github-cli.mjs";

const projectQuery = `
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

export function runRentCottageProjectVerifier({
  run,
  execute,
  verify = verifyRentCottageProject,
  stdout = console.log,
  stderr = console.error,
}) {
  try {
    const providerRun = run ?? ((args) => runGh(args, { execute }));
    assertSupportedGhVersion(providerRun(["--version"]));
    const projectResponse = JSON.parse(
      providerRun([
        "api",
        "graphql",
        "-f",
        `query=${projectQuery}`,
        "-F",
        `login=${projectOwner}`,
        "-F",
        `number=${projectNumber}`,
      ]),
    );
    const projectErrors = graphqlResponseErrors(
      projectResponse,
      "Project query",
    );
    if (projectErrors.length)
      throw graphqlResponseError("Project query", projectErrors);
    const project = projectResponse.data?.user?.projectV2;
    if (!project)
      throw new Error(
        `Project ${projectOwner}/${projectNumber} was unavailable`,
      );

    const issues = parseUniqueRepositoryIssuePages(
      providerRun(
        paginatedRestArgs(`repos/${repository}/issues?state=all&per_page=100`),
      ),
      "Issue",
      repository,
    )
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        ...issue,
        state: issue.state.toUpperCase(),
        body: normalizeIssueBody(issue.body),
      }));

    const nativeBlockersByIssue = new Map();
    const dependencyNumbers = dependencyIssueNumbers({
      project,
      repository,
      requiredIssueNumbers: [
        ...replacementIssues.map(({ number }) => number),
        ...specialIssues.keys(),
      ],
    });
    for (const number of dependencyNumbers) {
      nativeBlockersByIssue.set(
        number,
        parseUniqueRepositoryIssuePages(
          providerRun(
            paginatedRestArgs(
              `repos/${repository}/issues/${number}/dependencies/blocked_by?per_page=100`,
            ),
          ),
          `#${number} dependency`,
          repository,
        ),
      );
    }

    const result = verify({ project, issues, nativeBlockersByIssue });
    if (result.failures.length > 0) {
      stderr(
        `RentCottage Project verification failed with ${result.failures.length} difference(s):`,
      );
      for (const failure of result.failures)
        stderr(`- [${failure.code}] ${failure.message}`);
      return { status: 1, result };
    }

    stdout(
      `Verified Project 4: ${result.summary.itemCount} current items, all required contract items, 33 unique D tickets, Project fields, issue integrity, native dependencies, and durable Status invariants.`,
    );
    stdout(
      `Current dependency frontier: ${result.summary.dependencyFrontier.map((number) => `#${number}`).join(", ") || "none"}.`,
    );
    stdout(
      `Current Project Ready items: ${result.summary.readyItems.map((number) => `#${number}`).join(", ") || "none"}.`,
    );
    return { status: 0, result };
  } catch (error) {
    stderr(
      `RentCottage Project verification failed: ${errorDiagnostic(error)}`,
    );
    return { status: 1, error };
  }
}
