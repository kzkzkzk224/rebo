const state = {
  view: "home",
  search: {
    query: "",
    items: [],
    loading: false,
    message: "",
    error: "",
    warnings: [],
  },
  shelf: {
    items: [],
    loading: false,
    message: "",
    error: "",
  },
};

const $view = document.getElementById("view");

clearLegacyCacheControls();

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => setView(tab.dataset.view));
});

setView("home");

function setView(viewName) {
  state.view = viewName;

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === viewName);
  });

  if (viewName === "home") renderHome();
  if (viewName === "search") renderSearch();
  if (viewName === "shelf") renderShelf();
}

function renderHome() {
  const tpl = document.getElementById("home-template");
  $view.innerHTML = tpl.innerHTML;
  document.getElementById("home-start-search").addEventListener("click", () => setView("search"));
}

function renderSearch() {
  const tpl = document.getElementById("search-template");
  $view.innerHTML = tpl.innerHTML;

  const $input = document.getElementById("search-input");
  const $btn = document.getElementById("search-btn");

  $input.value = state.search.query;

  $btn.addEventListener("click", () => runSearchFromInput());
  $input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearchFromInput();
  });

  drawSearchState();
  drawSearchResults();
}

async function runSearchFromInput() {
  const $input = document.getElementById("search-input");
  const q = String($input?.value || "").trim();
  await runSearch(q);
}

async function runSearch(query) {
  state.search.query = query;
  state.search.error = "";
  state.search.message = "";
  state.search.warnings = [];

  if (!query) {
    state.search.items = [];
    state.search.message = "검색어를 입력해주세요.";
    drawSearchState();
    drawSearchResults();
    return;
  }

  state.search.loading = true;
  state.search.message = "로딩 중...";
  drawSearchState();
  drawSearchResults();

  const result = await searchBooks(query);

  state.search.loading = false;
  state.search.items = result.items;
  state.search.warnings = result.warnings;

  if (result.error) {
    state.search.error = result.error;
    state.search.message = "";
    drawSearchState();
    drawSearchResults();
    return;
  }

  if (result.items.length === 0) {
    state.search.message = "검색 결과가 없습니다.";
  } else {
    state.search.message = `검색 결과 ${result.items.length}건`;
  }

  drawSearchState();
  drawSearchResults();
}

async function searchBooks(query) {
  const url = `/api/books/search?q=${encodeURIComponent(query)}`;
  console.log("[rebo search] request url", url);

  try {
    const response = await fetch(url);
    const status = response.status;
    const text = await response.text();
    console.log("[rebo search] response status", status);

    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      console.log("[rebo search] response body", text);

      let errorMessage = data?.message || "검색 API 실패";
      if (status === 400) errorMessage = data?.message || "요청 형식이 올바르지 않습니다.";
      if (status >= 500) errorMessage = data?.message || "외부 API 실패로 검색하지 못했습니다.";

      return {
        items: [],
        warnings: data?.meta?.warnings || [],
        error: errorMessage,
      };
    }

    // 응답은 data.items 기준으로 사용
    const books = data?.items || [];

    return {
      items: books,
      warnings: data?.meta?.warnings || [],
      error: "",
    };
  } catch (error) {
    console.log("[rebo search] fetch exception", String(error.message || error));
    return {
      items: [],
      warnings: [],
      error: `검색 API 실패: ${String(error.message || error)}`,
    };
  }
}

function drawSearchState() {
  const $state = document.getElementById("search-state");
  if (!$state) return;

  $state.className = "state";

  if (state.search.loading) {
    $state.textContent = "로딩 중...";
    return;
  }

  if (state.search.error) {
    $state.classList.add("error");
    const warnings = state.search.warnings.map((w) => `<div>${escapeHtml(w)}</div>`).join("");
    $state.innerHTML = `<strong>${escapeHtml(state.search.error)}</strong>${warnings}`;
    return;
  }

  if (state.search.warnings.length > 0) {
    $state.classList.add("warn");
    const warnings = state.search.warnings.map((w) => `<div>${escapeHtml(w)}</div>`).join("");
    $state.innerHTML = warnings;
    return;
  }

  $state.textContent = state.search.message;
}

