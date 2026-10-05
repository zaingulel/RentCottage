import { ActionLink } from "@/components/interaction-controls";
import { messages } from "@/i18n/messages";
import type { Locale } from "@/i18n/routing";

export function NotFoundScreen({ locale }: { locale: Locale }) {
  const copy = messages[locale];
  return (
    <main className="results-page">
      <header className="results-header">
        <ActionLink kind="text" href={`/${locale}`}>
          {copy.notFoundHome}
        </ActionLink>
      </header>
      <section className="results-intro">
        <p>{copy.brand}</p>
        <h1>{copy.notFoundTitle}</h1>
        <span>{copy.notFoundDetail}</span>
      </section>
    </main>
  );
}
