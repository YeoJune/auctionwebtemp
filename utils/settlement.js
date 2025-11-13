// utils/settlement.js
const { pool } = require("./DB");
const { calculateFee, calculateTotalPrice } = require("./calculate-fee");
const { getExchangeRate } = require("./exchange-rate");

/**
 * 사용자 수수료율 가져오기
 */
async function getUserCommissionRate(userId) {
  try {
    const [users] = await pool.query(
      "SELECT commission_rate FROM users WHERE id = ?",
      [userId]
    );

    if (users.length > 0 && users[0].commission_rate !== null) {
      return users[0].commission_rate;
    }

    return null; // 기본 수수료율 사용
  } catch (error) {
    console.error("사용자 수수료율 조회 실패:", error);
    return null;
  }
}

/**
 * 일별 정산 생성/업데이트
 */
async function createOrUpdateSettlement(userId, date) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. 환율 가져오기 (최신 환율)
    const exchangeRate = await getExchangeRate();

    // 2. 사용자 수수료율 가져오기
    const userCommissionRate = await getUserCommissionRate(userId);

    // 3. 해당 날짜의 낙찰 성공 아이템 조회
    const [liveBids] = await connection.query(
      `SELECT l.winning_price, l.appr_id, l.repair_requested_at, l.repair_fee, i.auc_num, i.category
       FROM live_bids l
       LEFT JOIN crawled_items i ON l.item_id = i.item_id
       WHERE l.user_id = ? 
         AND DATE(i.scheduled_date) = ?
         AND l.status IN ('completed', 'shipped')`,
      [userId, date]
    );

    const [directBids] = await connection.query(
      `SELECT d.winning_price, d.appr_id, d.repair_requested_at, d.repair_fee, i.auc_num, i.category
       FROM direct_bids d
       LEFT JOIN crawled_items i ON d.item_id = i.item_id
       WHERE d.user_id = ? 
         AND DATE(i.scheduled_date) = ?
         AND d.status IN ('completed', 'shipped')`,
      [userId, date]
    );

    const items = [...liveBids, ...directBids];

    if (items.length === 0) {
      // 낙찰 성공 없으면 정산 삭제
      await connection.query(
        "DELETE FROM daily_settlements WHERE user_id = ? AND settlement_date = ?",
        [userId, date]
      );
      await connection.commit();
      return null;
    }

    // 4. 총액 계산 (스냅샷 환율 사용)
    let totalJapaneseYen = 0;
    let totalAmount = 0;
    let appraisalCount = 0;
    let repairCount = 0;
    let totalRepairFee = 0; // 수선 비용 합계

    items.forEach((item) => {
      totalJapaneseYen += Number(item.winning_price);

      // calculateTotalPrice에 환율 전달
      const koreanPrice = calculateTotalPrice(
        item.winning_price,
        item.auc_num,
        item.category,
        exchangeRate // 스냅샷 환율
      );
      totalAmount += koreanPrice;

      // 감정서 개수
      if (item.appr_id) {
        appraisalCount++;
      }

      // 수선 개수 및 비용
      if (item.repair_requested_at) {
        repairCount++;
        // 개별 수선 비용이 있으면 합산, 없으면 0
        totalRepairFee += Number(item.repair_fee) || 0;
      }
    });

    // 5. 수수료 계산 (사용자별 수수료율 적용)
    const feeAmount = Math.max(
      calculateFee(totalAmount, userCommissionRate),
      10000
    );
    const vatAmount = Math.round((feeAmount / 1.1) * 0.1);

    // 6. 감정서 수수료
    const appraisalFee = appraisalCount * 16500;
    const appraisalVat = Math.round(appraisalFee / 11);

    // 7. 수선 수수료 (개별 금액 합산)
    const repairFee = totalRepairFee; // 각 수선의 repair_fee 합계
    const repairVat = repairFee > 0 ? Math.round(repairFee / 11) : 0;

    // 8. 최종 금액
    const finalAmount = totalAmount + feeAmount + appraisalFee + repairFee;

    // 8. 정산 저장 (INSERT or UPDATE)
    const [existing] = await connection.query(
      "SELECT id FROM daily_settlements WHERE user_id = ? AND settlement_date = ?",
      [userId, date]
    );

    if (existing.length > 0) {
      // 업데이트
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
             exchange_rate = ?
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
          exchangeRate,
          existing[0].id,
        ]
      );
    } else {
      // 삽입
      await connection.query(
        `INSERT INTO daily_settlements 
         (user_id, settlement_date, item_count, total_japanese_yen, 
          total_amount, fee_amount, vat_amount, 
          appraisal_fee, appraisal_vat, appraisal_count,
          repair_fee, repair_vat, repair_count,
          final_amount, exchange_rate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          exchangeRate,
        ]
      );
    }

    await connection.commit();
    console.log(`정산 생성/업데이트 완료: ${userId} - ${date}`);
    return true;
  } catch (err) {
    await connection.rollback();
    console.error("Error creating settlement:", err);
    throw err;
  } finally {
    connection.release();
  }
}

createOrUpdateSettlement("hj5333", "2025-11-03");

module.exports = { createOrUpdateSettlement };
