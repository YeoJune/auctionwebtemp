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
      itemsPerPage: 7,
      totalItems: 0,
      totalPages: 0,
    };

    // bid-products.js 상태 복사
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

    // bid-results.js 상태 복사
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

    // bid-products.js 상수들 복사
    this.STATUS_TYPES = {
      ACTIVE: "active",
      FIRST: "first",
      SECOND: "second",
      FINAL: "final",
      COMPLETED: "completed",
      SHIPPED: "shipped",
      CANCELLED: "cancelled",
    };

    this.STATUS_GROUPS = {
      ACTIVE: ["active", "first", "second", "final"],
      COMPLETED: ["completed", "shipped"],
      CANCELLED: ["cancelled"],
      ALL: [
        "active",
        "first",
        "second",
        "final",
        "completed",
        "shipped",
        "cancelled",
      ],
    };

    this.STATUS_DISPLAY = {
      [this.STATUS_TYPES.ACTIVE]: "입찰 가능",
      [this.STATUS_TYPES.FIRST]: "1차 입찰",
      [this.STATUS_TYPES.SECOND]: "2차 제안",
      [this.STATUS_TYPES.FINAL]: "최종 입찰",
      [this.STATUS_TYPES.COMPLETED]: "낙찰 완료",
      [this.STATUS_TYPES.SHIPPED]: "출고됨",
      [this.STATUS_TYPES.CANCELLED]: "더 높은 입찰 존재",
    };

    this.STATUS_CLASSES = {
      [this.STATUS_TYPES.ACTIVE]: "status-active",
      [this.STATUS_TYPES.FIRST]: "status-first",
      [this.STATUS_TYPES.SECOND]: "status-second",
      [this.STATUS_TYPES.FINAL]: "status-final",
      [this.STATUS_TYPES.COMPLETED]: "status-completed",
      [this.STATUS_TYPES.SHIPPED]: "status-shipped",
      [this.STATUS_TYPES.CANCELLED]: "status-cancelled",
      "status-expired": "status-expired",
    };

    this.MINIMUM_FEE = 10000; // bid-results.js에서 복사
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
        BidManager.startTimerUpdates();
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

  // 입찰 항목 데이터 로드 (bid-products.js 로직 완전 복사)
  async loadBidItemsData() {
    try {
      const [liveBidsResponse, directBidsResponse] = await Promise.all([
        API.fetchAPI("/live-bids?limit=0"),
        API.fetchAPI("/direct-bids?limit=0"),
      ]);

      // 진행중인 입찰과 취소된 입찰 포함
      const liveBids = (liveBidsResponse.bids || [])
        .filter((bid) =>
          ["active", "first", "second", "final", "cancelled"].includes(
            bid.status
          )
        )
        .map((bid) => ({ ...bid, type: "live" }));

      const directBids = (directBidsResponse.bids || [])
        .filter((bid) => bid.status === "active" || bid.status === "cancelled")
        .map((bid) => ({ ...bid, type: "direct" }));

      // 데이터 타입 정보 추가
      const liveBidsWithType = liveBids.map((bid) => ({
        ...bid,
        type: "live",
        displayStatus: bid.status,
      }));

      const directBidsWithType = directBids.map((bid) => ({
        ...bid,
        type: "direct",
        displayStatus: bid.status,
      }));

      // 결합 결과 설정
      this.bidItemsData = [...liveBidsWithType, ...directBidsWithType].sort(
        (a, b) => new Date(b.updated_at) - new Date(a.updated_at)
      );

      // bid-products.js 상태도 업데이트
      this.bidProductsState.liveBids = liveBids;
      this.bidProductsState.directBids = directBids;
      this.bidProductsState.combinedResults = [
        ...liveBidsWithType,
        ...directBidsWithType,
      ];
      this.bidProductsState.filteredResults = this.bidItemsData;

      console.log(
        `입찰 항목 데이터 로드 완료: 총 ${this.bidItemsData.length}건`
      );
    } catch (error) {
      console.error("입찰 항목 데이터 로드 실패:", error);
      this.bidItemsData = [];
    }
  }

  // 입찰 결과 데이터 로드 (bid-results.js 로직 완전 복사)
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

      this.bidResultsData = [...liveBids, ...directBids];

      // bid-results.js 상태도 업데이트
      this.bidResultsState.combinedResults = this.bidResultsData;
      this.bidResultsState.isAdmin = window.AuthManager.isAdmin();

      // 일별로 그룹화 (bid-results.js 로직)
      this.groupResultsByDate();

      console.log(
        `입찰 결과 데이터 로드 완료: 총 ${this.bidResultsData.length}건`
      );
    } catch (error) {
      console.error("입찰 결과 데이터 로드 실패:", error);
      this.bidResultsData = [];
    }
  }

  // bid-results.js에서 완전 복사한 일별 그룹화 함수
  groupResultsByDate() {
    const groupedByDate = {};

    this.bidResultsData.forEach((item) => {
      const dateStr = formatDate(item.item?.scheduled_date);

      if (!groupedByDate[dateStr]) {
        groupedByDate[dateStr] = {
          date: dateStr,
          successItems: [],
          failedItems: [],
          pendingItems: [],
          itemCount: 0,
          totalJapanesePrice: 0,
          totalKoreanPrice: 0,
        };
      }

      // 상품 상태 분류
      const bidStatus = this.classifyBidStatus(item);

      // 이미지 경로 처리
      let imagePath = "/images/placeholder.png";
      if (item.item && item.item.image) {
        imagePath = item.item.image;
      }

      const itemData = {
        ...item,
        finalPrice: bidStatus.finalPrice,
        winningPrice: bidStatus.winningPrice,
        image: imagePath,
        appr_id: item.appr_id,
      };

      // 상태별로 분류
      if (bidStatus.status === "success") {
        const koreanPrice = Number(
          calculateTotalPrice(
            bidStatus.winningPrice,
            item.item?.auc_num || 1,
            item.item?.category || "기타"
          )
        );
        itemData.koreanPrice = koreanPrice;

        groupedByDate[dateStr].successItems.push(itemData);
        groupedByDate[dateStr].itemCount += 1;
        groupedByDate[dateStr].totalJapanesePrice += bidStatus.winningPrice;
        groupedByDate[dateStr].totalKoreanPrice += koreanPrice;
      } else if (bidStatus.status === "failed") {
        const koreanPrice = Number(
          calculateTotalPrice(
            bidStatus.winningPrice,
            item.item?.auc_num || 1,
            item.item?.category || "기타"
          )
        );
        itemData.koreanPrice = koreanPrice;
        groupedByDate[dateStr].failedItems.push(itemData);
      } else {
        groupedByDate[dateStr].pendingItems.push(itemData);
      }
    });

    // 객체를 배열로 변환
    this.bidResultsState.dailyResults = Object.values(groupedByDate);

    // 각 날짜별 totalItemCount 계산
    this.bidResultsState.dailyResults.forEach((day) => {
      day.totalItemCount =
        day.successItems.length +
        day.failedItems.length +
        day.pendingItems.length;

      // 일별 수수료 계산 (성공한 상품만)
      const calculatedFee = calculateFee(day.totalKoreanPrice);

      // 성공한 상품이 있는 경우만 최소 수수료 적용
      if (day.itemCount > 0) {
        day.feeAmount = Math.max(calculatedFee, this.MINIMUM_FEE);
      } else {
        day.feeAmount = 0; // 성공한 상품이 없으면 수수료 없음
      }

      day.vatAmount = Math.round((day.feeAmount / 1.1) * 0.1);

      // 일별 감정서 수수료 계산
      let dailyAppraisalCount = 0;
      day.successItems.forEach((item) => {
        if (item.appr_id) {
          dailyAppraisalCount++;
        }
      });

      day.appraisalFee = dailyAppraisalCount * 16500;
      day.appraisalVat = Math.round(day.appraisalFee / 11);
      day.appraisalCount = dailyAppraisalCount;

      // 총액에 감정서 수수료 포함
      day.grandTotal = day.totalKoreanPrice + day.feeAmount + day.appraisalFee;
    });

    this.sortDailyResults();
    this.updateTotalStats();
  }

  // bid-results.js에서 완전 복사
  sortDailyResults() {
    this.bidResultsState.dailyResults.sort((a, b) => {
      let valueA, valueB;

      // 정렬 기준에 따른 값 추출
      switch (this.bidResultsState.sortBy) {
        case "date":
          valueA = new Date(a.date);
          valueB = new Date(b.date);
          break;
        case "total_price":
          valueA = a.grandTotal;
          valueB = b.grandTotal;
          break;
        case "item_count":
          valueA = a.itemCount;
          valueB = b.itemCount;
          break;
        default:
          valueA = new Date(a.date);
          valueB = new Date(b.date);
          break;
      }

      // 정렬 방향 적용
      const direction = this.bidResultsState.sortOrder === "asc" ? 1 : -1;
      return direction * (valueA - valueB);
    });

    // 필터링된 결과 업데이트
    this.bidResultsState.filteredResults = [
      ...this.bidResultsState.dailyResults,
    ];
    this.bidResultsState.totalItems =
      this.bidResultsState.filteredResults.length;
    this.bidResultsState.totalPages = Math.ceil(
      this.bidResultsState.totalItems / this.bidResultsState.itemsPerPage
    );
  }

  // bid-results.js에서 완전 복사
  updateTotalStats() {
    // 초기화
    this.bidResultsState.totalStats = {
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
    };

    // 데일리 합계의 정확한 합산
    this.bidResultsState.dailyResults.forEach((day) => {
      this.bidResultsState.totalStats.itemCount += Number(day.itemCount || 0);
      this.bidResultsState.totalStats.totalItemCount += Number(
        day.totalItemCount || 0
      );
      this.bidResultsState.totalStats.japaneseAmount += Number(
        day.totalJapanesePrice || 0
      );
      this.bidResultsState.totalStats.koreanAmount += Number(
        day.totalKoreanPrice || 0
      );
      this.bidResultsState.totalStats.feeAmount += Number(day.feeAmount || 0);
      this.bidResultsState.totalStats.vatAmount += Number(day.vatAmount || 0);
      this.bidResultsState.totalStats.appraisalFee += Number(
        day.appraisalFee || 0
      );
      this.bidResultsState.totalStats.appraisalVat += Number(
        day.appraisalVat || 0
      );
      this.bidResultsState.totalStats.appraisalCount += Number(
        day.appraisalCount || 0
      );
    });

    // 총액 계산 (상품 총액 + 총 수수료 + 총 감정서 수수료)
    this.bidResultsState.totalStats.grandTotalAmount =
      this.bidResultsState.totalStats.koreanAmount +
      this.bidResultsState.totalStats.feeAmount +
      this.bidResultsState.totalStats.appraisalFee;
  }

  // bid-results.js에서 완전 복사
  classifyBidStatus(item) {
    const finalPrice =
      item.type === "direct"
        ? Number(item.current_price || 0)
        : Number(item.final_price || 0);
    const winningPrice = Number(item.winning_price || 0);

    if (!item.winning_price || winningPrice === 0) {
      return { status: "pending", finalPrice, winningPrice: null };
    }

    if (finalPrice >= winningPrice) {
      return { status: "success", finalPrice, winningPrice };
    } else {
      return { status: "failed", finalPrice, winningPrice };
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

  // 모달에서 입찰 정보 표시 (bid-products.js에서 완전 복사)
  displayBidInfoInModal(product, item) {
    const bidSection = document.querySelector(".bid-info-holder");
    if (!bidSection) return;

    // 현장 경매의 경우 입찰 단계에 따른 타이머 체크
    let timer, isScheduledPassed;

    if (product.type === "live") {
      if (product.first_price && !product.final_price) {
        timer = window.BidManager
          ? BidManager.getRemainingTime(item.scheduled_date, "final")
          : null;
      } else {
        timer = window.BidManager
          ? BidManager.getRemainingTime(item.scheduled_date, "first")
          : null;
      }
    } else {
      timer = window.BidManager
        ? BidManager.getRemainingTime(item.scheduled_date, "first")
        : null;
    }

    isScheduledPassed = !timer;

    // 마감되었거나 완료/취소 상태인 경우 읽기 전용 표시
    if (isScheduledPassed || product.displayStatus === "completed") {
      bidSection.innerHTML =
        '<div class="bid-status-message">입찰이 마감되었습니다.</div>';
      return;
    }

    // BidManager를 사용하여 입찰 폼 생성
    if (product.type === "direct") {
      const directBidInfo = this.bidProductsState.directBids.find(
        (b) => b.id === product.id
      );
      bidSection.innerHTML = window.BidManager
        ? BidManager.getDirectBidSectionHTML(
            directBidInfo,
            item.item_id,
            item.auc_num,
            item.category
          )
        : "";
    } else {
      const liveBidInfo = this.bidProductsState.liveBids.find(
        (b) => b.id === product.id
      );
      bidSection.innerHTML = window.BidManager
        ? BidManager.getLiveBidSectionHTML(
            liveBidInfo,
            item.item_id,
            item.auc_num,
            item.category
          )
        : "";
    }

    // 가격 계산기 초기화
    if (window.BidManager) {
      BidManager.initializePriceCalculators();
    }
  }

  // 입찰 항목 섹션 렌더링 (bid-products.js 로직 완전 복사)
  renderBidItemsSection() {
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

    // 먼저 데이터를 표시하고
    this.displayBidItems(currentPageData);

    // 페이지네이션은 나중에
    this.renderPagination(
      "bid-items-pagination",
      this.bidItemsPagination,
      (page) => this.handleBidItemsPageChange(page)
    );
  }

  // 입찰 항목 표시 (bid-products.js 템플릿 기반 렌더링 완전 복사)
  displayBidItems(products) {
    const container = document.getElementById("bid-items-list");
    if (!container) return;

    container.innerHTML = "";

    if (products.length === 0) {
      container.innerHTML =
        '<div class="no-results">표시할 상품이 없습니다.</div>';
      return;
    }

    products.forEach((product) => {
      const itemElement = this.renderBidResultItem(product);
      if (itemElement) {
        container.appendChild(itemElement);
      }
    });

    // BidManager 초기화 - bid-products.js와 동일한 순서와 방식으로 수정
    if (window.BidManager) {
      // 현재 데이터 업데이트
      BidManager.updateCurrentData(products.map((product) => product.item));

      // 입찰 데이터 업데이트
      BidManager.updateBidData(
        this.bidProductsState.liveBids,
        this.bidProductsState.directBids
      );

      // DOM 렌더링 완료 후 비동기적으로 초기화
      setTimeout(() => {
        if (window.BidManager) {
          BidManager.startTimerUpdates();
          BidManager.initializePriceCalculators();
        }
      }, 0);
    }
  }

  // 입찰 아이템 렌더링 (bid-products.js 템플릿 기반 완전 복사)
  renderBidResultItem(product) {
    const template = document.getElementById("bid-result-item-template");
    if (!template) {
      console.error("bid-result-item-template을 찾을 수 없습니다.");
      return null;
    }

    const item = product.item;
    if (!item) return null;

    const itemElement = template.content.cloneNode(true);
    const resultItem = itemElement.querySelector(".bid-result-item");

    // 데이터 속성 설정
    resultItem.dataset.itemId = item.item_id;
    resultItem.dataset.bidId = product.id;
    resultItem.dataset.bidType = product.type;

    // 데이터 바인딩
    this.bindDataFields(itemElement, product, item);

    // 조건부 요소 처리 (입찰 UI 포함)
    this.processConditionalElements(itemElement, product, item);

    // 이벤트 리스너 추가
    this.addItemEventListeners(resultItem, item);

    return itemElement;
  }

  // 데이터 필드 바인딩 (bid-products.js에서 완전 복사)
  bindDataFields(element, product, item) {
    // 이미지
    const img = element.querySelector('[data-field="image"]');
    if (img) {
      img.src = API.validateImageUrl(item.image);
      img.alt = item.title || "상품 이미지";
    }

    // 랭크
    const rank = element.querySelector('[data-field="rank"]');
    if (rank) rank.textContent = item.rank || "N";

    // 브랜드
    const brand = element.querySelector('[data-field="brand"]');
    if (brand) brand.textContent = item.brand || "-";

    // 제목
    const title = element.querySelector('[data-field="title"]');
    if (title) title.textContent = item.title || "제목 없음";

    // 카테고리
    const category = element.querySelector('[data-field="category"]');
    if (category) category.textContent = item.category || "-";

    // 경매 타입 표시
    const bidTypeEl = element.querySelector('[data-field="bid_type_display"]');
    if (bidTypeEl) {
      bidTypeEl.textContent =
        product.type === "live" ? "현장 경매" : "직접 경매";
      bidTypeEl.className = `bid-type ${
        product.type === "live" ? "live-type" : "direct-type"
      }`;
    }

    // 상태 표시
    const statusEl = element.querySelector('[data-field="status_display"]');
    if (statusEl) {
      const bidInfo = product.type === "live" ? product : null;
      const statusClass = this.getStatusClass(product, item);
      const statusText = this.getStatusDisplay(product, item);

      statusEl.textContent = statusText;
      statusEl.className = `status-badge ${statusClass}`;
    }

    // 업데이트 날짜
    const dateEl = element.querySelector('[data-field="updated_at"]');
    if (dateEl) dateEl.textContent = formatDateTime(product.updated_at);
  }

  // 조건부 요소 처리 (bid-products.js에서 완전 복사 - 입찰 UI 포함)
  processConditionalElements(element, product, item) {
    // 현장 경매의 경우 입찰 정보를 고려한 타이머 체크
    let timer, isExpired;
    if (product.type === "live") {
      if (product.first_price && !product.final_price) {
        timer = window.BidManager
          ? BidManager.getRemainingTime(item.scheduled_date, "final")
          : null;
      } else {
        timer = window.BidManager
          ? BidManager.getRemainingTime(item.scheduled_date, "first")
          : null;
      }
    } else {
      timer = window.BidManager
        ? BidManager.getRemainingTime(item.scheduled_date, "first")
        : null;
    }

    isExpired = !timer;

    const isActiveBid =
      (product.displayStatus === "active" ||
        product.displayStatus === "first" ||
        product.displayStatus === "second" ||
        product.displayStatus === "final" ||
        product.displayStatus === "cancelled") &&
      !isExpired;

    // 입찰 가능한 경우 bid-action 섹션 처리
    const bidActionEl = element.querySelector('[data-if="isActiveBid"]');
    if (bidActionEl) {
      if (isActiveBid) {
        bidActionEl.className = "bid-action expanded";

        let bidHtml = "";
        if (product.type === "direct") {
          const directBidInfo = this.bidProductsState.directBids.find(
            (b) => b.id === product.id
          );
          bidHtml = window.BidManager
            ? BidManager.getDirectBidSectionHTML(
                directBidInfo,
                item.item_id,
                item.auc_num,
                item.category
              )
            : "";
        } else {
          const liveBidInfo = this.bidProductsState.liveBids.find(
            (b) => b.id === product.id
          );
          bidHtml = window.BidManager
            ? BidManager.getLiveBidSectionHTML(
                liveBidInfo,
                item.item_id,
                item.auc_num,
                item.category
              )
            : "";
        }

        // BidManager HTML을 파싱하여 적절히 배치
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = bidHtml;

        const leftContent = document.createElement("div");
        leftContent.className = "bid-action-left";

        const rightContent = document.createElement("div");
        rightContent.className = "bid-input-container";

        // 타이머 요소
        const timerElement = tempDiv.querySelector(".bid-timer");
        if (timerElement) {
          leftContent.appendChild(timerElement);
        }

        // 가격 요소들
        const priceElements = tempDiv.querySelectorAll(
          ".real-time-price, .bid-price-info, .final-price"
        );
        priceElements.forEach((el) => {
          leftContent.appendChild(el);
        });

        // 입력 컨테이너
        const inputContainerSource = tempDiv.querySelector(
          ".bid-input-container"
        );
        if (inputContainerSource) {
          while (inputContainerSource.firstChild) {
            rightContent.appendChild(inputContainerSource.firstChild);
          }
        }

        bidActionEl.appendChild(leftContent);
        bidActionEl.appendChild(rightContent);
      } else {
        bidActionEl.remove();
      }
    }

    // 완료된 입찰의 경우 bid-info 섹션 처리
    const bidInfoEl = element.querySelector('[data-if="isCompletedBid"]');
    if (bidInfoEl) {
      if (!isActiveBid) {
        bidInfoEl.className = "bid-info";

        const auctionId = item.auc_num || 1;
        const category = item.category || "기타";
        let japanesePrice = 0;
        let bidInfoHTML = "";

        if (product.type === "direct") {
          japanesePrice = product.current_price || 0;
          bidInfoHTML += `
            <div class="price-row">
              <span class="price-label">입찰 금액:</span>
              <span class="price-value">${formatNumber(
                product.current_price
              )} ¥</span>
            </div>
          `;

          if (product.winning_price) {
            const winningKoreanPrice = calculateTotalPrice(
              product.winning_price,
              auctionId,
              category
            );
            bidInfoHTML += `
              <div class="price-row winning-price">
                <span class="price-label">낙찰 금액:</span>
                <span class="price-value">${formatNumber(
                  product.winning_price
                )} ¥</span>
              </div>
              <div class="price-row price-korean winning-price">
                <span class="price-label">관부가세 포함:</span>
                <span class="price-value">${formatNumber(
                  winningKoreanPrice
                )} ₩</span>
              </div>
            `;
          } else {
            bidInfoHTML += `
              <div class="price-row price-korean">
                <span class="price-label">관부가세 포함:</span>
                <span class="price-value">${formatNumber(
                  calculateTotalPrice(japanesePrice, auctionId, category)
                )} ₩</span>
              </div>
            `;
          }
        } else {
          bidInfoHTML += `<div class="price-stages">`;

          if (product.first_price) {
            bidInfoHTML += `
              <div class="price-row">
                <span class="price-label">1차 입찰:</span>
                <span class="price-value">${formatNumber(
                  product.first_price
                )} ¥</span>
              </div>
            `;
          }

          if (product.second_price) {
            bidInfoHTML += `
              <div class="price-row">
                <span class="price-label">2차 제안:</span>
                <span class="price-value">${formatNumber(
                  product.second_price
                )} ¥</span>
              </div>
            `;
          }

          if (product.final_price) {
            bidInfoHTML += `
              <div class="price-row">
                <span class="price-label">최종 입찰:</span>
                <span class="price-value">${formatNumber(
                  product.final_price
                )} ¥</span>
              </div>
            `;
          }

          bidInfoHTML += `</div>`;

          japanesePrice =
            product.final_price ||
            product.second_price ||
            product.first_price ||
            0;

          if (product.winning_price) {
            const winningKoreanPrice = calculateTotalPrice(
              product.winning_price,
              auctionId,
              category
            );
            bidInfoHTML += `
              <div class="price-row winning-price">
                <span class="price-label">낙찰 금액:</span>
                <span class="price-value">${formatNumber(
                  product.winning_price
                )} ¥</span>
              </div>
              <div class="price-row price-korean winning-price">
                <span class="price-label">관부가세 포함:</span>
                <span class="price-value">${formatNumber(
                  winningKoreanPrice
                )} ₩</span>
              </div>
            `;
          } else if (japanesePrice > 0) {
            bidInfoHTML += `
              <div class="price-row price-korean">
                <span class="price-label">관부가세 포함:</span>
                <span class="price-value">${formatNumber(
                  calculateTotalPrice(japanesePrice, auctionId, category)
                )} ₩</span>
              </div>
            `;
          }
        }

        bidInfoEl.innerHTML = bidInfoHTML;
      } else {
        bidInfoEl.remove();
      }
    }
  }

  // 아이템 이벤트 리스너 추가 (bid-products.js에서 완전 복사)
  addItemEventListeners(element, item) {
    element.addEventListener("click", (e) => {
      if (
        e.target.closest(".bid-action") ||
        e.target.closest(".bid-input-container") ||
        e.target.closest(".bid-button") ||
        e.target.closest(".quick-bid-btn") ||
        e.target.closest(".price-calculator") ||
        e.target.closest(".bid-input-group")
      ) {
        e.stopPropagation();
        return;
      }
      this.showProductDetails(item.item_id);
    });
  }

  // 상태 표시 텍스트 반환 (bid-products.js에서 완전 복사)
  getStatusDisplay(product, item) {
    const status = product.displayStatus || product.status;
    const scheduledDate = item.scheduled_date;
    const bidInfo = product.type === "live" ? product : null;

    const now = new Date();
    const scheduled = new Date(scheduledDate);

    if (
      status === this.STATUS_TYPES.ACTIVE ||
      status === this.STATUS_TYPES.FIRST ||
      status === this.STATUS_TYPES.SECOND ||
      status === this.STATUS_TYPES.FINAL
    ) {
      if (bidInfo?.first_price && !bidInfo?.final_price) {
        const deadline = new Date(scheduled);
        deadline.setHours(22, 0, 0, 0);
        if (now > deadline) {
          return "마감됨";
        }
      } else if (!bidInfo?.first_price) {
        if (now > scheduled) {
          return "마감됨";
        }
      }
    }

    return this.STATUS_DISPLAY[status] || "알 수 없음";
  }

  // 상태 클래스 반환 (bid-products.js에서 완전 복사)
  getStatusClass(product, item) {
    const status = product.displayStatus || product.status;
    const scheduledDate = item.scheduled_date;
    const bidInfo = product.type === "live" ? product : null;

    const now = new Date();
    const scheduled = new Date(scheduledDate);

    if (
      status === this.STATUS_TYPES.ACTIVE ||
      status === this.STATUS_TYPES.FIRST ||
      status === this.STATUS_TYPES.SECOND ||
      status === this.STATUS_TYPES.FINAL
    ) {
      if (bidInfo?.first_price && !bidInfo?.final_price) {
        const deadline = new Date(scheduled);
        deadline.setHours(22, 0, 0, 0);
        if (now > deadline) {
          return "status-expired";
        }
      } else if (!bidInfo?.first_price) {
        if (now > scheduled) {
          return "status-expired";
        }
      }
    }

    return this.STATUS_CLASSES[status] || "status-default";
  }

  // 입찰 결과 섹션 렌더링 (bid-results.js 로직 완전 복사)
  renderBidResultsSection() {
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

    this.displayBidResults(currentPageData);

    this.renderPagination(
      "bid-results-pagination",
      this.bidResultsPagination,
      (page) => this.handleBidResultsPageChange(page)
    );
  }

  // 입찰 결과 표시 (bid-results.js 일별 그룹화 로직 완전 복사)
  displayBidResults(dailyResults) {
    const container = document.getElementById("bid-results-list");
    if (!container) return;

    container.innerHTML = "";

    if (dailyResults.length === 0) {
      container.innerHTML =
        '<div class="no-results">조건에 맞는 입찰 결과가 없습니다.</div>';
      return;
    }

    // 일별 결과를 bid-results.js와 동일하게 표시
    dailyResults.forEach((dayResult) => {
      const dateRow = this.createDailyResultRow(dayResult);
      container.appendChild(dateRow);
    });

    // bid-products.js처럼 BidManager 초기화
    if (window.BidManager) {
      // 현재 표시되는 아이템들의 item 데이터 추출
      const currentItems = [];
      dailyResults.forEach((dayResult) => {
        if (dayResult.items) {
          dayResult.items.forEach((item) => {
            if (item.item) {
              currentItems.push(item.item);
            }
          });
        }
      });

      BidManager.updateCurrentData(currentItems);
      BidManager.updateBidData(
        this.bidProductsState.liveBids,
        this.bidProductsState.directBids
      );

      // DOM 렌더링 완료 후 비동기적으로 초기화
      setTimeout(() => {
        if (window.BidManager) {
          BidManager.initializePriceCalculators();
        }
      }, 0);
    }
  }

  // 일별 결과 행 생성 (bid-results.js에서 완전 복사)
  createDailyResultRow(dayResult) {
    const dateRow = createElement("div", "daily-result-item");

    // 날짜 헤더
    const dateHeader = createElement("div", "date-header");
    const dateLabel = createElement(
      "h3",
      "",
      this.formatDisplayDate(dayResult.date)
    );
    const toggleButton = createElement("button", "toggle-details");
    toggleButton.innerHTML = '<i class="fas fa-chevron-down"></i>';

    dateHeader.appendChild(dateLabel);
    dateHeader.appendChild(toggleButton);

    // 요약 정보
    const summary = this.createSummarySection(dayResult);

    // 상세 정보 (접혀있는 상태)
    const details = createElement("div", "date-details hidden");
    const detailsTable = this.createDetailsTable(dayResult);
    details.appendChild(detailsTable);

    // 토글 버튼 이벤트
    toggleButton.addEventListener("click", function () {
      const isExpanded = !details.classList.contains("hidden");
      if (isExpanded) {
        // 닫기: show 제거하고 hidden 추가
        details.classList.remove("show");
        details.classList.add("hidden");
      } else {
        // 열기: hidden 제거하고 show 추가
        details.classList.remove("hidden");
        details.classList.add("show");
      }
      this.innerHTML = isExpanded
        ? '<i class="fas fa-chevron-down"></i>'
        : '<i class="fas fa-chevron-up"></i>';
    });

    // 모두 조합
    dateRow.appendChild(dateHeader);
    dateRow.appendChild(summary);
    dateRow.appendChild(details);

    return dateRow;
  }

  // 요약 섹션 생성 (bid-results.js에서 복사)
  createSummarySection(dayResult) {
    const summary = createElement("div", "date-summary");

    const summaryItems = [
      {
        label: "상품 수",
        value: `${formatNumber(dayResult.itemCount)}/${formatNumber(
          dayResult.totalItemCount || 0
        )}개`,
      },
      {
        label: "총액 (¥)",
        value: `${formatNumber(dayResult.totalJapanesePrice)} ¥`,
      },
      {
        label: "관부가세 포함 (₩)",
        value: `${formatNumber(dayResult.totalKoreanPrice)} ₩`,
      },
      {
        label: "수수료 (₩)",
        value: `${formatNumber(dayResult.feeAmount)} ₩`,
        note: `VAT ${formatNumber(dayResult.vatAmount)} ₩`,
      },
      {
        label: "감정서 수수료 (₩)",
        value: `${formatNumber(dayResult.appraisalFee || 0)} ₩`,
        note: `VAT ${formatNumber(dayResult.appraisalVat || 0)} ₩`,
      },
      {
        label: "총액 (₩)",
        value: `${formatNumber(dayResult.grandTotal)} ₩`,
      },
    ];

    summaryItems.forEach((item) => {
      const summaryItem = createElement("div", "summary-item");
      const label = createElement("span", "summary-label", item.label + ":");
      const value = createElement("span", "summary-value", item.value);

      summaryItem.appendChild(label);
      summaryItem.appendChild(value);

      if (item.note) {
        const note = createElement("span", "vat-note", item.note);
        summaryItem.appendChild(note);
      }

      summary.appendChild(summaryItem);
    });

    return summary;
  }

  // 상세 테이블 생성 (bid-results.js에서 복사)
  createDetailsTable(dayResult) {
    const detailsTable = createElement("table", "details-table");

    const tableHeader = createElement("thead");
    tableHeader.innerHTML = `
    <tr>
      <th>이미지</th>
      <th>브랜드</th>
      <th>상품명</th>
      <th>최종입찰금액 (¥)</th>
      <th>실제낙찰금액 (¥)</th>
      <th>관부가세 포함 (₩)</th>
      <th>출고 여부</th>
      <th>감정서</th>
    </tr>
    `;
    detailsTable.appendChild(tableHeader);

    const tableBody = createElement("tbody");

    // 낙찰 성공 상품들 먼저 표시 (연한 초록 배경)
    dayResult.successItems?.forEach((item) => {
      const row = this.createItemRow(item, "success");
      tableBody.appendChild(row);
    });

    // 낙찰 실패 상품들 표시 (연한 빨간 배경)
    dayResult.failedItems?.forEach((item) => {
      const row = this.createItemRow(item, "failed");
      tableBody.appendChild(row);
    });

    // 집계중 상품들 표시 (기본 배경)
    dayResult.pendingItems?.forEach((item) => {
      const row = this.createItemRow(item, "pending");
      tableBody.appendChild(row);
    });

    detailsTable.appendChild(tableBody);
    return detailsTable;
  }

  // 상품 행 생성 함수 (bid-results.js에서 복사)
  createItemRow(item, status) {
    const row = createElement("tr");
    row.classList.add(`bid-${status}`);

    // 이미지 셀
    const imageCell = createElement("td");
    if (item.image && item.image !== "/images/placeholder.png") {
      const imageElement = createElement("img");
      imageElement.src = item.image;
      imageElement.alt = item.item?.title || "상품 이미지";
      imageElement.classList.add("product-thumbnail");
      imageElement.onerror = function () {
        const placeholder = createElement(
          "div",
          "product-thumbnail-placeholder",
          "No Image"
        );
        this.parentNode.replaceChild(placeholder, this);
      };
      imageCell.appendChild(imageElement);
    } else {
      const placeholder = createElement(
        "div",
        "product-thumbnail-placeholder",
        "No Image"
      );
      imageCell.appendChild(placeholder);
    }

    // 다른 셀들
    const brandCell = createElement("td", "", item.item?.brand || "-");
    const titleCell = createElement("td", "", item.item?.title || "제목 없음");
    const finalPriceCell = createElement(
      "td",
      "",
      `${formatNumber(item.finalPrice)} ¥`
    );

    const winningPriceCell = createElement("td");
    if (status === "pending") {
      winningPriceCell.textContent = "집계중";
      winningPriceCell.classList.add("pending-text");
    } else {
      winningPriceCell.textContent = `${formatNumber(item.winningPrice)} ¥`;
    }

    const koreanCell = createElement("td");
    if (status === "success") {
      koreanCell.textContent = `${formatNumber(item.koreanPrice)} ₩`;
    } else if (status === "failed") {
      koreanCell.textContent = `${formatNumber(item.koreanPrice)} ₩`;
    } else {
      koreanCell.textContent = "-";
    }

    // 출고 여부 셀
    const shippingCell = createElement("td");
    if (status === "success") {
      const shippingStatus = this.createShippingStatus(item);
      shippingCell.appendChild(shippingStatus);
    } else {
      shippingCell.textContent = "-";
    }

    // 감정서 셀
    const appraisalCell = createElement("td");
    if (status === "success") {
      const appraisalBtn = this.createAppraisalButton(item);
      appraisalCell.appendChild(appraisalBtn);
    } else {
      appraisalCell.textContent = "-";
    }

    // 모든 셀 추가
    [
      imageCell,
      brandCell,
      titleCell,
      finalPriceCell,
      winningPriceCell,
      koreanCell,
      shippingCell,
      appraisalCell,
    ].forEach((cell) => {
      row.appendChild(cell);
    });

    return row;
  }

  // 감정서 버튼 생성 (bid-results.js에서 복사)
  createAppraisalButton(item) {
    const button = createElement("button", "appraisal-btn small-button");

    if (item.appr_id) {
      button.textContent = "요청 완료";
      button.classList.add("success-button");
      button.onclick = () => {};
    } else {
      button.textContent = "감정서 신청";
      button.classList.add("primary-button");
      button.onclick = () => this.requestAppraisal(item);
    }

    return button;
  }

  // 출고 상태 생성 (bid-results.js에서 복사)
  createShippingStatus(item) {
    const statusSpan = createElement("span", "shipping-status");

    if (item.status === "shipped") {
      statusSpan.textContent = "출고됨";
      statusSpan.classList.add("status-shipped");
    } else if (item.status === "completed") {
      statusSpan.textContent = "출고 대기";
      statusSpan.classList.add("status-waiting");
    } else {
      statusSpan.textContent = "-";
      statusSpan.classList.add("status-none");
    }

    return statusSpan;
  }

  // 감정서 신청 처리 (bid-results.js에서 복사)
  async requestAppraisal(item) {
    if (
      confirm(
        "감정서를 신청하시겠습니까?\n수수료 16,500원(VAT포함)이 추가됩니다."
      )
    ) {
      try {
        toggleLoading(true);
        const endpoint = item.type === "direct" ? "direct-bids" : "live-bids";
        const response = await API.fetchAPI(
          `/${endpoint}/${item.id}/request-appraisal`,
          {
            method: "POST",
          }
        );

        if (response.message) {
          alert("감정서 신청이 완료되었습니다.");
          await this.loadBidResultsData();
          this.renderBidResultsSection();
        }
      } catch (error) {
        console.error("감정서 신청 중 오류:", error);
        alert("감정서 신청 중 오류가 발생했습니다.");
      } finally {
        toggleLoading(false);
      }
    }
  }

  // 표시용 날짜 포맷 (bid-results.js에서 완전 복사)
  formatDisplayDate(dateStr) {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const weekday = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];

    return `${year}년 ${month}월 ${day}일 (${weekday})`;
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

    // 상태 필터 적용 - displayStatus 사용
    if (this.bidItemsFilter.status === "active") {
      filtered = filtered.filter((bid) =>
        ["active", "first", "second", "final"].includes(bid.displayStatus)
      );
    } else if (this.bidItemsFilter.status === "completed") {
      filtered = filtered.filter((bid) =>
        ["completed", "shipped"].includes(bid.displayStatus)
      );
    } else if (this.bidItemsFilter.status === "cancelled") {
      filtered = filtered.filter((bid) => bid.displayStatus === "cancelled");
    } else if (this.bidItemsFilter.status === "highest") {
      // 현재 최고가 필터 (직접경매 + active 상태만)
      filtered = filtered.filter(
        (bid) =>
          bid.type === "direct" &&
          bid.displayStatus === "active" &&
          bid.current_price > 0
      );
    }

    return filtered;
  }

  // 입찰 결과 필터 적용
  applyBidResultsFilter() {
    let filtered = [...this.bidResultsState.dailyResults];

    // 타입 필터 적용
    if (this.bidResultsFilter.type === "live") {
      filtered = filtered.filter((dayResult) => {
        return [
          ...dayResult.successItems,
          ...dayResult.failedItems,
          ...dayResult.pendingItems,
        ].some((item) => item.type === "live");
      });
    } else if (this.bidResultsFilter.type === "direct") {
      filtered = filtered.filter((dayResult) => {
        return [
          ...dayResult.successItems,
          ...dayResult.failedItems,
          ...dayResult.pendingItems,
        ].some((item) => item.type === "direct");
      });
    }

    // 상태 필터 적용
    if (this.bidResultsFilter.status === "can_apply") {
      filtered = filtered.filter((dayResult) => {
        return dayResult.successItems.some((item) => !item.appr_id);
      });
    } else if (this.bidResultsFilter.status === "completed") {
      filtered = filtered.filter((dayResult) => {
        return [
          ...dayResult.successItems,
          ...dayResult.failedItems,
          ...dayResult.pendingItems,
        ].some((item) => item.status === "completed");
      });
    } else if (this.bidResultsFilter.status === "shipped") {
      filtered = filtered.filter((dayResult) => {
        return [
          ...dayResult.successItems,
          ...dayResult.failedItems,
          ...dayResult.pendingItems,
        ].some((item) => item.status === "shipped");
      });
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

  // 대시보드용 상태 클래스 반환
  getDashboardStatusClass(bid) {
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

    // 통계 카드 클릭 이벤트
    const activeCountEl = document.getElementById("active-count");
    if (activeCountEl) {
      activeCountEl.parentElement.style.cursor = "pointer";
      activeCountEl.parentElement.addEventListener("click", () => {
        this.showSection("bid-items");
        this.bidItemsFilter.status = "active";
        this.bidItemsFilter.type = "all";
        this.renderBidItemsSection();
        // 필터 UI도 업데이트
        this.updateFilterUI("bid-items", "all", "active");
      });
    }

    const higherBidCountEl = document.getElementById("higher-bid-count");
    if (higherBidCountEl) {
      higherBidCountEl.parentElement.style.cursor = "pointer";
      higherBidCountEl.parentElement.addEventListener("click", () => {
        this.showSection("bid-items");
        this.bidItemsFilter.status = "cancelled";
        this.bidItemsFilter.type = "direct";
        this.renderBidItemsSection();
        // 필터 UI도 업데이트
        this.updateFilterUI("bid-items", "direct", "cancelled");
      });
    }

    const currentHighestCountEl = document.getElementById(
      "current-highest-count"
    );
    if (currentHighestCountEl) {
      currentHighestCountEl.parentElement.style.cursor = "pointer";
      currentHighestCountEl.parentElement.addEventListener("click", () => {
        this.showSection("bid-items");
        this.bidItemsFilter.status = "highest";
        this.bidItemsFilter.type = "direct";
        this.renderBidItemsSection();
        // 필터 UI도 업데이트
        this.updateFilterUI("bid-items", "direct", "highest");
      });
    }

    const completedCountEl = document.getElementById("completed-count");
    if (completedCountEl) {
      completedCountEl.parentElement.style.cursor = "pointer";
      completedCountEl.parentElement.addEventListener("click", () => {
        this.showSection("bid-results");
      });
    }

    // 입찰 항목 필터 버튼 - 타입 필터 (첫 번째 그룹)
    document
      .querySelectorAll(
        "#bid-items-section .filter-group:first-child .filter-btn"
      )
      .forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const filter = e.target.dataset.filter;

          // 타입 필터 그룹 내에서 active 클래스 관리
          document
            .querySelectorAll(
              "#bid-items-section .filter-group:first-child .filter-btn"
            )
            .forEach((b) => b.classList.remove("active"));
          e.target.classList.add("active");

          this.bidItemsFilter.type = filter;
          this.bidItemsPagination.currentPage = 1;
          this.renderBidItemsSection();
        });
      });

    // 입찰 항목 필터 버튼 - 상태 필터 (두 번째 그룹)
    document
      .querySelectorAll(
        "#bid-items-section .filter-group:last-child .filter-btn"
      )
      .forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const filter = e.target.dataset.filter;

          // 상태 필터 그룹 내에서 active 클래스 관리
          document
            .querySelectorAll(
              "#bid-items-section .filter-group:last-child .filter-btn"
            )
            .forEach((b) => b.classList.remove("active"));
          e.target.classList.add("active");

          this.bidItemsFilter.status = filter;
          this.bidItemsPagination.currentPage = 1;
          this.renderBidItemsSection();
        });
      });

    // 입찰 결과 필터 버튼 - 타입 필터 (첫 번째 그룹)
    document
      .querySelectorAll(
        "#bid-results-section .filter-group:first-child .filter-btn"
      )
      .forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const filter = e.target.dataset.filter;

          // 타입 필터 그룹 내에서 active 클래스 관리
          document
            .querySelectorAll(
              "#bid-results-section .filter-group:first-child .filter-btn"
            )
            .forEach((b) => b.classList.remove("active"));
          e.target.classList.add("active");

          this.bidResultsFilter.type = filter;
          this.bidResultsPagination.currentPage = 1;
          this.renderBidResultsSection();
        });
      });

    // 입찰 결과 필터 버튼 - 상태 필터 (두 번째 그룹)
    document
      .querySelectorAll(
        "#bid-results-section .filter-group:last-child .filter-btn"
      )
      .forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const filter = e.target.dataset.filter;

          // 상태 필터 그룹 내에서 active 클래스 관리
          document
            .querySelectorAll(
              "#bid-results-section .filter-group:last-child .filter-btn"
            )
            .forEach((b) => b.classList.remove("active"));
          e.target.classList.add("active");

          this.bidResultsFilter.status = filter;
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

  // 필터 UI 업데이트 (통계 클릭 시 사용)
  updateFilterUI(section, type, status) {
    // 타입 필터 업데이트
    document
      .querySelectorAll(
        `#${section}-section .filter-group:first-child .filter-btn`
      )
      .forEach((btn) => {
        btn.classList.remove("active");
        if (btn.dataset.filter === type) {
          btn.classList.add("active");
        }
      });

    // 상태 필터 업데이트
    document
      .querySelectorAll(
        `#${section}-section .filter-group:last-child .filter-btn`
      )
      .forEach((btn) => {
        btn.classList.remove("active");
        if (btn.dataset.filter === status) {
          btn.classList.add("active");
        }
      });
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
