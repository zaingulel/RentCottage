# RentCottage MVP Internal Delivery Specification

**Status:** Approved delivery baseline following client sign-off
**Updated:** 4 August 2026
**Client agreement:** `docs/product/rentcottage-mvp-prd.md`
**Domain language:** `CONTEXT.md`
**Technical decision:** `docs/adr/0001-cloudflare-workers-supabase-stack.md`

## Purpose and source precedence

This document preserves the low-level behaviour needed for design, implementation, tests and ticket slicing. It is intentionally more granular than the client Product Agreement.

Use the sources in this order:

1. The signed client Product Agreement defines the external promise.
2. This delivery specification defines the detailed behaviour and failure paths.
3. `CONTEXT.md` defines the project language and state meanings.
4. The architecture decision defines the approved technical baseline.

If these sources conflict, stop and reconcile them before implementation. Do not make the client-facing stories larger merely because several detailed stories describe one client capability.

## Approved product constraints

- Approved cottages may operate anywhere in Iraq. Public launch requires at least ten real approved cottages, preferably in two demand areas.
- The MVP is a mobile-friendly web application in Arabic, Sorani Kurdish and English.
- Arabic and Sorani use right-to-left presentation. English uses left-to-right presentation.
- Customers browse anonymously and verify a phone number before sending their first message or submitting their first request.
- Cottage owners apply directly and prepare a private first Cottage Profile as part of the Owner Application. Approval is manual and must complete before publication or booking access.
- A complete Owner Application has a three-day review target. Requests for missing information pause the target.
- Each cottage uses two or three fixed daily Cottage Shifts. Customers may select several shifts or a separately priced Full-Day Bundle.
- Bookings use request-to-book. The Response Deadline is four hours and the Booking Request Cut-Off is six hours before the first shift.
- The customer authorises the full Customer Total before sending a request. Owner acceptance triggers automatic Payment Capture.
- A failed capture starts a 20-minute Payment Required recovery period. Owner acceptance at any hour does not require the customer to be awake when capture succeeds normally.
- The proposed Booking Service Fee is fixed at IQD 5,000 and is shown separately. It remains subject to customer validation before public launch.
- Marketplace Commission is 10% of Booking Price and is shown to the Cottage Owner before acceptance.
- One cancellation policy applies to every cottage. Customer cancellation at least 48 hours before the first shift receives an automatic Full Refund. Later cancellation and No-Show receive no refund. Owner and administrator cancellations receive an automatic Full Refund.
- Reviews and In-Platform Messaging are included.
- Contact details remain hidden before payment. A phone-verified customer may start messaging from a Cottage Profile before requesting. Pre-payment messages block phone numbers, including common digit and separator variations, plus email addresses, links and social handles. Repeated bypass attempts are flagged; contact sharing is allowed after confirmation.
- Static interface translations are manually prepared with AI assistance where useful, then human reviewed. Dynamic content uses Automatic Translation with `gpt-5.6-luna` as the cost-efficient default. Reported, administrator-flagged or safety-sensitive translations escalate to `gpt-5.6-terra` or human review. The original is preserved and shown on failure, and users can report poor or inappropriate translations.
- Owner identity, authority and licence documents are stored privately with restricted audited access. Legal approval of the document checklist and retention schedule is a launch gate.
- Basic administrator account and cottage search, cottage editing or hiding, suspension or reactivation, operational and finance views, and basic Owner Earnings Summary are included. Complex staff roles, accounting, forecasting and revenue management are excluded.
- Customers and owners cannot edit or reschedule submitted requests or Confirmed Bookings.

## Technical delivery baseline

