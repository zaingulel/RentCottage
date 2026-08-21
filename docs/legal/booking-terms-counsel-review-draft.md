# RentCottage Booking Terms — counsel-review draft

| Document field | Value |
| --- | --- |
| Status | Counsel-review draft only |
| Legal effect | None |
| Customer-facing | No |
| Effective date | Not assigned |
| Approved version | Not assigned |
| Canonical approver | Not assigned |
| Internal ID | booking-terms-counsel-review-draft-2026-08-21 |

## 1. Status and instructions for use

This document is an internal drafting aid for the owner and qualified counsel in federal Iraq and the Kurdistan Region. It is not legal advice, an approved contract, or a statement that any proposed clause is lawful or enforceable.

Do not:

- link to this draft from checkout or any other customer surface;
- ask a customer to accept it;
- treat it as final Arabic, Sorani Kurdish, or English text;
- assign it an effective date or approved version without the canonical approver's recorded approval; or
- use it to satisfy, unblock, or implement GitHub Issue #32.

Counsel must resolve every CAUTION marker before any operative version is prepared. If authorities conflict, stop and record the conflict. Do not silently choose an answer.

Authority is role-based:

- applicable binding law defines the legal obligations;
- qualified counsel records the interpretation of applicable law but is not itself binding law;
- Issue #32 owns the ticket scope and acceptance criteria;
- the approved RentCottage Minimum Viable Product agreement owns approved product outcomes;
- `CONTEXT.md` owns domain vocabulary and state meanings;
- verified operator, licence, payment-provider, and support records own operational facts;
- the client discovery record is historical;
- the legal research identifies issues for decision; and
- external marketplace material is prior art only.

> [!CAUTION]
> **DECISION REQUIRED — BT-LEGAL-01**
>
> **Owner:** RentCottage owner and qualified federal Iraq and Kurdistan Region counsel
>
> **Question:** What are the operating entity's exact legal name, legal form, registration, business address, e-commerce licence and other required approvals, and verified support contact?
>
> **Proposed position — not approved:** No operative terms should be issued until every identity, address, registration, licence, approval, and support statement can be completed with verified facts.
>
> **Required evidence:** Current company and registration records, Ministry of Trade and regional licensing evidence, relevant sector approvals, and a tested support channel owned by the operating entity.
>
> **Blocks:** Customer-facing terms, launch, Article 7 disclosures, contract formation, and Issue #32.

## 2. Plain summary of the intended product terms

The intended service is a controlled marketplace for booking a whole private Cottage for one Booking Party. A Customer sends a Booking Request rather than receiving an instant booking. The Customer sees the selected Cottage, Booking Period, House Rules, Booking Price, Booking Service Fee, and full Customer Total before authorizing payment.

The settled product flow is:

- new requests close six hours before the first selected Cottage Shift;
- the full Customer Total is authorized before a Booking Request is created;
- the Cottage Owner has four hours to accept or decline;
- a pending request is not a Confirmed Booking;
- owner acceptance triggers payment capture;
- if capture fails, the request enters Payment Required for 20 minutes;
- confirmation occurs only after successful capture;
- there is no cash fallback, customer wallet, damage deposit, or rescheduling;
- off-platform booking payments are prohibited;
- a Customer cancellation at least 48 hours before the first selected Cottage Shift is intended to receive a Full Refund, while a cancellation inside 48 hours or a No-Show is intended to receive no standard refund; and
- an Owner Cancellation or Administrator Cancellation is intended to receive a Full Refund.

All deadlines use Marketplace Time. These are settled product choices. Their legal enforceability, including the 48-hour cancellation outcome and the required order of customer confirmations, remains subject to the CAUTION markers and mandatory customer rights.

## 3. Definitions and preserved booking records

The following words have these intended meanings in this draft:

