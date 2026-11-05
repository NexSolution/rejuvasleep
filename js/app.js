import { sb, esc, friendlyError } from "./supa.js";
import { createShop, cartCount } from "./shop.js?v=16";

const CFG = window.REJUVA_CONFIG || {};
const $ = id => document.getElementById(id);
const view = $("view");

const S = { user: null, profile: null, member: false, sleep: [], water: [], rituals: [], checks: [], checkins: [], library: null, tab: "today", open: null, day: null, ci: null };

// ── Dates & times ────────────────────────────────────
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const toMin = t => { const [h, m] = String(t).slice(0, 5).split(":").map(Number); return h * 60 + m; };
const fromMin = m => { m = ((m % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
const nice = t => { const m = toMin(t); const h = Math.floor(m / 60), mm = m % 60; return `${h % 12 || 12}:${pad(mm)} ${h < 12 ? "am" : "pm"}`; };
const hoursBetween = (bed, wake) => { let d = toMin(wake) - toMin(bed); if (d <= 0) d += 1440; return Math.round(d / 60 * 100) / 100; };
const shortDay = s => new Date(s + "T12:00").toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2);
const longDay = s => new Date(s + "T12:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

function toast(text) { const t = $("toast"); t.textContent = text; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2400); }

// ── Schedule (bedtime + wake time from Settings) ─────
function schedule() {
  const p = S.profile || {};
  const wake = toMin(p.wake_time || "06:30");
  const bed = p.bed_time ? toMin(p.bed_time) : wake - Math.round(Number(p.sleep_goal_hours || 7.5) * 60);
  const goal = hoursBetween(fromMin(bed), fromMin(wake));
  return { wake: fromMin(wake), bed: fromMin(bed), winddown: fromMin(bed - 30), screensOff: fromMin(bed - 60), dinner: fromMin(bed - 180), goal, water: Number(p.water_goal || 8) };
}
const quizAnswers = () => (S.profile && S.profile.quiz) || {};
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addDaysStr = (ds, n) => ymd(addDays(new Date(ds + "T12:00"), n));
const fmtDate = (ds, opt = { weekday: "short", month: "short", day: "numeric" }) => new Date(ds + "T12:00").toLocaleDateString(undefined, opt);
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00") - new Date(a + "T12:00")) / 864e5);

// ── The plan: 21-day rounds that roll on automatically; paused days don't count ──
const PLAN_LEN = 21;
// Day 1 is the day they first unlocked their plan
const planStart = () => {
  const p = S.profile || {};
  if (p.program_start) return p.program_start;
  return ymd(new Date((S.membership && S.membership.created_at) || p.created_at || Date.now()));
};
const isPausedDate = ds => (S.pauses || []).some(z => z.start_date <= ds && (!z.end_date || ds < z.end_date));
const openPause = () => (S.pauses || []).find(z => z.kind === "pause" && z.start_date <= today() && (!z.end_date || today() < z.end_date));

// Walk the calendar from day 1, skipping paused days
function planTimeline(minActiveDays = 0) {
  const out = []; let ds = planStart(), n = 0, guard = 0;
  while (guard++ < 800) {
    if (ds > today() && n >= minActiveDays) break;
    const pz = isPausedDate(ds);
    // an open-ended pause: we can't know future days until they resume
    if (pz && ds > today() && (S.pauses || []).some(z => !z.end_date && z.start_date <= ds)) break;
    if (!pz) n++;
    out.push({ date: ds, paused: pz, day: pz ? null : n });
    ds = addDaysStr(ds, 1);
  }
  return out;
}
// Day number for a date (paused dates keep the last day reached)
function planInfo(ds) {
  if (ds < planStart()) return { before: true, day: 0, paused: false };
  const tl = planTimeline(0);
  let last = 0;
  for (const t of tl) { if (t.day) last = t.day; if (t.date === ds) return { day: t.paused ? last : t.day, paused: t.paused }; }
  if (!tl.length) return { day: 1, paused: false, future: true };
  // a future date: count forward from today, skipping scheduled pause days
  let day = last, d = tl[tl.length - 1].date;
  while (d < ds) { d = addDaysStr(d, 1); if (!isPausedDate(d)) day++; }
  return { day, paused: isPausedDate(ds), future: true };
}
const programDay = (ds = today()) => planInfo(ds).day;
const roundOf = day => Math.max(1, Math.ceil(day / PLAN_LEN));
const roundDay = day => day < 1 ? 0 : ((day - 1) % PLAN_LEN) + 1;
const round = () => roundOf(programDay());
// First and last date of a round (the end moves out when they pause)
function roundWindow(r = round()) {
  const tl = planTimeline(r * PLAN_LEN);
  const first = tl.find(t => t.day === (r - 1) * PLAN_LEN + 1);
  const last = tl.find(t => t.day === r * PLAN_LEN);
  return { start: first ? first.date : planStart(), end: last ? last.date : (tl.length ? tl[tl.length - 1].date : today()), dates: tl, open: !last };
}
// Renewal notice in the last 3 days of a round; check-in from day 19 until a week into the next round
const reviewRound = () => { const d = roundDay(programDay()); return d >= 19 ? round() : round() - 1; };
const needsCheckin = () => {
  const d = roundDay(programDay()), rr = reviewRound();
  return rr >= 1 && (d >= 19 || d <= 7) && !S.checkins.some(c => c.round === rr);
};

const MAINTAIN = [
  "Consistency check: same bedtime and wake time every night this week, weekends included.",
  "Do your morning face ritual every day this week and notice the change in puffiness.",
  "Screens-off challenge: no phone in the last hour before bed, 5 nights out of 7.",
  "Hydration week: hit your water goal daily, with your last big glass before 7pm.",
  "Evening gua sha 4 nights this week, then compare a morning photo to day 1.",
  "Light week: 15 minutes of morning daylight every day, lights dimmed after sunset.",
  "Reset week: retake the quiz from the Menu and see how your score has changed."
];
const RESET = [
  "Check your bedtime and wake-up time in Settings. Keep them every day for 21 days.",
  "Set your wind-down reminder in My plan so your phone nudges you each night.",
  "Phone charges outside the bedroom tonight. Use a regular alarm if you need one.",
  "Get 10–15 minutes of daylight within an hour of waking.",
  "Move your last caffeine to before noon.",
  "Make your room cool and dark: around 65°F / 18°C, curtains closed.",
  "Bedroom check: block light leaks, cut noise, clear clutter.",
  "Dim the lights 1 hour before bed.",
  "Start the 30-minute wind-down from the Learn tab.",
  "Write tomorrow's top 3 tasks before bed so your mind can switch off.",
  "Try 4-7-8 breathing in bed: in 4, hold 7, out 8. Four rounds.",
  "Do your morning face ritual today.",
  "Hit your water goal and stop drinking an hour before bed.",
  "Look back at your progress on the Track page: what's improved since day 1?",
  "Do the evening gua sha before bed.",
  "Switch to a silk or satin pillowcase, or fresh pillowcase tonight.",
  "Swap your afternoon drink for coconut water or herbal tea.",
  "If you can't sleep tonight, use the 20-minute rule from Learn.",
  "Do both your morning and evening rituals today.",
  "Protect your wind-down: say no to one late-night thing.",
  "Day 21. Retake the quiz and compare your skin and energy to day 1."
];
// Round 1 follows the 21 steps; later rounds repeat them with a weekly maintenance focus on top
const todaysStep = day => {
  const r = roundOf(day), d = roundDay(day);
  if (r === 1) return { label: "21-day reset · today's step", text: RESET[d - 1] };
  return { label: `Round ${r} · day ${d}`, text: d % 7 === 1 ? MAINTAIN[Math.floor((day - 22) / 7) % MAINTAIN.length] : RESET[d - 1] };
};

const SKIN_RITUAL = { puffy: "ice-dip", dark: "cucumber-eyes", dull: "face-massage", lines: "gua-sha", breakouts: "skin-friendly-sleep", none: "face-massage" };
function myRituals() {
  const skin = (quizAnswers().skin || ["none"])[0] || "none";
  const morning = SKIN_RITUAL[skin] || "face-massage";
  return { morning: ["ice-dip", "cucumber-eyes", "face-massage"].includes(morning) ? morning : "face-massage", evening: ["gua-sha", "skin-friendly-sleep"].includes(morning) ? morning : "gua-sha" };
}
const RITUAL_NAMES = { "ice-dip": "Ice-water face dip", "cucumber-eyes": "Cucumber & cold-spoon eye reset", "face-massage": "Morning lymphatic face massage", "gua-sha": "Evening gua sha", "hydration": "Water & coconut-water routine", "skin-friendly-sleep": "Skin-friendly sleep setup" };

// ── Tips: a different set each week of the round, plus tips from their own data ──
const WEEK_TIPS = {
  1: [
    { ic: "⏰", t: "Week 1: build the foundation", d: "Your only big job this week: the same wake-up time every day, weekends too. Everything else gets easier once that's steady." },
    { ic: "☀️", t: "Morning light sets your body clock", d: "10 minutes outside within an hour of waking tells your brain when to feel sleepy tonight — about 14–16 hours later." },
    { ic: "☕", t: "Find your caffeine cutoff", d: "Caffeine stays in your system for hours. Try your last cup before noon this week and notice how fast you fall asleep." }
  ],
  2: [
    { ic: "🌙", t: "Week 2: master the wind-down", d: "Start your evening routine at the same time every night. After 1–2 weeks your body starts getting sleepy on cue." },
    { ic: "📵", t: "Make the bedroom phone-free", d: "Charging your phone in another room is the single biggest change most people make. Use a regular alarm clock." },
    { ic: "🫁", t: "Use 4-7-8 when your mind races", d: "In through your nose for 4, hold for 7, out through your mouth for 8. Four rounds slows your heart rate." }
  ],
  3: [
    { ic: "✨", t: "Week 3: the skin payoff", d: "Your skin repairs most during deep sleep. Pair it with your evening gua sha at least 5 nights this week." },
    { ic: "💧", t: "Hydrate early, taper late", d: "Most of your water before 3pm, small sips after 7pm. You get the glow without the 3am bathroom trips." },
    { ic: "🪞", t: "Take a progress photo", d: "Same spot, same light, first thing in the morning. Compare it with how your skin looked on day 1." }
  ],
  4: [
    { ic: "🔁", t: "Keep what's working", d: "You've done one full round. Keep your best three habits locked in and add one new ritual this round." },
    { ic: "🧊", t: "Level up your rituals", d: "Try both a morning and an evening ritual on the same day, three days a week." },
    { ic: "📈", t: "Watch your trends", d: "Check the Track page each week. Focus on whichever line is moving the wrong way." }
  ]
};
function weeklyTips() {
  const d = roundDay(programDay()), wk = Math.min(3, Math.max(1, Math.ceil(d / 7)));
  const set = round() >= 2 ? WEEK_TIPS[4] : WEEK_TIPS[wk];
  return [...set, ...dataTips().slice(0, 3)];
}
function dataTips() {
  const since = daysAgo(6);
  const nights = S.sleep.filter(r => r.log_date >= since);
  const water = S.water.filter(r => r.log_date >= since);
  const rit = S.rituals.filter(r => r.log_date >= since);
  const sc = schedule(), q = quizAnswers(), tips = [];
  if (nights.length < 3) tips.push({ ic: "📝", t: "Log at least 5 nights this week", d: `You've logged ${nights.length} of the last 7 nights. Your tips get sharper the more you track — it takes 20 seconds each morning.` });
  if (nights.length) {
    const h = avg(nights.map(r => Number(r.hours)));
    if (h < sc.goal - 0.5) tips.push({ ic: "⏳", t: `You're averaging ${h.toFixed(1)} hours — ${(sc.goal - h).toFixed(1)} short`, d: `Move bedtime 15 minutes earlier this week (aim for ${nice(fromMin(toMin(sc.bed) - 15))}). Small shifts stick better than big ones.` });
    const beds = nights.map(r => { const m = toMin(r.bedtime); return m < 720 ? m + 1440 : m; });
    const spread = Math.max(...beds) - Math.min(...beds);
    if (nights.length >= 3 && spread > 90) tips.push({ ic: "🕰️", t: "Your bedtime moved around a lot", d: `Your bedtimes varied by about ${Math.round(spread / 60 * 10) / 10} hours. A steady schedule does more for deep sleep than catching up on weekends.` });
    const ql = avg(nights.filter(r => r.quality).map(r => r.quality));
    if (ql && ql < 3) tips.push({ ic: "🌀", t: "Your sleep quality has been low", d: "Try the 30-minute wind-down in Learn every night this week, and keep your phone out of the bedroom." });
  }
  if (water.length && avg(water.map(r => r.glasses)) < sc.water - 1) tips.push({ ic: "💧", t: `You're averaging ${avg(water.map(r => r.glasses)).toFixed(1)} glasses a day`, d: "Front-load it: a full glass on waking and one with every meal gets you most of the way before 3pm." });
  if (rit.length < 3) tips.push({ ic: "🧊", t: "Make your face ritual a habit", d: `You did ${rit.length} ritual${rit.length === 1 ? "" : "s"} this week. Pair the ${RITUAL_NAMES[myRituals().morning].toLowerCase()} with brushing your teeth so you don't have to remember it.` });
  if (q.caffeine === "pm2" || q.caffeine === "eve") tips.push({ ic: "☕", t: "Watch your afternoon caffeine", d: "Your quiz showed late caffeine. Try coconut water or rooibos tea after noon this week." });
  if (q.screens === "bed") tips.push({ ic: "📱", t: "Phone out of the bedroom", d: "Your quiz showed scrolling in bed. Charge it in another room for 7 nights and see what changes." });
  return tips;
}

// ── Data ─────────────────────────────────────────────
async function load() {
  const since = daysAgo(120);
  const uid = S.user.id;
  const [p, m, sl, w, r, ms, rc, ck, pz] = await Promise.all([
    sb.from("profiles").select("*").eq("id", uid).maybeSingle(),
    sb.rpc("is_member"),
    sb.from("sleep_logs").select("*").gte("log_date", since).order("log_date"),
    sb.from("water_logs").select("*").gte("log_date", since).order("log_date"),
    sb.from("ritual_logs").select("*").gte("log_date", since),
    sb.from("memberships").select("plan,status,paid_until,created_at,next_billing_at,cancelled_at,subscription_id,paused_until").maybeSingle(),
    sb.from("routine_checks").select("log_date,item").gte("log_date", since),
    sb.from("checkins").select("*").order("round"),
    sb.from("pauses").select("*").order("start_date")
  ]);
  if (p.error) throw p.error;
  S.profile = p.data || { id: uid, name: "", created_at: new Date().toISOString() };
  S.member = !!m.data;
  S.sleep = sl.data || []; S.water = w.data || []; S.rituals = r.data || [];
  S.membership = ms.data || null;
  S.checks = rc.data || []; S.checkins = ck.data || []; S.pauses = pz.data || [];
  await syncStopPause();
  await catchUpBillingResume();

  // Every new account answers the quiz after confirming their email, so never
  // reuse answers saved in this browser from an earlier visit or another account.
  try { localStorage.removeItem("rejuva_quiz"); } catch (e) {}
}

// Cancelling freezes the plan where it is; restarting picks it up again from the same day
async function syncStopPause() {
  const ms = S.membership;
  const stop = S.pauses.find(z => z.kind === "stop" && !z.end_date);
  if (S.member && stop) {
    if (stop.start_date >= today()) { await sb.from("pauses").delete().eq("id", stop.id); S.pauses = S.pauses.filter(z => z !== stop); }
    else { await sb.from("pauses").update({ end_date: today() }).eq("id", stop.id); stop.end_date = today(); }
  } else if (!S.member && ms && ms.cancelled_at && !stop) {
    // the day they cancelled still counts; the plan is frozen from the next day
    const row = { user_id: S.user.id, start_date: addDaysStr(ymd(new Date(ms.cancelled_at)), 1), kind: "stop" };
    const { data } = await sb.from("pauses").insert(row).select().single();
    S.pauses.push(data || row);
  }
}

async function loadLibrary() {
  if (S.library || !S.member) return;
  const { data, error } = await sb.from("library").select("*").order("sort");
  if (error) { toast(friendlyError(error)); S.library = []; return; }
  S.library = data || [];
}

// ── Menu ─────────────────────────────────────────────
const TABS = [
  { id: "today", label: "Today", ic: "🌙" },
  { id: "track", label: "Track sleep & water", ic: "📊" },
  { id: "plan", label: "My plan & reminders", ic: "🗓️" },
  { id: "rituals", label: "Face rituals", ic: "🧊" },
  { id: "learn", label: "Learn", ic: "📚" },
  { id: "shop", label: "Shop", ic: "🛍️" },
  { id: "orders", label: "My orders", ic: "📦" },
  { id: "settings", label: "Settings", ic: "⚙️" }
];

function renderMenu() {
  const items = S.member
    ? TABS.map(t => `<button role="menuitem" data-tab="${t.id}" class="${S.tab === t.id ? "on" : ""}"><span>${t.ic}</span>${t.label}</button>`).join("") + '<div class="sep"></div>'
    : TABS.filter(t => ["shop", "orders", "settings"].includes(t.id)).map(t => `<button role="menuitem" data-tab="${t.id}" class="${S.tab === t.id ? "on" : ""}"><span>${t.ic}</span>${t.label}</button>`).join("") + '<div class="sep"></div>';
  const manage = S.member && S.membership && S.membership.plan === "monthly"
    ? `<a role="menuitem" href="https://www.paypal.com/myaccount/autopay/" target="_blank" rel="noopener"><span>💳</span>Manage or cancel subscription</a>` : "";
  $("menuList").innerHTML = `<p class="menu-email">Signed in as<br><strong>${esc(S.user.email)}</strong></p>` + items + `
    ${manage}
    <a role="menuitem" href="quiz.html?onboard=1${S.member ? "&retake=1" : ""}"><span>📝</span>Retake the quiz</a>
    <a role="menuitem" href="mailto:${esc(CFG.supportEmail || "")}"><span>✉️</span>Get help</a>
    <div class="sep"></div>
    <p class="menu-label">Text size</p>
    <div class="size-row">${SIZES.map(([id, a, label], i) => `<button data-size="${id}" class="${document.documentElement.dataset.text === id ? "on" : ""}" aria-label="${label} text" style="font-size:${1 + i * 0.25}rem">${a}</button>`).join("")}</div>
    <div class="sep"></div>
    <button role="menuitem" id="logoutBtn" class="danger"><span>↩</span>Log out</button>`;
  $("menuList").querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { closeMenu(); go(b.dataset.tab); });
  $("menuList").querySelectorAll("[data-size]").forEach(b => b.onclick = e => { e.stopPropagation(); applyTextSize(b.dataset.size); renderMenu(); });
  $("logoutBtn").onclick = async () => { await sb.auth.signOut(); location.replace("login.html?mode=login"); };
}
function closeMenu() { $("menuList").hidden = true; $("menuBtn").setAttribute("aria-expanded", "false"); }
$("menuBtn").onclick = e => {
  e.stopPropagation();
  const open = $("menuList").hidden;
  $("menuList").hidden = !open; $("menuBtn").setAttribute("aria-expanded", String(open));
};
document.addEventListener("click", e => { if (!$("menuWrap").contains(e.target)) closeMenu(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });

async function go(tab, open = null, { push = true } = {}) {
  const same = S.tab === tab && S.open === open;
  S.tab = tab; S.open = open;
  const url = "#" + tab + (open ? "/" + open : "");
  if (push && !same) history.pushState({ tab, open }, "", url);
  else history.replaceState({ tab, open }, "", url);
  stopPlayer();
  renderMenu(); renderNav();
  if ((tab === "rituals" || tab === "learn") && !S.library) { view.innerHTML = '<p class="loading">Loading…</p>'; await loadLibrary(); }
  render();
  window.scrollTo(0, 0);
}

function render() {
  // Without an active plan: history (Track) and Settings stay open; everything else shows the restart page
  if (S.tab === "shop" || S.tab === "orders") return renderShop();
  if (!S.member && !["track", "settings"].includes(S.tab)) return renderPaywall();
  ({ settings: renderSettings, today: renderToday, track: renderTrack, plan: renderPlan, rituals: renderRituals, learn: renderLearn, checkin: renderCheckin })[S.tab]();
}

// Phone back button: go to the previous screen inside the app instead of leaving it
window.addEventListener("popstate", e => {
  if (!$("menuList").hidden) { closeMenu(); }
  const st = e.state;
  if (!st || st.root) {
    // Already at the start: stay in the app on Today rather than exiting
    history.pushState({ tab: "today", open: null }, "", "#today");
    if (S.tab !== "today" || S.open) go("today", null, { push: false });
    return;
  }
  go(st.tab, st.open || null, { push: false });
});

// Big bottom navigation, always visible for members
const NAV = [["today", "🌙", "Today"], ["track", "📊", "Track"], ["rituals", "🧊", "Rituals"], ["plan", "🗓️", "Plan"], ["learn", "📚", "Learn"], ["settings", "⚙️", "Settings"]];
const NAV_ENDED = [["today", "🔁", "Restart"], ["track", "📊", "History"], ["shop", "🛍️", "Shop"], ["settings", "⚙️", "Settings"]];
function renderNav() {
  const nav = $("bottomNav");
  if (!S.member && !S.membership) { nav.hidden = true; return; }
  nav.hidden = false;
  const list = S.member ? NAV : NAV_ENDED;
  nav.style.gridTemplateColumns = `repeat(${list.length},1fr)`;
  nav.innerHTML = list.map(([id, ic, label]) => `<button data-tab="${id}" class="${S.tab === id ? "on" : ""}" aria-current="${S.tab === id ? "page" : "false"}"><span class="ni">${ic}</span>${label}</button>`).join("");
  nav.querySelectorAll("button").forEach(b => b.onclick = () => go(b.dataset.tab));
}

// Text size, remembered on this device
const SIZES = [["normal", "A", "Normal"], ["large", "A", "Large"], ["xl", "A", "Extra large"]];
function applyTextSize(sz) {
  document.documentElement.dataset.text = sz;
  try { localStorage.setItem("rejuva_text", sz); } catch (e) {}
}
try { applyTextSize(localStorage.getItem("rejuva_text") || "large"); } catch (e) { applyTextSize("large"); }

// ── Shop (anyone signed in can buy; it doesn't need a plan) ──
const shop = createShop({
  view, toast, getUser: () => S.user,
  // shop routes live after "#shop/…"; orders are part of the shop too
  navigate: (r, opts) => { S.shopOpts = opts || null; r === "orders" ? go("orders") : go("shop", r || null); }
});
function renderShop() {
  const route = S.tab === "orders" ? (S.open ? S.open : "orders") : (S.open || "");
  const opts = S.shopOpts || {}; S.shopOpts = null;
  shop.render(route, { ...opts, cached: true });
}
const cartBadge = () => { const b = $("cartBtn"); if (!b) return; const n = cartCount(); b.querySelector("span").textContent = n; b.classList.toggle("has", n > 0); };
window.addEventListener("cartchange", cartBadge);
if ($("cartBtn")) $("cartBtn").onclick = () => go("shop", "cart");
cartBadge();

// ── Paywall: no access until subscribed ──────────────
let pollTimer;
// Billing cycle: set billingDays in config.js to 21 once the PayPal plan bills every 21 days
const CYCLE_DAYS = Number(CFG.billingDays || 0);
const cycleText = () => CYCLE_DAYS ? `every ${CYCLE_DAYS} days` : "every month";
const firstCycleText = () => CYCLE_DAYS ? `your first ${CYCLE_DAYS} days` : "your first month";
const firstRenewal = () => { const d = new Date(); if (CYCLE_DAYS) d.setDate(d.getDate() + CYCLE_DAYS); else d.setMonth(d.getMonth() + 1); return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }); };

