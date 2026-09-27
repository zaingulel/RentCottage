"use client";

import { useRef, useState, type FormEvent } from "react";

import {
  searchAdministratorRecordsAction,
  type AdministratorRecordsActionState,
} from "@/administrator-records/actions";
import {
  type AdministratorRecordDetail,
  type AdministratorRecordRow,
  type AdministratorSearchInput,
  searchKinds,
} from "@/administrator-records/administrator-records";
import { formatIraqDateTime } from "@/i18n/format";
import { administratorRecordsMessages } from "@/i18n/administrator-records-messages";
import type { Locale } from "@/i18n/routing";

import {
  ActionButton,
  ActionFeedback,
  ActionLink,
  FormControl,
} from "./interaction-controls";
import styles from "./administrator-records.module.css";

type ViewState = AdministratorRecordsActionState | { status: "loading" };
type Kind = AdministratorSearchInput["kind"];
type Filters = Pick<
  AdministratorSearchInput,
  "kind" | "query" | "status" | "from" | "through" | "ownerId"
>;

const statusOptions: Record<Kind, readonly string[]> = {
  customers: [],
  owners: ["prospective", "approved", "suspended", "expired"],
  cottages: ["draft", "submitted_for_content_approval", "abandoned"],
  applications: [
    "pending",
    "submitted",
    "under_review",
    "needs_information",
    "approved",
    "rejected",
    "expired",
    "suspended",
  ],
  approvals: ["in_review", "approved", "rejected"],
};

function recordHref(locale: Locale, row: AdministratorRecordRow) {
  switch (row.kind) {
    case "customers":
    case "owners":
      return `/${locale}/administrator/records/account/${row.id}`;
    case "cottages":
      return `/${locale}/administrator/cottages/${row.id}`;
    case "applications":
      return `/${locale}/administrator/owner-applications/${row.id}`;
    case "approvals":
      return `/${locale}/administrator/records/approval/${row.id}`;
  }
}

function StatusText({ locale, status }: { locale: Locale; status: string }) {
  const statuses = administratorRecordsMessages[locale].statuses as Record<
    string,
    string
  >;
  return <>{statuses[status] ?? status}</>;
}

