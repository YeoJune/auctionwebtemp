// utils/filterDB.js
const pool = require('./DB');

async function getFilterSettings() {
  const conn = await pool.getConnection();
  try {
    // 먼저 설정이 있는지 확인
    const [rows] = await conn.query(`
      SELECT filter_type, filter_value, is_enabled 
      FROM filter_settings 
      ORDER BY filter_type, filter_value
    `);

    // 설정이 없으면 초기화 실행
    if (rows.length === 0) {
      await initializeFilterSettings();
      // 초기화된 설정을 다시 조회
      const [initializedRows] = await conn.query(`
        SELECT filter_type, filter_value, is_enabled 
        FROM filter_settings 
        ORDER BY filter_type, filter_value
      `);
      return initializedRows;
    }

    return rows;
  } catch (error) {
    console.error('Error getting filter settings:', error);
    throw error;
  } finally {
    conn.release();
  }
}

async function getFilterSettingsByType(filterType) {
  const conn = await pool.getConnection();
  try {
    // 먼저 해당 타입의 설정이 있는지 확인
    const [rows] = await conn.query(`
      SELECT filter_type, filter_value, is_enabled 
      FROM filter_settings 
      WHERE filter_type = ?
      ORDER BY filter_value
    `, [filterType]);

    // 해당 타입의 설정이 없으면 초기화 실행
    if (rows.length === 0) {
      await initializeFilterSettings();
      // 초기화된 설정 중 해당 타입만 다시 조회
      const [initializedRows] = await conn.query(`
        SELECT filter_type, filter_value, is_enabled 
        FROM filter_settings 
        WHERE filter_type = ?
        ORDER BY filter_value
      `, [filterType]);
      return initializedRows;
    }

    return rows;
  } catch (error) {
    console.error('Error getting filter settings by type:', error);
    throw error;
  } finally {
    conn.release();
  }
}

async function updateFilterSetting(filterType, filterValue, isEnabled) {
  const conn = await pool.getConnection();
  try {
    // 설정이 없으면 먼저 초기화
    const [existing] = await conn.query(
      'SELECT COUNT(*) as count FROM filter_settings'
    );
    if (existing[0].count === 0) {
      await initializeFilterSettings();
    }

    await conn.query(`
      INSERT INTO filter_settings (filter_type, filter_value, is_enabled)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE is_enabled = ?
    `, [filterType, filterValue, isEnabled, isEnabled]);

    return { filterType, filterValue, isEnabled };
  } catch (error) {
    console.error('Error updating filter setting:', error);
    throw error;
  } finally {
    conn.release();
  }
}

async function initializeFilterSettings() {
  const conn = await pool.getConnection();
  try {
    // 기존 설정 모두 삭제
    await conn.query('DELETE FROM filter_settings');

    // Get all unique values for each filter type
    const [dates] = await conn.query(`
      SELECT DISTINCT DATE(scheduled_date) as value 
      FROM crawled_items 
      WHERE scheduled_date IS NOT NULL
      ORDER BY value
    `);
    const [brands] = await conn.query(`
      SELECT DISTINCT brand as value 
      FROM crawled_items 
      WHERE brand IS NOT NULL AND brand != ''
      ORDER BY value
    `);
    const [categories] = await conn.query(`
      SELECT DISTINCT category as value 
      FROM crawled_items 
      WHERE category IS NOT NULL AND category != ''
      ORDER BY value
    `);

    // Insert all values with default enabled status
    const queries = [
      ...dates.map(d => ['date', d.value]),
      ...brands.map(b => ['brand', b.value]),
      ...categories.map(c => ['category', c.value])
    ];

    for (const [filterType, filterValue] of queries) {
      if (filterValue) {  // Skip null values
        await conn.query(`
          INSERT IGNORE INTO filter_settings (filter_type, filter_value, is_enabled)
          VALUES (?, ?, TRUE)
        `, [filterType, filterValue]);
      }
    }

    return true;
  } catch (error) {
    console.error('Error initializing filter settings:', error);
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  getFilterSettings,
  getFilterSettingsByType,
  updateFilterSetting,
  initializeFilterSettings
};