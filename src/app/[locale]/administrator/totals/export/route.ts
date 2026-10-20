import {
  parseBookingMoneySearch,
  type BookingMoneySearch,
} from "@/administrator-records/administrator-booking-money";
import { exportAdministratorBookingMoney } from "@/administrator-records/supabase-administrator-booking-money-export";
import {
  administratorBookingMoneyExportMessages,
  type BookingMoneyExportError,
} from "@/i18n/administrator-booking-money-export-messages";
import { isLocale, type Locale } from "@/i18n/routing";

// Dynamic dispatch retains a genuine Request whose native URL preserves the
// exact target before NextRequest normalizes loopback hosts.
export const dynamic = "force-dynamic";

function refusal(
  origin: string,
  locale: Locale,
  error: BookingMoneyExportError,
  search?: BookingMoneySearch,
): Response {
  const destination = new URL(`/${locale}/administrator/totals`, origin);
  if (search)
    for (const key of ["state", "from", "through"] as const)
      if (search[key]) destination.searchParams.set(key, search[key]);
  destination.searchParams.set("exportError", error);
  return Response.redirect(destination, 303);
}

async function filters(request: Request): Promise<Record<string, string>> {
  const reader = request.body?.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";
  if (reader) {
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 1024) {
          await reader.cancel();
          throw new Error("Export form exceeds byte limit");
        }
        body += decoder.decode(next.value, { stream: true });
      }
      body += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }
  const values: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(body)) {
    if (
      !["state", "from", "through"].includes(key) ||
      Object.hasOwn(values, key)
    )
      throw new Error("Invalid export form field");
    values[key] = value;
  }
  parseBookingMoneySearch(values);
  return values;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
): Promise<Response> {
  const { locale } = await params;
  if (!isLocale(locale)) return new Response(null, { status: 404 });
  const url = new URL(Reflect.get(Request.prototype, "url", request));
  const source = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");
  if (source !== url.origin || (site !== null && site !== "same-origin"))
    return new Response(
      administratorBookingMoneyExportMessages[locale].unverified,
      {
        status: 403,
      },
    );
  const contentType = request.headers.get("Content-Type") ?? "";
  if (
    url.search !== "" ||
    !/^application\/x-www-form-urlencoded(?:\s*;\s*charset=(?:utf-8|"utf-8"))?\s*$/i.test(
      contentType,
    )
  )
    return refusal(url.origin, locale, "invalid");
  let input: Record<string, string>;
  try {
    input = await filters(request);
  } catch {
    return refusal(url.origin, locale, "invalid");
  }
  const outcome = await exportAdministratorBookingMoney(input, locale);
  if (outcome.status !== "ready")
    return refusal(
      url.origin,
      locale,
      outcome.status,
      "search" in outcome ? outcome.search : undefined,
    );
  return new Response(outcome.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8; header=present",
      "Content-Disposition": `attachment; filename="rentcottage-money-${outcome.exportId}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
