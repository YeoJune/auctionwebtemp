// routes/popbill.js - 팝빌 API + Cron 통합
const express = require("express");
const router = express.Router();
const cron = require("node-cron");
const { pool } = require("../utils/DB");
const popbillService = require("../utils/popbill");

// 관리자 체크 미들웨어
const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.login_id === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Access denied. Admin only." });
  }
};

// ===== 사용자 API =====

/**
 * POST /api/popbill/check-payment
 * 사용자가 "입금 완료" 버튼 클릭 시 호출
 */
router.post("/check-payment", async (req, res) => {
  const { transaction_id } = req.body;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // 1. 거래 조회
    const [transactions] = await conn.query(
      "SELECT * FROM deposit_transactions WHERE id = ? AND user_id = ?",
      [transaction_id, userId],
    );

    if (transactions.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: "거래를 찾을 수 없습니다." });
    }

    const transaction = transactions[0];

    // 2. 이미 승인된 거래인지 확인
    if (transaction.status === "confirmed") {
      await conn.rollback();
      return res
        .status(400)
        .json({ message: "이미 승인된 거래입니다.", success: false });
    }

    // 3. 입금 확인 (팝빌 API)
    const startDate = new Date(transaction.created_at);
    startDate.setHours(0, 0, 0, 0); // 당일 00:00부터 조회

    let matched = null;
    try {
      matched = await popbillService.checkPayment(transaction, startDate);
    } catch (error) {
      console.error("[입금 확인 실패]", error);
      await conn.rollback();
      return res.status(500).json({
        success: false,
        message: "입금 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      });
    }

    // 4. 매칭 성공 → 자동 승인
    if (matched) {
      // 중복 매칭 방지 확인
      const isUsed = await popbillService.isTransactionUsed(matched.tid);
      if (isUsed) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          message: "이미 처리된 입금 내역입니다. 관리자에게 문의해주세요.",
        });
      }

      // 예치금 충전
      await conn.query(
        "UPDATE user_accounts SET deposit_balance = deposit_balance + ? WHERE user_id = ?",
        [transaction.amount, userId],
      );

      // 거래 상태 업데이트
      await conn.query(
        `UPDATE deposit_transactions 
         SET status = 'confirmed', 
             processed_at = NOW(),
             matched_at = NOW(),
             matched_amount = ?,
             matched_name = ?,
             retry_count = 0
         WHERE id = ?`,
        [matched.accIn, matched.remark2 || matched.remark1, transaction_id],
      );

      // 중복 방지 기록
      await popbillService.markTransactionUsed(
        matched.tid,
        matched,
        "deposit",
        transaction_id,
      );

      // 잔액 조회
      const [account] = await conn.query(
        "SELECT deposit_balance FROM user_accounts WHERE user_id = ?",
        [userId],
      );

      await conn.commit();

      return res.status(200).json({
        success: true,
        message: "입금 확인 완료! 예치금이 충전되었습니다.",
        new_balance: account[0].deposit_balance,
      });
    }

    // 5. 매칭 실패 → 재시도 카운트 증가
    const newRetryCount = transaction.retry_count + 1;

    if (newRetryCount >= 12) {
      // 12회 이상 실패 → 수동 확인 필요
      await conn.query(
        "UPDATE deposit_transactions SET status = 'manual_review', retry_count = ? WHERE id = ?",
        [newRetryCount, transaction_id],
      );
      await conn.commit();

      return res.status(200).json({
        success: false,
        message: "입금 내역을 찾을 수 없습니다. 관리자가 확인 중입니다.",
        status: "manual_review",
      });
    } else {
      // 재시도
      await conn.query(
        "UPDATE deposit_transactions SET retry_count = ? WHERE id = ?",
        [newRetryCount, transaction_id],
      );
      await conn.commit();

      return res.status(200).json({
        success: false,
        message:
          "아직 입금이 확인되지 않았습니다. 잠시 후 자동으로 다시 확인됩니다.",
        retry_count: newRetryCount,
        max_retries: 12,
      });
    }
  } catch (err) {
    await conn.rollback();
    console.error("Error checking payment:", err);
    return res
      .status(500)
      .json({ message: "입금 확인 중 오류가 발생했습니다." });
  } finally {
    conn.release();
  }
});

// ===== 관리자 API =====

/**
 * POST /api/popbill/admin/issue-cashbill
 * 현금영수증 발행 (관리자)
 */
