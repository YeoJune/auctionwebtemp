const express = require("express");
const path = require("path");
const { google } = require("googleapis");
const { pool } = require("../utils/DB");
const { requireAdmin } = require("../utils/adminAuth");
const {
  backfillCompletedWmsItemsByBidStatus,
} = require("../utils/wms-bid-sync");

const router = express.Router();

const DEFAULT_VENDORS = [
  "리리",
  "크리뉴",
  "성신사(종로)",
  "연희",
  "까사(내부)",
];

const REPAIR_CASE_STATES = {
  DRAFT: "DRAFT",
  READY_TO_SEND: "READY_TO_SEND",
  PROPOSED: "PROPOSED",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  DONE: "DONE",
};

let sheetsClientPromise = null;
const SHEET_IMAGE_BASE_URL = String(process.env.FRONTEND_URL || "https://casastrade.com")
  .trim()
  .replace(/\/+$/, "");

function isAdmin(req, res, next) {
  return requireAdmin(req, res, next);
}

async function getTableColumns(conn, tableName) {
  const [rows] = await conn.query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
    `,
    [tableName],
  );
  return new Set(rows.map((r) => r.COLUMN_NAME));
}

async function ensureRepairTables(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS wms_repair_vendors (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      sheet_url VARCHAR(600) NULL,
      sheet_id VARCHAR(180) NULL,
      sheet_gid VARCHAR(40) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_wms_repair_vendor_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS wms_repair_cases (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      item_id BIGINT NOT NULL,
      decision_type VARCHAR(30) NULL,
      vendor_name VARCHAR(120) NULL,
      repair_note TEXT NULL,
      repair_amount DECIMAL(14,2) NULL,
      repair_eta VARCHAR(120) NULL,
      proposal_text LONGTEXT NULL,
      internal_note TEXT NULL,
      case_state VARCHAR(30) NOT NULL DEFAULT 'PROPOSED',
      proposed_at DATETIME NULL,
      accepted_at DATETIME NULL,
      rejected_at DATETIME NULL,
      completed_at DATETIME NULL,
      external_sent_at DATETIME NULL,
      external_synced_at DATETIME NULL,
      created_by VARCHAR(100) NULL,
      updated_by VARCHAR(100) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_wms_repair_cases_item (item_id),
      KEY idx_wms_repair_cases_updated_at (updated_at),
      CONSTRAINT fk_wms_repair_cases_item
        FOREIGN KEY (item_id) REFERENCES wms_items(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  const vendorCols = await getTableColumns(conn, "wms_repair_vendors");
  if (!vendorCols.has("sheet_url")) {
    await conn.query(
      `ALTER TABLE wms_repair_vendors ADD COLUMN sheet_url VARCHAR(600) NULL`,
    );
  }
  if (!vendorCols.has("sheet_id")) {
    await conn.query(
      `ALTER TABLE wms_repair_vendors ADD COLUMN sheet_id VARCHAR(180) NULL`,
    );
  }
  if (!vendorCols.has("sheet_gid")) {
    await conn.query(
      `ALTER TABLE wms_repair_vendors ADD COLUMN sheet_gid VARCHAR(40) NULL`,
    );
  }

  const caseCols = await getTableColumns(conn, "wms_repair_cases");
  if (!caseCols.has("decision_type")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN decision_type VARCHAR(30) NULL`,
    );
  }
  if (!caseCols.has("vendor_name")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN vendor_name VARCHAR(120) NULL`,
    );
  }
  if (!caseCols.has("repair_note")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN repair_note TEXT NULL`,
    );
  }
  if (!caseCols.has("repair_amount")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN repair_amount DECIMAL(14,2) NULL`,
    );
  }
  if (!caseCols.has("repair_eta")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN repair_eta VARCHAR(120) NULL`,
    );
  }
  if (!caseCols.has("proposal_text")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN proposal_text LONGTEXT NULL`,
    );
  }
  if (!caseCols.has("internal_note")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN internal_note TEXT NULL`,
    );
  }
  if (!caseCols.has("created_by")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN created_by VARCHAR(100) NULL`,
    );
  }
  if (!caseCols.has("updated_by")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN updated_by VARCHAR(100) NULL`,
    );
  }
  if (!caseCols.has("case_state")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN case_state VARCHAR(30) NOT NULL DEFAULT 'PROPOSED'`,
    );
  }
  if (!caseCols.has("proposed_at")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN proposed_at DATETIME NULL`,
    );
  }
  if (!caseCols.has("accepted_at")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN accepted_at DATETIME NULL`,
    );
  }
  if (!caseCols.has("rejected_at")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN rejected_at DATETIME NULL`,
    );
  }
  if (!caseCols.has("completed_at")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN completed_at DATETIME NULL`,
    );
  }
  if (!caseCols.has("external_synced_at")) {
    await conn.query(
      `ALTER TABLE wms_repair_cases ADD COLUMN external_synced_at DATETIME NULL`,
    );
  }
  if (!caseCols.has("external_sent_at")) {
    try {
      await conn.query(
        `ALTER TABLE wms_repair_cases ADD COLUMN external_sent_at DATETIME NULL`,
      );
    } catch (error) {
      if (error?.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }

  await conn.query(
    `
    UPDATE wms_repair_cases
    SET case_state = 'PROPOSED'
    WHERE case_state IS NULL OR TRIM(case_state) = ''
    `,
  );

  for (const name of DEFAULT_VENDORS) {
    await conn.query(
      `
      INSERT INTO wms_repair_vendors (name, is_active)
      VALUES (?, 1)
      ON DUPLICATE KEY UPDATE
        is_active = VALUES(is_active),
        updated_at = NOW()
      `,
      [name],
    );
  }
}

function toAmount(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const compact = String(value).trim().replace(/[,\s]/g, "");
  if (!compact) return null;
  const matched = compact.match(/-?\d+(?:\.\d+)?/);
  if (!matched?.[0]) return null;
  const numeric = Number(matched[0]);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatMonthDayKR(dt) {
  if (!dt) return "";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return String(dt);
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

function formatDateForSheet(dt) {
  if (!dt) return "";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return String(dt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
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

function buildProposalText({
  companyName,
  productTitle,
  barcode,
  repairNote,
  repairAmount,
  repairEta,
  vendorName,
  scheduledAt,
}) {
  const safeCompany = companyName || "회원사 미확인";
  const safeDate = formatMonthDayKR(scheduledAt) || "(날짜 미확인)";
  const safeTitle = sanitizeProductTitle(productTitle);
  const safeNote = repairNote || "(수선내용 입력 필요)";
  const safeAmount =
    repairAmount != null
      ? `${Number(repairAmount).toLocaleString()}원 (vat 별도)`
      : "(금액 입력 필요)";
  const safeEta = String(repairEta || "").trim() || "(소요기간 입력 필요)";

  return [
    `${safeCompany}`,
    `안녕하세요, ${safeDate} 일 낙찰 상품 중`,
    "",
    `${safeTitle}`,
    "",
    "수선내용 :",
    `${safeNote}`,
    "",
    "소요기간 :",
    `${safeEta}`,
    "",
    "수선금액 :",
    `${safeAmount}`,
    "",
    "진행 여부 회신 부탁드립니다.",
    "감사합니다.",
  ].join("\n");
}

function parseGoogleSheetLink(sheetUrlRaw) {
  const sheetUrl = String(sheetUrlRaw || "").trim();
  if (!sheetUrl) return { sheetUrl: null, sheetId: null, sheetGid: null };
  const idMatch = sheetUrl.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const gidMatch = sheetUrl.match(/[?&#]gid=([0-9]+)/);
  return {
    sheetUrl,
    sheetId: idMatch?.[1] || null,
    sheetGid: gidMatch?.[1] || null,
  };
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_-]/g, "");
}

function getHeaderIndex(headers, candidates) {
  const normalizedCandidates = new Set(candidates.map((c) => normalizeHeader(c)));
  return headers.findIndex((header) => normalizedCandidates.has(normalizeHeader(header)));
}

function getHeaderIndexes(headers, candidates) {
  const normalizedCandidates = new Set(candidates.map((c) => normalizeHeader(c)));
  return headers.reduce((acc, header, idx) => {
    if (normalizedCandidates.has(normalizeHeader(header))) acc.push(idx);
    return acc;
  }, []);
}

function isCorruptedHeaderRow(headers) {
  const normalized = (headers || [])
    .map((h) => normalizeHeader(h))
    .filter(Boolean);
  if (!normalized.length) return true;
  const unique = new Set(normalized);
  if (normalized.length >= 5 && unique.size <= 1) return true;
  const hasBarcode = getHeaderIndex(headers, SHEET_COL_CANDIDATES.barcode) >= 0;
  const hasQuote = getHeaderIndex(headers, SHEET_COL_CANDIDATES.quote) >= 0;
  return !(hasBarcode && hasQuote);
}

function normalizeBarcode(value) {
  return String(value || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/^'+/, "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function toSheetImageFormula(imageUrlRaw) {
  const raw = String(imageUrlRaw || "").trim();
  if (!raw) return "";

  const base = SHEET_IMAGE_BASE_URL || "https://casastrade.com";
  let absoluteUrl = raw;
  if (/^https?:\/\//i.test(raw)) {
    absoluteUrl = raw;
  } else if (raw.startsWith("//")) {
    absoluteUrl = `https:${raw}`;
  } else if (raw.startsWith("/")) {
    absoluteUrl = `${base}${raw}`;
  } else {
    absoluteUrl = `${base}/${raw.replace(/^\/+/, "")}`;
  }

  const safeUrl = absoluteUrl.replace(/"/g, '""');
  return `=IMAGE("${safeUrl}")`;
}

async function getSheetsClient() {
  if (!sheetsClientPromise) {
    sheetsClientPromise = (async () => {
      const auth = new google.auth.GoogleAuth({
        keyFile: path.join(process.cwd(), "service-account-key.json"),
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      const client = await auth.getClient();
      return google.sheets({ version: "v4", auth: client });
    })();
  }
  return sheetsClientPromise;
}

const SHEET_COL_CANDIDATES = {
  barcode: ["internal_barcode", "barcode", "내부바코드", "내부 바코드", "바코드"],
  quote: [
    "quote_amount",
    "repair_amount",
    "견적금액",
    "수선금액",
    "견적",
    "금액",
    "견적금액(엔)",
    "견적금액(원)",
    "견적가",
    "수선비",
    "금액(원)",
  ],
  eta: [
    "eta_days",
    "예상일",
    "예상소요일",
    "소요일",
    "예상완료일",
    "예상일자",
    "작업기간",
    "작업 기간",
  ],
  note: ["repair_note", "비고", "메모", "내용", "수선요청내용", "수선내용"],
  title: ["product_title", "title", "상품명", "상품명칭", "제목"],
  vendor: ["vendor_name", "vendor", "외주업체", "외주 업체", "업체"],
  image: ["image", "image_url", "사진", "이미지", "상품이미지", "상품사진"],
  bidDate: ["낙찰일자", "낙찰일시", "예정일시", "scheduled_at", "scheduled_date"],
  customer: ["고객명", "회원사", "company_name", "member_name"],
  progress: [
    "수선 진행 확정",
    "수선진행확정",
    "수선진행여부",
    "수선 진행여부",
    "진행여부",
    "진행 상태",
    "progress",
  ],
};

function columnIndexToA1(idx) {
  let num = Number(idx) + 1;
  let out = "";
  while (num > 0) {
    const rem = (num - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    num = Math.floor((num - 1) / 26);
  }
  return out || "A";
}

async function resolveTargetSheetAndRows({ sheets, sheetId, sheetGid }) {
  const book = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  const allSheets = Array.isArray(book?.data?.sheets) ? book.data.sheets : [];
  let targetSheet = allSheets[0]?.properties || null;
  if (sheetGid) {
    const found = allSheets.find(
      (s) => String(s?.properties?.sheetId || "") === String(sheetGid),
    );
    if (found?.properties) targetSheet = found.properties;
  }
  if (!targetSheet?.title) {
    return { error: "시트 탭을 찾을 수 없습니다. gid를 확인하세요." };
  }
  const range = `'${targetSheet.title.replace(/'/g, "''")}'!A1:Z2000`;
  const valuesRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
  });
  return {
    targetSheetTitle: targetSheet.title,
    rows: valuesRes?.data?.values || [],
  };
}

