// routes/crawler.js
const express = require("express");
const router = express.Router();
const {
  ecoAucCrawler,
  brandAucCrawler,
  ecoAucValueCrawler,
  brandAucValueCrawler,
  starAucCrawler,
} = require("../crawlers/index");
const DBManager = require("../utils/DBManager");
const pool = require("../utils/DB");
const cron = require("node-cron");
const { getAdminSettings } = require("../utils/adminDB");
const { initializeFilterSettings } = require("../utils/filterDB");
const { processImagesInChunks } = require("../utils/processImage");
const dotenv = require("dotenv");

dotenv.config();

let isCrawling = false;
let isValueCrawling = false;

const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.id === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Access denied. Admin only." });
  }
};

// 기존 processItem 함수 수정
async function processItem(itemId, isValue, res) {
  try {
    const tableName = isValue ? "values_items" : "crawled_items";
    const [items] = await pool.query(
      `SELECT * FROM ${tableName} WHERE item_id = ?`,
      [itemId]
    );
    if (items.length === 0) {
      res.status(404).json({ message: "Item not found" });
    } else {
      if (items[0].description) {
        res.json(items[0]);
      } else {
        let crawler;
        if (items[0].auc_num == 1) {
          if (isValue) crawler = ecoAucValueCrawler;
          else crawler = ecoAucCrawler;
        } else if (items[0].auc_num == 2) {
          if (isValue) crawler = brandAucValueCrawler;
          else crawler = brandAucCrawler;
        } else if (items[0].auc_num == 3) {
          crawler = starAucCrawler;
        }
        const detailIndex = findAvailableIndex(items[0].auc_num, isValue);

        if (detailIndex === -1) {
          res.status(503).json({
            message: "All crawlers are busy. Please try again later.",
          });
          return;
        }

        try {
          const crawledDetails = await crawler.crawlItemDetails(
            detailIndex,
            itemId
          );
          console.log(crawledDetails);
          const processedDetials = (
            await processImagesInChunks([crawledDetails])
          )[0];
          console.log(processedDetials);

          if (processedDetials) {
            await DBManager.updateItemDetails(
              itemId,
              processedDetials,
              tableName
            );

            const [updatedItems] = await pool.query(
              `SELECT * FROM ${tableName} WHERE item_id = ?`,
              [itemId]
            );
            res.json(updatedItems[0]);
          } else {
            crawler.closeDetailBrowsers();
            res.status(500).json({ message: "Failed to crawl item details" });
          }
        } finally {
          releaseIndex(items[0].auc_num, isValue, detailIndex);
        }
      }
    }
  } catch (error) {
    console.error("Error crawling item details:", error);
    res.status(500).json({ message: "Error crawling item details" });
  }
}

// 병렬 처리를 위한 작업 큐와 상태 관리
const queue = [];
let isProcessing = false;
const MAX_CONCURRENT_TASKS = 4; // 동시에 처리할 최대 작업 수

const crawlerIndexTracker = {
  ecoAucCrawler: new Array(ecoAucCrawler.detailMulti).fill(false),
  brandAucCrawler: new Array(brandAucCrawler.detailMulti).fill(false),
  ecoAucValueCrawler: new Array(ecoAucValueCrawler.detailMulti).fill(false),
  brandAucValueCrawler: new Array(brandAucValueCrawler.detailMulti).fill(false),
  starAucCrawler: new Array(starAucCrawler.detailMulti).fill(false), // 추가
};

function findAvailableIndex(crawlerIndex, isValue) {
  let trackerKey;
  if (isValue)
    trackerKey =
      crawlerIndex == 1
        ? "ecoAucValueCrawler"
        : crawlerIndex == 2
        ? "brandAucValueCrawler"
        : null;
  else
    trackerKey =
      crawlerIndex == 1
        ? "ecoAucCrawler"
        : crawlerIndex == 2
        ? "brandAucCrawler"
        : crawlerIndex == 3
        ? "starAucCrawler"
        : null;

  const tracker = crawlerIndexTracker[trackerKey];
  if (!tracker) {
    console.error(`No tracker found for crawler type: ${trackerKey}`);
    return -1;
  }
  for (let i = 0; i < tracker.length; i++) {
    if (!tracker[i]) {
      tracker[i] = true;
      return i;
    }
  }
  return -1;
}

