// utils/DBManager.js
const pool = require("./DB");
const fs = require("fs").promises;
const path = require("path");

class DatabaseManager {
  constructor(pool) {
    this.pool = pool;
    this.RETRY_DELAY = 1000;
    this.MAX_RETRIES = 1;
    this.crawledItemColumns = [
      "item_id",
      "original_title",
      "title",
      "scheduled_date",
      "auc_num",
      "category",
      "brand",
      "rank",
      "starting_price",
      "image",
      "description",
      "additional_images",
      "accessory_code",
      "final_price",
    ];
    this.IMAGE_DIR = path.join(__dirname, "..", "public", "images", "products");
  }

  async withRetry(operation) {
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === this.MAX_RETRIES) {
          throw error;
        }
        console.log(
          `Attempt ${attempt} failed, retrying in ${this.RETRY_DELAY}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, this.RETRY_DELAY));
      }
    }
  }

  async updateItemDetails(itemId, newDetails, tableName) {
    let conn;
    try {
      await this.withRetry(async () => {
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

        const updateQuery = `UPDATE ${tableName} SET ${updateFields.join(
          ", "
        )} WHERE item_id = ?`;
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
      const [activeImagesPromise, activeValueImagesPromise, bidImagesPromise] =
        await Promise.all([
          conn.query(`
          SELECT image, additional_images
          FROM crawled_items`),
          conn.query(`
          SELECT image, additional_images
          FROM values_items`),
          conn.query(`
          SELECT image
          FROM bids`),
        ]);

      const [activeImages] = activeImagesPromise;
      const [activeValueImages] = activeValueImagesPromise;
      const [bidImages] = bidImagesPromise;

      // 활성 이미지 경로 처리
      activeImages.forEach((item) => {
        if (item.image) activeImagePaths.add(item.image);
        if (item.additional_images) {
          JSON.parse(item.additional_images).forEach((img) =>
            activeImagePaths.add(img)
          );
        }
      });

      activeValueImages.forEach((item) => {
        if (item.image) activeImagePaths.add(item.image);
        if (item.additional_images) {
          JSON.parse(item.additional_images).forEach((img) =>
            activeImagePaths.add(img)
          );
        }
      });

      bidImages.forEach((item) => {
        if (item.image) activeImagePaths.add(item.image);
      });

      // 파일 시스템에서 이미지 정리
      const files = await fs.readdir(this.IMAGE_DIR);

      // 배치 처리 함수
      const processBatch = async (batch) => {
        await Promise.all(
          batch.map(async (file) => {
            const filePath = path.join(this.IMAGE_DIR, file);
            const relativePath = `/images/products/${file}`;
            if (!activeImagePaths.has(relativePath)) {
              try {
                await fs.unlink(filePath);
                //console.log(`Deleted unused image: ${filePath}`);
              } catch (unlinkError) {
                console.error(`Error deleting file ${filePath}:`, unlinkError);
              }
            }
          })
        );
      };

      // 배치 단위로 파일 처리
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        await processBatch(batch);
      }

      console.log("Complete to cleaning up unused images");
    } catch (error) {
      console.error("Error cleaning up unused images:", error);
    } finally {
      if (conn) {
        try {
          await conn.release();
        } catch (releaseError) {
          console.error("Error releasing database connection:", releaseError);
        }
      }
      activeImagePaths.clear();
    }
  }

  async cleanupOldValueItems(daysThreshold = 90, batchSize = 500) {
    let conn;
    try {
      conn = await this.pool.getConnection();

      // Get items to be deleted
      const [oldItems] = await conn.query(
        `
        SELECT item_id, image, additional_images 
        FROM values_items 
        WHERE scheduled_date < DATE_SUB(CURDATE(), INTERVAL ? DAY)
      `,
        [daysThreshold]
      );

      if (!oldItems.length) {
        console.log("No old items to clean up");
        return;
      }

      // Collect all image paths to be deleted
      const imagesToDelete = new Set();
      oldItems.forEach((item) => {
        if (item.image) imagesToDelete.add(item.image);
        if (item.additional_images) {
          try {
            JSON.parse(item.additional_images).forEach((img) =>
              imagesToDelete.add(img)
            );
          } catch (error) {
            console.error(
              `Error parsing additional_images for item ${item.item_id}:`,
              error
            );
          }
        }
      });

      // Delete items in batches
      const itemIds = oldItems.map((item) => item.item_id);
      for (let i = 0; i < itemIds.length; i += batchSize) {
        const batchIds = itemIds.slice(i, i + batchSize);
        await conn.query(
          `
          DELETE FROM values_items 
          WHERE item_id IN (?)
        `,
          [batchIds]
        );
      }

      // Delete associated images
      for (const imagePath of imagesToDelete) {
        try {
          const fullPath = path.join(__dirname, "..", "public", imagePath);
          await fs.access(fullPath); // Check if file exists
          await fs.unlink(fullPath);
        } catch (error) {
          if (error.code !== "ENOENT") {
            // Ignore if file doesn't exist
            console.error(`Error deleting image ${imagePath}:`, error);
          }
        }
      }

      console.log(
        `Cleaned up ${oldItems.length} items and their associated images`
      );
    } catch (error) {
      console.error("Error cleaning up old value items:", error);
      throw error;
    } finally {
      if (conn) await conn.release();
    }
  }
  async deleteItemsWithout(itemIds, tableName) {
    let conn;
    try {
      conn = await this.pool.getConnection();

      // Handle empty itemIds array
      if (!itemIds.length) {
        // If no items provided, delete all items for this auction
        const deleteAllQuery = `
          DELETE FROM ${tableName}
        `;
        await conn.query(deleteAllQuery);
      } else {
        // MariaDB compliant query using FIND_IN_SET alternative
        const deleteQuery = `
          DELETE FROM ${tableName}
          WHERE item_id NOT IN (?)
        `;

        await conn.query(deleteQuery, [itemIds]);
      }

      // If you need to clean up wishlists, use this query:
      await conn.query(`
        DELETE w FROM wishlists w
        LEFT JOIN ${tableName} ci ON w.item_id = ci.item_id
        WHERE ci.item_id IS NULL
      `);

      console.log("Complete to delete outdated items");
    } catch (error) {
      console.error("Error deleting items:", error.message);
      throw error; // Propagate error to caller
    } finally {
      if (conn) await conn.release();
    }
  }
  async saveItems(items, tableName, batchSize = 1000) {
    if (!items || !Array.isArray(items))
      throw new Error("Invalid input: items must be an array");

    let conn;
    try {
      await this.withRetry(async () => {
        conn = await this.pool.getConnection();
        await conn.beginTransaction();

        // Filter out items without title for insertion/update
        const validItems = items.filter((item) => item.title);
        if (validItems.length) {
          const columns = this.crawledItemColumns.filter((col) =>
            validItems[0].hasOwnProperty(col)
          );
          const placeholders = columns.map(() => "?").join(", ");
          const updateClauses = columns
            .map((col) => `${col} = VALUES(${col})`)
            .join(", ");

          // Process items in batches
          for (let i = 0; i < validItems.length; i += batchSize) {
            const batch = validItems.slice(i, i + batchSize);
            const insertQuery = `
              INSERT INTO ${tableName} (${columns.join(", ")})
              VALUES ${batch.map(() => `(${placeholders})`).join(", ")}
              ON DUPLICATE KEY UPDATE ${updateClauses}
            `;

            const values = batch.flatMap((item) =>
              columns.map((col) => {
                const value = item[col];
                return value;
              })
            );

            try {
              await conn.query(insertQuery, values);
            } catch (error) {
              console.error(
                `Error inserting batch ${i / batchSize + 1}:`,
                error
              );
              // 개별 아이템 삽입 시도
              for (let j = 0; j < batch.length; j++) {
                const singleItemValues = columns.map((col) => {
                  const value = batch[j][col];
                  return value;
                });
                const singleInsertQuery = `
                  INSERT INTO ${tableName} (${columns.join(", ")})
                  VALUES (${placeholders})
                  ON DUPLICATE KEY UPDATE ${updateClauses}
                `;
                try {
                  await conn.query(singleInsertQuery, singleItemValues);
                } catch (singleError) {
                  console.error(
                    `Error inserting item ${batch[j].item_id}:`,
                    singleError
                  );
                }
              }
            }
          }
        }
        await conn.commit();
        console.log("Items saved to database");
      });
    } catch (error) {
      if (conn) await conn.rollback();
      console.error("Error saving items to database:", error.message);
      throw error;
    } finally {
      if (conn) conn.release();
    }
  }
}

const DBManager = new DatabaseManager(pool);

module.exports = DBManager;
