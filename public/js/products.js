// public/js/products.js

// 상태 관리
window.state = {
  selectedBrands: [],
  selectedCategories: [],
  selectedDates: [],
  selectedRanks: [],
  selectedAucNums: [],
  selectedAuctionTypes: [], // 경매 유형 필터
  sortBy: "scheduled_date", // 정렬 기준 필드 (기본값: 마감일)
  sortOrder: "asc", // 정렬 방향 (기본값: 오름차순)
  currentPage: 1,
  itemsPerPage: 20,
  totalItems: 0,
  totalPages: 0,
  searchTerm: "",
  wishlist: [], // [{ item_id: "123", favorite_number: 1 }, ...]
  liveBidData: [], // 현장 경매 입찰 데이터
  directBidData: [], // 직접 경매 입찰 데이터
  currentData: [],
  images: [],
  currentImageIndex: 0,
  isAuthenticated: false,
  selectedFavoriteNumbers: [], // 선택된 즐겨찾기 번호 [1, 2, 3]
  showBidItemsOnly: false, // 입찰 항목만 표시 여부
};

let fetchDataDebounceTimer = null;
function debouncedFetchData(showLoading = false) {
  if (fetchDataDebounceTimer) clearTimeout(fetchDataDebounceTimer);
  fetchDataDebounceTimer = setTimeout(() => {
    fetchData(showLoading);
  }, 300); // 300ms 내에 추가 요청은 무시
}

function initializeSocket() {
  const socket = io({
    reconnectionAttempts: 5,
    timeout: 10000,
  });

  socket.on("connect_error", (error) => {
    console.error("Socket connection error:", error);
    // 폴백 방식으로 일정 주기 폴링 활성화
    setupFallbackPolling();
  });

  // 데이터 업데이트 이벤트 수신
  socket.on("data-updated", (data) => {
    console.log(
      `Received update notification for ${data.itemIds.length} items`
    );

    // 현재 화면에 표시된 아이템과 업데이트된 아이템 비교
    const visibleItemIds = state.currentData.map((item) => item.item_id);
    const itemsToUpdate = data.itemIds.filter((id) =>
      visibleItemIds.includes(id)
    );

    if (itemsToUpdate.length > 0) {
      debouncedFetchData(false);
    }
  });

  socket.on("connect", () => {
    console.log("Connected to server");
  });

  socket.on("disconnect", () => {
    console.log("Disconnected from server");
  });

  return socket;
}

// 데이터 표시 함수
function displayData(data) {
  const dataBody = document.getElementById("dataBody");
  if (!dataBody) return;

  state.currentData = data;
  dataBody.innerHTML = "";

  if (!data || data.length === 0) {
    dataBody.innerHTML = "<p>선택한 필터에 맞는 항목이 없습니다.</p>";
    return;
  }

  data.forEach((item) => {
    const card = createProductCard(item);
    dataBody.appendChild(card);
  });

  // BidManager에 현재 데이터 전달
  BidManager.updateCurrentData(state.currentData);

  // 가격 계산기 초기화
  BidManager.initializePriceCalculators();

  // 타이머 업데이트 시작
  BidManager.startTimerUpdates();
}

// 제품 카드 생성
function createProductCard(item) {
  const card = createElement("div", "product-card");
  card.dataset.itemId = item.item_id;
  card.dataset.bidType = item.bid_type || "live"; // 기본값은 live

  // 위시리스트 확인 (번호별)
  const wishlistItem = state.wishlist.find((w) => w.item_id == item.item_id);
  const favoriteNumber = wishlistItem ? wishlistItem.favorite_number : null;

  // 입찰 데이터 찾기
  const liveBidInfo = state.liveBidData.find((b) => b.item_id == item.item_id);
  const directBidInfo = state.directBidData.find(
    (b) => b.item_id == item.item_id
  );

  // 경매 타입에 따라 다른 템플릿 사용
  if (item.bid_type === "direct") {
    card.innerHTML = getDirectCardHTML(item, directBidInfo, favoriteNumber);
  } else {
    card.innerHTML = getLiveCardHTML(item, liveBidInfo, favoriteNumber);
  }

  card.addEventListener("click", (event) => {
    if (
      !event.target.closest(".bid-input-group") &&
      !event.target.closest(".quick-bid-buttons") &&
      !event.target.closest(".wishlist-btn") &&
      !event.target.classList.contains("bid-button") &&
      !event.target.classList.contains("quick-bid-btn")
    ) {
      showDetails(item.item_id);
    }
  });

  return card;
}

