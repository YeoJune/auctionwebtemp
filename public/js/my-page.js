// public/js/my-page.js

// 마이페이지 관리 클래스
class MyPageManager {
  constructor() {
    this.currentSection = "dashboard";
    this.userData = null;

    // 전환 상태 플래그
    this.isTransitioning = false;

    // bid-products.js와 완전히 동일한 상태 구조
    this.bidProductsState = {
      bidType: "live",
      status: "all",
      dateRange: 30,
      currentPage: 1,
      itemsPerPage: 10,
      sortBy: "updated_at",
      sortOrder: "desc",
      keyword: "",
      liveBids: [],
      directBids: [],
      combinedResults: [],
      filteredResults: [],
      totalItems: 0,
      totalPages: 0,
      isAuthenticated: false,
    };

    // ✨ bid-results.js와 동일한 상태 구조 (간소화)
    this.bidResultsState = {
      dateRange: 30,
      currentPage: 1,
      itemsPerPage: 7,
      sortBy: "date",
      sortOrder: "desc",
      dailyResults: [],
      totalItems: 0,
      totalPages: 0,
      isAuthenticated: false,
      isAdmin: false,
      totalStats: null,
    };

    // Core 모듈 참조
    this.bidProductsCore = window.BidProductsCore;
    this.bidResultsCore = window.BidResultsCore;
  }

  // 초기화
  async initialize() {
    try {
      // 인증 상태 확인
      const isAuth = await window.AuthManager.checkAuthStatus();
      if (!isAuth) {
        window.AuthManager.redirectToSignin();
        return;
      }

      this.bidProductsState.isAuthenticated = true;
      this.bidResultsState.isAuthenticated = true;
      this.bidResultsState.isAdmin = window.AuthManager.isAdmin();

      // 환율 및 수수료율 정보 로드
      await fetchExchangeRate();
      await fetchUserCommissionRate();

      // Core에 상태 전달
      this.bidProductsCore.setPageState(this.bidProductsState);
      this.bidResultsCore.setPageState(this.bidResultsState);

      // 기본 데이터 로드
      await Promise.all([
        this.loadUserData(),
        this.loadBidItemsData(true),
        this.loadBidResultsData(),
      ]);

      // 이벤트 리스너 설정
      this.setupEventListeners();

      // URL 해시에 따른 초기 섹션 표시
      const hash = window.location.hash.replace("#", "");
      const initialSection = [
        "dashboard",
        "bid-items",
        "bid-results",
        "account",
      ].includes(hash)
        ? hash
        : "dashboard";
      this.showSection(initialSection);

      // BidManager 초기화
      if (window.BidManager) {
        window.BidManager.initialize(
          true,
          this.bidProductsState.filteredResults.map((item) => item.item)
        );
      }

      // 입찰 이벤트 리스너 설정
      this.setupBidEventListeners();

      // 타이머 업데이트 시작
      if (window.BidManager) {
        window.BidManager.startTimerUpdates();
      }

      console.log("마이페이지 초기화 완료");
    } catch (error) {
      console.error("마이페이지 초기화 중 오류 발생:", error);
      alert("페이지를 불러오는 중 오류가 발생했습니다.");
    }
  }

  // 사용자 데이터 로드
  async loadUserData() {
    try {
      this.userData = await window.API.fetchAPI("/users/current");
      console.log("사용자 데이터 로드 완료:", this.userData.id);
    } catch (error) {
      console.error("사용자 데이터 로드 실패:", error);
      throw error;
    }
  }

