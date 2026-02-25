// public/js/admin/live-bids.js

// HTML 이스케이프 함수
function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

const LIVE_STATUS_LABELS = {
  first: "1차 입찰",
  second: "2차 제안",
  final: "최종 입찰",
  completed: "완료",
  domestic_arrived: "국내도착",
  processing: "작업중",
  shipped: "출고됨",
  cancelled: "낙찰 실패",
};

// shipping_status 값 (bid.status가 아닌 별도 필드로 전달해야 함)
const LIVE_SHIPPING_STATUSES = new Set([
  "domestic_arrived",
  "processing",
  "shipped",
]);

/**
 * 상태 값에 따라 올바른 API body 필드를 결정한다.
 * shipping_status 값이면 { shipping_status: value }로,
 * bid status 값이면 { status: value }로 반환한다.
 */
function buildLiveBidUpdate(valueOrObj) {
  if (typeof valueOrObj === "object" && valueOrObj !== null) {
    return valueOrObj;
  }
  if (LIVE_SHIPPING_STATUSES.has(valueOrObj)) {
    return { shipping_status: valueOrObj };
  }
  return { status: valueOrObj };
}

const LIVE_NEXT_STATUS = {
  completed: "domestic_arrived",
  domestic_arrived: "processing",
  processing: "shipped",
};

const LIVE_PREV_STATUS = {
  domestic_arrived: "completed",
};

const LIVE_WORKFLOW_STATUSES = [
  "completed",
  "domestic_arrived",
  "processing",
  "shipped",
];
const LIVE_ZONE_SUMMARY_VISIBLE_STATUSES = new Set([
  "domestic_arrived",
  "processing",
]);

function getLiveNextStatus(status) {
  return LIVE_NEXT_STATUS[status] || null;
}

function getLivePrevStatus(status) {
  return LIVE_PREV_STATUS[status] || null;
}

function getLiveStatusLabel(status) {
  return LIVE_STATUS_LABELS[status] || status;
}

function getLiveWorkflowStatusOptionsHtml(currentStatus) {
  return LIVE_WORKFLOW_STATUSES.map(
    (status) =>
      `<option value="${status}"${
        status === currentStatus ? " selected" : ""
      }>${getLiveStatusLabel(status)}</option>`,
  ).join("");
}

function getLiveZoneDisplayNameByCode(code) {
  const map = {
    DOMESTIC_ARRIVAL_ZONE: "국내도착존",
    REPAIR_TEAM_CHECK_ZONE: "수선팀검수중존",
    INTERNAL_REPAIR_ZONE: "내부수선존",
    EXTERNAL_REPAIR_ZONE: "외부수선존",
    REPAIR_DONE_ZONE: "수선완료존",
    AUTH_ZONE: "감정출력존",
    HOLD_ZONE: "HOLD존",
    OUTBOUND_ZONE: "출고존",
    REPAIR_ZONE: "수선존",
    INSPECT_ZONE: "검수존",
    SHIPPED_ZONE: "출고존",
  };
  return map[code] || "";
}

function getLiveProcessingStatusLabel(bid) {
  const zoneName = getLiveZoneDisplayNameByCode(bid.wms_location_code);
  if (zoneName) return `작업중(${zoneName})`;
  return "작업중";
}

function renderProcessingZoneSummary(bids) {
  const wrap = document.getElementById("processingZoneSummary");
  const grid = document.getElementById("processingZoneGrid");
  const title = wrap?.querySelector(".title");
  if (!wrap || !grid) return;

  if (!LIVE_ZONE_SUMMARY_VISIBLE_STATUSES.has(currentStatus)) {
    currentProcessingZoneCode = "";
    wrap.style.display = "none";
    grid.innerHTML = "";
    return;
  }

  if (title) {
    const label = currentStatus ? getLiveStatusLabel(currentStatus) : "전체";
    title.textContent = `${label} 존별 현황`;
  }

  const zoneCountMap = (bids || []).reduce((acc, bid) => {
    const code = bid.wms_location_code || "UNKNOWN_ZONE";
    acc[code] = (acc[code] || 0) + 1;
    return acc;
  }, {});

  const entries = Object.entries(zoneCountMap).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    wrap.style.display = "block";
    grid.innerHTML = `<div class="processing-zone-item"><div class="name">존 데이터 없음</div><div class="count">0</div></div>`;
    return;
  }

  const totalCount = entries.reduce((sum, [, count]) => sum + count, 0);
  const allCard = `<div class="processing-zone-item ${
    !currentProcessingZoneCode ? "is-active" : ""
  }" data-zone-code=""><div class="name">전체</div><div class="count">${totalCount}</div></div>`;
  const zoneCards = entries
    .map(([code, count]) => {
      const zoneName =
        code === "UNKNOWN_ZONE"
          ? "존 미지정"
          : getLiveZoneDisplayNameByCode(code) || code;
      return `<div class="processing-zone-item ${
        currentProcessingZoneCode === code ? "is-active" : ""
      }" data-zone-code="${code}"><div class="name">${zoneName}</div><div class="count">${count}</div></div>`;
    })
    .join("");
  grid.innerHTML = allCard + zoneCards;
  grid
    .querySelectorAll(".processing-zone-item[data-zone-code]")
    .forEach((el) => {
      el.addEventListener("click", () => {
        currentProcessingZoneCode = el.dataset.zoneCode || "";
        updateURLState();
        renderProcessingZoneSummary(currentLiveBidsData);
        renderLiveBidsTable(filterLiveBidsByZone(currentLiveBidsData));
      });
    });
  wrap.style.display = "block";
}

// 현재 선택된 필터 상태 - URL로 관리
let currentStatus = "";
let currentPage = 1;
let itemsPerPage = 100;
let totalPages = 1;
let currentSortBy = "original_scheduled_date";
let currentSortOrder = "desc";
let fromDate = "";
let toDate = "";
let currentFirstDate = "";
let currentSearch = "";
let currentAucNum = "";
let currentProcessingZoneCode = "";
let currentLiveBidsData = [];
let liveDetailImages = [];
let liveDetailImageIndex = 0;

// 검색 디바운스 타이머
let searchTimeout = null;

// URL 상태 관리자
const urlStateManager = window.URLStateManager;

// 기본 상태 정의
const defaultState = {
  page: 1,
  sort: "original_scheduled_date",
  order: "desc",
  firstDate: "",
  search: "",
  status: "",
  aucNum: "",
  zone: "",
};

// URL에서 상태 복원
function initializeFromURL() {
  const stateKeys = [
    "page",
    "sort",
    "order",
    "firstDate",
    "search",
    "status",
    "aucNum",
    "zone",
  ];
  const state = urlStateManager.loadFromURL(defaultState, stateKeys);

  currentPage = state.page;
  currentSortBy = state.sort;
  currentSortOrder = state.order;
  currentFirstDate = state.firstDate;
  currentSearch = state.search;
  currentStatus = state.status;
  currentAucNum = state.aucNum;
  currentProcessingZoneCode = state.zone;

  updateUIFromState();
}

// URL 상태 업데이트
function updateURLState() {
  const state = {
    page: currentPage,
    sort: currentSortBy,
    order: currentSortOrder,
    firstDate: currentFirstDate,
    search: currentSearch,
    status: currentStatus,
    aucNum: currentAucNum,
    zone: currentProcessingZoneCode,
  };

  urlStateManager.updateURL(state, defaultState);
} // UI를 현재 상태로 업데이트
function updateUIFromState() {
  const searchInput = document.getElementById("searchInput");
  const sortBySelect = document.getElementById("sortBy");
  const statusButtons = document.querySelectorAll(".filter-tab");
  const aucNumButtons = document.querySelectorAll(".auc-num-filter");
  const firstDateFilter = document.getElementById("firstDateFilter");

  if (searchInput) searchInput.value = currentSearch;
  if (sortBySelect) sortBySelect.value = currentSortBy;
  if (firstDateFilter) firstDateFilter.value = currentFirstDate || "";

  statusButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.status === currentStatus);
  });

  aucNumButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.aucNum === currentAucNum);
  });

  updateBulkShipButtonLabel();
}

