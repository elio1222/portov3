// project detail modal + "all projects" window
(function () {
  const cards = Array.from(document.querySelectorAll('.projects .project'));
  if (!cards.length) return;

  // extra detail shown in the expanded view, keyed by GitHub repo name
  const DETAILS = {
    'product-owner': {
      overview: 'po is a CLI that models work as interconnected issues, tracks their status, and lets you declare how they block each other. Everything lives in a local SQLite database inside .po/ at the root of each project, so there is no cloud, no account and no server. It is built for a single engineer or an autonomous agent.',
      points: [
        'One module per subcommand (init, create, list, show, update, ready, close, block, comment, log), each registering itself with argparse',
        'Business logic kept separate from the CLI layer, with Pydantic models for issues, dependencies, comments and events',
        'Dependency-aware: issues can block one another, so you can see what is ready to work on',
        'Installs as a real po command and keeps per-project state in .po/'
      ]
    },
    'oura-health-analytics': {
      overview: 'A FastAPI service that pulls data from the Oura API over OAuth, stores both raw and processed records in PostgreSQL, computes custom health summaries and generates AI-assisted insights from recent sleep, readiness and stress data.',
      points: [
        'ETL pipelines fetch sleep, readiness, stress and activity data, save raw records, then transform them into processed analytics tables',
        'Layered design: API routes, services (Oura, analytics, AI), repositories and pipelines/jobs',
        'REST endpoints for querying data and summaries',
        'OpenAI structured outputs turn the numbers into readable insights',
        'Runs with Docker Compose alongside PostgreSQL'
      ]
    },
    'vllm-ec2-chat-app': {
      overview: 'A small full-stack chat app with email/password authentication, cookie-based sessions, persistent chat history and a model-backed assistant. It is hosted on AWS behind an nginx reverse proxy.',
      points: [
        'FastAPI backend with SQLAlchemy and SQLite for users, sessions and chats',
        'bcrypt password hashing and hashed, revocable session tokens delivered in HttpOnly cookies',
        'Conversation context is passed to a model API when generating replies',
        'Plain HTML, CSS and JavaScript client for register, login and chat',
        'nginx serves the frontend and forwards /api to FastAPI; a health endpoint supports monitoring'
      ]
    },
    'aws-gitea-deployment': {
      overview: 'A self-hosted Gitea server running in Docker on an AWS EC2 instance. Data persists beyond the container lifecycle on a dedicated EBS volume, and backups go to S3.',
      points: [
        'EBS volume formatted as ext4, bind-mounted into the container and mounted at boot through /etc/fstab',
        'Minimal Dockerfile based on the official Gitea image',
        'S3 bucket plus an IAM role for backups, with documented restore procedures',
        'Written up step by step with the exact commands used'
      ]
    },
    'keynotes': {
      overview: 'KeyNotes transforms messy handwritten lecture notes into clean, structured, AI-organized study notes. Built at Hoya Hacks 2026 to make studying faster and less stressful.',
      points: [
        'Upload a photo of handwritten notes and optionally add a question or description',
        'Gemini turns the image into structured text, summaries and explained key concepts',
        'Preview the organized notes in the browser, then download them as a PDF',
        'Django REST API backend with a plain HTML, CSS and JavaScript frontend',
        'Next up: accounts with saved history and more export formats'
      ]
    },
    'oura-dashboard': {
      overview: 'My first full-stack project: a dashboard that fetches, stores, visualizes and analyzes my own sleep data from the Oura Ring API.',
      points: [
        'Line charts for sleep score, REM, deep sleep and total sleep duration over time',
        'Pie chart breaking down last night into awake, light, deep and REM',
        'Custom date ranges for personalized sleep reports',
        'Data is fetched dynamically through a Flask backend connected to the Oura API'
      ]
    },
    'FlowGoAI': {
      overview: 'Transcribe your thoughts and summarize them with AI. A Django REST backend handles audio and summaries while a TypeScript frontend provides the notes experience.',
      points: [
        'Audio transcription and AI summarization of spoken thoughts',
        'Django REST framework backend with CORS configured for a separate frontend',
        'Next.js, React and TypeScript frontend'
      ]
    },
    'weather-app': {
      overview: 'Check real-time weather data for any city. A Django app that pulls current conditions from a weather API and presents them in a simple interface.',
      points: [
        'Search any city for live conditions',
        'Django backend that handles the external API calls',
        'HTML, CSS and JavaScript interface'
      ]
    },
    'ticker-tracker': {
      overview: 'Track your favorite stocks in one place with a lightweight Flask app and a browser frontend.',
      points: [
        'Keep a list of tickers and check on them quickly',
        'Flask backend serving a HTML, CSS and JavaScript frontend'
      ]
    },
    'compiler-project': {
      overview: 'A mini compiler for a custom language, written in Java.',
      points: [
        'Takes source code in a small custom language through the stages of compilation',
        'Written entirely in Java'
      ]
    },
    'vendingmachine': {
      overview: 'A small Java program that simulates a vending machine.',
      points: [
        'Models the machine, its stock and purchases in plain Java',
        'An early exercise in object-oriented design'
      ]
    }
  };

  const X_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  const dlg = document.createElement('dialog');
  dlg.className = 'pm';
  dlg.setAttribute('aria-label', 'Project details');
  document.body.appendChild(dlg);

  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // pull everything displayable off a card so the markup stays the single source of truth
  function read(card) {
    const q = (s) => card.querySelector(s);
    const gh = q('.proj-gh');
    const repo = q('.proj-open').dataset.repo;
    return {
      repo,
      img: q('.proj-img img').getAttribute('src'),
      year: q('.proj-eyebrow').textContent,
      name: q('.proj-name').textContent,
      desc: q('.proj-desc').textContent,
      langs: q('.proj-langs').outerHTML,
      bar: q('.proj-bar').outerHTML,
      tools: q('.proj-tools') ? q('.proj-tools').outerHTML.replace(/<span>Tech stack<\/span>/, '') : '',
      url: gh ? gh.href : 'https://github.com/elio1222/' + repo
    };
  }
  const data = cards.map(read);

  let fromAll = false;
  let opener = null;

  function open() {
    if (!dlg.open) {
      opener = document.activeElement;
      dlg.showModal();
      document.body.classList.add('pm-lock');
    }
  }

  function detailHTML(i) {
    const p = data[i];
    const d = DETAILS[p.repo] || { overview: p.desc, points: [] };
    return (
      '<div class="pm-panel is-detail">' +
        (fromAll ? '<button class="pm-back" type="button" data-act="all">&larr; All projects</button>' : '') +
        '<button class="pm-x" type="button" data-act="close" aria-label="Close">' + X_ICON + '</button>' +
        '<div class="pm-hero"><img src="' + esc(p.img) + '" alt=""></div>' +
        '<div class="pm-body">' +
          '<div class="pm-eyebrow">' + esc(p.year) + '</div>' +
          '<h2 class="pm-title">' + esc(p.name) + '</h2>' +
          '<p class="pm-tagline">' + esc(p.desc) + '</p>' +
          '<div class="pm-sec"><h3>Overview</h3><p>' + esc(d.overview) + '</p></div>' +
          (d.points.length ? '<div class="pm-sec"><h3>Highlights</h3><ul>' + d.points.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul></div>' : '') +
          '<div class="pm-row">' +
            '<div class="pm-sec"><h3>Languages</h3>' + p.langs + p.bar + '</div>' +
            (p.tools ? '<div class="pm-sec"><h3>Tech stack</h3>' + p.tools + '</div>' : '') +
          '</div>' +
          '<div class="pm-foot"><a class="pm-btn" href="' + esc(p.url) + '" target="_blank" rel="noopener">View on GitHub &#8599;</a></div>' +
        '</div>' +
      '</div>');
  }

  const MAX_FIT = 5;
  // every preview gets the same frame; shrink the optional bits until the longest project fits, then use that level for all
  function fitLevelFor(panel) {
    const bd = panel.querySelector('.pm-body');
    for (let lv = 0; lv <= MAX_FIT; lv++) {
      panel.className = 'pm-panel is-detail' + (lv ? ' fit-' + lv : '');
      if (bd.scrollHeight <= bd.clientHeight + 1) return lv;
    }
    return MAX_FIT;
  }
  function showDetail(i, viaAll) {
    fromAll = !!viaAll;
    open();
    let lv = 0;
    for (let k = 0; k < data.length; k++) {
      dlg.innerHTML = detailHTML(k);
      lv = Math.max(lv, fitLevelFor(dlg.querySelector('.pm-panel')));
    }
    dlg.innerHTML = detailHTML(i);
    const panel = dlg.querySelector('.pm-panel');
    panel.className = 'pm-panel is-detail' + (lv ? ' fit-' + lv : '');
    panel.scrollTop = 0;
  }

  function showAll() {
    fromAll = false;
    dlg.innerHTML =
      '<div class="pm-panel">' +
        '<button class="pm-x" type="button" data-act="close" aria-label="Close">' + X_ICON + '</button>' +
        '<div class="pm-all">' +
          '<h2>All projects</h2>' +
          '<p>' + data.length + ' projects. Pick one to see the details.</p>' +
          '<div class="pm-grid">' +
            data.map((p, i) =>
              '<button class="pm-tile" type="button" data-i="' + i + '">' +
                '<div class="pm-tile-img"><img src="' + esc(p.img) + '" alt="" loading="lazy"></div>' +
                '<div class="pm-tile-body">' +
                  '<div class="pm-tile-year">' + esc(p.year) + '</div>' +
                  '<div class="pm-tile-name">' + esc(p.name) + '</div>' +
                  '<div class="pm-tile-desc">' + esc(p.desc) + '</div>' +
                  p.langs +
                '</div>' +
              '</button>').join('') +
          '</div>' +
        '</div>' +
      '</div>';
    dlg.querySelector('.pm-panel').scrollTop = 0;
    open();
  }

  function close() {
    if (dlg.open) dlg.close();
  }
  dlg.addEventListener('close', () => {
    document.body.classList.remove('pm-lock');
    if (opener && opener.focus && document.contains(opener)) opener.focus();
    opener = null;
  });

  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) { close(); return; }
    const tile = e.target.closest('.pm-tile');
    if (tile) { showDetail(+tile.dataset.i, true); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'close') close();
    else if (act.dataset.act === 'all') showAll();
  });
  // the dialog box itself is transparent and fills the panel, so a click outside the panel lands on the dialog
  dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) close(); });

  cards.forEach((c, i) => {
    const b = c.querySelector('.proj-open');
    if (b) b.addEventListener('click', (e) => { e.stopPropagation(); showDetail(i, false); });
  });

  const allBtn = document.getElementById('proj-all');
  if (allBtn) allBtn.addEventListener('click', showAll);
})();
