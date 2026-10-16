import { notFound } from "next/navigation";

import { ActionButton } from "@/components/interaction-controls";
import { administratorPaymentHistoryMessages } from "@/i18n/administrator-payment-history-messages";
import { isLocale } from "@/i18n/routing";

export default async function AdministratorPaymentLookupPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = administratorPaymentHistoryMessages[locale];
  return (
    <main className="page results-page page-record">
      <header className="page-heading">
        <h1 className="page-title">{copy.title}</h1>
      </header>
      <form
        className="administrator-payment-lookup"
        action={`/${locale}/administrator/payments/lookup`}
        method="get"
      >
        <label htmlFor="payment-reference">
          <span>{copy.lookupLabel}</span>
          <input
            id="payment-reference"
            className="form-control"
            name="reference"
            required
            pattern="RC-REQ-[A-F0-9]{16}"
            autoComplete="off"
            dir="ltr"
          />
        </label>
        <ActionButton kind="primary" type="submit">
          {copy.lookupAction}
        </ActionButton>
      </form>
    </main>
  );
}
