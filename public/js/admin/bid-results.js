// public/js/admin-bid-results.js

// =====================================================
// 상태 관리
// =====================================================
const state = {
  dateRange: 365, // 관리자는 1년치 기본 조회
  currentPage: 1,
  itemsPerPage: 20,
  sortBy: "date",
  sortOrder: "desc",
  statusFilter: "", // 정산 상태 필터
  keyword: "",
  results: [],
  totalItems: 0,
  totalPages: 0,
};

let currentSettlement = null;

// =====================================================
// 초기화
// =====================================================
async function initialize() {
  console.log("관리자 입찰 결과 페이지 초기화 시작");

  await window.API.initialize();

  setupEventListeners();
  await loadResults();

  console.log("관리자 입찰 결과 페이지 초기화 완료");
}

// =====================================================
// 이벤트 리스너 설정
// =====================================================
function setupEventListeners() {
  // 검색
  document.getElementById("searchBtn")?.addEventListener("click", handleSearch);
  document
    .getElementById("clearSearchBtn")
    ?.addEventListener("click", handleClearSearch);
  document.getElementById("searchInput")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") handleSearch();
  });

  // 필터 탭
  document.querySelectorAll(".filter-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document
        .querySelectorAll(".filter-tab")
        .forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      state.statusFilter = tab.getAttribute("data-status");
      state.currentPage = 1;
      loadResults();
    });
  });

  // 정렬
  document.getElementById("sortBy")?.addEventListener("change", () => {
    state.sortBy = document.getElementById("sortBy").value;
    state.currentPage = 1;
    loadResults();
  });

  document.getElementById("sortOrder")?.addEventListener("change", () => {
    state.sortOrder = document.getElementById("sortOrder").value;
    state.currentPage = 1;
    loadResults();
  });

  // 페이지 크기
  document.getElementById("pageSize")?.addEventListener("change", () => {
    state.itemsPerPage = parseInt(document.getElementById("pageSize").value);
    state.currentPage = 1;
    loadResults();
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
async function loadResults() {
  toggleLoading(true);

  try {
    const params = {
      dateRange: state.dateRange,
      page: state.currentPage,
      limit: state.itemsPerPage,
      sortBy: state.sortBy,
      sortOrder: state.sortOrder,
      status: state.statusFilter,
      keyword: state.keyword,
    };

    const queryString = window.API.createURLParams(params);
    const response = await window.API.fetchAPI(
      `/api/bid-results/admin/bid-results?${queryString}`,
    );

    state.results = response.dailyResults || [];
    state.totalItems = response.pagination?.totalItems || 0;
    state.totalPages = response.pagination?.totalPages || 0;
    state.currentPage = response.pagination?.currentPage || 1;

    renderResults();
    renderPagination();
  } catch (error) {
    console.error("결과 로드 실패:", error);
    alert("데이터를 불러오는 중 오류가 발생했습니다.");
  } finally {
    toggleLoading(false);
  }
}

// =====================================================
// 검색 핸들러
// =====================================================
function handleSearch() {
  const keyword = document.getElementById("searchInput").value.trim();
  state.keyword = keyword;
  state.currentPage = 1;
  loadResults();
}

function handleClearSearch() {
  document.getElementById("searchInput").value = "";
  state.keyword = "";
  state.currentPage = 1;
  loadResults();
}

// =====================================================
// 결과 렌더링
// =====================================================
function renderResults() {
  const tbody = document.getElementById("resultsTableBody");
  const totalElement = document.getElementById("totalResults");

  totalElement.textContent = state.totalItems;

  if (state.results.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="9" class="text-center">결과가 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = state.results
    .map((result, index) => {
      const remaining = result.grandTotal - (result.completedAmount || 0);
      const rowId = `row-${index}`;
      const detailId = `detail-${index}`;

      // 정산 상태 배지
      let statusBadge = "";
      if (result.paymentStatus === "pending") {
        statusBadge = '<span class="status-badge status-pending">미결제</span>';
      } else if (result.paymentStatus === "paid") {
        statusBadge = '<span class="status-badge status-paid">완료</span>';
      }

      // 입금자명 표시
      const depositorName = result.depositorName || "-";

      return `
      <tr id="${rowId}" class="main-row">
        <td>${result.date}</td>
        <td>${result.userId}</td>
        <td>${result.itemCount}건</td>
        <td class="text-right">₩${result.grandTotal.toLocaleString()}</td>
        <td class="text-right">₩${(result.completedAmount || 0).toLocaleString()}</td>
        <td class="text-right ${remaining > 0 ? "text-danger" : ""}">
          ₩${remaining.toLocaleString()}
        </td>
        <td>${depositorName}</td>
        <td>${statusBadge}</td>
        <td>
          <button 
            class="btn btn-sm btn-info toggle-detail-btn" 
            data-target="${detailId}"
            data-user-id="${result.userId}"
            data-date="${result.date}"
            data-settlement-id="${result.settlementId}"
          >
            <i class="fas fa-chevron-down"></i> 상세
          </button>
        </td>
      </tr>
      <tr id="${detailId}" class="detail-row" style="display: none;">
        <td colspan="9">
          <div class="detail-container">
            <div class="loading-msg">로딩 중...</div>
          </div>
        </td>
      </tr>
    `;
    })
    .join("");

  // 토글 버튼 이벤트 바인딩
  document.querySelectorAll(".toggle-detail-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      const userId = btn.getAttribute("data-user-id");
      const date = btn.getAttribute("data-date");
      const settlementId = btn.getAttribute("data-settlement-id");
      toggleDetailRow(targetId, userId, date, settlementId, btn);
    });
  });
}

