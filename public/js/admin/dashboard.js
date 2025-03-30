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
    const summary = await fetchDashboardSummary().catch(() => {
      // API가 아직 구현되지 않은 경우 샘플 데이터 사용
      return {
        liveBids: { first: 5, second: 3, final: 2 },
        directAuctions: { scheduled: 4, active: 2, ended: 10 },
        invoices: { pending: 5, processing: 3, completed: 8 },
      };
    });
    updateSummaryCards(summary);

    // 최근 활동 로드
    const activities = await fetchRecentActivities().catch(() => {
      // API가 아직 구현되지 않은 경우 샘플 데이터 사용
      return [
        { type: "bid", time: new Date(), content: "새 입찰이 등록되었습니다." },
        {
          type: "auction",
          time: new Date(Date.now() - 30 * 60000),
          content: "경매가 종료되었습니다.",
        },
        {
          type: "invoice",
          time: new Date(Date.now() - 120 * 60000),
          content: "새 인보이스가 생성되었습니다.",
        },
      ];
    });
    updateRecentActivities(activities);

    // 사용자 통계 로드
    const stats = await fetchUserStats().catch(() => {
      // API가 아직 구현되지 않은 경우 샘플 데이터 사용
      return { activeUsers: 12, dailyUsers: 45, totalRequests: 256 };
    });
    updateUserStats(stats);

    // 1. 비즈니스 핵심 지표 (KPI) 로드
    await loadBusinessKPIs();

    // 2. 진행 중인 경매 현황 로드
    await loadAuctionStatus();

    // 3. 사용자 분석 데이터 로드
    await loadUserAnalytics();
  } catch (error) {
    handleError(error, "대시보드 데이터를 불러오는 중 오류가 발생했습니다.");
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

  // 인보이스 요약
  document.getElementById("invoicesPending").textContent =
    summary.invoices.pending || 0;
  document.getElementById("invoicesProcessing").textContent =
    summary.invoices.processing || 0;
  document.getElementById("invoicesCompleted").textContent =
    summary.invoices.completed || 0;
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
  document.getElementById("activeUsers").textContent =
    stats.totalActiveUsers || stats.activeUsers || 0;
  document.getElementById("dailyUsers").textContent =
    stats.totalDailyUsers || stats.dailyUsers || 0;
  document.getElementById("totalRequests").textContent = stats.totalRequests
    ? stats.totalRequests.toLocaleString()
    : 0;
}

// 1. 비즈니스 핵심 지표 (KPI) 로드 및 업데이트
async function loadBusinessKPIs() {
  try {
    // 현장 경매 데이터 로드 (완료된 경매만 필터링)
    const liveBidsData = await fetchLiveBids(
      "completed",
      1,
      1000,
      "updated_at",
      "desc"
    );

    // 직접 경매 데이터 로드 (완료된 경매만 필터링)
    const directBidsData = await fetchDirectBids(
      "completed",
      true,
      1,
      1000,
      "updated_at",
      "desc"
    );

    // 오늘 날짜의 시작 시간 계산
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1.1 경매 성공률 계산
    const completedLiveBids = liveBidsData?.bids || [];
    const cancelledLiveBids = await fetchLiveBids(
      "cancelled",
      1,
      1000,
      "updated_at",
      "desc"
    );

    const completedDirectBids = directBidsData?.bids || [];
    const cancelledDirectBids = await fetchDirectBids(
      "cancelled",
      true,
      1,
      1000,
      "updated_at",
      "desc"
    );

    const totalCompleted =
      completedLiveBids.length + completedDirectBids.length;
    const totalCancelled =
      (cancelledLiveBids?.bids || []).length +
      (cancelledDirectBids?.bids || []).length;
    const totalBids = totalCompleted + totalCancelled;

    const successRate =
      totalBids > 0 ? ((totalCompleted / totalBids) * 100).toFixed(1) : 0;

    // 1.2 평균 낙찰가 계산
    let totalFinalPrice = 0;
    let finalPriceCount = 0;

    completedLiveBids.forEach((bid) => {
      if (bid.final_price) {
        totalFinalPrice += bid.final_price;
        finalPriceCount++;
      }
    });

    completedDirectBids.forEach((bid) => {
      if (bid.current_price) {
        totalFinalPrice += bid.current_price;
        finalPriceCount++;
      }
    });

    const avgFinalPrice =
      finalPriceCount > 0 ? Math.round(totalFinalPrice / finalPriceCount) : 0;

    // 1.3 오늘의 거래액 계산
    let todayTotalPrice = 0;

    completedLiveBids.forEach((bid) => {
      const bidDate = new Date(bid.updated_at);
      if (bidDate >= today && bid.final_price) {
        todayTotalPrice += bid.final_price;
      }
    });

    completedDirectBids.forEach((bid) => {
      const bidDate = new Date(bid.updated_at);
      if (bidDate >= today && bid.current_price) {
        todayTotalPrice += bid.current_price;
      }
    });

    // KPI 카드 업데이트
    updateBusinessKPIs(successRate, avgFinalPrice, todayTotalPrice);
  } catch (error) {
    console.error("비즈니스 KPI 로드 중 오류:", error);
    // 오류 발생 시에도 UI는 업데이트해야 함
    updateBusinessKPIs("--", "--", "--");
  }
}