function renderPaywall() {
  renderMenu(); renderNav();
  const p = S.profile, name = p.name ? esc(p.name) : "there";
  const ended = !!S.membership;   // had a plan before (cancelled or ended)
  const stoppedAt = ended ? roundDay(programDay()) : 0;
  view.innerHTML = `<div class="card locked" style="max-width:560px;margin:0 auto">
    <div class="ic">${ended ? "🔁" : "🌙"}</div>
    ${ended
      ? `<h3>Welcome back${name === "there" ? "" : ", " + name}</h3>
         <p class="muted">Your plan is stopped${stoppedAt ? ` at <strong>day ${stoppedAt} of 21</strong>` : ""}. Everything you logged is saved. Restart to pick up right where you left off.</p>
         <button class="btn btn-ghost full" id="viewHistory" style="margin:14px 0 4px">View my history</button>`
      : `<h3>${name === "there" ? "Your" : name + ", your"} plan is ready</h3>
         ${p.quiz_score != null ? `<p class="muted">Your Sleep Aging Score: <strong>${p.quiz_score}/100</strong>. Unlock your plan to start fixing it tonight.</p>` : '<p class="muted">Unlock your plan to start tonight.</p>'}`}
    <ul>
      <li>Your personal sleep schedule and 21-day reset</li>
      <li>Sleep and water tracker with wind-down reminders</li>
      <li>Step-by-step natural face rituals</li>
      <li>Article and video library</li>
      <li>New tips every week based on your tracking</li>
      <li>The Deep Sleep Blueprint PDF guide</li>
    </ul>
    <p class="price" style="font-size:2rem;margin-bottom:4px"><s style="font-size:1rem;color:var(--muted);font-weight:500;margin-right:8px">${esc(CFG.monthlyPrice || "")}</s>${esc(CFG.introPrice || "")}<small style="font-size:1rem;color:var(--muted);font-weight:500"> ${CYCLE_DAYS ? `first ${CYCLE_DAYS} days` : "first month"}</small></p>
    <p class="muted" style="font-size:.9rem;margin-bottom:18px">Then ${esc(CFG.monthlyPrice || "")} ${cycleText()}. Pause or cancel anytime.</p>
    <div id="paypalButtons" class="pp-wrap"><p class="muted" style="font-size:.9rem">Loading secure checkout…</p></div>
    <p class="form-msg" id="payMsg" role="status"></p>
    <p class="terms">You'll pay <strong>${esc(CFG.introPrice || "")} today</strong> for ${firstCycleText()}. Your plan then continues automatically at <strong>${esc(CFG.monthlyPrice || "")} ${cycleText()}</strong>, starting ${firstRenewal()}, until you cancel. You can pause or cancel anytime in Settings. Cancelling stops your plan and future payments right away, and your history stays saved.</p>
    <p class="fine">Your plan unlocks on this page within a few seconds of subscribing. <button class="link-btn" id="recheck">Check now</button></p>
  </div>`;
  $("recheck").onclick = () => checkMembership(true);
  if ($("viewHistory")) $("viewHistory").onclick = () => go("track");
  mountPayPal();
  startPolling(8000, 40);
}

function startPolling(every, max) {
  clearInterval(pollTimer);
  let tries = 0;
  pollTimer = setInterval(() => { if (++tries > max) clearInterval(pollTimer); checkMembership(false); }, every);
}

