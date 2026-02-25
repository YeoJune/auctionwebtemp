const CASE_STATE = {
  ARRIVED: "ARRIVED",
  DRAFT: "DRAFT",
  READY_TO_SEND: "READY_TO_SEND",
  PROPOSED: "PROPOSED",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  DONE: "DONE",
};

const CASE_STATE_LABEL = {
  ARRIVED: "국내도착/분기대기",
  DRAFT: "시트전송완료/견적대기",
  READY_TO_SEND: "견적완료/고객전송대기",
  PROPOSED: "고객응답대기",
  ACCEPTED: "진행중",
  REJECTED: "거절",
  DONE: "완료",
};

const REPAIR_STAGE = {
  DOMESTIC: "DOMESTIC",
  EXTERNAL_WAITING: "EXTERNAL_WAITING",
  READY_TO_SEND: "READY_TO_SEND",
  PROPOSED: "PROPOSED",
  IN_PROGRESS: "IN_PROGRESS",
};

const REPAIR_STAGE_LABEL = {
  [REPAIR_STAGE.DOMESTIC]: "1) 국내도착",
  [REPAIR_STAGE.EXTERNAL_WAITING]: "2) 시트전송완료/견적대기",
  [REPAIR_STAGE.READY_TO_SEND]: "3) 견적완료/고객전송대기",
  [REPAIR_STAGE.PROPOSED]: "4) 고객응답대기",
  [REPAIR_STAGE.IN_PROGRESS]: "5) 진행중",
};

const LOCATION_LABEL = {
  DOMESTIC_ARRIVAL_ZONE: "국내도착존",
  INTERNAL_REPAIR_ZONE: "내부수선존",
  EXTERNAL_REPAIR_ZONE: "외부수선존",
  REPAIR_DONE_ZONE: "수선완료존",
  OUTBOUND_ZONE: "출고존",
};

const state = {
  vendors: [],
  arrivals: [],
  cases: [],
  keyword: "",
  currentItem: null,
  currentCase: null,
};
let autoQuoteSyncInFlight = false;
let autoQuoteSyncTimer = null;
const AUTO_QUOTE_SYNC_INTERVAL_MS = 8000;
let detailImages = [];
let detailImageIndex = 0;

function el(id) {
  return document.getElementById(id);
}

async function api(path, options = {}) {
  const normalizedPath = String(path || "").startsWith("/api/")
    ? String(path).replace(/^\/api/, "")
    : path;

  if (window.API?.fetchAPI) {
    return window.API.fetchAPI(normalizedPath, options);
  }

  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || `요청 실패 (${response.status})`);
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
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
    hour12: false,
  });
}

function formatAmount(value) {
  if (value === null || value === undefined || value === "") return "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${Math.round(n).toLocaleString()}원`;
}

function decisionLabel(value) {
  if (value === "EXTERNAL") return "외부";
  if (value === "INTERNAL") return "내부";
  if (value === "NONE") return "무수선";
  return "-";
}

function locationLabel(value) {
  return LOCATION_LABEL[value] || value || "-";
}

function renderDecisionCell(decisionType, vendorName = "") {
  const type = String(decisionType || "").toUpperCase();
  if (type === "EXTERNAL") {
    const vendor = String(vendorName || "").trim() || "업체미지정";
    return `
      <div class="decision-cell">
        <span class="decision-badge decision-external">외부</span>
        <div class="decision-vendor">${escapeHtml(vendor)}</div>
      </div>
    `;
  }
  if (type === "INTERNAL") {
    return `
      <div class="decision-cell">
        <span class="decision-badge decision-internal">내부</span>
      </div>
    `;
  }
  return `
    <div class="decision-cell">
      <span class="decision-badge decision-none">미지정</span>
    </div>
  `;
}

function getCaseByItemId(itemId) {
  return state.cases.find((c) => Number(c.item_id) === Number(itemId)) || null;
}

function imageTag(src, title) {
  const safeSrc = src || "/images/no-image.png";
  return `<img class="table-thumb" src="${escapeHtml(safeSrc)}" alt="${escapeHtml(title || "상품")}">`;
}

