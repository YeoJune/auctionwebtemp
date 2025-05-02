// temp.js
const pool = require("./utils/DB");
const fs = require("fs").promises;
const path = require("path");
const { promisify } = require("util");
const { createReadStream, createWriteStream } = require("fs");
const pipeline = promisify(require("stream").pipeline);

// p-limit 가져오기 (동적 임포트)
let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

// 설정
const MAX_CONCURRENT_OPERATIONS = 50; // 동시 작업 수 (서버와 디스크 성능에 맞게 조정)
const BATCH_SIZE = 200; // 배치 크기

// 경로 설정
const PUBLIC_DIR = path.join(__dirname, "public");
const IMAGES_DIR = path.join(PUBLIC_DIR, "images");
const PRODUCTS_DIR = path.join(IMAGES_DIR, "products");
const VALUES_DIR = path.join(IMAGES_DIR, "values");

// 폴더가 없으면 생성
async function ensureDirectories() {
  try {
    await fs.mkdir(PRODUCTS_DIR, { recursive: true });
    await fs.mkdir(VALUES_DIR, { recursive: true });
    console.log("폴더 구조 확인 완료");
  } catch (error) {
    console.error("폴더 생성 오류:", error);
    throw error;
  }
}

// 이미지 파일 이동 함수
async function moveFile(sourcePath, targetPath) {
  try {
    // 소스 파일이 존재하는지 확인
    await fs.access(path.join(PUBLIC_DIR, sourcePath));

    // 타겟 경로 생성
    const fullTargetPath = path.join(PUBLIC_DIR, targetPath);

    // 파일 복사 (스트림 사용)
    await pipeline(
      createReadStream(path.join(PUBLIC_DIR, sourcePath)),
      createWriteStream(fullTargetPath)
    );

    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false; // 파일이 존재하지 않음
    }
    console.error(`파일 이동 오류 (${sourcePath} -> ${targetPath}):`, error);
    return false;
  }
}

// 아이템 처리 함수
async function processItem(item, tableName, conn, limitFn) {
  let mainImageExists = true;
  let updatedPaths = [];

  const folderName = tableName === "crawled_items" ? "products" : "values";

  // 메인 이미지 처리
  if (item.image) {
    const oldPath = item.image;
    const fileName = path.basename(oldPath);
    const newPath = `/images/${folderName}/${fileName}`;

    if (oldPath !== newPath) {
      // 경로가 다른 경우만 이동
      const success = await limitFn(() => moveFile(oldPath, newPath));

      if (success) {
        updatedPaths.push(`image = '${newPath}'`);
      } else {
        mainImageExists = false;
      }
    }
  }

  // 추가 이미지 처리
  if (item.additional_images) {
    try {
      const additionalImages = JSON.parse(item.additional_images);
      const newAdditionalImages = [];

      // 추가 이미지 병렬 처리
      const movePromises = additionalImages.map(async (oldPath) => {
        const fileName = path.basename(oldPath);
        const newPath = `/images/${folderName}/${fileName}`;

        if (oldPath !== newPath) {
          // 경로가 다른 경우만 이동
          await limitFn(() => moveFile(oldPath, newPath));
        }

        return newPath;
      });

      const results = await Promise.all(movePromises);
      newAdditionalImages.push(...results);

      updatedPaths.push(
        `additional_images = '${JSON.stringify(newAdditionalImages)}'`
      );
    } catch (error) {
      console.error(`추가 이미지 처리 오류 (item_id: ${item.item_id}):`, error);
    }
  }

  // DB 업데이트 또는 삭제
  if (!mainImageExists) {
    // 메인 이미지가 없으면 항목 삭제
    await conn.query(`DELETE FROM ${tableName} WHERE item_id = ?`, [
      item.item_id,
    ]);
    return "deleted";
  } else if (updatedPaths.length > 0) {
    // 경로 업데이트
    await conn.query(
      `
      UPDATE ${tableName} 
      SET ${updatedPaths.join(", ")} 
      WHERE item_id = ?
    `,
      [item.item_id]
    );
    return "updated";
  } else {
    // 변경 없음
    return "unchanged";
  }
}

// 배치 처리 함수
async function processBatch(items, tableName, conn, limit) {
  const results = {
    updated: 0,
    unchanged: 0,
    deleted: 0,
    failed: 0,
  };

  const processPromises = items.map(async (item) => {
    try {
      const result = await processItem(item, tableName, conn, limit);
      results[result]++;
    } catch (error) {
      console.error(`아이템 처리 오류 (item_id: ${item.item_id}):`, error);
      results.failed++;
    }
  });

  await Promise.all(processPromises);
  return results;
}

