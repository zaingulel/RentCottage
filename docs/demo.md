# Local Minimum Viable Product (MVP) demonstration

This guide prepares a fresh, isolated synthetic demo and records one continuous 1920 x 1080 WebM of the
English Platform Administrator, Cottage Owner and Customer journey through a paid Confirmed Booking.
All cottages, identities, verification evidence and private details are fictional. Payment and supplier
responses are simulated; Booking Terms are fictional and non-operative. This is local demonstration evidence,
not approval to activate suppliers, publish a hosted preview or launch the marketplace.

## Fresh operator setup

Use the selected checkout with dependencies installed by `npm ci`, Docker running, Python 3, Bash and the
existing Playwright Chromium installation. The locked Supabase command-line interface (CLI) is `node_modules/.bin/supabase`,
version 2.114.0. Its installed executable uses Bun internally; invoke the supplied command directly.
Do not upgrade the CLI or use a globally installed replacement.

Run the following commands from the checkout in one dedicated interactive Bash subshell. Keep that shell open
through recording, rehearsal and teardown. Every demo export belongs inside it; do ordinary verification only
from its clean parent shell. Stop at any failed command or ownership check. Preserve failed evidence for review;
never reset a database, kill an unknown listener or allocate a replacement port. The fail-fast `set -eu` below
can exit this shell after a failed command. Do not continue preparation in another shell; use the recovery
procedure under [Evidence and teardown](#evidence-and-teardown) only for diagnosis and teardown.

```sh
bash --noprofile --norc
```

Check that this shell inherited no demo or verification overrides before creating anything. A conflict means
return to a clean parent environment, rather than hiding the stale setting with a new value.

```sh
set -eu
python3 - <<'PY'
import os
names = [name for name in os.environ if name.startswith(('SUPABASE_', 'PLAYWRIGHT_', 'WRANGLER_'))]
names += [name for name in ('APP_ENVIRONMENT', 'NEXTJS_ENV', 'PRIVILEGED_AUDIT_HMAC_KEY') if name in os.environ]
if names:
    raise SystemExit('Stop: inherited environment overrides: ' + ', '.join(sorted(names)))
PY
umask 077
export SUPABASE_TELEMETRY_DISABLED=1
export DO_NOT_TRACK=1
test "$(node_modules/.bin/supabase --version)" = '2.114.0'
export SUPABASE_LOCAL_WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/rentcottage-demo-XXXXXX")"
export SUPABASE_LOCAL_WORKDIR="$(cd "$SUPABASE_LOCAL_WORKDIR" && pwd -P)"
export SUPABASE_LOCAL_PROJECT="$(basename "$SUPABASE_LOCAL_WORKDIR")"
printf '%s\n' "$SUPABASE_LOCAL_WORKDIR" "$SUPABASE_LOCAL_PROJECT" > "$SUPABASE_LOCAL_WORKDIR/creation.txt"
git rev-parse HEAD > "$SUPABASE_LOCAL_WORKDIR/checkout.txt"
printf 'Owned workdir: %s\nOwned project: %s\n' "$SUPABASE_LOCAL_WORKDIR" "$SUPABASE_LOCAL_PROJECT"
```

Record those creation results with the session evidence. The basename must match
`rentcottage-demo-` followed by letters or numbers. Each fresh recording gets a new project. Preserve all
unowned workdirs, projects, volumes, Worker bindings and listeners.

Copy the current declared schemas and migrations and change only the copied configuration. This one-shot
file operation refuses a changed source contract and never edits `supabase/config.toml` in the checkout.

```sh
python3 - <<'PY'
import os, re, shutil
from pathlib import Path
workdir = Path(os.environ['SUPABASE_LOCAL_WORKDIR'])
project = os.environ['SUPABASE_LOCAL_PROJECT']
assert workdir.is_absolute() and workdir.name == project
assert re.fullmatch(r'rentcottage-demo-[A-Za-z0-9]+', project)
target = workdir / 'supabase'
target.mkdir()
for folder in ('migrations', 'schemas'):
    shutil.copytree(Path('supabase') / folder, target / folder)
config = Path('supabase/config.toml').read_text()
changes = {
    'project_id = "rentcottage"': f'project_id = "{project}"',
    'port = 54331': 'port = 56331',
    'port = 54332': 'port = 56332',
    'port = 54333': 'port = 56333',
    'port = 54334': 'port = 56334',
    'port = 54337': 'port = 56337',
    'port = 54339': 'port = 56339',
    'shadow_port = 54330': 'shadow_port = 16330',
    'inspector_port = 8083': 'inspector_port = 8283',
}
for before, after in changes.items():
    assert config.count(before) == 1, f'Stop: source configuration mismatch for {before}'
    config = config.replace(before, after)
config, count = re.subn(r'(\[db.seed\]\n.*?\nenabled = )true', r'\1false', config, flags=re.S)
assert count == 1, 'Stop: seed configuration mismatch'
with (target / 'config.toml').open('x') as output:
    output.write(config)
PY
```

The application programming interface (API), database, Studio, mail, analytics and pooler ports are 56331, 56332, 56333, 56334, 56337 and
56339. The shadow database uses 16330 and edge inspector 8283. The Worker uses 8792 with inspector 9232.
Check every port immediately before Supabase startup. Also inspect Docker's published ports because Docker
can reserve a port without an ordinary userspace listener. Any conflict stops this run.

```sh
docker ps --format '{{.Names}}\t{{.Ports}}'
python3 - <<'PY'
import socket
ports = (56331, 56332, 56333, 56334, 56337, 56339, 16330, 8283, 8792, 9232)
for port in ports:
    for family, host in ((socket.AF_INET, '0.0.0.0'), (socket.AF_INET6, '::')):
        with socket.socket(family, socket.SOCK_STREAM) as listener:
            if family == socket.AF_INET6:
                listener.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
            try:
                listener.bind((host, port))
            except OSError:
                raise SystemExit(f'Stop: port {port} is unavailable')
print('Demo ports are free; require no conflicting Docker published port above.')
PY
node scripts/run-log.mjs demo start -- node_modules/.bin/supabase start --workdir "$SUPABASE_LOCAL_WORKDIR" > "$SUPABASE_LOCAL_WORKDIR/start-private.log" 2>&1
node scripts/run-log.mjs demo migrations -- node_modules/.bin/supabase migration up --local --workdir "$SUPABASE_LOCAL_WORKDIR" > "$SUPABASE_LOCAL_WORKDIR/migrations-private.log" 2>&1
node scripts/run-log.mjs demo migration history -- sh -c 'node_modules/.bin/supabase migration list --local --workdir "$SUPABASE_LOCAL_WORKDIR" --output-format json > "$SUPABASE_LOCAL_WORKDIR/migration-history.json"'
```

Native startup uses the copied configuration with no service exclusion list. Seeds are disabled; the existing
fixture command owns all synthetic data. Compare every selected migration, not merely the newest timestamp.
Under `--local`, the history's `local` and `remote` entries describe files and the selected local database.
No missing, extra or mismatched migration is acceptable.

```sh
python3 - <<'PY'
import json, os
from pathlib import Path
workdir = Path(os.environ['SUPABASE_LOCAL_WORKDIR'])
expected = sorted(path.name.split('_', 1)[0] for path in Path('supabase/migrations').glob('*.sql'))
rows = json.loads((workdir / 'migration-history.json').read_text())['migrations']
assert expected and sorted(row['local'] for row in rows) == expected
assert all(row['local'] == row['remote'] for row in rows), 'Stop: unapplied migration'
print(f'All {len(expected)} selected migrations are applied.')
PY
node_modules/.bin/supabase status --workdir "$SUPABASE_LOCAL_WORKDIR" --output json > "$SUPABASE_LOCAL_WORKDIR/status-private.json"
```

## Verify ownership before privileged preparation

Do not print the status file, keys or private startup logs. Before fixture or Administrator preparation,
require the exact API origin and Docker labels connecting that endpoint to the workdir just created. A
`test` or `local-test` health label alone does not prove ownership.

```sh
python3 - <<'PY'
import json, os, subprocess
from pathlib import Path
workdir = Path(os.environ['SUPABASE_LOCAL_WORKDIR'])
project = os.environ['SUPABASE_LOCAL_PROJECT']
status = json.loads((workdir / 'status-private.json').read_text())
assert status['API_URL'] == 'http://127.0.0.1:56331', 'Stop: foreign API origin'
assert all(isinstance(status.get(key), str) and status[key] for key in ('PUBLISHABLE_KEY', 'SECRET_KEY'))
ids = subprocess.check_output(['docker', 'ps', '-aq', '--filter', f'label=com.supabase.cli.project={project}'], text=True).split()
assert len(ids) == 12, 'Stop: unexpected native container set'
containers = json.loads(subprocess.check_output(['docker', 'inspect', *ids], text=True))
metadata = []
for container in containers:
    labels = container['Config']['Labels']
    assert labels['com.supabase.cli.project'] == project
    assert labels['com.supabase.cli.workdir'] == str(workdir)
    assert container['State']['Running']
    metadata.append({'id': container['Id'], 'name': container['Name'], 'labels': labels, 'ports': container['NetworkSettings']['Ports']})
api = [item for item in metadata if any(binding['HostPort'] == '56331' for binding in item['ports'].get('8000/tcp') or [])]
db = [item for item in metadata if any(binding['HostPort'] == '56332' for binding in item['ports'].get('5432/tcp') or [])]
assert len(api) == len(db) == 1, 'Stop: endpoint binding mismatch'
with (workdir / 'container-ownership.json').open('x') as output:
    json.dump(metadata, output, indent=2)
print('Exact owned workdir, project, API and database bindings verified.')
PY
```

Map status privately to the existing environment and create `.dev.vars.test` exclusively, with mode 0600.
An existing file or symlink stops preparation; never overwrite it. This shell fragment contains secrets and
stays private in the owned workdir. No key is passed in a command argument or receipt label.

```sh
python3 - <<'PY'
import json, os, secrets, shlex
from pathlib import Path
workdir = Path(os.environ['SUPABASE_LOCAL_WORKDIR'])
status = json.loads((workdir / 'status-private.json').read_text())
values = {
    'APP_ENVIRONMENT': 'test',
    'SUPABASE_PROJECT_REF': 'local-test',
    'SUPABASE_URL': status['API_URL'],
    'SUPABASE_PUBLISHABLE_KEY': status['PUBLISHABLE_KEY'],
    'SUPABASE_SECRET_KEY': status['SECRET_KEY'],
    'PRIVILEGED_AUDIT_HMAC_KEY': secrets.token_hex(32),
}
assert values['SUPABASE_URL'] == 'http://127.0.0.1:56331'
with Path('.dev.vars.test').open('x') as output:
    for key, value in values.items():
        output.write(f'{key}={json.dumps(value)}\n')
with (workdir / 'demo-environment.sh').open('x') as output:
    for key, value in values.items():
        output.write(f'export {key}={shlex.quote(value)}\n')
assert Path('.dev.vars.test').stat().st_mode & 0o777 == 0o600
(workdir / 'binding-ownership.txt').write_text(str(Path('.dev.vars.test').resolve()) + '\n')
PY
. "$SUPABASE_LOCAL_WORKDIR/demo-environment.sh"
node --input-type=module - <<'JS'
const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/health`, {
  headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY },
});
if (!response.ok) throw new Error('Stop: owned local Auth health failed');
console.log('Owned local Auth health passed.');
JS
node scripts/run-log.mjs demo create -- node scripts/prepare-access-test.mjs create demo
node scripts/run-log.mjs demo validate -- node scripts/prepare-access-test.mjs validate demo
node scripts/run-log.mjs demo worker build -- npm run build:worker
```

`create demo` uses real production approval and publication transitions for the six cottages below.
`validate demo` is read-only and requires the complete publications, localizations, pricing and approval
records. Neither command repairs an existing partial fixture. Failure requires inspection and a fresh owned
project for another attempt, not deletion or a database reset.

## Start the Worker and record

Stay in the dedicated shell. Keep Wrangler logs and registry inside the owned workdir, and check the Worker
ports again immediately before preview. Docker published ports must also remain free at 8792 and 9232.

```sh
export WRANGLER_LOG_PATH="$SUPABASE_LOCAL_WORKDIR/wrangler-logs"
export WRANGLER_REGISTRY_PATH="$SUPABASE_LOCAL_WORKDIR/wrangler-registry"
export PLAYWRIGHT_SERVER=worker
export PLAYWRIGHT_WORKER_PORT=8792
docker ps --format '{{.Names}}\t{{.Ports}}'
python3 - <<'PY'
import socket
for port in (8792, 9232):
    for family, host in ((socket.AF_INET, '0.0.0.0'), (socket.AF_INET6, '::')):
        with socket.socket(family, socket.SOCK_STREAM) as listener:
            if family == socket.AF_INET6:
                listener.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
            listener.bind((host, port))
