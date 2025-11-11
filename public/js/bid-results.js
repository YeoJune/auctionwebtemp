// public/js/bid-results.js

// 상태 관리
window.state = {
  dateRange: 30,
  currentPage: 1,
  itemsPerPage: 7,
  sortBy: "date",
  sortOrder: "desc",
  dailyResults: [],
  totalItems: 0,
  totalPages: 0,
  isAuthenticated: false,
  isAdmin: false,
  totalStats: null,
};

// Core 모듈 참조
const core = window.BidResultsCore;

// 초기화 함수
async function initialize() {
  try {
    console.log("입찰 결과 페이지 초기화 시작");

    // API 초기화
    await window.API.initialize();

    // 환율 정보 가져오기
    await fetchExchangeRate();

    // 사용자 수수료율 가져오기
    await fetchUserCommissionRate();

    // 인증 상태 확인
    const isAuthenticated = await window.AuthManager.checkAuthStatus();
    if (!isAuthenticated) {
      window.AuthManager.redirectToSignin();
      return;
    }

    window.state.isAuthenticated = window.AuthManager.isAuthenticated();
    window.state.isAdmin = window.AuthManager.isAdmin();

    console.log("사용자 인증 완료:", {
      isAuthenticated: window.state.isAuthenticated,
      isAdmin: window.state.isAdmin,
    });

    // Core에 페이지 상태 전달
    core.setPageState(window.state);

    // URL 파라미터에서 초기 상태 로드
    loadStateFromURL();

    // 이벤트 리스너 설정
    setupEventListeners();

    // 초기 데이터 로드
    await fetchCompletedBids();

    // 관리자 통계 표시 여부 설정
    core.updateSummaryStatsVisibility();

    console.log("입찰 결과 페이지 초기화 완료");
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
  const stateKeys = ["dateRange", "currentPage", "sortBy", "sortOrder"];
  const defaultState = {
    dateRange: 30,
    currentPage: 1,
    sortBy: "date",
    sortOrder: "desc",
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
  };

  window.URLStateManager.updateURL(window.state, defaultValues);
}

// UI 요소 상태 업데이트
function updateUIFromState() {
  const dateRange = document.getElementById("dateRange");
  if (dateRange) dateRange.value = window.state.dateRange;

  core.updateSortButtonsUI();
}

// 완료된 입찰 데이터 가져오기
async function fetchCompletedBids() {
  if (!window.state.isAuthenticated) {
    console.warn("인증되지 않은 상태입니다.");
    return;
  }

  core.toggleLoading(true);

  try {
    console.log("입찰 결과 데이터 로드 시작:", {
      dateRange: window.state.dateRange,
      page: window.state.currentPage,
      sortBy: window.state.sortBy,
      sortOrder: window.state.sortOrder,
    });

    const params = {
      dateRange: window.state.dateRange,
      sortBy: window.state.sortBy,
      sortOrder: window.state.sortOrder,
      page: window.state.currentPage,
      limit: window.state.itemsPerPage,
    };

    const queryString = window.API.createURLParams(params);

    // 통합 API 호출
    const response = await window.API.fetchAPI(`/bid-results?${queryString}`);

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
    core.displayResults("resultsList");

    // 페이지네이션 생성
    createPagination(
      window.state.currentPage,
      window.state.totalPages,
      handlePageChange,
      "pagination"
    );

    // 정렬 버튼 UI 업데이트
    core.updateSortButtonsUI();

    // 결과 카운트 업데이트
    const totalResultsElement = document.getElementById("totalResults");
    if (totalResultsElement) {
      totalResultsElement.textContent = window.state.totalItems;
    }

    // 관리자 통계 업데이트
    if (window.state.isAdmin && window.state.totalStats) {
      updateTotalStatsUI();
    }

    console.log("입찰 결과 데이터 표시 완료");
  } catch (error) {
    console.error("낙찰 데이터를 가져오는 중 오류 발생:", error);
    const container = document.getElementById("resultsList");
    if (container) {
      container.innerHTML = `
        <div class="no-results">
          <p>데이터를 불러오는 데 실패했습니다.</p>
          <p style="color: #666; font-size: 0.9em;">${error.message}</p>
          <button onclick="window.location.reload()" class="primary-button" style="margin-top: 10px;">
            새로고침
          </button>
        </div>
      `;
    }
  } finally {
    core.toggleLoading(false);
  }
}

// 통계 UI 업데이트
function updateTotalStatsUI() {
  if (!window.state.totalStats) {
    console.warn("totalStats가 없습니다.");
    return;
  }

  const stats = window.state.totalStats;

  const updateElement = (id, value, suffix = "") => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = formatNumber(value || 0) + suffix;
    } else {
      console.warn(`Element not found: ${id}`);
    }
  };

  updateElement("totalItemCount", stats.itemCount);
  updateElement("totalKoreanAmount", stats.koreanAmount, " ₩");
  updateElement("totalFeeAmount", stats.feeAmount, " ₩");
  updateElement("totalVatAmount", stats.vatAmount, " ₩");
  updateElement("totalAppraisalFee", stats.appraisalFee, " ₩");
  updateElement("totalAppraisalVat", stats.appraisalVat, " ₩");
  updateElement("grandTotalAmount", stats.grandTotalAmount, " ₩");
}

