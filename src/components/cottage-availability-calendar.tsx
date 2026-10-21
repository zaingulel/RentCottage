"use client";

import {
  startTransition,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  loadCottageInventoryCalendarSpanAction,
  setCottageInventoryAvailabilityBatchAction,
  type CottageInventoryBatchActionState,
  type CottageInventoryCalendarSpanLoadActionState,
} from "@/cottage-inventory/actions";
import type {
  CottageInventoryOwnerCalendarState,
  CottageInventoryOwnerCalendarSpan,
  CottageInventoryOwnerCalendarSpanUnit,
  CottageInventoryAvailabilityBatchInput,
  CottageInventoryReviewedCell,
  CottageInventoryBatchRefused,
  CottageInventoryBatchSaved,
  CottageInventoryAvailabilityState,
  CottageInventoryCoordinate,
  CottageInventoryUnitKind,
} from "@/cottage-inventory/cottage-inventory";
import { cottagePricingAvailabilityMessages } from "@/i18n/cottage-pricing-availability-messages";
import {
  cottageShiftScheduleMessages,
  type Copy as ScheduleCopy,
} from "@/i18n/cottage-shift-schedule-messages";
import { directionFor, type Locale } from "@/i18n/routing";

import { CottageAccessRange } from "./cottage-access-range";
import {
  ActionButton,
  ActionFeedback,
  ActionFocusTarget,
  FormControl,
  ChoiceControl,
  OptionGroup,
} from "./interaction-controls";
import { useExclusiveAction } from "./use-exclusive-action";

export type CottageAvailabilityCalendarUnit = {
  id: string;
  kind: CottageInventoryUnitKind;
  label: string;
  identity: string;
  localName?: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
};

export function accessRange(
  copy: ScheduleCopy,
  unit: CottageAvailabilityCalendarUnit,
) {
  return (
    <>
      <CottageAccessRange
        template={copy.accessRange}
        start={unit.startTime}
        end={unit.endTime}
      />{" "}
      ({unit.crossesMidnight ? copy.nextDay : copy.sameDay})
    </>
  );
}

export function unitName(unit: CottageAvailabilityCalendarUnit) {
  return (
    <>
      {unit.identity}
      {unit.localName !== undefined ? (
        <>
          : <bdi dir="auto">{unit.localName}</bdi>
        </>
      ) : null}
    </>
  );
}

function baghdadDate(instant: Date) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Baghdad",
    calendar: "gregory",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === name)!.value;
  return {
    day: `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}:${part("second")}`,
  };
}

function monthEnd(month: string) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}

