# Local MVP demonstration

This walkthrough runs only against the preserved local synthetic demo database. It records one continuous
1920 x 1080 WebM showing the Platform Administrator, Cottage Owner, and Customer journeys through a paid
Confirmed Booking. Payment is simulated, customer data is synthetic, and the Booking Terms are fictional and
non-operative. This file is the single source of truth for starting, presenting, recording, and recovering the
demo, and for the shareable summary of delivered and remaining work.

## Dedicated demo resources

The demo owns these stable local resources:

- Supabase workdir: `/Users/zain/Developer/Codex/RentCottage/.demo`
- Supabase project: `rentcottage-demo`
- Worker preview: `http://127.0.0.1:8789`
- Worker bindings: ignored `.dev.vars.test`, restricted to the local user
- Administrator credential:
  `/Users/zain/Developer/Codex/RentCottage/.demo/.env.demo-administrator.local.json`, created exclusively with
  mode `0600`

Do not point the demo at the repository's default local Supabase project. The normal verifier owns disposable
projects selected through its own `SUPABASE_LOCAL_PROJECT`; never set that verifier project to
`rentcottage-demo`. Do not run `supabase db reset` or `supabase stop --no-backup` against the demo because both
destroy its retained accounts, administrator Multi-Factor Authentication (MFA) enrollment, cottage, and Booking
History.

## Upgrade-proof retirement environments

The sole environment included in upgrade-proof retirement is the preserved Docker demo project:

| Environment | Identity | Retirement status |
|---|---|---|
| Local demo | `rentcottage-demo` at `/Users/zain/Developer/Codex/RentCottage/.demo` | Included; this retained database is the only laggable environment |

