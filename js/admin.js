// RejuvaSleep shop admin: orders, tracking, products and shipping settings.
// Only emails in the admins table can use it (checked by the database, not just this page).
import { sb, esc, friendlyError } from "./supa.js";
import { CATEGORIES, countryName, trackingLink } from "./shop.js?v=16";

const CFG = window.REJUVA_CONFIG || {};
const $ = id => document.getElementById(id);
const view = $("view");
const money = c => `$${(Number(c || 0) / 100).toFixed(2)}`;
const cents = v => { const n = Math.round(parseFloat(String(v).replace(/[^0-9.]/g, "")) * 100); return Number.isFinite(n) ? n : null; };
const dollars = c => c == null ? "" : (c / 100).toFixed(2);
const when = ts => ts ? new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
function toast(text) { const t = $("toast"); t.textContent = text; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2600); }

const STATUS = [["paid", "To order", "New and paid. Order it from your supplier."], ["ordered", "Ordered", "Placed with the supplier, waiting to ship."],
  ["shipped", "Shipped", "On its way to the customer."], ["delivered", "Delivered", ""], ["cancelled", "Cancelled", ""], ["refunded", "Refunded", ""]];
const label = s => (STATUS.find(x => x[0] === s) || [s, s])[1];
const CARRIERS = ["USPS", "UPS", "FedEx", "DHL", "Royal Mail", "Canada Post", "YunExpress", "4PX", "China Post", "Cainiao", "Other"];

const A = { tab: "orders", filter: "paid", orders: [], products: [], suppliers: {}, settings: null, open: null, editing: null };

$("logout").onclick = async () => { await sb.auth.signOut(); location.replace("login.html?mode=login&next=admin"); };

// ── Start ───────────────────────────────────────────
const { data: { session } } = await sb.auth.getSession();
if (!session) location.replace("login.html?mode=login&next=admin");
else {
  const { data: ok } = await sb.rpc("is_admin");
  if (!ok) view.innerHTML = `<div class="card locked"><div class="ic">🔒</div><h3>This page is for the RejuvaSleep team</h3><p class="muted">You're logged in as ${esc(session.user.email)}, which isn't on the team list.</p><a class="btn btn-gold full" href="shop.html">Go to the shop</a></div>`;
  else { await loadAll(); render(); }
}

async function loadAll() {
  const [o, p, s, st] = await Promise.all([
    sb.rpc("admin_orders", { p_status: null }),
    sb.from("products").select("*").order("sort"),
    sb.from("product_suppliers").select("*"),
    sb.from("shop_settings").select("*").eq("id", 1).maybeSingle()
  ]);
  if (o.error) toast(friendlyError(o.error));
  A.orders = o.data || []; A.products = p.data || [];
  A.suppliers = Object.fromEntries((s.data || []).map(x => [x.product_id, x]));
  A.settings = st.data || { shipping_cents: 599, free_over_cents: null, open: true, notice: "" };
}

function render() {
  const todo = A.orders.filter(o => o.status === "paid").length;
  view.innerHTML = `<div class="seg admin-tabs" role="tablist">
      <button data-tab="orders" class="${A.tab === "orders" ? "on" : ""}">📦 Orders${todo ? ` <span class="count">${todo}</span>` : ""}</button>
      <button data-tab="products" class="${A.tab === "products" ? "on" : ""}">🛍️ Products</button>
      <button data-tab="settings" class="${A.tab === "settings" ? "on" : ""}">⚙️ Shipping</button>
    </div><div id="pane"></div>`;
  view.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { A.tab = b.dataset.tab; A.open = null; A.editing = null; render(); });
  ({ orders: renderOrders, products: A.editing ? renderProductForm : renderProducts, settings: renderSettings })[A.tab]();
}

