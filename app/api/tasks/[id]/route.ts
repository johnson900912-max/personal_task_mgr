import { NextRequest, NextResponse } from "next/server";
import { deleteTask, updateTask } from "@/src/lib/store";

interface Params {
  params: { id: string };
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const body = await request.json();
  if (Object.prototype.hasOwnProperty.call(body, "projectId") && body.projectId === null) {
    return NextResponse.json({ error: "task projectId cannot be null" }, { status: 400 });
  }

  const item = await updateTask(params.id, body);
  if (!item) {
    return NextResponse.json({ error: "task not found or invalid patch" }, { status: 404 });
  }
  return NextResponse.json({ item });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const deleted = await deleteTask(params.id);
  if (!deleted) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