The isolated `rentcottage-verification` database and continuous integration are excluded because each run rebuilds
the full migration chain. The hosted preview project named by `SUPABASE_PROJECT_REF` is also excluded by the
[owner decision](https://github.com/zaingulel/RentCottage/issues/301#issuecomment-5711754084), which confirms no
other non-local database is on the migration chain. The preview workflow validates the configured secret and passes
the project reference to the Worker, but does not apply migrations. This list records the decision and does not
claim independently inspected hosted state. Update it before any new persistent database starts receiving
migrations. The [testing strategy's retirement rule](TESTING-STRATEGY.md) points here for the
authoritative inventory and weekly check.

## Refresh to completed merged work

Before the weekly rehearsal, update a clean checkout to the completed merged commit selected for the sprint
review. Record the exact commit:

```sh
git rev-parse HEAD
npm ci
```

Review the week's merged changes for anything that alters the visible journey, labels, synthetic fixture,
database schema, Worker payment processing, or private participant details. Update this walkthrough when the
meeting story changes; do not add failure-path chapters unless that week's completed work needs them.

Set the stable local identity in every terminal used for the demo:

```sh
export SUPABASE_LOCAL_WORKDIR=/Users/zain/Developer/Codex/RentCottage/.demo
export SUPABASE_LOCAL_PROJECT=rentcottage-demo
```

Do not shorten the workdir to `.demo`, `~`, or another relative path. The walkthrough rejects a non-absolute
workdir and derives the Administrator credential path from this exact identity.

The stable workdir keeps its own `supabase/config.toml`. On first setup, copy the repository configuration there
and change only its first `project_id` value from `rentcottage` to `rentcottage-demo`. On every weekly refresh,
copy the current migration and declared-schema files into that workdir while preserving its configuration and
administrator credential:

```sh
mkdir -p "$SUPABASE_LOCAL_WORKDIR/supabase/migrations" "$SUPABASE_LOCAL_WORKDIR/supabase/schemas"
cp -p supabase/migrations/* "$SUPABASE_LOCAL_WORKDIR/supabase/migrations/"
cp -p supabase/schemas/* "$SUPABASE_LOCAL_WORKDIR/supabase/schemas/"
```

Inspect the target paths before the first copy. Do not overwrite an existing
`$SUPABASE_LOCAL_WORKDIR/supabase/config.toml` or
`$SUPABASE_LOCAL_WORKDIR/.env.demo-administrator.local.json`.

Before starting or migrating the dedicated project, verify that its stable workdir still identifies the demo:

```sh
rg -n '^project_id' "$SUPABASE_LOCAL_WORKDIR/supabase/config.toml"
```

Require the identity check to show the stable demo value `rentcottage-demo`; a different value stops the run for
inspection. Then start the dedicated project and apply only missing migrations through Supabase's supported local
upgrade path:

```sh
SUPABASE_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 npx supabase start --workdir "$SUPABASE_LOCAL_WORKDIR"
SUPABASE_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 npx supabase migration up --local --workdir "$SUPABASE_LOCAL_WORKDIR"
```

After that upgrade, use the stable identity exports above to check the selected merged checkout's target migration
against the retained demo's applied history:

```sh
SUPABASE_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 npx supabase migration list --local --workdir "$SUPABASE_LOCAL_WORKDIR"
```

Match the target migration timestamp from the selected checkout's `supabase/migrations` filename to the history.
The `Local` column is the migration files; the `Remote` column is the selected local database under `--local`.
The target and every earlier selected-checkout migration must be present and applied with no missing rows; a later
maximum timestamp alone is insufficient. Retire the upgrade proof only after the identity check, upgrade, and list
succeed. Record the selected commit, demo identity, migration versions, and successful output in the retirement
change evidence. If history is missing, failed, or ambiguous,
keep the proof and investigate; never mark history applied or reset the retained demo to force the condition. See
the [Supabase migration list reference](https://supabase.com/docs/reference/cli/supabase-migration-list) for the
command's column semantics.

For a confirmed brand-new, empty database only, map its environment, create the synthetic desktop fixture once,
and validate it:

```sh
set -a
eval "$(SUPABASE_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 npx supabase status --workdir "$SUPABASE_LOCAL_WORKDIR" -o env)"
export APP_ENVIRONMENT=test
export SUPABASE_PROJECT_REF=local-test
export SUPABASE_URL="$API_URL"
export SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY"
export SUPABASE_SECRET_KEY="$SECRET_KEY"
set +a
node scripts/prepare-access-test.mjs create desktop
node scripts/prepare-access-test.mjs validate desktop
```

Skip `create desktop` for every reused database. The walkthrough validates the exact synthetic private address,
directions, coordinates, participant phone numbers, published cottage, shift schedule, and retained Owner request
history before recording. A mismatch stops the run for inspection; it never rewinds or recreates retained data.

## Build and run the payment-capable Worker

The owner-acceptance chapter needs the existing Cloudflare Worker scheduled handler to run the simulated Payment
Capture and confirmation flow. Keep service credentials in the ignored `.dev.vars.test`; never pass them as
`--var` command arguments.

Inspect an existing file before changing it:

```sh
stat -f '%Sp %N' .dev.vars.test
```

If the file does not exist, create it locally with the following keys populated from the dedicated Supabase
status above, then restrict it with `chmod 600 .dev.vars.test`:

```text
APP_ENVIRONMENT="test"
SUPABASE_PROJECT_REF="local-test"
SUPABASE_URL="<dedicated local API_URL>"
SUPABASE_PUBLISHABLE_KEY="<dedicated local PUBLISHABLE_KEY>"
SUPABASE_SECRET_KEY="<dedicated local SECRET_KEY>"
PRIVILEGED_AUDIT_HMAC_KEY="<local synthetic value of at least 32 characters>"
```

The angle-bracket values describe private local input and must not remain as literal bindings. Build once, then
leave the Worker preview running in its own terminal:

```sh
npm run build:worker
WRANGLER_LOG_PATH=/private/tmp/rentcottage-demo-wrangler-logs WRANGLER_REGISTRY_PATH=/private/tmp/rentcottage-demo-wrangler-registry npm run preview -- --env test --test-scheduled --ip 127.0.0.1 --port 8789
```

Confirm the Worker is connected to the local test boundary before using it:

```sh
curl --fail --silent --show-error 'http://127.0.0.1:8789/api/health?check=supabase'
```

## Record and rehearse

In another terminal, map the same dedicated Supabase environment, then use the Worker-only demo configuration:

```sh
set -a
eval "$(SUPABASE_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 npx supabase status --workdir "$SUPABASE_LOCAL_WORKDIR" -o env)"
export APP_ENVIRONMENT=test
export SUPABASE_PROJECT_REF=local-test
export SUPABASE_URL="$API_URL"
export SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY"
export SUPABASE_SECRET_KEY="$SECRET_KEY"
export PLAYWRIGHT_SERVER=worker
export PLAYWRIGHT_WORKER_PORT=8789
set +a
npx playwright test --config=playwright.demo.config.ts
```

The run prints three unused future Service Days and opens all three without changing existing availability or
history:

- `Recorded walkthrough Service Day` is consumed by the automated recording.
- `Reserved rehearsal Service Day` is for the normal-browser rehearsal.
- `Reserved meeting Service Day` remains untouched for the sprint review.

The recorded story keeps every existing chapter: the unified header and footer, language switching,
Administrator access, the published Cottage Profile and inventory, Customer discovery and quote, and the Booking
Request. It then shows the Owner accepting the request, both participants seeing `Payment confirmation pending`,
the real local Worker scheduled handler processing simulated capture, both participants viewing the same paid
Confirmed Booking reference and period, Booking History, and paid private messaging. Verification and
authenticator codes stay hidden from the action overlay.

The manual Customer uses `+9647520000001`, the Cottage Owner uses `+9647540000001`, and both use the local
synthetic phone verification code `123456`. Keep the verification code off-screen when recording manually.

On its first successful setup, the walkthrough creates a dedicated synthetic Platform Administrator and stores
its reusable email, password, and Time-based One-Time Password (TOTP) enrollment secret in
`$SUPABASE_LOCAL_WORKDIR/.env.demo-administrator.local.json`. The file stays restricted to the local user and must
never be committed, shared, or shown in a recording. For a manual Administrator demonstration, read the email and
password from that file off-camera, add its `secret` to an authenticator app off-camera, then use the
authenticator's current code on the visible login screen. The browser shows the password only as native dots. The
walkthrough never deletes or replaces this Administrator's MFA factor; if the account, factor, and file do not
match, it stops for inspection.

Only a fully successful Customer and Owner paid-booking journey is published to:

```text
test-results/demo/rentcottage-mvp-walkthrough.webm
```

The test records to a run-specific temporary WebM and moves it to the canonical path only after both participant
views pass. Playwright cleans `test-results` before the run, and a failed run removes its partial recording, so an
older canonical video cannot appear current. Watch the complete canonical file before sharing it to confirm
readable quality, continuous story flow, correct language direction, the synthetic-data and simulated-payment
disclosures, and the absence of credentials or private evidence before confirmation.

For the manual rehearsal, use a normal browser and the printed rehearsal day. Follow the same Customer request
and Owner acceptance journey. Enter `Live Demo Customer` as the Customer name and
`Weekly live rehearsal with synthetic data.` as the optional Booking Note so the preserved-history audit can
recognise the exact synthetic rehearsal record on future weeks.

Browser tabs in one profile share the same authentication session. Use separate browser profiles or private
windows for simultaneous Customer and Owner views when they are available. Otherwise, switch roles by revisiting
the appropriate access route and reverifying that participant's synthetic phone; the Customer status route can
appear unavailable while the Owner session is active.

Once the live Owner view shows `Payment confirmation pending`, trigger the existing Worker handler off-screen from
a terminal:

```sh
curl --fail --silent --show-error 'http://127.0.0.1:8789/__scheduled?cron=%2A%20%2A%20%2A%20%2A%20%2A'
```

Return to the browser and verify that the Customer reaches `Confirmed booking`, the Owner sees
`Booking confirmed` and can open the confirmed booking, and both views show the same booking reference and Morning
period. Confirm the Customer's original booking price is IQD 180,000 plus the IQD 5,000 service fee, and that the
Owner view shows the IQD 18,000 original commission and IQD 162,000 original owner share. Both participant views
must show the synthetic address, directions, coordinates, and Customer and Cottage Owner phone numbers only after
confirmation. Open `My bookings` and `Bookings for my cottages` to show that the paid booking is retained, then
open its conversation from both views to demonstrate participant-only messaging.

Use the untouched meeting day for the sprint review. A later weekly run selects three newer unused days rather
than changing the recording, rehearsal, meeting, or Booking History already retained.

## Click-by-click presenter script

Share this section with the person driving the demo. Before handing them control, start the environment, give them
only the printed `Reserved meeting Service Day`, and keep credentials and verification codes with the operator.
Use a Customer browser profile and a separate Cottage Owner profile so the sessions do not replace one another.

| Step | Presenter says | Driver clicks or checks |
|---|---|---|
| 1 | “RentCottage is a trilingual marketplace for countryside homes across Iraq.” | Open `http://127.0.0.1:8789/en`. Point out the branded unified header over the hero. Scroll to the footer, then return to the top. |
| 2 | “The same journey works in English, Arabic, and Sorani Kurdish.” | In the top header only, click `العربية`, then `کوردی`, then `English`. Confirm Arabic and Kurdish run right-to-left. Do not use the duplicate language links in the footer. |
| 3 | “Platform Administrators use a separate multi-factor access boundary.” | In an operator-only profile, open `/en/administrator/access`. The operator enters the dedicated synthetic email, masked password, and authenticator code off-screen, clicking `Continue` and then `Verify`. Point out `Administrator access is ready`, `Review submitted Owner Applications`, and `Manage Cottage Profiles`; do not reveal or reenrol the authenticator. |
| 4 | “Cottage Owners control a published profile, its shift prices, and each future Service Day.” | In the Cottage Owner profile, open `/en/owner/access` and verify the synthetic Owner phone off-screen. On `Your cottages`, click `Open Cottage Profile` for `Desktop Booking Fixture Cottage`. Point out `Published`, scroll to `Pricing and availability`, confirm the Shift 1 standard price is populated, enter the reserved meeting day, click `Load availability`, and confirm Shift 1 is open. |
| 5 | “Customers can set their Booking Period before choosing dates.” | In the signed-out Customer profile, return to `/en`. Under `Booking Period for each Service Day`, click the `Shift 1` toggle while the dates are empty. Confirm it appears selected. |
| 6 | “That default is applied separately to each Service Day.” | Enter the reserved meeting day into both `From Service Day` and `To Service Day`. In the new row labelled with the formatted weekday and date, confirm `Shift 1` remains selected. Leave `Guests` at 4. |
| 7 | “Results show available cottages, the total, and the exact Service Day period.” | Click `Search available cottages`. On `Available cottages`, point out the total, the dated `Morning` row and price, and the full-width `View cottage` action. Be explicit that a localized summary of the full search and a “why this matched” explanation are not built yet; that remains issue #268. |
| 8 | “The profile separates cottage facts from the selected booking.” | Click `View cottage`. Point out the capacity and bedroom/bathroom facts, gallery, amenities, and House Rules. In the right-hand booking sidebar, show the requested date, `Morning`, times, price, total, and the full-width actions. |
| 9 | “The quote preserves the selected Booking Period and makes the charges and terms explicit.” | Click `Get exact quote`. Show `Customer Total`, the itemised price and service fee, the preserved House Rules, cancellation policy, and fictional local-test terms. |
| 10 | “A verified Customer sends a request; it is not a confirmed booking yet.” | Enter the synthetic Customer phone. The operator enters the verification code off-screen. Fill `Customer name` with `Live Demo Customer`, fill the optional Booking Note with `Weekly live rehearsal with synthetic data.`, accept all three required acknowledgements, and click `Send Booking Request`. Record the `RC-REQ-…` reference. |
| 11 | “The Cottage Owner receives the complete request without private payment or contact leakage.” | In the Cottage Owner profile, return to `Your cottages`, find the article labelled with the request reference, and click `Accept complete request`. Show `Payment confirmation pending`. |
| 12 | “Acceptance starts payment processing; it does not fake a paid result in the page.” | In the Customer profile, open `/en/booking-requests/<RC-REQ-reference>` and show `Payment confirmation pending`. Confirm the exact address, directions, map pin, and Owner phone are still absent. |
| 13 | “For this local demo, the real Worker scheduled handler performs a simulated capture.” | The operator runs the scheduled `curl` command off-screen. Refresh the Customer page and show `Confirmed booking`. |
| 14 | “Both participants now see the same paid booking, with private details unlocked only after confirmation.” | Show the booking reference, Morning period, IQD 180,000 original price, IQD 5,000 service fee, IQD 185,000 Customer total, synthetic address, directions, map pin, and phones. In the Owner profile, open the same request and show IQD 18,000 original commission and IQD 162,000 original owner share. |
| 15 | “The booking remains accessible after the moment of confirmation.” | From the Customer detail click `My bookings`; from the Owner detail click `Bookings for my cottages`. In each history, open the matching booking reference and confirm it returns to the same paid detail. |
| 16 | “The paid Customer and Cottage Owner have a private conversation linked to the booking.” | Click `Open conversation` on the confirmed booking. Show `Contact details are allowed for this paid booking.` Send one short synthetic message as the Customer, then open the same conversation as the Cottage Owner and reply. Do not enter real contact or personal data. |
| 17 | “That is the current completed customer-to-owner journey; the next visible improvements remain tracked.” | Return to the RentCottage home page and leave the meeting-day booking in preserved history. |

If the presenter is short on time, use steps 1–9 and the prepared recording. Do not improvise credentials,
database edits, payment status changes, or an unreserved date on stage.

## Built so far

This is a plain-English summary of the relevant behaviour already on the current merged application. “Shown”
means the main path appears in the script above; it does not mean every failure path is presented.

| Area | Built behaviour | Shown in this demo |
|---|---|---|
| Marketplace shell | Responsive landing page, unified branded header and footer, and English, Arabic, and Sorani Kurdish routes with right-to-left layouts where appropriate | Yes |
| Account access | Phone verification for Customers and Cottage Owners, shared account navigation, and separate email/password plus MFA access for Platform Administrators | Yes |
| Cottage Owner onboarding and moderation | Private Owner Application, evidence review, administrative approval, Cottage Profile publication, and visibility controls | Administrator and published outcome only |
| Cottage operations | Cottage Profile editing, recurring shifts, prices, and future Service Day availability | Yes, published state and one day |
| Discovery | Date, guest, governorate, area, amenity, and per-Service-Day shift selection with preserved localized query state | Yes, one Service Day and Shift 1 |
| Results and Cottage Profile | Available-cottage cards with totals and dated shift rows; gallery, facts strip, amenities, House Rules, booking sidebar, and full-width actions | Yes |
| Quote and request | Exact itemised quote, required policies and terms, phone verification, full-payment authorization boundary, pending hold, request reference, and Owner decision | Yes |
| Confirmation and payment | Owner acceptance, payment-pending state, Worker-orchestrated simulated local capture, paid booking details, participant-only contact and access details, and fictional delivery status | Yes |
| Booking management | Customer and Cottage Owner Booking History, preserved financial facts, lifecycle outcomes, cancellation/refund controls, and Owner earnings views | Paid history only |
| Private messaging | Cottage enquiry and paid-booking conversations, automatic fictional local-test translations, contact protection before payment, and moderation/reporting controls | Paid conversation only |
| Administration and finance | Customer/Owner/Cottage search and status controls, payment history, refunds, disputes, payout holds, settlement visibility, and audit-backed administrative actions | No |

## Still left

The issue tracker remains authoritative. This table calls out known demo-relevant gaps; it is not a substitute for
the full board.

| Issue | Remaining outcome | Demo handling |
|---|---|---|
| #268 | Add the localized search summary, echo dates/guests/shifts, explain why each cottage matched, and complete the connected discovery presentation work | Disclose it at Results; do not imply the current heading is a full summary |
| #269 | Continue the owner-approved visual refinement beyond the unified shell and refreshed customer screens | Describe current styling as the shipped baseline, not final polish |
| #218 | Refine the landing hero headline and subtitle spacing | Do not promise the final hero typography |
| #220 | Improve Booking Period summary readability | Keep the one-day Shift 1 example simple |
| #282 | Preserve the return destination when switching language on an access page | Switch languages on the landing/profile flow, not midway through access |
| #283 | Remove confirmed orphan images and styles with exact deletion evidence | No presenter action; do not delete assets during demo preparation |

## Weekly evidence and handoff

Record these facts after the recording and normal-browser rehearsal succeed:

- demonstrated merged commit;
- recording command result and canonical video inspection result;
- printed recording, rehearsal, and meeting Service Days;
- normal-browser Customer and Owner confirmation, Booking History, and messaging result;
- retained Supabase project/workdir and Worker origin left available for the meeting.

| Evidence | Current weekly result |
|---|---|
| Demonstrated merged commit | Product baseline `36ee484e6bb2bd10d2fb1498d5997cd5b23ffc2b` (`origin/main`, including the refreshed unified customer experience) |
| Automated Worker walkthrough | Final repaired run passed 1/1 in 1.9 minutes against the Worker preview; recorded request `RC-REQ-AE3861F3E640491F` reached paid confirmation |
| Recorded, rehearsal, and meeting Service Days | Final recording: October 29, 2026; final-run reserved rehearsal day: October 30, 2026; reserved untouched meeting day: October 31, 2026 — all use Morning / Shift 1. The separate normal-browser rehearsal used October 27 before the post-review recording. |
| Canonical video inspection | `test-results/demo/rentcottage-mvp-walkthrough.webm`, 113.76 seconds. Complete playback reached the exact end; representative chapter frames were inspected across the run and showed a coherent flow. Credential and verification-code concealment also passed executable assertions; no credential or premature private detail was visible in the inspected frames. |
| Normal-browser Customer and Owner rehearsal | Passed in the visible in-app browser for request `RC-REQ-8A0653746C064F0C`; both participants reached the same confirmed Morning booking and saw the correct participant-specific financial and private details |
| Booking History and private messaging rehearsal | Passed; both histories reopened the preserved booking and both participants exchanged and saw one synthetic message each in the paid conversation |
| Meeting runtime readiness | Dedicated `rentcottage-demo` Supabase data preserved; forward-only migration reported no pending migration; Worker health was green at `http://127.0.0.1:8789/api/health?check=supabase`; the visible browser was reset signed out at `/en` |

Replace each `Not yet…` entry only with evidence observed in the current weekly preparation. Never carry a prior
week's commit, dates, request reference, or runtime status forward as if it were current.

Leave the dedicated Supabase project and Worker running when the meeting is next. If the Worker is stopped, restart
the same build on port 8789; do not allocate another port automatically.

## After a laptop shutdown

Yes, the preserved demo can be used after the laptop has been shut down. The browser and terminal processes will
stop, but the dedicated Supabase data remains in its local Docker volumes when stopped with the preservation
command below. After turning the laptop back on:

1. Start Docker Desktop and wait until it reports that Docker is running.
2. Open the exact checkout containing the commit recorded in the weekly evidence table.
3. Export the absolute `SUPABASE_LOCAL_WORKDIR` and `SUPABASE_LOCAL_PROJECT` values from this file.
4. Run the dedicated `supabase start --workdir …` and forward-only `supabase migration up --local --workdir …`
   commands above. Do not run fixture creation again.
5. Confirm `.dev.vars.test` still has mode `0600`, run `npm run build:worker`, then start the Worker preview on
   port 8789 with the command above.
6. Run the health check. Open `http://127.0.0.1:8789/en` and use the already recorded meeting Service Day.

Do not rerun the automated walkthrough on meeting morning unless a new recording is intentionally required: it
creates another preserved request and chooses a newer set of dates. A forced shutdown does not itself justify a
database reset or fixture recreation.

## Stop without deleting demo data

Press `Ctrl-C` in the Worker terminal. Preserve Supabase volumes and data with:

```sh
SUPABASE_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 npx supabase stop --project-id rentcottage-demo --workdir "$SUPABASE_LOCAL_WORKDIR"
```

## Targeted recovery

- If Docker is unavailable, start Docker Desktop and rerun the native command that failed.
- If a confirmed project or port conflict blocks startup, stop only the exact process or local project whose
  ownership you have confirmed. Do not kill an unknown process or allocate a different port automatically.
- If Chromium is missing, install it with `npx playwright install chromium`.
- If fixture or private-field validation fails, preserve the exact error and inspect the known synthetic fixture.
  Do not reset, rewind, or recreate a fixture in a reused database.
- If the dedicated demo administrator credential reports a mismatch, inspect that exact synthetic account, its
  factor, and `$SUPABASE_LOCAL_WORKDIR/.env.demo-administrator.local.json`. Do not delete or replace unrelated MFA
  factors.
- If payment remains pending, preserve the Worker and `curl` failure. Do not update booking status directly in the
  database or add a scheduler, retry loop, process controller, or fallback confirmation path.
- The currently pinned Wrangler preview can terminate with a `ProxyWorker` / `Network connection lost` chain. If
  that happens, preserve the exact failure and restart the same native preview once on port 8789. Treat another
  failure as unavailable rehearsal evidence until the separately owned runtime upgrade is merged; do not work
  around it with a restart loop or a different Worker runtime in this demo job.
