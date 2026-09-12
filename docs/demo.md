# Local MVP demonstration

This walkthrough runs only against the preserved local synthetic demo database. It records one continuous
1920 x 1080 WebM showing the Platform Administrator, Cottage Owner, and Customer journeys through a paid
Confirmed Booking. Payment is simulated, customer data is synthetic, and the Booking Terms are fictional and
non-operative.

## Dedicated demo resources

The demo owns these stable local resources:

- Supabase workdir: `/Users/zain/Developer/Codex/RentCottage/.demo`
- Supabase project: `rentcottage-demo`
- Worker preview: `http://127.0.0.1:8789`
- Worker bindings: ignored `.dev.vars.test`, restricted to the local user
- Administrator credential: `.demo/.env.demo-administrator.local.json`, created exclusively with mode `0600`

Do not point the demo at the repository's default local Supabase project. The normal verifier owns disposable
projects selected through its own `SUPABASE_LOCAL_PROJECT`; never set that verifier project to
`rentcottage-demo`. Do not run `supabase db reset` or `supabase stop --no-backup` against the demo because both
destroy its retained accounts, administrator Multi-Factor Authentication (MFA) enrollment, cottage, and Booking
History.

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

Start the dedicated project and apply only missing migrations through Supabase's supported local upgrade path:

```sh
SUPABASE_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 npx supabase start --workdir "$SUPABASE_LOCAL_WORKDIR"
SUPABASE_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 npx supabase migration up --local --workdir "$SUPABASE_LOCAL_WORKDIR"
```

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

The recorded story keeps every existing chapter: language switching, Administrator access, the published
Cottage Profile and inventory, Customer discovery and quote, and the Booking Request. It then shows the Owner
accepting the request, both participants seeing `Payment confirmation pending`, the real local Worker scheduled
handler processing simulated capture, and both participants viewing the same paid Confirmed Booking reference and
period with their synthetic contact and private access details. Verification and authenticator codes stay hidden
from the action overlay.

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
period. Confirm the Customer price is IQD 180,000 plus the IQD 5,000 service fee, and that the Owner view shows the
IQD 18,000 Marketplace Commission and IQD 162,000 net. Both participant views must show the synthetic address,
directions, coordinates, and Customer and Cottage Owner phone numbers only after confirmation.

Use the untouched meeting day for the sprint review. A later weekly run selects three newer unused days rather
than changing the recording, rehearsal, meeting, or Booking History already retained.

## Weekly evidence and handoff

Record these facts after the recording and normal-browser rehearsal succeed:

- demonstrated merged commit;
- recording command result and canonical video inspection result;
- printed recording, rehearsal, and meeting Service Days;
- normal-browser Customer and Owner confirmation result;
- retained Supabase project/workdir and Worker origin left available for the meeting.

The rehearsal completed on 10 September 2026 against merged application commit
`ef8904279186ad988a52986a562285944141c1c3`. The repaired automated walkthrough passed against the real local Worker
and reserved 19 October for its recording, 20 October for rehearsal, and 21 October for the meeting. The normal-browser
rehearsal used 11 October and request `RC-REQ-6121747CF9B64EAF`; its Customer and Owner views both reached the paid
Confirmed Booking with the expected period, prices, synthetic contacts, and private access details. The dedicated
`rentcottage-demo` Supabase project in `/Users/zain/Developer/Codex/RentCottage/.demo` and the Worker at
`http://127.0.0.1:8789` were retained for the meeting. Record the separate full-video inspection result before
sharing the canonical WebM.

Leave the dedicated Supabase project and Worker running when the meeting is next. If the Worker is stopped, restart
the same build on port 8789; do not allocate another port automatically.

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
