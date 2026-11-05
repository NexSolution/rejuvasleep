// RejuvaSleep — PayPal webhook
// Unlocks a membership when a PayPal payment completes, and removes it if the payment is refunded.
// Also the backup that marks shop orders paid or refunded.
//
// Secrets to set in Supabase → Edge Functions → Secrets:
//   PAYPAL_CLIENT_ID   PayPal live app Client ID
//   PAYPAL_SECRET      PayPal live app Secret
//   PAYPAL_WEBHOOK_ID  The webhook ID PayPal shows after you add the webhook
//   EXPECTED_AMOUNT    Optional. Minimum payment that counts as a purchase (default 19.99)
//   PAYPAL_ENV         Optional. "sandbox" for testing; anything else means live
//   PAYPAL_PLAN_ID     Optional. If set, only subscriptions to this plan unlock access
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.

const PAYPAL_API = Deno.env.get("PAYPAL_ENV") === "sandbox"
  ? "https://api-m.sandbox.paypal.com"
  : "https://api-m.paypal.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXPECTED = Number(Deno.env.get("EXPECTED_AMOUNT") || "19.99");

const PLAN_ID = Deno.env.get("PAYPAL_PLAN_ID") || "";
const GRACE_DAYS = 3; // access runs a few days past each billing date so a slow renewal never locks someone out

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

