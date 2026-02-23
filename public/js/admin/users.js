// public/js/admin/users.js

// 페이지 로드 시 실행
document.addEventListener("DOMContentLoaded", function () {
  initMemberTabs();
  initMemberFilters();
  loadUsers();
  loadMemberGroups();

  document.getElementById("addUserBtn").addEventListener("click", openUserForm);
  document
    .getElementById("syncSheetsBtn")
    .addEventListener("click", syncWithSheets);
  document.getElementById("saveUserBtn").addEventListener("click", saveUser);
  document.querySelectorAll('input[name="accountType"]').forEach((radio) => {
    radio.addEventListener("change", handleAccountTypeChange);
  });

  // 증빙 유형 수동 변경 감지
  document.querySelectorAll('input[name="documentType"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      window.documentTypeManuallySet = true;
    });
  });

  document
    .getElementById("manageGroupsBtn")
    ?.addEventListener("click", openManageGroupsModal);
  document
    .getElementById("closeManageGroupsModal")
    ?.addEventListener("click", closeManageGroupsModal);
  document
    .getElementById("addGroupBtn")
    ?.addEventListener("click", submitAddGroup);
  document
    .getElementById("closeAddMemberToGroupModal")
    ?.addEventListener("click", closeAddMemberToGroupModal);
  document
    .getElementById("addMemberSearchInput")
    ?.addEventListener("input", async function () {
      const groupId = document.getElementById("addMemberTargetGroupId")?.value;
      if (!groupId) return;
      await populateAddMemberCandidates(
        parseInt(groupId, 10),
        this.value.trim(),
      );
    });
  document
    .getElementById("addMemberSelectAll")
    ?.addEventListener("change", handleAddMemberSelectAll);
  document
    .getElementById("bulkAddMemberBtn")
    ?.addEventListener("click", submitBulkAddMembersToGroup);
});

let usersCache = [];

// 회원 목록 로드
async function loadUsers() {
  try {
    showLoading("usersTableBody");
    showLoading("deactivateCandidatesBody");
    showLoading("vipTopTableBody");
    const [response, executiveSummary] = await Promise.all([
      fetchUsers(),
      fetchExecutiveSummary().catch(() => ({ vipTop10: [] })),
    ]);

    const users = Array.isArray(response) ? response : response.users || [];
    usersCache = users;

    if (users.length === 0) {
      showNoData("usersTableBody", "등록된 회원이 없습니다.");
      showNoData("deactivateCandidatesBody", "비활성화 대상 회원이 없습니다.");
      renderVipTop10(executiveSummary?.vipTop10 || []);
      const countNode = document.getElementById("deactivateCandidateCount");
      if (countNode) countNode.textContent = "0명";
      return;
    }

    applyMemberFiltersAndRender();
    renderDeactivateCandidates(users);
    renderVipTop10(executiveSummary?.vipTop10 || []);
  } catch (error) {
    handleError(error, "회원 목록을 불러오는 중 오류가 발생했습니다.");
  }
}

function initMemberFilters() {
  ["memberStatusFilter", "memberSortField", "memberSortOrder"].forEach((id) => {
    const node = document.getElementById(id);
    if (!node) return;
    node.addEventListener("change", () => applyMemberFiltersAndRender());
  });
}

function applyMemberFiltersAndRender() {
  const statusFilter =
    document.getElementById("memberStatusFilter")?.value || "all";
  const sortField =
    document.getElementById("memberSortField")?.value || "registration_date";
  const sortOrder = document.getElementById("memberSortOrder")?.value || "desc";

  const filtered = (usersCache || []).filter((u) => {
    if (statusFilter === "active") return !!u.is_active;
    if (statusFilter === "inactive") return !u.is_active;
    return true;
  });

  filtered.sort((a, b) => compareUsers(a, b, sortField, sortOrder));
  renderUsers(filtered);
}

function compareUsers(a, b, sortField, sortOrder) {
  const direction = sortOrder === "asc" ? 1 : -1;

  if (sortField === "registration_date") {
    const ad = toTime(a.registration_date || a.created_at);
    const bd = toTime(b.registration_date || b.created_at);
    return (ad - bd) * direction;
  }

  if (sortField === "total_bid_jpy") {
    const av = Number(a.total_bid_jpy || 0);
    const bv = Number(b.total_bid_jpy || 0);
    return (av - bv) * direction;
  }

  if (sortField === "total_bid_count") {
    const av = Number(a.total_bid_count || 0);
    const bv = Number(b.total_bid_count || 0);
    return (av - bv) * direction;
  }

  if (sortField === "last_bid_at") {
    const ad = toTime(a.last_bid_at);
    const bd = toTime(b.last_bid_at);
    return (ad - bd) * direction;
  }

  const av = String(a[sortField] || "").toLowerCase();
  const bv = String(b[sortField] || "").toLowerCase();
  if (av < bv) return -1 * direction;
  if (av > bv) return 1 * direction;
  return 0;
}

function toTime(v) {
  if (!v) return 0;
  const dt = new Date(v);
  if (Number.isNaN(dt.getTime())) return 0;
  return dt.getTime();
}

