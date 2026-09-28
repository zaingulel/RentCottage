export function btrim(value: string) {
  return value.replace(/^ +| +$/g, "");
}

export function charLength(value: string) {
  let codePointCount = 0;
  const codePoints = value[Symbol.iterator]();

  while (!codePoints.next().done) codePointCount += 1;
  return codePointCount;
}
