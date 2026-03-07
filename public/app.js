const STATUS_LABEL = {
  "to-read": "읽을 예정",
  reading: "읽는 중",
  done: "읽음",
};
const LOCAL_SHELF_KEY = "rebo-bookshelf-v1";
let volatileShelfFallback = [];

const VIEW_META = {
  shelf: { title: "책장", subtitle: "추가한 책을 책장처럼 정리해두세요." },
  search: { title: "검색", subtitle: "책 이름 또는 저자명으로 검색하세요." },
  stats: { title: "통계", subtitle: "주간/월간 독서 기록을 확인하세요." },
  my: { title: "MY", subtitle: "계정, 테마, 알림 설정을 관리하세요." },
  detail: { title: "책 상세", subtitle: "읽기 기록과 독후감을 관리하세요." },
};

const state = {
  view: "shelf",
  selectedBook: null,
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
  stats: {
    mode: "weekly",
    cursorDate: new Date(),
  },
  my: {
    theme: localStorage.getItem("rebo-theme") || "light",
  },
};

const $view = document.getElementById("view");
const $modalRoot = document.getElementById("modal-root");
const $toastRoot = document.getElementById("toast-root");
const $title = document.getElementById("view-title");
const $subtitle = document.getElementById("view-subtitle");

applyTheme(state.my.theme);
clearLegacyCacheControls();
bindNav();
setView("shelf");
console.log("[rebo shelf] storage mode", getStorageMode());

function bindNav() {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });
}

function setView(view) {
  state.view = view;
  syncNav(view);

  const meta = VIEW_META[view] || VIEW_META.shelf;
  $title.textContent = meta.title;
  $subtitle.textContent = meta.subtitle;

  if (view === "shelf") renderShelf();
  if (view === "search") renderSearch();
  if (view === "stats") renderStats();
  if (view === "my") renderMy();
  if (view === "detail") renderDetail();
}

function syncNav(view) {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
}

async function renderShelf() {
  await loadShelf();
  console.log("[rebo shelf] render data", state.shelf.items);

  $view.innerHTML = `
    <section class="panel">
      <div class="shelf-grid">
        <button class="add-card" id="add-book-card">
          <div class="add-inner">
            <div class="add-icon">+</div>
            <strong>책 추가</strong>
            <p class="book-meta">검색 화면으로 이동</p>
          </div>
        </button>

        ${state.shelf.items
          .map((book) => {
            return `
              <article class="shelf-book" data-bookid="${escapeAttr(book.id)}">
                <img class="cover" src="${escapeAttr(book.cover || "/placeholder-cover.svg")}" alt="${escapeAttr(book.title)}" />
                <div class="book-content">
                  <p class="book-title">${escapeHtml(book.title)}</p>
                  <p class="book-meta">${escapeHtml(book.author || "저자 정보 없음")}</p>
                  <span class="badge">${escapeHtml(STATUS_LABEL[book.status] || "읽을 예정")}</span>
                </div>
              </article>
            `;
          })
          .join("")}
      </div>
      <p class="book-meta" style="margin-top:12px;">총 ${state.shelf.items.length}권</p>
    </section>
  `;

  document.getElementById("add-book-card").addEventListener("click", () => setView("search"));
  $view.querySelectorAll(".shelf-book").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.dataset.bookid;
      state.selectedBook = state.shelf.items.find((item) => item.id === id) || null;
      setView("detail");
    });
  });
}

function renderSearch() {
  $view.innerHTML = `
    <section class="panel">
      <div class="toolbar">
        <input id="search-input" placeholder="책 제목 또는 저자명 검색" value="${escapeAttr(state.search.query)}" />
        <button class="btn primary" id="search-btn">검색</button>
      </div>
      <div id="search-state" class="state"></div>
      <div id="search-results" class="result-grid"></div>
    </section>
  `;

  const $input = document.getElementById("search-input");
  document.getElementById("search-btn").addEventListener("click", () => runSearchFromInput());
  $input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearchFromInput();
  });

  drawSearchState();
  drawSearchResults();
}

