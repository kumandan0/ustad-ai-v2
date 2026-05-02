import { NextRequest, NextResponse } from "next/server";
import { createChatReply } from "@/lib/server/chat";

export const runtime = "nodejs";

type Message = {
  role?: string;
  content?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      messages?: Message[];
      systemPrompt?: string;
      mode?: "general" | "materials";
      courseId?: number | null;
    };

    const content = await createChatReply({
      messages: body.messages ?? [],
      systemPrompt: body.systemPrompt ?? "",
      mode: body.mode ?? "general",
      courseId: body.courseId ?? null,
    });

    return NextResponse.json({ content });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Sohbet sırasında beklenmeyen bir hata oluştu.";
    return NextResponse.json({ content: message }, { status: 500 });
  }
}
