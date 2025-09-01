// public/js/admin/live-bids.js

// 현재 선택된 필터 상태
let currentStatus = "";
let currentPage = 1;
let itemsPerPage = 10;
let totalPages = 1;
let currentSortBy = "original_scheduled_date"; // 기본값 변경
let currentSortOrder = "desc";
let fromDate = "";
let toDate = "";
let currentSearch = ""; // 검색어 추가
let currentAucNum = ""; // 선택된 경매장

// 검색 디바운스 타이머
let searchTimeout = null;

// 페이지 로드 시 실행
document.addEventListener("DOMContentLoaded", function () {
  // 초기 데이터 로드
  loadLiveBids();

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

  // 일괄 작업 버튼 이벤트
  document
    .getElementById("bulkCompleteBtn")
    .addEventListener("click", openBulkCompleteModal);
  document
    .getElementById("bulkCancelBtn")
    .addEventListener("click", openBulkCancelModal);
  document
    .getElementById("bulkShipBtn")
    ?.addEventListener("click", bulkMarkAsShipped);

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
      currentPage = 1;
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
      currentPage = 1;
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
      loadLiveBids();
    }
  }, 300);
}

function handleSearchSubmit() {
  const searchValue = document.getElementById("searchInput").value.trim();
  if (currentSearch !== searchValue) {
    currentSearch = searchValue;
    currentPage = 1;
    loadLiveBids();
  }
}

function handleSearchClear() {
  document.getElementById("searchInput").value = "";
  if (currentSearch !== "") {
    currentSearch = "";
    currentPage = 1;
    loadLiveBids();
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
  loadLiveBids();
}

// 필터 상태에 따라 데이터 로드
async function filterByStatus(status) {
  currentStatus = status;
  currentPage = 1;
  await loadLiveBids();
}

// 페이지 변경 함수
function changePage(page) {
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  loadLiveBids();
}

// 현장 경매 데이터 로드
async function loadLiveBids() {
  try {
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
      currentAucNum
    );

    if (!liveBids?.bids || liveBids.count === 0) {
      showNoData("liveBidsTableBody", "현장 경매 데이터가 없습니다.");
      renderPagination(0, 0, 0);
      return;
    }

    renderLiveBidsTable(liveBids.bids);
    renderPagination(liveBids.currentPage, liveBids.totalPages, liveBids.total);
    totalPages = liveBids.totalPages;
  } catch (error) {
    handleError(error, "현장 경매 데이터를 불러오는 중 오류가 발생했습니다.");
    showNoData(
      "liveBidsTableBody",
      "데이터를 불러오는 중 오류가 발생했습니다."
    );
    renderPagination(0, 0, 0);
  }
}

// 페이지네이션 렌더링
function renderPagination(currentPage, totalPages, totalItems) {
  const paginationContainer = document.getElementById("pagination");
  if (!paginationContainer) return;

  if (totalPages <= 1) {
    paginationContainer.innerHTML = "";
    return;
  }

  let html = `<div class="pagination-info">총 ${totalItems}개 항목 중 ${
    (currentPage - 1) * itemsPerPage + 1
  } - ${Math.min(currentPage * itemsPerPage, totalItems)}개 표시</div>`;
  html += '<div class="pagination-controls">';

  // 이전 페이지 버튼
  html += `<button class="btn btn-sm ${currentPage === 1 ? "disabled" : ""}" ${
    currentPage === 1
      ? "disabled"
      : 'onclick="changePage(' + (currentPage - 1) + ')"'
  }>이전</button>`;

  // 페이지 번호 버튼들
  const maxPageButtons = 5;
  const startPage = Math.max(1, currentPage - Math.floor(maxPageButtons / 2));
  const endPage = Math.min(totalPages, startPage + maxPageButtons - 1);

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="btn btn-sm ${
      i === currentPage ? "active" : ""
    }" onclick="changePage(${i})">${i}</button>`;
  }

  // 다음 페이지 버튼
  html += `<button class="btn btn-sm ${
    currentPage === totalPages ? "disabled" : ""
  }" ${
    currentPage === totalPages
      ? "disabled"
      : 'onclick="changePage(' + (currentPage + 1) + ')"'
  }>다음</button>`;

  html += "</div>";

  paginationContainer.innerHTML = html;
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

    // 작업 버튼 - 수정 버튼 추가
    let actionButtons = `<button class="btn btn-sm btn-secondary" onclick="openEditBidModal(${bid.id})">수정</button>`;

    if (bid.status === "first") {
      actionButtons += `<button class="btn" onclick="openSecondPriceModal(${bid.id})">2차 가격 제안</button>`;
    } else if (bid.status === "final") {
      actionButtons += `
        <button class="btn" onclick="openCompleteModal(${bid.id})">낙찰 완료</button>
        <button class="btn btn-secondary" onclick="openCancelModal(${bid.id})">낙찰 실패</button>
      `;
    } else if (bid.status === "completed") {
      actionButtons += `
        <button class="btn btn-info btn-sm" onclick="markAsShipped(${bid.id})">출고됨으로 변경</button>
      `;
    }

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

    // auc_num을 이용한, 적절한 URL 생성
    let itemUrl = "#";
    if (bid.item && bid.item.auc_num && linkFunc[bid.item.auc_num]) {
      itemUrl = linkFunc[bid.item.auc_num](bid.item_id);
    }

    // 이미지 경로
    const imagePath =
      bid.item && bid.item.image ? bid.item.image : "/images/no-image.png";

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
          "KRW"
        );
      }

      if (bid.second_price) {
        secondTotalPrice = formatCurrency(
          calculateTotalPrice(bid.second_price, auc_num, category),
          "KRW"
        );
      }

      if (bid.final_price) {
        finalTotalPrice = formatCurrency(
          calculateTotalPrice(bid.final_price, auc_num, category),
          "KRW"
        );
      }

      if (bid.winning_price) {
        winningTotalPrice = formatCurrency(
          calculateTotalPrice(bid.winning_price, auc_num, category),
          "KRW"
        );
      }
    }

    html += `
  <tr>
    <td><input type="checkbox" class="bid-checkbox" data-bid-id="${
      bid.id
    }" data-final-price="${bid.final_price || 0}" data-auc-num="${
      bid.item?.auc_num || 1
    }" data-category="${bid.item?.category || "기타"}"></td>
    <td>${bid.id}</td>
    <td>
      <div class="item-info">
        <img src="${imagePath}" alt="${
      bid.item?.title || ""
    }" class="item-thumbnail" />
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
    <td>${formatDate(bid.updated_at)}</td>
    <td>${actionButtons}</td>
  </tr>
 `;
  });

  tableBody.innerHTML = html;
  addCheckboxEventListeners();
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
    ".bid-checkbox:checked"
  ).length;
  const bulkCompleteBtn = document.getElementById("bulkCompleteBtn");
  const bulkCancelBtn = document.getElementById("bulkCancelBtn");
  const bulkShipBtn = document.getElementById("bulkShipBtn");

  if (bulkCompleteBtn) bulkCompleteBtn.disabled = checkedCount === 0;
  if (bulkCancelBtn) bulkCancelBtn.disabled = checkedCount === 0;
  if (bulkShipBtn) bulkShipBtn.disabled = checkedCount === 0;
}