function initMemberTabs() {
  document
    .querySelector(".member-tabs")
    ?.addEventListener("click", function (e) {
      const btn = e.target.closest(".member-tab-btn[data-tab-target]");
      if (!btn) return;
      const target = btn.dataset.tabTarget;
      document
        .querySelectorAll(".member-tab-btn[data-tab-target]")
        .forEach((b) => b.classList.remove("active"));
      document
        .querySelectorAll(".member-tab-panel")
        .forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const targetPanel = document.getElementById(target);
      if (targetPanel) {
        targetPanel.classList.add("active");
        const groupId = targetPanel.dataset?.groupId;
        if (groupId) loadGroupMembers(parseInt(groupId, 10));
      }
    });
}

function formatLastBidDate(value) {
  if (!value) return "입찰 이력 없음";
  return formatDate(value, true);
}

function formatRecentBidText(user) {
  if (!user?.last_bid_at) return "입찰 이력 없음";
  const bidType = user.last_bid_type === "live" ? "현장" : "직접";
  return `${bidType}#${user.last_bid_id || "-"} / ${
    user.last_bid_item_id || "-"
  }   (${formatDate(user.last_bid_at, true)})`;
}

// ========== 회원 그룹 ==========
let memberGroupsCache = [];
const groupMembersCache = new Map();
const groupSelectionState = new Map();
let addMemberSelectionState = new Set();

function sanitizeUserIds(ids) {
  if (!Array.isArray(ids)) return [];
  return Array.from(
    new Set(
      ids
        .map((id) => parseInt(id, 10))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  );
}

function getGroupSelectionSet(groupId) {
  const gid = parseInt(groupId, 10);
  if (!groupSelectionState.has(gid)) {
    groupSelectionState.set(gid, new Set());
  }
  return groupSelectionState.get(gid);
}

function clearGroupSelection(groupId) {
  const gid = parseInt(groupId, 10);
  groupSelectionState.set(gid, new Set());
}

function updateGroupSelectionUI(groupId, totalRows = 0) {
  const gid = parseInt(groupId, 10);
  const selectedSet = getGroupSelectionSet(gid);
  const selectedCount = selectedSet.size;

  const countNode = document.getElementById(`groupSelectedCount-${gid}`);
  if (countNode) {
    countNode.textContent = `선택 ${selectedCount}명`;
  }

  const bulkRemoveBtn = document.getElementById(`groupBulkRemoveBtn-${gid}`);
  if (bulkRemoveBtn) {
    bulkRemoveBtn.disabled = selectedCount === 0;
  }

  const selectAll = document.getElementById(`groupSelectAll-${gid}`);
  if (selectAll) {
    if (totalRows <= 0) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
      selectAll.disabled = true;
      return;
    }
    selectAll.disabled = false;
    selectAll.checked = selectedCount > 0 && selectedCount === totalRows;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < totalRows;
  }
}

function updateAddMemberSelectionUI() {
  const list = document.getElementById("addMemberCandidateList");
  const totalCandidates = Number(list?.dataset?.totalCandidates || 0);
  const selectedCount = addMemberSelectionState.size;

  const countNode = document.getElementById("addMemberSelectedCount");
  if (countNode) countNode.textContent = `선택 ${selectedCount}명`;

  const bulkAddBtn = document.getElementById("bulkAddMemberBtn");
  if (bulkAddBtn) bulkAddBtn.disabled = selectedCount === 0;

  const selectAll = document.getElementById("addMemberSelectAll");
  if (selectAll) {
    if (totalCandidates <= 0) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
      selectAll.disabled = true;
      return;
    }
    selectAll.disabled = false;
    selectAll.checked = selectedCount > 0 && selectedCount === totalCandidates;
    selectAll.indeterminate =
      selectedCount > 0 && selectedCount < totalCandidates;
  }
}

async function loadMemberGroups() {
  try {
    const groups = await fetchMemberGroups();
    memberGroupsCache = Array.isArray(groups) ? groups : [];
    const activeGroupIds = new Set(memberGroupsCache.map((g) => Number(g.id)));
    Array.from(groupMembersCache.keys()).forEach((gid) => {
      if (!activeGroupIds.has(Number(gid))) groupMembersCache.delete(gid);
    });
    Array.from(groupSelectionState.keys()).forEach((gid) => {
      if (!activeGroupIds.has(Number(gid))) groupSelectionState.delete(gid);
    });
    renderGroupTabs();
    renderGroupPanels();
  } catch (error) {
    console.error("그룹 목록 로드 실패:", error);
    memberGroupsCache = [];
    renderGroupTabs();
    renderGroupPanels();
  }
}

function renderGroupTabs() {
  const container = document.getElementById("groupTabsContainer");
  if (!container) return;
  container.innerHTML = memberGroupsCache
    .map(
      (g) =>
        `<button type="button" class="member-tab-btn" data-tab-target="groupPanel-${g.id}">${escapeHtml(g.name)}</button>`,
    )
    .join("");
}

