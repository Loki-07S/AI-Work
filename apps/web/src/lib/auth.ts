import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getSql, newId, nowMs } from "./db";

const DAY = 24 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(salt + password).digest("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const next = createHash("sha256").update(salt + password).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(hash), Buffer.from(next));
  } catch {
    return false;
  }
}

export async function createUser(email: string, password: string, name?: string) {
  const db = getSql();
  const id = newId();
  const ts = nowMs();
  await db`
    INSERT INTO users (id, email, password_hash, name, created_at)
    VALUES (${id}, ${email.toLowerCase()}, ${hashPassword(password)}, ${name ?? null}, ${ts})
  `;
  const orgId = newId();
  await db`
    INSERT INTO organizations (id, name, plan, created_at)
    VALUES (${orgId}, ${`${email.split("@")[0]}'s workspace`}, 'free', ${ts})
  `;
  await db`
    INSERT INTO org_members (org_id, user_id, role) VALUES (${orgId}, ${id}, 'owner')
  `;
  return { userId: id, orgId };
}

export async function findUserByEmail(email: string) {
  const db = getSql();
  const rows = await db`SELECT * FROM users WHERE email = ${email.toLowerCase()} LIMIT 1`;
  return rows[0] as
    | {
        id: string;
        email: string;
        password_hash: string | null;
        name: string | null;
        github_id: string | null;
      }
    | undefined;
}

export async function createSession(userId: string): Promise<string> {
  const db = getSql();
  const token = randomBytes(32).toString("hex");
  const ts = nowMs();
  await db`
    INSERT INTO sessions (token, user_id, created_at, expires_at)
    VALUES (${token}, ${userId}, ${ts}, ${ts + 30 * DAY})
  `;
  return token;
}

export async function userFromAuthHeader(auth: string | null): Promise<{
  id: string;
  email: string;
} | null> {
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  if (!token) return null;
  const db = getSql();
  const rows = await db`
    SELECT u.id, u.email FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > ${nowMs()}
    LIMIT 1
  `;
  const row = rows[0] as { id: string; email: string } | undefined;
  return row ?? null;
}

export async function upsertGithubUser(profile: {
  githubId: string;
  email: string;
  name?: string;
}) {
  const db = getSql();
  const existing = await db`
    SELECT * FROM users WHERE github_id = ${profile.githubId} OR email = ${profile.email.toLowerCase()}
    LIMIT 1
  `;
  if (existing[0]) {
    const u = existing[0] as { id: string };
    await db`
      UPDATE users SET github_id = ${profile.githubId}, name = COALESCE(${profile.name ?? null}, name)
      WHERE id = ${u.id}
    `;
    return u.id;
  }
  const created = await createUser(profile.email, randomBytes(16).toString("hex"), profile.name);
  await db`UPDATE users SET github_id = ${profile.githubId} WHERE id = ${created.userId}`;
  return created.userId;
}
