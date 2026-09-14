import { isContactProtectedTextSafe } from "@/content/contact-protection";

export function isContactSafeBookingRequestText(value: string): boolean {
  return isContactProtectedTextSafe(value);
}