function renderGroupPanels() {
  const container = document.getElementById("groupPanelsContainer");
  if (!container) return;
  container.innerHTML = memberGroupsCache
    .map(
      (g) => `
        <div id="groupPanel-${g.id}" class="member-tab-panel" data-group-id="${g.id}">
          <div class="card" style="margin-top: 16px">
            <div class="section-header-row" style="flex-wrap: wrap; gap: 8px">
              <h3>${escapeHtml(g.name)} 회원 관리</h3>
              <div class="group-header-actions">
                <span id="groupCount-${g.id}" class="candidate-count">0명</span>
                <span id="groupSelectedCount-${g.id}" class="group-selected-count">선택 0명</span>
                <button type="button" class="btn btn-sm btn-ghost btn-danger-ghost btn-group-bulk-remove" id="groupBulkRemoveBtn-${g.id}" data-group-id="${g.id}" disabled>선택 삭제</button>
                <button type="button" class="btn btn-sm btn-add-group-member" data-group-id="${g.id}" data-group-name="${escapeHtml(g.name).replace(/'/g, "&#39;")}">회원 추가</button>
              </div>
            </div>
            <table class="data-table">
              <thead>
                <tr>
                  <th class="group-member-select-col"><input type="checkbox" id="groupSelectAll-${g.id}" /></th>
                  <th>아이디</th>
                  <th>업체명</th>
                  <th>입찰현황</th>
                  <th>최근입찰</th>
                  <th>상태</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody id="groupMemberBody-${g.id}">
                <tr><td colspan="7" class="text-center">데이터를 불러오는 중입니다...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      `,
    )
    .join("");
  container.querySelectorAll(".btn-add-group-member").forEach((btn) => {
    const gid = parseInt(btn.dataset.groupId, 10);
    const gname = btn.dataset.groupName || "";
    btn.addEventListener("click", () => openAddMemberToGroupModal(gid, gname));
  });
  container.querySelectorAll(".btn-group-bulk-remove").forEach((btn) => {
    const gid = parseInt(btn.dataset.groupId, 10);
    btn.addEventListener("click", () => submitBulkRemoveMembersFromGroup(gid));
  });
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

async function loadGroupMembers(groupId) {
  const tbody = document.getElementById(`groupMemberBody-${groupId}`);
  const countEl = document.getElementById(`groupCount-${groupId}`);
  if (!tbody) return;
  try {
    const loadedMembers = await fetchGroupMembers(groupId);
    const members = Array.isArray(loadedMembers) ? loadedMembers : [];
    groupMembersCache.set(groupId, members);
    clearGroupSelection(groupId);
    renderGroupMembers(groupId, members);
    if (countEl) countEl.textContent = `${members.length}명`;
    updateGroupSelectionUI(groupId, members.length);
  } catch (error) {
    console.error("그룹 회원 로드 실패:", error);
    groupMembersCache.set(groupId, []);
    clearGroupSelection(groupId);
    tbody.innerHTML =
      '<tr><td colspan="7" class="text-center">로드 실패</td></tr>';
    if (countEl) countEl.textContent = "0명";
    updateGroupSelectionUI(groupId, 0);
  }
}

function renderGroupMembers(groupId, members) {
  const gid = parseInt(groupId, 10);
  const tbody = document.getElementById(`groupMemberBody-${groupId}`);
  const countEl = document.getElementById(`groupCount-${groupId}`);
  if (!tbody) return;
  if (countEl) countEl.textContent = `${members.length}명`;
  if (!members.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="text-center">이 그룹에 회원이 없습니다.</td></tr>';
    updateGroupSelectionUI(gid, 0);
    return;
  }
  clearGroupSelection(gid);
  tbody.innerHTML = members
    .map(
      (u) => `
        <tr>
          <td class="group-member-select-col"><input type="checkbox" class="group-member-select" data-group-id="${gid}" data-user-id="${u.id}" /></td>
          <td>${escapeHtml(u.login_id || u.id)}</td>
          <td>${escapeHtml(u.company_name || "-")}</td>
          <td>${Number(u.total_bid_count || 0).toLocaleString()}건 / ${formatCurrency(Number(u.total_bid_jpy || 0), "JPY")}</td>
          <td>${formatRecentBidText(u)}</td>
          <td><span class="status-badge ${u.is_active ? "active" : "inactive"}">${u.is_active ? "활성" : "비활성"}</span></td>
          <td>
            <div class="cell-actions">
              <button class="btn btn-ghost btn-sm group-view-bids-btn" data-user-id="${u.id}">입찰내역</button>
              <button class="btn btn-ghost btn-sm company-toggle-btn" data-id="${u.id}" data-login-id="${escapeHtml(u.login_id || u.id)}" data-next="${u.is_active ? "0" : "1"}">${u.is_active ? "비활성화" : "활성화"}</button>
              <button class="btn btn-ghost btn-sm btn-danger-ghost group-remove-btn" data-user-id="${u.id}" data-group-id="${groupId}">그룹에서 제거</button>
            </div>
          </td>
        </tr>
      `,
    )
    .join("");
  tbody.querySelectorAll(".group-view-bids-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      openBidHistoryModal(this.dataset.userId);
    });
  });
  tbody.querySelectorAll(".company-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", async function () {
      const id = this.dataset.id;
      const loginId = this.dataset.loginId;
      const next = this.dataset.next === "1";
      if (
        !confirm(
          `회원 '${loginId}'를 ${next ? "활성화" : "비활성화"}하시겠습니까?`,
        )
      )
        return;
      try {
        await updateUser(id, { is_active: next });
        showAlert(
          `회원 '${loginId}' ${next ? "활성화" : "비활성화"} 완료`,
          "success",
        );
        await loadGroupMembers(gid);
      } catch (err) {
        handleError(err, "회원 상태 변경 중 오류가 발생했습니다.");
      }
    });
  });
  tbody.querySelectorAll(".group-remove-btn").forEach((btn) => {
    btn.addEventListener("click", async function () {
      const userId = parseInt(this.dataset.userId, 10);
      const gid = parseInt(this.dataset.groupId, 10);
      if (!confirm("이 그룹에서 제거하시겠습니까?")) return;
      try {
        await removeMemberFromGroup(gid, userId);
        showAlert("그룹에서 제거되었습니다.", "success");
        await loadGroupMembers(gid);
        const modalGroupId = parseInt(
          document.getElementById("addMemberTargetGroupId")?.value,
          10,
        );
        if (modalGroupId === gid) {
          await populateAddMemberCandidates(
            gid,
            document.getElementById("addMemberSearchInput")?.value || "",
          );
        }
      } catch (err) {
        handleError(err, "제거 중 오류가 발생했습니다.");
      }
    });
  });

  const selectAll = document.getElementById(`groupSelectAll-${gid}`);
  if (selectAll) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    selectAll.disabled = members.length === 0;
    selectAll.onchange = () => {
      const nextChecked = !!selectAll.checked;
      const selectedSet = getGroupSelectionSet(gid);
      selectedSet.clear();
      tbody.querySelectorAll(".group-member-select").forEach((checkbox) => {
        checkbox.checked = nextChecked;
        if (nextChecked) selectedSet.add(parseInt(checkbox.dataset.userId, 10));
      });
      updateGroupSelectionUI(gid, members.length);
    };
  }

  tbody.querySelectorAll(".group-member-select").forEach((checkbox) => {
    checkbox.addEventListener("change", function () {
      const userId = parseInt(this.dataset.userId, 10);
      const selectedSet = getGroupSelectionSet(gid);
      if (this.checked) selectedSet.add(userId);
      else selectedSet.delete(userId);
      updateGroupSelectionUI(gid, members.length);
    });
  });

  updateGroupSelectionUI(gid, members.length);
}

