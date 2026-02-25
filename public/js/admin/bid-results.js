// public/js/admin/bid-results.js
// 관리자 입찰 결과 페이지 - settlements 기반

// =====================================================
// 상태 관리
// =====================================================
const state = {
  dateRange: 30,
  currentPage: 1,
  itemsPerPage: 20,
  sortBy: "date",
  sortOrder: "desc",
  settlementStatus: "", // 정산 상태 필터
  userSearch: "", // 유저 검색
  settlements: [], // settlements 목록
  totalItems: 0,
  totalPages: 0,
  currentOpenDetail: null, // 현재 열린 아코디언
};

// 현재 정산 정보 (모달용)
let currentSettlement = null;

// =====================================================
// 초기화
// =====================================================
async function initialize() {
  try {
    console.log("관리자 입찰 결과 페이지 초기화 시작");

    // API 초기화
    await window.API.initialize();

    // 환율 정보 가져오기
    await fetchExchangeRate();

    // 인증 상태 확인 (관리자 권한 필요)
    const isAuthenticated = await window.AuthManager.checkAuthStatus();
    if (!isAuthenticated || !window.AuthManager.isAdmin()) {
      alert("관리자 권한이 필요합니다.");
      window.location.href = "/admin";
      return;
    }

    console.log("관리자 인증 완료");

    // 이벤트 리스너 설정
    setupEventListeners();

    // 초기 데이터 로드
    await loadSettlements();

    // 정산 승인 모달 이벤트 설정
    setupSettlementApprovalModal();

    console.log("관리자 입찰 결과 페이지 초기화 완료");
  } catch (error) {
    console.error("초기화 중 오류 발생:", error);
    const container = document.getElementById("resultsList");
    if (container) {
      container.innerHTML =
        '<div class="no-results">페이지 초기화 중 오류가 발생했습니다.</div>';
    }
  }
}

// =====================================================
// 환율 정보 가져오기
// =====================================================
async function fetchExchangeRate() {
  try {
    const response = await window.API.fetchAPI("/data/exchange-rate");
    if (response && response.rate) {
      window.exchangeRate = response.rate;
      console.log("환율 정보:", window.exchangeRate);
    }
  } catch (error) {
    console.error("환율 정보 가져오기 실패:", error);
    window.exchangeRate = 15; // 기본값
  }
}

// =====================================================
// 이벤트 리스너 설정
// =====================================================
function setupEventListeners() {
  // 정렬 버튼
  document.querySelectorAll(".sort-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      const sortBy = this.getAttribute("data-sort");
      handleSortChange(sortBy);
    });
  });

  // 필터 적용
  document.getElementById("applyFilters")?.addEventListener("click", () => {
    applyFilters();
  });

  // 필터 초기화
  document.getElementById("resetFilters")?.addEventListener("click", () => {
    resetFilters();
  });

  // 유저 검색
  const userSearch = document.getElementById("userSearch");
  if (userSearch) {
    userSearch.addEventListener("input", (e) => {
      const clearBtn = document.getElementById("clearUserSearch");
      if (clearBtn) {
        clearBtn.style.display = e.target.value ? "block" : "none";
      }
    });

    userSearch.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        applyFilters();
      }
    });
  }

  // 유저 검색 초기화
  document.getElementById("clearUserSearch")?.addEventListener("click", () => {
    const userSearch = document.getElementById("userSearch");
    if (userSearch) {
      userSearch.value = "";
      document.getElementById("clearUserSearch").style.display = "none";
      state.userSearch = "";
      state.currentPage = 1;
      loadSettlements();
    }
  });

  // 로그아웃
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await window.API.fetchAPI("/auth/signout", { method: "POST" });
    window.location.href = "/signin.html";
  });
}

