// routes/admin.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");
const { pool } = require("../utils/DB");
const {
  getAdminSettings,
  updateAdminSettings,
  getNotices,
  getNoticeById,
  addNotice,
  updateNotice,
  deleteNotice,
} = require("../utils/adminDB");
const {
  getFilterSettings,
  updateFilterSetting,
  initializeFilterSettings,
  syncFilterSettingsToItems,
  getRecommendSettings,
  addRecommendSetting,
  updateRecommendSetting,
  updateRecommendSettingsBatch,
  deleteRecommendSetting,
  syncRecommendSettingsToItems,
} = require("../utils/dataUtils");
const DBManager = require("../utils/DBManager");
const { isAdminUser, requireAdmin } = require("../utils/adminAuth");
const { ensureAdminActivityTable } = require("../utils/adminActivityLogger");
const {
  ADMIN_MENU_KEYS,
  isSuperAdminUser,
  parseAllowedMenus,
  sanitizeAllowedMenus,
  ensureAdminPermissionTable,
} = require("../utils/adminAccess");
const {
  createWorkbook,
  streamWorkbookToResponse,
  formatDateForExcel,
  formatNumberForExcel,
} = require("../utils/excel");
const { calculateTotalPrice } = require("../utils/calculate-fee");
const { getExchangeRate } = require("../utils/exchange-rate");

// Middleware to check if user is admin
const isAdmin = requireAdmin;

function requireSuperAdmin(req, res, next) {
  if (isSuperAdminUser(req.session?.user)) return next();
  return res.status(403).json({
    success: false,
    message: "?�퍼?�드�?권한???�요?�니??",
    code: "FORBIDDEN_SUPERADMIN",
  });
}

// Multer configuration for image uploads
const logoStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "public/images/");
  },
  filename: function (req, file, cb) {
    cb(null, "logo.png");
  },
});

const uploadLogo = multer({ storage: logoStorage });

// Multer configuration for notice image uploads
const noticeImageStorage = multer.memoryStorage();
const uploadNoticeImage = multer({
  storage: noticeImageStorage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Please upload an image."), false);
    }
  },
});

// guide.html???�한 multer ?�정
const guideStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "pages/");
  },
  filename: function (req, file, cb) {
    cb(null, "guide.html");
  },
});

const uploadGuide = multer({
  storage: guideStorage,
  fileFilter: (req, file, cb) => {
    // HTML ?�일�??�용
    if (file.mimetype === "text/html") {
      cb(null, true);
    } else {
      cb(new Error("HTML ?�일�??�로??가?�합?�다."), false);
    }
  },
});

// inquiry.html???�한 multer ?�정 추�?
const inquiryStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "pages/");
  },
  filename: function (req, file, cb) {
    cb(null, "inquiry.html");
  },
});

const uploadInquiry = multer({
  storage: inquiryStorage,
  fileFilter: (req, file, cb) => {
    // HTML ?�일�??�용
    if (file.mimetype === "text/html") {
      cb(null, true);
    } else {
      cb(new Error("HTML ?�일�??�로??가?�합?�다."), false);
    }
  },
});

const bidGuideStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "pages/");
  },
  filename: function (req, file, cb) {
    cb(null, "bid-guide.html");
  },
});

const uploadBidGuide = multer({
  storage: bidGuideStorage,
  fileFilter: (req, file, cb) => {
    // HTML ?�일�??�용
    if (file.mimetype === "text/html") {
      cb(null, true);
    } else {
      cb(new Error("HTML ?�일�??�로??가?�합?�다."), false);
    }
  },
});

// guide.html ?�로???�우??
router.post(
  "/upload-guide",
  isAdmin,
  uploadGuide.single("guide"),
  (req, res) => {
    if (req.file) {
      res.json({ message: "guide.html???�공?�으�??�로?�되?�습?�다." });
    } else {
      res.status(400).json({ message: "guide.html ?�로?�에 ?�패?�습?�다." });
    }
  },
);

// inquiry.html ?�로???�우??추�?
router.post(
  "/upload-inquiry",
  isAdmin,
  uploadInquiry.single("inquiry"),
  (req, res) => {
    if (req.file) {
      res.json({ message: "inquiry.html???�공?�으�??�로?�되?�습?�다." });
    } else {
      res.status(400).json({ message: "inquiry.html ?�로?�에 ?�패?�습?�다." });
    }
  },
);

// bid-guide.html ?�로???�우??
router.post(
  "/upload-bid-guide",
  isAdmin,
  uploadBidGuide.single("bidGuide"),
  (req, res) => {
    if (req.file) {
      res.json({ message: "bid-guide.html???�공?�으�??�로?�되?�습?�다." });
    } else {
      res
        .status(400)
        .json({ message: "bid-guide.html ?�로?�에 ?�패?�습?�다." });
    }
  },
);

// ?�라?�언??�?공�??�항 조회 API (?�근 ?�한 ?�음)
router.get("/public/notices", async (req, res) => {
  try {
    const notices = await getNotices();
    res.json(notices);
  } catch (error) {
    console.error("Error getting public notices:", error);
    res.status(500).json({ message: "Error getting notices" });
  }
});

// ?�정 공�??�항 조회 API (?�근 ?�한 ?�음)
router.get("/public/notices/:id", async (req, res) => {
  try {
    const notice = await getNoticeById(req.params.id);
    if (notice) {
      res.json(notice);
    } else {
      res.status(404).json({ message: "Notice not found" });
    }
  } catch (error) {
    console.error("Error getting notice:", error);
    res.status(500).json({ message: "Error getting notice" });
  }
});

router.get("/check-status", async (req, res) => {
  res.json({ isAdmin: isAdminUser(req.session?.user) });
});

router.get("/me/access", isAdmin, async (req, res) => {
  try {
    await ensureAdminPermissionTable(pool);
    const user = req.session?.user || {};
    const isSuper = isSuperAdminUser(user);
    const allowedMenus = isSuper ? ADMIN_MENU_KEYS : parseAllowedMenus(user.allowed_menus);
    return res.json({
      isAdmin: true,
      isSuperAdmin: isSuper,
      allowedMenus,
      menuKeys: ADMIN_MENU_KEYS,
    });
  } catch (error) {
    console.error("?�근 권한 조회 ?�류:", error);
    return res.status(500).json({ message: "?�근 권한 조회 ?�패" });
  }
});

router.get("/admin-accounts", isAdmin, requireSuperAdmin, async (req, res) => {
  let conn;
  try {
    await ensureAdminPermissionTable(pool);
    conn = await pool.getConnection();

    const [rows] = await conn.query(
      `
      SELECT
        u.id,
        u.login_id,
        u.company_name,
        u.is_active,
        u.created_at,
        ap.is_superadmin,
        ap.allowed_menus
      FROM users u
      LEFT JOIN admin_panel_permissions ap ON ap.user_id = u.id
      WHERE u.login_id = 'admin' OR ap.user_id IS NOT NULL
      ORDER BY (u.login_id = 'admin') DESC, u.login_id ASC
      `,
    );

    return res.json({
      accounts: (rows || []).map((r) => ({
        ...r,
        allowedMenus: Number(r.is_superadmin || 0) === 1 ? ADMIN_MENU_KEYS : parseAllowedMenus(r.allowed_menus),
      })),
      menuKeys: ADMIN_MENU_KEYS,
    });
  } catch (error) {
    console.error("관리자 계정 목록 조회 ?�류:", error);
    return res.status(500).json({ message: "관리자 계정 목록 조회 ?�패" });
  } finally {
    if (conn) conn.release();
  }
});

