// utils/processImage.js
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const { ProxyManager } = require("./proxy");

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
const PRIORITY_LEVELS = 3; // 우선순위 레벨 수 (1: 높음, 2: 중간, 3: 낮음)

// Crop 설정 format:
// - width/height: 최종 크기 (null이면 원본 크기 유지)
// - cropTop/cropBottom: 위/아래에서 자를 픽셀 수
// - cropLeft/cropRight: 좌/우에서 자를 픽셀 수
const CROP_SETTINGS = {
  brand: { cropTop: 40, cropBottom: 40, cropLeft: 0, cropRight: 0 },
};

// 우선순위별 이미지 처리 큐 및 상태
const queues = Array(PRIORITY_LEVELS)
  .fill()
  .map(() => []);
let isProcessing = false;
let currentDelay = INITIAL_DELAY;
let consecutiveFailures = 0;
let processingPaused = false;

// 프록시 관리
let proxyManager = null;
let clients = [];
let currentClientIndex = 0;

// 프록시 초기화
function initializeProxy() {
  if (!proxyManager) {
    proxyManager = new ProxyManager({
      // Keep-Alive 최적화 설정
      maxSockets: 100,
      maxFreeSockets: 10,
      socketTimeout: 60000,
      freeSocketTimeout: 30000,
      keepAliveMsecs: 1000,
      // 기존 설정 유지
      timeout: 30000,
      maxRedirects: 5,
    });
    clients = proxyManager.createAllClients();
    console.log(
      `이미지 프로세서: ${clients.length}개 클라이언트 초기화 (Keep-Alive 최적화)`
    );
  }
}

// 이미지 다운로드 및 저장 (프록시 로테이션 적용)
async function downloadAndSaveImage(
  url,
  folderName = "products",
  cropType = null
) {
  initializeProxy();

  const IMAGE_DIR = path.join(__dirname, "..", "public", "images", folderName);

  // 폴더가 없으면 생성
  if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
  }

  const dateString = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .split(".")[0];

  // 모든 클라이언트 시도
  for (let attempt = 0; attempt < clients.length; attempt++) {
    const client = clients[currentClientIndex];
    currentClientIndex = (currentClientIndex + 1) % clients.length;

    try {
      // ProxyManager 클라이언트는 이미 설정이 되어있으므로 responseType만 설정
      const response = await client.client({
        method: "GET",
        url: url,
        responseType: "arraybuffer",
      });

      const fileName = `${dateString}_${uuidv4()}${
        cropType ? `_${cropType}` : ""
      }.webp`;
      const filePath = path.join(IMAGE_DIR, fileName);

      const metadata = await sharp(response.data).metadata();
      let processedImage = sharp(response.data);

      // Crop 처리 로직
      if (cropType && CROP_SETTINGS[cropType]) {
        const cropConfig = CROP_SETTINGS[cropType];

        // 크롭 영역 계산
        const left = cropConfig.cropLeft || 0;
        const top = cropConfig.cropTop || 0;
        const width = metadata.width - left - (cropConfig.cropRight || 0);
        const height = metadata.height - top - (cropConfig.cropBottom || 0);

        // 크롭 적용
        processedImage = processedImage.extract({
          left: left,
          top: top,
          width: width,
          height: height,
        });

        // 크롭 후 기본 리사이즈 로직도 적용
        if (width > MAX_WIDTH || height > MAX_HEIGHT) {
          processedImage = processedImage.resize({
            width: Math.min(width, MAX_WIDTH),
            height: Math.min(height, MAX_HEIGHT),
            fit: "inside",
            withoutEnlargement: true,
          });
        }
      } else {
        // 기존 리사이즈 로직 (cropType이 null인 경우)
        if (metadata.width > MAX_WIDTH || metadata.height > MAX_HEIGHT) {
          processedImage = processedImage.resize({
            width: Math.min(metadata.width, MAX_WIDTH),
            height: Math.min(metadata.height, MAX_HEIGHT),
            fit: "inside",
            withoutEnlargement: true,
          });
        }
      }

      await processedImage.webp({ quality: 100 }).toFile(filePath);

      // 성공 시 연속 실패 카운터 초기화
      consecutiveFailures = 0;

      // 성공 시 딜레이를 점진적으로 감소
      if (currentDelay > INITIAL_DELAY) {
        currentDelay = Math.max(INITIAL_DELAY, currentDelay * 0.9); // 10%씩 감소
      }

      return `/images/${folderName}/${fileName}`;
    } catch (error) {
      console.error(
        `${client.name} 이미지 다운로드 실패: ${url}`,
        error.message
      );

      // 404인 경우 다른 프록시로 재시도하지 않음
      if (error.response && error.response.status === 404) {
        return 404;
      }

      // 마지막 클라이언트가 아니면 다음 클라이언트로 계속 시도
      if (attempt < clients.length - 1) {
        console.log(`다음 클라이언트로 재시도: ${url}`);
        continue;
      }
    }
  }

  // 모든 클라이언트 실패
  console.error(`모든 클라이언트로 이미지 처리 실패: ${url}`);

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

  return null;
}

