// BACKUP: round-tree forest version of activity.js. To restore, copy over js/activity.js
// and styles/activity.forest.css over styles/activity.css.
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

  // ---- Forest chart: flat meadow you can orbit, with a tree sprite per day ----
  // Trees are pre-rendered once per size and stamped with drawImage, so a frame
  // is ~370 quads + ~370 blits, cheap enough for phones.
  const DEFAULT_VIEW = { yaw: -0.45, pitch: 0.6 };
  const PHONE_VIEW = { yaw: -0.95, pitch: 0.7 }; // strip runs toward the viewer so it fills a tall, narrow card
  const view = { ...DEFAULT_VIEW };
  let homeView = DEFAULT_VIEW;
  const MIN_PITCH = 0.3, MAX_PITCH = 1.1;
  const GROUND = ["#2b4636", "#2f4d3b"];
  // Sprite height in tile units per level: grass, sapling, bush tree, pine, blossom tree.
  const TREE_H = [0.7, 1.7, 2.4, 3.6, 4.6];

  let current = null; // { weeks, total, cells, hits }
  let raf = 0;
  let sprites = null; // { key, imgs[] }

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

  // Draw one sprite for `type` on a canvas where 1 tile = u px. Origin is bottom-centre.
  function makeSprite(type, u, dpr) {
    const w = Math.ceil(u * 1.8), h = Math.ceil(u * TREE_H[type] + u * 0.3);
    const c = document.createElement("canvas");
    c.width = Math.ceil(w * dpr);
    c.height = Math.ceil(h * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    g.translate(w / 2, h - u * 0.1);
    const rect = (x, y, rw, rh, col) => { g.fillStyle = col; g.fillRect(x * u, -y * u - rh * u, rw * u, rh * u); };
    const tri = (cx, base, hw, ht, col) => {
      g.fillStyle = col;
      g.beginPath();
      g.moveTo((cx - hw) * u, -base * u);
      g.lineTo(cx * u, -(base + ht) * u);
      g.lineTo((cx + hw) * u, -base * u);
      g.fill();
    };
    const dot = (cx, cy, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(cx * u, -cy * u, r * u, 0, 6.2832); g.fill(); };
    if (type === 0) { // grass tuft
      [[-0.3, 0.45, "#4f9a57"], [-0.1, 0.65, "#3f8a4c"], [0.1, 0.5, "#4f9a57"], [0.3, 0.4, "#3f8a4c"]].forEach(
        (b) => tri(b[0], 0, 0.1, b[1], b[2])
      );
    } else if (type === 1) { // sapling
      rect(-0.06, 0, 0.12, 0.7, "#6b4a2f");
      dot(0, 1.05, 0.38, "#4f9a57");
      dot(0.1, 0.98, 0.26, "#63b266");
    } else if (type === 2) { // round tree
      rect(-0.1, 0, 0.2, 1.0, "#6b4a2f");
      dot(-0.18, 1.5, 0.55, "#3f8a4c");
      dot(0.2, 1.5, 0.5, "#4f9a57");
      dot(0, 1.95, 0.5, "#63b266");
    } else if (type === 3) { // pine
      rect(-0.08, 0, 0.16, 0.5, "#5b3f29");
      [[0.35, 0.65, 1.1, "#2d6e49"], [1.1, 0.55, 1.0, "#357a52"], [1.85, 0.42, 0.95, "#3f8a5c"]].forEach((t) => {
        tri(0, t[0], t[1], t[2], t[3]);
        g.fillStyle = "rgba(0,0,0,0.18)"; // shaded right half, flat colour
        g.beginPath();
        g.moveTo(0, -t[0] * u);
        g.lineTo(0, -(t[0] + t[2]) * u);
        g.lineTo(t[1] * u, -t[0] * u);
        g.fill();
      });
    } else { // blossom tree, the busiest days
      rect(-0.14, 0, 0.28, 1.5, "#5b3f29");
      dot(-0.35, 2.4, 0.7, "#8b6cf0");
      dot(0.35, 2.5, 0.65, "#9a7bff");
      dot(0, 3.05, 0.75, "#a78bfa");
      dot(-0.1, 3.5, 0.45, "#b9a2ff");
    }
    return c;
  }

  function getSprites(u, dpr) {
    const key = Math.round(u * 4) + "@" + dpr;
    if (!sprites || sprites.key !== key) {
      sprites = { key, imgs: TREE_H.map((_, t) => makeSprite(t, u, dpr)) };
    }
    return sprites.imgs;
  }

  function drawIso() {
    const canvas = $("contrib-canvas");
    const W = canvas.parentElement.clientWidth;
    if (!W || !current) return;
    $("iso-stage").classList.toggle("iso-compact", W < 620);

    const { cells, weeks } = current;
    const max = Math.max(1, ...cells.map((c) => c.count));
    const H = Math.round(W * (W < 620 ? 0.85 : 0.55));
    const ox = -weeks.length / 2, oz = -3.5;

    // Fit the rotated meadow (plus tree height) to the canvas so no angle clips.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    [ox, ox + weeks.length].forEach((x) => [0, 4.6].forEach((y) => [oz, oz + 7].forEach((z) => {
      const r = rotate(x, y, z);
      minX = Math.min(minX, r[0]); maxX = Math.max(maxX, r[0]);
      minY = Math.min(minY, r[1]); maxY = Math.max(maxY, r[1]);
    })));
    const s = Math.min((W - 16) / (maxX - minX), (H - 16) / (maxY - minY));
    const cx = W / 2 - ((minX + maxX) / 2) * s;
    const cy = H / 2 + ((minY + maxY) / 2) * s;
    const proj = (x, y, z) => { const r = rotate(x, y, z); return [cx + r[0] * s, cy - r[1] * s, r[2]]; };

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Meadow tiles are flat, so they never overlap and need no sorting.
    const items = [];
    cells.forEach((c) => {
      const a = proj(ox + c.w, 0, oz + c.d), b = proj(ox + c.w + 1, 0, oz + c.d);
      const e = proj(ox + c.w + 1, 0, oz + c.d + 1), d = proj(ox + c.w, 0, oz + c.d + 1);
      ctx.fillStyle = GROUND[(c.w + c.d) & 1];
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(e[0], e[1]); ctx.lineTo(d[0], d[1]);
      ctx.fill();
      const m = proj(ox + c.w + 0.5, 0, oz + c.d + 0.5);
      items.push({ c, x: m[0], y: m[1], depth: m[2] });
    });
    items.sort((p, q) => p.depth - q.depth); // far to near

    // Upright things shrink as the camera tilts toward top-down.
    const lift = Math.cos(view.pitch) / Math.cos(0.6);
    const imgs = getSprites(s, dpr);
    const hits = [];
    items.forEach((it) => {
      const type = it.c.level;
      const img = imgs[type];
      // Within a level, busier days grow a little taller.
      const grow = type ? 0.85 + 0.3 * (it.c.count / max) : 1;
      const w = (img.width / dpr) * (type ? grow : 1), h = (img.height / dpr) * lift * grow;
      ctx.drawImage(img, it.x - w / 2, it.y - h + s * 0.1 * lift, w, h);
      hits.push({ x: it.x - w / 2, y: it.y - h, w, h, cell: it.c });
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
    if (canvas.parentElement.clientWidth < 620) {
      homeView = PHONE_VIEW;
      Object.assign(view, homeView);
    }
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
        view.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, view.pitch + dy * 0.006));
        spin = dx * 0.008;
        requestDraw();
        return;
      }
      if (!current) return;
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let hit = null;
      // Hits are stored far-to-near, so scan from the end for the front-most tree.
      for (let i = current.hits.length - 1; i >= 0; i--) {
        const k = current.hits[i];
        if (x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h) { hit = k.cell; break; }
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
    canvas.addEventListener("dblclick", () => { Object.assign(view, homeView); requestDraw(); });

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