  // 입찰 항목 데이터 로드
  async loadBidItemsData(forceLoadBoth = false) {
    try {
      let statusParam;
      switch (this.bidProductsState.status) {
        case "active":
          statusParam = this.bidProductsCore.STATUS_GROUPS.ACTIVE.join(",");
          break;
        case "higher-bid":
          statusParam = "cancelled";
          break;
        case "completed":
          statusParam = this.bidProductsCore.STATUS_GROUPS.COMPLETED.join(",");
          break;
        case "cancelled":
          statusParam = this.bidProductsCore.STATUS_GROUPS.ALL.join(",");
          break;
        case "all":
        default:
          statusParam = this.bidProductsCore.STATUS_GROUPS.ALL.join(",");
          break;
      }

      const dateLimit = new Date();
      dateLimit.setDate(dateLimit.getDate() - this.bidProductsState.dateRange);
      const fromDate = formatDate(dateLimit);

      const params = {
        status: statusParam,
        fromDate: fromDate,
        page: 1,
        limit: 0,
        sortBy: this.bidProductsState.sortBy,
        sortOrder: this.bidProductsState.sortOrder,
      };

      if (this.bidProductsState.keyword?.trim()) {
        params.keyword = this.bidProductsState.keyword.trim();
      }

      const queryString = window.API.createURLParams(params);

      if (forceLoadBoth) {
        const [liveResults, directResults] = await Promise.all([
          window.API.fetchAPI(`/live-bids?${queryString}`),
          window.API.fetchAPI(`/direct-bids?${queryString}`),
        ]);

        this.bidProductsState.liveBids = liveResults.bids || [];
        this.bidProductsState.directBids = directResults.bids || [];
      } else {
        if (this.bidProductsState.bidType === "direct") {
          const directResults = await window.API.fetchAPI(
            `/direct-bids?${queryString}`
          );
          this.bidProductsState.directBids = directResults.bids || [];
        } else {
          this.bidProductsState.bidType = "live";
          const liveRadio = document.getElementById("bidItems-bidType-live");
          if (liveRadio) liveRadio.checked = true;

          const liveResults = await window.API.fetchAPI(
            `/live-bids?${queryString}`
          );
          this.bidProductsState.liveBids = liveResults.bids || [];
        }
      }

      const liveBidsWithType = this.bidProductsState.liveBids
        .filter((bid) => bid.item && bid.item.item_id)
        .map((bid) => ({
          ...bid,
          type: "live",
          displayStatus: bid.status,
        }));

      const directBidsWithType = this.bidProductsState.directBids
        .filter((bid) => bid.item && bid.item.item_id)
        .map((bid) => ({
          ...bid,
          type: "direct",
          displayStatus: bid.status,
        }));

      this.bidProductsState.combinedResults = [
        ...liveBidsWithType,
        ...directBidsWithType,
      ];

      this.bidProductsCore.setPageState(this.bidProductsState);

      if (window.BidManager) {
        window.BidManager.updateBidData(
          this.bidProductsState.liveBids,
          this.bidProductsState.directBids
        );
      }
    } catch (error) {
      console.error("입찰 데이터를 가져오는 중 오류 발생:", error);
    }
  }

  // ✨ 입찰 결과 데이터 로드 (bid-results API 사용)
  async loadBidResultsData() {
    try {
      const params = {
        dateRange: this.bidResultsState.dateRange,
        sortBy: this.bidResultsState.sortBy,
        sortOrder: this.bidResultsState.sortOrder,
        page: this.bidResultsState.currentPage,
        limit: this.bidResultsState.itemsPerPage,
      };

      const queryString = window.API.createURLParams(params);

      // ✨ 통합 API 호출
      const response = await window.API.fetchAPI(`/bid-results?${queryString}`);

      // ✨ 백엔드에서 이미 처리된 데이터 받음
      this.bidResultsState.dailyResults = response.dailyResults;
      this.bidResultsState.totalStats = response.totalStats;
      this.bidResultsState.totalItems = response.pagination.totalItems;
      this.bidResultsState.totalPages = response.pagination.totalPages;
      this.bidResultsState.currentPage = response.pagination.currentPage;

      // Core에 상태 업데이트
      this.bidResultsCore.setPageState(this.bidResultsState);

      console.log(
        `입찰 결과 데이터 로드 완료: 총 ${this.bidResultsState.totalItems}건`
      );
    } catch (error) {
      console.error("입찰 결과 데이터 로드 실패:", error);
      this.bidResultsState.dailyResults = [];
      this.bidResultsState.totalItems = 0;
      this.bidResultsState.totalPages = 0;
    }
  }

  // 핵심: 입찰 항목 섹션으로 전환하는 단일 메서드
  async transitionToBidItems(bidType, status) {
    if (this.isTransitioning) {
      console.log("전환 중입니다. 대기해주세요.");
      return;
    }

    this.isTransitioning = true;

    try {
      console.log(`입찰 항목 전환: bidType=${bidType}, status=${status}`);

      this.bidProductsState.bidType = bidType;
      this.bidProductsState.status = status;
      this.bidProductsState.currentPage = 1;

      this._switchSectionUI("bid-items");

      await this.loadBidItemsData();

      this._renderBidItemsUI();

      console.log("입찰 항목 전환 완료");
    } catch (error) {
      console.error("입찰 항목 전환 실패:", error);
      alert("페이지 전환 중 오류가 발생했습니다.");
    } finally {
      this.isTransitioning = false;
    }
  }

