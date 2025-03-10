// public/js/common.js

// 날짜 포맷팅
function formatDate(dateString) {
  if (!dateString) return "-";
  const date = new Date(dateString);
  const kstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kstDate.toISOString().split("T")[0];
}

// 날짜 + 시간 포맷팅 함수
function formatDateTime(dateString) {
  if (!dateString) return "-";
  const date = new Date(dateString);
  const kstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);

  const year = kstDate.getFullYear();
  const month = String(kstDate.getMonth() + 1).padStart(2, "0");
  const day = String(kstDate.getDate()).padStart(2, "0");
  const hours = String(kstDate.getHours()).padStart(2, "0");
  const minutes = String(kstDate.getMinutes()).padStart(2, "0");

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
function setupFilterSearch(inputId, filterId) {
  const searchInput = document.getElementById(inputId);
  const filterContainer = document.getElementById(filterId);

  searchInput?.addEventListener("input", function () {
    const searchTerm = this.value.toLowerCase();
    const filterItems = filterContainer.getElementsByClassName("filter-item");

    Array.from(filterItems).forEach((item) => {
      const label = item
        .getElementsByTagName("label")[0]
        .innerText.toLowerCase();
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
  const backdrop = document.createElement("div");
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

  if (filterBtn && filtersContainer) {
    filterBtn.addEventListener("click", () => {
      filtersContainer.classList.add("active");
      backdrop.style.display = "block";
      document.body.style.overflow = "hidden";
    });

    // 백드롭 클릭시 필터 닫기
    backdrop.addEventListener("click", () => {
      filtersContainer.classList.remove("active");
      backdrop.style.display = "none";
      document.body.style.overflow = "";
    });

    // ESC 키로 필터 닫기
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && filtersContainer.classList.contains("active")) {
        filtersContainer.classList.remove("active");
        backdrop.style.display = "none";
        document.body.style.overflow = "";
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
  const brandSelect = document.getElementById("brandSelect");
  if (!brandSelect) return;

  // 기존 옵션 제거
  while (brandSelect.options.length > 1) {
    brandSelect.remove(1);
  }

  // 브랜드 정렬
  brands.sort((a, b) => {
    if (a.brand > b.brand) return 1;
    if (a.brand < b.brand) return -1;
    return 0;
  });

  // 새 옵션 추가
  brands.forEach((brand) => {
    const option = document.createElement("option");
    option.value = brand.brand;
    option.textContent = brand.brand;
    brandSelect.appendChild(option);
  });
}

function displayCategoryFilters(categories) {
  const categorySelect = document.getElementById("categorySelect");
  if (!categorySelect) return;

  // 기존 옵션 제거
  while (categorySelect.options.length > 1) {
    categorySelect.remove(1);
  }

  // 카테고리 정렬
  categories.sort();

  // 새 옵션 추가
  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category || "기타";
    categorySelect.appendChild(option);
  });
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
      const formattedDate = formatDate(date.Date);
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

// 초기화 함수
function initializeCommonFeatures() {
  setupMobileFilters();
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

// DOMContentLoaded 이벤트
document.addEventListener("DOMContentLoaded", initializeCommonFeatures);
