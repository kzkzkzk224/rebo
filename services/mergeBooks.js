export function mergeBookLists(primaryList, secondaryList) {
  const map = new Map();

  for (const item of primaryList || []) {
    const key = createMergeKey(item);
    map.set(key, {
      ...item,
      source: {
        aladin: Boolean(item.source?.aladin),
        nl: Boolean(item.source?.nl),
      },
    });
  }

  for (const item of secondaryList || []) {
    const key = createMergeKey(item);
    const current = map.get(key);

    if (!current) {
      map.set(key, {
        ...item,
        source: {
          aladin: Boolean(item.source?.aladin),
          nl: Boolean(item.source?.nl),
        },
      });
      continue;
    }

    map.set(key, {
      ...current,
      title: pick(current.title, item.title),
      author: pick(current.author, item.author),
      publisher: pickBetterPublisher(current.publisher, item.publisher),
      pubYear: pickBetterYear(current.pubYear, item.pubYear),
      isbn13: pick(current.isbn13, item.isbn13),
      isbn: pick(current.isbn, item.isbn),
      cover: pick(current.cover, item.cover),
      status: normalizeStatus(current.status || item.status),
      memo: String(current.memo || item.memo || ""),
      source: {
        aladin: Boolean(current.source?.aladin || item.source?.aladin),
        nl: Boolean(current.source?.nl || item.source?.nl),
      },
    });
  }

  return Array.from(map.values());
}

export function createMergeKey(book) {
  const isbn13 = extractIsbn13(book?.isbn13 || book?.isbn || "");
  if (isbn13) return `isbn13:${isbn13}`;

  const title = normalizeTitle(book?.title || "");
  const author = normalizeAuthor(book?.author || "");
  return `ta:${title}::${author}`;
}

export function createBookId(book) {
  const isbn13 = extractIsbn13(book?.isbn13 || book?.isbn || "");
  if (isbn13) return `isbn-${isbn13}`;

  const title = normalizeTitle(book?.title || "");
  const author = normalizeAuthor(book?.author || "");
  const hash = simpleHash(`${title}-${author}`);
  return `book-${hash}`;
}

export function normalizeTitle(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeAuthor(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeText(text) {
  return String(text || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export function extractIsbn13(raw) {
  const tokens = String(raw || "")
    .split(/[\s,]+/)
    .map((token) => token.replace(/[^0-9Xx]/g, ""))
    .filter(Boolean);

  return tokens.find((token) => token.length === 13) || "";
}

export function extractYear(raw) {
  const text = normalizeText(raw);
  const match = text.match(/(19|20)\d{2}/);
  return match ? match[0] : "";
}

export function normalizeStatus(status) {
  const value = String(status || "to-read").trim();
  if (value === "to-read" || value === "reading" || value === "done") return value;
  return "to-read";
}

export function dedupeByKey(items, keyFn) {
  const map = new Map();
  for (const item of items || []) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

function pick(primary, secondary) {
  const a = String(primary || "").trim();
  const b = String(secondary || "").trim();
  if (a) return a;
  return b;
}

function pickBetterPublisher(primary, secondary) {
  const a = String(primary || "").trim();
  const b = String(secondary || "").trim();
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

function pickBetterYear(primary, secondary) {
  const a = String(primary || "").trim();
  const b = String(secondary || "").trim();
  if (/^(19|20)\d{2}$/.test(b)) return b;
  if (/^(19|20)\d{2}$/.test(a)) return a;
  return a || b;
}

function simpleHash(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}
