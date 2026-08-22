import { createHash } from "node:crypto";
import {
  ordinaryIssueFrontierEligible,
  ordinaryIssueShape,
} from "./rentcottage-ordinary-issue.mjs";
import {
  dependencyIsClosed,
  normalizedDependencyState,
} from "./rentcottage-board-dependencies.mjs";
import {
  protectedAcceptanceCriteria,
  protectedIssueDesiredLabels,
  protectedIssueIsOwnerGated,
  protectedIssuePublicationIsComplete,
} from "./rentcottage-protected-issue.mjs";
import {
  canonicalBlockedByNumbers as blockerNumbers,
  canonicalBlockedBySectionCount,
  replaceCanonicalBlockedBySection,
} from "./rentcottage-issue-body.mjs";
import { sameValues } from "./value-comparison.mjs";

function stableValue(value) {
  if (value instanceof Map) {
    return [...value.entries()]
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
      .map(([key, entry]) => [key, stableValue(entry)]);
  }
  if (value instanceof Set) {
    return {
      __set__: [...value]
        .map(stableValue)
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        ),
    };
  }
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function planIdFor(value) {
  const digest = createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
  return `sha256:${digest}`;
}

function sameOperationList(actual, expected) {
  return (
    JSON.stringify(stableValue(actual)) ===
    JSON.stringify(stableValue(expected))
  );
}

function publicationOperations(issue, issuePolicy, item) {
  const operations = [];
  if (!item) {
    operations.push({
      type: "add-project-item",
      issueNumber: issue.number,
      contentNodeId: issue.nodeId,
      reason: `#${issue.number} is approved but missing from Project 4`,
    });
  }
  if (!item || item.area !== issuePolicy.area) {
    operations.push({
      type: "set-project-field",
      issueNumber: issue.number,
      field: "Area",
      value: issuePolicy.area,
      reason: `#${issue.number} must use its approved Area`,
    });
  }
  if (!item || item.status === null) {
    operations.push({
      type: "set-project-field",
      issueNumber: issue.number,
      field: "Status",
      value: "Backlog",
      reason: "A newly published issue starts in Backlog",
    });
  }
  return operations;
}

function issuePolicyDiscrepancies(issue, issuePolicy) {
  const discrepancies = [];
  if (issue.title !== issuePolicy.title) {
    discrepancies.push({
      code: "issue.title",
      message: `#${issue.number} title does not match the approved tracker policy`,
    });
  }
  if (
    issuePolicy.acceptanceCriteria &&
    !sameValues(
      protectedAcceptanceCriteria(issue.body),
      issuePolicy.acceptanceCriteria,
    )
  ) {
    discrepancies.push({
      code: "issue.criteria",
      message: `#${issue.number} acceptance criteria do not match the approved tracker policy`,
    });
  }
  if (canonicalBlockedBySectionCount(issue.body) !== 1) {
    discrepancies.push({
      code: "issue.blocker_section",
      message: `#${issue.number} is missing the canonical Blocked by section`,
    });
  }
  return discrepancies;
}

function blockerSection(blockers) {
  return `## Blocked by\n\n${
    blockers.length > 0
      ? blockers.map((number) => `- #${number}`).join("\n")
      : "- None."
  }\n`;
}

function bodyWithBlockers(body, blockers) {
  return replaceCanonicalBlockedBySection(body, blockerSection(blockers));
}

function issueMetadataOperations(issue, issuePolicy, observed) {
  const operations = [];
  const desiredLabels = protectedIssueDesiredLabels(issue.labels, issuePolicy);
  if (!sameValues(issue.labels, desiredLabels)) {
    operations.push({
      type: "set-issue-labels",
      issueNumber: issue.number,
      labels: desiredLabels,
      reason: `#${issue.number} labels must match the approved tracker policy`,
    });
  }
  if (!sameValues(blockerNumbers(issue.body), issuePolicy.blockers)) {
    operations.push({
      type: "set-blocker-text",
      issueNumber: issue.number,
      blockers: [...issuePolicy.blockers],
      blockedBySection: blockerSection(issuePolicy.blockers),
      body: bodyWithBlockers(issue.body, issuePolicy.blockers),
      reason: `#${issue.number} blocker text must match its native dependencies`,
    });
  }
  const actualBlockers = new Map(
    issue.blockers.map((blocker) => [blocker.number, blocker]),
  );
  for (const blockerNumber of issuePolicy.blockers) {
    if (actualBlockers.has(blockerNumber)) continue;
    const blocker = observed.issues.find(
      ({ number }) => number === blockerNumber,
    );
    if (!blocker) continue;
    operations.push({
      type: "add-native-blocker",
      issueNumber: issue.number,
      blockerNumber,
      blockerDatabaseId: blocker.id,
      reason: `#${blockerNumber} is an approved blocker for #${issue.number}`,
    });
  }
  for (const blocker of issue.blockers) {
    if (issuePolicy.blockers.includes(blocker.number)) continue;
    operations.push({
      type: "remove-native-blocker",
      issueNumber: issue.number,
      blockerNumber: blocker.number,
      blockerDatabaseId: blocker.id,
      reason: `#${blocker.number} is not an approved blocker for #${issue.number}`,
    });
  }
  return operations;
}