async function submitBulkRemoveMembersFromGroup(groupId) {
  const gid = parseInt(groupId, 10);
  const selectedUserIds = sanitizeUserIds(
    Array.from(getGroupSelectionSet(gid)),
  );
  if (!selectedUserIds.length) {
    showAlert("선택된 회원이 없습니다.", "warning");
    return;
  }
  if (
    !confirm(`선택한 ${selectedUserIds.length}명을 그룹에서 제거하시겠습니까?`)
  )
    return;

  try {
    let removedCount = 0;
    if (typeof removeMembersFromGroupBatch === "function") {
      const result = await removeMembersFromGroupBatch(gid, selectedUserIds);
      removedCount = Number(result?.removed || 0);
    } else {
      const settled = await Promise.allSettled(
        selectedUserIds.map((userId) => removeMemberFromGroup(gid, userId)),
      );
      removedCount = settled.filter(
        (item) => item.status === "fulfilled",
      ).length;
    }
    showAlert(`${removedCount}명 그룹에서 제거되었습니다.`, "success");
    await loadGroupMembers(gid);
    const modalGroupId = parseInt(
      document.getElementById("addMemberTargetGroupId")?.value,
      10,
    );
    if (modalGroupId === gid) {
      await populateAddMemberCandidates(
        gid,
        document.getElementById("addMemberSearchInput")?.value || "",
      );
    }
  } catch (err) {
    handleError(err, "회원 일괄 제거 중 오류가 발생했습니다.");
  }
}

function openManageGroupsModal() {
  const modal = document.getElementById("manageGroupsModal");
  if (modal) {
    modal.style.display = "flex";
    refreshManageGroupsList();
    document.getElementById("newGroupName").value = "";
    modal.onclick = (e) => {
      if (e.target === modal) closeManageGroupsModal();
    };
  }
}

function closeManageGroupsModal() {
  const modal = document.getElementById("manageGroupsModal");
  if (modal) modal.style.display = "none";
}

function refreshManageGroupsList() {
  const list = document.getElementById("manageGroupsList");
  if (!list) return;
  if (!memberGroupsCache.length) {
    list.innerHTML = '<p class="text-muted">등록된 그룹이 없습니다.</p>';
    return;
  }
  list.innerHTML = memberGroupsCache
    .map(
      (g) => `
        <div class="group-list-item" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--admin-border);">
          <span>${escapeHtml(g.name)}</span>
          <button type="button" class="btn btn-sm btn-ghost btn-danger-ghost" data-group-id="${g.id}" data-group-name="${escapeHtml(g.name)}">삭제</button>
        </div>
      `,
    )
    .join("");
  list.querySelectorAll("button[data-group-id]").forEach((btn) => {
    btn.addEventListener("click", async function () {
      const id = parseInt(this.dataset.groupId, 10);
      const name = this.dataset.groupName;
      if (
        !confirm(
          `그룹 '${name}'을(를) 삭제하시겠습니까? 소속 회원 연결만 해제됩니다.`,
        )
      )
        return;
      try {
        await deleteMemberGroup(id);
        showAlert("그룹이 삭제되었습니다.", "success");
        await loadMemberGroups();
        refreshManageGroupsList();
      } catch (err) {
        handleError(err, "그룹 삭제 중 오류가 발생했습니다.");
      }
    });
  });
}

