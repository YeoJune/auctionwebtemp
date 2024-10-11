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
  async cleanupUnusedImages(batchSize = 100) {
    let conn;
    const activeImagePaths = new Set();
  
    try {
      conn = await this.pool.getConnection();
  
      // 데이터베이스 쿼리 병렬 실행
      const [activeImagesPromise, bidImagesPromise] = await Promise.all([
        conn.query(`
          SELECT image, additional_images
          FROM crawled_items`),
        conn.query(`
          SELECT image
          FROM bids`)
      ]);
  
      const [activeImages] = activeImagesPromise;
      const [bidImages] = bidImagesPromise;
  
      // 활성 이미지 경로 처리
      activeImages.forEach(item => {
        if (item.image) activeImagePaths.add(item.image);
        if (item.additional_images) {
          JSON.parse(item.additional_images).forEach(img => activeImagePaths.add(img));
        }
      });
  
      bidImages.forEach(item => {
        if (item.image) activeImagePaths.add(item.image);
      });
  
      // 파일 시스템에서 이미지 정리
      const files = await fs.readdir(this.IMAGE_DIR);
      
      // 배치 처리 함수
      const processBatch = async (batch) => {
        await Promise.all(batch.map(async (file) => {
          const filePath = path.join(this.IMAGE_DIR, file);
          const relativePath = `/images/products/${file}`;
          if (!activeImagePaths.has(relativePath)) {
            try {
              await fs.unlink(filePath);
              console.log(`Deleted unused image: ${filePath}`);
            } catch (unlinkError) {
              console.error(`Error deleting file ${filePath}:`, unlinkError);
            }
          }
        }));
      };
  
      // 배치 단위로 파일 처리
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        await processBatch(batch);
      }
  
    } catch (error) {
      console.error('Error cleaning up unused images:', error);
    } finally {
      if (conn) {
        try {
          await conn.release();
        } catch (releaseError) {
          console.error('Error releasing database connection:', releaseError);
        }
      }
      activeImagePaths.clear();
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
        const inputItemIds = items.map(item => item.item_id);

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
            
            const values = batch.flatMap(item => columns.map(col => {
              // 데이터 타입 검증 및 변환
              const value = item[col];
              return value;
            }));
  
            try {
              await conn.query(insertQuery, values);
            } catch (error) {
              console.error(`Error inserting batch ${i / batchSize + 1}:`, error);
              // 개별 아이템 삽입 시도
              for (let j = 0; j < batch.length; j++) {
                const singleItemValues = columns.map(col => {
                  const value = batch[j][col];
                  return value;
                });
                const singleInsertQuery = `
                  INSERT INTO crawled_items (${columns.join(', ')})
                  VALUES (${placeholders})
                  ON DUPLICATE KEY UPDATE ${updateClauses}
                `;
                try {
                  await conn.query(singleInsertQuery, singleItemValues);
                } catch (singleError) {
                  console.error(`Error inserting item ${batch[j].item_id}:`, singleError);
                  // 개별 아이템 오류 로깅, 하지만 전체 프로세스는 계속 진행
                }
              }
            }
          }
        }
        // Delete items not present in the input
        const deleteQuery = `
          DELETE FROM crawled_items
          WHERE item_id NOT IN (?)
        `;
        await conn.query(deleteQuery, [inputItemIds]);
        // Delete wishlist items that no longer exist in crawled_items
        await conn.query(`
          DELETE w FROM wishlists w
          LEFT JOIN crawled_items ci ON w.item_id = ci.item_id
          WHERE ci.item_id IS NULL
        `);
        
        await conn.commit();
        console.log('Items saved to database and outdated items deleted successfully');

        // Clean up unused images
        await this.cleanupUnusedImages();
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