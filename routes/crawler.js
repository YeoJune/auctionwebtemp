// routes/crawler.js
const express = require('express');
const router = express.Router();
const { ecoAucCrawler, brandAucCrawler, ecoAucValueCrawler, brandAucValueCrawler } = require('../Scripts/crawler');
const DBManager = require('../utils/DBManager');
const pool = require('../utils/DB');
const cron = require('node-cron');
const { getAdminSettings } = require('../utils/adminDB');
const { initializeFilterSettings } = require('../utils/filterDB');

let isCrawling = false;
let isValueCrawling = false;

// 기존 processItem 함수 수정
async function processItem(itemId, res) {
  try {
    const [items] = await pool.query('SELECT * FROM crawled_items WHERE item_id = ?', [itemId]);
    if (items.length === 0) {
      res.status(404).json({ message: 'Item not found' });
    } else {
      if (items[0].description) {
        res.json(items[0]);
      } else {
        const crawler = items[0].auc_num == 1 ? ecoAucCrawler : brandAucCrawler;
        const detailIndex = findAvailableIndex(items[0].auc_num);
        
        if (detailIndex === -1) {
          res.status(503).json({ message: 'All crawlers are busy. Please try again later.' });
          return;
        }

        try {
          const crawledDetails = await crawler.crawlItemDetails(detailIndex, itemId);
    
          if (crawledDetails) {
            await DBManager.updateItemDetails(itemId, crawledDetails, 'crawled_items');
            
            const [updatedItems] = await pool.query('SELECT * FROM crawled_items WHERE item_id = ?', [itemId]);
            res.json(updatedItems[0]);
          } else {
            crawler.closeDetailBrowsers();
            res.status(500).json({ message: 'Failed to crawl item details' });
          }
        } finally {
          releaseIndex(items[0].auc_num, detailIndex);
        }
      }
    }
  } catch (error) {
    console.error('Error crawling item details:', error);
    res.status(500).json({ message: 'Error crawling item details' });
  }
}

// 병렬 처리를 위한 작업 큐와 상태 관리
const queue = [];
let isProcessing = false;
const MAX_CONCURRENT_TASKS = 3; // 동시에 처리할 최대 작업 수

const crawlerIndexTracker = {
  Crawler: new Array(ecoAucCrawler.detailMulti).fill(false),
  brandAucCrawler: new Array(brandAucCrawler.detailMulti).fill(false)
};

function findAvailableIndex(crawlerIndex) {
  const trackerKey = crawlerIndex == 1 ? 'Crawler' : 'brandAucCrawler';
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
  return -1; // All indices are in use
}

function releaseIndex(crawlerIndex, index) {
  const trackerKey = crawlerIndex == 1 ? 'Crawler' : 'brandAucCrawler';
  if (crawlerIndexTracker[trackerKey]) {
    crawlerIndexTracker[trackerKey][index] = false;
  } else {
    console.error(`No tracker found for crawler type: ${trackerKey}`);
  }
}

// 큐에 작업을 추가하고 처리를 시작하는 함수
function addToQueue(itemId, res) {
  queue.push({ itemId, res });
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
    await Promise.all(tasks.map(task => processItem(task.itemId, task.res)));
  } catch (error) {
    console.error('Error processing queue:', error);
  }

  // 다음 작업 처리
  processQueue();
}
async function closeAllCrawler() {
  for(let c of [ecoAucCrawler, brandAucCrawler, ecoAucValueCrawler, brandAucValueCrawler]) {
    await c.closeCrawlerBrowser();
    await c.closeDetailBrowsers();
  }
}
async function crawlAll() {
  try {
    if (isCrawling) {
      throw new Error("already crawling");
    } else if (isValueCrawling) {
      throw new Error("value crawler is activating");
    } else {
      const [existingItems] = await pool.query('SELECT item_id, auc_num FROM crawled_items');
      const existingEcoAucIds = new Set(existingItems.filter(item => item.auc_num == 1).map(item => item.item_id));
      const existingBrandAuctionIds = new Set(existingItems.filter(item => item.auc_num == 2).map(item => item.item_id));
      
      isCrawling = true;
      await closeAllCrawler();
      let ecoAucItems = await ecoAucCrawler.crawlAllItems(existingEcoAucIds);
      await closeAllCrawler();
      let brandAucItems = await brandAucCrawler.crawlAllItems(existingBrandAuctionIds);

      if (!ecoAucItems) ecoAucItems = [];
      if (!brandAucItems) brandAucItems = [];
      const allItems = [
        ...ecoAucItems,
        ...brandAucItems
      ];
      await DBManager.saveItems(allItems, 'crawled_items');
      await DBManager.deleteItemsWithout(allItems.map((item) => item.item_id), 'crawled_items');
      await DBManager.cleanupUnusedImages();
      await initializeFilterSettings();
    }
  } catch (error) {
    await closeAllCrawler();
    isCrawling = false;
    throw (error);
  }
}

async function crawlAllValues() {
  try {
    if (isValueCrawling) {
      throw new Error("already crawling");
    } else if (isCrawling) {
      throw new Error("crawler is activating");
    } else {
      const [existingItems] = await pool.query('SELECT item_id, auc_num FROM values_items');
      const existingEcoAucIds = new Set(existingItems.filter(item => item.auc_num == 1).map(item => item.item_id));
      const existingBrandAuctionIds = new Set(existingItems.filter(item => item.auc_num == 2).map(item => item.item_id));

      isValueCrawling = true;
      
      await closeAllCrawler();
      let ecoAucItems = await ecoAucValueCrawler.crawlAllItems(existingEcoAucIds);
      await closeAllCrawler();
      let brandAucItems = await brandAucValueCrawler.crawlAllItems(existingBrandAuctionIds);

      if (!ecoAucItems) ecoAucItems = [];
      if (!brandAucItems) brandAucItems = [];
      const allItems = [
        ...ecoAucItems,
        ...brandAucItems
      ];
      await DBManager.saveItems(allItems, 'values_items');
      await DBManager.cleanupUnusedImages();
      await initializeFilterSettings();
    }
  } catch (error) {
    await closeAllCrawler();
    isValueCrawling = false;
    throw (error);
  }
}

router.get('/crawl', async (req, res) => {
  try {
    await crawlAll();

    res.json({ message: 'Crawling and image processing completed successfully' });
  } catch (error) {
    console.error('Crawling error:', error);
    res.status(500).json({ message: 'Error during crawling' });
  }
});

router.post('/crawl-item-details/:itemId', (req, res) => {
  const { itemId } = req.params;
  addToQueue(itemId, res);
});

router.get('/crawl-values', async (req, res) => {
  try {
    await crawlAllValues();

    res.json({ message: 'Crawling and image processing completed successfully' });
  } catch (error) {
    console.error('Crawling error:', error);
    res.status(500).json({ message: 'Error during crawling' });
  }
});

const scheduleCrawling = async () => {
  const settings = await getAdminSettings();
  if (settings && settings.crawlSchedule) {
    const [hours, minutes] = settings.crawlSchedule.split(':');
    cron.schedule(`${minutes} ${hours} * * *`, async () => {
      console.log('Running scheduled crawling task');
      try {
        await crawlAll();
        await crawlAllValues();
        console.log('Scheduled crawling completed successfully');
      } catch (error) {
        console.error('Scheduled crawling error:', error);
      }
    }, {
      scheduled: true,
      timezone: "Asia/Seoul"
    });
  }
};

scheduleCrawling();

module.exports = router;