function normalizeDateKey(value) {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatMonthDay(dateKey) {
  const parts = String(dateKey || "").split("-");
  if (parts.length !== 3) return dateKey;
  return `${parts[1]}-${parts[2]}`;
}

function toggleFirstDateFilterVisibility() {
  const group = document.getElementById("firstDateFilterGroup");
  if (!group) return;
  group.style.display = currentStatus === "first" ? "block" : "none";
}

async function refreshFirstDateFilterOptions() {
  const select = document.getElementById("firstDateFilter");
  if (!select) return;
  toggleFirstDateFilterVisibility();
  if (currentStatus !== "first") return;

  try {
    const response = await fetchLiveBids(
      "first",
      1,
      0,
      "original_scheduled_date",
      "asc",
      "",
      "",
      currentSearch,
      currentAucNum,
    );
    const bids = Array.isArray(response?.bids) ? response.bids : [];
    const map = bids.reduce((acc, bid) => {
      const dateKey = normalizeDateKey(
        bid.item?.original_scheduled_date || bid.item?.scheduled_date,
      );
      if (!dateKey) return acc;
      acc[dateKey] = (acc[dateKey] || 0) + 1;
      return acc;
    }, {});
    const options = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
    select.innerHTML = [
      '<option value="">전체</option>',
      ...options.map(
        ([dateKey, count]) =>
          `<option value="${dateKey}">${formatMonthDay(dateKey)} (${count})</option>`,
      ),
    ].join("");
    if (currentFirstDate && map[currentFirstDate]) {
      select.value = currentFirstDate;
    } else {
      currentFirstDate = "";
      select.value = "";
    }
  } catch (error) {
    console.error("1차 예정일 옵션 로드 실패:", error);
  }
}

// 페이지 로드 시 실행
document.addEventListener("DOMContentLoaded", function () {
  // URL에서 상태 복원
  initializeFromURL();
  toggleFirstDateFilterVisibility();
  if (currentFirstDate) {
    fromDate = currentFirstDate;
    toDate = currentFirstDate;
    document.getElementById("fromDate").value = currentFirstDate;
    document.getElementById("toDate").value = currentFirstDate;
  }

  // 초기 데이터 로드
  loadLiveBids();
  refreshFirstDateFilterOptions();

  // 브라우저 뒤로가기/앞으로가기 처리
  window.addEventListener("popstate", function () {
    initializeFromURL();
    loadLiveBids();
  });

  // 검색 관련 이벤트
  document
    .getElementById("searchInput")
    .addEventListener("input", handleSearchInput);
  document
    .getElementById("searchBtn")
    .addEventListener("click", handleSearchSubmit);
  document
    .getElementById("clearSearchBtn")
    .addEventListener("click", handleSearchClear);

  // 정렬 변경 이벤트
  const sortBySelect = document.getElementById("sortBy");
  if (sortBySelect) {
    sortBySelect.addEventListener("change", function () {
      currentSortBy = this.value;
      currentSortOrder = "desc";
      currentPage = 1;
      updateURLState();
      loadLiveBids();
    });
  }

  // 필터 탭 이벤트
  const statusButtons = document.querySelectorAll(".filter-tab");
  statusButtons.forEach((button) => {
    button.addEventListener("click", function () {
      const status = this.dataset.status;
      currentStatus = status;
      if (currentStatus !== "first") {
        currentFirstDate = "";
        const firstDateFilter = document.getElementById("firstDateFilter");
        if (firstDateFilter) firstDateFilter.value = "";
      }
      updateBulkShipButtonLabel();
      currentPage = 1;
      updateURLState();
      loadLiveBids();
      refreshFirstDateFilterOptions();
    });
  });

  // 경매장 필터 이벤트
  const aucNumButtons = document.querySelectorAll(".auc-num-filter");
  aucNumButtons.forEach((button) => {
    button.addEventListener("click", function () {
      const aucNum = this.dataset.aucNum;
      if (currentAucNum === aucNum) {
        currentAucNum = "";
        this.classList.remove("active");
      } else {
        currentAucNum = aucNum;
        aucNumButtons.forEach((btn) => btn.classList.remove("active"));
        this.classList.add("active");
      }
      currentPage = 1;
      updateURLState();
      loadLiveBids();
      refreshFirstDateFilterOptions();
    });
  });

  document.getElementById("firstDateFilter")?.addEventListener("change", function () {
    currentFirstDate = this.value || "";
    if (currentFirstDate) {
      fromDate = currentFirstDate;
      toDate = currentFirstDate;
      document.getElementById("fromDate").value = currentFirstDate;
      document.getElementById("toDate").value = currentFirstDate;
    } else {
      fromDate = "";
      toDate = "";
      document.getElementById("fromDate").value = "";
      document.getElementById("toDate").value = "";
    }
    currentPage = 1;
    updateURLState();
    loadLiveBids();
  });

  // 빠른 날짜 필터 이벤트
  document.querySelectorAll("[data-range]").forEach((button) => {
    button.addEventListener("click", function (e) {
      const result = handleQuickDateFilter.call(this, e);
      updateURLState();
      return result;
    });
  });

  // 2차 제안가 제안 모달 제출 버튼
  document
    .getElementById("submitSecondPrice")
    .addEventListener("click", submitSecondPrice);

  // 입찰 완료 모달 제출 버튼
  document
    .getElementById("submitComplete")
    .addEventListener("click", submitCompleteBid);

  // 낙찰 실패 모달 제출 버튼
  document
    .getElementById("submitCancel")
    .addEventListener("click", submitCancelBid);

  // 일괄 작업 이벤트 (완료/낙찰실패는 토글에서 선택 후 일괄 변경으로 처리)
  document
    .getElementById("bulkShipBtn")
    ?.addEventListener("click", function () {
      const target = document.getElementById("bulkStatusTarget")?.value;
      const isWorkflowContext = LIVE_WORKFLOW_STATUSES.includes(currentStatus);

      if (isWorkflowContext) {
        if (!LIVE_WORKFLOW_STATUSES.includes(target)) {
          showAlert("작업흐름 상태에서는 완료/국내도착/작업중/출고됨만 선택 가능합니다.");
          return;
        }
        bulkMarkAsShipped();
        return;
      }

      if (target === "cancelled") {
        openBulkCancelModal();
        return;
      }
      if (target === "completed") {
        openBulkCompleteModal();
        return;
      }
      showAlert("선택한 상태에서는 일괄 처리를 지원하지 않습니다.");
    });

  // 일괄 작업 모달 제출 버튼
  document
    .getElementById("submitBulkComplete")
    .addEventListener("click", submitBulkComplete);
  document
    .getElementById("submitBulkCancel")
    .addEventListener("click", submitBulkCancel);

  // 낙찰 금액 입력 시 관부가세 포함 가격 업데이트
  document
    .getElementById("winningPrice")
    .addEventListener("input", updateWinningPriceKRW);
  document
    .getElementById("bulkWinningPrice")
    .addEventListener("input", updateBulkWinningPriceKRW);

  // 페이지 크기 변경 이벤트
  document.getElementById("pageSize")?.addEventListener("change", function () {
    itemsPerPage = parseInt(this.value);
    currentPage = 1;
    loadLiveBids();
  });

  document
    .getElementById("aucNumFilter")
    ?.addEventListener("change", function () {
      currentAucNum = this.value;
      currentPage = 1;
      loadLiveBids();
      refreshFirstDateFilterOptions();
    });

  // 정렬 옵션 변경 이벤트
  document.getElementById("sortBy")?.addEventListener("change", function () {
    currentSortBy = this.value;
    currentPage = 1;
    loadLiveBids();
  });

  // 정렬 방향 변경 이벤트
  document.getElementById("sortOrder")?.addEventListener("change", function () {
    currentSortOrder = this.value;
    currentPage = 1;
    loadLiveBids();
  });

  // 날짜 필터 적용 버튼 이벤트
  document
    .getElementById("applyDateFilter")
    ?.addEventListener("click", function () {
      fromDate = document.getElementById("fromDate").value;
      toDate = document.getElementById("toDate").value;
      currentFirstDate = "";
      const firstDateFilter = document.getElementById("firstDateFilter");
      if (firstDateFilter) firstDateFilter.value = "";
      currentPage = 1;
      document
        .querySelectorAll("[data-range]")
        .forEach((b) => b.classList.remove("active"));
      loadLiveBids();
    });

  // 날짜 필터 초기화 버튼 이벤트
  document
    .getElementById("resetDateFilter")
    ?.addEventListener("click", function () {
      document.getElementById("fromDate").value = "";
      document.getElementById("toDate").value = "";
      fromDate = "";
      toDate = "";
      currentFirstDate = "";
      const firstDateFilter = document.getElementById("firstDateFilter");
      if (firstDateFilter) firstDateFilter.value = "";
      currentPage = 1;
      document
        .querySelectorAll("[data-range]")
        .forEach((b) => b.classList.remove("active"));
      loadLiveBids();
    });

  document
    .getElementById("submitEditBid")
    ?.addEventListener("click", submitEditBid);
});

// 검색 관련 함수들
function handleSearchInput() {
  const searchValue = document.getElementById("searchInput").value.trim();

  // 디바운스 적용 (300ms 후 검색 실행)
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    if (currentSearch !== searchValue) {
      currentSearch = searchValue;
      currentPage = 1;
      updateURLState();
      loadLiveBids();
      refreshFirstDateFilterOptions();
    }
  }, 300);
}

