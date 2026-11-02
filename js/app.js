import { sb, esc, readLocalQuiz, friendlyError } from "./supa.js";

const CFG = window.REJUVA_CONFIG || {};
const $ = id => document.getElementById(id);
const view = $("view");

const S = { user: null, profile: null, member: false, sleep: [], water: [], rituals: [], library: null, tab: "today", open: null };

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
const programDay = () => {
  const start = new Date((S.profile && S.profile.created_at) || Date.now()); start.setHours(0, 0, 0, 0);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.min(21, Math.max(1, Math.round((now - start) / 864e5) + 1));
};

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
  const [p, m, sl, w, r] = await Promise.all([
    sb.from("profiles").select("*").eq("id", uid).maybeSingle(),
    sb.rpc("is_member"),
    sb.from("sleep_logs").select("*").gte("log_date", since).order("log_date"),
    sb.from("water_logs").select("*").gte("log_date", since).order("log_date"),
    sb.from("ritual_logs").select("*").gte("log_date", since)
  ]);
  if (p.error) throw p.error;
  S.profile = p.data || { id: uid, name: "", created_at: new Date().toISOString() };
  S.member = !!m.data;
  S.sleep = sl.data || []; S.water = w.data || []; S.rituals = r.data || [];

  // First visit after the quiz: copy quiz answers into the profile
  const local = readLocalQuiz();
  if (local && local.answers && !S.profile.quiz) {
    const upd = { quiz: local.answers, quiz_score: local.score };
    if (!S.profile.name && local.answers.name) upd.name = local.answers.name;
    const { error } = await sb.from("profiles").update(upd).eq("id", uid);
    if (!error) Object.assign(S.profile, upd);
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
  { id: "learn", label: "Learn", ic: "📚" }
];

function renderMenu() {
  const items = S.member
    ? TABS.map(t => `<button role="menuitem" data-tab="${t.id}" class="${S.tab === t.id ? "on" : ""}"><span>${t.ic}</span>${t.label}</button>`).join("") + '<div class="sep"></div>'
    : "";
  $("menuList").innerHTML = `<p class="menu-email">Signed in as<br><strong>${esc(S.user.email)}</strong></p>` + items + `
    <a role="menuitem" href="quiz.html?onboard=1"><span>📝</span>Retake the quiz</a>
    <a role="menuitem" href="mailto:${esc(CFG.supportEmail || "")}"><span>✉️</span>Get help</a>
    <div class="sep"></div>
    <button role="menuitem" id="logoutBtn" class="danger"><span>↩</span>Log out</button>`;
  $("menuList").querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { closeMenu(); go(b.dataset.tab); });
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

async function go(tab, open = null) {
  S.tab = tab; S.open = open;
  history.replaceState(null, "", "#" + tab);
  renderMenu();
  if ((tab === "rituals" || tab === "learn") && !S.library) { view.innerHTML = '<p class="loading">Loading…</p>'; await loadLibrary(); }
  render();
  window.scrollTo(0, 0);
}

function render() {
  ({ today: renderToday, track: renderTrack, plan: renderPlan, rituals: renderRituals, learn: renderLearn })[S.tab]();
}

