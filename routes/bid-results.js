// routes/bid-results.js
const express = require("express");
const router = express.Router();
const { pool } = require("../utils/DB");
const { createAppraisalFromAuction } = require("../utils/appr");
const {
  createOrUpdateSettlement,
  adjustDepositBalance,
} = require("../utils/settlement");
const { calculateTotalPrice, calculateFee } = require("../utils/calculate-fee");
const { getExchangeRate } = require("../utils/exchange-rate");
const {
  deductDeposit,
  refundDeposit,
  deductLimit,
  refundLimit,
} = require("../utils/deposit");

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
      `총 ${totalDates}개 날짜 중 ${paginatedDates.length}개 날짜 조회`,
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
        settlementParams,
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
        directBidsParams,
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
                exchangeRate,
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
            [userId],
          );
          if (userRows.length > 0) {
            userCommissionRate = userRows[0].commission_rate;
          }
        }

        feeAmount = Math.max(
          calculateFee(totalKoreanPrice, userCommissionRate),
          10000,
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
        paymentStatus: settlementInfo?.payment_status || null,
        completedAmount: settlementInfo?.completed_amount || 0,
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
        [fromDate],
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
      [bidId],
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

    // 계정 정보 조회
    const [accounts] = await connection.query(
      `SELECT account_type, deposit_balance, daily_limit, daily_used 
      FROM user_accounts 
      WHERE user_id = ?`,
      [bid.user_id],
    );

    const account = accounts[0];
    const isIndividual = account?.account_type === "individual";

    // 환율 조회 및 원화 환산
    const settlementDate = new Date(bid.scheduled_date)
      .toISOString()
      .split("T")[0];
    const exchangeRate = await getExchangeRate(settlementDate);
    const krwAmount = Math.round(bid.winning_price * exchangeRate);
    const appraisalFee = 16500; // 감정비 (정산 시 appraisalCount * 16500과 동일)

    // 예치금/한도 차감 (별도 트랜잭션)
    const deductConnection = await pool.getConnection();
    try {
      await deductConnection.beginTransaction();

      if (isIndividual) {
        await deductDeposit(
          deductConnection,
          bid.user_id,
          appraisalFee,
          "appraisal",
          bidId,
          `Live auction appraisal fee for ${bid.title}`,
        );
      } else {
        await deductLimit(
          deductConnection,
          bid.user_id,
          appraisalFee,
          "appraisal",
          bidId,
          `Live auction appraisal fee for ${bid.title}`,
        );
      }

      await deductConnection.commit();
      console.log(
        `[Live Appraisal] ${isIndividual ? "Deposit" : "Limit"} deducted: ₩${appraisalFee.toLocaleString()} for bid ${bidId}`,
      );
    } catch (err) {
      await deductConnection.rollback();
      console.error(
        `[Live Appraisal] Failed to deduct ${isIndividual ? "deposit" : "limit"}:`,
        err,
      );
      throw err;
    } finally {
      deductConnection.release();
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
        userId,
      );

    await connection.query("UPDATE live_bids SET appr_id = ? WHERE id = ?", [
      appraisal_id,
      bidId,
    ]);

    await connection.commit();

    // 정산 업데이트 및 조정
    try {
      await createOrUpdateSettlement(bid.user_id, settlementDate);
      await adjustDepositBalance(
        bid.user_id,
        bid.winning_price,
        settlementDate,
        bid.title,
      );
    } catch (err) {
      console.error(`Error updating settlement for live appraisal:`, err);
    }

    // 잔액 확인 및 경고
    const [updatedAccounts] = await pool.query(
      `SELECT account_type, deposit_balance, daily_limit, daily_used 
      FROM user_accounts 
      WHERE user_id = ?`,
      [bid.user_id],
    );

    let balanceWarning = null;
    if (updatedAccounts[0]) {
      const acc = updatedAccounts[0];
      if (acc.account_type === "individual" && acc.deposit_balance < 0) {
        balanceWarning = `예치금 잔액이 부족합니다. 현재 잔액: ¥${acc.deposit_balance.toLocaleString()}`;
      } else if (
        acc.account_type === "corporate" &&
        acc.daily_used >= acc.daily_limit
      ) {
        balanceWarning = `일일 한도가 초과되었습니다. 사용액: ¥${acc.daily_used.toLocaleString()} / 한도: ¥${acc.daily_limit.toLocaleString()}`;
      }
    }

    res.status(201).json({
      message: "감정서 신청이 완료되었습니다.",
      appraisal_id,
      certificate_number,
      status: "pending",
      appraisal_fee: appraisalFee,
      balanceWarning,
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
      [bidId],
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

    // 계정 정보 조회
    const [accounts] = await connection.query(
      `SELECT account_type, deposit_balance, daily_limit, daily_used 
      FROM user_accounts 
      WHERE user_id = ?`,
      [bid.user_id],
    );

    const account = accounts[0];
    const isIndividual = account?.account_type === "individual";

    // 환율 조회 및 원화 환산
    const settlementDate = new Date(bid.scheduled_date)
      .toISOString()
      .split("T")[0];
    const exchangeRate = await getExchangeRate(settlementDate);
    const krwAmount = Math.round(bid.winning_price * exchangeRate);
    const appraisalFee = 16500; // 감정비 (정산 시 appraisalCount * 16500과 동일)

    // 예치금/한도 차감 (별도 트랜잭션)
    const deductConnection = await pool.getConnection();
    try {
      await deductConnection.beginTransaction();

      if (isIndividual) {
        await deductDeposit(
          deductConnection,
          bid.user_id,
          appraisalFee,
          "appraisal",
          bidId,
          `Direct auction appraisal fee for ${bid.title}`,
        );
      } else {
        await deductLimit(
          deductConnection,
          bid.user_id,
          appraisalFee,
          "appraisal",
          bidId,
          `Direct auction appraisal fee for ${bid.title}`,
        );
      }

      await deductConnection.commit();
      console.log(
        `[Direct Appraisal] ${isIndividual ? "Deposit" : "Limit"} deducted: ₩${appraisalFee.toLocaleString()} for bid ${bidId}`,
      );
    } catch (err) {
      await deductConnection.rollback();
      console.error(
        `[Direct Appraisal] Failed to deduct ${isIndividual ? "deposit" : "limit"}:`,
        err,
      );
      throw err;
    } finally {
      deductConnection.release();
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
        userId,
      );

    await connection.query("UPDATE direct_bids SET appr_id = ? WHERE id = ?", [
      appraisal_id,
      bidId,
    ]);

    await connection.commit();

    // 정산 업데이트 및 조정
    try {
      await createOrUpdateSettlement(bid.user_id, settlementDate);
      await adjustDepositBalance(
        bid.user_id,
        bid.winning_price,
        settlementDate,
        bid.title,
      );
    } catch (err) {
      console.error(`Error updating settlement for direct appraisal:`, err);
    }

    // 잔액 확인 및 경고
    const [updatedAccounts] = await pool.query(
      `SELECT account_type, deposit_balance, daily_limit, daily_used 
      FROM user_accounts 
      WHERE user_id = ?`,
      [bid.user_id],
    );

    let balanceWarning = null;
    if (updatedAccounts[0]) {
      const acc = updatedAccounts[0];
      if (acc.account_type === "individual" && acc.deposit_balance < 0) {
        balanceWarning = `예치금 잔액이 부족합니다. 현재 잔액: ¥${acc.deposit_balance.toLocaleString()}`;
      } else if (
        acc.account_type === "corporate" &&
        acc.daily_used >= acc.daily_limit
      ) {
        balanceWarning = `일일 한도가 초과되었습니다. 사용액: ¥${acc.daily_used.toLocaleString()} / 한도: ¥${acc.daily_limit.toLocaleString()}`;
      }
    }

    res.status(201).json({
      message: "감정서 신청이 완료되었습니다.",
      appraisal_id,
      certificate_number,
      status: "pending",
      appraisal_fee: appraisalFee,
      balanceWarning,
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
 * 현장 경매 수선 접수/수정 (어드민 전용)
 */
router.post("/live/:id/request-repair", async (req, res) => {
  const bidId = req.params.id;
  const { repair_details, repair_fee } = req.body;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;

  // 어드민만 수선 접수 가능
  if (userId !== "admin") {
    return res
      .status(403)
      .json({ message: "관리자만 수선 접수가 가능합니다." });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [bids] = await connection.query(
      `SELECT l.*, i.brand, i.title, i.scheduled_date
       FROM live_bids l 
       JOIN crawled_items i ON l.item_id = i.item_id 
       WHERE l.id = ? AND l.status IN ('completed', 'shipped') AND l.winning_price > 0`,
      [bidId],
    );

    if (bids.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "낙찰된 상품을 찾을 수 없습니다.",
      });
    }

    const bid = bids[0];
    const isUpdate = !!bid.repair_requested_at;

    // 계정 정보 조회
    const [accounts] = await connection.query(
      `SELECT account_type, deposit_balance, daily_limit, daily_used 
      FROM user_accounts 
      WHERE user_id = ?`,
      [bid.user_id],
    );

    const account = accounts[0];
    const isIndividual = account?.account_type === "individual";

    // 환율 조회 및 원화 환산
    const settlementDate = new Date(bid.scheduled_date)
      .toISOString()
      .split("T")[0];
    const exchangeRate = await getExchangeRate(settlementDate);
    const repairFee = repair_fee || 0;

    // 신규 접수이고 수선비가 있는 경우 예치금/한도 차감
    if (!isUpdate && repairFee > 0) {
      const deductConnection = await pool.getConnection();
      try {
        await deductConnection.beginTransaction();

        if (isIndividual) {
          await deductDeposit(
            deductConnection,
            bid.user_id,
            repairFee,
            "repair",
            bidId,
            `Live auction repair fee for ${bid.title}`,
          );
        } else {
          await deductLimit(
            deductConnection,
            bid.user_id,
            repairFee,
            "repair",
            bidId,
            `Live auction repair fee for ${bid.title}`,
          );
        }

        await deductConnection.commit();
        console.log(
          `[Live Repair] ${isIndividual ? "Deposit" : "Limit"} deducted: ₩${repairFee.toLocaleString()} for bid ${bidId}`,
        );
      } catch (err) {
        await deductConnection.rollback();
        console.error(
          `[Live Repair] Failed to deduct ${isIndividual ? "deposit" : "limit"}:`,
          err,
        );
        throw err;
      } finally {
        deductConnection.release();
      }
    }

    // 수선 내용과 금액 업데이트 (신규 또는 수정)
    if (isUpdate) {
      // 수정
      await connection.query(
        `UPDATE live_bids 
         SET repair_details = ?, 
             repair_fee = ? 
         WHERE id = ?`,
        [repair_details || null, repair_fee || null, bidId],
      );
    } else {
      // 신규 접수
      await connection.query(
        `UPDATE live_bids 
         SET repair_requested_at = NOW(), 
             repair_details = ?, 
             repair_fee = ? 
         WHERE id = ?`,
        [repair_details || null, repair_fee || null, bidId],
      );
    }

    await connection.commit();

    // 정산 업데이트 및 조정
    if (bid.scheduled_date) {
      try {
        await createOrUpdateSettlement(bid.user_id, settlementDate);
        await adjustDepositBalance(
          bid.user_id,
          bid.winning_price,
          settlementDate,
          bid.title,
        );
      } catch (err) {
        console.error(`Error updating settlement for live repair:`, err);
      }
    }

    // 잔액 확인 및 경고
    const [updatedAccounts] = await pool.query(
      `SELECT account_type, deposit_balance, daily_limit, daily_used 
      FROM user_accounts 
      WHERE user_id = ?`,
      [bid.user_id],
    );

    let balanceWarning = null;
    if (updatedAccounts[0]) {
      const acc = updatedAccounts[0];
      if (acc.account_type === "individual" && acc.deposit_balance < 0) {
        balanceWarning = `예치금 잔액이 부족합니다. 현재 잔액: ¥${acc.deposit_balance.toLocaleString()}`;
      } else if (
        acc.account_type === "corporate" &&
        acc.daily_used >= acc.daily_limit
      ) {
        balanceWarning = `일일 한도가 초과되었습니다. 사용액: ¥${acc.daily_used.toLocaleString()} / 한도: ¥${acc.daily_limit.toLocaleString()}`;
      }
    }

    res.status(isUpdate ? 200 : 201).json({
      message: isUpdate
        ? "수선 정보가 수정되었습니다."
        : "수선 접수가 완료되었습니다.",
      requested_at: bid.repair_requested_at || new Date(),
      repair_details,
      repair_fee,
      repair_fee_krw: repairFee,
      balanceWarning,
    });
  } catch (err) {
    await connection.rollback();
    console.error("수선 처리 중 오류 발생:", err);
    res.status(500).json({
      message: err.message || "수선 처리 중 오류가 발생했습니다.",
    });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/bid-results/direct/:id/request-repair
 * 직접 경매 수선 접수/수정 (어드민 전용)
 */
router.post("/direct/:id/request-repair", async (req, res) => {
  const bidId = req.params.id;
  const { repair_details, repair_fee } = req.body;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;

  // 어드민만 수선 접수 가능
  if (userId !== "admin") {
    return res
      .status(403)
      .json({ message: "관리자만 수선 접수가 가능합니다." });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [bids] = await connection.query(
      `SELECT d.*, i.brand, i.title, i.scheduled_date
       FROM direct_bids d 
       JOIN crawled_items i ON d.item_id = i.item_id 
       WHERE d.id = ? AND d.status IN ('completed', 'shipped') AND d.winning_price > 0`,
      [bidId],
    );

    if (bids.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "낙찰된 상품을 찾을 수 없습니다.",
      });
    }

    const bid = bids[0];
    const isUpdate = !!bid.repair_requested_at;

    // 계정 정보 조회
    const [accounts] = await connection.query(
      `SELECT account_type, deposit_balance, daily_limit, daily_used 
      FROM user_accounts 
      WHERE user_id = ?`,
      [bid.user_id],
    );

    const account = accounts[0];
    const isIndividual = account?.account_type === "individual";

    // 환율 조회 및 원화 환산
    const settlementDate = new Date(bid.scheduled_date)
      .toISOString()
      .split("T")[0];
    const exchangeRate = await getExchangeRate(settlementDate);
    const repairFee = repair_fee || 0;

    // 신규 접수이고 수선비가 있는 경우 예치금/한도 차감
    if (!isUpdate && repairFee > 0) {
      const deductConnection = await pool.getConnection();
      try {
        await deductConnection.beginTransaction();

        if (isIndividual) {
          await deductDeposit(
            deductConnection,
            bid.user_id,
            repairFee,
            "repair",
            bidId,
            `Direct auction repair fee for ${bid.title}`,
          );
        } else {
          await deductLimit(
            deductConnection,
            bid.user_id,
            repairFee,
            "repair",
            bidId,
            `Direct auction repair fee for ${bid.title}`,
          );
        }

        await deductConnection.commit();
        console.log(
          `[Direct Repair] ${isIndividual ? "Deposit" : "Limit"} deducted: ₩${repairFee.toLocaleString()} for bid ${bidId}`,
        );
      } catch (err) {
        await deductConnection.rollback();
        console.error(
          `[Direct Repair] Failed to deduct ${isIndividual ? "deposit" : "limit"}:`,
          err,
        );
        throw err;
      } finally {
        deductConnection.release();
      }
    }

    // 수선 내용과 금액 업데이트 (신규 또는 수정)
    if (isUpdate) {
      // 수정
      await connection.query(
        `UPDATE direct_bids 
         SET repair_details = ?, 
             repair_fee = ? 
         WHERE id = ?`,
        [repair_details || null, repair_fee || null, bidId],
      );
    } else {
      // 신규 접수
      await connection.query(
        `UPDATE direct_bids 
         SET repair_requested_at = NOW(), 
             repair_details = ?, 
             repair_fee = ? 
         WHERE id = ?`,
        [repair_details || null, repair_fee || null, bidId],
      );
    }

    await connection.commit();

    // 정산 업데이트 및 조정
    if (bid.scheduled_date) {
      try {
        await createOrUpdateSettlement(bid.user_id, settlementDate);
        await adjustDepositBalance(
          bid.user_id,
          bid.winning_price,
          settlementDate,
          bid.title,
        );
      } catch (err) {
        console.error(`Error updating settlement for direct repair:`, err);
      }
    }

    // 잔액 확인 및 경고
    const [updatedAccounts] = await pool.query(
      `SELECT account_type, deposit_balance, daily_limit, daily_used 
      FROM user_accounts 
      WHERE user_id = ?`,
      [bid.user_id],
    );

    let balanceWarning = null;
    if (updatedAccounts[0]) {
      const acc = updatedAccounts[0];
      if (acc.account_type === "individual" && acc.deposit_balance < 0) {
        balanceWarning = `예치금 잔액이 부족합니다. 현재 잔액: ¥${acc.deposit_balance.toLocaleString()}`;
      } else if (
        acc.account_type === "corporate" &&
        acc.daily_used >= acc.daily_limit
      ) {
        balanceWarning = `일일 한도가 초과되었습니다. 사용액: ¥${acc.daily_used.toLocaleString()} / 한도: ¥${acc.daily_limit.toLocaleString()}`;
      }
    }

    res.status(isUpdate ? 200 : 201).json({
      message: isUpdate
        ? "수선 정보가 수정되었습니다."
        : "수선 접수가 완료되었습니다.",
      requested_at: bid.repair_requested_at || new Date(),
      repair_details,
      repair_fee,
      repair_fee_krw: repairFee,
      balanceWarning,
    });
  } catch (err) {
    await connection.rollback();
    console.error("수선 처리 중 오류 발생:", err);
    res.status(500).json({
      message: err.message || "수선 처리 중 오류가 발생했습니다.",
    });
  } finally {
    connection.release();
  }
});

/**
 * DELETE /api/bid-results/live/:id/repair
 * 현장 경매 수선 접수 취소 (어드민 전용)
 */
router.delete("/live/:id/repair", async (req, res) => {
  const bidId = req.params.id;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;

  // 어드민만 취소 가능
  if (userId !== "admin") {
    return res
      .status(403)
      .json({ message: "관리자만 수선 접수를 취소할 수 있습니다." });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [bids] = await connection.query(
      `SELECT l.*, i.scheduled_date
       FROM live_bids l 
       JOIN crawled_items i ON l.item_id = i.item_id 
       WHERE l.id = ?`,
      [bidId],
    );

    if (bids.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "입찰을 찾을 수 없습니다.",
      });
    }

    const bid = bids[0];

    if (!bid.repair_requested_at) {
      await connection.rollback();
      return res.status(400).json({
        message: "수선이 접수되지 않은 상품입니다.",
      });
    }

    // 수선 정보 삭제
    await connection.query(
      `UPDATE live_bids 
       SET repair_requested_at = NULL, 
           repair_details = NULL, 
           repair_fee = NULL 
       WHERE id = ?`,
      [bidId],
    );

    await connection.commit();

    // 정산 업데이트
    if (bid.scheduled_date) {
      const settlementDate = new Date(bid.scheduled_date)
        .toISOString()
        .split("T")[0];
      createOrUpdateSettlement(bid.user_id, settlementDate).catch(
        console.error,
      );
    }

    res.status(200).json({
      message: "수선 접수가 취소되었습니다.",
    });
  } catch (err) {
    await connection.rollback();
    console.error("수선 취소 중 오류 발생:", err);
    res.status(500).json({
      message: err.message || "수선 취소 중 오류가 발생했습니다.",
    });
  } finally {
    connection.release();
  }
});

/**
 * DELETE /api/bid-results/direct/:id/repair
 * 직접 경매 수선 접수 취소 (어드민 전용)
 */
router.delete("/direct/:id/repair", async (req, res) => {
  const bidId = req.params.id;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;

  // 어드민만 취소 가능
  if (userId !== "admin") {
    return res
      .status(403)
      .json({ message: "관리자만 수선 접수를 취소할 수 있습니다." });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [bids] = await connection.query(
      `SELECT d.*, i.scheduled_date
       FROM direct_bids d 
       JOIN crawled_items i ON d.item_id = i.item_id 
       WHERE d.id = ?`,
      [bidId],
    );

    if (bids.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "입찰을 찾을 수 없습니다.",
      });
    }

    const bid = bids[0];

    if (!bid.repair_requested_at) {
      await connection.rollback();
      return res.status(400).json({
        message: "수선이 접수되지 않은 상품입니다.",
      });
    }

    // 수선 정보 삭제
    await connection.query(
      `UPDATE direct_bids 
       SET repair_requested_at = NULL, 
           repair_details = NULL, 
           repair_fee = NULL 
       WHERE id = ?`,
      [bidId],
    );

    await connection.commit();

    // 정산 업데이트
    if (bid.scheduled_date) {
      const settlementDate = new Date(bid.scheduled_date)
        .toISOString()
        .split("T")[0];
      createOrUpdateSettlement(bid.user_id, settlementDate).catch(
        console.error,
      );
    }

    res.status(200).json({
      message: "수선 접수가 취소되었습니다.",
    });
  } catch (err) {
    await connection.rollback();
    console.error("수선 취소 중 오류 발생:", err);
    res.status(500).json({
      message: err.message || "수선 취소 중 오류가 발생했습니다.",
    });
  } finally {
    connection.release();
  }
});

