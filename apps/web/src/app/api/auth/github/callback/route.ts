import { NextRequest, NextResponse } from "next/server";
import { createSession, upsertGithubUser } from "@/lib/auth";
import { migrateCloud } from "@/lib/db";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  if (!code) {
    return NextResponse.redirect(`${appUrl}/login?error=missing_code`);
  }
  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    return NextResponse.redirect(`${appUrl}/login?error=github_not_configured`);
  }

  try {
    await migrateCloud();
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) {
      return NextResponse.redirect(`${appUrl}/login?error=token`);
    }

    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${tokenJson.access_token}`,
        accept: "application/json",
      },
    });
    const ghUser = (await userRes.json()) as {
      id: number;
      login: string;
      email?: string | null;
      name?: string | null;
    };

    let email = ghUser.email ?? null;
    if (!email) {
      const emailsRes = await fetch("https://api.github.com/user/emails", {
        headers: {
          authorization: `Bearer ${tokenJson.access_token}`,
          accept: "application/json",
        },
      });
      const emails = (await emailsRes.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      email =
        emails.find((e) => e.primary && e.verified)?.email ??
        emails.find((e) => e.verified)?.email ??
        `${ghUser.login}@users.noreply.github.com`;
    }

    const userId = await upsertGithubUser({
      githubId: String(ghUser.id),
      email,
      name: ghUser.name ?? ghUser.login,
    });
    const token = await createSession(userId);
    return NextResponse.redirect(`${appUrl}/login?token=${token}`);
  } catch {
    return NextResponse.redirect(`${appUrl}/login?error=callback_failed`);
  }
}
