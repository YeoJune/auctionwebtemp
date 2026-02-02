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
    // 요약 정보 로드
    const summary = await fetchDashboardSummary();
    updateSummaryCards(summary);

    // 최근 활동 로드
    const activities = await fetchRecentActivities();
    updateRecentActivities(activities);

    // 사용자 통계 로드
    const stats = await fetchUserStats();
    updateUserStats(stats);

    // 비즈니스 KPI 데이터 로드
    const kpiData = await fetchBusinessKPI();
    updateBusinessKPIs(
      kpiData.successRate,
      kpiData.avgBidPrice,
      kpiData.todayBids,
    );

    // 활성 경매 데이터 로드
    const auctions = await fetchActiveAuctions();
    updateActiveAuctions(auctions.liveAuctions, auctions.directAuctions);

    // 활성 사용자 데이터 로드
    const users = await fetchActiveUsers();
    updateActiveUsers(users);
  } catch (error) {
    console.error("대시보드 데이터를 불러오는 중 오류가 발생했습니다:", error);
  }
}

// 요약 카드 업데이트
function updateSummaryCards(summary) {
  // 현장 경매 요약
  document.getElementById("liveBidsFirst").textContent =
    summary.liveBids.first || 0;
  document.getElementById("liveBidsSecond").textContent =
    summary.liveBids.second || 0;
  document.getElementById("liveBidsFinal").textContent =
    summary.liveBids.final || 0;

  // 직접 경매 요약
  document.getElementById("directAuctionsScheduled").textContent =
    summary.directAuctions.scheduled || 0;
  document.getElementById("directAuctionsActive").textContent =
    summary.directAuctions.active || 0;
  document.getElementById("directAuctionsEnded").textContent =
    summary.directAuctions.ended || 0;

  // 인보이스 부분은 제외합니다
}

// 최근 활동 업데이트
function updateRecentActivities(activities) {
  const activitiesContainer = document.getElementById("recentActivities");

  if (!activities || activities.length === 0) {
    activitiesContainer.innerHTML =
      '<div class="activity-item">최근 활동이 없습니다.</div>';
    return;
  }

  let html = "";

  activities.forEach((activity) => {
    const time = formatDate(activity.time);

    // 활동 타입에 따른 아이콘/스타일 설정
    let activityClass = "";
    switch (activity.type) {
      case "bid":
        activityClass = "activity-bid";
        break;
      case "auction":
        activityClass = "activity-auction";
        break;
      case "invoice":
        activityClass = "activity-invoice";
        break;
      default:
        activityClass = "activity-default";
    }

    html += `
      <div class="activity-item ${activityClass}">
        <div class="activity-time">${time}</div>
        <div class="activity-content">${activity.content}</div>
      </div>
    `;
  });

  activitiesContainer.innerHTML = html;
}

// 사용자 통계 업데이트
function updateUserStats(stats) {
  document.getElementById("activeTotalUsers").textContent =
    stats.totalActiveUsers || 0;
  document.getElementById("dailyTotalUsers").textContent =
    stats.totalDailyUsers || 0;
  document.getElementById("totalRequests").textContent = stats.totalRequests
    ? window.formatNumber
      ? formatNumber(stats.totalRequests)
      : stats.totalRequests.toLocaleString()
    : 0;
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

// 활성 경매 업데이트
function updateActiveAuctions(liveAuctions, directAuctions) {
  const liveAuctionsContainer = document.getElementById("liveAuctions");
  const directAuctionsContainer = document.getElementById("directAuctions");

  // 현장 경매 표시
  if (!liveAuctions || liveAuctions.length === 0) {
    liveAuctionsContainer.innerHTML =
      '<div class="no-data">활성 현장 경매가 없습니다.</div>';
  } else {
    let liveHtml = "";
    liveAuctions.forEach((bid) => {
      const itemTitle = bid.original_title || "제목 없음";
      const bidPrice =
        bid.final_price || bid.second_price || bid.first_price || 0;
      const formattedPrice = formatCurrency(parseFloat(bidPrice), "JPY");

      // 이미지 경로 처리
      const imageUrl = bid.image || "/images/no-image.png";

      liveHtml += `
        <div class="auction-item">
          <div class="item-image">
            <img src="${imageUrl}" alt="${itemTitle}" class="item-thumbnail">
          </div>
          <div class="item-details">
            <div class="item-title">${itemTitle}</div>
            <div class="item-meta">
              <span class="price">${formattedPrice}</span>
              <span class="bid-status">${getBidStatusText(bid.status)}</span>
            </div>
            <div class="item-brand">${bid.brand || "-"}</div>
          </div>
        </div>
      `;
    });
    liveAuctionsContainer.innerHTML = liveHtml;
  }

  // 직접 경매 표시
  if (!directAuctions || directAuctions.length === 0) {
    directAuctionsContainer.innerHTML =
      '<div class="no-data">활성 직접 경매가 없습니다.</div>';
  } else {
    let directHtml = "";
    directAuctions.forEach((bid) => {
      const itemTitle = bid.original_title || "제목 없음";
      const bidPrice = bid.current_price || 0;
      const formattedPrice = formatCurrency(parseFloat(bidPrice), "JPY");

      // 이미지 경로 처리
      const imageUrl = bid.image || "/images/no-image.png";

      directHtml += `
        <div class="auction-item">
          <div class="item-image">
            <img src="${imageUrl}" alt="${itemTitle}" class="item-thumbnail">
          </div>
          <div class="item-details">
            <div class="item-title">${itemTitle}</div>
            <div class="item-meta">
              <span class="price">${formattedPrice}</span>
              <span class="bid-status">${getBidStatusText(bid.status)}</span>
            </div>
            <div class="item-brand">${bid.brand || "-"}</div>
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

// 활동 사용자 업데이트
function updateActiveUsers(users) {
  const usersContainer = document.getElementById("activeUsersList");

  if (!users || users.length === 0) {
    usersContainer.innerHTML =
      '<div class="no-data">최근 활동 사용자가 없습니다.</div>';
    return;
  }

  let html = "";

  users.forEach((user) => {
    const lastActivity = formatDate(user.last_activity);

    html += `
      <div class="active-user">
        <div class="user-id">${user.login_id || user.user_id}</div>
        <div class="activity-stats">
          <span>마지막 활동: ${lastActivity}</span>
          <span>활동 수: ${user.bid_count}회</span>
        </div>
      </div>
    `;
  });

  usersContainer.innerHTML = html;
}
