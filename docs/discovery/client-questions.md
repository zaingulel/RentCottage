# Questions for the RentCottage client

These questions need the client's product or commercial input before the MVP can be fully specified. Each question includes the current recommendation as a starting point, not a decision already made.

## 1. Pilot location and inventory

Which governorate or city should the marketplace launch in, and how many cottage owners can participate in the pilot?

**Why it matters:** A focused launch needs enough nearby inventory to make customer search useful. Location also affects owner onboarding, support and local compliance checks.

**Current recommendation:** Launch in one governorate or tightly connected metro area with roughly 5–10 invited cottages, chosen according to the client's existing owner relationships.

## 2. Standard or owner-specific stay times

Should every cottage use the same overnight slot of 2:00 PM to 11:00 AM the following day, or may each owner define different check-in and check-out times?

**Why it matters:** Standard times make cottages easier to compare and simplify availability. Owner-specific times offer flexibility but introduce more operational and booking complexity.

**Current recommendation:** Use one marketplace-wide overnight slot for the MVP. Owners can block dates and set prices, but cannot redefine the booking period.

## 3. MVP payments and funds flow

How should a customer pay for a confirmed booking: cash on arrival, a deposit before arrival, or the full amount online? If money is paid online, who receives it and who processes refunds?

**Why it matters:** This changes the booking state machine, no-show risk, cancellation/refund policy, owner payout, tax/accounting responsibilities and regulatory exposure.

**Research required:** Confirm official Stripe availability for Iraq, then shortlist Central Bank of Iraq-licensed payment providers and check their API, onboarding, settlement, refund, KYC and supported-currency terms directly.

**Current recommendation:** For a pilot, consider cash payment to the cottage owner on arrival and keep RentCottage out of holding or splitting funds. This needs a clear cancellation/no-show policy and does not preclude adding a licensed-provider deposit later.

## 4. Cancellation policy

Should cancellation rules be the same for every cottage, or may each cottage owner define their own rules? What cancellation deadlines and consequences should apply to customers and owners?

**Why it matters:** Customers need clear terms before booking. The answer also determines availability release, refunds or deposits, no-show handling, owner cancellation treatment and support/dispute work.

**Current recommendation:** Use one marketplace-wide cancellation policy for the MVP. Decide the exact deadlines and payment consequences after the payment model is confirmed.

## 5. Support and disputes

What responsibility should RentCottage take when a customer or cottage owner reports a problem with a booking, the property or payment?

**Why it matters:** The answer determines customer promises, support staffing, incident records, deactivation rules, payment disputes and the marketplace's legal/commercial position.

**Current recommendation:** Provide a visible support contact and record incidents, but do not promise to arbitrate accommodation-quality or payment disputes in the MVP. RentCottage may deactivate a cottage or owner for safety or policy concerns.

## 6. Booking-request cut-off

How close to the 2:00 PM check-in time may a customer submit a booking request?

**Why it matters:** Owners have a four-hour response deadline. Requests that arrive too late can expire after the customer would reasonably need travel and access details.

**Current recommendation:** Stop accepting new requests six hours before check-in, leaving the owner response window plus two hours for confirmation and travel planning.

## 7. Owner verification and documents

What evidence must a cottage owner provide to prove identity and authority to rent a cottage, and should RentCottage store any identity or ownership documents?

**Why it matters:** This affects trust, privacy, document security, retention duties, owner onboarding time and the meaning of any approval status.

**Current recommendation:** Verify evidence manually outside the MVP and store only an approval status and review date in RentCottage. Do not upload or retain national IDs or ownership documents in the product until legal requirements are confirmed.
