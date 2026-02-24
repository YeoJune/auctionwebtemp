// routes/crawler.js
const express = require("express");
const router = express.Router();
const {
  ecoAucCrawler,
  ecoAucValueCrawler,
  brandAucCrawler,
  brandAucValueCrawler,
  starAucCrawler,
  starAucValueCrawler,
  mekikiAucCrawler,
  mekikiAucValueCrawler,
  penguinAucCrawler,
} = require("../crawlers/index");
const DBManager = require("../utils/DBManager");
const { pool } = require("../utils/DB");
const cron = require("node-cron");
const { getAdminSettings } = require("../utils/adminDB");
const { syncAllData } = require("../utils/dataUtils");
const dotenv = require("dotenv");
const socketIO = require("socket.io");
const { sendHigherBidAlerts } = require("../utils/message");
const { ValuesImageMigration } = require("../utils/s3Migration");
const { processImagesInChunks } = require("../utils/processImage");
const esManager = require("../utils/elasticsearch");
const {
  refundDeposit,
  refundLimit,
  getBidDeductAmount,
} = require("../utils/deposit");
const { isAdminUser } = require("../utils/adminAuth");

dotenv.config();

// Elasticsearch ?¨Ïù∏?±Ïã± Î∞∞Ïπò ?¨Í∏∞
const ES_REINDEX_BATCH_SIZE = 10000;

let isCrawling = false;
let isValueCrawling = false;
let isUpdateCrawling = false;
let isUpdateCrawlingWithId = false;

const isAdmin = (req, res, next) => {
  if (isAdminUser(req.session?.user)) {
    next();
  } else {
    res.status(403).json({ message: "Access denied. Admin only." });
  }
};

class AdaptiveScheduler {
  constructor(baseInterval) {
    this.base = baseInterval;
    this.min = baseInterval;
    this.max = baseInterval * 4;
    this.current = baseInterval * 2;
    this.noChangeCount = 0;
  }

  next(changedCount) {
    if (changedCount === 0) {
      // Additive Increase with log acceleration
      this.noChangeCount++;
      const increment = this.base * Math.log2(this.noChangeCount + 1) * 0.1;
      this.current = Math.min(this.current + increment, this.max);
    } else {
      // Multiplicative Decrease
      this.noChangeCount = 0;
      const changeRate = Math.min(changedCount / 10, 1.0);
      const decreaseRate = 0.5 + 0.4 * changeRate;
      this.current = Math.max(this.current * (1 - decreaseRate), this.min);
    }
    return Math.round(this.current);
  }

  reset() {
    this.current = this.base;
    this.noChangeCount = 0;
  }

  getStatus() {
    return {
      current: Math.round(this.current),
      min: this.min,
      max: this.max,
      noChangeCount: this.noChangeCount,
    };
  }
}

// Í≤ΩÎß§???§Ï†ï
const AUCTION_CONFIG = {
  1: {
    name: "EcoAuc",
    crawler: ecoAucCrawler,
    valueCrawler: ecoAucValueCrawler,
    enabled: true,
    updateInterval: parseInt(process.env.UPDATE_INTERVAL, 10) || 40,
    updateWithIdInterval: parseInt(process.env.UPDATE_INTERVAL_ID, 10) || 10,
  },
  2: {
    name: "BrandAuc",
    crawler: brandAucCrawler,
    valueCrawler: brandAucValueCrawler,
    enabled: true,
    updateInterval: parseInt(process.env.UPDATE_INTERVAL, 10) || 40,
    updateWithIdInterval: parseInt(process.env.UPDATE_INTERVAL_ID, 10) || 10,
  },
  3: {
    name: "StarAuc",
    crawler: starAucCrawler,
    valueCrawler: starAucValueCrawler,
    enabled: false,
    updateInterval: parseInt(process.env.UPDATE_INTERVAL, 10) || 40,
    updateWithIdInterval: parseInt(process.env.UPDATE_INTERVAL_ID, 10) || 10,
  },
  4: {
    name: "MekikiAuc",
    crawler: mekikiAucCrawler,
    valueCrawler: mekikiAucValueCrawler,
    enabled: true,
    updateInterval: 0,
    updateWithIdInterval: 0,
  },
  5: {
    name: "PenguinAuc",
    crawler: penguinAucCrawler,
    valueCrawler: null,
    enabled: true,
    updateInterval: parseInt(process.env.UPDATE_INTERVAL, 10) || 40,
    updateWithIdInterval: parseInt(process.env.UPDATE_INTERVAL_ID, 10) || 10,
  },
};

// Í≤ΩÎß§?¨Î≥Ñ ?§Ï?Ï§ÑÎü¨ ?∏Ïä§?¥Ïä§ ?ùÏÑ±
const updateSchedulers = {};
const updateWithIdSchedulers = {};
const crawlingStatus = {
  update: {},
  updateWithId: {},
};

Object.entries(AUCTION_CONFIG).forEach(([aucNum, config]) => {
  if (config.enabled) {
    // updateInterval??0???ÑÎãê ?åÎßå ?§Ï?Ï§ÑÎü¨ ?ùÏÑ±
    if (config.updateInterval > 0) {
      updateSchedulers[aucNum] = new AdaptiveScheduler(config.updateInterval);
      crawlingStatus.update[aucNum] = false;
    }
    // updateWithIdInterval??0???ÑÎãê ?åÎßå ?§Ï?Ï§ÑÎü¨ ?ùÏÑ±
    if (config.updateWithIdInterval > 0) {
      updateWithIdSchedulers[aucNum] = new AdaptiveScheduler(
        config.updateWithIdInterval,
      );
      crawlingStatus.updateWithId[aucNum] = false;
    }
  }
});

async function loginAll() {
  const crawlers = [];

  // Config?êÏÑú ?úÏÑ±?îÎêú Î™®Îì† ?¨Î°§???òÏßë
  Object.values(AUCTION_CONFIG).forEach((config) => {
    if (config.enabled) {
      if (config.crawler) crawlers.push(config.crawler);
      if (config.valueCrawler) crawlers.push(config.valueCrawler);
    }
  });

  await Promise.all(crawlers.map((crawler) => crawler.login()));
}