// 2차 제안가 제안 모달 열기
function openSecondPriceModal(bidId) {
  document.getElementById("bidId").value = bidId;
  document.getElementById("secondPrice").value = "";
  openModal("secondPriceModal");
}

// 2차 제안가 제안 제출
async function submitSecondPrice() {
  const bidId = parseInt(document.getElementById("bidId").value);
  const secondPrice = parseFloat(document.getElementById("secondPrice").value);

  if (!bidId || !secondPrice) {
    showAlert("입찰 ID와 2차 제안가를 입력해주세요.");
    return;
  }

  try {
    await proposeSecondPrice(bidId, secondPrice);
    closeAllModals();
    showAlert("2차 제안가가 제안되었습니다.", "success");
    await loadLiveBids();
  } catch (error) {
    handleError(error, "2차 제안가 제안 중 오류가 발생했습니다.");
  }
}

// 입찰 완료 모달 열기
function openCompleteModal(bidId) {
  document.getElementById("completeBidId").value = bidId;
  document.getElementById("winningPrice").value = "";
  document.getElementById("winningPriceKRW").textContent = "관부가세 포함: -";
  document.getElementById("priceComparisonMessage").textContent = "";
  document.getElementById("priceComparisonMessage").className =
    "price-comparison";
  openModal("completeModal");
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

  const checkbox = document.querySelector(
    `.bid-checkbox[data-bid-id="${bidId}"]`
  );
  if (!checkbox) return;

  const auc_num = parseInt(checkbox.getAttribute("data-auc-num")) || 1;
  const category = checkbox.getAttribute("data-category") || "기타";
  const finalPrice = parseFloat(checkbox.getAttribute("data-final-price")) || 0;

  const totalPrice = calculateTotalPrice(winningPrice, auc_num, category);
  document.getElementById(
    "winningPriceKRW"
  ).textContent = `관부가세 포함: ${formatCurrency(totalPrice, "KRW")}`;

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
    showAlert("입찰이 완료되었습니다.", "success");
    await loadLiveBids();
  } catch (error) {
    handleError(error, "입찰 완료 처리 중 오류가 발생했습니다.");
  }
}

// 낙찰 실패 모달 열기
function openCancelModal(bidId) {
  document.getElementById("cancelBidId").value = bidId;
  openModal("cancelModal");
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
  openModal("bulkCompleteModal");
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

    await completeBid(bidIds, winningPrice);
    closeAllModals();
    showAlert(`${bidIds.length}개 입찰이 완료되었습니다.`, "success");
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
  openModal("bulkCancelModal");
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

    await cancelBid(bidIds);
    closeAllModals();
    showAlert(
      `${bidIds.length}개 입찰이 낙찰 실패로 처리되었습니다.`,
      "success"
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

  openModal("editBidModal");
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
    if (status) updateData.status = status;
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

// 완료 상태를 출고됨으로 변경
async function markAsShipped(bidId) {
  if (!confirm("이 입찰을 출고됨 상태로 변경하시겠습니까?")) {
    return;
  }

  try {
    await updateLiveBid(bidId, { status: "shipped" });
    showAlert("상태가 출고됨으로 변경되었습니다.", "success");
    await loadLiveBids();
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
      updateLiveBid(bidId, { status: "shipped" })
    );
    await Promise.all(promises);

    showAlert(
      `${bidIds.length}개 항목이 출고됨으로 변경되었습니다.`,
      "success"
    );
    await loadLiveBids();
  } catch (error) {
    handleError(error, "일괄 상태 변경 중 오류가 발생했습니다.");
  }
}
