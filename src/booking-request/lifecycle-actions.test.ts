import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createClient,
  resolveContext,
  createLifecycle,
  act,
  processDue,
  revalidatePath,
} = vi.hoisted(() => ({
  createClient: vi.fn(),
  resolveContext: vi.fn(),
  createLifecycle: vi.fn(),
  act: vi.fn(),
  processDue: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: createClient,
}));
vi.mock("@/access/supabase-account-access", () => ({
  SupabaseAccountContextStore: class {
    resolve = resolveContext;
  },
}));
vi.mock("./request-booking-request-lifecycle", () => ({
  createRequestBookingRequestLifecycle: createLifecycle,
}));

import { actOnBookingRequest } from "./lifecycle-actions";

const bookingRequestId = "00000000-0000-4000-8000-000000000033";

describe("Booking Request lifecycle action boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClient.mockResolvedValue({ request: true });
    createLifecycle.mockReturnValue({ act, processDue });
    processDue.mockResolvedValue([]);
    act.mockResolvedValue({
      status: "withdrawn",
      bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
    });
  });

  it("derives the Customer identity from the authenticated session and revalidates the status route", async () => {
    resolveContext.mockResolvedValue({
      role: "customer",
      userId: "00000000-0000-4000-8000-000000000034",
    });

    await expect(
      actOnBookingRequest({
        locale: "ar",
        bookingRequestId,
        action: "withdraw",
        actorUserId: "00000000-0000-4000-8000-000000000099",
      }),
    ).resolves.toEqual({
      status: "withdrawn",
      bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
    });
    expect(act).toHaveBeenCalledWith({
      actor: "customer",
      actorUserId: "00000000-0000-4000-8000-000000000034",
      bookingRequestId,
      action: "withdraw",
    });
    expect(processDue).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith(
      "/ar/booking-requests/RC-REQ-AAAAAAAAAAAAAAAA",
    );
  });

  it("rejects cross-role actions before privileged lifecycle work", async () => {
    resolveContext.mockResolvedValue({
      role: "customer",
      userId: "00000000-0000-4000-8000-000000000034",
    });
    await expect(
      actOnBookingRequest({
        locale: "en",
        bookingRequestId,
        action: "accept",
      }),
    ).resolves.toEqual({ status: "access-required" });
    expect(processDue).not.toHaveBeenCalled();
    expect(act).not.toHaveBeenCalled();
  });

  it("returns only a constrained failure when the boundary is unavailable", async () => {
    resolveContext.mockRejectedValue(new Error("private identity details"));
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      actOnBookingRequest({
        locale: "en",
        bookingRequestId,
        action: "withdraw",
      }),
    ).resolves.toEqual({ status: "unavailable" });
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(
      "private identity details",
    );
  });

  it("contains lifecycle factory failures inside the Server Action boundary", async () => {
    createLifecycle.mockImplementation(() => {
      throw new Error("private factory details");
    });
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      actOnBookingRequest({
        locale: "en",
        bookingRequestId,
        action: "withdraw",
      }),
    ).resolves.toEqual({ status: "unavailable" });
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(
      "private factory details",
    );
  });
});
