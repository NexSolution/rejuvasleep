// RejuvaSleep shop: catalogue, cart, checkout (PayPal or card), orders and tracking.
// Used by shop.html (anyone) and by the Shop tab inside the member app.
import { sb, esc } from "./supa.js";

const CFG = window.REJUVA_CONFIG || {};
const CART_KEY = "rejuva_cart", ORDERS_KEY = "rejuva_my_orders", ADDR_KEY = "rejuva_ship";

export const CATEGORIES = [
  ["sleep", "Sleep", "🌙"], ["eyes", "Eyes", "👁️"], ["gua-sha", "Gua sha", "💎"],
  ["skin", "Skin", "🧴"], ["supplements", "Supplements", "🌿"], ["other", "Other", "✨"]
];
const catOf = id => CATEGORIES.find(c => c[0] === id) || CATEGORIES[5];

// Common countries first, then the rest in alphabetical order
const TOP = ["US", "CA", "GB", "BB", "VC", "TT", "JM", "LC", "GD", "BS", "GY"];
const ALL = "AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IS IT JE JM JO JP KE KG KH KI KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");
let regionNames = null;
try { regionNames = new Intl.DisplayNames(["en"], { type: "region" }); } catch (e) {}
export const countryName = c => { try { return (regionNames && regionNames.of(c)) || c; } catch (e) { return c; } };
const COUNTRIES = [...TOP, ...ALL.filter(c => !TOP.includes(c)).sort((a, b) => countryName(a).localeCompare(countryName(b)))];

const STEPS = [
  ["paid", "Order received", "We've got your order and payment."],
  ["ordered", "Being prepared", "Your items are being packed at our partner warehouse."],
  ["shipped", "On its way", "Your parcel has shipped."],
  ["delivered", "Delivered", "Your parcel has arrived. Enjoy!"]
];
const STATUS_TEXT = { paid: "Order received", ordered: "Being prepared", shipped: "On its way", delivered: "Delivered", cancelled: "Cancelled", refunded: "Refunded" };

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch (e) { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

export function getCart() { return read(CART_KEY, []).filter(l => l && l.slug && l.qty > 0); }
function setCart(c) { write(CART_KEY, c); window.dispatchEvent(new CustomEvent("cartchange")); }
export const cartCount = () => getCart().reduce((a, l) => a + l.qty, 0);
function rememberOrder(o) {
  const list = read(ORDERS_KEY, []).filter(x => x.id !== o.id);
  list.unshift({ id: o.order_id || o.id, token: o.token, number: o.number });
  write(ORDERS_KEY, list.slice(0, 30));
}

export function trackingLink(o) {
  if (o.tracking_url) return o.tracking_url;
  return o.tracking_number ? `https://t.17track.net/en#nums=${encodeURIComponent(o.tracking_number)}` : "";
}

async function invoke(body) {
  const { data, error } = await sb.functions.invoke("shop-checkout", { body });
  if (error) {
    let msg = "Something went wrong. Please try again.";
    try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) {}
    throw new Error(msg);
  }
  return data;
}