function findQuoteHeaderInfo(rows) {
  let headerRowIndex = -1;
  let headers = [];
  let barcodeIdx = -1;
  let quoteIdx = -1;
  let etaIdx = -1;
  let noteIdx = -1;
  const scanLimit = Math.min(rows.length, 20);
  for (let i = 0; i < scanLimit; i += 1) {
    const row = rows[i] || [];
    const candidateHeaders = row.map((h) => String(h || "").trim());
    if (!candidateHeaders.some(Boolean)) continue;

    const candidateBarcodeIdx = getHeaderIndex(
      candidateHeaders,
      SHEET_COL_CANDIDATES.barcode,
    );
    const candidateQuoteIdx = getHeaderIndex(candidateHeaders, SHEET_COL_CANDIDATES.quote);
    if (candidateBarcodeIdx >= 0 && candidateQuoteIdx >= 0) {
      headerRowIndex = i;
      headers = candidateHeaders;
      barcodeIdx = candidateBarcodeIdx;
      quoteIdx = candidateQuoteIdx;
      etaIdx = getHeaderIndex(candidateHeaders, SHEET_COL_CANDIDATES.eta);
      noteIdx = getHeaderIndex(candidateHeaders, SHEET_COL_CANDIDATES.note);
      break;
    }
  }
  return { headerRowIndex, headers, barcodeIdx, quoteIdx, etaIdx, noteIdx };
}

async function upsertVendorSheetRow({
  sheetId,
  sheetGid,
  barcode,
  bidDate,
  productTitle,
  customerName,
  repairNote,
  workPeriod,
  vendorName,
  productImage,
  progressFlag,
}) {
  if (!sheetId || !barcode) {
    return { error: "시트ID 또는 바코드가 없습니다." };
  }
  const sheets = await getSheetsClient();
  const resolved = await resolveTargetSheetAndRows({ sheets, sheetId, sheetGid });
  if (resolved.error) return { error: resolved.error };

  const title = resolved.targetSheetTitle;
  const rows = Array.isArray(resolved.rows) ? resolved.rows : [];
  const desiredHeaderDefs = [
    { key: "bidDate", label: "낙찰일자", candidates: SHEET_COL_CANDIDATES.bidDate },
    { key: "title", label: "제목", candidates: SHEET_COL_CANDIDATES.title },
    { key: "image", label: "사진", candidates: SHEET_COL_CANDIDATES.image },
    { key: "note", label: "수선요청내용", candidates: SHEET_COL_CANDIDATES.note },
    { key: "customer", label: "고객명", candidates: SHEET_COL_CANDIDATES.customer },
    { key: "vendor", label: "외주 업체", candidates: SHEET_COL_CANDIDATES.vendor },
    { key: "memo", label: "비고", candidates: ["비고", "memo", "note"] },
    { key: "quote", label: "견적", candidates: SHEET_COL_CANDIDATES.quote },
    { key: "eta", label: "작업 기간", candidates: SHEET_COL_CANDIDATES.eta },
    { key: "barcode", label: "내부바코드", candidates: SHEET_COL_CANDIDATES.barcode },
    { key: "progress", label: "수선 진행 확정", candidates: SHEET_COL_CANDIDATES.progress },
  ];

  let originalHeaders = rows[0] ? rows[0].map((v) => String(v || "").trim()) : [];
  let originalDataRows = rows.slice(1);
  if (!originalHeaders.length || isCorruptedHeaderRow(originalHeaders)) {
    originalHeaders = [];
    originalDataRows = [];
  }

  const usedSourceIndexes = new Set();
  const sourceIdxByKey = {};
  for (const def of desiredHeaderDefs) {
    const idx = getHeaderIndex(originalHeaders, def.candidates);
    sourceIdxByKey[def.key] = idx;
    if (idx >= 0) usedSourceIndexes.add(idx);
  }

  const extraSourceIndexes = originalHeaders
    .map((_, idx) => idx)
    .filter((idx) => !usedSourceIndexes.has(idx) && String(originalHeaders[idx] || "").trim());
  const extraHeaders = extraSourceIndexes.map((idx) => String(originalHeaders[idx] || "").trim());

  const headers = [...desiredHeaderDefs.map((d) => d.label), ...extraHeaders];
  const dataRows = originalDataRows.map((row) => {
    const nextRow = Array.from({ length: headers.length }, () => "");
    desiredHeaderDefs.forEach((def, targetIdx) => {
      const sourceIdx = sourceIdxByKey[def.key];
      nextRow[targetIdx] = sourceIdx >= 0 ? row?.[sourceIdx] || "" : "";
    });
    extraSourceIndexes.forEach((sourceIdx, extraIdx) => {
      nextRow[desiredHeaderDefs.length + extraIdx] = row?.[sourceIdx] || "";
    });
    return nextRow;
  });

  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: `'${title.replace(/'/g, "''")}'!A1:ZZ2000`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${title.replace(/'/g, "''")}'!A1:${columnIndexToA1(headers.length - 1)}${Math.max(1, dataRows.length + 1)}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [headers, ...dataRows] },
  });

  const bidDateIdx = getHeaderIndex(headers, SHEET_COL_CANDIDATES.bidDate);
  const barcodeIdx = getHeaderIndex(headers, SHEET_COL_CANDIDATES.barcode);
  const imageIdx = getHeaderIndex(headers, SHEET_COL_CANDIDATES.image);
  const titleIdx = getHeaderIndex(headers, SHEET_COL_CANDIDATES.title);
  const repairNoteIdx = getHeaderIndex(headers, SHEET_COL_CANDIDATES.note);
  const customerIdx = getHeaderIndex(headers, SHEET_COL_CANDIDATES.customer);
  const vendorIdx = getHeaderIndex(headers, SHEET_COL_CANDIDATES.vendor);
  const quoteIdx = getHeaderIndex(headers, SHEET_COL_CANDIDATES.quote);
  const etaIdx = getHeaderIndex(headers, SHEET_COL_CANDIDATES.eta);
  const progressIdx = getHeaderIndex(headers, SHEET_COL_CANDIDATES.progress);
  const memoIdx = getHeaderIndex(headers, ["비고", "memo", "note"]);

  const normalizedBarcode = normalizeBarcode(barcode);
  const rowOffset = dataRows.findIndex(
    (row) => normalizeBarcode(row?.[barcodeIdx]) === normalizedBarcode,
  );
  const existing = rowOffset >= 0 ? dataRows[rowOffset] : [];
  const newRow = Array.from({ length: headers.length }, (_, idx) =>
    idx < existing.length ? existing[idx] : "",
  );

  if (bidDate && String(bidDate).trim()) {
    newRow[bidDateIdx] = String(bidDate).trim();
  }
  newRow[barcodeIdx] = barcode;
  if (productImage && String(productImage).trim()) {
    const formula = toSheetImageFormula(productImage);
    if (formula) newRow[imageIdx] = formula;
  }
  newRow[titleIdx] = String(productTitle || "").trim() || String(newRow[titleIdx] || "").trim() || barcode;
  if (customerName && String(customerName).trim()) {
    newRow[customerIdx] = String(customerName).trim();
  }
  newRow[repairNoteIdx] = repairNote || "";
  newRow[vendorIdx] = vendorName || "";
  if (!String(newRow[quoteIdx] || "").trim()) newRow[quoteIdx] = "";
  if (workPeriod && String(workPeriod).trim() && !String(newRow[etaIdx] || "").trim()) {
    newRow[etaIdx] = String(workPeriod).trim();
  }
  if (!String(newRow[etaIdx] || "").trim()) newRow[etaIdx] = "";
  if (progressFlag !== undefined && progressFlag !== null && String(progressFlag).trim() !== "") {
    newRow[progressIdx] = String(progressFlag).trim();
  }
  if (!String(newRow[memoIdx] || "").trim()) newRow[memoIdx] = "";

  if (rowOffset >= 0) {
    const rowNo = rowOffset + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${title.replace(/'/g, "''")}'!A${rowNo}:${columnIndexToA1(headers.length - 1)}${rowNo}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [newRow] },
    });
    return { created: false, rowNumber: rowNo };
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `'${title.replace(/'/g, "''")}'!A:${columnIndexToA1(headers.length - 1)}`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [newRow] },
  });
  return { created: true };
}

