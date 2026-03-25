const STATUS_LABEL = {
  "to-read": "읽을 예정",
  reading: "읽는 중",
  done: "완독",
};

const LOCAL_SHELF_KEY = "rebo-bookshelf-v3";
const LOCAL_THEME_KEY = "rebo-theme";
const CALENDAR_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
let volatileShelfFallback = [];

const VIEW_META = {
  shelf: { title: "책장", subtitle: "추가한 책을 차분하게 모아보고, 상세 기록까지 이어갈 수 있어요." },
  search: { title: "검색", subtitle: "책 제목이나 저자명으로 책을 찾아 바로 책장에 담아보세요." },
  stats: { title: "통계", subtitle: "읽기 상태와 완독 흐름을 가볍게 확인할 수 있어요." },
  friends: { title: "친구", subtitle: "" },
  my: { title: "마이", subtitle: "" },
  detail: { title: "책 상세", subtitle: "읽기 상태, 날짜, 독후감을 한곳에서 관리해보세요." },
  manual: { title: "책장 > 직접 추가", subtitle: "책 표지와 기본 정보를 입력해 직접 추가할 수 있어요." },
};

const state = {
  view: "shelf",
  selectedBookId: null,
  toastTimer: null,
  fileTarget: "manual",
  search: {
    query: "",
    items: [],
    page: 1,
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
  my: {
    theme: getInitialTheme(),
  },
  stats: {
    mode: "week",
    weekOffset: 0,
    monthOffset: 0,
    yearOffset: 0,
  },
  manualForm: createManualForm(),
  detail: createDetailState(),
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

function createDetailState() {
  return {
    menuOpen: false,
    editingInfo: false,
    reviewEditing: false,
    reviewDraft: "",
    reviewSaving: false,
    calendarField: "",
    calendarMonth: startOfMonth(new Date()),
    draft: null,
  };
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
    calendarMonth: startOfMonth(new Date()),
  };
}

function bindThemeEvents() {
  $themeToggle.addEventListener("click", () => {
    const nextTheme = state.my.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme, true);
    if (state.view === "my") renderMy();
  });

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", (event) => {
      if (localStorage.getItem(LOCAL_THEME_KEY)) return;
      applyTheme(event.matches ? "dark" : "light", false);
      if (state.view === "my") renderMy();
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
      const cover = typeof reader.result === "string" ? reader.result : "";
      if (state.fileTarget === "detail" && state.detail.editingInfo && state.detail.draft) {
        state.detail.draft.cover = cover;
        renderDetail();
      } else {
        state.manualForm.cover = cover;
        renderManualAdd();
      }
      $coverFileInput.value = "";
    };
    reader.readAsDataURL(file);
  });
}

