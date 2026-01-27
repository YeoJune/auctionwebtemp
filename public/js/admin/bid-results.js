// public/js/admin/bid-results.js

// 상태 관리
window.state = {
  dateRange: 30,
  currentPage: 1,
  itemsPerPage: 7,
  sortBy: "date",
  sortOrder: "desc",
  settlementStatus: "", // 정산 상태 필터
  userSearch: "", // 유저 검색
  dailyResults: [],
  totalItems: 0,
  totalPages: 0,
  isAuthenticated: false,
  isAdmin: true, // 관리자 페이지
  totalStats: null,
};

// Core 모듈 참조
const core = window.BidResultsCore;

// 현재 정산 정보 (모달용)
let currentSettlement = null;

// 초기화 함수
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

    window.state.isAuthenticated = window.AuthManager.isAuthenticated();
    window.state.isAdmin = window.AuthManager.isAdmin();

    console.log("관리자 인증 완료");

    // Core에 페이지 상태 전달
    core.setPageState(window.state);

    // URL 파라미터에서 초기 상태 로드
    loadStateFromURL();

    // 이벤트 리스너 설정
    setupEventListeners();

    // 초기 데이터 로드
    await fetchCompletedBids();

    // 관리자 통계 표시
    core.updateSummaryStatsVisibility();

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

// URL에서 상태 로드
function loadStateFromURL() {
  const stateKeys = [
    "dateRange",
    "currentPage",
    "sortBy",
    "sortOrder",
    "settlementStatus",
    "userSearch",
  ];
  const defaultState = {
    dateRange: 30,
    currentPage: 1,
    sortBy: "date",
    sortOrder: "desc",
    settlementStatus: "",
    userSearch: "",
  };

  const urlState = window.URLStateManager.loadFromURL(defaultState, stateKeys);
  Object.assign(window.state, urlState);

  updateUIFromState();
}

// URL 업데이트
function updateURL() {
  const defaultValues = {
    dateRange: 30,
    currentPage: 1,
    sortBy: "date",
    sortOrder: "desc",
    settlementStatus: "",
    userSearch: "",
  };

  window.URLStateManager.updateURL(window.state, defaultValues);
}

// UI 요소 상태 업데이트
function updateUIFromState() {
  const dateRange = document.getElementById("dateRange");
  if (dateRange) dateRange.value = window.state.dateRange;

  const settlementStatus = document.getElementById("settlementStatus");
  if (settlementStatus) settlementStatus.value = window.state.settlementStatus;

  const userSearch = document.getElementById("userSearch");
  if (userSearch) userSearch.value = window.state.userSearch;

  // 유저 검색 clear 버튼 표시/숨김
  const clearUserSearch = document.getElementById("clearUserSearch");
  if (clearUserSearch && window.state.userSearch) {
    clearUserSearch.style.display = "block";
  }

  core.updateSortButtonsUI();
}

// 환율 정보 가져오기
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

// 완료된 입찰 데이터 가져오기 (관리자용)
async function fetchCompletedBids() {
  if (!window.state.isAuthenticated || !window.state.isAdmin) {
    console.warn("관리자 권한이 필요합니다.");
    return;
  }

  core.toggleLoading(true);

  try {
    console.log("관리자 입찰 결과 데이터 로드 시작:", {
      dateRange: window.state.dateRange,
      page: window.state.currentPage,
      sortBy: window.state.sortBy,
      sortOrder: window.state.sortOrder,
      settlementStatus: window.state.settlementStatus,
      userSearch: window.state.userSearch,
    });

    const params = {
      dateRange: window.state.dateRange,
      sortBy: window.state.sortBy,
      sortOrder: window.state.sortOrder,
      page: window.state.currentPage,
      limit: window.state.itemsPerPage,
    };

    // 정산 상태 필터
    if (window.state.settlementStatus) {
      params.settlementStatus = window.state.settlementStatus;
    }

    // 유저 검색
    if (window.state.userSearch) {
      params.userId = window.state.userSearch;
    }

    const queryString = window.API.createURLParams(params);

    // 관리자 API 호출
    const response = await window.API.fetchAPI(
      `/admin/bid-results?${queryString}`,
    );

    console.log("백엔드 응답:", response);

    // 응답 데이터 검증
    if (!response || typeof response !== "object") {
      throw new Error("잘못된 응답 형식");
    }

    // dailyResults가 배열인지 확인
    if (!Array.isArray(response.dailyResults)) {
      console.error("dailyResults가 배열이 아닙니다:", response.dailyResults);
      response.dailyResults = [];
    }

    // pagination 객체 검증
    if (!response.pagination || typeof response.pagination !== "object") {
      console.error("pagination 정보가 없습니다:", response.pagination);
      response.pagination = {
        currentPage: 1,
        totalPages: 0,
        totalItems: 0,
      };
    }

    // 상태 업데이트
    window.state.dailyResults = response.dailyResults;
    window.state.totalStats = response.totalStats || null;
    window.state.totalItems = response.pagination.totalItems || 0;
    window.state.totalPages = response.pagination.totalPages || 0;
    window.state.currentPage = response.pagination.currentPage || 1;

    console.log("상태 업데이트 완료:", {
      dailyResultsCount: window.state.dailyResults.length,
      totalItems: window.state.totalItems,
      totalPages: window.state.totalPages,
    });

    // Core에 상태 전달
    core.setPageState(window.state);

    // URL 업데이트
    updateURL();

    // 결과 표시
    displayAdminResults();

    // 페이지네이션 생성
    createPagination(
      window.state.currentPage,
      window.state.totalPages,
      handlePageChange,
      "pagination",
    );

    // 정렬 버튼 UI 업데이트
    core.updateSortButtonsUI();

    // 통계 표시
    if (window.state.totalStats) {
      updateTotalStats(window.state.totalStats);
    }

    console.log("데이터 로드 완료");
  } catch (error) {
    console.error("데이터 로드 실패:", error);
    const container = document.getElementById("resultsList");
    if (container) {
      container.innerHTML =
        '<div class="no-results">데이터를 불러오는 데 실패했습니다.</div>';
    }
  } finally {
    core.toggleLoading(false);
  }
}