- **RentCottage** means the marketplace operator, once its legal identity and role are verified.
- **Customer** means the phone-verified person who sends and manages a Booking Request.
- **Customer Account** means the identity created from a verified phone number when a Customer first messages or sends a Booking Request.
- **Cottage Owner** means the approved person or organisation authorized to offer a Cottage through RentCottage.
- **Cottage** means a whole private leisure property, such as a cottage or chalet, booked exclusively by one Customer group. It does not mean a hotel room, shared accommodation, or an event venue.
- **Booking Party** means the Customer and the declared total number of people for the Booking Period.
- **Cottage Shift** means one of the two or three fixed periods offered by a Cottage on a Service Day.
- **Booking Period** means all Cottage Shifts at one Cottage selected and requested together across consecutive Service Days.
- **Marketplace Time** means Iraq local time (UTC+3), which governs dates and deadlines.
- **Booking Request** means an authorized request that is waiting for the Cottage Owner's decision. It is not a Confirmed Booking.
- **Pending Hold** means the temporary exclusive hold over every selected Cottage Shift while the Booking Request or required payment remains pending.
- **Confirmed Booking** means a Booking Request accepted by the Cottage Owner for which the full Customer Total has been successfully captured.
- **Booking Confirmation** means the customer-visible record issued after successful capture with a unique booking reference and the confirmed details.
- **Booking Snapshot** means the preserved record of the Cottage, Booking Period, price, House Rules, cancellation outcome, terms, parties, and customer actions shown when the request was made.
- **House Rules** means the published customer-visible restrictions and expectations for the Cottage.
- **Booking Price** means the Cottage price for the whole Booking Period before the Booking Service Fee.
- **Booking Service Fee** means the separate fixed RentCottage fee displayed before payment authorization.
- **Customer Total** means the full amount authorized and captured: the Booking Price plus the Booking Service Fee.
- **Payment Authorization** means a provider's temporary approval that reserves the Customer Total for later capture. It is not a completed charge or a damage deposit.
- **Payment Capture** means collection of the authorized Customer Total after Owner acceptance.
- **Payment Required** means the 20-minute recovery state used only when capture fails after Owner acceptance.
- **Full Refund** means return of the complete Customer Total, including the Booking Service Fee, to the original payment method.
- **Request Withdrawal** means a Customer ending a pending Booking Request before the Cottage Owner decides.
- **Customer Cancellation** means a Customer ending a Confirmed Booking.
- **Owner Cancellation** means a Cottage Owner ending a Confirmed Booking. The Cottage Owner must provide a reason, the marketplace creates a Booking Incident, and repeated or unjustified cancellations may cause the Cottage to be paused for Platform Administrator review.
- **Administrator Cancellation** means a Platform Administrator ending a Confirmed Booking for a recorded safety, fraud, legal, or serious operational reason. It creates an Administrator Audit Record and Booking Incident.
- **No-Show** means the Customer does not attend the first selected Cottage Shift and did not cancel before it began.
- **Booking Incident** means a restricted operational record of a safety, fraud, property, payment, or serious service problem. It is separate from a complaint, review, and payment dispute.

For each request and booking, the intended records include the verified Customer Account; relevant operator and Owner identities; the selected locale; exact terms version, effective date, and content; the Cottage and listing snapshot; Booking Period; Marketplace Time deadlines; party size; Booking Price, Booking Service Fee, and Customer Total; House Rules; cancellation outcome; customer confirmations; required pre-contract message and its delivery evidence; and payment authorization, capture, release, or refund evidence. The Customer must be able to retrieve, save, and print the exact record that applies to the booking, subject to lawful retention and access controls.

## 4. Roles and service responsibilities

The intended commercial structure is that the Cottage Owner supplies access to and use of the Cottage, while RentCottage operates the marketplace and facilitates the booking and payment lifecycle. The selected licensed payment provider performs the regulated payment operations it has contractually agreed to perform. These descriptions must be changed if the verified legal or operational facts differ.

The proposed structure is a Customer-Cottage Owner accommodation contract, separate from RentCottage's marketplace and payment-facilitation obligations. The accommodation contract would form only after a counsel-approved customer confirmation sequence, Owner acceptance, and successful payment capture. This position is not approved. It must not be used to avoid any duty that law places on RentCottage as principal, intermediary, agent, provider, or electronic trader.

> [!CAUTION]
> **DECISION REQUIRED — BT-LEGAL-02**
>
> **Owner:** Qualified federal Iraq and Kurdistan Region counsel with the RentCottage owner
>
> **Question:** Who is the trader, accommodation supplier, marketplace provider, payment facilitator, principal, intermediary, or agent for each customer duty and each contract?
>
> **Proposed position — not approved:** The Cottage Owner supplies the accommodation under a separate Customer-Owner contract, and RentCottage separately provides marketplace and payment facilitation, with formation only after the approved confirmation sequence, Owner acceptance, and successful capture.
>
> **Required evidence:** Counsel's written role and contract map, verified operator and Owner status, owner terms, provider contract, money-flow description, control over cancellations and refunds, and all required agency or collection authority.
>
> **Blocks:** Party disclosures, Article 13 message, contract formation, payment clauses, liability allocation, customer remedies, and Issue #32.

## 5. Eligibility and authority for the Booking Party

The proposed rule is that a Customer must be at least 18 years old, have legal capacity to contract, use their own verified Customer Account, provide accurate details, and have authority to act for every member of the Booking Party. This position is not approved. Party size must not exceed the Cottage's published capacity. The Customer should ensure that the Booking Party knows and follows the House Rules and safety instructions.

> [!CAUTION]
> **DECISION REQUIRED — BT-OWNER-01**
>
> **Owner:** RentCottage owner with qualified counsel
>
> **Question:** What minimum age, legal-capacity, identity, booking-for-others, and party-authority rules should apply?
>
> **Proposed position — not approved:** Require the Customer to be at least 18, legally capable, acting through their own verified account, and authorized to agree and provide necessary booking information for the Booking Party.
>
> **Required evidence:** Owner decision, counsel confirmation of capacity and consumer-law effects, approved account rules, and a privacy review of information supplied for other people.
>
> **Blocks:** Eligibility clause, account controls, third-party consent position, final interface copy, and Issue #32.

