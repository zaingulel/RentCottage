import { NextResponse } from "next/server";

import { isLocale } from "@/i18n/routing";

const referencePattern = /^RC-REQ-[A-F0-9]{16}$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale } = await params;
  if (!isLocale(locale)) return new NextResponse(null, { status: 404 });
  const reference = new URL(request.url).searchParams
    .get("reference")
    ?.trim()
    .toUpperCase();
  if (!reference || !referencePattern.test(reference))
    return NextResponse.redirect(
      new URL(`/${locale}/administrator/payments`, request.url),
      303,
    );
  return NextResponse.redirect(
    new URL(`/${locale}/administrator/payments/${reference}`, request.url),
    303,
  );
}
