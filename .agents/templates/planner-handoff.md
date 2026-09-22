<!--
Planner handoff template. Everything below the ---8<--- line is the shared prompt for
architect dispatches. Fill every {{SLOT}} before dispatch; the prompt-side handoff
checker rejects an incomplete contract.

After one bounded non-delivery, the orchestrator narrows once or finishes inline, except that a card the
architect judges too big, or a plan past the split threshold in the `resume` skill's Plan section, goes to the
owner as a split proposal and is never narrowed or finished inline.
Never escalate to oracle merely because the architect did not deliver.
-->

---8<---
Decision: {{DECISION}}
Scope: {{SCOPE}}
Discovery: {{DISCOVERY}}
Judgment: {{JUDGMENT}}
Deliverable: {{DELIVERABLE}}
Stop condition: {{STOP_CONDITION}}

Standing instructions:

- Answer only this decision. Do not broaden the scope or propose adjacent work.
- If the evidence is insufficient, stop with the specific caveat instead of broadening the investigation.
