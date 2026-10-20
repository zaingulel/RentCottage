"use client";

import { useId, useState } from "react";

import type {
  MarketplaceSuspensionCommand,
  MarketplaceSuspensionCursor,
  MarketplaceSuspensionReadResult,
  MarketplaceSuspensionReleaseSummary,
  MarketplaceSuspensionTarget,
} from "@/administrator-records/marketplace-suspension";
import {
  readMarketplaceSuspension,
  setMarketplaceSuspension,
} from "@/administrator-records/marketplace-suspension-actions";
import { formatInteger, formatIraqDateTime } from "@/i18n/format";
import { marketplaceSuspensionMessages } from "@/i18n/marketplace-suspension-messages";
import { directionFor, type Locale } from "@/i18n/routing";
import {
  ActionButton,
  ActionFeedback,
  ActionFocusTarget,
  ActionLink,
  FormControl,
} from "./interaction-controls";
import { useExclusiveAction } from "./use-exclusive-action";

function ReleaseFacts({
  locale,
  summary,
}: {
  locale: Locale;
  summary: MarketplaceSuspensionReleaseSummary;
}) {
  const copy = marketplaceSuspensionMessages[locale];
  return (
    <dl className="fact-list">
      {(["affected", "resolved", "processing", "quarantined"] as const).map(
        (key) => (
          <div key={key}>
            <dt>{copy[key]}</dt>
            <dd>{formatInteger(summary[key], locale)}</dd>
          </div>
        ),
      )}
    </dl>
  );
}

