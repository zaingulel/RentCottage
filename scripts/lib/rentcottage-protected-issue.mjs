import { sameValues } from "./value-comparison.mjs";
import { canonicalBlockedBySectionCount } from "./rentcottage-issue-body.mjs";

function normalizeBody(body) {
  return String(body ?? "").replaceAll("\r\n", "\n");
}

export function protectedAcceptanceCriteria(body) {
  const section =
    normalizeBody(body)
      .split("## Acceptance criteria\n\n")[1]
      ?.split("\n\n## Blocked by")[0] ?? "";
  return [...section.matchAll(/^- \[[ xX]\] (.+)$/gm)].map((match) => match[1]);
}

export function protectedBlockerNumbers(body) {
  const section =
    normalizeBody(body)
      .split("## Blocked by\n\n")[1]
      ?.split(/\n\n(?:## |<!--)/)[0] ?? "";
  return [...section.matchAll(/#(\d+)/g)].map((match) => Number(match[1]));
}

export function protectedIssuePolicyDifferences(
  { title, body, labels },
  policy,
) {
  const differences = [];
  if (title !== policy.title) differences.push("title");
  if (!sameValues(labels, policy.labels)) differences.push("labels");
  if (canonicalBlockedBySectionCount(body) !== 1)
    differences.push("blockerSection");
  if (!sameValues(protectedBlockerNumbers(body), policy.blockers))
    differences.push("blockers");
  if (
    policy.acceptanceCriteria &&
    !sameValues(protectedAcceptanceCriteria(body), policy.acceptanceCriteria)
  )
    differences.push("acceptanceCriteria");
  return differences;
}

export function protectedIssuePublicationIsComplete({
  title,
  body,
  labels,
  nativeBlockers,
  area,
  status,
  knownStatuses,
  policy,
}) {
  return (
    area === policy.area &&
    knownStatuses.has(status) &&
    protectedIssuePolicyDifferences({ title, body, labels }, policy).length ===
      0 &&
    Array.isArray(nativeBlockers) &&
    sameValues(
      nativeBlockers.map(({ number }) => number),
      policy.blockers,
    )
  );
}
