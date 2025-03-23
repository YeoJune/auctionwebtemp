// public/js/bid-products.js

// 상태 관리
window.state = {
  bidType: "all", // 경매 타입: all, live, direct
  status: "active", // 상태: active, first, second, final (기본값은 진행 중인 경매만 표시)
  dateRange: 30, // 날짜 범위(일)
  currentPage: 1, // 현재 페이지
  itemsPerPage: 12, // 페이지당 아이템 수
  sortBy: "scheduled_date", // 정렬 기준 (예정일 기준)
  sortOrder: "asc", // 정렬 순서 (오름차순)
  keyword: "", // 검색 키워드
  viewMode: "grid", // 보기 모드: grid, list
  products: [], // 상품 데이터
  totalItems: 0, // 전체 아이템 수
  totalPages: 0, // 전체 페이지 수
  isAuthenticated: false, // 인증 상태
  images: [], // 이미지 배열
  currentImageIndex: 0, // 현재 이미지 인덱스
};

// 상태 정의
const STATUS_TYPES = {
  // 직접 경매
  ACTIVE: "active",
  // 현장 경매
  FIRST: "first",
  SECOND: "second",
  FINAL: "final",
};

// 상태 그룹
const STATUS_GROUPS = {
  ACTIVE_ALL: [
    STATUS_TYPES.ACTIVE,
    STATUS_TYPES.FIRST,
    STATUS_TYPES.SECOND,
    STATUS_TYPES.FINAL,
  ],
};

// 상태 표시 텍스트
const STATUS_DISPLAY = {
  [STATUS_TYPES.ACTIVE]: "입찰 가능",
  [STATUS_TYPES.FIRST]: "1차 입찰",
  [STATUS_TYPES.SECOND]: "2차 제안",
  [STATUS_TYPES.FINAL]: "최종 입찰",
};

// 상태 CSS 클래스
const STATUS_CLASSES = {
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

    // URL 파라미터에서 초기 상태 로드
    loadStateFromURL();

    // 네비게이션 버튼 설정
    setupNavButtons();

    // 이벤트 리스너 설정
    setupEventListeners();

    // 초기 데이터 로드
    await fetchProducts();

    // 뷰 모드 설정
    applyViewMode();

    // 정렬 상태 표시 업데이트
    updateSortButtonsUI();
  } catch (error) {
    console.error("초기화 중 오류 발생:", error);
    alert("페이지 초기화 중 오류가 발생했습니다.");
  }
}

// URL에서 상태 로드
function loadStateFromURL() {
  const urlParams = new URLSearchParams(window.location.search);

  // 정렬 및 필터 파라미터 로드
  if (urlParams.has("bidType")) state.bidType = urlParams.get("bidType");
  if (urlParams.has("status")) state.status = urlParams.get("status");
  if (urlParams.has("dateRange"))
    state.dateRange = parseInt(urlParams.get("dateRange"));
  if (urlParams.has("page"))
    state.currentPage = parseInt(urlParams.get("page"));
  if (urlParams.has("sortBy")) state.sortBy = urlParams.get("sortBy");
  if (urlParams.has("sortOrder")) state.sortOrder = urlParams.get("sortOrder");
  if (urlParams.has("keyword")) state.keyword = urlParams.get("keyword");
  if (urlParams.has("viewMode")) state.viewMode = urlParams.get("viewMode");

  // UI 요소 상태 업데이트
  updateUIFromState();
}

// URL 업데이트
function updateURL() {
  const params = new URLSearchParams();

  // 기본 파라미터 추가
  if (state.bidType !== "all") params.append("bidType", state.bidType);
  if (state.status !== "active") params.append("status", state.status);
  if (state.dateRange !== 30) params.append("dateRange", state.dateRange);
  if (state.currentPage !== 1) params.append("page", state.currentPage);
  if (state.sortBy !== "scheduled_date") params.append("sortBy", state.sortBy);
  if (state.sortOrder !== "asc") params.append("sortOrder", state.sortOrder);
  if (state.keyword) params.append("keyword", state.keyword);
  if (state.viewMode !== "grid") params.append("viewMode", state.viewMode);

  // URL 업데이트 (history API 사용)
  const url = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, "", url);
}