// 현장 경매 카드 HTML
function getLiveCardHTML(item, bidInfo, favoriteNumber) {
  // 타이머 정보
  const timer = BidManager.getRemainingTime(item.scheduled_date);
  const isNearEnd = timer?.isNearEnd;
  const timerText = timer ? timer.text : "--:--:--";

  // 날짜 및 시간 표시
  const formattedDateTime = formatDateTime(item.scheduled_date);

  // direct이고 current_price가 starting_price보다 큰 경우에만 current_price 이외에는 starting_price 표시
  const live_price =
    item.bid_type == "direct" &&
    bidInfo?.current_price &&
    Number(bidInfo.current_price) > Number(item.starting_price)
      ? bidInfo.current_price
      : item.starting_price;

  return `
    <div class="product-header">
      <div class="product-brand">${item.brand}</div>
      <div class="product-title">${item.title}</div>
      <div class="auction-info">
      <div class="auction-number">
    ${item.auc_num}<span>번</span>
    <div class="auction-type-indicator">${
      item.bid_type === "direct" ? "직접" : "현장"
    }</div>
  </div>
      </div>
    </div>
    <div class="bid-timer ${isNearEnd ? "near-end" : ""}">
      <span class="scheduled-date">${formattedDateTime} 마감</span>
      <span class="remaining-time">[${timerText}]</span>
    </div>
    <div class="product-image-container">
      <img src="${API.validateImageUrl(item.image)}" alt="${
    item.title
  }" class="product-image">
      <div class="product-rank">${item.rank || "N"}</div>
    </div>
    
    <div class="wishlist-buttons">
  <button class="wishlist-btn ${
    favoriteNumber === 1 ? "active" : ""
  }" data-favorite="1" 
          onclick="event.stopPropagation(); toggleWishlist('${
            item.item_id
          }', 1)">
    즐겨찾기①
  </button>
  <button class="wishlist-btn ${
    favoriteNumber === 2 ? "active" : ""
  }" data-favorite="2" 
          onclick="event.stopPropagation(); toggleWishlist('${
            item.item_id
          }', 2)">
    즐겨찾기②
  </button>
  <button class="wishlist-btn ${
    favoriteNumber === 3 ? "active" : ""
  }" data-favorite="3" 
          onclick="event.stopPropagation(); toggleWishlist('${
            item.item_id
          }', 3)">
    즐겨찾기③
  </button>
</div>
    
    <!-- 3칸 정보 -->
    <div class="product-info-grid">
  <div class="info-cell">
    <div class="info-label">랭크</div>
    <div class="info-value">${item.rank || "N"}</div>
  </div>
  <div class="info-cell">
    <div class="info-label">시작 금액</div>
    <div class="info-value">${cleanNumberFormat(live_price || 0)}￥</div>
    <div class="info-price-detail">
      ${cleanNumberFormat(
        calculateTotalPrice(live_price, item.auc_num, item.category)
      )}원
    </div>
  </div>
  <div class="info-cell">
    <div class="info-label">${
      item.bid_type === "direct" ? "나의 입찰" : "2차 제안"
    }</div>
    <div class="info-value">${
      item.bid_type === "direct" && bidInfo?.current_price
        ? cleanNumberFormat(bidInfo.current_price) + "￥"
        : item.bid_type === "live" && bidInfo?.second_price
        ? cleanNumberFormat(bidInfo.second_price) + "￥"
        : "-"
    }</div>
    <div class="info-price-detail">
      ${
        item.bid_type === "direct" && bidInfo?.current_price
          ? cleanNumberFormat(
              calculateTotalPrice(
                bidInfo.current_price,
                item.auc_num,
                item.category
              )
            ) + "원"
          : item.bid_type === "live" && bidInfo?.second_price
          ? cleanNumberFormat(
              calculateTotalPrice(
                bidInfo.second_price,
                item.auc_num,
                item.category
              )
            ) + "원"
          : ""
      }
    </div>
  </div>
</div>
</div>
    <div class="bid-section">
      <div class="price-info">
        ${getBidInfoHTML(bidInfo, item)}
      </div>
      ${getBidInputHTML(bidInfo, item, "live")}
    </div>
  `;
}

// getBidInfoHTML 함수 수정
function getBidInfoHTML(bidInfo, item) {
  return BidManager.getBidInfoForCard(bidInfo, item);
}

function getDirectBidInfoHTML(bidInfo, item) {
  return BidManager.getDirectBidInfoHTML(bidInfo, item);
}

function getBidInputHTML(bidInfo, item, bidType) {
  return BidManager.getBidInputHTML(bidInfo, item, bidType);
}

// 전역 변수로 툴팁 컨테이너 추가
let tooltipContainer;

// 페이지 로드 시 툴팁 컨테이너 생성
document.addEventListener("DOMContentLoaded", function () {
  // 툴팁 컨테이너가 없으면 생성
  if (!document.querySelector(".tooltip-container")) {
    tooltipContainer = document.createElement("div");
    tooltipContainer.className = "tooltip-container";
    document.body.appendChild(tooltipContainer);
  } else {
    tooltipContainer = document.querySelector(".tooltip-container");
  }

  // 모든 타이머 정보 아이콘에 이벤트 리스너 추가
  document.addEventListener("mouseover", handleIconHover);
  document.addEventListener("mouseout", hideTooltip);
});

// 아이콘 호버 이벤트 핸들러
function handleIconHover(e) {
  // 타이머 정보 아이콘에 마우스를 올렸을 때
  if (e.target.closest(".timer-info-icon")) {
    const icon = e.target.closest(".timer-info-icon");

    // 툴팁 내용 설정
    tooltipContainer.textContent = `마감 전 5분 입찰 발생 시
5분씩 자동 연장

추가 입찰 없을 시
마지막 입찰 금액 낙찰`;

    // 아이콘 위치 계산
    const iconRect = icon.getBoundingClientRect();

    // 툴팁 위치 설정 (아이콘 위)
    tooltipContainer.style.left = iconRect.left + iconRect.width / 2 + "px";
    tooltipContainer.style.top = iconRect.top - 10 + "px";
    tooltipContainer.style.transform = "translate(-50%, -100%)";

    // 툴팁 표시
    tooltipContainer.style.display = "block";
  }
}

// 툴팁 숨기기
function hideTooltip(e) {
  if (!e.target.closest(".timer-info-icon")) {
    tooltipContainer.style.display = "none";
  }
}

