import { describe, expect, it } from "vitest";
import {
  accessLanguageHref,
  administratorAccessHref,
  administratorAccessLanguageHref,
  safeAdministratorReturnDestination,
  safeReturnDestination,
} from "./return-destination";

const untrustedDestinations = [
  "https://evil.test/en/bookings",
  "//evil.test/en",
  "/en/../administrator",
  "/en/%2e%2e/administrator",
  "/en/%252e%252e/administrator",
  "/en/bookings%3fworkspace=owner",
  "/en/bookings?token=secret",
  "/en/bookings?workspace=admin",
  "/en/bookings?workspace=owner&workspace=owner",
  "/en/messages?cottage=invalid",
  "/en/messages?token=private",
  "/en/messages?cottage=cottage-0123456789abcdef0123456789abcdef&token=private",
  "/en/messages/10000000-0000-4000-8000-000000000001?before=0",
  "/en/messages/10000000-0000-4000-8000-000000000001?before=1&before=2",
  "/en/messages/10000000-0000-4000-8000-000000000001?token=private",
  "/en/request/river-house?from=2101-01-01&to=2101-01-01&guests=4&selection=2101-01-01:shift:1&conversation=invalid",
  "/en/request/river-house?from=2101-01-01&to=2101-01-01&guests=4&selection=2101-01-01:shift:1&conversation=10000000-0000-4000-8000-000000000001&conversation=10000000-0000-4000-8000-000000000001",
  "/en/administrator/access",
  "/en/administrator/reviews",
  "/en/administrator/users",
  "/en/administrator/reviews?beforeAt=2026-09-21T12:00:00.000Z",
  "/api/anything",
  "/en/access",
  "/en/search",
  "/ar/bookings",
  "/en/owner/cottages/invalid",
  "/en/bookings#secret",
  "/en/results?note=private",
  "/en/\\evil.test",
  "/en/bookings\n",
];

const untrustedAdministratorDestinations = [
  undefined,
  ["/en/administrator/reviews"],
  "https://evil.test/en/administrator/reviews",
  "//evil.test/en/administrator/reviews",
  "/ar/administrator/reviews",
  "/en/administrator/reviews%3FbeforeAt=private",
  "/en/administrator/reviews?beforeAt=private",
  "/en/administrator/reviews#private",
  "/en/administrator/reviews\n",
  "/en/administrator\\reviews",
  "/en/administrator",
];