async function setView(view) {
  state.view = view;
  syncNav(view);
  syncHeader(view);
  closeSheet();
  closeModal();

  if (view === "shelf") {
    resetDetailState();
    await renderShelf();
    return;
  }
  if (view === "search") {
    resetDetailState();
    renderSearch();
    return;
  }
  if (view === "stats") {
    resetDetailState();
    await loadShelf();
    renderStats();
    return;
  }
  if (view === "friends") {
    resetDetailState();
    renderFriends();
    return;
  }
  if (view === "my") {
    resetDetailState();
    renderMy();
    return;
  }
  if (view === "detail") {
    await loadShelf();
    syncDetailState();
    renderDetail();
    return;
  }
  if (view === "manual") {
    resetDetailState();
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
  $themeToggle.hidden = true;
}

function resetDetailState() {
  state.detail = createDetailState();
}

function syncDetailState() {
  const book = getSelectedBook();
  if (!book) return;
  state.detail.menuOpen = false;
  state.detail.reviewDraft = book.review || "";
  state.detail.calendarMonth = startOfMonth(fromIsoDate(book.endDate || book.startDate) || new Date());
  state.detail.calendarField = getStatusDefaultCalendarField(book);
  if (!state.detail.editingInfo) {
    state.detail.draft = null;
  }
}

async function renderShelf() {
  await loadShelf();
  console.log("[rebo shelf] render data", state.shelf.items);

  $view.innerHTML = `
    <section class="shelf-panel bare-panel">
      <div class="shelf-topline">
        <div class="count-pill">총 ${state.shelf.items.length}권</div>
      </div>
      ${state.shelf.message ? `<div class="state warn">${escapeHtml(state.shelf.message)}</div>` : ""}
      ${state.shelf.error ? `<div class="state error">${escapeHtml(state.shelf.error)}</div>` : ""}
      <div class="shelf-grid">
        <button class="add-card" id="open-add-flow" type="button">
          <div class="add-card-icon">+</div>
          <p class="add-card-title">책장에 책을 추가하세요</p>
          <p class="add-card-copy">검색으로 찾거나 직접 추가할 수 있어요.</p>
        </button>
        ${state.shelf.items
          .map(
            (book) => `
              <button class="shelf-book" data-bookid="${escapeAttr(book.id)}" type="button">
                <div class="shelf-cover-frame">
                  <img class="shelf-cover-image" src="${escapeAttr(book.cover || "/placeholder-cover.svg")}" alt="${escapeAttr(book.title)}" />
                </div>
                <div class="card-body">
                  <span class="status-badge ${escapeAttr(book.status)}">${escapeHtml(getStatusLabel(book.status))}</span>
                  <p class="book-title clamp-2">${escapeHtml(book.title)}</p>
                  <p class="book-meta">${escapeHtml(book.author || "저자 정보 없음")}</p>
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
  $sheetRoot.innerHTML = `
    <div class="sheet-backdrop" id="sheet-backdrop">
      <section class="sheet" role="dialog" aria-modal="true" aria-label="책 추가">
        <div class="sheet-handle"></div>
        <h2 class="sheet-title">책 추가</h2>
        <p class="sheet-copy">검색으로 추가하거나 직접 입력해서 책장을 채워보세요.</p>
        <div class="sheet-actions">
          <button class="sheet-option" id="sheet-search" type="button">검색으로 추가</button>
          <button class="sheet-option" id="sheet-manual" type="button">직접 추가</button>
        </div>
      </section>
    </div>
  `;

  document.getElementById("sheet-backdrop").addEventListener("click", (event) => {
    if (event.target.id === "sheet-backdrop") closeSheet();
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
  $sheetRoot.innerHTML = "";
}

function renderSearch() {
  $view.innerHTML = `
    <section class="search-panel bare-panel">
      <h2 class="section-title">검색</h2>
      <div class="search-toolbar">
        <input
          id="search-input"
          class="search-field"
          type="text"
          placeholder="검색어"
          value="${escapeAttr(state.search.query)}"
        />
        <button id="search-button" class="search-submit" type="button" aria-label="검색">
          <span aria-hidden="true">⌕</span>
        </button>
      </div>
      <div id="search-state"></div>
      <div id="search-results" class="result-grid"></div>
    </section>
  `;

  const $input = document.getElementById("search-input");
  document.getElementById("search-button").addEventListener("click", runSearchFromInput);
  $input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") runSearchFromInput();
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
    state.search.message = "";
    state.search.items = [];
    state.search.page = 1;
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
  state.search.page = 1;
  state.search.warnings = result.warnings;
  state.search.error = result.error;
  state.search.message = result.error ? "" : result.items.length > 0 ? `검색 결과 ${result.items.length}건` : `${buildTopicMessage(query)} 찾을 수 없습니다.`;

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
        error: data?.message || (response.status >= 500 ? "외부 API 호출에 실패했습니다." : "검색 요청 처리에 실패했습니다."),
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

  if (!state.search.query && !state.search.loading) {
    $state.innerHTML = `
      <div class="search-empty">
        <p class="search-empty-copy">책 제목이나 저자로 책을 찾아 책장에 담아보세요.</p>
      </div>
    `;
    return;
  }

  if (state.search.loading) {
    $state.innerHTML = `<div class="state">로딩 중...</div>`;
    return;
  }

  if (state.search.error) {
    $state.innerHTML = `
      <div class="state error">
        <strong>${escapeHtml(state.search.error)}</strong>
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

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(state.search.items.length / pageSize));
  if (state.search.page > totalPages) state.search.page = totalPages;
  const startIndex = (state.search.page - 1) * pageSize;
  const visibleItems = state.search.items.slice(startIndex, startIndex + pageSize);

  $list.innerHTML = `
    ${visibleItems
      .map(
        (book) => `
          <article class="result-card search-result-row">
            <div class="result-cover">
              <img class="result-cover-image" src="${escapeAttr(book.cover || "/placeholder-cover.svg")}" alt="${escapeAttr(book.title)}" />
            </div>
            <div class="result-copy">
              <p class="book-title clamp-2">${escapeHtml(book.title)}</p>
              <p class="book-meta">${escapeHtml(book.author || "저자 정보 없음")}</p>
              <p class="book-meta">${escapeHtml(book.publisher || "출판사 정보 없음")} · ${escapeHtml(book.pubYear || "연도 정보 없음")}</p>
              <div class="result-actions">
                <button class="btn primary full add-result-button" data-addid="${escapeAttr(book.id)}" type="button">책장에 추가하기</button>
              </div>
            </div>
          </article>
        `,
      )
      .join("")}
    ${
      totalPages > 1
        ? `
          <div class="search-pagination">
            <button class="btn ghost" data-search-page-move="-1" type="button" ${state.search.page === 1 ? "disabled" : ""}>이전</button>
            <span class="search-page-indicator">${state.search.page} / ${totalPages}</span>
            <button class="btn ghost" data-search-page-move="1" type="button" ${state.search.page === totalPages ? "disabled" : ""}>다음</button>
          </div>
        `
        : ""
    }
  `;

  $list.querySelectorAll("[data-addid]").forEach((button) => {
    button.addEventListener("click", async () => {
      const book = state.search.items.find((item) => item.id === button.dataset.addid);
      if (!book) return;
      await addBookToShelf(book);
    });
  });

  $list.querySelectorAll("[data-search-page-move]").forEach((button) => {
    button.addEventListener("click", () => {
      state.search.page = Math.max(1, state.search.page + Number(button.dataset.searchPageMove || 0));
      drawSearchResults();
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
    toast(`「${book.title}」이 책장에 추가되었습니다.`);
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
                      <p class="helper-text">책 형태를 눌러 표지를 추가하세요.</p>
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
              ? renderDateSection({
                  status: form.status,
                  startDate: form.startDate,
                  endDate: form.endDate,
                  activeField: activeDateField,
                  month: form.calendarMonth,
                  scope: "manual",
                })
              : ""
          }

          <button id="manual-submit" class="btn primary full" type="button" ${isSubmitEnabled ? "" : "disabled"}>추가</button>
        </div>
      </div>
    </section>
  `;

  document.getElementById("manual-cover-button").addEventListener("click", () => openPhotoPermissionModal("manual"));
  document.getElementById("manual-title").addEventListener("input", (event) => {
    state.manualForm.title = event.target.value;
    syncManualSubmitState();
  });
  document.getElementById("manual-author").addEventListener("input", (event) => {
    state.manualForm.author = event.target.value;
    syncManualSubmitState();
  });
  document.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", () => updateManualStatus(button.dataset.status));
  });

  bindDateControls("manual");
  document.getElementById("manual-submit").addEventListener("click", submitManualBook);
}

function syncManualSubmitState() {
  const $button = document.getElementById("manual-submit");
  if (!$button) return;
  const enabled = state.manualForm.title.trim().length > 0 && state.manualForm.author.trim().length > 0;
  $button.disabled = !enabled;
}

function updateManualStatus(status) {
  const next = normalizeStatusDates(status, state.manualForm.startDate, state.manualForm.endDate);
  state.manualForm.status = status;
  state.manualForm.startDate = next.startDate;
  state.manualForm.endDate = next.endDate;
  state.manualForm.activeDateField = status === "done" ? "startDate" : status === "reading" ? "startDate" : "";
  if (status !== "to-read" && !state.manualForm.startDate) {
    state.manualForm.calendarMonth = startOfMonth(new Date());
  }
  renderManualAdd();
}

function shiftManualCalendar(step) {
  const current = state.manualForm.calendarMonth;
  state.manualForm.calendarMonth = new Date(current.getFullYear(), current.getMonth() + step, 1);
  renderManualAdd();
}

function applyManualDate(isoDate) {
  const activeField = state.manualForm.status === "done" ? state.manualForm.activeDateField || "startDate" : "startDate";
  const next = applyDateSelection(
    {
      status: state.manualForm.status,
      startDate: state.manualForm.startDate,
      endDate: state.manualForm.endDate,
      activeField,
    },
    isoDate,
  );

  state.manualForm.startDate = next.startDate;
  state.manualForm.endDate = next.endDate;
  state.manualForm.activeDateField = next.activeField;
  renderManualAdd();
}

function openPhotoPermissionModal(target) {
  state.fileTarget = target;
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
    if (event.target.id === "modal-backdrop") closeModal();
  });
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-allow").addEventListener("click", () => {
    closeModal();
    $coverFileInput.click();
  });
}

