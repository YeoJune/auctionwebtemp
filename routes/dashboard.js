// routes/dashboard.js - 대시보드 API 라우터
const express = require("express");
const router = express.Router();
const { pool } = require("../utils/DB");

// 관리자 권한 확인 미들웨어
const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.login_id === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Access denied. Admin only." });
  }
};

// 대시보드 요약 정보 조회
router.get("/summary", isAdmin, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    // 현장 경매 상태별 개수 조회
    const [liveBidsCount] = await connection.query(`
      SELECT status, COUNT(*) as count
      FROM live_bids
      GROUP BY status
    `);

    // 직접 경매 상태 조회
    const [directBidsCount] = await connection.query(`
      SELECT d.status, COUNT(*) as count
      FROM direct_bids d
      GROUP BY d.status
    `);

    // 예약된 경매 조회 (미래 날짜인 경우)
    const [scheduledAuctions] = await connection.query(`
      SELECT COUNT(*) as count
      FROM direct_bids d
      JOIN crawled_items i ON d.item_id = i.item_id
      WHERE i.scheduled_date > NOW()
    `);

    // 결과를 가공하여 응답 형태로 변환
    const liveBidsResult = {
      first: 0,
      second: 0,
      final: 0,
      completed: 0,
      cancelled: 0,
    };

    liveBidsCount.forEach((item) => {
      if (item.status in liveBidsResult) {
        liveBidsResult[item.status] = item.count;
      }
    });

    const directBidsResult = {
      scheduled: scheduledAuctions[0].count || 0,
      active: 0,
      ended: 0,
    };

    directBidsCount.forEach((item) => {
      if (item.status === "active") {
        directBidsResult.active = item.count;
      } else if (item.status === "completed" || item.status === "cancelled") {
        directBidsResult.ended += item.count;
      }
    });

    // 응답 데이터 구성
    const summary = {
      liveBids: liveBidsResult,
      directAuctions: directBidsResult,
    };

    res.status(200).json(summary);
  } catch (err) {
    console.error("Error fetching dashboard summary:", err);
    res.status(500).json({ message: "Error fetching dashboard summary" });
  } finally {
    connection.release();
  }
});

// 최근 활동 조회
router.get("/activities", isAdmin, async (req, res) => {
  const { limit = 10 } = req.query;
  const connection = await pool.getConnection();

  try {
    // 최근 현장 경매 활동
    const [recentLiveBids] = await connection.query(
      `
      SELECT id, status, updated_at
      FROM live_bids
      ORDER BY updated_at DESC
      LIMIT ?
    `,
      [parseInt(limit, 10)],
    );

    // 최근 직접 경매 활동
    const [recentDirectBids] = await connection.query(
      `
      SELECT id, status, updated_at
      FROM direct_bids
      ORDER BY updated_at DESC
      LIMIT ?
    `,
      [parseInt(limit, 10)],
    );

    // 자바스크립트에서 데이터 가공
    const liveBidActivities = recentLiveBids.map((bid) => ({
      type: "bid",
      content: `현장 경매: ${bid.id} 상태 변경 - ${bid.status}`,
      time: bid.updated_at,
    }));

    const directBidActivities = recentDirectBids.map((bid) => ({
      type: "auction",
      content: `직접 경매: ${bid.id} 상태 변경 - ${bid.status}`,
      time: bid.updated_at,
    }));

    // 모든 활동 병합 및 최신순 정렬
    const allActivities = [...liveBidActivities, ...directBidActivities]
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, parseInt(limit, 10));

    res.status(200).json(allActivities);
  } catch (err) {
    console.error("Error fetching recent activities:", err);
    res.status(500).json({ message: "Error fetching recent activities" });
  } finally {
    connection.release();
  }
});