// ── Paywall: no access until paid ────────────────────
let pollTimer;
function renderPaywall() {
  renderMenu();
  const p = S.profile, name = p.name ? esc(p.name) : "there";
  const pay = CFG.paypalLink
    ? `<a class="btn btn-gold full" href="${esc(CFG.paypalLink)}">Unlock my plan · ${esc(CFG.price || "")}</a>`
    : `<button class="btn btn-gold full" disabled>Checkout opens soon</button>`;
  view.innerHTML = `<div class="card locked" style="max-width:560px;margin:0 auto">
    <div class="ic">🌙</div>
    <h3>${name === "there" ? "Your" : name + ", your"} plan is ready</h3>
    ${p.quiz_score != null ? `<p class="muted">Your Sleep Aging Score: <strong>${p.quiz_score}/100</strong>. Unlock your plan to start fixing it tonight.</p>` : '<p class="muted">Unlock your plan to start tonight.</p>'}
    <ul>
      <li>Your personal sleep schedule and 21-day reset</li>
      <li>Sleep and water tracker with wind-down reminders</li>
      <li>Step-by-step natural face rituals</li>
      <li>Article and video library</li>
      <li>Weekly tips based on your tracking</li>
      <li>The Deep Sleep Blueprint PDF guide</li>
    </ul>
    <p class="price" style="font-size:2rem;margin-bottom:4px"><s style="font-size:1rem;color:var(--muted);font-weight:500;margin-right:8px">${esc(CFG.comparePrice || "")}</s>${esc(CFG.price || "")}</p>
    <p class="muted" style="font-size:.88rem;margin-bottom:18px">${esc(CFG.priceNote || "")}</p>
    ${pay}
    <p class="fine">Pay with <strong>${esc(S.user.email)}</strong> on PayPal so your account unlocks automatically. This page updates by itself once your payment comes through. <button class="link-btn" id="recheck">Check now</button></p>
  </div>`;
  $("recheck").onclick = () => checkMembership(true);
  clearInterval(pollTimer);
  let tries = 0;
  pollTimer = setInterval(() => { if (++tries > 40) clearInterval(pollTimer); checkMembership(false); }, 8000);
}

async function checkMembership(manual) {
  const { data } = await sb.rpc("is_member");
  if (data) {
    clearInterval(pollTimer);
    S.member = true;
    toast("Payment received. Welcome to RejuvaSleep!");
    go("today");
  } else if (manual) {
    toast(`No payment found for ${S.user.email} yet. It can take a minute.`);
  }
}

