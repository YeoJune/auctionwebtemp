// scripts/process-single-item-s3.js
const { pool } = require("../utils/DB");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const axios = require("axios");
const sharp = require("sharp");
const path = require("path");
require("dotenv").config();

class SingleItemS3Processor {
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
    this.s3FolderPrefix = "products/"; // crawled_items는 products 폴더

    // BrandAuc crop 설정
    this.cropSettings = {
      brand: { cropTop: 12, cropBottom: 12, cropLeft: 0, cropRight: 0 },
    };

    this.maxWidth = 800;
    this.maxHeight = 800;
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
   * S3 키 생성
   */
  getS3Key(scheduledDate, fileName) {
    const subFolder = this.getImageSubFolder(scheduledDate, fileName);
    return `${this.s3FolderPrefix}${subFolder}/${fileName}`;
  }

  /**
   * 이미지 다운로드 및 처리 (crop 적용)
   */
  async downloadAndProcessImage(url, cropType = null) {
    try {
      const response = await axios({
        method: "GET",
        url: url,
        responseType: "arraybuffer",
        timeout: 30000,
      });

      const metadata = await sharp(response.data).metadata();
      let processedImage = sharp(response.data);

      // Crop 처리
      if (cropType && this.cropSettings[cropType]) {
        const cropConfig = this.cropSettings[cropType];
        const left = cropConfig.cropLeft || 0;
        const top = cropConfig.cropTop || 0;
        const width = metadata.width - left - (cropConfig.cropRight || 0);
        const height = metadata.height - top - (cropConfig.cropBottom || 0);

        processedImage = processedImage.extract({
          left: left,
          top: top,
          width: width,
          height: height,
        });

        // 크롭 후 리사이즈
        if (width > this.maxWidth || height > this.maxHeight) {
          processedImage = processedImage.resize({
            width: Math.min(width, this.maxWidth),
            height: Math.min(height, this.maxHeight),
            fit: "inside",
            withoutEnlargement: true,
          });
        }
      } else {
        // 기본 리사이즈
        if (
          metadata.width > this.maxWidth ||
          metadata.height > this.maxHeight
        ) {
          processedImage = processedImage.resize({
            width: Math.min(metadata.width, this.maxWidth),
            height: Math.min(metadata.height, this.maxHeight),
            fit: "inside",
            withoutEnlargement: true,
          });
        }
      }

      // WebP 변환
      const buffer = await processedImage.webp({ quality: 100 }).toBuffer();
      return buffer;
    } catch (error) {
      console.error(`Failed to download/process image: ${url}`, error.message);
      throw error;
    }
  }

  /**
   * S3에 이미지 업로드
   */
  async uploadToS3(buffer, scheduledDate, cropType = null) {
    const dateString = new Date()
      .toISOString()
      .replaceAll(":", "-")
      .split(".")[0];

    const { v4: uuidv4 } = require("uuid");
    const fileName = `${dateString}_${uuidv4()}${
      cropType ? `_${cropType}` : ""
    }.webp`;

    const s3Key = this.getS3Key(scheduledDate, fileName);

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
      Body: buffer,
      ContentType: "image/webp",
      CacheControl: "max-age=31536000, immutable",
    });

    await this.s3Client.send(command);

    return `https://${this.cloudFrontDomain}/${s3Key}`;
  }

  /**
   * URL에서 이미지 다운로드 -> 처리 -> S3 업로드
   */
  async processAndUploadImage(url, scheduledDate, cropType = null) {
    console.log(`  📥 Downloading: ${url.substring(0, 80)}...`);
    const buffer = await this.downloadAndProcessImage(url, cropType);

    console.log(`  ☁️  Uploading to S3...`);
    const s3Url = await this.uploadToS3(buffer, scheduledDate, cropType);

    console.log(`  ✅ Uploaded: ${s3Url}`);
    return s3Url;
  }
}

