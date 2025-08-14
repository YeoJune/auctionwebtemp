// public/js/bid-products.js

// 상태 관리
window.state = {
  bidType: "all", // 경매 타입: all, live, direct
  status: "all", // 상태: all, active(진행 중), completed, cancelled
  dateRange: 30, // 날짜 범위(일)
  currentPage: 1, // 현재 페이지
  itemsPerPage: 10, // 페이지당 아이템 수
  sortBy: "updated_at", // 정렬 기준
  sortOrder: "desc", // 정렬 순서
  keyword: "", // 검색 키워드
  liveBids: [], // 현장 경매 데이터
  directBids: [], // 직접 경매 데이터
  combinedResults: [], // 결합된 결과
  filteredResults: [], // 필터링된 결과
  totalItems: 0, // 전체 아이템 수
  totalPages: 0, // 전체 페이지 수
  isAuthenticated: false, // 인증 상태
};

// 상태 정의
const STATUS_TYPES = {
  ACTIVE: "active",
  FIRST: "first",
  SECOND: "second",
  FINAL: "final",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

// 상태 그룹 - API 요청용
const STATUS_GROUPS = {
  ACTIVE: ["active", "first", "second", "final"],
  COMPLETED: ["completed"],
  CANCELLED: ["cancelled"],
  ALL: ["active", "first", "second", "final", "completed", "cancelled"],
};

// 상태 표시 텍스트
const STATUS_DISPLAY = {
  [STATUS_TYPES.ACTIVE]: "입찰 가능",
  [STATUS_TYPES.FIRST]: "1차 입찰",
  [STATUS_TYPES.SECOND]: "2차 제안",
  [STATUS_TYPES.FINAL]: "최종 입찰",
  [STATUS_TYPES.COMPLETED]: "낙찰 완료",
  [STATUS_TYPES.CANCELLED]: "더 높은 입찰 존재",
};

// 상태 CSS 클래스
const STATUS_CLASSES = {
  [STATUS_TYPES.ACTIVE]: "status-active",
  [STATUS_TYPES.FIRST]: "status-first",
  [STATUS_TYPES.SECOND]: "status-second",
  [STATUS_TYPES.FINAL]: "status-final",
  [STATUS_TYPES.COMPLETED]: "status-completed",
  [STATUS_TYPES.CANCELLED]: "status-cancelled",
  "status-expired": "status-expired",
};

// 초기화 함수
async function initialize() {
  try {
    // API 초기화
    await API.initialize();

    // 환율 정보 가져오기
    await fetchExchangeRate();

    // 인증 상태 확인 (common.js AuthManager 사용)
    state.isAuthenticated = await window.AuthManager.checkAuthStatus();

    if (!state.isAuthenticated) {
      window.AuthManager.redirectIfNotAuthenticated();
      return;
    }

    // URL 파라미터에서 초기 상태 로드 (common.js URLStateManager 사용)
    const stateKeys = [
      "bidType",
      "status",
      "dateRange",
      "currentPage",
      "sortBy",
      "sortOrder",
      "keyword",
    ];
    const urlState = window.URLStateManager.loadFromURL(state, stateKeys);
    Object.assign(state, urlState);

    updateUIFromState();

    // 이벤트 리스너 설정
    setupEventListeners();

    // 네비게이션 버튼 설정
    setupNavButtons();

    // 초기 데이터 로드
    await fetchProducts();

    // BidManager 초기화
    if (window.BidManager) {
      BidManager.initialize(
        state.isAuthenticated,
        state.filteredResults.map((item) => item.item)
      );
    }

    // 입찰 이벤트 리스너 설정
    setupBidEventListeners();

    // 타이머 업데이트 시작
    BidManager.startTimerUpdates();
  } catch (error) {
    console.error("초기화 중 오류 발생:", error);
    alert("페이지 초기화 중 오류가 발생했습니다.");
  }
}

// 입찰 이벤트 리스너 설정
function setupBidEventListeners() {
  window.addEventListener("bidSuccess", async function (e) {
    const { itemId, type } = e.detail;
    await fetchProducts();

    // 상세 모달이 열려있는 경우 해당 항목 업데이트
    const modal = document.getElementById("detailModal");
    if (modal && modal.style.display === "flex") {
      const modalItemId =
        document.querySelector(".modal-title")?.dataset?.itemId;
      if (modalItemId === itemId) {
        showProductDetails(itemId);
      }
    }
  });
}

// UI 요소 상태 업데이트
function updateUIFromState() {
  // 경매 타입 라디오 버튼
  document.querySelectorAll('input[name="bidType"]').forEach((radio) => {
    radio.checked = radio.value === state.bidType;
  });

  // 상태 라디오 버튼
  document.querySelectorAll('input[name="status"]').forEach((radio) => {
    radio.checked = radio.value === state.status;
  });

  // 날짜 범위 선택
  const dateRange = document.getElementById("dateRange");
  if (dateRange) dateRange.value = state.dateRange;

  // 검색어 입력 필드
  const searchInput = document.getElementById("searchInput");
  if (searchInput) searchInput.value = state.keyword;

  // 정렬 버튼 업데이트
  updateSortButtonsUI();
}

// 상품 데이터 가져오기
async function fetchProducts() {
  if (!state.isAuthenticated) {
    return;
  }

  toggleLoading(true);

  try {
    // 선택된 상태에 따라 API 파라미터 준비
    let statusParam;
    switch (state.status) {
      case "active":
        statusParam = STATUS_GROUPS.ACTIVE.join(",");
        break;
      case "completed":
        statusParam = STATUS_GROUPS.COMPLETED.join(",");
        break;
      case "cancelled":
        statusParam = STATUS_GROUPS.CANCELLED.join(",");
        break;
      case "all":
      default:
        statusParam = STATUS_GROUPS.ALL.join(",");
        break;
    }

    // 날짜 범위 계산
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - state.dateRange);
    const fromDate = formatDate(dateLimit);

    // API 파라미터
    const params = {
      status: statusParam,
      fromDate: fromDate,
      page: state.currentPage,
      limit: state.itemsPerPage,
      sortBy: state.sortBy,
      sortOrder: state.sortOrder,
    };

    // 키워드 검색 파라미터 추가
    if (state.keyword && state.keyword.trim() !== "") {
      params.keyword = state.keyword.trim();
    }

    const queryString = API.createURLParams(params);
    let results;

    // 경매 타입에 따른 API 호출
    if (state.bidType === "direct") {
      const directResults = await API.fetchAPI(`/direct-bids?${queryString}`);
      state.directBids = directResults.bids || [];
      state.liveBids = [];
      state.totalItems = directResults.total || 0;
      state.totalPages = directResults.totalPages || 1;
      results = directResults;
    } else {
      // 기본값은 라이브 경매
      state.bidType = "live";
      document.getElementById("bidType-live").checked = true;

      const liveResults = await API.fetchAPI(`/live-bids?${queryString}`);
      state.liveBids = liveResults.bids || [];
      state.directBids = [];
      state.totalItems = liveResults.total || 0;
      state.totalPages = liveResults.totalPages || 1;
      results = liveResults;
    }

    // 데이터 타입 정보 추가
    const liveBidsWithType = state.liveBids.map((bid) => ({
      ...bid,
      type: "live",
      displayStatus: bid.status,
    }));

    const directBidsWithType = state.directBids.map((bid) => ({
      ...bid,
      type: "direct",
      displayStatus: bid.status,
    }));

    // 결합 결과 설정
    state.combinedResults = [...liveBidsWithType, ...directBidsWithType];
    state.filteredResults = state.combinedResults;

    // 페이지 번호 유효성 검사
    if (state.totalPages === 0) {
      state.totalPages = 1;
    }

    if (state.currentPage > state.totalPages) {
      state.currentPage = 1;
      return await fetchProducts();
    }

    // BidManager에 데이터 전달
    if (window.BidManager) {
      BidManager.updateCurrentData(
        state.filteredResults.map((item) => item.item)
      );
      BidManager.updateBidData(state.liveBids, state.directBids);
    }

    // URL 업데이트 (common.js URLStateManager 사용)
    const defaultState = {
      bidType: "all",
      status: "all",
      dateRange: 30,
      currentPage: 1,
      sortBy: "updated_at",
      sortOrder: "desc",
      keyword: "",
    };
    window.URLStateManager.updateURL(state, defaultState);

    // 결과 표시
    displayProducts();

    // 페이지네이션 업데이트
    updatePagination();

    // 정렬 버튼 UI 업데이트
    updateSortButtonsUI();

    if (window.BidManager) {
      BidManager.startTimerUpdates();
      if (window.BidManager) {
        BidManager.initializePriceCalculators();
      }
    }
  } catch (error) {
    console.error("상품 데이터를 가져오는 중 오류 발생:", error);
    document.getElementById("productList").innerHTML =
      '<div class="no-results">데이터를 불러오는 데 실패했습니다.</div>';
  } finally {
    toggleLoading(false);
  }
}

