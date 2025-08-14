// public/js/main.js

// 상품 목록 페이지 공통 컨트롤러
window.ProductListController = (function () {
  let config = null;
  let state = {};

  /**
   * 페이지 초기화
   * @param {Object} pageConfig - 페이지별 설정
   */
  function init(pageConfig) {
    config = pageConfig;
    state = { ...pageConfig.initialState };

    // DOM 로드 완료 후 초기화
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initializeAfterDOM);
    } else {
      initializeAfterDOM();
    }
  }

  /**
   * DOM 로드 후 초기화
   */
  async function initializeAfterDOM() {
    try {
      // 1. 인증 상태 확인
      await window.AuthManager.checkAuthStatus();

      // 2. 필터 데이터 로드
      await loadFilters();

      // 3. UI 설정
      setupEventListeners();
      setupFilters();
      setupSearch();
      setupSorting();
      setupViewControls();
      setupPagination();

      // 4. 페이지별 특수 기능 초기화
      if (config.features.realtime) initializeSocket();

      // 5. 초기 데이터 로드
      await fetchData();

      // 6. URL 파라미터 처리 (상세 모달)
      handleUrlParameters();
    } catch (error) {
      console.error("페이지 초기화 중 오류:", error);
      alert("페이지 초기화 중 오류가 발생했습니다.");
    }
  }

  /**
   * 필터 데이터 로드
   */
  async function loadFilters() {
    try {
      const filterPromises = Object.entries(config.filters).map(
        ([key, endpoint]) =>
          API.fetchAPI(endpoint).then((data) => ({ key, data }))
      );

      const filterResults = await Promise.all(filterPromises);

      filterResults.forEach(({ key, data }) => {
        switch (key) {
          case "brands":
            displayBrandFilters(data);
            break;
          case "categories":
            displayCategoryFilters(data);
            break;
          case "ranks":
            displayRankFilters(data);
            break;
          case "aucNums":
            displayAucNumFilters(data);
            break;
          case "dates":
            displayDateFilters(data);
            break;
        }
      });

      // 추가 필터 (페이지별)
      if (config.features.wishlist) {
        displayFavoriteFilters();
      }
    } catch (error) {
      console.error("필터 데이터 로드 실패:", error);
    }
  }

  /**
   * 이벤트 리스너 설정
   */
  function setupEventListeners() {
    // 검색
    const searchButton = document.getElementById("searchButton");
    const searchInput = document.getElementById("searchInput");

    if (searchButton) searchButton.addEventListener("click", handleSearch);
    if (searchInput) {
      searchInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") handleSearch();
      });
    }

    // 필터 버튼
    const applyBtn = document.getElementById("applyFiltersBtn");
    const resetBtn = document.getElementById("resetFiltersBtn");

    if (applyBtn) applyBtn.addEventListener("click", handleApplyFilters);
    if (resetBtn) resetBtn.addEventListener("click", handleResetFilters);

    // 정렬
    const sortOption = document.getElementById("sortOption");
    if (sortOption) {
      sortOption.value = `${state.sortBy}-${state.sortOrder}`;
      sortOption.addEventListener("change", handleSortChange);
    }

    // 표시 개수
    const itemsPerPage = document.getElementById("itemsPerPage");
    if (itemsPerPage) {
      itemsPerPage.value = state.itemsPerPage;
      itemsPerPage.addEventListener("change", handleItemsPerPageChange);
    }

    // 뷰 타입
    const cardViewBtn = document.getElementById("cardViewBtn");
    const listViewBtn = document.getElementById("listViewBtn");

    if (cardViewBtn)
      cardViewBtn.addEventListener("click", () => setViewType("card"));
    if (listViewBtn)
      listViewBtn.addEventListener("click", () => setViewType("list"));
  }

  /**
   * 필터 UI 설정
   */
  function setupFilters() {
    // 출품사 필터
    const aucNumFilters = document.getElementById("aucNumFilters");
    if (aucNumFilters) {
      aucNumFilters.addEventListener("change", (e) => {
        if (e.target.type === "checkbox") {
          updateArrayFilter(
            state.selectedAucNums,
            e.target.value,
            e.target.checked
          );
        }
      });
    }

    // 경매 유형 필터 (상품 페이지만)
    if (config.features.auctionTypes) {
      const auctionTypeFilters = document.getElementById("auctionTypeFilters");
      if (auctionTypeFilters) {
        auctionTypeFilters.addEventListener("change", (e) => {
          if (e.target.type === "checkbox") {
            updateArrayFilter(
              state.selectedAuctionTypes,
              e.target.value,
              e.target.checked
            );
          }
        });
      }
    }

    // 즐겨찾기 필터 (상품 페이지만)
    if (config.features.wishlist) {
      const favoriteFilters = document.getElementById("favoriteFilters");
      if (favoriteFilters) {
        favoriteFilters.addEventListener("change", (e) => {
          if (e.target.type === "checkbox") {
            const favoriteNum = parseInt(e.target.value);
            updateArrayFilter(
              state.selectedFavoriteNumbers,
              favoriteNum,
              e.target.checked
            );
          }
        });
      }
    }

    // 기타 체크박스 필터들
    if (config.features.bidItemsOnly) {
      const bidItemsOnly = document.getElementById("bid-items-only");
      if (bidItemsOnly) {
        bidItemsOnly.addEventListener("change", (e) => {
          state.showBidItemsOnly = e.target.checked;
        });
      }
    }

    if (config.features.excludeExpired) {
      const excludeExpired = document.getElementById("exclude-expired");
      if (excludeExpired) {
        excludeExpired.checked = state.excludeExpired;
        excludeExpired.addEventListener("change", (e) => {
          state.excludeExpired = e.target.checked;
        });
      }
    }
  }

  /**
   * 배열 기반 필터 업데이트 헬퍼
   */
  function updateArrayFilter(array, value, isChecked) {
    if (isChecked) {
      if (!array.includes(value)) {
        array.push(value);
      }
    } else {
      const index = array.indexOf(value);
      if (index > -1) {
        array.splice(index, 1);
      }
    }
  }

  /**
   * 검색 설정
   */
  function setupSearch() {
    // 검색 기능은 이벤트 리스너에서 처리
  }

  /**
   * 정렬 설정
   */
  function setupSorting() {
    // 정렬 기능은 이벤트 리스너에서 처리
  }

  /**
   * 뷰 컨트롤 설정
   */
  function setupViewControls() {
    // 뷰 타입 초기화
    setViewType("card");
  }

  /**
   * 페이지네이션 설정
   */
  function setupPagination() {
    // createPagination은 common.js에 있음
    // 데이터 로드 후 생성됨
  }

  /**
   * 데이터 가져오기
   */
  async function fetchData(showLoading = true) {
    if (showLoading) toggleLoading(true);

    try {
      const params = buildApiParams();
      const queryString = API.createURLParams(params);
      const data = await API.fetchAPI(`${config.apiEndpoint}?${queryString}`);

      // 상태 업데이트
      state.totalItems = data.totalItems;
      state.totalPages = data.totalPages;

      // 페이지별 특수 데이터 처리
      if (config.features.bidding) {
        processBidData(data);
      }

      if (config.features.wishlist) {
        processWishlistData(data);
      }

      // 데이터 표시
      displayData(data.data);

      // 페이지네이션 생성
      createPagination(state.currentPage, state.totalPages, handlePageChange);
    } catch (error) {
      console.error("데이터 로드 실패:", error);
      if (showLoading) {
        alert("데이터를 불러오는 데 실패했습니다.");
      }
    } finally {
      if (showLoading) toggleLoading(false);
    }
  }

  /**
   * API 파라미터 구성
   */
  function buildApiParams() {
    const params = {
      page: state.currentPage,
      limit: state.itemsPerPage,
      brands: state.selectedBrands,
      categories: state.selectedCategories,
      search: state.searchTerm,
      ranks: state.selectedRanks,
      aucNums: state.selectedAucNums.join(","),
      sortBy: state.sortBy,
      sortOrder: state.sortOrder,
    };

    // 페이지별 추가 파라미터
    if (config.features.auctionTypes) {
      params.auctionTypes =
        state.selectedAuctionTypes.length > 0
          ? state.selectedAuctionTypes.join(",")
          : undefined;
    }

    if (config.features.wishlist) {
      params.favoriteNumbers =
        state.selectedFavoriteNumbers.length > 0
          ? state.selectedFavoriteNumbers.join(",")
          : undefined;
    }

    if (config.features.bidItemsOnly) {
      params.bidsOnly = state.showBidItemsOnly;
    }

    if (config.features.excludeExpired) {
      params.excludeExpired = state.excludeExpired;
    }

    if (config.features.scheduledDates) {
      params.scheduledDates = state.selectedDates.map((date) =>
        date === "NO_DATE" ? "null" : date
      );
    }

    return params;
  }

  /**
   * 입찰 데이터 처리 (상품 페이지용)
   */
  function processBidData(data) {
    state.liveBidData = [];
    state.directBidData = [];

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

    // BidManager에 데이터 전달
    if (window.BidManager) {
      window.BidManager.updateBidData(state.liveBidData, state.directBidData);
      window.BidManager.updateCurrentData(data.data);
    }
  }

  /**
   * 위시리스트 데이터 처리 (상품 페이지용)
   */
  function processWishlistData(data) {
    if (data.wishlist) {
      state.wishlist = data.wishlist.map((w) => ({
        item_id: w.item_id,
        favorite_number: w.favorite_number,
      }));
    }
  }

  /**
   * 데이터 표시
   */
  function displayData(data) {
    const dataBody = document.getElementById("dataBody");
    if (!dataBody) return;

    state.currentData = data;
    dataBody.innerHTML = "";

    if (!data || data.length === 0) {
      dataBody.innerHTML = "<p>선택한 필터에 맞는 항목이 없습니다.</p>";
      return;
    }

    // 템플릿 기반 렌더링
    data.forEach((item) => {
      const card = renderCard(item);
      dataBody.appendChild(card);
    });

    // 페이지별 후처리
    if (config.features.bidding && window.BidManager) {
      window.BidManager.initializePriceCalculators();
      window.BidManager.startTimerUpdates();
    }
  }

  /**
   * 템플릿 기반 카드 렌더링
   */
  function renderCard(item) {
    const template = document.getElementById(config.template);
    if (!template) {
      console.error(`템플릿 ${config.template}을 찾을 수 없습니다.`);
      return createElement("div", "error", "템플릿 오류");
    }

    const cardClone = template.content.cloneNode(true);
    const card = cardClone.querySelector(".product-card");

    if (!card) {
      console.error("템플릿에 .product-card 요소가 없습니다.");
      return createElement("div", "error", "템플릿 구조 오류");
    }

    // 기본 데이터 바인딩
    card.dataset.itemId = item.item_id;
    card.dataset.bidType = item.bid_type || "live";

    // 텍스트 필드 바인딩
    bindTextFields(card, item);

    // 이미지 바인딩
    bindImages(card, item);

    // 조건부 요소 처리
    processConditionalElements(card, item);

    // 이벤트 리스너 추가
    addCardEventListeners(card, item);

    // ⭐ 페이지별 커스터마이징 (중요!)
    if (config.customizeCard) {
      config.customizeCard(card, item);
    }

    return card;
  }

  /**
   * 텍스트 필드 데이터 바인딩
   */
  function bindTextFields(card, item) {
    const textFields = card.querySelectorAll("[data-field]");
    textFields.forEach((element) => {
      const field = element.dataset.field;
      let value = item[field];

      // 특수 필드 처리
      switch (field) {
        case "bid_type_text":
          value = item.bid_type === "direct" ? "직접" : "현장";
          break;
        case "rank":
          value = item.rank || "N";
          break;
        case "formatted_date":
          value = formatDateTime(item.scheduled_date);
          break;
        case "formatted_price":
          value = cleanNumberFormat(
            item.starting_price || item.final_price || 0
          );
          break;
      }

      if (value !== undefined && value !== null) {
        element.textContent = value;
      }
    });
  }

  /**
   * 이미지 데이터 바인딩
   */
  function bindImages(card, item) {
    const images = card.querySelectorAll("img[data-field]");
    images.forEach((img) => {
      const field = img.dataset.field;
      if (field === "image") {
        img.src = API.validateImageUrl(item.image);
        img.alt = item.title || "";
      }
    });
  }

  /**
   * 조건부 요소 처리
   */
  function processConditionalElements(card, item) {
    const conditionalElements = card.querySelectorAll("[data-if]");
    conditionalElements.forEach((element) => {
      const condition = element.dataset.if;
      let shouldShow = false;

      switch (condition) {
        case "hasBidding":
          shouldShow = config.features.bidding;
          break;
        case "hasWishlist":
          shouldShow = config.features.wishlist;
          break;
        case "hasAdminEdit":
          shouldShow =
            config.features.adminEdit && window.AuthManager.user?.isAdmin;
          break;
      }

      if (!shouldShow) {
        element.remove();
      }
    });
  }

  /**
   * 카드 이벤트 리스너 추가
   */
  function addCardEventListeners(card, item) {
    // 카드 클릭 이벤트
    card.addEventListener("click", (event) => {
      // 특정 요소 클릭은 무시
      if (
        event.target.closest(".bid-input-group") ||
        event.target.closest(".quick-bid-buttons") ||
        event.target.closest(".wishlist-btn") ||
        event.target.classList.contains("bid-button") ||
        event.target.classList.contains("quick-bid-btn") ||
        event.target.closest(".edit-price-icon")
      ) {
        return;
      }

      showDetails(item.item_id);
    });

    // 위시리스트 버튼 이벤트 (상품 페이지용)
    if (config.features.wishlist) {
      const wishlistBtns = card.querySelectorAll(".wishlist-btn");
      wishlistBtns.forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const favoriteNumber = parseInt(btn.dataset.favorite);
          if (window.toggleWishlist) {
            window.toggleWishlist(item.item_id, favoriteNumber);
          }
        });
      });
    }

    // 관리자 수정 버튼 이벤트 (시세 페이지용)
    if (config.features.adminEdit) {
      const editBtn = card.querySelector(".edit-price-icon");
      if (editBtn && window.handlePriceEdit) {
        editBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const priceValue = editBtn.closest(".info-value");
          window.handlePriceEdit(item.item_id, priceValue);
        });
      }
    }
  }

  /**
   * 상세 정보 표시
   */
  async function showDetails(itemId) {
    const modalManager = setupModal("detailModal");
    if (!modalManager) return;

    let item = state.currentData.find((data) => data.item_id == itemId);

    if (!item) {
      try {
        item = await API.fetchAPI(`${config.detailEndpoint}${itemId}`, {
          method: "POST",
        });
        state.currentData.push(item);
      } catch (error) {
        console.error("상세 정보 로드 실패:", error);
        alert("상세 정보를 불러올 수 없습니다.");
        return;
      }
    }

    initializeModal(item);
    modalManager.show();
    showLoadingInModal();

    try {
      const updatedItem = await API.fetchAPI(
        `${config.detailEndpoint}${itemId}`,
        {
          method: "POST",
        }
      );

      updateModalWithDetails(updatedItem);

      if (updatedItem.additional_images) {
        initializeImages([
          updatedItem.image,
          ...JSON.parse(updatedItem.additional_images),
        ]);
      }
    } catch (error) {
      console.error("상세 정보 업데이트 실패:", error);
    } finally {
      hideLoadingInModal();
    }
  }

  /**
   * 모달 초기화
   */
  function initializeModal(item) {
    document.querySelector(".modal-brand").textContent = item.brand || "";
    document.querySelector(".modal-title").textContent = item.title || "";
    document.querySelector(".main-image").src = API.validateImageUrl(
      item.image
    );
    document.querySelector(".modal-description").textContent = "로딩 중...";
    document.querySelector(".modal-category").textContent =
      item.category || "로딩 중...";
    document.querySelector(".modal-brand2").textContent = item.brand || "";
    document.querySelector(".modal-accessory-code").textContent =
      item.accessory_code || "로딩 중...";
    document.querySelector(".modal-rank").textContent = item.rank || "N";

    // 페이지별 모달 초기화
    if (config.type === "products") {
      document.querySelector(".modal-scheduled-date").textContent =
        formatDateTime(item.scheduled_date) || "로딩 중...";
      // 입찰 정보 초기화는 products.js에서 처리
    } else if (config.type === "values") {
      document.querySelector(".modal-scheduled-date").textContent =
        formatDate(item.scheduled_date) || "로딩 중...";
      document.querySelector(".modal-final-price").textContent =
        item.final_price
          ? `${formatNumber(parseInt(item.final_price))} ¥`
          : "가격 정보 없음";
    }

    initializeImages([item.image]);
  }

  /**
   * 모달 상세 정보 업데이트
   */
  function updateModalWithDetails(item) {
    document.querySelector(".modal-description").textContent =
      item.description || "설명 없음";
    document.querySelector(".modal-category").textContent =
      item.category || "카테고리 없음";
    document.querySelector(".modal-accessory-code").textContent =
      item.accessory_code || "액세서리 코드 없음";
    document.querySelector(".modal-brand").textContent = item.brand || "";
    document.querySelector(".modal-brand2").textContent = item.brand || "";
    document.querySelector(".modal-title").textContent = item.title || "";
    document.querySelector(".modal-rank").textContent = item.rank || "N";

    if (config.type === "products") {
      document.querySelector(".modal-scheduled-date").textContent =
        formatDateTime(item.scheduled_date) || "날짜 정보 없음";
    } else if (config.type === "values") {
      document.querySelector(".modal-scheduled-date").textContent =
        formatDate(item.scheduled_date) || "날짜 정보 없음";
      document.querySelector(".modal-final-price").textContent =
        item.final_price
          ? `${formatNumber(parseInt(item.final_price))} ¥`
          : "가격 정보 없음";
    }
  }

  /**
   * 이미지 갤러리 초기화
   */
  function initializeImages(imageUrls) {
    state.images = imageUrls.filter((url) => url);
    state.currentImageIndex = 0;

    const mainImage = document.querySelector(".main-image");
    const thumbnailContainer = document.querySelector(".thumbnail-container");

    if (!mainImage || !thumbnailContainer) return;

    mainImage.src = API.validateImageUrl(state.images[0]);

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

    updateNavigationButtons();
    setupImageNavigation();
  }

  /**
   * 메인 이미지 변경
   */
  function changeMainImage(index) {
    if (index < 0 || index >= state.images.length) return;

    state.currentImageIndex = index;
    const mainImage = document.querySelector(".main-image");
    if (!mainImage) return;

    mainImage.src = API.validateImageUrl(state.images[index]);

    const thumbnails = document.querySelectorAll(".thumbnail");
    thumbnails.forEach((thumb, i) => {
      thumb.classList.toggle("active", i === index);
    });

    updateNavigationButtons();
  }

  /**
   * 이미지 네비게이션 설정
   */
  function setupImageNavigation() {
    const prevBtn = document.querySelector(".image-nav.prev");
    const nextBtn = document.querySelector(".image-nav.next");

    if (prevBtn) {
      const newPrevBtn = prevBtn.cloneNode(true);
      prevBtn.parentNode.replaceChild(newPrevBtn, prevBtn);
      newPrevBtn.addEventListener("click", () => {
        changeMainImage(state.currentImageIndex - 1);
      });
    }

    if (nextBtn) {
      const newNextBtn = nextBtn.cloneNode(true);
      nextBtn.parentNode.replaceChild(newNextBtn, nextBtn);
      newNextBtn.addEventListener("click", () => {
        changeMainImage(state.currentImageIndex + 1);
      });
    }
  }

  /**
   * 모달 로딩 표시
   */
  function showLoadingInModal() {
    const existingLoader = document.getElementById("modal-loading");
    if (existingLoader) return;

    const loadingElement = createElement("div", "modal-loading");
    loadingElement.id = "modal-loading";
    loadingElement.textContent = "상세 정보를 불러오는 중...";

    document.querySelector(".modal-content")?.appendChild(loadingElement);
  }

  /**
   * 모달 로딩 숨기기
   */
  function hideLoadingInModal() {
    document.getElementById("modal-loading")?.remove();
  }

  /**
   * Socket.IO 초기화 (상품 페이지용)
   */
  function initializeSocket() {
    if (typeof io === "undefined") {
      console.warn("Socket.IO not available");
      return;
    }

    const socket = io({
      reconnectionAttempts: 5,
      timeout: 10000,
    });

    socket.on("connect_error", (error) => {
      console.error("Socket connection error:", error);
    });

    socket.on("data-updated", (data) => {
      console.log(`업데이트 알림: ${data.itemIds.length}개 아이템`);

      const visibleItemIds = state.currentData.map((item) => item.item_id);
      const itemsToUpdate = data.itemIds.filter((id) =>
        visibleItemIds.includes(id)
      );

      if (itemsToUpdate.length > 0) {
        debouncedFetchData(false);
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
   * 디바운스된 데이터 가져오기
   */
  let fetchDataDebounceTimer = null;
  function debouncedFetchData(showLoading = false) {
    if (fetchDataDebounceTimer) clearTimeout(fetchDataDebounceTimer);
    fetchDataDebounceTimer = setTimeout(() => {
      fetchData(showLoading);
    }, 300);
  }

  // 이벤트 핸들러들
  function handleSearch() {
    const searchInput = document.getElementById("searchInput");
    state.searchTerm = searchInput.value;
    state.currentPage = 1;
    fetchData();
  }

  function handleApplyFilters() {
    state.currentPage = 1;
    fetchData();
  }

  function handleResetFilters() {
    // 상태 리셋
    state.selectedBrands = [];
    state.selectedCategories = [];
    state.selectedRanks = [];
    state.selectedAucNums = [];
    state.searchTerm = "";
    state.currentPage = 1;

    if (config.features.auctionTypes) {
      state.selectedAuctionTypes = [];
    }
    if (config.features.wishlist) {
      state.selectedFavoriteNumbers = [];
    }
    if (config.features.scheduledDates) {
      state.selectedDates = [];
    }
    if (config.features.bidItemsOnly) {
      state.showBidItemsOnly = false;
    }
    if (config.features.excludeExpired) {
      state.excludeExpired = true;
    }

    // UI 리셋
    document
      .querySelectorAll('.filter-options input[type="checkbox"]')
      .forEach((checkbox) => {
        checkbox.checked = false;
      });

    const searchInput = document.getElementById("searchInput");
    if (searchInput) searchInput.value = "";

    const bidItemsOnly = document.getElementById("bid-items-only");
    if (bidItemsOnly) bidItemsOnly.checked = false;

    const excludeExpired = document.getElementById("exclude-expired");
    if (excludeExpired) excludeExpired.checked = true;

    // 정렬 초기화
    state.sortBy = config.initialState.sortBy;
    state.sortOrder = config.initialState.sortOrder;
    const sortOption = document.getElementById("sortOption");
    if (sortOption) sortOption.value = `${state.sortBy}-${state.sortOrder}`;

    // 선택된 항목 수 업데이트
    updateSelectedCount("brand");
    updateSelectedCount("category");

    fetchData();
  }

  function handleSortChange() {
    const sortOption = document.getElementById("sortOption");
    const [sortBy, sortOrder] = sortOption.value.split("-");
    state.sortBy = sortBy;
    state.sortOrder = sortOrder;
    state.currentPage = 1;
    fetchData();
  }

  function handleItemsPerPageChange() {
    const itemsPerPage = document.getElementById("itemsPerPage");
    state.itemsPerPage = parseInt(itemsPerPage.value);
    state.currentPage = 1;
    fetchData();
  }

  function handlePageChange(page) {
    state.currentPage = page;
    fetchData();
  }

  function setViewType(type) {
    const cardViewBtn = document.getElementById("cardViewBtn");
    const listViewBtn = document.getElementById("listViewBtn");
    const dataBody = document.getElementById("dataBody");

    if (type === "card") {
      cardViewBtn?.classList.add("active");
      listViewBtn?.classList.remove("active");
      dataBody?.classList.remove("list-view");
    } else {
      listViewBtn?.classList.add("active");
      cardViewBtn?.classList.remove("active");
      dataBody?.classList.add("list-view");
    }
  }

  /**
   * URL 파라미터 처리
   */
  function handleUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const itemId = urlParams.get("item_id");
    if (itemId) {
      showDetails(itemId);
    }
  }

  // 필터 표시 함수들 (common.js에서 이동)

  /**
   * 브랜드 필터 표시
   */
  function displayBrandFilters(brands) {
    const brandCheckboxes = document.getElementById("brandCheckboxes");
    if (!brandCheckboxes) return;

    // 기존 옵션 제거 (전체 선택 제외)
    const allCheckbox = brandCheckboxes.querySelector(".multiselect-all");
    brandCheckboxes.innerHTML = "";
    if (allCheckbox) brandCheckboxes.appendChild(allCheckbox);

    // 브랜드 정렬 (개수 내림차순)
    brands.sort((a, b) => (b.count || 0) - (a.count || 0));

    // 전체 선택 체크박스 이벤트
    const brandAllCheckbox = document.getElementById("brand-all");
    if (brandAllCheckbox) {
      brandAllCheckbox.addEventListener("change", function () {
        const checkboxes = brandCheckboxes.querySelectorAll(
          'input[type="checkbox"]:not(#brand-all)'
        );
        checkboxes.forEach((checkbox) => {
          checkbox.checked = this.checked;
          updateArrayFilter(state.selectedBrands, checkbox.value, this.checked);
        });
        updateSelectedCount("brand");
      });
    }

    // 브랜드 체크박스 생성
    brands.forEach((brand) => {
      if (!brand.brand) return;

      const item = createElement("div", "filter-item");
      const checkbox = createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `brand-${brand.brand.replace(/\s+/g, "-")}`;
      checkbox.value = brand.brand;

      if (state.selectedBrands.includes(brand.brand)) {
        checkbox.checked = true;
      }

      checkbox.addEventListener("change", function () {
        updateArrayFilter(state.selectedBrands, this.value, this.checked);
        updateAllCheckbox("brand");
        updateSelectedCount("brand");
      });

      const label = createElement("label");
      label.htmlFor = checkbox.id;
      label.textContent = brand.brand;

      if (brand.count) {
        const countSpan = createElement("span", "item-count");
        countSpan.textContent = `(${brand.count})`;
        label.appendChild(countSpan);
      }

      item.appendChild(checkbox);
      item.appendChild(label);
      brandCheckboxes.appendChild(item);
    });

    updateSelectedCount("brand");
    setupFilterSearch("brandSearchInput", "brandCheckboxes");
  }

  /**
   * 카테고리 필터 표시
   */
  function displayCategoryFilters(categories) {
    const categoryCheckboxes = document.getElementById("categoryCheckboxes");
    if (!categoryCheckboxes) return;

    // 기존 옵션 제거 (전체 선택 제외)
    const allCheckbox = categoryCheckboxes.querySelector(".multiselect-all");
    categoryCheckboxes.innerHTML = "";
    if (allCheckbox) categoryCheckboxes.appendChild(allCheckbox);

    // 카테고리 정렬
    categories.sort();

    // 전체 선택 체크박스 이벤트
    const categoryAllCheckbox = document.getElementById("category-all");
    if (categoryAllCheckbox) {
      categoryAllCheckbox.addEventListener("change", function () {
        const checkboxes = categoryCheckboxes.querySelectorAll(
          'input[type="checkbox"]:not(#category-all)'
        );
        checkboxes.forEach((checkbox) => {
          checkbox.checked = this.checked;
          updateArrayFilter(
            state.selectedCategories,
            checkbox.value,
            this.checked
          );
        });
        updateSelectedCount("category");
      });
    }

    // 카테고리 체크박스 생성
    categories.forEach((category) => {
      if (!category) category = "기타";

      const item = createElement("div", "filter-item");
      const checkbox = createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `category-${category.replace(/\s+/g, "-")}`;
      checkbox.value = category;

      if (state.selectedCategories.includes(category)) {
        checkbox.checked = true;
      }

      checkbox.addEventListener("change", function () {
        updateArrayFilter(state.selectedCategories, this.value, this.checked);
        updateAllCheckbox("category");
        updateSelectedCount("category");
      });

      const label = createElement("label");
      label.htmlFor = checkbox.id;
      label.textContent = category;

      item.appendChild(checkbox);
      item.appendChild(label);
      categoryCheckboxes.appendChild(item);
    });

    updateSelectedCount("category");
    setupFilterSearch("categorySearchInput", "categoryCheckboxes");
  }

  /**
   * 랭크 필터 표시
   */
  function displayRankFilters(ranks) {
    const rankFilters = document.getElementById("rankFilters");
    if (!rankFilters) return;

    rankFilters.innerHTML = "";
    const rankOrder = ["N", "S", "A", "AB", "B", "BC", "C", "D", "E", "F"];
    const rankMap = new Map(ranks.map((r) => [r.rank, r]));

    rankOrder.forEach((rank) => {
      const rankData = rankMap.get(rank);
      if (rankData) {
        const rankItem = createFilterItem(
          rankData.rank,
          "rank",
          state.selectedRanks,
          rankData.rank
        );
        rankFilters.appendChild(rankItem);
      }
    });
  }

  /**
   * 출품사 필터 표시
   */
  function displayAucNumFilters(aucNums) {
    const aucNumFilters = document.getElementById("aucNumFilters");
    if (!aucNumFilters) return;

    aucNumFilters.innerHTML = "";
    aucNums.sort((a, b) => a.auc_num - b.auc_num);

    aucNums.forEach((item) => {
      const filterItem = createElement("div", "filter-item");
      const checkbox = createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `aucNum-${item.auc_num}`;
      checkbox.value = item.auc_num;

      if (state.selectedAucNums.includes(item.auc_num.toString())) {
        checkbox.checked = true;
      }

      checkbox.addEventListener("change", function () {
        updateArrayFilter(state.selectedAucNums, this.value, this.checked);
      });

      const label = createElement("label");
      label.htmlFor = `aucNum-${item.auc_num}`;
      label.textContent = `${item.auc_num}번`;

      filterItem.appendChild(checkbox);
      filterItem.appendChild(label);
      aucNumFilters.appendChild(filterItem);
    });
  }

  /**
   * 날짜 필터 표시 (상품 페이지용)
   */
  function displayDateFilters(dates) {
    const scheduledDateFilters = document.getElementById(
      "scheduledDateFilters"
    );
    if (!scheduledDateFilters) return;

    scheduledDateFilters.innerHTML = "";

    const noScheduledDateItem = createFilterItem(
      "NO_DATE",
      "date",
      state.selectedDates,
      "날짜 없음"
    );
    scheduledDateFilters.appendChild(noScheduledDateItem);

    dates.forEach((date) => {
      if (date.Date) {
        const kstDate = new Date(date.Date);
        const normalizedDate = kstDate
          .toLocaleDateString("ko-KR", {
            timeZone: "Asia/Seoul",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          })
          .replace(/\. /g, "-")
          .replace(".", "");
        const dateItem = createFilterItem(
          normalizedDate,
          "date",
          state.selectedDates,
          normalizedDate
        );
        scheduledDateFilters.appendChild(dateItem);
      }
    });
  }

  /**
   * 즐겨찾기 필터 표시 (상품 페이지용)
   */
  function displayFavoriteFilters() {
    const favoriteFilters = document.getElementById("favoriteFilters");
    if (!favoriteFilters) return;

    favoriteFilters.innerHTML = "";

    for (let i = 1; i <= 3; i++) {
      const filterItem = createElement("div", "filter-item");
      const checkbox = createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `favorite-${i}`;
      checkbox.value = i;

      const label = createElement("label");
      label.htmlFor = `favorite-${i}`;
      label.textContent = `즐겨찾기 ${["①", "②", "③"][i - 1]}`;

      filterItem.appendChild(checkbox);
      filterItem.appendChild(label);
      favoriteFilters.appendChild(filterItem);
    }
  }

  /**
   * 전체 선택 체크박스 상태 업데이트
   */
  function updateAllCheckbox(type) {
    const container = document.getElementById(`${type}Checkboxes`);
    if (!container) return;

    const allCheckbox = document.getElementById(`${type}-all`);
    if (!allCheckbox) return;

    const checkboxes = container.querySelectorAll(
      `input[type='checkbox']:not(#${type}-all)`
    );
    const checkedCount = container.querySelectorAll(
      `input[type='checkbox']:not(#${type}-all):checked`
    ).length;

    allCheckbox.checked =
      checkedCount === checkboxes.length && checkboxes.length > 0;
  }

  /**
   * 선택된 항목 수 업데이트
   */
  function updateSelectedCount(type) {
    const container = document.getElementById(`${type}Checkboxes`);
    if (!container) return;

    const checkboxes = container.querySelectorAll(
      `input[type='checkbox']:not(#${type}-all)`
    );
    const checkedCount = container.querySelectorAll(
      `input[type='checkbox']:not(#${type}-all):checked`
    ).length;

    let countElement = container.querySelector(".multiselect-selected-count");
    if (!countElement) {
      countElement = createElement("span", "multiselect-selected-count");
      container
        .querySelector(".multiselect-all label")
        .appendChild(countElement);
    }

    countElement.textContent =
      checkedCount > 0 ? ` (${checkedCount}/${checkboxes.length})` : "";
  }

  /**
   * 필터 검색 설정
   */
  function setupFilterSearch(inputId, containerId) {
    const searchInput = document.getElementById(inputId);
    const container = document.getElementById(containerId);

    if (!searchInput || !container) return;

    searchInput.addEventListener("input", function () {
      const searchTerm = this.value.toLowerCase();
      const filterItems = container.querySelectorAll(".filter-item");

      filterItems.forEach((item) => {
        const label = item.querySelector("label").textContent.toLowerCase();
        item.style.display = label.includes(searchTerm) ? "" : "none";
      });
    });
  }

  // 공개 API
  return {
    init,
    fetchData,
    debouncedFetchData,
    showDetails,
    changeMainImage,
    getState: () => state,
    getConfig: () => config,
  };
})();
