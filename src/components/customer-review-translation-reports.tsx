import { administratorAccessHref } from "@/access/return-destination";
import type {
  CustomerReviewTranslationReport,
  CustomerReviewTranslationReportListResult,
} from "@/customer-review/customer-review";
import { administratorRecordsMessages } from "@/i18n/administrator-records-messages";
import { customerReviewMessages } from "@/i18n/customer-review-messages";
import { formatIraqDateTime } from "@/i18n/format";
import { directionFor, type Locale } from "@/i18n/routing";

import { BackofficeNavigation } from "./backoffice-navigation";
import styles from "./customer-reviews.module.css";
import { ActionFeedback, ActionLink } from "./interaction-controls";

function ReportCard({
  locale,
  report,
}: {
  locale: Locale;
  report: CustomerReviewTranslationReport;
}) {
  const copy = customerReviewMessages[locale];
  return (
    <article className={`card ${styles.card} ${styles.administratorCard}`}>
      <h2 className="card-title">
        {report.subject === "reply"
          ? copy.ownerReply
          : copy.translatedReviewText}
      </h2>
      <dl className="fact-list">
        <div>
          <dt>{copy.bookingReference}</dt>
          <dd>
            <bdi>{report.bookingRequestReference}</bdi>
          </dd>
        </div>
        <div>
          <dt>{copy.translationReportedAt}</dt>
          <dd>
            <time dateTime={report.reportedAt}>
              {formatIraqDateTime(report.reportedAt, locale)}
            </time>
          </dd>
        </div>
        <div>
          <dt>{copy.translationSource}</dt>
          <dd>
            <span>{report.provider}</span>
            <span>{report.model}</span>
            <span>{report.promptVersion}</span>
          </dd>
        </div>
      </dl>
      <p lang={report.originalLanguage} dir="auto">
        {report.originalBody}
      </p>
      <p className="translation-label">
        {copy.automaticTranslation} · {copy.fictionalTranslation}
      </p>
      <p lang={report.targetLanguage} dir={directionFor(report.targetLanguage)}>
        {report.translatedBody}
      </p>
    </article>
  );
}

export function CustomerReviewTranslationReports({
  locale,
  result,
  continued,
}: {
  locale: Locale;
  result: CustomerReviewTranslationReportListResult;
  continued: boolean;
}) {
  const copy = customerReviewMessages[locale];
  const moderationHref = `/${locale}/administrator/reviews`;
  if (result.status !== "success")
    return (
      <main className={`page results-page ${styles.administratorPage}`}>
        <header className="page-heading">
          <h1 className="page-title">{copy.translationReportsTitle}</h1>
        </header>
        {result.status === "invalid" ? (
          <ActionFeedback kind="error">{copy.invalid}</ActionFeedback>
        ) : (
          <p role={result.status === "unavailable" ? "alert" : undefined}>
            {result.status === "access-required"
              ? copy.administratorAccessRequired
              : copy.unavailable}
          </p>
        )}
        {result.status === "access-required" ? (
          <ActionLink
            kind="secondary"
            href={administratorAccessHref(locale, moderationHref)}
          >
            {copy.administratorAccessAction}
          </ActionLink>
        ) : null}
      </main>
    );
  return (
    <main className={`page results-page ${styles.administratorPage}`}>
      <BackofficeNavigation
        locale={locale}
        area="administrator"
        current="queues"
        nested
      />
      <header className="page-heading">
        <ActionLink kind="text" href={moderationHref}>
          {copy.administratorTitle}
        </ActionLink>
        <h1 className="page-title">{copy.translationReportsTitle}</h1>
      </header>
      {result.items.length === 0 ? (
        <div className="empty-state">
          <p>{copy.translationReportsEmpty}</p>
        </div>
      ) : (
        <div className={styles.list}>
          {result.items.map((report) => (
            <ReportCard key={report.reportId} locale={locale} report={report} />
          ))}
        </div>
      )}
      {continued || result.nextCursor ? (
        <nav
          className="results-paging"
          aria-label={copy.translationReportsTitle}
        >
          {continued ? (
            <ActionLink
              kind="secondary"
              href={`${moderationHref}/translation-reports`}
            >
              {copy.translationReportsFirst}
            </ActionLink>
          ) : null}
          {result.nextCursor ? (
            <ActionLink
              kind="secondary"
              href={`${moderationHref}/translation-reports?${new URLSearchParams(
                {
                  beforeAt: result.nextCursor.reportedAt,
                  beforeId: result.nextCursor.reportId,
                },
              )}`}
            >
              {administratorRecordsMessages[locale].next}
            </ActionLink>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
