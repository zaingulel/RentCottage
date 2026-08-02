# Muntajaa Marketplace Cost Plan

## Build and Phase 2 Budget

**Status:** Draft for budget review
**Updated:** 2 August 2026
**Decision owner:** Yasir
**Product:** Muntajaa, working name

> **Purpose.** This document explains the current cost assumptions for building and launching Muntajaa. It separates expected costs, optional choices, usage-based charges and items still requiring quotations. It is a planning document, not a fixed-price supplier quote.
>
> **How to read the totals.** The £4,000 monthly figure is development and project management. The software-stack total is separate. Pound, dollar and Iraqi dinar amounts are kept separate rather than converted using a temporary exchange rate.

## 1. Cost plan at a glance

| Budget area | Current working allowance | Treatment |
|---|---:|---|
| Development and project management | **£4,000 per month** | Continues while active development is required |
| Phase 1 software stack | **$294/month** | Cloudflare Workers, Supabase Pro, Codex, CodeRabbit Pro+ and one GitHub Team seat |
| Phase 1 software stack using GitHub Free | **$290/month** | Valid if no paid GitHub Team feature is required |
| Optional second GitHub Team seat | **+$4 per month** | Add only if Yasir needs a paid development seat |
| Trademark protection | **2,100,000 IQD one time, approximately £1,200** | Provisional allowance for federal Iraq and the Kurdistan Region |
| Booking payment processing | **TBC** | Obtain written provider pricing. A 1.5% scenario may be used for modelling only |
| Customer booking service fee | **Proposed IQD 5,000 per paid booking** | RentCottage revenue assumption, not a gateway surcharge or operating cost |
| Owner commission | **10% of the cottage booking price** | RentCottage revenue assumption, deducted from owner payout |
| Phase 2 app-store accounts | **$124 in the first app year** | Apple $99 yearly plus Google Play $25 one time |
| Costs awaiting quotations | **TBC** | Not zero. Excluded until suppliers or advisers provide quotations |

## 2. Phase 1: Build and web launch

### 2.1 Core monthly costs

| Cost | Allowance | Status | What it covers |
|---|---:|---|---|
| Development and project management | **£4,000/month** | Confirmed | Product management, engineering, testing, delivery and AI-assisted execution |
| Codex | **$200/month** | Confirmed | Primary AI development tool |
| CodeRabbit Pro+ | **$60/month** | Confirmed | Pro+ billed month-to-month for the initial trial |
| Cloudflare Workers paid plan | **$5/month** | Approved baseline | Hosting and server-side execution, subject to usage allowances |
| Supabase Pro | **$25/month** | Approved baseline | PostgreSQL database, authentication, storage and managed platform services |
| GitHub Team | **$4/month** | Optional baseline allowance | One organisation seat. GitHub Free remains suitable until a paid feature is needed |
| Second GitHub Team seat | **+$4/month** | Optional | Yasir's paid development seat, if required |
| Customer support software | **$0 initially** | Working assumption | Founder-managed support. Staff and helpdesk software remain TBC |
| Push notifications | **$0 initially** | Working assumption | Platform push services within normal launch usage |
| Monitoring and security tools | **$0 initially** | Working assumption | Free tiers and platform tooling at launch |
| Static interface translation | **$0 additional** | Working assumption | AI-assisted drafting with human review in Arabic, Sorani Kurdish and English |
| Automatic content translation | **TBC usage** | Usage-based | A replaceable translation service for owner content, messages and reviews |

### 2.2 Approved infrastructure baseline

The approved delivery baseline is **Cloudflare Workers plus Supabase Pro** at **$30 per month** before development tooling. It combines low-cost hosting with PostgreSQL, authentication and private document storage. It replaces the earlier Cloudflare D1 and Vercel alternatives for MVP planning.

Cloudflare and Supabase overages remain usage-based. Spend alerts must be enabled before public launch.

### 2.3 Usage-based services and safety controls

| Service | Launch expectation | Control |
|---|---:|---|
| GitHub Actions continuous integration | **Included initially** | Use repository allowances first and monitor actual runner demand |
| Blacksmith continuous integration | **Deferred** | Consider only if measured demand makes a runner change worthwhile |
| Google Maps and geocoding | **$0 initially** | Use free monthly thresholds and set a $50 billing alert |
| Automatic translation | **TBC** | Set per-request and monthly limits after supplier selection |
| Phone verification and urgent SMS | **TBC** | Confirm Iraqi delivery, sender requirements and unit pricing |
| Hosting, database and storage overages | **TBC** | Enable provider spend alerts before public launch |

