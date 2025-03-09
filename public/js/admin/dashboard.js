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
  document.getElementById("activeUsers").textContent = stats.activeUsers || 0;
  document.getElementById("dailyUsers").textContent = stats.dailyUsers || 0;
  document.getElementById("totalRequests").textContent =
    stats.totalRequests || 0;
}
