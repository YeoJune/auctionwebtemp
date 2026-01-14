// routes/live-bids.js - 현장 경매(1차->2차->최종) 라우터
const express = require("express");
const router = express.Router();
const { pool } = require("../utils/DB");
const {
  ecoAucCrawler,
  brandAucCrawler,
  starAucCrawler,
  mekikiAucCrawler,
} = require("../crawlers/index");
const { validateBidByAuction } = require("../utils/submitBid");
const { createOrUpdateSettlement } = require("../utils/settlement");

const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.id === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Access denied. Admin only." });
  }
};

// STATUS -> 'first', 'second', 'final', 'completed', 'cancelled', 'shipped'

// Updated GET endpoint for live-bids.js
router.get("/", async (req, res) => {
  const {
    search,
    status,
    aucNum,
    page = 1,
    limit = 10,
    fromDate,
    toDate,
    sortBy = "original_scheduled_date",
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

  // 검색 조건 추가
  if (search) {
    const searchTerm = `%${search}%`;
    queryConditions.push(
      "(b.item_id LIKE ? OR i.original_title LIKE ? OR i.brand LIKE ? OR i.additional_info LIKE ? OR b.user_id LIKE ?)"
    );
    queryParams.push(
      searchTerm,
      searchTerm,
      searchTerm,
      searchTerm,
      searchTerm
    );
  }

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

  if (aucNum) {
    const aucNumArray = aucNum.split(",");

    if (aucNumArray.length === 1) {
      queryConditions.push("i.auc_num = ?");
      queryParams.push(aucNum);
    } else {
      const placeholders = aucNumArray.map(() => "?").join(",");
      queryConditions.push(`i.auc_num IN (${placeholders})`);
      queryParams.push(...aucNumArray);
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
    LEFT JOIN crawled_items i ON b.item_id = i.item_id
    WHERE ${whereClause}
  `;

  // Main query with JOIN
  const mainQuery = `
    SELECT 
      b.*,
      i.item_id, i.original_title, i.auc_num, i.category, i.brand, i.rank,
      i.starting_price, i.scheduled_date, i.image, i.original_scheduled_date, i.title, i.additional_info,
      u.company_name
    FROM live_bids b
    LEFT JOIN crawled_items i ON b.item_id = i.item_id
    LEFT JOIN users u ON b.user_id = u.id
    WHERE ${whereClause}
  `;

  // 정렬 기준 설정
  let orderByColumn;
  switch (sortBy) {
    case "original_scheduled_date":
      orderByColumn = "i.original_scheduled_date";
      break;
    case "updated_at":
      orderByColumn = "b.updated_at";
      break;
    case "original_title":
      orderByColumn = "i.original_title";
      break;
    default:
      orderByColumn = "i.original_scheduled_date"; // 기본값
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
        company_name: row.company_name,
        first_price: row.first_price,
        second_price: row.second_price,
        final_price: row.final_price,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        completed_at: row.completed_at,
        winning_price: row.winning_price,
        notification_sent_at: row.notification_sent_at,
        appr_id: row.appr_id,
        repair_requested_at: row.repair_requested_at,
        repair_details: row.repair_details,
        repair_fee: row.repair_fee,
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
          additional_info: row.additional_info,
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

// 고객의 1차 입찰 제출
// 1차 입찰 제출 부분 수정 (기존 router.post("/", async (req, res) => { 부분)
router.post("/", async (req, res) => {
  const { itemId, aucNum, firstPrice } = req.body;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;

  if (!itemId || !aucNum || !firstPrice) {
    return res.status(400).json({
      message: "Item ID, auction number, and first price are required",
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 상품 정보 체크 (scheduled_date 포함)
    const [items] = await connection.query(
      "SELECT * FROM crawled_items WHERE item_id = ? AND auc_num = ?",
      [itemId, aucNum]
    );

    if (items.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Item not found" });
    }

    const item = items[0];

    // 1차 입찰 시간 제한 체크: scheduled_date까지만 가능
    const now = new Date();
    const scheduledDate = new Date(item.scheduled_date);

    if (now > scheduledDate) {
      await connection.rollback();
      return res.status(400).json({
        message: "1차 입찰 시간이 종료되었습니다.",
        scheduled_date: item.scheduled_date,
      });
    }

    // 1차 입찰 금액 검증: starting price보다 높아야 함
    if (firstPrice <= item.starting_price) {
      await connection.rollback();
      return res.status(400).json({
        message: `입찰 금액은 시작가보다 높아야 합니다.`,
        starting_price: item.starting_price,
      });
    }

    // 이미 입찰한 내역이 있는지 체크 (FOR UPDATE로 락 걸기)
    const [existingBids] = await connection.query(
      "SELECT * FROM live_bids WHERE item_id = ? AND user_id = ? FOR UPDATE",
      [itemId, userId]
    );

    if (existingBids.length > 0) {
      await connection.rollback();
      return res
        .status(400)
        .json({ message: "You already have a bid for this item" });
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

    // Duplicate entry error check
    if (err.code === "ER_DUP_ENTRY") {
      return res
        .status(400)
        .json({ message: "You already have a bid for this item" });
    }

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

    // 입찰 정보와 상품 정보 함께 확인
    const [bids] = await connection.query(
      `SELECT l.*, i.scheduled_date, i.auc_num, i.additional_info, i.starting_price
       FROM live_bids l 
       JOIN crawled_items i ON l.item_id = i.item_id 
       WHERE l.id = ?`,
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

    // 2차 입찰 시간 제한 체크: scheduled_date가 포함된 날의 저녁 10시까지
    const now = new Date();
    const scheduledDate = new Date(bid.scheduled_date);

    // scheduled_date의 날짜 부분만 가져와서 23:59:59 (저녁 12시)로 설정
    const deadline = new Date(scheduledDate);
    deadline.setHours(23, 59, 59, 999); // 23:59:59.999

    if (now > deadline) {
      await connection.rollback();
      return res.status(400).json({
        message:
          "최종 입찰 시간이 종료되었습니다. (경매일 저녁 12시까지만 가능)",
        deadline: deadline.toISOString(),
        scheduled_date: bid.scheduled_date,
      });
    }

    // 최종 입찰 금액 검증: starting price보다 높아야 함
    if (finalPrice <= bid.starting_price) {
      await connection.rollback();
      return res.status(400).json({
        message: `입찰 금액은 시작가보다 높아야 합니다.`,
        starting_price: bid.starting_price,
      });
    }

    // 경매장별 입찰가 검증
    // 스타옥션의 경우 starting_price가 실시간 최고가를 의미함
    const currentHighestPrice = bid.starting_price;
    const validation = validateBidByAuction(
      bid.auc_num,
      finalPrice,
      currentHighestPrice,
      true
    );

    if (!validation.valid) {
      await connection.rollback();
      return res.status(400).json({
        message: validation.message,
      });
    }

    // 최종 입찰가 업데이트
    await connection.query(
      'UPDATE live_bids SET final_price = ?, status = "final" WHERE id = ?',
      [finalPrice, id]
    );

    await connection.commit();

    // 크롤러에 처리
    if (bid.auc_num == 1 && ecoAucCrawler) {
      ecoAucCrawler.liveBid(bid.item_id, finalPrice);
      ecoAucCrawler.addWishlist(bid.item_id, 1);
    } else if (bid.auc_num == 2 && brandAucCrawler) {
      brandAucCrawler.liveBid(bid.item_id, finalPrice);
      // additional_info에서 kaisaiKaisu 추출
      const additionalInfo =
        typeof bid.additional_info === "string"
          ? JSON.parse(bid.additional_info)
          : bid.additional_info || {};
      brandAucCrawler.addWishlist(
        bid.item_id,
        "A",
        additionalInfo.kaisaiKaisu || 0
      );
    } else if (bid.auc_num == 4 && mekikiAucCrawler) {
      // additional_info에서 event_id 추출
      const additionalInfo =
        typeof bid.additional_info === "string"
          ? JSON.parse(bid.additional_info)
          : bid.additional_info || {};
      mekikiAucCrawler.liveBid(
        bid.item_id,
        finalPrice,
        additionalInfo.event_id
      );
      mekikiAucCrawler.addWishlist(bid.item_id, additionalInfo.event_id);
    }

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
      // 취소 처리: winningPrice > final_price
      const [cancelResult] = await connection.query(
        `UPDATE live_bids SET status = 'cancelled', winning_price = ? WHERE id IN (${placeholders}) AND status = 'final' AND final_price < ?`,
        [winningPrice, ...bidIds, winningPrice]
      );
      cancelledCount = cancelResult.affectedRows;

      // 완료 처리: winningPrice <= final_price
      const [completeResult] = await connection.query(
        `UPDATE live_bids SET status = 'completed', winning_price = ?, completed_at = NOW() WHERE id IN (${placeholders}) AND status = 'final' AND final_price >= ?`,
        [winningPrice, ...bidIds, winningPrice]
      );
      completedCount = completeResult.affectedRows;

      updateResult = {
        affectedRows: cancelledCount + completedCount,
      };
    } else {
      // 낙찰 금액이 없을 경우 기존 최종 입찰가를 winning_price로 설정하여 완료 처리
      [updateResult] = await connection.query(
        `UPDATE live_bids SET status = 'completed', winning_price = final_price, completed_at = NOW() WHERE id IN (${placeholders}) AND status = 'final'`,
        bidIds
      );
      completedCount = updateResult.affectedRows;
    }

    // commit 전에 완료될 입찰 데이터 조회
    let completedBidsData = [];
    if (completedCount > 0) {
      [completedBidsData] = await connection.query(
        `SELECT l.user_id, l.winning_price, l.final_price, i.title, i.scheduled_date 
        FROM live_bids l 
        JOIN crawled_items i ON l.item_id = i.item_id 
        WHERE l.id IN (${placeholders}) AND l.status = 'completed'`,
        bidIds
      );
    }

    await connection.commit();

    for (const bid of completedBidsData) {
      const date = new Date(bid.scheduled_date).toISOString().split("T")[0];
      createOrUpdateSettlement(bid.user_id, date).catch(console.error);
    }

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

    // Get item details (JOIN 사용)
    const [items] = await connection.query(
      "SELECT i.* FROM crawled_items i JOIN live_bids b ON i.item_id = b.item_id WHERE b.id = ? LIMIT 1",
      [id]
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

// live_bids 수정 라우터 - 기존 라우터에 추가할 코드
router.put("/:id", isAdmin, async (req, res) => {
  const { id } = req.params;
  const { first_price, second_price, final_price, status, winning_price } =
    req.body;

  if (!id) {
    return res.status(400).json({ message: "Bid ID is required" });
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

    // 업데이트할 필드들과 값들을 동적으로 구성
    const updates = [];
    const params = [];

    if (first_price !== undefined) {
      updates.push("first_price = ?");
      params.push(first_price);
    }
    if (second_price !== undefined) {
      updates.push("second_price = ?");
      params.push(second_price);
    }
    if (final_price !== undefined) {
      updates.push("final_price = ?");
      params.push(final_price);
    }
    if (status !== undefined) {
      // 유효한 status 값 체크
      const validStatuses = [
        "first",
        "second",
        "final",
        "completed",
        "cancelled",
        "shipped",
      ];
      if (!validStatuses.includes(status)) {
        await connection.rollback();
        return res.status(400).json({
          message:
            "Invalid status. Must be one of: " + validStatuses.join(", "),
        });
      }
      updates.push("status = ?");
      params.push(status);
    }
    if (winning_price !== undefined) {
      updates.push("winning_price = ?");
      params.push(winning_price);
    }

    // 업데이트할 필드가 없으면 에러 반환
    if (updates.length === 0) {
      await connection.rollback();
      return res.status(400).json({
        message:
          "No valid fields to update. Allowed fields: first_price, second_price, final_price, status, winning_price",
      });
    }

    // updated_at 자동 업데이트 추가
    updates.push("updated_at = NOW()");
    params.push(id);

    const updateQuery = `UPDATE live_bids SET ${updates.join(
      ", "
    )} WHERE id = ?`;

    const [updateResult] = await connection.query(updateQuery, params);

    if (updateResult.affectedRows === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ message: "Bid not found or no changes made" });
    }

    await connection.commit();

    // 업데이트된 bid 정보 반환
    const [updatedBids] = await connection.query(
      "SELECT * FROM live_bids WHERE id = ?",
      [id]
    );

    // status나 winning_price가 변경된 경우 정산 업데이트
    if (status !== undefined || winning_price !== undefined) {
      const [bidWithItem] = await connection.query(
        `SELECT l.user_id, i.scheduled_date 
         FROM live_bids l 
         JOIN crawled_items i ON l.item_id = i.item_id 
         WHERE l.id = ?`,
        [id]
      );

      if (bidWithItem.length > 0 && bidWithItem[0].scheduled_date) {
        const settlementDate = new Date(bidWithItem[0].scheduled_date)
          .toISOString()
          .split("T")[0];
        createOrUpdateSettlement(bidWithItem[0].user_id, settlementDate).catch(
          console.error
        );
      }
    }

    res.status(200).json({
      message: "Bid updated successfully",
      bid: updatedBids[0],
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error updating bid:", err);
    res.status(500).json({ message: "Error updating bid" });
  } finally {
    connection.release();
  }
});

module.exports = router;
