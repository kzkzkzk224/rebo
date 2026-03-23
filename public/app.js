const STATUS_LABEL = {
  "to-read": "읽을 예정",
  reading: "읽는 중",
  done: "완독",
};

const LOCAL_SHELF_KEY = "rebo-bookshelf-v2";
const LOCAL_THEME_KEY = "rebo-theme";
const CALENDAR_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
let volatileShelfFallback = [];

const VIEW_META = {
  shelf: { title: "책장", subtitle: "추가한 책을 부드럽게 쌓아두는 개인 서가예요." },
  search: { title: "검색", subtitle: "책 제목이나 저자명으로 책을 찾아 바로 추가할 수 있어요." },
  stats: { title: "통계", subtitle: "읽기 상태와 흐름을 한눈에 확인해보세요." },
  my: { title: "MY", subtitle: "테마와 알림, 계정 관련 설정을 정리해두었어요." },
  detail: { title: "책장 > 상세", subtitle: "저장한 책의 상태와 기록을 업데이트할 수 있어요." },
  manual: { title: "책장 > 직접 추가", subtitle: "책 표지와 기본 정보를 입력해 책장에 직접 추가해보세요." },
};

const state = {
  view: "shelf",
  selectedBookId: null,
  sheet: null,
  modal: null,
  toastTimer: null,
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
    error: "",
    message: "",
  },
  stats: {
    mode: "weekly",
  },
  my: {
    theme: getInitialTheme(),
  },
  manualForm: createManualForm(),
};

const $view = document.getElementById("view");
const $sheetRoot = document.getElementById("sheet-root");
const $modalRoot = document.getElementById("modal-root");
const $toastRoot = document.getElementById("toast-root");
const $title = document.getElementById("view-title");
const $subtitle = document.getElementById("view-subtitle");
const $themeToggle = document.getElementById("theme-toggle");
const $coverFileInput = document.getElementById("cover-file-input");

init();

function init() {
  applyTheme(state.my.theme, false);
  bindThemeEvents();
  bindNav();
  bindFileInput();
  clearLegacyCacheControls();
  console.log("[rebo shelf] storage mode", getStorageMode());
  setView("shelf");
}

function bindThemeEvents() {
  $themeToggle.addEventListener("click", () => {
    const nextTheme = state.my.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme, true);
    if (state.view === "my") {
      renderMy();
    }
  });

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", (event) => {
      if (localStorage.getItem(LOCAL_THEME_KEY)) return;
      applyTheme(event.matches ? "dark" : "light", false);
      if (state.view === "my") {
        renderMy();
      }
    });
  }
}

function bindNav() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      closeSheet();
      closeModal();
      setView(button.dataset.view);
    });
  });
}

function bindFileInput() {
  $coverFileInput.addEventListener("change", () => {
    const [file] = Array.from($coverFileInput.files || []);
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      state.manualForm.cover = typeof reader.result === "string" ? reader.result : "";
      renderManualAdd();
    };
    reader.readAsDataURL(file);
  });
}

async function setView(view) {
  state.view = view;
  syncNav(view);
  syncHeader(view);

  if (view === "shelf") {
    await renderShelf();
    return;
  }
  if (view === "search") {
    renderSearch();
    return;
  }
  if (view === "stats") {
    await loadShelf();
    renderStats();
    return;
  }
  if (view === "my") {
    await loadShelf();
    renderMy();
    return;
  }
  if (view === "detail") {
    await loadShelf();
    renderDetail();
    return;
  }
  if (view === "manual") {
    renderManualAdd();
  }
}

function syncNav(view) {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
}

function syncHeader(view) {
  const meta = VIEW_META[view] || VIEW_META.shelf;
  $title.textContent = meta.title;
  $subtitle.textContent = meta.subtitle;
}

