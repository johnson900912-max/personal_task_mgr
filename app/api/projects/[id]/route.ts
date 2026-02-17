import { NextRequest, NextResponse } from "next/server";
import { deleteProject, updateProject } from "@/src/lib/store";

interface Params {
  params: { id: string };
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const body = await request.json();
  const item = await updateProject(params.id, body);
  if (!item) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  return NextResponse.json({ item });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const deleted = await deleteProject(params.id);
  if (!deleted) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
