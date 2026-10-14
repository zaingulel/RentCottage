import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BackofficeNavigationLinks } from "./backoffice-navigation-links";

// jsdom has no layout, so each box is stubbed by what the element is. The row
// spans 0 to 300 and its inline padding is 8, so a tab is wholly in view with
// room for its ring from 8 to 292.
const rowStyle = document.createElement("style");
rowStyle.textContent =
  ".backoffice-navigation-links { padding-left: 8px; padding-right: 8px; }";

const boxes: Record<string, { left: number; right: number }> = {
  row: { left: 0, right: 300 },
  Inside: { left: 20, right: 100 },
  Past: { left: 250, right: 324 },
  Before: { left: -20, right: 60 },
};

const scrollBy = vi.fn();

beforeEach(() => {
  document.head.appendChild(rowStyle);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const box =
        boxes[
          this.classList.contains("backoffice-navigation-links")
            ? "row"
            : (this.textContent ?? "")
        ];
      return { ...box, top: 0, bottom: 40 } as DOMRect;
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollBy", {
    configurable: true,
    value: scrollBy,
  });
});

afterEach(() => {
  rowStyle.remove();
  vi.restoreAllMocks();
  scrollBy.mockClear();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollBy");
});

function renderRow(current?: string) {
  render(
    <BackofficeNavigationLinks>
      {["Inside", "Past", "Before"].map((label) => (
        <a
          key={label}
          href={`/${label}`}
          aria-current={label === current ? "page" : undefined}
        >
          {label}
        </a>
      ))}
    </BackofficeNavigationLinks>,
  );
}

describe("BackofficeNavigationLinks", () => {
  it("scrolls the row to bring a focused tab wholly into view with room for its ring", () => {
    renderRow();

    act(() => screen.getByRole("link", { name: "Past" }).focus());
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 32 });

    act(() => screen.getByRole("link", { name: "Before" }).focus());
    expect(scrollBy).toHaveBeenCalledTimes(2);
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -28 });
  });

  it("leaves the row alone when the focused tab is already wholly in view", () => {
    renderRow();

    act(() => screen.getByRole("link", { name: "Inside" }).focus());

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("brings the current tab into view when the bar first renders", () => {
    renderRow("Past");

    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith({ left: 32 });
  });

  it("does not scroll on first render when no tab is current", () => {
    renderRow();

    expect(scrollBy).not.toHaveBeenCalled();
  });
});