// 비즈니스 KPI 데이터 업데이트
function updateBusinessKPIs(successRate, avgFinalPrice, todayTotalPrice) {
  // KPI 데이터를 화면에 표시
  document.getElementById("successRate").textContent =
    typeof successRate === "number" ? `${successRate}%` : successRate;
  document.getElementById("avgFinalPrice").textContent =
    typeof avgFinalPrice === "number"
      ? formatCurrency(avgFinalPrice, "JPY")
      : avgFinalPrice;
  document.getElementById("todayTotalPrice").textContent =
    typeof todayTotalPrice === "number"
      ? formatCurrency(todayTotalPrice, "JPY")
      : todayTotalPrice;
}

// 2. 진행 중인 경매 현황 로드 및 업데이트
async function loadAuctionStatus() {
  try {
    // 2.1 인기 경매 항목 (현재 활성화된 경매 중 가장 높은 입찰가를 가진 항목들)
    const activeLiveBids = await fetchLiveBids(
      "final",
      1,
      5,
      "final_price",
      "desc"
    );
    const activeDirectBids = await fetchDirectBids(
      "active",
      true,
      1,
      5,
      "current_price",
      "desc"
    );

    // 2.2 곧 마감되는 경매 (24시간 이내에 마감되는 경매)
    const now = new Date();
    const oneDayLater = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // 날짜 필터를 위한 포맷 YYYY-MM-DD
    const formattedNow = formatDateForAPI(now);
    const formattedOneDayLater = formatDateForAPI(oneDayLater);

    // 해당 기간에 예정된 경매 가져오기 (날짜 필터링이 API에서 지원된다고 가정)
    const upcomingAuctions = await fetchLiveBids(
      "",
      1,
      5,
      "scheduled_date",
      "asc",
      formattedNow,
      formattedOneDayLater
    ).catch(() => ({ bids: [] }));

    // 경매 현황 업데이트
    updatePopularAuctions(
      activeLiveBids?.bids || [],
      activeDirectBids?.bids || []
    );
    updateUpcomingAuctions(upcomingAuctions?.bids || []);
  } catch (error) {
    console.error("경매 현황 로드 중 오류:", error);
    // 오류 발생 시 기본 메시지 표시
    updatePopularAuctions([], []);
    updateUpcomingAuctions([]);
  }
}