// Elasticsearch ?ÑÏ≤¥ ?¨Ïù∏?±Ïã± ?®Ïàò
async function reindexElasticsearch(tableName) {
  try {
    if (!esManager.isHealthy()) {
      console.log("ES not available, skipping reindexing");
      return;
    }

    console.log(`\n?îÑ Starting Elasticsearch reindexing for ${tableName}...`);

    // 1. ?∏Îç±????†ú
    try {
      await esManager.deleteIndex(tableName);
      console.log(`??Deleted index: ${tableName}`);
    } catch (error) {
      console.log(`??Index ${tableName} does not exist or already deleted`);
    }

    // 2. ?∏Îç±???¨ÏÉù??
    await esManager.createIndex(tableName);
    console.log(`??Created index: ${tableName}`);

    // 3. ?∞Ïù¥??Ï°∞Ìöå
    const whereClause =
      tableName === "crawled_items"
        ? "WHERE is_enabled = 1 AND title IS NOT NULL"
        : "WHERE title IS NOT NULL";
    const [items] = await pool.query(`
      SELECT 
        item_id, title, brand, category, 
        auc_num, scheduled_date
      FROM ${tableName}
      ${whereClause}
    `);

    if (items.length === 0) {
      console.log(`No items to index in ${tableName}`);
      return;
    }

    console.log(`Found ${items.length} items to reindex`);

    // 4. Î∞∞ÏπòÎ°??∏Îç±??
    let totalIndexed = 0;
    let totalErrors = 0;

    for (let i = 0; i < items.length; i += ES_REINDEX_BATCH_SIZE) {
      const batch = items.slice(i, i + ES_REINDEX_BATCH_SIZE);
      const batchNum = Math.floor(i / ES_REINDEX_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(items.length / ES_REINDEX_BATCH_SIZE);

      const result = await esManager.bulkIndex(tableName, batch);
      totalIndexed += result.indexed;
      totalErrors += result.errors;

      console.log(
        `  Batch ${batchNum}/${totalBatches}: indexed ${result.indexed}, errors ${result.errors}`,
      );

      // Î∞∞Ïπò Í∞?ÏßßÏ? ?ÄÍ∏?
      if (i + ES_REINDEX_BATCH_SIZE < items.length) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    console.log(
      `??Elasticsearch reindexing complete: ${totalIndexed} indexed, ${totalErrors} errors\n`,
    );
  } catch (error) {
    console.error(
      `??Elasticsearch reindexing failed for ${tableName}:`,
      error.message,
    );
    // ?§Ìå®?¥ÎèÑ ?¨Î°§ÎßÅÏ? Í≥ÑÏÜç ÏßÑÌñâ
  }
}

async function crawlAll() {
  if (isCrawling) {
    throw new Error("already crawling");
  } else {
    try {
      const [existingItems] = await pool.query(
        "SELECT item_id, auc_num FROM crawled_items",
      );

      // Config Í∏∞Î∞ò?ºÎ°ú Í∏∞Ï°¥ ?ÑÏù¥??ID Í∑∏Î£π??
      const existingIdsByAuction = {};
      Object.keys(AUCTION_CONFIG).forEach((aucNum) => {
        existingIdsByAuction[aucNum] = new Set(
          existingItems
            .filter((item) => item.auc_num == aucNum)
            .map((item) => item.item_id),
        );
      });

      isCrawling = true;

      // ?úÏÑ±?îÎêú Î™®Îì† Í≤ΩÎß§???¨Î°§Îß?(ÏßÅÎ†¨)
      const allItems = [];
      for (const [aucNum, config] of Object.entries(AUCTION_CONFIG)) {
        if (config.enabled && config.crawler) {
          try {
            const items = await config.crawler.crawlAllItems(
              existingIdsByAuction[aucNum],
            );
            if (items && items.length > 0) {
              allItems.push(...items);
            }
          } catch (error) {
            console.error(`[${config.name}] Crawl failed:`, error);
          }
        }
      }

      await DBManager.saveItems(allItems, "crawled_items");

      // existing ?ÑÏù¥???ÖÎç∞?¥Ìä∏ (title ?ÜÎäî ?ÑÏù¥??
      const itemsToUpdate = allItems.filter(
        (item) => !item.title && item.item_id,
      );
      if (itemsToUpdate.length > 0) {
        await DBManager.updateItems(itemsToUpdate, "crawled_items");
      }

      await DBManager.deleteItemsWithout(
        allItems.map((item) => item.item_id),
        "crawled_items",
      );
      await DBManager.cleanupUnusedImages("products");
      await syncAllData();

      // Elasticsearch ?ÑÏ≤¥ ?¨Ïù∏?±Ïã±
      await reindexElasticsearch("crawled_items");
    } catch (error) {
      throw error;
    } finally {
      isCrawling = false;
      await loginAll();
    }
  }
}

async function crawlAllValues(options = {}) {
  const { aucNums = [], months = [] } = options;

  // ?†ÌÉù???¨Î°§?¨Í? ?ÜÏúºÎ©?Î™®Îëê ?§Ìñâ
  const runAll = aucNums.length === 0;

  // Í∞??¨Î°§???§Ìñâ ?¨Î? Í≤∞Ï†ï
  const runEcoAuc = runAll || aucNums.includes(1);
  const runBrandAuc = runAll || aucNums.includes(2);
  const runStarAuc = runAll || aucNums.includes(3);
  const runMekikiAuc = runAll || aucNums.includes(4);

  // Í∞??¨Î°§?¨Î≥Ñ Í∞úÏõî ??Îß§Ìïë (Í∏∞Î≥∏Í∞? 1Í∞úÏõî)
  const monthsMap = {
    1: 1, // EcoAuc
    2: 1, // BrandAuc
    3: 1, // StarAuc
    4: 1, // MekikiAuc
  };

  // ?ÖÎ†•Î∞õÏ? months Î∞∞Ïó¥???àÏúºÎ©? aucNums?Ä Îß§Ìïë?òÏó¨ ?§Ï†ï
  if (aucNums.length > 0 && months.length > 0) {
    for (let i = 0; i < Math.min(aucNums.length, months.length); i++) {
      monthsMap[aucNums[i]] = months[i];
    }
  }

  if (isValueCrawling) {
    throw new Error("Value crawling already in progress");
  }

  try {
    isValueCrawling = true;
    const startTime = Date.now();

    console.log("Starting value crawling with options:", {
      aucNums: aucNums.length > 0 ? aucNums : "all",
      months: monthsMap,
      runEcoAuc,
      runBrandAuc,
      runStarAuc,
      runMekikiAuc,
    });

    // DB?êÏÑú Í∏∞Ï°¥ ?ÑÏù¥??ID Ï°∞Ìöå
    const [existingItems] = await pool.query(
      "SELECT item_id, auc_num FROM values_items",
    );

    // auc_numÎ≥ÑÎ°ú Í∏∞Ï°¥ ?ÑÏù¥??ID Í∑∏Î£π??
    const existingIdsByAuction = {
      1: new Set(
        existingItems
          .filter((item) => item.auc_num == 1)
          .map((item) => item.item_id),
      ),
      2: new Set(
        existingItems
          .filter((item) => item.auc_num == 2)
          .map((item) => item.item_id),
      ),
      3: new Set(
        existingItems
          .filter((item) => item.auc_num == 3)
          .map((item) => item.item_id),
      ),
      4: new Set(
        existingItems
          .filter((item) => item.auc_num == 4)
          .map((item) => item.item_id),
      ),
    };

    // ?¨Î°§?¨Î≥Ñ ?§Ï†ï
    const crawlerConfigs = [
      {
        enabled: runEcoAuc,
        aucNum: 1,
        name: "EcoAuc",
        crawler: ecoAucValueCrawler,
        months: monthsMap[1],
        folderName: "values",
        priority: 3,
        cropType: null,
        existingIds: existingIdsByAuction[1],
      },
      {
        enabled: runBrandAuc,
        aucNum: 2,
        name: "BrandAuc",
        crawler: brandAucValueCrawler,
        months: monthsMap[2],
        folderName: "values",
        priority: 3,
        cropType: "brand",
        existingIds: existingIdsByAuction[2],
      },
      {
        enabled: runStarAuc,
        aucNum: 3,
        name: "StarAuc",
        crawler: starAucValueCrawler,
        months: monthsMap[3],
        folderName: "values",
        priority: 3,
        cropType: null,
        existingIds: existingIdsByAuction[3],
      },
      {
        enabled: runMekikiAuc,
        aucNum: 4,
        name: "MekikiAuc",
        crawler: mekikiAucValueCrawler,
        months: monthsMap[4],
        folderName: "values",
        priority: 3,
        cropType: null,
        existingIds: existingIdsByAuction[4],
      },
    ];

    const results = {};

    // Í∞??¨Î°§???úÏ∞® ?§Ìñâ
    for (const config of crawlerConfigs) {
      if (!config.enabled) {
        results[config.name] = 0;
        continue;
      }

      console.log(`\n${"=".repeat(60)}`);
      console.log(
        `Starting ${config.name} value crawler for ${config.months} months`,
      );
      console.log("=".repeat(60));

      try {
        // 1. Î©îÌ??∞Ïù¥???òÏßë
        const metadata = await config.crawler.getStreamingMetadata(
          config.months,
        );
        console.log(`Total chunks to process: ${metadata.totalChunks}`);

        let processedChunks = 0;
        let totalItems = 0;

        // 2. Ï≤?Å¨Î≥??§Ìä∏Î¶¨Î∞ç Ï≤òÎ¶¨
        for (const chunk of metadata.chunks) {
          processedChunks++;
          console.log(
            `\n[${processedChunks}/${metadata.totalChunks}] Processing chunk...`,
          );

          const chunkItems = await processChunk(
            config.crawler,
            chunk,
            config.existingIds,
            {
              folderName: config.folderName,
              priority: config.priority,
              cropType: config.cropType,
              tableName: "values_items",
            },
          );

          totalItems += chunkItems;
        }

        results[config.name] = totalItems;
        console.log(
          `\n${config.name} completed: ${totalItems} items processed`,
        );
      } catch (error) {
        console.error(`${config.name} crawling failed:`, error.message);
        results[config.name] = 0;
      }
    }

    // 3. ÏµúÏ¢Ö ?ïÎ¶¨
    console.log("\n=== Finalizing value crawling ===");
    await DBManager.cleanupOldValueItems(999);
    await processBidsAfterCrawl();
    console.log("Cleanup completed");

    const endTime = Date.now();
    const totalCount = Object.values(results).reduce(
      (sum, count) => sum + count,
      0,
    );

    console.log(
      `\nValue crawling completed in ${formatExecutionTime(
        endTime - startTime,
      )}`,
    );

    // Elasticsearch ?ÑÏ≤¥ ?¨Ïù∏?±Ïã±
    await reindexElasticsearch("values_items");

    return {
      settings: {
        aucNums: aucNums.length > 0 ? aucNums : [1, 2, 3, 4],
        months: monthsMap,
      },
      results: {
        ecoAucCount: results.EcoAuc || 0,
        brandAucCount: results.BrandAuc || 0,
        starAucCount: results.StarAuc || 0,
        mekikiAucCount: results.MekikiAuc || 0,
        totalCount: totalCount,
      },
    };
  } catch (error) {
    console.error("Value crawling failed:", error);
    throw error;
  } finally {
    isValueCrawling = false;
  }
}

/**
 * ?®Ïùº Ï≤?Å¨ Ï≤òÎ¶¨: ?¨Î°§Îß????¥Î?ÏßÄ ??DB ??S3
 */
async function processChunk(crawler, chunk, existingIds, options) {
  const { folderName, priority, cropType, tableName } = options;

  console.log(`\n=== Processing chunk ${chunk.startPage}-${chunk.endPage} ===`);
  if (chunk.categoryId) {
    console.log(`Category: ${chunk.categoryId}`);
  } else if (chunk.eventId) {
    console.log(`Event: ${chunk.eventId} (${chunk.eventTitle})`);
  } else if (chunk.bidType) {
    console.log(`Bid Type: ${chunk.bidType}`);
  }

  try {
    // Step 1: ?¨Î°§Îß?(Î≥ëÎ†¨)
    const items = await crawler.crawlChunkPages(chunk, existingIds);

    if (items.length === 0) {
      console.log("No items in chunk, skipping");
      return 0;
    }

    console.log(`Crawled ${items.length} items`);

    // Step 2: Î°úÏª¨ ?¥Î?ÏßÄ ?Ä??
    const itemsWithLocalImages = await processImagesInChunks(
      items,
      folderName,
      priority,
      cropType,
    );

    console.log(`Processed images for ${itemsWithLocalImages.length} items`);

    // Step 3: DB ?Ä??
    await DBManager.saveItems(itemsWithLocalImages, tableName);
    console.log("Saved to DB");

    // Step 4: S3 ÎßàÏù¥Í∑∏Î†à?¥ÏÖò (valuesÎß?
    if (folderName === "values") {
      await migrateChunkToS3(itemsWithLocalImages);
      console.log("Migrated to S3 and cleaned local files");
    }

    // Î©îÎ™®Î¶??ïÎ¶¨
    const itemCount = itemsWithLocalImages.length;
    items.length = 0;
    itemsWithLocalImages.length = 0;

    return itemCount;
  } catch (error) {
    console.error(`Chunk processing failed:`, error.message);
    // ?§Ìå®?¥ÎèÑ Í≥ÑÏÜç ÏßÑÌñâ
    return 0;
  }
}

/**
 * Ï≤?Å¨ ?®ÏúÑ S3 ÎßàÏù¥Í∑∏Î†à?¥ÏÖò
 */
async function migrateChunkToS3(items) {
  const { ValuesImageMigration } = require("../utils/s3Migration");
  const migration = new ValuesImageMigration();

  try {
    const result = await migration.processItemsBatch(items);

    // Î°úÏª¨ ?åÏùº Ï¶âÏãú ??†ú
    await migration.cleanupLocalFiles(result.success);

    return result;
  } catch (error) {
    console.error("S3 migration failed:", error.message);
    // ÎßàÏù¥Í∑∏Î†à?¥ÏÖò ?§Ìå®?¥ÎèÑ Í≥ÑÏÜç ÏßÑÌñâ
    return { success: [], failed: items };
  }
}

// Í∞úÎ≥Ñ Í≤ΩÎß§???ÖÎç∞?¥Ìä∏ ?¨Î°§Îß?
async function crawlUpdateForAuction(aucNum) {
  const config = AUCTION_CONFIG[aucNum];

  if (!config || !config.enabled) {
    console.log(`Auction ${aucNum} is not enabled`);
    return null;
  }

  // ?ÑÏó≠ ?¨Î°§Îß?Ï≤¥ÌÅ¨
  if (isCrawling || isValueCrawling) {
    throw new Error("Another global crawling in progress");
  }

  // ?¥Îãπ Í≤ΩÎß§???¨Î°§Îß?Ï≤¥ÌÅ¨
  if (crawlingStatus.update[aucNum]) {
    throw new Error(`Auction ${config.name} update already in progress`);
  }

  crawlingStatus.update[aucNum] = true;
  const startTime = Date.now();
  console.log(
    `[${config.name}] Starting update crawl at ${new Date().toISOString()}`,
  );

  try {
    // ?¨Î°§Îß??§Ìñâ
    let updates = await config.crawler.crawlUpdates();
    if (!updates) updates = [];

    if (updates.length === 0) {
      console.log(`[${config.name}] No updates found`);
      return {
        aucNum,
        name: config.name,
        count: 0,
        changedItemsCount: 0,
        executionTime: formatExecutionTime(Date.now() - startTime),
      };
    }

    // DB?êÏÑú Í∏∞Ï°¥ ?∞Ïù¥??Í∞Ä?∏Ïò§Í∏?
    const itemIds = updates.map((item) => item.item_id);
    const [existingItems] = await pool.query(
      "SELECT item_id, scheduled_date, starting_price FROM crawled_items WHERE item_id IN (?) AND bid_type = 'direct' AND auc_num = ?",
      [itemIds, aucNum],
    );

    // Î≥ÄÍ≤ΩÎêú ?ÑÏù¥???ÑÌÑ∞Îß?
    const changedItems = updates.filter((newItem) => {
      const existingItem = existingItems.find(
        (item) => item.item_id === newItem.item_id,
      );

      if (!existingItem) {
        return false;
      }

      let dateChanged = false;
      if (newItem.scheduled_date) {
        const newDate = new Date(newItem.scheduled_date);
        const existingDate = new Date(existingItem.scheduled_date);
        dateChanged = newDate.getTime() !== existingDate.getTime();
      }

      let priceChanged = false;
      if (newItem.starting_price) {
        const newPrice = parseFloat(newItem.starting_price) || 0;
        const existingPrice = parseFloat(existingItem.starting_price) || 0;
        priceChanged = Math.abs(newPrice - existingPrice) > 0.01;
      }

      return dateChanged || priceChanged;
    });

    // Î≥ÄÍ≤ΩÎêú ?ÑÏù¥?úÏù¥ ?àÏúºÎ©?DB ?ÖÎç∞?¥Ìä∏ ÎπÑÎèôÍ∏∞Î°ú ?§Ìñâ
    if (changedItems.length > 0) {
      console.log(
        `[${config.name}] Found ${changedItems.length} changed items`,
      );
      DBManager.updateItems(changedItems, "crawled_items").then(() => {
        processChangedBids(changedItems).then(() => {
          notifyClientsOfChanges(changedItems);
        });
      });
    }

    const executionTime = Date.now() - startTime;
    console.log(
      `[${config.name}] Update crawl completed in ${formatExecutionTime(
        executionTime,
      )}`,
    );

    return {
      aucNum,
      name: config.name,
      count: updates.length,
      changedItemsCount: changedItems.length,
      executionTime: formatExecutionTime(executionTime),
    };
  } catch (error) {
    console.error(`[${config.name}] Update crawl failed:`, error);
    throw error;
  } finally {
    crawlingStatus.update[aucNum] = false;
  }
}

// Í∞úÎ≥Ñ Í≤ΩÎß§??ID Í∏∞Î∞ò ?ÖÎç∞?¥Ìä∏ ?¨Î°§Îß?
async function crawlUpdateWithIdForAuction(aucNum, itemIds, originalItems) {
  const config = AUCTION_CONFIG[aucNum];

  if (!config || !config.enabled) {
    console.log(`Auction ${aucNum} is not enabled`);
    return null;
  }

  // ?ÑÏó≠ ?¨Î°§Îß?Ï≤¥ÌÅ¨
  if (isCrawling || isValueCrawling) {
    throw new Error("Another global crawling in progress");
  }

  // ?¥Îãπ Í≤ΩÎß§???¨Î°§Îß?Ï≤¥ÌÅ¨
  if (crawlingStatus.updateWithId[aucNum]) {
    throw new Error(`Auction ${config.name} updateWithId already in progress`);
  }

  if (!itemIds || itemIds.length === 0) {
    return {
      aucNum,
      name: config.name,
      count: 0,
      changedItemsCount: 0,
    };
  }

  crawlingStatus.updateWithId[aucNum] = true;
  const startTime = Date.now();
  console.log(
    `[${config.name}] Starting updateWithId for ${itemIds.length} items`,
  );

  try {
    // ?¨Î°§Îß??§Ìñâ
    let updates = await config.crawler.crawlUpdateWithIds(itemIds);
    if (!updates) updates = [];

    // Î≥ÄÍ≤ΩÎêú ??™© ?ÑÌÑ∞Îß?
    const changedItems = updates.filter((newItem) => {
      const originalItem = originalItems[newItem.item_id];
      if (!originalItem) {
        return false;
      }

      // ?†Ïßú Î≥ÄÍ≤??ïÏù∏
      let dateChanged = false;
      if (newItem.scheduled_date) {
        const newDate = new Date(newItem.scheduled_date);
        const originalDate = new Date(originalItem.scheduled_date);
        dateChanged = newDate.getTime() !== originalDate.getTime();
      }

      // Í∞ÄÍ≤?Î≥ÄÍ≤??ïÏù∏
      let priceChanged = false;
      if (newItem.starting_price) {
        const newPrice = parseFloat(newItem.starting_price) || 0;
        const originalPrice = parseFloat(originalItem.starting_price) || 0;
        priceChanged = Math.abs(newPrice - originalPrice) > 0.01;
      }

      return dateChanged || priceChanged;
    });

    // Î≥ÄÍ≤ΩÎêú ?ÑÏù¥?úÏù¥ ?àÏúºÎ©?DB ?ÖÎç∞?¥Ìä∏ ÎπÑÎèôÍ∏∞Î°ú ?§Ìñâ
    if (changedItems.length > 0) {
      console.log(
        `[${config.name}] Found ${changedItems.length} changed items`,
      );
      DBManager.updateItems(changedItems, "crawled_items").then(() => {
        processChangedBids(changedItems).then(() => {
          notifyClientsOfChanges(changedItems);
        });
      });
    }

    const executionTime = Date.now() - startTime;
    console.log(
      `[${config.name}] UpdateWithId completed in ${formatExecutionTime(
        executionTime,
      )}`,
    );

    return {
      aucNum,
      name: config.name,
      count: updates.length,
      changedItemsCount: changedItems.length,
      executionTime: formatExecutionTime(executionTime),
    };
  } catch (error) {
    console.error(`[${config.name}] UpdateWithId failed:`, error);
    throw error;
  } finally {
    crawlingStatus.updateWithId[aucNum] = false;
  }
}

// live_bids??winning_price ?êÎèô ?ÖÎç∞?¥Ìä∏ Ï≤òÎ¶¨
async function processBidsAfterCrawl() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. ?¥Î? cancelled ?ÅÌÉú???ÖÏ∞∞?§Ïùò winning_price ?ÖÎç∞?¥Ìä∏
    await conn.query(
      `UPDATE live_bids lb
       JOIN values_items vi ON lb.item_id = vi.item_id
       SET lb.winning_price = vi.final_price
       WHERE lb.status = 'cancelled' AND (lb.winning_price IS NULL OR lb.winning_price < vi.final_price)`,
    );

    // ?∞ÏÑ† final_priceÎ°??ÖÎç∞?¥Ìä∏
    await conn.query(
      `UPDATE direct_bids db
       JOIN values_items vi ON db.item_id = vi.item_id
       SET db.winning_price = vi.final_price
       WHERE db.status = 'cancelled' AND (db.winning_price IS NULL OR db.winning_price < vi.final_price)`,
    );

    // 2. final ?ÅÌÉú?¥Î©¥??final_price < vi.final_price???ÖÏ∞∞??Ï°∞Ìöå
    const [bidsToCancel] = await conn.query(
      `SELECT lb.id, lb.user_id, vi.final_price, u.account_type
       FROM live_bids lb
       JOIN values_items vi ON lb.item_id = vi.item_id
       JOIN user_accounts u ON lb.user_id = u.user_id
       WHERE lb.status = 'final' AND lb.final_price < vi.final_price`,
    );

    if (bidsToCancel.length > 0) {
      const bidIds = bidsToCancel.map((bid) => bid.id);
      const placeholders = bidIds.map(() => "?").join(",");

      // Í∞??ÖÏ∞∞???Ä???àÏπòÍ∏??úÎèÑ Î≥µÍµ¨
      for (const bid of bidsToCancel) {
        const deductAmount = await getBidDeductAmount(conn, bid.id, "live_bid");

        if (deductAmount > 0) {
          if (bid.account_type === "individual") {
            await refundDeposit(
              conn,
              bid.user_id,
              deductAmount,
              "live_bid",
              bid.id,
              "?ôÏ∞∞Í∞Ä Ï¥àÍ≥ºÎ°??∏Ìïú Ï∑®ÏÜå ?òÎ∂à",
            );
          } else {
            await refundLimit(
              conn,
              bid.user_id,
              deductAmount,
              "live_bid",
              bid.id,
              "?ôÏ∞∞Í∞Ä Ï¥àÍ≥ºÎ°??∏Ìïú Ï∑®ÏÜå ?òÎ∂à",
            );
          }
        }
      }

      // statusÎ•?cancelledÎ°?Î≥ÄÍ≤ΩÌïòÍ≥?winning_price ?§Ï†ï
      await conn.query(
        `UPDATE live_bids lb
         JOIN values_items vi ON lb.item_id = vi.item_id
         SET lb.status = 'cancelled', lb.winning_price = vi.final_price
         WHERE lb.id IN (${placeholders})`,
        bidIds,
      );
    }

    await conn.commit();
    console.log("Winning_price updated successfully after crawl");
  } catch (error) {
    await conn.rollback();
    console.error("Error processing live bids after crawl:", error);
  } finally {
    conn.release();
  }
}