- TypeScript, React and Next.js deployed to Cloudflare Workers through OpenNext.
- Supabase PostgreSQL, Auth and Storage.
- Row-level security on every customer, owner and administrator data path.
- Supavisor transaction pooling for serverless database connections.
- PostgreSQL transactions and constraints for Pending Hold and booking overlap protection.
- Private verification-document storage with time-limited access and an audit record.
- Narrow replaceable interfaces for payment, AI translation and notification suppliers. OpenAI model names and prompts remain configuration rather than domain logic.
- Vitest for unit and service tests, Playwright for browser journeys, and production-runtime tests in Cloudflare `workerd` preview.
- GitHub Actions for continuous integration and CodeRabbit for pull-request review. Blacksmith is deferred until measured demand justifies it.
- Qi Card is the first payment candidate to validate. It is not selected until sandbox and contract evidence proves the full lifecycle.

## Granular behaviour catalogue

### Marketplace, language and identity foundation

1. As a visitor, I want the public product to load without an account, so that browsing has no registration barrier.
2. As a visitor, I want only Published Cottages returned publicly, so that draft, paused and rejected inventory stays private.
3. As a user, I want Arabic selected from an explicit language control, so that I can use the product in Arabic.
4. As a user, I want Sorani Kurdish selected from the same control, so that I can use the product in Sorani.
5. As a user, I want English selected from the same control, so that I can use the product in English.
6. As an Arabic user, I want interface layout and controls to render right to left, so that navigation feels native.
7. As a Sorani user, I want interface layout and controls to render right to left, so that navigation feels native.
8. As an English user, I want interface layout and controls to render left to right, so that navigation feels native.
9. As a user, I want to change language without losing my page, filters or booking selection, so that translation does not interrupt my task.
10. As a user, I want dates and times interpreted in Iraq time, so that deadlines and cross-midnight shifts are unambiguous.
11. As a user, I want prices shown in Iraqi dinars with consistent formatting, so that totals are easy to compare.
12. As a customer, I want phone verification only when I send my first message or submit my first request, so that browsing remains anonymous.
13. As a returning customer, I want my verified phone to recover my Customer Account and Booking History, so that I do not need a password.
14. As a prospective Cottage Owner, I want phone verification before application submission, so that the applicant identity is reachable.
15. As a Platform Administrator, I want a separate email and multi-factor account, so that privileged access is distinct from marketplace identities.
16. As the platform, I want customer, owner and administrator sessions to resolve to one explicit role context, so that data cannot cross role boundaries.
17. As the platform, I want unauthorised role access denied in both the application and database, so that a changed URL cannot bypass permissions.
18. As an administrator, I want privileged sign-in and sensitive actions auditable, so that account misuse can be investigated.

### Owner application and verification

19. As a prospective Cottage Owner, I want to create an Owner Account without an invitation, so that I can begin an application directly.
20. As an applicant, I want to save a draft application, so that I can collect evidence over several visits.
21. As an applicant, I want to create and save my private first Cottage Profile and see every required owner and cottage field before submission, so that I can apply with the complete page and evidence together.
22. As an individual applicant, I want to upload the required identity evidence, so that RentCottage can verify me.
23. As a company applicant, I want to upload company and authorised-representative evidence, so that RentCottage can verify the legal person and operator.
24. As an applicant, I want to upload title, lease, management or owner-authority evidence, so that RentCottage can verify authority to rent.
25. As an applicant, I want to upload the applicable tourism, municipal, safety or exemption evidence, so that local compliance can be reviewed.
26. As an applicant, I want to provide payout-account evidence that matches the approved owner, so that settlement is directed correctly.
27. As an applicant, I want uploaded verification files to remain private, so that they never appear in ordinary cottage or booking views.
28. As an applicant, I want to submit only a complete application, so that the three-day review target has a clear start.
29. As an applicant, I want to see Draft, Submitted, Needs Information, Under Review, Approved, Rejected, Expired or Suspended status, so that the outcome is clear.
30. As an administrator, I want a submitted application to enter a review queue with its complete timestamp, so that the service target is measurable.
31. As an administrator, I want to request missing information with a reason, so that the applicant knows what to correct.
32. As the platform, I want Needs Information to pause the three-day target and resubmission to resume it, so that the measure is fair.
33. As an administrator, I want to approve or reject an application with a recorded reason, so that the decision is accountable.
34. As an administrator, I want the approval record to preserve reviewer, jurisdiction, evidence types, licence or exemption basis and expiry dates, so that later checks are possible.
35. As the platform, I want approval to unlock owner publication and booking operations without exposing verification files, so that permissions follow the decision.
36. As an authorised verification administrator, I want time-limited access to a source document, so that a permanent public link cannot leak it.
37. As an auditor, I want every verification-document view, download, replacement and deletion recorded, so that sensitive access is traceable.
38. As the platform, I want expired owner or licence evidence to create a renewal task and allow suspension, so that approval does not silently remain valid forever.