async function fetchVendorSheetQuote({ sheetId, sheetGid, barcode }) {
  if (!sheetId || !barcode) {
    return { error: "시트ID 또는 바코드가 없습니다." };
  }
  try {
    const sheets = await getSheetsClient();
    const resolved = await resolveTargetSheetAndRows({ sheets, sheetId, sheetGid });
    if (resolved.error) return { error: resolved.error };
    const rows = Array.isArray(resolved.rows) ? resolved.rows : [];
    if (!rows.length) {
      return { error: "시트 데이터가 비어 있습니다." };
    }

    const { headerRowIndex, barcodeIdx, quoteIdx, etaIdx, noteIdx } = findQuoteHeaderInfo(rows);
    if (headerRowIndex < 0 || barcodeIdx < 0 || quoteIdx < 0) {
      const preview = rows
        .slice(0, 3)
        .map((r, idx) => `R${idx + 1}: ${(r || []).slice(0, 6).join(" | ")}`)
        .join(" / ");
      return {
        error:
          "시트 헤더를 찾지 못했습니다. 필수 컬럼: [내부바코드/바코드] + [견적금액/수선금액]. " +
          (preview ? `현재 상단행: ${preview}` : ""),
      };
    }

    const normalizedTargetBarcode = normalizeBarcode(barcode);
    const dataRows = rows.slice(headerRowIndex + 1);
    const matchedRows = dataRows
      .map((row, idx) => ({
        row,
        rowNumber: headerRowIndex + 2 + idx,
      }))
      .filter(({ row }) => {
        const rowBarcode = normalizeBarcode(row?.[barcodeIdx]);
        return rowBarcode && rowBarcode === normalizedTargetBarcode;
      });

    if (!matchedRows.length) {
      const samples = dataRows
        .map((row) => normalizeBarcode(row?.[barcodeIdx]))
        .filter(Boolean)
        .slice(0, 5);
      return {
        error:
          `시트에서 바코드 [${barcode}] 행을 찾지 못했습니다.` +
          (samples.length ? ` (시트 바코드 예시: ${samples.join(", ")})` : ""),
      };
    }

    // 같은 바코드가 여러 줄이면 "견적이 있는 최신 행"을 우선 사용
    const rowsFromLatest = [...matchedRows].reverse();
    const picked =
      rowsFromLatest.find(({ row }) => toAmount(row?.[quoteIdx]) !== null) ||
      rowsFromLatest[0];

    return {
      quoteAmountRaw: picked?.row?.[quoteIdx],
      etaRaw: etaIdx >= 0 ? picked?.row?.[etaIdx] : null,
      noteRaw: noteIdx >= 0 ? picked?.row?.[noteIdx] : null,
      matchedCount: matchedRows.length,
      pickedRowNumber: picked?.rowNumber || null,
    };
  } catch (error) {
    const raw = error?.response?.data?.error?.message || error?.message;
    return {
      error: `구글시트 조회 실패: ${raw || "알 수 없는 오류"}`,
    };
  }
}

function zoneAndStatusByDecision(decisionType) {
  if (decisionType === "INTERNAL") {
    return {
      zoneCode: "INTERNAL_REPAIR_ZONE",
      statusCode: "INTERNAL_REPAIR_IN_PROGRESS",
      actionType: "REPAIR_INTERNAL_START",
    };
  }
  if (decisionType === "NONE") {
    return {
      zoneCode: "REPAIR_DONE_ZONE",
      statusCode: "REPAIR_DONE",
      actionType: "REPAIR_SKIP_DONE",
    };
  }

  return {
    zoneCode: "EXTERNAL_REPAIR_ZONE",
    statusCode: "EXTERNAL_REPAIR_IN_PROGRESS",
    actionType: "REPAIR_EXTERNAL_START",
  };
}

function statusByZone(zoneCode) {
  switch (zoneCode) {
    case "DOMESTIC_ARRIVAL_ZONE":
      return "DOMESTIC_ARRIVED";
    case "INTERNAL_REPAIR_ZONE":
      return "INTERNAL_REPAIR_IN_PROGRESS";
    case "EXTERNAL_REPAIR_ZONE":
      return "EXTERNAL_REPAIR_IN_PROGRESS";
    case "REPAIR_DONE_ZONE":
      return "REPAIR_DONE";
    case "OUTBOUND_ZONE":
      return "OUTBOUND_READY";
    default:
      return "INTERNAL_REPAIR_IN_PROGRESS";
  }
}

