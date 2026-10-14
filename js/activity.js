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
  const DEFAULT_VIEW = { yaw: -0.4, pitch: 0.55 }; // ~30° above the ground: sides of trees and ore layers stay visible
  const PHONE_VIEW = { yaw: -0.95, pitch: 0.55 }; // strip runs toward the viewer so it fills a tall, narrow card
  const view = { ...DEFAULT_VIEW };
  let homeView = DEFAULT_VIEW;
  const MIN_PITCH = 0.3, MAX_PITCH = 1.25;
  // Minecraft earth tones.
  const GRASS = ["#3f6b2c", "#426f2e", "#3c6529"]; // muted on purpose: trees are the subject
  const DIRT = ["#866043", "#7a5638", "#8f6a4a"];
  const STONE = ["#7b7b7b", "#838383", "#737373"];
  const ORES = { coal: "#2b2b2b", iron: "#d8af93", gold: "#fcee4b", redstone: "#c0231f", lapis: "#2a4fb5", diamond: "#5decf5" };
  const DEPTH = 5; // block rows under the grass: 2 of dirt, 3 of stone
  // Short flowers from the game. Sprite ids: 0 grass (legend only), 1..FLOWERS.length
  // flowers, then oak, birch, spruce, jungle.
  const FLOWERS = [
    ["Dandelion", "#e8d44a"], ["Poppy", "#c4423b"], ["Blue orchid", "#34b4d6"], ["Allium", "#b36fd1"],
    ["Red tulip", "#d2362f"], ["Orange tulip", "#e07b2a"], ["Pink tulip", "#e58fb8"], ["Cornflower", "#5b7fd6"],
  ]; // no white ones (azure bluet, white tulip, oxeye daisy, lily of the valley): they look like birch trunks
  const OAK = FLOWERS.length + 1; // oak, birch, spruce, jungle follow in that order
  // Height/width in tile units; trees stay near one tile wide so neighbouring days stay readable.
  const TREE_H = [0.5, ...FLOWERS.map(() => 0.7), 1.8, 2.7, 3.4, 4.1];
  const TREE_W = [1, ...FLOWERS.map(() => 1), 1.2, 1.2, 1.9, 2.5];
  const NAMES = ["Grass", ...FLOWERS.map((f) => f[0]), "Oak", "Birch", "Spruce", "Jungle tree"];

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

  // Tiers use fixed, absolute daily counts, so 5 contributions and 15 are never the same
  // tree. The top tier has no upper bound: 13, 40 or 200 are all jungle trees.
  const TIER_MIN = [1, 4, 8, 13]; // first count of light, medium, heavy, busiest
  function tierOf(count) {
    if (!count) return 0;
    let t = 1;
    TIER_MIN.forEach((m, i) => { if (count >= m) t = i + 1; });
    return t;
  }

  function assignTiers(cells) {
    cells.forEach((c) => { c.tier = tierOf(c.count); });
  }

  // 0..1 position of a day within its tier; the open-ended top tier saturates at +20 days.
  function tierProgress(c) {
    const lo = TIER_MIN[c.tier - 1];
    const span = c.tier < 4 ? TIER_MIN[c.tier] - lo : 20;
    return Math.min(1, (c.count - lo) / span);
  }

  // Which sprite a day gets: oak, birch, spruce, jungle as days get busier; the odd
  // flower on empty days.
  function spriteFor(c) {
    if (c.tier === 0) {
      const h = hash(c.date);
      return h % 8 === 0 ? 1 + ((h >> 3) % FLOWERS.length) : -1;
    }
    return OAK - 1 + c.tier;
  }

  const tintCache = {};
  function tint(hex, f) {
    const key = hex + f;
    if (tintCache[key]) return tintCache[key];
    const n = parseInt(hex.slice(1), 16);
    const k = (v) => Math.round(Math.min(255, v * f));
    return (tintCache[key] = "rgb(" + k((n >> 16) & 255) + "," + k((n >> 8) & 255) + "," + k(n & 255) + ")");
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
    const oak = (x, y, rw, rh) => leaves(x, y, rw, rh, "#58922f", "#487f27", "#68a83a");
    const birch = (x, y, rw, rh) => leaves(x, y, rw, rh, "#80b04c", "#6e9c3f", "#93c25a");
    const spruce = (x, y, rw, rh, i) => leaves(x, y, rw, rh, i % 2 ? "#3a6b45" : "#2d5a3a", "#244b30", "#447c50");
    const jungle = (x, y, rw, rh) => leaves(x, y, rw, rh, "#2f8f1f", "#25751a", "#3da52a");
    if (type < OAK) { // ground details: a stem and a bloom; type 0 only shows in the legend
      if (type === 0) px(-0.5, 0, 1, 1, "#5a8a3a");
      else { px(-0.5, 0, 1, 1, "#3f7a22"); px(-0.5, 1, 1, 1, FLOWERS[type - 1][1]); }
    } else if (type === OAK) { // oak
      px(-0.5, 0, 1, 3, "#6b5230"); px(0.5, 0, 0.4, 3, "#5a4425");
      oak(-1.5, 3, 3, 2); oak(-0.5, 5, 1, 1);
    } else if (type === OAK + 1) { // birch: pale bark with dark flecks, light leaves
      px(-0.5, 0, 1, 5, "#d9d5c8");
      for (let i = 1; i < 5; i += 2) px(-0.5, i, 1, 0.6, "#3a3a3a");
      birch(-1.5, 5, 3, 2); birch(-0.5, 7, 1, 1);
    } else if (type === OAK + 2) { // spruce
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
    const H = Math.round(W * (W < 620 ? 0.9 : 0.64));
    const ox = -weeks.length / 2, oz = -3.5;

    // Fit the rotated meadow (plus tree height) to the canvas so no angle clips.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    [ox, ox + weeks.length].forEach((x) => [-(DEPTH + 1.3), 4.2].forEach((y) => [oz, oz + 7].forEach((z) => {
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

    // Terrain slab: grass over dirt, stone and ores, like a cut-out chunk of world.
    const L = weeks.length, X1 = ox + L, Z1 = oz + 7;
    const poly = (pts, col) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      pts.forEach((p, i) => { const q = proj(p[0], p[1], p[2]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
      ctx.fill();
    };
    // `at(s, t)`: s along the face, t blocks below the surface.
    const SIDES = [
      { n: [1, 0, 0], f: 0.85, len: 7, at: (a, t) => [X1, -t, oz + a] },
      { n: [-1, 0, 0], f: 0.6, len: 7, at: (a, t) => [ox, -t, oz + a] },
      { n: [0, 0, 1], f: 0.75, len: L, at: (a, t) => [ox + a, -t, Z1] },
      { n: [0, 0, -1], f: 0.65, len: L, at: (a, t) => [ox + a, -t, oz] },
    ];
    SIDES.forEach((face, fi) => {
      if (rotate(face.n[0], face.n[1], face.n[2])[2] <= 0) return;
      const cell = (i, j, a0, t0, a1, t1, col) => poly([face.at(i + a0, j + t0), face.at(i + a1, j + t0), face.at(i + a1, j + t1), face.at(i + a0, j + t1)], tint(col, face.f));
      for (let j = 0; j < DEPTH; j++) {
        for (let i = 0; i < face.len; i++) {
          const h = Math.imul(i + 1, 73856093) ^ Math.imul(j + 1, 19349663) ^ Math.imul(fi + 1, 83492791);
          const r = (h >>> 0) % 100, v = (h >>> 8) % 3;
          if (j < 2) { // dirt
            cell(i, j, 0, 0, 1, 1, DIRT[v]);
            if (j === 0) cell(i, j, 0, 0, 1, 0.22, GRASS[0]); // grass edge on the top row
            continue;
          }
          cell(i, j, 0, 0, 1, 1, STONE[v]);
          const ore = r < 7 ? "coal" : r < 11 ? "iron" : j >= 3 && r < 13 ? "gold" : j >= 3 && r < 16 ? "redstone" : j >= 3 && r < 18 ? "lapis" : j === 4 && r < 20 ? "diamond" : null;
          if (ore) {
            cell(i, j, 0.1, 0.12, 0.45, 0.45, ORES[ore]);
            cell(i, j, 0.52, 0.42, 0.9, 0.78, ORES[ore]);
            cell(i, j, 0.15, 0.6, 0.42, 0.9, ORES[ore]);
          }
        }
      }
    });
    poly([[ox, 0, oz], [X1, 0, oz], [X1, 0, Z1], [ox, 0, Z1]], GRASS[0]); // covers partial first/last weeks

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
      ctx.font = "600 13px system-ui, sans-serif";
      ctx.textAlign = "center";
      let lastX = -Infinity, lastMonth = -1;
      cells.forEach((c) => {
        const m = Number(c.date.slice(5, 7));
        if (m === lastMonth) return;
        lastMonth = m;
        if (c.w === 0 && Number(c.date.slice(8)) > 20) return; // partial month at the very start
        const p = proj(ox + c.w, -(DEPTH + 0.8), nearZ);
        if (p[0] < 18 || p[0] > W - 18 || Math.abs(p[0] - lastX) < 52) return; // keep labels inside the card
        lastX = p[0];
        // White with a dark drop shadow, like Minecraft text, so it never blends into the stone.
        const label = MONTHS[m - 1] + " " + c.date.slice(2, 4); // e.g. "Oct 25"
        ctx.fillStyle = "#1a1a1a";
        ctx.fillText(label, p[0] + 1, p[1] + 1);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, p[0], p[1]);
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
        const grow = it.c.tier ? 0.9 + 0.2 * tierProgress(it.c) : 1;
        const w = (img.width / dpr) * grow, h = (img.height / dpr) * lift * grow;
        ctx.drawImage(img, it.x - w / 2, it.y - h + s * 0.1 * lift, w, h);
        if (it.c.tier) rect = { x: it.x - w / 2, y: it.y - h, w, h };
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

  // Legend: one icon per tier with its contribution range. Re-rendered for each view.
  const ORE_TIERS = [["Stone", null], ["Coal", "#1c1c1c"], ["Iron", "#d8af93"], ["Gold", "#ffd91a"], ["Diamond", "#4ff5ff"]];
  function tierRange(tier) {
    if (tier === 4) return TIER_MIN[3] + "+";
    return TIER_MIN[tier] - 1 === TIER_MIN[tier - 1] ? TIER_MIN[tier - 1] : TIER_MIN[tier - 1] + "–" + (TIER_MIN[tier] - 1);
  }
  function renderLegend() {
    const box = $("contrib-legend");
    if (!box) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    box.textContent = "";
    [0, 1, 2, 3, 4].forEach((tier) => {
      const item = document.createElement("div");
      item.className = "lg-item";
      let img;
      if (mode === "chart") {
        img = document.createElement("canvas");
        img.width = img.height = 20 * dpr;
        img.style.width = img.style.height = "20px";
        const g = img.getContext("2d");
        g.scale(dpr, dpr);
        paintBlock(g, 0, 0, 20, tier, "legend" + tier);
      } else {
        img = makeSprite(tier ? OAK + tier - 1 : 0, 14, dpr);
        img.style.width = img.width / dpr + "px";
        img.style.height = img.height / dpr + "px";
      }
      const cap = document.createElement("span");
      const name = mode === "chart" ? ORE_TIERS[tier][0] : ["None", "Light", "Medium", "Heavy", "Busiest"][tier];
      cap.textContent = name + (tier ? " " + tierRange(tier) : " 0");
      item.append(img, cap);
      box.appendChild(item);
    });
  }

  // ---- Ore map: flat Minecraft chart. Each day is a stone block; busier days hold richer ore ----
  const CHART = { left: 30, top: 22, bottom: 24, gap: 2 };
  // Ore map: every day is a stone block, and the busier the day the richer the ore in it.
  // Stone is kept dark and dull so the ores stand out.
  const MAP_STONE = ["#5a5a5a", "#616161", "#545454"];
  function paintBlock(g, x, y, sz, tier, seed) {
    const n = sz < 10 ? 2 : 4, h = hash(seed), ore = ORE_TIERS[tier][1];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const k = (Math.imul(i + 1, 73856093) ^ Math.imul(j + 1, 19349663) ^ h) >>> 0;
      g.fillStyle = ore && (k >>> 4) % 100 < (n === 2 ? 60 : 50) ? tint(ore, k % 3 === 0 ? 0.82 : 1) : MAP_STONE[k % 3];
      const x0 = Math.round(x + (i * sz) / n), x1 = Math.round(x + ((i + 1) * sz) / n);
      const y0 = Math.round(y + (j * sz) / n), y1 = Math.round(y + ((j + 1) * sz) / n);
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }

  // One long strip for the whole year, sized to fit the card; on very narrow screens it scrolls sideways.
  function chartLayout() {
    const avail = $("chart-scroll").clientWidth - CHART.left - 4;
    const L = current.weeks.length;
    const cs = Math.max(7, Math.min(22, avail / L));
    const bandH = CHART.top + 7 * cs + CHART.bottom;
    return { cs, bands: 1, perBand: L, bandH, W: CHART.left + cs * L + 4, H: bandH };
  }
  // Top-left corner of a day's tile.
  function chartPos(c, lay) {
    const b = Math.floor(c.w / lay.perBand);
    return [CHART.left + (c.w - b * lay.perBand) * lay.cs, b * lay.bandH + CHART.top + c.d * lay.cs];
  }

  function drawChart() {
    const canvas = $("chart-canvas");
    const wrap = $("chart-scroll");
    if (!current || !wrap.clientWidth) return;
    $("iso-stage").classList.toggle("iso-compact", wrap.clientWidth < 620);
    const lay = chartLayout();
    const { cs, bands, perBand, bandH, W, H } = lay;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const text = (str, x, y, align) => {
      g.textAlign = align;
      g.fillStyle = "#1a1a1a"; // Minecraft-style drop shadow
      g.fillText(str, x + 1, y + 1);
      g.fillStyle = "#ffffff";
      g.fillText(str, x, y);
    };
    for (let b = 0; b < bands; b++) {
      const y0 = b * bandH;
      g.font = "600 11px system-ui, sans-serif";
      g.textBaseline = "middle";
      [[1, "Mon"], [3, "Wed"], [5, "Fri"]].forEach(([d, label]) => text(label, 0, y0 + CHART.top + d * cs + cs / 2, "left"));
      // Month labels at the first week of each month within this band.
      g.textBaseline = "alphabetic";
      let lastMonth = -1, lastX = -Infinity;
      current.cells.forEach((c) => {
        if (Math.floor(c.w / perBand) !== b) return;
        const m = Number(c.date.slice(5, 7));
        if (m === lastMonth) return;
        lastMonth = m;
        if (c.w % perBand === 0 && Number(c.date.slice(8)) > 20) return; // partial month at a band's start
        const x = CHART.left + (c.w - b * perBand) * cs;
        if (x - lastX < 34) return;
        lastX = x;
        text(MONTHS[m - 1], x, y0 + CHART.top - 8, "left");
      });
      // Time arrow under each band.
      const ay = y0 + CHART.top + 7 * cs + 12;
      const end = CHART.left + Math.min(perBand, current.weeks.length - b * perBand) * cs;
      g.strokeStyle = "rgba(255,255,255,0.55)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(CHART.left, ay); g.lineTo(end, ay);
      g.moveTo(end - 4, ay - 3); g.lineTo(end + 1, ay); g.lineTo(end - 4, ay + 3);
      g.stroke();
      g.font = "600 10px system-ui, sans-serif";
      if (b === 0) text("1 year ago", CHART.left, ay - 4, "left");
      if (b === bands - 1) text("today", end, ay - 4, "right");
      else text("continues below", end, ay - 4, "right");
    }
    current.cells.forEach((c) => {
      const [x, y] = chartPos(c, lay);
      paintBlock(g, x, y, cs - CHART.gap, c.tier, c.date);
    });
    const hv = current.hover;
    if (hv) {
      const [x, y] = chartPos(hv, lay);
      g.strokeStyle = "#ffffff";
      g.lineWidth = 2;
      g.strokeRect(x + 1, y + 1, cs - CHART.gap - 2, cs - CHART.gap - 2);
    }
    const hint = $("iso-hint");
    if (hint && mode === "chart") hint.hidden = wrap.scrollWidth <= wrap.clientWidth + 1;
  }

  function chartCellAt(e) {
    const r = $("chart-canvas").getBoundingClientRect();
    const lay = chartLayout();
    const x = e.clientX - r.left - CHART.left, y = e.clientY - r.top;
    const b = Math.floor(y / lay.bandH);
    const d = Math.floor((y - b * lay.bandH - CHART.top) / lay.cs);
    const col = Math.floor(x / lay.cs);
    if (x < 0 || col >= lay.perBand || d < 0 || d > 6 || b < 0 || b >= lay.bands) return null;
    const w = b * lay.perBand + col;
    return current.cells.find((c) => c.w === w && c.d === d) || null;
  }

  function setupChart() {
    const canvas = $("chart-canvas");
    const tip = $("iso-tip");
    const wrapBox = canvas.closest(".iso-wrap");
    const show = (e) => {
      if (!current) return;
      const c = chartCellAt(e);
      if (!c) { tip.style.display = "none"; if (current.hover) { current.hover = null; drawChart(); } return; }
      if (current.hover !== c) { current.hover = c; drawChart(); }
      const n = c.count, r = wrapBox.getBoundingClientRect();
      tip.textContent = n + " contribution" + (n === 1 ? "" : "s") + " on " + fmtDate(c.date, true) + " · " + ORE_TIERS[c.tier][0];
      tip.style.display = "block";
      tip.style.left = Math.max(0, Math.min(e.clientX - r.left + 12, r.width - tip.offsetWidth - 4)) + "px";
      tip.style.top = Math.max(e.clientY - r.top - 30, 0) + "px";
    };
    canvas.addEventListener("pointermove", show);
    canvas.addEventListener("pointerdown", show); // tap on touch screens
    canvas.addEventListener("pointerleave", () => {
      tip.style.display = "none";
      if (current && current.hover) { current.hover = null; drawChart(); }
    });
    $("chart-scroll").addEventListener("scroll", () => { tip.style.display = "none"; });
  }

  // ---- View switching ----
  let mode = "chart";
  const INTRO = {
    forest: "Each tile is <b>one day</b> from the past year of my GitHub. <b>The more I commit that day, the bigger the tree grows.</b>",
    chart: "Each block is <b>one day</b> from the past year of my GitHub, <b>The more I commit that day, the rarer the ore I dig up.</b>",
  };
  function setMode(next) {
    mode = next;
    const chart = next === "chart";
    $("iso-stage").classList.toggle("chart-mode", chart);
    $("contrib-canvas").hidden = chart;
    $("chart-scroll").hidden = !chart;
    $("iso-tip").style.display = "none";
    $("mc-intro").innerHTML = INTRO[next];
    const hint = $("iso-hint");
    hint.textContent = chart ? "swipe to scroll" : "drag to rotate";
    hint.hidden = chart;
    [["view-forest", !chart], ["view-chart", chart]].forEach(([id, on]) => {
      $(id).classList.toggle("on", on);
      $(id).setAttribute("aria-pressed", on);
    });
    if (current) { current.hover = null; renderLegend(); draw(); }
    if (chart) { const sc = $("chart-scroll"); sc.scrollLeft = sc.scrollWidth; } // newest days first on phones
  }
  function draw() { mode === "chart" && $("chart-canvas") ? drawChart() : drawIso(); }

  function requestDraw() {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
  }

  function renderGrid(weeks, total) {
    const cells = buildCells(weeks);
    assignTiers(cells);
    if (total === undefined) total = cells.reduce((n, c) => n + c.count, 0);
    current = { weeks, total, cells, hits: [] };
    draw();
    renderStats(cells, total);
    renderLegend();
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


  function renderCommit(repo) {
    const c = repo.commit;
    $("commit-msg").textContent = c ? c.messageHeadline : repo.name;
    $("commit-link").href = c ? c.url : repo.url;
    const name = $("commit-repo");
    name.textContent = repo.name;
    name.href = repo.url;
    $("commit-hash").textContent = c && c.abbreviatedOid ? c.abbreviatedOid : "";
    $("commit-details").textContent = c ? timeAgo(c.committedDate) : "";
  }

  async function loadGithub() {
    try {
      const data = await getJSON("/.netlify/functions/github");
      $("github-total").textContent = data.total.toLocaleString() + " contributions in the last year";
      renderGrid(data.weeks, data.total);
      if (data.repo) renderCommit(data.repo);
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
        $("oura").style.display = "none";
        $("oura-wrap").style.display = "none";
        return;
      }
      data = SAMPLE_OURA;
    }
    const num = (v) => typeof v === "number";
    const set = (id, text) => { $(id).textContent = text; };
    const join = (parts) => parts.filter(Boolean).join(" · ");
    if (data.day) {
      set("oura-day", new Date(data.day + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" }));
    }

    set("o-sleep-sub", join([
      num(data.sleep) && `Score ${data.sleep}`,
      num(data.sleepEfficiency) && `${data.sleepEfficiency}% efficiency`,
    ]));
    set("o-hr-sub", join([
      num(data.hrv) && `HRV ${Math.round(data.hrv)} ms`,
      num(data.readiness) && `Readiness ${data.readiness}`,
    ]));
    set("o-steps-sub", join([
      num(data.activeCalories) && `${data.activeCalories} active cal`,
      num(data.activity) && `Activity ${data.activity}`,
    ]));

    // HUD gauges: readiness = ultimate charge, sleep = HP, activity = energy
    const RANKS = [[50, "Bronze"], [60, "Silver"], [70, "Gold"], [78, "Platinum"], [85, "Diamond"], [90, "Grandmaster"], [95, "Celestial"], [100, "Eternity"]];
    const rankFor = (v) => (RANKS.find(([max]) => v < max) || [0, "One Above All"])[1];
    const card = $("oura-card");
    const gauges = () => {
      if (num(data.readiness)) {
        $("o-ult-fill").style.strokeDashoffset = 100 - data.readiness;
        card.classList.toggle("ult-ready", data.readiness >= 80);
      }
      if (num(data.sleep)) $("o-hp-fill").style.width = data.sleep + "%";
      if (num(data.activity)) $("o-en-fill").style.width = data.activity + "%";
    };
    set("o-ready", num(data.readiness) ? data.readiness : "--");
    set("o-sleep-score", num(data.sleep) ? data.sleep : "--");
    set("o-activity-score", num(data.activity) ? data.activity : "--");
    if (num(data.readiness)) {
      set("o-rank", rankFor(data.readiness));
      set("o-ult-status", data.readiness >= 80 ? "Ultimate ready" : `Ultimate charging ${data.readiness}%`);
    }

    // Count-up when the card scrolls into view
    const stats = [
      [num(data.sleepSeconds), "o-sleep", data.sleepSeconds / 60, (m) => `${Math.floor(m / 60)}h ${m % 60}m`],
      [num(data.restingHr), "o-hr", data.restingHr, (v) => `${v} bpm`],
      [num(data.steps), "o-steps", data.steps, (v) => v.toLocaleString()],
    ].filter((x) => x[0]);
    const run = () => {
      const start = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - start) / 1300);
        const k = 1 - Math.pow(1 - t, 3);
        stats.forEach(([, id, target, fmt]) => set(id, fmt(Math.round(target * k))));
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    const final = () => { stats.forEach(([, id, target, fmt]) => set(id, fmt(Math.round(target)))); gauges(); };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      final();
    } else {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { io.disconnect(); run(); gauges(); }
      }, { threshold: 0.1 });
      io.observe($("oura-card"));
    }

    // Ring tilts toward the cursor
    const ring = document.querySelector(".oura-ring");
    const wrap = $("oura-ring-wrap");
    if (ring && matchMedia("(hover: hover)").matches) {
      wrap.addEventListener("mousemove", (e) => {
        const r = wrap.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        ring.style.transform = `rotateY(${x * 40}deg) rotateX(${-y * 40}deg)`;
      });
      wrap.addEventListener("mouseleave", () => { ring.style.transform = ""; });
    }
  }

  // The chart toggle is optional: if its markup is missing, the rest of the section must still load.
  setupHover();
  if ($("chart-canvas") && $("chart-scroll") && $("view-chart")) {
    setupChart();
    // Where the ore map's blocks would come out under ~10px (too small for the ore texture to read), start on the forest instead.
    const scrolls = document.querySelector(".iso-wrap").clientWidth - CHART.left - 4 < 10 * 53;
    if (scrolls) $("view-chart").before($("view-forest")); // default view goes on the left
    setMode(scrolls ? "forest" : "chart");
    $("view-forest").addEventListener("click", () => setMode("forest"));
    $("view-chart").addEventListener("click", () => setMode("chart"));
  }
  loadGithub();
  loadOura();
})();
