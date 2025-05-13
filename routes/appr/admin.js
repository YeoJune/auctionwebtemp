// routes/appr/admin.js
const express = require("express");
const router = express.Router();
const pool = require("../../utils/DB");
const { isAuthenticated, isAdmin } = require("../../utils/middleware");
const { v4: uuidv4 } = require("uuid");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const bannerStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(
      __dirname,
      "..",
      "..",
      "public",
      "uploads",
      "banners"
    );
    if (!fs.existsSync(uploadPath))
      fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    cb(null, "banner-" + Date.now() + path.extname(file.originalname));
  },
});
const bannerFileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const mimetype = allowedTypes.test(file.mimetype);
  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase()
  );
  if (mimetype && extname) return cb(null, true);
  cb(new Error("이미지 파일(jpeg, jpg, png, gif, webp)만 업로드 가능합니다."));
};
const bannerUpload = multer({
  storage: bannerStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: bannerFileFilter,
});

// GET /api/appr-admin/settings/homepage (홈페이지 콘텐츠 설정 조회)
router.get("/settings/homepage", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const [rows] = await conn.query(
      "SELECT setting_key, setting_value FROM appr_admin_settings WHERE setting_key LIKE 'homepage_%'"
    );
    const settings = {};
    rows.forEach((row) => {
      try {
        settings[row.setting_key] = JSON.parse(row.setting_value);
      } catch (e) {
        settings[row.setting_key] = row.setting_value;
      }
    });
    const defaults = {
      homepage_banner_title: "정확한 명품감정",
      homepage_banner_subtitle: "국내 최고 전문가의 정밀한 감정 서비스",
      homepage_banner_image_url: "/assets/img/default_banner.jpg", // 기본 이미지 경로 (public 폴더 기준)
      homepage_banner_button1_text: "감정 신청하기",
      homepage_banner_button1_url: "/appr/request",
      homepage_banner_button2_text: "감정서 조회하기",
      homepage_banner_button2_url: "/appr/result",
      homepage_show_stats: "true",
    };
    for (const key in defaults) {
      if (!settings.hasOwnProperty(key)) settings[key] = defaults[key];
    }
    res.json({ success: true, settings });
  } catch (error) {
    console.error("Admin 홈페이지 설정 조회 오류:", error);
    res.status(500).json({ success: false, message: "설정 조회 중 오류 발생" });
  } finally {
    if (conn) conn.release();
  }
});

// POST /api/appr-admin/settings/homepage (홈페이지 콘텐츠 설정 업데이트)
router.post(
  "/settings/homepage",
  isAuthenticated,
  isAdmin,
  bannerUpload.fields([{ name: "homepage_banner_image_file", maxCount: 1 }]),
  async (req, res) => {
    const settingsToUpdate = req.body;
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      if (req.files && req.files.homepage_banner_image_file) {
        const imageFile = req.files.homepage_banner_image_file[0];
        settingsToUpdate.homepage_banner_image_url = `/uploads/banners/${imageFile.filename}`; // public 폴더 기준 상대 경로
      }

      for (const key in settingsToUpdate) {
        if (key === "homepage_banner_image_file") continue; // 파일 필드명은 직접 저장 안 함
        if (Object.hasOwnProperty.call(settingsToUpdate, key)) {
          let valueToStore = settingsToUpdate[key];
          if (typeof valueToStore === "object" || Array.isArray(valueToStore))
            valueToStore = JSON.stringify(valueToStore);
          await conn.query(
            "INSERT INTO appr_admin_settings (setting_key, setting_value, updated_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()",
            [key, valueToStore]
          );
        }
      }
      await conn.commit();
      // 업데이트된 이미지 URL 반환 (클라이언트 미리보기 업데이트용)
      const newImageUrl = settingsToUpdate.homepage_banner_image_url;
      res.json({
        success: true,
        message: "홈페이지 설정이 업데이트되었습니다.",
        newImageUrl: newImageUrl,
      });
    } catch (error) {
      if (conn) await conn.rollback();
      console.error("Admin 홈페이지 설정 업데이트 오류:", error);
      if (
        error instanceof multer.MulterError ||
        (error.message &&
          error.message.includes("이미지 파일만 업로드 가능합니다"))
      ) {
        return res.status(400).json({
          success: false,
          message: `파일 업로드 오류: ${error.message}`,
        });
      }
      res
        .status(500)
        .json({ success: false, message: "설정 업데이트 중 오류 발생" });
    } finally {
      if (conn) conn.release();
    }
  }
);

