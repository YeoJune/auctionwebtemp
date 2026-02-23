function el(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function formatAmount(v) {
  if (v === null || v === undefined || v === "") return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString();
}

const statusNameMap = {
  DOMESTIC_ARRIVED: "국내도착",
  REPAIR_TEAM_CHECKING: "내부수선중",
  REPAIR_TEAM_CHECK_IN_PROGRESS: "내부수선중",
  AUTH_IN_PROGRESS: "출고준비",
  INTERNAL_REPAIR_IN_PROGRESS: "내부수선중",
  EXTERNAL_REPAIR_IN_PROGRESS: "외부수선중",
  REPAIR_DONE: "수선완료",
  OUTBOUND_READY: "출고준비",
  SHIPPED: "출고됨",
  COMPLETED: "완료(운영 제외)",
};

const locationNameMap = {
  DOMESTIC_ARRIVAL_ZONE: "국내도착존",
  REPAIR_TEAM_CHECK_ZONE: "내부수선존",
  AUTH_ZONE: "출고존",
  INTERNAL_REPAIR_ZONE: "내부수선중존",
  EXTERNAL_REPAIR_ZONE: "외부수선중존",
  REPAIR_DONE_ZONE: "수선완료존",
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const ct = res.headers.get("content-type") || "";
  let data;

  if (ct.includes("application/json")) {
    data = await res.json();
  } else {
    const text = await res.text();
    throw new Error(`API 응답 오류(${res.status}): ${String(text).slice(0, 120)}`);
  }

  if (!res.ok || data.ok === false) throw new Error(data.message || "요청 실패");
  return data;
}

const state = {
  arrivals: [],
  cases: [],
  vendors: [],
  currentItem: null,
};

function getDecisionLabel(value) {
  return value === "EXTERNAL" ? "외부수선" : value === "INTERNAL" ? "내부수선" : "-";
}

function renderArrivals() {
  const body = el("arrivalsBody");
  const rows = state.arrivals;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="9" class="text-center">국내도착 물건이 없습니다.</td></tr>';
    return;
  }

  body.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td>${row.id}</td>
        <td>
          ${row.product_image ? `<img class="arrival-thumb" src="${escapeHtml(row.product_image)}" alt="상품 이미지" />` : "-"}
        </td>
        <td>${escapeHtml(row.internal_barcode || row.external_barcode || "-")}</td>
        <td>${escapeHtml(row.member_name || "-")}</td>
        <td>${escapeHtml(row.product_title || row.source_item_id || "-")}</td>
        <td>${formatDateTime(row.scheduled_at)}</td>
        <td>${escapeHtml(locationNameMap[row.current_location_code] || row.current_location_code || "-")}</td>
        <td>${escapeHtml(statusNameMap[row.current_status] || row.current_status || "-")}</td>
        <td><button class="btn btn-primary js-open-repair" data-item-id="${row.id}">수선제안</button></td>
      </tr>
    `,
    )
    .join("");

  document.querySelectorAll(".js-open-repair").forEach((btn) => {
    btn.addEventListener("click", () => {
      const itemId = Number(btn.dataset.itemId);
      const item = state.arrivals.find((x) => Number(x.id) === itemId);
      if (item) openModal(item);
    });
  });
}

function renderCases() {
  const body = el("casesBody");
  if (!state.cases.length) {
    body.innerHTML = '<tr><td colspan="9" class="text-center">수선 제안 데이터가 없습니다.</td></tr>';
    return;
  }

  body.innerHTML = state.cases
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.internal_barcode || "-")}</td>
        <td>${escapeHtml(row.member_name || "-")}</td>
        <td>${escapeHtml(row.product_title || "-")}</td>
        <td>${getDecisionLabel(row.decision_type)}</td>
        <td>${escapeHtml(row.vendor_name || "-")}</td>
        <td>${formatAmount(row.repair_amount)}</td>
        <td>${escapeHtml(row.updated_by || "-")}</td>
        <td>${formatDateTime(row.updated_at)}</td>
        <td><button class="btn btn-secondary js-copy-template" data-case-id="${row.id}">템플릿복사</button></td>
      </tr>
      `,
    )
    .join("");

  document.querySelectorAll(".js-copy-template").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const caseId = Number(btn.dataset.caseId);
      const item = state.cases.find((x) => Number(x.id) === caseId);
      if (!item?.proposal_text) {
        alert("복사할 템플릿이 없습니다.");
        return;
      }
      try {
        await navigator.clipboard.writeText(item.proposal_text);
        alert("템플릿이 복사되었습니다.");
      } catch (_) {
        alert("복사 실패: 텍스트를 수동 복사해주세요.");
      }
    });
  });
}

