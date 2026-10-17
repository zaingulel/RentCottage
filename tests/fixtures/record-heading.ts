import { writeFile } from "node:fs/promises";
import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

export async function observeRecordHeading(
  page: Page,
  testInfo: TestInfo,
  name: string,
  href: string,
  label: string,
): Promise<Locator> {
  const heading = page.getByRole("main").locator("header.page-heading");
  await expect(heading.getByRole("heading", { level: 1 })).toBeVisible();
  const returnLink = heading.getByRole("link", { name, exact: true });
  await expect(returnLink).toBeVisible();
  await expect(returnLink).toHaveAttribute("href", href);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect
    .poll(() =>
      heading.evaluate((header) => {
        const link = header.querySelector("a");
        const title = header.querySelector("h1");
        if (!link || !title)
          throw new Error("Heading return or title is missing");
        const linkBox = link.getBoundingClientRect();
        const titleBox = title.getBoundingClientRect();
        const headingBox = header.getBoundingClientRect();
        const rtl = getComputedStyle(header).direction === "rtl";
        return {
          above: linkBox.bottom <= titleBox.top,
          contained: [linkBox, titleBox].every(
            (box) =>
              box.left >= Math.max(0, headingBox.left) - 1 &&
              box.right <= Math.min(innerWidth, headingBox.right) + 1,
          ),
          startAligned:
            Math.abs(
              rtl
                ? linkBox.right - titleBox.right
                : linkBox.left - titleBox.left,
            ) < 1,
        };
      }),
    )
    .toEqual({ above: true, contained: true, startAligned: true });
  await returnLink.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(returnLink).toBeFocused();
  await expect
    .poll(() =>
      returnLink.evaluate(
        (link) =>
          link.matches(":focus-visible") &&
          getComputedStyle(link).outlineStyle === "solid" &&
          parseFloat(getComputedStyle(link).outlineWidth) >= 2,
      ),
    )
    .toBe(true);
  const observationPath = testInfo.outputPath(`${label}.json`);
  await writeFile(
    observationPath,
    JSON.stringify(
      await returnLink.evaluate((link, view) => {
        const style = getComputedStyle(link);
        const backgrounds = [];
        for (
          let element: Element | null = link;
          element;
          element = element.parentElement
        ) {
          const ancestorStyle = getComputedStyle(element);
          backgrounds.push({
            element: element.tagName,
            id: element.id,
            backgroundColor: ancestorStyle.backgroundColor,
            backgroundImage: ancestorStyle.backgroundImage,
          });
        }
        const otherPointerTargets = Array.from(
          document.querySelectorAll(
            "a[href], button, input, select, textarea, summary, [role=button]",
          ),
        )
          .filter((target) => {
            if (
              target === link ||
              link.contains(target) ||
              target.contains(link) ||
              target.matches(":disabled") ||
              target.closest('[aria-disabled="true"], [inert]')
            )
              return false;
            const rectangle = target.getBoundingClientRect();
            if (
              rectangle.width === 0 ||
              rectangle.height === 0 ||
              getComputedStyle(target).pointerEvents === "none"
            )
              return false;
            for (
              let element: Element | null = target;
              element;
              element = element.parentElement
            ) {
              const targetStyle = getComputedStyle(element);
              if (
                targetStyle.display === "none" ||
                targetStyle.visibility === "hidden" ||
                targetStyle.visibility === "collapse" ||
                parseFloat(targetStyle.opacity) === 0
              )
                return false;
            }
            return true;
          })
          .map((target) => ({
            element: target.tagName,
            id: target.id,
            rectangle: target.getBoundingClientRect().toJSON(),
          }));
        return {
          locale: document.documentElement.lang,
          view,
          viewport: { width: innerWidth, height: innerHeight },
          accessibleText: link.textContent?.trim(),
          href: link.getAttribute("href"),
          title: link
            .closest("header")
            ?.querySelector("h1")
            ?.textContent?.trim(),
          rectangle: link.getBoundingClientRect().toJSON(),
          activeElement: {
            element: document.activeElement?.tagName,
            id: document.activeElement?.id,
            isReturnLink: document.activeElement === link,
          },
          focusVisible: link.matches(":focus-visible"),
          textColor: style.color,
          outline: {
            style: style.outlineStyle,
            width: style.outlineWidth,
            color: style.outlineColor,
          },
          shadow: style.boxShadow,
          backgrounds,
          otherPointerTargets,
        };
      }, label),
      null,
      2,
    ),
  );
  await testInfo.attach(label, {
    path: observationPath,
    contentType: "application/json",
  });
  return returnLink;
}