// GET /api/appr-admin/users (회원 목록 조회)
router.get("/users", isAuthenticated, isAdmin, async (req, res) => {
  const {
    search_type,
    search_keyword,
    tier_filter,
    page = 1,
    limit = 10,
  } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  let conn;
  try {
    conn = await pool.getConnection();
    let baseQuery = `SELECT u.id, u.name, u.email, u.phone, u.created_at as join_date, um.tier, um.quick_link_allowance, u.is_active FROM users u LEFT JOIN user_memberships um ON u.id = um.user_id`;
    let countQuery = `SELECT COUNT(DISTINCT u.id) as totalItems FROM users u LEFT JOIN user_memberships um ON u.id = um.user_id`;
    let conditions = ["u.id != 'admin'"];
    let params = [];
    let countParams = [];

    if (search_keyword) {
      const keywordParam = `%${search_keyword}%`;
      if (search_type === "id") {
        conditions.push("u.id LIKE ?");
        params.push(keywordParam);
        countParams.push(keywordParam);
      } else if (search_type === "name") {
        conditions.push("u.name LIKE ?");
        params.push(keywordParam);
        countParams.push(keywordParam);
      } else if (search_type === "email") {
        conditions.push("u.email LIKE ?");
        params.push(keywordParam);
        countParams.push(keywordParam);
      } else if (search_type === "phone") {
        conditions.push("u.phone LIKE ?");
        params.push(keywordParam);
        countParams.push(keywordParam);
      }
    }
    if (tier_filter) {
      conditions.push("um.tier = ?");
      params.push(tier_filter);
      countParams.push(tier_filter);
    }

    if (conditions.length > 0) {
      baseQuery += " WHERE " + conditions.join(" AND ");
      countQuery += " WHERE " + conditions.join(" AND ");
    }
    baseQuery += " ORDER BY u.created_at DESC LIMIT ? OFFSET ?";
    params.push(parseInt(limit), offset);

    const [users] = await conn.query(baseQuery, params);
    const [totalResult] = await conn.query(countQuery, countParams);
    const totalItems = totalResult[0].totalItems;
    const totalPages = Math.ceil(totalItems / parseInt(limit));
    res.json({
      success: true,
      users,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems,
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Admin 회원 목록 조회 오류:", error);
    res
      .status(500)
      .json({ success: false, message: "회원 목록 조회 중 오류 발생" });
  } finally {
    if (conn) conn.release();
  }
});

// PUT /api/appr-admin/users/:userId (특정 회원 정보 업데이트)
router.put("/users/:userId", isAuthenticated, isAdmin, async (req, res) => {
  const { userId } = req.params;
  const { tier, quick_link_allowance_adjustment, is_active } = req.body;
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    if (is_active !== undefined)
      await conn.query("UPDATE users SET is_active = ? WHERE id = ?", [
        is_active,
        userId,
      ]);
    if (tier) {
      let newAllowance = 0;
      let newMonthlyLimit = 0;
      let newExpiresAt = null;
      let newAllowanceType = "monthly_free";
      if (tier === "까사트레이드 회원") {
        newAllowance = 10;
        newMonthlyLimit = 10;
      } else if (tier === "제휴사 회원") {
        newAllowance = 5;
        newMonthlyLimit = 5;
      } else if (tier === "일반회원") {
        newAllowance = 0;
        newMonthlyLimit = 0;
        newAllowanceType = null;
      }
      const [existingMembership] = await conn.query(
        "SELECT user_id FROM user_memberships WHERE user_id = ?",
        [userId]
      );
      if (existingMembership.length > 0) {
        await conn.query(
          "UPDATE user_memberships SET tier = ?, quick_link_allowance = ?, quick_link_monthly_limit = ?, subscription_expires_at = ?, quick_link_allowance_type = ?, last_reset_date_for_monthly_allowance = IF(? IN ('까사트레이드 회원', '제휴사 회원'), CURDATE(), NULL), updated_at = NOW() WHERE user_id = ?",
          [
            tier,
            newAllowance,
            newMonthlyLimit,
            newExpiresAt,
            newAllowanceType,
            tier,
            userId,
          ]
        );
      } else {
        await conn.query(
          "INSERT INTO user_memberships (user_id, tier, quick_link_allowance, quick_link_monthly_limit, subscription_expires_at, quick_link_allowance_type, last_reset_date_for_monthly_allowance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, IF(? IN ('까사트레이드 회원', '제휴사 회원'), CURDATE(), NULL), NOW(), NOW())",
          [
            userId,
            tier,
            newAllowance,
            newMonthlyLimit,
            newExpiresAt,
            newAllowanceType,
            tier,
          ]
        );
      }
      await conn.query(
        "INSERT INTO credit_transactions (id, user_id, transaction_type, amount, balance_after_transaction, description, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())",
        [
          uuidv4(),
          userId,
          "admin_adjustment",
          0,
          newAllowance,
          `관리자 등급 변경: ${tier}`,
        ]
      );
    }
    if (
      quick_link_allowance_adjustment &&
      !isNaN(parseInt(quick_link_allowance_adjustment))
    ) {
      const adjustmentAmount = parseInt(quick_link_allowance_adjustment);
      const [currentMembershipResult] = await conn.query(
        "SELECT quick_link_allowance FROM user_memberships WHERE user_id = ?",
        [userId]
      );
      if (currentMembershipResult.length === 0 && adjustmentAmount > 0) {
        // 멤버십 레코드 없으면 생성 (일반회원 기본으로)
        await conn.query(
          "INSERT INTO user_memberships (user_id, tier, quick_link_allowance, quick_link_monthly_limit, quick_link_allowance_type, created_at, updated_at) VALUES (?, '일반회원', 0, 0, NULL, NOW(), NOW())",
          [userId]
        );
      }
      // 다시 조회 또는 위에서 생성된 값 사용
      const [membershipForCredit] = await conn.query(
        "SELECT quick_link_allowance FROM user_memberships WHERE user_id = ?",
        [userId]
      );
      const currentAllowance =
        membershipForCredit.length > 0
          ? membershipForCredit[0].quick_link_allowance
          : 0;

      const newTotalAllowance = Math.max(
        0,
        currentAllowance + adjustmentAmount
      );
      await conn.query(
        "UPDATE user_memberships SET quick_link_allowance = ? WHERE user_id = ?",
        [newTotalAllowance, userId]
      );
      await conn.query(
        "INSERT INTO credit_transactions (id, user_id, transaction_type, amount, balance_after_transaction, description, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())",
        [
          uuidv4(),
          userId,
          "admin_adjustment",
          adjustmentAmount,
          newTotalAllowance,
          `관리자 퀵링크 크레딧 조정: ${
            adjustmentAmount > 0 ? "+" : ""
          }${adjustmentAmount}`,
        ]
      );
    }
    await conn.commit();
    res.json({
      success: true,
      message: `회원 ${userId} 정보가 업데이트되었습니다.`,
    });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("Admin 회원 정보 업데이트 오류:", error);
    res
      .status(500)
      .json({ success: false, message: "회원 정보 업데이트 중 오류 발생" });
  } finally {
    if (conn) conn.release();
  }
});

// GET /api/appr-admin/appraisals (관리자: 감정 목록 조회)
router.get("/appraisals", isAuthenticated, isAdmin, async (req, res) => {
  const {
    status: queryStatus,
    appraisal_type,
    search_keyword,
    search_field,
    page = 1,
    limit = 10,
  } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  let conn;
  try {
    conn = await pool.getConnection();
    let sql = `SELECT a.id, a.brand, a.model_name, a.appraisal_type, a.status, a.result, a.created_at, u.name as user_name, u.id as user_id_display, JSON_UNQUOTE(JSON_EXTRACT(a.images, '$[0]')) as representative_image FROM appraisals a JOIN users u ON a.user_id = u.id`;
    let countSql = `SELECT COUNT(a.id) as totalItems FROM appraisals a JOIN users u ON a.user_id = u.id`;
    const conditions = [];
    let params = [];
    let countParams = [];

    if (queryStatus) {
      conditions.push("a.status = ?");
      params.push(queryStatus);
      countParams.push(queryStatus);
    }
    if (appraisal_type) {
      conditions.push("a.appraisal_type = ?");
      params.push(appraisal_type);
      countParams.push(appraisal_type);
    }
    if (search_keyword && search_field) {
      const keywordParam = `%${search_keyword}%`;
      if (search_field === "appraisal_id") {
        conditions.push("a.id LIKE ?");
        params.push(keywordParam);
        countParams.push(keywordParam);
      } else if (search_field === "user_id_display") {
        conditions.push("u.id LIKE ?");
        params.push(keywordParam);
        countParams.push(keywordParam);
      } // u.id로 검색
      else if (search_field === "user_name") {
        conditions.push("u.name LIKE ?");
        params.push(keywordParam);
        countParams.push(keywordParam);
      } else if (search_field === "brand_model") {
        conditions.push("(a.brand LIKE ? OR a.model_name LIKE ?)");
        params.push(keywordParam, keywordParam); // 파라미터 두 번 추가
        countParams.push(keywordParam, keywordParam);
      }
    }
    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
      countSql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY a.created_at DESC LIMIT ? OFFSET ?";
    params.push(parseInt(limit), offset);

    const [appraisals] = await conn.query(sql, params);
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
    console.error("Admin 감정 목록 조회 오류:", error);
    res
      .status(500)
      .json({ success: false, message: "관리자 감정 목록 조회 중 오류 발생" });
  } finally {
    if (conn) conn.release();
  }
});

// PUT /api/appr-admin/appraisals/:appraisalId/result (관리자: 특정 감정 결과 업데이트)
// 이 API는 기존 /api/appr/appraisals/:appraisalId/result 와 동일한 로직을 수행합니다.
// 중복을 피하기 위해 해당 라우트를 그대로 사용하거나, 여기에 동일 로직을 복사할 수 있습니다.
// 여기서는 appraisal.js의 해당 라우트를 호출하도록 유도하거나, 동일 로직을 가져옵니다.
// (appraisal.js에 이미 isAdmin 미들웨어로 보호된 API가 있으므로 그것을 사용하는 것이 좋습니다.)
// 만약 별도로 여기에 구현한다면, appraisal.js의 해당 PUT 라우트 코드를 여기에 복사/붙여넣기 합니다.
// 여기서는 중복을 피하기 위해 해당 API 호출을 안내하는 메시지로 대체합니다.
// router.put('/appraisals/:appraisalId/result', isAuthenticated, isAdmin, async (req, res) => {
//   res.status(501).json({ success: false, message: "이 기능은 /api/appr/appraisals/:appraisalId/result 를 사용하세요."});
// });
// 위처럼 하는 대신, appraisal.js의 해당 라우트 로직을 여기에 그대로 가져와도 됩니다.
// (이전 답변의 appraisal.js에 있는 PUT /:appraisalId/result 로직을 여기에 복사)
router.put(
  "/appraisals/:appraisalId/result",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    const { appraisalId } = req.params;
    const { status, result, result_notes, appraiser_id } = req.body;
    if (!status || (status === "completed" && (!result || !result_notes))) {
      return res.status(400).json({
        success: false,
        message: "필수 정보(상태, 또는 완료 시 결과 및 노트) 누락",
      });
    }
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [appraisalRows] = await conn.query(
        "SELECT user_id, appraisal_type FROM appraisals WHERE id = ?",
        [appraisalId]
      );
      if (appraisalRows.length === 0) {
        await conn.rollback();
        return res
          .status(404)
          .json({ success: false, message: "감정 ID를 찾을 수 없습니다." });
      }
      const appraisalToUpdate = appraisalRows[0];

      if (
        appraisalToUpdate.appraisal_type === "quicklink" &&
        (result === "authentic" || result === "fake")
      ) {
        const [membershipRows] = await conn.query(
          "SELECT quick_link_allowance FROM user_memberships WHERE user_id = ?",
          [appraisalToUpdate.user_id]
        );
        if (
          membershipRows.length > 0 &&
          membershipRows[0].quick_link_allowance > 0
        ) {
          await conn.query(
            "UPDATE user_memberships SET quick_link_allowance = quick_link_allowance - 1, updated_at = NOW() WHERE user_id = ?",
            [appraisalToUpdate.user_id]
          );
          await conn.query(
            "INSERT INTO credit_transactions (id, user_id, transaction_type, amount, balance_after_transaction, description, related_appraisal_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())",
            [
              uuidv4(),
              appraisalToUpdate.user_id,
              "usage_quicklink_free",
              -1,
              membershipRows[0].quick_link_allowance - 1,
              `퀵링크 감정 사용 (ID: ${appraisalId})`,
              appraisalId,
            ]
          );
        } else {
          console.warn(
            `사용자 ${appraisalToUpdate.user_id}의 퀵링크 크레딧이 부족하지만 결과가 입력되었습니다. (감정ID: ${appraisalId})`
          );
        }
      }

      let appraisedAtField = "";
      const updateParams = [status];
      if (status === "completed") {
        appraisedAtField = ", appraised_at = NOW()";
        updateParams.push(result, result_notes);
      }
      updateParams.push(appraiser_id || req.session.user.id);
      updateParams.push(appraisalId);
      const sql = `UPDATE appraisals SET status = ? ${
        status === "completed" ? ", result = ?, result_notes = ?" : ""
      } ${appraisedAtField}, appraiser_id = ?, updated_at = NOW() WHERE id = ?`;
      await conn.query(sql, updateParams);
      await conn.commit();

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
      if (conn) await conn.rollback();
      console.error("감정 결과 업데이트 오류:", error);
      res
        .status(500)
        .json({ success: false, message: "감정 결과 업데이트 중 오류 발생" });
    } finally {
      if (conn) conn.release();
    }
  }
);

module.exports = router;
