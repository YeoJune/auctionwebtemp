const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const path = require('path');

// 이미지 저장 경로 설정
const IMAGE_DIR = path.join(__dirname, '..', 'public', 'images', 'products');

const chunk = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
    arr.slice(i * size, i * size + size)
  );
async function downloadAndSaveImage(url, retries = 5, delay = 2 * 60 * 1000) {
for (let attempt = 0; attempt < retries; attempt++) {
  try {
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'arraybuffer'
    });

    const fileName = `${uuidv4()}.jpg`;
    const filePath = path.join(IMAGE_DIR, fileName);

    await sharp(response.data)
      .jpeg({ quality: 100 })
      .toFile(filePath);

    return `/images/products/${fileName}`;
    } catch (error) {
    console.error(`Error processing image (Attempt ${attempt + 1}/${retries}): ${url}`, error.message);
    if (attempt < retries - 1) {
      console.log(`Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    } else {
      return null;
    }
  }
}
console.error(`Failed to download image after ${retries} attempts: ${url}`);
return null;
}
async function processImagesInChunks(items, chunkSize = 100) {
  // 아이템 분류
  const itemsWithImages = [];
  const itemsWithoutImages = [];

  items.forEach(item => {
    if (item.image || (item.additional_images && JSON.parse(item.additional_images).length > 0)) {
      itemsWithImages.push(item);
    } else {
      itemsWithoutImages.push(item);
    }
  });

  const processChunk = async (chunk) => {
    return Promise.all(chunk.map(async (item) => {
    const downloadTasks = [];

    if (item.image) {
      downloadTasks.push(
      downloadAndSaveImage(item.image)
        .then(savedPath => {
        if (savedPath) item.image = savedPath;
        })
      );
    }
    
    if (item.additional_images) {
      const additionalImages = JSON.parse(item.additional_images);
      const savedImages = [];
      
      additionalImages.forEach(imgUrl => {
        downloadTasks.push(
          downloadAndSaveImage(imgUrl)
          .then(savedPath => {
              if (savedPath) savedImages.push(savedPath);
          })
        );
      });

      await Promise.all(downloadTasks);
      item.additional_images = JSON.stringify(savedImages);
    } else {
      await Promise.all(downloadTasks);
    }

    return item;
    }));
  };

  const chunks = chunk(itemsWithImages, chunkSize);
  const processedItems = [];
  let i = 0;
  for (const chunkItems of chunks) {
    const processedChunk = await processChunk(chunkItems);
    processedItems.push(...processedChunk);
    
    // 가비지 컬렉션을 위한 짧은 지연
    await new Promise(resolve => setTimeout(resolve, 100));
    if (i % 10 == 0) console.log(`${i / 10} / ${chunks.length / 10}`);
    i += 1;
  }

  // 처리된 아이템과 이미지가 없는 아이템을 합쳐서 반환
  return [...processedItems, ...itemsWithoutImages];
}

module.exports = {processImagesInChunks};