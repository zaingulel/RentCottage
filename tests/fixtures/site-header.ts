import { expect, type Page } from "@playwright/test";

const toggles = {
  language: 'button[aria-controls="site-header-language"]',
  menu: 'button[aria-controls^="site-header-account"]',
} as const;

// The button that opens a panel has a different name at each width (Menu on a phone, Account on
// desktop), so it is found by the panel it controls. Where the links are already in the row, no
// button is shown and nothing is pressed.
export async function openHeaderPanel(page: Page, panel: keyof typeof toggles) {
  const buttons = page.getByRole("banner").locator(toggles[panel]);
  await expect(buttons.first()).toBeAttached();
  const toggle = buttons.filter({ visible: true });
  if ((await toggle.count()) === 0) return;
  if ((await toggle.getAttribute("aria-expanded")) === "true") return;
  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}
