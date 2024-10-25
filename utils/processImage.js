// utils/processImages.js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const path = require('path');

const IMAGE_DIR = path.join(__dirname, '..', 'public', 'images', 'products');

const chunk = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
    arr.slice(i * size, i * size + size)
  );

async function downloadAndSaveImage(url, retries = 5, delay = 2 * 60 * 1000) {
  const dateString = new Date().toISOString().replaceAll(':', '-').split('.')[0];
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await axios({
        method: 'get',
        url: url,
        responseType: 'arraybuffer'
      });

      const fileName = `${dateString}_${uuidv4()}.webp`;
      const filePath = path.join(IMAGE_DIR, fileName);

      await sharp(response.data)
        .webp({ quality: 70 })
        .toFile(filePath);

      return `/images/products/${fileName}`;
    } catch (error) {
      console.error(`Error processing image (Attempt ${attempt + 1}/${retries}): ${url}`, error.message);
      
      if (error.response && error.response.status != 403) {
        console.log(`error encountered. Stopping retry attempts.`);
        return null;
      }

      if (attempt < retries - 1) {
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        return null;
      }
    }
  }
  return null;
}

async function processImagesInChunks(items, chunkSize = 100) {
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
    
    await new Promise(resolve => setTimeout(resolve, 100));
    if (i % 10 == 0) console.log(`Downloading progress: ${i} / ${chunks.length}`);
    i += 1;
  }

  return [...processedItems, ...itemsWithoutImages];
}

module.exports = { processImagesInChunks };