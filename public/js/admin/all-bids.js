// public/js/admin/all-bids.js

class UnifiedAuctionManager {
  constructor() {
    this.liveData = [];
    this.directData = [];
    this.currentFilter = "all";
    this.currentResultType = "all";
    this.searchTimeout = null;
    this.highValueThreshold = 100000; // 10만엔 이상을 고액으로 설정
  }

  // 초기화
  async init() {
    this.setupEventListeners();
    await this.loadInitialData();
  }

  // 이벤트 리스너 설정
  setupEventListeners() {
    // 통합 검색
    document
      .getElementById("unifiedSearchInput")
      .addEventListener("input", () => {
        this.handleSearchInput();
      });
    document
      .getElementById("unifiedSearchBtn")
      .addEventListener("click", () => {
        this.executeUnifiedSearch();
      });
    document
      .getElementById("clearUnifiedSearchBtn")
      .addEventListener("click", () => {
        this.clearSearch();
      });

    // 결과 탭
    document.querySelectorAll(".result-tab").forEach((tab) => {
      tab.addEventListener("click", (e) => {
        this.switchResultTab(e.target.dataset.type);
      });
    });

    // 더보기 버튼
    document.getElementById("loadMoreBtn").addEventListener("click", () => {
      this.loadMoreResults();
    });

    // 모달 닫기
    document.querySelectorAll(".close-modal").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.closeModal();
      });
    });
  }

  // 초기 데이터 로드
  async loadInitialData() {
    try {
      await this.loadDashboardData();
      await this.loadDefaultResults();
    } catch (error) {
      console.error("초기 데이터 로드 실패:", error);
      this.showError("데이터를 불러오는 중 오류가 발생했습니다.");
    }
  }

  // 대시보드 데이터 로드
  async loadDashboardData() {
    try {
      const [liveData, directData] = await Promise.all([
        fetchLiveBids("", 1, 0), // 전체 조회
        fetchDirectBids("", false, 1, 0), // 전체 조회
      ]);

      this.updateStatusCards(liveData, directData);
      await this.updateUrgentItems();
      this.updateQuickActionCounts();
    } catch (error) {
      console.error("대시보드 데이터 로드 실패:", error);
    }
  }

  // 상태 카드 업데이트
  updateStatusCards(liveData, directData) {
    // 현장 경매 상태 집계
    const liveStats = this.calculateStats(liveData.bids, "live");
    document.getElementById("liveActiveCount").textContent = liveStats.active;
    document.getElementById("liveCompletedCount").textContent =
      liveStats.completed;
    document.getElementById("liveCancelledCount").textContent =
      liveStats.cancelled;

    // 직접 경매 상태 집계
    const directStats = this.calculateStats(directData.bids, "direct");
    document.getElementById("directActiveCount").textContent =
      directStats.active;
    document.getElementById("directCompletedCount").textContent =
      directStats.completed;
    document.getElementById("directCancelledCount").textContent =
      directStats.cancelled;
  }

  // 상태 집계 계산
  calculateStats(bids, type) {
    if (!bids || !Array.isArray(bids)) {
      return { active: 0, completed: 0, cancelled: 0 };
    }

    const stats = { active: 0, completed: 0, cancelled: 0 };

    bids.forEach((bid) => {
      if (type === "live") {
        // 현장 경매: first, second, final을 active로 분류
        if (["first", "second", "final"].includes(bid.status)) {
          stats.active++;
        } else if (bid.status === "completed") {
          stats.completed++;
        } else if (bid.status === "cancelled") {
          stats.cancelled++;
        }
      } else {
        // 직접 경매: active, completed, cancelled 그대로
        if (bid.status === "active") {
          stats.active++;
        } else if (bid.status === "completed") {
          stats.completed++;
        } else if (bid.status === "cancelled") {
          stats.cancelled++;
        }
      }
    });

    return stats;
  }

  // 긴급 항목 업데이트
  async updateUrgentItems() {
    await this.updateTodayDeadlines();
    await this.updateUnsubmittedItems();
  }

  // 오늘 마감 예정 업데이트
  async updateTodayDeadlines() {
    try {
      const today = new Date().toISOString().split("T")[0];

      const [liveToday, directToday] = await Promise.all([
        fetchLiveBids(
          "",
          1,
          20,
          "original_scheduled_date",
          "asc",
          today,
          today
        ),
        fetchDirectBids(
          "active",
          false,
          1,
          20,
          "original_scheduled_date",
          "asc",
          today,
          today
        ),
      ]);

      const totalCount =
        (liveToday.bids?.length || 0) + (directToday.bids?.length || 0);
      document.getElementById("todayDeadlineCount").textContent = totalCount;
      document.getElementById("quickTodayCount").textContent = totalCount;

      this.renderUrgentList(
        "todayDeadlineList",
        [...(liveToday.bids || []), ...(directToday.bids || [])],
        "deadline"
      );
    } catch (error) {
      console.error("오늘 마감 데이터 로드 실패:", error);
      document.getElementById("todayDeadlineList").innerHTML =
        '<div class="error">데이터 로드 실패</div>';
    }
  }

  // 플랫폼 미반영 업데이트
  async updateUnsubmittedItems() {
    try {
      const directCompleted = await fetchDirectBids(
        "completed",
        false,
        1,
        50,
        "updated_at",
        "desc"
      );
      const unsubmitted =
        directCompleted.bids?.filter((bid) => !bid.submitted_to_platform) || [];

      document.getElementById("unsubmittedCount").textContent =
        unsubmitted.length;
      document.getElementById("quickUnsubmittedCount").textContent =
        unsubmitted.length;

      this.renderUrgentList(
        "unsubmittedList",
        unsubmitted.slice(0, 5),
        "unsubmitted"
      );
    } catch (error) {
      console.error("미반영 데이터 로드 실패:", error);
      document.getElementById("unsubmittedList").innerHTML =
        '<div class="error">데이터 로드 실패</div>';
    }
  }

  // 긴급 리스트 렌더링
  renderUrgentList(containerId, items, type) {
    const container = document.getElementById(containerId);

    if (!items || items.length === 0) {
      container.innerHTML = '<div class="no-items">항목이 없습니다</div>';
      return;
    }

    const html = items
      .slice(0, 5)
      .map((item) => {
        const timeInfo =
          type === "deadline"
            ? this.calculateTimeRemaining(item.item?.original_scheduled_date)
            : this.calculateTimeSince(item.updated_at);

        return `
        <div class="urgent-item">
          <div class="urgent-item-info">
            <span class="urgent-item-id">${item.item_id}</span>
            <span class="urgent-item-title">${
              item.item?.original_title || "-"
            }</span>
          </div>
          <div class="urgent-item-time ${timeInfo.className}">${
          timeInfo.text
        }</div>
        </div>
      `;
      })
      .join("");

    container.innerHTML = html;
  }

  // 남은 시간 계산
  calculateTimeRemaining(scheduledDate) {
    if (!scheduledDate) return { text: "-", className: "" };

    const now = new Date();
    const deadline = new Date(scheduledDate);
    const diff = deadline - now;

    if (diff <= 0) {
      return { text: "마감됨", className: "expired" };
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours < 1) {
      return { text: `${minutes}분 남음`, className: "urgent" };
    } else if (hours < 6) {
      return { text: `${hours}시간 ${minutes}분 남음`, className: "warning" };
    } else {
      return { text: `${hours}시간 남음`, className: "" };
    }
  }

  // 경과 시간 계산
  calculateTimeSince(date) {
    if (!date) return { text: "-", className: "" };

    const now = new Date();
    const past = new Date(date);
    const diff = now - past;

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days > 0) {
      return { text: `${days}일 전`, className: days > 3 ? "warning" : "" };
    } else if (hours > 0) {
      return { text: `${hours}시간 전`, className: "" };
    } else {
      return { text: "방금 전", className: "" };
    }
  }

  // 빠른 작업 카운트 업데이트
  updateQuickActionCounts() {
    // 2차 제안 대기 카운트는 별도로 계산 필요
    this.updateSecondProposalCount();
    this.updateHighValueCount();
  }

  // 2차 제안 대기 카운트 업데이트
  async updateSecondProposalCount() {
    try {
      const liveSecond = await fetchLiveBids("first", 1, 0);
      document.getElementById("quickSecondCount").textContent =
        liveSecond.total || 0;
    } catch (error) {
      console.error("2차 제안 카운트 로드 실패:", error);
    }
  }

  // 고액 입찰 카운트 업데이트
  async updateHighValueCount() {
    try {
      // 이 부분은 실제 구현 시 가격 조건을 추가해야 함
      document.getElementById("quickHighValueCount").textContent = "0";
    } catch (error) {
      console.error("고액 입찰 카운트 로드 실패:", error);
    }
  }

  // 기본 결과 로드 (최근 업데이트된 항목들)
  async loadDefaultResults() {
    try {
      const [liveRecent, directRecent] = await Promise.all([
        fetchLiveBids("", 1, 25, "updated_at", "desc"),
        fetchDirectBids("", false, 1, 25, "updated_at", "desc"),
      ]);

      this.liveData = liveRecent.bids || [];
      this.directData = directRecent.bids || [];

      this.renderUnifiedResults();
    } catch (error) {
      console.error("기본 결과 로드 실패:", error);
      this.showError("결과를 불러오는 중 오류가 발생했습니다.");
    }
  }

  // 검색 입력 처리 (디바운스)
  handleSearchInput() {
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      this.executeUnifiedSearch();
    }, 300);
  }

  // 통합 검색 실행
  async executeUnifiedSearch() {
    const searchTerm = document
      .getElementById("unifiedSearchInput")
      .value.trim();

    if (!searchTerm) {
      await this.loadDefaultResults();
      return;
    }

    try {
      this.showLoading();

      const [liveResults, directResults] = await Promise.all([
        fetchLiveBids("", 1, 50, "updated_at", "desc", "", "", searchTerm),
        fetchDirectBids(
          "",
          false,
          1,
          50,
          "updated_at",
          "desc",
          "",
          "",
          searchTerm
        ),
      ]);

      this.liveData = liveResults.bids || [];
      this.directData = directResults.bids || [];
      this.currentFilter = "search";

      this.renderUnifiedResults();
    } catch (error) {
      console.error("검색 실패:", error);
      this.showError("검색 중 오류가 발생했습니다.");
    }
  }

  // 검색 초기화
  clearSearch() {
    document.getElementById("unifiedSearchInput").value = "";
    this.loadDefaultResults();
  }

  // 빠른 작업 함수들
  async showTodayDeadlines() {
    try {
      this.showLoading();
      const today = new Date().toISOString().split("T")[0];

      const [liveToday, directToday] = await Promise.all([
        fetchLiveBids(
          "",
          1,
          100,
          "original_scheduled_date",
          "asc",
          today,
          today
        ),
        fetchDirectBids(
          "active",
          false,
          1,
          100,
          "original_scheduled_date",
          "asc",
          today,
          today
        ),
      ]);

      this.liveData = liveToday.bids || [];
      this.directData = directToday.bids || [];
      this.currentFilter = "today-deadlines";

      this.renderUnifiedResults();
    } catch (error) {
      console.error("오늘 마감 조회 실패:", error);
      this.showError("오늘 마감 예정 항목을 불러오는 중 오류가 발생했습니다.");
    }
  }

  async showUnsubmitted() {
    try {
      this.showLoading();
      const directCompleted = await fetchDirectBids(
        "completed",
        false,
        1,
        100,
        "original_scheduled_date",
        "asc"
      );
      const unsubmitted =
        directCompleted.bids?.filter((bid) => !bid.submitted_to_platform) || [];

      this.liveData = [];
      this.directData = unsubmitted;
      this.currentFilter = "unsubmitted";

      this.renderUnifiedResults();
    } catch (error) {
      console.error("미반영 조회 실패:", error);
      this.showError("플랫폼 미반영 항목을 불러오는 중 오류가 발생했습니다.");
    }
  }

  async showSecondProposals() {
    try {
      this.showLoading();
      const liveSecond = await fetchLiveBids(
        "first",
        1,
        100,
        "updated_at",
        "desc"
      );

      this.liveData = liveSecond.bids || [];
      this.directData = [];
      this.currentFilter = "second-proposals";

      this.renderUnifiedResults();
    } catch (error) {
      console.error("2차 제안 조회 실패:", error);
      this.showError("2차 제안 대기 항목을 불러오는 중 오류가 발생했습니다.");
    }
  }

  async showHighValue() {
    try {
      this.showLoading();
      // 모든 활성 입찰을 가져와서 프론트엔드에서 필터링
      const [liveActive, directActive] = await Promise.all([
        fetchLiveBids("first,second,final", 1, 200, "updated_at", "desc"),
        fetchDirectBids("active", false, 1, 200, "updated_at", "desc"),
      ]);

      // 고액 입찰 필터링
      this.liveData = (liveActive.bids || []).filter((bid) => {
        const price =
          bid.final_price || bid.second_price || bid.first_price || 0;
        return price >= this.highValueThreshold;
      });

      this.directData = (directActive.bids || []).filter((bid) => {
        return (bid.current_price || 0) >= this.highValueThreshold;
      });

      this.currentFilter = "high-value";
      this.renderUnifiedResults();
    } catch (error) {
      console.error("고액 입찰 조회 실패:", error);
      this.showError("고액 입찰 항목을 불러오는 중 오류가 발생했습니다.");
    }
  }

  async showCompleted() {
    try {
      this.showLoading();
      const [liveCompleted, directCompleted] = await Promise.all([
        fetchLiveBids("completed", 1, 100, "updated_at", "desc"),
        fetchDirectBids("completed", false, 1, 100, "updated_at", "desc"),
      ]);

      this.liveData = liveCompleted.bids || [];
      this.directData = directCompleted.bids || [];
      this.currentFilter = "completed";

      this.renderUnifiedResults();
    } catch (error) {
      console.error("완료 항목 조회 실패:", error);
      this.showError("완료 항목을 불러오는 중 오류가 발생했습니다.");
    }
  }

  resetFilters() {
    this.currentFilter = "all";
    this.loadDefaultResults();
  }

  // 결과 탭 전환
  switchResultTab(type) {
    this.currentResultType = type;

    // 탭 활성화 상태 변경
    document.querySelectorAll(".result-tab").forEach((tab) => {
      tab.classList.remove("active");
    });
    document.querySelector(`[data-type="${type}"]`).classList.add("active");

    this.renderUnifiedResults();
  }

  // 통합 결과 렌더링
  renderUnifiedResults() {
    const tbody = document.getElementById("unifiedResults");
    let liveToShow = this.liveData || [];
    let directToShow = this.directData || [];

    // 결과 탭에 따라 필터링
    if (this.currentResultType === "live") {
      directToShow = [];
    } else if (this.currentResultType === "direct") {
      liveToShow = [];
    }

    let html = "";

    // 현장 경매 렌더링
    liveToShow.forEach((bid) => {
      html += this.renderLiveBidRow(bid);
    });

    // 직접 경매 렌더링
    directToShow.forEach((bid) => {
      html += this.renderDirectBidRow(bid);
    });

    if (html === "") {
      html =
        '<tr><td colspan="7" class="text-center">결과가 없습니다.</td></tr>';
    }

    tbody.innerHTML = html;
    this.updateResultCounts();
  }

  // 현장 경매 행 렌더링
  renderLiveBidRow(bid) {
    const timeInfo = this.calculateTimeRemaining(
      bid.item?.original_scheduled_date
    );

    return `
      <tr class="live-bid-row" data-bid-type="live" data-bid-id="${bid.id}">
        <td><span class="badge badge-info">현장</span></td>
        <td>${this.renderItemInfo(bid)}</td>
        <td>${bid.user_id}</td>
        <td>${this.renderLiveBidPrices(bid)}</td>
        <td>${this.renderLiveStatus(bid)}</td>
        <td>
          <div class="date-info">
            <div>${this.formatScheduledDate(
              bid.item?.original_scheduled_date
            )}</div>
            <div class="time-remaining ${timeInfo.className}">${
      timeInfo.text
    }</div>
          </div>
        </td>
        <td>${this.renderLiveActions(bid)}</td>
      </tr>
    `;
  }

  // 직접 경매 행 렌더링
  renderDirectBidRow(bid) {
    return `
      <tr class="direct-bid-row" data-bid-type="direct" data-bid-id="${bid.id}">
        <td><span class="badge badge-success">직접</span></td>
        <td>${this.renderItemInfo(bid)}</td>
        <td>${bid.user_id}</td>
        <td>${this.renderDirectBidPrices(bid)}</td>
        <td>${this.renderDirectStatus(bid)}</td>
        <td>
          <div class="date-info">
            <div>${formatDate(bid.updated_at)}</div>
          </div>
        </td>
        <td>${this.renderDirectActions(bid)}</td>
      </tr>
    `;
  }

  // 상품 정보 렌더링
  renderItemInfo(bid) {
    const imageUrl = bid.item?.image || "/images/no-image.png";
    const itemUrl = this.getItemUrl(bid);

    return `
      <div class="item-info">
        <img src="${imageUrl}" alt="${
      bid.item?.original_title || ""
    }" class="item-thumbnail" />
        <div class="item-details">
          <div class="item-id">
            <a href="${itemUrl}" target="_blank">${bid.item_id}</a>
          </div>
          <div class="item-title">${bid.item?.original_title || "-"}</div>
          <div class="item-meta">
            <span>브랜드: ${bid.item?.brand || "-"}</span>
            <span>등급: ${bid.item?.rank || "-"}</span>
          </div>
        </div>
      </div>
    `;
  }

  // 상품 URL 생성
  getItemUrl(bid) {
    const linkFunc = {
      1: (itemId) =>
        `https://www.ecoauc.com/client/auction-items/view/${itemId}`,
      2: (itemId) =>
        `https://bid.brand-auc.com/items/detail?uketsukeBng=${itemId}`,
      3: (itemId) => `https://www.starbuyers-global-auction.com/item/${itemId}`,
    };

    if (bid.item?.auc_num && linkFunc[bid.item.auc_num]) {
      return linkFunc[bid.item.auc_num](bid.item_id);
    }
    return "#";
  }

  // 현장 경매 가격 렌더링
  renderLiveBidPrices(bid) {
    let html = '<div class="bid-prices">';

    if (bid.first_price) {
      html += `<div class="price-item">1차: ${formatCurrency(
        bid.first_price,
        "JPY"
      )}</div>`;
    }
    if (bid.second_price) {
      html += `<div class="price-item">2차: ${formatCurrency(
        bid.second_price,
        "JPY"
      )}</div>`;
    }
    if (bid.final_price) {
      html += `<div class="price-item">최종: ${formatCurrency(
        bid.final_price,
        "JPY"
      )}</div>`;
    }
    if (bid.winning_price) {
      html += `<div class="price-item winning">낙찰: ${formatCurrency(
        bid.winning_price,
        "JPY"
      )}</div>`;
    }

    html += "</div>";
    return html;
  }

  // 직접 경매 가격 렌더링
  renderDirectBidPrices(bid) {
    let html = '<div class="bid-prices">';

    if (bid.current_price) {
      html += `<div class="price-item">입찰: ${formatCurrency(
        bid.current_price,
        "JPY"
      )}</div>`;

      // 수수료 포함 가격 계산
      if (bid.item?.auc_num && bid.item?.category) {
        const totalPrice = calculateTotalPrice(
          bid.current_price,
          bid.item.auc_num,
          bid.item.category
        );
        html += `<div class="price-item total">총액: ${formatCurrency(
          totalPrice,
          "KRW"
        )}</div>`;
      }
    }

    if (bid.winning_price) {
      html += `<div class="price-item winning">낙찰: ${formatCurrency(
        bid.winning_price,
        "JPY"
      )}</div>`;
    }

    // 플랫폼 반영 상태
    const submittedBadge = bid.submitted_to_platform
      ? '<span class="badge badge-success">반영됨</span>'
      : '<span class="badge badge-warning">미반영</span>';
    html += `<div class="platform-status">${submittedBadge}</div>`;

    html += "</div>";
    return html;
  }

  // 현장 경매 상태 렌더링
  renderLiveStatus(bid) {
    const statusMap = {
      first: { text: "1차 입찰", className: "badge-info" },
      second: { text: "2차 제안", className: "badge-warning" },
      final: { text: "최종 입찰", className: "badge-danger" },
      completed: { text: "완료", className: "badge-success" },
      cancelled: { text: "낙찰 실패", className: "badge-secondary" },
    };

    const status = statusMap[bid.status] || {
      text: bid.status,
      className: "badge",
    };
    return `<span class="badge ${status.className}">${status.text}</span>`;
  }

  // 직접 경매 상태 렌더링
  renderDirectStatus(bid) {
    const statusMap = {
      active: { text: "활성", className: "badge-info" },
      completed: { text: "완료", className: "badge-success" },
      cancelled: { text: "낙찰 실패", className: "badge-secondary" },
    };

    const status = statusMap[bid.status] || {
      text: bid.status,
      className: "badge",
    };
    return `<span class="badge ${status.className}">${status.text}</span>`;
  }

  // 현장 경매 작업 버튼 렌더링
  renderLiveActions(bid) {
    let html = '<div class="quick-actions-cell">';

    if (bid.status === "first") {
      html += `<button class="btn btn-sm" onclick="unifiedManager.quickAction('propose-second', ${bid.id})">2차 제안</button>`;
    } else if (bid.status === "final") {
      html += `<button class="btn btn-sm" onclick="unifiedManager.quickAction('complete-live', ${bid.id})">낙찰 완료</button>`;
      html += `<button class="btn btn-sm btn-secondary" onclick="unifiedManager.quickAction('cancel-live', ${bid.id})">낙찰 실패</button>`;
    }

    html += `<button class="btn btn-sm btn-outline" onclick="unifiedManager.goToDetailPage('live', ${bid.id})">상세 관리</button>`;
    html += "</div>";

    return html;
  }

  // 직접 경매 작업 버튼 렌더링
  renderDirectActions(bid) {
    let html = '<div class="quick-actions-cell">';

    if (bid.status === "active") {
      html += `<button class="btn btn-sm" onclick="unifiedManager.quickAction('complete-direct', ${bid.id})">낙찰 완료</button>`;
      html += `<button class="btn btn-sm btn-secondary" onclick="unifiedManager.quickAction('cancel-direct', ${bid.id})">낙찰 실패</button>`;
    }

    if (!bid.submitted_to_platform && bid.status === "completed") {
      html += `<button class="btn btn-sm btn-warning" onclick="unifiedManager.quickAction('mark-submitted', ${bid.id})">반영 표시</button>`;
    }

    html += `<button class="btn btn-sm btn-outline" onclick="unifiedManager.goToDetailPage('direct', ${bid.id})">상세 관리</button>`;
    html += "</div>";

    return html;
  }

  // 빠른 작업 실행
  quickAction(action, bidId) {
    // 실제 구현에서는 각 작업에 맞는 확인 모달을 띄우고 처리
    console.log(`Quick action: ${action} for bid ${bidId}`);

    // 간단한 확인 후 해당 관리 페이지로 이동하도록 구현
    this.showQuickActionModal(action, bidId);
  }

  // 빠른 작업 모달 표시
  showQuickActionModal(action, bidId) {
    const actionNames = {
      "propose-second": "2차 제안가 제안",
      "complete-live": "현장 경매 낙찰 완료",
      "cancel-live": "현장 경매 낙찰 실패",
      "complete-direct": "직접 경매 낙찰 완료",
      "cancel-direct": "직접 경매 낙찰 실패",
      "mark-submitted": "플랫폼 반영 표시",
    };

    document.getElementById("quickActionTitle").textContent =
      actionNames[action] || "작업 확인";
    document.getElementById(
      "quickActionMessage"
    ).textContent = `${actionNames[action]}을 위해 상세 관리 페이지로 이동하시겠습니까?`;

    document.getElementById("confirmQuickAction").onclick = () => {
      this.closeModal();
      if (action.includes("live")) {
        this.goToDetailPage("live", bidId);
      } else {
        this.goToDetailPage("direct", bidId);
      }
    };

    this.openModal("quickActionModal");
  }

  // 상세 관리 페이지로 이동
  goToDetailPage(type, bidId) {
    if (type === "live") {
      window.location.href = `/admin/live-bids?highlight=${bidId}`;
    } else {
      window.location.href = `/admin/direct-bids?highlight=${bidId}`;
    }
  }

  // 결과 카운트 업데이트
  updateResultCounts() {
    const liveCount = this.liveData?.length || 0;
    const directCount = this.directData?.length || 0;
    const totalCount = liveCount + directCount;

    document.getElementById("allResultCount").textContent = totalCount;
    document.getElementById("liveResultCount").textContent = liveCount;
    document.getElementById("directResultCount").textContent = directCount;

    // 결과 정보 업데이트
    let filterText = "";
    switch (this.currentFilter) {
      case "search":
        filterText = "검색 결과";
        break;
      case "today-deadlines":
        filterText = "오늘 마감 예정";
        break;
      case "unsubmitted":
        filterText = "플랫폼 미반영";
        break;
      case "second-proposals":
        filterText = "2차 제안 대기";
        break;
      case "high-value":
        filterText = "고액 입찰";
        break;
      case "completed":
        filterText = "완료 항목";
        break;
      default:
        filterText = "전체 결과";
    }

    document.getElementById(
      "resultsCount"
    ).textContent = `${filterText}: 총 ${totalCount}건 (현장 ${liveCount}건, 직접 ${directCount}건)`;
  }

  // 날짜 포맷팅
  formatScheduledDate(dateString) {
    if (!dateString) return "-";

    const date = new Date(dateString);
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  // 더보기 기능 (향후 구현 시 사용)
  loadMoreResults() {
    // 현재는 구현하지 않음
    console.log("더보기 기능은 향후 구현 예정");
  }

  // 로딩 표시
  showLoading() {
    document.getElementById("unifiedResults").innerHTML =
      '<tr><td colspan="7" class="text-center">데이터를 불러오는 중입니다...</td></tr>';
  }

  // 에러 표시
  showError(message) {
    document.getElementById(
      "unifiedResults"
    ).innerHTML = `<tr><td colspan="7" class="text-center error">${message}</td></tr>`;
  }

  // 모달 열기
  openModal(modalId) {
    document.getElementById(modalId).classList.add("active");
  }

  // 모달 닫기
  closeModal() {
    document.querySelectorAll(".modal-overlay").forEach((modal) => {
      modal.classList.remove("active");
    });
  }
}

// 전역 변수로 매니저 인스턴스 생성
let unifiedManager;

// 페이지 로드 시 초기화
document.addEventListener("DOMContentLoaded", function () {
  unifiedManager = new UnifiedAuctionManager();
  unifiedManager.init();
});

// 전역 함수들 (HTML에서 직접 호출)
function showTodayDeadlines() {
  unifiedManager.showTodayDeadlines();
}

function showUnsubmitted() {
  unifiedManager.showUnsubmitted();
}

function showSecondProposals() {
  unifiedManager.showSecondProposals();
}

function showHighValue() {
  unifiedManager.showHighValue();
}

function showCompleted() {
  unifiedManager.showCompleted();
}

function resetFilters() {
  unifiedManager.resetFilters();
}
