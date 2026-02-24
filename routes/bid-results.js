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
const { isAdminUser } = require("../utils/adminAuth");

// 미들?�어
const isAdmin = (req, res, next) => {
  if (isAdminUser(req.session?.user)) {
    next();
  } else {
    res.status(403).json({ message: "Access denied. Admin only." });
  }
};

// =====================================================
// ?�반 ?�용??API
// =====================================================

/**
 * GET /api/bid-results
 * ?�용?�의 ?�별 ?�찰 결과 조회
 */
router.get("/", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;
  const isAdminUserRole = isAdminUser(req.session.user);

  const {
    dateRange = 30,
    page = 1,
    limit = 7,
    sortBy = "date",
    sortOrder = "desc",
    status,
    search,
  } = req.query;

  const connection = await pool.getConnection();

  try {
    // ?�짜 범위 계산
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - parseInt(dateRange));
    const fromDate = dateLimit.toISOString().split("T")[0];

    // 검??조건 (SQL WHERE ???��?)
    let searchCondition = "";
    let searchParams = [];

    if (search && search.trim()) {
      const keyword = `%${search.trim()}%`;
      searchCondition = `
        AND (
          i.title LIKE ? OR 
          i.brand LIKE ? OR 
          i.category LIKE ? OR 
          i.item_id LIKE ? OR
          i.original_title LIKE ?
        )
      `;
      // ?�짜 쿼리???�라미터 (5�?
      searchParams = [keyword, keyword, keyword, keyword, keyword];
    }

    // ??1?�계: 모든 ?�찰???�는 ?�짜 조회
    let dateQuery;
    let dateParams;

    if (isAdminUserRole) {
      // 관리자: 모든 ?�용?�의 ?�짜
      dateQuery = `
        SELECT DISTINCT DATE(i.scheduled_date) as bid_date
        FROM (
          SELECT item_id FROM live_bids
          UNION
          SELECT item_id FROM direct_bids
        ) as bids
        JOIN crawled_items i ON bids.item_id = i.item_id
        WHERE DATE(i.scheduled_date) >= ? ${searchCondition}
        ORDER BY bid_date ${sortOrder.toUpperCase()}
      `;
      dateParams = [fromDate, ...searchParams];
    } else {
      // ?�반 ?�용?? ?�당 ?�용?�의 ?�짜�?
      dateQuery = `
        SELECT DISTINCT DATE(i.scheduled_date) as bid_date
        FROM (
          SELECT item_id FROM live_bids WHERE user_id = ?
          UNION
          SELECT item_id FROM direct_bids WHERE user_id = ?
        ) as bids
        JOIN crawled_items i ON bids.item_id = i.item_id
        WHERE DATE(i.scheduled_date) >= ? ${searchCondition}
        ORDER BY bid_date ${sortOrder.toUpperCase()}
      `;
      dateParams = [userId, userId, fromDate, ...searchParams];
    }

    const [allDates] = await connection.query(dateQuery, dateParams);

    const totalDates = allDates.length;

    // ?�이지?�이???�용
    const offset = (page - 1) * limit;
    const paginatedDates = allDates.slice(offset, offset + parseInt(limit));

    console.log(`�?${totalDates}�??�짜 �?${paginatedDates.length}�??�짜 조회`);

    // ??2?�계: �??�짜�??�이???�집
    const dailyResults = [];

    for (const dateRow of paginatedDates) {
      const targetDate = dateRow.bid_date;

      // ???�산 ?�보 조회
      let settlementQuery;
      let settlementParams;

      if (isAdminUserRole) {
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

      // ???�당 ?�짜??모든 ?�찰 조회 - live_bids
      let liveBidsQuery;
      let liveBidsParams;

      if (isAdminUserRole) {
        liveBidsQuery = `
          SELECT 
            l.id, 'live' as type, l.status, l.user_id,
            l.first_price, l.second_price, l.final_price, l.winning_price, 
            l.appr_id, l.repair_requested_at, l.created_at, l.updated_at, l.completed_at,
            i.item_id, i.original_title, i.title, i.brand, i.category, i.image, 
            i.scheduled_date, i.auc_num, i.rank, i.starting_price
          FROM live_bids l
          JOIN crawled_items i ON l.item_id = i.item_id
          WHERE DATE(i.scheduled_date) = ? ${searchCondition}
        `;
        liveBidsParams = [targetDate, ...searchParams];
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
          WHERE l.user_id = ? AND DATE(i.scheduled_date) = ? ${searchCondition}
        `;
        liveBidsParams = [userId, targetDate, ...searchParams];
      }

      const [liveBids] = await connection.query(liveBidsQuery, liveBidsParams);

      // ???�당 ?�짜??모든 ?�찰 조회 - direct_bids
      let directBidsQuery;
      let directBidsParams;

      if (isAdminUserRole) {
        directBidsQuery = `
          SELECT 
            d.id, 'direct' as type, d.status, d.user_id,
            d.current_price as final_price, d.winning_price, 
            d.appr_id, d.repair_requested_at, d.created_at, d.updated_at, d.completed_at,
            i.item_id, i.original_title, i.title, i.brand, i.category, i.image,
            i.scheduled_date, i.auc_num, i.rank, i.starting_price
          FROM direct_bids d
          JOIN crawled_items i ON d.item_id = i.item_id
          WHERE DATE(i.scheduled_date) = ? ${searchCondition}
        `;
        directBidsParams = [targetDate, ...searchParams];
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
          WHERE d.user_id = ? AND DATE(i.scheduled_date) = ? ${searchCondition}
        `;
        directBidsParams = [userId, targetDate, ...searchParams];
      }

      const [directBids] = await connection.query(
        directBidsQuery,
        directBidsParams,
      );

      const allItems = [...liveBids, ...directBids];

      if (allItems.length === 0) {
        continue; // ???�짜??건너?�
      }

      // ?�율 결정
      const exchangeRate = settlementInfo
        ? settlementInfo.exchange_rate
        : await getExchangeRate();

      // ???�태�?분류 �?관부가??계산
      const successItems = [];
      const failedItems = [];
      const pendingItems = [];

      let totalJapanesePrice = 0;
      let totalKoreanPrice = 0;
      let appraisalCount = 0;

      allItems.forEach((item) => {
        const bid_status = classifyBidStatus(item);

        // 관부가???�함 가�?계산
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
              console.error("관부가??계산 ?�류:", error);
              koreanPrice = 0;
            }
          }

          // ?�공???�이?�만 집계
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

      // ???�수�?계산 (?�공 ?�이?�이 ?�을 ?�만)
      let feeAmount = 0;
      let vatAmount = 0;
      let appraisalFee = 0;
      let appraisalVat = 0;
      let grandTotal = 0;

      if (!isAdminUser && settlementInfo) {
        // ?�산 ?�보가 ?�으�??�용
        feeAmount = settlementInfo.fee_amount;
        vatAmount = settlementInfo.vat_amount;
        appraisalFee = settlementInfo.appraisal_fee;
        appraisalVat = settlementInfo.appraisal_vat;
        grandTotal = settlementInfo.final_amount;
      } else if (successItems.length > 0) {
        // ???�용???�수료율 조회 (?�반 ?�용?�만)
        let userCommissionRate = null;
        if (!isAdminUserRole) {
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

    // ??관리자??�??�계 (?�체 기간)
    let totalStats = null;
    if (isAdminUserRole) {
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
 * ?�장 경매 감정???�청
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
       WHERE l.id = ? AND l.status = 'completed' AND l.winning_price > 0`,
      [bidId],
    );

    if (
      bids.length === 0 ||
      !(bids[0].user_id == userId || userId == "admin")
    ) {
      await connection.rollback();
      return res.status(404).json({
        message: "?�찰???�품??찾을 ???�거???�근 권한???�습?�다.",
      });
    }

    const bid = bids[0];

    if (bid.appr_id) {
      await connection.rollback();
      return res.status(400).json({
        message: "?��? 감정?��? ?�청?�습?�다.",
        appraisal_id: bid.appr_id,
      });
    }

    // 계정 ?�보 조회
    const [accounts] = await connection.query(
      `SELECT account_type, deposit_balance, daily_limit, daily_used 
      FROM user_accounts 
      WHERE user_id = ?`,
      [bid.user_id],
    );

    const account = accounts[0];
    const isIndividual = account?.account_type === "individual";

    // ?�율 조회 �??�화 ?�산
    const settlementDate = new Date(bid.scheduled_date)
      .toISOString()
      .split("T")[0];
    const exchangeRate = await getExchangeRate(settlementDate);
    const krwAmount = Math.round(bid.winning_price * exchangeRate);
    const appraisalFee = 16500; // 감정�?(?�산 ??appraisalCount * 16500�??�일)

    // ?�치�??�도 차감 (별도 ?�랜??��)
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
        `[Live Appraisal] ${isIndividual ? "Deposit" : "Limit"} deducted: ??{appraisalFee.toLocaleString()} for bid ${bidId}`,
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

    // ?�산 ?�데?�트 �?조정
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

    // ?�액 ?�인 �?경고
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
        balanceWarning = `?�치�??�액??부족합?�다. ?�재 ?�액: ¥${acc.deposit_balance.toLocaleString()}`;
      } else if (
        acc.account_type === "corporate" &&
        acc.daily_used >= acc.daily_limit
      ) {
        balanceWarning = `?�일 ?�도가 초과?�었?�니?? ?�용?? ¥${acc.daily_used.toLocaleString()} / ?�도: ¥${acc.daily_limit.toLocaleString()}`;
      }
    }

    res.status(201).json({
      message: "감정???�청???�료?�었?�니??",
      appraisal_id,
      certificate_number,
      status: "pending",
      appraisal_fee: appraisalFee,
      balanceWarning,
    });
  } catch (err) {
    await connection.rollback();
    console.error("감정???�청 �??�류 발생:", err);
    res.status(500).json({
      message: err.message || "감정???�청 �??�류가 발생?�습?�다.",
    });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/bid-results/direct/:id/request-appraisal
 * 직접 경매 감정???�청
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
       WHERE d.id = ? AND d.status = 'completed' AND d.winning_price > 0`,
      [bidId],
    );

    if (
      bids.length === 0 ||
      !(bids[0].user_id == userId || userId == "admin")
    ) {
      await connection.rollback();
      return res.status(404).json({
        message: "?�찰???�품??찾을 ???�거???�근 권한???�습?�다.",
      });
    }

    const bid = bids[0];

    if (bid.appr_id) {
      await connection.rollback();
      return res.status(400).json({
        message: "?��? 감정?��? ?�청?�습?�다.",
        appraisal_id: bid.appr_id,
      });
    }

    // 계정 ?�보 조회
    const [accounts] = await connection.query(
      `SELECT account_type, deposit_balance, daily_limit, daily_used 
      FROM user_accounts 
      WHERE user_id = ?`,
      [bid.user_id],
    );

    const account = accounts[0];
    const isIndividual = account?.account_type === "individual";

    // ?�율 조회 �??�화 ?�산
    const settlementDate = new Date(bid.scheduled_date)
      .toISOString()
      .split("T")[0];
    const exchangeRate = await getExchangeRate(settlementDate);
    const krwAmount = Math.round(bid.winning_price * exchangeRate);
    const appraisalFee = 16500; // 감정�?(?�산 ??appraisalCount * 16500�??�일)

    // ?�치�??�도 차감 (별도 ?�랜??��)
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
        `[Direct Appraisal] ${isIndividual ? "Deposit" : "Limit"} deducted: ??{appraisalFee.toLocaleString()} for bid ${bidId}`,
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

    // ?�산 ?�데?�트 �?조정
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

    // ?�액 ?�인 �?경고
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
        balanceWarning = `?�치�??�액??부족합?�다. ?�재 ?�액: ¥${acc.deposit_balance.toLocaleString()}`;
      } else if (
        acc.account_type === "corporate" &&
        acc.daily_used >= acc.daily_limit
      ) {
        balanceWarning = `?�일 ?�도가 초과?�었?�니?? ?�용?? ¥${acc.daily_used.toLocaleString()} / ?�도: ¥${acc.daily_limit.toLocaleString()}`;
      }
    }

    res.status(201).json({
      message: "감정???�청???�료?�었?�니??",
      appraisal_id,
      certificate_number,
      status: "pending",
      appraisal_fee: appraisalFee,
      balanceWarning,
    });
  } catch (err) {
    await connection.rollback();
    console.error("감정???�청 �??�류 발생:", err);
    res.status(500).json({
      message: err.message || "감정???�청 �??�류가 발생?�습?�다.",
    });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/bid-results/live/:id/request-repair
 * ?�장 경매 ?�선 ?�수/?�정 (?�드�??�용)
 */
router.post("/live/:id/request-repair", async (req, res) => {
  const bidId = req.params.id;
  const { repair_details, repair_fee } = req.body;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;

  // ?�드민만 ?�선 ?�수 가??
  if (req.session.user.login_id !== "admin") {
    return res.status(403).json({ message: "관리자�??�선 ?�수가 가?�합?�다." });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [bids] = await connection.query(
      `SELECT l.*, i.brand, i.title, i.scheduled_date
       FROM live_bids l 
       JOIN crawled_items i ON l.item_id = i.item_id 
       WHERE l.id = ? AND l.status = 'completed' AND l.winning_price > 0`,
      [bidId],
    );

    if (bids.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "?�찰???�품??찾을 ???�습?�다.",
      });
    }

    const bid = bids[0];
    const isUpdate = !!bid.repair_requested_at;

    // 계정 ?�보 조회
    const [accounts] = await connection.query(
      `SELECT account_type, deposit_balance, daily_limit, daily_used 
      FROM user_accounts 
      WHERE user_id = ?`,
      [bid.user_id],
    );

    const account = accounts[0];
    const isIndividual = account?.account_type === "individual";

    // ?�율 조회 �??�화 ?�산
    const settlementDate = new Date(bid.scheduled_date)
      .toISOString()
      .split("T")[0];
    const exchangeRate = await getExchangeRate(settlementDate);
    const repairFee = repair_fee || 0;

    // ?�규 ?�수?�고 ?�선비�? ?�는 경우 ?�치�??�도 차감
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
          `[Live Repair] ${isIndividual ? "Deposit" : "Limit"} deducted: ??{repairFee.toLocaleString()} for bid ${bidId}`,
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

    // ?�선 ?�용�?금액 ?�데?�트 (?�규 ?�는 ?�정)
    if (isUpdate) {
      // ?�정
      await connection.query(
        `UPDATE live_bids 
         SET repair_details = ?, 
             repair_fee = ? 
         WHERE id = ?`,
        [repair_details || null, repair_fee || null, bidId],
      );
    } else {
      // ?�규 ?�수
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

    // ?�산 ?�데?�트 �?조정
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

    // ?�액 ?�인 �?경고
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
        balanceWarning = `?�치�??�액??부족합?�다. ?�재 ?�액: ¥${acc.deposit_balance.toLocaleString()}`;
      } else if (
        acc.account_type === "corporate" &&
        acc.daily_used >= acc.daily_limit
      ) {
        balanceWarning = `?�일 ?�도가 초과?�었?�니?? ?�용?? ¥${acc.daily_used.toLocaleString()} / ?�도: ¥${acc.daily_limit.toLocaleString()}`;
      }
    }

    res.status(isUpdate ? 200 : 201).json({
      message: isUpdate
        ? "?�선 ?�보가 ?�정?�었?�니??"
        : "?�선 ?�수가 ?�료?�었?�니??",
      requested_at: bid.repair_requested_at || new Date(),
      repair_details,
      repair_fee,
      repair_fee_krw: repairFee,
      balanceWarning,
    });
  } catch (err) {
    await connection.rollback();
    console.error("?�선 처리 �??�류 발생:", err);
    res.status(500).json({
      message: err.message || "?�선 처리 �??�류가 발생?�습?�다.",
    });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/bid-results/direct/:id/request-repair
 * 직접 경매 ?�선 ?�수/?�정 (?�드�??�용)
 */
router.post("/direct/:id/request-repair", async (req, res) => {
  const bidId = req.params.id;
  const { repair_details, repair_fee } = req.body;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;

  // ?�드민만 ?�선 ?�수 가??
  if (req.session.user.login_id !== "admin") {
    return res.status(403).json({ message: "관리자�??�선 ?�수가 가?�합?�다." });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [bids] = await connection.query(
      `SELECT d.*, i.brand, i.title, i.scheduled_date
       FROM direct_bids d 
       JOIN crawled_items i ON d.item_id = i.item_id 
       WHERE d.id = ? AND d.status = 'completed' AND d.winning_price > 0`,
      [bidId],
    );

    if (bids.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "?�찰???�품??찾을 ???�습?�다.",
      });
    }

    const bid = bids[0];
    const isUpdate = !!bid.repair_requested_at;

    // 계정 ?�보 조회
    const [accounts] = await connection.query(
      `SELECT account_type, deposit_balance, daily_limit, daily_used 
      FROM user_accounts 
      WHERE user_id = ?`,
      [bid.user_id],
    );

    const account = accounts[0];
    const isIndividual = account?.account_type === "individual";

    // ?�율 조회 �??�화 ?�산
    const settlementDate = new Date(bid.scheduled_date)
      .toISOString()
      .split("T")[0];
    const exchangeRate = await getExchangeRate(settlementDate);
    const repairFee = repair_fee || 0;

    // ?�규 ?�수?�고 ?�선비�? ?�는 경우 ?�치�??�도 차감
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
          `[Direct Repair] ${isIndividual ? "Deposit" : "Limit"} deducted: ??{repairFee.toLocaleString()} for bid ${bidId}`,
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

    // ?�선 ?�용�?금액 ?�데?�트 (?�규 ?�는 ?�정)
    if (isUpdate) {
      // ?�정
      await connection.query(
        `UPDATE direct_bids 
         SET repair_details = ?, 
             repair_fee = ? 
         WHERE id = ?`,
        [repair_details || null, repair_fee || null, bidId],
      );
    } else {
      // ?�규 ?�수
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

    // ?�산 ?�데?�트 �?조정
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

    // ?�액 ?�인 �?경고
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
        balanceWarning = `?�치�??�액??부족합?�다. ?�재 ?�액: ¥${acc.deposit_balance.toLocaleString()}`;
      } else if (
        acc.account_type === "corporate" &&
        acc.daily_used >= acc.daily_limit
      ) {
        balanceWarning = `?�일 ?�도가 초과?�었?�니?? ?�용?? ¥${acc.daily_used.toLocaleString()} / ?�도: ¥${acc.daily_limit.toLocaleString()}`;
      }
    }

    res.status(isUpdate ? 200 : 201).json({
      message: isUpdate
        ? "?�선 ?�보가 ?�정?�었?�니??"
        : "?�선 ?�수가 ?�료?�었?�니??",
      requested_at: bid.repair_requested_at || new Date(),
      repair_details,
      repair_fee,
      repair_fee_krw: repairFee,
      balanceWarning,
    });
  } catch (err) {
    await connection.rollback();
    console.error("?�선 처리 �??�류 발생:", err);
    res.status(500).json({
      message: err.message || "?�선 처리 �??�류가 발생?�습?�다.",
    });
  } finally {
    connection.release();
  }
});

