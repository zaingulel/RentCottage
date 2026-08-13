# UK delivery benchmark: RentCottage marketplace MVP

**Research date:** 26 July 2026
**Purpose:** a buyer-side benchmark for the currently proposed RentCottage MVP, not a supplier quote or a promise of delivery. Amounts exclude VAT, payment-provider fees, legal advice, cloud/SaaS costs, content photography and launch operations.

## Bottom line

A credible UK delivery partner should treat this as a **£85k to £180k+ pre-VAT build**, before payment-provider implementation uncertainty, rather than a £4k website. That is a bottom-up estimate of labour days at publicly visible UK rates, not an agency-marketing figure.

The lower figure is a deliberately lean, tightly managed MVP using senior generalists and only a small independent security engagement. The upper figure is a more conventional specialist team. A one-person, one-month effort has roughly **20 person-days**. The lean model below is **138 person-days** before client feedback, rework and an unproven payment-provider integration. It cannot responsibly be described as a production-ready delivery in one calendar month.

This does **not** say that a one-person AI-assisted build cannot produce a convincing prototype or a meaningful thin vertical slice in a month. It says it is not comparable to the full production-ready scope in the agreed PRD.

## Why this is a marketplace build, not a standard brochure MVP

The agreed scope includes three web areas (customer, owner and administrator), Arabic/Sorani/English including two right-to-left locales, availability across shift bundles and consecutive days, atomic competing-booking protection, role-based disclosure, payment authorisation then capture/release/refund, payout eligibility, audit history and an external security review. The delivery specification lists 110 granular behaviours. These are material delivery and assurance costs, not polish.

The payment provider is also a hard launch dependency. No estimate below assumes that an Iraqi provider will support the required authorise, capture, release/refund and owner-settlement lifecycle until that has been demonstrated in writing and in a sandbox or integration environment.

## Rate evidence used

These are transparent input rates, not claims that every supplier will charge them.

The IT Jobs Watch figures below were accessed on 26 July 2026 and transcribed into this table as a dated repository snapshot. The linked pages are live and will show a moving six-month window when revisited.

