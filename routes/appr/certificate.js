// routes/appr/certificate.js
const express = require("express");
const router = express.Router();
const pool = require("../../utils/DB");
const { v4: uuidv4 } = require("uuid");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const { isAuthenticated, isAdmin } = require("../../utils/middleware");

async function generateCertificateNumber(conn, brand) {
  const brandInitial = brand ? brand.substring(0, 2).toUpperCase() : "XX";
  const year = new Date().getFullYear().toString().slice(-2);
  const prefix = `CAS-${brandInitial}${year}-`;
  const [countResult] = await conn.query(
    "SELECT COUNT(*) as count FROM certificates WHERE certificate_number LIKE ?",
    [`${prefix}%`]
  );
  const nextSerial = (countResult[0].count + 1).toString().padStart(4, "0");
  return `${prefix}${nextSerial}`;
}

// POST /api/appr/certificates/issue (감정서 발급 신청)
router.post("/issue", isAuthenticated, async (req, res) => {
  const { appraisal_id, type, delivery_info, payment_info } = req.body;
  const user_id = req.session.user.id;

  if (!appraisal_id || !type)
    return res
      .status(400)
      .json({ success: false, message: "필수 정보(감정 ID, 발급 유형) 누락" });
  if (type === "physical" && !delivery_info)
    return res
      .status(400)
      .json({ success: false, message: "실물 감정서 발급 시 배송 정보 필수" });

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [appraisalRows] = await conn.query(
      "SELECT id, result, brand FROM appraisals WHERE id = ? AND status = 'completed'",
      [appraisal_id]
    );
    if (appraisalRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({
        success: false,
        message: "유효한 감정 건을 찾을 수 없거나 감정 미완료",
      });
    }
    const appraisal = appraisalRows[0];
    if (appraisal.result === "pending" || appraisal.result === "uncertain") {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: `감정 결과 '${appraisal.result}'로 감정서 발급 불가`,
      });
    }
    const [existingCert] = await conn.query(
      "SELECT id FROM certificates WHERE appraisal_id = ?",
      [appraisal_id]
    );
    if (existingCert.length > 0) {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        message: "이미 해당 감정 건에 대한 감정서 존재",
      });
    }

    const certificateId = uuidv4();
    const certificate_number = await generateCertificateNumber(
      conn,
      appraisal.brand
    );
    const verification_code = uuidv4().replace(/-/g, "");
    const initialStatus = payment_info ? "pending_issuance" : "pending_payment";

    const sql = `INSERT INTO certificates (id, appraisal_id, certificate_number, user_id, type, status, verification_code, delivery_info, payment_info, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`;
    await conn.query(sql, [
      certificateId,
      appraisal_id,
      certificate_number,
      user_id,
      type,
      initialStatus,
      verification_code,
      delivery_info ? JSON.stringify(delivery_info) : null,
      payment_info ? JSON.stringify(payment_info) : null,
    ]);
    await conn.commit();
    res.status(201).json({
      success: true,
      message: "감정서 발급 신청 완료",
      certificate: {
        id: certificateId,
        certificate_number,
        appraisal_id,
        type,
        status: initialStatus,
      },
    });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("감정서 발급 신청 오류:", error);
    res
      .status(500)
      .json({ success: false, message: "감정서 발급 신청 중 오류 발생" });
  } finally {
    if (conn) conn.release();
  }
});

