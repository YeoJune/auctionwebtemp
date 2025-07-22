// public/js/common.js

// 날짜 포맷팅
function formatDate(dateString, isUTC2KST = false) {
  if (!dateString) return "-";
  const date = new Date(dateString);

  let targetDate = date;
  if (isUTC2KST) {
    targetDate = new Date(
      date.toLocaleString("en-US", { timeZone: "Asia/Seoul" })
    );
  }

  return targetDate.toISOString().split("T")[0];
}

// 날짜 + 시간 포맷팅 함수
function formatDateTime(dateString, isUTC2KST = false) {
  if (!dateString) return "-";
  const date = new Date(dateString);

  let targetDate = date;
  if (isUTC2KST) {
    targetDate = new Date(
      date.toLocaleString("en-US", { timeZone: "Asia/Seoul" })
    );
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
    closeBtn.onclick = () => {
      modal.style.display = "none";

      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has("item_id")) {
        urlParams.delete("item_id");
        const newUrl =
          window.location.pathname +
          (urlParams.toString() ? `?${urlParams}` : "");
        window.history.replaceState({}, document.title, newUrl);
      }
    };
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

function setupMobileFilters() {
  const filterBtn = document.getElementById("mobileFilterBtn");
  const filtersContainer = document.querySelector(".filters-container");

  // 요소가 없으면 함수 종료
  if (!filterBtn || !filtersContainer) {
    console.error("Mobile filter elements not found");
    return;
  }

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

  // 필터 닫기 함수를 전역에 정의
  if (!window.mobileFilterFunctions) {
    window.mobileFilterFunctions = {};
  }

  window.mobileFilterFunctions.closeFilter = function () {
    if (filtersContainer) {
      filtersContainer.classList.remove("active");
    }
    if (backdrop) {
      backdrop.style.display = "none";
    }
    document.body.style.overflow = "";
    console.log("필터 닫기 함수 실행됨");
  };

  // 이미 추가된 요소 확인 및 중복 방지
  let filtersHeader = filtersContainer.querySelector(".filters-header");
  if (!filtersHeader) {
    // 필터 헤더 추가
    filtersHeader = document.createElement("div");
    filtersHeader.className = "filters-header";
    filtersHeader.textContent = "필터";
    filtersContainer.prepend(filtersHeader);
  }

  // 닫기 버튼이 이미 있는지 확인
  let closeBtn = filtersContainer.querySelector(".filter-close-btn");
  if (closeBtn) {
    closeBtn.remove(); // 기존 버튼 제거
  }

  // 필터 닫기 버튼 새로 추가
  closeBtn = document.createElement("button");
  closeBtn.className = "filter-close-btn";
  closeBtn.innerHTML = "&times;";
  closeBtn.setAttribute("aria-label", "필터 닫기");

  // 기존 이벤트 리스너 제거를 위해 버튼 복제 후 다시 추가
  closeBtn.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    window.mobileFilterFunctions.closeFilter();
  });

  filtersContainer.prepend(closeBtn);

  // 기존 버튼 이벤트 제거를 위해 복제
  const filterBtnClone = filterBtn.cloneNode(true);
  filterBtn.parentNode.replaceChild(filterBtnClone, filterBtn);

  // 필터 열기 버튼 이벤트 추가
  filterBtnClone.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    filtersContainer.classList.add("active");
    backdrop.style.display = "block";
    document.body.style.overflow = "hidden";
  });

  // 백드롭 이벤트 리스너 추가
  backdrop.addEventListener("click", window.mobileFilterFunctions.closeFilter);

  console.log("모바일 필터 설정 완료");

  // ESC 키 이벤트 리스너
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && filtersContainer.classList.contains("active")) {
      window.mobileFilterFunctions.closeFilter();
    }
  });

  // 필터 적용 버튼에 이벤트 추가
  const applyFiltersBtn = document.getElementById("applyFiltersBtn");
  if (applyFiltersBtn) {
    applyFiltersBtn.addEventListener("click", function () {
      if (window.innerWidth <= 768) {
        window.mobileFilterFunctions.closeFilter();
      }
    });
  }
}

