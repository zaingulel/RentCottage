import { readFileSync } from "node:fs";
import { join } from "node:path";

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

test("redirects the root address on the Worker to the Arabic home page", async ({
  baseURL,
  page,
  request,
}) => {
  if (!baseURL) throw new Error("Missing browser origin");
  const arabicHome = new URL("/ar", baseURL).href;

  const root = await request.get("/", { maxRedirects: 0 });
  expect(root.status()).toBe(307);
  expect(new URL(root.headers().location, baseURL).href).toBe(arabicHome);

  await page.goto("/");
  await expect(page).toHaveURL(arabicHome);
  await expect(
    page.getByRole("heading", { name: "بيتٌ في الريف، لكم وحدكم" }),
  ).toBeVisible();
});

test("refuses a Server Action posted to the Worker from a foreign origin", async ({
  baseURL,
  request,
}) => {
  if (!baseURL) throw new Error("Missing browser origin");
  // The action identifier changes with every build, so it comes from the build's own manifest.
  const manifest = JSON.parse(
    readFileSync(
      join(process.cwd(), ".next/server/server-reference-manifest.json"),
      "utf8",
    ),
  ) as { node: Record<string, { exportedName: string; filename: string }> };
  const identifiers = Object.entries(manifest.node)
    .filter(
      ([, action]) =>
        action.exportedName === "requestPhoneAccess" &&
        action.filename === "src/access/actions.ts",
    )
    .map(([identifier]) => identifier);
  expect(identifiers).toHaveLength(1);

  const postAction = (origin: Record<string, string>) =>
    request.post("/en/access", {
      headers: {
        "Next-Action": identifiers[0],
        "Content-Type": "text/plain;charset=UTF-8",
        Accept: "text/x-component",
        ...origin,
      },
      data: '["not-a-phone"]',
    });

  const ownOrigin = await postAction({ Origin: new URL(baseURL).origin });
  expect(ownOrigin.status()).toBe(200);
  await expect(ownOrigin.text()).resolves.toContain(
    '{"status":"invalid_phone"}',
  );

  const foreignOrigins: Record<string, string>[] = [
    { Origin: "https://attacker.example" },
    {
      Origin: "https://attacker.example",
      "X-Forwarded-Host": "attacker.example",
    },
  ];
  for (const foreignOrigin of foreignOrigins) {
    const refused = await postAction(foreignOrigin);
    expect(refused.status()).toBe(500);
    const body = await refused.text();
    // Digest of Next.js error E80, "Invalid Server Actions request.", raised by the origin check.
    expect(body).toContain('@E80"');
    expect(body).not.toContain("invalid_phone");
  }
});
