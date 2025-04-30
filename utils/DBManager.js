// utils/DBManager.js
const pool = require("./DB");
const fs = require("fs").promises;
const path = require("path");

class DatabaseManager {
  constructor(pool) {
    this.pool = pool;
    this.RETRY_DELAY = 1000;
    this.MAX_RETRIES = 1;

    // 기본 컬럼 정의 (공통적으로 사용될 수 있는 컬럼들)
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
      "kaijoCd",
      "kaisaiKaisu",
      "bid_type",
      "original_scheduled_date",
    ];

    // 테이블별 컬럼 정의
    this.tableColumns = {
      crawled_items: [
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
        "kaijoCd",
        "kaisaiKaisu",
        "bid_type",
        "original_scheduled_date",
      ],
      values_items: [
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
        "kaijoCd",
        "kaisaiKaisu",
      ],
      invoices: ["date", "auc_num", "status", "amount"],
      // 필요한 다른 테이블들의 컬럼 정의를 여기에 추가할 수 있습니다
    };

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

  async updateItems(items, tableName) {
    if (!items || items.length === 0) {
      console.log("No updates to save");
      return;
    }

    console.log(`Updating ${items.length} items in ${tableName}`);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const item of items) {
        // item_id와 scheduled_date, starting_price만 업데이트
        if (item.item_id && (item.scheduled_date || item.starting_price)) {
          const updateFields = [];
          const values = [];

          if (item.scheduled_date) {
            updateFields.push("scheduled_date = ?");
            values.push(item.scheduled_date);
          }

          if (item.starting_price) {
            updateFields.push("starting_price = ?");
            values.push(item.starting_price);
          }

          if (updateFields.length > 0) {
            // 업데이트 쿼리 실행
            const query = `UPDATE ${tableName} SET ${updateFields.join(
              ", "
            )} WHERE item_id = ?`;
            values.push(item.item_id);
            await conn.query(query, values);
          }
        }
      }

      await conn.commit();
      console.log(`Successfully updated ${items.length} items in ${tableName}`);
    } catch (error) {
      await conn.rollback();
      console.error(`Error updating items in ${tableName}:`, error);
      throw error;
    } finally {
      conn.release();
    }
  }

  async updateItemDetails(itemId, newDetails, tableName) {
    let conn;
    try {
      await this.withRetry(async () => {
        conn = await this.pool.getConnection();

        const updateFields = [];
        const updateValues = [];

        // 테이블별 컬럼을 사용
        const validColumns =
          this.tableColumns[tableName] || this.crawledItemColumns;

        for (const [key, value] of Object.entries(newDetails)) {
          if (validColumns.includes(key)) {
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
      const [activeImagesPromise, activeValueImagesPromise, bidItemsPromise] =
        await Promise.all([
          conn.query(`
          SELECT image, additional_images
          FROM crawled_items`),
          conn.query(`
          SELECT image, additional_images
          FROM values_items`),
          conn.query(`
          SELECT ci.image, ci.additional_images 
          FROM crawled_items ci
          JOIN (
            SELECT DISTINCT item_id FROM direct_bids
            UNION
            SELECT DISTINCT item_id FROM live_bids
          ) b ON ci.item_id = b.item_id`),
        ]);

      const [activeImages] = activeImagesPromise;
      const [activeValueImages] = activeValueImagesPromise;
      const [bidItemImages] = bidItemsPromise;

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

      bidItemImages.forEach((item) => {
        if (item.image) activeImagePaths.add(item.image);
        if (item.additional_images) {
          JSON.parse(item.additional_images).forEach((img) =>
            activeImagePaths.add(img)
          );
        }
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
        WHERE scheduled_date < DATE_SUB(NOW(), INTERVAL ? DAY) OR scheduled_date IS NULL
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

      // direct_bids와 live_bids 테이블에 있는 item_id 가져오기
      const [bidItems] = await conn.query(`
        SELECT DISTINCT item_id FROM direct_bids
        UNION
        SELECT DISTINCT item_id FROM live_bids
      `);

      // 입찰이 있는 아이템 ID 목록 생성
      const bidItemIds = bidItems.map((item) => item.item_id);

      // 삭제해서는 안 될 아이템 ID 목록 (입찰이 있는 아이템 + 파라미터로 받은 아이템)
      const protectedItemIds = [...new Set([...bidItemIds, ...itemIds])];

      // Handle empty itemIds array
      if (!protectedItemIds.length) {
        // If no items provided and no bid items, delete all items
        const deleteAllQuery = `
          DELETE FROM ${tableName}
        `;
        await conn.query(deleteAllQuery);
      } else {
        // MariaDB compliant query to delete items not in protected list
        const deleteQuery = `
          DELETE FROM ${tableName}
          WHERE item_id NOT IN (?)
        `;

        await conn.query(deleteQuery, [protectedItemIds]);
      }

      // If you need to clean up wishlists, use this query:
      await conn.query(`
        DELETE w FROM wishlists w
        LEFT JOIN ${tableName} ci ON w.item_id = ci.item_id
        WHERE ci.item_id IS NULL
      `);

      console.log(
        "Complete to delete outdated items (protected bid items preserved)"
      );
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
        const validItems =
          tableName === "invoices"
            ? items.filter((item) => item.date && item.auc_num) // 인보이스는 date와 auc_num 기준으로 필터링
            : items.filter((item) => item.title);
        if (validItems.length) {
          // 테이블별 정의된 컬럼 사용
          const tableSpecificColumns =
            this.tableColumns[tableName] || this.crawledItemColumns;

          // 모든 아이템의 속성을 수집하여 해당 테이블에 정의된 컬럼 중 사용할 컬럼을 결정
          const itemKeys = new Set();
          validItems.forEach((item) => {
            Object.keys(item).forEach((key) => itemKeys.add(key));
          });

          // 아이템의 속성 중 테이블에 정의된 컬럼만 사용
          const columns = tableSpecificColumns.filter((col) =>
            itemKeys.has(col)
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
                // 속성이 없는 경우 null을 사용
                const value = item.hasOwnProperty(col) ? item[col] : null;
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
                  // 속성이 없는 경우 null을 사용
                  const value = batch[j].hasOwnProperty(col)
                    ? batch[j][col]
                    : null;
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
