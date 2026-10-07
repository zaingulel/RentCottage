# Map suppliers: research for issue 624

Status: recommendation made; the owner's supplier choice and search-box decision are pending and will be recorded on issue 624. Research date: 7 October 2026. Inspected RentCottage base: `748a91fdf0a0da7192594a1c76be5472ab153cde`. Scope: the owner's private map picker (#508) and the paid Confirmed Booking map (#509). No account was opened, no key was created and no code was changed.

## Recommendation

Use Esri ArcGIS Location Platform for both maps, and leave the place-name search box out of the first version.

The reasons:

1. Its satellite picture was checked in two towns and in open country. It shows the individual building, which is what the owner needs to place the pin by eye.
2. Commercial use is included at no monthly cost, with 2 million free tiles a month. MapTiler costs 30 US dollars a month from launch.
3. People viewing the map need no account with the supplier. This matters most on the paid booking map, which shows a customer's exact destination.
4. No storage limit on a pin position was found. Google's terms restrict stored content and could not be read in full.

This choice has costs:

- Google's picture is sharper, and Google shows local names in Kurdish script.
- Esri labels have no Kurdish option.
- An Esri key must be replaced at least once a year.
- Esri's master agreement and privacy terms still need reading before #508 plans the build.

The runner-up is Google Maps Platform, if the owner values the sharpest picture and local names most. That choice depends on one condition: the current Google terms must be confirmed to allow storing a dragged pin's position permanently.

The map sits behind the provider-neutral map boundary, so changing supplier later replaces one adapter.

## What the two maps need

The owner's map picker (#508) is a satellite map on the cottage owner's private editing page. The owner places or drags a pin on the cottage. Typed latitude and longitude stay as the fallback.

The booking map (#509) shows a paid Confirmed Booking's exact point on a map to its authorised customer and owner. It also hands directions off to the person's own maps app. That handoff is a link and needs no supplier.

Both maps sit behind the provider-neutral map boundary, so no page names a supplier. Neither map is on a public page.

Expected use is small: owners editing cottages and people opening paid bookings. While the marketplace has no live customers, that is far below every free allowance listed below.

A browser map always needs a key that the browser holds. Every supplier's key must therefore be restricted to the site.

## Comparison

Every source below was read on 7 October 2026. Prices are in US dollars. "Not verified" means the fact could not be confirmed from an official page; the details are in [Verification and limits](#verification-and-limits).

| Supplier | Free monthly allowance and price after it | Commercial use | Satellite picture of rural Kurdistan Region | Arabic and Kurdish place names | What the supplier learns from each request | How its keys are restricted |
|---|---|---|---|---|---|---|
| Google Maps Platform | 10,000 map loads free, then 7.00 per 1,000 | Allowed, including private-access applications. Whether a dragged pin's position may be stored permanently is not verified | Sharpest of the suppliers viewed, in one town and open country | Arabic supported. Kurdish not in the supported language list, though local names in Kurdish script appeared on the public map | Not verified in detail | By website and by which services the key may call |
| Mapbox | 50,000 map loads free, then 5.00 per 1,000 | No non-commercial limit found on pay-as-you-go use; confirm before signing up | Not checked | Arabic supported. Kurdish not supported | Internet Protocol (IP) address kept 30 days, browser and device, map view activity | By listed website addresses and by scopes |
| MapTiler | Free plan is non-commercial only. Flex plan 30 a month with 25,000 sessions, then 2.50 per 1,000 sessions | Needs the paid Flex plan from launch | Clear in one town, slightly softer than Google. Open country not checked | Arabic supported with no plugin. Kurdish not verified | IP address kept up to two months; no tracking for advertising | By allowed website origins |
| Esri ArcGIS Location Platform | 2 million tiles free, then 0.15 per 1,000 tiles | Included with the free subscription. Master agreement not verified | Clear in two towns and open country at zoom level 18 | Arabic supported. Kurdish not in the language list | Not verified. Viewers need no Esri account | By chosen privileges and listed website addresses; valid for at most one year |

### Google Maps Platform

Price: Dynamic Maps gives 10,000 free map loads a month, then 7.00 US dollars per 1,000, falling to 5.60 from 100,001. Geocoding, which turns a place name or address into a map position, gives 10,000 free requests, then 5.00 per 1,000. Autocomplete requests give 10,000 free, then 2.83 per 1,000. Place Details Essentials gives 10,000 free, then 5.00 per 1,000. The page mentions subscription plans, but their names and prices could not be read. [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing), page dated 7 October 2026.

Commercial and private use: allowed. The frequently asked questions (FAQ) page says the services "can be used with private-access applications". [Google Maps Platform FAQ](https://developers.google.com/maps/faq). Iraq is not on the prohibited territories list, which names China, Crimea, Cuba, Donetsk People's Republic, Iran, Luhansk People's Republic, North Korea, Syria and Vietnam. This list was read through a search result summary, because the page itself would not load in full. [Prohibited territories](https://cloud.google.com/maps-platform/terms/maps-prohibited-territories).

Policies: the site must publish Terms of Use and a Privacy Policy that incorporate Google's Terms of Service and Privacy Policy. Google attribution must stay visible. Content other than place IDs may not be pre-fetched, cached or stored. [Maps JavaScript policies](https://developers.google.com/maps/documentation/javascript/policies).

Storing a position: an archived May 2025 version of the Service Specific Terms lets latitude and longitude from Geocoding and Places be cached for at most 30 consecutive days. [Archived Service Specific Terms, May 2025](https://cloud.google.com/archive/maps-platform/terms/maps-service-terms-20250501). The current terms pages would not load in full: [Google Maps Platform terms](https://cloud.google.com/maps-platform/terms) and [Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms). So whether a point the owner picks by dragging a pin, with no search, may be stored permanently is not verified. A Google search box would bring the 30-day limit onto a stored point.

Satellite picture: viewed on the public Google Maps website at Rawanduz town (36.61, 44.52) and at open country between Shaqlawa and Koya (36.33, 44.43). It was the sharpest of the suppliers viewed. Individual houses, walls, vehicles and farm tracks are clear. The imagery is credited to Airbus, CNES and Maxar Technologies, 2026.

Place names: Arabic is a supported language. Kurdish is not in the supported language list. [Google Maps Platform FAQ](https://developers.google.com/maps/faq). On the public map, local businesses in Rawanduz showed names in Kurdish script beside English, and minor rural tracks were drawn.

What the supplier learns: the policies page does not list it and points to Google's Privacy Policy. This is not verified in detail. A person signed in to Google in the same browser is a known Google user. Whether map views are linked to that account was not verified.

Keys: a key is restricted by website, using the Hypertext Transfer Protocol (HTTP) referrer, and by which services it may call. Google recommends separate keys per application, and states that "Maps JavaScript API keys are necessarily exposed in the browser". API stands for application programming interface. [API security best practices](https://developers.google.com/maps/api-security-best-practices).

### Mapbox

Price: Mapbox GL JS gives up to 50,000 free map loads a month, then 5.00 US dollars per 1,000. Temporary Geocoding gives 100,000 free requests, then 0.75 per 1,000. Search Box gives 500 free sessions a month, then 3.00 per 1,000 sessions. [Mapbox pricing](https://www.mapbox.com/pricing).

Commercial use: the Terms of Service, last updated 31 March 2024, do not name a non-commercial limit on pay-as-you-go use and name no restricted country. Separate licences are required only for vehicle and business-intelligence applications. This reading came from an automated summary of a long page and should be confirmed before signing up. [Mapbox Terms of Service](https://www.mapbox.com/legal/tos).

Satellite picture: not checked. No public viewer could be loaded at the test points.

Place names: Arabic is supported and Kurdish is not. When a translated name is missing, the local name is shown. [Change the map language](https://docs.mapbox.com/help/troubleshooting/change-language/). Right-to-left text needs the mapbox-gl-rtl-text plugin. [Right-to-left text plugin](https://docs.mapbox.com/mapbox-gl-js/example/mapbox-gl-rtl-text/).

What the supplier learns: the Internet Protocol (IP) address, kept 30 days for service, billing and security and then deleted; the browser, device and operating system; and map view and tile request activity. Mapbox uses these to provide and improve its products. [Mapbox privacy](https://www.mapbox.com/legal/privacy), Product Privacy Policy updated January 2025.

Keys: public tokens are for the browser and secret tokens are for servers. A token can be restricted to listed website addresses and to scopes. Separate tokens per environment are recommended. [Mapbox access tokens](https://docs.mapbox.com/accounts/guides/tokens/).

### MapTiler

Price: the Free plan gives 5,000 map sessions and 100,000 requests a month, for non-commercial use only. The Flex plan costs 30 US dollars a month and allows commercial use. It includes 25,000 sessions, 500,000 requests and 3,000 search sessions, then charges 2.50 per 1,000 sessions and 0.15 per 1,000 requests. Satellite imagery and search are included in both plans. [MapTiler pricing](https://www.maptiler.com/cloud/pricing/).

Commercial use: the terms say "Usage of the Free Plan is limited to non-commercial use and research & development for commercial products applications". RentCottage therefore needs the Flex plan from launch. Server-side caching of map content is prohibited. An export clause cites Swiss, United States, European Union and United Kingdom law without naming countries. Attribution must be shown. [MapTiler terms](https://www.maptiler.com/terms/cloud/).

Satellite picture: viewed on MapTiler's public map viewer at Rawanduz town (36.61, 44.52). Individual houses and streets are clear, slightly softer than Google. The open-country point did not load in the viewer and was not checked.

Place names: Arabic and other right-to-left languages are supported by default with no plugin. [MapTiler languages](https://docs.maptiler.com/sdk-js/api/languages/). A search result summary said Kurdish is in the language list, but the page read did not confirm it. Kurdish support is not verified.

What the supplier learns: the IP address of a person viewing a customer's map, processed for a security check and kept up to two months. The policy says maps carry no tracking for advertising. The hosting country is not stated. [MapTiler privacy policy](https://www.maptiler.com/privacy-policy/).

Keys: a key is restricted to allowed website origins. A separate key per application is recommended, and so is rotation every two to three months. [Protect your map key](https://docs.maptiler.com/guides/maps-apis/maps-platform/how-to-protect-your-map-key/).

### Esri ArcGIS Location Platform

Price: there are two ways to pay for the map. Basemap tiles, imagery included, give 2 million free a month, then cost 0.15 US dollars per 1,000 tiles. Basemap sessions give 1,000 free a month, then cost 4 per 1,000 sessions. [ArcGIS Location Platform pricing](https://location.arcgis.com/pricing/). One session gives one person unlimited tiles for 12 hours. [Basemap styles service](https://developers.arcgis.com/rest/basemap-styles/). Geocoding that is not stored gives 20,000 free requests, then costs 0.50 per 1,000.

Commercial use: the subscription is free to open and "comes with a commercial deployment license" for public or private applications. This was read through a search result summary. [ArcGIS Location Platform FAQ](https://location.arcgis.com/faq/). "Powered by Esri" attribution must be displayed and cannot be removed. [Esri and data attribution](https://developers.arcgis.com/documentation/esri-and-data-attribution/). The master agreement text itself, including any export clause, could not be read and is not verified.

Satellite picture: single tiles were fetched from Esri's public World Imagery service at Rawanduz town, Shaqlawa town (36.405, 44.32) and the open-country point (36.33, 44.43). Houses, vehicles, individual trees and tracks are clear at zoom level 18. Zoom level 19 returned "Map data not yet available" at all three points, so 18 is the closest real picture there. A map can still enlarge it.

Place names: Arabic is supported for labels. Kurdish is not in the language list. A "local" option shows names as written locally. [ArcGIS imagery style](https://developers.arcgis.com/rest/basemap-styles/arcgis-imagery-style-get/).

What the supplier learns: not verified. Esri's privacy terms were not read. People viewing the map need no Esri account.

Keys: a key is limited to chosen privileges and to listed referrer website addresses. It is valid for at most one year, so it must be replaced at least yearly. [API key authentication](https://developers.arcgis.com/documentation/security-and-authentication/api-key-authentication/).

## Suppliers considered and set aside

HERE: the public pricing page did not show its free allowance or prices when read, so cost could not be compared. [HERE pricing](https://www.here.com/get-started/pricing).

Azure Maps: only 1,000 free imagery tile transactions a month, and prices above the free allowance were not shown on the page read. [Azure Maps pricing](https://azure.microsoft.com/en-us/pricing/details/azure-maps/).

OpenStreetMap-based suppliers without their own satellite imagery were not compared, because #508 requires satellite imagery.

## The search box decision

Leave the place-name search box out of the first version.

The reasons:

- Every typed search is sent to the supplier.
- It adds a second billed service.
- With Google, it brings the 30-day storage limit onto the stored point.
- Place-name search quality for rural Kurdistan was not tested for any supplier. This is not verified, so the value of a search box is unproven.

Without it, the owner can still pan and zoom the satellite map and type the numbers. A search box can be added later behind the same boundary.

## Owner decision

Two questions are open:

1. Which supplier is used.
2. Whether a place-name search box is included.

Both answers are recorded on issue 624. The architecture decision record for the chosen supplier is written by #508.

## Verification and limits

Official pages were read on 7 October 2026 through an automated reader that summarises long pages. Quoted figures should be rechecked on the supplier's own page before any contract.

The following were not verified or were only partly checked:

- Pages that would not load in full: Google's main terms and Service Specific Terms, and Esri's master agreement.
- Two facts were taken from search result summaries: Google's prohibited territories list and Esri's commercial deployment licence.
- Satellite pictures were compared by eye at three points only. They were not measured, and imagery dates were not established.
- Mapbox imagery was not checked. MapTiler open-country imagery was not checked.
- Kurdish support at MapTiler was not confirmed.
- Place-name search quality was not tested for any supplier.
- What Google and Esri learn from each request was not verified in detail.
- Whether an Iraq-based payer can open a billing account was not checked for any supplier.
- No account was opened, no key was created and no live request was made with a key.