## 6. Booking details, Marketplace Time, price, and snapshot

Before any legally operative customer action, RentCottage should clearly show:

- the Cottage and relevant Cottage Owner identity at the legally required time;
- the complete Booking Period, including every Service Day and Cottage Shift;
- the Cottage's approximate location before confirmation and the point at which exact access details will be released;
- the declared party size and any Booking Note;
- the House Rules and material Cottage information;
- the Booking Price and separate Booking Service Fee;
- confirmation that the Customer Total contains the complete Booking Price and Booking Service Fee, with no undisclosed booking charge;
- the full Customer Total in Iraqi dinars;
- the six-hour request cutoff, four-hour Owner response period, and applicable 48-hour cancellation outcome in Marketplace Time;
- the payment method and provider role once verified; and
- the exact terms and cancellation version the Customer is being asked to consider.

The Customer Total must be the full amount. The current product does not collect a separate damage deposit. Later changes to the Cottage Profile, prices, House Rules, or terms must not rewrite the Booking Snapshot.

## 7. Article 13 message and customer confirmation sequence

The current legal research indicates that Regulation No. 4 of 2025 may require a customer order confirmation, a trader-sent message containing the required pre-contract information, and then a separate customer confirmation of that message before a contract is concluded. Engineering and interface wording must not decide this legal question.

Until counsel approves the sequence, this draft proposes the following non-operative model only: the Customer first asks to review a request; RentCottage then generates and delivers a durable message containing the required service, party, total-price, payment, timing, correction, cancellation, termination, and support information; the Customer separately confirms agreement to that message; only then may payment authorization and submission continue. Counsel must decide whether the first review action, the message delivery channel, the later confirmation, and payment timing meet Article 13.

> [!CAUTION]
> **DECISION REQUIRED — BT-LEGAL-04**
>
> **Owner:** Qualified federal Iraq and Kurdistan Region counsel with product
>
> **Question:** What exact Article 13 message, delivery channel, receipt evidence, two customer actions, and payment-authorization order are required, and when may a contract-capable Booking Request exist?
>
> **Proposed position — not approved:** Use a non-binding review action, deliver a durable Article 13 message, require a separate authenticated customer confirmation of that message, and authorize payment only after the legally required confirmation.
>
> **Required evidence:** Written counsel opinion against the controlling Arabic text, approved interface sequence, complete message content, delivery and receipt rules, evidence and replay requirements, and record-retention decision.
>
> **Blocks:** Contract formation, Booking Terms acceptance, payment authorization, Booking Snapshot evidence, final interface copy, and Issue #32.

## 8. Booking Request lifecycle

A new Booking Request cannot be sent less than six hours before the first selected Cottage Shift. Before the request and Pending Hold are created, the provider must successfully authorize the full Customer Total.

When submission succeeds, one immutable Booking Request and one complete Pending Hold cover the whole selected Booking Period. The Cottage Owner then has four hours to accept or decline. While the request is pending:

- it is not a Confirmed Booking;
- the selected Cottage Shifts are unavailable to competing requests;
- the Customer cannot hold an overlapping active request at another Cottage;
- the Owner sees the Customer's name and party size but not direct contact details;
- the Customer may withdraw the complete request before the Owner decides; and
- neither side may edit or partially accept the request.

If the Customer withdraws, the Owner declines, or the four-hour deadline expires without acceptance, the Booking Request ends, the Pending Hold is released, and the uncaptured Payment Authorization is released. A provider release is not a refund. The Customer's bank or payment provider may take time to show that release, and no exact posting time may be promised until the selected provider proves it.

## 9. Payments

RentCottage's intended payment flow is online only. There is no cash, bank-transfer, pay-on-arrival, or unpaid fallback for a Booking Request. RentCottage will not operate a customer wallet or store the Customer's payment as platform credit.

The Customer authorizes the full Customer Total before the Booking Request exists. Owner acceptance triggers automatic capture of that authorized amount. If capture succeeds, a Confirmed Booking may be created under the counsel-approved formation rule. If capture fails after Owner acceptance, the Pending Hold remains for the 20-minute Payment Required period. The Customer may take only the provider-supported recovery action shown by RentCottage. If capture still does not succeed by the deadline, the request expires without becoming a Confirmed Booking.

An authorization reserves funds but is not a completed charge. A release ends an uncaptured authorization. A capture collects funds. A refund returns captured funds to the original payment method. Customer-facing posting estimates must come from the selected provider's proved service, not from an assumed bank timetable.

