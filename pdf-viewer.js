// Hit Translate — bilingual PDF reader (extension page).
// Extracts text with the bundled pdf.js, groups it into paragraphs and
// translates them with the user's configured provider — fully local except
// for the translation API call itself.
import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';
import { itemsToParagraphs } from './pdf-extract.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.mjs');

const els = {
  content: document.getElementById('content'),
  dropzone: document.getElementById('dropzone'),
  banner: document.getElementById('banner'),
  meta: document.getElementById('meta'),
  progress: document.getElementById('progress'),
  fileInput: document.getElementById('fileInput'),
  urlInput: document.getElementById('urlInput'),
  exportBtn: document.getElementById('exportBtn')
};

let settings = {};
let docTitle = 'document';
let totalParagraphs = 0;
let doneParagraphs = 0;

function banner(msg, isError = true) {
  els.banner.hidden = !msg;
  els.banner.textContent = msg || '';
  els.banner.className = isError ? 'error' : '';
}

function t(key, fallback) {
  return chrome.i18n.getMessage(key) || fallback;
}

async function loadSettings() {
  settings = (await chrome.storage.local.get('settings')).settings || {};
  settings.mode = settings.mode || 'dual';
  settings.style = settings.style || 'dashed';
  settings.targetLang = settings.targetLang || 'ko';
  settings.batchCharLimit = settings.batchCharLimit || 1600;
  settings.batchMaxItems = settings.batchMaxItems || 12;
  els.meta.textContent = `${settings.provider || 'gemini'} → ${settings.targetLang}`;
}

// ---- loading ----

async function loadFromUrl(url) {
  banner('');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.arrayBuffer();
    docTitle = decodeURIComponent(url.split('/').pop() || 'document').replace(/\.pdf$/i, '');
    await renderPdf(data);
  } catch (err) {
    banner(`${t('pdfLoadError', 'Could not load PDF')}: ${String(err?.message || err)}`);
  }
}

async function loadFromFile(file) {
  banner('');
  docTitle = (file.name || 'document').replace(/\.pdf$/i, '');
  await renderPdf(await file.arrayBuffer());
}

async function renderPdf(data) {
  els.dropzone?.remove();
  els.content.textContent = '';
  document.title = `${docTitle} — Hit Translate`;
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const jobs = [];
  totalParagraphs = 0;
  doneParagraphs = 0;

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const textContent = await page.getTextContent();
    const paragraphs = itemsToParagraphs(textContent.items);

    const section = document.createElement('section');
    const head = document.createElement('h3');
    head.textContent = `${t('pdfPage', 'Page')} ${pageNo} / ${pdf.numPages}`;
    section.appendChild(head);
    for (const text of paragraphs) {
      const p = document.createElement('p');
      p.className = 'hit-pdf-par';
      p.textContent = text;
      section.appendChild(p);
      jobs.push(p);
    }
    els.content.appendChild(section);
  }

  totalParagraphs = jobs.length;
  updateProgress();
  if (!jobs.length) {
    banner(t('pdfNoText', 'No extractable text found — this PDF is likely scanned images (OCR not supported yet).'));
    return;
  }
  await translateAll(jobs);
  els.exportBtn.disabled = false;
}

// ---- translation ----

function updateProgress() {
  els.progress.textContent = totalParagraphs
    ? `${doneParagraphs}/${totalParagraphs}`
    : '';
}

function makeBatches(nodes) {
  const batches = [];
  let batch = [];
  let chars = 0;
  for (const node of nodes) {
    const len = node.textContent.length;
    if (batch.length && (batch.length >= settings.batchMaxItems || chars + len > settings.batchCharLimit)) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(node);
    chars += len;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function attachTranslation(p, text) {
  const font = document.createElement('font');
  font.className = `hit-target hit-style-${settings.style}`;
  font.setAttribute('lang', settings.targetLang);
  font.textContent = text;
  p.appendChild(font);
  if (settings.mode === 'replace') p.classList.add('hit-replaced');
}

async function translateAll(nodes) {
  const batches = makeBatches(nodes);
  const concurrency = settings.provider === 'ollama' ? 1 : Math.min(3, settings.concurrency || 3);
  let stopped = false;
  const queue = [...batches];

  async function worker() {
    while (queue.length && !stopped) {
      const batch = queue.shift();
      const texts = batch.map((p) => p.textContent);
      let res;
      try {
        res = await chrome.runtime.sendMessage({ type: 'translate', texts, targetLang: settings.targetLang });
      } catch (err) {
        res = { ok: false, error: String(err?.message || err) };
      }
      if (res?.ok) {
        batch.forEach((p, i) => attachTranslation(p, res.translations[i]));
        doneParagraphs += batch.length;
        updateProgress();
      } else if (res?.error === 'NO_KEY') {
        stopped = true;
        banner(t('popupNoKey', 'No API key for the selected provider.') + ' → ');
        const link = document.createElement('a');
        link.href = '#';
        link.textContent = t('popupSetKey', 'Set it up →');
        link.addEventListener('click', (e) => {
          e.preventDefault();
          chrome.runtime.sendMessage({ type: 'openOptions' });
        });
        els.banner.appendChild(link);
      } else {
        batch.forEach((p) => p.classList.add('hit-failed'));
        doneParagraphs += batch.length;
        updateProgress();
        banner(`${t('pdfSomeFailed', 'Some paragraphs failed')}: ${res?.error || ''}`, true);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
}

// ---- export ----

function exportHtml() {
  const style = `body{max-width:760px;margin:2rem auto;padding:0 1rem;font:16px/1.7 -apple-system,'Segoe UI',sans-serif;color:#111}
h3{color:#64748b;font-size:14px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
font.hit-target{display:block;margin-top:.4em;color:#0c4a6e}
p.hit-replaced{font-size:0}p.hit-replaced font{font-size:16px}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${docTitle}</title><style>${style}</style></head><body><h1>${docTitle}</h1>${els.content.innerHTML}</body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${docTitle}.bilingual.html`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---- wiring ----

async function init() {
  hitApplyI18n();
  await loadSettings();

  document.getElementById('openFile').addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => {
    if (els.fileInput.files?.[0]) loadFromFile(els.fileInput.files[0]);
  });
  document.getElementById('loadUrl').addEventListener('click', () => {
    const url = els.urlInput.value.trim();
    if (url) loadFromUrl(url);
  });
  els.exportBtn.addEventListener('click', exportHtml);

  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file && /pdf$/i.test(file.name)) loadFromFile(file);
  });

  const param = new URLSearchParams(location.search).get('file');
  if (param) {
    els.urlInput.value = param;
    // Escape hatch back to Chrome's own viewer; the #hit-original fragment
    // stops the auto-open listener from bouncing the tab straight back here.
    if (/^https?:/i.test(param)) {
      const orig = document.createElement('a');
      orig.href = `${param}#hit-original`;
      orig.textContent = t('pdfOpenOriginal', 'Open original');
      orig.className = 'origlink';
      document.querySelector('.status').appendChild(orig);
    }
    await loadFromUrl(param);
  }
}

init();
