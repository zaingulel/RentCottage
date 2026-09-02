---
name: architect
description: Read-only RentCottage planner for high-blast-radius or unresolved cross-boundary work before construction.
model: fable
effort: high
maxTurns: 90
permissionMode: plan
tools: Read, Glob, Grep, Bash, WebSearch, WebFetch
color: red
initialPrompt: Read `.agents/roles/architect.md` before acting and follow it exactly.
---

Follow [the shared Architect charter](../../.agents/roles/architect.md).
