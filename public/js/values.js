// public/js/values.js

// 상태 관리
window.state = {
  selectedBrands: [],
  selectedCategories: [],
  selectedRanks: [],
  selectedAucNums: [],
  currentPage: 1,
  itemsPerPage: 20,
  totalItems: 0,
  totalPages: 0,
  searchTerm: "",
  sortBy: "scheduled_date", // 기본 정렬 필드: 마감일
  sortOrder: "asc", // 기본 정렬 방향: 오름차순
  currentData: [],
  images: [],
  currentImageIndex: 0,
  isAuthenticated: false,
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

  const viewType = document
    .getElementById("cardViewBtn")
    .classList.contains("active")
    ? "card"
    : "list";
  dataBody.classList.toggle("list-view", viewType === "list");

  data.forEach((item) => {
    const card = createProductCard(item);
    dataBody.appendChild(card);
  });
}

// 제품 카드 생성
function createProductCard(item) {
  const card = createElement("div", "product-card");
  card.dataset.itemId = item.item_id;

  // 관리자인 경우 가격 수정 UI 추가
  const priceDisplay = state.isAdmin
    ? `<div class="price-info">
         <span class="price-label">최종가격</span>
         <span class="price-value" data-item-id="${item.item_id}">
           ${formatNumber(parseInt(item.final_price || 0))} ¥
           <button class="edit-price-icon">
             <i class="fas fa-edit"></i>
           </button>
         </span>
       </div>`
    : `<div class="price-info">
         <span class="price-label">최종가격</span>
         <span class="price-value">${formatNumber(
           parseInt(item.final_price || 0)
         )} ¥</span>
       </div>`;

  card.innerHTML = `
    <div class="product-header">
      <div class="product-brand">${item.brand || ""}</div>
      <div class="product-title">${item.title || ""}</div>
      <div class="auction-info">
        <div class="auction-number">
          ${item.auc_num}<span>번</span>
        </div>
      </div>
    </div>
    <div class="product-image-container">
      <img src="${API.validateImageUrl(item.image)}" alt="${
    item.title
  }" class="product-image">
      <div class="product-rank">${item.rank || "N"}</div>
    </div>
    <div class="product-info-grid">
      <div class="info-cell">
        <div class="info-label">랭크</div>
        <div class="info-value">${item.rank || "N"}</div>
      </div>
      <div class="info-cell">
        <div class="info-label">경매일</div>
        <div class="info-value">${formatDate(item.scheduled_date) || "-"}</div>
      </div>
      <div class="info-cell">
        <div class="info-label">가격</div>
        <div class="info-value">${formatNumber(
          parseInt(item.final_price || 0)
        )} ¥</div>
      </div>
    </div>
  `;

  card.addEventListener("click", (event) => {
    if (!event.target.closest(".edit-price-icon")) {
      showDetails(item.item_id);
    }
  });

  return card;
}

// 가격 수정 설정 (관리자 기능)
function setupPriceEditing() {
  if (!state.isAdmin) return;

  document.getElementById("dataBody").addEventListener("click", async (e) => {
    const editIcon = e.target.closest(".edit-price-icon");
    if (!editIcon) return;
    e.stopPropagation();

    const priceSpan = editIcon.closest(".price-value");
    const currentPrice = priceSpan.textContent.trim().replace(/[^0-9]/g, "");
    const itemId = priceSpan.dataset.itemId;

    // 인라인 수정 UI로 변경
    const originalContent = priceSpan.innerHTML;
    priceSpan.innerHTML = `
      <input type="number" class="price-input" value="${currentPrice}" style="width: 80px; margin-right: 5px;" />
      <button class="save-price" style="padding: 3px 8px; margin-right: 5px;">저장</button>
      <button class="cancel-price" style="padding: 3px 8px; background-color: #f0f0f0; color: #333;">취소</button>
    `;

    const input = priceSpan.querySelector(".price-input");
    input.focus();

    // 저장 버튼 이벤트
    priceSpan.querySelector(".save-price").onclick = async (e) => {
      e.stopPropagation();
      const newPrice = input.value;
      try {
        const response = await API.fetchAPI(`/admin/values/${itemId}/price`, {
          method: "PUT",
          body: JSON.stringify({ final_price: newPrice }),
        });

        if (response) {
          priceSpan.innerHTML = `${formatNumber(
            parseInt(newPrice)
          )} ¥ <button class="edit-price-icon"><i class="fas fa-edit"></i></button>`;

          // 카드의 가격 정보도 업데이트
          const infoValue = priceSpan
            .closest(".product-card")
            .querySelector(".info-cell:nth-child(3) .info-value");
          if (infoValue) {
            infoValue.textContent = `${formatNumber(parseInt(newPrice))} ¥`;
          }
        }
      } catch (error) {
        console.error("Error updating price:", error);
        priceSpan.innerHTML = originalContent;
      }
    };

    // 취소 버튼 이벤트
    priceSpan.querySelector(".cancel-price").onclick = (e) => {
      e.stopPropagation();
      priceSpan.innerHTML = originalContent;
    };
  });
}