  // UI 전환만 담당
  _switchSectionUI(sectionName) {
    document.querySelectorAll(".tab-button").forEach((btn) => {
      btn.classList.remove("active");
    });
    document
      .querySelector(`[data-section="${sectionName}"]`)
      ?.classList.add("active");

    document.querySelectorAll(".page-section").forEach((section) => {
      section.classList.remove("active");
    });
    document.getElementById(`${sectionName}-section`)?.classList.add("active");

    window.location.hash = sectionName;
    this.currentSection = sectionName;
  }

  // 섹션 전환
  async showSection(sectionName) {
    if (this.isTransitioning) {
      console.log("전환 중입니다. 대기해주세요.");
      return;
    }

    this.isTransitioning = true;

    try {
      console.log(`섹션 전환: ${sectionName}`);

      this._switchSectionUI(sectionName);

      switch (sectionName) {
        case "dashboard":
          await this.renderDashboard();
          break;
        case "bid-items":
          await this.loadBidItemsData();
          this._renderBidItemsUI();
          break;
        case "bid-results":
          await this.renderBidResultsSection();
          break;
        case "account":
          await this.renderAccountSection();
          break;
      }

      console.log(`섹션 전환 완료: ${sectionName}`);
    } catch (error) {
      console.error(`섹션 전환 실패 (${sectionName}):`, error);
      alert("페이지 전환 중 오류가 발생했습니다.");
    } finally {
      this.isTransitioning = false;
    }
  }

  // 대시보드 렌더링
  async renderDashboard() {
    console.log("대시보드 렌더링 시작");

    this.bidProductsState.bidType = "live";
    this.bidProductsState.status = "all";
    this.bidProductsState.currentPage = 1;

    await Promise.all([this.loadBidItemsData(true), this.loadBidResultsData()]);

    const stats = await this.calculateDashboardStats();

    document.getElementById("active-count").textContent = formatNumber(
      stats.activeCount
    );
    document.getElementById("higher-bid-count").textContent = formatNumber(
      stats.higherBidCount
    );
    document.getElementById("current-highest-count").textContent = formatNumber(
      stats.currentHighestCount
    );
    document.getElementById("completed-count").textContent = formatNumber(
      stats.completedCount
    );

    this.bidProductsCore.setPageState(this.bidProductsState);
    this.bidProductsCore.applyClientFilters();

    if (window.BidManager) {
      const items = this.bidProductsState.filteredResults
        .map((result) => result.item)
        .filter((item) => item && item.item_id);

      window.BidManager.updateCurrentData(items);
    }

    this.setupDashboardEvents();
    this.renderRecentBids();

    console.log("대시보드 렌더링 완료");
  }

  async calculateDashboardStats() {
    const allBids = this.bidProductsState.combinedResults;

    const activeCount = allBids.filter((bid) =>
      this.bidProductsCore.filterByStatusAndDeadline(bid, "active")
    ).length;

    const higherBidCount = allBids.filter(
      (bid) =>
        bid.type === "direct" &&
        this.bidProductsCore.filterByStatusAndDeadline(bid, "higher-bid")
    ).length;

    const currentHighestCount = allBids.filter(
      (bid) =>
        bid.type === "direct" &&
        bid.status === "active" &&
        !this.bidProductsCore.checkIfExpired(bid) &&
        bid.current_price > 0
    ).length;

    // ✨ dailyResults에서 성공 아이템 카운트
    const completedCount = this.bidResultsState.dailyResults.reduce(
      (total, day) => total + (day.itemCount || 0),
      0
    );

    return { activeCount, higherBidCount, currentHighestCount, completedCount };
  }

