// Hit Translate — options page logic.
'use strict';

const PROVIDER_META = {
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
    keyUrl: 'https://aistudio.google.com/app/apikey'
  },
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'],
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  claude: {
    label: 'Anthropic Claude',
    defaultModel: 'claude-haiku-4-5',
    defaultBaseUrl: 'https://api.anthropic.com',
    models: ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-4-8'],
    keyUrl: 'https://console.anthropic.com/settings/keys'
  },
  zai: {
    label: 'Z.AI (GLM)',
    defaultModel: 'glm-4.5-flash',
    defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
    models: ['glm-4.5-flash', 'glm-4.5-air', 'glm-4.5', 'glm-4.6'],
    keyUrl: 'https://z.ai/manage-apikey/apikey-list'
  },
  ollama: {
    label: 'Ollama (local)',
    defaultModel: '',
    defaultBaseUrl: 'http://localhost:11434/v1',
    models: ['gemma4:26b-a4b-it-qat', 'gemma4:e4b', 'qwen3:8b', 'llama3.1:8b'],
    keyUrl: 'https://ollama.com/download',
    keyless: true,
    listModels: true,
    noteKey: 'ollamaNote'
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    defaultModel: '',
    defaultBaseUrl: '',
    models: [],
    keyUrl: '',
    keyless: true
  }
};

const DEFAULTS = {
  provider: 'gemini',
  targetLang: 'ko',
  mode: 'dual',
  style: 'dashed',
  selectionEnabled: true,
  hoverEnabled: true,
  autoSites: [],
  excludedSites: [],
  batchCharLimit: 1600,
  batchMaxItems: 12,
  concurrency: 3,
  customPrompt: '',
  providers: {}
};

let settings = structuredClone(DEFAULTS);
let saveTimer = null;

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg || chrome.i18n.getMessage('savedToast') || 'Saved';
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 1400);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await hitSaveSettings(settings);
    toast();
  }, 250);
}

function providerCfg(id) {
  if (!settings.providers[id]) settings.providers[id] = { apiKey: '', model: '', baseUrl: '' };
  return settings.providers[id];
}

// ---- provider cards ----
function buildProviderCard(id) {
  const meta = PROVIDER_META[id];
  const cfg = providerCfg(id);
  const card = document.createElement('div');
  card.className = 'card';

  const head = document.createElement('div');
  head.className = 'card-head';
  const title = document.createElement('strong');
  title.textContent = meta.label;
  head.appendChild(title);
  if (meta.keyUrl) {
    const link = document.createElement('a');
    link.href = meta.keyUrl;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = chrome.i18n.getMessage('getKey') || 'Get API key ↗';
    head.appendChild(link);
  }
  card.appendChild(head);

  // API key
  const keyRow = document.createElement('div');
  keyRow.className = 'field';
  const keyLabel = document.createElement('label');
  keyLabel.textContent = 'API key';
  const keyWrap = document.createElement('div');
  keyWrap.className = 'keywrap';
  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.value = cfg.apiKey || '';
  keyInput.autocomplete = 'off';
  keyInput.spellcheck = false;
  keyInput.placeholder = meta.keyless ? '(not needed)' : 'sk-…';
  keyInput.addEventListener('input', () => {
    providerCfg(id).apiKey = keyInput.value.trim();
    scheduleSave();
  });
  const eye = document.createElement('button');
  eye.type = 'button';
  eye.className = 'eye';
  eye.textContent = '👁';
  eye.addEventListener('click', () => {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
  });
  keyWrap.append(keyInput, eye);
  keyRow.append(keyLabel, keyWrap);
  card.appendChild(keyRow);

  // model
  const modelRow = document.createElement('div');
  modelRow.className = 'field';
  const modelLabel = document.createElement('label');
  modelLabel.textContent = 'Model';
  const modelInput = document.createElement('input');
  modelInput.type = 'text';
  modelInput.value = cfg.model || '';
  modelInput.placeholder = meta.defaultModel || 'model id';
  modelInput.spellcheck = false;
  if (meta.models.length) {
    const list = document.createElement('datalist');
    list.id = `models-${id}`;
    for (const m of meta.models) {
      const opt = document.createElement('option');
      opt.value = m;
      list.appendChild(opt);
    }
    card.appendChild(list);
    modelInput.setAttribute('list', list.id);
  }
  modelInput.addEventListener('input', () => {
    providerCfg(id).model = modelInput.value.trim();
    scheduleSave();
  });
  modelRow.append(modelLabel, modelInput);

  if (meta.listModels) {
    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.textContent = chrome.i18n.getMessage('loadModels') || 'Load installed models';
    loadBtn.addEventListener('click', async () => {
      loadBtn.disabled = true;
      try {
        const base = (providerCfg(id).baseUrl || meta.defaultBaseUrl).replace(/\/v1\/?$/, '');
        const res = await fetch(`${base}/api/tags`);
        const data = await res.json();
        const names = (data.models || []).map((m) => m.name);
        const list = document.getElementById(`models-${id}`);
        list.innerHTML = '';
        for (const name of names) {
          const opt = document.createElement('option');
          opt.value = name;
          list.appendChild(opt);
        }
        if (names.length && !providerCfg(id).model) {
          modelInput.value = names[0];
          providerCfg(id).model = names[0];
          scheduleSave();
        }
        toast(`${names.length} model(s) found`);
      } catch (err) {
        toast(`Ollama not reachable: ${String(err?.message || err)}`);
      } finally {
        loadBtn.disabled = false;
      }
    });
    modelRow.appendChild(loadBtn);
  }
  card.appendChild(modelRow);

  // base URL
  const urlRow = document.createElement('div');
  urlRow.className = 'field';
  const urlLabel = document.createElement('label');
  urlLabel.textContent = 'Base URL';
  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.value = cfg.baseUrl || '';
  urlInput.placeholder = meta.defaultBaseUrl || 'https://host/v1';
  urlInput.spellcheck = false;
  urlInput.addEventListener('input', () => {
    providerCfg(id).baseUrl = urlInput.value.trim();
    scheduleSave();
  });
  urlRow.append(urlLabel, urlInput);
  card.appendChild(urlRow);

  // test button
  const testRow = document.createElement('div');
  testRow.className = 'testrow';
  const testBtn = document.createElement('button');
  testBtn.textContent = chrome.i18n.getMessage('testBtn') || 'Test connection';
  const result = document.createElement('span');
  result.className = 'testresult';
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    result.textContent = '…';
    result.className = 'testresult';
    const res = await chrome.runtime.sendMessage({
      type: 'testProvider',
      providerId: id,
      cfg: providerCfg(id),
      targetLang: settings.targetLang
    });
    testBtn.disabled = false;
    if (res?.ok) {
      result.textContent = `✓ ${res.sample}`;
      result.classList.add('ok');
    } else {
      result.textContent = `✗ ${res?.error || 'failed'}`;
      result.classList.add('err');
    }
  });
  testRow.append(testBtn, result);
  card.appendChild(testRow);

  if (meta.noteKey) {
    const note = document.createElement('p');
    note.className = 'cardnote';
    note.textContent = chrome.i18n.getMessage(meta.noteKey) || '';
    card.appendChild(note);
  }

  return card;
}

