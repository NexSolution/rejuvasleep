// RejuvaSleep — lets a signed-in member see and manage their own subscription.
// Actions: "status" | "cancel" | "retry"
// Uses the same secrets as paypal-webhook (PAYPAL_CLIENT_ID, PAYPAL_SECRET, optional PAYPAL_ENV).

const PAYPAL_API = Deno.env.get("PAYPAL_ENV") === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

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

async function paypal(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${PAYPAL_API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let data: any = null; try { data = t ? JSON.parse(t) : null; } catch { /* empty */ }
  return { ok: r.ok, status: r.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  // Who is asking? (the member's own login token)
  const auth = req.headers.get("authorization") || "";
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { authorization: auth, apikey: ANON_KEY } });
  if (!u.ok) return json(401, { error: "Please log in again." });
  const user = await u.json();
  const email = String(user.email || "").toLowerCase();

  let action = "status";
  try { action = (await req.json()).action || "status"; } catch { /* default */ }

  try {
    const rows = await db(`memberships?email=eq.${encodeURIComponent(email)}&select=*`);
    const m = rows && rows[0];
    if (!m) return json(200, { membership: null });

    let token = "";
    const sub = async () => {
      if (!m.subscription_id) return null;
      token = token || await paypalToken();
      const r = await paypal(token, "GET", `/v1/billing/subscriptions/${m.subscription_id}`);
      return r.ok ? r.data : null;
    };

    if (action === "status") {
      const s = await sub();
      return json(200, {
        membership: { plan: m.plan, status: m.status, paid_until: m.paid_until, next_billing_at: m.next_billing_at, cancelled_at: m.cancelled_at },
        paypal: s && {
          status: s.status,
          next_billing_time: s.billing_info?.next_billing_time || null,
          last_payment: s.billing_info?.last_payment || null,
          outstanding: s.billing_info?.outstanding_balance || null,
          failed_payments: s.billing_info?.failed_payments_count || 0,
        },
      });
    }

    if (action === "cancel") {
      if (m.subscription_id) {
        token = await paypalToken();
        const r = await paypal(token, "POST", `/v1/billing/subscriptions/${m.subscription_id}/cancel`, { reason: "Cancelled by member in the RejuvaSleep app" });
        // 422 = already cancelled or not cancellable; carry on and stop the plan here too
        if (!r.ok && r.status !== 422) throw new Error(`PayPal couldn't cancel (${r.status})`);
      }
      const now = new Date().toISOString();
      await db(`memberships?email=eq.${encodeURIComponent(email)}`, {
        method: "PATCH", headers: { prefer: "return=minimal" },
        body: JSON.stringify({ status: "cancelled", paid_until: now, cancelled_at: now, next_billing_at: null }),
      });
      console.log(`Member ${email} cancelled`);
      return json(200, { cancelled: true });
    }

    if (action === "retry") {
      const s = await sub();
      if (!s) return json(400, { error: "No active PayPal subscription found." });
      const due = s.billing_info?.outstanding_balance;
      if (!due || Number(due.value) <= 0) return json(200, { charged: false, message: "Nothing is owed right now." });
      const r = await paypal(token, "POST", `/v1/billing/subscriptions/${m.subscription_id}/capture`, {
        note: "Outstanding balance paid from the RejuvaSleep app", capture_type: "OUTSTANDING_BALANCE", amount: due,
      });
      if (!r.ok) return json(400, { error: "PayPal couldn't take the payment. Please update your payment method in PayPal and try again." });
      if (s.status === "SUSPENDED") await paypal(token, "POST", `/v1/billing/subscriptions/${m.subscription_id}/activate`, { reason: "Balance paid" });
      return json(200, { charged: true, amount: due });
    }

    return json(400, { error: "Unknown action" });
  } catch (e) {
    console.error(e);
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
