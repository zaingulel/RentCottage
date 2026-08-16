import { sameValues } from "./value-comparison.mjs";
import { hasUniqueRepositoryIssueIdentities } from "./github-pagination.mjs";
import {
  hasUniqueProjectFieldCoordinates,
  isLinkedPullRequestRecord,
  isProjectFieldRecord,
  isProjectItemRecord,
  isRecord,
} from "./rentcottage-github-schema.mjs";
import { errorDiagnostic } from "./github-cli.mjs";

function isNonnegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isProjectResponse(value) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    Number.isInteger(value.number) &&
    isRecord(value.owner) &&
    typeof value.owner.login === "string" &&
    typeof value.closed === "boolean" &&
    isRecord(value.items) &&
    isNonnegativeInteger(value.items.totalCount) &&
    isRecord(value.fields) &&
    isNonnegativeInteger(value.fields.totalCount)
  );
}

function isProjectFieldsResponse(value) {
  return (
    isRecord(value) &&
    isNonnegativeInteger(value.totalCount) &&
    Array.isArray(value.fields) &&
    value.fields.every(isProjectFieldRecord)
  );
}

function isProjectItemsResponse(value) {
  return (
    isRecord(value) &&
    isNonnegativeInteger(value.totalCount) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        isProjectItemRecord(item) &&
        (item.content.type !== "Issue" ||
          typeof item.content.repository === "string") &&
        (item.content.type !== "Issue" ||
          Number.isInteger(item.content.number)),
    )
  );
}

function isRepositoryIssueItem(item, repository) {
  return (
    item.content.type === "Issue" &&
    Number.isInteger(item.content.number) &&
    item.content.repository === repository
  );
}

function isIssueResponse(issue) {
  return (
    isRecord(issue) &&
    Number.isInteger(issue.id) &&
    typeof issue.node_id === "string" &&
    Number.isInteger(issue.number) &&
    typeof issue.title === "string" &&
    ["open", "closed"].includes(issue.state) &&
    (issue.body === null || typeof issue.body === "string") &&
    Array.isArray(issue.labels) &&
    issue.labels.every(
      (label) => isRecord(label) && typeof label.name === "string",
    ) &&
    Array.isArray(issue.assignees) &&
    issue.assignees.every(
      (assignee) => isRecord(assignee) && typeof assignee.login === "string",
    )
  );
}

function isDependencyResponse(dependency) {
  return (
    isRecord(dependency) &&
    Number.isInteger(dependency.id) &&
    Number.isInteger(dependency.number) &&
    ["open", "closed"].includes(dependency.state)
  );
}

function isPullRequestResponse(pullRequest) {
  return (
    isRecord(pullRequest) &&
    Number.isInteger(pullRequest.number) &&
    ["OPEN", "CLOSED", "MERGED"].includes(pullRequest.state) &&
    typeof pullRequest.isDraft === "boolean" &&
    (pullRequest.mergedAt === null ||
      typeof pullRequest.mergedAt === "string") &&
    Array.isArray(pullRequest.closingIssuesReferences) &&
    pullRequest.closingIssuesReferences.every(
      (issue) =>
        isRecord(issue) &&
        Number.isInteger(issue.number) &&
        isRecord(issue.repository) &&
        typeof issue.repository.name === "string" &&
        isRecord(issue.repository.owner) &&
        typeof issue.repository.owner.login === "string",
    )
  );
}

function incompleteObservation(policy, evidenceErrors) {
  return {
    complete: false,
    evidenceErrors,
    repository: policy.repository,
    project: {
      id: null,
      owner: policy.projectOwner,
      number: policy.projectNumber,
      closed: false,
      fields: {},
      items: [],
    },
    issues: [],
    pullRequests: [],
  };
}

function pullRequestLink(url) {
  const match = url.match(
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#].*)?$/,
  );
  return match ? { repository: match[1], number: Number(match[2]) } : null;
}

