export function dependencyIssueNumbers({
  project,
  repository,
  requiredIssueNumbers,
}) {
  const issueNumbers = new Set(requiredIssueNumbers);
  for (const item of project.items.nodes) {
    if (
      item.type === "ISSUE" &&
      item.content?.repository?.nameWithOwner === repository &&
      Number.isInteger(item.content.number)
    ) {
      issueNumbers.add(item.content.number);
    }
  }
  return [...issueNumbers].sort((left, right) => left - right);
}

export function normalizedDependencyState(state) {
  if (typeof state !== "string") return null;
  const normalized = state.toUpperCase();
  return normalized === "OPEN" || normalized === "CLOSED" ? normalized : null;
}

export function dependencyIsClosed({ state }) {
  return normalizedDependencyState(state) === "CLOSED";
}
