// RejuvaSleep — PayPal webhook
// Unlocks a membership when a PayPal payment completes, and removes it if the payment is refunded.
//
// Secrets to set in Supabase → Edge Functions → Secrets:
//   PAYPAL_CLIENT_ID   PayPal live app Client ID
//   PAYPAL_SECRET      PayPal live app Secret
//   PAYPAL_WEBHOOK_ID  The webhook ID PayPal shows after you add the webhook
//   EXPECTED_AMOUNT    Optional. Minimum payment that counts as a purchase (default 19.99)
//   PAYPAL_ENV         Optional. "sandbox" for testing; anything else means live
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.

const PAYPAL_API = Deno.env.get("PAYPAL_ENV") === "sandbox"
  ? "https://api-m.sandbox.paypal.com"
  : "https://api-m.paypal.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXPECTED = Number(Deno.env.get("EXPECTED_AMOUNT") || "19.99");

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function paypalToken(): Promise<string> {
  const id = Deno.env.get("PAYPAL_CLIENT_ID"), secret = Deno.env.get("PAYPAL_SECRET");
  if (!id || !secret) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_SECRET not set");
  const r = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: "Basic " + btoa(`${id}:${secret}`), "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`PayPal token failed: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}

async function verifySignature(token: string, headers: Headers, event: unknown): Promise<boolean> {
  const webhookId = Deno.env.get("PAYPAL_WEBHOOK_ID");
  if (!webhookId) throw new Error("PAYPAL_WEBHOOK_ID not set");
  const r = await fetch(`${PAYPAL_API}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      auth_algo: headers.get("paypal-auth-algo"),
      cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"),
      transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: event,
    }),
  });
  if (!r.ok) throw new Error(`PayPal verify failed: ${r.status} ${await r.text()}`);
  return (await r.json()).verification_status === "SUCCESS";
}

async function paypalGet(token: string, path: string) {
  const r = await fetch(`${PAYPAL_API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`PayPal GET ${path} failed: ${r.status}`);
  return r.json();
}

async function db(path: string, init: RequestInit) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Database ${path} failed: ${r.status} ${await r.text()}`);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });

  let event: any;
  try { event = await req.json(); } catch { return json(400, { error: "bad json" }); }

  try {
    const token = await paypalToken();
    if (!(await verifySignature(token, req.headers, event))) {
      console.warn("Rejected webhook with bad signature", event?.id);
      return json(400, { error: "invalid signature" });
    }

    const type = event.event_type;
    const res = event.resource || {};

    if (type === "PAYMENT.CAPTURE.COMPLETED") {
      const amount = Number(res.amount?.value || 0);
      if (amount + 0.001 < EXPECTED) {
        console.log(`Ignored capture ${res.id}: amount ${amount} below ${EXPECTED}`);
        return json(200, { ignored: "amount" });
      }
      const orderId = res.supplementary_data?.related_ids?.order_id;
      if (!orderId) throw new Error(`Capture ${res.id} has no order id`);
      const order = await paypalGet(token, `/v2/checkout/orders/${orderId}`);
      const email = String(order.payer?.email_address || "").trim().toLowerCase();
      if (!email) throw new Error(`Order ${orderId} has no payer email`);

      await db("memberships?on_conflict=email", {
        method: "POST",
        headers: { prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ email, plan: "lifetime", source: "paypal", paypal_ref: res.id }),
      });
      console.log(`Membership granted to ${email} (capture ${res.id})`);
      return json(200, { granted: true });
    }

    if (type === "PAYMENT.CAPTURE.REFUNDED" || type === "PAYMENT.CAPTURE.REVERSED") {
      // The refund links back to the original capture, whose id we stored as paypal_ref
      const up = (res.links || []).find((l: any) => l.rel === "up")?.href || "";
      const captureId = type === "PAYMENT.CAPTURE.REVERSED" ? res.id : up.split("/").pop();
      if (captureId) {
        await db(`memberships?paypal_ref=eq.${encodeURIComponent(captureId)}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
        console.log(`Membership removed for capture ${captureId} (${type})`);
      }
      return json(200, { revoked: true });
    }

    return json(200, { ignored: type });
  } catch (err) {
    // 500 makes PayPal retry later
    console.error(err);
    return json(500, { error: String(err instanceof Error ? err.message : err) });
  }
});