export function AdministratorRecords({
  locale,
  initial,
  initialFilters,
}: {
  locale: Locale;
  initial: AdministratorRecordsActionState;
  initialFilters: Filters;
}) {
  const copy = administratorRecordsMessages[locale];
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [view, setView] = useState<ViewState>(initial);
  const request = useRef(0);

  function change(patch: Partial<Filters>) {
    request.current++;
    setFilters((current) => ({ ...current, ...patch }));
    setView({ status: "idle" });
  }

  async function run(
    nextFilters: Filters,
    cursor?: { at: string; id: string },
  ) {
    const current = ++request.current;
    setFilters(nextFilters);
    setView({ status: "loading" });
    const data = new FormData();
    data.set("locale", locale);
    data.set("kind", nextFilters.kind);
    data.set("query", nextFilters.query);
    data.set("status", nextFilters.status ?? "");
    data.set("from", nextFilters.from ?? "");
    data.set("through", nextFilters.through ?? "");
    data.set("ownerId", nextFilters.ownerId ?? "");
    data.set("afterAt", cursor?.at ?? "");
    data.set("afterId", cursor?.id ?? "");
    try {
      const result = await searchAdministratorRecordsAction(
        { status: "idle" },
        data,
      );
      if (request.current === current) setView(result);
    } catch {
      if (request.current === current) setView({ status: "unavailable" });
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(filters);
  }

  function queue(kind: "applications" | "approvals") {
    void run({
      kind,
      query: "",
      status: kind === "applications" ? "pending" : "in_review",
      from: null,
      through: null,
      ownerId: null,
    });
  }

  const filterErrorId =
    view.status === "invalid"
      ? "administrator-records-filter-error"
      : undefined;

  return (
    <section
      className={styles.content}
      aria-labelledby="administrator-records-title"
    >
      <p className={styles.eyebrow}>{copy.eyebrow}</p>
      <h1 id="administrator-records-title">{copy.title}</h1>
      <p>{copy.intro}</p>
      <div className={styles.queues} aria-label={copy.matchingTotal}>
        <ActionButton
          kind="secondary"
          size="regular"
          type="button"
          onClick={() => queue("applications")}
        >
          {copy.applicationsQueue}
          {view.status === "ready"
            ? `: ${new Intl.NumberFormat(locale).format(view.page.pendingApplications)}`
            : ""}
        </ActionButton>
        <ActionButton
          kind="secondary"
          size="regular"
          type="button"
          onClick={() => queue("approvals")}
        >
          {copy.approvalsQueue}
          {view.status === "ready"
            ? `: ${new Intl.NumberFormat(locale).format(view.page.pendingApprovals)}`
            : ""}
        </ActionButton>
      </div>
      <form onSubmit={submit} className={styles.filters}>
        <label>
          <span>{copy.kind}</span>
          <FormControl
            kind="select"
            name="kind"
            aria-invalid={Boolean(filterErrorId) || undefined}
            aria-describedby={filterErrorId}
            value={filters.kind}
            onChange={(event) =>
              change({
                kind: event.target.value as Kind,
                status: null,
                ownerId: null,
              })
            }
          >
            {searchKinds.map((kind) => (
              <option key={kind} value={kind}>
                {copy[kind]}
              </option>
            ))}
          </FormControl>
        </label>
        <label>
          <span>{copy.query}</span>
          <FormControl
            kind="input"
            name="query"
            aria-invalid={Boolean(filterErrorId) || undefined}
            aria-describedby={filterErrorId}
            value={filters.query}
            onChange={(event) => change({ query: event.target.value })}
            placeholder={
              copy[
                `${filters.kind.slice(0, -1)}Hint` as keyof typeof copy
              ] as string
            }
            autoComplete="off"
          />
        </label>
        {filters.kind !== "customers" ? (
          <label>
            <span>{copy.status}</span>
            <FormControl
              kind="select"
              name="status"
              aria-invalid={Boolean(filterErrorId) || undefined}
              aria-describedby={filterErrorId}
              value={filters.status ?? ""}
              onChange={(event) =>
                change({ status: event.target.value || null })
              }
            >
              <option value="">{copy.allStatuses}</option>
              {statusOptions[filters.kind].map((status) => (
                <option key={status} value={status}>
                  <StatusText locale={locale} status={status} />
                </option>
              ))}
            </FormControl>
          </label>
        ) : null}
        <label>
          <span>{copy.from}</span>
          <FormControl
            kind="input"
            name="from"
            aria-invalid={Boolean(filterErrorId) || undefined}
            aria-describedby={filterErrorId}
            type="date"
            value={filters.from ?? ""}
            onChange={(event) => change({ from: event.target.value || null })}
          />
        </label>
        <label>
          <span>{copy.through}</span>
          <FormControl
            kind="input"
            name="through"
            aria-invalid={Boolean(filterErrorId) || undefined}
            aria-describedby={filterErrorId}
            type="date"
            value={filters.through ?? ""}
            onChange={(event) =>
              change({ through: event.target.value || null })
            }
          />
        </label>
        <div className={styles.actions}>
          <ActionButton
            kind="primary"
            width="content"
            type="submit"
            pending={view.status === "loading"}
          >
            {copy.search}
          </ActionButton>
          <ActionButton
            kind="secondary"
            size="regular"
            type="button"
            onClick={() =>
              void run({
                kind: "applications",
                query: "",
                status: "pending",
                from: null,
                through: null,
                ownerId: null,
              })
            }
          >
            {copy.reset}
          </ActionButton>
        </div>
      </form>
      <div aria-live="polite" className={styles.results}>
        {view.status === "loading" ? <p>{copy.loading}</p> : null}
        {view.status === "invalid" ? (
          <div id="administrator-records-filter-error">
            <ActionFeedback kind="error">{copy.invalid}</ActionFeedback>
          </div>
        ) : null}
        {view.status === "access_required" ? (
          <ActionFeedback kind="error">
            {copy.accessRequired}{" "}
            <ActionLink kind="text" href={`/${locale}/administrator/access`}>
              {copy.signIn}
            </ActionLink>
          </ActionFeedback>
        ) : null}
        {view.status === "unavailable" ? (
          <ActionFeedback kind="error">{copy.unavailable}</ActionFeedback>
        ) : null}
        {view.status === "ready" ? (
          <>
            <p className={styles.total}>
              {copy.matchingTotal}:{" "}
              <strong>
                {new Intl.NumberFormat(locale).format(view.page.total)}
              </strong>
            </p>
            {view.page.rows.length ? (
              <ol className={styles.list}>
                {view.page.rows.map((row) => (
                  <li key={row.id} className={styles.card}>
                    <ActionLink kind="text" href={recordHref(locale, row)}>
                      {row.label}
                    </ActionLink>
                    <dl>
                      <div>
                        <dt>{copy.id}</dt>
                        <dd>
                          <bdi>{row.id}</bdi>
                        </dd>
                      </div>
                      <div>
                        <dt>{copy.status}</dt>
                        <dd>
                          <StatusText locale={locale} status={row.status} />
                        </dd>
                      </div>
                      <div>
                        <dt>{copy.relevantDate}</dt>
                        <dd>
                          <time dateTime={row.at}>
                            {formatIraqDateTime(row.at, locale)}
                          </time>
                        </dd>
                      </div>
                      {row.maskedPhone ? (
                        <div>
                          <dt>{copy.phone}</dt>
                          <dd>
                            <bdi>{row.maskedPhone}</bdi>
                          </dd>
                        </div>
                      ) : null}
                      {row.cycleNumber ? (
                        <div>
                          <dt>{copy.cycle}</dt>
                          <dd>
                            {new Intl.NumberFormat(locale).format(
                              row.cycleNumber,
                            )}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  </li>
                ))}
              </ol>
            ) : (
              <p>{copy.empty}</p>
            )}
            {view.page.nextCursor ? (
              <ActionButton
                kind="secondary"
                size="regular"
                type="button"
                onClick={() =>
                  void run(filters, view.page.nextCursor ?? undefined)
                }
              >
                {copy.next}
              </ActionButton>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function DecisionDetails({
  locale,
  approved,
  reason,
  administratorId,
  decidedAt,
}: {
  locale: Locale;
  approved: boolean;
  reason: string;
  administratorId: string;
  decidedAt: string;
}) {
  const copy = administratorRecordsMessages[locale];
  return (
    <dl className={styles.detailList}>
      <div>
        <dt>{copy.status}</dt>
        <dd>{approved ? copy.approved : copy.rejected}</dd>
      </div>
      <div>
        <dt>{copy.reason}</dt>
        <dd>{reason}</dd>
      </div>
      <div>
        <dt>{copy.administrator}</dt>
        <dd>
          <bdi>{administratorId}</bdi>
        </dd>
      </div>
      <div>
        <dt>{copy.decided}</dt>
        <dd>
          <time dateTime={decidedAt}>
            {formatIraqDateTime(decidedAt, locale)}
          </time>
        </dd>
      </div>
    </dl>
  );
}

export function AdministratorRecordDetailView({
  locale,
  record,
}: {
  locale: Locale;
  record: AdministratorRecordDetail;
}) {
  const copy = administratorRecordsMessages[locale];
  return (
    <article className={styles.content}>
      <ActionLink kind="text" href={`/${locale}/administrator/records`}>
        {copy.back}
      </ActionLink>
      <h1>{record.kind === "account" ? copy.account : copy.approval}</h1>
      {record.kind === "account" ? (
        <>
          <dl className={styles.detailList}>
            <div>
              <dt>{copy.id}</dt>
              <dd>
                <bdi>{record.id}</bdi>
              </dd>
            </div>
            <div>
              <dt>{copy.role}</dt>
              <dd>
                <StatusText locale={locale} status={record.marketplaceRole} />
              </dd>
            </div>
            <div>
              <dt>{copy.customerCapability}</dt>
              <dd>{copy.yes}</dd>
            </div>
            {record.ownerApprovalState ? (
              <div>
                <dt>{copy.ownerApproval}</dt>
                <dd>
                  <StatusText
                    locale={locale}
                    status={record.ownerApprovalState}
                  />
                </dd>
              </div>
            ) : null}
            {record.maskedPhone ? (
              <div>
                <dt>{copy.phone}</dt>
                <dd>
                  <bdi>{record.maskedPhone}</bdi>
                </dd>
              </div>
            ) : null}
            <div>
              <dt>{copy.created}</dt>
              <dd>
                <time dateTime={record.createdAt}>
                  {formatIraqDateTime(record.createdAt, locale)}
                </time>
              </dd>
            </div>
          </dl>
          <div className={styles.detailLinks}>
            {record.applicationId ? (
              <ActionLink
                kind="text"
                href={`/${locale}/administrator/owner-applications/${record.applicationId}`}
              >
                {copy.applicationLink}
              </ActionLink>
            ) : null}
            {record.marketplaceRole === "cottage_owner" ? (
              <ActionLink
                kind="text"
                href={`/${locale}/administrator/records?scope=cottages&ownerId=${record.id}`}
              >
                {copy.cottagesLink}
              </ActionLink>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <dl className={styles.detailList}>
            <div>
              <dt>{copy.id}</dt>
              <dd>
                <bdi>{record.id}</bdi>
              </dd>
            </div>
            <div>
              <dt>{copy.profileId}</dt>
              <dd>
                <bdi>{record.profileId}</bdi>
              </dd>
            </div>
            <div>
              <dt>{copy.ownerId}</dt>
              <dd>
                <bdi>{record.ownerId}</bdi>
              </dd>
            </div>
            <div>
              <dt>{copy.cycle}</dt>
              <dd>
                {new Intl.NumberFormat(locale).format(record.cycleNumber)}
              </dd>
            </div>
            <div>
              <dt>{copy.status}</dt>
              <dd>
                <StatusText locale={locale} status={record.state} />
              </dd>
            </div>
            <div>
              <dt>{copy.locality}</dt>
              <dd>{record.approximateLocation}</dd>
            </div>
            <div>
              <dt>{copy.created}</dt>
              <dd>
                <time dateTime={record.createdAt}>
                  {formatIraqDateTime(record.createdAt, locale)}
                </time>
              </dd>
            </div>
            {record.decidedAt ? (
              <div>
                <dt>{copy.decided}</dt>
                <dd>
                  <time dateTime={record.decidedAt}>
                    {formatIraqDateTime(record.decidedAt, locale)}
                  </time>
                </dd>
              </div>
            ) : null}
          </dl>
          <h2>{record.name}</h2>
          <ActionLink
            kind="text"
            href={`/${locale}/administrator/cottages/${record.profileId}`}
          >
            {copy.profileLink}
          </ActionLink>
          <section>
            <h2>{copy.publicationDecision}</h2>
            {record.publicationDecision ? (
              <DecisionDetails
                locale={locale}
                {...record.publicationDecision}
              />
            ) : (
              <p>{copy.noDecision}</p>
            )}
          </section>
          <section>
            <h2>{copy.localizationDecisions}</h2>
            {record.localizedDecisions.length ? (
              <ol className={styles.list}>
                {record.localizedDecisions.map((decision) => (
                  <li key={decision.revisionId} className={styles.card}>
                    <h3>
                      <bdi>{decision.locale}</bdi>
                    </h3>
                    <p>
                      {copy.revision}: <bdi>{decision.revisionId}</bdi>
                    </p>
                    <DecisionDetails
                      locale={locale}
                      approved={decision.approved}
                      reason={decision.reason}
                      administratorId={decision.administratorId}
                      decidedAt={decision.decidedAt}
                    />
                  </li>
                ))}
              </ol>
            ) : (
              <p>{copy.noDecision}</p>
            )}
          </section>
        </>
      )}
    </article>
  );
}
