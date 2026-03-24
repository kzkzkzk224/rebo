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
  my: { title: "MY", subtitle: "테마와 저장 방식을 확인하고 설정할 수 있어요." },
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
  state.detail.calendarField = book.status === "done" ? "endDate" : book.status === "reading" ? "startDate" : "";
  if (!state.detail.editingInfo) {
    state.detail.draft = null;
  }
}

async function renderShelf() {
  await loadShelf();
  console.log("[rebo shelf] render data", state.shelf.items);

  $view.innerHTML = `
    <section class="panel shelf-panel">
      <div class="section-head shelf-head">
        <div>
          <h2 class="section-title">내 책장</h2>
          <p class="section-caption">등록한 책을 눌러 상세 화면으로 들어갈 수 있어요.</p>
        </div>
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
    <section class="panel search-panel">
      <div class="section-head">
        <div>
          <h2 class="section-title">검색</h2>
          <p class="section-caption">책 제목이나 저자명으로 책을 찾아 책장에 담아보세요.</p>
        </div>
      </div>
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
        <p class="search-empty-keyword">책 제목</p>
        <p class="search-empty-divider">또는</p>
        <p class="search-empty-keyword">저자를 입력하세요.</p>
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
                ${
                  showCalendar && state.detail.calendarField
                    ? renderDateCalendar({
                        scope: "detail",
                        status: detailBook.status,
                        startDate: detailBook.startDate,
                        endDate: detailBook.endDate,
                        activeField: state.detail.calendarField,
                        month: state.detail.calendarMonth,
                      })
                    : ""
                }
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
      state.detail.calendarField = book.status === "done" ? "endDate" : book.status === "reading" ? "startDate" : "";
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
    state.detail.calendarField = status === "done" ? "startDate" : status === "reading" ? "startDate" : "";
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
  state.detail.calendarField = status === "done" ? "startDate" : status === "reading" ? "startDate" : "";
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
        state.detail.calendarField = button.dataset.detailDate;
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

function getSelectedBook() {
  return state.shelf.items.find((item) => item.id === state.selectedBookId) || null;
}

function isManualBook(book) {
  return Boolean(book) && !book.source?.aladin && !book.source?.nl;
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
          <p class="section-caption">상태별 분포와 현재 진행 흐름을 한눈에 볼 수 있어요.</p>
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
          <p class="my-copy">시스템 설정을 기본으로 따르며, 직접 고르면 브라우저에 저장돼요.</p>
          <div class="theme-choice-row">
            <button class="theme-choice ${state.my.theme === "light" ? "active" : ""}" data-theme-choice="light" type="button">라이트</button>
            <button class="theme-choice ${state.my.theme === "dark" ? "active" : ""}" data-theme-choice="dark" type="button">다크</button>
          </div>
        </article>
        <article class="my-card">
          <h3>저장 방식</h3>
          <p class="my-copy">현재 책장은 <strong>${storageModeLabel}</strong> 기반으로 저장되고 있어요.</p>
          <p class="my-copy">브라우저 저장 기반이라 Vercel 배포 환경에서도 바로 동작합니다.</p>
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
