# RentCottage operating manual

<!-- factory-shared:start -->

The always-loaded contract for every agent runtime: skills own the steps, hooks own what must never happen, git
owns all state. A rule a test or hook enforces is named here, not restated.

## Runtime notes

Claude Code reads this file through `CLAUDE.md`, which adds its own notes; Codex reads it directly and prompts
before a browser run (`.codex/rules/playwright.rules`). Skills are shared in `.agents/skills/`, and
`.claude/skills/` holds a byte-identical copy of each; the agent seats in `.claude/agents/` and `.codex/agents/`
carry the same charters. Twelve of those skills are verbatim copies of mattpocock/skills at commit
24fe0ef7737efae15c87225755e9f6f5965e4888, vendored with its licence in `.agents/upstream/mattpocock-skills/`;
they are never edited in place, an update replaces the vendored source and every copy of it whole, and Codex
invokes any skill as `$<name>`. The tracker and triage vocabulary those copies expect to have been provided is
[docs/ISSUE-TRACKER.md](docs/ISSUE-TRACKER.md). The root checkout is the integration checkout: it stays on `main`,
and nothing is edited, branched, or committed there; the git guard refuses the branching and committing half. Resume
fetches before intake, loads the fetched manual and `resume`/`closeout` instructions under the reuse rule below,
and uses closeout's safe procedure to advance the actual clean idle `main` checkout before board evidence or
decisions. A topic, dirty, active, divergent or uncertain checkout is preserved.
Each job gets one worktree and the session starts inside it, never a worktree inside another job worktree; the
`resume` skill says where it lives on each runtime.

**Instruction reuse.** Record the fetched target commit and required instruction paths. Reuse previously read
text only when its full content remains in active context and its exact read Git revision is known: both
`git rev-parse <read-revision>:<path>` and `git rev-parse <target>:<path>` must succeed and return identical blob
IDs. Otherwise read the required content from the recorded target with `git show <target>:<path>`. Missing
objects, failed commands, or failed or truncated content reads are unavailable evidence, never permission to
reuse. Autoloaded text without verified read provenance, summaries and dirty disk content establish no identity.
Retain provenance only in this session, with no cache or tracked state; apply the rule whenever the target
changes, including the post-selection fetch. Instruction identity does not waive verifier target, cleanliness
or ownership checks.

The session that talks to the owner coordinates: it plans the cards that need no architect, hands every edit to a
builder seat, settles reviews, and delivers; it never builds. Residual judgment that would make a handoff
unreliable is resolved in the plan or the slice is split smaller. In every session, job or not, discovery wider
than a couple of files goes to the `explorer` seat, so its conclusion reaches the main thread and its file dumps do
not. The costliest Claude model, Fable, is reached only through the `oracle` and `security-reviewer` seats, and the
costliest Codex model, Astra, only through the
`architect`, `oracle` and `security-reviewer` seats; the session and the builders run on the tier below. Every
subagent is one of the named seats above, dispatched by its seat name; a generic, default or unnamed role is never
dispatched.

A Codex session waiting on a helper calls `wait_agent` with `timeout_ms: 3600000`, the maximum: the call returns
the moment a helper finishes, so a shorter timeout only adds wake-ups, and the session never sleeps and checks in a
loop. A command that runs for minutes on Codex runs in one `exec` cell whose first line is
`// @exec: {"yield_time_ms": 3600000}`; inside it `tools.exec_command` yields after at most 30 seconds, so the cell
polls the returned `session_id` with `tools.write_stdin({ session_id, chars: "", yield_time_ms: 300000 })` until
`exit_code` is set and returns once, and if the cell yields early the session calls `wait` on its cell ID with the
same `yield_time_ms`. On Claude Code the same command runs through `Bash` with `run_in_background: true`, which
re-invokes the session when it exits.

## Codex model routing

For this project, `.codex/agents/*.toml` owns model and reasoning settings and supersedes machine-wide model
routing defaults. Read the selected role's settings and pass them explicitly when dispatching. Use `builder`
for bounded substantive implementation, `builder-max` from the outset when uncertainty or failure consequence
warrants deeper reasoning, and `builder-lite` only for mechanical edits with strong verification and no
remaining judgment. `explorer` locates code; interpretation belongs to the planning or review roles. The
`oracle` is the escalation seat and defaults to its configured effort; override to `max` only for a specifically
justified escalation, stating the unresolved reasoning problem in the dispatch. Every other seat, on either
runtime, is dispatched at its configured model and effort, never overridden. Keep task-specific routing choices
out of the tracker.

