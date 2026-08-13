import { expect, test } from "@playwright/test";

test("serves the trilingual shell and health response from the Worker", async ({
  page,
  request,
}) => {
  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  await expect(health.json()).resolves.toMatchObject({
    ok: true,
    environment: "test",
    supabase: { configured: true, projectRef: "local-test" },
  });

  await page.goto("/ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("heading", { name: "بيتٌ في الريف، لكم وحدكم" }),
  ).toBeVisible();
});