async function processSingleItem() {
  const itemId = "853-32801";
  const aucNum = 2; // BrandAuc

  const processor = new SingleItemS3Processor();

  try {
    console.log(`\n🔍 Processing item: ${itemId} (auc_num: ${aucNum})`);

    // 1. DB에서 아이템 조회
    const [items] = await pool.query(
      `SELECT * FROM crawled_items WHERE item_id = ? AND auc_num = ?`,
      [itemId, aucNum],
    );

    if (items.length === 0) {
      console.error("❌ Item not found in DB");
      return;
    }

    const item = items[0];
    const scheduledDate = item.scheduled_date || null;

    console.log("Current item state:", {
      item_id: item.item_id,
      scheduled_date: scheduledDate,
      hasDescription: !!item.description,
      hasImage: !!item.image,
    });

    // 2. Description 생성
    const description = `Shoulder Faded & Dirty (M)
Shoulder Edge Cracked & Cut (M)
Outside Faded & Dirty (M)
Outside Creased by storage (M)
Metallic parts Plating peeling (M)
Metallic parts Scratched (M)
Inside Faded & Dirty (M)
Inside Covered Wrinkles (M)

With sticker number Issue Unclear`;

    // 3. 이미지 URL 목록
    const imageUrls = [
      "https://image.brand-auc.com/brand_img/0/SP/853/328/S853_853-32801_01L.jpg?20260123171239",
      "https://image.brand-auc.com/brand_img/0/SP/853/328/S853_853-32801_02L.jpg?20260123171239",
      "https://image.brand-auc.com/brand_img/0/SP/853/328/S853_853-32801_03L.jpg?20260123171239",
      "https://image.brand-auc.com/brand_img/0/SP/853/328/S853_853-32801_04L.jpg?20260123171239",
      "https://image.brand-auc.com/brand_img/0/SP/853/328/S853_853-32801_05L.jpg?20260123171239",
      "https://image.brand-auc.com/brand_img/0/SP/853/328/S853_853-32801_06L.jpg?20260123171239",
      "https://image.brand-auc.com/brand_img/0/SP/853/328/S853_853-32801_07L.jpg?20260123171239",
      "https://image.brand-auc.com/brand_img/0/SP/853/328/S853_853-32801_08L.jpg?20260123171239",
      "https://image.brand-auc.com/brand_img/0/SP/853/328/S853_853-32801_09L.jpg?20260123171239",
      "https://image.brand-auc.com/brand_img/0/SP/853/328/S853_853-32801_10L.jpg?20260123171239",
      "https://image.brand-auc.com/brand_img/0/SP/853/328/S853_853-32801_11L.jpg?20260123171239",
      "https://image.brand-auc.com/brand_img/0/SP/853/328/S853_853-32801_12L.jpg?20260123171239",
      "https://image.brand-auc.com/brand_img/0/SP/853/328/S853_853-32801_13L.jpg?20260123171239",
      "https://image.brand-auc.com/brand_img/0/SP/853/328/S853_853-32801_14L.jpg?20260123171239",
      "https://image.brand-auc.com/brand_img/0/SP/853/328/S853_853-32801_15L.jpg?20260123171239",
      "https://image.brand-auc.com/brand_img/0/SP/853/328/S853_853-32801_16L.jpg?20260123171239",
      "https://image.brand-auc.com/brand_img/0/SP/853/328/S853_853-32801_17L.jpg?20260123171239",
      "https://image.brand-auc.com/brand_img/0/SP/853/328/S853_853-32801_18L.jpg?20260123171239",
      "https://image.brand-auc.com/brand_img/0/SP/853/328/S853_853-32801_29L.jpg?20260123171239",
      "https://image.brand-auc.com/brand_img/0/SP/853/328/S853_853-32801_30L.jpg?20260123171239",
    ];

    console.log(`\n📸 Processing ${imageUrls.length} images...`);

    // 4. 메인 이미지 처리 (첫 번째 이미지)
    console.log("\n[1/2] Processing main image...");
    const mainImageUrl = await processor.processAndUploadImage(
      imageUrls[0],
      scheduledDate,
      "brand", // BrandAuc crop
    );

    // 5. 추가 이미지 처리 (나머지 이미지들)
    console.log(
      `\n[2/2] Processing ${imageUrls.length - 1} additional images...`,
    );
    const additionalImageUrls = [];

    for (let i = 1; i < imageUrls.length; i++) {
      console.log(`\nImage ${i}/${imageUrls.length - 1}:`);
      const s3Url = await processor.processAndUploadImage(
        imageUrls[i],
        scheduledDate,
        "brand",
      );
      additionalImageUrls.push(s3Url);

      // 너무 빠르게 요청하지 않도록 짧은 대기
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log(`\n✅ All images uploaded successfully!`);

    // 6. DB 업데이트
    console.log("\n💾 Updating database...");

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        `UPDATE crawled_items 
         SET description = ?, image = ?, additional_images = ?
         WHERE item_id = ? AND auc_num = ?`,
        [
          description,
          mainImageUrl,
          JSON.stringify(additionalImageUrls),
          itemId,
          aucNum,
        ],
      );

      await conn.commit();
      console.log("✅ Database updated successfully!");
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    // 7. 결과 확인
    const [updatedItems] = await pool.query(
      `SELECT * FROM crawled_items WHERE item_id = ? AND auc_num = ?`,
      [itemId, aucNum],
    );

    const updatedItem = updatedItems[0];

    console.log("\n🎉 Processing completed!");
    console.log("Final state:", {
      item_id: updatedItem.item_id,
      auc_num: updatedItem.auc_num,
      description: updatedItem.description?.substring(0, 50) + "...",
      mainImage: updatedItem.image,
      additionalImagesCount: JSON.parse(updatedItem.additional_images).length,
    });

    console.log("\n📋 Sample URLs:");
    console.log("Main:", updatedItem.image);
    console.log("Additional[0]:", JSON.parse(updatedItem.additional_images)[0]);

    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

processSingleItem();