function parseAdditionalInfo(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function buildOriginLink(itemId, aucNum, additionalInfoRaw) {
  const item = String(itemId || "").trim();
  const auctionNo = Number(aucNum);
  if (!item || !auctionNo) return "#";
  const additionalInfo = parseAdditionalInfo(additionalInfoRaw);
  if (auctionNo === 1) {
    return `https://www.ecoauc.com/client/auction-items/view/${item}`;
  }
  if (auctionNo === 2) {
    return `https://bid.brand-auc.com/items/detail?uketsukeBng=${item}`;
  }
  if (auctionNo === 3) {
    return `https://www.starbuyers-global-auction.com/item/${item}`;
  }
  if (auctionNo === 4) {
    return `https://auction.mekiki.ai/en/auction/${additionalInfo?.event_id || ""}/${item}`;
  }
  if (auctionNo === 5) {
    return `https://penguin-auction.jp/product/detail/${item}/`;
  }
  return "#";
}

function renderItemOpenButton(row, text) {
  const sourceItemId = String(row?.source_item_id || "").trim();
  const label = escapeHtml(text || "-");
  if (!sourceItemId) return label;
  const originUrl = buildOriginLink(sourceItemId, row?.auc_num, row?.additional_info);
  return `
    <button
      type="button"
      class="item-open-link js-open-item-detail"
      data-item-id="${escapeHtml(sourceItemId)}"
      data-auc-num="${escapeHtml(row?.auc_num || "")}"
      data-title="${escapeHtml(row?.product_title || "-")}"
      data-brand="${escapeHtml(row?.brand || "-")}"
      data-category="${escapeHtml(row?.category || "-")}"
      data-rank="${escapeHtml(row?.rank || "-")}"
      data-accessory-code="${escapeHtml(row?.accessory_code || "-")}"
      data-scheduled="${escapeHtml(formatDateTime(row?.scheduled_at))}"
      data-image="${escapeHtml(row?.product_image || "/images/no-image.png")}"
      data-origin-url="${escapeHtml(originUrl)}"
    >
      ${label}
    </button>
  `;
}

const LEADING_ITEM_CODE_RE =
  /^(?:\(\s*\d+(?:[_-]\d+)+\s*\)|\[\s*\d+(?:[_-]\d+)+\s*\]|\d+(?:[_-]\d+)+)\s*/;

function sanitizeProductTitle(title) {
  let value = String(title || "").trim();
  while (true) {
    const next = value.replace(LEADING_ITEM_CODE_RE, "").trim();
    if (next === value) break;
    value = next;
  }
  return value || "상품명 미확인";
}

function getSearchFilteredRows(rows) {
  const k = String(state.keyword || "").trim().toLowerCase();
  if (!k) return rows;
  return rows.filter((row) => {
    const text = [
      row.internal_barcode,
      row.member_name,
      row.product_title,
      row.vendor_name,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return text.includes(k);
  });
}

function getArrivalCaseInfo(row) {
  return getCaseByItemId(row.id) || row;
}

function getRepairStageCode(row = {}) {
  const caseState = String(row.case_state || "").trim().toUpperCase();
  const decisionType = String(row.decision_type || "").trim().toUpperCase();
  const zoneCode = String(row.current_location_code || "").trim().toUpperCase();

  if (
    ["INTERNAL_REPAIR_ZONE", "EXTERNAL_REPAIR_ZONE", "REPAIR_DONE_ZONE", "OUTBOUND_ZONE"].includes(zoneCode) ||
    [CASE_STATE.ACCEPTED, CASE_STATE.DONE].includes(caseState)
  ) {
    return REPAIR_STAGE.IN_PROGRESS;
  }
  if (caseState === CASE_STATE.PROPOSED) return REPAIR_STAGE.PROPOSED;
  if ([CASE_STATE.READY_TO_SEND, CASE_STATE.REJECTED].includes(caseState)) {
    return REPAIR_STAGE.READY_TO_SEND;
  }
  if (decisionType === "EXTERNAL" && caseState === CASE_STATE.DRAFT) {
    return REPAIR_STAGE.EXTERNAL_WAITING;
  }
  return REPAIR_STAGE.DOMESTIC;
}

function renderStageChangeControl(itemId, currentStage) {
  const numericItemId = Number(itemId || 0);
  if (!numericItemId) return "";
  const options = [
    REPAIR_STAGE.DOMESTIC,
    REPAIR_STAGE.EXTERNAL_WAITING,
    REPAIR_STAGE.READY_TO_SEND,
    REPAIR_STAGE.PROPOSED,
    REPAIR_STAGE.IN_PROGRESS,
  ]
    .map(
      (stage) =>
        `<option value="${stage}"${stage === currentStage ? " selected" : ""}>${REPAIR_STAGE_LABEL[stage]}</option>`,
    )
    .join("");

  return `
    <div class="stage-change-inline">
      <select class="js-stage-select" data-item-id="${numericItemId}">
        ${options}
      </select>
      <button class="btn btn-sm btn-secondary js-stage-change" data-item-id="${numericItemId}">단계변경</button>
    </div>
  `;
}

function getArrivalCaseState(row) {
  return String(getArrivalCaseInfo(row)?.case_state || "")
    .trim()
    .toUpperCase();
}

function externalSheetStateLabel(caseInfo) {
  if (caseInfo?.decision_type !== "EXTERNAL") return "-";
  if (caseInfo.external_synced_at) return "견적동기화완료";
  if (caseInfo.external_sent_at) return "시트전송완료/견적대기";
  if (caseInfo.vendor_sheet_url) return "시트연결됨/미전송";
  return "시트미연결";
}

function bindArrivalActions(tbody) {
  tbody.querySelectorAll(".js-open-internal").forEach((btn) => {
    btn.addEventListener("click", () => openModalByItem(btn.dataset.itemId, "INTERNAL"));
  });
  tbody.querySelectorAll(".js-open-external").forEach((btn) => {
    btn.addEventListener("click", () => openModalByItem(btn.dataset.itemId, "EXTERNAL"));
  });
  tbody.querySelectorAll(".js-send-external").forEach((btn) => {
    btn.addEventListener("click", () => sendExternalByItem(btn.dataset.itemId, btn));
  });
  tbody.querySelectorAll(".js-sync-external").forEach((btn) => {
    btn.addEventListener("click", () => syncExternalByItem(btn.dataset.itemId, btn));
  });
  tbody.querySelectorAll(".js-copy-template-case").forEach((btn) => {
    btn.addEventListener("click", () => copyTemplateByCase(btn.dataset.caseId));
  });
}

function bindCommonRowActions(tbody) {
  tbody.querySelectorAll(".js-open-item-detail").forEach((btn) => {
    btn.addEventListener("click", () => openRepairItemDetail(btn));
  });
  tbody.querySelectorAll(".js-stage-change").forEach((btn) => {
    btn.addEventListener("click", () => {
      const itemId = Number(btn.dataset.itemId || 0);
      const select = tbody.querySelector(
        `.js-stage-select[data-item-id="${itemId}"]`,
      );
      const nextStage = select?.value || "";
      changeRepairStage(itemId, nextStage, btn);
    });
  });
}

function renderArrivalRows(tbody, rows, emptyText, options = {}) {
  const isDraftSection = options?.isDraftSection === true;
  const mode = options?.mode === "draft" ? "draft" : "domestic";
  const emptyColspan = mode === "draft" ? 10 : 7;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${emptyColspan}" class="text-center">${escapeHtml(emptyText)}</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((row) => {
      const caseInfo = getArrivalCaseInfo(row);
      const isExternal = caseInfo.decision_type === "EXTERNAL";
      const isInternal = caseInfo.decision_type === "INTERNAL";
      const caseId = caseInfo.repair_case_id || caseInfo.id;
      const sheetState = externalSheetStateLabel(caseInfo);
      const stageControl = renderStageChangeControl(
        row.id,
        getRepairStageCode(caseInfo),
      );

      const actionButtons = [];

      if (isExternal) {
        actionButtons.push(
          `<button class="btn btn-sm btn-secondary js-open-external" data-item-id="${row.id}">외부수선수정</button>`,
        );
        if (!caseInfo.external_sent_at || !isDraftSection) {
          actionButtons.push(
            `<button class="btn btn-sm btn-secondary js-send-external" data-item-id="${row.id}">외주시트전송</button>`,
          );
        } else if (isDraftSection) {
          actionButtons.push(
            `<button class="btn btn-sm btn-secondary js-sync-external" data-item-id="${row.id}">외주시트동기화</button>`,
          );
        }
      } else if (isInternal) {
        actionButtons.push(
          `<button class="btn btn-sm btn-secondary js-open-internal" data-item-id="${row.id}">내부수선수정</button>`,
        );
      } else {
        actionButtons.push(
          `<button class="btn btn-sm btn-secondary js-open-internal" data-item-id="${row.id}">내부수선</button>`,
        );
        actionButtons.push(
          `<button class="btn btn-sm btn-secondary js-open-external" data-item-id="${row.id}">외부수선</button>`,
        );
      }

      const commonCols = `
        <td>${imageTag(row.product_image, row.product_title)}</td>
        <td>${renderItemOpenButton(row, row.internal_barcode || "-")}</td>
        <td>${escapeHtml(row.member_name || "-")}</td>
        <td>${renderItemOpenButton(row, row.product_title || "-")}</td>
        <td>${escapeHtml(formatDateTime(row.scheduled_at))}</td>
      `;

      const stageCols =
        mode === "draft"
          ? `
        <td>${renderDecisionCell(caseInfo.decision_type, caseInfo.vendor_name)}</td>
        <td>${escapeHtml(caseInfo.decision_type === "EXTERNAL" ? caseInfo.vendor_name || "-" : "-")}</td>
        <td>${escapeHtml(sheetState)}</td>
      `
          : "";

      return `
      <tr>
        ${commonCols}
        ${stageCols}
        <td>${escapeHtml(CASE_STATE_LABEL[caseInfo.case_state] || "미작성")}</td>
        <td>
          <div class="cell-actions">
            ${actionButtons.join("")}
          </div>
          ${stageControl}
        </td>
      </tr>
    `;
    })
    .join("");

  bindArrivalActions(tbody);
  bindCommonRowActions(tbody);
}

