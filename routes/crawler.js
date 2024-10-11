const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { ecoAucCrawler, brandAuctionCrawler } = require('../Scripts/crawler');
const DBManager = require('../utils/DBManager');
const logger = require('../utils/logger');
const pool = require('../utils/DB');
const cron = require('node-cron');
const sharp = require('sharp');
const { getAdminSettings, updateAdminSettings } = require('../utils/adminDB');

const STALL_LIMIT = 5000;

// 이미지 저장 경로 설정
const IMAGE_DIR = path.join(__dirname, '..', 'public', 'images', 'products');

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
        const crawler = items[0].auc_num == 1 ? ecoAucCrawler : brandAuctionCrawler;
        const detailIndex = findAvailableIndex(items[0].auc_num);
        
        if (detailIndex === -1) {
          res.status(503).json({ message: 'All crawlers are busy. Please try again later.' });
          return;
        }

        try {
          const crawledDetails = await crawler.crawlItemDetails(detailIndex, itemId);
    
          if (crawledDetails) {
            const processedDetails = await processImagesInChunks([crawledDetails]);
            await DBManager.updateItemDetails(itemId, processedDetails[0]);
            
            const [updatedItems] = await pool.query('SELECT * FROM crawled_items WHERE item_id = ?', [itemId]);
            res.json(updatedItems[0]);
          } else {
            res.status(500).json({ message: 'Failed to crawl item details' });
          }
        } finally {
          releaseIndex(items[0].auc_num, detailIndex);
        }
      }
    }
  } catch (error) {
    logger.error('Error crawling item details:', error);
    res.status(500).json({ message: 'Error crawling item details' });
  }
}

// 병렬 처리를 위한 작업 큐와 상태 관리
const queue = [];
let isProcessing = false;
const MAX_CONCURRENT_TASKS = 3; // 동시에 처리할 최대 작업 수

const crawlerIndexTracker = {
  Crawler: new Array(ecoAucCrawler.detailMulti).fill(false),
  BrandAuctionCrawler: new Array(brandAuctionCrawler.detailMulti).fill(false)
};

function findAvailableIndex(crawlerIndex) {
  const trackerKey = crawlerIndex == 1 ? 'Crawler' : 'BrandAuctionCrawler';
  const tracker = crawlerIndexTracker[trackerKey];
  if (!tracker) {
    logger.error(`No tracker found for crawler type: ${trackerKey}`);
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
  const trackerKey = crawlerIndex == 1 ? 'Crawler' : 'BrandAuctionCrawler';
  if (crawlerIndexTracker[trackerKey]) {
    crawlerIndexTracker[trackerKey][index] = false;
  } else {
    logger.error(`No tracker found for crawler type: ${trackerKey}`);
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
    logger.error('Error processing queue:', error);
  }

  // 다음 작업 처리
  processQueue();
}
const chunk = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
    arr.slice(i * size, i * size + size)
  );
