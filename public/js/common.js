// public/js/common.js

// ===== 헤더 동적 생성 =====
function renderHeader(currentPage = "") {
  const headerContainer = document.getElementById("main-header");
  if (!headerContainer) return; // 플레이스홀더가 없으면 스킵

  const isMobile = window.innerWidth <= 768;

  // 헤더 엘리먼트에 클래스 추가
  headerContainer.className = isMobile
    ? "main-header mobile-header"
    : "main-header";

  // 메뉴 설정
  const menuConfig = {
    pc: [
      {
        type: "dropdown",
        id: "productListBtn",
        icon: "fas fa-list",
        text: "상품 리스트",
        page: "product",
        items: [
          { text: "전체 상품", href: "/productPage" },
          { text: "현장 경매", href: "/productPage?selectedAuctionTypes=live" },
          {
            text: "직접 경매",
            href: "/productPage?selectedAuctionTypes=direct",
          },
        ],
      },
      {
        type: "dropdown",
        id: "favoritesBtn",
        icon: "fas fa-star",
        text: "즐겨찾기",
        page: "favorites",
        items: [
          {
            text: "즐겨찾기 ①",
            href: "/productPage?selectedFavoriteNumbers=1&excludeExpired=false",
          },
          {
            text: "즐겨찾기 ②",
            href: "/productPage?selectedFavoriteNumbers=2&excludeExpired=false",
          },
          {
            text: "즐겨찾기 ③",
            href: "/productPage?selectedFavoriteNumbers=3&excludeExpired=false",
          },
        ],
      },
      {
        type: "button",
        id: "recommendBtn",
        icon: "fas fa-crown",
        text: "추천 상품",
        page: "recommend",
        href: "/recommendPage",
      },
      {
        type: "button",
        id: "bidResultsBtn",
        icon: "fas fa-gavel",
        text: "입찰 결과",
        page: "bid-results",
        href: "/bidResultsPage",
      },
      {
        type: "button",
        id: "myPageBtn",
        icon: "fas fa-user",
        text: "마이페이지",
        page: "mypage",
        href: "/myPage",
      },
      {
        type: "button",
        icon: "fas fa-chart-line",
        text: "낙찰 시세표",
        page: "values",
        href: "/valuesPage",
      },
      {
        type: "button",
        icon: "fas fa-user-plus",
        text: "회원가입",
        page: "inquiry",
        href: "/inquiryPage",
      },
      {
        type: "button",
        icon: "fas fa-book",
        text: "이용가이드",
        page: "guide",
        href: "/guidePage",
      },
    ],
    mobileTop: [
      {
        type: "button",
        id: "mobileFilterBtn",
        icon: "fas fa-search",
        text: "필터",
        class: "mobile-filter-toggle",
        pages: ["product", "values", "recommend"], // product, values, recommend 페이지에서만 표시
      },
      {
        type: "button",
        id: "myPageBtn",
        icon: "fas fa-user",
        text: "MY",
        page: "mypage",
        href: "/myPage",
      },
    ],
    mobileBottom: [
      {
        type: "button",
        icon: "fas fa-list",
        text: "상품",
        page: "product",
        href: "/productPage",
      },
      {
        type: "button",
        icon: "fas fa-crown",
        text: "추천상품",
        page: "recommend",
        href: "/recommendPage",
      },
      {
        type: "button",
        icon: "fas fa-star",
        text: "즐겨찾기",
        page: "favorites",
        href: "/productPage?selectedFavoriteNumbers=1,2,3&excludeExpired=false",
      },
      {
        type: "button",
        icon: "fas fa-chart-line",
        text: "시세표",
        page: "values",
        href: "/valuesPage",
      },
      {
        type: "button",
        icon: "fas fa-user-plus",
        text: "회원가입",
        page: "inquiry",
        href: "/inquiryPage",
      },
      {
        type: "button",
        icon: "fas fa-book",
        text: "가이드",
        page: "guide",
        href: "/guidePage",
      },
    ],
  };

  // PC 헤더 생성
  if (!isMobile) {
    const navItems = menuConfig.pc
      .map((item) => {
        const isActive = item.page === currentPage ? "active" : "";

        if (item.type === "dropdown") {
          const dropdownItems = item.items
            .map((subItem) => `<a href="${subItem.href}">${subItem.text}</a>`)
            .join("");

          return `
            <div class="nav-item dropdown-container">
              <button class="nav-button ${isActive}" id="${item.id}">
                <i class="${item.icon}"></i>
                <span>${item.text}</span>
              </button>
              <div class="dropdown-content">
                ${dropdownItems}
              </div>
            </div>
          `;
        } else {
          const onclick = item.href
            ? item.target === "_blank"
              ? `onclick="window.open('${item.href}', '_blank')"`
              : `onclick="window.location.href = '${item.href}'"`
            : "";

          return `
            <button class="nav-button ${isActive}" ${
              item.id ? `id="${item.id}"` : ""
            } ${onclick}>
              <i class="${item.icon}"></i>
              <span>${item.text}</span>
            </button>
          `;
        }
      })
      .join("");

    headerContainer.innerHTML = `
      <div class="header-content">
        <div class="logo-container">
          <img src="images/logo.png" alt="Logo" onclick="location.href = '/productPage'" />
        </div>
        <div class="nav-container">
          ${navItems}
        </div>
        <div class="auth-container auth-unauthenticated">
          <button id="signinBtn" class="auth-button auth-signin">로그인</button>
          <button id="signoutBtn" class="auth-button auth-signout">로그아웃</button>
        </div>
      </div>
      <a href="http://pf.kakao.com/_xcCxoqn/chat" target="_blank" class="fab-button" title="실시간 문의">
        <i class="fas fa-comments"></i>
        <span>실시간 문의</span>
      </a>
    `;
  } else {
    // 모바일 헤더 생성
    const topNavItems = menuConfig.mobileTop
      .filter((item) => {
        // pages 속성이 있으면 현재 페이지가 포함되어 있는지 확인
        if (item.pages && Array.isArray(item.pages)) {
          return item.pages.includes(currentPage);
        }
        // pages 속성이 없으면 모든 페이지에서 표시
        return true;
      })
      .map((item) => {
        const onclick = item.href
          ? `onclick="window.location.href = '${item.href}'"`
          : "";
        const content =
          item.id === "signinBtn" ? item.text : `<i class="${item.icon}"></i>`;
        return `
          <button class="mobile-nav-button ${item.class || ""}" ${
            item.id ? `id="${item.id}"` : ""
          } ${onclick}>
            ${content}
          </button>
        `;
      })
      .join("");

    const bottomNavItems = menuConfig.mobileBottom
      .map((item) => {
        const isActive = item.page === currentPage ? "active" : "";
        const onclick = item.href
          ? item.target === "_blank"
            ? `onclick="window.open('${item.href}', '_blank')"`
            : `onclick="window.location.href = '${item.href}'"`
          : "";

        return `
          <button class="mobile-bottom-button ${isActive}" ${onclick}>
            <i class="${item.icon}"></i>
            <span>${item.text}</span>
          </button>
        `;
      })
      .join("");

    headerContainer.innerHTML = `
      <div class="header-top">
        <div class="logo-container">
          <img src="images/logo.png" alt="Logo" onclick="location.href = '/productPage'" />
        </div>
        <div class="mobile-top-nav">
          <div class="auth-container auth-unauthenticated">
            <button id="signinBtn" class="mobile-nav-button auth-button-mobile auth-signin">로그인</button>
            <button id="signoutBtn" class="mobile-nav-button auth-button-mobile auth-signout">로그아웃</button>
          </div>
          ${topNavItems}
        </div>
      </div>
      <div class="header-bottom">
        ${bottomNavItems}
      </div>
      <a href="http://pf.kakao.com/_xcCxoqn/chat" target="_blank" class="fab-button" title="실시간 문의">
        <i class="fas fa-comments"></i>
        <span>실시간 문의</span>
      </a>
    `;
  }
}