// 이벤트 리스너 설정
function setupEventListeners() {
  // 기간 드롭다운
  const dateRange = document.getElementById("dateRange");
  if (dateRange) {
    dateRange.addEventListener("change", (e) => {
      window.state.dateRange = parseInt(e.target.value);
      window.state.currentPage = 1;
      fetchCompletedBids();
    });
  }

  // 정렬 버튼들
  const sortButtons = document.querySelectorAll(".sort-btn");
  sortButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      handleSortChange(btn.dataset.sort);
    });
  });

  // 필터 적용 버튼
  const applyButton = document.getElementById("applyFilters");
  if (applyButton) {
    applyButton.addEventListener("click", () => {
      window.state.currentPage = 1;
      fetchCompletedBids();
    });
  }

  // 필터 초기화 버튼
  const resetButton = document.getElementById("resetFilters");
  if (resetButton) {
    resetButton.addEventListener("click", () => {
      resetFilters();
    });
  }
}

// 정렬 변경 처리
function handleSortChange(sortKey) {
  if (window.state.sortBy === sortKey) {
    window.state.sortOrder = window.state.sortOrder === "asc" ? "desc" : "asc";
  } else {
    window.state.sortBy = sortKey;
    window.state.sortOrder = "desc";
  }

  window.state.currentPage = 1;
  fetchCompletedBids();
}

// 필터 초기화
function resetFilters() {
  window.state.dateRange = 30;
  window.state.currentPage = 1;
  window.state.sortBy = "date";
  window.state.sortOrder = "desc";

  core.setPageState(window.state);
  updateUIFromState();
  fetchCompletedBids();
}

// 페이지 변경 처리
function handlePageChange(page) {
  page = parseInt(page, 10);

  if (
    page === window.state.currentPage ||
    page < 1 ||
    page > window.state.totalPages
  ) {
    return;
  }

  window.state.currentPage = page;
  fetchCompletedBids();
  window.scrollTo(0, 0);
}

// 감정서 신청 함수
window.requestAppraisal = async function (item) {
  if (
    !confirm(
      "감정서를 신청하시겠습니까?\n수수료 16,500원(VAT포함)이 추가됩니다."
    )
  ) {
    return;
  }

  try {
    core.toggleLoading(true);

    const endpoint =
      item.type === "direct"
        ? `/bid-results/direct/${item.id}/request-appraisal`
        : `/bid-results/live/${item.id}/request-appraisal`;

    const response = await window.API.fetchAPI(endpoint, {
      method: "POST",
    });

    if (response.message) {
      alert("감정서 신청이 완료되었습니다.");
      await fetchCompletedBids();
    }
  } catch (error) {
    console.error("감정서 신청 중 오류:", error);
    alert(error.message || "감정서 신청 중 오류가 발생했습니다.");
  } finally {
    core.toggleLoading(false);
  }
};

// 수선 접수 함수
window.requestRepair = async function (item) {
  // 수선 수수료 (나중에 수정 가능)
  const REPAIR_FEE = 0; // 원 (VAT 포함)

  const confirmMessage =
    REPAIR_FEE > 0
      ? `수선을 접수하시겠습니까?\n수수료 ${REPAIR_FEE.toLocaleString()}원(VAT포함)이 추가됩니다.`
      : "수선을 접수하시겠습니까?";

  if (!confirm(confirmMessage)) {
    return;
  }

  try {
    core.toggleLoading(true);

    const endpoint =
      item.type === "direct"
        ? `/bid-results/direct/${item.id}/request-repair`
        : `/bid-results/live/${item.id}/request-repair`;

    const response = await window.API.fetchAPI(endpoint, {
      method: "POST",
    });

    if (response.message) {
      alert("수선 접수가 완료되었습니다.");
      await fetchCompletedBids();
    }
  } catch (error) {
    console.error("수선 접수 중 오류:", error);
    alert(error.message || "수선 접수 중 오류가 발생했습니다.");
  } finally {
    core.toggleLoading(false);
  }
};

// DOM 완료 시 실행
document.addEventListener("DOMContentLoaded", initialize);
