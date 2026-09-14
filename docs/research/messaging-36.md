# Booking conversations: research for issue 36

Status: owner accepted separate booking conversations and the 30-day writing window. The required prerequisite merge is complete, and implementation planning has resumed. Research date: 14 September 2026. Inspected RentCottage base: `40f5993f3104cc4ceb30cbb4a23654ab92969857`. Scope: conversation identity for repeat bookings, inquiry continuity, contact access and post-booking closure. No logged-in competitor accounts, customer data or live bookings were accessed.

## Airbnb findings

Airbnb's current guest/host help says each reservation automatically creates a group conversation. It supports messages before booking and after completion. This supports organizing conversations around reservations; it does not expose Airbnb's internal database identity or specify every inquiry-to-reservation merge case. [Read and send messages](https://www.airbnb.com/help/article/145).

Inquiries concern proposed dates before a trip request, and hosts can invite the inquirer to book. This supports preserving practical pre-booking context, but the precise migration of inquiry history is not documented in this source. [Respond to an inquiry](https://www.airbnb.com/help/article/2410).

Archiving and closing are different. Airbnb archives reservation conversations at the later of 30 days after the reservation ends or seven days after the last message. Booking threads more than a year old close. The wording does not precisely define the age anchor, so this is not evidence for a cutoff exactly one year after checkout. [Manage messages](https://www.airbnb.com/help/article/3558). An archived conversation can receive a new message and return to the active inbox; read-only is a separate state. [Archive messages](https://www.airbnb.com/help/article/3554).

Airbnb exposes guest phone details after confirmation and removes them from the reservation details on cancellation. Some locations use temporary numbers expiring two days after checkout. These phone rules are not message-thread expiry rules. [Contacting guests by phone](https://www.airbnb.com/help/article/4155).

Airbnb prohibits diverting current, future or repeat bookings off its platform. Contact access after confirmation does not imply permission to arrange subsequent bookings elsewhere. This is a platform policy comparison, not legal advice or a proposal to copy Airbnb's terms. [Off-platform policy](https://www.airbnb.com/help/article/2799).

One documentation caveat: Airbnb's scheduled-replies help also describes collapsible timelines when a guest has multiple reservations. That is not enough to establish that all reservations share one writable conversation, and the explicit reservation-thread guidance is stronger evidence for the ordinary current model. [Scheduled replies](https://www.airbnb.com/help/article/2897).

## Comparable platforms

Booking.com's Connectivity documentation explicitly creates an empty conversation for each reservation. It also identifies pre-reservation request conversations and their request reference. This is strong evidence for transaction-specific identity; it does not fully specify how every consumer interface presents converted inquiry history. [Managing conversations](https://developers.booking.com/connectivity/docs/messaging-api/managing-conversations).

Booking.com's Demand documentation allows guests to send until 66 days after checkout or cancellation, hosts to initiate until seven days, and hosts to reply within 14 days of a guest message even beyond that initial window. It says conversation history is retained for a year. These are integration rules, not a verified walkthrough of every consumer interface. [Messaging FAQs](https://developers.booking.com/demand/docs/messaging/messaging-api-faqs). Its companion timing table ambiguously lists both a 66-day guest read window and one-year all-user reading; do not use that table to assert a precise universal consumer read deadline. The sending rules agree. [Manage messages](https://developers.booking.com/demand/docs/messaging/manage-messages).

Vrbo's own inbox guide ties conversations to inquiry, request, booked and post-stay states, with dates and reservation identifiers. Contact details appear after confirmation. The page does not establish whether repeat reservations share a native thread or specify a sending cutoff. [Vrbo inbox](https://help.vrbo.com/articles/How-do-I-use-the-Inbox). Vrbo also identifies pre-booking phone/email messages and directing travellers elsewhere as potential off-platform booking behaviour. [Off-platform booking](https://help.vrbo.com/articles/About-offline-booking).

Guesty's own property-management inbox keeps separate threads for Airbnb, Booking.com and Vrbo reservations and exposes returning-guest context separately. It merges certain other same-guest reservations, demonstrating that a relationship-level inbox is a possible product choice, not the only way to support returning customers. This source describes Guesty's integration behaviour; it is not independent proof of every marketplace's native interface. [Guesty conversation merging](https://help.guesty.com/hc/en-gb/articles/9383223508125-Merging-same-guest-reservations-into-a-single-conversation-thread).

## RentCottage constraints and decision

Issue 36 and `CONTEXT.md` require the inquiry to follow its Booking Request and Confirmed Booking, protect contacts before payment, and make the booking conversation read-only seven days after the Booking Period ends. The product requirements repeat that rule; reviews separately remain available for 14 days. Those were the rules at research time; the owner subsequently approved the 30-day writing window recorded below.

The thread-identity choice and message cutoff are separate decisions. A conversation per booking makes the relevant dates, payment permission and evidence clear. A single lifetime customer/cottage conversation would require additional rules when one booking is paid and another is unpaid or when an older booking's cutoff passes while a future booking is active.

Previous contact disclosure cannot be undone by starting a new conversation. Separate threads prevent accidental permission inheritance and keep the booking record intelligible; they cannot guarantee repeat customers never communicate elsewhere. Avoid claiming that closing a thread alone prevents marketplace bypass.

## Accepted recommendation

Adopt one conversation for each booking journey, preserving the initial inquiry into its request and resulting booking. A later independent booking uses a separate conversation even with the same customer, owner and cottage. Payment recovery for the same request remains in the same conversation. Do not merge an earlier paid conversation into a later unpaid booking or reopen an old closed conversation when a new booking starts.

Each conversation should visibly identify its cottage, booking dates when known, request/booking status and writing deadline. This is essential context for the requested feature; it does not require a new customer-management system, group chat or automatic archival feature. Prior history stays readable to its authorized participants and support. Keeping records readable does not promise indefinite retention or authorize copying competitors' deletion policies.

Retain the approved payment rule: contact information can be shared only after successful capture establishes that journey's valid Confirmed Booking. Competitors' use of the word confirmed must not weaken RentCottage's existing authoritative payment contract. New journeys start with contact protection even if the same people booked before.

**Recommend changing the post-booking writing window from seven to 30 days after the booked period ends**, then retaining read-only history. This is our product judgment, not an industry standard or a claim that Airbnb closes after 30 days. It leaves room for forgotten-item coordination and practical follow-up beyond the first week, and remains open throughout RentCottage's separate 14-day review window. Those are plausible use cases, not measured customer-demand findings. A fixed cutoff is easier to explain than copying Booking.com's asymmetric initiation/reply clocks, while avoiding a year-long writable booking conversation. The tradeoff is a longer opportunity for unwanted contact and moderation work.

The seven-day symmetric closure is defensible as a deliberate restrictive product policy, but the reviewed sources do not establish it as a standard privacy requirement. Keeping it purely because it already appears in the draft would not resolve the user-experience question the owner asked us to research. Nor does the evidence prove that 30 days is optimal; it is a bounded recommendation for owner judgment.

The 30-day proposal above addresses confirmed bookings, using their preserved Booking Period rather than mutable cottage schedules. It does not silently define a new inquiry expiry or cancellation-triggered deadline. The fixed implementation plan must explicitly settle those terminal cases against the approved scope before construction. Failed payment retries must not create duplicate chats, and two separate future bookings must not compete for one thread's deadline.

## Owner decision and next step

The owner accepted (1) separate booking conversations with inquiry continuity and independent payment permissions and (2) the proposed 30-day post-booking writing window, subject to waiting for the other task to merge and advancing this job first. PR 243 is now merged; job/36 was fast-forwarded to `903258a38b91ac42fbca9667e1179fc8481f5252`, preserving this research.

The local glossary and product requirements now reflect that approval. The live issue's seven-day wording needs the same exact correction during authorized tracker delivery. Refresh the architect plan and obtain its fixed-plan review before product construction. Preserve original and translated messages, authorization proofs, contact-block audit and the complete verification requirements already in scope.

## Verification and limits

Primary pages were read directly and compared across the platform-owned help and developer documentation. No private competitor APIs were called. No live booking flow, response-time claim, conversion improvement or user study is asserted. Native inquiry conversion and Vrbo's native repeat-booking/closure behaviour remain partly undocumented publicly. These gaps are recorded rather than filled from community anecdotes.

This change is a research document only. Formatting and diff checks are appropriate; product, browser and database tests are not evidence for documentary research and were not rerun.
