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
// 정산 목록 렌더링
// =====================================================
function renderSettlements() {
  const container = document.getElementById("resultsList");
  const totalResultsSpan = document.getElementById("totalResults");

  if (!container) {
    console.error("Container not found: resultsList");
    return;
  }

  // 총 결과 수 업데이트
  if (totalResultsSpan) {
    totalResultsSpan.textContent = state.totalItems;
  }

  // 데이터가 없으면
  if (state.settlements.length === 0) {
    container.innerHTML =
      '<div class="no-results">정산 데이터가 없습니다.</div>';
    return;
  }

  // 각 정산을 아코디언 형태로 렌더링
  container.innerHTML = "";

  state.settlements.forEach((settlement, index) => {
    const settlementRow = createSettlementRow(settlement, index);
    container.appendChild(settlementRow);
  });

  console.log(`${state.settlements.length}개의 정산 데이터 렌더링 완료`);
}

// =====================================================
// 정산 행 생성 (아코디언)
// =====================================================
function createSettlementRow(settlement, index) {
  const wrapper = document.createElement("div");
  wrapper.className = "settlement-row-wrapper";

  // 정산 상태 배지
  let statusBadgeClass = "status-badge ";
  let statusText = "";

  if (settlement.paymentStatus === "unpaid") {
    statusBadgeClass += "status-unpaid";
    statusText = "결제 필요";
  } else if (settlement.paymentStatus === "pending") {
    statusBadgeClass += "status-pending";
    statusText = "입금 확인 중";
  } else if (settlement.paymentStatus === "paid") {
    statusBadgeClass += "status-paid";
    statusText = "정산 완료";
  }

  // 남은 금액 계산
  const remainingAmount =
    (settlement.grandTotal || 0) - (settlement.completedAmount || 0);

  // 헤더 (클릭 가능)
  const header = document.createElement("div");
  header.className = "settlement-header";
  header.innerHTML = `
    <div class="settlement-summary">
      <div class="summary-item">
        <span class="label">날짜</span>
        <span class="value">${formatDate(settlement.date)}</span>
      </div>
      <div class="summary-item">
        <span class="label">유저 ID</span>
        <span class="value">${settlement.userLoginId || settlement.userId}</span>
      </div>
      <div class="summary-item">
        <span class="label">상품 수</span>
        <span class="value">${settlement.itemCount || 0}건</span>
      </div>
      <div class="summary-item">
        <span class="label">총 청구액</span>
        <span class="value">${formatCurrency(settlement.grandTotal || 0)}</span>
      </div>
      <div class="summary-item">
        <span class="label">기 결제액</span>
        <span class="value">${formatCurrency(settlement.completedAmount || 0)}</span>
      </div>
      <div class="summary-item">
        <span class="label">미수금</span>
        <span class="value ${remainingAmount > 0 ? "text-danger" : ""}">${formatCurrency(remainingAmount)}</span>
      </div>
      <div class="summary-item">
        <span class="label">입금자명</span>
        <span class="value">${settlement.depositorName || "-"}</span>
      </div>
      <div class="summary-item">
        <span class="label">정산 상태</span>
        <span class="${statusBadgeClass}">${statusText}</span>
      </div>
    </div>
    <button class="toggle-btn">
      <i class="fas fa-chevron-down"></i>
    </button>
  `;

  // 상세 정보 영역 (초기에는 숨김)
  const detail = document.createElement("div");
  detail.className = "settlement-detail hidden";
  detail.innerHTML = '<div class="loading-msg">로딩 중...</div>';

  // 토글 이벤트
  header.addEventListener("click", () => {
    toggleDetail(settlement, detail, header.querySelector(".toggle-btn"));
  });

  wrapper.appendChild(header);
  wrapper.appendChild(detail);

  return wrapper;
}

// =====================================================
// 상세 정보 토글
// =====================================================
async function toggleDetail(settlement, detailElement, toggleBtn) {
  const isCurrentlyOpen = !detailElement.classList.contains("hidden");

  // 다른 열린 상세 정보 닫기
  if (state.currentOpenDetail && state.currentOpenDetail !== detailElement) {
    state.currentOpenDetail.classList.add("hidden");
    const prevBtn = document.querySelector(".toggle-btn.open");
    if (prevBtn) {
      prevBtn.classList.remove("open");
      prevBtn.querySelector("i").className = "fas fa-chevron-down";
    }
  }

  if (isCurrentlyOpen) {
    // 닫기
    detailElement.classList.add("hidden");
    toggleBtn.classList.remove("open");
    toggleBtn.querySelector("i").className = "fas fa-chevron-down";
    state.currentOpenDetail = null;
  } else {
    // 열기
    detailElement.classList.remove("hidden");
    toggleBtn.classList.add("open");
    toggleBtn.querySelector("i").className = "fas fa-chevron-up";
    state.currentOpenDetail = detailElement;

    // 상세 데이터 로드
    await loadDetailData(settlement, detailElement);
  }
}

