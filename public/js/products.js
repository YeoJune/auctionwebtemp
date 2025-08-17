// public/js/products.js

// 상품 페이지 설정
const productPageConfig = {
  type: "products",
  apiEndpoint: "/data",
  detailEndpoint: "/detail/item-details/",
  template: "product-card-template",

  features: {
    bidding: true,
    wishlist: true,
    realtime: true,
    adminEdit: false,
    auctionTypes: true,
    scheduledDates: true,
    bidItemsOnly: true,
    excludeExpired: true,
  },

  filters: {
    brands: "/data/brands-with-count",
    categories: "/data/categories",
    dates: "/data/scheduled-dates-with-count",
    ranks: "/data/ranks",
    aucNums: "/data/auc-nums",
  },

  initialState: {
    selectedBrands: [],
    selectedCategories: [],
    selectedDates: [],
    selectedRanks: [],
    selectedAucNums: [],
    selectedAuctionTypes: [],
    selectedFavoriteNumbers: [],
    sortBy: "scheduled_date",
    sortOrder: "asc",
    currentPage: 1,
    itemsPerPage: 20,
    totalItems: 0,
    totalPages: 0,
    searchTerm: "",
    wishlist: [],
    liveBidData: [],
    directBidData: [],
    currentData: [],
    images: [],
    currentImageIndex: 0,
    showBidItemsOnly: false,
    excludeExpired: true,
  },
};

// 위시리스트 관리
window.WishlistManager = (function () {
  let state = {};

  function init(initialState) {
    state = initialState;
  }

  /**
   * 위시리스트 토글
   */
  async function toggleWishlist(itemId, favoriteNumber) {
    if (
      !window.AuthManager.requireAuth(
        "위시리스트 기능을 사용하려면 로그인이 필요합니다."
      )
    ) {
      return;
    }

    try {
      const existingItem = state.wishlist.find(
        (w) => w.item_id == itemId && w.favorite_number == favoriteNumber
      );

      if (existingItem) {
        // 삭제
        await window.API.fetchAPI("/wishlist", {
          method: "DELETE",
          body: JSON.stringify({
            itemId: itemId.toString(),
            favoriteNumber,
          }),
        });

        // 상태 업데이트
        state.wishlist = state.wishlist.filter(
          (w) => w.item_id != itemId || w.favorite_number !== favoriteNumber
        );
      } else {
        // 추가
        await window.API.fetchAPI("/wishlist", {
          method: "POST",
          body: JSON.stringify({
            itemId: itemId.toString(),
            favoriteNumber,
          }),
        });

        // 같은 아이템의 같은 번호가 있으면 제거 (중복 방지)
        state.wishlist = state.wishlist.filter(
          (w) => w.item_id != itemId || w.favorite_number !== favoriteNumber
        );

        // 새 항목 추가
        state.wishlist.push({
          item_id: itemId,
          favorite_number: favoriteNumber,
        });
      }

      updateWishlistUI(itemId);
    } catch (error) {
      alert(`위시리스트 업데이트 중 오류가 발생했습니다: ${error.message}`);
    }
  }

  /**
   * 위시리스트 UI 업데이트
   */
  function updateWishlistUI(itemId) {
    // 카드의 위시리스트 버튼 업데이트
    const card = document.querySelector(
      `.product-card[data-item-id="${itemId}"]`
    );
    if (card) {
      const wishlistBtns = card.querySelectorAll(".wishlist-btn");

      wishlistBtns.forEach((btn) => {
        const favoriteNumber = parseInt(btn.dataset.favorite);

        const isActive = state.wishlist.some(
          (w) => w.item_id == itemId && w.favorite_number === favoriteNumber
        );

        btn.classList.toggle("active", isActive);
      });
    }
  }

  return {
    init,
    toggleWishlist,
    updateWishlistUI,
  };
})();