Safety caps and alerts are controls, not expected monthly bills. They are excluded from the headline total.

### 2.4 Annual and one-off costs

| Cost | Allowance | Timing | Notes |
|---|---:|---|---|
| `muntajaa.com` domain | **$10 to $28** | Annual | Working domain and provisional registrar price |
| Business email | **$36** | Annual | One Porkbun mailbox plus up to 20 free forwarding addresses |
| CodeRabbit Pro+ | **$60/month** | Month-to-month | Selected for the initial trial; $720 if retained for 12 months |
| Muntajaa word-mark protection | **2,100,000 IQD, approximately £1,200** | One time | Provisional federal Iraq and Kurdistan Region allowance |
| One-off contingency | **10%** | One time | Applied to confirmed one-off setup costs after TBC quotations are received |

For illustration, 10% on the trademark allowance alone is 210,000 IQD, approximately £120. Company registration, legal, accounting and other TBC quotations must be added before the final contingency is calculated.

## 3. Payments and marketplace operations

### 3.1 Commercial model

- Charge the customer a proposed fixed **IQD 5,000 RentCottage booking service fee** on each paid booking.
- Deduct a **10% RentCottage commission** from the cottage booking price before calculating owner payout.
- Show the cottage booking price, booking service fee and customer total separately before payment authorisation.
- Include the booking service fee in every outcome described as a full refund.
- Never describe the customer service fee as a card, gateway or payment-processing surcharge.

The IQD 5,000 amount is a launch hypothesis. It should be tested with prospective customers and reviewed against conversion, support and refund costs after launch.

### 3.2 Payment-provider allowance

Final payment-processing cost is **TBC** until a licensed provider supplies written marketplace terms. A **1.5% of gross customer payments** scenario may be retained for sensitivity modelling, but it is not an approved or quoted cost.

Qi Card is the first provider to validate because its public material shows the closest fit to the required payment building blocks. ZainCash and AsiaPay remain alternatives. No provider is selected until it proves the complete flow in a sandbox and contract, including:

- full customer-total authorisation and reservation of funds;
- later automatic capture after owner acceptance;
- release after decline, withdrawal or expiry;
- full refunds and final refund-status reporting;
- signed, retryable and idempotent payment events;
- lawful settlement of each owner's net payout;
- clear treatment of processing fees, disputes, chargebacks and reserves.

If no Central Bank of Iraq-licensed provider can support the agreed flow, the product payment model must be redesigned before implementation. RentCottage will not operate an unlicensed wallet or directly improvise custody of customer funds.

Apple and Google app-store commission is budgeted at **$0** because cottage bookings are purchases of physical services rather than digital content.

### 3.3 Operating assumptions

- The operating company is expected to be registered in Iraq. Federal Iraq or Kurdistan Region registration remains TBC after local advice.
- No new United Kingdom company formation cost is included.
- Ongoing United Kingdom accounting is not included unless the final cross-border structure requires it.
- Customer and cottage-owner policies may be drafted with AI, but Iraqi legal review remains TBC.
- Owner identity, authority-to-rent and licence checks are manual at launch. Secure in-platform document storage is included, but a paid identity-verification supplier is not.
- Cottage owners provide property photographs initially.
- ISO/IEC 27001 is a security benchmark only. The budget does not claim certification.

### 3.4 Costs awaiting supplier quotations

These items are not free. TBC means the amount cannot be responsibly fixed until the company structure, scope or supplier is selected and a written quotation is obtained.

| Item | Why the amount is not yet fixed |
|---|---|
| Iraqi company registration | Exact registry and company structure have not been selected |
| Iraqi legal adviser | Must confirm marketplace, privacy, tourism, property, payments and contract requirements |
| Iraqi chartered accountant | Must confirm local tax, bookkeeping, receipts and reporting |
| One-off UK cross-border tax review | Required only to validate the relationship with Zain's existing UK company |
| Iraqi platform insurance | Need local advice on required cover and insurer quotations |
| Independent penetration test | Scope and supplier to be selected before launch |
| Phone verification and SMS | Iraqi delivery, sender identity and unit pricing must be tested |
| Automatic translation | Supplier quality, languages, usage and price must be validated |
| Payment-provider commercial terms | Marketplace functions and final settlement and refund charges need written confirmation |
| Customer-support staffing | Founder-managed initially, later staffing is unknown |
| Marketing and paid launch activity | To be agreed separately |
| Professional property photography | Owners provide images initially |