function loadPayPalSdk() {
  if (window.paypal) return Promise.resolve(window.paypal);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(CFG.paypalClientId)}&vault=true&intent=subscription`;
    s.onload = () => window.paypal ? resolve(window.paypal) : reject(new Error("PayPal didn't load"));
    s.onerror = () => reject(new Error("PayPal didn't load"));
    document.head.appendChild(s);
  });
}

function payUnavailable(reason) {
  if (reason) console.error(reason);
  const box = $("paypalButtons"); if (!box) return;
  box.innerHTML = `<button class="btn btn-gold full" disabled>Checkout opens soon</button>
    <p class="fine">Questions? Email ${esc(CFG.supportEmail || "us")}.</p>`;
}

async function mountPayPal() {
  if (!CFG.paypalClientId || !CFG.paypalPlanId) return payUnavailable();
  let paypal;
  try { paypal = await loadPayPalSdk(); } catch (e) { return payUnavailable(e); }
  const box = $("paypalButtons"); if (!box) return;
  box.innerHTML = "";
  const msg = (t, ok) => { const el = $("payMsg"); if (el) { el.textContent = t; el.className = "form-msg" + (ok ? " ok" : ""); } };
  try {
    await paypal.Buttons({
      style: { layout: "vertical", color: "gold", shape: "pill", label: "subscribe" },
      createSubscription: (data, actions) => actions.subscription.create({
        plan_id: CFG.paypalPlanId,
        custom_id: S.user.email.slice(0, 127),   // tells our webhook which account to unlock
        application_context: { shipping_preference: "NO_SHIPPING", brand_name: "RejuvaSleep", user_action: "SUBSCRIBE_NOW" }
      }),
      onApprove: () => {
        msg("Subscription started! Unlocking your plan…", true);
        startPolling(3000, 60);
        checkMembership(false);
      },
      onCancel: () => msg("Checkout cancelled. You haven't been charged."),
      onError: e => { console.error(e); msg("Something went wrong with PayPal. Please try again, or use a different card."); }
    }).render("#paypalButtons");
  } catch (e) { payUnavailable(e); }
}

async function checkMembership(manual) {
  const { data } = await sb.rpc("is_member");
  if (data) {
    clearInterval(pollTimer);
    const back = !!S.membership;
    await load();   // picks up the new membership and closes any stopped period
    toast(back ? "Welcome back! Your plan has restarted." : "Payment received. Welcome to RejuvaSleep!");
    S.day = today();
    go("today");
  } else if (manual) {
    toast("No payment found for your account yet. It can take a minute.");
  }
}

// ── TODAY: plan calendar + tickable daily routine ────
const ROUND_FOCUS = {
  missed: "Fewer, easier wins: tick at least your morning and evening ritual every day.",
  schedule: "Anchor one thing: keep your wake-up time fixed, even on busy or shift days.",
  asleep: "Wind-down first: start your night routine 15 minutes earlier this round.",
  waking: "Cool, dark and dry: room around 65°F / 18°C and no fluids in the last hour.",
  skin: "Skin round: do your evening gua sha at least 5 nights a week.",
  habits: "Repeat and lock in: same steps as round 1, aiming for 80% of ticks each week.",
  happy: "Maintenance: keep what worked and try one new ritual each week."
};

// Parts of the day follow their own wake and bed times
function daySections() {
  const sc = schedule(), w = toMin(sc.wake), bd = toMin(sc.bed);
  const night = bd - 330 > w + 360 ? bd - 330 : w + 600;   // ~5.5 hours before bed
  const t = m => nice(fromMin(m));
  return [
    { id: "Today's step", ic: "⭐", range: "" },
    { id: "Morning", ic: "☀️", range: `${t(w)} – ${t(w + 180)}` },
    { id: "Daytime", ic: "🌤️", range: `${t(w + 180)} – ${t(w + 360)}` },
    { id: "Evening", ic: "🌇", range: `${t(w + 360)} – ${t(night)}` },
    { id: "Night", ic: "🌙", range: `${t(night)} – ${t(bd)}` }
  ];
}

function routineFor(date) {
  const sc = schedule(), rit = myRituals(), info = planInfo(date);
  const water = (S.water.find(r => r.log_date === date) || {}).glasses || 0;
  const slept = S.sleep.some(r => r.log_date === date);
  const ritDone = slug => S.rituals.some(r => r.log_date === date && r.ritual === slug);
  const step = info.day >= 1 && !info.paused ? todaysStep(info.day) : null;
  const ritMin = slug => ((S.library || []).find(i => i.slug === slug) || {}).minutes;
  return [
    step && { sec: "Today's step", k: "step", t: step.text, sub: step.label },
    { sec: "Morning", k: "wake", t: `Wake up at ${nice(sc.wake)}`, sub: "Same time every day, weekends too" },
    { sec: "Morning", k: "water-am", t: "Drink a full glass of water", sub: "Before coffee or tea" },
    { sec: "Morning", k: "light", t: "10 minutes of daylight", sub: "Step outside or sit by a bright window" },
    { sec: "Morning", k: "ritual-am", t: RITUAL_NAMES[rit.morning], sub: "Guided face ritual" + (ritMin(rit.morning) ? ` · ${ritMin(rit.morning)} min` : ""), auto: ritDone(rit.morning), ritual: rit.morning, action: ["Start", "rituals", rit.morning + ":play"] },
    { sec: "Morning", k: "log", t: "Log last night's sleep", sub: slept ? "Logged ✓" : "Takes 20 seconds", auto: slept, action: slept ? null : ["Log", "track"] },
    { sec: "Daytime", k: "caffeine", t: "Last caffeine before noon", sub: "Coffee, tea, soda and energy drinks" },
    { sec: "Daytime", k: "move", t: "Move for 20 minutes", sub: "A walk counts" },
    { sec: "Evening", k: "water-goal", t: `Drink ${sc.water} glasses of water`, sub: `${water} of ${sc.water} logged · last big glass by 7pm`, auto: water >= sc.water, action: water >= sc.water ? null : ["Add", "track"] },
    { sec: "Evening", k: "swap", t: "Coconut water or herbal tea instead of caffeine", sub: "Keeps you hydrated without the late buzz" },
    { sec: "Evening", k: "dinner", t: `Finish dinner by ${nice(sc.dinner)}`, sub: "About 3 hours before bed" },
    { sec: "Night", k: "screens", t: `Screens off at ${nice(sc.screensOff)}`, sub: "Dim the lights too" },
    { sec: "Night", k: "ritual-pm", t: RITUAL_NAMES[rit.evening], sub: `Start at ${nice(sc.winddown)}` + (ritMin(rit.evening) ? ` · ${ritMin(rit.evening)} min` : ""), auto: ritDone(rit.evening), ritual: rit.evening, action: ["Start", "rituals", rit.evening + ":play"] },
    { sec: "Night", k: "list", t: "Write tomorrow's top 3 tasks", sub: "And any worries, so your mind can let go" },
    { sec: "Night", k: "lights", t: `Lights out at ${nice(sc.bed)}`, sub: "4 rounds of 4-7-8 breathing in bed" }
  ].filter(Boolean);
}
const isDone = (date, it) => it.auto || S.checks.some(c => c.log_date === date && c.item === it.k);
const dayProgress = date => { const items = routineFor(date); return [items.filter(it => isDone(date, it)).length, items.length]; };

// Calendar pages: 7 days at a time from day 1 of the plan to the end of the current round
function calendarDates() {
  const win = roundWindow(round());
  const list = [];
  for (let d = planStart(); d <= win.end; d = addDaysStr(d, 1)) list.push(d);
  if (win.open) for (let i = 1; i <= 6; i++) list.push(addDaysStr(win.end, i));   // open pause: show the coming week as paused
  return list;
}

function icsReminder(dateStr, title, desc) {
  const d = dateStr.replace(/-/g, "");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//RejuvaSleep//EN", "BEGIN:VEVENT",
    `UID:${title.replace(/\W/g, "")}-${d}-${S.user.id}@rejuvasleep`, `DTSTAMP:${d}T000000Z`, `DTSTART:${d}T090000`, "DURATION:PT15M",
    `SUMMARY:${title}`, `DESCRIPTION:${desc}`, "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${title}`, "TRIGGER:PT0M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" })); a.download = "rejuvasleep-reminder.ics";
  document.body.appendChild(a); a.click(); a.remove();
  toast("Open the downloaded file to add it to your calendar");
}

function renderToday() {
  const p = S.profile, sc = schedule();
  const cal = calendarDates();
  if (!S.day || S.day < cal[0] || S.day > cal[cal.length - 1]) S.day = today() >= cal[0] && today() <= cal[cal.length - 1] ? today() : cal[0];
  const sel = S.day, isToday = sel === today(), future = sel > today();
  const name = p.name ? esc(p.name) : "there";
  const dNow = programDay(), rNow = round(), rdNow = roundDay(dNow);
  const win = roundWindow(rNow);
  const pageIdx = Math.floor(cal.indexOf(sel) / 7), pages = Math.ceil(cal.length / 7);
  const days = cal.slice(pageIdx * 7, pageIdx * 7 + 7);
  const selInfo = planInfo(sel);
  const items = routineFor(sel);
  const [done, total] = dayProgress(sel);
  const lastNight = S.sleep.find(r => r.log_date === today());
  const tips = weeklyTips();
  const lastCheck = S.checkins.filter(c => c.choice === "continue").slice(-1)[0];
  const focus = rNow > 1 && lastCheck ? (lastCheck.reasons || []).map(r => ROUND_FOCUS[r]).filter(Boolean)[0] : null;
  const pause = openPause();
  const daysLeft = Math.max(0, daysBetween(today(), win.end));
  const nextStart = addDaysStr(win.end, 1);
  const ms = S.membership;
  const nextPay = ms && ms.next_billing_at ? fmtDate(ymd(new Date(ms.next_billing_at)), { month: "long", day: "numeric" }) : null;

  const renewal = !pause && rdNow >= 19 && ms && ms.plan !== "lifetime"
    ? `<div class="card notice renew"><p class="label">${daysLeft === 0 ? "Your 21 days end today" : `Your 21 days end in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}</p>
        <p>Your next 21 days start automatically on <strong>${fmtDate(nextStart, { weekday: "long", month: "long", day: "numeric" })}</strong>${nextPay ? `, and your next payment of <strong>${esc(CFG.monthlyPrice || "")}</strong> is on <strong>${nextPay}</strong>` : ""}. If you'd like to stop, you can cancel in Settings before then.</p>
        <button class="btn btn-ghost btn-sm" data-go="settings" style="margin-top:10px">Open Settings</button></div>` : "";

  const sections = daySections();
  const row = it => {
    const on = isDone(sel, it);
    const locked = future || selInfo.paused || !S.member;
    return `<div class="check-row ${on ? "on" : ""}">
      <button class="tick" data-k="${it.k}" role="checkbox" aria-checked="${on}" ${locked ? "disabled" : ""} aria-label="${esc(it.t)}"><span>✓</span></button>
      <div class="ct"><p class="t">${esc(it.t)}</p><p class="s">${esc(it.sub || "")}</p></div>
      ${it.action && !locked && isToday ? `<button class="btn btn-ghost btn-sm act" data-act="${it.action[1]}" data-open="${esc(it.action[2] || "")}">${it.action[0]}</button>` : ""}
    </div>`;
  };

  view.innerHTML = `<div class="stack">
    ${pause ? `<div class="card notice paused-card"><p class="label">⏸ Plan paused</p>
      <p>Your plan is paused${pause.end_date ? ` and restarts automatically on <strong>${fmtDate(pause.end_date, { weekday: "long", month: "long", day: "numeric" })}</strong>` : ` until you restart it`}. Your days are saved and your 21 days move out to match.${hasBilling() ? " Payments are paused too." : ""}</p>
      <button class="btn btn-purple btn-sm" id="resumeNow" style="margin-top:10px">Restart my plan now</button></div>` : ""}
    ${needsCheckin() ? `<button class="card checkin-cta" id="ciBtn"><span class="big-ic">🎉</span><span><strong>${rdNow >= 19 ? "Your 21 days are almost done!" : "You've completed your 21-day reset!"}</strong><br>Take your 2-minute check-in to see your progress.</span><span class="go">›</span></button>` : ""}
    ${renewal}
    <div class="card hello">
      <h3>Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${name}</h3>
      <p>${pause ? "Paused" : `Day <strong>${rdNow} of 21</strong>`}${rNow > 1 ? ` · Round ${rNow}` : ""}. Wind-down at <strong>${nice(sc.winddown)}</strong>, lights out by <strong>${nice(sc.bed)}</strong>.</p>
      ${focus ? `<p class="focus">Round ${rNow} focus: ${esc(focus)}</p>` : ""}
    </div>

    <div class="card week-card">
      <div class="spread week-head">
        <button class="nav-arrow" id="wkPrev" aria-label="Previous 7 days" ${pageIdx === 0 ? "disabled" : ""}>‹</button>
        <h3>${fmtDate(days[0], { month: "long", day: "numeric" })} – ${fmtDate(days[days.length - 1], { month: "short", day: "numeric" })}</h3>
        <button class="nav-arrow" id="wkNext" aria-label="Next 7 days" ${pageIdx >= pages - 1 ? "disabled" : ""}>›</button>
      </div>
      <div class="week">${days.map(d => {
        const inf = planInfo(d), [a, b] = dayProgress(d);
        const dt = new Date(d + "T12:00");
        const cls = [d === sel ? "sel" : "", d === today() ? "today" : "", d > today() ? "future" : "", inf.paused ? "paused" : "", !inf.paused && d <= today() && a === b ? "full" : ""].join(" ");
        const label = inf.paused ? "Paused" : d > today() ? `Day ${roundDay(inf.day)}` : `${a}/${b}`;
        return `<button class="wd ${cls}" data-day="${d}" aria-pressed="${d === sel}" aria-label="${dt.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}, ${label}">
          <span class="dn">${dt.toLocaleDateString(undefined, { weekday: "short" })}</span>
          <span class="dd">${dt.getDate()}</span>
          <span class="dp">${label}</span>
        </button>`;
      }).join("")}</div>
      <p class="cal-foot">${rNow > 1 ? `Round ${rNow}: ` : ""}${fmtDate(win.start, { month: "short", day: "numeric" })} – ${win.open ? "paused" : fmtDate(win.end, { month: "short", day: "numeric" })}${!isToday ? ` · <button class="link-btn" id="backToday">Back to today</button>` : ""}</p>
    </div>

    <div class="card routine">
      <div class="spread">
        <div><p class="label">${isToday ? "Today" : future ? "Coming up" : "Past day"}${selInfo.paused ? " · Paused" : selInfo.day >= 1 ? ` · Day ${roundDay(selInfo.day)} of 21` : ""}</p>
        <h3>${fmtDate(sel, { weekday: "long", month: "long", day: "numeric" })}</h3></div>
        <div class="ring" style="--p:${Math.round(done / total * 100)}"><b>${done}/${total}</b></div>
      </div>
      ${selInfo.paused ? `<p class="muted" style="margin:6px 0 4px">This is a day off. Nothing to tick — enjoy the rest.</p>` : future ? `<p class="muted" style="margin:6px 0 4px">Here's what's planned. You can tick these off on the day.</p>` : ""}
      ${sections.map(sec => {
        const list = items.filter(it => it.sec === sec.id);
        return list.length ? `<p class="sec-title">${sec.ic} ${sec.id}${sec.range ? ` <span class="sec-time">${sec.range}</span>` : ""}</p>${list.map(row).join("")}` : "";
      }).join("")}
      ${done === total && !future && !selInfo.paused ? `<p class="all-done">✨ Everything done${isToday ? " today" : ""}. Beautiful work.</p>` : ""}
    </div>

    <div class="grid2">
      <div class="card"><p class="label">Last night</p>
        ${lastNight ? `<p class="big">${Number(lastNight.hours).toFixed(1)}<small> hrs</small></p><p class="muted">${nice(lastNight.bedtime)} → ${nice(lastNight.wake_time)}</p>`
                    : `<p class="muted" style="margin:6px 0 12px">Not logged yet</p><button class="btn btn-purple btn-sm" data-go="track">Log last night</button>`}
      </div>
      <div class="card score-card"><p class="label">Sleep Aging Score</p>
        <p class="big">${p.quiz_score ?? "–"}<small> / 100</small></p>
        ${p.prev_quiz_score != null && p.quiz_score != null ? `<p class="muted">${p.prev_quiz_score > p.quiz_score ? `Down ${p.prev_quiz_score - p.quiz_score} from ${p.prev_quiz_score} — lower is better ✓` : `Was ${p.prev_quiz_score} last time`}</p>` : `<p class="muted">Lower is better.</p>`}
        <div class="countdown">${pause ? `<span>⏸ Countdown paused</span>` : rdNow >= 19
          ? `<span>🗓️ Quiz retake is ${daysLeft === 0 ? "due today" : `due in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}</span><a class="btn btn-gold btn-sm" href="quiz.html?onboard=1&checkin=1" id="retakeNow">Retake now</a>`
          : `<span><b>${daysLeft}</b> day${daysLeft === 1 ? "" : "s"} until your quiz retake on ${fmtDate(win.end, { month: "short", day: "numeric" })}</span>`}</div>
        ${!pause && !win.open ? `<button class="btn btn-ghost btn-sm" id="quizRemind">Add retake to my calendar</button>` : ""}
      </div>
    </div>

    <div class="card">
      <h3>Your tips this week</h3>
      <p class="muted" style="font-size:.9rem">Week ${Math.min(3, Math.ceil(Math.max(1, rdNow) / 7))} of 21 days</p>
      ${tips.map(t => `<div class="tip"><div class="ic">${t.ic}</div><div><h4>${esc(t.t)}</h4><p class="muted" style="font-size:.95rem">${esc(t.d)}</p></div></div>`).join("")}
    </div>
  </div>`;

  view.querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
  view.querySelectorAll(".wd").forEach(b => b.onclick = () => { S.day = b.dataset.day; renderToday(); });
  $("wkPrev").onclick = () => { if (pageIdx > 0) { S.day = cal[(pageIdx - 1) * 7]; renderToday(); } };
  $("wkNext").onclick = () => { if (pageIdx < pages - 1) { S.day = cal[(pageIdx + 1) * 7]; renderToday(); } };
  if ($("backToday")) $("backToday").onclick = () => { S.day = today(); renderToday(); };
  if ($("ciBtn")) $("ciBtn").onclick = () => go("checkin");
  if ($("resumeNow")) $("resumeNow").onclick = resumePlan;
  if ($("retakeNow")) $("retakeNow").onclick = () => { try { sessionStorage.setItem("rejuva_ci", String(reviewRound())); } catch (e) {} };
  if ($("quizRemind")) $("quizRemind").onclick = () => icsReminder(win.end, "Retake your RejuvaSleep quiz", `Day 21 of your plan. Open ${new URL("app.html", location.href).href} and retake the quiz to see your progress.`);
  view.querySelectorAll(".act").forEach(b => b.onclick = () => go(b.dataset.act, b.dataset.open || null));
  view.querySelectorAll(".tick").forEach(b => b.onclick = () => toggleCheck(sel, items.find(it => it.k === b.dataset.k)));
}