// 상품 페이지 특화 렌더링
window.ProductRenderer = (function () {
  /**
   * 상품 카드 후처리 (템플릿 렌더링 후)
   */
  function postProcessCard(card, item) {
    // 위시리스트 버튼 설정
    setupWishlistButtons(card, item);

    // 입찰 관련 UI 설정
    if (productPageConfig.features.bidding) {
      setupBidUI(card, item);
    }

    // 타이머 설정
    setupTimer(card, item);

    // 가격 정보 설정
    setupPriceInfo(card, item);
  }

  /**
   * 위시리스트 버튼 설정
   */

  function setupWishlistButtons(card, item) {
    const wishlistButtons = card.querySelector(".wishlist-buttons");
    if (!wishlistButtons) return;

    const state = window.ProductListController.getState();

    const isActive1 = state.wishlist.some(
      (w) => w.item_id == item.item_id && w.favorite_number === 1
    );
    const isActive2 = state.wishlist.some(
      (w) => w.item_id == item.item_id && w.favorite_number === 2
    );
    const isActive3 = state.wishlist.some(
      (w) => w.item_id == item.item_id && w.favorite_number === 3
    );

    // 버튼 HTML 생성
    wishlistButtons.innerHTML = `
    <button class="wishlist-btn ${isActive1 ? "active" : ""}" data-favorite="1" 
            onclick="event.stopPropagation(); window.WishlistManager.toggleWishlist('${
              item.item_id
            }', 1)">
      즐겨찾기①
    </button>
    <button class="wishlist-btn ${isActive2 ? "active" : ""}" data-favorite="2" 
            onclick="event.stopPropagation(); window.WishlistManager.toggleWishlist('${
              item.item_id
            }', 2)">
      즐겨찾기②
    </button>
    <button class="wishlist-btn ${isActive3 ? "active" : ""}" data-favorite="3" 
            onclick="event.stopPropagation(); window.WishlistManager.toggleWishlist('${
              item.item_id
            }', 3)">
      즐겨찾기③
    </button>
  `;
  }

  /**
   * 입찰 UI 설정
   */
  function setupBidUI(card, item) {
    const bidSection = card.querySelector(".bid-section");
    if (!bidSection) {
      console.error("bid-section을 찾을 수 없습니다:", card);
      return;
    }

    if (!window.BidManager) {
      console.error("BidManager가 로드되지 않았습니다");
      return;
    }

    const state = window.ProductListController.getState();

    // 입찰 정보 찾기
    const liveBidInfo = state.liveBidData.find(
      (b) => b.item_id == item.item_id
    );
    const directBidInfo = state.directBidData.find(
      (b) => b.item_id == item.item_id
    );

    console.log("입찰 UI 설정:", {
      item_id: item.item_id,
      bid_type: item.bid_type,
      liveBidInfo,
      directBidInfo,
      bidSection,
    });

    // 입찰 섹션 HTML 생성
    try {
      if (item.bid_type === "direct") {
        bidSection.innerHTML = window.BidManager.getDirectBidSectionHTML(
          directBidInfo,
          item.item_id,
          item.auc_num,
          item.category,
          { showTimer: false } // 카드에서는 타이머 표시하지 않음
        );
      } else {
        bidSection.innerHTML = window.BidManager.getLiveBidSectionHTML(
          liveBidInfo,
          item.item_id,
          item.auc_num,
          item.category,
          { showTimer: false } // 카드에서는 타이머 표시하지 않음
        );
      }
      console.log("입찰 UI 생성 완료:", item.item_id);
    } catch (error) {
      console.error("입찰 UI 생성 실패:", error);
      bidSection.innerHTML = '<div class="bid-error">입찰 UI 로드 실패</div>';
    }
  }

  /**
   * 타이머 설정
   */
  function setupTimer(card, item) {
    const timerElement = card.querySelector(".bid-timer");
    if (!timerElement || !item.scheduled_date) return;

    // 타이머 초기 설정
    updateTimer(timerElement, item);
  }

  /**
   * 타이머 업데이트
   */
  function updateTimer(timerElement, item) {
    if (!window.BidManager) return;

    const state = window.ProductListController.getState();

    // 경매 타입에 따라 적절한 입찰 정보 가져오기
    let bidInfo = null;
    let bidStage = "first";
    let timerText = "입찰마감";

    if (item.bid_type === "live") {
      // 현장 경매
      bidInfo = state.liveBidData.find((b) => b.item_id == item.item_id);

      if (bidInfo?.first_price && !bidInfo?.final_price) {
        // 1차 입찰 완료, 최종 입찰 대기 중
        bidStage = "final";
        timerText = "최종입찰마감";
      } else if (!bidInfo?.first_price) {
        // 1차 입찰 전
        bidStage = "first";
        timerText = "1차입찰마감";
      } else {
        // 최종 입찰 완료
        timerText = "입찰완료";
      }
    } else {
      // 직접 경매 - 항상 first 단계만
      bidInfo = state.directBidData.find((b) => b.item_id == item.item_id);
      bidStage = "first";
      timerText = "입찰마감";
    }

    const timer = window.BidManager.getRemainingTime(
      item.scheduled_date,
      bidStage
    );
    const isNearEnd = timer?.isNearEnd;
    const timeText = timer ? timer.text : "--:--:--";

    // 날짜 및 시간 표시
    const formattedDateTime = formatDateTime(item.scheduled_date);

    // 타이머 클래스 업데이트
    timerElement.className = `bid-timer ${isNearEnd ? "near-end" : ""}${
      !timer ? " expired" : ""
    }`;

    // 타이머 내용 업데이트
    const scheduledDateEl = timerElement.querySelector(".scheduled-date");
    const remainingTimeEl = timerElement.querySelector(".remaining-time");

    if (scheduledDateEl) {
      scheduledDateEl.textContent = `${formattedDateTime} 마감`;
    }

    if (remainingTimeEl) {
      if (timer) {
        remainingTimeEl.textContent = `[${timeText}]`;
      } else {
        remainingTimeEl.textContent = "[마감됨]";
      }
    }
  }

  /**
   * 가격 정보 설정
   */
  function setupPriceInfo(card, item) {
    const state = window.ProductListController.getState();

    // 입찰 정보 찾기
    const liveBidInfo = state.liveBidData.find(
      (b) => b.item_id == item.item_id
    );
    const directBidInfo = state.directBidData.find(
      (b) => b.item_id == item.item_id
    );

    // 현재 가격 계산
    const live_price =
      item.bid_type == "direct" &&
      directBidInfo?.current_price &&
      Number(directBidInfo.current_price) > Number(item.starting_price)
        ? directBidInfo.current_price
        : item.starting_price;

    // 가격 표시 업데이트
    const priceValueEl = card.querySelector(
      ".info-cell:nth-child(2) .info-value"
    );
    const priceDetailEl = card.querySelector(
      ".info-cell:nth-child(2) .info-price-detail"
    );

    if (priceValueEl) {
      priceValueEl.innerHTML = `${cleanNumberFormat(live_price || 0)}¥`;
    }

    if (priceDetailEl && live_price) {
      priceDetailEl.textContent = `관부가세 포함 ${cleanNumberFormat(
        calculateTotalPrice(live_price, item.auc_num, item.category)
      )}원`;
    }

    // 세 번째 칸 (입찰/제안 정보) 업데이트
    const thirdCellValue = card.querySelector(
      ".info-cell:nth-child(3) .info-value"
    );
    const thirdCellDetail = card.querySelector(
      ".info-cell:nth-child(3) .info-price-detail"
    );

    if (thirdCellValue) {
      let thirdValue = "-";
      let thirdDetail = "";

      if (item.bid_type === "direct" && directBidInfo?.current_price) {
        thirdValue = `${cleanNumberFormat(directBidInfo.current_price)}¥`;
        thirdDetail = `관부가세 포함 ${cleanNumberFormat(
          calculateTotalPrice(
            directBidInfo.current_price,
            item.auc_num,
            item.category
          )
        )}원`;
      } else if (item.bid_type === "live" && liveBidInfo?.second_price) {
        thirdValue = `${cleanNumberFormat(liveBidInfo.second_price)}¥`;
        thirdDetail = `관부가세 포함 ${cleanNumberFormat(
          calculateTotalPrice(
            liveBidInfo.second_price,
            item.auc_num,
            item.category
          )
        )}원`;
      }

      thirdCellValue.textContent = thirdValue;
      if (thirdCellDetail) {
        thirdCellDetail.textContent = thirdDetail;
      }
    }

    // 더 높은 입찰 알림 (직접 경매)
    if (item.bid_type === "direct") {
      const myBidPrice = directBidInfo?.current_price || 0;
      const hasHigherBid =
        Number(live_price) > Number(myBidPrice) && myBidPrice > 0;

      const header = card.querySelector(".product-header .product-brand");
      if (header && hasHigherBid) {
        if (!header.querySelector(".higher-bid-alert")) {
          const alertDiv = createElement(
            "div",
            "higher-bid-alert",
            "더 높은 입찰 존재"
          );
          header.appendChild(alertDiv);
        }
      } else if (header) {
        const existingAlert = header.querySelector(".higher-bid-alert");
        if (existingAlert) {
          existingAlert.remove();
        }
      }
    }
  }

  return {
    postProcessCard,
    updateTimer,
  };
})();

