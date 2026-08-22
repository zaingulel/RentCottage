import { sameValues } from "./value-comparison.mjs";
import {
  canonicalBlockedByNumbers,
  canonicalBlockedBySectionCount,
} from "./rentcottage-issue-body.mjs";

function normalizeBody(body) {
  return String(body ?? "").replaceAll("\r\n", "\n");
}

export function protectedIssueLabelsAreValid(labels, policy) {
  return sameValues(labels, protectedIssueDesiredLabels(labels, policy));
}

export function protectedIssueDesiredLabels(labels, policy) {
  return [
    ...policy.labels,
    ...(labels.includes("owner-gated") ? ["owner-gated"] : []),
  ];
}

export function protectedIssueIsOwnerGated(labels, policy) {
  return Boolean(policy.ownerGated || labels.includes("owner-gated"));
}

export function protectedAcceptanceCriteria(body) {
  const section =
    normalizeBody(body)
      .split("## Acceptance criteria\n\n")[1]
      ?.split("\n\n## Blocked by")[0] ?? "";
  return [...section.matchAll(/^- \[[ xX]\] (.+)$/gm)].map((match) => match[1]);
}

export function protectedBlockerNumbers(body) {
  return canonicalBlockedByNumbers(body);
}

export function protectedIssuePolicyDifferences(
  { title, body, labels },
  policy,
) {
  const differences = [];
  if (title !== policy.title) differences.push("title");
  if (!protectedIssueLabelsAreValid(labels, policy)) differences.push("labels");
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