// 관리자용 결과 표시 (정산 승인 버튼 포함)
function displayAdminResults() {
  console.log("관리자용 결과 표시 시작");

  const container = document.getElementById("resultsList");
  if (!container) {
    console.error("Container not found: resultsList");
    return;
  }

  // 기본 결과 표시
  core.displayResults("resultsList");

  // 정산 승인 버튼 이벤트 바인딩 (관리자 전용)
  const settlementSections = container.querySelectorAll(".settlement-section");
  settlementSections.forEach((section) => {
    // 기존 버튼 제거하고 관리자용 버튼 추가
    const settlementActions = section.querySelector(".settlement-actions");
    if (settlementActions) {
      // 유저용 버튼 제거
      settlementActions.innerHTML = "";

      // 정산 데이터 추출
      const settlementId =
        section
          .querySelector("[data-settlement-id]")
          ?.getAttribute("data-settlement-id") ||
        section.getAttribute("data-settlement-id");
      const paymentStatus = section
        .querySelector(".status-badge")
        ?.textContent.trim();

      // 입금 확인 중 상태만 승인 버튼 표시
      if (paymentStatus === "입금 확인 중") {
        const approveBtn = document.createElement("button");
        approveBtn.className = "btn btn-primary";
        approveBtn.innerHTML =
          '<i class="fas fa-check-circle"></i> 입금 확인 및 승인';
        approveBtn.setAttribute("data-settlement-id", settlementId);

        approveBtn.addEventListener("click", () => {
          openSettlementApprovalModal(settlementId, section);
        });

        settlementActions.appendChild(approveBtn);
      } else if (paymentStatus === "결제 필요") {
        const waitingBtn = document.createElement("button");
        waitingBtn.className = "btn btn-secondary";
        waitingBtn.textContent = "입금 대기 중";
        waitingBtn.disabled = true;
        settlementActions.appendChild(waitingBtn);
      } else if (paymentStatus === "정산 완료") {
        const completedBtn = document.createElement("button");
        completedBtn.className = "btn btn-success";
        completedBtn.innerHTML = '<i class="fas fa-check"></i> 정산 완료';
        completedBtn.disabled = true;
        settlementActions.appendChild(completedBtn);
      }
    }
  });

  console.log("관리자용 결과 표시 완료");
}

// 통계 업데이트
function updateTotalStats(stats) {
  document.getElementById("totalItemCount").textContent = formatNumber(
    stats.totalItemCount || 0,
  );
  document.getElementById("totalJapaneseAmount").textContent =
    formatNumber(stats.totalJapaneseAmount || 0) + " ¥";
  document.getElementById("totalKoreanAmount").textContent =
    formatNumber(stats.totalKoreanAmount || 0) + " ₩";
  document.getElementById("totalFeeAmount").textContent =
    formatNumber(stats.totalFeeAmount || 0) + " ₩";
  document.getElementById("totalVatAmount").textContent =
    formatNumber(stats.totalVatAmount || 0) + " ₩";
  document.getElementById("totalAppraisalFee").textContent =
    formatNumber(stats.totalAppraisalFee || 0) + " ₩";
  document.getElementById("totalAppraisalVat").textContent =
    formatNumber(stats.totalAppraisalVat || 0) + " ₩";
  document.getElementById("grandTotalAmount").textContent =
    formatNumber(stats.grandTotalAmount || 0) + " ₩";
}