// 브랜드 필터 표시 (체크박스 방식)
function displayBrandFilters(brands) {
  const brandCheckboxes = document.getElementById("brandCheckboxes");
  if (!brandCheckboxes) return;

  // 기존 옵션 제거 (전체 선택 제외)
  const allCheckbox = brandCheckboxes.querySelector(".multiselect-all");
  brandCheckboxes.innerHTML = "";
  if (allCheckbox) brandCheckboxes.appendChild(allCheckbox);

  // 브랜드 정렬
  brands.sort((a, b) => {
    if (a.brand > b.brand) return 1;
    if (a.brand < b.brand) return -1;
    return 0;
  });

  // 전체 선택 체크박스 이벤트 설정
  const brandAllCheckbox = document.getElementById("brand-all");
  if (brandAllCheckbox) {
    brandAllCheckbox.addEventListener("change", function () {
      const checkboxes = brandCheckboxes.querySelectorAll(
        "input[type='checkbox']:not(#brand-all)"
      );
      checkboxes.forEach((checkbox) => {
        checkbox.checked = this.checked;

        // 체크 상태에 따라 selectedBrands 배열 업데이트
        const brandValue = checkbox.value;
        const index = window.state.selectedBrands.indexOf(brandValue);

        if (this.checked && index === -1) {
          window.state.selectedBrands.push(brandValue);
        } else if (!this.checked && index !== -1) {
          window.state.selectedBrands.splice(index, 1);
        }
      });

      // 선택된 항목 수 업데이트
      updateSelectedCount("brand");
    });
  }

  // 새 체크박스 추가
  brands.forEach((brand) => {
    if (!brand.brand) return; // 빈 브랜드명 제외

    const item = createElement("div", "filter-item");

    const checkbox = createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `brand-${brand.brand.replace(/\s+/g, "-")}`;
    checkbox.value = brand.brand;

    // 이미 선택된 브랜드면 체크
    if (window.state.selectedBrands.includes(brand.brand)) {
      checkbox.checked = true;
    }

    checkbox.addEventListener("change", function () {
      if (this.checked) {
        window.state.selectedBrands.push(this.value);
      } else {
        const index = window.state.selectedBrands.indexOf(this.value);
        if (index > -1) {
          window.state.selectedBrands.splice(index, 1);
        }
      }

      // "전체 선택" 체크박스 상태 업데이트
      updateAllCheckbox("brand");
      // 선택된 항목 수 업데이트
      updateSelectedCount("brand");
    });

    const label = createElement("label");
    label.htmlFor = checkbox.id;
    label.textContent = brand.brand;

    if (brand.count) {
      const countSpan = createElement("span", "item-count");
      countSpan.textContent = ` (${brand.count})`;
      label.appendChild(countSpan);
    }

    item.appendChild(checkbox);
    item.appendChild(label);
    brandCheckboxes.appendChild(item);
  });

  // 선택된 항목 수 업데이트
  updateSelectedCount("brand");
  // 검색 기능 설정
  setupFilterSearch("brandSearchInput", "brandCheckboxes");
}

