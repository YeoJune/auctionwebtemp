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
const {
  createWorkbook,
  streamWorkbookToResponse,
  formatDateForExcel,
  formatNumberForExcel,
} = require("../utils/excel");
const { calculateTotalPrice } = require("../utils/calculate-fee");
const { getExchangeRate } = require("../utils/exchange-rate");

// Middleware to check if user is admin
const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.login_id === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Access denied. Admin only." });
  }
};

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

// guide.html을 위한 multer 설정
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
    // HTML 파일만 허용
    if (file.mimetype === "text/html") {
      cb(null, true);
    } else {
      cb(new Error("HTML 파일만 업로드 가능합니다."), false);
    }
  },
});

// inquiry.html을 위한 multer 설정 추가
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
    // HTML 파일만 허용
    if (file.mimetype === "text/html") {
      cb(null, true);
    } else {
      cb(new Error("HTML 파일만 업로드 가능합니다."), false);
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
    // HTML 파일만 허용
    if (file.mimetype === "text/html") {
      cb(null, true);
    } else {
      cb(new Error("HTML 파일만 업로드 가능합니다."), false);
    }
  },
});

// guide.html 업로드 라우트
router.post(
  "/upload-guide",
  isAdmin,
  uploadGuide.single("guide"),
  (req, res) => {
    if (req.file) {
      res.json({ message: "guide.html이 성공적으로 업로드되었습니다." });
    } else {
      res.status(400).json({ message: "guide.html 업로드에 실패했습니다." });
    }
  },
);

// inquiry.html 업로드 라우트 추가
router.post(
  "/upload-inquiry",
  isAdmin,
  uploadInquiry.single("inquiry"),
  (req, res) => {
    if (req.file) {
      res.json({ message: "inquiry.html이 성공적으로 업로드되었습니다." });
    } else {
      res.status(400).json({ message: "inquiry.html 업로드에 실패했습니다." });
    }
  },
);

// bid-guide.html 업로드 라우트
router.post(
  "/upload-bid-guide",
  isAdmin,
  uploadBidGuide.single("bidGuide"),
  (req, res) => {
    if (req.file) {
      res.json({ message: "bid-guide.html이 성공적으로 업로드되었습니다." });
    } else {
      res
        .status(400)
        .json({ message: "bid-guide.html 업로드에 실패했습니다." });
    }
  },
);

// 클라이언트 측 공지사항 조회 API (접근 제한 없음)
router.get("/public/notices", async (req, res) => {
  try {
    const notices = await getNotices();
    res.json(notices);
  } catch (error) {
    console.error("Error getting public notices:", error);
    res.status(500).json({ message: "Error getting notices" });
  }
});

// 특정 공지사항 조회 API (접근 제한 없음)
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
  const isAdmin = req.session.user && req.session.user.login_id === "admin";
  res.json({ isAdmin });
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