router.post("/admin/issue-cashbill", isAdmin, async (req, res) => {
  const { transaction_id } = req.body;

  if (!transaction_id) {
    return res.status(400).json({ message: "transaction_id가 필요합니다." });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // 1. 거래 조회
    const [transactions] = await conn.query(
      `SELECT dt.*, u.email, u.phone, u.name 
       FROM deposit_transactions dt 
       JOIN users u ON dt.user_id = u.id 
       WHERE dt.id = ?`,
      [transaction_id],
    );

    if (transactions.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: "거래를 찾을 수 없습니다." });
    }

    const transaction = transactions[0];

    // 2. 이미 발행된 문서가 있는지 확인
    const [existing] = await conn.query(
      "SELECT * FROM popbill_documents WHERE related_type = 'deposit' AND related_id = ? AND type = 'cashbill'",
      [transaction_id],
    );

    if (existing.length > 0) {
      await conn.rollback();
      return res.status(400).json({
        message: "이미 발행된 현금영수증이 있습니다.",
        confirmNum: existing[0].confirm_num,
      });
    }

    // 3. 현금영수증 발행
    let result;
    try {
      result = await popbillService.issueCashbill(transaction, {
        email: transaction.email,
        phone: transaction.phone,
        name: transaction.name,
      });
    } catch (error) {
      await conn.rollback();
      console.error("[현금영수증 발행 실패]", error);
      return res.status(500).json({
        message: "현금영수증 발행 실패",
        error: error.message,
      });
    }

    // 4. DB 저장
    await conn.query(
      `INSERT INTO popbill_documents 
       (type, mgt_key, related_type, related_id, user_id, confirm_num, amount, status) 
       VALUES ('cashbill', ?, 'deposit', ?, ?, ?, ?, 'issued')`,
      [
        result.mgtKey,
        transaction_id,
        transaction.user_id,
        result.confirmNum,
        transaction.amount,
      ],
    );

    await conn.commit();

    res.status(200).json({
      success: true,
      message: "현금영수증이 발행되었습니다.",
      confirmNum: result.confirmNum,
      mgtKey: result.mgtKey,
    });
  } catch (err) {
    await conn.rollback();
    console.error("Error issuing cashbill:", err);
    res
      .status(500)
      .json({ message: "현금영수증 발행 중 오류가 발생했습니다." });
  } finally {
    conn.release();
  }
});

/**
 * POST /api/popbill/admin/issue-taxinvoice
 * 세금계산서 발행 (관리자)
 */
router.post("/admin/issue-taxinvoice", isAdmin, async (req, res) => {
  const { settlement_id } = req.body;

  if (!settlement_id) {
    return res.status(400).json({ message: "settlement_id가 필요합니다." });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // 1. 정산 조회
    const [settlements] = await conn.query(
      `SELECT ds.*, u.email, u.business_number, u.company_name, u.ceo_name, 
              u.company_address, u.business_type, u.business_class 
       FROM daily_settlements ds 
       JOIN users u ON ds.user_id = u.id 
       WHERE ds.id = ?`,
      [settlement_id],
    );

    if (settlements.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: "정산을 찾을 수 없습니다." });
    }

    const settlement = settlements[0];

    // 2. 사업자 정보 확인
    if (!settlement.business_number) {
      await conn.rollback();
      return res.status(400).json({
        message:
          "사업자등록번호가 등록되지 않았습니다. 사용자 정보를 먼저 등록해주세요.",
      });
    }

    // 3. 이미 발행된 문서가 있는지 확인
    const [existing] = await conn.query(
      "SELECT * FROM popbill_documents WHERE related_type = 'settlement' AND related_id = ? AND type = 'taxinvoice'",
      [settlement_id],
    );

    if (existing.length > 0) {
      await conn.rollback();
      return res.status(400).json({
        message: "이미 발행된 세금계산서가 있습니다.",
        ntsConfirmNum: existing[0].confirm_num,
      });
    }

    // 4. 세금계산서 발행
    let result;
    try {
      result = await popbillService.issueTaxinvoice(settlement, settlement);
    } catch (error) {
      await conn.rollback();
      console.error("[세금계산서 발행 실패]", error);
      return res.status(500).json({
        message: "세금계산서 발행 실패",
        error: error.message,
      });
    }

    // 5. DB 저장
    await conn.query(
      `INSERT INTO popbill_documents 
       (type, mgt_key, related_type, related_id, user_id, confirm_num, amount, status) 
       VALUES ('taxinvoice', ?, 'settlement', ?, ?, ?, ?, 'issued')`,
      [
        result.invoicerMgtKey,
        settlement_id,
        settlement.user_id,
        result.ntsConfirmNum,
        settlement.final_amount,
      ],
    );

    await conn.commit();

    res.status(200).json({
      success: true,
      message: "세금계산서가 발행되었습니다.",
      ntsConfirmNum: result.ntsConfirmNum,
      mgtKey: result.invoicerMgtKey,
    });
  } catch (err) {
    await conn.rollback();
    console.error("Error issuing taxinvoice:", err);
    res
      .status(500)
      .json({ message: "세금계산서 발행 중 오류가 발생했습니다." });
  } finally {
    conn.release();
  }
});

