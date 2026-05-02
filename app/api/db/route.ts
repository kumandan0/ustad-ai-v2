import { NextRequest, NextResponse } from "next/server";
import { queryTable } from "@/lib/server/store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = await queryTable(body);
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bir hata olustu.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