// Í∞ÄÍ≤?Î≥ÄÍ≤ΩÏóê ?∞Î•∏ ?ÖÏ∞∞ Ï∑®ÏÜå Ï≤òÎ¶¨
async function processChangedBids(changedItems) {
  // Ï≤òÎ¶¨??Í≤ÉÏù¥ ?ÜÏúºÎ©?Îπ†Î•¥Í≤?Ï¢ÖÎ£å
  if (!changedItems || changedItems.length === 0) return;

  // Í∞ÄÍ≤©Ïù¥ Î≥ÄÍ≤ΩÎêú ?ÑÏù¥?úÎßå ?ÑÌÑ∞Îß?
  const priceChangedItems = changedItems.filter((item) => item.starting_price);
  if (priceChangedItems.length === 0) return;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Í¥Ä?®Îêú Î™®Îì† active ?ÖÏ∞∞ Ï°∞Ìöå (account_type ?¨Ìï®)
    const [activeBids] = await conn.query(
      "SELECT db.id, db.item_id, db.user_id, db.current_price, ci.starting_price, u.account_type " +
        "FROM direct_bids db " +
        "JOIN crawled_items ci ON db.item_id = ci.item_id " +
        "JOIN user_accounts u ON db.user_id = u.user_id " +
        "WHERE db.current_price < ci.starting_price AND db.status = 'active'",
    );

    // Ï∑®ÏÜå?¥Ïïº ???ÖÏ∞∞ ID Ï∞æÍ∏∞
    const bidsToCancel = activeBids.map((bid) => bid.id);

    let cancelledBidsData = [];
    if (bidsToCancel.length > 0) {
      [cancelledBidsData] = await conn.query(
        `SELECT db.user_id, i.title 
        FROM direct_bids db 
        JOIN crawled_items i ON db.item_id = i.item_id 
        WHERE db.id IN (${bidsToCancel.map(() => "?").join(",")})`,
        bidsToCancel,
      );
    }

    // ?àÏπòÍ∏??úÎèÑ Î≥µÍµ¨ Î∞?Ï∑®ÏÜå Ï≤òÎ¶¨ - 100Í∞úÏî© Î∞∞Ïπò Ï≤òÎ¶¨
    for (let i = 0; i < activeBids.length; i += 100) {
      const batch = activeBids.slice(i, i + 100);

      if (batch.length > 0) {
        // Í∞??ÖÏ∞∞???Ä???àÏπòÍ∏??úÎèÑ Î≥µÍµ¨
        for (const bid of batch) {
          const deductAmount = await getBidDeductAmount(
            conn,
            bid.id,
            "direct_bid",
          );

          if (deductAmount > 0) {
            if (bid.account_type === "individual") {
              await refundDeposit(
                conn,
                bid.user_id,
                deductAmount,
                "direct_bid",
                bid.id,
                "Í∞ÄÍ≤?Î≥ÄÍ≤ΩÏúºÎ°??∏Ìïú Ï∑®ÏÜå ?òÎ∂à",
              );
            } else {
              await refundLimit(
                conn,
                bid.user_id,
                deductAmount,
                "direct_bid",
                bid.id,
                "Í∞ÄÍ≤?Î≥ÄÍ≤ΩÏúºÎ°??∏Ìïú Ï∑®ÏÜå ?òÎ∂à",
              );
            }
          }
        }

        // ?ÖÏ∞∞ ?ÅÌÉú Î≥ÄÍ≤?
        const batchIds = batch.map((b) => b.id);
        await conn.query(
          "UPDATE direct_bids SET status = 'cancelled' WHERE id IN (?) AND status = 'active'",
          [batchIds],
        );

        console.log(
          `Cancelled batch ${Math.floor(i / 100) + 1}: ${
            batch.length
          } bids due to price changes (deposits/limits refunded)`,
        );
      }
    }

    await conn.commit();

    // Ï∑®ÏÜå???ÖÏ∞∞?êÎì§?êÍ≤å ?åÎ¶º Î∞úÏÜ° (ÎπÑÎèôÍ∏?
    if (cancelledBidsData.length > 0) {
      sendHigherBidAlerts(cancelledBidsData);
    }

    console.log(
      `Total cancelled due to price changes: ${bidsToCancel.length} bids`,
    );
  } catch (error) {
    await conn.rollback();
    console.error("Error cancelling bids:", error);
  } finally {
    conn.release();
  }
}

