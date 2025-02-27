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
  currentData: [],
  images: [],
  currentImageIndex: 0,
  isAdmin: false,
};

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
    const card = createElement("div", "product-card");
    card.dataset.itemId = item.item_id;

    const priceDisplay = state.isAdmin
      ? `<p class="final-price">최종가격: 
                <span class="price-value" data-item-id="${item.item_id}">
                    ${formatNumber(parseInt(item.final_price))} ¥
                    <button class="edit-price-icon btn btn-link p-0 ms-2">
                        <i class="fas fa-edit"></i>
                    </button>
                </span>
               </p>`
      : `<p class="final-price">최종가격: ${formatNumber(
          parseInt(item.final_price)
        )} ¥</p>`;

    card.innerHTML = `
            <div class="product-header">
                <div>
                    <div class="product-brand">${item.brand}</div>
                    <div class="auctioneer-number">${item.auc_num}번</div>
                </div>
                <h3 class="product-title">${item.title}</h3>
            </div>
            <img src="${API.validateImageUrl(item.image)}" 
                 alt="${item.title}" 
                 class="product-image"
                 loading="lazy">
            <div class="product-details">
                <p class="scheduled-date">경매일: ${formatDate(
                  item.scheduled_date
                )}</p>
                <p class="scheduled-date">랭크: ${item.rank}</p>
                ${item.final_price ? priceDisplay : ""}
            </div>
        `;

    // 카드 전체 클릭 이벤트
    card.addEventListener("click", (e) => {
      // 가격 수정 관련 요소들은 제외
      if (
        e.target.closest(".edit-price-icon") ||
        e.target.closest(".price-input") ||
        e.target.closest(".save-price") ||
        e.target.closest(".cancel-price")
      ) {
        return;
      }
      showDetails(item.item_id);
    });

    dataBody.appendChild(card);
  });
}

function setupPriceEditing() {
  if (!state.isAdmin) return;

  document.getElementById("dataBody").addEventListener("click", async (e) => {
    const editIcon = e.target.closest(".edit-price-icon");
    if (!editIcon) return;

    const priceSpan = editIcon.closest(".price-value");
    const currentPrice = priceSpan.textContent.trim().replace(/[^0-9]/g, "");
    const itemId = priceSpan.dataset.itemId;

    // 인라인 수정 UI로 변경
    const originalContent = priceSpan.innerHTML;
    priceSpan.innerHTML = `
            <input type="number" class="price-input form-control form-control-sm d-inline-block w-auto" 
                   value="${currentPrice}" style="width: 150px !important;" />
            <button class="btn btn-sm btn-success save-price ms-1">저장</button>
            <button class="btn btn-sm btn-secondary cancel-price ms-1">취소</button>
        `;

    const input = priceSpan.querySelector(".price-input");
    input.focus();

    // 저장 버튼 이벤트
    priceSpan.querySelector(".save-price").onclick = async () => {
      const newPrice = input.value;
      try {
        const response = await fetch(`/api/admin/values/${itemId}/price`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ final_price: newPrice }),
        });

        if (!response.ok) throw new Error("Failed to update price");

        priceSpan.innerHTML = `${formatNumber(
          parseInt(newPrice)
        )} ¥ <i class="fas fa-edit edit-price-icon ms-2"></i>`;
      } catch (error) {
        console.error("Error updating price:", error);
        priceSpan.innerHTML = originalContent;
      }
    };

    // 취소 버튼 이벤트
    priceSpan.querySelector(".cancel-price").onclick = () => {
      priceSpan.innerHTML = originalContent;
    };
  });
}

// 상세 정보 모달 초기화
function initializeModal(item) {
  document.querySelector(".modal-brand").textContent = item.brand || "";
  document.querySelector(".modal-title").textContent = item.title || "";
  document.querySelector(".main-image").src = API.validateImageUrl(item.image);
  document.querySelector(".modal-description").textContent = "로딩 중...";
  document.querySelector(".modal-category").textContent =
    item.category || "카테고리 없음";
  document.querySelector(".modal-brand2").textContent = item.brand || "";
  document.querySelector(".modal-accessory-code").textContent =
    item.accessory_code || "액세서리 코드 없음";
  document.querySelector(".modal-scheduled-date").textContent =
    formatDate(item.scheduled_date) || "날짜 정보 없음";
  document.querySelector(".modal-final-price").textContent = item.final_price
    ? `${formatNumber(parseInt(item.final_price))} ¥`
    : "가격 정보 없음";

  // 기본 이미지로 초기화
  initializeImages([item.image]);
}

