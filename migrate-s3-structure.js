// migrate-s3-structure.js
require("dotenv").config();
const {
  S3Client,
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const { pool } = require("./utils/DB");
const fs = require("fs").promises;

class S3StructureMigration {
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
    this.oldPrefix = "values/";
    this.newPrefix = "values/";

    // DB 쿼리 결과 캐시 (파일명 → 날짜)
    this.dateCache = new Map();

    // URL 매핑 파일 (DB 업데이트용)
    this.urlMappingFile = "./s3-migration-mappings.json";
    this.urlMappings = [];

    this.stats = {
      totalFiles: 0,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      dbCacheHits: 0,
      dbUpdated: 0,
      startTime: null,
    };
  }

  /**
   * DB에서 모든 이미지 날짜 정보 사전 로딩 (메모리 캐싱)
   */
  async preloadDateCache() {
    console.log("[Migration] Preloading date cache from DB...");
    const startTime = Date.now();

    try {
      const [rows] = await pool.query(
        `SELECT image, additional_images, scheduled_date 
         FROM values_items 
         WHERE scheduled_date IS NOT NULL`
      );

      for (const row of rows) {
        // image 컬럼
        if (row.image) {
          const fileName = row.image.split("/").pop();
          if (!this.dateCache.has(fileName)) {
            this.dateCache.set(fileName, row.scheduled_date);
          }
        }

        // additional_images JSON 배열
        if (row.additional_images) {
          try {
            const additionalImages = JSON.parse(row.additional_images);
            for (const imgUrl of additionalImages) {
              const fileName = imgUrl.split("/").pop();
              if (!this.dateCache.has(fileName)) {
                this.dateCache.set(fileName, row.scheduled_date);
              }
            }
          } catch (e) {
            // JSON 파싱 실패 무시
          }
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(
        `[Migration] Cached ${this.dateCache.size} file dates in ${elapsed}s`
      );
    } catch (error) {
      console.error("[Migration] Failed to preload date cache:", error.message);
      throw error;
    }
  }

  /**
   * 이미지 하위 폴더 경로 생성
   */
  getImageSubFolder(scheduledDate, fileName) {
    let yearMonth;

    if (scheduledDate) {
      try {
        const date = new Date(scheduledDate);
        if (!isNaN(date.getTime())) {
          yearMonth = date.toISOString().slice(0, 7);
        }
      } catch (e) {
        yearMonth = "legacy";
      }
    }

    if (!yearMonth) {
      yearMonth = "legacy";
    }

    const firstChar = fileName.charAt(0).toLowerCase();
    return `${yearMonth}/${firstChar}`;
  }

  /**
   * S3에서 values/ 폴더의 모든 파일 리스트
   */
  async listAllS3Files() {
    const files = [];
    let continuationToken = null;

    console.log("[Migration] Listing all S3 files...");

    do {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: this.oldPrefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      });

      const response = await this.s3Client.send(command);

      if (response.Contents) {
        // 하위 폴더 구조가 아닌 파일만 (values/xxx.webp 형태)
        const flatFiles = response.Contents.filter((item) => {
          const relativePath = item.Key.replace(this.oldPrefix, "");
          // 슬래시가 없으면 평면 구조
          return !relativePath.includes("/");
        });

        files.push(...flatFiles.map((item) => item.Key));
      }

      continuationToken = response.NextContinuationToken;

      if (files.length % 50000 === 0 && files.length > 0) {
        console.log(`[Migration] Found ${files.length} files so far...`);
      }
    } while (continuationToken);

    console.log(`[Migration] Total files to migrate: ${files.length}`);
    return files;
  }

  /**
   * 캐시에서 scheduled_date 조회 (DB 쿼리 제거)
   */
  getItemDateFromCache(fileName) {
    const cleanFileName = fileName.replace(this.oldPrefix, "");

    if (this.dateCache.has(cleanFileName)) {
      this.stats.dbCacheHits++;
      return this.dateCache.get(cleanFileName);
    }

    return null; // legacy 폴더로 이동
  }

  /**
   * S3 파일 이동 (서버 측 복사)
   */
  async moveS3File(oldKey, newKey) {
    try {
      // 1. 복사
      await this.s3Client.send(
        new CopyObjectCommand({
          Bucket: this.bucketName,
          CopySource: `${this.bucketName}/${oldKey}`,
          Key: newKey,
          MetadataDirective: "COPY",
          CacheControl: "max-age=31536000, immutable",
        })
      );

      // 2. 원본 삭제
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: oldKey,
        })
      );

      return true;
    } catch (error) {
      console.error(`Failed to move ${oldKey} to ${newKey}:`, error.message);
      return false;
    }
  }

  /**
   * URL 매핑 파일에 저장 (DB 업데이트는 나중에 별도 실행)
   */
  async saveUrlMapping(oldUrl, newUrl) {
    this.urlMappings.push({ oldUrl, newUrl });

    // 10000개마다 파일에 저장 (메모리 오버플로우 방지)
    if (this.urlMappings.length >= 10000) {
      await this.flushUrlMappings();
    }
  }

  /**
   * 메모리의 URL 매핑을 파일에 기록
   */
  async flushUrlMappings() {
    if (this.urlMappings.length === 0) return;

    try {
      const jsonData = this.urlMappings
        .map((m) => JSON.stringify(m))
        .join("\n");
      await fs.appendFile(this.urlMappingFile, jsonData + "\n");
      this.urlMappings = [];
    } catch (error) {
      console.error("Failed to flush URL mappings:", error.message);
    }
  }

  /**
   * DB 배치 업데이트 (트랜잭션) - 최적화
   */
  async updateDBBatch(mappings) {
    if (mappings.length === 0) return 0;

    const conn = await pool.getConnection();
    let updatedCount = 0;

    try {
      await conn.beginTransaction();

      // URL 맵 생성 (old → new)
      const urlMap = new Map(mappings.map((m) => [m.oldUrl, m.newUrl]));
      const oldUrls = Array.from(urlMap.keys());

      // CASE WHEN으로 한 번에 업데이트 (훨씬 빠름)
      if (oldUrls.length > 0) {
        // image 컬럼 일괄 업데이트
        const imageCases = oldUrls.map((oldUrl) => `WHEN ? THEN ?`).join(" ");
        const imagePlaceholders = oldUrls.flatMap((oldUrl) => [
          oldUrl,
          urlMap.get(oldUrl),
        ]);
        const imageWhereIn = oldUrls.map(() => "?").join(",");

        const [imageResult] = await conn.query(
          `UPDATE values_items 
           SET image = CASE image ${imageCases} END
           WHERE image IN (${imageWhereIn})`,
          [...imagePlaceholders, ...oldUrls]
        );

        updatedCount += imageResult.affectedRows;

        // additional_images 일괄 업데이트 (REPLACE)
        for (const { oldUrl, newUrl } of mappings) {
          const [additionalResult] = await conn.query(
            `UPDATE values_items 
             SET additional_images = REPLACE(additional_images, ?, ?)
             WHERE additional_images LIKE ?`,
            [oldUrl, newUrl, `%${oldUrl}%`]
          );

          if (additionalResult.affectedRows > 0) {
            updatedCount += additionalResult.affectedRows;
          }
        }
      }

      await conn.commit();
      return updatedCount;
    } catch (error) {
      await conn.rollback();
      console.error(`Batch DB update failed:`, error.message);
      return 0;
    } finally {
      conn.release();
    }
  }

  /**
   * 단일 파일 마이그레이션 (S3만 처리)
   */
  async migrateFile(s3Key) {
    const fileName = s3Key.replace(this.oldPrefix, "");

    // 이미 하위 폴더 구조면 스킵
    if (fileName.includes("/")) {
      this.stats.skipped++;
      return null;
    }

    // 캐시에서 scheduled_date 조회 (DB 쿼리 없음)
    const scheduledDate = this.getItemDateFromCache(fileName);

    // 새 S3 키 생성
    const subFolder = this.getImageSubFolder(scheduledDate, fileName);
    const newKey = `${this.newPrefix}${subFolder}/${fileName}`;

    // S3 파일 이동
    const moveSuccess = await this.moveS3File(s3Key, newKey);

    if (moveSuccess) {
      this.stats.success++;

      // URL 매핑 저장 (파일로)
      await this.saveUrlMapping(
        `https://${this.cloudFrontDomain}/${s3Key}`,
        `https://${this.cloudFrontDomain}/${newKey}`
      );

      return true;
    } else {
      this.stats.failed++;
      return null;
    }
  }

  /**
   * 배치 처리 (순수 S3 작업만 - 최대 병렬)
   */
  async migrateBatch(files, batchSize = 500) {
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);

      // S3 파일 이동만 병렬 실행 (DB 작업 없음)
      await Promise.all(batch.map((file) => this.migrateFile(file)));

      this.stats.processed += batch.length;

      // 진행률 출력 (5000개마다)
      if (
        this.stats.processed % 5000 === 0 ||
        this.stats.processed === files.length
      ) {
        this.logProgress();
      }

      // S3 API rate limit 고려 (10000개마다 짧은 대기)
      if (i % 10000 === 0 && i > 0) {
        await this.sleep(100);
      }
    }

    // 남은 URL 매핑 플러시
    await this.flushUrlMappings();
  }

  /**
   * 매핑 파일에서 DB 업데이트 (프로그래밍 방식 - 초고속)
   */
  async updateDBFromMappings() {
    const readline = require("readline");
    const { createReadStream } = require("fs");

    try {
      // 파일 존재 확인
      await fs.access(this.urlMappingFile);

      console.log("[DB Update] Loading all items from DB...");
      const [items] = await pool.query(
        `SELECT id, image, additional_images FROM values_items`
      );
      console.log(`[DB Update] Loaded ${items.length} items`);

      // URL → 새 URL 맵 생성
      console.log("[DB Update] Loading mappings...");
      const urlMap = new Map();
      const stream = createReadStream(this.urlMappingFile);
      const rl = readline.createInterface({ input: stream });

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const { oldUrl, newUrl } = JSON.parse(line);
          urlMap.set(oldUrl, newUrl);
        } catch (e) {}
      }
      console.log(`[DB Update] Loaded ${urlMap.size} mappings`);

      // 메모리에서 매칭
      console.log("[DB Update] Matching in memory...");
      const updates = [];
      let processedCount = 0;

      for (const item of items) {
        let changed = false;
        let newImage = item.image;
        let newAdditional = item.additional_images;

        // image 컬럼 매칭
        if (item.image && urlMap.has(item.image)) {
          newImage = urlMap.get(item.image);
          changed = true;
        }

        // additional_images 매칭
        if (item.additional_images) {
          try {
            const additionalImages = JSON.parse(item.additional_images);
            const updatedImages = additionalImages.map((url) =>
              urlMap.has(url) ? urlMap.get(url) : url
            );

            if (
              JSON.stringify(additionalImages) !== JSON.stringify(updatedImages)
            ) {
              newAdditional = JSON.stringify(updatedImages);
              changed = true;
            }
          } catch (e) {}
        }

        if (changed) {
          updates.push({
            id: item.id,
            image: newImage,
            additional_images: newAdditional,
          });
        }

        processedCount++;
        if (processedCount % 10000 === 0) {
          console.log(
            `[DB Update] Processed ${processedCount}/${items.length} items, ${updates.length} changes found`
          );
        }
      }

      console.log(`[DB Update] Found ${updates.length} items to update`);

      // 배치 업데이트
      console.log("[DB Update] Writing to DB...");
      const batchSize = 500;
      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);

        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();

          for (const { id, image, additional_images } of batch) {
            await conn.query(
              `UPDATE values_items SET image = ?, additional_images = ? WHERE id = ?`,
              [image, additional_images, id]
            );
          }

          await conn.commit();
          this.stats.dbUpdated += batch.length;
        } catch (error) {
          await conn.rollback();
          console.error(`Batch update failed:`, error.message);
        } finally {
          conn.release();
        }

        if ((i + batchSize) % 5000 === 0) {
          console.log(
            `[DB Update] ${this.stats.dbUpdated}/${updates.length} rows updated`
          );
        }
      }

      console.log(`[DB Update] Complete: ${this.stats.dbUpdated} rows updated`);
    } catch (error) {
      if (error.code === "ENOENT") {
        console.error(`\n❌ Mapping file not found: ${this.urlMappingFile}`);
        console.error("   Run S3 migration first without --update-db flag");
      } else {
        console.error("[DB Update] Fatal error:", error);
      }
      throw error;
    }
  }

  /**
   * 메인 마이그레이션 실행
   */
  async migrate(options = {}) {
    const { updateDB = false, dbOnly = false } = options;

    this.stats.startTime = Date.now();
    console.log(
      `\n[S3 Structure Migration] Starting at ${new Date().toISOString()}`
    );
    console.log("=".repeat(60));

    try {
      // DB만 업데이트 모드 (S3 스킵)
      if (dbOnly) {
        console.log("[Migration] DB-ONLY MODE: Skipping S3 migration");
        console.log(
          "[Migration] Starting DB update from existing mapping file..."
        );
        await this.updateDBFromMappings();
        return this.getFinalStats();
      }

      // 0. 기존 매핑 파일 삭제 (S3 재마이그레이션 시)
      try {
        await fs.unlink(this.urlMappingFile);
      } catch (e) {
        // 파일 없으면 무시
      }

      // 1. DB 날짜 캐시 사전 로딩 (한 번만)
      await this.preloadDateCache();

      // 2. S3 파일 리스트
      const files = await this.listAllS3Files();
      this.stats.totalFiles = files.length;

      if (files.length === 0) {
        console.log(
          "[Migration] No flat files to migrate (already structured)"
        );

        // S3는 완료됐지만 DB 업데이트 필요한 경우
        if (updateDB) {
          console.log("[Migration] Checking for existing mapping file...");
          try {
            await fs.access(this.urlMappingFile);
            console.log("[Migration] Found mapping file, updating DB...");
            await this.updateDBFromMappings();
          } catch (e) {
            console.log(
              "[Migration] No mapping file found. S3 migration already complete."
            );
          }
        }

        return this.getFinalStats();
      }

      // 3. S3 배치 처리 (병렬 최대화)
      console.log("[Migration] Starting S3 file migration (parallel)...");
      await this.migrateBatch(files);

      // 4. DB 업데이트 (옵션)
      if (updateDB) {
        console.log("\n[Migration] Starting DB update...");
        await this.updateDBFromMappings();
      }

      // 5. 최종 통계
      const stats = this.getFinalStats();

      if (!updateDB) {
        console.log(`\n📝 URL mappings saved to: ${this.urlMappingFile}`);
        console.log(
          `   To update DB, run: node migrate-s3-structure.js --db-only`
        );
      }

      return stats;
    } catch (error) {
      console.error("[Migration] Fatal error:", error);
      throw error;
    }
  }

  /**
   * 진행률 출력
   */
  logProgress() {
    const elapsed = Date.now() - this.stats.startTime;
    const rate = this.stats.processed / (elapsed / 1000);
    const remaining = this.stats.totalFiles - this.stats.processed;
    const eta = rate > 0 ? Math.round(remaining / rate / 60) : 0;
    const cacheHitRate =
      this.stats.processed > 0
        ? ((this.stats.dbCacheHits / this.stats.processed) * 100).toFixed(1)
        : 0;

    console.log(
      `[S3 Migration] ${this.stats.processed}/${this.stats.totalFiles} | ` +
        `✓${this.stats.success} ✗${this.stats.failed} ⊘${this.stats.skipped} | ` +
        `Cache: ${cacheHitRate}% | ${rate.toFixed(1)}/s | ETA: ${eta}min`
    );
  }

  /**
   * 최종 통계
   */
  getFinalStats() {
    const duration = Date.now() - this.stats.startTime;
    const cacheHitRate =
      this.stats.processed > 0
        ? ((this.stats.dbCacheHits / this.stats.processed) * 100).toFixed(1)
        : 0;

    return {
      totalFiles: this.stats.totalFiles,
      processed: this.stats.processed,
      success: this.stats.success,
      failed: this.stats.failed,
      skipped: this.stats.skipped,
      dbUpdated: this.stats.dbUpdated,
      cacheHitRate: `${cacheHitRate}%`,
      duration: this.formatDuration(duration),
      avgRate:
        this.stats.processed > 0
          ? (this.stats.processed / (duration / 1000)).toFixed(2)
          : 0,
    };
  }

  /**
   * 시간 포맷
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

  /**
   * 대기 함수
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * 메인 실행
 */
