// public/js/bid-results.js

// 상태 관리
window.state = {
  dateRange: 30, // 날짜 범위(일)
  currentPage: 1, // 현재 페이지
  itemsPerPage: 7, // 페이지당 날짜 수 (일별 그룹화)
  sortBy: "date", // 정렬 기준 (기본: 날짜)
  sortOrder: "desc", // 정렬 순서 (기본: 내림차순)
  combinedResults: [], // 결합된 결과
  dailyResults: [], // 일별로 그룹화된 결과
  filteredResults: [], // 필터링된 결과
  totalItems: 0, // 전체 아이템 수
  totalPages: 0, // 전체 페이지 수
  isAuthenticated: false, // 인증 상태
  totalStats: {
    itemCount: 0,
    totalItemCount: 0,
    japaneseAmount: 0,
    koreanAmount: 0,
    feeAmount: 0,
    vatAmount: 0,
    grandTotalAmount: 0,
  },
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
    await fetchCompletedBids();
  } catch (error) {
    console.error("초기화 중 오류 발생:", error);
    alert("페이지 초기화 중 오류가 발생했습니다.");
  }
}

// URL에서 상태 로드
function loadStateFromURL() {
  const urlParams = new URLSearchParams(window.location.search);

  if (urlParams.has("dateRange"))
    state.dateRange = parseInt(urlParams.get("dateRange"));
  if (urlParams.has("page"))
    state.currentPage = parseInt(urlParams.get("page"));
  if (urlParams.has("sortBy")) state.sortBy = urlParams.get("sortBy");
  if (urlParams.has("sortOrder")) state.sortOrder = urlParams.get("sortOrder");

  // 페이지 번호가 숫자가 아니거나 유효하지 않은 경우 기본값으로 설정
  if (isNaN(state.currentPage) || state.currentPage < 1) {
    state.currentPage = 1;
  }

  // UI 요소 상태 업데이트
  updateUIFromState();
}

// URL 업데이트
function updateURL() {
  const params = new URLSearchParams();

  if (state.dateRange !== 30) params.append("dateRange", state.dateRange);
  if (state.currentPage !== 1) params.append("page", state.currentPage);
  if (state.sortBy !== "date") params.append("sortBy", state.sortBy);
  if (state.sortOrder !== "desc") params.append("sortOrder", state.sortOrder);

  // URL 업데이트 (history API 사용)
  const url = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, "", url);
}

// UI 요소 상태 업데이트
function updateUIFromState() {
  // 날짜 범위 선택
  const dateRange = document.getElementById("dateRange");
  if (dateRange) dateRange.value = state.dateRange;

  // 정렬 버튼 업데이트
  updateSortButtonsUI();
}

// 인증 관련 함수
async function checkAuthStatus() {
  try {
    const response = await API.fetchAPI("/auth/user");
    state.isAuthenticated = !!response.user;
    updateAuthUI();
  } catch (error) {
    state.isAuthenticated = false;
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
    window.location.href = "/signinPage";
  } catch (error) {
    alert("로그아웃 중 오류가 발생했습니다.");
  }
}

