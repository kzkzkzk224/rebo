import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { searchAladinBooks } from "./services/aladin.js";
import { searchNationalLibraryBooks } from "./services/nl.js";
import { mergeBookLists, createBookId, normalizeStatus } from "./services/mergeBooks.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 4173);

const DATA_DIR = path.join(__dirname, "data");
const BOOKSHELF_FILE = path.join(DATA_DIR, "bookshelf.json");

let writeQueue = Promise.resolve();

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/books/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  const limit = clampNumber(req.query.limit, 1, 40, 20);

  if (!query) {
    return res.status(400).json({
      items: [],
      meta: { query, count: 0, warnings: ["검색어(q)가 필요합니다."] },
      error: "bad_request",
      message: "검색어(q)가 필요합니다.",
    });
  }

  const warnings = [];
  const errors = [];

  const aladinPromise = searchAladinBooks({ query, limit, apiKey: process.env.ALADIN_TTB_KEY || "" });
  const nlPromise = searchNationalLibraryBooks({ query, limit, apiKey: process.env.NL_API_KEY || "" });

  const [aladinResult, nlResult] = await Promise.allSettled([aladinPromise, nlPromise]);

  let aladinItems = [];
  let nlItems = [];

  if (aladinResult.status === "fulfilled") {
    aladinItems = aladinResult.value.items;
    warnings.push(...(aladinResult.value.warnings || []));
  } else {
    errors.push(`[알라딘] ${String(aladinResult.reason?.message || aladinResult.reason || "unknown error")}`);
  }

  if (nlResult.status === "fulfilled") {
    nlItems = nlResult.value.items;
    warnings.push(...(nlResult.value.warnings || []));
  } else {
    errors.push(`[국립중앙도서관] ${String(nlResult.reason?.message || nlResult.reason || "unknown error")}`);
  }

  if (aladinItems.length === 0 && nlItems.length === 0 && errors.length > 0) {
    return res.status(502).json({
      items: [],
      meta: { query, count: 0, warnings: [...warnings, ...errors] },
      error: "external_api_failed",
      message: `외부 API 실패: ${errors.join(" | ")}`,
    });
  }

  const merged = mergeBookLists(aladinItems, nlItems)
    .slice(0, limit)
    .map((book) => ({
      id: createBookId(book),
      title: book.title || "",
      author: book.author || "",
      publisher: book.publisher || "",
      pubYear: book.pubYear || "",
      isbn13: book.isbn13 || "",
      isbn: book.isbn || "",
      cover: book.cover || "/placeholder-cover.svg",
      status: normalizeStatus(book.status),
      memo: String(book.memo || ""),
      source: {
        aladin: Boolean(book.source?.aladin),
        nl: Boolean(book.source?.nl),
      },
    }));

  return res.json({
    items: merged,
    meta: {
      query,
      count: merged.length,
      warnings: [...warnings, ...errors],
    },
  });
});

app.get("/api/bookshelf", async (_req, res) => {
  const data = await readBookshelf();
  res.json(data);
});

app.post("/api/bookshelf", async (req, res) => {
  const incoming = req.body || {};
  console.log("[api bookshelf] POST request", { title: incoming?.title, id: incoming?.id });
  const item = normalizeBookshelfItem(incoming);

  if (!item.title) {
    return res.status(400).json({ error: "bad_request", message: "title은 필수입니다." });
  }

  const data = await readBookshelf();
  const index = data.items.findIndex((book) => book.id === item.id);

  if (index >= 0) {
    return res.status(200).json({
      item: data.items[index],
      exists: true,
      message: "이미 책장에 추가된 책입니다.",
    });
  }

  data.items.unshift(item);
  await writeBookshelf(data);
  return res.status(201).json({ item, exists: false });
});

app.patch("/api/bookshelf/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "bad_request", message: "id가 필요합니다." });

  const updates = req.body || {};
  const data = await readBookshelf();
  const index = data.items.findIndex((book) => book.id === id);

  if (index < 0) return res.status(404).json({ error: "not_found", message: "책을 찾을 수 없습니다." });

  const current = data.items[index];
  const next = {
    ...current,
    status: updates.status ? normalizeStatus(updates.status) : current.status,
    memo: typeof updates.memo === "string" ? updates.memo.slice(0, 200) : current.memo,
    startDate: typeof updates.startDate === "string" ? updates.startDate : current.startDate,
    endDate: typeof updates.endDate === "string" ? updates.endDate : current.endDate,
    review: typeof updates.review === "string" ? updates.review.slice(0, 2000) : current.review,
    reminder:
      updates.reminder && typeof updates.reminder === "object"
        ? {
            days: Array.isArray(updates.reminder.days)
              ? updates.reminder.days.map((d) => String(d)).slice(0, 7)
              : current.reminder?.days || [],
            time: typeof updates.reminder.time === "string" ? updates.reminder.time : current.reminder?.time || "20:00",
          }
        : current.reminder,
  };

  data.items[index] = next;
  await writeBookshelf(data);
  return res.json({ item: next });
});

app.delete("/api/bookshelf/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const data = await readBookshelf();
  const before = data.items.length;

  data.items = data.items.filter((book) => book.id !== id);

  if (data.items.length === before) {
    return res.status(404).json({ error: "not_found", message: "삭제할 책이 없습니다." });
  }

  await writeBookshelf(data);
  return res.json({ ok: true });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    const missing = [];
    if (!process.env.ALADIN_TTB_KEY) missing.push("ALADIN_TTB_KEY");
    if (!process.env.NL_API_KEY) missing.push("NL_API_KEY (optional)");

    console.log(`rebo server running on http://localhost:${PORT}`);
    if (missing.length > 0) console.log(`[env] missing: ${missing.join(", ")}`);
  });
}


function clampNumber(raw, min, max, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

async function readBookshelf() {
  try {
    const raw = await fs.readFile(BOOKSHELF_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed.items) ? parsed.items.map(normalizeBookshelfItem) : [];
    return { items };
  } catch {
    return { items: [] };
  }
}

function writeBookshelf(data) {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(BOOKSHELF_FILE, JSON.stringify({ items: data.items }, null, 2), "utf8");
  });

  return writeQueue;
}

function normalizeBookshelfItem(input) {
  const book = input || {};
  const normalized = {
    id: String(book.id || createBookId(book)).trim(),
    title: String(book.title || "").trim(),
    author: String(book.author || "").trim(),
    publisher: String(book.publisher || "").trim(),
    pubYear: String(book.pubYear || "").trim(),
    isbn13: String(book.isbn13 || "").trim(),
    isbn: String(book.isbn || "").trim(),
    cover: String(book.cover || "/placeholder-cover.svg").trim() || "/placeholder-cover.svg",
    status: normalizeStatus(book.status),
    memo: String(book.memo || "").slice(0, 200),
    startDate: String(book.startDate || ""),
    endDate: String(book.endDate || ""),
    review: String(book.review || "").slice(0, 2000),
    reminder: {
      days: Array.isArray(book.reminder?.days) ? book.reminder.days.map((d) => String(d)).slice(0, 7) : [],
      time: typeof book.reminder?.time === "string" ? book.reminder.time : "20:00",
    },
    source: {
      aladin: Boolean(book.source?.aladin),
      nl: Boolean(book.source?.nl),
    },
  };

  if (!normalized.id) {
    normalized.id = createBookId(normalized);
  }

  return normalized;
}

export default app;




