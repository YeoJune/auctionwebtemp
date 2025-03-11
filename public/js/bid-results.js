// public/js/bid-results.js

// 상태 관리
window.state = {
  bidType: "all",
  status: "all",
  dateRange: 30,
  currentPage: 1,
  itemsPerPage: 10,
  liveBids: [],
  directBids: [],
  combinedResults: [],
  filteredResults: [],
  totalItems: 0,
  totalPages: 0,
  isAuthenticated: false,
  images: [],
  currentImageIndex: 0,
};

// 상태 정의
const STATUS_TYPES = {
  // 완료 상태
  COMPLETED: "completed",
  // 취소 상태
  CANCELLED: "cancelled",
  // 진행 중 상태들 (직접 경매)
  ACTIVE: "active",
  // 진행 중 상태들 (현장 경매)
  FIRST: "first",
  SECOND: "second",
  FINAL: "final",
};

// 상태 그룹
const STATUS_GROUPS = {
  COMPLETED: [STATUS_TYPES.COMPLETED],
  CANCELLED: [STATUS_TYPES.CANCELLED],
  INPROGRESS: [
    STATUS_TYPES.ACTIVE,
    STATUS_TYPES.FIRST,
    STATUS_TYPES.SECOND,
    STATUS_TYPES.FINAL,
  ],
};

// 상태 표시 텍스트
const STATUS_DISPLAY = {
  [STATUS_TYPES.COMPLETED]: "낙찰됨",
  [STATUS_TYPES.CANCELLED]: "취소됨",
  [STATUS_TYPES.ACTIVE]: "입찰중",
  [STATUS_TYPES.FIRST]: "1차 입찰",
  [STATUS_TYPES.SECOND]: "2차 제안",
  [STATUS_TYPES.FINAL]: "최종 입찰",
};

// 상태 CSS 클래스
const STATUS_CLASSES = {
  [STATUS_TYPES.COMPLETED]: "completed",
  [STATUS_TYPES.CANCELLED]: "cancelled",
  [STATUS_TYPES.ACTIVE]: "status-active",
  [STATUS_TYPES.FIRST]: "status-first",
  [STATUS_TYPES.SECOND]: "status-second",
  [STATUS_TYPES.FINAL]: "status-final",
};

// 초기화 함수
async function initialize() {
  try {
    // API 초기화
    await API.initialize();

    // 인증 상태 확인
    await checkAuthStatus();

    // 네비게이션 버튼 설정
    setupNavButtons();

    // 이벤트 리스너 설정
    setupEventListeners();

    // 초기 데이터 로드
    await fetchResults();
  } catch (error) {
    console.error("초기화 중 오류 발생:", error);
    alert("페이지 초기화 중 오류가 발생했습니다.");
  }
}

// 인증 관련 함수
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

  if (!signinBtn || !signoutBtn) return;

  if (state.isAuthenticated) {
    signinBtn.style.display = "none";
    signoutBtn.style.display = "inline-block";
  } else {
    signinBtn.style.display = "inline-block";
    signoutBtn.style.display = "none";
    // 로그인되지 않은 경우 로그인 페이지로 리다이렉트
    window.location.href = "/signinPage";
  }
}

async function handleSignout() {
  try {
    await API.fetchAPI("/auth/logout", { method: "POST" });
    state.isAuthenticated = false;
    window.location.href = "/signinPage";
  } catch (error) {
    alert("로그아웃 중 오류가 발생했습니다.");
  }
}

// 이벤트 리스너 설정
function setupEventListeners() {
  // 경매 타입 라디오 버튼
  document.querySelectorAll('input[name="bidType"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      state.bidType = e.target.value;
    });
  });

  // 상태 라디오 버튼
  document.querySelectorAll('input[name="status"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      state.status = e.target.value;
    });
  });

  // 기간 드롭다운
  document.getElementById("dateRange")?.addEventListener("change", (e) => {
    state.dateRange = parseInt(e.target.value);
  });

  // 필터 적용 버튼
  document.getElementById("applyFilters")?.addEventListener("click", () => {
    state.currentPage = 1;
    fetchResults();
  });

  // 로그아웃 버튼
  document
    .getElementById("signoutBtn")
    ?.addEventListener("click", handleSignout);

  // 상세 모달 닫기 버튼
  const closeBtn = document.querySelector(".modal .close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      document.getElementById("detailModal").style.display = "none";
    });
  }

  // 외부 클릭 시 모달 닫기
  window.addEventListener("click", (e) => {
    const modal = document.getElementById("detailModal");
    if (e.target === modal) {
      modal.style.display = "none";
    }
  });

  // 이미지 네비게이션 버튼
  const prevBtn = document.querySelector(".image-nav.prev");
  const nextBtn = document.querySelector(".image-nav.next");

  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      changeMainImage(state.currentImageIndex - 1);
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      changeMainImage(state.currentImageIndex + 1);
    });
  }
}

