// public/js/admin/dashboard.js

// 페이지 로드 시 실행
document.addEventListener("DOMContentLoaded", function () {
  loadDashboardData();

  // 1분마다 갱신
  setInterval(loadDashboardData, 60000);
});

// 대시보드 데이터 로드
async function loadDashboardData() {
  try {
    // 1. 사용자 통계 로드 (이미 구현된 API)
    const stats = await fetchUserStats();
    updateUserStats(stats);

    // 2. 비즈니스 KPI 데이터 계산
    await loadBusinessKPIs();

    // 3. 활성 경매 데이터 로드
    await loadActiveAuctions();
  } catch (error) {
    console.error("대시보드 데이터를 불러오는 중 오류가 발생했습니다:", error);
  }
}

// 사용자 통계 업데이트
function updateUserStats(stats) {
  document.getElementById("activeTotalUsers").textContent =
    stats.totalActiveUsers || 0;
  document.getElementById("dailyTotalUsers").textContent =
    stats.totalDailyUsers || 0;
  document.getElementById("totalRequests").textContent = stats.totalRequests
    ? stats.totalRequests.toLocaleString()
    : 0;
}

// 비즈니스 KPI 데이터 로드 및 업데이트
async function loadBusinessKPIs() {
  try {
    // 라이브 비드 데이터 로드 (첫 번째 페이지, 상태 필터 없음)
    const liveBidsResponse = await fetchLiveBids();
    const liveBids = liveBidsResponse?.bids || [];

    // 직접 비드 데이터 로드
    const directBidsResponse = await fetchDirectBids();
    const directBids = directBidsResponse?.bids || [];

    // KPI 계산
    const stats = calculateKPIStats(liveBids, directBids);

    // KPI 카드 업데이트
    updateBusinessKPIs(stats.successRate, stats.avgBidPrice, stats.todayBids);
  } catch (error) {
    console.error("비즈니스 KPI 로드 중 오류:", error);
    // 오류 발생시 UI에 '-' 표시
    updateBusinessKPIs("-", "-", "-");
  }
}

// KPI 통계 계산
function calculateKPIStats(liveBids, directBids) {
  // 1. 경매 성공률 계산
  const completedLiveBids = liveBids.filter(
    (bid) => bid.status === "completed"
  ).length;
  const completedDirectBids = directBids.filter(
    (bid) => bid.status === "completed"
  ).length;

  const cancelledLiveBids = liveBids.filter(
    (bid) => bid.status === "cancelled"
  ).length;
  const cancelledDirectBids = directBids.filter(
    (bid) => bid.status === "cancelled"
  ).length;

  const totalCompleted = completedLiveBids + completedDirectBids;
  const totalCancelled = cancelledLiveBids + cancelledDirectBids;
  const totalProcessed = totalCompleted + totalCancelled;

  const successRate =
    totalProcessed > 0
      ? ((totalCompleted / totalProcessed) * 100).toFixed(1)
      : 0;

  // 2. 평균 입찰가 계산
  let totalBidPrice = 0;
  let validBidCount = 0;

  liveBids.forEach((bid) => {
    // 최종 입찰가, 2차 입찰가 또는 1차 입찰가 중 가장 높은 값 사용
    const bidPrice = bid.final_price || bid.second_price || bid.first_price;
    if (bidPrice) {
      totalBidPrice += bidPrice;
      validBidCount++;
    }
  });

  directBids.forEach((bid) => {
    if (bid.current_price) {
      totalBidPrice += bid.current_price;
      validBidCount++;
    }
  });

  const avgBidPrice =
    validBidCount > 0 ? Math.round(totalBidPrice / validBidCount) : 0;

  // 3. 오늘의 입찰 수 계산
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayLiveBids = liveBids.filter((bid) => {
    const bidDate = new Date(bid.created_at);
    return bidDate >= today;
  }).length;

  const todayDirectBids = directBids.filter((bid) => {
    const bidDate = new Date(bid.created_at);
    return bidDate >= today;
  }).length;

  const todayBids = todayLiveBids + todayDirectBids;

  return {
    successRate,
    avgBidPrice,
    todayBids,
  };
}

// 비즈니스 KPI 데이터 업데이트
function updateBusinessKPIs(successRate, avgBidPrice, todayBids) {
  document.getElementById("successRate").textContent =
    typeof successRate === "number" ? `${successRate}%` : successRate;

  document.getElementById("avgBidPrice").textContent =
    typeof avgBidPrice === "number"
      ? formatCurrency(avgBidPrice, "JPY")
      : avgBidPrice;

  document.getElementById("todayBids").textContent =
    typeof todayBids === "number" ? todayBids : todayBids;
}