// =====================================================
// 데이터 로드
// =====================================================
async function loadSettlements() {
  toggleLoading(true);

  try {
    console.log("정산 데이터 로드 시작:", {
      dateRange: state.dateRange,
      page: state.currentPage,
      sortBy: state.sortBy,
      sortOrder: state.sortOrder,
      status: state.settlementStatus,
      keyword: state.userSearch,
    });

    const params = {
      dateRange: state.dateRange,
      page: state.currentPage,
      limit: state.itemsPerPage,
      sortBy: state.sortBy,
      sortOrder: state.sortOrder,
    };

    // 정산 상태 필터
    if (state.settlementStatus) {
      params.status = state.settlementStatus;
    }

    // 유저 검색
    if (state.userSearch) {
      params.keyword = state.userSearch;
    }

    const queryString = window.API.createURLParams(params);

    // 관리자 API 호출
    const response = await window.API.fetchAPI(
      `/bid-results/admin/bid-results?${queryString}`,
    );

    console.log("백엔드 응답:", response);

    // 응답 데이터 검증
    if (!response || typeof response !== "object") {
      throw new Error("잘못된 응답 형식");
    }

    // dailyResults를 settlements로 사용
    state.settlements = response.dailyResults || [];
    state.totalItems = response.pagination?.totalItems || 0;
    state.totalPages = response.pagination?.totalPages || 0;
    state.currentPage = response.pagination?.currentPage || 1;

    console.log("상태 업데이트 완료:", {
      settlementsCount: state.settlements.length,
      totalItems: state.totalItems,
      totalPages: state.totalPages,
    });

    // 결과 표시
    renderSettlements();

    // 페이지네이션 생성
    renderPagination();

    // 정렬 버튼 UI 업데이트
    updateSortButtonsUI();

    console.log("데이터 로드 완료");
  } catch (error) {
    console.error("데이터 로드 실패:", error);
    const container = document.getElementById("resultsList");
    if (container) {
      container.innerHTML =
        '<div class="no-results">데이터를 불러오는 데 실패했습니다.</div>';
    }
  } finally {
    toggleLoading(false);
  }
}

// =====================================================
// 정산 목록 렌더링 (3단계 아코디언: 날짜 → 유저 → 상품)
// =====================================================
function renderSettlements() {
  const container = document.getElementById("resultsList");
  const totalResultsSpan = document.getElementById("totalResults");

  if (!container) {
    console.error("Container not found: resultsList");
    return;
  }

  // 총 결과 수 업데이트 (날짜 개수)
  if (totalResultsSpan) {
    totalResultsSpan.textContent = state.totalItems;
  }

  // 데이터가 없으면
  if (state.settlements.length === 0) {
    container.innerHTML =
      '<div class="no-results">정산 데이터가 없습니다.</div>';
    return;
  }

  // 각 날짜별 아코디언 렌더링
  container.innerHTML = "";

  state.settlements.forEach((dailyData, index) => {
    const dailyRow = createDailyRow(dailyData, index);
    container.appendChild(dailyRow);
  });

  console.log(`${state.settlements.length}개의 날짜 데이터 렌더링 완료`);
}

// =====================================================
// 1단계: 날짜별 행 생성
// =====================================================
function createDailyRow(dailyData, index) {
  const wrapper = document.createElement("div");
  wrapper.className = "daily-row-wrapper";
  wrapper.setAttribute("data-date", dailyData.date);

  // 날짜 헤더
  const header = document.createElement("div");
  header.className = "daily-header";

  const summary = dailyData.summary || {};

  header.innerHTML = `
    <div class="daily-summary">
      <div class="summary-item main-date">
        <span class="label">날짜</span>
        <span class="value">${formatDate(dailyData.date)}</span>
      </div>
      <div class="summary-item">
        <span class="label">유저 수</span>
        <span class="value">${summary.totalUsers || 0}명</span>
      </div>
      <div class="summary-item">
        <span class="label">총 상품 수</span>
        <span class="value">${summary.totalItemCount || 0}건</span>
      </div>
      <div class="summary-item">
        <span class="label">총 청구액</span>
        <span class="value">${formatCurrency(summary.totalGrandTotal || 0)}</span>
      </div>
      <div class="summary-item">
        <span class="label">기 결제액</span>
        <span class="value">${formatCurrency(summary.totalCompletedAmount || 0)}</span>
      </div>
      <div class="summary-item">
        <span class="label">미수금</span>
        <span class="value ${getRemainingAmountClass(summary.totalRemainingAmount)}">${formatCurrency(summary.totalRemainingAmount || 0)}</span>
      </div>
    </div>
    <button class="toggle-btn" data-level="date">
      <i class="fas fa-chevron-down"></i>
    </button>
  `;

  // 유저 목록 영역 (초기에는 숨김)
  const usersContainer = document.createElement("div");
  usersContainer.className = "users-container hidden";

  // 각 유저의 행 생성
  if (dailyData.users && dailyData.users.length > 0) {
    dailyData.users.forEach((user) => {
      const userRow = createUserRow(user, dailyData.date);
      usersContainer.appendChild(userRow);
    });
  } else {
    usersContainer.innerHTML =
      '<div class="no-results">유저 데이터가 없습니다.</div>';
  }

  // 토글 이벤트
  const toggleBtn = header.querySelector(".toggle-btn");
  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDateLevel(usersContainer, toggleBtn);
  });

  wrapper.appendChild(header);
  wrapper.appendChild(usersContainer);

  return wrapper;
}