// GET /api/appr/certificates (사용자 감정서 목록)
router.get("/", isAuthenticated, async (req, res) => {
  const user_id = req.session.user.id;
  const { status: queryStatus, page = 1, limit = 10 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  let conn;
  try {
    conn = await pool.getConnection();
    let sql = `SELECT c.id, c.certificate_number, c.type, c.status, c.issued_date, c.created_at, a.brand, a.model_name, a.result as appraisal_result, JSON_UNQUOTE(JSON_EXTRACT(a.images, '$[0]')) as representative_image FROM certificates c JOIN appraisals a ON c.appraisal_id = a.id WHERE c.user_id = ?`;
    const params = [user_id];
    if (queryStatus) {
      sql += " AND c.status = ?";
      params.push(queryStatus);
    }
    sql += " ORDER BY c.created_at DESC LIMIT ? OFFSET ?";
    params.push(parseInt(limit), offset);
    const [certsFromDb] = await conn.query(sql, params);

    const certificates = certsFromDb.map((cert) => ({
      id: cert.id,
      certificate_number: cert.certificate_number,
      type: cert.type,
      status: cert.status,
      issued_date: cert.issued_date,
      appraisal: {
        brand: cert.brand,
        model_name: cert.model_name,
        result: cert.appraisal_result,
        representative_image: cert.representative_image,
      },
      created_at: cert.created_at,
    }));

    let countSql =
      "SELECT COUNT(*) as totalItems FROM certificates WHERE user_id = ?";
    const countParams = [user_id];
    if (queryStatus) {
      countSql += " AND status = ?";
      countParams.push(queryStatus);
    }
    const [totalResult] = await conn.query(countSql, countParams);
    const totalItems = totalResult[0].totalItems;
    const totalPages = Math.ceil(totalItems / parseInt(limit));
    res.json({
      success: true,
      certificates,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems,
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("사용자 감정서 목록 조회 오류:", error);
    res
      .status(500)
      .json({ success: false, message: "감정서 목록 조회 중 오류 발생" });
  } finally {
    if (conn) conn.release();
  }
});

// GET /api/appr/certificates/:certificateNumber (감정서 정보 조회 - 공개)
router.get("/:certificateNumber", async (req, res) => {
  const { certificateNumber } = req.params;
  let conn;
  try {
    conn = await pool.getConnection();
    const [rows] = await conn.query(
      `SELECT c.certificate_number, c.type, c.status, c.issued_date, c.verification_code, a.id as appraisal_id, a.brand, a.model_name, a.category, a.result as appraisal_result, a.images as appraisal_images, a.result_notes as appraisal_result_notes, a.appraisal_type FROM certificates c JOIN appraisals a ON c.appraisal_id = a.id WHERE c.certificate_number = ?`,
      [certificateNumber]
    );
    if (rows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "해당 감정서를 찾을 수 없습니다." });
    const certData = rows[0];
    res.json({
      success: true,
      certificate: {
        certificate_number: certData.certificate_number,
        type: certData.type,
        status: certData.status,
        issued_date: certData.issued_date,
        appraisal: {
          appraisal_id: certData.appraisal_id,
          brand: certData.brand,
          model_name: certData.model_name,
          category: certData.category,
          result: certData.appraisal_result,
          images: certData.appraisal_images
            ? JSON.parse(certData.appraisal_images)
            : [],
          result_notes: certData.appraisal_result_notes,
          appraisal_type: certData.appraisal_type,
        },
        verification_code: certData.verification_code,
      },
    });
  } catch (error) {
    console.error("감정서 조회 오류:", error);
    res
      .status(500)
      .json({ success: false, message: "감정서 조회 중 오류 발생" });
  } finally {
    if (conn) conn.release();
  }
});

// PUT /api/appr/certificates/:certificateNumber/completion (감정서 발급 완료 처리)
router.put(
  "/:certificateNumber/completion",
  isAuthenticated,
  async (req, res) => {
    const { certificateNumber } = req.params;
    const { delivery_info, payment_info, status_to_update } = req.body;
    const user_id = req.session.user.id;
    const isAdminUser = req.session.user.id === "admin";

    if (!isAdminUser && !payment_info) {
      return res
        .status(400)
        .json({ success: false, message: "결제 정보가 누락되었습니다." });
    }
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [certs] = await conn.query(
        "SELECT id, type, status, user_id, delivery_info as existing_delivery_info, issued_date FROM certificates WHERE certificate_number = ?",
        [certificateNumber]
      );
      if (certs.length === 0) {
        await conn.rollback();
        return res
          .status(404)
          .json({ success: false, message: "해당 감정서를 찾을 수 없습니다." });
      }
      const certificate = certs[0];

      if (certificate.user_id !== user_id && !isAdminUser) {
        await conn.rollback();
        return res
          .status(403)
          .json({ success: false, message: "접근 권한이 없습니다." });
      }
      if (
        certificate.type === "physical" &&
        !delivery_info &&
        !certificate.existing_delivery_info
      ) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          message: "실물 감정서 발급 시 배송 정보 필수",
        });
      }

      let newStatus = status_to_update && isAdminUser ? status_to_update : null;
      if (!newStatus) {
        if (
          certificate.status === "pending_payment" ||
          certificate.status === "pending_issuance"
        ) {
          newStatus = certificate.type === "physical" ? "shipped" : "issued";
        } else {
          newStatus = certificate.status;
        }
      }
      const updateFields = { status: newStatus, updated_at: new Date() };
      if (payment_info)
        updateFields.payment_info = JSON.stringify(payment_info);
      if (
        (newStatus === "issued" || newStatus === "shipped") &&
        !certificate.issued_date
      ) {
        updateFields.issued_date = new Date();
      }
      if (delivery_info)
        updateFields.delivery_info = JSON.stringify(delivery_info);

      await conn.query(
        "UPDATE certificates SET ? WHERE certificate_number = ?",
        [updateFields, certificateNumber]
      );
      await conn.commit();
      res.json({
        success: true,
        message: "감정서 발급 처리가 완료되었습니다.",
        certificate: {
          certificate_number: certificateNumber,
          status: newStatus,
          delivery_info_updated: !!delivery_info,
        },
      });
    } catch (error) {
      if (conn) await conn.rollback();
      console.error("감정서 발급 완료 처리 오류:", error);
      res.status(500).json({
        success: false,
        message: "감정서 발급 완료 처리 중 오류 발생",
      });
    } finally {
      if (conn) conn.release();
    }
  }
);