print('Worker ports are free; require no conflicting Docker published port above.')
PY
node scripts/run-log.mjs demo worker serve -- npm run preview -- --env test --test-scheduled --ip 127.0.0.1 --port 8792 --inspector-port 9232 > "$SUPABASE_LOCAL_WORKDIR/worker-private.log" 2>&1 &
jobs -l
```

This is the only background job created in this shell. Record its job identity and command. Wait for the native
preview's readiness message in the private log, then check health once. An unavailable or mismatched response
stops the run; do not add a retry loop or reuse another server.

```sh
node --input-type=module - <<'JS'
const response = await fetch('http://127.0.0.1:8792/api/health?check=supabase');
if (!response.ok) throw new Error('Stop: Worker health failed');
const health = await response.json();
if (health.ok !== true || health.environment !== 'test' || health.supabase?.projectRef !== 'local-test' || health.supabase?.connected !== true)
  throw new Error('Stop: Worker test/Supabase boundary mismatch');
console.log('Owned Worker test/local-test/Supabase health passed.');
JS
node scripts/run-log.mjs demo selection -- npx playwright test --config playwright.demo.config.ts --list --retries=0
```

Require exactly two selected tests in this order, on the `desktop` project:

1. `shows varied demo results and filters across desktop and mobile languages`
2. `records the continuous local RentCottage MVP story`

Then run the complete selection once. The result-layout prerequisite precedes the recording, one worker and zero
retries are configured, and the first failure stops later work. Any focused diagnosis or rerun must happen before
this final complete run and carry `RUN_LOG_RERUN_REASON` under the existing receipt rules. A recording consumes its
Service Day, so repeat recording requires another fresh project.

```sh
node scripts/run-log.mjs demo complete -- npx playwright test --config playwright.demo.config.ts --retries=0
```

Success requires two passes, zero failures and zero skipped tests. The walkthrough prints the recording,
rehearsal and meeting Service Days. Dates use the authoritative Baghdad clock at preparation: offset 30 is the
showcase, 31 recording, 32 rehearsal and 33 meeting. Do not substitute a workstation-local date.

Only successful story completion publishes `test-results/demo/rentcottage-mvp-walkthrough.webm`. Playwright
clears its default output directory at startup; run no later Playwright command after the final complete run.
Review the entire canonical video before sharing, including its exact ending, readable chapters, English
journey, synthetic/simulator disclosure, masked credentials and absence of premature private information.
Preserve the recording and representative results screenshots with the evidence needed for review.

## Fictional cottages and availability

Shared names and approximate locations are English in every locale. Descriptions and House Rules have synthetic
English, Arabic and Sorani localizations; these fixtures do not certify translation-supplier or human quality.
House Rules require respect for neighbours, no indoor smoking and staying within capacity.
Prices are Iraqi dinars (IQD), with separate Morning, Evening and Full day options.

| Cottage | Governorate / approximate area | Guests; bedrooms/bathrooms | Amenities | Morning / Evening / Full day IQD | Bundled cover |
|---|---|---|---|---|---|
| Palm Garden | Erbil / Shaqlawa | 8; 3/2 | garden, parking, pool | 180000 / 190000 / 250000 | cottage-pool.png |
| Zab Riverside | Erbil / Koya | 6; 2/1 | garden, parking, outdoor_seating | 140000 / 150000 / 220000 | cottage-river.png |
| Dukan Hills | Sulaymaniyah / Dukan | 12; 4/3 | garden, pool, wifi | 240000 / 260000 / 360000 | cottage-hills.png |
| Orchard Retreat | Duhok / Amedi | 4; 2/1 | garden, parking, wifi | 100000 / 120000 / 180000 | cottage-orchard.png |
| Tigris Courtyard | Baghdad / Al-Tarmiyah | 10; 3/2 | pool, parking, air_conditioning | 210000 / 230000 / 320000 | cottage-garden.png |
| Date Palm Cottage | Babil / Hillah | 16; 5/3 | garden, pool, outdoor_seating | 300000 / 320000 / 450000 | cottage-dusk.png |

On the showcase day, Palm Garden, Zab Riverside and Dukan Hills are fully open. Orchard Retreat has Morning
open, Evening and Full day closed. Tigris Courtyard is entirely closed. Date Palm Cottage has Morning privately
blocked, Evening open and Full day closed. Public results show availability only, never private reasons.
Five cottages appear for the showcase search; Full day narrows them to Palm Garden, Zab Riverside and Dukan Hills.

All six start fully open on the recording, rehearsal and meeting days. Owner calendar and anonymous availability
readers verify every cottage across all four days before the browser journey. Separate results evidence checks
English, Arabic and Sorani on desktop and mobile, covers, filters, keyboard access and overflow. On the recording
day, Erbil matches Palm Garden/Zab Riverside, Shaqlawa matches Palm Garden, ten guests match Dukan Hills/Tigris
Courtyard/Date Palm Cottage, and pool matches Palm Garden/Dukan Hills/Tigris Courtyard/Date Palm Cottage.

The English video displays only Palm Garden's Owner calendar, first open and then Morning reserved by the paid
Confirmed Booking. It does not display the other cottages' private calendar reasons or sign in their owners.
Its Confirmed Booking is produced by Customer request, Owner acceptance and simulated Worker capture, not seeded.

## Click-by-click presenter script

Give the driver only the printed reserved meeting Service Day. Use separate Customer and Cottage Owner browser
profiles or private windows; browser tabs in one profile share a session. The manual Customer is
`+9647520000001` and Palm Garden's Cottage Owner is `+9647540000001`. Both use synthetic verification code
`123456`, entered off-camera. Never use real personal data.

The dedicated Administrator credential is created with mode 0600 in
`$SUPABASE_LOCAL_WORKDIR/.env.demo-administrator.local.json`. Read its email and password privately and add its
Time-based One-Time Password (TOTP) secret to an authenticator off-camera. Keep passwords, verification codes,
authenticator secrets and private Owner evidence out of shared screens. The recorded story masks or conceals them.

The script mirrors the English recording. Use the meeting day for live clicks and the untouched rehearsal day
for practice. A live booking consumes that selected day; do not replay it as an unused example.

| Step | Presenter says | Driver clicks or checks |
|---|---|---|
| 1 | “RentCottage offers English, Arabic and Sorani Kurdish. We will follow the journey in English.” | Open `http://127.0.0.1:8792/`, show the three existing language choices, click `English` and stay in English. Show the unified header and footer. |
| 2 | “Platform Administrators have a separate multi-factor access boundary.” | Open `/en/administrator/access`. The operator signs in with the dedicated synthetic email, masked password and hidden authenticator code. Show access readiness and the application/profile management links. Do not enrol another factor. |
| 3 | “Cottage Owners manage their published cottage and future availability.” | In the Owner profile open `/en/owner/access`, verify Palm Garden's phone off-camera, open its Cottage Profile, show `Published`, shift prices and `Pricing and availability`. Load the meeting day and show Morning open. |
| 4 | “Customers begin with Service Days and guests.” | In the Customer profile open `/en`, fill both `From Service Day` and `To Service Day` with the meeting day, leave guests at 4, and click `Search available cottages`. Compare all six names, locations and individual option prices. |
| 5 | “The pool filter narrows the comparison.” | Return to the search form, preserve the same day and guests, check `Pool`, and search. Show Palm Garden, Dukan Hills, Tigris Courtyard and Date Palm Cottage. The separate showcase check covers partial and unavailable options; their private reasons are not shown here. |
| 6 | “Customers inspect a cottage before choosing a Booking Period.” | Open Palm Garden with `View cottage`. Show its gallery, facts, amenities and House Rules. In `Choose your Booking Period`, show that nothing is selected and `Get exact quote` is disabled. Select Morning, then click the enabled quote action. |
| 7 | “The exact quote makes the charges and terms explicit.” | Show IQD 180,000 Booking Price, IQD 5,000 Booking Service Fee and IQD 185,000 Customer Total, plus House Rules, cancellation policy and fictional non-operative terms. |
| 8 | “A verified Customer sends a request, which is not yet a confirmed booking.” | Verify the Customer phone off-camera, enter a fictional Customer name and optional synthetic Booking Note, accept all three acknowledgements and click `Send Booking Request`. Note the `RC-REQ-…` reference. |
| 9 | “Owner acceptance starts payment processing.” | In the Owner profile find that reference and click `Accept complete request`. Show `Payment confirmation pending`; in the Customer profile show the same pending status with address, directions, coordinates and Owner phone still absent. |
| 10 | “The local Worker performs simulated capture.” | The operator triggers the existing scheduled endpoint off-camera, then refreshes the participant views. Never change booking status in the database. |
| 11 | “Both participants now see the same paid Confirmed Booking.” | Match the reference, Morning period and Customer price/fee/total. Show the Owner's IQD 18,000 original commission and IQD 162,000 original owner share. Synthetic address, directions, coordinates and participant phones become available only after confirmation. |
| 12 | “The booking stays accessible in each participant's history.” | Open `My bookings` and `Bookings for my cottages`, and follow the same booking back to its paid details. |
| 13 | “The paid participants have a private conversation linked to the booking.” | Open the conversation from both profiles and exchange one short synthetic message each. Do not enter real contact data. |
| 14 | “Palm Garden's Morning is now reserved by the confirmed booking.” | Reload its Owner availability for the meeting day and show `Confirmed booking`. Explain that the other cottages' varied showcase states were verified separately, outside the recording. |

