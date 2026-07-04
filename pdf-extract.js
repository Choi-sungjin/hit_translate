// Hit Translate — PDF text extraction helpers.
// Turns pdf.js textContent items into paragraph strings. Pure functions,
// shared by the PDF reader page and the node test suite.
//
// Limitation: assumes a single text column per page. Multi-column layouts
// (two-column papers) will interleave; see README roadmap.

// Group raw text items into visual lines (same baseline y).
export function itemsToLines(items) {
  const usable = items.filter((it) => it.str && it.str.trim().length);
  const sorted = [...usable].sort(
    (a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]
  );
  const lines = [];
  for (const it of sorted) {
    const x = it.transform[4];
    const y = it.transform[5];
    const h = it.height || Math.abs(it.transform[3]) || 10;
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - y) <= Math.max(2, last.height * 0.45)) {
      const gap = x - last.endX;
      const needsSpace =
        gap > last.height * 0.2 && !last.text.endsWith(' ') && !it.str.startsWith(' ');
      last.text += (needsSpace ? ' ' : '') + it.str;
      last.endX = Math.max(last.endX, x + (it.width || 0));
      last.height = Math.max(last.height, h);
    } else {
      lines.push({ text: it.str, x, y, height: h, endX: x + (it.width || 0) });
    }
  }
  return lines;
}

// The document's standard line spacing is the most frequent vertical gap
// (mode). A median can be skewed by headings in short documents.
function typicalGap(gaps) {
  if (!gaps.length) return 14;
  const counts = new Map();
  for (const gap of gaps) {
    const key = Math.round(gap * 2) / 2;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [gap, count] of counts) {
    if (count > bestCount || (count === bestCount && gap < best)) {
      best = gap;
      bestCount = count;
    }
  }
  if (bestCount > 1) return best;
  const sorted = [...gaps].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Merge lines into paragraphs using vertical gaps and font-size changes.
export function linesToParagraphs(lines) {
  if (!lines.length) return [];
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > 0.1) gaps.push(gap);
  }
  const median = typicalGap(gaps);

  // Bullet or numbered-list markers always begin a new paragraph — dense
  // lists often use line spacing identical to their body text.
  const LIST_MARKER = /^([-–—•·▪‣*]|\d{1,2}[.)]\s)/;

  const paragraphs = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = lines[i - 1];
    let startNew = !current;
    if (current && prev) {
      const gap = prev.y - line.y;
      if (gap > median * 1.6) startNew = true; // blank line between paragraphs
      if (gap < -median) startNew = true; // jumped upward: new block
      if (Math.abs(line.height - prev.height) > prev.height * 0.25) startNew = true; // heading/body switch
      if (LIST_MARKER.test(line.text)) startNew = true;
    }
    if (startNew) {
      current = { text: line.text };
      paragraphs.push(current);
    } else if (current.text.endsWith('-') && /^[\p{Ll}]/u.test(line.text)) {
      current.text = current.text.slice(0, -1) + line.text; // de-hyphenate
    } else {
      current.text += ' ' + line.text;
    }
  }
  return paragraphs
    .map((p) => p.text.replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 1);
}

// Oversized paragraphs blow past request limits and get truncated by the
// model; split them at sentence boundaries into <= maxLen chunks.
export function splitLongParagraph(text, maxLen = 1000) {
  if (text.length <= maxLen) return [text];
  const sentences = text.split(/(?<=[.!?。？！])\s+/);
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > maxLen) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
    while (current.length > maxLen) {
      chunks.push(current.slice(0, maxLen));
      current = current.slice(maxLen);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function itemsToParagraphs(items, { maxLen = 1000 } = {}) {
  return linesToParagraphs(itemsToLines(items)).flatMap((p) => splitLongParagraph(p, maxLen));
}

// Should this tab URL be taken over by the bilingual PDF reader?
// '#hit-original' is the escape hatch the reader adds to its
// "open original" link so the redirect doesn't loop.
export function isPdfUrl(url) {
  if (!/^(https?|file):/i.test(url || '')) return false;
  if (url.includes('#hit-original')) return false;
  try {
    const pathname = new URL(url).pathname;
    let decoded = pathname;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      /* keep raw pathname */
    }
    return /\.pdf$/i.test(decoded);
  } catch {
    return false;
  }
}
