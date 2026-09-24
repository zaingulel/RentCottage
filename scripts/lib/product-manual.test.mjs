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
const productLines = manual
  .slice(manual.indexOf(SHARED_END) + SHARED_END.length)
  .split("\n");

const normalise = (text) => text.trim().replace(/\s+/g, " ");
// A Markdown table row's cells, so spacing around the delimiters does not count.
const cells = (row) => row.trim().split("|").slice(1, -1).map(normalise);
const isRow = (line) => line.trim().startsWith("|");
// A line that starts a new Markdown block the product region uses ends a paragraph.
const isBlockStart = (line) =>
  line.trim() === "" || /^(#|\||\d+\. |- )/.test(line.trimStart());

// The one product-region unit keyed by `key` must equal `expected`, ignoring whitespace-only
// formatting, so an appended exception or a deletion both fail. A table row is keyed by its first
// cell and compared cell by cell; any other line is keyed by its leading text.
function assertProductLine(key, expected) {
  assert.ok(manual.includes(SHARED_END), `${SHARED_END} marker`);
  if (isRow(expected)) {
    assert.deepEqual(
      productLines
        .filter((line) => isRow(line) && cells(line)[0] === key)
        .map(cells),
      [cells(expected)],
    );
  } else {
    assert.deepEqual(
      productLines.map(normalise).filter((line) => line.startsWith(key)),
      [expected],
    );
  }
}

// The paragraph from the line starting `prefix` to the next blank line or Markdown block,
// whitespace-normalised, must equal `expected` exactly.
function assertProductParagraph(prefix, expected) {
  assert.ok(manual.includes(SHARED_END), `${SHARED_END} marker`);
  const start = productLines.findIndex((line) => line.startsWith(prefix));
  assert.notEqual(start, -1, prefix);
  const end = productLines.findIndex(
    (line, index) => index > start && isBlockStart(line),
  );
  assert.equal(
    normalise(
      productLines
        .slice(start, end === -1 ? productLines.length : end)
        .join(" "),
    ),
    expected,
  );
}

for (const guarantee of [
  "1. **Authorization and Row Level Security**: every customer, Cottage Owner and Platform Administrator path has the minimum access, with real PostgreSQL policy evidence where the boundary changes.",
  "2. **Payment and provider trust**: signed events are authenticated before processing; money-changing commands are replay-safe and idempotent; authorization, capture, release, refund and payout facts remain authoritative through retries and partial failure.",
  "3. **Personal data and credential custody**: service-role and payment secrets remain server-side; private verification files, exact addresses, contacts, audit records and payment detail do not cross a public or pre-confirmation boundary; logs contain no secrets or unnecessary personal data.",
  "4. **Integrity and injection**: schema/migration changes preserve atomic constraints and concurrency guarantees; every HTTP, environment, database and provider input is validated before entering trusted code; rendered untrusted content cannot inject markup or script.",
  "5. **Anti-regression evidence**: each widened security/privacy claim has a named mutation-proven observer at the real boundary; mocks do not substitute for database policy, concurrency, signature or Worker evidence.",
]) {
  test(`product region keeps standing security guarantee ${guarantee.slice(0, 1)}`, () => {
    assertProductLine(
      guarantee.slice(0, guarantee.indexOf("**:") + 3),
      guarantee,
    );
  });
}

test("product region keeps preview deployment outside push-to-merge authority", () => {
  assertProductParagraph(
    "Preview deployment under",
    "Preview deployment under `.github/workflows/preview.yml` remains a separate owner-approved operation and is not included in ordinary push-to-merge delivery authority.",
  );
});

test("product region keeps the visual verification surfaces", () => {
  assertProductLine(
    "visual verification",
    "| visual verification | The applicable Next.js or Worker surface across desktop, mobile, right-to-left and accessibility states. |",
  );
});

test("product region keeps the sign-off trust-boundary catch-all", () => {
  assertProductLine(
    "sign-off",
    "| sign-off | Authentication, authorization, payments, personal data, schema/migrations, Row Level Security, provider/Worker trust, the public/private data perimeter, and any other trust-boundary change; each needs explicit sign-off and a named anti-regression test |",
  );
});

test("product region keeps the shared-workflow sync security-review trigger", () => {
  assertProductLine(
    "security review",
    "| security review | Authentication, authorization, payment or personal-data access, credential custody, provider-webhook trust, Row Level Security, public/private data exposure, an injection boundary, or a shared-workflow sync that changes agent permissions, hook registrations or hook scripts; privacy: [docs/product/rentcottage-mvp-prd.md](docs/product/rentcottage-mvp-prd.md#6-privacy-safety-and-moderation) |",
  );
});
