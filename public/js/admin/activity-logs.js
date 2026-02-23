const logState = {
  page: 1,
  limit: 30,
  total: 0,
  filters: {
    actor: "",
    menu: "",
    action: "",
    dateFrom: "",
    dateTo: "",
  },
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function buildParams() {
  const params = new URLSearchParams();
  params.set("page", String(logState.page));
  params.set("limit", String(logState.limit));

  Object.entries(logState.filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });

  return params.toString();
}

function setSummary(total, page, limit) {
  const summary = document.getElementById("summaryText");
  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);
  summary.textContent = `총 ${total.toLocaleString()}건 · ${start.toLocaleString()}-${end.toLocaleString()} 표시`;
}

function statusBadge(statusCode) {
  const ok = Number(statusCode) < 400;
  const label = statusCode ? String(statusCode) : "-";
  return `<span class="status-badge ${ok ? "status-ok" : "status-err"}">${label}</span>`;
}

function renderRows(logs) {
  const tbody = document.getElementById("logsTableBody");
  if (!Array.isArray(logs) || logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">활동기록이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = logs
    .map((log) => {
      const actor = [log.actor_name, log.actor_login_id].filter(Boolean).join(" (") + (log.actor_name && log.actor_login_id ? ")" : "");
      const safeActor = actor || log.actor_login_id || "-";
      const target = [log.target_type, log.target_id].filter(Boolean).join("/") || "-";
      const menuText = log.action_menu || "-";
      const titleText = log.action_title || log.action_method || "-";
      const detailText = log.action_summary || log.action_label || "-";

      return `
        <tr>
          <td>${escapeHtml(formatDateTime(log.created_at))}</td>
          <td>${escapeHtml(safeActor)}</td>
          <td>${escapeHtml(menuText)}</td>
          <td>${escapeHtml(titleText)}</td>
          <td class="log-detail">${escapeHtml(detailText)}</td>
          <td>${escapeHtml(target)}</td>
          <td>${statusBadge(log.http_status)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderPagination() {
  const el = document.getElementById("pagination");
  const totalPages = Math.max(Math.ceil(logState.total / logState.limit), 1);
  const current = logState.page;

  const pages = [];
  const start = Math.max(1, current - 2);
  const end = Math.min(totalPages, current + 2);

  pages.push(`<button class="page-btn" data-page="${current - 1}" ${current <= 1 ? "disabled" : ""}>이전</button>`);
  for (let p = start; p <= end; p += 1) {
    pages.push(`<button class="page-btn ${p === current ? "active" : ""}" data-page="${p}">${p}</button>`);
  }
  pages.push(`<button class="page-btn" data-page="${current + 1}" ${current >= totalPages ? "disabled" : ""}>다음</button>`);

  el.innerHTML = pages.join("");

  el.querySelectorAll(".page-btn[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      const next = Number(btn.dataset.page);
      if (Number.isNaN(next) || next < 1 || next > totalPages) return;
      logState.page = next;
      loadLogs();
    });
  });
}

async function loadLogs() {
  const tbody = document.getElementById("logsTableBody");
  tbody.innerHTML = '<tr><td colspan="8" class="text-center">데이터를 불러오는 중입니다...</td></tr>';

  try {
    const query = buildParams();
    const data = await window.API.fetchAPI(`/admin/activity-logs?${query}`);
    const logs = data?.logs || [];
    const pagination = data?.pagination || {};

    logState.total = Number(pagination.total || 0);
    logState.page = Number(pagination.page || logState.page || 1);
    logState.limit = Number(pagination.limit || logState.limit || 30);

    renderRows(logs);
    renderPagination();
    setSummary(logState.total, logState.page, logState.limit);
  } catch (error) {
    console.error("활동기록 로딩 실패:", error);
    tbody.innerHTML = `<tr><td colspan="8" class="text-center">${escapeHtml(error.message || "조회 실패")}</td></tr>`;
    document.getElementById("summaryText").textContent = "조회 실패";
    document.getElementById("pagination").innerHTML = "";
  }
}

function bindFilters() {
  const actorInput = document.getElementById("actorInput");
  const menuSelect = document.getElementById("menuSelect");
  const actionInput = document.getElementById("actionInput");
  const dateFromInput = document.getElementById("dateFromInput");
  const dateToInput = document.getElementById("dateToInput");

  document.getElementById("searchBtn").addEventListener("click", () => {
    logState.filters.actor = actorInput.value.trim();
    logState.filters.menu = menuSelect.value;
    logState.filters.action = actionInput.value.trim();
    logState.filters.dateFrom = dateFromInput.value;
    logState.filters.dateTo = dateToInput.value;
    logState.page = 1;
    loadLogs();
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    actorInput.value = "";
    menuSelect.value = "";
    actionInput.value = "";
    dateFromInput.value = "";
    dateToInput.value = "";
    logState.filters = {
      actor: "",
      menu: "",
      action: "",
      dateFrom: "",
      dateTo: "",
    };
    logState.page = 1;
    loadLogs();
  });

  [actorInput, actionInput].forEach((el) => {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        document.getElementById("searchBtn").click();
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  bindFilters();
  await loadLogs();
});
