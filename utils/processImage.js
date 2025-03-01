const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");
const path = require("path");

let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

const IMAGE_DIR = path.join(__dirname, "..", "public", "images", "products");

// 이미지 크기 제한
const MAX_WIDTH = 600;
const MAX_HEIGHT = 600;
// 동시 다운로드 최대 수
const CONCURRENT_DOWNLOADS = 200; // 서버 및 네트워크 환경에 맞게 조정

// 청크 분할 함수
const chunk = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
    arr.slice(i * size, i * size + size)
  );

// 공통 Axios 인스턴스 생성
const axiosInstance = axios.create({
  timeout: 10000, // 10초 타임아웃
  responseType: "arraybuffer",
});

async function downloadAndSaveImage(url, retries = 3, delay = 500) {
  const dateString = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .split(".")[0];

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // 타이머 설정으로 너무 오래 걸리는 요청 방지
      const response = await axiosInstance.get(url);

      const fileName = `${dateString}_${uuidv4()}.webp`;
      const filePath = path.join(IMAGE_DIR, fileName);

      // 이미지 처리 파이프라인 최적화
      const metadata = await sharp(response.data).metadata();

      let processedImage = sharp(response.data);

      // 필요한 경우만 리사이징 수행
      if (metadata.width > MAX_WIDTH || metadata.height > MAX_HEIGHT) {
        processedImage = processedImage.resize({
          width: Math.min(metadata.width, MAX_WIDTH),
          height: Math.min(metadata.height, MAX_HEIGHT),
          fit: "inside",
          withoutEnlargement: true,
        });
      }

      // 이미지 저장 - 비동기 처리 유지
      await processedImage.webp({ quality: 70 }).toFile(filePath);

      return `/images/products/${fileName}`;
    } catch (error) {
      console.error(
        `이미지 처리 오류 (시도 ${attempt + 1}/${retries}): ${url}`,
        error.message
      );

      if (attempt < retries - 1) {
        // 403 에러 시 더 긴 대기 시간 적용, 그 외에는 짧은 지연
        const waitTime =
          error.response && error.response.status === 403
            ? 30 * 1000 // 30초로 감소 (기존 2분)
            : delay * (attempt + 1); // 재시도마다 지연 시간 증가

        await new Promise((resolve) => setTimeout(resolve, waitTime));
      } else {
        return null;
      }
    }
  }
  return null;
}

async function processImagesInChunks(items, chunkSize = 200) {
  // 청크 크기 증가
  // 이미지가 있는 항목과 없는 항목 분리
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

  // p-limit을 사용하여 동시 다운로드 제한
  const limit = pLimit(CONCURRENT_DOWNLOADS);

  const processItem = async (item) => {
    const downloadTasks = [];

    if (item.image) {
      downloadTasks.push(
        limit(() =>
          downloadAndSaveImage(item.image).then((savedPath) => {
            if (savedPath) item.image = savedPath;
          })
        )
      );
    }

    if (item.additional_images) {
      try {
        const additionalImages = JSON.parse(item.additional_images);
        const savedImages = [];

        // 각 추가 이미지에 대한 다운로드 작업 생성
        additionalImages.forEach((imgUrl) => {
          downloadTasks.push(
            limit(() =>
              downloadAndSaveImage(imgUrl).then((savedPath) => {
                if (savedPath) savedImages.push(savedPath);
              })
            )
          );
        });

        await Promise.all(downloadTasks);
        item.additional_images = JSON.stringify(savedImages);
      } catch (err) {
        console.error("추가 이미지 처리 오류:", err);
        // 기존 값 유지
      }
    } else {
      await Promise.all(downloadTasks);
    }

    return item;
  };

  // 모든 항목을 병렬로 처리 (p-limit이 동시성 제한)
  const promises = itemsWithImages.map(processItem);

  // 진행 상황 모니터링
  let completed = 0;
  const total = promises.length;
  const logInterval = setInterval(() => {
    console.log(
      `다운로드 진행률: ${completed} / ${total} (${Math.round(
        (completed / total) * 100
      )}%)`
    );
  }, 5000); // 5초마다 로그 출력

  // Promise.allSettled를 사용하여 일부 실패해도 계속 진행
  const results = await Promise.allSettled(promises);
  clearInterval(logInterval);

  const processedItems = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);

  console.log(`이미지 처리 완료: ${processedItems.length} 항목 성공`);

  return [...processedItems, ...itemsWithoutImages];
}

module.exports = { processImagesInChunks };