async function moveItemToZone({
  conn,
  item,
  toZoneCode,
  actionType,
  staffName,
  note,
}) {
  const nextStatus = statusByZone(toZoneCode);
  await conn.query(
    `
    UPDATE wms_items
    SET current_location_code = ?,
        current_status = ?,
        updated_at = NOW()
    WHERE id = ?
    `,
    [toZoneCode, nextStatus, item.id],
  );

  await conn.query(
    `
    INSERT INTO wms_scan_events (
      item_id,
      barcode_input,
      from_location_code,
      to_location_code,
      prev_status,
      next_status,
      action_type,
      staff_name,
      note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      item.id,
      item.internal_barcode || item.external_barcode || `ITEM:${item.id}`,
      item.current_location_code,
      toZoneCode,
      item.current_status,
      nextStatus,
      actionType,
      staffName,
      note || null,
    ],
  );
  return nextStatus;
}

async function resolveSourceBid(conn, item) {
  if (item?.source_bid_type && item?.source_bid_id) {
    return {
      bidType: String(item.source_bid_type),
      bidId: Number(item.source_bid_id),
    };
  }
  if (!item?.source_item_id) return null;

  const sourceItemId = String(item.source_item_id);
  const [directRows] = await conn.query(
    `
    SELECT id, updated_at
    FROM direct_bids
    WHERE item_id = ?
      AND status = 'completed'
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    `,
    [sourceItemId],
  );
  const [liveRows] = await conn.query(
    `
    SELECT id, updated_at
    FROM live_bids
    WHERE item_id = ?
      AND status = 'completed'
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    `,
    [sourceItemId],
  );

  const candidates = [
    directRows[0] ? { bidType: "direct", ...directRows[0] } : null,
    liveRows[0] ? { bidType: "live", ...liveRows[0] } : null,
  ]
    .filter(Boolean)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  if (!candidates.length) return null;
  return { bidType: candidates[0].bidType, bidId: Number(candidates[0].id) };
}

function normalizeLocationCode(locationCode) {
  if (locationCode === "AUTH_ZONE") return "OUTBOUND_ZONE";
  if (locationCode === "REPAIR_TEAM_CHECK_ZONE") return "INTERNAL_REPAIR_ZONE";
  return locationCode;
}

async function hideInvalidDomesticArrivals(conn) {
  // 잘못 스캔되어 생성된 잡음 데이터는 운영 목록에서 제외한다.
  await conn.query(
    `
    UPDATE wms_items i
    LEFT JOIN wms_repair_cases rc
      ON rc.item_id = i.id
    SET i.current_status = 'COMPLETED',
        i.updated_at = NOW()
    WHERE i.current_location_code = 'DOMESTIC_ARRIVAL_ZONE'
      AND i.current_status <> 'COMPLETED'
      AND rc.id IS NULL
      AND (
        NULLIF(TRIM(i.source_item_id), '') IS NULL
        AND (
          i.source_bid_type IS NULL
          OR i.source_bid_type NOT IN ('live', 'direct')
          OR i.source_bid_id IS NULL
        )
      )
      AND (
        COALESCE(
          NULLIF(TRIM(i.internal_barcode), ''),
          NULLIF(TRIM(i.external_barcode), '')
        ) IS NULL
        OR CHAR_LENGTH(
          COALESCE(
            NULLIF(TRIM(i.internal_barcode), ''),
            NULLIF(TRIM(i.external_barcode), '')
          )
        ) < 6
        OR COALESCE(
          NULLIF(TRIM(i.internal_barcode), ''),
          NULLIF(TRIM(i.external_barcode), '')
        ) NOT REGEXP '[0-9]'
      )
    `,
  );

  // WMS를 COMPLETED로 바꾼 것들의 shipping_status도 동기화
  await conn.query(
    `
    UPDATE direct_bids d
    INNER JOIN wms_items wi
      ON wi.source_bid_type = 'direct' AND wi.source_bid_id = d.id
    SET d.shipping_status = 'completed',
        d.updated_at = NOW()
    WHERE d.status = 'completed'
      AND wi.current_status = 'COMPLETED'
      AND d.shipping_status <> 'completed'
    `,
  );

  await conn.query(
    `
    UPDATE live_bids l
    INNER JOIN wms_items wi
      ON wi.source_bid_type = 'live' AND wi.source_bid_id = l.id
    SET l.shipping_status = 'completed',
        l.updated_at = NOW()
    WHERE l.status = 'completed'
      AND wi.current_status = 'COMPLETED'
      AND l.shipping_status <> 'completed'
    `,
  );
}

async function syncBidStatusByLocation(conn, item, toLocationCode) {
  const normalizedToLocationCode = normalizeLocationCode(toLocationCode);
  let nextBidStatus = null;
  if (
    normalizedToLocationCode === "DOMESTIC_ARRIVAL_ZONE" ||
    normalizedToLocationCode === "INBOUND_ZONE"
  ) {
    nextBidStatus = "domestic_arrived";
  } else if (
    normalizedToLocationCode === "REPAIR_ZONE" ||
    normalizedToLocationCode === "INTERNAL_REPAIR_ZONE" ||
    normalizedToLocationCode === "EXTERNAL_REPAIR_ZONE" ||
    normalizedToLocationCode === "REPAIR_DONE_ZONE"
  ) {
    nextBidStatus = "processing";
  } else if (normalizedToLocationCode === "OUTBOUND_ZONE") {
    nextBidStatus = "shipped";
  }

  if (!nextBidStatus) return;
  const resolved = await resolveSourceBid(conn, item);
  if (!resolved) return;
  const { bidType, bidId } = resolved;

  // WMS 스캔 위치에 따라 bid 테이블의 shipping_status를 직접 업데이트한다.
  // status = 'completed'인 경우에만 허용 (불변성 보장)
  const bidTable = bidType === "direct" ? "direct_bids" : "live_bids";
  await conn.query(
    `UPDATE ${bidTable} SET shipping_status = ?, updated_at = NOW() WHERE id = ? AND status = 'completed'`,
    [nextBidStatus, bidId],
  );

  if (!item.source_bid_type || !item.source_bid_id) {
    await conn.query(
      `
      UPDATE wms_items
      SET source_bid_type = ?, source_bid_id = ?, updated_at = NOW()
      WHERE id = ?
      `,
      [bidType, bidId, item.id],
    );
  }
}

async function fetchRepairItemWithMeta(conn, itemId) {
  const [rows] = await conn.query(
    `
    SELECT
      i.id,
      i.member_name,
      i.internal_barcode,
      i.external_barcode,
      i.current_location_code,
      i.current_status,
      i.source_bid_type,
      i.source_bid_id,
      i.source_item_id,
      i.source_scheduled_date,
      COALESCE(ci.original_scheduled_date, ci.scheduled_date, i.source_scheduled_date) AS scheduled_at,
      COALESCE(ci.original_title, ci.title) AS product_title,
      COALESCE(ci.image, '') AS product_image,
      COALESCE(u.company_name, i.member_name) AS company_name
    FROM wms_items i
    LEFT JOIN direct_bids d
      ON i.source_bid_type = 'direct'
     AND i.source_bid_id = d.id
    LEFT JOIN live_bids l
      ON i.source_bid_type = 'live'
     AND i.source_bid_id = l.id
    LEFT JOIN users u
      ON u.id = COALESCE(d.user_id, l.user_id)
    LEFT JOIN crawled_items ci
      ON CONVERT(ci.item_id USING utf8mb4) =
         CONVERT(COALESCE(i.source_item_id, d.item_id, l.item_id) USING utf8mb4)
    WHERE i.id = ?
    LIMIT 1
    `,
    [itemId],
  );
  return rows[0] || null;
}

router.get("/vendors", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const [rows] = await conn.query(
      `
      SELECT id, name, sheet_url, sheet_id, sheet_gid
      FROM wms_repair_vendors
      WHERE is_active = 1
      ORDER BY name ASC
      `,
    );
    res.json({ ok: true, vendors: rows });
  } catch (error) {
    console.error("repair vendors error:", error);
    res.status(500).json({ ok: false, message: "외주업체 목록 조회 실패" });
  } finally {
    conn.release();
  }
});

router.post("/vendors", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const name = String(req.body?.name || "").trim();
    const sheetUrl = String(req.body?.sheetUrl || req.body?.sheet_url || "").trim();
    if (!name) {
      return res.status(400).json({ ok: false, message: "업체명을 입력하세요." });
    }

    const parsed = parseGoogleSheetLink(sheetUrl);
    await conn.query(
      `
      INSERT INTO wms_repair_vendors (name, sheet_url, sheet_id, sheet_gid, is_active)
      VALUES (?, ?, ?, ?, 1)
      ON DUPLICATE KEY UPDATE
        is_active = 1,
        sheet_url = VALUES(sheet_url),
        sheet_id = VALUES(sheet_id),
        sheet_gid = VALUES(sheet_gid),
        updated_at = NOW()
      `,
      [name, parsed.sheetUrl, parsed.sheetId, parsed.sheetGid],
    );

    res.json({
      ok: true,
      message: "외주업체가 등록되었습니다.",
      vendor: {
        name,
        sheet_url: parsed.sheetUrl,
        sheet_id: parsed.sheetId,
        sheet_gid: parsed.sheetGid,
      },
    });
  } catch (error) {
    console.error("repair vendor create error:", error);
    res.status(500).json({ ok: false, message: "외주업체 등록 실패" });
  } finally {
    conn.release();
  }
});

router.put("/vendors/:id", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const vendorId = Number(req.params?.id);
    if (!vendorId) {
      return res.status(400).json({ ok: false, message: "업체 id가 필요합니다." });
    }

    const name = String(req.body?.name || req.body?.vendorName || "").trim();
    const sheetUrl = String(req.body?.sheetUrl || req.body?.sheet_url || "").trim();
    if (!name) {
      return res.status(400).json({ ok: false, message: "업체명을 입력하세요." });
    }

    await conn.beginTransaction();
    const [vendorRows] = await conn.query(
      `
      SELECT id, name
      FROM wms_repair_vendors
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [vendorId],
    );
    const vendor = vendorRows[0];
    if (!vendor) {
      await conn.rollback();
      return res.status(404).json({ ok: false, message: "외주업체를 찾을 수 없습니다." });
    }
    if (vendor.name === "까사(내부)") {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: "내부업체는 수정할 수 없습니다." });
    }

    const parsed = parseGoogleSheetLink(sheetUrl);
    await conn.query(
      `
      UPDATE wms_repair_vendors
      SET name = ?,
          sheet_url = ?,
          sheet_id = ?,
          sheet_gid = ?,
          is_active = 1,
          updated_at = NOW()
      WHERE id = ?
      `,
      [name, parsed.sheetUrl, parsed.sheetId, parsed.sheetGid, vendorId],
    );

    if (vendor.name !== name) {
      await conn.query(
        `
        UPDATE wms_repair_cases
        SET vendor_name = ?,
            updated_at = NOW()
        WHERE vendor_name = ?
        `,
        [name, vendor.name],
      );
    }

    await conn.commit();

    res.json({
      ok: true,
      message: "외주업체가 수정되었습니다.",
      vendor: {
        id: vendorId,
        name,
        sheet_url: parsed.sheetUrl,
        sheet_id: parsed.sheetId,
        sheet_gid: parsed.sheetGid,
      },
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {}
    console.error("repair vendor update error:", error);
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ ok: false, message: "같은 이름의 외주업체가 이미 존재합니다." });
    }
    res.status(500).json({ ok: false, message: "외주업체 수정 실패" });
  } finally {
    conn.release();
  }
});

router.delete("/vendors/:id", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const vendorId = Number(req.params?.id);
    if (!vendorId) {
      return res.status(400).json({ ok: false, message: "업체 id가 필요합니다." });
    }

    const [vendorRows] = await conn.query(
      `
      SELECT id, name
      FROM wms_repair_vendors
      WHERE id = ?
      LIMIT 1
      `,
      [vendorId],
    );
    const vendor = vendorRows[0];
    if (!vendor) {
      return res.status(404).json({ ok: false, message: "외주업체를 찾을 수 없습니다." });
    }
    if (vendor.name === "까사(내부)") {
      return res.status(400).json({ ok: false, message: "내부업체는 삭제할 수 없습니다." });
    }

    await conn.query(
      `
      UPDATE wms_repair_vendors
      SET is_active = 0,
          updated_at = NOW()
      WHERE id = ?
      `,
      [vendorId],
    );

    res.json({
      ok: true,
      message: "외주업체가 삭제되었습니다.",
      result: { id: vendorId, name: vendor.name },
    });
  } catch (error) {
    console.error("repair vendor delete error:", error);
    res.status(500).json({ ok: false, message: "외주업체 삭제 실패" });
  } finally {
    conn.release();
  }
});

router.get("/domestic-arrivals", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    await backfillCompletedWmsItemsByBidStatus(conn);
    await hideInvalidDomesticArrivals(conn);

    const q = String(req.query?.q || "").trim();
    const limit = Math.min(Math.max(Number(req.query?.limit) || 300, 50), 1000);

    const where = [
      "i.current_location_code = 'DOMESTIC_ARRIVAL_ZONE'",
      "i.current_status IN ('DOMESTIC_ARRIVED', 'DOMESTIC_ARRIVAL_IN_PROGRESS', 'NEW')",
      "(NULLIF(TRIM(i.internal_barcode), '') IS NOT NULL OR NULLIF(TRIM(i.external_barcode), '') IS NOT NULL)",
      `CHAR_LENGTH(
        COALESCE(
          NULLIF(TRIM(i.internal_barcode), ''),
          NULLIF(TRIM(i.external_barcode), '')
        )
      ) >= 6`,
      `COALESCE(
        NULLIF(TRIM(i.internal_barcode), ''),
        NULLIF(TRIM(i.external_barcode), '')
      ) REGEXP '[0-9]'`,
      "(COALESCE(d.id, l.id) IS NOT NULL OR ci.item_id IS NOT NULL)",
    ];
    const params = [];

    if (q) {
      where.push(
        `(
          i.internal_barcode LIKE ?
          OR i.external_barcode LIKE ?
          OR COALESCE(u.company_name, i.member_name, '') LIKE ?
          OR COALESCE(i.source_item_id, d.item_id, l.item_id, '') LIKE ?
          OR COALESCE(ci.original_title, ci.title, '') LIKE ?
        )`,
      );
      const k = `%${q}%`;
      params.push(k, k, k, k, k);
    }

    params.push(limit);

    const [rows] = await conn.query(
      `
      SELECT
        i.id,
        COALESCE(u.company_name, i.member_name) AS member_name,
        COALESCE(NULLIF(i.internal_barcode, ''), NULLIF(i.external_barcode, '')) AS internal_barcode,
        i.external_barcode,
        COALESCE(
          NULLIF(i.source_bid_type, ''),
          CASE
            WHEN d.id IS NOT NULL THEN 'direct'
            WHEN l.id IS NOT NULL THEN 'live'
            ELSE NULL
          END
        ) AS source_bid_type,
        COALESCE(i.source_bid_id, d.id, l.id) AS source_bid_id,
        COALESCE(i.source_item_id, d.item_id, l.item_id) AS source_item_id,
        i.auction_lot_no,
        i.current_status,
        i.current_location_code,
        i.created_at,
        i.updated_at,
        COALESCE(ci.image, '') AS product_image,
        COALESCE(ci.original_scheduled_date, ci.scheduled_date, i.source_scheduled_date) AS scheduled_at,
        COALESCE(ci.original_title, ci.title) AS product_title,
        rc.id AS repair_case_id,
        rc.case_state,
        rc.decision_type,
        rc.vendor_name,
        rc.repair_note,
        rc.repair_amount,
        rc.repair_eta,
        rc.proposal_text,
        rc.proposed_at,
        rc.accepted_at,
        rc.rejected_at,
        rc.external_sent_at,
        rc.external_synced_at,
        rc.updated_at AS repair_updated_at,
        rv.sheet_url AS vendor_sheet_url
      FROM wms_items i
      LEFT JOIN direct_bids d
        ON i.source_bid_type = 'direct'
       AND i.source_bid_id = d.id
      LEFT JOIN live_bids l
        ON i.source_bid_type = 'live'
       AND i.source_bid_id = l.id
      LEFT JOIN wms_repair_cases rc
        ON rc.item_id = i.id
      LEFT JOIN wms_repair_vendors rv
        ON rv.name = rc.vendor_name
      LEFT JOIN users u
        ON u.id = COALESCE(d.user_id, l.user_id)
      LEFT JOIN crawled_items ci
        ON CONVERT(ci.item_id USING utf8mb4) =
           CONVERT(COALESCE(i.source_item_id, d.item_id, l.item_id) USING utf8mb4)
      WHERE ${where.join(" AND ")}
      ORDER BY i.updated_at DESC
      LIMIT ?
      `,
      params,
    );

    res.json({ ok: true, items: rows });
  } catch (error) {
    console.error("repair domestic arrivals error:", error);
    res.status(500).json({ ok: false, message: "국내도착 물건 조회 실패" });
  } finally {
    conn.release();
  }
});