async function toggleCheck(date, it) {
  if (!it || date > today() || isPausedDate(date) || !S.member) return;
  if (it.ritual) { await toggleRitual(it.ritual, date); return renderToday(); }
  if (it.auto) { toast(it.k === "log" ? "Edit your sleep log on the Track page." : "This ticks itself from your water log."); return; }
  const on = S.checks.some(c => c.log_date === date && c.item === it.k);
  if (on) {
    S.checks = S.checks.filter(c => !(c.log_date === date && c.item === it.k)); renderToday();
    const { error } = await sb.from("routine_checks").delete().eq("log_date", date).eq("item", it.k);
    if (error) { toast(friendlyError(error)); S.checks.push({ log_date: date, item: it.k }); renderToday(); }
  } else {
    S.checks.push({ log_date: date, item: it.k }); renderToday();
    const { error } = await sb.from("routine_checks").insert({ user_id: S.user.id, log_date: date, item: it.k });
    if (error && !/duplicate/i.test(error.message)) { toast(friendlyError(error)); S.checks = S.checks.filter(c => !(c.log_date === date && c.item === it.k)); renderToday(); return; }
    const [a, b] = dayProgress(date);
    if (a === b) toast("✨ Every step done. Beautiful work!");
  }
}

// ── PROGRESS: is the member improving, and where do they need help? ──
const METRICS = [
  { id: "hours", label: "Hours of sleep", unit: "hrs", fmt: v => v.toFixed(1), better: "up", step: 0.25,
    target: () => schedule().goal - 0.25, targetText: () => `goal ${schedule().goal.toFixed(1)} hrs`,
    tip: () => `Move your bedtime 15 minutes earlier (to ${nice(fromMin(toMin(schedule().bed) - 15))}) and protect your wind-down. Small shifts stick better than big ones.` },
  { id: "steady", label: "Bedtime steadiness", unit: "hrs apart", fmt: v => v.toFixed(1), better: "down", step: 0.25,
    target: () => 1, targetText: () => "within 1 hr",
    tip: () => `Your bedtimes are drifting. Set a daily alarm for ${nice(schedule().winddown)} to start winding down, and keep the same times on weekends.` },
  { id: "quality", label: "Sleep quality", unit: "out of 5", fmt: v => v.toFixed(1), better: "up", step: 0.3,
    target: () => 3.5, targetText: () => "3.5 or more",
    tip: () => "Quality has dropped. Keep your phone out of the bedroom, keep the room cool (about 65°F / 18°C), and use 4-7-8 breathing in bed." },
  { id: "water", label: "Water a day", unit: "glasses", fmt: v => v.toFixed(1), better: "up", step: 0.5,
    target: () => schedule().water - 0.5, targetText: () => `goal ${schedule().water}`,
    tip: () => "Front-load your water: a full glass on waking, one with every meal, and your last big glass by 7pm." },
  { id: "routine", label: "Routine ticked", unit: "%", fmt: v => Math.round(v), better: "up", step: 5,
    target: () => 70, targetText: () => "70% or more",
    tip: () => "Aim for fewer, easier wins: tick your wake-up time, morning water and lights-out every day before adding the rest." },
  { id: "rituals", label: "Face rituals", unit: "this week", fmt: v => Math.round(v), better: "up", step: 1,
    target: () => 7, targetText: () => "7 a week",
    tip: () => `Pair your ${RITUAL_NAMES[myRituals().morning].toLowerCase()} with brushing your teeth, so it happens without thinking.` }
];

// Sum up one week of the plan (only days that have happened and weren't paused)
function weekStats(dates) {
  const past = dates.filter(d => d <= today() && !isPausedDate(d));
  if (!past.length) return null;
  const inW = r => past.includes(r.log_date);
  const nights = S.sleep.filter(inW), water = S.water.filter(inW);
  const beds = nights.map(r => { const m = toMin(r.bedtime); return m < 720 ? m + 1440 : m; });
  let ticked = 0, possible = 0;
  past.forEach(d => { const [a, b] = dayProgress(d); ticked += a; possible += b; });
  const q = nights.filter(r => r.quality);
  return {
    days: past.length,
    hours: nights.length ? avg(nights.map(r => Number(r.hours))) : null,
    steady: nights.length >= 2 ? (Math.max(...beds) - Math.min(...beds)) / 60 : null,
    quality: q.length ? avg(q.map(r => r.quality)) : null,
    water: water.length ? avg(water.map(r => r.glasses)) : null,
    routine: possible ? ticked / possible * 100 : null,
    rituals: S.rituals.filter(inW).length * (7 / past.length)
  };
}

function progressModel() {
  const r = round(), win = roundWindow(r);
  const active = win.dates.filter(t => t.day && roundOf(t.day) === r);
  const weeks = [1, 2, 3].map(w => weekStats(active.filter(t => Math.ceil(roundDay(t.day) / 7) === w).map(t => t.date)));
  const cur = weeks.reduce((i, wk, j) => wk ? j : i, 0);
  const rows = METRICS.map(m => {
    const now = weeks[cur] && weeks[cur][m.id], prev = cur > 0 && weeks[cur - 1] ? weeks[cur - 1][m.id] : null;
    let status = "none";
    if (now != null) {
      const meets = m.better === "up" ? now >= m.target() : now <= m.target();
      const delta = prev == null ? 0 : (m.better === "up" ? now - prev : prev - now);
      if (prev != null && delta >= m.step) status = "up";
      else if (prev != null && delta <= -m.step) status = "down";
      else status = meets ? "ok" : "low";
    }
    return { m, now, prev, status, vals: weeks.map(wk => wk ? wk[m.id] : null) };
  });
  return { r, win, active, weeks, cur, rows };
}

const STATUS = {
  up: ["▲", "Improving", "st-up"], ok: ["●", "On track", "st-ok"], low: ["▼", "Needs attention", "st-down"],
  down: ["▼", "Slipping", "st-down"], none: ["–", "Not enough data yet", "st-none"]
};

function progressHTML() {
  const pm = progressModel(), sc = schedule();
  const byDate = Object.fromEntries(S.sleep.map(x => [x.log_date, x]));
  const days = pm.active;
  const maxH = Math.max(10, ...days.map(t => byDate[t.date] ? Number(byDate[t.date].hours) : 0));
  const focus = pm.rows.filter(x => x.status === "low" || x.status === "down");
  const wins = pm.rows.filter(x => x.status === "up");
  const logged = days.filter(t => byDate[t.date]).length;

  const chart = `<div class="card" style="margin-top:16px">
    <div class="spread"><h3>Hours of sleep${pm.r > 1 ? ` · round ${pm.r}` : ""}</h3><span class="pill">${logged} of ${days.filter(t => t.date <= today()).length || 1} nights logged</span></div>
    <p class="muted" style="font-size:.9rem">Each bar is one night. Purple bars reach your goal of ${sc.goal.toFixed(1)} hours. Tap a bar to see it.</p>
    <div class="bars round-bars" role="img" aria-label="Hours of sleep for each night of this round">
      <div class="goal" style="bottom:${(sc.goal / maxH) * 100}%"><span>goal ${sc.goal.toFixed(1)}h</span></div>
      ${Array.from({ length: PLAN_LEN }, (_, i) => {
        const t = days[i], rec = t && byDate[t.date], h = rec ? Number(rec.hours) : 0;
        const title = t ? `Day ${i + 1} · ${fmtDate(t.date)}: ${rec ? h.toFixed(1) + " hours" : t.date > today() ? "coming up" : "not logged"}` : `Day ${i + 1}: coming up`;
        return `<button class="bar" data-tip="${esc(title)}" aria-label="${esc(title)}"><i class="${!rec ? "none" : h >= sc.goal - 0.25 ? "good" : ""}" style="height:${(h / maxH) * 100}%"></i><b>${[1, 7, 14, 21].includes(i + 1) ? i + 1 : ""}</b></button>`;
      }).join("")}
    </div>
    <details class="table-view"><summary>Show as a list</summary>
      <table class="hist">${days.filter(t => t.date <= today()).map(t => { const rec = byDate[t.date]; return `<tr><td>Day ${roundDay(t.day)} · ${fmtDate(t.date)}</td><td>${rec ? Number(rec.hours).toFixed(1) + " hrs" : "—"}</td></tr>`; }).join("")}</table>
    </details>
  </div>`;

  const rowHTML = x => {
    const [ic, label, cls] = STATUS[x.status];
    const top = Math.max(...x.vals.filter(v => v != null), x.m.better === "up" ? x.m.target() : 0, 0.0001);
    return `<div class="metric">
      <div class="spread"><div><p class="t">${x.m.label}</p><p class="s">${x.now != null ? `This week: <strong>${x.m.fmt(x.now)}${x.m.unit === "%" ? "%" : " " + x.m.unit}</strong>${x.prev != null ? ` · last week ${x.m.fmt(x.prev)}` : ""}` : "Log a few days to see this"} · ${x.m.targetText()}</p></div>
        <span class="status ${cls}"><span aria-hidden="true">${ic}</span> ${label}</span></div>
      <div class="mini" aria-hidden="true">${x.vals.map((v, i) => `<div class="mb ${i === pm.cur ? "cur" : ""}"><i style="height:${v == null ? 0 : Math.max(6, (v / top) * 100)}%"></i><b>W${i + 1}</b><em>${v == null ? "–" : x.m.fmt(v)}</em></div>`).join("")}</div>
      ${x.status === "low" || x.status === "down" ? `<p class="m-tip">💡 ${esc(x.m.tip())}</p>` : ""}
    </div>`;
  };

  return `${chart}
  <div class="card" style="margin-top:16px">
    <h3>Week by week</h3>
    <p class="muted" style="font-size:.9rem">Week ${pm.cur + 1} of your 21 days compared with the week before.</p>
    ${pm.rows.map(rowHTML).join("")}
  </div>
  <div class="card focus-card" style="margin-top:16px">
    <h3>${focus.length ? "What to focus on" : "You're on track"}</h3>
    ${focus.length
      ? focus.map(x => `<div class="tip"><div class="ic">🎯</div><div><h4>${x.m.label}</h4><p class="muted" style="font-size:.95rem">${esc(x.m.tip())}</p></div></div>`).join("")
      : `<p class="muted">${logged ? "Nothing is slipping. Keep the same routine and your results will keep building." : "Start logging your nights and water, and this page will show what's working and what needs help."}</p>`}
    ${wins.length ? `<p class="wins">🌟 Getting better: ${wins.map(x => x.m.label.toLowerCase()).join(", ")}.</p>` : ""}
  </div>`;
}

