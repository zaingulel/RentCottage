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

  const malformedMedia = await request.get("/api/cottage-media/not-a-uuid");
  const unavailableMedia = await request.get(
    "/api/cottage-media/40000000-0000-4000-8000-000000000024",
  );
  for (const response of [malformedMedia, unavailableMedia]) {
    expect(response.status()).toBe(404);
    expect(response.headers()["cache-control"]).toContain("private");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers().location).toBeUndefined();
    await expect(response.text()).resolves.toBe(
      "Publication media is unavailable",
    );
  }

  await page.goto("/ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("heading", { name: "بيتٌ في الريف، لكم وحدكم" }),
  ).toBeVisible();
});
