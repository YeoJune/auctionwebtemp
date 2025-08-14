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

// 필터 아이템 생성 함수 (범용)
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

// 페이지네이션 생성 함수 (범용)
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

// 모달 관련 함수 (범용)
function setupModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return null;

  const closeBtn = modal.querySelector(".close");

  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.classList.remove("modal-show");
      modal.classList.add("modal-hide");

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
      modal.classList.remove("modal-show");
      modal.classList.add("modal-hide");
    }
  };

  return {
    show: () => {
      modal.classList.remove("modal-hide");
      modal.classList.add("modal-show");
    },
    hide: () => {
      modal.classList.remove("modal-show");
      modal.classList.add("modal-hide");
    },
    element: modal,
  };
}

// 로딩 상태 관리 (범용)
function toggleLoading(show) {
  const loadingMsg = document.getElementById("loadingMsg");
  if (loadingMsg) {
    if (show) {
      loadingMsg.classList.remove("loading-hidden");
      loadingMsg.classList.add("loading-visible");
    } else {
      loadingMsg.classList.remove("loading-visible");
      loadingMsg.classList.add("loading-hidden");
    }
  }
}

// 네비게이션 버튼 상태 업데이트 (범용 - 이미지 갤러리용)
function updateNavigationButtons() {
  const prevBtn = document.querySelector(".image-nav.prev");
  const nextBtn = document.querySelector(".image-nav.next");

  if (!prevBtn || !nextBtn) return;

  // 현재 이미지 인덱스는 호출하는 곳에서 전달받아야 함
  // 이 함수는 범용이므로 전역 상태에 의존하지 않음
  const currentIndex = window.currentImageIndex || 0;
  const totalImages = window.totalImages || 0;

  prevBtn.disabled = currentIndex === 0;
  nextBtn.disabled = currentIndex === totalImages - 1;
}

// 인증 시스템 (모든 페이지에서 사용 가능)
window.AuthManager = (function () {
  let isAuthenticated = false;
  let user = null;
  let isAdmin = false;

  /**
   * 인증 상태 확인
   */
  async function checkAuthStatus() {
    try {
      const response = await window.API.fetchAPI("/auth/user");
      isAuthenticated = !!response.user;
      user = response.user;

      // 관리자 권한 확인
      if (isAuthenticated) {
        try {
          const adminResponse = await window.API.fetchAPI(
            "/admin/check-status"
          );
          isAdmin = adminResponse.isAdmin;
        } catch (error) {
          isAdmin = false;
        }
      }

      updateAuthUI();
      return isAuthenticated;
    } catch (error) {
      isAuthenticated = false;
      user = null;
      isAdmin = false;
      updateAuthUI();
      return false;
    }
  }

  /**
   * 인증 UI 업데이트
   */
  function updateAuthUI() {
    const authContainer = document.querySelector(".auth-container");
    if (!authContainer) return;

    if (isAuthenticated) {
      authContainer.classList.remove("auth-unauthenticated");
      authContainer.classList.add("auth-authenticated");
    } else {
      authContainer.classList.remove("auth-authenticated");
      authContainer.classList.add("auth-unauthenticated");
    }
  }

  /**
   * 로그아웃 처리
   */
  async function handleSignout() {
    try {
      await window.API.fetchAPI("/auth/logout", { method: "POST" });
      isAuthenticated = false;
      user = null;
      isAdmin = false;
      location.reload();
    } catch (error) {
      alert("로그아웃 중 오류가 발생했습니다.");
    }
  }

  /**
   * 인증 필요 체크
   */
  function requireAuth(message = "로그인이 필요합니다.") {
    if (!isAuthenticated) {
      alert(message);
      return false;
    }
    return true;
  }

  /**
   * 관리자 권한 체크
   */
  function requireAdmin(message = "관리자 권한이 필요합니다.") {
    if (!isAuthenticated || !isAdmin) {
      alert(message);
      return false;
    }
    return true;
  }

  /**
   * 로그인 페이지로 이동
   */
  function redirectToSignin() {
    window.location.href = "/signinPage";
  }

  // 공개 API
  return {
    checkAuthStatus,
    updateAuthUI,
    handleSignout,
    requireAuth,
    requireAdmin,
    redirectToSignin,

    // getter 함수들
    isAuthenticated: () => isAuthenticated,
    getUser: () => user,
    isAdmin: () => isAdmin,
  };
})();

