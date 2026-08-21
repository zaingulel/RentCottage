# RentCottage booking terms: Iraq legal baseline and Airbnb prior art

Research date: 21 August 2026
Purpose: primary-source research for Issue #32 and the customer Booking Terms decision.
Status: product/legal research for owner and qualified Iraqi counsel; **not legal advice and not customer-facing clauses**.

## Executive answer

RentCottage should not approve final Booking Terms or resume the frozen Issue #32 implementation until qualified Iraqi counsel resolves two points that can change the booking state machine:

1. **Article 13 appears, on its face, to require two customer confirmations separated by a trader-sent message.** The Arabic text first refers to the customer confirming the order, then requires the electronic trader to send a message containing the prescribed pre-contract information, and says the contract is not concluded unless the customer confirms agreement to what is in that message. It does not mandate a particular button, screen or delivery channel. A review-and-submit journey can therefore remain the visual pattern only if counsel confirms that the final binding action occurs after the required message has been delivered. A conventional single submit that causes the message to be sent afterwards does not match the text's apparent sequence. [Official Gazette 4818, Regulation No. 4 of 2025, Article 13](https://moj.gov.iq/upload/pdf/4818_compressed_323.pdf#page=16)
2. **Accommodation is not a stated Article 14 exception.** The listed service exception covers transport or catering/feeding services, not accommodation. Article 13(3) also calls for a clear mechanism by which either side may correct or cancel an order before the service is delivered. The regulation does not state the monetary consequences of every cancellation, so it is not possible to conclude from these provisions alone whether RentCottage's settled inside-48-hours no-refund rule is enforceable. Counsel must resolve that before the rule is written into customer terms. [Official Gazette 4818, Articles 13–14](https://moj.gov.iq/upload/pdf/4818_compressed_323.pdf#page=16)

The rest of the product direction remains sound: use distinct request, payment and confirmation states; show the inclusive total and cancellation outcome before any payment authorization; preserve the accepted listing, House Rules and terms; distinguish an authorization release from a refund; disclose the actual operator and service provider; and give customers a retrievable record and complaint route.

Airbnb remains useful only as operational prior art. Its current request-to-book, payment, cancellation, service-problem, disruptive-event and off-platform patterns show how to explain those topics, but its entities, 24-hour response window, policies, AirCover, credits, rebooking promise and governing law are not RentCottage terms and should not be copied.

## Evidence labels used below

- **Confirmed primary-source text** means the point is stated in an official law, government/regulator page or Airbnb's own current terms/policy.
- **Reasonable product inference** means a product conclusion drawn from that text. It is not a statement of Iraqi law.
- **Unresolved counsel question** means the sources do not settle how the rule applies to RentCottage, federal Iraq and the Kurdistan Region, or the proposed contract/payment structure.

The Arabic Official Gazette text is controlling for Regulation No. 4 of 2025. English descriptions of that regulation in this note are faithful working summaries, not an official translation. The 2010 Consumer Protection Law and 2012 Electronic Signatures and Transactions Law links below are English translations issued by the Iraqi Ministry of Justice.

## Material effect on the approved Issue #32 plan

The approved recovery plan correctly requires exact English, Arabic and Sorani Booking Terms, an immutable version/effective date and a named approver before implementation. This research adds two necessary pre-edit decisions:

1. Add a **counsel-approved Article 13 formation sequence**. The plan must not assume that the existing one-submit acceptance is sufficient. It may need an initial review/request-confirmation event, a generated and delivered Article 13 message, and a separate customer agreement confirmation before payment authorization or before the request becomes capable of acceptance.
2. Add a **written cancellation opinion** covering Articles 13(3) and 14. Do not freeze the 48-hour no-refund copy until counsel confirms the customer's cancellation/rescission right, the refund consequence, and whether any federal or Kurdistan Region rule changes it.

Those are material changes because they can affect payment timing, the Booking Request state machine, the Booking Snapshot, notification evidence and tests. The research does **not** choose the legal answer or authorize code changes.

## 1. RentCottage behaviour the terms must describe

In this research note, **Marketplace Time** means Iraq local time (UTC+3).

The settled product vocabulary is in [CONTEXT.md](../../CONTEXT.md), and the current Minimum Viable Product (MVP) outcomes are in the [MVP product requirements document](../product/rentcottage-mvp-prd.md). The customer terms must accurately describe the implemented flow; terms cannot repair a different implementation after the fact.

