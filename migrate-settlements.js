// scripts/migrate-settlements.js
const { pool } = require("./utils/DB");
const { calculateFee, calculateTotalPrice } = require("./utils/calculate-fee");

// ✨ 고정 환율 (마이그레이션용)
const MIGRATION_EXCHANGE_RATE = 9.628;

/**
 * 사용자 수수료율 가져오기
 */
async function getUserCommissionRate(connection, userId) {
  try {
    const [users] = await connection.query(
      "SELECT commission_rate FROM users WHERE id = ?",
      [userId]
    );

    if (users.length > 0 && users[0].commission_rate !== null) {
      return users[0].commission_rate;
    }

    return null; // 기본 수수료율 사용
  } catch (error) {
    console.error(`사용자 수수료율 조회 실패 (${userId}):`, error.message);
    return null;
  }
}

/**
 * 특정 날짜의 정산 생성 (마이그레이션용)
 */
async function createSettlementForDate(connection, userId, date, exchangeRate) {
  try {
    // 1. 사용자 수수료율 가져오기
    const userCommissionRate = await getUserCommissionRate(connection, userId);

    // 2. 해당 날짜의 낙찰 성공 아이템 조회 (live_bids)
    const [liveBids] = await connection.query(
      `SELECT l.winning_price, l.appr_id, i.auc_num, i.category
       FROM live_bids l
       LEFT JOIN crawled_items i ON l.item_id = i.item_id
       WHERE l.user_id = ? 
         AND DATE(i.scheduled_date) = ?
         AND l.status IN ('completed', 'shipped')
         AND l.winning_price > 0
         AND l.final_price >= l.winning_price`,
      [userId, date]
    );

    // 3. 해당 날짜의 낙찰 성공 아이템 조회 (direct_bids)
    const [directBids] = await connection.query(
      `SELECT d.winning_price, d.appr_id, i.auc_num, i.category
       FROM direct_bids d
       LEFT JOIN crawled_items i ON d.item_id = i.item_id
       WHERE d.user_id = ? 
         AND DATE(i.scheduled_date) = ?
         AND d.status IN ('completed', 'shipped')
         AND d.winning_price > 0
         AND d.current_price >= d.winning_price`,
      [userId, date]
    );

    const items = [...liveBids, ...directBids];

    if (items.length === 0) {
      console.log(`  ⚠️  ${userId} - ${date}: 낙찰 아이템 없음 (스킵)`);
      return { skipped: true };
    }

    // 4. 총액 계산
    let totalJapaneseYen = 0;
    let totalAmount = 0;
    let appraisalCount = 0;

    items.forEach((item) => {
      totalJapaneseYen += Number(item.winning_price);

      // 관부가세 포함 원화 가격 계산
      const koreanPrice = calculateTotalPrice(
        item.winning_price,
        item.auc_num,
        item.category,
        exchangeRate
      );
      totalAmount += koreanPrice;

      // 감정서 개수
      if (item.appr_id) {
        appraisalCount++;
      }
    });

    // 5. 수수료 계산
    const feeAmount = Math.max(
      calculateFee(totalAmount, userCommissionRate),
      10000
    );
    const vatAmount = Math.round((feeAmount / 1.1) * 0.1);

    // 6. 감정서 수수료
    const appraisalFee = appraisalCount * 16500;
    const appraisalVat = Math.round(appraisalFee / 11);

    // 7. 최종 금액
    const finalAmount = totalAmount + feeAmount + appraisalFee;

    // 8. 정산 저장
    await connection.query(
      `INSERT INTO daily_settlements 
       (user_id, settlement_date, item_count, total_japanese_yen, 
        total_amount, fee_amount, vat_amount, 
        appraisal_fee, appraisal_vat, appraisal_count,
        final_amount, exchange_rate, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
       ON DUPLICATE KEY UPDATE
         item_count = VALUES(item_count),
         total_japanese_yen = VALUES(total_japanese_yen),
         total_amount = VALUES(total_amount),
         fee_amount = VALUES(fee_amount),
         vat_amount = VALUES(vat_amount),
         appraisal_fee = VALUES(appraisal_fee),
         appraisal_vat = VALUES(appraisal_vat),
         appraisal_count = VALUES(appraisal_count),
         final_amount = VALUES(final_amount),
         exchange_rate = VALUES(exchange_rate)`,
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
        finalAmount,
        exchangeRate,
      ]
    );

    return {
      success: true,
      itemCount: items.length,
      totalJapaneseYen,
      finalAmount,
    };
  } catch (error) {
    console.error(`  ❌ ${userId} - ${date}: 정산 생성 실패`, error.message);
    throw error;
  }
}

/**
 * 기존 데이터 마이그레이션
 */
