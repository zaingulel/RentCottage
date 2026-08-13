export const repository = "zaingulel/RentCottage";
export const projectOwner = "zaingulel";
export const projectNumber = 4;

export const replacementIssues = [
  [
    "D01",
    19,
    "Deploy a trilingual marketplace shell",
    [],
    "Foundation & quality",
  ],
  [
    "D02",
    20,
    "Enforce role-safe customer, owner and administrator access",
    [19],
    "Foundation & quality",
  ],
  [
    "D03",
    21,
    "Prepare an owner application and first private cottage page",
    [20],
    "Owner backoffice",
  ],
  [
    "D04",
    22,
    "Review and decide owner applications within the service target",
    [21],
    "Administration & governance",
  ],
  [
    "D05",
    23,
    "Complete the first cottage and create additional private drafts",
    [22],
    "Owner backoffice",
  ],
  [
    "D06",
    24,
    "Translate, moderate and publish a cottage in all launch languages",
    [23],
    "Administration & governance",
  ],
  [
    "D07",
    25,
    "Define safe daily shifts and a full-day option",
    [24],
    "Owner backoffice",
  ],
  ["D08", 26, "Price and open future availability", [25], "Owner backoffice"],
  [
    "D09",
    27,
    "Show an owner calendar without rewriting commitments",
    [26],
    "Owner backoffice",
  ],
  [
    "D10",
    28,
    "Browse and search approved cottages across Iraq",
    [24, 26],
    "Customer marketplace",
  ],
  [
    "D11",
    29,
    "Select shifts and receive an exact preserved quote",
    [26, 28],
    "Customer marketplace",
  ],
  [
    "D12",
    30,
    "Prove the payment contract and validate provider candidates",
    [19],
    "Foundation & quality",
  ],
  [
    "D13",
    31,
    "Prevent overlapping holds under concurrent requests",
    [20, 26, 29],
    "Booking lifecycle",
  ],
  [
    "D14",
    32,
    "Authorise the Customer Total and submit a booking request",
    [20, 29, 30, 31],
    "Booking lifecycle",
  ],
  [
    "D15",
    33,
    "Let the owner decide and release unsuccessful requests",
    [32],
    "Booking lifecycle",
  ],
  [
    "D16",
    34,
    "Capture payment and recover safely for 20 minutes",
    [30, 33],
    "Booking lifecycle",
  ],
  [
    "D17",
    35,
    "Confirm a paid booking and release access details",
    [34],
    "Booking lifecycle",
  ],
  [
    "D18",
    36,
    "Message safely before and after payment",
    [20, 24, 34],
    "Booking lifecycle",
  ],
  [
    "D19",
    37,
    "Show booking history and send preparation reminders",
    [35],
    "Booking lifecycle",
  ],
  [
    "D20",
    38,
    "Apply the shared cancellation and refund policy",
    [34, 35],
    "Booking lifecycle",
  ],
  [
    "D21",
    39,
    "Complete bookings and record no-shows or incidents",
    [37, 38],
    "Booking lifecycle",
  ],
  [
    "D22",
    40,
    "Publish genuine reviews and one owner reply",
    [24, 39],
    "Customer marketplace",
  ],
  [
    "D23",
    41,
    "Explain owner earnings and payout status",
    [34, 38, 39],
    "Owner backoffice",
  ],
  [
    "D24",
    42,
    "Search records and operate queues from a basic administrator dashboard",
    [22, 34, 38, 39],
    "Administration & governance",
  ],
  [
    "D25",
    43,
    "Reconcile marketplace money and export basic records",
    [38, 41, 42],
    "Administration & governance",
  ],
  [
    "D26",
    44,
    "Suspend or reactivate unsafe accounts and inventory without losing history",
    [27, 42],
    "Administration & governance",
  ],
  [
    "D27",
    45,
    "Integrate the approved production payment provider",
    [30, 34, 41],
    "Booking lifecycle",
  ],
  [
    "D28",
    46,
    "Integrate and control the production AI translation service",
    [24],
    "Foundation & quality",
  ],
  [
    "D29",
    47,
    "Integrate Iraqi phone verification and booking notifications",
    [20, 35],
    "Foundation & quality",
  ],
  [
    "D30",
    48,
    "Integrate privacy-safe maps and location release",
    [23, 28, 35],
    "Customer marketplace",
  ],
  [
    "D31",
    49,
    "Harden the production runtime, data and deployment path",
    [21, 31, 45, 46, 47, 48],
    "Foundation & quality",
  ],
  [
    "D32",
    50,
    "Prove the complete mobile journey in all three languages",
    [36, 38, 40, 43, 49],
    "Foundation & quality",
  ],
  [
    "D33",
    51,
    "Satisfy and record every public-launch gate",
    [44, 45, 46, 47, 48, 49, 50],
    "Administration & governance",
  ],
].map(([ticketId, number, title, blockers, area]) => ({
  ticketId,
  number,
  title,
  blockers,
  area,
}));

