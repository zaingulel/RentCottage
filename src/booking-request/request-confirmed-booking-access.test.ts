import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, getAccess, getStatus } = vi.hoisted(() => ({
  createClient: vi.fn(),
  getAccess: vi.fn(),
  getStatus: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: createClient,
}));
vi.mock("./confirmed-booking-access", () => ({
  getConfirmedBookingAccess: getAccess,
}));
vi.mock("@/notification/notification-status-repository", () => ({
  SupabasePaidConfirmationNotificationStatusRepository: class {
    get = getStatus;
  },
}));

import { loadConfirmedBookingAccess } from "./request-confirmed-booking-access";

describe("request-scoped confirmed booking access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("APP_ENVIRONMENT", "test");
    vi.stubEnv("SUPABASE_PROJECT_REF", "local-test");
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54331");
    createClient.mockResolvedValue({ authenticated: true });
    getAccess.mockResolvedValue({ receiptId: "receipt-35" });
  });

  it("keeps paid details available before notification work exists", async () => {
    getStatus.mockResolvedValue({ receiptId: "receipt-35", state: "pending" });

    await expect(
      loadConfirmedBookingAccess("RC-REQ-AAAAAAAAAAAAAAAA"),
    ).resolves.toMatchObject({ notification: { state: "pending" } });
  });

  it("keeps paid details available when delivery status cannot be read", async () => {
    getStatus.mockRejectedValue(new Error("status unavailable"));

    await expect(
      loadConfirmedBookingAccess("RC-REQ-AAAAAAAAAAAAAAAA"),
    ).resolves.toEqual({
      access: { receiptId: "receipt-35" },
      notification: {
        receiptId: "receipt-35",
        state: "unavailable",
        lastOutcome: null,
        supplierDeliveryReference: null,
        deliveredAt: null,
        suppressedAt: null,
        historical: false,
      },
    });
  });
});
