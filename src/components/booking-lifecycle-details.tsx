import type {
  BookingLifecycle,
  BookingCompletionEligibility,
} from "@/booking-request/booking-lifecycle";
import type { BookingParticipantRole } from "@/booking-request/booking-financial-view";
import { bookingLifecycleMessages } from "@/i18n/booking-lifecycle-messages";
import { formatIraqDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n/routing";
import { BookingManagementControl } from "./booking-management-controls";
import styles from "./booking-financial-details.module.css";
export function BookingLifecycleDetails({
  locale,
  reference,
  bookingReference,
  actorRole,
  lifecycle,
  eligibility,
}: {
  locale: Locale;
  reference: string;
  bookingReference: string;
  actorRole: BookingParticipantRole;
  lifecycle: BookingLifecycle;
  eligibility: BookingCompletionEligibility;
}) {
  const c = bookingLifecycleMessages[locale];
  return (
    <section aria-label={c.title}>
      <header>
        <h2>{c.title}</h2>
        <p>
          <strong>{c[lifecycle.status]}</strong>
        </p>
        <p>
          <bdi>{bookingReference}</bdi>
        </p>
      </header>
      {eligibility.status !== "unavailable" ? (
        <p>
          {c.periodEnd}:{" "}
          <time dateTime={eligibility.effectivePeriodEnd}>
            {formatIraqDateTime(eligibility.effectivePeriodEnd, locale)}
          </time>
        </p>
      ) : null}
      {lifecycle.status === "no_show" ? <p>{c.noRefund}</p> : null}
      {actorRole === "customer" ? (
        <p>
          {eligibility.status === "completed" &&
          eligibility.reviewAvailable &&
          eligibility.reviewExpiresAt ? (
            <>
              {c.reviewOpen}{" "}
              <time dateTime={eligibility.reviewExpiresAt}>
                {formatIraqDateTime(eligibility.reviewExpiresAt, locale)}
              </time>
            </>
          ) : (
            c.reviewClosed
          )}
        </p>
      ) : (
        <p>
          {eligibility.payoutPrerequisiteAvailable
            ? c.payoutReady
            : c.payoutPending}{" "}
          <small>{c.payoutHelp}</small>
        </p>
      )}
      {actorRole === "platform_administrator" ? (
        <>
          {lifecycle.noShow ? (
            <section aria-label={c.noShowAttribution}>
              <h3>{c.noShowAttribution}</h3>
              <p dir="auto">{lifecycle.noShow.reason}</p>
              <p>
                {c.actor}: <bdi>{lifecycle.noShow.actorUserId}</bdi> ·{" "}
                {formatIraqDateTime(lifecycle.noShow.recordedAt, locale)}
              </p>
            </section>
          ) : null}
          <section aria-label={c.incidents}>
            <h3>{c.incidents}</h3>
            <ul className={styles.history}>
              {lifecycle.incidents?.map((incident) => (
                <li key={`${incident.source}:${incident.id}`}>
                  <strong>
                    {incident.source === "cancellation"
                      ? c.cancellationSource
                      : c.lifecycleSource}
                  </strong>
                  <p dir="auto">{incident.narrative}</p>
                  <p>
                    {c.actor}: <bdi>{incident.actorUserId}</bdi> ·{" "}
                    {formatIraqDateTime(incident.recordedAt, locale)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
          {lifecycle.status === "confirmed" ? (
            <BookingManagementControl
              key={`no-show-${reference}`}
              locale={locale}
              reference={reference}
              actorRole={actorRole}
              action="no_show"
              commandId={crypto.randomUUID()}
            />
          ) : null}
        </>
      ) : null}
      {actorRole !== "customer" ? (
        <BookingManagementControl
          key={`incident-${reference}`}
          locale={locale}
          reference={reference}
          actorRole={actorRole}
          action="incident"
          commandId={crypto.randomUUID()}
        />
      ) : null}
    </section>
  );
}
