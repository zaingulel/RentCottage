import { notFound } from "next/navigation";

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
    <main className="owner-application-page access-required-page">
      <form
        className="access-required-card"
        action={`/${locale}/administrator/payments/lookup`}
        method="get"
      >
        <p>{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <label htmlFor="payment-reference">{copy.lookupLabel}</label>
        <input
          id="payment-reference"
          className="form-control"
          name="reference"
          required
          pattern="RC-REQ-[A-F0-9]{16}"
          autoComplete="off"
          dir="ltr"
        />
        <button type="submit">{copy.lookupAction}</button>
      </form>
    </main>
  );
}