function renderDomesticArrivals() {
  const tbody = el("domesticArrivalsBody");
  const rows = getSearchFilteredRows(state.arrivals || []).filter((row) => {
    const caseInfo = getArrivalCaseInfo(row);
    return getRepairStageCode(caseInfo) === REPAIR_STAGE.DOMESTIC;
  });
  renderArrivalRows(tbody, rows, "국내도착(미작성) 데이터가 없습니다.", {
    mode: "domestic",
  });
}

function renderDraftCases() {
  const tbody = el("draftCasesBody");
  const rows = getSearchFilteredRows(state.arrivals || []).filter((row) => {
    const caseInfo = getArrivalCaseInfo(row);
    return getRepairStageCode(caseInfo) === REPAIR_STAGE.EXTERNAL_WAITING;
  });
  renderArrivalRows(tbody, rows, "시트전송완료/견적대기 데이터가 없습니다.", {
    isDraftSection: true,
    mode: "draft",
  });
}

function renderReadyToSendCases() {
  const tbody = el("readyToSendCasesBody");
  const rows = getSearchFilteredRows(state.cases || []).filter(
    (row) => getRepairStageCode(row) === REPAIR_STAGE.READY_TO_SEND,
  );

  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="10" class="text-center">견적완료/고객전송대기 데이터가 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map((row) => {
      const stageControl = renderStageChangeControl(
        row.item_id,
        getRepairStageCode(row),
      );
      return `
      <tr>
        <td>${imageTag(row.product_image, row.product_title)}</td>
        <td>${renderItemOpenButton(row, row.internal_barcode || "-")}</td>
        <td>${escapeHtml(row.member_name || "-")}</td>
        <td>${renderItemOpenButton(row, row.product_title || "-")}</td>
        <td>${renderDecisionCell(row.decision_type, row.vendor_name)}</td>
        <td>${escapeHtml(formatAmount(row.repair_amount))}</td>
        <td>${escapeHtml(row.repair_eta || "-")}</td>
        <td>${escapeHtml(CASE_STATE_LABEL[row.case_state] || "-")}</td>
        <td>${escapeHtml(locationLabel(row.current_location_code))}</td>
        <td>
          <div class="cell-actions">
            <button class="btn btn-sm btn-secondary js-open-ready-edit" data-case-id="${row.id}">수선정보수정</button>
            <button class="btn btn-sm btn-secondary js-copy-template-case" data-case-id="${row.id}">템플릿복사</button>
            <button class="btn btn-sm btn-primary js-mark-sent" data-case-id="${row.id}">전송완료</button>
          </div>
          ${stageControl}
        </td>
      </tr>
    `;
    })
    .join("");

  tbody.querySelectorAll(".js-open-ready-edit").forEach((btn) => {
    btn.addEventListener("click", () => openModalByCase(btn.dataset.caseId));
  });
  tbody.querySelectorAll(".js-copy-template-case").forEach((btn) => {
    btn.addEventListener("click", () => copyTemplateByCase(btn.dataset.caseId));
  });
  tbody.querySelectorAll(".js-mark-sent").forEach((btn) => {
    btn.addEventListener("click", () => markSentCase(btn.dataset.caseId));
  });
  bindCommonRowActions(tbody);
}

function renderProposedCases() {
  const tbody = el("proposedCasesBody");
  const rows = getSearchFilteredRows(state.cases || []).filter(
    (row) => getRepairStageCode(row) === REPAIR_STAGE.PROPOSED,
  );
  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="9" class="text-center">고객응답대기 데이터가 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map((row) => {
      const stageControl = renderStageChangeControl(
        row.item_id,
        getRepairStageCode(row),
      );
      return `
      <tr>
        <td>${imageTag(row.product_image, row.product_title)}</td>
        <td>${renderItemOpenButton(row, row.internal_barcode || "-")}</td>
        <td>${escapeHtml(row.member_name || "-")}</td>
        <td>${renderItemOpenButton(row, row.product_title || "-")}</td>
        <td>${renderDecisionCell(row.decision_type, row.vendor_name)}</td>
        <td>${escapeHtml(formatAmount(row.repair_amount))}</td>
        <td>${escapeHtml(formatDateTime(row.proposed_at || row.updated_at))}</td>
        <td>${escapeHtml(locationLabel(row.current_location_code))}</td>
        <td>
          <div class="cell-actions">
            <button class="btn btn-sm btn-primary js-accept" data-case-id="${row.id}">수락처리</button>
            <button class="btn btn-sm btn-secondary js-reject" data-case-id="${row.id}">거절</button>
          </div>
          ${stageControl}
        </td>
      </tr>
    `;
    })
    .join("");

  tbody.querySelectorAll(".js-accept").forEach((btn) => {
    btn.addEventListener("click", () => acceptCase(btn.dataset.caseId));
  });
  tbody.querySelectorAll(".js-reject").forEach((btn) => {
    btn.addEventListener("click", () => rejectCase(btn.dataset.caseId));
  });
  bindCommonRowActions(tbody);
}