// ?∏Î≥¥?¥Ïä§ ?¨Î°§Îß??®Ïàò
async function crawlAllInvoices() {
  try {
    console.log(`Starting invoice crawl at ${new Date().toISOString()}`);
    const startTime = Date.now();

    // Config Í∏∞Î∞ò?ºÎ°ú ?úÏÑ±?îÎêú ?¨Î°§?¨Ïóê???∏Î≥¥?¥Ïä§ ?¨Î°§Îß?
    const invoicePromises = [];
    const resultsByAucNum = {};

    Object.entries(AUCTION_CONFIG).forEach(([aucNum, config]) => {
      if (config.enabled && config.crawler && config.crawler.crawlInvoices) {
        invoicePromises.push(
          config.crawler
            .crawlInvoices()
            .then((invoices) => {
              resultsByAucNum[aucNum] = invoices || [];
              return invoices || [];
            })
            .catch((error) => {
              console.error(`[${config.name}] Invoice crawl failed:`, error);
              resultsByAucNum[aucNum] = [];
              return [];
            }),
        );
      }
    });

    const results = await Promise.all(invoicePromises);
    const allInvoices = results.flat();

    // DB???Ä??
    await DBManager.saveItems(allInvoices, "invoices");

    const endTime = Date.now();
    const executionTime = endTime - startTime;

    console.log(
      `Invoice crawl completed in ${formatExecutionTime(executionTime)}`,
    );

    return {
      ecoAucCount: resultsByAucNum[1]?.length || 0,
      brandAucCount: resultsByAucNum[2]?.length || 0,
      starAucCount: resultsByAucNum[3]?.length || 0,
      mekikiAucCount: resultsByAucNum[4]?.length || 0,
      totalCount: allInvoices.length,
      executionTime: formatExecutionTime(executionTime),
    };
  } catch (error) {
    console.error("Invoice crawl failed:", error);
    throw error;
  }
}