function handleSearchSubmit() {
  const searchValue = document.getElementById("searchInput").value.trim();
  if (currentSearch !== searchValue) {
    currentSearch = searchValue;
    currentPage = 1;
    updateURLState();
    loadLiveBids();
    refreshFirstDateFilterOptions();
  }
}

function handleSearchClear() {
  document.getElementById("searchInput").value = "";
  if (currentSearch !== "") {
    currentSearch = "";
    currentPage = 1;
    updateURLState();
    loadLiveBids();
    refreshFirstDateFilterOptions();
  }
}

// 빠른 날짜 필터 함수
function handleQuickDateFilter(event) {
  const range = event.target.dataset.range;
  const today = new Date();
  let startDate, endDate;

  switch (range) {
    case "today":
      startDate = endDate = today.toISOString().split("T")[0];
      break;
    case "week":
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      startDate = weekStart.toISOString().split("T")[0];
      endDate = weekEnd.toISOString().split("T")[0];
      break;
    case "month":
      startDate = new Date(today.getFullYear(), today.getMonth(), 1)
        .toISOString()
        .split("T")[0];
      endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0)
        .toISOString()
        .split("T")[0];
      break;
  }

  document.getElementById("fromDate").value = startDate;
  document.getElementById("toDate").value = endDate;
  fromDate = startDate;
  toDate = endDate;
  currentFirstDate = "";
  const firstDateFilter = document.getElementById("firstDateFilter");
  if (firstDateFilter) firstDateFilter.value = "";
  currentPage = 1;
  document
    .querySelectorAll("[data-range]")
    .forEach((b) => b.classList.remove("active"));
  event.target.closest("[data-range]")?.classList.add("active");
  updateURLState();
  loadLiveBids();
}

// 필터 상태에 따라 데이터 로드
async function filterByStatus(status) {
  currentStatus = status;
  updateBulkShipButtonLabel();
  currentPage = 1;
  await loadLiveBids();
}

function updateBulkShipButtonLabel() {
  const bulkShipBtn = document.getElementById("bulkShipBtn");
  const bulkStatusTarget = document.getElementById("bulkStatusTarget");
  if (bulkShipBtn) {
    bulkShipBtn.textContent = "일괄 상태 변경";
  }

  if (!bulkStatusTarget) return;

  const isWorkflowContext = LIVE_WORKFLOW_STATUSES.includes(currentStatus);
  const prevValue = bulkStatusTarget.value;
  const optionValues = isWorkflowContext
    ? LIVE_WORKFLOW_STATUSES
    : ["completed", "cancelled"];

  bulkStatusTarget.innerHTML = optionValues
    .map((status) => `<option value="${status}">${getLiveStatusLabel(status)}</option>`)
    .join("");

  if (isWorkflowContext) {
    bulkStatusTarget.value = optionValues.includes(currentStatus)
      ? currentStatus
      : "completed";
    return;
  }

  bulkStatusTarget.value = optionValues.includes(prevValue)
    ? prevValue
    : "completed";
}

// 페이지 변경 함수
function changePage(page) {
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  updateURLState();
  loadLiveBids();
}

// 현장 경매 데이터 로드
async function loadLiveBids() {
  try {
    toggleFirstDateFilterVisibility();
    showLoading("liveBidsTableBody");

    const liveBids = await fetchLiveBids(
      currentStatus,
      currentPage,
      itemsPerPage,
      currentSortBy,
      currentSortOrder,
      fromDate,
      toDate,
      currentSearch,
      currentAucNum,
    );
    currentLiveBidsData = liveBids?.bids || [];
    const filteredBids = filterLiveBidsByZone(currentLiveBidsData);

    if (!currentLiveBidsData.length) {
      showNoData("liveBidsTableBody", "현장 경매 데이터가 없습니다.");
      renderPagination(0, 0, 0);
      renderProcessingZoneSummary([]);
      return;
    }

    if (!filteredBids.length) {
      showNoData("liveBidsTableBody", "선택한 존의 데이터가 없습니다.");
    } else {
      renderLiveBidsTable(filteredBids);
    }
    renderProcessingZoneSummary(currentLiveBidsData);
    renderPagination(liveBids.currentPage, liveBids.totalPages, liveBids.total);
    totalPages = liveBids.totalPages;
  } catch (error) {
    currentLiveBidsData = [];
    handleError(error, "현장 경매 데이터를 불러오는 중 오류가 발생했습니다.");
    showNoData(
      "liveBidsTableBody",
      "데이터를 불러오는 중 오류가 발생했습니다.",
    );
    renderPagination(0, 0, 0);
    renderProcessingZoneSummary([]);
  }
}

function filterLiveBidsByZone(bids) {
  if (!currentProcessingZoneCode) return bids || [];
  return (bids || []).filter(
    (bid) =>
      (bid.wms_location_code || "UNKNOWN_ZONE") === currentProcessingZoneCode,
  );
}

// 페이지네이션 렌더링 - 공통 함수 활용
function renderPagination(currentPageNum, totalPagesNum, totalItems) {
  // 공통 페이지네이션 함수 사용
  createPagination(currentPageNum, totalPagesNum, changePage);

  // 페이지 정보 표시
  const paginationContainer = document.getElementById("pagination");
  if (paginationContainer && totalPagesNum > 0) {
    const infoDiv = createElement("div", "pagination-info");
    infoDiv.textContent = `총 ${totalItems}개 항목 중 ${
      (currentPageNum - 1) * itemsPerPage + 1
    } - ${Math.min(currentPageNum * itemsPerPage, totalItems)}개 표시`;

    paginationContainer.insertBefore(infoDiv, paginationContainer.firstChild);
  }
}

