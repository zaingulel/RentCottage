---
name: writing-great-skills
description: How to write documents an agent consumes.
disable-model-invocation: true
---

Reference for writing any document an agent consumes — a skill, `CLAUDE.md`, a doc reached by a pointer. The root
virtue is **predictability**: the agent taking the same _process_ every run. Design terms live in
`/codebase-design`; domain terms in root `CONTEXT.md`.

## Context pointers

A **context pointer** names out-of-context material and encodes the condition for reaching it (a skill
description, a `CLAUDE.md` line naming a doc). The pointer's _wording_ decides when the agent reaches the
material: sharpen a weak pointer before inlining its target. A pointer states what the material is and lists the
**branches** that trigger reaching it (a branch is a distinct case the document handles). Always-loaded pointers
earn the hardest pruning: front-load the leading word; one trigger per branch (collapse synonyms); cut identity
the body already carries.

## The two loads

- **Context load**: always-loaded material spending tokens and attention every turn.
- **Cognitive load**: the human remembering which documents exist and when to reach each — the price of human
  agency; spend it where human judgement matters.

Pointer-reached material escapes context load at the price of the pointer's line; unpointed material rides
entirely on cognitive load.

## Information hierarchy

Documents mix **steps** (ordered actions) and **reference** (rules and facts consulted on demand). Place each
piece on the ladder: (1) in-file step; (2) in-file reference — a flat peer-set is fine; (3) disclosed reference in
a separate file behind a pointer. **Progressive disclosure** is the move down the ladder; branching is the test:
inline what every branch needs, disclose what only some branches reach. In-file reference that should be disclosed
buries the steps. **Co-location**: keep a concept's definition, rules, and caveats under one heading; scattered
material fragments one meaning across many places. **Sprawl** — a document simply too long even when every line is
live — is cured by the ladder and by splitting per branch or sequence.

## Steps and completion criteria

Every step ends on a **completion criterion**. Two levers: **clarity** (a vague bound invites premature
completion — sharpen the bound first; hide later steps only across a real context boundary and only if a rush is
observed) and **demand** ("every modified model accounted for" forces thorough **legwork** where "produce a change
list" does not; "every rule applied" binds flat reference the same way). The strongest criteria are checkable and
exhaustive.

## When to split

Splitting spends one of the two loads, so split only when the cut earns it: **by sequence**, when post-completion
steps tempt the agent to rush the current one; **by invocation** (see Skill mechanics).

## Leading words

A **leading word** is a compact pretrained concept the agent thinks with (_lesson_, _tracer bullet_, _red_),
repeated as a token, anchoring behaviour in few tokens; a coined word recruits no priors, so prefer an existing
one. It anchors execution in the body and invocation in a pointer (shared language across prompts, docs, and
codebase fires the pointer reliably). Hunt for restatements a leading word collapses: "fast, deterministic,
low-overhead" → _tight_; "a loop you believe in" → _red_.

**Negation** is the failure mode beside this lever: prohibition drags the forbidden behaviour into context and
makes it more available. Prompt the **positive** target; a prohibition earns its place only as a hard guardrail
you cannot phrase positively, paired with the positive target.

## Pruning

- **Single source of truth** per meaning; when a lesson lands as wording, replace the old sentence, never append a
  caveat beside it. Duplication costs maintenance and tokens and inflates a meaning's rank.
- The **environment** is a source of truth too (`package.json`, config, `--help`); a document restating it is a
  **cache**, earning its load only when the lookup is expensive. Cache the unwritten convention and the gotcha no
  config confesses; leave one-command lookups to the environment.
- Check every line for **relevance**; without pruning, the default fate is **sediment** — stale layers that settle
  because adding feels safe.
- Hunt **no-ops**: an instruction the model already obeys by default. The test is model-relative — settle
  disagreement by running the document. Delete the whole failing sentence. A leading word too weak to beat the
  default (_be thorough_) is a no-op; the fix is a stronger word (_relentless_).

## Skill mechanics

- **Model-invoked**: keeps a `description` (a permanently loaded context pointer) so the agent and other skills
  can reach it; also the home for shared reference another skill invokes. Omit `disable-model-invocation`; write a
  model-facing description carrying the trigger branches. Model-invocation includes user reach; set
  `user-invocable: false` only when the workflow must never start by hand.
- **User-invoked**: set `disable-model-invocation: true`; only the human can invoke it and no other skill can.
  Zero context load, spends cognitive load; the `description` becomes a human-facing one-liner.

Pick model-invocation only when the agent must reach the skill on its own, or another skill must; anything only
ever fired by hand stays user-invoked. `disable-model-invocation` is a Claude-surface mechanic: Codex has no
equivalent, so the key is inert in an `.agents/skills/` mirror and the user-invoked posture there is carried by
the skill's own defer-to-the-human wording.

A skill needing a user-invoked skill's work must **defer to the human, never imperatively invoke it** ("suggest
the owner run X", not "run X") — the imperative silently no-ops (`scripts/doc-lint.mjs` flags these). Shared
reference two user-invoked skills need lives in neither: push it to a plain file outside the skill system.

**Splitting by invocation**: split off a model-invoked skill when you have a distinct leading word that should
trigger it on its own, a trigger word you actually use in your prompts, or another skill must reach it; the new
always-loaded description must be worth that reach. When user-invoked skills multiply past memory, cure the piled
cognitive load with a **router skill**: one user-invoked skill shaped as a short decision table (symptom → skill)
that hints, never fires. RentCottage has none yet; split one out when `.agents/skills/` grows past memory, not
speculatively.
