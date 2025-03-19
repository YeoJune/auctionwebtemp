// public/js/admin/api.js

// API 기본 URL
const API_BASE_URL = "/api";

// 공통 fetch 함수
async function fetchAPI(endpoint, options = {}) {
  const defaultOptions = {
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include", // 쿠키 전송 (세션 인증)
  };

  const fetchOptions = { ...defaultOptions, ...options };

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, fetchOptions);

    // 세션 만료시 로그인 페이지로 리다이렉트
    if (response.status === 401) {
      window.location.href = "/signinPage";
      return null;
    }

    // 403 권한 없음
    if (response.status === 403) {
      throw new Error("접근 권한이 없습니다.");
    }

    // 404 찾을 수 없음
    if (response.status === 404) {
      throw new Error("요청한 리소스를 찾을 수 없습니다.");
    }

    // 500 서버 오류
    if (response.status >= 500) {
      throw new Error("서버 오류가 발생했습니다.");
    }

    // 그 외 HTTP 오류
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `API 요청 오류: ${response.status}`);
    }

    // 응답 데이터 반환
    if (response.headers.get("content-type")?.includes("application/json")) {
      return await response.json();
    }

    return await response.text();
  } catch (error) {
    console.error("API 요청 오류:", error);
    throw error;
  }
}

// ---- 대시보드 API ----

// 요약 정보 조회
async function fetchDashboardSummary() {
  return fetchAPI("/admin/dashboard/summary");
}

// 최근 활동 조회
async function fetchRecentActivities() {
  return fetchAPI("/admin/dashboard/activities");
}

// 사용자 통계 조회
async function fetchUserStats() {
  try {
    // API 호출
    return await fetchAPI("/metrics");
  } catch (error) {
    // 에러 발생 시 기본값 반환
    console.error("사용자 통계 가져오기 실패:", error);

    // metrics 모듈이 구현되지 않은 경우를 위한 샘플 데이터
    return {
      activeMemberUsers: 0,
      activeGuestUsers: 0,
      totalActiveUsers: 0,
      dailyMemberUsers: 0,
      dailyGuestUsers: 0,
      totalDailyUsers: 0,
      totalRequests: 0,
      uniquePageviews: 0,
      lastReset: new Date().toISOString(),
      lastManualReset: null,
    };
  }
}

// ---- 현장 경매 API ----

// 현장 경매 목록 조회 (페이지네이션, 정렬, 날짜 필터 추가)
async function fetchLiveBids(
  status = "",
  page = 1,
  limit = 10,
  sortBy = "updated_at",
  sortOrder = "desc",
  fromDate = "",
  toDate = ""
) {
  const params = new URLSearchParams({
    status: status,
    page: page,
    limit: limit,
  });

  if (sortBy) {
    params.append("sortBy", sortBy);
  }

  if (sortOrder) {
    params.append("sortOrder", sortOrder);
  }

  if (fromDate) {
    params.append("fromDate", fromDate);
  }

  if (toDate) {
    params.append("toDate", toDate);
  }

  return fetchAPI(`/live-bids?${params.toString()}`);
}

// 2차 입찰가 제안
async function proposeSecondPrice(bidId, secondPrice) {
  return fetchAPI(`/live-bids/${bidId}/second`, {
    method: "PUT",
    body: JSON.stringify({ secondPrice }),
  });
}

// 입찰 완료 처리
async function completeBid(bidId) {
  return fetchAPI(`/live-bids/${bidId}/complete`, {
    method: "PUT",
    body: JSON.stringify({}),
  });
}

// 입찰 취소 처리
async function cancelBid(bidId) {
  return fetchAPI(`/live-bids/${bidId}/cancel`, {
    method: "PUT",
    body: JSON.stringify({}),
  });
}

// ---- 직접 경매 API ----

// 직접 경매 목록 조회 (페이지네이션, 정렬, 날짜 필터 추가)
async function fetchDirectBids(
  status = "",
  highestOnly = true,
  page = 1,
  limit = 10,
  sortBy = "updated_at",
  sortOrder = "desc",
  fromDate = "",
  toDate = ""
) {
  const params = new URLSearchParams({
    status: status,
    highestOnly: highestOnly,
    page: page,
    limit: limit,
  });

  if (sortBy) {
    params.append("sortBy", sortBy);
  }

  if (sortOrder) {
    params.append("sortOrder", sortOrder);
  }

  if (fromDate) {
    params.append("fromDate", fromDate);
  }

  if (toDate) {
    params.append("toDate", toDate);
  }

  return fetchAPI(`/direct-bids?${params.toString()}`);
}

