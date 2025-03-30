// routes/dashboard.js - 대시보드 API 라우터
const express = require("express");
const router = express.Router();
const pool = require("../utils/DB");

// 관리자 권한 확인 미들웨어
const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.id === "admin") {
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
      SELECT 
        SUM(CASE WHEN status = 'first' THEN 1 ELSE 0 END) as first,
        SUM(CASE WHEN status = 'second' THEN 1 ELSE 0 END) as second,
        SUM(CASE WHEN status = 'final' THEN 1 ELSE 0 END) as final,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
      FROM live_bids
    `);

    // 직접 경매 상태별 개수 조회 (예약, 활성, 종료)
    const [directAuctionsCount] = await connection.query(`
      SELECT 
        SUM(CASE 
          WHEN i.scheduled_date > NOW() THEN 1 
          ELSE 0 
        END) as scheduled,
        SUM(CASE 
          WHEN d.status = 'active' THEN 1 
          ELSE 0 
        END) as active,
        SUM(CASE 
          WHEN d.status IN ('completed', 'cancelled') THEN 1 
          ELSE 0 
        END) as ended
      FROM direct_bids d
      LEFT JOIN crawled_items i ON d.item_id = i.item_id
    `);

    // 인보이스 상태별 개수 조회 (가상 테이블, 실제로 구현 시 적절한 테이블 사용)
    // 이 부분은 인보이스 테이블 구조에 따라 조정 필요
    const [invoiceCount] = await connection
      .query(
        `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM invoices
    `
      )
      .catch(() => {
        // 인보이스 테이블이 없을 경우 기본값 반환
        return [[{ total: 0, pending: 0, processing: 0, completed: 0 }]];
      });

    // 응답 데이터 구성
    const summary = {
      liveBids: {
        first: liveBidsCount[0].first || 0,
        second: liveBidsCount[0].second || 0,
        final: liveBidsCount[0].final || 0,
        completed: liveBidsCount[0].completed || 0,
        cancelled: liveBidsCount[0].cancelled || 0,
      },
      directAuctions: {
        scheduled: directAuctionsCount[0].scheduled || 0,
        active: directAuctionsCount[0].active || 0,
        ended: directAuctionsCount[0].ended || 0,
      },
      invoices: {
        pending: invoiceCount[0].pending || 0,
        processing: invoiceCount[0].processing || 0,
        completed: invoiceCount[0].completed || 0,
      },
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
      SELECT 
        'bid' as type,
        CONCAT('현장 경매: ', l.id, ' 상태 변경 - ', l.status) as content,
        l.updated_at as time
      FROM live_bids l
      ORDER BY l.updated_at DESC
      LIMIT ?
    `,
      [parseInt(limit, 10)]
    );

    // 최근 직접 경매 활동
    const [recentDirectBids] = await connection.query(
      `
      SELECT 
        'auction' as type,
        CONCAT('직접 경매: ', d.id, ' 상태 변경 - ', d.status) as content,
        d.updated_at as time
      FROM direct_bids d
      ORDER BY d.updated_at DESC
      LIMIT ?
    `,
      [parseInt(limit, 10)]
    );

    // 최근 인보이스 활동 (구현 시 실제 테이블 사용)
    const [recentInvoices] = await connection
      .query(
        `
      SELECT 
        'invoice' as type,
        CONCAT('인보이스: ', i.id, ' 상태 변경 - ', i.status) as content,
        i.updated_at as time
      FROM invoices i
      ORDER BY i.updated_at DESC
      LIMIT ?
    `,
        [parseInt(limit, 10)]
      )
      .catch(() => {
        // 인보이스 테이블이 없을 경우 빈 배열 반환
        return [[]];
      });

    // 모든 활동 병합 및 최신순 정렬
    const allActivities = [
      ...recentLiveBids,
      ...recentDirectBids,
      ...recentInvoices,
    ]
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

    // 1. 경매 성공률 계산
    const [successRateData] = await connection.query(`
      SELECT
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count
      FROM (
        SELECT status FROM live_bids WHERE status IN ('completed', 'cancelled')
        UNION ALL
        SELECT status FROM direct_bids WHERE status IN ('completed', 'cancelled')
      ) as combined_bids
    `);

    const completedCount = successRateData[0].completed_count || 0;
    const cancelledCount = successRateData[0].cancelled_count || 0;
    const totalProcessed = completedCount + cancelledCount;
    const successRate =
      totalProcessed > 0
        ? ((completedCount / totalProcessed) * 100).toFixed(1)
        : 0;

    // 2. 평균 입찰가 계산
    const [avgBidPriceData] = await connection.query(`
      SELECT AVG(price) as avg_price
      FROM (
        SELECT final_price as price FROM live_bids WHERE final_price IS NOT NULL
        UNION ALL
        SELECT current_price as price FROM direct_bids WHERE current_price IS NOT NULL
      ) as bid_prices
    `);

    const avgBidPrice = avgBidPriceData[0].avg_price || 0;

    // 3. 오늘의 입찰 수 계산
    const [todayBidsData] = await connection.query(
      `
      SELECT COUNT(*) as count
      FROM (
        SELECT created_at FROM live_bids WHERE DATE(created_at) = ?
        UNION ALL
        SELECT created_at FROM direct_bids WHERE DATE(created_at) = ?
      ) as today_bids
    `,
      [todayStr, todayStr]
    );

    const todayBids = todayBidsData[0].count || 0;

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
        l.id, l.item_id, l.final_price, l.status,
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
    // 최근 활동 사용자 (최근 입찰을 기준으로)
    const [activeUsers] = await connection.query(`
      SELECT 
        user_id,
        MAX(activity_time) as last_activity,
        COUNT(*) as bid_count
      FROM (
        SELECT 
          user_id, 
          updated_at as activity_time
        FROM live_bids
        UNION ALL
        SELECT 
          user_id, 
          updated_at as activity_time
        FROM direct_bids
      ) as user_activities
      GROUP BY user_id
      ORDER BY last_activity DESC
      LIMIT 5
    `);

    res.status(200).json(activeUsers);
  } catch (err) {
    console.error("Error fetching active users:", err);
    res.status(500).json({ message: "Error fetching active users" });
  } finally {
    connection.release();
  }
});

module.exports = router;
