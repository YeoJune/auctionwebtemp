// routes/crawler.js
const express = require("express");
const router = express.Router();
const {
  ecoAucCrawler,
  ecoAucValueCrawler,
  brandAucCrawler,
  brandAucValueCrawler,
  starAucCrawler,
} = require("../crawlers/index");
const DBManager = require("../utils/DBManager");
const pool = require("../utils/DB");
const cron = require("node-cron");
const { getAdminSettings } = require("../utils/adminDB");
const { initializeFilterSettings } = require("../utils/filterDB");
const dotenv = require("dotenv");

dotenv.config();

let isCrawling = false;
let isValueCrawling = false;
let isUpdateCrawling = false;

const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.id === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Access denied. Admin only." });
  }
};

async function loginAll() {
  const crawlers = [
    ecoAucCrawler,
    ecoAucValueCrawler,
    brandAucCrawler,
    brandAucValueCrawler,
    starAucCrawler,
  ];

  await Promise.all(crawlers.map((crawler) => crawler.login()));
}

async function crawlAll() {
  if (isCrawling) {
    throw new Error("already crawling");
  } else if (isValueCrawling) {
    throw new Error("value crawler is activating");
  } else {
    try {
      const [existingItems] = await pool.query(
        "SELECT item_id, auc_num FROM crawled_items"
      );
      const existingEcoAucIds = new Set(
        existingItems
          .filter((item) => item.auc_num == 1)
          .map((item) => item.item_id)
      );
      const existingBrandAuctionIds = new Set(
        existingItems
          .filter((item) => item.auc_num == 2)
          .map((item) => item.item_id)
      );
      const existingStarAucIds = new Set(
        existingItems
          .filter((item) => item.auc_num == 3)
          .map((item) => item.item_id)
      );

      isCrawling = true;
      let ecoAucItems = await ecoAucCrawler.crawlAllItems(existingEcoAucIds);
      let brandAucItems = await brandAucCrawler.crawlAllItems(
        existingBrandAuctionIds
      );
      let starAucItems = await starAucCrawler.crawlAllItems(existingStarAucIds);

      if (!ecoAucItems) ecoAucItems = [];
      if (!brandAucItems) brandAucItems = [];
      if (!starAucItems) starAucItems = [];

      const allItems = [...ecoAucItems, ...brandAucItems, ...starAucItems];
      await DBManager.saveItems(allItems, "crawled_items");
      await DBManager.deleteItemsWithout(
        allItems.map((item) => item.item_id),
        "crawled_items"
      );
      await DBManager.cleanupUnusedImages();
      await initializeFilterSettings();
    } catch (error) {
      throw error;
    } finally {
      isCrawling = false;
      await loginAll();
    }
  }
}

async function crawlAllValues() {
  if (isValueCrawling) {
    throw new Error("already crawling");
  } else if (isCrawling) {
    throw new Error("crawler is activating");
  } else {
    try {
      const [existingItems] = await pool.query(
        "SELECT item_id, auc_num FROM values_items"
      );
      const existingEcoAucIds = new Set(
        existingItems
          .filter((item) => item.auc_num == 1)
          .map((item) => item.item_id)
      );
      const existingBrandAuctionIds = new Set(
        existingItems
          .filter((item) => item.auc_num == 2)
          .map((item) => item.item_id)
      );

      isValueCrawling = true;

      let ecoAucItems = await ecoAucValueCrawler.crawlAllItems(
        existingEcoAucIds
      );
      let brandAucItems = await brandAucValueCrawler.crawlAllItems(
        existingBrandAuctionIds
      );

      if (!ecoAucItems) ecoAucItems = [];
      if (!brandAucItems) brandAucItems = [];
      const allItems = [...ecoAucItems, ...brandAucItems];
      await DBManager.saveItems(allItems, "values_items");
      await DBManager.cleanupOldValueItems();
      await DBManager.cleanupUnusedImages();
    } catch (error) {
      throw error;
    } finally {
      isValueCrawling = false;
    }
  }
}

async function crawlAllUpdates() {
  if (isUpdateCrawling) {
    throw new Error("update crawling already in progress");
  } else {
    isUpdateCrawling = true;
    const startTime = Date.now();
    console.log(`Starting update crawl at ${new Date().toISOString()}`);

    try {
      // EcoAuc와 BrandAuc의 direct 타입 경매만 업데이트 크롤링
      let ecoAucUpdates = await ecoAucCrawler.crawlUpdates();
      let brandAucUpdates = await brandAucCrawler.crawlUpdates();

      if (!ecoAucUpdates) ecoAucUpdates = [];
      if (!brandAucUpdates) brandAucUpdates = [];

      const allUpdates = [...ecoAucUpdates, ...brandAucUpdates];

      // 업데이트 정보를 DB에 저장
      await DBManager.updateItems(allUpdates, "crawled_items");

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      console.log(
        `Update crawl operation completed in ${formatExecutionTime(
          executionTime
        )}`
      );

      return {
        ecoAucCount: ecoAucUpdates.length,
        brandAucCount: brandAucUpdates.length,
        totalCount: allUpdates.length,
        executionTime: formatExecutionTime(executionTime),
      };
    } catch (error) {
      console.error("Update crawl failed:", error);
      throw error;
    } finally {
      isUpdateCrawling = false;
    }
  }
}

