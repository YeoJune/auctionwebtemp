// public/js/common.js

// 날짜 포맷팅
function formatDate(dateString, isUTC2KST = false) {
  if (!dateString) return "-";
  const date = new Date(dateString);

  let targetDate = date;
  if (isUTC2KST) {
    targetDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  }

  return targetDate.toISOString().split("T")[0];
}

// 날짜 + 시간 포맷팅 함수
function formatDateTime(dateString, isUTC2KST = false) {
  if (!dateString) return "-";
  const date = new Date(dateString);

  let targetDate = date;
  if (isUTC2KST) {
    targetDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  }

  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, "0");
  const day = String(targetDate.getDate()).padStart(2, "0");
  const hours = String(targetDate.getHours()).padStart(2, "0");
  const minutes = String(targetDate.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

// 숫자 포맷팅 (1000 -> 1,000)
function formatNumber(num) {
  return (num || 0).toLocaleString();
}

// 숫자 클린 포맷팅 - 소수점 처리 및 콤마 표시
function cleanNumberFormat(num) {
  if (num === null || num === undefined) return "0";

  // 문자열로 변환
  const numStr = num.toString();

  // 소수점 처리
  if (numStr.includes(".")) {
    const parts = numStr.split(".");
    // 소수점 이하가 모두 0이면 정수만 반환
    if (parseInt(parts[1]) === 0) {
      return formatNumber(parseInt(parts[0]));
    }
    // 그렇지 않으면 소수점 포함하여 반환
    return formatNumber(parseFloat(numStr));
  }

  return formatNumber(parseInt(numStr));
}

// DOM 요소 생성 헬퍼 함수
function createElement(tag, className, textContent) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (textContent) element.textContent = textContent;
  return element;
}

// 필터 아이템 생성 함수
function createFilterItem(value, type, selectedArray, label = value) {
  const item = createElement("div", "filter-item");

  const checkbox = createElement("input");
  checkbox.type = "checkbox";
  checkbox.value = value;
  checkbox.id = `${type}-${value}`;

  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      selectedArray.push(value);
    } else {
      const index = selectedArray.indexOf(value);
      if (index > -1) selectedArray.splice(index, 1);
    }
  });

  const labelElement = createElement("label");
  labelElement.htmlFor = `${type}-${value}`;
  labelElement.textContent = label;

  item.appendChild(checkbox);
  item.appendChild(labelElement);
  return item;
}

// 필터 검색 설정
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

// 페이지네이션 생성 함수
function createPagination(currentPage, totalPages, onPageChange) {
  const container = document.getElementById("pagination");
  if (!container) return;

  container.innerHTML = "";
  if (totalPages <= 1) return;

  // 이전 버튼
  const prevButton = createElement("button", "", "이전");
  prevButton.disabled = currentPage <= 1;
  prevButton.addEventListener("click", () => onPageChange(currentPage - 1));
  container.appendChild(prevButton);

  // 페이지 번호
  const pageNumbers = getPageNumbers(currentPage, totalPages);
  pageNumbers.forEach((pageNum) => {
    if (pageNum === "...") {
      container.appendChild(document.createTextNode("..."));
    } else {
      const pageButton = createElement(
        "button",
        pageNum === currentPage ? "active" : ""
      );
      pageButton.textContent = pageNum;
      pageButton.addEventListener("click", () => onPageChange(pageNum));
      container.appendChild(pageButton);
    }
  });

  // 다음 버튼
  const nextButton = createElement("button", "", "다음");
  nextButton.disabled = currentPage >= totalPages;
  nextButton.addEventListener("click", () => onPageChange(currentPage + 1));
  container.appendChild(nextButton);
}

// 페이지 번호 생성
function getPageNumbers(currentPage, totalPages) {
  const pages = [];
  const totalPagesToShow = 5;
  const sidePages = Math.floor(totalPagesToShow / 2);

  let startPage = Math.max(currentPage - sidePages, 1);
  let endPage = Math.min(startPage + totalPagesToShow - 1, totalPages);

  if (endPage - startPage + 1 < totalPagesToShow) {
    startPage = Math.max(endPage - totalPagesToShow + 1, 1);
  }

  if (startPage > 1) {
    pages.push(1);
    if (startPage > 2) pages.push("...");
  }

  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) pages.push("...");
    pages.push(totalPages);
  }

  return pages;
}

// 모달 관련 함수
function setupModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return null;

  const closeBtn = modal.querySelector(".close");

  if (closeBtn) {
    closeBtn.onclick = () => (modal.style.display = "none");
  }

  window.onclick = (event) => {
    if (event.target === modal) {
      modal.style.display = "none";
    }
  };

  return {
    show: () => (modal.style.display = "flex"),
    hide: () => (modal.style.display = "none"),
    element: modal,
  };
}

// 로딩 상태 관리
function toggleLoading(show) {
  const loadingMsg = document.getElementById("loadingMsg");
  if (loadingMsg) {
    loadingMsg.style.display = show ? "block" : "none";
  }
}

