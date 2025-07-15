// utils/appr.js - 완전히 수정된 버전
const QRCode = require("qrcode");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

// 워터마크 설정
const WATERMARK_CONFIG = {
  path: path.join(__dirname, "../public/images/watermark.png"),
  opacity: 0.4, // 40% 투명도
  widthPercent: 0.3, // 이미지 너비의 30%
  position: "center", // 중앙 배치
};

/**
 * 워터마크 적용 여부 확인
 */
function isWatermarked(filename) {
  if (!filename) return false;
  return (
    filename.includes("-wm-") ||
    filename.includes("-wm.") ||
    filename.startsWith("wm-")
  );
}

/**
 * 이미지에 워터마크를 적용하는 내부 함수
 */
async function applyWatermarkToImage(inputPath, outputPath) {
  try {
    // 워터마크 파일 존재 여부 확인
    if (!fs.existsSync(WATERMARK_CONFIG.path)) {
      console.warn(
        "워터마크 파일을 찾을 수 없습니다. 원본 이미지 사용:",
        WATERMARK_CONFIG.path
      );
      await sharp(inputPath).toFile(outputPath);
      return false;
    }

    // 원본 이미지 정보 가져오기
    const originalImage = sharp(inputPath);
    const { width: originalWidth, height: originalHeight } =
      await originalImage.metadata();

    if (!originalWidth || !originalHeight) {
      throw new Error("이미지 메타데이터를 읽을 수 없습니다");
    }

    // 워터마크 크기 계산
    const watermarkWidth = Math.round(
      originalWidth * WATERMARK_CONFIG.widthPercent
    );

    // 워터마크 이미지 처리
    const watermarkBuffer = await sharp(WATERMARK_CONFIG.path)
      .resize(watermarkWidth, null, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .composite([
        {
          input: Buffer.from([
            255,
            255,
            255,
            Math.round(255 * WATERMARK_CONFIG.opacity),
          ]),
          raw: { width: 1, height: 1, channels: 4 },
          tile: true,
          blend: "dest-in",
        },
      ])
      .toBuffer();

    // 워터마크 위치 계산 (중앙)
    const { width: watermarkActualWidth, height: watermarkActualHeight } =
      await sharp(watermarkBuffer).metadata();
    const left = Math.round((originalWidth - watermarkActualWidth) / 2);
    const top = Math.round((originalHeight - watermarkActualHeight) / 2);

    // 워터마크 합성
    await originalImage
      .composite([
        {
          input: watermarkBuffer,
          left: left,
          top: top,
          blend: "over",
        },
      ])
      .toFile(outputPath);

    console.log(`워터마크 적용 완료: ${outputPath}`);
    return true;
  } catch (error) {
    console.error("워터마크 적용 실패:", error);
    // 실패 시 원본 이미지 복사
    try {
      await sharp(inputPath).toFile(outputPath);
      return false;
    } catch (copyError) {
      console.error("원본 이미지 복사 실패:", copyError);
      throw copyError;
    }
  }
}

/**
 * 업로드된 파일들에 워터마크를 일괄 적용하는 함수
 */
async function processUploadedImages(files, destinationDir, options = {}) {
  if (!files || files.length === 0) return [];

  const {
    skipExisting = true, // 이미 워터마크된 이미지는 건너뛰기
    forceReprocess = false, // 강제 재처리 옵션
    preserveOriginal = false, // 원본 파일 보존 옵션
  } = options;

  const processedImages = [];

  for (const file of files) {
    try {
      // 파일 정보 검증
      if (!file || !file.filename || !file.path) {
        console.warn("잘못된 파일 정보:", file);
        continue;
      }

      // 이미지 파일 여부 확인
      if (!file.mimetype || !file.mimetype.startsWith("image/")) {
        console.log(`이미지가 아닌 파일 건너뛰기: ${file.filename}`);
        processedImages.push(`/images/appraisals/${file.filename}`);
        continue;
      }

      const originalPath = file.path;

      // 이미 워터마크가 적용된 파일인지 확인
      if (skipExisting && isWatermarked(file.filename) && !forceReprocess) {
        console.log(`이미 워터마크된 파일 건너뛰기: ${file.filename}`);
        processedImages.push(`/images/appraisals/${file.filename}`);
        continue;
      }

      // 원본 파일 존재 여부 확인
      if (!fs.existsSync(originalPath)) {
        console.warn(`원본 파일을 찾을 수 없음: ${originalPath}`);
        processedImages.push(`/images/appraisals/${file.filename}`);
        continue;
      }

      // 새 파일명 생성 (워터마크 표시)
      const fileExt = path.extname(file.filename);
      const baseName = path.basename(file.filename, fileExt);
      const watermarkedFilename = `${baseName}-wm${fileExt}`;
      const watermarkedPath = path.join(destinationDir, watermarkedFilename);

      // 워터마크 적용
      const success = await applyWatermarkToImage(
        originalPath,
        watermarkedPath
      );

      if (success) {
        processedImages.push(`/images/appraisals/${watermarkedFilename}`);

        // 원본 파일 삭제 (보존 옵션이 false인 경우만)
        if (!preserveOriginal) {
          setImmediate(() => {
            try {
              if (fs.existsSync(originalPath)) {
                fs.unlinkSync(originalPath);
                console.log(`원본 파일 삭제 완료: ${originalPath}`);
              }
            } catch (error) {
              console.error(`원본 파일 삭제 실패: ${originalPath}`, error);
            }
          });
        }
      } else {
        // 워터마크 적용 실패 시 원본 파일 사용
        console.warn(`워터마크 적용 실패, 원본 사용: ${file.filename}`);
        processedImages.push(`/images/appraisals/${file.filename}`);
      }
    } catch (error) {
      console.error(`파일 ${file?.filename} 처리 실패:`, error);

      // 처리 실패 시 원본 파일 사용
      if (file && file.filename) {
        processedImages.push(`/images/appraisals/${file.filename}`);
      }
    }
  }

  return processedImages;
}

/**
 * 기존 이미지 배열에서 워터마크 적용 (선택적)
 */
async function ensureWatermarkOnExistingImages(imageUrls, options = {}) {
  if (!imageUrls || !Array.isArray(imageUrls)) return [];

  const { forceReprocess = false } = options;
  const processedUrls = [];
  const appraisalsDir = path.join(__dirname, "../public/images/appraisals");

  for (const imageUrl of imageUrls) {
    try {
      if (!imageUrl || typeof imageUrl !== "string") {
        console.warn("잘못된 이미지 URL:", imageUrl);
        continue;
      }

      const filename = path.basename(imageUrl);

      // 이미 워터마크가 적용된 이미지인지 확인
      if (isWatermarked(filename) && !forceReprocess) {
        processedUrls.push(imageUrl);
        continue;
      }

      const originalPath = path.join(
        __dirname,
        "../public",
        imageUrl.replace(/^\//, "")
      );

      // 파일 존재 여부 확인
      if (!fs.existsSync(originalPath)) {
        console.warn(`이미지 파일을 찾을 수 없음: ${originalPath}`);
        processedUrls.push(imageUrl); // 원본 URL 유지
        continue;
      }

      // 워터마크 적용된 새 파일명 생성
      const fileExt = path.extname(filename);
      const baseName = path.basename(filename, fileExt);
      const watermarkedFilename = `${baseName}-wm${fileExt}`;
      const watermarkedPath = path.join(appraisalsDir, watermarkedFilename);

      // 워터마크 적용
      const success = await applyWatermarkToImage(
        originalPath,
        watermarkedPath
      );

      if (success) {
        processedUrls.push(`/images/appraisals/${watermarkedFilename}`);
      } else {
        processedUrls.push(imageUrl); // 실패 시 원본 URL 유지
      }
    } catch (error) {
      console.error(`기존 이미지 워터마크 적용 실패: ${imageUrl}`, error);
      processedUrls.push(imageUrl); // 실패 시 원본 URL 유지
    }
  }

  return processedUrls;
}

/**
 * 감정서 번호 생성 함수 (기존과 동일)
 */
async function generateCertificateNumber(conn, customNumber = null) {
  if (customNumber) {
    const certPattern = /^cas\d+$/i;
    if (!certPattern.test(customNumber)) {
      throw new Error(
        "감정 번호는 CAS + 숫자 형식이어야 합니다. (예: CAS04312)"
      );
    }

    const normalizedNumber = customNumber.toLowerCase();
    const [existing] = await conn.query(
      "SELECT certificate_number FROM appraisals WHERE certificate_number = ?",
      [normalizedNumber]
    );

    if (existing.length > 0) {
      throw new Error("이미 존재하는 감정 번호입니다.");
    }

    return normalizedNumber;
  }

  try {
    const [rows] = await conn.query(
      `SELECT certificate_number 
       FROM appraisals 
       WHERE certificate_number REGEXP '^cas[0-9]+$' 
       ORDER BY created_at DESC 
       LIMIT 1`
    );

    let nextNumber = 1;
    let digitCount = 6;

    if (rows.length > 0) {
      const lastCertNumber = rows[0].certificate_number;
      const match = lastCertNumber.match(/^cas(\d+)$/i);
      if (match) {
        const numberPart = match[1];
        digitCount = numberPart.length;
        const lastNumber = parseInt(numberPart);
        nextNumber = lastNumber + 1;
      }
    }

    let certificateNumber;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 1000;

    while (!isUnique && attempts < maxAttempts) {
      const paddedNumber = nextNumber.toString().padStart(digitCount, "0");
      certificateNumber = `cas${paddedNumber}`;

      const [existing] = await conn.query(
        "SELECT certificate_number FROM appraisals WHERE certificate_number = ?",
        [certificateNumber]
      );

      if (existing.length === 0) {
        isUnique = true;
      } else {
        nextNumber++;
        attempts++;
      }
    }

    if (!isUnique) {
      console.warn("순차 번호 생성 실패, 랜덤 번호로 폴백");
      const randomNum = Math.floor(100000 + Math.random() * 900000);
      certificateNumber = `cas${randomNum}`;

      const [randomCheck] = await conn.query(
        "SELECT certificate_number FROM appraisals WHERE certificate_number = ?",
        [certificateNumber]
      );

      if (randomCheck.length > 0) {
        throw new Error("인증서 번호 생성에 실패했습니다. 다시 시도해주세요.");
      }
    }

    return certificateNumber;
  } catch (error) {
    console.error("인증서 번호 생성 중 오류:", error);
    throw new Error("인증서 번호 생성 중 오류가 발생했습니다.");
  }
}

/**
 * QR 코드 생성 함수 (기존과 동일)
 */
async function generateQRCode(certificateNumber) {
  try {
    const qrDir = path.join(__dirname, "../public/images/qrcodes");
    if (!fs.existsSync(qrDir)) {
      fs.mkdirSync(qrDir, { recursive: true });
    }

    const qrFileName = `qr-${certificateNumber}.png`;
    const qrPath = path.join(qrDir, qrFileName);

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const certificateUrl = `${frontendUrl}/appr/result/${certificateNumber}`;

    await QRCode.toFile(qrPath, certificateUrl, {
      errorCorrectionLevel: "H",
      margin: 1,
      width: 300,
    });

    return `/images/qrcodes/${qrFileName}`;
  } catch (error) {
    console.error("QR 코드 생성 중 오류:", error);
    return null;
  }
}

/**
 * 경매 결과로부터 감정서 생성 함수 (수정됨)
 */
async function createAppraisalFromAuction(conn, bid, item, userId) {
  try {
    const certificateNumber = await generateCertificateNumber(conn);
    const qrcodeUrl = await generateQRCode(certificateNumber);

    // 이미지 처리
    let processedImages = [];

    // additional_images에서 이미지 가져오기
    let rawImages = [];
    if (item.additional_images) {
      try {
        const additionalImages = JSON.parse(item.additional_images);
        if (Array.isArray(additionalImages)) {
          rawImages = additionalImages;
        }
      } catch (error) {
        console.error("additional_images JSON 파싱 오류:", error);
      }
    }

    if (rawImages.length === 0 && item.image) {
      rawImages = [item.image];
    }

    // 경매 이미지들에 워터마크 적용 (필요한 경우만)
    if (rawImages.length > 0) {
      processedImages = await ensureWatermarkOnExistingImages(rawImages, {
        forceReprocess: false, // 이미 워터마크가 있으면 건너뛰기
      });
    }

    const [appraisalResult] = await conn.query(
      `INSERT INTO appraisals (
        user_id, appraisal_type, status, brand, model_name, category, 
        result, images, certificate_number, qrcode_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        "from_auction",
        "pending",
        item.brand || "기타",
        item.title || "제목 없음",
        item.category || "기타",
        "pending",
        processedImages.length > 0 ? JSON.stringify(processedImages) : null,
        certificateNumber,
        qrcodeUrl,
      ]
    );

    return {
      appraisal_id: appraisalResult.insertId,
      certificate_number: certificateNumber,
      qrcode_url: qrcodeUrl,
    };
  } catch (error) {
    console.error("감정서 생성 중 오류:", error);
    throw error;
  }
}

/**
 * 기존 감정서 이미지 워터마크 마이그레이션 (일회성)
 */
async function migrateExistingAppraisalImages(conn, batchSize = 10) {
  try {
    console.log("기존 감정서 이미지 워터마크 마이그레이션 시작...");

    const [appraisals] = await conn.query(
      `
      SELECT id, images 
      FROM appraisals 
      WHERE images IS NOT NULL 
      AND images != 'null' 
      AND images != '[]'
      LIMIT ?
    `,
      [batchSize]
    );

    let processedCount = 0;

    for (const appraisal of appraisals) {
      try {
        const images = JSON.parse(appraisal.images);

        if (Array.isArray(images) && images.length > 0) {
          // 워터마크 확인 및 적용
          const watermarkedImages = await ensureWatermarkOnExistingImages(
            images,
            {
              forceReprocess: false,
            }
          );

          // 변경사항이 있으면 DB 업데이트
          const hasChanges =
            JSON.stringify(watermarkedImages) !== JSON.stringify(images);

          if (hasChanges) {
            await conn.query("UPDATE appraisals SET images = ? WHERE id = ?", [
              JSON.stringify(watermarkedImages),
              appraisal.id,
            ]);

            console.log(`감정서 ${appraisal.id} 이미지 워터마크 적용 완료`);
            processedCount++;
          }
        }
      } catch (error) {
        console.error(`감정서 ${appraisal.id} 처리 실패:`, error);
      }
    }

    console.log(`마이그레이션 완료: ${processedCount}개 감정서 처리됨`);
    return processedCount;
  } catch (error) {
    console.error("마이그레이션 중 오류:", error);
    throw error;
  }
}

/**
 * additional_images 파싱 유틸리티 함수 (기존과 동일)
 */
function parseAdditionalImages(additionalImagesJson) {
  if (!additionalImagesJson) return [];

  try {
    const images = JSON.parse(additionalImagesJson);
    return Array.isArray(images) ? images : [];
  } catch (error) {
    console.error("additional_images JSON 파싱 오류:", error);
    return [];
  }
}

module.exports = {
  generateCertificateNumber,
  generateQRCode,
  createAppraisalFromAuction,
  parseAdditionalImages,
  processUploadedImages, // 새 업로드 파일 처리
  ensureWatermarkOnExistingImages, // 기존 이미지 워터마크 적용
  migrateExistingAppraisalImages, // 마이그레이션 함수
  isWatermarked, // 워터마크 여부 확인
  applyWatermarkToImage, // 직접 워터마크 적용
};
