import {
  projectNumber,
  projectOwner,
  normalizeIssueBody,
  replacementIssues,
  repository,
  specialIssues,
  verifyRentCottageProject,
} from "./rentcottage-project-contract.mjs";
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

const issueSelection = `
  id number title state body repository { nameWithOwner }
  labels(first: 100) { totalCount nodes { id name } pageInfo { hasNextPage endCursor } }
  assignees(first: 100) { totalCount nodes { id login } pageInfo { hasNextPage endCursor } }
  blockedBy(first: 100) {
    totalCount nodes { id databaseId number state repository { nameWithOwner } }
    pageInfo { hasNextPage endCursor }
  }
`;

const fieldCoordinateSelection =
  "field { ... on ProjectV2FieldCommon { id name } }";
const fieldValueSelection = `
  __typename
  ... on ProjectV2ItemFieldValueCommon { ${fieldCoordinateSelection} }
  ... on ProjectV2ItemFieldLabelValue { ${fieldCoordinateSelection} }
  ... on ProjectV2ItemFieldMilestoneValue { ${fieldCoordinateSelection} }
  ... on ProjectV2ItemFieldPullRequestValue { ${fieldCoordinateSelection} }
  ... on ProjectV2ItemFieldRepositoryValue { ${fieldCoordinateSelection} }
  ... on ProjectV2ItemFieldReviewerValue { ${fieldCoordinateSelection} }
  ... on ProjectV2ItemFieldSingleSelectValue { name optionId }
  ... on ProjectV2ItemFieldUserValue { ${fieldCoordinateSelection} }
  ... on ProjectV2ItemIssueFieldValue { ${fieldCoordinateSelection} }
`;

const projectItemSelection = `
  id type isArchived
  content { ... on Issue { ${issueSelection} } }
  fieldValues(first: 100) {
    totalCount
    nodes { ${fieldValueSelection} }
    pageInfo { hasNextPage endCursor }
  }
`;

const projectQuery = `
query($login: String!, $number: Int!, $targetIds: [ID!]!) {
  user(login: $login) {
    login
    projectV2(number: $number) {
      id number title closed readme owner { ... on User { login } }
      fields(first: 100) {
        totalCount
        nodes {
          ... on ProjectV2Field { id name }
          ... on ProjectV2SingleSelectField { id name options { id name } }
        }
        pageInfo { hasNextPage endCursor }
      }
      items(first: 100) {
        totalCount
        nodes { ${projectItemSelection} }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
  nodes(ids: $targetIds) { ... on Issue { ${issueSelection} } }
}`;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function graphqlArgs(query, variables) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [name, value] of Object.entries(variables)) {
    if (Array.isArray(value)) {
      if (value.length === 0) args.push("-f", `${name}[]`);
      else for (const entry of value) args.push("-f", `${name}[]=${entry}`);
      continue;
    }
    args.push(Number.isInteger(value) ? "-F" : "-f", `${name}=${value}`);
  }
  return args;
}

function requireConnection(value, context) {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.totalCount) ||
    value.totalCount < 0 ||
    value.totalCount > 1_000 ||
    !Array.isArray(value.nodes) ||
    !isRecord(value.pageInfo) ||
    typeof value.pageInfo.hasNextPage !== "boolean" ||
    (value.pageInfo.endCursor !== null &&
      typeof value.pageInfo.endCursor !== "string") ||
    (value.pageInfo.hasNextPage && !value.pageInfo.endCursor)
  )
    throw new Error(`${context} pagination evidence is invalid`);
  return value;
}