Run the scheduled action from the dedicated demo shell only, off-camera, when a live request is payment-pending:

```sh
curl --fail --silent --show-error 'http://127.0.0.1:8792/__scheduled?cron=%2A%20%2A%20%2A%20%2A%20%2A'
```

For a shorter presentation, show language choice and comparison, then use the reviewed recording. Never improvise
credentials, an unreserved Service Day, payment status or database edits on stage.

## Built so far

These are built application capabilities. “Recorded” describes the English main path, not every failure path or
real supplier operation. Separate multilingual results checks establish layout evidence, not certification of
all translated journeys or readiness for release.

| Area | Built behaviour | Demonstration coverage |
|---|---|---|
| Marketplace shell | Responsive landing page, unified header/footer, English/Arabic/Sorani routes and right-to-left layouts | Language choice then English recorded; results checked separately in all three languages on desktop/mobile |
| Account access | Customer/Owner phone verification and separate Administrator email/password plus Multi-Factor Authentication (MFA) | Recorded with secret/code concealment |
| Owner onboarding and moderation | Private application, evidence review, approval, publication and visibility controls | Prepared through real transitions; Administrator access and published outcome recorded, not full onboarding |
| Cottage operations | Profile editing, recurring shifts, pricing and future availability | Palm Garden prices and open-to-confirmed calendar recorded; six-cottage/four-day reader checks separate |
| Discovery | Dates and guests first; optional governorate, area, amenities and per-day Booking Period filters; preserved localized query | Six-cottage comparison and pool filter recorded; other fixed subsets checked separately |
| Results and Cottage Profile | One article per cottage with dated option prices/availability; gallery, facts, amenities, rules and deliberate period choice | Recorded; public availability omits private reasons |
| Quote and request | Itemised exact quote, policies/terms, phone verification, full-payment authorization, pending hold, reference and Owner decision | Recorded with simulated payment and fictional terms |
| Confirmation and payment | Owner acceptance, pending state, Worker-orchestrated capture and paid participant details | Recorded using simulated local capture; no live provider claim |
| Booking management | Customer/Owner history, preserved financial facts, lifecycle outcomes, cancellation/refund controls and Owner earnings views | Paid history recorded; other management outcomes available but unshown |
| Private messaging | Enquiry and paid conversations, fictional local-test translations, pre-payment contact protection and moderation/reporting | Paid conversation recorded; enquiry/moderation paths unshown |
| Administration and finance | Customer/Owner/Cottage status controls, payment history, refunds, disputes, payout holds, settlements and audited actions | Available but unshown beyond Administrator access |