// 직접 경매 카드 HTML
function getDirectCardHTML(item, bidInfo, favoriteNumber) {
  // 타이머 정보
  const timer = BidManager.getRemainingTime(item.scheduled_date);
  const isNearEnd = timer?.isNearEnd;
  const timerText = timer ? timer.text : "--:--:--";

  // 날짜 및 시간 표시
  const formattedDateTime = formatDateTime(item.scheduled_date);

  const live_price =
    item.bid_type == "direct" &&
    bidInfo?.current_price &&
    Number(bidInfo.current_price) > Number(item.starting_price)
      ? bidInfo.current_price
      : item.starting_price;

  // 나의 입찰가와 실시간 가격 비교
  const myBidPrice = bidInfo?.current_price || 0;
  const hasHigherBid =
    Number(live_price) > Number(myBidPrice) && myBidPrice > 0;

  return `
    <div class="product-header">
      <div class="product-brand">${item.brand}
      ${
        hasHigherBid
          ? '<div class="higher-bid-alert">더 높은 입찰 존재</div>'
          : ""
      }
      </div>
      <div class="product-title">${item.title}</div>
      <div class="auction-info">
        <div class="auction-number">
    ${item.auc_num}<span>번</span>
    <div class="auction-type-indicator">${
      item.bid_type === "direct" ? "직접" : "현장"
    }</div>
  </div>
      </div>
    </div>
    <div class="bid-timer ${isNearEnd ? "near-end" : ""}">
      <span class="scheduled-date">${formattedDateTime} 마감</span>
      <span class="remaining-time">[${timerText}]</span>
      <span class="timer-info-icon"><i class="fas fa-question-circle"></i></span>
    </div>
    <div class="product-image-container">
      <img src="${API.validateImageUrl(item.image)}" alt="${
    item.title
  }" class="product-image">
      <div class="product-rank">${item.rank || "N"}</div>
    </div>
    <div class="wishlist-buttons">
  <button class="wishlist-btn ${
    favoriteNumber === 1 ? "active" : ""
  }" data-favorite="1" 
          onclick="event.stopPropagation(); toggleWishlist('${
            item.item_id
          }', 1)">
    즐겨찾기①
  </button>
  <button class="wishlist-btn ${
    favoriteNumber === 2 ? "active" : ""
  }" data-favorite="2" 
          onclick="event.stopPropagation(); toggleWishlist('${
            item.item_id
          }', 2)">
    즐겨찾기②
  </button>
  <button class="wishlist-btn ${
    favoriteNumber === 3 ? "active" : ""
  }" data-favorite="3" 
          onclick="event.stopPropagation(); toggleWishlist('${
            item.item_id
          }', 3)">
    즐겨찾기③
  </button>
</div>
    
    <!-- 3칸 정보 -->
    <div class="product-info-grid">
  <div class="info-cell">
    <div class="info-label">랭크</div>
    <div class="info-value">${item.rank || "N"}</div>
  </div>
  <div class="info-cell">
    <div class="info-label">실시간</div>
    <div class="info-value">${cleanNumberFormat(live_price || 0)}￥</div>
    <div class="info-price-detail">
      ${cleanNumberFormat(
        calculateTotalPrice(live_price, item.auc_num, item.category)
      )}원
    </div>
  </div>
  <div class="info-cell">
    <div class="info-label">${
      item.bid_type === "direct" ? "나의 입찰" : "2차 제안"
    }</div>
    <div class="info-value">${
      item.bid_type === "direct" && bidInfo?.current_price
        ? cleanNumberFormat(bidInfo.current_price) + "￥"
        : item.bid_type === "live" && bidInfo?.second_price
        ? cleanNumberFormat(bidInfo.second_price) + "￥"
        : "-"
    }</div>
    <div class="info-price-detail">
      ${
        item.bid_type === "direct" && bidInfo?.current_price
          ? cleanNumberFormat(
              calculateTotalPrice(
                bidInfo.current_price,
                item.auc_num,
                item.category
              )
            ) + "원"
          : item.bid_type === "live" && bidInfo?.second_price
          ? cleanNumberFormat(
              calculateTotalPrice(
                bidInfo.second_price,
                item.auc_num,
                item.category
              )
            ) + "원"
          : ""
      }
    </div>
  </div>
</div>
    
    <div class="bid-section">
      <div class="price-info">
        <div class="real-time-price">
          <span class="price-label">실시간 금액</span>
          <span class="price-value">${cleanNumberFormat(
            live_price || 0
          )}￥</span>
          <span class="price-detail">관부가세 포함 ${cleanNumberFormat(
            calculateTotalPrice(live_price, item.auc_num, item.category)
          )}\\</span>
        </div>
        ${getDirectBidInfoHTML(bidInfo, item)}
      </div>
      ${getBidInputHTML(bidInfo, item, "direct")}
    </div>
  `;
}

// 인증 관련 함수들
async function checkAuthStatus() {
  try {
    const response = await API.fetchAPI("/auth/user");
    state.isAuthenticated = !!response.user;

    // BidManager에 인증 상태 전달
    BidManager.setAuthStatus(state.isAuthenticated);

    updateAuthUI();
  } catch (error) {
    state.isAuthenticated = false;
    BidManager.setAuthStatus(false);
    updateAuthUI();
  }
}

function updateAuthUI() {
  const signinBtn = document.getElementById("signinBtn");
  const signoutBtn = document.getElementById("signoutBtn");

  if (!signinBtn || !signoutBtn) return;

  if (state.isAuthenticated) {
    signinBtn.style.display = "none";
    signoutBtn.style.display = "inline-block";
  } else {
    signinBtn.style.display = "inline-block";
    signoutBtn.style.display = "none";
  }
}

