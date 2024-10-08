// routes/data.js
const express = require('express');
const router = express.Router();
const pool = require('../utils/DB');
const logger = require('../utils/logger');
const MyGoogleSheetsManager = require('../utils/googleSheets');

router.get('/', async (req, res) => {
  const { page = 1, limit = 20, brands, categories, scheduledDates, wishlistOnly, aucNums, bidOnly } = req.query;
  const offset = (page - 1) * limit;
  const userId = req.session.user?.id;

  let query = 'SELECT ci.* FROM crawled_items ci';
  const queryParams = [];

  if (wishlistOnly === 'true' && userId) {
    query += ' INNER JOIN wishlists w ON ci.item_id = w.item_id AND w.user_id = ?';
    queryParams.push(userId);
  } else if (bidOnly === 'true' && userId) {
    query += ' INNER JOIN bids b ON ci.item_id = b.item_id AND b.user_id = ?';
    queryParams.push(userId);
  } else {
    query += ' WHERE 1=1';
  }

  if (brands) {
    const brandList = brands.split(',');
    query += ' AND ci.brand IN (' + brandList.map(() => '?').join(',') + ')';
    queryParams.push(...brandList);
  }

  if (categories) {
    const categoryList = categories.split(',');
    query += ' AND ci.category IN (' + categoryList.map(() => '?').join(',') + ')';
    queryParams.push(...categoryList);
  }

  if (scheduledDates) {
    const dateList = scheduledDates.split(',');
    if (dateList.length > 0) {
      query += ' AND (';
      dateList.forEach((date, index) => {
        if (index > 0) query += ' OR ';
        const match = date.match(/(\d{4}-\d{2}-\d{2})/);
        if (!match) {
          query += 'ci.scheduled_date IS NULL';
        } else {
          query += 'ci.scheduled_date >= ? AND ci.scheduled_date < ?';
          const startDate = new Date(match[0]);
          const endDate = new Date(startDate);
          endDate.setDate(endDate.getDate() + 1);
          queryParams.push(startDate, endDate);
        }
      });
      query += ')';
    }
  }

  // Add auc_num filter
  if (aucNums) {
    query += ' AND ci.auc_num = ?';
    queryParams.push(aucNums);
  }

  query += ' ORDER BY ci.korean_title ASC';
  query += ' LIMIT ? OFFSET ?';
  queryParams.push(parseInt(limit), offset);

  const countQuery = `SELECT COUNT(*) as total FROM (${query.split('ORDER BY')[0]}) as subquery`;

  try {
    const [items] = await pool.query(query, queryParams);
    const [countResult] = await pool.query(countQuery, queryParams.slice(0, -2));
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    let wishlist = [];
    if (userId) {
      [wishlist] = await pool.query('SELECT item_id FROM wishlists WHERE user_id = ?', [userId]);
      wishlist = wishlist.map(w => w.item_id);
    }
    let bidData = [];
    if (userId) {
      const [bids] = await pool.query(`
        SELECT b.id, b.item_id, b.first_price, b.second_price, b.final_price
        FROM bids b
        WHERE b.user_id = ?
      `, [userId]);
      const bidIds = bids.filter(bid => !bid.second_price).map(bid => bid.id);
      if (bidIds.length > 0) {
        const bidInfos = await MyGoogleSheetsManager.getBidInfos(bidIds);
        
        for (let i = 0; i < bidIds.length; i++) {
          const bidIndex = bids.findIndex(bid => bid.id === bidIds[i]);
          if (bidIndex !== -1 && bidInfos[i]) {
            Object.assign(bids[bidIndex], bidInfos[i]);
          }
        }
      }
      bidData = bids;
    }

    res.json({
      data: items,
      wishlist,
      bidData,
      page: parseInt(page),
      limit: parseInt(limit),
      totalItems,
      totalPages
    });
  } catch (error) {
    logger.error('Error fetching data from database:', error);
    res.status(500).json({ message: 'Error fetching data' });
  }
});

router.get('/brands-with-count', async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT brand, COUNT(*) as count
      FROM crawled_items
      GROUP BY brand
      ORDER BY count DESC, brand ASC
    `);
    res.json(results);
  } catch (error) {
    logger.error('Error fetching brands with count:', error);
    res.status(500).json({ message: 'Error fetching brands with count' });
  }
});

router.get('/scheduled-dates-with-count', async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT DATE(scheduled_date) as Date, COUNT(*) as count
      FROM crawled_items
      GROUP BY DATE(scheduled_date)
      ORDER BY count DESC, Date ASC
    `);
    res.json(results);
  } catch (error) {
    logger.error('Error fetching scheduled dates with count:', error);
    res.status(500).json({ message: 'Error fetching scheduled dates with count' });
  }
});

router.get('/auc-nums', async (req, res) => {
  try {
    const [aucNums] = await pool.query('SELECT DISTINCT auc_num FROM crawled_items ORDER BY auc_num');
    res.json(aucNums.map(a => a.auc_num));
  } catch (error) {
    logger.error('Error fetching auction numbers:', error);
    res.status(500).json({ message: 'Error fetching auction numbers' });
  }
});

router.get('/brands', async (req, res) => {
  try {
    const [brands] = await pool.query('SELECT DISTINCT brand FROM crawled_items ORDER BY brand');
    res.json(brands.map(b => b.brand));
  } catch (error) {
    logger.error('Error fetching brands:', error);
    res.status(500).json({ message: 'Error fetching brands' });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const [categories] = await pool.query('SELECT DISTINCT category FROM crawled_items ORDER BY category');
    res.json(categories.map(c => c.category));
  } catch (error) {
    logger.error('Error fetching categories:', error);
    res.status(500).json({ message: 'Error fetching categories' });
  }
});

module.exports = router;