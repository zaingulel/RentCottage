import { messages } from "@/i18n/messages";
import { locales, type Locale } from "@/i18n/routing";

export function LocaleButtons({
  locale,
  onChange,
  className,
}: {
  locale: Locale;
  onChange: (locale: Locale) => void;
  className: string;
}) {
  return (
    <nav className={className} aria-label="Language">
      {locales.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={locale === option}
          onClick={() => onChange(option)}
        >
          {messages[option].languageName}
        </button>
      ))}
    </nav>
  );
}
