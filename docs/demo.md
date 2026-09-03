# Local MVP demonstration

This walkthrough runs only against the local test stack. It records a continuous 1920 x 1080 WebM showing the
synthetic Platform Administrator, Cottage Owner, and Customer journeys. Payment is simulated and the Booking
Terms are fictional and non-operative.

## Start the preserved demo environment

Install the locked dependencies and start Supabase from the repository root:

```sh
npm ci
SUPABASE_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 npx supabase start
SUPABASE_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 npx supabase migration up --local
```

`migration up --local` applies only migrations that are missing. Do not use `supabase db reset` or
`supabase stop --no-backup`: both are destructive and are not part of the demo path.

Map the native local status output to the application environment in every terminal used below:

```sh
set -a
eval "$(SUPABASE_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 npx supabase status -o env)"
export APP_ENVIRONMENT=test
export SUPABASE_PROJECT_REF=local-test
export SUPABASE_URL="$API_URL"
export SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY"
export SUPABASE_SECRET_KEY="$SECRET_KEY"
export PRIVILEGED_AUDIT_HMAC_KEY=local-demo-audit-hmac-key-2026-0123456789abcdef
set +a
```

For a brand-new, empty local database only, create and validate the synthetic desktop fixture once:

```sh
node scripts/prepare-access-test.mjs create desktop
node scripts/prepare-access-test.mjs validate desktop
```

For ordinary future reuse of the preserved demo database, skip those two fixture commands. The focused walkthrough
validates the exact required synthetic identities and cottage before recording. It selects two future Service Days
that have no existing availability or active commitment, opens only those days, uses one in the recording, and
leaves the other ready for a live demonstration. Existing requests and availability remain in place; a later run
selects new unused days rather than rewinding them.

Build and leave the application running in the first terminal:

```sh
npm run build
npm run start -- -p 3000
```

In a second terminal, map the same environment variables, then record the walkthrough:

```sh
npx playwright test tests/demo-walkthrough.spec.ts --project=desktop --workers=1
```

The command prints both the recorded Service Day and the reserved live-demo Service Day. For a later live Customer
demonstration, enter the printed reserved day in both marketplace date fields, select Shift 1, and continue through
the normal discovery and quote flow. Do not reuse the recorded day, because its accepted request is retained as
useful demonstration history.

On its first successful setup, the walkthrough creates a dedicated synthetic Platform Administrator and stores its
reusable email, password, and Time-based One-Time Password (TOTP) enrollment secret in the local ignored file
`.env.demo-administrator.local.json`. Its `.env*` name keeps it outside Playwright's cleaned output directory while
remaining ignored by Git. The file is restricted to the local user and must never be committed, shared, or shown in
a recording. For a later manual administrator demonstration, read the email and password from that file off-camera,
add its `secret` to an authenticator app off-camera, then use the authenticator's current code on the visible login
screen. The browser shows the password only as native dots. The walkthrough never deletes or replaces this
administrator's Multi-Factor Authentication (MFA) factor; if the account, factor, and file do not match, it stops
with an error for inspection.

Only a fully successful journey is published to the ignored canonical recording path:

```text
test-results/demo/rentcottage-mvp-walkthrough.webm
```

Each run records to a run-specific temporary WebM and moves it to the canonical path only after the final Customer
Accepted state succeeds. Playwright cleans `test-results` before the test begins, so an older canonical video cannot
remain and look current after a failed invocation. Partial files owned by a failed run are removed. These files are
local evidence, are ignored by Git, and must not be committed. Watch the complete canonical file before sharing it
to confirm readable quality, continuous story flow, correct language direction, the demo disclosures, and the
absence of private or secret material. Leave the application and Supabase running when the next presentation will
use the same environment live.

## Stop without deleting demo data

Press `Ctrl-C` in the application terminal. Then preserve Supabase volumes and data with:

```sh
SUPABASE_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 npx supabase stop --project-id rentcottage
```

## Targeted recovery

- If Docker is unavailable, start Docker Desktop and rerun the native command that failed.
- If a confirmed project or port conflict blocks startup, stop only the exact process or local project whose
  ownership you have confirmed. Do not kill an unknown process or allocate a different port automatically.
- If Chromium is missing, install it with `npx playwright install chromium`.
- If fixture validation fails, preserve the exact error and stop to inspect the known fixture. Do not reset,
  rewind, or recreate a fixture in a reused database. Run the one-time create and validate commands only for a
  confirmed brand-new, empty database.
- If the dedicated demo administrator credential reports a mismatch, stop and inspect that exact synthetic account,
  its factor, and `.env.demo-administrator.local.json`. Do not delete or replace unrelated MFA factors.
