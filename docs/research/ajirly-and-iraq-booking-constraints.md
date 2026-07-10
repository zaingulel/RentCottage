# Ajirly and Iraq cottage-booking constraints

Research date: 10 July 2026  
Purpose: inform product discovery for an Iraq-focused cottage-rental marketplace. This is product research, not legal or tax advice.

## Executive summary

Ajirly's first-party materials show a two-sided marketplace for daily rental of farms and chalets. The publicly described customer journey is: search by place/date, inspect photos/details/day prices and availability, consult prior-guest reviews, book online, follow the booking, communicate with the owner, then receive GPS access after booking. Its separate owner app describes property publishing, photos/descriptions/terms/prices, availability, special-day pricing, manual and online bookings, booking status changes, search and archiving. Sources: [Ajirly website](https://www.ajirly.com/), [Ajirly on Google Play](https://play.google.com/store/apps/details?id=com.ao307.ajirly.user.iq), [Ajirly on the Iraqi App Store](https://apps.apple.com/iq/app/ajirly-%D8%A7%D8%AC%D8%B1%D9%84%D9%8A/id6499079101), [AjirlyOwner on Google Play](https://play.google.com/store/apps/details?id=com.ao307.ajirly.provider), and [AjirlyOwner on the Iraqi App Store](https://apps.apple.com/iq/app/ajirlyowner/id6499032520).

The important lesson is not to reproduce Ajirly's feature list or interface. It is to settle the underlying marketplace rules: what a bookable period is, whether bookings are instant or owner-approved, what money changes hands and when, which party is the contracting provider, what “verified” means, how availability stays accurate, when an address is disclosed, and how cancellations/disputes work.

