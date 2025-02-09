// products.js

// 상태 관리
window.state = {
  selectedBrands: [],
  selectedCategories: [],
  selectedDates: [],
  selectedRanks: [],
  selectedAucNums: [],
  currentPage: 1,
  itemsPerPage: 20,
  totalItems: 0,
  totalPages: 0,
  searchTerm: "",
  wishlist: [],
  bidData: [],
  currentData: [],
  images: [],
  currentImageIndex: 0,
  isAuthenticated: false,
};

// 대괄호 제거 함수
function removeLeadingBrackets(title) {
  // 앞쪽의 대괄호와 소괄호 제거
  return title.replace(/^[\[\(][^\]\)]*[\]\)]\s*/, "");
}

function calculateLocalFee(price, auctionId) {
  if (!price) return 0;

  // ecoauc 경우 (문자로 시작하는 경우)
  if (isNaN(auctionId.charAt(0))) {
    if (price === 0) return 0;
    if (price < 10000) return 1900;
    if (price < 50000) return 2450;
    return 3550;
  }
  // starbuyers 경우 (숫자로 시작하는 경우)
  else if (!isNaN(auctionId.charAt(0))) {
    return price < 100000 ? price * 0.1 + 1990 : price * 0.07 + 1990;
  }
  return 0;
}

// 관세 계산 (부가세 제외)
function calculateCustomsDuty(amountKRW, category) {
  if (!amountKRW || !category) return 0;

  if (
    ["가방", "악세서리", "소품・액세서리", "소품", "귀금속"].includes(category)
  ) {
    return amountKRW * 0.08;
  }

  if (["의류", "신발"].includes(category)) {
    return amountKRW * 0.13;
  }

  if (category === "시계") {
    if (amountKRW < 2000000) {
      // 관세만 8% 적용
      return amountKRW * 0.08;
    } else {
      // 관세 8% + 개소세(관세의 10%)
      return amountKRW * 0.08 + amountKRW * 0.08 * 0.1;
    }
  }

  return 0;
}

// 총 가격 계산
function calculateTotalPrice(price, auctionNumber, category) {
  price = parseFloat(price) || 0;

  // 1. 현지 수수료 계산
  const localFee = calculateLocalFee(price, auctionNumber);

  // 2. 원화 환산 (현지가격 + 현지수수료)
  const totalAmountKRW = (price + localFee) * API.exchangeRate;

  // 3. 관세 계산 (부가세 제외)
  const customsDuty = calculateCustomsDuty(totalAmountKRW, category);

  // 4. 서비스 수수료 5%
  const serviceFee = (totalAmountKRW + customsDuty) * 0.05;

  // 5. 최종 금액 반환 (반올림)
  return Math.round(totalAmountKRW + customsDuty + serviceFee);
}

// 입찰 섹션 HTML 생성
function getBidSectionHTML(bidInfo, itemId, aucNum, category) {
  if (bidInfo?.final_price) {
    return `
            <div>
                <p>최종 입찰금액: ${formatNumber(bidInfo.final_price)} ¥</p>
                <div class="price-details-container">
                    (현지수수료+관세+수수료5% 기준 ${formatNumber(
                      calculateTotalPrice(bidInfo.final_price, aucNum, category)
                    )}원)
                </div>
            </div>`;
  }

  let html = `<div class="bid-info">`;
  if (bidInfo?.first_price || bidInfo?.second_price) {
    html += `
            <div>
                <div class="bid-price-info">
                    <p>1차 입찰금액: ${
                      formatNumber(bidInfo.first_price) || "-"
                    } ¥</p>
                    ${
                      bidInfo.first_price
                        ? `<div class="price-details-container first-price">
                            (현지수수료+관세+수수료5% 기준 ${formatNumber(
                              calculateTotalPrice(
                                bidInfo.first_price,
                                aucNum,
                                category
                              )
                            )}원)
                        </div>`
                        : ""
                    }
                </div>
                <div class="bid-price-info">
                    <p>2차 제안금액: ${
                      formatNumber(bidInfo.second_price) || "-"
                    } ¥</p>
                    ${
                      bidInfo.second_price
                        ? `<div class="price-details-container second-price">
                            (현지수수료+관세+수수료5% 기준 ${formatNumber(
                              calculateTotalPrice(
                                bidInfo.second_price,
                                aucNum,
                                category
                              )
                            )}원)
                        </div>`
                        : ""
                    }
                </div>
            </div>`;
  }

  html += `
        <div>
            <div class="bid-input-group">
                <input type="number" placeholder="입찰 예정액" class="bid-input" data-item-id="${itemId}">
                <span class="bid-currency">¥</span>
                <button class="bid-button" onclick="handleBidSubmit(this.parentElement.children[0].value, '${itemId}')">입찰</button>
            </div>
            <div class="price-details-container"></div>
        </div>
    </div>`;

  return html;
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

  initializePriceCalculators();
}