function publicationIsComplete(issue, issuePolicy, item, knownStatuses) {
  return (
    item !== undefined &&
    protectedIssuePublicationIsComplete({
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
      nativeBlockers: issue.blockers,
      area: item.area,
      status: item.status,
      knownStatuses,
      policy: issuePolicy,
    })
  );
}

function ordinaryPublicationIsComplete(issue, item) {
  const shape = ordinaryIssueShape(issue.body, issue.labels);
  return (
    item !== undefined &&
    item.area !== null &&
    item.status !== null &&
    shape.valid &&
    sameValues(
      blockerNumbers(issue.body),
      issue.blockers.map(({ number }) => number),
    )
  );
}

function ordinaryPublicationOperations(issue, area, item, observed) {
  const desiredBlockers = blockerNumbers(issue.body);
  const actualBlockers = new Map(
    issue.blockers.map((blocker) => [blocker.number, blocker]),
  );
  const operations = [];
  for (const blockerNumber of desiredBlockers) {
    if (actualBlockers.has(blockerNumber)) continue;
    const blocker = observed.issues.find(
      ({ number }) => number === blockerNumber,
    );
    if (!blocker) continue;
    operations.push({
      type: "add-native-blocker",
      issueNumber: issue.number,
      blockerNumber,
      blockerDatabaseId: blocker.id,
      reason: `#${blockerNumber} is declared as a blocker for #${issue.number}`,
    });
  }
  for (const blocker of issue.blockers) {
    if (desiredBlockers.includes(blocker.number)) continue;
    operations.push({
      type: "remove-native-blocker",
      issueNumber: issue.number,
      blockerNumber: blocker.number,
      blockerDatabaseId: blocker.id,
      reason: `#${blocker.number} is not declared as a blocker for #${issue.number}`,
    });
  }
  if (!item) {
    operations.push({
      type: "add-project-item",
      issueNumber: issue.number,
      contentNodeId: issue.nodeId,
      reason: `#${issue.number} is approved for publication but missing from Project 4`,
    });
  }
  if (!item || item.area !== area) {
    operations.push({
      type: "set-project-field",
      issueNumber: issue.number,
      field: "Area",
      value: area,
      reason: `#${issue.number} must use the explicitly approved Area`,
    });
  }
  if (!item || item.status === null) {
    operations.push({
      type: "set-project-field",
      issueNumber: issue.number,
      field: "Status",
      value: "Backlog",
      reason: "A newly published issue starts in Backlog",
    });
  }
  return operations;
}

function deliveryIssueNumbers(pullRequest) {
  return [
    ...new Set([
      ...pullRequest.closingIssues,
      ...(pullRequest.linkedIssues ?? []),
    ]),
  ];
}

function obsoleteProjectItemDiscrepancy(issueNumber) {
  return {
    code: "project.item.obsolete",
    message: `Historical issue #${issueNumber} must not remain on Project 4`,
  };
}