// GET /api/appr/certificates/:certificateNumber/download (PDF 다운로드)
router.get(
  "/:certificateNumber/download",
  isAuthenticated,
  async (req, res) => {
    const { certificateNumber } = req.params;
    const user_id = req.session.user.id;
    let conn;
    try {
      conn = await pool.getConnection();
      const [rows] = await conn.query(
        `SELECT c.*, a.brand, a.model_name, a.category, a.result as appraisal_result, a.images as appraisal_images, a.result_notes as appraisal_result_notes FROM certificates c JOIN appraisals a ON c.appraisal_id = a.id WHERE c.certificate_number = ?`,
        [certificateNumber]
      );
      if (rows.length === 0)
        return res
          .status(404)
          .json({ success: false, message: "해당 감정서를 찾을 수 없습니다." });
      const certData = rows[0];
      if (certData.user_id !== user_id && req.session.user.id !== "admin") {
        return res
          .status(403)
          .json({ success: false, message: "다운로드 권한이 없습니다." });
      }

      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const fontDirectory = path.join(__dirname, "..", "..", "public", "fonts");
      const regularFontPath = path.join(fontDirectory, "NanumGothic.ttf");
      const boldFontPath = path.join(fontDirectory, "NanumGothicBold.ttf"); // 볼드 폰트 경로

      if (fs.existsSync(regularFontPath)) {
        doc.registerFont("NanumGothic", regularFontPath);
        if (fs.existsSync(boldFontPath)) {
          doc.registerFont("NanumGothic-Bold", boldFontPath);
        } else {
          console.warn(
            "경고: NanumGothicBold.ttf 폰트 파일을 찾을 수 없습니다."
          );
          doc.registerFont("NanumGothic-Bold", regularFontPath); // 볼드 없으면 레귤러로 대체
        }
      } else {
        console.warn(
          "경고: NanumGothic.ttf 폰트 파일을 찾을 수 없어 기본 폰트를 사용합니다."
        );
        doc.font("Helvetica"); // 기본 폰트
      }
      doc.font("NanumGothic"); // 전체 문서 기본 폰트

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="CAS_Certificate_${certificateNumber.replace(
          /-/g,
          "_"
        )}.pdf"`
      );
      doc.pipe(res);

      doc
        .font("NanumGothic-Bold")
        .fontSize(20)
        .text("CAS 명품 감정 시스템", { align: "center" });
      doc
        .font("NanumGothic")
        .fontSize(16)
        .text("공식 감정서", { align: "center" });
      doc.moveDown(1.5);

      doc
        .fontSize(10)
        .text(`감정서 번호: ${certData.certificate_number}`, 50, doc.y, {
          align: "left",
        });
      doc.text(
        `발급일: ${
          certData.issued_date
            ? new Date(certData.issued_date).toLocaleDateString("ko-KR")
            : "미발급"
        }`,
        50,
        doc.y,
        { align: "right" }
      );
      doc.moveDown(1);

      doc.font("NanumGothic-Bold").fontSize(12).text("감정 대상 정보");
      doc.font("NanumGothic").fontSize(10);
      doc.text(`브랜드: ${certData.brand || "정보 없음"}`);
      doc.text(`모델명: ${certData.model_name || "정보 없음"}`);
      doc.text(`카테고리: ${certData.category || "정보 없음"}`);
      doc.moveDown(1);

      doc.font("NanumGothic-Bold").fontSize(12).text("감정 결과");
      let resultText = "결과 정보 없음";
      let resultColor = "#000000";
      if (certData.appraisal_result === "authentic") {
        resultText = "정품 (Authentic)";
        resultColor = "#28a745";
      } else if (certData.appraisal_result === "fake") {
        resultText = "가품 (Counterfeit)";
        resultColor = "#dc3545";
      } else if (certData.appraisal_result === "uncertain") {
        resultText = "판단 보류 (Uncertain)";
        resultColor = "#fd7e14";
      } // 주황색 계열
      doc
        .font("NanumGothic-Bold")
        .fontSize(14)
        .fillColor(resultColor)
        .text(resultText, { align: "center" });
      doc.fillColor("#000000").font("NanumGothic").fontSize(10).moveDown(0.5);
      if (certData.appraisal_result_notes) {
        doc.text(
          `감정사 소견:\n${certData.appraisal_result_notes.replace(
            /<br\s*\/?>/gi,
            "\n"
          )}`
        );
      }
      doc.moveDown(1);

      const qrCodeDataURL = await QRCode.toDataURL(
        `${process.env.FRONTEND_URL}/appr/result-detail/${certificateNumber}`,
        { errorCorrectionLevel: "M", margin: 1, width: 80 }
      );
      doc.image(qrCodeDataURL, { fit: [80, 80], align: "center" });
      doc
        .fontSize(7)
        .text("위 QR코드를 스캔하여 온라인에서 감정서를 확인하세요.", {
          align: "center",
        });
      doc.moveDown(1.5);

      doc
        .fontSize(7)
        .text("본 감정서는 CAS 명품 감정 시스템에 의해 발급되었습니다.", {
          align: "center",
        });
      doc.text(`고유 확인 코드: ${certData.verification_code || "N/A"}`, {
        align: "center",
      });

      doc.end();
    } catch (error) {
      console.error("PDF 감정서 다운로드 오류:", error);
      if (!res.headersSent)
        res
          .status(500)
          .json({ success: false, message: "PDF 생성 중 오류 발생" });
    } finally {
      if (conn) conn.release();
    }
  }
);

// GET /api/appr/certificates/:certificateNumber/qrcode (QR 코드 이미지)
router.get("/:certificateNumber/qrcode", async (req, res) => {
  const { certificateNumber } = req.params;
  try {
    const verificationUrl = `${process.env.FRONTEND_URL}/appr/result-detail/${certificateNumber}`;
    const qrCodeBuffer = await QRCode.toBuffer(verificationUrl, {
      errorCorrectionLevel: "H",
      margin: 2,
      width: 150,
      color: { dark: "#000000FF", light: "#FFFFFFFF" },
    });
    res.setHeader("Content-Type", "image/png");
    res.send(qrCodeBuffer);
  } catch (error) {
    console.error("QR 코드 생성 오류:", error);
    res
      .status(500)
      .json({ success: false, message: "QR 코드 생성 중 오류 발생" });
  }
});

module.exports = router;
