import { expect, it } from "vitest";

import { GET } from "./route";

it("normalizes a valid GET lookup into the opaque history route", async () => {
  const response = await GET(
    new Request(
      "http://localhost/en/administrator/payments/lookup?reference=rc-req-0000000000000137",
    ),
    { params: Promise.resolve({ locale: "en" }) },
  );
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    "http://localhost/en/administrator/payments/RC-REQ-0000000000000137",
  );
});

it("returns malformed lookups to the localized lookup page", async () => {
  const response = await GET(
    new Request(
      "http://localhost/ar/administrator/payments/lookup?reference=customer-phone",
    ),
    { params: Promise.resolve({ locale: "ar" }) },
  );
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    "http://localhost/ar/administrator/payments",
  );
});
