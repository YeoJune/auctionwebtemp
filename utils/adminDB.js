// utils/adminDB.js
const pool = require('./DB');
const fs = require('fs').promises;
const path = require('path');

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
    console.error('Error getting admin settings:', error);
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

    console.log('Admin settings updated successfully');
    return updatedSettings;
  } catch (error) {
    console.error('Error updating admin settings:', error);
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
    console.error('Error getting notices:', error);
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
    console.error('Error getting notice by id:', error);
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
      console.log(`Deleted image: ${imagePath}`);
    } catch (error) {
      console.error(`Error deleting image ${imagePath}:`, error);
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
    console.error('Error deleting notice:', error);
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
    console.error('Error adding notice:', error);
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
    console.error('Error updating notice:', error);
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  getAdminSettings,
  updateAdminSettings,
  getNotices,
  getNoticeById,
  addNotice,
  updateNotice,
  deleteNotice,
};