// 현장 경매 테이블 렌더링
function renderLiveBidsTable(liveBids) {
  const tableBody = document.getElementById("liveBidsTableBody");
  let html = "";

  // URL 매핑 함수
  const linkFunc = {
    1: (itemId) => `https://www.ecoauc.com/client/auction-items/view/${itemId}`,
    2: (itemId) => itemId,
    3: (itemId) => `https://www.starbuyers-global-auction.com/item/${itemId}`,
    4: (itemId, additionalInfo) =>
      `https://auction.mekiki.ai/en/auction/${additionalInfo.event_id}/${itemId}`,
    5: (itemId) => `https://penguin-auction.jp/product/detail/${itemId}/`,
  };

  liveBids.forEach((bid) => {
    // 상태에 따른 배지 스타일
    let statusBadge = "";
    switch (bid.status) {
      case "first":
        statusBadge = '<span class="badge badge-info">1차 입찰</span>';
        break;
      case "second":
        statusBadge = '<span class="badge badge-warning">2차 제안</span>';
        break;
      case "final":
        statusBadge = '<span class="badge badge-danger">최종 입찰</span>';
        break;
      case "completed": {
        const ss = bid.shipping_status || "pending";
        if (ss === "domestic_arrived") {
          statusBadge = '<span class="badge badge-warning">국내도착</span>';
        } else if (ss === "processing") {
          statusBadge = `<span class="badge badge-dark">${getLiveProcessingStatusLabel(bid)}</span>`;
        } else if (ss === "shipped") {
          statusBadge = '<span class="badge badge-primary">출고됨</span>';
        } else {
          statusBadge = '<span class="badge badge-success">완료</span>';
        }
        break;
      }
      case "cancelled":
        statusBadge = '<span class="badge badge-secondary">낙찰 실패</span>';
        break;
      default:
        statusBadge = '<span class="badge">' + bid.status + "</span>";
    }

    // 감정서 상태 배지
    let appraisalBadge = "";
    if (bid.appr_id) {
      appraisalBadge = '<span class="badge badge-success">발급됨</span>';
    } else {
      appraisalBadge = '<span class="badge badge-secondary">미발급</span>';
    }

    // 수선 접수 버튼
    let repairButton = "";
    if (
      bid.status === "completed" ||
      bid.shipping_status === "domestic_arrived" ||
      bid.shipping_status === "processing" ||
      bid.shipping_status === "shipped"
    ) {
      if (bid.repair_requested_at) {
        // 수선 접수됨 - 클릭 시 수정 모달 열기
        repairButton = `<button class="btn btn-sm btn-success" 
          data-bid-id="${bid.id}" 
          data-bid-type="live"
          data-repair-details="${escapeHtml(bid.repair_details || "")}"
          data-repair-fee="${bid.repair_fee || 0}"
          data-repair-requested-at="${bid.repair_requested_at || ""}"
          onclick="openRepairModalFromButton(this)">접수됨</button>`;
      } else {
        // 수선 미접수 - 클릭 시 수선 접수 모달
        repairButton = `<button class="btn btn-sm btn-secondary" onclick="openRepairModal(${bid.id}, 'live')">수선 접수</button>`;
      }
    } else {
      repairButton = "-";
    }

    // 작업 버튼 - 한 줄, 동일 크기(btn-sm)
    let actionButtons = `<div class="action-buttons-row"><button class="btn btn-sm btn-secondary" onclick="openEditBidModal(${bid.id})">수정</button>`;

    if (bid.status === "first") {
      actionButtons += `<button class="btn btn-sm" data-bid-id="${bid.id}" data-item-id="${escapeHtml(bid.item_id || "")}" onclick="openSecondPriceModalFromButton(this)">2차 가격 제안</button>`;
    } else if (bid.status === "final") {
      actionButtons += `
        <button class="btn btn-sm btn-secondary" onclick="openCancelModal(${bid.id})">낙찰 실패</button>
      `;
    } else if (bid.status === "completed") {
      actionButtons += `
        <select class="form-control form-control-sm status-target-select" id="liveStatusTarget-${bid.id}" data-current-status="${bid.shipping_status || "completed"}">
          ${getLiveWorkflowStatusOptionsHtml(bid.shipping_status || "completed")}
        </select>
        <button class="btn btn-info btn-sm" onclick="moveLiveBidStatus(${bid.id})">상태 변경</button>
      `;
    }
    actionButtons += `</div>`;

    // 날짜를 KST로 변환
    let scheduledDate = "-";
    if (
      bid.item &&
      (bid.item.original_scheduled_date || bid.item.scheduled_date)
    ) {
      const date = new Date(
        bid.item.original_scheduled_date || bid.item.scheduled_date,
      );
      scheduledDate = formatDateTime(date, true);
    }

    // auc_num을 이용한 원본 URL 생성
    let additionalInfo = {};
    if (bid.item?.additional_info) {
      try {
        additionalInfo = JSON.parse(bid.item.additional_info);
      } catch (e) {
        additionalInfo = {};
      }
    }

    let itemUrl = "#";
    if (bid.item && bid.item.auc_num && linkFunc[bid.item.auc_num]) {
      itemUrl = linkFunc[bid.item.auc_num](bid.item_id, additionalInfo);
    }

    // 1차입찰에서는 관리자 화면 내부 상세 모달을 연다
    const itemPrimaryUrl = itemUrl;
    const originLinkHtml = "";

    // 이미지 경로
    const imagePath =
      bid.item && bid.item.image ? bid.item.image : "/images/no-image.png";

    // additional_info에서 itemNo 추출 (1번 경매장인 경우)
    let itemNo = null;
    if (bid.item && bid.item.auc_num === "1" && bid.item.additional_info) {
      try {
        const additionalInfo = JSON.parse(bid.item.additional_info);
        itemNo = additionalInfo.itemNo || null;
      } catch (e) {
        // JSON 파싱 실패 시 무시
      }
    }

    // 수수료 포함 가격 계산
    let firstTotalPrice = "-";
    let secondTotalPrice = "-";
    let finalTotalPrice = "-";
    let winningTotalPrice = "-";

    if (bid.item && bid.item.auc_num && bid.item.category) {
      const auc_num = bid.item.auc_num;
      const category = bid.item.category;

      if (bid.first_price) {
        firstTotalPrice = formatCurrency(
          calculateTotalPrice(bid.first_price, auc_num, category),
          "KRW",
        );
      }

      if (bid.second_price) {
        secondTotalPrice = formatCurrency(
          calculateTotalPrice(bid.second_price, auc_num, category),
          "KRW",
        );
      }

      if (bid.final_price) {
        finalTotalPrice = formatCurrency(
          calculateTotalPrice(bid.final_price, auc_num, category),
          "KRW",
        );
      }

      if (bid.winning_price) {
        winningTotalPrice = formatCurrency(
          calculateTotalPrice(bid.winning_price, auc_num, category),
          "KRW",
        );
      }
    }

    html += `
  <tr>
    <td><input type="checkbox" class="bid-checkbox" data-bid-id="${
      bid.id
    }" data-final-price="${bid.final_price || 0}" data-auc-num="${
      bid.item?.auc_num || 1
    }" data-category="${bid.item?.category || "기타"}" data-status="${
      bid.status
    }" data-workflow-status="${
      bid.status === "completed" ? bid.shipping_status || "completed" : bid.status
    }"></td>
    <td>${bid.id}</td>
    <td>
      <div class="item-info">
        <img src="${imagePath}" alt="${
          bid.item?.title || ""
        }" class="item-thumbnail" />
        <div class="item-details">
          <div>
            <a
              href="${escapeHtml(itemPrimaryUrl)}"
              target="_blank"
              rel="noopener noreferrer"
              class="item-id-link"
              onclick="return openLiveProductDetail(event, this);"
              data-bid-id="${bid.id}"
              data-item-id="${escapeHtml(bid.item_id || "")}"
              data-bid-status="${escapeHtml(bid.status || "")}"
              data-auc-num="${escapeHtml(bid.item?.auc_num || "")}"
              data-image="${escapeHtml(imagePath)}"
              data-title="${escapeHtml(bid.item?.original_title || "-")}"
              data-brand="${escapeHtml(bid.item?.brand || "-")}"
              data-category="${escapeHtml(bid.item?.category || "-")}"
              data-rank="${escapeHtml(bid.item?.rank || "-")}"
              data-accessory-code="${escapeHtml(bid.item?.accessory_code || "-")}"
              data-scheduled="${escapeHtml(scheduledDate || "-")}"
              data-origin-url="${escapeHtml(itemUrl || "#")}"
            >${escapeHtml(bid.item_id || "-")}</a>
            ${originLinkHtml}
          </div>
          <div class="item-meta">
            <span>내부바코드: ${bid.internal_barcode || "-"}</span>
            ${itemNo ? `<span>품번: ${itemNo}</span>` : ""}
            <span>제목: ${bid.item?.original_title || "-"}</span>
            <span>경매번호: ${bid.item?.auc_num || "-"}</span>
            <span>카테고리: ${bid.item?.category || "-"}</span>
            <span>브랜드: ${bid.item?.brand || "-"}</span>
            <span>등급: ${bid.item?.rank || "-"}</span>
            <span>상품가: ${
              bid.item && bid.item.starting_price
                ? formatCurrency(bid.item.starting_price, "JPY")
                : "-"
            }</span>
            <span>예정일시: ${scheduledDate}</span>
          </div>
        </div>
      </div>
    </td>
    <td>
      <div>${bid.login_id || bid.user_id}<br>(${bid.company_name || "-"})</div>
    </td>
    <td>
      <div>현지가: ${formatCurrency(bid.first_price, "JPY")}</div>
      <div class="total-price">관부가세 포함: ${firstTotalPrice}</div>
    </td>
    <td>
      <div>현지가: ${
        bid.second_price ? formatCurrency(bid.second_price, "JPY") : "-"
      }</div>
      <div class="total-price">관부가세 포함: ${secondTotalPrice}</div>
    </td>
    <td>
      <div>현지가: ${
        bid.final_price ? formatCurrency(bid.final_price, "JPY") : "-"
      }</div>
      <div class="total-price">관부가세 포함: ${finalTotalPrice}</div>
    </td>
    <td>
      <div>현지가: ${
        bid.winning_price ? formatCurrency(bid.winning_price, "JPY") : "-"
      }</div>
      <div class="total-price">관부가세 포함: ${winningTotalPrice}</div>
    </td>
    <td>
      <div>${scheduledDate}</div>
    </td>
    <td>${statusBadge}</td>
    <td>${appraisalBadge}</td>
    <td>${repairButton}</td>
    <td>${formatDateTime(bid.updated_at)}</td>
    <td>${actionButtons}</td>
  </tr>
 `;
  });

  tableBody.innerHTML = html;
  addCheckboxEventListeners();
}

