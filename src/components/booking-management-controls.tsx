"use client";
import { useActionState, useState } from "react";
import {
  manageConfirmedBooking,
  type BookingManagementActionState,
} from "@/booking-request/booking-management-actions";
import type { BookingParticipantRole } from "@/booking-request/booking-financial-view";
import { refundInputAllocation } from "@/booking-request/booking-financial-presentation";
import { refundAllocationTotal } from "@/payment/payment-refund-allocation";
import { formatFilsAsIqd } from "@/i18n/format";
import { bookingManagementMessages } from "@/i18n/booking-management-messages";
import { bookingLifecycleMessages } from "@/i18n/booking-lifecycle-messages";
import type { Locale } from "@/i18n/routing";
import {
  ActionButton,
  ActionFeedback,
  FormControl,
} from "./interaction-controls";
import styles from "./booking-financial-details.module.css";
const idle: BookingManagementActionState = { status: "idle" };
export function BookingManagementControl({
  locale,
  reference,
  actorRole,
  commandId,
  action,
}: {
  locale: Locale;
  reference: string;
  actorRole: BookingParticipantRole;
  commandId: string;
  action: "cancel" | "refund" | "no_show" | "incident";
}) {
  const c = bookingManagementMessages[locale],
    l = bookingLifecycleMessages[locale];
  const lifecycleAction = action === "no_show" || action === "incident";
  const label =
    action === "cancel"
      ? c.cancel
      : action === "refund"
        ? c.exception
        : action === "no_show"
          ? l.markNoShow
          : l.report;
  const [reason, setReason] = useState(""),
    [category, setCategory] = useState(""),
    [price, setPrice] = useState("0"),
    [fee, setFee] = useState("0");
  const [state, submit, pending] = useActionState(
    async (previous: BookingManagementActionState, form: FormData) => {
      const result = await manageConfirmedBooking(previous, form);
      if (result.status === "recorded") {
        setReason("");
        setCategory("");
      }
      return result;
    },
    idle,
  );
  let total: number | null = null;
  if (action === "refund") {
    try {
      total = refundAllocationTotal(refundInputAllocation(price, fee));
    } catch {
      /* Field errors are shown by the server action. */
    }
  }
  return (
    <form action={submit} className={styles.form} aria-label={label}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="reference" value={reference} />
      <input type="hidden" name="actorRole" value={actorRole} />
      <input type="hidden" name="commandId" value={commandId} />
      <input type="hidden" name="action" value={action} />
      <h3>{label}</h3>
      <p>
        {action === "no_show"
          ? l.noShowHelp
          : action === "incident"
            ? l.privateHelp
            : action === "refund"
              ? c.exceptionHelp
              : actorRole === "customer"
                ? c.policy
                : actorRole === "cottage_owner"
                  ? c.ownerPolicy
                  : c.adminPolicy}
      </p>
      {action === "cancel" && actorRole === "platform_administrator" ? (
        <label>
          {c.category}
          <FormControl
            kind="select"
            name="category"
            required
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">{c.chooseCategory}</option>
            {(["safety", "fraud", "legal", "serious_operational"] as const).map(
              (value) => (
                <option key={value} value={value}>
                  {c[value]}
                </option>
              ),
            )}
          </FormControl>
        </label>
      ) : null}
      {action === "incident" ? (
        <label>
          {l.category}
          <FormControl
            kind="select"
            name="category"
            required
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">{l.chooseCategory}</option>
            {(["safety", "property_damage", "conduct", "other"] as const).map(
              (value) => (
                <option key={value} value={value}>
                  {l[value]}
                </option>
              ),
            )}
          </FormControl>
        </label>
      ) : null}
      {actorRole !== "customer" ? (
        <label>
          {lifecycleAction ? l.reason : c.reason}
          <FormControl
            kind="textarea"
            name="reason"
            required
            maxLength={2000}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      ) : null}
      {action === "refund" ? (
        <>
          <p id={`precision-${commandId}`}>{c.precision}</p>
          <div className={styles.amounts}>
            <label>
              {c.priceInput}
              <FormControl
                kind="input"
                name="price"
                inputMode="decimal"
                dir="ltr"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                aria-describedby={`precision-${commandId}`}
              />
            </label>
            <label>
              {c.feeInput}
              <FormControl
                kind="input"
                name="fee"
                inputMode="decimal"
                dir="ltr"
                required
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                aria-describedby={`precision-${commandId}`}
              />
            </label>
          </div>
          {total !== null ? (
            <p aria-live="polite">
              {c.total}: <strong>{formatFilsAsIqd(total, locale)}</strong>
            </p>
          ) : null}
        </>
      ) : action === "cancel" ? (
        <label className={styles.acknowledge}>
          <input type="checkbox" name="acknowledge" required />
          {c.acknowledge}
        </label>
      ) : null}
      <ActionButton
        type="submit"
        kind="primary"
        width="content"
        pending={pending}
      >
        {action === "refund" ? c.approve : label}
      </ActionButton>
      {state.status === "conflict" ||
      state.status === "invalid" ||
      state.status === "unavailable" ||
      state.status === "access-required" ? (
        <ActionFeedback kind="error">
          {state.status === "conflict"
            ? l.conflict
            : state.status === "invalid"
              ? c.invalid
              : state.status === "access-required"
                ? c.accessRequired
                : c.unavailable}
        </ActionFeedback>
      ) : state.status === "cancelled" ||
        state.status === "requested" ||
        state.status === "recorded" ||
        state.status === "no_show" ? (
        <ActionFeedback kind="success">
          {state.status === "cancelled"
            ? c.cancelSuccess
            : state.status === "requested"
              ? c.refundSuccess
              : state.status === "recorded"
                ? l.recorded
                : l.noShowRecorded}
        </ActionFeedback>
      ) : null}
    </form>
  );
}