// 완료된 입찰 데이터 가져오기 (서버 사이드 페이지네이션)
async function fetchCompletedBids() {
  if (!state.isAuthenticated) {
    return;
  }

  toggleLoading(true);

  try {
    // 날짜 범위 계산
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - state.dateRange);
    const fromDate = formatDate(dateLimit);

    // 서버 사이드 페이지네이션 파라미터
    const params = {
      status: "active,final,completed,cancelled", // 모든 상태
      fromDate: fromDate,
      page: state.currentPage, // 현재 페이지
      limit: state.itemsPerPage, // 페이지당 날짜 수
      sortBy: state.sortBy === "date" ? "scheduled_date" : state.sortBy,
      sortOrder: state.sortOrder,
      groupBy: "date", // 일별 그룹화 요청
    };

    // API 요청 URL 생성
    const queryString = API.createURLParams(params);

    // 통합된 결과 API 엔드포인트 호출 (백엔드에서 구현 필요)
    const results = await API.fetchAPI(`/bid-results?${queryString}`);

    // 서버에서 받은 데이터 설정
    state.dailyResults = results.dailyResults || [];
    state.totalItems = results.total || 0;
    state.totalPages = results.totalPages || 1;
    state.totalStats = results.totalStats || {
      itemCount: 0,
      totalItemCount: 0,
      japaneseAmount: 0,
      koreanAmount: 0,
      feeAmount: 0,
      vatAmount: 0,
      grandTotalAmount: 0,
    };

    // 페이지 번호 유효성 검사
    if (state.totalPages === 0) {
      state.totalPages = 1;
    }

    // 현재 페이지가 총 페이지 수를 초과하면 조정
    if (state.currentPage > state.totalPages) {
      state.currentPage = 1;
      // 첫 페이지의 데이터를 가져오기 위해 함수를 재귀적으로 호출
      return await fetchCompletedBids();
    }

    // 현재 페이지 데이터를 필터링된 결과로 설정
    state.filteredResults = [...state.dailyResults];

    // URL 업데이트
    updateURL();

    // 통계 정보 UI 업데이트
    updateTotalStatsUI();

    // 결과 표시
    displayResults();

    // 페이지네이션 업데이트
    updatePagination();

    // 정렬 버튼 UI 업데이트
    updateSortButtonsUI();
  } catch (error) {
    console.error("낙찰 데이터를 가져오는 중 오류 발생:", error);
    document.getElementById("resultsList").innerHTML =
      '<div class="no-results">데이터를 불러오는 데 실패했습니다.</div>';
  } finally {
    toggleLoading(false);
  }
}

// 총 통계 UI 업데이트
function updateTotalStatsUI() {
  // UI 업데이트
  document.getElementById("totalItemCount").textContent = `${formatNumber(
    state.totalStats.itemCount
  )}/${formatNumber(state.totalStats.totalItemCount)}`;
  document.getElementById("totalJapaneseAmount").textContent =
    formatNumber(state.totalStats.japaneseAmount) + " ¥";
  document.getElementById("totalKoreanAmount").textContent =
    formatNumber(state.totalStats.koreanAmount) + " ₩";
  document.getElementById("totalFeeAmount").textContent =
    formatNumber(state.totalStats.feeAmount) + " ₩";
  document.getElementById("totalVatAmount").textContent =
    formatNumber(state.totalStats.vatAmount) + " ₩";
  document.getElementById("grandTotalAmount").textContent =
    formatNumber(state.totalStats.grandTotalAmount) + " ₩";
}

// 이벤트 리스너 설정
function setupEventListeners() {
  // 기간 드롭다운
  document.getElementById("dateRange")?.addEventListener("change", (e) => {
    state.dateRange = parseInt(e.target.value);
  });

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
    fetchCompletedBids();
  });

  // 필터 초기화 버튼
  document.getElementById("resetFilters")?.addEventListener("click", () => {
    resetFilters();
  });

  // 로그아웃 버튼
  document
    .getElementById("signoutBtn")
    ?.addEventListener("click", handleSignout);
}

// 정렬 변경 처리
function handleSortChange(sortKey) {
  if (state.sortBy === sortKey) {
    // 같은 정렬 기준이면 정렬 방향 전환
    state.sortOrder = state.sortOrder === "asc" ? "desc" : "asc";
  } else {
    // 새로운 정렬 기준
    state.sortBy = sortKey;
    state.sortOrder = "desc"; // 기본 내림차순 (최신순, 가격 높은순, 개수 많은순)
  }

  // 첫 페이지로 돌아가기
  state.currentPage = 1;

  // 정렬 버튼 UI 업데이트
  updateSortButtonsUI();

  // 서버에서 새로운 정렬로 데이터 가져오기
  fetchCompletedBids();

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
  state.dateRange = 30;
  state.currentPage = 1;
  state.sortBy = "date";
  state.sortOrder = "desc";

  // UI 요소 초기화
  updateUIFromState();

  // 데이터 다시 로드
  fetchCompletedBids();
}

