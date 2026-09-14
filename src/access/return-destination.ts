import type { Locale } from "@/i18n/routing";
import { parseCottageDiscoveryQuery } from "@/cottage-discovery/discovery-query";

const uuid =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const publicRoute =
  /^(?:|\/results|\/(?:cottages|quote|request)\/[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const privateRoute = new RegExp(
  `^(?:/bookings|/messages(?:/${uuid})?|/(?:owner/)?booking-requests/RC-REQ-[A-F0-9]{16}|/owner/application|/owner/cottages(?:/${uuid})?)$`,
);
const uuidPattern = new RegExp(`^${uuid}$`, "i");

function discoveryQueryFrom(params: URLSearchParams) {
  const raw: Record<string, string | string[]> = Object.create(null);
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    if (values.some((item) => /[\\\x00-\x1f\x7f]/.test(item))) return null;
    raw[key] = values.length === 1 ? values[0] : values;
  }
  return parseCottageDiscoveryQuery(raw).status === "loaded";
}

export function isOwnerEnrollmentDestination(locale: Locale, value: unknown) {
  return (
    value === `/${locale}/owner/application` ||
    value === `/${locale}/owner/cottages`
  );
}

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
  } else if (route === "/messages") {
    if (query) {
      const cottages = params.getAll("cottage");
      if (cottages.length !== 1 || !/^cottage-[0-9a-f]{32}$/.test(cottages[0]))
        return fallback;
      params.delete("cottage");
      if (params.size > 0 && !discoveryQueryFrom(params)) return fallback;
    }
  } else if (new RegExp(`^/messages/${uuid}$`).test(route)) {
    if (query) {
      const before = params.getAll("before");
      if (
        before.length > 1 ||
        (before.length === 1 &&
          (!/^\d+$/.test(before[0]) ||
            !Number.isSafeInteger(Number(before[0])) ||
            Number(before[0]) < 1))
      )
        return fallback;
      params.delete("before");
      if (params.size > 0 && !discoveryQueryFrom(params)) return fallback;
    }
  } else if (privateRoute.test(route)) {
    if (query) return fallback;
  } else if (query) {
    if (route.startsWith("/request/")) {
      const conversations = params.getAll("conversation");
      if (
        conversations.length > 1 ||
        (conversations.length === 1 && !uuidPattern.test(conversations[0]))
      )
        return fallback;
      params.delete("conversation");
    }
    if (!discoveryQueryFrom(params)) return fallback;
  }
  return value;
}

export function accountAccessHref(locale: Locale, returnTo: unknown) {
  return `/${locale}/access?returnTo=${encodeURIComponent(safeReturnDestination(locale, returnTo))}`;
}