export const acceptanceCriteriaByIssue = new Map([
  [
    19,
    [
      "A TypeScript and Next.js application builds through OpenNext and runs in a Cloudflare Workers preview.",
      "Development, test and production configuration use separate Supabase environments and do not expose server secrets to the browser.",
      "A visible language control switches Arabic, Sorani Kurdish and English without losing the current route or in-progress page state.",
      "Arabic and Sorani Kurdish render right to left, while English renders left to right, at mobile and wider viewport sizes.",
      "GitHub Actions verifies formatting, types, tests, the production build and a deployed-preview smoke path.",
    ],
  ],
  [
    20,
    [
      "A customer can verify a phone number and receives only customer permissions.",
      "A prospective or approved Cottage Owner can verify a phone number and receives only the owner permissions appropriate to their current approval state.",
      "Platform Administrator access requires multi-factor authentication and is never granted by a public self-service role change.",
      "Supabase Row Level Security covers every exposed customer, owner and administrator data path introduced by this slice.",
      "Denial tests prove cross-account, cross-cottage and cross-role reads and writes fail.",
      "Successful and failed privileged sign-in attempts are attributed and timestamped in the audit record.",
    ],
  ],
  [
    21,
    [
      "A prospective owner can save and resume a Draft Owner Application without an invitation.",
      "The application includes the private first Cottage Profile, identity evidence, authority-to-rent evidence, applicable licence or recorded exemption basis and payout-account evidence.",
      "Submission is rejected until every currently required field and evidence type is present, with clear missing-item guidance.",
      "The applicant can see their own draft and submitted application but cannot publish a cottage or receive Booking Requests.",
      "Verification documents remain in private storage, are excluded from Automatic Translation and cannot be fetched by unauthorised accounts.",
      "Authorised document access is time-limited, attributed and recorded in the audit history.",
    ],
  ],
  [
    22,
    [
      "Administrators can open a submitted application with its private first Cottage Profile, evidence inventory and submission timestamp.",
      "A missing-information request records what is required, notifies the applicant and pauses the three-day review target until the applicant replies.",
      "When requested information arrives, the application returns to the review queue and the same review target resumes from where it paused.",
      "Approval records the reviewer, decision time, reason, jurisdiction, evidence types, licence or exemption basis and relevant expiry dates.",
      "Rejection records and communicates a reason and does not permit publication or Booking Requests.",
      "Owner approval does not publish the first cottage automatically; the separate Cottage Profile approval remains required.",
    ],
  ],
  [
    23,
    [
      "The approved owner continues the existing first Cottage Profile instead of creating a disconnected duplicate.",
      "One owner account can create and manage multiple private Cottage Profile drafts.",
      "Each draft captures photos, guest capacity, bedrooms, bathrooms, key amenities, description and House Rules.",
      "Approximate public location is stored separately from the exact private map location and directions.",
      "Only the owning account and authorised administrators can view or edit an unpublished draft.",
      "A draft cannot be submitted for content approval until all required cottage information is complete.",
    ],
  ],
  [
    24,
    [
      "An owner may submit description and House Rules in any one Launch Language, with the original text and source language preserved.",
      "The replaceable AI translation contract produces draft versions in the other Launch Languages without sending verification documents.",
      "An administrator can compare the source and generated versions, correct each version and record an approval or rejection reason.",
      "A new cottage becomes public only when the owner is approved and all three language versions are approved together.",
      "A later Content Change remains private while the last approved public version stays live.",
      "An approved Content Change publishes all three versions atomically and preserves version and decision history.",
    ],
  ],
  [
    25,
    [
      "A cottage accepts exactly two or three named recurring Cottage Shifts and rejects any overlapping shift definition.",
      "A shift may cross midnight and is consistently assigned to the Service Day on which it starts.",
      "The owner may leave any turnaround gap needed between shifts; RentCottage does not impose an invented minimum gap.",
      "The Full-Day Bundle identifies all component shifts and represents continuous access for the agreed full-day period.",
      "Changes to shift times apply only to future uncommitted inventory and cannot rewrite held or confirmed records.",
      "Every shift of a newly published cottage starts closed until the owner deliberately opens it.",
    ],
  ],
  [
    26,
    [
      "The owner can set a standard price for each Cottage Shift and a separate Full-Day Bundle price.",
      "Weekday pricing and specific-date pricing override the standard rate using one documented deterministic precedence order.",
      "The owner can open or close selected future shifts and Full-Day Bundles by Service Day.",
      "A Private Block removes the relevant shifts from availability without revealing its reason publicly.",
      "A Full-Day Bundle cannot be open when a component shift is unavailable, and component shifts cannot be sold separately once the bundle is committed.",
      "Price and availability changes affect only future uncommitted inventory and are visible in the next customer quote.",
    ],
  ],
  [
    27,
    [
      "The owner calendar distinguishes closed inventory, open inventory, Private Blocks, Pending Holds and Confirmed Bookings.",
      "Pending Holds and Confirmed Bookings show the relevant booking reference and status only to the authorised owner.",
      "A customer-facing calendar reveals availability only and never another customer's identity or the reason for unavailability.",
      "Attempts to close, block, reprice or redefine a held or confirmed shift fail without changing the commitment.",
      "Permitted schedule, price and availability changes are prospective and preserve historical booking snapshots.",
    ],
  ],
  [
    28,
    [
      "Browsing and search work without creating an account.",
      "Search covers all approved Iraqi inventory and can filter by governorate or area, Service Day, Cottage Shifts, guest count and key amenities.",
      "A result appears only when every component shift in the requested Booking Period is available and the cottage capacity is sufficient.",
      "Draft, rejected, paused, suspended and otherwise unpublished cottages never appear publicly.",
      "The public Cottage Profile shows approved photos, capacity, amenities, House Rules, approximate location, available shifts and prices without revealing the exact address.",
      "The same search and Cottage Profile work in Arabic, Sorani Kurdish and English without losing filters when the language changes.",
    ],
  ],
  [
    29,
    [
      "A customer can select one shift, several compatible shifts or separately priced Full-Day Bundles across consecutive Service Days.",
      "Consecutive Full-Day Bundles communicate continuous access between days; incompatible or partially unavailable selections are rejected before quoting.",
      "The quote itemises Booking Price, the proposed fixed IQD 5,000 Booking Service Fee and Customer Total.",
      "The owner's 10% Marketplace Commission is calculated from Booking Price only and does not include the customer fee.",
      "The Booking Snapshot preserves the selected schedule, cottage content version, House Rules, each applied price, Booking Price, fee, total, commission and terms version.",
      "Later cottage, schedule, price or terms changes do not alter the preserved quote once it becomes part of a submitted Booking Request.",
    ],
  ],
  [
    30,
    [
      "A provider-neutral simulator and shared contract cover full-total authorisation, funds reservation, later capture, release, full and partial refunds, disputes and owner settlement.",
      "Contract tests cover signed events, replay, duplicate delivery, out-of-order delivery, timeout and provider failure without creating duplicate money movements.",
      "The contract exposes clear pending, succeeded and failed states for authorisation, capture, release, refund and settlement.",
      "Qi Card is assessed first, with ZainCash and AsiaPay compared where they can supply relevant sandbox and marketplace evidence.",
      "Written evidence covers licensing, delayed capture, release, refunds, disputes, customer charging, owner settlement, pricing and onboarding requirements.",
      "No production provider is marked selected until the complete contract and commercial evidence pass.",
    ],
  ],
  [
    31,
    [
      "One transaction creates a Pending Hold over every component Cottage Shift in the selected Booking Period or creates none of them.",
      "A competing request for any overlapping component shift is rejected while an active Pending Hold or Confirmed Booking exists.",
      "A Full-Day Bundle conflicts with every component shift and an individual component shift conflicts with the bundle.",
      "The same customer cannot hold overlapping active requests at different cottages.",
      "Parallel database tests prove the invariant under production-equivalent transaction semantics rather than only sequential service mocks.",
      "A failed or rolled-back attempt leaves no partial hold and does not close otherwise available inventory.",
    ],
  ],
  [
    32,
    [
      "The customer provides party size, customer name and an optional Booking Note before submission.",
      "The customer accepts the preserved House Rules, cancellation policy and current marketplace terms, with a clear no-refund warning when the request is already inside 48 hours.",
      "Requests cannot be submitted less than six hours before the first selected Cottage Shift.",
      "The full Customer Total is authorised and reserved before the Booking Request and Pending Hold are created.",
      "Authorisation, immutable Booking Request, Booking Snapshot and complete Pending Hold are coordinated idempotently so retries cannot duplicate them.",
      "Failed or abandoned authorisation creates neither a Booking Request nor a Pending Hold.",
      "Successful submission gives the customer a pending status and immediately alerts the Cottage Owner without exposing customer contact details.",
    ],
  ],
  [
    33,
    [
      "The owner sees the requested schedule, party size, Booking Snapshot, Booking Price, 10% commission and expected net amount, but not the customer's phone, email or exact direct contact.",
      "The owner can accept or decline the complete request only; partial acceptance, editing and rescheduling are unavailable.",
      "The four-hour Response Deadline is calculated in Iraq time and an unanswered request expires automatically.",
      "The customer can withdraw a pending request before the owner decides.",
      "Decline, withdrawal and timeout each release the Payment Authorisation and complete Pending Hold exactly once.",
      "Both parties receive an unambiguous accepted, declined, withdrawn or expired status notification.",
    ],
  ],
  [
    34,
    [
      "Owner acceptance triggers Payment Capture automatically and does not require the customer to be awake or press a payment button when capture succeeds normally.",
      "A successful capture creates exactly one Confirmed Booking and converts the Pending Hold without releasing the selected inventory.",
      "Confirmation is withheld while capture remains pending or failed.",
      "A recoverable capture failure starts a 20-minute Payment Required period, keeps every selected shift held and lets the customer provide or retry a valid payment method.",
      "Successful recovery confirms the same booking; expiry releases the hold and ends the unpaid request without a booking or charge.",
      "Signed duplicate, replayed and out-of-order provider events cannot create duplicate captures, Confirmed Bookings or contradictory states.",
      "Each capture and recovery transition is visible to authorised support with a clear operational status.",
    ],
  ],
  [
    35,
    [
      "A Confirmed Booking receives one unique, stable booking reference after successful Payment Capture.",
      "Customer and owner confirmations show the preserved dates, Cottage Shifts, party size, price and relevant House Rules.",
      "The exact address, directions, map pin and mutual customer and owner contact details are released only after payment succeeds.",
      "Owner acceptance without successful payment never reveals the exact location or direct contact details and never displays a confirmed state.",
      "Both parties receive a paid-confirmation notification and can return to the same details from Booking History.",
    ],
  ],
  [
    36,
    [
      "A phone-verified customer can start one cottage-linked conversation before requesting and the same conversation follows the later Booking Request and Confirmed Booking.",
      "Only the customer, the cottage's authorised owner and authorised support staff can read the conversation.",
      "Before payment, messages reject phone numbers written with Western, Arabic or Persian digits, common separators or country-code variants, plus email addresses, web links and social handles.",
      "A blocked message explains the restriction without posting the prohibited content, and repeated bypass attempts are recorded for moderation.",
      "After successful payment, the participants may share contact information and links.",
      "Automatic Translation labels generated text, preserves and exposes the original, shows the original on failure and accepts poor-translation reports.",
      "The conversation becomes read-only seven days after the Booking Period ends, and audio or video calling is not available.",
    ],
  ],
  [
    37,
    [
      "Customer Booking History distinguishes pending, confirmed, declined, expired, withdrawn, cancelled and completed outcomes.",
      "Owner Booking History shows the equivalent authorised records for that owner's cottages and never another owner's bookings.",
      "Each entry opens the preserved details appropriate to its state without leaking exact location or contact information before payment.",
      "A reminder is sent 24 hours before the first booked Cottage Shift for an active Confirmed Booking only.",
      "Reminder timing uses Iraq time and repeated scheduler delivery cannot send duplicate reminders.",
      "Notification delivery and failure state are visible for operational follow-up.",
    ],
  ],
  [
    38,
    [
      "The customer sees the shared cancellation policy before Payment Authorisation.",
      "Customer cancellation at least 48 hours before the first booked Cottage Shift automatically requests a Full Refund of the entire Customer Total, including the Booking Service Fee.",
      "Customer cancellation inside 48 hours and a recorded No-Show receive no refund under the standard policy.",
      "Cottage Owner or RentCottage cancellation automatically requests a Full Refund whenever it occurs.",
      "An administrator can approve a recorded full or partial Refund Exception with amount, reason and attribution.",
      "Refund request state and provider result state remain distinct, visible and idempotent under duplicate events.",
      "Cancellation releases applicable future inventory without erasing the Confirmed Booking, payment or audit history.",
    ],
  ],
  [
    39,
    [
      "An eligible Confirmed Booking becomes completed only after its Booking Period has ended in Iraq time.",
      "A cancelled or otherwise ineligible booking cannot be completed by the scheduler.",
      "Authorised staff can record a No-Show with attribution and time, and the standard no-refund outcome is applied without deleting payment history.",
      "Authorised staff can create a restricted incident record linked to the relevant booking, customer, owner or cottage.",
      "Incident details remain separate from public reviews, support complaints and payment disputes.",
      "The final lifecycle outcome determines whether review and owner-payout eligibility are available.",
    ],
  ],
  [
    40,
    [
      "Only the customer from a completed paid booking can submit a review, and only within 14 days of completion.",
      "The review requires a one-to-five star rating, permits optional written text and rejects a second review for the same booking.",
      "The Cottage Owner may publish one reply and cannot create a reply thread.",
      "Review and reply text reject phone numbers, email addresses, external links and social handles.",
      "Automatic Translation preserves the original, labels generated text, falls back to the original on failure and supports reporting.",
      "An administrator can hide a rule-breaking review or reply with a reason while retaining the internal record and attribution.",
    ],
  ],
  [
    41,
    [
      "Each owner booking shows Booking Price, 10% Marketplace Commission, refund effect, expected net payout and current payout status.",
      "The Booking Service Fee is not treated as part of the owner commission or owner payout.",
      "Late cancellation, Full Refund, partial Refund Exception, dispute and administrator hold outcomes change payout eligibility according to the recorded rules.",
      "Payout cannot become eligible before the Booking Period and required completion outcome.",
      "The owner sees simple expected and paid totals that reconcile to the visible booking-level records.",
      "The view does not introduce demand forecasting, revenue management or advanced owner analytics.",
    ],
  ],
  [
    42,
    [
      "Administrators can search customer accounts, Cottage Owner accounts and Cottage Profiles by the identifiers available to support.",
      "The dashboard shows Owner Applications, cottage content approvals, active Booking Requests, bookings, refunds, reviews and incidents with useful status and date filters.",
      "Queue counts and record status match the underlying lifecycle rather than a separately maintained summary.",
      "An authorised administrator can edit or hide unsafe cottage content only with a recorded reason and attribution.",
      "Verification documents remain available only through the restricted, time-limited and audited document path.",
      "Privileged actions are attributed and timestamped, and the MVP does not expose a configurable complex staff-role system.",
    ],
  ],
  [
    43,
    [
      "Administrators can view booking count, Booking Price totals, Booking Service Fees, Marketplace Commission, refunds and owner payouts for a selected date and status range.",
      "Every aggregate can be traced to the booking-level money records that contribute to it.",
      "Refunds and payout adjustments appear in the correct totals without rewriting the original captured Customer Total.",
      "Filtered operational and financial records can be exported in a commonly usable tabular format.",
      "Export access is restricted and recorded consistently with other privileged administrator actions.",
      "The dashboard and export do not claim to replace accounting software, tax reporting or revenue optimisation.",
    ],
  ],
  [
    44,
    [
      "An authorised administrator can suspend and later reactivate a customer, owner or cottage with a required reason and audit entry.",
      "Suspension immediately prevents the new restricted activity appropriate to that account or cottage.",
      "Affected pending Booking Requests are resolved with customer notification and their authorisations and holds released when they cannot continue.",
      "Existing Confirmed Bookings remain visible for operational handling rather than being silently deleted or rewritten.",
      "Payment, refund, message, review, incident and audit history remain intact through suspension and reactivation.",
      "Reactivation restores only the permitted future activity and does not automatically reopen closed cottage inventory.",
    ],
  ],
  [
    45,
    [
      "The selected provider has written approval against licensing, marketplace charging, owner settlement, refund, dispute and commercial requirements.",
      "Its adapter passes the shared authorisation, reservation, capture, release, refund, dispute and settlement contract without changing booking domain rules.",
      "Provider callbacks are authenticated, replay-safe and idempotent, including duplicate and out-of-order delivery.",
      "Sandbox and production-like evidence proves the complete happy path and important failure and recovery paths.",
      "Operational views expose actionable provider failure states and reconciliation identifiers.",
      "There is no cash, pay-on-arrival or unpaid-confirmation fallback when the provider is unavailable.",
    ],
  ],
  [
    46,
    [
      "The translation adapter uses `gpt-5.6-luna` at the lowest supported reasoning effort by default, with model and prompt choices held in replaceable configuration.",
      "Reported, administrator-flagged or safety-sensitive results can be reprocessed with `gpt-5.6-terra` or routed for human review.",
      "Native Arabic and Sorani Kurdish reviewers approve representative samples across cottage descriptions, House Rules, informal messages, reviews, place names, prices, dates and Cottage Shifts.",
      "Generated text is labelled, originals and source language are retained, failures display the original and users can report poor or inappropriate results.",
      "Verification documents are excluded and only the text plus minimum language context needed for translation is sent to the provider.",
      "Completed results are cached by source content or hash, source language, target language, model identifier and prompt version.",
      "Provider user-content processing, retention and deletion terms are approved before production use.",
      "Retries, request limits, monthly usage limits and spend visibility fail loudly without replacing the original with a blank result.",
    ],
  ],
  [
    47,
    [
      "The selected phone-verification supplier proves delivery to representative Iraqi mobile numbers and documents sender, compliance and failure requirements.",
      "Verification retries, expiry, abuse limits and supplier failures produce clear customer and operational outcomes.",
      "The notification path covers new Booking Request, owner decision, request expiry or withdrawal, payment recovery, paid confirmation, cancellation or refund status and the 24-hour reminder.",
      "Each urgent notification uses the recipient's selected Launch Language and only the details permitted in the current booking state.",
      "Duplicate job or provider events do not send the same lifecycle notification repeatedly.",
      "Adapters remain replaceable and delivery results, failures and cost-driving usage are visible for support.",
    ],
  ],
  [
    48,
    [
      "The owner can set and correct an exact private cottage location and customer directions.",
      "Public Cottage Profiles and search expose only the approved approximate area and cannot derive the exact private pin from delivered data.",
      "A paid Confirmed Booking reveals the exact pin and directions only to its authorised customer and owner.",
      "Pending, declined, withdrawn, expired and unpaid requests never receive the exact location payload.",
      "Map supplier keys and privileged geocoding calls remain server-side with environment separation.",
      "Usage monitoring and billing alerts are configured before public launch.",
    ],
  ],
  [
    49,
    [
      "Cloudflare `workerd` preview tests cover runtime-specific request, authentication, database and provider-adapter behaviour.",
      "Database migrations are repeatable, reviewed and verified independently in non-production before production application.",
      "Secrets, service credentials and private Storage access remain server-side and separated by environment.",
      "Backup and restore of the required Supabase data and private document metadata are exercised and recorded.",
      "Monitoring covers application errors, payment and notification failures, security-relevant events and supplier or infrastructure spend alerts.",
      "A documented rollback path and production smoke checks are executed against the release candidate.",
      "Security checks cover Row Level Security, private document access, administrator authentication and public-data leakage.",
    ],
  ],
  [
    50,
    [
      "Playwright covers owner application, owner approval, cottage publication, customer discovery, quote, request, owner decision, Payment Capture and paid confirmation.",
      "The journeys also cover capture recovery, decline or expiry, cancellation and refund, messaging controls, completion, review and administrator operations.",
      "Representative mobile viewports pass in Arabic, Sorani Kurdish and English with correct right-to-left or left-to-right layout and preserved state when changing language.",
      "Accessibility checks cover keyboard operation, focus order, labels, contrast-sensitive controls and meaningful image alternatives on core routes.",
      "Competing-request, duplicate-provider-event and privacy-boundary checks prove the important failure paths rather than only the happy path.",
      "The release evidence identifies the tested build and environment and contains no unresolved high-severity defect.",
    ],
  ],
  [
    51,
    [
      "At least ten real cottages are approved and ready, preferably across at least two genuine demand areas.",
      "Prospective Iraqi customer research records online-payment willingness and validates or changes the proposed IQD 5,000 Booking Service Fee before launch.",
      "The selected Central Bank of Iraq-licensed payment provider has passed the complete contract and lawful owner-settlement evidence.",
      "Qualified Iraqi and Kurdistan Region advice approves the owner-document checklist, lawful basis and retention schedule.",
      "Cancellation, refund, customer, Cottage Owner, privacy and support terms are approved and match implemented behaviour.",
      "Arabic and Sorani Kurdish translation quality, AI provider data terms, Iraqi phone delivery and privacy-safe map operation are approved.",
      "Production security, backup and restore, monitoring, spend alerts, support procedures and mobile end-to-end evidence are complete.",
      "Each gate records its evidence, decision owner and date, and public launch remains blocked while any gate is incomplete.",
    ],
  ],
]);