// 이미지-URL 기반 공지 시스템을 위한 수정된 라우트들
router.post(
  "/notices",
  isAdmin,
  uploadNoticeImage.single("image"),
  async (req, res) => {
    try {
      const { title, targetUrl } = req.body;

      // 제목과 이미지 필수 검증
      if (!title) {
        return res.status(400).json({ message: "Title is required" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "Image is required" });
      }

      // 이미지 처리
      const uniqueSuffix = Date.now() + "-" + uuidv4();
      const filename = `notice-${uniqueSuffix}.webp`;
      const outputPath = path.join(
        __dirname,
        "../public/images/notices",
        filename,
      );

      await sharp(req.file.buffer).webp({ quality: 100 }).toFile(outputPath);

      const imageUrl = `/images/notices/${filename}`;

      // 공지사항 저장
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

      // 제목 필수 검증
      if (!title) {
        return res.status(400).json({ message: "Title is required" });
      }

      let imageUrl;

      // 새 이미지가 업로드된 경우
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
      // 기존 이미지 유지하는 경우
      else if (keepExistingImage === "true") {
        const existingNotice = await getNoticeById(id);
        if (!existingNotice) {
          return res.status(404).json({ message: "Notice not found" });
        }
        imageUrl = existingNotice.imageUrl;
      }
      // 새 이미지도 없고 기존 이미지도 유지하지 않는 경우
      else {
        return res.status(400).json({ message: "Image is required" });
      }

      // 공지사항 업데이트
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

    // 초기화 후 즉시 동기화
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

    // 배치 업데이트 완료 후 즉시 동기화
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

// 모든 추천 설정 조회
router.get("/recommend-settings", isAdmin, async (req, res) => {
  try {
    const settings = await getRecommendSettings();
    // conditions가 JSON 문자열이므로 파싱해서 보내줍니다.
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

// 새 추천 설정 추가
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

    // 새 규칙 추가 후 즉시 동기화
    await syncRecommendSettingsToItems();

    res.status(201).json(newSetting);
  } catch (error) {
    console.error("Error adding recommend setting:", error);
    res.status(500).json({ message: "Error adding recommend setting" });
  }
});

// 배치 업데이트 라우트
router.put("/recommend-settings/batch", isAdmin, async (req, res) => {
  try {
    const { settings } = req.body;

    const results = await updateRecommendSettingsBatch(settings);

    // 배치 업데이트 완료 후 즉시 동기화
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

// 기존 추천 설정 업데이트
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

    // 규칙 수정 후 즉시 동기화
    await syncRecommendSettingsToItems();

    res.json(updatedSetting);
  } catch (error) {
    console.error("Error updating recommend setting:", error);
    res.status(500).json({ message: "Error updating recommend setting" });
  }
});

// 추천 설정 삭제
router.delete("/recommend-settings/:id", isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await deleteRecommendSetting(id);
    if (!result) {
      return res.status(404).json({ message: "Setting not found" });
    }

    // 규칙 삭제 후 즉시 동기화
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

    // 입력값 검증
    if (!final_price || isNaN(parseFloat(final_price))) {
      return res.status(400).json({
        success: false,
        message: "유효한 가격을 입력해주세요",
      });
    }

    // 가격 데이터 업데이트
    await DBManager.updateItemDetails(
      itemId,
      {
        final_price: parseFloat(final_price).toFixed(2), // 소수점 2자리까지 저장
      },
      "values_items",
    );

    res.json({
      success: true,
      message: "가격이 성공적으로 업데이트되었습니다",
    });
  } catch (error) {
    console.error("Error updating item price:", error);
    res.status(500).json({
      success: false,
      message: "가격 업데이트 중 오류가 발생했습니다",
    });
  }
});

// 관리자 거래 내역 페이지 렌더링
router.get("/transactions", isAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "../pages/admin/transactions.html"));
});

// 인보이스 목록 조회
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

    // 페이지와 제한 검증
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // 쿼리 매개변수
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

    // 경매사 필터
    if (auc_num) {
      query += ` AND auc_num = ?`;
      queryParams.push(auc_num);
    }

    // 상태 필터
    if (status) {
      query += ` AND status = ?`;
      queryParams.push(status);
    }

    // 날짜 범위 필터
    if (startDate) {
      query += ` AND date >= ?`;
      queryParams.push(startDate);
    }

    if (endDate) {
      query += ` AND date <= ?`;
      queryParams.push(endDate);
    }

    // 날짜순 정렬 (최신순)
    query += ` ORDER BY date DESC`;

    // 페이지네이션 추가
    query += ` LIMIT ? OFFSET ?`;
    queryParams.push(limitNum, offset);

    // 총 레코드 수 쿼리
    let countQuery = `
      SELECT COUNT(*) as total
      FROM invoices
      WHERE 1=1
    `;

    // 동일한 필터 조건 적용
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

    // 카운트 쿼리에 사용할 파라미터 (LIMIT, OFFSET 제외)
    const countParams = queryParams.slice(0, queryParams.length - 2);

    // DB 연결 및 쿼리 실행
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
      .json({ message: "인보이스 목록을 불러오는 중 오류가 발생했습니다." });
  }
});

// =====================================================
// 엑셀 내보내기 API
// =====================================================

/**
 * GET /api/admin/users-list
 * 유저 목록 조회 (엑셀 내보내기 필터용)
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

/**
 * GET /api/admin/export/bids
 * 입찰 항목 엑셀 내보내기 (현장 + 직접 통합)
 */
