# Document index

One line per document, so a reader or agent can find the right one without opening several. The operating
manual is [AGENTS.md](../AGENTS.md).

Kinds: **explanation** describes the system as built; **instruction** tells an agent what to do; **record**
captures a decision or measurement and is never rewritten; **reference** is looked up on demand. Who may edit
each document is set out in [DOC-SWEEP.md](DOC-SWEEP.md); the day-after triage in
[SWEEP-TRIAGE.md](SWEEP-TRIAGE.md) follows the same table.

| Document | Kind | What it is |
|---|---|---|
| [CONTEXT.md](../CONTEXT.md) | explanation | The glossary of canonical marketplace terms. |
| [AI-WORKFLOW.md](AI-WORKFLOW.md) | explanation | How the software factory that builds RentCottage fits together and why it is shaped this way. |
| [CODING-STANDARDS.md](CODING-STANDARDS.md) | instruction | How first-party code is written. |
| [demo.md](demo.md) | instruction | How to start, present, record and recover the local MVP demonstration, and what it shows is delivered. |
| [DOC-SWEEP.md](DOC-SWEEP.md) | instruction | The bounded contract for the documentation sweep and what it may edit. |
| [ISSUE-TRACKER.md](ISSUE-TRACKER.md) | instruction | The tracker and triage vocabulary the vendored intake skills expect: how issues land on GitHub and the board. |
| [SWEEP-TRIAGE.md](SWEEP-TRIAGE.md) | instruction | The bounded contract for the day-after triage: one verdict on every finding the sweep reported. |
| [TESTING-STRATEGY.md](TESTING-STRATEGY.md) | instruction | Which evidence a claim needs and the executed bar it must clear. |
| [agents/domain.md](agents/domain.md) | instruction | How the engineering skills should read the domain glossary and architecture decisions before exploring the code. |
| [engineering/demo-runtime-investigation.md](engineering/demo-runtime-investigation.md) | record | What the evidence shows about the local demo preview failing on Wrangler, and what cause remains unresolved. |
| `adr/` | record | Accepted architecture decisions. |
| `commercial/` | record | Commercial papers for the marketplace business. |
| `discovery/` | record | Client discovery and design exploration written before implementation. |
| `product/` | reference | The approved product agreement with the client and its assets. |
| `research/` | record | Research notes behind product and engineering decisions, each with its date and status. |