// ── TRACK ────────────────────────────────────────────
const QUALITY = [["😫", "Awful"], ["😕", "Poor"], ["😐", "Okay"], ["🙂", "Good"], ["😴", "Great"]];
function renderTrack() {
  const sc = schedule();
  const existing = S.sleep.find(r => r.log_date === today());
  const water = S.water.find(r => r.log_date === today()) || { glasses: 0, coconut: 0 };
  const byDate = Object.fromEntries(S.sleep.map(r => [r.log_date, r]));
  const maxH = Math.max(10, ...S.sleep.map(r => Number(r.hours)));
  const recent = S.sleep.filter(r => r.log_date >= daysAgo(6));
  const avgH = avg(recent.map(r => Number(r.hours)));
  let streak = 0; for (let i = 0; i < 28; i++) { if (byDate[daysAgo(i)]) streak++; else if (i > 0) break; }

  view.innerHTML = `<h2>${S.member ? "Track" : "Your history"}</h2><p class="lede">${S.member ? "Log each morning. It takes 20 seconds and powers your progress and tips." : "Everything you logged is saved here. Restart your plan to add new days."}</p>
  ${S.member ? "" : `<button class="btn btn-gold full" data-go="today" style="margin-bottom:16px">Restart my plan</button>`}
  <div class="grid2" ${S.member ? "" : "hidden"}>
    <form class="card" id="sleepForm">
      <h3>Last night's sleep</h3>
      <div class="grid2" style="gap:12px">
        <label>Went to sleep<input type="time" id="bed" value="${existing ? existing.bedtime.slice(0, 5) : sc.bed}" required></label>
        <label>Woke up<input type="time" id="wake" value="${existing ? existing.wake_time.slice(0, 5) : sc.wake}" required></label>
      </div>
      <label>How did you sleep?</label>
      <div class="quality" id="quality">${QUALITY.map((q, i) => `<button type="button" data-q="${i + 1}" class="${existing && existing.quality === i + 1 ? "on" : ""}">${q[0]}<span>${q[1]}</span></button>`).join("")}</div>
      <label>Notes <span class="field-hint" style="display:inline">(optional)</span><input type="text" id="note" maxlength="140" placeholder="e.g. late dinner, woke at 3am" value="${esc(existing?.note || "")}"></label>
      <p class="muted" id="hoursOut" style="margin-top:12px;font-size:.92rem"></p>
      <button class="btn btn-purple full" style="margin-top:8px" type="submit">${existing ? "Update" : "Save"} last night</button>
    </form>

    <div class="stack">
      <div class="card">
        <div class="spread"><h3>Water today</h3><span class="pill">Goal ${sc.water}</span></div>
        <div class="spread" style="margin-top:8px">
          <div class="counter"><button aria-label="Remove a glass" data-w="-1">−</button><span class="n" id="wN">${water.glasses}</span><button aria-label="Add a glass" data-w="1">+</button></div>
          <span class="muted" style="font-size:.88rem">glasses</span>
        </div>
        <div class="drops" id="drops">${Array.from({ length: Math.max(sc.water, water.glasses) }, (_, i) => `<i class="${i < water.glasses ? "on" : ""}"></i>`).join("")}</div>
        <div class="spread" style="margin-top:16px">
          <span>🥥 Coconut water</span>
          <div class="counter"><button aria-label="Remove coconut water" data-c="-1">−</button><span class="n" id="cN" style="font-size:1.3rem">${water.coconut}</span><button aria-label="Add coconut water" data-c="1">+</button></div>
        </div>
      </div>
      <div class="card grid2" style="gap:8px">
        <div><p class="label">7-day average</p><p class="big">${recent.length ? avgH.toFixed(1) : "–"}<small> hrs</small></p></div>
        <div><p class="label">Logging streak</p><p class="big">${streak}<small> day${streak === 1 ? "" : "s"}</small></p></div>
      </div>
    </div>
  </div>

  ${progressHTML()}

  ${S.sleep.length ? `<div class="card" style="margin-top:16px"><h3>Recent nights</h3><table class="hist">${S.sleep.slice(-7).reverse().map(r =>
      `<tr><td>${longDay(r.log_date)}</td><td class="muted">${nice(r.bedtime)} → ${nice(r.wake_time)}</td><td>${r.quality ? QUALITY[r.quality - 1][0] : ""} <strong>${Number(r.hours).toFixed(1)}h</strong></td></tr>`).join("")}</table></div>` : ""}`;

  view.querySelectorAll(".bar[data-tip]").forEach(b => b.onclick = () => toast(b.dataset.tip));
  view.querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
  let quality = existing ? existing.quality : null;
  const showHours = () => { $("hoursOut").textContent = `That's ${hoursBetween($("bed").value, $("wake").value).toFixed(1)} hours of sleep.`; };
  $("bed").oninput = $("wake").oninput = showHours; showHours();
  $("quality").querySelectorAll("button").forEach(b => b.onclick = () => {
    quality = +b.dataset.q; $("quality").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
  });

  $("sleepForm").onsubmit = async e => {
    e.preventDefault();
    const row = { user_id: S.user.id, log_date: today(), bedtime: $("bed").value, wake_time: $("wake").value,
      hours: hoursBetween($("bed").value, $("wake").value), quality, note: $("note").value.trim() || null };
    const { data, error } = await sb.from("sleep_logs").upsert(row, { onConflict: "user_id,log_date" }).select().single();
    if (error) return toast(friendlyError(error));
    S.sleep = S.sleep.filter(r => r.log_date !== row.log_date).concat(data || row).sort((a, b) => a.log_date < b.log_date ? -1 : 1);
    toast("Saved. Nice work logging."); renderTrack();
  };

  let wTimer;
  const saveWater = () => {
    clearTimeout(wTimer);
    wTimer = setTimeout(async () => {
      const row = { user_id: S.user.id, log_date: today(), glasses: water.glasses, coconut: water.coconut };
      const { error } = await sb.from("water_logs").upsert(row, { onConflict: "user_id,log_date" });
      if (error) return toast(friendlyError(error));
      S.water = S.water.filter(r => r.log_date !== row.log_date).concat(row);
      if (water.glasses === sc.water) toast("💧 Water goal hit for today!");
    }, 500);
  };
  view.querySelectorAll("[data-w]").forEach(b => b.onclick = () => {
    water.glasses = Math.max(0, Math.min(30, water.glasses + +b.dataset.w));
    $("wN").textContent = water.glasses;
    $("drops").innerHTML = Array.from({ length: Math.max(sc.water, water.glasses) }, (_, i) => `<i class="${i < water.glasses ? "on" : ""}"></i>`).join("");
    saveWater();
  });
  view.querySelectorAll("[data-c]").forEach(b => b.onclick = () => {
    water.coconut = Math.max(0, Math.min(10, water.coconut + +b.dataset.c)); $("cN").textContent = water.coconut; saveWater();
  });
}

// ── PLAN ─────────────────────────────────────────────
function icsFile(sc) {
  const d = new Date(); const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const t = s => s.replace(":", "") + "00";
  const rit = myRituals();
  const ev = (uid, time, title, desc) => [
    "BEGIN:VEVENT", `UID:${uid}-${S.user.id}@rejuvasleep`, `DTSTAMP:${date}T000000Z`, `DTSTART:${date}T${t(time)}`, "DURATION:PT15M",
    "RRULE:FREQ=DAILY", `SUMMARY:${title}`, `DESCRIPTION:${desc}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${title}`, "TRIGGER:PT0M", "END:VALARM", "END:VEVENT"];
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//RejuvaSleep//EN", "CALSCALE:GREGORIAN",
    ...ev("winddown", sc.winddown, "🌙 RejuvaSleep: start your wind-down", `Phone away\\, lights low\\, ${RITUAL_NAMES[rit.evening]}. Lights out at ${nice(sc.bed)}.`),
    ...ev("morning", sc.wake, "☀️ RejuvaSleep: morning reset", `Glass of water\\, daylight\\, ${RITUAL_NAMES[rit.morning]}. Log last night in the app.`),
    "END:VCALENDAR"].join("\r\n");
}