> [!CAUTION]
> **DECISION REQUIRED — BT-PROVIDER-01**
>
> **Owner:** RentCottage owner, selected Central Bank of Iraq-licensed payment provider, and qualified counsel
>
> **Question:** Which provider is selected; what are its licence, merchant, collection, agency, and settlement roles; and what authorization, capture, release, refund, dispute, and customer-statement timings can it prove?
>
> **Proposed position — not approved:** Use one licensed provider that supports the complete delayed-authorization lifecycle, makes the full Customer Total available for capture after Owner acceptance, returns refunds to the original method, and supplies accurate customer-facing timing evidence.
>
> **Required evidence:** Current regulator listing, executed provider contract, end-to-end flow evidence, supported payment methods, merchant and settlement map, idempotency and dispute rules, fee treatment, and verified timing commitments.
>
> **Blocks:** Provider identity and payment clauses, customer timing statements, refunds, disputes, owner settlement, launch, and Issue #32.

## 10. Contract formation and paid confirmation

Owner acceptance alone is not a paid confirmation. The proposed and unapproved formation position is that the accommodation contract forms between the Customer and Cottage Owner only when:

1. the Customer has completed the counsel-approved Article 13 confirmation sequence;
2. the Cottage Owner accepts the complete Booking Request; and
3. the full Customer Total is successfully captured.

RentCottage would separately owe its marketplace and payment-facilitation duties as counsel determines. If capture fails, no Confirmed Booking forms under this proposal, even though the Owner accepted the request.

After successful capture, RentCottage issues a Booking Confirmation with a unique reference, the Booking Period, price breakdown, Customer Total, preserved House Rules and terms, cancellation outcome, exact access details, and Owner contact information. The Customer and Owner may then receive the direct contact information needed to coordinate the booking. The exact timing of Owner legal-identity disclosure must follow counsel's decision and may be earlier than direct contact disclosure.

## 11. Corrections, withdrawal, cancellation, no-show, and refunds

Before the Customer completes the legally operative confirmation, the Customer must be able to review and correct booking details. A pending Booking Request may be withdrawn in full before Owner acceptance. A submitted request cannot be edited; the Customer withdraws it and starts a new request.

The settled product cancellation rule is:

- cancellation at least 48 hours before the first selected Cottage Shift receives a Full Refund;
- cancellation inside 48 hours receives no standard refund;
- a No-Show receives no standard refund; and
- a Platform Administrator may approve and record a full or partial refund exception for an appropriate service, safety, or operational reason.

The deadline is measured in Marketplace Time. A booking confirmed inside the 48-hour boundary would be non-refundable immediately under the product rule, so that outcome must be shown clearly before payment authorization. A Full Refund includes the Booking Service Fee and is returned through the provider to the original payment method. Provider posting time remains subject to verified provider evidence.

These product outcomes are not approved as legally enforceable. They remain subject to mandatory rights and counsel's interpretation of Regulation No. 4 of 2025 Articles 13(3) and 14, any later Ministry instrument, and applicable federal Iraq and Kurdistan Region law.

> [!CAUTION]
> **DECISION REQUIRED — BT-LEGAL-05**
>
> **Owner:** Qualified federal Iraq and Kurdistan Region counsel
>
> **Question:** How do Articles 13(3) and 14 and wider mandatory law affect correction, pending withdrawal, confirmed cancellation, the 48-hour no-refund rule, No-Show outcomes, refund entitlement, and any grace period?
>
> **Proposed position — not approved:** Keep the settled product rule of a Full Refund at least 48 hours before the first shift and no standard refund inside 48 hours or for No-Show, but only if counsel confirms the rule and any required exceptions or remedies.
>
> **Required evidence:** Current legislative and Ministry-instrument check, written federal and regional opinion, mandatory-rights analysis, refund-consequence analysis, and approved pre-contract disclosure.
>
> **Blocks:** Cancellation clauses, Article 13 message, customer warnings, contract formation, refund implementation, launch, and Issue #32.

## 12. Owner Cancellation or Administrator Cancellation and accommodation problems

The settled product position is that an Owner Cancellation or Administrator Cancellation gives the Customer a Full Refund. For an Owner Cancellation, the Cottage Owner must provide a reason, the marketplace creates a Booking Incident, and repeated or unjustified cancellations may cause the Cottage to be paused for Platform Administrator review. Separately, an Administrator Cancellation is performed by a Platform Administrator for a recorded safety, fraud, legal, or serious operational reason and creates an Administrator Audit Record and Booking Incident. The Cottage Owner receives no payout for a cancelled booking that receives a Full Refund.

The proposed problem-remedy position is:

- no access, or an unsafe or unusable Cottage that prevents the Customer from using the Booking Period, gives a Full Refund;
- a material mismatch between the preserved Cottage information and what is supplied gives a proportionate partial or Full Refund according to the loss of use and seriousness;
- the Customer reports the problem promptly, preferably within 24 hours after discovering it and before the Booking Period ends when that is reasonable;
- the Customer and Owner provide reasonable evidence that is safe and proportionate to the issue; and
- RentCottage does not promise a substitute Cottage, rebooking, travel credit, or comparable accommodation.

These are proposed, not approved, and must preserve stronger mandatory customer rights.