function renderInProgressCases() {
  const tbody = el("inProgressCasesBody");
  const rows = getSearchFilteredRows(state.cases || []).filter(
    (row) => getRepairStageCode(row) === REPAIR_STAGE.IN_PROGRESS,
  );
  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="9" class="text-center">진행중 데이터가 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map((row) => {
      const allowRepairDone =
        row.case_state === CASE_STATE.ACCEPTED &&
        !["REPAIR_DONE_ZONE", "OUTBOUND_ZONE"].includes(row.current_location_code);
      const allowShip = row.current_location_code !== "OUTBOUND_ZONE";
      const stageControl = renderStageChangeControl(
        row.item_id,
        getRepairStageCode(row),
      );

      return `
      <tr>
        <td>${imageTag(row.product_image, row.product_title)}</td>
        <td>${renderItemOpenButton(row, row.internal_barcode || "-")}</td>
        <td>${escapeHtml(row.member_name || "-")}</td>
        <td>${renderItemOpenButton(row, row.product_title || "-")}</td>
        <td>${renderDecisionCell(row.decision_type, row.vendor_name)}</td>
        <td>${escapeHtml(formatAmount(row.repair_amount))}</td>
        <td>${escapeHtml(CASE_STATE_LABEL[row.case_state] || "-")}</td>
        <td>${escapeHtml(locationLabel(row.current_location_code))}</td>
        <td>
          <div class="cell-actions">
            ${
              allowRepairDone
                ? `<button class="btn btn-sm btn-secondary js-repair-done" data-case-id="${row.id}">수선완료</button>`
                : '<span class="muted">-</span>'
            }
            ${
              allowShip
                ? `<button class="btn btn-sm btn-primary js-ship-done" data-case-id="${row.id}">출고완료</button>`
                : '<span class="muted">출고완료</span>'
            }
          </div>
          ${stageControl}
        </td>
      </tr>
    `;
    })
    .join("");

  tbody.querySelectorAll(".js-repair-done").forEach((btn) => {
    btn.addEventListener("click", () => markRepairDone(btn.dataset.caseId));
  });
  tbody.querySelectorAll(".js-ship-done").forEach((btn) => {
    btn.addEventListener("click", () => markShipped(btn.dataset.caseId));
  });
  bindCommonRowActions(tbody);
}

function renderAll() {
  renderVendors();
  renderDomesticArrivals();
  renderDraftCases();
  renderReadyToSendCases();
  renderProposedCases();
  renderInProgressCases();
}

function setVendorManagementCollapsed(collapsed) {
  const body = el("vendorManagementBody");
  const btn = el("btnToggleVendorManagement");
  if (!body || !btn) return;
  body.style.display = collapsed ? "none" : "block";
  btn.textContent = collapsed ? "펼치기" : "접기";
}

function extractSheetId(url) {
  const text = String(url || "");
  const m = text.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m?.[1] || "-";
}

