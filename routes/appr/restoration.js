// routes/appr/restoration.js
const express = require("express");
const router = express.Router();
const pool = require("../../utils/DB");
const { v4: uuidv4 } = require("uuid");
const { isAuthenticated, isAdmin } = require("../../utils/middleware");

// GET /api/appr/restoration/services (복원 서비스 목록 - 인증 불필요)
router.get("/services", async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const [services] = await conn.query(
      "SELECT id, name, description, price, estimated_days, before_image, after_image, is_active FROM restoration_services WHERE is_active = TRUE ORDER BY price ASC"
    );
    res.json({ success: true, services });
  } catch (error) {
    console.error("복원 서비스 목록 조회 오류:", error);
    res
      .status(500)
      .json({ success: false, message: "복원 서비스 목록 조회 중 오류 발생" });
  } finally {
    if (conn) conn.release();
  }
});

// POST /api/appr/restoration/requests (복원 서비스 신청)
router.post("/requests", isAuthenticated, async (req, res) => {
  const { appraisal_id, items, delivery_info, payment_info } = req.body;
  const user_id = req.session.user.id;

  if (
    !appraisal_id ||
    !items ||
    !Array.isArray(items) ||
    items.length === 0 ||
    !delivery_info
  ) {
    return res.status(400).json({
      success: false,
      message: "필수 정보(감정ID, 복원항목, 배송정보) 누락 또는 형식 오류",
    });
  }
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [appraisalRows] = await conn.query(
      "SELECT id FROM appraisals WHERE id = ? AND user_id = ?",
      [appraisal_id, user_id]
    );
    if (appraisalRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({
        success: false,
        message: "유효한 감정 ID를 찾을 수 없거나 접근 권한 없음",
      });
    }

    let total_price = 0;
    let max_estimated_days = 0;
    const processedItems = [];
    for (const item of items) {
      if (!item.service_id || typeof item.price !== "number") {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          message: "각 복원 항목은 service_id와 price 포함 필수",
        });
      }
      const [serviceRows] = await conn.query(
        "SELECT name, price, estimated_days FROM restoration_services WHERE id = ? AND is_active = TRUE",
        [item.service_id]
      );
      if (serviceRows.length === 0) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          message: `서비스 ID '${item.service_id}'를 찾을 수 없거나 비활성`,
        });
      }
      const service = serviceRows[0];
      if (service.price !== item.price) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          message: `서비스 '${service.name}' 가격 불일치 (요청: ${item.price}, 실제: ${service.price})`,
        });
      }
      total_price += service.price;
      if (service.estimated_days > max_estimated_days)
        max_estimated_days = service.estimated_days;
      processedItems.push({
        service_id: item.service_id,
        service_name: service.name,
        price: service.price,
        status: "pending",
      });
    }

    const requestId = uuidv4();
    const estimated_completion_date = new Date();
    estimated_completion_date.setDate(
      estimated_completion_date.getDate() + max_estimated_days
    );
    const initialStatus = payment_info ? "pending" : "pending_payment";

    const sql = `INSERT INTO restoration_requests (id, appraisal_id, user_id, items, status, total_price, delivery_info, payment_info, estimated_completion_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`;
    await conn.query(sql, [
      requestId,
      appraisal_id,
      user_id,
      JSON.stringify(processedItems),
      initialStatus,
      total_price,
      JSON.stringify(delivery_info),
      payment_info ? JSON.stringify(payment_info) : null,
      estimated_completion_date,
    ]);
    await conn.commit();
    res.status(201).json({
      success: true,
      message: "복원 서비스 신청 완료",
      request: {
        id: requestId,
        status: initialStatus,
        total_price,
        estimated_completion_date,
      },
    });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("복원 서비스 신청 오류:", error);
    res
      .status(500)
      .json({ success: false, message: "복원 서비스 신청 중 오류 발생" });
  } finally {
    if (conn) conn.release();
  }
});