function collectConnection(initial, context, identityFrom, readNext) {
  const first = requireConnection(initial, context);
  const totalCount = first.totalCount;
  const nodes = [];
  const identities = new Set();
  const cursors = new Set();
  let page = first;
  let pageCount = 0;
  while (true) {
    if (page.totalCount !== totalCount)
      throw new Error(`${context} totalCount changed during pagination`);
    for (const node of page.nodes) {
      const identity = identityFrom(node);
      if (typeof identity !== "string" || !identity)
        throw new Error(`${context} returned an invalid identity`);
      if (identities.has(identity))
        throw new Error(`${context} returned a duplicate identity`);
      identities.add(identity);
      nodes.push(node);
    }
    pageCount += 1;
    if (nodes.length > totalCount || pageCount > 10)
      throw new Error(`${context} exceeded its safety limit`);
    if (!page.pageInfo.hasNextPage) {
      if (nodes.length !== totalCount)
        throw new Error(`${context} pagination was truncated`);
      return nodes;
    }
    const cursor = page.pageInfo.endCursor;
    if (cursors.has(cursor))
      throw new Error(`${context} pagination cursor was repeated`);
    cursors.add(cursor);
    page = requireConnection(readNext(cursor), context);
  }
}

function issueList(numbers) {
  return numbers.map((number) => `#${number}`).join(", ") || "none";
}

function jsonReadiness(summary) {
  return {
    schemaVersion: 1,
    dependencyFrontier: summary.dependencyFrontier,
    ownerGated: summary.ownerGated,
    readyForHuman: summary.readyForHuman,
    needsTriage: summary.needsTriage,
    needsInfo: summary.needsInfo,
    wontfix: summary.wontfix,
  };
}

export function parseRentCottageVerifierArgs(args) {
  if (args.length === 0) return { json: false };
  if (args.length === 1 && args[0] === "--json") return { json: true };
  throw new Error("Usage: npm run verify:board -- [--json]");
}

export function runRentCottageProjectVerifierCommand(
  args,
  { stderr = console.error, ...options } = {},
) {
  let command;
  try {
    command = parseRentCottageVerifierArgs(args);
  } catch (error) {
    stderr(error.message);
    return { status: 2, error };
  }
  return runRentCottageProjectVerifier({ ...options, ...command, stderr });
}

