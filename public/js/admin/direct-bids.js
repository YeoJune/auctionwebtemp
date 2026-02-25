// public/js/admin/direct-bids.js

// HTML 이스케이프 함수
function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

const DIRECT_STATUS_LABELS = {
  active: "활성",
  completed: "완료",
  domestic_arrived: "국내도착",
  processing: "작업중",
  shipped: "출고됨",
  cancelled: "낙찰 실패",
};

// shipping_status 값 (bid.status가 아닌 별도 필드로 전달해야 함)
const DIRECT_SHIPPING_STATUSES = new Set([
  "domestic_arrived",
  "processing",
  "shipped",
]);

/**
 * 상태 값에 따라 올바른 API body 필드를 결정한다.
 */
function buildDirectBidUpdate(valueOrObj) {
  if (typeof valueOrObj === "object" && valueOrObj !== null) {
    return valueOrObj;
  }
  if (DIRECT_SHIPPING_STATUSES.has(valueOrObj)) {
    return { shipping_status: valueOrObj };
  }
  return { status: valueOrObj };
}

const DIRECT_NEXT_STATUS = {
  completed: "domestic_arrived",
  domestic_arrived: "processing",
  processing: "shipped",
};

const DIRECT_WORKFLOW_STATUSES = [
  "completed",
  "domestic_arrived",
  "processing",
  "shipped",
];
const DIRECT_ZONE_SUMMARY_VISIBLE_STATUSES = new Set([
  "domestic_arrived",
  "processing",
]);

function getDirectNextStatus(status) {
  return DIRECT_NEXT_STATUS[status] || null;
}

function getDirectStatusLabel(status) {
  return DIRECT_STATUS_LABELS[status] || status;
}

function getDirectWorkflowStatusOptionsHtml(currentStatus) {
  return DIRECT_WORKFLOW_STATUSES.map(
    (status) =>
      `<option value="${status}"${
        status === currentStatus ? " selected" : ""
      }>${getDirectStatusLabel(status)}</option>`,
  ).join("");
}

function getDirectZoneDisplayNameByCode(code) {
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

function getDirectProcessingStatusLabel(bid) {
  const zoneName = getDirectZoneDisplayNameByCode(bid.wms_location_code);
  if (zoneName) return `작업중(${zoneName})`;
  return "작업중";
}

function renderProcessingZoneSummary(bids) {
  const wrap = document.getElementById("processingZoneSummary");
  const grid = document.getElementById("processingZoneGrid");
  const title = wrap?.querySelector(".title");
  if (!wrap || !grid) return;

  if (!DIRECT_ZONE_SUMMARY_VISIBLE_STATUSES.has(currentStatus)) {
    currentProcessingZoneCode = "";
    wrap.style.display = "none";
    grid.innerHTML = "";
    return;
  }

  if (title) {
    const label = currentStatus ? getDirectStatusLabel(currentStatus) : "전체";
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
          : getDirectZoneDisplayNameByCode(code) || code;
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
        renderProcessingZoneSummary(currentDirectBidsData);
        renderDirectBidsTable(filterDirectBidsByZone(currentDirectBidsData));
      });
    });
  wrap.style.display = "block";
}

// 현재 선택된 필터 상태 - URL로 관리
let currentStatus = "";
let highestOnly = false;
let currentPage = 1;
let itemsPerPage = 100;
let totalPages = 1;
let currentSortBy = "original_scheduled_date";
let currentSortOrder = "desc";
let currentProcessingZoneCode = "";
let from; // 필터 상태에 따라 데이터 로드
async function filterByStatus(status) {
  currentStatus = status;
  updateBulkShipButtonLabel();
  currentPage = 1;
  updateURLState();
  await loadDirectBids();
}

function updateBulkShipButtonLabel() {
  const bulkShipBtn = document.getElementById("bulkShipBtn");
  const bulkStatusTarget = document.getElementById("bulkStatusTarget");
  if (bulkShipBtn) {
    bulkShipBtn.textContent = "일괄 상태 변경";
  }
  if (bulkStatusTarget && DIRECT_WORKFLOW_STATUSES.includes(currentStatus)) {
    bulkStatusTarget.value = currentStatus;
  }
}

// 페이지 변경
function changePage(page) {
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  updateURLState();
  loadDirectBids();
}

let fromDate = "";
let toDate = "";
let currentSearch = "";
let currentAucNum = "";

// 검색 디바운스 타이머
let searchTimeout = null;

// 현재 표시된 직접경매 데이터 저장 (실시간 업데이트용)
let currentDirectBidsData = [];
let directDetailImages = [];
let directDetailImageIndex = 0;