async function runSearchFromInput() {
  const $input = document.getElementById("search-input");
  const query = String($input?.value || "").trim();
  state.search.query = query;

  if (!query) {
    state.search.loading = false;
    state.search.error = "";
    state.search.message = "검색어를 입력해주세요.";
    state.search.items = [];
    state.search.warnings = [];
    drawSearchState();
    drawSearchResults();
    return;
  }

  state.search.loading = true;
  state.search.error = "";
  state.search.message = "로딩 중...";
  state.search.items = [];
  state.search.warnings = [];
  drawSearchState();
  drawSearchResults();

  const result = await searchBooks(query);

  state.search.loading = false;
  state.search.items = result.items;
  state.search.warnings = result.warnings;

  if (result.error) {
    state.search.error = result.error;
    state.search.message = "";
  } else if (result.items.length === 0) {
    state.search.message = "검색 결과가 없습니다.";
  } else {
    state.search.message = `검색 결과 ${result.items.length}건`;
  }

  drawSearchState();
  drawSearchResults();
}

async function searchBooks(query) {
  const url = `/api/books/search?q=${encodeURIComponent(query)}`;
  console.log("[rebo search] request", url);

  try {
    const response = await fetch(url);
    const text = await response.text();
    console.log("[rebo search] status", response.status);

    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      console.log("[rebo search] error body", text);
      const error = data?.message || (response.status >= 500 ? "외부 API 실패" : "요청 오류");
      return {
        items: [],
        warnings: data?.meta?.warnings || [],
        error,
      };
    }

    return {
      items: data?.items || [],
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
    $state.innerHTML = state.search.warnings.map((w) => `<div>${escapeHtml(w)}</div>`).join("");
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
        <article class="result-card">
          <img class="cover" src="${escapeAttr(book.cover || "/placeholder-cover.svg")}" alt="${escapeAttr(book.title)}" />
          <div class="book-content">
            <p class="book-title">${escapeHtml(book.title)}</p>
            <p class="book-meta">${escapeHtml(book.author || "저자 정보 없음")}</p>
            <p class="book-meta">${escapeHtml(book.publisher || "출판사 정보 없음")} · ${escapeHtml(book.pubYear || "연도 정보 없음")}</p>
            <div class="card-actions">
              <button class="btn primary" data-addid="${escapeAttr(book.id)}">책장에 추가</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  $list.querySelectorAll("[data-addid]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const book = state.search.items.find((item) => item.id === btn.dataset.addid);
      if (!book) return;
      await addBookToShelf(book);
    });
  });
}

async function addBookToShelf(book) {
  if (!book) return;
  console.log("[rebo shelf] add button clicked", { id: book.id, title: book.title });
  console.log("[rebo shelf] addBookToShelf entered");

  const payload = {
    id: book.id,
    title: book.title || "",
    author: book.author || "",
    publisher: book.publisher || "",
    pubYear: book.pubYear || "",
    isbn13: book.isbn13 || "",
    isbn: book.isbn || "",
    cover: book.cover || "/placeholder-cover.svg",
    status: "to-read",
    memo: "",
    source: book.source || { aladin: true, nl: false },
  };

  try {
    const current = readShelfStorage();
    const duplicate = findDuplicateBook(current, payload);

    if (duplicate) {
      console.log("[rebo shelf] duplicate prevented", { id: duplicate.id, title: duplicate.title });
      toast("이미 책장에 추가된 책입니다");
      return;
    }

    const next = [normalizeShelfItem(payload), ...current];
    writeShelfStorage(next);
    console.log("[rebo shelf] save success", { count: next.length });

    await loadShelf();
    console.log("[rebo shelf] bookshelf after save", state.shelf.items);
    toast(`책장에 ${book.title}이 추가되었습니다`);
  } catch (error) {
    console.log("[rebo shelf] add failed", String(error.message || error));
    state.search.error = `책장 저장 실패: ${String(error.message || error)}`;
    state.search.message = "";
    drawSearchState();
  }
}
function renderDetail() {
  const book = state.selectedBook;
  if (!book) return setView("shelf");

  const readStatus = deriveStatus(book.startDate, book.endDate, book.status);

  $view.innerHTML = `
    <section class="panel">
      <div class="detail-head">
        <img class="cover" src="${escapeAttr(book.cover || "/placeholder-cover.svg")}" alt="${escapeAttr(book.title)}" />
        <div>
          <p class="book-title">${escapeHtml(book.title)}</p>
          <p class="book-meta">${escapeHtml(book.author || "저자 정보 없음")}</p>
          <p class="book-meta">현재 상태: <strong>${escapeHtml(STATUS_LABEL[readStatus])}</strong></p>
        </div>
        <div class="mini-menu">
          <button class="icon-btn" id="meatball-btn">⋮</button>
          <div class="menu-pop" id="detail-menu" style="display:none;">
            <button id="menu-delete">휴지통</button>
            <button id="menu-reminder">알림 설정</button>
          </div>
        </div>
      </div>

      <h3>독서 기록</h3>
      <div class="field-grid">
        <label>읽기 시작일<input type="date" id="start-date" value="${escapeAttr(book.startDate || "")}" /></label>
        <label>완독일<input type="date" id="end-date" value="${escapeAttr(book.endDate || "")}" /></label>
      </div>

      <h3>독후감</h3>
      <textarea id="review-text" maxlength="2000" placeholder="1자~2000자 입력">${escapeHtml(book.review || "")}</textarea>
      <div class="card-actions">
        <span class="badge" id="review-count">${String(book.review || "").length}/2000</span>
        <button class="btn primary" id="save-detail" ${String(book.review || "").trim().length < 1 ? "disabled" : ""}>저장</button>
      </div>
    </section>
  `;

  const $menu = document.getElementById("detail-menu");
  document.getElementById("meatball-btn").addEventListener("click", () => {
    $menu.style.display = $menu.style.display === "none" ? "block" : "none";
  });

  document.getElementById("menu-delete").addEventListener("click", () => openDeleteModal(book));
  document.getElementById("menu-reminder").addEventListener("click", () => openReminderModal(book));

  const $text = document.getElementById("review-text");
  const $count = document.getElementById("review-count");
  const $save = document.getElementById("save-detail");

  $text.addEventListener("input", () => {
    const len = $text.value.length;
    $count.textContent = `${len}/2000`;
    $save.disabled = $text.value.trim().length < 1;
  });

  $save.addEventListener("click", async () => {
    await patchBook(book.id, {
      startDate: document.getElementById("start-date").value || "",
      endDate: document.getElementById("end-date").value || "",
      review: $text.value,
      status: deriveStatus(
        document.getElementById("start-date").value,
        document.getElementById("end-date").value,
        book.status,
      ),
    });
    toast("저장되었습니다.");
    await loadShelf();
    state.selectedBook = state.shelf.items.find((x) => x.id === book.id) || null;
    renderDetail();
  });
}

