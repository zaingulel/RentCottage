# RentCottage Marketplace

RentCottage is a controlled marketplace that connects customers with invited cottage owners. The initial marketplace supports multiple owners, but owner participation is manually approved rather than open to public self-registration.

## Language

**Marketplace**:
The RentCottage service through which customers discover and book cottages offered by multiple invited cottage owners anywhere in Iraq.
_Avoid_: Single-owner booking site, open marketplace

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
A RentCottage team member who approves cottage owners and cottage content, views bookings, and can deactivate an owner or cottage. Administrators use separate email-and-multi-factor accounts; granular staff roles are deferred from the MVP.
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

**Owner Verification Record**:
The approval status and review date recorded after RentCottage manually checks a cottage owner's identity, authority to rent and applicable jurisdictional requirements outside the product. The MVP does not store identity, ownership or licensing documents.
_Avoid_: Uploaded identity document, ownership-document archive, public verified badge

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
The invitation-only, phone-verified identity through which an approved cottage owner accesses the owner backoffice.
_Avoid_: Public owner registration, password-only owner account

**Owner Terms Acceptance**:
The cottage owner's required acceptance of the applicable marketplace terms during invitation onboarding, preserved with the accepted version and date before the owner can publish a cottage.
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
The payment provider's temporary approval for RentCottage to capture the full booking price if the cottage owner accepts the booking request. Successful authorization is required before the booking request and pending hold are created; declined or expired requests release it instead of creating a refund.
_Avoid_: Captured payment, deposit, completed charge

**Online-Only Payment**:
The MVP rule that every booking request requires online full-payment authorization. If authorization is unavailable, customers may continue browsing but cannot submit a request; there is no cash or unpaid fallback.
_Avoid_: Cash on arrival, offline transfer, unpaid request

**Licensed Payment Provider**:
A Central Bank of Iraq-licensed provider capable of payment authorization, delayed capture, authorization release, full refunds, dispute handling and owner settlement for the agreed booking lifecycle. Selecting a suitable provider is a launch gate; if none can support the lifecycle, the payment model must be reopened.
_Avoid_: Unlicensed processor, RentCottage-held wallet, unsupported payment workaround

**Payment Capture**:
The collection of the full authorized booking price after the cottage owner accepts a booking request. A booking is not confirmed until capture succeeds.
_Avoid_: Authorization, cash payment, deposit

**Owner Payout**:
The cottage owner's share of a captured booking payment after RentCottage commission. It becomes eligible for settlement by the licensed payment provider after the booking period completes, including when a late customer cancellation or no-show is non-refundable; RentCottage does not directly custody the funds.
_Avoid_: Payment capture, pre-completion settlement, RentCottage wallet

**Payment Required**:
The 15-minute state entered when a cottage owner accepts a booking request but the authorized full-payment capture fails. The customer may provide a valid payment method during this period; otherwise the request expires without becoming a confirmed booking.
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
The temporary exclusive claim a booking request places on every cottage shift in its requested booking period while the owner decision or required payment is pending. It prevents competing requests and cannot be replaced by a private block; after owner acceptance it remains until payment succeeds or the 15-minute payment period expires.
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
Return of the customer's entire booking price. RentCottage absorbs any payment-provider processing or refund fee that is not returned; the cottage owner receives no payout for that booking.
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
The exact cottage directions, map pin and mutual customer-and-owner contact details released after the booking becomes confirmed. While a request is pending, the owner sees the customer's name and guest count but not their phone number.
_Avoid_: Public listing address, approximate location, pending-request contact details

**Customer Review**:
A future customer rating or written assessment of a cottage, permitted only after a completed booking. Customer reviews are deferred from the MVP.
_Avoid_: Public comment, unverified review

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
The total customer-visible amount collected for a booking period, calculated by adding each selected shift's applicable price or each selected full-day bundle's own applicable price. It includes RentCottage's commission, has no automatic multi-shift or multi-day discount, and is not increased by a separate customer platform fee or refundable damage deposit at checkout.
_Avoid_: Negotiated total, automatic length discount, checkout surcharge, damage deposit

**Marketplace Commission**:
RentCottage's share of a captured booking payment, deducted from the cottage owner's payout rather than added to the customer's booking price. The MVP target is 12%, including ordinary payment-processing costs, subject to confirmation against licensed-provider pricing; the applicable rate is preserved in the booking snapshot.
_Avoid_: Customer platform fee, checkout surcharge

**Cottage Profile**:
The customer-visible structured facts about a cottage: guest capacity, bedrooms, bathrooms, key amenities, photos and approximate location. A complete cottage profile is required for publication.
_Avoid_: Free-text listing, owner note

**Localized Cottage Content**:
The approved Arabic, Sorani Kurdish and English versions of a cottage's customer-visible description and house rules. All three versions are required before the cottage content can be published, regardless of who drafted or translated them.
_Avoid_: Single-language listing, unapproved machine translation

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
An owner change to a cottage's price or availability. It takes effect immediately and does not require RentCottage team approval.
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
A future RentCottage communication capability between customers and cottage owners. It is deferred from the MVP; owners' contact details are released with access details after booking confirmation.
_Avoid_: MVP chat, MVP calling
