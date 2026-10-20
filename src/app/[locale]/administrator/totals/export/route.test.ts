import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

import { administratorBookingMoneyExportMessages } from "@/i18n/administrator-booking-money-export-messages";

const { prepare } = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock(
  "@/administrator-records/supabase-administrator-booking-money-export",
  () => ({
    exportAdministratorBookingMoney: prepare,
  }),
);

import * as route from "./route";

const origin = "https://rentcottage.example";
const exportId = "43000000-0000-4000-8000-000000000901";
const search = {
  state: "completed",
  from: "2026-10-01",
  through: "2026-10-03",
  afterAt: null,
  afterId: null,
};
const context = (locale = "en") => ({ params: Promise.resolve({ locale }) });
const request = (
  body = "state=completed&from=2026-10-01&through=2026-10-03",
  headers: Record<string, string> = {},
  suffix = "",
) =>
  new Request(`${origin}/en/administrator/totals/export${suffix}`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      ...headers,
    },
    body,
  });

beforeEach(() => prepare.mockReset());

it("serves an attachment only for a recorded same-origin export", async () => {
  const csv = '\ufeff"Export record ID"\r\n"recorded"\r\n';
  prepare.mockResolvedValue({ status: "ready", csv, exportId });
  const response = await route.POST(request(), context());
  expect(prepare).toHaveBeenCalledExactlyOnceWith(
    { state: "completed", from: "2026-10-01", through: "2026-10-03" },
    "en",
  );
  expect(response.status).toBe(200);
  expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(
    Array.from(new TextEncoder().encode(csv)),
  );
  expect(response.headers.get("Content-Type")).toBe(
    "text/csv; charset=utf-8; header=present",
  );
  expect(response.headers.get("Content-Disposition")).toBe(
    `attachment; filename="rentcottage-money-${exportId}.csv"`,
  );
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();

  for (const literalOrigin of [
    "http://127.0.0.1:8792",
    "http://[::1]:8792",
    origin,
  ]) {
    for (const spoofed of [false, true]) {
      const native = () =>
        new NextRequest(`${literalOrigin}/en/administrator/totals/export`, {
          method: "POST",
          headers: {
            Origin: literalOrigin,
            "Sec-Fetch-Site": "same-origin",
            "Content-Type": "application/x-www-form-urlencoded",
            ...(spoofed
              ? {
                  Host: "hostile.example",
                  "X-Forwarded-Host": "hostile.example",
                  "X-Forwarded-Proto": "https",
                }
              : {}),
          },
          body: "state=completed&from=2026-10-01&through=2026-10-03",
        });
      if (literalOrigin.startsWith("http:"))
        expect(new URL(native().url).hostname).toBe("localhost");
      prepare.mockReset().mockResolvedValue({ status: "ready", csv, exportId });
      const admitted = await route.POST(native(), context());
      expect(admitted.status).toBe(200);
      expect(prepare).toHaveBeenCalledExactlyOnceWith(
        { state: "completed", from: "2026-10-01", through: "2026-10-03" },
        "en",
      );
      expect(Array.from(new Uint8Array(await admitted.arrayBuffer()))).toEqual(
        Array.from(new TextEncoder().encode(csv)),
      );
      expect(admitted.headers.get("Content-Type")).toBe(
        "text/csv; charset=utf-8; header=present",
      );
      expect(admitted.headers.get("Content-Disposition")).toBe(
        `attachment; filename="rentcottage-money-${exportId}.csv"`,
      );
      expect(admitted.headers.get("Cache-Control")).toBe("private, no-store");
      expect(admitted.headers.get("X-Content-Type-Options")).toBe("nosniff");
      prepare.mockResolvedValue({ status: "access_required" });
      const refused = await route.POST(native(), context());
      expect(refused.status).toBe(303);
      expect(refused.headers.get("Location")).toBe(
        `${literalOrigin}/en/administrator/totals?exportError=access_required`,
      );
      expect(refused.headers.get("Content-Disposition")).toBeNull();
    }
  }

  for (const locale of ["en", "ar", "ckb"] as const) {
    for (const status of [
      "invalid",
      "access_required",
      "empty",
      "too_many",
      "unavailable",
    ] as const) {
      prepare.mockResolvedValue({
        status,
        ...(status === "empty" || status === "too_many"
          ? { search, limit: 500 }
          : {}),
      });
      const refused = await route.POST(request(), context(locale));
      expect(refused.status).toBe(303);
      const location = new URL(refused.headers.get("Location")!);
      expect(location.origin).toBe(origin);
      expect(location.pathname).toBe(`/${locale}/administrator/totals`);
      expect(Object.fromEntries(location.searchParams)).toEqual({
        ...(status === "empty" || status === "too_many"
          ? { state: "completed", from: "2026-10-01", through: "2026-10-03" }
          : {}),
        exportError: status,
      });
      expect(refused.headers.get("Content-Disposition")).toBeNull();
      expect(refused.headers.get("Content-Type") ?? "").not.toContain(
        "text/csv",
      );
    }
  }
});

