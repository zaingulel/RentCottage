export const ownerApplicationStatuses = [
  "draft",
  "submitted",
  "needs_information",
  "under_review",
  "approved",
  "rejected",
  "expired",
  "suspended",
] as const;

export type OwnerApplicationStatus = (typeof ownerApplicationStatuses)[number];

export function isOwnerApplicationStatus(
  value: unknown,
): value is OwnerApplicationStatus {
  return ownerApplicationStatuses.includes(value as OwnerApplicationStatus);
}

export function parseOwnerApplicationStatus(
  value: unknown,
): OwnerApplicationStatus {
  if (!isOwnerApplicationStatus(value)) {
    throw new Error("Owner Application status is invalid");
  }
  return value;
}
