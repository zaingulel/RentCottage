export function isBookingRequestReference(value: string): boolean {
  return /^RC-REQ-[A-F0-9]{16}$/.test(value);
}

export function isIdentifier(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