async function downloadAndSaveImage(url, retries = 3, delay = 1000) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await axios({
        method: 'get',
        url: url,
        responseType: 'arraybuffer'
      });

      const fileName = `${uuidv4()}.jpg`;
      const filePath = path.join(IMAGE_DIR, fileName);

      await sharp(response.data)
        .jpeg({ quality: 100 })
        .toFile(filePath);

      return `/images/products/${fileName}`;
    } catch (error) {
      console.error(`Error processing image (Attempt ${attempt + 1}/${retries}): ${url}`, error.message);
      if (attempt < retries - 1) {
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        return null;
      }
    }
  }
  console.error(`Failed to download image after ${retries} attempts: ${url}`);
  return null;
}
async function processImagesInChunks(items, chunkSize = 100) {
  // 아이템 분류
  const itemsWithImages = [];
  const itemsWithoutImages = [];

  items.forEach(item => {
    if (item.image || (item.additional_images && JSON.parse(item.additional_images).length > 0)) {
      itemsWithImages.push(item);
    } else {
      itemsWithoutImages.push(item);
    }
  });

  const processChunk = async (chunk) => {
    return Promise.all(chunk.map(async (item) => {
      const downloadTasks = [];

      if (item.image) {
        downloadTasks.push(
          downloadAndSaveImage(item.image)
            .then(savedPath => {
              if (savedPath) item.image = savedPath;
            })
        );
      }
      
      if (item.additional_images) {
        const additionalImages = JSON.parse(item.additional_images);
        const savedImages = [];
        
        additionalImages.forEach(imgUrl => {
          downloadTasks.push(
            downloadAndSaveImage(imgUrl)
              .then(savedPath => {
                if (savedPath) savedImages.push(savedPath);
              })
          );
        });

        await Promise.all(downloadTasks);
        item.additional_images = JSON.stringify(savedImages);
      } else {
        await Promise.all(downloadTasks);
      }

      return item;
    }));
  };

  const chunks = chunk(itemsWithImages, chunkSize);
  const processedItems = [];
  let i = 0;
  for (const chunkItems of chunks) {
    const processedChunk = await processChunk(chunkItems);
    processedItems.push(...processedChunk);
    
    // 가비지 컬렉션을 위한 짧은 지연
    await new Promise(resolve => setTimeout(resolve, 100));
    if (i % 10 == 0) console.log(`${i / 10} / ${chunks.length / 10}`);
    i += 1;
    if (i % STALL_LIMIT == 0) {
      console.log('5 min sleep...');
      await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
    }
  }

  // 처리된 아이템과 이미지가 없는 아이템을 합쳐서 반환
  return [...processedItems, ...itemsWithoutImages];
}

async function crawlAll() {
  try {
    if (ecoAucCrawler.isRefreshing || brandAuctionCrawler.isRefreshing) {
      throw new Error("already crawling");
    } else {
      const [existingItems] = await pool.query('SELECT item_id, auc_num FROM crawled_items');
      const existingEcoAucIds = new Set(existingItems.filter(item => item.auc_num == 1).map(item => item.item_id));
      const existingBrandAuctionIds = new Set(existingItems.filter(item => item.auc_num == 2).map(item => item.item_id));

      ecoAucCrawler.isRefreshing = true;
      await brandAuctionCrawler.closeCrawlerBrowser();
      await brandAuctionCrawler.closeDetailBrowsers();
      let ecoAucItems = await ecoAucCrawler.crawlAllItems(existingEcoAucIds);
      ecoAucItems = await processImagesInChunks(ecoAucItems);
      ecoAucCrawler.isRefreshing = false;

      brandAuctionCrawler.isRefreshing = true;
      await ecoAucCrawler.closeCrawlerBrowser();
      await ecoAucCrawler.closeDetailBrowsers();
      let brandAuctionItems = await brandAuctionCrawler.crawlAllItems(existingBrandAuctionIds);
      brandAuctionItems = await processImagesInChunks(brandAuctionItems);
      brandAuctionCrawler.isRefreshing = false;

      if (!ecoAucItems) ecoAucItems = [];
      if (!brandAuctionItems) brandAuctionItems = [];
      const allItems = [
        ...ecoAucItems,
        ...brandAuctionItems
      ];
      await DBManager.saveItems(allItems);
    }
  } catch (error) {
    ecoAucCrawler.isRefreshing = false;
    brandAuctionCrawler.isRefreshing = false;
    throw (error);
  }
}

router.get('/crawl', async (req, res) => {
  try {
    await crawlAll();

    res.json({ message: 'Crawling and image processing completed successfully' });
  } catch (error) {
    logger.error('Crawling error:', error);
    res.status(500).json({ message: 'Error during crawling' });
  }
});

router.post('/crawl-item-details/:itemId', (req, res) => {
  const { itemId } = req.params;
  addToQueue(itemId, res);
});

const scheduleCrawling = async () => {
  const settings = await getAdminSettings();
  if (settings && settings.crawlSchedule) {
    const [hours, minutes] = settings.crawlSchedule.split(':');
    cron.schedule(`${minutes} ${hours} * * *`, async () => {
      logger.info('Running scheduled crawling task');
      try {
        crawlAll();
        logger.info('Scheduled crawling completed successfully');
      } catch (error) {
        logger.error('Scheduled crawling error:', error);
      }
    }, {
      scheduled: true,
      timezone: "Asia/Seoul"
    });
  }
};

scheduleCrawling();

module.exports = router;