// =====================================================
// 관리자 전용 API
// =====================================================

/**
 * POST /api/bid-results/settlements/:id/pay
 * [기업 회원 전용] 정산 결제 요청 (입금 완료 통보)
 * 상태 변경: unpaid -> pending
 */
router.post("/settlements/:id/pay", async (req, res) => {
  const settlementId = req.params.id;
  const { depositorName } = req.body;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!depositorName || depositorName.trim() === "") {
    return res.status(400).json({ message: "입금자명을 입력해주세요." });
  }

  const userId = req.session.user.id;
  const connection = await pool.getConnection();

  try {
    // 1. 본인의 정산 내역인지, 기업 회원인지, 미결제 상태인지 확인
    const [settlements] = await connection.query(
      `SELECT s.*, ua.account_type 
       FROM daily_settlements s
       JOIN user_accounts ua ON s.user_id = ua.user_id
       WHERE s.id = ? AND s.user_id = ?`,
      [settlementId, userId],
    );

    if (settlements.length === 0) {
      return res.status(404).json({ message: "Settlement not found" });
    }

    const settlement = settlements[0];

    // 기업 회원이 아니거나, 이미 결제된 경우 체크
    if (settlement.payment_status !== "unpaid") {
      return res.status(400).json({
        message: "Invalid status for payment request",
        current_status: settlement.payment_status,
      });
    }

    // 2. 상태 업데이트 (unpaid -> pending)
    await connection.query(
      `UPDATE daily_settlements 
       SET payment_status = 'pending', payment_method = 'manual', depositor_name = ? 
       WHERE id = ?`,
      [depositorName.trim(), settlementId],
    );

    res.json({
      message: "Payment request submitted successfully",
      status: "pending",
    });
  } catch (err) {
    console.error("Payment request error:", err);
    res.status(500).json({ message: "Error processing payment request" });
  } finally {
    connection.release();
  }
});

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
      // 🔧 payment_status로 변경
      whereClause += ` AND payment_status IN (${placeholders})`;
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

    // 🔧 payment_status 기준 통계
    const [statsResult] = await connection.query(
      `SELECT 
        COUNT(*) as total_settlements,
        SUM(item_count) as total_items,
        SUM(final_amount) as total_amount,
        SUM(CASE WHEN payment_status = 'pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN payment_status = 'unpaid' THEN 1 ELSE 0 END) as unpaid_count,
        SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) as paid_count
      FROM daily_settlements 
      WHERE ${whereClause}`,
      params,
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
      [...params, parseInt(limit), offset],
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

  // 🔧 unpaid, pending, paid로 변경
  if (!status || !["unpaid", "pending", "paid"].includes(status)) {
    return res.status(400).json({
      message: "Invalid status. Must be: unpaid, pending, or paid",
    });
  }

  const connection = await pool.getConnection();

  try {
    // 🔧 payment_status로 변경
    const updates = ["payment_status = ?"];
    const params = [status];

    if (admin_memo !== undefined) {
      updates.push("admin_memo = ?");
      params.push(admin_memo);
    }

    if (status === "paid") {
      updates.push("paid_at = NOW()");
      updates.push("completed_amount = final_amount");
    }

    params.push(settlementId);

    await connection.query(
      `UPDATE daily_settlements SET ${updates.join(", ")} WHERE id = ?`,
      params,
    );

    const [updated] = await connection.query(
      "SELECT * FROM daily_settlements WHERE id = ?",
      [settlementId],
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

  // 🔧 unpaid, pending, paid로 변경
  if (!status || !["unpaid", "pending", "paid"].includes(status)) {
    return res.status(400).json({
      message: "Invalid status. Must be: unpaid, pending, or paid",
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const placeholders = settlement_ids.map(() => "?").join(",");
    // 🔧 payment_status로 변경
    let query = `UPDATE daily_settlements SET payment_status = ? WHERE id IN (${placeholders})`;
    let params = [status, ...settlement_ids];

    if (status === "paid") {
      query = `UPDATE daily_settlements SET payment_status = ?, paid_at = NOW() WHERE id IN (${placeholders})`;
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
// 디버깅 API
// =====================================================

/**
 * GET /api/bid-results/debug/settlement-mismatch
 * Settlement와 실제 입찰 데이터가 맞지 않는 경우 조사
 */
router.get("/debug/settlement-mismatch", isAdmin, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    // 1. 모든 정산 데이터 조회
    const [settlements] = await connection.query(
      `SELECT * FROM daily_settlements ORDER BY user_id, settlement_date`,
    );

    const mismatches = [];

    for (const settlement of settlements) {
      // 2. 해당 정산에 해당하는 실제 입찰 데이터 조회
      const [liveBids] = await connection.query(
        `SELECT l.*, i.auc_num, i.category
         FROM live_bids l
         LEFT JOIN crawled_items i ON l.item_id = i.item_id
         WHERE l.user_id = ? 
           AND DATE(i.scheduled_date) = ?
           AND l.status IN ('completed', 'shipped')
           AND l.winning_price > 0
           AND l.final_price >= l.winning_price`,
        [settlement.user_id, settlement.settlement_date],
      );

      const [directBids] = await connection.query(
        `SELECT d.*, i.auc_num, i.category
         FROM direct_bids d
         LEFT JOIN crawled_items i ON d.item_id = i.item_id
         WHERE d.user_id = ? 
           AND DATE(i.scheduled_date) = ?
           AND d.status IN ('completed', 'shipped')
           AND d.winning_price > 0
           AND d.current_price >= d.winning_price`,
        [settlement.user_id, settlement.settlement_date],
      );

      const actualItems = [...liveBids, ...directBids];

      // 3. 실제 데이터와 정산 데이터 비교
      const actualItemCount = actualItems.length;
      const settlementItemCount = settlement.item_count;

      // 실제 엔화 총액 계산
      let actualTotalJpy = 0;
      let actualAppraisalCount = 0;
      let actualRepairCount = 0;
      let actualRepairFee = 0;

      actualItems.forEach((item) => {
        actualTotalJpy += Number(item.winning_price);
        if (item.appr_id) actualAppraisalCount++;
        if (item.repair_requested_at) {
          actualRepairCount++;
          actualRepairFee += Number(item.repair_fee) || 0;
        }
      });

      // 불일치 확인
      const hasMismatch =
        actualItemCount !== settlementItemCount ||
        actualTotalJpy !== Number(settlement.total_japanese_yen) ||
        actualAppraisalCount !== settlement.appraisal_count ||
        actualRepairCount !== settlement.repair_count ||
        actualRepairFee !== Number(settlement.repair_fee);

      if (hasMismatch) {
        mismatches.push({
          settlement_id: settlement.id,
          user_id: settlement.user_id,
          settlement_date: settlement.settlement_date,
          discrepancies: {
            item_count: {
              settlement: settlementItemCount,
              actual: actualItemCount,
              match: actualItemCount === settlementItemCount,
            },
            total_japanese_yen: {
              settlement: Number(settlement.total_japanese_yen),
              actual: actualTotalJpy,
              match: actualTotalJpy === Number(settlement.total_japanese_yen),
            },
            appraisal_count: {
              settlement: settlement.appraisal_count,
              actual: actualAppraisalCount,
              match: actualAppraisalCount === settlement.appraisal_count,
            },
            repair_count: {
              settlement: settlement.repair_count,
              actual: actualRepairCount,
              match: actualRepairCount === settlement.repair_count,
            },
            repair_fee: {
              settlement: Number(settlement.repair_fee),
              actual: actualRepairFee,
              match: actualRepairFee === Number(settlement.repair_fee),
            },
          },
          actual_items: actualItems.map((item) => ({
            id: item.id,
            item_id: item.item_id,
            winning_price: item.winning_price,
            appr_id: item.appr_id,
            repair_requested_at: item.repair_requested_at,
            repair_fee: item.repair_fee,
            status: item.status,
          })),
        });
      }
    }

    // 4. 정산은 있는데 실제 입찰이 없는 경우 체크
    const [orphanSettlements] = await connection.query(
      `SELECT s.* 
       FROM daily_settlements s
       WHERE NOT EXISTS (
         SELECT 1 FROM live_bids l 
         JOIN crawled_items i ON l.item_id = i.item_id
         WHERE l.user_id = s.user_id 
           AND DATE(i.scheduled_date) = s.settlement_date
           AND l.status IN ('completed', 'shipped')
           AND l.winning_price > 0
       )
       AND NOT EXISTS (
         SELECT 1 FROM direct_bids d
         JOIN crawled_items i ON d.item_id = i.item_id
         WHERE d.user_id = s.user_id 
           AND DATE(i.scheduled_date) = s.settlement_date
           AND d.status IN ('completed', 'shipped')
           AND d.winning_price > 0
       )`,
    );

    // 5. 입찰은 있는데 정산이 없는 경우 체크
    const [missingSettlements] = await connection.query(
      `SELECT DISTINCT l.user_id, DATE(i.scheduled_date) as settlement_date, COUNT(*) as item_count
       FROM live_bids l
       JOIN crawled_items i ON l.item_id = i.item_id
       WHERE l.status IN ('completed', 'shipped')
         AND l.winning_price > 0
         AND l.final_price >= l.winning_price
         AND NOT EXISTS (
           SELECT 1 FROM daily_settlements s
           WHERE s.user_id = l.user_id 
             AND s.settlement_date = DATE(i.scheduled_date)
         )
       GROUP BY l.user_id, DATE(i.scheduled_date)
       
       UNION
       
       SELECT DISTINCT d.user_id, DATE(i.scheduled_date) as settlement_date, COUNT(*) as item_count
       FROM direct_bids d
       JOIN crawled_items i ON d.item_id = i.item_id
       WHERE d.status IN ('completed', 'shipped')
         AND d.winning_price > 0
         AND d.current_price >= d.winning_price
         AND NOT EXISTS (
           SELECT 1 FROM daily_settlements s
           WHERE s.user_id = d.user_id 
             AND s.settlement_date = DATE(i.scheduled_date)
         )
       GROUP BY d.user_id, DATE(i.scheduled_date)`,
    );

    res.json({
      summary: {
        total_settlements: settlements.length,
        mismatched_count: mismatches.length,
        orphan_settlements_count: orphanSettlements.length,
        missing_settlements_count: missingSettlements.length,
      },
      mismatches: mismatches,
      orphan_settlements: orphanSettlements,
      missing_settlements: missingSettlements,
    });
  } catch (err) {
    console.error("Error checking settlement mismatch:", err);
    res.status(500).json({ message: "Error checking settlement mismatch" });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/bid-results/debug/fix-settlement-mismatch
 * Settlement 불일치 수정 (누락된 정산만 생성, 기존 환율 최대한 활용)
 */
router.post("/debug/fix-settlement-mismatch", isAdmin, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const results = {
      created: [],
      deleted: [],
      skipped: [],
      errors: [],
    };

    // 1. 입찰은 있는데 정산이 없는 경우 → 정산 생성
    const [missingSettlements] = await connection.query(
      `SELECT DISTINCT l.user_id, DATE(i.scheduled_date) as settlement_date
       FROM live_bids l
       JOIN crawled_items i ON l.item_id = i.item_id
       WHERE l.status IN ('completed', 'shipped')
         AND l.winning_price > 0
         AND l.final_price >= l.winning_price
         AND NOT EXISTS (
           SELECT 1 FROM daily_settlements s
           WHERE s.user_id = l.user_id 
             AND s.settlement_date = DATE(i.scheduled_date)
         )
       
       UNION
       
       SELECT DISTINCT d.user_id, DATE(i.scheduled_date) as settlement_date
       FROM direct_bids d
       JOIN crawled_items i ON d.item_id = i.item_id
       WHERE d.status IN ('completed', 'shipped')
         AND d.winning_price > 0
         AND d.current_price >= d.winning_price
         AND NOT EXISTS (
           SELECT 1 FROM daily_settlements s
           WHERE s.user_id = d.user_id 
             AND s.settlement_date = DATE(i.scheduled_date)
         )`,
    );

    for (const missing of missingSettlements) {
      try {
        await createOrUpdateSettlement(
          missing.user_id,
          missing.settlement_date,
        );
        results.created.push({
          user_id: missing.user_id,
          settlement_date: missing.settlement_date,
        });
      } catch (err) {
        results.errors.push({
          user_id: missing.user_id,
          settlement_date: missing.settlement_date,
          error: err.message,
        });
      }
    }

    // 2. 정산은 있는데 입찰이 없는 경우 → 정산 삭제
    const [orphanSettlements] = await connection.query(
      `SELECT s.* 
       FROM daily_settlements s
       WHERE NOT EXISTS (
         SELECT 1 FROM live_bids l 
         JOIN crawled_items i ON l.item_id = i.item_id
         WHERE l.user_id = s.user_id 
           AND DATE(i.scheduled_date) = s.settlement_date
           AND l.status IN ('completed', 'shipped')
           AND l.winning_price > 0
       )
       AND NOT EXISTS (
         SELECT 1 FROM direct_bids d
         JOIN crawled_items i ON d.item_id = i.item_id
         WHERE d.user_id = s.user_id 
           AND DATE(i.scheduled_date) = s.settlement_date
           AND d.status IN ('completed', 'shipped')
           AND d.winning_price > 0
       )`,
    );

    for (const orphan of orphanSettlements) {
      await connection.query("DELETE FROM daily_settlements WHERE id = ?", [
        orphan.id,
      ]);
      results.deleted.push({
        settlement_id: orphan.id,
        user_id: orphan.user_id,
        settlement_date: orphan.settlement_date,
      });
    }

    // 3. 정산과 입찰이 모두 있지만 데이터가 맞지 않는 경우 → createOrUpdateSettlement 호출
    const [allSettlements] = await connection.query(
      `SELECT DISTINCT user_id, settlement_date FROM daily_settlements`,
    );

    for (const settlement of allSettlements) {
      // 이미 생성되거나 삭제된 항목은 스킵
      const alreadyProcessed =
        results.created.some(
          (c) =>
            c.user_id === settlement.user_id &&
            c.settlement_date === settlement.settlement_date,
        ) ||
        results.deleted.some(
          (d) =>
            d.user_id === settlement.user_id &&
            d.settlement_date === settlement.settlement_date,
        );

      if (alreadyProcessed) {
        continue;
      }

      try {
        // 실제 입찰 데이터 조회
        const [liveBids] = await connection.query(
          `SELECT l.winning_price, l.appr_id, l.repair_requested_at, l.repair_fee
           FROM live_bids l
           LEFT JOIN crawled_items i ON l.item_id = i.item_id
           WHERE l.user_id = ? 
             AND DATE(i.scheduled_date) = ?
             AND l.status IN ('completed', 'shipped')
             AND l.winning_price > 0
             AND l.final_price >= l.winning_price`,
          [settlement.user_id, settlement.settlement_date],
        );

        const [directBids] = await connection.query(
          `SELECT d.winning_price, d.appr_id, d.repair_requested_at, d.repair_fee
           FROM direct_bids d
           LEFT JOIN crawled_items i ON d.item_id = i.item_id
           WHERE d.user_id = ? 
             AND DATE(i.scheduled_date) = ?
             AND d.status IN ('completed', 'shipped')
             AND d.winning_price > 0
             AND d.current_price >= d.winning_price`,
          [settlement.user_id, settlement.settlement_date],
        );

        const actualItems = [...liveBids, ...directBids];

        // 정산 데이터 조회
        const [settlementData] = await connection.query(
          `SELECT * FROM daily_settlements WHERE user_id = ? AND settlement_date = ?`,
          [settlement.user_id, settlement.settlement_date],
        );

        if (settlementData.length === 0) continue;

        const currentSettlement = settlementData[0];

        // 실제 값 계산
        let actualTotalJpy = 0;
        let actualAppraisalCount = 0;
        let actualRepairCount = 0;
        let actualRepairFee = 0;

        actualItems.forEach((item) => {
          actualTotalJpy += Number(item.winning_price);
          if (item.appr_id) actualAppraisalCount++;
          if (item.repair_requested_at) {
            actualRepairCount++;
            actualRepairFee += Number(item.repair_fee) || 0;
          }
        });

        // 불일치 확인
        const hasMismatch =
          actualItems.length !== currentSettlement.item_count ||
          actualTotalJpy !== Number(currentSettlement.total_japanese_yen) ||
          actualAppraisalCount !== currentSettlement.appraisal_count ||
          actualRepairCount !== currentSettlement.repair_count ||
          actualRepairFee !== Number(currentSettlement.repair_fee);

        if (hasMismatch) {
          await createOrUpdateSettlement(
            settlement.user_id,
            settlement.settlement_date,
          );
          results.created.push({
            user_id: settlement.user_id,
            settlement_date: settlement.settlement_date,
            note: "Updated existing settlement due to mismatch",
          });
        } else {
          results.skipped.push({
            user_id: settlement.user_id,
            settlement_date: settlement.settlement_date,
            reason: "No mismatch found",
          });
        }
      } catch (err) {
        results.errors.push({
          user_id: settlement.user_id,
          settlement_date: settlement.settlement_date,
          error: err.message,
        });
      }
    }

    await connection.commit();

    res.json({
      success: true,
      summary: {
        created_count: results.created.length,
        deleted_count: results.deleted.length,
        skipped_count: results.skipped.length,
        error_count: results.errors.length,
      },
      details: results,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error fixing settlement mismatch:", err);
    res.status(500).json({ message: "Error fixing settlement mismatch" });
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

// =====================================================
// 관리자 전용 API - 입찰 결과 페이지용
// =====================================================

/**
 * GET /api/admin/bid-results
 * 관리자용 입찰 결과 목록 조회 (모든 유저의 일별 정산 정보)
 */
router.get("/admin/bid-results", isAdmin, async (req, res) => {
  const {
    dateRange = 365,
    page = 1,
    limit = 20,
    sortBy = "date",
    sortOrder = "desc",
    status = "",
    keyword = "",
  } = req.query;

  const connection = await pool.getConnection();

  try {
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - parseInt(dateRange));
    const fromDate = dateLimit.toISOString().split("T")[0];

    // 쿼리 조건 구성
    let whereConditions = ["ds.settlement_date >= ?"];
    const queryParams = [fromDate];

    // 정산 상태 필터
    if (status) {
      whereConditions.push("ds.payment_status = ?");
      queryParams.push(status);
    }

    // 키워드 검색 (유저ID 또는 날짜)
    if (keyword) {
      whereConditions.push("(ds.user_id LIKE ? OR ds.settlement_date LIKE ?)");
      queryParams.push(`%${keyword}%`, `%${keyword}%`);
    }

    const whereClause = whereConditions.join(" AND ");

    // 정렬 필드 매핑
    let orderByField = "ds.settlement_date";
    if (sortBy === "total_price") {
      orderByField = "ds.final_amount";
    } else if (sortBy === "item_count") {
      orderByField = "ds.item_count";
    }

    // 전체 개수 조회
    const [countResult] = await connection.query(
      `SELECT COUNT(*) as total 
       FROM daily_settlements ds 
       WHERE ${whereClause}`,
      queryParams,
    );

    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / parseInt(limit));

    // 페이지네이션 적용
    const offset = (parseInt(page) - 1) * parseInt(limit);
    queryParams.push(parseInt(limit), offset);

    // 데이터 조회
    const [rows] = await connection.query(
      `SELECT 
         ds.id as settlementId,
         ds.user_id as userId,
         ds.settlement_date as date,
         ds.item_count as itemCount,
         ds.final_amount as grandTotal,
         ds.completed_amount as completedAmount,
         ds.payment_status as paymentStatus,
         ds.depositor_name as depositorName
       FROM daily_settlements ds
       WHERE ${whereClause}
       ORDER BY ${orderByField} ${sortOrder.toUpperCase()}
       LIMIT ? OFFSET ?`,
      queryParams,
    );

    res.json({
      dailyResults: rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems,
      },
    });
  } catch (err) {
    console.error("Error fetching admin bid results:", err);
    res.status(500).json({ message: "Error fetching bid results" });
  } finally {
    connection.release();
  }
});

/**
 * GET /api/admin/bid-results/detail
 * 특정 유저/날짜의 입찰 결과 상세 조회 (낙찰 완료된 것만)
 */
router.get("/admin/bid-results/detail", isAdmin, async (req, res) => {
  const { userId, date } = req.query;

  if (!userId || !date) {
    return res.status(400).json({ message: "userId and date are required" });
  }

  const connection = await pool.getConnection();

  try {
    // 정산 정보 먼저 조회 (환율 포함)
    const [settlementRows] = await connection.query(
      `SELECT 
         id,
         final_amount as grandTotal,
         completed_amount as completedAmount,
         payment_status as paymentStatus,
         fee_amount,
         vat_amount,
         appraisal_fee,
         appraisal_vat,
         exchange_rate
       FROM daily_settlements 
       WHERE user_id = ? AND settlement_date = ?`,
      [userId, date],
    );

    const settlement = settlementRows[0] || null;
    const exchangeRate = settlement
      ? settlement.exchange_rate
      : await getExchangeRate();

    // 낙찰 완료된 live_bids만 조회
    const [liveBids] = await connection.query(
      `SELECT 
         lb.id,
         'live' as type,
         lb.item_id as itemId,
         lb.first_price,
         lb.second_price,
         lb.final_price,
         lb.winning_price,
         lb.status,
         lb.appr_id,
         i.title,
         i.brand,
         i.category,
         i.auc_num,
         i.starting_price as startPrice,
         i.image
       FROM live_bids lb
       JOIN crawled_items i ON lb.item_id = i.item_id
       WHERE lb.user_id = ? AND DATE(i.scheduled_date) = ? AND lb.status = 'completed'`,
      [userId, date],
    );

    // 낙찰 완료된 direct_bids만 조회
    const [directBids] = await connection.query(
      `SELECT 
         db.id,
         'direct' as type,
         db.item_id as itemId,
         db.current_price as final_price,
         db.winning_price,
         db.status,
         db.appr_id,
         i.title,
         i.brand,
         i.category,
         i.auc_num,
         i.starting_price as startPrice,
         i.image
       FROM direct_bids db
       JOIN crawled_items i ON db.item_id = i.item_id
       WHERE db.user_id = ? AND DATE(i.scheduled_date) = ? AND db.status = 'completed'`,
      [userId, date],
    );

    const allItems = [...liveBids, ...directBids];

    // 각 아이템에 관부가세 포함 가격 계산 및 총액 집계
    let totalJapanesePrice = 0;
    let totalKoreanPrice = 0;
    let appraisalCount = 0;

    const itemsWithKoreanPrice = allItems.map((item) => {
      let koreanPrice = 0;
      const price = parseInt(item.winning_price) || 0;

      if (price > 0 && item.auc_num && item.category) {
        try {
          koreanPrice = calculateTotalPrice(
            price,
            item.auc_num,
            item.category,
            exchangeRate,
          );
        } catch (error) {
          console.error("관부가세 계산 오류:", error);
          koreanPrice = 0;
        }
      }

      // 합계 계산 (낙찰 완료 아이템만)
      totalJapanesePrice += price;
      totalKoreanPrice += koreanPrice;
      if (item.appr_id) {
        appraisalCount++;
      }

      return {
        id: item.id,
        type: item.type,
        itemId: item.itemId,
        title: item.title,
        brand: item.brand,
        category: item.category,
        image: item.image,
        final_price: item.final_price,
        winning_price: item.winning_price,
        koreanPrice,
        status: item.status,
        appr_id: item.appr_id,
        startPrice: item.startPrice,
      };
    });

    // 수수료 계산
    let feeAmount = 0;
    let vatAmount = 0;
    let appraisalFee = 0;
    let appraisalVat = 0;
    let grandTotal = 0;

    if (settlement) {
      // 정산 정보가 있으면 DB 값 사용
      feeAmount = settlement.fee_amount || 0;
      vatAmount = settlement.vat_amount || 0;
      appraisalFee = settlement.appraisal_fee || 0;
      appraisalVat = settlement.appraisal_vat || 0;
      grandTotal = settlement.grandTotal || 0;
    } else if (allItems.length > 0) {
      // 정산 정보가 없으면 계산
      // 사용자 수수료율 조회
      const [userRows] = await connection.query(
        "SELECT commission_rate FROM users WHERE id = ?",
        [userId],
      );
      const userCommissionRate =
        userRows.length > 0 ? userRows[0].commission_rate : null;

      feeAmount = Math.max(
        calculateFee(totalKoreanPrice, userCommissionRate),
        10000,
      );
      vatAmount = Math.round((feeAmount / 1.1) * 0.1);
      appraisalFee = appraisalCount * 16500;
      appraisalVat = Math.round(appraisalFee / 11);
      grandTotal = totalKoreanPrice + feeAmount + appraisalFee;
    }

    res.json({
      userId,
      date,
      items: itemsWithKoreanPrice,
      itemCount: allItems.length,
      totalJapanesePrice,
      totalKoreanPrice,
      feeAmount,
      vatAmount,
      appraisalFee,
      appraisalVat,
      appraisalCount,
      grandTotal,
      completedAmount: settlement?.completedAmount || 0,
      paymentStatus: settlement?.paymentStatus || "unpaid",
      exchangeRate,
    });
  } catch (err) {
    console.error("Error fetching bid result detail:", err);
    res.status(500).json({ message: "Error fetching detail" });
  } finally {
    connection.release();
  }
});

module.exports = router;