/**
 * DELETE /api/bid-results/live/:id/repair
 * ?�장 경매 ?�선 ?�수 취소 (?�드�??�용)
 */
router.delete("/live/:id/repair", async (req, res) => {
  const bidId = req.params.id;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;

  // ?�드민만 취소 가??
  if (req.session.user.login_id !== "admin") {
    return res
      .status(403)
      .json({ message: "관리자�??�선 ?�수�?취소?????�습?�다." });
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
        message: "?�찰??찾을 ???�습?�다.",
      });
    }

    const bid = bids[0];

    if (!bid.repair_requested_at) {
      await connection.rollback();
      return res.status(400).json({
        message: "?�선???�수?��? ?��? ?�품?�니??",
      });
    }

    // ?�선 ?�보 ??��
    await connection.query(
      `UPDATE live_bids 
       SET repair_requested_at = NULL, 
           repair_details = NULL, 
           repair_fee = NULL 
       WHERE id = ?`,
      [bidId],
    );

    await connection.commit();

    // ?�산 ?�데?�트
    if (bid.scheduled_date) {
      const settlementDate = new Date(bid.scheduled_date)
        .toISOString()
        .split("T")[0];
      createOrUpdateSettlement(bid.user_id, settlementDate).catch(
        console.error,
      );
    }

    res.status(200).json({
      message: "?�선 ?�수가 취소?�었?�니??",
    });
  } catch (err) {
    await connection.rollback();
    console.error("?�선 취소 �??�류 발생:", err);
    res.status(500).json({
      message: err.message || "?�선 취소 �??�류가 발생?�습?�다.",
    });
  } finally {
    connection.release();
  }
});

