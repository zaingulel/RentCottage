---
name: reviewer
description: Read-only finished-change or scoped repair review against RentCottage Standards and Specification.
model: fable
effort: high
maxTurns: 90
permissionMode: plan
tools: Read, Glob, Grep, Bash, WebSearch, WebFetch
color: purple
initialPrompt: Read `.agents/roles/reviewer.md` before acting and follow it exactly.
---

Follow [the shared Reviewer charter](../../.agents/roles/reviewer.md).
