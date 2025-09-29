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
      bidType: "live", // bid-products.js와 동일: live 또는 direct (all 제거)
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

    // bid-results.js와 완전히 동일한 상태 구조
    this.bidResultsState = {
      dateRange: 30,
      currentPage: 1,
      itemsPerPage: 7,
      sortBy: "date",
      sortOrder: "desc",
      combinedResults: [],
      dailyResults: [],
      filteredResults: [],
      totalItems: 0,
      totalPages: 0,
      isAuthenticated: false,
      isAdmin: false,
      totalStats: {
        itemCount: 0,
        totalItemCount: 0,
        japaneseAmount: 0,
        koreanAmount: 0,
        feeAmount: 0,
        vatAmount: 0,
        grandTotalAmount: 0,
        appraisalFee: 0,
        appraisalVat: 0,
        appraisalCount: 0,
      },
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
        this.loadBidItemsData(true), // true 전달: 양쪽 모두 로드
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

  // loadBidItemsData() 수정 - line 175
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

      // forceLoadBoth가 true면 양쪽 모두 로드
      if (forceLoadBoth) {
        const [liveResults, directResults] = await Promise.all([
          window.API.fetchAPI(`/live-bids?${queryString}`),
          window.API.fetchAPI(`/direct-bids?${queryString}`),
        ]);

        this.bidProductsState.liveBids = liveResults.bids || [];
        this.bidProductsState.directBids = directResults.bids || [];
      } else {
        // 선택된 타입만 로드
        if (this.bidProductsState.bidType === "direct") {
          const directResults = await window.API.fetchAPI(
            `/direct-bids?${queryString}`
          );
          this.bidProductsState.directBids = directResults.bids || [];
          // liveBids는 유지 (비우지 않음)
        } else {
          this.bidProductsState.bidType = "live";
          const liveRadio = document.getElementById("bidItems-bidType-live");
          if (liveRadio) liveRadio.checked = true;

          const liveResults = await window.API.fetchAPI(
            `/live-bids?${queryString}`
          );
          this.bidProductsState.liveBids = liveResults.bids || [];
          // directBids는 유지 (비우지 않음)
        }
      }

      // 필터링 적용
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

  // 입찰 결과 데이터 로드 (bid-results.js와 완전히 동일한 로직)
  async loadBidResultsData() {
    try {
      // 날짜 범위 계산
      const dateLimit = new Date();
      dateLimit.setDate(dateLimit.getDate() - this.bidResultsState.dateRange);
      const fromDate = formatDate(dateLimit);

      // API 파라미터 (bid-results.js와 동일)
      const params = {
        status: "active,final,completed,shipped,cancelled",
        fromDate: fromDate,
        sortBy: "scheduled_date",
        sortOrder: "desc",
        limit: 0,
      };

      const queryString = window.API.createURLParams(params);

      // 경매 타입에 관계없이 모든 데이터 가져오기 (bid-results.js와 동일)
      const [liveResults, directResults] = await Promise.all([
        window.API.fetchAPI(`/live-bids?${queryString}`),
        window.API.fetchAPI(`/direct-bids?${queryString}`),
      ]);

      // 결합 및 타입 정보 추가 (bid-results.js와 동일)
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

      this.bidResultsState.combinedResults = [
        ...liveBidsWithType,
        ...directBidsWithType,
      ];

      console.log(
        "Combined results:",
        this.bidResultsState.combinedResults.map((b) => ({
          id: b.item?.item_id,
          status: b.status,
          type: b.type,
        }))
      );

      // Core에 상태 업데이트 후 일별로 그룹화 (bid-results.js와 동일)
      this.bidResultsCore.setPageState(this.bidResultsState);
      this.bidResultsCore.groupResultsByDate();

      console.log(
        `입찰 결과 데이터 로드 완료: 총 ${this.bidResultsState.combinedResults.length}건`
      );
    } catch (error) {
      console.error("입찰 결과 데이터 로드 실패:", error);
      this.bidResultsState.combinedResults = [];
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

      // 1. 상태 설정
      this.bidProductsState.bidType = bidType;
      this.bidProductsState.status = status;
      this.bidProductsState.currentPage = 1;

      // 2. 섹션 UI 전환 (탭, 섹션)
      this._switchSectionUI("bid-items");

      // 3. 데이터 로드
      await this.loadBidItemsData();

      // 4. 렌더링
      this._renderBidItemsUI();

      console.log("입찰 항목 전환 완료");
    } catch (error) {
      console.error("입찰 항목 전환 실패:", error);
      alert("페이지 전환 중 오류가 발생했습니다.");
    } finally {
      this.isTransitioning = false;
    }
  }

  // UI 전환만 담당 (데이터 로딩 없음)
  _switchSectionUI(sectionName) {
    // 탭 버튼 업데이트
    document.querySelectorAll(".tab-button").forEach((btn) => {
      btn.classList.remove("active");
    });
    document
      .querySelector(`[data-section="${sectionName}"]`)
      ?.classList.add("active");

    // 섹션 표시
    document.querySelectorAll(".page-section").forEach((section) => {
      section.classList.remove("active");
    });
    document.getElementById(`${sectionName}-section`)?.classList.add("active");

    // URL 해시 업데이트
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

      // UI 전환
      this._switchSectionUI(sectionName);

      // 섹션별 렌더링
      switch (sectionName) {
        case "dashboard":
          await this.renderDashboard();
          break;
        case "bid-items":
          // 현재 상태로 렌더링 (카드 클릭이 아닌 탭 클릭)
          await this.loadBidItemsData();
          this._renderBidItemsUI();
          break;
        case "bid-results":
          this.renderBidResultsSection();
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

    // 입찰 항목과 입찰 결과 모두 로드
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

    // 렌더링 후 이벤트 리스너 재등록
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

    // completed와 shipped 모두 포함
    const completedCount = this.bidResultsState.combinedResults.filter(
      (bid) => {
        const isCompleted = ["completed", "shipped"].includes(bid.status);
        console.log(
          `Bid ${bid.item?.item_id}: status=${bid.status}, isCompleted=${isCompleted}`
        );
        return isCompleted;
      }
    ).length;

    return { activeCount, higherBidCount, currentHighestCount, completedCount };
  }

  // 최근 입찰 렌더링
  renderRecentBids() {
    const container = document.getElementById("recent-bids-list");
    const recentBids = [
      ...this.bidProductsState.filteredResults,
      ...this.bidResultsState.combinedResults,
    ]
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

  // 상품 상세 정보 표시 (Core 사용)
  async showProductDetails(itemId) {
    // Core의 showProductDetails 사용
    await this.bidProductsCore.showProductDetails(itemId);
  }

  // 렌더링 로직 분리
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

  // 입찰 결과 섹션 렌더링 (bid-results.js와 동일한 방식)
  renderBidResultsSection() {
    // UI 상태 업데이트
    this.updateBidResultsUI();

    // Core를 사용하여 표시 (섹션별 컨테이너 ID 사용)
    this.bidResultsCore.setPageState(this.bidResultsState);
    this.bidResultsCore.displayResults("bidResults-resultsList");

    // 페이지네이션 (섹션별 컨테이너 ID 사용)
    createPagination(
      this.bidResultsState.currentPage,
      this.bidResultsState.totalPages,
      (page) => this.handleBidResultsPageChange(page),
      "bidResults-pagination"
    );

    // 결과 카운트 업데이트 (섹션별 ID 사용)
    document.getElementById("bidResults-totalResults").textContent =
      this.bidResultsState.totalItems;
    document.getElementById("bidResults-loadingMsg").style.display = "none";
  }

  // 입찰 항목 UI 상태 업데이트 (섹션별 ID 사용)
  updateBidItemsUI() {
    // 경매 타입 라디오 버튼 (섹션별 name 사용)
    document
      .querySelectorAll('input[name="bidItems-bidType"]')
      .forEach((radio) => {
        radio.checked = radio.value === this.bidProductsState.bidType;
      });

    // 상태 라디오 버튼 (섹션별 name 사용)
    document
      .querySelectorAll('input[name="bidItems-status"]')
      .forEach((radio) => {
        radio.checked = radio.value === this.bidProductsState.status;
      });

    // 날짜 범위 선택 (섹션별 ID 사용)
    const dateRange = document.getElementById("bidItems-dateRange");
    if (dateRange) dateRange.value = this.bidProductsState.dateRange;

    // 정렬 버튼 업데이트 (섹션별 정렬 버튼만)
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

  // 입찰 결과 UI 상태 업데이트 (섹션별 ID 사용)
  updateBidResultsUI() {
    // 날짜 범위 선택 (섹션별 ID 사용)
    const dateRange = document.getElementById("bidResults-dateRange");
    if (dateRange) dateRange.value = this.bidResultsState.dateRange;

    // 정렬 버튼 업데이트 (섹션별 정렬 버튼만)
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

  // 입찰 항목 페이지 변경 (현재 섹션 확인 후 처리)
  async handleBidItemsPageChange(page) {
    // 현재 섹션이 bid-items가 아니면 처리하지 않음
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

    // 클라이언트 페이지네이션만 수행 (API 재호출 없음)
    this.bidProductsCore.setPageState(this.bidProductsState);
    this.bidProductsCore.displayProducts("bidItems-productList");
    this.bidProductsCore.updatePagination(
      (page) => this.handleBidItemsPageChange(page),
      "bidItems-pagination"
    );

    window.scrollTo(0, 0);
  }

  // 입찰 결과 페이지 변경 (현재 섹션 확인 후 처리)
  handleBidResultsPageChange(page) {
    // 현재 섹션이 bid-results가 아니면 처리하지 않음
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
    this.renderBidResultsSection();
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
    // 탭 네비게이션
    document.querySelectorAll(".tab-button").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const section = e.currentTarget.getAttribute("data-section");
        this.showSection(section);
      });
    });

    // 대시보드 통계 카드 클릭 이벤트
    this.setupDashboardEvents();

    // 입찰 항목 필터 이벤트 (섹션별 ID 사용)
    this.setupBidItemsEvents();

    // 입찰 결과 필터 이벤트 (섹션별 ID 사용)
    this.setupBidResultsEvents();

    // 계정 관리 폼
    this.setupAccountForms();

    console.log("이벤트 리스너 설정 완료");
  }

  // 대시보드 이벤트 설정
  setupDashboardEvents() {
    console.log("대시보드 이벤트 설정");

    // 진행중 입찰 (현장 live / active)
    const activeCountEl = document.getElementById("active-count");
    if (activeCountEl) {
      activeCountEl.parentElement.addEventListener("click", () => {
        this.transitionToBidItems("live", "active");
      });
    }

    // 더 높은 입찰 발생 (직접 direct / higher-bid)
    const higherBidCountEl = document.getElementById("higher-bid-count");
    if (higherBidCountEl) {
      higherBidCountEl.parentElement.addEventListener("click", () => {
        this.transitionToBidItems("direct", "higher-bid");
      });
    }

    // 현재 최고가 (직접 direct / active)
    const currentHighestCountEl = document.getElementById(
      "current-highest-count"
    );
    if (currentHighestCountEl) {
      currentHighestCountEl.parentElement.addEventListener("click", () => {
        this.transitionToBidItems("direct", "active");
      });
    }

    // 낙찰 건수 (입찰 결과로 이동)
    const completedCountEl = document.getElementById("completed-count");
    if (completedCountEl) {
      completedCountEl.parentElement.addEventListener("click", () => {
        if (!this.isTransitioning) {
          this.showSection("bid-results");
        }
      });
    }
  }

  // 입찰 항목 이벤트 설정 (섹션별 ID 사용)
  setupBidItemsEvents() {
    // 경매 타입 라디오 버튼 (섹션별 name 사용)
    document
      .querySelectorAll('input[name="bidItems-bidType"]')
      .forEach((radio) => {
        radio.addEventListener("change", async (e) => {
          if (this.isTransitioning) return;
          this.isTransitioning = true;

          try {
            this.bidProductsState.bidType = e.target.value;
            this.bidProductsState.currentPage = 1;

            // UI 업데이트
            this.updateBidItemsStatusFilterUI();

            await this.loadBidItemsData();
            this._renderBidItemsUI();
          } finally {
            this.isTransitioning = false;
          }
        });
      });

    // 상태 라디오 버튼 (섹션별 name 사용)
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

    // 기간 드롭다운 (섹션별 ID 사용)
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

    // 정렬 버튼들 (섹션별 정렬 버튼만)
    const sortButtons = document.querySelectorAll(
      "#bid-items-section .sort-btn"
    );
    sortButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        this.handleBidItemsSortChange(btn.dataset.sort);
      });
    });

    // 필터 적용 버튼 (섹션별 ID 사용)
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

    // 필터 초기화 버튼 (섹션별 ID 사용)
    document
      .getElementById("bidItems-resetFilters")
      ?.addEventListener("click", () => {
        this.resetBidItemsFilters();
      });
  }

  // 입찰 결과 이벤트 설정 (섹션별 ID 사용)
  setupBidResultsEvents() {
    // 기간 드롭다운 (섹션별 ID 사용)
    document
      .getElementById("bidResults-dateRange")
      ?.addEventListener("change", async (e) => {
        this.bidResultsState.dateRange = parseInt(e.target.value);
        this.bidResultsState.currentPage = 1;
        await this.loadBidResultsData();
        this.renderBidResultsSection();
      });

    // 정렬 버튼들 (섹션별 정렬 버튼만)
    const sortButtons = document.querySelectorAll(
      "#bid-results-section .sort-btn"
    );
    sortButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        this.handleBidResultsSortChange(btn.dataset.sort);
      });
    });

    // 필터 적용 버튼 (섹션별 ID 사용)
    document
      .getElementById("bidResults-applyFilters")
      ?.addEventListener("click", async () => {
        this.bidResultsState.currentPage = 1;
        await this.loadBidResultsData();
        this.renderBidResultsSection();
      });

    // 필터 초기화 버튼 (섹션별 ID 사용)
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
        // 같은 키면 정렬 순서 토글
        this.bidProductsState.sortOrder =
          this.bidProductsState.sortOrder === "desc" ? "asc" : "desc";
      } else {
        // 다른 키면 새로운 정렬 키 설정하고 기본 순서(desc)로
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

  // 입찰 결과 정렬 변경 처리
  async handleBidResultsSortChange(sortKey) {
    if (this.bidResultsState.sortBy === sortKey) {
      // 같은 키면 정렬 순서 토글
      this.bidResultsState.sortOrder =
        this.bidResultsState.sortOrder === "desc" ? "asc" : "desc";
    } else {
      // 다른 키면 새로운 정렬 키 설정
      this.bidResultsState.sortBy = sortKey;
      this.bidResultsState.sortOrder = "desc";
    }

    // Core를 사용하여 정렬
    this.bidResultsCore.setPageState(this.bidResultsState);
    this.bidResultsCore.sortDailyResults();
    this.renderBidResultsSection();
  }

  // 입찰 항목 필터 초기화
  async resetBidItemsFilters() {
    if (this.isTransitioning) return;
    this.isTransitioning = true;

    try {
      this.bidProductsState.bidType = "live"; // all 대신 live
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

  // 입찰 결과 필터 초기화
  async resetBidResultsFilters() {
    this.bidResultsState.dateRange = 30;
    this.bidResultsState.currentPage = 1;
    this.bidResultsState.sortBy = "date";
    this.bidResultsState.sortOrder = "desc";

    this.updateBidResultsUI();
    await this.loadBidResultsData();
    this.renderBidResultsSection();
  }

  // 입찰 이벤트 리스너 설정
  setupBidEventListeners() {
    window.addEventListener("bidSuccess", async (e) => {
      try {
        console.log("입찰 성공 이벤트 감지:", e.detail);

        // 데이터 새로고침
        await Promise.all([this.loadBidItemsData(), this.loadBidResultsData()]);

        // 현재 섹션에 따라 UI 업데이트
        switch (this.currentSection) {
          case "dashboard":
            this.renderDashboard();
            break;
          case "bid-items":
            this.renderBidItemsSection();
            break;
          case "bid-results":
            this.renderBidResultsSection();
            break;
        }

        // 성공 메시지 표시 (필요시)
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

  // 상태 필터 UI 업데이트 함수 (bid-products.js와 동일)
  updateBidItemsStatusFilterUI() {
    const higherBidWrapper = document.getElementById(
      "bidItems-status-higher-bid-wrapper"
    );

    if (this.bidProductsState.bidType === "direct") {
      if (higherBidWrapper) higherBidWrapper.style.display = "block";
    } else {
      if (higherBidWrapper) higherBidWrapper.style.display = "none";
      // 현재 선택이 higher-bid면 all로 변경
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

// 감정서 신청 함수 (전역으로 노출하여 core에서 사용)
window.requestAppraisal = async function (item) {
  if (
    confirm(
      "감정서를 신청하시겠습니까?\n수수료 16,500원(VAT포함)이 추가됩니다."
    )
  ) {
    try {
      const result = await window.API.fetchAPI("/appraisals/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_id: item.item_id,
          auction_house: item.auction_house,
          lot_number: item.lot_number,
        }),
      });

      if (result.success) {
        alert("감정서 신청이 완료되었습니다.");
        location.reload();
      } else {
        alert(result.message || "감정서 신청에 실패했습니다.");
      }
    } catch (error) {
      console.error("감정서 신청 실패:", error);
      alert("감정서 신청 중 오류가 발생했습니다.");
    } finally {
      // 로딩 상태 해제 등 필요시 추가
    }
  }
};

// bid-products.js와 동일한 로딩 UI 추가
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