describe("account return destinations", () => {
  it.each([
    "/en",
    "/en/results?from=2101-01-01&to=2101-01-01&guests=4&selection=2101-01-01:shift:1",
    "/en/cottages/river-house",
    "/en/request/river-house",
    "/en/bookings?workspace=owner",
    "/en/messages",
    "/en/messages?cottage=cottage-0123456789abcdef0123456789abcdef",
    "/en/messages?cottage=cottage-0123456789abcdef0123456789abcdef&from=2101-01-01&to=2101-01-01&guests=4&selection=2101-01-01:shift:1",
    "/en/request/river-house?from=2101-01-01&to=2101-01-01&guests=4&selection=2101-01-01:shift:1&conversation=10000000-0000-4000-8000-000000000001",
    "/en/messages/10000000-0000-4000-8000-000000000001",
    "/en/messages/10000000-0000-4000-8000-000000000001?from=2101-01-01&to=2101-01-01&guests=4&selection=2101-01-01:shift:1",
    "/en/messages/10000000-0000-4000-8000-000000000001?before=31&from=2101-01-01&to=2101-01-01&guests=4&selection=2101-01-01:shift:1",
    "/en/booking-requests/RC-REQ-0123456789ABCDEF",
    "/en/owner/booking-requests/RC-REQ-0123456789ABCDEF",
    "/en/owner/application",
    "/en/owner/cottages",
    "/en/owner/cottages/10000000-0000-4000-8000-000000000001",
  ])("preserves permitted context %s", (destination) => {
    expect(safeReturnDestination("en", destination)).toBe(destination);
  });
  it.each(untrustedDestinations)(
    "rejects untrusted destination %s",
    (destination) => {
      expect(safeReturnDestination("en", destination)).toBe("/en/bookings");
    },
  );
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

describe("administrator return destinations", () => {
  it.each(["en", "ar", "ckb"] as const)(
    "accepts only the exact %s moderation queue",
    (locale) => {
      const destination = `/${locale}/administrator/reviews`;
      expect(safeAdministratorReturnDestination(locale, destination)).toBe(
        destination,
      );
      expect(administratorAccessHref(locale, destination)).toBe(
        `/${locale}/administrator/access?returnTo=${encodeURIComponent(destination)}`,
      );
    },
  );

  it.each(untrustedAdministratorDestinations)(
    "rejects an untrusted administrator destination %#",
    (destination) => {
      expect(
        safeAdministratorReturnDestination("en", destination),
      ).toBeUndefined();
      expect(administratorAccessHref("en", destination)).toBe(
        "/en/administrator/access",
      );
    },
  );
});

describe("administrator access language links", () => {
  it.each([
    [
      "en",
      "ar",
      "/ar/administrator/access?returnTo=%2Far%2Fadministrator%2Freviews",
    ],
    [
      "en",
      "ckb",
      "/ckb/administrator/access?returnTo=%2Fckb%2Fadministrator%2Freviews",
    ],
    [
      "ckb",
      "en",
      "/en/administrator/access?returnTo=%2Fen%2Fadministrator%2Freviews",
    ],
    [
      "ar",
      "ar",
      "/ar/administrator/access?returnTo=%2Far%2Fadministrator%2Freviews",
    ],
  ] as const)(
    "translates the %s moderation queue into %s",
    (locale, target, href) => {
      expect(
        administratorAccessLanguageHref(
          locale,
          target,
          `/${locale}/administrator/reviews`,
        ),
      ).toBe(href);
    },
  );
  it.each(untrustedAdministratorDestinations)(
    "links to the bare access page for an untrusted administrator destination %#",
    (destination) => {
      expect(administratorAccessLanguageHref("en", "ar", destination)).toBe(
        "/ar/administrator/access",
      );
    },
  );
});

describe("access language links", () => {
  it("translates a permitted booking context into the target language", () => {
    expect(
      accessLanguageHref(
        "en",
        "ar",
        "/en/request/river-house?from=2101-01-01&to=2101-01-01&guests=4&selection=2101-01-01:shift:1",
      ),
    ).toBe(
      "/ar/access?returnTo=%2Far%2Frequest%2Friver-house%3Ffrom%3D2101-01-01%26to%3D2101-01-01%26guests%3D4%26selection%3D2101-01-01%3Ashift%3A1",
    );
  });
  it.each([
    [
      "ar",
      "/en/owner/application",
      "/ar/access?returnTo=%2Far%2Fowner%2Fapplication",
    ],
    [
      "ar",
      "/en/owner/cottages",
      "/ar/access?returnTo=%2Far%2Fowner%2Fcottages",
    ],
    [
      "ckb",
      "/en/owner/application",
      "/ckb/access?returnTo=%2Fckb%2Fowner%2Fapplication",
    ],
  ] as const)(
    "translates owner enrollment into %s: %s",
    (target, returnTo, href) => {
      expect(accessLanguageHref("en", target, returnTo)).toBe(href);
    },
  );
  it("falls back when no destination is given", () =>
    expect(accessLanguageHref("en", "ar", undefined)).toBe(
      "/ar/access?returnTo=%2Far%2Fbookings",
    ));
  it.each(untrustedDestinations)(
    "falls back for untrusted destination %s",
    (destination) => {
      expect(accessLanguageHref("en", "ar", destination)).toBe(
        "/ar/access?returnTo=%2Far%2Fbookings",
      );
    },
  );
  it.each(["/ar/owner/application", "/ar/bookings"])(
    "falls back for a destination already in another language: %s",
    (destination) => {
      expect(accessLanguageHref("en", "ar", destination)).toBe(
        "/ar/access?returnTo=%2Far%2Fbookings",
      );
    },
  );
  it("falls back for a repeated destination", () =>
    expect(
      accessLanguageHref("en", "ar", ["/en/bookings", "/en/bookings"]),
    ).toBe("/ar/access?returnTo=%2Far%2Fbookings"));
  it("keeps the destination for the current language", () =>
    expect(accessLanguageHref("en", "en", "/en/owner/cottages")).toBe(
      "/en/access?returnTo=%2Fen%2Fowner%2Fcottages",
    ));
});