// 제품 카드 생성
function createProductCard(item) {
  const card = createElement("div", "product-card");
  card.dataset.itemId = item.item_id;

  const isWishlisted = state.wishlist.includes(item.item_id);
  const bidInfo = state.bidData.find((b) => b.item_id == item.item_id);

  card.innerHTML = `
        <div class="product-header">
            <div>
                <div class="product-brand">${item.brand}</div>
                <div class="auctioneer-number">${item.auc_num}번</div>
            </div>
            <h3 class="product-title">${removeLeadingBrackets(
              item.korean_title
            )}</h3>
        </div>
        <img src="${API.validateImageUrl(
          item.image
        )}" alt="${removeLeadingBrackets(
    item.korean_title
  )}" class="product-image">
        <div class="product-details">
            <p class="scheduled-date">예정일: ${formatDate(
              item.scheduled_date
            )}</p>
            <p class="scheduled-date">랭크: ${item.rank}</p>
            <div class="bid-section">
                ${
                  bidInfo
                    ? getBidSectionHTML(
                        bidInfo,
                        item.item_id,
                        item.auc_num,
                        item.category
                      )
                    : getDefaultBidSectionHTML(item.item_id)
                }
            </div>
            <div class="action-buttons">
                <button class="wishlist-btn ${isWishlisted ? "active" : ""}" 
                        onclick="event.stopPropagation(); toggleWishlist('${
                          item.item_id
                        }')">
                    <i class="fas fa-star"></i>
                </button>
            </div>
        </div>
    `;

  card.addEventListener("click", (event) => {
    if (!event.target.closest(".product-details")) {
      showDetails(item.item_id);
    }
  });

  return card;
}

// 인증 관련 함수들
async function checkAuthStatus() {
  try {
    const response = await API.fetchAPI("/auth/user");
    state.isAuthenticated = !!response.user;
    updateAuthUI();
  } catch (error) {
    state.isAuthenticated = false;
    updateAuthUI();
  }
}

function updateAuthUI() {
  const signinBtn = document.getElementById("signinBtn");
  const signoutBtn = document.getElementById("signoutBtn");
  const filterButtons = document.querySelector(".filter-buttons");

  if (!signinBtn || !signoutBtn) return;

  if (state.isAuthenticated) {
    signinBtn.style.display = "none";
    signoutBtn.style.display = "inline-block";
    if (filterButtons) {
      filterButtons.style.display = "flex";
    }
  } else {
    signinBtn.style.display = "inline-block";
    signoutBtn.style.display = "none";
    if (filterButtons) {
      filterButtons.style.display = "none";
    }
  }
}