// 카테고리 필터 표시 (체크박스 방식)
function displayCategoryFilters(categories) {
  const categoryCheckboxes = document.getElementById("categoryCheckboxes");
  if (!categoryCheckboxes) return;

  // 기존 옵션 제거 (전체 선택 제외)
  const allCheckbox = categoryCheckboxes.querySelector(".multiselect-all");
  categoryCheckboxes.innerHTML = "";
  if (allCheckbox) categoryCheckboxes.appendChild(allCheckbox);

  // 카테고리 정렬
  categories.sort();

  // 전체 선택 체크박스 이벤트 설정
  const categoryAllCheckbox = document.getElementById("category-all");
  if (categoryAllCheckbox) {
    categoryAllCheckbox.addEventListener("change", function () {
      const checkboxes = categoryCheckboxes.querySelectorAll(
        "input[type='checkbox']:not(#category-all)"
      );
      checkboxes.forEach((checkbox) => {
        checkbox.checked = this.checked;

        const categoryValue = checkbox.value;
        const index = window.state.selectedCategories.indexOf(categoryValue);

        if (this.checked && index === -1) {
          window.state.selectedCategories.push(categoryValue);
        } else if (!this.checked && index !== -1) {
          window.state.selectedCategories.splice(index, 1);
        }
      });

      // 선택된 항목 수 업데이트
      updateSelectedCount("category");
    });
  }

  // 새 체크박스 추가
  categories.forEach((category) => {
    if (!category) category = "기타"; // 빈 카테고리는 "기타"로 표시

    const item = createElement("div", "filter-item");

    const checkbox = createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `category-${category.replace(/\s+/g, "-")}`;
    checkbox.value = category;

    // 이미 선택된 카테고리면 체크
    if (window.state.selectedCategories.includes(category)) {
      checkbox.checked = true;
    }

    checkbox.addEventListener("change", function () {
      if (this.checked) {
        window.state.selectedCategories.push(this.value);
      } else {
        const index = window.state.selectedCategories.indexOf(this.value);
        if (index > -1) {
          window.state.selectedCategories.splice(index, 1);
        }
      }

      // "전체 선택" 체크박스 상태 업데이트
      updateAllCheckbox("category");
      // 선택된 항목 수 업데이트
      updateSelectedCount("category");
    });

    const label = createElement("label");
    label.htmlFor = checkbox.id;
    label.textContent = category;

    item.appendChild(checkbox);
    item.appendChild(label);
    categoryCheckboxes.appendChild(item);
  });

  // 선택된 항목 수 업데이트
  updateSelectedCount("category");
  // 검색 기능 설정
  setupFilterSearch("categorySearchInput", "categoryCheckboxes");
}

// 전체 선택 체크박스 상태 업데이트 함수
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

  // 모든 체크박스가 선택되었는지 확인
  allCheckbox.checked =
    checkedCount === checkboxes.length && checkboxes.length > 0;
}

// 선택된 항목 수 업데이트 함수
function updateSelectedCount(type) {
  const container = document.getElementById(`${type}Checkboxes`);
  if (!container) return;

  const checkboxes = container.querySelectorAll(
    `input[type='checkbox']:not(#${type}-all)`
  );
  const checkedCount = container.querySelectorAll(
    `input[type='checkbox']:not(#${type}-all):checked`
  ).length;

  let countElement = container.querySelector(`.multiselect-selected-count`);
  if (!countElement) {
    countElement = createElement("span", "multiselect-selected-count");
    container.querySelector(".multiselect-all label").appendChild(countElement);
  }

  countElement.textContent =
    checkedCount > 0 ? ` (${checkedCount}/${checkboxes.length})` : "";
}

// 검색 필터 함수
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

// 랭크 필터 표시
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
        window.state.selectedRanks,
        rankData.rank
      );
      rankFilters.appendChild(rankItem);
    }
  });
}