function setLiveDetailText(id, value) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = value || "-";
}

function setLiveDetailImage(src) {
  const img = document.getElementById("liveDetailMainImage");
  if (!img) return;
  img.classList.remove("zoom-active");
  img.style.transformOrigin = "center center";
  img.src = src || "/images/no-image.png";
}

function setLiveDetailOrigin(url) {
  const link = document.getElementById("liveDetailOriginLink");
  if (!link) return;
  const safeUrl = url && url !== "#" ? url : "";
  link.href = safeUrl || "#";
  link.style.pointerEvents = safeUrl ? "auto" : "none";
  link.style.opacity = safeUrl ? "1" : "0.5";
}

function setLiveDetailQuickProposeContext(bidId, itemId, bidStatus = "") {
  const bidInput = document.getElementById("liveDetailBidId");
  const itemInput = document.getElementById("liveDetailQuickItemId");
  const priceInput = document.getElementById("liveDetailSecondPrice");
  const targetText = document.getElementById("liveDetailQuickTargetText");
  const actionBtn = document.getElementById("liveDetailSubmitSecondPrice");
  const box = document.getElementById("liveDetailQuickProposeBox");

  if (bidInput) bidInput.value = bidId ? String(bidId) : "";
  if (itemInput) itemInput.value = itemId || "";
  if (priceInput) priceInput.value = "";

  const isFirstStage = String(bidStatus || "") === "first";
  if (box) box.style.display = isFirstStage ? "block" : "none";

  const enabled = Boolean(isFirstStage && bidId && itemId);
  if (targetText) {
    targetText.textContent = enabled
      ? `상품ID ${itemId} 전체 고객에게 동일한 2차 제안가가 적용됩니다.`
      : "1차입찰 상태에서만 2차 제안이 가능합니다.";
  }
  if (actionBtn) actionBtn.disabled = !enabled;
}

function applyLiveDetailData(data = {}) {
  setLiveDetailText("liveDetailItemId", data.itemId || "-");
  setLiveDetailText("liveDetailTitle", data.title || "-");
  setLiveDetailText("liveDetailBrand", data.brand || "-");
  setLiveDetailText("liveDetailCategory", data.category || "-");
  setLiveDetailText("liveDetailRank", data.rank || "-");
  setLiveDetailText("liveDetailScheduled", data.scheduled || "-");
  setLiveDetailText("liveDetailAccessoryCode", data.accessoryCode || "-");
  setLiveDetailText("liveDetailDescription", data.description || "-");
  setLiveDetailOrigin(data.originUrl || "#");
  setLiveDetailImage(data.image || "/images/no-image.png");
}

function renderLiveDetailThumbs() {
  const wrap = document.getElementById("liveDetailThumbs");
  if (!wrap) return;
  wrap.innerHTML = "";
  liveDetailImages.forEach((src, idx) => {
    const activeClass = idx === liveDetailImageIndex ? "active" : "";
    wrap.insertAdjacentHTML(
      "beforeend",
      `
        <button type="button" class="live-detail-thumb ${activeClass}" data-index="${idx}">
          <img src="${escapeHtml(src)}" alt="썸네일 ${idx + 1}" />
        </button>
      `,
    );
  });
  wrap.querySelectorAll(".live-detail-thumb").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.index || 0);
      showLiveDetailImageAt(idx);
    });
  });
}

function updateLiveDetailNavState() {
  const prevBtn = document.getElementById("liveDetailPrevBtn");
  const nextBtn = document.getElementById("liveDetailNextBtn");
  if (prevBtn) prevBtn.disabled = liveDetailImageIndex <= 0;
  if (nextBtn) nextBtn.disabled = liveDetailImageIndex >= liveDetailImages.length - 1;
}

function showLiveDetailImageAt(index) {
  if (!liveDetailImages.length) return;
  if (index < 0 || index >= liveDetailImages.length) return;
  liveDetailImageIndex = index;
  setLiveDetailImage(liveDetailImages[liveDetailImageIndex]);
  renderLiveDetailThumbs();
  updateLiveDetailNavState();
}

function setLiveDetailImages(images) {
  const normalized = Array.isArray(images)
    ? images.filter((x) => String(x || "").trim())
    : [];
  liveDetailImages = normalized.length ? normalized : ["/images/no-image.png"];
  liveDetailImageIndex = 0;
  showLiveDetailImageAt(0);
}

function bindLiveDetailGalleryControls() {
  document.getElementById("liveDetailPrevBtn")?.addEventListener("click", () => {
    showLiveDetailImageAt(liveDetailImageIndex - 1);
  });
  document.getElementById("liveDetailNextBtn")?.addEventListener("click", () => {
    showLiveDetailImageAt(liveDetailImageIndex + 1);
  });
}

function bindLiveDetailImageZoomControls() {
  const wrap = document.getElementById("liveDetailMainImageWrap");
  const img = document.getElementById("liveDetailMainImage");
  if (!wrap || !img) return;

  const setZoomByPointer = (event) => {
    const rect = wrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height));
    const xPct = (x / rect.width) * 100;
    const yPct = (y / rect.height) * 100;
    img.style.transformOrigin = `${xPct}% ${yPct}%`;
  };

  wrap.addEventListener("mouseenter", () => {
    if (!window.matchMedia("(hover: hover)").matches) return;
    img.classList.add("zoom-active");
  });

  wrap.addEventListener("mousemove", (event) => {
    if (!img.classList.contains("zoom-active")) return;
    setZoomByPointer(event);
  });

  wrap.addEventListener("mouseleave", () => {
    img.classList.remove("zoom-active");
    img.style.transformOrigin = "center center";
  });
}

async function submitSecondPriceFromDetailModal() {
  const bidId = parseInt(document.getElementById("liveDetailBidId")?.value || "", 10);
  const itemId = String(
    document.getElementById("liveDetailQuickItemId")?.value || "",
  ).trim();
  const secondPrice = parseFloat(
    document.getElementById("liveDetailSecondPrice")?.value || "",
  );
  const actionBtn = document.getElementById("liveDetailSubmitSecondPrice");

  if (!bidId || !itemId || !secondPrice) {
    showAlert("2차 제안가를 입력해주세요.");
    return;
  }

  if (actionBtn) actionBtn.disabled = true;
  try {
    const result = await proposeSecondPrice(bidId, secondPrice, itemId);
    const updatedCount = Number(result?.updatedCount || 0);
    showAlert(
      updatedCount > 0
        ? `2차 제안가가 상품 단위로 적용되었습니다. (${updatedCount}건)`
        : "2차 제안가가 적용되었습니다.",
      "success",
    );
    await loadLiveBids();
  } catch (error) {
    handleError(error, "2차 제안 등록 중 오류가 발생했습니다.");
  } finally {
    if (actionBtn) actionBtn.disabled = false;
  }
}

function bindLiveDetailQuickProposeControls() {
  document
    .getElementById("liveDetailSubmitSecondPrice")
    ?.addEventListener("click", submitSecondPriceFromDetailModal);
  document
    .getElementById("liveDetailSecondPrice")
    ?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitSecondPriceFromDetailModal();
      }
    });
}