async function db(path: string, init: RequestInit): Promise<any> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Database ${path} failed: ${r.status} ${await r.text()}`);
  const t = await r.text();
  try { return t ? JSON.parse(t) : null; } catch { return null; }
}

const iso = (d: Date) => d.toISOString();
function paidUntil(sub: any): string {
  const next = sub?.billing_info?.next_billing_time ? new Date(sub.billing_info.next_billing_time) : null;
  const base = next && !isNaN(+next) ? next : new Date(Date.now() + 31 * 864e5);
  return iso(new Date(+base + GRACE_DAYS * 864e5));
}

// Activate or extend a monthly membership from a PayPal subscription object
async function grantSubscription(sub: any): Promise<Response> {
  if (PLAN_ID && sub.plan_id !== PLAN_ID) {
    console.log(`Ignored subscription ${sub.id}: plan ${sub.plan_id} is not ${PLAN_ID}`);
    return json(200, { ignored: "plan" });
  }
  const fields = { plan: "monthly", status: "active", paid_until: paidUntil(sub), next_billing_at: sub?.billing_info?.next_billing_time || null, cancelled_at: null, paused_until: null };
  // Renewals: update the row already linked to this subscription (works even if the member changed their email)
  const linked = await db(`memberships?subscription_id=eq.${encodeURIComponent(sub.id)}`, {
    method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify(fields),
  });
  if (Array.isArray(linked) && linked.length) {
    console.log(`Subscription ${sub.id} renewed until ${fields.paid_until}`);
    return json(200, { granted: true });
  }
  const email = String(sub.custom_id || sub.subscriber?.email_address || "").trim().toLowerCase();
  if (!email.includes("@")) throw new Error(`Subscription ${sub.id} has no usable email`);
  await db("memberships?on_conflict=email", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ email, source: "paypal", subscription_id: sub.id, ...fields }),
  });
  console.log(`Subscription ${sub.id} active for ${email} until ${fields.paid_until}`);
  return json(200, { granted: true });
}

async function setSubscription(subId: string, fields: Record<string, unknown>) {
  await db(`memberships?subscription_id=eq.${encodeURIComponent(subId)}`, {
    method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify(fields),
  });
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

    // ── Monthly subscriptions ──────────────────────────
    if (type === "BILLING.SUBSCRIPTION.ACTIVATED" || type === "BILLING.SUBSCRIPTION.RE-ACTIVATED") {
      return await grantSubscription(res);
    }
    if (type === "PAYMENT.SALE.COMPLETED") {
      // Each monthly charge (including the first $9.99) arrives as a sale on the subscription
      if (!res.billing_agreement_id) return json(200, { ignored: "not a subscription payment" });
      const sub = await paypalGet(token, `/v1/billing/subscriptions/${res.billing_agreement_id}`);
      return await grantSubscription(sub);
    }
    if (type === "BILLING.SUBSCRIPTION.CANCELLED") {
      // Cancelling stops the plan right away; history is kept
      await setSubscription(res.id, { status: "cancelled", paid_until: iso(new Date()), cancelled_at: iso(new Date()), next_billing_at: null });
      console.log(`Subscription ${res.id} cancelled; plan stopped`);
      return json(200, { cancelled: true });
    }
    if (type === "BILLING.SUBSCRIPTION.PAYMENT.FAILED") {
      // PayPal retries automatically; access continues through the grace days meanwhile
      await setSubscription(res.id, { status: "past_due" });
      console.log(`Subscription ${res.id} payment failed`);
      return json(200, { past_due: true });
    }
    if (type === "BILLING.SUBSCRIPTION.SUSPENDED" || type === "BILLING.SUBSCRIPTION.EXPIRED") {
      // A member's own pause also suspends billing in PayPal; that must not end their access
      const target = type.endsWith("SUSPENDED") ? `${encodeURIComponent(res.id)}&status=neq.paused` : encodeURIComponent(res.id);
      await db(`memberships?subscription_id=eq.${target}`, {
        method: "PATCH", headers: { prefer: "return=minimal" },
        body: JSON.stringify({ status: type.split(".").pop()!.toLowerCase(), paid_until: iso(new Date()) }),
      });
      console.log(`Subscription ${res.id} ${type} handled (member pauses are left alone)`);
      return json(200, { ended: true });
    }
    if (type === "PAYMENT.SALE.REFUNDED" || type === "PAYMENT.SALE.REVERSED") {
      const saleId = type === "PAYMENT.SALE.REVERSED" ? res.id : res.sale_id;
      if (!saleId) return json(200, { ignored: "no sale id" });
      const sale = await paypalGet(token, `/v1/payments/sale/${saleId}`);
      if (sale.billing_agreement_id) {
        await setSubscription(sale.billing_agreement_id, { status: "refunded", paid_until: iso(new Date()) });
        console.log(`Subscription ${sale.billing_agreement_id} refunded; access ended`);
      }
      return json(200, { revoked: true });
    }

    // ── Shop orders (custom_id "order:<id>") ───────────
    // The checkout function normally marks them paid; this is the backup if the browser closed mid-payment.
    const shopOrder = String(res.custom_id || "").startsWith("order:") ? String(res.custom_id).slice(6) : "";
    if (type === "PAYMENT.CAPTURE.COMPLETED" && shopOrder) {
      if (!/^[0-9a-f-]{36}$/.test(shopOrder)) return json(200, { ignored: "bad order id" });
      const rows = await db(`orders?id=eq.${shopOrder}&select=id,number,status,total_cents,currency,admin_note`, { method: "GET" });
      const o = rows?.[0];
      if (!o) return json(200, { ignored: "unknown order" });
      const amountOk = res.amount?.currency_code === o.currency && Math.round(Number(res.amount?.value) * 100) === o.total_cents;
      if (!amountOk) { console.error(`Order #${o.number}: webhook amount ${res.amount?.value} does not match`); return json(200, { ignored: "amount" }); }
      if (o.status === "pending") {
        await db(`orders?id=eq.${o.id}&status=eq.pending`, { method: "PATCH", headers: { prefer: "return=minimal" },
          body: JSON.stringify({ status: "paid", paid_at: new Date().toISOString(), paypal_capture_id: res.id }) });
        console.log(`Order #${o.number} marked paid by webhook`);
      } else if (o.admin_note && o.admin_note.startsWith("PayPal is still reviewing")) {
        await db(`orders?id=eq.${o.id}`, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ admin_note: null }) });
      }
      return json(200, { order: true });
    }
    if (type === "PAYMENT.CAPTURE.REFUNDED" || type === "PAYMENT.CAPTURE.REVERSED") {
      // Refund events don't always carry custom_id, so match shop orders by the capture id (no-op for memberships)
      const captureId = type === "PAYMENT.CAPTURE.REVERSED" ? res.id : ((res.links || []).find((l: any) => l.rel === "up")?.href || "").split("/").pop();
      if (captureId) {
        const hit = await db(`orders?paypal_capture_id=eq.${encodeURIComponent(captureId)}`, { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify({ status: "refunded" }) });
        if (Array.isArray(hit) && hit.length) { console.log(`Shop order #${hit[0].number} refunded`); return json(200, { order: true }); }
      }
    }
    if ((type === "PAYMENT.CAPTURE.DENIED" || type === "PAYMENT.CAPTURE.DECLINED") && shopOrder && /^[0-9a-f-]{36}$/.test(shopOrder)) {
      await db(`orders?id=eq.${shopOrder}&status=in.(pending,paid)`, { method: "PATCH", headers: { prefer: "return=minimal" },
        body: JSON.stringify({ status: "cancelled", admin_note: "PayPal denied this payment. Don't order from the supplier." }) });
      return json(200, { order: true });
    }

    // ── One-time payments ──────────────────────────────
    if (type === "PAYMENT.CAPTURE.COMPLETED") {
      if (String(res.invoice_id || "").startsWith("RS-")) return json(200, { ignored: "shop order" });
      const amount = Number(res.amount?.value || 0);
      if (amount + 0.001 < EXPECTED) {
        console.log(`Ignored capture ${res.id}: amount ${amount} below ${EXPECTED}`);
        return json(200, { ignored: "amount" });
      }
      // Prefer the account email the site attached to the order (custom_id),
      // so the right account unlocks even if they paid with a different PayPal email.
      let email = String(res.custom_id || "").trim().toLowerCase();
      if (!email.includes("@")) {
        const orderId = res.supplementary_data?.related_ids?.order_id;
        if (!orderId) throw new Error(`Capture ${res.id} has no order id`);
        const order = await paypalGet(token, `/v2/checkout/orders/${orderId}`);
        // Never unlock a membership for a shop purchase
        const pu = order.purchase_units?.[0] || {};
        if (String(pu.custom_id || "").startsWith("order:") || String(pu.invoice_id || "").startsWith("RS-")) {
          console.log(`Capture ${res.id} is a shop order; no membership change`);
          return json(200, { ignored: "shop order" });
        }
        email = String(order.purchase_units?.[0]?.custom_id || order.payer?.email_address || "").trim().toLowerCase();
      }
      if (!email.includes("@")) throw new Error(`Capture ${res.id} has no usable email`);

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
