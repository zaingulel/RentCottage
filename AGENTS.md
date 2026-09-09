# RentCottage operating manual

The issue owns the outcome, Git owns shipped and in-flight work, and GitHub owns planning and pull-request state.
Skills own session steps. Product code does not carry a second workflow state machine.

## Runtime map

| Surface | Claude Code | Codex |
|---|---|---|
| Manual | `CLAUDE.md` imports this file | reads this file |
| Skills | `.claude/skills/<name>` links to `.agents/skills/<name>` | `.agents/skills/<name>/SKILL.md` |
| Agent seats | `.claude/agents/*.md` | `.codex/agents/*.toml` |
| Isolated job | native Git worktree | native Git or Codex-managed worktree |

Start or continue work with `resume`, park unfinished work with `handoff`, and run `closeout` after merge. Use
`closeout`'s process reconciliation before normal completion or handoff and after a recoverable interruption.

## Sources of truth

- **Planned work:** GitHub Issues, native dependencies, and Project 4. The tracker procedure is
  [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).
- **Shipped work:** `origin/main`, Git history, and passing checks.
- **In-flight work:** one `job/<issue>` branch, one native worktree, and its draft pull request.
- **Product meaning:** [`CONTEXT.md`](CONTEXT.md), accepted architecture decisions, and
  [`docs/agents/domain.md`](docs/agents/domain.md).
- **Engineering evidence:** [`docs/engineering/coding-standards.md`](docs/engineering/coding-standards.md) and
  [`docs/engineering/testing-strategy.md`](docs/engineering/testing-strategy.md).

When these authorities conflict, stop, explain the conflict, recommend a resolution, and leave the decision with
the owner. Chat history is not durable project state.

## Product and boundary map

RentCottage is a trilingual cottage marketplace. `src/` contains the Next.js application and product logic;
`supabase/` owns database changes and Row Level Security; `scripts/` contains product, provider, deployment, and
tracker verification; `.github/workflows/preview.yml` owns preview deployment.

Authentication, authorization, payments, personal data, database migrations, security/privacy boundaries,
destructive data changes, and new user-facing behaviour with no settled design require a concrete plan
before editing. Plans name affected areas, expected behaviour, verification, migration, and rollback.

## Owner gates

1. **Work selection:** the owner approves the issue outcome and acceptance criteria, authorizing planning, builder
   routing, implementation, verification, and review within that outcome. Small understood adjacent repairs may
   ride with the job when their risk is bounded and verifiable; disclose them in the pull request. A material
   change to product meaning, outcome, scope, or risk requires owner approval.
2. **Delivery approval:** the owner reviews one filled pull-request body containing the finished bundle and local
   evidence. The approval covers only the outward actions it names. Push, pull-request creation, merge, deployment,
   hosted settings, and tracker mutation require that authority.
   A current approval carries its named actions through merge and exact cleanup; confirmed reviewer-credit
   exhaustion under `docs/agents/delivery.md` does not require approval of those actions again.

Local commits on an approved job branch are green-slice construction state and need no separate approval.
Destructive actions keep exact-target approval.

## Native job lifecycle

- Resume fetches `origin/main` before intake, reads the fetched manual and `resume`/`closeout` instructions, then
  uses `closeout`'s safe local-main procedure before board evidence or a work decision. The normal starting root
  stays on `main`; any topic, dirty, active, divergent or uncertain checkout is preserved and never switched,
  stashed, cleaned or used as a prerequisite. Create `job/<issue>` directly from freshly fetched `origin/main` in
  one native worktree.
- One writer owns the job worktree. Other agents are read-only unless the coordinator explicitly hands the sole
  writer role to one builder and waits for it to stop.
- Parallel tickets require demonstrably separate behaviour, files, migrations, providers/database seams, tests,
  and verification capacity. Separate worktrees alone do not prove independence.
- Commit every coherent green slice locally. A draft pull request is the durable handoff for unfinished work and
  its `Not done` section names the next step. Leave its worktree in place.
- `closeout` removes only an exact clean merged job worktree after the writer has stopped. Primary, current,
  dirty, active, detached, foreign, or uncertain worktrees are retained and reported.

