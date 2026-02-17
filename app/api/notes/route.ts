import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ error: "notes endpoints are deprecated; use /api/content" }, { status: 410 });
}

export async function POST() {
  return NextResponse.json({ error: "notes endpoints are deprecated; use /api/content" }, { status: 410 });
}