function renderPlan() {
  const sc = schedule(), rit = myRituals(), day = programDay(), rd = roundDay(day), wk = Math.min(3, Math.ceil(Math.max(1, rd) / 7));
  const perBlock = Math.ceil(sc.water / 3);
  view.innerHTML = `<h2>My plan</h2><p class="lede">Built from your quiz. Change your bedtime or wake time and everything updates.</p>
  <div class="grid2">
    <form class="card" id="planForm">
      <h3>Your schedule</h3>
      <div class="grid2" style="gap:12px">
        <label>Go to sleep by<input type="time" id="pBed" value="${sc.bed}" required></label>
        <label>Wake up by<input type="time" id="pWake" value="${sc.wake}" required></label>
      </div>
      <p class="muted" id="pHours" style="margin-top:8px">That's ${sc.goal.toFixed(1)} hours of sleep.</p>
      <label>Water goal<select id="pWater">${[6, 7, 8, 9, 10, 12].map(n => `<option value="${n}" ${n === sc.water ? "selected" : ""}>${n} glasses</option>`).join("")}</select></label>
      <button class="btn btn-purple full" style="margin-top:18px" type="submit">Save my schedule</button>
    </form>

    <div class="card">
      <h3>Your night, step by step</h3>
      <div class="timeline">
        <div class="tl"><time>${nice(sc.screensOff)}</time><div>Screens off, lights dimmed, last sips of water.</div></div>
        <div class="tl"><time>${nice(sc.winddown)}</time><div>Wind-down: skincare + <strong>${RITUAL_NAMES[rit.evening]}</strong>, then tea and tomorrow's list.</div></div>
        <div class="tl"><time>${nice(sc.bed)}</time><div>Lights out. 4 rounds of 4-7-8 breathing.</div></div>
        <div class="tl"><time>${nice(sc.wake)}</time><div>Up. Water, daylight, <strong>${RITUAL_NAMES[rit.morning]}</strong>, log your night.</div></div>
      </div>
    </div>
  </div>

  <div class="card" style="margin-top:16px">
    <h3>Reminders</h3>
    <p class="muted">Get an alert on your phone every night when it's time to wind down, and every morning when you wake.</p>
    <div class="row" style="margin-top:14px">
      <button class="btn btn-gold btn-sm" id="ics">Add reminders to my calendar</button>
      <button class="btn btn-ghost btn-sm" id="notif">Also notify me in this browser</button>
    </div>
    <p class="fine">The calendar option works on iPhone, Android, Google and Outlook calendars, and alerts you even when this site is closed. If you change your schedule, add the reminders again and delete the old ones.</p>
  </div>

  <div class="card" style="margin-top:16px">
    <h3>Water &amp; hydration plan</h3>
    <div class="grid3" style="margin-top:8px">
      <div class="week"><b>Wake – noon</b>${perBlock} glasses. Start with one before coffee.</div>
      <div class="week"><b>Noon – 5pm</b>${perBlock} glasses, plus coconut water if you're active or it's hot.</div>
      <div class="week"><b>5pm – bedtime</b>${Math.max(0, sc.water - perBlock * 2)} glass${sc.water - perBlock * 2 === 1 ? "" : "es"}. Small sips only after ${nice(sc.screensOff)}.</div>
    </div>
  </div>

  <div class="card" style="margin-top:16px">
    <div class="spread"><h3>Your 21-day reset</h3><span class="pill">Day ${rd} of 21${round() > 1 ? ` · Round ${round()}` : ""}</span></div>
    <div class="weeks" style="margin-top:10px">
      <div class="week ${wk === 1 ? "now" : ""}"><b>Week 1 · Schedule</b>Same wake time daily, daylight in the morning, caffeine before noon, cool dark room.</div>
      <div class="week ${wk === 2 ? "now" : ""}"><b>Week 2 · Wind-down</b>Dim lights, phone out of the bedroom, the 30-minute routine and 4-7-8 breathing.</div>
      <div class="week ${wk === 3 ? "now" : ""}"><b>Week 3 · Skin</b>Morning and evening face rituals, hydration targets, silk pillowcase.</div>
    </div>
    <p style="margin-top:14px"><strong>Today:</strong> ${esc(todaysStep(day).text)}</p>
  </div>`;

  $("planForm").onsubmit = async e => {
    e.preventDefault();
    await saveSchedule($("pBed").value, $("pWake").value, Number($("pWater").value));
    renderPlan();
  };
  const showH = () => { $("pHours").textContent = `That's ${hoursBetween($("pBed").value, $("pWake").value).toFixed(1)} hours of sleep.`; };
  $("pBed").oninput = $("pWake").oninput = showH;
  $("ics").onclick = () => {
    const blob = new Blob([icsFile(schedule())], { type: "text/calendar" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "rejuvasleep-reminders.ics";
    document.body.appendChild(a); a.click(); a.remove();
    toast("Open the downloaded file to add your reminders");
  };
  $("notif").onclick = async () => {
    if (!("Notification" in window)) return toast("This browser doesn't support notifications. Use the calendar option.");
    const p = await Notification.requestPermission();
    if (p === "granted") { scheduleBrowserReminder(); toast(`We'll remind you at ${nice(schedule().winddown)} while this tab is open`); }
    else toast("Notifications are blocked. Use the calendar option instead.");
  };
}

let reminderTimer;
function scheduleBrowserReminder() {
  clearTimeout(reminderTimer);
  if (!S.member || !("Notification" in window) || Notification.permission !== "granted") return;
  const sc = schedule(); const now = new Date(); const at = new Date();
  const m = toMin(sc.winddown); at.setHours(Math.floor(m / 60), m % 60, 0, 0);
  if (at <= now) at.setDate(at.getDate() + 1);
  reminderTimer = setTimeout(() => {
    new Notification("Time to wind down 🌙", { body: `Phone away, lights low. Lights out at ${nice(sc.bed)}.` });
    scheduleBrowserReminder();
  }, at - now);
}

// ── RITUALS & LEARN ──────────────────────────────────
function readerView(item) {
  const isRitual = item.kind === "ritual";
  const done = S.rituals.some(r => r.log_date === today() && r.ritual === item.slug);
  const yt = item.video_url && (item.video_url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/) || [])[1];
  return `<div class="reader"><button class="back-link" id="back">← Back</button>
    <div class="card"><p class="label">${isRitual ? `${item.minutes || ""} min · ${esc(item.time_of_day || "anytime")}` : item.kind === "video" ? "Video" : `${item.minutes || 3} min read`}</p>
    <h2>${esc(item.title)}</h2><p class="muted">${esc(item.summary)}</p>
    ${yt ? `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${yt}" title="${esc(item.title)}" allowfullscreen loading="lazy"></iframe></div>` : ""}
    ${isRitual && Array.isArray(item.steps) && item.steps.length ? `<button class="btn btn-gold full big-btn" id="playBtn" style="margin:18px 0 6px">▶ Start guided routine <small>(${item.steps.length} steps)</small></button>` : ""}
    <div class="body">${item.body || ""}</div>
    ${isRitual ? `<button class="btn ${done ? "btn-ghost" : "btn-purple"} full" id="doneBtn" style="margin-top:18px">${done ? "✓ Done today (tap to undo)" : "Mark as done today"}</button>` : ""}
    </div></div>`;
}

async function toggleRitual(slug, date = today(), force) {
  const done = S.rituals.some(r => r.log_date === date && r.ritual === slug);
  if (force === true && done) return;
  if (done) {
    const { error } = await sb.from("ritual_logs").delete().eq("log_date", date).eq("ritual", slug);
    if (error) return toast(friendlyError(error));
    S.rituals = S.rituals.filter(r => !(r.log_date === date && r.ritual === slug));
  } else {
    const row = { user_id: S.user.id, log_date: date, ritual: slug };
    const { error } = await sb.from("ritual_logs").insert(row);
    if (error && !/duplicate/i.test(error.message)) return toast(friendlyError(error));
    S.rituals.push(row); toast("Ritual logged ✨");
  }
}

function libraryEmpty() {
  return `<div class="card"><p class="muted">The library is empty. If you're the site owner, run the setup script in Supabase to add the starter content.</p></div>`;
}

function renderRituals() {
  const items = (S.library || []).filter(i => i.kind === "ritual");
  if (S.open && S.open.endsWith(":play")) {
    const item = items.find(i => i.slug === S.open.slice(0, -5));
    if (item && item.steps) return renderPlayer(item);
  }
  if (S.open) {
    const item = items.find(i => i.slug === S.open);
    if (item) {
      view.innerHTML = readerView(item);
      $("back").onclick = () => history.back();
      if ($("playBtn")) $("playBtn").onclick = () => go("rituals", item.slug + ":play");
      $("doneBtn").onclick = async () => { await toggleRitual(item.slug); renderRituals(); };
      return;
    }
  }
  const rit = myRituals();
  const concerns = quizAnswers().skin || [];
  const doneToday = new Set(S.rituals.filter(r => r.log_date === today()).map(r => r.ritual));
  const weekCount = S.rituals.filter(r => r.log_date >= daysAgo(6)).length;
  const card = i => `<button class="card r-card ${doneToday.has(i.slug) ? "done" : ""}" data-open="${esc(i.slug)}">
      ${i.slug === rit.morning || i.slug === rit.evening ? '<span class="pill" style="margin-bottom:8px">In your plan</span>' : ""}
      <h4>${esc(i.title)}</h4><p class="muted" style="font-size:.9rem">${esc(i.summary)}</p>
      <p class="meta">${i.minutes || ""} min · ${esc(i.time_of_day || "anytime")}${doneToday.has(i.slug) ? " · ✓ done today" : ""}${(i.targets || []).some(t => concerns.includes(t)) ? " · matches your skin" : ""}</p></button>`;
  view.innerHTML = `<h2>Face rituals</h2><p class="lede">Natural, step-by-step routines. You've done ${weekCount} this week.</p>
    ${items.length ? `<div class="grid3">${items.map(card).join("")}</div>` : libraryEmpty()}`;
  view.querySelectorAll("[data-open]").forEach(b => b.onclick = () => go("rituals", b.dataset.open));
}

function renderLearn() {
  const items = (S.library || []).filter(i => i.kind !== "ritual");
  if (S.open) {
    const item = items.find(i => i.slug === S.open);
    if (item) { view.innerHTML = readerView(item); $("back").onclick = () => history.back(); return; }
  }
  const topic = i => ((i.targets || []).find(t => t.startsWith("topic:")) || "").slice(6);
  const videos = items.filter(i => i.kind === "video"), articles = items.filter(i => i.kind === "article");
  const groups = [
    ["positions", "🛏️ Sleeping positions", "How you lie at night shows on your face, neck and back."],
    ["practices", "🌿 Sleep practices", "Simple daily habits that help you fall asleep and stay asleep."],
    ["", "📖 Sleep and skin basics", ""]
  ];
  const card = i => `<button class="card r-card" data-open="${esc(i.slug)}"><h4>${i.kind === "video" ? "▶ " : ""}${esc(i.title)}</h4><p class="muted" style="font-size:.9rem">${esc(i.summary)}</p><p class="meta">${i.kind === "video" ? "Video" : `${i.minutes || 3} min read`}</p></button>`;
  const f = S.learnTopic || "all";
  const chips = `<div class="chips row-chips learn-chips">${[["all", "All"], ...groups.map(([k, t]) => [k || "basics", t])].map(([k, t]) => `<button class="chip${f === k ? " on" : ""}" data-topic="${k}">${t}</button>`).join("")}</div>`;
  const sections = groups.map(([k, t, sub]) => {
    if (f !== "all" && f !== (k || "basics")) return "";
    const list = articles.filter(i => topic(i) === k || (!k && !groups.some(g => g[0] && g[0] === topic(i))));
    return list.length ? `<h3 style="margin:22px 0 4px">${t}</h3>${sub ? `<p class="muted" style="margin:0 0 12px">${sub}</p>` : `<div style="height:8px"></div>`}<div class="grid3">${list.map(card).join("")}</div>` : "";
  }).join("");
  view.innerHTML = `<h2>Learn</h2><p class="lede">Short reads and videos on sleep, skin and recovery.</p>
    ${articles.length ? chips : ""}
    ${videos.length && f === "all" ? `<h3 style="margin:10px 0 12px">Videos</h3><div class="grid3">${videos.map(card).join("")}</div>` : ""}
    ${articles.length ? sections : (videos.length ? "" : libraryEmpty())}`;
  view.querySelectorAll("[data-open]").forEach(b => b.onclick = () => go("learn", b.dataset.open));
  view.querySelectorAll("[data-topic]").forEach(b => b.onclick = () => { S.learnTopic = b.dataset.topic; renderLearn(); });
}

// ── SETTINGS ─────────────────────────────────────────
const MAX_PAUSE = 14;
let billing = null;   // latest answer from manage-subscription

async function saveSchedule(bed, wake, water) {
  const hrs = hoursBetween(bed, wake);
  if (hrs < 4 || hrs > 12) { toast("That's " + hrs.toFixed(1) + " hours. Please choose a schedule between 4 and 12 hours of sleep."); return false; }
  const upd = { bed_time: bed, wake_time: wake, sleep_goal_hours: Math.round(hrs * 10) / 10 };
  if (water) upd.water_goal = water;
  const { error } = await sb.from("profiles").update(upd).eq("id", S.user.id);
  if (error) { toast(friendlyError(error)); return false; }
  Object.assign(S.profile, upd); scheduleBrowserReminder();
  toast("Sleep schedule saved"); return true;
}

const hasBilling = () => !!(S.membership && S.membership.subscription_id);

async function pausePlan(resumeOn) {
  if (openPause()) return toast("Your plan is already paused.");
  if (!resumeOn) return toast(`Pick the day you'll be back (up to ${MAX_PAUSE} days).`);
  // Pause the payments first, so nobody is paused in the app but still charged
  if (hasBilling()) {
    try { await callBilling("pause", { resume_on: resumeOn }); }
    catch (err) { return toast(err.message); }
    Object.assign(S.membership, { status: "paused", paused_until: resumeOn });
    billing = null;
  }
  const row = { user_id: S.user.id, start_date: today(), end_date: resumeOn, kind: "pause" };
  const { data, error } = await sb.from("pauses").insert(row).select().single();
  if (error) return toast(friendlyError(error));
  S.pauses.push(data || row);
  toast(`Paused. Your plan and payments restart on ${fmtDate(resumeOn, { weekday: "long", month: "short", day: "numeric" })}.`);
  render();
}

async function resumePlan() {
  const z = openPause(); if (!z) return;
  if (hasBilling() && S.membership.status === "paused") {
    try { await callBilling("resume"); } catch (err) { return toast(err.message); }
    Object.assign(S.membership, { status: "active", paused_until: null });
    billing = null;
  }
  const r = z.start_date >= today()
    ? await sb.from("pauses").delete().eq("id", z.id)
    : await sb.from("pauses").update({ end_date: today() }).eq("id", z.id);
  if (r.error) return toast(friendlyError(r.error));
  if (z.start_date >= today()) S.pauses = S.pauses.filter(x => x !== z); else z.end_date = today();
  toast("Welcome back! Your plan has restarted.");
  render();
}

// The nightly job restarts billing on the restart date; this catches anyone who opens the app first
async function catchUpBillingResume() {
  const m = S.membership;
  if (!m || m.status !== "paused" || !m.subscription_id) return;
  if (m.paused_until && m.paused_until > today() && openPause()) return;
  try { await callBilling("resume"); Object.assign(m, { status: "active", paused_until: null }); billing = null; } catch (e) {}
}

async function callBilling(action, extra) {
  const { data, error } = await sb.functions.invoke("manage-subscription", { body: { action, ...(extra || {}) } });
  if (error) {
    let msg = "Something went wrong. Please try again.";
    try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) {}
    throw new Error(msg);
  }
  return data;
}

function billingHTML() {
  const ms = S.membership;
  if (!ms) return `<p class="muted">You don't have a plan yet.</p><button class="btn btn-gold full" data-go="today">See plans</button>`;
  if (ms.plan === "lifetime" && !ms.subscription_id) return `<p><strong>Full access</strong> — added by RejuvaSleep. There's nothing to pay.</p>`;
  if (!billing) return `<p class="muted" id="billLoading">Checking with PayPal…</p>`;
  const pp = billing.paypal, m = billing.membership || ms;
  const money = x => x ? `$${Number(x.value).toFixed(2)}` : "";
  const next = pp && pp.next_billing_time ? fmtDate(ymd(new Date(pp.next_billing_time)), { weekday: "short", month: "long", day: "numeric" }) : null;
  const owed = pp && pp.outstanding && Number(pp.outstanding.value) > 0;
  if (m.status === "paused") return `
    <div class="kv"><span>Status</span><b>⏸ Paused</b></div>
    <div class="kv"><span>Payments</span><b>Paused until ${fmtDate(m.paused_until || today(), { weekday: "short", month: "long", day: "numeric" })}</b></div>
    <p class="fine">Nothing is charged while you're paused. Billing restarts on your restart date, and PayPal sets your next payment date from then.</p>`;
  const statusLabel = { active: "Active", paused: "Paused", past_due: "Payment due", cancelled: "Cancelled", suspended: "On hold", expired: "Ended", refunded: "Refunded" }[m.status] || m.status;
  return `
    <div class="kv"><span>Status</span><b>${S.member ? "✅ " : "⛔ "}${esc(statusLabel)}</b></div>
    ${next && S.member ? `<div class="kv"><span>Next payment</span><b>${esc(CFG.monthlyPrice || "")} on ${next}</b></div>` : ""}
    ${pp && pp.last_payment ? `<div class="kv"><span>Last payment</span><b>${money(pp.last_payment.amount)} on ${fmtDate(ymd(new Date(pp.last_payment.time)), { month: "short", day: "numeric" })}</b></div>` : ""}
    ${owed ? `<div class="warn-box"><p><strong>⚠️ A payment of ${money(pp.outstanding)} didn't go through.</strong> Update your payment method in PayPal, then tap <em>Pay now</em>. PayPal also retries automatically.</p>
      <button class="btn btn-gold full" id="payNow" style="margin-top:10px">Pay ${money(pp.outstanding)} now</button></div>` : ""}
    ${S.member ? `<a class="btn btn-ghost full" href="https://www.paypal.com/myaccount/autopay/" target="_blank" rel="noopener" style="margin-top:12px">Update payment method in PayPal</a>
      <p class="fine">Your card or bank is kept safely by PayPal, not by RejuvaSleep. After you change it there, your next payment — and any payment that's due — is taken from the new method automatically on its due date.</p>` : ""}`;
}

