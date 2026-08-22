import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, listNotifications } = vi.hoisted(() => ({
  createClient: vi.fn(),
  listNotifications: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: createClient,
}));
vi.mock("./owner-booking-request-notifications", () => ({
  listOwnerBookingRequestNotifications: listNotifications,
}));

import { loadOwnerBookingRequestNotifications } from "./request-owner-booking-request-notifications";

describe("owner Booking Request notification boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("does no identity or notification RPC work outside the isolated test runtime", async () => {
    vi.stubEnv("APP_ENVIRONMENT", "development");
    vi.stubEnv("SUPABASE_PROJECT_REF", "local-test");
    vi.stubEnv("SUPABASE_URL", "http://localhost:54331");

    await expect(
      loadOwnerBookingRequestNotifications(),
    ).resolves.toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();
    expect(listNotifications).not.toHaveBeenCalled();
  });
});