function openDeleteModal(book) {
  modal(`
    <h3>삭제하시겠습니까?</h3>
    <p class="book-meta">${escapeHtml(book.title)}</p>
    <div class="modal-actions">
      <button class="btn" id="modal-cancel">취소</button>
      <button class="btn primary" id="modal-ok">확인</button>
    </div>
  `);

  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("modal-ok").addEventListener("click", async () => {
    removeBookFromShelf(book.id);
    await loadShelf();
    closeModal();
    toast("삭제되었습니다.");
    setView("shelf");
  });
}

function openReminderModal(book) {
  const selectedDays = Array.isArray(book.reminder?.days) ? book.reminder.days : [];
  const time = book.reminder?.time || "20:00";

  modal(`
    <h3>${escapeHtml(book.title)} 읽기 알림 설정</h3>
    <div class="field-grid">
      <label>요일
        <select id="reminder-days" multiple size="7">
          ${["월", "화", "수", "목", "금", "토", "일"]
            .map((d) => `<option value="${d}" ${selectedDays.includes(d) ? "selected" : ""}>${d}</option>`)
            .join("")}
        </select>
      </label>
      <label>시간<input id="reminder-time" type="time" value="${escapeAttr(time)}" /></label>
    </div>
    <div class="modal-actions">
      <button class="btn" id="modal-cancel">취소</button>
      <button class="btn primary" id="modal-save">저장</button>
    </div>
  `);

  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("modal-save").addEventListener("click", async () => {
    const days = Array.from(document.getElementById("reminder-days").selectedOptions).map((o) => o.value);
    const reminderTime = document.getElementById("reminder-time").value || "20:00";

    await patchBook(book.id, { reminder: { days, time: reminderTime } });
    closeModal();
    toast("알림이 설정되었습니다.");
    await loadShelf();
    state.selectedBook = state.shelf.items.find((x) => x.id === book.id) || null;
    renderDetail();
  });
}