// 모바일 필터 토글
function setupMobileFilters() {
  const filterBtn = document.getElementById("mobileFilterBtn");
  const filtersContainer = document.querySelector(".filters-container");

  // 이미 백드롭이 있는지 확인
  let backdrop = document.querySelector(".filter-backdrop");

  // 백드롭이 없으면 생성
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.className = "filter-backdrop";
    backdrop.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      z-index: 899;
      display: none;
    `;
    document.body.appendChild(backdrop);
  }

  // 필터 닫기 함수
  window.closeFilter = function () {
    filtersContainer.classList.remove("active");
    backdrop.style.display = "none";
    document.body.style.overflow = "";
    console.log("필터 닫기 함수 실행됨");
  };

  if (filterBtn && filtersContainer) {
    // 이미 추가된 요소 확인 및 중복 방지
    let filtersHeader = document.querySelector(".filters-header");
    if (!filtersHeader) {
      // 필터 헤더 추가
      filtersHeader = document.createElement("div");
      filtersHeader.className = "filters-header";
      filtersHeader.textContent = "필터";
      filtersContainer.prepend(filtersHeader);
    }

    // 닫기 버튼이 이미 있는지 확인
    let closeBtn = document.querySelector(".filter-close-btn");
    if (closeBtn) {
      closeBtn.remove(); // 기존 버튼 제거
    }

    // 필터 닫기 버튼 새로 추가 (onclick 직접 사용)
    closeBtn = document.createElement("button");
    closeBtn.className = "filter-close-btn";
    closeBtn.innerHTML = "&times;";
    closeBtn.setAttribute("aria-label", "필터 닫기");
    closeBtn.setAttribute("onclick", "window.closeFilter()");
    filtersContainer.prepend(closeBtn);

    // 필터 열기 버튼 이벤트
    filterBtn.onclick = function () {
      filtersContainer.classList.add("active");
      backdrop.style.display = "block";
      document.body.style.overflow = "hidden";
    };

    // 백드롭 이벤트
    backdrop.onclick = window.closeFilter;

    console.log("모바일 필터 설정 완료: 직접 onclick 사용");

    // ESC 키 이벤트 리스너
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && filtersContainer.classList.contains("active")) {
        window.closeFilter();
      }
    });
  }
}

function displayFilters(brands, categories, dates, ranks, aucNums) {
  displayBrandFilters(brands);
  displayCategoryFilters(categories);
  displayDateFilters(dates);
  displayRankFilters(ranks);
  displayAucNumFilters(aucNums);
}

function displayBrandFilters(brands) {
  const brandCheckboxes = document.getElementById("brandCheckboxes");
  if (!brandCheckboxes) return;

  // 기존 옵션 제거 (전체 선택 제외)
  const allCheckbox = brandCheckboxes.querySelector(".multiselect-all");
  brandCheckboxes.innerHTML = "";
  if (allCheckbox) brandCheckboxes.appendChild(allCheckbox);

  // 브랜드 정렬
  brands.sort((a, b) => {
    // 개수 내림차순으로 정렬 (많은 것부터)
    return (b.count || 0) - (a.count || 0);
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
      countSpan.textContent = `(${brand.count})`;
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

function displayDateFilters(dates) {
  const scheduledDateFilters = document.getElementById("scheduledDateFilters");
  if (!scheduledDateFilters) return;

  scheduledDateFilters.innerHTML = "";

  const noScheduledDateItem = createFilterItem(
    "NO_DATE",
    "date",
    window.state.selectedDates,
    "날짜 없음"
  );
  scheduledDateFilters.appendChild(noScheduledDateItem);

  dates.forEach((date) => {
    if (date.Date) {
      const formattedDate = formatDate(date.Date, true);
      // 개수 표시 제거
      const dateItem = createFilterItem(
        date.Date,
        "date",
        window.state.selectedDates,
        formattedDate
      );
      scheduledDateFilters.appendChild(dateItem);
    }
  });
}

function displayRankFilters(ranks) {
  const rankFilters = document.getElementById("rankFilters");
  if (!rankFilters) return;

  rankFilters.innerHTML = "";
  const rankOrder = ["N", "S", "A", "AB", "B", "BC", "C", "D", "E", "F"];
  const rankMap = new Map(ranks.map((r) => [r.rank, r]));

  rankOrder.forEach((rank) => {
    const rankData = rankMap.get(rank);
    if (rankData) {
      // 개수 표시 제거
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

    const label = document.createElement("label");
    label.htmlFor = `aucNum-${item.auc_num}`;

    filterItem.appendChild(checkbox);
    filterItem.appendChild(label);
    aucNumFilters.appendChild(filterItem);
  });
}

function displayFavoriteFilters() {
  const favoriteFilters = document.getElementById("favoriteFilters");
  if (!favoriteFilters) return;

  favoriteFilters.innerHTML = "";

  for (let i = 1; i <= 3; i++) {
    const filterItem = document.createElement("div");
    filterItem.className = "filter-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `favorite-${i}`;
    checkbox.value = i;

    const label = document.createElement("label");
    label.htmlFor = `favorite-${i}`;

    filterItem.appendChild(checkbox);
    filterItem.appendChild(label);
    favoriteFilters.appendChild(filterItem);
  }
}

// 공지사항 관련 함수
async function showNoticeSection() {
  const noticeSection = document.querySelector(".notice-section");
  const showNoticesBtn = document.getElementById("showNoticesBtn");

  if (!noticeSection || !showNoticesBtn) return;

  if (noticeSection.style.display === "none") {
    noticeSection.style.display = "block";
    showNoticesBtn.innerHTML =
      '<i class="fas fa-bullhorn fa-lg"></i> 공지사항 닫기';
    await fetchNotices();
  } else {
    noticeSection.style.display = "none";
    showNoticesBtn.innerHTML =
      '<i class="fas fa-bullhorn fa-lg"></i> 공지사항 보기';
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

// 모바일 메뉴 관련 함수 추가
function initMobileMenu() {
  // 헤더에 햄버거 메뉴 버튼 추가
  const headerContent = document.querySelector(".header-content");
  if (!headerContent) return;

  // 이미 생성된 버튼이 있으면 생성하지 않음
  if (!document.querySelector(".mobile-menu-toggle")) {
    const menuButton = document.createElement("button");
    menuButton.className = "mobile-menu-toggle";
    menuButton.innerHTML = '<i class="fas fa-bars"></i>';
    menuButton.setAttribute("aria-label", "모바일 메뉴 열기");
    headerContent.appendChild(menuButton);
  }

  // 오버레이 생성
  if (!document.querySelector(".menu-overlay")) {
    const overlay = document.createElement("div");
    overlay.className = "menu-overlay";
    document.body.appendChild(overlay);

    // 오버레이 클릭 시 메뉴 닫기
    overlay.addEventListener("click", function () {
      toggleMobileMenu(false);
    });
  }

  // 햄버거 메뉴 버튼 클릭 이벤트 리스너
  const menuButton = document.querySelector(".mobile-menu-toggle");
  if (menuButton) {
    menuButton.addEventListener("click", function () {
      toggleMobileMenu();
    });
  }

  // 메뉴 아이템에 클릭 이벤트 추가 - 클릭 시 자동으로 메뉴 닫힘
  const navButtons = document.querySelectorAll(".nav-button");
  navButtons.forEach((button) => {
    button.addEventListener("click", function () {
      // 모바일 화면에서만 자동으로 메뉴 닫기 동작
      if (window.innerWidth <= 768) {
        setTimeout(() => toggleMobileMenu(false), 150);
      }
    });
  });
}

// 모바일 메뉴 토글 함수
function toggleMobileMenu(force) {
  const navContainer = document.querySelector(".nav-container");
  const authContainer = document.querySelector(".auth-container");
  const overlay = document.querySelector(".menu-overlay");
  const menuButton = document.querySelector(".mobile-menu-toggle");

  if (!navContainer || !overlay) return;

  const isOpen =
    typeof force === "boolean"
      ? force
      : !navContainer.classList.contains("active");

  navContainer.classList.toggle("active", isOpen);
  if (authContainer) authContainer.classList.toggle("active", isOpen);
  overlay.classList.toggle("active", isOpen);

  // 메뉴 아이콘 변경
  if (menuButton) {
    if (isOpen) {
      menuButton.innerHTML = '<i class="fas fa-times"></i>';
      menuButton.setAttribute("aria-label", "모바일 메뉴 닫기");
    } else {
      menuButton.innerHTML = '<i class="fas fa-bars"></i>';
      menuButton.setAttribute("aria-label", "모바일 메뉴 열기");
    }
  }

  // 메뉴가 열렸을 때 body 스크롤 방지
  document.body.style.overflow = isOpen ? "hidden" : "";
}

// 화면 크기 변경 시 대응
function handleResize() {
  const navContainer = document.querySelector(".nav-container");
  const authContainer = document.querySelector(".auth-container");
  const overlay = document.querySelector(".menu-overlay");

  if (window.innerWidth > 768) {
    // 태블릿/데스크톱 뷰에서는 강제로 네비게이션 표시 및 mobile active 클래스 제거
    if (navContainer) navContainer.classList.remove("active");
    if (authContainer) authContainer.classList.remove("active");
    if (overlay) overlay.classList.remove("active");
    document.body.style.overflow = "";

    // 메뉴 버튼 아이콘 원래대로
    const menuButton = document.querySelector(".mobile-menu-toggle");
    if (menuButton) {
      menuButton.innerHTML = '<i class="fas fa-bars"></i>';
      menuButton.setAttribute("aria-label", "모바일 메뉴 열기");
    }
  }
}

// 초기화 함수
function initializeCommonFeatures() {
  // 모바일 필터 설정
  setupMobileFilters();

  // 모바일 메뉴 초기화
  initMobileMenu();

  // 화면 크기 변경 시 이벤트
  window.addEventListener("resize", handleResize);
}

// DOMContentLoaded 이벤트
document.addEventListener("DOMContentLoaded", initializeCommonFeatures);