// 실행 시간 포맷팅 함수
function formatExecutionTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const remainingMinutes = minutes % 60;
  const remainingSeconds = seconds % 60;

  return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
}

// 라우팅 추가
router.get("/crawl-updates", isAdmin, async (req, res) => {
  try {
    const result = await crawlAllUpdates();

    res.json({
      message: "Update crawling completed successfully",
      stats: result,
    });
  } catch (error) {
    console.error("Update crawling error:", error);
    res.status(500).json({
      message: "Error during update crawling",
      error: error.message,
    });
  }
});

router.get("/crawl", isAdmin, async (req, res) => {
  try {
    await crawlAll();

    res.json({
      message: "Crawling and image processing completed successfully",
    });
  } catch (error) {
    console.error("Crawling error:", error);
    res.status(500).json({ message: "Error during crawling" });
  }
});

router.get("/crawl-values", isAdmin, async (req, res) => {
  try {
    await crawlAllValues();

    res.json({
      message: "Crawling and image processing completed successfully",
    });
  } catch (error) {
    console.error("Crawling error:", error);
    res.status(500).json({ message: "Error during crawling" });
  }
});

router.get("/crawl-status", isAdmin, (req, res) => {
  try {
    res.json({
      isCrawling,
      isValueCrawling,
      isUpdateCrawling,
      updateInterval: process.env.UPDATE_INTERVAL || "3600",
    });
  } catch (error) {
    console.error("Crawling status error:", error);
    res.status(500).json({ message: "Error getting crawling status" });
  }
});

const scheduleCrawling = async () => {
  const settings = await getAdminSettings();

  console.log(`Crawling schedule: ${settings.crawlSchedule}`);

  if (settings && settings.crawlSchedule) {
    const [hours, minutes] = settings.crawlSchedule.split(":");
    cron.schedule(
      `${minutes} ${hours} * * *`,
      async () => {
        console.log("Running scheduled crawling task");
        try {
          await crawlAll();
          //await crawlAllValues();
          console.log("Scheduled crawling completed successfully");
        } catch (error) {
          console.error("Scheduled crawling error:", error);
        }
      },
      {
        scheduled: true,
        timezone: "Asia/Seoul",
      }
    );
  }
};

const scheduleUpdateCrawling = () => {
  const updateInterval = parseInt(process.env.UPDATE_INTERVAL, 10) || 3600; // 기본값은 1시간(3600초)

  console.log(
    `Scheduling update crawling to run every ${updateInterval} seconds`
  );

  // 밀리초 단위로 변환하여 setInterval 설정
  setInterval(async () => {
    console.log("Running scheduled update crawling task");
    try {
      if (!isUpdateCrawling && !isCrawling && !isValueCrawling) {
        const result = await crawlAllUpdates();
        console.log("Scheduled update crawling completed successfully", {
          ecoAucCount: result.ecoAucCount,
          brandAucCount: result.brandAucCount,
          totalCount: result.totalCount,
          executionTime: result.executionTime,
        });
      } else {
        console.log(
          "Skipping scheduled update crawling - another crawling process is active"
        );
      }
    } catch (error) {
      console.error("Scheduled update crawling error:", error);
    }
  }, updateInterval * 1000);
};

const schedulePastItemsDeletion = () => {
  const deleteInterval = 3600; // 1시간(3600초)

  console.log(
    `Scheduling past items deletion to run every ${deleteInterval} seconds`
  );

  // 밀리초 단위로 변환하여 setInterval 설정
  setInterval(async () => {
    console.log("Running scheduled past items deletion task");
    try {
      if (!isUpdateCrawling && !isCrawling && !isValueCrawling) {
        console.log("Starting deletion of past scheduled items");
        const deletedCount = await DBManager.deletePastScheduledItems();
        console.log(
          `Scheduled past items deletion completed successfully. Deleted ${deletedCount} items.`
        );
      } else {
        console.log(
          "Skipping scheduled past items deletion - another crawling process is active"
        );
      }
    } catch (error) {
      console.error("Scheduled past items deletion error:", error);
    }
  }, deleteInterval * 1000);
};

if (process.env.ENV === "development") {
  console.log("development env");
} else {
  console.log("product env");
  scheduleCrawling();
  scheduleUpdateCrawling();
  schedulePastItemsDeletion();
  loginAll();
}

module.exports = router;
