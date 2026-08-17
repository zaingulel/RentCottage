import { describe, expect, it } from "vitest";

import {
  ownerApplicationStatuses,
  parseOwnerApplicationStatus,
} from "./owner-application-status";

describe("Owner Application lifecycle status vocabulary", () => {
  it("parses the complete shared eight-state vocabulary", () => {
    expect(ownerApplicationStatuses.map(parseOwnerApplicationStatus)).toEqual([
      "draft",
      "submitted",
      "needs_information",
      "under_review",
      "approved",
      "rejected",
      "expired",
      "suspended",
    ]);
  });

  it("rejects status values outside the shared vocabulary", () => {
    expect(() => parseOwnerApplicationStatus("pending")).toThrow(
      "Owner Application status is invalid",
    );
  });
});
