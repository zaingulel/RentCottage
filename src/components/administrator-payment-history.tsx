import type { AdministratorPaymentHistory } from "@/booking-request/administrator-payment-history";
import {
  administratorPaymentHistoryCodeMessages,
  administratorPaymentHistoryMessages,
} from "@/i18n/administrator-payment-history-messages";
import { formatFilsAsIqd } from "@/i18n/format";
import type { Locale } from "@/i18n/routing";
import styles from "./administrator-payment-history.module.css";

function formatTime(locale: Locale, value: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Baghdad",
  }).format(new Date(value));
}

function localizedCode(locale: Locale, code: string) {
  const messages = administratorPaymentHistoryCodeMessages[locale] as Record<
    string,
    string
  >;
  return messages[code] ?? messages["unclassified-evidence"];
}

export function AdministratorPaymentHistoryView({
  locale,
  history,
}: {
  readonly locale: Locale;
  readonly history: AdministratorPaymentHistory;
}) {
  const copy = administratorPaymentHistoryMessages[locale];
  return (
    <section className={styles.history} aria-labelledby="payment-history-title">
      <header className="page-heading">
        <h1 className="page-title" id="payment-history-title">
          {copy.title}
        </h1>
        <bdi className={styles.reference}>
          {history.bookingRequestReference}
        </bdi>
        <p>{copy.simulated}</p>
      </header>
      {history.historyCoverage === "retained-evidence-only" ? (
        <p className={styles.notice} role="note">
          {copy.coverage}
        </p>
      ) : null}
      <section
        className={`card ${styles.current}`}
        aria-labelledby="payment-current-title"
      >
        <h2 className="section-title" id="payment-current-title">
          {copy.current}
        </h2>
        <p className={styles.currentStatus}>
          <span>{copy.request}:</span>{" "}
          <bdi>{localizedCode(locale, history.current.requestStatus)}</bdi>
        </p>
        <p className={styles.currentStatus}>
          <span>{copy.payment}:</span>{" "}
          <bdi>
            {history.current.paymentStatus
              ? localizedCode(locale, history.current.paymentStatus)
              : copy.notRecorded}
          </bdi>
        </p>
        <dl className="fact-list">
          {history.current.paymentRequiredDeadline ? (
            <div>
              <dt>{copy.deadline}</dt>
              <dd>
                <time dateTime={history.current.paymentRequiredDeadline}>
                  {formatTime(locale, history.current.paymentRequiredDeadline)}
                </time>
              </dd>
            </div>
          ) : null}
          {history.current.expiryStatus ? (
            <div>
              <dt>{copy.expiry}</dt>
              <dd>
                <bdi>{localizedCode(locale, history.current.expiryStatus)}</bdi>
              </dd>
            </div>
          ) : null}
          {history.current.reasonCode ? (
            <div>
              <dt>{copy.reason}</dt>
              <dd>
                <bdi>{localizedCode(locale, history.current.reasonCode)}</bdi>
              </dd>
            </div>
          ) : null}
        </dl>
      </section>
      <section aria-labelledby="payment-events-title">
        <h2 className="section-title" id="payment-events-title">
          {copy.history}
        </h2>
        <p>{copy.timeZone}</p>
        {history.events.length ? (
          <ol className={styles.events}>
            {history.events.map((event) => (
              <li key={event.id} className={`card ${styles.event}`}>
                <div className={styles.eventTitle}>
                  <h3 className="card-title">
                    <bdi>{localizedCode(locale, event.kind)}</bdi>
                  </h3>
                  <span className="status-badge">
                    <bdi>
                      {localizedCode(
                        locale,
                        event.outcome ?? event.toState ?? event.provenance,
                      )}
                    </bdi>
                  </span>
                </div>
                <dl className="fact-list">
                  {event.operationKind ? (
                    <div>
                      <dt>{copy.operation}</dt>
                      <dd>
                        <bdi>{localizedCode(locale, event.operationKind)}</bdi>
                      </dd>
                    </div>
                  ) : null}
                  {event.reasonCode ? (
                    <div>
                      <dt>{copy.reason}</dt>
                      <dd>
                        <bdi>{localizedCode(locale, event.reasonCode)}</bdi>
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>{copy.provenance}</dt>
                    <dd>{localizedCode(locale, event.provenance)}</dd>
                  </div>
                  {event.fromState ? (
                    <div>
                      <dt>{copy.fromState}</dt>
                      <dd>{localizedCode(locale, event.fromState)}</dd>
                    </div>
                  ) : null}
                  {event.toState ? (
                    <div>
                      <dt>{copy.toState}</dt>
                      <dd>{localizedCode(locale, event.toState)}</dd>
                    </div>
                  ) : null}
                  {event.operationGeneration !== undefined ? (
                    <div>
                      <dt>{copy.operationGeneration}</dt>
                      <dd>{event.operationGeneration}</dd>
                    </div>
                  ) : null}
                  {event.recoveryGeneration !== undefined ? (
                    <div>
                      <dt>{copy.recoveryGeneration}</dt>
                      <dd>{event.recoveryGeneration}</dd>
                    </div>
                  ) : null}
                  {event.providerOccurredAt ? (
                    <div>
                      <dt>{copy.providerOccurredAt}</dt>
                      <dd>
                        <time dateTime={event.providerOccurredAt}>
                          {formatTime(locale, event.providerOccurredAt)}
                        </time>
                      </dd>
                    </div>
                  ) : null}
                  {event.receivedAt ? (
                    <div>
                      <dt>{copy.receivedAt}</dt>
                      <dd>
                        <time dateTime={event.receivedAt}>
                          {formatTime(locale, event.receivedAt)}
                        </time>
                      </dd>
                    </div>
                  ) : null}
                  {event.sourceRecordedAt ? (
                    <div>
                      <dt>{copy.sourceRecordedAt}</dt>
                      <dd>
                        <time dateTime={event.sourceRecordedAt}>
                          {formatTime(locale, event.sourceRecordedAt)}
                        </time>
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>{copy.recordedAt}</dt>
                    <dd>
                      <time dateTime={event.recordedAt}>
                        {formatTime(locale, event.recordedAt)}
                      </time>
                    </dd>
                  </div>
                </dl>
                <dl className="fact-list">
                  <div>
                    <dt>{copy.eventReference}</dt>
                    <dd>
                      <bdi>{event.id}</bdi>
                    </dd>
                  </div>
                  {[
                    [copy.providerOperation, event.providerOperationId],
                    [copy.providerRequest, event.providerRequestId],
                    [copy.movementReference, event.movementReference],
                  ].map(([label, value]) =>
                    value ? (
                      <div key={label}>
                        <dt>
                          {value.startsWith("internal-")
                            ? copy.internalSupportReference
                            : label}
                        </dt>
                        <dd>
                          <bdi>
                            {value === "reference-unavailable"
                              ? localizedCode(locale, value)
                              : value}
                          </bdi>
                        </dd>
                      </div>
                    ) : null,
                  )}
                  {event.logicalOperationId ? (
                    <div>
                      <dt>{copy.logicalOperation}</dt>
                      <dd>
                        <bdi>
                          {event.logicalOperationId === "reference-unavailable"
                            ? localizedCode(locale, event.logicalOperationId)
                            : event.logicalOperationId}
                        </bdi>
                      </dd>
                    </div>
                  ) : null}
                  {event.physicalAttemptId ? (
                    <div>
                      <dt>{copy.physicalAttempt}</dt>
                      <dd>
                        <bdi>
                          {event.physicalAttemptId === "reference-unavailable"
                            ? localizedCode(locale, event.physicalAttemptId)
                            : event.physicalAttemptId}
                        </bdi>
                      </dd>
                    </div>
                  ) : null}
                  {event.providerReference ? (
                    <div>
                      <dt>
                        {event.providerReference.startsWith("internal-")
                          ? copy.internalSupportReference
                          : copy.providerReference}
                      </dt>
                      <dd>
                        <bdi>
                          {event.providerReference === "reference-unavailable"
                            ? localizedCode(locale, event.providerReference)
                            : event.providerReference}
                        </bdi>
                      </dd>
                    </div>
                  ) : null}
                  {event.amountFils ? (
                    <div>
                      <dt>{copy.amount}</dt>
                      <dd>
                        <bdi dir="ltr">
                          {formatFilsAsIqd(BigInt(event.amountFils), locale)}
                        </bdi>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </li>
            ))}
          </ol>
        ) : (
          <div className="empty-state">
            <p>{copy.empty}</p>
          </div>
        )}
      </section>
    </section>
  );
}