// 위시리스트 관련 함수들
async function toggleWishlist(itemId) {
  if (!state.isAuthenticated) {
    alert("위시리스트 기능을 사용하려면 로그인이 필요합니다.");
    return;
  }

  try {
    const isWishlisted = state.wishlist.includes(itemId);
    const method = isWishlisted ? "DELETE" : "POST";

    await API.fetchAPI("/wishlist", {
      method,
      body: JSON.stringify({ itemId: itemId.toString() }),
    });

    if (isWishlisted) {
      state.wishlist = state.wishlist.filter((id) => id !== itemId);
    } else {
      state.wishlist.push(itemId);
    }

    updateWishlistUI(itemId);
  } catch (error) {
    alert(`위시리스트 업데이트 중 오류가 발생했습니다: ${error.message}`);
  }
}

// 데이터 가져오기
async function fetchData() {
  toggleLoading(true);
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
      wishlistOnly: document
        .getElementById("wishlistFilter")
        ?.classList.contains("active"),
      bidOnly: document
        .getElementById("bidFilter")
        ?.classList.contains("active"),
      aucNums: state.selectedAucNums.join(","),
    };

    const queryString = API.createURLParams(params);
    const data = await API.fetchAPI(`/data?${queryString}`);

    state.bidData = data.bidData || [];
    state.wishlist = data.wishlist || [];
    state.totalItems = data.totalItems;
    state.totalPages = data.totalPages;

    displayData(data.data);
    createPagination(state.currentPage, state.totalPages, handlePageChange);
  } catch (error) {
    alert("데이터를 불러오는 데 실패했습니다.");
  } finally {
    toggleLoading(false);
  }
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
    location.reload();
  } catch (error) {
    alert("로그아웃 중 오류가 발생했습니다.");
  }
}

// products.js에 추가
function getDefaultBidSectionHTML(itemId) {
  return `
        <div class="bid-info">
            <div>
                <div class="bid-input-group">
                    <input type="number" placeholder="입찰 예정액" class="bid-input" data-item-id="${itemId}">
                    <span class="bid-currency">¥</span>
                    <button class="bid-button" onclick="handleBidSubmit(this.parentElement.children[0].value, '${itemId}')">입찰</button>
                </div>
                <div class="price-details-container"></div>
            </div>
        </div>
    `;
}

function initializePriceCalculators() {
  document.querySelectorAll(".bid-input").forEach((input) => {
    const container = input.parentElement.parentElement.querySelector(
      ".price-details-container"
    );
    const itemId = input.getAttribute("data-item-id");
    const item = state.currentData.find((item) => item.item_id == itemId);

    if (container && item) {
      input.addEventListener("input", function () {
        const price = parseFloat(this.value) || 0;
        const totalPrice = calculateTotalPrice(
          price,
          item.auc_num,
          item.category
        );
        container.innerHTML = price
          ? `(현지수수료+관세+수수료5% 기준 ${formatNumber(totalPrice)}원)`
          : "";
      });
    }
  });
}

async function handleBidSubmit(value, itemId) {
  if (!state.isAuthenticated) {
    alert("입찰하려면 로그인이 필요합니다.");
    return;
  }

  const bidInfo = state.bidData.find((b) => b.item_id == itemId);
  const isFinalBid =
    !!bidInfo && (!!bidInfo.first_price || !!bidInfo.second_price);

  try {
    await API.fetchAPI("/bid/place-reservation", {
      method: "POST",
      body: JSON.stringify({
        itemId,
        bidAmount: value,
        isFinalBid,
      }),
    });

    alert(
      isFinalBid
        ? "최종 입찰금액이 등록되었습니다."
        : "입찰 예정액이 신청되었습니다."
    );
    await fetchData(); // 데이터 새로고침
  } catch (error) {
    alert(`입찰 신청 중 오류가 발생했습니다: ${error.message}`);
  }
}
// products.js에 추가
async function showNoticeSection() {
  const noticeSection = document.querySelector(".notice-section");
  const showNoticesBtn = document.getElementById("showNoticesBtn");

  if (!noticeSection || !showNoticesBtn) return;

  if (noticeSection.style.display === "none") {
    noticeSection.style.display = "block";
    showNoticesBtn.textContent = "공지사항 닫기";
    await fetchNotices();
  } else {
    noticeSection.style.display = "none";
    showNoticesBtn.textContent = "공지사항 보기";
  }
}

