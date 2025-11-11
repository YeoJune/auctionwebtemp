// routes/bid-results.js
const express = require("express");
const router = express.Router();
const { pool } = require("../utils/DB");
const { createAppraisalFromAuction } = require("../utils/appr");
const { createOrUpdateSettlement } = require("../utils/settlement");
const { calculateTotalPrice, calculateFee } = require("../utils/calculate-fee");
const { getExchangeRate } = require("../utils/exchange-rate");

// 수수료 상수 (나중에 수정 가능)
const REPAIR_FEE = 0; // 원 (VAT 포함) - 나중에 수수료 추가 시 이 값만 변경

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

/**
 * GET /api/bid-results
 * 사용자의 일별 입찰 결과 조회
 */
router.get("/", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;
  const isAdminUser = userId === "admin";

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
    // 날짜 범위 계산
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - parseInt(dateRange));
    const fromDate = dateLimit.toISOString().split("T")[0];

    // ✅ 1단계: 모든 입찰이 있는 날짜 조회
    let dateQuery;
    let dateParams;

    if (isAdminUser) {
      // 관리자: 모든 사용자의 날짜
      dateQuery = `
        SELECT DISTINCT DATE(i.scheduled_date) as bid_date
        FROM (
          SELECT item_id FROM live_bids
          UNION
          SELECT item_id FROM direct_bids
        ) as bids
        JOIN crawled_items i ON bids.item_id = i.item_id
        WHERE DATE(i.scheduled_date) >= ?
        ORDER BY bid_date ${sortOrder.toUpperCase()}
      `;
      dateParams = [fromDate];
    } else {
      // 일반 사용자: 해당 사용자의 날짜만
      dateQuery = `
        SELECT DISTINCT DATE(i.scheduled_date) as bid_date
        FROM (
          SELECT item_id FROM live_bids WHERE user_id = ?
          UNION
          SELECT item_id FROM direct_bids WHERE user_id = ?
        ) as bids
        JOIN crawled_items i ON bids.item_id = i.item_id
        WHERE DATE(i.scheduled_date) >= ?
        ORDER BY bid_date ${sortOrder.toUpperCase()}
      `;
      dateParams = [userId, userId, fromDate];
    }

    const [allDates] = await connection.query(dateQuery, dateParams);

    const totalDates = allDates.length;

    // 페이지네이션 적용
    const offset = (page - 1) * limit;
    const paginatedDates = allDates.slice(offset, offset + parseInt(limit));

    console.log(
      `총 ${totalDates}개 날짜 중 ${paginatedDates.length}개 날짜 조회`
    );

    // ✅ 2단계: 각 날짜별 데이터 수집
    const dailyResults = [];

    for (const dateRow of paginatedDates) {
      const targetDate = dateRow.bid_date;

      // ✅ 정산 정보 조회
      let settlementQuery;
      let settlementParams;

      if (isAdminUser) {
        settlementQuery = `
          SELECT * FROM daily_settlements 
          WHERE settlement_date = ?
        `;
        settlementParams = [targetDate];
      } else {
        settlementQuery = `
          SELECT * FROM daily_settlements 
          WHERE user_id = ? AND settlement_date = ?
        `;
        settlementParams = [userId, targetDate];
      }

      const [settlements] = await connection.query(
        settlementQuery,
        settlementParams
      );

      let settlementInfo = null;
      if (settlements.length > 0) {
        settlementInfo = settlements[0];
      }

      // ✅ 해당 날짜의 모든 입찰 조회 - live_bids
      let liveBidsQuery;
      let liveBidsParams;

      if (isAdminUser) {
        liveBidsQuery = `
          SELECT 
            l.id, 'live' as type, l.status, l.user_id,
            l.first_price, l.second_price, l.final_price, l.winning_price, 
            l.appr_id, l.repair_requested_at, l.created_at, l.updated_at, l.completed_at,
            i.item_id, i.original_title, i.title, i.brand, i.category, i.image, 
            i.scheduled_date, i.auc_num, i.rank, i.starting_price
          FROM live_bids l
          JOIN crawled_items i ON l.item_id = i.item_id
          WHERE DATE(i.scheduled_date) = ?
        `;
        liveBidsParams = [targetDate];
      } else {
        liveBidsQuery = `
          SELECT 
            l.id, 'live' as type, l.status, l.user_id,
            l.first_price, l.second_price, l.final_price, l.winning_price, 
            l.appr_id, l.repair_requested_at, l.created_at, l.updated_at, l.completed_at,
            i.item_id, i.original_title, i.title, i.brand, i.category, i.image, 
            i.scheduled_date, i.auc_num, i.rank, i.starting_price
          FROM live_bids l
          JOIN crawled_items i ON l.item_id = i.item_id
          WHERE l.user_id = ? AND DATE(i.scheduled_date) = ?
        `;
        liveBidsParams = [userId, targetDate];
      }

      const [liveBids] = await connection.query(liveBidsQuery, liveBidsParams);

      // ✅ 해당 날짜의 모든 입찰 조회 - direct_bids
      let directBidsQuery;
      let directBidsParams;

      if (isAdminUser) {
        directBidsQuery = `
          SELECT 
            d.id, 'direct' as type, d.status, d.user_id,
            d.current_price as final_price, d.winning_price, 
            d.appr_id, d.repair_requested_at, d.created_at, d.updated_at, d.completed_at,
            i.item_id, i.original_title, i.title, i.brand, i.category, i.image,
            i.scheduled_date, i.auc_num, i.rank, i.starting_price
          FROM direct_bids d
          JOIN crawled_items i ON d.item_id = i.item_id
          WHERE DATE(i.scheduled_date) = ?
        `;
        directBidsParams = [targetDate];
      } else {
        directBidsQuery = `
          SELECT 
            d.id, 'direct' as type, d.status, d.user_id,
            d.current_price as final_price, d.winning_price, 
            d.appr_id, d.repair_requested_at, d.created_at, d.updated_at, d.completed_at,
            i.item_id, i.original_title, i.title, i.brand, i.category, i.image,
            i.scheduled_date, i.auc_num, i.rank, i.starting_price
          FROM direct_bids d
          JOIN crawled_items i ON d.item_id = i.item_id
          WHERE d.user_id = ? AND DATE(i.scheduled_date) = ?
        `;
        directBidsParams = [userId, targetDate];
      }

      const [directBids] = await connection.query(
        directBidsQuery,
        directBidsParams
      );

      const allItems = [...liveBids, ...directBids];

      if (allItems.length === 0) {
        continue; // 이 날짜는 건너뜀
      }

      // 환율 결정
      const exchangeRate = settlementInfo
        ? settlementInfo.exchange_rate
        : await getExchangeRate();

      // ✅ 상태별 분류 및 관부가세 계산
      const successItems = [];
      const failedItems = [];
      const pendingItems = [];

      let totalJapanesePrice = 0;
      let totalKoreanPrice = 0;
      let appraisalCount = 0;

      allItems.forEach((item) => {
        const bid_status = classifyBidStatus(item);

        // 관부가세 포함 가격 계산
        let koreanPrice = 0;
        if (bid_status === "success" || bid_status === "failed") {
          const price = parseInt(item.winning_price) || 0;
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

          // 성공한 아이템만 집계
          if (bid_status === "success") {
            totalJapanesePrice += price;
            totalKoreanPrice += koreanPrice;
            if (item.appr_id) {
              appraisalCount++;
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

      // ✅ 수수료 계산 (성공 아이템이 있을 때만)
      let feeAmount = 0;
      let vatAmount = 0;
      let appraisalFee = 0;
      let appraisalVat = 0;
      let grandTotal = 0;

      if (!isAdminUser && settlementInfo) {
        // 정산 정보가 있으면 사용
        feeAmount = settlementInfo.fee_amount;
        vatAmount = settlementInfo.vat_amount;
        appraisalFee = settlementInfo.appraisal_fee;
        appraisalVat = settlementInfo.appraisal_vat;
        grandTotal = settlementInfo.final_amount;
      } else if (successItems.length > 0) {
        // ✅ 사용자 수수료율 조회 (일반 사용자만)
        let userCommissionRate = null;
        if (!isAdminUser) {
          const [userRows] = await connection.query(
            "SELECT commission_rate FROM users WHERE id = ?",
            [userId]
          );
          if (userRows.length > 0) {
            userCommissionRate = userRows[0].commission_rate;
          }
        }

        feeAmount = Math.max(
          calculateFee(totalKoreanPrice, userCommissionRate),
          10000
        );
        vatAmount = Math.round((feeAmount / 1.1) * 0.1);
        appraisalFee = appraisalCount * 16500;
        appraisalVat = Math.round(appraisalFee / 11);
        grandTotal = totalKoreanPrice + feeAmount + appraisalFee;
      }

      dailyResults.push({
        date: targetDate,
        successItems,
        failedItems,
        pendingItems,
        itemCount: successItems.length,
        totalItemCount: allItems.length,
        totalJapanesePrice,
        totalKoreanPrice,
        feeAmount,
        vatAmount,
        appraisalFee,
        appraisalVat,
        appraisalCount,
        grandTotal,
        exchangeRate,
        settlementId: settlementInfo?.id || null,
        paymentStatus: settlementInfo?.status || null,
      });
    }

    // ✅ 관리자용 총 통계 (전체 기간)
    let totalStats = null;
    if (isAdminUser) {
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
        totalPages: Math.ceil(totalDates / limit),
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

/**
 * POST /api/bid-results/live/:id/request-repair
 * 현장 경매 수선 접수
 */
router.post("/live/:id/request-repair", async (req, res) => {
  const bidId = req.params.id;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [bids] = await connection.query(
      `SELECT l.*, i.brand, i.title 
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

    if (bid.repair_requested_at) {
      await connection.rollback();
      return res.status(400).json({
        message: "이미 수선을 접수했습니다.",
        requested_at: bid.repair_requested_at,
      });
    }

    await connection.query(
      "UPDATE live_bids SET repair_requested_at = NOW() WHERE id = ?",
      [bidId]
    );

    await connection.commit();

    // 정산 업데이트 (수수료가 0원이어도 기록)
    if (bid.scheduled_date) {
      const settlementDate = new Date(bid.scheduled_date)
        .toISOString()
        .split("T")[0];
      createOrUpdateSettlement(bid.user_id, settlementDate).catch(
        console.error
      );
    }

    res.status(201).json({
      message: "수선 접수가 완료되었습니다.",
      requested_at: new Date(),
      fee: REPAIR_FEE,
    });
  } catch (err) {
    await connection.rollback();
    console.error("수선 접수 중 오류 발생:", err);
    res.status(500).json({
      message: err.message || "수선 접수 중 오류가 발생했습니다.",
    });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/bid-results/direct/:id/request-repair
 * 직접 경매 수선 접수
 */
router.post("/direct/:id/request-repair", async (req, res) => {
  const bidId = req.params.id;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [bids] = await connection.query(
      `SELECT d.*, i.brand, i.title 
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

    if (bid.repair_requested_at) {
      await connection.rollback();
      return res.status(400).json({
        message: "이미 수선을 접수했습니다.",
        requested_at: bid.repair_requested_at,
      });
    }

    await connection.query(
      "UPDATE direct_bids SET repair_requested_at = NOW() WHERE id = ?",
      [bidId]
    );

    await connection.commit();

    // 정산 업데이트 (수수료가 0원이어도 기록)
    if (bid.scheduled_date) {
      const settlementDate = new Date(bid.scheduled_date)
        .toISOString()
        .split("T")[0];
      createOrUpdateSettlement(bid.user_id, settlementDate).catch(
        console.error
      );
    }

    res.status(201).json({
      message: "수선 접수가 완료되었습니다.",
      requested_at: new Date(),
      fee: REPAIR_FEE,
    });
  } catch (err) {
    await connection.rollback();
    console.error("수선 접수 중 오류 발생:", err);
    res.status(500).json({
      message: err.message || "수선 접수 중 오류가 발생했습니다.",
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
