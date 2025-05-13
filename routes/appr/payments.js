// routes/appr/payment.js
const express = require("express");
const router = express.Router();
const pool = require("../../utils/DB");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const crypto = require("crypto");
const { isAuthenticated } = require("./middleware"); // 현재 폴더의 middleware.js 사용

const NICEPAY_CLIENT_KEY = process.env.NICEPAY_CLIENT_KEY;
const NICEPAY_SECRET_KEY = process.env.NICEPAY_SECRET_KEY;
const NICEPAY_API_DOMAIN =
  process.env.NODE_ENV === "production"
    ? "https://api.nicepay.co.kr"
    : "https://sandbox-api.nicepay.co.kr";
const NICEPAY_APPROVAL_API_URL = `${NICEPAY_API_DOMAIN}/v1/payments/`;

// 나이스페이 결제창 인증 후 POST로 호출될 "서버"의 ReturnURL 엔드포인트
const NICEPAY_SERVER_AUTH_RETURN_URL = `${process.env.FRONTEND_URL}/api/appr/payments/nicepay/auth-return`; // server.js에 마운트된 경로 기준
// 서버에서 인증 처리 후, 사용자를 리다이렉트 시킬 프론트엔드 "페이지"
const NICEPAY_FRONTEND_PROCESSING_URL = `${process.env.FRONTEND_URL}/appr/payment-processing.html`;

const basicAuthHeaderValue = `Basic ${Buffer.from(
  `${NICEPAY_CLIENT_KEY}:${NICEPAY_SECRET_KEY}`
).toString("base64")}`;

function generateNicePaySignature(params, secretKey, type) {
  let stringToHash = "";
  if (type === "authResponse") {
    stringToHash = `${params.authToken}${params.clientId}${params.amount}${secretKey}`;
  } else if (type === "approvalRequest" || type === "approvalResponse") {
    stringToHash = `${params.tid}${params.amount}${params.ediDate}${secretKey}`;
  } else {
    console.error("Invalid signature type for NicePay:", type);
    return null; // 오류 발생 시 null 반환
  }
  return crypto.createHash("sha256").update(stringToHash).digest("hex");
}