// =====================================================
// 상세 보기 토글 (아코디언 스타일)
// =====================================================
let currentOpenDetail = null;

async function toggleDetailRow(detailId, userId, date, settlementId, btn) {
  const detailRow = document.getElementById(detailId);
  const isCurrentlyOpen = detailRow.style.display !== "none";

  // 다른 열려있는 상세 닫기
  if (currentOpenDetail && currentOpenDetail !== detailId) {
    const prevRow = document.getElementById(currentOpenDetail);
    if (prevRow) {
      prevRow.style.display = "none";
    }
    // 이전 버튼 아이콘 복원
    const prevBtns = document.querySelectorAll(
      `.toggle-detail-btn[data-target="${currentOpenDetail}"]`,
    );
    prevBtns.forEach((b) => {
      b.innerHTML = '<i class="fas fa-chevron-down"></i> 상세';
    });
  }

  if (isCurrentlyOpen) {
    // 현재 열린 것을 닫기
    detailRow.style.display = "none";
    btn.innerHTML = '<i class="fas fa-chevron-down"></i> 상세';
    currentOpenDetail = null;
  } else {
    // 열기
    detailRow.style.display = "";
    btn.innerHTML = '<i class="fas fa-chevron-up"></i> 접기';
    currentOpenDetail = detailId;

    // 데이터 로드
    await loadDetailData(detailId, userId, date, settlementId);
  }
}

async function loadDetailData(detailId, userId, date, settlementId) {
  const detailRow = document.getElementById(detailId);
  const container = detailRow.querySelector(".detail-container");

  try {
    container.innerHTML = '<div class="loading-msg">로딩 중...</div>';

    const response = await window.API.fetchAPI(
      `/api/bid-results/admin/bid-results/detail?userId=${userId}&date=${date}`,
    );

    // 상세 내용 렌더링
    container.innerHTML = createDetailContent(response, settlementId);

    // 승인 버튼 이벤트
    const approveBtn = container.querySelector(".btn-approve-settlement");
    if (approveBtn) {
      approveBtn.addEventListener("click", () => {
        approveSettlement(
          settlementId,
          userId,
          date,
          response.grandTotal,
          response.completedAmount,
        );
      });
    }
  } catch (error) {
    console.error("상세 정보 로드 실패:", error);
    container.innerHTML =
      '<div class="error-msg">상세 정보를 불러오는 중 오류가 발생했습니다.</div>';
  }
}