// 실시간 업데이트 매니저
window.RealtimeManager = (function () {
  let socket = null;

  /**
   * Socket.IO 초기화
   */
  function initializeSocket() {
    if (typeof io === "undefined") {
      console.warn("Socket.IO not available");
      return null;
    }

    socket = io({
      reconnectionAttempts: 5,
      timeout: 10000,
    });

    socket.on("connect_error", (error) => {
      console.error("Socket connection error:", error);
      setupFallbackPolling();
    });

    // 데이터 업데이트 이벤트 수신
    socket.on("data-updated", (data) => {
      console.log(`업데이트 알림: ${data.itemIds.length}개 아이템`);

      // 현재 화면에 표시된 아이템과 업데이트된 아이템 비교
      const state = window.ProductListController.getState();
      const visibleItemIds = state.currentData.map((item) => item.item_id);
      const itemsToUpdate = data.itemIds.filter((id) =>
        visibleItemIds.includes(id)
      );

      if (itemsToUpdate.length > 0) {
        window.ProductListController.debouncedFetchData(false);
      }
    });

    socket.on("connect", () => {
      console.log("서버에 연결됨");
    });

    socket.on("disconnect", () => {
      console.log("서버 연결 해제됨");
    });

    return socket;
  }

  /**
   * 폴백 폴링 설정
   */
  function setupFallbackPolling() {
    // Socket 연결 실패 시 주기적 폴링
    setInterval(() => {
      if (window.ProductListController) {
        window.ProductListController.debouncedFetchData(false);
      }
    }, 30000); // 30초마다
  }

  return {
    initializeSocket,
  };
})();

