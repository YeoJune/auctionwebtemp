// routes/certificate.js
const express = require("express");
const router = express.Router();
const pool = require("../utils/DB");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");

// 미들웨어: 인증 확인
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.status(401).json({
      success: false,
      message: "로그인이 필요합니다.",
    });
  }
};

// 감정서 조회 (공개)
router.get("/:certificateNumber", async (req, res) => {
  const { certificateNumber } = req.params;
  let conn;

  try {
    conn = await pool.getConnection();

    // 감정서 정보 조회
    const [certificates] = await conn.query(
      `
      SELECT c.*, a.brand, a.model, a.category, a.result, a.images 
      FROM certificates c
      JOIN appraisals a ON c.appraisal_id = a.id
      WHERE c.certificate_number = ?
    `,
      [certificateNumber]
    );

    if (certificates.length === 0) {
      return res.status(404).json({
        success: false,
        message: "해당 감정서를 찾을 수 없습니다.",
      });
    }

    const certificate = certificates[0];
    let photos = [];

    // 이미지 정보 처리
    if (certificate.images) {
      try {
        photos = JSON.parse(certificate.images);
      } catch (error) {
        console.error("이미지 파싱 오류:", error);
      }
    }

    // 응답 데이터 구성
    const response = {
      success: true,
      certificate: {
        certificate_number: certificate.certificate_number,
        appraisal_id: certificate.appraisal_id,
        type: certificate.type,
        status: certificate.status,
        issued_date: certificate.issued_date,
        appraisal: {
          brand: certificate.brand,
          model: certificate.model,
          category: certificate.category,
          result: certificate.result,
          photos: photos,
        },
      },
    };

    res.json(response);
  } catch (error) {
    console.error("감정서 조회 중 오류 발생:", error);
    res.status(500).json({
      success: false,
      message: "감정서 조회 중 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 감정서 발급 신청
router.post("/issue", isAuthenticated, async (req, res) => {
  const { appraisal_id, type, delivery_info, payment_info } = req.body;
  const user_id = req.session.user.id;
  let conn;

  try {
    // 필수 필드 검증
    if (!appraisal_id || !type) {
      return res.status(400).json({
        success: false,
        message: "필수 정보가 누락되었습니다.",
      });
    }

    // 실물 감정서인 경우 배송 정보 필수
    if (type === "physical" && !delivery_info) {
      return res.status(400).json({
        success: false,
        message: "실물 감정서 발급 시 배송 정보는 필수입니다.",
      });
    }

    conn = await pool.getConnection();

    // 감정 결과 확인
    const [appraisals] = await conn.query(
      "SELECT * FROM appraisals WHERE id = ?",
      [appraisal_id]
    );

    if (appraisals.length === 0) {
      return res.status(404).json({
        success: false,
        message: "해당 감정 정보를 찾을 수 없습니다.",
      });
    }

    // 감정서 번호 생성
    const [brandPrefix] = appraisals[0].brand.match(/[A-Z]/g) || ["C"];
    const currentYear = new Date().getFullYear().toString().slice(-2);

    // 일련번호 생성을 위한 카운트 조회
    const [countResult] = await conn.query(
      "SELECT COUNT(*) as count FROM certificates WHERE certificate_number LIKE ?",
      [`CAS-${brandPrefix}${currentYear}-%`]
    );

    const serialNumber = (countResult[0].count + 1).toString().padStart(4, "0");
    const certificateNumber = `CAS-${brandPrefix}${currentYear}-${serialNumber}`;

    // 인증 코드 생성
    const verificationCode = uuidv4();

    // 감정서 데이터 저장
    const certificateId = uuidv4();
    await conn.query(
      `
      INSERT INTO certificates (
        id, certificate_number, appraisal_id, user_id, 
        type, status, verification_code, 
        delivery_info, payment_info, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `,
      [
        certificateId,
        certificateNumber,
        appraisal_id,
        user_id,
        type,
        "pending",
        verificationCode,
        delivery_info ? JSON.stringify(delivery_info) : null,
        payment_info ? JSON.stringify(payment_info) : null,
      ]
    );

    res.status(201).json({
      success: true,
      message: "감정서 발급 신청이 완료되었습니다.",
      certificate: {
        id: certificateId,
        certificate_number: certificateNumber,
        status: "pending",
        type: type,
      },
    });
  } catch (error) {
    console.error("감정서 발급 신청 중 오류 발생:", error);
    res.status(500).json({
      success: false,
      message: "감정서 발급 신청 중 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 사용자의 감정서 목록 조회
router.get("/user", isAuthenticated, async (req, res) => {
  const user_id = req.session.user.id;
  let conn;

  try {
    conn = await pool.getConnection();

    // 사용자의 감정서 목록 조회
    const [certificates] = await conn.query(
      `
      SELECT c.id, c.certificate_number, c.type, c.status, c.created_at,
             a.brand, a.model, a.category, a.result
      FROM certificates c
      JOIN appraisals a ON c.appraisal_id = a.id
      WHERE c.user_id = ?
      ORDER BY c.created_at DESC
    `,
      [user_id]
    );

    const formattedCertificates = certificates.map((cert) => ({
      id: cert.id,
      certificate_number: cert.certificate_number,
      type: cert.type,
      status: cert.status,
      appraisal: {
        brand: cert.brand,
        model: cert.model,
        category: cert.category,
        result: cert.result,
      },
      created_at: cert.created_at,
    }));

    res.json({
      success: true,
      certificates: formattedCertificates,
    });
  } catch (error) {
    console.error("감정서 목록 조회 중 오류 발생:", error);
    res.status(500).json({
      success: false,
      message: "감정서 목록 조회 중 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// PDF 감정서 다운로드
router.get(
  "/:certificateNumber/download",
  isAuthenticated,
  async (req, res) => {
    const { certificateNumber } = req.params;
    const user_id = req.session.user.id;
    let conn;

    try {
      conn = await pool.getConnection();

      // 감정서 정보 조회
      const [certificates] = await conn.query(
        `
      SELECT c.*, a.brand, a.model, a.category, a.result, a.images
      FROM certificates c
      JOIN appraisals a ON c.appraisal_id = a.id
      WHERE c.certificate_number = ?
    `,
        [certificateNumber]
      );

      if (certificates.length === 0) {
        return res.status(404).json({
          success: false,
          message: "해당 감정서를 찾을 수 없습니다.",
        });
      }

      const certificate = certificates[0];

      // 권한 확인 (관리자 또는 본인)
      if (user_id !== "admin" && user_id !== certificate.user_id) {
        return res.status(403).json({
          success: false,
          message: "권한이 없습니다.",
        });
      }

      // 감정서 파일명 설정
      const fileName = `CAS_${certificateNumber.replace(
        /-/g,
        "_"
      )}_Certificate.pdf`;

      // 감정서 생성
      const doc = new PDFDocument({ size: "A4", margin: 50 });

      // 응답 헤더 설정
      res.setHeader("Content-disposition", `attachment; filename=${fileName}`);
      res.setHeader("Content-type", "application/pdf");

      doc.pipe(res);

      // PDF 감정서 디자인 및 내용 추가
      doc.fontSize(18).text("CAS 명품감정시스템 감정서", { align: "center" });
      doc.moveDown();

      // QR 코드 추가
      const verificationUrl = `${req.protocol}://${req.get(
        "host"
      )}/api/certificate/${certificateNumber}`;
      const qrCodeDataUrl = await QRCode.toDataURL(verificationUrl);
      const qrImagePath = path.join(
        __dirname,
        "..",
        "temp",
        `${certificateNumber}_qr.png`
      );

      // 임시 QR 코드 파일 생성
      fs.writeFileSync(
        qrImagePath,
        qrCodeDataUrl.replace(/^data:image\/png;base64,/, ""),
        "base64"
      );

      // QR 코드 이미지 추가
      doc.image(qrImagePath, {
        fit: [100, 100],
        align: "right",
      });

      // 감정서 정보 추가
      doc.moveDown();
      doc.fontSize(12).text(`감정번호: ${certificateNumber}`);
      doc.moveDown();
      doc.text(
        `감정일자: ${new Date(certificate.created_at).toLocaleDateString(
          "ko-KR"
        )}`
      );
      doc.moveDown();
      doc.text(`브랜드: ${certificate.brand}`);
      doc.moveDown();
      doc.text(`모델명: ${certificate.model}`);
      doc.moveDown();
      doc.text(`카테고리: ${certificate.category}`);
      doc.moveDown();

      // 감정 결과
      doc.moveDown();
      doc.fontSize(14).text("감정 결과", { underline: true });
      doc.moveDown();

      const resultText =
        certificate.result === "정품"
          ? "본 제품은 정품으로 확인되었습니다."
          : "본 제품은 정품이 아닌 것으로 확인되었습니다.";

      doc.fontSize(12).text(resultText);
      doc.moveDown(2);

      // 이미지 처리
      if (certificate.images) {
        try {
          const images = JSON.parse(certificate.images);
          if (images.length > 0) {
            doc.fontSize(14).text("감정 사진", { underline: true });
            doc.moveDown();

            // 이미지 경로 가져오기
            const imagePath = path.join(__dirname, "..", "public", images[0]);
            if (fs.existsSync(imagePath)) {
              doc.image(imagePath, {
                fit: [300, 300],
                align: "center",
              });
            }
          }
        } catch (error) {
          console.error("이미지 처리 중 오류:", error);
        }
      }

      // 서명 및 날짜
      doc.moveDown(2);
      doc.fontSize(12).text("CAS 명품감정시스템", { align: "right" });
      doc.moveDown();
      doc.text(`발급일: ${new Date().toLocaleDateString("ko-KR")}`, {
        align: "right",
      });

      // PDF 문서 종료
      doc.end();

      // 임시 파일 삭제
      fs.unlinkSync(qrImagePath);

      // 감정서 상태 업데이트 (issued로 변경)
      if (certificate.status === "pending") {
        await conn.query(
          `
        UPDATE certificates 
        SET status = 'issued', issued_date = NOW(), updated_at = NOW()
        WHERE id = ?
      `,
          [certificate.id]
        );
      }
    } catch (error) {
      console.error("감정서 다운로드 중 오류 발생:", error);
      res.status(500).json({
        success: false,
        message: "감정서 다운로드 중 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  }
);

// 감정서 QR코드 이미지 제공
router.get("/:certificateNumber/qrcode", async (req, res) => {
  const { certificateNumber } = req.params;

  try {
    // 인증 URL 생성
    const verificationUrl = `${req.protocol}://${req.get(
      "host"
    )}/api/certificate/${certificateNumber}`;

    // QR 코드 생성 옵션
    const qrOptions = {
      errorCorrectionLevel: "H",
      margin: 1,
      width: 300,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    };

    // QR 코드 이미지 생성
    QRCode.toBuffer(verificationUrl, qrOptions, (err, buffer) => {
      if (err) {
        console.error("QR 코드 생성 중 오류:", err);
        return res.status(500).json({
          success: false,
          message: "QR 코드 생성 중 오류가 발생했습니다.",
        });
      }

      // 응답 헤더 설정
      res.setHeader("Content-Type", "image/png");
      res.setHeader(
        "Content-disposition",
        `attachment; filename=certificate_${certificateNumber}_qr.png`
      );

      // QR 코드 이미지 반환
      res.send(buffer);
    });
  } catch (error) {
    console.error("QR 코드 생성 중 오류 발생:", error);
    res.status(500).json({
      success: false,
      message: "QR 코드 생성 중 오류가 발생했습니다.",
    });
  }
});

module.exports = router;
