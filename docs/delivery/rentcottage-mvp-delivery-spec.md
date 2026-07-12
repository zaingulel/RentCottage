# RentCottage MVP Internal Delivery Specification

**Audience:** RentCottage delivery team and coding agents
**Purpose:** Preserve granular product behaviour for planning, ticket generation, implementation and verification.
**Not a client deliverable:** Yasir's sign-off artifact is `docs/product/RentCottage-MVP-PRD.docx`.

## Source-of-truth hierarchy

1. The signed client PRD defines the approved MVP scope and business rules.
2. `CONTEXT.md` defines the domain vocabulary and precise meaning of RentCottage concepts.
3. This delivery specification expands the approved product into granular behaviours for planning and verification.
4. GitHub Issues are execution records. They do not override the signed PRD or current domain definitions.

If these sources conflict, stop and reconcile the lower-priority source. Do not silently implement an older ticket or an internal interpretation that contradicts the signed PRD.

## Ticket-generation contract

When running `$to-tickets`, use this document together with the signed client PRD and `CONTEXT.md`. The condensed stories in the client PRD are for readable sign-off; they are not intended to determine ticket size.

The behaviours below are coverage requirements, not preselected ticket boundaries. Ticket generation must:

- create small, independently demonstrable vertical slices through the relevant customer, owner or administrator journey;
- include the minimum user-facing behaviour, domain rule, persistence, permissions and verification needed to prove that slice;
- preserve lifecycle and dependency order explicitly rather than creating one large ticket per PRD section;
- split distinct success, expiry, cancellation, disclosure and payment-recovery paths when they can be delivered and verified independently;
- keep closely coupled state changes atomic, such as Payment Authorization plus Booking Request plus Pending Hold;
- avoid horizontal tickets that implement an entire database layer, API layer or UI layer without a demonstrable product outcome;
- record blocking edges between tickets and keep each ticket small enough for one focused implementation session where practical;
- give every ticket acceptance criteria that can fail if the behaviour regresses;
- treat launch research, legal review and payment-provider validation as explicit gates rather than hiding them inside implementation tickets.

One granular behaviour may require more than one ticket, and one vertical ticket may satisfy several closely related behaviours. Coverage must be traceable either way.

Each generated ticket should state its demonstrable outcome, referenced behaviour numbers, included user roles, lifecycle states, validation and disclosure rules, failure paths, acceptance criteria, verification method, exclusions and blocking issues.

## Approved constraints carried into delivery

- Approved inventory may be located anywhere in Iraq; public launch requires at least ten approved cottages.
- Every Cottage uses one owner-defined Shift Schedule containing two or three fixed, non-overlapping Cottage Shifts.
- Customers may select individual shifts, a separately priced Full-Day Bundle or a Booking Period across consecutive Service Days.
- Arabic, Sorani Kurdish and English are required at launch; Arabic and Sorani are right-to-left and English is left-to-right.
- RentCottage uses request-to-book. The owner accepts or declines the complete request rather than individual component shifts.
- The full Booking Price is authorized online before the Booking Request and Pending Hold exist, then captured only after owner acceptance.
- The Response Deadline is four hours, the Booking Request Cut-Off is six hours before the first shift, and Payment Required lasts 15 minutes.
- One marketplace-wide policy gives a Full Refund at least 48 hours before the first shift; later Customer Cancellation and No-Show are non-refundable. Owner Cancellation and Administrator Cancellation always give a Full Refund.
- The target Marketplace Commission is 12% of the Booking Price, deducted from Owner Payout and subject to Licensed Payment Provider pricing.
- A suitable Licensed Payment Provider licensed by CBI is a launch gate; there is no cash, offline or unpaid fallback in the MVP.
- Owner identity, authority-to-rent and local compliance evidence are reviewed outside the product; the MVP stores the approval outcome, not sensitive source documents.

## Granular behaviour catalogue

### Customer discovery and identity