router.get("/export/bids", isAdmin, async (req, res) => {
  // 타임아웃 설정: 5분 (대용량 데이터 처리를 위해)
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
    console.log("입찰 항목 엑셀 내보내기 시작:", req.query);

    // 환율 가져오기
    const exchangeRate = await getExchangeRate();

    // 쿼리 조건 구성
    const queryConditions = ["1=1"];
    const queryParams = [];

    // 유저 필터 (빈 문자열 = 전체 유저)
    if (userId) {
      queryConditions.push("b.user_id = ?");
      queryParams.push(userId);
    }

    // 브랜드 필터 (빈 문자열 = 전체 브랜드)
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

    // 카테고리 필터 (빈 문자열 = 전체 카테고리)
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

    // 상태 필터 (빈 문자열 = 전체 상태)
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

    // 출품사 필터
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

    // 날짜 필터
    if (fromDate) {
      queryConditions.push("i.scheduled_date >= ?");
      queryParams.push(fromDate);
    }
    if (toDate) {
      queryConditions.push("i.scheduled_date <= ?");
      queryParams.push(toDate);
    }

    const whereClause = queryConditions.join(" AND ");

    // 정렬 설정
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

    // 데이터 수집
    const allRows = [];

    // 현장 경매 데이터 (type이 비어있거나 'live'인 경우)
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

    // 직접 경매 데이터 (type이 비어있거나 'direct'인 경우)
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

    console.log(`총 ${allRows.length}개 입찰 항목 조회 완료`);

    // 엑셀 컬럼 정의
    const columns = [
      { header: "구분", key: "type", width: 10 },
      { header: "입찰ID", key: "bid_id", width: 10 },
      { header: "상태", key: "status", width: 12 },
      { header: "유저ID", key: "user_login", width: 15 },
      { header: "회사명", key: "company_name", width: 20 },
      { header: "상품ID", key: "item_id", width: 15 },
      { header: "제목", key: "title", width: 40 },
      { header: "브랜드", key: "brand", width: 15 },
      { header: "카테고리", key: "category", width: 12 },
      { header: "등급", key: "rank", width: 10 },
      { header: "출품사", key: "auc_num", width: 10 },
      { header: "예정일시", key: "scheduled_date", width: 20 },
      { header: "원시작가(¥)", key: "starting_price", width: 15 },
      { header: "1차입찰가(¥)", key: "first_price", width: 15 },
      { header: "2차제안가(¥)", key: "second_price", width: 15 },
      { header: "최종입찰가(¥)", key: "final_price", width: 15 },
      { header: "낙찰금액(¥)", key: "winning_price", width: 15 },
      { header: "관부가세포함(₩)", key: "krw_total", width: 18 },
      { header: "감정서ID", key: "appr_id", width: 12 },
      { header: "수선신청일", key: "repair_requested_at", width: 20 },
      { header: "수선비용(₩)", key: "repair_fee", width: 15 },
      { header: "플랫폼반영", key: "submitted_to_platform", width: 12 },
      { header: "생성일", key: "created_at", width: 20 },
      { header: "수정일", key: "updated_at", width: 20 },
      { header: "완료일", key: "completed_at", width: 20 },
      { header: "이미지", key: "image", width: 15 },
    ];

    // 데이터 행 변환
    const rows = allRows.map((row) => {
      // 관부가세 포함 가격 계산
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
          console.error("관부가세 계산 오류:", error);
        }
      }

      return {
        type: row.type === "live" ? "현장" : "직접",
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

    // 워크북 생성
    const workbook = await createWorkbook({
      sheetName: "입찰 항목",
      columns,
      rows,
      imageColumns: ["image"],
      imageWidth: 100,
      imageHeight: 100,
      maxConcurrency: 5,
    });

    // 파일명 생성 (날짜 포함)
    const now = new Date();
    const dateStr = now
      .toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
      .replace(/\. /g, "-")
      .replace(/\./g, "")
      .replace(/:/g, "")
      .replace(/ /g, "_");
    const filename = `입찰항목_${dateStr}.xlsx`;

    // 응답 스트림
    await streamWorkbookToResponse(workbook, res, filename);

    console.log(`입찰 항목 엑셀 내보내기 완료: ${filename}`);
  } catch (error) {
    console.error("입찰 항목 엑셀 내보내기 오류:", error);
    console.error("오류 스택:", error.stack);
    console.error("요청 파라미터:", req.query);
    if (!res.headersSent) {
      res.status(500).json({
        message: "엑셀 내보내기 중 오류가 발생했습니다.",
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
 * 입찰 결과(정산) 엑셀 내보내기
 */
router.get("/export/bid-results", isAdmin, async (req, res) => {
  // 타임아웃 설정: 5분 (대용량 데이터 처리를 위해)
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
    console.log("입찰 결과 엑셀 내보내기 시작:", req.query);

    // 환율 가져오기
    const exchangeRate = await getExchangeRate();

    // 쿼리 조건 구성
    let whereConditions = ["1=1"];
    let queryParams = [];

    // 날짜 범위 필터 (빈 문자열 = 전체 날짜)
    if (fromDate) {
      whereConditions.push("ds.settlement_date >= ?");
      queryParams.push(fromDate);
    }
    if (toDate) {
      whereConditions.push("ds.settlement_date <= ?");
      queryParams.push(toDate);
    }

    // 유저 필터 (빈 문자열 = 전체 유저)
    if (userId) {
      whereConditions.push("ds.user_id = ?");
      queryParams.push(userId);
    }

    // 정산 상태 필터 (빈 문자열 = 전체 상태)
    if (status) {
      whereConditions.push("ds.payment_status = ?");
      queryParams.push(status);
    }

    const whereClause = whereConditions.join(" AND ");

    // 정렬 설정
    let orderByClause = "ds.settlement_date DESC";
    if (sortBy === "total_price") {
      orderByClause = `ds.final_amount ${sortOrder.toUpperCase()}`;
    } else if (sortBy === "item_count") {
      orderByClause = `ds.item_count ${sortOrder.toUpperCase()}`;
    }

    // 정산 데이터 조회
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

    console.log(`총 ${settlements.length}개 정산 데이터 조회 완료`);

    // 각 정산에 대한 상세 아이템 조회
    const allRows = [];

    for (const settlement of settlements) {
      const { user_id, settlement_date } = settlement;

      // 낙찰 완료된 live_bids 조회
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

      // 낙찰 완료된 direct_bids 조회
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

      // 아이템이 없어도 정산 요약 행은 추가 (아이템별 행 구조)
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
        // 각 아이템을 행으로 추가
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
              console.error("관부가세 계산 오류:", error);
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

    console.log(`총 ${allRows.length}개 아이템 행 생성 완료`);

    // 엑셀 컬럼 정의
    const columns = [
      { header: "정산일", key: "settlement_date", width: 15 },
      { header: "유저ID", key: "user_login", width: 15 },
      { header: "회사명", key: "company_name", width: 20 },
      { header: "정산상태", key: "payment_status", width: 12 },
      { header: "입금자명", key: "depositor_name", width: 15 },
      { header: "상품ID", key: "item_id", width: 15 },
      { header: "제목", key: "title", width: 40 },
      { header: "브랜드", key: "brand", width: 15 },
      { header: "카테고리", key: "category", width: 12 },
      { header: "출품사", key: "auc_num", width: 10 },
      { header: "시작가(¥)", key: "start_price", width: 15 },
      { header: "1차입찰가(¥)", key: "first_price", width: 15 },
      { header: "2차제안가(¥)", key: "second_price", width: 15 },
      { header: "최종입찰가(¥)", key: "final_price", width: 15 },
      { header: "낙찰금액(¥)", key: "winning_price", width: 15 },
      { header: "관부가세포함(₩)", key: "korean_price", width: 18 },
      { header: "감정서ID", key: "appr_id", width: 12 },
      { header: "수선비용(₩)", key: "repair_fee", width: 15 },
      { header: "수수료(₩)", key: "fee_amount", width: 15 },
      { header: "VAT(₩)", key: "vat_amount", width: 15 },
      { header: "감정서수수료(₩)", key: "appraisal_fee", width: 15 },
      { header: "감정서VAT(₩)", key: "appraisal_vat", width: 15 },
      { header: "총청구액(₩)", key: "grand_total", width: 18 },
      { header: "기결제액(₩)", key: "completed_amount", width: 18 },
      { header: "미수금(₩)", key: "remaining_amount", width: 18 },
      { header: "이미지", key: "image", width: 15 },
    ];

    // 워크북 생성
    const workbook = await createWorkbook({
      sheetName: "입찰 결과",
      columns,
      rows: allRows,
      imageColumns: ["image"],
      imageWidth: 100,
      imageHeight: 100,
      maxConcurrency: 5,
    });

    // 파일명 생성
    const now = new Date();
    const dateStr = now
      .toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
      .replace(/\. /g, "-")
      .replace(/\./g, "")
      .replace(/:/g, "")
      .replace(/ /g, "_");
    const filename = `입찰결과_${dateStr}.xlsx`;

    // 응답 스트림
    await streamWorkbookToResponse(workbook, res, filename);

    console.log(`입찰 결과 엑셀 내보내기 완료: ${filename}`);
  } catch (error) {
    console.error("입찰 결과 엑셀 내보내기 오류:", error);
    console.error("오류 스택:", error.stack);
    console.error("요청 파라미터:", req.query);
    if (!res.headersSent) {
      res.status(500).json({
        message: "엑셀 내보내기 중 오류가 발생했습니다.",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  } finally {
    connection.release();
  }
});

// =====================================================
// 헬퍼 함수
// =====================================================

function getStatusText(status, type) {
  if (type === "live") {
    const statusMap = {
      first: "1차 입찰",
      second: "2차 제안",
      final: "최종 입찰",
      completed: "완료",
      shipped: "출고됨",
      cancelled: "낙찰 실패",
    };
    return statusMap[status] || status;
  } else {
    const statusMap = {
      active: "활성",
      completed: "완료",
      shipped: "출고됨",
      cancelled: "낙찰 실패",
    };
    return statusMap[status] || status;
  }
}

function getPaymentStatusText(status) {
  const statusMap = {
    unpaid: "결제 필요",
    pending: "입금 확인 중",
    paid: "정산 완료",
  };
  return statusMap[status] || status;
}

module.exports = router;
