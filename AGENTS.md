## Agent skills

### Issue tracker

GitHub Issues in `zaingulel/RentCottage`; external PRs are not triaged. See `docs/agents/issue-tracker.md`.

GitHub Issues, native dependencies, and Project 4 are one tracker. Run `npm run verify:board` before work selection and after tracker publication or reconciliation; unavailable or failing evidence stops selection. Keep the procedure in `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five standard labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout. See `docs/agents/domain.md`.

### Engineering standards

`docs/engineering/coding-standards.md` governs code quality and security. `docs/engineering/testing-strategy.md` governs evidence selection and the stable verification commands. If these standards conflict with product, domain, architecture or issue decisions, stop, explain the conflict, recommend a resolution and leave the decision with the owner.

## Working method

Start a substantive work session with `$resume`; end or park it with `$handoff`. Treat Git and direct verification as the record of what is shipped, and the configured issue tracker as the live plan. Do not rely on chat history or a status document when they conflict with Git.

### Resume intake

Use the shared selection-only `$resume` intake with these RentCottage sources:

- Durable state: Git status and history, `npm run verify:board`, open pull requests, worktrees, and active Codex task ownership.
- Candidate detail: GitHub issue bodies and attributed comments.

For high-blast-radius work, treat the initial choice as authorisation for read-only planning. Approval of the completed concrete plan is the formal work-pick before editing.

State the route before editing:

- **Inline** with a short plan for bounded work that follows established patterns.
- **Exploration** for read-heavy discovery; delegate only independent, bounded reading when it preserves useful main-thread context.
- **Plan → build → review** for genuinely high-blast-radius work or unresolved work that crosses module, service, persistence, provider, security or privacy boundaries.

Use the installed skills rather than reproducing their methods: `codebase-design` / `to-spec` / `grill-with-docs` for design, `tdd` for implementation, and `diagnosing-bugs` for hard or repeated failures. Route every substantive finished change through the repository's `security-code-review` skill.

## Delivery contract

Keep orchestration in the active work session. The repository records the desired outcome and software evidence; it does not maintain a custom checkpoint or workflow state machine.

### Delivery authority

Load [`docs/agents/delivery.md`](docs/agents/delivery.md) only when preparing or executing an owner-approved delivery. Selection-only resume, planning and ordinary construction do not preload it. That authority owns commits made as part of delivery, outward delivery, reconciliation, terminal release, refusal and recovery guidance; it does not own local green-slice construction commits.

### Roles

- **Coordinator:** owns scope, integration, verification and owner communication. It selects the smallest useful team for the ticket.
- **Planner:** works read-only and turns approved acceptance criteria into an evidence-based implementation plan.
- **Plan reviewer:** works read-only and independently challenges a fixed plan through feasibility, scope, coherence and security/privacy lenses.
- **Explorer:** works read-only on bounded discovery when current code, provider documentation or prior art must be checked.
- **Worker:** is the only writer for its active delivery ticket and returns the changed paths and verification results.
- **Reviewer:** works read-only and independently checks both repository standards and the ticket acceptance criteria. Findings are accepted or rejected on evidence, not on the identity of the reviewer.

The current agent configuration selects models for these capabilities. Do not duplicate model names or reasoning settings in this repository.

### Plan review

Use one independent plan review only for genuinely high-blast-radius or unresolved cross-boundary work. One reviewer covers feasibility, scope, coherence and security/privacy. The worker waits while the coordinator resolves findings and fixes the plan.

Reviewers report concrete, evidence-backed findings against the approved issue and repository authorities. They remain read-only, do not rewrite the plan, and do not add product scope.

Specialist fan-out and consolidation happen only when the owner explicitly approves them for that job. The coordinator checks every finding disposition and the final plan before build. If review exposes a choice the approved authorities do not settle, return that choice to the owner.

Plan review does not replace test-driven implementation, independent review of the finished change, executable verification or existing owner approval gates.

### Final review and repair

Run one independent final review round on the finished change. Standards and Specification are the normal lanes; add Security only when `security-code-review` classifies the change as sensitive. All lanes in that dispatch are one review round.

Return a true finding to the ticket's sole writer only when the approved plan or outcome determines one bounded correction within the approved size and surface. Run focused verification for the repair, then one fresh final review round. A remedy that needs new executable machinery or materially exceeds the approved size or surface is an owner scope question, not an automatic fix.

After two repair-and-re-review cycles that still produce new material true findings, stop and return to the owner to split, rescope or stop the job. Do not automatically begin another planning or build cycle.

### Isolation and parallel work

- Start each active delivery ticket from fresh `main` on its own branch and worktree. Leave other checkouts and uncommitted work untouched.
- Assign one writer to each active delivery ticket. Do not split one ticket across concurrent writer branches. The coordinator may integrate only after the worker has stopped writing.
- Parallel implementation across different tickets is allowed only when domain behaviour, files, database migrations and tests are demonstrably separate. If separation is uncertain, work sequentially.
- The GitHub issue records ticket-specific scope, acceptance criteria, dependencies and references to settled decisions. Agent-added ticket detail may clarify the owner's approved outcome but cannot expand it. `CONTEXT.md` supplies domain language and applicable architecture decisions supply technical context. If these sources conflict or appear incorrect, stop, explain the conflict, recommend a resolution and leave the decision with the owner. Do not add a second progress record.
- On an approved isolated job branch, the worker may commit each green slice as durable local Git state. These construction commits need no owner approval and remain local until delivery approval; commit gates in `docs/agents/delivery.md` apply only to commits made as part of delivery.

### Owner decisions and evidence

There are two routine owner decisions:

1. **Work selection:** approve the ticket outcome and acceptance criteria before implementation starts. For high blast-radius work, include the concrete plan required by the change gate below in this decision.
2. **Delivery approval:** review the finished implementation bundle and locally knowable evidence in one delivery packet before outward action such as a push, pull request, deployment, merge or tracker mutation. Delivery approval must explicitly authorise outward action; [`docs/agents/delivery.md`](docs/agents/delivery.md) defines semantic and persistent approval scope and staleness. The same delivery packet is progressively completed with evidence acquired during delivery. No second routine owner approval is required while the original approval remains current.

Work-selection approval remains valid for bounded in-scope repair. Return to the owner when the approved authorities no longer determine one bounded correction or the proposed remedy changes approved scope.

### External review

Greptile is the sole external reviewer and is best-effort. Every delivery attempts Greptile against the exact current pull-request head and records the attempt as `COMPLETE` or `UNAVAILABLE` under `docs/agents/delivery.md`. No paid plan, billing change, purchase, or upgrade is authorised.

A settled `UNAVAILABLE` attempt is reportable but is not a merge veto once every mandatory pre-merge gate is green: internal review, executable verification, exact-head Continuous Integration, conversation resolution and ownership. Post-merge tracker reconciliation, board verification, ownership and guarded release remain mandatory. This exception does not relax or replace any of those gates. A `COMPLETE` review requires complete changed-file coverage and an evidence-based disposition for every finding.

Before a delivery commit or outward action, the delivery packet contains the finished implementation bundle, acceptance-criteria mapping, diff summary, tests run, pre-outward review outcome, current screenshots for visible work, security and privacy impact, migration or rollback notes, and any known gap. The same delivery packet progressively gains the materialized commit and pull-request identity, settled Greptile attempt state and concise supporting evidence, fresh exact-head internal reviews, exact-head Continuous Integration, merge, tracker reconciliation, board verification and guarded release evidence. Progressively completing it does not create a second record or staged manifest. Greptile supplements the independent review and executable checks; it replaces neither.

### Adding workflow machinery

Determinism is a quality requirement for an already-approved command, test, artifact or invariant. It does not authorise creating a command, guard, script, hook, gate, manifest, parser, state machine, framework, transaction protocol or workflow subsystem.

Use existing platform and repository capabilities first. New executable workflow machinery requires separate owner approval and either a repeated demonstrated control failure or recurring measured friction, a genuinely required runtime or provider integration, or an externally imposed security or platform change. Before approval, state its recurring maintenance cost and removal condition.

## Change gates

Obtain approval of a concrete plan before editing genuinely high-blast-radius work: authentication, payments, personal data, security/privacy boundaries, destructive or irreversible data changes, or a new user-facing behaviour whose design is not established. Also plan first when unresolved work crosses a module, service, persistence or provider boundary. Plans name the affected area, expected behaviour, verification, and any migration or rollback implications.

Every behaviour change needs proportionate verification. Prefer a test that would fail if the behaviour regressed; for a visible change, run the app and inspect the rendered result. Do not claim success without direct evidence.

Keep changes bounded. For larger work, split implementation into independently testable slices. If a plan proves incomplete or a risk emerges, stop and report it instead of improvising.

Push, open or merge pull requests, deploy, and make external tracker changes only when the user explicitly asks. Record a durable project decision only when it is genuinely reusable.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
