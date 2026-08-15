export function canonicalBlockedBySectionCount(body) {
  const normalizedBody = String(body ?? "").replaceAll("\r\n", "\n");
  return [...normalizedBody.matchAll(/(?:^|\n)## Blocked by\n\n/g)].length;
}