// 모바일 메뉴 설정 (범용)
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
    navContainer.classList.remove("mobile-menu-active");
    document.body.classList.remove("no-scroll");

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
    navContainer.classList.add("mobile-menu-active");
    document.body.classList.add("no-scroll");

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
    if (navContainer.classList.contains("mobile-menu-active")) {
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
      navContainer.classList.contains("mobile-menu-active") &&
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
      navContainer.classList.contains("mobile-menu-active")
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

// 모바일 필터 설정 (범용)
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
    document.body.appendChild(backdrop);
  }

  // 필터 닫기 함수를 전역에 정의
  if (!window.mobileFilterFunctions) {
    window.mobileFilterFunctions = {};
  }

  window.mobileFilterFunctions.closeFilter = function () {
    if (filtersContainer) {
      filtersContainer.classList.remove("filter-active");
    }
    if (backdrop) {
      backdrop.classList.remove("filter-backdrop-visible");
    }
    document.body.classList.remove("no-scroll");
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
    filtersContainer.classList.add("filter-active");
    backdrop.classList.add("filter-backdrop-visible");
    document.body.classList.add("no-scroll");
  });

  // 백드롭 이벤트 리스너 추가
  backdrop.addEventListener("click", window.mobileFilterFunctions.closeFilter);

  console.log("모바일 필터 설정 완료");

  // ESC 키 이벤트 리스너
  document.addEventListener("keydown", function (e) {
    if (
      e.key === "Escape" &&
      filtersContainer.classList.contains("filter-active")
    ) {
      window.mobileFilterFunctions.closeFilter();
    }
  });
}

// 공지사항 관련 함수 (범용)
async function showNoticeSection() {
  const noticeSection = document.querySelector(".notice-section");
  const showNoticesBtn = document.getElementById("showNoticesBtn");

  if (!noticeSection || !showNoticesBtn) return;

  if (noticeSection.classList.contains("notice-hidden")) {
    noticeSection.classList.remove("notice-hidden");
    noticeSection.classList.add("notice-visible");
    showNoticesBtn.innerHTML =
      '<i class="fas fa-bullhorn fa-lg"></i> 공지사항 닫기';
    await fetchNotices();
  } else {
    noticeSection.classList.remove("notice-visible");
    noticeSection.classList.add("notice-hidden");
    showNoticesBtn.innerHTML =
      '<i class="fas fa-bullhorn fa-lg"></i> 공지사항 보기';
  }
}

