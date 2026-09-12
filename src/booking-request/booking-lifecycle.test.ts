import { describe, expect, it } from "vitest";
import {
  parseBookingLifecycle,
  parseBookingCompletionEligibility,
} from "./booking-lifecycle";
const id = "60000000-0000-4000-8000-000000001001";
const incident = {
  id: "90000000-0000-4000-8000-000000003901",
  source: "lifecycle",
  category: "safety",
  narrative: "PRIVATE incident",
  actorUserId: "10000000-0000-4000-8000-000000003801",
  actorRole: "platform_administrator",
  recordedAt: "2026-09-12T01:00:00Z",
};
const eligibility = {
  status: "completed",
  effectivePeriodEnd: "2026-09-11T23:00:00Z",
  assessedAt: "2026-09-12T01:00:00Z",
  reviewExpiresAt: "2026-09-25T23:00:00Z",
  reviewAvailable: true,
  payoutPrerequisiteAt: "2026-09-11T23:00:00Z",
  payoutPrerequisiteAvailable: true,
};
describe("restricted booking lifecycle projection", () => {
  it.each([
    "confirmed",
    "completed",
    "no_show",
    "cancelled",
    "incident_pending",
  ])(
    "accepts explicit %s outcome and strips unknown personal fields",
    (status) =>
      expect(
        parseBookingLifecycle(
          { bookingRequestId: id, status, customerPhone: "PRIVATE" },
          id,
          "customer",
        ),
      ).toEqual({ bookingRequestId: id, status }),
  );
  it.each(["customer", "cottage_owner"] as const)(
    "rejects administrator narrative in %s projection",
    (role) =>
      expect(() =>
        parseBookingLifecycle(
          {
            bookingRequestId: id,
            status: "incident_pending",
            incidents: [incident],
          },
          id,
          role,
        ),
      ).toThrow(),
  );
  it("keeps original incident source identity and attribution for administrators", () =>
    expect(
      parseBookingLifecycle(
        {
          bookingRequestId: id,
          status: "completed",
          incidents: [incident],
          noShow: null,
        },
        id,
        "platform_administrator",
      ),
    ).toEqual({
      bookingRequestId: id,
      status: "completed",
      incidents: [incident],
      noShow: null,
    }));
  it("rejects a foreign booking identity", () =>
    expect(() =>
      parseBookingLifecycle(
        { bookingRequestId: "foreign", status: "confirmed" },
        id,
        "customer",
      ),
    ).toThrow());
  it("requires explicit final outcome", () =>
    expect(() =>
      parseBookingLifecycle(
        { bookingRequestId: id, status: "unknown" },
        id,
        "customer",
      ),
    ).toThrow());
  it("preserves downstream prerequisite facts without calculating settlement", () =>
    expect(parseBookingCompletionEligibility(eligibility)).toEqual(
      eligibility,
    ));
  it("represents unavailable prerequisites explicitly", () =>
    expect(
      parseBookingCompletionEligibility({
        status: "unavailable",
        reviewAvailable: false,
        payoutPrerequisiteAvailable: false,
      }),
    ).toEqual({
      status: "unavailable",
      reviewAvailable: false,
      payoutPrerequisiteAvailable: false,
    }));
  it.each([
    { ...eligibility, status: "no_show", reviewExpiresAt: null },
    { ...eligibility, reviewAvailable: "yes" },
    {
      status: "unavailable",
      reviewAvailable: false,
      payoutPrerequisiteAvailable: true,
    },
  ])("rejects invalid or contradictory eligibility %j", (value) =>
    expect(() => parseBookingCompletionEligibility(value)).toThrow(),
  );
});
