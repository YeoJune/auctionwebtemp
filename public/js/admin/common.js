// public/js/admin/common.js
// Admin 전용 공통 함수들 - 공통 common.js와 중복되지 않는 기능만 포함

// 공통 변수
const adminData = {
  user: null,
  isAdmin: false,
  isSuperAdmin: false,
  allowedMenus: [],
};

const ADMIN_MENU_BY_PATH = {
  "/admin": "dashboard",
  "/admin/live-bids": "live-bids",
  "/admin/direct-bids": "direct-bids",
  "/admin/all-bids": "all-bids",
  "/admin/bid-results": "bid-results",
  "/admin/transactions": "transactions",
  "/admin/invoices": "invoices",
  "/admin/users": "users",
  "/admin/recommend-filters": "recommend-filters",
  "/admin/settings": "settings",
  "/admin/wms": "wms",
  "/admin/repair-management": "repair-management",
  "/admin/activity-logs": "activity-logs",
  "/admin/admin-permissions": "__superadmin__",
};

const ADMIN_ACCESS_CACHE_KEY = "admin_access_cache_v1";

// DOM이 로드되면 실행
document.addEventListener("DOMContentLoaded", function () {
  applyCachedAdminMenuAccess();
  applyAdminMenuAccess();

  // 로그아웃 버튼 이벤트 리스너 (admin 전용)
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", logout);
  }

  // 필터 탭 이벤트 리스너 (admin 전용)
  document.querySelectorAll(".filter-tab").forEach((tab) => {
    tab.addEventListener("click", function () {
      document
        .querySelectorAll(".filter-tab")
        .forEach((t) => t.classList.remove("active"));
      this.classList.add("active");

      // 상태별 필터링 호출 (해당 페이지 스크립트에서 구현)
      if (typeof filterByStatus === "function") {
        filterByStatus(this.dataset.status);
      }
    });
  });

  // admin 페이지에서 공통 모달 설정
  setupAdminModals();
});