function closeModal() {
  $modalRoot.innerHTML = "";
}

async function submitManualBook() {
  const form = state.manualForm;
  if (!form.title.trim() || !form.author.trim()) return;

  const normalizedDates = normalizeStatusDates(form.status, form.startDate, form.endDate);
  const book = normalizeShelfItem({
    id: createClientBookId(form),
    title: form.title,
    author: form.author,
    cover: form.cover || "/placeholder-cover.svg",
    status: form.status,
    startDate: normalizedDates.startDate,
    endDate: normalizedDates.endDate,
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
  toast(`「${book.title}」이 책장에 추가되었습니다.`);
  setView("shelf");
}

function renderDetail() {
  const book = getSelectedBook();
  if (!book) {
    setView("shelf");
    return;
  }

  const isManual = isManualBook(book);
  const isEditing = state.detail.editingInfo && isManual;
  const detailBook = isEditing ? state.detail.draft : book;
  const showCalendar = detailBook.status === "reading" || detailBook.status === "done";
  const reviewValue = state.detail.reviewEditing ? state.detail.reviewDraft : book.review || "";

  $view.innerHTML = `
    <section class="panel detail-panel">
      <div class="detail-top">
        <button id="detail-back" class="detail-header-button" type="button">←</button>
        <h2 class="detail-screen-title">책 상세</h2>
        ${
          isEditing
            ? `<button id="detail-save-info" class="detail-save-button" type="button">저장</button>`
            : `<button id="detail-menu-button" class="icon-button" type="button" aria-label="메뉴">⋮</button>`
        }
      </div>

      <div class="detail-mobile">
        <div class="detail-cover-block">
          ${
            isEditing
              ? `
                <button class="camera-tile detail-camera" id="detail-cover-button" type="button">
                  ${
                    detailBook.cover
                      ? `<img src="${escapeAttr(detailBook.cover)}" alt="${escapeAttr(detailBook.title)}" />`
                      : `
                        <div class="camera-tile-empty">
                          <div>
                            <div class="camera-tile-icon">⌁</div>
                            <p class="helper-text">책 표지를 수정할 수 있어요.</p>
                          </div>
                        </div>
                      `
                  }
                </button>
              `
              : `
                <div class="detail-cover-frame detail-cover-alone">
                  <img class="detail-cover-image" src="${escapeAttr(detailBook.cover || "/placeholder-cover.svg")}" alt="${escapeAttr(detailBook.title)}" />
                </div>
              `
          }
        </div>

        <div class="meta-stack detail-meta-center">
          ${
            isEditing
              ? `
                <label class="date-field">
                  <span class="field-label">책 제목</span>
                  <input id="detail-title" class="text-field" type="text" placeholder="책 제목을 입력하세요." value="${escapeAttr(detailBook.title)}" />
                </label>
                <label class="date-field">
                  <span class="field-label">저자</span>
                  <input id="detail-author" class="text-field" type="text" placeholder="저자를 입력하세요." value="${escapeAttr(detailBook.author)}" />
                </label>
              `
              : `
                <p class="detail-book-title">${escapeHtml(detailBook.title)}</p>
                <p class="detail-book-author">${escapeHtml(detailBook.author || "저자")}</p>
              `
          }
        </div>

        <section class="section-card detail-section">
          <h3>읽기 상태</h3>
          <div class="status-row">
            ${renderStatusButton("to-read", "읽을 예정", detailBook.status, "detail-status")}
            ${renderStatusButton("reading", "읽는 중", detailBook.status, "detail-status")}
            ${renderStatusButton("done", "완독", detailBook.status, "detail-status")}
          </div>
        </section>

        ${
          detailBook.status !== "to-read"
            ? `
              <section class="section-card detail-section">
                ${renderDetailDateFields(detailBook, isEditing)}
                ${showCalendar ? renderDetailCalendarSection(detailBook) : ""}
              </section>
            `
            : ""
        }

        <section class="section-card detail-section">
          <div class="review-head">
            <h3>독후감</h3>
            <span class="review-count">${(reviewValue || "").length}/2000</span>
          </div>
          ${
            state.detail.reviewEditing
              ? `
                <textarea id="detail-review" class="review-textarea is-editing" rows="8" maxlength="2000" placeholder="독후감을 작성해보세요.">${escapeHtml(state.detail.reviewDraft)}</textarea>
              `
              : `
                <button id="review-display" class="review-display" type="button">
                  ${reviewValue ? escapeHtml(reviewValue).replaceAll("\n", "<br />") : `<span class="review-placeholder">영역을 눌러 독후감을 작성해보세요.</span>`}
                </button>
              `
          }
        </section>
      </div>

      ${
        !isEditing && state.detail.menuOpen
          ? `
            <div class="menu-panel">
              ${
                isManual
                  ? `<button class="menu-item" id="menu-edit" type="button">책 정보 수정</button>`
                  : ""
              }
              <button class="menu-item danger" id="menu-delete" type="button">책장에서 삭제</button>
            </div>
          `
          : ""
      }
    </section>
  `;

  bindDetailEvents(book, isManual, isEditing);
}

function bindDetailEvents(book, isManual, isEditing) {
  document.getElementById("detail-back").addEventListener("click", () => setView("shelf"));

  if (!isEditing) {
    document.getElementById("detail-menu-button").addEventListener("click", () => {
      state.detail.menuOpen = !state.detail.menuOpen;
      renderDetail();
    });
  }

  if (isEditing) {
    document.getElementById("detail-cover-button").addEventListener("click", () => openPhotoPermissionModal("detail"));
    document.getElementById("detail-title").addEventListener("input", (event) => {
      state.detail.draft.title = event.target.value;
    });
    document.getElementById("detail-author").addEventListener("input", (event) => {
      state.detail.draft.author = event.target.value;
    });
    document.getElementById("detail-save-info").addEventListener("click", saveDetailBookInfo);
  } else {
    const $reviewDisplay = document.getElementById("review-display");
    if ($reviewDisplay) {
      $reviewDisplay.addEventListener("click", () => {
        state.detail.reviewEditing = true;
        state.detail.reviewDraft = book.review || "";
        renderDetail();
        window.setTimeout(() => {
          document.getElementById("detail-review")?.focus();
        }, 0);
      });
    }
  }

  document.querySelectorAll("[data-detail-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      await handleDetailStatusChange(button.dataset.detailStatus);
    });
  });

  document.querySelectorAll("[data-detail-date]").forEach((button) => {
    button.addEventListener("click", () => {
      state.detail.calendarField = button.dataset.detailDate;
      const sourceBook = isEditing ? state.detail.draft : getSelectedBook();
      state.detail.calendarMonth = startOfMonth(fromIsoDate(sourceBook?.[state.detail.calendarField]) || new Date());
      renderDetail();
    });
  });

  bindDateControls("detail");

  const $review = document.getElementById("detail-review");
  if ($review) {
    $review.addEventListener("input", (event) => {
      state.detail.reviewDraft = event.target.value;
      const $count = document.querySelector(".review-count");
      if ($count) $count.textContent = `${state.detail.reviewDraft.length}/2000`;
    });
    $review.addEventListener("blur", async () => {
      await saveDetailReview();
    });
  }

  const $menuEdit = document.getElementById("menu-edit");
  if ($menuEdit) {
    $menuEdit.addEventListener("click", () => {
      state.detail.menuOpen = false;
      state.detail.editingInfo = true;
      state.detail.reviewEditing = false;
      state.detail.draft = normalizeShelfItem(book);
      state.detail.calendarMonth = startOfMonth(fromIsoDate(book.endDate || book.startDate) || new Date());
      state.detail.calendarField = getStatusDefaultCalendarField(book);
      renderDetail();
    });
  }

  const $menuDelete = document.getElementById("menu-delete");
  if ($menuDelete) {
    $menuDelete.addEventListener("click", () => openDeleteConfirm(book.id));
  }
}

