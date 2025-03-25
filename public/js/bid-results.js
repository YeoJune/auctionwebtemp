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
    japaneseAmount: 0,
    koreanAmount: 0,
    feeAmount: 0,
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

// 완료된 입찰 데이터 가져오기
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

    // 정렬 및 페이지네이션 파라미터
    const params = {
      status: "completed", // 완료된 입찰만 가져옴
      fromDate: fromDate,
      sortBy: "updated_at", // 백엔드에서는 updated_at으로 정렬
      sortOrder: "desc",
    };

    // API 요청 URL 생성
    const queryString = API.createURLParams(params);

    // 경매 타입에 관계없이 모든 데이터 가져오기
    const [liveResults, directResults] = await Promise.all([
      API.fetchAPI(`/live-bids?${queryString}`),
      API.fetchAPI(`/direct-bids?${queryString}`),
    ]);

    // 결합 및 타입 정보 추가
    const liveBids = liveResults.bids || [];
    const directBids = directResults.bids || [];

    const liveBidsWithType = liveBids
      .filter((bid) => bid)
      .map((bid) => ({
        ...bid,
        type: "live",
      }));

    const directBidsWithType = directBids
      .filter((bid) => bid)
      .map((bid) => ({
        ...bid,
        type: "direct",
      }));

    state.combinedResults = [...liveBidsWithType, ...directBidsWithType];

    // 일별로 그룹화
    groupResultsByDate();

    // URL 업데이트
    updateURL();

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

// 결과를 일별로 그룹화
function groupResultsByDate() {
  // 날짜별로 그룹화
  const groupedByDate = {};

  state.combinedResults.forEach((item) => {
    // 날짜만 추출 (시간 제외)
    const dateStr = formatDate(item.updated_at);

    if (!groupedByDate[dateStr]) {
      groupedByDate[dateStr] = {
        date: dateStr,
        items: [],
        itemCount: 0,
        totalJapanesePrice: 0,
        totalKoreanPrice: 0,
      };
    }

    // 가격 정보 계산 - 숫자형으로 확실하게 변환
    let japanesePrice = 0;
    if (item.type === "direct") {
      japanesePrice = Number(item.current_price || 0);
    } else {
      japanesePrice = Number(item.final_price || 0);
    }

    // 원화 가격 계산 (관부가세 포함)
    const product = item.item || {};
    const auctionId = product.auc_num || 1;
    const category = product.category || "기타";
    const koreanPrice = Number(
      calculateTotalPrice(japanesePrice, auctionId, category)
    );

    // 이미지 경로 처리
    let imagePath = "/images/placeholder.png";
    if (product && product.image) {
      // 상대 경로는 그대로 사용, 절대 경로는 도메인 추가 필요 없음
      imagePath = product.image;
    }

    // 그룹에 아이템 추가
    groupedByDate[dateStr].items.push({
      ...item,
      japanesePrice,
      koreanPrice,
      image: imagePath,
    });

    // 합계 업데이트 - 숫자형으로 확실하게 합산
    groupedByDate[dateStr].itemCount += 1;
    groupedByDate[dateStr].totalJapanesePrice += japanesePrice;
    groupedByDate[dateStr].totalKoreanPrice += koreanPrice;
  });

  // 객체를 배열로 변환
  state.dailyResults = Object.values(groupedByDate);

  // 일별 수수료 계산 추가
  state.dailyResults.forEach((day) => {
    day.feeAmount = calculateFee(day.totalKoreanPrice);
    day.grandTotal = day.totalKoreanPrice + day.feeAmount;
  });

  // 정렬 적용
  sortDailyResults();

  // 총 통계 업데이트
  updateTotalStats();
}

// 총 통계 업데이트
function updateTotalStats() {
  state.totalStats = {
    itemCount: 0,
    japaneseAmount: 0,
    koreanAmount: 0,
    feeAmount: 0,
    grandTotalAmount: 0,
  };

  state.dailyResults.forEach((day) => {
    state.totalStats.itemCount += Number(day.itemCount);
    state.totalStats.japaneseAmount += Number(day.totalJapanesePrice);
    state.totalStats.koreanAmount += Number(day.totalKoreanPrice);
    state.totalStats.feeAmount += Number(day.feeAmount);
    state.totalStats.grandTotalAmount += Number(day.grandTotal);
  });

  // UI 업데이트
  document.getElementById("totalItemCount").textContent = formatNumber(
    state.totalStats.itemCount
  );
  document.getElementById("totalJapaneseAmount").textContent =
    formatNumber(state.totalStats.japaneseAmount) + " ¥";
  document.getElementById("totalKoreanAmount").textContent =
    formatNumber(state.totalStats.koreanAmount) + " ₩";
  document.getElementById("totalFeeAmount").textContent =
    formatNumber(state.totalStats.feeAmount) + " ₩";
  document.getElementById("grandTotalAmount").textContent =
    formatNumber(state.totalStats.grandTotalAmount) + " ₩";
}

