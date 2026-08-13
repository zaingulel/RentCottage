"use client";

import { useLayoutEffect, useState } from "react";

import { directionFor, replaceLocaleInUrl, type Locale } from "./routing";

export function useRoutedLocale(initialLocale: Locale) {
  const [locale, setLocale] = useState(initialLocale);

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = directionFor(locale);
  }, [locale]);

  function changeLocale(nextLocale: Locale) {
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.history.replaceState(
      window.history.state,
      "",
      replaceLocaleInUrl(currentUrl, nextLocale),
    );
    setLocale(nextLocale);
  }

  return { locale, changeLocale };
}