// 날짜 포맷팅
function formatDate(dateString, isUTC2KST = false) {
  if (!dateString) return "-";

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "-";

  if (isUTC2KST) {
    // 로컬 시간대 기준
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  } else {
    // UTC 기준으로 날짜 추출 (시간대 영향 없음)
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}

// 날짜 + 시간 포맷팅 함수
function formatDateTime(dateString, isUTC2KST = false) {
  if (!dateString) return "-";
  const date = new Date(dateString);

  let targetDate = date;
  if (isUTC2KST) {
    targetDate = new Date(
      date.toLocaleString("en-US", { timeZone: "Asia/Seoul" }),
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
  return parseInt(num || 0).toLocaleString();
}

// 통화 포맷팅
function formatCurrency(amount, currency = "JPY") {
  if (!amount && amount !== 0) return "-";

  if (currency === "JPY") {
    return `¥${formatNumber(amount)}`;
  } else if (currency === "KRW") {
    return `₩${formatNumber(amount)}`;
  } else {
    return formatNumber(amount);
  }
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
function createPagination(
  currentPage,
  totalPages,
  onPageChange,
  containerId = "pagination",
) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error("Pagination container not found:", containerId);
    return;
  }

  container.innerHTML = "";
  if (totalPages <= 1) return;

  // -10 버튼 (10페이지 이상일 때만 표시)
  if (totalPages >= 10) {
    const prev10Button = createElement("button", "page-jump", "-10");
    prev10Button.disabled = currentPage <= 10;
    prev10Button.title = "10페이지 이전으로";
    prev10Button.addEventListener("click", () => {
      const targetPage = Math.max(1, currentPage - 10);
      onPageChange(targetPage);
    });
    container.appendChild(prev10Button);
  }

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
        pageNum === currentPage ? "active" : "",
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

  // +10 버튼 (10페이지 이상일 때만 표시)
  if (totalPages >= 10) {
    const next10Button = createElement("button", "page-jump", "+10");
    next10Button.disabled = currentPage > totalPages - 10;
    next10Button.title = "10페이지 다음으로";
    next10Button.addEventListener("click", () => {
      const targetPage = Math.min(totalPages, currentPage + 10);
      onPageChange(targetPage);
    });
    container.appendChild(next10Button);
  }
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

  const closeBtn = modal.querySelector(".close, .close-modal");

  const closeModalHandler = (event) => {
    if (event) event.stopPropagation();

    modal.classList.remove("modal-show");
    modal.classList.add("modal-hide");

    // ModalHistoryManager를 통해 닫기 (URL 업데이트 포함)
    if (window.ModalHistoryManager) {
      window.ModalHistoryManager.closeModal();
    }
  };

  if (closeBtn) {
    closeBtn.onclick = closeModalHandler;
  }

  window.onclick = (event) => {
    if (event.target === modal) {
      closeModalHandler();
    }
  };

  // ESC 키로 모달 닫기
  const escapeHandler = (event) => {
    if (event.key === "Escape" && modal.classList.contains("modal-show")) {
      closeModalHandler();
    }
  };

  document.addEventListener("keydown", escapeHandler);

  return {
    show: () => {
      modal.classList.remove("modal-hide");
      modal.classList.add("modal-show");
    },
    hide: () => {
      closeModalHandler();
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
            "/admin/check-status",
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
    // 모든 auth-container 찾기 (PC와 모바일)
    const authContainers = document.querySelectorAll(".auth-container");
    const signinBtns = document.querySelectorAll("#signinBtn");
    const signoutBtns = document.querySelectorAll("#signoutBtn");

    // 인증 상태에 따라 표시할 요소들 찾기
    const authUnauthenticatedElements = document.querySelectorAll(
      ".auth-unauthenticated:not(.auth-container)",
    );
    const authAuthenticatedElements = document.querySelectorAll(
      ".auth-authenticated:not(.auth-container)",
    );

    if (signinBtns.length === 0 || signoutBtns.length === 0) return;

    if (isAuthenticated) {
      authContainers.forEach((container) => {
        container.classList.remove("auth-unauthenticated");
        container.classList.add("auth-authenticated");
      });
      // 비로그인 전용 요소 숨기기
      authUnauthenticatedElements.forEach((el) => {
        el.style.display = "none";
      });
      // 로그인 전용 요소 표시
      authAuthenticatedElements.forEach((el) => {
        el.style.display = "";
      });
      signinBtns.forEach((btn) => (btn.style.display = "none"));
      signoutBtns.forEach((btn) => (btn.style.display = "inline-flex"));
    } else {
      authContainers.forEach((container) => {
        container.classList.remove("auth-authenticated");
        container.classList.add("auth-unauthenticated");
      });
      // 비로그인 전용 요소 표시
      authUnauthenticatedElements.forEach((el) => {
        el.style.display = "";
      });
      // 로그인 전용 요소 숨기기
      authAuthenticatedElements.forEach((el) => {
        el.style.display = "none";
      });
      signinBtns.forEach((btn) => (btn.style.display = "inline-flex"));
      signoutBtns.forEach((btn) => (btn.style.display = "none"));
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

  /**
   * 인증되지 않은 경우 로그인 페이지로 리다이렉트
   */
  function redirectIfNotAuthenticated() {
    if (!isAuthenticated) {
      redirectToSignin();
      return false;
    }
    return true;
  }

  // 공개 API
  return {
    checkAuthStatus,
    updateAuthUI,
    handleSignout,
    requireAuth,
    requireAdmin,
    redirectToSignin,
    redirectIfNotAuthenticated,

    // getter 함수들
    isAuthenticated: () => isAuthenticated,
    getUser: () => user,
    isAdmin: () => isAdmin,
  };
})();

// 로그인 필수 모달 관리자
window.LoginRequiredModal = (function () {
  let modalManager;
  let isInitialized = false;

  function initialize() {
    if (isInitialized) return;

    // 기존 setupModal 시스템 사용
    modalManager = setupModal("loginRequiredModal");
    if (!modalManager) return;

    setupEventListeners();
    isInitialized = true;
  }

  function setupEventListeners() {
    // 모달 버튼 이벤트 설정
    const loginBtn = document.getElementById("loginModalBtn");
    const closeBtn = document.getElementById("closeModalBtn");

    if (loginBtn) {
      loginBtn.addEventListener("click", () => {
        window.location.href = "/signinPage";
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener("click", hide);
    }
  }

  function show() {
    if (modalManager) {
      modalManager.show();
    }
  }

  function hide() {
    if (modalManager) {
      modalManager.hide();
    }
  }

  function checkLoginRequired() {
    if (!window.AuthManager.isAuthenticated()) {
      show();
      return false;
    }
    return true;
  }

  return {
    initialize,
    show,
    hide,
    checkLoginRequired,
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
    console.log("Mobile filter elements not found");
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

  // 표준 구조: header + content 분리
  let filtersHeader = filtersContainer.querySelector(".filters-header");
  let filtersContent = filtersContainer.querySelector(".filters-content");

  // 기존 필터 요소들 저장
  const existingElements = Array.from(filtersContainer.children).filter(
    (child) =>
      !child.classList.contains("filters-header") &&
      !child.classList.contains("filters-content"),
  );

  if (!filtersHeader) {
    filtersHeader = document.createElement("div");
    filtersHeader.className = "filters-header";
    filtersHeader.innerHTML = `
      <span>필터</span>
      <button class="filter-close-btn" aria-label="필터 닫기">&times;</button>
    `;
    filtersContainer.prepend(filtersHeader);
  }

  if (!filtersContent) {
    filtersContent = document.createElement("div");
    filtersContent.className = "filters-content";
    filtersContainer.appendChild(filtersContent);

    // 기존 요소들을 content로 이동
    existingElements.forEach((el) => filtersContent.appendChild(el));
  }

  // 닫기 버튼 이벤트
  const closeBtn = filtersHeader.querySelector(".filter-close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      window.mobileFilterFunctions.closeFilter();
    });
  }

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
    position = "top",
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

// TooltipManager 확장 기능
window.TooltipManager.addIcon = function (element, tooltipType) {
  // 이미 같은 타입의 툴팁 아이콘이 있는지 확인
  const existingIcon = element.querySelector(
    `.tooltip-icon[data-tooltip="${tooltipType}"]`,
  );
  if (existingIcon) return;

  // 다른 타입의 툴팁 아이콘이라도 하나 있으면 추가하지 않음
  const anyIcon = element.querySelector(".tooltip-icon");
  if (anyIcon) return;

  const icon = document.createElement("i");
  icon.className = "fas fa-question-circle tooltip-icon";
  icon.dataset.tooltip = tooltipType;
  icon.style.cssText = `
    margin-left: 4px;
    color: #999;
    cursor: pointer;
    font-size: 12px;
  `;

  element.appendChild(icon);
};

window.TooltipManager.processTooltips = function (
  container,
  item,
  tooltipConfigs,
  bidInfo = null,
) {
  if (!tooltipConfigs || !Array.isArray(tooltipConfigs)) return;

  // 먼저 기존의 동적으로 추가된 툴팁 아이콘들을 정리
  window.TooltipManager.clearDynamicTooltips(container);

  tooltipConfigs.forEach((config, index) => {
    // 1. condition 체크 - false면 이 config는 스킵
    const conditionResult = config.condition
      ? config.condition(item, bidInfo)
      : true;
    if (!conditionResult) {
      return;
    }

    // 2. 해당 selector에 맞는 요소들 찾기
    const elements = container.querySelectorAll(config.selector);

    elements.forEach((element, elemIndex) => {
      // 3. textCondition 체크 - 있다면 텍스트가 일치해야 함
      if (
        config.textCondition &&
        !element.textContent.includes(config.textCondition)
      ) {
        return;
      }

      // 4. 이미 툴팁 아이콘이 있다면 추가하지 않음
      if (element.querySelector(".tooltip-icon")) {
        return;
      }

      // 5. 모든 조건을 만족하면 툴팁 아이콘 추가
      window.TooltipManager.addIcon(element, config.type);

      // 6. 추가된 아이콘에 대한 메시지 등록 (config에 message가 있는 경우)
      if (config.message) {
        const addedIcon = element.querySelector(
          `.tooltip-icon[data-tooltip="${config.type}"]`,
        );
        if (addedIcon) {
          window.TooltipManager.registerConditionalTooltip(
            `.tooltip-icon[data-tooltip="${config.type}"]`,
            () => true,
            typeof config.message === "function"
              ? config.message
              : () => config.message,
            "top",
          );
        }
      }
    });
  });
};

// 동적으로 추가된 툴팁 아이콘들을 정리하는 함수
window.TooltipManager.clearDynamicTooltips = function (container) {
  if (!container) return;

  const dynamicIcons = container.querySelectorAll(
    ".tooltip-icon[data-tooltip]",
  );
  dynamicIcons.forEach((icon) => {
    // data-tooltip 속성이 있는 것들만 제거 (동적으로 추가된 것들)
    if (icon.dataset.tooltip) {
      icon.remove();
    }
  });
};

// 드롭다운 메뉴 설정 (범용) - 함수는 유지하되 내용 수정
function setupDropdownMenus() {
  const dropdownButtons = document.querySelectorAll(
    ".nav-item.dropdown-container > .nav-button",
  );

  const closeAllDropdowns = (exceptDropdown = null) => {
    document.querySelectorAll(".dropdown-content").forEach((dropdown) => {
      if (dropdown !== exceptDropdown) {
        dropdown.classList.remove("active");
      }
    });
  };

  const isMobile = () => window.innerWidth <= 768;

  // 드롭다운 버튼 이벤트 설정 (UI 토글만 유지)
  dropdownButtons.forEach((button) => {
    const newButton = button.cloneNode(true);
    button.parentNode.replaceChild(newButton, button);

    newButton.addEventListener("click", function (e) {
      if (e.target.closest(".mobile-menu-toggle")) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const dropdown = this.parentNode.querySelector(".dropdown-content");
      if (!dropdown) return;

      const isActive = dropdown.classList.contains("active");
      closeAllDropdowns(isActive ? null : dropdown);
      dropdown.classList.toggle("active");
      this.classList.toggle("active", dropdown.classList.contains("active"));
    });
  });

  // 외부 클릭 시 드롭다운 닫기는 유지
  document.addEventListener("click", function (e) {
    if (e.target.closest(".mobile-menu-toggle")) {
      return;
    }

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
          document
            .querySelector(".nav-container")
            .classList.contains("mobile-menu-active")
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

  // 모달 기본 이벤트 (이미지 네비게이션)
  const prevBtn = document.querySelector(".image-nav.prev");
  const nextBtn = document.querySelector(".image-nav.next");

  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      const currentIndex = window.ModalImageGallery.getCurrentIndex();
      window.ModalImageGallery.changeImage(currentIndex - 1);
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      const currentIndex = window.ModalImageGallery.getCurrentIndex();
      window.ModalImageGallery.changeImage(currentIndex + 1);
    });
  }
}

// URL 상태 관리자 (개선된 버전)
window.URLStateManager = (function () {
  // URL에 포함할 상태 키들 (화이트리스트 방식)
  const URL_ALLOWED_KEYS = [
    "bidType",
    "status",
    "dateRange",
    "currentPage",
    "sortBy",
    "sortOrder",
    "keyword",
    "item_id", // 상세 모달용
    // Admin pages용 키들 추가
    "page",
    "sort",
    "order",
    "search",
    "aucNum",
    // ProductListController용 키들 추가
    "selectedBrands",
    "selectedCategories",
    "selectedRanks",
    "selectedAucNums",
    "itemsPerPage",
    "searchTerm",
    "selectedAuctionTypes",
    "selectedFavoriteNumbers",
    "selectedDates",
    "showBidItemsOnly",
    "excludeExpired",
  ];

  // 기본값들 (기본값과 같으면 URL에서 제외)
  const DEFAULT_VALUES = {
    bidType: "all",
    status: "all",
    dateRange: 30,
    currentPage: 1,
    sortBy: "updated_at",
    sortOrder: "desc",
    keyword: "",
    // Admin pages용 기본값들 추가
    page: 1,
    sort: "original_scheduled_date",
    order: "desc",
    search: "",
    aucNum: "",
    // ProductListController용 기본값들 추가
    selectedBrands: [],
    selectedCategories: [],
    selectedRanks: [],
    selectedAucNums: [],
    itemsPerPage: 20,
    searchTerm: "",
    selectedAuctionTypes: [],
    selectedFavoriteNumbers: [],
    selectedDates: [],
    showBidItemsOnly: false,
    excludeExpired: true,
  };

  /**
   * URL 파라미터에서 상태 로드
   * @param {Object} defaultState - 기본 상태 객체
   * @param {Array} stateKeys - 로드할 상태 키 배열
   * @returns {Object} 업데이트된 상태 객체
   */
  function loadFromURL(defaultState, stateKeys) {
    const urlParams = new URLSearchParams(window.location.search);
    const updatedState = { ...defaultState };

    // URL에 허용된 키들만 처리
    const allowedKeys = stateKeys.filter((key) =>
      URL_ALLOWED_KEYS.includes(key),
    );

    allowedKeys.forEach((key) => {
      if (urlParams.has(key)) {
        const value = urlParams.get(key);

        // 타입에 따른 변환
        if (
          key.includes("Page") ||
          key.includes("Range") ||
          key.includes("Limit") ||
          key.includes("itemsPerPage") ||
          key === "page"
        ) {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue > 0) {
            updatedState[key] = numValue;
          }
        } else if (
          key.includes("Array") ||
          key.includes("Selected") ||
          key === "selectedBrands" ||
          key === "selectedCategories" ||
          key === "selectedRanks" ||
          key === "selectedAucNums" ||
          key === "selectedAuctionTypes" ||
          key === "selectedFavoriteNumbers" ||
          key === "selectedDates"
        ) {
          // 배열 타입 처리
          if (value && value.trim() !== "") {
            let arrayValue = value.split(",").filter((v) => v.trim());
            // 숫자 배열인 경우 변환
            if (
              key === "selectedAucNums" ||
              key === "selectedFavoriteNumbers"
            ) {
              arrayValue = arrayValue.map((v) => v).filter((v) => !isNaN(v));
            }
            updatedState[key] = arrayValue;
          } else {
            updatedState[key] = defaultState[key] || [];
          }
        } else if (key === "showBidItemsOnly" || key === "excludeExpired") {
          // 불린 타입 처리
          updatedState[key] = value === "true";
        } else if (value && value.trim() !== "") {
          updatedState[key] = value.trim();
        }
      }
    });

    return updatedState;
  }

  /**
   * 상태를 URL에 업데이트 (필터링된 상태만)
   * @param {Object} state - 현재 상태
   * @param {Object} defaultState - 기본 상태 (기본값과 다른 것만 URL에 포함)
   */
  function updateURL(state, defaultState = DEFAULT_VALUES) {
    const params = new URLSearchParams();

    // URL에 허용된 키들만 처리
    URL_ALLOWED_KEYS.forEach((key) => {
      const value = state[key];
      const defaultValue = defaultState[key];

      // 값이 존재하고, 기본값과 다르며, 유효한 값인 경우만 URL에 포함
      if (shouldIncludeInURL(key, value, defaultValue)) {
        if (Array.isArray(value)) {
          if (value.length > 0) {
            params.set(key, value.join(","));
          }
        } else {
          params.set(key, value.toString());
        }
      }
    });

    // URL 업데이트
    const url = `${window.location.pathname}${
      params.toString() ? `?${params.toString()}` : ""
    }`;

    // 현재 URL과 다른 경우에만 업데이트
    if (window.location.href !== url) {
      window.history.replaceState({}, "", url);
    }
  }

  /**
   * URL에 포함할지 여부 결정
   * @param {string} key - 상태 키
   * @param {any} value - 현재 값
   * @param {any} defaultValue - 기본값
   * @returns {boolean} 포함 여부
   */
  function shouldIncludeInURL(key, value, defaultValue) {
    // 값이 없거나 undefined인 경우
    if (value === null || value === undefined) {
      return false;
    }

    // 빈 문자열인 경우
    if (typeof value === "string" && value.trim() === "") {
      return false;
    }

    // 빈 배열인 경우
    if (Array.isArray(value) && value.length === 0) {
      return false;
    }

    // 기본값과 같은 경우 (item_id는 예외)
    if (key !== "item_id" && value === defaultValue) {
      return false;
    }

    // 현재 페이지가 1인 경우 (기본값이므로 제외)
    if ((key === "currentPage" || key === "page") && value === 1) {
      return false;
    }

    return true;
  }

  /**
   * 특정 파라미터만 제거
   * @param {string|Array} keys - 제거할 키(들)
   */
  function removeParams(keys) {
    const params = new URLSearchParams(window.location.search);
    const keysArray = Array.isArray(keys) ? keys : [keys];

    keysArray.forEach((key) => {
      if (params.has(key)) {
        params.delete(key);
      }
    });

    const url = `${window.location.pathname}${
      params.toString() ? `?${params.toString()}` : ""
    }`;
    window.history.replaceState({}, "", url);
  }

  /**
   * URL 파라미터 헬퍼
   * @returns {URLSearchParams} URL 파라미터 객체
   */
  function getURLParams() {
    return new URLSearchParams(window.location.search);
  }

  /**
   * 깨끗한 URL 생성 (공유용)
   * @param {Object} state - 상태 객체
   * @returns {string} 깨끗한 URL
   */
  function getCleanURL(state) {
    const params = new URLSearchParams();

    // 중요한 필터링 상태만 포함
    const importantKeys = ["bidType", "status", "dateRange", "keyword"];

    importantKeys.forEach((key) => {
      const value = state[key];
      const defaultValue = DEFAULT_VALUES[key];

      if (shouldIncludeInURL(key, value, defaultValue)) {
        params.set(key, value.toString());
      }
    });

    return `${window.location.origin}${window.location.pathname}${
      params.toString() ? `?${params.toString()}` : ""
    }`;
  }

  // 공개 API
  return {
    loadFromURL,
    updateURL,
    removeParams,
    getURLParams,
    getCleanURL,

    // 디버깅용
    getAllowedKeys: () => [...URL_ALLOWED_KEYS],
    getDefaultValues: () => ({ ...DEFAULT_VALUES }),
  };
})();

// 모달 이미지 갤러리 관리자
window.ModalImageGallery = (function () {
  let state = {
    images: [],
    currentImageIndex: 0,
  };

  /**
   * 이미지 갤러리 초기화
   * @param {Array} imageUrls - 이미지 URL 배열
   */
  function initialize(imageUrls) {
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

      thumbnail.addEventListener("click", () => changeImage(index));
      thumbnailWrapper.appendChild(thumbnail);
      thumbnailContainer.appendChild(thumbnailWrapper);
    });

    // 네비게이션 버튼 상태 업데이트
    updateNavigation();
  }

  /**
   * 메인 이미지 변경
   * @param {number} index - 이미지 인덱스
   */
  function changeImage(index) {
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

    updateNavigation();
  }

  /**
   * 이미지 네비게이션 버튼 상태 업데이트
   */
  function updateNavigation() {
    const prevBtn = document.querySelector(".image-nav.prev");
    const nextBtn = document.querySelector(".image-nav.next");

    if (!prevBtn || !nextBtn) return;

    prevBtn.disabled = state.currentImageIndex === 0;
    nextBtn.disabled = state.currentImageIndex === state.images.length - 1;
  }

  /**
   * 모달 로딩 표시
   */
  function showLoading() {
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
  function hideLoading() {
    document.getElementById("modal-loading")?.remove();
  }

  // 공개 API
  return {
    initialize,
    changeImage,
    updateNavigation,
    showLoading,
    hideLoading,

    // getter 함수들
    getCurrentIndex: () => state.currentImageIndex,
    getImages: () => state.images,
  };
})();

// 모달 히스토리 매니저 (URL 연동)
window.ModalHistoryManager = (function () {
  let isModalOpen = false;
  let currentModalId = null;
  let currentItemId = null;
  let isProcessingPopState = false;

  /**
   * 모달 열기 (URL 업데이트 포함)
   */
  function openModal(modalId, itemId) {
    if (isModalOpen && currentItemId === itemId) {
      return; // 이미 같은 아이템으로 모달이 열려있으면 중복 처리 방지
    }

    const previousItemId = currentItemId;
    isModalOpen = true;
    currentModalId = modalId;
    currentItemId = itemId;

    // URL 업데이트
    const url = new URL(window.location);
    url.searchParams.set("detail", itemId);

    // 모달이 이미 열려있었으면 replaceState, 아니면 pushState
    if (previousItemId) {
      history.replaceState({ modalOpen: true, itemId: itemId }, "", url);
    } else {
      history.pushState({ modalOpen: true, itemId: itemId }, "", url);
    }
  }

  /**
   * 모달 닫기 (URL 업데이트 포함)
   */
  function closeModal(skipHistoryUpdate = false) {
    if (!isModalOpen) return;

    isModalOpen = false;
    const previousModalId = currentModalId;
    const previousItemId = currentItemId;
    currentModalId = null;
    currentItemId = null;

    // 모달 DOM 닫기
    const modal = document.getElementById(previousModalId || "detailModal");
    if (modal) {
      modal.classList.remove("modal-show");
      modal.classList.add("modal-hide");
    }

    // URL 업데이트 (popstate 이벤트 중에는 스킵)
    if (!skipHistoryUpdate && !isProcessingPopState) {
      const url = new URL(window.location);
      if (url.searchParams.has("detail")) {
        url.searchParams.delete("detail");
        history.replaceState({}, "", url);
      }
    }
  }

  /**
   * popstate 이벤트 핸들러
   */
  function handlePopState(event) {
    isProcessingPopState = true;

    const url = new URL(window.location);
    const detailId = url.searchParams.get("detail");

    if (detailId && detailId !== currentItemId) {
      // URL에 detail 파라미터가 있으면 모달 열기
      if (
        window.ProductListController &&
        window.ProductListController.showDetails
      ) {
        window.ProductListController.showDetails(detailId);
      }
    } else if (!detailId && isModalOpen) {
      // URL에 detail 파라미터가 없으면 모달 닫기
      closeModal(true);
    }

    setTimeout(() => {
      isProcessingPopState = false;
    }, 100);
  }

  /**
   * 초기화 (페이지 로드 시 URL 확인)
   */
  function initialize() {
    // popstate 이벤트 리스너 등록
    window.addEventListener("popstate", handlePopState);

    // 페이지 로드 시 URL 확인
    const url = new URL(window.location);
    const detailId = url.searchParams.get("detail");

    if (detailId) {
      // URL에 detail 파라미터가 있으면 모달 열기
      setTimeout(() => {
        if (
          window.ProductListController &&
          window.ProductListController.showDetails
        ) {
          window.ProductListController.showDetails(detailId);
        }
      }, 500); // 페이지 초기화를 위한 약간의 딜레이
    }
  }

  /**
   * 현재 상태 반환
   */
  function getState() {
    return {
      isModalOpen,
      currentModalId,
      currentItemId,
    };
  }

  return {
    openModal,
    closeModal,
    initialize,
    getState,
  };
})();

// 페이지 로드 시 초기화
document.addEventListener("DOMContentLoaded", function () {
  // 헤더 렌더링 (페이지 정보는 main-header의 data-page 속성에서 가져옴)
  const headerContainer = document.getElementById("main-header");
  const currentPage = headerContainer
    ? headerContainer.getAttribute("data-page") || ""
    : "";
  renderHeader(currentPage);

  // 기본 UI 설정
  setupMobileMenu();
  setupDropdownMenus();
  preventEventConflicts();
  setupMobileFilters();
  setupBasicEventListeners();
  window.AuthManager.checkAuthStatus();

  // 툴팁 시스템 초기화
  if (window.TooltipManager) {
    window.TooltipManager.init();
  }

  // 모달 히스토리 매니저 초기화
  if (window.ModalHistoryManager) {
    window.ModalHistoryManager.initialize();
  }

  console.log("Common.js 초기화 완료");
});
