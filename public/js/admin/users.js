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

    // 날짜 형식 변환 (YYYY-MM-DD 형식)
    const registrationDate = user.registration_date
      ? formatDateOnly(user.registration_date)
      : "-";

    // 주소가 너무 길면 축약 (최대 30자)
    const shortAddress = user.address
      ? user.address.length > 30
        ? user.address.substring(0, 30) + "..."
        : user.address
      : "-";

    row.innerHTML = `
        <td>${user.id}</td>
        <td>${registrationDate}</td>
        <td>${user.company_name || "-"}</td>
        <td>${user.phone || "-"}</td>
        <td>${user.email || "-"}</td>
        <td title="${user.address || ""}">${shortAddress}</td>
        <td>
          <span class="status-badge ${user.is_active ? "active" : "inactive"}">
            ${user.is_active ? "활성" : "비활성"}
          </span>
        </td>
        <td>
          <button class="btn btn-action edit-btn" data-id="${
            user.id
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
    button.addEventListener("click", async function () {
      const id = this.dataset.id;
      try {
        // 로딩 상태 표시
        showLoading("usersTableBody");

        // 사용자 ID URL 인코딩 및 로깅
        console.log(`사용자 정보 요청 ID: ${id}`);
        const user = await fetchUser(id);

        if (!user) {
          throw new Error("사용자 정보를 찾을 수 없습니다.");
        }

        // 사용자 데이터 로깅
        console.log("불러온 사용자 정보:", user);

        // 사용자 폼 열기
        openUserForm(user);

        // 사용자 목록 다시 로드
        loadUsers();
      } catch (error) {
        console.error("사용자 정보 로드 오류:", error);
        alert(
          "회원 정보를 불러오는데 실패했습니다: " +
            (error.message || "알 수 없는 오류")
        );
        loadUsers(); // 목록 다시 로드
      }
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

// 날짜만 형식화 (YYYY-MM-DD)
function formatDateOnly(dateString) {
  if (!dateString) return "-";

  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "-";

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  } catch (e) {
    console.error("날짜 형식화 오류:", e);
    return "-";
  }
}

// 날짜를 입력 필드용 형식으로 변환 (YYYY-MM-DD)
function formatDateForInput(dateString) {
  if (!dateString) return "";

  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "";

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  } catch (e) {
    console.error("날짜 입력 형식화 오류:", e);
    return "";
  }
}

// 회원 등록/수정 모달 열기
function openUserForm(user = null) {
  const form = document.getElementById("userForm");
  form.reset();

  const editMode = document.getElementById("editMode");
  const userId = document.getElementById("userId");
  const userPassword = document.getElementById("userPassword");
  const registrationDate = document.getElementById("registrationDate");
  const businessNumber = document.getElementById("businessNumber");
  const companyName = document.getElementById("companyName");
  const phone = document.getElementById("phone");
  const userEmail = document.getElementById("userEmail");
  const address = document.getElementById("address");

  // 수정 모드 설정
  if (user) {
    editMode.value = "1";
    document.getElementById("userFormTitle").textContent = "회원 정보 수정";
    userId.value = user.id;
    userId.readOnly = true;

    // 사용자 데이터 설정
    if (user.registration_date) {
      registrationDate.value = formatDateForInput(user.registration_date);
    }
    businessNumber.value = user.business_number || "";
    companyName.value = user.company_name || "";
    phone.value = user.phone || "";
    userEmail.value = user.email || "";
    address.value = user.address || "";

    // 상태 설정
    document.querySelector(
      `input[name="userStatus"][value="${user.is_active ? "true" : "false"}"]`
    ).checked = true;

    // 비밀번호 필드
    userPassword.placeholder = "변경시에만 입력";
    userPassword.required = false;
  } else {
    editMode.value = "0";
    document.getElementById("userFormTitle").textContent = "새 회원 등록";
    userId.readOnly = false;
    userId.value = "";

    // 비밀번호 필드
    userPassword.placeholder = "비밀번호 입력";
    userPassword.required = true;
  }

  openModal("userFormModal");
}

// 회원 저장 (등록 또는 수정)
async function saveUser() {
  try {
    const editMode = document.getElementById("editMode").value === "1";
    const id = document.getElementById("userId").value;
    const password = document.getElementById("userPassword").value;
    const registrationDate = document.getElementById("registrationDate").value;
    const businessNumber = document.getElementById("businessNumber").value;
    const companyName = document.getElementById("companyName").value;
    const phone = document.getElementById("phone").value;
    const email = document.getElementById("userEmail").value;
    const address = document.getElementById("address").value;
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
      registration_date: registrationDate || null,
      email: email || null,
      business_number: businessNumber || null,
      company_name: companyName || null,
      phone: phone || null,
      address: address || null,
      is_active: isActive,
    };

    // 비밀번호가 입력된 경우에만 포함
    if (password) {
      userData.password = password;
    }

    let response;
    if (editMode) {
      // 수정 요청 로깅
      console.log(`회원 수정 요청: ${id}`, userData);

      // 수정
      response = await updateUser(id, userData);
      alert("회원 정보가 수정되었습니다.");
    } else {
      // 등록 요청 로깅
      console.log("회원 등록 요청:", userData);

      // 등록
      response = await createUser(userData);
      alert("회원이 등록되었습니다.");
    }

    closeAllModals();
    loadUsers();
  } catch (error) {
    console.error("회원 저장 오류:", error);
    alert("오류가 발생했습니다: " + (error.message || "알 수 없는 오류"));
  }
}

// 회원 삭제
async function removeUser(id) {
  try {
    console.log(`회원 삭제 요청: ${id}`);
    await deleteUser(id);

    alert("회원이 삭제되었습니다.");
    loadUsers();
  } catch (error) {
    console.error("회원 삭제 오류:", error);
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

    const loadingText = "동기화 중입니다...";
    showNoData("usersTableBody", loadingText);

    await syncUsers();

    alert("동기화가 완료되었습니다.");
    loadUsers();
  } catch (error) {
    console.error("동기화 오류:", error);
    alert(
      "동기화 중 오류가 발생했습니다: " + (error.message || "알 수 없는 오류")
    );
    loadUsers(); // 오류 발생 시에도 목록 새로고침
  }
}