## 4. Phase 2: Native mobile applications

Native iOS and Android applications are deferred until after the web launch. Phase 1 operating costs continue during Phase 2.

| Cost | Allowance | Notes |
|---|---:|---|
| Native application development | **£4,000/month for a TBC duration** | No separate outside developer fee is assumed |
| Apple Developer Program | **$99/year** | Organisation account. A D-U-N-S number is free |
| Google Play full distribution | **$25 one time** | Organisation account |
| Physical test devices | **$0** | Zain has an iPhone and Yasir has an Android device |
| App-store assets | **$0 additional** | AI-assisted artwork plus real product screenshots |
| App-store commission on cottage bookings | **$0** | Physical-service transactions use the Iraqi payment provider |
| Additional infrastructure usage | **TBC** | Depends on mobile adoption and notification volume |

The known incremental cost for the first app year is therefore **$124 plus £4,000 for each active development month**. The development duration is not yet estimated.

## 5. Decisions required before spending

1. Confirm whether a paid GitHub Team seat is required or GitHub Free is sufficient.
2. Approve the final `muntajaa.com` purchase price within the $10 to $28 range.
3. Select the Iraqi company registry after local legal and accounting advice.
4. Validate Qi Card first and compare its written offer with ZainCash and AsiaPay.
5. Obtain legal approval of the owner-document checklist and retention schedule before storage goes live.
6. Select and cost an automatic translation service after quality testing in Arabic and Sorani.
7. Obtain the remaining TBC quotations and then calculate the 10% one-off contingency.
8. Approve Phase 2 timing before opening app-store organisation accounts.

## 6. Budget acknowledgement

By approving this document, the client confirms that:

- [ ] The £4,000 monthly development and project-management cost is understood.
- [ ] Cloudflare Workers and Supabase Pro are the approved MVP infrastructure baseline.
- [ ] The known recurring, annual and one-off costs are accepted as planning allowances.
- [ ] Payment processing and automatic translation remain TBC, not zero.
- [ ] The IQD 5,000 customer service fee and 10% owner commission are commercial assumptions, not supplier costs.
- [ ] TBC and usage-based costs are excluded from the headline total.
- [ ] Supplier prices, taxes, foreign-exchange rates and commercial terms will be rechecked before purchase.
- [ ] Approval of this plan does not replace separate approval of individual TBC quotations.

**Approved by:** ______________________________________
**Role:** _____________________________________________
**Date:** _____________________________________________
**Signature or written approval reference:** ________________________________

## 7. Pricing and research basis

Public prices and provider evidence were checked during the July and 2 August 2026 research sessions. Supplier prices can change and final invoices may include tax, currency conversion or card charges.

- [GitHub pricing](https://github.com/pricing)
- [CodeRabbit plans](https://docs.coderabbit.ai/management/plans)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Supabase pricing](https://supabase.com/pricing)
- [Blacksmith pricing](https://www.blacksmith.sh/pricing)
- [Porkbun email pricing](https://porkbun.com/products/porkbun_email/)
- [Apple Developer Program pricing](https://developer.apple.com/programs/whats-included/)
- [Google Play developer account pricing](https://support.google.com/googleplay/android-developer/answer/6112435)
- [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing)
- [Qi Card gateway documentation](https://developers-gate.qi.iq/docs/getting-started/payment-gateway-intro)
- [ZainCash business pricing](https://www.zaincash.iq/business-wallets)
- [Central Bank of Iraq licensed providers](https://www.cbi.iq/page/25)
- [Central Bank of Iraq payment-commission notice](https://cbi.iq/news/view/2454)
- [Iraq trademark fee and registration update](https://www.jetro.go.jp/ext_images/_Ipnews/middle_east/ME_IP_Newsletter_202606_en.pdf)
- [RentCottage commercial and compliance research](../research/rentcottage-unresolved-commercial-compliance-research.md)