// =====================================================
// 2단계: 유저별 행 생성
// =====================================================
function createUserRow(user, date) {
  const wrapper = document.createElement("div");
  wrapper.className = "user-row-wrapper";
  wrapper.setAttribute("data-user-id", user.userId);

  // 정산 상태 배지
  let statusBadgeClass = "status-badge ";
  let statusText = "";

  if (user.paymentStatus === "unpaid") {
    statusBadgeClass += "status-unpaid";
    statusText = "결제 필요";
  } else if (user.paymentStatus === "pending") {
    statusBadgeClass += "status-pending";
    statusText = "입금 확인 중";
  } else if (user.paymentStatus === "paid") {
    statusBadgeClass += "status-paid";
    statusText = "정산 완료";
  }

  // 헤더 (클릭 가능)
  const header = document.createElement("div");
  header.className = "user-header";
  header.innerHTML = `
    <div class="user-summary">
      <div class="summary-item">
        <span class="label">유저 ID</span>
        <span class="value">${user.userLoginId || user.userId}</span>
      </div>
      <div class="summary-item">
        <span class="label">회사명</span>
        <span class="value">${user.companyName || "-"}</span>
      </div>
      <div class="summary-item">
        <span class="label">상품 수</span>
        <span class="value">${user.itemCount || 0}건</span>
      </div>
      <div class="summary-item">
        <span class="label">총 청구액</span>
        <span class="value">${formatCurrency(user.grandTotal || 0)}</span>
      </div>
      <div class="summary-item">
        <span class="label">기 결제액</span>
        <span class="value">${formatCurrency(user.completedAmount || 0)}</span>
      </div>
      <div class="summary-item">
        <span class="label">미수금</span>
        <span class="value ${getRemainingAmountClass(user.remainingAmount)}">${formatCurrency(user.remainingAmount || 0)}</span>
      </div>
      <div class="summary-item">
        <span class="label">입금자명</span>
        <span class="value">${user.depositorName || "-"}</span>
      </div>
      <div class="summary-item">
        <span class="label">정산 상태</span>
        <span class="${statusBadgeClass}">${statusText}</span>
      </div>
    </div>
    <button class="toggle-btn" data-level="user">
      <i class="fas fa-chevron-down"></i>
    </button>
  `;

  // 상품 목록 영역 (초기에는 숨김)
  const itemsContainer = document.createElement("div");
  itemsContainer.className = "items-container hidden";
  itemsContainer.innerHTML = '<div class="loading-msg">로딩 중...</div>';

  // 토글 이벤트
  const toggleBtn = header.querySelector(".toggle-btn");
  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleUserLevel(user, date, itemsContainer, toggleBtn);
  });

  wrapper.appendChild(header);
  wrapper.appendChild(itemsContainer);

  return wrapper;
}

// =====================================================
// 토글 함수들
// =====================================================
// 1단계: 날짜 토글
function toggleDateLevel(usersContainer, toggleBtn) {
  const isCurrentlyOpen = !usersContainer.classList.contains("hidden");

  if (isCurrentlyOpen) {
    // 닫기
    usersContainer.classList.add("hidden");
    toggleBtn.classList.remove("open");
    toggleBtn.querySelector("i").className = "fas fa-chevron-down";
  } else {
    // 열기
    usersContainer.classList.remove("hidden");
    toggleBtn.classList.add("open");
    toggleBtn.querySelector("i").className = "fas fa-chevron-up";
  }
}

