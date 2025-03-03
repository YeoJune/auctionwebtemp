// utils/processItem.js
const pool = require("./DB");
const { processImagesInChunks } = require("./processImage");
const {
  ecoAucCrawler,
  ecoAucValueCrawler,
  brandAucCrawler,
  brandAucValueCrawler,
  starAucCrawler,
} = require("../crawlers/index");
const DBManager = require("./DBManager");

async function processItem(itemId, isValue, res, returnData = false) {
  try {
    const tableName = isValue ? "values_items" : "crawled_items";
    const [items] = await pool.query(
      `SELECT * FROM ${tableName} WHERE item_id = ?`,
      [itemId]
    );

    if (items.length === 0) {
      if (returnData) return null;
      return res.status(404).json({ message: "Item not found" });
    }

    let item = items[0];

    if (item.description) {
      if (returnData) return item;
      return res.json(item);
    }

    let crawler;
    if (item.auc_num == 1) {
      if (isValue) crawler = ecoAucValueCrawler;
      else crawler = ecoAucCrawler;
    } else if (item.auc_num == 2) {
      if (isValue) crawler = brandAucValueCrawler;
      else crawler = brandAucCrawler;
    } else if (item.auc_num == 3) {
      if (isValue) crawler = null;
      else crawler = starAucCrawler;
    }

    if (!crawler) {
      if (returnData) return item;
      return res.json(item);
    }

    try {
      const crawledDetails = await crawler.crawlItemDetails(itemId);
      const processedDetails = (
        await processImagesInChunks([crawledDetails])
      )[0];

      if (processedDetails) {
        await DBManager.updateItemDetails(itemId, processedDetails, tableName);

        const [updatedItems] = await pool.query(
          `SELECT * FROM ${tableName} WHERE item_id = ?`,
          [itemId]
        );

        if (returnData) return updatedItems[0];
        return res.json(updatedItems[0]);
      } else {
        if (returnData) return item;
        return res.json(item);
      }
    } catch (error) {
      console.error("Error crawling item details:", error);
      if (returnData) return item;
      return res.json(item);
    }
  } catch (error) {
    console.error("Error getting item details:", error);
    if (returnData) return null;
    return res.status(500).json({ message: "Error getting item details" });
  }
}

module.exports = { processItem };
