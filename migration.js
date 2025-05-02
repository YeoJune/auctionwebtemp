// temp.js
const pool = require("./utils/DB");
const fs = require("fs").promises;
const path = require("path");
const { promisify } = require("util");
const { createReadStream, createWriteStream } = require("fs");
const pipeline = promisify(require("stream").pipeline);

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

// crawled_items 마이그레이션
async function migrateCrawledItems() {
  let conn;
  try {
    conn = await pool.getConnection();

    // 모든 crawled_items 가져오기
    const [items] = await conn.query(`
      SELECT item_id, image, additional_images
      FROM crawled_items
    `);

    console.log(`${items.length}개의 crawled_items 처리 중...`);

    let successCount = 0;
    let failCount = 0;
    let deletedCount = 0;

    for (const item of items) {
      let mainImageExists = true;
      let updatedPaths = [];

      // 메인 이미지 처리
      if (item.image) {
        const oldPath = item.image;
        const fileName = path.basename(oldPath);
        const newPath = `/images/products/${fileName}`;

        if (oldPath !== newPath) {
          // 경로가 다른 경우만 이동
          const success = await moveFile(oldPath, newPath);

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

          for (const oldPath of additionalImages) {
            const fileName = path.basename(oldPath);
            const newPath = `/images/products/${fileName}`;

            if (oldPath !== newPath) {
              // 경로가 다른 경우만 이동
              await moveFile(oldPath, newPath);
            }

            newAdditionalImages.push(newPath);
          }

          updatedPaths.push(
            `additional_images = '${JSON.stringify(newAdditionalImages)}'`
          );
        } catch (error) {
          console.error(
            `추가 이미지 처리 오류 (item_id: ${item.item_id}):`,
            error
          );
        }
      }

      // DB 업데이트 또는 삭제
      if (!mainImageExists) {
        // 메인 이미지가 없으면 항목 삭제
        await conn.query(`DELETE FROM crawled_items WHERE item_id = ?`, [
          item.item_id,
        ]);
        deletedCount++;
      } else if (updatedPaths.length > 0) {
        // 경로 업데이트
        await conn.query(
          `
          UPDATE crawled_items 
          SET ${updatedPaths.join(", ")} 
          WHERE item_id = ?
        `,
          [item.item_id]
        );
        successCount++;
      } else {
        // 변경 없음
        successCount++;
      }
    }

    console.log(
      `crawled_items 마이그레이션 완료: ${successCount}개 성공, ${failCount}개 실패, ${deletedCount}개 삭제`
    );
  } catch (error) {
    console.error("crawled_items 마이그레이션 오류:", error);
  } finally {
    if (conn) conn.release();
  }
}

// values_items 마이그레이션
async function migrateValuesItems() {
  let conn;
  try {
    conn = await pool.getConnection();

    // 모든 values_items 가져오기
    const [items] = await conn.query(`
      SELECT item_id, image, additional_images
      FROM values_items
    `);

    console.log(`${items.length}개의 values_items 처리 중...`);

    let successCount = 0;
    let failCount = 0;
    let deletedCount = 0;

    for (const item of items) {
      let mainImageExists = true;
      let updatedPaths = [];

      // 메인 이미지 처리
      if (item.image) {
        const oldPath = item.image;
        const fileName = path.basename(oldPath);
        const newPath = `/images/values/${fileName}`;

        if (oldPath !== newPath) {
          // 경로가 다른 경우만 이동
          const success = await moveFile(oldPath, newPath);

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

          for (const oldPath of additionalImages) {
            const fileName = path.basename(oldPath);
            const newPath = `/images/values/${fileName}`;

            if (oldPath !== newPath) {
              // 경로가 다른 경우만 이동
              await moveFile(oldPath, newPath);
            }

            newAdditionalImages.push(newPath);
          }

          updatedPaths.push(
            `additional_images = '${JSON.stringify(newAdditionalImages)}'`
          );
        } catch (error) {
          console.error(
            `추가 이미지 처리 오류 (item_id: ${item.item_id}):`,
            error
          );
        }
      }

      // DB 업데이트 또는 삭제
      if (!mainImageExists) {
        // 메인 이미지가 없으면 항목 삭제
        await conn.query(`DELETE FROM values_items WHERE item_id = ?`, [
          item.item_id,
        ]);
        deletedCount++;
      } else if (updatedPaths.length > 0) {
        // 경로 업데이트
        await conn.query(
          `
          UPDATE values_items 
          SET ${updatedPaths.join(", ")} 
          WHERE item_id = ?
        `,
          [item.item_id]
        );
        successCount++;
      } else {
        // 변경 없음
        successCount++;
      }
    }

    console.log(
      `values_items 마이그레이션 완료: ${successCount}개 성공, ${failCount}개 실패, ${deletedCount}개 삭제`
    );
  } catch (error) {
    console.error("values_items 마이그레이션 오류:", error);
  } finally {
    if (conn) conn.release();
  }
}

// 메인 마이그레이션 함수
async function migrateImages() {
  try {
    console.log("이미지 폴더 마이그레이션 시작...");

    // 폴더 확인 및 생성
    await ensureDirectories();

    // crawled_items 마이그레이션
    await migrateCrawledItems();

    // values_items 마이그레이션
    await migrateValuesItems();

    console.log("마이그레이션 완료!");
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
