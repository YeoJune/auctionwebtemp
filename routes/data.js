// routes/data.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const pool = require('../utils/DB');

const apiKey = 'aeec85277b774a4abaa58ac8ef93e1bc';
const apiUrl = `https://api.currencyfreaks.com/v2.0/rates/latest?apikey=${apiKey}`;

let cachedRate = null;
let lastFetchedTime = null;
const cacheDuration = 60 * 60 * 1000;

function formatDate(dateString) {
  const date = new Date(dateString);
  // UTC 시간에 9시간(KST)을 더함
  const kstDate = new Date(date.getTime() + (9 * 60 * 60 * 1000));
  return kstDate.toISOString().split('T')[0];
}

// Helper function to get enabled filter values
async function getEnabledFilters(filterType) {
  const [enabled] = await pool.query(`
    SELECT filter_value 
    FROM filter_settings 
    WHERE filter_type = ? AND is_enabled = TRUE
  `, [filterType]);
  return enabled.map(item => item.filter_value);
}

router.get('/', async (req, res) => {
  const { page = 1, limit = 20, brands, categories, scheduledDates, wishlistOnly, aucNums, bidOnly } = req.query;
  const offset = (page - 1) * limit;
  const userId = req.session.user?.id;

  try {
    // Get enabled filters
    const [enabledBrands, enabledCategories, enabledDates] = await Promise.all([
      getEnabledFilters('brand'),
      getEnabledFilters('category'),
      getEnabledFilters('date')
    ]);

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

    // Apply enabled filter restrictions
    if (enabledBrands.length > 0) {
      query += ' AND ci.brand IN (' + enabledBrands.map(() => '?').join(',') + ')';
      queryParams.push(...enabledBrands);
    } else {
      query += ' AND 1=0'; // No enabled brands, return no results
    }
    
    if (enabledCategories.length > 0) {
      query += ' AND ci.category IN (' + enabledCategories.map(() => '?').join(',') + ')';
      queryParams.push(...enabledCategories);
    } else {
      query += ' AND 1=0'; // No enabled categories, return no results
    }

    if (enabledDates.length > 0) {
      query += ' AND DATE(ci.scheduled_date) IN (' + enabledDates.map(() => '?').join(',') + ')';
      queryParams.push(...enabledDates);
    }

    // Apply user-selected filters
    if (brands) {
      const brandList = brands.split(',').filter(brand => enabledBrands.includes(brand));
      if (brandList.length > 0) {
        query += ' AND ci.brand IN (' + brandList.map(() => '?').join(',') + ')';
        queryParams.push(...brandList);
      }
    }

    if (categories) {
      const categoryList = categories.split(',').filter(category => enabledCategories.includes(category));
      if (categoryList.length > 0) {
        query += ' AND ci.category IN (' + categoryList.map(() => '?').join(',') + ')';
        queryParams.push(...categoryList);
      }
    }

    if (scheduledDates) {
      const dateList = scheduledDates.split(',');
      if (dateList.length > 0) {
        query += ' AND (';
        const validDates = [];
        dateList.forEach((date, index) => {
          if (date == 'null') {
            if (validDates.length > 0) query += ' OR ';
            query += 'ci.scheduled_date IS NULL';
            validDates.push(date);
          } else {
            const kstDate = formatDate(date) + ' 00:00:00.000';
            if (enabledDates.includes(kstDate)) {
              if (validDates.length > 0) query += ' OR ';
              query += 'ci.scheduled_date >= ? AND ci.scheduled_date < ?';
              const startDate = new Date(kstDate);
              const endDate = new Date(startDate);
              endDate.setDate(endDate.getDate() + 1);
              queryParams.push(startDate, endDate);
              validDates.push(date);
            }
          }
        });
        if (validDates.length === 0) {
          query += '1=0'; // No valid dates, return no results
        }
        query += ')';
      }
    }
    if (aucNums) {
      query += ' AND ci.auc_num = ?';
      queryParams.push(aucNums);
    }

    query += ' ORDER BY ci.korean_title ASC';
    query += ' LIMIT ? OFFSET ?';
    queryParams.push(parseInt(limit), offset);

    const countQuery = `SELECT COUNT(*) as total FROM (${query.split('ORDER BY')[0]}) as subquery`;

    const [items] = await pool.query(query, queryParams);
    const [countResult] = await pool.query(countQuery, queryParams.slice(0, -2));
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    let wishlist = [];
    if (userId) {
      [wishlist] = await pool.query('SELECT item_id FROM wishlists WHERE user_id = ?', [userId]);
      wishlist = wishlist.map(w => w.item_id);
    }
    let bidData;
    if (userId) {
      [bidData] = await pool.query(`
        SELECT b.id, b.item_id, b.first_price, b.second_price, b.final_price
        FROM bids b
        WHERE b.user_id = ?
      `, [userId]);
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
    console.error('Error fetching data from database:', error);
    res.status(500).json({ message: 'Error fetching data' });
  }
});

router.get('/brands-with-count', async (req, res) => {
  try {
    const enabledBrands = await getEnabledFilters('brand');
    if (enabledBrands.length === 0) {
      return res.json([]);
    }
    
    const placeholders = enabledBrands.map(() => '?').join(',');
    const [results] = await pool.query(`
      SELECT brand, COUNT(*) as count
      FROM crawled_items
      WHERE brand IN (${placeholders})
      GROUP BY brand
      ORDER BY count DESC, brand ASC
    `, enabledBrands);
    
    res.json(results);
  } catch (error) {
    console.error('Error fetching brands with count:', error);
    res.status(500).json({ message: 'Error fetching brands with count' });
  }
});

router.get('/scheduled-dates-with-count', async (req, res) => {
  try {
    const enabledDates = await getEnabledFilters('date');
    if (enabledDates.length === 0) {
      return res.json([]);
    }
    
    const placeholders = enabledDates.map(() => '?').join(',');
    const [results] = await pool.query(`
      SELECT DATE(scheduled_date) as Date, COUNT(*) as count
      FROM crawled_items
      WHERE DATE(scheduled_date) IN (${placeholders})
      GROUP BY DATE(scheduled_date)
      ORDER BY Date ASC
    `, enabledDates);
    
    res.json(results);
  } catch (error) {
    console.error('Error fetching scheduled dates with count:', error);
    res.status(500).json({ message: 'Error fetching scheduled dates with count' });
  }
});

router.get('/brands', async (req, res) => {
  try {
    const enabledBrands = await getEnabledFilters('brand');
    res.json(enabledBrands);
  } catch (error) {
    console.error('Error fetching brands:', error);
    res.status(500).json({ message: 'Error fetching brands' });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const enabledCategories = await getEnabledFilters('category');
    res.json(enabledCategories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ message: 'Error fetching categories' });
  }
});

router.get('/exchange-rate', async (req, res) => {
  const currentTime = new Date().getTime();

  if (cachedRate && lastFetchedTime && (currentTime - lastFetchedTime < cacheDuration)) {
    console.log('Returning cached data');
    return res.json({ rate: cachedRate });
  }

  try {
    const response = await axios.get(apiUrl).json();

    cachedRate = response.rates.JPY / response.rates.KRW;
    lastFetchedTime = currentTime;

    console.log('Fetched new data from API');
    res.json({ rate: cachedRate });
  } catch (error) {
    console.error('Error fetching exchange rate:', error);
    res.status(500).json({ error: 'Failed to fetch exchange rate' });
  }
});


module.exports = router;