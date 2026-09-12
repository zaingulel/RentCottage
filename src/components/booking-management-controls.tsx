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
  action: "cancel" | "refund";
}) {
  const c = bookingManagementMessages[locale];
  const [state, submit, pending] = useActionState(manageConfirmedBooking, idle);
  const [reason, setReason] = useState(""),
    [category, setCategory] = useState(""),
    [price, setPrice] = useState("0"),
    [fee, setFee] = useState("0");
  let total: number | null = null;
  if (action === "refund") {
    try {
      total = refundAllocationTotal(refundInputAllocation(price, fee));
    } catch {
      /* Field errors are shown by the server action. */
    }
  }
  return (
    <form
      action={submit}
      className={styles.form}
      aria-label={action === "cancel" ? c.cancel : c.exception}
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="reference" value={reference} />
      <input type="hidden" name="actorRole" value={actorRole} />
      <input type="hidden" name="commandId" value={commandId} />
      <input type="hidden" name="action" value={action} />
      <h3>{action === "cancel" ? c.cancel : c.exception}</h3>
      <p>
        {action === "refund"
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
      {actorRole !== "customer" ? (
        <label>
          {c.reason}
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
      ) : (
        <label className={styles.acknowledge}>
          <input type="checkbox" name="acknowledge" required />
          {c.acknowledge}
        </label>
      )}
      <ActionButton
        type="submit"
        kind="primary"
        width="content"
        pending={pending}
      >
        {action === "cancel" ? c.cancel : c.approve}
      </ActionButton>
      {state.status === "invalid" ||
      state.status === "unavailable" ||
      state.status === "access-required" ? (
        <ActionFeedback kind="error">
          {state.status === "invalid"
            ? c.invalid
            : state.status === "access-required"
              ? c.accessRequired
              : c.unavailable}
        </ActionFeedback>
      ) : state.status === "cancelled" || state.status === "requested" ? (
        <ActionFeedback kind="success">
          {state.status === "cancelled" ? c.cancelSuccess : c.refundSuccess}
        </ActionFeedback>
      ) : null}
    </form>
  );
}
