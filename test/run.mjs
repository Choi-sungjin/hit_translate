// Unit + integration tests for the provider layer. Run: npm test
import { createServer } from 'node:http';
import {
  buildRequest,
  extractText,
  parseTranslations,
  buildMessages,
  translateTexts,
  providerRequiresKey
} from '../providers.js';
import { itemsToLines, itemsToParagraphs, splitLongParagraph, isPdfUrl } from '../pdf-extract.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name} ${detail}`);
  }
}

// ---- buildMessages ----
{
  const { system, user } = buildMessages(['Hello', 'World'], 'ko');
  check('buildMessages mentions Korean', system.includes('Korean') && user.includes('Korean'));
  check('buildMessages embeds JSON payload', user.includes('["Hello","World"]'));
  const custom = buildMessages(['x'], 'ja', 'Translate into {lang} with style.');
  check('custom prompt substitution', custom.system === 'Translate into Japanese with style.');
}

// ---- buildRequest per provider ----
{
  const texts = ['Hello'];
  const gem = buildRequest('gemini', { apiKey: 'G' }, texts, 'ko');
  check(
    'gemini url + key header',
    gem.url === 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent' &&
      gem.init.headers['x-goog-api-key'] === 'G'
  );
  const gemBody = JSON.parse(gem.init.body);
  check('gemini disables thinking for flash', gemBody.generationConfig.thinkingConfig?.thinkingBudget === 0);

  const oai = buildRequest('openai', { apiKey: 'O' }, texts, 'en');
  check(
    'openai url + bearer',
    oai.url === 'https://api.openai.com/v1/chat/completions' && oai.init.headers.Authorization === 'Bearer O'
  );
  check('openai temperature set', JSON.parse(oai.init.body).temperature === 0.2);

  const o3 = buildRequest('openai', { apiKey: 'O', model: 'o3-mini' }, texts, 'en');
  check('reasoning model omits temperature', !('temperature' in JSON.parse(o3.init.body)));

  const cla = buildRequest('claude', { apiKey: 'C' }, texts, 'ko');
  const claBody = JSON.parse(cla.init.body);
  check(
    'claude url + headers + model',
    cla.url === 'https://api.anthropic.com/v1/messages' &&
      cla.init.headers['x-api-key'] === 'C' &&
      cla.init.headers['anthropic-version'] === '2023-06-01' &&
      claBody.model === 'claude-haiku-4-5' &&
      claBody.max_tokens > 0
  );

  const zai = buildRequest('zai', { apiKey: 'Z' }, texts, 'ko');
  check('zai endpoint', zai.url === 'https://api.z.ai/api/paas/v4/chat/completions');
  check('zai thinking disabled', JSON.parse(zai.init.body).thinking?.type === 'disabled');

  const oll = buildRequest('ollama', { model: 'gemma4:26b-a4b-it-qat' }, texts, 'ko');
  check(
    'ollama endpoint + think off',
    oll.url === 'http://localhost:11434/v1/chat/completions' &&
      JSON.parse(oll.init.body).think === false
  );
  let ollThrew = false;
  try {
    buildRequest('ollama', {}, texts, 'ko');
  } catch {
    ollThrew = true;
  }
  check('ollama without model throws', ollThrew);

  const cus = buildRequest('custom', { baseUrl: 'http://localhost:11434/v1/', model: 'llama3' }, texts, 'ko');
  check('custom trailing slash normalized', cus.url === 'http://localhost:11434/v1/chat/completions');

  let threw = false;
  try {
    buildRequest('custom', {}, texts, 'ko');
  } catch {
    threw = true;
  }
  check('custom without baseUrl throws', threw);
}

// ---- key requirements ----
{
  check(
    'keyless providers',
    !providerRequiresKey('ollama') && !providerRequiresKey('custom') &&
      providerRequiresKey('gemini') && providerRequiresKey('claude')
  );
}

// ---- extractText ----
{
  check(
    'extract gemini',
    extractText('gemini', { candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }) === 'ab'
  );
  check(
    'extract claude',
    extractText('claude', { content: [{ type: 'text', text: 'hi' }] }) === 'hi'
  );
  check(
    'extract openai-compatible',
    extractText('zai', { choices: [{ message: { content: 'yo' } }] }) === 'yo'
  );
}