async function fetchNotices() {
  try {
    const notices = await API.fetchAPI("/admin/notices");
    displayNotices(notices);
  } catch (error) {
    console.error("Error fetching notices:", error);
  }
}

function displayNotices(notices) {
  const noticeList = document.getElementById("noticeList");
  if (!noticeList) return;

  noticeList.innerHTML = "";
  notices.forEach((notice) => {
    const li = createElement("li", "", notice.title);
    li.addEventListener("click", () => showNoticeDetail(notice));
    noticeList.appendChild(li);
  });
}
// products.js의 showNoticeDetail 함수 수정
function showNoticeDetail(notice) {
  const modal = document.getElementById("noticeDetailModal");
  const title = document.getElementById("noticeTitle");
  const content = document.getElementById("noticeContent");
  const image = document.getElementById("noticeImage");

  if (!modal || !title || !content || !image) return;

  // 내용 설정
  title.textContent = notice.title;
  content.innerHTML = notice.content.replace(/\n/g, "<br>");

  // 이미지 처리
  if (notice.image_url) {
    image.src = notice.image_url;
    image.style.display = "block";
  } else {
    image.style.display = "none";
  }

  // 모달 표시 및 닫기 버튼 이벤트 설정
  modal.style.display = "block";

  const closeBtn = modal.querySelector(".close");
  const closeModal = () => {
    modal.style.display = "none";
  };

  // 기존 이벤트 리스너 제거 후 새로 추가
  closeBtn?.removeEventListener("click", closeModal);
  closeBtn?.addEventListener("click", closeModal);

  // 모달 외부 클릭시 닫기
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
}
// products.js에 추가
async function showDetails(itemId) {
  const modalManager = setupModal("detailModal");
  if (!modalManager) return;

  const item = state.currentData.find((data) => data.item_id == itemId);
  if (!item) return;

  // 기본 정보로 모달 초기화
  initializeModal(item);
  modalManager.show();

  // 로딩 표시
  showLoadingInModal();

  try {
    // 상세 정보 가져오기
    const updatedItem = await API.fetchAPI(
      `/crawler/crawl-item-details/${itemId}`,
      {
        method: "POST",
      }
    );

    // 상세 정보 업데이트
    updateModalWithDetails(updatedItem);

    // 추가 이미지가 있다면 업데이트
    if (updatedItem.additional_images) {
      initializeImages(JSON.parse(updatedItem.additional_images));
    }
  } catch (error) {
    console.error("Failed to fetch item details:", error);
  } finally {
    hideLoadingInModal();
  }
}

