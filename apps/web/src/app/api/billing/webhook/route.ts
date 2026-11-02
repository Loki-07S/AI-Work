import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSql, migrateCloud, nowMs } from "@/lib/db";

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Stripe webhook not configured" }, { status: 501 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "missing signature" }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "invalid signature" },
      { status: 400 }
    );
  }

  await migrateCloud();
  const db = getSql();

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orgId = session.metadata?.orgId;
    const plan = session.metadata?.plan ?? "pro";
    if (orgId) {
      await db`UPDATE organizations SET plan = ${plan} WHERE id = ${orgId}`;
      if (session.subscription) {
        await db`
          INSERT INTO stripe_subscriptions (org_id, stripe_subscription_id, status, price_id, updated_at)
          VALUES (${orgId}, ${String(session.subscription)}, 'active', NULL, ${nowMs()})
          ON CONFLICT (org_id) DO UPDATE SET
            stripe_subscription_id = EXCLUDED.stripe_subscription_id,
            status = 'active',
            updated_at = EXCLUDED.updated_at
        `;
      }
    }
  }

  return NextResponse.json({ received: true });
}