router.get("/cases", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);

    const [rows] = await conn.query(
      `
      SELECT
        rc.id,
        rc.item_id,
        rc.case_state,
        rc.decision_type,
        rc.vendor_name,
        rc.repair_note,
        rc.repair_amount,
        rc.repair_eta,
        rc.proposal_text,
        rc.internal_note,
        rc.proposed_at,
        rc.accepted_at,
        rc.rejected_at,
        rc.completed_at,
        rc.external_sent_at,
        rc.external_synced_at,
        rc.updated_by,
        rc.updated_at,
        COALESCE(NULLIF(i.internal_barcode, ''), NULLIF(i.external_barcode, '')) AS internal_barcode,
        COALESCE(u.company_name, i.member_name) AS member_name,
        i.current_location_code,
        i.current_status,
        COALESCE(ci.original_title, ci.title) AS product_title,
        COALESCE(ci.image, '') AS product_image,
        COALESCE(ci.original_scheduled_date, ci.scheduled_date, i.source_scheduled_date) AS scheduled_at,
        rv.sheet_url AS vendor_sheet_url
      FROM wms_repair_cases rc
      INNER JOIN wms_items i
        ON i.id = rc.item_id
      LEFT JOIN direct_bids d
        ON i.source_bid_type = 'direct'
       AND i.source_bid_id = d.id
      LEFT JOIN live_bids l
        ON i.source_bid_type = 'live'
       AND i.source_bid_id = l.id
      LEFT JOIN users u
        ON u.id = COALESCE(d.user_id, l.user_id)
      LEFT JOIN crawled_items ci
        ON CONVERT(ci.item_id USING utf8mb4) =
           CONVERT(COALESCE(i.source_item_id, d.item_id, l.item_id) USING utf8mb4)
      LEFT JOIN wms_repair_vendors rv
        ON rv.name = rc.vendor_name
      ORDER BY rc.updated_at DESC
      LIMIT 1000
      `,
    );

    res.json({ ok: true, cases: rows });
  } catch (error) {
    console.error("repair cases error:", error);
    res.status(500).json({ ok: false, message: "수선제안 목록 조회 실패" });
  } finally {
    conn.release();
  }
});

router.post("/cases", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);

    const itemId = Number(req.body?.itemId);
    const decisionType = String(req.body?.decisionType || "")
      .trim()
      .toUpperCase();
    const vendorNameInput = String(req.body?.vendorName || "").trim();
    const repairNote = String(req.body?.repairNote || "").trim();
    const repairEta = String(req.body?.repairEta || "").trim();
    const internalNote = String(req.body?.internalNote || "").trim();
    const repairAmount = toAmount(req.body?.repairAmount);
    const caseStateInput = String(req.body?.caseState || "").trim().toUpperCase();
    const action = String(req.body?.action || "").trim().toLowerCase();
    const proposeRequested =
      action === "propose" ||
      caseStateInput === REPAIR_CASE_STATES.PROPOSED ||
      req.body?.isProposal === true;

    if (!itemId) {
      return res.status(400).json({ ok: false, message: "itemId가 필요합니다." });
    }
    if (!["INTERNAL", "EXTERNAL", "NONE"].includes(decisionType)) {
      return res.status(400).json({
        ok: false,
        message: "수선 구분은 INTERNAL/EXTERNAL/NONE만 가능합니다.",
      });
    }
    if (proposeRequested && decisionType === "NONE") {
      return res.status(400).json({
        ok: false,
        message: "무수선(NONE) 건은 제안등록할 수 없습니다.",
      });
    }
    if (decisionType === "EXTERNAL" && !vendorNameInput) {
      return res
        .status(400)
        .json({ ok: false, message: "외부수선은 외주업체 선택이 필요합니다." });
    }
    if ((decisionType === "INTERNAL" || proposeRequested) && repairAmount === null) {
      return res.status(400).json({
        ok: false,
        message: "견적금액을 입력하세요.",
      });
    }

    await conn.beginTransaction();

    const item = await fetchRepairItemWithMeta(conn, itemId);
    if (!item) {
      await conn.rollback();
      return res.status(404).json({ ok: false, message: "물건을 찾을 수 없습니다." });
    }

    const [existingRows] = await conn.query(
      `
      SELECT id, case_state
      FROM wms_repair_cases
      WHERE item_id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [itemId],
    );
    const existing = existingRows[0] || null;
    if (
      existing &&
      [REPAIR_CASE_STATES.ACCEPTED, REPAIR_CASE_STATES.DONE].includes(
        existing.case_state,
      )
    ) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        message: "이미 진행중/완료된 수선건은 국내도착 단계에서 수정할 수 없습니다.",
      });
    }

    const vendorName =
      decisionType === "EXTERNAL"
        ? vendorNameInput
        : decisionType === "NONE"
          ? "무수선"
          : "까사(내부)";
    if (decisionType === "EXTERNAL") {
      await conn.query(
        `
        INSERT INTO wms_repair_vendors (name, is_active)
        VALUES (?, 1)
        ON DUPLICATE KEY UPDATE
          is_active = 1,
          updated_at = NOW()
        `,
        [vendorName],
      );
    }

    const proposalText =
      decisionType === "NONE"
        ? null
        : buildProposalText({
            companyName: item.company_name || item.member_name,
            productTitle: item.product_title,
            barcode: item.internal_barcode || item.external_barcode,
            repairNote,
            repairAmount,
            repairEta,
            vendorName,
            scheduledAt: item.scheduled_at,
          });

    const loginId = String(req.session?.user?.login_id || "admin");
    let nextCaseState = REPAIR_CASE_STATES.DRAFT;
    if (proposeRequested) {
      nextCaseState = REPAIR_CASE_STATES.PROPOSED;
    } else if (decisionType === "INTERNAL") {
      // 내부수선은 견적 입력 즉시 고객 전송 대기 단계로 바로 이동
      nextCaseState = REPAIR_CASE_STATES.READY_TO_SEND;
    } else if (decisionType === "EXTERNAL") {
      // 외부수선은 시트 회신 전까지 견적대기(DRAFT) 유지
      nextCaseState = REPAIR_CASE_STATES.DRAFT;
    }

    let caseId = existing?.id || null;
    if (!existing) {
      const [insertResult] = await conn.query(
        `
        INSERT INTO wms_repair_cases (
          item_id,
          case_state,
          decision_type,
          vendor_name,
          repair_note,
          repair_amount,
          repair_eta,
          proposal_text,
          internal_note,
          proposed_at,
          created_by,
          updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          itemId,
          nextCaseState,
          decisionType,
          vendorName,
          repairNote || null,
          repairAmount,
          repairEta || null,
          proposalText,
          internalNote || null,
          proposeRequested ? new Date() : null,
          loginId,
          loginId,
        ],
      );
      caseId = Number(insertResult.insertId);
    } else {
      await conn.query(
        `
        UPDATE wms_repair_cases
        SET case_state = ?,
            decision_type = ?,
            vendor_name = ?,
            repair_note = ?,
            repair_amount = ?,
            repair_eta = ?,
            proposal_text = ?,
            internal_note = ?,
            proposed_at = CASE WHEN ? = 'PROPOSED' THEN NOW() ELSE proposed_at END,
            rejected_at = CASE WHEN ? = 'PROPOSED' THEN NULL ELSE rejected_at END,
            updated_by = ?,
            updated_at = NOW()
        WHERE id = ?
        `,
        [
          nextCaseState,
          decisionType,
          vendorName,
          repairNote || null,
          repairAmount,
          repairEta || null,
          proposalText,
          internalNote || null,
          nextCaseState,
          nextCaseState,
          loginId,
          existing.id,
        ],
      );
      caseId = Number(existing.id);
    }

    await conn.commit();

    let autoSheet = null;
    if (decisionType === "EXTERNAL" && !proposeRequested) {
      try {
        const [vendorRows] = await conn.query(
          `
          SELECT sheet_url, sheet_id, sheet_gid
          FROM wms_repair_vendors
          WHERE name = ?
          LIMIT 1
          `,
          [vendorName],
        );
        const vendor = vendorRows[0] || {};
        const parsedSheet = parseGoogleSheetLink(vendor.sheet_url);
        const sheetId = vendor.sheet_id || parsedSheet.sheetId;
        const sheetGid = vendor.sheet_gid || parsedSheet.sheetGid;
        const barcode = String(item.internal_barcode || item.external_barcode || "").trim();

        if (!sheetId) {
          autoSheet = { ok: false, reason: "시트 미연결" };
        } else if (!barcode) {
          autoSheet = { ok: false, reason: "바코드 없음" };
        } else {
          const pushed = await upsertVendorSheetRow({
            sheetId,
            sheetGid,
            barcode,
            bidDate: formatDateForSheet(item.scheduled_at),
            productTitle: item.product_title || "",
            customerName: item.company_name || item.member_name || "",
            repairNote: repairNote || "",
            workPeriod: repairEta || "",
            vendorName: vendorName || "",
            productImage: item.product_image || "",
            progressFlag: "FALSE",
          });

          if (pushed?.error) {
            autoSheet = { ok: false, reason: pushed.error };
          } else {
            await conn.query(
              `
              UPDATE wms_repair_cases
              SET external_sent_at = NOW(),
                  external_synced_at = NULL,
                  updated_by = ?,
                  updated_at = NOW()
              WHERE id = ?
              `,
              [loginId, caseId],
            );
            autoSheet = { ok: true, created: !!pushed.created };
          }
        }
      } catch (error) {
        autoSheet = { ok: false, reason: error?.message || "알 수 없는 오류" };
      }
    }

    const baseMessage = proposeRequested
      ? "고객응답대기 단계로 이동했습니다."
      : decisionType === "EXTERNAL"
        ? "외부 수선 정보가 저장되었습니다. (시트전송완료/견적대기)"
        : "내부 수선 정보가 저장되었습니다. (견적완료/고객전송대기)";
    const message =
      autoSheet === null
        ? baseMessage
        : autoSheet.ok
          ? `${baseMessage} (외부 수선 시트 전송 완료)`
          : `${baseMessage} (외부 수선 시트 전송 실패: ${autoSheet.reason})`;

    res.json({
      ok: true,
      message,
      result: {
        caseId,
        itemId,
        caseState: nextCaseState,
        decisionType,
        vendorName,
        proposalText,
        autoSheet,
      },
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {}
    console.error("repair save error:", error);
    res.status(500).json({ ok: false, message: "수선제안 저장 실패" });
  } finally {
    conn.release();
  }
});

