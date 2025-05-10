// routes/restoration.js
const express = require("express");
const router = express.Router();
const pool = require("../utils/DB");
const { v4: uuidv4 } = require("uuid");

// 미들웨어: 인증 확인
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.status(401).json({
      success: false,
      message: "로그인이 필요합니다.",
    });
  }
};

// 복원 서비스 목록 조회
router.get("/services", async (req, res) => {
  let conn;

  try {
    conn = await pool.getConnection();

    // 활성화된 복원 서비스 목록 조회
    const [services] = await conn.query(`
      SELECT id, name, description, price, estimated_days, 
             before_image, after_image
      FROM restoration_services
      WHERE is_active = TRUE
      ORDER BY price ASC
    `);

    res.json({
      success: true,
      services: services,
    });
  } catch (error) {
    console.error("복원 서비스 목록 조회 중 오류 발생:", error);
    res.status(500).json({
      success: false,
      message: "복원 서비스 목록 조회 중 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 복원 서비스 신청
router.post("/request", isAuthenticated, async (req, res) => {
  const { appraisal_id, items, delivery_info, payment_info } = req.body;
  const user_id = req.session.user.id;
  let conn;

  try {
    // 필수 필드 검증
    if (!appraisal_id || !items || !items.length || !delivery_info) {
      return res.status(400).json({
        success: false,
        message: "필수 정보가 누락되었습니다.",
      });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    // 감정 정보 확인
    const [appraisals] = await conn.query(
      "SELECT * FROM appraisals WHERE id = ?",
      [appraisal_id]
    );

    if (appraisals.length === 0) {
      await conn.rollback();
      return res.status(404).json({
        success: false,
        message: "해당 감정 정보를 찾을 수 없습니다.",
      });
    }

    // 선택한 서비스 ID 목록
    const serviceIds = items.map((item) => item.service_id);

    // 서비스 정보 조회
    const [services] = await conn.query(
      `
      SELECT * FROM restoration_services 
      WHERE id IN (?) AND is_active = TRUE
    `,
      [serviceIds]
    );

    if (services.length !== serviceIds.length) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: "일부 서비스를 찾을 수 없거나 비활성화되었습니다.",
      });
    }

    // 서비스 ID를 키로 하는 맵 생성
    const serviceMap = {};
    services.forEach((service) => {
      serviceMap[service.id] = service;
    });

    // 복원 항목 데이터 구성
    const processedItems = items.map((item) => {
      const service = serviceMap[item.service_id];
      return {
        service_id: item.service_id,
        service_name: service.name,
        price: service.price,
        status: "pending",
      };
    });

    // 총 가격 계산
    const totalPrice = processedItems.reduce(
      (sum, item) => sum + item.price,
      0
    );

    // 최대 소요일 계산
    const maxDays = services.reduce(
      (max, service) => Math.max(max, service.estimated_days),
      0
    );

    // 예상 완료일 계산
    const estimatedCompletionDate = new Date();
    estimatedCompletionDate.setDate(
      estimatedCompletionDate.getDate() + maxDays
    );

    // 복원 요청 데이터 저장
    const requestId = uuidv4();
    await conn.query(
      `
      INSERT INTO restoration_requests (
        id, appraisal_id, user_id, items, 
        status, total_price, delivery_info, 
        payment_info, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `,
      [
        requestId,
        appraisal_id,
        user_id,
        JSON.stringify(processedItems),
        "pending",
        totalPrice,
        JSON.stringify(delivery_info),
        payment_info ? JSON.stringify(payment_info) : null,
      ]
    );

    await conn.commit();

    res.status(201).json({
      success: true,
      message: "복원 서비스 신청이 완료되었습니다.",
      request: {
        id: requestId,
        status: "pending",
        total_price: totalPrice,
        estimated_completion_date: estimatedCompletionDate,
      },
    });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("복원 서비스 신청 중 오류 발생:", error);
    res.status(500).json({
      success: false,
      message: "복원 서비스 신청 중 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 사용자의 복원 요청 목록 조회
router.get("/user", isAuthenticated, async (req, res) => {
  const user_id = req.session.user.id;
  let conn;

  try {
    conn = await pool.getConnection();

    // 사용자의 복원 요청 목록 조회
    const [requests] = await conn.query(
      `
      SELECT r.id, r.status, r.total_price, r.created_at,
             a.brand, a.model, a.category
      FROM restoration_requests r
      JOIN appraisals a ON r.appraisal_id = a.id
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
    `,
      [user_id]
    );

    // 복원 요청 목록에 항목 정보 추가
    const formattedRequests = await Promise.all(
      requests.map(async (request) => {
        try {
          // 복원 항목 정보 조회
          const [requestDetails] = await conn.query(
            "SELECT items FROM restoration_requests WHERE id = ?",
            [request.id]
          );

          let items = [];
          if (requestDetails.length > 0 && requestDetails[0].items) {
            items = JSON.parse(requestDetails[0].items);
          }

          return {
            id: request.id,
            status: request.status,
            total_price: request.total_price,
            appraisal: {
              brand: request.brand,
              model: request.model,
              category: request.category,
            },
            items: items.map((item) => ({
              service_name: item.service_name,
              price: item.price,
            })),
            created_at: request.created_at,
          };
        } catch (error) {
          console.error(`요청 ID ${request.id} 처리 중 오류:`, error);
          return null;
        }
      })
    );

    // null 항목 제거
    const filteredRequests = formattedRequests.filter(
      (request) => request !== null
    );

    res.json({
      success: true,
      requests: filteredRequests,
    });
  } catch (error) {
    console.error("복원 요청 목록 조회 중 오류 발생:", error);
    res.status(500).json({
      success: false,
      message: "복원 요청 목록 조회 중 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 복원 요청 상세 정보 조회
router.get("/:requestId", isAuthenticated, async (req, res) => {
  const { requestId } = req.params;
  const user_id = req.session.user.id;
  let conn;

  try {
    conn = await pool.getConnection();

    // 복원 요청 정보 조회
    const [requests] = await conn.query(
      `
      SELECT r.*, a.brand, a.model, a.category, a.images
      FROM restoration_requests r
      JOIN appraisals a ON r.appraisal_id = a.id
      WHERE r.id = ?
    `,
      [requestId]
    );

    if (requests.length === 0) {
      return res.status(404).json({
        success: false,
        message: "해당 복원 요청을 찾을 수 없습니다.",
      });
    }

    const request = requests[0];

    // 권한 확인 (관리자 또는 본인)
    if (user_id !== "admin" && user_id !== request.user_id) {
      return res.status(403).json({
        success: false,
        message: "권한이 없습니다.",
      });
    }

    // 이미지 정보 처리
    let photos = [];
    if (request.images) {
      try {
        photos = JSON.parse(request.images);
      } catch (error) {
        console.error("이미지 파싱 오류:", error);
      }
    }

    // 복원 항목 정보 처리
    let items = [];
    if (request.items) {
      try {
        items = JSON.parse(request.items);
      } catch (error) {
        console.error("복원 항목 파싱 오류:", error);
      }
    }

    // 배송 정보 처리
    let deliveryInfo = {};
    if (request.delivery_info) {
      try {
        deliveryInfo = JSON.parse(request.delivery_info);
      } catch (error) {
        console.error("배송 정보 파싱 오류:", error);
      }
    }

    // 예상 완료일 계산 (서비스 최대 소요일 기준)
    const createdDate = new Date(request.created_at);
    const estimatedCompletionDate = new Date(createdDate);

    // 항목의 소요일 중 최대값으로 계산 (15일 기본값)
    const maxDays = 15;
    estimatedCompletionDate.setDate(createdDate.getDate() + maxDays);

    // 응답 데이터 구성
    const response = {
      success: true,
      request: {
        id: request.id,
        status: request.status,
        total_price: request.total_price,
        appraisal: {
          id: request.appraisal_id,
          brand: request.brand,
          model: request.model,
          category: request.category,
          photos: photos,
        },
        items: items,
        delivery_info: deliveryInfo,
        created_at: request.created_at,
        estimated_completion_date: estimatedCompletionDate,
      },
    };

    res.json(response);
  } catch (error) {
    console.error("복원 요청 상세 정보 조회 중 오류 발생:", error);
    res.status(500).json({
      success: false,
      message: "복원 요청 상세 정보 조회 중 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