// GET /api/appr/restoration/requests (사용자 복원 요청 목록)
router.get("/requests", isAuthenticated, async (req, res) => {
  const user_id = req.session.user.id;
  const { status: queryStatus, page = 1, limit = 10 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  let conn;
  try {
    conn = await pool.getConnection();
    let sql = `SELECT rr.id, rr.status, rr.total_price, rr.estimated_completion_date, rr.created_at, rr.items, a.brand, a.model_name, JSON_UNQUOTE(JSON_EXTRACT(a.images, '$[0]')) as representative_image FROM restoration_requests rr JOIN appraisals a ON rr.appraisal_id = a.id WHERE rr.user_id = ?`;
    const params = [user_id];
    if (queryStatus) {
      sql += " AND rr.status = ?";
      params.push(queryStatus);
    }
    sql += " ORDER BY rr.created_at DESC LIMIT ? OFFSET ?";
    params.push(parseInt(limit), offset);
    const [requestsFromDb] = await conn.query(sql, params);

    const requests = requestsFromDb.map((req) => ({
      id: req.id,
      status: req.status,
      total_price: req.total_price,
      estimated_completion_date: req.estimated_completion_date,
      appraisal: {
        brand: req.brand,
        model_name: req.model_name,
        representative_image: req.representative_image,
      },
      items: req.items ? JSON.parse(req.items) : [],
      created_at: req.created_at,
    }));

    let countSql =
      "SELECT COUNT(*) as totalItems FROM restoration_requests WHERE user_id = ?";
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
      requests,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems,
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("사용자 복원 요청 목록 조회 오류:", error);
    res
      .status(500)
      .json({ success: false, message: "복원 요청 목록 조회 중 오류 발생" });
  } finally {
    if (conn) conn.release();
  }
});

// GET /api/appr/restoration/requests/:requestId (복원 요청 상세)
router.get("/requests/:requestId", isAuthenticated, async (req, res) => {
  const { requestId } = req.params;
  const user_id = req.session.user.id;
  let conn;
  try {
    conn = await pool.getConnection();
    const [rows] = await conn.query(
      `SELECT rr.*, a.brand, a.model_name, a.category, a.images as appraisal_images FROM restoration_requests rr JOIN appraisals a ON rr.appraisal_id = a.id WHERE rr.id = ?`,
      [requestId]
    );
    if (rows.length === 0)
      return res.status(404).json({
        success: false,
        message: "해당 복원 요청을 찾을 수 없습니다.",
      });
    const requestData = rows[0];
    if (requestData.user_id !== user_id && req.session.user.id !== "admin") {
      return res
        .status(403)
        .json({ success: false, message: "접근 권한이 없습니다." });
    }
    res.json({
      success: true,
      request: {
        id: requestData.id,
        status: requestData.status,
        total_price: requestData.total_price,
        appraisal: {
          appraisal_id: requestData.appraisal_id,
          brand: requestData.brand,
          model_name: requestData.model_name,
          category: requestData.category,
          images: requestData.appraisal_images
            ? JSON.parse(requestData.appraisal_images)
            : [],
        },
        items: requestData.items ? JSON.parse(requestData.items) : [],
        delivery_info: requestData.delivery_info
          ? JSON.parse(requestData.delivery_info)
          : null,
        payment_info: requestData.payment_info
          ? JSON.parse(requestData.payment_info)
          : null,
        created_at: requestData.created_at,
        updated_at: requestData.updated_at,
        estimated_completion_date: requestData.estimated_completion_date,
      },
    });
  } catch (error) {
    console.error("복원 요청 상세 조회 오류:", error);
    res
      .status(500)
      .json({ success: false, message: "복원 요청 상세 조회 중 오류 발생" });
  } finally {
    if (conn) conn.release();
  }
});

// --- 관리자용 복원 서비스 관리 ---
// POST /api/appr/restoration/services (관리자: 복원 서비스 추가)
router.post("/services", isAuthenticated, isAdmin, async (req, res) => {
  const {
    name,
    description,
    price,
    estimated_days,
    before_image,
    after_image,
    is_active = true,
  } = req.body;
  if (
    !name ||
    !description ||
    typeof price !== "number" ||
    typeof estimated_days !== "number"
  ) {
    return res.status(400).json({
      success: false,
      message: "필수 정보(이름,설명,가격,예상소요일) 누락 또는 형식 오류",
    });
  }
  const serviceId = uuidv4();
  let conn;
  try {
    conn = await pool.getConnection();
    const sql = `INSERT INTO restoration_services (id, name, description, price, estimated_days, before_image, after_image, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`;
    await conn.query(sql, [
      serviceId,
      name,
      description,
      price,
      estimated_days,
      before_image || null,
      after_image || null,
      is_active,
    ]);
    const [newService] = await conn.query(
      "SELECT * FROM restoration_services WHERE id = ?",
      [serviceId]
    );
    res.status(201).json({
      success: true,
      message: "복원 서비스 추가 완료",
      service: newService[0],
    });
  } catch (error) {
    console.error("복원 서비스 추가 오류:", error);
    res
      .status(500)
      .json({ success: false, message: "복원 서비스 추가 중 오류 발생" });
  } finally {
    if (conn) conn.release();
  }
});

// PUT /api/appr/restoration/services/:serviceId (관리자: 복원 서비스 수정)
router.put(
  "/services/:serviceId",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    const { serviceId } = req.params;
    const {
      name,
      description,
      price,
      estimated_days,
      before_image,
      after_image,
      is_active,
    } = req.body;
    const fieldsToUpdate = {};
    if (name !== undefined) fieldsToUpdate.name = name;
    if (description !== undefined) fieldsToUpdate.description = description;
    if (price !== undefined) fieldsToUpdate.price = price;
    if (estimated_days !== undefined)
      fieldsToUpdate.estimated_days = estimated_days;
    if (before_image !== undefined) fieldsToUpdate.before_image = before_image;
    if (after_image !== undefined) fieldsToUpdate.after_image = after_image;
    if (is_active !== undefined) fieldsToUpdate.is_active = is_active;
    if (Object.keys(fieldsToUpdate).length === 0)
      return res
        .status(400)
        .json({ success: false, message: "수정할 내용 없음" });
    fieldsToUpdate.updated_at = new Date();
    let conn;
    try {
      conn = await pool.getConnection();
      const [result] = await conn.query(
        "UPDATE restoration_services SET ? WHERE id = ?",
        [fieldsToUpdate, serviceId]
      );
      if (result.affectedRows === 0)
        return res
          .status(404)
          .json({ success: false, message: "해당 복원 서비스를 찾을 수 없음" });
      const [updatedService] = await conn.query(
        "SELECT * FROM restoration_services WHERE id = ?",
        [serviceId]
      );
      res.json({
        success: true,
        message: "복원 서비스 수정 완료",
        service: updatedService[0],
      });
    } catch (error) {
      console.error("복원 서비스 수정 오류:", error);
      res
        .status(500)
        .json({ success: false, message: "복원 서비스 수정 중 오류 발생" });
    } finally {
      if (conn) conn.release();
    }
  }
);

// DELETE /api/appr/restoration/services/:serviceId (관리자: 복원 서비스 삭제)
router.delete(
  "/services/:serviceId",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    const { serviceId } = req.params;
    let conn;
    try {
      conn = await pool.getConnection();
      // 실제 삭제 대신 is_active = FALSE로 변경 (소프트 삭제)
      const [result] = await conn.query(
        "UPDATE restoration_services SET is_active = FALSE, updated_at = NOW() WHERE id = ?",
        [serviceId]
      );
      if (result.affectedRows === 0)
        return res
          .status(404)
          .json({ success: false, message: "해당 복원 서비스를 찾을 수 없음" });
      res.json({ success: true, message: "복원 서비스가 비활성화되었습니다." });
    } catch (error) {
      console.error("복원 서비스 비활성화 오류:", error);
      res
        .status(500)
        .json({ success: false, message: "복원 서비스 비활성화 중 오류 발생" });
    } finally {
      if (conn) conn.release();
    }
  }
);

module.exports = router;