export const specialIssues = new Map([
  [
    1,
    {
      title: "Spec: RentCottage web-first marketplace MVP",
      area: "Foundation & quality",
      labels: [],
      blockers: [],
      ownerGated: true,
    },
  ],
  [
    18,
    {
      title: "Move RentCottage to a dedicated GitHub organisation",
      area: "Foundation & quality",
      labels: [],
      blockers: [],
      ownerGated: true,
    },
  ],
  [
    52,
    {
      title: "Adopt lean coding standards and a risk-based testing strategy",
      area: "Foundation & quality",
      labels: ["ready-for-agent"],
      blockers: [19],
    },
  ],
  [
    55,
    {
      title: "Automate tracker reconciliation and Project 4 transitions",
      area: "Foundation & quality",
      labels: ["ready-for-agent"],
      blockers: [52],
    },
  ],
]);

export const expectedMembership = new Set([
  1,
  18,
  52,
  55,
  ...replacementIssues.map(({ number }) => number),
]);

const activeStatuses = new Set(["Ready", "In progress", "In review"]);
const knownStatuses = new Set([
  "Backlog",
  "Ready",
  "In progress",
  "In review",
  "Done",
]);
const knownAreas = new Set([
  "Foundation & quality",
  "Customer marketplace",
  "Owner backoffice",
  "Booking lifecycle",
  "Administration & governance",
]);

