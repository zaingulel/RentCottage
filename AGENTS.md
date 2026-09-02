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

Start or continue work with `resume`, park unfinished work with `handoff`, and run `closeout` after merge.

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
destructive data changes, and new user-facing behaviour with no settled design require an approved concrete plan
before editing. Plans name affected areas, expected behaviour, verification, migration, and rollback.

## Owner gates

1. **Work selection:** the owner approves the issue outcome and acceptance criteria. High-blast-radius work also
   requires approval of its concrete plan.
2. **Delivery approval:** the owner reviews one filled pull-request body containing the finished bundle and local
   evidence. The approval covers only the outward actions it names. Push, pull-request creation, merge, deployment,
   hosted settings, and tracker mutation require that authority.

Local commits on an approved job branch are green-slice construction state and need no separate approval.
Destructive actions keep exact-target approval.

## Native job lifecycle

- Fetch `origin/main` and create `job/<issue>` directly from that ref in one native worktree. A dirty or stale
  primary checkout is preserved; it is not synchronized, stashed, cleaned, or used as a prerequisite.
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

The coordinator owns scope, integration, verification, and owner communication. Use the smallest useful team:

- `explorer` locates code and evidence without judging or editing.
- `architect` produces a concrete plan; `plan-reviewer` challenges a fixed high-risk plan once.
- `builder-lite`, `builder`, and `builder-max` are bounded writer tiers. The coordinator chooses from issue risk,
  residual judgment, uncertainty, rollback, and verification strength, then names the seat explicitly.
- `reviewer` performs the fresh final Standards and Specification review.
- `security-reviewer` joins that round only when `security-code-review` classifies a sensitive surface.
- `oracle` is an exceptional read-only escalation for a twice-stalled diagnosis, unresolved architecture
  tiebreak, or independent high-consequence derivation. It is not a routine rung.

Planning and review manifests request read-only runtime defaults. A parent runtime can override those defaults,
so the coordinator must verify the effective sandbox and ownership before accepting independent evidence. A
write-capable lane is not independent review evidence and must be rerun in an enforced read-only runtime.
Specialist fan-out beyond these seats needs owner approval for that job.

## Construction and review

Use `tdd` for non-trivial behaviour at an approved public seam and `diagnosing-bugs` for hard or repeated
failures. Each material behaviour change carries a regression proof that goes red when the behaviour is broken
and green when restored. Run focused evidence during construction and `npm run verify` once at convergence.

One fresh independent review checks the complete finished change against repository standards and the issue.
Run `security-code-review` first to decide whether Security joins Standards and Specification. A true bounded
finding returns to the sole writer; focused verification follows the repair, then one fresh review round checks
the resulting tree. After two non-converging repair-and-review cycles, stop and return to the owner to split,
rescope, or stop.

Greptile is the sole external reviewer and is best-effort. Use one attempt per pull-request head and re-review
only after a genuine repair push. An unavailable attempt is reported, never presented as complete, and does not
replace local review, executable verification, required Continuous Integration (CI), conversation resolution,
or ownership.

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