// UI 요소 상태 업데이트
function updateUIFromState() {
  // 경매 타입 라디오 버튼
  document.querySelectorAll('input[name="bidType"]').forEach((radio) => {
    radio.checked = radio.value === state.bidType;
  });

  // 상태 라디오 버튼
  document.querySelectorAll('input[name="status"]').forEach((radio) => {
    radio.checked = radio.value === state.status;
  });

  // 날짜 범위 선택
  const dateRange = document.getElementById("dateRange");
  if (dateRange) dateRange.value = state.dateRange;

  // 정렬 관련 UI 업데이트
  updateSortButtonsUI();

  // 검색어 입력 필드
  const searchInput = document.getElementById("searchInput");
  if (searchInput) searchInput.value = state.keyword;

  // 뷰 모드 버튼
  document.querySelectorAll(".view-mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === state.viewMode);
  });
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

// 상품 데이터 가져오기
// 상품 데이터 가져오기
async function fetchProducts() {
  if (!state.isAuthenticated) {
    return;
  }

  toggleLoading(true);

  try {
    // 선택된 상태에 따라 API 파라미터 준비
    let statusParam;

    if (state.status === "all") {
      statusParam = STATUS_GROUPS.ACTIVE_ALL.join(",");
    } else {
      statusParam = state.status;
    }

    // 날짜 범위 계산
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - state.dateRange);
    const fromDate = formatDate(dateLimit);

    // 정렬 및 페이지네이션 파라미터
    const params = {
      status: statusParam,
      fromDate: fromDate,
      page: state.currentPage,
      limit: state.itemsPerPage,
      sortBy: state.sortBy,
      sortOrder: state.sortOrder,
    };

    // 검색어 파라미터
    if (state.keyword) {
      params.keyword = state.keyword;
    }

    // API 요청 URL 생성
    const queryString = API.createURLParams(params);

    // 경매 타입에 따라 다른 엔드포인트 사용 - 기존 API 활용
    let liveBidsPromise, directBidsPromise;

    if (state.bidType === "live" || state.bidType === "all") {
      liveBidsPromise = API.fetchAPI(`/live-bids?${queryString}`);
    } else {
      liveBidsPromise = Promise.resolve({ bids: [] });
    }

    if (state.bidType === "direct" || state.bidType === "all") {
      directBidsPromise = API.fetchAPI(`/direct-bids?${queryString}`);
    } else {
      directBidsPromise = Promise.resolve({ bids: [] });
    }

    // 두 API 요청 병렬로 처리
    const [liveResults, directResults] = await Promise.all([
      liveBidsPromise,
      directBidsPromise,
    ]);

    // 결합 및 타입 정보 추가
    const combinedResults = [
      ...(liveResults.bids || []).map((bid) => ({ ...bid, type: "live" })),
      ...(directResults.bids || []).map((bid) => ({ ...bid, type: "direct" })),
    ];

    // 상태 업데이트
    state.products = combinedResults;
    state.totalItems = (liveResults.total || 0) + (directResults.total || 0);
    state.totalPages = Math.ceil(state.totalItems / state.itemsPerPage);

    // URL 업데이트
    updateURL();

    // 결과 표시
    displayProducts();

    // 페이지네이션 업데이트
    updatePagination();
  } catch (error) {
    console.error("상품 데이터를 가져오는 중 오류 발생:", error);
    document.getElementById("productList").innerHTML =
      '<div class="no-results">데이터를 불러오는 데 실패했습니다.</div>';
  } finally {
    toggleLoading(false);
  }
}