router.post("/cases/:id/push-external-sheet", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const caseId = Number(req.params?.id);
    if (!caseId) {
      return res.status(400).json({ ok: false, message: "case id가 필요합니다." });
    }

    await conn.beginTransaction();
    const [rows] = await conn.query(
      `
      SELECT
        rc.id,
        rc.item_id,
        rc.case_state,
        rc.decision_type,
        rc.vendor_name,
        rc.repair_note,
        rc.repair_amount,
        rc.repair_eta,
        i.internal_barcode,
        i.external_barcode,
        rv.sheet_url,
        rv.sheet_id,
        rv.sheet_gid
      FROM wms_repair_cases rc
      INNER JOIN wms_items i
        ON i.id = rc.item_id
      LEFT JOIN wms_repair_vendors rv
        ON rv.name = rc.vendor_name
      WHERE rc.id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [caseId],
    );
    const row = rows[0];
    if (!row) {
      await conn.rollback();
      return res.status(404).json({ ok: false, message: "수선건을 찾을 수 없습니다." });
    }
    if (row.case_state === REPAIR_CASE_STATES.DONE) {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: "완료된 건은 외주시트 전송할 수 없습니다." });
    }
    if (row.decision_type !== "EXTERNAL") {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: "외부수선(EXTERNAL) 건만 전송할 수 있습니다." });
    }

    const barcode = String(row.internal_barcode || row.external_barcode || "").trim();
    if (!barcode) {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: "내부바코드가 없어 전송할 수 없습니다." });
    }

    const parsedSheet = parseGoogleSheetLink(row.sheet_url);
    const sheetId = row.sheet_id || parsedSheet.sheetId;
    const sheetGid = row.sheet_gid || parsedSheet.sheetGid;
    if (!sheetId) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        message: "업체 시트 링크가 등록되지 않았습니다. 업체 설정에서 시트 링크를 등록하세요.",
      });
    }

    const item = await fetchRepairItemWithMeta(conn, row.item_id);
    const pushed = await upsertVendorSheetRow({
      sheetId,
      sheetGid,
      barcode,
      bidDate: formatDateForSheet(item?.scheduled_at),
      productTitle: item?.product_title || "",
      customerName: item?.company_name || item?.member_name || "",
      repairNote: row.repair_note || "",
      workPeriod: row.repair_eta || "",
      vendorName: row.vendor_name || "",
      productImage: item?.product_image || "",
      progressFlag: "FALSE",
    });
    if (pushed?.error) {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: pushed.error });
    }

    const loginId = String(req.session?.user?.login_id || "admin");
    await conn.query(
      `
      UPDATE wms_repair_cases
      SET external_sent_at = NOW(),
          updated_by = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [loginId, caseId],
    );

    await conn.commit();
    res.json({
      ok: true,
      message: pushed.created
        ? "외주시트 전송 완료 (신규 행 추가)"
        : "외주시트 전송 완료 (기존 행 갱신)",
      result: { caseId, barcode, created: !!pushed.created },
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {}
    console.error("repair external push error:", error);
    res.status(500).json({ ok: false, message: "외주시트 전송 실패" });
  } finally {
    conn.release();
  }
});

router.post("/external-sheet/push-pending", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const force = req.body?.force === true;
    const vendorName = String(req.body?.vendorName || "").trim();
    const loginId = String(req.session?.user?.login_id || "admin");

    const where = [
      `rc.decision_type = 'EXTERNAL'`,
      `rc.case_state IN ('DRAFT', 'REJECTED', 'READY_TO_SEND', 'PROPOSED')`,
    ];
    const params = [];
    if (!force) {
      where.push(`rc.external_sent_at IS NULL`);
    }
    if (vendorName) {
      where.push(`rc.vendor_name = ?`);
      params.push(vendorName);
    }

    const [rows] = await conn.query(
      `
      SELECT
        rc.id,
        rc.item_id,
        rc.vendor_name,
        rc.repair_note,
        rc.repair_amount,
        rc.repair_eta,
        i.internal_barcode,
        i.external_barcode,
        rv.sheet_url,
        rv.sheet_id,
        rv.sheet_gid
      FROM wms_repair_cases rc
      INNER JOIN wms_items i
        ON i.id = rc.item_id
      LEFT JOIN wms_repair_vendors rv
        ON rv.name = rc.vendor_name
      WHERE ${where.join(" AND ")}
      ORDER BY rc.updated_at DESC
      LIMIT 200
      `,
      params,
    );

    let successCount = 0;
    const failed = [];
    for (const row of rows) {
      const barcode = String(row.internal_barcode || row.external_barcode || "").trim();
      if (!barcode) {
        failed.push({ caseId: row.id, reason: "바코드 없음" });
        continue;
      }
      const parsedSheet = parseGoogleSheetLink(row.sheet_url);
      const sheetId = row.sheet_id || parsedSheet.sheetId;
      const sheetGid = row.sheet_gid || parsedSheet.sheetGid;
      if (!sheetId) {
        failed.push({ caseId: row.id, reason: "업체 시트 링크 미등록" });
        continue;
      }
      try {
        const item = await fetchRepairItemWithMeta(conn, row.item_id);
        const pushed = await upsertVendorSheetRow({
          sheetId,
          sheetGid,
          barcode,
          bidDate: formatDateForSheet(item?.scheduled_at),
          productTitle: item?.product_title || "",
          customerName: item?.company_name || item?.member_name || "",
          repairNote: row.repair_note || "",
          workPeriod: row.repair_eta || "",
          vendorName: row.vendor_name || "",
          productImage: item?.product_image || "",
          progressFlag: "FALSE",
        });
        if (pushed?.error) {
          failed.push({ caseId: row.id, reason: pushed.error });
          continue;
        }
        await conn.query(
          `
          UPDATE wms_repair_cases
          SET external_sent_at = NOW(),
              updated_by = ?,
              updated_at = NOW()
          WHERE id = ?
          `,
          [loginId, row.id],
        );
        successCount += 1;
      } catch (error) {
        failed.push({
          caseId: row.id,
          reason: error?.message || "알 수 없는 오류",
        });
      }
    }

    res.json({
      ok: true,
      message: `외주시트 일괄전송 완료: 성공 ${successCount}건 / 실패 ${failed.length}건`,
      result: {
        total: rows.length,
        success: successCount,
        failedCount: failed.length,
        failed: failed.slice(0, 20),
      },
    });
  } catch (error) {
    console.error("repair external batch push error:", error);
    res.status(500).json({ ok: false, message: "외주시트 일괄전송 실패" });
  } finally {
    conn.release();
  }
});

router.post("/items/:itemId/no-repair-complete", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const itemId = Number(req.params?.itemId);
    if (!itemId) {
      return res.status(400).json({ ok: false, message: "item id가 필요합니다." });
    }

    await conn.beginTransaction();
    const [itemRows] = await conn.query(
      `
      SELECT
        id,
        internal_barcode,
        external_barcode,
        current_location_code,
        current_status,
        source_bid_type,
        source_bid_id,
        source_item_id
      FROM wms_items
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [itemId],
    );
    const item = itemRows[0];
    if (!item) {
      await conn.rollback();
      return res.status(404).json({ ok: false, message: "물건을 찾을 수 없습니다." });
    }
    if (item.current_location_code !== "DOMESTIC_ARRIVAL_ZONE") {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        message: "국내도착 단계에서만 무수선 완료 처리할 수 있습니다.",
      });
    }

    const [caseRows] = await conn.query(
      `
      SELECT id, case_state
      FROM wms_repair_cases
      WHERE item_id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [itemId],
    );
    const existing = caseRows[0] || null;
    if (existing?.case_state === REPAIR_CASE_STATES.ACCEPTED) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        message: "이미 수선 진행중인 건은 무수선 완료로 바꿀 수 없습니다.",
      });
    }

    const loginId = String(req.session?.user?.login_id || "admin");
    let caseId = existing?.id || null;
    if (!existing) {
      const [insertResult] = await conn.query(
        `
        INSERT INTO wms_repair_cases (
          item_id,
          case_state,
          decision_type,
          vendor_name,
          repair_note,
          repair_amount,
          proposal_text,
          completed_at,
          created_by,
          updated_by
        ) VALUES (?, ?, 'NONE', '무수선', ?, 0, NULL, NOW(), ?, ?)
        `,
        [itemId, REPAIR_CASE_STATES.DONE, "무수선 진행", loginId, loginId],
      );
      caseId = Number(insertResult.insertId);
    } else {
      await conn.query(
        `
        UPDATE wms_repair_cases
        SET case_state = ?,
            decision_type = 'NONE',
            vendor_name = '무수선',
            repair_note = ?,
            repair_amount = 0,
            repair_eta = NULL,
            proposal_text = NULL,
            completed_at = NOW(),
            updated_by = ?,
            updated_at = NOW()
        WHERE id = ?
        `,
        [REPAIR_CASE_STATES.DONE, "무수선 진행", loginId, existing.id],
      );
      caseId = Number(existing.id);
    }

    await moveItemToZone({
      conn,
      item,
      toZoneCode: "REPAIR_DONE_ZONE",
      actionType: "REPAIR_SKIP_DONE",
      staffName: loginId,
      note: "무수선 완료 처리",
    });
    await syncBidStatusByLocation(conn, item, "REPAIR_DONE_ZONE");

    await conn.commit();
    res.json({
      ok: true,
      message: "무수선 완료 처리되었습니다. 수선완료존으로 이동했습니다.",
      result: { caseId, itemId },
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {}
    console.error("repair no-repair error:", error);
    res.status(500).json({ ok: false, message: "무수선 완료 처리 실패" });
  } finally {
    conn.release();
  }
});