1. As a customer, I want to browse Published Cottages without creating an account, so that I can explore with minimal friction.
2. As a customer, I want the marketplace to work comfortably in a mobile browser, so that I can use it while travelling or away from a computer.
3. As an Arabic-speaking customer, I want a complete right-to-left experience, so that the marketplace feels natural and legible.
4. As a Sorani-speaking customer, I want a complete right-to-left Kurdish experience, so that I can use the marketplace in my preferred language.
5. As an English-speaking customer, I want a complete left-to-right experience, so that I can use the marketplace in English.
6. As a customer, I want to switch language without losing my current page or booking selections, so that localisation does not interrupt my task.
7. As a customer, I want to search approved inventory anywhere in Iraq, so that I am not artificially restricted to Baghdad.
8. As a customer, I want locations organised by governorate and local area, so that I can find relevant inventory even when formal addresses are inconsistent.
9. As a customer, I want to search by date, shifts, party size and key amenities, so that results match my intended visit.
10. As a customer, I want results to contain only cottages whose complete Booking Period is available, so that I do not request unavailable inventory.
11. As a customer, I want to see the Cottage Profile, photos, capacity, rooms, amenities and House Rules, so that I can judge suitability.
12. As a customer, I want free-text Cottage content available in Arabic, Sorani and English, so that the listing remains meaningful in every launch language.
13. As a customer, I want to see only an Approximate Location before confirmation, so that Cottage Owner privacy and property security are protected.
14. As a customer, I want Public Availability without another customer's identity or an owner's private block reason, so that operational data remains private.
15. As a customer, I want to verify my phone only when submitting my first request, so that browsing remains anonymous.
16. As a returning customer, I want my verified phone number to identify my Customer Account, so that I can retrieve my bookings without managing a password.

### Shift selection and pricing

17. As a customer, I want to see each cottage's two or three fixed Cottage Shifts with clear start and end times, so that I understand what I am booking.
18. As a customer, I want a cross-midnight evening shift labelled by its start date, so that dates remain unambiguous.
19. As a customer, I want to select one or more available shifts on a Service Day, so that I can book the time I need.
20. As a customer, I want to choose a Full-Day Bundle with continuous access between the first and last shift, so that I can reserve the entire operating day.
21. As a customer, I want consecutive Full-Day Bundles to provide continuous access between days, so that a multi-day booking does not require overnight departure and re-entry.
22. As a customer, I want one Booking Request to cover selections across consecutive Service Days, so that a multi-day visit remains one booking.
23. As a customer, I want the Full-Day Bundle to become unavailable when any component shift is unavailable, so that overlapping bookings cannot occur.
24. As a customer, I want to see the applicable standard, day-of-week or specific-date price before requesting, so that holiday and weekend pricing is transparent.
25. As a customer, I want the specific-date price to override recurring and standard prices, so that the quoted amount is deterministic.
26. As a customer, I want the Full-Day Bundle to have its own price, so that it need not equal the sum of individual shifts.
27. As a customer, I want the Booking Price to equal the sum of my selected applicable prices, so that the calculation is understandable.
28. As a customer, I want one final Booking Price without an added RentCottage fee at checkout, so that there are no surprise platform charges.
29. As a customer, I want the quoted price and applicable commission rate preserved in the Booking Snapshot, so that later pricing changes cannot affect my request.

### Booking request and payment

