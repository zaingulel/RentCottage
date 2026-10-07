import { ActionLink } from "@/components/interaction-controls";
import { accessMessages } from "@/i18n/access-messages";
import { administratorPaymentHistoryMessages } from "@/i18n/administrator-payment-history-messages";
import { administratorRecordsMessages } from "@/i18n/administrator-records-messages";
import { cottageProfileMessages } from "@/i18n/cottage-profile-messages";
import type { Locale } from "@/i18n/routing";

type BackofficeNavigationProps = { locale: Locale; nested?: boolean } & (
  | { area: "owner"; current: "cottages" }
  | {
      area: "administrator";
      current: "owner-applications" | "cottages" | "payments";
    }
);

export function BackofficeNavigation({
  locale,
  nested,
  area,
  current,
}: BackofficeNavigationProps) {
  const access = accessMessages[locale];
  const profile = cottageProfileMessages[locale];
  const label = area === "owner" ? profile.eyebrow : profile.adminEyebrow;
  const destinations =
    area === "owner"
      ? [
          {
            key: "cottages",
            href: `/${locale}/owner/cottages`,
            label: access.manageCottages,
          },
          {
            key: "bookings",
            href: `/${locale}/bookings?workspace=owner`,
            label: access.ownerBookings,
          },
        ]
      : [
          {
            key: "owner-applications",
            href: `/${locale}/administrator/owner-applications`,
            label: access.reviewApplications,
          },
          {
            key: "cottages",
            href: `/${locale}/administrator/cottages`,
            label: access.manageCottageProfiles,
          },
          {
            key: "payments",
            href: `/${locale}/administrator/payments`,
            label: administratorPaymentHistoryMessages[locale].title,
          },
          {
            key: "records",
            href: `/${locale}/administrator/records`,
            label: administratorRecordsMessages[locale].records,
          },
        ];

  return (
    <nav
      className="backoffice-navigation"
      aria-labelledby="backoffice-navigation-area"
    >
      <span
        id="backoffice-navigation-area"
        className="backoffice-navigation-area"
      >
        {label}
      </span>
      <div className="backoffice-navigation-links">
        {destinations.map((destination) => (
          <ActionLink
            key={destination.key}
            kind="secondary"
            width="content"
            href={destination.href}
            aria-current={
              destination.key === current
                ? nested
                  ? "true"
                  : "page"
                : undefined
            }
          >
            {destination.label}
          </ActionLink>
        ))}
      </div>
    </nav>
  );
}
