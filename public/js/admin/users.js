// public/js/admin/users.js

// 페이지 로드 시 실행
document.addEventListener("DOMContentLoaded", function () {
  // 회원 목록 로드
  loadUsers();

  // 새 회원 등록 버튼 클릭 이벤트
  document.getElementById("addUserBtn").addEventListener("click", function () {
    openUserForm();
  });

  // 시트 동기화 버튼 클릭 이벤트
  document
    .getElementById("syncSheetsBtn")
    .addEventListener("click", function () {
      syncWithSheets();
    });

  // 저장 버튼 클릭 이벤트
  document.getElementById("saveUserBtn").addEventListener("click", function () {
    saveUser();
  });
});

// 회원 목록 로드
async function loadUsers() {
  try {
    showLoading("usersTableBody");
    const users = await fetchUsers();

    if (users.length === 0) {
      showNoData("usersTableBody", "등록된 회원이 없습니다.");
      return;
    }

    renderUsers(users);
  } catch (error) {
    handleError(error, "회원 목록을 불러오는 중 오류가 발생했습니다.");
  }
}

// 회원 목록 렌더링
function renderUsers(users) {
  const tableBody = document.getElementById("usersTableBody");
  tableBody.innerHTML = "";

  users.forEach((user) => {
    const row = document.createElement("tr");

    row.innerHTML = `
        <td>${user.id}</td>
        <td>${user.email || "-"}</td>
        <td>${formatDate(user.created_at)}</td>
        <td>
          <span class="status-badge ${user.is_active ? "active" : "inactive"}">
            ${user.is_active ? "활성" : "비활성"}
          </span>
        </td>
        <td>
          <button class="btn btn-action edit-btn" data-id="${
            user.id
          }" data-email="${user.email || ""}" data-status="${
      user.is_active
    }">수정</button>
          <button class="btn btn-action delete-btn" data-id="${
            user.id
          }">삭제</button>
        </td>
      `;

    tableBody.appendChild(row);
  });

  // 수정 버튼 이벤트
  document.querySelectorAll(".edit-btn").forEach((button) => {
    button.addEventListener("click", function () {
      const id = this.dataset.id;
      const email = this.dataset.email;
      const isActive = this.dataset.status === "true";
      openUserForm(id, email, isActive);
    });
  });

  // 삭제 버튼 이벤트
  document.querySelectorAll(".delete-btn").forEach((button) => {
    button.addEventListener("click", function () {
      const id = this.dataset.id;
      if (confirm(`회원 '${id}'를 삭제하시겠습니까?`)) {
        removeUser(id);
      }
    });
  });
}

// 회원 등록/수정 모달 열기
function openUserForm(id = "", email = "", isActive = true) {
  const form = document.getElementById("userForm");
  form.reset();

  const editMode = document.getElementById("editMode");
  const userId = document.getElementById("userId");
  const userEmail = document.getElementById("userEmail");

  // 수정 모드 설정
  if (id) {
    editMode.value = "1";
    document.getElementById("userFormTitle").textContent = "회원 정보 수정";
    userId.value = id;
    userId.readOnly = true;
    userEmail.value = email;

    // 상태 설정
    document.querySelector(
      `input[name="userStatus"][value="${isActive}"]`
    ).checked = true;

    // 비밀번호 필드
    document.getElementById("userPassword").placeholder = "변경시에만 입력";
    document.getElementById("userPassword").required = false;
  } else {
    editMode.value = "0";
    document.getElementById("userFormTitle").textContent = "새 회원 등록";
    userId.readOnly = false;
    userId.value = "";
    userEmail.value = "";

    // 비밀번호 필드
    document.getElementById("userPassword").placeholder = "비밀번호 입력";
    document.getElementById("userPassword").required = true;
  }

  openModal("userFormModal");
}

// 회원 저장 (등록 또는 수정)
async function saveUser() {
  try {
    const editMode = document.getElementById("editMode").value === "1";
    const id = document.getElementById("userId").value;
    const password = document.getElementById("userPassword").value;
    const email = document.getElementById("userEmail").value;
    const isActive =
      document.querySelector('input[name="userStatus"]:checked').value ===
      "true";

    if (!id) {
      alert("아이디를 입력해주세요.");
      return;
    }

    if (!editMode && !password) {
      alert("비밀번호를 입력해주세요.");
      return;
    }

    const userData = {
      id: id,
      email: email,
      is_active: isActive,
    };

    // 비밀번호가 입력된 경우에만 포함
    if (password) {
      userData.password = password;
    }

    let response;
    if (editMode) {
      // 수정
      response = await updateUser(id, userData);
      alert("회원 정보가 수정되었습니다.");
    } else {
      // 등록
      response = await createUser(userData);
      alert("회원이 등록되었습니다.");
    }

    closeAllModals();
    loadUsers();
  } catch (error) {
    alert("오류가 발생했습니다: " + (error.message || "알 수 없는 오류"));
  }
}

// 회원 삭제
async function removeUser(id) {
  try {
    await deleteUser(id);

    alert("회원이 삭제되었습니다.");
    loadUsers();
  } catch (error) {
    alert(
      "삭제 중 오류가 발생했습니다: " + (error.message || "알 수 없는 오류")
    );
  }
}

// 스프레드시트와 동기화
async function syncWithSheets() {
  try {
    if (!confirm("구글 스프레드시트와 동기화하시겠습니까?")) {
      return;
    }

    await syncUsers();

    alert("동기화가 완료되었습니다.");
    loadUsers();
  } catch (error) {
    alert(
      "동기화 중 오류가 발생했습니다: " + (error.message || "알 수 없는 오류")
    );
  }
}
