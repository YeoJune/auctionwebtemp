// public/js/bid-results.js

const MINIMUM_FEE = 10000; // 최소 수수료 (₩)

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
    appraisalFee: 0, // 추가
    appraisalVat: 0, // 추가
    appraisalCount: 0, // 추가
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
      status: "active,final,completed,cancelled", // 모든 상태
      fromDate: fromDate,
      sortBy: "scheduled_date", // scheduled_date로 변경
      sortOrder: "desc",
      limit: 0, // 모든 데이터 가져오기
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

// 결합된 결과를 일별로 그룹화하는 함수
function groupResultsByDate() {
  const groupedByDate = {};

  state.combinedResults.forEach((item) => {
    const dateStr = formatDate(item.item?.scheduled_date);

    if (!groupedByDate[dateStr]) {
      groupedByDate[dateStr] = {
        date: dateStr,
        successItems: [],
        failedItems: [],
        pendingItems: [],
        itemCount: 0,
        totalJapanesePrice: 0,
        totalKoreanPrice: 0,
      };
    }

    // 상품 상태 분류
    const bidStatus = classifyBidStatus(item);

    // 이미지 경로 처리
    let imagePath = "/images/placeholder.png";
    if (item.item && item.item.image) {
      imagePath = item.item.image;
    }

    const itemData = {
      ...item,
      finalPrice: bidStatus.finalPrice,
      winningPrice: bidStatus.winningPrice,
      image: imagePath,
      appr_id: item.appr_id, // appr_id 추가
    };

    // 상태별로 분류
    if (bidStatus.status === "success") {
      const koreanPrice = Number(
        calculateTotalPrice(
          bidStatus.winningPrice,
          item.item?.auc_num || 1,
          item.item?.category || "기타"
        )
      );
      itemData.koreanPrice = koreanPrice;

      groupedByDate[dateStr].successItems.push(itemData);
      groupedByDate[dateStr].itemCount += 1;
      groupedByDate[dateStr].totalJapanesePrice += bidStatus.winningPrice;
      groupedByDate[dateStr].totalKoreanPrice += koreanPrice;
    } else if (bidStatus.status === "failed") {
      const koreanPrice = Number(
        calculateTotalPrice(
          bidStatus.winningPrice,
          item.item?.auc_num || 1,
          item.item?.category || "기타"
        )
      );
      itemData.koreanPrice = koreanPrice;
      groupedByDate[dateStr].failedItems.push(itemData);
    } else {
      groupedByDate[dateStr].pendingItems.push(itemData);
    }
  });

  // 객체를 배열로 변환
  state.dailyResults = Object.values(groupedByDate);

  // 각 날짜별 totalItemCount 계산
  state.dailyResults.forEach((day) => {
    day.totalItemCount =
      day.successItems.length +
      day.failedItems.length +
      day.pendingItems.length;

    // 일별 수수료 계산 (성공한 상품만)
    const calculatedFee = calculateFee(day.totalKoreanPrice);

    // 성공한 상품이 있는 경우만 최소 수수료 적용
    if (day.itemCount > 0) {
      day.feeAmount = Math.max(calculatedFee, MINIMUM_FEE);
    } else {
      day.feeAmount = 0; // 성공한 상품이 없으면 수수료 없음
    }

    day.vatAmount = Math.round((day.feeAmount / 1.1) * 0.1);

    // 일별 감정서 수수료 계산
    let dailyAppraisalCount = 0;
    day.successItems.forEach((item) => {
      if (item.appr_id) {
        dailyAppraisalCount++;
      }
    });

    day.appraisalFee = dailyAppraisalCount * 16500;
    day.appraisalVat = Math.round(day.appraisalFee / 11);
    day.appraisalCount = dailyAppraisalCount;

    // 총액에 감정서 수수료 포함
    day.grandTotal = day.totalKoreanPrice + day.feeAmount + day.appraisalFee;
  });

  sortDailyResults();
  updateTotalStats();
}