// 위시리스트 관련 함수
async function toggleWishlist(itemId, favoriteNumber) {
  if (!state.isAuthenticated) {
    alert("위시리스트 기능을 사용하려면 로그인이 필요합니다.");
    return;
  }

  try {
    const existingItem = state.wishlist.find(
      (w) => w.item_id === itemId && w.favorite_number === favoriteNumber
    );

    if (existingItem) {
      // 삭제
      await API.fetchAPI("/wishlist", {
        method: "DELETE",
        body: JSON.stringify({
          itemId: itemId.toString(),
          favoriteNumber,
        }),
      });

      // 상태 업데이트
      state.wishlist = state.wishlist.filter(
        (w) => w.item_id !== itemId || w.favorite_number !== favoriteNumber
      );
    } else {
      // 추가
      await API.fetchAPI("/wishlist", {
        method: "POST",
        body: JSON.stringify({
          itemId: itemId.toString(),
          favoriteNumber,
        }),
      });

      // 같은 아이템의 같은 번호가 있으면 제거 (중복 방지)
      state.wishlist = state.wishlist.filter(
        (w) => w.item_id !== itemId || w.favorite_number !== favoriteNumber
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

// 데이터 가져오기
async function fetchData(showLoading = true) {
  if (showLoading) {
    toggleLoading(true);
  }
  try {
    const params = {
      page: state.currentPage,
      limit: state.itemsPerPage,
      brands: state.selectedBrands,
      categories: state.selectedCategories,
      scheduledDates: state.selectedDates.map((date) =>
        date === "NO_DATE" ? "null" : date
      ),
      search: state.searchTerm,
      ranks: state.selectedRanks,
      favoriteNumbers:
        state.selectedFavoriteNumbers.length > 0
          ? state.selectedFavoriteNumbers.join(",")
          : undefined,
      auctionTypes:
        state.selectedAuctionTypes.length > 0
          ? state.selectedAuctionTypes.join(",")
          : undefined,
      aucNums: state.selectedAucNums.join(","),
      withDetails: "false",
      bidsOnly: state.showBidItemsOnly, // 파라미터 수정
      sortBy: state.sortBy, // 정렬 기준 필드 추가
      sortOrder: state.sortOrder, // 정렬 방향 추가
    };

    const queryString = API.createURLParams(params);
    const data = await API.fetchAPI(`/data?${queryString}`);

    // 위시리스트 정보 추출
    state.wishlist = data.wishlist.map((w) => ({
      item_id: w.item_id,
      favorite_number: w.favorite_number,
    }));

    state.totalItems = data.totalItems;
    state.totalPages = data.totalPages;

    // 입찰 데이터 분리
    state.liveBidData = [];
    state.directBidData = [];

    // 각 아이템에 입찰 정보 추가
    data.data.forEach((item) => {
      if (item.bids) {
        if (item.bids.live) {
          state.liveBidData.push(item.bids.live);
        }
        if (item.bids.direct) {
          state.directBidData.push(item.bids.direct);
        }
      }
    });

    // const hasNullDescriptions = data.data.some(
    //   (item) => item.description === null
    // );

    // // description이 null인 아이템이 하나라도 있으면 상세 정보 사전 로드 요청
    // if (hasNullDescriptions) {
    //   // 비동기적으로 상세 정보 요청 (결과를 기다리지 않음)
    //   fetchDetailedData();
    // }

    // BidManager에 입찰 데이터 전달
    BidManager.updateBidData(state.liveBidData, state.directBidData);

    displayData(data.data);
    createPagination(state.currentPage, state.totalPages, handlePageChange);
  } catch (error) {
    console.error("데이터를 불러오는 데 실패했습니다:", error);
    // 자동 새로고침에서는 에러 알림 표시하지 않음
    if (showLoading) {
      alert("데이터를 불러오는 데 실패했습니다.");
    }
  } finally {
    if (showLoading) {
      toggleLoading(false);
    }
  }
}

async function fetchDetailedData() {
  try {
    // 현재 필터 상태와 동일하게 파라미터 구성하되, withDetails=true로 설정
    const params = {
      page: state.currentPage,
      limit: state.itemsPerPage,
      brands: state.selectedBrands,
      categories: state.selectedCategories,
      scheduledDates: state.selectedDates.map((date) =>
        date === "NO_DATE" ? "null" : date
      ),
      search: state.searchTerm,
      ranks: state.selectedRanks,
      favoriteNumbers:
        state.selectedFavoriteNumbers.length > 0
          ? state.selectedFavoriteNumbers.join(",")
          : undefined,
      auctionTypes:
        state.selectedAuctionTypes.length > 0
          ? state.selectedAuctionTypes.join(",")
          : undefined,
      aucNums: state.selectedAucNums.join(","),
      withDetails: "true", // 상세 정보 요청
      bidsOnly: state.showBidItemsOnly,
      sortBy: state.sortBy,
      sortOrder: state.sortOrder,
    };

    const queryString = API.createURLParams(params);

    // 결과를 기다리지 않고 비동기적으로 요청만 보냄
    API.fetchAPI(`/data?${queryString}`).catch((error) => {
      console.log("상세 정보 사전 로드 중 오류:", error);
      // 사용자에게 알리지 않음 (백그라운드 작업)
    });

    console.log("상세 정보 사전 로드 요청 전송됨");
  } catch (error) {
    console.log("상세 정보 사전 로드 중 오류:", error);
    // 사용자에게 알리지 않음 (백그라운드 작업)
  }
}

function handleSortOptionChange() {
  const sortOption = document.getElementById("sortOption");
  if (!sortOption) return;

  sortOption.addEventListener("change", function () {
    const [sortBy, sortOrder] = this.value.split("-");
    state.sortBy = sortBy;
    state.sortOrder = sortOrder;
    state.currentPage = 1; // Reset to first page when sorting changes
    fetchData();
  });
}

function initializeSortOptions() {
  const sortOption = document.getElementById("sortOption");
  if (!sortOption) return;

  // Set the default value
  sortOption.value = `${state.sortBy}-${state.sortOrder}`;
}

// 이벤트 핸들러들
function handlePageChange(page) {
  state.currentPage = page;
  fetchData();
}

function handleSearch() {
  const searchInput = document.getElementById("searchInput");
  state.searchTerm = searchInput.value;
  state.currentPage = 1;
  fetchData();
}

async function handleSignout() {
  try {
    await API.fetchAPI("/auth/logout", { method: "POST" });
    state.isAuthenticated = false;
    BidManager.setAuthStatus(false);
    location.reload();
  } catch (error) {
    alert("로그아웃 중 오류가 발생했습니다.");
  }
}

// 상세 정보 표시
async function showDetails(itemId) {
  const modalManager = setupModal("detailModal");
  if (!modalManager) return;

  // 현재 데이터에서 아이템 찾기
  let item = state.currentData.find((data) => data.item_id == itemId);

  // 데이터 없는 경우 API 요청
  if (!item) {
    try {
      item = await API.fetchAPI(`/detail/item-details/${itemId}`, {
        method: "POST",
      });

      state.currentData.push(item);

      if (item.bids) {
        if (item.bids.live) {
          state.liveBidData.push(item.bids.live);
        }
        if (item.bids.direct) {
          state.directBidData.push(item.bids.direct);
        }
      }
    } catch (error) {
      console.error("Failed to fetch item details:", error);
      alert("상세 정보를 불러올 수 없습니다.");
      return;
    }
  }

  // 기본 정보로 모달 초기화
  initializeModal(item);
  modalManager.show();

  // 이미지 네비게이션 이벤트 리스너 설정
  setupImageNavigation();

  // 로딩 표시
  showLoadingInModal();

  try {
    // 상세 정보 가져오기
    const updatedItem = await API.fetchAPI(`/detail/item-details/${itemId}`, {
      method: "POST",
    });

    // 상세 정보 업데이트
    updateModalWithDetails(updatedItem);

    // 추가 이미지가 있다면 업데이트
    if (updatedItem.additional_images) {
      initializeImages([
        updatedItem.image,
        ...JSON.parse(updatedItem.additional_images),
      ]);
      // 이미지가 업데이트된 후 네비게이션 리스너 재설정
      setupImageNavigation();
    }
  } catch (error) {
    console.error("Failed to fetch item details:", error);
  } finally {
    hideLoadingInModal();
  }
}

function initializeModal(item) {
  document.querySelector(".modal-brand").textContent = item.brand;
  document.querySelector(".modal-title").textContent = item.title;
  document.querySelector(".modal-title").dataset.itemId = item.item_id; // 타이머 업데이트용 데이터 속성 추가
  document.querySelector(".main-image").src = API.validateImageUrl(item.image);
  document.querySelector(".modal-description").textContent = "로딩 중...";
  document.querySelector(".modal-category").textContent =
    item.category || "로딩 중...";
  document.querySelector(".modal-brand2").textContent = item.brand;
  document.querySelector(".modal-accessory-code").textContent =
    item.accessory_code || "로딩 중...";
  document.querySelector(".modal-scheduled-date").textContent =
    formatDateTime(item.scheduled_date) || "로딩 중...";
  document.querySelector(".modal-rank").textContent = item.rank || "N";

  // 입찰 정보 초기화
  initializeBidInfo(item.item_id, item);

  // 이미지 초기화
  initializeImages([item.image]);
}

function updateModalWithDetails(item) {
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
  document.querySelector(".modal-brand").textContent = item.brand;
  document.querySelector(".modal-brand2").textContent = item.brand;
  document.querySelector(".modal-title").textContent =
    item.title || "제목 없음";
  document.querySelector(".modal-rank").textContent = item.rank || "N";
}

function initializeBidInfo(itemId, item = null) {
  if (!item) item = state.currentData.find((i) => i.item_id == itemId);
  const bidSection = document.querySelector(".modal-content .bid-info-holder");

  if (!bidSection || !item) return;

  // 경매 타입에 따라 다른 입찰 섹션 표시
  if (item.bid_type === "direct") {
    const directBidInfo = state.directBidData.find((b) => b.item_id == itemId);
    bidSection.innerHTML = BidManager.getDirectBidSectionHTML(
      directBidInfo,
      itemId,
      item.auc_num,
      item.category
    );
  } else {
    const liveBidInfo = state.liveBidData.find((b) => b.item_id == itemId);
    bidSection.innerHTML = BidManager.getLiveBidSectionHTML(
      liveBidInfo,
      itemId,
      item.auc_num,
      item.category
    );
  }

  // 가격 계산기 초기화
  BidManager.initializePriceCalculators();
}

function initializeImages(imageUrls) {
  state.images = imageUrls.filter((url) => url); // 유효한 URL만 필터링
  state.currentImageIndex = 0;

  const mainImage = document.querySelector(".main-image");
  const thumbnailContainer = document.querySelector(".thumbnail-container");

  if (!mainImage || !thumbnailContainer) return;

  // 메인 이미지 설정
  mainImage.src = API.validateImageUrl(state.images[0]);

  // 썸네일 초기화
  thumbnailContainer.innerHTML = "";
  state.images.forEach((img, index) => {
    const thumbnailWrapper = createElement("div", "thumbnail");
    thumbnailWrapper.classList.toggle("active", index === 0);

    const thumbnail = createElement("img");
    thumbnail.src = API.validateImageUrl(img);
    thumbnail.alt = `Thumbnail ${index + 1}`;
    thumbnail.loading = "lazy";

    thumbnail.addEventListener("click", () => changeMainImage(index));
    thumbnailWrapper.appendChild(thumbnail);
    thumbnailContainer.appendChild(thumbnailWrapper);
  });

  // 네비게이션 버튼 상태 업데이트
  updateNavigationButtons();
}

function changeMainImage(index) {
  if (index < 0 || index >= state.images.length) return;

  state.currentImageIndex = index;
  const mainImage = document.querySelector(".main-image");
  if (!mainImage) return;

  mainImage.src = API.validateImageUrl(state.images[index]);

  // 썸네일 active 상태 업데이트
  const thumbnails = document.querySelectorAll(".thumbnail");
  thumbnails.forEach((thumb, i) => {
    thumb.classList.toggle("active", i === index);
  });

  updateNavigationButtons();
}

function updateNavigationButtons() {
  const prevBtn = document.querySelector(".image-nav.prev");
  const nextBtn = document.querySelector(".image-nav.next");

  if (!prevBtn || !nextBtn) return;

  prevBtn.disabled = state.currentImageIndex === 0;
  nextBtn.disabled = state.currentImageIndex === state.images.length - 1;
}

// 모달 로딩 관련 함수들
function showLoadingInModal() {
  const existingLoader = document.getElementById("modal-loading");
  if (existingLoader) return;

  const loadingElement = createElement("div", "modal-loading");
  loadingElement.id = "modal-loading";
  loadingElement.textContent = "상세 정보를 불러오는 중...";

  document.querySelector(".modal-content")?.appendChild(loadingElement);
}

function hideLoadingInModal() {
  document.getElementById("modal-loading")?.remove();
}

// 위시리스트 UI 업데이트
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
        (w) => w.item_id === itemId && w.favorite_number === favoriteNumber
      );

      btn.classList.toggle("active", isActive);
    });
  }
}

