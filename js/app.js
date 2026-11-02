import { sb, esc, friendlyError } from "./supa.js";

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

// ── Plan maths from profile ──────────────────────────
function schedule() {
  const p = S.profile || {};
  const wake = toMin(p.wake_time || "06:30");
  const goal = Number(p.sleep_goal_hours || 7.5);
  const bed = wake - Math.round(goal * 60);
  return { wake: fromMin(wake), bed: fromMin(bed), winddown: fromMin(bed - 30), screensOff: fromMin(bed - 60), goal, water: Number(p.water_goal || 8) };
}
const quizAnswers = () => (S.profile && S.profile.quiz) || {};
// Day 1 is the day they unlocked their membership (not the day they signed up)
// A new round of the reset (after the day-21 check-in) restarts the count from program_start.
const programStart = () => {
  const p = S.profile || {};
  return p.program_start ? new Date(p.program_start + "T00:00") : new Date((S.membership && S.membership.created_at) || p.created_at || Date.now());
};
const programDay = (dateStr = today()) => {
  const start = programStart(); start.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00");
  return Math.round((d - start) / 864e5) + 1;   // can be < 1 for dates before the program started
};
const round = () => Number((S.profile && S.profile.program_round) || 1);
const needsCheckin = () => programDay() > 21 && !S.checkins.some(c => c.round === round());
// After the 21-day reset, a rotating weekly maintenance focus keeps the habits going
const MAINTAIN = [
  "Consistency check: same bedtime and wake time every night this week, weekends included.",
  "Do your morning face ritual every day this week and notice the change in puffiness.",
  "Screens-off challenge: no phone in the last hour before bed, 5 nights out of 7.",
  "Hydration week: hit your water goal daily, with your last big glass before 7pm.",
  "Evening gua sha 4 nights this week, then compare a morning photo to day 1.",
  "Light week: 15 minutes of morning daylight every day, lights dimmed after sunset.",
  "Reset week: retake the quiz from the Menu and see how your score has changed."
];
const todaysStep = day => day <= 21
  ? { label: "21-day reset · today's step", text: RESET[day - 1] }
  : { label: `Maintenance · week ${Math.floor((day - 22) / 7) + 1}`, text: MAINTAIN[Math.floor((day - 22) / 7) % MAINTAIN.length] };

const RESET = [
  "Pick your wake-up time and set it in Plan. Keep it every day for 21 days.",
  "Set your wind-down reminder in Plan so your phone nudges you each night.",
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
  "Look back at your tracker: what's improved since day 1?",
  "Do the evening gua sha before bed.",
  "Switch to a silk or satin pillowcase, or fresh pillowcase tonight.",
  "Swap your afternoon drink for coconut water or herbal tea.",
  "If you can't sleep tonight, use the 20-minute rule from Learn.",
  "Do both your morning and evening rituals today.",
  "Protect your wind-down: say no to one late-night thing.",
  "Day 21. Compare your skin and energy to day 1 — and keep going."
];

const SKIN_RITUAL = { puffy: "ice-dip", dark: "cucumber-eyes", dull: "face-massage", lines: "gua-sha", breakouts: "skin-friendly-sleep", none: "face-massage" };
function myRituals() {
  const skin = (quizAnswers().skin || ["none"])[0] || "none";
  const morning = SKIN_RITUAL[skin] || "face-massage";
  return { morning: ["ice-dip", "cucumber-eyes", "face-massage"].includes(morning) ? morning : "face-massage", evening: ["gua-sha", "skin-friendly-sleep"].includes(morning) ? morning : "gua-sha" };
}
const RITUAL_NAMES = { "ice-dip": "Ice-water face dip", "cucumber-eyes": "Cucumber & cold-spoon eye reset", "face-massage": "Morning lymphatic face massage", "gua-sha": "Evening gua sha", "hydration": "Water & coconut-water routine", "skin-friendly-sleep": "Skin-friendly sleep setup" };