function renderSettings() {
  const p = S.profile, sc = schedule(), u = S.user;
  const pause = openPause();
  const pending = u.new_email;

  if (S.open === "cancel") return renderCancel();

  const maxDate = addDaysStr(today(), MAX_PAUSE), minDate = addDaysStr(today(), 1);
  view.innerHTML = `<h2>Settings</h2><p class="lede">Your details, sleep schedule and plan.</p>
  <div class="stack">
    <form class="card" id="nameForm">
      <h3>Your name</h3>
      <div class="grid2" style="gap:12px">
        <label>First name<input type="text" id="sFirst" maxlength="40" autocomplete="given-name" value="${esc(p.name || "")}"></label>
        <label>Last name<input type="text" id="sLast" maxlength="40" autocomplete="family-name" value="${esc(p.last_name || "")}"></label>
      </div>
      <button class="btn btn-purple full" type="submit" style="margin-top:16px">Save my name</button>
    </form>

    <form class="card" id="schedForm">
      <h3>Sleep schedule</h3>
      <p class="muted">Your daily routine, reminders and tips all follow these times.</p>
      <div class="grid2" style="gap:12px">
        <label>Go to sleep by<input type="time" id="sBed" value="${sc.bed}" required></label>
        <label>Wake up by<input type="time" id="sWake" value="${sc.wake}" required></label>
      </div>
      <p class="muted" id="sHours" style="margin-top:8px">That's ${sc.goal.toFixed(1)} hours of sleep.</p>
      <button class="btn btn-purple full" type="submit" style="margin-top:12px">Save my schedule</button>
    </form>

    <div class="card">
      <h3>Email and password</h3>
      <form id="emailForm">
        <p class="muted">You log in with <strong>${esc(u.email)}</strong>.${pending ? ` We sent a confirmation link to <strong>${esc(pending)}</strong>.` : ""}</p>
        <label>New email<input type="email" id="sEmail" autocomplete="email" placeholder="name@example.com"></label>
        <button class="btn btn-ghost full" type="submit" style="margin-top:12px">Change my email</button>
        <p class="fine">We'll email a confirmation link to the new address. Your plan and history move with you.</p>
      </form>
      <form id="pwForm" style="margin-top:18px;padding-top:18px;border-top:1px solid var(--line)">
        <label>New password<input type="password" id="sPw" autocomplete="new-password" minlength="8" placeholder="At least 8 characters"></label>
        <button class="btn btn-ghost full" type="submit" style="margin-top:12px">Change my password</button>
      </form>
    </div>

    <div class="card">
      <h3>Text size</h3>
      <div class="size-row big">${SIZES.map(([id, a, label], i) => `<button data-size="${id}" class="${document.documentElement.dataset.text === id ? "on" : ""}" aria-label="${label} text" style="font-size:${1.1 + i * 0.3}rem">${a}<small>${label}</small></button>`).join("")}</div>
    </div>

    <div class="card" id="billCard">
      <h3>Plan and payment</h3>
      <div id="billBody">${billingHTML()}</div>
    </div>

    ${S.member ? `<div class="card" id="pauseCard">
      <h3>${pause ? "⏸ Your plan is paused" : "Pause my plan"}</h3>
      ${pause ? `<p>Paused since ${fmtDate(pause.start_date, { weekday: "short", month: "short", day: "numeric" })}${pause.end_date ? `. It restarts by itself on <strong>${fmtDate(pause.end_date, { weekday: "long", month: "long", day: "numeric" })}</strong>.` : ". It stays paused until you restart it."}</p>
        <p class="muted">Paused days don't count toward your 21 days, so your plan ends later to make up for them.${hasBilling() ? " Your payments are paused too." : ""}</p>
        <button class="btn btn-purple full big-btn" id="resumeBtn" style="margin-top:12px">Restart my plan now</button>`
      : `<p class="muted">Taking a few days off? Pause your plan and your 21 days move out by the same number of days. Your history is kept.</p>
        <p class="sec-title" style="margin-top:14px">How long?</p>
        <div class="chips row-chips">${[3, 7, 14].map(n => `<button class="chip" data-days="${n}">${n} days</button>`).join("")}</div>
        <label style="margin-top:14px">Or pick the day you'll be back<input type="date" id="resumeDate" min="${minDate}" max="${maxDate}"></label>
        <p class="muted" id="pausePreview" style="margin-top:10px"></p>
        <button class="btn btn-purple full big-btn" id="pauseBtn" style="margin-top:8px" disabled>Pause my plan</button>
        <p class="fine">You can pause for up to ${MAX_PAUSE} days at a time and restart early whenever you like.${hasBilling() ? " <strong>Payments pause too</strong> — PayPal won't charge you while you're paused, and billing picks up again when your plan restarts." : ""}</p>`}
    </div>` : ""}

    ${S.member ? `<div class="card danger-zone">
      <h3>Cancel my plan</h3>
      <p class="muted">Stops your plan and future payments right away. You keep everything you've already logged.</p>
      <button class="btn btn-danger full" id="cancelBtn" style="margin-top:12px">Cancel my plan</button>
    </div>` : ""}

    <button class="btn btn-ghost full" id="logoutBtn2">Log out</button>
  </div>`;

  // name
  $("nameForm").onsubmit = async e => {
    e.preventDefault();
    const upd = { name: $("sFirst").value.trim(), last_name: $("sLast").value.trim() };
    if (!upd.name) return toast("Please enter your first name.");
    const { error } = await sb.from("profiles").update(upd).eq("id", S.user.id);
    if (error) return toast(friendlyError(error));
    Object.assign(S.profile, upd); toast("Name saved");
  };
  // schedule
  const showH = () => { $("sHours").textContent = `That's ${hoursBetween($("sBed").value, $("sWake").value).toFixed(1)} hours of sleep.`; };
  $("sBed").oninput = $("sWake").oninput = showH;
  $("schedForm").onsubmit = async e => { e.preventDefault(); await saveSchedule($("sBed").value, $("sWake").value); };
  // email
  $("emailForm").onsubmit = async e => {
    e.preventDefault();
    const email = $("sEmail").value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast("Enter a valid email address.");
    if (email === S.user.email) return toast("That's already your email.");
    const { data, error } = await sb.auth.updateUser({ email }, { emailRedirectTo: new URL("app.html#settings", location.href).href });
    if (error) return toast(friendlyError(error));
    S.user = (data && data.user) || S.user; S.user.new_email = S.user.new_email || email;
    toast(`Check ${email} for a confirmation link.`); renderSettings();
  };
  // password
  $("pwForm").onsubmit = async e => {
    e.preventDefault();
    const pw = $("sPw").value;
    if (pw.length < 8) return toast("Your password needs at least 8 characters.");
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) return toast(friendlyError(error));
    $("sPw").value = ""; toast("Password changed");
  };
  // text size
  view.querySelectorAll(".size-row.big [data-size]").forEach(b => b.onclick = () => { applyTextSize(b.dataset.size); renderSettings(); });
  // billing
  view.querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
  const bindBilling = () => {
    if ($("payNow")) $("payNow").onclick = async () => {
      $("payNow").disabled = true; $("payNow").textContent = "Charging…";
      try {
        const r = await callBilling("retry");
        toast(r.charged ? "Payment received — thank you!" : (r.message || "Nothing is owed right now."));
        billing = null; await refreshBilling();
      } catch (err) { toast(err.message); $("payNow").disabled = false; $("payNow").textContent = "Pay now"; }
    };
  };
  const refreshBilling = async () => {
    if (!S.membership || (S.membership.plan === "lifetime" && !S.membership.subscription_id)) return;
    try { billing = await callBilling("status"); } catch (err) { billing = { membership: S.membership, paypal: null }; }
    if ($("billBody")) { $("billBody").innerHTML = billingHTML(); bindBilling(); }
  };
  if (!billing) refreshBilling(); else bindBilling();
  // pause
  if ($("resumeBtn")) $("resumeBtn").onclick = resumePlan;
  if ($("pauseBtn")) {
    let choice = null;   // the date they'll be back
    const preview = () => {
      $("pauseBtn").disabled = !choice;
      if (!choice) { $("pausePreview").textContent = ""; return; }
      const days = daysBetween(today(), choice);
      const end = roundWindow().end;
      $("pausePreview").innerHTML = `You'll be paused for <strong>${days} day${days === 1 ? "" : "s"}</strong> and back on <strong>${fmtDate(choice, { weekday: "long", month: "long", day: "numeric" })}</strong>. Your 21 days will end on ${fmtDate(addDaysStr(end, days), { month: "long", day: "numeric" })} instead of ${fmtDate(end, { month: "long", day: "numeric" })}.${hasBilling() ? " No payments are taken while you're paused." : ""}`;
    };
    view.querySelectorAll("[data-days]").forEach(b => b.onclick = () => {
      view.querySelectorAll("[data-days]").forEach(x => x.classList.toggle("on", x === b));
      choice = addDaysStr(today(), +b.dataset.days); $("resumeDate").value = choice; preview();
    });
    $("resumeDate").onchange = () => {
      const v = $("resumeDate").value;
      view.querySelectorAll("[data-days]").forEach(x => x.classList.remove("on"));
      choice = v && v >= minDate && v <= maxDate ? v : null;
      if (v && choice === null) toast(`Pick a day between tomorrow and ${fmtDate(maxDate, { month: "short", day: "numeric" })}.`);
      preview();
    };
    $("pauseBtn").onclick = async () => {
      if (!choice) return;
      $("pauseBtn").disabled = true; $("pauseBtn").textContent = "Pausing…";
      await pausePlan(choice);
      if ($("pauseBtn")) { $("pauseBtn").disabled = false; $("pauseBtn").textContent = "Pause my plan"; }
    };
  }
  if ($("cancelBtn")) $("cancelBtn").onclick = () => go("settings", "cancel");
  $("logoutBtn2").onclick = async () => { await sb.auth.signOut(); location.replace("login.html?mode=login"); };
}

function renderCancel() {
  const d = roundDay(programDay());
  view.innerHTML = `<div class="reader"><button class="back-link" id="cBack">← Back to Settings</button>
    <div class="card">
      <h2>Cancel your plan?</h2>
      <p class="muted">You're on day ${d} of 21. Here's what happens if you cancel:</p>
      <ul class="plain-list">
        <li>⏹️ Your plan stops today</li>
        <li>💳 You won't be charged again</li>
        <li>📚 Everything you've logged stays saved, and you can still look back at it</li>
        <li>🔒 You won't be able to add new days unless you restart</li>
        <li>🔁 If you come back, you pick up from day ${d}</li>
      </ul>
      <div class="warn-box"><p>Just need a break? <strong>Pausing</strong> keeps your plan and moves your 21 days out instead.</p>
        <button class="btn btn-ghost full" id="cPause" style="margin-top:10px">Pause instead</button></div>
      <p class="form-msg" id="cMsg" role="alert"></p>
      <button class="btn btn-danger full big-btn" id="cYes" style="margin-top:8px">Yes, cancel my plan</button>
      <button class="btn btn-purple full big-btn" id="cNo" style="margin-top:10px">Keep my plan</button>
    </div></div>`;
  $("cBack").onclick = $("cNo").onclick = () => go("settings");
  $("cPause").onclick = () => { go("settings"); setTimeout(() => { const c = $("pauseCard"); if (c) c.scrollIntoView({ behavior: "smooth" }); }, 50); };
  $("cYes").onclick = async () => {
    const b = $("cYes"); b.disabled = true; b.textContent = "Cancelling…";
    try {
      await callBilling("cancel");
      billing = null;
      await load();
      toast("Your plan is cancelled. Your history is saved.");
      go("today");
    } catch (err) {
      $("cMsg").textContent = err.message + ` If this keeps happening, email ${CFG.supportEmail || "us"}.`;
      b.disabled = false; b.textContent = "Yes, cancel my plan";
    }
  };
}

// ── DAY 21 CHECK-IN ──────────────────────────────────
const REASONS = [
  ["missed", "I missed some days"],
  ["schedule", "My schedule is unpredictable (work, kids, shifts)"],
  ["asleep", "I still struggle to fall asleep"],
  ["waking", "I still wake up during the night"],
  ["skin", "I want to see more change in my skin"],
  ["habits", "I need more time for the habits to stick"],
  ["happy", "It was enough — I'm happy with my results"]
];

function programStats() {
  const w = roundWindow(reviewRound());
  const inRound = d => d >= w.start && d <= w.end;
  const nights = S.sleep.filter(r => inRound(r.log_date));
  const rituals = S.rituals.filter(r => inRound(r.log_date)).length;
  let ticked = 0, possible = 0;
  for (let d = w.start; d <= w.end && d <= today(); d = addDaysStr(d, 1)) {
    if (isPausedDate(d)) continue;
    const [a, b] = dayProgress(d); ticked += a; possible += b;
  }
  return { nights: nights.length, avgH: avg(nights.map(r => Number(r.hours))), rituals, pct: possible ? Math.round(ticked / possible * 100) : 0 };
}

