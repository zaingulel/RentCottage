# RentCottage Marketplace

RentCottage is a controlled marketplace that connects customers with approved cottage owners. Cottage owners may apply directly, but neither the owner nor a cottage becomes public until RentCottage completes its checks and approves them.

## Language

**Marketplace**:
The RentCottage service through which customers discover and book cottages offered by multiple approved cottage owners anywhere in Iraq.
_Avoid_: Single-owner booking site, unmoderated marketplace

**Marketplace Coverage**:
All of Iraq is eligible for approved cottage inventory from launch, without promising that every governorate or local area has available cottages.
_Avoid_: Baghdad-only pilot, guaranteed nationwide inventory

**Public Launch Inventory**:
The minimum ten approved cottages required before opening RentCottage to the public, preferably concentrated in at least two real demand clusters. It is a readiness threshold rather than a restriction on nationwide cottage eligibility.
_Avoid_: One-city restriction, scattered placeholder inventory

**Cottage Owner**:
A person or organisation authorised to offer one or more cottages through the marketplace after manual onboarding by the platform team.
_Avoid_: Host, provider, vendor

**Platform Administrator**:
A RentCottage team member who reviews owner applications and verification documents, approves cottage content, views bookings and financial summaries, handles refunds and incidents, and can pause or deactivate an owner or cottage. Administrators use separate email-and-multi-factor accounts; granular staff permission design is deferred from the MVP.
_Avoid_: Owner, customer, finance operator

**Administrator Audit Record**:
The timestamped record of which platform administrator approved or changed cottage content, approved an owner, paused or deactivated an account, or recorded an incident.
_Avoid_: Unattributed admin action, general analytics

**Customer**:
A person who discovers cottages and, after phone verification, submits and manages booking requests.
_Avoid_: Guest, buyer, client

**Customer Account**:
The customer identity created from a verified phone number when that customer submits a booking request. Browsing cottages does not require a customer account.
_Avoid_: Anonymous booking, email account

**Cottage**:
A privately operated leisure property, such as a cottage or chalet, booked exclusively by one customer group as a whole property. It excludes hotels, individual rooms, shared accommodation, farms without guest facilities, and dedicated event venues.
_Avoid_: Room, hotel, event venue, shared accommodation

**Published Cottage**:
A cottage that the RentCottage team has manually approved after confirming the cottage owner's phone number and identity, authority to rent, applicable jurisdictional requirements, and required cottage content. It is visible to customers in the marketplace.
_Avoid_: Draft cottage, unreviewed listing, verified badge

**Owner Application**:
The self-service application through which a prospective cottage owner creates an account, enters owner and cottage information, uploads the required evidence and submits for RentCottage review. A complete application has a three-day review target; a request for missing information pauses that target.
_Avoid_: Invitation-only onboarding, automatic approval, public unreviewed listing

**Owner Verification Document**:
A privately stored identity, authority-to-rent, ownership, licensing or compliance file submitted with an Owner Application. Access is restricted to authorised verification administrators and every view, download, replacement or deletion is audited. The retention schedule is a pre-launch legal decision.
_Avoid_: Public document, ordinary support attachment, permanent unreviewed archive

**Owner Verification Record**:
The durable approval decision recorded after RentCottage checks a cottage owner's identity, authority to rent and applicable jurisdictional requirements. It records the reviewer, date, evidence types, jurisdiction, licence or exemption basis, expiry dates and reason without making source documents public.
_Avoid_: Public verified badge, unattributed approval

**Paused Cottage**:
A published cottage that its owner has temporarily removed from customer search and new booking requests while preserving its profile and booking history. The owner must resolve pending requests before pausing; existing confirmed bookings remain visible.
_Avoid_: Deleted cottage, cancelled booking

**Customer Web App**:
The mobile-friendly web experience through which customers discover cottages and manage bookings. It is the initial customer product surface; native mobile apps are deferred.
_Avoid_: Customer native app, customer website

**Owner Backoffice**:
The mobile-friendly web experience through which cottage owners manage cottages, availability and bookings. It is part of the initial product and is not a separate native app.
_Avoid_: Owner app, provider portal

**Owner Account**:
The phone-verified identity through which a prospective or approved cottage owner submits an application and accesses the owner backoffice. Application access does not grant publication or booking privileges.
_Avoid_: Automatically approved owner, password-only owner account

