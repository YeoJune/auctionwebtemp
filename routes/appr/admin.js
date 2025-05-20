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

// QR 코드 생성 함수
async function generateQRCode(url, outputPath) {
  try {
    await QRCode.toFile(outputPath, url, {
      errorCorrectionLevel: "H",
      margin: 1,
      width: 300,
    });
    return true;
  } catch (error) {
    console.error("QR 코드 생성 중 오류:", error);
    return false;
  }
}

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
    { name: "images", maxCount: 10 },
    { name: "pdf", maxCount: 1 },
  ]),
  async (req, res) => {
    let conn;
    try {
      const appraisal_id = req.params.id;
      const { result, result_notes, suggested_restoration_services } = req.body;

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
      let existingImages = appraisal.images ? JSON.parse(appraisal.images) : [];
      let qrcode_url = appraisal.qrcode_url;
      let certificate_url = appraisal.certificate_url;

      // 이미지 처리
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

      // QR 코드 생성 (인증서 번호가 있는 경우)
      if (appraisal.certificate_number && !qrcode_url) {
        const qrDir = path.join(__dirname, "../../public/images/qrcodes");
        if (!fs.existsSync(qrDir)) {
          fs.mkdirSync(qrDir, { recursive: true });
        }

        const qrFileName = `qr-${appraisal.certificate_number}.png`;
        const qrPath = path.join(qrDir, qrFileName);
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
        const certificateUrl = `${frontendUrl}/appr/result-detail/${appraisal.certificate_number}`;

        const qrGenerated = await generateQRCode(certificateUrl, qrPath);
        if (qrGenerated) {
          qrcode_url = `/images/qrcodes/${qrFileName}`;
        }
      }

      // 복원 서비스 제안 처리
      let suggested_restoration = null;
      if (
        suggested_restoration_services &&
        Array.isArray(suggested_restoration_services) &&
        suggested_restoration_services.length > 0
      ) {
        // 제안된 복원 서비스 ID가 유효한지 확인
        const [validServices] = await conn.query(
          "SELECT id, name, description, price FROM restoration_services WHERE id IN (?) AND is_active = true",
          [suggested_restoration_services]
        );

        if (validServices.length > 0) {
          suggested_restoration = validServices;
        }
      }

      // 감정 정보 업데이트
      const updateData = {};
      const updateFields = [];
      const updateValues = [];

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
      if (suggested_restoration) {
        updateFields.push("suggested_restoration_services = ?");
        updateValues.push(JSON.stringify(suggested_restoration));
        updateData.suggested_restoration_services = suggested_restoration;
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
          certificate_number: appraisal.certificate_number,
          ...updateData,
        },
        credit_info: creditInfo,
      });
    } catch (err) {
      console.error("감정 정보 업데이트 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "감정 정보 업데이트 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  }
);

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

      // 서비스 정보 저장
      await conn.query(
        `INSERT INTO restoration_services (
        id, name, description, price, estimated_days,
        before_image, after_image, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          service_id,
          name,
          description,
          parseFloat(price),
          parseInt(estimated_days),
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
          price: parseFloat(price),
          estimated_days: parseInt(estimated_days),
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
        updateValues.push(parseFloat(price));
        updateData.price = parseFloat(price);
      }

      if (estimated_days) {
        updateFields.push("estimated_days = ?");
        updateValues.push(parseInt(estimated_days));
        updateData.estimated_days = parseInt(estimated_days);
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

module.exports = router;