// 결과 표시
function displayResults() {
  const container = document.getElementById("resultsList");
  if (!container) return;

  container.innerHTML = "";
  const totalResultsElement = document.getElementById("totalResults");
  if (totalResultsElement) {
    totalResultsElement.textContent = state.totalItems;
  }

  if (state.filteredResults.length === 0) {
    container.innerHTML =
      '<div class="no-results">표시할 결과가 없습니다.</div>';
    return;
  }

  // 서버에서 이미 페이지네이션된 데이터를 받았으므로 모든 결과를 바로 표시
  state.filteredResults.forEach((dayResult) => {
    const dateRow = createDailyResultRow(dayResult);
    container.appendChild(dateRow);
  });
}

// 일별 결과 행 생성
function createDailyResultRow(dayResult) {
  const dateRow = document.createElement("div");
  dateRow.className = "daily-result-item";

  // 날짜 헤더
  const dateHeader = document.createElement("div");
  dateHeader.className = "date-header";

  const dateLabel = document.createElement("h3");
  dateLabel.textContent = formatDisplayDate(dayResult.date);

  const toggleButton = document.createElement("button");
  toggleButton.className = "toggle-details";
  toggleButton.innerHTML = '<i class="fas fa-chevron-down"></i>';

  dateHeader.appendChild(dateLabel);
  dateHeader.appendChild(toggleButton);

  // 요약 정보
  const summary = document.createElement("div");
  summary.className = "date-summary";
  summary.innerHTML = `
    <div class="summary-item">
      <span class="summary-label">상품 수:</span>
      <span class="summary-value">${formatNumber(
        dayResult.itemCount
      )}/${formatNumber(dayResult.totalItemCount || 0)}개</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">총액 (¥):</span>
      <span class="summary-value">${formatNumber(
        dayResult.totalJapanesePrice
      )} ¥</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">관부가세 포함 (₩):</span>
      <span class="summary-value">${formatNumber(
        dayResult.totalKoreanPrice
      )} ₩</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">수수료 (₩):</span>
      <span class="summary-value">${formatNumber(dayResult.feeAmount)} ₩</span>
      <span class="vat-note">VAT ${formatNumber(dayResult.vatAmount)} ₩</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">총액 (₩):</span>
      <span class="summary-value">${formatNumber(dayResult.grandTotal)} ₩</span>
    </div>
  `;

  // 상세 정보 (접혀있는 상태)
  const details = document.createElement("div");
  details.className = "date-details";
  details.style.display = "none";

  const detailsTable = document.createElement("table");
  detailsTable.className = "details-table";

  const tableHeader = document.createElement("thead");
  tableHeader.innerHTML = `
  <tr>
    <th>이미지</th>
    <th>브랜드</th>
    <th>상품명</th>
    <th>최종입찰금액 (¥)</th>
    <th>실제낙찰금액 (¥)</th>
    <th>관부가세 포함 (₩)</th>
  </tr>
`;
  detailsTable.appendChild(tableHeader);

  const tableBody = document.createElement("tbody");

  // 낙찰 성공 상품들 먼저 표시 (연한 초록 배경)
  dayResult.successItems?.forEach((item) => {
    const row = createItemRow(item, "success");
    tableBody.appendChild(row);
  });

  // 낙찰 실패 상품들 표시 (연한 빨간 배경)
  dayResult.failedItems?.forEach((item) => {
    const row = createItemRow(item, "failed");
    tableBody.appendChild(row);
  });

  // 집계중 상품들 표시 (기본 배경)
  dayResult.pendingItems?.forEach((item) => {
    const row = createItemRow(item, "pending");
    tableBody.appendChild(row);
  });

  detailsTable.appendChild(tableBody);

  details.appendChild(detailsTable);

  // 토글 버튼 이벤트
  toggleButton.addEventListener("click", function () {
    const isExpanded = details.style.display !== "none";
    details.style.display = isExpanded ? "none" : "block";
    this.innerHTML = isExpanded
      ? '<i class="fas fa-chevron-down"></i>'
      : '<i class="fas fa-chevron-up"></i>';
  });

  // 모두 조합
  dateRow.appendChild(dateHeader);
  dateRow.appendChild(summary);
  dateRow.appendChild(details);

  return dateRow;
}

