// routes/detail-async.js
const express = require("express");
const router = express.Router();
const { processItemAsync } = require("../utils/processItemAsync");

// 2단계 상세 정보 요청 - 1단계: 기본 정보 즉시 반환
router.post("/item-details-fast/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const userId = req.session?.user?.id;

    // 1단계: 기본 정보만 즉시 반환
    const basicInfo = await processItemAsync.getBasicInfo(
      itemId,
      false,
      userId
    );

    if (!basicInfo) {
      return res.status(404).json({ message: "Item not found" });
    }

    res.json({
      ...basicInfo,
      images_loading: !basicInfo.description, // 설명이 없으면 크롤링 필요
      request_id: `${itemId}_${Date.now()}`, // 요청 추적용 ID
    });

    // 2단계: 백그라운드에서 이미지 처리 (필요한 경우에만)
    if (!basicInfo.description) {
      processItemAsync.processImagesAsync(
        itemId,
        false,
        userId,
        req.session?.user?.id
      );
    }
  } catch (error) {
    console.error("Error in /item-details-fast/:itemId route:", error);
    res.status(500).json({ message: "Error processing item details request" });
  }
});

// 이미지 처리 상태 확인
router.get("/item-images-status/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const status = await processItemAsync.getImageProcessingStatus(itemId);
    res.json(status);
  } catch (error) {
    console.error("Error checking image status:", error);
    res.status(500).json({ message: "Error checking image status" });
  }
});

module.exports = router;
