// routes/appr/admin.js
const express = require("express");
const router = express.Router();
const pool = require("../../utils/DB");
const { isAuthenticated, isAdmin } = require("../../utils/middleware");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const QRCode = require("qrcode");
const crypto = require("crypto");

// Multer 설정 - 감정 이미지 저장
const appraisalStorage = multer.diskStorage({
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

const appraisalUpload = multer({
  storage: appraisalStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB 제한
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith("image/") ||
      file.mimetype === "application/pdf"
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "유효하지 않은 파일 형식입니다. 이미지 또는 PDF만 업로드 가능합니다."
        ),
        false
      );
    }
  },
});

// Multer 설정 - 복원 서비스 이미지 저장
const restorationStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "public/images/restorations";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + uuidv4();
    cb(null, "restoration-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const restorationUpload = multer({
  storage: restorationStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB 제한
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

const authenticityStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "public/images/authenticity";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + uuidv4();
    cb(null, "authenticity-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const authenticityUpload = multer({
  storage: authenticityStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB 제한
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

async function generateQRCodeWithKey(certificateNumber, outputPath) {
  try {
    // 암호화 없이 직접 감정서 조회 URL 생성
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const certificateUrl = `${frontendUrl}/appr/result/${certificateNumber}`;

    await QRCode.toFile(outputPath, certificateUrl, {
      errorCorrectionLevel: "H",
      margin: 1,
      width: 300,
    });

    return true; // 성공 시 true 반환
  } catch (error) {
    console.error("QR 코드 생성 중 오류:", error);
    return false;
  }
}

async function generateCertificateNumber(conn, customNumber = null) {
  if (customNumber) {
    // 커스텀 번호 형식 검증: cas + 숫자 (자릿수 제한 없음)
    const certPattern = /^cas\d+$/i;
    if (!certPattern.test(customNumber)) {
      throw new Error(
        "감정 번호는 CAS + 숫자 형식이어야 합니다. (예: CAS04312)"
      );
    }

    // 대소문자 통일 (소문자로 저장)
    const normalizedNumber = customNumber.toLowerCase();

    // 중복 확인
    const [existing] = await conn.query(
      "SELECT certificate_number FROM appraisals WHERE certificate_number = ?",
      [normalizedNumber]
    );

    if (existing.length > 0) {
      throw new Error("이미 존재하는 감정 번호입니다.");
    }

    return normalizedNumber;
  }

  // 자동 생성: 가장 최근에 생성된 번호 + 1
  try {
    // 가장 최근에 생성된 인증서 번호 조회 (created_at 기준)
    const [rows] = await conn.query(
      `SELECT certificate_number 
       FROM appraisals 
       WHERE certificate_number REGEXP '^cas[0-9]+$' 
       ORDER BY created_at DESC 
       LIMIT 1`
    );

    let nextNumber = 1; // 기본값: cas1부터 시작

    let digitCount = 6; // 기본 6자리

    if (rows.length > 0) {
      const lastCertNumber = rows[0].certificate_number;
      // "cas" 제거하고 숫자 부분만 추출
      const match = lastCertNumber.match(/^cas(\d+)$/i);
      if (match) {
        const numberPart = match[1];
        digitCount = numberPart.length; // 기존 자릿수 유지
        const lastNumber = parseInt(numberPart);
        nextNumber = lastNumber + 1;
      }
    }

    // 중복 확인하면서 사용 가능한 번호 찾기
    let certificateNumber;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 1000; // 무한루프 방지

    while (!isUnique && attempts < maxAttempts) {
      // 자릿수 맞춰서 0 패딩
      const paddedNumber = nextNumber.toString().padStart(digitCount, "0");
      certificateNumber = `cas${paddedNumber}`;

      // 중복 확인
      const [existing] = await conn.query(
        "SELECT certificate_number FROM appraisals WHERE certificate_number = ?",
        [certificateNumber]
      );

      if (existing.length === 0) {
        isUnique = true;
      } else {
        nextNumber++; // 중복이면 다음 번호 시도
        attempts++;
      }
    }

    if (!isUnique) {
      // 만약 1000번 시도해도 안 되면 랜덤으로 폴백
      console.warn("순차 번호 생성 실패, 랜덤 번호로 폴백");
      const randomNum = Math.floor(100000 + Math.random() * 900000);
      certificateNumber = `cas${randomNum}`;

      // 랜덤 번호도 중복 확인
      const [randomCheck] = await conn.query(
        "SELECT certificate_number FROM appraisals WHERE certificate_number = ?",
        [certificateNumber]
      );

      if (randomCheck.length > 0) {
        throw new Error("인증서 번호 생성에 실패했습니다. 다시 시도해주세요.");
      }
    }

    return certificateNumber;
  } catch (error) {
    console.error("인증서 번호 생성 중 오류:", error);
    throw new Error("인증서 번호 생성 중 오류가 발생했습니다.");
  }
}

// Multer 설정 - 배너 이미지 저장
const bannerStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "public/images/banners";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + uuidv4();
    cb(null, "banner-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const bannerUpload = multer({
  storage: bannerStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB 제한
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

// 배너 목록 조회 - GET /api/appr/admin/banners
router.get("/banners", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();

    const [rows] = await conn.query(
      "SELECT * FROM main_banners ORDER BY display_order ASC, created_at DESC"
    );

    res.json({
      success: true,
      banners: rows,
    });
  } catch (err) {
    console.error("배너 목록 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "배너 목록 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 배너 추가 - POST /api/appr/admin/banners
router.post(
  "/banners",
  isAuthenticated,
  isAdmin,
  bannerUpload.single("banner_image"),
  async (req, res) => {
    let conn;
    try {
      const {
        title,
        subtitle,
        description,
        button_text,
        button_link,
        display_order,
        is_active,
      } = req.body;

      // 필수 필드 검증 - 설명만 필수로 변경
      if (!description || !description.trim()) {
        return res.status(400).json({
          success: false,
          message: "설명은 필수 입력 항목입니다.",
        });
      }

      let banner_image = null;
      if (req.file) {
        banner_image = `/images/banners/${req.file.filename}`;
      }

      conn = await pool.getConnection();

      const banner_id = uuidv4();

      await conn.query(
        `INSERT INTO main_banners (
          id, title, subtitle, description, banner_image,
          button_text, button_link, display_order, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          banner_id,
          title?.trim() || null,
          subtitle?.trim() || null,
          description.trim(),
          banner_image,
          button_text?.trim() || null,
          button_link?.trim() || null,
          parseInt(display_order) || 0,
          is_active === "true" || is_active === true,
        ]
      );

      res.status(201).json({
        success: true,
        banner: {
          id: banner_id,
          title: title?.trim() || null,
          subtitle: subtitle?.trim() || null,
          description: description.trim(),
          banner_image,
          button_text: button_text?.trim() || null,
          button_link: button_link?.trim() || null,
          display_order: parseInt(display_order) || 0,
          is_active: is_active === "true" || is_active === true,
        },
      });
    } catch (err) {
      console.error("배너 추가 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "배너 추가 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  }
);

// 배너 수정 - PUT /api/appr/admin/banners/:id
router.put(
  "/banners/:id",
  isAuthenticated,
  isAdmin,
  bannerUpload.single("banner_image"),
  async (req, res) => {
    let conn;
    try {
      const banner_id = req.params.id;
      const {
        title,
        subtitle,
        description,
        button_text,
        button_link,
        display_order,
        is_active,
      } = req.body;

      conn = await pool.getConnection();

      // 배너 존재 여부 확인
      const [bannerRows] = await conn.query(
        "SELECT * FROM main_banners WHERE id = ?",
        [banner_id]
      );

      if (bannerRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "해당 배너를 찾을 수 없습니다.",
        });
      }

      const banner = bannerRows[0];
      let banner_image = banner.banner_image;

      // 새 이미지가 업로드된 경우
      if (req.file) {
        banner_image = `/images/banners/${req.file.filename}`;
      }

      // 업데이트할 필드 구성
      const updateData = {};
      const updateFields = [];
      const updateValues = [];

      if (title !== undefined) {
        updateFields.push("title = ?");
        updateValues.push(title);
        updateData.title = title;
      }

      if (subtitle !== undefined) {
        updateFields.push("subtitle = ?");
        updateValues.push(subtitle);
        updateData.subtitle = subtitle;
      }

      if (description !== undefined) {
        updateFields.push("description = ?");
        updateValues.push(description);
        updateData.description = description;
      }

      if (banner_image !== banner.banner_image) {
        updateFields.push("banner_image = ?");
        updateValues.push(banner_image);
        updateData.banner_image = banner_image;
      }

      if (button_text !== undefined) {
        updateFields.push("button_text = ?");
        updateValues.push(button_text);
        updateData.button_text = button_text;
      }

      if (button_link !== undefined) {
        updateFields.push("button_link = ?");
        updateValues.push(button_link);
        updateData.button_link = button_link;
      }

      if (display_order !== undefined) {
        updateFields.push("display_order = ?");
        updateValues.push(parseInt(display_order));
        updateData.display_order = parseInt(display_order);
      }

      if (is_active !== undefined) {
        updateFields.push("is_active = ?");
        updateValues.push(is_active === "true" || is_active === true);
        updateData.is_active = is_active === "true" || is_active === true;
      }

      if (updateFields.length === 0) {
        return res.status(400).json({
          success: false,
          message: "업데이트할 정보가 없습니다.",
        });
      }

      // 업데이트 쿼리 실행
      const query = `UPDATE main_banners SET ${updateFields.join(
        ", "
      )} WHERE id = ?`;
      updateValues.push(banner_id);

      await conn.query(query, updateValues);

      res.json({
        success: true,
        banner: {
          id: banner_id,
          ...banner,
          ...updateData,
        },
      });
    } catch (err) {
      console.error("배너 수정 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "배너 수정 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  }
);

// 배너 삭제 - DELETE /api/appr/admin/banners/:id
router.delete("/banners/:id", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    const banner_id = req.params.id;

    conn = await pool.getConnection();

    // 배너 존재 여부 확인
    const [bannerRows] = await conn.query(
      "SELECT * FROM main_banners WHERE id = ?",
      [banner_id]
    );

    if (bannerRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "해당 배너를 찾을 수 없습니다.",
      });
    }

    // 배너 삭제
    await conn.query("DELETE FROM main_banners WHERE id = ?", [banner_id]);

    res.json({
      success: true,
      message: "배너가 삭제되었습니다.",
    });
  } catch (err) {
    console.error("배너 삭제 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "배너 삭제 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 회원 목록 조회 - GET /api/appr/admin/users
router.get("/users", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    const { page = 1, limit = 20, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    conn = await pool.getConnection();

    let queryParams = [];
    let query = `
      SELECT u.id, u.email, u.company_name, u.phone, u.created_at,
        a.tier, a.quick_link_credits_remaining, a.quick_link_monthly_limit,
        a.quick_link_subscription_type, a.quick_link_subscription_expires_at
      FROM users u
      LEFT JOIN appr_users a ON u.id = a.user_id
      WHERE 1=1
    `;

    // 검색 조건 추가
    if (search) {
      query += " AND (u.id LIKE ? OR u.email LIKE ? OR u.company_name LIKE ?)";
      const searchPattern = `%${search}%`;
      queryParams.push(searchPattern, searchPattern, searchPattern);
    }

    // 정렬 및 페이지네이션
    query += " ORDER BY u.created_at DESC LIMIT ? OFFSET ?";
    queryParams.push(parseInt(limit), offset);

    const [rows] = await conn.query(query, queryParams);

    // 전체 개수 조회
    let countQuery = "SELECT COUNT(*) as total FROM users u WHERE 1=1";
    const countParams = [];

    if (search) {
      countQuery +=
        " AND (u.id LIKE ? OR u.email LIKE ? OR u.company_name LIKE ?)";
      const searchPattern = `%${search}%`;
      countParams.push(searchPattern, searchPattern, searchPattern);
    }

    const [countResult] = await conn.query(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      success: true,
      users: rows,
      pagination: {
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
        currentPage: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (err) {
    console.error("회원 목록 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "회원 목록 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 회원 정보 수정 - PUT /api/appr/admin/users/:id
router.put("/users/:id", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    const user_id = req.params.id;
    const {
      tier,
      quick_link_credits_remaining,
      quick_link_monthly_limit,
      offline_appraisal_fee,
      quick_link_subscription_type,
      quick_link_subscription_expires_at,
    } = req.body;

    conn = await pool.getConnection();

    // 사용자 존재 여부 확인
    const [userRows] = await conn.query("SELECT * FROM users WHERE id = ?", [
      user_id,
    ]);

    if (userRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "사용자를 찾을 수 없습니다.",
      });
    }

    // appr_users 테이블에 사용자 존재 여부 확인
    const [apprUserRows] = await conn.query(
      "SELECT * FROM appr_users WHERE user_id = ?",
      [user_id]
    );

    if (apprUserRows.length === 0) {
      // 새 사용자 등록
      await conn.query(
        `INSERT INTO appr_users (
          user_id, tier, quick_link_credits_remaining, quick_link_monthly_limit,
          quick_link_subscription_type, quick_link_subscription_expires_at, offline_appraisal_fee
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          user_id,
          tier || "일반회원",
          quick_link_credits_remaining || 0,
          quick_link_monthly_limit || 0,
          quick_link_subscription_type || "free",
          quick_link_subscription_expires_at || null,
          offline_appraisal_fee || 38000,
        ]
      );
    } else {
      // 기존 사용자 정보 업데이트
      let updateQuery = "UPDATE appr_users SET ";
      const updateParams = [];
      const updates = [];

      if (tier !== undefined) {
        updates.push("tier = ?");
        updateParams.push(tier);
      }

      if (quick_link_credits_remaining !== undefined) {
        updates.push("quick_link_credits_remaining = ?");
        updateParams.push(quick_link_credits_remaining);
      }

      if (quick_link_monthly_limit !== undefined) {
        updates.push("quick_link_monthly_limit = ?");
        updateParams.push(quick_link_monthly_limit);
      }

      if (offline_appraisal_fee !== undefined) {
        updates.push("offline_appraisal_fee = ?");
        updateParams.push(offline_appraisal_fee);
      }

      if (quick_link_subscription_type !== undefined) {
        updates.push("quick_link_subscription_type = ?");
        updateParams.push(quick_link_subscription_type);
      }
      if (quick_link_subscription_expires_at !== undefined) {
        updates.push("quick_link_subscription_expires_at = ?");
        updateParams.push(quick_link_subscription_expires_at);
      }

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          message: "업데이트할 정보가 없습니다.",
        });
      }

      updateQuery += updates.join(", ") + " WHERE user_id = ?";
      updateParams.push(user_id);

      await conn.query(updateQuery, updateParams);
    }

    // 업데이트된 사용자 정보 조회
    const [updatedRows] = await conn.query(
      `SELECT u.id, u.email, u.company_name, u.phone,
        a.tier, a.quick_link_credits_remaining, a.quick_link_monthly_limit,
        a.quick_link_subscription_type, a.quick_link_subscription_expires_at, a.offline_appraisal_fee
      FROM users u
      JOIN appr_users a ON u.id = a.user_id
      WHERE u.id = ?`,
      [user_id]
    );

    res.json({
      success: true,
      user: updatedRows[0],
    });
  } catch (err) {
    console.error("회원 정보 수정 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "회원 정보 수정 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 관리자 감정 생성 - POST /api/appr/admin/appraisals
router.post("/appraisals", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    const {
      user_id,
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
      certificate_number, // 관리자가 직접 입력할 수 있는 감정 번호
    } = req.body;

    // 필수 필드 검증
    if (!user_id || !appraisal_type || !brand || !model_name || !category) {
      return res.status(400).json({
        success: false,
        message: "필수 입력 항목이 누락되었습니다.",
      });
    }

    conn = await pool.getConnection();

    // 사용자 존재 여부 확인
    const [userRows] = await conn.query("SELECT id FROM users WHERE id = ?", [
      user_id,
    ]);

    if (userRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "해당 사용자를 찾을 수 없습니다.",
      });
    }

    // 인증서 번호 생성 또는 검증
    const finalCertificateNumber = await generateCertificateNumber(
      conn,
      certificate_number
    );

    // 감정 데이터 저장
    await conn.query(
      `INSERT INTO appraisals (
        user_id, appraisal_type, brand, model_name, category, 
        remarks, product_link, platform, purchase_year, 
        components_included, delivery_info, status, result,
        certificate_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
        finalCertificateNumber,
      ]
    );

    // 생성된 감정 정보 조회
    const [createdAppraisal] = await conn.query(
      `SELECT a.*, u.email as user_email, u.company_name
       FROM appraisals a
       JOIN users u ON a.user_id = u.id
       WHERE a.certificate_number = ?`,
      [finalCertificateNumber]
    );

    res.status(201).json({
      success: true,
      appraisal: createdAppraisal[0],
    });
  } catch (err) {
    console.error("관리자 감정 생성 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: err.message || "감정 생성 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 전체 감정 목록 조회 - GET /api/appr/admin/appraisals
router.get("/appraisals", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    const { page = 1, limit = 20, status, result, type, search } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    conn = await pool.getConnection();

    let query = `
      SELECT 
        a.id, a.user_id, a.appraisal_type, a.status, a.brand, a.model_name,
        a.category, a.result, a.certificate_number, a.created_at,
        u.email as user_email, u.company_name as company_name,
        JSON_EXTRACT(a.images, '$[0]') as representative_image
      FROM appraisals a
      JOIN users u ON a.user_id = u.id
      WHERE 1=1
    `;

    const queryParams = [];

    // 필터 적용
    if (status) {
      query += " AND a.status = ?";
      queryParams.push(status);
    }

    if (result) {
      query += " AND a.result = ?";
      queryParams.push(result);
    }

    if (type) {
      query += " AND a.appraisal_type = ?";
      queryParams.push(type);
    }

    // 검색 조건 추가
    if (search) {
      query +=
        " AND (a.brand LIKE ? OR a.model_name LIKE ? OR a.user_id LIKE ? OR a.certificate_number LIKE ?)";
      const searchPattern = `%${search}%`;
      queryParams.push(
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern
      );
    }

    // 최신순 정렬 및 페이지네이션
    query += " ORDER BY a.created_at DESC LIMIT ? OFFSET ?";
    queryParams.push(parseInt(limit), offset);

    const [rows] = await conn.query(query, queryParams);

    // 전체 개수 조회
    let countQuery = "SELECT COUNT(*) as total FROM appraisals a WHERE 1=1";
    const countParams = [];

    if (status) {
      countQuery += " AND a.status = ?";
      countParams.push(status);
    }

    if (result) {
      countQuery += " AND a.result = ?";
      countParams.push(result);
    }

    if (type) {
      countQuery += " AND a.appraisal_type = ?";
      countParams.push(type);
    }

    if (search) {
      countQuery +=
        " AND (a.brand LIKE ? OR a.model_name LIKE ? OR a.user_id LIKE ? OR a.certificate_number LIKE ?)";
      const searchPattern = `%${search}%`;
      countParams.push(
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern
      );
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
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        limit: parseInt(limit),
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

// 감정 상세 정보 조회 - GET /api/appr/admin/appraisals/:id
router.get("/appraisals/:id", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    const appraisal_id = req.params.id;

    conn = await pool.getConnection();

    const [rows] = await conn.query(
      `SELECT a.*, u.email as user_email, u.company_name
      FROM appraisals a
      JOIN users u ON a.user_id = u.id
      WHERE a.id = ?`,
      [appraisal_id]
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

// 감정 결과 및 상태 업데이트 - PUT /api/appr/admin/appraisals/:id
router.put(
  "/appraisals/:id",
  isAuthenticated,
  isAdmin,
  appraisalUpload.fields([
    { name: "images", maxCount: 20 },
    { name: "pdf", maxCount: 1 },
  ]),
  async (req, res) => {
    let conn;
    try {
      const appraisal_id = req.params.id;
      const {
        // 기본 정보 필드들 추가
        brand,
        model_name,
        category,
        appraisal_type,
        product_link,
        platform,
        purchase_year,
        components_included,
        delivery_info,
        remarks,
        certificate_number,
        // 기존 감정 결과 필드들
        result,
        result_notes,
        suggested_restoration_services,
      } = req.body;

      conn = await pool.getConnection();

      // 감정 정보 조회
      const [appraisalRows] = await conn.query(
        "SELECT * FROM appraisals WHERE id = ?",
        [appraisal_id]
      );

      if (appraisalRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "해당 감정 정보를 찾을 수 없습니다.",
        });
      }

      const appraisal = appraisalRows[0];

      // 인증서 번호 변경 시 중복 확인
      if (
        certificate_number &&
        certificate_number !== appraisal.certificate_number
      ) {
        const normalizedNumber = certificate_number.toLowerCase();

        // 형식 검증
        const certPattern = /^cas\d+$/i;
        if (!certPattern.test(normalizedNumber)) {
          return res.status(400).json({
            success: false,
            message: "감정 번호는 CAS + 숫자 형식이어야 합니다. (예: CAS04312)",
          });
        }

        // 중복 확인
        const [existing] = await conn.query(
          "SELECT certificate_number FROM appraisals WHERE certificate_number = ? AND id != ?",
          [normalizedNumber, appraisal_id]
        );

        if (existing.length > 0) {
          return res.status(400).json({
            success: false,
            message: "이미 존재하는 감정 번호입니다.",
          });
        }
      }

      let existingImages = appraisal.images ? JSON.parse(appraisal.images) : [];
      let qrcode_url = appraisal.qrcode_url;
      let qr_access_key = appraisal.qr_access_key;
      let certificate_url = appraisal.certificate_url;

      // 이미지 처리 - 퀵링크와 오프라인 모두 지원
      if (req.files && req.files.images) {
        const newImages = req.files.images.map(
          (file) => `/images/appraisals/${file.filename}`
        );
        existingImages = [...existingImages, ...newImages];
      }

      // PDF 처리
      if (req.files && req.files.pdf && req.files.pdf.length > 0) {
        certificate_url = `/images/appraisals/${req.files.pdf[0].filename}`;
      }

      // QR 코드 생성 (인증서 번호가 있고 QR 코드가 없는 경우)
      const finalCertificateNumber =
        certificate_number || appraisal.certificate_number;
      if (finalCertificateNumber && !qrcode_url) {
        // QR 코드 파일 생성
        const qrDir = path.join(__dirname, "../../public/images/qrcodes");
        if (!fs.existsSync(qrDir)) {
          fs.mkdirSync(qrDir, { recursive: true });
        }

        const qrFileName = `qr-${finalCertificateNumber}.png`;
        const qrPath = path.join(qrDir, qrFileName);

        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
        const certificateUrl = `${frontendUrl}/appr/result/${finalCertificateNumber}`;

        try {
          await QRCode.toFile(qrPath, certificateUrl, {
            errorCorrectionLevel: "H",
            margin: 1,
            width: 300,
          });

          qrcode_url = `/images/qrcodes/${qrFileName}`;
        } catch (error) {
          console.error("QR 코드 생성 중 오류:", error);
        }
      }

      // 감정 정보 업데이트 필드 구성
      const updateData = {};
      const updateFields = [];
      const updateValues = [];

      // 기본 정보 업데이트 필드들
      if (brand !== undefined) {
        updateFields.push("brand = ?");
        updateValues.push(brand);
        updateData.brand = brand;
      }

      if (model_name !== undefined) {
        updateFields.push("model_name = ?");
        updateValues.push(model_name);
        updateData.model_name = model_name;
      }

      if (category !== undefined) {
        updateFields.push("category = ?");
        updateValues.push(category);
        updateData.category = category;
      }

      if (appraisal_type !== undefined) {
        updateFields.push("appraisal_type = ?");
        updateValues.push(appraisal_type);
        updateData.appraisal_type = appraisal_type;
      }

      if (product_link !== undefined) {
        updateFields.push("product_link = ?");
        updateValues.push(product_link);
        updateData.product_link = product_link;
      }

      if (platform !== undefined) {
        updateFields.push("platform = ?");
        updateValues.push(platform);
        updateData.platform = platform;
      }

      if (purchase_year !== undefined) {
        updateFields.push("purchase_year = ?");
        updateValues.push(purchase_year ? parseInt(purchase_year) : null);
        updateData.purchase_year = purchase_year
          ? parseInt(purchase_year)
          : null;
      }

      if (components_included !== undefined) {
        updateFields.push("components_included = ?");
        updateValues.push(
          components_included ? JSON.stringify(components_included) : null
        );
        updateData.components_included = components_included;
      }

      if (delivery_info !== undefined) {
        updateFields.push("delivery_info = ?");
        updateValues.push(delivery_info ? JSON.stringify(delivery_info) : null);
        updateData.delivery_info = delivery_info;
      }

      if (remarks !== undefined) {
        updateFields.push("remarks = ?");
        updateValues.push(remarks);
        updateData.remarks = remarks;
      }

      if (certificate_number !== undefined) {
        updateFields.push("certificate_number = ?");
        updateValues.push(
          certificate_number ? certificate_number.toLowerCase() : null
        );
        updateData.certificate_number = certificate_number
          ? certificate_number.toLowerCase()
          : null;
      }

      // 기존 감정 결과 필드들
      if (result) {
        updateFields.push("result = ?");
        updateValues.push(result);
        updateData.result = result;

        // 결과가 설정되면 status를 자동으로 변경
        if (result !== "pending") {
          updateFields.push("status = 'completed'");
          updateData.status = "completed";
        } else {
          // 결과가 pending이면 status는 in_review로 설정
          updateFields.push("status = 'in_review'");
          updateData.status = "in_review";
        }
      } else {
        // 결과가 없으면 status는 in_review로 설정
        updateFields.push("status = 'in_review'");
        updateData.status = "in_review";
      }

      if (result_notes !== undefined) {
        updateFields.push("result_notes = ?");
        updateValues.push(result_notes);
        updateData.result_notes = result_notes;
      }

      if (existingImages.length > 0) {
        updateFields.push("images = ?");
        updateValues.push(JSON.stringify(existingImages));
        updateData.images = existingImages;
      }

      if (certificate_url) {
        updateFields.push("certificate_url = ?");
        updateValues.push(certificate_url);
        updateData.certificate_url = certificate_url;
      }

      if (qrcode_url) {
        updateFields.push("qrcode_url = ?");
        updateValues.push(qrcode_url);
        updateData.qrcode_url = qrcode_url;
      }

      // 제안된 복원 서비스가 있는 경우 저장
      if (suggested_restoration_services) {
        try {
          // JSON 문자열인지 확인하고 파싱
          const serviceIds =
            typeof suggested_restoration_services === "string"
              ? JSON.parse(suggested_restoration_services)
              : suggested_restoration_services;

          updateFields.push("suggested_restoration_services = ?");
          updateValues.push(JSON.stringify(serviceIds));
          updateData.suggested_restoration_services = serviceIds;
        } catch (error) {
          console.error("복원 서비스 JSON 파싱 오류:", error);
        }
      }

      // 크레딧 차감 처리 (결과가 pending이 아니고, status가 completed로 변경되는 경우)
      let creditInfo = { deducted: false, remaining: 0 };

      if (result && result !== "pending" && !appraisal.credit_deducted) {
        // 퀵링크 감정인 경우에만 크레딧 차감
        if (appraisal.appraisal_type === "quicklink") {
          const [userRows] = await conn.query(
            "SELECT * FROM appr_users WHERE user_id = ?",
            [appraisal.user_id]
          );

          if (userRows.length > 0) {
            const user = userRows[0];
            const newCredits = Math.max(
              0,
              user.quick_link_credits_remaining - 1
            );

            await conn.query(
              "UPDATE appr_users SET quick_link_credits_remaining = ? WHERE user_id = ?",
              [newCredits, appraisal.user_id]
            );

            creditInfo = {
              deducted: true,
              remaining: newCredits,
            };

            // 크레딧 차감 여부 업데이트
            updateFields.push("credit_deducted = ?");
            updateValues.push(true);
            updateData.credit_deducted = true;
          }
        }

        // 감정 완료 시간도 설정
        updateFields.push("appraised_at = ?");
        updateValues.push(new Date());
        updateData.appraised_at = new Date();
      }

      if (updateFields.length === 0) {
        return res.status(400).json({
          success: false,
          message: "업데이트할 정보가 없습니다.",
        });
      }

      // 업데이트 쿼리 실행
      const query = `UPDATE appraisals SET ${updateFields.join(
        ", "
      )} WHERE id = ?`;
      updateValues.push(appraisal_id);

      await conn.query(query, updateValues);

      res.json({
        success: true,
        appraisal: {
          id: appraisal_id,
          certificate_number: finalCertificateNumber,
          ...updateData,
        },
        credit_info: creditInfo,
      });
    } catch (err) {
      console.error("감정 정보 업데이트 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message:
          err.message || "감정 정보 업데이트 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  }
);

// 감정 삭제 - DELETE /api/appr/admin/appraisals/:id
router.delete("/appraisals/:id", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    const appraisal_id = req.params.id;

    conn = await pool.getConnection();

    // 감정 정보 조회 (존재 여부 확인 및 관련 정보 수집)
    const [appraisalRows] = await conn.query(
      "SELECT * FROM appraisals WHERE id = ?",
      [appraisal_id]
    );

    if (appraisalRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "해당 감정 정보를 찾을 수 없습니다.",
      });
    }

    const appraisal = appraisalRows[0];

    // 트랜잭션 시작
    await conn.beginTransaction();

    try {
      // 1. 관련 복원 요청이 있는지 확인하고 삭제
      const [restorationRequests] = await conn.query(
        "SELECT id FROM restoration_requests WHERE appraisal_id = ?",
        [appraisal_id]
      );

      if (restorationRequests.length > 0) {
        // 복원 요청도 함께 삭제
        await conn.query(
          "DELETE FROM restoration_requests WHERE appraisal_id = ?",
          [appraisal_id]
        );
      }

      // 2. 결제 정보가 있는지 확인하고 관련 리소스 정보 업데이트
      await conn.query(
        `UPDATE payments 
         SET related_resource_id = NULL, related_resource_type = NULL 
         WHERE related_resource_id = ? AND related_resource_type = 'appraisal'`,
        [appraisal_id]
      );

      // 3. 크레딧이 차감된 경우 복구 (퀵링크만)
      if (
        appraisal.credit_deducted &&
        appraisal.appraisal_type === "quicklink"
      ) {
        const [userRows] = await conn.query(
          "SELECT * FROM appr_users WHERE user_id = ?",
          [appraisal.user_id]
        );

        if (userRows.length > 0) {
          // 크레딧 1개 복구
          await conn.query(
            "UPDATE appr_users SET quick_link_credits_remaining = quick_link_credits_remaining + 1 WHERE user_id = ?",
            [appraisal.user_id]
          );
        }
      }

      // 4. 감정 정보 삭제
      await conn.query("DELETE FROM appraisals WHERE id = ?", [appraisal_id]);

      // 5. 관련 파일 삭제 (비동기로 처리하여 응답 속도 개선)
      setImmediate(() => {
        try {
          // 이미지 파일 삭제
          if (appraisal.images) {
            const images = JSON.parse(appraisal.images);
            images.forEach((imagePath) => {
              const fullPath = path.join(__dirname, "../../public", imagePath);
              if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
              }
            });
          }

          // PDF 파일 삭제
          if (appraisal.certificate_url) {
            const pdfPath = path.join(
              __dirname,
              "../../public",
              appraisal.certificate_url
            );
            if (fs.existsSync(pdfPath)) {
              fs.unlinkSync(pdfPath);
            }
          }

          // QR 코드 파일 삭제
          if (appraisal.qrcode_url) {
            const qrPath = path.join(
              __dirname,
              "../../public",
              appraisal.qrcode_url
            );
            if (fs.existsSync(qrPath)) {
              fs.unlinkSync(qrPath);
            }
          }
        } catch (fileError) {
          console.error("파일 삭제 중 오류:", fileError);
          // 파일 삭제 실패는 로그만 남기고 계속 진행
        }
      });

      // 트랜잭션 커밋
      await conn.commit();

      res.json({
        success: true,
        message: "감정 정보가 성공적으로 삭제되었습니다.",
        deleted_appraisal: {
          id: appraisal_id,
          certificate_number: appraisal.certificate_number,
          brand: appraisal.brand,
          model_name: appraisal.model_name,
          credit_restored:
            appraisal.credit_deducted &&
            appraisal.appraisal_type === "quicklink",
          related_restorations_deleted: restorationRequests.length,
        },
      });
    } catch (error) {
      // 트랜잭션 롤백
      await conn.rollback();
      throw error;
    }
  } catch (err) {
    console.error("감정 삭제 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: err.message || "감정 삭제 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 복원 서비스 목록 조회 - GET /api/appr/admin/restoration-services
router.get(
  "/restoration-services",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    let conn;
    try {
      conn = await pool.getConnection();

      const [rows] = await conn.query(
        "SELECT * FROM restoration_services ORDER BY name ASC"
      );

      res.json({
        success: true,
        services: rows,
      });
    } catch (err) {
      console.error("복원 서비스 목록 조회 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "복원 서비스 목록 조회 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  }
);

// 복원 서비스 추가 - POST /api/appr/admin/restoration-services
router.post(
  "/restoration-services",
  isAuthenticated,
  isAdmin,
  restorationUpload.fields([
    { name: "before_image", maxCount: 1 },
    { name: "after_image", maxCount: 1 },
  ]),
  async (req, res) => {
    let conn;
    try {
      const { name, description, price, estimated_days } = req.body;

      // 필수 필드 검증
      if (!name || !description || !price || !estimated_days) {
        return res.status(400).json({
          success: false,
          message: "필수 입력 항목이 누락되었습니다.",
        });
      }

      let before_image = null;
      let after_image = null;

      // 이미지 처리
      if (req.files) {
        if (req.files.before_image && req.files.before_image.length > 0) {
          before_image = `/images/restorations/${req.files.before_image[0].filename}`;
        }

        if (req.files.after_image && req.files.after_image.length > 0) {
          after_image = `/images/restorations/${req.files.after_image[0].filename}`;
        }
      }

      conn = await pool.getConnection();

      // 서비스 ID 생성
      const service_id = uuidv4();

      // 서비스 정보 저장 - price와 estimated_days 모두 문자열로 저장
      await conn.query(
        `INSERT INTO restoration_services (
        id, name, description, price, estimated_days,
        before_image, after_image, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          service_id,
          name,
          description,
          price, // 문자열로 저장
          estimated_days, // 문자열로 저장 (변경됨)
          before_image,
          after_image,
          true,
        ]
      );

      res.status(201).json({
        success: true,
        service: {
          id: service_id,
          name,
          description,
          price: price,
          estimated_days: estimated_days, // 문자열로 반환
          before_image,
          after_image,
          is_active: true,
        },
      });
    } catch (err) {
      console.error("복원 서비스 추가 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "복원 서비스 추가 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  }
);

// 복원 서비스 수정 - PUT /api/appr/admin/restoration-services/:id
router.put(
  "/restoration-services/:id",
  isAuthenticated,
  isAdmin,
  restorationUpload.fields([
    { name: "before_image", maxCount: 1 },
    { name: "after_image", maxCount: 1 },
  ]),
  async (req, res) => {
    let conn;
    try {
      const service_id = req.params.id;
      const { name, description, price, estimated_days } = req.body;

      conn = await pool.getConnection();

      // 서비스 존재 여부 확인
      const [serviceRows] = await conn.query(
        "SELECT * FROM restoration_services WHERE id = ?",
        [service_id]
      );

      if (serviceRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "해당 복원 서비스를 찾을 수 없습니다.",
        });
      }

      const service = serviceRows[0];
      let before_image = service.before_image;
      let after_image = service.after_image;

      // 이미지 처리
      if (req.files) {
        if (req.files.before_image && req.files.before_image.length > 0) {
          before_image = `/images/restorations/${req.files.before_image[0].filename}`;
        }

        if (req.files.after_image && req.files.after_image.length > 0) {
          after_image = `/images/restorations/${req.files.after_image[0].filename}`;
        }
      }

      // 업데이트할 필드 구성
      const updateData = {};
      const updateFields = [];
      const updateValues = [];

      if (name) {
        updateFields.push("name = ?");
        updateValues.push(name);
        updateData.name = name;
      }

      if (description) {
        updateFields.push("description = ?");
        updateValues.push(description);
        updateData.description = description;
      }

      if (price) {
        updateFields.push("price = ?");
        updateValues.push(price); // 문자열로 저장
        updateData.price = price;
      }

      if (estimated_days) {
        updateFields.push("estimated_days = ?");
        updateValues.push(estimated_days); // 문자열로 저장 (변경됨)
        updateData.estimated_days = estimated_days;
      }

      if (before_image !== service.before_image) {
        updateFields.push("before_image = ?");
        updateValues.push(before_image);
        updateData.before_image = before_image;
      }

      if (after_image !== service.after_image) {
        updateFields.push("after_image = ?");
        updateValues.push(after_image);
        updateData.after_image = after_image;
      }

      if (updateFields.length === 0) {
        return res.status(400).json({
          success: false,
          message: "업데이트할 정보가 없습니다.",
        });
      }

      // 업데이트 쿼리 실행
      const query = `UPDATE restoration_services SET ${updateFields.join(
        ", "
      )} WHERE id = ?`;
      updateValues.push(service_id);

      await conn.query(query, updateValues);

      res.json({
        success: true,
        service: {
          id: service_id,
          ...service,
          ...updateData,
        },
      });
    } catch (err) {
      console.error("복원 서비스 수정 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "복원 서비스 수정 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  }
);

// 복원 서비스 비활성화 - DELETE /api/appr/admin/restoration-services/:id
router.delete(
  "/restoration-services/:id",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    let conn;
    try {
      const service_id = req.params.id;

      conn = await pool.getConnection();

      // 서비스 존재 여부 확인
      const [serviceRows] = await conn.query(
        "SELECT * FROM restoration_services WHERE id = ?",
        [service_id]
      );

      if (serviceRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "해당 복원 서비스를 찾을 수 없습니다.",
        });
      }

      // 서비스 비활성화 (실제 삭제하지 않음)
      await conn.query(
        "UPDATE restoration_services SET is_active = ? WHERE id = ?",
        [false, service_id]
      );

      res.json({
        success: true,
        message: "복원 서비스가 비활성화되었습니다.",
      });
    } catch (err) {
      console.error("복원 서비스 비활성화 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "복원 서비스 비활성화 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  }
);

// 전체 복원 요청 목록 조회 - GET /api/appr/admin/restorations
router.get("/restorations", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    const { page = 1, limit = 20, status, search } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    conn = await pool.getConnection();

    let query = `
      SELECT 
        r.id, r.appraisal_id, r.status, r.total_price, 
        r.created_at, r.estimated_completion_date, r.completed_at,
        a.brand, a.model_name,
        u.id as user_id, u.email as user_email, u.company_name
      FROM restoration_requests r
      JOIN appraisals a ON r.appraisal_id = a.id
      JOIN users u ON r.user_id = u.id
      WHERE 1=1
    `;

    const queryParams = [];

    // 상태 필터 적용
    if (status) {
      query += " AND r.status = ?";
      queryParams.push(status);
    }

    // 검색 조건 추가
    if (search) {
      query +=
        " AND (a.brand LIKE ? OR a.model_name LIKE ? OR u.id LIKE ? OR u.email LIKE ?)";
      const searchPattern = `%${search}%`;
      queryParams.push(
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern
      );
    }

    // 최신순 정렬 및 페이지네이션
    query += " ORDER BY r.created_at DESC LIMIT ? OFFSET ?";
    queryParams.push(parseInt(limit), offset);

    const [rows] = await conn.query(query, queryParams);

    // 전체 개수 조회
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM restoration_requests r
      JOIN appraisals a ON r.appraisal_id = a.id
      JOIN users u ON r.user_id = u.id
      WHERE 1=1
    `;

    const countParams = [];

    if (status) {
      countQuery += " AND r.status = ?";
      countParams.push(status);
    }

    if (search) {
      countQuery +=
        " AND (a.brand LIKE ? OR a.model_name LIKE ? OR u.id LIKE ? OR u.email LIKE ?)";
      const searchPattern = `%${search}%`;
      countParams.push(
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern
      );
    }

    const [countResult] = await conn.query(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      success: true,
      restorations: rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        limit: parseInt(limit),
      },
    });
  } catch (err) {
    console.error("복원 요청 목록 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "복원 요청 목록 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 복원 요청 상세 정보 조회 - GET /api/appr/admin/restorations/:id
router.get("/restorations/:id", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    const restoration_id = req.params.id;

    conn = await pool.getConnection();

    const [rows] = await conn.query(
      `SELECT r.*, a.brand, a.model_name, a.category, a.images as appraisal_images,
        u.email as user_email, u.company_name
      FROM restoration_requests r
      JOIN appraisals a ON r.appraisal_id = a.id
      JOIN users u ON r.user_id = u.id
      WHERE r.id = ?`,
      [restoration_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "해당 복원 요청 정보를 찾을 수 없습니다.",
      });
    }

    // JSON 데이터 파싱
    const restoration = rows[0];
    if (restoration.services) {
      restoration.services = JSON.parse(restoration.services);
    }
    if (restoration.delivery_info) {
      restoration.delivery_info = JSON.parse(restoration.delivery_info);
    }
    if (restoration.images) {
      restoration.images = JSON.parse(restoration.images);
    }
    if (restoration.appraisal_images) {
      restoration.appraisal_images = JSON.parse(restoration.appraisal_images);
    }

    // 감정 정보 포맷팅
    const appraisal = {
      id: restoration.appraisal_id,
      brand: restoration.brand,
      model_name: restoration.model_name,
      category: restoration.category,
      images: restoration.appraisal_images,
    };

    // 불필요한 필드 제거
    delete restoration.brand;
    delete restoration.model_name;
    delete restoration.category;
    delete restoration.appraisal_images;

    // 응답 구성
    restoration.appraisal = appraisal;

    res.json({
      success: true,
      restoration,
    });
  } catch (err) {
    console.error("복원 요청 상세 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "복원 요청 상세 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 복원 상태 및 이미지 업데이트 - PUT /api/appr/admin/restorations/:id
router.put(
  "/restorations/:id",
  isAuthenticated,
  isAdmin,
  restorationUpload.fields([
    { name: "before_images", maxCount: 10 },
    { name: "after_images", maxCount: 10 },
    { name: "progress_images", maxCount: 10 },
  ]),
  async (req, res) => {
    let conn;
    try {
      const restoration_id = req.params.id;
      const {
        status,
        estimated_completion_date,
        completed_at,
        services: servicesJSON,
      } = req.body;

      conn = await pool.getConnection();

      // 복원 요청 정보 조회
      const [restorationRows] = await conn.query(
        "SELECT * FROM restoration_requests WHERE id = ?",
        [restoration_id]
      );

      if (restorationRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "해당 복원 요청 정보를 찾을 수 없습니다.",
        });
      }

      const restoration = restorationRows[0];
      let existingImages = restoration.images
        ? JSON.parse(restoration.images)
        : { before: [], after: [], progress: [] };
      let services = restoration.services
        ? JSON.parse(restoration.services)
        : [];

      // 이미지 처리
      if (req.files) {
        if (req.files.before_images) {
          const newBeforeImages = req.files.before_images.map(
            (file) => `/images/restorations/${file.filename}`
          );
          existingImages.before = [
            ...(existingImages.before || []),
            ...newBeforeImages,
          ];
        }

        if (req.files.after_images) {
          const newAfterImages = req.files.after_images.map(
            (file) => `/images/restorations/${file.filename}`
          );
          existingImages.after = [
            ...(existingImages.after || []),
            ...newAfterImages,
          ];
        }

        if (req.files.progress_images) {
          const newProgressImages = req.files.progress_images.map(
            (file) => `/images/restorations/${file.filename}`
          );
          existingImages.progress = [
            ...(existingImages.progress || []),
            ...newProgressImages,
          ];
        }
      }

      // 서비스 상태 업데이트
      if (servicesJSON) {
        try {
          const updatedServices = JSON.parse(servicesJSON);

          // 서비스 ID를 기반으로 기존 서비스 업데이트
          services = services.map((service) => {
            const updatedService = updatedServices.find(
              (s) => s.service_id === service.service_id
            );
            if (updatedService && updatedService.status) {
              return { ...service, status: updatedService.status };
            }
            return service;
          });
        } catch (error) {
          console.error("서비스 JSON 파싱 오류:", error);
        }
      }

      // 업데이트할 필드 구성
      const updateData = {};
      const updateFields = [];
      const updateValues = [];

      if (status) {
        updateFields.push("status = ?");
        updateValues.push(status);
        updateData.status = status;

        // 완료 상태로 변경 시 완료 시간 자동 설정
        if (status === "completed" && !completed_at) {
          updateFields.push("completed_at = NOW()");
          updateData.completed_at = new Date();
        }
      }

      if (estimated_completion_date) {
        updateFields.push("estimated_completion_date = ?");
        updateValues.push(estimated_completion_date);
        updateData.estimated_completion_date = estimated_completion_date;
      }

      if (completed_at) {
        updateFields.push("completed_at = ?");
        updateValues.push(completed_at);
        updateData.completed_at = completed_at;
      }

      if (services.length > 0) {
        updateFields.push("services = ?");
        updateValues.push(JSON.stringify(services));
        updateData.services = services;
      }

      updateFields.push("images = ?");
      updateValues.push(JSON.stringify(existingImages));
      updateData.images = existingImages;

      if (updateFields.length === 0) {
        return res.status(400).json({
          success: false,
          message: "업데이트할 정보가 없습니다.",
        });
      }

      // 업데이트 쿼리 실행
      const query = `UPDATE restoration_requests SET ${updateFields.join(
        ", "
      )} WHERE id = ?`;
      updateValues.push(restoration_id);

      await conn.query(query, updateValues);

      res.json({
        success: true,
        restoration: {
          id: restoration_id,
          status: updateData.status || restoration.status,
          estimated_completion_date:
            updateData.estimated_completion_date ||
            restoration.estimated_completion_date,
          services: updateData.services || services,
          images: existingImages,
        },
      });
    } catch (err) {
      console.error("복원 상태 업데이트 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "복원 상태 업데이트 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  }
);

// 결제 내역 조회 - GET /api/appr/admin/payments
router.get("/payments", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    const {
      page = 1,
      limit = 20,
      status,
      type,
      startDate,
      endDate,
      search,
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    conn = await pool.getConnection();

    let query = `
      SELECT 
        p.id, p.user_id, p.order_id, p.product_type, p.product_name,
        p.amount, p.status, p.payment_method, p.paid_at, p.created_at,
        u.email as user_email, u.company_name
      FROM payments p
      JOIN users u ON p.user_id = u.id
      WHERE 1=1
    `;

    const queryParams = [];

    // 상태 필터 적용
    if (status) {
      query += " AND p.status = ?";
      queryParams.push(status);
    }

    // 상품 유형 필터 적용
    if (type) {
      query += " AND p.product_type = ?";
      queryParams.push(type);
    }

    // 날짜 범위 필터
    if (startDate) {
      query += " AND DATE(p.created_at) >= ?";
      queryParams.push(startDate);
    }

    if (endDate) {
      query += " AND DATE(p.created_at) <= ?";
      queryParams.push(endDate);
    }

    // 검색 조건 추가
    if (search) {
      query +=
        " AND (p.order_id LIKE ? OR p.product_name LIKE ? OR p.user_id LIKE ? OR u.email LIKE ?)";
      const searchPattern = `%${search}%`;
      queryParams.push(
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern
      );
    }

    // 최신순 정렬 및 페이지네이션
    query += " ORDER BY p.created_at DESC LIMIT ? OFFSET ?";
    queryParams.push(parseInt(limit), offset);

    const [rows] = await conn.query(query, queryParams);

    // 전체 개수 조회
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM payments p
      JOIN users u ON p.user_id = u.id
      WHERE 1=1
    `;

    const countParams = [];

    if (status) {
      countQuery += " AND p.status = ?";
      countParams.push(status);
    }

    if (type) {
      countQuery += " AND p.product_type = ?";
      countParams.push(type);
    }

    if (startDate) {
      countQuery += " AND DATE(p.created_at) >= ?";
      countParams.push(startDate);
    }

    if (endDate) {
      countQuery += " AND DATE(p.created_at) <= ?";
      countParams.push(endDate);
    }

    if (search) {
      countQuery +=
        " AND (p.order_id LIKE ? OR p.product_name LIKE ? OR p.user_id LIKE ? OR u.email LIKE ?)";
      const searchPattern = `%${search}%`;
      countParams.push(
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern
      );
    }

    const [countResult] = await conn.query(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      success: true,
      payments: rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        limit: parseInt(limit),
      },
    });
  } catch (err) {
    console.error("결제 내역 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "결제 내역 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 결제 상세 정보 조회 - GET /api/appr/admin/payments/:id
router.get("/payments/:id", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    const payment_id = req.params.id;

    conn = await pool.getConnection();

    const [rows] = await conn.query(
      `SELECT p.*, u.email as user_email, u.company_name
      FROM payments p
      JOIN users u ON p.user_id = u.id
      WHERE p.id = ?`,
      [payment_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "해당 결제 정보를 찾을 수 없습니다.",
      });
    }

    const payment = rows[0];

    // 관련 리소스 정보 조회 (연관된 리소스가 있는 경우)
    let relatedResource = null;

    if (payment.related_resource_id && payment.related_resource_type) {
      if (payment.related_resource_type === "appraisal") {
        const [appraisalRows] = await conn.query(
          "SELECT id, brand, model_name, appraisal_type, status, result FROM appraisals WHERE id = ?",
          [payment.related_resource_id]
        );

        if (appraisalRows.length > 0) {
          relatedResource = {
            type: "appraisal",
            data: appraisalRows[0],
          };
        }
      } else if (payment.related_resource_type === "restoration") {
        const [restorationRows] = await conn.query(
          `SELECT r.id, r.status, r.total_price, a.brand, a.model_name
          FROM restoration_requests r
          JOIN appraisals a ON r.appraisal_id = a.id
          WHERE r.id = ?`,
          [payment.related_resource_id]
        );

        if (restorationRows.length > 0) {
          relatedResource = {
            type: "restoration",
            data: restorationRows[0],
          };
        }
      }
    }

    // PG사 응답 데이터 파싱
    if (payment.raw_response_data) {
      try {
        payment.raw_response_data = JSON.parse(payment.raw_response_data);
      } catch (error) {
        console.error("PG사 응답 데이터 파싱 오류:", error);
      }
    }

    res.json({
      success: true,
      payment,
      related_resource: relatedResource,
    });
  } catch (err) {
    console.error("결제 상세 정보 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "결제 상세 정보 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 정품 구별법 목록 조회 - GET /api/appr/admin/authenticity-guides
router.get(
  "/authenticity-guides",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    let conn;
    try {
      const { brand, is_active } = req.query;

      conn = await pool.getConnection();

      let query = `
      SELECT 
        id, brand, guide_type, title, description, 
        authentic_image, fake_image, is_active, created_at, updated_at
      FROM authenticity_guides
      WHERE 1=1
    `;

      const queryParams = [];

      if (brand) {
        query += " AND brand = ?";
        queryParams.push(brand);
      }

      if (is_active !== undefined) {
        query += " AND is_active = ?";
        queryParams.push(is_active === "true");
      }

      query += " ORDER BY brand, guide_type, created_at DESC";

      const [rows] = await conn.query(query, queryParams);

      res.json({
        success: true,
        guides: rows,
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
  }
);

// 정품 구별법 추가 - POST /api/appr/admin/authenticity-guides
router.post(
  "/authenticity-guides",
  isAuthenticated,
  isAdmin,
  authenticityUpload.fields([
    { name: "authentic_image", maxCount: 1 },
    { name: "fake_image", maxCount: 1 },
  ]),
  async (req, res) => {
    let conn;
    try {
      const { brand, guide_type, title, description } = req.body;

      // 필수 필드 검증
      if (!brand || !guide_type || !title || !description) {
        return res.status(400).json({
          success: false,
          message: "필수 입력 항목이 누락되었습니다.",
        });
      }

      // 이미지 처리
      let authentic_image = null;
      let fake_image = null;

      if (req.files) {
        if (req.files.authentic_image && req.files.authentic_image.length > 0) {
          authentic_image = `/images/authenticity/${req.files.authentic_image[0].filename}`;
        }

        if (req.files.fake_image && req.files.fake_image.length > 0) {
          fake_image = `/images/authenticity/${req.files.fake_image[0].filename}`;
        }
      }

      conn = await pool.getConnection();

      // 구별법 ID 생성
      const guide_id = uuidv4();

      // 정보 저장
      await conn.query(
        `INSERT INTO authenticity_guides (
          id, brand, guide_type, title, description,
          authentic_image, fake_image, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          guide_id,
          brand,
          guide_type,
          title,
          description,
          authentic_image,
          fake_image,
          true,
        ]
      );

      res.status(201).json({
        success: true,
        guide: {
          id: guide_id,
          brand,
          guide_type,
          title,
          description,
          authentic_image,
          fake_image,
          is_active: true,
        },
      });
    } catch (err) {
      console.error("정품 구별법 추가 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "정품 구별법 추가 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  }
);

// 정품 구별법 수정 - PUT /api/appr/admin/authenticity-guides/:id
router.put(
  "/authenticity-guides/:id",
  isAuthenticated,
  isAdmin,
  authenticityUpload.fields([
    { name: "authentic_image", maxCount: 1 },
    { name: "fake_image", maxCount: 1 },
  ]),
  async (req, res) => {
    let conn;
    try {
      const guide_id = req.params.id;
      const { brand, guide_type, title, description, is_active } = req.body;

      conn = await pool.getConnection();

      // 구별법 존재 여부 확인
      const [guideRows] = await conn.query(
        "SELECT * FROM authenticity_guides WHERE id = ?",
        [guide_id]
      );

      if (guideRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "해당 정품 구별법을 찾을 수 없습니다.",
        });
      }

      const guide = guideRows[0];

      // 이미지 처리
      let authentic_image = guide.authentic_image;
      let fake_image = guide.fake_image;

      if (req.files) {
        if (req.files.authentic_image && req.files.authentic_image.length > 0) {
          authentic_image = `/images/authenticity/${req.files.authentic_image[0].filename}`;
        }

        if (req.files.fake_image && req.files.fake_image.length > 0) {
          fake_image = `/images/authenticity/${req.files.fake_image[0].filename}`;
        }
      }

      // 업데이트할 필드 구성
      const updateData = {};
      const updateFields = [];
      const updateValues = [];

      if (brand) {
        updateFields.push("brand = ?");
        updateValues.push(brand);
        updateData.brand = brand;
      }

      if (guide_type) {
        updateFields.push("guide_type = ?");
        updateValues.push(guide_type);
        updateData.guide_type = guide_type;
      }

      if (title) {
        updateFields.push("title = ?");
        updateValues.push(title);
        updateData.title = title;
      }

      if (description) {
        updateFields.push("description = ?");
        updateValues.push(description);
        updateData.description = description;
      }

      if (authentic_image !== guide.authentic_image) {
        updateFields.push("authentic_image = ?");
        updateValues.push(authentic_image);
        updateData.authentic_image = authentic_image;
      }

      if (fake_image !== guide.fake_image) {
        updateFields.push("fake_image = ?");
        updateValues.push(fake_image);
        updateData.fake_image = fake_image;
      }

      if (is_active !== undefined) {
        updateFields.push("is_active = ?");
        updateValues.push(is_active === "true" || is_active === true);
        updateData.is_active = is_active === "true" || is_active === true;
      }

      if (updateFields.length === 0) {
        return res.status(400).json({
          success: false,
          message: "업데이트할 정보가 없습니다.",
        });
      }

      // 업데이트 쿼리 실행
      const query = `UPDATE authenticity_guides SET ${updateFields.join(
        ", "
      )} WHERE id = ?`;
      updateValues.push(guide_id);

      await conn.query(query, updateValues);

      res.json({
        success: true,
        guide: {
          id: guide_id,
          ...guide,
          ...updateData,
        },
      });
    } catch (err) {
      console.error("정품 구별법 수정 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "정품 구별법 수정 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  }
);

// 정품 구별법 비활성화 - DELETE /api/appr/admin/authenticity-guides/:id
router.delete(
  "/authenticity-guides/:id",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    let conn;
    try {
      const guide_id = req.params.id;

      conn = await pool.getConnection();

      // 실제 삭제 대신 비활성화 처리
      await conn.query(
        "UPDATE authenticity_guides SET is_active = false WHERE id = ?",
        [guide_id]
      );

      res.json({
        success: true,
        message: "정품 구별법이 비활성화되었습니다.",
      });
    } catch (err) {
      console.error("정품 구별법 삭제 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "정품 구별법 삭제 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  }
);

module.exports = router;