function weekStart(serviceDay: string) {
  const date = new Date(`${serviceDay}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 1) % 7));
  return date.toISOString().slice(0, 10);
}

export function CottageAvailabilityCalendar({
  locale,
  profileId,
  scheduleRevisionId,
  units,
  refreshKey,
  editable,
  canOpen,
}: {
  locale: Locale;
  profileId: string;
  scheduleRevisionId: string;
  units: readonly CottageAvailabilityCalendarUnit[];
  refreshKey: number;
  editable: boolean;
  canOpen: boolean;
}) {
  const copy = cottagePricingAvailabilityMessages[locale];
  const scheduleCopy = cottageShiftScheduleMessages[locale];
  const calendarHeadingId = useId();
  const scope = JSON.stringify([profileId, scheduleRevisionId]);
  const [view, setView] = useState<{
    scope: string;
    date: string;
    provisionalMonth: string;
    navigated: boolean;
    server: ReturnType<typeof baghdadDate> | null;
    initiator: "previous" | "next" | "retry" | null;
  } | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [outcome, setOutcome] = useState<{
    key: string;
    result: CottageInventoryCalendarSpanLoadActionState;
    epoch: number;
  } | null>(null);
  const generation = useRef(0);
  const navigationIntent = useRef(false);
  const currentView = view?.scope === scope ? view : null;
  const month = currentView?.date.slice(0, 7) ?? null;
  const unitIdentity = units
    .map((unit) => `${unit.kind}:${unit.id}`)
    .sort()
    .join("|");
  const [saveEpoch, setSaveEpoch] = useState(0);
  const saveEpochCounter = useRef(0);
  const [saved, setSaved] = useState<{
    scope: string;
    receipt: CottageInventoryBatchSaved;
    epoch: number;
  } | null>(null);
  const requestKey = JSON.stringify([
    scope,
    month,
    refreshKey,
    unitIdentity,
    retryKey,
    saveEpoch,
  ]);
  const batchAction = useExclusiveAction();
  const [draft, setDraft] = useState<{
    scope: string;
    from: string;
    to: string;
    keys: string[];
    state: CottageInventoryAvailabilityState;
  } | null>(null);
  const currentDraft = draft?.scope === scope ? draft : null;
  const submissionScope = JSON.stringify([
    scope,
    unitIdentity,
    editable,
    canOpen,
  ]);
  const currentSaved = saved?.scope === submissionScope ? saved : null;
  const [submissionVersion, setSubmissionVersion] = useState({
    scope: submissionScope,
    generation: 0,
  });
  if (submissionVersion.scope !== submissionScope)
    setSubmissionVersion({
      scope: submissionScope,
      generation: submissionVersion.generation + 1,
    });
  const batchHeadingId = `${useId()}-${submissionVersion.generation}`;
  const reviewTitleId = useId();
  const batchKey = JSON.stringify([
    submissionScope,
    refreshKey,
    currentDraft,
    currentDraft &&
    currentView?.server &&
    currentDraft.from < currentView.server.day
      ? currentView.server.day
      : null,
  ]);
  const batchKeyRef = useRef(batchKey);
  const submissionScopeRef = useRef(submissionScope);
  const submissionGeneration = useRef(0);
  const batchGeneration = useRef(0);
  const reviewSerial = useRef(0);
  const [review, setReview] = useState<{
    key: string;
    serial: number;
    calendar: CottageInventoryOwnerCalendarSpan;
    batch: CottageInventoryAvailabilityBatchInput;
  } | null>(null);
  const [refusal, setRefusal] = useState<{
    key: string;
    receipt: CottageInventoryBatchRefused;
  } | null>(null);
  const [consent, setConsent] = useState<{
    key: string;
    coordinates: string[];
    confirmed: boolean;
  } | null>(null);
  const [batchResult, setBatchResult] = useState<{
    key: string;
    value: CottageInventoryBatchActionState;
    phase: "review" | "apply";
  } | null>(null);
  const [initiatingAction, setInitiatingAction] = useState<{
    scope: string;
    kind: "review" | "apply";
  } | null>(null);
  const [batchReady, setBatchReady] = useState<string | null>(null);
  const [seenBatchKey, setSeenBatchKey] = useState(batchKey);
  const [seenLocale, setSeenLocale] = useState(locale);
  if (seenBatchKey !== batchKey) {
    setSeenBatchKey(batchKey);
    if (
      !(
        batchAction.pending &&
        initiatingAction?.scope === submissionScope &&
        initiatingAction.kind === "apply"
      )
    )
      setReview(null);
    setRefusal(null);
    setConsent(null);
    setBatchResult(null);
    setBatchReady(null);
  }
  if (seenLocale !== locale) {
    setSeenLocale(locale);
    setConsent(null);
  }
  useLayoutEffect(() => {
    batchKeyRef.current = batchKey;
    batchGeneration.current++;
  }, [batchKey]);
  useLayoutEffect(() => {
    submissionScopeRef.current = submissionScope;
    submissionGeneration.current++;
  }, [submissionScope]);
  const currentReview = review?.key === batchKey ? review : null;
  const visibleReview =
    currentReview ??
    (batchAction.pending &&
    initiatingAction?.scope === submissionScope &&
    initiatingAction.kind === "apply"
      ? review
      : null);
  const currentRefusal = refusal?.key === batchKey ? refusal.receipt : null;
  const consentKey = JSON.stringify([batchKey, currentReview?.serial, locale]);
  const currentConsent =
    consent?.key === consentKey
      ? consent
      : { key: consentKey, coordinates: [], confirmed: false };
  const coordinateKey = (cell: CottageInventoryCoordinate) =>
    `${cell.serviceDay}:${cell.kind}:${cell.id}`;
  const requiredConsent =
    currentReview?.batch.cells.filter(
      (cell) =>
        cell.expectedOwnerState === "private_blocked" &&
        currentReview.batch.state !== "private_blocked",
    ) ?? [];
  const permitsTarget = currentDraft?.state !== "open" || canOpen;
  const localResult = batchResult?.key === batchKey ? batchResult.value : null;
  function changeDraft(change: Partial<NonNullable<typeof draft>>) {
    if (currentDraft) setDraft({ ...currentDraft, ...change });
    setReview(null);
    setRefusal(null);
    setConsent(null);
    setBatchResult(null);
    setBatchReady(null);
  }
  function validRange(from: string, to: string) {
    const valid = (day: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(day) &&
      day >= "0001-01-01" &&
      Number.isFinite(Date.parse(`${day}T00:00:00Z`)) &&
      new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
    return (
      valid(from) &&
      valid(to) &&
      from <= to &&
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86400000 <
        31 &&
      from >= (currentView?.server?.day ?? "9999-12-31")
    );
  }
  function reviewChanges() {
    if (!currentDraft || !editable || !permitsTarget) return;
    const capturedDraft = currentDraft;
    const selectedUnits = units
      .filter((unit) => capturedDraft.keys.includes(`${unit.kind}:${unit.id}`))
      .sort((a, b) => (`${a.kind}:${a.id}` < `${b.kind}:${b.id}` ? -1 : 1));
    if (
      !selectedUnits.length ||
      !validRange(capturedDraft.from, capturedDraft.to)
    ) {
      setReview(null);
      setRefusal(null);
      setConsent(null);
      setBatchResult({
        key: batchKey,
        value: { status: "invalid", fields: ["batch"] },
        phase: "review",
      });
      setBatchReady(batchKey);
      return;
    }
    const key = batchKey;
    const operationScope = submissionScope;
    void batchAction.run(async () => {
      const generation = ++batchGeneration.current;
      setInitiatingAction({ scope: operationScope, kind: "review" });
      setSaved(null);
      setBatchReady(null);
      setReview(null);
      setRefusal(null);
      setConsent(null);
      setBatchResult(null);
      const form = new FormData();
      for (const [name, value] of Object.entries({
        locale,
        profileId,
        scheduleRevisionId,
        from: capturedDraft.from,
        to: capturedDraft.to,
      }))
        form.set(name, value);
      let result: CottageInventoryCalendarSpanLoadActionState;
      try {
        let request!: Promise<CottageInventoryCalendarSpanLoadActionState>;
        startTransition(() => {
          request = loadCottageInventoryCalendarSpanAction(
            { status: "idle" },
            form,
          );
        });
        result = await request;
      } catch {
        result = { status: "unavailable" };
      }
      if (batchKeyRef.current !== key || generation !== batchGeneration.current)
        return;
      if (result.status === "loaded") {
        const span = result.calendar;
        if (
          span.profileId !== profileId ||
          span.scheduleRevisionId !== scheduleRevisionId ||
          span.from !== capturedDraft.from ||
          span.to !== capturedDraft.to ||
          span.unitKeys
            .map((unit) => `${unit.kind}:${unit.id}`)
            .sort()
            .join("|") !== unitIdentity
        )
          result = { status: "unavailable" };
        else {
          const server = baghdadDate(new Date(span.asOf));
          setView((current) =>
            current?.scope === scope
              ? {
                  ...current,
                  server,
                  date:
                    current.date.slice(0, 7) < server.day.slice(0, 7)
                      ? `${server.day.slice(0, 7)}-01`
                      : current.date,
                }
              : current,
          );
          if (capturedDraft.from < server.day) {
            setBatchResult({
              key,
              value: { status: "invalid", fields: ["batch"] },
              phase: "review",
            });
            setBatchReady(key);
            return;
          }
          const cells = span.days.flatMap((day) =>
            selectedUnits.map((unit) => ({
              serviceDay: day.serviceDay,
              id: unit.id,
              kind: unit.kind,
              expectedOwnerState: day.units.find(
                (cell) => cell.id === unit.id && cell.kind === unit.kind,
              )!.ownerState,
            })),
          );
          setReview({
            key,
            serial: ++reviewSerial.current,
            calendar: span,
            batch: {
              from: capturedDraft.from,
              to: capturedDraft.to,
              unitKeys: selectedUnits.map(({ id, kind }) => ({ id, kind })),
              state: capturedDraft.state,
              mode: "range",
              cells,
              replacePrivateBlocks: [],
              reviewConfirmed: false,
            },
          });
        }
      }
      if (result.status !== "loaded")
        setBatchResult({
          key,
          phase: "review",
          value:
            result.status === "invalid"
              ? { status: "invalid", fields: ["batch"] }
              : result.status === "idle"
                ? { status: "unavailable" }
                : { status: result.status },
        });
      setBatchReady(key);
    });
  }
  function applyChanges() {
    if (
      !currentReview ||
      !editable ||
      !permitsTarget ||
      requiredConsent.some(
        (cell) => !currentConsent.coordinates.includes(coordinateKey(cell)),
      ) ||
      (currentReview.batch.mode === "reviewed" && !currentConsent.confirmed)
    )
      return;
    const key = batchKey;
    const operationScope = submissionScope;
    const operationGeneration = submissionGeneration.current;
    const batch: CottageInventoryAvailabilityBatchInput = {
      ...currentReview.batch,
      replacePrivateBlocks: requiredConsent
        .filter((cell) =>
          currentConsent.coordinates.includes(coordinateKey(cell)),
        )
        .map(({ serviceDay, id, kind }) => ({ serviceDay, id, kind })),
      reviewConfirmed:
        currentReview.batch.mode === "reviewed" && currentConsent.confirmed,
    };
    void batchAction.run(async () => {
      setInitiatingAction({ scope: operationScope, kind: "apply" });
      setBatchReady(null);
      setBatchResult(null);
      const form = new FormData();
      for (const [name, value] of Object.entries({
        locale,
        profileId,
        scheduleRevisionId,
        batch: JSON.stringify(batch),
      }))
        form.set(name, value);
      let result: CottageInventoryBatchActionState;
      try {
        let request!: Promise<CottageInventoryBatchActionState>;
        startTransition(() => {
          request = setCottageInventoryAvailabilityBatchAction(
            { status: "idle" },
            form,
          );
        });
        result = await request;
      } catch {
        result = { status: "unavailable" };
      }
      if (
        submissionScopeRef.current !== operationScope ||
        submissionGeneration.current !== operationGeneration
      )
        return;
      if (result.status === "saved") {
        const epoch = ++saveEpochCounter.current;
        setSaved({ scope: operationScope, receipt: result.receipt, epoch });
        setSaveEpoch(epoch);
        setReview(null);
        setConsent(null);
        setRefusal(null);
        setBatchResult(null);
        setBatchReady(batchKeyRef.current);
        return;
      }
      setRetryKey((current) => current + 1);
      if (batchKeyRef.current !== key) return;
      setReview(null);
      setConsent(null);
      setRefusal(result.status === "refused" ? { key, receipt: result } : null);
      setBatchResult({ key, value: result, phase: "apply" });
      setBatchReady(key);
    });
  }
  useEffect(() => {
    navigationIntent.current = false;
    const provisionalMonth = baghdadDate(new Date()).day.slice(0, 7);
    // The browser clock is read after hydration; a scope reset must not wait for another pending action.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView({
      scope,
      provisionalMonth,
      date: `${provisionalMonth}-01`,
      navigated: false,
      server: null,
      initiator: null,
    });
  }, [scope]);
  useEffect(() => {
    if (!month) return;
    let active = true;
    const requestGeneration = ++generation.current;
    const from = `${month}-01`;
    const to = monthEnd(month);
    const formData = new FormData();
    for (const [name, value] of Object.entries({
      profileId,
      scheduleRevisionId,
      from,
      to,
    }))
      formData.set(name, value);
    startTransition(async () => {
      try {
        let response = await loadCottageInventoryCalendarSpanAction(
          { status: "idle" },
          formData,
        );
        if (!active || requestGeneration !== generation.current) return;
        if (response.status === "loaded") {
          const calendar = response.calendar;
          const returnedIdentity = calendar.unitKeys
            .map((unit) => `${unit.kind}:${unit.id}`)
            .sort()
            .join("|");
          if (
            calendar.profileId !== profileId ||
            calendar.scheduleRevisionId !== scheduleRevisionId ||
            calendar.from !== from ||
            calendar.to !== to ||
            returnedIdentity !== unitIdentity
          ) {
            response = { status: "unavailable" };
          } else {
            const server = baghdadDate(new Date(calendar.asOf));
            const serverMonth = server.day.slice(0, 7);
            setDraft((current) =>
              current?.scope === scope
                ? current
                : {
                    scope,
                    from: server.day,
                    to: server.day,
                    keys: [],
                    state: "closed",
                  },
            );
            // A browser date is only a starting hint; the accepted server snapshot owns the lower bound.
            setView((current) =>
              current?.scope === scope
                ? {
                    ...current,
                    server,
                    date:
                      !current.navigated ||
                      current.date.slice(0, 7) < serverMonth
                        ? `${serverMonth}-01`
                        : current.date,
                  }
                : current,
            );
            if (
              month < serverMonth ||
              (!navigationIntent.current && month !== serverMonth)
            )
              return;
          }
        }
        setView((current) =>
          current?.scope === scope ? { ...current, initiator: null } : current,
        );
        setOutcome({ key: requestKey, result: response, epoch: saveEpoch });
      } catch {
        if (active && requestGeneration === generation.current) {
          setView((current) =>
            current?.scope === scope
              ? { ...current, initiator: null }
              : current,
          );
          setOutcome({
            key: requestKey,
            result: { status: "unavailable" },
            epoch: saveEpoch,
          });
        }
      }
    });
    return () => {
      active = false;
    };
  }, [
    month,
    profileId,
    scheduleRevisionId,
    scope,
    refreshKey,
    unitIdentity,
    requestKey,
    saveEpoch,
  ]);
  const result = outcome?.key === requestKey ? outcome.result : null;
  const pending = result === null;
  const lowerMonth =
    currentView?.server?.day.slice(0, 7) ?? currentView?.provisionalMonth;
  function navigate(date: string, initiator: "previous" | "next" | null) {
    if (!date || !currentView || !lowerMonth) return;
    const nextDate = date.slice(0, 7) < lowerMonth ? `${lowerMonth}-01` : date;
    navigationIntent.current = true;
    setView({ ...currentView, date: nextDate, navigated: true, initiator });
  }
  function adjacentMonth(offset: number) {
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    return date.toISOString().slice(0, 10);
  }
  const labels: Record<
    CottageInventoryOwnerCalendarState,
    string | readonly string[]
  > = {
    closed: copy.closed,
    open: copy.open,
    private_blocked: copy.privateBlocked,
    pending_hold: copy.pendingHold,
    confirmed_booking: copy.confirmedBooking,
    component_unavailable: copy.componentUnavailable,
  };
  const reasonLabels: Record<
    CottageInventoryBatchRefused["conflicts"][number]["reason"],
    string | readonly string[]
  > = {
    temporary_unavailable: copy.reasonTemporary,
    pending_hold: copy.reasonPending,
    confirmed_booking: copy.reasonConfirmed,
    component_unavailable: copy.reasonComponent,
    stale_state: copy.reasonStale,
    private_block_consent_required: copy.reasonConsent,
    started: copy.reasonStarted,
    publication_required: copy.reasonPublication,
    bundle_components_unavailable: copy.reasonComponents,
    open_bundle_dependency: copy.reasonOpenBundle,
  };
  const batchFailure =
    localResult?.status === "invalid" ||
    (currentDraft &&
      currentView?.server &&
      currentDraft.from < currentView.server.day)
      ? copy.batchInvalid
      : localResult?.status === "conflict"
        ? copy.calendarConflict
        : localResult?.status === "denied"
          ? copy.calendarDenied
          : localResult?.status === "unavailable" ||
              localResult?.status === "idle"
            ? batchResult?.phase === "review"
              ? copy.calendarUnavailable
              : copy.batchUnknown
            : null;
  function unitDetails(unit: CottageAvailabilityCalendarUnit) {
    return (
      <>
        <strong>{unitName(unit)}</strong>
        <span>{accessRange(scheduleCopy, unit)}</span>
      </>
    );
  }
  function cellDetails(
    cell: CottageInventoryOwnerCalendarSpanUnit,
    unit: CottageAvailabilityCalendarUnit,
  ) {
    return (
      <>
        {unitDetails(unit)}
        <span>
          {cell.temporarilyUnavailable
            ? copy.calendarTemporary
            : labels[cell.calendarState!]}
        </span>
        {cell.calendarState === "open" && !cell.available ? (
          <span>{copy.calendarNotBookable}</span>
        ) : null}
        {cell.commitmentReference ? (
          <span>
            {copy.bookingReference}:{" "}
            <bdi dir="auto">{cell.commitmentReference}</bdi>
          </span>
        ) : null}
      </>
    );
  }
  function reviewedRows(
    cells: CottageInventoryReviewedCell[],
    span: CottageInventoryOwnerCalendarSpan,
    target: CottageInventoryAvailabilityState,
  ) {
    return cells.map((cell) => {
      const unit = units.find(
        (unit) => unit.id === cell.id && unit.kind === cell.kind,
      )!;
      const snapshot = span.days
        .find((day) => day.serviceDay === cell.serviceDay)!
        .units.find(
          (value) => value.id === cell.id && value.kind === cell.kind,
        )!;
      return (
        <li key={coordinateKey(cell)}>
          <bdi dir="ltr">{cell.serviceDay}</bdi>
          {cellDetails(snapshot, unit)}
          <span>
            {copy.batchCurrent}: {labels[snapshot.ownerState]}
          </span>
          <span>
            {copy.batchExpected}: {labels[cell.expectedOwnerState]}
          </span>
          <span>
            {copy.batchProposed}: {labels[target]}
          </span>
        </li>
      );
    });
  }
  const failureCopy =
    result?.status === "invalid"
      ? copy.calendarInvalid
      : result?.status === "conflict"
        ? copy.calendarConflict
        : result?.status === "denied"
          ? copy.calendarDenied
          : copy.calendarUnavailable;
  const showRetry =
    (!pending && result?.status !== "loaded") ||
    (pending && currentView?.initiator === "retry");
  const calendar = result?.status === "loaded" ? result.calendar : null;
  const weeks = calendar
    ? calendar.days.reduce<(typeof calendar.days)[]>((all, day) => {
        if (
          !all.length ||
          new Date(`${day.serviceDay}T00:00:00Z`).getUTCDay() === 6
        )
          all.push([]);
        all[all.length - 1]!.push(day);
        return all;
      }, [])
    : [];
  return (
    <section className="cottage-calendar" dir={directionFor(locale)}>
      <h3
        id={calendarHeadingId}
        tabIndex={-1}
        className="section-title action-focus-target"
      >
        {copy.calendarHeading}
      </h3>
      <div className="cottage-calendar-navigation">
        <ActionButton
          kind="secondary"
          size="regular"
          type="button"
          focusSuccessorId={calendarHeadingId}
          pending={pending && currentView?.initiator === "previous"}
          disabled={!month || month === lowerMonth}
          onClick={() => navigate(adjacentMonth(-1), "previous")}
        >
          {copy.calendarPrevious}
        </ActionButton>
        <label>
          {copy.calendarShowDate}
          <FormControl
            kind="input"
            type="date"
            value={currentView?.date ?? ""}
            min={lowerMonth ? `${lowerMonth}-01` : undefined}
            max="9999-12-31"
            onChange={(event) => {
              if (!event.currentTarget.validity.rangeOverflow)
                navigate(event.currentTarget.value, null);
            }}
          />
        </label>
        <ActionButton
          kind="secondary"
          size="regular"
          type="button"
          focusSuccessorId={calendarHeadingId}
          pending={pending && currentView?.initiator === "next"}
          disabled={!month || month === "9999-12"}
          onClick={() => navigate(adjacentMonth(1), "next")}
        >
          {copy.calendarNext}
        </ActionButton>
      </div>
      {showRetry ? (
        <ActionButton
          kind="secondary"
          size="regular"
          type="button"
          focusSuccessorId={calendarHeadingId}
          pending={pending && currentView?.initiator === "retry"}
          onClick={() => {
            if (!currentView) return;
            setView({ ...currentView, initiator: "retry" });
            setRetryKey((key) => key + 1);
          }}
        >
          {copy.calendarRetry}
        </ActionButton>
      ) : null}
      {!pending && <ActionFocusTarget targetId={calendarHeadingId} />}
      {!calendar ? (
        pending ? (
          <p role="status">{copy.calendarLoading}</p>
        ) : (
          <ActionFeedback kind="error">{failureCopy}</ActionFeedback>
        )
      ) : (
        <>
          <ActionFeedback kind="success">
            {copy.calendarLoaded}: <bdi dir="ltr">{month}</bdi>
          </ActionFeedback>
          <p>
            {copy.calendarSnapshot}:{" "}
            <bdi dir="ltr">
              {currentView?.server?.day} {currentView?.server?.time}
            </bdi>
          </p>
          <ol className="cottage-calendar-weeks">
            {weeks.map((week) => (
              <li className="cottage-calendar-week" key={week[0]!.serviceDay}>
                <h4>
                  {copy.calendarWeek}{" "}
                  <bdi dir="ltr">{weekStart(week[0]!.serviceDay)}</bdi>
                </h4>
                <ol className="cottage-calendar-days">
                  {week.map((day) => (
                    <li
                      className="cottage-calendar-day"
                      key={day.serviceDay}
                      style={{
                        gridColumnStart:
                          ((new Date(
                            `${day.serviceDay}T00:00:00Z`,
                          ).getUTCDay() +
                            1) %
                            7) +
                          1,
                      }}
                    >
                      <h5>
                        <time dateTime={day.serviceDay} dir="ltr">
                          {day.serviceDay}
                        </time>
                      </h5>
                      {currentView?.server &&
                      day.serviceDay < currentView.server.day ? (
                        <p>{copy.calendarPast}</p>
                      ) : null}
                      <ul
                        className="cottage-calendar-units"
                        aria-label={day.serviceDay}
                      >
                        {units.map((unit) => {
                          const cell = day.units.find(
                            (value) =>
                              value.kind === unit.kind && value.id === unit.id,
                          )!;
                          return (
                            <li key={`${unit.kind}:${unit.id}`}>
                              {cellDetails(cell, unit)}
                              {currentView?.server &&
                              day.serviceDay === currentView.server.day &&
                              unit.startTime <=
                                currentView.server.time.slice(0, 5) ? (
                                <span>{copy.calendarStarted}</span>
                              ) : !cell.editable ? (
                                <span>{copy.calendarProtected}</span>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </>
      )}
      {editable && currentDraft && currentView?.server ? (
        <section
          className="cottage-calendar-batch"
          aria-labelledby={batchHeadingId}
        >
          <h3
            id={batchHeadingId}
            tabIndex={-1}
            className="section-title action-focus-target"
          >
            {copy.batchHeading}
          </h3>
          <p>{copy.batchRangeHelp}</p>
          <fieldset
            className="cottage-calendar-draft"
            disabled={batchAction.pending}
          >
            <label>
              {copy.batchFrom}
              <FormControl
                kind="input"
                type="date"
                min={currentView.server.day}
                max="9999-12-31"
                value={currentDraft.from}
                onChange={(event) =>
                  changeDraft({ from: event.currentTarget.value })
                }
              />
            </label>
            <label>
              {copy.batchTo}
              <FormControl
                kind="input"
                type="date"
                min={currentView.server.day}
                max="9999-12-31"
                value={currentDraft.to}
                onChange={(event) =>
                  changeDraft({ to: event.currentTarget.value })
                }
              />
            </label>
            <OptionGroup legend={copy.batchUnits} layout="stack">
              {units.map((unit) => {
                const key = `${unit.kind}:${unit.id}`;
                return (
                  <ChoiceControl
                    key={key}
                    kind="checkbox"
                    checked={currentDraft.keys.includes(key)}
                    onChange={(event) =>
                      changeDraft({
                        keys: event.currentTarget.checked
                          ? [...currentDraft.keys, key]
                          : currentDraft.keys.filter((value) => value !== key),
                      })
                    }
                  >
                    <bdi dir="auto">{unit.label}</bdi>
                  </ChoiceControl>
                );
              })}
            </OptionGroup>
            <label>
              {copy.batchState}
              <FormControl
                kind="select"
                value={currentDraft.state}
                onChange={(event) =>
                  changeDraft({
                    state: event.currentTarget
                      .value as CottageInventoryAvailabilityState,
                  })
                }
              >
                <option value="closed">{copy.closed}</option>
                <option value="open" disabled={!canOpen}>
                  {copy.open}
                </option>
                <option value="private_blocked">{copy.privateBlocked}</option>
              </FormControl>
            </label>
          </fieldset>
          {!canOpen ? <p>{copy.publicationRequired}</p> : null}
          <ActionButton
            key={`${submissionScope}:${submissionVersion.generation}:review`}
            kind="secondary"
            size="regular"
            type="button"
            focusSuccessorId={batchHeadingId}
            pending={
              batchAction.pending &&
              initiatingAction?.scope === submissionScope &&
              initiatingAction.kind === "review"
            }
            disabled={batchAction.pending || !permitsTarget}
            onClick={reviewChanges}
          >
            {batchAction.pending && initiatingAction?.kind === "review"
              ? copy.batchReviewing
              : copy.batchReview}
          </ActionButton>
          {batchFailure ? (
            <ActionFeedback kind="error">{batchFailure}</ActionFeedback>
          ) : null}
          {currentSaved ? (
            <>
              <ActionFeedback kind="success">{copy.batchSaved}</ActionFeedback>
              <p>
                {copy.batchChanged}:{" "}
                {new Intl.NumberFormat(locale).format(
                  currentSaved.receipt.changed.length,
                )}
              </p>
              <p>
                {copy.batchUnchanged}:{" "}
                {new Intl.NumberFormat(locale).format(
                  currentSaved.receipt.unchanged.length,
                )}
              </p>
              {outcome?.key === requestKey &&
              outcome.result.status === "loaded" &&
              outcome.epoch >= currentSaved.epoch ? null : pending ? (
                <p role="status">{copy.batchRefreshing}</p>
              ) : (
                <ActionFeedback kind="error">
                  {copy.batchRefreshFailed}
                </ActionFeedback>
              )}
            </>
          ) : null}
          {currentRefusal ? (
            <>
              <ActionFeedback kind="error">{copy.batchRefused}</ActionFeedback>
              <p>
                <bdi dir="ltr">{currentRefusal.request.from}</bdi> ·{" "}
                <bdi dir="ltr">{currentRefusal.request.to}</bdi>
              </p>
              <h4>{copy.batchExcluded}</h4>
              <ul
                className="cottage-calendar-review-cells"
                aria-label={copy.batchExcluded as string}
              >
                {currentRefusal.conflicts.map((cell) => (
                  <li key={coordinateKey(cell)}>
                    <bdi dir="ltr">{cell.serviceDay}</bdi>
                    {unitDetails(
                      units.find(
                        (unit) =>
                          unit.id === cell.id && unit.kind === cell.kind,
                      )!,
                    )}
                    <span>{reasonLabels[cell.reason]}</span>
                    {cell.commitmentReference ? (
                      <span>
                        {copy.bookingReference}:{" "}
                        <bdi dir="auto">{cell.commitmentReference}</bdi>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <h4>{copy.batchEligible}</h4>
              <ul
                className="cottage-calendar-review-cells"
                aria-label={copy.batchEligible as string}
              >
                {reviewedRows(
                  currentRefusal.eligible,
                  currentRefusal.calendar,
                  currentRefusal.request.state,
                )}
              </ul>
              {!currentRefusal.eligible.length ? (
                <p>{copy.batchNoEligible}</p>
              ) : !currentReview ? (
                <>
                  <p>{copy.batchSmallerHelp}</p>
                  <ActionButton
                    key={`${submissionScope}:${submissionVersion.generation}:eligible`}
                    kind="secondary"
                    size="regular"
                    type="button"
                    focusSuccessorId={batchHeadingId}
                    disabled={batchAction.pending}
                    onClick={() => {
                      setReview({
                        key: batchKey,
                        serial: ++reviewSerial.current,
                        calendar: currentRefusal.calendar,
                        batch: {
                          ...currentRefusal.request,
                          cells: currentRefusal.eligible,
                          mode: "reviewed",
                          reviewConfirmed: false,
                          replacePrivateBlocks: [],
                        },
                      });
                      setConsent(null);
                      setBatchReady(batchKey);
                    }}
                  >
                    {copy.batchReviewEligible}
                  </ActionButton>
                </>
              ) : null}
              <h4>{copy.batchRefusalCalendar}</h4>
              <ul
                className="cottage-calendar-review-cells"
                aria-label={copy.batchRefusalCalendar as string}
              >
                {currentRefusal.calendar.days.flatMap((day) =>
                  day.units.map((cell) => (
                    <li key={`${day.serviceDay}:${cell.kind}:${cell.id}`}>
                      <bdi dir="ltr">{day.serviceDay}</bdi>
                      {cellDetails(
                        cell,
                        units.find(
                          (unit) =>
                            unit.id === cell.id && unit.kind === cell.kind,
                        )!,
                      )}
                      <span>
                        {copy.batchCurrent}: {labels[cell.ownerState]}
                      </span>
                    </li>
                  )),
                )}
              </ul>
            </>
          ) : null}
          {visibleReview ? (
            <section
              aria-labelledby={reviewTitleId}
              className="cottage-calendar-review"
            >
              <h4 id={reviewTitleId}>{copy.batchIncluded}</h4>
              <p>
                <bdi dir="ltr">{visibleReview.batch.from}</bdi> ·{" "}
                <bdi dir="ltr">{visibleReview.batch.to}</bdi>
              </p>
              <p>
                {copy.batchDates}:{" "}
                {new Intl.NumberFormat(locale).format(
                  new Set(
                    visibleReview.batch.cells.map((cell) => cell.serviceDay),
                  ).size,
                )}{" "}
                · {copy.batchUnits}:{" "}
                {new Intl.NumberFormat(locale).format(
                  new Set(
                    visibleReview.batch.cells.map(
                      (cell) => `${cell.kind}:${cell.id}`,
                    ),
                  ).size,
                )}{" "}
                · {copy.batchIncluded}:{" "}
                {new Intl.NumberFormat(locale).format(
                  visibleReview.batch.cells.length,
                )}
              </p>
              <ul
                className="cottage-calendar-review-cells"
                aria-label={copy.batchIncluded as string}
              >
                {reviewedRows(
                  visibleReview.batch.cells,
                  visibleReview.calendar,
                  visibleReview.batch.state,
                )}
              </ul>
              <fieldset
                className="cottage-calendar-consent"
                disabled={batchAction.pending}
              >
                {visibleReview.batch.mode === "reviewed" ? (
                  <ChoiceControl
                    kind="checkbox"
                    checked={currentConsent.confirmed}
                    onChange={(event) =>
                      setConsent({
                        ...currentConsent,
                        confirmed: event.currentTarget.checked,
                      })
                    }
                  >
                    {copy.batchConfirm}
                  </ChoiceControl>
                ) : null}
                {requiredConsent.length ? <p>{copy.batchConsentHelp}</p> : null}
                {requiredConsent.map((cell) => {
                  const key = coordinateKey(cell);
                  const unit = units.find(
                    (unit) => unit.id === cell.id && unit.kind === cell.kind,
                  )!;
                  return (
                    <ChoiceControl
                      key={key}
                      kind="checkbox"
                      checked={currentConsent.coordinates.includes(key)}
                      onChange={(event) =>
                        setConsent({
                          ...currentConsent,
                          coordinates: event.currentTarget.checked
                            ? [...currentConsent.coordinates, key]
                            : currentConsent.coordinates.filter(
                                (value) => value !== key,
                              ),
                        })
                      }
                    >
                      {(copy.batchReplace as string)
                        .split(/(\{date\}|\{unit\})/)
                        .map((part, index) =>
                          part === "{date}" ? (
                            <bdi key={index} dir="ltr">
                              {cell.serviceDay}
                            </bdi>
                          ) : part === "{unit}" ? (
                            <bdi key={index} dir="auto">
                              {unit.label}
                            </bdi>
                          ) : (
                            part
                          ),
                        )}
                    </ChoiceControl>
                  );
                })}
              </fieldset>
              <ActionButton
                key={`${submissionScope}:${submissionVersion.generation}:apply`}
                kind="primary"
                type="button"
                focusSuccessorId={batchHeadingId}
                pending={
                  batchAction.pending &&
                  initiatingAction?.scope === submissionScope &&
                  initiatingAction.kind === "apply"
                }
                disabled={
                  batchAction.pending ||
                  !permitsTarget ||
                  requiredConsent.some(
                    (cell) =>
                      !currentConsent.coordinates.includes(coordinateKey(cell)),
                  ) ||
                  (visibleReview.batch.mode === "reviewed" &&
                    !currentConsent.confirmed)
                }
                onClick={applyChanges}
              >
                {batchAction.pending && initiatingAction?.kind === "apply"
                  ? copy.batchApplying
                  : copy.batchApply}
              </ActionButton>
            </section>
          ) : null}
          {!batchAction.pending && batchReady === batchKey ? (
            <ActionFocusTarget targetId={batchHeadingId} />
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