## Sources of truth

Planned work: the board card and its acceptance criteria (`node scripts/board.mjs`). Shipped work: `git log`
and passing checks, never a prose status claim. In-flight work: a branch and its draft pull request. Durable
constraints: this manual, the scoped rules, and the standards and record documents indexed in
[docs/README.md](docs/README.md). History: git. Explanation: [docs/AI-WORKFLOW.md](docs/AI-WORKFLOW.md) is the front
page of the workflow pages, whose routing table links one page per topic; every topic page carries a summary, a mental
model, how it works, where the rules live, failure modes and key files, and none of them owns a rule.

Start every owner-facing decision in plain language before any workflow vocabulary: what happened, what the owner
must decide, the options. The owner reads pull request descriptions and screenshots, not diffs; write for that
reader. `resume` starts or continues a session, `handoff` parks unfinished work, `closeout` follows a merge.

## Owner gates

1. **Work-pick** is the owner's pick of one row of the `resume` candidate table, which approves that card's
   outcome and acceptance criteria as written and starts the job; no criteria list is shown and no second yes is
   asked. Owner-directed surfaces are the Surfaces table's `owner-directed` row and need owner direction plus
   canon or domain validation; sign-off surfaces are its `sign-off` row and need explicit sign-off and a named
   anti-regression test.
2. **Push authorisation** is one yes to the filled pull request body and its screenshot, and any owner
   instruction to push is that yes. It covers the whole deliver sequence in the `resume` skill, push to
   auto-squash merge, with no fresh yes inside it. `closeout` follows the merge unasked.

A material change to the approved outcome, product meaning, or a trade-off goes back to the owner as a
plain-language decision before it is built; a parser, state machine, or framework the outcome did not name is
such a change. Anything short of that which the job surfaces and can sensibly finish in the same job, in the
same files under the same tests, rides along and is named in the pull request body; a follow-up card is filed,
without asking, only for work that genuinely cannot.

