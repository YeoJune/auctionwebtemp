// routes/crawler.js
const express = require("express");
const router = express.Router();
const { ecoAucCrawler, starAucCrawler } = require("../crawlers/index");
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
          if (isValue) crawler = null;
          else crawler = ecoAucCrawler;
        } else if (items[0].auc_num == 2) {
          if (isValue) crawler = null;
          else crawler = null;
        } else if (items[0].auc_num == 3) {
          crawler = starAucCrawler;
        }

        try {
          const crawledDetails = await crawler.crawlItemDetails(itemId);
          const processedDetials = (
            await processImagesInChunks([crawledDetails])
          )[0];

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

async function loginAll() {
  const crawlers = [ecoAucCrawler, starAucCrawler];

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
/*
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
  */

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

/*
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
*/

router.get("/crawl-status", isAdmin, (req, res) => {
  try {
    res.json({ isCrawling, isValueCrawling });
  } catch (error) {
    console.error("Crawling error:", error);
    res.status(500).json({ message: "Error during crawling" });
  }
});

router.post("/item-details/:itemId", (req, res) => {
  const { itemId } = req.params;
  processItem(itemId, false, res);
});

router.post("/value-details/:itemId", (req, res) => {
  const { itemId } = req.params;
  processItem(itemId, true, res);
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

if (process.env.ENV === "development") {
  console.log("development env");
} else {
  console.log("product env");
  scheduleCrawling();
  loginAll();
}

module.exports = router;
