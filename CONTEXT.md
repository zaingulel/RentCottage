# RentCottage Marketplace

RentCottage is a controlled marketplace that connects customers with invited cottage owners. The initial marketplace supports multiple owners, but owner participation is manually approved rather than open to public self-registration.

## Language

**Marketplace**:
The RentCottage service through which customers discover and book cottages offered by multiple invited cottage owners.
_Avoid_: Single-owner booking site, open marketplace

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
A cottage that the RentCottage team has manually approved after confirming the cottage owner's phone number and identity, authority to rent, and required cottage content. It is visible to customers in the marketplace.
_Avoid_: Draft cottage, unreviewed listing, verified badge

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

**Overnight Slot**:
The fixed bookable period for one cottage spanning an arrival date and the following departure date. The exact check-in and check-out times remain a client decision.
_Avoid_: Hourly booking, arbitrary time range, day slot

**Stay**:
One or more consecutive overnight slots at the same cottage, requested and confirmed together as one booking.
_Avoid_: Hourly session, separate nightly bookings

**Marketplace Time**:
Iraq local time (UTC+3), which governs overnight slots, availability calendars, response deadlines and booking notifications.
_Avoid_: Customer-selected time zone, owner-selected time zone

**Booking Request**:
A customer's request to reserve an available stay. It awaits a decision from the cottage owner and is not yet a confirmed booking.
_Avoid_: Booking, reservation, order

**Confirmed Booking**:
A booking request that the cottage owner has accepted, committing the cottage and customer to the stay under the recorded price, rules and terms.
_Avoid_: Accepted request, pending booking

**Completed Booking**:
A confirmed booking that automatically completes at its scheduled check-out time unless the cottage owner or a platform administrator records an incident first.
_Avoid_: Open booking, unverified stay

**Booking Confirmation**:
The customer-visible record created when an owner accepts a booking request. It has a unique booking reference and includes the stay dates, price, house rules, access details and cottage owner contact information.
_Avoid_: Informal acceptance, mutable listing

**Booking Snapshot**:
The preserved record of a booking request's cottage, stay, price and house rules at the moment the customer submits it. Later cottage edits do not change that record.
_Avoid_: Current listing, mutable quote

**Terms Acceptance**:
The customer's required confirmation, before submitting a booking request, that they accept the cottage's house rules and the applicable marketplace booking terms. The accepted versions are preserved in the booking snapshot.
_Avoid_: Implied consent, current terms

**Booking Party**:
The verified customer submitting a booking request and the declared total number of guests for the requested stay. The party size cannot exceed the cottage's published capacity.
_Avoid_: Anonymous group, guest document collection

**Booking Note**:
An optional short message from the customer attached to a booking request for practical context. It does not replace the declared guest count or the cottage's house rules.
_Avoid_: Booking terms, unstructured guest count

**Pending Hold**:
The temporary exclusive claim a booking request places on every overnight slot in its requested stay while the cottage owner decides. It prevents competing requests and cannot be replaced by a private block; it ends only when the request is accepted, declined or expires.
_Avoid_: Confirmed booking, permanent block

**Response Deadline**:
The four-hour period in which a cottage owner must accept or decline a booking request before its pending hold expires and the overnight slot becomes available again.
_Avoid_: Indefinite pending request, manual follow-up window

**Owner Request Notification**:
The immediate alert sent to a cottage owner when a booking request creates a pending hold. The owner backoffice also presents the request as requiring action before the response deadline.
_Avoid_: Passive calendar update, delayed digest

**Customer Status Notification**:
The immediate alert sent to a customer when their booking request is accepted, declined or expires.
_Avoid_: Manual status checking, silent expiry

**Stay Reminder**:
The customer notification sent 24 hours before scheduled check-in, containing the booking reference, access details and cottage owner contact information.
_Avoid_: Post-stay notification, informal reminder

**Owner Stay Reminder**:
The cottage owner notification sent 24 hours before scheduled check-in for a confirmed booking, prompting preparation and review of the booking details.
_Avoid_: Customer reminder, post-stay notification

**Booking History**:
The customer-visible record of a customer's current and past booking requests, and the owner-visible record of upcoming, current and past bookings for each cottage.
_Avoid_: Hidden transaction log, analytics report

**Decline Reason**:
The owner-provided explanation for declining a booking request, selected from a short set of reasons with an optional note. It is shown to the customer.
_Avoid_: Silent decline, unrecorded rejection

**Request Withdrawal**:
The customer's cancellation of a pending booking request before the owner decides. It immediately releases the pending hold; changing a request requires withdrawal and submission of a new request.
_Avoid_: Editing a pending request, confirmed-booking cancellation

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
Arabic is the only language promised in the MVP, including a right-to-left customer and owner experience. Kurdish is a future expansion, not a launch capability.
_Avoid_: Bilingual launch, English-first launch

**Base Price**:
The cottage owner's standard Iraqi-dinar price for one overnight slot at a cottage.
_Avoid_: Hourly price, package price

**Date Price Override**:
A cottage owner’s replacement price for a specific overnight slot date, such as a holiday or peak weekend, instead of the cottage’s base price.
_Avoid_: Dynamic surge price, hourly adjustment

**Stay Price**:
The total price quoted for a stay, calculated by adding the applicable nightly price for every overnight slot in that stay.
_Avoid_: Package price, negotiated total

**Cottage Profile**:
The customer-visible structured facts about a cottage: guest capacity, bedrooms, bathrooms, key amenities, photos and approximate location. A complete cottage profile is required for publication.
_Avoid_: Free-text listing, owner note

**Cottage Search**:
The customer search experience for finding published cottages by approximate location, arrival date, number of nights, guest capacity and optional key amenities. It returns only cottages with every overnight slot in the requested stay available.
_Avoid_: Map-first discovery, general directory

**House Rules**:
The customer-visible restrictions and expectations that apply to a cottage stay, including family, event and smoking restrictions. House rules are required before publication.
_Avoid_: Private owner preference, hidden condition

**Content Change**:
An owner change to a published cottage's photos, description, amenities, house rules or location. It requires RentCottage team approval before customers see it.
_Avoid_: Immediate edit, operational change

**Operational Change**:
An owner change to a cottage's price or availability. It takes effect immediately and does not require RentCottage team approval.
_Avoid_: Content change, publication review

**Private Block**:
An owner-created block on one or more overnight slots for personal use or an off-platform booking. A private block makes those slots unavailable to RentCottage customers without storing off-platform customer details.
_Avoid_: Booking request, confirmed booking

**Availability Calendar**:
The owner-controlled calendar that determines which overnight slots a published cottage can accept. A newly published cottage begins with every slot unavailable until the owner explicitly opens dates.
_Avoid_: Implicit availability, always-open calendar

**Public Availability**:
The availability information shown to customers for a cottage: an overnight slot is available or unavailable, without revealing another customer's identity, booking status or the reason for unavailability.
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