// 출품사 필터 표시
function displayAucNumFilters(aucNums) {
  const aucNumFilters = document.getElementById("aucNumFilters");
  if (!aucNumFilters) return;

  aucNumFilters.innerHTML = "";

  // 출품사 정렬
  aucNums.sort((a, b) => a.auc_num - b.auc_num);

  aucNums.forEach((item) => {
    const filterItem = document.createElement("div");
    filterItem.className = "filter-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `aucNum-${item.auc_num}`;
    checkbox.value = item.auc_num;

    // 이미 선택된 출품사면 체크
    if (window.state.selectedAucNums.includes(item.auc_num.toString())) {
      checkbox.checked = true;
    }

    checkbox.addEventListener("change", function () {
      if (this.checked) {
        window.state.selectedAucNums.push(this.value);
      } else {
        const index = window.state.selectedAucNums.indexOf(this.value);
        if (index > -1) {
          window.state.selectedAucNums.splice(index, 1);
        }
      }
    });

    const label = document.createElement("label");
    label.htmlFor = `aucNum-${item.auc_num}`;
    label.textContent = `${item.auc_num}번`;

    filterItem.appendChild(checkbox);
    filterItem.appendChild(label);
    aucNumFilters.appendChild(filterItem);
  });
}

// 필터 표시 통합 함수
function displayFilters(brands, categories, ranks, aucNums) {
  displayBrandFilters(brands);
  displayCategoryFilters(categories);
  displayRankFilters(ranks);
  displayAucNumFilters(aucNums);
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
      search: state.searchTerm,
      ranks: state.selectedRanks,
      aucNums: state.selectedAucNums.join(","),
      sortBy: state.sortBy, // 정렬 기준 필드
      sortOrder: state.sortOrder, // 정렬 방향
    };

    const queryString = API.createURLParams(params);
    const data = await API.fetchAPI(`/values?${queryString}`);

    state.totalItems = data.totalItems;
    state.totalPages = data.totalPages;

    displayData(data.data);
    createPagination(state.currentPage, state.totalPages, handlePageChange);
  } catch (error) {
    console.error("데이터를 불러오는 데 실패했습니다:", error);
    alert("데이터를 불러오는 데 실패했습니다.");
  } finally {
    toggleLoading(false);
  }
}

function setupSortOptions() {
  const sortOption = document.getElementById("sortOption");
  if (sortOption) {
    // 기본값 설정
    sortOption.value = `${state.sortBy}-${state.sortOrder}`;

    sortOption.addEventListener("change", function () {
      const [sortBy, sortOrder] = this.value.split("-");
      state.sortBy = sortBy;
      state.sortOrder = sortOrder;
      state.currentPage = 1; // 페이지 1로 리셋
      fetchData();
    });
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

  // 로딩 표시
  showLoadingInModal();

  try {
    // 상세 정보 가져오기
    const updatedItem = await API.fetchAPI(`/detail/value-details/${itemId}`, {
      method: "POST",
    });

    // 상세 정보 업데이트
    updateModalWithDetails(updatedItem);

    // 추가 이미지가 있다면 업데이트
    if (updatedItem.additional_images) {
      try {
        const images = JSON.parse(updatedItem.additional_images);
        initializeImages([updatedItem.image, ...images]);
      } catch (e) {
        console.error("Error parsing additional images:", e);
        initializeImages([updatedItem.image]);
      }
    }
  } catch (error) {
    console.error("Failed to fetch item details:", error);
  } finally {
    hideLoadingInModal();
  }
}

// 모달 초기화
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
  document.querySelector(".modal-rank").textContent = item.rank || "N";
  document.querySelector(".modal-final-price").textContent = item.final_price
    ? `${formatNumber(parseInt(item.final_price))} ¥`
    : "가격 정보 없음";

  // 이미지 초기화
  initializeImages([item.image]);
}

// 모달 상세 정보 업데이트
function updateModalWithDetails(item) {
  document.querySelector(".modal-description").textContent =
    item.description || "설명 없음";
  document.querySelector(".modal-category").textContent =
    item.category || "카테고리 없음";
  document.querySelector(".modal-accessory-code").textContent =
    item.accessory_code || "액세서리 코드 없음";
  document.querySelector(".modal-scheduled-date").textContent =
    formatDate(item.scheduled_date) || "날짜 정보 없음";
  document.querySelector(".modal-brand").textContent = item.brand || "";
  document.querySelector(".modal-brand2").textContent = item.brand || "";
  document.querySelector(".modal-title").textContent = item.title || "";
  document.querySelector(".modal-rank").textContent = item.rank || "N";
  document.querySelector(".modal-final-price").textContent = item.final_price
    ? `${formatNumber(parseInt(item.final_price))} ¥`
    : "가격 정보 없음";
}

