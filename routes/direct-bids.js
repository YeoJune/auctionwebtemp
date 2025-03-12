// routes/direct-bids.js - 직접 경매(고전적인 경매) 라우터
const express = require("express");
const router = express.Router();
const pool = require("../utils/DB");

const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.id === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Access denied. Admin only." });
  }
};

// STATUS -> 'active', 'completed', 'cancelled'
// GET endpoint to retrieve all bids, with optional filtering
router.get("/", async (req, res) => {
  const { status, highestOnly, page = 1, limit = 10, fromDate } = req.query;
  const offset = (page - 1) * limit;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const connection = await pool.getConnection();

  try {
    let mainQuery, countQuery;
    let queryParams = [];

    // 기본 쿼리 준비
    if (highestOnly === "true") {
      // 각 아이템별로 가장 높은 입찰가만 가져오기
      countQuery = `
        SELECT COUNT(*) as total
        FROM direct_bids d
        INNER JOIN (
          SELECT item_id, MAX(current_price) as max_price
          FROM direct_bids
          WHERE status = 'active'
          GROUP BY item_id
        ) m ON d.item_id = m.item_id AND d.current_price = m.max_price
        WHERE 1=1
      `;

      mainQuery = `
        SELECT 
          d.id, d.item_id, d.user_id, d.current_price, d.status, d.created_at, d.updated_at,
          i.item_id, i.original_title, i.auc_num, i.category, i.brand, i.rank,
          i.starting_price, i.scheduled_date, i.image
        FROM direct_bids d
        INNER JOIN (
          SELECT item_id, MAX(current_price) as max_price
          FROM direct_bids
          WHERE status = 'active'
          GROUP BY item_id
        ) m ON d.item_id = m.item_id AND d.current_price = m.max_price
        LEFT JOIN crawled_items i ON d.item_id = i.item_id
        WHERE 1=1
      `;
    } else {
      // 모든 입찰 가져오기
      countQuery = `
        SELECT COUNT(*) as total 
        FROM direct_bids d
        WHERE 1=1
      `;

      mainQuery = `
        SELECT 
          d.id, d.item_id, d.user_id, d.current_price, d.status, d.created_at, d.updated_at,
          i.item_id, i.original_title, i.auc_num, i.category, i.brand, i.rank,
          i.starting_price, i.scheduled_date, i.image
        FROM direct_bids d
        LEFT JOIN crawled_items i ON d.item_id = i.item_id
        WHERE 1=1
      `;
    }

    // 상태 필터 추가
    if (status) {
      // 콤마로 구분된 상태 값 처리
      const statusArray = status.split(",");

      if (statusArray.length === 1) {
        // 단일 상태
        countQuery += " AND d.status = ?";
        mainQuery += " AND d.status = ?";
        queryParams.push(status);
      } else {
        // 복수 상태
        const placeholders = statusArray.map(() => "?").join(",");
        countQuery += ` AND d.status IN (${placeholders})`;
        mainQuery += ` AND d.status IN (${placeholders})`;
        queryParams.push(...statusArray);
      }
    }

    // 날짜 필터 추가
    if (fromDate) {
      countQuery += " AND d.updated_at >= ?";
      mainQuery += " AND d.updated_at >= ?";
      queryParams.push(fromDate);
    }

    // 일반 사용자는 자신의 입찰만 볼 수 있고, 관리자는 모든 입찰을 볼 수 있음
    if (req.session.user.id !== "admin") {
      countQuery += " AND d.user_id = ?";
      mainQuery += " AND d.user_id = ?";
      queryParams.push(req.session.user.id);
    }

    // 최신순으로 정렬
    mainQuery += " ORDER BY d.updated_at DESC";

    // 페이지네이션 추가
    mainQuery += " LIMIT ? OFFSET ?";
    const mainQueryParams = [...queryParams, parseInt(limit), parseInt(offset)];

    // 총 개수 가져오기
    const [countResult] = await connection.query(countQuery, queryParams);
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    // 데이터 쿼리 실행
    const [rows] = await connection.query(mainQuery, mainQueryParams);

    // Format result to match expected structure
    const bidsWithItems = rows.map((row) => {
      const bid = {
        id: row.id,
        item_id: row.item_id,
        user_id: row.user_id,
        current_price: row.current_price,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };

      // Only include item if it exists
      let item = null;
      if (row.item_id) {
        item = {
          item_id: row.item_id,
          original_title: row.original_title,
          auc_num: row.auc_num,
          category: row.category,
          brand: row.brand,
          rank: row.rank,
          starting_price: row.starting_price,
          scheduled_date: row.scheduled_date,
          image: row.image,
        };
      }

      return {
        ...bid,
        item: item,
      };
    });

    res.status(200).json({
      count: bidsWithItems.length,
      total: total,
      totalPages: totalPages,
      currentPage: parseInt(page),
      bids: bidsWithItems,
    });
  } catch (err) {
    console.error("Error retrieving bids:", err);
    res.status(500).json({ message: "Error retrieving bids" });
  } finally {
    connection.release();
  }
});

