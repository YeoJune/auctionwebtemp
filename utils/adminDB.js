const pool = require('./DB');
const logger = require('./logger');

async function initializeAdminTable() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS admin_settings (
        id INT PRIMARY KEY AUTO_INCREMENT,
        crawl_schedule VARCHAR(5) NOT NULL,
        notice TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    const [rows] = await conn.query('SELECT * FROM admin_settings WHERE id = 1');
    if (rows.length === 0) {
      await conn.query(`
        INSERT INTO admin_settings (crawl_schedule, notice) 
        VALUES (?, ?)
      `, ['00:00', 'Welcome to our website!']);
    }

    logger.info('Admin settings table initialized successfully');
  } catch (error) {
    logger.error('Error initializing admin settings table:', error);
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
        crawlSchedule: rows[0].crawl_schedule,
        notice: rows[0].notice
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
      crawl_schedule: settings.crawlSchedule || currentSettings[0].crawl_schedule,
      notice: settings.notice || currentSettings[0].notice
    };

    await conn.query(`
      UPDATE admin_settings 
      SET crawl_schedule = ?, notice = ? 
      WHERE id = 1
    `, [updatedSettings.crawl_schedule, updatedSettings.notice]);

    logger.info('Admin settings updated successfully');
  } catch (error) {
    logger.error('Error updating admin settings:', error);
    throw error;
  } finally {
    conn.release();
  }
}

// Initialize the table when this module is imported
initializeAdminTable();

module.exports = {
  getAdminSettings,
  updateAdminSettings
};