async function handleDetailStatusChange(status) {
  const isEditing = state.detail.editingInfo && state.detail.draft;
  if (isEditing) {
    const next = normalizeStatusDates(status, state.detail.draft.startDate, state.detail.draft.endDate);
    state.detail.draft.status = status;
    state.detail.draft.startDate = next.startDate;
    state.detail.draft.endDate = next.endDate;
    state.detail.calendarField = getStatusDefaultCalendarField({
      status,
      startDate: state.detail.draft.startDate,
      endDate: state.detail.draft.endDate,
    });
    renderDetail();
    return;
  }

  const book = getSelectedBook();
  if (!book) return;
  const next = normalizeStatusDates(status, book.startDate, book.endDate);
  await patchBook(book.id, {
    status,
    startDate: next.startDate,
    endDate: next.endDate,
  });
  await loadShelf();
  state.detail.calendarField = getStatusDefaultCalendarField({
    status,
    startDate: next.startDate,
    endDate: next.endDate,
  });
  renderDetail();
}

async function saveDetailBookInfo() {
  if (!state.detail.draft) return;

  const draft = state.detail.draft;
  if (!draft.title.trim() || !draft.author.trim()) {
    toast("책 제목과 저자를 입력해주세요.");
    return;
  }

  const next = normalizeStatusDates(draft.status, draft.startDate, draft.endDate);
  await patchBook(draft.id, {
    title: draft.title,
    author: draft.author,
    cover: draft.cover || "/placeholder-cover.svg",
    status: draft.status,
    startDate: next.startDate,
    endDate: next.endDate,
  });
  await loadShelf();
  state.detail.editingInfo = false;
  state.detail.draft = null;
  syncDetailState();
  toast("수정된 책 정보가 저장되었습니다.");
  renderDetail();
}

async function saveDetailReview() {
  if (state.detail.reviewSaving) return;
  const book = getSelectedBook();
  if (!book) return;

  const nextReview = String(state.detail.reviewDraft || "").slice(0, 2000);
  state.detail.reviewSaving = true;
  try {
    if (nextReview !== (book.review || "")) {
      await patchBook(book.id, { review: nextReview });
      await loadShelf();
      toast("독후감이 저장되었습니다.");
    }
  } finally {
    state.detail.reviewSaving = false;
    state.detail.reviewEditing = false;
    state.detail.reviewDraft = nextReview;
    renderDetail();
  }
}

