// utils/adminDB.js
const pool = require('./DB');
const logger = require('./logger');

async function initializeAdminTables() {
  const conn = await pool.getConnection();
  try {
    // Admin settings table (unchanged)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS admin_settings (
        id INT PRIMARY KEY AUTO_INCREMENT,
        crawl_schedule VARCHAR(5) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Insert default admin settings if not exist (unchanged)
    const [settingsRows] = await conn.query('SELECT * FROM admin_settings WHERE id = 1');
    if (settingsRows.length === 0) {
      await conn.query(`
        INSERT INTO admin_settings (crawl_schedule) 
        VALUES (?)
      `, ['00:00']);
    }

    // Updated notices table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS notices (
        id INT PRIMARY KEY AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        image_url VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    logger.info('Admin tables initialized successfully');
  } catch (error) {
    logger.error('Error initializing admin tables:', error);
  } finally {
    conn.release();
  }
}

async function getAdminSettings() {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query('SELECT * FROM admin_settings WHERE id = 1');
    if (rows.length > 0) {
      return {
        crawlSchedule: rows[0].crawl_schedule
      };
    }
    return null;
  } catch (error) {
    logger.error('Error getting admin settings:', error);
    throw error;
  } finally {
    conn.release();
  }
}

async function updateAdminSettings(settings) {
  const conn = await pool.getConnection();
  try {
    const [currentSettings] = await conn.query('SELECT * FROM admin_settings WHERE id = 1');
    
    if (currentSettings.length === 0) {
      throw new Error('Admin settings not found');
    }

    const updatedSettings = {
      crawl_schedule: settings.crawlSchedule || currentSettings[0].crawl_schedule
    };

    await conn.query(`
      UPDATE admin_settings 
      SET crawl_schedule = ?
      WHERE id = 1
    `, [updatedSettings.crawl_schedule]);

    logger.info('Admin settings updated successfully');
  } catch (error) {
    logger.error('Error updating admin settings:', error);
    throw error;
  } finally {
    conn.release();
  }
}

async function getNotices() {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query('SELECT * FROM notices ORDER BY created_at DESC');
    return rows;
  } catch (error) {
    logger.error('Error getting notices:', error);
    throw error;
  } finally {
    conn.release();
  }
}
async function addNotice(title, content, imageUrls) {
  const conn = await pool.getConnection();
  try {
    const [result] = await conn.query(
      'INSERT INTO notices (title, content, image_urls) VALUES (?, ?, ?)',
      [title, content, JSON.stringify(imageUrls)]
    );
    return { id: result.insertId, title, content, image_urls: imageUrls };
  } catch (error) {
    logger.error('Error adding notice:', error);
    throw error;
  } finally {
    conn.release();
  }
}

async function updateNotice(id, title, content, imageUrls) {
  const conn = await pool.getConnection();
  try {
    const [result] = await conn.query(
      'UPDATE notices SET title = ?, content = ?, image_urls = ? WHERE id = ?',
      [title, content, JSON.stringify(imageUrls), id]
    );
    return result.affectedRows > 0 ? { id, title, content, image_urls: imageUrls } : null;
  } catch (error) {
    logger.error('Error updating notice:', error);
    throw error;
  } finally {
    conn.release();
  }
}

async function deleteNotice(id) {
  const conn = await pool.getConnection();
  try {
    const [result] = await conn.query('DELETE FROM notices WHERE id = ?', [id]);
    return result.affectedRows > 0;
  } catch (error) {
    logger.error('Error deleting notice:', error);
    throw error;
  } finally {
    conn.release();
  }
}
async function getFilterSettings() {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query('SELECT * FROM filter_settings WHERE id = 1');
    if (rows.length > 0) {
      return {
        brandFilters: JSON.parse(rows[0].brand_filters),
        categoryFilters: JSON.parse(rows[0].category_filters),
        dateFilters: JSON.parse(rows[0].date_filters)
      };
    }
    return null;
  } catch (error) {
    logger.error('Error getting filter settings:', error);
    throw error;
  } finally {
    conn.release();
  }
}

async function updateFilterSettings(brandFilters, categoryFilters, dateFilters) {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      INSERT INTO filter_settings (id, brand_filters, category_filters, date_filters)
      VALUES (1, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      brand_filters = VALUES(brand_filters),
      category_filters = VALUES(category_filters),
      date_filters = VALUES(date_filters)
    `, [JSON.stringify(brandFilters), JSON.stringify(categoryFilters), JSON.stringify(dateFilters)]);
  } catch (error) {
    logger.error('Error updating filter settings:', error);
    throw error;
  } finally {
    conn.release();
  }
}

// Initialize the tables when this module is imported
initializeAdminTables();

module.exports = {
  getAdminSettings,
  updateAdminSettings,
  getNotices,
  addNotice,
  updateNotice,
  deleteNotice,
  getFilterSettings,
  updateFilterSettings
};