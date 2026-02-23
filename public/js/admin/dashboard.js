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
    // CEO 요약 로드
    const executiveSummary = await fetchExecutiveSummary();
    updateExecutiveSummary(executiveSummary);
  } catch (error) {
    console.error("대시보드 데이터를 불러오는 중 오류가 발생했습니다:", error);
  }
}

function updateExecutiveSummary(summary) {
  if (!summary) return;
  document.getElementById("completedRevenueJpy").textContent = formatCurrency(
    Number(summary.yearRevenueKrw || 0),
    "KRW",
  );
  document.getElementById("monthlyRevenueJpy").textContent = formatCurrency(
    Number(summary.monthlyRevenueKrw || 0),
    "KRW",
  );
  const periodEl = document.getElementById("completedRevenuePeriod");
  if (periodEl)
    periodEl.textContent =
    summary.periodStart && summary.periodEnd
      ? `${summary.targetYear || 2026}년 기간: ${summary.periodStart} ~ ${summary.periodEnd} | 현장 ${(
          summary.sourceBreakdown?.live?.count || 0
        ).toLocaleString()}건, 직접 ${(
          summary.sourceBreakdown?.direct?.count || 0
        ).toLocaleString()}건`
      : "기준: 데이터 없음";

  const vipList = document.getElementById("vipTop5List");
  const vipTop = summary.vipTop10 || summary.vipTop5 || [];
  if (!vipTop || vipTop.length === 0) {
    vipList.innerHTML = '<div class="no-data">최근 30일 VIP 데이터가 없습니다.</div>';
  } else {
    vipList.innerHTML = vipTop
      .slice(0, 10)
      .map(
        (vip, idx) => `
        <div class="active-user">
          <div class="user-id">${idx + 1}. ${vip.company_name || "-"} (${vip.login_id || "-"})</div>
          <div class="activity-stats">
            <span>완료건수: ${(vip.completedCount || 0).toLocaleString()}건</span>
            <span>매출: ${formatCurrency(Number(vip.totalRevenueKrw || 0), "KRW")}</span>
          </div>
        </div>
      `,
      )
      .join("");
  }

  renderSixMonthRevenueChart(summary.sixMonthRevenue || []);
  renderPendingDomestic(summary.pendingDomestic || []);
}

function renderSixMonthRevenueChart(series) {
  const chart = document.getElementById("sixMonthRevenueChart");
  const note = document.getElementById("sixMonthRevenueNote");
  if (!chart || !note) return;

  const safeSeries = Array.isArray(series) ? series : [];
  if (!safeSeries.length) {
    note.textContent = "최근 6개월 데이터가 없습니다.";
    chart.innerHTML = '<div class="no-data">데이터 없음</div>';
    return;
  }

  const maxValue = Math.max(...safeSeries.map((m) => Number(m.revenueKrw || 0)), 1);
  const firstMonth = safeSeries[0]?.month || "-";
  const lastMonth = safeSeries[safeSeries.length - 1]?.month || "-";
  note.textContent = `${firstMonth} ~ ${lastMonth}`;

  chart.innerHTML = safeSeries
    .map((m) => {
      const revenue = Number(m.revenueKrw || 0);
      const ratio = Math.max(0.04, revenue / maxValue);
      const height = Math.round(ratio * 170);
      return `
        <div class="bar-item">
          <div class="bar" style="height:${height}px"></div>
          <div class="bar-label">${m.monthLabel || m.month || "-"}</div>
          <div class="bar-value">${formatCurrency(revenue, "KRW")}</div>
        </div>
      `;
    })
    .join("");
}

function renderSimpleUserList(elementId, users) {
  const container = document.getElementById(elementId);
  if (!users || users.length === 0) {
    container.innerHTML = '<div class="no-data">해당 회원이 없습니다.</div>';
    return;
  }

  container.innerHTML = users
    .map((u, idx) => {
      return `
      <div class="active-user">
        <div class="user-id">${idx + 1}. ${u.company_name || "-"} (${u.login_id || "-"})</div>
        <div class="activity-stats">
          <span>가입일: ${u.joined_at || "-"}</span>
        </div>
      </div>
    `;
    })
    .join("");
}

function renderPendingDomestic(items) {
  const noteNode = document.getElementById("pendingDomesticNote");
  const listNode = document.getElementById("pendingDomesticList");
  if (!noteNode || !listNode) return;

  const rows = Array.isArray(items) ? items : [];
  noteNode.textContent = `실시간 목록: ${rows.length.toLocaleString()}건`;

  if (!rows.length) {
    listNode.innerHTML = '<div class="no-data">국내도착 미반영 건이 없습니다.</div>';
    return;
  }

  listNode.innerHTML = `
    <table class="pending-table">
      <thead>
        <tr>
          <th>완료일</th>
          <th>경매장</th>
          <th>국내도착 미반영 물품수</th>
          <th>경과(영업일)</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (r) => `
            <tr>
              <td>${r.completedDate || "-"}</td>
              <td>경매${r.aucNum || "-"}</td>
              <td>${Number(r.itemCount || 0).toLocaleString()}건</td>
              <td><span class="pending-badge">${Number(r.businessDaysElapsed || 0)}일</span></td>
            </tr>
          `,
          )
          .join("")}
      </tbody>
    </table>
  `;
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