// 이벤트 리스너 설정
function setupEventListeners() {
  // 경매 타입 라디오 버튼
  document.querySelectorAll('input[name="bidType"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      state.bidType = e.target.value;
      state.currentPage = 1;
      fetchProducts();
    });
  });

  // 상태 라디오 버튼
  document.querySelectorAll('input[name="status"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      state.status = e.target.value;
      state.currentPage = 1;
      fetchProducts();
    });
  });

  // 기간 드롭다운
  document.getElementById("dateRange")?.addEventListener("change", (e) => {
    state.dateRange = parseInt(e.target.value);
    state.currentPage = 1;
    fetchProducts();
  });

  // 검색 폼
  const searchForm = document.getElementById("searchForm");
  if (searchForm) {
    searchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const searchInput = document.getElementById("searchInput");
      state.keyword = searchInput.value.trim();
      state.currentPage = 1;
      fetchProducts();
    });
  }

  // 검색 초기화 버튼
  const clearSearchBtn = document.getElementById("clearSearch");
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener("click", () => {
      const searchInput = document.getElementById("searchInput");
      searchInput.value = "";
      state.keyword = "";
      state.currentPage = 1;
      fetchProducts();
    });
  }

  // 정렬 버튼들
  const sortButtons = document.querySelectorAll(".sort-btn");
  sortButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      handleSortChange(btn.dataset.sort);
    });
  });

  // 필터 적용 버튼
  document.getElementById("applyFilters")?.addEventListener("click", () => {
    state.currentPage = 1;
    fetchProducts();
  });

  // 필터 초기화 버튼
  document.getElementById("resetFilters")?.addEventListener("click", () => {
    resetFilters();
  });

  // 로그아웃 버튼 (common.js AuthManager 사용)
  document.getElementById("signoutBtn")?.addEventListener("click", () => {
    window.AuthManager.handleSignout();
  });

  // 상세 모달 닫기 버튼
  const closeBtn = document.querySelector(".modal .close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      document.getElementById("detailModal").style.display = "none";
    });
  }

  // 외부 클릭 시 모달 닫기
  window.addEventListener("click", (e) => {
    const modal = document.getElementById("detailModal");
    if (e.target === modal) {
      modal.style.display = "none";
    }
  });
}

