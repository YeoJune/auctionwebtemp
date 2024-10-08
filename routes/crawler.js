const express = require('express');
const router = express.Router();
const { ecoAucCrawler, brandAuctionCrawler } = require('../Scripts/crawler');
const DBManager = require('../utils/DBManager');
const logger = require('../utils/logger');
const pool = require('../utils/DB');

// 큐와 처리 상태를 저장할 객체
const queue = [];
let isProcessing = false;

// 큐에 작업을 추가하고 처리를 시작하는 함수
function addToQueue(itemId, res) {
  queue.push({ itemId, res });
  if (!isProcessing) {
    processQueue();
  }
}

// 큐의 작업을 순차적으로 처리하는 함수
async function processQueue() {
  if (queue.length === 0) {
    isProcessing = false;
    return;
  }

  isProcessing = true;
  const { itemId, res } = queue.shift();

  try {
    const [items] = await pool.query('SELECT auc_num FROM crawled_items WHERE item_id = ?', [itemId]);
    
    if (items.length === 0) {
      res.status(404).json({ message: 'Item not found' });
    } else {
      const crawler = items[0].auc_num == 1 ? ecoAucCrawler : brandAuctionCrawler;
      const crawledDetails = await crawler.crawlItemDetails(itemId);

      if (crawledDetails) {
        await DBManager.updateItemDetails(itemId, crawledDetails);
        
        const [updatedItems] = await pool.query('SELECT * FROM crawled_items WHERE item_id = ?', [itemId]);
        res.json(updatedItems[0]);
      } else {
        res.status(500).json({ message: 'Failed to crawl item details' });
      }
    }
  } catch (error) {
    logger.error('Error crawling item details:', error);
    res.status(500).json({ message: 'Error crawling item details' });
  }

  // 다음 작업 처리
  processQueue();
}

router.get('/crawl', async (req, res) => {
  try {
    if (ecoAucCrawler.isRefreshing || brandAuctionCrawler.isRefreshing) {
      res.json({ message: `Crawling is already in progress` });
    } else {
      ecoAucCrawler.isRefreshing = true;
      let ecoAucItems = await ecoAucCrawler.crawlAllItems();
      ecoAucCrawler.isRefreshing = false;

      brandAuctionCrawler.isRefreshing = true;
      let brandAuctionItems = await brandAuctionCrawler.crawlAllItems();
      brandAuctionCrawler.isRefreshing = false;

      if (!ecoAucItems) ecoAucItems = [];
      if (!brandAuctionItems) brandAuctionItems = [];

      await DBManager.saveItems([...ecoAucItems, ...brandAuctionItems]);
      
      res.json({ message: 'Crawling completed successfully' });
    }
  } catch (error) {
    logger.error('Crawling error:', error);
    ecoAucCrawler.isRefreshing = false;
    brandAuctionCrawler.isRefreshing = false;
    res.status(500).json({ message: 'Error during crawling' });
  }
});

router.post('/crawl-item-details/:itemId', (req, res) => {
  const { itemId } = req.params;
  addToQueue(itemId, res);
});

module.exports = router;