> [!CAUTION]
> **DECISION REQUIRED — BT-OWNER-02**
>
> **Owner:** RentCottage owner with qualified counsel
>
> **Question:** What definitions, reporting time, evidence standard, decision process, and refund remedy should apply to no access, material mismatch, and unsafe or unusable accommodation?
>
> **Proposed position — not approved:** Give a Full Refund when no access or unsafe or unusable conditions prevent use; allow a proportionate partial or Full Refund for material mismatch; require a prompt report, preferably within 24 hours and before the period ends when reasonable; request reasonable evidence; and promise no substitute or rebooking.
>
> **Required evidence:** Owner approval, counsel review of mandatory remedies, operational incident process, preserved listing evidence, safe evidence-handling procedure, and support capacity.
>
> **Blocks:** Accommodation-problem clause, complaint workflow, refund decision rules, customer disclosures, and launch.

## 13. Disruptive events outside the parties' control

The proposed disruptive-event rule is narrow and objective. It applies only when an event directly makes the Cottage or the affected Booking Period legally or practically unusable, and the Customer, Owner, and RentCottage did not cause it. Proposed events are:

- war or hostilities affecting use of the Cottage;
- a mandatory legal restriction or evacuation;
- a declared emergency affecting the booking;
- a severe failure of an essential utility that makes the Cottage unusable; or
- an extraordinary natural disaster affecting the Cottage or access to it.

If the entire Booking Period is unusable, the proposed remedy is a Full Refund. If only an unused part is unusable, the proposed remedy is a proportionate refund for that unused part. There is no rescheduling, substitute-Cottage, or rebooking guarantee. Ordinary weather, travel preference, transport difficulty, personal plans, or avoidable Owner maintenance should not be included unless counsel or mandatory law requires a different result.

> [!CAUTION]
> **DECISION REQUIRED — BT-OWNER-03**
>
> **Owner:** RentCottage owner with qualified counsel
>
> **Question:** Which objective disruptive events qualify, what proof is reasonable, who decides, and when is a full or proportionate refund required?
>
> **Proposed position — not approved:** Cover war or hostilities, mandatory restriction or evacuation, declared emergency, severe essential-utility failure, and extraordinary natural disaster only when they make all or part of the booking unusable; refund the entirely unusable period in full and the unused affected part proportionately.
>
> **Required evidence:** Owner approval, federal and regional counsel review, decision and escalation procedure, evidence sources, provider refund capability, and wording that preserves mandatory rights.
>
> **Blocks:** Disruptive-event clause, refund rules, support procedure, and launch.

## 14. Changes and no rescheduling

The Customer and Cottage Owner cannot edit, partially accept, or reschedule a submitted Booking Request or Confirmed Booking. A Customer who wants different dates or shifts must withdraw a pending request or cancel a Confirmed Booking under the applicable outcome, then send a new request. Availability and price for the new request are not guaranteed.

The Cottage Owner may change future availability or prices but cannot use a later change to rewrite a Booking Request, Booking Snapshot, or Confirmed Booking. RentCottage may correct an obvious display or record error only through a clear, lawful mechanism that preserves customer evidence and rights; counsel must confirm any correction after contract formation.

## 15. Communications, contact details, and off-platform activity

A phone-verified Customer may use In-Platform Messaging before sending a Booking Request and may continue the conversation through the request and booking. Before successful payment, RentCottage blocks phone numbers, email addresses, web links, social handles, and common disguised contact details. The purpose is to reduce fraud, protect personal data, preserve the booking record, and prevent payment bypass. Repeated attempts may be reviewed and recorded.

After successful capture, the Customer and Owner may receive the direct contact and access details needed for the Confirmed Booking. Those details may be used only to arrange or deliver the booking, handle a problem, meet a legal duty, or protect safety. They must not be used for unrelated marketing or other bookings.

Customers and Cottage Owners must not:

- move a RentCottage Booking Request or its payment off-platform;
- request or pay an undisclosed booking charge;
- use cash or another direct payment to bypass RentCottage;
- share another person's contact or booking data without authority; or
- use contact details obtained through RentCottage for unrelated solicitation.

An off-platform payment is outside the approved product flow and is prohibited. This draft does not promise that RentCottage can protect, recover, or support a payment made outside the marketplace.

## 16. Article 7 account, data, terms, and notification controls

The customer service must provide clear access to the verified operator identity, licence information, contact methods, Privacy Policy, complaint route, response time, payment methods, booking-response and service-delivery timing, correction and cancellation routes, and applicable terms.

Subject to lawful security and retention limits, a Customer should be able to:

- view and correct account details;
- view personal data and important account changes;
- view current privacy information and applicable terms;
- retrieve the exact terms, Article 13 message, and Booking Snapshot used for each request;
- understand how those records are stored and retained;
- control optional notifications and marketing preferences separately from required booking communications; and
- request account or data action through an authenticated process.

Security controls must protect accounts, booking records, payment references, and personal data. A request to delete or change data must not destroy records that law requires RentCottage to retain, erase another person's rights, conceal fraud or a dispute, or make a live booking unsafe. The exact access, correction, restriction, deletion, notification, and retention controls require counsel and privacy approval.

