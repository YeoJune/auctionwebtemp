// public/js/admin/common.js
// Admin 전용 공통 함수들 - 공통 common.js와 중복되지 않는 기능만 포함

// 공통 변수
const adminData = {
  user: null,
  isAdmin: false,
};

// DOM이 로드되면 실행
document.addEventListener("DOMContentLoaded", function () {
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
  document.querySelectorAll(".modal-overlay").forEach((modal) => {
    modal.classList.remove("active");
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