  // 최근 입찰 렌더링
  renderRecentBids() {
    const container = document.getElementById("recent-bids-list");

    // ✨ bidProducts와 bidResults 모두에서 최근 항목 추출
    const bidProductsRecent = this.bidProductsState.filteredResults.map(
      (bid) => ({
        ...bid,
        source: "products",
      })
    );

    const bidResultsRecent = this.bidResultsState.dailyResults
      .flatMap((day) => [...day.successItems, ...day.pendingItems])
      .map((bid) => ({
        ...bid,
        source: "results",
      }));

    const recentBids = [...bidProductsRecent, ...bidResultsRecent]
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
      .slice(0, 5);

    if (recentBids.length === 0) {
      container.innerHTML =
        '<div class="no-results">최근 입찰 내역이 없습니다.</div>';
      return;
    }

    container.innerHTML = recentBids
      .map((bid) => {
        const displayPrice = this.getDisplayPrice(bid);
        const statusText = this.getStatusText(bid);

        return `
        <div class="activity-item" style="cursor: pointer;" 
             onclick="myPageManager.showProductDetails('${bid.item?.item_id}')">
          <img src="${window.API.validateImageUrl(
            bid.item?.image
          )}" alt="상품 이미지" class="activity-image">
          <div class="activity-content">
            <div class="activity-title">${bid.item?.brand || "-"} - ${
          bid.item?.title || "제목 없음"
        }</div>
            <div class="activity-details">
              <span class="activity-type">${
                bid.type === "live" ? "현장경매" : "직접경매"
              }</span>
              <span class="activity-price">￥${formatNumber(
                displayPrice
              )}</span>
              <span class="activity-status ${this.getDashboardStatusClass(
                bid
              )}">${statusText}</span>
            </div>
            <div class="activity-date">${formatDateTime(bid.updated_at)}</div>
          </div>
        </div>
      `;
      })
      .join("");
  }

  // 상품 상세 정보 표시
  async showProductDetails(itemId) {
    await this.bidProductsCore.showProductDetails(itemId);
  }

  // 입찰 항목 UI 렌더링
  _renderBidItemsUI() {
    console.log("입찰 항목 UI 렌더링 시작");

    this.updateBidItemsUI();
    this.updateBidItemsStatusFilterUI();

    this.bidProductsCore.setPageState(this.bidProductsState);
    this.bidProductsCore.displayProducts("bidItems-productList");
    this.bidProductsCore.updatePagination(
      (page) => this.handleBidItemsPageChange(page),
      "bidItems-pagination"
    );
    this.bidProductsCore.updateSortButtonsUI();

    document.getElementById("bidItems-totalResults").textContent =
      this.bidProductsState.totalItems;
    document.getElementById("bidItems-loadingMsg").style.display = "none";

    if (window.BidManager) {
      const items = this.bidProductsState.filteredResults
        .map((result) => result.item)
        .filter((item) => item && item.item_id);

      window.BidManager.updateCurrentData(items);
      window.BidManager.startTimerUpdates();
      window.BidManager.initializePriceCalculators();
    }

    console.log("입찰 항목 UI 렌더링 완료");
  }

  // ✨ 입찰 결과 섹션 렌더링 (bid-results API 사용)
  async renderBidResultsSection() {
    try {
      // 데이터 로드
      await this.loadBidResultsData();

      // UI 상태 업데이트
      this.updateBidResultsUI();

      // Core를 사용하여 표시
      this.bidResultsCore.setPageState(this.bidResultsState);
      this.bidResultsCore.displayResults("bidResults-resultsList");

      // 페이지네이션
      createPagination(
        this.bidResultsState.currentPage,
        this.bidResultsState.totalPages,
        (page) => this.handleBidResultsPageChange(page),
        "bidResults-pagination"
      );

      // 결과 카운트 업데이트
      document.getElementById("bidResults-totalResults").textContent =
        this.bidResultsState.totalItems;
      document.getElementById("bidResults-loadingMsg").style.display = "none";

      // 관리자 통계 업데이트 (있는 경우)
      if (this.bidResultsState.totalStats) {
        this.updateTotalStatsUI();
      }
    } catch (error) {
      console.error("입찰 결과 렌더링 실패:", error);
      document.getElementById("bidResults-resultsList").innerHTML =
        '<div class="no-results">데이터를 불러오는 데 실패했습니다.</div>';
    }
  }

  // ✨ 통계 UI 업데이트
  updateTotalStatsUI() {
    if (!this.bidResultsState.totalStats) return;

    const stats = this.bidResultsState.totalStats;

    const updateElement = (id, value, suffix = "") => {
      const el = document.getElementById(id);
      if (el) el.textContent = formatNumber(value || 0) + suffix;
    };

    updateElement("totalItemCount", stats.itemCount);
    updateElement("totalJapaneseAmount", stats.japaneseAmount, " ¥");
    updateElement("totalKoreanAmount", stats.koreanAmount, " ₩");
    updateElement("totalFeeAmount", stats.feeAmount, " ₩");
    updateElement("totalVatAmount", stats.vatAmount, " ₩");
    updateElement("totalAppraisalFee", stats.appraisalFee, " ₩");
    updateElement("totalAppraisalVat", stats.appraisalVat, " ₩");
    updateElement("grandTotalAmount", stats.grandTotalAmount, " ₩");
  }