// 큐에서 다음 처리할 항목 가져오기 (높은 우선순위부터)
function getNextBatch() {
  for (let priority = 0; priority < PRIORITY_LEVELS; priority++) {
    if (queues[priority].length > 0) {
      return {
        batch: queues[priority].splice(0, CONCURRENT_DOWNLOADS),
        priority,
      };
    }
  }
  return { batch: [], priority: -1 };
}

// 큐가 비어있는지 확인
function isQueuesEmpty() {
  return queues.every((queue) => queue.length === 0);
}

// 큐 프로세서
async function processQueue(folderName) {
  if (isProcessing || processingPaused || isQueuesEmpty()) return;

  isProcessing = true;

  try {
    const { batch, priority } = getNextBatch();

    if (batch.length === 0) {
      isProcessing = false;
      return;
    }

    const limit = pLimit(CONCURRENT_DOWNLOADS);
    const tasks = batch.map((task) =>
      limit(() => processQueueItem(task, folderName, priority))
    );

    await Promise.all(tasks);
  } catch (error) {
    console.error("큐 처리 오류:", error);
  } finally {
    isProcessing = false;

    if (!isQueuesEmpty() && !processingPaused) {
      setTimeout(() => processQueue(folderName), 100);
    }
  }
}

// 개별 큐 항목 처리
async function processQueueItem(task, folderName, priority) {
  const { url, resolve, attempt = 0, cropType } = task;

  // 최대 재시도 횟수에 도달했으면 종료
  if (attempt >= MAX_RETRIES) {
    resolve(null);
    return;
  }

  // 이미지 다운로드 시도
  const result = await downloadAndSaveImage(url, folderName, cropType);

  // 결과 처리
  if (typeof result === "string") {
    // 성공적으로 이미지 다운로드
    resolve(result);
  } else if (result === 404) {
    // 404 오류는 딱 한 번만 재시도
    if (attempt === 0) {
      queues[priority].push({ url, resolve, attempt: 1, cropType });
    } else {
      resolve(null);
    }
  } else {
    // 그 외 오류는 계속 재시도
    if (attempt < MAX_RETRIES - 1) {
      queues[priority].push({ url, resolve, attempt: attempt + 1, cropType });
    } else {
      resolve(null);
    }
  }
}

// 큐에 항목 추가 (우선순위 지정)
function enqueueImage(url, folderName, priority = 2, cropType = null) {
  // 유효한 우선순위 범위로 조정 (1부터 PRIORITY_LEVELS까지)
  const validPriority = Math.max(1, Math.min(PRIORITY_LEVELS, priority)) - 1;

  return new Promise((resolve) => {
    queues[validPriority].push({ url, resolve, cropType });

    if (!isProcessing && !processingPaused) {
      processQueue(folderName);
    }
  });
}

// 공개 인터페이스
async function processImagesInChunks(
  items,
  folderName = "products",
  priority = 2,
  cropType = null
) {
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
        enqueueImage(item.image, folderName, priority, cropType).then(
          (savedPath) => {
            if (savedPath) item.image = savedPath;
          }
        )
      );
    }

    if (item.additional_images) {
      try {
        const additionalImages = JSON.parse(item.additional_images);
        const savedImages = [];

        additionalImages.forEach((imgUrl) => {
          tasks.push(
            enqueueImage(imgUrl, folderName, priority, cropType).then(
              (savedPath) => {
                if (savedPath) savedImages.push(savedPath);
              }
            )
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
    const queueSizes = queues
      .map((q, i) => `P${i + 1}: ${q.length}`)
      .join(", ");

    console.log(
      `다운로드 진행률: ${completed} / ${total} (${Math.round(
        (completed / total) * 100
      )}%), 큐 길이: [${queueSizes}], 폴더: ${folderName}, 우선순위: ${priority}${
        cropType ? `, 크롭: ${cropType}` : ""
      }`
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
    `이미지 처리 완료: ${
      processedItems.length
    } 항목 성공, 폴더: ${folderName}, 우선순위: ${priority}${
      cropType ? `, 크롭: ${cropType}` : ""
    }`
  );

  return [...processedItems, ...itemsWithoutImages];
}

// 큐 상태 초기화 함수
function resetQueue() {
  queues.forEach((queue) => (queue.length = 0));
  isProcessing = false;
  currentDelay = INITIAL_DELAY;
  consecutiveFailures = 0;
  processingPaused = false;
}

// 큐 상태 조회 함수
function getQueueStatus() {
  return {
    queues: queues.map((queue, index) => ({
      priority: index + 1,
      length: queue.length,
    })),
    isProcessing,
    currentDelay,
    consecutiveFailures,
    processingPaused,
  };
}

module.exports = {
  processImagesInChunks,
  resetQueue,
  getQueueStatus,
  enqueueImage,
};