**Disposable job cleanup.** The session must remove verified disposable, inactive files and folders it created
for its own approved job, inside or outside the job worktree, without further approval and whether or not a
verifier reported them. This project rule overrides the general machine rule requiring deletion approval only
for this exception and the leftovers it covers below. Session creation evidence must establish the exact path and
ownership; a name pattern, memory, summary or previous session alone does not establish either. Disposable
excludes owner files, tracked deliverables, and evidence or plans still needed for unfinished work or handoff;
another job's artifacts are leftovers. Verify inactive use and follow
[closeout's cleanup steps](.agents/skills/closeout/SKILL.md); existing worktree, branch, server and container
safeguards remain.

The same rule covers leftovers. A leftover is a file, folder, worktree or branch the workflow made that a session
finds, in any session, job or not, and that the paragraph above does not settle: another job's or session's
artifact, or one of its own job's that it cannot prove it created. What makes something a leftover is where it
sits and what made it, never what its text mentions: a job worktree, a job or slice branch, or a file or folder in
a place the workflow writes job artifacts, which are a job worktree, a worklog folder and a session's scratch
folder. A runtime's memory, settings or configuration is never a leftover, wherever it sits and whichever card it
names. The session investigates each leftover to a conclusion before it reports it, and tells the owner the
outcome in every case. It reads the content, timestamps and owner and checks whether anything uses it; for a
worktree or branch it also reads the card's state and latest `Claim:`, the pull request's state, and whether any
work is unmerged. Work is unmerged when a commit is neither an ancestor of `origin/main` nor contained in the head
of a merged pull request, or when a change is uncommitted or untracked.

- Dead: the work it belongs to is merged or closed, nothing is unmerged, nothing uses it, and no open card or open
  pull request names it. The session deletes it without further approval and reports the exact path and the
  evidence in one line.
- Live: an open card with a recent claim, unmerged work, or in use. The session leaves it and reports what it is.
- Unsettled: the investigation cannot show it dead or live, cannot show the workflow made it, or cannot tie it to
  a card, pull request or branch. The session leaves it and asks the owner about that exact path, giving its
  findings and a recommendation.

"Not in use right now" alone is never proof that a leftover is dead, and neither is a name pattern, memory or
summary. An owner file or a tracked deliverable is never a leftover. A safeguard's refusal keeps the target and is
reported with the evidence, never forced. This grants no general deletion or publication authority; other
destructive actions keep exact-target approval.

An approval covers only the question it answered. After a context compaction, reread the owner's latest messages
before acting on one; an approval whose question is no longer in view is asked again. A memory, summary or earlier
session never grants approval.

## Compact instructions

Keep the approved plan's location, the card's acceptance criteria, the worklog path, the current slice and its
state, the evidence still owed, and each owner approval quoted word for word with the question it answered. Drop
discovery output: file listings, search results and file contents, which can be read again.

## Coding standards and the executed test bar

[docs/CODING-STANDARDS.md](docs/CODING-STANDARDS.md) owns how first-party code is written, and every seat that
plans, designs, builds or reviews code reads it before it starts; only the `explorer`, which locates code and judges
nothing, is exempt. [docs/TESTING-STRATEGY.md](docs/TESTING-STRATEGY.md) owns the evidence every claim needs, run
through `node scripts/run-log.mjs` so the pull request body quotes exit codes a script wrote.
[docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md) owns how the user interface is built: which values are tokens and
where they live, the tolerated literals, and the component patterns new work reuses.

## Review and visual verification

One fresh review of the final tree before the pull request opens, by the tier the `resume` skill defines under
"6. Verify and review". That section owns the tiers, what a setting-only seat change is, the cross-family route with
its substitution when the other family's seat cannot be reached, and when `security-reviewer` runs. The skill's
"8. Deliver" owns every Greptile rule: the pool it is metered from, the one tier that requests it, the allowance
lookup, how each thread is settled before the draft is marked ready, and the provider-unavailability exception.

Visual work is complete only after the changed interaction has been driven and a current screenshot displayed
inline in chat; push authorisation waits for that image. Drive visual work as the Conventions table's `visual
verification` row says. Use representative views to demonstrate the changed interaction and its relevant visual
risks, with at most ten screenshots total per pull request and fewer when sufficient. Reuse captures from required
verification; do not rerun tests solely to collect screenshots. Visual verification coverage does not require an
image for every screen, state, language or viewport.

## Publication and machinery

Push only with owner authorisation, through a draft pull request. A change the repository's
`scripts/gates/pre-push-main` admits whole is instead pushed, on the same authorisation, as a fast-forward of `main`
from the job worktree (`git push origin HEAD:main`), its commit carrying `Closes #<issue>`; no pull request opens and no
workflow runs. The gate alone decides what qualifies: documentation by its path and, where the gate judges changed
lines, a setting-only seat change. A repository without that gate has no direct route. The documentation sweep and its
day-after triage follow [docs/DOC-SWEEP.md](docs/DOC-SWEEP.md) and [docs/SWEEP-TRIAGE.md](docs/SWEEP-TRIAGE.md) when the
Conventions table marks them active. The weekly retro follows [docs/WEEKLY-RETRO.md](docs/WEEKLY-RETRO.md) in a
repository whose `docs/ISSUE-TRACKER.md` records it: it reads the week's merged pull requests, files at most five
proposal cards in Backlog for the owner to pick or close, and changes nothing else. New executable machinery in the
workflow itself, including test scripts, harnesses, runners, and test-only tools (product code and ordinary tests added
to existing suites are exempt), needs one of: a control failure a sentence here or in a skill could not prevent twice,
the same measurable friction across three independent jobs, a required new runtime or provider integration, or
externally imposed security or platform drift. The friction route admits machinery only after the card's What to build
names the friction and what doing less was tried first: fewer checks, deleted work, or a native feature. A store, cache,
capture, retry, route, tracked input or repeated run added to existing machinery meets the same bar as new machinery.
Prefer a native feature over custom code, a hook over a script, and a sentence over a hook. Rewriting, shrinking or
deleting existing code, tests or tooling is always allowed when it is the right change for speed or quality, planned and
reviewed like any other change, with the owner gates and exact-target approval for destructive actions unchanged; no
standard, strategy, skill or charter may forbid it. This rule is the one home for how machinery leaves: a job that
removes a friction another way deletes the machinery that friction admitted, and a card that rewrites a testing
strategy, a coding standard or this manual's workflow text lists the machinery it keeps and settles keep, shrink or
delete for each. The `resume` intake reports the tooling's size so growth is seen, never gated.

## Shared workflow adoption

The files `.agents/factory-manifest.json` lists are shared workflow bytes, and `AGENTS.md` shares only the text between
its `factory-shared` markers. The manifest's `canonical` repository authors each shared file under `src/` and keeps an
installed copy at its root in the same commit, fingerprinted with `node scripts/factory-sync.mjs --write`; a test in
its suite refuses a difference. Each repository in `adopters` holds a copy pinned at the commit its manifest records as
`syncedFrom`. An ordinary shared change opens no sync card: `resume` reports at intake, as information, whether this
repository lags the canonical copy. An urgent fix is authored in the canonical repository first and pulled by a sync
card on the owner's decision. A sync card runs `node scripts/factory-sync.mjs --from <canonical checkout>` from the
adopter's job worktree against a clean canonical checkout at its fetched `main`. That run copies everything on the
canonical `main`, so one sync job resolves every open sync card in the adopter whose change it carried. The same run
removes each file the adopter's committed manifest listed and the canonical no longer shares, when the adopter's copy is
committed and byte for byte the one last synced, and prints it; anything else at such a path stops the run before it
writes, naming the path. A card is covered when `git merge-base --is-ancestor` shows its canonical merge commit is an
ancestor of the canonical commit the run copied from, and its acceptance criteria hold in the adopter; the job's pull
request body lists each covered card with that evidence. After the merge, the job's own card closes as completed and
closeout closes each covered card as not planned, with a comment naming the card that did the sync and quoting its
evidence. A card whose change merged after the run, or whose evidence the job cannot show, stays open.

The supported profile is self-use, Claude Code plus Codex with cross-family review; nothing installs the workflow for
a customer. It needs a private repository, the two branch rulesets with the administrator bypass of the required check
that the direct documentation route depends on, the required `test` check, the board, `npm ci` for the hooks, and each
runtime having trusted the repository's hooks, since a hook file a runtime has not trusted does not run. Whoever can use
that bypass can put any commit on `main` when the local hook is skipped: the holders of that role and every write deploy
key, which GitHub admits by the same bypass, so the repository keeps the role to the owner and carries no write deploy
key.

A Claude Code session started in the root checkout keeps that checkout's git guard after it enters a job worktree, while
it reads the permission allow list from the worktree, so a change that widens the allow list is its own card, started
only once the guard change that bounds it is on `main` in the root checkout of the canonical repository and, through a
sync, of every adopter. A shared file edited without its manifest hash following fails the contract test; `--write`
refreshes the hashes, and only in the canonical repository. Shared files are real files, never symlinks, since a symlink
reaches a Windows checkout as plain text: a skill lives in `.agents/skills/` and is copied whole to `.claude/skills/`,
and each hook directory carries its own `.gitattributes` so hooks keep LF endings wherever line endings are converted;
the contract test fails on a symlink, a copy that differs from its source, or a missing rule. A git hook's run
permission is its committed file mode. An intentional adopter exception needs owner agreement and lives outside the
shared files.

<!-- factory-shared:end -->

## Product

RentCottage is a trilingual cottage marketplace. `src/` contains the Next.js application and product logic;
`supabase/` owns declared database objects, migrations and Row Level Security; `scripts/` contains product,
provider, deployment and verification tooling; `custom-worker.ts` and `wrangler.jsonc` define the Cloudflare
Worker boundary. [GLOSSARY.md](GLOSSARY.md) owns product meaning and canonical language.

## Hard constraints

- Authentication, authorization, payments, personal data, private owner-verification files, database migrations,
  Row Level Security, destructive data changes, and new user-facing behaviour with no settled design are
  plan-first surfaces. The plan names behaviour, evidence, migration and rollback before editing.
- PostgreSQL owns the atomic Integrity Core; TypeScript application services own orchestration. Do not move a
  concurrency, authorization, deadline, idempotency, fencing, history or receipt invariant into a page or route.
- Payment and notification work is fail-loud, idempotent and recovery-safe. Provider acceptance is not completed
  delivery; durable authoritative state and the reader contracts remain the proof.
- Customer, Cottage Owner and Platform Administrator paths receive minimum access. Private address, contact,
  payment, audit and verification data never leaks into public or pre-confirmation surfaces.
- Arabic and Sorani right-to-left presentation, English left-to-right presentation, accessibility, responsive
  behaviour and translation fallback are product contracts, not polish.
- Next.js behaviour follows the installed version's guide under `node_modules/next/dist/docs/`; Cloudflare Worker
  compatibility and the client-secret scan remain independent evidence classes.

## Architecture seams

Read [GLOSSARY.md](GLOSSARY.md), [docs/agents/domain.md](docs/agents/domain.md), and accepted architecture decisions
before changing a domain seam. Follow [ADR 0002](docs/adr/0002-database-integrity-application-orchestration.md)
for the database/application boundary. Change declared database objects under `supabase/schemas/`, generate and
inspect the migration, and land both together. Preserve the product preparation and cleanup rules in
[docs/TESTING-STRATEGY.md](docs/TESTING-STRATEGY.md).

## Grounding

[GLOSSARY.md](GLOSSARY.md) holds canonical product terms and [docs/agents/domain.md](docs/agents/domain.md) explains
their code boundaries. Accepted architecture decisions own technical boundaries. Ground a live provider or
platform integration in current official documentation before planning exact permissions, payloads and failure
semantics. Competitors are interface prior art only and never override RentCottage's agreed product meaning.

## Surfaces

| Surface | RentCottage |
|---|---|
| plan-first | Authentication, authorization, payments, personal data, private owner-verification files, database migrations, Row Level Security, provider/Worker trust, destructive data changes, new user-facing behaviour with no settled design |
| owner-directed | New product meaning and unsettled user-facing design: owner direction plus domain grounding |
| sign-off | Authentication, authorization and Row Level Security, payments, provider/Worker trust, any change that widens access to private or personal data, a change to code that deletes, erases or blanks private data or rewrites audit records (a person editing their own details is not one), and a migration that moves, rewrites or deletes existing data; each needs explicit sign-off and a named anti-regression test. Any other schema change, such as adding a column that holds no private or personal data and a read-only screen shows, takes the ordinary cross-family review |
| security review | Authentication, authorization, payment or personal-data access, credential custody, provider-webhook trust, Row Level Security, public/private data exposure, an injection boundary, or a shared-workflow sync that changes agent permissions, hook registrations or hook scripts; privacy: [docs/product/rentcottage-mvp-prd.md](docs/product/rentcottage-mvp-prd.md#6-privacy-safety-and-moderation) |

The standing security guarantees, in order of blast radius:

1. **Authorization and Row Level Security**: every customer, Cottage Owner and Platform Administrator path has the minimum access, with real PostgreSQL policy evidence where the boundary changes.
2. **Payment and provider trust**: signed events are authenticated before processing; money-changing commands are replay-safe and idempotent; authorization, capture, release, refund and payout facts remain authoritative through retries and partial failure.
3. **Personal data and credential custody**: service-role and payment secrets remain server-side; private verification files, exact addresses, contacts, audit records and payment detail do not cross a public or pre-confirmation boundary; logs contain no secrets or unnecessary personal data.
4. **Integrity and injection**: schema/migration changes preserve atomic constraints and concurrency guarantees; every HTTP, environment, database and provider input is validated before entering trusted code; rendered untrusted content cannot inject markup or script.
5. **Anti-regression evidence**: each widened security/privacy claim has a named mutation-proven observer at the real boundary; mocks do not substitute for database policy, concurrency, signature or Worker evidence.

Preview deployment under `.github/workflows/preview.yml` remains a separate owner-approved operation and is not
included in ordinary push-to-merge delivery authority.

## Conventions

| Convention | RentCottage |
|---|---|
| generated artifacts | None |
| visual verification | The applicable Next.js or Worker surface across desktop, mobile, right-to-left and accessibility states. |
| fixtures | [Fixtures, preparation and cleanup](docs/TESTING-STRATEGY.md#fixtures-preparation-and-cleanup) in the testing strategy. For product behaviour, the real fixtures the shared skills ask for are synthetic records created through the real production transitions in the disposable test database, as that section describes; a unit or workflow-tooling test builds its own disposable fixture at its seam, in memory or in a temporary directory or repository. There are no real-data fixtures, and the demo is not test data |
| documentation routines | Inactive: the documentation sweep and its day-after triage, [docs/DOC-SWEEP.md](docs/DOC-SWEEP.md) and [docs/SWEEP-TRIAGE.md](docs/SWEEP-TRIAGE.md), stay inactive until their external environment, hosted protection and schedule are separately authorised |

Codex prompts before a browser run under `.codex/rules/playwright.rules`, pinned by
`scripts/lib/codex-browser-policy.test.mjs`.

On Claude Code and Herdr a job worktree lives in the root checkout's gitignored `.claude/worktrees/`, created by `git
worktree add` or `herdr worktree create`; on Codex it is the Codex-managed worktree or a sibling worktree beside the
repository. The current adopters of the shared workflow are Flowgauge and RentCottage.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