function renderCheckin() {
  if (!S.ci) S.ci = { stage: "intro", reasons: [], note: "" };
  const ci = S.ci, p = S.profile, st = programStats();
  const rr = reviewRound();
  const already = S.checkins.find(c => c.round === rr);
  const back = `<button class="back-link" id="ciBack">← Back to Today</button>`;
  let html = "";

  if (already && ci.stage !== "finished") {
    html = `<div class="card"><h3>Check-in done</h3><p class="muted">You've already completed the check-in for round ${rr}.</p></div>`;
  } else if (ci.stage === "intro") {
    const retook = p.prev_quiz_score != null && sessionStorage.getItem("rejuva_ci") === String(rr);
    html = `<div class="card ci-hero"><div class="big-ic">🎉</div><h2>${roundDay(programDay()) >= 19 ? "Almost there — 21 days!" : "You did it — 21 days!"}</h2>
      <p class="muted">Here's what you put in over the last three weeks.</p>
      <div class="ci-stats">
        <div><b>${st.nights}</b><span>nights logged</span></div>
        <div><b>${st.avgH ? st.avgH.toFixed(1) : "–"}</b><span>avg hours</span></div>
        <div><b>${st.rituals}</b><span>face rituals</span></div>
        <div><b>${st.pct}%</b><span>routine ticked</span></div>
      </div></div>
      ${retook ? `<div class="card score-compare"><p class="label">Your Sleep Aging Score</p>
        <div class="row" style="gap:18px;align-items:baseline"><span class="big muted-num">${p.prev_quiz_score}</span><span class="arrow">→</span><span class="big">${p.quiz_score}</span></div>
        <p class="muted">${p.quiz_score < p.prev_quiz_score ? `Down ${p.prev_quiz_score - p.quiz_score} points. Lower is better — your habits are working.` : p.quiz_score === p.prev_quiz_score ? "The same as before. Another round can help the habits take hold." : `Up ${p.quiz_score - p.prev_quiz_score} points. Let's look at what got in the way.`}</p>
        <button class="btn btn-purple full big-btn" id="ciNext">Continue</button></div>`
      : `<div class="card"><h3>Step 1 · Retake the quiz</h3><p class="muted">The same questions as day 1, so you can see how much has changed. Takes about 2 minutes.</p>
        <a class="btn btn-gold full big-btn" id="ciQuiz" href="quiz.html?onboard=1&checkin=1">Retake the quiz</a>
        <button class="link-btn" id="ciSkip" style="margin-top:12px">Skip the quiz</button></div>`}`;
  } else if (ci.stage === "why") {
    html = `<div class="card"><p class="label">Step 2 of 3</p><h3>How did the 21 days go?</h3>
      <p class="muted">Pick everything that fits. Your answers shape your next round.</p>
      <div class="chips">${REASONS.map(([k, label]) => `<button class="chip ${ci.reasons.includes(k) ? "on" : ""}" data-r="${k}" aria-pressed="${ci.reasons.includes(k)}">${label}</button>`).join("")}</div>
      <label class="note-label">Anything else? What would help you most? <span class="field-hint">(optional)</span>
        <textarea id="ciNote" rows="3" maxlength="500" placeholder="e.g. I work night shifts, or I keep forgetting the evening ritual">${esc(ci.note)}</textarea></label>
      <button class="btn btn-purple full big-btn" id="ciNext" style="margin-top:16px">Continue</button></div>`;
  } else if (ci.stage === "choice") {
    const happy = ci.reasons.includes("happy") && ci.reasons.length === 1;
    const focus = ci.reasons.map(r => ROUND_FOCUS[r]).filter(Boolean)[0];
    html = `<div class="card"><p class="label">Step 3 of 3</p><h3>What would you like to do next?</h3>
      <button class="choice-card primary" id="ciContinue"><span class="big-ic">🔁</span><span><strong>Keep going for another 21 days</strong><br>
        <span class="muted">${focus ? esc(focus) : "A fresh round with the same daily steps, so the habits really stick."}${S.membership && S.membership.plan !== "lifetime" ? ` Your plan continues automatically at ${esc(CFG.monthlyPrice || "")}.` : ""}</span></span></button>
      <button class="choice-card" id="ciFinish"><span class="big-ic">${happy ? "🌟" : "🏁"}</span><span><strong>I'm finished for now</strong><br>
        <span class="muted">Stop your plan so you're not charged again. Your history stays saved.</span></span></button></div>`;
  } else if (ci.stage === "finished") {
    html = `<div class="card"><div class="big-ic">💛</div><h3>Thank you for doing the work</h3>
      <p class="muted">Your feedback is saved. To stop your plan and future payments, cancel it in Settings. Everything you've logged stays in your account.</p>
      <button class="btn btn-danger full big-btn" id="ciCancel" style="margin-top:14px">Go to cancel my plan</button>
      <button class="btn btn-ghost full" id="ciDone" style="margin-top:10px">Actually, I'll keep going</button></div>`;
  }

  view.innerHTML = `<div class="reader">${back}${html}</div>`;
  $("ciBack").onclick = () => go("today");
  const nx = $("ciNext");
  if ($("ciQuiz")) $("ciQuiz").onclick = () => { try { sessionStorage.setItem("rejuva_ci", String(rr)); } catch (e) {} };
  if ($("ciSkip")) $("ciSkip").onclick = () => { ci.stage = "why"; renderCheckin(); };
  if (ci.stage === "intro" && nx) nx.onclick = () => { ci.stage = "why"; renderCheckin(); };
  if (ci.stage === "why") {
    view.querySelectorAll(".chip").forEach(b => b.onclick = () => {
      ci.note = $("ciNote").value;
      const k = b.dataset.r;
      ci.reasons = ci.reasons.includes(k) ? ci.reasons.filter(x => x !== k) : [...ci.reasons, k];
      renderCheckin();
    });
    nx.onclick = () => { ci.note = $("ciNote").value.trim(); ci.stage = "choice"; renderCheckin(); window.scrollTo(0, 0); };
  }
  if ($("ciContinue")) $("ciContinue").onclick = () => saveCheckin("continue");
  if ($("ciFinish")) $("ciFinish").onclick = () => saveCheckin("finish");
  if ($("ciDone")) $("ciDone").onclick = () => { S.ci = null; go("today"); };
  if ($("ciCancel")) $("ciCancel").onclick = () => { S.ci = null; go("settings", "cancel"); };
}

async function saveCheckin(choice) {
  const ci = S.ci, p = S.profile;
  const row = { user_id: S.user.id, round: reviewRound(), score_before: p.prev_quiz_score ?? null, score_after: p.quiz_score ?? null, reasons: ci.reasons, note: ci.note || null, choice };
  const { error } = await sb.from("checkins").insert(row);
  if (error && !/duplicate/i.test(error.message)) return toast(friendlyError(error));
  S.checkins.push(row);
  try { sessionStorage.removeItem("rejuva_ci"); } catch (e) {}
  if (choice === "continue") {
    S.ci = null;
    const next = addDaysStr(roundWindow(reviewRound()).end, 1);
    toast(next > today() ? `Round ${reviewRound() + 1} starts ${fmtDate(next, { weekday: "long" })}. You've got this!` : `Round ${round()} is underway. You've got this!`);
    go("today");
  } else {
    ci.stage = "finished"; renderCheckin(); window.scrollTo(0, 0);
  }
}

// ── GUIDED RITUAL PLAYER (one step after another, in rhythm) ──
const P = { timer: null, item: null, i: 0, beat: 0, left: 0, paused: false, done: new Set(), sound: true, audio: null };
function stopPlayer() { clearInterval(P.timer); P.timer = null; }
function tick() {
  if (!P.sound) return;
  try {
    P.audio = P.audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = P.audio.createOscillator(), g = P.audio.createGain();
    o.frequency.value = 660; g.gain.setValueAtTime(0.0001, P.audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, P.audio.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, P.audio.currentTime + 0.18);
    o.connect(g).connect(P.audio.destination); o.start(); o.stop(P.audio.currentTime + 0.2);
  } catch (e) {}
  if (navigator.vibrate) navigator.vibrate(30);
}

function renderPlayer(item) {
  if (P.item !== item.slug) { P.item = item.slug; P.i = 0; P.done = new Set(); }
  const steps = item.steps, st = steps[P.i], n = steps.length;
  const total = st.reps ? st.reps * st.beat : st.seconds;
  P.beat = 0; P.left = total; P.paused = false;
  const img = st.image ? `<img src="${esc(st.image)}" alt="${esc(st.title)}" class="step-img">` : `<div class="step-img ph"><span>${item.slug === "gua-sha" ? "🪨" : item.slug === "ice-dip" ? "🧊" : item.slug === "cucumber-eyes" ? "🥒" : "💆🏾‍♀️"}</span></div>`;
  view.innerHTML = `<div class="reader player">
    <div class="spread"><button class="back-link" id="pBack">← Exit</button>
      <button class="link-btn" id="pSound" aria-pressed="${P.sound}">${P.sound ? "🔔 Sound on" : "🔕 Sound off"}</button></div>
    <div class="card">
      <p class="label">${esc(item.title)} · Step ${P.i + 1} of ${n}</p>
      <div class="pbar"><span style="width:${Math.round(P.i / n * 100)}%"></span></div>
      ${img}
      <h2 class="step-title">${esc(st.title)}</h2>
      <p class="step-text">${esc(st.text)}</p>
      <div class="rhythm" id="rhythm">
        <div class="pulse" id="pulse"></div>
        <div class="count"><b id="pCount">${st.reps ? `0 / ${st.reps}` : fmt(total)}</b><span id="pCue">${st.reps ? "Get ready…" : "Timer"}</span></div>
      </div>
      <div class="pctrl">
        <button class="btn btn-ghost big-btn" id="pPrev" ${P.i === 0 ? "disabled" : ""} aria-label="Previous step">‹ Back</button>
        <button class="btn btn-ghost big-btn" id="pPause">⏸ Pause</button>
        <button class="btn btn-purple big-btn" id="pNext">${P.i === n - 1 ? "Finish ✓" : "Next ›"}</button>
      </div>
    </div>
    <div class="card"><p class="label">All steps</p>
      ${steps.map((x, j) => `<button class="step-row ${j === P.i ? "cur" : ""} ${P.done.has(j) ? "on" : ""}" data-j="${j}"><span class="tick small"><span>✓</span></span>${j + 1}. ${esc(x.title)}<em>${x.reps ? `${x.reps} strokes` : fmt(x.seconds)}</em></button>`).join("")}
    </div></div>`;

  $("pBack").onclick = () => history.back();
  $("pSound").onclick = () => { P.sound = !P.sound; $("pSound").textContent = P.sound ? "🔔 Sound on" : "🔕 Sound off"; };
  $("pPrev").onclick = () => { stopPlayer(); P.i = Math.max(0, P.i - 1); renderPlayer(item); };
  $("pNext").onclick = () => nextStep(item);
  $("pPause").onclick = () => { P.paused = !P.paused; $("pPause").textContent = P.paused ? "▶ Resume" : "⏸ Pause"; };
  view.querySelectorAll(".step-row").forEach(b => b.onclick = () => { stopPlayer(); P.i = +b.dataset.j; renderPlayer(item); });

  stopPlayer();
  let warm = 2;   // two-second "get ready" before strokes begin
  P.timer = setInterval(() => {
    if (P.paused) return;
    if (warm > 0) { warm--; return; }
    if (st.reps) {
      // one stroke per beat: pulse, tick, count up
      P.left--;
      const elapsed = total - P.left;
      if ((elapsed - 1) % st.beat === 0) {
        P.beat++;
        tick();
        const pulse = $("pulse"); if (pulse) { pulse.classList.remove("go"); void pulse.offsetWidth; pulse.style.animationDuration = st.beat + "s"; pulse.classList.add("go"); }
        if ($("pCount")) $("pCount").textContent = `${Math.min(P.beat, st.reps)} / ${st.reps}`;
        if ($("pCue")) $("pCue").textContent = "Stroke… and release";
      }
    } else {
      P.left--;
      if ($("pCount")) $("pCount").textContent = fmt(Math.max(0, P.left));
      if (P.left <= 3 && P.left > 0) tick();
    }
    if (P.left <= 0) {
      stopPlayer(); P.done.add(P.i);
      if ($("pCue")) $("pCue").textContent = "Done ✓";
      const at = P.i;
      setTimeout(() => { if (S.open === item.slug + ":play" && P.i === at && !P.paused) nextStep(item); }, 1500);
    }
  }, 1000);
}
const fmt = sec => `${Math.floor(sec / 60)}:${pad(sec % 60)}`;

async function nextStep(item) {
  stopPlayer(); P.done.add(P.i);
  if (P.i < item.steps.length - 1) { P.i++; renderPlayer(item); window.scrollTo(0, 0); return; }
  await toggleRitual(item.slug, today(), true);
  view.innerHTML = `<div class="reader"><div class="card ci-hero"><div class="big-ic">✨</div><h2>Ritual complete</h2>
    <p class="muted">${esc(item.title)} is ticked off for today. Your skin thanks you.</p>
    <button class="btn btn-purple full big-btn" id="pHome" style="margin-top:16px">Back to Today</button>
    <button class="btn btn-ghost full" id="pAgain" style="margin-top:10px">Do it again</button></div></div>`;
  P.item = null;
  $("pHome").onclick = () => go("today");
  $("pAgain").onclick = () => renderPlayer(item);
}

// ── Start ────────────────────────────────────────────
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return location.replace("login.html?mode=login");
  S.user = session.user;
  try { await load(); }
  catch (e) { view.innerHTML = `<div class="card"><h3>We couldn't load your account</h3><p class="muted">${esc(friendlyError(e))}</p><button class="btn btn-purple btn-sm" onclick="location.reload()" style="margin-top:12px">Try again</button></div>`; return; }

  // Step 1: the quiz personalises everything, so it comes first
  if (!S.profile.quiz) return location.replace("quiz.html?onboard=1");
  // Step 2: no access until paid

  await loadLibrary();
  const [want, ...rest] = location.hash.slice(1).split("/");
  const open = rest.join("/");
  scheduleBrowserReminder();
  history.replaceState({ root: true }, "", location.pathname + location.search);
  S.tab = null;   // make the first screen a new history entry above the root guard
  const valid = TABS.some(t => t.id === want) || want === "checkin";
  go(valid ? want : "today", valid ? (open ? decodeURIComponent(open) : null) : null);
})();