// 인기 경매 항목 업데이트
function updatePopularAuctions(liveBids, directBids) {
  const popularAuctionsContainer = document.getElementById("popularAuctions");

  // 입찰가 기준으로 두 배열을 병합하고 상위 5개 추출
  const allBids = [
    ...liveBids.map((bid) => ({
      ...bid,
      bidType: "live",
      price: bid.final_price || bid.second_price || bid.first_price || 0,
    })),
    ...directBids.map((bid) => ({
      ...bid,
      bidType: "direct",
      price: bid.current_price || 0,
    })),
  ];

  // 가격 기준 내림차순 정렬
  allBids.sort((a, b) => b.price - a.price);

  // 상위 5개만 선택
  const topBids = allBids.slice(0, 5);

  if (topBids.length === 0) {
    popularAuctionsContainer.innerHTML =
      '<div class="no-data">현재 진행 중인 인기 경매가 없습니다.</div>';
    return;
  }

  let html = "";

  topBids.forEach((bid) => {
    const itemTitle = bid.item?.original_title || "제목 없음";
    const itemImage = bid.item?.image || "/images/no-image.png";
    const bidTypeText = bid.bidType === "live" ? "현장 경매" : "직접 경매";
    const bidTypeClass =
      bid.bidType === "live" ? "badge-info" : "badge-warning";
    const formattedPrice = formatCurrency(bid.price, "JPY");

    html += `
      <div class="auction-item">
        <div class="item-image"><img src="${itemImage}" alt="${itemTitle}"></div>
        <div class="item-details">
          <div class="item-title">${itemTitle}</div>
          <div class="item-meta">
            <span class="badge ${bidTypeClass}">${bidTypeText}</span>
            <span class="price">${formattedPrice}</span>
          </div>
        </div>
      </div>
    `;
  });

  popularAuctionsContainer.innerHTML = html;
}

// 곧 마감되는 경매 업데이트
function updateUpcomingAuctions(auctions) {
  const upcomingAuctionsContainer = document.getElementById("upcomingAuctions");

  if (auctions.length === 0) {
    upcomingAuctionsContainer.innerHTML =
      '<div class="no-data">24시간 이내에 마감되는 경매가 없습니다.</div>';
    return;
  }

  let html = "";

  auctions.forEach((auction) => {
    const itemTitle = auction.item?.original_title || "제목 없음";
    const scheduledDate =
      auction.item?.scheduled_date || auction.item?.original_scheduled_date;
    const formattedDate = scheduledDate
      ? formatDate(scheduledDate)
      : "날짜 미정";

    // 마감까지 남은 시간 계산
    let remainingTime = "시간 미정";
    if (scheduledDate) {
      const now = new Date();
      const auctionDate = new Date(scheduledDate);
      const diffMs = auctionDate - now;
      const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

      remainingTime = `${diffHrs}시간 ${diffMins}분 남음`;
    }

    html += `
      <div class="upcoming-auction">
        <div class="auction-title">${itemTitle}</div>
        <div class="auction-time">
          <div>예정 시간: ${formattedDate}</div>
          <div class="remaining-time">${remainingTime}</div>
        </div>
      </div>
    `;
  });

  upcomingAuctionsContainer.innerHTML = html;
}

// 3. 사용자 분석 데이터 로드 및 업데이트
async function loadUserAnalytics() {
  try {
    // 3.1 최근 활동 사용자 (최근 입찰을 한 사용자)
    const recentLiveBids = await fetchLiveBids("", 1, 10, "created_at", "desc");
    const recentDirectBids = await fetchDirectBids(
      "",
      false,
      1,
      10,
      "created_at",
      "desc"
    );

    // 최근 입찰을 기준으로 활동적인 사용자 추출
    const activeUsers = extractActiveUsers(
      recentLiveBids?.bids || [],
      recentDirectBids?.bids || []
    );

    // 3.2 사용자 활동 추이 (시간대별 활성 사용자 수)
    // 이 데이터는 현재 API에서 직접적으로 제공하지 않아 사용자 통계를 기반으로 표시
    const userStats = await fetchUserStats();

    // 사용자 분석 데이터 업데이트
    updateActiveUsers(activeUsers);
    updateUserActivityTrend(userStats);
  } catch (error) {
    console.error("사용자 분석 데이터 로드 중 오류:", error);
    // 오류 발생 시 기본 메시지 표시
    updateActiveUsers([]);
    updateUserActivityTrend({});
  }
}

