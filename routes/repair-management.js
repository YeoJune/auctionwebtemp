const express = require("express");
const { pool } = require("../utils/DB");
const { requireAdmin } = require("../utils/adminAuth");
const { backfillCompletedWmsItemsByBidStatus } = require("../utils/wms-bid-sync");

const router = express.Router();

const DEFAULT_VENDORS = ["리리", "크리뉴", "성신사(종로)", "연희", "까사(내부)"];

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
      proposal_text LONGTEXT NULL,
      internal_note TEXT NULL,
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

  const caseCols = await getTableColumns(conn, "wms_repair_cases");
  if (!caseCols.has("decision_type")) {
    await conn.query(`ALTER TABLE wms_repair_cases ADD COLUMN decision_type VARCHAR(30) NULL`);
  }
  if (!caseCols.has("vendor_name")) {
    await conn.query(`ALTER TABLE wms_repair_cases ADD COLUMN vendor_name VARCHAR(120) NULL`);
  }
  if (!caseCols.has("repair_note")) {
    await conn.query(`ALTER TABLE wms_repair_cases ADD COLUMN repair_note TEXT NULL`);
  }
  if (!caseCols.has("repair_amount")) {
    await conn.query(`ALTER TABLE wms_repair_cases ADD COLUMN repair_amount DECIMAL(14,2) NULL`);
  }
  if (!caseCols.has("proposal_text")) {
    await conn.query(`ALTER TABLE wms_repair_cases ADD COLUMN proposal_text LONGTEXT NULL`);
  }
  if (!caseCols.has("internal_note")) {
    await conn.query(`ALTER TABLE wms_repair_cases ADD COLUMN internal_note TEXT NULL`);
  }
  if (!caseCols.has("created_by")) {
    await conn.query(`ALTER TABLE wms_repair_cases ADD COLUMN created_by VARCHAR(100) NULL`);
  }
  if (!caseCols.has("updated_by")) {
    await conn.query(`ALTER TABLE wms_repair_cases ADD COLUMN updated_by VARCHAR(100) NULL`);
  }

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
  const numeric = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(numeric) ? numeric : null;
}