// ?ÑÏû• Í≤ΩÎß§ ?ÑÎ£å/Ï∂úÍ≥† Ïπ¥ÌÖåÍ≥†Î¶¨???ôÏ∞∞Í∏àÏï°(winning_price)??values_items.final_priceÎ°???ñ¥?∞Í∏∞
async function overwriteValuesFinalPriceFromLiveBids() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [matchedRows] = await conn.query(`
      SELECT COUNT(*) AS matchedCount
      FROM (
        SELECT vi.item_id
        FROM values_items vi
        JOIN (
          SELECT item_id, MAX(winning_price) AS winning_price
          FROM live_bids
          WHERE winning_price IS NOT NULL
            AND winning_price > 0
            AND status = 'completed'
          GROUP BY item_id
        ) lb ON vi.item_id = lb.item_id
      ) AS matched
    `);

    const [updateResult] = await conn.query(`
      UPDATE values_items vi
      JOIN (
        SELECT item_id, MAX(winning_price) AS winning_price
        FROM live_bids
        WHERE winning_price IS NOT NULL
          AND winning_price > 0
          AND status = 'completed'
        GROUP BY item_id
      ) lb ON vi.item_id = lb.item_id
      SET vi.final_price = lb.winning_price
      WHERE vi.final_price IS NULL
         OR ABS(CAST(vi.final_price AS DECIMAL(15,2)) - lb.winning_price) > 0.01
    `);

    await conn.commit();

    return {
      matchedCount: matchedRows[0]?.matchedCount || 0,
      updatedCount: updateResult.affectedRows || 0,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// ?§Ìñâ ?úÍ∞Ñ ?¨Îß∑???®Ïàò
function formatExecutionTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const remainingMinutes = minutes % 60;
  const remainingSeconds = seconds % 60;

  return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
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
    // auc_num ?åÎùºÎØ∏ÌÑ∞ ?åÏã± (auc_num=1,2,3 ?ïÌÉúÎ°?Î∞õÏùå)
    const aucNums = req.query.auc_num
      ? req.query.auc_num.split(",").map((num) => parseInt(num.trim()))
      : [];

    // months ?åÎùºÎØ∏ÌÑ∞ ?åÏã± (months=3,6,12 ?ïÌÉúÎ°?Î∞õÏùå)
    const monthsInput = req.query.months
      ? req.query.months.split(",").map((m) => parseInt(m.trim()))
      : [];

    // Í≤∞Í≥º Î∞??§Ìñâ ?ïÎ≥¥
    const result = await crawlAllValues({
      aucNums,
      months: monthsInput,
    });

    res.json({
      message: "Value crawling completed successfully",
      result,
    });
  } catch (error) {
    console.error("Value crawling error:", error);
    res
      .status(500)
      .json({ message: "Error during value crawling", error: error.message });
  }
});