function releaseIndex(crawlerIndex, isValue, index) {
  let trackerKey;
  if (isValue)
    trackerKey =
      crawlerIndex == 1
        ? "ecoAucValueCrawler"
        : crawlerIndex == 2
        ? "brandAucValueCrawler"
        : null;
  else
    trackerKey =
      crawlerIndex == 1
        ? "ecoAucCrawler"
        : crawlerIndex == 2
        ? "brandAucCrawler"
        : crawlerIndex == 3
        ? "starAucCrawler"
        : null;

  if (crawlerIndexTracker[trackerKey]) {
    crawlerIndexTracker[trackerKey][index] = false;
  } else {
    console.error(`No tracker found for crawler type: ${trackerKey}`);
  }
}

// 큐에 작업을 추가하고 처리를 시작하는 함수
function addToQueue(itemId, isValue, res) {
  queue.push({ itemId, isValue, res });
  if (!isProcessing) {
    processQueue();
  }
}

// 큐의 작업을 병렬로 처리하는 함수
async function processQueue() {
  if (queue.length === 0) {
    isProcessing = false;
    return;
  }

  isProcessing = true;
  const tasks = queue.splice(0, MAX_CONCURRENT_TASKS);

  try {
    await Promise.all(
      tasks.map((task) => processItem(task.itemId, task.isValue, task.res))
    );
  } catch (error) {
    console.error("Error processing queue:", error);
  }

  // 다음 작업 처리
  processQueue();
}
async function closeAllCrawler() {
  for (let c of [
    ecoAucCrawler,
    brandAucCrawler,
    ecoAucValueCrawler,
    brandAucValueCrawler,
    starAucCrawler, // 추가
  ]) {
    await c.closeCrawlerBrowser();
    await c.closeDetailBrowsers();
  }
}
async function loginAllDetails() {
  const crawlers = [
    ecoAucCrawler,
    brandAucCrawler,
    ecoAucValueCrawler,
    brandAucValueCrawler,
    starAucCrawler,
  ];

  await Promise.all(crawlers.map((crawler) => crawler.loginCheckDetails()));
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
      await closeAllCrawler();
      let ecoAucItems = await ecoAucCrawler.crawlAllItems(existingEcoAucIds);
      await closeAllCrawler();
      let brandAucItems = await brandAucCrawler.crawlAllItems(
        existingBrandAuctionIds
      );
      await closeAllCrawler();
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
      await loginAllDetails();
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

      await closeAllCrawler();
      let ecoAucItems = await ecoAucValueCrawler.crawlAllItems(
        existingEcoAucIds
      );
      await closeAllCrawler();
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
      await loginAllDetails();
    }
  }
}

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
    res.json({ isCrawling, isValueCrawling });
  } catch (error) {
    console.error("Crawling error:", error);
    res.status(500).json({ message: "Error during crawling" });
  }
});

router.post("/crawl-item-details/:itemId", (req, res) => {
  const { itemId } = req.params;
  addToQueue(itemId, false, res);
});

router.post("/crawl-item-value-details/:itemId", (req, res) => {
  const { itemId } = req.params;
  addToQueue(itemId, true, res);
});

const scheduleCrawling = async () => {
  const settings = await getAdminSettings();
  if (settings && settings.crawlSchedule) {
    const [hours, minutes] = settings.crawlSchedule.split(":");
    cron.schedule(
      `${minutes} ${hours} * * *`,
      async () => {
        console.log("Running scheduled crawling task");
        try {
          await crawlAll();
          await crawlAllValues();
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

if (process.env.ENV === "development") {
  console.log("development env");
} else {
  console.log("product env");
  scheduleCrawling();
  loginAllDetails();
}

module.exports = router;