// 데이터 가져오기
async function fetchResults() {
  if (!state.isAuthenticated) {
    return;
  }

  toggleLoading(true);

  try {
    // 선택된 상태에 따라 API 파라미터 준비
    let statusParam;

    switch (state.status) {
      case "completed":
        statusParam = STATUS_TYPES.COMPLETED;
        break;
      case "cancelled":
        statusParam = STATUS_TYPES.CANCELLED;
        break;
      case "inprogress":
        // 진행중인 상태들은 API에서 각각 요청해야 함
        // 그러나 현재 API는 여러 상태를 동시에 요청할 수 있으므로
        // 진행중인 모든 상태를 콤마로 구분하여 전달
        statusParam = STATUS_GROUPS.INPROGRESS.join(",");
        break;
      case "all":
      default:
        // 전체 상태 (모든 상태 요청)
        statusParam = [
          ...STATUS_GROUPS.COMPLETED,
          ...STATUS_GROUPS.CANCELLED,
          ...STATUS_GROUPS.INPROGRESS,
        ].join(",");
        break;
    }

    let liveBidsPromise, directBidsPromise;

    // 현장 경매 결과 가져오기 (bidType이 'direct'가 아닌 경우)
    if (state.bidType !== "direct") {
      liveBidsPromise = API.fetchAPI(`/live-bids?status=${statusParam}`);
    } else {
      liveBidsPromise = Promise.resolve({ bids: [] });
    }

    // 직접 경매 결과 가져오기 (bidType이 'live'가 아닌 경우)
    if (state.bidType !== "live") {
      directBidsPromise = API.fetchAPI(`/direct-bids?status=${statusParam}`);
    } else {
      directBidsPromise = Promise.resolve({ bids: [] });
    }

    // 두 API 요청 병렬로 처리
    const [liveResults, directResults] = await Promise.all([
      liveBidsPromise,
      directBidsPromise,
    ]);

    // 저장
    state.liveBids = liveResults.bids || [];
    state.directBids = directResults.bids || [];

    // 결합 및 타입 정보 추가
    state.combinedResults = [
      ...state.liveBids.map((bid) => ({ ...bid, type: "live" })),
      ...state.directBids.map((bid) => ({ ...bid, type: "direct" })),
    ];

    // 날짜 기준으로 필터링
    applyDateFilter();

    // 정렬 및 표시
    sortAndDisplayResults();
  } catch (error) {
    console.error("입찰 결과를 가져오는 중 오류 발생:", error);
    document.getElementById("bidResultsList").innerHTML =
      '<div class="no-results">데이터를 불러오는 데 실패했습니다.</div>';
  } finally {
    toggleLoading(false);
  }
}

// 날짜 필터 적용
function applyDateFilter() {
  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - state.dateRange);

  state.filteredResults = state.combinedResults.filter((bid) => {
    const bidDate = new Date(bid.updated_at);
    return bidDate >= dateLimit;
  });
}

// 정렬 및 표시
function sortAndDisplayResults() {
  // 날짜 기준 내림차순 정렬 (최신순)
  state.filteredResults.sort(
    (a, b) => new Date(b.updated_at) - new Date(a.updated_at)
  );

  // 페이지네이션 계산
  state.totalItems = state.filteredResults.length;
  state.totalPages = Math.ceil(state.totalItems / state.itemsPerPage);

  // 결과 표시
  displayResults();

  // 페이지네이션 업데이트
  updatePagination();
}

// 로딩 표시 토글
function toggleLoading(show) {
  const loadingMsg = document.getElementById("loadingMsg");
  if (loadingMsg) {
    loadingMsg.style.display = show ? "block" : "none";
  }
}

// 페이지네이션 업데이트
function updatePagination() {
  const paginationElement = document.getElementById("pagination");

  // 페이지네이션 엘리먼트가 없으면 종료
  if (!paginationElement) return;

  // 결과가 없거나 단일 페이지인 경우 페이지네이션 비우기
  if (state.totalItems === 0 || state.totalPages <= 1) {
    paginationElement.innerHTML = "";
    return;
  }

  createPagination(state.currentPage, state.totalPages, handlePageChange);
}

// 페이지 변경 처리
function handlePageChange(page) {
  // 페이지가 숫자가 아니면 숫자로 변환
  page = parseInt(page, 10);

  // 같은 페이지 클릭 시 무시
  if (page === state.currentPage) return;

  console.log("Page changed from", state.currentPage, "to", page);
  state.currentPage = page;
  displayResults();
  window.scrollTo(0, 0);
}

// 상태에 맞는 표시 텍스트 반환
function getStatusDisplay(status) {
  return STATUS_DISPLAY[status] || "알 수 없음";
}