// 이벤트 리스너 설정
function setupEventListeners() {
  // 경매 타입 라디오 버튼
  document.querySelectorAll('input[name="bidType"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      state.bidType = e.target.value;
      state.currentPage = 1; // 페이지 초기화
      fetchProducts();
    });
  });

  // 상태 라디오 버튼
  document.querySelectorAll('input[name="status"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      state.status = e.target.value;
      state.currentPage = 1; // 페이지 초기화
      fetchProducts();
    });
  });

  // 기간 드롭다운
  document.getElementById("dateRange")?.addEventListener("change", (e) => {
    state.dateRange = parseInt(e.target.value);
    state.currentPage = 1; // 페이지 초기화
    fetchProducts();
  });

  // 정렬 버튼들
  const sortButtons = document.querySelectorAll(".sort-btn");
  sortButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      handleSortChange(btn.dataset.sort);
    });
  });

  // 검색 폼
  const searchForm = document.getElementById("searchForm");
  if (searchForm) {
    searchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const searchInput = document.getElementById("searchInput");
      state.keyword = searchInput.value.trim();
      state.currentPage = 1; // 페이지 초기화
      fetchProducts();
    });
  }

  // 검색 초기화 버튼
  const clearSearchBtn = document.getElementById("clearSearch");
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener("click", () => {
      const searchInput = document.getElementById("searchInput");
      searchInput.value = "";
      state.keyword = "";
      state.currentPage = 1; // 페이지 초기화
      fetchProducts();
    });
  }

  // 뷰 모드 전환 버튼
  document.querySelectorAll(".view-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.viewMode = btn.dataset.mode;
      applyViewMode();
      updateURL();
    });
  });

  // 필터 적용 버튼
  document.getElementById("applyFilters")?.addEventListener("click", () => {
    state.currentPage = 1; // 페이지 초기화
    fetchProducts();
  });

  // 필터 초기화 버튼
  document.getElementById("resetFilters")?.addEventListener("click", () => {
    resetFilters();
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

  // 모바일 필터 토글 설정
  setupMobileFilters();
}

// 정렬 변경 처리
function handleSortChange(sortKey) {
  if (state.sortBy === sortKey) {
    // 같은 정렬 기준이면 정렬 방향 전환
    state.sortOrder = state.sortOrder === "asc" ? "desc" : "asc";
  } else {
    // 새로운 정렬 기준, 기본 정렬 방향 설정
    state.sortBy = sortKey;

    // 날짜는 오름차순, 가격은 내림차순을 기본으로
    if (sortKey === "scheduled_date") {
      state.sortOrder = "asc";
    } else if (sortKey === "starting_price" || sortKey === "current_price") {
      state.sortOrder = "desc";
    } else {
      state.sortOrder = "asc";
    }
  }

  // UI 업데이트
  updateSortButtonsUI();

  // 데이터 다시 로드
  state.currentPage = 1;
  fetchProducts();
}

// 정렬 버튼 UI 업데이트
function updateSortButtonsUI() {
  const sortButtons = document.querySelectorAll(".sort-btn");

  sortButtons.forEach((btn) => {
    // 모든 버튼에서 active 클래스와 방향 표시 제거
    btn.classList.remove("active", "asc", "desc");

    // 현재 정렬 기준인 버튼에 클래스 추가
    if (btn.dataset.sort === state.sortBy) {
      btn.classList.add("active", state.sortOrder);
    }
  });
}

// 필터 초기화
function resetFilters() {
  state.status = "active";
  state.bidType = "all";
  state.dateRange = 30;
  state.keyword = "";
  state.currentPage = 1;

  // UI 요소 초기화
  document.querySelectorAll('input[name="bidType"]').forEach((radio) => {
    radio.checked = radio.value === "all";
  });

  document.querySelectorAll('input[name="status"]').forEach((radio) => {
    radio.checked = radio.value === "active";
  });

  const dateRange = document.getElementById("dateRange");
  if (dateRange) dateRange.value = "30";

  const searchInput = document.getElementById("searchInput");
  if (searchInput) searchInput.value = "";

  // 데이터 다시 로드
  fetchProducts();
}

// 뷰 모드 적용
function applyViewMode() {
  const productList = document.getElementById("productList");
  if (!productList) return;

  // 클래스 전환
  productList.classList.remove("grid-view", "list-view");
  productList.classList.add(`${state.viewMode}-view`);

  // 버튼 활성화 상태 업데이트
  document.querySelectorAll(".view-mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === state.viewMode);
  });
}