// ── Weekly tips (based on the last 7 days) ───────────
function weeklyTips() {
  const since = daysAgo(6);
  const nights = S.sleep.filter(r => r.log_date >= since);
  const water = S.water.filter(r => r.log_date >= since);
  const rit = S.rituals.filter(r => r.log_date >= since);
  const sc = schedule();
  const q = quizAnswers();
  const tips = [];

  if (nights.length < 3) tips.push({ ic: "📝", t: "Log at least 5 nights this week", d: `You've logged ${nights.length} of the last 7 nights. Your tips get sharper the more you track — it takes 20 seconds each morning.` });
  if (nights.length) {
    const h = avg(nights.map(r => Number(r.hours)));
    if (h < sc.goal - 0.5) tips.push({ ic: "⏳", t: `You're averaging ${h.toFixed(1)} hours — ${(sc.goal - h).toFixed(1)} short`, d: `Move bedtime 15 minutes earlier this week (aim for ${nice(fromMin(toMin(sc.bed) - 15))}). Small shifts stick better than big ones.` });
    const beds = nights.map(r => { const m = toMin(r.bedtime); return m < 720 ? m + 1440 : m; });
    const spread = Math.max(...beds) - Math.min(...beds);
    if (nights.length >= 3 && spread > 90) tips.push({ ic: "🕰️", t: "Your bedtime moved around a lot", d: `Your bedtimes varied by about ${Math.round(spread / 60 * 10) / 10} hours. A steady schedule does more for deep sleep than catching up on weekends.` });
    const ql = avg(nights.filter(r => r.quality).map(r => r.quality));
    if (ql && ql < 3) tips.push({ ic: "🌀", t: "Your sleep quality has been low", d: "Try the 30-minute wind-down in Learn every night this week, and keep your phone out of the bedroom." });
    if (h >= sc.goal - 0.25 && spread <= 60 && nights.length >= 4) tips.push({ ic: "🌟", t: "Your sleep is on track — nice work", d: "This week's challenge: add your evening ritual 4 nights and notice the difference in the mirror." });
  }
  const glasses = water.map(r => r.glasses);
  if (!water.length) tips.push({ ic: "💧", t: "Start logging water", d: `Your goal is ${sc.water} glasses a day. Tap + on the Track tab each time you finish one.` });
  else if (avg(glasses) < sc.water - 1) tips.push({ ic: "💧", t: `You're averaging ${avg(glasses).toFixed(1)} glasses a day`, d: "Front-load it: a full glass on waking and one with every meal gets you most of the way before 3pm." });
  if (rit.length < 3) tips.push({ ic: "🧊", t: "Make your face ritual a habit", d: `You did ${rit.length} ritual${rit.length === 1 ? "" : "s"} this week. Pair the ${RITUAL_NAMES[myRituals().morning].toLowerCase()} with brushing your teeth so you don't have to remember it.` });
  if (q.caffeine === "pm2" || q.caffeine === "eve") tips.push({ ic: "☕", t: "Watch your afternoon caffeine", d: "Your quiz showed late caffeine. Try coconut water or rooibos tea after noon this week." });
  if (q.screens === "bed") tips.push({ ic: "📱", t: "Phone out of the bedroom", d: "Your quiz showed scrolling in bed. Charge it in another room for 7 nights and see what changes." });
  return tips;
}

// ── Data ─────────────────────────────────────────────
async function load() {
  const since = daysAgo(27);
  const uid = S.user.id;
  const [p, m, sl, w, r, ms, rc, ck] = await Promise.all([
    sb.from("profiles").select("*").eq("id", uid).maybeSingle(),
    sb.rpc("is_member"),
    sb.from("sleep_logs").select("*").gte("log_date", since).order("log_date"),
    sb.from("water_logs").select("*").gte("log_date", since).order("log_date"),
    sb.from("ritual_logs").select("*").gte("log_date", since),
    sb.from("memberships").select("plan,status,paid_until,created_at").maybeSingle(),
    sb.from("routine_checks").select("log_date,item").gte("log_date", daysAgo(40)),
    sb.from("checkins").select("*").order("round")
  ]);
  if (p.error) throw p.error;
  S.profile = p.data || { id: uid, name: "", created_at: new Date().toISOString() };
  S.member = !!m.data;
  S.sleep = sl.data || []; S.water = w.data || []; S.rituals = r.data || [];
  S.membership = ms.data || null;
  S.checks = rc.data || []; S.checkins = ck.data || [];

  // Every new account answers the quiz after confirming their email, so never
  // reuse answers saved in this browser from an earlier visit or another account.
  try { localStorage.removeItem("rejuva_quiz"); } catch (e) {}
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
  { id: "learn", label: "Learn", ic: "📚" }
];

