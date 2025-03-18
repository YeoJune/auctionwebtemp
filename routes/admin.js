// routes/admin.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");
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
} = require("../utils/filterDB");
const DBManager = require("../utils/DBManager");

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

// intro.html을 위한 multer 설정
const introStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "public/pages/");
  },
  filename: function (req, file, cb) {
    cb(null, "intro.html");
  },
});

const uploadIntro = multer({
  storage: introStorage,
  fileFilter: (req, file, cb) => {
    // HTML 파일만 허용
    if (file.mimetype === "text/html") {
      cb(null, true);
    } else {
      cb(new Error("HTML 파일만 업로드 가능합니다."), false);
    }
  },
});

// Middleware to check if user is admin
const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.id === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Access denied. Admin only." });
  }
};

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
  const isAdmin = req.session.user && req.session.user.id === "admin";
  res.json({ isAdmin });
});

// intro.html 업로드 라우트
router.post(
  "/upload-intro",
  isAdmin,
  uploadIntro.single("intro"),
  (req, res) => {
    if (req.file) {
      res.json({ message: "intro.html이 성공적으로 업로드되었습니다." });
    } else {
      res.status(400).json({ message: "intro.html 업로드에 실패했습니다." });
    }
  }
);

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
        filename
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
  }
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
          filename
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
        targetUrl || null
      );
      if (!updatedNotice) {
        return res.status(404).json({ message: "Notice not found" });
      }
      res.json(updatedNotice);
    } catch (error) {
      console.error("Error updating notice:", error);
      res.status(500).json({ message: "Error updating notice" });
    }
  }
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
      isEnabled
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
        isEnabled
      );
      results.push(result);
    }

    res.json({
      message: "Batch update completed",
      updated: results,
    });
  } catch (error) {
    console.error("Error performing batch update of filter settings:", error);
    res.status(500).json({ message: "Error updating filter settings" });
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
      "values_items"
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

module.exports = router;
