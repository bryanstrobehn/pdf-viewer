// PDF.js worker (CDN, same version as the main script)
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── Tauri API ────────────────────────────────────────────────────────────────
const { invoke } = window.__TAURI__.core;
const { listen }  = window.__TAURI__.event;

// ── State ────────────────────────────────────────────────────────────────────
let pdfDoc    = null;
let scale     = 1.0;
let renderGen = 0;   // increment to cancel stale render loops

const RECENT_KEY = 'viewdafile-recent';
const MAX_RECENT = 12;
const ZOOM_STEP  = 0.15;
const ZOOM_MIN   = 0.25;
const ZOOM_MAX   = 5.0;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const openBtn        = document.getElementById('openBtn');
const closeBtn       = document.getElementById('closeBtn');
const filenameEl     = document.getElementById('filename');
const pageinfoEl     = document.getElementById('pageinfo');
const viewport       = document.getElementById('viewport');
const emptyState     = document.getElementById('empty-state');
const pagesContainer = document.getElementById('pages-container');
const zoomControls   = document.getElementById('zoom-controls');
const zoomOutBtn     = document.getElementById('zoomOutBtn');
const zoomInBtn      = document.getElementById('zoomInBtn');
const zoomFitBtn     = document.getElementById('zoomFitBtn');
const zoomLevelEl    = document.getElementById('zoomLevel');
const recentTilesEl  = document.getElementById('recent-tiles');
const recentSection  = document.getElementById('recent-section');

// Tauri window handle for title bar updates
const tauriWindow = window.__TAURI__?.window?.getCurrentWindow?.();

// ── Recent files (localStorage) ───────────────────────────────────────────────
function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
  catch { return []; }
}

