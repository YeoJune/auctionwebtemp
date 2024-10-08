// utils/DBManager.js
const pool = require('./DB');

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
          if (this.crawledItemColumns.includes(key.toLowerCase())) {
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
  async saveItems(items, batchSize = 1000) {
    if (!items || !Array.isArray(items)) throw new Error("Invalid input: items must be an array");
    
    let conn;
    try {
      await this.withRetry(async () => {
        conn = await this.pool.getConnection();
        await conn.beginTransaction();
  
        const columns = this.crawledItemColumns.filter(col => items[0].hasOwnProperty(col));
        const placeholders = columns.map(() => '?').join(', ');
        const updateClauses = columns.map(col => `${col} = VALUES(${col})`).join(', ');
  
        // 아이템을 배치 크기만큼 나누어 처리
        for (let i = 0; i < items.length; i += batchSize) {
          const batch = items.slice(i, i + batchSize);
          const insertQuery = `
            INSERT INTO crawled_items (${columns.join(', ')})
            VALUES ${batch.map(() => `(${placeholders})`).join(', ')}
            ON DUPLICATE KEY UPDATE ${updateClauses}
          `;
  
          const values = batch.flatMap(item => columns.map(col => item[col]));
          await conn.query(insertQuery, values);
        }
  
        // 업데이트된 crawled_items에 없는 wishlist 아이템 삭제
        await conn.query(`
          DELETE w FROM wishlists w
          LEFT JOIN crawled_items ci ON w.item_id = ci.item_id
          WHERE ci.item_id IS NULL;
        `);
  
        await conn.commit();
        console.log('Items saved to database successfully');
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