async function renderShelf() {
  await loadShelf();
  console.log("[rebo shelf] render data", state.shelf.items);

  $view.innerHTML = `
    <section class="panel shelf-panel">
      <div class="section-head">
        <div>
          <h2 class="section-title">나의 책장</h2>
          <p class="section-caption">책을 직접 추가하거나 검색 결과에서 바로 담아보세요.</p>
        </div>
        <div class="count-pill">총 ${state.shelf.items.length}권</div>
      </div>
      ${state.shelf.message ? `<div class="state warn">${escapeHtml(state.shelf.message)}</div>` : ""}
      ${state.shelf.error ? `<div class="state error">${escapeHtml(state.shelf.error)}</div>` : ""}
      <div class="shelf-grid">
        <button class="add-card" id="open-add-flow" type="button">
          <div class="add-card-icon">+</div>
          <p class="add-card-title">책장에 책을 추가하세요</p>
          <p class="add-card-copy">검색으로 찾거나 직접 입력해서 책장을 채울 수 있어요.</p>
        </button>
        ${state.shelf.items
          .map(
            (book) => `
              <button class="shelf-book" data-bookid="${escapeAttr(book.id)}" type="button">
                <div class="book-cover-shell">
                  <img class="cover" src="${escapeAttr(book.cover || "/placeholder-cover.svg")}" alt="${escapeAttr(book.title)}" />
                </div>
                <div class="card-body">
                  <p class="book-title">${escapeHtml(book.title)}</p>
                  <p class="book-meta">${escapeHtml(book.author || "저자 정보 없음")}</p>
                  <span class="status-chip">${escapeHtml(STATUS_LABEL[book.status] || "읽을 예정")}</span>
                </div>
              </button>
            `,
          )
          .join("")}
      </div>
    </section>
  `;

  document.getElementById("open-add-flow").addEventListener("click", openAddSheet);
  $view.querySelectorAll("[data-bookid]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedBookId = button.dataset.bookid;
      setView("detail");
    });
  });
}

function openAddSheet() {
  state.sheet = "add";
  $sheetRoot.innerHTML = `
    <div class="sheet-backdrop" id="sheet-backdrop">
      <section class="sheet" role="dialog" aria-modal="true" aria-label="책 추가">
        <div class="sheet-handle"></div>
        <h2 class="sheet-title">책 추가</h2>
        <p class="sheet-copy">검색 결과를 담거나 직접 입력해서 책장에 추가할 수 있어요.</p>
        <div class="sheet-actions">
          <button class="sheet-option" id="sheet-search" type="button">검색으로 추가</button>
          <button class="sheet-option" id="sheet-manual" type="button">직접 추가</button>
        </div>
      </section>
    </div>
  `;

  document.getElementById("sheet-backdrop").addEventListener("click", (event) => {
    if (event.target.id === "sheet-backdrop") {
      closeSheet();
    }
  });
  document.getElementById("sheet-search").addEventListener("click", () => {
    closeSheet();
    setView("search");
  });
  document.getElementById("sheet-manual").addEventListener("click", () => {
    closeSheet();
    state.manualForm = createManualForm();
    setView("manual");
  });
}

function closeSheet() {
  state.sheet = null;
  $sheetRoot.innerHTML = "";
}