// 2단계: 유저 토글
async function toggleUserLevel(user, date, itemsContainer, toggleBtn) {
  const isCurrentlyOpen = !itemsContainer.classList.contains("hidden");

  if (isCurrentlyOpen) {
    // 닫기
    itemsContainer.classList.add("hidden");
    toggleBtn.classList.remove("open");
    toggleBtn.querySelector("i").className = "fas fa-chevron-down";
  } else {
    // 열기
    itemsContainer.classList.remove("hidden");
    toggleBtn.classList.add("open");
    toggleBtn.querySelector("i").className = "fas fa-chevron-up";

    // 상품 목록 로드 (처음 열 때만)
    if (itemsContainer.innerHTML.includes("로딩 중")) {
      await loadItemsData(user, date, itemsContainer);
    }
  }
}

// =====================================================
// 3단계: 상품 목록 데이터 로드
// =====================================================
async function loadItemsData(user, date, itemsContainer) {
  try {
    itemsContainer.innerHTML = '<div class="loading-msg">로딩 중...</div>';

    // 날짜를 YYYY-MM-DD 형식으로 변환
    const dateOnly = formatDateForAPI(date);

    const response = await window.API.fetchAPI(
      `/bid-results/admin/bid-results/detail?userId=${user.userId}&date=${dateOnly}`,
    );

    console.log("상품 목록 응답:", response);

    // 상품 목록 렌더링
    itemsContainer.innerHTML = createItemsContent(user, response);

    // 수동 정산 처리 버튼 이벤트 바인딩
    const approveBtn = itemsContainer.querySelector(".btn-approve");
    if (approveBtn) {
      approveBtn.addEventListener("click", () => {
        openSettlementApprovalModal({
          ...user,
          date: date,
        });
      });
    }
  } catch (error) {
    console.error("상품 목록 로드 실패:", error);
    itemsContainer.innerHTML =
      '<div class="error-msg">상품 정보를 불러오는 데 실패했습니다.</div>';
  }
}

// =====================================================
// 상품 목록 HTML 생성
// =====================================================
function createItemsContent(user, detailData) {
  const items = detailData.items || [];

  // 상품 목록 HTML
  let itemsHTML = "";
  if (items.length > 0) {
    itemsHTML = items
      .map((item) => {
        const winPrice = parseInt(item.winning_price) || 0;
        const koreanPrice = parseInt(item.koreanPrice) || 0;
        const statusText = getStatusText(item.status);

        return `
        <tr>
          <td>${item.itemId}</td>
          <td>
            ${item.brand ? `<span class="badge">${item.brand}</span> ` : ""}
            ${item.title || "-"}
          </td>
          <td class="text-right">¥${formatNumber(winPrice)}</td>
          <td class="text-right">${formatCurrency(koreanPrice)}</td>
          <td>${statusText}</td>
          <td>${item.appr_id ? '<span class="badge badge-success">감정서</span>' : "-"}</td>
        </tr>
      `;
      })
      .join("");
  } else {
    itemsHTML =
      '<tr><td colspan="6" class="text-center">낙찰 완료된 상품이 없습니다.</td></tr>';
  }

  // 정산 처리 버튼 (상태에 따라 텍스트 변경)
  let buttonText = "정산 처리";
  let noteText = "입금자명과 금액을 입력하여 정산 처리";

  if (user.paymentStatus === "pending") {
    buttonText = "입금 확인 및 승인";
    noteText = "입금 확인 후 승인하여 정산 완료";
  } else if (user.paymentStatus === "paid") {
    buttonText = "추가 입금 처리";
    noteText = "추가 입금이 있는 경우 처리 가능";
  }

  let actionHTML = `
    <div class="detail-actions">
      <button class="btn btn-primary btn-approve">
        <i class="fas fa-hand-holding-usd"></i> ${buttonText}
      </button>
      <p class="action-note">${noteText}</p>
    </div>
  `;

  return `
    <div class="items-content">
      <div class="detail-section">
        <h4>기본 정보</h4>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="label">유저 ID</span>
            <span class="value">${user.userLoginId || user.userId}</span>
          </div>
          <div class="detail-item">
            <span class="label">회사명</span>
            <span class="value">${user.companyName || "-"}</span>
          </div>
          <div class="detail-item">
            <span class="label">입금자명</span>
            <span class="value">${user.depositorName || "-"}</span>
          </div>
          <div class="detail-item">
            <span class="label">상품 수</span>
            <span class="value">${user.itemCount || 0}건</span>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <h4>낙찰 완료 상품 목록</h4>
        <div class="table-responsive">
          <table class="detail-table">
            <thead>
              <tr>
                <th>상품 ID</th>
                <th>제목</th>
                <th>낙찰가 (¥)</th>
                <th>관부가세 포함 (₩)</th>
                <th>상태</th>
                <th>감정서</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHTML}
            </tbody>
          </table>
        </div>
      </div>

      <div class="detail-section">
        <h4>정산 정보</h4>
        <div class="settlement-detail-grid">
          <div class="settlement-detail-item">
            <span class="label">관부가세 포함 총액</span>
            <span class="value">${formatCurrency(user.totalKoreanPrice || 0)}</span>
          </div>
          <div class="settlement-detail-item">
            <span class="label">수수료 (VAT 포함)</span>
            <span class="value">${formatCurrency(user.feeAmount || 0)}</span>
          </div>
          <div class="settlement-detail-item">
            <span class="label">감정서 수수료 (VAT 포함)</span>
            <span class="value">${formatCurrency(user.appraisalFee || 0)}</span>
          </div>
          <div class="settlement-detail-item highlight">
            <span class="label">총 청구액</span>
            <span class="value">${formatCurrency(user.grandTotal || 0)}</span>
          </div>
          <div class="settlement-detail-item">
            <span class="label">기 결제액</span>
            <span class="value">${formatCurrency(user.completedAmount || 0)}</span>
          </div>
          <div class="settlement-detail-item highlight">
            <span class="label">미수금</span>
            <span class="value ${getRemainingAmountClass(user.remainingAmount)}">${formatCurrency(user.remainingAmount || 0)}</span>
          </div>
        </div>
      </div>

      ${actionHTML}
    </div>
  `;
}