// 상태에 맞는 표시 텍스트 반환
function getStatusDisplay(status) {
  return STATUS_DISPLAY[status] || "알 수 없음";
}

// 상태에 맞는 CSS 클래스 반환
function getStatusClass(status) {
  return STATUS_CLASSES[status] || "status-default";
}

// 결과 표시
function displayProducts() {
  const container = document.getElementById("productList");
  if (!container) return;

  container.innerHTML = "";
  document.getElementById("totalResults").textContent = state.totalItems;

  if (state.products.length === 0) {
    container.innerHTML =
      '<div class="no-results">표시할 상품이 없습니다.</div>';
    return;
  }

  // 뷰 모드에 따른 컨테이너 클래스 설정
  container.className = `product-list ${state.viewMode}-view`;

  state.products.forEach((product) => {
    const productCard = document.createElement("div");
    productCard.className = "product-card";
    productCard.dataset.itemId = product.item_id;

    // 그리드 뷰와 리스트 뷰에 맞는 구조 생성
    if (state.viewMode === "grid") {
      productCard.innerHTML = createGridProductHTML(product);
    } else {
      productCard.innerHTML = createListProductHTML(product);
    }

    // 클릭 이벤트 추가
    productCard.addEventListener("click", () => {
      showProductDetails(product.item_id);
    });

    // 입찰 버튼 이벤트 (이벤트 버블링 방지)
    const bidButton = productCard.querySelector(".bid-button");
    if (bidButton) {
      bidButton.addEventListener("click", (e) => {
        e.stopPropagation();
        showBidFormModal(product);
      });
    }

    container.appendChild(productCard);
  });
}

// 그리드 뷰 HTML 생성
function createGridProductHTML(product) {
  const statusClass = getStatusClass(product.status || "active");
  const statusText = getStatusDisplay(product.status || "active");

  return `
      <div class="product-image">
        <img src="${API.validateImageUrl(product.image)}" alt="${
    product.original_title || "상품 이미지"
  }">
        <div class="product-rank">${product.rank || "N"}</div>
        <div class="status-badge ${statusClass}">${statusText}</div>
      </div>
      <div class="product-info">
        <div class="product-brand">${product.brand || "-"}</div>
        <div class="product-title">${
          product.original_title || "제목 없음"
        }</div>
        <div class="product-price">￥${formatNumber(
          product.starting_price || 0
        )}</div>
        <div class="product-date">예정일: ${formatDate(
          product.scheduled_date
        )}</div>
        <button class="bid-button">입찰하기</button>
      </div>
    `;
}

// 리스트 뷰 HTML 생성
function createListProductHTML(product) {
  const statusClass = getStatusClass(product.status || "active");
  const statusText = getStatusDisplay(product.status || "active");

  return `
      <div class="product-image">
        <img src="${API.validateImageUrl(product.image)}" alt="${
    product.original_title || "상품 이미지"
  }">
        <div class="product-rank">${product.rank || "N"}</div>
      </div>
      <div class="product-info">
        <div class="top-row">
          <div>
            <div class="product-brand">${product.brand || "-"}</div>
            <div class="product-title">${
              product.original_title || "제목 없음"
            }</div>
          </div>
          <div class="status-badge ${statusClass}">${statusText}</div>
        </div>
        <div class="middle-row">
          <div class="product-category">${product.category || "-"}</div>
          <div class="product-date">예정일: ${formatDate(
            product.scheduled_date
          )}</div>
        </div>
        <div class="bottom-row">
          <div class="product-price">￥${formatNumber(
            product.starting_price || 0
          )}</div>
          <button class="bid-button">입찰하기</button>
        </div>
      </div>
    `;
}

// 페이지네이션 업데이트
function updatePagination() {
  createPagination(state.currentPage, state.totalPages, handlePageChange);
}

// 페이지 변경 처리
function handlePageChange(page) {
  page = parseInt(page, 10);

  if (page === state.currentPage) return;

  state.currentPage = page;
  fetchProducts();
  window.scrollTo(0, 0);
}