function openDeleteConfirm(bookId) {
  closeModal();
  $modalRoot.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <section class="modal-card" role="dialog" aria-modal="true" aria-label="삭제 확인">
        <h3>책장에서 삭제할까요?</h3>
        <p>삭제하면 책장 목록에서 바로 사라집니다.</p>
        <div class="modal-actions">
          <button class="btn ghost" id="cancel-delete" type="button">취소</button>
          <button class="btn primary" id="confirm-delete" type="button">삭제</button>
        </div>
      </section>
    </div>
  `;

  document.getElementById("modal-backdrop").addEventListener("click", (event) => {
    if (event.target.id === "modal-backdrop") closeModal();
  });
  document.getElementById("cancel-delete").addEventListener("click", closeModal);
  document.getElementById("confirm-delete").addEventListener("click", async () => {
    removeBookFromShelf(bookId);
    await loadShelf();
    closeModal();
    toast("책장에서 삭제되었습니다.");
    setView("shelf");
  });
}

function renderDetailDateFields(book, isEditing) {
  return `
    <div class="date-grid ${book.status === "done" ? "two" : ""}">
      <div class="date-field">
        <span class="field-label">읽기 시작한 날</span>
        <button class="date-pill ${state.detail.calendarField === "startDate" ? "active" : ""}" data-detail-date="startDate" type="button">
          ${formatDateForDisplay(book.startDate) || "날짜를 선택하세요."}
        </button>
      </div>
      ${
        book.status === "done"
          ? `
            <div class="date-field">
              <span class="field-label">완독한 날</span>
              <button class="date-pill ${state.detail.calendarField === "endDate" ? "active" : ""}" data-detail-date="endDate" type="button">
                ${formatDateForDisplay(book.endDate) || "날짜를 선택하세요."}
              </button>
            </div>
          `
          : ""
      }
    </div>
    ${isEditing ? `<p class="helper-text">날짜 영역을 누르면 아래 달력이 펼쳐집니다.</p>` : ""}
  `;
}

function renderDetailCalendarSection(book) {
  const activeField = state.detail.calendarField || getDefaultCalendarField(book);
  const isOpen = Boolean(state.detail.calendarField);
  return `
    <div class="calendar-accordion ${isOpen ? "open" : ""}">
      <div class="calendar-accordion-inner">
        ${renderDateCalendar({
          scope: "detail",
          status: book.status,
          startDate: book.startDate,
          endDate: book.endDate,
          activeField,
          month: state.detail.calendarMonth,
        })}
        <div class="calendar-close-row">
          <button class="btn ghost" data-calendar-close="detail" type="button">닫기</button>
        </div>
      </div>
    </div>
  `;
}

function renderStatusButton(status, label, currentStatus, attributeName = "status") {
  return `<button class="status-button ${status === currentStatus ? "active" : ""}" data-${attributeName}="${status}" type="button">${label}</button>`;
}

function renderDateSection({ status, startDate, endDate, activeField, month, scope }) {
  return `
    <div class="date-grid ${status === "done" ? "two" : ""}">
      <div class="date-field">
        <span class="field-label">읽기 시작한 날</span>
        <button class="date-pill ${activeField === "startDate" ? "active" : ""}" data-${scope}-date="startDate" type="button">
          ${formatDateForDisplay(startDate) || "날짜를 선택하세요."}
        </button>
      </div>
      ${
        status === "done"
          ? `
            <div class="date-field">
              <span class="field-label">완독한 날</span>
              <button class="date-pill ${activeField === "endDate" ? "active" : ""}" data-${scope}-date="endDate" type="button">
                ${formatDateForDisplay(endDate) || "날짜를 선택하세요."}
              </button>
            </div>
          `
          : ""
      }
    </div>
    ${renderDateCalendar({ scope, status, startDate, endDate, activeField, month })}
  `;
}

function renderDateCalendar({ scope, status, startDate, endDate, activeField, month }) {
  const currentMonth = startOfMonth(month);
  const firstWeekday = currentMonth.getDay();
  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const cells = [];

  for (let index = 0; index < firstWeekday; index += 1) {
    cells.push(`<div class="calendar-cell muted"></div>`);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = toDateInputValue(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day));
    const isActive = activeField === "startDate" ? startDate === iso : endDate === iso;
    const isRange = status === "done" && startDate && endDate && iso > startDate && iso < endDate;
    cells.push(`
      <button class="calendar-cell ${isActive ? "active" : ""} ${isRange ? "range" : ""}" type="button" data-calendar-scope="${scope}" data-calendar-date="${iso}">
        ${day}
      </button>
    `);
  }

  return `
    <section class="calendar">
      <div class="calendar-header">
        <button class="calendar-nav" data-calendar-move="${scope}:-1" type="button" aria-label="이전 달">‹</button>
        <div class="calendar-title">${currentMonth.getFullYear()}년 ${currentMonth.getMonth() + 1}월</div>
        <button class="calendar-nav" data-calendar-move="${scope}:1" type="button" aria-label="다음 달">›</button>
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

function bindDateControls(scope) {
  document.querySelectorAll(`[data-${scope}-date]`).forEach((button) => {
    button.addEventListener("click", () => {
      if (scope === "manual") {
        state.manualForm.activeDateField = button.dataset.manualDate;
        renderManualAdd();
      } else {
        state.detail.calendarField = state.detail.calendarField === button.dataset.detailDate ? "" : button.dataset.detailDate;
        renderDetail();
      }
    });
  });

  document.querySelectorAll(`[data-calendar-move^="${scope}:"]`).forEach((button) => {
    button.addEventListener("click", () => {
      const [, step] = String(button.dataset.calendarMove || "").split(":");
      const amount = Number(step);
      if (scope === "manual") {
        shiftManualCalendar(amount);
      } else {
        shiftDetailCalendar(amount);
      }
    });
  });

  document.querySelectorAll(`[data-calendar-scope="${scope}"]`).forEach((button) => {
    button.addEventListener("click", async () => {
      if (scope === "manual") {
        applyManualDate(button.dataset.calendarDate);
      } else {
        await applyDetailDate(button.dataset.calendarDate);
      }
    });
  });

  document.querySelectorAll(`[data-calendar-close="${scope}"]`).forEach((button) => {
    button.addEventListener("click", () => {
      if (scope === "detail") {
        state.detail.calendarField = "";
        renderDetail();
      }
    });
  });
}

function shiftDetailCalendar(step) {
  const current = state.detail.calendarMonth;
  state.detail.calendarMonth = new Date(current.getFullYear(), current.getMonth() + step, 1);
  renderDetail();
}

async function applyDetailDate(isoDate) {
  const field = state.detail.calendarField || "startDate";
  const isEditing = state.detail.editingInfo && state.detail.draft;

  if (isEditing) {
    const next = applyDateSelection(
      {
        status: state.detail.draft.status,
        startDate: state.detail.draft.startDate,
        endDate: state.detail.draft.endDate,
        activeField: field,
      },
      isoDate,
    );
    state.detail.draft.startDate = next.startDate;
    state.detail.draft.endDate = next.endDate;
    state.detail.calendarField = next.activeField;
    renderDetail();
    return;
  }

  const book = getSelectedBook();
  if (!book) return;

  const next = applyDateSelection(
    {
      status: book.status,
      startDate: book.startDate,
      endDate: book.endDate,
      activeField: field,
    },
    isoDate,
  );
  await patchBook(book.id, {
    startDate: next.startDate,
    endDate: next.endDate,
  });
  await loadShelf();
  state.detail.calendarField = next.activeField;
  renderDetail();
}

function applyDateSelection(target, isoDate) {
  const next = {
    startDate: target.startDate || "",
    endDate: target.endDate || "",
    activeField: target.activeField || "startDate",
  };

  if (target.status === "reading") {
    next.startDate = isoDate;
    next.endDate = "";
    next.activeField = "startDate";
    return next;
  }

  if (target.status === "done") {
    if (next.activeField === "startDate") {
      next.startDate = isoDate;
      if (next.endDate && next.endDate < isoDate) next.endDate = "";
      next.activeField = "endDate";
      return next;
    }
    next.endDate = isoDate;
    if (next.startDate && next.endDate < next.startDate) {
      next.startDate = isoDate;
    }
    next.activeField = "endDate";
    return next;
  }

  next.startDate = "";
  next.endDate = "";
  next.activeField = "";
  return next;
}

function normalizeStatusDates(status, startDate, endDate) {
  if (status === "to-read") {
    return { startDate: "", endDate: "" };
  }
  if (status === "reading") {
    return { startDate: startDate || "", endDate: "" };
  }
  if (status === "done") {
    const nextStart = startDate || "";
    const nextEnd = endDate && (!nextStart || endDate >= nextStart) ? endDate : "";
    return { startDate: nextStart, endDate: nextEnd };
  }
  return { startDate, endDate };
}

function getStatusDefaultCalendarField(book) {
  if (book.status === "reading") {
    return book.startDate ? "" : "startDate";
  }
  if (book.status === "done") {
    if (!book.startDate) return "startDate";
    if (!book.endDate) return "endDate";
    return "";
  }
  return "";
}

function getDefaultCalendarField(book) {
  if (book.status === "done") {
    return book.endDate ? "endDate" : "startDate";
  }
  return "startDate";
}

function getSelectedBook() {
  return state.shelf.items.find((item) => item.id === state.selectedBookId) || null;
}

function isManualBook(book) {
  return Boolean(book) && !book.source?.aladin && !book.source?.nl;
}

function buildTopicMessage(word) {
  return `${word}${pickJosa(word, "은", "는")}`;
}

function renderStats() {
  const statsView = buildStatsViewModel();

  $view.innerHTML = `
    <section class="stats-panel bare-panel">
      <div class="stats-mode-row">
        <button class="stats-mode-button ${state.stats.mode === "week" ? "active" : ""}" data-stats-mode="week" type="button">주간</button>
        <button class="stats-mode-button ${state.stats.mode === "month" ? "active" : ""}" data-stats-mode="month" type="button">월간</button>
        <button class="stats-mode-button ${state.stats.mode === "year" ? "active" : ""}" data-stats-mode="year" type="button">연간</button>
      </div>

      <div class="stats-period-row">
        <button class="stats-arrow" data-stats-shift="-1" type="button">‹</button>
        <div class="stats-period-copy">
          <div class="stats-period-select-wrap">
            <select id="stats-period-select" class="stats-period-select" aria-label="통계 기간 선택">
              ${statsView.options
                .map(
                  (option) => `
                    <option value="${escapeAttr(String(option.value))}" ${option.selected ? "selected" : ""}>${escapeHtml(option.label)}</option>
                  `,
                )
                .join("")}
            </select>
          </div>
          <p class="stats-period-subtitle">${escapeHtml(statsView.periodSubtitle)}</p>
        </div>
        <button class="stats-arrow" data-stats-shift="1" type="button">›</button>
      </div>

      <div class="stats-summary-grid">
        ${statsView.summary
          .map(
            (item) => `
              <article class="stats-summary-card">
                <p class="stats-summary-label">${escapeHtml(item.label)}</p>
                <p class="stats-summary-value">${escapeHtml(item.value)}</p>
                <p class="stats-summary-note">${escapeHtml(item.note)}</p>
              </article>
            `,
          )
          .join("")}
      </div>

      <section class="stats-chart-card">
        <div class="stats-chart-head">
          <h3>${escapeHtml(statsView.chartTitle)}</h3>
          <span>${escapeHtml(statsView.chartCaption)}</span>
        </div>
        <div class="stats-bars">
          ${statsView.chartBars
            .map(
              (bar) => `
                <div class="stats-bar-item">
                  <div class="stats-bar-track">
                    <div class="stats-bar-fill" style="height:${bar.height}%; background:${bar.color};"></div>
                  </div>
                  <span class="stats-bar-label">${escapeHtml(bar.label)}</span>
                </div>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="stats-books-card">
        <div class="stats-chart-head">
          <h3>${escapeHtml(statsView.listTitle)}</h3>
        </div>
        <div class="stats-book-list">
          ${statsView.bookRows
            .map(
              (row) => `
                <article class="stats-book-row">
                  <div class="stats-book-meta">
                    <span class="stats-book-color" style="background:${row.color};"></span>
                    <div>
                      <p class="stats-book-title">${escapeHtml(row.title)}</p>
                      <p class="stats-book-author">${escapeHtml(row.author)}</p>
                    </div>
                  </div>
                  <div class="stats-book-values">
                    <strong>${row.currentPages}p / ${row.totalPages}p</strong>
                    <span>${row.percent}%</span>
                  </div>
                  <div class="stats-book-track">
                    <div class="stats-book-fill" style="width:${row.percent}%; background:${row.color};"></div>
                  </div>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>
    </section>
  `;

  document.querySelectorAll("[data-stats-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.stats.mode = button.dataset.statsMode;
      renderStats();
    });
  });

  document.getElementById("stats-period-select")?.addEventListener("change", (event) => {
    applyStatsPeriodSelection(event.target.value);
  });

  document.querySelectorAll("[data-stats-shift]").forEach((button) => {
    button.addEventListener("click", () => {
      shiftStatsPeriod(Number(button.dataset.statsShift || 0));
      renderStats();
    });
  });
}