router.get("/crawl-status", isAdmin, (req, res) => {
  try {
    // Í∞?Í≤ΩÎß§?¨Î≥Ñ ?§Ï?Ï§ÑÎü¨ ?ÅÌÉú
    const auctionStatuses = {};
    Object.keys(AUCTION_CONFIG).forEach((aucNum) => {
      const config = AUCTION_CONFIG[aucNum];
      auctionStatuses[aucNum] = {
        name: config.name,
        enabled: config.enabled,
        update: {
          crawling: crawlingStatus.update[aucNum] || false,
          scheduler: updateSchedulers[aucNum]?.getStatus() || null,
        },
        updateWithId: {
          crawling: crawlingStatus.updateWithId[aucNum] || false,
          scheduler: updateWithIdSchedulers[aucNum]?.getStatus() || null,
        },
      };
    });

    res.json({
      global: {
        isCrawling,
        isValueCrawling,
        isUpdateCrawling,
        isUpdateCrawlingWithId,
      },
      auctions: auctionStatuses,
    });
  } catch (error) {
    console.error("Crawling status error:", error);
    res.status(500).json({ message: "Error getting crawling status" });
  }
});

// ?∏Î≥¥?¥Ïä§ ?¨Î°§Îß??ºÏö∞??Ï∂îÍ?
router.get("/crawl-invoices", isAdmin, async (req, res) => {
  try {
    const result = await crawlAllInvoices();

    res.json({
      message: "Invoice crawling completed successfully",
      stats: result,
    });
  } catch (error) {
    console.error("Invoice crawling error:", error);
    res.status(500).json({
      message: "Error during invoice crawling",
      error: error.message,
    });
  }
});