// 실시간 업데이트 매니저 (products.js RealtimeManager 패턴 참고)
const DirectBidsRealtimeManager = (function () {
  let socket = null;

  /**
   * Socket.IO 초기화
   */
  function initializeSocket() {
    if (typeof io === "undefined") {
      console.warn("Socket.IO not available");
      return null;
    }

    socket = io({
      reconnectionAttempts: 5,
      timeout: 10000,
    });

    socket.on("connect_error", (error) => {
      console.error("Socket connection error:", error);
      setupFallbackPolling();
    });

    // 데이터 업데이트 이벤트 수신
    socket.on("data-updated", (data) => {
      console.log(`직접경매 업데이트 알림: ${data.itemIds.length}개 아이템`);

      // 현재 표시된 직접경매 테이블의 item_id들과 비교
      const visibleItemIds = getVisibleDirectBidItemIds();
      const itemsToUpdate = data.itemIds.filter((id) =>
        visibleItemIds.includes(id),
      );

      if (itemsToUpdate.length > 0) {
        console.log(
          `${itemsToUpdate.length}개 아이템 업데이트 - 테이블 새로고침`,
        );
        debouncedLoadDirectBids();
      }
    });

    socket.on("connect", () => {
      console.log("직접경매 관리 페이지 - 서버에 연결됨");
    });

    socket.on("disconnect", () => {
      console.log("직접경매 관리 페이지 - 서버 연결 해제됨");
    });

    return socket;
  }

  /**
   * 폴백 폴링 설정 (products.js와 동일)
   */
  function setupFallbackPolling() {
    // Socket 연결 실패 시 주기적 폴링
    setInterval(() => {
      debouncedLoadDirectBids();
    }, 30000); // 30초마다
  }

  return {
    initializeSocket,
  };
})();

// 현재 테이블에 표시된 item_id들 추출 (메모리 기반 - products.js 패턴)
function getVisibleDirectBidItemIds() {
  return currentDirectBidsData.map((bid) => bid.item_id);
}

// 디바운스된 데이터 로드 함수
let loadDirectBidsDebounceTimer = null;
function debouncedLoadDirectBids() {
  if (loadDirectBidsDebounceTimer) clearTimeout(loadDirectBidsDebounceTimer);
  loadDirectBidsDebounceTimer = setTimeout(() => {
    loadDirectBids();
  }, 300);
}

// URL 상태 관리자
const urlStateManager = window.URLStateManager;

// 기본 상태 정의
const defaultState = {
  page: 1,
  sort: "original_scheduled_date",
  order: "desc",
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
    "search",
    "status",
    "aucNum",
    "zone",
  ];
  const state = urlStateManager.loadFromURL(defaultState, stateKeys);

  currentPage = state.page;
  currentSortBy = state.sort;
  currentSortOrder = state.order;
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

  if (searchInput) searchInput.value = currentSearch;
  if (sortBySelect) sortBySelect.value = currentSortBy;

  statusButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.status === currentStatus);
  });

  aucNumButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.aucNum === currentAucNum);
  });

  updateBulkShipButtonLabel();
}

