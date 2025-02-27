const express = require("express");
const router = express.Router();
const { processImagesInChunks } = require("../utils/processImage");
const {
  ecoAucCrawler,
  ecoAucValueCrawler,
  brandAucCrawler,
  brandAucValueCrawler,
  starAucCrawler,
} = require("../crawlers/index");
const DBManager = require("../utils/DBManager");
const pool = require("../utils/DB");

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
          if (isValue) crawler = null;
          else crawler = brandAucCrawler;
        } else if (items[0].auc_num == 3) {
          if (isValue) crawler = null;
          else crawler = starAucCrawler;
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
            res.status(500).json({ message: "Failed to getting item details" });
          }
        } finally {
        }
      }
    }
  } catch (error) {
    console.error("Error getting item details:", error);
    res.status(500).json({ message: "Error getting item details" });
  }
}

router.post("/item-details/:itemId", (req, res) => {
  const { itemId } = req.params;
  processItem(itemId, false, res);
});

router.post("/value-details/:itemId", (req, res) => {
  const { itemId } = req.params;
  processItem(itemId, true, res);
});

module.exports = router;
