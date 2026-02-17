import { NextRequest, NextResponse } from "next/server";
import { deleteContentEntry, updateContentEntry } from "@/src/lib/store";

interface Params {
  params: { id: string };
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const body = await request.json();
  const item = await updateContentEntry(params.id, {
    textContent: body.textContent,
    url: body.url,
    assetId: body.assetId
  });

  if (!item) {
    return NextResponse.json({ error: "content entry not found or invalid payload" }, { status: 400 });
  }

  return NextResponse.json({ item });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const deleted = await deleteContentEntry(params.id);
  if (!deleted) {
    return NextResponse.json({ error: "content entry not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
