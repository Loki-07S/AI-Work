"use client";

export default function BillingPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-display text-3xl font-bold">Billing</h1>
      <p className="mt-2 text-ink/70">
        Subscriptions are tied to an Organization. Stripe Checkout unlocks Pro/Team sync seats
        and metered decision extraction.
      </p>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {[
          { name: "Free", price: "$0", note: "Local capture + search" },
          { name: "Pro", price: "$12", note: "Cloud sync + decisions" },
          { name: "Team", price: "$29", note: "Shared workspace seats" },
        ].map((p) => (
          <div key={p.name} className="rounded-md border border-mist bg-white p-5">
            <p className="font-display text-lg font-bold">{p.name}</p>
            <p className="mt-2 text-2xl font-semibold">{p.price}</p>
            <p className="mt-2 text-sm text-ink/70">{p.note}</p>
            <button
              className="mt-4 w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white"
              onClick={async () => {
                const token = localStorage.getItem("aiwork_token");
                if (!token) {
                  window.location.href = "/login";
                  return;
                }
                const res = await fetch("/api/billing/checkout", {
                  method: "POST",
                  headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                  },
                  body: JSON.stringify({ plan: p.name.toLowerCase() }),
                });
                const data = await res.json();
                if (data.url) window.location.href = data.url;
                else alert(data.error ?? "Checkout not configured");
              }}
            >
              Choose {p.name}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
