// Hit Translate — background service worker.
// Owns settings defaults, the translation cache, context menus, keyboard
// commands and all network calls to the AI providers.

import { PROVIDERS, translateTexts } from './providers.js';

export const DEFAULT_SETTINGS = {
  provider: 'gemini',
  targetLang: 'ko',
  mode: 'dual', // dual | replace
  style: 'dashed', // none | dashed | underline | background | quote
  selectionEnabled: true,
  hoverEnabled: true,
  autoSites: [],
  excludedSites: [],
  batchCharLimit: 1600,
  batchMaxItems: 12,
  concurrency: 3,
  customPrompt: '',
  providers: {
    gemini: { apiKey: '', model: '', baseUrl: '' },
    openai: { apiKey: '', model: '', baseUrl: '' },
    claude: { apiKey: '', model: '', baseUrl: '' },
    zai: { apiKey: '', model: '', baseUrl: '' },
    custom: { apiKey: '', model: '', baseUrl: '' }
  }
};

async function getSettings() {
  const stored = (await chrome.storage.local.get('settings')).settings || {};
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  merged.providers = { ...DEFAULT_SETTINGS.providers };
  for (const id of Object.keys(merged.providers)) {
    merged.providers[id] = { ...DEFAULT_SETTINGS.providers[id], ...(stored.providers?.[id] || {}) };
  }
  return merged;
}

// ---- translation cache (in-memory LRU, per service-worker lifetime) ----
const CACHE_MAX = 3000;
const cache = new Map();

function cacheKey(provider, model, lang, text) {
  return `${provider}|${model}|${lang}|${text}`;
}

function cacheGet(key) {
  if (!cache.has(key)) return undefined;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function cacheSet(key, value) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

// ---- translation entry point ----
async function handleTranslate({ texts, targetLang, provider }) {
  const settings = await getSettings();
  const providerId = provider || settings.provider;
  const lang = targetLang || settings.targetLang;
  const cfg = settings.providers[providerId];
  if (!PROVIDERS[providerId]) return { ok: false, error: `Unknown provider "${providerId}"` };
  if (!cfg?.apiKey && providerId !== 'custom') {
    return { ok: false, error: 'NO_KEY', provider: providerId };
  }

  const model = cfg.model || PROVIDERS[providerId].defaultModel;
  const results = new Array(texts.length);
  const missing = [];
  texts.forEach((text, i) => {
    const hit = cacheGet(cacheKey(providerId, model, lang, text));
    if (hit !== undefined) results[i] = hit;
    else missing.push(i);
  });

  if (missing.length) {
    const batch = missing.map((i) => texts[i]);
    let translated;
    try {
      translated = await translateWithRetry(providerId, cfg, batch, lang, settings.customPrompt);
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
    missing.forEach((textIndex, j) => {
      results[textIndex] = translated[j];
      cacheSet(cacheKey(providerId, model, lang, texts[textIndex]), translated[j]);
    });
  }
  return { ok: true, translations: results };
}

// One batch attempt, one retry, then per-item fallback so a single odd
// paragraph can't sink the whole batch.
async function translateWithRetry(providerId, cfg, texts, lang, customPrompt) {
  const opts = { customPrompt };
  try {
    return await translateTexts(providerId, cfg, texts, lang, opts);
  } catch (first) {
    try {
      return await translateTexts(providerId, cfg, texts, lang, opts);
    } catch (second) {
      if (texts.length === 1) throw second;
      const out = [];
      for (const text of texts) {
        out.push((await translateTexts(providerId, cfg, [text], lang, opts))[0]);
      }
      return out;
    }
  }
}

async function handleTestProvider({ providerId, cfg, targetLang }) {
  try {
    const translated = await translateTexts(
      providerId,
      cfg || {},
      ['Hello! This is a connection test.'],
      targetLang || 'ko',
      { timeoutMs: 30000 }
    );
    return { ok: true, sample: translated[0] };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// ---- context menus / commands / badge ----
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'hit-toggle-page',
      title: chrome.i18n.getMessage('menuTranslatePage'),
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: 'hit-translate-selection',
      title: chrome.i18n.getMessage('menuTranslateSelection'),
      contexts: ['selection']
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === 'hit-toggle-page') {
    chrome.tabs.sendMessage(tab.id, { type: 'togglePage' }).catch(() => {});
  } else if (info.menuItemId === 'hit-translate-selection') {
    chrome.tabs.sendMessage(tab.id, { type: 'translateSelection' }).catch(() => {});
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (command === 'toggle-translate') {
    chrome.tabs.sendMessage(tab.id, { type: 'togglePage' }).catch(() => {});
  } else if (command === 'toggle-mode') {
    const settings = await getSettings();
    settings.mode = settings.mode === 'dual' ? 'replace' : 'dual';
    await chrome.storage.local.set({ settings });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'translate') {
    handleTranslate(msg).then(sendResponse);
    return true;
  }
  if (msg?.type === 'testProvider') {
    handleTestProvider(msg).then(sendResponse);
    return true;
  }
  if (msg?.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
    return false;
  }
  if (msg?.type === 'pageState' && sender.tab?.id != null) {
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: msg.enabled ? 'ON' : '' });
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#0ea5e9' });
    return false;
  }
  return false;
});
