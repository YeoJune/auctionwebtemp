// public/js/bid-products.js

// 상태 관리
window.state = {
  bidType: "all", // 경매 타입: all, live, direct
  status: "active", // 상태: all, active(진행 중), completed, cancelled
  dateRange: 30, // 날짜 범위(일)
  currentPage: 1, // 현재 페이지
  itemsPerPage: 10, // 페이지당 아이템 수
  sortBy: "updated_at", // 정렬 기준 (기본: 업데이트 날짜)
  sortOrder: "desc", // 정렬 순서 (기본: 내림차순)
  keyword: "", // 검색 키워드
  liveBids: [], // 현장 경매 데이터
  directBids: [], // 직접 경매 데이터
  combinedResults: [], // 결합된 결과
  filteredResults: [], // 필터링된 결과
  totalItems: 0, // 전체 아이템 수
  totalPages: 0, // 전체 페이지 수
  isAuthenticated: false, // 인증 상태
  images: [], // 이미지 배열
  currentImageIndex: 0, // 현재 이미지 인덱스
};

// 상태 정의 - 단순화된 버전
const STATUS_TYPES = {
  // 직접 경매 (표시용)
  ACTIVE: "active",
  // 현장 경매 (표시용)
  FIRST: "first",
  SECOND: "second",
  FINAL: "final",
  // 공통 상태
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

// 상태 매핑 - API 요청용
const BACKEND_STATUS_MAPPING = {
  // 직접 경매 상태
  active: STATUS_TYPES.ACTIVE,
  // 현장 경매 상태
  first: STATUS_TYPES.ACTIVE,
  second: STATUS_TYPES.ACTIVE,
  final: STATUS_TYPES.ACTIVE,
  // 공통 상태
  completed: STATUS_TYPES.COMPLETED,
  cancelled: STATUS_TYPES.CANCELLED,
};

// 상태 그룹 - API 요청용
const STATUS_GROUPS = {
  // 모든 진행 중 상태를 "active" 필터에 그룹화
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
  [STATUS_TYPES.CANCELLED]: "낙찰 실패",
};

// 상태 CSS 클래스
const STATUS_CLASSES = {
  [STATUS_TYPES.ACTIVE]: "status-active",
  [STATUS_TYPES.FIRST]: "status-first",
  [STATUS_TYPES.SECOND]: "status-second",
  [STATUS_TYPES.FINAL]: "status-final",
  [STATUS_TYPES.COMPLETED]: "status-completed",
  [STATUS_TYPES.CANCELLED]: "status-cancelled",
};

// 초기화 함수
async function initialize() {
  try {
    // API 초기화
    await API.initialize();

    // 환율 정보 가져오기
    await fetchExchangeRate();

    // 인증 상태 확인
    await checkAuthStatus();

    // URL 파라미터에서 초기 상태 로드
    loadStateFromURL();

    // 이벤트 리스너 설정
    setupEventListeners();

    // 네비게이션 버튼 설정
    setupNavButtons();

    // 초기 데이터 로드
    await fetchProducts();

    // BidManager 초기화 - 인증 상태와 현재 데이터 전달
    BidManager.initialize(
      state.isAuthenticated,
      state.filteredResults.map((item) => item.item)
    );

    // 입찰 이벤트 리스너 설정
    setupBidEventListeners();
  } catch (error) {
    console.error("초기화 중 오류 발생:", error);
    alert("페이지 초기화 중 오류가 발생했습니다.");
  }
}

// 입찰 이벤트 리스너 설정
function setupBidEventListeners() {
  // 입찰 성공 이벤트 리스너
  window.addEventListener("bidSuccess", async function (e) {
    const { itemId, type } = e.detail;

    // 데이터 새로고침
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

// URL에서 상태 로드
function loadStateFromURL() {
  const urlParams = new URLSearchParams(window.location.search);

  if (urlParams.has("bidType")) state.bidType = urlParams.get("bidType");
  if (urlParams.has("status")) state.status = urlParams.get("status");
  if (urlParams.has("dateRange"))
    state.dateRange = parseInt(urlParams.get("dateRange"));
  if (urlParams.has("page"))
    state.currentPage = parseInt(urlParams.get("page"));
  if (urlParams.has("sortBy")) state.sortBy = urlParams.get("sortBy");
  if (urlParams.has("sortOrder")) state.sortOrder = urlParams.get("sortOrder");
  if (urlParams.has("keyword")) state.keyword = urlParams.get("keyword");

  // UI 요소 상태 업데이트
  updateUIFromState();
}

// URL 업데이트
function updateURL() {
  const params = new URLSearchParams();

  if (state.bidType !== "all") params.append("bidType", state.bidType);
  if (state.status !== "active") params.append("status", state.status);
  if (state.dateRange !== 30) params.append("dateRange", state.dateRange);
  if (state.currentPage !== 1) params.append("page", state.currentPage);
  if (state.sortBy !== "updated_at") params.append("sortBy", state.sortBy);
  if (state.sortOrder !== "desc") params.append("sortOrder", state.sortOrder);
  if (state.keyword) params.append("keyword", state.keyword);

  // URL 업데이트 (history API 사용)
  const url = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, "", url);
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

// 인증 관련 함수
async function checkAuthStatus() {
  try {
    const response = await API.fetchAPI("/auth/user");
    state.isAuthenticated = !!response.user;

    // BidManager에 인증 상태 전달
    if (window.BidManager) {
      BidManager.setAuthStatus(state.isAuthenticated);
    }

    updateAuthUI();
  } catch (error) {
    state.isAuthenticated = false;
    if (window.BidManager) {
      BidManager.setAuthStatus(false);
    }
    updateAuthUI();
  }
}

function updateAuthUI() {
  const signinBtn = document.getElementById("signinBtn");
  const signoutBtn = document.getElementById("signoutBtn");

  if (!signinBtn || !signoutBtn) return;

  if (state.isAuthenticated) {
    signinBtn.style.display = "none";
    signoutBtn.style.display = "inline-block";
  } else {
    signinBtn.style.display = "inline-block";
    signoutBtn.style.display = "none";
    // 로그인되지 않은 경우 로그인 페이지로 리다이렉트
    window.location.href = "/signinPage";
  }
}

async function handleSignout() {
  try {
    await API.fetchAPI("/auth/logout", { method: "POST" });
    state.isAuthenticated = false;
    if (window.BidManager) {
      BidManager.setAuthStatus(false);
    }
    window.location.href = "/signinPage";
  } catch (error) {
    alert("로그아웃 중 오류가 발생했습니다.");
  }
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

    // 정렬 및 페이지네이션 파라미터
    const params = {
      status: statusParam,
      fromDate: fromDate,
      page: state.currentPage,
      limit: state.itemsPerPage,
      sortBy: state.sortBy,
      sortOrder: state.sortOrder,
    };

    // API 요청 URL 생성
    const queryString = API.createURLParams(params);

    // 경매 타입에 따라 다른 엔드포인트 사용
    let liveBidsPromise, directBidsPromise;

    if (state.bidType === "live" || state.bidType === "all") {
      liveBidsPromise = API.fetchAPI(`/live-bids?${queryString}`);
    } else {
      liveBidsPromise = Promise.resolve({ bids: [] });
    }

    if (state.bidType === "direct" || state.bidType === "all") {
      directBidsPromise = API.fetchAPI(`/direct-bids?${queryString}`);
    } else {
      directBidsPromise = Promise.resolve({ bids: [] });
    }

    // 두 API 요청 병렬로 처리
    const [liveResults, directResults] = await Promise.all([
      liveBidsPromise,
      directBidsPromise,
    ]);

    // 결합 및 타입 정보 추가
    state.liveBids = liveResults.bids || [];
    state.directBids = directResults.bids || [];

    // 상태 원본 유지 - 백엔드 상태 그대로 사용
    const liveBidsWithType = state.liveBids.map((bid) => ({
      ...bid,
      type: "live",
      displayStatus: bid.status, // 실제 상태를 그대로 표시용으로 사용
    }));

    const directBidsWithType = state.directBids.map((bid) => ({
      ...bid,
      type: "direct",
      displayStatus: bid.status, // 실제 상태를 그대로 표시용으로 사용
    }));

    state.combinedResults = [...liveBidsWithType, ...directBidsWithType];

    // 필터링된 결과 업데이트
    updateFilteredResults();

    // BidManager에 필터링된 결과의 상품 데이터 전달
    BidManager.updateCurrentData(
      state.filteredResults.map((item) => item.item)
    );

    // BidManager에 입찰 데이터 전달
    BidManager.updateBidData(state.liveBids, state.directBids);

    // URL 업데이트
    updateURL();

    // 결과 표시
    displayProducts();

    // 페이지네이션 업데이트
    updatePagination();

    // 정렬 버튼 UI 업데이트
    updateSortButtonsUI();

    BidManager.startTimerUpdates();

    BidManager.initializePriceCalculators();
  } catch (error) {
    console.error("상품 데이터를 가져오는 중 오류 발생:", error);
    document.getElementById("productList").innerHTML =
      '<div class="no-results">데이터를 불러오는 데 실패했습니다.</div>';
  } finally {
    toggleLoading(false);
  }
}

// 필터링된 결과 업데이트
function updateFilteredResults() {
  // 현재 상태를 기준으로 결과 필터링
  let filtered = state.combinedResults;

  // 키워드 검색
  if (state.keyword) {
    const keyword = state.keyword.toLowerCase();
    filtered = filtered.filter((item) => {
      const product = item.item;
      if (!product) return false;

      return (
        (product.original_title &&
          product.original_title.toLowerCase().includes(keyword)) ||
        (product.brand && product.brand.toLowerCase().includes(keyword)) ||
        (product.category && product.category.toLowerCase().includes(keyword))
      );
    });
  }

  // 정렬 적용
  filtered.sort((a, b) => {
    let valueA, valueB;

    // 정렬 기준에 따른 값 추출
    switch (state.sortBy) {
      case "scheduled_date":
        valueA = a.item?.scheduled_date
          ? new Date(a.item.scheduled_date)
          : new Date(0);
        valueB = b.item?.scheduled_date
          ? new Date(b.item.scheduled_date)
          : new Date(0);
        break;
      case "original_title":
        valueA = a.item?.original_title || "";
        valueB = b.item?.original_title || "";
        break;
      case "brand":
        valueA = a.item?.brand || "";
        valueB = b.item?.brand || "";
        break;
      case "starting_price":
        valueA = a.item?.starting_price || 0;
        valueB = b.item?.starting_price || 0;
        break;
      case "current_price":
        valueA =
          a.type === "direct"
            ? a.current_price || 0
            : a.final_price || a.second_price || a.first_price || 0;
        valueB =
          b.type === "direct"
            ? b.current_price || 0
            : b.final_price || b.second_price || b.first_price || 0;
        break;
      case "updated_at":
      default:
        valueA = new Date(a.updated_at || 0);
        valueB = new Date(b.updated_at || 0);
        break;
    }

    // 정렬 방향 적용
    const direction = state.sortOrder === "asc" ? 1 : -1;

    // 문자열 비교
    if (typeof valueA === "string" && typeof valueB === "string") {
      return direction * valueA.localeCompare(valueB);
    }

    // 숫자 또는 날짜 비교
    return direction * (valueA - valueB);
  });

  state.filteredResults = filtered;
  state.totalItems = filtered.length;
  state.totalPages = Math.ceil(state.totalItems / state.itemsPerPage);
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

  // 로그아웃 버튼
  document
    .getElementById("signoutBtn")
    ?.addEventListener("click", handleSignout);

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

  // 이미지 네비게이션 버튼
  const prevBtn = document.querySelector(".image-nav.prev");
  const nextBtn = document.querySelector(".image-nav.next");

  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      changeMainImage(state.currentImageIndex - 1);
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      changeMainImage(state.currentImageIndex + 1);
    });
  }
}