function renderSearch() {
  $view.innerHTML = `
    <section class="panel search-panel">
      <div class="section-head">
        <div>
          <h2 class="section-title">책 검색</h2>
          <p class="section-caption">책 제목이나 저자명으로 찾은 뒤 바로 책장에 담을 수 있어요.</p>
        </div>
      </div>
      <div class="toolbar">
        <input
          id="search-input"
          class="search-field"
          type="text"
          placeholder="책 제목 또는 저자명을 입력하세요."
          value="${escapeAttr(state.search.query)}"
        />
        <button id="search-button" class="btn primary" type="button">검색</button>
      </div>
      <div id="search-state"></div>
      <div id="search-results" class="result-grid"></div>
    </section>
  `;

  const $input = document.getElementById("search-input");
  document.getElementById("search-button").addEventListener("click", runSearchFromInput);
  $input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      runSearchFromInput();
    }
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
  state.search.error = result.error;
  state.search.message = result.error ? "" : result.items.length > 0 ? `검색 결과 ${result.items.length}건` : "검색 결과가 없습니다.";

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
    } catch (_error) {
      data = null;
    }

    if (!response.ok) {
      console.log("[rebo search] error body", text);
      return {
        items: [],
        warnings: data?.meta?.warnings || [],
        error: data?.message || (response.status >= 500 ? "외부 API 실패" : "검색 요청 오류"),
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

  if (state.search.loading) {
    $state.innerHTML = `<div class="state">로딩 중...</div>`;
    return;
  }

  if (state.search.error) {
    $state.innerHTML = `
      <div class="state error">
        <strong>${escapeHtml(state.search.error)}</strong>
        ${state.search.warnings.map((warning) => `<div>${escapeHtml(warning)}</div>`).join("")}
      </div>
    `;
    return;
  }

  if (state.search.warnings.length > 0) {
    $state.innerHTML = `
      <div class="state warn">
        ${state.search.warnings.map((warning) => `<div>${escapeHtml(warning)}</div>`).join("")}
      </div>
    `;
    return;
  }

  $state.innerHTML = state.search.message ? `<div class="state">${escapeHtml(state.search.message)}</div>` : "";
}

function drawSearchResults() {
  const $list = document.getElementById("search-results");
  if (!$list) return;

  if (state.search.loading || state.search.error || state.search.items.length === 0) {
    $list.innerHTML = "";
    return;
  }

  $list.innerHTML = state.search.items
    .map(
      (book) => `
        <article class="result-card">
          <div class="book-cover-shell">
            <img class="cover" src="${escapeAttr(book.cover || "/placeholder-cover.svg")}" alt="${escapeAttr(book.title)}" />
          </div>
          <div class="card-body">
            <p class="book-title">${escapeHtml(book.title)}</p>
            <p class="book-meta">${escapeHtml(book.author || "저자 정보 없음")}</p>
            <p class="book-meta">${escapeHtml(book.publisher || "출판사 정보 없음")} · ${escapeHtml(book.pubYear || "연도 정보 없음")}</p>
            <div class="result-actions">
              <button class="btn primary full" data-addid="${escapeAttr(book.id)}" type="button">책장에 추가</button>
            </div>
          </div>
        </article>
      `,
    )
    .join("");

  $list.querySelectorAll("[data-addid]").forEach((button) => {
    button.addEventListener("click", async () => {
      const book = state.search.items.find((item) => item.id === button.dataset.addid);
      if (!book) return;
      await addBookToShelf(book);
    });
  });
}

async function addBookToShelf(book) {
  if (!book) return;
  console.log("[rebo shelf] add button clicked", { id: book.id, title: book.title });
  console.log("[rebo shelf] addBookToShelf entered");

  const payload = normalizeShelfItem({
    ...book,
    status: book.status || "to-read",
    memo: book.memo || "",
    review: book.review || "",
    startDate: book.startDate || "",
    endDate: book.endDate || "",
  });

  try {
    const current = readShelfStorage();
    const duplicate = findDuplicateBook(current, payload);
    if (duplicate) {
      console.log("[rebo shelf] duplicate prevented", { id: duplicate.id, title: duplicate.title });
      toast("이미 책장에 추가된 책입니다.");
      return;
    }

    const next = [payload, ...current];
    writeShelfStorage(next);
    console.log("[rebo shelf] save success", { count: next.length });
    await loadShelf();
    console.log("[rebo shelf] bookshelf after save", state.shelf.items);
    toast(`'${book.title}'이 책장에 추가되었습니다.`);
  } catch (error) {
    console.log("[rebo shelf] add failed", String(error.message || error));
    state.search.error = `책장 저장 실패: ${String(error.message || error)}`;
    drawSearchState();
  }
}

function renderManualAdd() {
  const form = state.manualForm;
  const isSubmitEnabled = form.title.trim().length > 0 && form.author.trim().length > 0;
  const shouldShowCalendar = form.status === "reading" || form.status === "done";
  const activeDateField = form.status === "done" ? form.activeDateField : "startDate";

  $view.innerHTML = `
    <section class="panel manual-panel">
      <div class="manual-layout">
        <div class="manual-cover">
          <button class="camera-tile" id="manual-cover-button" type="button">
            ${
              form.cover
                ? `<img src="${escapeAttr(form.cover)}" alt="선택한 책 표지" />`
                : `
                  <div class="camera-tile-empty">
                    <div>
                      <div class="camera-tile-icon">⌁</div>
                      <p class="helper-text">책 형태를 눌러 사진을 추가하세요.</p>
                    </div>
                  </div>
                `
            }
          </button>
        </div>

        <div class="form-stack">
          <label class="date-field">
            <span class="field-label">책 제목</span>
            <input id="manual-title" class="text-field" type="text" placeholder="책 제목을 입력하세요." value="${escapeAttr(form.title)}" />
          </label>

          <label class="date-field">
            <span class="field-label">저자</span>
            <input id="manual-author" class="text-field" type="text" placeholder="저자를 입력하세요." value="${escapeAttr(form.author)}" />
          </label>

          <div class="date-field">
            <span class="field-label">책 현황</span>
            <div class="status-row">
              ${renderStatusButton("to-read", "읽을 예정", form.status)}
              ${renderStatusButton("reading", "읽는 중", form.status)}
              ${renderStatusButton("done", "완독", form.status)}
            </div>
          </div>

          ${
            shouldShowCalendar
              ? `
                <div class="date-grid ${form.status === "done" ? "two" : ""}">
                  <div class="date-field">
                    <span class="field-label">읽기 시작한 날</span>
                    <button class="date-pill ${activeDateField === "startDate" ? "active" : ""}" id="date-start" type="button">
                      ${formatDateForDisplay(form.startDate) || "날짜를 선택하세요."}
                    </button>
                  </div>
                  ${
                    form.status === "done"
                      ? `
                        <div class="date-field">
                          <span class="field-label">완독한 날</span>
                          <button class="date-pill ${activeDateField === "endDate" ? "active" : ""}" id="date-end" type="button">
                            ${formatDateForDisplay(form.endDate) || "날짜를 선택하세요."}
                          </button>
                        </div>
                      `
                      : ""
                  }
                </div>
                ${renderCalendar(form.calendarMonth, form, activeDateField)}
              `
              : ""
          }

          <button id="manual-submit" class="btn primary full" type="button" ${isSubmitEnabled ? "" : "disabled"}>추가</button>
        </div>
      </div>
    </section>
  `;

  document.getElementById("manual-cover-button").addEventListener("click", openPhotoPermissionModal);
  document.getElementById("manual-title").addEventListener("input", (event) => {
    state.manualForm.title = event.target.value;
    renderManualAdd();
  });
  document.getElementById("manual-author").addEventListener("input", (event) => {
    state.manualForm.author = event.target.value;
    renderManualAdd();
  });
  document.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", () => {
      updateManualStatus(button.dataset.status);
    });
  });

  if (shouldShowCalendar) {
    document.getElementById("calendar-prev").addEventListener("click", () => shiftManualCalendar(-1));
    document.getElementById("calendar-next").addEventListener("click", () => shiftManualCalendar(1));
    document.querySelectorAll("[data-calendar-date]").forEach((button) => {
      button.addEventListener("click", () => {
        applyManualDate(button.dataset.calendarDate);
      });
    });
    document.getElementById("date-start").addEventListener("click", () => {
      state.manualForm.activeDateField = "startDate";
      renderManualAdd();
    });
    if (form.status === "done") {
      document.getElementById("date-end").addEventListener("click", () => {
        state.manualForm.activeDateField = "endDate";
        renderManualAdd();
      });
    }
  }

  document.getElementById("manual-submit").addEventListener("click", submitManualBook);
}