  // 입찰 항목 UI 상태 업데이트
  updateBidItemsUI() {
    document
      .querySelectorAll('input[name="bidItems-bidType"]')
      .forEach((radio) => {
        radio.checked = radio.value === this.bidProductsState.bidType;
      });

    document
      .querySelectorAll('input[name="bidItems-status"]')
      .forEach((radio) => {
        radio.checked = radio.value === this.bidProductsState.status;
      });

    const dateRange = document.getElementById("bidItems-dateRange");
    if (dateRange) dateRange.value = this.bidProductsState.dateRange;

    const sortButtons = document.querySelectorAll(
      "#bid-items-section .sort-btn"
    );
    sortButtons.forEach((btn) => {
      btn.classList.remove("active", "asc", "desc");
      if (btn.dataset.sort === this.bidProductsState.sortBy) {
        btn.classList.add("active", this.bidProductsState.sortOrder);
      }
    });
  }

  // 입찰 결과 UI 상태 업데이트
  updateBidResultsUI() {
    const dateRange = document.getElementById("bidResults-dateRange");
    if (dateRange) dateRange.value = this.bidResultsState.dateRange;

    const sortButtons = document.querySelectorAll(
      "#bid-results-section .sort-btn"
    );
    sortButtons.forEach((btn) => {
      btn.classList.remove("active", "asc", "desc");
      if (btn.dataset.sort === this.bidResultsState.sortBy) {
        btn.classList.add("active", this.bidResultsState.sortOrder);
      }
    });
  }

  // 표시 가격 계산
  getDisplayPrice(bid) {
    if (bid.type === "direct") {
      return bid.current_price || 0;
    } else {
      return bid.final_price || bid.second_price || bid.first_price || 0;
    }
  }

  // 상태 텍스트 반환
  getStatusText(bid) {
    const statusMap = {
      active: "입찰 가능",
      first: "1차 입찰",
      second: "2차 제안",
      final: "최종 입찰",
      completed: "낙찰 완료",
      shipped: "출고됨",
      cancelled: "더 높은 입찰 존재",
    };
    return statusMap[bid.status] || "알 수 없음";
  }

  // 대시보드용 상태 클래스 반환
  getDashboardStatusClass(bid) {
    const statusMap = {
      active: "active",
      first: "first",
      second: "second",
      final: "final",
      completed: "completed",
      shipped: "shipped",
      cancelled: "cancelled",
    };
    return statusMap[bid.status] || "unknown";
  }

  // 입찰 항목 페이지 변경
  async handleBidItemsPageChange(page) {
    if (this.currentSection !== "bid-items") return;

    page = parseInt(page, 10);

    if (
      page === this.bidProductsState.currentPage ||
      page < 1 ||
      page > this.bidProductsState.totalPages
    ) {
      return;
    }

    this.bidProductsState.currentPage = page;

    this.bidProductsCore.setPageState(this.bidProductsState);
    this.bidProductsCore.displayProducts("bidItems-productList");
    this.bidProductsCore.updatePagination(
      (page) => this.handleBidItemsPageChange(page),
      "bidItems-pagination"
    );

    window.scrollTo(0, 0);
  }

  // ✨ 입찰 결과 페이지 변경 (백엔드 재요청)
  async handleBidResultsPageChange(page) {
    if (this.currentSection !== "bid-results") return;

    page = parseInt(page, 10);

    if (
      page === this.bidResultsState.currentPage ||
      page < 1 ||
      page > this.bidResultsState.totalPages
    ) {
      return;
    }

    this.bidResultsState.currentPage = page;
    await this.renderBidResultsSection();
    window.scrollTo(0, 0);
  }

  // 계정 관리 섹션 렌더링
  async renderAccountSection() {
    const loadingEl = document.getElementById("account-loading");
    const contentEl = document.getElementById("account-content");

    try {
      loadingEl.style.display = "block";
      contentEl.classList.add("hidden");

      if (!this.userData) {
        await this.loadUserData();
      }

      this.populateAccountForm();

      loadingEl.style.display = "none";
      contentEl.classList.remove("hidden");
    } catch (error) {
      console.error("계정 정보 렌더링 실패:", error);
      loadingEl.innerHTML =
        '<div class="error-message">계정 정보를 불러오는데 실패했습니다.</div>';
    }
  }