## Still left

The issue tracker remains authoritative. These open demo-relevant items are a subset of the full board.

| Issue | Remaining outcome | Presenter handling |
|---|---|---|
| #268 | Customer discovery, quote and request presentation, including localized submitted-search summary and explanations of why each cottage matches | Explain the gap at Results; current heading is not a complete search summary |
| #269 | Owner setup and booking-management presentation refinements | Describe current screens as the shipped baseline |
| #220 | Readable Booking Period summaries across languages and screen sizes | Use the one-day Morning example without implying longer summaries are finished |

## Evidence and teardown

Keep a current receipt of checkout commit, exact project/workdir creation, endpoint/container ownership,
migration history, command exits, both selected test results, printed Service Days, complete video review and
any separately observed live rehearsal. Never carry an earlier run's dates, booking reference or runtime status
forward. A failed or skipped observation is not a pass.

To stop this shell's exact Worker, inspect `jobs -l` and confirm its job and command are the preview started above,
then bring that job to the foreground and press Ctrl+C. A process ID (PID) retained from another session is
not current ownership evidence; never signal a stale PID alone or any foreign process. Native preview shutdown
can make the receipt wrapper exit 1 rather than 130; that interrupted serve receipt is not a passing check.
Tolerate the foreground interruption here, then require the stopped-port and ownership checks below before
teardown.