There is no allocator, synchronizer, lock service, sweeper, checkpoint, release wrapper, or worktree registry
beyond Git's own inventory.

## Team and routing

The coordinator owns scope, integration, access and shared-resource readiness, verification, progress reporting,
process-cleanup accountability, and owner communication. Builders prepare focused evidence and own the processes
they start. `resume` owns launch readiness, `handoff` owns retained-process records, `closeout` owns process
reconciliation, and the testing strategy owns test preparation and retry reporting. For Codex, select the seat by
its role and risk, then explicitly pass the model and reasoning effort from `.codex/agents/<seat>.toml`; these
repository definitions take precedence over machine-wide model routing. Use the smallest useful team:

- `explorer` locates code and evidence without judging or editing.
- `architect` produces a concrete plan; `plan-reviewer` challenges a fixed high-risk plan once.
- `builder-lite`, `builder`, and `builder-max` are bounded writer tiers. The coordinator chooses from issue risk,
  residual judgment, uncertainty, rollback, and verification strength, then names the seat explicitly.
- Two fresh `reviewer` instances perform the independent Standards and Specification lanes. Repository seat
  routing overrides generic agent selection in the managed `code-review` skill.
- `security-reviewer` joins that round as a separate lane only when `security-code-review` classifies a sensitive
  surface.
- `oracle` is an exceptional read-only escalation for a twice-stalled diagnosis, unresolved architecture
  tiebreak, or independent high-consequence derivation. It is not a routine rung.

Planning manifests request read-only runtime defaults. Reviewers use existing narrow permission escalation to run
required tests and browsers and may write temporary evidence, but must not edit implementation, tests, or agent
instructions. The coordinator verifies the effective runtime, records the reviewed commit, and confirms its
tracked source is unchanged after evidence runs.
Specialist fan-out beyond these seats needs owner approval for that job.

## Construction and review

Choose `strict-tdd`, `evidence-required`, or `preservation` under the testing
strategy. Builders run focused evidence; the coordinator owns mutation proof and the applicable `npm run verify`
convergence route. Use `diagnosing-bugs` for hard or repeated failures.

Finish construction by verifying, committing, and confirming that no intended change remains outside the commit.
Run `security-code-review` to route one fresh Standards instance and one fresh Specification instance against the
same committed job diff, plus a separate Security instance when classified sensitive. Preserve each context and
verdict. A true bounded finding returns to the sole writer. Commit the repair after focused verification, then
review only that repair delta and what it could break in each implicated lane. No review follows a repair that
adds no factual claim. After two non-converging repair-and-scoped-review cycles, stop and return to the owner to
split, rescope, or stop.

Documentation-only changes skip Greptile under `docs/agents/delivery.md`. For other changes, Greptile is the sole
external reviewer and is best-effort: check current credits under `docs/agents/delivery.md`, request it explicitly
on the finished draft when available, and settle the review or confirmed unavailability before
marking ready for Continuous Integration (CI). `.greptile/config.json` disables automatic reviews. A changed head
needs a fresh attempt when review is required; unchanged-head CI retries need none. An unavailable attempt does
not replace local review, executable verification, required CI, conversation resolution, or ownership.

## Delivery and CI

Load [`docs/agents/delivery.md`](docs/agents/delivery.md) only after delivery approval. Finished work opens as a
draft pull request. Marking it ready starts GitHub's merge-result CI and exposes the single required `test` check.
Queue the approved merge with GitHub auto-merge and squash; GitHub waits for current required checks and resolved
conversations. Preview deployment remains a separate owner-approved operation under `.github/workflows/preview.yml`.

The hosted `main` ruleset requires the source-bound `test` check with current-base strictness and conversation
resolution. Auto-merge is enabled. A change to either hosted setting is verified immediately after mutation.

## Workflow machinery

Prefer Git, GitHub, an existing test, and a precise issue over executable orchestration. New workflow machinery
requires separate owner approval plus a repeated demonstrated control failure, recurring measured friction, a
required provider/runtime integration, or an externally imposed security/platform change. State its maintenance
cost and removal condition before implementation.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
