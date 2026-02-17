import { NextRequest, NextResponse } from "next/server";
import { createProject, listProjects } from "@/src/lib/store";

export async function GET() {
  const items = await listProjects();
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body?.title || typeof body.title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const item = await createProject({
    title: body.title,
    description: body.description,
    status: body.status,
    dueDate: body.dueDate,
    source: "mission_control"
  });
  return NextResponse.json({ item }, { status: 201 });
}
