# RentCottage unresolved commercial and compliance research

**Research date:** 2 August 2026

**Purpose:** Resolve, where public evidence permits, the proposed customer booking fee, payment-provider shortlist, and owner-document requirements for the RentCottage Minimum Viable Product (MVP).

**Status:** Product and commercial research, not Iraqi legal, tax, accounting, or regulatory advice.

## Executive recommendation

1. **Launch customer booking fee:** Test a fixed **Iraqi dinar (IQD) 5,000** RentCottage booking service fee. This is a medium-confidence commercial recommendation, not a fee established by Iraqi law or a proven market standard. It must be disclosed as a RentCottage service fee, not as a card or payment-processing surcharge.
2. **Payment-provider discovery:** Approach **Qi Card first**. Its public gateway documentation provides the strongest evidence of the required technical building blocks, including IQD card payments, payment cancellation, full and partial refunds, webhooks, and references to two-stage payments. A commercial and sandbox validation is still required for delayed capture and marketplace owner settlement.
3. **Owner documents:** Use a minimum nationwide application checklist, then require a location-specific licensing decision for every cottage. Federal Iraq and the Kurdistan Region have different authorities and processes, and public sources do not establish that every cottage or farm falls into one uniform tourism category.
4. **Retention:** Do not invent a fixed retention period. No authoritative public source located in this research establishes one retention period for a private cottage marketplace storing owner identity and property documents across federal Iraq and the Kurdistan Region. Iraqi and Kurdistan Region counsel must approve a data-by-data retention schedule before document storage goes live.

## Confidence summary

| Question | Recommendation | Confidence | What remains external |
| --- | --- | --- | --- |
| Fixed customer fee | IQD 5,000 at launch | Medium | Customer field testing and final provider quote |
| First payment provider to validate | Qi Card | Medium | Central Bank of Iraq (CBI) licence, contract, enabled terminal features, sandbox proof, settlement model and pricing |
| Alternative payment candidates | ZainCash and AsiaPay | Low to medium | Delayed capture and marketplace settlement are not established publicly |
| Minimum owner document set | Identity, address where required, authority to rent, applicable licence and payout evidence | Medium | Property classification and local requirements |
| Exact document retention period | Legal decision required before launch | High confidence that it remains unresolved | Written federal Iraq and Kurdistan Region legal advice |

## 1. Fixed customer booking fee

### Observable market context