function createDetailContent(response, settlementId) {
  const remaining = response.grandTotal - (response.completedAmount || 0);

  // 승인 버튼 (미결제 상태이고 settlementId가 있을 때만)
  let approvalSection = "";
  if (response.paymentStatus === "pending" && settlementId) {
    approvalSection = `
      <div class="approval-section">
        <button class="btn btn-success btn-approve-settlement">
          <i class="fas fa-check"></i> 입금 확인 및 승인
        </button>
        <p class="approval-note">입금 확인 후 승인하면 정산이 완료됩니다.</p>
      </div>
    `;
  }

  return `
    <div class="detail-content">
      <div class="detail-section">
        <h4>기본 정보</h4>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="label">유저ID</span>
            <span class="value">${response.userId}</span>
          </div>
          <div class="detail-item">
            <span class="label">날짜</span>
            <span class="value">${response.date}</span>
          </div>
          <div class="detail-item">
            <span class="label">상품 수</span>
            <span class="value">${response.items.length}건</span>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <h4>낙찰 상품 목록</h4>
        <div class="table-responsive">
          <table class="detail-table">
            <thead>
              <tr>
                <th>상품ID</th>
                <th>제목</th>
                <th>입찰금액</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              ${
                response.items.length > 0
                  ? response.items
                      .map(
                        (item) => `
                <tr>
                  <td>${item.itemId}</td>
                  <td>${item.title}</td>
                  <td>¥${item.bidAmount?.toLocaleString() || "-"}</td>
                  <td>${getStatusText(item.status)}</td>
                </tr>
              `,
                      )
                      .join("")
                  : '<tr><td colspan="4" class="text-center">상품이 없습니다.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </div>

      <div class="detail-section">
        <h4>정산 정보</h4>
        <div class="settlement-detail-grid">
          <div class="settlement-detail-item">
            <span class="label">총 청구액</span>
            <span class="value">₩${response.grandTotal.toLocaleString()}</span>
          </div>
          <div class="settlement-detail-item">
            <span class="label">기 결제액</span>
            <span class="value">₩${(response.completedAmount || 0).toLocaleString()}</span>
          </div>
          <div class="settlement-detail-item highlight">
            <span class="label">미수금</span>
            <span class="value ${remaining > 0 ? "text-danger" : ""}">₩${remaining.toLocaleString()}</span>
          </div>
          <div class="settlement-detail-item">
            <span class="label">정산 상태</span>
            <span class="value">${getPaymentStatusText(response.paymentStatus)}</span>
          </div>
        </div>
      </div>

      ${approvalSection}
    </div>
  `;
}

// =====================================================
// 정산 승인
// =====================================================
async function approveSettlement(settlementId, userId, date, total, completed) {
  const remaining = total - completed;

  const memo = prompt(
    `${userId}의 정산을 승인하시겠습니까?\n\n` +
      `날짜: ${date}\n` +
      `총 청구액: ₩${total.toLocaleString()}\n` +
      `기 결제액: ₩${completed.toLocaleString()}\n` +
      `입금 확인 금액: ₩${remaining.toLocaleString()}\n\n` +
      `관리자 메모를 입력하세요 (선택사항):`,
    "입금 확인 완료",
  );

  if (memo === null) {
    // 취소
    return;
  }

  try {
    await window.API.fetchAPI(
      `/api/bid-results/admin/settlements/${settlementId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "paid",
          admin_memo: memo || "입금 확인 완료",
        }),
      },
    );

    alert("정산이 승인되었습니다.");
    await loadResults();
  } catch (error) {
    console.error("정산 승인 실패:", error);
    alert(
      "정산 승인 중 오류가 발생했습니다.\n" +
        (error.message || "다시 시도해주세요."),
    );
  }
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
  loadResults();
}

// =====================================================
// 유틸리티
// =====================================================
function toggleLoading(show) {
  const loading = document.getElementById("loadingMsg");
  if (loading) {
    loading.style.display = show ? "block" : "none";
  }
}

function getStatusText(status) {
  const map = {
    completed: "낙찰 완료",
    shipped: "출고됨",
    cancelled: "낙찰 실패",
    active: "진행 중",
  };
  return map[status] || status;
}

function getPaymentStatusText(status) {
  const map = {
    pending: "미결제",
    paid: "결제 완료",
  };
  return map[status] || status;
}

// =====================================================
// 전역 함수 등록 (HTML onclick에서 사용)
// =====================================================
window.goToPage = goToPage;

// =====================================================
// 초기화 실행
// =====================================================
document.addEventListener("DOMContentLoaded", initialize);