  // 계정 폼에 데이터 채우기
  populateAccountForm() {
    const data = this.userData;

    document.getElementById("user-id").value = data.id || "";
    document.getElementById("user-email").value = data.email || "";
    document.getElementById("user-phone").value = data.phone || "";
    document.getElementById("registration-date").value = data.registration_date
      ? formatDate(data.registration_date)
      : "";

    document.getElementById("company-name").value = data.company_name || "";
    document.getElementById("business-number").value =
      data.business_number || "";
    document.getElementById("company-address").value = data.address || "";

    document.getElementById("commission-rate").textContent =
      data.commission_rate !== null
        ? `${data.commission_rate}%`
        : "기본 수수료율";

    const statusEl = document.getElementById("account-status");
    statusEl.textContent = data.is_active ? "활성" : "비활성";
    statusEl.className = `status-badge ${
      data.is_active ? "active" : "inactive"
    }`;

    document.getElementById("created-date").textContent = data.created_at
      ? formatDate(data.created_at)
      : "-";
  }

  // 이벤트 리스너 설정
  setupEventListeners() {
    document.querySelectorAll(".tab-button").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const section = e.currentTarget.getAttribute("data-section");
        this.showSection(section);
      });
    });

    this.setupDashboardEvents();
    this.setupBidItemsEvents();
    this.setupBidResultsEvents();
    this.setupAccountForms();

    console.log("이벤트 리스너 설정 완료");
  }

  // 대시보드 이벤트 설정
  setupDashboardEvents() {
    console.log("대시보드 이벤트 설정");

    const statCards = document.querySelectorAll(".stat-card");

    statCards[0]?.addEventListener("click", () => {
      this.transitionToBidItems("live", "active");
    });

    statCards[1]?.addEventListener("click", () => {
      this.transitionToBidItems("direct", "higher-bid");
    });

    statCards[2]?.addEventListener("click", () => {
      this.transitionToBidItems("direct", "active");
    });

    statCards[3]?.addEventListener("click", () => {
      if (!this.isTransitioning) {
        this.showSection("bid-results");
      }
    });
  }

  // 입찰 항목 이벤트 설정
  setupBidItemsEvents() {
    document
      .querySelectorAll('input[name="bidItems-bidType"]')
      .forEach((radio) => {
        radio.addEventListener("change", async (e) => {
          if (this.isTransitioning) return;
          this.isTransitioning = true;

          try {
            this.bidProductsState.bidType = e.target.value;
            this.bidProductsState.currentPage = 1;

            this.updateBidItemsStatusFilterUI();

            await this.loadBidItemsData();
            this._renderBidItemsUI();
          } finally {
            this.isTransitioning = false;
          }
        });
      });

    document
      .querySelectorAll('input[name="bidItems-status"]')
      .forEach((radio) => {
        radio.addEventListener("change", async (e) => {
          if (this.isTransitioning) return;
          this.isTransitioning = true;

          try {
            this.bidProductsState.status = e.target.value;
            this.bidProductsState.currentPage = 1;

            await this.loadBidItemsData();
            this._renderBidItemsUI();
          } finally {
            this.isTransitioning = false;
          }
        });
      });

    document
      .getElementById("bidItems-dateRange")
      ?.addEventListener("change", async (e) => {
        if (this.isTransitioning) return;
        this.isTransitioning = true;

        try {
          this.bidProductsState.dateRange = parseInt(e.target.value);
          this.bidProductsState.currentPage = 1;

          await this.loadBidItemsData();
          this._renderBidItemsUI();
        } finally {
          this.isTransitioning = false;
        }
      });

    const sortButtons = document.querySelectorAll(
      "#bid-items-section .sort-btn"
    );
    sortButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        this.handleBidItemsSortChange(btn.dataset.sort);
      });
    });

    document
      .getElementById("bidItems-applyFilters")
      ?.addEventListener("click", async () => {
        if (this.isTransitioning) return;
        this.isTransitioning = true;

        try {
          this.bidProductsState.currentPage = 1;
          await this.loadBidItemsData();
          this._renderBidItemsUI();
        } finally {
          this.isTransitioning = false;
        }
      });

    document
      .getElementById("bidItems-resetFilters")
      ?.addEventListener("click", () => {
        this.resetBidItemsFilters();
      });
  }

  // ✨ 입찰 결과 이벤트 설정 (백엔드 재요청)
  setupBidResultsEvents() {
    document
      .getElementById("bidResults-dateRange")
      ?.addEventListener("change", async (e) => {
        this.bidResultsState.dateRange = parseInt(e.target.value);
        this.bidResultsState.currentPage = 1;
        await this.renderBidResultsSection();
      });

    const sortButtons = document.querySelectorAll(
      "#bid-results-section .sort-btn"
    );
    sortButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        this.handleBidResultsSortChange(btn.dataset.sort);
      });
    });

    document
      .getElementById("bidResults-applyFilters")
      ?.addEventListener("click", async () => {
        this.bidResultsState.currentPage = 1;
        await this.renderBidResultsSection();
      });

    document
      .getElementById("bidResults-resetFilters")
      ?.addEventListener("click", () => {
        this.resetBidResultsFilters();
      });
  }

  // 입찰 항목 정렬 변경 처리
  async handleBidItemsSortChange(sortKey) {
    if (this.isTransitioning) return;
    this.isTransitioning = true;

    try {
      if (this.bidProductsState.sortBy === sortKey) {
        this.bidProductsState.sortOrder =
          this.bidProductsState.sortOrder === "desc" ? "asc" : "desc";
      } else {
        this.bidProductsState.sortBy = sortKey;
        this.bidProductsState.sortOrder = "desc";
      }

      this.bidProductsState.currentPage = 1;
      await this.loadBidItemsData();
      this._renderBidItemsUI();
    } finally {
      this.isTransitioning = false;
    }
  }

  // ✨ 입찰 결과 정렬 변경 처리 (백엔드 재요청)
  async handleBidResultsSortChange(sortKey) {
    if (this.bidResultsState.sortBy === sortKey) {
      this.bidResultsState.sortOrder =
        this.bidResultsState.sortOrder === "desc" ? "asc" : "desc";
    } else {
      this.bidResultsState.sortBy = sortKey;
      this.bidResultsState.sortOrder = "desc";
    }

    this.bidResultsState.currentPage = 1;
    await this.renderBidResultsSection();
  }

  // 입찰 항목 필터 초기화
  async resetBidItemsFilters() {
    if (this.isTransitioning) return;
    this.isTransitioning = true;

    try {
      this.bidProductsState.bidType = "live";
      this.bidProductsState.status = "all";
      this.bidProductsState.dateRange = 30;
      this.bidProductsState.keyword = "";
      this.bidProductsState.currentPage = 1;
      this.bidProductsState.sortBy = "updated_at";
      this.bidProductsState.sortOrder = "desc";

      this.updateBidItemsUI();
      await this.loadBidItemsData();
      this._renderBidItemsUI();
    } finally {
      this.isTransitioning = false;
    }
  }

  // ✨ 입찰 결과 필터 초기화 (백엔드 재요청)
  async resetBidResultsFilters() {
    this.bidResultsState.dateRange = 30;
    this.bidResultsState.currentPage = 1;
    this.bidResultsState.sortBy = "date";
    this.bidResultsState.sortOrder = "desc";

    this.updateBidResultsUI();
    await this.renderBidResultsSection();
  }

  // 입찰 이벤트 리스너 설정
  setupBidEventListeners() {
    window.addEventListener("bidSuccess", async (e) => {
      try {
        console.log("입찰 성공 이벤트 감지:", e.detail);

        await Promise.all([this.loadBidItemsData(), this.loadBidResultsData()]);

        switch (this.currentSection) {
          case "dashboard":
            this.renderDashboard();
            break;
          case "bid-items":
            this._renderBidItemsUI();
            break;
          case "bid-results":
            await this.renderBidResultsSection();
            break;
        }

        if (e.detail && e.detail.message) {
          console.log("입찰 성공:", e.detail.message);
        }
      } catch (error) {
        console.error("입찰 성공 후 데이터 새로고침 실패:", error);
      }
    });
  }

  // 계정 관리 폼 설정
  setupAccountForms() {
    document
      .getElementById("basic-info-form")
      ?.addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleAccountUpdate("basic");
      });

    document
      .getElementById("company-info-form")
      ?.addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleAccountUpdate("company");
      });
  }

  // 계정 정보 업데이트
  async handleAccountUpdate(formType) {
    try {
      const formData = new FormData();

      if (formType === "basic") {
        formData.append("phone", document.getElementById("user-phone").value);
      } else if (formType === "company") {
        formData.append(
          "company_name",
          document.getElementById("company-name").value
        );
        formData.append(
          "business_number",
          document.getElementById("business-number").value
        );
        formData.append(
          "address",
          document.getElementById("company-address").value
        );
      }

      const result = await window.API.fetchAPI("/users/current", {
        method: "PUT",
        body: formData,
      });

      if (result.success) {
        this.userData = result.user;
        this.populateAccountForm();
        alert("정보가 성공적으로 업데이트되었습니다.");
      } else {
        alert(result.message || "업데이트에 실패했습니다.");
      }
    } catch (error) {
      console.error("계정 정보 업데이트 실패:", error);
      alert("업데이트 중 오류가 발생했습니다.");
    }
  }

  // 상태 필터 UI 업데이트
  updateBidItemsStatusFilterUI() {
    const higherBidWrapper = document.getElementById(
      "bidItems-status-higher-bid-wrapper"
    );

    if (this.bidProductsState.bidType === "direct") {
      if (higherBidWrapper) higherBidWrapper.style.display = "block";
    } else {
      if (higherBidWrapper) higherBidWrapper.style.display = "none";
      if (this.bidProductsState.status === "higher-bid") {
        this.bidProductsState.status = "all";
        const allRadio = document.getElementById("bidItems-status-all");
        if (allRadio) allRadio.checked = true;
      }
    }
  }
}