Publicly visible Iraqi cottage and farm prices vary widely. Current examples include Baghdad farm listings at **IQD 200,000 and IQD 250,000** on OpenSooq and a Baghdad daily-rental farm at **IQD 500,000** on Paya Real Estate. Fusha, which describes itself as an Iraqi farm and chalet marketplace, displays shift examples between approximately **IQD 100,000 and IQD 300,000**, but also states that customer booking is free and payment goes to the owner. These are market observations, not an audited sample of completed transactions. Sources: [OpenSooq Baghdad farm and chalet listings](https://iq.opensooq.com/ar/%D8%A8%D8%BA%D8%AF%D8%A7%D8%AF/%D8%B9%D9%82%D8%A7%D8%B1%D8%A7%D8%AA/%D9%85%D8%B2%D8%A7%D8%B1%D8%B9-%D9%88%D8%B4%D8%A7%D9%84%D9%8A%D9%87%D8%A7%D8%AA-%D9%84%D9%84%D8%A7%D9%8A%D8%AC%D8%A7%D8%B1/%D9%85%D9%81%D8%B1%D9%88%D8%B4%D8%A9), [Paya Real Estate daily farm listings](https://paya-realestate.com/en/search/properties/for-daily-rent/Baghdad/All/Farm), and [Fusha](https://fushaiq.com/).

Internationally, Airbnb's split-fee model currently describes a guest service fee commonly between **14.1% and 16.5%** of the booking subtotal. That is useful only as evidence that customers can be charged a separately disclosed marketplace fee. It is not an appropriate rate recommendation for an unproven Iraqi marketplace. [Airbnb service fees](https://www.airbnb.com/help/article/1857)

ZainCash publicly lists merchant payment-gateway pricing of **0.6% with a minimum IQD 150** for its merchant and company wallet tiers. This is evidence from one provider, not a quote for RentCottage and not evidence of the cost of every required feature. [ZainCash business pricing and limits](https://www.zaincash.iq/business-wallets)

The Central Bank of Iraq states that customers must not be made to pay the commission arising from private-sector card payments through point-of-sale devices or payment gateways, and that the private-sector merchant bears that commission. Therefore, the proposed IQD 5,000 must be described and accounted for as RentCottage's booking service fee, not as reimbursement of a card-processing fee. Qualified Iraqi advice should confirm the final wording and treatment. [CBI notice on electronic-payment commissions](https://cbi.iq/news/view/2454)

### Why IQD 5,000 is the best starting point

IQD 5,000 is approximately United States dollars (USD) 3.82 at the CBI's displayed rate of IQD 1,310 per US dollar on the research date. It is a familiar round denomination and remains materially below Airbnb-style percentage fees on the observed booking values. [CBI exchange rates](https://cbi.iq/)

| Cottage booking price | IQD 5,000 as a percentage |
| ---: | ---: |
| IQD 75,000 | 6.7% |
| IQD 100,000 | 5.0% |
| IQD 150,000 | 3.3% |
| IQD 200,000 | 2.5% |
| IQD 250,000 | 2.0% |
| IQD 500,000 | 1.0% |

This fixed fee is regressive: it represents a larger share of a cheaper shift. That is the unavoidable trade-off of Yasir's fixed-fee decision. IQD 10,000 would reach 10% on an IQD 100,000 booking and would create a much harder adoption test against a local competitor advertising free customer booking. IQD 3,000 would be gentler but leaves less contribution toward customer support, refunds, fraud and marketplace operation. IQD 5,000 is the most defensible midpoint for a launch experiment.

### Recommended decision and validation

- Put **IQD 5,000** in the revised PRD as the proposed launch booking service fee, subject to validation before public launch.
- Show it before payment authorisation and include it in the total price breakdown.
- Refund it whenever the agreed policy provides a full refund.
- Do not describe it as a payment, card, gateway or processing fee.
- Test the wording and amount with prospective Iraqi customers before launch.
- Review conversion, abandonment, refund cost and support cost after the pilot. The fee should be an explicit commercial decision, not a hidden checkout variable.

## 2. Payment-provider shortlist

### Regulatory starting point

The Central Bank of Iraq publishes the authoritative list of licensed electronic payment service providers. The current list includes Iraq Wallet/ZainCash, AsiaPay, International Smart Card/Qi Card, Areeba Iraq and other providers. A provider's presence on that list confirms licensing status shown by the CBI, but it does not prove that the provider offers RentCottage's required marketplace flow. [CBI licensed electronic payment providers](https://www.cbi.iq/page/25)

CBI identifies Electronic Payment Services Regulation No. 2 of 2024 and related technical and financial instructions as part of the current legal framework. RentCottage should contract only through the appropriate licensed structure and should not operate its own customer wallet or directly improvise custody of funds. [CBI electronic-payment legal framework](https://cbi.iq/news/print_news/2868) and [Electronic Payment Services Regulation No. 2 of 2024](https://cbi.iq/news/print_news/2577)

### Candidate 1: Qi Card

**Publicly evidenced capabilities**

- Web and mobile payment gateway accepting cards and SuperQi wallet payments.
- Iraqi dinar support.
- Hosted payment surfaces, 3-D Secure and tokenised card support.
- Payment status queries and signed webhook notifications.
- Payment cancellation, including a successfully processed payment awaiting confirmation.
- Full and partial refunds.
- Public documentation that refers to refunds following confirmation in a two-stage payment.

Sources: [Qi Card gateway introduction](https://developers-gate.qi.iq/docs/getting-started/payment-gateway-intro), [cancel payment](https://developers-gate.qi.iq/docs/api-endpoints/cancel-payment), [refund payment](https://developers-gate.qi.iq/docs/api-endpoints/refund-payment), and [webhook setup](https://developers-gate.qi.iq/docs/webhook-guide/webhook-setup).

**What is not proven publicly**

- That two-stage authorisation and later capture is enabled for every card type or merchant terminal.
- The authorisation validity window that RentCottage would receive.
- Automatic split settlement between RentCottage and multiple cottage owners.
- Sub-merchant onboarding, owner Know Your Customer checks, payout timing, rolling reserves and chargeback allocation.
- RentCottage's actual pricing and contract terms.

**Assessment:** First provider to approach and test. Do not name Qi as selected until a sandbox demonstrates the full booking lifecycle and the commercial contract resolves marketplace settlement.

### Candidate 2: ZainCash

**Publicly evidenced capabilities**

- CBI-listed mobile payment provider.
- Merchant gateway, IQD wallet payments, transaction status and refund lifecycle.
- Public merchant and company pricing.
- Public merchant Know Your Customer document requirements.

Sources: [ZainCash gateway documentation](https://docs.zaincash.iq/), [business pricing and requirements](https://www.zaincash.iq/business-wallets), and [CBI provider list](https://www.cbi.iq/page/25).

**Not publicly established:** A pre-authorisation hold followed by delayed capture, card coverage comparable to Qi, or automatic marketplace split payouts.

**Assessment:** Strong commercial fallback and useful pricing benchmark. It cannot yet be treated as supporting the agreed Airbnb-style flow.

### Candidate 3: AsiaPay

**Publicly evidenced capabilities**

- CBI-listed mobile payment provider.
- IQD checkout, payment-order queries and refunds through a public integration guide.

Sources: [AsiaPay integration documentation](https://www.asiapay.iq/integration) and [CBI provider list](https://www.cbi.iq/page/25).

**Not publicly established:** A true authorisation hold with later capture, authorisation release, or marketplace split settlement.

**Assessment:** Include in the request for proposal, but place behind Qi until the missing lifecycle capabilities are demonstrated.

### Mandatory provider validation checklist

The selected provider must answer and demonstrate all of the following:

1. Is its CBI licence current for the contracted service and entity?
2. Can it authorise the complete customer total without capturing it?
3. Does the authorisation reserve funds, and for how long for each supported card or wallet?
4. Can RentCottage capture automatically after owner acceptance and void immediately after decline, withdrawal or expiry?
5. Does the flow support IQD, Iraqi cards, Visa, Mastercard and the provider's local wallet?
6. Can it issue full and partial refunds through an application programming interface, and report final refund status asynchronously?
7. Can it onboard individual and company cottage owners as sub-merchants and settle each owner's net payout after deducting RentCottage's 10% commission?
8. If it cannot split settlement, who legally receives the customer money, who is merchant of record, and what licensed mechanism pays owners?
9. Who bears chargebacks, refunds, fraud, negative balances, rolling reserves and provider fees?
10. Are payment, refund and payout events delivered through signed, retryable webhooks with idempotency support?
11. What are the transaction, refund, payout, account, reserve and failed-payment fees?
12. What owner and RentCottage Know Your Customer documents are required?
13. What are the production onboarding time, service levels, support route, data location and incident obligations?

### Payment-provider conclusion

The payment flow is technically plausible in Iraq, and Qi Card offers enough public evidence to justify a formal technical discovery. Public evidence does **not** yet prove a complete compliant marketplace settlement flow. Payment-provider selection therefore remains a launch gate. If no licensed provider can demonstrate authorisation, later capture, release, refund and owner settlement, the funds flow must be redesigned before implementation.

## 3. Owner identity, authority and licensing documents

### Minimum owner application checklist

#### A. Identity and authority

For an Iraqi individual:

- Unified National Card, front and back.
- Residence or address card only where still required by the relevant authority or payment provider.
- A live identity check or equivalent provider-supported check.

For a foreign resident:

- Passport.
- Valid Iraqi or Kurdistan Region residency evidence.

For a company or other legal person:

- Company registration certificate and current company record.
- Identity of the authorised representative.
- Written authority for that representative to list and manage the property.
- Company bank or provider account in the appropriate name.

ZainCash's current merchant requirements provide useful first-party evidence of the documents a local payment provider may request. Its merchant tier lists a national ID, residence card, live photo, Know Your Customer form, business evidence, professional or chamber evidence, workplace rental document and business-owner bank account. Its company tier adds company-registration and authorised-person documents. These are ZainCash requirements, not a complete legal checklist for cottage letting. [ZainCash business wallet requirements](https://www.zaincash.iq/business-wallets)

The Kurdistan Regional Government advises that its Unique Personal Number is private and should be shared only with authorised government personnel. RentCottage should therefore not collect the Unique Personal Number merely as an extra identifier. [KRG Unique Personal Number guidance](https://gov.krd/dmi-en/publications/upn-info/)

#### B. Authority to rent the cottage

For an owner:

- Current property title or land-registry extract matching the applicant or legal person.

For a tenant, manager or representative:

- Valid lease or management agreement.
- Separate written authority from the registered owner permitting short-stay rental and marketplace listing.
- Owner identity or company evidence sufficient to validate that authority.

For company-owned property:

- Company property record or lease.
- Company authorisation naming the person permitted to manage the listing.

Kurdistan Region government services use a property-registration copy, property title or validated lease as official evidence in property and business processes. Sources: [KRG registration of property in a legal person's name](https://services.gov.krd/en/service/moj-31-en) and [KRG private business registration](https://services.gov.krd/en/service/moti-27-en).

Ownership alone does not prove that short-stay tourist use is permitted. Agricultural land, residential property, tourist accommodation and event facilities may have different use and licensing constraints. The onboarding decision must therefore record both **authority to offer the property** and **local permission for the intended activity**.

#### C. Tourism, municipal and tax evidence

The Iraqi Tourism Authority's published conditions for tourism-facility professional-practice licences list a lease or property title, tax clearance, photographs and personal documents among the application materials. Its governing law describes licensed tourism facilities as including hotels, tourist apartments and tourist houses, and states that covered tourism facilities require a Tourism Authority licence and annual renewal. The public material does not establish whether every RentCottage farm, chalet or private cottage falls into one of those categories. Sources: [Iraqi Tourism Authority licensing conditions](https://tourism.gov.iq/common/files/manshourat/manshour1671608149.pdf) and [Tourism Authority Law No. 14 of 1996](https://tourism.gov.iq/en/posts/7a553caf-4d23-494d-97c6-66ce8f46fd70).

In the Kurdistan Region, the Board of Tourism and the relevant governorate directorates administer tourism licensing under regional rules. The public service for tourism businesses requires company registration, security clearance, lease or ownership evidence and further business documents. The Kurdistan Region also describes hotels, motels, apartments and tourism complexes as establishments permitted by the relevant regional authorities. Sources: [KRG tourism licence service](https://services.gov.krd/en/service/momt-13-en) and [Kurdistan Region tourism-establishment definition](https://krso.gov.krd/en/statistics/trade/tourism-establishment-units).

**Required RentCottage rule:** Before approving a cottage, the reviewer must obtain either the applicable current licence or written confirmation from the responsible local authority or qualified counsel that the cottage does not require that licence. The authority and evidence must be recorded per property.

#### D. Payment and operational evidence

- Payout account or provider account whose holder matches the approved owner or legal person.
- Provider Know Your Customer approval status.
- Exact property location and a location-match check.
- Current photographs and sufficient evidence that the submitted cottage is the property inspected.
- Any required safety, capacity, pool, fire, municipal or local approvals identified by the property's authority.

These operational checks support marketplace trust but do not replace government licensing.

### Application states and the three-day target

The owner application should distinguish:

- Draft
- Submitted
- Needs information
- Under review
- Approved
- Rejected
- Expired or renewal required
- Suspended

The agreed three-day review target should begin only when the application is complete. A request for missing evidence pauses that target. Approval should record reviewer, timestamp, evidence types, jurisdiction, licence or exemption basis, expiry dates and reason.

## 4. Document storage and retention

### What public sources establish

Iraq's Constitution protects personal privacy and communications. The Electronic Signatures and Transactions Law gives legal weight to retrievable electronic records that preserve identity, integrity, sender or recipient, and time information. These principles support access restriction, audit history and durable booking evidence, but they do not provide a single clear retention period for RentCottage's copies of owner national IDs and property documents. Sources: [Constitution of Iraq, Articles 17 and 40](https://iq.parliament.iq/en/wp-content/uploads/sites/3/2024/04/Constitution-of-the-Republic-of-Iraq.pdf) and [Electronic Signatures and Transactions Law No. 78 of 2012](https://moj.gov.iq/upload/pdf/%D9%82%D8%A7%D9%86%D9%88%D9%86%20%D8%A7%D9%84%D8%AA%D9%88%D9%82%D9%8A%D8%B9%20%D9%88%D8%A7%D9%84%D9%85%D8%B9%D8%A7%D9%85%D9%84%D8%A7%D8%AA%20%D8%A7%D9%84%D8%A7%D9%84%D9%83%D8%AA%D8%B1%D9%88%D9%86%D9%8A%D8%A9.pdf).

Payment-provider anti-money-laundering and recordkeeping duties may require the licensed provider to retain its own Know Your Customer evidence. Those duties should not be assumed to impose the same period on RentCottage, and duplicating the provider's identity archive increases risk without necessarily adding value.

The Kurdistan Regional Government's digital-transformation strategy identifies data-retention periods as a data-protection mechanism still requiring formal governance and legislation. This supports caution rather than providing a private-sector retention number. [KRG digital-transformation strategy](https://gov.krd/dxs/)

### Required pre-launch legal decision

Before implementing document storage, counsel should approve a schedule covering at least:

| Record | Decision required |
| --- | --- |
| Incomplete or abandoned owner application | Deletion deadline |
| Rejected application | Appeal, fraud and deletion period |
| Approved owner's identity copy | Whether RentCottage needs the copy after verification, and for how long |
| Property title, lease and owner authority | Active-account and post-closure period |
| Tourism, municipal and safety licences | Renewal and historical-evidence period |
| Provider Know Your Customer documents | Whether only provider status and reference should be stored |
| Access history and approval decision | Audit-retention period |
| Booking, payment, tax and dispute records | Separate statutory and limitation periods |
| Legal hold or active dispute | Suspension of ordinary deletion |

### Product safeguards that do not depend on the final period

- Store source documents privately and separately from normal owner, customer and support data.
- Encrypt documents in transit and at rest.
- Restrict access to specifically authorised verification administrators.
- Record every view, download, replacement and deletion.
- Never expose documents through public or guessable links.
- Do not send identity, ownership or licence documents to the automatic translation service.
- Store the verification result, evidence type, issuing authority, review date and expiry separately from the source file.
- Delete source documents automatically when the approved schedule requires it, unless a documented legal hold applies.
- Let the licensed payment provider retain financial Know Your Customer evidence wherever this avoids unnecessary duplication.

## 5. Decisions ready for the Product Requirements Document

The following wording is supported for the next PRD revision:

- **Customer fee:** RentCottage proposes a fixed IQD 5,000 booking service fee at launch. It is shown before payment authorisation and included in every full refund. The amount remains subject to pre-launch customer validation and final commercial approval.
- **Payment provider:** Qi Card is the first provider to validate, not yet the selected provider. Launch requires a CBI-licensed provider to demonstrate authorisation, delayed capture, release, refund, dispute handling and compliant owner settlement.
- **Owner evidence:** Owners apply with identity, authority-to-rent and property-specific local compliance evidence. RentCottage reviews complete applications within three days.
- **Jurisdiction:** Each cottage requires a recorded federal Iraq or Kurdistan Region licensing decision appropriate to its location and property type.
- **Document storage:** Secure document storage is included, but it cannot launch until counsel approves access, location and retention rules.

## 6. Client-safe conclusion

Desk research resolves the commercial direction but not every external dependency. IQD 5,000 is a reasonable fee to test. Qi Card is the most promising first payment conversation. A defensible minimum owner checklist can be built now. Final provider settlement terms, property-specific licensing and document-retention periods require written confirmation from the relevant provider, authority or qualified Iraqi and Kurdistan Region advisers before public launch.