router.post("/admin-accounts", isAdmin, requireSuperAdmin, async (req, res) => {
  let conn;
  try {
    await ensureAdminPermissionTable(pool);
    const { loginId, password, name, allowedMenus = [] } = req.body || {};
    const safeLoginId = String(loginId || "").trim();
    const safePassword = String(password || "").trim();
    const safeName = String(name || "").trim();

    if (!safeLoginId || !safePassword) {
      return res.status(400).json({ message: "?�이??비�?번호???�수?�니??" });
    }
    if (!safeLoginId.startsWith("admin")) {
      return res.status(400).json({ message: "관리자 ?�이?�는 admin?�로 ?�작?�야 ?�니??" });
    }

    conn = await pool.getConnection();
    const crypto = require("crypto");
    const hashedPassword = crypto.createHash("sha256").update(safePassword).digest("hex");
    const menus = sanitizeAllowedMenus(allowedMenus);

    await conn.beginTransaction();

    const [exists] = await conn.query("SELECT id FROM users WHERE login_id = ? LIMIT 1", [safeLoginId]);
    let userId;
    if (exists.length > 0) {
      userId = exists[0].id;
      await conn.query(
        "UPDATE users SET password = ?, company_name = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [hashedPassword, safeName || safeLoginId, userId],
      );
    } else {
      const [ins] = await conn.query(
        `INSERT INTO users
         (login_id, registration_date, password, company_name, is_active, commission_rate, role)
         VALUES (?, CURDATE(), ?, ?, 1, 0, 'normal')`,
        [safeLoginId, hashedPassword, safeName || safeLoginId],
      );
      userId = ins.insertId;
    }

    await conn.query(
      `INSERT INTO admin_panel_permissions (user_id, is_superadmin, allowed_menus)
       VALUES (?, 0, ?)
       ON DUPLICATE KEY UPDATE is_superadmin = 0, allowed_menus = VALUES(allowed_menus), updated_at = CURRENT_TIMESTAMP`,
      [userId, JSON.stringify(menus)],
    );

    await conn.commit();
    return res.json({ success: true, message: "관리자 계정 ?�성 ?�료" });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("관리자 계정 ?�성 ?�류:", error);
    return res.status(500).json({ message: "관리자 계정 ?�성 ?�패" });
  } finally {
    if (conn) conn.release();
  }
});

router.put("/admin-accounts/:userId/permissions", isAdmin, requireSuperAdmin, async (req, res) => {
  let conn;
  try {
    await ensureAdminPermissionTable(pool);
    const userId = Number(req.params.userId);
    if (!userId) return res.status(400).json({ message: "?�효?��? ?��? ?�용?�입?�다." });

    conn = await pool.getConnection();
    const [users] = await conn.query("SELECT login_id FROM users WHERE id = ? LIMIT 1", [userId]);
    if (!users.length) return res.status(404).json({ message: "?�용?��? 찾을 ???�습?�다." });
    if (String(users[0].login_id).toLowerCase() === "admin") {
      return res.status(400).json({ message: "superadmin 권한?� ?�정?????�습?�다." });
    }

    const menus = sanitizeAllowedMenus(req.body?.allowedMenus || []);
    await conn.query(
      `INSERT INTO admin_panel_permissions (user_id, is_superadmin, allowed_menus)
       VALUES (?, 0, ?)
       ON DUPLICATE KEY UPDATE allowed_menus = VALUES(allowed_menus), is_superadmin = 0, updated_at = CURRENT_TIMESTAMP`,
      [userId, JSON.stringify(menus)],
    );
    return res.json({ success: true, message: "권한 ?�???�료" });
  } catch (error) {
    console.error("관리자 권한 ?�???�류:", error);
    return res.status(500).json({ message: "권한 ?�???�패" });
  } finally {
    if (conn) conn.release();
  }
});

