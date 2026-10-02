import { describe, it } from "vitest";

import { observeInterruptedAccessVerification } from "./verify-access-interruption-observer.mjs";

describe("access verification command", () => {
  it("reports an initial process-inspection timeout and retains uncertain resources without an unhandled rejection", async () => {
    await observeInterruptedAccessVerification(undefined, {
      inspectionFailure: "initial-timeout",
    });
  }, 15_000);

  it("finishes cancellation reporting when process reidentification is unavailable while retaining uncertain processes", async () => {
    await observeInterruptedAccessVerification("SIGTERM", {
      inspectionFailure: "reidentify",
    });
  }, 15_000);

  it("retains uncertain processes when process inspection and its group probe both fail", async () => {
    await observeInterruptedAccessVerification("SIGTERM", {
      inspectionFailure: "reidentify-permission",
    });
  }, 15_000);

  it("reports output overflow even when uncertain process identity prevents termination", async () => {
    await observeInterruptedAccessVerification(undefined, {
      inspectionFailure: "overflow",
    });
  }, 15_000);

  it("retains and reports possible startup resources and temporary state when interrupted before ownership is established", async () => {
    await observeInterruptedAccessVerification("SIGTERM", {
      interruptStartup: true,
    });
  }, 15_000);

  it("finishes cancellation reporting when process-group permission is denied", async () => {
    await observeInterruptedAccessVerification("SIGTERM", {
      groupPermissionFailure: true,
    });
  }, 15_000);

  it.each([0, 37])(
    "reports process-group permission denial after command completion with status %s",
    async (completedCommandStatus) => {
      await observeInterruptedAccessVerification(undefined, {
        completedCommandStatus,
      });
    },
    15_000,
  );
});