// 정렬 변경 처리
function handleSortChange(sortKey) {
  if (state.sortBy === sortKey) {
    state.sortOrder = state.sortOrder === "asc" ? "desc" : "asc";
  } else {
    state.sortBy = sortKey;
    if (sortKey === "scheduled_date") {
      state.sortOrder = "asc";
    } else if (sortKey === "starting_price" || sortKey === "current_price") {
      state.sortOrder = "desc";
    } else {
      state.sortOrder = "asc";
    }
  }

  updateSortButtonsUI();
  fetchProducts();
}

// 정렬 버튼 UI 업데이트
function updateSortButtonsUI() {
  const sortButtons = document.querySelectorAll(".sort-btn");

  sortButtons.forEach((btn) => {
    btn.classList.remove("active", "asc", "desc");
    if (btn.dataset.sort === state.sortBy) {
      btn.classList.add("active", state.sortOrder);
    }
  });
}

// 필터 초기화
function resetFilters() {
  state.bidType = "all";
  state.status = "all";
  state.dateRange = 30;
  state.keyword = "";
  state.currentPage = 1;
  state.sortBy = "updated_at";
  state.sortOrder = "desc";

  updateUIFromState();
  fetchProducts();
}

// 상태에 맞는 표시 텍스트 반환
function getStatusDisplay(status, scheduledDate, bidInfo = null) {
  const now = new Date();
  const scheduled = new Date(scheduledDate);

  if (
    status === STATUS_TYPES.ACTIVE ||
    status === STATUS_TYPES.FIRST ||
    status === STATUS_TYPES.SECOND ||
    status === STATUS_TYPES.FINAL
  ) {
    if (bidInfo?.first_price && !bidInfo?.final_price) {
      const deadline = new Date(scheduled);
      deadline.setHours(22, 0, 0, 0);
      if (now > deadline) {
        return "마감됨";
      }
    } else if (!bidInfo?.first_price) {
      if (now > scheduled) {
        return "마감됨";
      }
    }
  }

  return STATUS_DISPLAY[status] || "알 수 없음";
}

