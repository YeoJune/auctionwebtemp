// public/js/admin/direct-bids.js

// 현재 선택된 필터 상태 - URL로 관리
let currentStatus = "";
let highestOnly = false;
let currentPage = 1;
let itemsPerPage = 10;
let totalPages = 1;
let currentSortBy = "original_scheduled_date";
let currentSortOrder = "desc";
let from; // 필터 상태에 따라 데이터 로드
async function filterByStatus(status) {
  currentStatus = status;
  currentPage = 1;
  updateURLState();
  await loadDirectBids();
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
        visibleItemIds.includes(id)
      );

      if (itemsToUpdate.length > 0) {
        console.log(
          `${itemsToUpdate.length}개 아이템 업데이트 - 테이블 새로고침`
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
};

// URL에서 상태 복원
function initializeFromURL() {
  const stateKeys = ["page", "sort", "order", "search", "status", "aucNum"];
  const state = urlStateManager.loadFromURL(defaultState, stateKeys);

  currentPage = state.page;
  currentSortBy = state.sort;
  currentSortOrder = state.order;
  currentSearch = state.search;
  currentStatus = state.status;
  currentAucNum = state.aucNum;

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
      loadDirectBids();
    });

  // 일괄 작업 이벤트
  document
    .getElementById("bulkCompleteBtn")
    ?.addEventListener("click", openBulkCompleteModal);
  document
    .getElementById("bulkCancelBtn")
    ?.addEventListener("click", openBulkCancelModal);
  document
    .getElementById("bulkShipBtn")
    ?.addEventListener("click", bulkMarkAsShipped);
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
      currentAucNum
    );

    if (!directBids?.bids || directBids.count === 0) {
      currentDirectBidsData = []; // 데이터 없을 때 초기화
      showNoData("directBidsTableBody", "직접 경매 데이터가 없습니다.");
      renderPagination(0, 0, 0);
      return;
    }

    // 🔥 현재 데이터를 전역 변수에 저장 (실시간 업데이트용)
    currentDirectBidsData = directBids.bids;

    renderDirectBidsTable(directBids.bids);
    renderPagination(
      directBids.currentPage,
      directBids.totalPages,
      directBids.total
    );
    totalPages = directBids.totalPages;
  } catch (error) {
    currentDirectBidsData = []; // 에러 시 데이터 초기화
    handleError(error, "직접 경매 데이터를 불러오는 중 오류가 발생했습니다.");
    showNoData(
      "directBidsTableBody",
      "데이터를 불러오는 중 오류가 발생했습니다."
    );
    renderPagination(0, 0, 0);
  }
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
  };

  directBids.forEach((bid) => {
    // 상태에 따른 배지 스타일
    let statusBadge = "";
    switch (bid.status) {
      case "active":
        statusBadge = '<span class="badge badge-info">활성</span>';
        break;
      case "completed":
        statusBadge = '<span class="badge badge-success">완료</span>';
        break;
      case "shipped":
        statusBadge = '<span class="badge badge-primary">출고됨</span>';
        break;
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

    // 플랫폼 반영 상태 배지
    let submittedBadge = "";
    if (bid.submitted_to_platform) {
      submittedBadge = '<span class="badge badge-success">반영됨</span>';
    } else {
      submittedBadge = '<span class="badge badge-warning">미반영</span>';
    }

    // 작업 버튼 - 수정 버튼 추가
    let actionButtons = `<button class="btn btn-sm btn-secondary" onclick="openEditBidModal(${bid.id})">수정</button>`;

    if (bid.status === "active") {
      actionButtons += `
        <button class="btn" onclick="openCompleteModal(${bid.id})">낙찰 완료</button>
        <button class="btn btn-secondary" onclick="openCancelModal(${bid.id})">낙찰 실패</button>
      `;
    } else if (bid.status === "completed") {
      actionButtons += `
        <button class="btn btn-info btn-sm" onclick="markAsShipped(${bid.id})">출고됨으로 변경</button>
      `;
    }

    // 플랫폼 반영 관련 작업 버튼
    let platformActionButton = "";
    if (!bid.submitted_to_platform) {
      platformActionButton = `
        <button class="btn btn-secondary" onclick="openMarkAsSubmittedModal(${bid.id})">반영됨으로 표시</button>
      `;
    }

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
        bid.item.original_scheduled_date || bid.item.scheduled_date
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
    if (bid.item && bid.item.auc_num && linkFunc[bid.item.auc_num]) {
      itemUrl = linkFunc[bid.item.auc_num](
        bid.item_id,
        JSON.parse(bid.item.additional_info)
      );
    }

    // 수수료 포함 가격 계산
    let totalPrice = "-";
    let winningTotalPrice = "-";

    if (bid.current_price && auc_num && itemCategory) {
      const calculatedPrice = calculateTotalPrice(
        bid.current_price,
        auc_num,
        itemCategory
      );
      totalPrice = formatCurrency(calculatedPrice, "KRW");
    }

    if (bid.winning_price && auc_num && itemCategory) {
      const calculatedWinningPrice = calculateTotalPrice(
        bid.winning_price,
        auc_num,
        itemCategory
      );
      winningTotalPrice = formatCurrency(calculatedWinningPrice, "KRW");
    }

    html += `
  <tr>
    <td><input type="checkbox" class="bid-checkbox" data-bid-id="${
      bid.id
    }" data-current-price="${bid.current_price || 0}" data-auc-num="${
      bid.item?.auc_num || 1
    }" data-category="${bid.item?.category || "기타"}" /></td>
    <td>${bid.id}</td>
    <td>
      <div class="item-info">
        <img src="${imageUrl}" alt="${itemTitle}" class="item-thumbnail" />
        <div class="item-details">
          <div><a href="${itemUrl}" target="_blank">${bid.item_id}</a></div>
          <div class="item-meta">
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
     <div>${bid.user_id}</div>
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
   <td>${submittedBadge}</td>
   <td>
     ${actionButtons}
     ${platformActionButton}
   </td>
 </tr>
`;
  });

  tableBody.innerHTML = html;
  addCheckboxEventListeners();
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
    ".bid-checkbox:checked"
  ).length;
  document.getElementById("bulkCompleteBtn").disabled = checkedCount === 0;
  document.getElementById("bulkCancelBtn").disabled = checkedCount === 0;
  document.getElementById("bulkShipBtn").disabled = checkedCount === 0;
  document.getElementById("bulkMarkSubmittedBtn").disabled = checkedCount === 0;
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
    document.getElementById("winningPrice").value
  );

  if (!winningPrice || isNaN(winningPrice)) {
    document.getElementById("winningPriceKRW").textContent = "관부가세 포함: -";
    document.getElementById("priceComparisonMessage").textContent = "";
    return;
  }

  // 해당 입찰 찾기
  const checkbox = document.querySelector(
    `.bid-checkbox[data-bid-id="${bidId}"]`
  );
  if (!checkbox) return;

  const auc_num = parseInt(checkbox.getAttribute("data-auc-num")) || 1;
  const category = checkbox.getAttribute("data-category") || "기타";
  const currentPrice =
    parseFloat(checkbox.getAttribute("data-current-price")) || 0;

  // 관부가세 포함 가격 계산
  const totalPrice = calculateTotalPrice(winningPrice, auc_num, category);
  document.getElementById(
    "winningPriceKRW"
  ).textContent = `관부가세 포함: ${formatCurrency(totalPrice, "KRW")}`;

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
    showAlert("입찰이 완료되었습니다.", "success");
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
    document.getElementById("bulkWinningPrice").value
  );
  if (!winningPrice || isNaN(winningPrice)) {
    document.getElementById("bulkWinningPriceKRW").textContent =
      "관부가세 포함: -";
    return;
  }

  // 카테고리와 경매번호는 일괄 처리에서 단순화를 위해 기본값 사용
  const totalPrice = calculateTotalPrice(winningPrice, 1, "기타");
  document.getElementById(
    "bulkWinningPriceKRW"
  ).textContent = `관부가세 포함: ${formatCurrency(totalPrice, "KRW")}`;
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
      parseInt(checkbox.dataset.bidId)
    );

    const winningPriceValue = document.getElementById("bulkWinningPrice").value;
    const winningPrice = winningPriceValue
      ? parseFloat(winningPriceValue)
      : undefined;

    await completeDirectBid(bidIds, winningPrice);

    closeAllModals();
    showAlert(`${bidIds.length}개 입찰이 완료되었습니다.`, "success");
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
      parseInt(checkbox.dataset.bidId)
    );

    await cancelDirectBid(bidIds);

    closeAllModals();
    showAlert(
      `${bidIds.length}개 입찰이 낙찰 실패로 처리되었습니다.`,
      "success"
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
      parseInt(checkbox.dataset.bidId)
    );

    await markDirectBidAsSubmitted(bidIds);

    closeAllModals();
    showAlert(
      `${bidIds.length}개 입찰이 플랫폼 반영 완료로 표시되었습니다.`,
      "success"
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
    "editSubmittedToPlatform"
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
    if (status) updateData.status = status;
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

// 완료 상태를 출고됨으로 변경
async function markAsShipped(bidId) {
  if (!confirm("이 입찰을 출고됨 상태로 변경하시겠습니까?")) {
    return;
  }

  try {
    await updateDirectBid(bidId, { status: "shipped" });
    showAlert("상태가 출고됨으로 변경되었습니다.", "success");
    await loadDirectBids();
  } catch (error) {
    handleError(error, "상태 변경 중 오류가 발생했습니다.");
  }
}

// 선택 항목 일괄 출고됨 처리
async function bulkMarkAsShipped() {
  const checkedBoxes = document.querySelectorAll(".bid-checkbox:checked");
  const bidIds = Array.from(checkedBoxes).map((cb) =>
    parseInt(cb.dataset.bidId)
  );

  if (bidIds.length === 0) {
    showAlert("선택된 항목이 없습니다.", "warning");
    return;
  }

  if (
    !confirm(`선택된 ${bidIds.length}개 항목을 출고됨 상태로 변경하시겠습니까?`)
  ) {
    return;
  }

  try {
    // 각 항목에 대해 개별적으로 상태 업데이트
    const promises = bidIds.map((bidId) =>
      updateDirectBid(bidId, { status: "shipped" })
    );
    await Promise.all(promises);

    showAlert(
      `${bidIds.length}개 항목이 출고됨으로 변경되었습니다.`,
      "success"
    );
    await loadDirectBids();
  } catch (error) {
    handleError(error, "일괄 상태 변경 중 오류가 발생했습니다.");
  }
}
