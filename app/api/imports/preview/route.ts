import { NextRequest, NextResponse } from "next/server";
import { previewImport } from "@/src/lib/imports";
import { ImportPreviewRequest } from "@/src/lib/types";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as ImportPreviewRequest;
  if (!body?.type || !body?.text) {
    return NextResponse.json({ error: "type and text are required" }, { status: 400 });
  }
  const preview = await previewImport(body);
  return NextResponse.json(preview);
}