async function submitAddGroup() {
  const input = document.getElementById("newGroupName");
  const name = (input?.value || "").trim();
  if (!name) {
    showAlert("그룹명을 입력하세요.", "warning");
    return;
  }
  try {
    await createMemberGroup(name);
    showAlert("그룹이 추가되었습니다.", "success");
    input.value = "";
    await loadMemberGroups();
    refreshManageGroupsList();
  } catch (err) {
    handleError(err, "그룹 추가 중 오류가 발생했습니다.");
  }
}

async function openAddMemberToGroupModal(groupId, groupName) {
  const modal = document.getElementById("addMemberToGroupModal");
  document.getElementById("addMemberTargetGroupId").value = groupId;
  document.getElementById("addMemberToGroupTitle").textContent =
    `"${groupName}"에 회원 추가`;
  document.getElementById("addMemberSearchInput").value = "";
  addMemberSelectionState = new Set();
  const selectAll = document.getElementById("addMemberSelectAll");
  if (selectAll) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    selectAll.disabled = true;
  }
  const bulkAddBtn = document.getElementById("bulkAddMemberBtn");
  if (bulkAddBtn) bulkAddBtn.disabled = true;
  updateAddMemberSelectionUI();
  if (modal) {
    modal.style.display = "flex";
    modal.onclick = (e) => {
      if (e.target === modal) closeAddMemberToGroupModal();
    };
  }
  await loadGroupMembers(groupId);
  await populateAddMemberCandidates(groupId, "");
}

function closeAddMemberToGroupModal() {
  document.getElementById("addMemberToGroupModal").style.display = "none";
  addMemberSelectionState = new Set();
  updateAddMemberSelectionUI();
}

async function ensureGroupMembersCache(groupId) {
  const gid = parseInt(groupId, 10);
  if (!groupMembersCache.has(gid)) {
    const members = await fetchGroupMembers(gid);
    groupMembersCache.set(gid, Array.isArray(members) ? members : []);
  }
  return groupMembersCache.get(gid) || [];
}

async function populateAddMemberCandidates(groupId, searchTerm) {
  const gid = parseInt(groupId, 10);
  const list = document.getElementById("addMemberCandidateList");
  if (!list) return;
  const currentMembers = await ensureGroupMembersCache(gid);
  const currentMemberIdSet = new Set(
    (currentMembers || [])
      .map((member) => parseInt(member.id, 10))
      .filter((id) => Number.isInteger(id) && id > 0),
  );
  const term = (searchTerm || "").toLowerCase();
  const users = (usersCache || []).filter((u) => {
    const uid = parseInt(u.id, 10);
    if (currentMemberIdSet.has(uid)) return false;
    const login = String(u.login_id || "").toLowerCase();
    const company = String(u.company_name || "").toLowerCase();
    return !term || login.includes(term) || company.includes(term);
  });
  const validCandidateIds = new Set(users.map((u) => parseInt(u.id, 10)));
  addMemberSelectionState = new Set(
    Array.from(addMemberSelectionState).filter((id) =>
      validCandidateIds.has(id),
    ),
  );
  list.dataset.totalCandidates = String(users.length);
  if (!users.length) {
    const emptyMessage = term
      ? "검색 결과가 없습니다."
      : "추가 가능한 회원이 없습니다.";
    list.innerHTML = `<p class="text-muted">${emptyMessage}</p>`;
    updateAddMemberSelectionUI();
    return;
  }
  list.innerHTML = users
    .map(
      (u) => `
        <div class="add-member-candidate" data-user-id="${u.id}">
          <label class="group-bulk-checkbox">
            <input type="checkbox" class="add-member-select" data-user-id="${u.id}" ${
              addMemberSelectionState.has(parseInt(u.id, 10)) ? "checked" : ""
            } />
          </label>
          <span class="add-member-candidate-main">${escapeHtml(u.login_id || u.id)} / ${escapeHtml(
            u.company_name || "-",
          )}</span>
          <button type="button" class="btn btn-sm add-member-single-btn" data-user-id="${u.id}">추가</button>
        </div>
      `,
    )
    .join("");
  list.querySelectorAll(".add-member-candidate").forEach((el) => {
    el.addEventListener("click", function (e) {
      if (
        e.target.closest("button") ||
        e.target.closest("input[type='checkbox']")
      )
        return;
      const checkbox = el.querySelector(".add-member-select");
      if (!checkbox) return;
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event("change"));
    });
  });
  list.querySelectorAll(".add-member-select").forEach((checkbox) => {
    checkbox.addEventListener("change", function () {
      const uid = parseInt(this.dataset.userId, 10);
      if (this.checked) addMemberSelectionState.add(uid);
      else addMemberSelectionState.delete(uid);
      updateAddMemberSelectionUI();
    });
  });
  list.querySelectorAll(".add-member-single-btn").forEach((btn) => {
    btn.addEventListener("click", async function () {
      const uid = parseInt(this.dataset.userId, 10);
      if (!uid) return;
      await submitAddMemberToGroup(gid, uid);
    });
  });
  updateAddMemberSelectionUI();
}