/**
 * DELETE /api/bid-results/direct/:id/repair
 * 직접 경매 ?�선 ?�수 취소 (?�드�??�용)
 */
router.delete("/direct/:id/repair", async (req, res) => {
  const bidId = req.params.id;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;

  // ?�드민만 취소 가??
  if (req.session.user.login_id !== "admin") {
    return res
      .status(403)
      .json({ message: "관리자�??�선 ?�수�?취소?????�습?�다." });
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
        message: "?�찰??찾을 ???�습?�다.",
      });
    }

    const bid = bids[0];

    if (!bid.repair_requested_at) {
      await connection.rollback();
      return res.status(400).json({
        message: "?�선???�수?��? ?��? ?�품?�니??",
      });
    }

    // ?�선 ?�보 ??��
    await connection.query(
      `UPDATE direct_bids 
       SET repair_requested_at = NULL, 
           repair_details = NULL, 
           repair_fee = NULL 
       WHERE id = ?`,
      [bidId],
    );

    await connection.commit();

    // ?�산 ?�데?�트
    if (bid.scheduled_date) {
      const settlementDate = new Date(bid.scheduled_date)
        .toISOString()
        .split("T")[0];
      createOrUpdateSettlement(bid.user_id, settlementDate).catch(
        console.error,
      );
    }

    res.status(200).json({
      message: "?�선 ?�수가 취소?�었?�니??",
    });
  } catch (err) {
    await connection.rollback();
    console.error("?�선 취소 �??�류 발생:", err);
    res.status(500).json({
      message: err.message || "?�선 취소 �??�류가 발생?�습?�다.",
    });
  } finally {
    connection.release();
  }
});

