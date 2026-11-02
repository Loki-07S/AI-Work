import { NextRequest, NextResponse } from "next/server";
import { createSession, createUser, findUserByEmail, verifyPassword } from "@/lib/auth";
import { migrateCloud } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    await migrateCloud();
  } catch (err) {
    return NextResponse.json(
      { error: `Database unavailable: ${err instanceof Error ? err.message : String(err)}` },
      { status: 503 }
    );
  }

  const body = (await req.json()) as {
    action?: "register" | "login";
    email?: string;
    password?: string;
    name?: string;
  };

  if (!body.email || !body.password) {
    return NextResponse.json({ error: "email and password required" }, { status: 400 });
  }

  if (body.action === "register") {
    const existing = await findUserByEmail(body.email);
    if (existing) {
      return NextResponse.json({ error: "email already registered" }, { status: 409 });
    }
    const { userId, orgId } = await createUser(body.email, body.password, body.name);
    const token = await createSession(userId);
    return NextResponse.json({ token, userId, orgId });
  }

  const user = await findUserByEmail(body.email);
  if (!user?.password_hash || !verifyPassword(body.password, user.password_hash)) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }
  const token = await createSession(user.id);
  return NextResponse.json({ token, userId: user.id, email: user.email });
}