**Owner Terms Acceptance**:
The cottage owner's required acceptance of the applicable marketplace terms during application onboarding, preserved with the accepted version and date before the owner can publish a cottage.
_Avoid_: Implied owner consent, current owner terms

**Cottage Shift**:
One of two or three fixed bookable periods in a cottage's recurring shift schedule, with a name and start and end times. Customers select offered shifts rather than entering arbitrary times.
_Avoid_: Overnight slot, hourly booking, arbitrary time range

**Shift Schedule**:
The recurring set of two or three non-overlapping cottage shifts defined by a cottage owner for one cottage. Owners choose any non-bookable turnaround gaps needed between shifts; the marketplace does not impose a minimum. Availability and pricing may vary by service day, but shift times do not. Schedule changes apply prospectively and never alter pending or confirmed booking records.
_Avoid_: Date-specific operating hours, marketplace-wide schedule

**Booking Period**:
One or more cottage shifts at the same cottage across one or more consecutive service days, selected, requested and confirmed together as one booking. On each service day, the customer selects individual shifts or the full-day bundle.
_Avoid_: Stay, separate shift bookings, arbitrary time range

**Full-Day Bundle**:
A separately priced booking option containing every cottage shift offered for one service day. It gives continuous access from the first shift's start through the last shift's end; consecutive full-day bundles merge into continuous access across the intervening overnight gaps. Booking it blocks every component shift, and booking any component shift makes the bundle unavailable.
_Avoid_: Sum of shift prices, independent overlapping shift

**Marketplace Time**:
Iraq local time (UTC+3), which governs cottage shifts, availability calendars, response deadlines and booking notifications.
_Avoid_: Customer-selected time zone, owner-selected time zone

**Service Day**:
The local calendar date on which a cottage shift starts. A cross-midnight shift and its pricing and availability belong to that start date; a full-day bundle also belongs to the date on which its first component shift starts.
_Avoid_: Check-out date, end date

**Booking Request**:
A customer's authorized request to reserve an available booking period. It and its pending hold are created only after full-payment authorization succeeds; it then awaits a decision from the cottage owner and is not yet a confirmed booking.
_Avoid_: Booking, reservation, order

**Customer Booking Conflict**:
An overlap between a customer's active booking requests or confirmed bookings, even when they concern different cottages. RentCottage prevents a customer from creating an active request that conflicts with another active booking period.
_Avoid_: Cottage availability conflict, speculative parallel request

**Confirmed Booking**:
A booking request that the cottage owner has accepted and for which the full authorized payment has been captured, committing the cottage and customer to the booking period under the recorded price, rules and terms.
_Avoid_: Accepted request, pending booking

**Completed Booking**:
A confirmed booking that automatically completes at the end of its booking period unless the cottage owner or a platform administrator records an incident first.
_Avoid_: Open booking, unverified booking

**Booking Confirmation**:
The customer-visible record created after owner acceptance and successful full-payment capture. It has a unique booking reference and includes the selected shift dates and times, price, house rules, access details and cottage owner contact information.
_Avoid_: Informal acceptance, mutable listing

**Booking Snapshot**:
The preserved record of a booking request's cottage, booking period, price and house rules at the moment the customer submits it. Later cottage edits do not change that record.
_Avoid_: Current listing, mutable quote

**Terms Acceptance**:
The customer's required confirmation, before submitting a booking request, that they accept the cottage's house rules and the applicable marketplace booking terms. The accepted versions are preserved in the booking snapshot.
_Avoid_: Implied consent, current terms

**Payment Authorization**:
The payment provider's temporary approval that reserves the full Customer Total for later capture if the cottage owner accepts the Booking Request. Successful authorization is required before the request and Pending Hold are created; declined, withdrawn or expired requests release it instead of creating a refund.
_Avoid_: Captured payment, deposit, completed charge

**Online-Only Payment**:
The MVP rule that every booking request requires online full-payment authorization. If authorization is unavailable, customers may continue browsing but cannot submit a request; there is no cash or unpaid fallback.
_Avoid_: Cash on arrival, offline transfer, unpaid request

