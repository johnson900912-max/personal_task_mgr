import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getContentAssetById } from "@/src/lib/store";

interface Params {
  params: { id: string };
}

export async function GET(_request: NextRequest, { params }: Params) {
  const asset = await getContentAssetById(params.id);
  if (!asset) {
    return NextResponse.json({ error: "asset not found" }, { status: 404 });
  }

  const absolutePath = path.join(process.cwd(), asset.filePath);
  try {
    const data = await readFile(absolutePath);
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": asset.mimeType,
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    });
  } catch {
    return NextResponse.json({ error: "asset file missing" }, { status: 404 });
  }
}
