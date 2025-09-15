// public/js/my-page.js

// 마이페이지 관리 클래스
class MyPageManager {
  constructor() {
    this.currentSection = "dashboard";
    this.userData = null;

    // bid-products.js 상태 (Core와 호환)
    this.bidProductsState = {
      bidType: "all",
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

    // bid-results.js 상태 (Core와 호환)
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
        this.loadBidItemsData(),
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

  // 입찰 항목 데이터 로드 (bid-products.js 로직 완전 복사)
  async loadBidItemsData() {
    try {
      // 날짜 범위 계산
      const dateLimit = new Date();
      dateLimit.setDate(dateLimit.getDate() - this.bidProductsState.dateRange);
      const fromDate = formatDate(dateLimit);

      // API 파라미터 (bid-products.js와 동일)
      const params = {
        status: this.bidProductsCore.STATUS_GROUPS.ALL.join(","),
        fromDate: fromDate,
        page: 1,
        limit: 0, // 모든 데이터 가져오기
        sortBy: this.bidProductsState.sortBy,
        sortOrder: this.bidProductsState.sortOrder,
      };

      if (
        this.bidProductsState.keyword &&
        this.bidProductsState.keyword.trim() !== ""
      ) {
        params.keyword = this.bidProductsState.keyword.trim();
      }

      const queryString = window.API.createURLParams(params);

      // 경매 타입에 따른 API 호출
      let liveResults = { bids: [] };
      let directResults = { bids: [] };

      if (this.bidProductsState.bidType === "direct") {
        directResults = await window.API.fetchAPI(
          `/direct-bids?${queryString}`
        );
      } else if (this.bidProductsState.bidType === "live") {
        liveResults = await window.API.fetchAPI(`/live-bids?${queryString}`);
      } else {
        // all인 경우 둘 다 가져오기
        [liveResults, directResults] = await Promise.all([
          window.API.fetchAPI(`/live-bids?${queryString}`),
          window.API.fetchAPI(`/direct-bids?${queryString}`),
        ]);
      }

      this.bidProductsState.liveBids = liveResults.bids || [];
      this.bidProductsState.directBids = directResults.bids || [];

      // 데이터 타입 정보 추가
      const liveBidsWithType = this.bidProductsState.liveBids.map((bid) => ({
        ...bid,
        type: "live",
        displayStatus: bid.status,
      }));

      const directBidsWithType = this.bidProductsState.directBids.map(
        (bid) => ({
          ...bid,
          type: "direct",
          displayStatus: bid.status,
        })
      );

      // 결합 결과 설정
      this.bidProductsState.combinedResults = [
        ...liveBidsWithType,
        ...directBidsWithType,
      ];
      this.bidProductsState.filteredResults =
        this.bidProductsState.combinedResults;

      // 페이지네이션 설정
      this.bidProductsState.totalItems =
        this.bidProductsState.filteredResults.length;
      this.bidProductsState.totalPages = Math.ceil(
        this.bidProductsState.totalItems / this.bidProductsState.itemsPerPage
      );

      // BidManager에 데이터 전달
      if (window.BidManager) {
        window.BidManager.updateCurrentData(
          this.bidProductsState.filteredResults.map((item) => item.item)
        );
        window.BidManager.updateBidData(
          this.bidProductsState.liveBids,
          this.bidProductsState.directBids
        );
      }

      // Core에 상태 업데이트
      this.bidProductsCore.setPageState(this.bidProductsState);

      console.log(
        `입찰 항목 데이터 로드 완료: 총 ${this.bidProductsState.filteredResults.length}건`
      );
    } catch (error) {
      console.error("입찰 항목 데이터 로드 실패:", error);
      this.bidProductsState.filteredResults = [];
    }
  }

  // 입찰 결과 데이터 로드 (bid-results.js 로직 완전 복사)
  async loadBidResultsData() {
    try {
      // 날짜 범위 계산
      const dateLimit = new Date();
      dateLimit.setDate(dateLimit.getDate() - this.bidResultsState.dateRange);
      const fromDate = formatDate(dateLimit);

      // API 파라미터
      const params = {
        status: "active,final,completed,shipped,cancelled",
        fromDate: fromDate,
        sortBy: "scheduled_date",
        sortOrder: "desc",
        limit: 0,
      };

      const queryString = window.API.createURLParams(params);

      // 경매 타입에 관계없이 모든 데이터 가져오기
      const [liveResults, directResults] = await Promise.all([
        window.API.fetchAPI(`/live-bids?${queryString}`),
        window.API.fetchAPI(`/direct-bids?${queryString}`),
      ]);

      // 결합 및 타입 정보 추가
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

      // Core에 상태 업데이트 후 일별로 그룹화
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

  // 섹션 전환
  showSection(sectionName) {
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

    // 섹션별 렌더링
    switch (sectionName) {
      case "dashboard":
        this.renderDashboard();
        break;
      case "bid-items":
        this.renderBidItemsSection();
        break;
      case "bid-results":
        this.renderBidResultsSection();
        break;
      case "account":
        this.renderAccountSection();
        break;
    }

    console.log(`섹션 전환: ${sectionName}`);
  }

  // 대시보드 렌더링
  async renderDashboard() {
    // 통계 계산
    const stats = await this.calculateDashboardStats();

    // 통계 표시
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

    // 최근 입찰 표시
    this.renderRecentBids();
  }

  // 대시보드 통계 계산
  async calculateDashboardStats() {
    const activeCount = this.bidProductsState.filteredResults.filter((bid) =>
      ["active", "first", "second", "final"].includes(bid.status)
    ).length;

    const completedCount = this.bidResultsState.combinedResults.filter(
      (bid) => bid.status === "completed"
    ).length;

    // 더 높은 입찰 발생 개수
    const higherBidCount = this.bidProductsState.filteredResults.filter(
      (bid) => bid.status === "cancelled"
    ).length;

    // 현재 최고가 개수 (직접경매 + active 상태)
    const currentHighestCount = this.bidProductsState.filteredResults.filter(
      (bid) =>
        bid.type === "direct" &&
        bid.status === "active" &&
        bid.current_price > 0
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

  // 입찰 항목 섹션 렌더링 (Core 사용)
  renderBidItemsSection() {
    // UI 상태 업데이트
    this.updateBidItemsUI();

    // Core를 사용하여 표시 (기본 컨테이너 productList 사용)
    this.bidProductsCore.setPageState(this.bidProductsState);
    this.bidProductsCore.displayProducts();
    this.bidProductsCore.updatePagination((page) =>
      this.handleBidItemsPageChange(page)
    );

    // 결과 카운트 업데이트
    document.getElementById("bid-items-total-count").textContent =
      this.bidProductsState.totalItems;
    document.getElementById("bid-items-loading").style.display = "none";

    // BidManager 초기화
    if (window.BidManager) {
      window.BidManager.initializePriceCalculators();
    }
  }

  // 입찰 결과 섹션 렌더링 (Core 사용)
  renderBidResultsSection() {
    // UI 상태 업데이트
    this.updateBidResultsUI();

    // Core를 사용하여 표시 (기본 컨테이너 resultsList 사용)
    this.bidResultsCore.setPageState(this.bidResultsState);
    this.bidResultsCore.displayResults();

    // 별도 페이지네이션 컨테이너 사용
    createPagination(
      this.bidResultsState.currentPage,
      this.bidResultsState.totalPages,
      (page) => this.handleBidResultsPageChange(page),
      "results-pagination"
    );

    // 결과 카운트 업데이트
    document.getElementById("bid-results-total-count").textContent =
      this.bidResultsState.totalItems;
    document.getElementById("bid-results-loading").style.display = "none";
  }

  // 입찰 항목 UI 상태 업데이트
  updateBidItemsUI() {
    // 경매 타입 라디오 버튼
    document.querySelectorAll('input[name="bidType"]').forEach((radio) => {
      radio.checked = radio.value === this.bidProductsState.bidType;
    });

    // 상태 라디오 버튼
    document.querySelectorAll('input[name="status"]').forEach((radio) => {
      radio.checked = radio.value === this.bidProductsState.status;
    });

    // 날짜 범위 선택
    const dateRange = document.getElementById("dateRange");
    if (dateRange) dateRange.value = this.bidProductsState.dateRange;

    // 정렬 버튼 업데이트
    this.bidProductsCore.updateSortButtonsUI();
  }

  // 입찰 결과 UI 상태 업데이트
  updateBidResultsUI() {
    // 날짜 범위 선택
    const dateRange = document.getElementById("dateRangeResults");
    if (dateRange) dateRange.value = this.bidResultsState.dateRange;

    // 정렬 버튼 업데이트 (입찰 결과 섹션 내의 버튼들만)
    const section = document.getElementById("bid-results-section");
    const sortButtons = section.querySelectorAll(".sort-btn");

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
    await this.bidProductsCore.handlePageChange(page, async () => {
      // 페이지 변경 시 필요한 추가 로직
      this.bidProductsCore.setPageState(this.bidProductsState);
    });
  }

  // 입찰 결과 페이지 변경
  handleBidResultsPageChange(page) {
    this.bidResultsCore.handlePageChange(page, () => {
      // 페이지 변경 시 필요한 추가 로직
      this.bidResultsCore.setPageState(this.bidResultsState);
      // 페이지네이션 다시 렌더링
      createPagination(
        this.bidResultsState.currentPage,
        this.bidResultsState.totalPages,
        (page) => this.handleBidResultsPageChange(page),
        "results-pagination"
      );
    });
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

    // 입찰 항목 필터 이벤트
    this.setupBidItemsEvents();

    // 입찰 결과 필터 이벤트
    this.setupBidResultsEvents();

    // 계정 관리 폼
    this.setupAccountForms();

    // 입찰 성공 이벤트 리스너
    this.setupBidEventListeners();

    console.log("이벤트 리스너 설정 완료");
  }

  // 대시보드 이벤트 설정
  setupDashboardEvents() {
    // 진행중 입찰 카드 클릭
    const activeCountEl = document.getElementById("active-count");
    if (activeCountEl) {
      activeCountEl.parentElement.addEventListener("click", () => {
        this.bidProductsState.status = "active";
        this.bidProductsState.bidType = "all";
        this.showSection("bid-items");
      });
    }

    // 더 높은 입찰 발생 카드 클릭
    const higherBidCountEl = document.getElementById("higher-bid-count");
    if (higherBidCountEl) {
      higherBidCountEl.parentElement.addEventListener("click", () => {
        this.bidProductsState.status = "cancelled";
        this.bidProductsState.bidType = "all";
        this.showSection("bid-items");
      });
    }

    // 현재 최고가 카드 클릭
    const currentHighestCountEl = document.getElementById(
      "current-highest-count"
    );
    if (currentHighestCountEl) {
      currentHighestCountEl.parentElement.addEventListener("click", () => {
        this.bidProductsState.status = "active";
        this.bidProductsState.bidType = "direct";
        this.showSection("bid-items");
      });
    }

    // 낙찰 건수 카드 클릭
    const completedCountEl = document.getElementById("completed-count");
    if (completedCountEl) {
      completedCountEl.parentElement.addEventListener("click", () => {
        this.showSection("bid-results");
      });
    }
  }

  // 입찰 항목 이벤트 설정
  setupBidItemsEvents() {
    const section = document.getElementById("bid-items-section");

    // 경매 타입 라디오 버튼
    section.querySelectorAll('input[name="bidType"]').forEach((radio) => {
      radio.addEventListener("change", async (e) => {
        this.bidProductsState.bidType = e.target.value;
        this.bidProductsState.currentPage = 1;
        await this.loadBidItemsData();
        this.renderBidItemsSection();
      });
    });

    // 상태 라디오 버튼
    section.querySelectorAll('input[name="status"]').forEach((radio) => {
      radio.addEventListener("change", async (e) => {
        this.bidProductsState.status = e.target.value;
        this.bidProductsState.currentPage = 1;
        await this.loadBidItemsData();
        this.renderBidItemsSection();
      });
    });

    // 기간 드롭다운
    section
      .querySelector("#dateRange")
      ?.addEventListener("change", async (e) => {
        this.bidProductsState.dateRange = parseInt(e.target.value);
        this.bidProductsState.currentPage = 1;
        await this.loadBidItemsData();
        this.renderBidItemsSection();
      });

    // 정렬 버튼들
    const sortButtons = section.querySelectorAll(".sort-btn");
    sortButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        this.handleBidItemsSortChange(btn.dataset.sort);
      });
    });

    // 필터 적용 버튼
    section
      .querySelector("#applyFilters")
      ?.addEventListener("click", async () => {
        this.bidProductsState.currentPage = 1;
        await this.loadBidItemsData();
        this.renderBidItemsSection();
      });

    // 필터 초기화 버튼
    section.querySelector("#resetFilters")?.addEventListener("click", () => {
      this.resetBidItemsFilters();
    });
  }

  // 입찰 결과 이벤트 설정
  setupBidResultsEvents() {
    const section = document.getElementById("bid-results-section");

    // 기간 드롭다운
    section
      .querySelector("#dateRangeResults")
      ?.addEventListener("change", async (e) => {
        this.bidResultsState.dateRange = parseInt(e.target.value);
        this.bidResultsState.currentPage = 1;
        await this.loadBidResultsData();
        this.renderBidResultsSection();
      });

    // 정렬 버튼들
    const sortButtons = section.querySelectorAll(".sort-btn");
    sortButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        this.handleBidResultsSortChange(btn.dataset.sort);
      });
    });

    // 필터 적용 버튼
    section
      .querySelector("#applyResultsFilters")
      ?.addEventListener("click", async () => {
        this.bidResultsState.currentPage = 1;
        await this.loadBidResultsData();
        this.renderBidResultsSection();
      });

    // 필터 초기화 버튼
    section
      .querySelector("#resetResultsFilters")
      ?.addEventListener("click", () => {
        this.resetBidResultsFilters();
      });
  }

  // 입찰 항목 정렬 변경 처리
  async handleBidItemsSortChange(sortKey) {
    if (this.bidProductsState.sortBy === sortKey) {
      this.bidProductsState.sortOrder =
        this.bidProductsState.sortOrder === "asc" ? "desc" : "asc";
    } else {
      this.bidProductsState.sortBy = sortKey;
      if (sortKey === "scheduled_date") {
        this.bidProductsState.sortOrder = "asc";
      } else if (sortKey === "starting_price" || sortKey === "current_price") {
        this.bidProductsState.sortOrder = "desc";
      } else {
        this.bidProductsState.sortOrder = "asc";
      }
    }

    await this.loadBidItemsData();
    this.renderBidItemsSection();
  }

  // 입찰 결과 정렬 변경 처리
  async handleBidResultsSortChange(sortKey) {
    if (this.bidResultsState.sortBy === sortKey) {
      this.bidResultsState.sortOrder =
        this.bidResultsState.sortOrder === "asc" ? "desc" : "asc";
    } else {
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
    this.bidProductsState.bidType = "all";
    this.bidProductsState.status = "all";
    this.bidProductsState.dateRange = 30;
    this.bidProductsState.keyword = "";
    this.bidProductsState.currentPage = 1;
    this.bidProductsState.sortBy = "updated_at";
    this.bidProductsState.sortOrder = "desc";

    this.updateBidItemsUI();
    await this.loadBidItemsData();
    this.renderBidItemsSection();
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
      const { itemId, type } = e.detail;

      // 데이터 새로고침
      await this.loadBidItemsData();
      await this.loadBidResultsData();

      // 현재 섹션 다시 렌더링
      if (this.currentSection === "bid-items") {
        this.renderBidItemsSection();
      } else if (this.currentSection === "bid-results") {
        this.renderBidResultsSection();
      } else if (this.currentSection === "dashboard") {
        this.renderDashboard();
      }

      // 상세 모달이 열려있는 경우 해당 항목 업데이트
      const modal = document.getElementById("detailModal");
      if (modal && modal.style.display === "flex") {
        const modalItemId =
          document.querySelector(".modal-title")?.dataset?.itemId;
        if (modalItemId === itemId) {
          this.showProductDetails(itemId);
        }
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
      let updateData = {};

      if (formType === "basic") {
        updateData = {
          email: document.getElementById("user-email").value,
          phone: document.getElementById("user-phone").value,
          registration_date: document.getElementById("registration-date").value,
        };
      } else if (formType === "company") {
        updateData = {
          company_name: document.getElementById("company-name").value,
          business_number: document.getElementById("business-number").value,
          address: document.getElementById("company-address").value,
        };
      }

      await window.API.fetchAPI(`/users/${this.userData.id}`, {
        method: "PUT",
        body: JSON.stringify(updateData),
      });

      alert("정보가 성공적으로 수정되었습니다.");

      await this.loadUserData();
      this.populateAccountForm();
    } catch (error) {
      console.error("계정 정보 수정 실패:", error);
      alert("정보 수정 중 오류가 발생했습니다.");
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
      window.BidResultsCore.toggleLoading(true);
      const endpoint = item.type === "direct" ? "direct-bids" : "live-bids";
      const response = await window.API.fetchAPI(
        `/${endpoint}/${item.id}/request-appraisal`,
        {
          method: "POST",
        }
      );

      if (response.message) {
        alert("감정서 신청이 완료되었습니다.");
        await myPageManager.loadBidResultsData();
        if (myPageManager.currentSection === "bid-results") {
          myPageManager.renderBidResultsSection();
        }
      }
    } catch (error) {
      console.error("감정서 신청 중 오류:", error);
      alert("감정서 신청 중 오류가 발생했습니다.");
    } finally {
      window.BidResultsCore.toggleLoading(false);
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