### Cottage profile, content and translation

39. As an approved Cottage Owner, I want to continue the first private Cottage Profile from my application and create more profiles, so that one account can manage several properties.
40. As an owner, I want a draft cottage to require capacity, rooms, amenities, photos, approximate location and House Rules, so that publication content is complete.
41. As an owner, I want to provide an exact private location separately from the Approximate Location, so that access can be released only after payment.
42. As an owner, I want to write a description and House Rules in any Launch Language, so that I can start in my strongest language.
43. As the platform, I want the original content and detected or selected source language preserved, so that translation never replaces the source.
44. As the platform, I want draft translations generated for the other Launch Languages by the configured cost-efficient AI model, so that all customer versions can be prepared without making the domain depend on one provider.
45. As an administrator, I want to compare original and generated language versions, so that I can review meaning before approval.
46. As an administrator, I want to correct any language version before approval, so that unsafe or misleading translation can be fixed.
47. As an administrator, I want all required language versions approved together, so that publication is complete in every language.
48. As a user, I want AI-generated dynamic text labelled, the original always available, the original shown when translation fails, and a way to report poor or inappropriate translation, so that generated content never becomes an unexplained blank or unchallengeable result.
49. As the platform, I want owner verification documents excluded from Automatic Translation, so that sensitive files never leave the protected path.
49a. As the platform, I want translations cached by source content, source language, target language and model-and-prompt version, so that identical text is not translated repeatedly and a changed translation configuration creates a fresh result.
49b. As an administrator, I want a reported, administrator-flagged or safety-sensitive translation reprocessed by the stronger configured model or routed for human review, so that inexpensive automatic translation has an accountable escalation path.
50. As an owner, I want a new cottage to remain private until owner and content approval are both complete, so that no partial listing is exposed.
51. As an owner, I want a published cottage's approved content to remain live while an edit is reviewed, so that moderation does not remove the listing.
52. As an administrator, I want to compare the live version with the proposed Content Change, so that the decision is informed.
53. As the platform, I want an approved Content Change published atomically in all languages, so that customers do not see mixed versions.
54. As an administrator, I want to reject a Content Change with a reason while preserving the live version, so that the owner can correct it safely.
55. As an owner, I want content, approval and publication history preserved, so that a Booking Snapshot can reference the correct version.

### Shifts, pricing and availability