// ── Orders ──────────────────────────────────────────
function renderOrders() {
  const pane = $("pane");
  const groups = [["paid", "To order"], ["ordered", "Ordered"], ["shipped", "Shipped"], ["delivered", "Delivered"], ["closed", "Cancelled / refunded"], ["all", "All"]];
  const match = o => A.filter === "all" || (A.filter === "closed" ? ["cancelled", "refunded"].includes(o.status) : o.status === A.filter);
  const list = A.orders.filter(match);
  const count = k => A.orders.filter(o => k === "all" || (k === "closed" ? ["cancelled", "refunded"].includes(o.status) : o.status === k)).length;
  const paidTotal = A.orders.filter(o => !["cancelled", "refunded"].includes(o.status)).reduce((a, o) => a + o.total_cents, 0);
  pane.innerHTML = `
    <div class="spread admin-head"><h2>Orders</h2><button class="btn btn-ghost btn-sm" id="refresh">↻ Refresh</button></div>
    <p class="muted">${A.orders.length} order${A.orders.length === 1 ? "" : "s"} · ${money(paidTotal)} taken (not counting refunds)</p>
    <div class="chips row-chips shop-chips">${groups.map(([k, t]) => `<button class="chip${A.filter === k ? " on" : ""}" data-f="${k}">${t} (${count(k)})</button>`).join("")}</div>
    ${list.length ? `<div class="stack">${list.map(orderCard).join("")}</div>` : `<div class="card"><p class="muted">${A.filter === "paid" ? "Nothing to order right now. 🎉" : "No orders here."}</p></div>`}`;
  $("refresh").onclick = async () => { await loadAll(); render(); toast("Up to date"); };
  pane.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { A.filter = b.dataset.f; A.open = null; renderOrders(); });
  pane.querySelectorAll("[data-toggle]").forEach(b => b.onclick = () => { A.open = A.open === b.dataset.toggle ? null : b.dataset.toggle; renderOrders(); });
  if (A.open && list.some(o => o.id === A.open)) bindOrder(A.orders.find(o => o.id === A.open));
}

const addrText = a => [a.name, a.line1, a.line2, [a.city, a.region, a.postal].filter(Boolean).join(", "), countryName(a.country), a.phone ? "Phone: " + a.phone : ""].filter(Boolean).join("\n");
const orderLink = o => new URL(`shop.html#order/${o.id}/${o.view_token}`, location.href).href;

