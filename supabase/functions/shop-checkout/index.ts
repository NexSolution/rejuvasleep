// RejuvaSleep shop checkout — anyone can buy, logged in or not.
// Actions:
//   "quote"   {items:[{slug,qty}], country}              -> prices, shipping, total, anything that can't ship there
//   "create"  {items, email, ship_to}                    -> saves a pending order and opens a PayPal order
//   "capture" {paypal_order_id}                          -> takes the payment and marks the order paid
//   "view"    {id, token}                                -> a guest's own order and its tracking
// Prices always come from the products table, never from the browser.
// Secrets: PAYPAL_CLIENT_ID, PAYPAL_SECRET, optional PAYPAL_ENV (same as the other functions).

const PAYPAL_API = Deno.env.get("PAYPAL_ENV") === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const MAX_QTY = 10, MAX_LINES = 20;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
class Oops extends Error {}   // a problem the customer can fix; shown to them as-is

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

async function paypal(token: string, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await fetch(`${PAYPAL_API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let data: any = null; try { data = t ? JSON.parse(t) : null; } catch { /* empty */ }
  return { ok: r.ok, status: r.status, data };
}

// The logged-in customer, if there is one (guests are fine too)
async function currentUser(req: Request): Promise<{ id: string; email: string } | null> {
  const auth = req.headers.get("authorization") || "";
  const tok = auth.replace(/^Bearer\s+/i, "");
  if (!tok || tok === ANON_KEY || tok.split(".").length !== 3) return null;
  try {
    const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { authorization: auth, apikey: ANON_KEY } });
    if (!u.ok) return null;
    const j = await u.json();
    return j && j.id ? { id: j.id, email: String(j.email || "").toLowerCase() } : null;
  } catch { return null; }
}

const money = (c: number) => (c / 100).toFixed(2);
const clean = (v: unknown, max = 120) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

async function settings() {
  const rows = await db("shop_settings?id=eq.1&select=*");
  return rows?.[0] || { currency: "USD", shipping_cents: 599, free_over_cents: null, open: true };
}

// Work out the cart from the database
async function price(items: any[], country: string) {
  if (!Array.isArray(items) || !items.length) throw new Oops("Your cart is empty.");
  if (items.length > MAX_LINES) throw new Oops("That's a lot of different items. Please split it into two orders.");
  const want = new Map<string, number>();
  for (const it of items) {
    const slug = clean(it?.slug, 80), qty = Math.floor(Number(it?.qty));
    if (!/^[a-z0-9-]+$/.test(slug) || !(qty >= 1)) continue;
    want.set(slug, Math.min(MAX_QTY, (want.get(slug) || 0) + qty));
  }
  if (!want.size) throw new Oops("Your cart is empty.");
  const list = [...want.keys()].map(encodeURIComponent).join(",");
  const rows: any[] = await db(`products?slug=in.(${list})&active=eq.true&select=id,slug,name,price_cents,image_url,is_supplement,blocked_countries`);
  const bySlug = new Map(rows.map(r => [r.slug, r]));
  const lines: any[] = [], missing: string[] = [], blocked: string[] = [];
  for (const [slug, qty] of want) {
    const p = bySlug.get(slug);
    if (!p) { missing.push(slug); continue; }
    if (country && (p.blocked_countries || []).includes(country)) blocked.push(p.name);
    lines.push({ product_id: p.id, slug, name: p.name, price_cents: p.price_cents, qty, image_url: p.image_url, is_supplement: p.is_supplement });
  }
  const s = await settings();
  const subtotal = lines.reduce((a, l) => a + l.price_cents * l.qty, 0);
  const shipping = !lines.length ? 0 : (s.free_over_cents && subtotal >= s.free_over_cents ? 0 : s.shipping_cents);
  return { lines, missing, blocked, subtotal, shipping, total: subtotal + shipping, currency: s.currency || "USD", open: s.open !== false };
}

function checkAddress(a: any) {
  const ship = {
    name: clean(a?.name, 120), phone: clean(a?.phone, 30), line1: clean(a?.line1, 300), line2: clean(a?.line2, 300),
    city: clean(a?.city, 120), region: clean(a?.region, 120), postal: clean(a?.postal, 60), country: clean(a?.country, 2).toUpperCase(),
  };
  if (ship.name.length < 2) throw new Oops("Please enter the name for the delivery.");
  if (!/^[A-Z]{2}$/.test(ship.country)) throw new Oops("Please choose your country.");
  if (ship.line1.length < 3) throw new Oops("Please enter your street address.");
  if (ship.city.length < 2) throw new Oops("Please enter your town or city.");
  if (!/^[+\d][\d\s().-]{5,}$/.test(ship.phone)) throw new Oops("Please enter a phone number so the courier can reach you.");
  return ship;
}

const PUBLIC_FIELDS = "id,number,email,status,items,subtotal_cents,shipping_cents,total_cents,currency,ship_to,carrier,tracking_number,tracking_url,customer_note,created_at,paid_at,ordered_at,shipped_at,delivered_at";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  let body: any = {};
  try { body = await req.json(); } catch { return json(400, { error: "Bad request" }); }
  const action = String(body.action || "");

  try {
    if (action === "quote") {
      const country = clean(body.country, 2).toUpperCase();
      const q = await price(body.items, country);
      return json(200, q);
    }

    if (action === "create") {
      const email = clean(body.email, 200).toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Oops("Please enter a valid email so we can send your order updates.");
      const ship = checkAddress(body.ship_to);
      const q = await price(body.items, ship.country);
      if (!q.open) throw new Oops("The shop is closed for new orders right now. Please check back soon.");
      if (q.missing.length) throw new Oops("Something in your cart is no longer available. Please refresh your cart.");
      if (q.blocked.length) throw new Oops(`Sorry, we can't ship ${q.blocked.join(", ")} to your country. Please remove ${q.blocked.length > 1 ? "them" : "it"} to continue.`);
      const user = await currentUser(req);

      const [order] = await db("orders?select=id,number", {
        method: "POST", headers: { prefer: "return=representation" },
        body: JSON.stringify({
          user_id: user?.id || null, email, status: "pending",
          items: q.lines.map(({ is_supplement: _s, ...l }) => l),
          subtotal_cents: q.subtotal, shipping_cents: q.shipping, total_cents: q.total, currency: q.currency, ship_to: ship,
        }),
      });

      const token = await paypalToken();
      const cur = q.currency;
      const r = await paypal(token, "POST", "/v2/checkout/orders", {
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: order.id,
          custom_id: `order:${order.id}`,
          invoice_id: `RS-${order.number}`,
          description: `RejuvaSleep order #${order.number}`,
          amount: {
            currency_code: cur, value: money(q.total),
            breakdown: { item_total: { currency_code: cur, value: money(q.subtotal) }, shipping: { currency_code: cur, value: money(q.shipping) } },
          },
          items: q.lines.map(l => ({ name: l.name.slice(0, 127), sku: l.slug.slice(0, 127), quantity: String(l.qty), category: "PHYSICAL_GOODS", unit_amount: { currency_code: cur, value: money(l.price_cents) } })),
          shipping: {
            name: { full_name: ship.name.slice(0, 300) },
            address: {
              address_line_1: ship.line1, address_line_2: ship.line2 || undefined, admin_area_2: ship.city,
              admin_area_1: ship.region || undefined, postal_code: ship.postal || undefined, country_code: ship.country,
            },
          },
        }],
        application_context: { brand_name: "RejuvaSleep", shipping_preference: "SET_PROVIDED_ADDRESS", user_action: "PAY_NOW" },
      }, { "PayPal-Request-Id": `create-${order.id}` });
      if (!r.ok || !r.data?.id) {
        console.error("PayPal create failed", r.status, JSON.stringify(r.data));
        const issue = r.data?.details?.[0]?.issue || "";
        if (/ADDRESS|POSTAL|COUNTRY|STATE|CITY/i.test(issue)) throw new Oops("PayPal couldn't use that address. Please check the postcode, state and country.");
        throw new Error(`PayPal couldn't start checkout (${r.status})`);
      }
      await db(`orders?id=eq.${order.id}`, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ paypal_order_id: r.data.id }) });
      console.log(`Order #${order.number} created for ${email}: ${money(q.total)} ${cur}`);
      return json(200, { paypal_order_id: r.data.id, order_id: order.id, number: order.number });
    }

    if (action === "capture") {
      const ppId = clean(body.paypal_order_id, 64);
      if (!/^[A-Z0-9]+$/.test(ppId)) throw new Oops("Missing PayPal order.");
      const rows = await db(`orders?paypal_order_id=eq.${encodeURIComponent(ppId)}&select=id,number,view_token,status,total_cents,currency`);
      const o = rows?.[0];
      if (!o) throw new Oops("We couldn't find that order. Please contact us before trying again.");
      if (o.status !== "pending") return json(200, { order_id: o.id, number: o.number, token: o.view_token, status: o.status });

      const token = await paypalToken();
      const r = await paypal(token, "POST", `/v2/checkout/orders/${ppId}/capture`, {}, { "PayPal-Request-Id": `capture-${o.id}` });
      const issue = r.data?.details?.[0]?.issue || "";
      if (issue === "INSTRUMENT_DECLINED" || issue === "PAYER_ACTION_REQUIRED") return json(200, { retry: true, error: "Your card or PayPal payment was declined. Please try another way to pay." });
      if (issue === "ORDER_ALREADY_CAPTURED") {
        const again = await paypal(token, "GET", `/v2/checkout/orders/${ppId}`);
        r.data = again.data; r.ok = again.ok;
      }
      if (!r.ok) { console.error("Capture failed", r.status, JSON.stringify(r.data)); throw new Error(`PayPal capture failed (${r.status})`); }

      const cap = r.data?.purchase_units?.[0]?.payments?.captures?.[0];
      const paid = cap && (cap.status === "COMPLETED" || cap.status === "PENDING");
      const amountOk = cap && cap.amount?.currency_code === o.currency && Math.round(Number(cap.amount?.value) * 100) === o.total_cents;
      if (!paid || !amountOk) {
        console.error(`Order #${o.number}: capture not usable`, JSON.stringify(cap));
        throw new Oops("We couldn't confirm your payment. Please email us before trying again, so you aren't charged twice.");
      }
      await db(`orders?id=eq.${o.id}&status=eq.pending`, {
        method: "PATCH", headers: { prefer: "return=minimal" },
        body: JSON.stringify({ status: "paid", paid_at: new Date().toISOString(), paypal_capture_id: cap.id,
          ...(cap.status === "PENDING" ? { admin_note: "PayPal is still reviewing this payment. Check it shows as completed in PayPal before ordering from the supplier." } : {}) }),
      });
      console.log(`Order #${o.number} paid (capture ${cap.id}${cap.status === "PENDING" ? ", pending review at PayPal" : ""})`);
      return json(200, { order_id: o.id, number: o.number, token: o.view_token, status: "paid" });
    }

    if (action === "view") {
      const id = clean(body.id, 40), tok = clean(body.token, 64);
      if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f]{20,}$/.test(tok)) throw new Oops("That order link isn't complete.");
      const rows = await db(`orders?id=eq.${id}&view_token=eq.${tok}&status=neq.pending&select=${PUBLIC_FIELDS}`);
      if (!rows?.length) throw new Oops("We couldn't find that order. Check the link in your email, or contact us.");
      return json(200, { order: rows[0] });
    }

    return json(400, { error: "Unknown action" });
  } catch (err) {
    if (err instanceof Oops) return json(400, { error: err.message });
    console.error(err);
    return json(500, { error: "Something went wrong at checkout. Please try again in a minute. If PayPal already shows a payment, your order is safe and we'll be in touch." });
  }
});
