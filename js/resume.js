(function () {
  const PDF_URL = "styles/Rocha's Resume.pdf";
  const paper = document.getElementById('rs-paper');
  const canvas = document.getElementById('rs-canvas');
  const loading = document.getElementById('rs-loading');
  const tilt = document.getElementById('rs-tilt');
  if (!paper || !canvas) return;

  // render the real PDF so the preview never goes stale when the file is updated
  async function render() {
    if (!window.pdfjsLib) throw new Error('pdf.js unavailable');
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument(encodeURI(PDF_URL)).promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const cssWidth = paper.clientWidth || 540;
    const scale = (cssWidth * Math.min(window.devicePixelRatio || 1, 3)) / base.width;
    const vp = page.getViewport({ scale });
    canvas.width = vp.width;
    canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    paper.classList.add('is-ready');
  }

  render().catch(() => {
    // no pdf.js (offline / blocked): fall back to the browser's own viewer
    loading.textContent = 'Tap to open resume';
  });

  // pointer tilt + glare (mouse/pen only; touch just taps through to the PDF)
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  const MAX = 9;
  tilt.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const r = tilt.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    tilt.classList.add('is-moving');
    tilt.style.setProperty('--ry', ((x - 0.5) * 2 * MAX).toFixed(2) + 'deg');
    tilt.style.setProperty('--rx', ((0.5 - y) * 2 * MAX).toFixed(2) + 'deg');
    tilt.style.setProperty('--gx', (x * 100).toFixed(1) + '%');
    tilt.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
  });
  tilt.addEventListener('pointerleave', () => {
    tilt.classList.remove('is-moving');
    tilt.style.setProperty('--rx', '0deg');
    tilt.style.setProperty('--ry', '0deg');
  });
})();
