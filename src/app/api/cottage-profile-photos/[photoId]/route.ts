import { NextResponse } from "next/server";

import { createRequestCottageProfilePhotoMedia } from "@/cottage-profile/request-cottage-profile";
import { CottagePublicationMediaUnavailableError } from "@/cottage-publication/cottage-publication-media";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function unavailable(phase: CottagePublicationMediaUnavailableError["phase"]) {
  console.error("Cottage Profile photo unavailable", {
    phase,
    result: "unavailable",
  });
  return new NextResponse("Cottage Profile photo is unavailable", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ photoId: string }> },
) {
  const { photoId } = await params;
  if (!uuidPattern.test(photoId)) return unavailable("resolve");
  try {
    const media = await (
      await createRequestCottageProfilePhotoMedia()
    ).load(photoId);
    return new NextResponse(media.bytes.buffer, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": media.contentType,
        "Content-Length": String(media.bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return unavailable(
      error instanceof CottagePublicationMediaUnavailableError
        ? error.phase
        : "resolve",
    );
  }
}