**Licensed Payment Provider**:
A Central Bank of Iraq-licensed provider capable of payment authorization, delayed capture, authorization release, full refunds, dispute handling and owner settlement for the agreed booking lifecycle. Selecting a suitable provider is a launch gate; if none can support the lifecycle, the payment model must be reopened.
_Avoid_: Unlicensed processor, RentCottage-held wallet, unsupported payment workaround

**Payment Capture**:
The automatic collection of the full authorized Customer Total after the cottage owner accepts a Booking Request. A booking is not confirmed until capture succeeds.
_Avoid_: Authorization, cash payment, deposit

**Owner Payout**:
The cottage owner's share of the captured Booking Price after the 10% Marketplace Commission and any provider treatment agreed in the owner terms. It becomes eligible for settlement by the Licensed Payment Provider after the Booking Period completes, including when a late customer cancellation or No-Show is non-refundable; RentCottage does not directly custody the funds.
_Avoid_: Payment capture, pre-completion settlement, RentCottage wallet

**Payment Required**:
The 20-minute recovery state entered only when a cottage owner accepts a Booking Request but automatic Payment Capture fails. The customer is notified and may provide a valid payment method during this period; otherwise the request expires without becoming a Confirmed Booking. Owner acceptance alone does not start this period when capture succeeds normally.
_Avoid_: Confirmed booking, indefinite payment retry

**Payment Dispute**:
A formal payment-provider or chargeback case handled by RentCottage using the preserved booking snapshot, payment and cancellation records, and any recorded incident evidence. An accommodation-quality complaint does not itself guarantee a refund; a provider decision may delay or reverse the owner payout under the owner terms.
_Avoid_: Automatic complaint refund, informal support complaint

**Booking Party**:
The verified customer submitting a booking request and the declared total number of guests for the requested booking period. The party size cannot exceed the cottage's published capacity.
_Avoid_: Anonymous group, guest document collection

**Booking Note**:
An optional short message from the customer attached to a booking request for practical context. It does not replace the declared guest count or the cottage's house rules.
_Avoid_: Booking terms, unstructured guest count

**Pending Hold**:
The temporary exclusive claim a Booking Request places on every cottage shift in its requested Booking Period while the owner decision or required payment is pending. It prevents competing requests and cannot be replaced by a Private Block; after owner acceptance it remains until payment succeeds or the 20-minute Payment Required period expires.
_Avoid_: Confirmed booking, permanent block

**Response Deadline**:
The four-hour period in which a cottage owner must accept or decline a booking request before its pending hold expires and the cottage shifts become available again.
_Avoid_: Indefinite pending request, manual follow-up window

**Booking Request Cut-Off**:
The point six hours before the first selected cottage shift begins, after which a customer cannot submit a new booking request for that booking period.
_Avoid_: Last-minute request, owner-defined cut-off

**Owner Request Notification**:
The immediate alert sent to a cottage owner when a booking request creates a pending hold. The owner backoffice also presents the request as requiring action before the response deadline.
_Avoid_: Passive calendar update, delayed digest

**Customer Status Notification**:
The immediate alert sent to a customer when their booking request is accepted, declined or expires.
_Avoid_: Manual status checking, silent expiry

**Customer Booking Reminder**:
The customer notification sent 24 hours before the first selected cottage shift begins, containing the booking reference, access details and cottage owner contact information.
_Avoid_: Post-booking notification, informal reminder

**Owner Booking Reminder**:
The cottage owner notification sent 24 hours before the first selected cottage shift begins for a confirmed booking, prompting preparation and review of the booking details.
_Avoid_: Customer reminder, post-booking notification

**Booking History**:
The customer-visible record of a customer's current and past booking requests, and the owner-visible record of upcoming, current and past bookings for each cottage.
_Avoid_: Hidden transaction log, analytics report

**Decline Reason**:
The owner-provided explanation for declining a booking request, selected from a short set of reasons with an optional note. It is shown to the customer.
_Avoid_: Silent decline, unrecorded rejection

**Request Withdrawal**:
The customer's cancellation of a pending booking request before the owner decides. It immediately releases the pending hold; changing a request requires withdrawal and submission of a new request.
_Avoid_: Editing a pending request, confirmed-booking cancellation