```sh
jobs -l
fg %+ || :
```

If the dedicated shell exited, open a clean dedicated Bash shell using the setup's shell command and inherited
environment check, in the same recorded checkout. Run only that shell command and environment check, never the
creation or preparation commands in that section. Recovery is for diagnosis and teardown only. Select this run's
exact workdir and project from its retained creation results; compare `creation.txt` and `checkout.txt` with
those results and the checkout's current commit. Verify the actual copied `supabase/config.toml` project and
workdir, and compare the recorded `container-ownership.json` IDs, names, labels and port bindings with current
Docker inspection. If failure preceded any needed evidence, stop and report exactly what is missing. Never
guess a project, borrow another run's evidence or source a nonexistent file.

Only after ownership is established, restore `SUPABASE_LOCAL_WORKDIR` and `SUPABASE_LOCAL_PROJECT` to those
recorded values. If this run created `demo-environment.sh`, verify it is a regular, non-symlink, mode-0600 file
in that owned workdir, then source it privately using the existing source command. Never display its secrets,
rerun the binding-creation block, overwrite bindings, resume preparation or repeat a booking. If binding
creation was incomplete, preserve the files and report the missing evidence rather than bypassing the
binding-equality check below.

`jobs` and `fg` cannot recover a job from the exited shell. For an orphan preview, use the native process
inspector to identify the current 8792 and 9232 listeners and trace their complete current preview ancestry.
Verify the chain's commands, checkout and owned `worker-private.log`, Wrangler log and registry identities
against this run's retained creation evidence. A stale PID, command-name match or occupied port alone proves
nothing. Send the interrupt signal (SIGINT) only to that currently verified owned preview chain, then recheck
both ports.
If any process ownership remains unresolved, preserve it and report the exact blocker. Continue teardown
only with the existing ownership and binding-equality checks and the exact-project Supabase stop below;
if no bindings were created, do not run the binding-removal block, and stop Supabase only after its recorded
project ownership is proven.

