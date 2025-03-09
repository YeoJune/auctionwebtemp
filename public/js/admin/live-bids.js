// public/js/admin/live-bids.js

// 현재 선택된 필터 상태
let currentStatus = "";

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

  // 입찰 취소 모달 제출 버튼
  document
    .getElementById("submitCancel")
    .addEventListener("click", submitCancelBid);
});

// 필터 상태에 따라 데이터 로드
async function filterByStatus(status) {
  currentStatus = status;
  await loadLiveBids();
}

// 현장 경매 데이터 로드
async function loadLiveBids() {
  try {
    showLoading("liveBidsTableBody");

    const liveBids = await fetchLiveBids(currentStatus);

    if (!liveBids?.bids || liveBids.count === 0) {
      showNoData("liveBidsTableBody", "현장 경매 데이터가 없습니다.");
      return;
    }

    renderLiveBidsTable(liveBids.bids);
  } catch (error) {
    handleError(error, "현장 경매 데이터를 불러오는 중 오류가 발생했습니다.");
    showNoData(
      "liveBidsTableBody",
      "데이터를 불러오는 중 오류가 발생했습니다."
    );
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
        statusBadge = '<span class="badge badge-secondary">취소</span>';
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
        <button class="btn btn-secondary" onclick="openCancelModal(${bid.id})">취소</button>
      `;
    }

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
                <span>상품가: ${startingPrice}</span>
                <span>예정일시: ${scheduledDate}</span>
              </div>
            </div>
          </div>
        </td>
        <td>
          <div>${bid.user_id}</div>
        </td>
        <td>${formatCurrency(bid.first_price)}</td>
        <td>${bid.second_price ? formatCurrency(bid.second_price) : "-"}</td>
        <td>${bid.final_price ? formatCurrency(bid.final_price) : "-"}</td>
        <td>${statusBadge}</td>
        <td>${formatDate(bid.created_at)}</td>
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
    await cancelBid(bidId);
    closeAllModals();
    showAlert("입찰이 취소되었습니다.", "success");

    // 데이터 새로고침
    await loadLiveBids();
  } catch (error) {
    handleError(error, "입찰 취소 처리 중 오류가 발생했습니다.");
  }
}
