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
  const DEFAULT_VIEW = { yaw: -0.4, pitch: 0.85 };
  const PHONE_VIEW = { yaw: -0.95, pitch: 0.85 }; // strip runs toward the viewer so it fills a tall, narrow card
  const view = { ...DEFAULT_VIEW };
  let homeView = DEFAULT_VIEW;
  const MIN_PITCH = 0.3, MAX_PITCH = 1.25;
  // Minecraft earth tones.
  const GRASS = ["#5e9d34", "#67a83a", "#588f30"];
  const DIRT = "#866043", STONE = "#7b7b7b";
  const SLAB_BANDS = [[0, -0.18, GRASS[0]], [-0.18, -0.8, DIRT], [-0.8, -1.4, STONE]];
  // Per-sprite height/width in tile units and display name. 0 grass, 1 poppy, 2 dandelion,
  // 3 small oak, 4 small birch, 5 oak, 6 birch, 7 spruce, 8 jungle. Kept near one tile wide
  // so neighbouring days stay readable.
  const TREE_H = [0.6, 0.7, 0.7, 1.7, 1.9, 2.4, 2.7, 3.4, 4.1];
  const TREE_W = [1, 1, 1, 1.2, 1.2, 1.9, 1.2, 1.9, 2.5];
  const NAMES = ["Grass", "Poppy", "Dandelion", "Small oak", "Small birch", "Oak", "Birch", "Spruce", "Jungle tree"];

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

  function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }

  // Which sprite a day gets: long days grow jungle/spruce, short days oak or birch.
  function spriteFor(c) {
    const h = hash(c.date);
    if (c.level === 0) return h % 12 === 0 ? 1 : h % 12 === 1 ? 2 : h % 5 === 2 ? 0 : -1; // mostly bare ground
    if (c.level === 1) return h & 1 ? 4 : 3;
    if (c.level === 2) return h & 1 ? 6 : 5;
    return c.level === 3 ? 7 : 8;
  }

  function tint(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const k = (v) => Math.round(Math.min(255, v * f));
    return "rgb(" + k((n >> 16) & 255) + "," + k((n >> 8) & 255) + "," + k(n & 255) + ")";
  }

  // Blocky sprite for `type`; 1 tile = u px = 3 "pixels" (q). Origin is bottom-centre.
  function makeSprite(type, u, dpr) {
    const q = u / 3;
    const w = Math.ceil(u * (TREE_W[type] + 0.2)), h = Math.ceil(u * TREE_H[type] + u * 0.3);
    const c = document.createElement("canvas");
    c.width = Math.ceil(w * dpr);
    c.height = Math.ceil(h * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    g.translate(w / 2, h - u * 0.1);
    // Rectangle in pixel units: x from centre, y up from the ground.
    const px = (x, y, rw, rh, col) => { g.fillStyle = col; g.fillRect(x * q, -(y + rh) * q, rw * q, rh * q); };
    // Leaf layer with a few darker/lighter pixels so it reads as a texture.
    const leaves = (x, y, rw, rh, base, dark, light) => {
      px(x, y, rw, rh, base);
      for (let i = 0; i < rw; i++) for (let j = 0; j < rh; j++) {
        const r = (i * 7 + j * 13 + rw * 3) % 5;
        if (r === 0) px(x + i, y + j, 1, 1, dark);
        else if (r === 3) px(x + i, y + j, 1, 1, light);
      }
    };
    const oak = (x, y, rw, rh) => leaves(x, y, rw, rh, "#4a7a2b", "#3d6b22", "#5a8f35");
    const birch = (x, y, rw, rh) => leaves(x, y, rw, rh, "#80b04c", "#6e9c3f", "#93c25a");
    const spruce = (x, y, rw, rh, i) => leaves(x, y, rw, rh, i % 2 ? "#3a6b45" : "#2d5a3a", "#244b30", "#447c50");
    const jungle = (x, y, rw, rh) => leaves(x, y, rw, rh, "#2f8f1f", "#25751a", "#3da52a");
    if (type <= 2) { // grass tuft, poppy, dandelion
      px(-1.5, 0, 1, 1.5, "#4f8a2b"); px(-0.5, 0, 1, 2, "#6fb03c"); px(0.5, 0, 1, 1.5, "#4f8a2b");
      if (type === 1) { px(-0.5, 2, 1, 1, "#c9302c"); px(-0.5, 1.5, 1, 0.5, "#3f7a22"); }
      if (type === 2) { px(-0.5, 2, 1, 1, "#f0d83a"); px(-0.5, 1.5, 1, 0.5, "#3f7a22"); }
    } else if (type === 3) { // small oak
      px(-0.5, 0, 1, 3, "#6b5230"); px(0.5, 0, 0.4, 3, "#5a4425");
      oak(-1.5, 3, 3, 2); oak(-0.5, 5, 1, 1);
    } else if (type === 5) { // oak
      px(-0.5, 0, 1, 4, "#6b5230"); px(0.5, 0, 0.4, 4, "#5a4425");
      oak(-2.5, 4, 5, 2); oak(-1.5, 6, 3, 1); oak(-0.5, 7, 1, 1);
    } else if (type === 4 || type === 6) { // birch: pale bark with dark flecks, light leaves
      const tall = type === 6 ? 5 : 3;
      px(-0.5, 0, 1, tall, "#d9d5c8");
      for (let i = 1; i < tall; i += 2) px(-0.5, i, 1, 0.6, "#3a3a3a");
      birch(-1.5, tall, 3, 2); birch(-0.5, tall + 2, 1, 1);
    } else if (type === 7) { // spruce
      px(-0.5, 0, 1, 1, "#3b2a1a");
      [[1, 2, 5], [3, 2, 5], [5, 2, 3], [7, 2, 3], [9, 1, 1]].forEach((t, i) => spruce(-t[2] / 2, t[0], t[2], t[1], i));
    } else { // jungle: thick trunk with vines, bright canopy
      px(-1, 0, 2, 7, "#5a4a1f"); px(0, 0, 0.6, 7, "#4a3c18");
      px(-1, 2, 0.6, 3, "#2f7a1c"); px(0.4, 4, 0.6, 3, "#2f7a1c");
      jungle(-3.5, 7, 7, 2); jungle(-2.5, 9, 5, 2); jungle(-1.5, 11, 3, 1);
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
    const H = Math.round(W * (W < 620 ? 0.85 : 0.62));
    const ox = -weeks.length / 2, oz = -3.5;

    // Fit the rotated meadow (plus tree height) to the canvas so no angle clips.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    [ox, ox + weeks.length].forEach((x) => [-2.3, 4.2].forEach((y) => [oz, oz + 7].forEach((z) => {
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

    ctx.imageSmoothingEnabled = false; // keep the blocky look when sprites are scaled

    // Terrain slab: dirt and stone sides under a grass top, like a cut-out chunk.
    const L = weeks.length, X1 = ox + L, Z1 = oz + 7;
    const quad = (pts, col) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      pts.forEach((p, i) => { const q = proj(p[0], p[1], p[2]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
      ctx.fill();
    };
    [
      { n: [1, 0, 0], f: 0.85, pts: (y0, y1) => [[X1, y0, oz], [X1, y0, Z1], [X1, y1, Z1], [X1, y1, oz]] },
      { n: [-1, 0, 0], f: 0.6, pts: (y0, y1) => [[ox, y0, oz], [ox, y0, Z1], [ox, y1, Z1], [ox, y1, oz]] },
      { n: [0, 0, 1], f: 0.75, pts: (y0, y1) => [[ox, y0, Z1], [X1, y0, Z1], [X1, y1, Z1], [ox, y1, Z1]] },
      { n: [0, 0, -1], f: 0.65, pts: (y0, y1) => [[ox, y0, oz], [X1, y0, oz], [X1, y1, oz], [ox, y1, oz]] },
    ].forEach((face) => {
      if (rotate(face.n[0], face.n[1], face.n[2])[2] <= 0) return;
      SLAB_BANDS.forEach((b) => quad(face.pts(b[0], b[1]), tint(b[2], face.f)));
    });
    quad([[ox, 0, oz], [X1, 0, oz], [X1, 0, Z1], [ox, 0, Z1]], GRASS[0]); // covers partial first/last weeks

    // Grass tiles are flat, so they never overlap and need no sorting.
    const items = [];
    cells.forEach((c) => {
      const quadPts = [[0, 0], [1, 0], [1, 1], [0, 1]].map((o) => proj(ox + c.w + o[0], 0, oz + c.d + o[1]));
      ctx.fillStyle = GRASS[hash(c.date) % 3];
      ctx.beginPath();
      quadPts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.fill();
      const m = proj(ox + c.w + 0.5, 0, oz + c.d + 0.5);
      items.push({ c, x: m[0], y: m[1], depth: m[2], quadPts });
    });
    items.sort((p, q) => p.depth - q.depth); // far to near

    // Month labels under whichever long edge faces the camera.
    if (Math.abs(Math.cos(view.yaw)) > 0.45) {
      const nearZ = proj(0, -2, oz)[1] > proj(0, -2, Z1)[1] ? oz : Z1;
      ctx.fillStyle = "#a9a9a9";
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "center";
      let lastX = -Infinity, lastMonth = -1;
      cells.forEach((c) => {
        const m = Number(c.date.slice(5, 7));
        if (m === lastMonth) return;
        lastMonth = m;
        if (c.w === 0 && Number(c.date.slice(8)) > 20) return; // partial month at the very start
        const p = proj(ox + c.w, -1.9, nearZ);
        if (p[0] < 18 || p[0] > W - 18 || Math.abs(p[0] - lastX) < 30) return; // keep labels inside the card
        lastX = p[0];
        ctx.fillText(MONTHS[m - 1], p[0], p[1]);
      });
    }

    // Upright things shrink as the camera tilts toward top-down.
    const lift = Math.cos(view.pitch) / Math.cos(0.6);
    const imgs = getSprites(s, dpr);
    const hits = [];
    items.forEach((it) => {
      const idx = spriteFor(it.c);
      let rect = null;
      if (idx >= 0) {
        const img = imgs[idx];
        // Within a level, busier days grow a little taller.
        const grow = it.c.level ? 0.9 + 0.2 * (it.c.count / max) : 1;
        const w = (img.width / dpr) * grow, h = (img.height / dpr) * lift * grow;
        ctx.drawImage(img, it.x - w / 2, it.y - h + s * 0.1 * lift, w, h);
        if (it.c.level) rect = { x: it.x - w / 2, y: it.y - h, w, h };
      }
      hits.push({ rect, quad: it.quadPts, cell: it.c, name: idx >= 0 ? NAMES[idx] : "Bare ground" });
    });

    // Outline the hovered day's tile.
    const hv = current.hover && items.find((it) => it.c === current.hover);
    if (hv) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      hv.quadPts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.stroke();
    }
    current.hits = hits;
  }

  function inQuad(q, x, y) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      const cr = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
      if (cr !== 0) {
        if (sign && (cr > 0) !== (sign > 0)) return false;
        sign = cr;
      }
    }
    return true;
  }

  // Legend: one icon per tier with the real contribution range seen this year.
  function renderLegend(cells) {
    const box = $("contrib-legend");
    if (!box) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const tiers = [[0, 0, "None"], [1, 4, "Light"], [2, 6, "Medium"], [3, 7, "Heavy"], [4, 8, "Busiest"]];
    box.textContent = "";
    tiers.forEach(([level, sprite, label]) => {
      const counts = cells.filter((c) => c.level === level).map((c) => c.count);
      if (level && !counts.length) return;
      const lo = Math.min(...counts), hi = Math.max(...counts);
      const item = document.createElement("div");
      item.className = "lg-item";
      const img = makeSprite(sprite, 14, dpr);
      img.style.width = img.width / dpr + "px";
      img.style.height = img.height / dpr + "px";
      const cap = document.createElement("span");
      cap.textContent = label + (level ? " " + (lo === hi ? lo : lo + "–" + hi) : "");
      item.append(img, cap);
      box.appendChild(item);
    });
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
    renderLegend(cells);
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
      // Hits are stored far-to-near, so scan from the end for the front-most day.
      for (let i = current.hits.length - 1; i >= 0; i--) {
        const k = current.hits[i];
        const r = k.rect;
        if ((r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) || inQuad(k.quad, x, y)) { hit = k; break; }
      }
      if (!hit) {
        tip.style.display = "none";
        if (current.hover) { current.hover = null; requestDraw(); }
        return;
      }
      if (current.hover !== hit.cell) { current.hover = hit.cell; requestDraw(); }
      const n = hit.cell.count;
      tip.textContent = n + " contribution" + (n === 1 ? "" : "s") + " on " + fmtDate(hit.cell.date, true) + " · " + hit.name;
      tip.style.display = "block";
      tip.style.left = Math.max(0, Math.min(x + 12, r.width - tip.offsetWidth - 4)) + "px";
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
    canvas.addEventListener("pointerleave", () => {
      if (drag) return;
      tip.style.display = "none";
      if (current && current.hover) { current.hover = null; requestDraw(); }
    });
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
