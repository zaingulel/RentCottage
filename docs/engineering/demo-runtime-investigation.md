# Demo runtime investigation

Issue [#224](https://github.com/zaingulel/RentCottage/issues/224) records a controlled refresh of the local meeting demo after the retained preview failed twice on Wrangler 4.122.0. The refresh preserved the synthetic demo database and used current `main` source. This note separates what the evidence demonstrates from the initiating connection-loss cause, which remains unresolved.

## Prior issue #208 evidence: retained failures and the shipped repair

The historical and release-comparison results in this section were produced by issue #208 and are reused here as prior evidence. Issue #224 did not rerun or reconstruct them.

| Runtime | Observation | What it establishes | Limitation |
| --- | --- | --- | --- |
| Wrangler 4.122.0, Node.js 26 | On unchanged commit `ef890427`, the retained demo log recorded `ProxyController` → `ProxyWorker` → `Network connection lost` at 07:47:03Z on 10 September 2026 during ordinary role/home navigation. The demo owner reported that the preview exited. | The local preview could promote this proxy failure to a fatal runtime error without issue #208 diagnostic changes. | There is no independent wrapper receipt with an exact exit status. Earlier dynamic-rendering messages are separate observations with no established causal link. |
| Wrangler 4.122.0, Node.js 26 | A second retained preview log recorded the same fatal chain at 11:19:32Z on 10 September 2026 after 12,564,619 ms of Wrangler command duration. Wrangler recorded the command as errored. | The first failure was not the only occurrence, and the failure could happen after several hours of serving. | The log does not contain an independent terminal or wrapper exit receipt. It establishes the Wrangler error, not the eventual process exit status or initiating cause. |
| Exact Wrangler 4.122.0 and 4.130.0 package methods | An offline differential passed the same serialized proxy error through both published implementations. Version 4.122.0 emitted a fatal error and rejected teardown; 4.130.0 logged the underlying failure without emitting that fatal error. Unrelated runtime errors remained fatal in both controls. | Wrangler 4.130.0 contains the demonstrated upstream fatal-handling repair. | This source-level differential did not start a server or reproduce a live transport loss. It does not show why the connection was lost. |
| Wrangler 4.130.0 reconstructed journey | A prior controlled run temporarily restored the historical detail-prefetch trigger. Four prefetch requests completed, detail navigation succeeded, downstream health returned 200, and the focused wrapper exited 0. | The supported release served that reconstructed journey successfully. | No connection loss or recovery warning occurred, so the repaired branch was not exercised and the initiating race was not shown to be removed. |
| Wrangler 4.130.0 original application observation for PR #219 | The paid-booking prefetch case encountered two first-attempt proxy connection losses. Wrangler's existing recovery returned HTTP 200 for both and the case passed in 23.1 seconds. | The supported runtime exercised its recovery and prevented the observed proxy losses from becoming a fatal preview exit. | The initiating upstream race still occurred. A recovered request is evidence of bounded handling, not elimination of the connection fault or proof of indefinite meeting uptime. |

The current repository pins Wrangler 4.130.0. Its upstream handling changes the consequence of the captured proxy failure, but the retained evidence does not prove that the original transport race, historical socket reset, operating-system permission denial, or cleanup deadline has disappeared.

Prior issue #208 sources retained outside this job worktree:

- [PR #219: Fix local process cleanup and scheduled trigger connections](https://github.com/zaingulel/RentCottage/pull/219)
- First old-runtime raw log: `/private/tmp/rentcottage-213-wrangler-logs/wrangler-2026-09-10_07-35-24_953.log`
- Second old-runtime raw log: `/private/tmp/rentcottage-213-wrangler-logs/wrangler-2026-09-10_07-50-08_006.log`
- Archived release comparison: `/Users/zain/Developer/Codex/RentCottage/.agent-evidence/investigations/issue-208-20260910/release-comparison.md`

## Current controlled rehearsal

Current `main` commit `239e99c` was installed and rebuilt in the issue #224 worktree. `npm ci` completed with 741 packages. The recorded `issue224 current Worker build` command exited 0. The host used Node.js 26.5.0, matching the old failure runs at the major-version level; the repository requests Node.js 24 in `.nvmrc`, which was unavailable on this execution path. This version mismatch must remain visible when comparing results.

The preserved `rentcottage-demo` volumes started without a schema delta. The preview was launched with the repository's `npm run preview` path, the test environment, scheduled-test support, a loopback address and port 8789. Its owned process group was 32189; `workerd` process 32263 began listening at 19:20:01Z on 10 September 2026. Environment values and credentials are intentionally omitted. The exact bounded commands were:

- `npm ci --no-audit --no-fund`
- `npm run run-log -- issue224 current Worker build -- npm run build:worker`
- `WRANGLER_LOG_PATH=/private/tmp/rentcottage-224-wrangler-logs WRANGLER_REGISTRY_PATH=/private/tmp/rentcottage-224-wrangler-registry npm run run-log -- issue224 normal browser preview -- npm run preview -- --env test --test-scheduled --ip 127.0.0.1 --port 8789`
- `npm run run-log -- issue224 transport and preview preservation -- npx vitest run scripts/trigger-scheduled.test.mjs scripts/playwright-config.test.mjs --retry=0`
- `npm run run-log -- issue224 simulated scheduled capture -- curl --fail --silent --show-error 'http://127.0.0.1:8789/__scheduled?cron=%2A%20%2A%20%2A%20%2A%20%2A'`

The rehearsal used the normal Codex in-app browser against that Worker preview. It retained the original pending meeting request on 20 October and opened the 22 October morning shift through the owner interface for the new synthetic journey. The browser then completed these checkpoints:

1. Created synthetic customer request `RC-REQ-3F80CD10D7A8496C` and opened its detail page.
2. Reverified the Cottage Owner, accepted the request, and observed payment pending.
3. Ran the existing scheduled-capture path once; the recorded `issue224 simulated scheduled capture` command exited 0.
4. Opened the confirmed owner detail for the same reference and observed IQD 180,000 Booking Price, IQD 18,000 Marketplace Commission, IQD 162,000 Cottage Owner net, and the synthetic access details.
5. Confirmed that the customer detail returned 404 while the owner session was active, preserving the expected role boundary. The customer was reverified through an available 21 October quote without submitting another request, after which the existing confirmed detail opened successfully.
6. Opened the customer confirmation for the same reference and observed IQD 180,000 booking price plus the IQD 5,000 Customer Service Fee, IQD 185,000 total, and the matching synthetic private details.

An independent database read found confirmation `04089db2-8ce1-4a2d-b29d-ee8e8fc7e1b0` at 19:25:46Z on 10 September 2026 and exactly two matching receipts, one for the Cottage Owner and one for the customer. After the new journey, the preserved database contained 9 accounts, 7 requests, 6 confirmations and 12 receipts. No existing record was reset or deleted. The existing 20 October request remained persisted, although the normal scheduled handler could legitimately expire a due request; this rehearsal therefore does not claim that every pre-existing status remained unchanged.

The normal browser date fields required native Arrow Up or Arrow Down input to commit their React state. The first 20 October search correctly returned no available result because the historical pending meeting request still occupied it; the owner opened the 22 October morning shift for the new request instead.

The browser remained idle on the customer confirmation from 19:28:52Z until 19:30:04Z on 10 September 2026. After those 72 seconds, Booking History and the exact new request link still opened the Confirmed Booking customer page; the resulting page was visually inspected. The same `workerd` listener, process 32263, served the entire journey. This proves a bounded idle/resume in the normal Codex in-app browser. It does not test machine sleep or indefinite runtime stability.

The Worker preview ran from 19:20:01Z to 19:30:54Z, a total exposure of 10 minutes 53 seconds; the browser first opened the home page at about 19:20:20Z. Final inspection of the complete retained preview log counted zero `Error in ProxyController`, `Network connection lost`, or `[ERROR]` markers. This marker count does not assert the universal absence of every possible runtime warning or error, and no connection fault was exercised in this run. The focused preservation observer, 22 tests across two files with retries disabled, passed under the `issue224 transport and preview preservation` label.

At 19:30:54Z the coordinator sent an intentional `SIGINT` to verified process group 32189. The independent preview session returned exit 130, which records the operator stop rather than a crash; the preview has no run-log receipt because the whole recorded group was deliberately interrupted. Processes 32263 and 32265 and listener 8789 were then absent. `npm run run-log -- issue224 preserve demo shutdown -- node_modules/.bin/supabase stop --project-id rentcottage-demo --workdir /Users/zain/Developer/Codex/RentCottage/.demo` exited 0 at 19:31:14Z. No demo containers remained, and the three named `rentcottage-demo` volumes were retained.

This bounded rehearsal supports continuing with the current Worker preview for the next meeting. It does not justify another runtime repair: the run did not exercise a remaining fault, it did not prove that the initiating upstream connection race was eliminated, and it did not test machine sleep.

## Serving choice for the next meeting

The current repository path is the supported choice for the next rehearsal: build with `opennextjs-cloudflare build`, then serve through `opennextjs-cloudflare preview`. The OpenNext CLI documents that preview launches a local server through `wrangler dev`, and Cloudflare documents that this path serves the adapted application in the Workers runtime. That gives the closest available local match to the deployed runtime and exercises the project's Worker configuration and bindings.

`next dev` is the supported fast development server with hot reload. `next start` is the supported production-mode Node.js server after `next build`. Both are useful Next.js serving paths, but neither runs the adapted application in the Cloudflare Workers runtime. There is no verified full Worker-parity case for replacing the meeting preview with `next start`; in particular, this investigation did not establish parity for Worker bindings, scheduled execution, or the simulated payment path. Changing the serving approach therefore remains a separate proposal rather than a result of this investigation.

Official references:

- [Cloudflare OpenNext adapter guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/)
- [OpenNext Cloudflare development and preview workflow](https://opennext.js.org/cloudflare/howtos/dev-deploy)
- [OpenNext Cloudflare CLI preview command](https://opennext.js.org/cloudflare/cli)
- [Next.js command-line interface](https://nextjs.org/docs/pages/api-reference/cli/next)

## Recovery and evidence boundaries

The detailed meeting walkthrough remains owned by issue [#213](https://github.com/zaingulel/RentCottage/issues/213) in its retained `docs/demo.md`; use that copy rather than duplicating or silently changing its script here.

If the preview stops during a meeting:

1. Preserve the browser state and synthetic database. Do not reset the database, delete volumes, or repeat payment actions to obtain a green result.
2. Record the last successful browser step, UTC timestamp, preview command label, listener/process identity, and whether the log contains the known proxy chain. Record the command's exit code or signal only when an independent receipt supplies it.
3. Rebuild current source before a controlled restart when build provenance is uncertain. Start one clearly owned Worker preview on the documented loopback port and verify its health before continuing.
4. Re-open the existing request by its synthetic reference and inspect the persisted request, confirmation and receipt state before deciding which walkthrough step is safe to resume. Durable database state is the business oracle; a missing browser response does not prove that a payment action did not complete.
5. Stop after repeated observations add no evidence. Keep a green restart, an exercised recovery, and an unresolved initiating cause as separate conclusions.

This investigation does not authorize a new framework, retry policy, supervisor, production action, real payment provider, or destructive cleanup. A future causal repair requires one reproducible trigger, one changed variable, and retry-disabled red/restored-green evidence at the public seam.
