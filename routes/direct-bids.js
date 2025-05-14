// routes/direct-bids.js - 직접 경매(고전적인 경매) 라우터
const express = require("express");
const router = express.Router();
const pool = require("../utils/DB");
const submitBid = require("../utils/submitBid");
const {
  ecoAucCrawler,
  brandAucCrawler,
  starAucCrawler,
} = require("../crawlers/index");

const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.id === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Access denied. Admin only." });
  }
};

// STATUS -> 'active', 'completed', 'cancelled'
// GET endpoint to retrieve all bids, with optional filtering
// Updated GET endpoint for direct-bids.js
router.get("/", async (req, res) => {
  const {
    status,
    highestOnly,
    page = 1,
    limit = 10,
    fromDate,
    toDate,
    sortBy = "updated_at",
    sortOrder = "desc",
  } = req.query;
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
          d.*,
          i.item_id, i.original_title, i.auc_num, i.category, i.brand, i.rank,
          i.starting_price, i.scheduled_date, i.image, i.original_scheduled_date, i.title
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
          d.*,
          i.item_id, i.original_title, i.auc_num, i.category, i.brand, i.rank,
          i.starting_price, i.scheduled_date, i.image, i.original_scheduled_date, i.title
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

    // 시작 날짜 필터 추가
    if (fromDate) {
      countQuery += " AND d.updated_at >= ?";
      mainQuery += " AND d.updated_at >= ?";
      queryParams.push(fromDate);
    }

    // 종료 날짜 필터 추가
    if (toDate) {
      countQuery += " AND d.updated_at <= ?";
      mainQuery += " AND d.updated_at <= ?";
      queryParams.push(toDate);
    }

    // 일반 사용자는 자신의 입찰만 볼 수 있고, 관리자는 모든 입찰을 볼 수 있음
    if (req.session.user.id !== "admin") {
      countQuery += " AND d.user_id = ?";
      mainQuery += " AND d.user_id = ?";
      queryParams.push(req.session.user.id);
    }

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
      case "current_price":
        orderByColumn = "d.current_price";
        break;
      case "created_at":
        orderByColumn = "d.created_at";
        break;
      case "updated_at":
      default:
        orderByColumn = "d.updated_at";
        break;
    }

    // 정렬 방향 설정
    const direction = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

    // 정렬 쿼리 추가
    mainQuery += ` ORDER BY ${orderByColumn} ${direction}`;

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
        submitted_to_platform: row.submitted_to_platform,
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

// 사용자의 입찰 (자동 생성/업데이트) - 자동 제출 기능 추가
router.post("/", async (req, res) => {
  const { itemId, currentPrice, autoSubmit = true } = req.body;

  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userId = req.session.user.id;

  if (!itemId || !currentPrice) {
    return res.status(400).json({ message: "Item ID and price are required" });
  }

  // 가격이 1000단위인지 확인
  if (currentPrice % 1000 !== 0) {
    return res.status(400).json({ message: "Price must be in units of 1000" });
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

    const item = items[0];

    // 1-1. crawlUpdateWithId로 최신 가격 확인
    // 아이템의 auc_num에 따라 적절한 크롤러 선택
    let latestItemInfo;
    try {
      const crawler = {
        1: ecoAucCrawler,
        2: brandAucCrawler,
        3: starAucCrawler,
      }[item.auc_num];

      if (crawler && crawler.crawlUpdateWithId) {
        console.log(
          `Checking latest price for item ${itemId} (auc_num=${item.auc_num})`
        );
        latestItemInfo = await crawler.crawlUpdateWithId(itemId);

        // 최신 정보가 있고 가격이 다르면 DB 업데이트
        if (latestItemInfo && latestItemInfo.starting_price !== undefined) {
          if (
            parseFloat(latestItemInfo.starting_price) !==
            parseFloat(item.starting_price)
          ) {
            console.log(
              `Price changed for item ${itemId}: ${item.starting_price} -> ${latestItemInfo.starting_price}`
            );

            // DB 업데이트
            await connection.query(
              "UPDATE crawled_items SET starting_price = ? WHERE item_id = ?",
              [latestItemInfo.starting_price, itemId]
            );

            // 현재 가격이 최신 가격보다 낮은 경우
            if (
              parseFloat(currentPrice) <
              parseFloat(latestItemInfo.starting_price)
            ) {
              await connection.rollback();
              return res.status(400).json({
                message: `Your bid (${currentPrice}) must be higher than the current item price (${latestItemInfo.starting_price})`,
                latestPrice: latestItemInfo.starting_price,
              });
            }

            // item 객체 업데이트
            item.starting_price = latestItemInfo.starting_price;
          }
        }
      }
    } catch (error) {
      // 크롤링에 실패해도 기존 가격으로 진행
      console.error(`Error checking latest price for item ${itemId}:`, error);
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

    // 4-1. 시작가 검증
    if (parseFloat(currentPrice) < parseFloat(item.starting_price)) {
      await connection.rollback();
      return res.status(400).json({
        message: `Your bid must be higher than the starting price (${item.starting_price})`,
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

    // 7. scheduled_date 연장 (auc_num=1이고 마감 시간이 5분 미만일 때만)
    if (item.scheduled_date && (item.auc_num == 1 || item.auc_num == 3)) {
      // 현재 시간
      const now = new Date();

      // 아이템의 scheduled_date
      const scheduledDate = new Date(item.scheduled_date);

      // 현재부터 마감까지 남은 시간(분)
      const minutesRemaining = (scheduledDate - now) / (1000 * 60);

      // 남은 시간이 5분 미만이면 연장
      if (minutesRemaining < 5 && minutesRemaining > 0) {
        // 새로운 마감시간 (현재 시간 + 5분)
        const newScheduledDate = new Date(now);
        newScheduledDate.setMinutes(now.getMinutes() + 5);

        // 업데이트
        await connection.query(
          "UPDATE crawled_items SET scheduled_date = ? WHERE item_id = ?",
          [
            newScheduledDate.toISOString().slice(0, 19).replace("T", " "),
            itemId,
          ]
        );

        console.log(
          `Extended scheduled_date to 5 minutes from now for item ${itemId} (auc_num=${item.auc_num})`
        );
      }
    }

    await connection.commit();

    // 8. autoSubmit이 true인 경우 자동으로 입찰 제출
    let submissionResult = null;
    if (autoSubmit) {
      submissionResult = await submitBid({
        bid_id: bidId,
        price: currentPrice,
      });

      if (submissionResult && !submissionResult.success) {
        // 입찰 제출 실패해도 입찰 생성/업데이트는 성공적으로 이루어짐
        return res.status(201).json({
          message:
            "Bid placed successfully but could not be submitted to platform automatically",
          bidId: bidId,
          status: "active",
          currentPrice,
          submitted: false,
          submissionError: submissionResult.message,
        });
      }
    }

    res.status(201).json({
      message: autoSubmit
        ? "Bid placed and submitted to platform successfully"
        : "Bid placed successfully",
      bidId: bidId,
      status: "active",
      currentPrice,
      submitted: autoSubmit ? true : false,
      submissionResult: submissionResult,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error placing bid:", err);
    res.status(500).json({ message: "Error placing bid" });
  } finally {
    connection.release();
  }
});

// 낙찰 완료 처리 - 단일 또는 다중 처리 지원
router.put("/complete", isAdmin, async (req, res) => {
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

    // 활성 상태인 입찰만 완료 처리
    const [updateResult] = await connection.query(
      `UPDATE direct_bids SET status = 'completed' WHERE id IN (${placeholders}) AND status = 'active'`,
      bidIds
    );

    // 완료된 항목의 item_id 조회
    const [completedBids] = await connection.query(
      `SELECT item_id FROM direct_bids WHERE id IN (${placeholders}) AND status = 'completed'`,
      bidIds
    );

    // 완료된 항목과 관련된 다른 입찰 취소 (동일 item_id)
    for (const bid of completedBids) {
      await connection.query(
        "UPDATE direct_bids SET status = 'cancelled' WHERE item_id = ? AND id NOT IN (?) AND status = 'active'",
        [bid.item_id, bidIds]
      );
    }

    await connection.commit();

    res.status(200).json({
      message: id
        ? "Bid completed successfully"
        : `${updateResult.affectedRows} bids completed successfully`,
      status: "completed",
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
      `UPDATE direct_bids SET status = 'cancelled' WHERE id IN (${placeholders}) AND status != 'completed'`,
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

// 입찰 수동 제출 API
router.post("/:id/submit", isAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    // 입찰 정보 조회
    const connection = await pool.getConnection();

    try {
      const [bids] = await connection.query(
        "SELECT * FROM direct_bids WHERE id = ?",
        [id]
      );

      if (bids.length === 0) {
        return res.status(404).json({ message: "Bid not found" });
      }

      const bid = bids[0];

      // 이미 제출된 입찰인지 확인
      if (bid.submitted_to_platform) {
        return res.status(400).json({
          message: "This bid has already been submitted to the platform",
        });
      }

      // 입찰 상태 확인
      if (bid.status !== "active") {
        return res.status(400).json({
          message: "Only active bids can be submitted to the platform",
        });
      }

      // submitBid 함수 호출
      const result = await submitBid({
        bid_id: id,
        price: bid.current_price,
      });

      if (result.success) {
        return res.status(200).json({
          message: "Bid successfully submitted to platform",
          bidId: id,
          success: true,
        });
      } else {
        return res.status(result.statusCode || 500).json({
          message: result.message,
          error: result.error,
          success: false,
        });
      }
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error submitting bid:", error);
    return res.status(500).json({
      message: "Error submitting bid",
      error: error.message,
      success: false,
    });
  }
});

// 플랫폼 반영 완료 표시 - 단일 또는 다중 처리 지원
router.put("/mark-submitted", isAdmin, async (req, res) => {
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

    // 한 번의 쿼리로 여러 입찰의 플랫폼 반영 상태를 업데이트
    const placeholders = bidIds.map(() => "?").join(",");

    const [updateResult] = await connection.query(
      `UPDATE direct_bids SET submitted_to_platform = TRUE WHERE id IN (${placeholders}) AND submitted_to_platform = FALSE`,
      bidIds
    );

    await connection.commit();

    res.status(200).json({
      message: id
        ? "Bid marked as submitted successfully"
        : `${updateResult.affectedRows} bids marked as submitted successfully`,
      submitted_to_platform: true,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error marking bid(s) as submitted:", err);
    res.status(500).json({ message: "Error marking bid(s) as submitted" });
  } finally {
    connection.release();
  }
});

module.exports = router;