// 상태에 맞는 CSS 클래스 반환
function getStatusClass(status) {
  return STATUS_CLASSES[status] || "inprogress";
}

// 결과 표시
function displayResults() {
  const container = document.getElementById("bidResultsList");
  container.innerHTML = "";

  document.getElementById("totalResults").textContent = state.totalItems;

  if (state.filteredResults.length === 0) {
    container.innerHTML = '<div class="no-results">입찰 결과가 없습니다.</div>';
    return;
  }

  // 현재 페이지에 해당하는 결과만 표시
  const startIdx = (state.currentPage - 1) * state.itemsPerPage;
  const endIdx = Math.min(
    startIdx + state.itemsPerPage,
    state.filteredResults.length
  );

  for (let i = startIdx; i < endIdx; i++) {
    const bid = state.filteredResults[i];
    const item = bid.item;

    if (!item) continue; // 아이템 정보가 없는 경우 건너뛰기

    const resultItem = document.createElement("div");
    resultItem.className = "bid-result-item";
    resultItem.dataset.itemId = item.item_id;
    resultItem.dataset.bidId = bid.id;
    resultItem.dataset.bidType = bid.type;

    // 이미지 섹션
    const imageSection = document.createElement("div");
    imageSection.className = "item-image";
    imageSection.innerHTML = `
        <img src="${API.validateImageUrl(item.image)}" alt="${
      item.original_title || "상품 이미지"
    }">
        <div class="item-rank">${item.rank || "N"}</div>
      `;

    // 상품 정보 섹션
    const infoSection = document.createElement("div");
    infoSection.className = "item-info";
    infoSection.innerHTML = `
        <div class="item-brand">${item.brand || "-"}</div>
        <div class="item-title">${
          item.original_title || item.title || "제목 없음"
        }</div>
        <div class="item-category">${item.category || "-"}</div>
      `;

    // 입찰 정보 섹션
    const bidInfoSection = document.createElement("div");
    bidInfoSection.className = "bid-info";

    let bidInfoHTML = `
        <div class="bid-type ${
          bid.type === "live" ? "live-type" : "direct-type"
        }">
          ${bid.type === "live" ? "현장 경매" : "직접 경매"}
        </div>
      `;

    if (bid.type === "live") {
      bidInfoHTML += `
          <div class="price-stages">
            ${
              bid.first_price
                ? `
              <div class="price-row">
                <span class="price-label">1차 입찰:</span>
                <span class="price-value">${formatNumber(
                  bid.first_price
                )} ¥</span>
              </div>
            `
                : ""
            }
            ${
              bid.second_price
                ? `
              <div class="price-row">
                <span class="price-label">2차 제안:</span>
                <span class="price-value">${formatNumber(
                  bid.second_price
                )} ¥</span>
              </div>
            `
                : ""
            }
            ${
              bid.final_price
                ? `
              <div class="price-row">
                <span class="price-label">최종 입찰:</span>
                <span class="price-value">${formatNumber(
                  bid.final_price
                )} ¥</span>
              </div>
            `
                : ""
            }
          </div>
        `;
    } else {
      bidInfoHTML += `
          <div class="price-row">
            <span class="price-label">입찰 금액:</span>
            <span class="price-value">${formatNumber(
              bid.current_price
            )} ¥</span>
          </div>
        `;
    }

    bidInfoSection.innerHTML = bidInfoHTML;

    // 결과 상태 섹션
    const statusSection = document.createElement("div");
    statusSection.className = "result-status";

    // 상태에 따라 다른 표시와 클래스 적용
    const statusClass = getStatusClass(bid.status);
    const statusText = getStatusDisplay(bid.status);

    statusSection.innerHTML = `
        <div class="status-badge ${statusClass}">
          ${statusText}
        </div>
        <div class="result-date">${formatDateTime(bid.updated_at)}</div>
      `;

    // 모든 섹션 추가
    resultItem.appendChild(imageSection);
    resultItem.appendChild(infoSection);
    resultItem.appendChild(bidInfoSection);
    resultItem.appendChild(statusSection);

    // 클릭 이벤트 추가
    resultItem.addEventListener("click", () => {
      showItemDetails(item.item_id);
    });

    // 컨테이너에 아이템 추가
    container.appendChild(resultItem);
  }
}

// 상세 정보 표시
async function showItemDetails(itemId) {
  const modalManager = setupModal("detailModal");
  if (!modalManager) return;

  const item = state.filteredResults.find(
    (r) => r.item?.item_id === itemId
  )?.item;
  if (!item) return;

  // 기본 정보로 모달 초기화
  initializeModal(item);
  modalManager.show();

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
      initializeImages(JSON.parse(updatedItem.additional_images));
    }
  } catch (error) {
    console.error("Failed to fetch item details:", error);
  } finally {
    hideLoadingInModal();
  }
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
  document.querySelector(".modal-brand").textContent = item.brand || "-";
  document.querySelector(".modal-brand2").textContent = item.brand || "-";
  document.querySelector(".modal-title").textContent =
    item.original_title || item.title || "제목 없음";
  document.querySelector(".modal-rank").textContent = item.rank || "N";
}