// 특정 직접 경매 조회
async function fetchDirectBid(bidId) {
  return fetchAPI(`/direct-bids/${bidId}`);
}

// 입찰 제출
async function placeBid(itemId, currentPrice) {
  return fetchAPI("/direct-bids", {
    method: "POST",
    body: JSON.stringify({ itemId, currentPrice }),
  });
}

// 입찰 완료 처리
async function completeDirectBid(bidId) {
  return fetchAPI(`/direct-bids/${bidId}/complete`, {
    method: "PUT",
    body: JSON.stringify({}),
  });
}

// 입찰 취소 처리
async function cancelDirectBid(bidId) {
  return fetchAPI(`/direct-bids/${bidId}/cancel`, {
    method: "PUT",
    body: JSON.stringify({}),
  });
}

// 직접 입찰 플랫폼 반영 완료 표시
async function markDirectBidAsSubmitted(bidId) {
  return fetchAPI(`/direct-bids/${bidId}/mark-submitted`, {
    method: "PUT",
    body: JSON.stringify({}),
  });
}

// ---- 관리자 설정 API ----

// 크롤링 상태 체크
async function checkCrawlingStatus() {
  return fetchAPI("/crawler/crawl-status");
}

// 상품 크롤링 시작
async function startProductCrawling() {
  return fetchAPI("/crawler/crawl", { method: "GET" });
}

// 시세표 크롤링 시작
async function startValueCrawling() {
  return fetchAPI("/crawler/crawl-values", { method: "GET" });
}

// 크롤링 스케줄 설정
async function updateCrawlSchedule(crawlSchedule) {
  return fetchAPI("/admin/settings", {
    method: "POST",
    body: JSON.stringify({ crawlSchedule }),
  });
}

// 공지 목록 조회
async function fetchNotices() {
  return fetchAPI("/admin/notices");
}

// 특정 공지 조회
async function fetchNotice(noticeId) {
  return fetchAPI(`/admin/notices/${noticeId}`);
}

// 공지 저장
async function saveNotice(noticeData) {
  const { id, ...data } = noticeData;

  if (id) {
    return fetchAPI(`/admin/notices/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  } else {
    return fetchAPI("/admin/notices", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }
}

// 공지 삭제
async function deleteNotice(noticeId) {
  return fetchAPI(`/admin/notices/${noticeId}`, {
    method: "DELETE",
  });
}

// 필터 설정 조회
async function fetchFilterSettings() {
  return fetchAPI("/admin/filter-settings");
}

// 필터 설정 업데이트
async function updateFilterSetting(filterType, filterValue, isEnabled) {
  return fetchAPI("/admin/filter-settings", {
    method: "PUT",
    body: JSON.stringify({ filterType, filterValue, isEnabled }),
  });
}

// ---- 회원 관리 API ----

// 회원 목록 조회
async function fetchUsers(status = "") {
  return fetchAPI(`/users?status=${status}`);
}

// 특정 회원 조회
async function fetchUser(userId) {
  return fetchAPI(`/users/${userId}`);
}

// 새 회원 생성
async function createUser(userData) {
  return fetchAPI("/users", {
    method: "POST",
    body: JSON.stringify(userData),
  });
}

// 회원 정보 수정
async function updateUser(userId, userData) {
  return fetchAPI(`/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify(userData),
  });
}

// 회원 삭제
async function deleteUser(userId) {
  return fetchAPI(`/users/${userId}`, {
    method: "DELETE",
  });
}

// 구글 스프레드시트와 회원 동기화
async function syncUsers() {
  return fetchAPI("/users/sync", {
    method: "POST",
  });
}

// ---- 유틸리티 함수 ----

// 통화 포맷 함수
function formatCurrency(amount, currency = "JPY") {
  if (!amount) return "-";

  if (currency === "JPY") {
    // 일본 엔으로 표시
    return new Intl.NumberFormat("ja-JP", {
      style: "currency",
      currency: "JPY",
      maximumFractionDigits: 0,
    }).format(amount);
  } else {
    // 한국 원으로 표시 (기본 통화)
    return new Intl.NumberFormat("ko-KR", {
      style: "currency",
      currency: "KRW",
      maximumFractionDigits: 0,
    }).format(amount);
  }
}

// 날짜 포맷 함수
function formatDate(dateString) {
  if (!dateString) return "-";
  const date = new Date(dateString);
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
