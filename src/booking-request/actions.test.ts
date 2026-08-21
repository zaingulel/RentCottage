import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, resolveContext, createSubmission, submit } = vi.hoisted(
  () => ({
    createClient: vi.fn(),
    resolveContext: vi.fn(),
    createSubmission: vi.fn(),
    submit: vi.fn(),
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: createClient,
}));
vi.mock("@/access/supabase-account-access", () => ({
  SupabaseAccountContextStore: class {
    resolve = resolveContext;
  },
}));
vi.mock("./request-booking-request-submission", () => ({
  createRequestBookingRequestSubmission: createSubmission,
}));

import { submitBookingRequest } from "./actions";
import { bookingRequestAcceptanceEvidence } from "./booking-request-policy";

const request = {
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  locale: "en",
  publicSlug: "cottage-00000000000040008000000000000029",
  discoveryQuery: {
    from: "2099-08-21",
    to: "2099-08-21",
    guests: 4,
    amenities: [],
    selections: [{ serviceDay: "2099-08-21", kind: "shift", position: 2 }],
  },
  displayedQuote: {
    fingerprint: "a".repeat(64),
    contentVersion: 2,
    termsVersion: "rentcottage-mvp-2026-08-04",
    bookingPriceIqd: 100_003,
    serviceFeeIqd: 5_000,
    customerTotalIqd: 105_003,
    firstStartsAt: "2099-08-21T20:00:00+03:00",
  },
  customerName: " Ava Hassan ",
  partySize: 4,
  bookingNote: " Garden seating, please. ",
  acceptedHouseRules: true,
  acceptedCancellationPolicy: true,
  acceptedMarketplaceTerms: true,
  acceptedInside48HourNoRefund: false,
  acceptanceEvidence: bookingRequestAcceptanceEvidence({
    locale: "en",
    termsVersion: "rentcottage-mvp-2026-08-04",
    requiresInside48HourNoRefundAcceptance: false,
  }),
};

describe("Booking Request action boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClient.mockResolvedValue({ request: true });
    resolveContext.mockResolvedValue({
      userId: "00000000-0000-4000-8000-000000000032",
      role: "customer",
    });
    submit.mockResolvedValue({
      status: "pending",
      bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
      responseDeadline: "2099-08-21T21:00:00.000Z",
    });
    createSubmission.mockResolvedValue({ submit });
  });

  it("binds the request to the authenticated Customer and normalized details", async () => {
    await expect(submitBookingRequest(request)).resolves.toEqual({
      status: "pending",
      bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
      responseDeadline: "2099-08-21T21:00:00.000Z",
    });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        customerUserId: "00000000-0000-4000-8000-000000000032",
        customerName: "Ava Hassan",
        bookingNote: "Garden seating, please.",
      }),
    );
  });

  it("normalizes a blank optional Booking Note to absence", async () => {
    await expect(
      submitBookingRequest({ ...request, bookingNote: "   " }),
    ).resolves.toEqual(expect.objectContaining({ status: "pending" }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ bookingNote: null }),
    );
  });

  it.each([
    { customerName: "Ava +964 750 123 4567" },
    { bookingNote: "Call ٠٧٥٠ ١٢٣ ٤٥٦٧" },
    { bookingNote: "Call ۰۷۵۰-۱۲۳-۴۵۶۷" },
    { bookingNote: "Email ava@example.com" },
    { bookingNote: "Visit https://example.com/ava" },
    { bookingNote: "Telegram @ava_hassan" },
  ])("rejects contact-bearing Customer content", async (unsafe) => {
    await expect(
      submitBookingRequest({ ...request, ...unsafe }),
    ).resolves.toEqual({ status: "invalid" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects malformed input and non-Customer access before provider work", async () => {
    await expect(
      submitBookingRequest({ ...request, partySize: 0 }),
    ).resolves.toEqual({ status: "invalid" });
    expect(createClient).not.toHaveBeenCalled();

    resolveContext.mockResolvedValue({
      userId: "00000000-0000-4000-8000-000000000033",
      role: "cottage_owner",
      approvalState: "approved",
    });
    await expect(submitBookingRequest(request)).resolves.toEqual({
      status: "access-required",
    });
    expect(createSubmission).not.toHaveBeenCalled();
  });

  it("fails closed when no approved payment provider is configured", async () => {
    createSubmission.mockResolvedValue(undefined);
    await expect(submitBookingRequest(request)).resolves.toEqual({
      status: "payment-unavailable",
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("records a structured safe diagnostic when the action boundary fails", async () => {
    const diagnostics = vi.spyOn(console, "error").mockImplementation(() => {});
    createClient.mockRejectedValue(new Error("secret database failure"));

    await expect(submitBookingRequest(request)).resolves.toEqual({
      status: "unavailable",
    });
    expect(diagnostics).toHaveBeenCalledWith("Booking Request action failed", {
      code: "booking_request_action_failed",
    });
    expect(JSON.stringify(diagnostics.mock.calls)).not.toContain("Ava Hassan");
    expect(JSON.stringify(diagnostics.mock.calls)).not.toContain(
      "secret database failure",
    );
  });
});