function orderCard(o) {
  const a = o.ship_to || {}, open = A.open === o.id;
  const head = `<button class="o-head" data-toggle="${o.id}" aria-expanded="${open}">
      <div class="spread"><b>#${o.number} · ${esc(a.name || o.email)}</b><span class="o-status st-${o.status}">${esc(label(o.status))}</span></div>
      <p class="muted">${when(o.paid_at || o.created_at)} · ${esc(countryName(a.country))} · ${money(o.total_cents)}</p>
      <p class="o-items">${o.items.map(i => `${i.qty} × ${esc(i.name)}`).join(", ")}</p>
      ${o.admin_note ? `<p class="o-flag">⚠️ ${esc(o.admin_note)}</p>` : ""}
    </button>`;
  if (!open) return `<div class="card o-admin">${head}</div>`;
  return `<div class="card o-admin open">${head}
    <div class="o-detail">
      <div class="grid2" style="gap:16px">
        <div>
          <p class="label">Items to order</p>
          ${o.items.map(i => { const sup = A.suppliers[i.product_id] || {}; return `<div class="kv"><span>${i.qty} × ${esc(i.name)}${sup.supplier_url ? ` · <a href="${esc(sup.supplier_url)}" target="_blank" rel="noopener">${esc(sup.supplier || "supplier")} ↗</a>` : sup.supplier ? ` · ${esc(sup.supplier)}` : ""}</span><b>${money(i.price_cents * i.qty)}</b></div>`; }).join("")}
          <div class="kv"><span>Shipping paid</span><b>${money(o.shipping_cents)}</b></div>
          <div class="kv total"><span>Total paid</span><b>${money(o.total_cents)}</b></div>
          <p class="fine">PayPal payment: ${esc(o.paypal_capture_id || "—")}</p>
        </div>
        <div>
          <p class="label">Ship to</p>
          <pre class="addr" id="addr">${esc(addrText(a))}</pre>
          <button class="btn btn-ghost btn-sm" id="copyAddr" type="button">Copy address</button>
          <p style="margin-top:10px">✉️ <a href="mailto:${esc(o.email)}">${esc(o.email)}</a></p>
        </div>
      </div>
      <form id="oForm" class="o-form">
        <div class="grid2" style="gap:12px">
          <label>Status<select id="oStatus">${STATUS.map(([k, t]) => `<option value="${k}"${o.status === k ? " selected" : ""}>${t}</option>`).join("")}</select></label>
          <label>Your supplier order number (private)<input id="oRef" value="${esc(o.supplier_ref || "")}" maxlength="120"></label>
          <label>Carrier<select id="oCarrier"><option value="">—</option>${CARRIERS.map(c => `<option${o.carrier === c ? " selected" : ""}>${c}</option>`).join("")}${o.carrier && !CARRIERS.includes(o.carrier) ? `<option selected>${esc(o.carrier)}</option>` : ""}</select></label>
          <label>Tracking number<input id="oTrack" value="${esc(o.tracking_number || "")}" maxlength="80"></label>
        </div>
        <label>Tracking link (optional — leave empty and we'll make one)<input id="oUrl" type="url" value="${esc(o.tracking_url || "")}" placeholder="https://"></label>
        <label>Message the customer sees on their order (optional)<textarea id="oNote" rows="2" maxlength="500">${esc(o.customer_note || "")}</textarea></label>
        <label>Private note (only you see this)<textarea id="oPriv" rows="2" maxlength="1000">${esc(o.admin_note || "")}</textarea></label>
        <p class="form-msg" id="oMsg" role="alert"></p>
        <button class="btn btn-purple full" type="submit">Save changes</button>
        <div class="row" style="gap:10px;margin-top:10px;flex-wrap:wrap">
          <a class="btn btn-ghost btn-sm" id="mailBtn" href="#">✉️ Email the customer an update</a>
          <button class="btn btn-ghost btn-sm" type="button" id="copyLink">Copy customer's order link</button>
        </div>
        <p class="fine">Refunds are done in PayPal (Activity → the payment → Refund). The order switches to Refunded here by itself.</p>
      </form>
    </div></div>`;
}

