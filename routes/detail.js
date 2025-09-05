// routes/detail.js
const express = require("express");
const router = express.Router();
const { processItem } = require("../utils/processItem"); // 경로는 실제 위치에 맞게 조정하세요

// 일반 아이템 상세 정보 요청 처리
router.post("/item-details/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const userId = req.session?.user?.id;

    await processItem(itemId, false, res, false, userId, 1, req);
  } catch (error) {
    console.error("Error in /item-details/:itemId route:", error);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ message: "Error processing item details request" });
    }
  }
});

// 가치평가 아이템 상세 정보 요청 처리
router.post("/value-details/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const userId = req.session?.user?.id;

    await processItem(itemId, true, res, false, userId, 1, req);
  } catch (error) {
    console.error("Error in /value-details/:itemId route:", error);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ message: "Error processing value details request" });
    }
  }
});

module.exports = router;
