// BACKUP: 3D block-chart version of activity.js. To restore, copy this over js/activity.js
// and styles/activity.blocks.css over styles/activity.css (index.html needs no change).
(function () {
  const $ = (id) => document.getElementById(id);
  const SAMPLE_OURA = {
    day: "2026-10-11", readiness: 84, sleep: 79, activity: 88, steps: 9432, activeCalories: 412,
    sleepSeconds: 27720, sleepEfficiency: 91, restingHr: 52, hrv: 48,
  };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(url + " " + res.status);
    return res.json();
  }

  function timeAgo(iso) {
    const mins = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000));
    if (mins < 60) return mins + "m ago";
    if (mins < 1440) return Math.round(mins / 60) + "h ago";
    return Math.round(mins / 1440) + "d ago";
  }

  // Empty 53-week grid ending today, used when the live data can't be fetched.
  function placeholderWeeks() {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 52 * 7 - end.getDay());
    const weeks = [];
    for (let w = 0; w < 53; w++) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(start);
        day.setDate(start.getDate() + w * 7 + d);
        if (day <= end) week.push({ date: day.toISOString().slice(0, 10), count: 0, level: 0 });
      }
      weeks.push(week);
    }
    return weeks;
  }

  // ---- Isometric contribution chart ----
  const LEVEL_COLORS = ["#37355f", "#5d8cff", "#7a7cff", "#9a6bff", "#b45cff"];

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.round(Math.min(255, v * f));
    return "rgb(" + c((n >> 16) & 255) + "," + c((n >> 8) & 255) + "," + c(n & 255) + ")";
  }

  function fmtDate(iso, withYear) {
    const [y, m, d] = iso.split("-").map(Number);
    return MONTHS[m - 1] + " " + d + (withYear ? ", " + y : "");
  }

  function computeStats(days) {
    let busiest = days[0];
    let longest = { len: 0, start: null, end: null };
    let run = { len: 0, start: null };
    days.forEach((d) => {
      if (d.count > busiest.count) busiest = d;
      if (d.count > 0) {
        if (!run.len) run.start = d.date;
        run.len++;
        if (run.len > longest.len) longest = { len: run.len, start: run.start, end: d.date };
      } else {
        run.len = 0;
      }
    });
    // Current streak: like GitHub, an empty "today" doesn't break it yet.
    let i = days.length - 1;
    if (days[i].count === 0) i--;
    let cur = { len: 0, start: null, end: null };
    if (i >= 0 && days[i].count > 0) {
      cur.end = days[i].date;
      while (i >= 0 && days[i].count > 0) {
        cur.len++;
        cur.start = days[i].date;
        i--;
      }
    }
    return { busiest, longest, cur };
  }

  function renderStats(days, total) {
    const { busiest, longest, cur } = computeStats(days);
    const range = (s) => (s.len ? fmtDate(s.start) + " — " + fmtDate(s.end) : "—");
    $("st-total").textContent = total.toLocaleString();
    $("st-total-range").textContent = fmtDate(days[0].date, true) + " — " + fmtDate(days[days.length - 1].date, true);
    $("st-busiest").textContent = busiest.count;
    $("st-busiest-date").textContent = busiest.count ? fmtDate(busiest.date) : "—";
    $("st-longest").textContent = longest.len;
    $("st-longest-range").textContent = range(longest);
    $("st-current").textContent = cur.len;
    $("st-current-range").textContent = range(cur);
  }

  // ---- 3D chart: orthographic projection, drag to orbit ----
  const DEFAULT_VIEW = { yaw: -0.45, pitch: 0.6 };
  const view = { ...DEFAULT_VIEW };
  const LIGHT = (() => {
    const v = [0.35, 0.85, 0.4];
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  })();
  const FACES = [
    { n: [0, 1, 0], c: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] }, // top
    { n: [1, 0, 0], c: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]] },
    { n: [-1, 0, 0], c: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]] },
    { n: [0, 0, 1], c: [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]] },
    { n: [0, 0, -1], c: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] },
  ];

  let current = null; // { weeks, total, cells, hits }
  let raf = 0;

  function rotate(x, y, z) {
    const ca = Math.cos(view.yaw), sa = Math.sin(view.yaw);
    const cb = Math.cos(view.pitch), sb = Math.sin(view.pitch);
    const x1 = x * ca + z * sa;
    const z1 = -x * sa + z * ca;
    return [x1, y * cb - z1 * sb, y * sb + z1 * cb]; // screen x, screen up, depth toward viewer
  }

  function buildCells(weeks) {
    const cells = [];
    weeks.forEach((week, w) => {
      const offset = w === 0 ? 7 - week.length : 0;
      week.forEach((day, i) => cells.push({ ...day, w, d: offset + i }));
    });
    return cells;
  }

  function drawIso() {
    const canvas = $("contrib-canvas");
    const W = canvas.parentElement.clientWidth;
    if (!W || !current) return;
    $("iso-stage").classList.toggle("iso-compact", W < 620);

    const { cells, weeks } = current;
    const max = Math.max(1, ...cells.map((c) => c.count));
    const H = Math.round(W * (W < 620 ? 0.62 : 0.55));
    const ox = -weeks.length / 2, oz = -3.5;

    // Fit the rotated bounding box to the canvas so no angle clips.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    [ox, ox + weeks.length].forEach((x) => [0, 6].forEach((y) => [oz, oz + 7].forEach((z) => {
      const r = rotate(x, y, z);
      minX = Math.min(minX, r[0]); maxX = Math.max(maxX, r[0]);
      minY = Math.min(minY, r[1]); maxY = Math.max(maxY, r[1]);
    })));
    const s = Math.min((W - 16) / (maxX - minX), (H - 16) / (maxY - minY));
    const cx = W / 2 - ((minX + maxX) / 2) * s;
    const cy = H / 2 + ((minY + maxY) / 2) * s;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.6;

    const gap = 0.1;
    const bars = cells.map((c) => {
      const h = c.count ? 0.6 + 5.4 * Math.pow(c.count / max, 0.8) : 0.2;
      const x0 = ox + c.w + gap, z0 = oz + c.d + gap, sz = 1 - 2 * gap;
      const depth = rotate(x0 + sz / 2, h / 2, z0 + sz / 2)[2];
      return { c, h, x0, z0, sz, depth };
    });
    bars.sort((a, b) => a.depth - b.depth); // far to near

    const hits = [];
    bars.forEach((b) => {
      const base = LEVEL_COLORS[b.c.level] || LEVEL_COLORS[0];
      const outline = new Path2D();
      FACES.forEach((f) => {
        if (rotate(f.n[0], f.n[1], f.n[2])[2] <= 0) return; // back-facing
        const pts = f.c.map((p) => {
          const r = rotate(b.x0 + p[0] * b.sz, p[1] * b.h, b.z0 + p[2] * b.sz);
          return [cx + r[0] * s, cy - r[1] * s];
        });
        const lit = 0.5 + 0.5 * Math.max(0, f.n[0] * LIGHT[0] + f.n[1] * LIGHT[1] + f.n[2] * LIGHT[2]);
        const color = shade(base, lit);
        const path = new Path2D();
        pts.forEach((p, i) => (i ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1])));
        path.closePath();
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.fill(path);
        ctx.stroke(path);
        outline.addPath(path);
      });
      hits.push({ outline, cell: b.c });
    });
    current.hits = hits;
  }

  function requestDraw() {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawIso(); });
  }

  function renderGrid(weeks, total) {
    const cells = buildCells(weeks);
    if (total === undefined) total = cells.reduce((n, c) => n + c.count, 0);
    current = { weeks, total, cells, hits: [] };
    drawIso();
    renderStats(cells, total);
  }

  function setupHover() {
    const canvas = $("contrib-canvas");
    const tip = $("iso-tip");
    let drag = null;
    let spin = 0; // inertia for yaw

    canvas.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY };
      spin = 0;
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add("dragging");
      tip.style.display = "none";
    });
    canvas.addEventListener("pointermove", (e) => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX;
        drag.y = e.clientY;
        view.yaw += dx * 0.008;
        view.pitch = Math.min(1.4, Math.max(0.1, view.pitch + dy * 0.006));
        spin = dx * 0.008;
        requestDraw();
        return;
      }
      if (!current) return;
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const ctx = canvas.getContext("2d");
      let hit = null;
      // Hits are stored far-to-near, so scan from the end for the front-most bar.
      for (let i = current.hits.length - 1; i >= 0; i--) {
        if (ctx.isPointInPath(current.hits[i].outline, x * (canvas.width / r.width), y * (canvas.height / r.height))) {
          hit = current.hits[i].cell;
          break;
        }
      }
      if (!hit) { tip.style.display = "none"; return; }
      tip.textContent = hit.count + " contribution" + (hit.count === 1 ? "" : "s") + " on " + fmtDate(hit.date, true);
      tip.style.display = "block";
      tip.style.left = Math.min(x + 12, r.width - tip.offsetWidth - 4) + "px";
      tip.style.top = Math.max(y - 30, 0) + "px";
    });
    const release = () => {
      if (!drag) return;
      drag = null;
      canvas.classList.remove("dragging");
      const coast = () => {
        if (drag || Math.abs(spin) < 0.0005) return;
        view.yaw += spin;
        spin *= 0.94;
        drawIso();
        requestAnimationFrame(coast);
      };
      requestAnimationFrame(coast);
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("pointerleave", () => { if (!drag) tip.style.display = "none"; });
    canvas.addEventListener("dblclick", () => { Object.assign(view, DEFAULT_VIEW); requestDraw(); });

    let lastW = 0;
    new ResizeObserver(() => {
      const w = canvas.parentElement.clientWidth;
      if (current && w !== lastW) { lastW = w; requestDraw(); }
    }).observe(canvas.parentElement);
  }

  async function loadGithub() {
    try {
      const data = await getJSON("/.netlify/functions/github");
      $("github-total").textContent = data.total.toLocaleString() + " contributions in the last year";
      renderGrid(data.weeks, data.total);
      const c = data.repo && data.repo.commit;
      if (c) {
        $("commit-msg").textContent = c.messageHeadline;
        $("commit-link").href = c.url;
        $("commit-details").textContent = data.repo.name + " · " + timeAgo(c.committedDate);
      } else if (data.repo) {
        $("commit-msg").textContent = data.repo.name;
        $("commit-link").href = data.repo.url;
      }
    } catch (e) {
      $("github-total").textContent = "Live GitHub data unavailable (run with `netlify dev` and set GITHUB_TOKEN)";
      renderGrid(placeholderWeeks());
      $("commit-msg").textContent = "Unavailable";
    }
  }

  async function loadOura() {
    let data;
    try {
      data = await getJSON("/.netlify/functions/oura-summary");
    } catch (e) {
      // Sample numbers only when developing locally; never show fake data live.
      if (location.hostname !== "localhost") {
        $("oura-card").style.display = "none";
        return;
      }
      data = SAMPLE_OURA;
    }
    const num = (v) => typeof v === "number";
    const set = (id, text) => { $(id).textContent = text; };
    if (data.day) {
      set("oura-day", new Date(data.day + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" }));
    }
    const join = (parts) => parts.filter(Boolean).join(" · ");

    if (num(data.sleepSeconds)) {
      const m = Math.round(data.sleepSeconds / 60);
      set("o-sleep", `${Math.floor(m / 60)}h ${m % 60}m`);
    }
    set("o-sleep-sub", join([
      num(data.sleep) && `Score ${data.sleep}`,
      num(data.sleepEfficiency) && `${data.sleepEfficiency}% efficiency`,
    ]));
    if (num(data.restingHr)) set("o-hr", `${Math.round(data.restingHr)} bpm`);
    set("o-hr-sub", join([
      num(data.hrv) && `HRV ${Math.round(data.hrv)} ms`,
      num(data.readiness) && `Readiness ${data.readiness}`,
    ]));
    if (num(data.steps)) set("o-steps", data.steps.toLocaleString());
    set("o-steps-sub", join([
      num(data.activeCalories) && `${data.activeCalories} active cal`,
      num(data.activity) && `Activity ${data.activity}`,
    ]));
  }

  setupHover();
  loadGithub();
  loadOura();
})();
