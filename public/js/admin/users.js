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

  // 회원 구분 라디오 버튼 변경 이벤트
  document.querySelectorAll('input[name="accountType"]').forEach((radio) => {
    radio.addEventListener("change", handleAccountTypeChange);
  });
});

// 회원 목록 로드
async function loadUsers() {
  try {
    showLoading("usersTableBody");
    const response = await fetchUsers();

    // API 응답이 배열인지 확인
    const users = Array.isArray(response) ? response : response.users || [];

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
    const row = createElement("tr");

    // 날짜 형식 변환 - UTC 기준으로 날짜만 추출
    let registrationDate = "-";
    if (user.registration_date) {
      const dateStr = String(user.registration_date);
      // ISO 문자열에서 날짜 부분만 추출 (시간대 영향 없음)
      const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        registrationDate = match[1] + "-" + match[2] + "-" + match[3];
      } else {
        // Date 객체인 경우 UTC 기준으로 추출
        try {
          const date = new Date(dateStr);
          const year = date.getUTCFullYear();
          const month = String(date.getUTCMonth() + 1).padStart(2, "0");
          const day = String(date.getUTCDate()).padStart(2, "0");
          registrationDate = `${year}-${month}-${day}`;
        } catch (e) {
          registrationDate = "-";
        }
      }
    }

    // 회원 구분
    const accountType = user.account_type || "individual";
    const accountTypeText =
      accountType === "corporate"
        ? '<span class="badge badge-corporate">기업</span>'
        : '<span class="badge badge-individual">개인</span>';

    // 예치금/한도 표시
    let balanceInfo = "";
    if (accountType === "individual") {
      const balance = user.deposit_balance || 0;
      balanceInfo = `<span class="balance-info">₩${balance.toLocaleString()}</span>`;
    } else {
      const limit = user.daily_limit || 0;
      const used = user.daily_used || 0;
      balanceInfo = `
        <span class="limit-info">
          한도: ₩${limit.toLocaleString()}<br/>
          <small>사용: ₩${used.toLocaleString()}</small>
        </span>
      `;
    }

    row.innerHTML = `
      <td>${user.id}</td>
      <td>${accountTypeText}</td>
      <td>${balanceInfo}</td>
      <td>${registrationDate}</td>
      <td>${user.company_name || "-"}</td>
      <td>${user.phone || "-"}</td>
      <td>${
        user.commission_rate !== null ? user.commission_rate + "%" : "-"
      }</td>
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

        // 예치금/한도 정보 조회
        let accountData = null;
        try {
          accountData = await window.API.fetchAPI(
            `/deposits/admin/user/${encodeURIComponent(id)}`,
          );
        } catch (err) {
          console.warn("예치금 정보 조회 실패:", err);
          // 기본값 설정
          accountData = {
            account_type: "individual",
            deposit_balance: 0,
            daily_limit: 0,
            daily_used: 0,
          };
        }

        // 사용자 데이터와 예치금 데이터 병합
        const userData = { ...user, ...accountData };

        // 사용자 데이터 로깅
        console.log("불러온 사용자 정보:", userData);

        // 사용자 폼 열기
        openUserForm(userData);

        // 사용자 목록 다시 로드
        loadUsers();
      } catch (error) {
        console.error("사용자 정보 로드 오류:", error);
        alert(
          "회원 정보를 불러오는데 실패했습니다: " +
            (error.message || "알 수 없는 오류"),
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

// 날짜를 입력 필드용 형식으로 변환 (YYYY-MM-DD)
function formatDateForInput(dateString) {
  if (!dateString) return "";

  // ISO 문자열에서 날짜 부분만 추출
  const dateMatch = String(dateString).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateMatch) {
    return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
  }

  // Date 객체인 경우 UTC 기준으로 날짜 추출
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "";

    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  } catch (e) {
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
  const commissionRate = document.getElementById("commissionRate");

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
    commissionRate.value =
      user.commission_rate !== null ? user.commission_rate : "";

    // 회원 구분
    const accountType = user.account_type || "individual";
    document.querySelector(
      `input[name="accountType"][value="${accountType}"]`,
    ).checked = true;

    // 회원 구분 저장 (변경 확인용)
    window.currentEditingUserAccountType = accountType;

    // 예치금/한도 정보
    document.getElementById("depositBalance").value = user.deposit_balance || 0;
    document.getElementById("dailyLimit").value = user.daily_limit || 0;
    document.getElementById("dailyUsed").value = user.daily_used || 0;

    // 상태 설정
    document.querySelector(
      `input[name="userStatus"][value="${user.is_active ? "true" : "false"}"]`,
    ).checked = true;

    // 비밀번호 필드
    userPassword.placeholder = "변경시에만 입력";
    userPassword.required = false;
  } else {
    editMode.value = "0";
    document.getElementById("userFormTitle").textContent = "새 회원 등록";
    userId.readOnly = false;
    userId.value = "";
    commissionRate.value = "";

    // 회원 구분 초기값: 개인
    document.querySelector(
      'input[name="accountType"][value="individual"]',
    ).checked = true;

    // 회원 구분 저장 초기화
    window.currentEditingUserAccountType = null;

    // 비밀번호 필드
    userPassword.placeholder = "비밀번호 입력";
    userPassword.required = true;
  }

  // 회원 구분에 따라 필드 표시/숨김
  handleAccountTypeChange();

  const modal = window.setupModal("userFormModal");
  if (modal) {
    modal.show();
  }
}

// 회원 구분 변경 시 필드 표시/숨김
function handleAccountTypeChange() {
  const accountType = document.querySelector(
    'input[name="accountType"]:checked',
  ).value;

  const depositBalanceGroup = document.getElementById("depositBalanceGroup");
  const dailyLimitGroup = document.getElementById("dailyLimitGroup");
  const dailyUsedGroup = document.getElementById("dailyUsedGroup");

  if (accountType === "individual") {
    // 개인 회원: 예치금만 표시 (읽기 전용)
    depositBalanceGroup.style.display = "block";
    dailyLimitGroup.style.display = "none";
    dailyUsedGroup.style.display = "none";

    document.getElementById("dailyLimit").required = false;
  } else {
    // 기업 회원: 한도/사용액 표시
    depositBalanceGroup.style.display = "none";
    dailyLimitGroup.style.display = "block";
    dailyUsedGroup.style.display = "block";

    document.getElementById("dailyLimit").required = true;
  }
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
    const commissionRateValue = document.getElementById("commissionRate").value;
    const isActive =
      document.querySelector('input[name="userStatus"]:checked').value ===
      "true";

    console.log("=== 프론트엔드 saveUser 시작 ===");
    console.log("원본 registrationDate (input value):", registrationDate);
    console.log("registrationDate 타입:", typeof registrationDate);

    // 회원 구분 및 한도 정보
    const accountType = document.querySelector(
      'input[name="accountType"]:checked',
    ).value;
    const dailyLimit =
      accountType === "corporate"
        ? parseInt(document.getElementById("dailyLimit").value) || 0
        : 0;

    if (!id) {
      alert("아이디를 입력해주세요.");
      return;
    }

    // 기업 회원일 때 한도 유효성 검사
    if (accountType === "corporate" && dailyLimit <= 0) {
      alert("기업 회원의 일일 한도를 입력해주세요.");
      return;
    }

    if (!editMode && !password) {
      alert("비밀번호를 입력해주세요.");
      return;
    }

    // 수정 모드에서 회원 구분 변경 확인
    if (
      editMode &&
      window.currentEditingUserAccountType &&
      window.currentEditingUserAccountType !== accountType
    ) {
      const accountTypeNames = {
        individual: "개인",
        corporate: "기업",
      };
      const confirmMsg =
        `회원 구분을 변경하시겠습니까?\n\n` +
        `변경 전: ${accountTypeNames[window.currentEditingUserAccountType]}\n` +
        `변경 후: ${accountTypeNames[accountType]}\n\n` +
        `이 작업은 기존 예치금/한도 설정에 영향을 줄 수 있습니다.`;

      if (!confirm(confirmMsg)) {
        return;
      }
    }

    // 가입일 처리 - 입력값 그대로 사용 (시간대 변환 없음)
    const adjustedRegistrationDate = registrationDate || null;

    console.log("처리된 adjustedRegistrationDate:", adjustedRegistrationDate);
    console.log(
      "adjustedRegistrationDate 타입:",
      typeof adjustedRegistrationDate,
    );

    const userData = {
      id: id,
      registration_date: adjustedRegistrationDate,
      email: email || null,
      business_number: businessNumber || null,
      company_name: companyName || null,
      phone: phone || null,
      address: address || null,
      is_active: isActive,
      commission_rate: commissionRateValue
        ? parseFloat(commissionRateValue)
        : null,
    };

    // 비밀번호가 입력된 경우에만 포함
    if (password) {
      userData.password = password;
    }

    console.log("서버로 전송할 userData:", userData);
    console.log("==================================");

    let response;
    if (editMode) {
      // 수정 요청 로깅
      console.log(`회원 수정 요청: ${id}`, userData);

      // 수정
      response = await updateUser(id, userData);

      // 예치금 설정 수정
      await window.API.fetchAPI("/deposits/admin/user-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: id,
          account_type: accountType,
          daily_limit: dailyLimit,
        }),
      });

      alert("회원 정보가 수정되었습니다.");
    } else {
      // 등록 요청 로깅
      console.log("회원 등록 요청:", userData);

      // 등록
      response = await createUser(userData);

      // 예치금 설정 초기화
      await window.API.fetchAPI("/deposits/admin/user-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: id,
          account_type: accountType,
          daily_limit: dailyLimit,
        }),
      });

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
      "삭제 중 오류가 발생했습니다: " + (error.message || "알 수 없는 오류"),
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
      "동기화 중 오류가 발생했습니다: " + (error.message || "알 수 없는 오류"),
    );
    loadUsers(); // 오류 발생 시에도 목록 새로고침
  }
}
