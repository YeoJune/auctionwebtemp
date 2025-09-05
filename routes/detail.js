// routes/detail.js
const express = require("express");
const router = express.Router();
const { processItem } = require("../utils/processItem"); // 경로는 실제 위치에 맞게 조정하세요

// 소켓 기반 상세 정보 요청 처리
router.post("/item-details/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const userId = req.session?.user?.id;
    const socketId = req.body.socketId; // 클라이언트에서 소켓 ID 전송

    // 소켓이 활성화된 경우 (realtime 기능)
    if (socketId && req.app.get("io")) {
      const io = req.app.get("io");

      // 1단계: 기본 정보 즉시 조회하여 소켓으로 전송
      const basicItem = await getBasicItemInfo(itemId, false, userId);
      if (basicItem) {
        io.to(socketId).emit("item-detail-basic", {
          itemId,
          item: basicItem,
        });
      }

      // 2단계: 백그라운드에서 전체 처리 (이미지 포함)
      processItemWithSocket(itemId, false, userId, socketId, io).catch(
        (error) => {
          console.error("Background processing error:", error);
          io.to(socketId).emit("item-detail-complete", { itemId, error: true });
        }
      );

      // 즉시 응답 (처리 중 상태)
      return res.json({ success: true, processing: true });
    }

    // 기존 방식 (소켓 없는 경우)
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

    // 소켓이 활성화된 경우
    if (socketId && req.app.get("io")) {
      const io = req.app.get("io");

      // 1단계: 기본 정보 즉시 조회하여 소켓으로 전송
      const basicItem = await getBasicItemInfo(itemId, true, userId);
      if (basicItem) {
        io.to(socketId).emit("item-detail-basic", {
          itemId,
          item: basicItem,
        });
      }

      // 2단계: 백그라운드에서 전체 처리
      processItemWithSocket(itemId, true, userId, socketId, io).catch(
        (error) => {
          console.error("Background processing error:", error);
          io.to(socketId).emit("item-detail-complete", { itemId, error: true });
        }
      );

      return res.json({ success: true, processing: true });
    }

    // 기존 방식
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

// 기본 정보만 빠르게 조회하는 함수
async function getBasicItemInfo(itemId, isValue, userId) {
  try {
    const { pool } = require("../utils/DB");
    const tableName = isValue ? "values_items" : "crawled_items";

    const [items] = await pool.query(
      `SELECT * FROM ${tableName} WHERE item_id = ?`,
      [itemId]
    );

    if (items.length === 0) return null;

    let item = items[0];

    // 사용자 입찰 정보 추가 (필요한 경우)
    if (userId && !isValue) {
      const userBids = await getUserBids(userId, itemId);
      item.bids = userBids;
    }

    return item;
  } catch (error) {
    console.error("Error getting basic item info:", error);
    return null;
  }
}

// 소켓과 함께 아이템 처리
async function processItemWithSocket(itemId, isValue, userId, socketId, io) {
  try {
    // 전체 처리 수행 (processItem을 returnData=true로 호출)
    const fullItem = await processItem(itemId, isValue, null, true, userId, 1);

    if (fullItem && fullItem.images && fullItem.images.length > 0) {
      // 이미지 처리 완료 알림
      io.to(socketId).emit("item-detail-images", {
        itemId,
        item: fullItem,
      });
    }

    // 전체 처리 완료 알림
    io.to(socketId).emit("item-detail-complete", {
      itemId,
      item: fullItem,
    });
  } catch (error) {
    console.error("Error in processItemWithSocket:", error);
    io.to(socketId).emit("item-detail-complete", {
      itemId,
      error: true,
      message: error.message,
    });
  }
}

// 사용자 입찰 정보 조회
async function getUserBids(userId, itemId) {
  try {
    const { pool } = require("../utils/DB");
    let userBids = { live: null, direct: null };

    // Live bid 조회
    const [liveBids] = await pool.query(
      `SELECT 'live' as bid_type, id, item_id, first_price, second_price, final_price, status
       FROM live_bids WHERE user_id = ? AND item_id = ? LIMIT 1`,
      [userId, itemId]
    );
    if (liveBids.length > 0) {
      userBids.live = liveBids[0];
    }

    // Direct bid 조회
    const [directBids] = await pool.query(
      `SELECT 'direct' as bid_type, id, item_id, current_price, status
       FROM direct_bids WHERE user_id = ? AND item_id = ? LIMIT 1`,
      [userId, itemId]
    );
    if (directBids.length > 0) {
      userBids.direct = directBids[0];
    }

    return userBids;
  } catch (error) {
    console.error("Error getting user bids:", error);
    return { live: null, direct: null };
  }
}

module.exports = router;