// 상태에 맞는 CSS 클래스 반환
function getStatusClass(status, scheduledDate, bidInfo = null) {
  const now = new Date();
  const scheduled = new Date(scheduledDate);

  if (
    status === STATUS_TYPES.ACTIVE ||
    status === STATUS_TYPES.FIRST ||
    status === STATUS_TYPES.SECOND ||
    status === STATUS_TYPES.FINAL
  ) {
    if (bidInfo?.first_price && !bidInfo?.final_price) {
      const deadline = new Date(scheduled);
      deadline.setHours(22, 0, 0, 0);
      if (now > deadline) {
        return "status-expired";
      }
    } else if (!bidInfo?.first_price) {
      if (now > scheduled) {
        return "status-expired";
      }
    }
  }

  return STATUS_CLASSES[status] || "status-default";
}

// 템플릿 기반 상품 렌더링
function renderBidResultItem(product) {
  const template = document.getElementById("bid-result-item-template");
  if (!template) {
    console.error("bid-result-item-template을 찾을 수 없습니다.");
    return null;
  }

  const item = product.item;
  if (!item) return null;

  const itemElement = template.content.cloneNode(true);
  const resultItem = itemElement.querySelector(".bid-result-item");

  // 데이터 속성 설정
  resultItem.dataset.itemId = item.item_id;
  resultItem.dataset.bidId = product.id;
  resultItem.dataset.bidType = product.type;

  // 데이터 바인딩
  bindDataFields(itemElement, product, item);

  // 조건부 요소 처리
  processConditionalElements(itemElement, product, item);

  // 이벤트 리스너 추가
  addItemEventListeners(resultItem, item);

  return itemElement;
}

// 데이터 필드 바인딩
function bindDataFields(element, product, item) {
  // 이미지
  const img = element.querySelector('[data-field="image"]');
  if (img) {
    img.src = API.validateImageUrl(item.image);
    img.alt = item.title || "상품 이미지";
  }

  // 랭크
  const rank = element.querySelector('[data-field="rank"]');
  if (rank) rank.textContent = item.rank || "N";

  // 브랜드
  const brand = element.querySelector('[data-field="brand"]');
  if (brand) brand.textContent = item.brand || "-";

  // 제목
  const title = element.querySelector('[data-field="title"]');
  if (title) title.textContent = item.title || "제목 없음";

  // 카테고리
  const category = element.querySelector('[data-field="category"]');
  if (category) category.textContent = item.category || "-";

  // 경매 타입 표시
  const bidTypeEl = element.querySelector('[data-field="bid_type_display"]');
  if (bidTypeEl) {
    bidTypeEl.textContent = product.type === "live" ? "현장 경매" : "직접 경매";
    bidTypeEl.className = `bid-type ${
      product.type === "live" ? "live-type" : "direct-type"
    }`;
  }

  // 상태 표시
  const statusEl = element.querySelector('[data-field="status_display"]');
  if (statusEl) {
    const bidInfo = product.type === "live" ? product : null;
    const statusClass = getStatusClass(
      product.displayStatus,
      item.scheduled_date,
      bidInfo
    );
    const statusText = getStatusDisplay(
      product.displayStatus,
      item.scheduled_date,
      bidInfo
    );

    statusEl.textContent = statusText;
    statusEl.className = `status-badge ${statusClass}`;
  }

  // 업데이트 날짜
  const dateEl = element.querySelector('[data-field="updated_at"]');
  if (dateEl) dateEl.textContent = formatDateTime(product.updated_at);
}