// 활동적인 사용자 추출
function extractActiveUsers(liveBids, directBids) {
  // 모든 입찰 병합
  const allBids = [
    ...liveBids.map((bid) => ({
      userId: bid.user_id,
      bidType: "live",
      time: new Date(bid.created_at),
      status: bid.status,
    })),
    ...directBids.map((bid) => ({
      userId: bid.user_id,
      bidType: "direct",
      time: new Date(bid.created_at),
      status: bid.status,
    })),
  ];

  // 시간 순으로 정렬
  allBids.sort((a, b) => b.time - a.time);

  // 사용자 ID별 활동 집계
  const userActivities = {};

  allBids.forEach((bid) => {
    if (!userActivities[bid.userId]) {
      userActivities[bid.userId] = {
        userId: bid.userId,
        lastActivity: bid.time,
        bidCount: 0,
        liveBids: 0,
        directBids: 0,
        completedBids: 0,
      };
    }

    userActivities[bid.userId].bidCount++;

    if (bid.bidType === "live") {
      userActivities[bid.userId].liveBids++;
    } else {
      userActivities[bid.userId].directBids++;
    }

    if (bid.status === "completed") {
      userActivities[bid.userId].completedBids++;
    }
  });

  // 활동이 많은 순으로 정렬하여 배열로 변환
  return Object.values(userActivities)
    .sort((a, b) => b.bidCount - a.bidCount || b.lastActivity - a.lastActivity)
    .slice(0, 5); // 상위 5명만 반환
}

// 활동적인 사용자 업데이트
function updateActiveUsers(activeUsers) {
  const activeUsersContainer = document.getElementById("activeUsers");

  if (activeUsers.length === 0) {
    activeUsersContainer.innerHTML =
      '<div class="no-data">최근 활동 사용자가 없습니다.</div>';
    return;
  }

  let html = "";

  activeUsers.forEach((user) => {
    const lastActivityTime = formatDate(user.lastActivity);

    html += `
      <div class="active-user">
        <div class="user-id">${user.userId}</div>
        <div class="user-activity">
          <div class="activity-stats">
            <span>총 입찰: ${user.bidCount}회</span>
            <span>현장: ${user.liveBids}회</span>
            <span>직접: ${user.directBids}회</span>
            <span>완료: ${user.completedBids}회</span>
          </div>
          <div class="last-activity">마지막 활동: ${lastActivityTime}</div>
        </div>
      </div>
    `;
  });

  activeUsersContainer.innerHTML = html;
}

// 사용자 활동 추이 업데이트
function updateUserActivityTrend(stats) {
  const userActivityContainer = document.getElementById("userActivityTrend");

  // 현재 API에서 제공하는 제한된 데이터로 표시
  const activeMembers = stats.activeMemberUsers || 0;
  const activeGuests = stats.activeGuestUsers || 0;
  const dailyMembers = stats.dailyMemberUsers || 0;
  const dailyGuests = stats.dailyGuestUsers || 0;

  let html = `
    <div class="trend-card">
      <h4>실시간 접속자</h4>
      <div class="trend-data">
        <div class="trend-item">
          <span class="label">회원:</span>
          <span class="value">${activeMembers}</span>
        </div>
        <div class="trend-item">
          <span class="label">비회원:</span>
          <span class="value">${activeGuests}</span>
        </div>
      </div>
    </div>
    
    <div class="trend-card">
      <h4>오늘 방문자</h4>
      <div class="trend-data">
        <div class="trend-item">
          <span class="label">회원:</span>
          <span class="value">${dailyMembers}</span>
        </div>
        <div class="trend-item">
          <span class="label">비회원:</span>
          <span class="value">${dailyGuests}</span>
        </div>
      </div>
    </div>
  `;

  userActivityContainer.innerHTML = html;
}

// API용 날짜 포맷팅 (YYYY-MM-DD)
function formatDateForAPI(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 통화 포맷팅 함수 확장 (JPY 지원)
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