function initializeImages(imageUrls) {
  // 유효한 이미지 URL만 필터링
  const validImages = (Array.isArray(imageUrls) ? imageUrls : [])
    .filter((url) => url)
    .map((url) => API.validateImageUrl(url));

  if (validImages.length === 0) {
    console.log("No valid images found");
    return;
  }

  state.images = validImages;
  state.currentImageIndex = 0;

  const mainImage = document.querySelector(".main-image");
  const thumbnailContainer = document.querySelector(".thumbnail-container");

  if (!mainImage || !thumbnailContainer) return;

  // 메인 이미지 설정
  mainImage.src = state.images[0];
  mainImage.alt = "상품 이미지";

  // 썸네일 초기화
  thumbnailContainer.innerHTML = "";
  state.images.forEach((img, index) => {
    const thumbnailWrapper = createElement("div", "thumbnail");
    thumbnailWrapper.classList.toggle("active", index === 0);

    const thumbnail = createElement("img");
    thumbnail.src = img;
    thumbnail.alt = `상품 이미지 ${index + 1}`;
    thumbnail.loading = "lazy";

    thumbnail.addEventListener("click", () => {
      changeMainImage(index);
      updateThumbnailSelection(index);
    });

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
  if (mainImage) {
    mainImage.src = state.images[index];
  }

  updateThumbnailSelection(index);
  updateNavigationButtons();
}
function updateThumbnailSelection(activeIndex) {
  document.querySelectorAll(".thumbnail").forEach((thumb, i) => {
    thumb.classList.toggle("active", i === activeIndex);
  });
}
function updateNavigationButtons() {
  const prevBtn = document.querySelector(".image-nav.prev");
  const nextBtn = document.querySelector(".image-nav.next");

  if (prevBtn) {
    prevBtn.disabled = state.currentImageIndex <= 0;
  }
  if (nextBtn) {
    nextBtn.disabled = state.currentImageIndex >= state.images.length - 1;
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
      aucNums: state.selectedAucNums.join(","),
    };

    const queryString = API.createURLParams(params);
    const data = await API.fetchAPI(`/values?${queryString}`);

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

// 상세 정보 표시

async function showDetails(itemId) {
  const modalManager = setupModal("detailModal");
  if (!modalManager) return;

  const item = state.currentData.find((data) => data.item_id == itemId);
  if (!item) return;

  // 기본 정보로 모달 초기화
  initializeModal(item);
  modalManager.show();

  try {
    // 상세 정보 가져오기 전에 로딩 표시
    showLoadingInModal();

    const updatedItem = await API.fetchAPI(
      `/crawler/crawl-item-value-details/${itemId}`,
      {
        method: "POST",
      }
    ).catch((error) => {
      console.log("Unable to fetch details, using basic item info:", error);
      return item; // 오류 시 기본 정보 사용
    });

    // 상세 정보 업데이트 (기본 정보와 병합)
    const mergedItem = { ...item, ...updatedItem };
    updateModalWithDetails(mergedItem);

    // 추가 이미지가 있다면 업데이트
    if (mergedItem.additional_images) {
      try {
        const images = JSON.parse(mergedItem.additional_images);
        initializeImages(images);
      } catch (e) {
        console.log("Error parsing additional images:", e);
        initializeImages([mergedItem.image]);
      }
    }
  } catch (error) {
    console.error("Failed to fetch item details:", error);
    // 오류 발생 시 기본 정보로만 표시
    updateModalWithDetails(item);
  } finally {
    hideLoadingInModal();
  }
}
function updateModalWithDetails(item) {
  // 각 필드를 개별적으로 안전하게 업데이트
  const updateField = (selector, value, defaultValue = "정보 없음") => {
    const element = document.querySelector(selector);
    if (element) {
      element.textContent = value || defaultValue;
    }
  };

  updateField(".modal-description", item.description);
  updateField(".modal-category", item.category);
  updateField(".modal-accessory-code", item.accessory_code);
  updateField(".modal-scheduled-date", formatDate(item.scheduled_date));
  updateField(".modal-brand", item.brand);
  updateField(".modal-brand2", item.brand);
  updateField(".modal-title", item.title);
  updateField(
    ".modal-final-price",
    item.final_price ? `${formatNumber(parseInt(item.final_price))} ¥` : null
  );
}

// 이벤트 핸들러
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
// values.js에 추가
function showLoadingInModal() {
  const existingLoader = document.getElementById("modal-loading");
  if (existingLoader) return;

  const loadingElement = createElement("div", "", "상세 정보를 불러오는 중...");
  loadingElement.id = "modal-loading";
  loadingElement.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(255, 255, 255, 0.8);
        padding: 10px;
        border-radius: 5px;
    `;
  document.querySelector(".modal-content").appendChild(loadingElement);
}

function hideLoadingInModal() {
  const loadingElement = document.getElementById("modal-loading");
  if (loadingElement) {
    loadingElement.remove();
  }
}

async function initialize() {
  await API.initialize();

  try {
    // admin 상태 체크 추가
    const adminResponse = await fetch("/api/admin/check-status");
    state.isAdmin = (await adminResponse.json()).isAdmin;

    // 기존 초기화 로직
    const [
      brandsResponse,
      categoriesResponse,
      datesResponse,
      ranksResponse,
      aucNumsResponse,
    ] = await Promise.all([
      API.fetchAPI("/values/brands-with-count"),
      API.fetchAPI("/values/categories"),
      API.fetchAPI("/values/scheduled-dates-with-count"),
      API.fetchAPI("/values/ranks"),
      API.fetchAPI("/values/auc-nums"),
    ]);

    displayFilters(
      brandsResponse,
      categoriesResponse,
      datesResponse,
      ranksResponse,
      aucNumsResponse
    );

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

    document.querySelector(".prev")?.addEventListener("click", () => {
      const newIndex =
        (state.currentImageIndex - 1 + state.images.length) %
        state.images.length;
      changeMainImage(newIndex);
    });

    document.querySelector(".next")?.addEventListener("click", () => {
      const newIndex = (state.currentImageIndex + 1) % state.images.length;
      changeMainImage(newIndex);
    });

    // 가격 수정 기능 설정
    setupPriceEditing();

    // 초기 데이터 로드
    await fetchData();
  } catch (error) {
    console.error("Error initializing:", error);
    alert("초기화 중 오류가 발생했습니다.");
  }
}

// 페이지 로드 시 초기화
document.addEventListener("DOMContentLoaded", initialize);