function renderStatusButton(status, label, currentStatus) {
  return `<button class="status-button ${status === currentStatus ? "active" : ""}" data-status="${status}" type="button">${label}</button>`;
}

function renderCalendar(monthDate, form, activeField) {
  const month = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const firstWeekday = month.getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [];

  for (let index = 0; index < firstWeekday; index += 1) {
    cells.push(`<div class="calendar-cell muted"></div>`);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = toDateInputValue(new Date(month.getFullYear(), month.getMonth(), day));
    const isActive = form[activeField] === iso;
    const isRange =
      form.status === "done" &&
      form.startDate &&
      form.endDate &&
      iso > form.startDate &&
      iso < form.endDate;

    cells.push(`
      <button
        class="calendar-cell ${isActive ? "active" : ""} ${isRange ? "range" : ""}"
        type="button"
        data-calendar-date="${iso}"
      >
        ${day}
      </button>
    `);
  }

  return `
    <section class="calendar">
      <div class="calendar-header">
        <button id="calendar-prev" class="calendar-nav" type="button" aria-label="이전 달">‹</button>
        <div class="calendar-title">${month.getFullYear()}년 ${month.getMonth() + 1}월</div>
        <button id="calendar-next" class="calendar-nav" type="button" aria-label="다음 달">›</button>
      </div>
      <div class="calendar-weekdays">
        ${CALENDAR_WEEKDAYS.map((day) => `<div class="calendar-day">${day}</div>`).join("")}
      </div>
      <div class="calendar-grid">
        ${cells.join("")}
      </div>
    </section>
  `;
}