async function fetchNotices() {
  try {
    const notices = await window.API.fetchAPI("/admin/notices");
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
    image.classList.remove("hidden");
    image.classList.add("show");
  } else {
    image.classList.remove("show");
    image.classList.add("hidden");
  }

  // 모달 표시 및 닫기 버튼 이벤트 설정
  modal.classList.remove("modal-hide");
  modal.classList.add("modal-show");

  const closeBtn = modal.querySelector(".close");
  const closeModal = () => {
    modal.classList.remove("modal-show");
    modal.classList.add("modal-hide");
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

// 툴팁 매니저 (범용)
window.TooltipManager = (function () {
  let tooltipContainer = null;
  let currentTooltip = null;
  let hideTimeout = null;
  let conditionalTooltips = new Map();

  /**
   * 툴팁 매니저 초기화
   */
  function init() {
    // 기존 툴팁 컨테이너가 있으면 제거
    if (tooltipContainer) {
      tooltipContainer.remove();
    }

    // 새 툴팁 컨테이너 생성
    tooltipContainer = document.createElement("div");
    tooltipContainer.className = "tooltip-container";
    tooltipContainer.style.cssText = `
      position: fixed;
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      line-height: 1.4;
      max-width: 250px;
      word-wrap: break-word;
      white-space: pre-line;
      z-index: 10000;
      display: none;
      pointer-events: none;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      transform: translateX(-50%);
      transition: opacity 0.2s ease;
    `;

    document.body.appendChild(tooltipContainer);
    setupEventListeners();

    console.log("TooltipManager 초기화 완료");
  }

  /**
   * 툴팁 표시
   */
  function show(element, message, position = "top") {
    if (!tooltipContainer || !element || !message) return;

    // 기존 타이머 클리어
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }

    // 툴팁 내용 설정
    tooltipContainer.textContent = message;
    tooltipContainer.classList.remove("hidden");
    tooltipContainer.classList.add("show");
    tooltipContainer.style.opacity = "1";

    // 위치 계산 및 설정
    positionTooltip(element, position);

    currentTooltip = element;
  }

  /**
   * 툴팁 숨기기
   */
  function hide(delay = 0) {
    if (!tooltipContainer) return;

    if (hideTimeout) {
      clearTimeout(hideTimeout);
    }

    if (delay > 0) {
      hideTimeout = setTimeout(() => {
        tooltipContainer.classList.remove("show");
        tooltipContainer.classList.add("hidden");
        tooltipContainer.style.opacity = "0";
        currentTooltip = null;
      }, delay);
    } else {
      tooltipContainer.classList.remove("show");
      tooltipContainer.classList.add("hidden");
      tooltipContainer.style.opacity = "0";
      currentTooltip = null;
    }
  }

  /**
   * 툴팁 위치 계산 및 설정
   */
  function positionTooltip(element, position) {
    const rect = element.getBoundingClientRect();
    const tooltipRect = tooltipContainer.getBoundingClientRect();
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    let left, top;

    switch (position) {
      case "bottom":
        left = rect.left + rect.width / 2;
        top = rect.bottom + 8;
        tooltipContainer.style.transform = "translateX(-50%)";
        break;

      case "left":
        left = rect.left - tooltipRect.width - 8;
        top = rect.top + rect.height / 2 - tooltipRect.height / 2;
        tooltipContainer.style.transform = "none";
        break;

      case "right":
        left = rect.right + 8;
        top = rect.top + rect.height / 2 - tooltipRect.height / 2;
        tooltipContainer.style.transform = "none";
        break;

      case "top":
      default:
        left = rect.left + rect.width / 2;
        top = rect.top - tooltipRect.height - 8;
        tooltipContainer.style.transform = "translateX(-50%)";
        break;
    }

    // 뷰포트 경계 체크 및 조정
    if (position === "top" || position === "bottom") {
      if (left - tooltipRect.width / 2 < 10) {
        left = tooltipRect.width / 2 + 10;
      } else if (left + tooltipRect.width / 2 > viewport.width - 10) {
        left = viewport.width - tooltipRect.width / 2 - 10;
      }

      if (position === "top" && top < 10) {
        top = rect.bottom + 8;
      } else if (
        position === "bottom" &&
        top + tooltipRect.height > viewport.height - 10
      ) {
        top = rect.top - tooltipRect.height - 8;
      }
    }

    tooltipContainer.style.left = left + "px";
    tooltipContainer.style.top = top + "px";
  }

  /**
   * 조건부 툴팁 등록
   */
  function registerConditionalTooltip(
    selector,
    conditionFn,
    messageFn,
    position = "top"
  ) {
    conditionalTooltips.set(selector, {
      condition: conditionFn,
      message: messageFn,
      position: position,
    });
  }

  /**
   * 조건부 툴팁 제거
   */
  function unregisterConditionalTooltip(selector) {
    conditionalTooltips.delete(selector);
  }

  /**
   * 모든 조건부 툴팁 클리어
   */
  function clearConditionalTooltips() {
    conditionalTooltips.clear();
  }

  /**
   * 이벤트 리스너 설정
   */
  function setupEventListeners() {
    // 마우스 이벤트 (데스크톱)
    document.addEventListener("mouseover", handleMouseOver);
    document.addEventListener("mouseout", handleMouseOut);

    // 터치 이벤트 (모바일)
    document.addEventListener("touchstart", handleTouchStart);
    document.addEventListener("touchend", handleTouchEnd);
  }

  /**
   * 마우스 오버 이벤트 핸들러
   */
  function handleMouseOver(e) {
    // 조건부 툴팁 체크
    for (const [selector, config] of conditionalTooltips) {
      const element = e.target.closest(selector);
      if (element && config.condition(element)) {
        const message = config.message(element);
        if (message) {
          show(element, message, config.position);
          break;
        }
      }
    }
  }

  /**
   * 마우스 아웃 이벤트 핸들러
   */
  function handleMouseOut(e) {
    // 툴팁이 표시된 요소에서 벗어났는지 체크
    if (currentTooltip && !currentTooltip.contains(e.relatedTarget)) {
      hide(100); // 100ms 지연 후 숨기기
    }
  }

  /**
   * 터치 시작 이벤트 핸들러 (모바일)
   */
  function handleTouchStart(e) {
    // 조건부 툴팁 체크
    for (const [selector, config] of conditionalTooltips) {
      const element = e.target.closest(selector);
      if (element && config.condition(element)) {
        const message = config.message(element);
        if (message) {
          show(element, message, config.position);
          break;
        }
      }
    }
  }

  /**
   * 터치 종료 이벤트 핸들러 (모바일)
   */
  function handleTouchEnd(e) {
    // 3초 후 자동으로 툴팁 숨기기
    hide(3000);
  }

  /**
   * 직접 툴팁 표시 (기존 호환성)
   */
  function showTooltip(element, message) {
    show(element, message, "top");
  }

  /**
   * 직접 툴팁 숨기기 (기존 호환성)
   */
  function hideTooltip() {
    hide();
  }

  // 공개 API
  return {
    init,
    show,
    hide,
    showTooltip, // 기존 호환성
    hideTooltip, // 기존 호환성
    registerConditionalTooltip,
    unregisterConditionalTooltip,
    clearConditionalTooltips,

    // 디버깅용
    getRegisteredTooltips: () => Array.from(conditionalTooltips.keys()),
  };
})();

// 드롭다운 메뉴 설정 (범용)
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
        if (window.state && window.state.selectedAuctionTypes !== undefined) {
          if (type === "all") {
            window.state.selectedAuctionTypes = [];
          } else {
            window.state.selectedAuctionTypes = [type];
          }
        }
      } else if (this.dataset.favorite) {
        const favoriteNum = parseInt(this.dataset.favorite);
        if (
          window.state &&
          window.state.selectedFavoriteNumbers !== undefined
        ) {
          window.state.selectedFavoriteNumbers = [favoriteNum];
        }
      }

      // 데이터 새로고침
      if (typeof updateFilterUI === "function") {
        updateFilterUI();
      }
      if (typeof fetchData === "function") {
        fetchData();
      } else if (
        window.ProductListController &&
        typeof window.ProductListController.fetchData === "function"
      ) {
        window.ProductListController.fetchData();
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

// 이벤트 충돌 방지 함수 (범용)
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

// 기본 이벤트 리스너 설정 (범용)
function setupBasicEventListeners() {
  // 인증 버튼 이벤트
  const signinBtn = document.getElementById("signinBtn");
  const signoutBtn = document.getElementById("signoutBtn");

  if (signinBtn) {
    signinBtn.addEventListener("click", () => {
      window.AuthManager.redirectToSignin();
    });
  }

  if (signoutBtn) {
    signoutBtn.addEventListener("click", () => {
      window.AuthManager.handleSignout();
    });
  }
}

// 페이지 로드 시 초기화
document.addEventListener("DOMContentLoaded", function () {
  // 기본 UI 설정
  setupMobileMenu();
  setupDropdownMenus();
  preventEventConflicts();
  setupMobileFilters();
  setupBasicEventListeners();

  // 툴팁 시스템 초기화
  if (window.TooltipManager) {
    window.TooltipManager.init();
  }

  console.log("Common.js 초기화 완료");
});