function readAdminAccessCache() {
  try {
    const raw = sessionStorage.getItem(ADMIN_ACCESS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function writeAdminAccessCache(access) {
  try {
    sessionStorage.setItem(ADMIN_ACCESS_CACHE_KEY, JSON.stringify(access));
  } catch (_) {
    // ignore
  }
}

function ensureAdminPermissionsMenuLink() {
  const sidebarMenu = document.querySelector(".sidebar-menu");
  if (!sidebarMenu) return;
  const exists = sidebarMenu.querySelector('a[href="/admin/admin-permissions"]');
  if (exists) return;

  const link = document.createElement("a");
  link.href = "/admin/admin-permissions";
  link.textContent = "관리자 권한 관리";
  sidebarMenu.appendChild(link);
}

function applyMenuVisibility(isSuperAdmin, allowedMenus, options = {}) {
  const isBootstrap = !!options.isBootstrap;
  if (isSuperAdmin) {
    ensureAdminPermissionsMenuLink();
  }

  document.querySelectorAll(".sidebar-menu a[href]").forEach((a) => {
    const href = a.getAttribute("href");
    const key = ADMIN_MENU_BY_PATH[href];
    if (!key) return;
    if (key === "__superadmin__") {
      // 캐시 부트스트랩 단계에서는 superadmin 메뉴를 숨기지 않음
      // (직원 계정 캐시로 인한 깜빡임 방지)
      if (isBootstrap) return;
      a.style.display = isSuperAdmin ? "" : "none";
      return;
    }
    if (isSuperAdmin) {
      a.style.display = "";
      return;
    }
    a.style.display = allowedMenus.includes(key) ? "" : "none";
  });
}

function applyCachedAdminMenuAccess() {
  const cached = readAdminAccessCache();
  if (!cached) return;
  adminData.isAdmin = !!cached.isAdmin;
  adminData.isSuperAdmin = !!cached.isSuperAdmin;
  adminData.allowedMenus = Array.isArray(cached.allowedMenus)
    ? cached.allowedMenus
    : [];
  applyMenuVisibility(adminData.isSuperAdmin, adminData.allowedMenus, {
    isBootstrap: true,
  });
}

async function fetchAdminAccessInfo() {
  if (window.API?.fetchAPI) {
    return window.API.fetchAPI("/admin/me/access");
  }
  const res = await fetch("/api/admin/me/access", {
    method: "GET",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`권한 조회 실패(${res.status})`);
  }
  return res.json();
}

async function applyAdminMenuAccess() {
  try {
    const access = await fetchAdminAccessInfo();
    adminData.isAdmin = !!access?.isAdmin;
    adminData.isSuperAdmin = !!access?.isSuperAdmin;
    adminData.allowedMenus = Array.isArray(access?.allowedMenus) ? access.allowedMenus : [];
    writeAdminAccessCache({
      isAdmin: adminData.isAdmin,
      isSuperAdmin: adminData.isSuperAdmin,
      allowedMenus: adminData.allowedMenus,
    });
    applyMenuVisibility(adminData.isSuperAdmin, adminData.allowedMenus);
  } catch (error) {
    console.error("관리자 메뉴 권한 반영 실패:", error);
    // 조회 실패 시에도 기존/캐시 상태 유지 (메뉴 깜빡임 방지)
    const cached = readAdminAccessCache();
    if (cached) {
      applyMenuVisibility(!!cached.isSuperAdmin, cached.allowedMenus || []);
    }
  }
}

// Admin 전용 로그아웃 함수
async function logout() {
  try {
    // AuthManager 사용 (공통 함수 활용)
    if (window.AuthManager) {
      await window.AuthManager.handleSignout();
    } else {
      // fallback
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/signinPage";
    }
  } catch (error) {
    console.error("로그아웃 중 오류 발생:", error);
    alert("로그아웃 중 오류가 발생했습니다.");
  }
}

// Admin 전용 모달 설정
function setupAdminModals() {
  // 모달 닫기 버튼 이벤트 리스너 (.close-modal 클래스)
  document.querySelectorAll(".close-modal").forEach((button) => {
    button.addEventListener("click", function () {
      closeAllModals();
    });
  });
}

// Admin 모달 열기 함수 (공통 함수 활용)
function openModal(modalId) {
  const modal = window.setupModal(modalId);
  if (modal) {
    modal.show();
  }
}

// Admin 모달 닫기 함수 (공통 함수 활용)
function closeModal(modalId) {
  const modal = window.setupModal(modalId);
  if (modal) {
    modal.hide();
  }
}

// Admin 전용 모든 모달 닫기 (.modal-overlay 클래스 기반)
function closeAllModals() {
  document.querySelectorAll(".modal-overlay, .modal").forEach((modal) => {
    modal.classList.remove("active", "modal-show", "show");
    modal.classList.add("modal-hide");
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
  });
  document.body.classList.remove("modal-open");
  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.remove();
  });
}

// Admin 테이블 전용 로딩 상태 표시
function showLoading(tableBodyId) {
  toggleLoading(true);

  const tableBody = document.getElementById(tableBodyId);
  if (tableBody) {
    tableBody.innerHTML = `<tr><td colspan="100%" class="text-center">데이터를 불러오는 중입니다...</td></tr>`;
  }
}

// Admin 테이블 전용 데이터 없음 표시
function showNoData(tableBodyId, message = "데이터가 없습니다.") {
  toggleLoading(false);

  const tableBody = document.getElementById(tableBodyId);
  if (tableBody) {
    tableBody.innerHTML = `<tr><td colspan="100%" class="text-center">${message}</td></tr>`;
  }
}

// Admin 전용 확인 대화상자 (기존 호환성을 위해 유지)
function confirmAction(message) {
  return confirm(message);
}

// Admin 전용 에러 처리 함수 (공통 함수와 연동)
function handleError(error, defaultMessage = "오류가 발생했습니다.") {
  console.error(error);
  alert(error.message || defaultMessage);
}

// Admin 전용 알림 표시 (기존 호환성을 위해 유지, 향후 개선 가능)
function showAlert(message, type = "error") {
  alert(message);
}