// =====================================================
// 정산 승인 모달
// =====================================================
function setupSettlementApprovalModal() {
  const modal = document.getElementById("settlementApprovalModal");
  const closeBtn = document.getElementById("approvalModalClose");
  const cancelBtn = document.getElementById("approvalCancelBtn");
  const confirmBtn = document.getElementById("approvalConfirmBtn");

  if (closeBtn) {
    closeBtn.addEventListener("click", closeSettlementApprovalModal);
  }

  if (cancelBtn) {
    cancelBtn.addEventListener("click", closeSettlementApprovalModal);
  }

  if (confirmBtn) {
    confirmBtn.addEventListener("click", handleSettlementApproval);
  }

  // 모달 외부 클릭 시 닫기
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        closeSettlementApprovalModal();
      }
    });
  }
}

function openSettlementApprovalModal(settlement) {
  currentSettlement = settlement;

  // 상태에 따른 모달 제목 변경
  const modalTitle = document.querySelector(
    "#settlementApprovalModal .modal-header h3",
  );
  if (modalTitle) {
    if (settlement.paymentStatus === "pending") {
      modalTitle.textContent = "입금 확인 및 승인";
    } else if (settlement.paymentStatus === "paid") {
      modalTitle.textContent = "추가 입금 처리";
    } else {
      modalTitle.textContent = "정산 수동 처리";
    }
  }

  // 상태에 따른 버튼 텍스트 변경
  const confirmBtn = document.getElementById("approvalConfirmBtn");
  if (confirmBtn) {
    const iconHTML = '<i class="fas fa-check"></i> ';
    if (settlement.paymentStatus === "pending") {
      confirmBtn.innerHTML = iconHTML + "승인";
    } else if (settlement.paymentStatus === "paid") {
      confirmBtn.innerHTML = iconHTML + "추가 처리";
    } else {
      confirmBtn.innerHTML = iconHTML + "처리";
    }
  }

  // 모달 데이터 채우기
  const userIdText = settlement.userLoginId || settlement.userId || "-";
  const companyText = settlement.companyName
    ? ` (${settlement.companyName})`
    : "";
  document.getElementById("approvalUserId").textContent =
    userIdText + companyText;
  document.getElementById("approvalDate").textContent =
    formatDate(settlement.date) || "-";
  document.getElementById("approvalTotalAmount").textContent = formatCurrency(
    settlement.grandTotal || 0,
  );
  document.getElementById("approvalCompletedAmount").textContent =
    formatCurrency(settlement.completedAmount || 0);

  const remainingAmount =
    (settlement.grandTotal || 0) - (settlement.completedAmount || 0);
  document.getElementById("approvalRemainingAmount").textContent =
    formatCurrency(remainingAmount);

  // 현재 입금자명 표시
  document.getElementById("currentDepositorName").textContent =
    settlement.depositorName || "-";

  // 입력 필드 초기화
  document.getElementById("approvalDepositorNameInput").value = "";
  document.getElementById("approvalPaymentAmount").value = ""; // 빈 값으로 설정 (전액 처리)
  document.getElementById("approvalNote").value = "";

  // 모달 표시
  const modal = document.getElementById("settlementApprovalModal");
  if (modal) {
    modal.style.display = "flex";
  }
}