function loadPayPal() {
  if (window.paypalShop) return Promise.resolve(window.paypalShop);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(CFG.paypalClientId)}&currency=USD&intent=capture&components=buttons&enable-funding=card&disable-funding=paylater,venmo`;
    s.dataset.namespace = "paypalShop";   // separate from the subscription checkout
    s.onload = () => window.paypalShop ? resolve(window.paypalShop) : reject(new Error("PayPal didn't load"));
    s.onerror = () => reject(new Error("PayPal didn't load"));
    document.head.appendChild(s);
  });
}

export function createShop({ view, navigate, toast, getUser }) {
  let products = null, settings = null, filter = "all";
  const money = c => `$${(Number(c || 0) / 100).toFixed(2)}`;
  const user = () => (getUser && getUser()) || null;

  async function loadCatalogue(force) {
    if (products && !force) return;
    const [p, s] = await Promise.all([
      sb.from("products").select("id,slug,name,category,summary,details,price_cents,compare_cents,image_url,is_supplement,blocked_countries,sort").eq("active", true).order("sort"),
      sb.from("shop_settings").select("*").eq("id", 1).maybeSingle()
    ]);
    if (p.error) throw p.error;
    products = p.data || [];
    settings = s.data || { shipping_cents: 599, free_over_cents: null, open: true, currency: "USD" };
  }
  const bySlug = slug => (products || []).find(p => p.slug === slug);

  const shipLine = () => {
    if (!settings) return "";
    const fee = settings.shipping_cents ? `${money(settings.shipping_cents)} flat shipping worldwide` : "Free shipping worldwide";
    return settings.free_over_cents && settings.shipping_cents ? `${fee} · free on orders over ${money(settings.free_over_cents)}` : fee;
  };
  const photo = (p, cls = "") => p.image_url
    ? `<img class="p-img ${cls}" src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy">`
    : `<div class="p-img ph ${cls}" aria-hidden="true"><span>${catOf(p.category)[2]}</span></div>`;
  const priceHTML = p => `<span class="p-price">${money(p.price_cents)}</span>${p.compare_cents && p.compare_cents > p.price_cents ? ` <s class="p-was">${money(p.compare_cents)}</s>` : ""}`;

  function addToCart(slug, qty = 1) {
    const c = getCart(), line = c.find(l => l.slug === slug);
    if (line) line.qty = Math.min(10, line.qty + qty); else c.push({ slug, qty: Math.min(10, qty) });
    setCart(c);
    const p = bySlug(slug);
    toast(`${p ? p.name : "Item"} added to your cart`);
  }

  const header = (title, back) => `${back !== null ? `<button class="back-link" data-nav="${back}">← Back</button>` : ""}${title ? `<h2>${title}</h2>` : ""}`;
  const bindNav = () => view.querySelectorAll("[data-nav]").forEach(b => b.onclick = () => navigate(b.dataset.nav));

  // ── Catalogue ────────────────────────────────────
  function renderCatalogue() {
    const cats = CATEGORIES.filter(c => products.some(p => p.category === c[0]));
    const list = products.filter(p => filter === "all" || p.category === filter);
    const n = cartCount();
    view.innerHTML = `<div class="shop">
      <div class="spread shop-head"><div><h2>Shop</h2><p class="lede">Hand-picked sleep and skin tools that go with your plan.</p></div></div>
      ${settings.notice ? `<div class="card notice"><p>${esc(settings.notice)}</p></div>` : ""}
      ${!settings.open ? `<div class="card notice"><p><strong>The shop is closed for new orders right now.</strong> You can still check on your orders.</p></div>` : ""}
      <div class="shop-bar">
        <p class="muted ship-line">📦 ${esc(shipLine())}</p>
        <div class="row" style="gap:10px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" data-nav="orders">My orders</button>
          <button class="btn btn-purple btn-sm" data-nav="cart">🛒 Cart${n ? ` (${n})` : ""}</button>
        </div>
      </div>
      ${cats.length > 1 ? `<div class="chips row-chips shop-chips"><button class="chip${filter === "all" ? " on" : ""}" data-cat="all">All</button>${cats.map(c => `<button class="chip${filter === c[0] ? " on" : ""}" data-cat="${c[0]}">${c[2]} ${c[1]}</button>`).join("")}</div>` : ""}
      ${list.length ? `<div class="p-grid">${list.map(p => `
        <div class="card p-card">
          <button class="p-open" data-nav="p/${esc(p.slug)}" aria-label="${esc(p.name)}">${photo(p)}</button>
          <div class="p-body">
            <h4><button class="link-plain" data-nav="p/${esc(p.slug)}">${esc(p.name)}</button></h4>
            <p class="muted p-sum">${esc(p.summary)}</p>
            <p>${priceHTML(p)}</p>
            ${settings.open ? `<button class="btn btn-gold full" data-add="${esc(p.slug)}">Add to cart</button>` : ""}
          </div>
        </div>`).join("")}</div>`
        : `<div class="card locked"><div class="ic">🛍️</div><h3>New products are coming soon</h3><p class="muted">Check back shortly.</p></div>`}
    </div>`;
    bindNav();
    view.querySelectorAll("[data-cat]").forEach(b => b.onclick = () => { filter = b.dataset.cat; renderCatalogue(); });
    view.querySelectorAll("[data-add]").forEach(b => b.onclick = () => { addToCart(b.dataset.add); renderCatalogue(); });
  }

  // ── One product ─────────────────────────────────
  function renderProduct(slug) {
    const p = bySlug(slug);
    if (!p) { view.innerHTML = `${header("Not available", "")}<p class="muted">This product isn't available any more.</p>`; bindNav(); return; }
    let qty = 1;
    const blocked = (p.blocked_countries || []);
    view.innerHTML = `<div class="shop">${header("", "")}
      <div class="card p-detail">
        ${photo(p, "big")}
        <div>
          <p class="label">${catOf(p.category)[2]} ${catOf(p.category)[1]}</p>
          <h2 style="margin-top:4px">${esc(p.name)}</h2>
          <p class="p-big-price">${priceHTML(p)}</p>
          <p>${esc(p.summary)}</p>
          ${p.details ? `<ul class="plain-list p-details">${p.details.split("\n").filter(Boolean).map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
          ${p.is_supplement ? `<div class="warn-box"><p><strong>Supplement.</strong> Read the label before use. Talk to your doctor first if you're pregnant, nursing, take any medication or have a health condition. Not for children.</p></div>` : ""}
          <p class="muted" style="margin-top:10px">📦 ${esc(shipLine())}${blocked.length ? `. <strong>Can't ship to:</strong> ${blocked.map(countryName).join(", ")}.` : "."}</p>
          ${settings.open ? `<div class="qty-row">
            <span class="muted">How many?</span>
            <div class="counter"><button type="button" id="qMinus" aria-label="One less">−</button><span class="n" id="qN">1</span><button type="button" id="qPlus" aria-label="One more">+</button></div>
          </div>
          <button class="btn btn-gold full big-btn" id="addBtn">Add to cart</button>
          <button class="btn btn-ghost full" data-nav="cart" style="margin-top:10px">Go to my cart</button>` : ""}
        </div>
      </div></div>`;
    bindNav();
    if ($$("qMinus")) {
      const show = () => { $$("qN").textContent = qty; };
      $$("qMinus").onclick = () => { qty = Math.max(1, qty - 1); show(); };
      $$("qPlus").onclick = () => { qty = Math.min(10, qty + 1); show(); };
      $$("addBtn").onclick = () => { addToCart(p.slug, qty); navigate("cart"); };
    }
  }
  const $$ = id => view.querySelector("#" + id);

  // ── Cart ─────────────────────────────────────────
  function cartLines() {
    const c = getCart();
    const lines = c.map(l => ({ ...l, p: bySlug(l.slug) }));
    const gone = lines.filter(l => !l.p);
    if (gone.length) setCart(c.filter(l => bySlug(l.slug)));
    return lines.filter(l => l.p);
  }
  function totals(lines) {
    const subtotal = lines.reduce((a, l) => a + l.p.price_cents * l.qty, 0);
    const shipping = !lines.length ? 0 : settings.free_over_cents && subtotal >= settings.free_over_cents ? 0 : settings.shipping_cents;
    return { subtotal, shipping, total: subtotal + shipping };
  }
  const totalsHTML = t => `<div class="kv"><span>Items</span><b>${money(t.subtotal)}</b></div>
    <div class="kv"><span>Shipping</span><b>${t.shipping ? money(t.shipping) : "Free"}</b></div>
    <div class="kv total"><span>Total</span><b>${money(t.total)}</b></div>`;

  function renderCart() {
    const lines = cartLines();
    if (!lines.length) {
      view.innerHTML = `<div class="shop">${header("Your cart", "")}<div class="card locked"><div class="ic">🛒</div><h3>Your cart is empty</h3><p class="muted">Have a look at the shop for sleep and skin tools.</p><button class="btn btn-gold full" data-nav="">Go to the shop</button></div></div>`;
      bindNav(); return;
    }
    const t = totals(lines);
    view.innerHTML = `<div class="shop">${header("Your cart", "")}
      <div class="card">${lines.map(l => `
        <div class="c-line">
          ${photo(l.p, "thumb")}
          <div class="c-info"><b>${esc(l.p.name)}</b><span class="muted">${money(l.p.price_cents)} each</span>
            <div class="row" style="gap:12px;margin-top:8px;flex-wrap:wrap">
              <div class="counter small"><button type="button" data-dec="${esc(l.slug)}" aria-label="One less">−</button><span class="n">${l.qty}</span><button type="button" data-inc="${esc(l.slug)}" aria-label="One more">+</button></div>
              <button class="link-btn" data-rm="${esc(l.slug)}">Remove</button>
            </div>
          </div>
          <b class="c-sum">${money(l.p.price_cents * l.qty)}</b>
        </div>`).join("")}
      </div>
      <div class="card" style="margin-top:16px">${totalsHTML(t)}
        ${settings.open ? `<button class="btn btn-gold full big-btn" data-nav="checkout" style="margin-top:16px">Checkout</button>` : `<p class="muted">The shop is closed for new orders right now.</p>`}
        <button class="btn btn-ghost full" data-nav="" style="margin-top:10px">Keep shopping</button>
        <p class="fine">Pay with PayPal or any debit or credit card. You don't need a PayPal account.</p>
      </div></div>`;
    bindNav();
    const change = (slug, d) => {
      const c = getCart(), l = c.find(x => x.slug === slug); if (!l) return;
      l.qty = Math.max(0, Math.min(10, l.qty + d));
      setCart(c.filter(x => x.qty > 0)); renderCart();
    };
    view.querySelectorAll("[data-inc]").forEach(b => b.onclick = () => change(b.dataset.inc, 1));
    view.querySelectorAll("[data-dec]").forEach(b => b.onclick = () => change(b.dataset.dec, -1));
    view.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => change(b.dataset.rm, -99));
  }

  // ── Checkout ─────────────────────────────────────
  function renderCheckout() {
    const lines = cartLines();
    if (!lines.length) return renderCart();
    const saved = read(ADDR_KEY, {}) || {};
    const u = user();
    const a = { email: (u && u.email) || saved.email || "", country: saved.country || "", ...saved };
    if (u && u.email) a.email = saved.email || u.email;
    const anySupp = lines.some(l => l.p.is_supplement);
    const f = (id, label, val, attrs = "") => `<label>${label}<input id="${id}" value="${esc(val || "")}" ${attrs}></label>`;
    view.innerHTML = `<div class="shop">${header("Checkout", "cart")}
      <div class="checkout-grid">
        <form class="card" id="shipForm" novalidate>
          <h3>Where should we send it?</h3>
          ${f("cEmail", "Email for order updates", a.email, 'type="email" autocomplete="email" required')}
          ${f("cName", "Full name", a.name, 'autocomplete="name" required maxlength="120"')}
          ${f("cPhone", "Phone (for the courier)", a.phone, 'type="tel" autocomplete="tel" required maxlength="30"')}
          <label>Country<select id="cCountry" autocomplete="country" required>
            <option value="">Choose your country</option>
            ${COUNTRIES.map((c, i) => `${i === TOP.length ? '<option disabled>──────────</option>' : ""}<option value="${c}"${a.country === c ? " selected" : ""}>${esc(countryName(c))}</option>`).join("")}
          </select></label>
          ${f("cLine1", "Street address", a.line1, 'autocomplete="address-line1" required maxlength="300"')}
          ${f("cLine2", "Apartment, unit, building (optional)", a.line2, 'autocomplete="address-line2" maxlength="300"')}
          <div class="grid2" style="gap:12px">
            ${f("cCity", "Town or city", a.city, 'autocomplete="address-level2" required maxlength="120"')}
            ${f("cRegion", "State, parish or province", a.region, 'autocomplete="address-level1" maxlength="120"')}
          </div>
          ${f("cPostal", "Postcode / ZIP (if you have one)", a.postal, 'autocomplete="postal-code" maxlength="60"')}
          <label class="check-line"><input type="checkbox" id="cRemember" ${saved.name || !Object.keys(saved).length ? "checked" : ""}> Remember my address on this device</label>
          ${anySupp ? `<label class="check-line"><input type="checkbox" id="cSupp"> I'll read the supplement labels and check with my doctor first if I'm pregnant, nursing, take medication or have a health condition.</label>` : ""}
        </form>
        <div>
          <div class="card" id="sumCard">
            <h3>Your order</h3>
            ${lines.map(l => `<div class="kv"><span>${l.qty} × ${esc(l.p.name)}</span><b>${money(l.p.price_cents * l.qty)}</b></div>`).join("")}
            <div id="sumTotals">${totalsHTML(totals(lines))}</div>
            <div id="blockedBox"></div>
            <p class="fine" id="dutyNote" hidden>Orders shipped outside the US may have import taxes or fees, which your country's customs collects on delivery.</p>
          </div>
          <div class="card" style="margin-top:16px">
            <p class="form-msg" id="cMsg" role="alert"></p>
            <button class="btn btn-gold full big-btn" id="toPay" type="button">Continue to payment</button>
            <div id="payBox" hidden>
              <p class="muted" style="margin-bottom:10px">Choose PayPal, or <strong>Debit or Credit Card</strong> to pay without a PayPal account.</p>
              <div id="shopPayPal" class="pp-wrap"><p class="muted">Loading secure checkout…</p></div>
              <button class="link-btn" id="editShip" type="button" style="margin-top:8px">← Change my details</button>
            </div>
            <p class="fine">Payments are handled securely by PayPal. RejuvaSleep never sees your card number.</p>
          </div>
        </div>
      </div></div>`;
    bindNav();

    const msg = (t, ok) => { const el = $$("cMsg"); el.textContent = t || ""; el.className = "form-msg" + (ok ? " ok" : ""); };
    const form = () => ({
      email: $$("cEmail").value.trim().toLowerCase(),
      ship_to: { name: $$("cName").value.trim(), phone: $$("cPhone").value.trim(), country: $$("cCountry").value,
        line1: $$("cLine1").value.trim(), line2: $$("cLine2").value.trim(), city: $$("cCity").value.trim(), region: $$("cRegion").value.trim(), postal: $$("cPostal").value.trim() }
    });
    let blockedNames = [];
    const items = () => getCart().map(({ slug, qty }) => ({ slug, qty }));
    const requote = async () => {
      const country = $$("cCountry").value;
      $$("dutyNote").hidden = !country || country === "US";
      if (!country) { $$("blockedBox").innerHTML = ""; blockedNames = []; return; }
      try {
        const q = await invoke({ action: "quote", items: items(), country });
        $$("sumTotals").innerHTML = totalsHTML(q);
        blockedNames = q.blocked || [];
        $$("blockedBox").innerHTML = blockedNames.length ? `<div class="warn-box"><p><strong>We can't ship ${esc(blockedNames.join(", "))} to ${esc(countryName(country))}.</strong> Some supplements are restricted there.</p>
          <button class="btn btn-ghost full" id="rmBlocked" style="margin-top:8px">Remove ${blockedNames.length > 1 ? "them" : "it"} from my cart</button></div>` : "";
        if ($$("rmBlocked")) $$("rmBlocked").onclick = () => {
          const bad = new Set(lines.filter(l => blockedNames.includes(l.p.name)).map(l => l.slug));
          setCart(getCart().filter(l => !bad.has(l.slug)));
          if (!getCart().length) return navigate("cart");
          saveDraft(); renderCheckout();
        };
      } catch (e) { /* the server checks again at payment */ }
    };
    const saveDraft = () => { const d = form(); write(ADDR_KEY, $$("cRemember").checked ? { email: d.email, ...d.ship_to } : {}); };
    $$("cCountry").onchange = requote;
    if (a.country) requote();

    const validate = () => {
      const d = form(), s = d.ship_to;
      if (!/^\S+@\S+\.\S+$/.test(d.email)) return "Please enter a valid email so we can send your order updates.";
      if (s.name.length < 2) return "Please enter the name for the delivery.";
      if (!/^[+\d][\d\s().-]{5,}$/.test(s.phone)) return "Please enter a phone number so the courier can reach you.";
      if (!s.country) return "Please choose your country.";
      if (s.line1.length < 3) return "Please enter your street address.";
      if (s.city.length < 2) return "Please enter your town or city.";
      if (blockedNames.length) return "Please remove the items we can't ship to your country.";
      if (anySupp && !$$("cSupp").checked) return "Please tick the supplement box to continue.";
      return "";
    };
    const lock = on => $$("shipForm").querySelectorAll("input,select").forEach(el => { el.disabled = on; });

    $$("editShip").onclick = () => { lock(false); $$("payBox").hidden = true; $$("toPay").hidden = false; msg(""); };
    $$("toPay").onclick = async () => {
      const err = validate();
      if (err) { msg(err); return; }
      msg(""); saveDraft(); lock(true);
      $$("toPay").hidden = true; $$("payBox").hidden = false;
      let paypal;
      try { paypal = await loadPayPal(); }
      catch (e) { $$("shopPayPal").innerHTML = `<p class="muted">Checkout couldn't load. Check your connection and refresh the page.</p>`; return; }
      $$("shopPayPal").innerHTML = "";
      let current = null;
      paypal.Buttons({
        style: { layout: "vertical", color: "gold", shape: "pill", label: "pay" },
        createOrder: async () => {
          msg("");
          try {
            const d = form();
            current = await invoke({ action: "create", items: items(), ...d });
            return current.paypal_order_id;
          } catch (e) { msg(e.message); throw e; }
        },
        onApprove: async (data, actions) => {
          msg("Confirming your payment…", true);
          try {
            const r = await invoke({ action: "capture", paypal_order_id: data.orderID });
            if (r.retry) { msg(r.error); return actions.restart(); }
            rememberOrder(r);
            setCart([]);
            navigate(`order/${r.order_id}/${r.token}`, { fresh: true });
          } catch (e) { msg(e.message); }
        },
        onCancel: () => msg("Payment cancelled. Your cart is saved, so you can try again whenever you're ready."),
        onError: err => { console.error(err); if (!$$("cMsg").textContent) msg("Something went wrong with the payment. You haven't been charged. Please try again."); }
      }).render("#shopPayPal").catch(e => { console.error(e); $$("shopPayPal").innerHTML = `<p class="muted">Checkout couldn't load. Please refresh the page.</p>`; });
    };
  }

  // ── Orders ───────────────────────────────────────
  const ORDER_COLS = "id,number,email,status,items,subtotal_cents,shipping_cents,total_cents,currency,ship_to,carrier,tracking_number,tracking_url,customer_note,created_at,paid_at,ordered_at,shipped_at,delivered_at";
  const when = ts => ts ? new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";

  async function fetchOrder(id, token) {
    if (token) return (await invoke({ action: "view", id, token })).order;
    const { data, error } = await sb.from("orders").select(ORDER_COLS).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) {
      const local = read(ORDERS_KEY, []).find(o => o.id === id);
      if (local) return (await invoke({ action: "view", id, token: local.token })).order;
      throw new Error("We couldn't find that order on this account.");
    }
    return data;
  }

  async function renderOrders() {
    view.innerHTML = `<div class="shop">${header("My orders", "")}<p class="loading">Loading your orders…</p></div>`; bindNav();
    const found = new Map();
    if (user()) {
      const { data } = await sb.from("orders").select(ORDER_COLS).order("created_at", { ascending: false });
      (data || []).forEach(o => found.set(o.id, o));
    }
    // Orders placed on this device without logging in
    const local = read(ORDERS_KEY, []).filter(o => !found.has(o.id));
    await Promise.all(local.slice(0, 15).map(async o => { try { const r = await invoke({ action: "view", id: o.id, token: o.token }); if (r.order) found.set(o.id, { ...r.order, _token: o.token }); } catch (e) {} }));
    const list = [...found.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    view.innerHTML = `<div class="shop">${header("My orders", "")}
      ${list.length ? `<div class="stack">${list.map(o => `
        <button class="card o-card" data-nav="order/${o.id}${o._token ? "/" + o._token : ""}">
          <div class="spread"><b>Order #${o.number}</b><span class="o-status st-${o.status}">${esc(STATUS_TEXT[o.status] || o.status)}</span></div>
          <p class="muted">${when(o.created_at)} · ${o.items.reduce((a, i) => a + i.qty, 0)} item${o.items.reduce((a, i) => a + i.qty, 0) === 1 ? "" : "s"} · ${money(o.total_cents)}</p>
          <p class="o-items">${o.items.map(i => esc(i.name)).join(", ")}</p>
          ${o.status === "shipped" && o.tracking_number ? `<p class="o-track">📦 Tracking: ${esc(o.tracking_number)}</p>` : ""}
        </button>`).join("")}</div>`
        : `<div class="card locked"><div class="ic">📦</div><h3>No orders yet</h3><p class="muted">${user() ? "When you buy something from the shop, you can follow it here." : "Placed an order without an account? Open the link in your order email, or log in with the email you used."}</p><button class="btn btn-gold full" data-nav="">Go to the shop</button></div>`}
      <p class="fine">Questions about an order? Email <a href="mailto:${esc(CFG.supportEmail || "")}">${esc(CFG.supportEmail || "us")}</a> with your order number.</p>
    </div>`;
    bindNav();
  }

  async function renderOrder(id, token, fresh) {
    view.innerHTML = `<div class="shop"><p class="loading">Loading your order…</p></div>`;
    let o;
    try { o = await fetchOrder(id, token); }
    catch (e) { view.innerHTML = `<div class="shop">${header("Order", "orders")}<div class="card"><p>${esc(e.message)}</p></div></div>`; bindNav(); return; }
    if (token) rememberOrder({ id: o.id, token, number: o.number });
    const stopped = o.status === "cancelled" || o.status === "refunded";
    const at = STEPS.findIndex(s => s[0] === o.status);
    const dates = { paid: o.paid_at, ordered: o.ordered_at, shipped: o.shipped_at, delivered: o.delivered_at };
    const link = trackingLink(o);
    const a = o.ship_to || {};
    const shareLink = token ? new URL(`shop.html#order/${o.id}/${token}`, location.href).href : "";
    view.innerHTML = `<div class="shop">${header(`Order #${o.number}`, "orders")}
      ${fresh ? `<div class="card ci-hero"><div class="big-ic">🎉</div><h2>Thank you! Your order is in.</h2><p class="muted">We'll update this page as soon as it ships. You can always find it under <strong>My orders</strong>.</p></div>` : ""}
      <div class="card">
        <p class="muted">Placed ${when(o.created_at)} · ${money(o.total_cents)}</p>
        ${stopped ? `<div class="warn-box"><p><strong>This order was ${o.status}.</strong> ${o.status === "refunded" ? "Your money has been returned to the card or PayPal account you paid with." : "You haven't been charged, or the payment has been returned."}</p></div>`
          : `<ol class="o-steps">${STEPS.map(([k, t, d], i) => `<li class="${i < at ? "done" : i === at ? "now" : ""}">
              <span class="dot">${i <= at ? "✓" : ""}</span><div><b>${t}</b>${dates[k] ? `<small>${when(dates[k])}</small>` : ""}${i === at ? `<p class="muted">${d}</p>` : ""}</div></li>`).join("")}</ol>`}
        ${o.tracking_number ? `<div class="track-box">
            <p class="label">Tracking</p>
            <p><b>${esc(o.carrier || "Tracking number")}:</b> <span class="mono">${esc(o.tracking_number)}</span></p>
            ${link ? `<a class="btn btn-purple full" href="${esc(link)}" target="_blank" rel="noopener">Track my parcel</a>` : ""}
          </div>` : (!stopped && at < 2 ? `<p class="muted" style="margin-top:10px">Your tracking number will appear here once your parcel ships.</p>` : "")}
        ${o.customer_note ? `<div class="notice-box"><p class="label">Message from RejuvaSleep</p><p>${esc(o.customer_note)}</p></div>` : ""}
      </div>
      <div class="grid2" style="margin-top:16px">
        <div class="card"><h3>Items</h3>
          ${o.items.map(i => `<div class="kv"><span>${i.qty} × ${esc(i.name)}</span><b>${money(i.price_cents * i.qty)}</b></div>`).join("")}
          ${totalsHTML({ subtotal: o.subtotal_cents, shipping: o.shipping_cents, total: o.total_cents })}
        </div>
        <div class="card"><h3>Shipping to</h3>
          <p>${esc(a.name)}<br>${esc(a.line1)}${a.line2 ? "<br>" + esc(a.line2) : ""}<br>${esc([a.city, a.region, a.postal].filter(Boolean).join(", "))}<br>${esc(countryName(a.country))}</p>
          <p class="muted" style="margin-top:8px">Updates go to ${esc(o.email)}</p>
        </div>
      </div>
      ${shareLink && !user() ? `<div class="card" style="margin-top:16px"><p class="label">Keep this link</p><p class="muted">Bookmark this page, or copy the link, to check your order from any device.</p>
        <button class="btn btn-ghost full" id="copyLink" style="margin-top:8px">Copy my order link</button></div>` : ""}
      <p class="fine">Questions? Email <a href="mailto:${esc(CFG.supportEmail || "")}?subject=${encodeURIComponent("Order #" + o.number)}">${esc(CFG.supportEmail || "us")}</a> and mention order #${o.number}.</p>
    </div>`;
    bindNav();
    if ($$("copyLink")) $$("copyLink").onclick = async () => { try { await navigator.clipboard.writeText(shareLink); toast("Link copied"); } catch (e) { prompt("Copy your order link:", shareLink); } };
  }

  async function render(route = "", opts = {}) {
    const [page, a, b] = String(route || "").split("/");
    if (page === "order") return renderOrder(a, b, opts.fresh);
    if (page === "orders") return renderOrders();
    if (!products) view.innerHTML = `<div class="shop"><p class="loading">Loading the shop…</p></div>`;
    try { await loadCatalogue(page === "" && !opts.cached); }
    catch (e) { view.innerHTML = `<div class="card"><h3>The shop couldn't load</h3><p class="muted">Check your connection and try again.</p><button class="btn btn-purple btn-sm" id="shopRetry" style="margin-top:12px">Try again</button></div>`; $$("shopRetry").onclick = () => render(route); return; }
    if (page === "p") return renderProduct(a);
    if (page === "cart") return renderCart();
    if (page === "checkout") return renderCheckout();
    return renderCatalogue();
  }

  return { render };
}
