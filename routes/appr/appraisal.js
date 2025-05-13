// routes/appr/appraisal.js
const express = require("express");
const router = express.Router();
const pool = require("../../utils/DB");
const { v4: uuidv4 } = require("uuid");
const { isAuthenticated, isAdmin } = require("../../utils/middleware");

// GET /api/appr/appraisals/my (마이페이지 종합 정보)
router.get("/my", isAuthenticated, async (req, res) => {
  const user_id = req.session.user.id;
  const { page = 1, limit = 5 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  let conn;
  try {
    conn = await pool.getConnection();
    const [userRows] = await conn.query(
      "SELECT id, email, name, phone FROM users WHERE id = ?",
      [user_id]
    );
    if (userRows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "사용자 정보를 찾을 수 없습니다." });
    const userInfo = userRows[0];

    const [membershipRows] = await conn.query(
      "SELECT tier, quick_link_allowance, quick_link_monthly_limit, subscription_expires_at, offline_appraisal_fee_override FROM user_memberships WHERE user_id = ?",
      [user_id]
    );
    let membershipInfo = {
      tier: "일반회원",
      quick_link_credits_remaining_this_month: 0,
      quick_link_credits_monthly_limit: 0,
      offline_appraisal_fee: 38000,
    };
    if (membershipRows.length > 0) {
      const currentMembership = membershipRows[0];
      membershipInfo.tier = currentMembership.tier;
      membershipInfo.quick_link_credits_remaining_this_month =
        currentMembership.quick_link_allowance;
      membershipInfo.quick_link_credits_monthly_limit =
        currentMembership.quick_link_monthly_limit;
      membershipInfo.offline_appraisal_fee =
        currentMembership.offline_appraisal_fee_override ||
        (currentMembership.tier === "까사트레이드 회원"
          ? 12000
          : currentMembership.tier === "제휴사 회원"
          ? 20000
          : 38000);
      if (
        currentMembership.tier === "일반회원" &&
        currentMembership.subscription_expires_at
      ) {
        if (new Date(currentMembership.subscription_expires_at) < new Date()) {
          // 구독 만료 체크
          membershipInfo.quick_link_credits_remaining_this_month = 0;
          membershipInfo.quick_link_credits_monthly_limit = 0; // 만료 시 0으로
        } else {
          // 구독 유효
          membershipInfo.quick_link_credits_monthly_limit = 10; // 일반회원 구독 시 월 10회
        }
      }
    }

    const [appraisalItems] = await conn.query(
      `SELECT id, brand, model_name, status, result, created_at, JSON_UNQUOTE(JSON_EXTRACT(images, '$[0]')) as representative_image FROM appraisals WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [user_id, parseInt(limit), offset]
    );
    const [totalAppraisalsResult] = await conn.query(
      "SELECT COUNT(*) as totalItems FROM appraisals WHERE user_id = ?",
      [user_id]
    );
    const totalAppraisalItems = totalAppraisalsResult[0].totalItems;
    const totalAppraisalPages = Math.ceil(
      totalAppraisalItems / parseInt(limit)
    );

    res.json({
      success: true,
      user_info: userInfo,
      membership_info: membershipInfo,
      recent_appraisals: {
        appraisals: appraisalItems,
        pagination: {
          currentPage: parseInt(page),
          totalPages: totalAppraisalPages,
          totalItems: totalAppraisalItems,
          limit: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("마이페이지 정보 조회 오류:", error);
    res.status(500).json({ success: false, message: "정보 조회 중 오류 발생" });
  } finally {
    if (conn) conn.release();
  }
});

// POST /api/appr/appraisals/request (감정 신청)
router.post("/request", isAuthenticated, async (req, res) => {
  const user_id = req.session.user.id;
  const appraisalId = uuidv4();
  const {
    appraisal_type,
    brand,
    model_name,
    category,
    payment_info,
    product_link,
    images,
    purchase_year,
    components_included,
    delivery_info_for_offline,
    remarks,
    platform,
  } = req.body;

  if (!appraisal_type || !brand || !model_name || !category)
    return res.status(400).json({
      success: false,
      message: "필수 정보(유형,브랜드,모델명,카테고리) 누락",
    });
  if (appraisal_type === "quicklink" && !product_link)
    return res
      .status(400)
      .json({ success: false, message: "퀵링크 감정 시 상품 링크 필수" });
  if (appraisal_type === "online_photo" && (!images || images.length === 0))
    return res.status(400).json({
      success: false,
      message: "온라인 사진 감정 시 이미지 최소 1개 필수",
    });
  if (appraisal_type === "offline_physical" && !delivery_info_for_offline)
    return res
      .status(400)
      .json({ success: false, message: "오프라인 감정 시 반송 정보 필수" });

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    if (appraisal_type === "quicklink") {
      const [membershipRows] = await conn.query(
        "SELECT quick_link_allowance FROM user_memberships WHERE user_id = ?",
        [user_id]
      );
      if (
        membershipRows.length === 0 ||
        membershipRows[0].quick_link_allowance <= 0
      ) {
        await conn.rollback();
        return res.status(402).json({
          success: false,
          message:
            "퀵링크 사용 횟수가 부족합니다. 구독 또는 크레딧 구매가 필요합니다.",
        });
      }
    }
    const initialStatus = payment_info ? "pending_review" : "pending_payment";
    const sql = `INSERT INTO appraisals (id, user_id, appraisal_type, status, brand, model_name, category, remarks, product_link, platform, images, purchase_year, components_included, delivery_info_for_offline, payment_info, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`;
    await conn.query(sql, [
      appraisalId,
      user_id,
      appraisal_type,
      initialStatus,
      brand,
      model_name,
      category,
      remarks || null,
      product_link || null,
      platform || null,
      images ? JSON.stringify(images) : null,
      purchase_year || null,
      components_included ? JSON.stringify(components_included) : null,
      delivery_info_for_offline
        ? JSON.stringify(delivery_info_for_offline)
        : null,
      payment_info ? JSON.stringify(payment_info) : null,
    ]);
    await conn.commit();
    res.status(201).json({
      success: true,
      message: "감정 신청 접수 완료",
      appraisal: { id: appraisalId, status: initialStatus, appraisal_type },
    });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("감정 신청 오류:", error);
    res
      .status(500)
      .json({ success: false, message: "감정 신청 처리 중 오류 발생" });
  } finally {
    if (conn) conn.release();
  }
});

// GET /api/appr/appraisals (사용자 감정 목록)
router.get("/", isAuthenticated, async (req, res) => {
  const user_id = req.session.user.id;
  const { status: queryStatus, page = 1, limit = 10 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  let conn;
  try {
    conn = await pool.getConnection();
    let sql = `SELECT id, brand, model_name, appraisal_type, status, result, created_at, JSON_UNQUOTE(JSON_EXTRACT(images, '$[0]')) as representative_image FROM appraisals WHERE user_id = ?`;
    const params = [user_id];
    if (queryStatus) {
      sql += " AND status = ?";
      params.push(queryStatus);
    }
    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(parseInt(limit), offset);
    const [appraisals] = await conn.query(sql, params);

    let countSql =
      "SELECT COUNT(*) as totalItems FROM appraisals WHERE user_id = ?";
    const countParams = [user_id];
    if (queryStatus) {
      countSql += " AND status = ?";
      countParams.push(queryStatus);
    }
    const [totalResult] = await conn.query(countSql, countParams);
    const totalItems = totalResult[0].totalItems;
    const totalPages = Math.ceil(totalItems / parseInt(limit));
    res.json({
      success: true,
      appraisals,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems,
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("사용자 감정 목록 조회 오류:", error);
    res
      .status(500)
      .json({ success: false, message: "감정 목록 조회 중 오류 발생" });
  } finally {
    if (conn) conn.release();
  }
});

// GET /api/appr/appraisals/:appraisalId (특정 감정 상세)
router.get("/:appraisalId", isAuthenticated, async (req, res) => {
  const { appraisalId } = req.params;
  const user_id = req.session.user.id; // 현재 로그인한 사용자
  const isAdminUser = req.session.user.id === "admin"; // 관리자 여부 확인

  let conn;
  try {
    conn = await pool.getConnection();
    let sql = `SELECT a.*, c.certificate_number, c.status as certificate_status, c.type as certificate_type 
                   FROM appraisals a LEFT JOIN certificates c ON a.id = c.appraisal_id 
                   WHERE a.id = ?`;
    const params = [appraisalId];

    if (!isAdminUser) {
      // 관리자가 아니면 본인 감정 건만 조회
      sql += " AND a.user_id = ?";
      params.push(user_id);
    }

    const [rows] = await conn.query(sql, params);
    if (rows.length === 0)
      return res.status(404).json({
        success: false,
        message: "감정 정보를 찾을 수 없거나 접근 권한이 없습니다.",
      });
    const appraisal = rows[0];
    appraisal.components_included = appraisal.components_included
      ? JSON.parse(appraisal.components_included)
      : null;
    appraisal.images = appraisal.images ? JSON.parse(appraisal.images) : null;
    appraisal.delivery_info_for_offline = appraisal.delivery_info_for_offline
      ? JSON.parse(appraisal.delivery_info_for_offline)
      : null;
    appraisal.payment_info = appraisal.payment_info
      ? JSON.parse(appraisal.payment_info)
      : null;

    const responseAppraisal = { ...appraisal };
    if (appraisal.certificate_number) {
      responseAppraisal.certificate = {
        certificate_number: appraisal.certificate_number,
        status: appraisal.certificate_status,
        type: appraisal.certificate_type,
      };
    }
    delete responseAppraisal.certificate_number;
    delete responseAppraisal.certificate_status;
    delete responseAppraisal.certificate_type;
    res.json({ success: true, appraisal: responseAppraisal });
  } catch (error) {
    console.error("감정 상세 조회 오류:", error);
    res
      .status(500)
      .json({ success: false, message: "감정 상세 조회 중 오류 발생" });
  } finally {
    if (conn) conn.release();
  }
});

// GET /api/appr/appraisals/stats/all (감정 통계)
router.get("/stats/all", async (req, res) => {
  // 인증 불필요
  let conn;
  try {
    conn = await pool.getConnection();
    const [totalResult] = await conn.query(
      "SELECT COUNT(*) as total_appraisals FROM appraisals"
    );
    const [todayResult] = await conn.query(
      "SELECT COUNT(*) as today_appraisals FROM appraisals WHERE DATE(created_at) = CURDATE()"
    );
    res.json({
      success: true,
      stats: {
        total_appraisals: totalResult[0].total_appraisals,
        today_appraisals: todayResult[0].today_appraisals,
      },
    });
  } catch (error) {
    console.error("감정 통계 조회 오류:", error);
    res
      .status(500)
      .json({ success: false, message: "감정 통계 조회 중 오류 발생" });
  } finally {
    if (conn) conn.release();
  }
});

// routes/appr/appraisal.js 에 추가
router.post("/deduct-credit", isAuthenticated, async (req, res) => {
  const { appraisalId } = req.body;
  const user_id = req.session.user.id;

  if (!appraisalId) {
    return res
      .status(400)
      .json({ success: false, message: "감정 ID가 필요합니다." });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // 1. 해당 감정건이 퀵링크이고, 사용자의 감정건인지 확인 (선택적이지만 권장)
    const [appraisalRows] = await conn.query(
      "SELECT appraisal_type FROM appraisals WHERE id = ? AND user_id = ?",
      [appraisalId, user_id]
    );
    if (
      appraisalRows.length === 0 ||
      appraisalRows[0].appraisal_type !== "quicklink"
    ) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: "유효하지 않은 감정건이거나 퀵링크 감정이 아닙니다.",
      });
    }

    // 2. 사용자 멤버십에서 크레딧 차감
    const [membershipRows] = await conn.query(
      "SELECT quick_link_allowance FROM user_memberships WHERE user_id = ?",
      [user_id]
    );

    if (
      membershipRows.length > 0 &&
      membershipRows[0].quick_link_allowance > 0
    ) {
      await conn.query(
        "UPDATE user_memberships SET quick_link_allowance = quick_link_allowance - 1, updated_at = NOW() WHERE user_id = ?",
        [user_id]
      );
      // 3. credit_transactions에 기록
      await conn.query(
        "INSERT INTO credit_transactions (id, user_id, transaction_type, amount, balance_after_transaction, description, related_appraisal_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())",
        [
          uuidv4(),
          user_id,
          "usage_quicklink_free",
          -1,
          membershipRows[0].quick_link_allowance - 1,
          `퀵링크 감정 크레딧 사용 (ID: ${appraisalId})`,
          appraisalId,
        ]
      );
      await conn.commit();
      res.json({
        success: true,
        message: "크레딧이 차감되었습니다.",
        remainingCredits: membershipRows[0].quick_link_allowance - 1,
      });
    } else {
      await conn.rollback();
      // 이 경우는 quick-result 페이지가 보이기 전에 이미 차감되었어야 하므로, 이론상 발생하기 어려움.
      res.status(402).json({
        success: false,
        message: "사용 가능한 퀵링크 크레딧이 없습니다.",
      });
    }
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("크레딧 차감 중 오류:", error);
    res
      .status(500)
      .json({ success: false, message: "크레딧 차감 중 서버 오류 발생" });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
