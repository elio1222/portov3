  if (document.querySelector('.projects').clientWidth <= 450) {
    document.getElementById('proj').textContent = "PROJECTS | SWIPE TO EXPLORE ->"
  }
  
// intro: typewriter greeting (types, holds, deletes, repeats)
(function () {
  const el = document.getElementById('typed');
  if (!el) return;
  const text = el.textContent;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let i = 0, deleting = false;
  el.textContent = '';
  function step() {
    i += deleting ? -1 : 1;
    el.textContent = text.slice(0, i);
    let delay = deleting ? 35 : 75;
    if (!deleting && i === text.length) { deleting = true; delay = 3500; }
    else if (deleting && i === 0) { deleting = false; delay = 600; }
    setTimeout(step, delay);
  }
  setTimeout(step, 400);
})();

// project carousel: one centered card, neighbours peeking in from the sides
(function () {
  const track = document.querySelector('.projects');
  const prev = document.getElementById('proj-prev');
  const next = document.getElementById('proj-next');
  const dotsEl = document.getElementById('proj-dots');
  if (!track || !prev || !next || !dotsEl) return;
  const cards = Array.from(track.querySelectorAll('.project'));
  if (cards.length < 2) return;

  const centerLeft = (i) => cards[i].offsetLeft - (track.clientWidth - cards[i].offsetWidth) / 2;
  function currentIndex() {
    const mid = track.scrollLeft + track.clientWidth / 2;
    let best = 0, bestDist = Infinity;
    cards.forEach((c, i) => {
      const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }
  let target = null, settle = null;
  function scrollToIndex(idx) {
    target = idx;
    clearTimeout(settle);
    settle = setTimeout(() => { target = null; }, 700);
    track.scrollTo({ left: centerLeft(idx), behavior: 'smooth' });
  }

  // Elio stands facing us; on a click he turns side-on and shoves the carousel the way it travels
  const hero = document.getElementById('pj-char');
  const wrap = track.parentElement;
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // frames stop in background tabs, so fall back to timers there
  const frame = (f) => (document.hidden ? setTimeout(() => f(performance.now()), 50) : requestAnimationFrame(f));
  let busy = false, pending = null;

  function pose(name, face = 1) {
    hero.className = 'pj-char ' + name;
    hero.style.setProperty('--fx', face);
  }
  // he stays put at the card's right edge, facing us; the carousel moves, he doesn't
  function place() {
    if (!hero) return;
    const c = cards[0];
    // dead centre of the gap between the centred card and its (shrunken) right neighbour
    const gap = parseFloat(getComputedStyle(track).columnGap) || 16;
    const mid = track.offsetLeft + track.clientWidth / 2 + c.offsetWidth / 2 + (gap + 0.05 * c.offsetWidth) / 2;
    hero.style.left = (mid - hero.offsetWidth / 2) + 'px';
    hero.style.top = (track.offsetTop + c.offsetTop + c.offsetHeight - hero.offsetHeight + 8) + 'px';
  }
  const rest = () => pose('idle');
  const settled = (idx) => new Promise((res) => {
    const t0 = performance.now();
    (function chk() {
      if (Math.abs(track.scrollLeft - centerLeft(idx)) < 2 || performance.now() - t0 > 1800) res();
      else frame(chk);
    })();
  });
  function finish() {
    busy = false;
    if (pending !== null) { const p = pending; pending = null; goTo(p); }
  }
  // turn side-on towards the way the carousel travels, wind up and shove while it slides, then face us again
  async function pushTo(idx, dir) {
    busy = true;
    pose('push', -dir);
    await sleep(240);
    scrollToIndex(idx);
    await settled(idx);
    rest();
    await sleep(160);
    finish();
  }

  function goTo(i) {
    const idx = Math.max(0, Math.min(cards.length - 1, i));
    const cur = target ?? currentIndex();
    if (!hero || calm || idx === cur || Math.abs(idx - cur) > 1) { scrollToIndex(idx); return; }
    if (busy) { pending = idx; return; }
    pushTo(idx, idx > cur ? 1 : -1);
  }
  function update() {
    const idx = currentIndex();
    cards.forEach((c, i) => c.classList.toggle('is-active', i === idx));
    Array.from(dotsEl.children).forEach((d, i) => d.classList.toggle('active', i === idx));
    prev.disabled = idx === 0;
    next.disabled = idx === cards.length - 1;
  }
  cards.forEach((c, i) => {
    const d = document.createElement('button');
    d.type = 'button';
    d.className = 'proj-dot';
    d.setAttribute('aria-label', 'Go to project ' + (i + 1));
    d.addEventListener('click', () => goTo(i));
    dotsEl.appendChild(d);
    // clicking a peeking neighbour brings it to the centre
    c.addEventListener('click', () => { if (!c.classList.contains('is-active')) goTo(i); });
  });

  prev.addEventListener('click', () => goTo((target ?? currentIndex()) - 1));
  next.addEventListener('click', () => goTo((target ?? currentIndex()) + 1));
  track.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', () => { track.scrollTo({ left: centerLeft(currentIndex()), behavior: 'auto' }); update(); if (hero && !busy) place(); });
  update();
  if (hero) { place(); window.addEventListener('load', () => { if (!busy) place(); }); }
})();


/* Footer: local time + weather for Bowie, MD (Open-Meteo, no API key needed) */
(function () {
  const timeEl = document.getElementById('ft-time');
  if (!timeEl) return;
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const tick = () => { timeEl.textContent = fmt.format(new Date()); };
  tick();
  setInterval(tick, 15000);

  const codes = [
    [[0], 'Clear', '☀️'], [[1, 2], 'Partly cloudy', '⛅'], [[3], 'Cloudy', '☁️'],
    [[45, 48], 'Fog', '🌫️'], [[51, 53, 55, 56, 57], 'Drizzle', '🌦️'],
    [[61, 63, 65, 66, 67, 80, 81, 82], 'Rain', '🌧️'], [[71, 73, 75, 77, 85, 86], 'Snow', '❄️'],
    [[95, 96, 99], 'Thunderstorm', '⛈️']
  ];
  const describe = c => (codes.find(x => x[0].includes(c)) || [0, 'Weather', '🌡️']).slice(1);
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=38.943&longitude=-76.730'
    + '&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=America%2FNew_York';
  const load = () => fetch(url).then(r => r.ok ? r.json() : Promise.reject()).then(d => {
    const cur = d.current;
    const [label, icon] = describe(cur.weather_code);
    const el = document.getElementById('ft-weather');
    el.textContent = icon + ' ' + Math.round(cur.temperature_2m) + '°F, ' + label;
    el.hidden = false;
    document.getElementById('ft-wsep').hidden = false;
  }).catch(() => {});
  load();
  setInterval(load, 15 * 60 * 1000);
})();


// education: upgrade timer counting down to graduation
(function () {
  const box = document.getElementById('edu-upgrade');
  const timeEl = document.getElementById('edu-time');
  const fill = document.getElementById('edu-fill');
  const pct = document.getElementById('edu-pct');
  const bar = document.getElementById('edu-bar');
  const elixir = document.getElementById('hud-elixir');
  if (!box || !timeEl || !fill || !pct) return;
  const start = new Date(box.dataset.start + 'T00:00:00').getTime();
  const end = new Date(box.dataset.end + 'T00:00:00').getTime();
  function tick() {
    const now = Date.now();
    const left = Math.max(0, end - now);
    const p = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
    const d = Math.floor(left / 864e5);
    const h = Math.floor(left / 36e5) % 24;
    const m = Math.floor(left / 6e4) % 60;
    const s = Math.floor(left / 1e3) % 60;
    timeEl.textContent = left ? d + 'd ' + h + 'h ' + m + 'm ' + s + 's' : 'Complete';
    fill.style.width = p.toFixed(2) + '%';
    pct.textContent = Math.floor(p) + '%';
    if (elixir) elixir.style.width = p.toFixed(2) + '%';
    if (bar) bar.setAttribute('aria-valuenow', Math.floor(p));
  }
  tick();
  setInterval(tick, 1000);
})();

// every "#top" link (ROCHA brand, footer) scrolls all the way to the very top: #top is the sticky header, so the browser's anchor jump does nothing
document.querySelectorAll('a[href="#top"]').forEach((a) => a.addEventListener("click", function (e) {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
}));

// footer name: generative 3D parallax. Stacked copies of the name drift by depth with the pointer; at rest it holds a fixed 3D angle
(function () {
    const h = document.querySelector(".ft-name");
    if (!h) return;
    const text = h.textContent.trim();
    const N = 9;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const layers = [];
    h.textContent = "";
    for (let i = 0; i < N; i++) {
        const front = i === N - 1;
        const l = document.createElement("span");
        l.className = "pl" + (front ? "" : " back");
        l.setAttribute("aria-hidden", "true");
        if (!front) {
            const t = i / (N - 1);
            l.style.setProperty("--s", i === N - 2 ? "#ffd54a" : "hsl(250 " + Math.round(25 + 35 * t) + "% " + Math.round(28 + 38 * t) + "%)");
        }
        l.style.zIndex = i;
        const letters = [];
        for (const ch of text) {
            const s = document.createElement("span");
            s.textContent = ch;
            l.appendChild(s);
    
        }
        h.appendChild(l);
        layers.push({ el: l, letters: letters, d: (i - (N - 1)) / (N - 1) });
    }
    let tx = 0.45, ty = 0.5, cx = 0.45, cy = 0.5, active = false, raf = 0, pointer = false;
    function frame(now) {
        if (!pointer) { tx = 0.45; ty = 0.5; }
        cx += (tx - cx) * 0.08;
        cy += (ty - cy) * 0.08;
        for (const L of layers) {
            L.el.style.transform = "translate(" + (cx * L.d * 26).toFixed(2) + "px," + (cy * L.d * 16).toFixed(2) + "px)";
        }
        raf = active && !still && (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001) ? requestAnimationFrame(frame) : 0;
    }
    function aim(e) {
        const r = h.getBoundingClientRect();
        tx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2)));
        ty = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2)));
        pointer = true;
    }
    function wake() { if (!raf && active) raf = requestAnimationFrame(frame); }
    window.addEventListener("pointermove", function (e) { aim(e); wake(); }, { passive: true });
    document.addEventListener("pointerleave", function () { pointer = false; wake(); });
    new IntersectionObserver(function (en) {
        active = en[0].isIntersecting;
        if (active && !raf) raf = requestAnimationFrame(frame);
    }).observe(h);
    frame(performance.now());
})();