// 조건부 요소 처리
function processConditionalElements(element, product, item) {
  // 현장 경매의 경우 입찰 정보를 고려한 타이머 체크
  let timer, isExpired;
  if (product.type === "live") {
    if (product.first_price && !product.final_price) {
      timer = window.BidManager
        ? BidManager.getRemainingTime(item.scheduled_date, "final")
        : null;
    } else {
      timer = window.BidManager
        ? BidManager.getRemainingTime(item.scheduled_date, "first")
        : null;
    }
  } else {
    timer = window.BidManager
      ? BidManager.getRemainingTime(item.scheduled_date, "first")
      : null;
  }

  isExpired = !timer;

  const isActiveBid =
    (product.displayStatus === "active" ||
      product.displayStatus === "first" ||
      product.displayStatus === "second" ||
      product.displayStatus === "final" ||
      product.displayStatus === "cancelled") &&
    !isExpired;

  // 입찰 가능한 경우 bid-action 섹션 처리
  const bidActionEl = element.querySelector('[data-if="isActiveBid"]');
  if (bidActionEl) {
    if (isActiveBid) {
      bidActionEl.className = "bid-action expanded";

      let bidHtml = "";
      if (product.type === "direct") {
        const directBidInfo = state.directBids.find((b) => b.id === product.id);
        bidHtml = window.BidManager
          ? BidManager.getDirectBidSectionHTML(
              directBidInfo,
              item.item_id,
              item.auc_num,
              item.category
            )
          : "";
      } else {
        const liveBidInfo = state.liveBids.find((b) => b.id === product.id);
        bidHtml = window.BidManager
          ? BidManager.getLiveBidSectionHTML(
              liveBidInfo,
              item.item_id,
              item.auc_num,
              item.category
            )
          : "";
      }

      // BidManager HTML을 파싱하여 적절히 배치
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = bidHtml;

      const leftContent = document.createElement("div");
      leftContent.className = "bid-action-left";

      const rightContent = document.createElement("div");
      rightContent.className = "bid-input-container";

      // 타이머 요소
      const timerElement = tempDiv.querySelector(".bid-timer");
      if (timerElement) {
        leftContent.appendChild(timerElement);
      }

      // 가격 요소들
      const priceElements = tempDiv.querySelectorAll(
        ".real-time-price, .bid-price-info, .final-price"
      );
      priceElements.forEach((el) => {
        leftContent.appendChild(el);
      });

      // 입력 컨테이너
      const inputContainerSource = tempDiv.querySelector(
        ".bid-input-container"
      );
      if (inputContainerSource) {
        while (inputContainerSource.firstChild) {
          rightContent.appendChild(inputContainerSource.firstChild);
        }
      }

      bidActionEl.appendChild(leftContent);
      bidActionEl.appendChild(rightContent);
    } else {
      bidActionEl.remove();
    }
  }

  // 완료된 입찰의 경우 bid-info 섹션 처리
  const bidInfoEl = element.querySelector('[data-if="isCompletedBid"]');
  if (bidInfoEl) {
    if (!isActiveBid) {
      bidInfoEl.className = "bid-info";

      const auctionId = item.auc_num || 1;
      const category = item.category || "기타";
      let japanesePrice = 0;
      let bidInfoHTML = "";

      if (product.type === "direct") {
        japanesePrice = product.current_price || 0;
        bidInfoHTML += `
          <div class="price-row">
            <span class="price-label">입찰 금액:</span>
            <span class="price-value">${formatNumber(
              product.current_price
            )} ¥</span>
          </div>
        `;

        if (product.winning_price) {
          const winningKoreanPrice = calculateTotalPrice(
            product.winning_price,
            auctionId,
            category
          );
          bidInfoHTML += `
            <div class="price-row winning-price">
              <span class="price-label">낙찰 금액:</span>
              <span class="price-value">${formatNumber(
                product.winning_price
              )} ¥</span>
            </div>
            <div class="price-row price-korean winning-price">
              <span class="price-label">관부가세 포함:</span>
              <span class="price-value">${formatNumber(
                winningKoreanPrice
              )} ₩</span>
            </div>
          `;
        } else {
          bidInfoHTML += `
            <div class="price-row price-korean">
              <span class="price-label">관부가세 포함:</span>
              <span class="price-value">${formatNumber(
                calculateTotalPrice(japanesePrice, auctionId, category)
              )} ₩</span>
            </div>
          `;
        }
      } else {
        bidInfoHTML += `<div class="price-stages">`;

        if (product.first_price) {
          bidInfoHTML += `
            <div class="price-row">
              <span class="price-label">1차 입찰:</span>
              <span class="price-value">${formatNumber(
                product.first_price
              )} ¥</span>
            </div>
          `;
        }

        if (product.second_price) {
          bidInfoHTML += `
            <div class="price-row">
              <span class="price-label">2차 제안:</span>
              <span class="price-value">${formatNumber(
                product.second_price
              )} ¥</span>
            </div>
          `;
        }

        if (product.final_price) {
          bidInfoHTML += `
            <div class="price-row">
              <span class="price-label">최종 입찰:</span>
              <span class="price-value">${formatNumber(
                product.final_price
              )} ¥</span>
            </div>
          `;
        }

        bidInfoHTML += `</div>`;

        japanesePrice =
          product.final_price ||
          product.second_price ||
          product.first_price ||
          0;

        if (product.winning_price) {
          const winningKoreanPrice = calculateTotalPrice(
            product.winning_price,
            auctionId,
            category
          );
          bidInfoHTML += `
            <div class="price-row winning-price">
              <span class="price-label">낙찰 금액:</span>
              <span class="price-value">${formatNumber(
                product.winning_price
              )} ¥</span>
            </div>
            <div class="price-row price-korean winning-price">
              <span class="price-label">관부가세 포함:</span>
              <span class="price-value">${formatNumber(
                winningKoreanPrice
              )} ₩</span>
            </div>
          `;
        } else if (japanesePrice > 0) {
          bidInfoHTML += `
            <div class="price-row price-korean">
              <span class="price-label">관부가세 포함:</span>
              <span class="price-value">${formatNumber(
                calculateTotalPrice(japanesePrice, auctionId, category)
              )} ₩</span>
            </div>
          `;
        }
      }

      bidInfoEl.innerHTML = bidInfoHTML;
    } else {
      bidInfoEl.remove();
    }
  }
}

