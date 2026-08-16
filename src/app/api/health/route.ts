import { NextResponse } from "next/server";

import { getServerEnvironment } from "@/config/server-runtime";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const environment = getServerEnvironment();
  const shouldProbe =
    new URL(request.url).searchParams.get("check") === "supabase";

  if (shouldProbe) {
    try {
      const response = await fetch(`${environment.supabase.url}/rest/v1/`, {
        headers: {
          apikey: environment.supabase.secretKey,
        },
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) {
        return NextResponse.json(
          { ok: false, supabase: { connected: false } },
          { status: 503 },
        );
      }
    } catch {
      return NextResponse.json(
        { ok: false, supabase: { connected: false } },
        { status: 503 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    environment: environment.name,
    supabase: {
      configured: true,
      connected: shouldProbe,
      projectRef: environment.supabase.projectRef,
    },
  });
}