// 페이지 로드 시 실행
document.addEventListener("DOMContentLoaded", function () {
  // URL에서 상태 복원
  initializeFromURL();

  // 🔥 실시간 업데이트 웹소켓 초기화
  DirectBidsRealtimeManager.initializeSocket();

  // 초기 데이터 로드
  loadDirectBids();

  // 브라우저 뒤로가기/앞으로가기 처리
  window.addEventListener("popstate", function () {
    initializeFromURL();
    loadDirectBids();
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

  // 빠른 날짜 필터 이벤트
  document.querySelectorAll("[data-range]").forEach((button) => {
    button.addEventListener("click", handleQuickDateFilter);
  });

  // 필터 탭 이벤트
  document.querySelectorAll(".filter-tab").forEach((button) => {
    button.addEventListener("click", function () {
      const status = this.dataset.status;
      currentStatus = status;
      updateBulkShipButtonLabel();
      currentPage = 1;
      updateURLState();
      loadDirectBids();
    });
  });

  // 경매장 필터 이벤트
  document.querySelectorAll(".auc-num-filter").forEach((button) => {
    button.addEventListener("click", function () {
      const aucNum = this.dataset.aucNum;
      currentAucNum = aucNum;
      currentPage = 1;
      updateURLState();
      loadDirectBids();
    });
  });

  // 필터 토글 이벤트
  document
    .getElementById("toggleHighestOnly")
    .addEventListener("change", function () {
      highestOnly = this.checked;
      currentPage = 1;
      loadDirectBids();
    });

  // 입찰 완료 모달 제출 버튼
  document
    .getElementById("submitComplete")
    .addEventListener("click", submitCompleteBid);

  // 낙찰 실패 모달 제출 버튼
  document
    .getElementById("submitCancel")
    .addEventListener("click", submitCancelBid);

  // 플랫폼 반영 완료 표시 모달 제출 버튼
  document
    .getElementById("submitMarkAsSubmitted")
    .addEventListener("click", markAsSubmitted);

  // 낙찰 금액 입력 시 관부가세 포함 가격 업데이트
  document
    .getElementById("winningPrice")
    .addEventListener("input", updateWinningPriceKRW);

  // 페이지 크기 변경 이벤트
  document.getElementById("pageSize")?.addEventListener("change", function () {
    itemsPerPage = parseInt(this.value);
    currentPage = 1;
    loadDirectBids();
  });

  document
    .getElementById("aucNumFilter")
    ?.addEventListener("change", function () {
      currentAucNum = this.value;
      currentPage = 1;
      updateURLState();
      loadDirectBids();
    });

  // 정렬 옵션 변경 이벤트
  document.getElementById("sortBy")?.addEventListener("change", function () {
    currentSortBy = this.value;
    currentPage = 1;
    updateURLState();
    loadDirectBids();
  });

  // 정렬 방향 변경 이벤트
  document.getElementById("sortOrder")?.addEventListener("change", function () {
    currentSortOrder = this.value;
    currentPage = 1;
    updateURLState();
    loadDirectBids();
  });

  // 날짜 필터 적용 버튼 이벤트
  document
    .getElementById("applyDateFilter")
    ?.addEventListener("click", function () {
      fromDate = document.getElementById("fromDate").value;
      toDate = document.getElementById("toDate").value;
      currentPage = 1;
      document
        .querySelectorAll("[data-range]")
        .forEach((b) => b.classList.remove("active"));
      loadDirectBids();
    });

  // 날짜 필터 초기화 버튼 이벤트
  document
    .getElementById("resetDateFilter")
    ?.addEventListener("click", function () {
      document.getElementById("fromDate").value = "";
      document.getElementById("toDate").value = "";
      fromDate = "";
      toDate = "";
      currentPage = 1;
      document
        .querySelectorAll("[data-range]")
        .forEach((b) => b.classList.remove("active"));
      loadDirectBids();
    });

  // 일괄 작업 이벤트 (완료/낙찰실패는 토글에서 선택 후 일괄 변경으로 처리)
  document
    .getElementById("bulkShipBtn")
    ?.addEventListener("click", function () {
      const target = document.getElementById("bulkStatusTarget")?.value;
      if (target === "cancelled") {
        openBulkCancelModal();
        return;
      }
      if (target === "completed") {
        openBulkCompleteModal();
        return;
      }
      bulkMarkAsShipped();
    });
  document
    .getElementById("bulkMarkSubmittedBtn")
    ?.addEventListener("click", openBulkMarkAsSubmittedModal);
  document
    .getElementById("bulkWinningPrice")
    ?.addEventListener("input", updateBulkWinningPriceKRW);
  document
    .getElementById("submitBulkComplete")
    ?.addEventListener("click", submitBulkComplete);
  document
    .getElementById("submitBulkCancel")
    ?.addEventListener("click", submitBulkCancel);
  document
    .getElementById("submitBulkMarkAsSubmitted")
    ?.addEventListener("click", submitBulkMarkAsSubmitted);
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
      loadDirectBids();
    }
  }, 300);
}

function handleSearchSubmit() {
  const searchValue = document.getElementById("searchInput").value.trim();
  if (currentSearch !== searchValue) {
    currentSearch = searchValue;
    currentPage = 1;
    updateURLState();
    loadDirectBids();
  }
}

