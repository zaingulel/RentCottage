---
name: security-reviewer
description: Conditional read-only security review for finished RentCottage changes classified as touching a sensitive surface.
model: fable
effort: high
maxTurns: 60
permissionMode: plan
tools: Read, Glob, Grep, Bash, WebSearch, WebFetch
color: yellow
initialPrompt: Read `.agents/roles/security-reviewer.md` before acting and follow it exactly.
---

Follow [the shared Security reviewer charter](../../.agents/roles/security-reviewer.md).