export function planRentCottageReconciliation({ intent, observed, policy }) {
  const issuePolicy = policy.issues.get(intent.issueNumber);
  const issue = observed.issues.find(
    ({ number }) => number === intent.issueNumber,
  );
  const matchingItems = observed.project.items.filter(
    ({ issueNumber }) => issueNumber === intent.issueNumber,
  );
  const item = matchingItems[0];
  const operations = [];
  const discrepancies = [];

  if (!observed.complete) {
    for (const message of observed.evidenceErrors ?? [
      "Authoritative GitHub evidence was incomplete",
    ]) {
      discrepancies.push({ code: "evidence.incomplete", message });
    }
    return {
      outcome: "blocked",
      operations: [],
      discrepancies,
      dependencyFrontier: [],
      planId: planIdFor({
        intent,
        observed,
        policy,
        operations,
        discrepancies,
      }),
    };
  }
  if (
    intent.type === "publish" &&
    issuePolicy &&
    intent.area &&
    intent.area !== issuePolicy.area
  ) {
    discrepancies.push({
      code: "publication.area.protected",
      message: `Protected #${intent.issueNumber} requires Area ${issuePolicy.area}`,
    });
  }
  if (
    intent.type !== "audit" &&
    policy.excludedProjectIssueNumbers?.has(intent.issueNumber)
  ) {
    discrepancies.push(obsoleteProjectItemDiscrepancy(intent.issueNumber));
  }

  if (intent.type === "audit") {
    const activeStatuses = new Set(["Ready", "In progress", "In review"]);
    const itemCounts = new Map();
    for (const projectItem of observed.project.items) {
      itemCounts.set(
        projectItem.issueNumber,
        (itemCounts.get(projectItem.issueNumber) ?? 0) + 1,
      );
    }
    for (const [number, count] of itemCounts) {
      if (count > 1) {
        discrepancies.push({
          code: "project.item.duplicate",
          message: `Project 4 contains duplicate item #${number}`,
        });
      }
    }
    const deliveryLinks = new Map();
    const ambiguousDeliveryIssues = new Set();
    for (const pullRequest of observed.pullRequests) {
      if (!["OPEN", "MERGED"].includes(pullRequest.state)) continue;
      const deliveryIssues = deliveryIssueNumbers(pullRequest);
      for (const number of deliveryIssues) {
        const linkedPullRequests = deliveryLinks.get(number) ?? [];
        linkedPullRequests.push(pullRequest.number);
        deliveryLinks.set(number, linkedPullRequests);
        if (deliveryIssues.length !== 1) ambiguousDeliveryIssues.add(number);
      }
    }
    for (const [number, pullRequestNumbers] of deliveryLinks) {
      if (pullRequestNumbers.length > 1) ambiguousDeliveryIssues.add(number);
    }
    for (const number of [...ambiguousDeliveryIssues].sort(
      (left, right) => left - right,
    )) {
      discrepancies.push({
        code: "delivery.link_ambiguous",
        message: `Issue #${number} has ambiguous or conflicting delivery links`,
      });
    }
    for (const pullRequest of observed.pullRequests) {
      if (pullRequest.state !== "MERGED") continue;
      for (const number of deliveryIssueNumbers(pullRequest)) {
        const closingIssue = observed.issues.find(
          (issue) => issue.number === number,
        );
        if (closingIssue?.state === "OPEN") {
          discrepancies.push({
            code: "delivery.merged_issue_open",
            message: pullRequest.closingIssues.includes(number)
              ? `Merged pull request #${pullRequest.number} closes still-open issue #${number}`
              : `Merged pull request #${pullRequest.number} is linked to still-open issue #${number}`,
          });
        }
      }
    }
    for (const projectItem of observed.project.items) {
      if (policy.excludedProjectIssueNumbers?.has(projectItem.issueNumber)) {
        discrepancies.push(
          obsoleteProjectItemDiscrepancy(projectItem.issueNumber),
        );
      }
      const projectIssue = observed.issues.find(
        ({ number }) => number === projectItem.issueNumber,
      );
      const projectIssuePolicy = policy.issues.get(projectItem.issueNumber);
      const ordinaryShape =
        projectIssue && !projectIssuePolicy
          ? ordinaryIssueShape(projectIssue.body, projectIssue.labels)
          : null;
      if (!projectIssue && !projectIssuePolicy) {
        discrepancies.push({
          code: "project.issue.missing",
          message: `Project item #${projectItem.issueNumber} has no repository issue evidence`,
        });
      }
      if (
        projectIssue &&
        !projectIssuePolicy &&
        ordinaryShape.blockerSectionCount !== 1
      ) {
        discrepancies.push({
          code: "issue.blocker_section",
          message: `#${projectItem.issueNumber} requires exactly one canonical Blocked by section`,
        });
      }
      if (
        projectIssue &&
        !projectIssuePolicy &&
        ordinaryShape.triageLabelCount !== 1
      ) {
        discrepancies.push({
          code: "issue.triage_label",
          message: `#${projectItem.issueNumber} requires exactly one canonical triage label`,
        });
      }
      if (
        projectIssue &&
        !projectIssuePolicy &&
        !sameValues(
          blockerNumbers(projectIssue.body),
          projectIssue.blockers.map(({ number }) => number),
        )
      ) {
        discrepancies.push({
          code: "issue.blockers.mismatch",
          message: `#${projectItem.issueNumber} textual blockers do not match its native dependencies`,
        });
      }
      if (!projectIssuePolicy && projectItem.area === null) {
        discrepancies.push({
          code: "project.area.missing",
          message: `Project item #${projectItem.issueNumber} has no Area`,
        });
      }
      if (!projectIssuePolicy && projectItem.status === null) {
        discrepancies.push({
          code: "project.status.missing",
          message: `Project item #${projectItem.issueNumber} has no Status`,
        });
      }
      if (
        projectIssue?.state === "CLOSED" &&
        activeStatuses.has(projectItem.status)
      ) {
        discrepancies.push({
          code: "project.status.closed",
          message: `Closed #${projectItem.issueNumber} cannot remain ${projectItem.status}`,
        });
      }
      if (projectIssue?.state === "OPEN" && projectItem.status === "Done") {
        discrepancies.push({
          code: "project.status.done",
          message: `Open #${projectItem.issueNumber} cannot be Done`,
        });
      }
      const openProjectBlockers = projectIssue?.blockers.filter(
        ({ state }) => normalizedDependencyState(state) === "OPEN",
      );
      for (const blocker of projectIssue?.blockers ?? []) {
        if (normalizedDependencyState(blocker.state) === null) {
          discrepancies.push({
            code: "issue.blocker_state",
            message: `#${projectItem.issueNumber} native dependency #${blocker.number} has unknown state ${String(blocker.state)}`,
          });
        }
      }
      if (
        openProjectBlockers?.length > 0 &&
        activeStatuses.has(projectItem.status)
      ) {
        discrepancies.push({
          code: "project.status.blocked",
          message: `#${projectItem.issueNumber} cannot be ${projectItem.status} while blockers are open`,
        });
      }
      if (
        projectIssue?.state === "OPEN" &&
        (projectIssuePolicy
          ? protectedIssueIsOwnerGated(projectIssue.labels, projectIssuePolicy)
          : projectIssue.labels.includes("owner-gated")) &&
        projectIssue.assignees.length === 0 &&
        activeStatuses.has(projectItem.status)
      ) {
        discrepancies.push({
          code: "project.status.owner_gated",
          message: `Owner-gated #${projectItem.issueNumber} cannot be ${projectItem.status} without an approved claim`,
        });
      }
    }
    for (const [number, approvedIssue] of policy.issues) {
      const liveIssue = observed.issues.find(
        (issue) => issue.number === number,
      );
      if (!liveIssue) {
        discrepancies.push({
          code: "issue.missing",
          message: `Approved issue #${number} is unavailable`,
        });
        continue;
      }
      discrepancies.push(...issuePolicyDiscrepancies(liveIssue, approvedIssue));
      const projectItem = observed.project.items.find(
        ({ issueNumber }) => issueNumber === number,
      );
      operations.push(
        ...issueMetadataOperations(liveIssue, approvedIssue, observed),
        ...publicationOperations(liveIssue, approvedIssue, projectItem),
      );
    }
  }

  if (
    !issue &&
    (intent.type === "publish" ||
      issuePolicy ||
      ["claim", "review", "closeout"].includes(intent.type))
  ) {
    discrepancies.push({
      code: "issue.missing",
      message: issuePolicy
        ? `Approved issue #${intent.issueNumber} is unavailable`
        : `Selected issue #${intent.issueNumber} is unavailable`,
    });
  }
  if (issuePolicy && issue)
    discrepancies.push(...issuePolicyDiscrepancies(issue, issuePolicy));

  if (intent.type !== "audit" && matchingItems.length > 1) {
    discrepancies.push({
      code: "project.item.duplicate",
      message: `Project 4 contains duplicate item #${intent.issueNumber}`,
    });
  }

  if (
    ["claim", "review", "closeout"].includes(intent.type) &&
    issue &&
    !(issuePolicy
      ? publicationIsComplete(
          issue,
          issuePolicy,
          item,
          observed.project.fields.Status?.options ?? new Map(),
        )
      : ordinaryPublicationIsComplete(issue, item))
  ) {
    discrepancies.push({
      code: "lifecycle.publication_incomplete",
      message: `#${issue.number} must match its approved publication state before a lifecycle transition`,
    });
  }

  if (intent.type === "publish" && issuePolicy && issue) {
    for (const blockerNumber of issuePolicy.blockers) {
      if (observed.issues.some(({ number }) => number === blockerNumber))
        continue;
      discrepancies.push({
        code: "publication.blocker_unavailable",
        message: `Approved blocker #${blockerNumber} for #${issue.number} is unavailable`,
      });
    }
    operations.push(...issueMetadataOperations(issue, issuePolicy, observed));
    operations.push(...publicationOperations(issue, issuePolicy, item));
  }

  if (intent.type === "publish" && !issuePolicy && issue) {
    if (!intent.area) {
      discrepancies.push({
        code: "publication.area.required",
        message: `Ordinary issue #${issue.number} requires an explicit Area`,
      });
    } else if (!observed.project.fields.Area?.options.has(intent.area)) {
      discrepancies.push({
        code: "publication.area.unknown",
        message: `Area ${intent.area} is not an existing Project 4 option`,
      });
    }
    const shape = ordinaryIssueShape(issue.body, issue.labels);
    if (shape.triageLabelCount !== 1) {
      discrepancies.push({
        code: "publication.triage_label",
        message: `Ordinary issue #${issue.number} requires exactly one canonical triage label`,
      });
    }
    if (shape.blockerSectionCount !== 1) {
      discrepancies.push({
        code: "publication.blocker_section",
        message: `Ordinary issue #${issue.number} requires exactly one canonical Blocked by section`,
      });
    }
    for (const blockerNumber of blockerNumbers(issue.body)) {
      if (observed.issues.some(({ number }) => number === blockerNumber))
        continue;
      discrepancies.push({
        code: "publication.blocker_unavailable",
        message: `Declared blocker #${blockerNumber} for #${issue.number} is unavailable`,
      });
    }
    if (intent.area) {
      operations.push(
        ...ordinaryPublicationOperations(issue, intent.area, item, observed),
      );
    }
  }

  const openBlockers = issue?.blockers.filter(
    ({ state }) => normalizedDependencyState(state) === "OPEN",
  );
  if (intent.type === "claim" && openBlockers?.length > 0) {
    discrepancies.push({
      code: "claim.blocked",
      message: `#${issue.number} cannot be claimed while open blockers=${openBlockers.map(({ number }) => `#${number}`).join(",")}`,
    });
  }
  if (intent.type === "claim" && issue && issue.state !== "OPEN") {
    discrepancies.push({
      code: "claim.issue_ineligible",
      message: `#${intent.issueNumber} must be open before it can be claimed`,
    });
  }
  if (
    intent.type === "claim" &&
    item &&
    !["Backlog", "Ready", "In progress"].includes(item.status)
  ) {
    discrepancies.push({
      code: "claim.status_invalid",
      message: `#${intent.issueNumber} cannot be claimed from ${item.status}`,
    });
  }

  if (intent.type === "claim" && issue && item && discrepancies.length === 0) {
    if (!issue.assignees.includes(intent.assignee)) {
      operations.push({
        type: "add-assignee",
        issueNumber: issue.number,
        assignee: intent.assignee,
        reason: `The explicit claim records active ownership for #${issue.number}`,
      });
    }
    if (item.status !== "In progress") {
      operations.push({
        type: "set-project-field",
        issueNumber: issue.number,
        field: "Status",
        value: "In progress",
        reason: "Explicitly selected work belongs in In progress",
      });
    }
  }

  if (intent.type === "review" && issue && item) {
    const pullRequest = observed.pullRequests.find(
      ({ number }) => number === intent.pullRequestNumber,
    );
    const activeClosingPullRequests = observed.pullRequests.filter(
      (candidate) =>
        candidate.repository === policy.repository &&
        candidate.state === "OPEN" &&
        deliveryIssueNumbers(candidate).includes(issue.number),
    );
    const issueEligible =
      issue.state === "OPEN" && (openBlockers?.length ?? 0) === 0;
    if (!issueEligible) {
      discrepancies.push({
        code: "review.issue_ineligible",
        message: `#${issue.number} must be open and unblocked before review`,
      });
    }
    const validClosingReference =
      activeClosingPullRequests.length === 1 &&
      pullRequest?.repository === policy.repository &&
      pullRequest.state === "OPEN" &&
      !pullRequest.draft &&
      deliveryIssueNumbers(pullRequest).length === 1 &&
      deliveryIssueNumbers(pullRequest)[0] === issue.number;
    if (!validClosingReference) {
      discrepancies.push({
        code: "review.pull_request_invalid",
        message: `Pull request #${intent.pullRequestNumber} is not an active unambiguous delivery link for #${issue.number}`,
      });
    } else if (issueEligible && item.status !== "In review") {
      operations.push({
        type: "set-project-field",
        issueNumber: issue.number,
        field: "Status",
        value: "In review",
        reason: pullRequest.closingIssues.includes(issue.number)
          ? `Active delivery pull request #${pullRequest.number} closes #${issue.number}`
          : `Active delivery pull request #${pullRequest.number} is Project-linked to #${issue.number}`,
      });
    }
  }

  if (intent.type === "closeout" && issue && item) {
    const pullRequest = observed.pullRequests.find(
      ({ number }) => number === intent.pullRequestNumber,
    );
    const deliveryPullRequests = observed.pullRequests.filter(
      (candidate) =>
        candidate.repository === policy.repository &&
        ["OPEN", "MERGED"].includes(candidate.state) &&
        deliveryIssueNumbers(candidate).includes(issue.number),
    );
    const validClosingReference =
      deliveryPullRequests.length === 1 &&
      pullRequest?.repository === policy.repository &&
      pullRequest.state === "MERGED" &&
      Boolean(pullRequest.mergedAt) &&
      pullRequest.closingIssues.length === 1 &&
      pullRequest.closingIssues[0] === issue.number;
    if (!validClosingReference || issue.state !== "CLOSED") {
      discrepancies.push({
        code: "closeout.delivery_invalid",
        message: `Pull request #${intent.pullRequestNumber} and issue #${issue.number} do not prove completed delivery`,
      });
    } else if (item.status !== "Done") {
      operations.push({
        type: "set-project-field",
        issueNumber: issue.number,
        field: "Status",
        value: "Done",
        reason: `Merged delivery pull request #${pullRequest.number} closed #${issue.number}`,
      });
    }
  }

  const outcome =
    discrepancies.length > 0
      ? "blocked"
      : operations.length > 0
        ? "plan"
        : "noop";
  const dependencyFrontier = [
    ...new Set([
      ...policy.issues.keys(),
      ...observed.project.items.map(({ issueNumber }) => issueNumber),
    ]),
  ]
    .filter((number) => !policy.excludedProjectIssueNumbers?.has(number))
    .filter((number) => {
      const candidate = observed.issues.find(
        (issue) => issue.number === number,
      );
      const candidatePolicy = policy.issues.get(number);
      const candidateItem = observed.project.items.find(
        (item) => item.issueNumber === number,
      );
      const ordinaryEligible =
        candidate && !candidatePolicy && candidateItem
          ? ordinaryIssueFrontierEligible({
              body: candidate.body,
              labels: candidate.labels,
              area: candidateItem.area,
              status: candidateItem.status,
              knownAreas: observed.project.fields.Area?.options ?? new Map(),
              knownStatuses:
                observed.project.fields.Status?.options ?? new Map(),
              nativeBlockers: candidate.blockers,
            })
          : false;
      const protectedEligible =
        candidate && candidatePolicy
          ? publicationIsComplete(
              candidate,
              candidatePolicy,
              candidateItem,
              observed.project.fields.Status?.options ?? new Map(),
            )
          : false;
      return (
        candidate?.state === "OPEN" &&
        (protectedEligible || ordinaryEligible) &&
        !(candidatePolicy
          ? protectedIssueIsOwnerGated(candidate.labels, candidatePolicy)
          : candidate.labels.includes("owner-gated")) &&
        candidate.assignees.length === 0 &&
        candidate.blockers.every(dependencyIsClosed)
      );
    })
    .sort((left, right) => left - right);
  return {
    outcome,
    operations: discrepancies.length > 0 ? [] : operations,
    discrepancies,
    dependencyFrontier,
    planId: planIdFor({
      intent,
      observed,
      policy,
      operations,
      discrepancies,
    }),
  };
}

