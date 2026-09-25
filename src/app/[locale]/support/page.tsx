import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/routing";
import { supportMessages } from "@/i18n/support-messages";
import styles from "./support.module.css";

export default async function SupportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = supportMessages[locale];

  return (
    <main className={styles.page}>
      <Link href={`/${locale}`}>{copy.home}</Link>
      <h1>{copy.title}</h1>
      <div className={styles.notice} role="status">
        <strong>{copy.preLive}</strong>
        <p>{copy.notice}</p>
      </div>
      <div className={styles.topics}>
        <section>
          <h2>{copy.complaints}</h2>
          <p>{copy.complaintsText}</p>
        </section>
        <section>
          <h2>{copy.incidents}</h2>
          <p>{copy.incidentsText}</p>
        </section>
        <section>
          <h2>{copy.disputes}</h2>
          <p>{copy.disputesText}</p>
        </section>
        <section>
          <h2>{copy.reviews}</h2>
          <p>{copy.reviewsText}</p>
        </section>
      </div>
      <nav className={styles.records} aria-label={copy.records}>
        <h2>{copy.records}</h2>
        <p>{copy.recordsText}</p>
        <Link href={`/${locale}/bookings`}>{copy.customerBookings}</Link>
        <Link href={`/${locale}/bookings?workspace=owner`}>
          {copy.ownerBookings}
        </Link>
      </nav>
    </main>
  );
}
