import {
  acceptanceCriteriaByIssue,
  projectNumber,
  projectOwner,
  replacementIssues,
  repository,
  specialIssues,
} from "./rentcottage-project-contract.mjs";
import { obsoleteProjectIssueNumbers } from "./rentcottage-tracker-constants.mjs";

export function createRentCottageTrackerPolicy() {
  const issues = new Map(
    replacementIssues.map((issue) => [
      issue.number,
      {
        number: issue.number,
        title: issue.title,
        area: issue.area,
        labels: ["ready-for-agent"],
        blockers: [...issue.blockers],
        ownerGated: false,
        acceptanceCriteria: [
          ...(acceptanceCriteriaByIssue.get(issue.number) ?? []),
        ],
      },
    ]),
  );
  for (const [number, issue] of specialIssues) {
    issues.set(number, {
      number,
      title: issue.title,
      area: issue.area,
      labels: [...issue.labels],
      blockers: [...(issue.blockers ?? [])],
      ownerGated: issue.ownerGated ?? false,
    });
  }
  return {
    repository,
    projectOwner,
    projectNumber,
    issues,
    excludedProjectIssueNumbers: new Set(obsoleteProjectIssueNumbers),
  };
}