function initializeModal(item) {
  document.querySelector(".modal-brand").textContent = item.brand || "-";
  document.querySelector(".modal-title").textContent =
    item.original_title || item.title || "-";
  document.querySelector(".main-image").src = API.validateImageUrl(item.image);
  document.querySelector(".modal-description").textContent = "로딩 중...";
  document.querySelector(".modal-category").textContent =
    item.category || "로딩 중...";
  document.querySelector(".modal-brand2").textContent = item.brand || "-";
  document.querySelector(".modal-accessory-code").textContent =
    item.accessory_code || "로딩 중...";
  document.querySelector(".modal-scheduled-date").textContent =
    formatDateTime(item.scheduled_date) || "로딩 중...";
  document.querySelector(".modal-rank").textContent = item.rank || "N";

  // 입찰 정보 표시
  displayBidInfoInModal(item.item_id);

  // 이미지 초기화
  initializeImages([item.image]);
}

function displayBidInfoInModal(itemId) {
  const bidInfo = state.filteredResults.find(
    (result) => result.item?.item_id === itemId
  );
  const bidInfoHolder = document.querySelector(".bid-info-holder");

  if (!bidInfo || !bidInfoHolder) return;

  // 상태에 따라 다른 표시와 클래스 적용
  const statusClass = getStatusClass(bidInfo.status);
  const statusText = getStatusDisplay(bidInfo.status);

  let bidInfoHTML = `
      <div class="modal-bid-info">
        <div class="bid-status ${statusClass}">
          ${statusText}
        </div>
        <div class="bid-date">
          <strong>결과 일시:</strong> ${formatDateTime(bidInfo.updated_at)}
        </div>
    `;

  if (bidInfo.type === "live") {
    bidInfoHTML += `
        <div class="bid-type">
          <strong>경매 유형:</strong> 현장 경매
        </div>
        <div class="bid-prices">
          ${
            bidInfo.first_price
              ? `<div class="price-item">
              <strong>1차 입찰:</strong> ${formatNumber(bidInfo.first_price)} ¥
            </div>`
              : ""
          }
          ${
            bidInfo.second_price
              ? `<div class="price-item">
              <strong>2차 제안:</strong> ${formatNumber(bidInfo.second_price)} ¥
            </div>`
              : ""
          }
          ${
            bidInfo.final_price
              ? `<div class="price-item">
              <strong>최종 입찰:</strong> ${formatNumber(bidInfo.final_price)} ¥
            </div>`
              : ""
          }
        </div>
      `;
  } else {
    bidInfoHTML += `
        <div class="bid-type">
          <strong>경매 유형:</strong> 직접 경매
        </div>
        <div class="bid-prices">
          <div class="price-item">
            <strong>입찰 금액:</strong> ${formatNumber(bidInfo.current_price)} ¥
          </div>
        </div>
      `;
  }

  bidInfoHTML += "</div>";

  bidInfoHolder.innerHTML = bidInfoHTML;
}

function initializeImages(imageUrls) {
  const validImageUrls = imageUrls.filter((url) => url);

  state.images = validImageUrls;
  state.currentImageIndex = 0;

  const mainImage = document.querySelector(".main-image");
  const thumbnailContainer = document.querySelector(".thumbnail-container");

  if (!mainImage || !thumbnailContainer) return;

  // 메인 이미지 설정
  if (validImageUrls.length > 0) {
    mainImage.src = API.validateImageUrl(validImageUrls[0]);
  }

  // 썸네일 초기화
  thumbnailContainer.innerHTML = "";

  validImageUrls.forEach((img, index) => {
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

function setupNavButtons() {
  // 상품 리스트 버튼
  document.getElementById("productListBtn")?.addEventListener("click", () => {
    window.location.href = "/productPage";
  });

  // 즐겨찾기 버튼
  document.getElementById("favoritesBtn")?.addEventListener("click", () => {
    // 즐겨찾기 필터 설정 및 페이지 이동
    localStorage.setItem("favoriteFilter", "true");
    window.location.href = "/productPage";
  });

  // 입찰 항목 버튼
  document.getElementById("bidItemsBtn")?.addEventListener("click", () => {
    // 입찰 항목 필터 설정 및 페이지 이동
    localStorage.setItem("bidItemsFilter", "true");
    window.location.href = "/productPage";
  });

  // 현재 페이지이므로 별도 처리 없음
  // 낙찰 시세표 버튼은 onclick 속성으로 이미 처리됨
}

// DOM 완료 시 실행
document.addEventListener("DOMContentLoaded", initialize);