function extractSheetGid(url) {
  const text = String(url || "");
  const m = text.match(/[?&#]gid=([0-9]+)/);
  return m?.[1] || "-";
}

function renderVendors() {
  const tbody = el("vendorsBody");
  if (!tbody) return;

  const vendors = (state.vendors || []).filter((v) => v.name !== "까사(내부)");
  if (!vendors.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">등록된 외주업체가 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = vendors
    .map((v) => {
      const vendorId = Number(v.id || 0);
      const sheetUrl = v.sheet_url || "";
      const sheetId = v.sheet_id || extractSheetId(sheetUrl);
      const sheetGid = v.sheet_gid || extractSheetGid(sheetUrl);
      return `
        <tr>
          <td>
            <input
              type="text"
              class="js-vendor-name"
              data-vendor-id="${vendorId}"
              value="${escapeHtml(v.name || "")}"
              placeholder="업체명"
            />
          </td>
          <td>
            <input
              type="text"
              class="js-vendor-sheet-url"
              data-vendor-id="${vendorId}"
              value="${escapeHtml(sheetUrl)}"
              placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=..."
            />
          </td>
          <td>${escapeHtml(sheetId || "-")}</td>
          <td>${escapeHtml(sheetGid || "-")}</td>
          <td>
            <button
              class="btn btn-sm btn-primary js-save-vendor"
              data-vendor-id="${vendorId}"
            >
              저장
            </button>
            <button
              class="btn btn-sm btn-secondary js-delete-vendor"
              data-vendor-id="${vendorId}"
            >
              삭제
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll(".js-save-vendor").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const vendorId = Number(btn.dataset.vendorId || 0);
      const nameInput = tbody.querySelector(`.js-vendor-name[data-vendor-id="${vendorId}"]`);
      const input = tbody.querySelector(
        `.js-vendor-sheet-url[data-vendor-id="${vendorId}"]`,
      );
      const vendorName = nameInput?.value?.trim() || "";
      const sheetUrl = input?.value?.trim() || "";

      if (!vendorName) {
        alert("업체명을 입력하세요.");
        return;
      }
      btn.disabled = true;
      try {
        await api(`/api/repair-management/vendors/${vendorId}`, {
          method: "PUT",
          body: JSON.stringify({ name: vendorName, sheetUrl }),
        });
        await loadAll();
        alert(`외주업체 [${vendorName}]가 저장되었습니다.`);
      } catch (error) {
        alert(error.message || "외주업체 저장 중 오류가 발생했습니다.");
      } finally {
        btn.disabled = false;
      }
    });
  });

  tbody.querySelectorAll(".js-delete-vendor").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const vendorId = Number(btn.dataset.vendorId || 0);
      const nameInput = tbody.querySelector(`.js-vendor-name[data-vendor-id="${vendorId}"]`);
      const vendorName = nameInput?.value?.trim() || "해당 업체";
      if (!confirm(`외주업체 [${vendorName}]를 삭제할까요?`)) return;

      btn.disabled = true;
      try {
        await api(`/api/repair-management/vendors/${vendorId}`, {
          method: "DELETE",
        });
        await loadAll();
        alert(`외주업체 [${vendorName}]가 삭제되었습니다.`);
      } catch (error) {
        alert(error.message || "외주업체 삭제 중 오류가 발생했습니다.");
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function fillVendorOptions(selected = "") {
  const sel = el("vendorName");
  const vendors = state.vendors.filter((v) => v.name !== "까사(내부)");
  const hasSelected = selected && vendors.some((v) => v.name === selected);
  const options = hasSelected ? vendors : selected ? [...vendors, { name: selected }] : vendors;
  if (!options.length) {
    sel.innerHTML = '<option value="">외주업체 없음</option>';
    return;
  }
  sel.innerHTML = options
    .map((v) => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)}</option>`)
    .join("");
  if (selected && options.some((v) => v.name === selected)) {
    sel.value = selected;
  }
}

function toggleVendorField() {
  const isExternal = el("decisionType").value === "EXTERNAL";
  el("vendorField").style.display = isExternal ? "block" : "none";
  el("amountField").style.display = isExternal ? "none" : "block";
  el("etaField").style.display = isExternal ? "none" : "block";
  el("internalNoteField").style.display = isExternal ? "none" : "block";
  el("externalGuide").style.display = isExternal ? "block" : "none";

  const hasAmount = String(el("repairAmount").value || "").trim().length > 0;
  const saveBtn = el("btnSaveDraft");
  const proposeBtn = el("btnSaveProposal");

  saveBtn.textContent = isExternal ? "외부 수선 시트로 전송" : "내부수선 저장";
  if (proposeBtn && isExternal && !hasAmount) {
    proposeBtn.disabled = true;
    proposeBtn.title = "외주시트동기화로 견적 반영 후 제안등록 가능합니다.";
  } else if (proposeBtn) {
    proposeBtn.disabled = false;
    proposeBtn.title = "";
  }
}

function buildProposalPreview() {
  const item = state.currentItem;
  if (!item) return;
  const isExternal = el("decisionType").value === "EXTERNAL";
  const note = el("repairNote").value.trim() || "(수선내용 입력 필요)";
  const amountValue = el("repairAmount").value.trim();
  const etaValue = el("repairEta").value.trim();
  const amountText = amountValue
    ? `${Number(amountValue).toLocaleString()}원 (vat 별도)`
    : isExternal
      ? "(외주 견적 회신 후 자동반영)"
      : "(금액 입력 필요)";
  const etaText = etaValue || "(소요기간 입력 필요)";
  const safeDate = item.scheduled_at
    ? (() => {
        const d = new Date(item.scheduled_at);
        if (Number.isNaN(d.getTime())) return "(날짜 미확인)";
        return `${d.getMonth() + 1}.${d.getDate()}`;
      })()
    : "(날짜 미확인)";
  const safeTitle = sanitizeProductTitle(item.product_title);

  el("proposalText").value = [
    `${item.member_name || "회원사 미확인"}`,
    `안녕하세요, ${safeDate} 일 낙찰 상품 중`,
    "",
    `${safeTitle}`,
    "",
    "수선내용 :",
    `${note}`,
    "",
    "소요기간 :",
    `${etaText}`,
    "",
    "수선금액 :",
    `${amountText}`,
    "",
    "진행 여부 회신 부탁드립니다.",
    "감사합니다.",
  ].join("\n");
}

function openModal(item, caseRow = null, forceDecision = "") {
  state.currentItem = item;
  state.currentCase = caseRow;

  el("repairModalTitle").textContent = caseRow ? "수선 제안 수정" : "수선 정보 등록";
  el("metaImage").src = item.product_image || "/images/no-image.png";
  el("metaBarcode").textContent = item.internal_barcode || "-";
  el("metaMember").textContent = item.member_name || "-";
  el("metaTitle").textContent = item.product_title || "-";
  el("metaScheduledAt").textContent = formatDateTime(item.scheduled_at);

  fillVendorOptions(caseRow?.vendor_name || item.vendor_name || "");
  el("decisionType").value = forceDecision || caseRow?.decision_type || item.decision_type || "INTERNAL";
  el("repairAmount").value = caseRow?.repair_amount ?? item.repair_amount ?? "";
  el("repairEta").value = caseRow?.repair_eta || item.repair_eta || "";
  el("repairNote").value = caseRow?.repair_note || item.repair_note || "";
  el("internalNote").value = caseRow?.internal_note || item.internal_note || "";

  toggleVendorField();
  buildProposalPreview();
  el("repairModal").classList.remove("hidden");
}

function closeModal() {
  state.currentItem = null;
  state.currentCase = null;
  el("repairModal").classList.add("hidden");
}

async function saveCase(action = "save") {
  if (!state.currentItem) return;
  const payload = {
    itemId: state.currentItem.item_id || state.currentItem.id,
    decisionType: el("decisionType").value,
    vendorName: el("vendorName").value,
    repairAmount: el("repairAmount").value.trim(),
    repairEta: el("repairEta").value.trim(),
    repairNote: el("repairNote").value.trim(),
    internalNote: el("internalNote").value.trim(),
    action,
  };

  if (payload.decisionType === "EXTERNAL" && !payload.vendorName) {
    alert("외부수선은 외주업체를 선택해야 합니다.");
    return;
  }
  const isPropose = action === "propose";
  if ((payload.decisionType === "INTERNAL" || isPropose) && !payload.repairAmount) {
    alert("견적금액을 입력하세요.");
    return;
  }

  const response = await api("/api/repair-management/cases", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  alert(response.message || "저장되었습니다.");
  closeModal();
  await loadAll();
}

async function registerProposalByItem(itemId) {
  const item = state.arrivals.find((r) => Number(r.id) === Number(itemId));
  if (!item) return;
  const caseRow = getCaseByItemId(item.id) || item;
  if (caseRow.decision_type === "NONE") {
    alert("무수선 건은 제안등록 대상이 아닙니다.");
    return;
  }
  if (!caseRow.decision_type || !caseRow.repair_amount) {
    openModal(item, caseRow);
    return;
  }

  await api("/api/repair-management/cases", {
    method: "POST",
    body: JSON.stringify({
      itemId: item.id,
      decisionType: caseRow.decision_type,
      vendorName: caseRow.vendor_name,
      repairAmount: caseRow.repair_amount,
      repairEta: caseRow.repair_eta || "",
      repairNote: caseRow.repair_note || "",
      internalNote: caseRow.internal_note || "",
      action: "propose",
    }),
  });
  alert("제안등록 완료 (국내도착 유지)");
  await loadAll();
}

async function sendExternalByItem(itemId, triggerBtn = null) {
  const item = state.arrivals.find((r) => Number(r.id) === Number(itemId));
  const caseRow = getCaseByItemId(itemId) || item;
  if (!caseRow?.repair_case_id && !caseRow?.id) {
    openModal(item, caseRow, "EXTERNAL");
    alert("외주시트 전송을 위해 먼저 외부수선 정보(업체/요청내용)를 저장하세요.");
    return;
  }
  if (caseRow?.decision_type !== "EXTERNAL") {
    openModal(item, caseRow, "EXTERNAL");
    alert("외주시트 전송은 처리구분이 '외부'인 건에서만 가능합니다.");
    return;
  }

  const caseId = caseRow.repair_case_id || caseRow.id;
  const prevText = triggerBtn?.textContent;
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = "전송중...";
  }
  try {
    const result = await api(`/api/repair-management/cases/${caseId}/push-external-sheet`, {
      method: "POST",
    });
    alert(result.message || "외주시트 전송 완료");
    await loadAll();
  } catch (error) {
    alert(error.message || "외주시트 전송 중 오류가 발생했습니다.");
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = prevText || "외주시트전송";
    }
  }
}

async function syncExternalByItem(itemId, triggerBtn = null) {
  const item = state.arrivals.find((r) => Number(r.id) === Number(itemId));
  const caseRow = getCaseByItemId(itemId) || item;
  if (!caseRow?.repair_case_id && !caseRow?.id) {
    openModal(item, caseRow, "EXTERNAL");
    alert("외주시트 동기화를 위해 먼저 외부수선 정보(업체/요청내용)를 저장하세요.");
    return;
  }
  if (caseRow?.decision_type !== "EXTERNAL") {
    openModal(item, caseRow, "EXTERNAL");
    alert("외주시트 동기화는 처리구분이 '외부'인 건에서만 가능합니다.");
    return;
  }
  const caseId = caseRow.repair_case_id || caseRow.id;
  const prevText = triggerBtn?.textContent;
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = "동기화중...";
  }
  try {
    const result = await api(`/api/repair-management/cases/${caseId}/sync-external-quote`, {
      method: "POST",
    });
    if (result?.result?.recreated) {
      alert(result.message || "시트에 행이 없어 자동으로 다시 생성했습니다. 견적 입력 후 다시 동기화하세요.");
    } else {
      const amountText = Number.isFinite(Number(result?.result?.quoteAmount))
        ? ` (${Number(result.result.quoteAmount).toLocaleString()}원 반영)`
        : "";
      alert(result.message || `외주 시트 동기화가 완료되었습니다.${amountText}`);
    }
    await loadAll();
  } catch (error) {
    alert(error.message || "외주 시트 동기화 중 오류가 발생했습니다.");
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = prevText || "외주시트동기화";
    }
  }
}

async function markNoRepairByItem(itemId, triggerBtn = null) {
  if (!confirm("무수선 완료 처리할까요? (수선완료존으로 이동)")) return;
  const prevText = triggerBtn?.textContent;
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = "처리중...";
  }
  try {
    const item = state.arrivals.find((r) => Number(r.id) === Number(itemId));
    const targetItemId = item?.item_id || item?.id || itemId;
    const result = await api(`/api/repair-management/items/${targetItemId}/no-repair-complete`, {
      method: "POST",
    });
    alert(result.message || "무수선 완료 처리되었습니다.");
    await loadAll();
  } catch (error) {
    alert(error.message || "무수선 완료 처리 중 오류가 발생했습니다.");
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = prevText || "무수선완료";
    }
  }
}

