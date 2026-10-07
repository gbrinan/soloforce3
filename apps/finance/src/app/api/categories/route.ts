import { NextRequest, NextResponse } from "next/server";
import { getDb, newId, CATEGORY_KINDS, type Category, type CategoryKind } from "@/lib/finance-db";
import { isNonEmptyString, readJson } from "@/lib/validate";

export async function GET() {
  const rows = getDb().prepare("SELECT * FROM categories ORDER BY kind, name").all() as Category[];
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  if (!isNonEmptyString(body.name)) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (!CATEGORY_KINDS.includes(body.kind as CategoryKind)) {
    return NextResponse.json({ error: "kind must be income|fixed|variable|subscription" }, { status: 400 });
  }
  const category: Category = { id: newId(), name: body.name.trim(), kind: body.kind as CategoryKind };
  getDb().prepare("INSERT INTO categories (id, name, kind) VALUES (?, ?, ?)").run(
    category.id,
    category.name,
    category.kind,
  );
  return NextResponse.json(category, { status: 201 });
}