// GET endpoint to retrieve a specific bid by ID
router.get("/:id", async (req, res) => {
  const { id } = req.params;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;

  const connection = await pool.getConnection();

  try {
    // 입찰 정보 가져오기
    const [bids] = await connection.query(
      "SELECT * FROM direct_bids WHERE id = ?",
      [id]
    );

    if (bids.length === 0) {
      return res.status(404).json({ message: "Bid not found" });
    }

    const bid = bids[0];

    // 인증 확인 - 관리자 또는 입찰 소유자만 볼 수 있음
    if (userId !== "admin" && bid.user_id !== userId) {
      return res
        .status(403)
        .json({ message: "Not authorized to view this bid" });
    }

    // 아이템 정보 가져오기
    const [items] = await connection.query(
      "SELECT * FROM crawled_items WHERE item_id = ?",
      [bid.item_id]
    );

    const bidWithItem = {
      ...bid,
      item: items.length > 0 ? items[0] : null,
    };

    res.status(200).json(bidWithItem);
  } catch (err) {
    console.error("Error retrieving bid:", err);
    res.status(500).json({ message: "Error retrieving bid" });
  } finally {
    connection.release();
  }
});

// 사용자의 입찰 (자동 생성/업데이트)
router.post("/", async (req, res) => {
  const { itemId, currentPrice } = req.body;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;

  if (!itemId || !currentPrice) {
    return res.status(400).json({ message: "Item ID and price are required" });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. 아이템 정보 확인
    const [items] = await connection.query(
      "SELECT * FROM crawled_items WHERE item_id = ?",
      [itemId]
    );

    if (items.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Item not found" });
    }

    // 2. 아이템에 대한 현재 사용자의 액티브 입찰 찾기
    const [userBids] = await connection.query(
      "SELECT * FROM direct_bids WHERE item_id = ? AND user_id = ? AND status = 'active'",
      [itemId, userId]
    );

    // 3. 아이템에 대한 최고 입찰가 찾기
    const [highestBids] = await connection.query(
      "SELECT * FROM direct_bids WHERE item_id = ? AND status = 'active' ORDER BY current_price DESC LIMIT 1",
      [itemId]
    );

    const highestBid = highestBids.length > 0 ? highestBids[0] : null;

    // 4. 최고 입찰가 확인 및 검증
    if (
      highestBid &&
      parseFloat(currentPrice) <= parseFloat(highestBid.current_price)
    ) {
      await connection.rollback();
      return res.status(400).json({
        message: `Your bid must be higher than the current highest bid (${highestBid.current_price})`,
      });
    }

    let bidId;

    // 5. 사용자의 기존 입찰이 있으면 업데이트, 없으면 생성
    if (userBids.length > 0) {
      // 5a. 기존 입찰 업데이트
      await connection.query(
        "UPDATE direct_bids SET current_price = ? WHERE id = ?",
        [currentPrice, userBids[0].id]
      );
      bidId = userBids[0].id;
    } else {
      // 5b. 새 입찰 생성
      const [result] = await connection.query(
        "INSERT INTO direct_bids (user_id, item_id, current_price, status) VALUES (?, ?, ?, 'active')",
        [userId, itemId, currentPrice]
      );
      bidId = result.insertId;
    }

    // 6. 가격이 낮은 다른 입찰들을 취소
    if (highestBid && highestBid.user_id !== userId) {
      await connection.query(
        "UPDATE direct_bids SET status = 'cancelled' WHERE item_id = ? AND current_price < ? AND status = 'active'",
        [itemId, currentPrice]
      );
    }

    await connection.commit();

    res.status(201).json({
      message: "Bid placed successfully",
      bidId: bidId,
      status: "active",
      currentPrice,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error placing bid:", err);
    res.status(500).json({ message: "Error placing bid" });
  } finally {
    connection.release();
  }
});

// 관리자의 낙찰 완료 처리
router.put("/:id/complete", isAdmin, async (req, res) => {
  const { id } = req.params;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 입찰 정보 확인
    const [bids] = await connection.query(
      "SELECT * FROM direct_bids WHERE id = ?",
      [id]
    );

    if (bids.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Bid not found" });
    }

    const bid = bids[0];

    if (bid.status !== "active") {
      await connection.rollback();
      return res.status(400).json({ message: "Bid is not active" });
    }

    // 같은 아이템에 대한 다른 입찰들도 취소
    await connection.query(
      "UPDATE direct_bids SET status = 'cancelled' WHERE item_id = ? AND id != ? AND status = 'active'",
      [bid.item_id, id]
    );

    // 낙찰 완료 처리
    await connection.query(
      "UPDATE direct_bids SET status = 'completed' WHERE id = ?",
      [id]
    );

    await connection.commit();

    res.status(200).json({
      message: "Bid completed successfully",
      bidId: id,
      status: "completed",
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error completing bid:", err);
    res.status(500).json({ message: "Error completing bid" });
  } finally {
    connection.release();
  }
});

// 관리자의 경매 취소 처리
router.put("/:id/cancel", isAdmin, async (req, res) => {
  const { id } = req.params;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 입찰 정보 확인
    const [bids] = await connection.query(
      "SELECT * FROM direct_bids WHERE id = ?",
      [id]
    );

    if (bids.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Bid not found" });
    }

    const bid = bids[0];

    if (bid.status === "completed") {
      await connection.rollback();
      return res.status(400).json({ message: "Cannot cancel completed bid" });
    }

    // 경매 취소 처리
    await connection.query(
      "UPDATE direct_bids SET status = 'cancelled' WHERE id = ?",
      [id]
    );

    await connection.commit();

    res.status(200).json({
      message: "Bid cancelled successfully",
      bidId: id,
      status: "cancelled",
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error cancelling bid:", err);
    res.status(500).json({ message: "Error cancelling bid" });
  } finally {
    connection.release();
  }
});

module.exports = router;
