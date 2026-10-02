import { NextRequest, NextResponse } from "next/server";
import { getMessages } from "@/lib/db";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ messages: [] });
  }
  const messages = await getMessages(sessionId);
  return NextResponse.json({ messages });
}
