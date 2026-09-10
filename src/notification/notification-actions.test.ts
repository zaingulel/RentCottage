import { beforeEach, expect, it, vi } from "vitest";
const { enabled, createClient, retry, revalidate } = vi.hoisted(() => ({
  enabled: vi.fn(),
  createClient: vi.fn(),
  retry: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/booking-request/booking-request-test-runtime", () => ({
  bookingRequestTestRuntimeIsEnabled: enabled,
}));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: createClient,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
vi.mock("./notification-status-repository", () => ({
  SupabasePaidConfirmationNotificationStatusRepository: class {
    retry = retry;
  },
}));
import { retryPaidConfirmationNotification } from "./notification-actions";
const form = () => {
  const data = new FormData();
  data.set("locale", "ckb");
  data.set("reference", "RC-REQ-0000000000003501");
  data.set("receiptId", "82000000-0000-4000-8000-000000003502");
  return data;
};
beforeEach(() => {
  vi.clearAllMocks();
});
it("does not construct retry delivery outside the exact local runtime", async () => {
  enabled.mockReturnValue(false);
  await expect(
    retryPaidConfirmationNotification({ status: "idle" }, form()),
  ).resolves.toEqual({ status: "unavailable" });
  expect(createClient).not.toHaveBeenCalled();
});
it("revalidates both actor routes after the database authorizes one same-receipt retry", async () => {
  enabled.mockReturnValue(true);
  createClient.mockResolvedValue({});
  retry.mockResolvedValue({ status: "queued" });
  await expect(
    retryPaidConfirmationNotification({ status: "idle" }, form()),
  ).resolves.toEqual({ status: "queued" });
  expect(revalidate).toHaveBeenCalledWith(
    "/ckb/booking-requests/RC-REQ-0000000000003501",
  );
  expect(revalidate).toHaveBeenCalledWith(
    "/ckb/owner/booking-requests/RC-REQ-0000000000003501",
  );
});
it("returns a safe failure state without revalidating when retry is denied", async () => {
  enabled.mockReturnValue(true);
  createClient.mockResolvedValue({});
  retry.mockRejectedValue(new Error("stale or unauthorized"));
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

  await expect(
    retryPaidConfirmationNotification({ status: "idle" }, form()),
  ).resolves.toEqual({ status: "failed" });
  expect(revalidate).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith("Confirmation notice retry failed", {
    code: "confirmation_notice_retry_failed",
  });
  log.mockRestore();
});