function handleSearchClear() {
  document.getElementById("searchInput").value = "";
  if (currentSearch !== "") {
    currentSearch = "";
    currentPage = 1;
    updateURLState();
    loadDirectBids();
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
  currentPage = 1;

  document
    .querySelectorAll("[data-range]")
    .forEach((b) => b.classList.remove("active"));
  event.target.closest("[data-range]")?.classList.add("active");

  loadDirectBids();
}

// 직접 경매 데이터 로드
async function loadDirectBids() {
  try {
    showLoading("directBidsTableBody");

    const directBids = await fetchDirectBids(
      currentStatus,
      highestOnly,
      currentPage,
      itemsPerPage,
      currentSortBy,
      currentSortOrder,
      fromDate,
      toDate,
      currentSearch,
      currentAucNum,
    );
    const filteredBids = filterDirectBidsByZone(directBids?.bids || []);

    if (!directBids?.bids || directBids.count === 0) {
      currentDirectBidsData = []; // 데이터 없을 때 초기화
      showNoData("directBidsTableBody", "직접 경매 데이터가 없습니다.");
      renderPagination(0, 0, 0);
      renderProcessingZoneSummary([]);
      return;
    }

    // 🔥 현재 데이터를 전역 변수에 저장 (실시간 업데이트용)
    currentDirectBidsData = directBids.bids;

    if (!filteredBids.length) {
      showNoData(
        "directBidsTableBody",
        "선택한 존의 데이터가 없습니다.",
      );
    } else {
      renderDirectBidsTable(filteredBids);
    }
    renderProcessingZoneSummary(directBids.bids);
    renderPagination(
      directBids.currentPage,
      directBids.totalPages,
      directBids.total,
    );
    totalPages = directBids.totalPages;
  } catch (error) {
    currentDirectBidsData = []; // 에러 시 데이터 초기화
    handleError(error, "직접 경매 데이터를 불러오는 중 오류가 발생했습니다.");
    showNoData(
      "directBidsTableBody",
      "데이터를 불러오는 중 오류가 발생했습니다.",
    );
    renderPagination(0, 0, 0);
    renderProcessingZoneSummary([]);
  }
}

function filterDirectBidsByZone(bids) {
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

// 직접 경매 테이블 렌더링
function renderDirectBidsTable(directBids) {
  const tableBody = document.getElementById("directBidsTableBody");
  let html = "";

  // URL 매핑 함수
  const linkFunc = {
    1: (itemId) => `https://www.ecoauc.com/client/auction-items/view/${itemId}`,
    2: (itemId) =>
      `https://bid.brand-auc.com/items/detail?uketsukeBng=${itemId}`,
    3: (itemId) => `https://www.starbuyers-global-auction.com/item/${itemId}`,
    4: (itemId, additionalInfo) =>
      `https://auction.mekiki.ai/en/auction/${additionalInfo.event_id}/${itemId}`,
    5: (itemId) => `https://penguin-auction.jp/product/detail/${itemId}/`,
  };

  directBids.forEach((bid) => {
    // 상태에 따른 배지 스타일
    let statusBadge = "";
    switch (bid.status) {
      case "active":
        statusBadge = '<span class="badge badge-info">활성</span>';
        break;
      case "completed": {
        const ss = bid.shipping_status || "pending";
        if (ss === "domestic_arrived") {
          statusBadge = '<span class="badge badge-warning">국내도착</span>';
        } else if (ss === "processing") {
          statusBadge = `<span class="badge badge-dark">${getDirectProcessingStatusLabel(bid)}</span>`;
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
          data-bid-type="direct"
          data-repair-details="${escapeHtml(bid.repair_details || "")}"
          data-repair-fee="${bid.repair_fee || 0}"
          data-repair-requested-at="${bid.repair_requested_at || ""}"
          onclick="openRepairModalFromButton(this)">접수됨</button>`;
      } else {
        // 수선 미접수 - 클릭 시 수선 접수 모달
        repairButton = `<button class="btn btn-sm btn-secondary" onclick="openRepairModal(${bid.id}, 'direct')">수선 접수</button>`;
      }
    } else {
      repairButton = "-";
    }

    // 플랫폼 반영 상태 배지
    let submittedBadge = "";
    if (bid.submitted_to_platform) {
      submittedBadge = '<span class="badge badge-success">반영됨</span>';
    } else {
      submittedBadge = '<span class="badge badge-warning">미반영</span>';
    }

    // 작업 버튼 - 한 줄, 동일 크기(btn-sm)
    let actionButtons = `<div class="action-buttons-row"><button class="btn btn-sm btn-secondary" onclick="openEditBidModal(${bid.id})">수정</button>`;

    if (bid.status === "active") {
      actionButtons += `
        <button class="btn btn-sm btn-secondary" onclick="openCancelModal(${bid.id})">낙찰 실패</button>
      `;
    } else if (bid.status === "completed") {
      actionButtons += `
        <select class="form-control form-control-sm status-target-select" id="directStatusTarget-${bid.id}" data-current-status="${bid.shipping_status || "completed"}">
          ${getDirectWorkflowStatusOptionsHtml(bid.shipping_status || "completed")}
        </select>
        <button class="btn btn-info btn-sm" onclick="moveDirectBidStatus(${bid.id})">상태 변경</button>
      `;
    }

    // 플랫폼 반영 관련 작업 버튼
    if (!bid.submitted_to_platform) {
      actionButtons += `<button class="btn btn-sm btn-secondary" onclick="openMarkAsSubmittedModal(${bid.id})">반영됨으로 표시</button>`;
    }
    actionButtons += `</div>`;

    // 상품 정보 가져오기
    let imageUrl = "/images/no-image.png";
    let itemTitle = "-";
    let itemCategory = "-";
    let itemBrand = "-";
    let itemRank = "-";
    let itemPrice = "-";
    let auc_num = null;

    // 날짜를 KST로 변환
    let scheduledDate = "-";
    if (
      bid.item &&
      (bid.item.original_scheduled_date || bid.item.scheduled_date)
    ) {
      const date = new Date(
        bid.item.original_scheduled_date || bid.item.scheduled_date,
      );
      scheduledDate = new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
    }

    if (bid.item) {
      imageUrl = bid.item.image || "/images/no-image.png";
      itemTitle = bid.item.original_title || "-";
      itemCategory = bid.item.category || "-";
      itemBrand = bid.item.brand || "-";
      itemRank = bid.item.rank || "-";
      itemPrice = bid.item.starting_price
        ? formatCurrency(bid.item.starting_price)
        : "-";
      auc_num = bid.item.auc_num || null;
    }

    // auc_num을 이용한, 적절한 URL 생성
    let itemUrl = "#";
    let additionalInfo = {};
    if (bid.item?.additional_info) {
      try {
        additionalInfo = JSON.parse(bid.item.additional_info);
      } catch (e) {
        additionalInfo = {};
      }
    }
    if (bid.item && bid.item.auc_num && linkFunc[bid.item.auc_num]) {
      itemUrl = linkFunc[bid.item.auc_num](bid.item_id, additionalInfo);
    }

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
    let totalPrice = "-";
    let winningTotalPrice = "-";

    if (bid.current_price && auc_num && itemCategory) {
      const calculatedPrice = calculateTotalPrice(
        bid.current_price,
        auc_num,
        itemCategory,
      );
      totalPrice = formatCurrency(calculatedPrice, "KRW");
    }

    if (bid.winning_price && auc_num && itemCategory) {
      const calculatedWinningPrice = calculateTotalPrice(
        bid.winning_price,
        auc_num,
        itemCategory,
      );
      winningTotalPrice = formatCurrency(calculatedWinningPrice, "KRW");
    }

    html += `
  <tr>
    <td><input type="checkbox" class="bid-checkbox" data-bid-id="${
      bid.id
    }" data-current-price="${bid.current_price || 0}" data-auc-num="${
      bid.item?.auc_num || 1
    }" data-category="${bid.item?.category || "기타"}" data-status="${bid.status}" /></td>
    <td>${bid.id}</td>
    <td>
      <div class="item-info">
        <img src="${imageUrl}" alt="${itemTitle}" class="item-thumbnail" />
        <div class="item-details">
          <div>
            <a
              href="${escapeHtml(itemUrl)}"
              target="_blank"
              rel="noopener noreferrer"
              class="item-id-link"
              onclick="return openDirectProductDetail(event, this);"
              data-item-id="${escapeHtml(bid.item_id || "")}"
              data-bid-status="${escapeHtml(bid.status || "")}"
              data-auc-num="${escapeHtml(bid.item?.auc_num || "")}"
              data-image="${escapeHtml(imageUrl)}"
              data-title="${escapeHtml(itemTitle || "-")}"
              data-brand="${escapeHtml(itemBrand || "-")}"
              data-category="${escapeHtml(itemCategory || "-")}"
              data-rank="${escapeHtml(itemRank || "-")}"
              data-accessory-code="${escapeHtml(bid.item?.accessory_code || "-")}"
              data-scheduled="${escapeHtml(scheduledDate || "-")}"
              data-origin-url="${escapeHtml(itemUrl || "#")}"
            >${escapeHtml(bid.item_id || "-")}</a>
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
     <div>현지가: ${formatCurrency(bid.current_price, "JPY")}</div>
     <div class="total-price">최종가: ${totalPrice}</div>
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
   <td>${formatDateTime(bid.updated_at)}</td>
   <td>${statusBadge}</td>
   <td>${appraisalBadge}</td>
   <td>${repairButton}</td>
	   <td>${submittedBadge}</td>
	   <td class="action-cell">
       <div class="action-buttons-row">
	       ${actionButtons}
       </div>
	   </td>
	 </tr>
	`;
  });

  tableBody.innerHTML = html;
  addCheckboxEventListeners();
}

function setDirectDetailText(id, value) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = value || "-";
}

function setDirectDetailImage(src) {
  const img = document.getElementById("directDetailMainImage");
  if (!img) return;
  img.classList.remove("zoom-active");
  img.style.transformOrigin = "center center";
  img.src = src || "/images/no-image.png";
}

function setDirectDetailOrigin(url) {
  const link = document.getElementById("directDetailOriginLink");
  if (!link) return;
  const safeUrl = url && url !== "#" ? url : "";
  link.href = safeUrl || "#";
  link.style.pointerEvents = safeUrl ? "auto" : "none";
  link.style.opacity = safeUrl ? "1" : "0.5";
}

function applyDirectDetailData(data = {}) {
  setDirectDetailText("directDetailItemId", data.itemId || "-");
  setDirectDetailText("directDetailTitle", data.title || "-");
  setDirectDetailText("directDetailBrand", data.brand || "-");
  setDirectDetailText("directDetailCategory", data.category || "-");
  setDirectDetailText("directDetailRank", data.rank || "-");
  setDirectDetailText("directDetailScheduled", data.scheduled || "-");
  setDirectDetailText("directDetailAccessoryCode", data.accessoryCode || "-");
  setDirectDetailText("directDetailDescription", data.description || "-");
  setDirectDetailOrigin(data.originUrl || "#");
  setDirectDetailImage(data.image || "/images/no-image.png");
}

function renderDirectDetailThumbs() {
  const wrap = document.getElementById("directDetailThumbs");
  if (!wrap) return;
  wrap.innerHTML = "";
  directDetailImages.forEach((src, idx) => {
    const activeClass = idx === directDetailImageIndex ? "active" : "";
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
      showDirectDetailImageAt(idx);
    });
  });
}

function updateDirectDetailNavState() {
  const prevBtn = document.getElementById("directDetailPrevBtn");
  const nextBtn = document.getElementById("directDetailNextBtn");
  if (prevBtn) prevBtn.disabled = directDetailImageIndex <= 0;
  if (nextBtn) nextBtn.disabled = directDetailImageIndex >= directDetailImages.length - 1;
}

function showDirectDetailImageAt(index) {
  if (!directDetailImages.length) return;
  if (index < 0 || index >= directDetailImages.length) return;
  directDetailImageIndex = index;
  setDirectDetailImage(directDetailImages[directDetailImageIndex]);
  renderDirectDetailThumbs();
  updateDirectDetailNavState();
}

function setDirectDetailImages(images) {
  const normalized = Array.isArray(images)
    ? images.filter((x) => String(x || "").trim())
    : [];
  directDetailImages = normalized.length ? normalized : ["/images/no-image.png"];
  directDetailImageIndex = 0;
  showDirectDetailImageAt(0);
}

function bindDirectDetailGalleryControls() {
  document.getElementById("directDetailPrevBtn")?.addEventListener("click", () => {
    showDirectDetailImageAt(directDetailImageIndex - 1);
  });
  document.getElementById("directDetailNextBtn")?.addEventListener("click", () => {
    showDirectDetailImageAt(directDetailImageIndex + 1);
  });
}

function bindDirectDetailImageZoomControls() {
  const wrap = document.getElementById("directDetailMainImageWrap");
  const img = document.getElementById("directDetailMainImage");
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

async function openDirectProductDetail(event, anchorEl) {
  if (event) event.preventDefault();
  const anchor = anchorEl;
  if (!anchor) return false;

  const itemId = String(anchor.dataset.itemId || "").trim();
  const aucNum = String(anchor.dataset.aucNum || "").trim();
  const modal = window.setupModal("directProductDetailModal");
  if (!modal || !itemId) return false;

  applyDirectDetailData({
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
  setDirectDetailImages([anchor.dataset.image || "/images/no-image.png"]);
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
    setDirectDetailImages(detailImages);

    applyDirectDetailData({
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
    setDirectDetailText("directDetailDescription", "상세 정보를 불러오지 못했습니다.");
  }
  return false;
}

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

function updateBulkActionButtons() {
  const checkedCount = document.querySelectorAll(
    ".bid-checkbox:checked",
  ).length;
  const selectionHint = document.getElementById("bulkSelectionHint");
  const bulkShipBtn = document.getElementById("bulkShipBtn");
  const bulkMarkSubmittedBtn = document.getElementById("bulkMarkSubmittedBtn");
  if (bulkShipBtn) bulkShipBtn.disabled = checkedCount === 0;
  if (bulkMarkSubmittedBtn) bulkMarkSubmittedBtn.disabled = checkedCount === 0;
  if (selectionHint) {
    selectionHint.textContent = `선택 ${checkedCount}건`;
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

  // 해당 입찰 찾기
  const checkbox = document.querySelector(
    `.bid-checkbox[data-bid-id="${bidId}"]`,
  );
  if (!checkbox) return;

  const auc_num = parseInt(checkbox.getAttribute("data-auc-num")) || 1;
  const category = checkbox.getAttribute("data-category") || "기타";
  const currentPrice =
    parseFloat(checkbox.getAttribute("data-current-price")) || 0;

  // 관부가세 포함 가격 계산
  const totalPrice = calculateTotalPrice(winningPrice, auc_num, category);
  document.getElementById("winningPriceKRW").textContent =
    `관부가세 포함: ${formatCurrency(totalPrice, "KRW")}`;

  // 현재 입찰가와 비교
  const priceComparisonMsg = document.getElementById("priceComparisonMessage");
  if (currentPrice && winningPrice > currentPrice) {
    priceComparisonMsg.textContent =
      "※ 입력한 금액이 현재 입찰가보다 높습니다. 낙찰 실패로 처리됩니다.";
    priceComparisonMsg.className = "price-comparison warning";
  } else if (currentPrice && winningPrice < currentPrice) {
    priceComparisonMsg.textContent =
      "※ 입력한 금액이 현재 입찰가보다 낮습니다. 낙찰 완료로 처리됩니다.";
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
    await completeDirectBid(bidId, winningPrice);
    closeAllModals();
    await loadDirectBids();
  } catch (error) {
    handleError(error, "입찰 완료 처리 중 오류가 발생했습니다.");
  }
}

// 낙찰 실패 모달 열기 - 공통 함수 활용
function openCancelModal(bidId) {
  document.getElementById("cancelBidId").value = bidId;

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
    await cancelDirectBid(bidId);
    closeAllModals();
    showAlert("낙찰 실패로 처리되었습니다.", "success");
    await loadDirectBids();
  } catch (error) {
    handleError(error, "낙찰 실패 처리 중 오류가 발생했습니다.");
  }
}

// 플랫폼 반영 완료 표시 모달 열기 - 공통 함수 활용
function openMarkAsSubmittedModal(bidId) {
  document.getElementById("markSubmittedBidId").value = bidId;

  const modal = window.setupModal("markAsSubmittedModal");
  if (modal) {
    modal.show();
  }
}

// 플랫폼 반영 완료 표시 처리
async function markAsSubmitted() {
  const bidId = parseInt(document.getElementById("markSubmittedBidId").value);

  if (!bidId) {
    showAlert("입찰 ID가 유효하지 않습니다.");
    return;
  }

  try {
    await markDirectBidAsSubmitted(bidId);
    closeAllModals();
    showAlert("플랫폼 반영 완료로 표시되었습니다.", "success");
    await loadDirectBids();
  } catch (error) {
    handleError(error, "반영 완료 표시 중 오류가 발생했습니다.");
  }
}

// 일괄 작업 모달 및 제출 함수들 - 공통 함수 활용
function openBulkCompleteModal() {
  const count = document.querySelectorAll(".bid-checkbox:checked").length;
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

  // 카테고리와 경매번호는 일괄 처리에서 단순화를 위해 기본값 사용
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

    await completeDirectBid(bidIds, winningPrice);

    closeAllModals();
    await loadDirectBids();
  } catch (error) {
    handleError(error, "일괄 입찰 완료 처리 중 오류가 발생했습니다.");
  }
}

function openBulkCancelModal() {
  const count = document.querySelectorAll(".bid-checkbox:checked").length;
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

    await cancelDirectBid(bidIds);

    closeAllModals();
    showAlert(
      `${bidIds.length}개 입찰이 낙찰 실패로 처리되었습니다.`,
      "success",
    );
    await loadDirectBids();
  } catch (error) {
    handleError(error, "일괄 입찰 취소 처리 중 오류가 발생했습니다.");
  }
}

function openBulkMarkAsSubmittedModal() {
  const count = document.querySelectorAll(".bid-checkbox:checked").length;
  if (count === 0) return;
  document.getElementById("bulkMarkSubmittedCount").textContent = count;

  const modal = window.setupModal("bulkMarkAsSubmittedModal");
  if (modal) {
    modal.show();
  }
}

// 일괄 플랫폼 반영 완료 제출
async function submitBulkMarkAsSubmitted() {
  const checkedBids = document.querySelectorAll(".bid-checkbox:checked");
  if (checkedBids.length === 0) {
    closeAllModals();
    return;
  }

  try {
    const bidIds = Array.from(checkedBids).map((checkbox) =>
      parseInt(checkbox.dataset.bidId),
    );

    await markDirectBidAsSubmitted(bidIds);

    closeAllModals();
    showAlert(
      `${bidIds.length}개 입찰이 플랫폼 반영 완료로 표시되었습니다.`,
      "success",
    );
    await loadDirectBids();
  } catch (error) {
    handleError(error, "일괄 반영 완료 표시 중 오류가 발생했습니다.");
  }
}

// 수정 모달 열기
function openEditBidModal(bidId) {
  const tableBody = document.getElementById("directBidsTableBody");
  const rows = tableBody.querySelectorAll("tr");
  let currentBid = null;

  for (let row of rows) {
    const checkbox = row.querySelector(".bid-checkbox");
    if (checkbox && checkbox.dataset.bidId == bidId) {
      const cells = row.querySelectorAll("td");
      const currentPriceText = cells[4]?.textContent || "";
      const winningPriceText = cells[5]?.textContent || "";
      const statusText = cells[8]?.textContent || "";
      const submittedText = cells[9]?.textContent || "";

      const currentPriceMatch = currentPriceText.match(/현지가:\s*¥([\d,]+)/);
      const winningPriceMatch = winningPriceText.match(/현지가:\s*¥([\d,]+)/);

      currentBid = {
        id: bidId,
        current_price: currentPriceMatch
          ? parseInt(currentPriceMatch[1].replace(/,/g, ""))
          : 0,
        winning_price: winningPriceMatch
          ? parseInt(winningPriceMatch[1].replace(/,/g, ""))
          : null,
        status: statusText.includes("활성")
          ? "active"
          : statusText.includes("완료")
            ? "completed"
            : statusText.includes("국내도착")
              ? "domestic_arrived"
              : statusText.includes("작업중")
                ? "processing"
                : statusText.includes("출고됨")
                  ? "shipped"
                  : "cancelled",
        submitted_to_platform: submittedText.includes("반영됨"),
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
  document.getElementById("editCurrentPrice").value =
    currentBid.current_price || "";
  document.getElementById("editStatus").value = currentBid.status;
  document.getElementById("editSubmittedToPlatform").checked =
    currentBid.submitted_to_platform;
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
  const currentPriceValue = document.getElementById("editCurrentPrice").value;
  const status = document.getElementById("editStatus").value;
  const submittedToPlatform = document.getElementById(
    "editSubmittedToPlatform",
  ).checked;
  const winningPriceValue = document.getElementById("editWinningPrice").value;

  if (!bidId) {
    showAlert("입찰 ID가 유효하지 않습니다.");
    return;
  }

  try {
    const updateData = {};

    if (currentPriceValue)
      updateData.current_price = parseInt(currentPriceValue);
    if (status) Object.assign(updateData, buildDirectBidUpdate(status));
    updateData.submitted_to_platform = submittedToPlatform;
    if (winningPriceValue)
      updateData.winning_price = parseInt(winningPriceValue);

    await updateDirectBid(bidId, updateData);

    closeAllModals();
    showAlert("입찰 정보가 수정되었습니다.", "success");
    await loadDirectBids();
  } catch (error) {
    handleError(error, "입찰 수정 중 오류가 발생했습니다.");
  }
}

// 완료/국내도착/작업중 상태를 다음 단계로 변경
async function advanceDirectBidStatus(bidId, currentStatus) {
  const nextStatus = getDirectNextStatus(currentStatus);
  if (!nextStatus) {
    showAlert("이 상태는 다음 단계로 변경할 수 없습니다.", "warning");
    return;
  }

  if (
    !confirm(
      `이 입찰을 ${getDirectStatusLabel(nextStatus)} 상태로 변경하시겠습니까?`,
    )
  ) {
    return;
  }

  try {
    await updateDirectBid(bidId, buildDirectBidUpdate(nextStatus));
    showAlert(
      `상태가 ${getDirectStatusLabel(nextStatus)}으로 변경되었습니다.`,
      "success",
    );
    await loadDirectBids();
  } catch (error) {
    handleError(error, "상태 변경 중 오류가 발생했습니다.");
  }
}

async function moveDirectBidStatus(bidId) {
  const select = document.getElementById(`directStatusTarget-${bidId}`);
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
      `이 입찰을 ${getDirectStatusLabel(targetStatus)} 상태로 변경하시겠습니까?`,
    )
  ) {
    return;
  }

  try {
    await updateDirectBid(bidId, buildDirectBidUpdate(targetStatus));
    showAlert(
      `상태가 ${getDirectStatusLabel(targetStatus)}으로 변경되었습니다.`,
      "success",
    );
    await loadDirectBids();
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

  if (!targetStatus || !DIRECT_WORKFLOW_STATUSES.includes(targetStatus)) {
    showAlert("변경할 상태를 선택해주세요.", "warning");
    return;
  }

  checkedBoxes.forEach((cb) => {
    const bidId = parseInt(cb.dataset.bidId);
    const currentBidStatus = cb.dataset.status || "";

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
      `선택된 ${bidUpdates.length}개 항목을 ${getDirectStatusLabel(targetStatus)} 상태로 변경하시겠습니까?`,
    )
  ) {
    return;
  }

  try {
    const promises = bidUpdates.map(({ bidId, nextStatus }) =>
      updateDirectBid(bidId, buildDirectBidUpdate(nextStatus)),
    );
    await Promise.all(promises);

    const skippedText =
      skippedSameStatus.length > 0
        ? ` (${skippedSameStatus.length}개는 이미 같은 상태여서 제외)`
        : "";
    showAlert(
      `${bidUpdates.length}개 항목이 ${getDirectStatusLabel(targetStatus)} 상태로 변경되었습니다.${skippedText}`,
      "success",
    );
    await loadDirectBids();
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
    await loadDirectBids();
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
    await loadDirectBids();
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

bindDirectDetailGalleryControls();
bindDirectDetailImageZoomControls();