// 활성 경매 데이터 로드
async function loadActiveAuctions() {
  try {
    // 현장 경매 데이터 로드
    const liveBidsResponse = await fetchLiveBids("active", 1, 5);
    const liveBids = liveBidsResponse?.bids || [];

    // 직접 경매 데이터 로드
    const directBidsResponse = await fetchDirectBids("active", true, 1, 5);
    const directBids = directBidsResponse?.bids || [];

    // 최근 활동 사용자 추출
    const recentUsers = extractRecentUsers(liveBids, directBids);

    // UI 업데이트
    updateActiveAuctions(liveBids, directBids);
    updateActiveUsers(recentUsers);
  } catch (error) {
    console.error("활성 경매 데이터 로드 중 오류:", error);
    updateActiveAuctions([], []);
    updateActiveUsers([]);
  }
}

// 활성 경매 업데이트
function updateActiveAuctions(liveBids, directBids) {
  const liveAuctionsContainer = document.getElementById("liveAuctions");
  const directAuctionsContainer = document.getElementById("directAuctions");

  // 현장 경매 표시
  if (liveBids.length === 0) {
    liveAuctionsContainer.innerHTML =
      '<div class="no-data">활성 현장 경매가 없습니다.</div>';
  } else {
    let liveHtml = "";
    liveBids.forEach((bid) => {
      const itemTitle = bid.item?.original_title || "제목 없음";
      const bidPrice =
        bid.final_price || bid.second_price || bid.first_price || 0;
      const formattedPrice = formatCurrency(bidPrice, "JPY");

      liveHtml += `
        <div class="auction-item">
          <div class="item-title">${itemTitle}</div>
          <div class="item-meta">
            <span class="price">${formattedPrice}</span>
            <span class="bid-status">${getBidStatusText(bid.status)}</span>
          </div>
        </div>
      `;
    });
    liveAuctionsContainer.innerHTML = liveHtml;
  }

  // 직접 경매 표시
  if (directBids.length === 0) {
    directAuctionsContainer.innerHTML =
      '<div class="no-data">활성 직접 경매가 없습니다.</div>';
  } else {
    let directHtml = "";
    directBids.forEach((bid) => {
      const itemTitle = bid.item?.original_title || "제목 없음";
      const bidPrice = bid.current_price || 0;
      const formattedPrice = formatCurrency(bidPrice, "JPY");

      directHtml += `
        <div class="auction-item">
          <div class="item-title">${itemTitle}</div>
          <div class="item-meta">
            <span class="price">${formattedPrice}</span>
            <span class="bid-status">${getBidStatusText(bid.status)}</span>
          </div>
        </div>
      `;
    });
    directAuctionsContainer.innerHTML = directHtml;
  }
}

// 입찰 상태 텍스트 반환
function getBidStatusText(status) {
  switch (status) {
    case "first":
      return "1차 입찰";
    case "second":
      return "2차 제안";
    case "final":
      return "최종 입찰";
    case "active":
      return "활성";
    case "completed":
      return "완료";
    case "cancelled":
      return "낙찰 실패";
    default:
      return status;
  }
}

// 최근 활동 사용자 추출
function extractRecentUsers(liveBids, directBids) {
  // 모든 입찰 병합
  const allBids = [
    ...liveBids.map((bid) => ({
      userId: bid.user_id,
      bidType: "live",
      time: new Date(bid.created_at),
    })),
    ...directBids.map((bid) => ({
      userId: bid.user_id,
      bidType: "direct",
      time: new Date(bid.created_at),
    })),
  ];

  // 시간 순으로 정렬
  allBids.sort((a, b) => b.time - a.time);

  // 사용자 ID별 그룹화 (중복 제거)
  const uniqueUsers = {};
  allBids.forEach((bid) => {
    if (!uniqueUsers[bid.userId]) {
      uniqueUsers[bid.userId] = {
        userId: bid.userId,
        lastActivity: bid.time,
        bidType: bid.bidType,
      };
    }
  });

  // 배열로 변환하여 최신 활동순으로 정렬
  return Object.values(uniqueUsers)
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .slice(0, 5); // 상위 5명만 표시
}

// 활동 사용자 업데이트
function updateActiveUsers(users) {
  const usersContainer = document.getElementById("activeUsersList");

  if (users.length === 0) {
    usersContainer.innerHTML =
      '<div class="no-data">최근 활동 사용자가 없습니다.</div>';
    return;
  }

  let html = "";

  users.forEach((user) => {
    const lastActivity = formatDate(user.lastActivity);
    const bidTypeText = user.bidType === "live" ? "현장 경매" : "직접 경매";

    html += `
      <div class="active-user">
        <div class="user-id">${user.userId}</div>
        <div class="activity-stats">
          <span>마지막 활동: ${lastActivity}</span>
          <span>활동 유형: ${bidTypeText}</span>
        </div>
      </div>
    `;
  });

  usersContainer.innerHTML = html;
}

// 통화 포맷팅 함수 (JPY 지원)
function formatCurrency(amount, currency = "KRW") {
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
