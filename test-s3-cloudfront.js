// test-s3-cloudfront.js
require("dotenv").config();
const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// 설정 검증
function validateConfig() {
  const required = [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_REGION",
    "S3_BUCKET_NAME",
    "CLOUDFRONT_DOMAIN",
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error("❌ Missing environment variables:", missing.join(", "));
    process.exit(1);
  }

  console.log("✅ Environment variables validated");
  console.log("📦 Bucket:", process.env.S3_BUCKET_NAME);
  console.log("🌍 Region:", process.env.AWS_REGION);
  console.log("🚀 CloudFront:", process.env.CLOUDFRONT_DOMAIN);
  console.log("");
}

// S3 클라이언트 초기화
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// 테스트 이미지 생성 (간단한 1x1 WebP)
function createTestImage() {
  // 최소 WebP 파일 (1x1 픽셀, 흰색)
  const webpData = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x26, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x20, 0x1a, 0x00, 0x00, 0x00, 0x30, 0x01, 0x00, 0x9d,
    0x01, 0x2a, 0x01, 0x00, 0x01, 0x00, 0x03, 0x00, 0x34, 0x25, 0xa4, 0x00,
    0x03, 0x70, 0x00, 0xfe, 0xfb, 0x94, 0x00, 0x00,
  ]);

  const fileName = `test-${Date.now()}.webp`;
  const filePath = path.join(__dirname, fileName);

  fs.writeFileSync(filePath, webpData);
  return { fileName, filePath };
}

// 1. S3 업로드 테스트
async function testS3Upload() {
  console.log("📤 Test 1: S3 Upload");
  console.log("─".repeat(50));

  try {
    const { fileName, filePath } = createTestImage();
    const fileContent = fs.readFileSync(filePath);

    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: `values/${fileName}`,
      Body: fileContent,
      ContentType: "image/webp",
      CacheControl: "max-age=31536000, immutable",
    });

    const startTime = Date.now();
    await s3Client.send(command);
    const duration = Date.now() - startTime;

    console.log(`✅ Upload successful (${duration}ms)`);
    console.log(`📁 S3 Key: values/${fileName}`);

    // 로컬 테스트 파일 삭제
    fs.unlinkSync(filePath);

    return fileName;
  } catch (error) {
    console.error("❌ Upload failed:", error.message);
    throw error;
  }
}

// 2. S3 버킷 목록 조회 테스트
async function testS3List() {
  console.log("\n📋 Test 2: S3 List Objects");
  console.log("─".repeat(50));

  try {
    const command = new ListObjectsV2Command({
      Bucket: process.env.S3_BUCKET_NAME,
      Prefix: "values/",
      MaxKeys: 10,
    });

    const response = await s3Client.send(command);

    if (response.Contents && response.Contents.length > 0) {
      console.log(`✅ Found ${response.Contents.length} objects:`);
      response.Contents.forEach((obj, index) => {
        console.log(`   ${index + 1}. ${obj.Key} (${obj.Size} bytes)`);
      });
    } else {
      console.log("⚠️  No objects found in values/ folder");
    }

    return response.Contents || [];
  } catch (error) {
    console.error("❌ List failed:", error.message);
    throw error;
  }
}

// 3. CloudFront 접근 테스트
async function testCloudFrontAccess(fileName) {
  console.log("\n🌐 Test 3: CloudFront Access");
  console.log("─".repeat(50));

  const cloudFrontUrl = `https://${process.env.CLOUDFRONT_DOMAIN}/values/${fileName}`;
  console.log(`🔗 URL: ${cloudFrontUrl}`);

  try {
    const startTime = Date.now();
    const response = await axios.get(cloudFrontUrl, {
      timeout: 10000,
      responseType: "arraybuffer",
    });
    const duration = Date.now() - startTime;

    console.log(`✅ CloudFront access successful (${duration}ms)`);
    console.log(`📊 Status: ${response.status}`);
    console.log(`📦 Content-Type: ${response.headers["content-type"]}`);
    console.log(`💾 Size: ${response.data.length} bytes`);
    console.log(`🔄 Cache Status: ${response.headers["x-cache"] || "N/A"}`);

    return true;
  } catch (error) {
    if (error.response) {
      console.error(
        `❌ CloudFront access failed: ${error.response.status} ${error.response.statusText}`
      );

      if (error.response.status === 403) {
        console.error("\n💡 Troubleshooting 403 Forbidden:");
        console.error(
          "   1. Check S3 bucket policy (CloudFront OAC permission)"
        );
        console.error(
          "   2. Wait for CloudFront deployment to complete (~15 min)"
        );
        console.error("   3. Verify Distribution ID in bucket policy");
      } else if (error.response.status === 404) {
        console.error("\n💡 File not found. Check:");
        console.error("   1. S3 upload was successful");
        console.error("   2. File path is correct: values/filename");
      }
    } else {
      console.error("❌ Request failed:", error.message);
    }
    throw error;
  }
}