// 상품 페이지 특화 기능 확장
const ProductPageExtensions = {
  /**
   * 커스텀 카드 렌더링 (템플릿 렌더링 후 호출됨)
   */
  customizeCard(card, item) {
    // ProductRenderer를 통한 후처리
    window.ProductRenderer.postProcessCard(card, item);

    return card;
  },

  /**
   * 커스텀 모달 초기화
   */
  customizeModal(item) {
    // 입찰 정보 초기화
    initializeBidInfo(item.item_id, item);
  },

  /**
   * 페이지별 이벤트 설정
   */
  setupCustomEvents() {
    // 입찰 성공 이벤트 리스너
    window.addEventListener("bidSuccess", function () {
      window.ProductListController.fetchData(); // 데이터 새로고침
    });
  },
};

/**
 * 입찰 정보 초기화 (모달용)
 */
function initializeBidInfo(itemId, item = null) {
  if (!item) {
    const state = window.ProductListController.getState();
    item = state.currentData.find((i) => i.item_id == itemId);
  }

  const bidSection = document.querySelector(".modal-content .bid-info-holder");

  if (!bidSection || !item || !window.BidManager) return;

  const state = window.ProductListController.getState();

  // 경매 타입에 따라 다른 입찰 섹션 표시 (모달에서는 타이머 표시)
  if (item.bid_type === "direct") {
    const directBidInfo = state.directBidData.find((b) => b.item_id == itemId);
    bidSection.innerHTML = window.BidManager.getDirectBidSectionHTML(
      directBidInfo,
      itemId,
      item.auc_num,
      item.category
      // 옵션을 전달하지 않으면 기본값 { showTimer: true }가 사용됨
    );
  } else {
    const liveBidInfo = state.liveBidData.find((b) => b.item_id == itemId);
    bidSection.innerHTML = window.BidManager.getLiveBidSectionHTML(
      liveBidInfo,
      itemId,
      item.auc_num,
      item.category
      // 옵션을 전달하지 않으면 기본값 { showTimer: true }가 사용됨
    );
  }

  // 가격 계산기 초기화
  if (window.BidManager.initializePriceCalculators) {
    window.BidManager.initializePriceCalculators();
  }
}

/**
 * 툴팁 시스템 설정
 */
function setupTooltips() {
  if (!window.TooltipManager) return;

  window.TooltipManager.clearConditionalTooltips();

  // 기존 툴팁들
  setupExistingTooltips();

  // 새로운 툴팁들
  setupNewTooltips();

  console.log("상품 페이지 툴팁 시스템 설정 완료");
}

/**
 * 기존 툴팁 설정
 */
function setupExistingTooltips() {
  // 타이머 정보 아이콘 (에코옥션, 스타옥션만)
  window.TooltipManager.registerConditionalTooltip(
    ".timer-info-icon",
    (element) => {
      const itemId = getItemIdFromElement(element);
      const state = window.ProductListController.getState();
      const item = state.currentData.find((item) => item.item_id == itemId);
      return item && (item.auc_num == 1 || item.auc_num == 3);
    },
    () =>
      "마감 전 5분 입찰 발생 시\n5분씩 자동 연장\n\n추가 입찰 없을 시\n마지막 입찰 금액 낙찰",
    "top"
  );

  // 스타옥션 입찰 정보
  window.TooltipManager.registerConditionalTooltip(
    ".quick-bid-buttons.star-auction .bid-info-tooltip-trigger",
    (element) => {
      const itemId = getItemIdFromElement(element);
      const state = window.ProductListController.getState();
      const item = state.currentData.find((item) => item.item_id == itemId);
      return item && item.auc_num == 3;
    },
    () => "해당 상품은 금액대별 최소금액으로 입찰됩니다.",
    "top"
  );
}

