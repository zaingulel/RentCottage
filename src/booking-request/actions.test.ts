import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    termsVersion: "fictional-local-test-2026-08-22-v1",
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
    termsVersion: "fictional-local-test-2026-08-22-v1",
    requiresInside48HourNoRefundAcceptance: false,
  }),
};

describe("Booking Request action boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("APP_ENVIRONMENT", "test");
    vi.stubEnv("SUPABASE_PROJECT_REF", "local-test");
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54331");
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

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["production", "local-test", "http://127.0.0.1:54331"],
    ["test", "preview-project", "http://127.0.0.1:54331"],
    ["test", "local-test", "https://local-test.supabase.co"],
  ])(
    "refuses a forbidden runtime before inspecting input or doing identity, provider, or diagnostic work",
    async (appEnvironment, projectRef, supabaseUrl) => {
      vi.stubEnv("APP_ENVIRONMENT", appEnvironment);
      vi.stubEnv("SUPABASE_PROJECT_REF", projectRef);
      vi.stubEnv("SUPABASE_URL", supabaseUrl);
      const diagnostics = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const unreadableInput = new Proxy(
        {},
        {
          get() {
            throw new Error("input was inspected");
          },
        },
      );

      await expect(submitBookingRequest(unreadableInput)).resolves.toEqual({
        status: "payment-unavailable",
      });
      expect(createClient).not.toHaveBeenCalled();
      expect(resolveContext).not.toHaveBeenCalled();
      expect(createSubmission).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
      expect(diagnostics).not.toHaveBeenCalled();
    },
  );

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
    { bookingNote: "Email name @ example . com" },
    { bookingNote: "Email name @ example . uk" },
    { bookingNote: "Email name at example dot uk" },
    { bookingNote: "Email z a i n at g m a i l dot c o m" },
    { bookingNote: "Visit example.dev" },
    { bookingNote: "Call 0a7a5a0a1a2a3a4a5a6" },
    { bookingNote: "Call 0a7b5c0d1e2f3g4h5i6" },
    { bookingNote: "Call 0a 7b 5c 0d 1e 2f 3g 4h 5i 6" },
    { bookingNote: "Call ٠a ٧b ٥c ٠d ١e ٢f ٣g ٤h ٥i ٦" },
    { bookingNote: "Call ۰a ۷b ۵c ۰d ۱e ۲f ۳g ۴h ۵i ۶" },
    { bookingNote: "Call ०७५०१२३४५६७" },
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