// 정렬 변경 처리
function handleSortChange(sortKey) {
  if (state.sortBy === sortKey) {
    // 같은 정렬 기준이면 정렬 방향 전환
    state.sortOrder = state.sortOrder === "asc" ? "desc" : "asc";
  } else {
    // 새로운 정렬 기준
    state.sortBy = sortKey;

    // 기본 정렬 방향 설정
    if (sortKey === "scheduled_date") {
      state.sortOrder = "asc"; // 날짜는 오름차순
    } else if (sortKey === "starting_price" || sortKey === "current_price") {
      state.sortOrder = "desc"; // 가격은 내림차순
    } else {
      state.sortOrder = "asc"; // 기타는 오름차순
    }
  }

  // 정렬 버튼 UI 업데이트
  updateSortButtonsUI();

  // 필터링된 결과 업데이트 및 표시
  updateFilteredResults();
  displayProducts();

  // URL 업데이트
  updateURL();
}

// 정렬 버튼 UI 업데이트
function updateSortButtonsUI() {
  const sortButtons = document.querySelectorAll(".sort-btn");

  sortButtons.forEach((btn) => {
    // 모든 버튼에서 active 클래스와 방향 표시 제거
    btn.classList.remove("active", "asc", "desc");

    // 현재 정렬 기준인 버튼에 클래스 추가
    if (btn.dataset.sort === state.sortBy) {
      btn.classList.add("active", state.sortOrder);
    }
  });
}