// crawled_items 마이그레이션
async function migrateCrawledItems() {
  let conn;
  try {
    conn = await pool.getConnection();

    // 동시 작업 제한기 생성
    const limit = pLimit(MAX_CONCURRENT_OPERATIONS);

    // 레코드 총 개수 확인
    const [countResult] = await conn.query(
      `SELECT COUNT(*) as total FROM crawled_items`
    );
    const totalItems = countResult[0].total;
    console.log(`총 ${totalItems}개의 crawled_items 처리 예정`);

    // 배치 처리를 위한 오프셋과 결과 초기화
    let offset = 0;
    const totalResults = {
      updated: 0,
      unchanged: 0,
      deleted: 0,
      failed: 0,
    };

    while (offset < totalItems) {
      // 배치 데이터 가져오기
      const [batchItems] = await conn.query(
        `
        SELECT item_id, image, additional_images
        FROM crawled_items
        LIMIT ? OFFSET ?
      `,
        [BATCH_SIZE, offset]
      );

      console.log(
        `crawled_items 배치 처리 중: ${offset + 1} - ${Math.min(
          offset + BATCH_SIZE,
          totalItems
        )} / ${totalItems}`
      );

      // 배치 처리 및 결과 누적
      const batchResults = await processBatch(
        batchItems,
        "crawled_items",
        conn,
        limit
      );

      Object.keys(batchResults).forEach((key) => {
        totalResults[key] += batchResults[key];
      });

      // 진행 상황 출력
      const percentComplete = Math.round(
        ((offset + BATCH_SIZE) / totalItems) * 100
      );
      console.log(
        `진행률: ${Math.min(percentComplete, 100)}%, 완료: ${
          totalResults.updated + totalResults.unchanged
        }개, 삭제: ${totalResults.deleted}개, 실패: ${totalResults.failed}개`
      );

      // 오프셋 증가
      offset += BATCH_SIZE;
    }

    console.log(
      `crawled_items 마이그레이션 완료: ${totalResults.updated}개 업데이트, ${totalResults.unchanged}개 변경없음, ${totalResults.deleted}개 삭제, ${totalResults.failed}개 실패`
    );

    return totalResults;
  } catch (error) {
    console.error("crawled_items 마이그레이션 오류:", error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
}

// values_items 마이그레이션
async function migrateValuesItems() {
  let conn;
  try {
    conn = await pool.getConnection();

    // 동시 작업 제한기 생성
    const limit = pLimit(MAX_CONCURRENT_OPERATIONS);

    // 레코드 총 개수 확인
    const [countResult] = await conn.query(
      `SELECT COUNT(*) as total FROM values_items`
    );
    const totalItems = countResult[0].total;
    console.log(`총 ${totalItems}개의 values_items 처리 예정`);

    // 배치 처리를 위한 오프셋과 결과 초기화
    let offset = 0;
    const totalResults = {
      updated: 0,
      unchanged: 0,
      deleted: 0,
      failed: 0,
    };

    while (offset < totalItems) {
      // 배치 데이터 가져오기
      const [batchItems] = await conn.query(
        `
        SELECT item_id, image, additional_images
        FROM values_items
        LIMIT ? OFFSET ?
      `,
        [BATCH_SIZE, offset]
      );

      console.log(
        `values_items 배치 처리 중: ${offset + 1} - ${Math.min(
          offset + BATCH_SIZE,
          totalItems
        )} / ${totalItems}`
      );

      // 배치 처리 및 결과 누적
      const batchResults = await processBatch(
        batchItems,
        "values_items",
        conn,
        limit
      );

      Object.keys(batchResults).forEach((key) => {
        totalResults[key] += batchResults[key];
      });

      // 진행 상황 출력
      const percentComplete = Math.round(
        ((offset + BATCH_SIZE) / totalItems) * 100
      );
      console.log(
        `진행률: ${Math.min(percentComplete, 100)}%, 완료: ${
          totalResults.updated + totalResults.unchanged
        }개, 삭제: ${totalResults.deleted}개, 실패: ${totalResults.failed}개`
      );

      // 오프셋 증가
      offset += BATCH_SIZE;
    }

    console.log(
      `values_items 마이그레이션 완료: ${totalResults.updated}개 업데이트, ${totalResults.unchanged}개 변경없음, ${totalResults.deleted}개 삭제, ${totalResults.failed}개 실패`
    );

    return totalResults;
  } catch (error) {
    console.error("values_items 마이그레이션 오류:", error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
}

// 메인 마이그레이션 함수
async function migrateImages() {
  try {
    const startTime = Date.now();
    console.log(
      `이미지 폴더 마이그레이션 시작... (${new Date().toISOString()})`
    );

    // 폴더 확인 및 생성
    await ensureDirectories();

    // crawled_items 마이그레이션
    await migrateCrawledItems();

    // values_items 마이그레이션
    await migrateValuesItems();

    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000; // 초 단위로 변환

    console.log(
      `마이그레이션 완료! 총 실행 시간: ${executionTime.toFixed(2)}초 (${(
        executionTime / 60
      ).toFixed(2)}분)`
    );
  } catch (error) {
    console.error("마이그레이션 실패:", error);
  } finally {
    // DB 연결 종료
    try {
      await pool.end();
    } catch (err) {
      console.error("DB 연결 종료 오류:", err);
    }
  }
}

// 스크립트 실행
migrateImages()
  .then(() => {
    console.log("모든 작업 완료");
  })
  .catch((err) => {
    console.error("최상위 오류:", err);
    process.exit(1);
  });