async function main() {
  const migration = new S3StructureMigration();

  // 커맨드라인 옵션 파싱
  const args = process.argv.slice(2);
  const updateDB = args.includes("--update-db");
  const dbOnly = args.includes("--db-only");

  try {
    console.log("\n" + "=".repeat(60));
    console.log("S3 Structure Migration Tool");
    console.log("=".repeat(60));
    console.log(
      "This will reorganize values/ images into date-based subfolders"
    );
    console.log("Example: values/xxx.webp → values/2025-01/x/xxx.webp");

    if (dbOnly) {
      console.log(
        "\n💾 DB-ONLY MODE: Will only update database from mapping file"
      );
    } else if (updateDB) {
      console.log("\n🔄 FULL MODE: S3 migration + DB update");
    } else {
      console.log("\n📦 S3 ONLY MODE: DB update with --db-only later");
    }
    console.log("=".repeat(60) + "\n");

    const stats = await migration.migrate({ updateDB, dbOnly });

    console.log("\n" + "=".repeat(60));
    console.log("[Migration] Final Statistics");
    console.log("=".repeat(60));
    console.log(`Total Files: ${stats.totalFiles}`);
    console.log(`Processed: ${stats.processed}`);
    console.log(`Successfully Migrated: ${stats.success}`);
    console.log(`Failed: ${stats.failed}`);
    console.log(`Skipped (already structured): ${stats.skipped}`);
    if (updateDB || dbOnly) {
      console.log(`DB Updated: ${stats.dbUpdated} rows`);
    }
    console.log(`DB Cache Hit Rate: ${stats.cacheHitRate}`);
    console.log(`Duration: ${stats.duration}`);
    console.log(`Average Rate: ${stats.avgRate} files/sec`);
    console.log("=".repeat(60));

    if (stats.failed > 0) {
      console.log("\n⚠️  Some files failed to migrate. Check logs above.");
    } else {
      console.log("\n✅ Migration completed successfully!");
    }

    process.exit(0);
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  }
}

// 직접 실행 시
if (require.main === module) {
  main();
}

module.exports = { S3StructureMigration };
