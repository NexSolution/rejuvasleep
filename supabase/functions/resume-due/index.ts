// RejuvaSleep — restarts billing for member pauses that have reached their restart date.
// Called every hour by the database scheduler (pg_cron). It only ever does work that is
// already due, so it is safe to be called by anyone.

const PAYPAL_API = Deno.env.get("PAYPAL_ENV") === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function db(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Database ${path} failed: ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function paypalToken(): Promise<string> {
  const id = Deno.env.get("PAYPAL_CLIENT_ID"), secret = Deno.env.get("PAYPAL_SECRET");
  if (!id || !secret) throw new Error("PayPal keys are not set");
  const r = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: "Basic " + btoa(`${id}:${secret}`), "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`PayPal sign-in failed (${r.status})`);
  return (await r.json()).access_token;
}

Deno.serve(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const due = await db(`memberships?status=eq.paused&paused_until=lte.${today}&select=email,subscription_id`);
  let token = "", done = 0;
  const failed: string[] = [];
  for (const m of due || []) {
    try {
      const fields: any = { status: "active", paused_until: null };
      if (m.subscription_id) {
        token = token || await paypalToken();
        const a = await fetch(`${PAYPAL_API}/v1/billing/subscriptions/${m.subscription_id}/activate`, {
          method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ reason: "Pause ended" }),
        });
        if (!a.ok && a.status !== 422) throw new Error(`activate ${a.status}`);
        const g = await fetch(`${PAYPAL_API}/v1/billing/subscriptions/${m.subscription_id}`, { headers: { authorization: `Bearer ${token}` } });
        const next = g.ok ? (await g.json()).billing_info?.next_billing_time : null;
        if (next) { fields.next_billing_at = next; fields.paid_until = new Date(Date.parse(next) + 3 * 864e5).toISOString(); }
      }
      await db(`memberships?email=eq.${encodeURIComponent(m.email)}`, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify(fields) });
      done++;
    } catch (e) {
      console.error(`Couldn't restart ${m.email}:`, e);
      failed.push(m.email);
    }
  }
  if (done || failed.length) console.log(`Restarted ${done} paused plan(s); ${failed.length} failed`);
  return new Response(JSON.stringify({ restarted: done, failed: failed.length }), { headers: { "content-type": "application/json" } });
});
