// utils/appr.js
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");

/**
 * 감정서 번호 생성 함수
 */
async function generateCertificateNumber(conn, customNumber = null) {
  if (customNumber) {
    // 커스텀 번호 형식 검증: cas + 숫자 (자릿수 제한 없음)
    const certPattern = /^cas\d+$/i;
    if (!certPattern.test(customNumber)) {
      throw new Error(
        "감정 번호는 CAS + 숫자 형식이어야 합니다. (예: CAS04312)"
      );
    }

    // 대소문자 통일 (소문자로 저장)
    const normalizedNumber = customNumber.toLowerCase();

    // 중복 확인
    const [existing] = await conn.query(
      "SELECT certificate_number FROM appraisals WHERE certificate_number = ?",
      [normalizedNumber]
    );

    if (existing.length > 0) {
      throw new Error("이미 존재하는 감정 번호입니다.");
    }

    return normalizedNumber;
  }

  // 자동 생성: 가장 최근에 생성된 번호 + 1
  try {
    // 가장 최근에 생성된 인증서 번호 조회 (created_at 기준)
    const [rows] = await conn.query(
      `SELECT certificate_number 
       FROM appraisals 
       WHERE certificate_number REGEXP '^cas[0-9]+$' 
       ORDER BY created_at DESC 
       LIMIT 1`
    );

    let nextNumber = 1; // 기본값: cas1부터 시작
    let digitCount = 6; // 기본 6자리

    if (rows.length > 0) {
      const lastCertNumber = rows[0].certificate_number;
      // "cas" 제거하고 숫자 부분만 추출
      const match = lastCertNumber.match(/^cas(\d+)$/i);
      if (match) {
        const numberPart = match[1];
        digitCount = numberPart.length; // 기존 자릿수 유지
        const lastNumber = parseInt(numberPart);
        nextNumber = lastNumber + 1;
      }
    }

    // 중복 확인하면서 사용 가능한 번호 찾기
    let certificateNumber;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 1000; // 무한루프 방지

    while (!isUnique && attempts < maxAttempts) {
      // 자릿수 맞춰서 0 패딩
      const paddedNumber = nextNumber.toString().padStart(digitCount, "0");
      certificateNumber = `cas${paddedNumber}`;

      // 중복 확인
      const [existing] = await conn.query(
        "SELECT certificate_number FROM appraisals WHERE certificate_number = ?",
        [certificateNumber]
      );

      if (existing.length === 0) {
        isUnique = true;
      } else {
        nextNumber++; // 중복이면 다음 번호 시도
        attempts++;
      }
    }

    if (!isUnique) {
      // 만약 1000번 시도해도 안 되면 랜덤으로 폴백
      console.warn("순차 번호 생성 실패, 랜덤 번호로 폴백");
      const randomNum = Math.floor(100000 + Math.random() * 900000);
      certificateNumber = `cas${randomNum}`;

      // 랜덤 번호도 중복 확인
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
 * QR 코드 생성 함수
 */
async function generateQRCode(certificateNumber) {
  try {
    // QR 코드 디렉토리 생성
    const qrDir = path.join(__dirname, "../public/images/qrcodes");
    if (!fs.existsSync(qrDir)) {
      fs.mkdirSync(qrDir, { recursive: true });
    }

    const qrFileName = `qr-${certificateNumber}.png`;
    const qrPath = path.join(qrDir, qrFileName);

    // 프론트엔드 URL 설정
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const certificateUrl = `${frontendUrl}/appr/result/${certificateNumber}`;

    // QR 코드 생성
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
 * 경매 결과로부터 감정서 생성 함수
 */
async function createAppraisalFromAuction(conn, bid, item, userId) {
  try {
    // 1. 감정서 번호 생성
    const certificateNumber = await generateCertificateNumber(conn);

    // 2. QR 코드 생성
    const qrcodeUrl = await generateQRCode(certificateNumber);

    // 3. 이미지 처리 - additional_images에서 가져오기
    let images = [];
    if (item.additional_images) {
      try {
        const additionalImages = JSON.parse(item.additional_images);
        if (Array.isArray(additionalImages)) {
          images = additionalImages;
        }
      } catch (error) {
        console.error("additional_images JSON 파싱 오류:", error);
      }
    }

    // additional_images가 없거나 빈 배열이면 기본 image 사용
    if (images.length === 0 && item.image) {
      images = [item.image];
    }

    // 4. appraisals 테이블에 감정서 생성
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
        JSON.stringify(images),
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
 * additional_images 파싱 유틸리티 함수
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
};