async function acceptCase(caseId) {
  if (!confirm("고객 수락 처리하고 수선 존으로 이동할까요?")) return;
  await api(`/api/repair-management/cases/${caseId}/accept`, { method: "POST" });
  await loadAll();
}

async function rejectCase(caseId) {
  if (!confirm("제안을 거절 처리할까요?")) return;
  await api(`/api/repair-management/cases/${caseId}/reject`, { method: "POST" });
  await loadAll();
}

async function markRepairDone(caseId) {
  if (!confirm("수선완료 처리할까요?")) return;
  await api(`/api/repair-management/cases/${caseId}/repair-complete`, {
    method: "POST",
  });
  await loadAll();
}

async function markSentCase(caseId) {
  if (!confirm("고객에게 템플릿 발송을 완료했나요? 고객응답대기로 이동합니다.")) return;
  await api(`/api/repair-management/cases/${caseId}/mark-sent`, { method: "POST" });
  await loadAll();
}

async function markShipped(caseId) {
  if (!confirm("출고완료 처리할까요?")) return;
  await api(`/api/repair-management/cases/${caseId}/ship`, { method: "POST" });
  await loadAll();
}

async function changeRepairStage(itemId, stage, triggerBtn = null) {
  if (!itemId || !stage) return;
  if (!confirm("수선 단계를 변경할까요?")) return;
  const prevText = triggerBtn?.textContent;
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = "변경중...";
  }
  try {
    const result = await api(`/api/repair-management/items/${itemId}/stage`, {
      method: "POST",
      body: JSON.stringify({ stage }),
    });
    alert(result.message || "수선 단계가 변경되었습니다.");
    await loadAll();
  } catch (error) {
    alert(error.message || "수선 단계 변경 중 오류가 발생했습니다.");
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = prevText || "단계변경";
    }
  }
}

function setRepairDetailText(id, value) {
  const node = el(id);
  if (!node) return;
  node.textContent = value || "-";
}

function setRepairDetailOrigin(url) {
  const link = el("repairDetailOriginLink");
  if (!link) return;
  const safe = url && url !== "#" ? url : "";
  link.href = safe || "#";
  link.style.pointerEvents = safe ? "auto" : "none";
  link.style.opacity = safe ? "1" : "0.5";
}