30. As a customer, I want to provide my name, total guest count and an optional Booking Note, so that the Cottage Owner has appropriate request context.
31. As a customer, I want capacity checked before submission, so that I cannot request a cottage too small for my party.
32. As a customer, I want to accept the recorded House Rules and marketplace terms before submitting, so that the agreement is explicit.
33. As a customer booking inside the 48-hour cancellation boundary, I want a prominent non-refundable warning before Payment Authorization, so that the consequence is clear.
34. As a customer, I want full-payment authorization to succeed before my request is submitted, so that an unpaid request never appears successful.
35. As a customer, I want payment failure to leave availability unblocked and let me retry, so that no false Pending Hold is created.
36. As a customer, I want my successful Booking Request to place one exclusive Pending Hold across every selected shift, so that another customer cannot claim part of it.
37. As a customer, I want the owner to respond within four hours, so that my request does not remain pending indefinitely.
38. As a customer, I want new requests to close six hours before the first shift, so that there is time for an owner decision, payment recovery and travel.
39. As a customer, I want to withdraw a pending request and immediately release its Payment Authorization and Pending Hold, so that I can change plans before confirmation.
40. As a customer, I want pending requests to remain immutable, so that the owner always decides against a stable Booking Snapshot.
41. As a customer, I want to receive an immediate accepted, declined or expired notification, so that I do not need to poll the application.
42. As a customer, I want a Decline Reason when an owner rejects my request, so that I understand the outcome.
43. As a customer, I want a declined or expired request to release the Payment Authorization rather than charge and refund me, so that unnecessary transactions are avoided.
44. As a customer, I want owner acceptance to capture the full authorized amount, so that payment and confirmation remain linked.
45. As a customer, I want a failed Payment Capture to give me 15 minutes to provide a valid payment method, so that a recoverable payment problem does not immediately lose the booking.
46. As a customer, I want a failed 15-minute payment recovery to expire without confirmation, so that I am never told an unpaid booking is confirmed.
47. As a customer, I want confirmation only after owner acceptance and successful Payment Capture, so that the booking promise is reliable.
48. As a customer, I want confirmation to release the exact Access Details, mutual contact information and a unique booking reference, so that I can prepare and coordinate.
49. As a customer, I want payment-provider downtime to prevent request submission without enabling cash or unpaid fallback, so that the payment record remains complete.
50. As a customer, I want to be prevented from holding overlapping active requests or bookings at different cottages, so that I cannot accidentally create multiple full charges for the same time.

### Cancellations, reminders and history

51. As a customer, I want a Full Refund when I cancel at least 48 hours before my first shift, so that the marketplace policy is predictable.
52. As a customer, I want the policy to state that cancellation inside 48 hours is non-refundable, so that I understand the risk before confirmation.
53. As a customer, I want a No-Show treated as non-refundable, so that the consequence is explicit.
54. As a customer, I want an Owner Cancellation to produce a Full Refund regardless of timing, so that I do not bear the owner's failure to provide the cottage.
55. As a customer, I want an Administrator Cancellation for safety, fraud, legal or serious operational reasons to produce a Full Refund, so that platform intervention does not cost me.
56. As a customer, I want a Full Refund to return the entire Booking Price, so that provider fees are not deducted from my refund.
57. As a customer, I want a reminder 24 hours before the first shift with my booking reference and Access Details, so that I have the information needed to arrive.
58. As a customer, I want to see pending, confirmed, declined, expired, withdrawn, cancelled and completed records, so that my Booking History is dependable.
59. As a customer, I want a Payment Dispute handled using preserved booking evidence, so that the provider receives an accurate record.
60. As a customer, I understand that an accommodation-quality complaint does not guarantee an automatic refund, so that the support promise is not misleading.

### Cottage Owner operations

