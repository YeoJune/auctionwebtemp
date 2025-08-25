// public/js/my-page.js

// 마이페이지 관리 클래스
class MyPageManager {
  constructor() {
    this.currentSection = "dashboard";
    this.bidItemsData = [];
    this.bidResultsData = [];
    this.userData = null;
    this.bidItemsFilter = {
      type: "all", // all, live, direct
      status: "all", // all, active, completed, cancelled, highest
    };
    this.bidResultsFilter = {
      type: "all", // all, live, direct
      status: "all", // all, can_apply, completed, shipped
    };
    this.bidItemsPagination = {
      currentPage: 1,
      itemsPerPage: 10,
      totalItems: 0,
      totalPages: 0,
    };
    this.bidResultsPagination = {
      currentPage: 1,
      itemsPerPage: 10,
      totalItems: 0,
      totalPages: 0,
    };
    // bid-products.js에서 복사한 상태
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
    // bid-results.js에서 복사한 상태
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
        japaneseAmount: 0,
        koreanAmount: 0,
        feeAmount: 0,
        grandTotalAmount: 0,
        appraisalFee: 0,
        appraisalVat: 0,
        appraisalCount: 0,
      },
    };
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

      // 환율 및 수수료율 정보 로드
      await fetchExchangeRate();
      await fetchUserCommissionRate();

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
        BidManager.initialize(
          true,
          this.bidItemsData.map((item) => item.item)
        );
        BidManager.updateBidData(
          this.bidProductsState.liveBids,
          this.bidProductsState.directBids
        );
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
      this.userData = await API.fetchAPI("/users/current");
      console.log("사용자 데이터 로드 완료:", this.userData.id);
    } catch (error) {
      console.error("사용자 데이터 로드 실패:", error);
      throw error;
    }
  }

  // 입찰 항목 데이터 로드 (bid-products.js 로직 복사)
  async loadBidItemsData() {
    try {
      const [liveBidsResponse, directBidsResponse] = await Promise.all([
        API.fetchAPI("/live-bids?limit=0"),
        API.fetchAPI("/direct-bids?limit=0"),
      ]);

      // 진행중인 입찰만 필터링
      const liveBids = (liveBidsResponse.bids || [])
        .filter((bid) =>
          ["active", "first", "second", "final"].includes(bid.status)
        )
        .map((bid) => ({ ...bid, type: "live" }));

      const directBids = (directBidsResponse.bids || [])
        .filter((bid) => bid.status === "active" || bid.status === "cancelled")
        .map((bid) => ({ ...bid, type: "direct" }));

      this.bidItemsData = [...liveBids, ...directBids].sort(
        (a, b) => new Date(b.updated_at) - new Date(a.updated_at)
      );

      // bid-products.js 상태도 업데이트
      this.bidProductsState.liveBids = liveBids;
      this.bidProductsState.directBids = directBids;
      this.bidProductsState.combinedResults = [...liveBids, ...directBids];

      console.log(
        `입찰 항목 데이터 로드 완료: 총 ${this.bidItemsData.length}건`
      );
    } catch (error) {
      console.error("입찰 항목 데이터 로드 실패:", error);
      this.bidItemsData = [];
    }
  }

  // 입찰 결과 데이터 로드 (bid-results.js 로직 복사)
  async loadBidResultsData() {
    try {
      const [liveBidsResponse, directBidsResponse] = await Promise.all([
        API.fetchAPI("/live-bids?limit=0"),
        API.fetchAPI("/direct-bids?limit=0"),
      ]);

      // 완료된 입찰만 필터링 (shipped 상태도 포함)
      const liveBids = (liveBidsResponse.bids || [])
        .filter((bid) =>
          ["completed", "cancelled", "shipped"].includes(bid.status)
        )
        .map((bid) => ({
          ...bid,
          type: "live",
          processStage:
            bid.status === "completed" && !bid.appr_id
              ? "can_apply"
              : bid.status === "shipped"
              ? "shipped"
              : "completed",
        }));

      const directBids = (directBidsResponse.bids || [])
        .filter((bid) =>
          ["completed", "cancelled", "shipped"].includes(bid.status)
        )
        .map((bid) => ({
          ...bid,
          type: "direct",
          processStage:
            bid.status === "completed" && !bid.appr_id
              ? "can_apply"
              : bid.status === "shipped"
              ? "shipped"
              : "completed",
        }));

      this.bidResultsData = [...liveBids, ...directBids].sort(
        (a, b) => new Date(b.updated_at) - new Date(a.updated_at)
      );

      // bid-results.js 상태도 업데이트
      this.bidResultsState.combinedResults = this.bidResultsData.map((bid) => ({
        ...bid,
        type: bid.type,
      }));

      console.log(
        `입찰 결과 데이터 로드 완료: 총 ${this.bidResultsData.length}건`
      );
    } catch (error) {
      console.error("입찰 결과 데이터 로드 실패:", error);
      this.bidResultsData = [];
    }
  }

  // 더 높은 입찰 발생 개수 조회
  async loadHigherBidCount() {
    try {
      const response = await API.fetchAPI(
        "/direct-bids?status=cancelled&limit=0"
      );
      return (response.bids || []).length;
    } catch (error) {
      console.error("더 높은 입찰 발생 개수 조회 실패:", error);
      return 0;
    }
  }

  // 현재 최고가 개수 조회
  async loadCurrentHighestCount() {
    try {
      const response = await API.fetchAPI(
        "/direct-bids?highestOnly=true&limit=0"
      );
      return (response.bids || []).length;
    } catch (error) {
      console.error("현재 최고가 개수 조회 실패:", error);
      return 0;
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
    const activeCount = this.bidItemsData.filter((bid) =>
      ["active", "first", "second", "final"].includes(bid.status)
    ).length;

    const completedCount = this.bidResultsData.filter(
      (bid) => bid.status === "completed"
    ).length;

    // 더 높은 입찰 발생 개수
    const higherBidCount = await this.loadHigherBidCount();

    // 현재 최고가 개수
    const currentHighestCount = await this.loadCurrentHighestCount();

    return { activeCount, higherBidCount, currentHighestCount, completedCount };
  }

  // 최근 입찰 렌더링 (클릭 시 상세페이지)
  renderRecentBids() {
    const container = document.getElementById("recent-bids-list");
    const recentBids = [...this.bidItemsData, ...this.bidResultsData]
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
          <img src="${API.validateImageUrl(
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
              <span class="activity-status ${this.getStatusClass(
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

  // 상품 상세 정보 표시 (bid-products.js에서 복사)
  async showProductDetails(itemId) {
    const modalManager = setupModal("detailModal");
    if (!modalManager) return;

    // 해당 아이템 찾기
    let product = [...this.bidItemsData, ...this.bidResultsData].find(
      (p) => p.item?.item_id === itemId
    );

    if (!product) return;

    const item = product.item;

    // 기본 정보로 모달 초기화
    this.initializeModal(product, item);
    modalManager.show();

    // URL 파라미터 업데이트 (상품 ID 추가)
    const urlParams = window.URLStateManager.getURLParams();
    urlParams.set("item_id", itemId);
    const newUrl = window.location.pathname + "?" + urlParams.toString();
    window.history.replaceState({}, document.title, newUrl);

    // 로딩 표시
    window.ModalImageGallery.showLoading();

    try {
      // 상세 정보 가져오기
      const itemDetails = await API.fetchAPI(`/detail/item-details/${itemId}`, {
        method: "POST",
      });

      // 상세 정보 업데이트
      this.updateModalWithDetails(itemDetails);

      // 추가 이미지가 있다면 업데이트
      if (itemDetails.additional_images) {
        try {
          const additionalImages = JSON.parse(itemDetails.additional_images);
          window.ModalImageGallery.initialize([
            item.image,
            ...additionalImages,
          ]);
        } catch (e) {
          console.error("이미지 파싱 오류:", e);
        }
      }
    } catch (error) {
      console.error("상품 상세 정보를 가져오는 중 오류 발생:", error);
    } finally {
      window.ModalImageGallery.hideLoading();
    }
  }

  // 모달 초기화 (bid-products.js에서 복사)
  initializeModal(product, item) {
    document.querySelector(".modal-brand").textContent = item.brand || "-";
    document.querySelector(".modal-title").textContent = item.title || "-";
    document.querySelector(".modal-title").dataset.itemId = item.item_id;
    document.querySelector(".main-image").src = API.validateImageUrl(
      item.image
    );
    document.querySelector(".modal-description").textContent = "로딩 중...";
    document.querySelector(".modal-category").textContent =
      item.category || "로딩 중...";
    document.querySelector(".modal-brand2").textContent = item.brand || "-";
    document.querySelector(".modal-accessory-code").textContent =
      item.accessory_code || "로딩 중...";
    document.querySelector(".modal-scheduled-date").textContent =
      formatDateTime(item.scheduled_date) || "로딩 중...";
    document.querySelector(".modal-rank").textContent = item.rank || "N";

    // 가격 정보 표시
    this.displayBidInfoInModal(product, item);

    // 이미지 초기화
    window.ModalImageGallery.initialize([item.image]);
  }

  // 상세 정보로 모달 업데이트 (bid-products.js에서 복사)
  updateModalWithDetails(item) {
    document.querySelector(".modal-description").textContent =
      item.description || "설명 없음";
    document.querySelector(".modal-category").textContent =
      item.category || "카테고리 없음";
    document.querySelector(".modal-accessory-code").textContent =
      item.accessory_code || "액세서리 코드 없음";
    document.querySelector(".modal-scheduled-date").textContent =
      item.scheduled_date
        ? formatDateTime(item.scheduled_date)
        : "날짜 정보 없음";
    document.querySelector(".modal-brand").textContent = item.brand || "-";
    document.querySelector(".modal-brand2").textContent = item.brand || "-";
    document.querySelector(".modal-title").textContent =
      item.title || "제목 없음";
    document.querySelector(".modal-rank").textContent = item.rank || "N";
  }

  // 모달에서 입찰 정보 표시 (bid-products.js에서 복사)
  displayBidInfoInModal(product, item) {
    const bidSection = document.querySelector(".bid-info-holder");
    if (!bidSection) return;

    // BidManager를 사용하여 입찰 폼 생성
    if (product.type === "direct") {
      const directBidInfo = this.bidProductsState.directBids.find(
        (b) => b.id === product.id
      );
      bidSection.innerHTML = BidManager.getDirectBidSectionHTML(
        directBidInfo,
        item.item_id,
        item.auc_num,
        item.category
      );
    } else {
      const liveBidInfo = this.bidProductsState.liveBids.find(
        (b) => b.id === product.id
      );
      bidSection.innerHTML = BidManager.getLiveBidSectionHTML(
        liveBidInfo,
        item.item_id,
        item.auc_num,
        item.category
      );
    }

    // 가격 계산기 초기화
    BidManager.initializePriceCalculators();
  }

  // 입찰 항목 섹션 렌더링 (bid-products.js 로직 완전 복사)
  renderBidItemsSection() {
    // bid-products.js의 displayProducts 함수 로직을 여기에 구현
    this.displayBidItems();
  }

  // 입찰 항목 표시 (bid-products.js에서 복사 + 수정)
  displayBidItems() {
    const container = document.getElementById("bid-items-list");
    if (!container) return;

    // 필터 적용
    const filteredData = this.applyBidItemsFilter();

    this.bidItemsPagination.totalItems = filteredData.length;
    this.bidItemsPagination.totalPages = Math.ceil(
      filteredData.length / this.bidItemsPagination.itemsPerPage
    );

    const startIdx =
      (this.bidItemsPagination.currentPage - 1) *
      this.bidItemsPagination.itemsPerPage;
    const endIdx = startIdx + this.bidItemsPagination.itemsPerPage;
    const currentPageData = filteredData.slice(startIdx, endIdx);

    document.getElementById("bid-items-total-count").textContent =
      this.bidItemsPagination.totalItems;
    document.getElementById("bid-items-loading").style.display = "none";

    container.innerHTML = "";

    if (currentPageData.length === 0) {
      container.innerHTML =
        '<div class="no-results">표시할 상품이 없습니다.</div>';
      return;
    }

    currentPageData.forEach((product) => {
      const itemElement = this.renderBidResultItem(product);
      if (itemElement) {
        container.appendChild(itemElement);
      }
    });

    // BidManager 초기화
    if (window.BidManager) {
      BidManager.initializePriceCalculators();
    }

    // 페이지네이션 렌더링
    this.renderPagination(
      "bid-items-pagination",
      this.bidItemsPagination,
      (page) => this.handleBidItemsPageChange(page)
    );
  }

  // 입찰 아이템 HTML 생성 (bid-products.js에서 복사)
  renderBidResultItem(product) {
    const item = product.item;
    if (!item) return null;

    const displayPrice = this.getDisplayPrice(product);
    const statusText = this.getStatusText(product);
    const statusClass = this.getStatusClass(product);

    let priceHTML = `
      <div class="bid-price">
        <span class="price-label">입찰가:</span>
        <span class="price-value">￥${formatNumber(displayPrice)}</span>
      </div>
    `;

    // 낙찰 정보 표시
    if (product.winning_price) {
      const auctionId = item.auc_num || 1;
      const category = item.category || "기타";
      const koreanPrice = calculateTotalPrice(
        product.winning_price,
        auctionId,
        category
      );

      priceHTML += `
        <div class="winning-price">
          <span class="price-label">낙찰가:</span>
          <span class="price-value">￥${formatNumber(
            product.winning_price
          )}</span>
        </div>
        <div class="korean-price">
          <span class="price-label">관부가세 포함:</span>
          <span class="price-value">₩${formatNumber(koreanPrice)}</span>
        </div>
      `;
    }

    // 추가 입찰 버튼
    let actionHTML = "";
    const isActive = ["active", "first", "second", "final"].includes(
      product.status
    );
    if (isActive) {
      actionHTML = `
        <button class="additional-bid-btn" 
                onclick="myPageManager.showProductDetails('${item.item_id}')">
          추가 입찰
        </button>
      `;
    } else if (product.processStage === "can_apply") {
      actionHTML = `
        <button class="apply-appraisal-btn" 
                data-bid-id="${product.id}" 
                data-bid-type="${product.type}"
                data-brand="${item.brand || "-"}"
                data-title="${item.title || "제목 없음"}"
                data-image="${API.validateImageUrl(item.image)}"
                data-winning-price="${product.winning_price || 0}">
          감정서 신청
        </button>
      `;
    } else if (product.appr_id) {
      actionHTML = '<span class="appraisal-completed">감정서 신청 완료</span>';
    }

    const itemElement = document.createElement("div");
    itemElement.className = "bid-item";
    itemElement.innerHTML = `
      <img src="${API.validateImageUrl(
        item.image
      )}" alt="상품 이미지" class="item-image"
           onclick="myPageManager.showProductDetails('${item.item_id}')">
      <div class="item-info" onclick="myPageManager.showProductDetails('${
        item.item_id
      }')">
        <div class="item-brand">${item.brand || "-"}</div>
        <div class="item-title">${item.title || "제목 없음"}</div>
        <div class="item-meta">
          <span class="item-type">${
            product.type === "live" ? "현장경매" : "직접경매"
          }</span>
          <span class="item-category">${item.category || "-"}</span>
        </div>
      </div>
      <div class="price-info">
        ${priceHTML}
      </div>
      <div class="status-info">
        <span class="status-badge ${statusClass}">${statusText}</span>
        <div class="updated-date">${formatDateTime(product.updated_at)}</div>
        ${actionHTML}
      </div>
    `;

    return itemElement;
  }

  // 입찰 결과 섹션 렌더링 (bid-results.js 로직 완전 복사)
  renderBidResultsSection() {
    // bid-results.js의 모든 로직을 여기에 구현
    this.displayBidResults();
  }

  // 입찰 결과 표시 (bid-results.js에서 복사)
  displayBidResults() {
    const container = document.getElementById("bid-results-list");
    if (!container) return;

    const filteredData = this.applyBidResultsFilter();

    this.bidResultsPagination.totalItems = filteredData.length;
    this.bidResultsPagination.totalPages = Math.ceil(
      filteredData.length / this.bidResultsPagination.itemsPerPage
    );

    const startIdx =
      (this.bidResultsPagination.currentPage - 1) *
      this.bidResultsPagination.itemsPerPage;
    const endIdx = startIdx + this.bidResultsPagination.itemsPerPage;
    const currentPageData = filteredData.slice(startIdx, endIdx);

    document.getElementById("bid-results-total-count").textContent =
      this.bidResultsPagination.totalItems;
    document.getElementById("bid-results-loading").style.display = "none";

    container.innerHTML = "";

    if (currentPageData.length === 0) {
      container.innerHTML =
        '<div class="no-results">조건에 맞는 입찰 결과가 없습니다.</div>';
      return;
    }

    currentPageData.forEach((product) => {
      const itemElement = this.createBidResultItem(product);
      if (itemElement) {
        container.appendChild(itemElement);
      }
    });

    this.renderPagination(
      "bid-results-pagination",
      this.bidResultsPagination,
      (page) => this.handleBidResultsPageChange(page)
    );
  }

  // 입찰 결과 아이템 생성
  createBidResultItem(product) {
    const item = product.item;
    if (!item) return null;

    const displayPrice = this.getDisplayPrice(product);
    const statusText = this.getStatusText(product);
    const statusClass = this.getStatusClass(product);

    // 출고 상태 표시
    let shippingHTML = "";
    if (product.status === "shipped") {
      shippingHTML = '<span class="shipping-status shipped">출고됨</span>';
    } else if (product.status === "completed") {
      shippingHTML = '<span class="shipping-status waiting">출고 대기</span>';
    }

    // 감정서 신청 버튼
    let appraisalHTML = "";
    if (product.processStage === "can_apply") {
      appraisalHTML = `
        <button class="apply-appraisal-btn" 
                data-bid-id="${product.id}" 
                data-bid-type="${product.type}">
          감정서 신청
        </button>
      `;
    } else if (product.appr_id) {
      appraisalHTML =
        '<span class="appraisal-completed">감정서 신청 완료</span>';
    }

    const itemElement = document.createElement("div");
    itemElement.className = "bid-result-item";
    itemElement.innerHTML = `
      <img src="${API.validateImageUrl(
        item.image
      )}" alt="상품 이미지" class="item-image">
      <div class="item-info">
        <div class="item-brand">${item.brand || "-"}</div>
        <div class="item-title">${item.title || "제목 없음"}</div>
        <div class="item-category">${item.category || "-"}</div>
      </div>
      <div class="bid-info">
        <div class="price-info">
          <span class="price-label">입찰가:</span>
          <span class="price-value">￥${formatNumber(displayPrice)}</span>
        </div>
        ${
          product.winning_price
            ? `
          <div class="winning-price">
            <span class="price-label">낙찰가:</span>
            <span class="price-value">￥${formatNumber(
              product.winning_price
            )}</span>
          </div>
        `
            : ""
        }
      </div>
      <div class="status-info">
        <span class="status-badge ${statusClass}">${statusText}</span>
        ${shippingHTML}
        ${appraisalHTML}
        <div class="updated-date">${formatDateTime(product.updated_at)}</div>
      </div>
    `;

    return itemElement;
  }

  // 입찰 항목 필터 적용
  applyBidItemsFilter() {
    let filtered = [...this.bidItemsData];

    // 타입 필터 적용
    if (this.bidItemsFilter.type === "live") {
      filtered = filtered.filter((bid) => bid.type === "live");
    } else if (this.bidItemsFilter.type === "direct") {
      filtered = filtered.filter((bid) => bid.type === "direct");
    }

    // 상태 필터 적용
    if (this.bidItemsFilter.status === "active") {
      filtered = filtered.filter((bid) =>
        ["active", "first", "second", "final"].includes(bid.status)
      );
    } else if (this.bidItemsFilter.status === "completed") {
      filtered = filtered.filter((bid) =>
        ["completed", "shipped"].includes(bid.status)
      );
    } else if (this.bidItemsFilter.status === "cancelled") {
      filtered = filtered.filter((bid) => bid.status === "cancelled");
    } else if (this.bidItemsFilter.status === "highest") {
      // 현재 최고가 필터 (직접경매만)
      filtered = filtered.filter(
        (bid) => bid.type === "direct" && bid.current_price > 0
      );
    }

    return filtered;
  }

  // 입찰 결과 필터 적용
  applyBidResultsFilter() {
    let filtered = [...this.bidResultsData];

    // 타입 필터 적용
    if (this.bidResultsFilter.type === "live") {
      filtered = filtered.filter((bid) => bid.type === "live");
    } else if (this.bidResultsFilter.type === "direct") {
      filtered = filtered.filter((bid) => bid.type === "direct");
    }

    // 상태 필터 적용
    if (this.bidResultsFilter.status === "can_apply") {
      filtered = filtered.filter((bid) => bid.processStage === "can_apply");
    } else if (this.bidResultsFilter.status === "completed") {
      filtered = filtered.filter((bid) => bid.processStage === "completed");
    } else if (this.bidResultsFilter.status === "shipped") {
      filtered = filtered.filter((bid) => bid.processStage === "shipped");
    }

    return filtered;
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
    if (bid.processStage) {
      const statusMap = {
        can_apply: "감정서 신청 가능",
        completed: "완료",
        shipped: "출고됨",
      };
      return statusMap[bid.processStage] || "알 수 없음";
    }

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

  // 상태 클래스 반환
  getStatusClass(bid) {
    if (bid.processStage) {
      return bid.processStage;
    }

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

  // 페이지네이션 렌더링
  renderPagination(containerId, pagination, onPageChange) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = "";

    if (pagination.totalPages <= 1) return;

    // 이전 버튼
    const prevButton = document.createElement("button");
    prevButton.textContent = "이전";
    prevButton.disabled = pagination.currentPage <= 1;
    prevButton.addEventListener("click", () =>
      onPageChange(pagination.currentPage - 1)
    );
    container.appendChild(prevButton);

    // 페이지 번호 버튼들
    const startPage = Math.max(1, pagination.currentPage - 2);
    const endPage = Math.min(pagination.totalPages, pagination.currentPage + 2);

    for (let i = startPage; i <= endPage; i++) {
      const pageButton = document.createElement("button");
      pageButton.textContent = i;
      if (i === pagination.currentPage) {
        pageButton.classList.add("active");
      }
      pageButton.addEventListener("click", () => onPageChange(i));
      container.appendChild(pageButton);
    }

    // 다음 버튼
    const nextButton = document.createElement("button");
    nextButton.textContent = "다음";
    nextButton.disabled = pagination.currentPage >= pagination.totalPages;
    nextButton.addEventListener("click", () =>
      onPageChange(pagination.currentPage + 1)
    );
    container.appendChild(nextButton);
  }

  // 입찰 항목 페이지 변경
  handleBidItemsPageChange(page) {
    this.bidItemsPagination.currentPage = page;
    this.renderBidItemsSection();
    document.querySelector(".my-page-main").scrollTop = 0;
  }

  // 입찰 결과 페이지 변경
  handleBidResultsPageChange(page) {
    this.bidResultsPagination.currentPage = page;
    this.renderBidResultsSection();
    document.querySelector(".my-page-main").scrollTop = 0;
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

    // 통계 카드 클릭 이벤트 (새로 추가)
    document
      .getElementById("active-count")
      ?.parentElement?.addEventListener("click", () => {
        this.showSection("bid-items");
        this.bidItemsFilter.status = "active";
        this.bidItemsFilter.type = "all";
        this.renderBidItemsSection();
      });

    document
      .getElementById("higher-bid-count")
      ?.parentElement?.addEventListener("click", () => {
        this.showSection("bid-items");
        this.bidItemsFilter.status = "cancelled";
        this.bidItemsFilter.type = "direct";
        this.renderBidItemsSection();
      });

    document
      .getElementById("current-highest-count")
      ?.parentElement?.addEventListener("click", () => {
        this.showSection("bid-items");
        this.bidItemsFilter.status = "highest";
        this.bidItemsFilter.type = "direct";
        this.renderBidItemsSection();
      });

    document
      .getElementById("completed-count")
      ?.parentElement?.addEventListener("click", () => {
        this.showSection("bid-results");
      });

    // 입찰 항목 필터 버튼
    document
      .querySelectorAll("#bid-items-section .filter-btn")
      .forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const filter = e.target.dataset.filter;

          // 필터 타입 구분
          if (["all", "live", "direct"].includes(filter)) {
            // 타입 필터
            document
              .querySelectorAll(
                "#bid-items-section .filter-btn[data-filter='all'], #bid-items-section .filter-btn[data-filter='live'], #bid-items-section .filter-btn[data-filter='direct']"
              )
              .forEach((b) => b.classList.remove("active"));
            e.target.classList.add("active");
            this.bidItemsFilter.type = filter;
          } else {
            // 상태 필터
            document
              .querySelectorAll(
                "#bid-items-section .filter-btn[data-filter='active'], #bid-items-section .filter-btn[data-filter='completed'], #bid-items-section .filter-btn[data-filter='cancelled'], #bid-items-section .filter-btn[data-filter='highest']"
              )
              .forEach((b) => b.classList.remove("active"));
            e.target.classList.add("active");
            this.bidItemsFilter.status = filter;
          }

          this.bidItemsPagination.currentPage = 1;
          this.renderBidItemsSection();
        });
      });

    // 입찰 결과 필터 버튼
    document
      .querySelectorAll("#bid-results-section .filter-btn")
      .forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const filter = e.target.dataset.filter;

          // 필터 타입 구분
          if (["all", "live", "direct"].includes(filter)) {
            // 타입 필터
            document
              .querySelectorAll(
                "#bid-results-section .filter-btn[data-filter='all'], #bid-results-section .filter-btn[data-filter='live'], #bid-results-section .filter-btn[data-filter='direct']"
              )
              .forEach((b) => b.classList.remove("active"));
            e.target.classList.add("active");
            this.bidResultsFilter.type = filter;
          } else {
            // 상태 필터
            document
              .querySelectorAll(
                "#bid-results-section .filter-btn[data-filter='can_apply'], #bid-results-section .filter-btn[data-filter='completed'], #bid-results-section .filter-btn[data-filter='shipped']"
              )
              .forEach((b) => b.classList.remove("active"));
            e.target.classList.add("active");
            this.bidResultsFilter.status = filter;
          }

          this.bidResultsPagination.currentPage = 1;
          this.renderBidResultsSection();
        });
      });

    // 감정서 신청 모달
    this.setupAppraisalModal();

    // 계정 관리 폼
    this.setupAccountForms();

    // 입찰 성공 이벤트 리스너
    this.setupBidEventListeners();

    console.log("이벤트 리스너 설정 완료");
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

  // 감정서 신청 모달 설정
  setupAppraisalModal() {
    const modal = setupModal("appraisalModal");
    if (!modal) return;

    document.addEventListener("click", (e) => {
      if (e.target.classList.contains("apply-appraisal-btn")) {
        this.handleAppraisalClick(e.target);
      }
    });

    document
      .getElementById("confirmAppraisal")
      ?.addEventListener("click", () => {
        this.processAppraisalRequest();
      });

    document
      .getElementById("cancelAppraisal")
      ?.addEventListener("click", () => {
        modal.hide();
      });
  }

  // 감정서 신청 버튼 클릭 처리
  handleAppraisalClick(button) {
    const bidId = button.dataset.bidId;
    const bidType = button.dataset.bidType;
    const brand = button.dataset.brand;
    const title = button.dataset.title;
    const image = button.dataset.image;
    const winningPrice = button.dataset.winningPrice;

    document.getElementById("appraisal-product-image").src = image;
    document.getElementById("appraisal-brand").textContent = brand;
    document.getElementById("appraisal-title").textContent = title;
    document.getElementById("appraisal-price").textContent = `￥${formatNumber(
      winningPrice
    )}`;

    const confirmBtn = document.getElementById("confirmAppraisal");
    confirmBtn.dataset.bidId = bidId;
    confirmBtn.dataset.bidType = bidType;

    const modal = setupModal("appraisalModal");
    modal.show();
  }

  // 감정서 신청 처리
  async processAppraisalRequest() {
    const confirmBtn = document.getElementById("confirmAppraisal");
    const bidId = confirmBtn.dataset.bidId;
    const bidType = confirmBtn.dataset.bidType;

    try {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "처리 중...";

      const endpoint = bidType === "live" ? "live-bids" : "direct-bids";
      await API.fetchAPI(`/${endpoint}/${bidId}/request-appraisal`, {
        method: "POST",
      });

      alert("감정서 신청이 완료되었습니다.");

      const modal = setupModal("appraisalModal");
      modal.hide();

      // 데이터 새로고침
      await this.loadBidResultsData();
      if (this.currentSection === "bid-results") {
        this.renderBidResultsSection();
      } else if (this.currentSection === "dashboard") {
        this.renderDashboard();
      }
    } catch (error) {
      console.error("감정서 신청 실패:", error);
      alert("감정서 신청 중 오류가 발생했습니다.");
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "신청하기";
    }
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

      await API.fetchAPI(`/users/${this.userData.id}`, {
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