function saveToRecent(path, name, author = '', modified = null) {
  let recent = getRecent().filter(r => r.path !== path);
  recent.unshift({ path, name, author, modified, ts: Date.now() });
  if (recent.length > MAX_RECENT) recent = recent.slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(unixSecs) {
  return new Date(unixSecs * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function removeFromRecent(path) {
  const recent = getRecent().filter(r => r.path !== path);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

function renderRecentTiles() {
  const recent = getRecent();
  if (recent.length === 0) {
    recentSection.style.display = 'none';
    return;
  }
  recentSection.style.display = 'block';
  recentTilesEl.innerHTML = '';
  for (const item of recent) {
    const tile = document.createElement('div');
    tile.className = 'recent-tile';
    tile.innerHTML = `
      <div class="recent-tile-icon">PDF</div>
      <div class="recent-tile-name" title="${esc(item.path)}">${esc(item.name)}</div>
      ${item.author   ? `<div class="recent-tile-meta">${esc(item.author)}</div>` : ''}
      ${item.modified ? `<div class="recent-tile-meta">${formatDate(item.modified)}</div>` : ''}
    `;
    tile.addEventListener('click', () => loadFromPath(item.path));
    recentTilesEl.appendChild(tile);
  }
}

// ── Load PDF ─────────────────────────────────────────────────────────────────
async function loadFromPath(filePath) {
  try {
    const bytes = await invoke('read_pdf_file', { path: filePath });
    const uint8 = new Uint8Array(bytes);
    const doc   = await pdfjsLib.getDocument({ data: uint8 }).promise;

    pdfDoc = doc;
    scale  = 1.0;
    updateZoomDisplay();

    const name = filePath.replace(/\\/g, '/').split('/').pop();
    filenameEl.textContent = name;
    tauriWindow?.setTitle(`${name} — ViewDaFile`);

    // Fetch PDF author and file modified date in parallel, best-effort
    const [author, modified] = await Promise.all([
      doc.getMetadata().then(m => m?.info?.Author || '').catch(() => ''),
      invoke('get_file_modified', { path: filePath }).catch(() => null),
    ]);
    saveToRecent(filePath, name, author, modified);

    emptyState.style.display     = 'none';
    pagesContainer.style.display = 'flex';
    closeBtn.style.display       = 'inline-block';
    zoomControls.style.display   = 'flex';

    await renderAllPages();
  } catch (err) {
    console.error('Failed to load PDF:', err);
    removeFromRecent(filePath);
    renderRecentTiles();
    filenameEl.textContent = 'error opening file';
  }
}

// ── Close file ────────────────────────────────────────────────────────────────
function closeFile() {
  renderGen++;   // cancel any in-flight render
  pdfDoc = null;
  scale  = 1.0;
  updateZoomDisplay();

  pagesContainer.innerHTML     = '';
  pagesContainer.style.display = 'none';
  emptyState.style.display     = '';
  closeBtn.style.display       = 'none';
  zoomControls.style.display   = 'none';
  filenameEl.textContent       = 'no file open';
  pageinfoEl.textContent       = '';
  tauriWindow?.setTitle('ViewDaFile');
  renderRecentTiles();
}

// ── Render all pages (continuous scroll) ──────────────────────────────────────
async function renderAllPages() {
  const gen          = ++renderGen;
  const visiblePage  = getVisiblePage();

  pagesContainer.innerHTML = '';

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    if (gen !== renderGen) return;

    const wrapper = document.createElement('div');
    wrapper.className    = 'page-wrapper';
    wrapper.dataset.page = i;
    pagesContainer.appendChild(wrapper);

    // Canvas rendering is awaited (sequential) to avoid overwhelming the GPU.
    // Text layer + annotations are fired in parallel (non-blocking).
    await renderPageInto(wrapper, i, gen);
  }

  if (gen !== renderGen) return;

  // Restore scroll position after a zoom-triggered re-render
  if (visiblePage > 1) {
    const el = pagesContainer.querySelector(`[data-page="${visiblePage}"]`);
    if (el) el.scrollIntoView({ block: 'start' });
  }

  updatePageInfo();
}

async function renderPageInto(wrapper, num, gen) {
  if (gen !== renderGen) return;

  const page = await pdfDoc.getPage(num);
  if (gen !== renderGen) return;

  const vp = page.getViewport({ scale });

  // Build wrapper size and child elements
  wrapper.style.width  = vp.width  + 'px';
  wrapper.style.height = vp.height + 'px';

  const canvas    = document.createElement('canvas');
  canvas.width    = vp.width;
  canvas.height   = vp.height;

  const textLayer = document.createElement('div');
  textLayer.className = 'textLayer';

  wrapper.appendChild(canvas);
  wrapper.appendChild(textLayer);

  // Render canvas pixels (awaited — this is the heavy work)
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  if (gen !== renderGen) return;

  // Text layer — fire and forget so the main loop keeps moving
  page.getTextContent().then(tc => {
    if (gen !== renderGen) return;
    try {
      pdfjsLib.renderTextLayer({
        textContentSource: tc,
        container: textLayer,
        viewport: vp,
      });
    } catch (e) {
      console.warn('textLayer page', num, e);
    }
  }).catch(() => {});

  // Link annotations — also fire and forget
  page.getAnnotations().then(annotations => {
    if (gen !== renderGen) return;
    for (const ann of annotations) {
      if (ann.subtype !== 'Link') continue;

      const [x1, y1, x2, y2] = vp.convertToViewportRectangle(ann.rect);
      const div = document.createElement('div');
      div.className    = 'link-annotation';
      div.style.left   = Math.min(x1, x2) + 'px';
      div.style.top    = Math.min(y1, y2) + 'px';
      div.style.width  = Math.abs(x2 - x1) + 'px';
      div.style.height = Math.abs(y2 - y1) + 'px';

      if (ann.url) {
        // External URL — open in system browser via Tauri command
        div.addEventListener('click', e => {
          e.preventDefault();
          invoke('open_url', { url: ann.url }).catch(console.error);
        });
      } else if (ann.dest || ann.action) {
        // Internal destination — scroll to target page
        const dest = ann.dest;
        div.addEventListener('click', async e => {
          e.preventDefault();
          try {
            const resolved = typeof dest === 'string'
              ? await pdfDoc.getDestination(dest)
              : dest;
            if (resolved) {
              const idx = await pdfDoc.getPageIndex(resolved[0]);
              scrollToPage(idx + 1);
            }
          } catch (err) {
            console.warn('Internal link failed', err);
          }
        });
      } else {
        continue;
      }

      // Append inside textLayer so stacking order is canvas → text → links
      textLayer.appendChild(div);
    }
  }).catch(() => {});
}

function scrollToPage(num) {
  const el = pagesContainer.querySelector(`[data-page="${num}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Page indicator ────────────────────────────────────────────────────────────
function getVisiblePage() {
  if (!pdfDoc) return 1;
  const mid      = viewport.scrollTop + viewport.clientHeight / 2;
  const wrappers = pagesContainer.querySelectorAll('.page-wrapper');
  let current    = 1;
  for (const w of wrappers) {
    if (w.offsetTop <= mid) current = parseInt(w.dataset.page, 10);
  }
  return current;
}

function updatePageInfo() {
  if (!pdfDoc) return;
  pageinfoEl.textContent = `${getVisiblePage()} / ${pdfDoc.numPages}`;
}

viewport.addEventListener('scroll', updatePageInfo, { passive: true });

// ── Zoom ──────────────────────────────────────────────────────────────────────
function updateZoomDisplay() {
  zoomLevelEl.textContent = Math.round(scale * 100) + '%';
}

let zoomTimer = null;
function zoomTo(newScale) {
  scale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newScale));
  updateZoomDisplay();

  // Debounce the full re-render so rapid scrolling doesn't thrash
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => {
    if (pdfDoc) renderAllPages();
  }, 180);
}

zoomOutBtn.addEventListener('click', () => zoomTo(scale - ZOOM_STEP));
zoomInBtn.addEventListener('click',  () => zoomTo(scale + ZOOM_STEP));
zoomFitBtn.addEventListener('click', async () => {
  if (!pdfDoc) return;
  const page    = await pdfDoc.getPage(1);
  const baseVp  = page.getViewport({ scale: 1 });
  const availW  = viewport.clientWidth - 48;   // 24px padding each side
  zoomTo(availW / baseVp.width);
});

// Ctrl + mouse wheel zoom (standard Windows pattern)
viewport.addEventListener('wheel', e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  // Each notch is typically deltaY = ±100 (Windows) or ±120
  const delta = e.deltaY < 0 ? 0.1 : -0.1;
  zoomTo(scale + delta);
}, { passive: false });

// Ctrl +/-/0 keyboard shortcuts, Ctrl+W to close
document.addEventListener('keydown', e => {
  if (!e.ctrlKey) return;
  if      (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(scale + ZOOM_STEP); }
  else if (e.key === '-')                  { e.preventDefault(); zoomTo(scale - ZOOM_STEP); }
  else if (e.key === '0')                  { e.preventDefault(); zoomTo(1.0); }
  else if (e.key === 'w' && pdfDoc)        { e.preventDefault(); closeFile(); }
});

// ── Open / Close ──────────────────────────────────────────────────────────────
openBtn.addEventListener('click', async () => {
  const filePath = await invoke('open_pdf_dialog');
  if (filePath) await loadFromPath(filePath);
});

closeBtn.addEventListener('click', closeFile);

// ── Drag and drop ─────────────────────────────────────────────────────────────
listen('tauri://drag-drop', async event => {
  viewport.classList.remove('drag-over');
  const paths = event.payload?.paths ?? [];
  const pdf   = paths.find(p => p.toLowerCase().endsWith('.pdf'));
  if (pdf) await loadFromPath(pdf);
});

listen('tauri://drag-over',  () => viewport.classList.add('drag-over'));
listen('tauri://drag-leave', () => viewport.classList.remove('drag-over'));

// ── Window resize: re-render at new width ─────────────────────────────────────
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (pdfDoc) renderAllPages();
  }, 150);
});

// ── Init ──────────────────────────────────────────────────────────────────────
renderRecentTiles();
