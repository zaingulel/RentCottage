# RentCottage operating manual

<!-- factory-shared:start -->

The always-loaded contract for every agent runtime: skills own the steps, hooks own what must never happen, git
owns all state. A rule a test or hook enforces is named here, not restated.

## Runtime notes

Claude Code reads this file through `CLAUDE.md`, which adds its own notes; Codex reads it directly and prompts
before a browser run (`.codex/rules/playwright.rules`). Skills are shared in `.agents/skills/`; the agent seats in
`.claude/agents/` and `.codex/agents/` carry the same charters. Ten of those skills link to verbatim copies of
mattpocock/skills at commit 5b15a47f2d7150f545fbcacbfe381787fc0230dc in `.agents/upstream/mattpocock-skills/`, with
its licence; they are never edited in place, an update replaces them whole, and Codex invokes any skill as
`$<name>`. The tracker and triage vocabulary those copies expect to have been provided is
[docs/ISSUE-TRACKER.md](docs/ISSUE-TRACKER.md). The root checkout is the integration checkout: it stays on `main`,
and nothing is edited, branched, or committed there; the git guard refuses the branching and committing half. Resume
fetches before intake, reads the fetched manual and `resume`/`closeout` instructions, and uses closeout's safe
procedure to advance the actual clean idle `main` checkout before board evidence or decisions. A topic, dirty,
active, divergent or uncertain checkout is preserved.
Each job gets one worktree and the session starts inside it, never a worktree inside another job worktree; the
`resume` skill says where it lives on each runtime.

The session that talks to the owner coordinates: it plans the cards that need no architect, hands every edit to
a builder seat, settles reviews, and delivers; it never builds. Residual judgment that would make a handoff
unreliable is resolved in the plan or the slice is split smaller. The costliest model of each family, Fable on
Claude and Astra on Codex, is reached only through the `architect`, `oracle` and `security-reviewer` seats; the
session and the builders run on the tier below. Every subagent is one of the named seats above, dispatched by its
seat name; a generic, default or unnamed role is never dispatched.

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
[docs/README.md](docs/README.md). History: git.

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
without asking, only for work that genuinely cannot. Destructive actions keep exact-target approval.

An approval covers only the question it answered. After a context compaction, reread the owner's latest messages
before acting on one; an approval whose question is no longer in view is asked again. A memory, summary or earlier
session never grants approval.

## Compact instructions

Keep the approved plan's location, the card's acceptance criteria, the worklog path, the current slice and its
state, the evidence still owed, and each owner approval quoted word for word with the question it answered. Drop
discovery output: file listings, search results and file contents, which can be read again.

## Coding standards and the executed test bar

[docs/CODING-STANDARDS.md](docs/CODING-STANDARDS.md) owns how first-party code is written.
[docs/TESTING-STRATEGY.md](docs/TESTING-STRATEGY.md) owns the evidence every claim needs, run through
`node scripts/run-log.mjs` so the pull request body quotes exit codes a script wrote.

## Review and visual verification

One fresh review of the final tree before the pull request opens, by the tier the `resume` skill defines: the session
itself for documents; for code and agent instruction, the `reviewer` charter run by the model family that did not
write the diff (`cross-review`), with the skill's route when that family's seat is unavailable; `security-reviewer`
only when a change widens a surface in the Surfaces table's `security review` row. Greptile is metered from one
pool shared by the canonical repository and every adopter the manifest lists; each repository sends only its own Surfaces `sign-off` row. It
reviews a draft only for the sign-off tier, every thread fixed or dismissed with a reason before the draft is
marked ready. The `resume` skill owns the tiers, the allowance lookup, the cross-family substitution route when the other family's seat cannot be
reached, and Greptile's own best-effort provider-unavailability exception; `.greptile/config.json` disables automatic
reviews so marking ready starts CI without requesting another Greptile review.

Visual work is complete only after the changed interaction has been driven and a current screenshot displayed
inline in chat; push authorisation waits for that image. Drive visual work as the Conventions table's `visual
verification` row says.

## Publication and machinery

Push only with owner authorisation, through a draft pull request. The documentation sweep and its day-after triage
follow [docs/DOC-SWEEP.md](docs/DOC-SWEEP.md) and [docs/SWEEP-TRIAGE.md](docs/SWEEP-TRIAGE.md) when the
Conventions table marks them active. New executable machinery in the workflow itself
(a script, hook, gate, or workflow job; never product code or its tests) needs one of: a control failure a
sentence here or in a skill could not prevent twice, the same measurable friction across three independent jobs,
a required new runtime or provider integration, or externally imposed security or platform drift. Prefer a native
feature over custom code, a hook over a script, and a sentence over a hook.

## Shared workflow adoption

The files `.agents/factory-manifest.json` lists are shared workflow bytes. The manifest's `canonical` repository
owns them, every repository in its `adopters` list carries identical copies, and `AGENTS.md` shares only the text
between its `factory-shared` markers. A shared change is a card in the canonical repository plus one sync card per
adopter; the sync card runs `node scripts/factory-sync.mjs --from <canonical checkout>` from the adopter's job
worktree against a clean canonical checkout at its fetched `main`. The change stays partial until every adopter's
sync lands. A shared file edited without its manifest hash following fails the contract test;
`node scripts/factory-sync.mjs --write` refreshes the hashes, and only in the canonical repository. An intentional
adopter exception needs owner agreement and lives outside the shared files. `resume` reports at intake whether this
repository lags the canonical copy.

<!-- factory-shared:end -->

## Product

RentCottage is a trilingual cottage marketplace. `src/` contains the Next.js application and product logic;
`supabase/` owns declared database objects, migrations and Row Level Security; `scripts/` contains product,
provider, deployment and verification tooling; `custom-worker.ts` and `wrangler.jsonc` define the Cloudflare
Worker boundary. [CONTEXT.md](CONTEXT.md) owns product meaning and canonical language.

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

Read [CONTEXT.md](CONTEXT.md), [docs/agents/domain.md](docs/agents/domain.md), and accepted architecture decisions
before changing a domain seam. Follow [ADR 0002](docs/adr/0002-database-integrity-application-orchestration.md)
for the database/application boundary. Change declared database objects under `supabase/schemas/`, generate and
inspect the migration, and land both together. Preserve the product preparation and cleanup rules in
[docs/TESTING-STRATEGY.md](docs/TESTING-STRATEGY.md).

## Grounding

[CONTEXT.md](CONTEXT.md) holds canonical product terms and [docs/agents/domain.md](docs/agents/domain.md) explains
their code boundaries. Accepted architecture decisions own technical boundaries. Ground a live provider or
platform integration in current official documentation before planning exact permissions, payloads and failure
semantics. Competitors are interface prior art only and never override RentCottage's agreed product meaning.

## Surfaces

| Surface | RentCottage |
|---|---|
| plan-first | Authentication, authorization, payments, personal data, private owner-verification files, database migrations, Row Level Security, provider/Worker trust, destructive data changes, new user-facing behaviour with no settled design |
| owner-directed | New product meaning and unsettled user-facing design: owner direction plus domain grounding |
| sign-off | Authentication, authorization, payments, personal data, schema/migrations, Row Level Security, provider/Worker trust, the public/private data perimeter, and any other trust-boundary change; each needs explicit sign-off and a named anti-regression test |
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
| fixtures | [docs/demo.md](docs/demo.md) |
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