async function submitAddMemberToGroup(groupId, userId) {
  const gid = parseInt(groupId, 10);
  const uid = parseInt(userId, 10);
  if (!gid || !uid) {
    showAlert("유효하지 않은 회원 정보입니다.", "warning");
    return;
  }
  try {
    const result = await addMemberToGroup(gid, uid);
    if (result?.added === false) {
      showAlert("이미 그룹에 등록된 회원입니다.", "warning");
    } else {
      showAlert("그룹에 추가되었습니다.", "success");
    }
    addMemberSelectionState.delete(uid);
    await loadGroupMembers(gid);
    await populateAddMemberCandidates(
      gid,
      document.getElementById("addMemberSearchInput")?.value || "",
    );
  } catch (err) {
    handleError(err, "회원 추가 중 오류가 발생했습니다.");
  }
}

function handleAddMemberSelectAll(event) {
  const checked = !!event.target.checked;
  const checkboxes = Array.from(
    document.querySelectorAll("#addMemberCandidateList .add-member-select"),
  );
  addMemberSelectionState = new Set();
  checkboxes.forEach((checkbox) => {
    checkbox.checked = checked;
    if (checked)
      addMemberSelectionState.add(parseInt(checkbox.dataset.userId, 10));
  });
  updateAddMemberSelectionUI();
}

async function submitBulkAddMembersToGroup() {
  const groupId = parseInt(
    document.getElementById("addMemberTargetGroupId")?.value,
    10,
  );
  const userIds = sanitizeUserIds(Array.from(addMemberSelectionState));
  if (!groupId || !userIds.length) {
    showAlert("선택된 회원이 없습니다.", "warning");
    return;
  }

  try {
    let insertedCount = 0;
    if (typeof addMembersToGroupBatch === "function") {
      const result = await addMembersToGroupBatch(groupId, userIds);
      insertedCount = Number(result?.inserted || 0);
    } else {
      const settled = await Promise.all(
        userIds.map((userId) =>
          addMemberToGroup(groupId, userId).catch(() => ({ added: false })),
        ),
      );
      insertedCount = settled.filter(
        (result) => result?.added !== false,
      ).length;
    }
    if (insertedCount === 0) {
      showAlert("이미 그룹에 등록된 회원들입니다.", "warning");
    } else {
      showAlert(`${insertedCount}명 그룹에 추가되었습니다.`, "success");
    }
    addMemberSelectionState = new Set();
    await loadGroupMembers(groupId);
    await populateAddMemberCandidates(
      groupId,
      document.getElementById("addMemberSearchInput")?.value || "",
    );
  } catch (err) {
    handleError(err, "회원 일괄 추가 중 오류가 발생했습니다.");
  }
}

function formatBidTypeLabel(type) {
  return type === "live" ? "현장" : "직접";
}

function formatBidStatusLabel(status) {
  const map = {
    completed: "완료",
    domestic_arrived: "국내도착",
    processing: "작업중",
    shipped: "출고됨",
  };
  return map[String(status || "").toLowerCase()] || status || "-";
}

async function openBidHistoryModal(userId) {
  try {
    const modal = window.setupModal("bidHistoryModal");
    if (!modal) return;

    const body = document.getElementById("bidHistoryBody");
    const title = document.getElementById("bidHistoryTitle");
    const totalCountNode = document.getElementById("bhTotalCount");
    const totalJpyNode = document.getElementById("bhTotalJpy");
    const completedCountNode = document.getElementById("bhCompletedCount");

    if (body) {
      body.innerHTML =
        '<tr><td colspan="8" class="text-center">데이터를 불러오는 중입니다...</td></tr>';
    }
    if (title) title.textContent = "입찰 내역";
    if (totalCountNode) totalCountNode.textContent = "0건";
    if (totalJpyNode) totalJpyNode.textContent = "¥0";
    if (completedCountNode) completedCountNode.textContent = "0건";

    modal.show();

    const result = await fetchUserBidHistory(userId);
    const user = result?.user || {};
    const summary = result?.summary || {};
    const history = Array.isArray(result?.history) ? result.history : [];

    if (title) {
      title.textContent = `입찰 내역 - ${user.company_name || "-"} (${user.login_id || user.id || userId})`;
    }
    if (totalCountNode) {
      totalCountNode.textContent = `${Number(summary.totalBidCount || 0).toLocaleString()}건`;
    }
    if (totalJpyNode) {
      totalJpyNode.textContent = formatCurrency(
        Number(summary.totalBidJpy || 0),
        "JPY",
      );
    }
    if (completedCountNode) {
      completedCountNode.textContent = `${Number(summary.completedCount || 0).toLocaleString()}건`;
    }

    if (!body) return;
    if (!history.length) {
      body.innerHTML =
        '<tr><td colspan="8" class="text-center">입찰 내역이 없습니다.</td></tr>';
      return;
    }

    body.innerHTML = history
      .map(
        (row) => `
          <tr>
            <td>${formatDate(row.bid_at, true)}</td>
            <td>${formatBidTypeLabel(row.bid_type)}</td>
            <td>${row.bid_id || "-"}</td>
            <td>${row.item_id || "-"}</td>
            <td>${row.item_title || "-"}</td>
            <td>${row.auc_num || "-"}</td>
            <td>${formatBidStatusLabel(row.status)}</td>
            <td>${formatCurrency(Number(row.bid_price_jpy || 0), "JPY")}</td>
          </tr>
        `,
      )
      .join("");
  } catch (error) {
    handleError(error, "회원 입찰 내역을 불러오는 중 오류가 발생했습니다.");
  }
}

