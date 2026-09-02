export const BOARD_OWNER = "zaingulel";
export const BOARD_PROJECT_NUMBER = 4;
export const BOARD_REPOSITORY = "zaingulel/RentCottage";

const STATUS_OPTIONS = ["Backlog", "Ready", "In progress", "In review", "Done"];
const AREA_OPTIONS = [
  "Foundation & quality",
  "Customer marketplace",
  "Owner backoffice",
  "Booking lifecycle",
  "Administration & governance",
];
const TRIAGE_LABELS = new Set([
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-human",
  "wontfix",
]);
const ACTIVE_STATUSES = new Set(["In progress", "In review"]);
const UNBLOCKED_STATUSES = new Set(["Ready", ...ACTIVE_STATUSES]);

const issueSelection = `
  __typename
  ... on Issue {
    id number title state repository { nameWithOwner }
    labels(first:20) {
      totalCount nodes { name } pageInfo { hasNextPage endCursor }
    }
    assignees(first:20) {
      totalCount nodes { login } pageInfo { hasNextPage endCursor }
    }
    blockedBy(first:20) {
      totalCount
      nodes { id number state repository { nameWithOwner } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const fieldValueSelection = `
  ... on ProjectV2ItemFieldSingleSelectValue {
    name
    field { ... on ProjectV2FieldCommon { name } }
  }
