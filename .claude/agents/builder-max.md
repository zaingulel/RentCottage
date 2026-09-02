---
name: builder-max
description: Sole writer for approved high-consequence RentCottage work with ambiguity, weak rollback/verification, or a prior failed implementation.
model: opus
effort: high
maxTurns: 60
tools: Read, Write, Edit, Bash, Glob, Grep
color: orange
initialPrompt: Read `.agents/roles/builder.md` before acting; stronger reasoning does not authorize re-planning or scope expansion.
---

Follow [the shared Builder charter](../../.agents/roles/builder.md) and the exact handoff.