**Customer Cancellation**:
The customer's termination of a confirmed booking. Cancellation at least 48 hours before the first selected cottage shift receives a full refund; cancellation inside 48 hours and a no-show receive no refund. A booking confirmed inside that boundary is non-refundable immediately, which must be disclosed before payment authorization. The deadline is governed by marketplace time and is the same for every cottage.
_Avoid_: Request withdrawal, owner-specific policy, partial late refund

**Full Refund**:
Return of the entire Customer Total, including the Booking Service Fee. RentCottage absorbs any payment-provider processing or refund fee that is not returned; the cottage owner receives no payout for that booking. Qualifying customer cancellations and every owner or administrator cancellation trigger the refund automatically; administrators may also approve a manual exception.
_Avoid_: Refund minus processing fee, account credit

**No-Show**:
A confirmed booking for which the customer does not arrive for the first selected cottage shift and has not cancelled before it begins. A no-show receives no refund.
_Avoid_: Request withdrawal, owner cancellation

**Owner Cancellation**:
A cottage owner's termination of a confirmed booking. The customer always receives a full refund; the owner must provide a reason, the marketplace records an incident, and repeated or unjustified cancellations may cause the cottage to be paused for administrator review.
_Avoid_: Customer cancellation, request decline, silent cancellation

**Administrator Cancellation**:
A platform administrator's termination of a confirmed booking for a recorded safety, fraud, legal or serious operational reason. It creates an administrator audit record and booking incident, gives the customer a full refund, and gives the cottage owner no payout.
_Avoid_: Owner cancellation, unexplained administrative action

**Booking Incident**:
The restricted operational record of a reported or administrator-identified safety, fraud, property, payment or serious service problem associated with a booking.
_Avoid_: Customer review, public complaint, administrator audit record

**Approximate Location**:
The area-level location shown to customers while they browse a published cottage. It is sufficient for discovery but does not disclose the exact cottage address or map pin.
_Avoid_: Exact address, access details

**Access Details**:
The exact cottage directions, map pin and mutual customer-and-owner contact details released after the booking becomes confirmed by successful payment. While a request is pending, the owner sees the customer's name and guest count but not their phone number or other direct contact details.
_Avoid_: Public listing address, approximate location, pending-request contact details

**Customer Review**:
The one-to-five-star rating and written assessment a customer may submit once for a Completed Booking within 14 days. The cottage owner may post one public reply. A Platform Administrator may hide content that breaches the review rules without erasing the underlying record.
_Avoid_: Public comment without a booking, duplicate review, private incident record

**Launch Language**:
Arabic, Sorani Kurdish and English are supported from launch across the marketplace's product surfaces and transactional communications. Arabic and Sorani use right-to-left presentation; English uses left-to-right presentation.
_Avoid_: Arabic-only launch, English-first launch, unspecified Kurdish

**Shift Price**:
The cottage owner's standard Iraqi-dinar price for one cottage shift or full-day bundle when no more specific price applies.
_Avoid_: Nightly price, hourly price, package price

**Day-of-Week Price Override**:
A cottage owner's recurring replacement price for a cottage shift or full-day bundle on one weekday. It takes precedence over the standard shift price but not a specific-date override.
_Avoid_: Date price override, dynamic surge price

**Date Price Override**:
A cottage owner’s replacement price for a cottage shift or full-day bundle on one specific service day, such as a holiday. It takes precedence over day-of-week and standard prices.
_Avoid_: Dynamic surge price, hourly adjustment

**Booking Price**:
The price of the cottage Booking Period before the Booking Service Fee, calculated by adding each selected shift's applicable price or each selected Full-Day Bundle's applicable price. It has no automatic multi-shift or multi-day discount and no refundable damage deposit.
_Avoid_: Customer Total, negotiated total, automatic length discount, damage deposit

**Booking Service Fee**:
The fixed RentCottage fee added to a paid booking and shown separately before Payment Authorization. The proposed launch amount is IQD 5,000, subject to customer validation before public launch. It is RentCottage revenue rather than a card or gateway surcharge and is included in a Full Refund.
_Avoid_: Payment-processing surcharge, hidden fee, owner commission

**Customer Total**:
The full amount authorized and captured from the customer, equal to the Booking Price plus the Booking Service Fee. The breakdown and total are preserved in the Booking Snapshot.
_Avoid_: Booking Price, owner payout, refundable damage deposit

