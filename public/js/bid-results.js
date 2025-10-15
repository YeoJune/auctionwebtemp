// public/js/bid-results.js

// 상태 관리
window.state = {
  dateRange: 30, // 날짜 범위(일)
  currentPage: 1, // 현재 페이지
  itemsPerPage: 7, // 페이지당 날짜 수 (일별 그룹화)
  sortBy: "date", // 정렬 기준 (기본: 날짜)
  sortOrder: "desc", // 정렬 순서 (기본: 내림차순)
  combinedResults: [], // 결합된 결과
  dailyResults: [], // 일별로 그룹화된 결과
  filteredResults: [], // 필터링된 결과
  totalItems: 0, // 전체 아이템 수
  totalPages: 0, // 전체 페이지 수
  isAuthenticated: false, // 인증 상태
  isAdmin: false, // 관리자 권한
  totalStats: {
    itemCount: 0,
    japaneseAmount: 0,
    koreanAmount: 0,
    feeAmount: 0,
    grandTotalAmount: 0,
    appraisalFee: 0, // 추가
    appraisalVat: 0, // 추가
    appraisalCount: 0, // 추가
  },
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

    // 인증 상태 확인 - AuthManager 사용
    const isAuthenticated = await window.AuthManager.checkAuthStatus();
    if (!isAuthenticated) {
      window.AuthManager.redirectToSignin();
      return;
    }

    window.state.isAuthenticated = window.AuthManager.isAuthenticated();
    window.state.isAdmin = window.AuthManager.isAdmin();

    // Core에 페이지 상태 전달
    core.setPageState(window.state);

    // URL 파라미터에서 초기 상태 로드 - URLStateManager 사용
    loadStateFromURL();

    // 이벤트 리스너 설정
    setupEventListeners();

    // 네비게이션 버튼 설정
    setupNavButtons();

    // 초기 데이터 로드
    await fetchCompletedBids();
  } catch (error) {
    console.error("초기화 중 오류 발생:", error);
    alert("페이지 초기화 중 오류가 발생했습니다.");
  }
}

// URL에서 상태 로드 - URLStateManager 사용
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

  // UI 요소 상태 업데이트
  updateUIFromState();
}

// URL 업데이트 - URLStateManager 사용
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
  // 날짜 범위 선택
  const dateRange = document.getElementById("dateRange");
  if (dateRange) dateRange.value = window.state.dateRange;

  // 정렬 버튼 업데이트
  core.updateSortButtonsUI();
}

// 완료된 입찰 데이터 가져오기
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

    // ✨ 한 번만 호출
    const response = await window.API.fetchAPI(`/bid-results?${queryString}`);

    // ✨ 백엔드에서 이미 처리된 데이터 받음
    window.state.dailyResults = response.dailyResults;
    window.state.filteredResults = response.dailyResults;
    window.state.totalStats = response.totalStats;
    window.state.totalItems = response.pagination.totalItems;
    window.state.totalPages = response.pagination.totalPages;
    window.state.currentPage = response.pagination.currentPage;

    updateURL();

    // ✨ 바로 표시
    core.displayResults();

    createPagination(
      window.state.currentPage,
      window.state.totalPages,
      handlePageChange
    );

    core.updateSortButtonsUI();

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

function updateTotalStatsUI() {
  if (!window.state.totalStats) return;

  const stats = window.state.totalStats;

  document.getElementById("totalItemCount").textContent = formatNumber(
    stats.itemCount || 0
  );
  document.getElementById("totalJapaneseAmount").textContent =
    formatNumber(stats.japaneseAmount || 0) + " ¥";
  document.getElementById("totalKoreanAmount").textContent =
    formatNumber(stats.koreanAmount || 0) + " ₩";
  document.getElementById("totalFeeAmount").textContent =
    formatNumber(stats.feeAmount || 0) + " ₩";
  document.getElementById("totalVatAmount").textContent =
    formatNumber(stats.vatAmount || 0) + " ₩";
  document.getElementById("totalAppraisalFee").textContent =
    formatNumber(stats.appraisalFee || 0) + " ₩";
  document.getElementById("totalAppraisalVat").textContent =
    formatNumber(stats.appraisalVat || 0) + " ₩";
  document.getElementById("grandTotalAmount").textContent =
    formatNumber(stats.grandTotalAmount || 0) + " ₩";
}

// 이벤트 리스너 설정 - 인증 관련 제거 (common.js에서 처리)
function setupEventListeners() {
  // 기간 드롭다운
  document.getElementById("dateRange")?.addEventListener("change", (e) => {
    window.state.dateRange = parseInt(e.target.value);
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

// 정렬 변경 처리
function handleSortChange(sortKey) {
  if (window.state.sortBy === sortKey) {
    window.state.sortOrder = window.state.sortOrder === "asc" ? "desc" : "asc";
  } else {
    window.state.sortBy = sortKey;
    window.state.sortOrder = "desc";
  }

  // ✨ 백엔드에 다시 요청
  window.state.currentPage = 1;
  fetchCompletedBids();
}

// 필터 초기화
function resetFilters() {
  window.state.dateRange = 30;
  window.state.currentPage = 1;
  window.state.sortBy = "date";
  window.state.sortOrder = "desc";

  // Core에 상태 전달
  core.setPageState(window.state);

  // UI 요소 초기화
  updateUIFromState();

  // 데이터 다시 로드
  fetchCompletedBids();
}

// 페이지 변경 처리
function handlePageChange(page) {
  core.handlePageChange(page, updateURL);
}

// 네비게이션 버튼 설정
function setupNavButtons() {
  // 각 네비게이션 버튼에 이벤트 리스너 추가
  const navButtons = document.querySelectorAll(".nav-button");
  navButtons.forEach((button) => {
    // 기존 onclick 속성 외에 추가 처리가 필요한 경우를 위한 공간
  });
}

// 감정서 신청 함수 (전역으로 노출하여 core에서 사용)
window.requestAppraisal = async function (item) {
  if (
    confirm(
      "감정서를 신청하시겠습니까?\n수수료 16,500원(VAT포함)이 추가됩니다."
    )
  ) {
    try {
      core.toggleLoading(true);

      // ✨ 통합 엔드포인트 사용
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
