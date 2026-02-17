import { NextRequest, NextResponse } from "next/server";
import { saveContentAssetFromBuffer } from "@/src/lib/store";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "file must be an image" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "file exceeds 10MB" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const asset = await saveContentAssetFromBuffer({
    buffer,
    originalName: file.name,
    mimeType: file.type
  });

  return NextResponse.json({ asset }, { status: 201 });
}