// 전역 변수
let myPageManager;

// ✨ 감정서 신청 함수 (통합 엔드포인트 사용)
window.requestAppraisal = async function (item) {
  if (
    confirm(
      "감정서를 신청하시겠습니까?\n수수료 16,500원(VAT포함)이 추가됩니다."
    )
  ) {
    try {
      const endpoint =
        item.type === "direct"
          ? `/bid-results/direct/${item.id}/request-appraisal`
          : `/bid-results/live/${item.id}/request-appraisal`;

      const response = await window.API.fetchAPI(endpoint, {
        method: "POST",
      });

      if (response.message) {
        alert("감정서 신청이 완료되었습니다.");
        location.reload();
      }
    } catch (error) {
      console.error("감정서 신청 중 오류:", error);
      alert("감정서 신청 중 오류가 발생했습니다.");
    }
  }
};

// ✨ 수선 접수 함수 (통합 엔드포인트 사용)
window.requestRepair = async function (item) {
  // 수선 수수료 (나중에 수정 가능)
  const REPAIR_FEE = 0; // 원 (VAT 포함)

  const confirmMessage =
    REPAIR_FEE > 0
      ? `수선을 접수하시겠습니까?\n수수료 ${REPAIR_FEE.toLocaleString()}원(VAT포함)이 추가됩니다.`
      : "수선을 접수하시겠습니까?";

  if (confirm(confirmMessage)) {
    try {
      const endpoint =
        item.type === "direct"
          ? `/bid-results/direct/${item.id}/request-repair`
          : `/bid-results/live/${item.id}/request-repair`;

      const response = await window.API.fetchAPI(endpoint, {
        method: "POST",
      });

      if (response.message) {
        alert("수선 접수가 완료되었습니다.");
        location.reload();
      }
    } catch (error) {
      console.error("수선 접수 중 오류:", error);
      alert("수선 접수 중 오류가 발생했습니다.");
    }
  }
};