function setRepairDetailImage(src) {
  const img = el("repairDetailMainImage");
  if (!img) return;
  img.src = src || "/images/no-image.png";
}

function updateRepairDetailNav() {
  const prevBtn = el("repairDetailPrevBtn");
  const nextBtn = el("repairDetailNextBtn");
  if (prevBtn) prevBtn.disabled = detailImageIndex <= 0;
  if (nextBtn) nextBtn.disabled = detailImageIndex >= detailImages.length - 1;
}

function renderRepairDetailThumbs() {
  const wrap = el("repairDetailThumbs");
  if (!wrap) return;
  wrap.innerHTML = "";
  detailImages.forEach((src, idx) => {
    wrap.insertAdjacentHTML(
      "beforeend",
      `
      <button type="button" class="repair-detail-thumb ${idx === detailImageIndex ? "active" : ""}" data-index="${idx}">
        <img src="${escapeHtml(src)}" alt="썸네일 ${idx + 1}">
      </button>
      `,
    );
  });
  wrap.querySelectorAll(".repair-detail-thumb").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.index || 0);
      showRepairDetailImageAt(idx);
    });
  });
}

function showRepairDetailImageAt(index) {
  if (!detailImages.length) return;
  if (index < 0 || index >= detailImages.length) return;
  detailImageIndex = index;
  setRepairDetailImage(detailImages[detailImageIndex]);
  renderRepairDetailThumbs();
  updateRepairDetailNav();
}

function setRepairDetailImages(images) {
  const normalized = Array.isArray(images)
    ? images.filter((x) => String(x || "").trim())
    : [];
  detailImages = normalized.length ? normalized : ["/images/no-image.png"];
  detailImageIndex = 0;
  showRepairDetailImageAt(0);
}

function applyRepairDetailData(data = {}) {
  setRepairDetailText("repairDetailItemId", data.itemId || "-");
  setRepairDetailText("repairDetailTitle", data.title || "-");
  setRepairDetailText("repairDetailBrand", data.brand || "-");
  setRepairDetailText("repairDetailCategory", data.category || "-");
  setRepairDetailText("repairDetailRank", data.rank || "-");
  setRepairDetailText("repairDetailScheduled", data.scheduled || "-");
  setRepairDetailText("repairDetailAccessoryCode", data.accessoryCode || "-");
  setRepairDetailText("repairDetailDescription", data.description || "-");
  setRepairDetailOrigin(data.originUrl || "#");
  setRepairDetailImage(data.image || "/images/no-image.png");
}

function openRepairDetailModal() {
  el("repairItemDetailModal")?.classList.remove("hidden");
}

function closeRepairDetailModal() {
  el("repairItemDetailModal")?.classList.add("hidden");
}

async function openRepairItemDetail(button) {
  if (!button) return;
  const itemId = String(button.dataset.itemId || "").trim();
  const aucNum = String(button.dataset.aucNum || "").trim();
  const initialImage = button.dataset.image || "/images/no-image.png";
  const initialOrigin = button.dataset.originUrl || "#";

  applyRepairDetailData({
    itemId: itemId || "-",
    title: button.dataset.title || "-",
    brand: button.dataset.brand || "-",
    category: button.dataset.category || "-",
    rank: button.dataset.rank || "-",
    accessoryCode: button.dataset.accessoryCode || "-",
    scheduled: button.dataset.scheduled || "-",
    description: "상세 정보를 불러오는 중입니다...",
    image: initialImage,
    originUrl: initialOrigin,
  });
  setRepairDetailImages([initialImage]);
  openRepairDetailModal();

  if (!itemId || !aucNum) return;
  try {
    const detail = await api(`/detail/item-details/${encodeURIComponent(itemId)}`, {
      method: "POST",
      body: JSON.stringify({ aucNum, translateDescription: "ko" }),
    });
    let detailImage = detail?.image || initialImage;
    let detailImages = [detailImage];
    if (detail?.additional_images) {
      try {
        const extra = JSON.parse(detail.additional_images);
        if (Array.isArray(extra) && extra.length > 0) {
          detailImage = extra[0] || detailImage;
          detailImages = [detailImage, ...extra.slice(1)];
        }
      } catch (_) {}
    }

    const originUrl = initialOrigin !== "#" ? initialOrigin : buildOriginLink(
      itemId,
      aucNum,
      detail?.additional_info,
    );

    setRepairDetailImages(detailImages);
    applyRepairDetailData({
      itemId,
      title: detail?.title || button.dataset.title || "-",
      brand: detail?.brand || button.dataset.brand || "-",
      category: detail?.category || button.dataset.category || "-",
      rank: detail?.rank || button.dataset.rank || "-",
      accessoryCode: detail?.accessory_code || button.dataset.accessoryCode || "-",
      scheduled: detail?.scheduled_date ? formatDateTime(detail.scheduled_date) : button.dataset.scheduled || "-",
      description: detail?.description_ko || detail?.description || "설명 정보가 없습니다.",
      image: detailImage,
      originUrl,
    });
  } catch (error) {
    setRepairDetailText("repairDetailDescription", "상세 정보를 불러오지 못했습니다.");
  }
}

async function copyTemplateByCase(caseId) {
  const row = state.cases.find((c) => Number(c.id) === Number(caseId));
  if (!row?.proposal_text) {
    alert("복사할 템플릿이 없습니다.");
    return;
  }
  await navigator.clipboard.writeText(row.proposal_text);
  alert("템플릿이 복사되었습니다.");
}

function openModalByItem(itemId, forceDecision = "") {
  const item = state.arrivals.find((r) => Number(r.id) === Number(itemId));
  if (!item) return;
  const caseRow = getCaseByItemId(item.id) || item;
  openModal(item, caseRow, forceDecision);
}

function openModalByCase(caseId) {
  const caseRow = state.cases.find((c) => Number(c.id) === Number(caseId));
  if (!caseRow) return;
  openModal(caseRow, caseRow);
}

async function addVendor() {
  const name = prompt("추가할 외주업체명을 입력하세요.");
  if (!name || !name.trim()) return;
  const sheetUrl = prompt(
    "해당 업체 전용 구글시트 링크를 입력하세요. (없으면 빈값 가능)",
    "",
  );
  await api("/api/repair-management/vendors", {
    method: "POST",
    body: JSON.stringify({ name: name.trim(), sheetUrl: String(sheetUrl || "").trim() }),
  });
  await loadVendors();
  el("vendorName").value = name.trim();
  buildProposalPreview();
}

