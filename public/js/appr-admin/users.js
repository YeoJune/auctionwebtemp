// public/js/appr-admin/users.js - 회원 관리 관련 기능

// 전역 변수
let currentUserPage = 1;
let userSearchQuery = "";
let userTierFilter = "all";

// 페이지 로드 시 이벤트 리스너 설정
document.addEventListener("DOMContentLoaded", function () {
  // 검색 버튼 이벤트
  document
    .getElementById("user-search-btn")
    .addEventListener("click", function () {
      userSearchQuery = document.getElementById("user-search").value;
      currentUserPage = 1;
      loadUserList();
    });

  // 검색창 엔터 이벤트
  document
    .getElementById("user-search")
    .addEventListener("keypress", function (e) {
      if (e.key === "Enter") {
        userSearchQuery = this.value;
        currentUserPage = 1;
        loadUserList();
      }
    });

  // 등급 필터 변경 이벤트
  document
    .getElementById("user-tier-filter")
    .addEventListener("change", function () {
      userTierFilter = this.value;
      currentUserPage = 1;
      loadUserList();
    });

  // 회원 수정 폼 제출 이벤트
  document
    .getElementById("user-edit-form")
    .addEventListener("submit", function (e) {
      e.preventDefault();
      updateUser();
    });
});

// 회원 목록 로드 함수
function loadUserList() {
  // 로딩 표시
  document.getElementById("users-list").innerHTML =
    '<tr><td colspan="7" style="text-align: center;">회원 데이터를 불러오는 중...</td></tr>';

  // API URL 생성
  let url = `/api/appr/admin/users?page=${currentUserPage}&limit=10`;

  // 필터 적용
  if (userTierFilter !== "all") {
    url += `&tier=${encodeURIComponent(userTierFilter)}`;
  }

  // 검색어 적용
  if (userSearchQuery) {
    url += `&search=${encodeURIComponent(userSearchQuery)}`;
  }

  // API 호출
  fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error("회원 목록을 불러오는데 실패했습니다.");
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        displayUserList(data.users, data.pagination);
      } else {
        throw new Error(data.message || "회원 목록을 불러오는데 실패했습니다.");
      }
    })
    .catch((error) => {
      document.getElementById(
        "users-list"
      ).innerHTML = `<tr><td colspan="7" style="text-align: center;">오류: ${error.message}</td></tr>`;
    });
}

// 회원 목록 표시 함수
function displayUserList(users, pagination) {
  const tableBody = document.getElementById("users-list");

  // 데이터가 없는 경우
  if (!users || users.length === 0) {
    tableBody.innerHTML =
      '<tr><td colspan="7" style="text-align: center;">회원이 없습니다.</td></tr>';
    document.getElementById("users-pagination").innerHTML = "";
    return;
  }

  // 테이블 내용 생성
  let html = "";
  users.forEach((user) => {
    // 회원 등급에 따른 배지 색상 설정
    let tierBadgeClass = "badge-info";
    if (user.tier === "까사트레이드 회원") {
      tierBadgeClass = "badge-success";
    } else if (user.tier === "제휴사 회원") {
      tierBadgeClass = "badge-warning";
    }

    html += `<tr>
            <td>${user.id}</td>
            <td>${user.company_name || "-"}</td>
            <td>${user.email || "-"}</td>
            <td><span class="badge ${tierBadgeClass}">${
      user.tier || "일반회원"
    }</span></td>
            <td>${user.quick_link_credits_remaining || 0} / ${
      user.quick_link_monthly_limit || 0
    }</td>
            <td>${formatDate(user.created_at) || "-"}</td>
            <td>
                <button class="btn btn-outline" onclick="editUser('${
                  user.id
                }')">정보수정</button>
            </td>
        </tr>`;
  });

  tableBody.innerHTML = html;

  // 페이지네이션 생성
  createPagination(
    "users-pagination",
    pagination.currentPage,
    pagination.totalPages,
    (page) => {
      currentUserPage = page;
      loadUserList();
    }
  );
}

