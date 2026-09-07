# Triage labels and inferred states

GitHub currently provides these literal triage labels:

| Canonical role | Existing tracker label | Meaning |
| --- | --- | --- |
| `ready-for-agent` | `ready-for-agent` | Fully specified, ready for an away-from-keyboard agent |
| `ready-for-human` | `ready-for-human` | Requires human implementation |
| `wontfix` | `wontfix` | Will not be actioned |

Apply a label only when it exists in the tracker. The board classifier also recognizes literal `needs-triage` and
`needs-info` labels for compatibility, but neither label currently exists in this repository. An unowned,
unblocked open item with no recognized triage label is therefore classified as the inferred `needs-triage` state;
this inference is not an instruction to create or apply that absent label. The existing `question` label is a
general GitHub issue label, not an alias for `needs-info`.

See [`issue-tracker.md`](issue-tracker.md#board-intake) for the complete classification precedence and the separate
lifecycle-drift override.