function renderDeactivateCandidates(users) {
  const body = document.getElementById("deactivateCandidatesBody");
  const countNode = document.getElementById("deactivateCandidateCount");
  if (!body) return;

  const candidates = (users || [])
    .filter((u) => Number(u.deactivate_candidate) === 1)
    .sort((a, b) => Number(b.no_bid_days || 0) - Number(a.no_bid_days || 0));

  if (countNode) countNode.textContent = `${candidates.length}명`;

  if (!candidates.length) {
    body.innerHTML = `<tr><td colspan="8" class="text-center">비활성화 대상 회원이 없습니다.</td></tr>`;
    return;
  }

  body.innerHTML = candidates
    .map(
      (u) => `
      <tr>
        <td>${u.login_id || u.id}</td>
        <td>${u.company_name || "-"}</td>
        <td>${formatLastBidDate(u.last_bid_at)}</td>
        <td>${Number(u.no_bid_days || 0)}일</td>
        <td>${u.deactivate_reason || "-"}</td>
        <td>${u.deactivate_note || "-"}</td>
        <td><span class="status-badge active">활성</span></td>
        <td>
          <button class="btn btn-action deactivate-candidate-btn" data-id="${u.id}" data-login-id="${u.login_id || u.id}">
            비활성화
          </button>
        </td>
      </tr>
    `,
    )
    .join("");

  document.querySelectorAll(".deactivate-candidate-btn").forEach((btn) => {
    btn.addEventListener("click", async function () {
      const id = this.dataset.id;
      const loginId = this.dataset.loginId;
      if (!confirm(`회원 '${loginId}'를 비활성화하시겠습니까?`)) return;
      try {
        await updateUser(id, { is_active: false });
        alert(`회원 '${loginId}' 비활성화 완료`);
        await loadUsers();
      } catch (error) {
        handleError(error, "회원 비활성화 중 오류가 발생했습니다.");
      }
    });
  });
}

