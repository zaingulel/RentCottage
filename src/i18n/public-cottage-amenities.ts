import {
  cottageProfileAmenities,
  type CottageProfileAmenity,
} from "@/cottage-profile/cottage-profile";

import { cottageProfileMessages } from "./cottage-profile-messages";
import type { Locale } from "./routing";

const knownAmenities = new Set<string>(cottageProfileAmenities);

export function publicCottageAmenityName(
  locale: Locale,
  amenity: string,
): string {
  if (!knownAmenities.has(amenity)) return amenity;
  return cottageProfileMessages[locale][amenity as CottageProfileAmenity];
}