router.post("/migrate-to-s3", isAdmin, async (req, res) => {
  try {
    const migration = new ValuesImageMigration();
    const stats = await migration.migrate();

    res.json({
      message: "Migration completed",
      stats,
    });
  } catch (error) {
    console.error("Migration error:", error);
    res.status(500).json({
      message: "Migration failed",
      error: error.message,
    });
  }
});

router.post("/overwrite-values-final-price", isAdmin, async (req, res) => {
  try {
    if (isCrawling || isValueCrawling) {
      return res.status(409).json({
        message: "Crawling in progress. Please try again after crawling ends.",
      });
    }

    const stats = await overwriteValuesFinalPriceFromLiveBids();

    if (stats.updatedCount > 0) {
      await reindexElasticsearch("values_items");
    }

    res.json({
      message:
        "values_items.final_price overwritten from live_bids.winning_price (completed/shipped)",
      stats,
    });
  } catch (error) {
    console.error("Overwrite values final_price error:", error);
    res.status(500).json({
      message: "Error overwriting values final_price",
      error: error.message,
    });
  }
});

router.get("/migration-status", isAdmin, async (req, res) => {
  try {
    const migration = new ValuesImageMigration();
    const remainingCount = await migration.getRemainingCount();

    res.json({
      remainingCount,
      estimatedBatches: Math.ceil(remainingCount / 50),
    });
  } catch (error) {
    console.error("Status check error:", error);
    res.status(500).json({
      message: "Status check failed",
      error: error.message,
    });
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
          // Í∏∞Î≥∏ ?ÅÌíà ?¨Î°§Îß??§Ìñâ
          await crawlAll();

          // ?úÏÑ∏???¨Î°§ÎßÅÎèÑ ?§Ìñâ
          console.log("Running value crawling");
          await crawlAllValues();

          // ?∏Î≥¥?¥Ïä§ ?¨Î°§ÎßÅÎèÑ ?§Ìñâ
          console.log("Running invoice crawling");
          await crawlAllInvoices();

          console.log("Scheduled crawling completed successfully");
        } catch (error) {
          console.error("Scheduled crawling error:", error);
        }
      },
      {
        scheduled: true,
        timezone: "Asia/Seoul",
      },
    );
  }
};

// Í∞úÎ≥Ñ Í≤ΩÎß§?¨Î≥Ñ ?ÖÎç∞?¥Ìä∏ ?¨Î°§Îß??§Ï?Ï§ÑÎßÅ
const scheduleUpdateCrawlingForAuction = (aucNum) => {
  const config = AUCTION_CONFIG[aucNum];
  const scheduler = updateSchedulers[aucNum];

  if (!config || !scheduler || config.updateInterval === 0) {
    console.log(`Update crawling disabled for auction ${aucNum}`);
    return null;
  }

  let timeoutId;

  const runUpdateCrawl = async () => {
    console.log(
      `[${config.name}] Running update crawl (interval: ${
        scheduler.getStatus().current
      }s)`,
    );

    try {
      if (!isCrawling && !isValueCrawling) {
        const result = await crawlUpdateForAuction(aucNum);

        if (result) {
          const nextInterval = scheduler.next(result.changedItemsCount);
          console.log(
            `[${config.name}] Completed - changed: ${result.changedItemsCount}, next: ${nextInterval}s`,
          );
          timeoutId = setTimeout(runUpdateCrawl, nextInterval * 1000);
        } else {
          timeoutId = setTimeout(runUpdateCrawl, scheduler.base * 1000);
        }
      } else {
        console.log(`[${config.name}] Skipped - global crawling active`);
        timeoutId = setTimeout(runUpdateCrawl, scheduler.current * 1000);
      }
    } catch (error) {
      console.error(`[${config.name}] Error:`, error.message);
      timeoutId = setTimeout(runUpdateCrawl, scheduler.base * 1000);
    }
  };

  // Ï≤??úÎ†à?????§Ìñâ
  timeoutId = setTimeout(runUpdateCrawl, scheduler.base * 1000);

  return () => clearTimeout(timeoutId);
};