router.put("/admin-accounts/:userId/password", isAdmin, requireSuperAdmin, async (req, res) => {
  let conn;
  try {
    const userId = Number(req.params.userId);
    const password = String(req.body?.password || "").trim();
    if (!userId || !password) return res.status(400).json({ message: "?�청값이 ?�바르�? ?�습?�다." });

    conn = await pool.getConnection();
    const [users] = await conn.query("SELECT login_id FROM users WHERE id = ? LIMIT 1", [userId]);
    if (!users.length) return res.status(404).json({ message: "?�용?��? 찾을 ???�습?�다." });
    if (String(users[0].login_id).toLowerCase() === "admin") {
      return res.status(400).json({ message: "superadmin 비�?번호???�기??변경할 ???�습?�다." });
    }

    const crypto = require("crypto");
    const hashedPassword = crypto.createHash("sha256").update(password).digest("hex");
    await conn.query("UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [hashedPassword, userId]);
    return res.json({ success: true, message: "비�?번호 변�??�료" });
  } catch (error) {
    console.error("관리자 비�?번호 변�??�류:", error);
    return res.status(500).json({ message: "비�?번호 변�??�패" });
  } finally {
    if (conn) conn.release();
  }
});

router.delete("/admin-accounts/:userId", isAdmin, requireSuperAdmin, async (req, res) => {
  let conn;
  try {
    const userId = Number(req.params.userId);
    if (!userId) return res.status(400).json({ message: "?�효?��? ?��? ?�용?�입?�다." });

    conn = await pool.getConnection();
    const [users] = await conn.query("SELECT login_id FROM users WHERE id = ? LIMIT 1", [userId]);
    if (!users.length) return res.status(404).json({ message: "?�용?��? 찾을 ???�습?�다." });
    if (String(users[0].login_id).toLowerCase() === "admin") {
      return res.status(400).json({ message: "superadmin 계정?� ??��?????�습?�다." });
    }

    await conn.beginTransaction();
    await conn.query("DELETE FROM admin_panel_permissions WHERE user_id = ?", [userId]);
    await conn.query("DELETE FROM users WHERE id = ?", [userId]);
    await conn.commit();

    return res.json({ success: true, message: "관리자 계정 ??�� ?�료" });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("관리자 계정 ??�� ?�류:", error);
    return res.status(500).json({ message: "관리자 계정 ??�� ?�패" });
  } finally {
    if (conn) conn.release();
  }
});

router.get("/activity-logs", isAdmin, async (req, res) => {
  let conn;
  try {
    await ensureAdminActivityTable();
    conn = await pool.getConnection();

    const {
      actor = "",
      method = "",
      path = "",
      menu = "",
      action = "",
      dateFrom = "",
      dateTo = "",
      page = 1,
      limit = 50,
    } = req.query;

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const safePage = Math.max(parseInt(page, 10) || 1, 1);
    const offset = (safePage - 1) * safeLimit;

    const where = ["1=1"];
    const params = [];

    if (actor) {
      where.push("(actor_login_id LIKE ? OR actor_name LIKE ?)");
      params.push(`%${actor}%`, `%${actor}%`);
    }
    if (method) {
      where.push("action_method = ?");
      params.push(String(method).toUpperCase());
    }
    if (path) {
      where.push("action_path LIKE ?");
      params.push(`%${path}%`);
    }
    if (menu) {
      where.push("action_menu LIKE ?");
      params.push(`%${menu}%`);
    }
    if (action) {
      where.push("(action_title LIKE ? OR action_summary LIKE ? OR action_label LIKE ?)");
      params.push(`%${action}%`, `%${action}%`, `%${action}%`);
    }
    if (dateFrom) {
      where.push("DATE(created_at) >= DATE(?)");
      params.push(dateFrom);
    }
    if (dateTo) {
      where.push("DATE(created_at) <= DATE(?)");
      params.push(dateTo);
    }

    const whereSql = where.join(" AND ");
    const [rows] = await conn.query(
      `
      SELECT
        id, actor_user_id, actor_login_id, actor_name, actor_role,
        action_method, action_path, action_menu, action_title, action_summary, action_label, target_type, target_id,
        ip_address, user_agent, http_status, detail_json, created_at
      FROM admin_activity_logs
      WHERE ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, safeLimit, offset],
    );
    const [countRows] = await conn.query(
      `SELECT COUNT(*) AS total FROM admin_activity_logs WHERE ${whereSql}`,
      params,
    );

    res.json({
      logs: rows || [],
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: Number(countRows?.[0]?.total || 0),
      },
    });
  } catch (error) {
    console.error("관리자 ?�동로그 조회 ?�류:", error);
    res.status(500).json({ message: "?�동로그 조회 �??�류가 발생?�습?�다." });
  } finally {
    if (conn) conn.release();
  }
});

// Route to upload logo
router.post("/upload-logo", isAdmin, uploadLogo.single("logo"), (req, res) => {
  if (req.file) {
    res.json({ message: "Logo uploaded successfully" });
  } else {
    res.status(400).json({ message: "Logo upload failed" });
  }
});

// Route to get admin settings
router.get("/settings", async (req, res) => {
  try {
    const settings = await getAdminSettings();
    res.json(settings);
  } catch (error) {
    console.error("Error getting admin settings:", error);
    res.status(500).json({ message: "Error getting admin settings" });
  }
});

router.post("/settings", isAdmin, async (req, res) => {
  try {
    const settings = {};
    if (req.body.crawlSchedule !== undefined)
      settings.crawlSchedule = req.body.crawlSchedule;
    if (req.body.requireLoginForFeatures !== undefined)
      settings.requireLoginForFeatures = req.body.requireLoginForFeatures;

    await updateAdminSettings(settings);
    res.json({ message: "Settings updated successfully" });
  } catch (error) {
    console.error("Error updating admin settings:", error);
    res.status(500).json({ message: "Error updating admin settings" });
  }
});

// Updated routes for notice board functionality
router.get("/notices", async (req, res) => {
  try {
    const notices = await getNotices();
    res.json(notices);
  } catch (error) {
    console.error("Error getting notices:", error);
    res.status(500).json({ message: "Error getting notices" });
  }
});

router.get("/notices/:id", async (req, res) => {
  try {
    const notice = await getNoticeById(req.params.id);
    if (notice) {
      res.json(notice);
    } else {
      res.status(404).json({ message: "Notice not found" });
    }
  } catch (error) {
    console.error("Error getting notice:", error);
    res.status(500).json({ message: "Error getting notice" });
  }
});

// ?��?지-URL 기반 공�? ?�스?�을 ?�한 ?�정???�우?�들
router.post(
  "/notices",
  isAdmin,
  uploadNoticeImage.single("image"),
  async (req, res) => {
    try {
      const { title, targetUrl } = req.body;

      // ?�목�??��?지 ?�수 검�?
      if (!title) {
        return res.status(400).json({ message: "Title is required" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "Image is required" });
      }

      // ?��?지 처리
      const uniqueSuffix = Date.now() + "-" + uuidv4();
      const filename = `notice-${uniqueSuffix}.webp`;
      const outputPath = path.join(
        __dirname,
        "../public/images/notices",
        filename,
      );

      await sharp(req.file.buffer).webp({ quality: 100 }).toFile(outputPath);

      const imageUrl = `/images/notices/${filename}`;

      // 공�??�항 ?�??
      const newNotice = await addNotice(title, imageUrl, targetUrl || null);
      res.status(201).json(newNotice);
    } catch (error) {
      console.error("Error adding notice:", error);
      res.status(500).json({ message: "Error adding notice" });
    }
  },
);

router.put(
  "/notices/:id",
  isAdmin,
  uploadNoticeImage.single("image"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { title, targetUrl, keepExistingImage } = req.body;

      // ?�목 ?�수 검�?
      if (!title) {
        return res.status(400).json({ message: "Title is required" });
      }

      let imageUrl;

      // ???��?지가 ?�로?�된 경우
      if (req.file) {
        const uniqueSuffix = Date.now() + "-" + uuidv4();
        const filename = `notice-${uniqueSuffix}.webp`;
        const outputPath = path.join(
          __dirname,
          "../public/images/notices",
          filename,
        );

        await sharp(req.file.buffer).webp({ quality: 100 }).toFile(outputPath);

        imageUrl = `/images/notices/${filename}`;
      }
      // 기존 ?��?지 ?��??�는 경우
      else if (keepExistingImage === "true") {
        const existingNotice = await getNoticeById(id);
        if (!existingNotice) {
          return res.status(404).json({ message: "Notice not found" });
        }
        imageUrl = existingNotice.imageUrl;
      }
      // ???��?지???�고 기존 ?��?지???��??��? ?�는 경우
      else {
        return res.status(400).json({ message: "Image is required" });
      }

      // 공�??�항 ?�데?�트
      const updatedNotice = await updateNotice(
        id,
        title,
        imageUrl,
        targetUrl || null,
      );
      if (!updatedNotice) {
        return res.status(404).json({ message: "Notice not found" });
      }
      res.json(updatedNotice);
    } catch (error) {
      console.error("Error updating notice:", error);
      res.status(500).json({ message: "Error updating notice" });
    }
  },
);

router.delete("/notices/:id", isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await deleteNotice(id);
    if (!result) {
      return res.status(404).json({ message: "Notice not found" });
    }
    res.json({ message: "Notice deleted successfully" });
  } catch (error) {
    console.error("Error deleting notice:", error);
    res.status(500).json({ message: "Error deleting notice" });
  }
});

// Filter Settings Routes
router.get("/filter-settings", async (req, res) => {
  try {
    const settings = await getFilterSettings();
    res.json(settings);
  } catch (error) {
    console.error("Error getting filter settings:", error);
    res.status(500).json({ message: "Error getting filter settings" });
  }
});

router.put("/filter-settings", isAdmin, async (req, res) => {
  try {
    const { filterType, filterValue, isEnabled } = req.body;

    if (!filterType || filterValue === undefined || isEnabled === undefined) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (!["date", "brand", "category"].includes(filterType)) {
      return res.status(400).json({ message: "Invalid filter type" });
    }

    const result = await updateFilterSetting(
      filterType,
      filterValue,
      isEnabled,
    );
    res.json(result);
  } catch (error) {
    console.error("Error updating filter setting:", error);
    res.status(500).json({ message: "Error updating filter setting" });
  }
});

// Route to initialize all filter settings
router.post("/filter-settings/initialize", isAdmin, async (req, res) => {
  try {
    await initializeFilterSettings();

    // 초기????즉시 ?�기??
    await syncFilterSettingsToItems();
    res.json({ message: "Filter settings initialized successfully" });
  } catch (error) {
    console.error("Error initializing filter settings:", error);
    res.status(500).json({ message: "Error initializing filter settings" });
  }
});

// Batch update filter settings
router.put("/filter-settings/batch", isAdmin, async (req, res) => {
  try {
    const { settings } = req.body;

    if (!Array.isArray(settings)) {
      return res.status(400).json({ message: "Settings must be an array" });
    }

    const results = [];
    for (const setting of settings) {
      const { filterType, filterValue, isEnabled } = setting;

      if (!filterType || filterValue === undefined || isEnabled === undefined) {
        continue;
      }

      if (!["date", "brand", "category"].includes(filterType)) {
        continue;
      }

      const result = await updateFilterSetting(
        filterType,
        filterValue,
        isEnabled,
      );
      results.push(result);
    }

    // 배치 ?�데?�트 ?�료 ??즉시 ?�기??
    await initializeFilterSettings();

    res.json({
      message: "Batch update completed",
      updated: results,
    });
  } catch (error) {
    console.error("Error performing batch update of filter settings:", error);
    res.status(500).json({ message: "Error updating filter settings" });
  }
});

// Recommendation Settings Routes

// 모든 추천 ?�정 조회
router.get("/recommend-settings", isAdmin, async (req, res) => {
  try {
    const settings = await getRecommendSettings();
    // conditions가 JSON 문자?�이므�??�싱?�서 보내줍니??
    const parsedSettings = settings.map((s) => ({
      ...s,
      conditions: JSON.parse(s.conditions),
    }));
    res.json(parsedSettings);
  } catch (error) {
    console.error("Error getting recommend settings:", error);
    res.status(500).json({ message: "Error getting recommend settings" });
  }
});

// ??추천 ?�정 추�?
router.post("/recommend-settings", isAdmin, async (req, res) => {
  try {
    const { ruleName, conditions, recommendScore } = req.body;

    if (!ruleName || !conditions || recommendScore === undefined) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const newSetting = await addRecommendSetting(
      ruleName,
      conditions,
      recommendScore,
    );

    // ??규칙 추�? ??즉시 ?�기??
    await syncRecommendSettingsToItems();

    res.status(201).json(newSetting);
  } catch (error) {
    console.error("Error adding recommend setting:", error);
    res.status(500).json({ message: "Error adding recommend setting" });
  }
});

// 배치 ?�데?�트 ?�우??
router.put("/recommend-settings/batch", isAdmin, async (req, res) => {
  try {
    const { settings } = req.body;

    const results = await updateRecommendSettingsBatch(settings);

    // 배치 ?�데?�트 ?�료 ??즉시 ?�기??
    await syncRecommendSettingsToItems();

    res.json({
      message: "Batch update completed",
      updated: results,
    });
  } catch (error) {
    console.error(
      "Error performing batch update of recommend settings:",
      error,
    );
    res.status(500).json({ message: "Error updating recommend settings" });
  }
});

// 기존 추천 ?�정 ?�데?�트
router.put("/recommend-settings/:id", isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { ruleName, conditions, recommendScore, isEnabled } = req.body;

    if (
      !ruleName ||
      !conditions ||
      recommendScore === undefined ||
      isEnabled === undefined
    ) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const updatedSetting = await updateRecommendSetting(
      id,
      ruleName,
      conditions,
      recommendScore,
      isEnabled,
    );

    // 규칙 ?�정 ??즉시 ?�기??
    await syncRecommendSettingsToItems();

    res.json(updatedSetting);
  } catch (error) {
    console.error("Error updating recommend setting:", error);
    res.status(500).json({ message: "Error updating recommend setting" });
  }
});

// 추천 ?�정 ??��
router.delete("/recommend-settings/:id", isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await deleteRecommendSetting(id);
    if (!result) {
      return res.status(404).json({ message: "Setting not found" });
    }

    // 규칙 ??�� ??즉시 ?�기??
    await syncRecommendSettingsToItems();

    res.json({ message: "Recommend setting deleted successfully" });
  } catch (error) {
    console.error("Error deleting recommend setting:", error);
    res.status(500).json({ message: "Error deleting recommend setting" });
  }
});

router.put("/values/:itemId/price", isAdmin, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { final_price } = req.body;

    // ?�력�?검�?
    if (!final_price || isNaN(parseFloat(final_price))) {
      return res.status(400).json({
        success: false,
        message: "?�효??가격을 ?�력?�주?�요",
      });
    }

    // 가�??�이???�데?�트
    await DBManager.updateItemDetails(
      itemId,
      {
        final_price: parseFloat(final_price).toFixed(2), // ?�수??2?�리까�? ?�??
      },
      "values_items",
    );

    res.json({
      success: true,
      message: "가격이 ?�공?�으�??�데?�트?�었?�니??,
    });
  } catch (error) {
    console.error("Error updating item price:", error);
    res.status(500).json({
      success: false,
      message: "가�??�데?�트 �??�류가 발생?�습?�다",
    });
  }
});

// 관리자 거래 ?�역 ?�이지 ?�더�?
router.get("/transactions", isAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "../pages/admin/transactions.html"));
});

// ?�보?�스 목록 조회
router.get("/invoices", isAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      auc_num,
      status,
      startDate,
      endDate,
    } = req.query;

    // ?�이지?� ?�한 검�?
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // 쿼리 매개변??
    const queryParams = [];

    // 기본 쿼리 구성
    let query = `
      SELECT 
        id, 
        date, 
        auc_num, 
        status, 
        amount
      FROM invoices
      WHERE 1=1
    `;

    // 경매???�터
    if (auc_num) {
      query += ` AND auc_num = ?`;
      queryParams.push(auc_num);
    }

    // ?�태 ?�터
    if (status) {
      query += ` AND status = ?`;
      queryParams.push(status);
    }

    // ?�짜 범위 ?�터
    if (startDate) {
      query += ` AND date >= ?`;
      queryParams.push(startDate);
    }

    if (endDate) {
      query += ` AND date <= ?`;
      queryParams.push(endDate);
    }

    // ?�짜???�렬 (최신??
    query += ` ORDER BY date DESC`;

    // ?�이지?�이??추�?
    query += ` LIMIT ? OFFSET ?`;
    queryParams.push(limitNum, offset);

    // �??�코????쿼리
    let countQuery = `
      SELECT COUNT(*) as total
      FROM invoices
      WHERE 1=1
    `;

    // ?�일???�터 조건 ?�용
    if (auc_num) {
      countQuery += ` AND auc_num = ?`;
    }
    if (status) {
      countQuery += ` AND status = ?`;
    }
    if (startDate) {
      countQuery += ` AND date >= ?`;
    }
    if (endDate) {
      countQuery += ` AND date <= ?`;
    }

    // 카운??쿼리???�용???�라미터 (LIMIT, OFFSET ?�외)
    const countParams = queryParams.slice(0, queryParams.length - 2);

    // DB ?�결 �?쿼리 ?�행
    const [rows] = await pool.query(query, queryParams);
    const [countResult] = await pool.query(countQuery, countParams);

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limitNum);

    res.json({
      invoices: rows,
      pagination: {
        total,
        totalPages,
        currentPage: pageNum,
        limit: limitNum,
      },
    });
  } catch (error) {
    console.error("Error fetching invoices:", error);
    res
      .status(500)
      .json({ message: "?�보?�스 목록??불러?�는 �??�류가 발생?�습?�다." });
  }
});

// =====================================================
// ?��? ?�보?�기 API
// =====================================================

/**
 * GET /api/admin/users-list
 * ?��? 목록 조회 (?��? ?�보?�기 ?�터??
 */
router.get("/users-list", isAdmin, async (req, res) => {
  try {
    const [users] = await pool.query(
      `SELECT id, login_id, company_name 
       FROM users 
       WHERE login_id != 'admin' 
       ORDER BY company_name ASC, login_id ASC`,
    );
    res.json(users);
  } catch (error) {
    console.error("Error fetching users list:", error);
    res.status(500).json({ message: "Error fetching users list" });
  }
});

// =====================================================
// ?�원 그룹 (member_groups, user_member_groups)
// =====================================================

const DEFAULT_MEMBER_GROUPS = ["artecasa", "doyakcasa"];
let memberGroupTablesReady = false;

async function ensureMemberGroupTables() {
  if (!memberGroupTablesReady) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS member_groups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_member_groups (
        user_id INT NOT NULL,
        group_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, group_id),
        KEY idx_umg_group_id (group_id),
        CONSTRAINT fk_umg_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_umg_group_id FOREIGN KEY (group_id) REFERENCES member_groups (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    memberGroupTablesReady = true;
  }

  for (let idx = 0; idx < DEFAULT_MEMBER_GROUPS.length; idx += 1) {
    const groupName = DEFAULT_MEMBER_GROUPS[idx];
    await pool.query(
      `
      INSERT INTO member_groups (name, sort_order)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE
        sort_order = VALUES(sort_order)
      `,
      [groupName, idx + 1],
    );
  }
}

/** GET /api/admin/member-groups - 그룹 목록 */
router.get("/member-groups", isAdmin, async (req, res) => {
  try {
    await ensureMemberGroupTables();
    const [rows] = await pool.query(
      "SELECT id, name, sort_order, created_at FROM member_groups ORDER BY sort_order ASC, name ASC"
    );
    res.json(rows);
  } catch (error) {
    console.error("member-groups list error:", error);
    res.status(500).json({ message: "그룹 목록 조회 ?�패" });
  }
});

/** POST /api/admin/member-groups - 그룹 ?�성 */
router.post("/member-groups", isAdmin, async (req, res) => {
  try {
    await ensureMemberGroupTables();
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ message: "그룹명을 ?�력?�세??" });

    const [maxRows] = await pool.query(
      "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM member_groups"
    );
    const nextOrder = maxRows[0]?.next_order ?? 1;
    const [result] = await pool.query("INSERT INTO member_groups (name, sort_order) VALUES (?, ?)", [
      name,
      nextOrder,
    ]);
    const [rows] = await pool.query("SELECT id, name, sort_order, created_at FROM member_groups WHERE id = ?", [
      result.insertId,
    ]);
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY")
      return res.status(400).json({ message: "?��? 같�? ?�름??그룹???�습?�다." });
    console.error("member-groups create error:", error);
    res.status(500).json({ message: "그룹 ?�성 ?�패" });
  }
});

/** DELETE /api/admin/member-groups/:id - 그룹 ??�� */
router.delete("/member-groups/:id", isAdmin, async (req, res) => {
  try {
    await ensureMemberGroupTables();
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ message: "?�효?��? ?��? 그룹 ID?�니??" });

    const [result] = await pool.query("DELETE FROM member_groups WHERE id = ?", [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: "그룹??찾을 ???�습?�다." });
    res.json({ success: true });
  } catch (error) {
    console.error("member-groups delete error:", error);
    res.status(500).json({ message: "그룹 ??�� ?�패" });
  }
});

/** GET /api/admin/member-groups/:id/members - 그룹 ?�속 ?�원 목록 (users ?�보 ?�함) */
router.get("/member-groups/:id/members", isAdmin, async (req, res) => {
  try {
    await ensureMemberGroupTables();
    const groupId = parseInt(req.params.id, 10);
    if (!groupId) return res.status(400).json({ message: "?�효?��? ?��? 그룹 ID?�니??" });

    const [rows] = await pool.query(
      `SELECT u.id, u.login_id, u.company_name, u.registration_date, u.is_active,
              COALESCE(bt.total_bid_count, 0) AS total_bid_count,
              COALESCE(bt.total_bid_jpy, 0) AS total_bid_jpy,
              lb.last_bid_at
       FROM user_member_groups umg
       JOIN users u ON u.id = umg.user_id
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS total_bid_count, COALESCE(SUM(amount_jpy), 0) AS total_bid_jpy
         FROM (
           SELECT user_id, COALESCE(CAST(REPLACE(COALESCE(winning_price,final_price,second_price,first_price), ',', '') AS DECIMAL(18,2)), 0) AS amount_jpy
           FROM live_bids WHERE user_id IS NOT NULL AND status = 'completed'
           UNION ALL
           SELECT user_id, COALESCE(CAST(REPLACE(COALESCE(winning_price,current_price), ',', '') AS DECIMAL(18,2)), 0) AS amount_jpy
           FROM direct_bids WHERE user_id IS NOT NULL AND status = 'completed'
         ) t GROUP BY user_id
       ) bt ON bt.user_id = u.id
       LEFT JOIN (
         SELECT user_id, MAX(bid_at) AS last_bid_at FROM (
           SELECT user_id, created_at AS bid_at FROM live_bids WHERE user_id IS NOT NULL
           UNION ALL SELECT user_id, created_at AS bid_at FROM direct_bids WHERE user_id IS NOT NULL
         ) t GROUP BY user_id
       ) lb ON lb.user_id = u.id
       WHERE umg.group_id = ?
       ORDER BY bt.total_bid_jpy DESC, u.login_id ASC`,
      [groupId]
    );
    res.json(rows);
  } catch (error) {
    console.error("member-groups members list error:", error);
    res.status(500).json({ message: "그룹 ?�원 목록 조회 ?�패" });
  }
});

/** POST /api/admin/member-groups/:id/members - 그룹???�원 추�? */
router.post("/member-groups/:id/members", isAdmin, async (req, res) => {
  try {
    await ensureMemberGroupTables();
    const groupId = parseInt(req.params.id, 10);
    const userId = parseInt(req.body?.user_id, 10);
    if (!groupId || !userId) return res.status(400).json({ message: "그룹 ID?� ?�원 ID가 ?�요?�니??" });

    const [result] = await pool.query("INSERT IGNORE INTO user_member_groups (user_id, group_id) VALUES (?, ?)", [
      userId,
      groupId,
    ]);
    res.status(201).json({ success: true, added: result.affectedRows > 0 });
  } catch (error) {
    console.error("member-groups add member error:", error);
    res.status(500).json({ message: "?�원 추�? ?�패" });
  }
});

function normalizeUserIds(input) {
  if (!Array.isArray(input)) return [];
  const uniq = new Set();
  for (const raw of input) {
    const parsed = parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed > 0) uniq.add(parsed);
  }
  return Array.from(uniq);
}

/** POST /api/admin/member-groups/:id/members/batch - 그룹???�원 ?�괄 추�? */
router.post("/member-groups/:id/members/batch", isAdmin, async (req, res) => {
  try {
    await ensureMemberGroupTables();
    const groupId = parseInt(req.params.id, 10);
    const userIds = normalizeUserIds(req.body?.user_ids);
    if (!groupId || userIds.length === 0) {
      return res.status(400).json({ message: "그룹 ID?� user_ids 배열???�요?�니??" });
    }

    const userPlaceholders = userIds.map(() => "?").join(", ");
    const [existingUsers] = await pool.query(`SELECT id FROM users WHERE id IN (${userPlaceholders})`, userIds);
    const existingUserIds = Array.isArray(existingUsers) ? existingUsers.map((r) => Number(r.id)).filter(Boolean) : [];

    if (!existingUserIds.length) {
      return res.status(400).json({ message: "추�? 가?�한 ?�원???�습?�다." });
    }

    const valuesSql = existingUserIds.map(() => "(?, ?)").join(", ");
    const params = [];
    existingUserIds.forEach((uid) => {
      params.push(uid, groupId);
    });

    const [result] = await pool.query(
      `INSERT IGNORE INTO user_member_groups (user_id, group_id) VALUES ${valuesSql}`,
      params,
    );

    res.status(201).json({
      success: true,
      requested: userIds.length,
      validUsers: existingUserIds.length,
      inserted: result.affectedRows,
    });
  } catch (error) {
    console.error("member-groups batch add members error:", error);
    res.status(500).json({ message: "?�원 ?�괄 추�? ?�패" });
  }
});

/** POST /api/admin/member-groups/:id/members/batch-remove - 그룹?�서 ?�원 ?�괄 ?�거 */
router.post("/member-groups/:id/members/batch-remove", isAdmin, async (req, res) => {
  try {
    await ensureMemberGroupTables();
    const groupId = parseInt(req.params.id, 10);
    const userIds = normalizeUserIds(req.body?.user_ids);
    if (!groupId || userIds.length === 0) {
      return res.status(400).json({ message: "그룹 ID?� user_ids 배열???�요?�니??" });
    }

    const placeholders = userIds.map(() => "?").join(", ");
    const [result] = await pool.query(
      `DELETE FROM user_member_groups WHERE group_id = ? AND user_id IN (${placeholders})`,
      [groupId, ...userIds],
    );

    res.json({
      success: true,
      requested: userIds.length,
      removed: result.affectedRows || 0,
    });
  } catch (error) {
    console.error("member-groups batch remove members error:", error);
    res.status(500).json({ message: "?�원 ?�괄 ?�거 ?�패" });
  }
});

/** DELETE /api/admin/member-groups/:id/members/:userId - 그룹?�서 ?�원 ?�거 */
router.delete("/member-groups/:id/members/:userId", isAdmin, async (req, res) => {
  try {
    await ensureMemberGroupTables();
    const groupId = parseInt(req.params.id, 10);
    const userId = parseInt(req.params.userId, 10);
    if (!groupId || !userId) return res.status(400).json({ message: "그룹 ID?� ?�원 ID가 ?�요?�니??" });

    const [result] = await pool.query("DELETE FROM user_member_groups WHERE group_id = ? AND user_id = ?", [
      groupId,
      userId,
    ]);
    res.json({ success: true, removed: result.affectedRows > 0 });
  } catch (error) {
    console.error("member-groups remove member error:", error);
    res.status(500).json({ message: "?�원 ?�거 ?�패" });
  }
});

/**
 * GET /api/admin/export/bids
 * ?�찰 ??�� ?��? ?�보?�기 (?�장 + 직접 ?�합)
 */
router.get("/export/bids", isAdmin, async (req, res) => {
  // ?�?�아???�정: 5�?(?�?�량 ?�이??처리�??�해)
  req.setTimeout(300000);
  res.setTimeout(300000);

  const {
    userId = "",
    brands = "",
    categories = "",
    status = "",
    aucNum = "",
    fromDate = "",
    toDate = "",
    sortBy = "original_scheduled_date",
    sortOrder = "desc",
    type = "", // live, direct, or empty for both
  } = req.query;

  const connection = await pool.getConnection();

  try {
    console.log("?�찰 ??�� ?��? ?�보?�기 ?�작:", req.query);

    // ?�율 가?�오�?
    const exchangeRate = await getExchangeRate();

    // 쿼리 조건 구성
    const queryConditions = ["1=1"];
    const queryParams = [];

    // ?��? ?�터 (�?문자??= ?�체 ?��?)
    if (userId) {
      const userIdArray = userId.split(",");
      if (userIdArray.length === 1) {
        queryConditions.push("b.user_id = ?");
        queryParams.push(userId);
      } else {
        const placeholders = userIdArray.map(() => "?").join(",");
        queryConditions.push(`b.user_id IN (${placeholders})`);
        queryParams.push(...userIdArray);
      }
    }

    // 브랜???�터 (�?문자??= ?�체 브랜??
    if (brands) {
      const brandArray = brands.split(",");
      if (brandArray.length === 1) {
        queryConditions.push("i.brand = ?");
        queryParams.push(brands);
      } else {
        const placeholders = brandArray.map(() => "?").join(",");
        queryConditions.push(`i.brand IN (${placeholders})`);
        queryParams.push(...brandArray);
      }
    }

    // 카테고리 ?�터 (�?문자??= ?�체 카테고리)
    if (categories) {
      const categoryArray = categories.split(",");
      if (categoryArray.length === 1) {
        queryConditions.push("i.category = ?");
        queryParams.push(categories);
      } else {
        const placeholders = categoryArray.map(() => "?").join(",");
        queryConditions.push(`i.category IN (${placeholders})`);
        queryParams.push(...categoryArray);
      }
    }

    // ?�태 ?�터 (�?문자??= ?�체 ?�태)
    if (status) {
      const statusArray = status.split(",");
      if (statusArray.length === 1) {
        queryConditions.push("b.status = ?");
        queryParams.push(status);
      } else {
        const placeholders = statusArray.map(() => "?").join(",");
        queryConditions.push(`b.status IN (${placeholders})`);
        queryParams.push(...statusArray);
      }
    }

    // 출품???�터
    if (aucNum) {
      const aucNumArray = aucNum.split(",");
      if (aucNumArray.length === 1) {
        queryConditions.push("i.auc_num = ?");
        queryParams.push(aucNum);
      } else {
        const placeholders = aucNumArray.map(() => "?").join(",");
        queryConditions.push(`i.auc_num IN (${placeholders})`);
        queryParams.push(...aucNumArray);
      }
    }

    // ?�짜 ?�터
    if (fromDate) {
      queryConditions.push("i.scheduled_date >= ?");
      queryParams.push(fromDate);
    }
    if (toDate) {
      queryConditions.push("i.scheduled_date <= ?");
      queryParams.push(toDate);
    }

    const whereClause = queryConditions.join(" AND ");

    // ?�렬 ?�정
    let orderByColumn;
    switch (sortBy) {
      case "original_scheduled_date":
        orderByColumn = "i.original_scheduled_date";
        break;
      case "updated_at":
        orderByColumn = "b.updated_at";
        break;
      case "original_title":
        orderByColumn = "i.original_title";
        break;
      default:
        orderByColumn = "i.original_scheduled_date";
        break;
    }
    const direction = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

    // ?�이???�집
    const allRows = [];

    // ?�장 경매 ?�이??(type??비어?�거??'live'??경우)
    if (!type || type === "live") {
      const liveQuery = `
        SELECT 
          'live' as type,
          b.id, b.status, b.user_id,
          b.first_price, b.second_price, b.final_price, b.winning_price,
          b.appr_id, b.repair_requested_at, b.repair_details, b.repair_fee,
          b.created_at, b.updated_at, b.completed_at,
          i.item_id, i.original_title, i.title, i.brand, i.category, i.image,
          i.scheduled_date, i.original_scheduled_date, i.auc_num, i.rank, i.starting_price,
          u.login_id, u.company_name
        FROM live_bids b
        LEFT JOIN crawled_items i ON b.item_id = i.item_id
        LEFT JOIN users u ON b.user_id = u.id
        WHERE ${whereClause}
        ORDER BY ${orderByColumn} ${direction}
      `;

      const [liveRows] = await connection.query(liveQuery, queryParams);
      allRows.push(...liveRows);
    }

    // 직접 경매 ?�이??(type??비어?�거??'direct'??경우)
    if (!type || type === "direct") {
      const directQuery = `
        SELECT 
          'direct' as type,
          b.id, b.status, b.user_id,
          NULL as first_price, NULL as second_price, 
          b.current_price as final_price, b.winning_price,
          b.appr_id, b.repair_requested_at, b.repair_details, b.repair_fee,
          b.submitted_to_platform,
          b.created_at, b.updated_at, b.completed_at,
          i.item_id, i.original_title, i.title, i.brand, i.category, i.image,
          i.scheduled_date, i.original_scheduled_date, i.auc_num, i.rank, i.starting_price,
          u.login_id, u.company_name
        FROM direct_bids b
        LEFT JOIN crawled_items i ON b.item_id = i.item_id
        LEFT JOIN users u ON b.user_id = u.id
        WHERE ${whereClause}
        ORDER BY ${orderByColumn} ${direction}
      `;

      const [directRows] = await connection.query(directQuery, queryParams);
      allRows.push(...directRows);
    }

    console.log(`�?${allRows.length}�??�찰 ??�� 조회 ?�료`);

    // ?��? 컬럼 ?�의
    const columns = [
      { header: "구분", key: "type", width: 10 },
      { header: "?�찰ID", key: "bid_id", width: 10 },
      { header: "?�태", key: "status", width: 12 },
      { header: "?��?ID", key: "user_login", width: 15 },
      { header: "?�사�?, key: "company_name", width: 20 },
      { header: "?�품ID", key: "item_id", width: 15 },
      { header: "?�목", key: "title", width: 40 },
      { header: "브랜??, key: "brand", width: 15 },
      { header: "카테고리", key: "category", width: 12 },
      { header: "?�급", key: "rank", width: 10 },
      { header: "출품??, key: "auc_num", width: 10 },
      { header: "?�정?�시", key: "scheduled_date", width: 20 },
      { header: "?�시?��?(¥)", key: "starting_price", width: 15 },
      { header: "1차입찰�?(¥)", key: "first_price", width: 15 },
      { header: "2차제?��?(¥)", key: "second_price", width: 15 },
      { header: "최종?�찰가(¥)", key: "final_price", width: 15 },
      { header: "?�찰금액(¥)", key: "winning_price", width: 15 },
      { header: "관부가?�포????", key: "krw_total", width: 18 },
      { header: "감정?�ID", key: "appr_id", width: 12 },
      { header: "?�선?�청??, key: "repair_requested_at", width: 20 },
      { header: "?�선비용(??", key: "repair_fee", width: 15 },
      { header: "?�랫?�반??, key: "submitted_to_platform", width: 12 },
      { header: "?�성??, key: "created_at", width: 20 },
      { header: "?�정??, key: "updated_at", width: 20 },
      { header: "?�료??, key: "completed_at", width: 20 },
      { header: "?��?지", key: "image", width: 15 },
    ];

    // ?�이????변??
    const rows = allRows.map((row) => {
      // 관부가???�함 가�?계산
      let krw_total = "";
      const priceToUse = row.winning_price || row.final_price || 0;
      if (priceToUse && row.auc_num && row.category) {
        try {
          krw_total = calculateTotalPrice(
            priceToUse,
            row.auc_num,
            row.category,
            exchangeRate,
          );
        } catch (error) {
          console.error("관부가??계산 ?�류:", error);
        }
      }

      return {
        type: row.type === "live" ? "?�장" : "직접",
        bid_id: row.id,
        status: getStatusText(row.status, row.type),
        user_login: row.login_id || "",
        company_name: row.company_name || "",
        item_id: row.item_id || "",
        title: row.original_title || row.title || "",
        brand: row.brand || "",
        category: row.category || "",
        rank: row.rank || "",
        auc_num: row.auc_num || "",
        scheduled_date: formatDateForExcel(
          row.original_scheduled_date || row.scheduled_date,
        ),
        starting_price: formatNumberForExcel(row.starting_price),
        first_price: formatNumberForExcel(row.first_price),
        second_price: formatNumberForExcel(row.second_price),
        final_price: formatNumberForExcel(row.final_price),
        winning_price: formatNumberForExcel(row.winning_price),
        krw_total: formatNumberForExcel(krw_total),
        appr_id: row.appr_id || "",
        repair_requested_at: formatDateForExcel(row.repair_requested_at),
        repair_fee: formatNumberForExcel(row.repair_fee),
        submitted_to_platform: row.submitted_to_platform ? "Y" : "N",
        created_at: formatDateForExcel(row.created_at),
        updated_at: formatDateForExcel(row.updated_at),
        completed_at: formatDateForExcel(row.completed_at),
        image: row.image || "",
      };
    });

    // ?�크�??�성
    const workbook = await createWorkbook({
      sheetName: "?�찰 ??��",
      columns,
      rows,
      imageColumns: ["image"],
      imageWidth: 100,
      imageHeight: 100,
      maxConcurrency: 5,
    });

    // ?�일�??�성 (?�짜 ?�함)
    const now = new Date();
    const dateStr = now
      .toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
      .replace(/\. /g, "-")
      .replace(/\./g, "")
      .replace(/:/g, "")
      .replace(/ /g, "_");
    const filename = `?�찰??��_${dateStr}.xlsx`;

    // ?�답 ?�트�?
    await streamWorkbookToResponse(workbook, res, filename);

    console.log(`?�찰 ??�� ?��? ?�보?�기 ?�료: ${filename}`);
  } catch (error) {
    console.error("?�찰 ??�� ?��? ?�보?�기 ?�류:", error);
    console.error("?�류 ?�택:", error.stack);
    console.error("?�청 ?�라미터:", req.query);
    if (!res.headersSent) {
      res.status(500).json({
        message: "?��? ?�보?�기 �??�류가 발생?�습?�다.",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  } finally {
    connection.release();
  }
});

/**
 * GET /api/admin/export/bid-results
 * ?�찰 결과(?�산) ?��? ?�보?�기
 */
router.get("/export/bid-results", isAdmin, async (req, res) => {
  // ?�?�아???�정: 5�?(?�?�량 ?�이??처리�??�해)
  req.setTimeout(300000);
  res.setTimeout(300000);

  const {
    fromDate = "",
    toDate = "",
    userId = "",
    status = "",
    sortBy = "date",
    sortOrder = "desc",
  } = req.query;

  const connection = await pool.getConnection();

  try {
    console.log("?�찰 결과 ?��? ?�보?�기 ?�작:", req.query);

    // ?�율 가?�오�?
    const exchangeRate = await getExchangeRate();

    // 쿼리 조건 구성
    let whereConditions = ["1=1"];
    let queryParams = [];

    // ?�짜 범위 ?�터 (�?문자??= ?�체 ?�짜)
    if (fromDate) {
      whereConditions.push("ds.settlement_date >= ?");
      queryParams.push(fromDate);
    }
    if (toDate) {
      whereConditions.push("ds.settlement_date <= ?");
      queryParams.push(toDate);
    }

    // ?��? ?�터 (�?문자??= ?�체 ?��?)
    if (userId) {
      const userIdArray = userId.split(",");
      if (userIdArray.length === 1) {
        whereConditions.push("ds.user_id = ?");
        queryParams.push(userId);
      } else {
        const placeholders = userIdArray.map(() => "?").join(",");
        whereConditions.push(`ds.user_id IN (${placeholders})`);
        queryParams.push(...userIdArray);
      }
    }

    // ?�산 ?�태 ?�터 (�?문자??= ?�체 ?�태)
    if (status) {
      const statusArray = status.split(",");
      if (statusArray.length === 1) {
        whereConditions.push("ds.payment_status = ?");
        queryParams.push(status);
      } else {
        const placeholders = statusArray.map(() => "?").join(",");
        whereConditions.push(`ds.payment_status IN (${placeholders})`);
        queryParams.push(...statusArray);
      }
    }

    const whereClause = whereConditions.join(" AND ");

    // ?�렬 ?�정
    let orderByClause = "ds.settlement_date DESC";
    if (sortBy === "total_price") {
      orderByClause = `ds.final_amount ${sortOrder.toUpperCase()}`;
    } else if (sortBy === "item_count") {
      orderByClause = `ds.item_count ${sortOrder.toUpperCase()}`;
    }

    // ?�산 ?�이??조회
    const [settlements] = await connection.query(
      `SELECT 
         ds.id as settlement_id,
         ds.settlement_date,
         ds.user_id,
         u.login_id,
         u.company_name,
         ds.item_count,
         ds.total_amount,
         ds.fee_amount,
         ds.vat_amount,
         ds.appraisal_fee,
         ds.appraisal_vat,
         ds.final_amount,
         ds.completed_amount,
         ds.payment_status,
         ds.depositor_name,
         ds.exchange_rate
       FROM daily_settlements ds
       LEFT JOIN users u ON ds.user_id = u.id
       WHERE ${whereClause}
       ORDER BY ${orderByClause}`,
      queryParams,
    );

    console.log(`�?${settlements.length}�??�산 ?�이??조회 ?�료`);

    // �??�산???�???�세 ?�이??조회
    const allRows = [];

    for (const settlement of settlements) {
      const { user_id, settlement_date } = settlement;

      // ?�찰 ?�료??live_bids 조회
      const [liveBids] = await connection.query(
        `SELECT 
           lb.id,
           'live' as type,
           lb.item_id,
           lb.first_price,
           lb.second_price,
           lb.final_price,
           lb.winning_price,
           lb.status,
           lb.appr_id,
           lb.repair_fee,
           i.title,
           i.original_title,
           i.brand,
           i.category,
           i.auc_num,
           i.starting_price,
           i.image
         FROM live_bids lb
         JOIN crawled_items i ON lb.item_id = i.item_id
         WHERE lb.user_id = ? AND DATE(i.scheduled_date) = ? AND lb.status = 'completed'`,
        [user_id, settlement_date],
      );

      // ?�찰 ?�료??direct_bids 조회
      const [directBids] = await connection.query(
        `SELECT 
           db.id,
           'direct' as type,
           db.item_id,
           NULL as first_price,
           NULL as second_price,
           db.current_price as final_price,
           db.winning_price,
           db.status,
           db.appr_id,
           db.repair_fee,
           i.title,
           i.original_title,
           i.brand,
           i.category,
           i.auc_num,
           i.starting_price,
           i.image
         FROM direct_bids db
         JOIN crawled_items i ON db.item_id = i.item_id
         WHERE db.user_id = ? AND DATE(i.scheduled_date) = ? AND db.status = 'completed'`,
        [user_id, settlement_date],
      );

      const items = [...liveBids, ...directBids];

      // ?�이?�이 ?�어???�산 ?�약 ?��? 추�? (?�이?�별 ??구조)
      if (items.length === 0) {
        allRows.push({
          settlement_date: settlement.settlement_date,
          user_login: settlement.login_id,
          company_name: settlement.company_name,
          payment_status: getPaymentStatusText(settlement.payment_status),
          depositor_name: settlement.depositor_name || "",
          item_id: "",
          title: "",
          brand: "",
          category: "",
          auc_num: "",
          start_price: "",
          first_price: "",
          second_price: "",
          final_price: "",
          winning_price: "",
          korean_price: "",
          appr_id: "",
          repair_fee: "",
          fee_amount: formatNumberForExcel(settlement.fee_amount),
          vat_amount: formatNumberForExcel(settlement.vat_amount),
          appraisal_fee: formatNumberForExcel(settlement.appraisal_fee),
          appraisal_vat: formatNumberForExcel(settlement.appraisal_vat),
          grand_total: formatNumberForExcel(settlement.final_amount),
          completed_amount: formatNumberForExcel(settlement.completed_amount),
          remaining_amount: formatNumberForExcel(
            settlement.final_amount - settlement.completed_amount,
          ),
          image: "",
        });
      } else {
        // �??�이?�을 ?�으�?추�?
        items.forEach((item) => {
          let koreanPrice = 0;
          const price = parseInt(item.winning_price) || 0;
          if (price > 0 && item.auc_num && item.category) {
            try {
              koreanPrice = calculateTotalPrice(
                price,
                item.auc_num,
                item.category,
                settlement.exchange_rate || exchangeRate,
              );
            } catch (error) {
              console.error("관부가??계산 ?�류:", error);
            }
          }

          allRows.push({
            settlement_date: settlement.settlement_date,
            user_login: settlement.login_id,
            company_name: settlement.company_name,
            payment_status: getPaymentStatusText(settlement.payment_status),
            depositor_name: settlement.depositor_name || "",
            item_id: item.item_id || "",
            title: item.original_title || item.title || "",
            brand: item.brand || "",
            category: item.category || "",
            auc_num: item.auc_num || "",
            start_price: formatNumberForExcel(item.starting_price),
            first_price: formatNumberForExcel(item.first_price),
            second_price: formatNumberForExcel(item.second_price),
            final_price: formatNumberForExcel(item.final_price),
            winning_price: formatNumberForExcel(item.winning_price),
            korean_price: formatNumberForExcel(koreanPrice),
            appr_id: item.appr_id || "",
            repair_fee: formatNumberForExcel(item.repair_fee),
            fee_amount: formatNumberForExcel(settlement.fee_amount),
            vat_amount: formatNumberForExcel(settlement.vat_amount),
            appraisal_fee: formatNumberForExcel(settlement.appraisal_fee),
            appraisal_vat: formatNumberForExcel(settlement.appraisal_vat),
            grand_total: formatNumberForExcel(settlement.final_amount),
            completed_amount: formatNumberForExcel(settlement.completed_amount),
            remaining_amount: formatNumberForExcel(
              settlement.final_amount - settlement.completed_amount,
            ),
            image: item.image || "",
          });
        });
      }
    }

    console.log(`�?${allRows.length}�??�이?????�성 ?�료`);

    // ?��? 컬럼 ?�의
    const columns = [
      { header: "?�산??, key: "settlement_date", width: 15 },
      { header: "?��?ID", key: "user_login", width: 15 },
      { header: "?�사�?, key: "company_name", width: 20 },
      { header: "?�산?�태", key: "payment_status", width: 12 },
      { header: "?�금?�명", key: "depositor_name", width: 15 },
      { header: "?�품ID", key: "item_id", width: 15 },
      { header: "?�목", key: "title", width: 40 },
      { header: "브랜??, key: "brand", width: 15 },
      { header: "카테고리", key: "category", width: 12 },
      { header: "출품??, key: "auc_num", width: 10 },
      { header: "?�작가(¥)", key: "start_price", width: 15 },
      { header: "1차입찰�?(¥)", key: "first_price", width: 15 },
      { header: "2차제?��?(¥)", key: "second_price", width: 15 },
      { header: "최종?�찰가(¥)", key: "final_price", width: 15 },
      { header: "?�찰금액(¥)", key: "winning_price", width: 15 },
      { header: "관부가?�포????", key: "korean_price", width: 18 },
      { header: "감정?�ID", key: "appr_id", width: 12 },
      { header: "?�선비용(??", key: "repair_fee", width: 15 },
      { header: "?�수�???", key: "fee_amount", width: 15 },
      { header: "VAT(??", key: "vat_amount", width: 15 },
      { header: "감정?�수?�료(??", key: "appraisal_fee", width: 15 },
      { header: "감정?�VAT(??", key: "appraisal_vat", width: 15 },
      { header: "총청구액(??", key: "grand_total", width: 18 },
      { header: "기결?�액(??", key: "completed_amount", width: 18 },
      { header: "미수�???", key: "remaining_amount", width: 18 },
      { header: "?��?지", key: "image", width: 15 },
    ];

    // ?�크�??�성
    const workbook = await createWorkbook({
      sheetName: "?�찰 결과",
      columns,
      rows: allRows,
      imageColumns: ["image"],
      imageWidth: 100,
      imageHeight: 100,
      maxConcurrency: 5,
    });

    // ?�일�??�성
    const now = new Date();
    const dateStr = now
      .toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
      .replace(/\. /g, "-")
      .replace(/\./g, "")
      .replace(/:/g, "")
      .replace(/ /g, "_");
    const filename = `?�찰결과_${dateStr}.xlsx`;

    // ?�답 ?�트�?
    await streamWorkbookToResponse(workbook, res, filename);

    console.log(`?�찰 결과 ?��? ?�보?�기 ?�료: ${filename}`);
  } catch (error) {
    console.error("?�찰 결과 ?��? ?�보?�기 ?�류:", error);
    console.error("?�류 ?�택:", error.stack);
    console.error("?�청 ?�라미터:", req.query);
    if (!res.headersSent) {
      res.status(500).json({
        message: "?��? ?�보?�기 �??�류가 발생?�습?�다.",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  } finally {
    connection.release();
  }
});

// =====================================================
// ?�퍼 ?�수
// =====================================================

function getStatusText(status, type) {
  if (type === "live") {
    const statusMap = {
      first: "1�??�찰",
      second: "2�??�안",
      final: "최종 ?�찰",
      completed: "?�료",
      shipped: "출고??,
      cancelled: "?�찰 ?�패",
    };
    return statusMap[status] || status;
  } else {
    const statusMap = {
      active: "?�성",
      completed: "?�료",
      shipped: "출고??,
      cancelled: "?�찰 ?�패",
    };
    return statusMap[status] || status;
  }
}

function getPaymentStatusText(status) {
  const statusMap = {
    unpaid: "결제 ?�요",
    pending: "?�금 ?�인 �?,
    paid: "?�산 ?�료",
  };
  return statusMap[status] || status;
}

module.exports = router;