function renderStats() {
  const isWeekly = state.stats.mode === "weekly";
  const label = isWeekly ? formatWeekLabel(state.stats.cursorDate) : formatMonthLabel(state.stats.cursorDate);
  const counts = buildStats();

  $view.innerHTML = `
    <section class="panel">
      <div class="stats-head">
        <div class="toggle">
          <button id="toggle-week" class="${isWeekly ? "active" : ""}">주간</button>
          <button id="toggle-month" class="${isWeekly ? "" : "active"}">월간</button>
        </div>
        <div class="card-actions">
          <button class="btn" id="stats-prev">◀</button>
          <span class="badge">${escapeHtml(label)}</span>
          <button class="btn" id="stats-next">▶</button>
        </div>
      </div>

      <div class="row">
        <div class="panel">
          <p class="book-meta">읽을 예정</p>
          <p class="book-title">${counts.toRead}권</p>
        </div>
        <div class="panel">
          <p class="book-meta">읽는 중</p>
          <p class="book-title">${counts.reading}권</p>
        </div>
      </div>

      <div class="panel" style="margin-top:10px;">
        <p class="book-meta">완독</p>
        <p class="book-title">${counts.done}권</p>
      </div>
    </section>
  `;

  document.getElementById("toggle-week").addEventListener("click", () => {
    state.stats.mode = "weekly";
    renderStats();
  });
  document.getElementById("toggle-month").addEventListener("click", () => {
    state.stats.mode = "monthly";
    renderStats();
  });

  document.getElementById("stats-prev").addEventListener("click", () => {
    shiftStatsCursor(-1);
    renderStats();
  });

  document.getElementById("stats-next").addEventListener("click", () => {
    shiftStatsCursor(1);
    renderStats();
  });
}

function renderMy() {
  const reminders = state.shelf.items
    .filter((book) => Array.isArray(book.reminder?.days) && book.reminder.days.length > 0)
    .map((book) => ({
      title: book.title,
      days: book.reminder.days.join(", "),
      time: book.reminder.time || "20:00",
    }));

  $view.innerHTML = `
    <section class="panel">
      <div class="my-menu">
        <div class="my-item">
          <strong>로그인</strong>
          <p class="book-meta">로그인 시 책 기록 연동을 할 수 있습니다.</p>
          <button class="btn">로그인</button>
        </div>

        <div class="my-item"><strong>이용약관</strong></div>
        <div class="my-item"><strong>개인정보 처리방침</strong></div>

        <div class="my-item">
          <strong>테마 설정</strong>
          <div class="switch" style="margin-top:8px;">
            <button class="btn ${state.my.theme === "light" ? "primary" : ""}" id="theme-light">라이트</button>
            <button class="btn ${state.my.theme === "dark" ? "primary" : ""}" id="theme-dark">다크</button>
          </div>
        </div>

        <div class="my-item">
          <strong>알림 관리</strong>
          <div style="margin-top:8px; display:grid; gap:6px;">
            ${reminders.length > 0
              ? reminders
                  .map(
                    (r) => `<div class="badge" style="display:block; border-radius:10px;">${escapeHtml(r.title)} · ${escapeHtml(r.days)} ${escapeHtml(r.time)}</div>`,
                  )
                  .join("")
              : '<p class="book-meta">설정된 알림이 없습니다.</p>'}
          </div>
        </div>
      </div>
    </section>
  `;

  document.getElementById("theme-light").addEventListener("click", () => {
    applyTheme("light");
    renderMy();
  });

  document.getElementById("theme-dark").addEventListener("click", () => {
    applyTheme("dark");
    renderMy();
  });
}

async function loadShelf() {
  state.shelf.loading = true;
  try {
    state.shelf.items = readShelfStorage();
    state.shelf.message = getStorageMessage();
    state.shelf.error = "";
    console.log("[rebo shelf] load success", { count: state.shelf.items.length, mode: getStorageMode() });
  } catch (error) {
    state.shelf.error = `내 서재 조회 실패: ${String(error.message || error)}`;
    state.shelf.items = [];
  } finally {
    state.shelf.loading = false;
  }
}

async function patchBook(id, patch) {
  const items = readShelfStorage();
  const index = items.findIndex((book) => book.id === id);
  if (index < 0) {
    throw new Error("저장할 책을 찾을 수 없습니다.");
  }

  items[index] = normalizeShelfItem({
    ...items[index],
    ...patch,
    status: patch.status || items[index].status,
  });

  writeShelfStorage(items);
  console.log("[rebo shelf] patch success", { id, patch });
}

function deriveStatus(startDate, endDate, current = "to-read") {
  if (endDate) return "done";
  if (startDate) return "reading";
  return current || "to-read";
}

function buildStats() {
  const counts = { toRead: 0, reading: 0, done: 0 };
  state.shelf.items.forEach((book) => {
    const s = deriveStatus(book.startDate, book.endDate, book.status);
    if (s === "to-read") counts.toRead += 1;
    if (s === "reading") counts.reading += 1;
    if (s === "done") counts.done += 1;
  });
  return counts;
}