56. As an owner, I want one recurring Shift Schedule containing exactly two or three shifts, so that the calendar matches Iraqi cottage practice.
57. As an owner, I want every Cottage Shift to have a name, start time and end time, so that it can be selected clearly.
58. As the platform, I want shifts in one schedule to be non-overlapping, so that the owner cannot create contradictory inventory.
59. As an owner, I want a shift to cross midnight, so that evening operation can end on the following date.
60. As the platform, I want a cross-midnight shift to belong to its start-date Service Day, so that pricing and cancellation boundaries are deterministic.
61. As an owner, I want to choose turnaround gaps without a platform minimum, so that I remain responsible for preparation time.
62. As an owner, I want a Full-Day Bundle to contain all shifts on one Service Day, so that customers can reserve the operating day.
63. As an owner, I want the Full-Day Bundle to have its own price, so that it need not equal the sum of component shifts.
64. As the platform, I want a Full-Day Bundle and its component shifts to conflict in both directions, so that overlapping inventory cannot be sold.
65. As an owner, I want every shift closed when a cottage is first published, so that inventory never opens accidentally.
66. As an owner, I want to open one or more future shifts explicitly, so that only intended inventory is bookable.
67. As an owner, I want to create a Private Block on future open shifts, so that personal use or off-platform bookings cannot conflict.
68. As an owner, I want a Private Block to store no off-platform customer identity, so that unnecessary personal data is avoided.
69. As an owner, I want to set a standard Shift Price for each shift and Full-Day Bundle, so that every open option has a default price.
70. As an owner, I want a day-of-week price to replace the standard price, so that recurring weekend pricing is supported.
71. As an owner, I want a specific-date price to replace the day-of-week and standard prices, so that holiday pricing is deterministic.
72. As the platform, I want price precedence to be specific date, then day of week, then standard, so that one amount always wins.
73. As an owner, I want price and future availability changes to take effect without content approval, so that routine operations are responsive.
74. As an owner, I want Shift Schedule changes to apply only to future unheld inventory, so that active requests and bookings keep their original times.
75. As an owner, I want to be prevented from closing, blocking or repricing a Pending Hold or Confirmed Booking, so that committed records stay stable.
76. As a customer, I want public availability to show only available or unavailable, so that customer identities and private reasons remain hidden.
77. As an owner, I want my calendar to distinguish open shifts, Private Blocks, Pending Holds and Confirmed Bookings, so that each unavailable state is understandable.
78. As the platform, I want one transactional operation to create or reject a hold across the complete Booking Period, so that partial holds cannot occur.
79. As the platform, I want database-level overlap protection under competing requests, so that simultaneous customers cannot double-book the cottage.

### Discovery, selection and quote

80. As a customer, I want to search across all approved Iraqi inventory, so that I am not limited to Baghdad.
81. As a customer, I want locations organised by governorate and local area, so that inconsistent street addresses do not block discovery.
82. As a customer, I want to filter by Service Day and Cottage Shift, so that results match the intended visit.
83. As a customer, I want to filter by party size, so that results meet capacity.
84. As a customer, I want to filter by key amenities, so that I can narrow suitable cottages.
85. As a customer, I want results to include only cottages whose complete selected period is available, so that a request will not fail after browsing.
86. As a customer, I want a Cottage Profile to show photos, capacity, rooms, amenities, House Rules and Approximate Location, so that I can judge suitability.
87. As a customer, I want to see every offered shift with its start and end time, so that the booking unit is clear.
88. As a customer, I want to select one or more shifts on one Service Day, so that I can reserve the time I need.
89. As a customer, I want to select shifts across consecutive Service Days in one request, so that a multi-day visit remains one booking.
90. As a customer, I want to select consecutive Full-Day Bundles with continuous access between days, so that overnight departure is not implied.
91. As a customer, I want unavailable component shifts to make the Full-Day Bundle unavailable, so that an overlapping option is never offered.
92. As a customer, I want the applicable price shown for every selected shift or bundle, so that overrides are transparent.
93. As a customer, I want Booking Price to equal the sum of selected applicable prices, so that the calculation can be explained.
94. As a customer, I want the IQD 5,000 Booking Service Fee shown separately, so that it is not mistaken for cottage price or payment processing.
95. As a customer, I want Customer Total to equal Booking Price plus Booking Service Fee, so that the authorised amount is exact.
96. As the platform, I want Booking Price, service fee, Customer Total, commission, schedule, content, rules and terms preserved in the Booking Snapshot, so that later edits do not rewrite the agreement.

### Request, authorisation, owner decision and capture