Verify both Worker ports are free before removing bindings. Recheck the recorded Docker container metadata and
labels against the creation record before stopping the owned project with the explicit workdir and basename.
The native stop preserves its volumes; do not use `--all` or `--no-backup`.

```sh
python3 - <<'PY'
import json, os, socket, subprocess
from pathlib import Path
workdir = Path(os.environ['SUPABASE_LOCAL_WORKDIR'])
assert (workdir / 'creation.txt').read_text().splitlines() == [str(workdir), os.environ['SUPABASE_LOCAL_PROJECT']]
for port in (8792, 9232):
    with socket.socket() as listener:
        listener.bind(('0.0.0.0', port))
owned = json.loads((workdir / 'container-ownership.json').read_text())
current = json.loads(subprocess.check_output(['docker', 'inspect', *[item['id'] for item in owned]], text=True))
for container in current:
    assert container['Config']['Labels']['com.supabase.cli.project'] == os.environ['SUPABASE_LOCAL_PROJECT']
    assert container['Config']['Labels']['com.supabase.cli.workdir'] == str(workdir)
binding = Path('.dev.vars.test')
assert not binding.is_symlink() and binding.stat().st_mode & 0o777 == 0o600
assert (workdir / 'binding-ownership.txt').read_text().strip() == str(binding.resolve())
expected = dict(line.split('=', 1) for line in binding.read_text().splitlines())
assert {key: json.loads(value) for key, value in expected.items()} == {
    key: os.environ[key] for key in ('APP_ENVIRONMENT', 'SUPABASE_PROJECT_REF', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'PRIVILEGED_AUDIT_HMAC_KEY')
}, 'Stop: bindings changed since creation'
binding.unlink()
print('Stopped Worker verified; removed only the unchanged job-owned bindings.')
PY
node scripts/run-log.mjs demo stop -- node_modules/.bin/supabase stop --project-id "$SUPABASE_LOCAL_PROJECT" --workdir "$SUPABASE_LOCAL_WORKDIR"
exit
```

`exit` returns to the clean parent shell; none of the demo exports survive. If preparing final job evidence,
stop and remove the owned runtime bindings before the coordinator's ordinary convergence check. Complete that
check in the clean parent environment, then follow this guide with a new project for the final complete demo
run so ordinary Playwright output cleanup cannot erase the final recording.

Keep owned workdirs, credentials, preserved volumes and failed evidence until review and any meeting are complete.
Later disposal follows the manual's creation, ownership and inactivity checks and
[closeout cleanup](../.agents/skills/closeout/SKILL.md). Preserve foreign resources, images and volumes. Uncertain
ownership or an occupied port is a blocker to report, never permission to repair another job's environment.