router.post("/cases/:id/sync-external-quote", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const caseId = Number(req.params?.id);
    if (!caseId) {
      return res.status(400).json({ ok: false, message: "case id가 필요합니다." });
    }

    await conn.beginTransaction();
    const [rows] = await conn.query(
      `
      SELECT
        rc.id,
        rc.item_id,
        rc.case_state,
        rc.decision_type,
        rc.vendor_name,
        rc.repair_note,
        rc.repair_eta,
        i.internal_barcode,
        i.external_barcode,
        rv.sheet_url,
        rv.sheet_id,
        rv.sheet_gid
      FROM wms_repair_cases rc
      INNER JOIN wms_items i
        ON i.id = rc.item_id
      LEFT JOIN wms_repair_vendors rv
        ON rv.name = rc.vendor_name
      WHERE rc.id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [caseId],
    );
    const row = rows[0];
    if (!row) {
      await conn.rollback();
      return res.status(404).json({ ok: false, message: "수선건을 찾을 수 없습니다." });
    }
    if (row.decision_type !== "EXTERNAL") {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: "외부수선 건만 동기화할 수 있습니다." });
    }

    const barcode = String(row.internal_barcode || row.external_barcode || "").trim();
    if (!barcode) {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: "내부바코드가 없어 동기화할 수 없습니다." });
    }

    const parsedSheet = parseGoogleSheetLink(row.sheet_url);
    const sheetId = row.sheet_id || parsedSheet.sheetId;
    const sheetGid = row.sheet_gid || parsedSheet.sheetGid;
    if (!sheetId) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        message: "업체 시트 링크가 등록되지 않았습니다. 업체 설정에서 시트 링크를 등록하세요.",
      });
    }

    const quote = await fetchVendorSheetQuote({ sheetId, sheetGid, barcode });
    if (quote?.error) {
      const quoteErrorText = String(quote.error || "");
      const shouldAutoCreateRow =
        (quoteErrorText.includes("시트에서 바코드") && quoteErrorText.includes("행을 찾지 못했습니다")) ||
        quoteErrorText.includes("시트 데이터가 비어 있습니다.") ||
        quoteErrorText.includes("시트 헤더를 찾지 못했습니다");
      if (shouldAutoCreateRow) {
        const item = await fetchRepairItemWithMeta(conn, row.item_id);
        const pushed = await upsertVendorSheetRow({
          sheetId,
          sheetGid,
          barcode,
          bidDate: formatDateForSheet(item?.scheduled_at),
          productTitle: item?.product_title || "",
          customerName: item?.company_name || item?.member_name || "",
          repairNote: row.repair_note || "",
          workPeriod: row.repair_eta || "",
          vendorName: row.vendor_name || "",
          productImage: item?.product_image || "",
          progressFlag: row.case_state === REPAIR_CASE_STATES.ACCEPTED ? "TRUE" : "FALSE",
        });
        if (pushed?.error) {
          await conn.rollback();
          return res.status(500).json({
            ok: false,
            message: `외주시트 재생성 실패: ${pushed.error}`,
          });
        }

        const loginId = String(req.session?.user?.login_id || "admin");
        await conn.query(
          `
          UPDATE wms_repair_cases
          SET external_sent_at = COALESCE(external_sent_at, NOW()),
              updated_by = ?,
              updated_at = NOW()
          WHERE id = ?
          `,
          [loginId, caseId],
        );

        await conn.commit();
        return res.json({
          ok: true,
          message: "시트가 비어있거나 바코드 행이 없어 자동으로 생성했습니다. 업체가 견적 입력 후 다시 동기화하세요.",
          result: {
            caseId,
            barcode,
            recreated: true,
          },
        });
      }
      await conn.rollback();
      return res.status(404).json({
        ok: false,
        message: quote.error,
      });
    }

    const quoteAmountRawText = String(quote.quoteAmountRaw ?? "").trim();
    const quoteAmount = toAmount(quote.quoteAmountRaw);
    if (quoteAmount === null) {
      if (!quoteAmountRawText) {
        const loginId = String(req.session?.user?.login_id || "admin");
        await conn.query(
          `
          UPDATE wms_repair_cases
          SET external_sent_at = COALESCE(external_sent_at, NOW()),
              external_synced_at = NOW(),
              updated_by = ?,
              updated_at = NOW()
          WHERE id = ?
          `,
          [loginId, caseId],
        );
        await conn.commit();
        return res.json({
          ok: true,
          message: "외주시트 행 동기화 완료. 현재 견적이 비어있어 금액 반영은 하지 않았습니다.",
          result: {
            caseId,
            barcode,
            quotePending: true,
          },
        });
      }
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        message: "시트 견적금액 형식이 올바르지 않습니다.",
      });
    }

    const addNotes = [];
    if (quote.noteRaw) addNotes.push(String(quote.noteRaw).trim());
    const mergedRepairNote = [String(row.repair_note || "").trim(), ...addNotes]
      .filter(Boolean)
      .join(" / ");
    const mergedRepairEta = String(quote.etaRaw || row.repair_eta || "").trim() || null;

    const item = await fetchRepairItemWithMeta(conn, row.item_id);
    const proposalText = buildProposalText({
      companyName: item?.company_name || item?.member_name,
      productTitle: item?.product_title,
      barcode: item?.internal_barcode || item?.external_barcode || barcode,
      repairNote: mergedRepairNote,
      repairAmount: quoteAmount,
      repairEta: mergedRepairEta,
      vendorName: row.vendor_name,
      scheduledAt: item?.scheduled_at,
    });

    const loginId = String(req.session?.user?.login_id || "admin");
    await conn.query(
      `
      UPDATE wms_repair_cases
      SET repair_amount = ?,
          repair_note = ?,
          repair_eta = ?,
          proposal_text = ?,
          case_state = CASE
            WHEN case_state IN ('PROPOSED', 'ACCEPTED', 'DONE') THEN case_state
            ELSE 'READY_TO_SEND'
          END,
          external_sent_at = COALESCE(external_sent_at, NOW()),
          external_synced_at = NOW(),
          updated_by = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [quoteAmount, mergedRepairNote || null, mergedRepairEta, proposalText, loginId, caseId],
    );

    await conn.commit();

    res.json({
      ok: true,
      message:
        Number(quote?.matchedCount || 0) > 1
          ? `외주 시트 견적을 동기화했습니다. (견적완료/고객전송대기, 동일 바코드 ${quote.matchedCount}행 중 R${quote.pickedRowNumber} 사용)`
          : "외주 시트 견적을 동기화했습니다. (견적완료/고객전송대기)",
      result: {
        caseId,
        caseState: REPAIR_CASE_STATES.READY_TO_SEND,
        quoteAmount,
        eta: quote.etaRaw || null,
        note: quote.noteRaw || null,
        barcode,
        matchedCount: Number(quote?.matchedCount || 0),
        pickedRowNumber: quote?.pickedRowNumber || null,
      },
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {}
    console.error("repair external sync error:", error);
    res.status(500).json({ ok: false, message: "외주 시트 동기화 실패" });
  } finally {
    conn.release();
  }
});

router.post("/cases/:id/accept", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const caseId = Number(req.params?.id);
    if (!caseId) {
      return res.status(400).json({ ok: false, message: "case id가 필요합니다." });
    }

    await conn.beginTransaction();
    const [rows] = await conn.query(
      `
      SELECT
        rc.id,
        rc.item_id,
        rc.case_state,
        rc.decision_type,
        rc.vendor_name,
        rc.repair_note,
        rc.repair_amount,
        rc.repair_eta,
        rv.sheet_url,
        rv.sheet_id,
        rv.sheet_gid,
        i.internal_barcode,
        i.external_barcode,
        i.current_location_code,
        i.current_status,
        i.source_bid_type,
        i.source_bid_id,
        i.source_item_id
      FROM wms_repair_cases rc
      INNER JOIN wms_items i
        ON i.id = rc.item_id
      LEFT JOIN wms_repair_vendors rv
        ON rv.name = rc.vendor_name
      WHERE rc.id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [caseId],
    );
    const row = rows[0];
    if (!row) {
      await conn.rollback();
      return res.status(404).json({ ok: false, message: "수선건을 찾을 수 없습니다." });
    }
    if (row.case_state !== REPAIR_CASE_STATES.PROPOSED) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        message: "고객응답대기(PROPOSED) 상태에서만 수락할 수 있습니다.",
      });
    }

    const { zoneCode, actionType } = zoneAndStatusByDecision(row.decision_type);
    const loginId = String(req.session?.user?.login_id || "admin");

    await conn.query(
      `
      UPDATE wms_repair_cases
      SET case_state = ?,
          accepted_at = NOW(),
          rejected_at = NULL,
          updated_by = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [REPAIR_CASE_STATES.ACCEPTED, loginId, caseId],
    );

    await moveItemToZone({
      conn,
      item: row,
      toZoneCode: zoneCode,
      actionType,
      staffName: loginId,
      note: row.decision_type === "EXTERNAL" ? `외주업체: ${row.vendor_name || "-"}` : "내부수선 진행 시작",
    });

    await syncBidStatusByLocation(conn, row, zoneCode);
    let sheetProgressWarning = null;
    if (row.decision_type === "EXTERNAL") {
      const barcode = String(row.internal_barcode || row.external_barcode || "").trim();
      const parsedSheet = parseGoogleSheetLink(row.sheet_url);
      const sheetId = row.sheet_id || parsedSheet.sheetId;
      const sheetGid = row.sheet_gid || parsedSheet.sheetGid;
      if (!sheetId) {
        sheetProgressWarning = "외주시트 미연결로 수선진행여부 체크를 건너뜀";
      } else if (!barcode) {
        sheetProgressWarning = "바코드 없음으로 수선진행여부 체크를 건너뜀";
      } else {
        try {
          const itemMeta = await fetchRepairItemWithMeta(conn, row.item_id);
          const pushed = await upsertVendorSheetRow({
            sheetId,
            sheetGid,
            barcode,
            bidDate: formatDateForSheet(itemMeta?.scheduled_at),
            productTitle: itemMeta?.product_title || "",
            customerName: itemMeta?.company_name || itemMeta?.member_name || "",
            repairNote: row.repair_note || "",
            workPeriod: row.repair_eta || "",
            vendorName: row.vendor_name || "",
            productImage: itemMeta?.product_image || "",
            progressFlag: "TRUE",
          });
          if (pushed?.error) {
            sheetProgressWarning = `수선진행여부 체크 실패: ${pushed.error}`;
          }
        } catch (error) {
          sheetProgressWarning = `수선진행여부 체크 실패: ${error?.message || "알 수 없는 오류"}`;
        }
      }
    }
    await conn.commit();

    res.json({
      ok: true,
      message: sheetProgressWarning
        ? `수락 처리되었습니다. 수선 진행 존으로 이동했습니다. (${sheetProgressWarning})`
        : "수락 처리되었습니다. 수선 진행 존으로 이동했습니다.",
      result: {
        caseId,
        zoneCode,
        caseState: REPAIR_CASE_STATES.ACCEPTED,
        sheetProgressWarning,
      },
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {}
    console.error("repair accept error:", error);
    res.status(500).json({ ok: false, message: "수선 수락 처리 실패" });
  } finally {
    conn.release();
  }
});

