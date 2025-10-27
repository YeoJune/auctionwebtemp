// routes/detail.js
const express = require("express");
const router = express.Router();
const { processItem } = require("../utils/processItem"); // 경로는 실제 위치에 맞게 조정하세요

// 일반 아이템 상세 정보 요청 처리
router.post("/item-details/:itemId", async (req, res) => {
  // async 추가
  try {
    const { itemId } = req.params;
    const { aucNum } = req.body;
    // 세션에서 사용자 ID 가져오기 (로그인하지 않았으면 undefined)
    const userId = req.session?.user?.id; // 옵셔널 체이닝 사용

    // processItem 호출 시 userId와 aucNum 전달
    // processItem 내부에서 응답을 처리하므로 await만 사용
    await processItem(itemId, false, res, false, userId, 1, aucNum);
  } catch (error) {
    // 혹시 processItem 호출 전에 에러가 발생할 경우 대비
    console.error("Error in /item-details/:itemId route:", error);
    if (!res.headersSent) {
      // 응답이 아직 전송되지 않았다면 에러 응답 전송
      res
        .status(500)
        .json({ message: "Error processing item details request" });
    }
  }
});

// 가치평가 아이템 상세 정보 요청 처리
router.post("/value-details/:itemId", async (req, res) => {
  // async 추가
  try {
    const { itemId } = req.params;
    // 세션에서 사용자 ID 가져오기 (로그인하지 않았으면 undefined)
    const userId = req.session?.user?.id; // 옵셔널 체이닝 사용

    // processItem 호출 시 userId 전달
    await processItem(itemId, true, res, false, userId, 1);
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
