import type { Locale } from "@/i18n/routing";
import { ActionLink } from "./interaction-controls";

const copy = {
  ar: {
    title: "تعذر استخدام هذا البحث",
    detail: "راجع التواريخ والفترات وعدد الضيوف ثم حاول مرة أخرى.",
    back: "ابدأ بحثاً جديداً",
  },
  ckb: {
    title: "ئەم گەڕانە بەکارناهێنرێت",
    detail: "بەروار و شیفت و ژمارەی میوان بپشکنە و دووبارە هەوڵ بدەرەوە.",
    back: "گەڕانێکی نوێ دەست پێ بکە",
  },
  en: {
    title: "This search cannot be used",
    detail: "Check the dates, shifts, and guest count, then try again.",
    back: "Start a new search",
  },
} as const;

export function InvalidCottageSearch({ locale }: { locale: Locale }) {
  const messages = copy[locale];
  return (
    <main className="results-page page">
      <header className="page-heading">
        <ActionLink kind="text" href={`/${locale}`}>
          {messages.back}
        </ActionLink>
        <h1 className="page-title">{messages.title}</h1>
        <p>{messages.detail}</p>
      </header>
    </main>
  );
}
