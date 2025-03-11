// public/js/admin/direct-bids.js

// 현재 선택된 필터 상태
let currentStatus = "";
let highestOnly = true;
let currentPage = 1;
let itemsPerPage = 10;
let totalPages = 1;

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

  // 입찰 취소 모달 제출 버튼
  document
    .getElementById("submitCancel")
    .addEventListener("click", submitCancelBid);

  // 페이지 크기 변경 이벤트
  document.getElementById("pageSize")?.addEventListener("change", function () {
    itemsPerPage = parseInt(this.value);
    currentPage = 1; // 페이지 크기 변경 시 첫 페이지로 리셋
    loadDirectBids();
  });
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
      itemsPerPage
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
    2: (itemId) => itemId,
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
        statusBadge = '<span class="badge badge-secondary">취소</span>';
        break;
      default:
        statusBadge = '<span class="badge">' + bid.status + "</span>";
    }

    // 작업 버튼
    let actionButtons = "";
    if (bid.status === "active") {
      actionButtons = `
        <button class="btn" onclick="openCompleteModal(${bid.id})">낙찰 완료</button>
        <button class="btn btn-secondary" onclick="openCancelModal(${bid.id})">취소</button>
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
    if (bid.item && bid.item.scheduled_date) {
      const date = new Date(bid.item.scheduled_date);
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
    if (bid.current_price && auc_num && itemCategory) {
      const calculatedPrice = calculateTotalPrice(
        bid.current_price,
        auc_num,
        itemCategory
      );
      totalPrice = formatCurrency(calculatedPrice, "KRW");
    }

    html += `
  <tr>
    <td>${bid.id}</td>
    <td>
      <div class="item-info">
        <img src="${imageUrl}" alt="${itemTitle}" class="item-thumbnail" />
        <div class="item-details">
          <div><a href="${itemUrl}" target="_blank">${
      bid.item_id + ""
    }</a></div>
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
    <td>${formatDate(bid.created_at)}</td>
    <td>${formatDate(bid.updated_at)}</td>
    <td>${statusBadge}</td>
    <td>${actionButtons}</td>
  </tr>
`;
  });

  tableBody.innerHTML = html;
}

// 입찰 완료 모달 열기
function openCompleteModal(bidId) {
  document.getElementById("completeBidId").value = bidId;
  openModal("completeModal");
}

// 입찰 완료 제출
async function submitCompleteBid() {
  const bidId = document.getElementById("completeBidId").value;

  if (!bidId) {
    showAlert("입찰 ID가 유효하지 않습니다.");
    return;
  }

  try {
    await completeDirectBid(bidId);
    closeAllModals();
    showAlert("입찰이 완료되었습니다.", "success");

    // 데이터 새로고침
    await loadDirectBids();
  } catch (error) {
    handleError(error, "입찰 완료 처리 중 오류가 발생했습니다.");
  }
}

// 입찰 취소 모달 열기
function openCancelModal(bidId) {
  document.getElementById("cancelBidId").value = bidId;
  openModal("cancelModal");
}

// 입찰 취소 제출
async function submitCancelBid() {
  const bidId = document.getElementById("cancelBidId").value;

  if (!bidId) {
    showAlert("입찰 ID가 유효하지 않습니다.");
    return;
  }

  try {
    await cancelDirectBid(bidId);
    closeAllModals();
    showAlert("입찰이 취소되었습니다.", "success");

    // 데이터 새로고침
    await loadDirectBids();
  } catch (error) {
    handleError(error, "입찰 취소 처리 중 오류가 발생했습니다.");
  }
}
