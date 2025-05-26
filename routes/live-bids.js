// routes/live-bids.js - 현장 경매(1차->2차->최종) 라우터
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

// STATUS -> 'first', 'second', 'final', 'completed', 'cancelled'

// Updated GET endpoint for live-bids.js
router.get("/", async (req, res) => {
  const {
    status,
    page = 1,
    limit = 10,
    fromDate,
    toDate,
    sortBy = "updated_at",
    sortOrder = "desc",
  } = req.query;

  // limit=0일 때는 페이지네이션 적용하지 않음
  const usesPagination = parseInt(limit) !== 0;
  const offset = usesPagination ? (page - 1) * limit : 0;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;

  // Prepare base query
  let queryConditions = ["1=1"];
  let queryParams = [];

  // Add status filter if provided
  if (status) {
    // 콤마로 구분된 상태 값 처리
    const statusArray = status.split(",");

    if (statusArray.length === 1) {
      // 단일 상태
      queryConditions.push("b.status = ?");
      queryParams.push(status);
    } else {
      // 복수 상태
      const placeholders = statusArray.map(() => "?").join(",");
      queryConditions.push(`b.status IN (${placeholders})`);
      queryParams.push(...statusArray);
    }
  }

  // 시작 날짜 필터 추가
  if (fromDate) {
    queryConditions.push("b.updated_at >= ?");
    queryParams.push(fromDate);
  }

  // 종료 날짜 필터 추가
  if (toDate) {
    queryConditions.push("b.updated_at <= ?");
    queryParams.push(toDate);
  }

  // Regular users can only see their own bids, admins can see all
  if (req.session.user.id !== "admin") {
    queryConditions.push("b.user_id = ?");
    queryParams.push(userId);
  }

  const whereClause = queryConditions.join(" AND ");

  // Count query for pagination
  const countQuery = `
    SELECT COUNT(*) as total 
    FROM live_bids b
    WHERE ${whereClause}
  `;

  // Main query with JOIN
  const mainQuery = `
    SELECT 
      b.id, b.item_id, b.user_id, b.first_price, b.second_price, b.final_price, 
      b.status, b.created_at, b.updated_at,
      i.item_id, i.original_title, i.auc_num, i.category, i.brand, i.rank,
      i.starting_price, i.scheduled_date, i.image, i.original_scheduled_date, i.title
    FROM live_bids b
    LEFT JOIN crawled_items i ON b.item_id = i.item_id
    WHERE ${whereClause}
  `;

  // 정렬 설정
  let orderByColumn;
  switch (sortBy) {
    case "original_scheduled_date":
      orderByColumn = "i.original_scheduled_date";
      break;
    case "scheduled_date":
      orderByColumn = "i.scheduled_date";
      break;
    case "original_title":
      orderByColumn = "i.original_title";
      break;
    case "first_price":
      orderByColumn = "b.first_price";
      break;
    case "final_price":
      orderByColumn = "b.final_price";
      break;
    case "created_at":
      orderByColumn = "b.created_at";
      break;
    case "updated_at":
    default:
      orderByColumn = "b.updated_at";
      break;
  }

  // 정렬 방향 설정
  const direction = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

  // 정렬 쿼리 추가
  const orderByClause = ` ORDER BY ${orderByColumn} ${direction}`;

  let finalQuery = mainQuery + orderByClause;
  let finalQueryParams;

  // 페이지네이션 추가 (limit=0이 아닌 경우에만)
  if (usesPagination) {
    const paginationClause = " LIMIT ? OFFSET ?";
    finalQuery += paginationClause;
    finalQueryParams = [...queryParams, parseInt(limit), parseInt(offset)];
  } else {
    finalQueryParams = [...queryParams];
  }

  const connection = await pool.getConnection();

  try {
    // Get total count
    const [countResult] = await connection.query(countQuery, queryParams);
    const total = countResult[0].total;
    const totalPages = usesPagination ? Math.ceil(total / limit) : 1;

    // Get bids with item details in a single query
    const [rows] = await connection.query(finalQuery, finalQueryParams);

    // Format result to match expected structure
    const bidsWithItems = rows.map((row) => {
      const bid = {
        id: row.id,
        item_id: row.item_id,
        user_id: row.user_id,
        first_price: row.first_price,
        second_price: row.second_price,
        final_price: row.final_price,
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
          title: row.title,
          auc_num: row.auc_num,
          category: row.category,
          brand: row.brand,
          rank: row.rank,
          starting_price: row.starting_price,
          scheduled_date: row.scheduled_date,
          original_scheduled_date: row.original_scheduled_date,
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
    // Get bid
    const [bids] = await connection.query(
      "SELECT * FROM live_bids WHERE id = ?",
      [id]
    );

    if (bids.length === 0) {
      return res.status(404).json({ message: "Bid not found" });
    }

    const bid = bids[0];

    // Check authorization - only admin or bid owner can view
    if (userId !== "admin" && bid.user_id !== userId) {
      return res
        .status(403)
        .json({ message: "Not authorized to view this bid" });
    }

    // Get item details
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

// 고객의 1차 입찰 제출
router.post("/", async (req, res) => {
  const { itemId, firstPrice } = req.body;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;

  if (!itemId || !firstPrice) {
    return res
      .status(400)
      .json({ message: "Item ID and first price are required" });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 이미 입찰한 내역이 있는지 체크
    const [existingBids] = await connection.query(
      "SELECT * FROM live_bids WHERE item_id = ? AND user_id = ?",
      [itemId, userId]
    );

    if (existingBids.length > 0) {
      await connection.rollback();
      return res
        .status(400)
        .json({ message: "You already have a bid for this item" });
    }

    // 상품 정보 체크
    const [items] = await connection.query(
      "SELECT * FROM crawled_items WHERE item_id = ?",
      [itemId]
    );

    if (items.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Item not found" });
    }

    // 새 입찰 생성
    const [result] = await connection.query(
      'INSERT INTO live_bids (item_id, user_id, first_price, status) VALUES (?, ?, ?, "first")',
      [itemId, userId, firstPrice]
    );

    await connection.commit();

    res.status(201).json({
      message: "First bid submitted successfully",
      bidId: result.insertId,
      status: "first",
      firstPrice,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error submitting first bid:", err);
    res.status(500).json({ message: "Error submitting bid" });
  } finally {
    connection.release();
  }
});

// 관리자의 2차 입찰가 제안
router.put("/:id/second", isAdmin, async (req, res) => {
  const { id } = req.params;
  const { secondPrice } = req.body;

  if (!secondPrice) {
    return res.status(400).json({ message: "Second price is required" });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 입찰 정보 확인
    const [bids] = await connection.query(
      "SELECT * FROM live_bids WHERE id = ?",
      [id]
    );

    if (bids.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Bid not found" });
    }

    const bid = bids[0];

    if (bid.status !== "first") {
      await connection.rollback();
      return res.status(400).json({ message: "Bid is not in first stage" });
    }

    // 2차 입찰가 업데이트
    await connection.query(
      'UPDATE live_bids SET second_price = ?, status = "second" WHERE id = ?',
      [secondPrice, id]
    );

    await connection.commit();

    res.status(200).json({
      message: "Second price proposed successfully",
      bidId: id,
      status: "second",
      secondPrice,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error proposing second price:", err);
    res.status(500).json({ message: "Error proposing second price" });
  } finally {
    connection.release();
  }
});

// 고객의 최종 입찰가 제출
router.put("/:id/final", async (req, res) => {
  const { id } = req.params;
  const { finalPrice } = req.body;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;

  if (!finalPrice) {
    return res.status(400).json({ message: "Final price is required" });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 입찰 정보 확인
    const [bids] = await connection.query(
      "SELECT * FROM live_bids WHERE id = ?",
      [id]
    );

    if (bids.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Bid not found" });
    }

    const bid = bids[0];

    if (bid.user_id !== userId) {
      await connection.rollback();
      return res
        .status(403)
        .json({ message: "Not authorized to update this bid" });
    }

    if (bid.status !== "second") {
      await connection.rollback();
      return res.status(400).json({ message: "Bid is not in second stage" });
    }

    // 최종 입찰가 업데이트
    await connection.query(
      'UPDATE live_bids SET final_price = ?, status = "final" WHERE id = ?',
      [finalPrice, id]
    );

    await connection.commit();

    res.status(200).json({
      message: "Final price submitted successfully",
      bidId: id,
      status: "final",
      finalPrice,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error submitting final price:", err);
    res.status(500).json({ message: "Error submitting final price" });
  } finally {
    connection.release();
  }
});

// 낙찰 완료 처리 - 단일 또는 다중 처리 지원
router.put("/complete", isAdmin, async (req, res) => {
  const { id, ids, winningPrice } = req.body; // 단일 id 또는 다중 ids 배열 수신

  // id나 ids 중 하나는 필수
  if (!id && (!ids || !Array.isArray(ids) || ids.length === 0)) {
    return res.status(400).json({ message: "Bid ID(s) are required" });
  }

  // 단일 ID를 배열로 변환하여 일관된 처리
  const bidIds = id ? [id] : ids;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 한 번의 쿼리로 여러 입찰 상태를 업데이트
    const placeholders = bidIds.map(() => "?").join(",");

    let updateResult;
    let completedCount = 0;
    let cancelledCount = 0;

    // 낙찰 금액이 있는 경우
    if (winningPrice !== undefined) {
      // winningPrice가 final_price보다 큰 경우 취소, 아닐 경우 완료
      // 취소 처리: winningPrice > final_price
      const [cancelResult] = await connection.query(
        `UPDATE live_bids SET status = 'cancelled' WHERE id IN (${placeholders}) AND status = 'final' AND final_price < ?`,
        [...bidIds, winningPrice]
      );
      cancelledCount = cancelResult.affectedRows;

      // 완료 처리: winningPrice <= final_price
      const [completeResult] = await connection.query(
        `UPDATE live_bids SET status = 'completed', final_price = ? WHERE id IN (${placeholders}) AND status = 'final' AND final_price >= ?`,
        [winningPrice, ...bidIds, winningPrice]
      );
      completedCount = completeResult.affectedRows;

      updateResult = {
        affectedRows: cancelledCount + completedCount,
      };
    } else {
      // 낙찰 금액이 없을 경우 기존 최종 입찰가로 완료 처리
      [updateResult] = await connection.query(
        `UPDATE live_bids SET status = 'completed' WHERE id IN (${placeholders}) AND status = 'final'`,
        bidIds
      );
      completedCount = updateResult.affectedRows;
    }

    await connection.commit();

    // 응답 메시지 구성
    let message;
    if (id) {
      if (winningPrice !== undefined) {
        if (completedCount > 0) {
          message = "Bid completed successfully";
        } else if (cancelledCount > 0) {
          message = "Bid cancelled (winning price exceeds final price)";
        } else {
          message = "No bid found or already processed";
        }
      } else {
        message = "Bid completed successfully";
      }
    } else {
      const messages = [];
      if (completedCount > 0) {
        messages.push(`${completedCount} bid(s) completed`);
      }
      if (cancelledCount > 0) {
        messages.push(
          `${cancelledCount} bid(s) cancelled (winning price exceeds final price)`
        );
      }
      message =
        messages.length > 0
          ? messages.join(", ")
          : "No bids found or already processed";
    }

    res.status(200).json({
      message: message,
      completedCount: completedCount,
      cancelledCount: cancelledCount,
      winningPrice: winningPrice,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error completing bid(s):", err);
    res.status(500).json({ message: "Error completing bid(s)" });
  } finally {
    connection.release();
  }
});

// 낙찰 실패 처리 - 단일 또는 다중 처리 지원
router.put("/cancel", isAdmin, async (req, res) => {
  const { id, ids } = req.body; // 단일 id 또는 다중 ids 배열 수신

  // id나 ids 중 하나는 필수
  if (!id && (!ids || !Array.isArray(ids) || ids.length === 0)) {
    return res.status(400).json({ message: "Bid ID(s) are required" });
  }

  // 단일 ID를 배열로 변환하여 일관된 처리
  const bidIds = id ? [id] : ids;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 한 번의 쿼리로 여러 입찰 상태를 업데이트
    const placeholders = bidIds.map(() => "?").join(",");

    // 완료 상태가 아닌 입찰만 취소 처리
    const [updateResult] = await connection.query(
      `UPDATE live_bids SET status = 'cancelled' WHERE id IN (${placeholders}) AND status != 'completed'`,
      bidIds
    );

    await connection.commit();

    res.status(200).json({
      message: id
        ? "Bid cancelled successfully"
        : `${updateResult.affectedRows} bids cancelled successfully`,
      status: "cancelled",
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error cancelling bid(s):", err);
    res.status(500).json({ message: "Error cancelling bid(s)" });
  } finally {
    connection.release();
  }
});

module.exports = router;