function drawSearchResults() {
  const $list = document.getElementById("search-results");
  if (!$list) return;

  if (state.search.loading || state.search.error || state.search.items.length === 0) {
    $list.innerHTML = "";
    return;
  }

  $list.innerHTML = state.search.items
    .map((book) => {
      return `
        <article class="book-card">
          <img class="book-cover" src="${escapeAttr(book.cover || "/placeholder-cover.svg")}" alt="${escapeAttr(book.title)}" />
          <div class="book-body">
            <p class="book-title">${escapeHtml(book.title)}</p>
            <p class="book-meta">저자: ${escapeHtml(book.author || "정보 없음")}</p>
            <p class="book-meta">출판사: ${escapeHtml(book.publisher || "정보 없음")}</p>
            <p class="book-meta">발행년도: ${escapeHtml(book.pubYear || "정보 없음")}</p>
            <p class="book-meta">ISBN: ${escapeHtml(book.isbn13 || book.isbn || "정보 없음")}</p>
            <div class="card-actions">
              <button class="primary" data-save-id="${escapeAttr(book.id)}">내 서재 저장</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  $list.querySelectorAll("[data-save-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.saveId;
      const book = state.search.items.find((item) => item.id === id);
      if (!book) return;

      try {
        const res = await fetch("/api/bookshelf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(book),
        });
        const payload = await res.json();

        if (!res.ok) {
          alert(payload.message || "저장 실패");
          return;
        }

        alert("내 서재에 저장했습니다.");
      } catch (error) {
        alert(`저장 실패: ${String(error.message || error)}`);
      }
    });
  });
}

function renderShelf() {
  const tpl = document.getElementById("shelf-template");
  $view.innerHTML = tpl.innerHTML;
  loadShelf();
}

async function loadShelf() {
  state.shelf.loading = true;
  state.shelf.error = "";
  state.shelf.message = "로딩 중...";
  drawShelfState();

  try {
    const response = await fetch("/api/bookshelf");
    const payload = await response.json();

    if (!response.ok) {
      state.shelf.error = payload.message || "내 서재 조회 실패";
      state.shelf.loading = false;
      drawShelfState();
      drawShelfItems();
      return;
    }

    state.shelf.items = payload.items || [];
    state.shelf.loading = false;

    if (state.shelf.items.length === 0) {
      state.shelf.message = "아직 저장된 책이 없습니다.";
    } else {
      state.shelf.message = `내 서재 ${state.shelf.items.length}권`;
    }

    drawShelfState();
    drawShelfItems();
  } catch (error) {
    state.shelf.loading = false;
    state.shelf.error = `내 서재 조회 실패: ${String(error.message || error)}`;
    drawShelfState();
    drawShelfItems();
  }
}

function drawShelfState() {
  const $state = document.getElementById("shelf-state");
  if (!$state) return;

  $state.className = "state";
  if (state.shelf.error) {
    $state.classList.add("error");
    $state.textContent = state.shelf.error;
    return;
  }

  $state.textContent = state.shelf.message;
}

function drawShelfItems() {
  const $list = document.getElementById("shelf-list");
  if (!$list) return;

  if (state.shelf.items.length === 0) {
    $list.innerHTML = "";
    return;
  }

  $list.innerHTML = state.shelf.items
    .map((book) => {
      return `
        <article class="shelf-row" data-bookid="${escapeAttr(book.id)}">
          <img class="shelf-cover" src="${escapeAttr(book.cover || "/placeholder-cover.svg")}" alt="${escapeAttr(book.title)}" />
          <div>
            <p class="book-title">${escapeHtml(book.title)}</p>
            <p class="book-meta">${escapeHtml(book.author || "저자 정보 없음")}</p>
            <p class="book-meta">${escapeHtml(book.publisher || "출판사 정보 없음")} · ${escapeHtml(book.pubYear || "연도 정보 없음")}</p>
            <div class="row-actions">
              <select data-field="status">
                <option value="to-read" ${book.status === "to-read" ? "selected" : ""}>읽을 예정</option>
                <option value="reading" ${book.status === "reading" ? "selected" : ""}>읽는 중</option>
                <option value="done" ${book.status === "done" ? "selected" : ""}>읽음</option>
              </select>
              <input class="memo" data-field="memo" maxlength="200" value="${escapeAttr(book.memo || "")}" placeholder="한 줄 메모" />
              <div class="card-actions">
                <button class="primary" data-action="save">변경 저장</button>
                <button class="ghost" data-action="delete">삭제</button>
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  $list.querySelectorAll(".shelf-row").forEach((row) => {
    const id = row.dataset.bookid;
    const $status = row.querySelector("select[data-field='status']");
    const $memo = row.querySelector("input[data-field='memo']");
    const $save = row.querySelector("button[data-action='save']");
    const $delete = row.querySelector("button[data-action='delete']");

    $save.addEventListener("click", async () => {
      try {
        const res = await fetch(`/api/bookshelf/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: $status.value, memo: $memo.value }),
        });
        const payload = await res.json();
        if (!res.ok) {
          alert(payload.message || "수정 실패");
          return;
        }
        await loadShelf();
      } catch (error) {
        alert(`수정 실패: ${String(error.message || error)}`);
      }
    });

    $delete.addEventListener("click", async () => {
      try {
        const res = await fetch(`/api/bookshelf/${encodeURIComponent(id)}`, { method: "DELETE" });
        const payload = await res.json();
        if (!res.ok) {
          alert(payload.message || "삭제 실패");
          return;
        }
        await loadShelf();
      } catch (error) {
        alert(`삭제 실패: ${String(error.message || error)}`);
      }
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

async function clearLegacyCacheControls() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }

    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch (error) {
    console.log("[rebo] cache cleanup skipped", String(error.message || error));
  }
}