// 이미지 초기화
function initializeImages(imageUrls) {
  // 유효한 이미지 URL만 필터링
  state.images = (Array.isArray(imageUrls) ? imageUrls : [])
    .filter((url) => url)
    .map((url) => API.validateImageUrl(url));
  state.currentImageIndex = 0;

  const mainImage = document.querySelector(".main-image");
  const thumbnailContainer = document.querySelector(".thumbnail-container");

  if (!mainImage || !thumbnailContainer) return;

  // 메인 이미지 설정
  if (state.images.length > 0) {
    mainImage.src = state.images[0];
  }

  // 썸네일 초기화
  thumbnailContainer.innerHTML = "";
  state.images.forEach((img, index) => {
    const thumbnailWrapper = createElement("div", "thumbnail");
    thumbnailWrapper.classList.toggle("active", index === 0);

    const thumbnail = createElement("img");
    thumbnail.src = img;
    thumbnail.alt = `Thumbnail ${index + 1}`;
    thumbnail.loading = "lazy";

    thumbnail.addEventListener("click", () => changeMainImage(index));
    thumbnailWrapper.appendChild(thumbnail);
    thumbnailContainer.appendChild(thumbnailWrapper);
  });

  // 네비게이션 버튼 상태 업데이트
  updateNavigationButtons();
}

// 메인 이미지 변경
function changeMainImage(index) {
  if (index < 0 || index >= state.images.length) return;

  state.currentImageIndex = index;
  const mainImage = document.querySelector(".main-image");
  if (!mainImage) return;

  mainImage.src = state.images[index];

  // 썸네일 active 상태 업데이트
  const thumbnails = document.querySelectorAll(".thumbnail");
  thumbnails.forEach((thumb, i) => {
    thumb.classList.toggle("active", i === index);
  });

  updateNavigationButtons();
}

// 네비게이션 버튼 상태 업데이트
function updateNavigationButtons() {
  const prevBtn = document.querySelector(".image-nav.prev");
  const nextBtn = document.querySelector(".image-nav.next");

  if (!prevBtn || !nextBtn) return;

  prevBtn.disabled = state.currentImageIndex === 0;
  nextBtn.disabled = state.currentImageIndex === state.images.length - 1;
}

// 페이지 전환 핸들러
function handlePageChange(page) {
  state.currentPage = page;
  fetchData();
}

