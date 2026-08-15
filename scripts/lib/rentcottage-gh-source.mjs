import {
  graphqlResponseError,
  graphqlResponseErrors,
  runGh,
} from "./github-cli.mjs";
import {
  assertSupportedGhVersion,
  paginatedRestArgs,
  parseUniqueRepositoryIssuePages,
} from "./github-pagination.mjs";
import {
  hasUniqueProjectFieldCoordinates,
  isProjectFieldRecord,
  isProjectItemRecord,
  isRecord,
} from "./rentcottage-github-schema.mjs";

export { runGh };

function parseJson(serialized, context) {
  try {
    return JSON.parse(serialized);
  } catch {
    throw new Error(`${context} returned invalid JSON`);
  }
}

function hasFreshProjectCoordinates(project, { projectOwner, projectNumber }) {
  return (
    isRecord(project) &&
    typeof project.id === "string" &&
    project.number === projectNumber &&
    isRecord(project.owner) &&
    project.owner.login === projectOwner &&
    project.closed === false &&
    isRecord(project.items) &&
    Number.isInteger(project.items.totalCount) &&
    project.items.totalCount >= 0 &&
    isRecord(project.fields) &&
    Number.isInteger(project.fields.totalCount) &&
    project.fields.totalCount >= 0
  );
}

function hasFreshFieldCoordinates(fields, project) {
  const records =
    isRecord(fields) && Array.isArray(fields.fields) ? fields.fields : [];
  return (
    isRecord(fields) &&
    Number.isInteger(fields.totalCount) &&
    fields.totalCount === project.fields.totalCount &&
    Array.isArray(fields.fields) &&
    fields.fields.length === fields.totalCount &&
    fields.fields.every(isProjectFieldRecord) &&
    hasUniqueProjectFieldCoordinates(records)
  );
}

function hasFreshItemCoordinates(items, project, operation, repository) {
  const matchingItems =
    isRecord(items) && Array.isArray(items.items)
      ? items.items.filter(
          (item) =>
            isProjectItemRecord(item) &&
            item.content.type === "Issue" &&
            item.content.number === operation.issueNumber &&
            item.content.repository === repository,
        )
      : [];
  return (
    isRecord(items) &&
    Number.isInteger(items.totalCount) &&
    items.totalCount === project.items.totalCount &&
    Array.isArray(items.items) &&
    items.items.length === items.totalCount &&
    items.items.every(isProjectItemRecord) &&
    matchingItems.length === 1
  );
}

function requireGraphqlSuccess(serialized, context) {
  const response = parseJson(serialized, context);
  const errors = graphqlResponseErrors(response, context);
  if (errors.length) throw graphqlResponseError(context, errors);
  return response;
}

const CONNECTION_PAGE_SIZE = 100;
const CONNECTION_ITEM_LIMIT = 1_000;

function readBoundedConnection({
  context,
  readPage,
  connectionFrom,
  identityFrom,
  emptyWhen = () => false,
}) {
  const nodes = [];
  const identities = new Set();
  let cursor = null;
  let expectedTotal = null;
  for (
    let page = 0;
    page < CONNECTION_ITEM_LIMIT / CONNECTION_PAGE_SIZE;
    page += 1
  ) {
    const value = readPage(cursor);
    if (emptyWhen(value)) return { value, nodes: [] };
    const connection = connectionFrom(value);
    if (
      !isRecord(connection) ||
      !Number.isInteger(connection.totalCount) ||
      connection.totalCount < 0 ||
      !Array.isArray(connection.nodes) ||
      !isRecord(connection.pageInfo) ||
      typeof connection.pageInfo.hasNextPage !== "boolean" ||
      (connection.pageInfo.endCursor !== null &&
        typeof connection.pageInfo.endCursor !== "string")
    ) {
      throw new Error(`${context} pagination evidence is invalid`);
    }
    if (connection.totalCount > CONNECTION_ITEM_LIMIT)
      throw new Error(
        `${context} exceeds the ${CONNECTION_ITEM_LIMIT}-item safety limit`,
      );
    expectedTotal ??= connection.totalCount;
    if (connection.totalCount !== expectedTotal)
      throw new Error(`${context} totalCount changed during pagination`);
    for (const node of connection.nodes) {
      const identity = identityFrom(node);
      if (identities.has(identity))
        throw new Error(`${context} returned a duplicate identity`);
      identities.add(identity);
      nodes.push(node);
    }
    if (nodes.length > expectedTotal)
      throw new Error(`${context} returned more nodes than totalCount`);
    if (!connection.pageInfo.hasNextPage) {
      if (nodes.length !== expectedTotal)
        throw new Error(`${context} pagination was truncated`);
      return { value, nodes };
    }
    if (!connection.pageInfo.endCursor)
      throw new Error(`${context} pagination cursor is unavailable`);
    cursor = connection.pageInfo.endCursor;
  }
  throw new Error(`${context} pagination exceeded the page safety limit`);
}