export function MarketplaceSuspensionControls({
  locale,
  target,
  initial,
}: {
  locale: Locale;
  target: MarketplaceSuspensionTarget;
  initial: MarketplaceSuspensionReadResult;
}) {
  const copy = marketplaceSuspensionMessages[locale];
  const id = useId();
  const [snapshot, setSnapshot] = useState(initial);
  const [reason, setReason] = useState("");
  const [blocked, setBlocked] = useState(initial.status !== "ready");
  const [feedback, setFeedback] = useState<
    | "completed"
    | "retry"
    | "conflict"
    | "unavailable"
    | "refreshed"
    | "invalid"
    | null
  >(initial.status === "ready" ? null : "unavailable");
  const [intent, setIntent] = useState<MarketplaceSuspensionCommand | null>(
    null,
  );
  const { pending, run } = useExclusiveAction();
  async function submit() {
    if (snapshot.status !== "ready" || blocked) return;
    if (!reason.trim() || [...reason.trim()].length > 1000) {
      setFeedback("invalid");
      return;
    }
    await run(async () => {
      try {
        const command: MarketplaceSuspensionCommand = intent ?? {
          target,
          action: snapshot.canSuspend ? "suspend" : "reactivate",
          expectedRevision: snapshot.revision,
          reason: reason.trim(),
          commandId: crypto.randomUUID(),
        };
        setIntent(command);
        const result = await setMarketplaceSuspension({ locale, ...command });
        if (result.status === "completed") {
          setIntent(null);
          setSnapshot(result.target);
          setReason("");
          setFeedback("completed");
        } else if (result.status === "conflict") {
          setIntent(null);
          setBlocked(true);
          setFeedback("conflict");
        } else if (result.status === "invalid") {
          setIntent(null);
          setFeedback("invalid");
        } else if (
          result.status === "access_required" ||
          result.status === "not_found"
        ) {
          setIntent(null);
          setBlocked(true);
          setFeedback("unavailable");
        } else setFeedback("retry");
      } catch {
        setFeedback("retry");
      }
    });
  }
  async function refresh(cursor?: MarketplaceSuspensionCursor) {
    await run(async () => {
      try {
        const next = await readMarketplaceSuspension({
          locale,
          target,
          ...(cursor ? { cursor } : {}),
        });
        if (next.status === "ready") {
          setSnapshot(
            cursor && snapshot.status === "ready"
              ? {
                  ...next,
                  actions: [
                    ...snapshot.actions,
                    ...next.actions.filter(
                      (action) =>
                        !snapshot.actions.some(
                          (loaded) => loaded.id === action.id,
                        ),
                    ),
                  ],
                }
              : next,
          );
          setBlocked(false);
          setFeedback("refreshed");
        } else {
          setBlocked(true);
          setFeedback("unavailable");
        }
      } catch {
        setBlocked(true);
        setFeedback("unavailable");
      }
    });
  }
  return (
    <section
      className="card review-action-card administrator-application-group"
      aria-labelledby={`${id}-title`}
      dir={directionFor(locale)}
    >
      <h2
        className="section-title action-focus-target"
        tabIndex={-1}
        id={`${id}-title`}
      >
        {copy.titles[target.kind]}
      </h2>
      {!pending ? <ActionFocusTarget targetId={`${id}-title`} /> : null}
      <p>{copy.effects[target.kind]}</p>
      <ActionButton
        kind="secondary"
        size="regular"
        type="button"
        pending={pending}
        focusSuccessorId={`${id}-title`}
        onClick={() => void refresh()}
      >
        {copy.refresh}
      </ActionButton>
      {feedback ? (
        <ActionFeedback
          focusTargetId={
            feedback === "invalid" && !pending ? `${id}-feedback` : undefined
          }
          kind={
            feedback === "completed" || feedback === "refreshed"
              ? "success"
              : "error"
          }
        >
          {copy[feedback]}
        </ActionFeedback>
      ) : null}
      {blocked && snapshot.status === "ready" ? <p>{copy.stale}</p> : null}
      {snapshot.status === "ready" ? (
        <>
          <p>
            <span className="status-badge">{copy.states[snapshot.state]}</span>
          </p>
          {snapshot.restrictionReason ? (
            <p>{copy.restrictions[snapshot.restrictionReason]}</p>
          ) : null}
          {snapshot.restrictionReason && snapshot.applicationId ? (
            <ActionLink
              kind="secondary"
              href={`/${locale}/administrator/owner-applications/${snapshot.applicationId}`}
            >
              {copy.reviewApplication}
            </ActionLink>
          ) : null}
          {snapshot.state === "suspended" && snapshot.restorationState ? (
            <p>
              {copy.restoration}: {copy.states[snapshot.restorationState]}
            </p>
          ) : null}
          {snapshot.restorationRestriction &&
          (snapshot.state === "suspended" ||
            (snapshot.state === "paused" &&
              snapshot.restorationState === "paused") ||
            (snapshot.state === "expired" &&
              snapshot.restorationState === "expired")) ? (
            <p>
              {copy.restorationRestrictions[snapshot.restorationRestriction]}
            </p>
          ) : null}
          <p>{copy.retained}</p>
          <div role="group" aria-label={copy.progress}>
            <h3 className="card-title">{copy.progress}</h3>
            <ReleaseFacts locale={locale} summary={snapshot.releaseSummary} />
          </div>
          {snapshot.releaseSummary.quarantined > 0 ? (
            <ActionLink
              kind="secondary"
              href={`/${locale}/administrator/payments`}
            >
              {copy.attention}
            </ActionLink>
          ) : null}
          {!blocked &&
          (intent || snapshot.canSuspend || snapshot.canReactivate) ? (
            <form
              className="administrator-application-actions"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <label htmlFor={`${id}-reason`}>{copy.reason}</label>
              <FormControl
                kind="textarea"
                name="reason"
                id={`${id}-reason`}
                required
                maxLength={1000}
                aria-invalid={feedback === "invalid" || undefined}
                aria-describedby={
                  feedback === "invalid" && !pending
                    ? `${id}-feedback`
                    : undefined
                }
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setIntent(null);
                  setFeedback(null);
                }}
                disabled={pending}
              />
              <ActionButton
                kind="secondary"
                size="regular"
                type="submit"
                width="full"
                key={snapshot.revision}
                focusSuccessorId={`${id}-title`}
                pending={pending}
              >
                {intent && (!pending || feedback === "retry")
                  ? copy.retryAction
                  : snapshot.canSuspend
                    ? copy.suspend
                    : copy.reactivate}
              </ActionButton>
            </form>
          ) : null}
          <section aria-labelledby={`${id}-history`}>
            <h3 className="card-title" id={`${id}-history`}>
              {copy.history}
            </h3>
            {snapshot.actions.length ? (
              <ol>
                {snapshot.actions.map((action) => (
                  <li key={action.id}>
                    <p>{copy.actions[action.action]}</p>
                    <dl className="fact-list">
                      <div>
                        <dt>{copy.actor}</dt>
                        <dd>
                          <bdi>{action.actorUserId}</bdi>
                        </dd>
                      </div>
                      <div>
                        <dt>{copy.auditReason}</dt>
                        <dd>{action.reason}</dd>
                      </div>
                    </dl>
                    <time dateTime={action.createdAt}>
                      {formatIraqDateTime(action.createdAt, locale)}
                    </time>
                    <ReleaseFacts locale={locale} summary={action} />
                  </li>
                ))}
              </ol>
            ) : !blocked ? (
              <p>{copy.noHistory}</p>
            ) : null}
            {snapshot.nextCursor ? (
              <ActionButton
                kind="secondary"
                size="regular"
                type="button"
                pending={pending}
                disabled={blocked}
                focusSuccessorId={`${id}-title`}
                onClick={() => void refresh(snapshot.nextCursor ?? undefined)}
              >
                {copy.older}
              </ActionButton>
            ) : null}
          </section>
        </>
      ) : null}
    </section>
  );
}
