import { expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

import { runScheduledBookingNotifications } from "./notification-schedule";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const environment = {
  APP_ENVIRONMENT: "test",
  SUPABASE_PROJECT_REF: "local-test",
  SUPABASE_URL: "http://127.0.0.1:54331",
  SUPABASE_PUBLISHABLE_KEY: "local-publishable",
  SUPABASE_SECRET_KEY: "local-secret",
};

it.each([
  { APP_ENVIRONMENT: "production" },
  { APP_ENVIRONMENT: "preview" },
  { SUPABASE_PROJECT_REF: "hosted" },
  { SUPABASE_URL: "https://example.supabase.co" },
  { SUPABASE_URL: "http://remote.example" },
  { SUPABASE_SECRET_KEY: "" },
  { SUPABASE_PUBLISHABLE_KEY: "" },
])(
  "rejects unadmitted notification runtimes or missing credentials %#",
  async (override) => {
    const drain = vi.fn();
    await expect(
      runScheduledBookingNotifications({ ...environment, ...override }, drain),
    ).rejects.toThrow("Booking notifications require");
    expect(drain).not.toHaveBeenCalled();
  },
);

it("awaits one bounded notification drain", async () => {
  const drain = vi.fn().mockResolvedValue([{ status: "delivered" }]);
  await expect(
    runScheduledBookingNotifications(environment, drain),
  ).resolves.toEqual([{ status: "delivered" }]);
  expect(drain).toHaveBeenCalledExactlyOnceWith(50);
});

it("hosted notification schedule preserves admission and scoped composition", async () => {
  const hosted = {
    APP_ENVIRONMENT: "preview",
    HOSTED_DEMO: "true",
    SUPABASE_PROJECT_REF: "yvibcyqtyihpzpmomnzg",
    SUPABASE_URL: "https://yvibcyqtyihpzpmomnzg.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "fixture-publishable",
    SUPABASE_SECRET_KEY: "fixture-secret",
    PRIVILEGED_AUDIT_HMAC_KEY: "fixture-audit-key-with-at-least-32-characters",
    DEPLOYMENT_COMMIT: "cccccccccccccccccccccccccccccccccccccccc",
  };
  const candidate = {
    receiptId: "00000000-0000-4000-8000-000000000035",
    recipientUserId: "00000000-0000-4000-8000-000000000036",
    recipientRole: "customer",
    bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
    bookingReference: "CONFIRMED-BOOKING-35",
    locale: "en",
  };
  const lease = {
    ...candidate,
    logicalId: "paid-confirmation:00000000-0000-4000-8000-000000000035",
    templateVersion: "paid-confirmation-v1",
    payload: {
      kind: "paid-confirmation",
      title: "Booking confirmed",
      body: "Your booking CONFIRMED-BOOKING-35 is confirmed and paid.",
      bookingReference: "CONFIRMED-BOOKING-35",
      detailsPath: "/en/booking-requests/RC-REQ-AAAAAAAAAAAAAAAA",
      linkLabel: "View confirmed booking",
      fictional: true,
    },
    payloadSha256: "a".repeat(64),
    leaseGeneration: 1,
    leaseToken: "00000000-0000-4000-8000-000000000037",
    leaseExpiresAt: "2099-01-01T00:05:00Z",
  };
  const effect = {
    effectId: "00000000-0000-4000-8000-000000000038",
    supplierDeliveryReference: "fictional-notification-38",
    executedAt: "2099-01-01T00:00:00Z",
  };
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: [candidate], error: null })
    .mockResolvedValueOnce({ error: null })
    .mockResolvedValueOnce({ data: lease, error: null })
    .mockResolvedValueOnce({ data: { status: "not-found" }, error: null })
    .mockResolvedValueOnce({
      data: { status: "delivered", ...effect },
      error: null,
    })
    .mockResolvedValueOnce({
      data: { status: "delivered", historical: false },
      error: null,
    });
  vi.mocked(createClient).mockReturnValue({ rpc } as never);
  await expect(runScheduledBookingNotifications(hosted)).resolves.toEqual([
    { status: "delivered", historical: false },
  ]);
  expect(createClient).toHaveBeenCalledExactlyOnceWith(
    "https://yvibcyqtyihpzpmomnzg.supabase.co",
    "fixture-secret",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  expect(rpc.mock.calls.map(([name]) => name)).toEqual([
    "list_due_booking_confirmation_notifications",
    "ensure_booking_confirmation_notification_work",
    "lease_booking_confirmation_notification_work",
    "query_fictional_booking_confirmation_notification_effect",
    "execute_fictional_booking_confirmation_notification_effect",
    "complete_booking_confirmation_notification_delivery",
  ]);
  expect(rpc).toHaveBeenNthCalledWith(
    1,
    "list_due_booking_confirmation_notifications",
    { target_limit: 50 },
  );
  const expectedBinding = {
    ...candidate,
    logicalId: "paid-confirmation:00000000-0000-4000-8000-000000000035",
    templateVersion: "paid-confirmation-v1",
    payload: lease.payload,
    payloadSha256: "a".repeat(64),
    fictionalEnvironment: "hosted-demo-yvibcyqtyihpzpmomnzg",
  };
  for (const call of rpc.mock.calls.slice(3)) {
    expect(call[1].target_binding).toEqual(expectedBinding);
  }
  vi.clearAllMocks();
  const drain = vi.fn().mockResolvedValue([{ status: "unavailable" }]);
  await expect(
    runScheduledBookingNotifications(hosted, drain),
  ).resolves.toEqual([{ status: "unavailable" }]);
  expect(drain).toHaveBeenCalledExactlyOnceWith(50);
  vi.clearAllMocks();
  for (const override of [
    { HOSTED_DEMO: undefined },
    { HOSTED_DEMO: "false" },
    { HOSTED_DEMO: null },
    { HOSTED_DEMO: true },
    { APP_ENVIRONMENT: "production" },
    { SUPABASE_PROJECT_REF: "foreign" },
    { SUPABASE_URL: "https://foreign.supabase.co" },
    { SUPABASE_SECRET_KEY: "" },
    { SUPABASE_PUBLISHABLE_KEY: "" },
    { PRIVILEGED_AUDIT_HMAC_KEY: "" },
    { DEPLOYMENT_COMMIT: "" },
  ]) {
    await expect(
      runScheduledBookingNotifications({ ...hosted, ...override } as never),
    ).rejects.toThrow("Booking notifications require");
    await expect(
      runScheduledBookingNotifications(
        { ...hosted, ...override } as never,
        drain,
      ),
    ).rejects.toThrow("Booking notifications require");
  }
  expect(drain).not.toHaveBeenCalled();
  expect(createClient).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
