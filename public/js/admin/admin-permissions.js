const MENU_LABELS = {
  dashboard: "대시보드",
  "live-bids": "현장 경매 관리",
  "direct-bids": "직접 경매 관리",
  "all-bids": "통합 경매 관리",
  "bid-results": "입찰 결과 & 정산",
  transactions: "거래 내역 관리",
  invoices: "인보이스 관리",
  users: "회원 관리",
  "recommend-filters": "추천 및 필터",
  settings: "관리자 설정",
  wms: "WMS(입고/수선/출고)",
  "repair-management": "수선 관리",
  "activity-logs": "사용자 활동기록",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMenuCheckboxes(menus, selected, disabled, userId) {
  const selectedSet = new Set(Array.isArray(selected) ? selected : []);
  return menus
    .map((menu) => {
      const checked = selectedSet.has(menu) ? "checked" : "";
      const dis = disabled ? "disabled" : "";
      return `<label class="menu-check">
        <input type="checkbox" data-user-id="${userId}" data-menu="${menu}" ${checked} ${dis} />
        <span>${escapeHtml(MENU_LABELS[menu] || menu)}</span>
      </label>`;
    })
    .join("");
}

function getSelectedMenus(userId) {
  return Array.from(
    document.querySelectorAll(`input[type="checkbox"][data-user-id="${userId}"]:checked`),
  ).map((el) => el.dataset.menu);
}

async function loadAccounts() {
  const body = document.getElementById("adminTableBody");
  body.innerHTML = `<tr><td colspan="6" class="text-center">데이터를 불러오는 중입니다...</td></tr>`;

  try {
    const data = await window.API.fetchAPI("/admin/admin-accounts");
    const accounts = data.accounts || [];
    const menus = data.menuKeys || [];

    if (!accounts.length) {
      body.innerHTML = `<tr><td colspan="6" class="text-center">관리자 계정이 없습니다.</td></tr>`;
      return;
    }

    body.innerHTML = accounts
      .map((account) => {
        const isSuper = Number(account.is_superadmin || 0) === 1 || String(account.login_id).toLowerCase() === "admin";
        const statusText = isSuper ? "슈퍼어드민" : Number(account.is_active || 0) === 1 ? "활성" : "비활성";
        const disabled = isSuper;

        return `
          <tr>
            <td>${escapeHtml(account.login_id)}</td>
            <td>${escapeHtml(account.company_name || "-")}</td>
            <td><span class="${isSuper ? "badge-super" : "badge-normal"}">${escapeHtml(statusText)}</span></td>
            <td>
              <div class="menu-check-wrap">
                ${renderMenuCheckboxes(menus, account.allowedMenus, disabled, account.id)}
              </div>
              ${isSuper ? "" : `<button class="btn btn-sm mt-8" data-action="save-perm" data-user-id="${account.id}">권한 저장</button>`}
            </td>
            <td>
              ${
                isSuper
                  ? "-"
                  : `<div class="password-wrap">
                      <input type="password" placeholder="새 비밀번호" data-password-input="${account.id}" />
                      <button class="btn btn-sm" data-action="change-password" data-user-id="${account.id}">변경</button>
                    </div>`
              }
            </td>
            <td>
              ${
                isSuper
                  ? "-"
                  : `<button class="btn btn-danger btn-sm" data-action="delete-admin" data-user-id="${account.id}" data-login-id="${escapeHtml(account.login_id)}">삭제</button>`
              }
            </td>
          </tr>
        `;
      })
      .join("");
  } catch (error) {
    body.innerHTML = `<tr><td colspan="6" class="text-center">불러오기 실패: ${escapeHtml(error.message)}</td></tr>`;
  }
}

async function createAdminAccount() {
  const loginId = document.getElementById("newLoginId").value.trim();
  const name = document.getElementById("newName").value.trim();
  const password = document.getElementById("newPassword").value.trim();

  if (!loginId || !password) {
    alert("아이디와 비밀번호를 입력하세요.");
    return;
  }

  try {
    await window.API.fetchAPI("/admin/admin-accounts", {
      method: "POST",
      body: JSON.stringify({
        loginId,
        name,
        password,
        allowedMenus: [],
      }),
    });
    document.getElementById("newLoginId").value = "";
    document.getElementById("newName").value = "";
    document.getElementById("newPassword").value = "";
    alert("관리자 계정이 생성되었습니다.");
    await loadAccounts();
  } catch (error) {
    alert(error.message || "관리자 계정 생성 실패");
  }
}

async function savePermissions(userId) {
  try {
    const allowedMenus = getSelectedMenus(userId);
    await window.API.fetchAPI(`/admin/admin-accounts/${userId}/permissions`, {
      method: "PUT",
      body: JSON.stringify({ allowedMenus }),
    });
    alert("권한이 저장되었습니다.");
  } catch (error) {
    alert(error.message || "권한 저장 실패");
  }
}

async function changePassword(userId) {
  const input = document.querySelector(`input[data-password-input="${userId}"]`);
  if (!input) return;
  const password = input.value.trim();
  if (!password) {
    alert("새 비밀번호를 입력하세요.");
    return;
  }

  try {
    await window.API.fetchAPI(`/admin/admin-accounts/${userId}/password`, {
      method: "PUT",
      body: JSON.stringify({ password }),
    });
    input.value = "";
    alert("비밀번호가 변경되었습니다.");
  } catch (error) {
    alert(error.message || "비밀번호 변경 실패");
  }
}

async function deleteAdmin(userId, loginId) {
  if (!confirm(`${loginId} 계정을 삭제하시겠습니까?`)) return;
  try {
    await window.API.fetchAPI(`/admin/admin-accounts/${userId}`, {
      method: "DELETE",
    });
    alert("관리자 계정이 삭제되었습니다.");
    await loadAccounts();
  } catch (error) {
    alert(error.message || "관리자 계정 삭제 실패");
  }
}

function bindTableActions() {
  const tableBody = document.getElementById("adminTableBody");
  tableBody.addEventListener("click", async (event) => {
    const target = event.target.closest("button[data-action]");
    if (!target) return;

    const action = target.dataset.action;
    const userId = Number(target.dataset.userId);
    if (!userId) return;

    if (action === "save-perm") {
      await savePermissions(userId);
      return;
    }
    if (action === "change-password") {
      await changePassword(userId);
      return;
    }
    if (action === "delete-admin") {
      await deleteAdmin(userId, target.dataset.loginId || "");
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("createBtn").addEventListener("click", createAdminAccount);
  bindTableActions();
  await loadAccounts();
});