61. As a Cottage Owner, I want to join by invitation and phone verification, so that the marketplace remains controlled.
62. As a Cottage Owner, I want to accept versioned owner terms before publishing, so that participation conditions are explicit.
63. As a Cottage Owner, I want to manage several cottages from one Owner Account, so that multi-property operations are supported.
64. As a Cottage Owner, I want to submit evidence of identity, authority to rent and applicable local compliance outside the product, so that sensitive documents are not stored in the MVP.
65. As a Cottage Owner, I want my approval status and review date recorded, so that onboarding has a durable outcome.
66. As a Cottage Owner, I want to create a complete Cottage Profile in any Launch Language, so that I can start with the language I use.
67. As a Cottage Owner, I want RentCottage to require approved Arabic, Sorani and English content before publication, so that every customer receives a complete listing.
68. As a Cottage Owner, I want previously approved content to remain live while translations and edits are reviewed, so that my cottage does not disappear during moderation.
69. As a Cottage Owner, I want all language versions of a Content Change published together, so that customers never see mixed or unreviewed versions.
70. As a Cottage Owner, I want to define one recurring schedule of two or three non-overlapping Cottage Shifts, so that the calendar reflects how my cottage operates.
71. As a Cottage Owner, I want to choose turnaround gaps without a marketplace-wide minimum, so that I remain responsible for preparation time.
72. As a Cottage Owner, I want Shift Schedule changes to apply prospectively without altering pending or confirmed records, so that booking evidence remains stable.
73. As a Cottage Owner, I want every shift closed by default on initial publication, so that inventory never becomes bookable accidentally.
74. As a Cottage Owner, I want to open individual shifts deliberately and create Private Blocks, so that online and off-platform commitments cannot conflict.
75. As a Cottage Owner, I want to set standard, recurring day-of-week and specific-date prices for Cottage Shifts and Full-Day Bundles, so that pricing matches demand.
76. As a Cottage Owner, I want price and availability updates to take effect without content-review delay, so that routine operations remain responsive.
77. As a Cottage Owner, I want a new-request notification and four-hour Response Deadline, so that I can respond promptly.
78. As a Cottage Owner, I want to see the customer's name, party size, Booking Period, Booking Note and preserved Booking Snapshot while deciding, so that I can evaluate the request.
79. As a Cottage Owner, I want the customer's phone number hidden while the request is pending, so that contact begins only after confirmation.
80. As a Cottage Owner, I want to accept or decline the complete immutable request, so that I never approve only part of a Booking Period.
81. As a Cottage Owner, I want to provide a structured Decline Reason and optional note, so that the outcome is useful to the customer.
82. As a Cottage Owner, I want Payment Capture to follow acceptance, so that confirmation is backed by full payment.
83. As a Cottage Owner, I want to be told when Payment Capture fails or payment recovery expires, so that I do not mistake an unpaid request for a booking.
84. As a Cottage Owner, I want my Owner Calendar to distinguish open shifts, Private Blocks, Pending Holds and Confirmed Bookings, so that availability is understandable.
85. As a Cottage Owner, I want a reminder 24 hours before the first shift, so that I can prepare the cottage.
86. As a Cottage Owner, I want my Owner Payout to become eligible after the Booking Period completes, so that settlement follows delivery.
87. As a Cottage Owner, I want a non-refundable late cancellation or No-Show to produce my normal net payout after the scheduled end, so that reserved inventory is compensated.
88. As a Cottage Owner, I want the applicable Marketplace Commission preserved per booking, so that later rate changes do not rewrite earnings.
89. As a Cottage Owner, I want the customer-facing Booking Price to include RentCottage commission, so that no separate platform surcharge discourages checkout.
90. As a Cottage Owner, I want to provide a reason when I cancel a Confirmed Booking, so that the customer and platform receive an accountable record.
91. As a Cottage Owner, I understand that my cancellation gives the customer a Full Refund and no Owner Payout, so that the consequence is explicit.
92. As a Cottage Owner, I want repeated or unjustified cancellations reviewed, so that unreliable inventory does not damage marketplace trust.
93. As a Cottage Owner, I want to pause a cottage only after resolving Pending Holds, so that waiting customers receive an outcome.
94. As a Cottage Owner, I want existing booking records preserved when a cottage is paused or deactivated, so that history remains reliable.

### Platform administration and support

95. As a Platform Administrator, I want separate email-and-multi-factor access, so that privileged accounts are distinct from customer and owner identities.
96. As a Platform Administrator, I want to approve invited Cottage Owners and record the review result, so that marketplace participation remains controlled.
97. As a Platform Administrator, I want to approve new Cottage Profiles and complete multilingual Content Changes, so that customer-visible information is reviewed.
98. As a Platform Administrator, I want to compare currently published content with proposed changes, so that review decisions are informed.
99. As a Platform Administrator, I want to see relevant booking lifecycle and payment states, so that I can support customers and owners.
100. As a Platform Administrator, I want to record a Booking Incident without publishing it as a Customer Review, so that sensitive operational evidence remains restricted.
101. As a Platform Administrator, I want to cancel a booking only for a required safety, fraud, legal or serious operational reason, so that intervention is accountable.
102. As a Platform Administrator, I want approvals, changes, cancellations, pauses, deactivations and incidents attributed and timestamped, so that privileged actions are auditable.
103. As a Platform Administrator, I want to pause or deactivate unsafe, fraudulent or non-compliant owners and cottages, so that they cannot receive new requests.
104. As a Platform Administrator, I want booking and audit history preserved after deactivation, so that evidence is not erased.
105. As a RentCottage support operator, I want one visible support contact and structured Booking Incident records, so that reports are traceable.
106. As a RentCottage support operator, I want to distinguish support complaints from formal Payment Disputes, so that each follows the correct process.
107. As a RentCottage support operator, I want preserved Booking Snapshots, terms, payment events and cancellation records available for provider disputes, so that chargeback evidence is complete.
108. As a RentCottage stakeholder, I want public launch blocked until at least ten approved cottages are ready, so that discovery has useful inventory.
109. As a RentCottage stakeholder, I want public launch blocked until a suitable Licensed Payment Provider is contracted and validated, so that the agreed funds flow is viable.
110. As a RentCottage stakeholder, I want online-payment willingness tested through field research, so that the launch assumption can be revisited if evidence contradicts it.

