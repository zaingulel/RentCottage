import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import {
  Miniflare,
  Response as NativeResponse,
  type MiniflareOptions,
} from "miniflare";

import { openHeaderPanel } from "./fixtures/site-header";

test("hosted demo admission rejects unauthenticated asset and action requests", async () => {
  const wrangler = JSON.parse(
    readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8").replace(
      /,\s*([}\]])/g,
      "$1",
    ),
  );
  const demo = wrangler.env.demo;
  const assets = demo?.assets ?? wrangler.assets;
  const target = {
    workerOrigin: "https://invited-demo.example.workers.dev",
    supabaseProjectRef: "demo-fixture",
    accessIssuer: "https://fixture.cloudflareaccess.com",
    accessAudience: "fixture-application-audience",
  };
  const bundled = await build({
    entryPoints: [demo?.main ?? wrangler.main],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    external: ["node:*", "cloudflare:*"],
    plugins: [
      {
        name: "hosted-demo-native-boundaries",
        setup(builder) {
          builder.onResolve({ filter: /\.open-next\/worker\.js$/ }, () => ({
            path: "opennext-sentinel",
            namespace: "admission-fixture",
          }));
          builder.onResolve({ filter: /hosted-demo-target$/ }, () => ({
            path: "target",
            namespace: "admission-fixture",
          }));
          builder.onLoad(
            { filter: /.*/, namespace: "admission-fixture" },
            ({ path }) => ({
              contents:
                path === "target"
                  ? `export const hostedDemoTarget = ${JSON.stringify(target)};`
                  : `export default { async fetch(request, env) {
                if (new URL(request.url).pathname === "/admission-fixture.txt") return env.ASSETS.fetch(request);
                return new Response("OpenNext forwarding sentinel", { headers: { "x-admission-forwarded": "true" } });
              } };`,
              loader: "js",
            }),
          );
        },
      },
    ],
  });
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const forgedKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = {
    ...keys.publicKey.export({ format: "jwk" }),
    kid: "fixture-key",
    alg: "RS256",
    use: "sig",
  };
  const now = Math.floor(Date.now() / 1000);
  const token = (
    claims: Record<string, unknown> = {},
    key = keys.privateKey,
    header: Record<string, unknown> = {},
  ) => {
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const data = `${encode({ alg: "RS256", kid: "fixture-key", ...header })}.${encode(
      {
        iss: target.accessIssuer,
        aud: target.accessAudience,
        email: "invited@example.test",
        iat: now,
        exp: now + 3600,
        ...claims,
      },
    )}`;
    return `${data}.${sign("RSA-SHA256", Buffer.from(data), key).toString("base64url")}`;
  };
  const valid = token();
  const directory = mkdtempSync(join(tmpdir(), "rentcottage-818-admission-"));
  let runtime: Miniflare | undefined;
  let jwksUnavailable = true;
  const outboundUrls: string[] = [];
  const bindings = {
    APP_ENVIRONMENT: "preview",
    HOSTED_DEMO: "true",
    SUPABASE_PROJECT_REF: "demo-fixture",
    SUPABASE_URL: "https://demo-fixture.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "fixture-publishable",
    SUPABASE_SECRET_KEY: "fixture-secret",
    PRIVILEGED_AUDIT_HMAC_KEY: "fixture-audit-key-with-at-least-32-characters",
    DEPLOYMENT_COMMIT: "b".repeat(40),
  };
  const options = (
    values: Record<string, string> = bindings,
  ): MiniflareOptions => ({
    host: "127.0.0.1",
    telemetry: { enabled: false },
    workers: [
      {
        config: {
          name: "hosted-demo-admission-fixture",
          compatibilityDate: wrangler.compatibility_date,
          compatibilityFlags: wrangler.compatibility_flags,
          manifest: {
            mainModule: "worker.js",
            modules: {
              "worker.js": {
                type: "esm",
                contents: bundled.outputFiles[0].text,
              },
            },
          },
          env: {
            ...Object.fromEntries(
              Object.entries(values).map(([name, value]) => [
                name,
                { type: "text" as const, value },
              ]),
            ),
            [assets.binding]: { type: "assets" },
          },
          assets: {
            directory,
            hasUserWorker: true,
            runWorkerFirst: assets.run_worker_first ?? false,
          },
        },
        dev: {
          outboundService: {
            type: "fetcher",
            handler(request) {
              outboundUrls.push(request.url);
              if (
                request.url !==
                "https://fixture.cloudflareaccess.com/cdn-cgi/access/certs"
              ) {
                throw new Error("Unexpected fixture outbound request");
              }
              return jwksUnavailable
                ? new NativeResponse("Unavailable", { status: 503 })
                : NativeResponse.json({ keys: [jwk] });
            },
          },
        },
      },
    ],
  });
  try {
    writeFileSync(
      join(directory, "admission-fixture.txt"),
      "native protected asset",
    );
    runtime = new Miniflare(options());
    const denied = async (
      url: string,
      assertion?: string,
      headers: Record<string, string> = {},
      method = "GET",
    ) => {
      const response = await runtime!.dispatchFetch(url, {
        method,
        headers: {
          ...(assertion ? { "Cf-Access-Jwt-Assertion": assertion } : {}),
          ...headers,
        },
      });
      expect(response.status, `${method} ${url}`).toBe(403);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("x-admission-forwarded")).toBeNull();
      expect(await response.text()).toBe("Access denied");
    };
    for (const [path, method] of [
      ["/en", "GET"],
      ["/admission-fixture.txt", "GET"],
      ["/en/access", "POST"],
    ]) {
      await denied(
        `${target.workerOrigin}${path}`,
        undefined,
        method === "POST" ? { "Next-Action": "fixture-action" } : {},
        method,
      );
    }
    await denied(`${target.workerOrigin}/en`, valid);
    expect(outboundUrls).toEqual([
      "https://fixture.cloudflareaccess.com/cdn-cgi/access/certs",
    ]);
    jwksUnavailable = false;
    for (const [path, method, body] of [
      ["/en", "GET", "OpenNext forwarding sentinel"],
      ["/admission-fixture.txt", "GET", "native protected asset"],
      ["/en/access", "POST", "OpenNext forwarding sentinel"],
    ]) {
      const response = await runtime.dispatchFetch(
        `${target.workerOrigin}${path}`,
        {
          method,
          headers: {
            "Cf-Access-Jwt-Assertion": valid,
            "Next-Action": "fixture-action",
          },
        },
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(body);
    }
    for (const invalid of [
      "malformed",
      token({}, forgedKeys.privateKey),
      token({ exp: now - 3600 }),
      token({ exp: undefined }),
      token({ iss: "https://attacker.cloudflareaccess.com" }),
      token({ aud: "other-application" }),
      token({ email: "  " }),
      token({ email: undefined }),
      token({}, keys.privateKey, { kid: "unknown-key" }),
      token({}, keys.privateKey, { alg: "RS512" }),
    ])
      await denied(`${target.workerOrigin}/en`, invalid);
    await denied("https://alternate.example.workers.dev/en", valid);
    await denied("https://alternate.example.workers.dev/en", valid, {
      "X-Forwarded-Host": "invited-demo.example.workers.dev",
      Forwarded: "host=invited-demo.example.workers.dev",
    });
    for (const patch of [
      { HOSTED_DEMO: "TRUE" },
      { HOSTED_DEMO: "" },
      { APP_ENVIRONMENT: "production" },
      { SUPABASE_URL: "https://user:password@demo-fixture.supabase.co" },
      {
        SUPABASE_PROJECT_REF: "other-project",
        SUPABASE_URL: "https://other-project.supabase.co",
      },
      { DEPLOYMENT_COMMIT: "bad-commit" },
    ]) {
      await runtime.setOptions(options({ ...bindings, ...patch }));
      await denied(`${target.workerOrigin}/en`, valid);
    }
    await runtime.setOptions(
      options(
        Object.fromEntries(
          Object.entries(bindings).filter(([name]) => name !== "HOSTED_DEMO"),
        ),
      ),
    );
    await denied(`${target.workerOrigin}/en`, valid);
    expect(
      outboundUrls.every(
        (url) =>
          url === "https://fixture.cloudflareaccess.com/cdn-cgi/access/certs",
      ),
    ).toBe(true);
  } finally {
    await runtime?.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});

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

  const malformedPhoto = await request.get(
    "/api/cottage-profile-photos/not-a-uuid",
  );
  const signedOutPhoto = await request.get(
    "/api/cottage-profile-photos/40000000-0000-4000-8000-000000000024",
  );
  for (const response of [malformedPhoto, signedOutPhoto]) {
    expect(response.status()).toBe(404);
    expect(response.headers()["cache-control"]).toContain("private");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers().location).toBeUndefined();
    await expect(response.text()).resolves.toBe(
      "Cottage Profile photo is unavailable",
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
    // Next.js exposes an opaque error digest, not a stable origin-error identifier.
    expect(body).toMatch(/"digest"\s*:\s*"[^"\r\n]+"/);
    expect(body).not.toContain("invalid_phone");
  }
});