// 이미지 네비게이션 이벤트 리스너 설정 함수 개선
function setupImageNavigation() {
  // 이벤트 리스너 중복 방지를 위해 기존 리스너 제거
  const prevBtn = document.querySelector(".image-nav.prev");
  const nextBtn = document.querySelector(".image-nav.next");

  if (prevBtn) {
    // 기존 리스너 제거 및 새 리스너 추가
    const newPrevBtn = prevBtn.cloneNode(true);
    prevBtn.parentNode.replaceChild(newPrevBtn, prevBtn);
    newPrevBtn.addEventListener("click", () => {
      changeMainImage(state.currentImageIndex - 1);
    });
  }

  if (nextBtn) {
    // 기존 리스너 제거 및 새 리스너 추가
    const newNextBtn = nextBtn.cloneNode(true);
    nextBtn.parentNode.replaceChild(newNextBtn, nextBtn);
    newNextBtn.addEventListener("click", () => {
      changeMainImage(state.currentImageIndex + 1);
    });
  }

  // 네비게이션 버튼 상태 업데이트
  updateNavigationButtons();
}

// 필터 설정 함수
function setupFilters() {
  // 출품사 필터 설정
  document
    .getElementById("aucNumFilters")
    ?.addEventListener("change", function (e) {
      if (e.target.type === "checkbox") {
        if (e.target.checked) {
          state.selectedAucNums.push(e.target.value);
        } else {
          const index = state.selectedAucNums.indexOf(e.target.value);
          if (index > -1) state.selectedAucNums.splice(index, 1);
        }
      }
    });

  // 경매 유형 필터 설정
  document
    .getElementById("auctionTypeFilters")
    ?.addEventListener("change", function (e) {
      if (e.target.type === "checkbox") {
        if (e.target.checked) {
          state.selectedAuctionTypes.push(e.target.value);
        } else {
          const index = state.selectedAuctionTypes.indexOf(e.target.value);
          if (index > -1) state.selectedAuctionTypes.splice(index, 1);
        }
      }
    });

  // 즐겨찾기 필터 설정
  document
    .getElementById("favoriteFilters")
    ?.addEventListener("change", function (e) {
      if (e.target.type === "checkbox") {
        const favoriteNum = parseInt(e.target.value);
        if (e.target.checked) {
          if (!state.selectedFavoriteNumbers.includes(favoriteNum)) {
            state.selectedFavoriteNumbers.push(favoriteNum);
          }
        } else {
          state.selectedFavoriteNumbers = state.selectedFavoriteNumbers.filter(
            (num) => num !== favoriteNum
          );
        }
      }
    });

  // 입찰항목만 표기 체크박스
  document
    .getElementById("bid-items-only")
    ?.addEventListener("change", function () {
      state.showBidItemsOnly = this.checked;
    });

  // 필터 적용 버튼
  document
    .getElementById("applyFiltersBtn")
    ?.addEventListener("click", function () {
      state.currentPage = 1;
      fetchData();
    });

  // 필터 리셋 버튼
  document
    .getElementById("resetFiltersBtn")
    ?.addEventListener("click", function () {
      state.selectedBrands = [];
      state.selectedCategories = [];
      state.selectedDates = [];
      state.selectedRanks = [];
      state.selectedAucNums = [];
      state.selectedAuctionTypes = [];
      state.selectedFavoriteNumbers = [];
      state.showBidItemsOnly = false;

      // 체크박스 초기화
      document
        .querySelectorAll('.filter-options input[type="checkbox"]')
        .forEach((checkbox) => (checkbox.checked = false));

      // 입찰항목만 표기 체크박스 초기화
      document.getElementById("bid-items-only").checked = false;

      document
        .querySelectorAll("#brandCheckboxes input[type='checkbox']")
        .forEach((checkbox) => {
          checkbox.checked = false;
        });

      document
        .querySelectorAll("#categoryCheckboxes input[type='checkbox']")
        .forEach((checkbox) => {
          checkbox.checked = false;
        });

      // 선택된 항목 수 업데이트
      updateSelectedCount("brand");
      updateSelectedCount("category");

      // 데이터 다시 가져오기
      state.currentPage = 1;
      fetchData();
    });

  // 표시 개수 변경
  document
    .getElementById("itemsPerPage")
    ?.addEventListener("change", function () {
      state.itemsPerPage = parseInt(this.value);
      state.currentPage = 1;
      fetchData();
    });

  // 뷰 타입 변경
  document
    .getElementById("cardViewBtn")
    ?.addEventListener("click", function () {
      document.getElementById("listViewBtn").classList.remove("active");
      this.classList.add("active");
      document.getElementById("dataBody").classList.remove("list-view");
    });

  document
    .getElementById("listViewBtn")
    ?.addEventListener("click", function () {
      document.getElementById("cardViewBtn").classList.remove("active");
      this.classList.add("active");
      document.getElementById("dataBody").classList.add("list-view");
    });

  // 상단 메뉴 버튼들
  document
    .getElementById("allProductsBtn")
    ?.addEventListener("click", function () {
      state.selectedAuctionTypes = [];
      updateFilterUI();
      fetchData();
    });

  document
    .getElementById("liveAuctionBtn")
    ?.addEventListener("click", function () {
      state.selectedAuctionTypes = ["live"];
      updateFilterUI();
      fetchData();
    });

  document
    .getElementById("directAuctionBtn")
    ?.addEventListener("click", function () {
      state.selectedAuctionTypes = ["direct"];
      updateFilterUI();
      fetchData();
    });
}