it("rejects forged export requests without invoking the service", async () => {
  prepare.mockResolvedValue({ status: "access_required" });
  for (const locale of ["en", "ar", "ckb"] as const) {
    for (const source of [
      null,
      "null",
      "https://hostile.example",
      "https://rentcottage.example.attacker.invalid",
      `${origin}:444`,
    ]) {
      const forged = request("", { "X-Forwarded-Host": "hostile.example" });
      if (source === null) forged.headers.delete("Origin");
      else forged.headers.set("Origin", source);
      const response = await route.POST(forged, context(locale));
      expect(response.status).toBe(403);
      expect(await response.text()).toBe(
        administratorBookingMoneyExportMessages[locale].unverified,
      );
      expect(response.headers.get("Content-Disposition")).toBeNull();
    }
  }
  for (const site of ["same-site", "cross-site", "none", "Same-Origin"]) {
    expect(
      (await route.POST(request("", { "Sec-Fetch-Site": site }), context()))
        .status,
    ).toBe(403);
  }
  for (const forgedOrigin of [
    "http://localhost:8792",
    "http://127.0.0.1:8793",
    "https://127.0.0.1:8792",
    "https://hostile.example",
  ]) {
    const forged = new NextRequest(
      "http://127.0.0.1:8792/en/administrator/totals/export",
      {
        method: "POST",
        headers: {
          Origin: forgedOrigin,
          "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/x-www-form-urlencoded",
          Host: "hostile.example",
          "X-Forwarded-Host": "hostile.example",
          "X-Forwarded-Proto": "https",
        },
        body: "state=&from=&through=",
      },
    );
    const refused = await route.POST(forged, context());
    expect(refused.status).toBe(403);
    expect(refused.headers.get("Location")).toBeNull();
    expect(refused.headers.get("Content-Disposition")).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  }
  const invalid = [
    request("state=completed&state=cancelled"),
    ...[
      "afterAt",
      "afterId",
      "locale",
      "ids",
      "actor",
      "recordedAt",
      "limit",
    ].map((key) => request(`${key}=value`)),
    request("state=unknown"),
    request("from=2026-02-30"),
    request("from=2026-10-03&through=2026-10-01"),
    request("", {}, "?state=completed"),
    request("", { "Content-Type": "application/json" }),
    request("", { "Content-Type": "multipart/form-data; boundary=x" }),
    request("", {
      "Content-Type": "application/x-www-form-urlencoded; charset=ISO-8859-1",
    }),
    request("&".repeat(1025)),
    request(`state=${"a".repeat(1020)}`),
    request(`state=${"ع".repeat(512)}`),
  ];
  const malformed = new Request(`${origin}/en/administrator/totals/export`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new Uint8Array([255]),
  });
  invalid.push(malformed);
  for (const input of invalid) {
    const response = await route.POST(input, context());
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      `${origin}/en/administrator/totals?exportError=invalid`,
    );
    expect(response.headers.get("Content-Disposition")).toBeNull();
  }
  expect((await route.POST(request(), context("fr"))).status).toBe(404);
  expect(prepare).not.toHaveBeenCalled();
  expect(Object.keys(route).sort()).toEqual(["POST", "dynamic"]);
  expect(route.dynamic).toBe("force-dynamic");
  prepare.mockResolvedValue({
    status: "empty",
    search: {
      state: null,
      from: null,
      through: null,
      afterAt: null,
      afterId: null,
    },
  });
  expect(
    (
      await route.POST(
        request("", {
          "Sec-Fetch-Site": "same-origin",
          "X-Forwarded-Host": "hostile.example",
        }),
        context(),
      )
    ).status,
  ).toBe(303);
  expect(prepare).toHaveBeenCalledExactlyOnceWith({}, "en");
});