97. As a customer, I want to enter my name, party size and optional Booking Note, so that the owner has useful request context.
98. As the platform, I want party size validated against preserved cottage capacity, so that an oversized request cannot be submitted.
99. As a customer, I want to accept the preserved House Rules and booking terms, so that consent is explicit and versioned.
100. As a customer inside the 48-hour boundary, I want a prominent no-refund warning before authorisation, so that immediate non-refundability is clear.
101. As the platform, I want new requests rejected inside six hours of the first shift, so that the owner response and payment flow remain viable.
102. As a customer, I want the full Customer Total authorised and reserved before the request is created, so that acceptance can collect payment without waking me.
103. As a customer, I want a failed authorisation to create neither Booking Request nor Pending Hold, so that availability remains open.
104. As the platform, I want authorisation, Booking Request and Pending Hold creation coordinated idempotently, so that retries cannot duplicate a request or hold.
105. As a customer, I want one Pending Hold across every selected shift after successful submission, so that another customer cannot claim part of it.
106. As the platform, I want an active request blocked when it overlaps another active request or booking from the same customer, so that the customer cannot risk two charges for the same time.
107. As an owner, I want an immediate request notification with a four-hour deadline, so that action is prompt.
108. As an owner, I want to see name, party size, Booking Note, Booking Period, preserved price and House Rules, so that I can decide from stable information.
109. As an owner, I want the customer's phone, email and exact direct contact hidden while pending, so that the parties cannot bypass payment.
110. As an owner, I want the 10% commission amount and expected payout shown before acceptance, so that the financial outcome is clear.
111. As an owner, I want to accept or decline the complete immutable request, so that partial acceptance cannot alter the agreement.
112. As an owner, I want a structured Decline Reason and optional note required on decline, so that the customer receives an explanation.
113. As the platform, I want a decline to release the authorisation and Pending Hold, so that no charge or refund is created.
114. As the platform, I want an unanswered request to expire at the Response Deadline, so that the hold and authorisation are released automatically.
115. As a customer, I want to withdraw a pending request before owner decision, so that the hold and authorisation are released immediately.
116. As the platform, I want owner acceptance to trigger automatic capture of the authorised Customer Total, so that the customer does not need to be awake.
117. As the platform, I want a successful capture to create one Confirmed Booking and retain the hold as confirmed inventory, so that payment and availability cannot diverge.
118. As a customer, I want confirmation only after capture succeeds, so that acceptance alone is never presented as a booking.
119. As a customer, I want a failed capture to start a 20-minute Payment Required period with clear notification, so that a recoverable failure can be fixed.
120. As a customer, I want a replacement payment attempt during Payment Required, so that the booking can confirm if collection succeeds.
121. As the platform, I want the original shifts held during Payment Required, so that recovery cannot lose part of the booking.
122. As the platform, I want Payment Required to expire after 20 minutes and release the hold, so that unpaid inventory returns to sale.
123. As an owner, I want to see capture success, Payment Required and expiry distinctly, so that I never mistake an unpaid acceptance for a booking.
124. As the platform, I want signed payment events verified and replayed idempotently, so that duplicates and forged callbacks cannot change booking state.
125. As the platform, I want payment-provider downtime to stop new requests without enabling cash or unpaid fallback, so that the payment record remains complete.

### Confirmation, contact and messaging

126. As a customer, I want a unique booking reference after successful capture, so that support can identify the booking.
127. As a customer, I want confirmation to include the preserved shifts, price breakdown and House Rules, so that the paid agreement is visible.
128. As a customer, I want exact directions, map pin and owner contact details released after payment, so that I can prepare and coordinate.
129. As an owner, I want the confirmed customer's contact details after payment, so that direct coordination is allowed only for a real booking.
130. As a customer, I want status notifications for accepted and paid, declined, expired, withdrawn and payment failure outcomes, so that I do not need to poll.
131. As a phone-verified customer, I want to start one text conversation from a Cottage Profile before requesting and continue it through the Booking Request and Confirmed Booking, so that practical questions stay in one context.
132. As an owner, I want to reply only within conversations for cottages I manage, so that another owner's messages are inaccessible.
133. As a participant, I want phone numbers blocked before payment across Western, Arabic and Persian digits and common spaces, dashes, brackets and country-code formats, so that simple disguises cannot bypass RentCottage.
134. As a participant, I want email addresses, web links and social handles blocked before payment, so that alternative contact routes are also protected.
135. As a participant, I want a clear explanation when a message is blocked, so that I can rewrite it without contact information.
136. As a confirmed participant, I want contact information and links allowed after payment, so that coordination can move to the most practical channel.
137. As a participant, I want messages automatically translated into my selected language with the original available, failure falling back to the original and reported results entering the escalation path, so that meaning can be checked.
138. As support, I want authorised access to a reported conversation and repeated contact-bypass attempts, so that message evidence and repeated evasion can be reviewed.
139. As the platform, I want a booking conversation to become read-only seven days after the Booking Period, so that the operational window has a clear end.