// ---- parseTranslations ----
{
  check('plain JSON array', parseTranslations('["a","b"]', 2).join(',') === 'a,b');
  check('fenced JSON array', parseTranslations('```json\n["a","b"]\n```', 2).join(',') === 'a,b');
  check('prose around array', parseTranslations('Here you go: ["안녕", "세계"] done', 2).join(',') === '안녕,세계');
  check('wrapper object', parseTranslations('{"translations":["x","y"]}', 2).join(',') === 'x,y');
  check('numbered lines fallback', parseTranslations('1. foo\n2) bar', 2).join(',') === 'foo,bar');
  check('single plain text fallback', parseTranslations('그냥 번역문', 1)[0] === '그냥 번역문');
  check(
    'think tags stripped',
    parseTranslations('<think>reasoning about [1,2] here</think>["a","b"]', 2).join(',') === 'a,b'
  );
  check(
    'nested brackets inside strings',
    parseTranslations('["a [1] b","c"]', 2)[0] === 'a [1] b'
  );
  let threw = false;
  try {
    parseTranslations('completely broken', 3);
  } catch {
    threw = true;
  }
  check('mismatch throws for batches', threw);
}

// ---- PDF paragraph grouping ----
{
  const it = (str, x, y, size = 12) => ({
    str,
    transform: [size, 0, 0, size, x, y],
    width: str.length * size * 0.5,
    height: size
  });
  const items = [
    it('Title of Document', 72, 760, 20),
    it('This is the first', 72, 720),
    it('paragraph line.', 180, 720), // same baseline, gap → space
    it('It continues here.', 72, 706),
    it('And a third line.', 72, 692),
    it('Second paragraph with transla-', 72, 664), // 28pt gap → new paragraph
    it('tion joined across lines.', 72, 650),
    it('', 72, 640), // empty items are dropped
    it('   ', 72, 630)
  ];
  const lines = itemsToLines(items);
  check('pdf line merge with space', lines.some((l) => l.text === 'This is the first paragraph line.'));
  const paras = itemsToParagraphs(items);
  check('pdf paragraph count', paras.length === 3, JSON.stringify(paras));
  check('pdf title split by font size', paras[0] === 'Title of Document');
  check(
    'pdf body lines merged',
    paras[1] === 'This is the first paragraph line. It continues here. And a third line.',
    paras[1]
  );
  check('pdf de-hyphenation', paras[2] === 'Second paragraph with translation joined across lines.', paras[2]);
  check('pdf empty input', itemsToParagraphs([]).length === 0);

  // bullet lines split even with normal line spacing
  const bullets = [
    it('-First useful phrase for papers.', 72, 720),
    it('-Second useful phrase right below.', 72, 706),
    it('-Third one continues the dense list.', 72, 692)
  ];
  check('pdf bullet lines split', itemsToParagraphs(bullets).length === 3);

  // long paragraph safety split
  const sentence = 'This sentence is repeated to grow well past the limit. ';
  const long = sentence.repeat(40).trim();
  const chunks = splitLongParagraph(long, 500);
  check(
    'pdf long paragraph split',
    chunks.length > 1 && chunks.every((c) => c.length <= 500) && chunks.join(' ') === long,
    `${chunks.length} chunks`
  );
  check('pdf short paragraph untouched', splitLongParagraph('short one', 500).length === 1);

  // auto-open URL detection
  check(
    'isPdfUrl matches',
    isPdfUrl('https://x.com/a/b.pdf') &&
      isPdfUrl('https://x.com/%EB%AC%B8%EC%84%9C.PDF') &&
      isPdfUrl('file:///Users/me/doc.pdf')
  );
  check(
    'isPdfUrl rejects',
    !isPdfUrl('https://x.com/a.pdf#hit-original') &&
      !isPdfUrl('chrome-extension://abc/pdf.html?file=x.pdf') &&
      !isPdfUrl('https://x.com/page.html') &&
      !isPdfUrl('')
  );
}

// ---- E2E against a mock OpenAI-compatible server ----
{
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body);
      const payload = parsed.messages.find((m) => m.role === 'user').content;
      const arr = JSON.parse(payload.slice(payload.indexOf('[')));
      const translated = arr.map((s) => `[KO] ${s}`);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(translated) } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const out = await translateTexts(
    'custom',
    { baseUrl: `http://127.0.0.1:${port}`, model: 'mock' },
    ['Hello', 'World'],
    'ko'
  );
  check('mock server round-trip', out.join('|') === '[KO] Hello|[KO] World', out.join('|'));
  server.close();
}

console.log(failures ? `\n${failures} test(s) FAILED` : '\nAll provider tests passed');
process.exit(failures ? 1 : 0);
