const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

// 설정
const MAX_WIDTH = 600;
const MAX_HEIGHT = 600;
const CONCURRENT_DOWNLOADS = 20;
const MAX_RETRIES = 5;
const INITIAL_DELAY = 500;

// 이미지 처리 큐 및 상태
const queue = [];
let isProcessing = false;
let currentDelay = INITIAL_DELAY;
let consecutiveFailures = 0;
let processingPaused = false;

// 이미지 다운로드 및 저장
async function downloadAndSaveImage(url, folderName = "products") {
  const IMAGE_DIR = path.join(__dirname, "..", "public", "images", folderName);

  // 폴더가 없으면 생성
  if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
  }

  const dateString = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .split(".")[0];

  try {
    const response = await axios
      .create({
        timeout: 10000,
        responseType: "arraybuffer",
      })
      .get(url);

    const fileName = `${dateString}_${uuidv4()}.webp`;
    const filePath = path.join(IMAGE_DIR, fileName);

    const metadata = await sharp(response.data).metadata();
    let processedImage = sharp(response.data);

    if (metadata.width > MAX_WIDTH || metadata.height > MAX_HEIGHT) {
      processedImage = processedImage.resize({
        width: Math.min(metadata.width, MAX_WIDTH),
        height: Math.min(metadata.height, MAX_HEIGHT),
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    await processedImage.webp({ quality: 80 }).toFile(filePath);

    // 성공 시 연속 실패 카운터 초기화
    consecutiveFailures = 0;

    // 성공 시 딜레이를 점진적으로 감소
    if (currentDelay > INITIAL_DELAY) {
      currentDelay = Math.max(INITIAL_DELAY, currentDelay * 0.9); // 10%씩 감소
    }

    return `/images/${folderName}/${fileName}`;
  } catch (error) {
    console.error(`이미지 처리 오류: ${url}`, error.message);

    // 연속 실패 카운터 증가
    consecutiveFailures++;

    if (consecutiveFailures >= 2) {
      processingPaused = true;
      console.log(`연속 실패 감지! 처리 일시 중지, 딜레이 ${currentDelay}ms`);

      setTimeout(() => {
        processingPaused = false;
        processQueue(folderName);
      }, currentDelay);

      // 딜레이 증가 (최대 1분)
      currentDelay = Math.min(currentDelay * 2, 60000);
    }

    // 404인 경우 특수 코드 반환
    if (error.response && error.response.status === 404) {
      return 404;
    }

    return null;
  }
}

// 큐 프로세서
async function processQueue(folderName) {
  if (isProcessing || processingPaused || queue.length === 0) return;

  isProcessing = true;

  try {
    const limit = pLimit(CONCURRENT_DOWNLOADS);
    const batch = queue.splice(0, CONCURRENT_DOWNLOADS);
    const tasks = batch.map((task) =>
      limit(() => processQueueItem(task, folderName))
    );

    await Promise.all(tasks);
  } catch (error) {
    console.error("큐 처리 오류:", error);
  } finally {
    isProcessing = false;

    if (queue.length > 0 && !processingPaused) {
      setTimeout(() => processQueue(folderName), 100);
    }
  }
}

// 개별 큐 항목 처리
async function processQueueItem(task, folderName) {
  const { url, resolve, attempt = 0 } = task;

  // 최대 재시도 횟수에 도달했으면 종료
  if (attempt >= MAX_RETRIES) {
    resolve(null);
    return;
  }

  // 이미지 다운로드 시도
  const result = await downloadAndSaveImage(url, folderName);

  // 결과 처리
  if (typeof result === "string") {
    // 성공적으로 이미지 다운로드
    resolve(result);
  } else if (result === 404) {
    // 404 오류는 딱 한 번만 재시도
    if (attempt === 0) {
      queue.push({ url, resolve, attempt: 1 });
    } else {
      resolve(null);
    }
  } else {
    // 그 외 오류는 계속 재시도
    if (attempt < MAX_RETRIES - 1) {
      queue.push({ url, resolve, attempt: attempt + 1 });
    } else {
      resolve(null);
    }
  }
}

// 큐에 항목 추가
function enqueueImage(url, folderName) {
  return new Promise((resolve) => {
    queue.push({ url, resolve });

    if (!isProcessing && !processingPaused) {
      processQueue(folderName);
    }
  });
}

// 공개 인터페이스
async function processImagesInChunks(items, folderName = "products") {
  const itemsWithImages = [];
  const itemsWithoutImages = [];

  items.forEach((item) => {
    if (
      item.image ||
      (item.additional_images && JSON.parse(item.additional_images).length > 0)
    ) {
      itemsWithImages.push(item);
    } else {
      itemsWithoutImages.push(item);
    }
  });

  // 큐 기반 처리
  const processItem = async (item) => {
    const tasks = [];

    if (item.image) {
      tasks.push(
        enqueueImage(item.image, folderName).then((savedPath) => {
          if (savedPath) item.image = savedPath;
        })
      );
    }

    if (item.additional_images) {
      try {
        const additionalImages = JSON.parse(item.additional_images);
        const savedImages = [];

        additionalImages.forEach((imgUrl) => {
          tasks.push(
            enqueueImage(imgUrl, folderName).then((savedPath) => {
              if (savedPath) savedImages.push(savedPath);
            })
          );
        });

        await Promise.all(tasks);
        item.additional_images = JSON.stringify(savedImages);
      } catch (err) {
        console.error("추가 이미지 처리 오류:", err);
      }
    } else {
      await Promise.all(tasks);
    }

    return item;
  };

  // 진행 상황 모니터링
  let completed = 0;
  const total = itemsWithImages.length;
  const logInterval = setInterval(() => {
    console.log(
      `다운로드 진행률: ${completed} / ${total} (${Math.round(
        (completed / total) * 100
      )}%), 큐 길이: ${queue.length}, 폴더: ${folderName}`
    );
  }, 5000);

  // 모든 항목 처리
  const results = await Promise.allSettled(
    itemsWithImages.map(async (item) => {
      const result = await processItem(item);
      completed++;
      return result;
    })
  );

  clearInterval(logInterval);

  const processedItems = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);

  console.log(
    `이미지 처리 완료: ${processedItems.length} 항목 성공, 폴더: ${folderName}`
  );

  return [...processedItems, ...itemsWithoutImages];
}

// 큐 상태 초기화 함수
function resetQueue() {
  queue.length = 0;
  isProcessing = false;
  currentDelay = INITIAL_DELAY;
  consecutiveFailures = 0;
  processingPaused = false;
}

module.exports = { processImagesInChunks, resetQueue };