// ── TODAY ────────────────────────────────────────────
function renderToday() {
  const p = S.profile, sc = schedule();
  const name = p.name ? esc(p.name) : "there";
  const lastNight = S.sleep.find(r => r.log_date === today());
  const water = S.water.find(r => r.log_date === today());
  const tips = weeklyTips();
  const shown = tips;
  const day = programDay();
  const rit = myRituals();
  const doneToday = new Set(S.rituals.filter(r => r.log_date === today()).map(r => r.ritual));

  view.innerHTML = `<div class="stack">
    <div class="card hello">
      <h3>Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${name}</h3>
      <p>Tonight's wind-down starts at <strong>${nice(sc.winddown)}</strong>. Lights out by <strong>${nice(sc.bed)}</strong>.</p>
    </div>

    <div class="grid3">
      <div class="card"><p class="label">Last night</p>
        ${lastNight ? `<p class="big">${Number(lastNight.hours).toFixed(1)}<small> hrs</small></p><p class="muted">${nice(lastNight.bedtime)} → ${nice(lastNight.wake_time)}</p>`
                    : `<p class="muted" style="margin:6px 0 12px">Not logged yet</p><button class="btn btn-purple btn-sm" data-go="track">Log last night</button>`}
      </div>
      <div class="card"><p class="label">Water today</p>
        <p class="big">${water ? water.glasses : 0}<small> / ${sc.water} glasses</small></p>
        <button class="btn btn-ghost btn-sm" data-go="track" style="margin-top:10px">Add water</button>
      </div>
      <div class="card"><p class="label">Sleep Aging Score</p>
        ${p.quiz_score != null ? `<p class="big">${p.quiz_score}<small> / 100</small></p><p class="muted">From your quiz. Retake it in a few weeks to compare.</p>`
                               : `<p class="muted" style="margin:6px 0 12px">Take the quiz to get your score and personalise your plan.</p><a class="btn btn-ghost btn-sm" href="quiz.html">Take the quiz</a>`}
      </div>
    </div>

    <div class="card"><div class="task">
      <div class="day"><small>DAY</small>${day}</div>
      <div><p class="label">21-day reset · today's step</p><h4>${esc(RESET[day - 1])}</h4>
      <p class="muted" style="font-size:.9rem">Your rituals today: ${RITUAL_NAMES[rit.morning]}${doneToday.has(rit.morning) ? " ✓" : ""} in the morning, ${RITUAL_NAMES[rit.evening]}${doneToday.has(rit.evening) ? " ✓" : ""} at night.</p></div>
    </div></div>

    <div class="card">
      <h3>Your tips this week</h3>
      ${shown.map(t => `<div class="tip"><div class="ic">${t.ic}</div><div><h4>${esc(t.t)}</h4><p class="muted" style="font-size:.92rem">${esc(t.d)}</p></div></div>`).join("") || '<p class="muted">Log a few nights to get your first tips.</p>'}
    </div>
  </div>`;
  view.querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
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
    <div class="spread"><h3>Your 21-day reset</h3><span class="pill">Day ${day} of 21</span></div>
    <div class="weeks" style="margin-top:10px">
      <div class="week ${wk === 1 ? "now" : ""}"><b>Week 1 · Schedule</b>Same wake time daily, daylight in the morning, caffeine before noon, cool dark room.</div>
      <div class="week ${wk === 2 ? "now" : ""}"><b>Week 2 · Wind-down</b>Dim lights, phone out of the bedroom, the 30-minute routine and 4-7-8 breathing.</div>
      <div class="week ${wk === 3 ? "now" : ""}"><b>Week 3 · Skin</b>Morning and evening face rituals, hydration targets, silk pillowcase.</div>
    </div>
    <p style="margin-top:14px"><strong>Today:</strong> ${esc(RESET[day - 1])}</p>
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
    <div class="body">${item.body || ""}</div>
    ${isRitual ? `<button class="btn ${done ? "btn-ghost" : "btn-purple"} full" id="doneBtn" style="margin-top:18px">${done ? "✓ Done today (tap to undo)" : "Mark as done today"}</button>` : ""}
    </div></div>`;
}

async function toggleRitual(slug) {
  const done = S.rituals.some(r => r.log_date === today() && r.ritual === slug);
  if (done) {
    const { error } = await sb.from("ritual_logs").delete().eq("log_date", today()).eq("ritual", slug);
    if (error) return toast(friendlyError(error));
    S.rituals = S.rituals.filter(r => !(r.log_date === today() && r.ritual === slug));
  } else {
    const row = { user_id: S.user.id, log_date: today(), ritual: slug };
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
  if (S.open) {
    const item = items.find(i => i.slug === S.open);
    if (item) {
      view.innerHTML = readerView(item);
      $("back").onclick = () => go("rituals");
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
    if (item) { view.innerHTML = readerView(item); $("back").onclick = () => go("learn"); return; }
  }
  const videos = items.filter(i => i.kind === "video"), articles = items.filter(i => i.kind === "article");
  const card = i => `<button class="card r-card" data-open="${esc(i.slug)}"><h4>${i.kind === "video" ? "▶ " : ""}${esc(i.title)}</h4><p class="muted" style="font-size:.9rem">${esc(i.summary)}</p><p class="meta">${i.kind === "video" ? "Video" : `${i.minutes || 3} min read`}</p></button>`;
  view.innerHTML = `<h2>Learn</h2><p class="lede">Short reads and videos on sleep, skin and recovery.</p>
    ${videos.length ? `<h3 style="margin:10px 0 12px">Videos</h3><div class="grid3">${videos.map(card).join("")}</div>` : ""}
    ${articles.length ? `<h3 style="margin:22px 0 12px">Articles</h3><div class="grid3">${articles.map(card).join("")}</div>` : (videos.length ? "" : libraryEmpty())}`;
  view.querySelectorAll("[data-open]").forEach(b => b.onclick = () => go("learn", b.dataset.open));
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
  if (!S.member) return renderPaywall();

  const want = location.hash.slice(1);
  scheduleBrowserReminder();
  go(TABS.some(t => t.id === want) ? want : "today");
})();