test("shows the translated not-found screen inside the site header and footer", async ({
  page,
}) => {
  const unknownAddresses = [
    {
      path: "/en/no-such-page",
      locale: "en",
      dir: "ltr",
      title: "Page not found",
    },
    {
      path: "/ar/no-such-page",
      locale: "ar",
      dir: "rtl",
      title: "الصفحة غير موجودة",
    },
    {
      path: "/ckb/no-such-page",
      locale: "ckb",
      dir: "rtl",
      title: "پەڕەکە نەدۆزرایەوە",
    },
    {
      path: "/en/booking-requests/unknown",
      locale: "en",
      dir: "ltr",
      title: "Page not found",
    },
  ];
  for (const { path, locale, dir, title } of unknownAddresses) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("html")).toHaveAttribute("dir", dir);
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: title, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("main").getByRole("link")).toHaveAttribute(
      "href",
      `/${locale}`,
    );
  }
});

test("shows the Arabic not-found screen when the address has no recognisable language", async ({
  page,
}) => {
  for (const path of ["/no-such-language", "/no-such-language/deeper"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const banner = page.getByRole("banner");
    await expect(banner).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "الصفحة غير موجودة",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("main").getByRole("link")).toHaveAttribute(
      "href",
      "/ar",
    );
    await openHeaderPanel(page, "language");
    const languageLinks = [
      { name: "العربية", href: "/ar" },
      { name: "کوردی", href: "/ckb" },
      { name: "English", href: "/en" },
    ];
    for (const { name, href } of languageLinks) {
      await expect(
        banner.getByRole("link", { name, exact: true }),
      ).toHaveAttribute("href", href);
    }
  }
});
