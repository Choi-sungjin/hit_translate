// Hit Translate — popup logic.
'use strict';

const DEFAULTS = {
  provider: 'gemini',
  targetLang: 'ko',
  mode: 'dual',
  style: 'dashed',
  autoSites: [],
  excludedSites: [],
  providers: {}
};

let settings = { ...DEFAULTS };
let currentTab = null;

function currentHost() {
  try {
    return new URL(currentTab?.url || '').hostname;
  } catch {
    return '';
  }
}

function updateKeyWarning() {
  const cfg = settings.providers?.[settings.provider] || {};
  const needsKey = !HIT_KEYLESS.has(settings.provider) && !cfg.apiKey;
  document.getElementById('keyWarning').hidden = !needsKey;
}

async function refreshToggleLabel() {
  const btn = document.getElementById('toggle');
  try {
    const state = await chrome.tabs.sendMessage(currentTab.id, { type: 'getPageState' });
    btn.textContent = chrome.i18n.getMessage(state?.enabled ? 'popupRestore' : 'popupTranslate');
    btn.disabled = false;
  } catch {
    btn.textContent = chrome.i18n.getMessage('popupUnavailable') || 'Not available on this page';
    btn.disabled = true;
  }
}

async function save() {
  await hitSaveSettings(settings);
}

async function init() {
  hitApplyI18n();
  const stored = await hitGetSettings();
  settings = { ...DEFAULTS, ...stored };
  [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  hitFillSelect(document.getElementById('provider'), HIT_PROVIDERS, settings.provider);
  hitFillSelect(document.getElementById('targetLang'), HIT_LANGS, settings.targetLang);
  document.getElementById('mode').value = settings.mode;
  document.getElementById('style').value = settings.style;

  const host = currentHost();
  const autoBox = document.getElementById('autoSite');
  autoBox.checked = !!host && (settings.autoSites || []).includes(host);
  autoBox.disabled = !host;

  const pdfBtn = document.getElementById('pdfBtn');
  const tabUrl = currentTab?.url || '';
  if (/\.pdf($|[?#])/i.test(tabUrl)) {
    pdfBtn.hidden = false;
    pdfBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'openPdfReader', url: tabUrl });
      window.close();
    });
  }

  updateKeyWarning();
  await refreshToggleLabel();

  document.getElementById('toggle').addEventListener('click', async () => {
    try {
      await chrome.tabs.sendMessage(currentTab.id, { type: 'togglePage' });
      await refreshToggleLabel();
    } catch {
      /* page without content script */
    }
  });

  document.getElementById('provider').addEventListener('change', async (e) => {
    settings.provider = e.target.value;
    updateKeyWarning();
    await save();
  });
  document.getElementById('targetLang').addEventListener('change', async (e) => {
    settings.targetLang = e.target.value;
    await save();
  });
  document.getElementById('mode').addEventListener('change', async (e) => {
    settings.mode = e.target.value;
    await save();
  });
  document.getElementById('style').addEventListener('change', async (e) => {
    settings.style = e.target.value;
    await save();
  });

  autoBox.addEventListener('change', async (e) => {
    const list = new Set(settings.autoSites || []);
    if (e.target.checked) list.add(host);
    else list.delete(host);
    settings.autoSites = [...list];
    await save();
  });

  for (const id of ['openOptions', 'openOptionsWarn']) {
    document.getElementById(id).addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
}

init();