async function pushExternalBatch() {
  if (!confirm("외부수선 대기건을 외주시트로 일괄 전송할까요?")) return;
  const btn = el("btnPushExternalBatch");
  const prevText = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "전송중...";
  }
  try {
    const result = await api("/api/repair-management/external-sheet/push-pending", {
      method: "POST",
      body: JSON.stringify({ force: false }),
    });
    const failCount = Number(result?.result?.failedCount || 0);
    if (failCount > 0 && Array.isArray(result?.result?.failed)) {
      const preview = result.result.failed
        .slice(0, 3)
        .map((f) => `#${f.caseId}: ${f.reason}`)
        .join("\n");
      alert(`${result.message}\n\n실패 예시:\n${preview}`);
    } else {
      alert(result.message || "외주시트 일괄전송 완료");
    }
    await loadAll();
  } catch (error) {
    alert(error.message || "외주시트 일괄전송 중 오류가 발생했습니다.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prevText || "외부건 일괄전송";
    }
  }
}

async function loadVendors() {
  const data = await api("/api/repair-management/vendors");
  state.vendors = Array.isArray(data.vendors) ? data.vendors : [];
}

async function loadArrivals() {
  const q = encodeURIComponent(state.keyword || "");
  const data = await api(`/api/repair-management/domestic-arrivals?limit=500&q=${q}`);
  state.arrivals = Array.isArray(data.items) ? data.items : [];
}

async function loadCases() {
  const data = await api("/api/repair-management/cases");
  state.cases = Array.isArray(data.cases) ? data.cases : [];
}

function getAutoQuoteSyncTargets() {
  return (state.arrivals || [])
    .map((row) => getArrivalCaseInfo(row))
    .filter(
      (caseInfo) =>
        caseInfo &&
        caseInfo.decision_type === "EXTERNAL" &&
        caseInfo.case_state === CASE_STATE.DRAFT &&
        Boolean(caseInfo.external_sent_at) &&
        Number(caseInfo.repair_case_id || caseInfo.id),
    )
    .map((caseInfo) => Number(caseInfo.repair_case_id || caseInfo.id));
}

async function autoSyncExternalQuotes() {
  if (autoQuoteSyncInFlight) return;
  const targets = getAutoQuoteSyncTargets();
  if (!targets.length) return;

  autoQuoteSyncInFlight = true;
  try {
    let movedCount = 0;
    for (const caseId of targets) {
      try {
        const result = await api(`/api/repair-management/cases/${caseId}/sync-external-quote`, {
          method: "POST",
        });
        const caseState = String(result?.result?.caseState || "").toUpperCase();
        if (caseState === CASE_STATE.READY_TO_SEND) {
          movedCount += 1;
        }
      } catch (_) {
        // 자동 동기화는 무음 실패 처리. 수동 동기화 버튼은 그대로 유지.
      }
    }

    if (movedCount > 0) {
      await loadAll({ skipAutoSync: true });
    }
  } finally {
    autoQuoteSyncInFlight = false;
  }
}

async function loadAll(options = {}) {
  await Promise.all([loadVendors(), loadArrivals(), loadCases()]);
  renderAll();
  if (!options.skipAutoSync) {
    await autoSyncExternalQuotes();
  }
}

function startAutoQuoteSyncLoop() {
  if (autoQuoteSyncTimer) return;
  autoQuoteSyncTimer = setInterval(() => {
    autoSyncExternalQuotes().catch(() => {});
  }, AUTO_QUOTE_SYNC_INTERVAL_MS);
}

function bindEvents() {
  el("logoutBtn").addEventListener("click", async () => {
    await api("/auth/logout", { method: "POST" });
    window.location.href = "/signin";
  });

  el("btnReload").addEventListener("click", async () => {
    await loadAll();
  });

  el("btnExportCsv").addEventListener("click", () => {
    window.location.href = "/api/repair-management/export.csv";
  });

  el("btnToggleVendorManagement").addEventListener("click", () => {
    const body = el("vendorManagementBody");
    const collapsed = body.style.display === "none";
    setVendorManagementCollapsed(!collapsed);
  });

  el("searchInput").addEventListener("input", () => {
    state.keyword = el("searchInput").value.trim();
    renderAll();
  });

  el("btnCloseModal").addEventListener("click", closeModal);
  el("repairModal").addEventListener("click", (e) => {
    if (e.target.id === "repairModal") closeModal();
  });
  el("btnCloseRepairDetailModal")?.addEventListener("click", closeRepairDetailModal);
  el("repairItemDetailModal")?.addEventListener("click", (e) => {
    if (e.target.id === "repairItemDetailModal") closeRepairDetailModal();
  });
  el("repairDetailPrevBtn")?.addEventListener("click", () => {
    showRepairDetailImageAt(detailImageIndex - 1);
  });
  el("repairDetailNextBtn")?.addEventListener("click", () => {
    showRepairDetailImageAt(detailImageIndex + 1);
  });
  el("decisionType").addEventListener("change", () => {
    toggleVendorField();
    buildProposalPreview();
  });
  el("vendorName").addEventListener("change", buildProposalPreview);
  el("repairAmount").addEventListener("input", buildProposalPreview);
  el("repairEta").addEventListener("input", buildProposalPreview);
  el("repairNote").addEventListener("input", buildProposalPreview);
  el("btnAddVendor").addEventListener("click", addVendor);
  el("btnPushExternalBatch").addEventListener("click", pushExternalBatch);
  el("btnCopyTemplate").addEventListener("click", async () => {
    await navigator.clipboard.writeText(el("proposalText").value || "");
    alert("템플릿이 복사되었습니다.");
  });
  el("btnSaveDraft").addEventListener("click", () => saveCase("save"));
  el("btnSaveProposal")?.addEventListener("click", () => saveCase("propose"));
}

async function init() {
  bindEvents();
  setVendorManagementCollapsed(true);
  startAutoQuoteSyncLoop();
  try {
    await loadAll();
  } catch (error) {
    console.error(error);
    alert(error.message || "수선관리 데이터를 불러오지 못했습니다.");
  }
}

document.addEventListener("DOMContentLoaded", init);