function formatMonthDayKR(dt) {
  if (!dt) return "";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return String(dt);
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

function buildProposalText({
  companyName,
  productTitle,
  barcode,
  repairNote,
  repairAmount,
  vendorName,
  scheduledAt,
}) {
  const safeCompany = companyName || "회원사 미확인";
  const safeDate = formatMonthDayKR(scheduledAt) || "(날짜 미확인)";
  const safeTitle = productTitle || "상품명 미확인";
  const safeBarcode = barcode || "내부바코드 없음";
  const safeNote = repairNote || "(수선내용 입력 필요)";
  const safeAmount = repairAmount != null ? `${Number(repairAmount).toLocaleString()}원 (vat 별도)` : "(금액 입력 필요)";
  const safeVendor = vendorName || "(외주업체 선택 필요)";

  return [
    `${safeCompany}`,
    `안녕하세요, ${safeDate} 일 낙찰 상품 중`,
    "",
    `1. ${safeTitle}`,
    `내부바코드: ${safeBarcode}`,
    "",
    "수선내용 :",
    `1. ${safeNote}`,
    "",
    "소요기간 :",
    "",
    "수선금액 :",
    `1. ${safeAmount}`,
    "",
    "총 합계: " + safeAmount,
    "",
    `[외주 업체]`,
    safeVendor,
    "",
    "진행 여부 회신 부탁드립니다.",
    "감사합니다.",
  ].join("\n");
}

function zoneAndStatusByDecision(decisionType) {
  if (decisionType === "INTERNAL") {
    return {
      zoneCode: "INTERNAL_REPAIR_ZONE",
      statusCode: "INTERNAL_REPAIR_IN_PROGRESS",
      actionType: "REPAIR_INTERNAL_START",
    };
  }

  return {
    zoneCode: "EXTERNAL_REPAIR_ZONE",
    statusCode: "EXTERNAL_REPAIR_IN_PROGRESS",
    actionType: "REPAIR_EXTERNAL_START",
  };
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
      AND status IN ('completed', 'domestic_arrived', 'processing', 'shipped')
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
      AND status IN ('completed', 'domestic_arrived', 'processing', 'shipped')
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
}

async function syncBidStatusByLocation(conn, item, toLocationCode) {
  const normalizedToLocationCode = normalizeLocationCode(toLocationCode);
  let nextBidStatus = null;
  if (normalizedToLocationCode === "DOMESTIC_ARRIVAL_ZONE" || normalizedToLocationCode === "INBOUND_ZONE") {
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

  const tableName = bidType === "direct" ? "direct_bids" : "live_bids";
  const [colRows] = await conn.query(
    `
    SELECT COLUMN_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = 'status'
    LIMIT 1
    `,
    [tableName],
  );
  const columnType = colRows?.[0]?.COLUMN_TYPE || "";
  const enumValues = Array.from(columnType.matchAll(/'([^']+)'/g)).map((m) => m[1]);
  const statusUpdatable = enumValues.includes(nextBidStatus);

  if (statusUpdatable) {
    if (bidType === "direct") {
      await conn.query(`UPDATE direct_bids SET status = ?, updated_at = NOW() WHERE id = ?`, [nextBidStatus, bidId]);
    } else {
      await conn.query(`UPDATE live_bids SET status = ?, updated_at = NOW() WHERE id = ?`, [nextBidStatus, bidId]);
    }
  }

  await conn.query(
    `
    INSERT INTO bid_workflow_stages (bid_type, bid_id, stage)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE
      stage = VALUES(stage),
      updated_at = NOW()
    `,
    [bidType, bidId, nextBidStatus],
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

router.get("/vendors", isAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureRepairTables(conn);
    const [rows] = await conn.query(
      `
      SELECT id, name
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
    if (!name) return res.status(400).json({ ok: false, message: "업체명을 입력하세요." });

    await conn.query(
      `
      INSERT INTO wms_repair_vendors (name, is_active)
      VALUES (?, 1)
      ON DUPLICATE KEY UPDATE
        is_active = 1,
        updated_at = NOW()
      `,
      [name],
    );

    res.json({ ok: true, message: "외주업체가 등록되었습니다." });
  } catch (error) {
    console.error("repair vendor create error:", error);
    res.status(500).json({ ok: false, message: "외주업체 등록 실패" });
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
        rc.decision_type,
        rc.vendor_name,
        rc.repair_note,
        rc.repair_amount,
        rc.proposal_text,
        rc.updated_at AS repair_updated_at
      FROM wms_items i
      LEFT JOIN direct_bids d
        ON i.source_bid_type = 'direct'
       AND i.source_bid_id = d.id
      LEFT JOIN live_bids l
        ON i.source_bid_type = 'live'
       AND i.source_bid_id = l.id
      LEFT JOIN wms_repair_cases rc
        ON rc.item_id = i.id
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
        rc.decision_type,
        rc.vendor_name,
        rc.repair_note,
        rc.repair_amount,
        rc.proposal_text,
        rc.internal_note,
        rc.updated_by,
        rc.updated_at,
        i.internal_barcode,
        i.member_name,
        i.current_location_code,
        i.current_status,
        COALESCE(ci.original_title, ci.title) AS product_title
      FROM wms_repair_cases rc
      INNER JOIN wms_items i
        ON i.id = rc.item_id
      LEFT JOIN crawled_items ci
        ON BINARY ci.item_id = BINARY i.source_item_id
      ORDER BY rc.updated_at DESC
      LIMIT 500
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
    const decisionType = String(req.body?.decisionType || "").trim().toUpperCase();
    const vendorNameInput = String(req.body?.vendorName || "").trim();
    const repairNote = String(req.body?.repairNote || "").trim();
    const internalNote = String(req.body?.internalNote || "").trim();
    const repairAmount = toAmount(req.body?.repairAmount);

    if (!itemId) return res.status(400).json({ ok: false, message: "itemId가 필요합니다." });
    if (!["INTERNAL", "EXTERNAL"].includes(decisionType)) {
      return res.status(400).json({ ok: false, message: "수선 구분은 INTERNAL/EXTERNAL만 가능합니다." });
    }

    if (decisionType === "EXTERNAL" && !vendorNameInput) {
      return res.status(400).json({ ok: false, message: "외부수선은 외주업체 선택이 필요합니다." });
    }

    const vendorName = decisionType === "EXTERNAL" ? vendorNameInput : "까사(내부)";

    await conn.beginTransaction();

    const [itemRows] = await conn.query(
      `
      SELECT
        i.id,
        i.member_name,
        i.internal_barcode,
        i.current_location_code,
        i.current_status,
        i.source_bid_type,
        i.source_bid_id,
        i.source_item_id,
        i.source_scheduled_date,
        COALESCE(ci.original_scheduled_date, ci.scheduled_date, i.source_scheduled_date) AS scheduled_at,
        COALESCE(ci.original_title, ci.title) AS product_title
      FROM wms_items i
      LEFT JOIN crawled_items ci
        ON BINARY ci.item_id = BINARY i.source_item_id
      WHERE i.id = ?
      LIMIT 1
      `,
      [itemId],
    );

    const item = itemRows[0];
    if (!item) {
      await conn.rollback();
      return res.status(404).json({ ok: false, message: "물건을 찾을 수 없습니다." });
    }

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

    const proposalText = buildProposalText({
      companyName: item.member_name,
      productTitle: item.product_title,
      barcode: item.internal_barcode,
      repairNote,
      repairAmount,
      vendorName,
      scheduledAt: item.scheduled_at,
    });

    const loginId = String(req.session?.user?.login_id || "admin");

    await conn.query(
      `
      INSERT INTO wms_repair_cases (
        item_id,
        decision_type,
        vendor_name,
        repair_note,
        repair_amount,
        proposal_text,
        internal_note,
        created_by,
        updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        decision_type = VALUES(decision_type),
        vendor_name = VALUES(vendor_name),
        repair_note = VALUES(repair_note),
        repair_amount = VALUES(repair_amount),
        proposal_text = VALUES(proposal_text),
        internal_note = VALUES(internal_note),
        updated_by = VALUES(updated_by),
        updated_at = NOW()
      `,
      [
        itemId,
        decisionType,
        vendorName,
        repairNote || null,
        repairAmount,
        proposalText,
        internalNote || null,
        loginId,
        loginId,
      ],
    );

    const { zoneCode, statusCode, actionType } = zoneAndStatusByDecision(decisionType);

    await conn.query(
      `
      UPDATE wms_items
      SET current_location_code = ?,
          current_status = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [zoneCode, statusCode, itemId],
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
        itemId,
        item.internal_barcode || item.external_barcode || `ITEM:${itemId}`,
        item.current_location_code,
        zoneCode,
        item.current_status,
        statusCode,
        actionType,
        loginId,
        decisionType === "EXTERNAL" ? `외주업체: ${vendorName}` : "내부수선 배정",
      ],
    );

    await syncBidStatusByLocation(conn, item, zoneCode);

    await conn.commit();

    res.json({
      ok: true,
      message: "수선제안이 저장되고 존이 이동되었습니다.",
      result: {
        itemId,
        decisionType,
        zoneCode,
        statusCode,
        vendorName,
        proposalText,
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
        rc.decision_type,
        rc.vendor_name,
        rc.repair_note,
        rc.repair_amount,
        rc.proposal_text,
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
      "decision_type",
      "vendor_name",
      "repair_note",
      "repair_amount",
      "proposal_text",
      "updated_by",
      "updated_at",
    ];

    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [headers.join(",")];
    for (const row of rows) {
      lines.push(
        headers
          .map((key) => esc(row[key]))
          .join(","),
      );
    }

    const csv = `\uFEFF${lines.join("\n")}`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=repair_cases_${Date.now()}.csv`);
    res.send(csv);
  } catch (error) {
    console.error("repair export error:", error);
    res.status(500).json({ ok: false, message: "CSV 내보내기 실패" });
  } finally {
    conn.release();
  }
});

module.exports = router;
