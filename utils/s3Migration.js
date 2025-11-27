// utils/s3Migration.js
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { pool } = require("./DB");
const fs = require("fs").promises;
const path = require("path");

class ValuesImageMigration {
  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || "ap-northeast-2",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    this.bucketName = process.env.S3_BUCKET_NAME || "casa-images";
    this.cloudFrontDomain = process.env.CLOUDFRONT_DOMAIN;
    this.s3Folder = "values/";
    this.localDir = path.join(__dirname, "..", "public", "images", "values");

    // 동적 배치 크기 설정
    this.minBatchSize = 500; // 최소 배치 크기
    this.maxBatchSize = 5000; // 최대 배치 크기
    this.baseBatchSize = 2000; // 기본 배치 크기

    // 동시 업로드 수
    this.concurrentUploads = 20;

    // 통계
    this.stats = {
      totalProcessed: 0,
      successCount: 0,
      failedCount: 0,
      filesDeleted: 0,
      startTime: null,
      lastBatchTime: null,
    };
  }

  /**
   * 남은 아이템 수 조회
   */
  async getRemainingCount() {
    const query = `
      SELECT COUNT(*) as count
      FROM values_items
      WHERE (
        image LIKE '/images/values/%'
        OR additional_images LIKE '%/images/values/%'
      )
    `;

    const [rows] = await pool.query(query);
    return rows[0].count;
  }

  calculateBatchSize(remainingCount) {
    if (remainingCount >= 100000) {
      return 5000;
    } else if (remainingCount >= 50000) {
      return 3000;
    } else if (remainingCount >= 10000) {
      return 2000;
    } else if (remainingCount >= 5000) {
      return 1000;
    } else {
      return 500;
    }
  }

  /**
   * 진행률 출력
   */
  logProgress(remainingCount, batchSize) {
    const elapsed = Date.now() - this.stats.startTime;
    const rate =
      this.stats.totalProcessed > 0
        ? this.stats.totalProcessed / (elapsed / 1000)
        : 0;
    const eta = rate > 0 ? Math.round(remainingCount / rate / 60) : 0;

    console.log(
      `[S3 Migration] Progress: ${this.stats.successCount} migrated, ${
        this.stats.failedCount
      } failed | Remaining: ${remainingCount} | Batch: ${batchSize} | Rate: ${rate.toFixed(
        2
      )}/s | ETA: ${eta}min`
    );
  }

  /**
   * 메인 마이그레이션 실행
   */
  async migrate() {
    this.stats.startTime = Date.now();
    console.log(`[S3 Migration] Starting at ${new Date().toISOString()}`);

    try {
      // 전체 남은 개수 확인
      let remainingCount = await this.getRemainingCount();
      console.log(`[S3 Migration] Total items to migrate: ${remainingCount}`);

      if (remainingCount === 0) {
        console.log("[S3 Migration] No items to migrate");
        return this.getFinalStats();
      }

      // 배치 단위로 처리
      while (remainingCount > 0) {
        const batchSize = this.calculateBatchSize(remainingCount);
        this.stats.lastBatchTime = Date.now();

        // DB에서 배치 조회
        const items = await this.getItemsToMigrate(batchSize);

        if (items.length === 0) {
          console.log("[S3 Migration] No more items found");
          break;
        }

        // 배치 처리
        const results = await this.processItemsBatch(items);

        // 통계 업데이트
        this.stats.totalProcessed += items.length;
        this.stats.successCount += results.success.length;
        this.stats.failedCount += results.failed.length;

        // 성공한 항목의 로컬 파일 삭제
        const deletedCount = await this.cleanupLocalFiles(results.success);
        this.stats.filesDeleted += deletedCount;

        // 남은 개수 재조회
        remainingCount = await this.getRemainingCount();

        // 진행률 출력
        this.logProgress(remainingCount, batchSize);

        // 다음 배치 전 짧은 대기 (DB 부하 방지)
        await this.sleep(100);
      }

      return this.getFinalStats();
    } catch (error) {
      console.error("[S3 Migration] Fatal error:", error);
      throw error;
    }
  }

  /**
   * DB에서 로컬 경로를 가진 아이템 조회
   */
  async getItemsToMigrate(batchSize) {
    const query = `
      SELECT item_id, auc_num, image, additional_images
      FROM values_items
      WHERE (
        image LIKE '/images/values/%'
        OR additional_images LIKE '%/images/values/%'
      )
      LIMIT ?
    `;

    const [items] = await pool.query(query, [batchSize]);
    return items;
  }

  /**
   * 아이템 배치 처리 (병렬)
   */
  async processItemsBatch(items) {
    const success = [];
    const failed = [];

    // 동시 처리를 위한 청크 분할
    for (let i = 0; i < items.length; i += this.concurrentUploads) {
      const chunk = items.slice(i, i + this.concurrentUploads);

      const chunkResults = await Promise.allSettled(
        chunk.map((item) => this.processItem(item))
      );

      chunkResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          success.push(result.value);
        } else {
          const item = chunk[index];
          console.error(
            `[S3 Migration] Failed to process item ${item.item_id}:`,
            result.reason.message
          );
          failed.push({
            item_id: item.item_id,
            auc_num: item.auc_num,
            error: result.reason.message,
          });
        }
      });
    }

    return { success, failed };
  }

  /**
   * 개별 아이템 처리 (업로드 + DB 업데이트)
   */
  async processItem(item) {
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const updates = {};
      const uploadedFiles = [];

      // 메인 이미지 처리
      if (item.image && this.isLocalPath(item.image)) {
        const s3Url = await this.uploadImageToS3(item.image);
        updates.image = s3Url;
        uploadedFiles.push(path.basename(item.image));
      }

      // 추가 이미지 처리
      if (item.additional_images) {
        try {
          const additionalImages = JSON.parse(item.additional_images);
          const localImages = additionalImages.filter((img) =>
            this.isLocalPath(img)
          );

          if (localImages.length > 0) {
            // 병렬 업로드
            const s3Urls = await Promise.all(
              localImages.map((img) => this.uploadImageToS3(img))
            );

            // 로컬 경로를 S3 URL로 교체
            const updatedImages = additionalImages.map((img) => {
              if (this.isLocalPath(img)) {
                const index = localImages.indexOf(img);
                uploadedFiles.push(path.basename(img));
                return s3Urls[index];
              }
              return img;
            });

            updates.additional_images = JSON.stringify(updatedImages);
          }
        } catch (parseError) {
          console.warn(
            `[S3 Migration] Failed to parse additional_images for ${item.item_id}:`,
            parseError.message
          );
        }
      }

      // DB 업데이트
      if (Object.keys(updates).length > 0) {
        await this.updateDatabase(conn, item, updates);
      }

      await conn.commit();

      return {
        item_id: item.item_id,
        auc_num: item.auc_num,
        uploadedFiles,
        updates,
      };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  /**
   * 이미지를 S3에 업로드
   */
  async uploadImageToS3(localPath) {
    const fileName = path.basename(localPath);
    const filePath = path.join(this.localDir, fileName);

    // 파일 존재 확인
    try {
      await fs.access(filePath);
    } catch (error) {
      throw new Error(`File not found: ${filePath}`);
    }

    // 파일 읽기
    const fileContent = await fs.readFile(filePath);

    // S3 업로드
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: `${this.s3Folder}${fileName}`,
      Body: fileContent,
      ContentType: "image/webp",
      CacheControl: "max-age=31536000, immutable",
    });

    await this.s3Client.send(command);

    // CloudFront URL 반환
    return `https://${this.cloudFrontDomain}/${this.s3Folder}${fileName}`;
  }

  /**
   * DB 업데이트
   */
  async updateDatabase(conn, item, updates) {
    const setClause = [];
    const values = [];

    if (updates.image) {
      setClause.push("image = ?");
      values.push(updates.image);
    }

    if (updates.additional_images) {
      setClause.push("additional_images = ?");
      values.push(updates.additional_images);
    }

    values.push(item.item_id, item.auc_num);

    const query = `
      UPDATE values_items
      SET ${setClause.join(", ")}
      WHERE item_id = ? AND auc_num = ?
    `;

    await conn.query(query, values);
  }

  /**
   * 로컬 파일 삭제
   */
  async cleanupLocalFiles(successResults) {
    const filesToDelete = new Set();

    // 삭제할 파일 목록 수집
    successResults.forEach((result) => {
      result.uploadedFiles.forEach((fileName) => {
        filesToDelete.add(fileName);
      });
    });

    let deletedCount = 0;

    // 파일 삭제
    for (const fileName of filesToDelete) {
      try {
        const filePath = path.join(this.localDir, fileName);
        await fs.unlink(filePath);
        deletedCount++;
      } catch (error) {
        // 파일이 이미 없는 경우는 무시
        if (error.code !== "ENOENT") {
          console.error(
            `[S3 Migration] Failed to delete ${fileName}:`,
            error.message
          );
        }
      }
    }

    return deletedCount;
  }

  /**
   * 로컬 경로 판별
   */
  isLocalPath(path) {
    return path && path.startsWith("/images/values/");
  }

  /**
   * 대기 함수
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 최종 통계 반환
   */
  getFinalStats() {
    const duration = Date.now() - this.stats.startTime;

    return {
      totalProcessed: this.stats.totalProcessed,
      successCount: this.stats.successCount,
      failedCount: this.stats.failedCount,
      filesDeleted: this.stats.filesDeleted,
      duration: this.formatDuration(duration),
      avgRate:
        this.stats.totalProcessed > 0
          ? (this.stats.totalProcessed / (duration / 1000)).toFixed(2)
          : 0,
    };
  }

  /**
   * 실행 시간 포맷
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    const remainingMinutes = minutes % 60;
    const remainingSeconds = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

/**
 * 수동 실행용 함수
 */
async function runMigration() {
  const migration = new ValuesImageMigration();

  try {
    const stats = await migration.migrate();

    console.log("\n" + "=".repeat(60));
    console.log("[S3 Migration] Final Statistics");
    console.log("=".repeat(60));
    console.log(`Total Processed: ${stats.totalProcessed}`);
    console.log(`Successfully Migrated: ${stats.successCount}`);
    console.log(`Failed: ${stats.failedCount}`);
    console.log(`Files Deleted: ${stats.filesDeleted}`);
    console.log(`Duration: ${stats.duration}`);
    console.log(`Average Rate: ${stats.avgRate} items/sec`);
    console.log("=".repeat(60));

    return stats;
  } catch (error) {
    console.error("[S3 Migration] Fatal error:", error);
    throw error;
  }
}

module.exports = { ValuesImageMigration, runMigration };
