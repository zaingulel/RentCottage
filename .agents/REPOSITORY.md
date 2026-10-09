# RentCottage repository profile

What is true of this repository alone. `AGENTS.md` holds the rules every session needs and points here; skills
and seats read the Conventions table below by row name.

## Product

`src/` contains the Next.js application and product logic;
`supabase/` owns declared database objects, migrations and Row Level Security; `scripts/` contains product,
provider, deployment and verification tooling; `custom-worker.ts` and `wrangler.jsonc` define the Cloudflare
Worker boundary. [GLOSSARY.md](../GLOSSARY.md) owns product meaning and canonical language.

## Architecture seams

The rules for changing a seam are in `AGENTS.md` under Architecture seams.

## Grounding

[GLOSSARY.md](../GLOSSARY.md) holds canonical product terms and [docs/agents/domain.md](../docs/agents/domain.md) explains
their code boundaries. Accepted architecture decisions own technical boundaries. Ground a live provider or
platform integration in current official documentation before planning exact permissions, payloads and failure
semantics. Competitors are interface prior art only and never override RentCottage's agreed product meaning.

## Conventions

| Convention | RentCottage |
|---|---|
| generated artifacts | None |
| visual verification | The applicable Next.js or Worker surface across desktop, mobile, right-to-left and accessibility states. |
| fixtures | [Fixtures, preparation and cleanup](../docs/TESTING-STRATEGY.md#fixtures-preparation-and-cleanup) in the testing strategy. For product behaviour, the real fixtures the shared skills ask for are synthetic records created through the real production transitions in the disposable test database, as that section describes; a unit or workflow-tooling test builds its own disposable fixture at its seam, in memory or in a temporary directory or repository. There are no real-data fixtures, and the demo is not test data |
| documentation routines | Inactive: the documentation sweep and its day-after triage, [docs/DOC-SWEEP.md](../docs/DOC-SWEEP.md) and [docs/SWEEP-TRIAGE.md](../docs/SWEEP-TRIAGE.md), stay inactive until their external environment, hosted protection and schedule are separately authorised |

Codex prompts before a browser run under `.codex/rules/playwright.rules`, pinned by
`scripts/lib/codex-browser-policy.test.mjs`.

On Claude Code a job worktree lives in the root checkout's gitignored `.claude/worktrees/`, created by
`git worktree add`; on Codex it is the Codex-managed worktree or a sibling worktree beside the repository. The current
adopters of the shared workflow are Flowgauge and RentCottage.
