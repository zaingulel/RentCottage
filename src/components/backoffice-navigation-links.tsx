"use client";

import { useEffect, useRef, type FocusEvent, type ReactNode } from "react";

// Chromium scrolls a focused tab into view only when it is wholly hidden, so a
// partly visible tab keeps its focus ring cut off. Scroll only the row, never
// the page, on physical edges so it is correct in both directions.
function reveal(row: HTMLElement, tab: Element) {
  const rowBox = row.getBoundingClientRect();
  const tabBox = tab.getBoundingClientRect();
  const style = getComputedStyle(row);
  const beyondLeft =
    tabBox.left - (rowBox.left + parseFloat(style.paddingLeft));
  const beyondRight =
    tabBox.right - (rowBox.right - parseFloat(style.paddingRight));

  if (beyondLeft < 0) {
    row.scrollBy({ left: beyondLeft });
  } else if (beyondRight > 0) {
    row.scrollBy({ left: beyondRight });
  }
}

export function BackofficeNavigationLinks({
  children,
}: {
  children: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const current = row.current?.querySelector("[aria-current]");
    if (row.current && current) reveal(row.current, current);
  }, []);

  function revealFocused(event: FocusEvent<HTMLDivElement>) {
    const tab =
      event.target instanceof Element ? event.target.closest("a") : null;
    if (tab) reveal(event.currentTarget, tab);
  }

  return (
    <div
      ref={row}
      className="backoffice-navigation-links"
      onFocus={revealFocused}
    >
      {children}
    </div>
  );
}