// 검색 핸들러
function handleSearch() {
  const searchInput = document.getElementById("searchInput");
  state.searchTerm = searchInput.value;
  state.currentPage = 1;
  fetchData();
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

// 인증 UI 업데이트
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

// 로그아웃 핸들러
async function handleSignout() {
  try {
    await API.fetchAPI("/auth/logout", { method: "POST" });
    state.isAuthenticated = false;
    location.reload();
  } catch (error) {
    alert("로그아웃 중 오류가 발생했습니다.");
  }
}

// 모달 로딩 표시
function showLoadingInModal() {
  const existingLoader = document.getElementById("modal-loading");
  if (existingLoader) return;

  const loadingElement = createElement("div", "modal-loading");
  loadingElement.id = "modal-loading";
  loadingElement.textContent = "상세 정보를 불러오는 중...";

  document.querySelector(".modal-content")?.appendChild(loadingElement);
}

// 모달 로딩 감추기
function hideLoadingInModal() {
  document.getElementById("modal-loading")?.remove();
}

// 뷰 타입 설정
function setupViewType() {
  const cardViewBtn = document.getElementById("cardViewBtn");
  const listViewBtn = document.getElementById("listViewBtn");
  const dataBody = document.getElementById("dataBody");

  if (cardViewBtn && listViewBtn && dataBody) {
    cardViewBtn.addEventListener("click", function () {
      listViewBtn.classList.remove("active");
      this.classList.add("active");
      dataBody.classList.remove("list-view");
    });

    listViewBtn.addEventListener("click", function () {
      cardViewBtn.classList.remove("active");
      this.classList.add("active");
      dataBody.classList.add("list-view");
    });
  }
}

// 정렬 옵션 설정
function setupSortOptions() {
  const sortOption = document.getElementById("sortOption");
  if (sortOption) {
    sortOption.addEventListener("change", function () {
      state.sortOption = this.value;
      state.currentPage = 1;
      fetchData();
    });
  }
}

// 표시 개수 설정
function setupItemsPerPage() {
  const itemsPerPage = document.getElementById("itemsPerPage");
  if (itemsPerPage) {
    itemsPerPage.addEventListener("change", function () {
      state.itemsPerPage = parseInt(this.value);
      state.currentPage = 1;
      fetchData();
    });
  }
}

// 관리자 권한 확인
async function checkAdminStatus() {
  try {
    const response = await API.fetchAPI("/admin/check-status");
    state.isAdmin = response.isAdmin;
  } catch (error) {
    state.isAdmin = false;
  }
}

// 모바일 필터 설정
function setupMobileFilters() {
  const filterBtn = document.getElementById("mobileFilterBtn");
  const filtersContainer = document.querySelector(".filters-container");

  if (filterBtn && filtersContainer) {
    filterBtn.addEventListener("click", () => {
      filtersContainer.classList.toggle("active");
    });

    // 필터 외부 클릭시 닫기
    document.addEventListener("click", (e) => {
      if (
        filtersContainer.classList.contains("active") &&
        !filtersContainer.contains(e.target) &&
        e.target !== filterBtn
      ) {
        filtersContainer.classList.remove("active");
      }
    });
  }
}

// 초기화 함수
async function initialize() {
  try {
    // API 초기화
    await API.initialize();

    // 인증 상태 확인
    await checkAuthStatus();

    // 관리자 권한 확인
    await checkAdminStatus();

    // 필터 데이터 가져오기
    const [brands, categories, ranks, aucNums] = await Promise.all([
      API.fetchAPI("/values/brands-with-count"),
      API.fetchAPI("/values/categories"),
      API.fetchAPI("/values/ranks"),
      API.fetchAPI("/values/auc-nums"),
    ]);

    // 필터 표시
    displayFilters(brands, categories, ranks, aucNums);

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

    document
      .getElementById("resetFiltersBtn")
      ?.addEventListener("click", () => {
        // 필터 리셋
        state.selectedBrands = [];
        state.selectedCategories = [];
        state.selectedRanks = [];
        state.selectedAucNums = [];

        // 체크박스 초기화
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

        document
          .querySelectorAll("#rankFilters input[type='checkbox']")
          .forEach((checkbox) => {
            checkbox.checked = false;
          });

        document
          .querySelectorAll("#aucNumFilters input[type='checkbox']")
          .forEach((checkbox) => {
            checkbox.checked = false;
          });

        // 선택된 항목 수 업데이트
        updateSelectedCount("brand");
        updateSelectedCount("category");

        // 검색어 초기화
        document.getElementById("searchInput").value = "";
        state.searchTerm = "";

        // 정렬 옵션 초기화
        state.sortBy = "scheduled_date";
        state.sortOrder = "asc";
        document.getElementById("sortOption").value = "scheduled_date-asc";

        // 데이터 다시 가져오기
        state.currentPage = 1;
        fetchData();
      });

    document.getElementById("signinBtn")?.addEventListener("click", () => {
      window.location.href = "./pages/signin.html";
    });

    document
      .getElementById("signoutBtn")
      ?.addEventListener("click", handleSignout);

    document.querySelector(".prev")?.addEventListener("click", () => {
      changeMainImage(state.currentImageIndex - 1);
    });

    document.querySelector(".next")?.addEventListener("click", () => {
      changeMainImage(state.currentImageIndex + 1);
    });

    // 뷰 타입 설정
    setupViewType();

    // 정렬 옵션 설정
    setupSortOptions();

    // 표시 개수 설정
    setupItemsPerPage();

    // 모바일 필터 설정
    setupMobileFilters();

    // 관리자인 경우 가격 수정 기능 설정
    if (state.isAdmin) {
      setupPriceEditing();
    }

    // 초기 데이터 로드
    await fetchData();
  } catch (error) {
    console.error("Error initializing:", error);
    alert("초기화 중 오류가 발생했습니다.");
  }
}

// 페이지 로드 시 초기화 실행
document.addEventListener("DOMContentLoaded", initialize);