async function openLiveProductDetail(event, anchorEl) {
  if (event) event.preventDefault();
  const anchor = anchorEl;
  if (!anchor) return false;

  const bidStatus = String(anchor.dataset.bidStatus || "");
  const itemId = String(anchor.dataset.itemId || "").trim();
  const bidId = parseInt(anchor.dataset.bidId || "", 10);
  const aucNum = String(anchor.dataset.aucNum || "").trim();
  const modal = window.setupModal("liveProductDetailModal");
  if (!modal || !itemId) return false;

  applyLiveDetailData({
    itemId,
    title: anchor.dataset.title || "-",
    brand: anchor.dataset.brand || "-",
    category: anchor.dataset.category || "-",
    rank: anchor.dataset.rank || "-",
    accessoryCode: anchor.dataset.accessoryCode || "-",
    scheduled: anchor.dataset.scheduled || "-",
    description: "상세 정보를 불러오는 중입니다...",
    image: anchor.dataset.image || "/images/no-image.png",
    originUrl: anchor.dataset.originUrl || "#",
  });
  setLiveDetailImages([anchor.dataset.image || "/images/no-image.png"]);
  setLiveDetailQuickProposeContext(bidId, itemId, bidStatus);
  modal.show();

  try {
    const detail = await window.API.fetchAPI(`/detail/item-details/${encodeURIComponent(itemId)}`, {
      method: "POST",
      body: JSON.stringify({ aucNum, translateDescription: "ko" }),
    });

    let detailImage = detail?.image || anchor.dataset.image || "/images/no-image.png";
    let detailImages = [detailImage];
    if (detail?.additional_images) {
      try {
        const extra = JSON.parse(detail.additional_images);
        if (Array.isArray(extra) && extra.length > 0 && extra[0]) {
          detailImage = extra[0];
          detailImages = [detailImage, ...extra.slice(1)];
        }
      } catch (e) {
        // ignore json parse error
      }
    }
    setLiveDetailImages(detailImages);

    applyLiveDetailData({
      itemId,
      title: detail?.title || anchor.dataset.title || "-",
      brand: detail?.brand || anchor.dataset.brand || "-",
      category: detail?.category || anchor.dataset.category || "-",
      rank: detail?.rank || anchor.dataset.rank || "-",
      accessoryCode: detail?.accessory_code || anchor.dataset.accessoryCode || "-",
      scheduled: detail?.scheduled_date ? formatDateTime(detail.scheduled_date, true) : anchor.dataset.scheduled || "-",
      description: detail?.description_ko || detail?.description || "설명 정보가 없습니다.",
      image: detailImage,
      originUrl: anchor.dataset.originUrl || "#",
    });
  } catch (error) {
    console.error("상품 상세 조회 실패:", error);
    setLiveDetailText("liveDetailDescription", "상세 정보를 불러오지 못했습니다.");
  }
  return false;
}

// 체크박스 이벤트 리스너 추가 함수
function addCheckboxEventListeners() {
  document
    .getElementById("selectAllBids")
    ?.addEventListener("change", function () {
      const isChecked = this.checked;
      document.querySelectorAll(".bid-checkbox").forEach((checkbox) => {
        checkbox.checked = isChecked;
      });
      updateBulkActionButtons();
    });

  document.querySelectorAll(".bid-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", updateBulkActionButtons);
  });
}

// 일괄 처리 버튼 상태 업데이트
function updateBulkActionButtons() {
  const checkedCount = document.querySelectorAll(
    ".bid-checkbox:checked",
  ).length;
  const selectionHint = document.getElementById("bulkSelectionHint");
  const bulkShipBtn = document.getElementById("bulkShipBtn");

  if (bulkShipBtn) bulkShipBtn.disabled = checkedCount === 0;
  if (selectionHint) {
    selectionHint.textContent = `선택 ${checkedCount}건`;
  }
}

// 2차 제안가 제안 모달 열기 - 공통 함수 활용
function openSecondPriceModal(bidId, itemId = "") {
  document.getElementById("bidId").value = bidId;
  document.getElementById("secondPriceItemId").value = itemId || "";
  document.getElementById("secondPrice").value = "";
  const targetInfo = document.getElementById("secondPriceTargetInfo");
  if (targetInfo) {
    targetInfo.textContent = itemId
      ? `상품ID ${itemId} 전체 고객에게 동일한 2차 제안가가 적용됩니다.`
      : "상품 단위로 일괄 제안됩니다.";
  }

  const modal = window.setupModal("secondPriceModal");
  if (modal) {
    modal.show();
  }
}

function openSecondPriceModalFromButton(button) {
  if (!button) return;
  const bidId = parseInt(button.dataset.bidId || "", 10);
  const itemId = String(button.dataset.itemId || "").trim();
  openSecondPriceModal(bidId, itemId);
}

// 2차 제안가 제안 제출
async function submitSecondPrice() {
  const bidId = parseInt(document.getElementById("bidId").value);
  const itemId = String(
    document.getElementById("secondPriceItemId")?.value || "",
  ).trim();
  const secondPrice = parseFloat(document.getElementById("secondPrice").value);

  if (!bidId || !itemId || !secondPrice) {
    showAlert("상품 정보와 2차 제안가를 확인해주세요.");
    return;
  }

  try {
    const result = await proposeSecondPrice(bidId, secondPrice, itemId);
    closeAllModals();
    const updatedCount = Number(result?.updatedCount || 0);
    showAlert(
      updatedCount > 0
        ? `2차 제안가가 상품 단위로 적용되었습니다. (${updatedCount}건)`
        : "2차 제안가가 적용되었습니다.",
      "success",
    );
    await loadLiveBids();
  } catch (error) {
    handleError(error, "2차 제안가 제안 중 오류가 발생했습니다.");
  }
}

// 입찰 완료 모달 열기 - 공통 함수 활용
function openCompleteModal(bidId) {
  document.getElementById("completeBidId").value = bidId;
  document.getElementById("winningPrice").value = "";
  document.getElementById("winningPriceKRW").textContent = "관부가세 포함: -";
  document.getElementById("priceComparisonMessage").textContent = "";
  document.getElementById("priceComparisonMessage").className =
    "price-comparison";

  const modal = window.setupModal("completeModal");
  if (modal) {
    modal.show();
  }
}

// 관부가세 포함 가격 업데이트
function updateWinningPriceKRW() {
  const bidId = document.getElementById("completeBidId").value;
  const winningPrice = parseFloat(
    document.getElementById("winningPrice").value,
  );

  if (!winningPrice || isNaN(winningPrice)) {
    document.getElementById("winningPriceKRW").textContent = "관부가세 포함: -";
    document.getElementById("priceComparisonMessage").textContent = "";
    return;
  }

  const checkbox = document.querySelector(
    `.bid-checkbox[data-bid-id="${bidId}"]`,
  );
  if (!checkbox) return;

  const auc_num = parseInt(checkbox.getAttribute("data-auc-num")) || 1;
  const category = checkbox.getAttribute("data-category") || "기타";
  const finalPrice = parseFloat(checkbox.getAttribute("data-final-price")) || 0;

  const totalPrice = calculateTotalPrice(winningPrice, auc_num, category);
  document.getElementById("winningPriceKRW").textContent =
    `관부가세 포함: ${formatCurrency(totalPrice, "KRW")}`;

  const priceComparisonMsg = document.getElementById("priceComparisonMessage");
  if (finalPrice && winningPrice > finalPrice) {
    priceComparisonMsg.textContent =
      "※ 입력한 금액이 최종 입찰가보다 높습니다. 낙찰 실패로 처리됩니다.";
    priceComparisonMsg.className = "price-comparison warning";
  } else if (finalPrice && winningPrice < finalPrice) {
    priceComparisonMsg.textContent =
      "※ 입력한 금액이 최종 입찰가보다 낮습니다. 낙찰 완료로 처리됩니다.";
    priceComparisonMsg.className = "price-comparison success";
  } else {
    priceComparisonMsg.textContent = "";
    priceComparisonMsg.className = "price-comparison";
  }
}

// 입찰 완료 제출
async function submitCompleteBid() {
  const bidId = parseInt(document.getElementById("completeBidId").value);
  const winningPriceValue = document.getElementById("winningPrice").value;
  const winningPrice = winningPriceValue
    ? parseFloat(winningPriceValue)
    : undefined;

  if (!bidId) {
    showAlert("입찰 ID가 유효하지 않습니다.");
    return;
  }

  try {
    await completeBid(bidId, winningPrice);
    closeAllModals();
    await loadLiveBids();
  } catch (error) {
    handleError(error, "입찰 완료 처리 중 오류가 발생했습니다.");
  }
}

