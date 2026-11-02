(function () {
  const CFG = window.REJUVA_CONFIG || {};
  const ONBOARD = new URLSearchParams(location.search).has("onboard");
  const CHECKIN = new URLSearchParams(location.search).has("checkin");   // day-21 retake
  const RETAKE = new URLSearchParams(location.search).has("retake");     // member retaking from the Menu

  // ── Questions ─────────────────────────────────────
  // pts = how much this answer adds to the Sleep Aging Score
  const QUESTIONS = [
    { id: "name", type: "text", title: "First, what should we call you?",
      hint: "We'll use it to personalise your results.", placeholder: "Your first name" },

    { id: "age", type: "single", title: "How old are you?", hint: "Skin repair slows with age, so this shapes your plan.",
      options: [
        { v: "18-29", label: "18 – 29", pts: 0 },
        { v: "30-39", label: "30 – 39", pts: 2 },
        { v: "40-49", label: "40 – 49", pts: 4 },
        { v: "50-59", label: "50 – 59", pts: 6 },
        { v: "60+",   label: "60 or older", pts: 8 } ] },

    { id: "hours", type: "single", title: "On a normal night, how much do you actually sleep?",
      hint: "Not time in bed — time asleep.",
      options: [
        { v: "lt5", em: "😵", label: "Less than 5 hours", pts: 30 },
        { v: "5-6", em: "🥱", label: "5 – 6 hours", pts: 22 },
        { v: "6-7", em: "😐", label: "6 – 7 hours", pts: 12 },
        { v: "7-8", em: "😌", label: "7 – 8 hours", pts: 0 },
        { v: "8+",  em: "😴", label: "More than 8 hours", pts: 4 } ] },

    { id: "fall", type: "single", title: "How long does it take you to fall asleep?",
      options: [
        { v: "fast", em: "⚡", label: "Under 15 minutes", pts: 0 },
        { v: "ok",   em: "🙂", label: "15 – 30 minutes", pts: 6 },
        { v: "slow", em: "🌀", label: "30 – 60 minutes", pts: 14 },
        { v: "vslow",em: "😩", label: "Over an hour — my mind won't stop", pts: 20 } ] },

    { id: "wake", type: "single", title: "Do you wake up during the night?",
      options: [
        { v: "never", em: "🌙", label: "Rarely or never", pts: 0 },
        { v: "once",  em: "🚶", label: "Once, then back to sleep", pts: 4 },
        { v: "few",   em: "🔁", label: "2 – 3 times most nights", pts: 10 },
        { v: "lots",  em: "😫", label: "Often, and struggle to fall back asleep", pts: 16 } ] },

    { id: "screens", type: "single", title: "When do you put your phone down at night?",
      options: [
        { v: "bed",  em: "📱", label: "I scroll in bed until I fall asleep", pts: 14 },
        { v: "30",   em: "⏱️", label: "About 30 minutes before bed", pts: 8 },
        { v: "60",   em: "📵", label: "An hour or more before bed", pts: 2 },
        { v: "none", em: "📖", label: "No screens in the evening", pts: 0 } ] },

    { id: "caffeine", type: "single", title: "When's your last coffee, tea, soda or energy drink?",
      options: [
        { v: "am",   em: "☀️", label: "Before noon", pts: 0 },
        { v: "pm1",  em: "🌤️", label: "Early afternoon (12 – 3pm)", pts: 5 },
        { v: "pm2",  em: "🌇", label: "Late afternoon (3 – 6pm)", pts: 10 },
        { v: "eve",  em: "🌃", label: "Evening", pts: 14 },
        { v: "none", em: "🚫", label: "I don't have caffeine", pts: 0 } ] },

    { id: "water", type: "single", title: "How much water do you drink in a day?",
      options: [
        { v: "lt3", em: "🏜️", label: "Less than 3 glasses", pts: 12 },
        { v: "3-5", em: "🥤", label: "3 – 5 glasses", pts: 8 },
        { v: "6-8", em: "💧", label: "6 – 8 glasses", pts: 2 },
        { v: "8+",  em: "🌊", label: "More than 8 glasses", pts: 0 } ] },

    { id: "skin", type: "multi", title: "What do you notice in the mirror most mornings?",
      hint: "Pick all that apply.",
      options: [
        { v: "puffy",  em: "👁️", label: "Puffy, swollen eyes", pts: 4 },
        { v: "dark",   em: "🌑", label: "Dark circles", pts: 4 },
        { v: "dull",   em: "🌫️", label: "Dull, tired skin", pts: 4 },
        { v: "lines",  em: "〰️", label: "Fine lines or sagging", pts: 4 },
        { v: "breakouts", em: "🔴", label: "Breakouts or redness", pts: 3 },
        { v: "none",   em: "✨", label: "None of these", pts: 0, exclusive: true } ] },

    { id: "goal", type: "single", title: "What would you love to change most?",
      options: [
        { v: "glow",   em: "✨", label: "Wake up with glowing, fresh skin" },
        { v: "younger",em: "🕰️", label: "Look younger and less tired" },
        { v: "energy", em: "⚡", label: "Have real energy all day" },
        { v: "asleep", em: "🌙", label: "Fall asleep fast and stay asleep" } ] }
  ];

  // ── Trigger copy for results ──────────────────────
  const TRIGGERS = {
    hours:    { ic: "⏳", title: "You're cutting your repair shift short",
                why: "Most collagen-building happens in deep sleep. Short nights mean less repair and more visible tiredness.",
                fix: "Move bedtime 15 minutes earlier each week until you reach 7–8 hours." },
    fall:     { ic: "🌀", title: "Your brain isn't switching off",
                why: "Lying awake keeps stress hormones up — the same hormones that break down collagen.",
                fix: "A 20-minute wind-down with 4-7-8 breathing and a written 'worry dump'." },
    wake:     { ic: "🔁", title: "Your sleep keeps getting interrupted",
                why: "Every wake-up resets you out of deep sleep, where most skin repair happens.",
                fix: "Cool, dark room (around 65°F / 18°C) and no fluids in the last hour." },
    screens:  { ic: "📱", title: "Late-night scrolling is delaying your sleep",
                why: "Bright screens push back melatonin, and engaging content keeps your brain alert.",
                fix: "Phone charges outside the bedroom. Swap scrolling for a book or skin ritual." },
    caffeine: { ic: "☕", title: "Caffeine is still in your system at bedtime",
                why: "Caffeine lingers for hours, making sleep lighter even when you do drift off.",
                fix: "Last caffeine before noon. Switch afternoons to coconut water or herbal tea." },
    water:    { ic: "💧", title: "Your skin is running dry",
                why: "Low hydration shows up as dullness and more visible lines — sleep can't fix what it doesn't have.",
                fix: "Front-load water in the morning and early afternoon, then taper after 7pm." },
    age:      { ic: "🕰️", title: "Your skin needs more recovery time now",
                why: "Repair naturally slows with age, so every hour of good sleep matters more.",
                fix: "Protect a consistent bedtime — even on weekends." }
  };

  const RITUALS = {
    puffy:     { name: "Ice-water face dip", desc: "30-second ice dips each morning to bring puffiness down fast." },
    dark:      { name: "Cucumber + cold spoon eye reset", desc: "Chilled cucumber slices or cold spoons for 10 minutes under the eyes." },
    dull:      { name: "Morning lymphatic face massage", desc: "A 3-minute massage routine to boost circulation and glow." },
    lines:     { name: "Evening gua sha routine", desc: "Gentle upward strokes to release tension in the jaw, cheeks and forehead." },
    breakouts: { name: "Calm-skin night routine", desc: "Clean pillowcase rotation and a soothing, simple evening cleanse." },
    none:      { name: "Glow maintenance routine", desc: "A light gua sha and hydration routine to keep skin where it is." }
  };

  const GOAL_TEXT = {
    glow: "glowing, fresh skin", younger: "a younger, less tired look",
    energy: "real all-day energy", asleep: "falling asleep fast and staying asleep"
  };

  // ── State ─────────────────────────────────────────
  const app = document.getElementById("app");
  const bar = document.getElementById("progress");
  const stepCount = document.getElementById("stepCount");
  const answers = {};
  let step = 0;
  // Onboarding (logged in, after confirming email): name is already on the account
  if (ONBOARD && QUESTIONS[0].id === "name") QUESTIONS.shift();

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function render() {
    const q = QUESTIONS[step];
    bar.style.width = Math.round((step / QUESTIONS.length) * 100) + "%";
    stepCount.textContent = `Question ${step + 1} of ${QUESTIONS.length}`;
    let html = `<div class="q"><h2>${q.title}</h2>${q.hint ? `<p class="hint">${q.hint}</p>` : '<div style="height:18px"></div>'}`;

    if (q.type === "text") {
      html += `<input class="text-in" id="textIn" type="text" maxlength="40" autocomplete="given-name" placeholder="${q.placeholder}" value="${esc(answers[q.id] || "")}">`;
      html += actions(true);
    } else {
      const sel = answers[q.id];
      html += `<div class="opts ${q.type === "multi" ? "multi" : ""}">` + q.options.map((o, i) => {
        const on = q.type === "multi" ? (sel || []).includes(o.v) : sel === o.v;
        return `<button type="button" class="opt ${on ? "sel" : ""}" data-i="${i}">${o.em ? `<span class="em">${o.em}</span>` : ""}<span>${o.label}</span></button>`;
      }).join("") + `</div>`;
      html += actions(q.type === "multi");
    }
    app.innerHTML = html + `</div>`;
    bind(q);
  }

  function actions(showNext) {
    return `<div class="q-actions">${step > 0 ? `<button class="back" id="backBtn">← Back</button>` : "<span></span>"}${showNext ? `<button class="btn btn-gold" id="nextBtn">Continue</button>` : ""}</div>`;
  }

  function bind(q) {
    const back = document.getElementById("backBtn");
    if (back) back.onclick = () => { step--; render(); };
    const next = document.getElementById("nextBtn");

    if (q.type === "text") {
      const input = document.getElementById("textIn");
      input.focus();
      const go = () => { answers[q.id] = input.value.trim(); advance(); };
      next.onclick = go;
      input.onkeydown = e => { if (e.key === "Enter") go(); };
      return;
    }

    app.querySelectorAll(".opt").forEach(btn => {
      btn.onclick = () => {
        const o = q.options[+btn.dataset.i];
        if (q.type === "single") {
          answers[q.id] = o.v;
          app.querySelectorAll(".opt").forEach(b => b.classList.remove("sel"));
          btn.classList.add("sel");
          setTimeout(advance, 220);
        } else {
          let cur = answers[q.id] || [];
          if (o.exclusive) cur = cur.includes(o.v) ? [] : [o.v];
          else {
            cur = cur.filter(v => !q.options.find(x => x.v === v).exclusive);
            cur = cur.includes(o.v) ? cur.filter(v => v !== o.v) : [...cur, o.v];
          }
          answers[q.id] = cur;
          render();
        }
      };
    });

    if (next) next.onclick = () => {
      if (!(answers[q.id] || []).length) { next.textContent = "Pick at least one"; return; }
      advance();
    };
  }

  function advance() {
    if (step < QUESTIONS.length - 1) { step++; render(); window.scrollTo(0, 0); }
    else analyze();
  }

  // ── Scoring ───────────────────────────────────────
  function points(id) {
    const q = QUESTIONS.find(x => x.id === id);
    const a = answers[id];
    if (!q || !q.options || a == null) return 0;
    if (Array.isArray(a)) return a.reduce((s, v) => s + (q.options.find(o => o.v === v)?.pts || 0), 0);
    return q.options.find(o => o.v === a)?.pts || 0;
  }

  function compute() {
    const ids = ["age", "hours", "fall", "wake", "screens", "caffeine", "water", "skin"];
    const raw = ids.reduce((s, id) => s + points(id), 0);
    const score = Math.min(100, Math.round((raw / 110) * 100));
    let level;
    if (score <= 30) level = { name: "Low impact", color: "#0a8f8f", bg: "#e6fff8",
      line: "Your habits are mostly working for you. A few tweaks will keep your skin ahead of the clock." };
    else if (score <= 55) level = { name: "Moderate impact", color: "#b7791f", bg: "#fff3cd",
      line: "Some of your nightly habits are starting to show. Catch them now and they're easy to turn around." };
    else if (score <= 75) level = { name: "High impact", color: "#d9480f", bg: "#fff0e6",
      line: "Your sleep habits are likely adding visible tiredness and aging to your face. The good news: these are fixable." };
    else level = { name: "Severe impact", color: "#c92a2a", bg: "#ffe0e0",
      line: "Your nights are working against your skin almost every day. This is exactly who the 21-day reset was built for." };

    const triggers = Object.keys(TRIGGERS)
      .map(id => ({ id, pts: points(id) }))
      .filter(t => t.pts >= (t.id === "age" ? 6 : 5))
      .sort((a, b) => b.pts - a.pts)
      .slice(0, 3)
      .map(t => TRIGGERS[t.id]);

    const skin = (answers.skin || ["none"]);
    const ritual = RITUALS[skin[0]] || RITUALS.none;
    const waterTarget = { "lt3": "Build to 6 glasses", "3-5": "Build to 8 glasses", "6-8": "Hold at 8 glasses", "8+": "Keep it up — taper after 7pm" }[answers.water] || "8 glasses";

    return { score, level, triggers, ritual, waterTarget };
  }

  // ── Analyzing + results ───────────────────────────
  function analyze() {
    bar.style.width = "100%";
    stepCount.textContent = "Analysing";
    app.innerHTML = `<div class="analyzing"><div class="spinner"></div><h2 style="color:#fff;margin-bottom:10px">Building your results…</h2><p id="aStep">Checking your sleep timing</p></div>`;
    const msgs = ["Checking your sleep timing", "Matching habits to skin signs", "Picking your face rituals", "Drafting your 21-day plan"];
    let i = 0;
    const t = setInterval(() => { i++; const el = document.getElementById("aStep"); if (el && msgs[i]) el.textContent = msgs[i]; }, 650);
    setTimeout(() => { clearInterval(t); showResults(); }, 2700);
  }

  function showResults() {
    const r = compute();
    const name = answers.name ? esc(answers.name) : "";
    try { localStorage.setItem("rejuva_quiz", JSON.stringify({ answers, score: r.score, at: Date.now() })); } catch (e) {}

    document.getElementById("progressWrap").style.display = "none";
    stepCount.textContent = "Your results";

    const C = 2 * Math.PI * 64;
    const off = C * (1 - r.score / 100);
    const triggersHtml = r.triggers.length
      ? r.triggers.map(t => `<div class="trigger"><div class="ic">${t.ic}</div><div><h4>${t.title}</h4><p>${t.why}</p><p class="fix">Fix: ${t.fix}</p></div></div>`).join("")
      : `<p style="color:var(--muted)">No major triggers — your plan will focus on maintaining your results and boosting glow.</p>`;

    // Logged-in members finishing onboarding go straight to payment.
    // Visitors who took the quiz from the landing page create their account first.
    const link = CFG.paypalLink || "";
    const buyAttrs = ONBOARD
      ? `href="app.html" id="payBtn"`
      : `href="login.html"`;
    const buyLabel = ONBOARD ? `Unlock my plan · ${esc(CFG.price || "")}` : "Create my account";
    const buyNote = ONBOARD
      ? "Secure checkout with PayPal or card on the next screen. Your plan unlocks the moment you pay."
      : "Next: create your account, confirm your email, then unlock your plan.";

    app.innerHTML = `
      <div class="result-card">
        <div class="score-wrap">
          <div class="gauge">
            <svg width="150" height="150" viewBox="0 0 150 150" aria-hidden="true">
              <circle cx="75" cy="75" r="64" fill="none" stroke="#efedf7" stroke-width="14"/>
              <circle cx="75" cy="75" r="64" fill="none" stroke="${r.level.color}" stroke-width="14" stroke-linecap="round"
                stroke-dasharray="${C}" stroke-dashoffset="${C}" id="gaugeArc" style="transition:stroke-dashoffset 1.2s ease"/>
            </svg>
            <div class="num"><b>${r.score}</b><small>out of 100</small></div>
          </div>
          <div style="flex:1;min-width:220px">
            <span class="badge" style="background:${r.level.bg};color:${r.level.color}">${r.level.name}</span>
            <h2 style="font-size:1.7rem;margin-bottom:8px">${name ? name + ", your" : "Your"} Sleep Aging Score</h2>
            <p style="color:var(--muted)">${r.level.line}</p>
          </div>
        </div>
      </div>

      <div class="result-card">
        <h3 style="font-size:1.4rem;margin-bottom:6px">Your top aging triggers</h3>
        <p style="color:var(--muted);margin-bottom:8px">The habits most likely showing up on your face right now.</p>
        ${triggersHtml}
      </div>

      <div class="result-card">
        <h3 style="font-size:1.4rem;margin-bottom:4px">A sneak peek at your plan</h3>
        <p style="color:var(--muted)">Built around your goal: ${GOAL_TEXT[answers.goal] || "better sleep"}.</p>
        <div class="plan-preview">
          <div><b>Your face ritual</b><p><strong>${r.ritual.name}.</strong> ${r.ritual.desc}</p></div>
          <div><b>Your water target</b><p>${r.waterTarget}, plus coconut water on active days.</p></div>
          <div><b>Week 1 focus</b><p>${r.triggers[0] ? r.triggers[0].fix : "Lock in a consistent bedtime and wake time."}</p></div>
        </div>
      </div>

      <div class="result-card offer">
        <h3 style="font-size:1.6rem;margin-bottom:6px">Unlock your full RejuvaSleep plan</h3>
        <p style="color:var(--muted)">Everything above, fully built out — plus the tools to stick with it.</p>
        <ul>
          <li>Your personal 21-day sleep reset, built from your answers</li>
          <li>Sleep tracker with wind-down reminders</li>
          <li>Daily water + coconut-water plan</li>
          <li>Step-by-step face rituals: ice dipping, gua sha, cucumber, massage</li>
          <li>Video &amp; article library</li>
          <li>Weekly tips based on your progress</li>
          <li>The Deep Sleep Blueprint PDF guide (20 pages)</li>
        </ul>
        <div class="price"><s>${esc(CFG.comparePrice || "")}</s>${esc(CFG.price || "")}</div>
        <p style="color:var(--muted);font-size:.88rem;margin:6px 0 20px">${esc(CFG.priceNote || "")}</p>
        <a class="btn btn-gold" style="width:100%" ${buyAttrs}>${buyLabel}</a>
        <p style="text-align:center;font-size:.82rem;color:var(--muted);margin-top:12px">${buyNote}</p>
        
      </div>

      <p class="disclaimer">Your score is a habits-based estimate for education, not a medical assessment. Talk to a doctor about ongoing sleep problems.</p>`;

    requestAnimationFrame(() => setTimeout(() => {
      const arc = document.getElementById("gaugeArc"); if (arc) arc.style.strokeDashoffset = off;
    }, 60));

    const nl = document.getElementById("noLink");
    if (nl) nl.onclick = e => { e.preventDefault(); nl.textContent = "Checkout opens soon"; };
    window.scrollTo(0, 0);

    if (CHECKIN || RETAKE) {
      // Members retaking the quiz: no offer, just head back into the app
      const offer = app.querySelector(".offer");
      if (offer) offer.outerHTML = `<div class="result-card" style="text-align:center"><h3 style="font-size:1.5rem;margin-bottom:8px">Nice — your new score is saved</h3>
        <p style="color:var(--muted);margin-bottom:18px">${CHECKIN ? "Let's compare it with day 1 and plan what's next." : "Your plan and daily routine now use your new answers."}</p>
        <a class="btn btn-gold" style="width:100%" href="${CHECKIN ? "app.html#checkin" : "app.html"}" id="payBtn">${CHECKIN ? "See my progress" : "Back to my plan"}</a></div>`;
    }
    if (ONBOARD) saveToAccount(r.score);
  }

  // Save answers to the logged-in user's profile so their plan is built from them
  async function saveToAccount(score) {
    const pay = document.getElementById("payBtn");
    if (pay) pay.style.pointerEvents = "none";
    try {
      const { sb } = await import("./supa.js");
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { location.replace("login.html?mode=login"); return; }
      // Keep the previous score so the check-in can show before → after
      const { data: cur } = await sb.from("profiles").select("quiz_score").eq("id", session.user.id).maybeSingle();
      const upd = { quiz: answers, quiz_score: score };
      if (cur && cur.quiz_score != null) upd.prev_quiz_score = cur.quiz_score;
      const { error } = await sb.from("profiles").update(upd).eq("id", session.user.id);
      if (error) console.error(error);
    } catch (e) { console.error(e); }
    finally { if (pay) pay.style.pointerEvents = ""; }
  }

  render();
})();