/**
 * GET /api/popbill/admin/documents
 * 발행 내역 조회 (관리자)
 */
router.get("/admin/documents", isAdmin, async (req, res) => {
  const { type, status, page = 1, limit = 20 } = req.query;

  const conn = await pool.getConnection();

  try {
    let where = [];
    let params = [];

    if (type) {
      where.push("type = ?");
      params.push(type);
    }

    if (status) {
      where.push("status = ?");
      params.push(status);
    }

    const whereClause = where.length > 0 ? "WHERE " + where.join(" AND ") : "";
    const offset = (page - 1) * limit;

    const [documents] = await conn.query(
      `SELECT * FROM popbill_documents ${whereClause} 
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset],
    );

    const [countResult] = await conn.query(
      `SELECT COUNT(*) as total FROM popbill_documents ${whereClause}`,
      params,
    );

    res.status(200).json({
      documents,
      pagination: {
        total: countResult[0].total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult[0].total / limit),
      },
    });
  } catch (err) {
    console.error("Error fetching documents:", err);
    res.status(500).json({ message: "문서 조회 중 오류가 발생했습니다." });
  } finally {
    conn.release();
  }
});

// ===== Cron: 입금 자동 확인 (10분마다) =====

cron.schedule("*/10 * * * *", async () => {
  console.log(
    `\n[입금 자동 확인] 시작... ${new Date().toLocaleString("ko-KR")}`,
  );

  const conn = await pool.getConnection();

  try {
    // pending 상태이고 재시도 횟수가 12회 미만인 거래 조회
    const [pendingTransactions] = await conn.query(
      `SELECT * FROM deposit_transactions 
       WHERE status = 'pending' AND retry_count < 12 
       ORDER BY created_at ASC 
       LIMIT 10`,
    );

    console.log(`[입금 자동 확인] 대상: ${pendingTransactions.length}건`);

    for (const transaction of pendingTransactions) {
      try {
        await conn.beginTransaction();

        // 입금 확인
        const startDate = new Date(transaction.created_at);
        startDate.setHours(0, 0, 0, 0);

        const matched = await popbillService.checkPayment(
          transaction,
          startDate,
        );

        if (matched) {
          // 중복 확인
          const isUsed = await popbillService.isTransactionUsed(matched.tid);
          if (isUsed) {
            console.log(
              `⚠️ 중복 거래: 거래 #${transaction.id} (TID: ${matched.tid})`,
            );
            await conn.query(
              "UPDATE deposit_transactions SET status = 'manual_review', retry_count = 12 WHERE id = ?",
              [transaction.id],
            );
            await conn.commit();
            continue;
          }

          // 자동 승인
          await conn.query(
            "UPDATE user_accounts SET deposit_balance = deposit_balance + ? WHERE user_id = ?",
            [transaction.amount, transaction.user_id],
          );

          await conn.query(
            `UPDATE deposit_transactions 
             SET status = 'confirmed', 
                 processed_at = NOW(),
                 matched_at = NOW(),
                 matched_amount = ?,
                 matched_name = ?,
                 retry_count = 0
             WHERE id = ?`,
            [matched.accIn, matched.remark2 || matched.remark1, transaction.id],
          );

          await popbillService.markTransactionUsed(
            matched.tid,
            matched,
            "deposit",
            transaction.id,
          );

          await conn.commit();
          console.log(
            `✅ 자동 승인 성공: 거래 #${transaction.id}, 금액: ${transaction.amount}원`,
          );
        } else {
          // 재시도 카운트 증가
          const newRetryCount = transaction.retry_count + 1;

          if (newRetryCount >= 12) {
            await conn.query(
              "UPDATE deposit_transactions SET status = 'manual_review', retry_count = ? WHERE id = ?",
              [newRetryCount, transaction.id],
            );
            console.log(
              `⚠️ 수동 확인 필요: 거래 #${transaction.id} (12회 재시도 실패)`,
            );
          } else {
            await conn.query(
              "UPDATE deposit_transactions SET retry_count = ? WHERE id = ?",
              [newRetryCount, transaction.id],
            );
            console.log(
              `🔄 재시도 증가: 거래 #${transaction.id} (${newRetryCount}/12)`,
            );
          }

          await conn.commit();
        }
      } catch (error) {
        await conn.rollback();
        console.error(`❌ 거래 #${transaction.id} 처리 실패:`, error.message);
      }
    }

    console.log(`[입금 자동 확인] 완료\n`);
  } catch (err) {
    console.error("Error in auto-check cron:", err);
  } finally {
    conn.release();
  }
});

console.log("✅ 팝빌 Cron 작업 시작: 10분마다 입금 자동 확인");

module.exports = router;
