// routes/appraisal.js
const express = require("express");
const router = express.Router();
const pool = require("../utils/DB"); // DB 연결 풀
const { v4: uuidv4 } = require("uuid"); // ID 생성을 위해

// 미들웨어: 인증 확인 (예시)
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.status(401).json({
      success: false,
      message: "인증되지 않은 사용자입니다.",
      code: "UNAUTHORIZED",
    });
  }
};

// 미들웨어: 관리자 확인 (예시)
const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.id === "admin") {
    next();
  } else {
    res.status(403).json({
      success: false,
      message: "접근 권한이 없습니다.",
      code: "FORBIDDEN",
    });
  }
};

// 3.1.1 감정 신청
router.post("/request", isAuthenticated, async (req, res) => {
  const {
    appraisal_type,
    brand,
    model_name,
    category,
    remarks,
    payment_info,
    product_link,
    platform, // for quicklink
    images,
    purchase_year,
    components_included, // for online_photo
    delivery_info_for_offline, // for offline_physical
  } = req.body;
  const user_id = req.session.user.id;
  const appraisalId = uuidv4();

  // --- 필수 필드 유효성 검사 ---
  if (!appraisal_type || !brand || !model_name || !category) {
    return res.status(400).json({
      success: false,
      message:
        "필수 정보(감정 유형, 브랜드, 모델명, 카테고리)가 누락되었습니다.",
      code: "INVALID_INPUT",
    });
  }
  if (appraisal_type === "quicklink" && !product_link) {
    return res.status(400).json({
      success: false,
      message: "퀵링크 감정 시 상품 링크는 필수입니다.",
      code: "INVALID_INPUT",
    });
  }
  if (appraisal_type === "online_photo" && (!images || images.length === 0)) {
    return res.status(400).json({
      success: false,
      message: "온라인 사진 감정 시 이미지는 최소 1개 이상 필요합니다.",
      code: "INVALID_INPUT",
    });
  }
  if (appraisal_type === "offline_physical" && !delivery_info_for_offline) {
    return res.status(400).json({
      success: false,
      message: "오프라인 실물 감정 시 반송 정보는 필수입니다.",
      code: "INVALID_INPUT",
    });
  }
  // --- 유효성 검사 끝 ---

  let conn;
  try {
    conn = await pool.getConnection();
    const sql = `
      INSERT INTO appraisals (
        id, user_id, appraisal_type, status, brand, model_name, category, remarks, 
        product_link, platform, images, purchase_year, components_included, 
        delivery_info_for_offline, payment_info, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    // 초기 status는 'pending_review' 또는 결제 연동 후 'pending_payment'
    const initialStatus = payment_info ? "pending_review" : "pending_payment";

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

    res.status(201).json({
      success: true,
      message: "감정 신청이 접수되었습니다.",
      appraisal: {
        id: appraisalId,
        status: initialStatus,
        appraisal_type: appraisal_type,
      },
    });
  } catch (error) {
    console.error("감정 신청 처리 중 오류:", error);
    res.status(500).json({
      success: false,
      message: "감정 신청 처리 중 오류가 발생했습니다.",
      code: "SERVER_ERROR",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 3.1.2 사용자의 감정 신청 목록 조회
router.get("/", isAuthenticated, async (req, res) => {
  const user_id = req.session.user.id;
  const { status: queryStatus, page = 1, limit = 10 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let conn;
  try {
    conn = await pool.getConnection();
    let sql = `
      SELECT id, brand, model_name, appraisal_type, status, result, created_at, 
             JSON_UNQUOTE(JSON_EXTRACT(images, '$[0]')) as representative_image 
      FROM appraisals 
      WHERE user_id = ?
    `;
    const params = [user_id];

    if (queryStatus) {
      sql += " AND status = ?";
      params.push(queryStatus);
    }
    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(parseInt(limit), offset);

    const [appraisals] = await conn.query(sql, params);

    // 전체 카운트 (페이지네이션용)
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
    console.error("사용자 감정 목록 조회 중 오류:", error);
    res.status(500).json({
      success: false,
      message: "감정 목록 조회 중 오류가 발생했습니다.",
      code: "SERVER_ERROR",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 3.1.3 특정 감정 신청 상세 조회
router.get("/:appraisalId", isAuthenticated, async (req, res) => {
  const { appraisalId } = req.params;
  const user_id = req.session.user.id;

  let conn;
  try {
    conn = await pool.getConnection();
    // 사용자가 본인의 감정 건만 조회하도록 user_id 조건 추가 (관리자는 모든 건 조회 가능하도록 별도 로직 필요)
    const [rows] = await conn.query(
      `SELECT a.*, c.certificate_number, c.status as certificate_status, c.type as certificate_type 
         FROM appraisals a
         LEFT JOIN certificates c ON a.id = c.appraisal_id
         WHERE a.id = ? AND a.user_id = ?`, // 또는 관리자 예외 처리: req.session.user.role === 'admin' ? '' : 'AND a.user_id = ?'
      [appraisalId, user_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "감정 정보를 찾을 수 없거나 접근 권한이 없습니다.",
        code: "NOT_FOUND",
      });
    }
    const appraisal = rows[0];
    // JSON 필드 파싱
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
    console.error("감정 상세 조회 중 오류:", error);
    res.status(500).json({
      success: false,
      message: "감정 상세 조회 중 오류가 발생했습니다.",
      code: "SERVER_ERROR",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 3.1.4 (관리자용) 감정 결과 및 상태 업데이트
router.put(
  "/:appraisalId/result",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    const { appraisalId } = req.params;
    const { status, result, result_notes, appraiser_id } = req.body;

    if (!status || (status === "completed" && (!result || !result_notes))) {
      return res.status(400).json({
        success: false,
        message: "필수 정보(상태, 또는 완료 시 결과 및 노트)가 누락되었습니다.",
        code: "INVALID_INPUT",
      });
    }

    let conn;
    try {
      conn = await pool.getConnection();
      const [appraisalCheck] = await conn.query(
        "SELECT id FROM appraisals WHERE id = ?",
        [appraisalId]
      );
      if (appraisalCheck.length === 0) {
        return res.status(404).json({
          success: false,
          message: "해당 감정 ID를 찾을 수 없습니다.",
          code: "NOT_FOUND",
        });
      }

      let appraisedAtField = "";
      const updateParams = [status];

      if (status === "completed") {
        appraisedAtField = ", appraised_at = NOW()";
        updateParams.push(result, result_notes);
      } else {
        // 'completed'가 아닐 때는 result와 result_notes를 null 또는 현재 값으로 유지하거나, 업데이트하지 않도록 쿼리 조정
        // 여기서는 명시적으로 업데이트 하지 않음. 필요시 로직 추가.
        // result, result_notes 필드를 SET 절에서 제외하거나, 특정 조건에서만 업데이트
      }

      updateParams.push(appraiser_id || req.session.user.id); // 감정사 ID (업데이트 주체)
      updateParams.push(appraisalId);

      const sql = `
      UPDATE appraisals 
      SET status = ? 
      ${status === "completed" ? ", result = ?, result_notes = ?" : ""}
      ${appraisedAtField}
      , appraiser_id = ?, updated_at = NOW()
      WHERE id = ?
    `;

      await conn.query(sql, updateParams);

      const [updatedAppraisal] = await conn.query(
        "SELECT id, status, result FROM appraisals WHERE id = ?",
        [appraisalId]
      );

      res.json({
        success: true,
        message: "감정 결과가 업데이트되었습니다.",
        appraisal: updatedAppraisal[0],
      });
    } catch (error) {
      console.error("감정 결과 업데이트 중 오류:", error);
      res.status(500).json({
        success: false,
        message: "감정 결과 업데이트 중 오류가 발생했습니다.",
        code: "SERVER_ERROR",
      });
    } finally {
      if (conn) conn.release();
    }
  }
);

// 3.1.5 (선택) 감정 통계
router.get("/stats", async (req, res) => {
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
    console.error("감정 통계 조회 중 오류:", error);
    res.status(500).json({
      success: false,
      message: "감정 통계 조회 중 오류가 발생했습니다.",
      code: "SERVER_ERROR",
    });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