> [!CAUTION]
> **DECISION REQUIRED — BT-LEGAL-07**
>
> **Owner:** Qualified counsel, privacy owner, security owner, and RentCottage owner
>
> **Question:** Which Article 7 operator, licence, privacy, complaint, response-time, account, personal-data, terms-access, storage, notification, payment, and service-timing controls are required and how must customers exercise them?
>
> **Proposed position — not approved:** Give authenticated access to account data, material changes, privacy information, current and historic applicable terms, stored booking evidence, and separate optional-notification controls, subject only to documented lawful and security limits.
>
> **Required evidence:** Counsel's Article 7 control map, verified operator and support facts, approved Privacy Policy, retention schedule, security design, customer-access procedure, and tested notification preferences.
>
> **Blocks:** Article 7 disclosures, account and notification clauses, Privacy Policy alignment, customer-facing terms, and launch.

## 17. Conduct, House Rules, safety, and damage

The Customer must provide an accurate party size, keep the Booking Party within the published capacity, use the Cottage lawfully, follow the preserved House Rules and reasonable safety instructions, respect neighbours and property, and avoid dangerous, abusive, fraudulent, or disruptive conduct.

The Customer is proposed to be responsible for ensuring that the Booking Party follows these rules and for reporting serious damage or safety problems promptly. Any customer liability for damage, proof, valuation, complaint, payment, set-off, or recovery must be separately approved by counsel. RentCottage does not collect a damage deposit in the current product. No clause may imply that the payment authorization includes one.

## 18. Privacy and booking data

Booking Terms should give a short booking-specific privacy explanation and direct the Customer to an approved Privacy Policy. The complete policy, data map, and operational controls must exist before launch.

RentCottage intends to collect only data necessary for stated lawful purposes, including account verification, request and booking administration, payment facilitation, access coordination, safety, support, fraud prevention, legal compliance, and dispute evidence. It should explain each purpose clearly, use data only for approved compatible purposes, minimise what is collected and shared, protect it with appropriate security, and retain it only for an approved period.

Booking data may need to be shared with the Cottage Owner, licensed payment provider, contracted service processors, professional advisers, regulators, courts, emergency services, or another authorized recipient. The exact lawful basis, role, timing, content, transfer condition, and any express consent must be approved for each recipient. A Customer must not be asked to consent to a transfer that is actually compulsory unless counsel confirms that consent is the correct lawful mechanism and can be freely refused.

If a personal-data breach may harm customers' data, rights, or freedoms, RentCottage needs a tested process to investigate, contain, record, remedy, and promptly notify affected customers, the Ministry, and other competent authorities as applicable. The exact threshold, content, timing, and authority allocation must be set by counsel.

> [!CAUTION]
> **DECISION REQUIRED — BT-PRIVACY-01**
>
> **Owner:** Privacy owner, qualified federal Iraq and Kurdistan Region counsel, and security owner
>
> **Question:** Under Articles 15 to 17 and other applicable law, what are each processing purpose, necessary data item, lawful basis, recipient, transfer condition, retention period, deletion exception, security control, third-party consent requirement, and breach-notification duty?
>
> **Proposed position — not approved:** Use purpose-limited and transparent processing; collect and retain only what is necessary; apply role-based security; document each Owner, provider, processor, adviser, authority, and emergency disclosure; obtain express consent only where legally required and valid; and operate a prompt evidence-based breach process.
>
> **Required evidence:** Approved data inventory and flow map, counsel opinion, Privacy Policy, processor and provider contracts, retention and deletion schedule, security assessment, consent records, and tested incident and notification plan.
>
> **Blocks:** Privacy clauses and policy, third-party transfers, Owner access, payment-provider integration, account controls, incident response, launch, and Issue #32.

## 19. Transactional communications and marketing

RentCottage needs to send messages required to create and perform a booking, protect the account, give status, handle payment, provide access and safety information, respond to support, and meet legal duties. Counsel must decide which of these are transactional and what notice or consent is required.

Marketing and advertising messages must be separate. A Customer should receive them only after a clear, specific, recorded opt-in and must have a simple way to stop them. Refusing or stopping marketing must not prevent ordinary access to the marketplace or a booking.

Accepting Booking Terms must never be treated as blanket consent for marketing, optional notifications, unrelated data processing, or third-party transfers. A single booking checkbox must not silently opt the Customer into any of those activities.

> [!CAUTION]
> **DECISION REQUIRED — BT-CONSENT-01**
>
> **Owner:** Qualified counsel, privacy owner, and product owner
>
> **Question:** Under Article 20 and related law, which booking, payment, account, safety, and support messages are transactional; which messages are advertising or marketing; and what consent, proof, identification, and opt-out controls apply to each?
>
> **Proposed position — not approved:** Send only necessary transactional messages on an approved legal basis; require separate express opt-in for marketing and optional notifications; record the choice; and provide a simple opt-out without affecting booking service.
>
> **Required evidence:** Counsel classification, complete message inventory, purpose and channel map, approved consent text, preference controls, delivery records, and tested opt-out process.
>
> **Blocks:** Notification clauses, marketing, consent interface, Privacy Policy alignment, and launch.

