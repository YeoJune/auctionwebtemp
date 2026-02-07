// utils/excel.js
// 엑셀 생성 유틸리티 (이미지 임베딩 지원)

const ExcelJS = require("exceljs");
const axios = require("axios");
const pLimit = require("p-limit");
const sharp = require("sharp");

/**
 * 이미지 다운로드 및 버퍼 변환
 * @param {string} imageUrl - 이미지 URL
 * @param {number} maxWidth - 최대 너비 (기본: 150)
 * @param {number} maxHeight - 최대 높이 (기본: 150)
 * @returns {Promise<Buffer|null>} - 이미지 버퍼 또는 null
 */
async function downloadAndResizeImage(
  imageUrl,
  maxWidth = 150,
  maxHeight = 150,
) {
  try {
    if (!imageUrl || imageUrl === "/images/no-image.png") {
      return null;
    }

    // 상대 경로를 절대 URL로 변환
    let fullUrl = imageUrl;
    if (imageUrl.startsWith("/")) {
      // 로컬 파일인 경우 - S3나 다른 경로로 처리 필요
      // 일단은 null 반환
      return null;
    }

    const response = await axios.get(fullUrl, {
      responseType: "arraybuffer",
      timeout: 10000, // 10초 타임아웃
      maxRedirects: 5,
    });

    // Sharp로 리사이즈
    const resizedBuffer = await sharp(response.data)
      .resize(maxWidth, maxHeight, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toBuffer();

    return resizedBuffer;
  } catch (error) {
    console.error(`이미지 다운로드 실패 (${imageUrl}):`, error.message);
    return null;
  }
}

/**
 * 엑셀 워크북 생성
 * @param {Object} options - 워크북 설정
 * @param {string} options.sheetName - 시트 이름
 * @param {Array} options.columns - 컬럼 정의 [{ header, key, width, style }]
 * @param {Array} options.rows - 데이터 행 (객체 배열)
 * @param {Array} options.imageColumns - 이미지 포함 컬럼 키 배열 (예: ['image'])
 * @param {number} options.imageWidth - 이미지 너비 (기본: 100)
 * @param {number} options.imageHeight - 이미지 높이 (기본: 100)
 * @param {number} options.maxConcurrency - 동시 이미지 다운로드 수 (기본: 5)
 * @returns {Promise<ExcelJS.Workbook>} - 생성된 워크북
 */
async function createWorkbook({
  sheetName = "Sheet1",
  columns = [],
  rows = [],
  imageColumns = [],
  imageWidth = 100,
  imageHeight = 100,
  maxConcurrency = 5,
}) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  // 워크북 메타데이터 설정
  workbook.creator = "Auction System";
  workbook.created = new Date();
  workbook.modified = new Date();

  // 컬럼 설정
  worksheet.columns = columns.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width || 20,
    style: col.style || {},
  }));

  // 헤더 스타일 적용
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, size: 11 };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE0E0E0" },
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height = 25;

  // 이미지 컬럼 인덱스 찾기
  const imageColumnIndices = imageColumns
    .map((key) => columns.findIndex((col) => col.key === key))
    .filter((idx) => idx !== -1);

  // 이미지 다운로드 동시성 제한
  const limit = pLimit(maxConcurrency);

  // 행별 이미지 다운로드 준비
  const imagePromises = rows.map((row, rowIdx) => {
    return limit(async () => {
      const images = {};
      for (const colKey of imageColumns) {
        const imageUrl = row[colKey];
        if (imageUrl) {
          const buffer = await downloadAndResizeImage(
            imageUrl,
            imageWidth,
            imageHeight,
          );
          if (buffer) {
            images[colKey] = buffer;
          }
        }
      }
      return { rowIdx, images };
    });
  });

  // 모든 이미지 다운로드 완료 대기
  const imageResults = await Promise.all(imagePromises);
  const imageMap = new Map(imageResults.map((r) => [r.rowIdx, r.images]));

  // 데이터 행 추가
  rows.forEach((row, rowIdx) => {
    // 이미지 컬럼은 빈 값으로 추가
    const rowData = { ...row };
    imageColumns.forEach((key) => {
      rowData[key] = ""; // 이미지는 텍스트 대신 나중에 삽입
    });
    worksheet.addRow(rowData);

    // 행 높이 설정 (이미지가 있으면 더 크게)
    const worksheetRow = worksheet.getRow(rowIdx + 2); // 헤더 다음부터
    worksheetRow.height = imageMap.get(rowIdx) ? imageHeight * 0.75 : 20;

    // 행 스타일
    worksheetRow.alignment = {
      vertical: "middle",
      horizontal: "left",
      wrapText: true,
    };
    worksheetRow.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
  });

  // 이미지 삽입
  for (const [rowIdx, images] of imageMap.entries()) {
    for (const [colKey, buffer] of Object.entries(images)) {
      const colIdx = columns.findIndex((col) => col.key === colKey);
      if (colIdx === -1) continue;

      // 워크북에 이미지 추가
      const imageId = workbook.addImage({
        buffer: buffer,
        extension: "jpeg",
      });

      // 셀 위치 계산 (0-based → 1-based)
      const row = rowIdx + 2; // 헤더 다음부터
      const col = colIdx + 1;

      // 이미지 삽입 (셀 내부에 맞춤)
      worksheet.addImage(imageId, {
        tl: { col: colIdx, row: rowIdx + 1 }, // top-left (0-based)
        br: { col: colIdx + 1, row: rowIdx + 2 }, // bottom-right (0-based)
        editAs: "oneCell",
      });
    }
  }

  return workbook;
}

/**
 * 워크북을 버퍼로 변환
 * @param {ExcelJS.Workbook} workbook
 * @returns {Promise<Buffer>}
 */
async function workbookToBuffer(workbook) {
  return await workbook.xlsx.writeBuffer();
}

/**
 * 워크북을 스트림으로 응답
 * @param {ExcelJS.Workbook} workbook
 * @param {Object} res - Express response 객체
 * @param {string} filename - 다운로드 파일명
 */
async function streamWorkbookToResponse(workbook, res, filename) {
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${encodeURIComponent(filename)}"`,
  );

  await workbook.xlsx.write(res);
  res.end();
}

/**
 * 날짜 포맷팅 (엑셀용)
 * @param {Date|string} date
 * @returns {string}
 */
function formatDateForExcel(date) {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

/**
 * 숫자 포맷팅 (엑셀용)
 * @param {number} num
 * @returns {number|string}
 */
function formatNumberForExcel(num) {
  if (num === null || num === undefined) return "";
  if (typeof num === "number") return num;
  return parseFloat(num) || 0;
}

module.exports = {
  createWorkbook,
  workbookToBuffer,
  streamWorkbookToResponse,
  downloadAndResizeImage,
  formatDateForExcel,
  formatNumberForExcel,
};
