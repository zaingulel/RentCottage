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
  SupabaseBookingNotificationStatusRepository: class {
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
    getAccess.mockResolvedValue({ receiptId: "receipt-35", mapPin: null });
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
      access: { receiptId: "receipt-35", mapPin: null },
      notification: {
        receiptId: "receipt-35",
        state: "unavailable",
        lastOutcome: null,
        supplierDeliveryReference: null,
        deliveredAt: null,
        suppressedAt: null,
        historical: false,
      },
      navigation: null,
    });
  });

  it("hands paid participants simulated navigation only when a map pin is released", async () => {
    getStatus.mockResolvedValue({ receiptId: "receipt-35", state: "pending" });
    getAccess.mockResolvedValueOnce({
      receiptId: "receipt-35",
      mapPin: { latitude: 33.315241, longitude: 44.366067 },
    });

    await expect(
      loadConfirmedBookingAccess("RC-REQ-AAAAAAAAAAAAAAAA"),
    ).resolves.toMatchObject({ navigation: { kind: "simulated" } });

    getAccess.mockResolvedValueOnce({ receiptId: "receipt-35", mapPin: null });

    await expect(
      loadConfirmedBookingAccess("RC-REQ-AAAAAAAAAAAAAAAA"),
    ).resolves.toMatchObject({ navigation: null });
  });
});
