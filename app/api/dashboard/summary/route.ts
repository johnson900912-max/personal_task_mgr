import { NextResponse } from "next/server";
import { buildDashboardSummary, listTasks } from "@/src/lib/store";

export async function GET() {
  const tasks = await listTasks();
  return NextResponse.json(buildDashboardSummary(tasks));
}