// 필터 초기화
function resetFilters() {
  state.bidType = "all";
  state.status = "active";
  state.dateRange = 30;
  state.keyword = "";
  state.currentPage = 1;
  state.sortBy = "updated_at";
  state.sortOrder = "desc";

  // UI 요소 초기화
  updateUIFromState();

  // 데이터 다시 로드
  fetchProducts();
}

// 상태에 맞는 표시 텍스트 반환
function getStatusDisplay(status) {
  return STATUS_DISPLAY[status] || "알 수 없음";
}

// 상태에 맞는 CSS 클래스 반환
function getStatusClass(status) {
  return STATUS_CLASSES[status] || "status-default";
}

// 결과 표시
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

  // 현재 페이지에 해당하는 결과만 표시
  const startIdx = (state.currentPage - 1) * state.itemsPerPage;
  const endIdx = Math.min(
    startIdx + state.itemsPerPage,
    state.filteredResults.length
  );

  for (let i = startIdx; i < endIdx; i++) {
    const product = state.filteredResults[i];
    const item = product.item;

    if (!item) continue; // 아이템 정보가 없는 경우 건너뛰기

    const resultItem = document.createElement("div");
    resultItem.className = "bid-result-item";
    resultItem.dataset.itemId = item.item_id;
    resultItem.dataset.bidId = product.id;
    resultItem.dataset.bidType = product.type;

    // 이미지 섹션
    const imageSection = document.createElement("div");
    imageSection.className = "item-image";
    imageSection.innerHTML = `
        <img src="${API.validateImageUrl(item.image)}" alt="${
      item.original_title || "상품 이미지"
    }">
        <div class="item-rank">${item.rank || "N"}</div>
      `;

    // 상품 정보 섹션
    const infoSection = document.createElement("div");
    infoSection.className = "item-info";
    infoSection.innerHTML = `
        <div class="item-brand">${item.brand || "-"}</div>
        <div class="item-title">${item.original_title || "제목 없음"}</div>
        <div class="item-category">${item.category || "-"}</div>
      `;

    // 입찰 정보 섹션
    const bidInfoSection = document.createElement("div");
    bidInfoSection.className = "bid-info";

    // 원화 가격 계산
    const auctionId = item.auc_num || 1;
    const category = item.category || "기타";
    let japanesePrice = 0;

    let bidInfoHTML = `
        <div class="bid-type ${
          product.type === "live" ? "live-type" : "direct-type"
        }">
          ${product.type === "live" ? "현장 경매" : "직접 경매"}
        </div>
      `;

    if (product.type === "direct") {
      japanesePrice = product.current_price || 0;
      bidInfoHTML += `
          <div class="price-row">
            <span class="price-label">입찰 금액:</span>
            <span class="price-value">${formatNumber(
              product.current_price
            )} ¥</span>
          </div>
          <div class="price-row price-korean">
            <span class="price-label">관부가세 포함:</span>
            <span class="price-value">${formatNumber(
              calculateTotalPrice(japanesePrice, auctionId, category)
            )} ₩</span>
          </div>
        `;
    } else {
      bidInfoHTML += `
          <div class="price-stages">
            ${
              product.first_price
                ? `
              <div class="price-row">
                <span class="price-label">1차 입찰:</span>
                <span class="price-value">${formatNumber(
                  product.first_price
                )} ¥</span>
              </div>
            `
                : ""
            }
            ${
              product.second_price
                ? `
              <div class="price-row">
                <span class="price-label">2차 제안:</span>
                <span class="price-value">${formatNumber(
                  product.second_price
                )} ¥</span>
              </div>
            `
                : ""
            }
            ${
              product.final_price
                ? `
              <div class="price-row">
                <span class="price-label">최종 입찰:</span>
                <span class="price-value">${formatNumber(
                  product.final_price
                )} ¥</span>
              </div>
              <div class="price-row price-korean">
                <span class="price-label">관부가세 포함:</span>
                <span class="price-value">${formatNumber(
                  calculateTotalPrice(product.final_price, auctionId, category)
                )} ₩</span>
              </div>
            `
                : ""
            }
          </div>
        `;

      // 최종 가격 계산을 위한 가격 설정
      japanesePrice =
        product.final_price || product.second_price || product.first_price || 0;

      // 최종 가격이 없지만 다른 가격이 있는 경우 원화 예상가 표시
      if (
        !product.final_price &&
        (product.second_price || product.first_price)
      ) {
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

    bidInfoSection.innerHTML = bidInfoHTML;

    // 결과 상태 섹션
    const statusSection = document.createElement("div");
    statusSection.className = "result-status";

    // 상태에 따라 다른 표시와 클래스 적용 - 실제 상태(displayStatus)를 사용
    const statusClass = getStatusClass(product.displayStatus);
    const statusText = getStatusDisplay(product.displayStatus);

    // 타이머 HTML 추가
    let timerHTML = "";
    const timer = BidManager.getRemainingTime(item.scheduled_date);
    if (
      timer &&
      (product.displayStatus === "active" ||
        product.displayStatus === "first" ||
        product.displayStatus === "second")
    ) {
      timerHTML = `<div class="bid-timer ${timer.isNearEnd ? "near-end" : ""}">
                 남은시간: <span class="remaining-time">[${timer.text}]</span>
               </div>`;
    }

    statusSection.innerHTML = `
      <div class="status-badge ${statusClass}">
        ${statusText}
      </div>
      ${timerHTML}
      <div class="result-date">${formatDateTime(product.updated_at)}</div>
    `;

    // 모든 섹션 추가
    resultItem.appendChild(imageSection);
    resultItem.appendChild(infoSection);
    resultItem.appendChild(bidInfoSection);
    resultItem.appendChild(statusSection);

    // bid-products.js의 입찰 UI 추가 부분
    if (
      (product.displayStatus === "active" ||
        product.displayStatus === "first" ||
        product.displayStatus === "second") &&
      BidManager.getRemainingTime(item.scheduled_date)
    ) {
      const bidActionSection = document.createElement("div");
      bidActionSection.className = "bid-action";

      if (product.type === "direct") {
        bidActionSection.innerHTML = `
   <div class="bid-input-container compact">
     <div class="bid-input-group">
       <input type="number" class="bid-input" data-item-id="${item.item_id}" data-bid-type="direct">
       <span class="bid-value-display">000</span>
       <span class="bid-currency">¥</span>
       <button class="bid-button" onclick="event.stopPropagation(); BidManager.handleDirectBidSubmit(this.parentElement.querySelector('.bid-input').value, '${item.item_id}')">입찰</button>
     </div>
     <div class="price-details-container"></div>
   </div>
 `;
      } else {
        const liveBidInfo = state.liveBids.find((b) => b.id === product.id);
        const bidLabel = liveBidInfo?.first_price ? "최종입찰" : "1차입찰";

        bidActionSection.innerHTML = `
   <div class="bid-input-container compact">
     <div class="bid-input-group">
       <input type="number" class="bid-input" data-item-id="${item.item_id}" data-bid-type="live">
       <span class="bid-value-display">000</span>
       <span class="bid-currency">¥</span>
       <button class="bid-button" onclick="event.stopPropagation(); BidManager.handleLiveBidSubmit(this.parentElement.querySelector('.bid-input').value, '${item.item_id}')">입찰</button>
     </div>
     <div class="price-details-container"></div>
   </div>
 `;
      }

      resultItem.appendChild(bidActionSection);
    }

    // 클릭 이벤트 추가
    resultItem.addEventListener("click", (e) => {
      // 클릭된 요소가 입찰 관련 요소인 경우 이벤트 전파 중지
      if (
        e.target.closest(".bid-input-container") ||
        e.target.closest(".bid-button") ||
        e.target.closest(".quick-bid-btn")
      ) {
        e.stopPropagation();
        return;
      }

      showProductDetails(item.item_id);
    });

    // 컨테이너에 아이템 추가
    container.appendChild(resultItem);
  }
}

// 페이지 변경 처리 - 최종 수정 버전
function handlePageChange(page) {
  page = parseInt(page, 10);

  if (page === state.currentPage) return;

  // 상태 업데이트
  state.currentPage = page;

  // 제품 다시 표시
  displayProducts();

  // 페이지네이션 다시 생성
  updatePagination();

  // 페이지 상단으로 스크롤
  window.scrollTo(0, 0);

  // URL 업데이트
  updateURL();
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

  // 로딩 표시
  showLoadingInModal();

  try {
    // 상세 정보 가져오기
    const itemDetails = await API.fetchAPI(`/detail/item-details/${itemId}`, {
      method: "POST",
    });

    // 상세 정보 업데이트
    updateModalWithDetails(itemDetails);

    // 추가 이미지가 있다면 업데이트
    if (itemDetails.additional_images) {
      try {
        const additionalImages = JSON.parse(itemDetails.additional_images);
        initializeImages([item.image, ...additionalImages]);
      } catch (e) {
        console.error("이미지 파싱 오류:", e);
      }
    }
  } catch (error) {
    console.error("상품 상세 정보를 가져오는 중 오류 발생:", error);
  } finally {
    hideLoadingInModal();
  }
}

// 모달 초기화
function initializeModal(product, item) {
  document.querySelector(".modal-brand").textContent = item.brand || "-";
  document.querySelector(".modal-title").textContent =
    item.original_title || "-";
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

  // 이미지 초기화
  initializeImages([item.image]);
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
    item.original_title || "제목 없음";
  document.querySelector(".modal-rank").textContent = item.rank || "N";
}

function displayBidInfoInModal(product, item) {
  const bidSection = document.querySelector(".bid-info-holder");
  if (!bidSection) return;

  // 남은 시간 확인
  const timer = BidManager.getRemainingTime(item.scheduled_date);

  // 마감되었거나 완료/취소 상태인 경우 읽기 전용 표시
  if (
    !timer ||
    product.displayStatus === "completed" ||
    product.displayStatus === "cancelled"
  ) {
    // 입찰 불가 상태인 경우 읽기 전용 입찰 정보 표시
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

// 읽기 전용 입찰 정보 표시
function displayReadOnlyBidInfo(product, item, container) {
  // 상태에 따라 다른 표시와 클래스 적용 - 실제 상태 사용
  const statusClass = getStatusClass(product.displayStatus);
  const statusText = getStatusDisplay(product.displayStatus);

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
        <div class="price-korean">
          <strong>관부가세 포함:</strong> ₩${formatNumber(koreanPrice)}
        </div>
      `;
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

    // 진행 중인 경매일 경우에도 원화 예상가 표시
    if (japanesePrice > 0) {
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

// 이미지 초기화
function initializeImages(imageUrls) {
  const validImageUrls = imageUrls.filter((url) => url);

  state.images = validImageUrls;
  state.currentImageIndex = 0;

  const mainImage = document.querySelector(".main-image");
  const thumbnailContainer = document.querySelector(".thumbnail-container");

  if (!mainImage || !thumbnailContainer) return;

  // 메인 이미지 설정
  if (validImageUrls.length > 0) {
    mainImage.src = API.validateImageUrl(validImageUrls[0]);
  }

  // 썸네일 초기화
  thumbnailContainer.innerHTML = "";

  validImageUrls.forEach((img, index) => {
    const thumbnailWrapper = createElement("div", "thumbnail");
    thumbnailWrapper.classList.toggle("active", index === 0);

    const thumbnail = createElement("img");
    thumbnail.src = API.validateImageUrl(img);
    thumbnail.alt = `Thumbnail ${index + 1}`;
    thumbnail.loading = "lazy";

    thumbnail.addEventListener("click", () => changeMainImage(index));
    thumbnailWrapper.appendChild(thumbnail);
    thumbnailContainer.appendChild(thumbnailWrapper);
  });

  // 네비게이션 버튼 상태 업데이트
  updateNavigationButtons();
}

// 이미지 변경
function changeMainImage(index) {
  if (index < 0 || index >= state.images.length) return;

  state.currentImageIndex = index;
  const mainImage = document.querySelector(".main-image");
  if (!mainImage) return;

  mainImage.src = API.validateImageUrl(state.images[index]);

  // 썸네일 active 상태 업데이트
  const thumbnails = document.querySelectorAll(".thumbnail");
  thumbnails.forEach((thumb, i) => {
    thumb.classList.toggle("active", i === index);
  });

  updateNavigationButtons();
}

// 이미지 네비게이션 버튼 업데이트
function updateNavigationButtons() {
  const prevBtn = document.querySelector(".image-nav.prev");
  const nextBtn = document.querySelector(".image-nav.next");

  if (!prevBtn || !nextBtn) return;

  prevBtn.disabled = state.currentImageIndex === 0;
  nextBtn.disabled = state.currentImageIndex === state.images.length - 1;
}

// 모달 로딩 관련 함수들
function showLoadingInModal() {
  const existingLoader = document.getElementById("modal-loading");
  if (existingLoader) return;

  const loadingElement = createElement("div", "modal-loading");
  loadingElement.id = "modal-loading";
  loadingElement.textContent = "상세 정보를 불러오는 중...";

  document.querySelector(".modal-content")?.appendChild(loadingElement);
}

function hideLoadingInModal() {
  document.getElementById("modal-loading")?.remove();
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

// 모바일 필터 토글
function setupMobileFilters() {
  const filterBtn = document.getElementById("mobileFilterBtn");
  const filtersContainer = document.querySelector(".filters-container");

  if (!filterBtn || !filtersContainer) return;

  // 이벤트 리스너가 중복되지 않도록 복제 후 새로 추가
  const newFilterBtn = filterBtn.cloneNode(true);
  filterBtn.parentNode.replaceChild(newFilterBtn, filterBtn);

  newFilterBtn.addEventListener("click", function () {
    filtersContainer.classList.toggle("active");

    // 백드롭 생성 및 추가
    let backdrop = document.querySelector(".filter-backdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.className = "filter-backdrop";
      document.body.appendChild(backdrop);

      backdrop.addEventListener("click", function () {
        filtersContainer.classList.remove("active");
        backdrop.style.display = "none";
      });
    }

    backdrop.style.display = filtersContainer.classList.contains("active")
      ? "block"
      : "none";
  });

  // 필터 닫기 버튼 추가
  if (!filtersContainer.querySelector(".filter-close-btn")) {
    const closeBtn = document.createElement("button");
    closeBtn.className = "filter-close-btn";
    closeBtn.innerHTML = "&times;";
    closeBtn.addEventListener("click", function () {
      filtersContainer.classList.remove("active");
      document.querySelector(".filter-backdrop").style.display = "none";
    });

    filtersContainer.insertBefore(closeBtn, filtersContainer.firstChild);
  }
}

// DOM 완료 시 실행
document.addEventListener("DOMContentLoaded", function () {
  initialize();
  setupMobileFilters();
});