export function sameMembers(actual, expected) {
  if (actual.length !== expected.length) return false;
  const counts = new Map();
  for (const value of actual) counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const value of expected) {
    const remaining = counts.get(value);
    if (!remaining) return false;
    counts.set(value, remaining - 1);
  }
  return true;
}

function fieldValue(item, fieldName) {
  return (
    item.fieldValues.nodes.find((value) => value.field?.name === fieldName)
      ?.name ?? null
  );
}

export function normalizeIssueBody(body) {
  return (body ?? "").replaceAll("\r\n", "\n");
}

function textualBlockers(body = "") {
  const section =
    normalizeIssueBody(body)
      .split("## Blocked by\n\n")[1]
      ?.split("\n\n<!--")[0] ?? "";
  return [...section.matchAll(/#(\d+)/g)].map((match) => Number(match[1]));
}

function nativeFor(nativeBlockersByIssue, number) {
  const present =
    nativeBlockersByIssue instanceof Map
      ? nativeBlockersByIssue.has(number)
      : Object.hasOwn(nativeBlockersByIssue, number);
  if (!present) return null;
  return nativeBlockersByIssue instanceof Map
    ? nativeBlockersByIssue.get(number)
    : nativeBlockersByIssue[number];
}

function acceptanceCriteria(body = "") {
  const section =
    normalizeIssueBody(body)
      .split("## Acceptance criteria\n\n")[1]
      ?.split("\n\n## Blocked by")[0] ?? "";
  return [...section.matchAll(/^- \[[ xX]\] (.+)$/gm)].map((match) => match[1]);
}

export function verifyRentCottageProject({
  project,
  issues,
  nativeBlockersByIssue,
}) {
  const failures = [];
  const fail = (code, message) => failures.push({ code, message });

  if (
    !project ||
    project.number !== projectNumber ||
    project.title !== "RentCottage" ||
    project.closed
  ) {
    fail(
      "project.identity",
      "Project identity or open state does not match RentCottage Project 4",
    );
    return { failures, summary: { dependencyFrontier: [], readyItems: [] } };
  }
  if (project.fields.totalCount > project.fields.nodes.length)
    fail("project.fields.pagination", "Project fields are truncated");
  if (project.items.totalCount > project.items.nodes.length)
    fail("project.items.pagination", "Project items are truncated");

  for (const [fieldName, expectedOptions] of [
    ["Status", [...knownStatuses]],
    ["Area", [...knownAreas]],
  ]) {
    const fields = project.fields.nodes.filter(
      (field) => field.name === fieldName,
    );
    if (fields.length !== 1) {
      fail(
        "project.field.missing",
        `Expected one ${fieldName} field, found ${fields.length}`,
      );
      continue;
    }
    const options = fields[0].options?.map(({ name }) => name) ?? [];
    if (
      !sameMembers(options, expectedOptions) ||
      new Set(options).size !== options.length
    ) {
      fail(
        "project.field.options",
        `${fieldName} options do not match the contract`,
      );
    }
  }

  const items = project.items.nodes;
  if (items.some((item) => item.isArchived))
    fail("project.items.archived", "Project contains archived items");
  const issueItems = items.filter(
    (item) =>
      item.type === "ISSUE" &&
      item.content?.repository?.nameWithOwner === repository,
  );
  if (issueItems.length !== items.length)
    fail(
      "project.items.classification",
      "Project contains a draft, pull request, foreign item, or unavailable item",
    );
  const itemNumbers = issueItems.map((item) => item.content.number);
  if (new Set(itemNumbers).size !== itemNumbers.length)
    fail("project.items.duplicate", "Project contains duplicate issue numbers");
  if (!sameMembers(itemNumbers, [...expectedMembership])) {
    fail(
      "project.membership",
      `Project membership ${itemNumbers.sort((a, b) => a - b)} does not match ${[...expectedMembership].sort((a, b) => a - b)}`,
    );
  }

  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const allMarkers = issues.flatMap((issue) =>
    [
      ...normalizeIssueBody(issue.body).matchAll(
        /<!-- rentcottage-ticket-id:(D\d\d) -->/g,
      ),
    ].map((match) => ({ number: issue.number, ticketId: match[1] })),
  );
  if (
    allMarkers.length !== 33 ||
    new Set(allMarkers.map(({ ticketId }) => ticketId)).size !== 33
  ) {
    fail(
      "issues.markers",
      "D01 through D33 markers are not complete and unique",
    );
  }

  const issueContract = new Map(
    replacementIssues.map((issue) => [
      issue.number,
      { ...issue, labels: ["ready-for-agent"] },
    ]),
  );
  for (const [number, policy] of specialIssues)
    issueContract.set(number, { number, ...policy });

  for (const expected of replacementIssues) {
    if (expected.number !== Number(expected.ticketId.slice(1)) + 18)
      fail(
        "issues.mapping",
        `${expected.ticketId} does not map to #${expected.number}`,
      );
    const issue = byNumber.get(expected.number);
    if (!issue) {
      fail("issues.missing", `#${expected.number} is missing`);
      continue;
    }
    if (issue.title !== expected.title)
      fail(
        "issues.title",
        `#${expected.number} title does not match ${expected.ticketId}`,
      );
    const labels = issue.labels.map(({ name }) => name);
    if (!sameMembers(labels, ["ready-for-agent"]))
      fail(
        "issues.labels",
        `#${expected.number} labels do not match the contract`,
      );
    const marker = `<!-- rentcottage-ticket-id:${expected.ticketId} -->`;
    if (
      (normalizeIssueBody(issue.body).match(new RegExp(marker, "g")) ?? [])
        .length !== 1
    )
      fail(
        "issues.marker",
        `#${expected.number} does not contain exactly one ${expected.ticketId} marker`,
      );
    const expectedCriteria = acceptanceCriteriaByIssue.get(expected.number);
    if (!expectedCriteria)
      fail(
        "issues.criteria_manifest",
        `#${expected.number} has no acceptance-criteria manifest`,
      );
    else if (!sameMembers(acceptanceCriteria(issue.body), expectedCriteria))
      fail(
        "issues.criteria",
        `#${expected.number} acceptance criteria do not match the manifest`,
      );
    if (!sameMembers(textualBlockers(issue.body), expected.blockers))
      fail(
        "issues.blocker_text",
        `#${expected.number} blocker text does not match the manifest`,
      );
    const nativeEvidence = nativeFor(nativeBlockersByIssue, expected.number);
    if (nativeEvidence === null) {
      fail(
        "issues.native_evidence_missing",
        `#${expected.number} native dependency evidence is missing`,
      );
      continue;
    }
    const native = nativeEvidence.map(({ number }) => number);
    if (!sameMembers(native, expected.blockers))
      fail(
        "issues.native_blockers",
        `#${expected.number} native blockers do not match the manifest`,
      );
  }

  for (const [number, policy] of specialIssues) {
    const issue = byNumber.get(number);
    if (!issue) {
      fail("issues.special.missing", `Special issue #${number} is missing`);
      continue;
    }
    const labels = issue.labels.map(({ name }) => name);
    if (issue.title !== policy.title)
      fail(
        "issues.special.title",
        `Special issue #${number} title does not match the manifest`,
      );
    if (!sameMembers(labels, policy.labels))
      fail(
        "issues.special.labels",
        `Special issue #${number} labels do not match the contract`,
      );
    if (policy.blockers) {
      const nativeEvidence = nativeFor(nativeBlockersByIssue, number);
      if (nativeEvidence === null) {
        fail(
          "issues.native_evidence_missing",
          `Special issue #${number} native dependency evidence is missing`,
        );
        continue;
      }
      const native = nativeEvidence.map(({ number: blocker }) => blocker);
      if (
        !sameMembers(native, policy.blockers) ||
        !sameMembers(textualBlockers(issue.body), policy.blockers)
      ) {
        fail(
          "issues.special.blockers",
          `Special issue #${number} blockers do not match the contract`,
        );
      }
    }
  }

  for (let number = 2; number <= 17; number += 1) {
    if (byNumber.get(number)?.state !== "CLOSED")
      fail(
        "issues.historical.state",
        `Historical issue #${number} is missing or not closed`,
      );
    if (itemNumbers.includes(number))
      fail(
        "issues.historical.membership",
        `Historical issue #${number} remains on Project 4`,
      );
  }

  for (const item of issueItems) {
    const number = item.content.number;
    const contract = issueContract.get(number);
    if (!contract) continue;
    const issue = byNumber.get(number);
    if (!issue) continue;
    if (item.fieldValues.totalCount > item.fieldValues.nodes.length)
      fail(
        "project.item_fields.pagination",
        `#${number} Project field values are truncated`,
      );
    const status = fieldValue(item, "Status");
    const area = fieldValue(item, "Area");
    if (!knownStatuses.has(status))
      fail(
        "project.status.unknown",
        `#${number} has unknown or missing Status ${status}`,
      );
    if (!knownAreas.has(area))
      fail(
        "project.area.unknown",
        `#${number} has unknown or missing Area ${area}`,
      );
    if (area !== contract.area)
      fail(
        "project.area.mismatch",
        `#${number} Area ${area} does not match ${contract.area}`,
      );
    const nativeEvidence = nativeFor(nativeBlockersByIssue, number);
    if (issue.state !== "OPEN" && activeStatuses.has(status))
      fail("project.status.closed", `Closed #${number} cannot be ${status}`);
    if (nativeEvidence !== null && activeStatuses.has(status)) {
      const openBlockers = nativeEvidence.filter(
        ({ state }) => state.toLowerCase() === "open",
      );
      if (openBlockers.length > 0)
        fail(
          "project.status.invalid",
          `#${number} cannot be ${status} while open blockers=${openBlockers.map(({ number: blocker }) => blocker)}`,
        );
    }
    if (status === "Done" && issue.state !== "CLOSED")
      fail("project.status.done", `Open #${number} cannot be Done`);
    if (contract.ownerGated && status !== "Backlog" && issue.state === "OPEN") {
      fail(
        "project.status.owner_gated",
        `Owner-gated #${number} must remain Backlog while open`,
      );
    }
  }

  const dependencyFrontier = replacementIssues
    .filter(({ number }) => byNumber.get(number)?.state === "OPEN")
    .filter(({ number }) =>
      (nativeFor(nativeBlockersByIssue, number) ?? []).every(
        ({ state }) => state.toLowerCase() !== "open",
      ),
    )
    .map(({ number }) => number);
  const readyItems = issueItems
    .filter((item) => fieldValue(item, "Status") === "Ready")
    .map((item) => item.content.number);

  for (const [label, pattern] of [
    ["#19", /#19\b/],
    ["#51", /#51\b/],
    ["#1", /#1\b/],
    ["#18", /#18\b/],
    ["#52", /#52\b/],
    ["#55", /#55\b/],
    ["native dependencies", /native dependencies/],
    ["active ownership", /active ownership/],
    ["verifier", /verifier/],
  ]) {
    if (!pattern.test(project.readme ?? ""))
      fail("project.readme", `Project README does not mention ${label}`);
  }

  return {
    failures,
    summary: { dependencyFrontier, readyItems, itemCount: items.length },
  };
}
