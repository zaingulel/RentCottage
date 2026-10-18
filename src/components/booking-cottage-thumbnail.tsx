"use client";

import Image from "next/image";
import { useState } from "react";

export function BookingCottageThumbnail({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <Image
      className="booking-cottage-thumbnail"
      src={src}
      width={80}
      height={80}
      unoptimized
      alt=""
      onError={() => setFailed(true)}
    />
  );
}
