# Rulesets on `main`

This page records the two GitHub rulesets on `main` as applied and read back through `gh api` on 9 October 2026. A ruleset is a GitHub setting no commit restores, so this page is the repository's copy of it.

## Decision

The owner decided on 9 October 2026 that RentCottage takes the same rule shape as Fabraik. The repository administrator role may bypass the pull request and the required check on `main`, so a documentation-only change can be pushed straight to `main` through `scripts/gates/pre-push-main`. Force-push and deletion stay blocked for everyone. A bypass applies to a whole ruleset, so the two kinds of rule sit in two rulesets.

## Applied state

The existing ruleset, read with:

```text
gh api repos/zaingulel/RentCottage/rulesets/20966482 --jq '{id, name, target, enforcement, conditions, rules, bypass_actors, current_user_can_bypass}'
```

```json
{"bypass_actors":[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}],"conditions":{"ref_name":{"exclude":[],"include":["refs/heads/main"]}},"current_user_can_bypass":"always","enforcement":"active","id":20966482,"name":"Review-first exact-head quality","rules":[{"parameters":{"allowed_merge_methods":["merge","squash","rebase"],"dismiss_stale_reviews_on_push":false,"require_code_owner_review":false,"require_extra_approval_for_unattributed_changes":true,"require_last_push_approval":false,"required_approving_review_count":0,"required_review_thread_resolution":true,"required_reviewers":[]},"type":"pull_request"},{"parameters":{"do_not_enforce_on_create":false,"required_status_checks":[{"context":"test","integration_id":15368}],"strict_required_status_checks_policy":true},"type":"required_status_checks"}],"target":"branch"}
```

The new ruleset, read with:

```text
gh api repos/zaingulel/RentCottage/rulesets/24795701 --jq '{id, name, target, enforcement, conditions, rules, bypass_actors, current_user_can_bypass}'
```

```json
{"bypass_actors":[],"conditions":{"ref_name":{"exclude":[],"include":["refs/heads/main"]}},"current_user_can_bypass":"never","enforcement":"active","id":24795701,"name":"main: no force-push or deletion","rules":[{"type":"non_fast_forward"},{"type":"deletion"}],"target":"branch"}
```

The rules in force on `main`, read with:

```text
gh api repos/zaingulel/RentCottage/rules/branches/main --jq '[.[] | {type, ruleset_id}]'
```

```json
[{"ruleset_id":20966482,"type":"pull_request"},{"ruleset_id":20966482,"type":"required_status_checks"},{"ruleset_id":24795701,"type":"non_fast_forward"},{"ruleset_id":24795701,"type":"deletion"}]
```

## Who can use the bypass

The collaborators of the repository, read with:

```text
gh api repos/zaingulel/RentCottage/collaborators --jq '[.[] | {login, role_name}]'
```

```json
[{"login":"zaingulel","role_name":"admin"}]
```

The deploy keys of the repository, read with:

```text
gh api repos/zaingulel/RentCottage/keys
```

```json
[]
```

The administrator role is held by one account. The repository has no deploy key. A deploy key with write access, if one is ever added, is admitted by the same bypass.

## What the bypass leaves unguarded

After the change GitHub itself does not stop the owner's account from pushing any commit to `main`, documentation or not. The only check left on a direct push is the local hook with this gate, and a push made with the `--no-verify` flag, or from a clone whose hooks are not switched on, skips it. The hook, the gate and the path definition are all read from the checkout being pushed, so a commit that changes them is judged by its own version of them; for an agent session the owner's permission prompt on `git push` is the last check that does not depend on the pushed content. The owner can also merge a pull request whose `test` check has not passed. A deploy key with write access, if one were ever added, would get the same bypass. Force-push and deletion stay refused for everyone.

## Restoring the earlier setting

Three chained commands put the existing ruleset back to an empty bypass list and delete the new one; each runs only if the one before succeeded, so the new ruleset is deleted only once the bypass is gone:

```text
gh api repos/zaingulel/RentCottage/rulesets/20966482 --jq '{name, target, enforcement, conditions, rules, bypass_actors: []}' > rollback.json &&
gh api -X PUT repos/zaingulel/RentCottage/rulesets/20966482 --input rollback.json &&
gh api -X DELETE repos/zaingulel/RentCottage/rulesets/24795701
```