// ---- init ----
async function init() {
  hitApplyI18n();
  const stored = await hitGetSettings();
  settings = { ...structuredClone(DEFAULTS), ...stored };
  settings.providers = settings.providers || {};

  document.getElementById('version').textContent = `v${chrome.runtime.getManifest().version}`;

  // tabs
  for (const btn of document.querySelectorAll('button.nav')) {
    btn.addEventListener('click', () => {
      document.querySelectorAll('button.nav').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('section.tab').forEach((s) => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      location.hash = btn.dataset.tab;
    });
  }
  const hash = location.hash.replace('#', '');
  if (hash && document.getElementById(`tab-${hash}`)) {
    document.querySelector(`button.nav[data-tab="${hash}"]`)?.click();
  }

  // general
  hitFillSelect(document.getElementById('targetLang'), HIT_LANGS, settings.targetLang);
  hitFillSelect(document.getElementById('provider'), HIT_PROVIDERS, settings.provider);
  document.getElementById('mode').value = settings.mode;
  document.getElementById('style').value = settings.style;
  document.getElementById('selectionEnabled').checked = settings.selectionEnabled !== false;
  document.getElementById('hoverEnabled').checked = settings.hoverEnabled !== false;
  document.getElementById('autoSites').value = (settings.autoSites || []).join('\n');
  document.getElementById('excludedSites').value = (settings.excludedSites || []).join('\n');

  const bind = (id, key, transform = (v) => v) => {
    document.getElementById(id).addEventListener('change', (e) => {
      settings[key] = transform(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
      scheduleSave();
    });
  };
  bind('targetLang', 'targetLang');
  bind('provider', 'provider');
  bind('mode', 'mode');
  bind('style', 'style');
  bind('selectionEnabled', 'selectionEnabled');
  bind('hoverEnabled', 'hoverEnabled');
  const toLines = (v) => v.split('\n').map((s) => s.trim().toLowerCase()).filter(Boolean);
  bind('autoSites', 'autoSites', toLines);
  bind('excludedSites', 'excludedSites', toLines);

  // providers
  const cardsRoot = document.getElementById('providerCards');
  for (const id of Object.keys(PROVIDER_META)) cardsRoot.appendChild(buildProviderCard(id));

  // advanced
  document.getElementById('batchCharLimit').value = settings.batchCharLimit;
  document.getElementById('batchMaxItems').value = settings.batchMaxItems;
  document.getElementById('concurrency').value = settings.concurrency;
  document.getElementById('customPrompt').value = settings.customPrompt || '';
  const toInt = (min, max, fallback) => (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  bind('batchCharLimit', 'batchCharLimit', toInt(200, 8000, 1600));
  bind('batchMaxItems', 'batchMaxItems', toInt(1, 50, 12));
  bind('concurrency', 'concurrency', toInt(1, 10, 3));
  bind('customPrompt', 'customPrompt');

  // export / import
  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hit-translate-settings.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      settings = { ...structuredClone(DEFAULTS), ...imported };
      await hitSaveSettings(settings);
      location.reload();
    } catch {
      toast('Invalid settings file');
    }
  });
}

init();