// API: 프론트엔드가 NicePay JS SDK 호출 전에 주문 정보 생성 및 SDK 파라미터 반환
router.post("/nicepay/prepare-payment", isAuthenticated, async (req, res) => {
  const { product_type, product_name, amount } = req.body;
  const user = req.session.user;

  if (!product_type || !product_name || !amount || Number(amount) <= 0) {
    return res.status(400).json({
      success: false,
      message: "상품 정보 또는 금액이 올바르지 않습니다.",
    });
  }
  const orderId = `CAS_PORD_${uuidv4()
    .slice(0, 10)
    .toUpperCase()}_${Date.now()}`;
  let conn;
  try {
    conn = await pool.getConnection();
    const paymentRecordId = uuidv4();
    await conn.query(
      "INSERT INTO payments (id, user_id, order_id, product_name, amount, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', NOW(), NOW())",
      [paymentRecordId, user.id, orderId, product_name, Number(amount)]
    );
    const paramsForNicePaySDK = {
      clientId: NICEPAY_CLIENT_KEY,
      method: "card",
      orderId: orderId,
      amount: Number(amount),
      goodsName: product_name,
      returnUrl: NICEPAY_SERVER_AUTH_RETURN_URL, // **서버의 인증 결과 처리 URL로 변경**
      mallUserId: user.id,
      buyerName: user.name || "구매자",
      buyerTel: user.phone || "01000000000",
      buyerEmail: user.email,
    };
    res.json({
      success: true,
      message: "결제 준비 완료.",
      paramsForNicePaySDK,
    });
  } catch (error) {
    console.error("결제 준비 중 오류:", error);
    res.status(500).json({
      success: false,
      message: "결제 준비 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// API: 나이스페이 결제창 인증 결과 처리 (나이스페이에서 POST로 호출하는 ReturnURL)
router.post("/nicepay/auth-return", async (req, res) => {
  const {
    authResultCode,
    authResultMsg,
    tid,
    clientId,
    orderId,
    amount,
    mallReserved,
    authToken,
    signature,
  } = req.body;
  console.log(
    `[${orderId}] 서버 ReturnURL (/nicepay/auth-return) 호출됨. 인증 결과 코드: ${authResultCode}`,
    req.body
  );

  // 1. 인증 응답 Signature 검증
  const paramsForAuthSignature = { authToken, clientId, amount };
  const expectedAuthSignature = generateNicePaySignature(
    paramsForAuthSignature,
    NICEPAY_SECRET_KEY,
    "authResponse"
  );

  if (
    !signature ||
    !expectedAuthSignature ||
    expectedAuthSignature.toLowerCase() !== signature.toLowerCase()
  ) {
    console.error(
      `[${orderId}] 인증 응답 Signature 검증 실패. Client: ${signature}, Server Expected: ${expectedAuthSignature}`
    );
    // 사용자에게 보여줄 에러 페이지로 리다이렉트 또는 메시지 전달
    return res.redirect(
      `${NICEPAY_FRONTEND_PROCESSING_URL}?orderId=${orderId}&status=auth_signature_error&msg=${encodeURIComponent(
        "결제 정보 인증에 실패했습니다. (서명 오류)"
      )}`
    );
  }
  console.log(`[${orderId}] 인증 응답 Signature 검증 성공.`);

  if (authResultCode === "0000") {
    // 인증 성공: 필요한 정보를 세션에 저장하고 프론트엔드 처리 페이지로 리다이렉트
    req.session.paymentAuthInfo = req.session.paymentAuthInfo || {};
    req.session.paymentAuthInfo[orderId] = { tid, amount, authToken, clientId }; // mallReserved도 필요시 저장
    console.log(
      `[${orderId}] 인증 성공 정보 세션 저장 완료. 프론트엔드 처리 페이지로 리다이렉트.`
    );
    return res.redirect(
      `${NICEPAY_FRONTEND_PROCESSING_URL}?orderId=${orderId}&status=auth_success`
    );
  } else {
    // 인증 실패
    console.error(
      `[${orderId}] 나이스페이 인증 실패: ${authResultCode} - ${authResultMsg}`
    );
    // 실패 정보를 포함하여 프론트엔드 처리 페이지로 리다이렉트
    return res.redirect(
      `${NICEPAY_FRONTEND_PROCESSING_URL}?orderId=${orderId}&status=auth_fail&code=${authResultCode}&msg=${encodeURIComponent(
        authResultMsg
      )}`
    );
  }
});

// API: 프론트엔드 처리 페이지에서 세션에 저장된 인증 정보 가져오기
router.get("/nicepay/get-auth-info/:orderId", isAuthenticated, (req, res) => {
  const { orderId } = req.params;
  if (req.session.paymentAuthInfo && req.session.paymentAuthInfo[orderId]) {
    const authInfo = req.session.paymentAuthInfo[orderId];
    // 사용 후 바로 삭제하지 않고, request-approval에서 성공 후 삭제하는 것이 더 안전할 수 있음
    // delete req.session.paymentAuthInfo[orderId];
    res.json({ success: true, authInfo });
  } else {
    res
      .status(404)
      .json({
        success: false,
        message: "저장된 인증 정보를 찾을 수 없거나 만료되었습니다.",
      });
  }
});

// API: 프론트엔드에서 최종 승인 요청 (세션의 정보 + 클라이언트가 전달한 정보 사용)
router.post("/nicepay/request-approval", isAuthenticated, async (req, res) => {
  const { orderId } = req.body; // 프론트에서 orderId만 받아도 됨 (세션에서 나머지 정보 가져오므로)
  const user_id = req.session.user.id;

  if (!orderId) {
    return res
      .status(400)
      .json({ success: false, message: "주문번호(orderId)가 필요합니다." });
  }

  // 세션에서 해당 orderId의 인증 정보 가져오기
  if (!req.session.paymentAuthInfo || !req.session.paymentAuthInfo[orderId]) {
    return res.status(400).json({
      success: false,
      message: "승인에 필요한 인증 정보를 찾을 수 없습니다. 다시 시도해주세요.",
    });
  }
  const {
    tid,
    amount: authAmount,
    authToken,
    clientId: authClientId,
  } = req.session.paymentAuthInfo[orderId];
  const amount = Number(authAmount); // 세션의 금액 사용

  // 사용 후 세션 정보 삭제 (중복 승인 방지)
  delete req.session.paymentAuthInfo[orderId];

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [paymentRows] = await conn.query(
      "SELECT id, product_name, amount, status FROM payments WHERE order_id = ? AND user_id = ? FOR UPDATE",
      [orderId, user_id]
    );
    if (paymentRows.length === 0) {
      await conn.rollback();
      return res
        .status(404)
        .json({ success: false, message: "주문 정보를 찾을 수 없습니다." });
    }
    const payment = paymentRows[0];
    if (payment.status !== "pending") {
      await conn.rollback();
      if (payment.status === "completed")
        return res.json({
          success: true,
          message: "이미 처리된 결제입니다.",
          paymentStatus: "completed",
          orderId: orderId,
        });
      return res.status(400).json({
        success: false,
        message: "이미 처리되었거나 유효하지 않은 주문입니다.",
      });
    }
    if (Number(payment.amount) !== amount) {
      // DB금액과 세션금액(인증시금액) 비교
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: "결제 요청 금액이 주문 금액과 일치하지 않습니다.",
      });
    }

    const ediDateForApproval = new Date()
      .toISOString()
      .replace(/[-:T.]/g, "")
      .slice(0, 14);
    const paramsForApprovalSignature = {
      tid,
      amount,
      ediDate: ediDateForApproval,
    };
    const signDataForApproval = generateNicePaySignature(
      paramsForApprovalSignature,
      NICEPAY_SECRET_KEY,
      "approvalRequest"
    );

    const approvalApiPayload = {
      amount,
      ediDate: ediDateForApproval,
      signData: signDataForApproval,
    };

    console.log(`[${orderId}] 최종 승인 API 요청 Payload:`, approvalApiPayload);
    const approvalResponse = await axios.post(
      `${NICEPAY_APPROVAL_API_URL}${tid}`,
      approvalApiPayload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: basicAuthHeaderValue,
        },
      }
    );
    const approvalData = approvalResponse.data;
    console.log(`[${orderId}] 최종 승인 API 응답:`, approvalData);

    const paramsForApprovalResponseSignature = {
      tid: approvalData.tid,
      amount: approvalData.amount,
      ediDate: approvalData.ediDate.replace(/[-:T.+]/g, "").slice(0, 14),
    };
    const expectedApprovalResponseSignature = generateNicePaySignature(
      paramsForApprovalResponseSignature,
      NICEPAY_SECRET_KEY,
      "approvalResponse"
    );

    if (
      expectedApprovalResponseSignature.toLowerCase() !==
      approvalData.signature.toLowerCase()
    ) {
      console.error(
        `[${orderId}] 최종 승인 응답 Signature 검증 실패. API Resp: ${approvalData.signature}, Server: ${expectedApprovalResponseSignature}`
      );
      await recordPaymentFailure(
        pool,
        user_id,
        orderId,
        amount,
        "approval_signature_mismatch",
        tid,
        approvalData,
        "승인 응답 서명 검증 실패"
      );
      await conn.rollback();
      return res.status(500).json({
        success: false,
        message: "승인 결과 검증에 실패했습니다. 관리자에게 문의하세요.",
      });
    }
    console.log(`[${orderId}] 최종 승인 응답 Signature 검증 성공.`);

    if (approvalData.resultCode === "0000") {
      await conn.query(
        "UPDATE payments SET status = 'completed', payment_gateway_transaction_id = ?, payment_method = ?, paid_at = STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ'), raw_response_data = ?, updated_at = NOW() WHERE id = ?",
        [
          approvalData.tid,
          approvalData.payMethod,
          approvalData.paidAt,
          JSON.stringify(approvalData),
          payment.id,
        ]
      );
      if (payment.product_name.includes("퀵링크 구독")) {
        await activateSubscription(
          conn,
          user_id,
          payment.id,
          payment.product_name
        );
      }
      await conn.commit();
      res.json({
        success: true,
        message: "결제가 성공적으로 완료되었습니다.",
        paymentResult: approvalData,
        orderId: orderId,
      });
    } else {
      await recordPaymentFailure(
        pool,
        user_id,
        orderId,
        amount,
        "approval_api_failed",
        tid,
        approvalData,
        `승인실패(${approvalData.resultCode}): ${approvalData.resultMsg}`
      );
      await conn.rollback();
      res.status(400).json({
        success: false,
        message: `결제 실패: ${approvalData.resultMsg}`,
        paymentResult: approvalData,
        orderId: orderId,
      });
    }
  } catch (error) {
    if (conn) await conn.rollback();
    console.error(
      `[${orderId}] NicePay 승인 요청/처리 중 오류:`,
      error.response ? error.response.data : error.message
    );
    await recordPaymentFailure(
      pool,
      user_id,
      orderId,
      amount,
      "server_error",
      tid,
      error.response ? error.response.data : { message: error.message },
      "승인처리 서버오류"
    );
    res.status(500).json({
      success: false,
      message: "결제 승인 처리 중 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 가상계좌 입금 통보 처리 (Webhook)
router.post("/nicepay/vbank-noti", async (req, res) => {
  const { moid, tid, Amt, Signature } = req.body;
  console.log("가상계좌 입금 통보 수신:", req.body);
  // Webhook Signature 검증 로직 (나이스페이 매뉴얼 확인 후 구현)

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [paymentRows] = await conn.query(
      "SELECT id, user_id, product_name, amount, status FROM payments WHERE order_id = ? AND status = 'pending' FOR UPDATE",
      [moid]
    );
    if (paymentRows.length === 0) {
      await conn.rollback();
      console.log(`VBANK NOTI: 주문번호 ${moid}가 입금대기 상태 아님.`);
      return res.send("OK");
    }
    const payment = paymentRows[0];
    if (Number(payment.amount) !== Number(Amt)) {
      await conn.rollback();
      console.error(
        `VBANK NOTI: 주문번호 ${moid} 금액 불일치. DB: ${payment.amount}, 통보: ${Amt}`
      );
      return res.send("FAIL");
    }
    await conn.query(
      "UPDATE payments SET status = 'completed', payment_gateway_transaction_id = ?, payment_method = 'VBANK', paid_at = NOW(), raw_response_data = JSON_MERGE_PATCH(COALESCE(raw_response_data, '{}'), ?), updated_at = NOW() WHERE id = ?",
      [tid, JSON.stringify(req.body), payment.id]
    );
    if (payment.product_name.includes("퀵링크 구독")) {
      await activateSubscription(
        conn,
        payment.user_id,
        payment.id,
        payment.product_name
      );
    }
    await conn.commit();
    console.log(`VBANK NOTI: 주문번호 ${moid} 입금 처리 완료.`);
    res.send("OK");
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("VBANK NOTI 처리 중 오류:", error);
    res.send("FAIL");
  } finally {
    if (conn) conn.release();
  }
});

async function recordPaymentFailure(
  pool,
  userId,
  orderId,
  amount,
  status,
  tid,
  responseData,
  failureReason
) {
  let conn;
  try {
    conn = await pool.getConnection();
    const failureDetails = { failureReason, apiResponse: responseData };
    const [existingPayments] = await conn.query(
      "SELECT id FROM payments WHERE order_id = ? AND user_id = ?",
      [orderId, userId]
    );
    if (existingPayments.length > 0) {
      await conn.query(
        "UPDATE payments SET status = ?, payment_gateway_transaction_id = ?, raw_response_data = JSON_MERGE_PATCH(COALESCE(raw_response_data, '{}'), ?), updated_at = NOW() WHERE order_id = ?",
        [status, tid || null, JSON.stringify(failureDetails), orderId]
      );
    } else {
      // prepare-payment에서 주문이 생성되지 않았거나, orderId가 다른 경우.
      console.warn(`결제 실패 기록 중 주문 ID ${orderId}를 찾을 수 없습니다.`);
      // 필요시 새 레코드 생성 로직
      // const paymentRecordId = uuidv4();
      // await conn.query( /* INSERT ... */);
    }
  } catch (dbError) {
    console.error(
      `결제 실패(${status}) 이력 기록 중 DB 오류 (주문 ID: ${orderId}):`,
      dbError
    );
  } finally {
    if (conn) conn.release();
  }
}

async function activateSubscription(conn, userId, paymentId, productName) {
  const [membershipRows] = await conn.query(
    "SELECT subscription_expires_at, quick_link_allowance FROM user_memberships WHERE user_id = ?",
    [userId]
  );
  let currentExpiresAt = null;
  if (membershipRows.length > 0 && membershipRows[0].subscription_expires_at) {
    currentExpiresAt = new Date(membershipRows[0].subscription_expires_at);
  }
  let newExpiresAt;
  if (currentExpiresAt && currentExpiresAt > new Date()) {
    newExpiresAt = new Date(
      currentExpiresAt.setDate(currentExpiresAt.getDate() + 30)
    );
  } else {
    newExpiresAt = new Date(new Date().setDate(new Date().getDate() + 30));
  }
  const quickLinkAllowanceToAdd = 10;

  if (membershipRows.length > 0) {
    await conn.query(
      "UPDATE user_memberships SET tier = '일반회원', quick_link_allowance = quick_link_allowance + ?, quick_link_monthly_limit = ?, subscription_expires_at = ?, quick_link_allowance_type = 'paid_subscription', updated_at = NOW() WHERE user_id = ?",
      [quickLinkAllowanceToAdd, quickLinkAllowanceToAdd, newExpiresAt, userId]
    );
  } else {
    await conn.query(
      "INSERT INTO user_memberships (user_id, tier, quick_link_allowance, quick_link_monthly_limit, subscription_expires_at, quick_link_allowance_type, created_at, updated_at) VALUES (?, '일반회원', ?, ?, ?, 'paid_subscription', NOW(), NOW())",
      [userId, quickLinkAllowanceToAdd, quickLinkAllowanceToAdd, newExpiresAt]
    );
  }
  await conn.query(
    "INSERT INTO credit_transactions (id, user_id, transaction_type, amount, balance_after_transaction, description, related_payment_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())",
    [
      uuidv4(),
      userId,
      "subscription_fee",
      quickLinkAllowanceToAdd,
      (membershipRows[0]?.quick_link_allowance || 0) + quickLinkAllowanceToAdd,
      productName,
      paymentId,
    ]
  );
  console.log(`[${userId}] 구독 활성화 완료: ${productName}`);
}

module.exports = router;