// 상품 상세 정보 표시
async function showProductDetails(itemId) {
  const modalManager = setupModal("detailModal");
  if (!modalManager) return;

  const product = state.products.find((p) => p.item_id === itemId);
  if (!product) return;

  // 기본 정보로 모달 초기화
  initializeModal(product);
  modalManager.show();

  // 로딩 표시
  showLoadingInModal();

  try {
    // 상세 정보 가져오기
    const productDetails = await API.fetchAPI(
      `/detail/item-details/${itemId}`,
      {
        method: "POST",
      }
    );

    // 상세 정보 업데이트
    updateModalWithDetails(productDetails);

    // 추가 이미지가 있다면 업데이트
    if (productDetails.additional_images) {
      try {
        initializeImages(JSON.parse(productDetails.additional_images));
      } catch (e) {
        console.error("이미지 파싱 오류:", e);
      }
    }
  } catch (error) {
    console.error("상품 상세 정보를 가져오는 중 오류 발생:", error);
  } finally {
    hideLoadingInModal();
  }
}

// 모달 초기화
function initializeModal(product) {
  document.querySelector(".modal-brand").textContent = product.brand || "-";
  document.querySelector(".modal-title").textContent =
    product.original_title || "-";
  document.querySelector(".main-image").src = API.validateImageUrl(
    product.image
  );
  document.querySelector(".modal-description").textContent = "로딩 중...";
  document.querySelector(".modal-category").textContent =
    product.category || "로딩 중...";
  document.querySelector(".modal-brand2").textContent = product.brand || "-";
  document.querySelector(".modal-accessory-code").textContent =
    product.accessory_code || "로딩 중...";
  document.querySelector(".modal-scheduled-date").textContent =
    formatDateTime(product.scheduled_date) || "로딩 중...";
  document.querySelector(".modal-rank").textContent = product.rank || "N";

  // 가격 정보 표시
  updatePriceInfoInModal(product);

  // 이미지 초기화
  initializeImages([product.image]);

  // 입찰 버튼 추가
  addBidButtonToModal(product);
}

// 상세 정보로 모달 업데이트
function updateModalWithDetails(product) {
  document.querySelector(".modal-description").textContent =
    product.description || "설명 없음";
  document.querySelector(".modal-category").textContent =
    product.category || "카테고리 없음";
  document.querySelector(".modal-accessory-code").textContent =
    product.accessory_code || "액세서리 코드 없음";
  document.querySelector(".modal-scheduled-date").textContent =
    product.scheduled_date
      ? formatDateTime(product.scheduled_date)
      : "날짜 정보 없음";
  document.querySelector(".modal-brand").textContent = product.brand || "-";
  document.querySelector(".modal-brand2").textContent = product.brand || "-";
  document.querySelector(".modal-title").textContent =
    product.original_title || "제목 없음";
  document.querySelector(".modal-rank").textContent = product.rank || "N";
}

// 가격 정보 표시
function updatePriceInfoInModal(product) {
  const priceInfoHolder = document.querySelector(".bid-info-holder");
  if (!priceInfoHolder) return;

  // 상태에 따라 다른 표시와 클래스 적용
  const statusClass = getStatusClass(product.status || "active");
  const statusText = getStatusDisplay(product.status || "active");

  let priceInfoHTML = `
      <div class="modal-price-info">
        <div class="price-status ${statusClass}">
          ${statusText}
        </div>
        <div class="price-date">
          <strong>예정일:</strong> ${formatDateTime(product.scheduled_date)}
        </div>
        <div class="price-starting">
          <strong>시작가:</strong> ￥${formatNumber(product.starting_price)}
        </div>
    `;

  // 경매 타입에 따른 추가 정보
  if (product.auc_num === 1 || product.auc_num === 2) {
    priceInfoHTML += `
        <div class="price-type">
          <strong>경매 유형:</strong> 직접 경매
        </div>
      `;
  } else {
    priceInfoHTML += `
        <div class="price-type">
          <strong>경매 유형:</strong> 현장 경매
        </div>
      `;
  }

  priceInfoHTML += "</div>";
  priceInfoHolder.innerHTML = priceInfoHTML;
}