## 20. Complaints, incidents, and payment disputes

RentCottage should provide visible, verified support and complaint channels. The proposed service target is to acknowledge a complaint within one business day and provide a final response within 10 business days. If a final response needs longer, RentCottage would tell the Customer why, what happens next, and when to expect an update. These targets are not approved promises.

Customers should report urgent safety issues immediately through the urgent channel shown for the booking and contact public emergency services when appropriate. RentCottage may ask for reasonable information and evidence, protect sensitive reports, give the Cottage Owner a fair opportunity to respond when safe and lawful, record the decision, and explain any refund outcome.

A support complaint, Booking Incident, public review, and Payment Dispute are separate records with different purposes. A complaint does not automatically determine a provider dispute, and a provider dispute does not erase an accommodation complaint or mandatory right. RentCottage should preserve the Booking Snapshot, payment and cancellation evidence, communications, and relevant incident material for lawful dispute handling.

> [!CAUTION]
> **DECISION REQUIRED — BT-OWNER-04**
>
> **Owner:** RentCottage owner with support lead and qualified counsel
>
> **Question:** Which complaint and urgent-incident channels will operate, what response times can be promised, how are extensions and escalation handled, and which regulator or court routes must be stated?
>
> **Proposed position — not approved:** Acknowledge complaints within one business day, provide a final response within 10 business days, and notify the Customer with reasons and a next update time if a final response will take longer.
>
> **Required evidence:** Owner approval, staffed and tested channels, operating hours and Marketplace Time rules, support procedure, incident escalation, counsel review, and complaint record and reporting controls.
>
> **Blocks:** Article 7 complaint disclosures, support clauses, customer service commitments, and launch.

## 21. Applicable law, courts, mandatory rights, and languages

These terms must not reduce a Customer's mandatory rights. No governing-law, court, dispute, limitation, severability, or enforcement clause should be added until counsel maps the applicable federal Iraq and Kurdistan Region rules for the operator, Customer, Cottage Owner, and Cottage location.

> [!CAUTION]
> **DECISION REQUIRED — BT-LEGAL-03**
>
> **Owner:** Qualified counsel competent in federal Iraq and Kurdistan Region law
>
> **Question:** Which federal and regional e-commerce, consumer, contract, tourism, company, tax, payment, and court rules apply, and what law, forum, mandatory-rights, and regulator wording is valid for each booking?
>
> **Proposed position — not approved:** Use one nationwide core document only if counsel confirms it, preserve all mandatory rights, and add clear jurisdiction-specific disclosures or routes wherever the applicable law differs.
>
> **Required evidence:** Current federal and regional legal opinion, licence and regulator map, conflict-of-laws analysis, court and complaint routes, and approved mandatory-rights wording.
>
> **Blocks:** Governing law, courts, licence disclosures, remedies, cancellation enforceability, launch, and Issue #32.

RentCottage's planned launch languages are Arabic, Sorani Kurdish, and English. Every operative version must communicate the same approved meaning and be bound to exact content evidence. Artificial Intelligence output is not legal translation approval.

> [!CAUTION]
> **DECISION REQUIRED — BT-LEGAL-06**
>
> **Owner:** Qualified counsel and qualified Arabic and Sorani legal translators
>
> **Question:** Which of Arabic, Sorani Kurdish, and English must be supplied; whether Sorani is suitable across the launch area; which versions are equally authoritative or controlling; and how discrepancies must be resolved without reducing customer rights?
>
> **Proposed position — not approved:** Provide complete human-reviewed Arabic, Sorani, and English versions; preserve the Customer's selected locale; treat English as a convenience version unless counsel approves another status; and never use a controlling-language rule that unfairly disadvantages the Customer.
>
> **Required evidence:** Counsel opinion on language duties, exact source-language decision, qualified translator credentials, dated review of each immutable version, content hashes, and discrepancy procedure.
>
> **Blocks:** Final translations, authoritative-language clause, immutable terms catalog, human approval evidence, launch, and Issue #32.

## 22. Prospective changes, history, and evidence

Approved Booking Terms should have one immutable version and effective date. A later change should apply only prospectively unless binding law requires otherwise. It must not rewrite the terms, House Rules, listing information, cancellation outcome, or price preserved for an earlier Booking Request or Confirmed Booking.

Customers should be able to retrieve the version that applied to them. RentCottage should preserve the exact content, selected locale, effective date, Customer and recipient identities, Article 13 message, sending and receipt evidence, customer actions, relevant timestamps, Booking Snapshot, and payment evidence in a form that can be stored and reproduced accurately. A content hash may support integrity but does not replace the legal evidence counsel requires.

No version becomes operative through publication alone. It requires recorded approval by the canonical approver after legal review and exact Arabic and Sorani review.

