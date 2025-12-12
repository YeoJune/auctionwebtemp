// generate-mappings.js - S3에서 매핑 파일 재생성
require("dotenv").config();
const { S3Client, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const { pool } = require("./utils/DB");
const fs = require("fs").promises;

class MappingGenerator {
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
    this.prefix = "values/";
    this.outputFile = "./s3-migration-mappings.json";
    this.dateCache = new Map();
  }

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
    if (!yearMonth) yearMonth = "legacy";
    const firstChar = fileName.charAt(0).toLowerCase();
    return `${yearMonth}/${firstChar}`;
  }

  async preloadDateCache() {
    console.log("[Generate] Loading dates from DB...");
    const [rows] = await pool.query(
      `SELECT image, additional_images, scheduled_date 
       FROM values_items 
       WHERE scheduled_date IS NOT NULL`
    );

    for (const row of rows) {
      if (row.image) {
        const fileName = row.image.split("/").pop();
        if (!this.dateCache.has(fileName)) {
          this.dateCache.set(fileName, row.scheduled_date);
        }
      }
      if (row.additional_images) {
        try {
          const additionalImages = JSON.parse(row.additional_images);
          for (const imgUrl of additionalImages) {
            const fileName = imgUrl.split("/").pop();
            if (!this.dateCache.has(fileName)) {
              this.dateCache.set(fileName, row.scheduled_date);
            }
          }
        } catch (e) {}
      }
    }
    console.log(`[Generate] Cached ${this.dateCache.size} dates`);
  }

  async listStructuredFiles() {
    console.log("[Generate] Listing structured S3 files...");
    const files = [];
    let continuationToken = null;

    do {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: this.prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      });

      const response = await this.s3Client.send(command);

      if (response.Contents) {
        // 하위 폴더 구조만 (values/2025-01/x/xxx.webp 형태)
        const structuredFiles = response.Contents.filter((item) => {
          const relativePath = item.Key.replace(this.prefix, "");
          // 슬래시 2개 이상 = 날짜/샤드/파일명 구조
          return (relativePath.match(/\//g) || []).length >= 2;
        });

        files.push(...structuredFiles.map((item) => item.Key));
      }

      continuationToken = response.NextContinuationToken;

      if (files.length % 10000 === 0 && files.length > 0) {
        console.log(`[Generate] Found ${files.length} structured files...`);
      }
    } while (continuationToken);

    console.log(`[Generate] Total structured files: ${files.length}`);
    return files;
  }

  async generate() {
    console.log(`[Generate] Starting at ${new Date().toISOString()}`);

    try {
      // 기존 파일 삭제
      try {
        await fs.unlink(this.outputFile);
      } catch (e) {}

      // DB 캐시 로드
      await this.preloadDateCache();

      // 구조화된 파일 리스트
      const files = await this.listStructuredFiles();

      if (files.length === 0) {
        console.log("[Generate] No structured files found!");
        return;
      }

      console.log("[Generate] Creating mappings...");
      let count = 0;
      let batch = [];

      for (const newKey of files) {
        const fileName = newKey.split("/").pop();
        const scheduledDate = this.dateCache.get(fileName);
        const subFolder = this.getImageSubFolder(scheduledDate, fileName);

        // 원본 경로 역추적
        const oldKey = `${this.prefix}${fileName}`;

        const mapping = {
          oldUrl: `https://${this.cloudFrontDomain}/${oldKey}`,
          newUrl: `https://${this.cloudFrontDomain}/${newKey}`,
        };

        batch.push(JSON.stringify(mapping));
        count++;

        if (batch.length >= 10000) {
          await fs.appendFile(this.outputFile, batch.join("\n") + "\n");
          batch = [];
        }

        if (count % 10000 === 0) {
          console.log(`[Generate] Processed ${count}/${files.length} files`);
        }
      }

      // 남은 배치
      if (batch.length > 0) {
        await fs.appendFile(this.outputFile, batch.join("\n") + "\n");
      }

      console.log(
        `\n[Generate] Complete: ${count} mappings saved to ${this.outputFile}`
      );
      console.log(`Now run: node migrate-s3-structure.js --db-only`);
    } catch (error) {
      console.error("[Generate] Error:", error);
      throw error;
    } finally {
      await pool.end();
    }
  }
}

async function main() {
  const generator = new MappingGenerator();
  await generator.generate();
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { MappingGenerator };
