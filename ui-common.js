// Hit Translate — shared helpers for popup/options pages.
'use strict';

const HIT_LANGS = [
  ['ko', '한국어 (Korean)'],
  ['en', 'English'],
  ['ja', '日本語 (Japanese)'],
  ['zh-CN', '简体中文 (Simplified Chinese)'],
  ['zh-TW', '繁體中文 (Traditional Chinese)'],
  ['es', 'Español (Spanish)'],
  ['fr', 'Français (French)'],
  ['de', 'Deutsch (German)'],
  ['ru', 'Русский (Russian)'],
  ['pt', 'Português (Portuguese)'],
  ['it', 'Italiano (Italian)'],
  ['vi', 'Tiếng Việt (Vietnamese)'],
  ['id', 'Bahasa Indonesia'],
  ['th', 'ไทย (Thai)'],
  ['ar', 'العربية (Arabic)'],
  ['hi', 'हिन्दी (Hindi)'],
  ['tr', 'Türkçe (Turkish)'],
  ['nl', 'Nederlands (Dutch)'],
  ['pl', 'Polski (Polish)'],
  ['uk', 'Українська (Ukrainian)']
];

const HIT_PROVIDERS = [
  ['gemini', 'Google Gemini'],
  ['openai', 'OpenAI'],
  ['claude', 'Anthropic Claude'],
  ['zai', 'Z.AI (GLM)'],
  ['custom', 'Custom (OpenAI-compatible)']
];

function hitApplyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const msg = chrome.i18n.getMessage(el.dataset.i18n);
    if (msg) el.textContent = msg;
  }
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    const msg = chrome.i18n.getMessage(el.dataset.i18nPlaceholder);
    if (msg) el.placeholder = msg;
  }
}

function hitFillSelect(select, entries, selected) {
  select.innerHTML = '';
  for (const [value, label] of entries) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if (value === selected) option.selected = true;
    select.appendChild(option);
  }
}

async function hitGetSettings() {
  const res = await chrome.storage.local.get('settings');
  return res.settings || {};
}

async function hitSaveSettings(settings) {
  await chrome.storage.local.set({ settings });
}