function updateFilterUI() {
  // 경매 타입 체크박스 업데이트
  const liveCheckbox = document.getElementById("auction-type-live");
  const directCheckbox = document.getElementById("auction-type-direct");

  if (liveCheckbox) {
    liveCheckbox.checked = state.selectedAuctionTypes.includes("live");
  }

  if (directCheckbox) {
    directCheckbox.checked = state.selectedAuctionTypes.includes("direct");
  }
}

function setupItemsPerPage() {
  const itemsPerPage = document.getElementById("itemsPerPage");
  if (itemsPerPage) {
    // 기존 옵션 제거
    itemsPerPage.innerHTML = "";

    // 새 옵션 추가
    const options = [
      { value: 20, text: "20개씩 보기" },
      { value: 50, text: "50개씩 보기" },
      { value: 100, text: "100개씩 보기" },
    ];

    options.forEach((option) => {
      const optionElement = document.createElement("option");
      optionElement.value = option.value;
      optionElement.textContent = option.text;
      itemsPerPage.appendChild(optionElement);
    });

    // 기본값 설정
    itemsPerPage.value = state.itemsPerPage;
  }
}

function updateBidsOnlyFilter() {
  const bidsOnlyCheckbox = document.getElementById("bid-items-only");
  if (bidsOnlyCheckbox) {
    bidsOnlyCheckbox.addEventListener("change", function () {
      state.showBidItemsOnly = this.checked;
    });
  }
}

