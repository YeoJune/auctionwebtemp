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

    // Core에 페이지 상태 전달
    core.setPageState(window.state);

    // URL 파라미터에서 초기 상태 로드
    loadStateFromURL();

    // 이벤트 리스너 설정
    setupEventListeners();

    // 네비게이션 버튼 설정
    setupNavButtons();

    // 초기 데이터 로드
    await fetchCompletedBids();

    // 관리자 통계 표시 여부 설정
    core.updateSummaryStatsVisibility();
  } catch (error) {
    console.error("초기화 중 오류 발생:", error);
    alert("페이지 초기화 중 오류가 발생했습니다.");
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

// ✨ 완료된 입찰 데이터 가져오기 (통합 API 사용)
async function fetchCompletedBids() {
  if (!window.state.isAuthenticated) {
    return;
  }

  core.toggleLoading(true);

  try {
    const params = {
      dateRange: window.state.dateRange,
      sortBy: window.state.sortBy,
      sortOrder: window.state.sortOrder,
      page: window.state.currentPage,
      limit: window.state.itemsPerPage,
    };

    const queryString = window.API.createURLParams(params);

    // ✨ 통합 API 호출
    const response = await window.API.fetchAPI(`/bid-results?${queryString}`);

    // ✨ 백엔드에서 이미 처리된 데이터 받음
    window.state.dailyResults = response.dailyResults;
    window.state.totalStats = response.totalStats;
    window.state.totalItems = response.pagination.totalItems;
    window.state.totalPages = response.pagination.totalPages;
    window.state.currentPage = response.pagination.currentPage;

    // Core에 상태 업데이트
    core.setPageState(window.state);

    // URL 업데이트
    updateURL();

    // 결과 표시
    core.displayResults();

    // 페이지네이션 생성
    createPagination(
      window.state.currentPage,
      window.state.totalPages,
      handlePageChange
    );

    // 정렬 버튼 UI 업데이트
    core.updateSortButtonsUI();

    // 결과 카운트 업데이트
    const totalResultsElement = document.getElementById("totalResults");
    if (totalResultsElement) {
      totalResultsElement.textContent = window.state.totalItems;
    }

    // 관리자 통계 업데이트
    if (window.state.totalStats) {
      updateTotalStatsUI();
    }
  } catch (error) {
    console.error("낙찰 데이터를 가져오는 중 오류 발생:", error);
    document.getElementById("resultsList").innerHTML =
      '<div class="no-results">데이터를 불러오는 데 실패했습니다.</div>';
  } finally {
    core.toggleLoading(false);
  }
}

// ✨ 통계 UI 업데이트
function updateTotalStatsUI() {
  if (!window.state.totalStats) return;

  const stats = window.state.totalStats;

  const updateElement = (id, value, suffix = "") => {
    const el = document.getElementById(id);
    if (el) el.textContent = formatNumber(value || 0) + suffix;
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
  document.getElementById("dateRange")?.addEventListener("change", (e) => {
    window.state.dateRange = parseInt(e.target.value);
    window.state.currentPage = 1;
    fetchCompletedBids();
  });

  // 정렬 버튼들
  const sortButtons = document.querySelectorAll(".sort-btn");
  sortButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      handleSortChange(btn.dataset.sort);
    });
  });

  // 필터 적용 버튼
  document.getElementById("applyFilters")?.addEventListener("click", () => {
    window.state.currentPage = 1;
    fetchCompletedBids();
  });

  // 필터 초기화 버튼
  document.getElementById("resetFilters")?.addEventListener("click", () => {
    resetFilters();
  });
}

// ✨ 정렬 변경 처리 (백엔드 재요청)
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

// ✨ 페이지 변경 처리 (백엔드 재요청)
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

// 네비게이션 버튼 설정
function setupNavButtons() {
  const navButtons = document.querySelectorAll(".nav-button");
  navButtons.forEach((button) => {
    // 필요시 추가 처리
  });
}

// ✨ 감정서 신청 함수 (통합 엔드포인트 사용)
window.requestAppraisal = async function (item) {
  if (
    confirm(
      "감정서를 신청하시겠습니까?\n수수료 16,500원(VAT포함)이 추가됩니다."
    )
  ) {
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
      alert("감정서 신청 중 오류가 발생했습니다.");
    } finally {
      core.toggleLoading(false);
    }
  }
};

// DOM 완료 시 실행
document.addEventListener("DOMContentLoaded", initialize);