export function createRentCottageGhSource({
  repository,
  projectOwner,
  projectNumber,
  run = runGh,
}) {
  const projectArgs = [String(projectNumber), "--owner", projectOwner];
  const source = {
    async assertSupported() {
      assertSupportedGhVersion(run(["--version"]));
    },

    async readProject() {
      return parseJson(
        run(["project", "view", ...projectArgs, "--format", "json"]),
        "Project",
      );
    },

    async readProjectFields() {
      return parseJson(
        run(["project", "field-list", ...projectArgs, "--format", "json"]),
        "Project fields",
      );
    },

    async readProjectItems() {
      return parseJson(
        run([
          "project",
          "item-list",
          ...projectArgs,
          "--format",
          "json",
          "--limit",
          "100",
        ]),
        "Project items",
      );
    },

    async listIssues() {
      return parseUniqueRepositoryIssuePages(
        run(
          paginatedRestArgs(
            `repos/${repository}/issues?state=all&per_page=100`,
          ),
        ),
        "Issue",
        repository,
      );
    },

    async listBlockedBy(issueNumber) {
      return parseUniqueRepositoryIssuePages(
        run(
          paginatedRestArgs(
            `repos/${repository}/issues/${issueNumber}/dependencies/blocked_by?per_page=100`,
          ),
        ),
        `#${issueNumber} dependency`,
        repository,
      );
    },

    async listLinkedPullRequests(itemId) {
      const query = `query($itemId: ID!, $cursor: String) {
        node(id: $itemId) {
          ... on ProjectV2Item {
            fieldValueByName(name: "Linked pull requests") {
              ... on ProjectV2ItemFieldPullRequestValue {
                pullRequests(first: ${CONNECTION_PAGE_SIZE}, after: $cursor) {
                  totalCount
                  nodes { number url repository { nameWithOwner } }
                  pageInfo { hasNextPage endCursor }
                }
              }
            }
          }
        }
      }`;
      const { nodes } = readBoundedConnection({
        context: `Project item ${itemId} linked pull requests`,
        readPage(cursor) {
          const args = [
            "api",
            "graphql",
            "-f",
            `query=${query}`,
            "-F",
            `itemId=${itemId}`,
          ];
          if (cursor) args.push("-F", `cursor=${cursor}`);
          const response = requireGraphqlSuccess(
            run(args),
            `Project item ${itemId} linked pull requests`,
          );
          if (!isRecord(response.data?.node))
            throw new Error(`Project item ${itemId} is unavailable`);
          return response.data.node.fieldValueByName ?? null;
        },
        connectionFrom: (fieldValue) => fieldValue.pullRequests,
        identityFrom: (pullRequest) =>
          `${pullRequest.repository?.nameWithOwner}#${pullRequest.number}`,
        emptyWhen: (fieldValue) => fieldValue === null,
      });
      return nodes;
    },

    async readPullRequest(pullRequestNumber) {
      const [owner, name] = repository.split("/");
      const query = `query($owner: String!, $name: String!, $pullRequestNumber: Int!, $cursor: String) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $pullRequestNumber) {
            number state isDraft mergedAt url
            closingIssuesReferences(first: ${CONNECTION_PAGE_SIZE}, after: $cursor) {
              totalCount
              nodes { number repository { name owner { login } } }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }`;
      let firstPullRequest = null;
      const { nodes } = readBoundedConnection({
        context: `Pull request #${pullRequestNumber} closing references`,
        readPage(cursor) {
          const args = [
            "api",
            "graphql",
            "-f",
            `query=${query}`,
            "-F",
            `owner=${owner}`,
            "-F",
            `name=${name}`,
            "-F",
            `pullRequestNumber=${pullRequestNumber}`,
          ];
          if (cursor) args.push("-F", `cursor=${cursor}`);
          const response = requireGraphqlSuccess(
            run(args),
            `Pull request #${pullRequestNumber}`,
          );
          const pullRequest = response.data?.repository?.pullRequest;
          if (!isRecord(pullRequest))
            throw new Error(
              `Pull request #${pullRequestNumber} is unavailable`,
            );
          firstPullRequest ??= pullRequest;
          return pullRequest;
        },
        connectionFrom: (pullRequest) => pullRequest.closingIssuesReferences,
        identityFrom: (issue) =>
          `${issue.repository?.owner?.login}/${issue.repository?.name}#${issue.number}`,
      });
      return {
        number: firstPullRequest.number,
        state: firstPullRequest.state,
        isDraft: firstPullRequest.isDraft,
        mergedAt: firstPullRequest.mergedAt,
        url: firstPullRequest.url,
        closingIssuesReferences: nodes,
      };
    },

    async execute(operation) {
      if (operation.type === "add-project-item") {
        const project = await source.readProject();
        if (
          !hasFreshProjectCoordinates(project, { projectOwner, projectNumber })
        )
          throw new Error("Fresh Project response is invalid");
        const query = `mutation($projectId: ID!, $contentId: ID!) {
          addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) { item { id } }
        }`;
        requireGraphqlSuccess(
          run([
            "api",
            "graphql",
            "-f",
            `query=${query}`,
            "-F",
            `projectId=${project.id}`,
            "-F",
            `contentId=${operation.contentNodeId}`,
          ]),
          "Add Project item",
        );
        return;
      }

      if (operation.type === "set-project-field") {
        const project = await source.readProject();
        if (
          !hasFreshProjectCoordinates(project, { projectOwner, projectNumber })
        )
          throw new Error("Fresh Project response is invalid");
        const fields = await source.readProjectFields();
        if (!hasFreshFieldCoordinates(fields, project))
          throw new Error("Fresh Project fields response is invalid");
        const items = await source.readProjectItems();
        if (!hasFreshItemCoordinates(items, project, operation, repository))
          throw new Error("Fresh Project items response is invalid");
        const matchingFields = fields.fields.filter(
          ({ name }) => name === operation.field,
        );
        const matchingOptions = (matchingFields[0]?.options ?? []).filter(
          ({ name }) => name === operation.value,
        );
        const matchingItems = items.items.filter(
          ({ content }) =>
            content.number === operation.issueNumber &&
            content.repository === repository,
        );
        if (
          matchingFields.length !== 1 ||
          matchingOptions.length !== 1 ||
          matchingItems.length !== 1
        )
          throw new Error(
            `Fresh Project coordinates are unavailable for #${operation.issueNumber} ${operation.field}=${operation.value}`,
          );
        const field = matchingFields[0];
        const option = matchingOptions[0];
        const item = matchingItems[0];
        const query = `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
          update: updateProjectV2ItemFieldValue(input: {
            projectId: $projectId,
            itemId: $itemId,
            fieldId: $fieldId,
            value: {singleSelectOptionId: $optionId}
          }) { projectV2Item { id } }
        }`;
        requireGraphqlSuccess(
          run([
            "api",
            "graphql",
            "-f",
            `query=${query}`,
            "-F",
            `projectId=${project.id}`,
            "-F",
            `itemId=${item.id}`,
            "-F",
            `fieldId=${field.id}`,
            "-F",
            `optionId=${option.id}`,
          ]),
          "Update Project field",
        );
        return;
      }

      const issueEndpoint = `repos/${repository}/issues/${operation.issueNumber}`;
      if (operation.type === "set-issue-labels") {
        run(
          ["api", "--method", "PUT", `${issueEndpoint}/labels`, "--input", "-"],
          {
            input: JSON.stringify({ labels: operation.labels }),
          },
        );
        return;
      }
      if (operation.type === "set-blocker-text") {
        run(["api", "--method", "PATCH", issueEndpoint, "--input", "-"], {
          input: JSON.stringify({ body: operation.body }),
        });
        return;
      }
      if (operation.type === "add-native-blocker") {
        run(
          [
            "api",
            "--method",
            "POST",
            `${issueEndpoint}/dependencies/blocked_by`,
            "--input",
            "-",
          ],
          { input: JSON.stringify({ issue_id: operation.blockerDatabaseId }) },
        );
        return;
      }
      if (operation.type === "remove-native-blocker") {
        run([
          "api",
          "--method",
          "DELETE",
          `${issueEndpoint}/dependencies/blocked_by/${operation.blockerDatabaseId}`,
        ]);
        return;
      }
      if (operation.type === "add-assignee") {
        run(
          [
            "api",
            "--method",
            "POST",
            `${issueEndpoint}/assignees`,
            "--input",
            "-",
          ],
          {
            input: JSON.stringify({ assignees: [operation.assignee] }),
          },
        );
        return;
      }
      throw new Error(`Unsupported reconciliation operation ${operation.type}`);
    },
  };
  return source;
}
