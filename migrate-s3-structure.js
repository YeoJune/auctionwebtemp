// migrate-s3-structure.js
require("dotenv").config();
const {
  S3Client,
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const { pool } = require("./utils/DB");

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

    this.stats = {
      totalFiles: 0,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      dbUpdated: 0,
      startTime: null,
    };
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
   * DB에서 scheduled_date 조회 (파일명 기반)
   */
  async getItemDateFromDB(fileName) {
    try {
      // CloudFront URL에서 파일명 추출
      const cleanFileName = fileName.replace(this.oldPrefix, "");

      const [rows] = await pool.query(
        `SELECT scheduled_date 
         FROM values_items 
         WHERE image LIKE ? OR additional_images LIKE ?
         LIMIT 1`,
        [`%${cleanFileName}%`, `%${cleanFileName}%`]
      );

      if (rows.length > 0 && rows[0].scheduled_date) {
        return rows[0].scheduled_date;
      }
    } catch (error) {
      console.error(`Error fetching date for ${fileName}:`, error.message);
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
   * DB 경로 배치 업데이트 (트랜잭션 최소화)
   */
  async updateDBPathsBatch(urlMappings) {
    if (urlMappings.length === 0) return 0;

    const conn = await pool.getConnection();
    let updatedCount = 0;

    try {
      await conn.beginTransaction();

      // 각 URL 쌍에 대해 업데이트 (하나의 트랜잭션에서)
      for (const { oldUrl, newUrl } of urlMappings) {
        try {
          // image 컬럼 업데이트
          const [imageResult] = await conn.query(
            `UPDATE values_items 
             SET image = ? 
             WHERE image = ?`,
            [newUrl, oldUrl]
          );

          // additional_images JSON 업데이트
          const [additionalResult] = await conn.query(
            `UPDATE values_items 
             SET additional_images = REPLACE(additional_images, ?, ?)
             WHERE additional_images LIKE ?`,
            [oldUrl, newUrl, `%${oldUrl}%`]
          );

          if (
            imageResult.affectedRows > 0 ||
            additionalResult.affectedRows > 0
          ) {
            updatedCount++;
          }
        } catch (error) {
          console.error(`Failed to update ${oldUrl}:`, error.message);
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
   * 단일 파일 마이그레이션 (DB 업데이트 제외)
   */
  async migrateFile(s3Key) {
    const fileName = s3Key.replace(this.oldPrefix, "");

    // 이미 하위 폴더 구조면 스킵
    if (fileName.includes("/")) {
      this.stats.skipped++;
      return null;
    }

    // DB에서 scheduled_date 조회
    const scheduledDate = await this.getItemDateFromDB(fileName);

    // 새 S3 키 생성
    const subFolder = this.getImageSubFolder(scheduledDate, fileName);
    const newKey = `${this.newPrefix}${subFolder}/${fileName}`;

    // S3 파일 이동
    const moveSuccess = await this.moveS3File(s3Key, newKey);

    if (moveSuccess) {
      this.stats.success++;

      // DB 업데이트 정보 반환 (나중에 배치 처리)
      return {
        oldUrl: `https://${this.cloudFrontDomain}/${s3Key}`,
        newUrl: `https://${this.cloudFrontDomain}/${newKey}`,
      };
    } else {
      this.stats.failed++;
      return null;
    }
  }

  /**
   * 배치 처리
   */
  async migrateBatch(files, batchSize = 100) {
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);

      // 1. S3 파일 이동 (병렬)
      const results = await Promise.all(
        batch.map((file) => this.migrateFile(file))
      );

      // 2. DB 업데이트할 URL 매핑 수집
      const urlMappings = results.filter((r) => r !== null);

      // 3. DB 배치 업데이트 (단일 트랜잭션)
      if (urlMappings.length > 0) {
        const dbUpdated = await this.updateDBPathsBatch(urlMappings);
        this.stats.dbUpdated += dbUpdated;
      }

      this.stats.processed += batch.length;

      // 진행률 출력 (1000개마다)
      if (
        this.stats.processed % 1000 === 0 ||
        this.stats.processed === files.length
      ) {
        this.logProgress();
      }

      // 서버 부하 방지 (1000개마다 대기)
      if (i % 1000 === 0 && i > 0) {
        await this.sleep(50);
      }
    }
  }

  /**
   * 메인 마이그레이션 실행
   */
  async migrate() {
    this.stats.startTime = Date.now();
    console.log(
      `\n[S3 Structure Migration] Starting at ${new Date().toISOString()}`
    );
    console.log("=".repeat(60));

    try {
      // 1. S3 파일 리스트
      const files = await this.listAllS3Files();
      this.stats.totalFiles = files.length;

      if (files.length === 0) {
        console.log("[Migration] No files to migrate");
        return this.getFinalStats();
      }

      // 2. 배치 처리
      await this.migrateBatch(files);

      // 3. 최종 통계
      return this.getFinalStats();
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

    console.log(
      `[Migration] Progress: ${this.stats.processed}/${this.stats.totalFiles} | ` +
        `Success: ${this.stats.success} | Failed: ${this.stats.failed} | Skipped: ${this.stats.skipped} | ` +
        `DB Updated: ${this.stats.dbUpdated} | ` +
        `Rate: ${rate.toFixed(1)}/s | ETA: ${eta}min`
    );
  }

  /**
   * 최종 통계
   */
  getFinalStats() {
    const duration = Date.now() - this.stats.startTime;

    return {
      totalFiles: this.stats.totalFiles,
      processed: this.stats.processed,
      success: this.stats.success,
      failed: this.stats.failed,
      skipped: this.stats.skipped,
      dbUpdated: this.stats.dbUpdated,
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

  try {
    console.log("\n" + "=".repeat(60));
    console.log("S3 Structure Migration Tool");
    console.log("=".repeat(60));
    console.log(
      "This will reorganize values/ images into date-based subfolders"
    );
    console.log("Example: values/xxx.webp → values/2025-01/x/xxx.webp");
    console.log("=".repeat(60) + "\n");

    const stats = await migration.migrate();

    console.log("\n" + "=".repeat(60));
    console.log("[Migration] Final Statistics");
    console.log("=".repeat(60));
    console.log(`Total Files: ${stats.totalFiles}`);
    console.log(`Processed: ${stats.processed}`);
    console.log(`Successfully Migrated: ${stats.success}`);
    console.log(`Failed: ${stats.failed}`);
    console.log(`Skipped (already structured): ${stats.skipped}`);
    console.log(`DB Updated: ${stats.dbUpdated}`);
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
