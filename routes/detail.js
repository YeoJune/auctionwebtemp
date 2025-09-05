// routes/detail.js
const express = require("express");
const router = express.Router();
const { processItem } = require("../utils/processItem"); // 경로는 실제 위치에 맞게 조정하세요
const { pool } = require("../utils/DB");

// 일반 아이템 상세 정보 요청 처리
router.post("/item-details/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const userId = req.session?.user?.id;
    const socketId = req.body.socketId;

    // 소켓이 있으면 기본 정보부터 전송
    if (socketId && req.app.get("io")) {
      const io = req.app.get("io");

      // 기본 정보 먼저 전송
      const [items] = await pool.query(
        "SELECT * FROM crawled_items WHERE item_id = ?",
        [itemId]
      );
      if (items.length > 0) {
        io.to(socketId).emit("item-detail-basic", items[0]);
      }
    }

    await processItem(itemId, false, res, false, userId, 1);
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
    const socketId = req.body.socketId;

    // 소켓이 있으면 기본 정보부터 전송
    if (socketId && req.app.get("io")) {
      const io = req.app.get("io");

      // 기본 정보 먼저 전송
      const [items] = await pool.query(
        "SELECT * FROM values_items WHERE item_id = ?",
        [itemId]
      );
      if (items.length > 0) {
        io.to(socketId).emit("item-detail-basic", items[0]);
      }
    }

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