### Reminders, cancellation, refund and completion

140. As a customer, I want a reminder 24 hours before the first shift with reference and Access Details, so that I can arrive prepared.
141. As an owner, I want a reminder 24 hours before the first shift, so that I can prepare the cottage.
142. As a customer, I want pending, confirmed, declined, expired, withdrawn, cancelled and completed records in Booking History, so that every outcome is traceable.
143. As an owner, I want upcoming, current and past bookings per cottage, so that operations are organised.
144. As a customer, I want cancellation at least 48 hours before the first shift to trigger an automatic Full Refund, so that the shared policy needs no manual intervention.
145. As a customer, I want Full Refund to include Booking Price and Booking Service Fee, so that the word full is accurate.
146. As a customer, I want cancellation inside 48 hours to show no refund before confirmation, so that the late consequence is explicit.
147. As the platform, I want a No-Show recorded as non-refundable, so that the payout outcome is deterministic.
148. As an owner, I want cancellation of a Confirmed Booking to require a reason, so that the failure is accountable.
149. As the platform, I want Owner Cancellation to trigger an automatic Full Refund and no Owner Payout, so that the customer does not bear owner failure.
150. As an administrator, I want cancellation limited to recorded safety, fraud, legal or serious operational reasons, so that intervention is accountable.
151. As the platform, I want Administrator Cancellation to trigger an automatic Full Refund and no Owner Payout, so that platform intervention does not cost the customer.
152. As an administrator, I want to approve and record a full or partial Manual Refund Exception with its amount and reason, so that exceptional customer service remains possible without changing the standard policy.
153. As the platform, I want a refund request and provider result tracked separately, so that pending, succeeded and failed refunds are not confused.
154. As the platform, I want repeated refund events handled idempotently, so that a customer cannot be refunded twice.
155. As the platform, I want a Confirmed Booking to complete automatically at the end of its Booking Period unless an incident blocks completion, so that payout and review eligibility have a clear trigger.

### Reviews, owner earnings and settlement

156. As a customer, I want one review opportunity only after a Completed Booking, so that reviews come from genuine stays.
157. As a customer, I want to submit one-to-five stars with optional written text within 14 days, with contact details and external links rejected, so that feedback is structured, timely and cannot become a public contact exchange.
158. As the platform, I want a second customer review for the same booking rejected, so that one booking has one customer verdict.
159. As an owner, I want to post one public reply without contact details or external links, so that I can respond once without creating a thread or contact exchange.
160. As a reader, I want reviews and replies translated with the original available, failure falling back to the original and reported results entering the escalation path, so that multilingual feedback remains trustworthy.
161. As an administrator, I want to hide a review or reply with a moderation reason, including prohibited contact information or external links, so that rule-breaking content is removed from public view without erasing evidence.
162. As an owner, I want Booking Price, 10% commission, refund outcome and expected payout shown per booking, so that earnings are explainable.
163. As an owner, I want simple totals for expected and paid payouts, so that I can reconcile bookings without an analytics suite.
164. As the platform, I want commission calculated from Booking Price rather than Customer Total, so that the Booking Service Fee is not included in the 10% basis.
165. As the platform, I want commission rate, amount and owner net preserved in the Booking Snapshot, so that later commercial changes do not rewrite earnings.
166. As an owner, I want payout eligibility only after the Booking Period completes, so that settlement follows delivery.
167. As an owner, I want a non-refundable late cancellation or No-Show to produce the normal net payout after the scheduled end, so that held inventory is compensated.
168. As the platform, I want a Full Refund, dispute or administrator hold to block or reverse payout eligibility, so that owner settlement follows the final outcome.
169. As support, I want payment disputes to use the preserved Booking Snapshot, payment events, cancellation records, messages and incidents, so that provider evidence is complete.

