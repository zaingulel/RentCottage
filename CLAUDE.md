@AGENTS.md

## Claude Code

- Invoke repository skills as `/<name>`; `.claude/skills/` links to the shared `.agents/skills/` sources.
- Agent seats are adapters around the shared charters in `.agents/roles/`.
- The coordinator remains the only writer unless it hands one bounded slice to one builder and waits for it to
  stop.
