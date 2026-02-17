import { NextRequest, NextResponse } from "next/server";
import { reorderTasksInLane } from "@/src/lib/store";
import { TaskReorderRequest, TaskStatus } from "@/src/lib/types";

const VALID_STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "parking_lot", "done"];

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Partial<TaskReorderRequest>;

  if (!body?.movedTaskId || typeof body.movedTaskId !== "string") {
    return NextResponse.json({ error: "movedTaskId is required" }, { status: 400 });
  }
  if (!body?.toStatus || !VALID_STATUSES.includes(body.toStatus)) {
    return NextResponse.json({ error: "toStatus is invalid" }, { status: 400 });
  }
  if (!Array.isArray(body.orderedTaskIds)) {
    return NextResponse.json({ error: "orderedTaskIds is required" }, { status: 400 });
  }

  const items = await reorderTasksInLane({
    movedTaskId: body.movedTaskId,
    toStatus: body.toStatus,
    orderedTaskIds: body.orderedTaskIds
  });

  if (!items) {
    return NextResponse.json({ error: "invalid reorder payload" }, { status: 400 });
  }

  return NextResponse.json({ items });
}
