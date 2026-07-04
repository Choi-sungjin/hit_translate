// Hit Translate — content script.
// Finds translatable text blocks, requests translations from the background
// worker in batches, and injects the result under (or instead of) the source.
(() => {
  'use strict';

  const IS_EXT = typeof chrome !== 'undefined' && !!chrome.runtime?.id;

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
    'BUTTON', 'PRE', 'SVG', 'MATH', 'CANVAS', 'AUDIO', 'VIDEO', 'IFRAME',
    'OBJECT', 'EMBED', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE'
  ]);

  const BLOCKISH = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DETAILS', 'DIALOG', 'DD',
    'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HGROUP', 'HR', 'LI',
    'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'UL',
    'TBODY', 'THEAD', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION'
  ]);

  const LETTER_RE = /\p{L}{2,}/u;

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
    concurrency: 3
  };

  let settings = { ...DEFAULTS };
  let enabled = false;
  const done = new WeakSet(); // units already translated or in flight
  const wrappers = new Set(); // injected translation nodes
  let io = null;
  let mo = null;
  let flushTimer = null;
  const queue = [];
  let activeRequests = 0;
  const waitingBatches = [];

  // ---------- unit discovery ----------

  function isSkippableElement(el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.hasAttribute('data-hit-node')) return true;
    if (el.classList.contains('notranslate')) return true;
    if (el.getAttribute('translate') === 'no') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function hasBlockishChild(el) {
    for (const child of el.children) {
      if (child.hasAttribute('data-hit-node')) continue;
      if (BLOCKISH.has(child.tagName)) return true;
    }
    return false;
  }

  function isVisible(el) {
    try {
      return typeof el.checkVisibility === 'function' ? el.checkVisibility() : true;
    } catch {
      return true;
    }
  }

  function unitText(el) {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.ELEMENT_NODE && node.hasAttribute('data-hit-node')) continue;
      text += node.textContent;
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  // Heuristic "already in target language" check to save tokens.
  function looksLikeTargetLang(text, lang) {
    const sample = text.slice(0, 400);
    const letters = (sample.match(/\p{L}/gu) || []).length;
    if (!letters) return false;
    const ratio = (re) => ((sample.match(re) || []).length) / letters;
    if (lang.startsWith('ko')) return ratio(/[가-힯]/g) > 0.5;
    if (lang.startsWith('ja')) return ratio(/[぀-ヿ]/g) > 0.3;
    if (lang.startsWith('zh')) return ratio(/[一-鿿]/g) > 0.5 && ratio(/[぀-ヿ]/g) < 0.05;
    if (lang.startsWith('en')) return ratio(/[A-Za-z]/g) > 0.95;
    return false;
  }

  function collectUnits(root, out = []) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return out;
    if (isSkippableElement(root)) return out;
    if (hasBlockishChild(root)) {
      for (const child of root.children) collectUnits(child, out);
      return out;
    }
    const text = unitText(root);
    if (
      text.length >= 2 &&
      text.length <= 6000 &&
      LETTER_RE.test(text) &&
      !done.has(root) &&
      !root.querySelector(':scope > font[data-hit-node]') &&
      isVisible(root) &&
      !looksLikeTargetLang(text, settings.targetLang)
    ) {
      out.push(root);
    }
    return out;
  }

  // ---------- injection ----------

  function makeWrapper() {
    // <font> is used on purpose: almost no site CSS targets it, so the
    // injected block inherits the surrounding text style cleanly.
    const wrapper = document.createElement('font');
    wrapper.setAttribute('data-hit-node', '');
    wrapper.className = `hit-target hit-style-${settings.style}`;
    return wrapper;
  }

  function setLoading(unit) {
    let wrapper = unit.querySelector(':scope > font[data-hit-node]');
    if (!wrapper) {
      wrapper = makeWrapper();
      unit.appendChild(wrapper);
      wrappers.add(wrapper);
    }
    wrapper.classList.add('hit-loading');
    wrapper.textContent = '…';
    return wrapper;
  }

  function hideOriginal(unit) {
    for (const node of [...unit.childNodes]) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.hasAttribute('data-hit-node')) continue;
        node.setAttribute('data-hit-orig-el', '');
      } else if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        const span = document.createElement('span');
        span.setAttribute('data-hit-orig', '');
        node.replaceWith(span);
        span.appendChild(node);
      }
    }
  }

  function showOriginal(unit) {
    for (const el of unit.querySelectorAll(':scope > [data-hit-orig-el]')) {
      el.removeAttribute('data-hit-orig-el');
    }
    for (const span of unit.querySelectorAll(':scope > span[data-hit-orig]')) {
      span.replaceWith(...span.childNodes);
    }
  }

  function applyTranslation(unit, translation) {
    const wrapper = setLoading(unit);
    wrapper.classList.remove('hit-loading', 'hit-error');
    wrapper.textContent = translation;
    wrapper.setAttribute('lang', settings.targetLang);
    if (settings.mode === 'replace') {
      hideOriginal(unit);
      wrapper.classList.add('hit-replace');
    }
  }

  function applyError(unit, message) {
    const wrapper = setLoading(unit);
    wrapper.classList.remove('hit-loading');
    wrapper.classList.add('hit-error');
    wrapper.textContent = '⚠ retry';
    wrapper.title = message;
    wrapper.addEventListener(
      'click',
      () => {
        done.delete(unit);
        wrapper.remove();
        wrappers.delete(wrapper);
        enqueueUnit(unit);
      },
      { once: true }
    );
  }

  function restoreAll() {
    for (const wrapper of wrappers) wrapper.remove();
    wrappers.clear();
    for (const el of document.querySelectorAll('[data-hit-orig-el]')) {
      el.removeAttribute('data-hit-orig-el');
    }
    for (const span of document.querySelectorAll('span[data-hit-orig]')) {
      span.replaceWith(...span.childNodes);
    }
  }

  function refreshStyleClasses() {
    for (const wrapper of wrappers) {
      wrapper.className = wrapper.className
        .split(' ')
        .filter((c) => !c.startsWith('hit-style-'))
        .join(' ');
      wrapper.classList.add(`hit-style-${settings.style}`);
    }
  }

  function applyModeToExisting() {
    for (const wrapper of wrappers) {
      const unit = wrapper.parentElement;
      if (!unit || wrapper.classList.contains('hit-loading') || wrapper.classList.contains('hit-error')) continue;
      if (settings.mode === 'replace') {
        hideOriginal(unit);
        wrapper.classList.add('hit-replace');
      } else {
        showOriginal(unit);
        wrapper.classList.remove('hit-replace');
      }
    }
  }

  // ---------- batching & dispatch ----------

  function enqueueUnit(unit) {
    if (done.has(unit)) return;
    done.add(unit);
    queue.push(unit);
    if (queue.length >= settings.batchMaxItems) {
      flushQueue();
    } else {
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flushQueue, 250);
    }
  }

  function flushQueue() {
    clearTimeout(flushTimer);
    while (queue.length) {
      const batch = [];
      let chars = 0;
      while (
        queue.length &&
        batch.length < settings.batchMaxItems &&
        (batch.length === 0 || chars + unitText(queue[0]).length <= settings.batchCharLimit)
      ) {
        const unit = queue.shift();
        chars += unitText(unit).length;
        batch.push(unit);
      }
      scheduleBatch(batch);
    }
  }

  function scheduleBatch(batch) {
    if (activeRequests >= settings.concurrency) {
      waitingBatches.push(batch);
      return;
    }
    void dispatchBatch(batch);
  }

  async function dispatchBatch(batch) {
    const units = batch.filter((u) => u.isConnected);
    if (!units.length) return;
    activeRequests++;
    const texts = units.map((u) => unitText(u));
    for (const unit of units) setLoading(unit);
    try {
      const res = await sendMessage({ type: 'translate', texts, targetLang: settings.targetLang });
      if (res?.ok) {
        units.forEach((unit, i) => applyTranslation(unit, res.translations[i]));
      } else {
        const msg = res?.error === 'NO_KEY'
          ? 'No API key configured — open Hit Translate options.'
          : res?.error || 'Translation failed';
        units.forEach((unit) => applyError(unit, msg));
      }
    } catch (err) {
      units.forEach((unit) => applyError(unit, String(err?.message || err)));
    } finally {
      activeRequests--;
      const next = waitingBatches.shift();
      if (next) void dispatchBatch(next);
    }
  }

  function sendMessage(msg) {
    return chrome.runtime.sendMessage(msg);
  }

  // ---------- page translation lifecycle ----------

  function startObservers() {
    io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            io.unobserve(entry.target);
            enqueueUnit(entry.target);
          }
        }
      },
      { rootMargin: '800px 0px 800px 0px' }
    );

    mo = new MutationObserver((records) => {
      clearTimeout(mo._debounce);
      const added = [];
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE && !node.hasAttribute('data-hit-node')) {
            added.push(node);
          }
        }
      }
      if (!added.length) return;
      mo._debounce = setTimeout(() => {
        for (const node of added) {
          if (!node.isConnected) continue;
          for (const unit of collectUnits(node)) io.observe(unit);
        }
      }, 500);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function stopObservers() {
    io?.disconnect();
    mo?.disconnect();
    io = null;
    mo = null;
  }

  function translatePage() {
    if (enabled) return;
    enabled = true;
    startObservers();
    for (const unit of collectUnits(document.body)) io.observe(unit);
    notifyState();
  }

  function restorePage() {
    if (!enabled) return;
    enabled = false;
    stopObservers();
    queue.length = 0;
    waitingBatches.length = 0;
    restoreAll();
    // WeakSet has no clear(); dropping marks per-unit is enough because the
    // wrappers were removed, and re-translate re-collects fresh units.
    for (const el of document.body.querySelectorAll('*')) done.delete(el);
    notifyState();
  }

  function togglePage() {
    if (enabled) restorePage();
    else translatePage();
  }

  function notifyState() {
    if (!IS_EXT) return;
    try {
      chrome.runtime.sendMessage({ type: 'pageState', enabled }).catch(() => {});
    } catch {
      /* extension context gone */
    }
  }

  // ---------- selection bubble ----------

  let bubble = null;

  function removeBubble() {
    bubble?.remove();
    bubble = null;
  }

  function showBubbleAt(x, y, mode) {
    removeBubble();
    bubble = document.createElement('div');
    bubble.setAttribute('data-hit-node', '');
    bubble.className = mode === 'trigger' ? 'hit-bubble hit-bubble-trigger' : 'hit-bubble';
    bubble.style.left = `${Math.min(x, window.innerWidth - 40)}px`;
    bubble.style.top = `${Math.min(y, window.innerHeight - 40)}px`;
    document.documentElement.appendChild(bubble);
    return bubble;
  }

  async function translateSelectionText(text, x, y) {
    const panel = showBubbleAt(x, y, 'panel');
    panel.textContent = '…';
    try {
      const res = await sendMessage({ type: 'translate', texts: [text], targetLang: settings.targetLang });
      if (!bubble || bubble !== panel) return;
      panel.textContent = res?.ok
        ? res.translations[0]
        : res?.error === 'NO_KEY'
          ? 'No API key configured — open Hit Translate options.'
          : `Error: ${res?.error || 'translation failed'}`;
    } catch (err) {
      if (bubble === panel) panel.textContent = `Error: ${String(err?.message || err)}`;
    }
  }

  function onMouseUp(event) {
    if (!settings.selectionEnabled || !IS_EXT) return;
    if (event.target?.closest?.('[data-hit-node]')) return;
    setTimeout(() => {
      const text = String(window.getSelection?.() || '').trim();
      if (text.length < 2 || text.length > 3000) {
        if (bubble?.classList.contains('hit-bubble-trigger')) removeBubble();
        return;
      }
      const trigger = showBubbleAt(event.clientX + 8, event.clientY + 12, 'trigger');
      trigger.textContent = '譯';
      trigger.title = 'Translate selection (Hit Translate)';
      trigger.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        translateSelectionText(text, event.clientX + 8, event.clientY + 12);
      });
    }, 0);
  }

  function onGlobalMouseDown(event) {
    if (bubble && !event.target?.closest?.('.hit-bubble')) removeBubble();
  }

  // ---------- hover translate (hold Alt over a paragraph) ----------

  let altHeld = false;
  let lastPointer = { x: 0, y: 0 };
  let hoverThrottle = 0;

  // Climb from the hovered element to the largest ancestor that is still a
  // "leaf block" (no block-level children) — that is the paragraph unit.
  function findUnitAt(el) {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      if (isSkippableElement(n)) return null;
    }
    let unit = el;
    while (
      unit.parentElement &&
      unit.parentElement !== document.body &&
      !hasBlockishChild(unit.parentElement)
    ) {
      unit = unit.parentElement;
    }
    return hasBlockishChild(unit) ? null : unit;
  }

  function hoverTranslateAtPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || el.closest('[data-hit-node]')) return;
    const unit = findUnitAt(el);
    if (!unit || unit === document.body) return;
    const text = unitText(unit);
    if (text.length < 2 || !LETTER_RE.test(text) || done.has(unit)) return;
    if (looksLikeTargetLang(text, settings.targetLang)) return;
    done.add(unit);
    setLoading(unit);
    sendMessage({ type: 'translate', texts: [text], targetLang: settings.targetLang })
      .then((res) => {
        if (res?.ok) applyTranslation(unit, res.translations[0]);
        else applyError(unit, res?.error === 'NO_KEY' ? 'No API key configured' : res?.error || 'failed');
      })
      .catch((err) => applyError(unit, String(err?.message || err)));
  }

  function onKeyDown(event) {
    if (event.key !== 'Alt' || !settings.hoverEnabled || !IS_EXT) return;
    altHeld = true;
    hoverTranslateAtPoint(lastPointer.x, lastPointer.y);
  }

  function onKeyUp(event) {
    if (event.key === 'Alt') altHeld = false;
  }

  function onMouseMove(event) {
    lastPointer = { x: event.clientX, y: event.clientY };
    if (!altHeld || !settings.hoverEnabled) return;
    const now = Date.now();
    if (now - hoverThrottle < 250) return;
    hoverThrottle = now;
    hoverTranslateAtPoint(event.clientX, event.clientY);
  }

  // ---------- settings & wiring ----------

  function siteListed(list) {
    const host = location.hostname;
    return (list || []).some((entry) => {
      const e = entry.trim();
      return e && (host === e || host.endsWith(`.${e}`));
    });
  }

  async function loadSettings() {
    const stored = (await chrome.storage.local.get('settings')).settings || {};
    settings = { ...DEFAULTS, ...stored };
  }

  function watchSettings() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      const before = settings;
      settings = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
      if (settings.style !== before.style) refreshStyleClasses();
      if (settings.mode !== before.mode) applyModeToExisting();
    });
  }

  async function init() {
    await loadSettings();
    if (siteListed(settings.excludedSites)) return;
    watchSettings();

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'togglePage') {
        togglePage();
        sendResponse({ enabled });
      } else if (msg?.type === 'getPageState') {
        sendResponse({ enabled });
      } else if (msg?.type === 'translateSelection') {
        const sel = window.getSelection();
        const text = String(sel || '').trim();
        if (text) {
          const rect = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : { left: 40, bottom: 40 };
          translateSelectionText(text, rect.left, rect.bottom + 8);
        }
        sendResponse({ ok: true });
      }
      return false;
    });

    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('mousedown', onGlobalMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('scroll', removeBubble, { passive: true });

    if (siteListed(settings.autoSites)) translatePage();
  }

  if (IS_EXT) {
    init();
  } else {
    // Test harness mode (plain <script> include, no chrome.* APIs).
    window.__hitTest = {
      collectUnits,
      applyTranslation,
      applyError,
      restoreAll,
      unitText,
      looksLikeTargetLang,
      setSettings: (patch) => Object.assign(settings, patch),
      getWrapperCount: () => wrappers.size
    };
  }
})();