### Administration, moderation and basic reporting

170. As an administrator, I want one dashboard with searchable customer accounts, owner accounts and cottage profiles alongside applications, content approvals, active requests, bookings, refunds and incidents, so that records and urgent work are easy to find.
171. As an administrator, I want simple totals for booking count, gross Booking Price, service fees, commission, refunds and owner payout, so that marketplace money can be monitored.
172. As an administrator, I want date and status filters on operational and financial lists, so that a relevant period can be investigated.
173. As an administrator, I want booking-level price, payment, refund and payout detail, so that a total can be explained.
174. As an administrator, I want a simple export of filtered booking and money records, so that accountants and advisers can work outside the product.
175. As an administrator, I want to record a restricted Booking Incident, so that safety, fraud, property, payment and service evidence stays separate from public reviews.
176. As an administrator, I want to distinguish a support complaint from a formal Payment Dispute, so that each follows the correct path.
177. As an administrator, I want to edit or hide cottage content with a recorded reason, so that inaccurate or non-compliant public information can be corrected without erasing history.
178. As an administrator, I want to suspend or reactivate a customer, owner or cottage, so that unsafe, fraudulent or non-compliant access and inventory can be controlled.
179. As the platform, I want suspension or deactivation to resolve pending requests while preserving confirmed bookings, payment evidence, messages, reviews and audit history, so that waiting customers receive an outcome and operational evidence is not erased.
180. As an auditor, I want owner approvals, content decisions, cancellations, refunds, moderation, pauses and incidents attributed and timestamped, so that privileged actions are accountable.
181. As a support operator, I want one visible customer support route, so that customers and owners know where to report a problem.
182. As the platform, I want administrator views to exclude source verification files unless the account has verification access, so that basic support access is not over-privileged.

### Launch gates and research validation

183. As a stakeholder, I want public launch blocked until ten real cottages are approved, so that discovery has useful inventory.
184. As a stakeholder, I want online-payment willingness and the IQD 5,000 service fee tested with prospective Iraqi customers, so that the launch assumption has evidence.
185. As a stakeholder, I want a licensed provider to prove authorisation, reservation, later capture, release, refunds, disputes and lawful owner settlement, so that the payment promise is viable.
186. As a stakeholder, I want the owner evidence checklist and retention schedule approved by qualified Iraqi and Kurdistan Region advice, so that sensitive storage has a lawful rule.
187. As a stakeholder, I want Arabic and Sorani Automatic Translation quality tested with native-language reviewers across cottage content, rules, messages and reviews, so that the default and escalation paths are demonstrably usable and safe.
188. As a stakeholder, I want cancellation, refund, customer, owner and support terms approved before launch, so that the product behaviour and written agreement match.

## Delivery capability map

This is a sequencing aid, not a set of final tickets. Use a thin end-to-end path first, then expand it with adjacent behaviour and failure paths.

1. **Production foundation:** application shell, Cloudflare deployment, Supabase connection, environment boundaries and GitHub Actions.
2. **Identity and security:** customer, owner and administrator authentication, role resolution, row-level security and audit base.
3. **Owner application:** self-service application, private documents, review queue, three-day target and approval permissions.
4. **Cottage publication:** profile, media, multilingual source and generated content, approval and version history.
5. **Inventory and pricing:** Shift Schedule, safe closure, opening, Private Blocks, Full-Day Bundle conflicts and price precedence.
6. **Customer discovery:** Iraq locations, filters, complete-period availability, profile, language direction and privacy-safe location.
7. **Quote and request:** selection, Customer Total, Booking Snapshot, phone verification, terms, authorisation and atomic Pending Hold.
8. **Owner decision and payment:** notification, deadline, commission view, accept or decline, capture and 20-minute recovery.
9. **Confirmation and communication:** reference, Access Details, contact release, protected messaging, translation and reminders.
10. **Lifecycle:** withdrawal, expiry, cancellation, refund, No-Show, completion and Booking History.
11. **Trust and settlement:** reviews, moderation, commission, Owner Earnings Summary, payout and disputes.
12. **Marketplace operations:** basic dashboard, finance totals, export, incidents, pause, deactivation and launch gates.

