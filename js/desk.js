// hand-drawn desk scene: live date, day/night window, clickable parts
(function () {
  const svg = document.getElementById('desk-svg');
  if (!svg) return;
  const $ = (id) => document.getElementById(id);
  const caption = $('desk-caption');
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  let skyMode = 'auto';   // auto | day | night (window click cycles it)
  let lampOverride = null; // null = follows night, else true/false
  let sips = 0;
  let snacks = 0;
  const SNACKS = ['a handful of chips', 'a cookie', 'a candy bar', 'more chips'];
  const SIP_LEVELS = [44, 34, 24, 14, 5];

  const say = (msg) => { if (caption) caption.textContent = msg; };
  const isDaytime = (d) => d.getHours() >= 7 && d.getHours() < 19;

  function render() {
    const now = new Date();
    $('cal-mon').textContent = MONTHS[now.getMonth()];
    $('cal-day').textContent = now.getDate();

    const night = skyMode === 'auto' ? !isDaytime(now) : skyMode === 'night';
    $('sky').setAttribute('fill', night ? '#1d2650' : '#cfe6fb');
    $('sky-day').style.display = night ? 'none' : '';
    $('sky-night').style.display = night ? '' : 'none';
    $('city-lights').style.display = night ? '' : 'none';
    svg.classList.toggle('night', night);

    const lampOn = lampOverride === null ? night : lampOverride;
    $('lamp-glow').setAttribute('opacity', lampOn ? '0.4' : '0');
    $('d-lamp').classList.toggle('lit', lampOn);
    $('lamp-beam').setAttribute('opacity', lampOn ? '0.16' : '0');

    // desk clock always shows the real time and whether it is day or night outside
    const real = isDaytime(now);
    const parts = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).split(/\s+/);
    $('clock-time').textContent = parts[0];
    $('clock-ampm').textContent = parts[1] || '';
    $('clock-sun').style.display = real ? '' : 'none';
    $('clock-moon').style.display = real ? 'none' : '';
    return night;
  }

  // actions
  const actions = {
    'd-window': () => {
      skyMode = skyMode === 'auto' ? (isDaytime(new Date()) ? 'night' : 'day') : 'auto';
      const night = render();
      say(skyMode === 'auto' ? 'Window follows your local time again.' : 'Previewing ' + (night ? 'night' : 'daytime') + '. Click again to go back.');
    },
    'd-lamp': () => {
      const night = render();
      const on = lampOverride === null ? night : lampOverride;
      lampOverride = !on;
      render();
      say(lampOverride ? 'Lamp on.' : 'Lamp off.');
    },
    'd-bottle': () => {
      sips++;
      const lvl = SIP_LEVELS[sips % SIP_LEVELS.length];
      const h = lvl, w = $('water');
      w.setAttribute('y', 276 - h);
      w.setAttribute('height', h);
      say(sips % SIP_LEVELS.length === 0 ? 'Refilled the bottle. Stay hydrated.' : 'Sip #' + sips + '. Hydration check passed.');
    },
    'd-clock': () => {
      const now = new Date();
      say('It is ' + now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ', ' + (isDaytime(now) ? 'daytime' : 'night') + ' in Bowie.');
    },
    'd-trash': () => { say('A bunch empty water bottles. Recycling is on the to-do list.'); },
    'd-snacks': () => { say('Snack break: ' + SNACKS[snacks++ % SNACKS.length] + '.'); },
    'd-cal': () => {
      const d = new Date();
      say('Today is ' + d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) + '. Heading to my GitHub activity...');
    },
  };

  svg.querySelectorAll('.hot').forEach((el) => {
    const run = (e) => {
      const fn = actions[el.id];
      if (fn) fn();
      const msg = el.dataset.say;
      if (msg) say(msg);
      const go = el.dataset.go;
      if (go) {
        if (go.startsWith('#')) { const t = document.querySelector(go); if (t) t.scrollIntoView({ behavior: 'smooth' }); }
        else window.open(go, '_blank', 'noopener');
      }
    };
    el.addEventListener('click', run);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(e); } });
  });
  $('d-claude').addEventListener('click', () => say('Built with a lot of help from Claude Code.'));

  render();
  setInterval(render, 30000); // keeps the date, clock and daylight current

  // phones: crop the scene to you and the desk so it fits the screen with no scrolling
  const FULL_VIEW = svg.getAttribute('viewBox');
  const PHONE_VIEW = '316 30 580 272';
  const mq = window.matchMedia('(max-width: 700px)');
  const applyView = () => {
    svg.setAttribute('viewBox', mq.matches ? PHONE_VIEW : FULL_VIEW);
    // phones: the scene is a picture only, so take its parts out of the tab order too
    svg.querySelectorAll('.hot').forEach((el) => el.setAttribute('tabindex', mq.matches ? '-1' : '0'));
  };
  applyView();
  if (mq.addEventListener) mq.addEventListener('change', applyView);
})();