function updateManualStatus(status) {
  state.manualForm.status = status;
  if (status === "to-read") {
    state.manualForm.startDate = "";
    state.manualForm.endDate = "";
    state.manualForm.activeDateField = "startDate";
  }
  if (status === "reading") {
    state.manualForm.endDate = "";
    state.manualForm.activeDateField = "startDate";
  }
  if (status === "done") {
    state.manualForm.activeDateField = state.manualForm.endDate ? "endDate" : "startDate";
  }
  renderManualAdd();
}

function shiftManualCalendar(step) {
  const current = state.manualForm.calendarMonth;
  state.manualForm.calendarMonth = new Date(current.getFullYear(), current.getMonth() + step, 1);
  renderManualAdd();
}

function applyManualDate(isoDate) {
  const activeField = state.manualForm.status === "done" ? state.manualForm.activeDateField : "startDate";
  state.manualForm[activeField] = isoDate;

  if (state.manualForm.status === "reading") {
    state.manualForm.endDate = "";
  }
  if (state.manualForm.status === "done" && activeField === "startDate") {
    if (state.manualForm.endDate && state.manualForm.endDate < isoDate) {
      state.manualForm.endDate = "";
    }
    state.manualForm.activeDateField = "endDate";
  }
  if (state.manualForm.status === "done" && activeField === "endDate" && state.manualForm.startDate && isoDate < state.manualForm.startDate) {
    state.manualForm.startDate = isoDate;
  }

  renderManualAdd();
}

