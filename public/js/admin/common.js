// public/js/admin/common.js

// 공통 변수
const adminData = {
  user: null,
  isAdmin: false,
};

// DOM이 로드되면 실행
document.addEventListener("DOMContentLoaded", function () {
  // 로그아웃 버튼 이벤트 리스너
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", logout);
  }

  // 모달 닫기 버튼 이벤트 리스너
  document.querySelectorAll(".close-modal").forEach((button) => {
    button.addEventListener("click", function () {
      closeAllModals();
    });
  });

  // 필터 탭 이벤트 리스너
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
});

// 로그아웃 함수
async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/signinPage";
  } catch (error) {
    console.error("로그아웃 중 오류 발생:", error);
    showAlert("로그아웃 중 오류가 발생했습니다.");
  }
}

// 날짜 포맷 함수 (YYYY-MM-DD HH:MM)
function formatDate(dateString, isUTC2KST = false) {
  if (!dateString) return "-";
  const date = new Date(dateString);

  let targetDate = date;
  if (isUTC2KST) {
    targetDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  }

  return targetDate.toISOString().split("T")[0];
}

// 화폐 포맷 함수
function formatCurrency(amount) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
  }).format(amount);
}

// 모달 열기
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add("active");
  }
}

// 모달 닫기
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove("active");
  }
}

// 모든 모달 닫기
function closeAllModals() {
  document.querySelectorAll(".modal-overlay").forEach((modal) => {
    modal.classList.remove("active");
  });
}

// 알림 표시
function showAlert(message, type = "error") {
  // 간단한 알림 기능 (alert 사용)
  alert(message);

  // 필요에 따라 커스텀 알림 UI를 추가할 수 있음
}

// 확인 대화상자
function confirmAction(message) {
  return confirm(message);
}

// 오류 처리 함수
function handleError(error, defaultMessage = "오류가 발생했습니다.") {
  console.error(error);
  showAlert(error.message || defaultMessage);
}

// 로딩 상태 표시 (테이블 내용 대체)
function showLoading(tableBodyId) {
  const tableBody = document.getElementById(tableBodyId);
  if (tableBody) {
    tableBody.innerHTML = `<tr><td colspan="100%" class="text-center">데이터를 불러오는 중입니다...</td></tr>`;
  }
}

// 데이터 없음 표시 (테이블 내용 대체)
function showNoData(tableBodyId, message = "데이터가 없습니다.") {
  const tableBody = document.getElementById(tableBodyId);
  if (tableBody) {
    tableBody.innerHTML = `<tr><td colspan="100%" class="text-center">${message}</td></tr>`;
  }
}