// 상품 행 생성 함수
function createItemRow(item, status) {
  const row = document.createElement("tr");
  row.classList.add(`bid-${status}`); // CSS 클래스 추가

  // 이미지 셀
  const imageCell = document.createElement("td");
  if (item.image && item.image !== "/images/placeholder.png") {
    const imageElement = document.createElement("img");
    imageElement.src = item.image;
    imageElement.alt = item.item?.title || "상품 이미지";
    imageElement.classList.add("product-thumbnail");
    imageElement.onerror = function () {
      const placeholder = document.createElement("div");
      placeholder.className = "product-thumbnail-placeholder";
      placeholder.textContent = "No Image";
      this.parentNode.replaceChild(placeholder, this);
    };
    imageCell.appendChild(imageElement);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "product-thumbnail-placeholder";
    placeholder.textContent = "No Image";
    imageCell.appendChild(placeholder);
  }

  const brandCell = document.createElement("td");
  brandCell.textContent = item.item?.brand || "-";

  const titleCell = document.createElement("td");
  titleCell.textContent = item.item?.title || "제목 없음";

  const finalPriceCell = document.createElement("td");
  finalPriceCell.textContent = `${formatNumber(item.finalPrice)} ¥`;

  const winningPriceCell = document.createElement("td");
  if (status === "pending") {
    winningPriceCell.textContent = "집계중";
    winningPriceCell.classList.add("pending-text");
  } else {
    winningPriceCell.textContent = `${formatNumber(item.winningPrice)} ¥`;
  }

  const koreanCell = document.createElement("td");
  if (status === "success") {
    koreanCell.textContent = `${formatNumber(item.koreanPrice)} ₩`;
  } else if (status === "failed") {
    koreanCell.textContent = `${formatNumber(item.koreanPrice)} ₩`;
  } else {
    koreanCell.textContent = "-";
  }

  row.appendChild(imageCell);
  row.appendChild(brandCell);
  row.appendChild(titleCell);
  row.appendChild(finalPriceCell);
  row.appendChild(winningPriceCell);
  row.appendChild(koreanCell);

  return row;
}

// 표시용 날짜 포맷
function formatDisplayDate(dateStr) {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];

  return `${year}년 ${month}월 ${day}일 (${weekday})`;
}

// 페이지네이션 업데이트
function updatePagination() {
  createPagination(state.currentPage, state.totalPages, handlePageChange);
}

// 페이지 변경 처리 (서버 사이드)
async function handlePageChange(page) {
  page = parseInt(page, 10);

  if (page === state.currentPage || page < 1 || page > state.totalPages) {
    return;
  }

  // 상태 업데이트
  state.currentPage = page;

  // 서버에서 새 페이지의 데이터 가져오기
  await fetchCompletedBids();

  // 페이지 상단으로 스크롤
  window.scrollTo(0, 0);
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

// 상품 상태 분류 함수 (서버에서 이미 분류된 상태로 받지만 클라이언트 예비용)
function classifyBidStatus(item) {
  const finalPrice =
    item.type === "direct"
      ? Number(item.current_price || 0)
      : Number(item.final_price || 0);
  const winningPrice = Number(item.winning_price || 0);

  if (!item.winning_price || winningPrice === 0) {
    return { status: "pending", finalPrice, winningPrice: null };
  }

  if (finalPrice === winningPrice) {
    return { status: "success", finalPrice, winningPrice };
  } else {
    return { status: "failed", finalPrice, winningPrice };
  }
}

// DOM 완료 시 실행
document.addEventListener("DOMContentLoaded", initialize);
