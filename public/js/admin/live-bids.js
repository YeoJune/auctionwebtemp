// public/js/admin/live-bids.js

// 현재 선택된 필터 상태
let currentStatus = "";
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
  loadLiveBids();

  // 필터 탭 이벤트는 common.js에서 처리

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

  // 페이지 크기 변경 이벤트
  document.getElementById("pageSize")?.addEventListener("change", function () {
    itemsPerPage = parseInt(this.value);
    currentPage = 1; // 페이지 크기 변경 시 첫 페이지로 리셋
    loadLiveBids();
  });

  // 정렬 옵션 변경 이벤트
  document.getElementById("sortBy")?.addEventListener("change", function () {
    currentSortBy = this.value;
    currentPage = 1; // 정렬 변경 시 첫 페이지로 리셋
    loadLiveBids();
  });

  // 정렬 방향 변경 이벤트
  document.getElementById("sortOrder")?.addEventListener("change", function () {
    currentSortOrder = this.value;
    currentPage = 1; // 정렬 방향 변경 시 첫 페이지로 리셋
    loadLiveBids();
  });

  // 날짜 필터 적용 버튼 이벤트
  document
    .getElementById("applyDateFilter")
    ?.addEventListener("click", function () {
      fromDate = document.getElementById("fromDate").value;
      toDate = document.getElementById("toDate").value;
      currentPage = 1; // 날짜 필터 변경 시 첫 페이지로 리셋
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
      currentPage = 1; // 날짜 필터 초기화 시 첫 페이지로 리셋
      loadLiveBids();
    });
});

// 필터 상태에 따라 데이터 로드
async function filterByStatus(status) {
  currentStatus = status;
  currentPage = 1; // 필터 변경 시 첫 페이지로 리셋
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
      toDate
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
    3: (itemId) => `https://www.starbuyers-global-auction.com/item/${itemId}`, // StarAuc 링크
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
      case "cancelled":
        statusBadge = '<span class="badge badge-secondary">낙찰 실패</span>';
        break;
      default:
        statusBadge = '<span class="badge">' + bid.status + "</span>";
    }

    // 작업 버튼
    let actionButtons = "";
    if (bid.status === "first") {
      actionButtons = `<button class="btn" onclick="openSecondPriceModal(${bid.id})">2차 가격 제안</button>`;
    } else if (bid.status === "final") {
      actionButtons = `
        <button class="btn" onclick="openCompleteModal(${bid.id})">낙찰 완료</button>
        <button class="btn btn-secondary" onclick="openCancelModal(${bid.id})">낙찰 실패</button>
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

    // 상품 시작가 표시
    const startingPrice =
      bid.item && bid.item.starting_price
        ? formatCurrency(bid.item.starting_price)
        : "-";

    // 수수료 포함 가격 계산
    let firstTotalPrice = "-";
    let secondTotalPrice = "-";
    let finalTotalPrice = "-";

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
    }

    html += `
  <tr>
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
      <div class="total-price">최종가: ${firstTotalPrice}</div>
    </td>
    <td>
      <div>현지가: ${
        bid.second_price ? formatCurrency(bid.second_price, "JPY") : "-"
      }</div>
      <div class="total-price">최종가: ${secondTotalPrice}</div>
    </td>
    <td>
      <div>현지가: ${
        bid.final_price ? formatCurrency(bid.final_price, "JPY") : "-"
      }</div>
      <div class="total-price">최종가: ${finalTotalPrice}</div>
    </td>
    <td>${statusBadge}</td>
    <td>${formatDate(bid.created_at)}</td>
    <td>${formatDate(bid.updated_at)}</td>
    <td>${actionButtons}</td>
  </tr>
`;
  });

  tableBody.innerHTML = html;
}

// 2차 제안가 제안 모달 열기
function openSecondPriceModal(bidId) {
  document.getElementById("bidId").value = bidId;
  document.getElementById("secondPrice").value = "";

  openModal("secondPriceModal");
}

// 2차 제안가 제안 제출
async function submitSecondPrice() {
  const bidId = document.getElementById("bidId").value;
  const secondPrice = document.getElementById("secondPrice").value;

  if (!bidId || !secondPrice) {
    showAlert("입찰 ID와 2차 제안가를 입력해주세요.");
    return;
  }

  try {
    await proposeSecondPrice(bidId, secondPrice);
    closeAllModals();
    showAlert("2차 제안가가 제안되었습니다.", "success");

    // 데이터 새로고침
    await loadLiveBids();
  } catch (error) {
    handleError(error, "2차 제안가 제안 중 오류가 발생했습니다.");
  }
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
    await completeBid(bidId);
    closeAllModals();
    showAlert("입찰이 완료되었습니다.", "success");

    // 데이터 새로고침
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
  const bidId = document.getElementById("cancelBidId").value;

  if (!bidId) {
    showAlert("입찰 ID가 유효하지 않습니다.");
    return;
  }

  try {
    await cancelBid(bidId);
    closeAllModals();
    showAlert("낙찰 실패로 처리되었습니다.", "success");

    // 데이터 새로고침
    await loadLiveBids();
  } catch (error) {
    handleError(error, "낙찰 실패 처리 중 오류가 발생했습니다.");
  }
}
