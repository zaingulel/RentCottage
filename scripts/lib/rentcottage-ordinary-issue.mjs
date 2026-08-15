import {
  canonicalBlockedByNumbers,
  canonicalBlockedBySectionCount,
} from "./rentcottage-issue-body.mjs";

const TRIAGE_LABELS = new Set([
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-human",
  "wontfix",
]);

export function ordinaryIssueShape(body, labels) {
  const normalizedBody = String(body ?? "").replaceAll("\r\n", "\n");
  const triageLabelCount = labels.filter((label) =>
    TRIAGE_LABELS.has(label),
  ).length;
  const blockerSectionCount = canonicalBlockedBySectionCount(normalizedBody);
  return {
    triageLabelCount,
    blockerSectionCount,
    valid: triageLabelCount === 1 && blockerSectionCount === 1,
  };
}

export function ordinaryIssueBlockerNumbers(body) {
  return canonicalBlockedByNumbers(body);
}

function sameNumbers(actual, expected) {
  const actualSorted = [...actual].sort((left, right) => left - right);
  const expectedSorted = [...expected].sort((left, right) => left - right);
  return (
    actualSorted.length === expectedSorted.length &&
    actualSorted.every((value, index) => value === expectedSorted[index])
  );
}

export function ordinaryIssueFrontierEligible({
  body,
  labels,
  area,
  status,
  knownAreas,
  knownStatuses,
  nativeBlockers,
}) {
  const shape = ordinaryIssueShape(body, labels);
  return (
    shape.valid &&
    labels.includes("ready-for-agent") &&
    knownAreas.has(area) &&
    knownStatuses.has(status) &&
    Array.isArray(nativeBlockers) &&
    sameNumbers(
      ordinaryIssueBlockerNumbers(body),
      nativeBlockers.map(({ number }) => number),
    ) &&
    nativeBlockers.every(({ state }) => state.toLowerCase() !== "open")
  );
}
