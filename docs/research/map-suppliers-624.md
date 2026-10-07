# Map suppliers: research for issue 624

Status: recommendation made; the owner decided on 7 October 2026 that a place-name search box is included; the owner left the supplier choice with Yasir on 7 October 2026, and it will be recorded on issue 645. Research date: 7 October 2026. Inspected RentCottage base: `748a91fdf0a0da7192594a1c76be5472ab153cde`. Scope: the owner's private map picker (#508) and the paid Confirmed Booking map (#509). No account was opened, no key was created and no code was changed.

## Recommendation

Use Esri ArcGIS Location Platform for both maps and for the place-name search box.

The reasons:

1. Its satellite picture was checked in two towns and in open country. It shows the individual building, which is what the owner needs to place the pin by eye.
2. Its search found 33 of 36 test place names across English, Sorani and Arabic. The details are in [Place-name search test](#place-name-search-test).
3. Its agreement, read in full, allows revenue-generating applications. No payment card is needed while use stays inside the free allowance of 2 million tiles and 20,000 searches a month.
4. People viewing the map need no account with the supplier. This matters most on the paid booking map, which shows a customer's exact destination.
5. The rule for storing a position is clear and cheap. A search that only moves the map is free inside the allowance, and the owner then places the pin.

This choice has costs:

- Google's picture is sharper, and Google shows local names in Kurdish script.
- Esri labels have no Kurdish option.
- An Esri key must be replaced at least once a year.
- Saving a searched position directly costs 4 US dollars per 1,000 searches and needs a payment method.

Google Maps Platform is no longer the runner-up on equal terms. Its terms forbid use in a listings or directory service and forbid creating content from its satellite picture. They also limit a stored search position to 30 days. Choosing Google needs a legal reading first.

Mapbox would need its sales team to confirm that a rental marketplace is not "real estate" under its terms.

MapTiler is the simpler fallback at 30 US dollars a month. Kurdish labels are listed. Its search rests on OpenStreetMap data, which found 19 of 36 test place names in the proxy test.

The map sits behind the provider-neutral map boundary, so changing supplier later replaces one adapter.

## What the two maps need

The owner's map picker (#508) is a satellite map on the cottage owner's private editing page. The owner places or drags a pin on the cottage. A place-name search box moves the map to a named place. Typed latitude and longitude stay as the fallback.

The booking map (#509) shows a paid Confirmed Booking's exact point on a map to its authorised customer and owner. It also hands directions off to the person's own maps app. That handoff is a link and needs no supplier.

Both maps sit behind the provider-neutral map boundary, so no page names a supplier. Neither map is on a public page.

Expected use is small: owners editing cottages and people opening paid bookings. While the marketplace has no live customers, that is far below every free allowance listed below.

A browser map always needs a key that the browser holds. Every supplier's key must therefore be restricted to the site.

## Comparison

Every source below was read on 7 October 2026. Prices are in US dollars. "Not checked" and "not established" mean the fact could not be confirmed from an official page or a test; the details are in [Verification and limits](#verification-and-limits).

| Supplier | Free monthly allowance and price after it | Commercial use | Satellite picture of rural Kurdistan Region | Arabic and Kurdish place names | What the supplier learns from each request | How its keys are restricted |
|---|---|---|---|---|---|---|
| Google Maps Platform | 10,000 map loads free, then 7.00 per 1,000 | Allowed in general, but the listings clause and the satellite tracing clause put RentCottage's use in doubt | Sharpest of the suppliers viewed, in one town and open country | Arabic supported. Kurdish not in the supported language list, though local names in Kurdish script appeared on the public map | Search terms, Internet Protocol (IP) addresses and latitude and longitude, which Google may keep and use to improve its products | By website and by which services the key may call |
| Mapbox | 50,000 map loads free, then 5.00 per 1,000 | An application related to real estate must buy a separate commercial licence first. That may cover RentCottage, so the free allowance may not apply | Not checked | Arabic supported. Kurdish not supported | IP address kept 30 days, browser and device, map view activity | By listed website addresses and by scopes |
| MapTiler | Free plan is non-commercial only. Flex plan 30 a month with 25,000 sessions, then 2.50 per 1,000 sessions | Needs the paid Flex plan from launch | Clear in one town, slightly softer than Google. Open country not checked | Arabic supported with no plugin. Kurdish listed, code "ku". Whether that covers Sorani was not established | IP address kept up to two months; no tracking for advertising | By allowed website origins |
| Esri ArcGIS Location Platform | 2 million tiles free, then 0.15 per 1,000 tiles | Allowed, revenue-generating applications included. Agreement read in full. No payment method needed inside the free allowance | Clear in two towns and open country at zoom level 18 | Arabic supported. Kurdish not in the language list | Log files hold IP address, browser type, internet service provider and clickstream data. No fixed retention period stated. Viewers need no Esri account | By chosen privileges and listed website addresses; valid for at most one year |

### Google Maps Platform

Price: Dynamic Maps gives 10,000 free map loads a month, then 7.00 US dollars per 1,000, falling to 5.60 from 100,001. Geocoding, which turns a place name or address into a map position, gives 10,000 free requests, then 5.00 per 1,000. Autocomplete requests give 10,000 free, then 2.83 per 1,000. Place Details Essentials gives 10,000 free, then 5.00 per 1,000. The page mentions subscription plans, but their names and prices were not read. [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing), page dated 7 October 2026.

Commercial and private use: allowed in general. The frequently asked questions (FAQ) page says the services "can be used with private-access applications". [Google Maps Platform FAQ](https://developers.google.com/maps/faq). The Terms of Service, last modified 26 August 2026, and the Service Specific Terms, last modified 10 June 2026, were read in full in a browser. [Google Maps Platform terms](https://cloud.google.com/maps-platform/terms) and [Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms). Iraq is not on the prohibited territories list, which names China, Crimea, Cuba, Donetsk People's Republic, Iran, Luhansk People's Republic, North Korea, Syria and Vietnam. The list was read directly on its page, last modified 21 March 2022. [Prohibited territories](https://cloud.google.com/maps-platform/terms/maps-prohibited-territories).

Policies: the site must publish Terms of Use and a Privacy Policy that incorporate Google's Terms of Service and Privacy Policy. Google attribution must stay visible. Content other than place IDs may not be pre-fetched, cached or stored. [Maps JavaScript policies](https://developers.google.com/maps/documentation/javascript/policies).

Storing a position: section 3.2.3 of the Terms of Service says the customer "will not cache Google Maps Content except as expressly permitted under the Maps Service Specific Terms". The Service Specific Terms give these permissions:

- Section 14.3, for the Places application programming interface (API), and section 15.2, for the Places UI Kit, allow latitude and longitude to be cached "for up to 30 consecutive calendar days".
- Section 6.3.2, for the Geocoding API, allows indefinite caching only to support the feature the same End User asked for, kept separate per End User. End User is the terms' name for a person using the site.
- There is no section for the Maps JavaScript API, which draws the map. So nothing expressly permits storing a position taken from the map itself.

Two restrictions on RentCottage's kind of use: the first is headed "No Creating Content From Google Maps Content". Its example is that the customer will not "trace or digitize roadways, building outlines, utility posts, or electrical lines from the Maps JavaScript API Satellite base map type". Placing a pin on a building seen in Google's satellite picture and storing its position may fall under this. The second says the customer will not "use the Google Maps Core Services in a listings or directory service". RentCottage is a listings marketplace, so this clause needs a legal reading before Google could be chosen.

Satellite picture: viewed on the public Google Maps website at Rawanduz town (36.61, 44.52) and at open country between Shaqlawa and Koya (36.33, 44.43). It was the sharpest of the suppliers viewed. Individual houses, walls, vehicles and farm tracks are clear. The imagery is credited to Airbus, CNES and Maxar Technologies, 2026.

Place names: Arabic is a supported language. Kurdish is not in the supported language list. [Google Maps Platform FAQ](https://developers.google.com/maps/faq). On the public map, local businesses in Rawanduz showed names in Kurdish script beside English, and minor rural tracks were drawn.

What the supplier learns: the Terms of Service say "Google collects and receives data from Customer and End Users ... including search terms, IP addresses, and latitude/longitude coordinates". They say Google "may use and retain this data to provide and improve Google products and services". The site's own terms must tell users that it includes Google Maps features, subject to Google's Maps End User Additional Terms and Privacy Policy. A person signed in to Google in the same browser is a known Google user. Whether map views are linked to that account was not established.

Search: Google's Places search needs a key and was not tested. See [Place-name search test](#place-name-search-test).

Keys: a key is restricted by website, using the Hypertext Transfer Protocol (HTTP) referrer, and by which services it may call. Google recommends separate keys per application, and states that "Maps JavaScript API keys are necessarily exposed in the browser". [API security best practices](https://developers.google.com/maps/api-security-best-practices).

### Mapbox

Price: Mapbox GL JS gives up to 50,000 free map loads a month, then 5.00 US dollars per 1,000. Temporary Geocoding gives 100,000 free requests, then 0.75 per 1,000. Search Box gives 500 free sessions a month, then 3.00 per 1,000 sessions. [Mapbox pricing](https://www.mapbox.com/pricing).

Commercial use: the Terms of Service, last updated 31 March 2024, were read in full in a browser. They say: "If your Licensed Application is related to business intelligence or analytics, sales performance management, cloud database management systems, or real estate, you must purchase a separate commercial license under an active order before accessing or using Services in your Licensed Application for any production use." A cottage rental marketplace may count as real estate. If it does, the free pay-as-you-go allowance does not apply. Mapbox's sales team would have to confirm. [Mapbox Terms of Service](https://www.mapbox.com/legal/tos).

Satellite picture: not checked. No public viewer could be loaded at the test points.

Place names: Arabic is supported and Kurdish is not. When a translated name is missing, the local name is shown. [Change the map language](https://docs.mapbox.com/help/troubleshooting/change-language/). Right-to-left text needs the mapbox-gl-rtl-text plugin. [Right-to-left text plugin](https://docs.mapbox.com/mapbox-gl-js/example/mapbox-gl-rtl-text/).

What the supplier learns: the IP address, kept 30 days for service, billing and security and then deleted; the browser, device and operating system; and map view and tile request activity. Mapbox uses these to provide and improve its products. [Mapbox privacy](https://www.mapbox.com/legal/privacy), Product Privacy Policy updated January 2025.

Search: not tested, because Mapbox's search needs an account.

Keys: public tokens are for the browser and secret tokens are for servers. A token can be restricted to listed website addresses and to scopes. Separate tokens per environment are recommended. [Mapbox access tokens](https://docs.mapbox.com/accounts/guides/tokens/).

### MapTiler

Price: the Free plan gives 5,000 map sessions and 100,000 requests a month, for non-commercial use only. The Flex plan costs 30 US dollars a month and allows commercial use. It includes 25,000 sessions, 500,000 requests and 3,000 search sessions, then charges 2.50 per 1,000 sessions and 0.15 per 1,000 requests. Satellite imagery and search are included in both plans. [MapTiler pricing](https://www.maptiler.com/cloud/pricing/).

Commercial use: the terms say "Usage of the Free Plan is limited to non-commercial use and research & development for commercial products applications". RentCottage therefore needs the Flex plan from launch. Server-side caching of map content is prohibited. An export clause cites Swiss, United States, European Union and United Kingdom law without naming countries. Attribution must be shown. [MapTiler terms](https://www.maptiler.com/terms/cloud/).

Satellite picture: viewed on MapTiler's public map viewer at Rawanduz town (36.61, 44.52). Individual houses and streets are clear, slightly softer than Google. The open-country picture was not checked: the public viewer would not load it, and the browser's screenshot function failed.

Place names: Arabic and other right-to-left languages are supported by default with no plugin. [MapTiler languages](https://docs.maptiler.com/sdk-js/api/languages/). Kurdish is listed, with the code "ku", in two places: [the language list in MapTiler's client library](https://docs.maptiler.com/client-js/api/variables/language.Language/) and [its map data schema](https://docs.maptiler.com/schema/planet/zlanguages/). Whether that covers Sorani specifically was not established.

What the supplier learns: the IP address of a person viewing a customer's map, processed for a security check and kept up to two months. The policy says maps carry no tracking for advertising. The hosting country is not stated. [MapTiler privacy policy](https://www.maptiler.com/privacy-policy/).

Search: not tested with MapTiler's own service, which needs an account. MapTiler's search is built on OpenStreetMap data, so the OpenStreetMap row in the [Place-name search test](#place-name-search-test) is a proxy for it.

Keys: a key is restricted to allowed website origins. A separate key per application is recommended, and so is rotation every two to three months. [Protect your map key](https://docs.maptiler.com/guides/maps-apis/maps-platform/how-to-protect-your-map-key/).

### Esri ArcGIS Location Platform

Price: there are two ways to pay for the map. Basemap tiles, imagery included, give 2 million free a month, then cost 0.15 US dollars per 1,000 tiles. Basemap sessions give 1,000 free a month, then cost 4 per 1,000 sessions. [ArcGIS Location Platform pricing](https://location.arcgis.com/pricing/). One session gives one person unlimited tiles for 12 hours. [Basemap styles service](https://developers.arcgis.com/rest/basemap-styles/). Geocodes that are not stored give 20,000 free requests, then cost 0.50 per 1,000. Geocodes that are stored cost 4 per 1,000, with no free allowance.

Commercial use: allowed. The licensing page says: "You can deploy commercial and revenue-generating applications with ArcGIS Location Platform." It says the platform can be used with open-source map libraries, and names MapLibre GL JS among them. [Licensing and attribution](https://location.arcgis.com/help/licensing-and-attribution/). The ArcGIS Location Platform Agreement, revised 21 November 2025, was read in full. It says: "Customer may create and distribute both non-revenue generating and revenue-generating Customer Applications". Its export clause names no country except Russia and Belarus, and otherwise refers to United States embargoed countries. Iraq is not named. [ArcGIS Location Platform Agreement](https://www.esri.com/content/dam/esrisites/en-us/media/legal/platform/platform-legal.pdf). "Powered by Esri" attribution must be displayed and cannot be removed. [Esri and data attribution](https://developers.arcgis.com/documentation/esri-and-data-attribution/).

Payment: the billing page says "A payment method is required to enable pay-as-you-go (PAYG) to continue using services beyond the free tier." So no card is needed while use stays inside the free allowance. The accepted methods are credit card, purchase order and voucher. [ArcGIS Location Platform billing](https://location.arcgis.com/help/billing/).

Storing a searched position: the Agreement says results may not be cached or stored except as listed, and the listed exception is the "Geocode (stored)" service. So there are two ways to build the search box:

- The search only moves the map, and the owner then places the pin. This uses the free not-stored service.
- The searched position itself is saved. This needs the stored service, at 4 US dollars per 1,000 searches, and a payment method.

The plan for #508 must choose which.

Satellite picture: single tiles were fetched from Esri's public World Imagery service at Rawanduz town, Shaqlawa town (36.405, 44.32) and the open-country point (36.33, 44.43). Houses, vehicles, individual trees and tracks are clear at zoom level 18. Zoom level 19 returned "Map data not yet available" at all three points, so 18 is the closest real picture there. A map can still enlarge it.

Place names: Arabic is supported for labels. Kurdish is not in the language list. A "local" option shows names as written locally. [ArcGIS imagery style](https://developers.arcgis.com/rest/basemap-styles/arcgis-imagery-style-get/).

What the supplier learns: Esri's privacy statement, effective 31 July 2026, says log files hold "the internet protocol (IP) address, browser type, internet service provider (ISP), and clickstream data". It states no fixed retention period. It was read through the automated reader. [Esri privacy statement](https://www.esri.com/en-us/privacy/privacy-statements/privacy-statement). The Agreement says Esri processes personal data under its Data Processing Addendum. Whether these logs cover map tile requests specifically was not established. People viewing the map need no Esri account.

Search: Esri's search found 33 of 36 test place names. See [Place-name search test](#place-name-search-test).

Keys: a key is limited to chosen privileges and to listed referrer website addresses. It is valid for at most one year, so it must be replaced at least yearly. [API key authentication](https://developers.arcgis.com/documentation/security-and-authentication/api-key-authentication/).

## Place-name search test

Esri's search found 33 of 36 test place names. OpenStreetMap data, the proxy for MapTiler, found 19 of 36. Google, Mapbox and MapTiler's own search could not be tested without an account or key.

Method: twelve places in the Kurdistan Region were used: Shaqlawa, Rawanduz, Dukan, Choman, Amedi, Sulav, Bekhal, Ahmadawa, Barzan, Zawita, Tawela and Hiran. Each was typed in English, Sorani and Arabic, which makes 36 lookups per search service. Only the first result was looked at. It counted as found when it was within about 10 kilometres of an approximate reference point. The reference points are approximate, so a result several kilometres off can still be the right place.

| Search service | English | Sorani | Arabic | Total | Note |
|---|---|---|---|---|---|
| Esri | 11 of 12 | 11 of 12 | 11 of 12 | 33 of 36 | Its public geocoding service, with searches limited to Iraq |
| OpenStreetMap data (proxy) | 5 of 12 | 9 of 12 | 5 of 12 | 19 of 36 | Through the public Photon search service, limited to a box around Iraq. A proxy for MapTiler only |
| Google | Not tested | Not tested | Not tested | Not tested | Its Places search needs a key |

Esri's three misses:

- "Dukan" in English returned a different Dukan 91 kilometres away.
- "Hiran" in Sorani returned a place 17 kilometres away.
- "Sulav" in Arabic returned a school 245 kilometres away.

OpenStreetMap data: English and Arabic searches often returned a shop, restaurant or street with a similar name far away. This row is a proxy only. MapTiler's search is built on OpenStreetMap data, but MapTiler's own search and Mapbox's search could not be tested without an account.

Google: two searches were tried on the public Google Maps website, with no country limit. They are not comparable with the rows above. "سۆلاڤ" returned a Solav in Duhok Governorate, about 75 kilometres from the resort near Amedi. "هیران" returned Hiran in Somalia.

## Suppliers considered and set aside

HERE: the public pricing page did not show its free allowance or prices when read, so cost could not be compared. [HERE pricing](https://www.here.com/get-started/pricing).

Azure Maps: only 1,000 free imagery tile transactions a month, and prices above the free allowance were not shown on the page read. [Azure Maps pricing](https://azure.microsoft.com/en-us/pricing/details/azure-maps/).

OpenStreetMap-based suppliers without their own satellite imagery were not compared, because #508 requires satellite imagery.

## The search box

The owner decided on 7 October 2026 that the map picker includes a place-name search box.

What it costs and requires:

- Every typed search is sent to the supplier.
- It is a second billed service beside the map. Esri gives 20,000 free searches a month, then charges 0.50 US dollars per 1,000, when the result is not stored. Google gives 10,000 free Autocomplete requests, then charges 2.83 per 1,000. Mapbox gives 500 free Search Box sessions, then charges 3.00 per 1,000 sessions. MapTiler's Flex plan includes 3,000 search sessions.
- Each supplier has its own rule on storing a searched position. Esri allows it only through its stored service, at 4 US dollars per 1,000 searches with a payment method. A search that only moves the map, after which the owner places the pin, stays on the free not-stored service. Google allows a position from its Places search to be kept for at most 30 consecutive calendar days. The rule for Mapbox and for MapTiler was not established.
- Search quality differs by supplier. See [Place-name search test](#place-name-search-test).

The owner can still pan and zoom the satellite map and type the numbers.

## Owner decision

Two decisions are made, both by the owner on 7 October 2026 and both recorded on issue 624:

- A place-name search box is included.
- The choice of supplier is left with Yasir.

One question is open: which supplier is used. Issue 645 carries the options for Yasir and records the answer. The architecture decision record for the chosen supplier is written by #508.

## Verification and limits

Pages were read in a browser on 7 October 2026. Some figures first came through an automated reader that summarises long pages. Those should be rechecked on the supplier's own page before any contract.

The following remain unverified or only partly checked:

- Mapbox's satellite picture was not checked.
- MapTiler's open-country picture was not checked.
- The search quality of Google Places, Mapbox and MapTiler's own service was not tested. Each needs an account.
- Whether MapTiler's Kurdish covers Sorani was not established.
- Google's subscription plans were not read.
- Whether Esri's logs cover tile requests, and how long they are kept, was not established.
- Whether map views are linked to a signed-in Google account was not established.
- The rule on storing a searched position was not established for Mapbox or MapTiler.
- Whether an Iraq-based payer can add a payment method for any paid tier was not checked.
- Satellite pictures were compared by eye at three points only. They were not measured, and imagery dates were not established.
- The search test used approximate reference points and only the first result.
- Whether RentCottage counts as a "listings or directory service" under Google's terms, or as "real estate" under Mapbox's, is a legal question this research does not answer.
- No account was opened, no key was created and no request was made with a key.
