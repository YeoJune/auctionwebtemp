// utils/adminDB.js
const pool = require('./DB');
const logger = require('./logger');
const fs = require('fs').promises;
const path = require('path');

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

    // Updated notices table (unchanged)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS notices (
        id INT PRIMARY KEY AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // New unified filters table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS filters (
        id INT PRIMARY KEY AUTO_INCREMENT,
        type ENUM('brand', 'category', 'date') NOT NULL,
        value VARCHAR(255) NOT NULL,
        disabled BOOLEAN DEFAULT FALSE,
        use_count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY type_value (type, value)
      )
    `);

    logger.info('Admin tables initialized successfully');
  } catch (error) {
    logger.error('Error initializing admin tables:', error);
    throw error;
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
    return updatedSettings;
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

async function getNoticeById(id) {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query('SELECT * FROM notices WHERE id = ?', [id]);
    return rows[0];
  } catch (error) {
    logger.error('Error getting notice by id:', error);
    throw error;
  } finally {
    conn.release();
  }
}

function extractImageUrls(content) {
  const regex = /<img[^>]+src="([^">]+)"/g;
  const urls = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

async function deleteImages(imageUrls) {
  for (const url of imageUrls) {
    const fileName = path.basename(url);
    const imagePath = path.join(__dirname, '..', 'public', 'images', 'notices', fileName);
    try {
      await fs.unlink(imagePath);
      logger.info(`Deleted image: ${imagePath}`);
    } catch (error) {
      logger.error(`Error deleting image ${imagePath}:`, error);
    }
  }
}

async function deleteNotice(id) {
  const conn = await pool.getConnection();
  try {
    const notice = await getNoticeById(id);
    if (!notice) {
      return false;
    }

    const imageUrls = extractImageUrls(notice.content);
    await deleteImages(imageUrls);

    const [result] = await conn.query('DELETE FROM notices WHERE id = ?', [id]);
    return result.affectedRows > 0;
  } catch (error) {
    logger.error('Error deleting notice:', error);
    throw error;
  } finally {
    conn.release();
  }
}

async function addNotice(title, content) {
  const conn = await pool.getConnection();
  try {
    const [result] = await conn.query(
      'INSERT INTO notices (title, content) VALUES (?, ?)',
      [title, content]
    );
    return { id: result.insertId, title, content };
  } catch (error) {
    logger.error('Error adding notice:', error);
    throw error;
  } finally {
    conn.release();
  }
}

async function updateNotice(id, title, content) {
  const conn = await pool.getConnection();
  try {
    const [result] = await conn.query(
      'UPDATE notices SET title = ?, content = ? WHERE id = ?',
      [title, content, id]
    );
    return result.affectedRows > 0 ? { id, title, content } : null;
  } catch (error) {
    logger.error('Error updating notice:', error);
    throw error;
  } finally {
    conn.release();
  }
}

async function getAllFilters() {
  const conn = await pool.getConnection();
  try {
    const [filters] = await conn.query('SELECT * FROM filters ORDER BY type, value');
    return {
      brands: filters.filter(f => f.type === 'brand'),
      categories: filters.filter(f => f.type === 'category'),
      dates: filters.filter(f => f.type === 'date')
    };
  } catch (error) {
    logger.error('Error getting all filters:', error);
    throw error;
  } finally {
    conn.release();
  }
}

async function updateFilters(changes) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const change of changes) {
      await conn.query(
        'UPDATE filters SET disabled = ? WHERE id = ?',
        [change.disabled, change.id]
      );
    }

    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    logger.error('Error updating filters:', error);
    throw error;
  } finally {
    conn.release();
  }
}

async function incrementFilterUseCount(type, value) {
  const conn = await pool.getConnection();
  try {
    await conn.query(
      'UPDATE filters SET use_count = use_count + 1 WHERE type = ? AND value = ?',
      [type, value]
    );
  } catch (error) {
    logger.error('Error incrementing filter use count:', error);
  } finally {
    conn.release();
  }
}

// Initialize the tables when this module is imported
initializeAdminTables().catch(error => {
  logger.error('Failed to initialize admin tables:', error);
});

module.exports = {
  getAdminSettings,
  updateAdminSettings,
  getNotices,
  getNoticeById,
  addNotice,
  updateNotice,
  deleteNotice,
  getAllFilters,
  updateFilters,
  incrementFilterUseCount
};