function setupDropdownMenus() {
  // 드롭다운 버튼들 선택
  const dropdownButtons = document.querySelectorAll(
    ".nav-item.dropdown-container > .nav-button"
  );

  // 모든 드롭다운 닫기 함수
  const closeAllDropdowns = (exceptDropdown = null) => {
    document.querySelectorAll(".dropdown-content").forEach((dropdown) => {
      if (dropdown !== exceptDropdown) {
        dropdown.classList.remove("active");
      }
    });
  };

  // 현재 모바일 환경인지 확인하는 함수
  const isMobile = () => window.innerWidth <= 768;

  // 드롭다운 버튼 이벤트 설정
  dropdownButtons.forEach((button) => {
    // 중요: 이벤트 중복 방지를 위해 이전 리스너 제거
    const newButton = button.cloneNode(true);
    button.parentNode.replaceChild(newButton, button);

    newButton.addEventListener("click", function (e) {
      // 모바일 메뉴 토글 버튼 클릭 시 이벤트 차단
      if (e.target.closest(".mobile-menu-toggle")) {
        return;
      }

      // 이벤트 전파 중지
      e.preventDefault();
      e.stopPropagation();

      // 현재 버튼의 부모 요소 내에 있는 dropdown-content 찾기
      const dropdown = this.parentNode.querySelector(".dropdown-content");
      if (!dropdown) return;

      // 현재 드롭다운이 이미 활성화되어 있는지 확인
      const isActive = dropdown.classList.contains("active");

      // 다른 모든 드롭다운 닫기
      closeAllDropdowns(isActive ? null : dropdown);

      // 현재 드롭다운 토글
      dropdown.classList.toggle("active");

      // 버튼 상태 토글 (화살표 회전 애니메이션용)
      this.classList.toggle("active", dropdown.classList.contains("active"));
    });
  });

  // 드롭다운 내부 링크 클릭 이벤트
  document.querySelectorAll(".dropdown-content a").forEach((link) => {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();

      // 필요한 처리 수행
      if (this.dataset.type) {
        const type = this.dataset.type;
        if (type === "all") {
          window.state.selectedAuctionTypes = [];
        } else {
          window.state.selectedAuctionTypes = [type];
        }
      } else if (this.dataset.favorite) {
        const favoriteNum = parseInt(this.dataset.favorite);
        window.state.selectedFavoriteNumbers = [favoriteNum];
      }

      // 데이터 새로고침
      if (typeof updateFilterUI === "function") {
        updateFilterUI();
      }
      if (typeof fetchData === "function") {
        fetchData();
      }

      // 드롭다운 닫기
      closeAllDropdowns();

      // 모바일 환경에서 메뉴 닫기 처리
      if (isMobile()) {
        if (
          window.mobileMenuFunctions &&
          window.mobileMenuFunctions.closeMobileMenu
        ) {
          window.mobileMenuFunctions.closeMobileMenu();
        }
      }
    });
  });

  // 다른 곳 클릭 시 모든 드롭다운 닫기
  document.addEventListener("click", function (e) {
    // 햄버거 메뉴 버튼 클릭은 무시
    if (e.target.closest(".mobile-menu-toggle")) {
      return;
    }

    // 클릭된 요소가 드롭다운 버튼이나 드롭다운 콘텐츠 내부가 아니면 모든 드롭다운 닫기
    if (
      !e.target.closest(".dropdown-content") &&
      !e.target.closest(".nav-item.dropdown-container > .nav-button")
    ) {
      closeAllDropdowns();
    }
  });

  console.log("드롭다운 메뉴 설정 완료");
}

