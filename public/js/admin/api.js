// public/js/admin/api.js

// API 기본 URL
const API_BASE_URL = "/api";
let EXCHANGE_RATE = 9.0;

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
  return fetchAPI("/metrics");
}

// ---- 현장 경매 API ----

// 현장 경매 목록 조회 (페이지네이션 추가)
async function fetchLiveBids(status = "", page = 1, limit = 10) {
  const params = new URLSearchParams({
    status: status,
    page: page,
    limit: limit,
  });
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

// 직접 경매 목록 조회 (페이지네이션 추가)
async function fetchDirectBids(
  status = "",
  highestOnly = true,
  page = 1,
  limit = 10
) {
  const params = new URLSearchParams({
    status: status,
    highestOnly: highestOnly,
    page: page,
    limit: limit,
  });
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

// 환율 정보 가져오기
async function fetchExchangeRate() {
  try {
    const response = await fetchAPI("/data/exchange-rate");
    EXCHANGE_RATE = response.rate;
    return response.rate;
  } catch (error) {
    console.error("Error fetching exchange rate:", error);
    return EXCHANGE_RATE; // 기본값 반환
  }
}

// ---- 수수료 계산 함수 ----

/**
 * 현지 수수료 계산 함수
 * @param {number} price - 상품 가격 (P291)
 * @param {number} auctionId - 플랫폼 구분 (1: ecoauc, 2: brand, 3: starbuyers)
 * @param {string} category - 상품 카테고리
 * @returns {number} 계산된 현지 수수료
 */
function calculateLocalFee(price, auctionId, category) {
  if (!price) return 0;
  price = Number(price);

  // ecoauc (auctionId: 1)
  if (auctionId == 1) {
    if (price < 10000) return 1800;
    if (price < 50000) return 2800;
    if (price < 100000) return 4800;
    if (price < 1000000) return 8800;
    return 10800;
  }

  // brand auction (auctionId: 2)
  if (auctionId == 2) {
    if (price < 100000) {
      return Math.round(price * 0.11 + 1990);
    }
    return Math.round(price * 0.077 + 1990);
  }

  // starbuyers (auctionId: 3)
  if (auctionId == 3) {
    // 1. 기본 수수료 계산
    const baseFee = price * 0.05;
    const vat = baseFee * 0.1;
    const insurance = (baseFee + vat) * 0.005;

    // 2. 카테고리별 추가 수수료
    let categoryFee = 0;
    switch (category) {
      case "가방":
        categoryFee = 2900;
        break;
      case "시계":
        categoryFee = 2700;
        break;
      case "쥬얼리":
      case "보석":
        categoryFee = 500 + price * 0.05;
        break;
      case "악세서리":
      case "의류":
        categoryFee = 2000 + price * 0.05;
        break;
    }

    // 3. 최종 수수료 (전체 합계 + 10%)
    return Math.round((baseFee + vat + insurance + categoryFee) * 1.1);
  }

  return 0;
}

/**
 * 관세 계산 함수 (부가세 제외)
 * @param {number} amountKRW - 원화 금액 (R291)
 * @param {string} category - 상품 카테고리
 * @returns {number} 계산된 관세 (부가세 제외)
 */
function calculateCustomsDuty(amountKRW, category) {
  if (!amountKRW || !category) return 0;

  // 의류/신발: 13% 관세
  if (["의류", "신발"].includes(category)) {
    return Math.round(amountKRW * 0.23);
  }

  // 그 외 카테고리 (가방/악세서리/소품/귀금속/시계 등)
  if (amountKRW <= 2000000) {
    // 200만원 이하: 8% 관세
    return Math.round(amountKRW * 0.08);
  } else if (amountKRW < 1000000000) {
    // 200만원 초과 10억 미만에 대한 복합 관세 계산
    const baseCustoms = amountKRW * 0.08; // 기본 관세 8%
    const amount = amountKRW; // 원금
    const excess = (baseCustoms + amount - 2000000) * 0.2; // 200만원 초과분에 대한 20%
    const superExcess = excess * 0.3; // 추가세에 대한 30%

    // (기본관세 + 원금 + 추가세 + 할증) * 1.1 - 원금
    return Math.round(
      (baseCustoms + amount + excess + superExcess) * 1.1 - amount
    );
  }

  return 0; // 10억 이상
}

/**
 * 최종 가격 계산 함수
 * @param {number} price - 상품 가격
 * @param {number} auctionId - 플랫폼 구분 (1: ecoauc, 2: brand, 3: starbuyers)
 * @param {string} category - 상품 카테고리
 * @returns {number} 최종 계산된 가격
 */
function calculateTotalPrice(price, auctionId, category) {
  price = parseFloat(price) || 0;

  // 1. 현지 수수료 계산
  const localFee = calculateLocalFee(price, auctionId, category);

  // 2. 원화 환산 (현지가격 + 현지수수료)
  const totalAmountKRW = (price + localFee) * EXCHANGE_RATE;

  // 3. 관세 계산 (부가세 제외)
  const customsDuty = calculateCustomsDuty(totalAmountKRW, category);

  // 4. 서비스 수수료 5%
  const serviceFee = (totalAmountKRW + customsDuty) * 0.05;

  // 5. 최종 금액 반환 (반올림)
  return Math.round(totalAmountKRW + customsDuty + serviceFee);
}

// API 초기화
async function initializeAPI() {
  await fetchExchangeRate();
}

// 초기화 실행
initializeAPI();