**Marketplace Commission**:
RentCottage's share of the Booking Price, deducted from the cottage owner's payout. The MVP rate is 10%; the rate and amount are preserved in the Booking Snapshot. Payment-provider costs and the separate Booking Service Fee do not change the commission basis.
_Avoid_: Customer service fee, payment-processing surcharge, percentage of Customer Total

**Cottage Profile**:
The customer-visible structured facts about a cottage: guest capacity, bedrooms, bathrooms, key amenities, photos and approximate location. A complete cottage profile is required for publication.
_Avoid_: Free-text listing, owner note

**Localized Cottage Content**:
The approved Arabic, Sorani Kurdish and English versions of a cottage's customer-visible description and House Rules. An owner may submit source content in any Launch Language. Automatic Translation produces the other versions, and an administrator approves the complete set before publication.
_Avoid_: Single-language listing, unreviewed machine translation

**Automatic Translation**:
The system-generated Arabic, Sorani Kurdish or English version of approved dynamic text, including owner content, messages, reviews and replies. The original text and its language are preserved and customers may view the original. Static interface text remains human reviewed, and identity or verification documents are never sent for translation.
_Avoid_: Replacing the original, translating verification documents, unlabelled generated text

**Cottage Search**:
The customer search experience for finding published cottages by approximate location, date, cottage shifts, guest capacity and optional key amenities. It returns only cottages with every shift in the requested booking period available.
_Avoid_: Map-first discovery, general directory

**House Rules**:
The customer-visible restrictions and expectations that apply to a booking period, including family, event and smoking restrictions. House rules are required before publication.
_Avoid_: Private owner preference, hidden condition

**Content Change**:
An owner change to a published cottage's photos, description, amenities, house rules or location. Previously approved content remains visible until the complete Arabic, Sorani Kurdish and English update is approved and published atomically.
_Avoid_: Immediate edit, operational change, mixed-language update

**Operational Change**:
An owner change to future cottage prices or availability. It takes effect immediately and does not require RentCottage team approval, but it cannot edit or reschedule a submitted Booking Request or Confirmed Booking.
_Avoid_: Content change, publication review

**Private Block**:
An owner-created block on one or more cottage shifts for personal use or an off-platform booking. A private block makes those shifts unavailable to RentCottage customers without storing off-platform customer details.
_Avoid_: Booking request, confirmed booking

**Availability Calendar**:
The owner-controlled calendar that determines which cottage shifts a published cottage can accept. A newly published cottage begins with every shift unavailable until the owner explicitly opens it.
_Avoid_: Implicit availability, always-open calendar

**Public Availability**:
The availability information shown to customers for a cottage: a cottage shift is available or unavailable, without revealing another customer's identity, booking status or the reason for unavailability.
_Avoid_: Public booking calendar, block reason

**Owner Calendar**:
The cottage owner's availability calendar, which distinguishes pending holds, confirmed bookings and private blocks for that owner's cottages.
_Avoid_: Customer calendar, undifferentiated unavailable date

**Rescheduling**:
A future capability for changing the dates of a confirmed booking. Rescheduling is deferred from the MVP; customers cancel and submit a new booking request instead.
_Avoid_: Editing a confirmed booking, date change

**In-Platform Messaging**:
The text conversation between a customer and Cottage Owner linked to a Cottage or Booking Request. Before Payment Capture, the system blocks phone numbers, email addresses, web links and social handles so the parties cannot move the transaction off-platform. After confirmation, direct contact information may be shared. The conversation becomes read-only seven days after the Booking Period ends, and its original and translated messages remain available to authorised participants and support.
_Avoid_: Audio call, video call, pre-payment contact exchange, unrelated public chat

**Basic Administrator Dashboard**:
The Platform Administrator view of pending owner applications, cottages awaiting approval, active requests and bookings, payment and refund states, incidents, review moderation, and simple booking, gross-value, commission, service-fee and owner-payout totals. It supports export for operational follow-up but is not a finance reporting suite or revenue-management system.
_Avoid_: Complex staff permission system, accounting ledger, revenue optimisation tool

**Owner Earnings Summary**:
The owner-visible list and simple totals for captured Booking Price, 10% Marketplace Commission, refund or cancellation outcome, and expected or paid Owner Payout per booking. It is not forecasting, dynamic pricing or a revenue-management tool.
_Avoid_: RentCottage financial report, revenue forecast, editable settlement
