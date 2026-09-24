// product-manual.test.mjs — RentCottage's own contracts in the product region of AGENTS.md.
//
// The shared workflow region is pinned by workflow-contract.test.mjs; the text after
// <!-- factory-shared:end --> is product-owned, so its security, preview, visual and sign-off
// contracts are pinned here and a sync or edit cannot drop or weaken them silently.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SHARED_END = "<!-- factory-shared:end -->";
const manual = readFileSync(resolve(ROOT, "AGENTS.md"), "utf8");
const normalise = (text) => text.replace(/\s+/g, " ");
const productRegion = normalise(
  manual.slice(manual.indexOf(SHARED_END) + SHARED_END.length),
);

function assertProductRegionContains(text) {
  assert.ok(manual.includes(SHARED_END), `${SHARED_END} marker`);
  assert.ok(productRegion.includes(normalise(text)), text);
}

for (const guarantee of [
  "1. **Authorization and Row Level Security**: every customer, Cottage Owner and Platform Administrator path has the minimum access, with real PostgreSQL policy evidence where the boundary changes.",
  "2. **Payment and provider trust**: signed events are authenticated before processing; money-changing commands are replay-safe and idempotent; authorization, capture, release, refund and payout facts remain authoritative through retries and partial failure.",
  "3. **Personal data and credential custody**: service-role and payment secrets remain server-side; private verification files, exact addresses, contacts, audit records and payment detail do not cross a public or pre-confirmation boundary; logs contain no secrets or unnecessary personal data.",
  "4. **Integrity and injection**: schema/migration changes preserve atomic constraints and concurrency guarantees; every HTTP, environment, database and provider input is validated before entering trusted code; rendered untrusted content cannot inject markup or script.",
  "5. **Anti-regression evidence**: each widened security/privacy claim has a named mutation-proven observer at the real boundary; mocks do not substitute for database policy, concurrency, signature or Worker evidence.",
]) {
  test(`product region keeps standing security guarantee ${guarantee.slice(0, 1)}`, () => {
    assertProductRegionContains(guarantee);
  });
}

test("product region keeps preview deployment outside push-to-merge authority", () => {
  assertProductRegionContains(
    "Preview deployment under `.github/workflows/preview.yml` remains a separate owner-approved operation and is not included in ordinary push-to-merge delivery authority.",
  );
});

test("product region keeps the visual verification surfaces", () => {
  assertProductRegionContains(
    "| visual verification | The applicable Next.js or Worker surface across desktop, mobile, right-to-left and accessibility states. |",
  );
});

test("product region keeps the sign-off trust-boundary catch-all", () => {
  assertProductRegionContains(
    "the public/private data perimeter, and any other trust-boundary change; each needs explicit sign-off and a named anti-regression test",
  );
});

test("product region keeps the shared-workflow sync security-review trigger", () => {
  assertProductRegionContains(
    "an injection boundary, or a shared-workflow sync that changes agent permissions, hook registrations or hook scripts; privacy:",
  );
});