router.post("/cases/:id/mark-sent", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const caseId = Number(req.params?.id);
    if (!caseId) {
      return res.status(400).json({ ok: false, message: "case id가 필요합니다." });
    }

    const [rows] = await conn.query(
      `
      SELECT id, case_state
      FROM wms_repair_cases
      WHERE id = ?
      LIMIT 1
      `,
      [caseId],
    );
    const row = rows[0];
    if (!row) {
      return res.status(404).json({ ok: false, message: "수선건을 찾을 수 없습니다." });
    }
    if (![REPAIR_CASE_STATES.READY_TO_SEND, REPAIR_CASE_STATES.REJECTED].includes(row.case_state)) {
      return res.status(400).json({
        ok: false,
        message: "견적완료/고객전송대기(또는 거절) 단계에서만 전송완료 처리할 수 있습니다.",
      });
    }

    const loginId = String(req.session?.user?.login_id || "admin");
    await conn.query(
      `
      UPDATE wms_repair_cases
      SET case_state = ?,
          proposed_at = NOW(),
          rejected_at = NULL,
          updated_by = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [REPAIR_CASE_STATES.PROPOSED, loginId, caseId],
    );

    return res.json({
      ok: true,
      message: "고객 전송완료 처리되었습니다. 고객응답대기로 이동했습니다.",
      result: { caseId, caseState: REPAIR_CASE_STATES.PROPOSED },
    });
  } catch (error) {
    console.error("repair mark-sent error:", error);
    return res.status(500).json({ ok: false, message: "전송완료 처리 실패" });
  } finally {
    conn.release();
  }
});

router.post("/cases/:id/reject", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const caseId = Number(req.params?.id);
    if (!caseId) {
      return res.status(400).json({ ok: false, message: "case id가 필요합니다." });
    }
    const loginId = String(req.session?.user?.login_id || "admin");

    const [result] = await conn.query(
      `
      UPDATE wms_repair_cases
      SET case_state = ?,
          rejected_at = NOW(),
          updated_by = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [REPAIR_CASE_STATES.REJECTED, loginId, caseId],
    );
    if (!result.affectedRows) {
      return res.status(404).json({ ok: false, message: "수선건을 찾을 수 없습니다." });
    }
    res.json({ ok: true, message: "수선 제안을 거절 처리했습니다.", result: { caseId } });
  } catch (error) {
    console.error("repair reject error:", error);
    res.status(500).json({ ok: false, message: "수선 거절 처리 실패" });
  } finally {
    conn.release();
  }
});

router.post("/cases/:id/repair-complete", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const caseId = Number(req.params?.id);
    if (!caseId) {
      return res.status(400).json({ ok: false, message: "case id가 필요합니다." });
    }

    await conn.beginTransaction();
    const [rows] = await conn.query(
      `
      SELECT
        rc.id,
        rc.item_id,
        rc.case_state,
        rc.decision_type,
        i.internal_barcode,
        i.external_barcode,
        i.current_location_code,
        i.current_status,
        i.source_bid_type,
        i.source_bid_id,
        i.source_item_id
      FROM wms_repair_cases rc
      INNER JOIN wms_items i
        ON i.id = rc.item_id
      WHERE rc.id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [caseId],
    );
    const row = rows[0];
    if (!row) {
      await conn.rollback();
      return res.status(404).json({ ok: false, message: "수선건을 찾을 수 없습니다." });
    }
    if (row.case_state !== REPAIR_CASE_STATES.ACCEPTED) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        message: "수락된 수선건만 완료 처리할 수 있습니다.",
      });
    }

    const loginId = String(req.session?.user?.login_id || "admin");
    await conn.query(
      `
      UPDATE wms_repair_cases
      SET case_state = ?,
          completed_at = NOW(),
          updated_by = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [REPAIR_CASE_STATES.DONE, loginId, caseId],
    );

    await moveItemToZone({
      conn,
      item: row,
      toZoneCode: "REPAIR_DONE_ZONE",
      actionType: "REPAIR_DONE",
      staffName: loginId,
      note: "수선완료 처리",
    });
    await syncBidStatusByLocation(conn, row, "REPAIR_DONE_ZONE");

    await conn.commit();
    res.json({ ok: true, message: "수선완료 처리되었습니다.", result: { caseId } });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {}
    console.error("repair done error:", error);
    res.status(500).json({ ok: false, message: "수선완료 처리 실패" });
  } finally {
    conn.release();
  }
});

router.post("/cases/:id/ship", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const caseId = Number(req.params?.id);
    if (!caseId) {
      return res.status(400).json({ ok: false, message: "case id가 필요합니다." });
    }

    await conn.beginTransaction();
    const [rows] = await conn.query(
      `
      SELECT
        rc.id,
        rc.item_id,
        rc.case_state,
        i.internal_barcode,
        i.external_barcode,
        i.current_location_code,
        i.current_status,
        i.source_bid_type,
        i.source_bid_id,
        i.source_item_id
      FROM wms_repair_cases rc
      INNER JOIN wms_items i
        ON i.id = rc.item_id
      WHERE rc.id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [caseId],
    );
    const row = rows[0];
    if (!row) {
      await conn.rollback();
      return res.status(404).json({ ok: false, message: "수선건을 찾을 수 없습니다." });
    }
    if (
      ![REPAIR_CASE_STATES.ACCEPTED, REPAIR_CASE_STATES.DONE].includes(
        row.case_state,
      )
    ) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        message: "진행중/완료 수선건만 출고완료 처리할 수 있습니다.",
      });
    }

    const loginId = String(req.session?.user?.login_id || "admin");
    await conn.query(
      `
      UPDATE wms_repair_cases
      SET case_state = ?,
          updated_by = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [REPAIR_CASE_STATES.DONE, loginId, caseId],
    );

    await moveItemToZone({
      conn,
      item: row,
      toZoneCode: "OUTBOUND_ZONE",
      actionType: "SHIP_OUTBOUND_DONE",
      staffName: loginId,
      note: "출고완료 처리",
    });
    await syncBidStatusByLocation(conn, row, "OUTBOUND_ZONE");

    await conn.commit();
    res.json({ ok: true, message: "출고완료 처리되었습니다.", result: { caseId } });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {}
    console.error("repair ship error:", error);
    res.status(500).json({ ok: false, message: "출고완료 처리 실패" });
  } finally {
    conn.release();
  }
});

router.get("/export.csv", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);

    const [rows] = await conn.query(
      `
      SELECT
        rc.id,
        rc.item_id,
        i.internal_barcode,
        i.member_name,
        COALESCE(ci.original_title, ci.title) AS product_title,
        rc.case_state,
        rc.decision_type,
        rc.vendor_name,
        rc.repair_note,
        rc.repair_amount,
        rc.repair_eta,
        rc.proposal_text,
        rc.proposed_at,
        rc.accepted_at,
        rc.rejected_at,
        rc.completed_at,
        rc.external_sent_at,
        rc.external_synced_at,
        rc.updated_by,
        rc.updated_at
      FROM wms_repair_cases rc
      INNER JOIN wms_items i
        ON i.id = rc.item_id
      LEFT JOIN crawled_items ci
        ON BINARY ci.item_id = BINARY i.source_item_id
      ORDER BY rc.updated_at DESC
      LIMIT 5000
      `,
    );

    const headers = [
      "case_id",
      "item_id",
      "internal_barcode",
      "member_name",
      "product_title",
      "case_state",
      "decision_type",
      "vendor_name",
      "repair_note",
      "repair_amount",
      "repair_eta",
      "proposal_text",
      "proposed_at",
      "accepted_at",
      "rejected_at",
      "completed_at",
      "external_sent_at",
      "external_synced_at",
      "updated_by",
      "updated_at",
    ];

    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [headers.join(",")];
    for (const row of rows) {
      lines.push(headers.map((key) => esc(row[key])).join(","));
    }

    const csv = `\uFEFF${lines.join("\n")}`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=repair_cases_${Date.now()}.csv`,
    );
    res.send(csv);
  } catch (error) {
    console.error("repair export error:", error);
    res.status(500).json({ ok: false, message: "CSV 내보내기 실패" });
  } finally {
    conn.release();
  }
});

module.exports = router;