Iraq has a legal basis for electronic contracts and specifically does not exclude rental contracts from the Electronic Signatures and Transactions Law. The same law gives electronic documents legal weight when identity, integrity, date/time, storage and retrieval conditions are met. The Consumer Protection Law requires material service information and evidence of the service transaction including value and date. These make a durable booking record and explicit acceptance of terms product requirements, not merely back-office conveniences. Sources: [Iraqi Ministry of Justice, Electronic Signatures and Transactions Law No. 78 of 2012](https://moj.gov.iq/upload/pdf/%D9%82%D8%A7%D9%86%D9%88%D9%86%20%D8%A7%D9%84%D8%AA%D9%88%D9%82%D9%8A%D8%B9%20%D9%88%D8%A7%D9%84%D9%85%D8%B9%D8%A7%D9%85%D9%84%D8%A7%D8%AA%20%D8%A7%D9%84%D8%A7%D9%84%D9%83%D8%AA%D8%B1%D9%88%D9%86%D9%8A%D8%A9.pdf) and [Consumer Protection Law No. 1 of 2010](https://www.moj.gov.iq/upload/pdf/%D9%82%D8%A7%D9%86%D9%88%D9%86%20%D8%AD%D9%85%D8%A7%D9%8A%D8%A9%20%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D9%87%D9%84%D9%83.pdf).

For an MVP, the highest-risk unknowns are commercial and operational rather than visual: payment/deposit/refund mechanics, owner and property verification, applicable tourism/business licensing, platform-versus-owner responsibility, cancellation/no-show rules, and support/dispute handling. These should be decided in `grill-with-docs` before architecture or native-app scope is fixed.

## Scope and evidence standard

Only first-party and primary sources were used: Ajirly's website, app-store listings and developer privacy policy; official Iraqi legislation and regulator/government pages; and Apple/Google platform rules. Store descriptions and privacy labels are developer declarations, not independent audits. No authenticated Ajirly account, completed booking, owner onboarding, or payment was tested.

Terms such as “confirmed” below mean confirmed by a cited official/public source, not independently verified in production. “Implication” is a product inference. “Open question” is deliberately unresolved.

## Observable Ajirly customer flow

### Confirmed from public first-party materials

1. **Discover inventory.** Ajirly says customers can search among hundreds of farms and chalets in Iraq. Its website describes location-and-date filtering. [Ajirly website](https://www.ajirly.com/) · [Google Play listing](https://play.google.com/store/apps/details?id=com.ao307.ajirly.user.iq)
2. **Inspect a listing.** The website explicitly mentions property details, photos and prices by day. [Ajirly website](https://www.ajirly.com/)
3. **Check availability.** Both the website and store listings say users can see available and unavailable days without contacting an owner. [Ajirly website](https://www.ajirly.com/) · [Iraqi App Store listing](https://apps.apple.com/iq/app/ajirly-%D8%A7%D8%AC%D8%B1%D9%84%D9%8A/id6499079101)
4. **Use trust signals.** Ajirly advertises prior-guest ratings and says its farms are formally verified, although it does not publish the verification standard or review-eligibility rule. [Ajirly website](https://www.ajirly.com/)
5. **Book and track.** The website says a user can complete a booking online and follow its details. The store listing says advance booking is available for arbitrary future dates. [Ajirly website](https://www.ajirly.com/) · [Google Play listing](https://play.google.com/store/apps/details?id=com.ao307.ajirly.user.iq)
6. **Coordinate with the owner.** The current Google Play description says the app supports direct audio and video calls between customer and owner. This is observable as a public capability claim, not a recommendation for the MVP. [Google Play listing](https://play.google.com/store/apps/details?id=com.ao307.ajirly.user.iq)
7. **Navigate after booking.** Ajirly says the customer receives GPS-based access to the property after booking. [Google Play listing](https://play.google.com/store/apps/details?id=com.ao307.ajirly.user.iq)

### What the public customer materials do not establish

- Whether “online booking” is an immediate confirmed reservation, a request awaiting owner approval, or a lead followed by off-platform agreement.
- Whether the customer pays in-app, pays a deposit, pays the owner directly, or pays on arrival; no first-party public page located in this research describes the payment rail or settlement flow.
- The platform commission, owner payout, refund, cancellation, rescheduling, no-show, damage-deposit, chargeback or dispute rules.
- Whether customer reviews are limited to completed bookings or how reviews are moderated.
- Exactly what owner/property documents are checked before Ajirly labels inventory verified.
- Whether exact coordinates are hidden until payment, owner confirmation, or some other booking state.
- Whether cottages can be booked hourly, by a fixed day/evening slot, or only by calendar day. Ajirly's public positioning is daily rental and its pricing/availability language is day-based. [Iraqi App Store listing](https://apps.apple.com/iq/app/ajirly-%D8%A7%D8%AC%D8%B1%D9%84%D9%8A/id6499079101)

## Observable owner/provider flow

### Confirmed from public first-party materials

The separate AjirlyOwner app publicly describes the following owner-side capabilities:

- Add and update property descriptions, terms, prices and photos.
- Manage available/unavailable dates.
- Set different prices for holidays and named events.
- Add a booking manually or receive one through the online customer channel.
- Confirm, cancel or modify a booking.
- Search by customer phone number or booking number.
- Archive and organize older bookings.
- Communicate directly with customers by audio/video call in the current Google Play description.

Sources: [AjirlyOwner on Google Play](https://play.google.com/store/apps/details?id=com.ao307.ajirly.provider) and [AjirlyOwner on the Iraqi App Store](https://apps.apple.com/iq/app/ajirlyowner/id6499032520).

### Important limitations and inconsistencies

- No public owner-onboarding journey, contract, fee schedule, payout process or verification checklist was located.
- “Add bookings yourself” implies the calendar must accommodate bookings originating by phone, WhatsApp or walk-in as well as marketplace bookings. That is a strong product constraint, but the source does not explain conflict resolution or temporary holds.
- Public privacy declarations deserve caution. The owner app's Apple and Google listings currently declare that no data is collected, while the same official descriptions say owners can search bookings by customer phone number and manage customer bookings. This may reflect a distinction between app collection, server processing or an outdated declaration; the public pages do not resolve it. It is a warning to make future privacy disclosures match the actual data flow. [AjirlyOwner on Google Play](https://play.google.com/store/apps/details?id=com.ao307.ajirly.provider) · [AjirlyOwner on the Iraqi App Store](https://apps.apple.com/iq/app/ajirlyowner/id6499032520)
- The owner app's public copy does not establish permissions/roles for staff, multi-property ownership, audit history, finance/reconciliation, analytics, content approval, dispute management or document expiry.

## Iraq-specific constraints

### 1. Booking contract and evidence

**Confirmed fact.** Iraq's Electronic Signatures and Transactions Law applies to electronic transactions by natural or legal persons and to transactions whose parties agree to use electronic means. Its exclusion for dealings in immovable property expressly excepts rental contracts. It recognises electronic offer and acceptance, and gives electronic documents/writing/contracts the authenticity of paper counterparts when the information can be saved and retrieved, retained without undetectable alteration, and identifies sender/recipient and sending/receipt date and time. [Electronic Signatures and Transactions Law No. 78 of 2012, especially Articles 3, 13 and 18](https://moj.gov.iq/upload/pdf/%D9%82%D8%A7%D9%86%D9%88%D9%86%20%D8%A7%D9%84%D8%AA%D9%88%D9%82%D9%8A%D8%B9%20%D9%88%D8%A7%D9%84%D9%85%D8%B9%D8%A7%D9%85%D9%84%D8%A7%D8%AA%20%D8%A7%D9%84%D8%A7%D9%84%D9%83%D8%AA%D8%B1%D9%88%D9%86%D9%8A%D8%A9.pdf)

**Practical implication.** Store an immutable booking snapshot: parties, property/unit, period and timezone, price components, payment state, cancellation terms/version, house rules/version, acceptance event, and all status changes. Generate a customer-visible confirmation/reference and preserve notifications. Do not rely on the listing's current mutable text as the historical contract.

**Open questions.** Who is the contracting supplier: owner, platform, or both for different obligations? Does a booking request itself form a contract, or only owner confirmation/payment? What acceptance evidence and retention period will local counsel require?

### 2. Consumer information, cancellations and disputes

**Confirmed fact.** The Consumer Protection Law applies broadly to natural and legal persons that provide, market or advertise services. It gives consumers rights to material service information in an approved official form/language and evidence of receipt of a service stating value, date and relevant specifications. It prohibits deception and makes the provider responsible for consumer rights. [Consumer Protection Law No. 1 of 2010, especially Articles 3, 6, 8 and 9](https://www.moj.gov.iq/upload/pdf/%D9%82%D8%A7%D9%86%D9%88%D9%86%20%D8%AD%D9%85%D8%A7%D9%8A%D8%A9%20%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D9%87%D9%84%D9%83.pdf)

**Practical implication.** Before confirmation, show the total price, taxes/fees if any, period/check-in/check-out, capacity, material facilities and restrictions, cancellation/refund terms, owner/platform identity and support route. Issue a booking record. Treat material listing changes after booking as controlled changes requiring notice or re-acceptance.

**Open questions.** This research did not locate an official rule establishing a general cooling-off period or a standard cancellation window for short-stay bookings. Iraqi counsel should define enforceable cancellation, refund, owner cancellation, no-show, force-majeure, damage and dispute rules before launch. Ajirly's public site and policies did not disclose a cancellation/refund regime.

### 3. Payments, deposits and settlement

**Confirmed fact.** The Central Bank of Iraq says the current legal framework includes Electronic Payment Services Regulation No. 2 of 2024 and related technical/financial instructions. CBI publishes the authoritative list of licensed electronic payment service providers and has warned against unlicensed providers. [CBI electronic-payment legal framework](https://cbi.iq/news/print_news/2868) · [CBI list of non-bank financial institutions and licensed payment providers](https://www.cbi.iq/page/25) · [CBI warning on unlicensed payment companies](https://cbi.iq/news/view/650)

**Confirmed platform constraint.** A cottage stay is a physical service consumed outside the mobile app. Apple says such payments must use methods other than In-App Purchase; Google says Play Billing must not be used where payment is primarily for rental of physical goods or purchase of physical services. [Apple App Review Guideline 3.1.3(e)](https://developer.apple.com/app-store/review/guidelines/) · [Google Play Payments policy, section 3](https://support.google.com/googleplay/android-developer/answer/9858738)

**Practical implication.** Do not invent an internal wallet or hold customer funds without specialist regulatory advice. For online payments, integrate a CBI-licensed payment provider and contractually determine merchant-of-record, KYC, settlement, refunds and chargebacks. The product can still record cash/offline payment states if that is the agreed MVP model, but must not label an unpaid request as paid.

**Open questions.** Cash on arrival, bank/card/wallet payment, deposit size, who receives funds, whether the platform holds money, owner payout timing, refunds, chargebacks, failed payment, split settlement, platform commission and tax invoices all remain decisions. PSP availability, APIs, onboarding requirements, currency support and commercial terms must be confirmed directly with shortlisted CBI-listed providers.

### 4. Identity, contact data and privacy

**Confirmed fact.** The Iraqi Constitution protects personal privacy and the confidentiality of electronic and telephone communications, subject to stated legal/security exceptions and judicial process. [Constitution of the Republic of Iraq, Articles 17 and 40](https://iq.parliament.iq/en/wp-content/uploads/sites/3/2024/04/Constitution-of-the-Republic-of-Iraq.pdf)

Ajirly's own privacy policy says it may collect first/last name, phone number, usage/device data and, with permission, camera/photo-library content; it also describes account management, communications, service providers, international transfers, retention and deletion requests. This is a developer policy, not an Iraqi legal standard. [Ajirly developer privacy policy](https://sites.google.com/view/ajirly-privacy/)

**Practical implication.** Minimise data: phone verification may be sufficient for customers, while owner/property verification can be a separate restricted workflow. Keep national IDs, ownership evidence and exact home/property coordinates out of general support/admin access. Define retention and deletion rules, log access, obtain explicit permission for photos/location/camera, and disclose every processor/SDK accurately.

**Open questions.** What identity is legally necessary for customer booking, owner onboarding and PSP KYC? Which documents prove ownership or authority to rent? May verification data be stored outside Iraq? Which retention duties override deletion? This research did not locate a comprehensive Iraqi personal-data statute in the reviewed official sources; that is an access/research limitation, not a claim that none exists. Local counsel should confirm the current federal and Kurdistan Region position before selecting data residency and retention rules.

### 5. Business, tourism licensing and tax

**Confirmed fact.** The Ministry of Trade's Registrar of Companies provides a formal process for domestic/foreign company registration, beginning with name reservation and registration forms. [Ministry of Trade company-registration portal](https://tasjeel.mot.gov.iq/about.html)

The Iraqi Tourism Authority publishes conditions for granting a professional-practice licence to tourism facilities, but the linked official PDF could not be retrieved during this research and the public search result does not establish whether a private cottage/farm, its owner, the marketplace, or all of them fall within a licensed category. [Tourism Authority licensing document](https://tourism.gov.iq/common/files/manshourat/manshour1671608149.pdf)

The General Commission for Taxes states that the amended Real Estate Tax Law imposes tax on rented property and provides a filing/payment process at the branch responsible for the property's location. Its public guide currently describes the base calculation as 10% of annual rent after a 10% maintenance/depreciation deduction (effectively 9% of annual rent), but cottage stays, service income, platform commission and company income may be classified differently. [General Commission for Taxes, real-estate tax guide](https://tax.mof.gov.iq/%D8%AF%D9%84%D9%8A%D9%84-%D8%B6%D8%B1%D9%8A%D8%A8%D8%A9-%D8%A7%D9%84%D8%B9%D9%82%D8%A7%D8%B1/)

**Practical implication.** Owner onboarding should support a verification/compliance status and document expiry without claiming a licence type until the responsible authority/counsel confirms it. The platform needs a registered operating entity, accounting trail and a clear allocation of tax/invoicing duties. Do not calculate or withhold owner tax in the MVP without advice.

**Open questions.** Where will the operator be incorporated and managed? Does it act as advertising intermediary, booking agent or rental principal? What federal, governorate, municipal, tourism, health/safety or Kurdistan Region permissions apply to each property type/location? Are short stays taxed as property rent, tourism/service income or both? Is platform commission subject to separate income, withholding or other tax?

### 6. Location, addressing and access

**Confirmed fact.** Ajirly publicly promises GPS access after booking, rather than simply advertising a street address. [Ajirly on Google Play](https://play.google.com/store/apps/details?id=com.ao307.ajirly.user.iq)

Iraq's Statistics and GIS Authority maintains an official hierarchy and codes for governorates, districts and sub-districts, and was updating that directory for newly created units for the 2024 census. [Statistics and GIS Authority administrative-unit update](https://cosit.gov.iq/ar/2020-12-28-07-22-104) · [2024 governorate/district/sub-district table](https://cosit.gov.iq/documents/AAS2024/01.pdf)

**Practical implication.** Store a structured administrative location plus coordinates and owner-written directions/landmarks. Keep a canonical location vocabulary that can be updated; do not make owner free text the only searchable location. Consider showing an approximate area before booking and exact coordinates/directions only after the agreed trust/payment/confirmation state.

**Open questions.** Which map provider has acceptable coverage, Arabic/Kurdish labelling, deep links, offline behaviour and commercial terms for the target governorates? Is exact location disclosure a security/privacy choice or part of owner policy? What is the fallback when a guest has weak connectivity or the map pin is wrong? These require field tests with actual pilot properties; this research found no official basis for claiming a uniform national street-address quality level.

### 7. Languages, calendars and localisation

**Confirmed fact.** Iraq's Constitution makes Arabic and Kurdish the two official languages; Turkmen and Syriac are additional official languages in administrative units where their populations are concentrated, and regions/governorates can adopt other local official languages. [Constitution, Article 4](https://iq.parliament.iq/en/wp-content/uploads/sites/3/2024/04/Constitution-of-the-Republic-of-Iraq.pdf)

Ajirly's iOS release history specifically mentions fixing a calendar issue in Kurdish, while the store metadata currently lists the app language as English despite Arabic product copy. This shows why store metadata is not reliable evidence of complete in-app localisation and why calendar/directionality need direct testing. [Ajirly iOS listing](https://apps.apple.com/iq/app/ajirly-%D8%A7%D8%AC%D8%B1%D9%84%D9%8A/id6499079101) · [AjirlyOwner iOS listing](https://apps.apple.com/iq/app/ajirlyowner/id6499032520)

**Practical implication.** Decide the MVP language market explicitly. Arabic requires full RTL design and Iraqi wording/content review. Kurdish is not merely a translated string file: choose Sorani/other locale scope, typography, number/date formats, search aliases and support language, then test calendar and bidirectional content. Keep property content translations separate from interface translations.

**Open questions.** Arabic-only MVP or Arabic plus Kurdish? Who translates and moderates owner-generated descriptions/rules? Gregorian only or dual display? Arabic-Indic versus Western digits? Which timezone and day-boundary governs availability? What phone-number and currency formatting is expected?

### 8. App-store privacy, accounts, reviews and payments

**Confirmed fact.** If an iOS app supports account creation, Apple requires users to initiate full account deletion in-app. If a Play app enables account creation, Google requires an in-app deletion path and a web resource for requesting deletion of the account and associated data. [Apple account-deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/) · [Google Play account-deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)

If the app includes customer reviews, owner content or user-to-user communication, Apple's user-generated-content rules require filtering, reporting, blocking and published contact information. [Apple App Review Guideline 1.2](https://developer.apple.com/app-store/review/guidelines/)

**Practical implication.** Account deletion, data export/retention communication, privacy policy, support contact and accurate store privacy/data-safety declarations are release scope. Reviews/chat add moderation and abuse tooling, not just UI. Cottage payments use external/physical-service rails rather than Apple IAP or Google Play Billing, as noted above.

**Open questions.** Can customers browse without an account and authenticate only at booking? Are owner and customer identities separate roles or accounts? What booking/financial records must remain after account deletion? Will reviews ship in MVP, and if so who moderates Arabic/Kurdish content and handles reports?

## Product-design lessons stated as constraints/questions

These are the reusable lessons from Ajirly and the official constraints; they are intentionally not a feature-copying brief.

1. **Inventory truth:** How will an owner block a phone/WhatsApp booking so the marketplace never offers the same period twice? Do requests create expiring holds?
2. **Bookable unit:** Is a cottage sold per calendar day, overnight stay, fixed daytime/evening slot, or arbitrary start/end time? Which timezone and minimum turnaround apply?
3. **Confirmation boundary:** What exact event changes `requested` to `confirmed`: owner action, payment/deposit success, or both?
4. **Price snapshot:** Which components make the total—base period, weekend/holiday/event override, cleaning, platform fee, deposit, tax—and which are refundable?
5. **Trust claim:** Which evidence earns “owner verified” and “property verified,” who reviews it, and when does verification expire?
6. **Contracting party:** Is the marketplace an intermediary or the provider of the stay? The answer drives terms, receipts, support, money flow and liability language.
7. **Address disclosure:** What approximate location is sufficient for discovery, and at what confirmed state does the guest receive the exact pin and access directions?
8. **Offline reality:** Which owner actions must tolerate intermittent connectivity, and how are conflicting calendar updates resolved?
9. **Customer evidence:** Can both parties retrieve the accepted rules, price, period, status and payment record as they existed at confirmation?
10. **Cancellation state machine:** Who can cancel at each stage, what refund follows, what if the owner cancels, and who decides disputes?
11. **Content quality:** Which structured facts are mandatory (capacity, bedrooms, pool depth/safety, utilities, accessibility, family/event restrictions) so critical information is not buried in prose?
12. **Contact boundary:** Is in-platform chat/calling necessary for MVP, or can masked/released contact details provide coordination with less moderation and technical scope?
13. **Platform scope:** Can a responsive customer website and owner web backoffice validate the marketplace before separate native apps, or is native distribution a contractual requirement?
14. **Localisation scope:** Which languages and scripts are a launch promise, including owner content, support and moderation—not only navigation labels?

## MVP-focused checklist for `grill-with-docs`

### Market and scope

- [ ] Which city/governorate and how many pilot properties launch first?
- [ ] Does “cottage” include farms, chalets, villas, event venues, hotels, or only one regulated category?
- [ ] Is the MVP customer surface responsive web, native apps, or both? Is the owner surface web backoffice or separate app?
- [ ] Are customer and owner products operated by the same legal entity and brand?

### Booking model

- [ ] Define the bookable period, timezone, check-in/out and turnaround.
- [ ] Decide request-to-book versus instant booking.
- [ ] Define states and transitions: draft, held, requested, awaiting payment, confirmed, completed, cancelled, no-show, disputed, refunded.
- [ ] Define hold expiry and double-booking prevention, including manual/off-platform bookings.
- [ ] Decide modification/rescheduling rules.

### Price and money

- [ ] Confirm cash, card, wallet, transfer or mixed payment for MVP.
- [ ] Decide deposit/full payment timing and recipient.
- [ ] Decide platform commission and merchant-of-record.
- [ ] Shortlist CBI-licensed PSPs and verify APIs, onboarding, settlement, refunds and KYC directly.
- [ ] Define total-price components, holiday/event overrides and refundable damage deposit.
- [ ] Obtain Iraq tax/accounting advice for platform and owners.

### Trust, safety and compliance

- [ ] Define owner identity, authority-to-rent and property-verification evidence.
- [ ] Confirm tourism/business/municipal licence requirements per pilot location/property type.
- [ ] Define guest identity requirements and minimum age.
- [ ] Decide when exact location and direct contact details are disclosed.
- [ ] Define prohibited properties/content, incident handling and emergency contact.
- [ ] Obtain Iraqi counsel review of the marketplace role, terms, privacy, cancellations and dispute process.

### Customer experience

- [ ] Define searchable location hierarchy and map/pin behaviour.
- [ ] Define mandatory structured listing facts, images, rules, amenities and safety details.
- [ ] Decide whether browse/search works without login.
- [ ] Define confirmation, reminder, direction and cancellation notifications (SMS, push, email, WhatsApp if lawful/approved).
- [ ] Decide whether reviews ship; if so, limit eligibility to completed bookings and design moderation/reporting.

### Owner operations

- [ ] Define property creation, moderation and publishing workflow.
- [ ] Define calendar, manual blocks/bookings, overrides and conflict handling.
- [ ] Define owner booking response SLA and auto-expiry.
- [ ] Define staff roles, audit log and multi-property support.
- [ ] Define payout/reconciliation/support needs if money flows through the platform.

### Data and platform release

- [ ] Decide Arabic/Kurdish launch scope, RTL, calendar, number and currency formatting.
- [ ] Inventory personal data and processors; set access, retention and deletion rules.
- [ ] Build iOS/Android account deletion and Google's web deletion route if native accounts ship.
- [ ] Prepare accurate privacy policy, App Store privacy labels and Google Play Data Safety answers from the actual architecture.
- [ ] Define evidence retained for each booking without retaining unnecessary identity documents.

## Source-quality and access limitations

- Ajirly feature evidence is first-party but promotional. The app-store privacy information is developer-supplied and explicitly not verified by Apple/Google.
- The live app was not installed or exercised with customer/owner accounts; screenshots and marketing copy cannot prove state transitions, payment behaviour or operational quality.
- No Ajirly public terms of service, cancellation/refund policy, owner agreement, fee schedule, verification standard or payment-provider disclosure was located on its official site during this research.
- Iraqi Ministry of Justice English translations are official translations, but legal interpretation and current amendments require Iraqi counsel.
- The Tourism Authority licensing PDF appeared in the official search index but failed retrieval during research, so no conclusion is drawn about cottage classification.
- Official sources establish that regulated payment providers, company/tax processes, consumer rights and electronic contracting matter. They do not by themselves determine the platform's exact legal role or the obligations of every property in every federal/Kurdistan/local jurisdiction.
- Mapping coverage, connectivity, user payment preference and address quality require pilot field research; no unsupported market-wide claim is made here.

