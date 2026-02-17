import { NextRequest, NextResponse } from "next/server";
import { commitImport } from "@/src/lib/imports";
import { ImportCommitRequest } from "@/src/lib/types";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as ImportCommitRequest;
  if (!body?.type || !Array.isArray(body.rows)) {
    return NextResponse.json({ error: "type and rows are required" }, { status: 400 });
  }

  const result = await commitImport(body);
  return NextResponse.json(result, { status: 201 });
}