// 아이템 이벤트 리스너 추가
function addItemEventListeners(element, item) {
  element.addEventListener("click", (e) => {
    if (
      e.target.closest(".bid-action") ||
      e.target.closest(".bid-input-container") ||
      e.target.closest(".bid-button") ||
      e.target.closest(".quick-bid-btn") ||
      e.target.closest(".price-calculator") ||
      e.target.closest(".bid-input-group")
    ) {
      e.stopPropagation();
      return;
    }
    showProductDetails(item.item_id);
  });
}

// 상품 표시 (템플릿 기반)
function displayProducts() {
  const container = document.getElementById("productList");
  if (!container) return;

  container.innerHTML = "";
  const totalResultsElement = document.getElementById("totalResults");
  if (totalResultsElement) {
    totalResultsElement.textContent = state.totalItems;
  }

  if (state.filteredResults.length === 0) {
    container.innerHTML =
      '<div class="no-results">표시할 상품이 없습니다.</div>';
    return;
  }

  state.filteredResults.forEach((product) => {
    const itemElement = renderBidResultItem(product);
    if (itemElement) {
      container.appendChild(itemElement);
    }
  });

  BidManager.initializePriceCalculators();
}

// 페이지 변경 처리
async function handlePageChange(page) {
  page = parseInt(page, 10);

  if (page === state.currentPage || page < 1 || page > state.totalPages) {
    return;
  }

  state.currentPage = page;
  await fetchProducts();
  window.scrollTo(0, 0);
}

// 페이지네이션 업데이트
function updatePagination() {
  createPagination(state.currentPage, state.totalPages, handlePageChange);
}

// 상품 상세 정보 표시
async function showProductDetails(itemId) {
  const modalManager = setupModal("detailModal");
  if (!modalManager) return;

  const product = state.filteredResults.find((p) => p.item?.item_id === itemId);
  if (!product) return;

  const item = product.item;

  // 기본 정보로 모달 초기화
  initializeModal(product, item);
  modalManager.show();

  // URL 파라미터 업데이트 (상품 ID 추가)
  const urlParams = window.URLStateManager.getURLParams();
  urlParams.set("item_id", itemId);
  const newUrl = window.location.pathname + "?" + urlParams.toString();
  window.history.replaceState({}, document.title, newUrl);

  // 로딩 표시 (common.js ModalImageGallery 사용)
  window.ModalImageGallery.showLoading();

  try {
    // 상세 정보 가져오기
    const itemDetails = await API.fetchAPI(`/detail/item-details/${itemId}`, {
      method: "POST",
    });

    // 상세 정보 업데이트
    updateModalWithDetails(itemDetails);

    // 추가 이미지가 있다면 업데이트 (common.js ModalImageGallery 사용)
    if (itemDetails.additional_images) {
      try {
        const additionalImages = JSON.parse(itemDetails.additional_images);
        window.ModalImageGallery.initialize([item.image, ...additionalImages]);
      } catch (e) {
        console.error("이미지 파싱 오류:", e);
      }
    }
  } catch (error) {
    console.error("상품 상세 정보를 가져오는 중 오류 발생:", error);
  } finally {
    window.ModalImageGallery.hideLoading();
  }
}

