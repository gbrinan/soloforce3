import { NextRequest, NextResponse } from "next/server";
import { getDb, newId, type Account } from "@/lib/finance-db";
import { isNonEmptyString, readJson } from "@/lib/validate";

export async function GET() {
  const rows = getDb().prepare("SELECT * FROM accounts ORDER BY name").all() as Account[];
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  if (!isNonEmptyString(body.name) || !isNonEmptyString(body.type)) {
    return NextResponse.json({ error: "name and type required" }, { status: 400 });
  }
  const account: Account = { id: newId(), name: body.name.trim(), type: body.type.trim() };
  getDb().prepare("INSERT INTO accounts (id, name, type) VALUES (?, ?, ?)").run(
    account.id,
    account.name,
    account.type,
  );
  return NextResponse.json(account, { status: 201 });
}
