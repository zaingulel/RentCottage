import { NextResponse } from "next/server";

import { CottagePublicationMediaUnavailableError } from "@/cottage-publication/cottage-publication-media";
import { createRequestCottagePublicationMedia } from "@/cottage-publication/request-cottage-publication";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function unavailable(phase: CottagePublicationMediaUnavailableError["phase"]) {
  console.error("Cottage publication media unavailable", {
    phase,
    result: "unavailable",
  });
  return new NextResponse("Publication media is unavailable", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mediaId: string }> },
) {
  const { mediaId } = await params;
  if (!uuidPattern.test(mediaId)) return unavailable("resolve");
  try {
    const media = await createRequestCottagePublicationMedia().load(mediaId);
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