function bindOrder(o) {
  if (!o) return;
  const copy = async (text, ok) => { try { await navigator.clipboard.writeText(text); toast(ok); } catch (e) { prompt("Copy this:", text); } };
  $("copyAddr").onclick = () => copy(addrText(o.ship_to || {}), "Address copied");
  $("copyLink").onclick = () => copy(orderLink(o), "Order link copied");
  const mail = () => {
    const st = $("oStatus").value, tr = $("oTrack").value.trim(), name = ((o.ship_to || {}).name || "").split(" ")[0];
    const link = $("oUrl").value.trim() || trackingLink({ tracking_number: tr });
    const subject = st === "shipped" ? `Your RejuvaSleep order #${o.number} is on its way` : st === "delivered" ? `Your RejuvaSleep order #${o.number} was delivered` : `An update on your RejuvaSleep order #${o.number}`;
    const lines = [`Hi ${name || "there"},`, "",
      st === "shipped" ? `Good news, your order #${o.number} has shipped.` : `Here's an update on your order #${o.number}: ${label(st).toLowerCase()}.`,
      tr ? `Tracking (${$("oCarrier").value || "carrier"}): ${tr}${link ? "\n" + link : ""}` : "", $("oNote").value.trim(), "",
      `You can follow your order any time here:\n${orderLink(o)}`, "", "Sleep well,", "RejuvaSleep"];
    $("mailBtn").href = `mailto:${encodeURIComponent(o.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.filter((l, i) => l !== "" || lines[i - 1] !== "").join("\n"))}`;
  };
  ["oStatus", "oTrack", "oCarrier", "oUrl", "oNote"].forEach(id => $(id).addEventListener("input", mail)); mail();
  $("oForm").onsubmit = async e => {
    e.preventDefault();
    const upd = {
      status: $("oStatus").value, supplier_ref: $("oRef").value.trim() || null, carrier: $("oCarrier").value || null,
      tracking_number: $("oTrack").value.trim() || null, tracking_url: $("oUrl").value.trim() || null,
      customer_note: $("oNote").value.trim() || null, admin_note: $("oPriv").value.trim() || null
    };
    if (upd.tracking_url && !/^https?:\/\//i.test(upd.tracking_url)) { $("oMsg").textContent = "The tracking link needs to start with https://"; return; }
    if (upd.status === "shipped" && !upd.tracking_number && !confirm("Mark as shipped without a tracking number?")) return;
    const { error } = await sb.from("orders").update(upd).eq("id", o.id);
    if (error) { $("oMsg").textContent = friendlyError(error); return; }
    await loadAll(); toast(`Order #${o.number} saved`);
    render();
  };
}

// ── Products ────────────────────────────────────────
function renderProducts() {
  const pane = $("pane");
  pane.innerHTML = `<div class="spread admin-head"><h2>Products</h2><button class="btn btn-gold btn-sm" id="newP">+ Add a product</button></div>
    <p class="muted">Only products switched <strong>On</strong> show in the shop. Tap one to edit its photo, price and supplier.</p>
    <div class="stack" style="margin-top:12px">${A.products.map(p => {
      const sup = A.suppliers[p.id] || {};
      const profit = sup.cost_cents != null ? p.price_cents - sup.cost_cents : null;
      return `<button class="card o-head p-row" data-edit="${p.id}">
        ${p.image_url ? `<img class="p-img thumb" src="${esc(p.image_url)}" alt="">` : `<div class="p-img thumb ph"><span>${(CATEGORIES.find(c => c[0] === p.category) || CATEGORIES[5])[2]}</span></div>`}
        <div class="c-info"><b>${esc(p.name)}</b><span class="muted">${money(p.price_cents)}${profit != null ? ` · about ${money(profit)} profit each` : ""}${!p.image_url ? " · needs a photo" : ""}</span></div>
        <span class="o-status ${p.active ? "st-delivered" : ""}">${p.active ? "On" : "Off"}</span>
      </button>`; }).join("")}</div>`;
  $("newP").onclick = () => { A.editing = "new"; render(); };
  pane.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => { A.editing = b.dataset.edit; render(); });
}

const slugify = s => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

