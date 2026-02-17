import { NextRequest, NextResponse } from "next/server";
import { createTask, listTasks } from "@/src/lib/store";

export async function GET() {
  const items = await listTasks();
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body?.title || typeof body.title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const item = await createTask({
    title: body.title,
    details: body.details,
    priority: body.priority,
    dueDate: body.dueDate,
    scheduledAt: body.scheduledAt,
    projectId: body.projectId,
    recurrence: body.recurrence,
    source: "mission_control"
  });

  return NextResponse.json({ item }, { status: 201 });
}