function shiftStatsCursor(step) {
  const d = new Date(state.stats.cursorDate);
  if (state.stats.mode === "weekly") d.setDate(d.getDate() + step * 7);
  else d.setMonth(d.getMonth() + step);
  state.stats.cursorDate = d;
}

function formatWeekLabel(date) {
  const d = new Date(date);
  const year = String(d.getFullYear()).slice(2);
  const week = getWeekNumber(d);
  const start = new Date(d);
  start.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${year}년 ${week}주차 (${start.getMonth() + 1}월 ${start.getDate()}일~${end.getMonth() + 1}월 ${end.getDate()}일)`;
}

function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function formatMonthLabel(date) {
  const d = new Date(date);
  return `${d.getMonth() + 1}월`;
}

function applyTheme(theme) {
  state.my.theme = theme;
  localStorage.setItem("rebo-theme", theme);
  document.body.setAttribute("data-theme", theme);
}

function modal(inner) {
  $modalRoot.innerHTML = `<div class="modal"><div class="modal-card">${inner}</div></div>`;
  $modalRoot.querySelector(".modal").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal")) closeModal();
  });
}

function closeModal() {
  $modalRoot.innerHTML = "";
}

function toast(message) {
  $toastRoot.innerHTML = `<div class="toast">${escapeHtml(message)}</div>`;
  setTimeout(() => {
    $toastRoot.innerHTML = "";
  }, 1800);
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





function getStorageMode() {
  try {
    const testKey = "__rebo_storage_test__";
    localStorage.setItem(testKey, "1");
    localStorage.removeItem(testKey);
    return "localStorage";
  } catch {
    return "memory";
  }
}

function getStorageMessage() {
  if (getStorageMode() === "memory") {
    return "현재 브라우저 저장소를 사용할 수 없어 임시 메모리 저장 모드로 동작합니다.";
  }
  return "";
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizeShelfItem(input) {
  const book = input || {};
  return {
    id: String(book.id || "").trim() || createClientBookId(book),
    title: String(book.title || "").trim(),
    author: String(book.author || "").trim(),
    publisher: String(book.publisher || "").trim(),
    pubYear: String(book.pubYear || "").trim(),
    isbn13: String(book.isbn13 || "").trim(),
    isbn: String(book.isbn || "").trim(),
    cover: String(book.cover || "/placeholder-cover.svg").trim() || "/placeholder-cover.svg",
    status: ["to-read", "reading", "done"].includes(book.status) ? book.status : "to-read",
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
}

function readShelfStorage() {
  if (getStorageMode() === "memory") {
    return volatileShelfFallback.map(normalizeShelfItem);
  }

  try {
    const raw = localStorage.getItem(LOCAL_SHELF_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return items.map(normalizeShelfItem);
  } catch {
    return [];
  }
}

function writeShelfStorage(items) {
  const normalizedItems = Array.isArray(items) ? items.map(normalizeShelfItem) : [];

  if (getStorageMode() === "memory") {
    volatileShelfFallback = normalizedItems;
    return;
  }

  localStorage.setItem(LOCAL_SHELF_KEY, JSON.stringify({ items: normalizedItems }));
}

function removeBookFromShelf(bookId) {
  const items = readShelfStorage();
  const next = items.filter((book) => book.id !== bookId);
  writeShelfStorage(next);
  console.log("[rebo shelf] remove success", { id: bookId, count: next.length });
}

function findDuplicateBook(items, candidate) {
  const books = Array.isArray(items) ? items : [];
  const isbn13 = String(candidate?.isbn13 || "").trim();
  const isbn = String(candidate?.isbn || "").trim();
  const id = String(candidate?.id || "").trim();
  const titleAuthorKey = `${normalizeText(candidate?.title)}|${normalizeText(candidate?.author)}`;

  return books.find((book) => {
    if (id && book.id === id) return true;
    if (isbn13 && book.isbn13 && book.isbn13 === isbn13) return true;
    if (isbn && book.isbn && book.isbn === isbn) return true;
    const key = `${normalizeText(book.title)}|${normalizeText(book.author)}`;
    return key.length > 1 && key === titleAuthorKey;
  });
}

function createClientBookId(book) {
  const base = `${normalizeText(book?.title)}-${normalizeText(book?.author)}-${normalizeText(book?.isbn13 || book?.isbn)}`;
  return base || `book-${Date.now()}`;
}





