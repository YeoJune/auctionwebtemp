// utils/DBManager.js
const pool = require('./DB');
const fs = require('fs').promises;
const path = require('path');

class DatabaseManager {
  constructor(pool) {
    this.pool = pool;
    this.RETRY_DELAY = 1000;
    this.MAX_RETRIES = 1;
    this.crawledItemColumns = [
      'item_id', 'korean_title', 'japanese_title', 'scheduled_date', 'auc_num',
      'category', 'brand', 'rank', 'starting_price', 'image', 'description',
      'additional_images', 'accessory_code'
    ];
    this.IMAGE_DIR = path.join(__dirname, '..', 'public', 'images', 'products');
  }

  async withRetry(operation) {
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === this.MAX_RETRIES) {
          throw error;
        }
        console.log(`Attempt ${attempt} failed, retrying in ${this.RETRY_DELAY}ms...`);
        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
      }
    }
  }

  async updateItemDetails(itemId, newDetails) {
    let conn;
    try {
      await this.withRetry( async () => {
        conn = await this.pool.getConnection();
      
        const updateFields = [];
        const updateValues = [];
        
        for (const [key, value] of Object.entries(newDetails)) {
          if (this.crawledItemColumns.includes(key)) {
            updateFields.push(`${key} = ?`);
            updateValues.push(value);
          }
        }
  
        if (updateFields.length === 0) {
          console.log(`No valid fields to update for item ${itemId}`);
          return;
        }
  
        const updateQuery = `UPDATE crawled_items SET ${updateFields.join(', ')} WHERE item_id = ?`;
        updateValues.push(itemId);
  
        await conn.query(updateQuery, updateValues);
        
        console.log(`Item ${itemId} details updated successfully`);
      });
    } catch (error) {
      console.error(`Error updating item ${itemId} details:`, error.message);
      throw error;
    } finally {
      if (conn) conn.release();
    }
  }
  
  async cleanupUnusedImages(activeImagePaths) {
    try {
      const files = await fs.readdir(this.IMAGE_DIR);
      for (const file of files) {
        const filePath = path.join(this.IMAGE_DIR, file);
        const relativePath = `/images/products/${file}`;
        if (!activeImagePaths.has(relativePath)) {
          await fs.unlink(filePath);
          console.log(`Deleted unused image: ${filePath}`);
        }
      }
    } catch (error) {
      console.error('Error cleaning up unused images:', error);
    }
  }
  async saveItems(items, batchSize = 1000) {
    if (!items || !Array.isArray(items)) throw new Error("Invalid input: items must be an array");
    
    let conn;
    try {
      await this.withRetry(async () => {
        conn = await this.pool.getConnection();
        await conn.beginTransaction();
  
        // Store all item_ids and active image paths from the input
        const inputItemIds = new Set(items.map(item => item.item_id));
        const activeImagePaths = new Set();

        // Filter out items without japanese_title for insertion/update
        const validItems = items.filter(item => item.japanese_title);
        if (validItems.length) {
          const columns = this.crawledItemColumns.filter(col => validItems[0].hasOwnProperty(col));
          const placeholders = columns.map(() => '?').join(', ');
          const updateClauses = columns.map(col => `${col} = VALUES(${col})`).join(', ');
  
          // Process items in batches
          for (let i = 0; i < validItems.length; i += batchSize) {
            const batch = validItems.slice(i, i + batchSize);
            const insertQuery = `
              INSERT INTO crawled_items (${columns.join(', ')})
              VALUES ${batch.map(() => `(${placeholders})`).join(', ')}
              ON DUPLICATE KEY UPDATE ${updateClauses}
            `;
    
            const values = batch.flatMap(item => {
              columns.forEach(col => {
                if (col === 'image') {
                  activeImagePaths.add(item[col]);
                } else if (col === 'additional_images') {
                  const additionalImages = JSON.parse(item[col] || '[]');
                  additionalImages.forEach(img => activeImagePaths.add(img));
                }
              });
              return columns.map(col => item[col]);
            });
            await conn.query(insertQuery, values);
          }
        }
        /*
        // Delete items not present in the input
        const deleteQuery = `
          DELETE FROM crawled_items
          WHERE item_id NOT IN (?)
        `;
        await conn.query(deleteQuery, [Array.from(inputItemIds)]);
        // Delete wishlist items that no longer exist in crawled_items
        await conn.query(`
          DELETE w FROM wishlists w
          LEFT JOIN crawled_items ci ON w.item_id = ci.item_id
          WHERE ci.item_id IS NULL
        `);
  
        */
        await conn.commit();
        console.log('Items saved to database and outdated items deleted successfully');

        // Clean up unused images
        //await this.cleanupUnusedImages(activeImagePaths);
      });
    } catch (error) {
      if (conn) await conn.rollback();
      console.error('Error saving items to database:', error.message);
      throw error;
    } finally {
      if (conn) conn.release();
    }
  }
}

const DBManager = new DatabaseManager(pool);

module.exports = DBManager;