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
const MAX_CONCURRENT_OPERATIONS = 50; // 동시 작업 수
const BATCH_SIZE = 500; // 배치 크기

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
    // 파일 전체 경로 계산
    const sourceFullPath = path.join(PUBLIC_DIR, sourcePath);
    const targetFullPath = path.join(PUBLIC_DIR, targetPath);

    // 소스 파일이 존재하는지 확인
    await fs.access(sourceFullPath);

    // 동일한 파일이 아닐 경우만 복사
    if (sourceFullPath !== targetFullPath) {
      // 타겟 디렉토리 확인
      const targetDir = path.dirname(targetFullPath);
      await fs.mkdir(targetDir, { recursive: true });

      // 파일 복사 (스트림 사용)
      await pipeline(
        createReadStream(sourceFullPath),
        createWriteStream(targetFullPath)
      );
    }

    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      // console.log(`파일 없음: ${sourcePath}`);
      return false; // 파일이 존재하지 않음
    }
    console.error(`파일 이동 오류 (${sourcePath} -> ${targetPath}):`, error);
    return false;
  }
}

// 파일 존재 여부 확인 함수
async function fileExists(filePath) {
  try {
    await fs.access(path.join(PUBLIC_DIR, filePath));
    return true;
  } catch (error) {
    return false;
  }
}

