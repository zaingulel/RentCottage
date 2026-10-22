import { describe, it } from "vitest";

import { observeInterruptedAccessVerification } from "./verify-access-interruption-observer.mjs";

describe("access verification command", () => {
  it("finishes one actual cleanup when the first SIGINT arrives during stop", async () => {
    await observeInterruptedAccessVerification("SIGINT", {
      cleanupStage: "stop",
    });
  }, 15_000);

  it("forces a known same-group descendant to exit after its leader exits gracefully", async () => {
    await observeInterruptedAccessVerification("SIGTERM", {
      descendantBehavior: "ignore",
    });
  }, 20_000);

  it.skipIf(process.platform !== "linux")(
    "cleans only owned processes when unrelated process-list output exceeds the inspection bound",
    async () => {
      await observeInterruptedAccessVerification("SIGTERM", {
        unrelatedInspectionOutput: true,
      });
    },
    15_000,
  );

  it.each(["zombie", "absent"])(
    "finishes cancellation cleanup when a complete inspection proves an EPERM group is %s",
    async (exitedGroupState) => {
      await observeInterruptedAccessVerification("SIGTERM", {
        exitedGroupState,
      });
    },
    15_000,
  );
});
