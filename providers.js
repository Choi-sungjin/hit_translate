// Hit Translate — provider layer.
// Each provider turns a batch of strings into a single chat request and
// parses the model output back into an array of translated strings.

export const LANG_NAMES = {
  en: 'English', ko: 'Korean', ja: 'Japanese',
  'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese',
  es: 'Spanish', fr: 'French', de: 'German', ru: 'Russian',
  pt: 'Portuguese', it: 'Italian', vi: 'Vietnamese', id: 'Indonesian',
  th: 'Thai', ar: 'Arabic', hi: 'Hindi', tr: 'Turkish', nl: 'Dutch',
  pl: 'Polish', uk: 'Ukrainian'
};

export const PROVIDERS = {
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
  custom: {
    label: 'Custom (OpenAI-compatible)',
    defaultModel: '',
    defaultBaseUrl: '',
    models: [],
    keyUrl: ''
  }
};

const DEFAULT_SYSTEM_PROMPT =
  'You are a professional translation engine. Translate every string in the ' +
  'JSON array provided by the user into {lang}. Keep numbers, URLs, email ' +
  'addresses, code fragments, brand names and placeholders unchanged. Keep ' +
  'the tone and register of the source. Respond with ONLY a valid JSON array ' +
  'of translated strings — same length, same order as the input. No ' +
  'explanations, no markdown fences.';

export function langName(code) {
  return LANG_NAMES[code] || code;
}

export function buildMessages(texts, targetLang, customPrompt) {
  const template = (customPrompt || '').trim() || DEFAULT_SYSTEM_PROMPT;
  const system = template.replaceAll('{lang}', langName(targetLang));
  const user =
    `Translate the following JSON array of ${texts.length} string(s) into ` +
    `${langName(targetLang)}. Return ONLY a JSON array of ${texts.length} ` +
    `translated string(s) in the same order.\n\n${JSON.stringify(texts)}`;
  return { system, user };
}

function joinUrl(base, path) {
  return base.replace(/\/+$/, '') + path;
}

// Models that reject a custom temperature (OpenAI reasoning families).
function supportsTemperature(model) {
  return !/^(o\d|gpt-5)/i.test(model || '');
}

// Returns {url, init} for fetch. Kept side-effect free so it can be unit-tested.
export function buildRequest(providerId, cfg, texts, targetLang, customPrompt) {
  const meta = PROVIDERS[providerId];
  if (!meta) throw new Error(`Unknown provider: ${providerId}`);
  const model = (cfg.model || '').trim() || meta.defaultModel;
  const baseUrl = (cfg.baseUrl || '').trim() || meta.defaultBaseUrl;
  if (!baseUrl) throw new Error('Base URL is not configured');
  const { system, user } = buildMessages(texts, targetLang, customPrompt);

  if (providerId === 'gemini') {
    const body = {
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.2 }
    };
    if (/2\.5-flash/.test(model)) {
      // Skip "thinking" for flash models: cheaper and much faster for translation.
      body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }
    return {
      url: joinUrl(baseUrl, `/v1beta/models/${model}:generateContent`),
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': cfg.apiKey || ''
        },
        body: JSON.stringify(body)
      }
    };
  }

  if (providerId === 'claude') {
    return {
      url: joinUrl(baseUrl, '/v1/messages'),
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.apiKey || '',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model,
          max_tokens: 8192,
          temperature: 0.2,
          system,
          messages: [{ role: 'user', content: user }]
        })
      }
    };
  }

  // openai, zai and custom all speak the OpenAI chat-completions dialect.
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  };
  if (supportsTemperature(model)) body.temperature = 0.2;
  return {
    url: joinUrl(baseUrl, '/chat/completions'),
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey || ''}`
      },
      body: JSON.stringify(body)
    }
  };
}

// Extract the raw model text out of a provider response body.
export function extractText(providerId, data) {
  if (providerId === 'gemini') {
    const parts = data?.candidates?.[0]?.content?.parts || [];
    return parts.map((p) => p.text || '').join('');
  }
  if (providerId === 'claude') {
    const blocks = Array.isArray(data?.content) ? data.content : [];
    return blocks
      .filter((b) => b.type === 'text' || b.text)
      .map((b) => b.text || '')
      .join('');
  }
  return data?.choices?.[0]?.message?.content || '';
}

// Parse model output into an array of `expected` strings.
// Tolerates markdown fences, wrapper objects and numbered-line fallbacks.
export function parseTranslations(raw, expected) {
  let text = String(raw || '').trim();
  if (!text) throw new Error('Empty model response');
  text = text.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();

  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      const arr = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(arr)) {
        const strings = arr.map((v) => (typeof v === 'string' ? v : String(v ?? '')));
        if (strings.length === expected) return strings;
        if (expected === 1 && strings.length >= 1) return [strings[0]];
      }
    } catch {
      /* fall through to other strategies */
    }
  }

  // Wrapper object such as {"translations": [...]}
  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text);
      const arr = Object.values(obj).find((v) => Array.isArray(v));
      if (arr && arr.length === expected) return arr.map(String);
    } catch {
      /* ignore */
    }
  }

  // Numbered lines: "1. foo" / "2) bar"
  if (expected > 1) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const numbered = lines
      .map((l) => l.match(/^\d+\s*[.)]\s*(.*)$/))
      .filter(Boolean)
      .map((m) => m[1]);
    if (numbered.length === expected) return numbered;
  }

  if (expected === 1) return [text];
  throw new Error(`Model returned ${expected !== 1 ? 'a malformed batch' : 'nothing usable'} (expected ${expected} items)`);
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Translate `texts` in one request. Throws on failure.
export async function translateTexts(providerId, cfg, texts, targetLang, options = {}) {
  const { customPrompt, timeoutMs = 60000 } = options;
  const { url, init } = buildRequest(providerId, cfg, texts, targetLang, customPrompt);
  const res = await fetchWithTimeout(url, init, timeoutMs);
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new Error(`HTTP ${res.status} from ${providerId}: ${detail}`);
  }
  const data = await res.json();
  const raw = extractText(providerId, data);
  return parseTranslations(raw, texts.length);
}
