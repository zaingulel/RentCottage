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
