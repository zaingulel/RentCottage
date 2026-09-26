---
name: cross-review
description: The fresh reviewer pass for a code diff, run by the model family that did not write it, the Codex reviewer seat from a Claude session and the Claude reviewer seat from a Codex session, dispatched as configured, with its usage quoted in the pull request body.
---

# cross-review

The `resume` skill's review step for the code and sign-off tiers. A writer's own family shares its blind spots,
so the `reviewer` charter runs on the other family. Both seats carry the same charter; this skill chooses which
one and how to call it. Plain single commands from the job worktree, read-only, nothing wrapped.

## 1. Dispatch the other family's seat as configured

Read the seat file and pass its settings unchanged; the manual's model routing rule forbids raising or lowering
them. The read-only sandbox has no network, so the prompt carries the card, body and comments, that the charter's spec lens needs,
and the charter's own `gh` and web calls fail harmlessly. `<out>` is a directory outside the worktree.

**Claude wrote the diff**: the Codex `reviewer` seat, `.codex/agents/reviewer.toml`. Codex's native
`exec review --base` accepts no custom instructions, so the charter goes through plain `codex exec`, read from
a prompt file so quoting cannot bite. The charter returns its findings as its final message; give it no OUTPUT
FILE, and say so, since the sandbox cannot write one. Each step below is one command; the session types each
value it reads as a literal into the later steps.

1. Read the branch, `<branch>`:

   ```sh
   git branch --show-current
   ```

2. Read the seat's `model` and `model_reasoning_effort` from `.codex/agents/reviewer.toml`, `<model>` and
   `<effort>`, at run time; never copy them from anywhere else:

   ```sh
   grep -E '^(model|model_reasoning_effort) = ' .codex/agents/reviewer.toml
   ```

3. Start the prompt file with the charter:

   ```sh
   sed -n '/^developer_instructions = """/,/^"""/p' .codex/agents/reviewer.toml | sed '1d;$d' > <out>/prompt.md
   ```

4. Append the review request:

   ```sh
   printf '\nReview branch %s against main for issue #<issue>, whose card follows. The sandbox has no network,
   so use this copy instead of gh, and return the JSON object as your final message.\n\n' '<branch>' >> <out>/prompt.md
   ```

5. Append the card:

   ```sh
   gh issue view <issue> --json title,body,comments \
     --jq '"# \(.title)\n\n\(.body)\n\n## Comments\n\n" + (.comments | map(.body) | join("\n\n---\n\n"))' >> <out>/prompt.md
   ```

6. Run the reviewer:

   ```sh
   codex exec -m <model> -c model_reasoning_effort=<effort> \
     -s read-only --skip-git-repo-check --ephemeral --json -o <out>/review.json -C . - \
     < <out>/prompt.md > <out>/events.jsonl
   ```

**Codex wrote the diff**: the Claude `reviewer` seat, `.claude/agents/reviewer.md`, which the CLI loads whole,
model, effort, tools and charter. Read `<branch>` with `git branch --show-current` first, then:

```sh
claude -p --agent reviewer --permission-mode plan --output-format json \
  "Review branch <branch> against main for issue #<issue>." > <out>/result.json
```

Read-only is not instruction isolation: the reviewer reads the checkout's manual, rules and skills as its charter
directs, and nothing else is handed to it.

## 2. Settle the findings

The same loop as any reviewer pass: fix true findings, dismiss false ones with a reason, then one pass scoped to
the repaired hunks by the same route. A finding whose remedy is a rewrite of the writer's design is a scope
question for the owner, not a fix; a cross-family reviewer is prone to proposing one.

## 3. Quote the price

Copy the usage into the pull request body's Review section as raw fields, never summed, so cached input is not
counted twice: for Codex, the `turn.completed` event's `usage` in `events.jsonl` (`input_tokens`,
`cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`); for Claude, `usage` and `total_cost_usd` in
`result.json`. A run that fails is reported as failed, never as zero cost.