// 모달 초기화
function initializeModal(product, item) {
  document.querySelector(".modal-brand").textContent = item.brand || "-";
  document.querySelector(".modal-title").textContent = item.title || "-";
  document.querySelector(".modal-title").dataset.itemId = item.item_id;
  document.querySelector(".main-image").src = API.validateImageUrl(item.image);
  document.querySelector(".modal-description").textContent = "로딩 중...";
  document.querySelector(".modal-category").textContent =
    item.category || "로딩 중...";
  document.querySelector(".modal-brand2").textContent = item.brand || "-";
  document.querySelector(".modal-accessory-code").textContent =
    item.accessory_code || "로딩 중...";
  document.querySelector(".modal-scheduled-date").textContent =
    formatDateTime(item.scheduled_date) || "로딩 중...";
  document.querySelector(".modal-rank").textContent = item.rank || "N";

  // 가격 정보 표시
  displayBidInfoInModal(product, item);

  // 이미지 초기화 (common.js ModalImageGallery 사용)
  window.ModalImageGallery.initialize([item.image]);
}

// 상세 정보로 모달 업데이트
function updateModalWithDetails(item) {
  document.querySelector(".modal-description").textContent =
    item.description || "설명 없음";
  document.querySelector(".modal-category").textContent =
    item.category || "카테고리 없음";
  document.querySelector(".modal-accessory-code").textContent =
    item.accessory_code || "액세서리 코드 없음";
  document.querySelector(".modal-scheduled-date").textContent =
    item.scheduled_date
      ? formatDateTime(item.scheduled_date)
      : "날짜 정보 없음";
  document.querySelector(".modal-brand").textContent = item.brand || "-";
  document.querySelector(".modal-brand2").textContent = item.brand || "-";
  document.querySelector(".modal-title").textContent =
    item.title || "제목 없음";
  document.querySelector(".modal-rank").textContent = item.rank || "N";
}

function displayBidInfoInModal(product, item) {
  const bidSection = document.querySelector(".bid-info-holder");
  if (!bidSection) return;

  // 현장 경매의 경우 입찰 단계에 따른 타이머 체크
  let timer, isScheduledPassed;

  if (product.type === "live") {
    if (product.first_price && !product.final_price) {
      timer = BidManager.getRemainingTime(item.scheduled_date, "final");
    } else {
      timer = BidManager.getRemainingTime(item.scheduled_date, "first");
    }
  } else {
    timer = BidManager.getRemainingTime(item.scheduled_date, "first");
  }

  isScheduledPassed = !timer;

  // 마감되었거나 완료/취소 상태인 경우 읽기 전용 표시
  if (isScheduledPassed || product.displayStatus === "completed") {
    displayReadOnlyBidInfo(product, item, bidSection);
    return;
  }

  // 입찰 가능 상태인 경우 BidManager를 사용하여 입찰 폼 생성
  if (product.type === "direct") {
    const directBidInfo = state.directBids.find((b) => b.id === product.id);
    bidSection.innerHTML = BidManager.getDirectBidSectionHTML(
      directBidInfo,
      item.item_id,
      item.auc_num,
      item.category
    );
  } else {
    const liveBidInfo = state.liveBids.find((b) => b.id === product.id);
    bidSection.innerHTML = BidManager.getLiveBidSectionHTML(
      liveBidInfo,
      item.item_id,
      item.auc_num,
      item.category
    );
  }

  // 가격 계산기 초기화
  BidManager.initializePriceCalculators();
}

