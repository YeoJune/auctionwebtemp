// routes/bid-results.js
const express = require("express");
const router = express.Router();
const { pool } = require("../utils/DB");
const { createAppraisalFromAuction } = require("../utils/appr");
const { createOrUpdateSettlement } = require("../utils/settlement");
const { calculateTotalPrice } = require("../utils/calculate-fee");

// 미들웨어
const isAdmin = (req, res, next) => {
  if (req.session.user?.id === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Access denied. Admin only." });
  }
};

// =====================================================
// 일반 사용자 API
// =====================================================

router.get("/", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;
  const isAdmin = userId === "admin";

  const {
    dateRange = 30,
    page = 1,
    limit = 7,
    sortBy = "date",
    sortOrder = "desc",
    status,
  } = req.query;

  const connection = await pool.getConnection();

  try {
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - parseInt(dateRange));
    const fromDate = dateLimit.toISOString().split("T")[0];

    // ✨ 1. 모든 입찰 날짜 조회 (성공/실패/대기 모두 포함)
    let userCondition = "";
    const dateParams = [fromDate];

    if (!isAdmin) {
      userCondition = "AND user_id = ?";
      dateParams.push(userId);
    }

    const [allDates] = await connection.query(
      `SELECT DISTINCT DATE(i.scheduled_date) as bid_date
       FROM (
         SELECT item_id, user_id FROM live_bids 
         WHERE user_id ${isAdmin ? "IS NOT NULL" : "= ?"}
         UNION
         SELECT item_id, user_id FROM direct_bids 
         WHERE user_id ${isAdmin ? "IS NOT NULL" : "= ?"}
       ) as bids
       LEFT JOIN crawled_items i ON bids.item_id = i.item_id
       WHERE DATE(i.scheduled_date) >= ?
       ${userCondition}
       ORDER BY bid_date ${sortOrder.toUpperCase()}`,
      isAdmin ? [fromDate] : [userId, userId, fromDate]
    );

    console.log(`총 ${allDates.length}개의 입찰 날짜 발견`);

    // ✨ 2. 페이지네이션 적용
    const totalDates = allDates.length;
    const totalPages = Math.ceil(totalDates / limit);
    const offset = (page - 1) * limit;
    const paginatedDates = allDates.slice(offset, offset + parseInt(limit));

    // ✨ 3. 각 날짜별로 데이터 조회
    const dailyResults = [];

    for (const dateRow of paginatedDates) {
      const date = dateRow.bid_date;

      // 3-1. 해당 날짜의 settlement 정보 조회
      const [settlements] = await connection.query(
        `SELECT * FROM daily_settlements 
         WHERE settlement_date = ? AND user_id ${
           isAdmin ? "IS NOT NULL" : "= ?"
         }`,
        isAdmin ? [date] : [date, userId]
      );

      const settlement = settlements[0] || null;

      // 3-2. 해당 날짜의 모든 입찰 조회
      const userFilter = isAdmin ? "1=1" : "l.user_id = ?";
      const userParams = isAdmin ? [date] : [userId, date];

      const [liveBids] = await connection.query(
        `SELECT 
          l.id, 'live' as type, l.status,
          l.first_price, l.second_price, l.final_price, l.winning_price, 
          l.appr_id, l.user_id, l.created_at, l.updated_at,
          i.item_id, i.original_title, i.title, i.brand, i.category, i.image, 
          i.scheduled_date, i.auc_num, i.rank, i.starting_price
         FROM live_bids l
         LEFT JOIN crawled_items i ON l.item_id = i.item_id
         WHERE ${userFilter} AND DATE(i.scheduled_date) = ?`,
        userParams
      );

      const [directBids] = await connection.query(
        `SELECT 
          d.id, 'direct' as type, d.status,
          d.current_price as final_price, d.winning_price, 
          d.appr_id, d.user_id, d.created_at, d.updated_at,
          i.item_id, i.original_title, i.title, i.brand, i.category, i.image,
          i.scheduled_date, i.auc_num, i.rank, i.starting_price
         FROM direct_bids d
         LEFT JOIN crawled_items i ON d.item_id = i.item_id
         WHERE ${userFilter} AND DATE(i.scheduled_date) = ?`,
        userParams
      );

      const allItems = [...liveBids, ...directBids];

      if (allItems.length === 0) {
        console.log(`${date}: 입찰 없음 (스킵)`);
        continue;
      }

      // 3-3. 상태별 분류 및 가격 계산
      const successItems = [];
      const failedItems = [];
      const pendingItems = [];

      // 환율: settlement가 있으면 그 환율, 없으면 현재 환율
      const exchangeRate = settlement?.exchange_rate || 9.5;

      allItems.forEach((item) => {
        const bid_status = classifyBidStatus(item);

        // 관부가세 포함 가격 계산
        let koreanPrice = 0;
        if (bid_status === "success" || bid_status === "failed") {
          const price = item.winning_price || 0;
          if (price > 0 && item.auc_num && item.category) {
            try {
              koreanPrice = calculateTotalPrice(
                price,
                item.auc_num,
                item.category,
                exchangeRate
              );
            } catch (error) {
              console.error("관부가세 계산 오류:", error);
              koreanPrice = 0;
            }
          }
        }

        const itemData = {
          ...item,
          koreanPrice,
          finalPrice: item.final_price,
          winningPrice: item.winning_price,
          item: {
            item_id: item.item_id,
            original_title: item.original_title,
            title: item.title,
            brand: item.brand,
            category: item.category,
            image: item.image,
            scheduled_date: item.scheduled_date,
            auc_num: item.auc_num,
            rank: item.rank,
            starting_price: item.starting_price,
          },
        };

        if (bid_status === "success") {
          successItems.push(itemData);
        } else if (bid_status === "failed") {
          failedItems.push(itemData);
        } else {
          pendingItems.push(itemData);
        }
      });

      // 3-4. 일별 결과 추가
      dailyResults.push({
        date: date,
        successItems,
        failedItems,
        pendingItems,
        itemCount: successItems.length,
        totalItemCount: allItems.length,

        // Settlement 정보 (있으면 사용, 없으면 0 또는 계산)
        totalJapanesePrice:
          settlement?.total_japanese_yen ||
          successItems.reduce((sum, item) => sum + (item.winningPrice || 0), 0),
        totalKoreanPrice:
          settlement?.total_amount ||
          successItems.reduce((sum, item) => sum + (item.koreanPrice || 0), 0),
        feeAmount: settlement?.fee_amount || 0,
        vatAmount: settlement?.vat_amount || 0,
        appraisalFee: settlement?.appraisal_fee || 0,
        appraisalVat: settlement?.appraisal_vat || 0,
        appraisalCount: settlement?.appraisal_count || 0,
        grandTotal: settlement?.final_amount || 0,
        exchangeRate: exchangeRate,
        settlementId: settlement?.id || null,
        paymentStatus: settlement?.status || null,
      });
    }

    // ✨ 4. 관리자용 총 통계 (모든 날짜 기준)
    let totalStats = null;
    if (isAdmin) {
      const [statsResult] = await connection.query(
        `SELECT 
          SUM(item_count) as itemCount,
          SUM(total_amount) as koreanAmount,
          SUM(fee_amount) as feeAmount,
          SUM(vat_amount) as vatAmount,
          SUM(appraisal_fee) as appraisalFee,
          SUM(appraisal_vat) as appraisalVat,
          SUM(final_amount) as grandTotalAmount
         FROM daily_settlements
         WHERE settlement_date >= ?`,
        [fromDate]
      );

      totalStats = statsResult[0];
    }

    res.json({
      dailyResults,
      totalStats,
      pagination: {
        currentPage: parseInt(page),
        totalPages: totalPages,
        totalItems: totalDates,
      },
    });
  } catch (err) {
    console.error("Error fetching bid results:", err);
    res.status(500).json({ message: "Error fetching bid results" });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/bid-results/live/:id/request-appraisal
 * 현장 경매 감정서 신청
 */
router.post("/live/:id/request-appraisal", async (req, res) => {
  const bidId = req.params.id;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [bids] = await connection.query(
      `SELECT l.*, i.brand, i.title, i.category, i.image, i.additional_images, i.scheduled_date
       FROM live_bids l 
       JOIN crawled_items i ON l.item_id = i.item_id 
       WHERE l.id = ? AND l.status IN ('completed', 'shipped') AND l.winning_price > 0`,
      [bidId]
    );

    if (
      bids.length === 0 ||
      !(bids[0].user_id == userId || userId == "admin")
    ) {
      await connection.rollback();
      return res.status(404).json({
        message: "낙찰된 상품을 찾을 수 없거나 접근 권한이 없습니다.",
      });
    }

    const bid = bids[0];

    if (bid.appr_id) {
      await connection.rollback();
      return res.status(400).json({
        message: "이미 감정서를 신청했습니다.",
        appraisal_id: bid.appr_id,
      });
    }

    const { appraisal_id, certificate_number } =
      await createAppraisalFromAuction(
        connection,
        bid,
        {
          brand: bid.brand,
          title: bid.title,
          category: bid.category,
          image: bid.image,
          additional_images: bid.additional_images,
        },
        userId
      );

    await connection.query("UPDATE live_bids SET appr_id = ? WHERE id = ?", [
      appraisal_id,
      bidId,
    ]);

    await connection.commit();

    // 정산 업데이트
    const settlementDate = new Date(bid.scheduled_date)
      .toISOString()
      .split("T")[0];
    createOrUpdateSettlement(bid.user_id, settlementDate).catch(console.error);

    res.status(201).json({
      message: "감정서 신청이 완료되었습니다.",
      appraisal_id,
      certificate_number,
      status: "pending",
    });
  } catch (err) {
    await connection.rollback();
    console.error("감정서 신청 중 오류 발생:", err);
    res.status(500).json({
      message: err.message || "감정서 신청 중 오류가 발생했습니다.",
    });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/bid-results/direct/:id/request-appraisal
 * 직접 경매 감정서 신청
 */
router.post("/direct/:id/request-appraisal", async (req, res) => {
  const bidId = req.params.id;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [bids] = await connection.query(
      `SELECT d.*, i.brand, i.title, i.category, i.image, i.additional_images, i.scheduled_date
       FROM direct_bids d 
       JOIN crawled_items i ON d.item_id = i.item_id 
       WHERE d.id = ? AND d.status IN ('completed', 'shipped') AND d.winning_price > 0`,
      [bidId]
    );

    if (
      bids.length === 0 ||
      !(bids[0].user_id == userId || userId == "admin")
    ) {
      await connection.rollback();
      return res.status(404).json({
        message: "낙찰된 상품을 찾을 수 없거나 접근 권한이 없습니다.",
      });
    }

    const bid = bids[0];

    if (bid.appr_id) {
      await connection.rollback();
      return res.status(400).json({
        message: "이미 감정서를 신청했습니다.",
        appraisal_id: bid.appr_id,
      });
    }

    const { appraisal_id, certificate_number } =
      await createAppraisalFromAuction(
        connection,
        bid,
        {
          brand: bid.brand,
          title: bid.title,
          category: bid.category,
          image: bid.image,
          additional_images: bid.additional_images,
        },
        userId
      );

    await connection.query("UPDATE direct_bids SET appr_id = ? WHERE id = ?", [
      appraisal_id,
      bidId,
    ]);

    await connection.commit();

    // 정산 업데이트
    const settlementDate = new Date(bid.scheduled_date)
      .toISOString()
      .split("T")[0];
    createOrUpdateSettlement(bid.user_id, settlementDate).catch(console.error);

    res.status(201).json({
      message: "감정서 신청이 완료되었습니다.",
      appraisal_id,
      certificate_number,
      status: "pending",
    });
  } catch (err) {
    await connection.rollback();
    console.error("감정서 신청 중 오류 발생:", err);
    res.status(500).json({
      message: err.message || "감정서 신청 중 오류가 발생했습니다.",
    });
  } finally {
    connection.release();
  }
});

// =====================================================
// 관리자 전용 API
// =====================================================

/**
 * GET /api/bid-results/admin/settlements
 * 전체 사용자의 일별 정산 관리
 */
router.get("/admin/settlements", isAdmin, async (req, res) => {
  const {
    user_id,
    status,
    fromDate,
    toDate,
    page = 1,
    limit = 20,
    sortBy = "settlement_date",
    sortOrder = "desc",
  } = req.query;

  const connection = await pool.getConnection();

  try {
    let whereClause = "1=1";
    const params = [];

    if (user_id) {
      whereClause += " AND user_id = ?";
      params.push(user_id);
    }

    if (status) {
      const statusArray = status.split(",");
      const placeholders = statusArray.map(() => "?").join(",");
      whereClause += ` AND status IN (${placeholders})`;
      params.push(...statusArray);
    }

    if (fromDate) {
      whereClause += " AND settlement_date >= ?";
      params.push(fromDate);
    }

    if (toDate) {
      whereClause += " AND settlement_date <= ?";
      params.push(toDate);
    }

    // 총 통계
    const [statsResult] = await connection.query(
      `SELECT 
        COUNT(*) as total_settlements,
        SUM(item_count) as total_items,
        SUM(final_amount) as total_amount,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed_count,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count
       FROM daily_settlements 
       WHERE ${whereClause}`,
      params
    );

    // 정렬
    const validSortColumns = [
      "settlement_date",
      "user_id",
      "final_amount",
      "status",
    ];
    const orderByColumn = validSortColumns.includes(sortBy)
      ? sortBy
      : "settlement_date";
    const orderByClause = `${orderByColumn} ${sortOrder.toUpperCase()}`;

    // 페이지네이션
    const offset = (page - 1) * limit;

    const [settlements] = await connection.query(
      `SELECT * FROM daily_settlements 
       WHERE ${whereClause}
       ORDER BY ${orderByClause}
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    res.json({
      settlements,
      stats: statsResult[0],
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(statsResult[0].total_settlements / limit),
        totalItems: statsResult[0].total_settlements,
      },
    });
  } catch (err) {
    console.error("Error fetching admin settlements:", err);
    res.status(500).json({ message: "Error fetching settlements" });
  } finally {
    connection.release();
  }
});

/**
 * PUT /api/bid-results/admin/settlements/:id
 * 정산 상태 업데이트
 */
router.put("/admin/settlements/:id", isAdmin, async (req, res) => {
  const settlementId = req.params.id;
  const { status, admin_memo } = req.body;

  if (!status || !["pending", "confirmed", "paid"].includes(status)) {
    return res.status(400).json({
      message: "Invalid status. Must be: pending, confirmed, or paid",
    });
  }

  const connection = await pool.getConnection();

  try {
    const updates = ["status = ?"];
    const params = [status];

    if (admin_memo !== undefined) {
      updates.push("admin_memo = ?");
      params.push(admin_memo);
    }

    if (status === "paid") {
      updates.push("paid_at = NOW()");
    }

    params.push(settlementId);

    await connection.query(
      `UPDATE daily_settlements SET ${updates.join(", ")} WHERE id = ?`,
      params
    );

    const [updated] = await connection.query(
      "SELECT * FROM daily_settlements WHERE id = ?",
      [settlementId]
    );

    res.json({
      message: "Settlement status updated successfully",
      settlement: updated[0],
    });
  } catch (err) {
    console.error("Error updating settlement:", err);
    res.status(500).json({ message: "Error updating settlement" });
  } finally {
    connection.release();
  }
});

/**
 * PUT /api/bid-results/admin/settlements/bulk-update
 * 일괄 상태 업데이트
 */
router.put("/admin/settlements/bulk-update", isAdmin, async (req, res) => {
  const { settlement_ids, status } = req.body;

  if (
    !settlement_ids ||
    !Array.isArray(settlement_ids) ||
    settlement_ids.length === 0
  ) {
    return res.status(400).json({ message: "Settlement IDs are required" });
  }

  if (!status || !["pending", "confirmed", "paid"].includes(status)) {
    return res.status(400).json({
      message: "Invalid status. Must be: pending, confirmed, or paid",
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const placeholders = settlement_ids.map(() => "?").join(",");
    let query = `UPDATE daily_settlements SET status = ? WHERE id IN (${placeholders})`;
    let params = [status, ...settlement_ids];

    if (status === "paid") {
      query = `UPDATE daily_settlements SET status = ?, paid_at = NOW() WHERE id IN (${placeholders})`;
    }

    const [result] = await connection.query(query, params);

    await connection.commit();

    res.json({
      message: `${result.affectedRows} settlements updated successfully`,
      affected_count: result.affectedRows,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error bulk updating settlements:", err);
    res.status(500).json({ message: "Error updating settlements" });
  } finally {
    connection.release();
  }
});

// =====================================================
// 헬퍼 함수
// =====================================================

function classifyBidStatus(item) {
  const winningPrice = Number(item.winning_price || 0);
  const finalPrice = Number(item.final_price || 0);

  if (!winningPrice || winningPrice === 0) {
    return "pending";
  }

  if (
    finalPrice >= winningPrice &&
    ["completed", "shipped"].includes(item.status)
  ) {
    return "success";
  }

  return "failed";
}

module.exports = router;