// 입찰 버튼 추가
function addBidButtonToModal(product) {
  const priceInfoHolder = document.querySelector(".bid-info-holder");
  if (!priceInfoHolder) return;

  // 이미 입찰 버튼이 있으면 제거
  const existingButton = priceInfoHolder.querySelector(".modal-bid-button");
  if (existingButton) {
    existingButton.remove();
  }

  // 입찰 가능한 상태인지 확인
  const isBiddable =
    product.status === "active" ||
    product.status === "first" ||
    product.status === "second";

  if (isBiddable) {
    const bidButton = document.createElement("button");
    bidButton.className = "modal-bid-button";
    bidButton.textContent = "입찰하기";
    bidButton.addEventListener("click", () => {
      // 모달 닫기
      document.getElementById("detailModal").style.display = "none";
      // 입찰 폼 표시
      showBidFormModal(product);
    });

    priceInfoHolder.appendChild(bidButton);
  }
}

// 상품 정보 모달 표시 (입찰 처리 없이)
function showBidFormModal(product) {
  // 기존 모달이 있으면 제거
  let infoModal = document.getElementById("productInfoModal");
  if (infoModal) {
    infoModal.remove();
  }

  // 새 모달 생성
  infoModal = document.createElement("div");
  infoModal.id = "productInfoModal";
  infoModal.className = "modal";

  const modalContent = `
      <div class="modal-content product-info-modal">
        <div class="modal-header">
          <h2>상품 정보</h2>
          <button class="close" aria-label="Close modal">&times;</button>
        </div>
        <div class="modal-body">
          <div class="product-summary">
            <img src="${API.validateImageUrl(product.image)}" alt="${
    product.original_title
  }" class="product-thumbnail">
            <div class="product-info">
              <div class="product-brand">${product.brand || "-"}</div>
              <div class="product-title">${
                product.original_title || "제목 없음"
              }</div>
              <div class="product-price">시작가: ￥${formatNumber(
                product.starting_price || 0
              )}</div>
              <div class="product-date">예정일: ${formatDate(
                product.scheduled_date
              )}</div>
              <div class="product-status">상태: ${getStatusDisplay(
                product.status || "active"
              )}</div>
            </div>
          </div>
          
          <div class="product-description">
            <h3>상세 설명</h3>
            <p>${product.description || "상세 설명이 없습니다."}</p>
          </div>
          
          <div class="modal-actions">
            <button type="button" class="primary-button view-detail-btn">상세 정보 보기</button>
            <button type="button" class="secondary-button close-btn">닫기</button>
          </div>
        </div>
      </div>
    `;

  infoModal.innerHTML = modalContent;
  document.body.appendChild(infoModal);

  // 모달 표시
  infoModal.style.display = "flex";

  // 닫기 버튼 이벤트
  const closeBtn = infoModal.querySelector(".close");
  const cancelBtn = infoModal.querySelector(".close-btn");
  const detailBtn = infoModal.querySelector(".view-detail-btn");

  closeBtn.addEventListener("click", () => {
    infoModal.style.display = "none";
  });

  cancelBtn.addEventListener("click", () => {
    infoModal.style.display = "none";
  });

  detailBtn.addEventListener("click", () => {
    infoModal.style.display = "none";
    showProductDetails(product.item_id);
  });

  // 외부 클릭 시 닫기
  infoModal.addEventListener("click", (e) => {
    if (e.target === infoModal) {
      infoModal.style.display = "none";
    }
  });
}

// 이미지 초기화
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

// 이미지 변경
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

// 이미지 네비게이션 버튼 업데이트
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

// 네비게이션 버튼 설정
function setupNavButtons() {
  // 입찰 결과 버튼
  document.getElementById("bidResultsBtn")?.addEventListener("click", () => {
    window.location.href = "/bidResultsPage";
  });

  // 시세표 버튼 (onclick 속성으로 이미 처리됨)

  // 현재 페이지이므로 별도 처리 없음
}

// DOM 완료 시 실행
document.addEventListener("DOMContentLoaded", initialize);