// 이벤트 리스너 설정
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
      window.state.userSearch = "";
      window.state.currentPage = 1;
      fetchCompletedBids();
    }
  });

  // 로그아웃
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await window.API.fetchAPI("/auth/signout", { method: "POST" });
    window.location.href = "/signin.html";
  });
}

// 정렬 변경
function handleSortChange(sortBy) {
  if (window.state.sortBy === sortBy) {
    window.state.sortOrder = window.state.sortOrder === "desc" ? "asc" : "desc";
  } else {
    window.state.sortBy = sortBy;
    window.state.sortOrder = "desc";
  }

  window.state.currentPage = 1;
  fetchCompletedBids();
}

// 필터 적용
function applyFilters() {
  const dateRange = document.getElementById("dateRange")?.value;
  const settlementStatus = document.getElementById("settlementStatus")?.value;
  const userSearch = document.getElementById("userSearch")?.value.trim();

  window.state.dateRange = parseInt(dateRange) || 30;
  window.state.settlementStatus = settlementStatus || "";
  window.state.userSearch = userSearch || "";
  window.state.currentPage = 1;

  fetchCompletedBids();
}

// 필터 초기화
function resetFilters() {
  window.state.dateRange = 30;
  window.state.sortBy = "date";
  window.state.sortOrder = "desc";
  window.state.settlementStatus = "";
  window.state.userSearch = "";
  window.state.currentPage = 1;

  // UI 초기화
  const dateRange = document.getElementById("dateRange");
  if (dateRange) dateRange.value = "30";

  const settlementStatus = document.getElementById("settlementStatus");
  if (settlementStatus) settlementStatus.value = "";

  const userSearch = document.getElementById("userSearch");
  if (userSearch) userSearch.value = "";

  const clearBtn = document.getElementById("clearUserSearch");
  if (clearBtn) clearBtn.style.display = "none";

  fetchCompletedBids();
}

// 페이지 변경
function handlePageChange(page) {
  window.state.currentPage = page;
  fetchCompletedBids();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// =====================================================
// 정산 승인 모달 관리
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

async function openSettlementApprovalModal(settlementId, sectionElement) {
  try {
    // 정산 정보 가져오기
    const response = await window.API.fetchAPI(
      `/admin/settlements/${settlementId}`,
    );

    if (!response || !response.settlement) {
      throw new Error("정산 정보를 가져올 수 없습니다.");
    }

    currentSettlement = response.settlement;

    // 모달 데이터 채우기
    document.getElementById("approvalUserId").textContent =
      currentSettlement.userId || "-";
    document.getElementById("approvalDate").textContent =
      formatDisplayDate(currentSettlement.settlementDate) || "-";
    document.getElementById("approvalDepositorName").textContent =
      currentSettlement.depositorName || "-";
    document.getElementById("approvalTotalAmount").textContent = formatCurrency(
      currentSettlement.grandTotal || 0,
    );
    document.getElementById("approvalCompletedAmount").textContent =
      formatCurrency(currentSettlement.completedAmount || 0);
    document.getElementById("approvalRemainingAmount").textContent =
      formatCurrency(
        (currentSettlement.grandTotal || 0) -
          (currentSettlement.completedAmount || 0),
      );

    // 입금 확인 금액 기본값 설정
    const remainingAmount =
      (currentSettlement.grandTotal || 0) -
      (currentSettlement.completedAmount || 0);
    document.getElementById("approvalPaymentAmount").value = remainingAmount;

    // 메모 초기화
    document.getElementById("approvalNote").value = "";

    // 모달 표시
    const modal = document.getElementById("settlementApprovalModal");
    if (modal) {
      modal.style.display = "flex";
    }
  } catch (error) {
    console.error("정산 정보 로드 실패:", error);
    alert("정산 정보를 불러오는 데 실패했습니다.");
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
    const response = await window.API.fetchAPI(
      `/admin/settlements/${currentSettlement.id}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentAmount,
          note,
        }),
      },
    );

    if (response && response.success) {
      alert("정산이 승인되었습니다.");
      closeSettlementApprovalModal();
      // 데이터 새로고침
      await fetchCompletedBids();
    } else {
      throw new Error(response.message || "정산 승인에 실패했습니다.");
    }
  } catch (error) {
    console.error("정산 승인 실패:", error);
    alert(error.message || "정산 승인 중 오류가 발생했습니다.");
  }
}

// =====================================================
// 유틸리티 함수
// =====================================================

function formatNumber(value) {
  if (typeof value !== "number") return "0";
  return value.toLocaleString("ko-KR");
}

function formatCurrency(value) {
  if (typeof value !== "number") return "₩0";
  return "₩" + value.toLocaleString("ko-KR");
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  const weekday = weekdays[date.getDay()];
  return `${year}년 ${month}월 ${day}일 (${weekday})`;
}

// 페이지 로드 시 초기화
document.addEventListener("DOMContentLoaded", initialize);
