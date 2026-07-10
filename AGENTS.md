## Agent skills

### Issue tracker

GitHub Issues in `zaingulel/RentCottage`; external PRs are not triaged. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five standard labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout. See `docs/agents/domain.md`.

## Working method

Start a substantive work session with `$resume`; end or park it with `$handoff`. Treat Git and direct verification as the record of what is shipped, and the configured issue tracker as the live plan. Do not rely on chat history or a status document when they conflict with Git.

For a substantial change, state the route before editing:

- **Inline** for a trivial, well-bounded change.
- **Exploration** for read-heavy discovery; delegate only independent, bounded reading when it preserves useful main-thread context.
- **Plan → build → review** for cross-cutting work, a change with unclear direction, data-model changes, security/privacy work, or a substantial user-facing behaviour.

Use the installed skills rather than reproducing their methods: `codebase-design` / `to-spec` / `grill-with-docs` for design, `tdd` for implementation, `code-review` before completing substantive code changes, and `diagnosing-bugs` for hard or repeated failures.

## Change gates

Obtain approval of a concrete plan before editing work that is high blast-radius: authentication, payments, personal data, security/privacy boundaries, destructive or irreversible data changes, or a new user-facing behaviour whose design is not established. Plans must name the affected area, expected behaviour, verification, and any migration or rollback implications.

Every behaviour change needs proportionate verification. Prefer a test that would fail if the behaviour regressed; for a visible change, run the app and inspect the rendered result. Do not claim success without direct evidence.

Keep changes bounded. For larger work, split implementation into independently testable slices. If a plan proves incomplete or a risk emerges, stop and report it instead of improvising.

Commit, push, open or merge pull requests, and make external tracker changes only when the user explicitly asks. When a process failure reveals a recurring weakness, prefer a deterministic check or test over adding more prose; record a durable project decision only when it is genuinely reusable.
