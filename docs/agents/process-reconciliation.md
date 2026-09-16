# Process reconciliation

Reconcile the processes a job started: development servers, browsers, database containers, watchers, and any
other long-running command a session launched. It reconciles process state on its own and never depends on a
confirmed merge; worktree and branch removal stay with [`closeout`](../../.agents/skills/closeout/SKILL.md).

Run it before normal completion or handoff, and after a recoverable interruption.

1. Read the existing session evidence for each process launched by the job: job, worktree, command, runtime
   session handle, process identifier, start identity, and relevant parent, group, or port. Re-identify the exact
   process and ownership before acting.
2. Gracefully stop each unneeded confirmed-owned process, then verify its exit. Existing authorization rules
   govern any escalation. Preserve active sibling, foreign, and uncertain processes.
3. Record each stopped, retained, or uncertain process with its identity, reason, responsible owner, and next
   action in existing session evidence. A recoverable interruption is reconciled on the next usable session.