// 회원 수정 모달 열기
function editUser(userId) {
  // 모달 초기화
  document.getElementById("user-edit-form").reset();
  document.getElementById("user-edit-id").value = userId;

  // 모달 표시
  openModal("user-edit-modal");

  // API 호출하여 회원 정보 가져오기
  fetch(`/api/appr/admin/users/${userId}`)
    .then((response) => {
      if (!response.ok) {
        throw new Error("회원 정보를 불러오는데 실패했습니다.");
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        populateUserEditForm(data.user);
      } else {
        throw new Error(data.message || "회원 정보를 불러오는데 실패했습니다.");
      }
    })
    .catch((error) => {
      showAlert(error.message, "error");
      closeModal("user-edit-modal");
    });
}

// 회원 수정 폼에 데이터 채우기
function populateUserEditForm(user) {
  // 폼 필드 채우기
  document.getElementById("user-edit-tier").value = user.tier || "일반회원";
  document.getElementById("user-edit-credits").value =
    user.quick_link_credits_remaining || 0;
  document.getElementById("user-edit-monthly-limit").value =
    user.quick_link_monthly_limit || 0;
  document.getElementById("user-edit-subscription-type").value =
    user.quick_link_subscription_type || "free";

  // 오프라인 감정 수수료 추가
  if (document.getElementById("user-edit-offline-fee")) {
    document.getElementById("user-edit-offline-fee").value =
      user.offline_appraisal_fee || 38000;
  }

  // 구독 만료일 설정
  if (user.quick_link_subscription_expires_at) {
    document.getElementById("user-edit-expires-at").value =
      user.quick_link_subscription_expires_at.substring(0, 10);
  }
}

// 회원 정보 업데이트 함수
function updateUser() {
  const userId = document.getElementById("user-edit-id").value;

  // 수정 데이터 생성
  const userData = {
    tier: document.getElementById("user-edit-tier").value,
    quick_link_credits_remaining: parseInt(
      document.getElementById("user-edit-credits").value
    ),
    quick_link_monthly_limit: parseInt(
      document.getElementById("user-edit-monthly-limit").value
    ),
    quick_link_subscription_type: document.getElementById(
      "user-edit-subscription-type"
    ).value,
  };

  // 오프라인 감정 수수료가 있으면 추가
  if (document.getElementById("user-edit-offline-fee")) {
    userData.offline_appraisal_fee = parseInt(
      document.getElementById("user-edit-offline-fee").value
    );
  }

  // 구독 만료일이 있으면 추가
  const expiresAt = document.getElementById("user-edit-expires-at").value;
  if (expiresAt) {
    userData.quick_link_subscription_expires_at = expiresAt;
  }

  // API 호출
  fetch(`/api/appr/admin/users/${userId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(userData),
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("회원 정보 업데이트에 실패했습니다.");
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        showAlert("회원 정보가 성공적으로 업데이트되었습니다.", "success");
        closeModal("user-edit-modal");
        loadUserList(); // 목록 새로고침
      } else {
        throw new Error(data.message || "회원 정보 업데이트에 실패했습니다.");
      }
    })
    .catch((error) => {
      showAlert(error.message, "error");
    });
}

// 회원 등급에 따른 기능 제한 정보 표시
function showTierInfo(tier) {
  let info = "";

  switch (tier) {
    case "까사트레이드 회원":
      info =
        "까사트레이드 회원은 퀵링크 무제한 사용 및 오프라인 감정 할인 혜택이 제공됩니다.";
      break;
    case "제휴사 회원":
      info =
        "제휴사 회원은 퀵링크 20회/월 사용 및 오프라인 감정 할인 혜택이 제공됩니다.";
      break;
    case "일반회원":
      info =
        "일반회원은 퀵링크 월 5회 무료 사용 및 구독 서비스를 이용할 수 있습니다.";
      break;
  }

  // 안내 메시지 표시
  if (info) {
    showAlert(info, "info");
  }
}