// 일별 결과 정렬
function sortDailyResults() {
  state.dailyResults.sort((a, b) => {
    let valueA, valueB;

    // 정렬 기준에 따른 값 추출
    switch (state.sortBy) {
      case "date":
        valueA = new Date(a.date);
        valueB = new Date(b.date);
        break;
      case "total_price":
        valueA = a.grandTotal;
        valueB = b.grandTotal;
        break;
      case "item_count":
        valueA = a.itemCount;
        valueB = b.itemCount;
        break;
      default:
        valueA = new Date(a.date);
        valueB = new Date(b.date);
        break;
    }

    // 정렬 방향 적용
    const direction = state.sortOrder === "asc" ? 1 : -1;
    return direction * (valueA - valueB);
  });

  // 필터링된 결과 업데이트
  state.filteredResults = [...state.dailyResults];
  state.totalItems = state.filteredResults.length;
  state.totalPages = Math.ceil(state.totalItems / state.itemsPerPage);
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

  // 정렬 버튼 UI 업데이트
  updateSortButtonsUI();

  // 정렬 적용
  sortDailyResults();
  displayResults();

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

  // 현재 페이지에 해당하는 결과만 표시
  const startIdx = (state.currentPage - 1) * state.itemsPerPage;
  const endIdx = Math.min(
    startIdx + state.itemsPerPage,
    state.filteredResults.length
  );

  for (let i = startIdx; i < endIdx; i++) {
    const dayResult = state.filteredResults[i];
    const dateRow = createDailyResultRow(dayResult);
    container.appendChild(dateRow);
  }
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
      <span class="summary-value">${formatNumber(dayResult.itemCount)}개</span>
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

  // 상세 내용 표 생성
  const detailsTable = document.createElement("table");
  detailsTable.className = "details-table";

  // 테이블 헤더 생성
  const tableHeader = document.createElement("thead");
  tableHeader.innerHTML = `
    <tr>
      <th>이미지</th>
      <th>브랜드</th>
      <th>상품명</th>
      <th>금액 (¥)</th>
      <th>금액 (₩)</th>
    </tr>
  `;
  detailsTable.appendChild(tableHeader);

  // 테이블 본문 생성
  const tableBody = document.createElement("tbody");
  dayResult.items.forEach((item) => {
    const row = document.createElement("tr");

    // 이미지 셀
    const imageCell = document.createElement("td");

    // 이미지가 있는 경우에만 이미지 요소 생성
    if (item.image && item.image !== "/images/placeholder.png") {
      const imageElement = document.createElement("img");
      imageElement.src = item.image;
      imageElement.alt = item.item?.original_title || "상품 이미지";
      imageElement.classList.add("product-thumbnail");

      // 이미지 로드 오류 시 텍스트로 대체하고 다시 로드 시도하지 않음
      imageElement.onerror = function () {
        const placeholder = document.createElement("div");
        placeholder.className = "product-thumbnail-placeholder";
        placeholder.textContent = "No Image";
        this.parentNode.replaceChild(placeholder, this);
      };

      imageCell.appendChild(imageElement);
    } else {
      // 이미지 없는 경우 텍스트 플레이스홀더 표시
      const placeholder = document.createElement("div");
      placeholder.className = "product-thumbnail-placeholder";
      placeholder.textContent = "No Image";
      imageCell.appendChild(placeholder);
    }

    const brandCell = document.createElement("td");
    brandCell.textContent = item.item?.brand || "-";

    const titleCell = document.createElement("td");
    titleCell.textContent = item.item?.original_title || "제목 없음";

    const japaneseCell = document.createElement("td");
    japaneseCell.textContent = `${formatNumber(item.japanesePrice)} ¥`;

    const koreanCell = document.createElement("td");
    koreanCell.textContent = `${formatNumber(item.koreanPrice)} ₩`;

    row.appendChild(imageCell);
    row.appendChild(brandCell);
    row.appendChild(titleCell);
    row.appendChild(japaneseCell);
    row.appendChild(koreanCell);

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

// 페이지 변경 처리
function handlePageChange(page) {
  page = parseInt(page, 10);

  if (page === state.currentPage) return;

  state.currentPage = page;
  displayResults();
  window.scrollTo(0, 0);
  updateURL();
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

// DOM 완료 시 실행
document.addEventListener("DOMContentLoaded", initialize);