// 읽기 전용 입찰 정보 표시 함수
function displayReadOnlyBidInfo(product, item, container) {
  const statusClass = getStatusClass(
    product.displayStatus,
    item.scheduled_date
  );
  const statusText = getStatusDisplay(
    product.displayStatus,
    item.scheduled_date
  );

  // 원화 가격 계산
  const auctionId = item.auc_num || 1;
  const category = item.category || "기타";
  let japanesePrice = 0;

  if (product.type === "direct") {
    japanesePrice = product.current_price || 0;
  } else {
    japanesePrice =
      product.final_price || product.second_price || product.first_price || 0;
  }

  const koreanPrice = calculateTotalPrice(japanesePrice, auctionId, category);

  let priceInfoHTML = `
    <div class="modal-price-info">
      <div class="price-status ${statusClass}">
        ${statusText}
      </div>
      <div class="price-date">
        <strong>예정일:</strong> ${formatDateTime(item.scheduled_date)}
      </div>
      <div class="price-starting">
        <strong>시작가:</strong> ￥${formatNumber(item.starting_price || 0)}
      </div>
  `;

  // 경매 타입에 따른 추가 정보
  if (product.type === "direct") {
    priceInfoHTML += `
      <div class="price-type">
        <strong>경매 유형:</strong> 직접 경매
      </div>
      <div class="price-current">
        <strong>현재 입찰가:</strong> ￥${formatNumber(
          product.current_price || 0
        )}
      </div>
    `;

    if (product.winning_price) {
      const winningKoreanPrice = calculateTotalPrice(
        product.winning_price,
        auctionId,
        category
      );
      priceInfoHTML += `
        <div class="price-winning">
          <strong>낙찰 금액:</strong> ￥${formatNumber(product.winning_price)}
        </div>
        <div class="price-winning-korean">
          <strong>관부가세 포함:</strong> ₩${formatNumber(winningKoreanPrice)}
        </div>
      `;
    } else {
      priceInfoHTML += `
        <div class="price-korean">
          <strong>관부가세 포함:</strong> ₩${formatNumber(koreanPrice)}
        </div>
      `;
    }
  } else {
    priceInfoHTML += `
      <div class="price-type">
        <strong>경매 유형:</strong> 현장 경매
      </div>
    `;

    if (product.first_price) {
      priceInfoHTML += `
        <div class="price-first">
          <strong>1차 입찰가:</strong> ￥${formatNumber(product.first_price)}
        </div>
      `;
    }

    if (product.second_price) {
      priceInfoHTML += `
        <div class="price-second">
          <strong>2차 제안가:</strong> ￥${formatNumber(product.second_price)}
        </div>
      `;
    }

    if (product.final_price) {
      priceInfoHTML += `
        <div class="price-final">
          <strong>최종 입찰가:</strong> ￥${formatNumber(product.final_price)}
        </div>
      `;
    }

    if (product.winning_price) {
      const winningKoreanPrice = calculateTotalPrice(
        product.winning_price,
        auctionId,
        category
      );
      priceInfoHTML += `
        <div class="price-winning">
          <strong>낙찰 금액:</strong> ￥${formatNumber(product.winning_price)}
        </div>
        <div class="price-winning-korean">
          <strong>관부가세 포함:</strong> ₩${formatNumber(winningKoreanPrice)}
        </div>
      `;
    } else if (japanesePrice > 0) {
      priceInfoHTML += `
        <div class="price-korean">
          <strong>관부가세 포함:</strong> ₩${formatNumber(koreanPrice)}
        </div>
      `;
    }
  }

  priceInfoHTML += `
    <div class="price-updated">
      <strong>최종 업데이트:</strong> ${formatDateTime(product.updated_at)}
    </div>
  </div>`;

  container.innerHTML = priceInfoHTML;
}

// 네비게이션 버튼 설정
function setupNavButtons() {
  // 각 네비게이션 버튼에 이벤트 리스너 추가
  const navButtons = document.querySelectorAll(".nav-button");
  navButtons.forEach((button) => {
    // 기존 onclick 속성 외에 추가 처리가 필요한 경우를 위한 공간
  });
}

// 로딩 표시 토글
function toggleLoading(show) {
  const loadingMsg = document.getElementById("loadingMsg");
  if (loadingMsg) {
    loadingMsg.style.display = show ? "block" : "none";
  }
}

// bid-products.js에 추가할 코드 (products.js와 동일)
window.bidLoadingUI = {
  showBidLoading: function (buttonElement) {
    // 기존 버튼 텍스트 저장
    buttonElement.dataset.originalText = buttonElement.textContent;

    // 로딩 아이콘 추가
    buttonElement.innerHTML = '<span class="spinner"></span> 처리 중...';
    buttonElement.disabled = true;
    buttonElement.classList.add("loading");
  },

  hideBidLoading: function (buttonElement) {
    // 원래 텍스트로 복원
    buttonElement.textContent =
      buttonElement.dataset.originalText || "입찰하기";
    buttonElement.disabled = false;
    buttonElement.classList.remove("loading");
  },
};

// DOM 완료 시 실행
document.addEventListener("DOMContentLoaded", function () {
  initialize();
});