// crawled_items 마이그레이션
async function migrateCrawledItems() {
  let conn;
  try {
    conn = await pool.getConnection();

    // 동시 작업 제한기 생성
    const limit = pLimit(MAX_CONCURRENT_OPERATIONS);

    // 모든 crawled_items 가져오기
    const [items] = await conn.query(`
      SELECT item_id, image, additional_images
      FROM crawled_items
    `);

    console.log(`${items.length}개의 crawled_items 처리 중...`);

    // 모든 항목에서 이미지 경로 수집 및 존재 여부 확인
    const itemUpdates = [];
    const itemsToDelete = [];
    const fileChecks = [];

    // 각 이미지 파일의 존재 여부 확인 및 이동 작업 준비
    for (const item of items) {
      const update = {
        item_id: item.item_id,
        updates: [],
      };

      // 메인 이미지 확인
      if (item.image) {
        const oldPath = item.image;
        const fileName = path.basename(oldPath);
        const newPath = `/images/products/${fileName}`;

        // 이미지 존재 여부 확인 작업 추가
        fileChecks.push(
          limit(async () => {
            const exists = await fileExists(oldPath);
            if (exists) {
              // 존재하면 이동 작업 추가
              if (oldPath !== newPath) {
                await moveFile(oldPath, newPath);
                update.updates.push(`image = '${newPath}'`);
              }
              return true;
            } else {
              // 이미지가 없으면 삭제 목록에 추가
              itemsToDelete.push(item.item_id);
              return false;
            }
          })
        );
      }

      // 추가 이미지 처리
      if (item.additional_images) {
        try {
          const additionalImages = JSON.parse(item.additional_images);
          if (additionalImages && additionalImages.length > 0) {
            const newAdditionalImages = [];

            for (const oldPath of additionalImages) {
              const fileName = path.basename(oldPath);
              const newPath = `/images/products/${fileName}`;

              // 이동 작업 추가
              fileChecks.push(
                limit(async () => {
                  if (oldPath !== newPath) {
                    await moveFile(oldPath, newPath);
                  }
                  newAdditionalImages.push(newPath);
                  return true;
                })
              );
            }

            update.newAdditionalImages = newAdditionalImages;
          }
        } catch (error) {
          console.error(
            `추가 이미지 처리 오류 (item_id: ${item.item_id}):`,
            error
          );
        }
      }

      itemUpdates.push(update);
    }

    // 모든 파일 확인 및 이동 작업 완료 대기
    await Promise.all(fileChecks);

    // 데이터베이스 일괄 업데이트 수행
    if (itemUpdates.length > 0) {
      // 배치 처리
      for (let i = 0; i < itemUpdates.length; i += BATCH_SIZE) {
        const batch = itemUpdates.slice(i, i + BATCH_SIZE);

        // 배치 내 각 항목에 대한 업데이트 쿼리 준비
        const updatePromises = batch.map(async (update) => {
          if (update.updates && update.updates.length > 0) {
            await conn.query(
              `
              UPDATE crawled_items 
              SET ${update.updates.join(", ")} 
              WHERE item_id = ?
            `,
              [update.item_id]
            );
          }

          if (update.newAdditionalImages) {
            await conn.query(
              `
              UPDATE crawled_items 
              SET additional_images = ? 
              WHERE item_id = ?
            `,
              [JSON.stringify(update.newAdditionalImages), update.item_id]
            );
          }
        });

        await Promise.all(updatePromises);
        console.log(
          `crawled_items 배치 업데이트 완료: ${i + 1} ~ ${Math.min(
            i + BATCH_SIZE,
            itemUpdates.length
          )} / ${itemUpdates.length}`
        );
      }
    }

    // 삭제할 항목이 있으면 일괄 삭제
    if (itemsToDelete.length > 0) {
      // 한 번에 모든 항목 삭제
      await conn.query(
        `
        DELETE FROM crawled_items 
        WHERE item_id IN (?)
      `,
        [itemsToDelete]
      );

      console.log(`이미지 없는 항목 ${itemsToDelete.length}개 삭제됨`);
    }

    console.log(
      `crawled_items 마이그레이션 완료: ${
        itemUpdates.length - itemsToDelete.length
      }개 성공, ${itemsToDelete.length}개 삭제`
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

    // 동시 작업 제한기 생성
    const limit = pLimit(MAX_CONCURRENT_OPERATIONS);

    // 모든 values_items 가져오기
    const [items] = await conn.query(`
      SELECT item_id, image, additional_images
      FROM values_items
    `);

    console.log(`${items.length}개의 values_items 처리 중...`);

    // 모든 항목에서 이미지 경로 수집 및 존재 여부 확인
    const itemUpdates = [];
    const itemsToDelete = [];
    const fileChecks = [];

    // 각 이미지 파일의 존재 여부 확인 및 이동 작업 준비
    for (const item of items) {
      const update = {
        item_id: item.item_id,
        updates: [],
      };

      // 메인 이미지 확인
      if (item.image) {
        const oldPath = item.image;
        const fileName = path.basename(oldPath);
        const newPath = `/images/values/${fileName}`;

        // 이미지 존재 여부 확인 작업 추가
        fileChecks.push(
          limit(async () => {
            const exists = await fileExists(oldPath);
            if (exists) {
              // 존재하면 이동 작업 추가
              if (oldPath !== newPath) {
                await moveFile(oldPath, newPath);
                update.updates.push(`image = '${newPath}'`);
              }
              return true;
            } else {
              // 이미지가 없으면 삭제 목록에 추가 - values는 이미지가 없어도 삭제하지 않도록 수정
              // 기존 경로 유지
              console.log(
                `경고: values_items에서 이미지가 없는 항목 발견: ${item.item_id}, ${oldPath}`
              );
              return false;
            }
          })
        );
      }

      // 추가 이미지 처리
      if (item.additional_images) {
        try {
          const additionalImages = JSON.parse(item.additional_images);
          if (additionalImages && additionalImages.length > 0) {
            const newAdditionalImages = [];

            for (const oldPath of additionalImages) {
              const fileName = path.basename(oldPath);
              const newPath = `/images/values/${fileName}`;

              // 이동 작업 추가
              fileChecks.push(
                limit(async () => {
                  if (oldPath !== newPath) {
                    await moveFile(oldPath, newPath);
                  }
                  newAdditionalImages.push(newPath);
                  return true;
                })
              );
            }

            update.newAdditionalImages = newAdditionalImages;
          }
        } catch (error) {
          console.error(
            `추가 이미지 처리 오류 (item_id: ${item.item_id}):`,
            error
          );
        }
      }

      itemUpdates.push(update);
    }

    // 모든 파일 확인 및 이동 작업 완료 대기
    await Promise.all(fileChecks);

    // 데이터베이스 일괄 업데이트 수행
    if (itemUpdates.length > 0) {
      // 배치 처리
      for (let i = 0; i < itemUpdates.length; i += BATCH_SIZE) {
        const batch = itemUpdates.slice(i, i + BATCH_SIZE);

        // 배치 내 각 항목에 대한 업데이트 쿼리 준비
        const updatePromises = batch.map(async (update) => {
          if (update.updates && update.updates.length > 0) {
            await conn.query(
              `
              UPDATE values_items 
              SET ${update.updates.join(", ")} 
              WHERE item_id = ?
            `,
              [update.item_id]
            );
          }

          if (update.newAdditionalImages) {
            await conn.query(
              `
              UPDATE values_items 
              SET additional_images = ? 
              WHERE item_id = ?
            `,
              [JSON.stringify(update.newAdditionalImages), update.item_id]
            );
          }
        });

        await Promise.all(updatePromises);
        console.log(
          `values_items 배치 업데이트 완료: ${i + 1} ~ ${Math.min(
            i + BATCH_SIZE,
            itemUpdates.length
          )} / ${itemUpdates.length}`
        );
      }
    }

    console.log(
      `values_items 마이그레이션 완료: ${itemUpdates.length}개 처리됨`
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