// bid-products.js와 동일한 로딩 UI
window.bidLoadingUI = {
  showBidLoading: function (buttonElement) {
    buttonElement.dataset.originalText = buttonElement.textContent;
    buttonElement.innerHTML = '<span class="spinner"></span> 처리 중...';
    buttonElement.disabled = true;
    buttonElement.classList.add("loading");
  },

  hideBidLoading: function (buttonElement) {
    buttonElement.textContent =
      buttonElement.dataset.originalText || "입찰하기";
    buttonElement.disabled = false;
    buttonElement.classList.remove("loading");
  },
};

// DOM 로드 시 초기화
document.addEventListener("DOMContentLoaded", async () => {
  try {
    myPageManager = new MyPageManager();
    await myPageManager.initialize();
  } catch (error) {
    console.error("마이페이지 초기화 실패:", error);
    document.querySelector(".my-page-main").innerHTML =
      '<div class="error-message">페이지를 불러오는 중 오류가 발생했습니다. 새로고침 후 다시 시도해주세요.</div>';
  }
});

// 브라우저 뒤로가기/앞으로가기 처리
window.addEventListener("hashchange", () => {
  if (myPageManager) {
    const hash = window.location.hash.replace("#", "");
    const section = [
      "dashboard",
      "bid-items",
      "bid-results",
      "account",
    ].includes(hash)
      ? hash
      : "dashboard";
    myPageManager.showSection(section);
  }
});