function renderMy() {
  const storageModeLabel = getStorageMode() === "localStorage" ? "브라우저 저장" : "임시 메모리 저장";
  $view.innerHTML = `
    <section class="my-panel bare-panel">
      <div class="my-grid">
        <article class="my-card">
          <h3>로그인</h3>
          <p class="my-copy strong">로그인</p>
          <p class="my-copy">로그인하여 독서 기록을 동기화하세요.</p>
        </article>
        <article class="my-card">
          <h3>테마 설정</h3>
          <p class="my-copy">시스템 설정을 기본으로 따르며, 직접 고르면 브라우저에 저장돼요.</p>
          <div class="theme-choice-row">
            <button class="theme-choice ${state.my.theme === "light" ? "active" : ""}" data-theme-choice="light" type="button"><span class="theme-choice-icon">☀</span><span>라이트</span></button>
            <button class="theme-choice ${state.my.theme === "dark" ? "active" : ""}" data-theme-choice="dark" type="button"><span class="theme-choice-icon">☾</span><span>다크</span></button>
          </div>
        </article>
        <article class="my-card">
          <h3>저장 방식</h3>
          <p class="my-copy">현재 책장은 <strong>${storageModeLabel}</strong> 기반으로 저장되고 있어요.</p>
          <p class="my-copy">브라우저 저장 기반이라 Vercel 배포 환경에서도 바로 동작합니다.</p>
        </article>
        <article class="my-card">
          <h3>이용약관</h3>
          <p class="my-copy">서비스 이용 전, 차분히 살펴보실 수 있어요.</p>
          <button class="btn ghost" data-policy-open="terms" type="button">이용약관 보기</button>
        </article>
        <article class="my-card">
          <h3>개인정보 처리방침</h3>
          <p class="my-copy">개인정보가 어떻게 다뤄지는지 확인해보세요.</p>
          <button class="btn ghost" data-policy-open="privacy" type="button">개인정보 처리방침 보기</button>
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

  document.querySelectorAll("[data-policy-open]").forEach((button) => {
    button.addEventListener("click", () => openPolicyModal(button.dataset.policyOpen));
  });
}

function renderFriends() {
  $view.innerHTML = `
    <section class="friends-panel bare-panel">
      <div class="my-grid single">
        <article class="my-card">
          <h3>친구 기능 준비 중</h3>
          <p class="my-copy">친구와 독서 기록을 나누는 화면은 다음 단계에서 이어서 구현할게요.</p>
        </article>
      </div>
    </section>
  `;
}

async function loadShelf() {
  state.shelf.loading = true;
  try {
    state.shelf.items = readShelfStorage();
    state.shelf.message = getStorageMode() === "memory" ? "브라우저 저장소를 사용할 수 없어 임시 메모리 저장 모드로 동작하고 있어요." : "";
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
  if (index < 0) throw new Error("수정할 책을 찾을 수 없습니다.");
  items[index] = normalizeShelfItem({ ...items[index], ...patch });
  writeShelfStorage(items);
  console.log("[rebo shelf] patch success", { id: bookId, patch });
}

function getInitialTheme() {
  const savedTheme = localStorage.getItem(LOCAL_THEME_KEY);
  if (savedTheme === "dark" || savedTheme === "light") return savedTheme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme, persist) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  state.my.theme = nextTheme;
  document.documentElement.setAttribute("data-theme", nextTheme);
  if (persist) localStorage.setItem(LOCAL_THEME_KEY, nextTheme);
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

function pickJosa(word, consonantForm, vowelForm) {
  const text = String(word || "").trim();
  if (!text) return vowelForm;

  const lastChar = text[text.length - 1];
  const code = lastChar.charCodeAt(0);
  const HANGUL_BASE = 44032;
  const HANGUL_END = 55203;

  if (code < HANGUL_BASE || code > HANGUL_END) {
    return vowelForm;
  }

  const hasBatchim = (code - HANGUL_BASE) % 28 !== 0;
  return hasBatchim ? consonantForm : vowelForm;
}

function createClientBookId(book) {
  const parts = [normalizeText(book.title), normalizeText(book.author), normalizeText(book.isbn13 || book.isbn || "")].filter(Boolean);
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

function shiftStatsPeriod(step) {
  if (state.stats.mode === "week") state.stats.weekOffset += step;
  if (state.stats.mode === "month") state.stats.monthOffset += step;
  if (state.stats.mode === "year") state.stats.yearOffset += step;
}

function buildStatsViewModel() {
  const statsBooks = buildStatsBooks();
  if (state.stats.mode === "month") return buildMonthlyStatsView(statsBooks);
  if (state.stats.mode === "year") return buildYearlyStatsView(statsBooks);
  return buildWeeklyStatsView(statsBooks);
}

function buildStatsBooks() {
  const palette = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];
  return state.shelf.items.map((book, index) => {
    const seed = Array.from(book.id || `${index}`).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const totalPages = 120 + (seed % 280);
    const progress = book.status === "done" ? 100 : book.status === "reading" ? 42 + (seed % 35) : 8 + (seed % 22);
    const currentPages = Math.min(totalPages, Math.max(0, Math.round((totalPages * progress) / 100)));
    const activityDate = fromIsoDate(book.endDate || book.startDate) || new Date(2024, 0, 1 + (seed % 28));
    return {
      id: book.id,
      title: book.title,
      author: book.author || "저자 정보 없음",
      status: book.status || "to-read",
      totalPages,
      currentPages,
      progress: Math.min(progress, 100),
      activityDate,
      color: palette[index % palette.length],
    };
  });
}

function buildWeeklyStatsView(statsBooks) {
  const offset = state.stats.weekOffset;
  const baseDate = new Date();
  const monday = getStartOfWeek(addDays(baseDate, offset * 7));
  const labels = ["월", "화", "수", "목", "금", "토", "일"];
  const chartBars = labels.map((label, index) => {
    const source = statsBooks[index % Math.max(statsBooks.length, 1)];
    const value = source ? Math.max(0, Math.round(source.currentPages * ((index + 2) / 10))) : 0;
    return {
      label,
      pages: value,
      height: statsBooks.length ? Math.max(12, Math.min(100, Math.round((value / 180) * 100))) : 12,
      color: "var(--chart-1)",
    };
  });

  const totalPages = chartBars.reduce((sum, bar) => sum + bar.pages, 0);
  const completedBooks = statsBooks.filter((book) => book.status === "done").length;
  return {
    periodTitle: `${monday.getMonth() + 1}월 ${getWeekOfMonth(monday)}번째 주`,
    periodSubtitle: `${monday.getMonth() + 1}/${monday.getDate()} - ${addDays(monday, 6).getMonth() + 1}/${addDays(monday, 6).getDate()}`,
    options: buildWeekOptions(offset),
    summary: [
      { label: "총 페이지", value: `${totalPages}p`, note: "이번 주에 읽은 분량" },
      { label: "일평균", value: `${Math.round(totalPages / 7) || 0}p`, note: "7일 기준" },
      { label: "완독", value: `${completedBooks}권`, note: `총 ${statsBooks.length}권 중` },
    ],
    chartTitle: "요일별 읽은 페이지",
    chartCaption: `${monday.getFullYear()}년 ${getIsoWeek(monday)}주차`,
    chartBars,
    listTitle: "이번 주 읽은 책",
    listCaption: "",
    bookRows: buildStatsRows(sortStatsBooksForList(statsBooks).slice(0, 6)),
  };
}

function buildMonthlyStatsView(statsBooks) {
  const offset = state.stats.monthOffset;
  const baseDate = new Date();
  const monthDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + offset, 1);
  const chartBars = Array.from({ length: 5 }, (_, index) => {
    const source = statsBooks[index % Math.max(statsBooks.length, 1)];
    const value = source ? Math.max(0, Math.round(source.currentPages * (0.7 + index * 0.22))) : 0;
    return {
      label: `${index + 1}주`,
      pages: value,
      height: statsBooks.length ? Math.max(14, Math.min(100, Math.round((value / 420) * 100))) : 14,
      color: "var(--chart-1)",
    };
  });

  const totalPages = chartBars.reduce((sum, bar) => sum + bar.pages, 0);
  const completedBooks = statsBooks.filter((book) => book.status === "done").length;
  return {
    periodTitle: `${monthDate.getFullYear()}년 ${monthDate.getMonth() + 1}월`,
    periodSubtitle: `${totalPages}페이지 읽음`,
    options: buildMonthOptions(offset),
    summary: [
      { label: "총 페이지", value: `${totalPages}p`, note: "한 달 동안 읽은 분량" },
      { label: "일평균", value: `${Math.round(totalPages / 30) || 0}p`, note: "30일 기준" },
      { label: "완독", value: `${completedBooks}권`, note: `총 ${statsBooks.length}권 중` },
    ],
    chartTitle: "주차별 읽은 페이지",
    chartCaption: `${monthDate.getFullYear()}년 ${monthDate.getMonth() + 1}월`,
    chartBars,
    listTitle: "이번 달 읽은 책",
    listCaption: "",
    bookRows: buildStatsRows(sortStatsBooksForList(statsBooks).slice(0, 8)),
  };
}

function buildYearlyStatsView(statsBooks) {
  const offset = state.stats.yearOffset;
  const year = new Date().getFullYear() + offset;
  const chartBars = Array.from({ length: 12 }, (_, index) => {
    const source = statsBooks[index % Math.max(statsBooks.length, 1)];
    const value = source ? Math.max(0, Math.round(source.currentPages * (0.8 + (index % 4) * 0.28))) : 0;
    return {
      label: `${index + 1}`,
      pages: value,
      height: statsBooks.length ? Math.max(12, Math.min(100, Math.round((value / 520) * 100))) : 12,
      color: "var(--chart-1)",
    };
  });

  const totalPages = chartBars.reduce((sum, bar) => sum + bar.pages, 0);
  const completedBooks = statsBooks.filter((book) => book.status === "done").length;
  return {
    periodTitle: `${year}년`,
    periodSubtitle: `${totalPages}페이지 읽음`,
    options: buildYearOptions(offset),
    summary: [
      { label: "총 페이지", value: `${totalPages}p`, note: "한 해 동안 읽은 분량" },
      { label: "일평균", value: `${Math.round(totalPages / 365) || 0}p`, note: "365일 기준" },
      { label: "완독", value: `${completedBooks}권`, note: `총 ${statsBooks.length}권 중` },
    ],
    chartTitle: "월별 읽은 페이지",
    chartCaption: `${year}년`,
    chartBars,
    listTitle: `${year}년 읽은 책`,
    listCaption: "",
    bookRows: buildStatsRows(sortStatsBooksForList(statsBooks).slice(0, 10)),
  };
}

function buildStatsRows(items) {
  return items.map((item) => ({
    title: item.title,
    author: item.author,
    currentPages: item.currentPages,
    totalPages: item.totalPages,
    percent: Math.max(1, Math.min(100, Math.round((item.currentPages / Math.max(1, item.totalPages)) * 100))),
    color: item.color,
  }));
}

function sortStatsBooksForList(items) {
  return [...items]
    .filter((item) => item.status === "reading" || item.status === "done")
    .sort((left, right) => {
      const leftGroup = left.status === "reading" ? 0 : 1;
      const rightGroup = right.status === "reading" ? 0 : 1;
      if (leftGroup !== rightGroup) return leftGroup - rightGroup;
      return right.activityDate - left.activityDate;
    });
}

function buildWeekOptions(selectedOffset) {
  const today = new Date();
  return Array.from({ length: 12 }, (_, index) => {
    const offset = -index;
    const monday = getStartOfWeek(addDays(today, offset * 7));
    return {
      value: offset,
      label: `${monday.getFullYear()}년 ${monday.getMonth() + 1}월 ${getWeekOfMonth(monday)}번째 주`,
      selected: offset === selectedOffset,
    };
  });
}

function buildMonthOptions(selectedOffset) {
  const today = new Date();
  return Array.from({ length: 12 }, (_, index) => {
    const offset = -index;
    const monthDate = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    return {
      value: offset,
      label: `${monthDate.getFullYear()}년 ${monthDate.getMonth() + 1}월`,
      selected: offset === selectedOffset,
    };
  });
}

function buildYearOptions(selectedOffset) {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: 8 }, (_, index) => {
    const offset = -index;
    return {
      value: offset,
      label: `${currentYear + offset}년`,
      selected: offset === selectedOffset,
    };
  });
}

function applyStatsPeriodSelection(value) {
  const next = Number(value);
  if (Number.isNaN(next)) return;
  if (state.stats.mode === "week") state.stats.weekOffset = next;
  if (state.stats.mode === "month") state.stats.monthOffset = next;
  if (state.stats.mode === "year") state.stats.yearOffset = next;
  renderStats();
}

function openPolicyModal(type) {
  const policy = getPolicyContent(type);
  $modalRoot.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <section class="modal-card modal-card-wide" role="dialog" aria-modal="true" aria-label="${escapeAttr(policy.title)}">
        <div class="policy-head">
          <h3>${escapeHtml(policy.title)}</h3>
          <button class="icon-button" id="policy-close" type="button" aria-label="닫기">×</button>
        </div>
        <div class="policy-body">
          ${policy.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
        </div>
      </section>
    </div>
  `;

  document.getElementById("modal-backdrop").addEventListener("click", (event) => {
    if (event.target.id === "modal-backdrop") closeModal();
  });
  document.getElementById("policy-close").addEventListener("click", closeModal);
}

