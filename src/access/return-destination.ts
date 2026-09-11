import type { Locale } from "@/i18n/routing";
import { parseCottageDiscoveryQuery } from "@/cottage-discovery/discovery-query";

const uuid =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const publicRoute =
  /^(?:|\/results|\/(?:cottages|quote|request)\/[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const privateRoute = new RegExp(
  `^(?:/bookings|/(?:owner/)?booking-requests/RC-REQ-[A-F0-9]{16}|/owner/application|/owner/cottages(?:/${uuid})?)$`,
);

export function safeReturnDestination(locale: Locale, value: unknown): string {
  const fallback = `/${locale}/bookings`;
  if (
    typeof value !== "string" ||
    value.length > 16000 ||
    !value.startsWith(`/${locale}`) ||
    /[\\\x00-\x20\x7f#]/.test(value)
  )
    return fallback;
  const [path, query = ""] = value.split("?");
  if (value.split("?").length > 2 || path.includes("%")) return fallback;
  const route = path.slice(locale.length + 1);
  if (!publicRoute.test(route) && !privateRoute.test(route)) return fallback;
  const params = new URLSearchParams(query);
  if (route === "/bookings") {
    if (query && (params.size !== 1 || params.get("workspace") !== "owner"))
      return fallback;
  } else if (privateRoute.test(route)) {
    if (query) return fallback;
  } else if (query) {
    const raw: Record<string, string | string[]> = Object.create(null);
    for (const key of new Set(params.keys())) {
      const values = params.getAll(key);
      if (values.some((item) => /[\\\x00-\x1f\x7f]/.test(item)))
        return fallback;
      raw[key] = values.length === 1 ? values[0] : values;
    }
    if (parseCottageDiscoveryQuery(raw).status !== "loaded") return fallback;
  }
  return value;
}

export function accountAccessHref(locale: Locale, returnTo: unknown) {
  return `/${locale}/access?returnTo=${encodeURIComponent(safeReturnDestination(locale, returnTo))}`;
}