/**
 * 새로운 툴팁 설정
 */
function setupNewTooltips() {
  // 관부가세 포함 금액 설명
  window.TooltipManager.registerConditionalTooltip(
    '.tooltip-icon[data-tooltip="price-detail"]',
    () => true,
    () =>
      "까사트레이드 수수료를 제외한 모든 비용\n(관부가세, 출품사수수료, 현지세금)이\n반영된 실시간 원화 금액입니다.",
    "top"
  );

  // 직접경매 실시간 금액 설명
  window.TooltipManager.registerConditionalTooltip(
    '.tooltip-icon[data-tooltip="direct-realtime"]',
    () => true,
    () => "실시간 경쟁 입찰가입니다.\n마감이 가까울수록 급변할 수 있습니다.",
    "top"
  );

  // 현장경매 시작 금액 설명
  window.TooltipManager.registerConditionalTooltip(
    '.tooltip-icon[data-tooltip="live-starting"]',
    () => true,
    () =>
      "표시 금액은 사전입찰 시작가이며,\n실제 현장 낙찰가는 경합 정도에 따라\n크게 달라질 수 있습니다.",
    "top"
  );
}

/**
 * 요소에서 아이템 ID 추출
 */
function getItemIdFromElement(element) {
  const card =
    element.closest(".product-card") || element.closest(".modal-content");
  if (!card) return null;

  return (
    card.dataset?.itemId ||
    card.querySelector("[data-item-id]")?.dataset?.itemId ||
    card.querySelector(".modal-title")?.dataset?.itemId
  );
}

// 입찰 로딩 UI (전역 유틸리티)
window.bidLoadingUI = {
  showBidLoading: function (buttonElement) {
    // 기존 버튼 텍스트 저장
    buttonElement.dataset.originalText = buttonElement.textContent;

    // 로딩 아이콘 추가
    buttonElement.innerHTML = '<span class="spinner"></span> 처리 중...';
    buttonElement.disabled = true;
    buttonElement.classList.add("loading");
  },

  hideBidLoading: function (buttonElement) {
    // 원래 텍스트로 복원
    buttonElement.textContent =
      buttonElement.dataset.originalText || "입찰하기";
    buttonElement.disabled = false;
    buttonElement.classList.remove("loading");
  },
};

// 페이지 초기화
function initializeProductPage() {
  console.log("상품 페이지 초기화 시작");

  // BidManager 먼저 초기화
  if (window.BidManager) {
    console.log("BidManager 초기화");
    window.BidManager.initialize(false, []); // 인증 상태는 AuthManager가 처리
    window.BidManager.setAuthStatus(window.AuthManager.isAuthenticated());
  } else {
    console.error("BidManager를 찾을 수 없습니다");
  }

  // 설정 확장
  productPageConfig.customizeCard = ProductPageExtensions.customizeCard;
  productPageConfig.customizeModal = ProductPageExtensions.customizeModal;

  // WishlistManager 초기화
  window.WishlistManager.init(productPageConfig.initialState);

  // 실시간 업데이트 초기화
  if (productPageConfig.features.realtime) {
    window.RealtimeManager.initializeSocket();
  }

  // 커스텀 이벤트 설정
  ProductPageExtensions.setupCustomEvents();

  // 툴팁 설정
  setupTooltips();

  console.log("ProductListController 초기화 시작");
  // ProductListController 초기화 (마지막에)
  window.ProductListController.init(productPageConfig);
}

// 윈도우 로드 시 초기화
window.addEventListener("load", function () {
  initializeProductPage();
});

// 페이지를 나갈 때 정리
window.addEventListener("beforeunload", function () {
  if (window.timerInterval) {
    clearInterval(window.timerInterval);
  }
});

// 전역 함수로 노출 (HTML에서 호출용)
window.toggleWishlist = function (itemId, favoriteNumber) {
  window.WishlistManager.toggleWishlist(itemId, favoriteNumber);
};

window.showDetails = function (itemId) {
  window.ProductListController.showDetails(itemId);
};