function getPolicyContent(type) {
  if (type === "privacy") {
    return {
      title: "개인정보 처리방침",
      paragraphs: [
        "rebo는 브라우저에 저장되는 독서 기록을 중심으로 동작해요.",
        "로그인 기능이 연결되기 전까지는 서버로 별도 개인정보를 전송하지 않아요.",
        "추후 동기화 기능이 추가되면 수집 항목과 보관 기간을 이 화면에서 다시 안내드릴게요.",
      ],
    };
  }

  return {
    title: "이용약관",
    paragraphs: [
      "rebo는 읽은 책과 생각을 차분히 기록하는 개인용 서비스예요.",
      "서비스를 이용하며 저장한 기록은 사용자의 브라우저 환경에 우선 보관돼요.",
      "기록이 보이지 않거나 문제가 생기면 브라우저 저장소 상태를 먼저 확인해 주세요.",
    ],
  };
}

function getStatusLabel(status) {
  return STATUS_LABEL[status] || "읽을 예정";
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function getStartOfWeek(date) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  next.setHours(0, 0, 0, 0);
  return next;
}

function getWeekOfMonth(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const offset = first.getDay() === 0 ? 6 : first.getDay() - 1;
  return Math.ceil((date.getDate() + offset) / 7);
}

function getIsoWeek(date) {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target - firstThursday;
  return 1 + Math.round(diff / 604800000);
}

function formatDateForDisplay(value) {
  if (!value) return "";
  const [year, month, date] = value.split("-");
  if (!year || !month || !date) return value;
  return `${year}.${month}.${date}`;
}

function fromIsoDate(value) {
  if (!value) return null;
  const [year, month, date] = value.split("-").map(Number);
  if (!year || !month || !date) return null;
  return new Date(year, month - 1, date);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toast(message) {
  $toastRoot.innerHTML = `<div class="toast"><span class="toast-icon">✓</span><span>${escapeHtml(message)}</span></div>`;
  if (state.toastTimer) window.clearTimeout(state.toastTimer);
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

