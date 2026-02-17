import { NextResponse } from "next/server";

export async function PATCH() {
  return NextResponse.json({ error: "notes endpoints are deprecated; use /api/content" }, { status: 410 });
}

export async function DELETE() {
  return NextResponse.json({ error: "notes endpoints are deprecated; use /api/content" }, { status: 410 });
}