| Stage | Settled RentCottage behaviour | Required customer disclosure or unresolved decision |
| --- | --- | --- |
| Identity and quote | Browsing is public. A phone-verified customer selects the cottage and period, supplies a name, party size and optional Booking Note, and sees the Booking Price, separate Booking Service Fee and Customer Total. | Identify the contracting parties, service, period/timezone, capacity, inclusive total, customer data needed and any minimum-age/authority rule. |
| Review | The customer accepts House Rules, the cancellation policy and Booking Terms. A separate warning applies when the period begins inside 48 hours. New requests close six hours before the first shift. | The terms and interface must say that the customer is making a request, not receiving an instant confirmed booking. **Counsel must define the Article 13 message and confirmation sequence.** |
| Payment authorization | The full Customer Total is reserved before a Booking Request and Pending Hold exist. It is not yet captured. | State the exact amount/currency, fee breakdown, provider/payment method, what an authorization does, and what bank/provider timing is outside RentCottage's control. Do not call the reservation a charge, deposit or refund. |
| Pending request | One immutable Booking Request and full-period Pending Hold are created. The owner has four hours to accept or decline. | State that there is no Confirmed Booking yet, the response deadline, how status is delivered and the customer's pending-withdrawal right. |
| Decline, withdrawal or expiry | The hold ends and the payment authorization is released. | Explain the difference between a release and a refund. Promise a release/posting timeframe only after the selected licensed provider proves it. |
| Owner acceptance and capture | Owner acceptance triggers automatic full capture. A booking becomes Confirmed only after capture succeeds. | Explain that owner acceptance alone is not confirmation and identify the event that forms each relevant contract after counsel resolves it. |
| Payment Required | If capture fails after owner acceptance, a 20-minute recovery state applies; otherwise the request expires. | Explain permitted customer action, the exact deadline and the result if payment remains unavailable. Confirm the provider supports the promised action. |
| Paid confirmation | The customer receives the unique reference, period, price, rules, exact access details and owner contact. Mutual direct contact is disclosed only after successful payment. | State what is disclosed, to whom, for what purpose and when. Give the customer a durable record of the accepted terms and booking facts. |
| Customer cancellation | The current product decision is a full Customer Total refund at least 48 hours before the first shift and no standard refund inside 48 hours or for no-show. | **Do not put this into final legal copy until counsel resolves Articles 13(3) and 14 in federal Iraq and the Kurdistan Region.** Define deadline timezone, refund method/timing and mandatory rights. |
| Owner Cancellation or Administrator Cancellation | Both give the Customer a Full Refund. For an Owner Cancellation, the Cottage Owner must provide a reason, the marketplace creates a Booking Incident, and repeated or unjustified cancellations may cause the Cottage to be paused for Platform Administrator review. Separately, an Administrator Cancellation is a Platform Administrator action for a recorded safety, fraud, legal, or serious operational reason that creates an Administrator Audit Record and Booking Incident. | Decide remedies for no access, material misdescription, unsafe/unusable accommodation and disruptive events. Do not promise comparable-cottage rebooking unless the operation can deliver it. |
| Communication | Before payment capture, in-platform messaging blocks direct contact details and external links. After confirmation, direct contact may be shared. | Explain anti-fraud/privacy purpose and boundaries, prohibited payment/contact bypass, moderation, retention, sharing and the linked Privacy Policy. |

## 2. Iraq Regulation No. 4 of 2025