function openPhotoPermissionModal() {
  state.modal = "photo-permission";
  $modalRoot.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <section class="modal-card" role="dialog" aria-modal="true" aria-label="사진 접근 허용">
        <h3>사진 촬영과 앨범 접근</h3>
        <p>책 표지를 추가하려면 카메라 촬영 또는 앨범 접근 권한이 필요해요. 허용을 누르면 사진 선택 화면으로 이동합니다.</p>
        <div class="modal-actions">
          <button class="btn ghost" id="modal-close" type="button">닫기</button>
          <button class="btn primary" id="modal-allow" type="button">허용</button>
        </div>
      </section>
    </div>
  `;

  document.getElementById("modal-backdrop").addEventListener("click", (event) => {
    if (event.target.id === "modal-backdrop") {
      closeModal();
    }
  });
  document.getElementById("modal-close").addEventListener("click", () => {
    closeModal();
  });
  document.getElementById("modal-allow").addEventListener("click", () => {
    closeModal();
    $coverFileInput.click();
  });
}

function closeModal() {
  state.modal = null;
  $modalRoot.innerHTML = "";
}

async function submitManualBook() {
  const form = state.manualForm;
  if (!form.title.trim() || !form.author.trim()) return;

  const book = normalizeShelfItem({
    id: createClientBookId(form),
    title: form.title,
    author: form.author,
    cover: form.cover || "/placeholder-cover.svg",
    status: form.status,
    startDate: form.status === "to-read" ? "" : form.startDate,
    endDate: form.status === "done" ? form.endDate : "",
    source: { aladin: false, nl: false },
  });

  const current = readShelfStorage();
  const duplicate = findDuplicateBook(current, book);
  if (duplicate) {
    toast("이미 책장에 추가된 책입니다.");
    return;
  }

  writeShelfStorage([book, ...current]);
  await loadShelf();
  state.manualForm = createManualForm();
  toast(`'${book.title}'이 책장에 추가되었습니다.`);
  setView("shelf");
}

function renderDetail() {
  const book = state.shelf.items.find((item) => item.id === state.selectedBookId);
  if (!book) {
    setView("shelf");
    return;
  }

  $view.innerHTML = `
    <section class="panel detail-panel">
      <div class="detail-layout">
        <aside class="detail-book">
          <img class="cover" src="${escapeAttr(book.cover || "/placeholder-cover.svg")}" alt="${escapeAttr(book.title)}" />
          <div class="card-body">
            <p class="book-title">${escapeHtml(book.title)}</p>
            <p class="book-meta">${escapeHtml(book.author || "저자 정보 없음")}</p>
            <span class="status-chip">${escapeHtml(STATUS_LABEL[book.status] || "읽을 예정")}</span>
            <div class="detail-actions">
              <button class="btn ghost" id="detail-delete" type="button">삭제</button>
            </div>
          </div>
        </aside>

        <div class="detail-stack">
          <section class="section-card">
            <h3>읽기 상태</h3>
            <div class="status-row">
              ${renderStatusButton("to-read", "읽을 예정", book.status)}
              ${renderStatusButton("reading", "읽는 중", book.status)}
              ${renderStatusButton("done", "완독", book.status)}
            </div>
            <div class="date-grid ${book.status === "done" ? "two" : ""}">
              ${
                book.status !== "to-read"
                  ? `
                    <div class="date-field">
                      <span class="field-label">읽기 시작한 날</span>
                      <div class="date-display">${escapeHtml(formatDateForDisplay(book.startDate) || "아직 선택하지 않았어요.")}</div>
                    </div>
                  `
                  : ""
              }
              ${
                book.status === "done"
                  ? `
                    <div class="date-field">
                      <span class="field-label">완독한 날</span>
                      <div class="date-display">${escapeHtml(formatDateForDisplay(book.endDate) || "아직 선택하지 않았어요.")}</div>
                    </div>
                  `
                  : ""
              }
            </div>
          </section>

          <section class="section-card">
            <h3>한 줄 메모</h3>
            <textarea id="detail-review" rows="6" maxlength="2000" placeholder="독후감을 남겨보세요.">${escapeHtml(book.review || "")}</textarea>
            <div class="inline-actions">
              <button class="btn primary" id="detail-save" type="button">저장</button>
            </div>
          </section>
        </div>
      </div>
    </section>
  `;

  document.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      const nextStatus = button.dataset.status;
      const patch = {
        status: nextStatus,
        startDate: nextStatus === "to-read" ? "" : book.startDate || toDateInputValue(new Date()),
        endDate: nextStatus === "done" ? book.endDate || toDateInputValue(new Date()) : "",
      };
      await patchBook(book.id, patch);
      await loadShelf();
      renderDetail();
    });
  });
  document.getElementById("detail-save").addEventListener("click", async () => {
    await patchBook(book.id, { review: document.getElementById("detail-review").value });
    await loadShelf();
    toast("저장되었습니다.");
    renderDetail();
  });
  document.getElementById("detail-delete").addEventListener("click", async () => {
    removeBookFromShelf(book.id);
    await loadShelf();
    toast("삭제되었습니다.");
    setView("shelf");
  });
}

function renderStats() {
  const counts = buildStats();
  const total = Math.max(1, state.shelf.items.length);
  const chartRows = [
    { label: "읽을 예정", value: counts.toRead, color: "var(--chart-1)" },
    { label: "읽는 중", value: counts.reading, color: "var(--chart-2)" },
    { label: "완독", value: counts.done, color: "var(--chart-5)" },
  ];

  $view.innerHTML = `
    <section class="panel stats-panel">
      <div class="section-head">
        <div>
          <h2 class="section-title">독서 통계</h2>
          <p class="section-caption">책장에 쌓인 기록을 상태별로 부드럽게 살펴볼 수 있어요.</p>
        </div>
      </div>
      <div class="stat-grid">
        <article class="stat-card">
          <p class="book-meta">총 도서</p>
          <p class="stat-value">${state.shelf.items.length}</p>
        </article>
        <article class="stat-card">
          <p class="book-meta">읽는 중</p>
          <p class="stat-value">${counts.reading}</p>
        </article>
        <article class="stat-card">
          <p class="book-meta">완독</p>
          <p class="stat-value">${counts.done}</p>
        </article>
      </div>
      <div class="chart-stack">
        ${chartRows
          .map(
            (row) => `
              <div class="chart-row">
                <span class="book-meta">${row.label}</span>
                <div class="progress-track">
                  <div class="progress-fill" style="width:${(row.value / total) * 100}%; background:${row.color};"></div>
                </div>
                <span class="metric-chip">${row.value}권</span>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderMy() {
  const storageModeLabel = getStorageMode() === "localStorage" ? "브라우저 저장" : "임시 메모리 저장";
  $view.innerHTML = `
    <section class="panel my-panel">
      <div class="my-grid">
        <article class="my-card">
          <h3>테마 설정</h3>
          <p class="my-copy">시스템 설정을 기본으로 따르되, 직접 토글하면 선택한 테마가 이 브라우저에 저장됩니다.</p>
          <div class="theme-choice-row">
            <button class="theme-choice ${state.my.theme === "light" ? "active" : ""}" data-theme-choice="light" type="button">라이트</button>
            <button class="theme-choice ${state.my.theme === "dark" ? "active" : ""}" data-theme-choice="dark" type="button">다크</button>
          </div>
        </article>
        <article class="my-card">
          <h3>저장 방식</h3>
          <p class="my-copy">현재 책장은 <strong>${storageModeLabel}</strong> 방식으로 보관되고 있어요.</p>
          <p class="my-copy">Vercel 배포 환경에서도 바로 동작하도록 브라우저 저장소 기준으로 구성했습니다.</p>
        </article>
      </div>
    </section>
  `;

  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      applyTheme(button.dataset.themeChoice, true);
      renderMy();
    });
  });
}

async function loadShelf() {
  state.shelf.loading = true;
  try {
    state.shelf.items = readShelfStorage();
    state.shelf.message = getStorageMode() === "memory" ? "현재 브라우저 저장소를 사용할 수 없어 임시 메모리 저장 모드로 동작합니다." : "";
    state.shelf.error = "";
    console.log("[rebo shelf] load success", { count: state.shelf.items.length, mode: getStorageMode() });
  } catch (error) {
    state.shelf.items = [];
    state.shelf.error = `책장 불러오기 실패: ${String(error.message || error)}`;
  } finally {
    state.shelf.loading = false;
  }
}

async function patchBook(bookId, patch) {
  const items = readShelfStorage();
  const index = items.findIndex((book) => book.id === bookId);
  if (index < 0) {
    throw new Error("저장할 책을 찾을 수 없습니다.");
  }

  items[index] = normalizeShelfItem({ ...items[index], ...patch });
  writeShelfStorage(items);
  console.log("[rebo shelf] patch success", { id: bookId, patch });
}

function createManualForm() {
  return {
    cover: "",
    title: "",
    author: "",
    status: "to-read",
    startDate: "",
    endDate: "",
    activeDateField: "startDate",
    calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  };
}

function getInitialTheme() {
  const savedTheme = localStorage.getItem(LOCAL_THEME_KEY);
  if (savedTheme === "dark" || savedTheme === "light") {
    return savedTheme;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme, persist) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  state.my.theme = nextTheme;
  document.documentElement.setAttribute("data-theme", nextTheme);
  if (persist) {
    localStorage.setItem(LOCAL_THEME_KEY, nextTheme);
  }
}

function getStorageMode() {
  try {
    const testKey = "__rebo_storage_test__";
    localStorage.setItem(testKey, "1");
    localStorage.removeItem(testKey);
    return "localStorage";
  } catch (_error) {
    return "memory";
  }
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
  } catch (_error) {
    return [];
  }
}

function writeShelfStorage(items) {
  const normalizedItems = items.map(normalizeShelfItem);

  if (getStorageMode() === "memory") {
    volatileShelfFallback = normalizedItems;
    return;
  }

  localStorage.setItem(LOCAL_SHELF_KEY, JSON.stringify({ items: normalizedItems }));
}

function removeBookFromShelf(bookId) {
  const next = readShelfStorage().filter((book) => book.id !== bookId);
  writeShelfStorage(next);
  console.log("[rebo shelf] remove success", { id: bookId, count: next.length });
}

function findDuplicateBook(items, candidate) {
  const titleAuthorKey = `${normalizeText(candidate.title)}|${normalizeText(candidate.author)}`;
  return items.find((book) => {
    if (candidate.id && candidate.id === book.id) return true;
    if (candidate.isbn13 && candidate.isbn13 === book.isbn13) return true;
    if (candidate.isbn && candidate.isbn === book.isbn) return true;
    const key = `${normalizeText(book.title)}|${normalizeText(book.author)}`;
    return key.length > 1 && key === titleAuthorKey;
  });
}

function normalizeShelfItem(book) {
  return {
    id: String(book.id || createClientBookId(book)).trim(),
    title: String(book.title || "").trim(),
    author: String(book.author || "").trim(),
    publisher: String(book.publisher || "").trim(),
    pubYear: String(book.pubYear || "").trim(),
    isbn13: String(book.isbn13 || "").trim(),
    isbn: String(book.isbn || "").trim(),
    cover: String(book.cover || "/placeholder-cover.svg").trim() || "/placeholder-cover.svg",
    status: ["to-read", "reading", "done"].includes(book.status) ? book.status : "to-read",
    memo: String(book.memo || "").slice(0, 200),
    review: String(book.review || "").slice(0, 2000),
    startDate: String(book.startDate || ""),
    endDate: String(book.endDate || ""),
    source: {
      aladin: Boolean(book.source?.aladin),
      nl: Boolean(book.source?.nl),
    },
  };
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function createClientBookId(book) {
  const parts = [
    normalizeText(book.title),
    normalizeText(book.author),
    normalizeText(book.isbn13 || book.isbn || ""),
  ].filter(Boolean);
  return parts.join("-") || `book-${Date.now()}`;
}

function buildStats() {
  return state.shelf.items.reduce(
    (acc, book) => {
      const status = book.status || "to-read";
      if (status === "reading") acc.reading += 1;
      else if (status === "done") acc.done += 1;
      else acc.toRead += 1;
      return acc;
    },
    { toRead: 0, reading: 0, done: 0 },
  );
}

function formatDateForDisplay(value) {
  if (!value) return "";
  const [year, month, date] = value.split("-");
  if (!year || !month || !date) return value;
  return `${year}.${month}.${date}`;
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toast(message) {
  $toastRoot.innerHTML = `<div class="toast">${escapeHtml(message)}</div>`;
  if (state.toastTimer) {
    window.clearTimeout(state.toastTimer);
  }
  state.toastTimer = window.setTimeout(() => {
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
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }

    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch (error) {
    console.log("[rebo] cache cleanup skipped", String(error.message || error));
  }
}
