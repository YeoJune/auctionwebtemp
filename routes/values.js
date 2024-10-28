// routes/values
const express = require('express');
const router = express.Router();
const pool = require('../utils/DB');

router.get('/', async (req, res) => {
  const { page = 1, limit = 20, brands, categories, scheduledDates, aucNums } = req.query;
  const offset = (page - 1) * limit;

  try {
    let query = `
      SELECT 
        *,
        CONVERT_TZ(scheduled_date, 'UTC', 'Asia/Seoul') as scheduled_date 
      FROM values_items`;
    const queryParams = [];
    let conditions = [];

    // Apply filters
    if (brands) {
      const brandList = brands.split(',');
      if (brandList.length > 0) {
        conditions.push('brand IN (' + brandList.map(() => '?').join(',') + ')');
        queryParams.push(...brandList);
      }
    }

    if (categories) {
      const categoryList = categories.split(',');
      if (categoryList.length > 0) {
        conditions.push('category IN (' + categoryList.map(() => '?').join(',') + ')');
        queryParams.push(...categoryList);
      }
    }

    if (scheduledDates) {
      const dateList = scheduledDates.split(',');
      if (dateList.length > 0) {
        const dateConds = [];
        dateList.forEach(date => {
          const match = date.match(/(\d{4}-\d{2}-\d{2})/);
          if (match) {
            dateConds.push('(DATE(CONVERT_TZ(scheduled_date, "UTC", "Asia/Seoul")) >= ? AND DATE(CONVERT_TZ(scheduled_date, "UTC", "Asia/Seoul")) < ?)');
            const startDate = new Date(match[0]);
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + 1);
            queryParams.push(startDate, endDate);
          }
        });
        if (dateConds.length > 0) {
          conditions.push(`(${dateConds.join(' OR ')})`);
        }
      }
    }

    if (aucNums) {
      conditions.push('auc_num = ?');
      queryParams.push(aucNums);
    }

    // Add WHERE clause if there are any conditions
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    // Add pagination
    const countQuery = `SELECT COUNT(*) as total FROM (${query}) as subquery`;
    query += ' ORDER BY item_id ASC LIMIT ? OFFSET ?';
    queryParams.push(parseInt(limit), offset);

    const [items] = await pool.query(query, queryParams);
    const [countResult] = await pool.query(countQuery, queryParams.slice(0, -2));
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    res.json({
      data: items,
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
    const [results] = await pool.query(`
      SELECT brand, COUNT(*) as count
      FROM values_items
      GROUP BY brand
      ORDER BY count DESC, brand ASC
    `);
    
    res.json(results);
  } catch (error) {
    console.error('Error fetching brands with count:', error);
    res.status(500).json({ message: 'Error fetching brands with count' });
  }
});

router.get('/scheduled-dates-with-count', async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT 
        DATE(CONVERT_TZ(scheduled_date, 'UTC', 'Asia/Seoul')) as Date, 
        COUNT(*) as count
      FROM values_items
      GROUP BY DATE(CONVERT_TZ(scheduled_date, 'UTC', 'Asia/Seoul'))
      ORDER BY Date ASC
    `);
    
    res.json(results);
  } catch (error) {
    console.error('Error fetching scheduled dates with count:', error);
    res.status(500).json({ message: 'Error fetching scheduled dates with count' });
  }
});


router.get('/brands', async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT DISTINCT brand 
      FROM values_items 
      ORDER BY brand ASC
    `);
    res.json(results.map(row => row.brand));
  } catch (error) {
    console.error('Error fetching brands:', error);
    res.status(500).json({ message: 'Error fetching brands' });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT DISTINCT category 
      FROM values_items 
      ORDER BY category ASC
    `);
    res.json(results.map(row => row.category));
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ message: 'Error fetching categories' });
  }
});

module.exports = router;