# Git hooks (committed, deterministic gates)

These hooks catch repeated workflow mistakes before they reach hosted Continuous Integration (CI).

| Hook               | What it enforces                                                                                                                                      | Bypass                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `pre-commit`       | Advises on documentation rot and blocks malformed or divergent staged Claude/Codex agent definitions using the staged validator and raw staged blobs. | `git commit --no-verify` |
| `pre-merge-commit` | Runs `pre-commit` for a merge that would auto-commit.                                                                                                 | `git merge --no-verify`  |
| `pre-push`         | Runs lint when installed and the complete `scripts/lib` Node test suite; `RUN_TESTS=1 git push` also runs the repository test command.                | `git push --no-verify`   |

## Activation

The hooks travel with the repository but are not activated merely by being tracked or by installing dependencies.
Activation is a manual, intentional repository operation. Before activating them, read and retain the prior value
so it can be restored; then set and read back the exact configured path. A failed set or read-back is a failure and
must not be swallowed:

```bash
git config --get core.hooksPath
git config core.hooksPath .githooks
test "$(git config --get core.hooksPath)" = .githooks
```

Hosted CI calls the repository verification interface independently and does not trust local hooks as proof.
