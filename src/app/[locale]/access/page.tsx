import { notFound, redirect } from "next/navigation";
import { resolveRequestAccount } from "@/access/request-account-context";
import { safeReturnDestination } from "@/access/return-destination";
import { PhoneAccessForm } from "@/components/phone-access-form";
import { OwnerEnrollmentForm } from "@/components/owner-enrollment-form";
import { AccountAccessRecovery } from "@/components/account-access-recovery";
import { accessMessages } from "@/i18n/access-messages";
import { isLocale } from "@/i18n/routing";
export default async function AccountAccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const returnTo = safeReturnDestination(locale, (await searchParams).returnTo);
  const account = await resolveRequestAccount();
  const copy = accessMessages[locale];
  if (account.status === "unavailable")
    return (
      <AccountAccessRecovery
        locale={locale}
        status="unavailable"
        returnTo={`/${locale}/access?returnTo=${encodeURIComponent(returnTo)}`}
      />
    );
  if (account.status === "authenticated" && account.context) {
    if (account.context.role === "platform_administrator")
      return (
        <AccountAccessRecovery
          locale={locale}
          status="denied"
          returnTo={`/${locale}/administrator/access`}
        />
      );
    if (
      returnTo.startsWith(`/${locale}/owner/`) &&
      account.context.role === "customer"
    )
      return (
        <main className="standalone-access">
          <OwnerEnrollmentForm locale={locale} returnTo={returnTo} />
        </main>
      );
    if (
      returnTo === `/${locale}/owner/application` &&
      account.context.role === "cottage_owner" &&
      account.context.approvalState !== "prospective"
    )
      redirect(`/${locale}/owner/cottages`);
    redirect(returnTo);
  }
  return (
    <main className="standalone-access">
      <h1>{copy.accessTitle}</h1>
      <p>{copy.accessIntro}</p>
      <PhoneAccessForm locale={locale} returnTo={returnTo} />
    </main>
  );
}