function renderVipTop10(vips) {
  const body = document.getElementById("vipTopTableBody");
  if (!body) return;

  if (!vips || !vips.length) {
    body.innerHTML = `<tr><td colspan="5" class="text-center">상위 고객 데이터가 없습니다.</td></tr>`;
    return;
  }

  body.innerHTML = vips
    .slice(0, 10)
    .map(
      (vip, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${vip.login_id || "-"}</td>
          <td>${vip.company_name || "-"}</td>
          <td>${Number(vip.completedCount || 0).toLocaleString()}건</td>
          <td>${formatCurrency(Number(vip.totalRevenueKrw || 0), "KRW")}</td>
        </tr>
      `,
    )
    .join("");
}

function renderCompanyMembers(users, keyword, bodyId, countId) {
  const body = document.getElementById(bodyId);
  const countNode = document.getElementById(countId);
  if (!body) return;

  const targetUsers = (users || [])
    .filter((u) =>
      String(u.company_base_name || u.company_name || "")
        .toLowerCase()
        .includes(String(keyword).toLowerCase()),
    )
    .sort(
      (a, b) => Number(b.total_bid_jpy || 0) - Number(a.total_bid_jpy || 0),
    );

  if (countNode) countNode.textContent = `${targetUsers.length}명`;

  if (!targetUsers.length) {
    body.innerHTML = `<tr><td colspan="6" class="text-center">${keyword} 회원이 없습니다.</td></tr>`;
    return;
  }

  body.innerHTML = targetUsers
    .map(
      (u) => `
        <tr>
          <td>${u.login_id || u.id}</td>
          <td>${u.company_name || "-"}</td>
          <td>${Number(u.total_bid_count || 0).toLocaleString()}건 / ${formatCurrency(Number(u.total_bid_jpy || 0), "JPY")}</td>
          <td>${formatRecentBidText(u)}</td>
          <td><span class="status-badge ${u.is_active ? "active" : "inactive"}">${u.is_active ? "활성" : "비활성"}</span></td>
          <td>
            <button class="btn btn-action company-view-bids-btn" data-user-id="${u.id}">
              입찰내역
            </button>
            <button class="btn btn-action company-toggle-btn" data-id="${u.id}" data-login-id="${u.login_id || u.id}" data-next="${u.is_active ? "0" : "1"}">
              ${u.is_active ? "비활성화" : "활성화"}
            </button>
          </td>
        </tr>
      `,
    )
    .join("");

  document.querySelectorAll(".company-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", async function () {
      const id = this.dataset.id;
      const loginId = this.dataset.loginId;
      const next = this.dataset.next === "1";
      const label = next ? "활성화" : "비활성화";
      if (!confirm(`회원 '${loginId}'를 ${label}하시겠습니까?`)) return;
      try {
        await updateUser(id, { is_active: next });
        alert(`회원 '${loginId}' ${label} 완료`);
        await loadUsers();
      } catch (error) {
        handleError(error, "회원 상태 변경 중 오류가 발생했습니다.");
      }
    });
  });

  document.querySelectorAll(".company-view-bids-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      const userId = this.dataset.userId;
      if (!userId) return;
      openBidHistoryModal(userId);
    });
  });
}

// 회원 목록 렌더링
function renderUsers(users) {
  const tableBody = document.getElementById("usersTableBody");
  tableBody.innerHTML = "";

  users.forEach((user) => {
    const row = createElement("tr");

    // 날짜 형식 변환 - UTC 기준으로 날짜만 추출
    let registrationDate = formatDate(user.registration_date, true);

    // 회원 구분
    const accountType = user.account_type || "individual";
    const accountTypeText =
      accountType === "corporate"
        ? '<span class="badge badge-corporate">기업</span>'
        : '<span class="badge badge-individual">개인</span>';

    // 증빙 유형 배지
    const docType =
      user.document_type ||
      (accountType === "corporate" ? "taxinvoice" : "cashbill");
    const docTypeBadge =
      docType === "taxinvoice"
        ? '<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:#e8f4f8;color:#2980b9;border:1px solid #aed6f1;">세금계산서</span>'
        : '<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:#eafaf1;color:#27ae60;border:1px solid #a9dfbf;">현금영수증</span>';
    const accountTypeDisplay = `${accountTypeText}<br/><small style="margin-top:2px;display:inline-block;">${docTypeBadge}</small>`;

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
      <td>${user.login_id || user.id}</td>
      <td>${accountTypeDisplay}</td>
      <td>${balanceInfo}</td>
      <td>${registrationDate}</td>
      <td>${user.company_name || "-"}</td>
      <td>${Number(user.total_bid_count || 0).toLocaleString()}건 / ${formatCurrency(
        Number(user.total_bid_jpy || 0),
        "JPY",
      )}</td>
      <td>${user.address || "-"}</td>
      <td>${user.email || "-"}</td>
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
        <div class="cell-actions">
          <button class="btn btn-ghost btn-sm view-bids-btn" data-user-id="${user.id}">입찰내역</button>
          <button class="btn btn-ghost btn-sm edit-btn" data-id="${user.id}">수정</button>
          <button class="btn btn-ghost btn-sm btn-danger-ghost delete-btn" data-id="${user.id}">삭제</button>
        </div>
      </td>
    `;

    tableBody.appendChild(row);
  });

  // 수정 버튼 이벤트
  document.querySelectorAll(".view-bids-btn").forEach((button) => {
    button.addEventListener("click", function () {
      const userId = this.dataset.userId;
      if (!userId) return;
      openBidHistoryModal(userId);
    });
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
  const formatted = formatDate(dateString, true); // isUTC2KST=true
  return formatted === "-" ? "" : formatted;
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
    userId.value = user.login_id || user.id;
    userId.readOnly = false; // 아이디 수정 가능하게 변경
    userId.dataset.originalId = user.id; // 원본 DB ID 저장

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

    // 증빙 유형 설정
    const docType =
      user.document_type ||
      (accountType === "corporate" ? "taxinvoice" : "cashbill");
    const docTypeRadio = document.querySelector(
      `input[name="documentType"][value="${docType}"]`,
    );
    if (docTypeRadio) docTypeRadio.checked = true;
    window.documentTypeManuallySet = false;

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

    // 증빙 유형 초기값: 현금영수증 (개인 기본)
    const defaultDocRadio = document.querySelector(
      'input[name="documentType"][value="cashbill"]',
    );
    if (defaultDocRadio) defaultDocRadio.checked = true;
    window.documentTypeManuallySet = false;

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

  // 수동으로 증빙 유형을 바꾼 적 없으면 회원 구분에 맞게 자동 전환
  if (!window.documentTypeManuallySet) {
    const autoDocType = accountType === "corporate" ? "taxinvoice" : "cashbill";
    const radio = document.querySelector(
      `input[name="documentType"][value="${autoDocType}"]`,
    );
    if (radio) radio.checked = true;
  }
}

// 회원 저장 (등록 또는 수정)
async function saveUser() {
  try {
    const editMode = document.getElementById("editMode").value === "1";
    const userId = document.getElementById("userId");
    const id = userId.value;
    const originalId = userId.dataset.originalId; // 원본 DB ID (수정 시)
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

    // 증빙 유형
    const documentTypeRadio = document.querySelector(
      'input[name="documentType"]:checked',
    );
    const documentType = documentTypeRadio
      ? documentTypeRadio.value
      : "cashbill";

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
      document_type: documentType,
    };

    // 수정 모드일 때 login_id 변경 사항 추가
    if (editMode && originalId) {
      userData.new_login_id = id; // 새 login_id
    }

    // 비밀번호가 입력된 경우에만 포함
    if (password) {
      userData.password = password;
    }

    let response;
    if (editMode) {
      // 수정 - originalId를 사용하여 업데이트
      response = await updateUser(originalId, userData);

      // 예치금 설정 수정
      await window.API.fetchAPI("/deposits/admin/user-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: originalId,
          account_type: accountType,
          daily_limit: dailyLimit,
        }),
      });

      alert("회원 정보가 수정되었습니다.");
    } else {
      // 등록
      response = await createUser(userData);

      // 생성된 사용자의 DB ID 사용 (response.userId)
      const newUserId = response.userId;

      // 예치금 설정 초기화
      await window.API.fetchAPI("/deposits/admin/user-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: newUserId,
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
