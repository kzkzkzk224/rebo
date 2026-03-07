const { createMergeKey, dedupeByKey, extractYear, normalizeText, extractIsbn13 } = require("./mergeBooks");

async function searchAladinBooks({ query, limit, apiKey }) {
  const warnings = [];

  if (!apiKey) {
    return {
      items: [],
      warnings: ["환경변수 ALADIN_TTB_KEY가 설정되지 않았습니다."],
    };
  }

  const titleItems = await fetchItemSearch({ query, limit, queryType: "Title", apiKey });
  let items = titleItems;

  if (titleItems.length < Math.min(5, limit)) {
    const keywordItems = await fetchItemSearch({ query, limit, queryType: "Keyword", apiKey });
    items = dedupeByKey([...titleItems, ...keywordItems], (book) => createMergeKey(book));
    warnings.push("제목 검색 결과가 적어 Keyword 검색으로 보강했습니다.");
  }

  return {
    items: items.map((item) => ({ ...item, source: { aladin: true, nl: false } })),
    warnings,
  };
}

async function fetchItemSearch({ query, limit, queryType, apiKey }) {
  const url = new URL("https://www.aladin.co.kr/ttb/api/ItemSearch.aspx");
  url.searchParams.set("ttbkey", apiKey);
  url.searchParams.set("Query", query);
  url.searchParams.set("QueryType", queryType);
  url.searchParams.set("MaxResults", String(limit));
  url.searchParams.set("SearchTarget", "Book");
  url.searchParams.set("output", "js");
  url.searchParams.set("Version", "20131101");

  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    const cause = error?.cause ? JSON.stringify(error.cause) : "no-cause";
    throw new Error(`[Aladin ${queryType}] fetch failed; url=${url.toString()}; cause=${cause}; message=${String(error.message || error)}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`[Aladin ${queryType}] HTTP ${response.status}; url=${url.toString()}; body=${body.slice(0, 200)}`);
  }

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("json")) {
    const body = await response.text();
    throw new Error(`[Aladin ${queryType}] expected JSON; content-type=${contentType}; body=${body.slice(0, 200)}`);
  }

  const payload = await response.json();
  const list = Array.isArray(payload.item) ? payload.item : [];

  return list.map((raw) => ({
    title: normalizeText(raw.title),
    author: normalizeText(raw.author),
    publisher: normalizeText(raw.publisher),
    pubYear: extractYear(raw.pubDate || raw.pubDateStandard || ""),
    isbn13: extractIsbn13(raw.isbn13 || raw.isbn || ""),
    isbn: normalizeText(raw.isbn || raw.isbn13 || ""),
    cover: raw.cover || raw.coverLargeUrl || "/placeholder-cover.svg",
    status: "to-read",
    memo: "",
  }));
}

module.exports = {
  searchAladinBooks,
};

