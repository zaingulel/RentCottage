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

const CONNECTION_PAGE_SIZE = 100;
const CONNECTION_ITEM_LIMIT = 1_000;
const PROJECT_FIELD_VALUE_PAGE_SIZE = 20;
const LINKED_PULL_REQUEST_PAGE_SIZE = 20;

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

const PROJECT_FIELD_NAMES = ["Area", "Status", "Linked pull requests"];

const FIELD_COORDINATE_SELECTION = `field { ... on ProjectV2FieldCommon { id name } }`;
const FIELD_VALUE_SELECTION = `
  __typename
  ... on ProjectV2ItemFieldValueCommon { ${FIELD_COORDINATE_SELECTION} }
  ... on ProjectV2ItemFieldLabelValue { ${FIELD_COORDINATE_SELECTION} }
  ... on ProjectV2ItemFieldMilestoneValue { ${FIELD_COORDINATE_SELECTION} }
  ... on ProjectV2ItemFieldPullRequestValue {
    ${FIELD_COORDINATE_SELECTION}
    pullRequests(first: ${LINKED_PULL_REQUEST_PAGE_SIZE}) {
      totalCount nodes { id number url repository { nameWithOwner } }
      pageInfo { hasNextPage endCursor }
    }
  }
  ... on ProjectV2ItemFieldRepositoryValue { ${FIELD_COORDINATE_SELECTION} }
  ... on ProjectV2ItemFieldReviewerValue { ${FIELD_COORDINATE_SELECTION} }
  ... on ProjectV2ItemFieldSingleSelectValue { name optionId }
  ... on ProjectV2ItemFieldUserValue { ${FIELD_COORDINATE_SELECTION} }
  ... on ProjectV2ItemIssueFieldValue { ${FIELD_COORDINATE_SELECTION} }
`;

function graphqlArgs(query, variables = {}) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [name, value] of Object.entries(variables)) {
    if (value === null || value === undefined) continue;
    args.push(Number.isInteger(value) ? "-F" : "-f", `${name}=${value}`);
  }
  return args;
}

function requireConnection(connection, context) {
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
  if (connection.pageInfo.hasNextPage && !connection.pageInfo.endCursor)
    throw new Error(`${context} pagination cursor is unavailable`);
  return connection;
}

function createConnectionState(
  connection,
  context,
  identityFrom,
  pageSize = CONNECTION_PAGE_SIZE,
) {
  const first = requireConnection(connection, context);
  const state = {
    context,
    totalCount: first.totalCount,
    nodes: [],
    identities: new Set(),
    cursors: new Set(),
    cursor: null,
    hasNextPage: false,
    pages: 0,
    pageSize,
  };
  appendConnectionPage(state, first, identityFrom);
  return state;
}

function appendConnectionPage(state, connection, identityFrom) {
  const page = requireConnection(connection, state.context);
  if (page.totalCount !== state.totalCount)
    throw new Error(`${state.context} totalCount changed during pagination`);
  if (state.pages >= Math.ceil(CONNECTION_ITEM_LIMIT / state.pageSize))
    throw new Error(
      `${state.context} pagination exceeded the page safety limit`,
    );
  for (const node of page.nodes) {
    const identity = identityFrom(node);
    if (typeof identity !== "string" || identity.length === 0)
      throw new Error(`${state.context} returned an invalid identity`);
    if (state.identities.has(identity))
      throw new Error(`${state.context} returned a duplicate identity`);
    state.identities.add(identity);
    state.nodes.push(node);
  }
  state.pages += 1;
  if (state.nodes.length > state.totalCount)
    throw new Error(`${state.context} returned more nodes than totalCount`);
  state.hasNextPage = page.pageInfo.hasNextPage;
  if (state.hasNextPage && state.cursors.has(page.pageInfo.endCursor))
    throw new Error(`${state.context} pagination cursor was repeated`);
  if (state.hasNextPage) state.cursors.add(page.pageInfo.endCursor);
  state.cursor = page.pageInfo.endCursor;
  if (!state.hasNextPage && state.nodes.length !== state.totalCount)
    throw new Error(`${state.context} pagination was truncated`);
}

