import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { userFromAuthHeader } from "@/lib/auth";
import { getSql, migrateCloud } from "@/lib/db";

export async function POST(req: NextRequest) {
  const user = await userFromAuthHeader(req.headers.get("authorization"));
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: "Stripe not configured (set STRIPE_SECRET_KEY)" },
      { status: 501 }
    );
  }

  await migrateCloud();
  const body = (await req.json()) as { plan?: string };
  const plan = body.plan ?? "pro";
  const priceId =
    plan === "team" ? process.env.STRIPE_PRICE_TEAM : process.env.STRIPE_PRICE_PRO;
  if (!priceId) {
    return NextResponse.json({ error: "Stripe price id missing for plan" }, { status: 501 });
  }

  const db = getSql();
  const orgs = await db`
    SELECT o.id, o.stripe_customer_id FROM organizations o
    JOIN org_members m ON m.org_id = o.id
    WHERE m.user_id = ${user.id}
    LIMIT 1
  `;
  const org = orgs[0] as { id: string; stripe_customer_id: string | null } | undefined;
  if (!org) return NextResponse.json({ error: "no organization" }, { status: 400 });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let customerId = org.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { orgId: org.id, userId: user.id },
    });
    customerId = customer.id;
    await db`UPDATE organizations SET stripe_customer_id = ${customerId} WHERE id = ${org.id}`;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/billing?success=1`,
    cancel_url: `${appUrl}/billing?canceled=1`,
    metadata: { orgId: org.id, plan },
  });

  return NextResponse.json({ url: session.url });
}