`;

export function boardQuery(afterCursor) {
  const after = afterCursor ? `, after:${JSON.stringify(afterCursor)}` : "";
  return `query {
    user(login:${JSON.stringify(BOARD_OWNER)}) {
      login
      projectV2(number:${BOARD_PROJECT_NUMBER}) {
        id number title closed owner { ... on User { login } }
        fields(first:50) {
          totalCount
          nodes {
            ... on ProjectV2FieldCommon { id name dataType }
            ... on ProjectV2SingleSelectField { options { id name } }
          }
          pageInfo { hasNextPage endCursor }
        }
        items(first:100${after}) {
          totalCount
          nodes {
            id type isArchived
            content { ${issueSelection} }
            fieldValues(first:20) {
              totalCount nodes { ${fieldValueSelection} }
              pageInfo { hasNextPage endCursor }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }`;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function completeConnection(value, context) {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.totalCount) ||
    value.totalCount < 0 ||
    !Array.isArray(value.nodes) ||
    !isRecord(value.pageInfo) ||
    typeof value.pageInfo.hasNextPage !== "boolean" ||
    (value.pageInfo.endCursor !== null &&
      typeof value.pageInfo.endCursor !== "string")
  )
    throw new Error(`${context} connection is malformed`);
  return value;
}

function requireComplete(value, context) {
  const connection = completeConnection(value, context);
  if (
    connection.pageInfo.hasNextPage ||
    connection.totalCount !== connection.nodes.length
  )
    throw new Error(`${context} connection is truncated`);
  return connection.nodes;
}

function parseResponse(serialized) {
  let response;
  try {
    response =
      typeof serialized === "string" ? JSON.parse(serialized) : serialized;
  } catch {
    throw new Error("Project 4 query returned invalid JSON");
  }
  if (!isRecord(response))
    throw new Error("Project 4 query returned an invalid response");
  if (Object.hasOwn(response, "errors")) {
    if (!Array.isArray(response.errors))
      throw new Error("Project 4 query returned malformed GraphQL errors");
    if (response.errors.length > 0)
      throw new Error(
        `Project 4 query returned ${response.errors.length} GraphQL error(s)`,
      );
  }
  return response;
}

function fieldValue(item, name) {
  return (
    item.fieldValues.nodes.find((value) => value?.field?.name === name)?.name ??
    null
  );
}

function normalizeItem(item) {
  const content = item.content ?? {};
  const labels = requireComplete(content.labels, `#${content.number} labels`);
  const assignees = requireComplete(
    content.assignees,
    `#${content.number} assignees`,
  );
  const blockers = requireComplete(
    content.blockedBy,
    `#${content.number} blockers`,
  );
  requireComplete(item.fieldValues, `#${content.number} field values`);
  return {
    id: item.id,
    type: item.type,
    isArchived: item.isArchived,
    issueId: content.id,
    contentType: content.__typename,
    number: content.number,
    title: content.title,
    state: content.state,
    repository: content.repository?.nameWithOwner,
    status: fieldValue(item, "Status"),
    area: fieldValue(item, "Area"),
    labels: labels.map(({ name }) => name),
    assignees: assignees.map(({ login }) => login),
    blockers: blockers.map((blocker) => ({
      id: blocker.id,
      number: blocker.number,
      state: blocker.state,
      repository: blocker.repository?.nameWithOwner,
    })),
  };
}

function readPage(execute, afterCursor) {
  const response = parseResponse(
    execute(["api", "graphql", "-f", `query=${boardQuery(afterCursor)}`]),
  );
  const user = response.data?.user;
  const project = user?.projectV2;
  if (
    user?.login !== BOARD_OWNER ||
    !isRecord(project) ||
    typeof project.id !== "string" ||
    project.id.length === 0 ||
    project.number !== BOARD_PROJECT_NUMBER ||
    project.title !== "RentCottage" ||
    project.closed !== false ||
    project.owner?.login !== BOARD_OWNER
  )
    throw new Error("RentCottage Project 4 identity or open state is invalid");

  const fields = requireComplete(project.fields, "Project 4 fields");
  const items = completeConnection(project.items, "Project 4 items");
  return {
    project: {
      id: project.id,
      owner: user.login,
      number: project.number,
      title: project.title,
      itemCount: project.items.totalCount,
      fields,
    },
    items,
  };
}

export function fetchBoard(execute) {
  const first = readPage(execute);
  const items = [];
  const cursors = new Set();
  let page = first;
  let pageCount = 0;

  while (true) {
    if (
      page.project.id !== first.project.id ||
      page.project.itemCount !== first.project.itemCount ||
      JSON.stringify(page.project.fields) !==
        JSON.stringify(first.project.fields)
    )
      throw new Error("Project 4 identity or fields changed during pagination");

    items.push(...page.items.nodes.map(normalizeItem));
    pageCount += 1;
    if (items.length > first.project.itemCount || pageCount > 10)
      throw new Error("Project 4 items exceeded the pagination safety limit");
    if (!page.items.pageInfo.hasNextPage) break;

    const cursor = page.items.pageInfo.endCursor;
    if (typeof cursor !== "string" || cursor.length === 0)
      throw new Error("Project 4 items pagination has no end cursor");
    if (cursors.has(cursor))
      throw new Error("Project 4 items pagination repeated an end cursor");
    cursors.add(cursor);
    page = readPage(execute, cursor);
  }

  if (items.length !== first.project.itemCount)
    throw new Error(
      `Project 4 reported ${first.project.itemCount} items but returned ${items.length}`,
    );

  return { project: first.project, items };
}

function sameMembers(actual, expected) {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((value) => actual.includes(value))
  );
}

function validateRequiredField(fields, name, expectedOptions) {
  const matches = fields.filter((field) => field?.name === name);
  if (matches.length !== 1 || matches[0].dataType !== "SINGLE_SELECT")
    throw new Error(`Project 4 requires one ${name} single-select field`);
  const options = matches[0].options;
  if (
    !Array.isArray(options) ||
    options.some(
      (option) =>
        typeof option?.id !== "string" ||
        option.id.length === 0 ||
        typeof option.name !== "string" ||
        option.name.length === 0,
    ) ||
    new Set(options.map(({ id }) => id)).size !== options.length ||
    !sameMembers(
      options.map(({ name: optionName }) => optionName),
      expectedOptions,
    )
  )
    throw new Error(`Project 4 ${name} options are invalid`);
}

function requireUniqueStrings(values, context) {
  if (
    !Array.isArray(values) ||
    values.some((value) => typeof value !== "string" || value.length === 0) ||
    new Set(values).size !== values.length
  )
    throw new Error(`${context} are invalid`);
}

function validateItem(item) {
  if (
    typeof item.id !== "string" ||
    item.id.length === 0 ||
    item.type !== "ISSUE" ||
    item.isArchived !== false ||
    item.contentType !== "Issue" ||
    typeof item.issueId !== "string" ||
    item.issueId.length === 0 ||
    !Number.isInteger(item.number) ||
    item.number <= 0 ||
    typeof item.title !== "string" ||
    item.title.trim().length === 0 ||
    !["OPEN", "CLOSED"].includes(item.state) ||
    item.repository !== BOARD_REPOSITORY
  )
    throw new Error(
      "Project 4 contains a draft, pull request, foreign, archived, or malformed item",
    );
  if (!STATUS_OPTIONS.includes(item.status))
    throw new Error(`#${item.number} has an unknown or missing Status`);
  if (!AREA_OPTIONS.includes(item.area))
    throw new Error(`#${item.number} has an unknown or missing Area`);
  requireUniqueStrings(item.labels, `#${item.number} labels`);
  requireUniqueStrings(item.assignees, `#${item.number} assignees`);
  if (
    !Array.isArray(item.blockers) ||
    item.blockers.some(
      (blocker) =>
        typeof blocker?.id !== "string" ||
        blocker.id.length === 0 ||
        !Number.isInteger(blocker.number) ||
        blocker.number <= 0 ||
        blocker.number === item.number ||
        !["OPEN", "CLOSED"].includes(blocker.state) ||
        blocker.repository !== BOARD_REPOSITORY,
    ) ||
    new Set(item.blockers.map(({ id }) => id)).size !== item.blockers.length ||
    new Set(item.blockers.map(({ number }) => number)).size !==
      item.blockers.length
  )
    throw new Error(`#${item.number} native blockers are invalid`);
}

function classifyOpenItem(item) {
  const openBlockers = item.blockers
    .filter(({ state }) => state === "OPEN")
    .map(({ number }) => number)
    .sort((left, right) => left - right);
  if (openBlockers.length > 0 && UNBLOCKED_STATUSES.has(item.status))
    throw new Error(
      `#${item.number} cannot be ${item.status} while native blockers remain open`,
    );
  if (ACTIVE_STATUSES.has(item.status) && item.assignees.length === 0)
    throw new Error(`#${item.number} is ${item.status} without an assignee`);

  const triageLabels = item.labels.filter((label) => TRIAGE_LABELS.has(label));
  if (triageLabels.length > 1)
    throw new Error(`#${item.number} has multiple triage labels`);

  let classification;
  if (item.assignees.length > 0 || ACTIVE_STATUSES.has(item.status))
    classification = "active-owned";
  else if (openBlockers.length > 0) classification = "blocked";
  else if (triageLabels.length === 0) classification = "needs-triage";
  else if (["needs-triage", "needs-info", "wontfix"].includes(triageLabels[0]))
    classification = triageLabels[0];
  else if (item.labels.includes("owner-gated")) classification = "owner-gated";
  else if (triageLabels[0] === "ready-for-human")
    classification = "ready-for-human";
  else classification = "ready";

  return {
    number: item.number,
    title: item.title,
    status: item.status,
    area: item.area,
    labels: item.labels,
    assignees: item.assignees,
    openBlockers,
    classification,
  };
}

export function classifyBoard(board) {
  validateRequiredField(board.project.fields, "Status", STATUS_OPTIONS);
  validateRequiredField(board.project.fields, "Area", AREA_OPTIONS);

  const itemIds = new Set();
  const issueIds = new Set();
  const issueNumbers = new Set();
  const openItems = [];
  for (const item of board.items) {
    validateItem(item);
    if (
      itemIds.has(item.id) ||
      issueIds.has(item.issueId) ||
      issueNumbers.has(item.number)
    )
      throw new Error("Project 4 contains a duplicate item or issue identity");
    itemIds.add(item.id);
    issueIds.add(item.issueId);
    issueNumbers.add(item.number);

    if (item.state === "CLOSED" && item.status !== "Done")
      throw new Error(
        `#${item.number} is closed but its Status is ${item.status}`,
      );
    if (item.state === "OPEN" && item.status === "Done")
      throw new Error(`#${item.number} is open but its Status is Done`);
    if (item.state === "OPEN") openItems.push(classifyOpenItem(item));
  }

  openItems.sort((left, right) => left.number - right.number);
  return {
    schemaVersion: 2,
    project: {
      owner: board.project.owner,
      number: board.project.number,
      title: board.project.title,
      itemCount: board.project.itemCount,
      openItemCount: openItems.length,
    },
    items: openItems,
  };
}

const CLASSIFICATION_ORDER = [
  "active-owned",
  "ready",
  "blocked",
  "owner-gated",
  "ready-for-human",
  "needs-info",
  "needs-triage",
  "wontfix",
];

function formatItem(item) {
  const blockers = item.openBlockers.length
    ? ` — open blockers: ${item.openBlockers.map((number) => `#${number}`).join(", ")}`
    : "";
  const assignees = item.assignees.length
    ? ` — assigned: ${item.assignees.join(", ")}`
    : "";
  return `#${item.number} [${item.status}] ${item.title}${blockers}${assignees}`;
}

export function formatBoard(report) {
  const groups = CLASSIFICATION_ORDER.flatMap((classification) => {
    const items = report.items.filter(
      (item) => item.classification === classification,
    );
    if (items.length === 0) return [];
    return [
      `${classification} (${items.length})\n${items.map(formatItem).join("\n")}`,
    ];
  });
  return [
    `RentCottage Project 4 — ${report.project.openItemCount} open of ${report.project.itemCount} items`,
    ...groups,
  ].join("\n\n");
}