async function migrateExistingData() {
  const connection = await pool.getConnection();

  try {
    console.log("=".repeat(60));
    console.log("📦 기존 낙찰 데이터 마이그레이션 시작");
    console.log("=".repeat(60));
    console.log(`환율: ${MIGRATION_EXCHANGE_RATE}`);
    console.log("");

    // 1. 기존 낙찰 데이터에서 유저별, 날짜별 조회
    console.log("📊 마이그레이션 대상 조회 중...");
    const [settlements] = await connection.query(`
      SELECT DISTINCT 
        user_id, 
        DATE(i.scheduled_date) as settlement_date
      FROM (
        SELECT user_id, item_id, status, winning_price, final_price
        FROM live_bids 
        WHERE status IN ('completed', 'shipped') 
          AND winning_price > 0
        UNION
        SELECT user_id, item_id, status, winning_price, current_price as final_price
        FROM direct_bids 
        WHERE status IN ('completed', 'shipped') 
          AND winning_price > 0
      ) as bids
      LEFT JOIN crawled_items i ON bids.item_id = i.item_id
      WHERE i.scheduled_date IS NOT NULL
        AND (
          (bids.final_price >= bids.winning_price) OR
          (bids.final_price IS NULL AND bids.winning_price > 0)
        )
      ORDER BY settlement_date ASC, user_id ASC
    `);

    console.log(`✅ 총 ${settlements.length}개의 정산 생성 예정\n`);

    if (settlements.length === 0) {
      console.log("⚠️  마이그레이션할 데이터가 없습니다.");
      return;
    }

    // 2. 각 정산에 대해 처리
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    let totalJapaneseYen = 0;
    let totalFinalAmount = 0;

    console.log("🔄 마이그레이션 진행 중...\n");

    for (let i = 0; i < settlements.length; i++) {
      const settlement = settlements[i];
      const progress = `[${i + 1}/${settlements.length}]`;

      try {
        const result = await createSettlementForDate(
          connection,
          settlement.user_id,
          settlement.settlement_date,
          MIGRATION_EXCHANGE_RATE
        );

        if (result.skipped) {
          skipCount++;
        } else if (result.success) {
          successCount++;
          totalJapaneseYen += result.totalJapaneseYen;
          totalFinalAmount += result.finalAmount;

          console.log(
            `${progress} ✅ ${settlement.user_id} - ${settlement.settlement_date} | ` +
              `아이템: ${result.itemCount}개 | ` +
              `¥${formatNumber(result.totalJapaneseYen)} → ` +
              `₩${formatNumber(result.finalAmount)}`
          );
        }

        // 진행률 표시 (10개마다)
        if ((i + 1) % 10 === 0) {
          console.log(
            `\n📈 진행률: ${i + 1}/${settlements.length} (${Math.round(
              ((i + 1) / settlements.length) * 100
            )}%)\n`
          );
        }
      } catch (error) {
        errorCount++;
        console.error(
          `${progress} ❌ ${settlement.user_id} - ${settlement.settlement_date}: ${error.message}`
        );
      }
    }

    // 3. 결과 요약
    console.log("\n" + "=".repeat(60));
    console.log("📊 마이그레이션 완료");
    console.log("=".repeat(60));
    console.log(`✅ 성공: ${successCount}개`);
    console.log(`⚠️  스킵: ${skipCount}개 (낙찰 아이템 없음)`);
    console.log(`❌ 실패: ${errorCount}개`);
    console.log("");
    console.log(`💴 총 일본 엔화: ¥${formatNumber(totalJapaneseYen)}`);
    console.log(`💰 총 최종 금액: ₩${formatNumber(totalFinalAmount)}`);
    console.log(`📈 환율: ${MIGRATION_EXCHANGE_RATE}`);
    console.log("=".repeat(60));

    // 4. 검증
    console.log("\n🔍 검증 중...");
    const [verifyResult] = await connection.query(`
      SELECT 
        COUNT(*) as count,
        SUM(item_count) as total_items,
        SUM(total_japanese_yen) as total_jpy,
        SUM(final_amount) as total_krw
      FROM daily_settlements
    `);

    console.log(`\n📋 DB 저장 결과:`);
    console.log(`   정산 레코드: ${verifyResult[0].count}개`);
    console.log(`   총 아이템: ${verifyResult[0].total_items}개`);
    console.log(`   총 일본 엔화: ¥${formatNumber(verifyResult[0].total_jpy)}`);
    console.log(`   총 최종 금액: ₩${formatNumber(verifyResult[0].total_krw)}`);
  } catch (error) {
    console.error("\n❌ 마이그레이션 중 치명적 오류 발생:", error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 숫자 포맷팅 (천 단위 콤마)
 */
function formatNumber(num) {
  if (num === null || num === undefined) return "0";
  return Math.round(num)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * 실행
 */
async function main() {
  try {
    console.log("\n");
    await migrateExistingData();
    console.log("\n✅ 마이그레이션 성공\n");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ 마이그레이션 실패:", error);
    process.exit(1);
  }
}

// 스크립트 직접 실행 시
if (require.main === module) {
  main();
}

module.exports = { migrateExistingData };