function closeSettlementApprovalModal() {
  const modal = document.getElementById("settlementApprovalModal");
  if (modal) {
    modal.style.display = "none";
  }
  currentSettlement = null;
}

async function handleSettlementApproval() {
  if (!currentSettlement) {
    alert("정산 정보가 없습니다.");
    return;
  }

  const depositorName = document
    .getElementById("approvalDepositorNameInput")
    .value.trim();
  const paymentAmountStr = document
    .getElementById("approvalPaymentAmount")
    .value.trim();
  const note = document.getElementById("approvalNote").value.trim();

  // 입금액 처리 (미입력 시 undefined로 전송하여 백엔드에서 전액 처리)
  const paymentAmount =
    paymentAmountStr && paymentAmountStr !== ""
      ? parseInt(paymentAmountStr)
      : undefined;

  // 입금액이 입력된 경우 유효성 검사
  if (paymentAmount !== undefined) {
    if (paymentAmount <= 0) {
      alert("입금 금액은 0보다 커야 합니다.");
      return;
    }

    const remainingAmount =
      (currentSettlement.grandTotal || 0) -
      (currentSettlement.completedAmount || 0);

    if (paymentAmount > remainingAmount) {
      alert(
        `입금 금액(${formatCurrency(paymentAmount)})이 남은 결제액(${formatCurrency(remainingAmount)})을 초과할 수 없습니다.`,
      );
      return;
    }
  }

  // 확인 메시지
  const amountText = paymentAmount
    ? formatCurrency(paymentAmount)
    : formatCurrency(
        (currentSettlement.grandTotal || 0) -
          (currentSettlement.completedAmount || 0),
      ) + " (전액)";
  const depositorText = depositorName ? `\n입금자: ${depositorName}` : "";

  if (
    !confirm(
      `정산 처리를 진행하시겠습니까?\n금액: ${amountText}${depositorText}`,
    )
  ) {
    return;
  }

  try {
    // 백엔드 API 호출
    const requestBody = {
      admin_memo: note || "수동 정산 처리",
    };

    // 선택적 파라미터 추가
    if (depositorName) {
      requestBody.depositor_name = depositorName;
    }
    if (paymentAmount !== undefined) {
      requestBody.payment_amount = paymentAmount;
    }

    const response = await window.API.fetchAPI(
      `/bid-results/admin/settlements/${currentSettlement.settlementId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      },
    );

    if (response && response.settlement) {
      const paymentInfo = response.payment_info || {};
      alert(
        `정산 처리가 완료되었습니다.\n\n` +
          `처리 금액: ${formatCurrency(paymentInfo.payment_amount || 0)}\n` +
          `누적 결제액: ${formatCurrency(paymentInfo.new_completed || 0)}\n` +
          `남은 금액: ${formatCurrency(paymentInfo.remaining || 0)}\n` +
          `상태: ${paymentInfo.status === "paid" ? "결제 완료" : paymentInfo.status === "pending" ? "부분 입금" : "미결제"}`,
      );
      closeSettlementApprovalModal();
      await loadSettlements();
    } else {
      throw new Error(response.message || "정산 처리에 실패했습니다.");
    }
  } catch (error) {
    console.error("정산 처리 실패:", error);
    alert(error.message || "정산 처리 중 오류가 발생했습니다.");
  }
}

// =====================================================
// 필터 및 정렬
// =====================================================
function handleSortChange(sortBy) {
  if (state.sortBy === sortBy) {
    state.sortOrder = state.sortOrder === "desc" ? "asc" : "desc";
  } else {
    state.sortBy = sortBy;
    state.sortOrder = "desc";
  }

  state.currentPage = 1;
  loadSettlements();
}

function applyFilters() {
  const dateRange = document.getElementById("dateRange")?.value;
  const settlementStatus = document.getElementById("settlementStatus")?.value;
  const userSearch = document.getElementById("userSearch")?.value.trim();

  state.dateRange = parseInt(dateRange) || 30;
  state.settlementStatus = settlementStatus || "";
  state.userSearch = userSearch || "";
  state.currentPage = 1;

  loadSettlements();
}

function resetFilters() {
  state.dateRange = 30;
  state.sortBy = "date";
  state.sortOrder = "desc";
  state.settlementStatus = "";
  state.userSearch = "";
  state.currentPage = 1;

  // UI 초기화
  const dateRange = document.getElementById("dateRange");
  if (dateRange) dateRange.value = "30";

  const settlementStatus = document.getElementById("settlementStatus");
  if (settlementStatus) settlementStatus.value = "";

  const userSearch = document.getElementById("userSearch");
  if (userSearch) userSearch.value = "";

  const clearBtn = document.getElementById("clearUserSearch");
  if (clearBtn) clearBtn.style.display = "none";

  loadSettlements();
}

// =====================================================
// 페이지네이션
// =====================================================
function renderPagination() {
  const container = document.getElementById("pagination");
  if (!container) return;

  if (state.totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  let html = "";

  // 이전 버튼
  if (state.currentPage > 1) {
    html += `<button class="page-btn" onclick="goToPage(${state.currentPage - 1})">이전</button>`;
  }

  // 페이지 번호
  const start = Math.max(1, state.currentPage - 2);
  const end = Math.min(state.totalPages, state.currentPage + 2);

  for (let i = start; i <= end; i++) {
    html += `<button class="page-btn ${i === state.currentPage ? "active" : ""}" onclick="goToPage(${i})">${i}</button>`;
  }

  // 다음 버튼
  if (state.currentPage < state.totalPages) {
    html += `<button class="page-btn" onclick="goToPage(${state.currentPage + 1})">다음</button>`;
  }

  container.innerHTML = html;
}

function goToPage(page) {
  state.currentPage = page;
  loadSettlements();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// 전역 함수 등록
window.goToPage = goToPage;

// =====================================================
// 정렬 버튼 UI 업데이트
// =====================================================
function updateSortButtonsUI() {
  document.querySelectorAll(".sort-btn").forEach((btn) => {
    const sortBy = btn.getAttribute("data-sort");
    if (sortBy === state.sortBy) {
      btn.classList.add("active");
      const icon = btn.querySelector("i");
      if (icon) {
        icon.className =
          state.sortOrder === "asc" ? "fas fa-sort-up" : "fas fa-sort-down";
      }
    } else {
      btn.classList.remove("active");
      const icon = btn.querySelector("i");
      if (icon) {
        icon.className = "fas fa-sort";
      }
    }
  });
}

// =====================================================
// 유틸리티 함수
// =====================================================
function toggleLoading(show) {
  const loading = document.getElementById("loadingMsg");
  if (loading) {
    if (show) {
      loading.classList.remove("loading-hidden");
    } else {
      loading.classList.add("loading-hidden");
    }
  }
}

function formatNumber(value) {
  if (typeof value !== "number") return "0";
  return value.toLocaleString("ko-KR");
}

function formatCurrency(value) {
  // 문자열을 숫자로 변환
  const numValue = typeof value === "string" ? parseFloat(value) : value;

  if (typeof numValue !== "number" || isNaN(numValue)) return "₩0";
  return "₩" + Math.round(numValue).toLocaleString("ko-KR");
}

function getRemainingAmountClass(value) {
  const numValue = typeof value === "string" ? parseFloat(value) : value;
  return Number(numValue || 0) === 0 ? "text-primary" : "text-danger";
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateForAPI(dateStr) {
  // API 호출용 날짜 형식: YYYY-MM-DD
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getStatusText(status) {
  const statusMap = {
    completed: "낙찰 완료",
    shipped: "출고됨",
    cancelled: "낙찰 실패",
    active: "진행 중",
  };
  return statusMap[status] || status;
}

// =====================================================
// 초기화 실행
// =====================================================
document.addEventListener("DOMContentLoaded", initialize);