## Verification expectations

Every ticket must verify observable behaviour at the narrowest reliable seam. The complete ticket set must include:

- unit and service tests for price, fee, commission, deadline and state-transition rules;
- database tests that prove row-level security denies cross-customer, cross-owner and unprivileged administrator access;
- database tests for complete-period overlap, Full-Day Bundle conflict and same-customer conflict under concurrent transactions;
- private-storage tests for unauthorised document access, expiring access and audit creation;
- payment contract tests for signed events, replay, out-of-order delivery, duplicate capture, release and duplicate refund;
- translation contract tests that preserve originals, show the original on failure, support translation reports, route escalations, invalidate cached results when the model or prompt version changes, and exclude verification documents;
- a representative Arabic and Sorani evaluation set covering descriptions, house rules, informal messages, reviews, place names, prices, dates and shifts, reviewed by native speakers before launch;
- message-filter tests covering Western, Arabic and Persian digits, common separators, country codes and repeated bypass attempts;
- review tests proving written text is optional and contact details or external links are rejected from reviews and replies;
- administrator tests for account and cottage search, audited cottage editing or hiding, and suspension or reactivation;
- browser journeys in Arabic, Sorani and English at a mobile viewport;
- browser journeys for application, publication, discovery, request, owner decision, payment recovery, cancellation, messaging and review;
- Cloudflare `workerd` preview tests for all server features that depend on runtime behaviour;
- deployment checks for migrations, environment secrets, health, rollback and production smoke tests;
- launch-gate evidence for inventory, provider capability, customer research, legal document handling and native-language translation review.

Provider-specific adapters must be validated separately once selected. Do not invent an unsupported payment workaround. If the provider cannot meet the agreed lifecycle, reopen the product decision.

## Ticket-slicing contract

- Start with a deployable thin path that proves Cloudflare, Supabase, authentication, one published cottage and one safe read.
- Keep ordinary tickets vertical: include the smallest data, service and user-interface change needed to deliver one observable outcome.
- Create separate foundation tickets only for shared production concerns that cannot be proven responsibly inside one product slice.
- Put row-level security and overlap protection in the first slice that stores the protected data, not in a later hardening backlog.
- Keep supplier and model names out of ordinary product stories. Isolate provider-specific discovery, model selection, prompts and adapters behind the shared payment or translation contract.
- Configure `gpt-5.6-luna` with the lowest supported reasoning effort as the default translation model. Use `gpt-5.6-terra` or human review for reported, administrator-flagged or safety-sensitive results. Treat these as replaceable delivery configuration, not client-facing product vocabulary.
- Cache completed translations using a key that includes source content or hash, source language, target language, model identifier and prompt version. Retain the original and the generated result used for each published or booking-linked record.
- Send only the text and minimum language context needed for translation. Do not send account, booking, payment or verification metadata unless a reviewed requirement makes it necessary. Approve the AI provider's user-content processing, retention and deletion terms before production use.
- Slice happy path, important failure path and operational visibility separately when each can be tested and deployed independently.
- Preserve the client outcome even when one concise client capability becomes several low-level delivery tickets.

## Current tracker warning

GitHub issue `#1` and implementation issues `#2` to `#17` were written before the approved schedule, onboarding, payment, messaging, review and multilingual rules. They are historical planning records and must not be used for implementation unchanged.

Run `$to-tickets` from this delivery specification together with the signed client Product Agreement and `CONTEXT.md`. Draft and review the complete ticket graph before publishing replacements.