| Evidence | What it says | Use in model |
| --- | --- | --- |
| [IT Jobs Watch, UK Software Architect contracts](https://www.itjobswatch.co.uk/contracts/uk/software%20architect.do) | For the six months to 26 July 2026, 25 advertised daily rates gave a £550 median, £504 25th percentile and £625 75th percentile. | Cross-check for architect input. |
| [IT Jobs Watch, UK Product Manager contracts](https://www.itjobswatch.co.uk/contracts/uk/product%20manager.do) | For the six months to 26 July 2026, 299 advertised daily rates gave a £530 median. | Product/delivery input. |
| [Digital Marketplace G-Cloud 14 SFIA rate card](https://assets.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-14/documents/702225/779892322399498-sfia-rate-card-2024-05-07-1234.pdf) | Indicative, VAT-exclusive daily charges: SFIA level 4 is £650-900 user-centred design, £550-800 architecture, £700-950 data engineering, £650-900 engineering/DevOps, £550-800 QA and £650-850 product. | Senior specialist ranges. The card is dated May 2024, so it is a public procurement benchmark, not a 2026 market median. |
| [Digital Marketplace software-development service](https://www.applytosupply.digitalmarketplace.service.gov.uk/g-cloud/services/112071598639352) | Current G-Cloud listing advertises £395-£1,435 per day for software development. | Sanity check for agency-style delivery range. |
| [Digital Marketplace penetration-testing service](https://www.applytosupply.digitalmarketplace.service.gov.uk/g-cloud/services/435824223578050) | Current G-Cloud listing advertises £800-£1,200 per day for penetration testing. | Independent manual security-testing input. |

The Digital Marketplace examples are public-sector framework prices and may include supplier overhead, clearance and procurement costs. IT Jobs Watch is a current advertised-contract dataset, but role samples and IR35 status vary. Neither source proves a final commercial quote.

## Bottom-up labour model

### Lean, high-risk production path

Assumes a stable PRD, a recognised component/platform stack, senior generalists, limited discovery, no material redesign after feedback and a payment provider that proves suitable quickly.

| Capability | Person-days | Day rate | Labour cost | Why it exists |
| --- | ---: | ---: | ---: | --- |
| Product/delivery | 15 | £530 | £7,950 | backlog, decisions, acceptance, supplier coordination |
| UX and interaction design | 18 | £650 | £11,700 | mobile, RTL/LTR, three-role flows and usability checks |
| Senior full-stack engineering | 70 | £650 | £45,500 | customer, owner/admin, persistence, booking rules, integrations and release fixes |
| Architecture/review | 8 | £550 | £4,400 | data/state boundaries, concurrency and payment integration design |
| Quality assurance | 17 | £550 | £9,350 | critical-path, regression and failure-path testing |
| DevOps/release | 5 | £650 | £3,250 | environments, monitoring, backups, deployment and rollback setup |
| Independent penetration test | 5 | £800 | £4,000 | scoped web/API test plus report and retest allowance |
| **Total** | **138** |  | **£86,150** | **before VAT and non-labour costs** |

This is approximately 28 person-weeks. It needs about 14 weeks with 2.0 productive full-time equivalents, or about 9 to 10 weeks with three people whose work is properly parallelised. A single person needs roughly seven months of full-time equivalent capacity before normal rework and operational interruptions.

### Conventional specialist-team path

Assumes proper discovery/iteration, stronger specialist coverage, integration hardening and more realistic test/retest time.

| Capability | Person-days | Day rate | Labour cost |
| --- | ---: | ---: | ---: |
| Product/delivery | 25 | £530 | £13,250 |
| UX and interaction design | 30 | £775 | £23,250 |
| Senior full-stack engineering | 120 | £775 | £93,000 |
| Architecture/review | 15 | £675 | £10,125 |
| Quality assurance | 30 | £675 | £20,250 |
| DevOps/release | 12 | £775 | £9,300 |
| Independent penetration test | 7 | £1,000 | £7,000 |
| **Total** | **239** |  | **£176,175** |

At three productive full-time equivalents this is roughly 16 weeks. In a normal agency engagement, discovery, procurement, client feedback, access delays and change control often extend calendar duration beyond the arithmetic staffing duration. This table deliberately does **not** add an invented agency margin because the public framework rates already represent supplier charging rates.

## Security is a real delivery item

The [NCSC guidance for secure online services](https://www.ncsc.gov.uk/guidance/building-operating-secure-online-service) says security should be considered from the outset, recommends secure development, and says penetration-test scope should follow the service's business logic and shared cloud responsibility. It also recommends vulnerability scanning in development pipelines. The [OWASP ASVS 5.0](https://owasp.org/www-project-application-security-verification-standard/) is a procurement-ready basis for specifying and verifying web-application security controls.

For RentCottage, the security scope should specifically test authentication and administrator multi-factor authentication, authorisation between customer/owner/admin roles, exact-address/contact disclosure, phone and payment flows, booking concurrency, audit logging, API abuse and payment-webhook handling. Automated AI-generated tests and static scanning are useful but are not substitutes for an independent, authorised test of the deployed service.

## What a £4,000 month actually buys

At 20 working days, £4,000 is £200 per day. At 160 hours it is £25 per hour. That is dramatically below the public UK contractor and G-Cloud benchmarks above, so it is commercially favourable to the client **if** the deliverer is knowingly accepting that rate and the work is framed as a fixed-capacity build sprint.

It should not be sold as an agency-equivalent fixed-price commitment to complete the agreed MVP. A defensible first-month promise is a working, demonstrated vertical slice and an evidence-based remaining estimate. Completion depends particularly on payment-provider capability, implementation complexity found during booking/persistence work, design/translation review and security findings.

## Decision caveats

- This is a UK-buyer comparator. It is not a forecast for Iraq-local staffing or an assertion that a remote team must charge UK rates.
- It does not include legal advice, Iraqi regulatory/PSP due diligence, payment-provider transaction fees, owner onboarding operations, professional translation review, photography, support staff, insurance, cloud/SaaS or post-launch support.
- It excludes a native app because the signed scope is web-first.
- A payment provider that cannot perform the agreed funds lifecycle is not a delay to be absorbed by engineering. It requires a product/commercial decision.
- Estimates should be refreshed after a short technical spike validates the provider API, data model, hosting choice and first end-to-end booking flow.