function renderProductForm() {
  const isNew = A.editing === "new";
  const p = isNew ? { name: "", slug: "", category: "sleep", summary: "", details: "", price_cents: null, compare_cents: null, image_url: "", is_supplement: false, blocked_countries: [], active: false, sort: 100 } : A.products.find(x => x.id === A.editing);
  const sup = (!isNew && A.suppliers[p.id]) || {};
  const pane = $("pane");
  pane.innerHTML = `<button class="back-link" id="backP">← All products</button>
    <form class="card" id="pForm">
      <h3>${isNew ? "Add a product" : esc(p.name)}</h3>
      <div class="photo-row">
        <div id="photoPrev">${p.image_url ? `<img class="p-img thumb big-thumb" src="${esc(p.image_url)}" alt="">` : `<div class="p-img thumb big-thumb ph"><span>📷</span></div>`}</div>
        <div style="flex:1;min-width:0">
          <label>Photo<input type="file" id="pFile" accept="image/*"></label>
          <label>or paste a photo link<input id="pImg" type="url" value="${esc(p.image_url || "")}" placeholder="https://"></label>
          <p class="fine">Square photos look best. Use your supplier's photos only if they allow it, or take your own.</p>
        </div>
      </div>
      <label>Name<input id="pName" value="${esc(p.name)}" required maxlength="120"></label>
      <div class="grid2" style="gap:12px">
        <label>Price ($)<input id="pPrice" inputmode="decimal" value="${dollars(p.price_cents)}" required></label>
        <label>Was price ($, optional)<input id="pCompare" inputmode="decimal" value="${dollars(p.compare_cents)}"></label>
        <label>Category<select id="pCat">${CATEGORIES.map(([k, t, ic]) => `<option value="${k}"${p.category === k ? " selected" : ""}>${ic} ${t}</option>`).join("")}</select></label>
        <label>Order in the shop (lower shows first)<input id="pSort" type="number" value="${p.sort}"></label>
      </div>
      <label>Short description<input id="pSum" value="${esc(p.summary)}" maxlength="200"></label>
      <label>Details (one per line)<textarea id="pDetails" rows="5">${esc(p.details)}</textarea></label>
      <label class="check-line"><input type="checkbox" id="pSupp" ${p.is_supplement ? "checked" : ""}> This is a supplement (shows a safety note and asks customers to confirm they've read it)</label>
      <label>Countries it can't be shipped to (2-letter codes, separated by commas)<input id="pBlocked" value="${esc((p.blocked_countries || []).join(", "))}" placeholder="e.g. GB, AU"></label>
      <p class="fine" id="pBlockedNames">${(p.blocked_countries || []).map(countryName).join(", ")}</p>

      <h3 style="margin-top:22px">Supplier (private)</h3>
      <div class="grid2" style="gap:12px">
        <label>Supplier name<input id="sName" value="${esc(sup.supplier || "")}" placeholder="e.g. CJdropshipping"></label>
        <label>Your cost per item incl. their shipping ($)<input id="sCost" inputmode="decimal" value="${dollars(sup.cost_cents)}"></label>
      </div>
      <label>Link to the product at your supplier<input id="sUrl" type="url" value="${esc(sup.supplier_url || "")}" placeholder="https://"></label>
      <label>Notes<textarea id="sNotes" rows="2">${esc(sup.notes || "")}</textarea></label>
      <p class="muted" id="profit"></p>

      <label class="check-line big-toggle"><input type="checkbox" id="pActive" ${p.active ? "checked" : ""}> <span><strong>Show in the shop</strong><br><small class="muted">Leave off until the photo, price and supplier are ready.</small></span></label>
      <p class="form-msg" id="pMsg" role="alert"></p>
      <button class="btn btn-purple full big-btn" type="submit">${isNew ? "Add product" : "Save product"}</button>
    </form>`;
  $("backP").onclick = () => { A.editing = null; render(); };
  const showProfit = () => {
    const pr = cents($("pPrice").value), c = cents($("sCost").value), ship = A.settings.shipping_cents || 0;
    $("profit").innerHTML = pr && c != null ? `You make about <strong>${money(pr - c)}</strong> per item before PayPal fees (about 3–5%)${ship ? `, plus whatever is left of the ${money(ship)} shipping charge` : ""}.` : "";
  };
  ["pPrice", "sCost"].forEach(id => $(id).addEventListener("input", showProfit)); showProfit();
  $("pBlocked").oninput = () => { $("pBlockedNames").textContent = codes().map(countryName).join(", "); };
  const codes = () => $("pBlocked").value.toUpperCase().split(/[\s,;]+/).filter(c => /^[A-Z]{2}$/.test(c));

  $("pFile").onchange = async () => {
    const f = $("pFile").files[0]; if (!f) return;
    if (f.size > 5 * 1024 * 1024) return toast("That photo is over 5 MB. Please use a smaller one.");
    $("pMsg").textContent = "Uploading photo…"; $("pMsg").className = "form-msg ok";
    const path = `${slugify($("pName").value || "product") || "product"}-${Date.now()}.${(f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    const { error } = await sb.storage.from("products").upload(path, f, { upsert: false, contentType: f.type, cacheControl: "31536000" });
    if (error) { $("pMsg").textContent = friendlyError(error); $("pMsg").className = "form-msg"; return; }
    const url = sb.storage.from("products").getPublicUrl(path).data.publicUrl;
    $("pImg").value = url; $("photoPrev").innerHTML = `<img class="p-img thumb big-thumb" src="${esc(url)}" alt="">`;
    $("pMsg").textContent = "Photo uploaded. Save to keep it.";
  };

  $("pForm").onsubmit = async e => {
    e.preventDefault();
    const msg = t => { $("pMsg").textContent = t; $("pMsg").className = "form-msg"; };
    const row = {
      name: $("pName").value.trim(), category: $("pCat").value, summary: $("pSum").value.trim(), details: $("pDetails").value.trim(),
      price_cents: cents($("pPrice").value), compare_cents: $("pCompare").value.trim() ? cents($("pCompare").value) : null,
      image_url: $("pImg").value.trim() || null, is_supplement: $("pSupp").checked, blocked_countries: codes(),
      active: $("pActive").checked, sort: Number($("pSort").value) || 100
    };
    if (row.name.length < 2) return msg("Please give the product a name.");
    if (!row.price_cents || row.price_cents < 50) return msg("Please enter a price, like 19.99.");
    if (row.active && !row.image_url) return msg("Add a photo before switching the product on.");
    let id = p.id;
    if (isNew) {
      row.slug = slugify(row.name) || "product-" + Date.now();
      if (A.products.some(x => x.slug === row.slug)) row.slug += "-" + Date.now().toString(36).slice(-4);
      const { data, error } = await sb.from("products").insert(row).select().single();
      if (error) return msg(friendlyError(error));
      id = data.id;
    } else {
      const { error } = await sb.from("products").update(row).eq("id", id);
      if (error) return msg(friendlyError(error));
    }
    const s = { product_id: id, supplier: $("sName").value.trim() || null, supplier_url: $("sUrl").value.trim() || null, cost_cents: $("sCost").value.trim() ? cents($("sCost").value) : null, notes: $("sNotes").value.trim() || null };
    const r = await sb.from("product_suppliers").upsert(s, { onConflict: "product_id" });
    if (r.error) return msg(friendlyError(r.error));
    await loadAll(); A.editing = null; toast(isNew ? "Product added" : "Product saved"); render();
  };
}

// ── Shipping settings ───────────────────────────────
function renderSettings() {
  const s = A.settings;
  $("pane").innerHTML = `<form class="card" id="sForm">
    <h3>Shipping and shop</h3>
    <div class="grid2" style="gap:12px">
      <label>Flat shipping fee per order ($)<input id="stShip" inputmode="decimal" value="${dollars(s.shipping_cents)}"></label>
      <label>Free shipping on orders over ($, leave empty for never)<input id="stFree" inputmode="decimal" value="${dollars(s.free_over_cents)}"></label>
    </div>
    <label>Banner at the top of the shop (optional)<input id="stNotice" value="${esc(s.notice || "")}" maxlength="200" placeholder="e.g. Holiday orders ship within 10 days"></label>
    <label class="check-line big-toggle"><input type="checkbox" id="stOpen" ${s.open ? "checked" : ""}> <span><strong>Shop is open for orders</strong><br><small class="muted">Switch off to pause new orders. Customers can still see their orders.</small></span></label>
    <p class="form-msg" id="stMsg" role="alert"></p>
    <button class="btn btn-purple full" type="submit">Save</button>
  </form>
  <div class="card" style="margin-top:16px"><h3>Team</h3><p class="muted">People who can open this page: ask Claude to add or remove an email, or edit the <em>admins</em> table in Supabase.</p></div>`;
  $("sForm").onsubmit = async e => {
    e.preventDefault();
    const upd = { shipping_cents: cents($("stShip").value) ?? 0, free_over_cents: $("stFree").value.trim() ? cents($("stFree").value) : null, notice: $("stNotice").value.trim() || null, open: $("stOpen").checked, updated_at: new Date().toISOString() };
    if (upd.shipping_cents < 0) { $("stMsg").textContent = "The shipping fee can't be negative."; return; }
    const { error } = await sb.from("shop_settings").update(upd).eq("id", 1);
    if (error) { $("stMsg").textContent = friendlyError(error); return; }
    Object.assign(A.settings, upd); toast("Shop settings saved");
  };
}