export function createRentCottageGitHubAdapter({ source, policy }) {
  return {
    async observe(intent) {
      let project;
      let rawFields;
      let rawItems;
      let rawIssues;
      try {
        await source.assertSupported();
        const [projectEvidence, issues] = await Promise.all([
          source.readProjectEvidence(),
          source.listIssues(),
        ]);
        ({ project, fields: rawFields, items: rawItems } = projectEvidence);
        rawIssues = issues;
      } catch (error) {
        return incompleteObservation(policy, [
          `GitHub evidence unavailable: ${errorDiagnostic(error)}`,
        ]);
      }
      const schemaErrors = [];
      if (!isProjectResponse(project))
        schemaErrors.push(
          "Project response does not match the expected GitHub schema",
        );
      if (!isProjectFieldsResponse(rawFields))
        schemaErrors.push(
          "Project fields response does not match the expected GitHub schema",
        );
      if (!isProjectItemsResponse(rawItems))
        schemaErrors.push(
          "Project items response does not match the expected GitHub schema",
        );
      if (!Array.isArray(rawIssues) || !rawIssues.every(isIssueResponse)) {
        schemaErrors.push(
          "Issues response does not match the expected GitHub schema",
        );
      } else if (
        !hasUniqueRepositoryIssueIdentities(rawIssues, policy.repository)
      ) {
        schemaErrors.push(
          "Issues response contains duplicate stable identities",
        );
      }
      if (schemaErrors.length > 0)
        return incompleteObservation(policy, schemaErrors);

      let blockerEntries;
      try {
        const dependencyIssueNumbers = new Set([
          ...policy.issues.keys(),
          ...rawItems.items
            .filter((item) => isRepositoryIssueItem(item, policy.repository))
            .map((item) => item.content.number),
        ]);
        blockerEntries = await Promise.all(
          [...dependencyIssueNumbers].map(async (number) => [
            number,
            await source.listBlockedBy(number),
          ]),
        );
      } catch (error) {
        return incompleteObservation(policy, [
          `GitHub evidence unavailable: ${errorDiagnostic(error)}`,
        ]);
      }
      if (
        blockerEntries.some(
          ([, dependencies]) =>
            !Array.isArray(dependencies) ||
            !dependencies.every(isDependencyResponse),
        )
      ) {
        return incompleteObservation(policy, [
          "Dependencies response does not match the expected GitHub schema",
        ]);
      }
      if (
        blockerEntries.some(
          ([, dependencies]) =>
            !hasUniqueRepositoryIssueIdentities(
              dependencies,
              policy.repository,
            ),
        )
      ) {
        return incompleteObservation(policy, [
          "Dependencies response contains duplicate stable identities",
        ]);
      }
      const blockersByIssue = new Map(blockerEntries);
      const pullRequestNumbers = new Set();
      const linkedIssuesByPullRequest = new Map();
      if (intent.pullRequestNumber)
        pullRequestNumbers.add(intent.pullRequestNumber);
      const linkedPullRequestsByItem = rawItems.items
        .filter((item) => isRepositoryIssueItem(item, policy.repository))
        .map((item) => [item, item["linked pull requests"]]);
      if (
        linkedPullRequestsByItem.some(
          ([, pullRequests]) =>
            !Array.isArray(pullRequests) ||
            !pullRequests.every(isLinkedPullRequestRecord),
        )
      ) {
        return incompleteObservation(policy, [
          "Linked pull requests response does not match the expected GitHub schema",
        ]);
      }
      for (const [item, linkedPullRequests] of linkedPullRequestsByItem) {
        for (const pullRequest of linkedPullRequests) {
          const link = pullRequestLink(pullRequest.url);
          if (
            !link ||
            link.repository !== policy.repository ||
            link.repository !== pullRequest.repository.nameWithOwner ||
            link.number !== pullRequest.number
          ) {
            return incompleteObservation(policy, [
              `Project item #${item.content.number} has an invalid or foreign linked pull request`,
            ]);
          }
          const { number } = link;
          pullRequestNumbers.add(number);
          const issueNumbers = linkedIssuesByPullRequest.get(number) ?? [];
          issueNumbers.push(item.content.number);
          linkedIssuesByPullRequest.set(number, issueNumbers);
        }
      }
      let pullRequests;
      try {
        pullRequests = await Promise.all(
          [...pullRequestNumbers].map((number) =>
            source.readPullRequest(number),
          ),
        );
      } catch (error) {
        return incompleteObservation(policy, [
          `GitHub evidence unavailable: ${errorDiagnostic(error)}`,
        ]);
      }
      if (!pullRequests.every(isPullRequestResponse)) {
        return incompleteObservation(policy, [
          "Pull requests response does not match the expected GitHub schema",
        ]);
      }
      if (
        pullRequests.some((pullRequest) =>
          pullRequest.closingIssuesReferences.some(
            (issue) =>
              `${issue.repository.owner.login}/${issue.repository.name}` !==
              policy.repository,
          ),
        )
      ) {
        return incompleteObservation(policy, [
          "Pull request closing references include a foreign repository",
        ]);
      }
      const evidenceErrors = [];
      if (
        project.number !== policy.projectNumber ||
        project.owner?.login !== policy.projectOwner ||
        project.closed
      ) {
        evidenceErrors.push(
          "Project identity does not match RentCottage Project 4",
        );
      }
      if (rawItems.totalCount !== rawItems.items.length)
        evidenceErrors.push("Project items pagination was truncated");
      if (
        rawItems.items.some(
          (item) => !isRepositoryIssueItem(item, policy.repository),
        )
      ) {
        evidenceErrors.push(
          "Project contains a draft, pull request, foreign item, or unavailable item",
        );
      }
      if (rawFields.totalCount !== rawFields.fields.length)
        evidenceErrors.push("Project fields pagination was truncated");
      if (!hasUniqueProjectFieldCoordinates(rawFields.fields))
        evidenceErrors.push(
          "Project field or option coordinates contain duplicates",
        );

      const fields = {};
      for (const field of rawFields.fields) {
        if (field.name !== "Area" && field.name !== "Status") continue;
        fields[field.name] = {
          id: field.id,
          options: new Map(
            (field.options ?? []).map(({ id, name }) => [name, id]),
          ),
        };
      }
      if (!fields.Area)
        evidenceErrors.push("Project Area field is unavailable");
      if (!fields.Status)
        evidenceErrors.push("Project Status field is unavailable");
      if (
        fields.Status &&
        !sameValues(
          [...fields.Status.options.keys()],
          ["Backlog", "Ready", "In progress", "In review", "Done"],
        )
      ) {
        evidenceErrors.push("Project Status options do not match the contract");
      }
      const approvedAreas = [
        ...new Set([...policy.issues.values()].map(({ area }) => area)),
      ];
      if (
        fields.Area &&
        !sameValues([...fields.Area.options.keys()], approvedAreas)
      ) {
        evidenceErrors.push("Project Area options do not match the contract");
      }
      for (const item of rawItems.items.filter((item) =>
        isRepositoryIssueItem(item, policy.repository),
      )) {
        if (
          item.area !== null &&
          fields.Area &&
          !fields.Area.options.has(item.area)
        ) {
          evidenceErrors.push(
            `Project item #${item.content.number} has an unknown Area`,
          );
        }
        if (
          item.status !== null &&
          fields.Status &&
          !fields.Status.options.has(item.status)
        ) {
          evidenceErrors.push(
            `Project item #${item.content.number} has an unknown Status`,
          );
        }
      }

      const issues = rawIssues
        .filter((issue) => !issue.pull_request)
        .map((issue) => ({
          id: issue.id,
          nodeId: issue.node_id,
          number: issue.number,
          title: issue.title,
          state: issue.state.toUpperCase(),
          body: (issue.body ?? "").replaceAll("\r\n", "\n"),
          labels: issue.labels.map(({ name }) => name),
          assignees: issue.assignees.map(({ login }) => login),
          blockers: (blockersByIssue.get(issue.number) ?? []).map(
            (blocker) => ({
              id: blocker.id,
              number: blocker.number,
              state: blocker.state.toUpperCase(),
            }),
          ),
        }));

      return {
        complete: evidenceErrors.length === 0,
        evidenceErrors,
        repository: policy.repository,
        project: {
          id: project.id,
          owner: project.owner.login,
          number: project.number,
          closed: project.closed,
          fields,
          items: rawItems.items.map((item) => ({
            id: item.id,
            issueNumber: item.content.number,
            area: item.area ?? null,
            status: item.status ?? null,
            type: item.content.type,
          })),
        },
        issues,
        pullRequests: pullRequests.map((pullRequest) => ({
          number: pullRequest.number,
          repository: policy.repository,
          state: pullRequest.state,
          draft: pullRequest.isDraft,
          mergedAt: pullRequest.mergedAt,
          closingIssues: pullRequest.closingIssuesReferences.map(
            ({ number }) => number,
          ),
          linkedIssues: [
            ...new Set(linkedIssuesByPullRequest.get(pullRequest.number) ?? []),
          ].sort((left, right) => left - right),
        })),
      };
    },

    async execute(operation) {
      await source.execute(operation);
    },
  };
}