function requireProjectAnchor(
  project,
  { projectOwner, projectNumber, projectId },
  context,
) {
  if (
    !isRecord(project) ||
    typeof project.id !== "string" ||
    (projectId !== undefined && project.id !== projectId) ||
    project.number !== projectNumber ||
    project.closed !== false ||
    !isRecord(project.owner) ||
    project.owner.login !== projectOwner
  ) {
    throw new Error(`${context} Project identity changed during pagination`);
  }
}

function requireItemAnchor(item, expected, repository, context) {
  if (
    !isRecord(item) ||
    typeof item.id !== "string" ||
    item.id !== expected.id ||
    !isRecord(item.content) ||
    item.content.__typename !== "Issue" ||
    typeof item.content.id !== "string" ||
    item.content.id !== expected.content.id ||
    !Number.isInteger(item.content.number) ||
    item.content.number !== expected.content.number ||
    item.content.repository?.nameWithOwner !== repository
  ) {
    throw new Error(
      `${context} item or issue identity changed during pagination`,
    );
  }
}

function linkedPullRequestIdentity(pullRequest) {
  if (
    !isRecord(pullRequest) ||
    typeof pullRequest.id !== "string" ||
    !Number.isInteger(pullRequest.number) ||
    typeof pullRequest.url !== "string" ||
    typeof pullRequest.repository?.nameWithOwner !== "string"
  ) {
    return null;
  }
  return `${pullRequest.repository.nameWithOwner}#${pullRequest.number}`;
}

function requireTrackedFields(fields) {
  if (
    !fields.every(isProjectFieldRecord) ||
    !hasUniqueProjectFieldCoordinates(fields)
  ) {
    throw new Error("Project field coordinates are invalid or ambiguous");
  }
  const coordinates = new Map();
  for (const name of PROJECT_FIELD_NAMES) {
    const matches = fields.filter((field) => field.name === name);
    if (matches.length !== 1)
      throw new Error(
        `Project ${name} field coordinate is unavailable or ambiguous`,
      );
    if (name !== "Linked pull requests" && !Array.isArray(matches[0].options))
      throw new Error(`Project ${name} field options are unavailable`);
    coordinates.set(name, matches[0]);
  }
  return coordinates;
}

function fieldValueIdentity(value) {
  return value?.field?.id;
}

function requireItemFieldValues(item, coordinates, projectFields) {
  const valuesById = new Map();
  const projectFieldsById = new Map(
    projectFields.map((coordinate) => [coordinate.id, coordinate]),
  );
  for (const value of item.fieldValues) {
    if (
      !isRecord(value) ||
      typeof value.__typename !== "string" ||
      !isRecord(value.field) ||
      typeof value.field.id !== "string" ||
      typeof value.field.name !== "string"
    ) {
      throw new Error(
        `Project item ${item.id} field value identity is invalid`,
      );
    }
    if (valuesById.has(value.field.id))
      throw new Error(`Project item ${item.id} has a duplicate field value`);
    const coordinateByName = coordinates.get(value.field.name);
    const coordinateById = projectFieldsById.get(value.field.id);
    if (
      !coordinateById ||
      coordinateById.name !== value.field.name ||
      (coordinateByName && coordinateByName.id !== value.field.id)
    ) {
      throw new Error(
        `Project item ${item.id} ${coordinateById?.name ?? value.field.name} field identity changed`,
      );
    }
    valuesById.set(value.field.id, value);
  }

  const normalized = {};
  for (const name of PROJECT_FIELD_NAMES) {
    const coordinate = coordinates.get(name);
    const value = valuesById.get(coordinate.id);
    if (!value) {
      normalized[name] = name === "Linked pull requests" ? [] : null;
      continue;
    }
    if (value.field.name !== name)
      throw new Error(`Project item ${item.id} ${name} field identity changed`);
    const expectedType =
      name === "Linked pull requests"
        ? "ProjectV2ItemFieldPullRequestValue"
        : "ProjectV2ItemFieldSingleSelectValue";
    if (value.__typename !== expectedType)
      throw new Error(
        `Project item ${item.id} ${name} field value type is invalid`,
      );
    if (name === "Linked pull requests") {
      normalized[name] = value.pullRequests;
    } else {
      if (typeof value.name !== "string" || typeof value.optionId !== "string")
        throw new Error(`Project item ${item.id} ${name} value is invalid`);
      const matchingOptions = coordinate.options.filter(
        (option) => option.name === value.name && option.id === value.optionId,
      );
      if (matchingOptions.length !== 1)
        throw new Error(
          `Project item ${item.id} ${name} option identity is invalid`,
        );
      normalized[name] = value.name;
    }
  }
  return normalized;
}