export async function runRentCottageReconciliation(
  { intent, apply = false, planId },
  { github, policy, verify },
) {
  if (apply && intent.type === "audit") {
    return {
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "apply.intent_not_specific",
          message: "Global audit is detection-only and cannot apply mutations",
        },
      ],
      dependencyFrontier: [],
      planId: null,
    };
  }
  const observed = await github.observe(intent);
  const plan = planRentCottageReconciliation({ intent, observed, policy });
  if (!apply) return plan;
  if (plan.outcome === "blocked") return plan;
  if (planId !== plan.planId) {
    return {
      ...plan,
      outcome: "blocked",
      operations: [],
      discrepancies: [
        {
          code: "apply.plan_mismatch",
          message: "Apply requires the exact current dry-run plan fingerprint",
        },
      ],
    };
  }
  let currentPlan = plan;
  let appliedOperations = 0;
  while (currentPlan.operations.length > 0) {
    if (appliedOperations >= 50) {
      return {
        ...currentPlan,
        outcome: "failed",
        discrepancies: [
          {
            code: "apply.operation_limit",
            message: "Reconciliation exceeded the 50-operation safety limit",
          },
        ],
      };
    }
    const operation = currentPlan.operations[0];
    const approvedRemainingOperations = currentPlan.operations.slice(1);
    let writeError = null;
    try {
      await github.execute(operation);
    } catch (error) {
      writeError = error;
    }
    const refreshed = await github.observe(intent);
    const nextPlan = planRentCottageReconciliation({
      intent,
      observed: refreshed,
      policy,
    });
    if (!sameOperationList(nextPlan.operations, approvedRemainingOperations)) {
      return {
        ...nextPlan,
        outcome: "failed",
        operations: [],
        discrepancies: [
          ...nextPlan.discrepancies,
          {
            code: "apply.plan_drift",
            message:
              "Authoritative re-read changed the approved remaining operation list; run a new dry-run",
          },
        ],
      };
    }
    if (nextPlan.outcome === "blocked") {
      return {
        ...nextPlan,
        outcome: "failed",
        operations: [],
        discrepancies: [
          ...nextPlan.discrepancies,
          {
            code: "apply.write_unconfirmed",
            message: writeError
              ? `Write could not be confirmed after re-read: ${writeError.message}`
              : "Write did not produce the planned authoritative state",
          },
        ],
      };
    }
    appliedOperations += 1;
    currentPlan = nextPlan;
  }
  const verification = await verify();
  if (!verification?.ok) {
    return {
      ...currentPlan,
      outcome: "failed",
      discrepancies: [
        {
          code: "apply.verification_failed",
          message: verification?.message ?? "Final board verification failed",
        },
      ],
    };
  }
  return {
    ...currentPlan,
    outcome: appliedOperations > 0 ? "applied" : "noop",
    appliedOperations,
  };
}