// =====================================================
// 관리자 ?�용 API
// =====================================================

/**
 * POST /api/bid-results/settlements/:id/pay
 * [기업 ?�원 ?�용] ?�산 결제 ?�청 (?�금 ?�료 ?�보)
 * ?�태 변�? unpaid -> pending
 */
router.post("/settlements/:id/pay", async (req, res) => {
  const settlementId = req.params.id;
  const { depositorName } = req.body;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!depositorName || depositorName.trim() === "") {
    return res.status(400).json({ message: "?�금?�명???�력?�주?�요." });
  }

  const userId = req.session.user.id;
  const connection = await pool.getConnection();

  try {
    // 1. 본인???�산 ?�역?��?, 기업 ?�원?��?, 미결???�태?��? ?�인
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

    // 기업 ?�원???�니거나, ?��? 결제??경우 체크
    if (settlement.payment_status !== "unpaid") {
      return res.status(400).json({
        message: "Invalid status for payment request",
        current_status: settlement.payment_status,
      });
    }

    // 2. ?�태 ?�데?�트 (unpaid -> pending)
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
 * ?�체 ?�용?�의 ?�별 ?�산 관�?
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
      // ?�� payment_status�?변�?
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

    // ?�� payment_status 기�? ?�계
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

    // ?�렬
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

    // ?�이지?�이??
    const offset = (page - 1) * limit;

    const [settlements] = await connection.query(
      `SELECT ds.*, u.login_id
       FROM daily_settlements ds
       LEFT JOIN users u ON ds.user_id = u.id
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
 * ?�산 ?�동 처리 (?�금?�명, ?�금??기반)
 * - 부�?결제 지??(?�적)
 * - ?�금??미입?????��? 금액 ?�액 처리
 * - ?�납 ???�동?�로 'paid' ?�태�?변�?
 * - ?�납 ???�금계산???�금?�수�??�동 발행
 */
router.put("/admin/settlements/:id", isAdmin, async (req, res) => {
  const settlementId = req.params.id;
  const { depositor_name, payment_amount, admin_memo } = req.body;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. ?�재 ?�산 ?�보 �??�용???�보 조회
    const [settlements] = await connection.query(
      `SELECT ds.*, u.business_number, u.company_name, u.email, u.phone
       FROM daily_settlements ds
       JOIN users u ON ds.user_id = u.id
       WHERE ds.id = ?`,
      [settlementId],
    );

    if (settlements.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Settlement not found" });
    }

    const settlement = settlements[0];
    const finalAmount = Number(settlement.final_amount);
    const currentCompletedAmount = Number(settlement.completed_amount || 0);
    const remainingAmount = finalAmount - currentCompletedAmount;

    // 2. ?�금??결정 (미입?????��? 금액 ?�액)
    let paymentAmount = payment_amount
      ? Number(payment_amount)
      : remainingAmount;

    // 3. ?�효??검??
    if (paymentAmount <= 0) {
      await connection.rollback();
      return res.status(400).json({ message: "?�금?��? 0보다 커야 ?�니??" });
    }

    if (paymentAmount > remainingAmount) {
      await connection.rollback();
      return res.status(400).json({
        message: `?�금??${paymentAmount.toLocaleString()}?????��? 금액(${remainingAmount.toLocaleString()}????초과?????�습?�다.`,
      });
    }

    // 4. 결제???�적 계산
    const newCompletedAmount = currentCompletedAmount + paymentAmount;

    // 5. ?�산 ?�태 ?�동 결정
    let newPaymentStatus;
    const isFullyPaid = newCompletedAmount >= finalAmount;

    if (isFullyPaid) {
      newPaymentStatus = "paid"; // ?�납
    } else if (newCompletedAmount > 0) {
      newPaymentStatus = "pending"; // 부�??�금
    } else {
      newPaymentStatus = "unpaid"; // 미결??
    }

    // 6. ?�데?�트 쿼리 구성
    const updates = [
      "completed_amount = ?",
      "payment_status = ?",
      "payment_method = 'manual'",
    ];
    const params = [newCompletedAmount, newPaymentStatus];

    // ?�금?�명 ?�데?�트 (?�공??경우)
    if (depositor_name !== undefined && depositor_name.trim() !== "") {
      updates.push("depositor_name = ?");
      params.push(depositor_name.trim());
    }

    // 관리자 메모 ?�데?�트
    if (admin_memo !== undefined) {
      updates.push("admin_memo = ?");
      params.push(admin_memo);
    }

    // ?�납 ??paid_at 기록
    if (newPaymentStatus === "paid") {
      updates.push("paid_at = NOW()");
    }

    params.push(settlementId);

    // 7. ?�이?�베?�스 ?�데?�트
    await connection.query(
      `UPDATE daily_settlements SET ${updates.join(", ")} WHERE id = ?`,
      params,
    );

    // 8. ?�데?�트???�이??조회
    const [updated] = await connection.query(
      "SELECT * FROM daily_settlements WHERE id = ?",
      [settlementId],
    );

    await connection.commit();

    console.log(
      `[?�산 처리] ID: ${settlementId}, ?�금: ${paymentAmount.toLocaleString()}?? ?�적: ${newCompletedAmount.toLocaleString()}??${finalAmount.toLocaleString()}?? ?�태: ${newPaymentStatus}`,
    );

    // 9. ?�납 ???�금계산???�금?�수�??�동 발행 (별도 처리)
    let documentIssueResult = null;
    if (isFullyPaid) {
      try {
        const popbillService = require("../utils/popbill");

        // ?��? 발행??문서가 ?�는지 ?�인
        const [existingDocs] = await pool.query(
          "SELECT * FROM popbill_documents WHERE related_type = 'settlement' AND related_id = ? AND status = 'issued'",
          [settlementId],
        );

        if (existingDocs.length === 0) {
          // business_number ?�무???�라 ?�금계산???�는 ?�금?�수�?발행
          if (settlement.business_number) {
            // ?�금계산??발행
            console.log(
              `[?�동 발행] ?�금계산??발행 ?�작 (?�산 ID: ${settlementId})`,
            );
            const taxResult = await popbillService.issueTaxinvoice(
              settlement,
              {
                business_number: settlement.business_number,
                company_name: settlement.company_name,
                email: settlement.email,
              },
              "?�찰결과 ?�산",
            );

            // DB ?�??
            await pool.query(
              `INSERT INTO popbill_documents 
               (type, mgt_key, related_type, related_id, user_id, confirm_num, amount, status, created_at) 
               VALUES ('taxinvoice', ?, 'settlement', ?, ?, ?, ?, 'issued', NOW())`,
              [
                taxResult.invoicerMgtKey,
                settlementId,
                settlement.user_id,
                taxResult.ntsConfirmNum,
                finalAmount,
              ],
            );

            documentIssueResult = {
              type: "taxinvoice",
              status: "issued",
              confirmNum: taxResult.ntsConfirmNum,
              mgtKey: taxResult.invoicerMgtKey,
            };

            console.log(
              `???�금계산???�동 발행 ?�료 (?�인번호: ${taxResult.ntsConfirmNum})`,
            );
          } else {
            // ?�금?�수�?발행
            console.log(
              `[?�동 발행] ?�금?�수�?발행 ?�작 (?�산 ID: ${settlementId})`,
            );

            // ?�산 ?�이?��? ?�금?�수�?발행???�랜??�� ?�식?�로 변??
            const transactionData = {
              id: settlementId,
              amount: finalAmount,
              user_id: settlement.user_id,
              processed_at: new Date(),
            };

            const cashResult = await popbillService.issueCashbill(
              transactionData,
              {
                email: settlement.email,
                phone: settlement.phone,
                company_name: settlement.company_name,
              },
              "?�찰결과 ?�산",
            );

            // DB ?�??
            await pool.query(
              `INSERT INTO popbill_documents 
               (type, mgt_key, related_type, related_id, user_id, confirm_num, amount, status, created_at) 
               VALUES ('cashbill', ?, 'settlement', ?, ?, ?, ?, 'issued', NOW())`,
              [
                cashResult.mgtKey,
                settlementId,
                settlement.user_id,
                cashResult.confirmNum,
                finalAmount,
              ],
            );

            documentIssueResult = {
              type: "cashbill",
              status: "issued",
              confirmNum: cashResult.confirmNum,
              mgtKey: cashResult.mgtKey,
            };

            console.log(
              `???�금?�수�??�동 발행 ?�료 (?�인번호: ${cashResult.confirmNum})`,
            );
          }
        } else {
          console.log(
            `[?�동 발행] ?��? 발행??문서 존재 (?�산 ID: ${settlementId})`,
          );
          documentIssueResult = {
            status: "already_issued",
            existing: existingDocs[0],
          };
        }
      } catch (error) {
        // 발행 ?�패 ??DB???�패 ?�태 기록
        console.error(
          `??문서 ?�동 발행 ?�패 (?�산 ID: ${settlementId}):`,
          error.message,
        );

        const docType = settlement.business_number ? "taxinvoice" : "cashbill";
        const mgtKey = `${docType.toUpperCase()}-FAILED-${settlementId}-${Date.now()}`;

        try {
          await pool.query(
            `INSERT INTO popbill_documents 
             (type, mgt_key, related_type, related_id, user_id, amount, status, error_message, created_at) 
             VALUES (?, ?, 'settlement', ?, ?, ?, 'failed', ?, NOW())`,
            [
              docType,
              mgtKey,
              settlementId,
              settlement.user_id,
              finalAmount,
              error.message,
            ],
          );
        } catch (dbError) {
          console.error(
            `??발행 ?�패 기록 ?�???�류 (?�산 ID: ${settlementId}):`,
            dbError.message,
          );
        }

        documentIssueResult = {
          type: docType,
          status: "failed",
          error: error.message,
        };
      }
    }

    res.json({
      message: "?�산 처리가 ?�료?�었?�니??",
      settlement: updated[0],
      payment_info: {
        payment_amount: paymentAmount,
        previous_completed: currentCompletedAmount,
        new_completed: newCompletedAmount,
        remaining: finalAmount - newCompletedAmount,
        status: newPaymentStatus,
      },
      document_issue: documentIssueResult,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error processing settlement:", err);
    res.status(500).json({
      message: "?�산 처리 �??�류가 발생?�습?�다.",
      error: err.message,
    });
  } finally {
    connection.release();
  }
});

/**
 * PUT /api/bid-results/admin/settlements/bulk-update
 * ?�괄 ?�태 ?�데?�트
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

  // ?�� unpaid, pending, paid�?변�?
  if (!status || !["unpaid", "pending", "paid"].includes(status)) {
    return res.status(400).json({
      message: "Invalid status. Must be: unpaid, pending, or paid",
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const placeholders = settlement_ids.map(() => "?").join(",");
    // ?�� payment_status�?변�?
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
// ?�버�?API
// =====================================================

/**
 * GET /api/bid-results/debug/settlement-mismatch
 * Settlement?� ?�제 ?�찰 ?�이?��? 맞�? ?�는 경우 조사
 */
router.get("/debug/settlement-mismatch", isAdmin, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    // 1. 모든 ?�산 ?�이??조회
    const [settlements] = await connection.query(
      `SELECT * FROM daily_settlements ORDER BY user_id, settlement_date`,
    );

    const mismatches = [];

    for (const settlement of settlements) {
      // 2. ?�당 ?�산???�당?�는 ?�제 ?�찰 ?�이??조회
      const [liveBids] = await connection.query(
        `SELECT l.*, i.auc_num, i.category
         FROM live_bids l
         LEFT JOIN crawled_items i ON l.item_id = i.item_id
         WHERE l.user_id = ? 
           AND DATE(i.scheduled_date) = ?
           AND l.status = 'completed'
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
           AND d.status = 'completed'
           AND d.winning_price > 0
           AND d.current_price >= d.winning_price`,
        [settlement.user_id, settlement.settlement_date],
      );

      const actualItems = [...liveBids, ...directBids];

      // 3. ?�제 ?�이?��? ?�산 ?�이??비교
      const actualItemCount = actualItems.length;
      const settlementItemCount = settlement.item_count;

      // ?�제 ?�화 총액 계산
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

      // 불일�??�인
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

    // 4. ?�산?� ?�는???�제 ?�찰???�는 경우 체크
    const [orphanSettlements] = await connection.query(
      `SELECT s.* 
       FROM daily_settlements s
       WHERE NOT EXISTS (
         SELECT 1 FROM live_bids l 
         JOIN crawled_items i ON l.item_id = i.item_id
         WHERE l.user_id = s.user_id 
           AND DATE(i.scheduled_date) = s.settlement_date
           AND l.status = 'completed'
           AND l.winning_price > 0
       )
       AND NOT EXISTS (
         SELECT 1 FROM direct_bids d
         JOIN crawled_items i ON d.item_id = i.item_id
         WHERE d.user_id = s.user_id 
           AND DATE(i.scheduled_date) = s.settlement_date
           AND d.status = 'completed'
           AND d.winning_price > 0
       )`,
    );

    // 5. ?�찰?� ?�는???�산???�는 경우 체크
    const [missingSettlements] = await connection.query(
      `SELECT DISTINCT l.user_id, DATE(i.scheduled_date) as settlement_date, COUNT(*) as item_count
       FROM live_bids l
       JOIN crawled_items i ON l.item_id = i.item_id
       WHERE l.status = 'completed'
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
       WHERE d.status = 'completed'
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
 * Settlement 불일�??�정 (?�락???�산�??�성, 기존 ?�율 최�????�용)
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

    // 1. ?�찰?� ?�는???�산???�는 경우 ???�산 ?�성
    const [missingSettlements] = await connection.query(
      `SELECT DISTINCT l.user_id, DATE(i.scheduled_date) as settlement_date
       FROM live_bids l
       JOIN crawled_items i ON l.item_id = i.item_id
       WHERE l.status = 'completed'
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
       WHERE d.status = 'completed'
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

    // 2. ?�산?� ?�는???�찰???�는 경우 ???�산 ??��
    const [orphanSettlements] = await connection.query(
      `SELECT s.* 
       FROM daily_settlements s
       WHERE NOT EXISTS (
         SELECT 1 FROM live_bids l 
         JOIN crawled_items i ON l.item_id = i.item_id
         WHERE l.user_id = s.user_id 
           AND DATE(i.scheduled_date) = s.settlement_date
           AND l.status = 'completed'
           AND l.winning_price > 0
       )
       AND NOT EXISTS (
         SELECT 1 FROM direct_bids d
         JOIN crawled_items i ON d.item_id = i.item_id
         WHERE d.user_id = s.user_id 
           AND DATE(i.scheduled_date) = s.settlement_date
           AND d.status = 'completed'
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

    // 3. ?�산�??�찰??모두 ?��?�??�이?��? 맞�? ?�는 경우 ??createOrUpdateSettlement ?�출
    const [allSettlements] = await connection.query(
      `SELECT DISTINCT user_id, settlement_date FROM daily_settlements`,
    );

    for (const settlement of allSettlements) {
      // ?��? ?�성?�거????��????��?� ?�킵
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
        // ?�제 ?�찰 ?�이??조회
        const [liveBids] = await connection.query(
          `SELECT l.winning_price, l.appr_id, l.repair_requested_at, l.repair_fee
           FROM live_bids l
           LEFT JOIN crawled_items i ON l.item_id = i.item_id
           WHERE l.user_id = ? 
             AND DATE(i.scheduled_date) = ?
             AND l.status = 'completed'
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
             AND d.status = 'completed'
             AND d.winning_price > 0
             AND d.current_price >= d.winning_price`,
          [settlement.user_id, settlement.settlement_date],
        );

        const actualItems = [...liveBids, ...directBids];

        // ?�산 ?�이??조회
        const [settlementData] = await connection.query(
          `SELECT * FROM daily_settlements WHERE user_id = ? AND settlement_date = ?`,
          [settlement.user_id, settlement.settlement_date],
        );

        if (settlementData.length === 0) continue;

        const currentSettlement = settlementData[0];

        // ?�제 �?계산
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

        // 불일�??�인
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
// ?�퍼 ?�수
// =====================================================

function classifyBidStatus(item) {
  const winningPrice = Number(item.winning_price || 0);
  const finalPrice = Number(item.final_price || 0);

  if (!winningPrice || winningPrice === 0) {
    return "pending";
  }

  if (item.status === "completed") {
    return "success";
  }

  return "failed";
}

// =====================================================
// 관리자 ?�용 API - ?�찰 결과 ?�이지??
// =====================================================

/**
 * GET /api/admin/bid-results
 * 관리자???�찰 결과 목록 조회 (3?�계 구조: ?�짜�????�람�????�품�?
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

    // ========================================
    // 1?�계: ?�짜 목록 조회 (?�터�??�용)
    // ========================================
    let dateWhereConditions = ["ds.settlement_date >= ?"];
    let dateQueryParams = [fromDate];

    // ?�산 ?�태 ?�터
    if (status) {
      dateWhereConditions.push("ds.payment_status = ?");
      dateQueryParams.push(status);
    }

    // ?�워??검??(?��?ID, ?��?�? ?�사�? ?�짜)
    if (keyword) {
      dateWhereConditions.push(
        "(u.login_id LIKE ? OR u.company_name LIKE ? OR ds.settlement_date LIKE ?)",
      );
      dateQueryParams.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const dateWhereClause = dateWhereConditions.join(" AND ");

    // ?�짜�??�렬 ?�정
    const dateOrder = sortBy === "date" ? sortOrder.toUpperCase() : "DESC";

    // ?�체 ?�짜 ??조회
    const [dateCountResult] = await connection.query(
      `SELECT COUNT(DISTINCT ds.settlement_date) as total
       FROM daily_settlements ds
       LEFT JOIN users u ON ds.user_id = u.id
       WHERE ${dateWhereClause}`,
      dateQueryParams,
    );

    const totalDates = dateCountResult[0].total;
    const totalPages = Math.ceil(totalDates / parseInt(limit));

    // ?�이지?�이???�용?�여 ?�짜 목록 조회
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const [dateRows] = await connection.query(
      `SELECT DISTINCT ds.settlement_date as date
       FROM daily_settlements ds
       LEFT JOIN users u ON ds.user_id = u.id
       WHERE ${dateWhereClause}
       ORDER BY ds.settlement_date ${dateOrder}
       LIMIT ? OFFSET ?`,
      [...dateQueryParams, parseInt(limit), offset],
    );

    // ========================================
    // 2?�계: �??�짜별로 ?��? 목록 조회
    // ========================================
    const dailyResults = [];

    for (const dateRow of dateRows) {
      const targetDate = dateRow.date;

      // ?�당 ?�짜??모든 ?��? ?�산 ?�보 조회
      let userWhereConditions = ["ds.settlement_date = ?"];
      let userQueryParams = [targetDate];

      // ?�산 ?�태 ?�터 ?�용
      if (status) {
        userWhereConditions.push("ds.payment_status = ?");
        userQueryParams.push(status);
      }

      // ?�워??검???�용
      if (keyword) {
        userWhereConditions.push(
          "(u.login_id LIKE ? OR u.company_name LIKE ?)",
        );
        userQueryParams.push(`%${keyword}%`, `%${keyword}%`);
      }

      const userWhereClause = userWhereConditions.join(" AND ");

      // ?��?�??�렬 ?�정
      let userOrderBy = "u.login_id";
      if (sortBy === "total_price") {
        userOrderBy = "ds.final_amount";
      } else if (sortBy === "item_count") {
        userOrderBy = "ds.item_count";
      }
      const userOrder = sortBy !== "date" ? sortOrder.toUpperCase() : "ASC";

      const [userRows] = await connection.query(
        `SELECT 
           ds.id as settlementId,
           ds.user_id as userId,
           u.login_id as userLoginId,
           u.company_name as companyName,
           ds.item_count as itemCount,
           ds.total_amount as totalKoreanPrice,
           ds.fee_amount as feeAmount,
           ds.vat_amount as vatAmount,
           ds.appraisal_fee as appraisalFee,
           ds.appraisal_vat as appraisalVat,
           ds.final_amount as grandTotal,
           ds.completed_amount as completedAmount,
           ds.payment_status as paymentStatus,
           ds.depositor_name as depositorName,
           ds.exchange_rate as exchangeRate
         FROM daily_settlements ds
         LEFT JOIN users u ON ds.user_id = u.id
         WHERE ${userWhereClause}
         ORDER BY ${userOrderBy} ${userOrder}`,
        userQueryParams,
      );

      // ?�짜�?총계 계산
      const dateTotal = {
        totalUsers: userRows.length,
        totalItemCount: 0,
        totalKoreanPrice: 0,
        totalFeeAmount: 0,
        totalAppraisalFee: 0,
        totalGrandTotal: 0,
        totalCompletedAmount: 0,
        totalRemainingAmount: 0,
      };

      const users = userRows.map((user) => {
        const remainingAmount =
          (user.grandTotal || 0) - (user.completedAmount || 0);

        // ?�짜�?총계 ?�적
        dateTotal.totalItemCount += user.itemCount || 0;
        dateTotal.totalKoreanPrice += parseFloat(user.totalKoreanPrice || 0);
        dateTotal.totalFeeAmount += parseFloat(user.feeAmount || 0);
        dateTotal.totalAppraisalFee += parseFloat(user.appraisalFee || 0);
        dateTotal.totalGrandTotal += parseFloat(user.grandTotal || 0);
        dateTotal.totalCompletedAmount += parseFloat(user.completedAmount || 0);
        dateTotal.totalRemainingAmount += remainingAmount;

        return {
          settlementId: user.settlementId,
          userId: user.userId,
          userLoginId: user.userLoginId,
          companyName: user.companyName,
          itemCount: user.itemCount,
          totalKoreanPrice: user.totalKoreanPrice,
          feeAmount: user.feeAmount,
          vatAmount: user.vatAmount,
          appraisalFee: user.appraisalFee,
          appraisalVat: user.appraisalVat,
          grandTotal: user.grandTotal,
          completedAmount: user.completedAmount,
          remainingAmount: remainingAmount,
          paymentStatus: user.paymentStatus,
          depositorName: user.depositorName,
          exchangeRate: user.exchangeRate,
        };
      });

      dailyResults.push({
        date: targetDate,
        users: users,
        summary: dateTotal,
      });
    }

    // ?�답
    res.json({
      dailyResults: dailyResults,
      pagination: {
        currentPage: parseInt(page),
        totalPages: totalPages,
        totalItems: totalDates,
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
 * ?�정 ?��?/?�짜???�찰 결과 ?�세 조회 (?�찰 ?�료??것만)
 */
router.get("/admin/bid-results/detail", isAdmin, async (req, res) => {
  const { userId, date } = req.query;

  if (!userId || !date) {
    return res.status(400).json({ message: "userId and date are required" });
  }

  const connection = await pool.getConnection();

  try {
    // ?�산 ?�보 먼�? 조회 (?�율 ?�함)
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

    // ?�찰 ?�료??live_bids�?조회
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

    // ?�찰 ?�료??direct_bids�?조회
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

    // �??�이?�에 관부가???�함 가�?계산 �?총액 집계
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
          console.error("관부가??계산 ?�류:", error);
          koreanPrice = 0;
        }
      }

      // ?�계 계산 (?�찰 ?�료 ?�이?�만)
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

    // ?�수�?계산
    let feeAmount = 0;
    let vatAmount = 0;
    let appraisalFee = 0;
    let appraisalVat = 0;
    let grandTotal = 0;

    if (settlement) {
      // ?�산 ?�보가 ?�으�?DB �??�용
      feeAmount = settlement.fee_amount || 0;
      vatAmount = settlement.vat_amount || 0;
      appraisalFee = settlement.appraisal_fee || 0;
      appraisalVat = settlement.appraisal_vat || 0;
      grandTotal = settlement.grandTotal || 0;
    } else if (allItems.length > 0) {
      // ?�산 ?�보가 ?�으�?계산
      // ?�용???�수료율 조회
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