> [!CAUTION]
> **DECISION REQUIRED — BT-APPROVAL-01**
>
> **Owner:** RentCottage owner, canonical customer-terms approver, qualified counsel, and qualified Arabic and Sorani legal translators
>
> **Question:** Who is authorized to approve the terms, what is the immutable version and effective date, which exact language artifacts are approved, and what evidence binds all approvals to the same meaning and content?
>
> **Proposed position — not approved:** Name one canonical approver, assign one immutable version and prospective effective date after all legal decisions, and bind counsel plus Arabic and Sorani approvals to exact content hashes before any customer use.
>
> **Required evidence:** Written authority for the approver, signed or attributable counsel approval, dated qualified translation approvals, exact files and hashes, effective-date decision, publication record, and retrievable history.
>
> **Blocks:** Operative status, effective date, translations, checkout linkage, customer acceptance, launch, and Issue #32.

## 23. Decision register index

This table is a reference-only index. It cannot resolve or close a decision independently. Each decision remains Open until the owner named in its canonical full block records the required evidence and clears every stated block.

| Decision ID | Canonical full block | Status |
| --- | --- | --- |
| BT-LEGAL-01 | [Section 1 — Status and instructions for use](#1-status-and-instructions-for-use) | Open |
| BT-LEGAL-02 | [Section 4 — Roles and service responsibilities](#4-roles-and-service-responsibilities) | Open |
| BT-LEGAL-03 | [Section 21 — Applicable law, courts, mandatory rights, and languages](#21-applicable-law-courts-mandatory-rights-and-languages) | Open |
| BT-LEGAL-04 | [Section 7 — Article 13 message and customer confirmation sequence](#7-article-13-message-and-customer-confirmation-sequence) | Open |
| BT-LEGAL-05 | [Section 11 — Corrections, withdrawal, cancellation, no-show, and refunds](#11-corrections-withdrawal-cancellation-no-show-and-refunds) | Open |
| BT-LEGAL-06 | [Section 21 — Applicable law, courts, mandatory rights, and languages](#21-applicable-law-courts-mandatory-rights-and-languages) | Open |
| BT-LEGAL-07 | [Section 16 — Article 7 account, data, terms, and notification controls](#16-article-7-account-data-terms-and-notification-controls) | Open |
| BT-PROVIDER-01 | [Section 9 — Payments](#9-payments) | Open |
| BT-PRIVACY-01 | [Section 18 — Privacy and booking data](#18-privacy-and-booking-data) | Open |
| BT-CONSENT-01 | [Section 19 — Transactional communications and marketing](#19-transactional-communications-and-marketing) | Open |
| BT-OWNER-01 | [Section 5 — Eligibility and authority for the Booking Party](#5-eligibility-and-authority-for-the-booking-party) | Open |
| BT-OWNER-02 | [Section 12 — Owner Cancellation or Administrator Cancellation and accommodation problems](#12-owner-cancellation-or-administrator-cancellation-and-accommodation-problems) | Open |
| BT-OWNER-03 | [Section 13 — Disruptive events outside the parties' control](#13-disruptive-events-outside-the-parties-control) | Open |
| BT-OWNER-04 | [Section 20 — Complaints, incidents, and payment disputes](#20-complaints-incidents-and-payment-disputes) | Open |
| BT-APPROVAL-01 | [Section 22 — Prospective changes, history, and evidence](#22-prospective-changes-history-and-evidence) | Open |

## 24. Counsel sign-off

Signing this table would record review of this draft only. It does not by itself make the document operative. An operative version requires all decision-register evidence, one immutable approved version and effective date, exact approved language artifacts, and a separate publication decision by the authorized approver.

| Review role | Name | Organisation or qualification | Decision | Date | Exact draft ID or hash | Signature or attributable approval reference |
| --- | --- | --- | --- | --- | --- | --- |
| Federal Iraq counsel | Not assigned | Not assigned | Not assigned | Not assigned | Not assigned | Not assigned |
| Kurdistan Region counsel | Not assigned | Not assigned | Not assigned | Not assigned | Not assigned | Not assigned |
| Privacy counsel or privacy owner | Not assigned | Not assigned | Not assigned | Not assigned | Not assigned | Not assigned |
| Payment and provider reviewer | Not assigned | Not assigned | Not assigned | Not assigned | Not assigned | Not assigned |
| Arabic legal translator or reviewer | Not assigned | Not assigned | Not assigned | Not assigned | Not assigned | Not assigned |
| Sorani legal translator or reviewer | Not assigned | Not assigned | Not assigned | Not assigned | Not assigned | Not assigned |
| Canonical customer-terms approver | Not assigned | Not assigned | Not assigned | Not assigned | Not assigned | Not assigned |

### Counsel review outcome

| Outcome field | Value |
| --- | --- |
| All CAUTION markers resolved with evidence | No |
| Conflicts between authorities resolved in writing | No |
| Customer-facing legal text approved | No |
| Arabic legal text approved | No |
| Sorani legal text approved | No |
| English legal text approved | No |
| Immutable approved version assigned | No |
| Effective date assigned | No |
| Issue #32 legal-content gate cleared | No |