function initializeModal(item) {
  document.querySelector(".modal-brand").textContent = item.brand;
  document.querySelector(".modal-title").textContent = removeLeadingBrackets(
    item.korean_title
  );
  document.querySelector(".main-image").src = API.validateImageUrl(item.image);
  document.querySelector(".modal-description").textContent = "로딩 중...";
  document.querySelector(".modal-category").textContent =
    item.category || "로딩 중...";
  document.querySelector(".modal-brand2").textContent = item.brand;
  document.querySelector(".modal-accessory-code").textContent =
    item.accessory_code || "로딩 중...";
  document.querySelector(".modal-scheduled-date").textContent =
    formatDate(item.scheduled_date) || "로딩 중...";

  // 입찰 정보 초기화
  initializeBidInfo(item.item_id);

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
    item.scheduled_date ? formatDate(item.scheduled_date) : "날짜 정보 없음";
  document.querySelector(".modal-brand").textContent = item.brand;
  document.querySelector(".modal-brand2").textContent = item.brand;
  document.querySelector(".modal-title").textContent =
    removeLeadingBrackets(item.korean_title) || "제목 없음";
}
function initializeBidInfo(itemId) {
  const bidInfo = state.bidData.find((b) => b.item_id == itemId);
  const item = state.currentData.find((i) => i.item_id == itemId);
  const bidSection = document.querySelector(".modal-content .bid-info-holder");

  if (!bidSection) return;

  if (bidInfo) {
    bidSection.innerHTML = getBidSectionHTML(
      bidInfo,
      itemId,
      item.auc_num,
      item.category
    );
  } else {
    bidSection.innerHTML = getDefaultBidSectionHTML(itemId);
  }

  // 입찰 금액 입력 시 가격 계산기 초기화
  const input = bidSection.querySelector(".bid-input");
  const priceContainer = bidSection.querySelector(".price-details-container");

  if (input && priceContainer && item) {
    input.addEventListener("input", function () {
      const priceContainer =
        this.closest(".bid-input-group").nextElementSibling;
      const price = parseFloat(this.value) || 0;
      const totalPrice = calculateTotalPrice(
        price,
        item.auc_num,
        item.category
      );
      priceContainer.innerHTML = price
        ? `(현지수수료+관세+수수료5% 기준 ${formatNumber(totalPrice)}원)`
        : "";
    });
  }
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
  const wishlistBtn = card?.querySelector(".wishlist-btn");
  if (wishlistBtn) {
    wishlistBtn.classList.toggle("active", state.wishlist.includes(itemId));
  }

  // 모달의 위시리스트 버튼 업데이트 (있는 경우)
  const modalWishlistBtn = document.querySelector(
    ".modal-content .wishlist-btn"
  );
  if (modalWishlistBtn) {
    modalWishlistBtn.classList.toggle(
      "active",
      state.wishlist.includes(itemId)
    );
  }
}

// 이미지 네비게이션 이벤트 리스너 설정
function setupImageNavigation() {
  document.querySelector(".prev")?.addEventListener("click", () => {
    changeMainImage(state.currentImageIndex - 1);
  });

  document.querySelector(".next")?.addEventListener("click", () => {
    changeMainImage(state.currentImageIndex + 1);
  });
}

async function initialize() {
  await API.initialize();
  await checkAuthStatus();

  try {
    // 필터 데이터 가져오기
    const [
      brandsResponse,
      categoriesResponse,
      datesResponse,
      ranksResponse,
      aucNumsResponse,
    ] = await Promise.all([
      API.fetchAPI("/data/brands-with-count"),
      API.fetchAPI("/data/categories"),
      API.fetchAPI("/data/scheduled-dates-with-count"),
      API.fetchAPI("/data/ranks"),
      API.fetchAPI("/data/auc-nums"), // 추가
    ]);
    // 각각의 필터 데이터 전달
    displayFilters(
      brandsResponse,
      categoriesResponse,
      datesResponse,
      ranksResponse,
      aucNumsResponse
    );

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
      .getElementById("applyFiltersBtn")
      ?.addEventListener("click", () => {
        state.currentPage = 1;
        fetchData();
      });

    document.getElementById("signinBtn")?.addEventListener("click", () => {
      window.location.href = "./pages/signin.html";
    });

    document
      .getElementById("signoutBtn")
      ?.addEventListener("click", handleSignout);
    document
      .getElementById("showNoticesBtn")
      ?.addEventListener("click", showNoticeSection);

    document.querySelectorAll(".filter-toggle-btn").forEach((btn) => {
      btn.addEventListener("click", function () {
        this.classList.toggle("active");
        fetchData(); // 필터 적용
      });
    });
    // 초기 데이터 로드
    await fetchData();
  } catch (error) {
    console.error("Error initializing filters:", error);
    alert("필터 데이터를 불러오는 데 실패했습니다.");
  }
}

// 페이지 로드 시 초기화
document.addEventListener("DOMContentLoaded", initialize);
