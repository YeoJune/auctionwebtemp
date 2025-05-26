// public/js/admin/direct-bids.js

// 현재 선택된 필터 상태
let currentStatus = "";
let highestOnly = false;
let currentPage = 1;
let itemsPerPage = 10;
let totalPages = 1;
let currentSortBy = "updated_at"; // 기본 정렬 필드
let currentSortOrder = "desc"; // 기본 정렬 방향
let fromDate = ""; // 시작 날짜 필터
let toDate = ""; // 종료 날짜 필터

// 페이지 로드 시 실행
document.addEventListener("DOMContentLoaded", function () {
  // 초기 데이터 로드
  loadDirectBids();

  // 필터 탭 이벤트는 common.js에서 처리

  // 필터 토글 이벤트
  document
    .getElementById("toggleHighestOnly")
    .addEventListener("change", function () {
      highestOnly = this.checked;
      currentPage = 1; // 필터 변경 시 첫 페이지로 리셋
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

  // 일괄 낙찰 금액 입력 시 관부가세 포함 가격 업데이트
  document
    .getElementById("bulkWinningPrice")
    .addEventListener("input", updateBulkWinningPriceKRW);

  // 페이지 크기 변경 이벤트
  document.getElementById("pageSize")?.addEventListener("change", function () {
    itemsPerPage = parseInt(this.value);
    currentPage = 1; // 페이지 크기 변경 시 첫 페이지로 리셋
    loadDirectBids();
  });

  // 정렬 옵션 변경 이벤트
  document.getElementById("sortBy")?.addEventListener("change", function () {
    currentSortBy = this.value;
    currentPage = 1; // 정렬 변경 시 첫 페이지로 리셋
    loadDirectBids();
  });

  // 정렬 방향 변경 이벤트
  document.getElementById("sortOrder")?.addEventListener("change", function () {
    currentSortOrder = this.value;
    currentPage = 1; // 정렬 방향 변경 시 첫 페이지로 리셋
    loadDirectBids();
  });

  // 날짜 필터 적용 버튼 이벤트
  document
    .getElementById("applyDateFilter")
    ?.addEventListener("click", function () {
      fromDate = document.getElementById("fromDate").value;
      toDate = document.getElementById("toDate").value;
      currentPage = 1; // 날짜 필터 변경 시 첫 페이지로 리셋
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
      currentPage = 1; // 날짜 필터 초기화 시 첫 페이지로 리셋
      loadDirectBids();
    });

  // Add event listeners for bulk actions
  document
    .getElementById("bulkCompleteBtn")
    ?.addEventListener("click", openBulkCompleteModal);
  document
    .getElementById("bulkCancelBtn")
    ?.addEventListener("click", openBulkCancelModal);
  document
    .getElementById("bulkMarkSubmittedBtn")
    ?.addEventListener("click", openBulkMarkAsSubmittedModal);
  document
    .getElementById("submitBulkComplete")
    ?.addEventListener("click", submitBulkComplete);
  document
    .getElementById("submitBulkCancel")
    ?.addEventListener("click", submitBulkCancel);
  document
    .getElementById("submitBulkMarkAsSubmitted")
    ?.addEventListener("click", submitBulkMarkAsSubmitted);
});

// 필터 상태에 따라 데이터 로드
async function filterByStatus(status) {
  currentStatus = status;
  currentPage = 1; // 필터 변경 시 첫 페이지로 리셋
  await loadDirectBids();
}

// 페이지 변경 함수
function changePage(page) {
  if (page < 1 || page > totalPages) return;
  currentPage = page;
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
      toDate
    );

    if (!directBids?.bids || directBids.count === 0) {
      showNoData("directBidsTableBody", "직접 경매 데이터가 없습니다.");
      renderPagination(0, 0, 0);
      return;
    }

    renderDirectBidsTable(directBids.bids);
    renderPagination(
      directBids.currentPage,
      directBids.totalPages,
      directBids.total
    );
    totalPages = directBids.totalPages;
  } catch (error) {
    handleError(error, "직접 경매 데이터를 불러오는 중 오류가 발생했습니다.");
    showNoData(
      "directBidsTableBody",
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

// 직접 경매 테이블 렌더링
function renderDirectBidsTable(directBids) {
  const tableBody = document.getElementById("directBidsTableBody");
  let html = "";

  // URL 매핑 함수
  const linkFunc = {
    1: (itemId) => `https://www.ecoauc.com/client/auction-items/view/${itemId}`,
    2: (itemId) =>
      `https://bid.brand-auc.com/items/detail?uketsukeBng=${itemId}`, // BrandAuc 링크
    3: (itemId) => `https://www.starbuyers-global-auction.com/item/${itemId}`, // StarAuc 링크
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
      case "cancelled":
        statusBadge = '<span class="badge badge-secondary">낙찰 실패</span>';
        break;
      default:
        statusBadge = '<span class="badge">' + bid.status + "</span>";
    }

    // 플랫폼 반영 상태 배지
    let submittedBadge = "";
    if (bid.submitted_to_platform) {
      submittedBadge = '<span class="badge badge-success">반영됨</span>';
    } else {
      submittedBadge = '<span class="badge badge-warning">미반영</span>';
    }

    // 작업 버튼
    let actionButtons = "";
    if (bid.status === "active") {
      actionButtons = `
        <button class="btn" onclick="openCompleteModal(${bid.id})">낙찰 완료</button>
        <button class="btn btn-secondary" onclick="openCancelModal(${bid.id})">낙찰 실패</button>
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
      itemUrl = linkFunc[bid.item.auc_num](bid.item_id);
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
   <td>${formatDate(bid.updated_at)}</td>
   <td>${statusBadge}</td>
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
  document.getElementById("bulkMarkSubmittedBtn").disabled = checkedCount === 0;
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

  // 해당 입찰 찾기
  const checkbox = document.querySelector(
    `.bid-checkbox[data-bid-id="${bidId}"]`
  );
  if (!checkbox) return;

  const auc_num = checkbox.dataset.aucNum || 1;
  const category = checkbox.dataset.category || "기타";
  const currentPrice = parseFloat(checkbox.dataset.currentPrice) || 0;

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
  const bidId = document.getElementById("completeBidId").value;
  const winningPrice = document.getElementById("winningPrice").value;

  if (!bidId) {
    showAlert("입찰 ID가 유효하지 않습니다.");
    return;
  }

  try {
    // winningPrice가 있으면 전달, 없으면 기본값 사용
    if (winningPrice) {
      await completeDirectBid(bidId, parseFloat(winningPrice));
    } else {
      await completeDirectBid(bidId);
    }

    closeAllModals();
    showAlert("입찰이 완료되었습니다.", "success");

    // 데이터 새로고침
    await loadDirectBids();
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
  const bidId = document.getElementById("cancelBidId").value;

  if (!bidId) {
    showAlert("입찰 ID가 유효하지 않습니다.");
    return;
  }

  try {
    await cancelDirectBid(bidId);
    closeAllModals();
    showAlert("낙찰 실패로 처리되었습니다.", "success");

    // 데이터 새로고침
    await loadDirectBids();
  } catch (error) {
    handleError(error, "낙찰 실패 처리 중 오류가 발생했습니다.");
  }
}

// 플랫폼 반영 완료 표시 모달 열기
function openMarkAsSubmittedModal(bidId) {
  document.getElementById("markSubmittedBidId").value = bidId;
  openModal("markAsSubmittedModal");
}

// 플랫폼 반영 완료 표시 처리
async function markAsSubmitted() {
  const bidId = document.getElementById("markSubmittedBidId").value;

  if (!bidId) {
    showAlert("입찰 ID가 유효하지 않습니다.");
    return;
  }

  try {
    await markDirectBidAsSubmitted(bidId);
    closeAllModals();
    showAlert("플랫폼 반영 완료로 표시되었습니다.", "success");
    // 데이터 새로고침
    await loadDirectBids();
  } catch (error) {
    handleError(error, "반영 완료 표시 중 오류가 발생했습니다.");
  }
}

// Bulk action modals and submissions
function openBulkCompleteModal() {
  const count = document.querySelectorAll(".bid-checkbox:checked").length;
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

  // 카테고리와 경매번호는 일괄 처리에서 단순화를 위해 기본값 사용
  const totalPrice = calculateTotalPrice(winningPrice, 1, "기타");
  document.getElementById(
    "bulkWinningPriceKRW"
  ).textContent = `관부가세 포함: ${formatCurrency(totalPrice, "KRW")}`;
}

// 일괄 낙찰 완료 제출 (기존 submitBulkComplete 함수 수정)
async function submitBulkComplete() {
  const checkedBids = document.querySelectorAll(".bid-checkbox:checked");
  if (checkedBids.length === 0) {
    closeAllModals();
    return;
  }

  try {
    // 체크된 입찰 ID 추출
    const bidIds = Array.from(checkedBids).map(
      (checkbox) => checkbox.dataset.bidId
    );

    // 낙찰 금액 추출
    const winningPrice = document.getElementById("bulkWinningPrice").value;

    // 수정된 API 함수 호출 - 이제 배열을 직접 전달
    await completeDirectBid(
      bidIds,
      winningPrice ? parseFloat(winningPrice) : undefined
    );

    closeAllModals();
    showAlert(`${bidIds.length}개 입찰이 완료되었습니다.`, "success");

    // 데이터 새로고침
    await loadDirectBids();
  } catch (error) {
    handleError(error, "일괄 입찰 완료 처리 중 오류가 발생했습니다.");
  }
}

function openBulkCancelModal() {
  const count = document.querySelectorAll(".bid-checkbox:checked").length;
  if (count === 0) return;
  document.getElementById("bulkCancelCount").textContent = count;
  openModal("bulkCancelModal");
}

// 일괄 낙찰 실패 제출 (기존 submitBulkCancel 함수 수정)
async function submitBulkCancel() {
  const checkedBids = document.querySelectorAll(".bid-checkbox:checked");
  if (checkedBids.length === 0) {
    closeAllModals();
    return;
  }

  try {
    // 체크된 입찰 ID 추출
    const bidIds = Array.from(checkedBids).map(
      (checkbox) => checkbox.dataset.bidId
    );

    // 수정된 API 함수 호출 - 이제 배열을 직접 전달
    await cancelDirectBid(bidIds);

    closeAllModals();
    showAlert(
      `${bidIds.length}개 입찰이 낙찰 실패로 처리되었습니다.`,
      "success"
    );

    // 데이터 새로고침
    await loadDirectBids();
  } catch (error) {
    handleError(error, "일괄 입찰 취소 처리 중 오류가 발생했습니다.");
  }
}

function openBulkMarkAsSubmittedModal() {
  const count = document.querySelectorAll(".bid-checkbox:checked").length;
  if (count === 0) return;
  document.getElementById("bulkMarkSubmittedCount").textContent = count;
  openModal("bulkMarkAsSubmittedModal");
}

// 일괄 플랫폼 반영 완료 제출 (기존 submitBulkMarkAsSubmitted 함수 수정)
async function submitBulkMarkAsSubmitted() {
  const checkedBids = document.querySelectorAll(".bid-checkbox:checked");
  if (checkedBids.length === 0) {
    closeAllModals();
    return;
  }

  try {
    // 체크된 입찰 ID 추출
    const bidIds = Array.from(checkedBids).map(
      (checkbox) => checkbox.dataset.bidId
    );

    // 수정된 API 함수 호출 - 이제 배열을 직접 전달
    await markDirectBidAsSubmitted(bidIds);

    closeAllModals();
    showAlert(
      `${bidIds.length}개 입찰이 플랫폼 반영 완료로 표시되었습니다.`,
      "success"
    );

    // 데이터 새로고침
    await loadDirectBids();
  } catch (error) {
    handleError(error, "일괄 반영 완료 표시 중 오류가 발생했습니다.");
  }
}
