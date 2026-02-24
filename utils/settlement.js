// utils/settlement.js
const { pool } = require("./DB");
const { calculateFee, calculateTotalPrice } = require("./calculate-fee");
const { getExchangeRate } = require("./exchange-rate");
const {
  deductDeposit,
  refundDeposit,
  getBidDeductAmount,
} = require("./deposit");

/**
 * ?¬ìš©???˜ìˆ˜ë£Œìœ¨ ê°€?¸ì˜¤ê¸?
 */
async function getUserCommissionRate(userId) {
  try {
    const [users] = await pool.query(
      "SELECT commission_rate FROM users WHERE id = ?",
      [userId],
    );

    if (users.length > 0 && users[0].commission_rate !== null) {
      return users[0].commission_rate;
    }

    return null; // ê¸°ë³¸ ?˜ìˆ˜ë£Œìœ¨ ?¬ìš©
  } catch (error) {
    console.error("?¬ìš©???˜ìˆ˜ë£Œìœ¨ ì¡°íšŒ ?¤íŒ¨:", error);
    return null;
  }
}

/**
 * ?¼ë³„ ?•ì‚° ?ì„±/?…ë°?´íŠ¸
 */
async function createOrUpdateSettlement(userId, date) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 0. ê³„ì • ?€???•ì¸ (ì¶”ê???
    const [accounts] = await connection.query(
      "SELECT account_type FROM user_accounts WHERE user_id = ?",
      [userId],
    );
    const accountType = accounts[0]?.account_type || "individual";

    // [?˜ì •] 1. ?˜ìœ¨ ê²°ì • ë¡œì§ (?¤ëƒ…???˜ìœ¨ ? ì?)
    // ?•ì‚° ?°ì´?°ê? ?´ë? ì¡´ì¬?œë‹¤ë©? ìµœì´ˆ ?ì„± ?œì ???˜ìœ¨??ê·¸ë?ë¡??¬ìš©?´ì•¼ ??
    let exchangeRate;
    const [existingSettlementData] = await connection.query(
      "SELECT exchange_rate FROM daily_settlements WHERE user_id = ? AND settlement_date = ?",
      [userId, date],
    );

    if (existingSettlementData.length > 0) {
      exchangeRate = existingSettlementData[0].exchange_rate;
    } else {
      exchangeRate = await getExchangeRate();
    }

    // 2. ?¬ìš©???˜ìˆ˜ë£Œìœ¨ ê°€?¸ì˜¤ê¸?
    const userCommissionRate = await getUserCommissionRate(userId);

    // 3. ?´ë‹¹ ? ì§œ???™ì°° ?±ê³µ ?„ì´??ì¡°íšŒ
    const [liveBids] = await connection.query(
      `SELECT l.winning_price, l.appr_id, l.repair_requested_at, l.repair_fee, i.auc_num, i.category
       FROM live_bids l
       LEFT JOIN crawled_items i ON l.item_id = i.item_id
       WHERE l.user_id = ? 
         AND DATE(i.scheduled_date) = ?
         AND l.status = 'completed'`,
      [userId, date],
    );

    const [directBids] = await connection.query(
      `SELECT d.winning_price, d.appr_id, d.repair_requested_at, d.repair_fee, i.auc_num, i.category
       FROM direct_bids d
       LEFT JOIN crawled_items i ON d.item_id = i.item_id
       WHERE d.user_id = ? 
         AND DATE(i.scheduled_date) = ?
         AND d.status = 'completed'`,
      [userId, date],
    );

    const items = [...liveBids, ...directBids];

    if (items.length === 0) {
      // ?™ì°° ?±ê³µ ?†ìœ¼ë©??•ì‚° ?? œ
      await connection.query(
        "DELETE FROM daily_settlements WHERE user_id = ? AND settlement_date = ?",
        [userId, date],
      );
      await connection.commit();
      return null;
    }

    // 4. ì´ì•¡ ê³„ì‚° (?¤ëƒ…???˜ìœ¨ ?¬ìš©)
    let totalJapaneseYen = 0;
    let totalAmount = 0;
    let appraisalCount = 0;
    let repairCount = 0;
    let totalRepairFee = 0; // ?˜ì„  ë¹„ìš© ?©ê³„

    items.forEach((item) => {
      totalJapaneseYen += Number(item.winning_price);

      // calculateTotalPrice???˜ìœ¨ ?„ë‹¬
      const koreanPrice = calculateTotalPrice(
        item.winning_price,
        item.auc_num,
        item.category,
        exchangeRate, // ?¤ëƒ…???˜ìœ¨
      );
      totalAmount += koreanPrice;

      // ê°ì •??ê°œìˆ˜
      if (item.appr_id) {
        appraisalCount++;
      }

      // ?˜ì„  ê°œìˆ˜ ë°?ë¹„ìš©
      if (item.repair_requested_at) {
        repairCount++;
        // ê°œë³„ ?˜ì„  ë¹„ìš©???ˆìœ¼ë©??©ì‚°, ?†ìœ¼ë©?0
        totalRepairFee += Number(item.repair_fee) || 0;
      }
    });

    // 5. ?˜ìˆ˜ë£?ê³„ì‚° (?¬ìš©?ë³„ ?˜ìˆ˜ë£Œìœ¨ ?ìš©)
    const feeAmount = Math.max(
      calculateFee(totalAmount, userCommissionRate),
      10000,
    );
    const vatAmount = Math.round((feeAmount / 1.1) * 0.1);

    // 6. ê°ì •???˜ìˆ˜ë£?
    const appraisalFee = appraisalCount * 16500;
    const appraisalVat = Math.round(appraisalFee / 11);

    // 7. ?˜ì„  ?˜ìˆ˜ë£?(ê°œë³„ ê¸ˆì•¡ ?©ì‚°)
    const repairFee = totalRepairFee; // ê°??˜ì„ ??repair_fee ?©ê³„
    const repairVat = repairFee > 0 ? Math.round(repairFee / 11) : 0;

    // 8. ìµœì¢… ê¸ˆì•¡
    const finalAmount = totalAmount + feeAmount + appraisalFee + repairFee;

    // [ë¡œì§ ë³€ê²? Payment Status ë°?Completed Amount ê²°ì •
    let initialPaymentStatus = "pending";
    let paymentMethod = null;
    let completedAmount = 0; // ? ê·œ ?ì„± ??ê¸°ë³¸ 0

    // ê¸°ì¡´ ?°ì´??ì¡°íšŒ
    const [existing] = await connection.query(
      "SELECT id, payment_status, completed_amount FROM daily_settlements WHERE user_id = ? AND settlement_date = ?",
      [userId, date],
    );

    if (accountType === "individual") {
      // ê°œì¸ ?Œì›?€ ?ë™ ê²°ì œ?´ë?ë¡???ƒ ?„ë‚© ì²˜ë¦¬
      initialPaymentStatus = "paid";
      paymentMethod = "deposit";
      completedAmount = finalAmount; // ì¦‰ì‹œ ?„ì•¡ ê²°ì œ??
    } else {
      // ê¸°ì—… ?Œì› (Corporate)
      initialPaymentStatus = "unpaid";
      paymentMethod = "manual";

      if (existing.length > 0) {
        // ê¸°ì¡´ ?°ì´?°ê? ?ˆëŠ” ê²½ìš°, ê¸?ê²°ì œ??? ì?
        completedAmount = Number(existing[0].completed_amount || 0);

        // [?µì‹¬] ì°¨ì•¡ ë°œìƒ ?¬ë? ?•ì¸
        if (completedAmount === 0) {
          // ?„ì§ ê²°ì œ ?ˆë¨ -> ë¯¸ê²°??Unpaid) ? ì?
          initialPaymentStatus = "unpaid";
        } else if (finalAmount > completedAmount) {
          // ë¶€ë¶?ê²°ì œ ?íƒœ (ì´ì•¡??ê¸?ê²°ì œ?¡ë³´???? -> ë¶€ë¶?ê²°ì œ(Pending) ? ì?
          initialPaymentStatus = "pending";
        } else if (finalAmount <= completedAmount) {
          // ì´ì•¡??ê°™ê±°??ì¤„ì–´?¤ë©´ -> ê²°ì œ ?„ë£Œ(Paid) ? ì?
          // (?˜ë¶ˆ ë¡œì§?€ ë³„ë„ ê³ ë ¤ ?„ìš”?˜ë‚˜, ?¬ê¸°?œëŠ” ?„ë£Œ ?íƒœ ? ì?)
          initialPaymentStatus = "paid";
        }
      }
    }

    if (existing.length > 0) {
      // ê¸°ì¡´ ?•ì‚° ?…ë°?´íŠ¸
      await connection.query(
        `UPDATE daily_settlements 
         SET item_count = ?,
             total_japanese_yen = ?,
             total_amount = ?, 
             fee_amount = ?, 
             vat_amount = ?,
             appraisal_fee = ?,
             appraisal_vat = ?,
             appraisal_count = ?,
             repair_fee = ?,
             repair_vat = ?,
             repair_count = ?,
             final_amount = ?, 
             completed_amount = ?,
             exchange_rate = ?,
             payment_status = ?
         WHERE id = ?`,
        [
          items.length,
          totalJapaneseYen,
          totalAmount,
          feeAmount,
          vatAmount,
          appraisalFee,
          appraisalVat,
          appraisalCount,
          repairFee,
          repairVat,
          repairCount,
          finalAmount,
          completedAmount,
          exchangeRate,
          initialPaymentStatus,
          existing[0].id,
        ],
      );
    } else {
      // ? ê·œ ?½ì…
      await connection.query(
        `INSERT INTO daily_settlements 
         (user_id, settlement_date, item_count, total_japanese_yen, 
          total_amount, fee_amount, vat_amount, 
          appraisal_fee, appraisal_vat, appraisal_count,
          repair_fee, repair_vat, repair_count,
          final_amount, completed_amount, exchange_rate, payment_status, payment_method)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          date,
          items.length,
          totalJapaneseYen,
          totalAmount,
          feeAmount,
          vatAmount,
          appraisalFee,
          appraisalVat,
          appraisalCount,
          repairFee,
          repairVat,
          repairCount,
          finalAmount,
          completedAmount,
          exchangeRate,
          initialPaymentStatus,
          paymentMethod,
        ],
      );
    }

    await connection.commit();
    console.log(`?•ì‚° ?ì„±/?…ë°?´íŠ¸ ?„ë£Œ: ${userId} - ${date}`);
    return true;
  } catch (err) {
    await connection.rollback();
    console.error("Error creating settlement:", err);
    throw err;
  } finally {
    connection.release();
  }
}

/**
 * ?•ì‚° ê¸ˆì•¡ê³??¤ì œ ì°¨ê° ê¸ˆì•¡ ë¹„êµ ??ì°¨ì•¡ ì¡°ì •
 * [?˜ì •] ê¸°ì—… ?Œì›(corporate)?€ ?ˆì¹˜ê¸?ì°¨ê° ë¡œì§???€ë©????˜ë?ë¡??¤í‚µ
 */
async function adjustDepositBalance(connection, userId, settlementDate) {
  try {
    // 0. ê¸°ì—… ?Œì› ì²´í¬ (ì¶”ê?)
    const [accounts] = await connection.query(
      "SELECT account_type FROM user_accounts WHERE user_id = ?",
      [userId],
    );
    if (accounts.length > 0 && accounts[0].account_type === "corporate") {
      return; // ê¸°ì—… ?Œì›?€ ?ˆì¹˜ê¸??ë™ ì¡°ì • ?¤í‚µ (?•ì‚°??ê¸ˆì•¡ë§??•ì •?˜ë©´ ??
    }

    // 1. ?•ì‚° ê¸ˆì•¡ ì¡°íšŒ (ê°ì •ë£??˜ì„ ë£??œì™¸)
    const [settlements] = await connection.query(
      "SELECT total_amount, fee_amount FROM daily_settlements WHERE user_id = ? AND settlement_date = ?",
      [userId, settlementDate],
    );

    if (settlements.length === 0) return;

    const settlement = settlements[0];
    const settlementAmount =
      Number(settlement.total_amount) + Number(settlement.fee_amount);

    // 2. ?¤ì œ ì°¨ê° ê¸ˆì•¡ ì¡°íšŒ (deposit_transactions?ì„œ)
    const [bids] = await connection.query(
      `SELECT d.id, 'direct_bid' as bid_type
       FROM direct_bids d 
       JOIN crawled_items i ON d.item_id = i.item_id 
       WHERE d.user_id = ? AND DATE(i.scheduled_date) = ? AND d.status = 'completed'
       UNION
       SELECT l.id, 'live_bid' as bid_type
       FROM live_bids l 
       JOIN crawled_items i ON l.item_id = i.item_id 
       WHERE l.user_id = ? AND DATE(i.scheduled_date) = ? AND l.status = 'completed'`,
      [userId, settlementDate, userId, settlementDate],
    );

    // 3. ê°??…ì°°??ì°¨ê°???©ê³„
    let totalDeducted = 0;
    for (const bid of bids) {
      const deductAmount = await getBidDeductAmount(
        connection,
        bid.id,
        bid.bid_type,
      );
      totalDeducted += deductAmount;
    }

    // 4. ì°¨ì•¡ ê³„ì‚°
    const diff = settlementAmount - totalDeducted;

    if (Math.abs(diff) < 1) {
      return; // ì°¨ì´ 1??ë¯¸ë§Œ ë¬´ì‹œ
    }

    // 5. ì°¨ì•¡ ì¡°ì •
    if (diff > 0) {
      // ì¶”ê? ì°¨ê°
      await deductDeposit(
        connection,
        userId,
        diff,
        "settlement_adjust",
        null,
        `?•ì‚° ?•ì • ì°¨ì•¡ ì¡°ì • (${settlementDate}, ?˜ìœ¨ ë³€??`,
      );
    } else {
      // ?˜ë¶ˆ
      const refundAmount = Math.abs(diff);
      await refundDeposit(
        connection,
        userId,
        refundAmount,
        "settlement_adjust",
        null,
        `?•ì‚° ?•ì • ì°¨ì•¡ ?˜ë¶ˆ (${settlementDate}, ?˜ìœ¨ ë³€??`,
      );
    }
  } catch (error) {
    console.error("ì°¨ì•¡ ì¡°ì • ?¤íŒ¨:", error);
    throw error;
  }
}

module.exports = {
  createOrUpdateSettlement,
  getUserCommissionRate,
  adjustDepositBalance,
};