// =====================================================
// 상세 데이터 로드
// =====================================================
async function loadDetailData(settlement, detailElement) {
  try {
    detailElement.innerHTML = '<div class="loading-msg">로딩 중...</div>';

    // 날짜를 YYYY-MM-DD 형식으로 변환
    const dateOnly = formatDateForAPI(settlement.date);

    const response = await window.API.fetchAPI(
      `/bid-results/admin/bid-results/detail?userId=${settlement.userId}&date=${dateOnly}`,
    );

    console.log("상세 데이터 응답:", response);

    // 상세 내용 렌더링
    detailElement.innerHTML = createDetailContent(settlement, response);

    // 승인 버튼 이벤트 바인딩
    if (settlement.paymentStatus === "pending") {
      const approveBtn = detailElement.querySelector(".btn-approve");
      if (approveBtn) {
        approveBtn.addEventListener("click", () => {
          openSettlementApprovalModal(settlement);
        });
      }
    }
  } catch (error) {
    console.error("상세 정보 로드 실패:", error);
    detailElement.innerHTML =
      '<div class="error-msg">상세 정보를 불러오는 데 실패했습니다.</div>';
  }
}

// =====================================================
// 상세 내용 HTML 생성
// =====================================================
function createDetailContent(settlement, detailData) {
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

  // 승인 버튼 (입금 확인 중 상태만)
  let actionHTML = "";
  if (settlement.paymentStatus === "pending") {
    actionHTML = `
      <div class="detail-actions">
        <button class="btn btn-primary btn-approve">
          <i class="fas fa-check-circle"></i> 입금 확인 및 승인
        </button>
        <p class="action-note">입금 확인 후 승인하면 정산이 완료됩니다.</p>
      </div>
    `;
  } else if (settlement.paymentStatus === "paid") {
    actionHTML = `
      <div class="detail-actions">
        <div class="status-completed">
          <i class="fas fa-check-circle"></i> 정산 완료됨
        </div>
      </div>
    `;
  }

  return `
    <div class="detail-content">
      <div class="detail-section">
        <h4>기본 정보</h4>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="label">유저 ID</span>
            <span class="value">${settlement.userLoginId || settlement.userId}</span>
          </div>
          <div class="detail-item">
            <span class="label">날짜</span>
            <span class="value">${formatDate(settlement.date)}</span>
          </div>
          <div class="detail-item">
            <span class="label">입금자명</span>
            <span class="value">${settlement.depositorName || "-"}</span>
          </div>
          <div class="detail-item">
            <span class="label">상품 수</span>
            <span class="value">${settlement.itemCount || 0}건</span>
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
            <span class="label">총 청구액</span>
            <span class="value">${formatCurrency(settlement.grandTotal || 0)}</span>
          </div>
          <div class="settlement-detail-item">
            <span class="label">기 결제액</span>
            <span class="value">${formatCurrency(settlement.completedAmount || 0)}</span>
          </div>
          <div class="settlement-detail-item highlight">
            <span class="label">미수금</span>
            <span class="value">${formatCurrency((settlement.grandTotal || 0) - (settlement.completedAmount || 0))}</span>
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

  // 모달 데이터 채우기
  document.getElementById("approvalUserId").textContent =
    settlement.userLoginId || settlement.userId || "-";
  document.getElementById("approvalDate").textContent =
    formatDate(settlement.date) || "-";
  document.getElementById("approvalDepositorName").textContent =
    settlement.depositorName || "-";
  document.getElementById("approvalTotalAmount").textContent = formatCurrency(
    settlement.grandTotal || 0,
  );
  document.getElementById("approvalCompletedAmount").textContent =
    formatCurrency(settlement.completedAmount || 0);
  document.getElementById("approvalRemainingAmount").textContent =
    formatCurrency(
      (settlement.grandTotal || 0) - (settlement.completedAmount || 0),
    );

  // 입금 확인 금액 기본값 설정
  const remainingAmount =
    (settlement.grandTotal || 0) - (settlement.completedAmount || 0);
  document.getElementById("approvalPaymentAmount").value = remainingAmount;

  // 메모 초기화
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

  const paymentAmount = parseInt(
    document.getElementById("approvalPaymentAmount").value,
  );
  const note = document.getElementById("approvalNote").value.trim();

  if (!paymentAmount || paymentAmount <= 0) {
    alert("입금 확인 금액을 입력해주세요.");
    return;
  }

  const remainingAmount =
    (currentSettlement.grandTotal || 0) -
    (currentSettlement.completedAmount || 0);

  if (paymentAmount > remainingAmount) {
    alert("입금 확인 금액이 남은 결제액을 초과할 수 없습니다.");
    return;
  }

  if (!confirm(`${formatCurrency(paymentAmount)}의 입금을 승인하시겠습니까?`)) {
    return;
  }

  try {
    // PUT /bid-results/admin/settlements/:id
    const response = await window.API.fetchAPI(
      `/bid-results/admin/settlements/${currentSettlement.settlementId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "paid",
          admin_memo: note || "입금 확인 완료",
        }),
      },
    );

    if (response && response.settlement) {
      alert("정산이 승인되었습니다.");
      closeSettlementApprovalModal();
      // 데이터 새로고침
      await loadSettlements();
    } else {
      throw new Error(response.message || "정산 승인에 실패했습니다.");
    }
  } catch (error) {
    console.error("정산 승인 실패:", error);
    alert(error.message || "정산 승인 중 오류가 발생했습니다.");
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
