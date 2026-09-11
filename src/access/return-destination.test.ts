import { describe, expect, it } from "vitest";
import { safeReturnDestination } from "./return-destination";

describe("account return destinations", () => {
  it.each([
    "/en",
    "/en/results?from=2101-01-01&to=2101-01-01&guests=4&selection=2101-01-01:shift:1",
    "/en/cottages/river-house",
    "/en/request/river-house",
    "/en/bookings?workspace=owner",
    "/en/booking-requests/RC-REQ-0123456789ABCDEF",
    "/en/owner/booking-requests/RC-REQ-0123456789ABCDEF",
    "/en/owner/application",
    "/en/owner/cottages",
    "/en/owner/cottages/10000000-0000-4000-8000-000000000001",
  ])("preserves permitted context %s", (destination) => {
    expect(safeReturnDestination("en", destination)).toBe(destination);
  });
  it.each([
    "https://evil.test/en/bookings",
    "//evil.test/en",
    "/en/../administrator",
    "/en/%2e%2e/administrator",
    "/en/%252e%252e/administrator",
    "/en/bookings%3fworkspace=owner",
    "/en/bookings?token=secret",
    "/en/bookings?workspace=admin",
    "/en/bookings?workspace=owner&workspace=owner",
    "/en/administrator/access",
    "/api/anything",
    "/en/access",
    "/en/search",
    "/ar/bookings",
    "/en/owner/cottages/invalid",
    "/en/bookings#secret",
    "/en/results?note=private",
    "/en/\\evil.test",
    "/en/bookings\n",
  ])("rejects untrusted destination %s", (destination) => {
    expect(safeReturnDestination("en", destination)).toBe("/en/bookings");
  });
  it("defaults to the current language", () =>
    expect(safeReturnDestination("ckb", undefined)).toBe("/ckb/bookings"));
  it.each(["__proto__=private", "__proto__=one&__proto__=two", "note=private"])(
    "rejects extra fields on an otherwise valid search: %s",
    (extra) => {
      const search =
        "/en/results?from=2101-01-01&to=2101-01-01&guests=4&selection=2101-01-01:shift:1";
      expect(safeReturnDestination("en", `${search}&${extra}`)).toBe(
        "/en/bookings",
      );
    },
  );
});