// 낙찰 실패 모달 열기 - 공통 함수 활용
function openCancelModal(bidId) {
  document.getElementById("cancelBidId").value = bidId;

  // 공통 모달 함수 사용
  const modal = window.setupModal("cancelModal");
  if (modal) {
    modal.show();
  }
}

// 낙찰 실패 제출
async function submitCancelBid() {
  const bidId = parseInt(document.getElementById("cancelBidId").value);

  if (!bidId) {
    showAlert("입찰 ID가 유효하지 않습니다.");
    return;
  }

  try {
    await cancelBid(bidId);
    closeAllModals();
    showAlert("낙찰 실패로 처리되었습니다.", "success");
    await loadLiveBids();
  } catch (error) {
    handleError(error, "낙찰 실패 처리 중 오류가 발생했습니다.");
  }
}

// 일괄 낙찰 완료 모달 열기
function openBulkCompleteModal() {
  const checkedBids = document.querySelectorAll(".bid-checkbox:checked");
  const count = checkedBids.length;

  if (count === 0) return;

  document.getElementById("bulkCompleteCount").textContent = count;
  document.getElementById("bulkWinningPrice").value = "";
  document.getElementById("bulkWinningPriceKRW").textContent =
    "관부가세 포함: -";

  const modal = window.setupModal("bulkCompleteModal");
  if (modal) {
    modal.show();
  }
}

// 일괄 관부가세 포함 가격 업데이트
function updateBulkWinningPriceKRW() {
  const winningPrice = parseFloat(
    document.getElementById("bulkWinningPrice").value,
  );
  if (!winningPrice || isNaN(winningPrice)) {
    document.getElementById("bulkWinningPriceKRW").textContent =
      "관부가세 포함: -";
    return;
  }

  const totalPrice = calculateTotalPrice(winningPrice, 1, "기타");
  document.getElementById("bulkWinningPriceKRW").textContent =
    `관부가세 포함: ${formatCurrency(totalPrice, "KRW")}`;
}

// 일괄 낙찰 완료 제출
async function submitBulkComplete() {
  const checkedBids = document.querySelectorAll(".bid-checkbox:checked");
  if (checkedBids.length === 0) {
    closeAllModals();
    return;
  }

  try {
    const bidIds = Array.from(checkedBids).map((checkbox) =>
      parseInt(checkbox.dataset.bidId),
    );

    const winningPriceValue = document.getElementById("bulkWinningPrice").value;
    const winningPrice = winningPriceValue
      ? parseFloat(winningPriceValue)
      : undefined;

    await completeBid(bidIds, winningPrice);
    closeAllModals();
    await loadLiveBids();
  } catch (error) {
    handleError(error, "일괄 입찰 완료 처리 중 오류가 발생했습니다.");
  }
}

// 일괄 낙찰 실패 모달 열기
function openBulkCancelModal() {
  const checkedBids = document.querySelectorAll(".bid-checkbox:checked");
  const count = checkedBids.length;

  if (count === 0) return;

  document.getElementById("bulkCancelCount").textContent = count;

  const modal = window.setupModal("bulkCancelModal");
  if (modal) {
    modal.show();
  }
}

// 일괄 낙찰 실패 제출
async function submitBulkCancel() {
  const checkedBids = document.querySelectorAll(".bid-checkbox:checked");
  if (checkedBids.length === 0) {
    closeAllModals();
    return;
  }

  try {
    const bidIds = Array.from(checkedBids).map((checkbox) =>
      parseInt(checkbox.dataset.bidId),
    );

    await cancelBid(bidIds);
    closeAllModals();
    showAlert(
      `${bidIds.length}개 입찰이 낙찰 실패로 처리되었습니다.`,
      "success",
    );
    await loadLiveBids();
  } catch (error) {
    handleError(error, "일괄 입찰 취소 처리 중 오류가 발생했습니다.");
  }
}

// 수정 모달 열기
function openEditBidModal(bidId) {
  const tableBody = document.getElementById("liveBidsTableBody");
  const rows = tableBody.querySelectorAll("tr");
  let currentBid = null;

  for (let row of rows) {
    const checkbox = row.querySelector(".bid-checkbox");
    if (checkbox && checkbox.dataset.bidId == bidId) {
      const cells = row.querySelectorAll("td");
      const firstPriceText = cells[4]?.textContent || "";
      const secondPriceText = cells[5]?.textContent || "";
      const finalPriceText = cells[6]?.textContent || "";
      const winningPriceText = cells[7]?.textContent || "";
      const statusText = cells[9]?.textContent || "";

      const firstPriceMatch = firstPriceText.match(/현지가:\s*¥([\d,]+)/);
      const secondPriceMatch = secondPriceText.match(/현지가:\s*¥([\d,]+)/);
      const finalPriceMatch = finalPriceText.match(/현지가:\s*¥([\d,]+)/);
      const winningPriceMatch = winningPriceText.match(/현지가:\s*¥([\d,]+)/);

      currentBid = {
        id: bidId,
        first_price: firstPriceMatch
          ? parseInt(firstPriceMatch[1].replace(/,/g, ""))
          : null,
        second_price: secondPriceMatch
          ? parseInt(secondPriceMatch[1].replace(/,/g, ""))
          : null,
        final_price: finalPriceMatch
          ? parseInt(finalPriceMatch[1].replace(/,/g, ""))
          : null,
        winning_price: winningPriceMatch
          ? parseInt(winningPriceMatch[1].replace(/,/g, ""))
          : null,
        status: statusText.includes("1차 입찰")
          ? "first"
          : statusText.includes("2차 제안")
            ? "second"
            : statusText.includes("최종 입찰")
              ? "final"
              : statusText.includes("완료")
                ? "completed"
                : statusText.includes("국내도착")
                  ? "domestic_arrived"
                  : statusText.includes("작업중")
                    ? "processing"
                    : statusText.includes("출고됨")
                      ? "shipped"
                      : "cancelled",
      };
      break;
    }
  }

  if (!currentBid) {
    showAlert("입찰 정보를 찾을 수 없습니다.");
    return;
  }

  // 모달에 현재 값 설정
  document.getElementById("editBidId").value = bidId;
  document.getElementById("editFirstPrice").value =
    currentBid.first_price || "";
  document.getElementById("editSecondPrice").value =
    currentBid.second_price || "";
  document.getElementById("editFinalPrice").value =
    currentBid.final_price || "";
  document.getElementById("editStatus").value = currentBid.status;
  document.getElementById("editWinningPrice").value =
    currentBid.winning_price || "";

  const modal = window.setupModal("editBidModal");
  if (modal) {
    modal.show();
  }
}

// 수정 제출
async function submitEditBid() {
  const bidId = parseInt(document.getElementById("editBidId").value);
  const firstPriceValue = document.getElementById("editFirstPrice").value;
  const secondPriceValue = document.getElementById("editSecondPrice").value;
  const finalPriceValue = document.getElementById("editFinalPrice").value;
  const status = document.getElementById("editStatus").value;
  const winningPriceValue = document.getElementById("editWinningPrice").value;

  if (!bidId) {
    showAlert("입찰 ID가 유효하지 않습니다.");
    return;
  }

  try {
    const updateData = {};

    if (firstPriceValue) updateData.first_price = parseInt(firstPriceValue);
    if (secondPriceValue) updateData.second_price = parseInt(secondPriceValue);
    if (finalPriceValue) updateData.final_price = parseInt(finalPriceValue);
    if (status) Object.assign(updateData, buildLiveBidUpdate(status));
    if (winningPriceValue)
      updateData.winning_price = parseInt(winningPriceValue);

    await updateLiveBid(bidId, updateData);

    closeAllModals();
    showAlert("입찰 정보가 수정되었습니다.", "success");
    await loadLiveBids();
  } catch (error) {
    handleError(error, "입찰 수정 중 오류가 발생했습니다.");
  }
}