// Î™®Îì† ?úÏÑ±?îÎêú Í≤ΩÎß§?¨Ïùò ?ÖÎç∞?¥Ìä∏ ?¨Î°§Îß??§Ï?Ï§ÑÎßÅ
const scheduleUpdateCrawling = () => {
  const cancelFunctions = [];

  Object.keys(AUCTION_CONFIG).forEach((aucNum) => {
    if (AUCTION_CONFIG[aucNum].enabled) {
      const cancelFn = scheduleUpdateCrawlingForAuction(parseInt(aucNum));
      if (cancelFn) {
        cancelFunctions.push(cancelFn);
      }
    }
  });

  // Î™®Îì† ?§Ï?Ï§?Ï∑®ÏÜå ?®Ïàò Î∞òÌôò
  return () => {
    cancelFunctions.forEach((fn) => fn());
  };
};

// Í∞úÎ≥Ñ Í≤ΩÎß§?¨Î≥Ñ ID Í∏∞Î∞ò ?ÖÎç∞?¥Ìä∏ ?¨Î°§Îß??§Ï?Ï§ÑÎßÅ
const scheduleUpdateCrawlingWithIdForAuction = (aucNum) => {
  const config = AUCTION_CONFIG[aucNum];
  const scheduler = updateWithIdSchedulers[aucNum];

  if (!config || !scheduler || config.updateWithIdInterval === 0) {
    console.log(`UpdateWithId crawling disabled for auction ${aucNum}`);
    return null;
  }

  let timeoutId;

  const runUpdateCrawlWithId = async () => {
    console.log(
      `[${config.name}] Running updateWithId (interval: ${
        scheduler.getStatus().current
      }s)`,
    );

    try {
      if (!isCrawling && !isValueCrawling) {
        // active bidsÎ•?Ï°∞Ìöå?òÍ≥† ?¥Îãπ Í≤ΩÎß§???ÑÏù¥?úÎßå ?ÑÌÑ∞Îß?
        const [activeBids] = await pool.query(
          `SELECT DISTINCT db.item_id, ci.scheduled_date, ci.starting_price
           FROM direct_bids db
           JOIN crawled_items ci ON db.item_id = ci.item_id
           WHERE ci.bid_type = 'direct' 
             AND ci.auc_num = ?
             AND db.status = 'active'
             AND ci.scheduled_date >= DATE_SUB(NOW(), INTERVAL 10 HOUR)`,
          [aucNum],
        );

        if (activeBids.length > 0) {
          const itemIds = activeBids.map((bid) => bid.item_id);
          const originalItems = {};
          activeBids.forEach((bid) => {
            originalItems[bid.item_id] = {
              item_id: bid.item_id,
              scheduled_date: bid.scheduled_date,
              starting_price: bid.starting_price,
            };
          });

          const result = await crawlUpdateWithIdForAuction(
            aucNum,
            itemIds,
            originalItems,
          );

          if (result) {
            const nextInterval = scheduler.next(result.changedItemsCount);
            console.log(
              `[${config.name}] Completed - changed: ${result.changedItemsCount}, next: ${nextInterval}s`,
            );
            timeoutId = setTimeout(runUpdateCrawlWithId, nextInterval * 1000);
          } else {
            timeoutId = setTimeout(runUpdateCrawlWithId, scheduler.base * 1000);
          }
        } else {
          const nextInterval = scheduler.next(0);
          timeoutId = setTimeout(runUpdateCrawlWithId, nextInterval * 1000);
        }
      } else {
        console.log(`[${config.name}] Skipped - global crawling active`);
        timeoutId = setTimeout(runUpdateCrawlWithId, scheduler.current * 1000);
      }
    } catch (error) {
      console.error(`[${config.name}] Error:`, error.message);
      timeoutId = setTimeout(runUpdateCrawlWithId, scheduler.base * 1000);
    }
  };

  // Ï≤??úÎ†à?????§Ìñâ
  timeoutId = setTimeout(runUpdateCrawlWithId, scheduler.base * 1000);

  return () => clearTimeout(timeoutId);
};

// Î™®Îì† ?úÏÑ±?îÎêú Í≤ΩÎß§?¨Ïùò ID Í∏∞Î∞ò ?ÖÎç∞?¥Ìä∏ ?¨Î°§Îß??§Ï?Ï§ÑÎßÅ
const scheduleUpdateCrawlingWithId = () => {
  const cancelFunctions = [];

  Object.keys(AUCTION_CONFIG).forEach((aucNum) => {
    if (AUCTION_CONFIG[aucNum].enabled) {
      const cancelFn = scheduleUpdateCrawlingWithIdForAuction(parseInt(aucNum));
      if (cancelFn) {
        cancelFunctions.push(cancelFn);
      }
    }
  });

  // Î™®Îì† ?§Ï?Ï§?Ï∑®ÏÜå ?®Ïàò Î∞òÌôò
  return () => {
    cancelFunctions.forEach((fn) => fn());
  };
};

// Socket.IO Ï¥àÍ∏∞??(server.js?êÏÑú Î∂àÎü¨??
function initializeSocket(server) {
  const io = socketIO(server);

  // ?¥Îùº?¥Ïñ∏???∞Í≤∞ ?¥Î≤§??
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
    });
  });

  return io;
}

// ?úÎ≤Ñ?êÏÑú ?∞Ïù¥??Î≥ÄÍ≤?Í∞êÏ? ???åÎ¶º ?ÑÏÜ°
async function notifyClientsOfChanges(changedItems) {
  if (!global.io || changedItems.length === 0) return;

  // Î≥ÄÍ≤ΩÎêú ?ÑÏù¥??IDÎß??ÑÏÜ°
  const changedItemIds = changedItems.map((item) => item.item_id);
  global.io.emit("data-updated", {
    itemIds: changedItemIds,
    timestamp: new Date().toISOString(),
  });

  console.log(`Notified clients about ${changedItemIds.length} updated items`);
}

// product ?òÍ≤Ω?êÏÑú ?§Ìñâ?òÎèÑÎ°?Ï∂îÍ?
if (process.env.ENV === "development") {
  console.log("development env");
} else {
  console.log("product env");
  scheduleCrawling();
  scheduleUpdateCrawling();
  scheduleUpdateCrawlingWithId();
  loginAll();
}

module.exports = { router, initializeSocket, notifyClientsOfChanges };