function renderMenu() {
  const items = S.member
    ? TABS.map(t => `<button role="menuitem" data-tab="${t.id}" class="${S.tab === t.id ? "on" : ""}"><span>${t.ic}</span>${t.label}</button>`).join("") + '<div class="sep"></div>'
    : "";
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
  ({ today: renderToday, track: renderTrack, plan: renderPlan, rituals: renderRituals, learn: renderLearn, checkin: renderCheckin })[S.tab]();
}

// Phone back button: go to the previous screen inside the app instead of leaving it
window.addEventListener("popstate", e => {
  if (!$("menuList").hidden) { closeMenu(); }
  const st = e.state;
  if (!S.member) { history.pushState({ pay: true }, "", "#pay"); return; }
  if (!st || st.root) {
    // Already at the start: stay in the app on Today rather than exiting
    history.pushState({ tab: "today", open: null }, "", "#today");
    if (S.tab !== "today" || S.open) go("today", null, { push: false });
    return;
  }
  go(st.tab, st.open || null, { push: false });
});

// Big bottom navigation, always visible for members
const NAV = [["today", "🌙", "Today"], ["track", "📊", "Track"], ["rituals", "🧊", "Rituals"], ["plan", "🗓️", "My plan"], ["learn", "📚", "Learn"]];
function renderNav() {
  const nav = $("bottomNav");
  if (!S.member) { nav.hidden = true; return; }
  nav.hidden = false;
  nav.innerHTML = NAV.map(([id, ic, label]) => `<button data-tab="${id}" class="${S.tab === id ? "on" : ""}" aria-current="${S.tab === id ? "page" : "false"}"><span class="ni">${ic}</span>${label}</button>`).join("");
  nav.querySelectorAll("button").forEach(b => b.onclick = () => go(b.dataset.tab));
}

// Text size, remembered on this device
const SIZES = [["normal", "A", "Normal"], ["large", "A", "Large"], ["xl", "A", "Extra large"]];
function applyTextSize(sz) {
  document.documentElement.dataset.text = sz;
  try { localStorage.setItem("rejuva_text", sz); } catch (e) {}
}
try { applyTextSize(localStorage.getItem("rejuva_text") || "large"); } catch (e) { applyTextSize("large"); }

// ── Paywall: no access until subscribed ──────────────
let pollTimer;
const firstRenewal = () => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }); };

function renderPaywall() {
  renderMenu(); renderNav();
  const p = S.profile, name = p.name ? esc(p.name) : "there";
  view.innerHTML = `<div class="card locked" style="max-width:560px;margin:0 auto">
    <div class="ic">🌙</div>
    <h3>${name === "there" ? "Your" : name + ", your"} plan is ready</h3>
    ${p.quiz_score != null ? `<p class="muted">Your Sleep Aging Score: <strong>${p.quiz_score}/100</strong>. Unlock your plan to start fixing it tonight.</p>` : '<p class="muted">Unlock your plan to start tonight.</p>'}
    <ul>
      <li>Your personal sleep schedule and 21-day reset</li>
      <li>Sleep and water tracker with wind-down reminders</li>
      <li>Step-by-step natural face rituals</li>
      <li>Article and video library</li>
      <li>New tips every week based on your tracking</li>
      <li>The Deep Sleep Blueprint PDF guide</li>
    </ul>
    <p class="price" style="font-size:2rem;margin-bottom:4px"><s style="font-size:1rem;color:var(--muted);font-weight:500;margin-right:8px">${esc(CFG.monthlyPrice || "")}</s>${esc(CFG.introPrice || "")}<small style="font-size:1rem;color:var(--muted);font-weight:500"> first month</small></p>
    <p class="muted" style="font-size:.9rem;margin-bottom:18px">Then ${esc(CFG.monthlyPrice || "")}/month. Cancel anytime.</p>
    <div id="paypalButtons" class="pp-wrap"><p class="muted" style="font-size:.9rem">Loading secure checkout…</p></div>
    <p class="form-msg" id="payMsg" role="status"></p>
    <p class="terms">You'll pay <strong>${esc(CFG.introPrice || "")} today</strong> for your first month. Your subscription then renews automatically at <strong>${esc(CFG.monthlyPrice || "")} every month</strong>, starting ${firstRenewal()}, until you cancel. Cancel anytime from your PayPal account or the Menu, and you keep access until the end of the month you've paid for.</p>
    <p class="fine">Your plan unlocks on this page within a few seconds of subscribing. <button class="link-btn" id="recheck">Check now</button></p>
  </div>`;
  $("recheck").onclick = () => checkMembership(true);
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
    S.member = true;
    const { data: row } = await sb.from("memberships").select("plan,status,paid_until,created_at").maybeSingle();
    S.membership = row || S.membership;
    toast("Payment received. Welcome to RejuvaSleep!");
    go("today");
  } else if (manual) {
    toast("No payment found for your account yet. It can take a minute.");
  }
}

