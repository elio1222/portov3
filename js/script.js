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

  // Elio leans on the centred card: forward he shoves it along, backward it topples onto him
  const hero = document.getElementById('pj-char');
  const wrap = track.parentElement;
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // frames stop in background tabs, so fall back to timers there
  const frame = (f) => (document.hidden ? setTimeout(() => f(performance.now()), 50) : requestAnimationFrame(f));
  let busy = false, pending = null;

  function pose(name, face) {
    hero.className = 'pj-char ' + name;
    hero.style.setProperty('--fx', face === undefined ? 1 : face);
  }
  // he stays put at the card's right edge: forward he shoves the card left, back he shoves the neighbour right
  function place() {
    if (!hero) return;
    const c = cards[0];
    hero.style.left = (track.offsetLeft + track.clientWidth / 2 + c.offsetWidth / 2 + 12) + 'px';
    hero.style.top = (track.offsetTop + c.offsetTop + c.offsetHeight - hero.offsetHeight + 8) + 'px';
  }
  const rest = () => pose('lean', 1);
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
  // a quick shove in the direction of travel while the carousel slides, then back to leaning
  async function pushTo(idx, dir) {
    busy = true;
    pose('push', -dir);
    await sleep(110);
    scrollToIndex(idx);
    await settled(idx);
    rest();
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
    if (bar) bar.setAttribute('aria-valuenow', Math.floor(p));
  }
  tick();
  setInterval(tick, 1000);
})();
