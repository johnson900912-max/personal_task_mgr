import { NextRequest, NextResponse } from "next/server";
import { createContentEntry, listContentEntries } from "@/src/lib/store";
import { ContentEntryType, ContentParentType } from "@/src/lib/types";

const PARENT_TYPES: ContentParentType[] = ["project", "task"];
const ENTRY_TYPES: ContentEntryType[] = ["text", "url", "image"];

export async function GET(request: NextRequest) {
  const parentType = request.nextUrl.searchParams.get("parentType") as ContentParentType | null;
  const parentId = request.nextUrl.searchParams.get("parentId");

  if (!parentType || !PARENT_TYPES.includes(parentType) || !parentId) {
    return NextResponse.json({ error: "parentType and parentId are required" }, { status: 400 });
  }

  const items = await listContentEntries(parentType, parentId);
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body?.parentType || !body?.parentId || !body?.entryType) {
    return NextResponse.json({ error: "parentType, parentId and entryType are required" }, { status: 400 });
  }

  if (!PARENT_TYPES.includes(body.parentType) || !ENTRY_TYPES.includes(body.entryType)) {
    return NextResponse.json({ error: "invalid parentType or entryType" }, { status: 400 });
  }

  const item = await createContentEntry({
    parentType: body.parentType,
    parentId: body.parentId,
    entryType: body.entryType,
    textContent: body.textContent,
    url: body.url,
    assetId: body.assetId
  });

  if (!item) {
    return NextResponse.json({ error: "invalid content payload" }, { status: 400 });
  }

  return NextResponse.json({ item }, { status: 201 });
}