// ── TODAY: weekly calendar + tickable daily routine ──
const weekStart = (dateStr) => { const d = new Date(dateStr + "T12:00"); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const ROUND_FOCUS = {
  missed: "Fewer, easier wins: tick at least your morning and evening ritual every day.",
  schedule: "Anchor one thing: keep your wake-up time fixed, even on busy or shift days.",
  asleep: "Wind-down first: start your evening routine 15 minutes earlier this round.",
  waking: "Cool, dark and dry: room around 65°F / 18°C and no fluids in the last hour.",
  skin: "Skin round: do your evening gua sha at least 5 nights a week.",
  habits: "Repeat and lock in: same steps as round 1, aiming for 80% of ticks each week.",
  happy: "Maintenance: keep what worked and try one new ritual each week."
};

function routineFor(date) {
  const sc = schedule(), rit = myRituals(), day = programDay(date);
  const water = (S.water.find(r => r.log_date === date) || {}).glasses || 0;
  const slept = S.sleep.some(r => r.log_date === date);
  const ritDone = slug => S.rituals.some(r => r.log_date === date && r.ritual === slug);
  const step = day >= 1 ? todaysStep(day) : null;
  const ritMin = slug => ((S.library || []).find(i => i.slug === slug) || {}).minutes;
  return [
    step && { sec: "Today's step", k: "step", t: step.text, sub: step.label },
    { sec: "Morning", k: "wake", t: `Wake up at ${nice(sc.wake)}`, sub: "Same time every day, weekends too" },
    { sec: "Morning", k: "water-am", t: "Drink a full glass of water", sub: "Before coffee or tea" },
    { sec: "Morning", k: "light", t: "10 minutes of daylight", sub: "Step outside or sit by a bright window" },
    { sec: "Morning", k: "ritual-am", t: RITUAL_NAMES[rit.morning], sub: "Guided face ritual" + (ritMin(rit.morning) ? ` · ${ritMin(rit.morning)} min` : ""), auto: ritDone(rit.morning), ritual: rit.morning, action: ["Start", "rituals", rit.morning + ":play"] },
    { sec: "Morning", k: "log", t: "Log last night's sleep", sub: slept ? "Logged ✓" : "Takes 20 seconds", auto: slept, action: slept ? null : ["Log", "track"] },
    { sec: "Daytime", k: "caffeine", t: "Last caffeine before noon", sub: "Coffee, tea, soda and energy drinks" },
    { sec: "Daytime", k: "water-goal", t: `Drink ${sc.water} glasses of water`, sub: `${water} of ${sc.water} logged`, auto: water >= sc.water, action: water >= sc.water ? null : ["Add", "track"] },
    { sec: "Daytime", k: "move", t: "Move for 20 minutes", sub: "A walk counts" },
    { sec: "Evening", k: "screens", t: `Screens off at ${nice(sc.screensOff)}`, sub: "Dim the lights too" },
    { sec: "Evening", k: "ritual-pm", t: RITUAL_NAMES[rit.evening], sub: `Start at ${nice(sc.winddown)}` + (ritMin(rit.evening) ? ` · ${ritMin(rit.evening)} min` : ""), auto: ritDone(rit.evening), ritual: rit.evening, action: ["Start", "rituals", rit.evening + ":play"] },
    { sec: "Evening", k: "lights", t: `Lights out at ${nice(sc.bed)}`, sub: "4 rounds of 4-7-8 breathing in bed" }
  ].filter(Boolean);
}
const isDone = (date, it) => it.auto || S.checks.some(c => c.log_date === date && c.item === it.k);
const dayProgress = date => { const items = routineFor(date); return [items.filter(it => isDone(date, it)).length, items.length]; };

function renderToday() {
  const p = S.profile, sc = schedule();
  if (!S.day) S.day = today();
  const sel = S.day, isToday = sel === today(), future = sel > today();
  const name = p.name ? esc(p.name) : "there";
  const dToday = programDay();
  const ws = weekStart(sel);
  const days = Array.from({ length: 7 }, (_, i) => ymd(addDays(ws, i)));
  const items = routineFor(sel);
  const [done, total] = dayProgress(sel);
  const selDay = programDay(sel);
  const lastNight = S.sleep.find(r => r.log_date === today());
  const tips = weeklyTips();
  const lastCheck = S.checkins.filter(c => c.choice === "continue").slice(-1)[0];
  const focus = round() > 1 && lastCheck ? (lastCheck.reasons || []).map(r => ROUND_FOCUS[r]).filter(Boolean)[0] : null;

  const ms = S.membership;
  const endNote = ms && ms.plan === "monthly" && ms.status === "cancelled" && ms.paid_until
    ? `<div class="card notice"><p><strong>Your subscription is cancelled.</strong> You have full access until ${new Date(ms.paid_until).toLocaleDateString(undefined, { month: "long", day: "numeric" })}.</p></div>` : "";

  const sections = ["Today's step", "Morning", "Daytime", "Evening"];
  const row = it => {
    const on = isDone(sel, it);
    return `<div class="check-row ${on ? "on" : ""}">
      <button class="tick" data-k="${it.k}" role="checkbox" aria-checked="${on}" ${future ? "disabled" : ""} aria-label="${esc(it.t)}"><span>✓</span></button>
      <div class="ct"><p class="t">${esc(it.t)}</p><p class="s">${esc(it.sub || "")}</p></div>
      ${it.action && !future && isToday ? `<button class="btn btn-ghost btn-sm act" data-act="${it.action[1]}" data-open="${esc(it.action[2] || "")}">${it.action[0]}</button>` : ""}
    </div>`;
  };

  view.innerHTML = `<div class="stack">
    ${endNote}
    ${needsCheckin() ? `<button class="card checkin-cta" id="ciBtn"><span class="big-ic">🎉</span><span><strong>You've completed your 21-day reset!</strong><br>Take your 2-minute check-in to see your progress and choose what's next.</span><span class="go">›</span></button>` : ""}
    <div class="card hello">
      <h3>Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${name}</h3>
      <p>${dToday >= 1 && dToday <= 21 ? `Day <strong>${dToday} of 21</strong>${round() > 1 ? ` · Round ${round()}` : ""}. ` : ""}Wind-down at <strong>${nice(sc.winddown)}</strong>, lights out by <strong>${nice(sc.bed)}</strong>.</p>
      ${focus ? `<p class="focus">Round ${round()} focus: ${esc(focus)}</p>` : ""}
    </div>

    <div class="card week-card">
      <div class="spread week-head">
        <button class="nav-arrow" id="wkPrev" aria-label="Previous week">‹</button>
        <h3>${ws.toLocaleDateString(undefined, { month: "long", day: "numeric" })} – ${addDays(ws, 6).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</h3>
        <button class="nav-arrow" id="wkNext" aria-label="Next week">›</button>
      </div>
      <div class="week">${days.map(d => {
        const [a, b] = dayProgress(d), pd = programDay(d);
        const dt = new Date(d + "T12:00");
        const cls = [d === sel ? "sel" : "", d === today() ? "today" : "", d > today() ? "future" : "", a === b ? "full" : ""].join(" ");
        return `<button class="wd ${cls}" data-day="${d}" aria-pressed="${d === sel}" aria-label="${dt.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}">
          <span class="dn">${dt.toLocaleDateString(undefined, { weekday: "short" })}</span>
          <span class="dd">${dt.getDate()}</span>
          <span class="dp">${d > today() ? (pd >= 1 && pd <= 21 ? "Day " + pd : "") : `${a}/${b}`}</span>
        </button>`;
      }).join("")}</div>
      ${!isToday ? `<button class="link-btn" id="backToday" style="margin-top:12px">← Back to today</button>` : ""}
    </div>

    <div class="card routine">
      <div class="spread">
        <div><p class="label">${isToday ? "Today" : future ? "Coming up" : "Past day"}${selDay >= 1 && selDay <= 21 ? ` · Day ${selDay} of 21` : ""}</p>
        <h3>${new Date(sel + "T12:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</h3></div>
        <div class="ring" style="--p:${Math.round(done / total * 100)}"><b>${done}/${total}</b></div>
      </div>
      ${future ? `<p class="muted" style="margin:6px 0 4px">Here's what's planned. You can tick these off on the day.</p>` : ""}
      ${sections.map(sec => {
        const list = items.filter(it => it.sec === sec);
        return list.length ? `<p class="sec-title">${sec === "Morning" ? "☀️" : sec === "Daytime" ? "🌤️" : sec === "Evening" ? "🌙" : "⭐"} ${sec}</p>${list.map(row).join("")}` : "";
      }).join("")}
      ${done === total && !future ? `<p class="all-done">✨ Everything done${isToday ? " today" : ""}. Beautiful work.</p>` : ""}
    </div>

    <div class="grid2">
      <div class="card"><p class="label">Last night</p>
        ${lastNight ? `<p class="big">${Number(lastNight.hours).toFixed(1)}<small> hrs</small></p><p class="muted">${nice(lastNight.bedtime)} → ${nice(lastNight.wake_time)}</p>`
                    : `<p class="muted" style="margin:6px 0 12px">Not logged yet</p><button class="btn btn-purple btn-sm" data-go="track">Log last night</button>`}
      </div>
      <div class="card"><p class="label">Sleep Aging Score</p>
        <p class="big">${p.quiz_score ?? "–"}<small> / 100</small></p>
        ${p.prev_quiz_score != null && p.quiz_score != null ? `<p class="muted">${p.prev_quiz_score > p.quiz_score ? `Down ${p.prev_quiz_score - p.quiz_score} from ${p.prev_quiz_score} — lower is better ✓` : `Was ${p.prev_quiz_score} last time`}</p>` : `<p class="muted">Lower is better.</p>`}
      </div>
    </div>

    <div class="card">
      <h3>Your tips this week</h3>
      ${tips.map(t => `<div class="tip"><div class="ic">${t.ic}</div><div><h4>${esc(t.t)}</h4><p class="muted" style="font-size:.95rem">${esc(t.d)}</p></div></div>`).join("") || '<p class="muted">Log a few nights to get your first tips.</p>'}
    </div>
  </div>`;

  view.querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
  view.querySelectorAll(".wd").forEach(b => b.onclick = () => { S.day = b.dataset.day; renderToday(); });
  $("wkPrev").onclick = () => { S.day = ymd(addDays(new Date(sel + "T12:00"), -7)); renderToday(); };
  $("wkNext").onclick = () => { S.day = ymd(addDays(new Date(sel + "T12:00"), 7)); renderToday(); };
  if ($("backToday")) $("backToday").onclick = () => { S.day = today(); renderToday(); };
  if ($("ciBtn")) $("ciBtn").onclick = () => go("checkin");
  view.querySelectorAll(".act").forEach(b => b.onclick = () => go(b.dataset.act, b.dataset.open || null));
  view.querySelectorAll(".tick").forEach(b => b.onclick = () => toggleCheck(sel, items.find(it => it.k === b.dataset.k)));
}

async function toggleCheck(date, it) {
  if (!it || date > today()) return;
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

// ── TRACK ────────────────────────────────────────────
const QUALITY = [["😫", "Awful"], ["😕", "Poor"], ["😐", "Okay"], ["🙂", "Good"], ["😴", "Great"]];
function renderTrack() {
  const sc = schedule();
  const existing = S.sleep.find(r => r.log_date === today());
  const water = S.water.find(r => r.log_date === today()) || { glasses: 0, coconut: 0 };
  const last14 = Array.from({ length: 14 }, (_, i) => daysAgo(13 - i));
  const byDate = Object.fromEntries(S.sleep.map(r => [r.log_date, r]));
  const maxH = Math.max(10, ...S.sleep.map(r => Number(r.hours)));
  const recent = S.sleep.filter(r => r.log_date >= daysAgo(6));
  const avgH = avg(recent.map(r => Number(r.hours)));
  let streak = 0; for (let i = 0; i < 28; i++) { if (byDate[daysAgo(i)]) streak++; else if (i > 0) break; }

  view.innerHTML = `<h2>Track</h2><p class="lede">Log each morning. It takes 20 seconds and powers your weekly tips.</p>
  <div class="grid2">
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

  <div class="card" style="margin-top:16px">
    <div class="spread"><h3>Last 14 nights</h3><span class="muted" style="font-size:.85rem">Dark bars hit your goal</span></div>
    <div class="bars">
      <div class="goal" style="bottom:${(sc.goal / maxH) * 100}%"><span>goal ${sc.goal}h</span></div>
      ${last14.map(d => { const r = byDate[d]; const h = r ? Number(r.hours) : 0;
        return `<div class="bar" title="${longDay(d)}${r ? ": " + h + "h" : ""}"><i class="${!r ? "none" : h >= sc.goal - 0.25 ? "good" : ""}" style="height:${(h / maxH) * 100}%"></i><b>${shortDay(d)}</b></div>`; }).join("")}
    </div>
  </div>

  ${S.sleep.length ? `<div class="card" style="margin-top:16px"><h3>Recent nights</h3><table class="hist">${S.sleep.slice(-7).reverse().map(r =>
      `<tr><td>${longDay(r.log_date)}</td><td class="muted">${nice(r.bedtime)} → ${nice(r.wake_time)}</td><td>${r.quality ? QUALITY[r.quality - 1][0] : ""} <strong>${Number(r.hours).toFixed(1)}h</strong></td></tr>`).join("")}</table></div>` : ""}`;

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
  const sc = schedule(), rit = myRituals(), day = programDay(), wk = Math.ceil(day / 7);
  const perBlock = Math.ceil(sc.water / 3);
  view.innerHTML = `<h2>My plan</h2><p class="lede">Built from your quiz. Change your wake time or goals and everything updates.</p>
  <div class="grid2">
    <form class="card" id="planForm">
      <h3>Your schedule</h3>
      <label>I need to wake up at<input type="time" id="pWake" value="${sc.wake}" required></label>
      <div class="grid2" style="gap:12px">
        <label>Sleep goal<select id="pGoal">${[6.5, 7, 7.5, 8, 8.5, 9].map(h => `<option value="${h}" ${h === sc.goal ? "selected" : ""}>${h} hours</option>`).join("")}</select></label>
        <label>Water goal<select id="pWater">${[6, 7, 8, 9, 10, 12].map(n => `<option value="${n}" ${n === sc.water ? "selected" : ""}>${n} glasses</option>`).join("")}</select></label>
      </div>
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
    <div class="spread"><h3>Your 21-day reset</h3><span class="pill">${day <= 21 ? `Day ${day} of 21` : "Completed ✓"}</span></div>
    <div class="weeks" style="margin-top:10px">
      <div class="week ${wk === 1 ? "now" : ""}"><b>Week 1 · Schedule</b>Same wake time daily, daylight in the morning, caffeine before noon, cool dark room.</div>
      <div class="week ${wk === 2 ? "now" : ""}"><b>Week 2 · Wind-down</b>Dim lights, phone out of the bedroom, the 30-minute routine and 4-7-8 breathing.</div>
      <div class="week ${wk === 3 ? "now" : ""}"><b>Week 3 · Skin</b>Morning and evening face rituals, hydration targets, silk pillowcase.</div>
    </div>
    <p style="margin-top:14px"><strong>${day <= 21 ? "Today" : "This week's focus"}:</strong> ${esc(todaysStep(day).text)}</p>
  </div>`;

  $("planForm").onsubmit = async e => {
    e.preventDefault();
    const upd = { wake_time: $("pWake").value, sleep_goal_hours: Number($("pGoal").value), water_goal: Number($("pWater").value) };
    const { error } = await sb.from("profiles").update(upd).eq("id", S.user.id);
    if (error) return toast(friendlyError(error));
    Object.assign(S.profile, upd); toast("Schedule saved"); renderPlan(); scheduleBrowserReminder();
  };
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
  const videos = items.filter(i => i.kind === "video"), articles = items.filter(i => i.kind === "article");
  const card = i => `<button class="card r-card" data-open="${esc(i.slug)}"><h4>${i.kind === "video" ? "▶ " : ""}${esc(i.title)}</h4><p class="muted" style="font-size:.9rem">${esc(i.summary)}</p><p class="meta">${i.kind === "video" ? "Video" : `${i.minutes || 3} min read`}</p></button>`;
  view.innerHTML = `<h2>Learn</h2><p class="lede">Short reads and videos on sleep, skin and recovery.</p>
    ${videos.length ? `<h3 style="margin:10px 0 12px">Videos</h3><div class="grid3">${videos.map(card).join("")}</div>` : ""}
    ${articles.length ? `<h3 style="margin:22px 0 12px">Articles</h3><div class="grid3">${articles.map(card).join("")}</div>` : (videos.length ? "" : libraryEmpty())}`;
  view.querySelectorAll("[data-open]").forEach(b => b.onclick = () => go("learn", b.dataset.open));
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
  const start = ymd(programStart());
  const nights = S.sleep.filter(r => r.log_date >= start);
  const rituals = S.rituals.filter(r => r.log_date >= start).length;
  let ticked = 0, possible = 0;
  for (let i = 0; i < 21; i++) {
    const d = ymd(addDays(programStart(), i));
    if (d > today()) break;
    const [a, b] = dayProgress(d); ticked += a; possible += b;
  }
  return { nights: nights.length, avgH: avg(nights.map(r => Number(r.hours))), rituals, pct: possible ? Math.round(ticked / possible * 100) : 0 };
}

function renderCheckin() {
  if (!S.ci) S.ci = { stage: "intro", reasons: [], note: "" };
  const ci = S.ci, p = S.profile, st = programStats();
  const already = S.checkins.find(c => c.round === round());
  const back = `<button class="back-link" id="ciBack">← Back to Today</button>`;
  let html = "";

  if (already && ci.stage !== "finished") {
    html = `<div class="card"><h3>Check-in done</h3><p class="muted">You've already completed the check-in for round ${round()}.</p></div>`;
  } else if (ci.stage === "intro") {
    const retook = p.prev_quiz_score != null && sessionStorage.getItem("rejuva_ci") === String(round());
    html = `<div class="card ci-hero"><div class="big-ic">🎉</div><h2>You did it — 21 days!</h2>
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
      <button class="choice-card primary" id="ciContinue"><span class="big-ic">🔁</span><span><strong>Start another 21 days</strong><br>
        <span class="muted">${focus ? esc(focus) : "A fresh round with the same daily steps, so the habits really stick."}</span></span></button>
      <button class="choice-card" id="ciFinish"><span class="big-ic">${happy ? "🌟" : "🏁"}</span><span><strong>I'm finished for now</strong><br>
        <span class="muted">Keep the maintenance plan, or cancel your subscription.</span></span></button></div>`;
  } else if (ci.stage === "finished") {
    const until = S.membership && S.membership.paid_until ? new Date(S.membership.paid_until).toLocaleDateString(undefined, { month: "long", day: "numeric" }) : null;
    html = `<div class="card"><div class="big-ic">💛</div><h3>Thank you for doing the work</h3>
      <p class="muted">Your Today page now shows a weekly maintenance focus to keep your results going.</p>
      ${S.membership && S.membership.plan === "monthly" ? `<p style="margin-top:14px">If you'd like to stop your subscription, you can cancel in PayPal at any time. ${until ? `You'll keep full access until <strong>${until}</strong>.` : ""}</p>
      <a class="btn btn-ghost full" href="https://www.paypal.com/myaccount/autopay/" target="_blank" rel="noopener" style="margin-top:12px">Open PayPal subscriptions</a>` : ""}
      <button class="btn btn-purple full big-btn" id="ciDone" style="margin-top:12px">Back to Today</button></div>`;
  }

  view.innerHTML = `<div class="reader">${back}${html}</div>`;
  $("ciBack").onclick = () => go("today");
  const nx = $("ciNext");
  if ($("ciQuiz")) $("ciQuiz").onclick = () => { try { sessionStorage.setItem("rejuva_ci", String(round())); } catch (e) {} };
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
}

async function saveCheckin(choice) {
  const ci = S.ci, p = S.profile;
  const row = { user_id: S.user.id, round: round(), score_before: p.prev_quiz_score ?? null, score_after: p.quiz_score ?? null, reasons: ci.reasons, note: ci.note || null, choice };
  const { error } = await sb.from("checkins").insert(row);
  if (error && !/duplicate/i.test(error.message)) return toast(friendlyError(error));
  S.checkins.push(row);
  try { sessionStorage.removeItem("rejuva_ci"); } catch (e) {}
  if (choice === "continue") {
    const upd = { program_start: today(), program_round: round() + 1 };
    const r = await sb.from("profiles").update(upd).eq("id", S.user.id);
    if (r.error) return toast(friendlyError(r.error));
    Object.assign(S.profile, upd);
    S.ci = null; S.day = today();
    toast(`Round ${upd.program_round} starts today. You've got this!`);
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
  if (!S.member) { history.replaceState({ pay: true }, "", "#pay"); history.pushState({ pay: true }, "", "#pay"); return renderPaywall(); }

  await loadLibrary();
  const [want, open] = location.hash.slice(1).split("/");
  scheduleBrowserReminder();
  history.replaceState({ root: true }, "", location.pathname + location.search);
  S.tab = null;   // make the first screen a new history entry above the root guard
  const valid = TABS.some(t => t.id === want) || want === "checkin";
  go(valid ? want : "today", valid ? (open ? decodeURIComponent(open) : null) : null);
})();