const PROJECT_EVIDENCE_QUERY = `query($login: String!, $number: Int!) {
  user(login: $login) {
    login
    projectV2(number: $number) {
      id number closed owner { ... on User { login } }
      fields(first: ${CONNECTION_PAGE_SIZE}) {
        totalCount nodes { __typename ... on ProjectV2FieldCommon { id name } ... on ProjectV2SingleSelectField { id name options { id name } } }
        pageInfo { hasNextPage endCursor }
      }
      items(first: ${CONNECTION_PAGE_SIZE}) {
        totalCount nodes {
          id
          content { __typename ... on Issue { id number repository { nameWithOwner } labels(first: ${CONNECTION_PAGE_SIZE}) { totalCount nodes { id name } pageInfo { hasNextPage endCursor } } } }
          fieldValues(first: ${PROJECT_FIELD_VALUE_PAGE_SIZE}) {
            totalCount nodes {
              ${FIELD_VALUE_SELECTION}
            }
            pageInfo { hasNextPage endCursor }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

function requireGraphqlSuccess(serialized, context) {
  const response = parseJson(serialized, context);
  const errors = graphqlResponseErrors(response, context);
  if (errors.length) throw graphqlResponseError(context, errors);
  return response;
}

function readBoundedConnection({
  context,
  readPage,
  connectionFrom,
  identityFrom,
}) {
  let state = null;
  while (!state || state.hasNextPage) {
    const value = readPage(state?.cursor ?? null);
    const connection = connectionFrom(value);
    if (state) appendConnectionPage(state, connection, identityFrom);
    else state = createConnectionState(connection, context, identityFrom);
  }
  return state.nodes;
}

export function createRentCottageGhSource({
  repository,
  projectOwner,
  projectNumber,
  run = runGh,
}) {
  const source = {
    async assertSupported() {
      assertSupportedGhVersion(run(["--version"]));
    },

    async readProjectEvidence() {
      const read = (query, variables, context) =>
        requireGraphqlSuccess(run(graphqlArgs(query, variables)), context);
      const response = read(
        PROJECT_EVIDENCE_QUERY,
        { login: projectOwner, number: projectNumber },
        "Project evidence",
      );
      const user = response.data?.user;
      const project = user?.projectV2;
      if (!isRecord(user) || user.login !== projectOwner)
        throw new Error("Project owner identity is invalid");
      requireProjectAnchor(
        project,
        { projectOwner, projectNumber },
        "Project evidence",
      );

      const fields = createConnectionState(
        project.fields,
        "Project fields",
        (field) => field?.id,
      );
      while (fields.hasNextPage) {
        const query = `query($login: String!, $number: Int!, $cursor: String!) {
          user(login: $login) { login projectV2(number: $number) {
            id number closed owner { ... on User { login } }
            fields(first: ${CONNECTION_PAGE_SIZE}, after: $cursor) {
              totalCount nodes { __typename ... on ProjectV2FieldCommon { id name } ... on ProjectV2SingleSelectField { id name options { id name } } }
              pageInfo { hasNextPage endCursor }
            }
          } }
        }`;
        const page = read(
          query,
          { login: projectOwner, number: projectNumber, cursor: fields.cursor },
          "Project fields",
        );
        if (page.data?.user?.login !== projectOwner)
          throw new Error(
            "Project fields owner identity changed during pagination",
          );
        const pageProject = page.data?.user?.projectV2;
        requireProjectAnchor(
          pageProject,
          { projectOwner, projectNumber, projectId: project.id },
          "Project fields",
        );
        appendConnectionPage(fields, pageProject.fields, (field) => field?.id);
      }
      const coordinates = requireTrackedFields(fields.nodes);

      const items = createConnectionState(
        project.items,
        "Project items",
        (item) => item?.id,
      );
      while (items.hasNextPage) {
        const query = `query($login: String!, $number: Int!, $cursor: String!) {
          user(login: $login) { login projectV2(number: $number) {
            id number closed owner { ... on User { login } }
            items(first: ${CONNECTION_PAGE_SIZE}, after: $cursor) {
              totalCount nodes {
                id
                content { __typename ... on Issue { id number repository { nameWithOwner } labels(first: ${CONNECTION_PAGE_SIZE}) { totalCount nodes { id name } pageInfo { hasNextPage endCursor } } } }
                fieldValues(first: ${PROJECT_FIELD_VALUE_PAGE_SIZE}) {
                  totalCount nodes { ${FIELD_VALUE_SELECTION} }
                  pageInfo { hasNextPage endCursor }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          } }
        }`;
        const page = read(
          query,
          { login: projectOwner, number: projectNumber, cursor: items.cursor },
          "Project items",
        );
        if (page.data?.user?.login !== projectOwner)
          throw new Error(
            "Project items owner identity changed during pagination",
          );
        const pageProject = page.data?.user?.projectV2;
        requireProjectAnchor(
          pageProject,
          { projectOwner, projectNumber, projectId: project.id },
          "Project items",
        );
        appendConnectionPage(items, pageProject.items, (item) => item?.id);
      }

      const normalizedItems = [];
      for (const item of items.nodes) {
        const context = `Project item ${item?.id ?? "unknown"}`;
        // Self-anchoring validates the initial item shape and repository before nested pagination.
        requireItemAnchor(item, item, repository, context);

        const labels = createConnectionState(
          item.content.labels,
          `${context} labels`,
          (label) => label?.id,
        );
        while (labels.hasNextPage) {
          const query = `query($itemId: ID!, $cursor: String!) {
            node(id: $itemId) { ... on ProjectV2Item {
              id content { __typename ... on Issue { id number repository { nameWithOwner } labels(first: ${CONNECTION_PAGE_SIZE}, after: $cursor) { totalCount nodes { id name } pageInfo { hasNextPage endCursor } } } }
            } }
          }`;
          const page = read(
            query,
            { itemId: item.id, cursor: labels.cursor },
            `${context} labels`,
          );
          requireItemAnchor(page.data?.node, item, repository, context);
          appendConnectionPage(
            labels,
            page.data.node.content.labels,
            (label) => label?.id,
          );
        }
        if (labels.nodes.some((label) => typeof label?.name !== "string"))
          throw new Error(`${context} label evidence is invalid`);

        const fieldValues = createConnectionState(
          item.fieldValues,
          `${context} field values`,
          fieldValueIdentity,
          PROJECT_FIELD_VALUE_PAGE_SIZE,
        );
        const fieldValuePageCursor = new Map(
          item.fieldValues.nodes.map((value) => [
            fieldValueIdentity(value),
            null,
          ]),
        );
        while (fieldValues.hasNextPage) {
          const pageStartCursor = fieldValues.cursor;
          const query = `query($itemId: ID!, $cursor: String!) {
            node(id: $itemId) { ... on ProjectV2Item {
              id content { __typename ... on Issue { id number repository { nameWithOwner } } }
              fieldValues(first: ${PROJECT_FIELD_VALUE_PAGE_SIZE}, after: $cursor) {
                totalCount nodes { ${FIELD_VALUE_SELECTION} }
                pageInfo { hasNextPage endCursor }
              }
            } }
          }`;
          const page = read(
            query,
            { itemId: item.id, cursor: pageStartCursor },
            `${context} field values`,
          );
          requireItemAnchor(page.data?.node, item, repository, context);
          appendConnectionPage(
            fieldValues,
            page.data.node.fieldValues,
            fieldValueIdentity,
          );
          for (const value of page.data.node.fieldValues.nodes)
            fieldValuePageCursor.set(
              fieldValueIdentity(value),
              pageStartCursor,
            );
        }
        item.fieldValues = fieldValues.nodes;

        const linkedCoordinate = coordinates.get("Linked pull requests");
        const linkedValue = item.fieldValues.find(
          (value) => value?.field?.id === linkedCoordinate.id,
        );
        if (linkedValue) {
          if (
            linkedValue.__typename !== "ProjectV2ItemFieldPullRequestValue" ||
            linkedValue.field?.name !== linkedCoordinate.name
          ) {
            throw new Error(
              `${context} Linked pull requests field value type is invalid`,
            );
          }
          const pullRequests = createConnectionState(
            linkedValue.pullRequests,
            `${context} linked pull requests`,
            linkedPullRequestIdentity,
            LINKED_PULL_REQUEST_PAGE_SIZE,
          );
          while (pullRequests.hasNextPage) {
            const query = `query($itemId: ID!, $fieldCursor: String, $pullRequestCursor: String!) {
              node(id: $itemId) { ... on ProjectV2Item {
                id content { __typename ... on Issue { id number repository { nameWithOwner } } }
                fieldValues(first: ${PROJECT_FIELD_VALUE_PAGE_SIZE}, after: $fieldCursor) {
                  nodes { __typename ... on ProjectV2ItemFieldPullRequestValue { field { ... on ProjectV2FieldCommon { id name } } pullRequests(first: ${LINKED_PULL_REQUEST_PAGE_SIZE}, after: $pullRequestCursor) { totalCount nodes { id number url repository { nameWithOwner } } pageInfo { hasNextPage endCursor } } } }
                }
              } }
            }`;
            const page = read(
              query,
              {
                itemId: item.id,
                fieldCursor: fieldValuePageCursor.get(linkedCoordinate.id),
                pullRequestCursor: pullRequests.cursor,
              },
              `${context} linked pull requests`,
            );
            requireItemAnchor(page.data?.node, item, repository, context);
            const matches = page.data.node.fieldValues?.nodes?.filter(
              (value) => value?.field?.id === linkedCoordinate.id,
            );
            if (
              matches?.length !== 1 ||
              matches[0].field.name !== linkedCoordinate.name ||
              matches[0].__typename !== "ProjectV2ItemFieldPullRequestValue"
            ) {
              throw new Error(
                `${context} linked pull-request field identity changed`,
              );
            }
            appendConnectionPage(
              pullRequests,
              matches[0].pullRequests,
              linkedPullRequestIdentity,
            );
          }
          linkedValue.pullRequests = pullRequests.nodes;
        }

        const values = requireItemFieldValues(item, coordinates, fields.nodes);
        normalizedItems.push({
          id: item.id,
          area: values.Area,
          status: values.Status,
          content: {
            type: item.content.__typename,
            number: item.content.number,
            repository: item.content.repository.nameWithOwner,
          },
          labels: labels.nodes.map(({ name }) => name),
          "linked pull requests": values["Linked pull requests"],
        });
      }

      return {
        project: {
          id: project.id,
          number: project.number,
          owner: { login: user.login },
          closed: project.closed,
          items: { totalCount: items.totalCount },
          fields: { totalCount: fields.totalCount },
        },
        fields: { totalCount: fields.totalCount, fields: fields.nodes },
        items: { totalCount: items.totalCount, items: normalizedItems },
      };
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
      const nodes = readBoundedConnection({
        context: `Pull request #${pullRequestNumber} closing references`,
        readPage(cursor) {
          const args = [
            "api",
            "graphql",
            "-f",
            `query=${query}`,
            "-f",
            `owner=${owner}`,
            "-f",
            `name=${name}`,
            "-F",
            `pullRequestNumber=${pullRequestNumber}`,
          ];
          if (cursor) args.push("-f", `cursor=${cursor}`);
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
        const { project } = await source.readProjectEvidence();
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
        const { project, fields, items } = await source.readProjectEvidence();
        if (
          !hasFreshProjectCoordinates(project, { projectOwner, projectNumber })
        )
          throw new Error("Fresh Project response is invalid");
        if (!hasFreshFieldCoordinates(fields, project))
          throw new Error("Fresh Project fields response is invalid");
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
            "-f",
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