// 비즈니스 KPI 조회
router.get("/kpi", isAdmin, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    // 오늘 날짜 기준으로 시작 시간 설정
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split("T")[0];

    // 완료된 경매와 취소된 경매 수 조회
    const [liveBidsStatus] = await connection.query(`
      SELECT status, COUNT(*) as count
      FROM live_bids
      WHERE status IN ('completed', 'cancelled')
      GROUP BY status
    `);

    // 직접 경매 상태 조회
    const [directBidsStatus] = await connection.query(`
      SELECT status, COUNT(*) as count
      FROM direct_bids
      WHERE status IN ('completed', 'cancelled')
      GROUP BY status
    `);

    // 평균 입찰가 조회
    const [liveBidPrices] = await connection.query(`
      SELECT final_price
      FROM live_bids
      WHERE final_price IS NOT NULL
    `);

    const [directBidPrices] = await connection.query(`
      SELECT current_price
      FROM direct_bids
      WHERE current_price IS NOT NULL
    `);

    // 오늘의 입찰 수 조회
    const [todayLiveBids] = await connection.query(
      `
      SELECT COUNT(*) as count
      FROM live_bids
      WHERE DATE(created_at) = ?
    `,
      [todayStr],
    );

    const [todayDirectBids] = await connection.query(
      `
      SELECT COUNT(*) as count
      FROM direct_bids
      WHERE DATE(created_at) = ?
    `,
      [todayStr],
    );

    // 자바스크립트에서 데이터 가공
    let completedCount = 0;
    let cancelledCount = 0;

    liveBidsStatus.forEach((item) => {
      if (item.status === "completed") completedCount += item.count;
      if (item.status === "cancelled") cancelledCount += item.count;
    });

    directBidsStatus.forEach((item) => {
      if (item.status === "completed") completedCount += item.count;
      if (item.status === "cancelled") cancelledCount += item.count;
    });

    const totalProcessed = completedCount + cancelledCount;
    const successRate =
      totalProcessed > 0
        ? ((completedCount / totalProcessed) * 100).toFixed(1)
        : 0;

    // 평균 입찰가 계산
    const allPrices = [
      ...liveBidPrices.map((item) => item.final_price),
      ...directBidPrices.map((item) => item.current_price),
    ].filter((price) => price !== null && price !== undefined);

    let avgBidPrice = 0;
    if (allPrices.length > 0) {
      const sum = allPrices.reduce((acc, price) => acc + price, 0);
      avgBidPrice = Math.round(sum / allPrices.length);
    }

    // 오늘의 입찰 수 합산
    const todayBids =
      (todayLiveBids[0]?.count || 0) + (todayDirectBids[0]?.count || 0);

    res.status(200).json({
      successRate,
      avgBidPrice,
      todayBids,
    });
  } catch (err) {
    console.error("Error fetching business KPI data:", err);
    res.status(500).json({ message: "Error fetching business KPI data" });
  } finally {
    connection.release();
  }
});

// 활성 경매 조회
router.get("/active-auctions", isAdmin, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    // 활성 현장 경매 조회 (final 상태)
    const [liveAuctions] = await connection.query(`
      SELECT 
        l.id, l.item_id, l.final_price, l.status, l.first_price, l.second_price,
        i.original_title, i.category, i.brand, i.image
      FROM live_bids l
      JOIN crawled_items i ON l.item_id = i.item_id
      WHERE l.status = 'final'
      ORDER BY l.updated_at DESC
      LIMIT 5
    `);

    // 활성 직접 경매 조회
    const [directAuctions] = await connection.query(`
      SELECT 
        d.id, d.item_id, d.current_price, d.status,
        i.original_title, i.category, i.brand, i.image
      FROM direct_bids d
      JOIN crawled_items i ON d.item_id = i.item_id
      WHERE d.status = 'active'
      ORDER BY d.updated_at DESC
      LIMIT 5
    `);

    res.status(200).json({
      liveAuctions,
      directAuctions,
    });
  } catch (err) {
    console.error("Error fetching active auctions:", err);
    res.status(500).json({ message: "Error fetching active auctions" });
  } finally {
    connection.release();
  }
});

// 활성 사용자 조회
router.get("/active-users", isAdmin, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    // 각 테이블의 최근 활동 데이터 조회
    const [liveBidUsers] = await connection.query(`
      SELECT user_id, updated_at
      FROM live_bids
      ORDER BY updated_at DESC
    `);

    const [directBidUsers] = await connection.query(`
      SELECT user_id, updated_at
      FROM direct_bids
      ORDER BY updated_at DESC
    `);

    // 자바스크립트에서 데이터 가공
    const userActivities = {};

    // 현장 경매 활동 처리
    liveBidUsers.forEach((activity) => {
      const userId = activity.user_id;
      const activityTime = new Date(activity.updated_at);

      if (
        !userActivities[userId] ||
        new Date(userActivities[userId].last_activity) < activityTime
      ) {
        userActivities[userId] = {
          user_id: userId,
          last_activity: activity.updated_at,
          bid_count: userActivities[userId]
            ? userActivities[userId].bid_count + 1
            : 1,
        };
      } else {
        userActivities[userId].bid_count++;
      }
    });

    // 직접 경매 활동 처리
    directBidUsers.forEach((activity) => {
      const userId = activity.user_id;
      const activityTime = new Date(activity.updated_at);

      if (
        !userActivities[userId] ||
        new Date(userActivities[userId].last_activity) < activityTime
      ) {
        userActivities[userId] = {
          user_id: userId,
          last_activity: activity.updated_at,
          bid_count: userActivities[userId]
            ? userActivities[userId].bid_count + 1
            : 1,
        };
      } else {
        userActivities[userId].bid_count++;
      }
    });

    // 배열로 변환하고 최신 활동순으로 정렬
    const activeUsers = Object.values(userActivities)
      .sort((a, b) => new Date(b.last_activity) - new Date(a.last_activity))
      .slice(0, 5); // 상위 5명만 반환

    res.status(200).json(activeUsers);
  } catch (err) {
    console.error("Error fetching active users:", err);
    res.status(500).json({ message: "Error fetching active users" });
  } finally {
    connection.release();
  }
});

module.exports = router;