Regulation No. 4 of 2025, *Regulation of Electronic Commerce*, was published in Official Gazette issue 4818 on 10 March 2025. Article 28 states that it takes effect 30 days after publication. Article 27 expressly says its application must take account of the Commerce Law, Companies Law, Electronic Signatures and Transactions Law, Consumer Protection Law and related legislation. It must therefore be read with those laws, not as a complete booking-code by itself. [Official Gazette issue 4818](https://moj.gov.iq/upload/pdf/4818_compressed_323.pdf)

### Article-by-article findings

| Article | Confirmed primary-source text | Reasonable product inference | Unresolved counsel question |
| --- | --- | --- | --- |
| **2 — territorial scope** | The Regulation applies to both parties to an activity if either or both are inside Iraq, subject to related legislation. | A transaction involving an Iraqi customer, owner or operator should be treated as potentially in scope even if a technology or payment supplier is abroad. | How the federal Regulation is applied and enforced in the Kurdistan Region; which party/location controls for each contract. |
| **5 — sector approvals** | If the trader's products or services require approval from a competent body, that approval must accompany the e-commerce licence application. | E-commerce licensing does not replace cottage, tourism, municipal, safety or payment approvals. Owner onboarding must record the actual approval/exemption basis. | Which approvals apply to RentCottage and to each cottage/property type and governorate. |
| **6 — e-commerce licence** | No electronic trader may practise e-commerce in the Republic of Iraq without a Ministry of Trade licence and completion of all approvals required by competent bodies. | Launch needs a real licensed operator, not a placeholder entity or a statement that RentCottage is “only a platform.” | Is RentCottage, each professional Cottage Owner, or both an “electronic trader” for the services they provide? What regional licence is required in the Kurdistan Region? |
| **7 — store disclosures and controls** | The electronic trader must clearly provide its full name/address, e-commerce licence number, contact methods, privacy policy, complaint procedure and response time, account/notification/data controls, payment methods, a frequently asked questions page, request/complaint response timing, detailed return/exchange policy and expected service-delivery time. Customers must be able to access their personal data, changes, privacy policy, applicable terms and how those are stored. Encryption and cybersecurity duties also appear. | The Booking Terms page alone is insufficient. RentCottage also needs stable operator/contact/licence, privacy, complaint, account/data and service-timing surfaces that agree with it. | Which Article 7 fields belong to RentCottage versus the owner; what “return/exchange” means for accommodation; the exact complaint response commitment and data-deletion exceptions. |
| **13(1) — pre-contract information** | Before contract, the trader must provide the contracting procedure, trader data, accurate product/service description, total including fees/taxes/additional delivery costs, payment mechanism, maximum delivery period, correction/cancellation period, non-conformity return mechanism, termination mechanism and after-sales service if any. | Put the exact service, parties, inclusive Customer Total, payment lifecycle, correction/cancellation and problem remedies in a customer-readable review record before any binding act. | Which contract is contemplated when RentCottage has platform/payment obligations and an owner-provided accommodation service. |
| **13(2) — message and confirmation** | When the customer confirms the order, the trader must send a message containing the Article 13(1) information. The contract is not considered concluded unless the customer confirms agreement to what the message states. | Preserve the exact message and a later customer acknowledgement. Do not equate an email receipt sent after a binding submit with the required prior confirmation without counsel support. | Whether a generated in-app review message is sufficient; whether it must also be sent by Short Message Service (SMS), email or another channel; which contract forms and when; payment-authorization timing. |
| **13(3) — correction/cancellation** | The trader must provide a clear mechanism protecting the customer's rights and allowing either trader or customer to correct an error or cancel the order while the goods or service have not been delivered or shipped. | The journey needs a clear correction and cancellation route, not merely buried wording. The pending withdrawal path is helpful but may not be enough after confirmation. | Whether and on what terms a confirmed accommodation booking may be cancelled before the stay; refund effect; interaction with no-rescheduling and the 48-hour policy. |
| **14 — exceptions to rescission** | The customer lacks a rescission right for seven listed categories unless the product is defective or non-conforming: customer-made goods; used recordings/software; newspapers/magazines/publications/books; customer-caused defects; transport or catering/feeding services; downloaded electronic products/software; and other cases later specified by the Ministry. | Accommodation should not be treated as an exception merely because Airbnb or another marketplace uses non-refundable policies. | Whether accommodation falls under another legal category or later Ministry determination; whether rescission necessarily requires a refund and on what basis. |
| **15 — collection, use, security and retention** | Only necessary data may be collected for specified lawful purposes; customers must be told clearly what is collected and why; processing must be lawful and transparent; use must match the approved purposes; storage must be secure; retention lasts only as long as necessary for the collection purpose. | Booking Terms should link, not duplicate, a complete Privacy Policy. Preserve contract evidence under a counsel-approved retention basis while minimising operational/customer data. | Each purpose/legal basis, retention period and deletion exception; whether a consent model is appropriate for data necessary to perform the contract. |
| **16 — third parties** | Customer data may not be used and transferred to a third party without the customer's express consent. | Map owner, payment-provider, messaging, hosting, support and regulator disclosures and surface them accurately before collection/transfer. | Scope of “transfer,” required form of express consent, and treatment of processors, legal obligations and necessary contract recipients. |
| **17 — breach notice** | If a breach harms customer data, rights or freedoms, the trader must promptly notify the affected customer, Ministry and competent authorities with breach details and remedial steps; proven trader negligence is not excused. | A real incident and notification process is required outside the terms document. | Notification threshold, timing, competent authorities and federal/Kurdistan allocation. |
| **20 — advertising** | Electronic advertising is a complementary contractual document binding the parties; false or misleading statements are prohibited. The trader must obtain clear express consent before sending an electronic advertisement or notification, offer a way to stop advertisements/notifications, identify advertising as such and include the service/product, trader name and contact details. | Preserve the listing/advertising facts accepted for the booking and define a remedy for material mismatch. Separate marketing consent/preferences from necessary booking communications. | Whether “notification” in Article 20 includes all transactional booking notices or is limited by the advertising context; what proof of consent/opt-out is required. |
| **27 — related law** | The Regulation must be applied with the Commerce Law, Companies Law, Electronic Signatures and Transactions Law, Consumer Protection Law and related legislation. | No single clause or checkbox can settle the full legal position. Entity, licensing, payment, consumer and evidence design must align. | Conflicts, mandatory rights and classification under the wider federal and regional framework. |
| **28 — commencement** | The Regulation takes effect 30 days after its 10 March 2025 publication. | Treat it as an existing launch requirement, not a future proposal. | Exact enforcement practice and any transitional/licensing guidance. |

### Does Article 13 require a second customer confirmation?

**Confirmed text sequence:**

1. The Article 13(1) information must be available before contract.
2. The customer confirms the order.
3. The trader sends the customer a message containing that information.
4. The customer confirms agreement to what is in the message.
5. Only then may the contract be regarded as concluded, subject to any other formation requirement.

The two references are both to action by the **customer**. The text therefore implies two legally distinct customer confirmations, even though it does not prescribe two screens or buttons.

**Product inference:** a compliant-looking request journey would make the first act non-binding (for example, “review request”), generate and deliver the prescribed message, and make the later act the customer's agreement/offer. Owner acceptance and successful capture could still be later conditions for the accommodation contract because Article 13(2) states a necessary customer condition, not necessarily the only condition for formation.

**Counsel question:** could a review page itself count as the message and its one final submit count as the later confirmation, even though the Arabic text says the trader sends the message *when* the customer confirms the order? If counsel says yes, record the exact rationale and interface sequence. If counsel says no, Issue #32 needs a real second acknowledgement state. Engineering should not decide this through button labels.

### Does Article 14 exempt accommodation?

No accommodation, lodging, hotel, cottage or rental category appears in the seven listed exceptions. The service exception expressly names transport or catering/feeding. Article 14(7) permits the Ministry to specify additional cases based on the nature of products or services; no first-party instrument reviewed for this note added accommodation. That search result is not proof that no such instrument exists.

The safe conclusion is narrow: **Article 14 does not itself establish an accommodation exception.** Counsel must check later Ministry instruments and the rest of Iraqi and Kurdistan Region law, then state whether RentCottage can make any confirmed stay non-refundable and what refund/compensation follows a lawful cancellation.

## 3. Trader, supplier and operator identity

### Confirmed primary-source text

- Regulation No. 4 defines an electronic trader broadly as any Iraqi or foreign natural or legal person practising e-commerce professionally, and an electronic store as any electronic means used to offer products or services, including apps, websites and social media. It does not create a separate marketplace/intermediary category or an express platform exemption in the reviewed text. [Official Gazette 4818, Article 1](https://moj.gov.iq/upload/pdf/4818_compressed_323.pdf#page=13)
- Articles 5–7 require the relevant approvals, a Ministry of Trade e-commerce licence and visible trader identity/licence/contact disclosures. [Official Gazette 4818, Articles 5–7](https://moj.gov.iq/upload/pdf/4818_compressed_323.pdf#page=14)
- Iraq's Unified Electronic Portal currently publishes a Ministry of Trade service for obtaining an e-commerce practice licence. The service description says the licence is valid for three years and currently lists a fee of IQD 390,000. Operational portal details can change and must be checked at application time. [Official Ur Portal e-commerce licence service](https://ur.gov.iq/index/show-eservice/62036/19/org)
- The Consumer Protection Law defines a provider broadly enough to include a service provider acting as principal, intermediary or agent, and applies to persons providing, marketing or advertising services. [Official Consumer Protection Law No. 1 of 2010, Articles 1 and 3](https://www.moj.gov.iq/upload/pdf/%D9%82%D8%A7%D9%86%D9%88%D9%86%20%D8%AD%D9%85%D8%A7%D9%8A%D8%A9%20%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D9%87%D9%84%D9%83.pdf)

### Reasonable product inference

RentCottage operates the customer website, sets a separate service fee, controls the request/hold/payment lifecycle, supplies the acceptance interface and handles support/refund decisions. It should be treated as potentially regulated in its own right rather than assuming that a “venue only” label removes duties. A professional Cottage Owner may separately be the electronic trader/provider of the accommodation.

The final terms must use verified facts:

- RentCottage's exact legal name, legal form, registration and business address;
- e-commerce licence number/status and any other applicable approval;
- support/complaint contact and response targets;
- the Cottage Owner's legal or trading identity and contact-disclosure timing;
- which party supplies accommodation, operates the platform, collects payment, decides cancellations/problems, refunds the customer and pays the owner; and
- the selected licensed payment provider's role, without implying that its licence belongs to RentCottage.

### Unresolved counsel questions

- Is the customer making one contract or separate accommodation and platform/payment contracts?
- Is the owner disclosed before request, at the Article 13 message, or only after paid confirmation? Consumer and contract-formation duties may require earlier identity than the current contact-sharing rule.
- Must each professional owner have an e-commerce licence as well as property/tourism approvals?
- Does RentCottage act as agent, payment collection agent, marketplace intermediary, accommodation supplier or more than one role for different obligations?

## 4. Federal Iraq and Kurdistan Region applicability

### Confirmed primary-source text

- Regulation No. 4 says it applies when either or both activity parties are inside Iraq and Article 6 refers to practising e-commerce in the Republic of Iraq. It contains no express Kurdistan Region carve-out. [Official Gazette 4818, Articles 2 and 6](https://moj.gov.iq/upload/pdf/4818_compressed_323.pdf#page=14)
- The Constitution gives regions residual authority over matters not exclusively federal, gives regional law priority in a conflict over non-exclusive matters, and allows a region to amend application of federal law where a non-exclusive matter conflicts with regional law. The exclusive federal list includes sovereign external commercial policy and commercial policy across regional/governorate boundaries, but does not expressly name consumer protection or domestic e-commerce. [Iraqi Council of Representatives, Constitution, Articles 110, 115 and 121](https://iq.parliament.iq/wp-content/uploads/2022/06/pdf%D8%A7%D9%84%D8%AF%D8%B3%D8%AA%D9%88%D8%B1.pdf)
- The Kurdistan Regional Government Ministry of Trade and Industry publishes Law No. 9 of 2010 specifically enforcing federal Consumer Protection Law No. 1 of 2010 in the Kurdistan Region. [Official KRG page](https://archive.gov.krd/moti/www.mtikrg.org/Default0ba9.html?id=941&l=1&page=article)

### Reasonable product inference

The federal Regulation's own wording is broad enough that RentCottage should not assume the Kurdistan Region is out of scope. Conversely, the constitutional allocation and the KRG's separate consumer-law adoption mean that the federal text alone cannot establish the complete regional answer. A single nationwide terms document may need jurisdiction-specific disclosures, licences or mandatory-rights wording even if the core commercial flow remains one product.

### Unresolved counsel questions

- Is Regulation No. 4 directly applied/enforced in the Kurdistan Region, adopted through a regional instrument, modified by regional law or not yet operational there?
- Which Ministry of Trade issues the relevant e-commerce licence for an operator or owner established in the Region?
- Which consumer, tourism, company, tax and court rules apply based on operator, customer, owner and cottage location?
- Can one governing-law/forum clause cover every booking, and which mandatory regional rights override it?

Counsel for this task must be competent in both federal Iraq and Kurdistan Region law. An opinion limited to Baghdad/federal practice is not enough for a marketplace launching in the Region.

## 5. Customer-language obligations

### Confirmed primary-source text

- Consumer Protection Law Article 6(1)(b) gives the consumer full information about service specifications and how to receive the service in an “approved official form and language” in the Ministry's official English translation. Article 6(1)(c) also gives the consumer evidence of receiving a service stating its value, date and specifications. [Official Consumer Protection Law No. 1 of 2010](https://www.moj.gov.iq/upload/pdf/%D9%82%D8%A7%D9%86%D9%88%D9%86%20%D8%AD%D9%85%D8%A7%D9%8A%D8%A9%20%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D9%87%D9%84%D9%83.pdf)
- The Constitution makes Arabic and Kurdish the official languages of Iraq and says federal institutions and official institutions in the Kurdistan Region use both. Turkmen and Syriac have additional official status in administrative units where their speakers form a population density. [Iraqi Council of Representatives, Constitution Article 4](https://iq.parliament.iq/%D8%A7%D9%84%D8%AF%D8%B3%D8%AA%D9%88%D8%B1-%D8%A7%D9%84%D8%B9%D8%B1%D8%A7%D9%82%D9%8A/)
- Regulation No. 4 requires clear customer information and access to the applicable terms but does not itself state that every private electronic contract must be issued in Arabic and Kurdish. [Official Gazette 4818, Articles 7 and 13](https://moj.gov.iq/upload/pdf/4818_compressed_323.pdf#page=15)

### Reasonable product inference

RentCottage should present the complete pre-contract message, Booking Terms, cancellation outcome, House Rules and confirmation record in the customer's selected supported language and preserve that locale. English should not be the only legally meaningful version for an Iraq-focused consumer product. The planned Arabic, Sorani Kurdish and English versions are a sound accessibility/product decision, but they must be exact equivalents approved by qualified human legal translators.

### Unresolved counsel questions

- Does “approved official form and language” require Arabic, Kurdish, both, or the customer's chosen official language for this private service transaction?
- Is Sorani the required/appropriate Kurdish form for every target governorate, and are any other local-language duties triggered?
- May one version control if translations differ, or must Arabic and Kurdish be equally authoritative?
- Is English merely a convenience translation, and how should discrepancies be resolved without disadvantaging a consumer?

Do not label machine- or Artificial Intelligence-generated legal translation as approved. Approval must be dated and tied to exact content hashes for all three locale artifacts.

## 6. Electronic contract and evidence requirements

### Confirmed primary-source text

The Electronic Signatures and Transactions Law No. 78 of 2012:

- applies to electronic transactions and contracts made electronically, and its immovable-property exclusion expressly excepts rental contracts (Article 3);
- recognises electronic offer and acceptance (Article 18);
- gives electronic documents, writing and contracts paper-equivalent legal authenticity when information is saveable/retrievable, retained in its original or another accuracy-proving form without addition/deletion, and identifies the originator/recipient plus sending/receipt date and time (Article 13);
- permits information to be supplied in paper form during an electronic transaction if the recipient can print, store and later refer to it (Article 15);
- provides rules for acknowledging receipt and for proving that received content matches sent content (Article 19); and
- gives a certified electronic signature the same evidential conclusiveness as a written signature only when the separate statutory conditions are met (Articles 4–5).

Source: [Iraqi Ministry of Justice, official English translation of Law No. 78 of 2012](https://moj.gov.iq/upload/pdf/%D9%82%D8%A7%D9%86%D9%88%D9%86%20%D8%A7%D9%84%D8%AA%D9%88%D9%82%D9%8A%D8%B9%20%D9%88%D8%A7%D9%84%D9%85%D8%B9%D8%A7%D9%85%D9%84%D8%A7%D8%AA%20%D8%A7%D9%84%D8%A7%D9%84%D9%83%D8%AA%D8%B1%D9%88%D9%86%D9%8A%D8%A9.pdf)

### Reasonable product inference

For each customer confirmation and booking, preserve:

- customer/account identifier and verified phone identity;
- recipient/trader/owner identities relevant to the message;
- exact locale, terms version, effective date and immutable content bytes;
- a content hash as an integrity aid (the law requires provable integrity, not specifically a hash);
- cottage/listing, Booking Period, timezone, party size, price components, Customer Total, House Rules and cancellation outcome shown;
- the exact Article 13 message sent, channel, destination, sent/received timestamps and delivery evidence available;
- the exact customer confirmation action, timestamp and interface version;
- payment authorization/capture/release/refund identities and status evidence; and
- a retrievable customer receipt/confirmation that can be printed or saved.

A normal checkbox/click may be evidence of assent, but it should not be called a **certified electronic signature** unless it actually meets Articles 4–5. The stronger and simpler position is to preserve it as an electronic offer/acceptance and electronic-document record, subject to counsel's evidence requirements.

### Unresolved counsel questions

- Does phone verification plus authenticated confirmation sufficiently identify the originator for this contract value and type?
- Is a certified electronic signature required or merely optional?
- What delivery/receipt evidence is sufficient for the Article 13 message?
- What retention period and customer-retrieval period apply, especially after account deletion?
- Which exact record is the accommodation contract when the customer confirms before owner acceptance and payment capture?

## 7. Current Airbnb prior art — not a template

### Applicability and source currency

For an Iraqi resident, Airbnb's current terms select the version for users outside the European Economic Area, Switzerland, the United Kingdom and Australia. That version is marked **Last Updated: 5 February 2026**; its “all other countries and territories” schedule generally identifies Airbnb Ireland UC for platform activity. The corresponding non-European Payments Terms are also marked **Last Updated: 5 February 2026** and generally identify Airbnb Payments UK for “all other countries.” [Airbnb Terms of Service](https://www.airbnb.com/help/article/2908) · [Airbnb Payments Terms](https://www.airbnb.com/help/article/2909)

The operational help/policy pages below were checked on 21 August 2026. Most show no last-updated date; the Rebooking and Refund Policy shows an effective date of 6 February 2025. This makes them current first-party observations, not promises that Airbnb will never change them.

| Topic | Confirmed current Airbnb pattern | Transferable disclosure principle for RentCottage | Do not copy |
| --- | --- | --- | --- |
| Request to book | A guest can add payment information, review policies/terms and message the host before submitting. A host typically has 24 hours. The guest can withdraw before acceptance; normally the guest is charged after acceptance and not charged after decline/no response. [Airbnb request-to-book guide](https://www.airbnb.com/help/article/85) | Keep Request, Pending, owner decision, payment and Confirmed states visibly distinct. Show the deadline and withdrawal path. | Airbnb's 24-hour period, Instant Book and country/payment exceptions. RentCottage's approved owner window is four hours. |
| Parties and formation | Airbnb says the host–guest reservation contract forms at booking confirmation and separately describes Airbnb's platform and payment roles. [Airbnb Terms, sections 1.2, 4.2 and 15](https://www.airbnb.com/help/article/2908) | Name each party and state the event forming each contract. Allocate accommodation, platform, payment, support and refund obligations. | Airbnb's entities, Irish/English law structure and intermediary disclaimer. Labels must reflect RentCottage's actual control. |
| Payment timing | Airbnb Payments generally charges the total after host acceptance, with exceptions for some push/alternative payment methods. Successful payment is followed by confirmation. [Airbnb Payments Terms, sections 2.5–2.7](https://www.airbnb.com/help/article/2909) | Explain exact provider-dependent authorization, capture and confirmation timing. | Airbnb's payment entities and payment-method exceptions. RentCottage is materially different because it plans a full pre-request authorization. |
| Decline/withdrawal | Airbnb's Payments Terms say amounts collected may be refunded and any applicable pre-authorization released when a request is declined, withdrawn before acceptance or cancelled by Airbnb. [Airbnb Payments Terms, section 2.7](https://www.airbnb.com/help/article/2909) | Use “release” for an uncaptured authorization and “refund” for captured money; explain provider-controlled posting time. | Any exact Airbnb bank/refund timeframe. The selected Iraqi provider must supply RentCottage's evidence. |
| Total price | Airbnb binds the guest to checkout charges and requires mandatory reservation fees to be included in the checkout price. [Airbnb Terms, section 1.2](https://www.airbnb.com/help/article/2908) · [Off-Platform and Fee Transparency Policy](https://www.airbnb.com/help/article/2799) | Show and preserve Booking Price, Booking Service Fee, tax/other charge if any, and Customer Total before authorization. | Airbnb's fee model and refundable/non-refundable fee rules. |
| Cancellation visibility | Airbnb displays the applicable cancellation policy on the listing, at confirm/pay and in the confirmation email. The cancellation journey previews the refund before final confirmation. [Airbnb guest cancellation guide](https://www.airbnb.com/help/article/4052) | Repeat the accepted cancellation outcome at review, in the Article 13 message, in paid confirmation and before a customer confirms cancellation. Use Marketplace Time consistently. | Host-selectable Airbnb policy text. RentCottage's 48-hour rule requires Iraqi counsel review. |
| Grace period | Airbnb's current standard short-stay policies generally include a 24-hour post-confirmation cancellation period when confirmation is at least seven days before check-in. [Airbnb home cancellation policies](https://www.airbnb.com/help/article/475) | Decide deliberately whether any post-confirmation grace period exists after counsel advice. | Treating Airbnb's grace period as Iraqi law or silently adding it to RentCottage. |
| Owner cancellation and service problems | Host cancellation gives a full refund and possible help finding a similar stay. Qualifying problems include no access, uninhabitable/unsafe accommodation and significant mismatch; guests generally report within 72 hours with evidence, after which Airbnb may refund/rebook. [Rebooking and Refund Policy, effective 6 February 2025](https://www.airbnb.com/help/article/2868) | Define no-access, safety/habitability, material-misdescription, reporting, evidence, decision and remedy paths. Preserve statutory rights. | AirCover, 72 hours, travel credit or a comparable-stay/rebooking guarantee without operational capacity. |
| Major disruptive events | Airbnb can override the listing cancellation policy for specified large-scale events that prevent or legally prohibit completion: declared health emergencies, mandatory travel restrictions, war/hostilities, large essential-utility outages and unforeseeable disasters/severe weather. [Major Disruptive Events Policy](https://www.airbnb.com/help/article/1320) | Decide what happens when neither customer nor owner is at fault and the stay is impossible/illegal. | Airbnb's coverage definitions, geographic activation, credits and discretionary decision machinery. |
| Off-platform payment/contact | Airbnb prohibits moving bookings or reservation payments off-platform, requires mandatory fees at checkout, keeps pre-booking communications on-platform and restricts unrelated use of contact/identity data. [Off-Platform and Fee Transparency Policy](https://www.airbnb.com/help/article/2799) · [customer explanation](https://www.airbnb.com/help/article/209) | Explain the anti-fraud/privacy purpose of RentCottage's pre-payment contact filter, prohibit undisclosed charges and payment bypass, and constrain owner use of customer data. | Airbnb's AirCover warning, enforcement outcomes and exceptions. RentCottage must promise only its actual protections. |

### Airbnb-specific terms that should not migrate

- Airbnb Ireland UC, Airbnb Payments UK or any Airbnb schedule/entity.
- Airbnb's 24-hour owner-response or post-confirmation grace periods.
- AirCover, travel credits, comparable-stay rebooking, worldwide support or a 72-hour problem rule.
- Airbnb's host damage, chargeback, payout, tax, governing-law, court, arbitration, liability or indemnity provisions.
- A claim that RentCottage is merely a neutral venue when its actual product control and Iraqi classification may say otherwise.

## 8. Recommended Booking Terms content brief

This is a structure for counsel to draft/approve, **not proposed legal wording**.

1. **Title, version, effective date and scope** — exact bookings governed; historic versions remain retrievable.
2. **Operator, owner and payment roles** — verified legal names, addresses, registration/licence/contact details, service allocation and any agency/collection authority.
3. **Customer eligibility and authority** — verified phone account, age/capacity, accurate identity/party details and authority for guests.
4. **Booking details and incorporated records** — cottage, Booking Period/timezone, party size, total, listing snapshot, House Rules, cancellation terms and document precedence.
5. **Article 13 review/message/confirmation** — counsel-approved sequence, exact customer action and when the request becomes an offer or contract-capable instruction.
6. **Booking Request** — six-hour cut-off, four-hour owner window, Pending Hold, no confirmation yet, withdrawal, decline and expiry.
7. **Price and payment** — inclusive total and components, provider/method, authorization, capture, release, Payment Required, failure/unknown outcome and statement timing.
8. **Contract formation and paid confirmation** — event forming each contract, successful-capture boundary, customer record and staged access/contact disclosure.
9. **Correction, withdrawal, cancellation, no-show and refunds** — Article 13/14-compliant rights, exact deadlines/timezone, refund components/method/timing, exceptions and mandatory rights.
10. **Owner Cancellation or Administrator Cancellation and accommodation problems** — no access, material misdescription, safety/habitability, evidence/reporting, remedy and limits of any rebooking help.
11. **Major disruptive events** — narrow owner/counsel-approved events, decision evidence and refund/rescheduling outcome.
12. **Communication and off-platform conduct** — approved pre-payment restrictions, no undisclosed/off-platform charge, post-confirmation contact, moderation and prohibited misuse.
13. **Customer conduct and House Rules** — capacity, lawful use, responsibility for the Booking Party, safety and damage rules; no damage deposit unless product scope changes.
14. **Privacy and data sharing** — concise booking-specific summary and link to the full Privacy Policy; owner/provider sharing and customer controls.
15. **Complaints, incidents and payment disputes** — support channels, response targets, evidence, escalation and regulator/court rights.
16. **Law, courts, mandatory rights and languages** — federal/Kurdistan position, authoritative translations, severability and prospective changes only.

The customer should be able to open, save and print the exact locale/version before confirming it. The Booking Snapshot should preserve version, locale, effective date, immutable content, integrity hash, relevant parties, sent message and confirmation timestamps.

## 9. Owner, counsel and provider decision checklist

No final clauses should be approved while a priority blocker remains unanswered.

### Priority blockers — legal structure and launch authority

- [ ] **Owner + Iraqi/Kurdistan counsel:** exact RentCottage legal entity, registration, business address, support contact and e-commerce licence number/status.
- [ ] **Counsel:** who is the electronic trader and consumer provider for each duty—RentCottage, the Cottage Owner or both?
- [ ] **Counsel:** federal Iraq versus Kurdistan Region applicability, required licences/approvals, mandatory consumer rights, governing law and courts.
- [ ] **Counsel + product:** exact Article 13(2) sequence, message content/channel, two confirmation events and the point at which payment authorization may occur.
- [ ] **Counsel:** whether the Booking Request is the customer's offer and whether owner acceptance plus successful capture forms the accommodation contract; identify any separate platform/payment contract.
- [ ] **Counsel:** effect of Articles 13(3) and 14 on pending withdrawal, confirmed cancellation, the 48-hour no-refund rule, no-show and refund entitlement; confirm whether any later Ministry accommodation exception exists.
- [ ] **Counsel + qualified translators:** Arabic/Kurdish language obligation, Sorani suitability, English status and whether translations are equally authoritative or one controls.
- [ ] **Selected Central Bank of Iraq-licensed provider + counsel:** merchant/collection role, supported payment methods, authorization/capture/release/refund/chargeback/settlement and customer-facing timing. Current provider licensing must be checked on the [CBI list](https://www.cbi.iq/page/25).

### Product and operational decisions

- [ ] **Owner:** minimum age/legal capacity and booking-for-others rule.
- [ ] **Owner + accountant/counsel:** all customer price/tax components and treatment of the IQD 5,000 Booking Service Fee.
- [ ] **Product + provider:** exact 20-minute Payment Required action and outcome.
- [ ] **Owner + counsel:** no-access, material-misdescription, unsafe/unusable accommodation and disruptive-event reporting/evidence/remedies.
- [ ] **Owner:** whether any grace period exists. Do not infer one from Airbnb.
- [ ] **Owner:** confirm operational readiness for the settled Owner Cancellation reason, Booking Incident, and repeated-or-unjustified pause path and the separate Administrator Cancellation audit and Booking Incident path. Both give a Full Refund but carry no comparable-Cottage guarantee unless operational capacity is deliberately added.
- [ ] **Owner + counsel:** customer/party conduct, House Rules and damage liability. Current product has no damage deposit.
- [ ] **Owner:** complaint channels and exact acknowledgement/final-response targets required by Article 7.
- [ ] **Privacy owner + counsel:** all data purposes, recipients, transfers, consent requirements, retention/deletion exceptions and breach-notification procedure.
- [ ] **Owner:** canonical terms approver, one effective version/date and prospective-change policy.
- [ ] **Qualified Arabic and Sorani legal reviewers:** dated approval bound to exact content hashes. Artificial Intelligence output is not approval.

## 10. Verification consequences for Issue #32

After counsel and the owner settle the checklist, the implementation evidence should prove at least:

- the customer receives every Article 13(1) item before the legally operative confirmation;
- the counsel-approved message and confirmation ordering cannot be bypassed or replayed into duplicate requests/authorizations;
- the exact message, terms version/locale, listing/rules/price snapshot, customer action and send/receipt timestamps are retained and retrievable;
- a customer can save/print the accepted terms and booking record;
- unknown versions/locales fail closed;
- cancellation/correction controls match the approved legal outcome at every state;
- operator/licence, privacy, complaints and response-time disclosures are visible and consistent;
- the payment interface uses authorization, capture, release and refund accurately;
- English, Arabic and Sorani render correctly and the human-approved bytes/hashes are the tested bytes; and
- listing/advertising facts preserved in the Booking Snapshot support the approved material-misdescription remedy.

## 11. Primary sources and limitations

### Iraqi official sources

- [Official Gazette issue 4818 — Regulation No. 4 of 2025, pages 11–18](https://moj.gov.iq/upload/pdf/4818_compressed_323.pdf)
- [Iraqi Unified Electronic Portal — Ministry of Trade e-commerce licence service](https://ur.gov.iq/index/show-eservice/62036/19/org)
- [Consumer Protection Law No. 1 of 2010 — official Ministry of Justice English translation](https://www.moj.gov.iq/upload/pdf/%D9%82%D8%A7%D9%86%D9%88%D9%86%20%D8%AD%D9%85%D8%A7%D9%8A%D8%A9%20%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D9%87%D9%84%D9%83.pdf)
- [Electronic Signatures and Transactions Law No. 78 of 2012 — official Ministry of Justice English translation](https://moj.gov.iq/upload/pdf/%D9%82%D8%A7%D9%86%D9%88%D9%86%20%D8%A7%D9%84%D8%AA%D9%88%D9%82%D9%8A%D8%B9%20%D9%88%D8%A7%D9%84%D9%85%D8%B9%D8%A7%D9%85%D9%84%D8%A7%D8%AA%20%D8%A7%D9%84%D8%A7%D9%84%D9%83%D8%AA%D8%B1%D9%88%D9%86%D9%8A%D8%A9.pdf)
- [Constitution of Iraq — Iraqi Council of Representatives](https://iq.parliament.iq/wp-content/uploads/2022/06/pdf%D8%A7%D9%84%D8%AF%D8%B3%D8%AA%D9%88%D8%B1.pdf)
- [KRG Law No. 9 of 2010 enforcing the federal Consumer Protection Law](https://archive.gov.krd/moti/www.mtikrg.org/Default0ba9.html?id=941&l=1&page=article)
- [Central Bank of Iraq — current licensed electronic payment service providers](https://www.cbi.iq/page/25)

### Airbnb first-party sources

- [Terms of Service](https://www.airbnb.com/help/article/2908)
- [Payments Terms of Service](https://www.airbnb.com/help/article/2909)
- [Request-to-book guide](https://www.airbnb.com/help/article/85)
- [Guest cancellation guide](https://www.airbnb.com/help/article/4052)
- [Home cancellation policies](https://www.airbnb.com/help/article/475)
- [Rebooking and Refund Policy for Homes](https://www.airbnb.com/help/article/2868)
- [Major Disruptive Events Policy](https://www.airbnb.com/help/article/1320)
- [Off-Platform and Fee Transparency Policy](https://www.airbnb.com/help/article/2799)
- [Paying and communicating through Airbnb](https://www.airbnb.com/help/article/209)

### Limitations

- No official English translation of Regulation No. 4 of 2025 was located; counsel must verify every working translation against the Arabic text.
- No authenticated Ministry licensing application, enforcement record, court decision or legal opinion was reviewed.
- No official KRG source located in this research resolved the 2025 federal Regulation's regional adoption or enforcement. Absence from the reviewed sources is not evidence of non-application.
- No first-party Ministry instrument located in this research added accommodation to Article 14(7). Counsel must perform a current legislative/administrative check.
- Airbnb pages are prior art only. They do not establish Iraqi law, local provider capability or RentCottage's promised service.
- The selected payment provider has not yet proved the complete delayed-authorization/capture/release/refund/marketplace-settlement lifecycle; customer timing and legal roles remain provisional until it does.

## Recommendation

Keep Issue #32 parked at the legal-content gate. Give this research and the settled RentCottage flow to counsel for a written answer on Article 13 formation, Articles 13(3)/14 cancellation, trader/licence allocation, federal/Kurdistan Region applicability, language authority and payment roles. Counsel should then draft or approve one canonical Booking Terms version and its companion privacy/complaints disclosures. Qualified Arabic and Sorani reviewers should approve exact translations. Only after those answers are frozen should the implementation plan be revised and the customer confirmation/payment sequence built.