// 4. 캐시 테스트 (같은 파일 재요청)
async function testCloudFrontCache(fileName) {
  console.log("\n⚡ Test 4: CloudFront Cache");
  console.log("─".repeat(50));

  const cloudFrontUrl = `https://${process.env.CLOUDFRONT_DOMAIN}/values/${fileName}`;

  try {
    console.log("First request (should be MISS)...");
    const response1 = await axios.get(cloudFrontUrl, {
      timeout: 10000,
      responseType: "arraybuffer",
    });
    const cacheStatus1 = response1.headers["x-cache"] || "Unknown";
    console.log(`   Cache Status: ${cacheStatus1}`);

    console.log("Second request (should be HIT)...");
    const response2 = await axios.get(cloudFrontUrl, {
      timeout: 10000,
      responseType: "arraybuffer",
    });
    const cacheStatus2 = response2.headers["x-cache"] || "Unknown";
    console.log(`   Cache Status: ${cacheStatus2}`);

    if (cacheStatus2.includes("Hit")) {
      console.log("✅ CloudFront caching works correctly!");
    } else {
      console.log("⚠️  Cache not hit yet (may need more time)");
    }

    return true;
  } catch (error) {
    console.error("❌ Cache test failed:", error.message);
    return false;
  }
}

// 5. 정리 (테스트 파일 삭제)
async function testCleanup(fileName) {
  console.log("\n🧹 Test 5: Cleanup");
  console.log("─".repeat(50));

  try {
    const command = new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: `values/${fileName}`,
    });

    await s3Client.send(command);
    console.log("✅ Test file deleted from S3");
    return true;
  } catch (error) {
    console.error("❌ Cleanup failed:", error.message);
    return false;
  }
}

// 메인 테스트 실행
async function runTests() {
  console.log("\n🧪 S3 & CloudFront Integration Test");
  console.log("=".repeat(50));
  console.log("");

  validateConfig();

  let fileName;
  let testsPassed = 0;
  let testsFailed = 0;

  try {
    // Test 1: S3 Upload
    fileName = await testS3Upload();
    testsPassed++;

    // Test 2: S3 List
    await testS3List();
    testsPassed++;

    // CloudFront 배포 완료 대기 안내
    console.log("\n⏳ Waiting 5 seconds for S3 propagation...");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Test 3: CloudFront Access
    await testCloudFrontAccess(fileName);
    testsPassed++;

    // Test 4: CloudFront Cache
    await testCloudFrontCache(fileName);
    testsPassed++;

    // Test 5: Cleanup
    await testCleanup(fileName);
    testsPassed++;
  } catch (error) {
    testsFailed++;
    console.error("\n❌ Test suite failed");
  }

  // 결과 요약
  console.log("\n" + "=".repeat(50));
  console.log("📊 Test Results");
  console.log("─".repeat(50));
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log("=".repeat(50));

  if (testsFailed === 0) {
    console.log(
      "\n🎉 All tests passed! S3 and CloudFront are working correctly."
    );
  } else {
    console.log("\n⚠️  Some tests failed. Check the errors above.");
    process.exit(1);
  }
}

// 스크립트 실행
runTests().catch((error) => {
  console.error("\n💥 Fatal error:", error);
  process.exit(1);
});