// 완료/국내도착/작업중 상태를 다음 단계로 변경
async function advanceLiveBidStatus(bidId, currentStatus) {
  const nextStatus = getLiveNextStatus(currentStatus);
  if (!nextStatus) {
    showAlert("이 상태는 다음 단계로 변경할 수 없습니다.", "warning");
    return;
  }

  if (
    !confirm(
      `이 입찰을 ${getLiveStatusLabel(nextStatus)} 상태로 변경하시겠습니까?`,
    )
  ) {
    return;
  }

  try {
    await updateLiveBid(bidId, buildLiveBidUpdate(nextStatus));
    showAlert(
      `상태가 ${getLiveStatusLabel(nextStatus)}으로 변경되었습니다.`,
      "success",
    );
    await loadLiveBids();
  } catch (error) {
    handleError(error, "상태 변경 중 오류가 발생했습니다.");
  }
}

async function moveLiveBidStatus(bidId) {
  const select = document.getElementById(`liveStatusTarget-${bidId}`);
  const targetStatus = select?.value;
  const currentRowStatus = select?.dataset.currentStatus || "";

  if (!targetStatus) {
    showAlert("변경할 상태를 선택해주세요.", "warning");
    return;
  }

  if (targetStatus === currentRowStatus) {
    showAlert("현재 상태와 동일합니다.", "warning");
    return;
  }

  if (
    !confirm(
      `이 입찰을 ${getLiveStatusLabel(targetStatus)} 상태로 변경하시겠습니까?`,
    )
  ) {
    return;
  }

  try {
    await updateLiveBid(bidId, buildLiveBidUpdate(targetStatus));
    showAlert(
      `상태가 ${getLiveStatusLabel(targetStatus)}으로 변경되었습니다.`,
      "success",
    );
    await loadLiveBids();
  } catch (error) {
    handleError(error, "상태 변경 중 오류가 발생했습니다.");
  }
}

// 선택 항목 일괄 다음 단계 처리
async function bulkMarkAsShipped() {
  const checkedBoxes = document.querySelectorAll(".bid-checkbox:checked");
  const bulkStatusTarget = document.getElementById("bulkStatusTarget");
  const targetStatus = bulkStatusTarget?.value;
  const bidUpdates = [];
  const skippedSameStatus = [];

  if (!targetStatus || !LIVE_WORKFLOW_STATUSES.includes(targetStatus)) {
    showAlert("변경할 상태를 선택해주세요.", "warning");
    return;
  }

  checkedBoxes.forEach((cb) => {
    const bidId = parseInt(cb.dataset.bidId);
    const currentBidStatus = cb.dataset.workflowStatus || cb.dataset.status || "";

    if (!bidId) return;

    if (currentBidStatus === targetStatus) {
      skippedSameStatus.push(bidId);
    } else {
      bidUpdates.push({ bidId, nextStatus: targetStatus });
    }
  });

  if (bidUpdates.length === 0) {
    showAlert("선택된 항목이 없거나 이미 같은 상태입니다.", "warning");
    return;
  }

  if (
    !confirm(
      `선택된 ${bidUpdates.length}개 항목을 ${getLiveStatusLabel(targetStatus)} 상태로 변경하시겠습니까?`,
    )
  ) {
    return;
  }

  try {
    const promises = bidUpdates.map(({ bidId, nextStatus }) =>
      updateLiveBid(bidId, buildLiveBidUpdate(nextStatus)),
    );
    await Promise.all(promises);

    const skippedText =
      skippedSameStatus.length > 0
        ? ` (${skippedSameStatus.length}개는 이미 같은 상태여서 제외)`
        : "";
    showAlert(
      `${bidUpdates.length}개 항목이 ${getLiveStatusLabel(targetStatus)} 상태로 변경되었습니다.${skippedText}`,
      "success",
    );
    await loadLiveBids();
  } catch (error) {
    handleError(error, "일괄 상태 변경 중 오류가 발생했습니다.");
  }
}

// ===================================
// 수선 접수 기능
// ===================================

// 수선 모달 열기 (버튼에서 data 속성으로 호출)
function openRepairModalFromButton(button) {
  const bidId = button.dataset.bidId;
  const bidType = button.dataset.bidType;
  const repairData = {
    repair_details: button.dataset.repairDetails || "",
    repair_fee: button.dataset.repairFee || 0,
    repair_requested_at: button.dataset.repairRequestedAt || null,
  };

  openRepairModal(bidId, bidType, repairData);
}

// 수선 모달 열기 (신규 접수 또는 수정)
function openRepairModal(bidId, bidType, repairData = null) {
  // 필드 초기화 및 활성화
  document.getElementById("repairBidId").value = bidId;
  document.getElementById("repairBidType").value = bidType;

  const requestedAtGroup = document.getElementById("repairRequestedAtGroup");
  const requestedAtText = document.getElementById("repairRequestedAt");
  const cancelButton = document.getElementById("cancelRepair");

  if (repairData && repairData.repair_requested_at) {
    // 수정 모드
    document.querySelector("#repairModal .modal-title").textContent =
      "수선 정보 수정";
    document.getElementById("repairDetails").value =
      repairData.repair_details || "";
    document.getElementById("repairFee").value = repairData.repair_fee || "";
    document.getElementById("submitRepair").textContent = "수정하기";

    // 신청 시간 표시
    requestedAtGroup.style.display = "block";
    requestedAtText.textContent = formatDateTime(
      repairData.repair_requested_at,
    );

    // 취소 버튼 표시
    cancelButton.style.display = "inline-block";
  } else {
    // 신규 접수 모드
    document.querySelector("#repairModal .modal-title").textContent =
      "수선 접수";
    document.getElementById("repairDetails").value = "";
    document.getElementById("repairFee").value = "";
    document.getElementById("submitRepair").textContent = "접수하기";

    // 신청 시간 숨김
    requestedAtGroup.style.display = "none";

    // 취소 버튼 숨김
    cancelButton.style.display = "none";
  }

  // 항상 편집 가능
  document.getElementById("repairDetails").disabled = false;
  document.getElementById("repairFee").disabled = false;

  // 제출 버튼 표시
  document.getElementById("submitRepair").style.display = "inline-block";

  const modal = document.getElementById("repairModal");
  modal.classList.add("active");
}

// 수선 접수/수정 제출
async function submitRepair() {
  const bidId = document.getElementById("repairBidId").value;
  const bidType = document.getElementById("repairBidType").value;
  const repairDetails = document.getElementById("repairDetails").value.trim();
  const repairFee = document.getElementById("repairFee").value;
  const isEdit =
    document.getElementById("submitRepair").textContent === "수정하기";

  if (!repairDetails) {
    showAlert("수선 내용을 입력해주세요.", "warning");
    return;
  }

  try {
    const endpoint = `/bid-results/${bidType}/${bidId}/request-repair`;

    const response = await fetchAPI(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        repair_details: repairDetails,
        repair_fee: repairFee ? parseInt(repairFee) : null,
      }),
    });

    closeAllModals();
    showAlert(
      response.message ||
        (isEdit
          ? "수선 정보가 수정되었습니다."
          : "수선 접수가 완료되었습니다."),
      "success",
    );
    await loadLiveBids();
  } catch (error) {
    handleError(
      error,
      isEdit
        ? "수선 정보 수정 중 오류가 발생했습니다."
        : "수선 접수 중 오류가 발생했습니다.",
    );
  }
}

// 수선 신청 취소
async function cancelRepair() {
  const bidId = document.getElementById("repairBidId").value;
  const bidType = document.getElementById("repairBidType").value;

  if (!confirm("수선 접수를 취소하시겠습니까?")) {
    return;
  }

  try {
    const endpoint = `/bid-results/${bidType}/${bidId}/repair`;

    const response = await fetchAPI(endpoint, {
      method: "DELETE",
    });

    closeAllModals();
    showAlert(response.message || "수선 접수가 취소되었습니다.", "success");
    await loadLiveBids();
  } catch (error) {
    handleError(error, "수선 취소 중 오류가 발생했습니다.");
  }
}

// 이벤트 리스너 추가
document
  .getElementById("submitRepair")
  ?.addEventListener("click", submitRepair);

document
  .getElementById("cancelRepair")
  ?.addEventListener("click", cancelRepair);

bindLiveDetailGalleryControls();
bindLiveDetailImageZoomControls();
bindLiveDetailQuickProposeControls();
