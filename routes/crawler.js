const express = require('express');
const router = express.Router();
const { ecoAucCrawler, brandAucCrawler, ecoAucValueCrawler, brandAucValueCrawler } = require('../Scripts/crawler');
const DBManager = require('../utils/DBManager');
const pool = require('../utils/DB');
const cron = require('node-cron');
const { getAdminSettings } = require('../utils/adminDB');
const { initializeFilterSettings } = require('../utils/filterDB');

// 크롤링 상태를 추적하기 위한 변수들
let isCrawlingAll = false;
let isCrawlingValues = false;

async function crawlAll() {
  if (isCrawlingAll) {
    throw new Error("already crawling all items");
  }
  
  try {
    isCrawlingAll = true;
    if (ecoAucCrawler.isRefreshing || brandAucCrawler.isRefreshing) {
      throw new Error("crawlers are busy");
    }

    const [existingItems] = await pool.query('SELECT item_id, auc_num FROM crawled_items');
    const existingEcoAucIds = new Set(existingItems.filter(item => item.auc_num == 1).map(item => item.item_id));
    const existingBrandAuctionIds = new Set(existingItems.filter(item => item.auc_num == 2).map(item => item.item_id));
    
    ecoAucCrawler.isRefreshing = true;
    await brandAucCrawler.closeCrawlerBrowser();
    await brandAucCrawler.closeDetailBrowsers();
    let ecoAucItems = await ecoAucCrawler.crawlAllItems(existingEcoAucIds);
    ecoAucCrawler.isRefreshing = false;

    brandAucCrawler.isRefreshing = true;
    await ecoAucCrawler.closeCrawlerBrowser();
    await ecoAucCrawler.closeDetailBrowsers();
    let brandAucItems = await brandAucCrawler.crawlAllItems(existingBrandAuctionIds);
    brandAucCrawler.isRefreshing = false;

    if (!ecoAucItems) ecoAucItems = [];
    if (!brandAucItems) brandAucItems = [];
    
    const allItems = [...ecoAucItems, ...brandAucItems];
    await DBManager.saveItems(allItems, 'crawled_items');
    await DBManager.deleteItemsWithout(allItems.map((item) => item.item_id), 'crawled_items');
    await DBManager.cleanupUnusedImages();
    await initializeFilterSettings();
  } finally {
    isCrawlingAll = false;
    ecoAucCrawler.isRefreshing = false;
    brandAucCrawler.isRefreshing = false;
  }
}

async function crawlAllValues() {
  if (isCrawlingValues) {
    throw new Error("already crawling values");
  }

  try {
    isCrawlingValues = true;
    if (ecoAucValueCrawler.isRefreshing || brandAucValueCrawler.isRefreshing) {
      throw new Error("value crawlers are busy");
    }

    const [existingItems] = await pool.query('SELECT item_id, auc_num FROM values_items');
    const existingEcoAucIds = new Set(existingItems.filter(item => item.auc_num == 1).map(item => item.item_id));
    const existingBrandAuctionIds = new Set(existingItems.filter(item => item.auc_num == 2).map(item => item.item_id));
    
    ecoAucValueCrawler.isRefreshing = true;
    await brandAucValueCrawler.closeCrawlerBrowser();
    await brandAucValueCrawler.closeDetailBrowsers();
    let ecoAucItems = await ecoAucValueCrawler.crawlAllItems(existingEcoAucIds);
    ecoAucValueCrawler.isRefreshing = false;

    brandAucValueCrawler.isRefreshing = true;
    await ecoAucValueCrawler.closeCrawlerBrowser();
    await ecoAucValueCrawler.closeDetailBrowsers();
    let brandAucItems = await brandAucValueCrawler.crawlAllItems(existingBrandAuctionIds);
    brandAucValueCrawler.isRefreshing = false;

    if (!ecoAucItems) ecoAucItems = [];
    if (!brandAucItems) brandAucItems = [];
    
    const allItems = [...ecoAucItems, ...brandAucItems];
    await DBManager.saveItems(allItems, 'values_items');
    await DBManager.deleteItemsWithout(allItems.map((item) => item.item_id), 'values_items');
    await DBManager.cleanupUnusedImages();
    await initializeFilterSettings();
  } finally {
    isCrawlingValues = false;
    ecoAucValueCrawler.isRefreshing = false;
    brandAucValueCrawler.isRefreshing = false;
  }
}

// 스케줄러 수정
const scheduleCrawling = async () => {
  const settings = await getAdminSettings();
  if (settings && settings.crawlSchedule) {
    const [hours, minutes] = settings.crawlSchedule.split(':');
    cron.schedule(`${minutes} ${hours} * * *`, async () => {
      console.log('Running scheduled crawling task');
      try {
        if (!isCrawlingAll && !isCrawlingValues) {
          await crawlAll();
        } else {
          console.log('Skipping scheduled crawl - another crawl is in progress');
        }
      } catch (error) {
        console.error('Scheduled crawling error:', error);
      }
    }, {
      scheduled: true,
      timezone: "Asia/Seoul"
    });
  }
};

router.get('/crawl', async (req, res) => {
  try {
    if (isCrawlingValues) {
      return res.status(409).json({ message: 'Values crawling is in progress' });
    }
    await crawlAll();
    res.json({ message: 'Crawling and image processing completed successfully' });
  } catch (error) {
    console.error('Crawling error:', error);
    res.status(500).json({ message: 'Error during crawling' });
  }
});

router.get('/crawl-values', async (req, res) => {
  try {
    if (isCrawlingAll) {
      return res.status(409).json({ message: 'Regular crawling is in progress' });
    }
    await crawlAllValues();
    res.json({ message: 'Values crawling and image processing completed successfully' });
  } catch (error) {
    console.error('Crawling error:', error);
    res.status(500).json({ message: 'Error during crawling' });
  }
});

scheduleCrawling();

module.exports = router;