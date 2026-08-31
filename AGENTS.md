## Agent skills

### Issue tracker

GitHub Issues in `zaingulel/RentCottage`; external PRs are not triaged. See `docs/agents/issue-tracker.md`.

GitHub Issues, native dependencies, and Project 4 are one tracker. Run `npm run verify:board` before work selection and after tracker publication or reconciliation; unavailable or failing evidence stops selection. Keep the procedure in `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five standard labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout. See `docs/agents/domain.md`.

### Engineering standards

`docs/engineering/coding-standards.md` governs code quality and security. `docs/engineering/testing-strategy.md` governs evidence selection and the stable verification commands. If these standards conflict with product, domain, architecture or issue decisions, stop, explain the conflict, recommend a resolution and leave the decision with the owner. Only a conflict arising during review repair or re-planning uses the repair-only owner-interruption rule under **Review repair and re-planning**.

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

Use the installed skills rather than reproducing their methods: `codebase-design` / `to-spec` / `grill-with-docs` for design, `tdd` for implementation, and `diagnosing-bugs` for hard or repeated failures. Route every substantive finished change through the repository's `security-code-review` skill.

## Delivery contract

Keep orchestration in the active work session. The repository records the desired outcome and software evidence; it does not maintain a custom checkpoint or workflow state machine.

### Delivery authority

Load [`docs/agents/delivery.md`](docs/agents/delivery.md) only when preparing or executing an owner-approved delivery. Selection-only resume, planning and ordinary construction do not preload it. That authority owns outward delivery, reconciliation, terminal release, refusal and recovery guidance.

### Roles

- **Coordinator:** owns scope, integration, verification and owner communication. It selects the smallest useful team for the ticket.
- **Planner:** works read-only and turns approved acceptance criteria into an evidence-based implementation plan.
- **Plan reviewer:** works read-only and independently challenges a fixed plan through feasibility, scope, coherence and security/privacy lenses.
- **Plan consolidator:** works read-only and, when multiple specialist reviews are used, adjudicates their findings and produces the final revised plan. It does not expand approved scope or make unresolved owner decisions.
- **Explorer:** works read-only on bounded discovery when current code, provider documentation or prior art must be checked.
- **Worker:** is the only writer for its active delivery ticket and returns the changed paths and verification results.
- **Reviewer:** works read-only and independently checks both repository standards and the ticket acceptance criteria. Findings are accepted or rejected on evidence, not on the identity of the reviewer.

The current agent configuration selects models for these capabilities. Do not duplicate model names or reasoning settings in this repository.

### Plan review

Before the worker edits a substantial **Plan → build → review** ticket, give the fixed plan to at least one independent plan reviewer. The worker must wait until review is complete, the route's final plan has incorporated the accepted findings and the coordinator has validated the finding dispositions and revised plan. The default is one reviewer covering feasibility, scope, coherence and security/privacy. The coordinator may distribute those lenses across separate reviewers whenever independent depth is useful, provided the assigned reviewers collectively cover all four; this is a judgement call, not a risk-threshold rule.

Reviewers report concrete, evidence-backed findings against the approved issue and repository authorities. They remain read-only, do not rewrite the plan, and do not add product scope.

- After one plan review, the original planner produces the final revised plan.
- After multiple specialist reviews, an independent plan consolidator removes duplicates, rejects false or stale findings, adjudicates conflicts and produces the final revised plan. The original planner may be consulted when plan rationale or context is missing, but the plan does not automatically return to it.
- In every path, the coordinator checks the finding dispositions and final revised plan before build.
- A consolidator must not introduce a new source of truth, make an owner decision or silently change approved scope. If the reviews expose a choice that existing authorities do not settle, stop and ask the owner. During a `PLAN_INVALIDATING` transition, the planner, reviewers and consolidator instead return the choice to the coordinator, which applies the repair-only owner-interruption rule under **Review repair and re-planning**.

Plan review does not replace test-driven implementation, independent review of the finished change, executable verification or existing owner approval gates.

Evaluation is complete and the gate is retained; issue #93 holds the history, evidence and decision. Routine maintenance cost is one independent review for each substantial plan, plus extra latency and model usage only when the coordinator chooses specialist fan-out and consolidation. Reconsider the gate only if later evidence shows a cheaper control catches every material plan defect or owner ambiguity with less latency and model usage. This is outcome-based, not another scheduled trial.

### Review repair and re-planning

The coordinator assigns every accepted finished-change finding exactly one class, with concise evidence, before authorising repair. Evaluate `PLAN_INVALIDATING` first; it takes precedence:

- **`PLAN_INVALIDATING`:** an approved plan assumption is false, the plan does not fully determine exactly one coherent correction, satisfying the finding changes a module or service boundary, transaction or concurrency ordering, persistence or provider contract, security or privacy boundary, migration or rollback design, or verification seam, or the coordinator cannot evidence every bounded condition. Stop ad hoc repair on the first such finding. Fix one active-session evidence bundle containing the current issue, approved plan, accepted finding dispositions, complete changed bundle and all verification results. Give that bundle to a fresh planner. A fresh independent plan reviewer receives the same bundle plus the planner's revised plan and challenges it. After one review, the original planner incorporates accepted findings and produces the final revised plan; after multiple specialist reviews, an independent plan consolidator produces it under **Plan review**. The coordinator validates the finding dispositions and final revised plan; then exactly one writer resumes.
- **`BOUNDED_REPAIR`:** only when no plan-invalidating condition applies, the approved plan fully determines one correction and every listed boundary remains unchanged. Return the finding to the ticket's sole writer and run proportionate focused verification.

After either repair path produces a complete repaired bundle, all previous finished-change reviewer tasks and verdicts are terminal. Invoke `security-code-review` on that bundle and use entirely new reviewer agents for the route it returns: `ALL_NO` requires new Standards and Specification reviewers, `ANY_YES` also requires a new Security reviewer, and `UNKNOWN` stops. Do not resume or reuse an earlier reviewer context or verdict.

If two consecutive fresh-review rounds produce new accepted findings initially classified as bounded, the coordinator must reassess whether their combined evidence invalidates the plan before authorising another repair. Apply the same re-planning transition whenever later evidence invalidates a revised plan; do not continue architectural repair inside a stale writer context.

**Repair-only owner-interruption rule:** this rule applies only after an accepted finished-change finding, while determining or executing the next in-scope repair or revised plan. During a `PLAN_INVALIDATING` transition it covers the fresh planner, every plan reviewer, any consolidator, coordinator validation and the resumed writer. Work-selection approval remains valid while the approved outcome, acceptance criteria, scope and settled decisions remain unchanged. Stop for the owner only when existing approved authorities and settled owner decisions do not determine the next repair or revised plan because they leave an unresolved product or scope choice, or a choice involving authentication, personal data, security or privacy, payments, destructive migration or rollback. The coordinator resolves other in-scope technical choices through the required planning and review route. This rule does not apply to work selection, initial planning, ordinary construction, delivery approval or unrelated authority conflicts.

Continue in-scope repair and re-planning automatically under the approved work selection, subject to the repair-only owner-interruption rule.

### Isolation and parallel work

- Start each active delivery ticket from fresh `main` on its own branch and worktree. Leave other checkouts and uncommitted work untouched.
- Assign one writer to each active delivery ticket. Do not split one ticket across concurrent writer branches. The coordinator may integrate only after the worker has stopped writing.
- Parallel implementation across different tickets is allowed only when domain behaviour, files, database migrations and tests are demonstrably separate. If separation is uncertain, work sequentially.
- The GitHub issue owns ticket-specific scope, acceptance criteria, dependencies and references to settled decisions. `CONTEXT.md` supplies domain language and applicable architecture decisions supply technical context. If these sources conflict or appear incorrect, stop, explain the conflict, recommend a resolution and leave the decision with the owner. Only a conflict arising during review repair or re-planning uses the repair-only owner-interruption rule above. Do not add a second progress record.

### Owner decisions and evidence

There are two routine owner decisions:

1. **Work selection:** approve the ticket outcome and acceptance criteria before implementation starts. For high blast-radius work, include the concrete plan required by the change gate below in this decision.
2. **Delivery approval:** review the finished evidence packet before any commit or outward action such as a push, pull request, deployment or merge. Delivery approval must explicitly authorise outward action; [`docs/agents/delivery.md`](docs/agents/delivery.md) defines semantic and persistent approval scope and staleness.

Work-selection approval remains valid through in-scope repair and re-planning only as governed by the repair-only owner-interruption rule under **Review repair and re-planning**. Do not ask the owner to repeat that approval outside the rule's condition.

### External review

Greptile is the sole external reviewer and is best-effort. Every delivery attempts Greptile against the exact current pull-request head and records the attempt as `COMPLETE` or `UNAVAILABLE` under `docs/agents/delivery.md`. No paid plan, billing change, purchase, or upgrade is authorised.

A settled `UNAVAILABLE` attempt is reportable but is not a merge veto once every mandatory internal review, executable verification, exact-head Continuous Integration, conversation-resolution, ownership, tracker, merge and release gate is green. This exception does not relax or replace any of those gates. A `COMPLETE` review requires complete changed-file coverage and an evidence-based disposition for every finding.

The delivery packet contains the acceptance-criteria mapping, diff summary, tests run, review outcome, current screenshots for visible work, security and privacy impact, migration or rollback notes, any known gap, and the settled Greptile attempt state and concise supporting evidence. Greptile supplements the independent review and executable checks; it replaces neither.

### Adding workflow machinery

Add a repository workflow tool or gate only after the same material failure recurs and a test, GitHub protection rule or clearer ticket cannot prevent it more cheaply. Before implementation, state its recurring maintenance cost and the condition for removing it.

## Change gates

Obtain approval of a concrete plan before editing work that is high blast-radius: authentication, payments, personal data, security/privacy boundaries, destructive or irreversible data changes, or a new user-facing behaviour whose design is not established. Plans must name the affected area, expected behaviour, verification, and any migration or rollback implications.

An automatically revised high-blast-radius plan uses the repair-only owner-interruption rule under **Review repair and re-planning**. Initial high-blast-radius planning still requires owner approval of the concrete plan.

Every behaviour change needs proportionate verification. Prefer a test that would fail if the behaviour regressed; for a visible change, run the app and inspect the rendered result. Do not claim success without direct evidence.

Keep changes bounded. For larger work, split implementation into independently testable slices. If a plan proves incomplete or a risk emerges, stop and report it instead of improvising.

Commit, push, open or merge pull requests, and make external tracker changes only when the user explicitly asks. When a process failure reveals a recurring weakness, prefer a deterministic check or test over adding more prose; record a durable project decision only when it is genuinely reusable.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