// 총 통계 업데이트 함수
function updateTotalStats() {
  state.totalStats = {
    itemCount: 0,
    totalItemCount: 0,
    japaneseAmount: 0,
    koreanAmount: 0,
    feeAmount: 0,
    vatAmount: 0,
    grandTotalAmount: 0,
    appraisalFee: 0,
    appraisalVat: 0,
    appraisalCount: 0,
  };

  // 기존 통계 계산
  state.dailyResults.forEach((day) => {
    state.totalStats.itemCount += Number(day.itemCount);
    state.totalStats.totalItemCount += Number(day.totalItemCount || 0);
    state.totalStats.japaneseAmount += Number(day.totalJapanesePrice);
    state.totalStats.koreanAmount += Number(day.totalKoreanPrice);
    state.totalStats.feeAmount += Number(day.feeAmount);
    state.totalStats.vatAmount += Number(day.vatAmount);
    state.totalStats.appraisalFee += Number(day.appraisalFee || 0);
    state.totalStats.appraisalVat += Number(day.appraisalVat || 0);
    state.totalStats.appraisalCount += Number(day.appraisalCount || 0);
    state.totalStats.grandTotalAmount += Number(day.grandTotal);
  });

  // 감정서 수수료 계산
  let appraisalCount = 0;
  state.dailyResults.forEach((day) => {
    day.successItems.forEach((item) => {
      if (item.appr_id) {
        appraisalCount++;
      }
    });
  });

  const appraisalFee = appraisalCount * 16500; // VAT 포함 16,500원
  const appraisalVat = Math.round(appraisalFee / 11); // VAT 부분 (16500/11 = 1500)

  state.totalStats.appraisalFee = appraisalFee;
  state.totalStats.appraisalVat = appraisalVat;
  state.totalStats.appraisalCount = appraisalCount;
  state.totalStats.grandTotalAmount += appraisalFee;

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

  // 감정서 수수료 UI 업데이트
  document.getElementById("totalAppraisalFee").textContent =
    formatNumber(state.totalStats.appraisalFee) + " ₩";
  document.getElementById("totalAppraisalVat").textContent =
    formatNumber(state.totalStats.appraisalVat) + " ₩";

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
      <span class="summary-label">감정서 수수료 (₩):</span>
      <span class="summary-value">${formatNumber(
        dayResult.appraisalFee || 0
      )} ₩</span>
      <span class="vat-note">VAT ${formatNumber(
        dayResult.appraisalVat || 0
      )} ₩</span>
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
    <th>감정서</th>
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
  row.classList.add(`bid-${status}`);

  // 기존 셀들 생성
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

  // 감정서 셀 추가
  const appraisalCell = document.createElement("td");
  if (status === "success") {
    const appraisalBtn = createAppraisalButton(item);
    appraisalCell.appendChild(appraisalBtn);
  } else {
    appraisalCell.textContent = "-";
  }

  row.appendChild(imageCell);
  row.appendChild(brandCell);
  row.appendChild(titleCell);
  row.appendChild(finalPriceCell);
  row.appendChild(winningPriceCell);
  row.appendChild(koreanCell);
  row.appendChild(appraisalCell);

  return row;
}

function createAppraisalButton(item) {
  const button = document.createElement("button");
  button.className = "appraisal-btn small-button";

  if (item.appr_id) {
    button.textContent = "요청 완료";
    button.classList.add("success-button");
    button.onclick = () => {};
  } else {
    button.textContent = "감정서 신청";
    button.classList.add("primary-button");
    button.onclick = () => requestAppraisal(item);
  }

  return button;
}

async function requestAppraisal(item) {
  if (
    confirm(
      "감정서를 신청하시겠습니까?\n수수료 16,500원(VAT포함)이 추가됩니다."
    )
  ) {
    try {
      toggleLoading(true);
      const endpoint = item.type === "direct" ? "direct-bids" : "live-bids";
      const response = await API.fetchAPI(
        `/${endpoint}/${item.id}/request-appraisal`,
        {
          method: "POST",
        }
      );

      if (response.message) {
        alert("감정서 신청이 완료되었습니다.");
        await fetchCompletedBids();
      }
    } catch (error) {
      console.error("감정서 신청 중 오류:", error);
      alert("감정서 신청 중 오류가 발생했습니다.");
    } finally {
      toggleLoading(false);
    }
  }
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

// 상품 상태 분류 함수
function classifyBidStatus(item) {
  const finalPrice =
    item.type === "direct"
      ? Number(item.current_price || 0)
      : Number(item.final_price || 0);
  const winningPrice = Number(item.winning_price || 0);

  if (!item.winning_price || winningPrice === 0) {
    return { status: "pending", finalPrice, winningPrice: null };
  }

  if (finalPrice >= winningPrice) {
    return { status: "success", finalPrice, winningPrice };
  } else {
    return { status: "failed", finalPrice, winningPrice };
  }
}

// DOM 완료 시 실행
document.addEventListener("DOMContentLoaded", initialize);
