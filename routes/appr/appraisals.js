// routes/appr/appraisals.js
const express = require("express");
const router = express.Router();
const pool = require("../../utils/DB");
const { isAuthenticated, isAdmin } = require("../../utils/middleware");
const { v4: uuidv4 } = require("uuid");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Multer 설정 - 감정 이미지 저장
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "public/images/appraisals";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + uuidv4();
    cb(null, "appraisal-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: Infinity },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(
        new Error("유효하지 않은 파일 형식입니다. 이미지만 업로드 가능합니다."),
        false
      );
    }
  },
});

// 감정 신청 - POST /api/appr/appraisals
router.post("/", isAuthenticated, async (req, res) => {
  let conn;
  try {
    const {
      appraisal_type,
      brand,
      model_name,
      category,
      remarks,
      product_link,
      platform,
      purchase_year,
      components_included,
      delivery_info,
    } = req.body;

    // 필수 필드 검증
    if (!appraisal_type || !brand || !model_name || !category) {
      return res.status(400).json({
        success: false,
        message: "필수 입력 항목이 누락되었습니다.",
      });
    }

    // 퀵링크 감정에는 product_link가 필수
    if (appraisal_type === "quicklink" && !product_link) {
      return res.status(400).json({
        success: false,
        message: "퀵링크 감정에는 상품 링크가 필요합니다.",
      });
    }

    // 오프라인 감정에는 delivery_info가 필수
    if (appraisal_type === "offline" && !delivery_info) {
      return res.status(400).json({
        success: false,
        message: "오프라인 감정에는 배송 정보가 필요합니다.",
      });
    }

    conn = await pool.getConnection();

    // 사용자 ID 가져오기
    const user_id = req.session.user.id;

    // 사용자 크레딧 확인 (퀵링크 감정인 경우)
    if (appraisal_type === "quicklink") {
      const [userCredit] = await conn.query(
        "SELECT quick_link_credits_remaining, quick_link_monthly_limit FROM appr_users WHERE user_id = ?",
        [user_id]
      );

      if (
        userCredit.length === 0 ||
        userCredit[0].quick_link_credits_remaining <= 0
      ) {
        return res.status(403).json({
          success: false,
          message: "퀵링크 감정에 필요한 크레딧이 부족합니다.",
        });
      }
    }

    // 감정 ID 생성
    const appraisal_id = uuidv4();

    // 인증서 번호 생성
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const dateStr = `${year}${month}${day}`;

    // 오늘 발급된 인증서 수 확인
    const [certCountResult] = await conn.query(
      "SELECT COUNT(*) as count FROM appraisals WHERE DATE(created_at) = CURDATE()"
    );
    const certCount = certCountResult[0].count + 1;
    const sequenceNumber = String(certCount).padStart(4, "0");

    const certificate_number = `CAS-${dateStr}-${sequenceNumber}`;

    // 감정 데이터 저장
    await conn.query(
      `INSERT INTO appraisals (
        id, user_id, appraisal_type, brand, model_name, category, 
        remarks, product_link, platform, purchase_year, 
        components_included, delivery_info, status, result,
        certificate_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        appraisal_id,
        user_id,
        appraisal_type,
        brand,
        model_name,
        category,
        remarks || null,
        product_link || null,
        platform || null,
        purchase_year || null,
        components_included ? JSON.stringify(components_included) : null,
        delivery_info ? JSON.stringify(delivery_info) : null,
        "pending",
        "pending",
        certificate_number,
      ]
    );

    res.status(201).json({
      success: true,
      appraisal: {
        id: appraisal_id,
        certificate_number,
        appraisal_type,
        status: "pending",
        created_at: new Date(),
      },
    });
  } catch (err) {
    console.error("감정 신청 처리 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "감정 신청 처리 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 감정 목록 조회 - GET /api/appr/appraisals
router.get("/", isAuthenticated, async (req, res) => {
  let conn;
  try {
    const user_id = req.session.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const status = req.query.status;
    const all = req.query.all === "true";
    const today = req.query.today === "true";

    conn = await pool.getConnection();

    // 기본 쿼리
    let query = `
      SELECT 
        id, appraisal_type, brand, model_name, status, result, certificate_number,
        created_at, JSON_EXTRACT(images, '$[0]') as representative_image
      FROM appraisals 
      WHERE user_id = ?
    `;

    const queryParams = [user_id];

    // 상태 필터 적용
    if (status) {
      query += " AND status = ?";
      queryParams.push(status);
    }

    // today 필터 적용
    if (today) {
      query += " AND DATE(created_at) = CURDATE()";
    }

    // 최신순 정렬
    query += " ORDER BY created_at DESC";

    // limit이 0이 아닌 경우에만 페이지네이션 적용
    if (limit !== 0) {
      query += " LIMIT ? OFFSET ?";
      queryParams.push(limit, offset);
    }

    // 쿼리 실행
    const [rows] = await conn.query(query, queryParams);

    // 전체 개수 조회
    let countQuery =
      "SELECT COUNT(*) as total FROM appraisals WHERE user_id = ?";
    const countParams = [user_id];

    if (status) {
      countQuery += " AND status = ?";
      countParams.push(status);
    }

    if (today) {
      countQuery += " AND DATE(created_at) = CURDATE()";
    }

    const [countResult] = await conn.query(countQuery, countParams);
    const total = countResult[0].total;

    // 결과 반환
    res.json({
      success: true,
      appraisals: rows.map((row) => ({
        ...row,
        representative_image: row.representative_image
          ? JSON.parse(row.representative_image)
          : null,
      })),
      pagination: {
        currentPage: page,
        totalPages: limit === 0 ? 1 : Math.ceil(total / limit),
        totalItems: total,
        limit,
      },
    });
  } catch (err) {
    console.error("감정 목록 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "감정 목록 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 마이페이지 종합 정보 - GET /api/appr/appraisals/my
router.get("/my", isAuthenticated, async (req, res) => {
  let conn;
  try {
    const user_id = req.session.user.id;

    conn = await pool.getConnection();

    // 사용자 기본 정보 조회 - business_number, company_name, address 추가
    const [users] = await conn.query(
      "SELECT id, email, company_name, phone, business_number, address, created_at FROM users WHERE id = ?",
      [user_id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "사용자 정보를 찾을 수 없습니다.",
      });
    }

    // 멤버십 정보 조회
    const [membershipRows] = await conn.query(
      `SELECT 
        tier, quick_link_credits_remaining, quick_link_monthly_limit,
        quick_link_subscription_type as subscription_type,
        quick_link_subscription_expires_at as subscription_expires_at,
        offline_appraisal_fee
      FROM appr_users WHERE user_id = ?`,
      [user_id]
    );

    const membership_info =
      membershipRows.length > 0
        ? membershipRows[0]
        : {
            tier: "일반회원",
            quick_link_credits_remaining: 0,
            quick_link_monthly_limit: 0,
            subscription_type: "free",
            subscription_expires_at: null,
            offline_appraisal_fee: 38000,
          };

    // 최근 감정 목록 조회
    const page = 1;
    const limit = 5;

    const [appraisals] = await conn.query(
      `SELECT 
        id, appraisal_type, brand, model_name, status, result, certificate_number,
        created_at, JSON_EXTRACT(images, '$[0]') as representative_image
      FROM appraisals 
      WHERE user_id = ?
      ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [user_id, limit, 0]
    );

    // 전체 감정 개수 조회
    const [countResult] = await conn.query(
      "SELECT COUNT(*) as total FROM appraisals WHERE user_id = ?",
      [user_id]
    );

    const total = countResult[0].total;

    res.json({
      success: true,
      user_info: users[0],
      membership_info,
      recent_appraisals: {
        appraisals: appraisals.map((row) => ({
          ...row,
          representative_image: row.representative_image
            ? JSON.parse(row.representative_image)
            : null,
        })),
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          limit,
        },
      },
    });
  } catch (err) {
    console.error("마이페이지 정보 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "마이페이지 정보 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 브랜드별 정품 구별법 목록 조회 - GET /api/appr/appraisals/authenticity-guides
router.get("/authenticity-guides", async (req, res) => {
  let conn;
  try {
    const brand = req.query.brand; // 특정 브랜드만 필터링할 경우

    conn = await pool.getConnection();

    let query = `
      SELECT 
        id, brand, guide_type, title, description, 
        authentic_image, fake_image
      FROM authenticity_guides
      WHERE is_active = true
    `;

    const queryParams = [];

    // 특정 브랜드 필터링
    if (brand) {
      query += " AND brand = ?";
      queryParams.push(brand);
    }

    // 정렬
    query += " ORDER BY brand, guide_type";

    const [rows] = await conn.query(query, queryParams);

    // 브랜드별로 그룹화
    const groupedGuides = {};

    rows.forEach((guide) => {
      if (!groupedGuides[guide.brand]) {
        groupedGuides[guide.brand] = [];
      }
      groupedGuides[guide.brand].push(guide);
    });

    res.json({
      success: true,
      guides: groupedGuides,
    });
  } catch (err) {
    console.error("정품 구별법 목록 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "정품 구별법 목록 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 특정 브랜드의 정품 구별법 조회 - GET /api/appr/appraisals/authenticity-guides/:brand
router.get("/authenticity-guides/:brand", async (req, res) => {
  let conn;
  try {
    const brand = req.params.brand;

    conn = await pool.getConnection();

    const [rows] = await conn.query(
      `SELECT 
        id, brand, guide_type, title, description, 
        authentic_image, fake_image
      FROM authenticity_guides
      WHERE brand = ? AND is_active = true
      ORDER BY guide_type`,
      [brand]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "해당 브랜드의 정품 구별법 정보를 찾을 수 없습니다.",
      });
    }

    res.json({
      success: true,
      brand,
      guides: rows,
    });
  } catch (err) {
    console.error("브랜드별 정품 구별법 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "브랜드별 정품 구별법 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 감정 상세 조회 - GET /api/appr/appraisals/:certificate_number
router.get("/:certificate_number", isAuthenticated, async (req, res) => {
  let conn;
  try {
    const certificate_number = req.params.certificate_number;
    const user_id = req.session.user.id;

    conn = await pool.getConnection();

    const [rows] = await conn.query(
      `SELECT * FROM appraisals WHERE certificate_number = ? AND user_id = ?`,
      [certificate_number, user_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "해당 감정 정보를 찾을 수 없습니다.",
      });
    }

    // JSON 데이터 파싱
    const appraisal = rows[0];
    if (appraisal.components_included) {
      appraisal.components_included = JSON.parse(appraisal.components_included);
    }
    if (appraisal.delivery_info) {
      appraisal.delivery_info = JSON.parse(appraisal.delivery_info);
    }
    if (appraisal.images) {
      appraisal.images = JSON.parse(appraisal.images);
    }

    res.json({
      success: true,
      appraisal,
    });
  } catch (err) {
    console.error("감정 상세 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "감정 상세 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 감정서 정보 조회 - GET /api/appr/appraisals/certificate/:certificateNumber
router.get("/certificate/:certificateNumber", async (req, res) => {
  let conn;
  try {
    const certificateNumber = req.params.certificateNumber;

    conn = await pool.getConnection();

    // status 조건 제거
    const [rows] = await conn.query(
      `SELECT 
        id, brand, model_name, category, appraisal_type, 
        result, result_notes, images, appraised_at, certificate_number, status
      FROM appraisals WHERE certificate_number = ?`,
      [certificateNumber]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "해당 감정서를 찾을 수 없습니다.",
      });
    }

    const appraisal = rows[0];

    // JSON 데이터 파싱
    if (appraisal.images) {
      appraisal.images = JSON.parse(appraisal.images);
    }

    // 검증 코드 생성 (간단히 certificate_number의 앞 6자리)
    const verification_code = certificateNumber.substring(0, 6);

    res.json({
      success: true,
      certificate: {
        certificate_number: certificateNumber,
        issued_date: appraisal.appraised_at,
        verification_code,
        appraisal,
      },
    });
  } catch (err) {
    console.error("감정서 정보 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "감정서 정보 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// PDF 감정서 다운로드 - GET /api/appr/appraisals/certificate/:certificateNumber/download
router.get("/certificate/:certificateNumber/download", async (req, res) => {
  let conn;
  try {
    const certificateNumber = req.params.certificateNumber;

    conn = await pool.getConnection();

    // status 조건 제거
    const [rows] = await conn.query(
      "SELECT certificate_url FROM appraisals WHERE certificate_number = ?",
      [certificateNumber]
    );

    if (rows.length === 0 || !rows[0].certificate_url) {
      return res.status(404).json({
        success: false,
        message: "감정서 PDF를 찾을 수 없습니다.",
      });
    }

    const pdfPath = path.join(
      __dirname,
      "../../public",
      rows[0].certificate_url.replace(/^\//, "")
    );

    // PDF 파일 존재 여부 확인
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({
        success: false,
        message: "감정서 PDF 파일을 찾을 수 없습니다.",
      });
    }

    // 파일 다운로드
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="certificate-${certificateNumber}.pdf"`
    );

    const fileStream = fs.createReadStream(pdfPath);
    fileStream.pipe(res);
  } catch (err) {
    console.error("감정서 다운로드 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "감정서 다운로드 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 감정서 QR코드 이미지 - GET /api/appr/appraisals/certificate/:certificateNumber/qrcode
router.get("/certificate/:certificateNumber/qrcode", async (req, res) => {
  let conn;
  try {
    const certificateNumber = req.params.certificateNumber;

    conn = await pool.getConnection();

    // status 조건 제거
    const [rows] = await conn.query(
      "SELECT qrcode_url FROM appraisals WHERE certificate_number = ?",
      [certificateNumber]
    );

    if (rows.length === 0 || !rows[0].qrcode_url) {
      return res.status(404).json({
        success: false,
        message: "QR코드 이미지를 찾을 수 없습니다.",
      });
    }

    const qrcodePath = path.join(
      __dirname,
      "../../public",
      rows[0].qrcode_url.replace(/^\//, "")
    );

    // QR 코드 이미지 파일 존재 여부 확인
    if (!fs.existsSync(qrcodePath)) {
      return res.status(404).json({
        success: false,
        message: "QR코드 이미지 파일을 찾을 수 없습니다.",
      });
    }

    // 이미지 전송
    res.setHeader("Content-Type", "image/png");

    const fileStream = fs.createReadStream(qrcodePath);
    fileStream.pipe(res);
  } catch (err) {
    console.error("QR코드 이미지 제공 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "QR코드 이미지 제공 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