function displayFilters(brands, categories, dates, ranks, aucNums) {
  displayBrandFilters(brands);
  displayCategoryFilters(categories);
  displayDateFilters(dates);
  displayRankFilters(ranks);
  // --- TEMP BEGIN ---
  aucNums = [{ auc_num: "1" }, { auc_num: "2" }, { auc_num: "3" }];
  displayAucNumFilters(aucNums);
  // --- TEMP END ---
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
        window.state.selectedDates,
        normalizedDate
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

// 모바일 메뉴 설정 함수
// 모바일 메뉴 설정 함수 개선
function setupMobileMenu() {
  // 필요한 요소 찾기
  const menuToggle = document.querySelector(".mobile-menu-toggle");
  const navContainer = document.querySelector(".nav-container");

  // 요소가 없으면 함수 종료
  if (!menuToggle || !navContainer) {
    console.error("Mobile menu elements not found");
    return;
  }

  // 모바일 메뉴 기능을 전역 변수에 저장
  if (!window.mobileMenuFunctions) {
    window.mobileMenuFunctions = {};
  }

  // 모바일 메뉴 닫기 함수 전역 등록
  window.mobileMenuFunctions.closeMobileMenu = function () {
    navContainer.classList.remove("active");
    document.body.style.overflow = ""; // 배경 스크롤 복원

    // X 아이콘을 햄버거 아이콘으로 변경
    const icon = menuToggle.querySelector("i");
    if (icon) {
      icon.classList.remove("fa-times");
      icon.classList.add("fa-bars");
    }

    // 추가된 active 클래스 제거
    menuToggle.classList.remove("active");

    // 열려있는 모든 드롭다운 닫기
    document
      .querySelectorAll(".dropdown-content.active")
      .forEach((dropdown) => {
        dropdown.classList.remove("active");
      });
  };

  // 모바일 메뉴 열기 함수 전역 등록
  window.mobileMenuFunctions.openMobileMenu = function () {
    navContainer.classList.add("active");
    document.body.style.overflow = "hidden"; // 배경 스크롤 방지

    // 햄버거 아이콘을 X 아이콘으로 변경
    const icon = menuToggle.querySelector("i");
    if (icon) {
      icon.classList.remove("fa-bars");
      icon.classList.add("fa-times");
    }

    menuToggle.classList.add("active");
  };

  // 기존 이벤트 리스너 제거 (중복 방지)
  const menuToggleClone = menuToggle.cloneNode(true);
  menuToggle.parentNode.replaceChild(menuToggleClone, menuToggle);

  // 토글 버튼 클릭 이벤트 (새로운 요소에 이벤트 추가)
  menuToggleClone.addEventListener("click", function (e) {
    // 이벤트 버블링 방지 - 이 부분이 중요!
    e.preventDefault();
    e.stopPropagation();

    // 모바일 메뉴 상태에 따라 토글
    if (navContainer.classList.contains("active")) {
      window.mobileMenuFunctions.closeMobileMenu();
    } else {
      window.mobileMenuFunctions.openMobileMenu();
    }
  });

  // 이벤트 위임: 네비게이션 컨테이너에 하나의 이벤트 리스너
  navContainer.addEventListener("click", function (e) {
    // 모바일 모드이고 일반 네비게이션 버튼이 클릭된 경우에만 처리
    // 드롭다운 버튼은 별도로 처리되어야 함
    if (
      window.innerWidth <= 768 &&
      e.target.classList.contains("nav-button") &&
      !e.target.closest(".dropdown-container")
    ) {
      window.mobileMenuFunctions.closeMobileMenu();
    }
  });

  // 외부 클릭 시 메뉴 닫기
  document.addEventListener("click", function (e) {
    if (
      window.innerWidth <= 768 &&
      navContainer.classList.contains("active") &&
      !navContainer.contains(e.target) &&
      !menuToggleClone.contains(e.target)
    ) {
      window.mobileMenuFunctions.closeMobileMenu();
    }
  });

  // ESC 키 누를 때 메뉴 닫기
  document.addEventListener("keydown", function (e) {
    if (
      e.key === "Escape" &&
      window.innerWidth <= 768 &&
      navContainer.classList.contains("active")
    ) {
      window.mobileMenuFunctions.closeMobileMenu();
    }
  });

  // 화면 크기 변경 시 메뉴 상태 재설정
  window.addEventListener("resize", function () {
    if (window.innerWidth > 768) {
      window.mobileMenuFunctions.closeMobileMenu();
    }
  });

  console.log("모바일 메뉴 설정 완료");
}

// 이 함수를 DOM이 로드된 후 호출
function preventEventConflicts() {
  // 모바일 토글 버튼이 클릭되었는지 확인하는 상태 변수
  let mobileToggleClicked = false;

  // 모바일 토글 버튼
  const mobileToggle = document.querySelector(".mobile-menu-toggle");

  if (mobileToggle) {
    // 기존 이벤트 제거를 위해 복제
    const newMobileToggle = mobileToggle.cloneNode(true);
    mobileToggle.parentNode.replaceChild(newMobileToggle, mobileToggle);

    // 토글 버튼에 클릭 이벤트 추가
    newMobileToggle.addEventListener("click", function (e) {
      // 중요: 이벤트 전파 중지
      e.stopPropagation();
      e.preventDefault();

      // 클릭 상태 플래그 설정 (짧은 시간 동안만 유지)
      mobileToggleClicked = true;

      // 토글 함수 실행 (setupMobileMenu에서 정의됨)
      if (window.mobileMenuFunctions) {
        if (
          document.querySelector(".nav-container").classList.contains("active")
        ) {
          window.mobileMenuFunctions.closeMobileMenu();
        } else {
          window.mobileMenuFunctions.openMobileMenu();
        }
      }

      // 50ms 후에 플래그 초기화 (다른 이벤트 처리 허용)
      setTimeout(() => {
        mobileToggleClicked = false;
      }, 50);
    });
  }

  // 드롭다운 버튼들
  const dropdownButtons = document.querySelectorAll(
    ".nav-item.dropdown-container > .nav-button"
  );

  dropdownButtons.forEach((button) => {
    // 기존 이벤트 제거를 위해 복제
    const newButton = button.cloneNode(true);
    button.parentNode.replaceChild(newButton, button);

    // 새 버튼에 이벤트 추가
    newButton.addEventListener("click", function (e) {
      // 모바일 토글 버튼이 방금 클릭되었다면 드롭다운 동작 무시
      if (mobileToggleClicked || e.target.closest(".mobile-menu-toggle")) {
        return;
      }

      // 이벤트 전파 중지
      e.stopPropagation();
      e.preventDefault();

      // 드롭다운 토글 로직 실행
      const dropdown = this.parentNode.querySelector(".dropdown-content");
      if (dropdown) {
        // 다른 모든 드롭다운 닫기
        document.querySelectorAll(".dropdown-content").forEach((d) => {
          if (d !== dropdown) d.classList.remove("active");
        });

        // 현재 드롭다운 토글
        dropdown.classList.toggle("active");

        // 버튼 상태 토글 (화살표 회전 애니메이션용)
        this.classList.toggle("active", dropdown.classList.contains("active"));
      }
    });
  });
}

// 모바일 메뉴 열기 함수
function openMobileMenu(navContainer, menuToggle) {
  navContainer.classList.add("active");
  document.body.style.overflow = "hidden"; // 배경 스크롤 방지

  // 햄버거 아이콘을 X 아이콘으로 변경
  const icon = menuToggle.querySelector("i");
  if (icon) {
    icon.classList.remove("fa-bars");
    icon.classList.add("fa-times");
  }

  // 아이콘 이외의 시각적 표시를 추가할 수도 있음
  menuToggle.classList.add("active");
}

// 모바일 메뉴 닫기 함수
function closeMobileMenu(navContainer, menuToggle) {
  navContainer.classList.remove("active");
  document.body.style.overflow = ""; // 배경 스크롤 복원

  // X 아이콘을 햄버거 아이콘으로 변경
  const icon = menuToggle.querySelector("i");
  if (icon) {
    icon.classList.remove("fa-times");
    icon.classList.add("fa-bars");
  }

  // 추가된 active 클래스 제거
  menuToggle.classList.remove("active");
}

// 페이지 로드 시 초기화
document.addEventListener("DOMContentLoaded", function () {
  setupMobileMenu();
  preventEventConflicts(); // 이벤트 충돌 방지 함수 호출
});