function fillVendorOptions(selected = "") {
  const sel = el("vendorName");
  sel.innerHTML = state.vendors
    .map((v) => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)}</option>`)
    .join("");
  if (selected && state.vendors.some((v) => v.name === selected)) {
    sel.value = selected;
  }
}

function openModal(item) {
  state.currentItem = item;
  el("metaBarcode").textContent = item.internal_barcode || "-";
  el("metaMember").textContent = item.member_name || "-";
  el("metaTitle").textContent = item.product_title || item.source_item_id || "-";
  el("metaScheduledAt").textContent = formatDateTime(item.scheduled_at);

  const isExternal = (item.decision_type || "").toUpperCase() === "EXTERNAL";
  el("decisionType").value = isExternal ? "EXTERNAL" : "INTERNAL";
  fillVendorOptions(item.vendor_name || "까사(내부)");

  el("repairAmount").value = item.repair_amount ?? "";
  el("repairNote").value = item.repair_note || "";
  el("internalNote").value = item.internal_note || "";
  el("proposalText").value = item.proposal_text || "";

  toggleVendorField();
  el("repairModal").classList.remove("hidden");
}

function closeModal() {
  state.currentItem = null;
  el("repairModal").classList.add("hidden");
}

function toggleVendorField() {
  const isExternal = el("decisionType").value === "EXTERNAL";
  el("vendorName").disabled = false;
  el("btnAddVendor").disabled = false;
  if (!isExternal) {
    el("vendorName").value = "까사(내부)";
  }
}

function formatMonthDayKR(dt) {
  if (!dt) return "";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return String(dt);
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

function buildTemplatePreview() {
  const item = state.currentItem;
  if (!item) return;

  const member = item.member_name || "회원사 미확인";
  const dateText = formatMonthDayKR(item.scheduled_at) || "(날짜 미확인)";
  const title = item.product_title || item.source_item_id || "상품명 미확인";
  const barcode = item.internal_barcode || "내부바코드 없음";
  const note = el("repairNote").value.trim() || "(수선내용 입력 필요)";
  const amountRaw = el("repairAmount").value.trim();
  const amount = amountRaw ? `${Number(amountRaw || 0).toLocaleString()}원 (vat 별도)` : "(금액 입력 필요)";
  const isExternal = el("decisionType").value === "EXTERNAL";
  const vendor = isExternal ? (el("vendorName").value || "(외주업체 선택 필요)") : "까사(내부)";

  const text = [
    member,
    `안녕하세요, ${dateText} 일 낙찰 상품 중`,
    "",
    `1. ${title}`,
    `내부바코드: ${barcode}`,
    "",
    "수선내용 :",
    `1. ${note}`,
    "",
    "소요기간 :",
    "",
    "수선금액 :",
    `1. ${amount}`,
    "",
    `총 합계: ${amount}`,
    "",
    "[외주 업체]",
    vendor,
    "",
    "진행 가능 여부 회신 부탁드립니다.",
    "감사합니다.",
  ].join("\n");

  el("proposalText").value = text;
}

async function loadArrivals() {
  const q = el("searchInput").value.trim();
  const data = await api(`/api/repair-management/domestic-arrivals?limit=500&q=${encodeURIComponent(q)}`);
  state.arrivals = data.items || [];
  renderArrivals();
}

async function loadCases() {
  const data = await api("/api/repair-management/cases");
  state.cases = data.cases || [];
  renderCases();
}

async function loadVendors() {
  const data = await api("/api/repair-management/vendors");
  state.vendors = data.vendors || [];
  if (!state.vendors.some((v) => v.name === "까사(내부)")) {
    state.vendors.unshift({ id: 0, name: "까사(내부)" });
  }
  fillVendorOptions();
}

async function saveRepairCase() {
  if (!state.currentItem) return;

  const payload = {
    itemId: state.currentItem.id,
    decisionType: el("decisionType").value,
    vendorName: el("vendorName").value,
    repairNote: el("repairNote").value.trim(),
    repairAmount: el("repairAmount").value.trim(),
    internalNote: el("internalNote").value.trim(),
  };

  await api("/api/repair-management/cases", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  alert("수선제안 저장 완료: 해당 물건이 수선 존으로 이동되었습니다.");
  closeModal();
  await Promise.all([loadArrivals(), loadCases()]);
}

async function addVendor() {
  const name = prompt("추가할 외주업체명을 입력하세요.");
  if (!name || !name.trim()) return;
  await api("/api/repair-management/vendors", {
    method: "POST",
    body: JSON.stringify({ name: name.trim() }),
  });
  await loadVendors();
  el("vendorName").value = name.trim();
}

async function copyTemplate() {
  const text = el("proposalText").value.trim();
  if (!text) return alert("복사할 템플릿이 없습니다.");
  try {
    await navigator.clipboard.writeText(text);
    alert("템플릿이 복사되었습니다.");
  } catch (_) {
    alert("복사 실패: 텍스트를 수동 복사해주세요.");
  }
}

function bindEvents() {
  el("logoutBtn").addEventListener("click", async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch (_) {}
    location.href = "/signinPage";
  });

  el("btnReload").addEventListener("click", loadArrivals);
  el("searchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadArrivals();
  });

  el("btnCloseModal").addEventListener("click", closeModal);
  el("repairModal").addEventListener("click", (e) => {
    if (e.target.id === "repairModal") closeModal();
  });

  el("decisionType").addEventListener("change", () => {
    toggleVendorField();
    buildTemplatePreview();
  });
  el("vendorName").addEventListener("change", buildTemplatePreview);
  el("repairNote").addEventListener("input", buildTemplatePreview);
  el("repairAmount").addEventListener("input", buildTemplatePreview);

  el("btnAddVendor").addEventListener("click", addVendor);
  el("btnCopyTemplate").addEventListener("click", copyTemplate);
  el("btnSaveRepair").addEventListener("click", saveRepairCase);
  el("btnExportCsv").addEventListener("click", () => {
    window.location.href = "/api/repair-management/export.csv";
  });
}

async function init() {
  try {
    bindEvents();
    await loadVendors();
    await Promise.all([loadArrivals(), loadCases()]);
  } catch (error) {
    console.error(error);
    alert(error.message || "수선관리 초기화 실패");
  }
}

document.addEventListener("DOMContentLoaded", init);