export function runRentCottageProjectVerifier({
  run,
  execute,
  verify = verifyRentCottageProject,
  json = false,
  stdout = console.log,
  stderr = console.error,
}) {
  try {
    const providerRun = run ?? ((args) => runGh(args, { execute }));
    assertSupportedGhVersion(providerRun(["--version"]));
    const rawIssues = parseUniqueRepositoryIssuePages(
      providerRun(
        paginatedRestArgs(`repos/${repository}/issues?state=all&per_page=100`),
      ),
      "Issue",
      repository,
    ).filter((issue) => !issue.pull_request);
    const issues = rawIssues.map((issue) => ({
      ...issue,
      state: issue.state.toUpperCase(),
      body: normalizeIssueBody(issue.body),
    }));

    const readGraphql = (query, variables, context) => {
      const response = JSON.parse(providerRun(graphqlArgs(query, variables)));
      const errors = graphqlResponseErrors(response, context);
      if (errors.length) throw graphqlResponseError(context, errors);
      return response;
    };
    const targetNumbers = new Set([
      ...replacementIssues.map(({ number }) => number),
      ...specialIssues.keys(),
    ]);
    const targetIds = rawIssues
      .filter(({ number }) => targetNumbers.has(number))
      .map(({ node_id }) => node_id);
    if (targetIds.some((id) => typeof id !== "string" || id === ""))
      throw new Error("Protected issue node identity is unavailable");
    const projectResponse = readGraphql(
      projectQuery,
      { login: projectOwner, number: projectNumber, targetIds },
      "Project query",
    );
    if (projectResponse.data?.user?.login !== projectOwner)
      throw new Error("Project owner identity is invalid");
    const project = projectResponse.data?.user?.projectV2;
    if (
      !isRecord(project) ||
      project.id === "" ||
      project.number !== projectNumber ||
      project.closed !== false ||
      project.owner?.login !== projectOwner
    )
      throw new Error(
        `Project ${projectOwner}/${projectNumber} was unavailable`,
      );

    project.fields.nodes = collectConnection(
      project.fields,
      "Project fields",
      (field) => field?.id,
      (cursor) => {
        const response = readGraphql(
          `query($login: String!, $number: Int!, $cursor: String!) {
            user(login: $login) { login projectV2(number: $number) {
              id number closed owner { ... on User { login } }
              fields(first: 100, after: $cursor) {
                totalCount nodes { ... on ProjectV2Field { id name } ... on ProjectV2SingleSelectField { id name options { id name } } }
                pageInfo { hasNextPage endCursor }
              }
            } }
          }`,
          { login: projectOwner, number: projectNumber, cursor },
          "Project fields",
        );
        const pageProject = response.data?.user?.projectV2;
        if (
          response.data?.user?.login !== projectOwner ||
          pageProject?.id !== project.id ||
          pageProject?.number !== project.number ||
          pageProject?.owner?.login !== projectOwner ||
          pageProject?.closed !== false
        )
          throw new Error("Project fields parent identity changed");
        return pageProject.fields;
      },
    );

    project.items.nodes = collectConnection(
      project.items,
      "Project items",
      (item) => item?.id,
      (cursor) => {
        const response = readGraphql(
          `query($login: String!, $number: Int!, $cursor: String!) {
            user(login: $login) { login projectV2(number: $number) {
              id number closed owner { ... on User { login } }
              items(first: 100, after: $cursor) {
                totalCount nodes { ${projectItemSelection} }
                pageInfo { hasNextPage endCursor }
              }
            } }
          }`,
          { login: projectOwner, number: projectNumber, cursor },
          "Project items",
        );
        const pageProject = response.data?.user?.projectV2;
        if (
          response.data?.user?.login !== projectOwner ||
          pageProject?.id !== project.id ||
          pageProject?.number !== project.number ||
          pageProject?.owner?.login !== projectOwner ||
          pageProject?.closed !== false
        )
          throw new Error("Project items parent identity changed");
        return pageProject.items;
      },
    );

    const completeIssue = (initial, context) => {
      if (
        !isRecord(initial) ||
        typeof initial.id !== "string" ||
        !Number.isInteger(initial.number) ||
        initial.repository?.nameWithOwner !== repository ||
        !["OPEN", "CLOSED"].includes(initial.state)
      )
        throw new Error(`${context} identity is invalid`);
      const issue = structuredClone(initial);
      for (const [name, selection, identityFrom] of [
        ["labels", "id name", (node) => node?.id],
        ["assignees", "id login", (node) => node?.id],
        [
          "blockedBy",
          "id databaseId number state repository { nameWithOwner }",
          (node) => node?.id,
        ],
      ]) {
        issue[name].nodes = collectConnection(
          issue[name],
          `${context} ${name}`,
          identityFrom,
          (cursor) => {
            const response = readGraphql(
              `query($issueId: ID!, $cursor: String!) {
                node(id: $issueId) { ... on Issue {
                  id number repository { nameWithOwner }
                  ${name}(first: 100, after: $cursor) {
                    totalCount nodes { ${selection} }
                    pageInfo { hasNextPage endCursor }
                  }
                } }
              }`,
              { issueId: issue.id, cursor },
              `${context} ${name}`,
            );
            const parent = response.data?.node;
            if (
              parent?.id !== issue.id ||
              parent?.number !== issue.number ||
              parent?.repository?.nameWithOwner !== repository
            )
              throw new Error(`${context} identity changed during pagination`);
            return parent[name];
          },
        );
      }
      if (
        issue.labels.nodes.some(({ name }) => typeof name !== "string") ||
        issue.assignees.nodes.some(({ login }) => typeof login !== "string") ||
        issue.blockedBy.nodes.some(
          (blocker) =>
            !Number.isInteger(blocker?.databaseId) ||
            !Number.isInteger(blocker?.number) ||
            !["OPEN", "CLOSED"].includes(blocker?.state) ||
            blocker.repository?.nameWithOwner !== repository,
        ) ||
        new Set(issue.blockedBy.nodes.map(({ databaseId }) => databaseId))
          .size !== issue.blockedBy.nodes.length ||
        new Set(issue.blockedBy.nodes.map(({ number }) => number)).size !==
          issue.blockedBy.nodes.length
      )
        throw new Error(
          `${context} connection evidence contains a duplicate stable identity`,
        );
      return issue;
    };

    for (const item of project.items.nodes) {
      if (item?.content?.id)
        item.content = completeIssue(item.content, `Project item ${item.id}`);
      item.fieldValues.nodes = collectConnection(
        item.fieldValues,
        `Project item ${item?.id ?? "unknown"} field values`,
        (value) => value?.field?.id,
        (cursor) => {
          const response = readGraphql(
            `query($itemId: ID!, $cursor: String!) {
              node(id: $itemId) { ... on ProjectV2Item {
                id
                fieldValues(first: 100, after: $cursor) {
                  totalCount nodes { ${fieldValueSelection} }
                  pageInfo { hasNextPage endCursor }
                }
              } }
            }`,
            { itemId: item.id, cursor },
            `Project item ${item.id} field values`,
          );
          const parent = response.data?.node;
          if (parent?.id !== item.id)
            throw new Error(
              `Project item ${item.id} identity changed during pagination`,
            );
          return parent.fieldValues;
        },
      );
    }
    const targetIssues = (projectResponse.data?.nodes ?? []).map(
      (issue, index) => completeIssue(issue, `Protected target ${index + 1}`),
    );
    if (
      targetIssues.length !== targetIds.length ||
      new Set(targetIssues.map(({ id }) => id)).size !== targetIssues.length ||
      targetIssues.some(({ id }) => !targetIds.includes(id))
    )
      throw new Error("Protected target issue evidence is incomplete");

    const nativeBlockersByIssue = new Map();
    for (const issue of [
      ...project.items.nodes.map(({ content }) => content).filter(Boolean),
      ...targetIssues,
    ]) {
      const blockers = issue.blockedBy.nodes.map(
        ({ databaseId, id, number, state }) => ({
          id: databaseId,
          nodeId: id,
          number,
          state: state.toLowerCase(),
        }),
      );
      const prior = nativeBlockersByIssue.get(issue.number);
      if (prior && JSON.stringify(prior) !== JSON.stringify(blockers))
        throw new Error(`#${issue.number} blocker evidence conflicts`);
      nativeBlockersByIssue.set(issue.number, blockers);
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

    if (json) {
      stdout(JSON.stringify(jsonReadiness(result.summary)));
      return { status: 0, result };
    }

    stdout(
      `Verified Project 4: ${result.summary.itemCount} current items, all required contract items, 33 unique D tickets, Project fields, issue integrity, native dependencies, and durable Status invariants.`,
    );
    stdout(
      `Current dependency frontier: ${issueList(result.summary.dependencyFrontier)}.`,
    );
    stdout(
      `Current unblocked owner-gated items: ${issueList(result.summary.ownerGated)}.`,
    );
    stdout(
      `Current unblocked ready-for-human items: ${issueList(result.summary.readyForHuman)}.`,
    );
    stdout(
      `Current unblocked needs-triage items: ${issueList(result.summary.needsTriage)}.`,
    );
    stdout(
      `Current unblocked needs-info items: ${issueList(result.summary.needsInfo)}.`,
    );
    stdout(
      `Current unblocked wontfix items: ${issueList(result.summary.wontfix)}.`,
    );
    stdout(
      `Current Project Ready items: ${issueList(result.summary.readyItems)}.`,
    );
    return { status: 0, result };
  } catch (error) {
    stderr(
      `RentCottage Project verification failed: ${errorDiagnostic(error)}`,
    );
    return { status: 1, error };
  }
}
