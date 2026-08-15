import { messages } from "@/i18n/messages";
import { locales, type Locale } from "@/i18n/routing";

import { ActionButton } from "./interaction-controls";

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
        <ActionButton
          key={option}
          kind="toggle"
          size="compact"
          type="button"
          pressed={locale === option}
          onClick={() => onChange(option)}
        >
          {messages[option].languageName}
        </ActionButton>
      ))}
    </nav>
  );
}
