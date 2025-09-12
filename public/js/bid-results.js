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

  // Core에 최신 상태 전달
  core.setPageState(window.state);

  // common.js의 toggleLoading 사용
  core.toggleLoading(true);

  try {
    // 날짜 범위 계산
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - window.state.dateRange);
    const fromDate = formatDate(dateLimit);

    // 정렬 및 페이지네이션 파라미터
    const params = {
      status: "active,final,completed,shipped,cancelled", // shipped 상태 추가
      fromDate: fromDate,
      sortBy: "scheduled_date", // scheduled_date로 변경
      sortOrder: "desc",
      limit: 0, // 모든 데이터 가져오기
    };

    // API 요청 URL 생성
    const queryString = window.API.createURLParams(params);

    // 경매 타입에 관계없이 모든 데이터 가져오기
    const [liveResults, directResults] = await Promise.all([
      window.API.fetchAPI(`/live-bids?${queryString}`),
      window.API.fetchAPI(`/direct-bids?${queryString}`),
    ]);

    // 결합 및 타입 정보 추가
    const liveBids = liveResults.bids || [];
    const directBids = directResults.bids || [];

    const liveBidsWithType = liveBids
      .filter((bid) => bid)
      .map((bid) => ({
        ...bid,
        type: "live",
      }));

    const directBidsWithType = directBids
      .filter((bid) => bid)
      .map((bid) => ({
        ...bid,
        type: "direct",
      }));

    window.state.combinedResults = [...liveBidsWithType, ...directBidsWithType];

    // Core에 상태 업데이트 후 일별로 그룹화
    core.setPageState(window.state);
    core.groupResultsByDate();

    // URL 업데이트
    updateURL();

    // 결과 표시
    core.displayResults();

    // 페이지네이션 업데이트 - common.js 함수 사용
    createPagination(
      window.state.currentPage,
      window.state.totalPages,
      handlePageChange
    );

    // 정렬 버튼 UI 업데이트
    core.updateSortButtonsUI();
  } catch (error) {
    console.error("낙찰 데이터를 가져오는 중 오류 발생:", error);
    document.getElementById("resultsList").innerHTML =
      '<div class="no-results">데이터를 불러오는 데 실패했습니다.</div>';
  } finally {
    core.toggleLoading(false);
  }
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
    // 같은 정렬 기준이면 정렬 방향 전환
    window.state.sortOrder = window.state.sortOrder === "asc" ? "desc" : "asc";
  } else {
    // 새로운 정렬 기준
    window.state.sortBy = sortKey;
    window.state.sortOrder = "desc"; // 기본 내림차순 (최신순, 가격 높은순, 개수 많은순)
  }

  // Core에 상태 전달
  core.setPageState(window.state);

  // 정렬 버튼 UI 업데이트
  core.updateSortButtonsUI();

  // 정렬 적용
  core.sortDailyResults();
  core.displayResults();

  // URL 업데이트
  updateURL();
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
      const endpoint = item.type === "direct" ? "direct-bids" : "live-bids";
      const response = await window.API.fetchAPI(
        `/${endpoint}/${item.id}/request-appraisal`,
        {
          method: "POST",
        }
      );

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
