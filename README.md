# Hit Translate

**Open-source bilingual web page translation for Chrome — bring your own AI API key.**

Hit Translate renders web pages bilingually: every paragraph keeps its original text, with an AI translation inserted right below it. You connect it to the AI provider of *your* choice with *your own* API key, so translation runs on your own account and your own payment method — there is no subscription, no middleman server, and no telemetry.

> 🇰🇷 [한국어 소개는 아래에 있습니다.](#한국어-소개)

## Why this project exists

Bilingual "immersive-style" page translation is a genuinely great reading UX, but the popular extensions in this category are closed-source and route your traffic through their own servers and paid plans. Hit Translate is an **independent, from-scratch open-source implementation of that reading experience**:

- It contains **no code from Immersive Translate or any other extension** — the concept of bilingual paragraph-level translation is the inspiration; every line here was written for this project.
- It is **not affiliated with, endorsed by, or connected to** Immersive Translate ([immersivetranslate.com](https://immersivetranslate.com)) or any other product. All trademarks belong to their owners.
- Instead of a subscription, you plug in an API key from an AI provider you already pay (or use a free tier). Requests go **directly from your browser to the provider** — nothing passes through any third-party server.

## Features

- **Bilingual page translation** — original + translation shown together, paragraph by paragraph (`Alt+Q` to toggle)
- **Translation-only mode** — hide originals and read pure translation
- **Lazy translation** — only paragraphs near the viewport are translated, so long pages don't burn tokens
- **Dynamic pages supported** — new content added by SPAs/infinite scroll is picked up automatically
- **Hover translate** — hold `Alt` and point at a paragraph to translate just that one
- **Selection translate** — select text, click the bubble, get an instant translation popover
- **Display styles** — dashed underline, underline, highlight, quote bar, or plain
- **PDF translation** — built-in bilingual PDF reader: open any PDF (URL, local file, or drag & drop), get original + translation paragraph by paragraph, and export the result as a standalone bilingual HTML file
- **Per-site rules** — always-translate list and never-run list
- **Smart batching + caching + retry** — paragraphs are grouped per request, responses are cached, failed batches fall back to per-paragraph retries
- **20 target languages**, UI in English and Korean

## Supported AI providers

| Provider | Default model | Get a key |
|---|---|---|
| Google Gemini | `gemini-2.5-flash` | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| OpenAI | `gpt-4o-mini` | [platform.openai.com](https://platform.openai.com/api-keys) |
| Anthropic Claude | `claude-haiku-4-5` | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| Z.AI (GLM) | `glm-4.5-flash` | [z.ai](https://z.ai/manage-apikey/apikey-list) |
| Ollama (local) | pick from installed | no key — [ollama.com](https://ollama.com/download) |
| Custom (OpenAI-compatible) | — | LM Studio, OpenRouter, DeepSeek, Groq, vLLM, … |

The **Custom** provider accepts any OpenAI-compatible `/chat/completions` endpoint. Model and base URL are editable per provider, so new models work the day they ship.

### Fully local translation with Ollama

Translate without any cloud account — pages never leave your machine.

1. Install [Ollama](https://ollama.com/download) and pull a model (e.g. `ollama pull gemma4:e4b`).
2. Allow browser-extension requests — Ollama rejects them with `403` by default:
   - **macOS**: `launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"`, then quit & reopen the Ollama app. (Run again after reboot, or add it to a LaunchAgent.)
   - **Windows**: `setx OLLAMA_ORIGINS chrome-extension://*`, then restart Ollama.
   - **`ollama serve` users**: `OLLAMA_ORIGINS="chrome-extension://*" ollama serve`.
3. In **Settings → AI Providers → Ollama**, click **Load installed models** and pick one, then **Test connection**.

Notes on local models:

- Hit Translate automatically sends `think: false`, since reasoning phases roughly double latency for translation with no quality gain (measured on `gemma4:26b-a4b-it-qat`).
- Requests to Ollama run one at a time with a 5-minute timeout — local batches are slow (a 25B-class model takes ~1 min per batch on laptop hardware). Smaller models (4–8B) are usually the right choice for full-page translation.
- `<think>…</think>` blocks that reasoning models leak into their output are stripped automatically (also applies to DeepSeek-R1-style models via the Custom provider).

## Install (developer mode — macOS & Windows)

Hit Translate has **no build step**; the repository is the extension.

1. Download the code:
   ```bash
   git clone https://github.com/Choi-sungjin/hit_translate.git
   ```
   …or grab the ZIP from GitHub (**Code → Download ZIP**) and unzip it.
2. Open Chrome (or Edge/Brave/Whale) and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `hit_translate` folder.
5. Click the Hit Translate icon → **Settings → AI Providers**, paste your API key, and press **Test connection**.
6. Open any foreign-language page and press **Alt+Q** (or use the popup / right-click menu).

The same steps work on macOS, Windows, and Linux — the extension is pure JavaScript with no native components.

## Usage

| Action | How |
|---|---|
| Translate / restore the page | `Alt+Q`, popup button, or right-click → *translate this page* |
| Translate one paragraph | Hold `Alt` and hover over it |
| Translate a selection | Select text → click the blue bubble |
| Translate a PDF | Popup → *Translate this PDF* (when viewing one), right-click a PDF link/page, or open the reader from the extension and drop a file |
| Bilingual ↔ translation-only | Popup → *Display* |
| Always translate a site | Popup → *Always translate this site* |
| Change style / language / provider | Popup or Settings |

## Privacy & cost

- Your API keys are stored in `chrome.storage.local` **on your machine only**.
- Page text is sent **only** to the provider you selected, over HTTPS, from your browser.
- No analytics, no tracking, no account, no server of ours whatsoever.
- You pay your provider directly for the tokens you use. Flash/mini-class models translate a typical article for a fraction of a cent, and Gemini/GLM currently offer generous free tiers.

## Architecture

```
manifest.json      MV3 manifest
background.js      service worker: provider calls, LRU cache, menus, shortcuts
providers.js       request builders + response parsers for each AI provider
content.js         paragraph detection, lazy batching, DOM injection, hover/selection UI
content.css        injected translation styles
popup.*            quick controls
options.*          full settings (general / providers / advanced)
pdf.*              bilingual PDF reader (pdf.js based, fully local)
pdf-extract.js     PDF text → paragraph grouping (line merge, de-hyphenation)
vendor/pdfjs/      bundled Mozilla pdf.js (Apache-2.0)
_locales/          en, ko
test/              provider unit tests (node) + DOM test page (headless Chrome)
scripts/           icon pipeline (AI-generate via Codex CLI + resize/mask)
```

The icon was generated with OpenAI's GPT Image model through the [Codex CLI](https://github.com/openai/codex) and post-processed with Pillow. Regenerate it anytime with `./scripts/generate-icon.sh` (requires `codex` logged in and Python + Pillow), or rebuild sizes from any square master with `python3 scripts/make_icons.py <master.png>`.

Run tests:

```bash
npm test                          # provider layer (includes a mock-server round trip)
# DOM logic in a real browser engine:
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --dump-dom test/dom-test.html | grep '<title>'   # PASS:n expected
```

### PDF translation notes

Unlike closed-source alternatives that hand your PDF to a viewer hosted on their servers, Hit Translate bundles [Mozilla pdf.js](https://mozilla.github.io/pdf.js/) inside the extension: the file is parsed **entirely in your browser**, and only the extracted text goes to the AI provider you configured. Text-based PDFs work; scanned/image PDFs need OCR, which is on the roadmap. Multi-column layouts (e.g. two-column academic papers) may read in interleaved order in this version.

## Roadmap

- [x] PDF translation (v1.2.0 — text-based PDFs)
- [ ] OCR for scanned PDFs
- [ ] Multi-column PDF layout detection
- [ ] Video subtitle translation
- [ ] Input box translation (write in your language, send in theirs)
- [ ] Firefox support
- [ ] Streaming translations

Contributions are welcome — open an issue or PR.

## License

[MIT](LICENSE)

---

## 한국어 소개

**Hit Translate**는 웹페이지를 문단 단위로 **원문 + 번역문**을 함께 보여주는 오픈소스 크롬 확장 프로그램입니다. '몰입형 번역' 류의 이중 언어 읽기 경험에서 영감을 받아 **처음부터 새로 구현**했으며, 특정 업체의 구독 대신 **자신의 AI API 키**(Gemini, OpenAI, Claude, Z.AI GLM, 또는 OpenAI 호환 커스텀/로컬 모델)를 등록해 **자신의 결제수단으로** 사용합니다.

- 기존 확장의 코드를 복사하지 않은 독립 구현이며, 해당 업체와 아무 관련이 없습니다.
- 번역 요청은 브라우저에서 선택한 AI 제공자에게 **직접** 전송됩니다. 중간 서버, 텔레메트리, 계정이 전혀 없습니다.
- API 키는 내 브라우저(`chrome.storage.local`)에만 저장됩니다.

**설치 (macOS / Windows 공통):** 위 [Install](#install-developer-mode--macos--windows) 절차대로 저장소를 받고 → `chrome://extensions` → 개발자 모드 켜기 → **압축해제된 확장 프로그램을 로드** → 폴더 선택 → 설정에서 API 키 등록 후 **연결 테스트** → 아무 외국어 페이지에서 `Alt+Q`.

**주요 기능:** 페이지 이중 번역(`Alt+Q`), 번역만 보기 모드, 스크롤 위치 기반 지연 번역(토큰 절약), SPA 동적 콘텐츠 자동 감지, `Alt`+마우스오버 문단 번역, 드래그 선택 번역, 5가지 번역문 스타일, 사이트별 자동 번역/제외 목록, 배치·캐시·재시도 처리.

**PDF 번역:** 익스텐션에 내장된 pdf.js 기반 이중 언어 PDF 리더를 제공합니다. PDF를 보던 중 팝업의 **"이 PDF 번역"** 버튼, PDF 링크 우클릭 메뉴, 또는 리더 페이지에 파일을 끌어다 놓는 방식으로 열 수 있고, 문단별 원문+번역을 보여주며 결과를 이중 언어 HTML로 저장할 수 있습니다. 파일 파싱은 전부 브라우저 안에서 이루어지고 추출된 텍스트만 설정한 AI 제공자에게 전송됩니다 (텍스트 기반 PDF만 지원, 스캔본 OCR은 로드맵).

**Ollama 로컬 번역:** 클라우드 계정 없이 완전 로컬로 번역할 수 있습니다. Ollama가 기본적으로 확장 프로그램 요청을 차단하므로, macOS에서는 `launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"` 실행 후 Ollama 앱을 재시작하세요 (Windows: `setx OLLAMA_ORIGINS chrome-extension://*`). 이후 설정 → AI 제공자 → Ollama에서 **설치된 모델 불러오기**로 모델을 선택하면 됩니다. 로컬 모델은 배치당 1분 안팎으로 느리므로 전체 페이지 번역에는 4~8B급 작은 모델을 권장합니다.