## Delivery capability map

This map is a sequencing aid, not a set of final tickets. `$to-tickets` should normally establish one thin end-to-end path, then expand it with adjacent behaviours and failure paths.

1. **Marketplace foundation:** responsive web surfaces, Arabic/Sorani RTL, English LTR, locale switching, Iraq local time and Iraqi-dinar presentation.
2. **Controlled supply:** invited owner access, external verification record, Cottage Profile submission, multilingual content approval and publication.
3. **Inventory and prices:** Shift Schedule, safe default closure, opening availability, Private Blocks, price precedence and Full-Day Bundle conflicts.
4. **Customer discovery:** anonymous browsing, structured location, filters, complete-period availability, Cottage Profile and privacy-safe availability.
5. **Quoted selection:** Cottage Shift and Full-Day Bundle selection across consecutive Service Days, deterministic Booking Price and Booking Snapshot inputs.
6. **Request submission:** phone verification, party capacity, House Rules and terms acceptance, Payment Authorization, Booking Request and atomic Pending Hold.
7. **Owner decision:** immediate notification, four-hour deadline, privacy-safe request detail, complete accept/decline decision and Decline Reason.
8. **Payment completion:** Payment Capture after acceptance, Payment Required recovery, confirmation only after payment and authorization release on non-confirming outcomes.
9. **Confirmed access:** Booking Confirmation, unique reference, Access Details, mutual contact release and reminders.
10. **Lifecycle management:** withdrawal, expiry, customer cancellation, Owner Cancellation, Administrator Cancellation, No-Show, completion and Booking History.
11. **Settlement and disputes:** commission snapshot, Owner Payout eligibility, Full Refund, provider fee handling, Payment Dispute evidence and support boundaries.
12. **Marketplace control:** administrator audit, Booking Incidents, pause/deactivation, preserved history and launch gates.

## Verification expectations

Tickets derived from this specification should verify observable behaviour at the narrowest reliable seam. At minimum, the resulting ticket set must cover:

- complete Booking Period availability and conflict behaviour, including Full-Day Bundles and cross-midnight Cottage Shifts;
- atomic creation and release of Payment Authorization, Booking Request and Pending Hold;
- competing-customer and same-customer overlap prevention using production-equivalent persistence semantics;
- every request outcome: accepted and captured, declined, expired, withdrawn, Payment Required recovered and Payment Required expired;
- disclosure boundaries before request, while pending and after confirmation;
- 48-hour cancellation boundaries, Full Refund calculations, No-Show and owner/administrator consequences;
- price precedence and preservation of price, commission, schedule, content, House Rules and accepted terms;
- Arabic and Sorani RTL behaviour, English LTR behaviour and locale switching without losing state;
- role-specific calendar/history visibility and preservation after pause or deactivation;
- administrator attribution, timestamps and restricted Booking Incident evidence;
- launch gates for inventory, payment-provider capability and field research.

Provider-specific adapters should be tested separately once selected. Do not invent a payment workaround when the Licensed Payment Provider cannot support the agreed lifecycle; reopen the product decision instead.

## Current board warning

GitHub issue `#1` and the implementation tickets derived from it predate the approved Shift Schedule, multilingual launch and online-payment lifecycle. They remain historical planning records until deliberately replaced. Do not begin implementation from those tickets unchanged.

Running `$to-tickets` from this document is a separate action. It should happen only after the client PRD is signed off or after the delivery team explicitly accepts the risk of planning against a proposed PRD.
