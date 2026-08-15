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

For a substantial change, state the route before editing:

- **Inline** for a trivial, well-bounded change.
- **Exploration** for read-heavy discovery; delegate only independent, bounded reading when it preserves useful main-thread context.
- **Plan → build → review** for cross-cutting work, a change with unclear direction, data-model changes, security/privacy work, or a substantial user-facing behaviour.

Use the installed skills rather than reproducing their methods: `codebase-design` / `to-spec` / `grill-with-docs` for design, `tdd` for implementation, `code-review` before completing substantive code changes, and `diagnosing-bugs` for hard or repeated failures.

## Delivery contract

Keep orchestration in the active work session. The repository records the desired outcome and software evidence; it does not maintain a custom checkpoint or workflow state machine.

### Roles

- **Coordinator:** owns scope, integration, verification and owner communication. It selects the smallest useful team for the ticket.
- **Planner:** works read-only and turns approved acceptance criteria into an evidence-based implementation plan.
- **Plan reviewer:** works read-only and independently challenges a fixed plan through feasibility, scope, coherence and security/privacy lenses.
- **Plan consolidator:** works read-only and adjudicates multiple plan-review results into the smallest evidence-backed correction brief. It does not redesign the solution or replace the planner.
- **Explorer:** works read-only on bounded discovery when current code, provider documentation or prior art must be checked.
- **Worker:** is the only writer for its active delivery ticket and returns the changed paths and verification results.
- **Reviewer:** works read-only and independently checks both repository standards and the ticket acceptance criteria. Findings are accepted or rejected on evidence, not on the identity of the reviewer.

The current agent configuration selects models for these capabilities. Do not duplicate model names or reasoning settings in this repository.

### Plan review

Before the worker edits a substantial **Plan → build → review** ticket, give the fixed plan to at least one independent plan reviewer. The default is one reviewer covering feasibility, scope, coherence and security/privacy. The coordinator may distribute those lenses across separate reviewers whenever independent depth is useful, provided the assigned reviewers collectively cover all four; this is a judgement call, not a risk-threshold rule.

Reviewers report concrete, evidence-backed findings against the approved issue and repository authorities. They remain read-only, do not rewrite the plan, and do not add product scope.

- After one plan review, the original planner revises the plan.
- After multiple specialist reviews, use an independent plan consolidator by default. The consolidator removes duplicates, rejects false or stale findings and produces a correction brief.
- In every path, the original planner owns the final revised plan and the coordinator checks the finding dispositions and revised plan before build.
- A consolidator must not introduce a new source of truth, make an owner decision or silently change approved scope. If the reviews expose a choice that existing authorities do not settle, stop and ask the owner.

Plan review does not replace test-driven implementation, independent review of the finished change, executable verification or existing owner approval gates.

Adoption evidence: issue #55 had entered implementation before ordinary review exposed plan-level policy gaps, and a subsequent independent plan audit found additional authority, write-safety, workflow-trust and provider-completeness defects that required another replan. Implementation tests and final review remain necessary, but they cannot prevent rework caused by an unsound starting plan.

Maintenance cost is one independent reviewer call for each substantial plan, plus additional model usage and latency when the coordinator chooses specialist lenses and consolidation. Remove or simplify this gate if representative deliveries show that it no longer finds material plan defects beyond the planner and coordinator, or if a lower-cost control proves the same outcome.

### Isolation and parallel work

- Start each active delivery ticket from fresh `main` on its own branch and worktree. Leave other checkouts and uncommitted work untouched.
- Assign one writer to each active delivery ticket. Do not split one ticket across concurrent writer branches. The coordinator may integrate only after the worker has stopped writing.
- Parallel implementation across different tickets is allowed only when domain behaviour, files, database migrations and tests are demonstrably separate. If separation is uncertain, work sequentially.
- The GitHub issue owns ticket-specific scope, acceptance criteria, dependencies and references to settled decisions. `CONTEXT.md` supplies domain language and applicable architecture decisions supply technical context. If these sources conflict or appear incorrect, stop, explain the conflict, recommend a resolution and leave the decision with the owner. Do not add a second progress record.

### Owner decisions and evidence

There are two routine owner decisions:

1. **Work selection:** approve the ticket outcome and acceptance criteria before implementation starts. For high blast-radius work, include the concrete plan required by the change gate below in this decision.
2. **Delivery approval:** review the finished evidence packet before any commit or outward action such as a push, pull request, deployment or merge. The approval must state the exact actions it covers.

The delivery packet contains the acceptance-criteria mapping, diff summary, tests run, review outcome, current screenshots for visible work, security and privacy impact, migration or rollback notes, and any known gap. CodeRabbit or another external reviewer may add evidence but never replaces the independent review or executable checks.

### Adding workflow machinery

Add a repository workflow tool or gate only after the same material failure recurs and a test, GitHub protection rule or clearer ticket cannot prevent it more cheaply. Before implementation, state its recurring maintenance cost and the condition for removing it.

## Change gates

Obtain approval of a concrete plan before editing work that is high blast-radius: authentication, payments, personal data, security/privacy boundaries, destructive or irreversible data changes, or a new user-facing behaviour whose design is not established. Plans must name the affected area, expected behaviour, verification, and any migration or rollback implications.

Every behaviour change needs proportionate verification. Prefer a test that would fail if the behaviour regressed; for a visible change, run the app and inspect the rendered result. Do not claim success without direct evidence.

Keep changes bounded. For larger work, split implementation into independently testable slices. If a plan proves incomplete or a risk emerges, stop and report it instead of improvising.

Commit, push, open or merge pull requests, and make external tracker changes only when the user explicitly asks. When a process failure reveals a recurring weakness, prefer a deterministic check or test over adding more prose; record a durable project decision only when it is genuinely reusable.
