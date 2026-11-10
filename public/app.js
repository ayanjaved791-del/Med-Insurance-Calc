/* MediCost: medical insurance cost predictor, running fully in the browser. */
(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const REGIONS = ["northeast", "northwest", "southeast", "southwest"];
  const DEFAULTS = { age: 30, sex: 0, bmi: 24, children: 0, smoker: 0, region: "northeast", model: "enhanced" };
  const LIMITS = { age: [18, 64], bmi: [15, 53], children: [0, 5] };

  const usd = (n, d = 0) => (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
  const usdK = (n) => (Math.abs(n) >= 1000 ? "$" + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : usd(n));
  const signed = (n) => (n >= 0 ? "+" : "−") + usd(Math.abs(n));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const quantile = (sorted, q) => { if (!sorted.length) return 0; const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); };
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let MODEL, ROWS, SORTED_CHARGES, REF = {};
  const state = { ...DEFAULTS };
  const charts = {};

  /* ---------- Model ---------- */
  function features(p) {
    const obese = p.bmi >= 30 ? 1 : 0;
    return {
      age: p.age, sex: p.sex, bmi: p.bmi, children: p.children, smoker: p.smoker,
      region_northwest: p.region === "northwest" ? 1 : 0,
      region_southeast: p.region === "southeast" ? 1 : 0,
      region_southwest: p.region === "southwest" ? 1 : 0,
      age_sq: p.age * p.age, obese, smoker_obese: p.smoker * obese, smoker_bmi: p.smoker * p.bmi,
    };
  }
  function predictRaw(p, name = state.model) {
    const m = MODEL.models[name], f = features(p);
    let y = m.intercept;
    for (const k in m.coef) y += m.coef[k] * f[k];
    return y;
  }
  const predict = (p, name) => Math.max(0, predictRaw(p, name));

  const GROUPS = {
    Age: ["age", "age_sq"], BMI: ["bmi", "obese"], Smoking: ["smoker", "smoker_obese", "smoker_bmi"],
    Children: ["children"], Gender: ["sex"], Region: ["region_northwest", "region_southeast", "region_southwest"],
  };
  // Linear model => prediction - average prediction splits exactly into per-group parts.
  function contributions(p, name = state.model) {
    const m = MODEL.models[name], f = features(p), out = [];
    for (const [g, keys] of Object.entries(GROUPS)) {
      let d = 0;
      for (const k of keys) if (k in m.coef) d += m.coef[k] * (f[k] - REF[k]);
      out.push({ name: g, value: d });
    }
    return out;
  }
  function refPrediction(name = state.model) {
    const m = MODEL.models[name];
    let y = m.intercept;
    for (const k in m.coef) y += m.coef[k] * REF[k];
    return y;
  }

  /* ---------- Form state & URL ---------- */
  function readUrl() {
    const q = new URLSearchParams(location.hash.slice(1));
    if (!q.has("age")) return;
    const n = (k) => Number(q.get(k));
    if (q.has("age")) state.age = clamp(Math.round(n("age")) || DEFAULTS.age, ...LIMITS.age);
    if (q.has("bmi")) state.bmi = clamp(n("bmi") || DEFAULTS.bmi, ...LIMITS.bmi);
    if (q.has("children")) state.children = clamp(Math.round(n("children")) || 0, ...LIMITS.children);
    if (q.has("sex")) state.sex = n("sex") ? 1 : 0;
    if (q.has("smoker")) state.smoker = n("smoker") ? 1 : 0;
    if (REGIONS.includes(q.get("region"))) state.region = q.get("region");
    if (["enhanced", "baseline"].includes(q.get("model"))) state.model = q.get("model");
  }
  const shareUrl = () => {
    const q = new URLSearchParams({ age: state.age, sex: state.sex, bmi: state.bmi.toFixed(1), children: state.children, smoker: state.smoker, region: state.region, model: state.model });
    return location.origin + location.pathname + "#" + q.toString();
  };

  function setRangeFill(el) {
    const p = ((el.value - el.min) / (el.max - el.min)) * 100;
    el.style.setProperty("--p", p + "%");
  }
  function bmiCategory(b) {
    if (b < 18.5) return ["Underweight", "under"];
    if (b < 25) return ["Healthy", ""];
    if (b < 30) return ["Overweight", "over"];
    return ["Obese", "obese"];
  }

  function syncForm() {
    $("#age").value = state.age; $("#ageNum").value = state.age;
    $("#bmi").value = state.bmi; $("#bmiNum").value = (+state.bmi).toFixed(1);
    setRangeFill($("#age")); setRangeFill($("#bmi"));
    const [label, cls] = bmiCategory(state.bmi);
    const tag = $("#bmiTag"); tag.textContent = label; tag.className = "bmi-tag " + cls;
    $("#kidsOut").textContent = state.children;
    $("#kidsMinus").disabled = state.children <= 0;
    $("#kidsPlus").disabled = state.children >= 5;
    for (const g of $$("#form [data-name]")) {
      const v = String(state[g.dataset.name]);
      if (!(g.dataset.name in state)) continue;
      for (const b of $$("button", g)) b.setAttribute("aria-checked", String(b.dataset.value === v));
    }
  }

  function bindForm() {
    const age = $("#age"), ageNum = $("#ageNum"), bmi = $("#bmi"), bmiNum = $("#bmiNum");
    age.addEventListener("input", () => { state.age = +age.value; update(); });
    bmi.addEventListener("input", () => { state.bmi = +bmi.value; update(); });
    ageNum.addEventListener("change", () => { state.age = clamp(Math.round(+ageNum.value) || DEFAULTS.age, ...LIMITS.age); update(); });
    bmiNum.addEventListener("change", () => { state.bmi = clamp(+bmiNum.value || DEFAULTS.bmi, ...LIMITS.bmi); update(); });
    $("#kidsMinus").addEventListener("click", () => { state.children = Math.max(0, state.children - 1); update(); });
    $("#kidsPlus").addEventListener("click", () => { state.children = Math.min(5, state.children + 1); update(); });

    for (const g of $$("#form [data-name]")) {
      const name = g.dataset.name;
      if (!(name in state)) continue;
      g.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-value]"); if (!b) return;
        const v = b.dataset.value;
        state[name] = name === "region" || name === "model" ? v : +v;
        update();
      });
      radioKeys(g);
    }

    $("#resetBtn").addEventListener("click", () => { Object.assign(state, DEFAULTS); update(); toast("Form reset"); });
    $("#randomBtn").addEventListener("click", () => {
      const r = ROWS[Math.floor(Math.random() * ROWS.length)];
      Object.assign(state, { age: r.age, sex: r.sex, bmi: r.bmi, children: r.children, smoker: r.smoker, region: r.region });
      update(); toast(`Loaded a real person from the data (they paid ${usd(r.charges)})`);
    });
    bindBmiCalc();
  }

  // Arrow-key support for the custom radio groups.
  function radioKeys(g) {
    g.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
      const btns = $$("button[data-value]", g), i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const n = btns[(i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + btns.length) % btns.length];
      n.focus(); n.click();
    });
  }

  function bindBmiCalc() {
    const units = $('[data-name="units"]');
    let mode = "metric";
    const setMode = (m) => {
      mode = m;
      for (const b of $$("button", units)) b.setAttribute("aria-checked", String(b.dataset.value === m));
      $("#calcMetric").hidden = m !== "metric"; $("#calcImperial").hidden = m !== "imperial";
      calc();
    };
    units.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setMode(b.dataset.value); });
    radioKeys(units);
    const calc = () => {
      let h, w;
      if (mode === "metric") { h = +$("#hCm").value / 100; w = +$("#wKg").value; }
      else { h = ((+$("#hFt").value || 0) * 12 + (+$("#hIn").value || 0)) * 0.0254; w = +$("#wLb").value * 0.453592; }
      if (!(h > 1 && w > 20)) { $("#calcOut").textContent = "Enter your height and weight to fill in your BMI."; return; }
      const b = w / (h * h);
      if (b < 10 || b > 80) { $("#calcOut").textContent = "Those numbers look off. Please check them."; return; }
      state.bmi = clamp(Math.round(b * 10) / 10, ...LIMITS.bmi);
      $("#calcOut").innerHTML = `Your BMI is <b>${b.toFixed(1)}</b> (${bmiCategory(b)[0].toLowerCase()})${b > LIMITS.bmi[1] || b < LIMITS.bmi[0] ? `, capped at ${state.bmi} for the model` : ""}. Applied above.`;
      update();
    };
    for (const id of ["hCm", "wKg", "hFt", "hIn", "wLb"]) $("#" + id).addEventListener("input", calc);
    setMode("metric");
  }

  /* ---------- Rendering the result ---------- */
  function tween(el, to, fmt = usd) {
    const from = +el.dataset.v || 0;
    el.dataset.v = to;
    if (reduceMotion) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 550;
    cancelAnimationFrame(el._raf);
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }

  function tierOf(v) {
    if (v < 7000) return ["Low cost", ""];
    if (v < 15000) return ["Moderate", "moderate"];
    if (v < 30000) return ["High", "high"];
    return ["Very high", "very-high"];
  }

  let urlTimer;
  function update() {
    syncForm();
    const pred = predict(state), m = MODEL.models[state.model];
    tween($("#resAmount"), pred);
    $("#resMonthly").textContent = `≈ ${usd(pred / 12)} / month`;
    const lo = Math.max(0, pred + m.residualBand.low), hi = pred + m.residualBand.high;
    $("#resRange").textContent = `likely ${usd(lo)} – ${usd(hi)}`;
    const [tl, tc] = tierOf(pred);
    const tier = $("#tier"); tier.textContent = tl; tier.className = "tier " + tc;

    // Percentile vs dataset, on a log scale so the bar is readable across $1k–$64k.
    const below = lowerBound(SORTED_CHARGES, pred);
    const pct = Math.round((below / SORTED_CHARGES.length) * 100);
    $("#pctText").textContent = pct >= 99 ? "Top 1% most expensive" : pct <= 1 ? "Among the cheapest 1%" : `${ordinal(pct)} percentile`;
    const lmin = Math.log(1000), lmax = Math.log(64000), pos = (v) => clamp((Math.log(Math.max(v, 1000)) - lmin) / (lmax - lmin), 0, 1) * 100;
    $("#pctFill").style.width = pos(pred) + "%";
    const mean = MODEL.meanCharge;
    $("#avgMarker").style.left = pos(mean) + "%";

    renderWaterfall(pred);
    renderTips(pred);
    renderPeers(pred);
    if (!$('[data-panel="age"]').hidden) renderAgeChart();

    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => history.replaceState(null, "", shareUrl()), 250);
  }

  function lowerBound(arr, v) { let lo = 0, hi = arr.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; } return lo; }

  function renderWaterfall(pred) {
    const base = refPrediction(), parts = contributions(state);
    $("#baseAvg").textContent = usd(base);
    const maxAbs = Math.max(4000, ...parts.map((p) => Math.abs(p.value)));
    const html = parts.map((p) => {
      const w = (Math.abs(p.value) / maxAbs) * 50, dir = p.value >= 0 ? "up" : "down";
      const left = p.value >= 0 ? 50 : 50 - w;
      const label = p.name === "Smoking" && state.smoker && state.model === "enhanced" ? "Smoking × BMI" : p.name;
      return `<div class="wf-row"><span class="name">${label}</span>
        <div class="wf-track"><span class="wf-zero" style="left:50%"></span><span class="wf-bar ${dir}" style="left:${left}%;width:${Math.max(w, .4)}%"></span></div>
        <span class="val ${Math.abs(p.value) < 50 ? "" : dir}">${Math.abs(p.value) < 50 ? "≈ $0" : signed(p.value)}</span></div>`;
    }).join("");
    $("#waterfall").innerHTML = html + `<div class="wf-total"><span>Your estimate</span><span>${usd(pred)}</span></div>`;
  }

  function renderTips(pred) {
    const tips = [];
    const add = (icon, title, text, delta, bad = false) => tips.push({ icon, title, text, delta, bad });
    if (state.smoker) {
      const d = pred - predict({ ...state, smoker: 0 });
      add("🚭", "Quit smoking", "This is the biggest change you can make. Insurers usually reprice you after 12 months smoke-free.", d);
    }
    if (state.bmi >= 30) {
      const d = pred - predict({ ...state, bmi: 29.9 });
      add("🏃", "Get your BMI below 30", `From ${state.bmi.toFixed(1)} to 29.9${state.smoker ? ". For smokers, this removes the large obesity surcharge" : ""}.`, d);
    }
    if (state.bmi >= 25) {
      const d = pred - predict({ ...state, bmi: 24.9 });
      if (d > 50) add("🥗", "Reach a healthy BMI", `From ${state.bmi.toFixed(1)} to 24.9.`, d);
    }
    if (state.region !== "southwest" && state.region !== "southeast") {
      const best = REGIONS.map((r) => [r, predict({ ...state, region: r })]).sort((a, b) => a[1] - b[1])[0];
      const d = pred - best[1];
      if (d > 50) add("📍", `Living in the ${cap(best[0])}`, "Prices vary slightly by region.", d);
    }
    if (state.age < 64) {
      const later = Math.min(64, state.age + 10);
      const d = predict({ ...state, age: later }) - pred;
      add("⏳", `At age ${later}`, "Expected rise from aging alone. Locking in a plan early can help.", d, true);
    }
    if (!state.smoker) {
      const d = predict({ ...state, smoker: 1 }) - pred;
      add("🚬", "If you started smoking", "The extra yearly cost the model expects.", d, true);
    }
    const goods = tips.filter((t) => !t.bad).sort((a, b) => b.delta - a.delta), bads = tips.filter((t) => t.bad);
    const head = goods.length ? "" : `<div class="empty"><b>You're already in great shape 🎉</b>No big savings available. Your main cost drivers are things you can't change, like age.</div>`;
    $("#tips").innerHTML = head + [...goods, ...bads].map((t) => `
      <div class="tip"><span class="tip-ico ${t.bad ? "bad" : ""}" aria-hidden="true">${t.icon}</span>
        <div><h4>${t.title}</h4><p>${t.text}</p></div>
        <div class="amt ${t.bad ? "bad" : ""}">${t.bad ? "+" : "−"}${usd(Math.abs(t.delta))}<small>per year</small></div></div>`).join("");
  }

  function renderPeers(pred) {
    let ageW = 5, bmiW = 4, peers = [];
    while (peers.length < 8 && ageW < 30) {
      peers = ROWS.filter((r) => r.smoker === state.smoker && Math.abs(r.age - state.age) <= ageW && Math.abs(r.bmi - state.bmi) <= bmiW);
      ageW += 3; bmiW += 2;
    }
    if (!peers.length) { $("#peers").innerHTML = `<div class="empty">No similar people in the data.</div>`; return; }
    const c = peers.map((r) => r.charges).sort((a, b) => a - b);
    const med = quantile(c, .5);
    const near = peers.map((r) => ({ r, d: Math.abs(r.age - state.age) / 5 + Math.abs(r.bmi - state.bmi) / 4 + (r.children !== state.children) * .3 + (r.region !== state.region) * .3 })).sort((a, b) => a.d - b.d).slice(0, 5);
    $("#peers").innerHTML = `
      <p class="muted small">${peers.length} real ${state.smoker ? "smokers" : "non-smokers"} aged ${Math.max(18, state.age - ageW + 3)}–${Math.min(64, state.age + ageW - 3)} with a BMI near ${state.bmi.toFixed(1)}:</p>
      <div class="peer-stats">
        <div><b>${usd(med)}</b><span>Median paid</span></div>
        <div><b>${usdK(quantile(c, .25))}–${usdK(quantile(c, .75))}</b><span>Middle 50%</span></div>
        <div><b class="${pred > med ? "" : "best"}">${pred > med ? "+" : "−"}${usd(Math.abs(pred - med))}</b><span>Your estimate vs median</span></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Age</th><th>Gender</th><th class="num">BMI</th><th class="num">Kids</th><th>Region</th><th class="num">Paid</th></tr></thead><tbody>
      ${near.map(({ r }) => `<tr><td>${r.age}</td><td>${r.sex ? "F" : "M"}</td><td class="num">${r.bmi.toFixed(1)}</td><td class="num">${r.children}</td><td>${cap(r.region)}</td><td class="num">${usd(r.charges)}</td></tr>`).join("")}
      </tbody></table></div>`;
  }

  /* ---------- Tabs ---------- */
  function bindTabs() {
    const tabs = $$(".tabs [role=tab]");
    tabs.forEach((t) => t.addEventListener("click", () => {
      tabs.forEach((x) => x.setAttribute("aria-selected", String(x === t)));
      $$(".tab-panel").forEach((p) => (p.hidden = p.dataset.panel !== t.dataset.tab));
      if (t.dataset.tab === "age") renderAgeChart();
    }));
  }

  /* ---------- Charts ---------- */
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  function chartDefaults() {
    if (!window.Chart) return false;
    Chart.defaults.font.family = "Inter, system-ui, sans-serif";
    Chart.defaults.color = css("--muted");
    Chart.defaults.borderColor = css("--line");
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.plugins.tooltip.backgroundColor = css("--text");
    Chart.defaults.plugins.tooltip.titleColor = css("--bg");
    Chart.defaults.plugins.tooltip.bodyColor = css("--bg");
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.animation.duration = reduceMotion ? 0 : 700;
    return true;
  }
  const alpha = (hex, a) => { const c = hex.replace("#", ""); const n = parseInt(c.length === 3 ? c.split("").map((x) => x + x).join("") : c, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  const moneyAxis = (title) => ({ title: { display: !!title, text: title }, ticks: { callback: (v) => usdK(v) }, grid: { color: alpha(css("--line") || "#e2e8e6", .7) } });
  function make(id, cfg) { if (charts[id]) charts[id].destroy(); const el = document.getElementById(id); if (!el) return; charts[id] = new Chart(el, cfg); }

  function renderAgeChart() {
    if (!window.Chart) return;
    const ages = Array.from({ length: 47 }, (_, i) => 18 + i);
    const mine = ages.map((a) => predict({ ...state, age: a }));
    const other = ages.map((a) => predict({ ...state, age: a, smoker: state.smoker ? 0 : 1 }));
    const A = css("--chart-a"), B = css("--chart-b");
    const meColor = state.smoker ? B : A, otherColor = state.smoker ? A : B;
    make("ageChart", {
      type: "line",
      data: { labels: ages, datasets: [
        { label: "You", data: mine, borderColor: meColor, backgroundColor: alpha(meColor, .12), fill: true, tension: .35, borderWidth: 3,
          pointRadius: ages.map((a) => (a === state.age ? 6 : 0)), pointBackgroundColor: meColor, pointBorderColor: "#fff", pointBorderWidth: 2 },
        { label: state.smoker ? "If you didn't smoke" : "If you smoked", data: other, borderColor: otherColor, borderDash: [6, 5], borderWidth: 2, pointRadius: 0, tension: .35 },
      ] },
      options: {
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { display: true, labels: { boxWidth: 12, usePointStyle: true } }, tooltip: { callbacks: { title: (i) => "Age " + i[0].label, label: (c) => `${c.dataset.label}: ${usd(c.parsed.y)}` } } },
        scales: { x: { title: { display: true, text: "Age" }, ticks: { maxTicksLimit: 10 }, grid: { display: false } }, y: moneyAxis() },
      },
    });
  }

  function renderInsightCharts() {
    if (!window.Chart) return;
    const A = css("--chart-a"), B = css("--chart-b");
    const pts = (smk, key) => ROWS.filter((r) => r.smoker === smk).map((r) => ({ x: r[key], y: r.charges, r }));
    const scatterCfg = (key, label) => ({
      type: "scatter",
      data: { datasets: [
        { label: "Non-smoker", data: pts(0, key), backgroundColor: alpha(A, .45), pointRadius: 3, pointHoverRadius: 6 },
        { label: "Smoker", data: pts(1, key), backgroundColor: alpha(B, .55), pointRadius: 3, pointHoverRadius: 6 },
      ] },
      options: {
        plugins: { tooltip: { callbacks: { label: (c) => { const r = c.raw.r; return `${c.dataset.label}, ${r.age}y, BMI ${r.bmi.toFixed(1)}: ${usd(r.charges)}`; } } } },
        scales: { x: { title: { display: true, text: label }, grid: { display: false } }, y: moneyAxis() },
      },
    });
    make("ageScatter", scatterCfg("age", "Age"));
    make("bmiScatter", scatterCfg("bmi", "BMI"));

    const avgBy = (key, vals) => vals.map((v) => { const s = ROWS.filter((r) => r[key] === v); return s.reduce((a, r) => a + r.charges, 0) / s.length; });
    const barCfg = (labels, data, color) => ({
      type: "bar",
      data: { labels, datasets: [{ data, backgroundColor: alpha(color, .8), hoverBackgroundColor: color, borderRadius: 8, maxBarThickness: 56 }] },
      options: { plugins: { tooltip: { callbacks: { label: (c) => "Average " + usd(c.parsed.y) } } }, scales: { x: { grid: { display: false } }, y: moneyAxis() } },
    });
    make("regionBar", barCfg(REGIONS.map(cap), avgBy("region", REGIONS), A));
    make("kidsBar", barCfg(["0", "1", "2", "3", "4", "5"], avgBy("children", [0, 1, 2, 3, 4, 5]), css("--accent") || "#6366f1"));

    renderAvp(currentAvp);
    const labels = { smoker: "Smoker", age: "Age", bmi: "BMI", children: "Children", sex: "Female", region_southeast: "Southeast", region_northwest: "Northwest", region_southwest: "Southwest" };
    const corr = Object.entries(MODEL.correlation).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    make("corrChart", {
      type: "bar",
      data: { labels: corr.map(([k]) => labels[k] || k), datasets: [{ data: corr.map(([, v]) => v), backgroundColor: corr.map(([, v]) => alpha(v >= 0 ? B : A, .8)), borderRadius: 6 }] },
      options: { indexAxis: "y", plugins: { tooltip: { callbacks: { label: (c) => "r = " + c.parsed.x.toFixed(3) } } }, scales: { x: { min: -0.2, max: 1, grid: { color: alpha(css("--line") || "#e2e8e6", .7) } }, y: { grid: { display: false } } } },
    });
  }

  let currentAvp = "enhanced";
  function renderAvp(name) {
    if (!window.Chart) return;
    currentAvp = name;
    const pairs = MODEL.models[name].testPairs, A = css("--chart-a");
    const max = Math.ceil(Math.max(...pairs.flat()) / 10000) * 10000;
    make("avpChart", {
      type: "scatter",
      data: { datasets: [
        { label: "Prediction", data: pairs.map(([a, p]) => ({ x: a, y: p })), backgroundColor: alpha(name === "enhanced" ? A : css("--accent") || "#6366f1", .55), pointRadius: 3.5 },
        { type: "line", label: "Perfect", data: [{ x: 0, y: 0 }, { x: max, y: max }], borderColor: css("--muted"), borderDash: [6, 6], borderWidth: 1.5, pointRadius: 0 },
      ] },
      options: {
        plugins: { tooltip: { filter: (i) => i.datasetIndex === 0, callbacks: { label: (c) => `Actual ${usd(c.parsed.x)} · Predicted ${usd(c.parsed.y)}` } } },
        scales: { x: { ...moneyAxis("Actual"), min: 0, max }, y: { ...moneyAxis("Predicted"), min: Math.min(0, ...pairs.map((p) => p[1])), max } },
      },
    });
  }

  /* ---------- Static sections ---------- */
  function renderKpis() {
    const avg = (rs) => rs.reduce((a, r) => a + r.charges, 0) / rs.length;
    const smk = ROWS.filter((r) => r.smoker), non = ROWS.filter((r) => !r.smoker);
    const so = smk.filter((r) => r.bmi >= 30), sn = smk.filter((r) => r.bmi < 30);
    const k = [
      ["Average yearly cost", usd(avg(ROWS)), `Median ${usd(quantile(SORTED_CHARGES, .5))}`, ""],
      ["Non-smokers pay", usd(avg(non)), `${non.length} people`, "good"],
      ["Smokers pay", usd(avg(smk)), `${(avg(smk) / avg(non)).toFixed(1)}× non-smokers`, "danger"],
      ["Obese smokers pay", usd(avg(so)), `${usd(avg(so) - avg(sn))} more than other smokers`, "danger"],
    ];
    $("#kpis").innerHTML = k.map(([a, b, c, cls]) => `<div class="card kpi ${cls} reveal"><span>${a}</span><b>${b}</b><small>${c}</small></div>`).join("");
  }

  function renderModelCards() {
    const b = MODEL.models.baseline.metrics, e = MODEL.models.enhanced.metrics;
    const pc = (x, y) => Math.round((1 - y / x) * 100);
    $("#mcBaseline").innerHTML = `<h3>Original model</h3><p class="desc">Plain multiple linear regression on the 8 raw features. Treats each factor separately.</p>
      <div class="metrics"><div><b>${b.r2.toFixed(3)}</b><span>R²</span></div><div><b>${usd(b.mae)}</b><span>Avg error (MAE)</span></div><div><b>${usd(b.rmse)}</b><span>RMSE</span></div></div>`;
    $("#mcEnhanced").innerHTML = `<span class="badge">Recommended</span><h3>Enhanced model</h3><p class="desc">Adds age², obesity and smoker × BMI interaction features. Still fully explainable.</p>
      <div class="metrics"><div><b>${e.r2.toFixed(3)}</b><span>R²</span><div class="delta">+${((e.r2 - b.r2) * 100).toFixed(1)} pts</div></div>
      <div><b>${usd(e.mae)}</b><span>Avg error (MAE)</span><div class="delta">−${pc(b.mae, e.mae)}%</div></div>
      <div><b>${usd(e.rmse)}</b><span>RMSE</span><div class="delta">−${pc(b.rmse, e.rmse)}%</div></div></div>`;
    const avp = $('[data-name="avp"]');
    avp.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button"); if (!btn) return;
      for (const x of $$("button", avp)) x.setAttribute("aria-checked", String(x === btn));
      renderAvp(btn.dataset.value);
    });
    radioKeys(avp);
  }

  // Hero card cycles through example people to show the product working.
  function heroDemo() {
    const examples = [
      { age: 35, sex: 1, bmi: 23.5, children: 1, smoker: 0, region: "northwest", tag: "Non-smoker · 35" },
      { age: 52, sex: 0, bmi: 31.2, children: 2, smoker: 1, region: "southeast", tag: "Smoker · 52 · BMI 31" },
      { age: 24, sex: 0, bmi: 27.0, children: 0, smoker: 0, region: "southwest", tag: "Non-smoker · 24" },
      { age: 44, sex: 1, bmi: 26.4, children: 3, smoker: 1, region: "northeast", tag: "Smoker · 44" },
    ];
    let i = 0;
    const show = () => {
      const p = { ...examples[i % examples.length], };
      const v = predict(p, "enhanced");
      tween($("#heroAmount"), v);
      $("#heroMonthly").textContent = `≈ ${usd(v / 12)} per month`;
      $("#heroChip").textContent = p.tag;
      const parts = contributions(p, "enhanced").filter((x) => ["Age", "BMI", "Smoking", "Children"].includes(x.name));
      const max = Math.max(...parts.map((x) => Math.abs(x.value)), 1);
      $("#heroBars").innerHTML = parts.map((x) => `<div class="hc-bar"><span>${x.name}</span><div class="t"><div class="f ${x.value < 0 ? "neg" : x.name === "Smoking" && x.value > 5000 ? "hi" : ""}" style="width:${(Math.abs(x.value) / max) * 100}%"></div></div><b>${signed(x.value).replace(".00", "")}</b></div>`).join("");
      const s = p.smoker ? v - predict({ ...p, smoker: 0 }, "enhanced") : predict({ ...p, smoker: 1 }, "enhanced") - v;
      $("#heroSave").textContent = usd(s);
      $("#heroSave").nextElementSibling.textContent = p.smoker ? "they'd save each year by quitting" : "what smoking would add each year";
      i++;
    };
    show();
    if (!reduceMotion) setInterval(show, 3800);
  }

  function countUp() {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const el = e.target, to = +el.dataset.count, f = el.dataset.format;
      const fmt = (v) => f === "pct" ? (v * 100).toFixed(1) + "%" : f === "usd" ? usd(v) : f === "pctint" ? Math.round(v) + "%" : Math.round(v).toLocaleString();
      tween(el, to, fmt);
    }), { threshold: .4 });
    $$("[data-count]").forEach((el) => io.observe(el));
  }

  function reveal() {
    if (!("IntersectionObserver" in window)) { $$(".reveal").forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: .08, rootMargin: "0px 0px -40px 0px" });
    $$(".reveal").forEach((e) => io.observe(e));
  }

  function navSpy() {
    const nav = $(".nav"), links = $$(".nav-links a");
    addEventListener("scroll", () => nav.classList.toggle("scrolled", scrollY > 8), { passive: true });
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + e.target.id));
    }), { rootMargin: "-45% 0px -50% 0px" });
    ["estimate", "insights", "model", "batch", "faq"].forEach((id) => io.observe(document.getElementById(id)));
  }

  function theme() {
    $("#themeToggle").addEventListener("click", () => {
      const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      const next = dark ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("mc-theme", next); } catch (e) {}
      redrawCharts();
    });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redrawCharts);
  }
  function redrawCharts() {
    if (!chartDefaults()) return;
    renderInsightCharts();
    if (!$('[data-panel="age"]').hidden) renderAgeChart();
  }

  /* ---------- Scenarios ---------- */
  const SC_KEY = "mc-scenarios";
  let scenarios = [];
  try { scenarios = JSON.parse(localStorage.getItem(SC_KEY) || "[]"); if (!Array.isArray(scenarios)) scenarios = []; } catch (e) { scenarios = []; }
  const saveSc = () => { try { localStorage.setItem(SC_KEY, JSON.stringify(scenarios)); } catch (e) {} };

  function renderScenarios() {
    const box = $("#scenarios");
    box.hidden = !scenarios.length;
    if (!scenarios.length) return;
    const vals = scenarios.map((s) => predict(s, s.model));
    const min = Math.min(...vals);
    $("#scTable").innerHTML = `<thead><tr><th>#</th><th class="num">Age</th><th>Gender</th><th class="num">BMI</th><th class="num">Kids</th><th>Smoker</th><th>Region</th><th>Model</th><th class="num">Yearly</th><th class="num">Monthly</th><th class="num">vs best</th><th></th></tr></thead><tbody>` +
      scenarios.map((s, i) => `<tr><td>${i + 1}</td><td class="num">${s.age}</td><td>${s.sex ? "Female" : "Male"}</td><td class="num">${(+s.bmi).toFixed(1)}</td><td class="num">${s.children}</td>
        <td><span class="chip ${s.smoker ? "yes" : ""}">${s.smoker ? "Yes" : "No"}</span></td><td>${cap(s.region)}</td><td>${s.model === "enhanced" ? "Enhanced" : "Original"}</td>
        <td class="num ${vals[i] === min ? "best" : ""}"><b>${usd(vals[i])}</b></td><td class="num">${usd(vals[i] / 12)}</td>
        <td class="num">${vals[i] === min ? '<span class="best">Lowest</span>' : "+" + usd(vals[i] - min)}</td>
        <td><button class="x-btn" data-i="${i}" aria-label="Remove scenario ${i + 1}">×</button></td></tr>`).join("") + "</tbody>";
  }
  function bindScenarios() {
    $("#saveScenario").addEventListener("click", () => {
      const s = { age: state.age, sex: state.sex, bmi: state.bmi, children: state.children, smoker: state.smoker, region: state.region, model: state.model };
      if (scenarios.some((x) => JSON.stringify(x) === JSON.stringify(s))) return toast("This scenario is already saved");
      if (scenarios.length >= 8) scenarios.shift();
      scenarios.push(s); saveSc(); renderScenarios();
      toast("Scenario saved. Change something and save again to compare.");
    });
    $("#scTable").addEventListener("click", (e) => { const b = e.target.closest(".x-btn"); if (!b) return; scenarios.splice(+b.dataset.i, 1); saveSc(); renderScenarios(); });
    $("#clearScenarios").addEventListener("click", () => { scenarios = []; saveSc(); renderScenarios(); });
    $("#shareBtn").addEventListener("click", async () => {
      const url = shareUrl();
      try { await navigator.clipboard.writeText(url); toast("Link copied. Anyone who opens it will see this estimate."); }
      catch (e) { prompt("Copy this link:", url); }
    });
    $("#printBtn").addEventListener("click", () => {
      $$(".tab-panel").forEach((p) => { if (p.dataset.panel === "age") p.hidden = false; });
      renderAgeChart();
      setTimeout(() => window.print(), 300);
    });
    addEventListener("afterprint", () => {
      const active = $(".tabs [aria-selected=true]").dataset.tab;
      $$(".tab-panel").forEach((p) => (p.hidden = p.dataset.panel !== active));
    });
  }

  /* ---------- Batch CSV ---------- */
  let batchResult = "";
  function parseCsv(text) {
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const csvCell = (s) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));

  function runBatch(text, filename) {
    const rows = parseCsv(text);
    if (rows.length < 2) return toast("That file has no data rows");
    const head = rows[0].map((h) => h.trim().toLowerCase().replace(/^﻿/, ""));
    const idx = (n, alts = []) => [n, ...alts].map((x) => head.indexOf(x)).find((i) => i >= 0) ?? -1;
    const col = { age: idx("age"), sex: idx("sex", ["gender"]), bmi: idx("bmi"), children: idx("children", ["kids"]), smoker: idx("smoker", ["smoking"]), region: idx("region") };
    const missing = Object.entries(col).filter(([, i]) => i < 0).map(([k]) => k);
    if (missing.length) return toast("Missing columns: " + missing.join(", "));
    const yes = (v) => ["1", "yes", "y", "true", "smoker"].includes(v);
    const out = [], errors = [];
    rows.slice(1).forEach((r, n) => {
      const g = (k) => (r[col[k]] ?? "").trim().toLowerCase();
      const p = {
        age: +g("age"), bmi: +g("bmi"), children: +g("children") || 0,
        sex: ["1", "female", "f", "woman"].includes(g("sex")) ? 1 : 0,
        smoker: yes(g("smoker")) ? 1 : 0,
        region: REGIONS.includes(g("region")) ? g("region") : "northeast",
      };
      if (!(p.age > 0) || !(p.bmi > 0)) { errors.push(n + 2); return; }
      p.age = clamp(p.age, ...LIMITS.age); p.bmi = clamp(p.bmi, ...LIMITS.bmi); p.children = clamp(Math.round(p.children), ...LIMITS.children);
      const e = predict(p, "enhanced");
      out.push({ ...p, enhanced: e, baseline: predict(p, "baseline") });
    });
    if (!out.length) return toast("No valid rows found");
    const header = ["age", "sex", "bmi", "children", "smoker", "region", "predicted_yearly", "predicted_monthly", "original_model_yearly"];
    batchResult = [header.join(","), ...out.map((p) => [p.age, p.sex ? "female" : "male", p.bmi, p.children, p.smoker ? "yes" : "no", p.region, p.enhanced.toFixed(2), (p.enhanced / 12).toFixed(2), p.baseline.toFixed(2)].map(csvCell).join(","))].join("\n");
    const total = out.reduce((a, p) => a + p.enhanced, 0);
    $("#batchTitle").textContent = `${out.length} people · total ${usd(total)} / year · average ${usd(total / out.length)}${errors.length ? ` · skipped ${errors.length} invalid row(s)` : ""}`;
    $("#batchTable").innerHTML = `<thead><tr><th>#</th><th class="num">Age</th><th>Gender</th><th class="num">BMI</th><th class="num">Kids</th><th>Smoker</th><th>Region</th><th class="num">Yearly</th><th class="num">Monthly</th></tr></thead><tbody>` +
      out.slice(0, 500).map((p, i) => `<tr><td>${i + 1}</td><td class="num">${p.age}</td><td>${p.sex ? "Female" : "Male"}</td><td class="num">${(+p.bmi).toFixed(1)}</td><td class="num">${p.children}</td><td><span class="chip ${p.smoker ? "yes" : ""}">${p.smoker ? "Yes" : "No"}</span></td><td>${esc(cap(p.region))}</td><td class="num"><b>${usd(p.enhanced)}</b></td><td class="num">${usd(p.enhanced / 12)}</td></tr>`).join("") + "</tbody>";
    $("#batchOut").hidden = false;
    $("#batchOut").dataset.name = (filename || "people").replace(/\.csv$/i, "") + "-predictions.csv";
    toast(`Estimated ${out.length} people`);
  }
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function bindBatch() {
    const dz = $("#dropzone"), input = $("#csvInput");
    const read = (f) => { if (!f) return; if (f.size > 5e6) return toast("Please use a file under 5 MB"); f.text().then((t) => runBatch(t, f.name)); };
    dz.addEventListener("click", (e) => { if (!e.target.closest("#sampleCsv")) input.click(); });
    dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    input.addEventListener("change", () => { read(input.files[0]); input.value = ""; });
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("over"));
    dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); read(e.dataTransfer.files[0]); });
    $("#sampleCsv").addEventListener("click", () => download("sample-people.csv",
      "age,sex,bmi,children,smoker,region\n25,female,22.5,0,no,northwest\n41,male,31.4,2,yes,southeast\n58,female,27.9,1,no,northeast\n33,male,35.2,0,yes,southwest\n47,female,24.1,3,no,southeast\n"));
    $("#downloadCsv").addEventListener("click", () => download($("#batchOut").dataset.name, batchResult));
  }

  /* ---------- Misc ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
  }

  async function init() {
    try {
      const [m, d] = await Promise.all([fetch("data/model.json").then((r) => r.json()), fetch("data/dataset.json").then((r) => r.json())]);
      MODEL = m;
      ROWS = d.rows.map(([age, sex, bmi, children, smoker, region, charges]) => ({ age, sex, bmi, children, smoker, region, charges }));
    } catch (e) {
      $("#resAmount").textContent = "Couldn't load the model";
      console.error(e);
      return;
    }
    SORTED_CHARGES = ROWS.map((r) => r.charges).sort((a, b) => a - b);
    MODEL.meanCharge = SORTED_CHARGES.reduce((a, b) => a + b, 0) / SORTED_CHARGES.length;
    // Reference = average engineered features over the data, used for the breakdown.
    const keys = Object.keys(features(ROWS[0]));
    for (const k of keys) REF[k] = 0;
    for (const r of ROWS) { const f = features(r); for (const k of keys) REF[k] += f[k] / ROWS.length; }
    $("#avgLabel").textContent = "Avg " + usdK(MODEL.meanCharge);

    readUrl();
    bindForm(); bindTabs(); bindScenarios(); bindBatch(); theme();
    update(); renderScenarios(); renderKpis(); renderModelCards(); heroDemo();
    reveal(); countUp(); navSpy();
    if (chartDefaults()) renderInsightCharts();
    else addEventListener("load", () => { if (chartDefaults()) renderInsightCharts(); });
  }

  document.documentElement.classList.remove("no-js");
  init();
})();
