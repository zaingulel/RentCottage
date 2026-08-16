export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isProjectFieldRecord(field) {
  return (
    isRecord(field) &&
    typeof field.id === "string" &&
    typeof field.name === "string" &&
    (field.options === undefined ||
      (Array.isArray(field.options) &&
        field.options.every(
          (option) =>
            isRecord(option) &&
            typeof option.id === "string" &&
            typeof option.name === "string",
        )))
  );
}

export function hasUniqueProjectFieldCoordinates(fields) {
  const trackedFields = fields.filter(({ name }) =>
    ["Area", "Status", "Linked pull requests"].includes(name),
  );
  const options = trackedFields.flatMap((field) => field.options ?? []);
  const hasDuplicates = (values) => new Set(values).size !== values.length;
  return (
    !hasDuplicates(fields.map(({ id }) => id)) &&
    !hasDuplicates(trackedFields.map(({ name }) => name)) &&
    !hasDuplicates(options.map(({ id }) => id)) &&
    trackedFields.every(
      (field) => !hasDuplicates((field.options ?? []).map(({ name }) => name)),
    )
  );
}

export function isLinkedPullRequestRecord(pullRequest) {
  return (
    isRecord(pullRequest) &&
    Number.isInteger(pullRequest.number) &&
    typeof pullRequest.url === "string" &&
    isRecord(pullRequest.repository) &&
    typeof pullRequest.repository.nameWithOwner === "string"
  );
}

export function isProjectItemRecord(item) {
  return (
    isRecord(item) &&
    typeof item.id === "string" &&
    isRecord(item.content) &&
    typeof item.content.type === "string" &&
    (item.content.number === undefined ||
      Number.isInteger(item.content.number)) &&
    (item.content.repository === undefined ||
      typeof item.content.repository === "string") &&
    (item.area === undefined ||
      item.area === null ||
      typeof item.area === "string") &&
    (item.status === undefined ||
      item.status === null ||
      typeof item.status === "string") &&
    (item["linked pull requests"] === undefined ||
      (Array.isArray(item["linked pull requests"]) &&
        item["linked pull requests"].every(isLinkedPullRequestRecord)))
  );
}