// 초기화 함수
function initialize() {
  state.itemsPerPage = 20; // 기본 20개씩 표시
  state.sortBy = "scheduled_date"; // 기본 정렬 필드: 마감일
  state.sortOrder = "asc"; // 기본 정렬 방향: 오름차순

  // DOM 완전히 로드된 후 실행
  document.addEventListener("DOMContentLoaded", function () {
    // 드롭다운 메뉴 설정
    setupDropdownMenus();
    // 모바일 메뉴 설정
    setupMobileMenu();
    // 모바일 필터 설정
    setupMobileFilters();
  });

  window.addEventListener("load", function () {
    const socket = initializeSocket();
    // 기존 초기화 함수 호출
    API.initialize()
      .then(() => checkAuthStatus())
      .then(() => {
        // 필터 데이터 가져오기
        return Promise.all([
          API.fetchAPI("/data/brands-with-count"),
          API.fetchAPI("/data/categories"),
          API.fetchAPI("/data/scheduled-dates-with-count"),
          API.fetchAPI("/data/ranks"),
          API.fetchAPI("/data/auc-nums"),
          API.fetchAPI("/data/auction-types"),
        ]);
      })
      .then(
        ([
          brandsResponse,
          categoriesResponse,
          datesResponse,
          ranksResponse,
          aucNumsResponse,
          auctionTypesResponse,
        ]) => {
          // 필터 표시
          displayFilters(
            brandsResponse,
            categoriesResponse,
            datesResponse,
            ranksResponse,
            aucNumsResponse
          );
          displayFavoriteFilters(); // 즐겨찾기 필터 초기화
          setupItemsPerPage(); // 표시 개수 설정
          updateBidsOnlyFilter(); // 입찰항목만 표시 파라미터 수정
          initializeSortOptions(); // 정렬 옵션 초기화
          handleSortOptionChange(); // 정렬 변경 이벤트 리스너 설정

          // 필터 설정
          setupFilters();

          // 이벤트 리스너 설정
          document
            .getElementById("searchButton")
            ?.addEventListener("click", handleSearch);
          document
            .getElementById("searchInput")
            ?.addEventListener("keypress", (e) => {
              if (e.key === "Enter") handleSearch();
            });

          document
            .getElementById("signinBtn")
            ?.addEventListener("click", () => {
              window.location.href = "./pages/signin.html";
            });

          document
            .getElementById("signoutBtn")
            ?.addEventListener("click", handleSignout);

          // 이미지 네비게이션 설정
          setupImageNavigation();

          // BidManager 초기화
          BidManager.initialize(state.isAuthenticated, []);

          // 입찰 성공 이벤트 리스너 등록
          window.addEventListener("bidSuccess", function () {
            fetchData(); // 데이터 새로고침
          });

          // 초기 데이터 로드
          fetchData().then(() => {
            const urlParams = new URLSearchParams(window.location.search);
            const itemId = urlParams.get("item_id");
            if (itemId) {
              showDetails(itemId);
            }
          });
        }
      )
      .catch((error) => {
        console.error("Error initializing:", error);
        alert("초기화 중 오류가 발생했습니다.");
      });
  });
}

// 페이지를 나갈 때 타이머 정리
window.addEventListener("beforeunload", function () {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }
});

// 페이지 로드 시 초기화 실행
initialize();
