// cleanup-missing-images.js
require("dotenv").config();
const { pool } = require("./utils/DB");
const fs = require("fs").promises;
const path = require("path");
const axios = require("axios");

class MissingImageCleaner {
  constructor() {
    this.localDir = path.join(__dirname, "..", "public", "images", "values");
    this.cloudFrontDomain = process.env.CLOUDFRONT_DOMAIN;

    this.stats = {
      totalChecked: 0,
      localMissing: 0,
      s3Missing: 0,
      deleted: 0,
      errors: 0,
    };
  }

  /**
   * 로컬 파일 존재 확인
   */
  async checkLocalFile(imagePath) {
    const fileName = path.basename(imagePath);
    const filePath = path.join(this.localDir, fileName);

    try {
      await fs.access(filePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * S3/CloudFront URL 존재 확인
   */
  async checkS3Url(url) {
    try {
      const response = await axios.head(url, {
        timeout: 5000,
        validateStatus: (status) => status === 200 || status === 404,
      });
      return response.status === 200;
    } catch (error) {
      // 네트워크 오류는 존재한다고 가정 (안전)
      console.warn(`Network error checking ${url}, assuming exists`);
      return true;
    }
  }

  /**
   * 이미지 경로 타입 판별
   */
  getPathType(imagePath) {
    if (!imagePath) return "empty";
    if (imagePath.startsWith("https://")) return "s3";
    if (imagePath.startsWith("/images/values/")) return "local";
    return "unknown";
  }

  /**
   * 단일 아이템의 이미지 확인
   */
  async checkItem(item) {
    const missingImages = [];

    // 메인 이미지 확인
    if (item.image) {
      const pathType = this.getPathType(item.image);
      let exists = true;

      if (pathType === "local") {
        exists = await this.checkLocalFile(item.image);
        if (!exists) {
          missingImages.push({
            type: "main",
            path: item.image,
            storage: "local",
          });
          this.stats.localMissing++;
        }
      } else if (pathType === "s3") {
        exists = await this.checkS3Url(item.image);
        if (!exists) {
          missingImages.push({ type: "main", path: item.image, storage: "s3" });
          this.stats.s3Missing++;
        }
      }
    }

    // 추가 이미지 확인
    if (item.additional_images) {
      try {
        const additionalImages = JSON.parse(item.additional_images);

        for (const imgPath of additionalImages) {
          const pathType = this.getPathType(imgPath);
          let exists = true;

          if (pathType === "local") {
            exists = await this.checkLocalFile(imgPath);
            if (!exists) {
              missingImages.push({
                type: "additional",
                path: imgPath,
                storage: "local",
              });
              this.stats.localMissing++;
            }
          } else if (pathType === "s3") {
            exists = await this.checkS3Url(imgPath);
            if (!exists) {
              missingImages.push({
                type: "additional",
                path: imgPath,
                storage: "s3",
              });
              this.stats.s3Missing++;
            }
          }
        }
      } catch (error) {
        console.error(
          `Error parsing additional_images for item ${item.item_id}:`,
          error.message
        );
      }
    }

    return missingImages;
  }

  /**
   * 모든 아이템 검사
   */
  async findMissingImages(batchSize = 100) {
    console.log("[Cleanup] Fetching items from database...\n");

    const [items] = await pool.query(`
      SELECT item_id, auc_num, image, additional_images, title
      FROM values_items
      ORDER BY item_id
    `);

    console.log(`[Cleanup] Found ${items.length} items to check\n`);

    const itemsWithMissingImages = [];

    // 배치 단위로 처리 (진행률 표시)
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      for (const item of batch) {
        this.stats.totalChecked++;

        const missingImages = await this.checkItem(item);

        if (missingImages.length > 0) {
          itemsWithMissingImages.push({
            item_id: item.item_id,
            auc_num: item.auc_num,
            title: item.title,
            missingImages,
          });
        }

        // 진행률 표시
        if (this.stats.totalChecked % 100 === 0) {
          console.log(
            `Progress: ${this.stats.totalChecked}/${items.length} checked, ` +
              `${itemsWithMissingImages.length} items with missing images found`
          );
        }
      }
    }

    return itemsWithMissingImages;
  }

  /**
   * DB에서 아이템 삭제
   */
  async deleteItems(items, dryRun = true) {
    if (items.length === 0) {
      console.log("\n[Cleanup] No items to delete");
      return;
    }

    console.log(
      `\n[Cleanup] ${dryRun ? "DRY RUN - " : ""}Deleting ${
        items.length
      } items...\n`
    );

    if (dryRun) {
      console.log("Items that would be deleted:");
      items.forEach((item, index) => {
        console.log(
          `  ${index + 1}. item_id: ${item.item_id}, ` +
            `auc_num: ${item.auc_num}, ` +
            `title: ${item.title?.substring(0, 30) || "N/A"}`
        );
      });
      console.log("\nRun with --confirm flag to actually delete");
      return;
    }

    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // 배치 삭제
      for (let i = 0; i < items.length; i += 100) {
        const batch = items.slice(i, i + 100);
        const itemIds = batch.map((item) => item.item_id);
        const aucNums = batch.map((item) => item.auc_num);

        // item_id와 auc_num 조합으로 삭제
        for (let j = 0; j < batch.length; j++) {
          await conn.query(
            "DELETE FROM values_items WHERE item_id = ? AND auc_num = ?",
            [itemIds[j], aucNums[j]]
          );
        }

        console.log(
          `Deleted batch ${Math.floor(i / 100) + 1}: ${batch.length} items`
        );
      }

      await conn.commit();
      this.stats.deleted = items.length;
      console.log(`\n✅ Successfully deleted ${items.length} items`);
    } catch (error) {
      await conn.rollback();
      console.error("Error deleting items:", error);
      throw error;
    } finally {
      conn.release();
    }
  }

  /**
   * 리포트 생성
   */
  generateReport(itemsWithMissing) {
    console.log("\n" + "=".repeat(70));
    console.log("Missing Images Report");
    console.log("=".repeat(70));
    console.log(`Total items checked: ${this.stats.totalChecked}`);
    console.log(`Items with missing images: ${itemsWithMissing.length}`);
    console.log(`  - Missing local images: ${this.stats.localMissing}`);
    console.log(`  - Missing S3 images: ${this.stats.s3Missing}`);
    console.log("=".repeat(70));

    if (itemsWithMissing.length > 0) {
      console.log("\nDetailed breakdown:");

      // 저장소 타입별 그룹화
      const byStorage = {
        local: itemsWithMissing.filter((item) =>
          item.missingImages.some((img) => img.storage === "local")
        ),
        s3: itemsWithMissing.filter((item) =>
          item.missingImages.some((img) => img.storage === "s3")
        ),
      };

      console.log(`\nLocal storage missing: ${byStorage.local.length} items`);
      console.log(`S3 storage missing: ${byStorage.s3.length} items`);

      // 상위 10개 출력
      console.log("\nFirst 10 items with missing images:");
      itemsWithMissing.slice(0, 10).forEach((item, index) => {
        console.log(
          `\n${index + 1}. Item ID: ${item.item_id} (auc_num: ${item.auc_num})`
        );
        console.log(`   Title: ${item.title?.substring(0, 50) || "N/A"}`);
        console.log(`   Missing images (${item.missingImages.length}):`);
        item.missingImages.forEach((img) => {
          console.log(`     - [${img.storage}] ${img.type}: ${img.path}`);
        });
      });

      if (itemsWithMissing.length > 10) {
        console.log(`\n... and ${itemsWithMissing.length - 10} more items`);
      }
    }

    console.log("\n" + "=".repeat(70));
  }

  /**
   * 결과를 파일로 저장
   */
  async saveResultsToFile(
    itemsWithMissing,
    filename = "missing-images-report.json"
  ) {
    const reportPath = path.join(__dirname, "..", filename);

    const report = {
      timestamp: new Date().toISOString(),
      stats: this.stats,
      items: itemsWithMissing,
    };

    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Full report saved to: ${reportPath}`);
  }
}

// CLI 실행
async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--confirm");
  const saveReport = args.includes("--save-report");

  console.log("=".repeat(70));
  console.log("Missing Images Cleanup Tool");
  console.log("=".repeat(70));

  if (dryRun) {
    console.log("⚠️  DRY RUN MODE - No items will be deleted");
    console.log("   Add --confirm flag to actually delete items\n");
  } else {
    console.log("⚠️  DELETION MODE - Items WILL be deleted!\n");
  }

  const cleaner = new MissingImageCleaner();

  try {
    // 1. 누락된 이미지 찾기
    console.log("[Step 1/3] Checking for missing images...\n");
    const itemsWithMissing = await cleaner.findMissingImages();

    // 2. 리포트 생성
    console.log("\n[Step 2/3] Generating report...");
    cleaner.generateReport(itemsWithMissing);

    // 3. 파일 저장 (옵션)
    if (saveReport && itemsWithMissing.length > 0) {
      await cleaner.saveResultsToFile(itemsWithMissing);
    }

    // 4. 삭제 실행
    console.log("\n[Step 3/3] Processing deletion...");
    await cleaner.deleteItems(itemsWithMissing, dryRun);

    if (dryRun && itemsWithMissing.length > 0) {
      console.log("\n💡 To delete these items, run:");
      console.log("   node scripts/cleanup-missing-images.js --confirm");
    }

    console.log("\n✅ Cleanup completed");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Cleanup failed:", error);
    process.exit(1);
  }
}

// 스크립트 직접 실행 시
if (require.main === module) {
  main();
}

module.exports = { MissingImageCleaner };
