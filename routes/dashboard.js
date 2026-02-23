// routes/dashboard.js - 대시보드 API 라우터
const express = require("express");
const router = express.Router();
const { pool } = require("../utils/DB");
const { isAdminUser } = require("../utils/adminAuth");

// 관리자 권한 확인 미들웨어
const isAdmin = (req, res, next) => {
  if (isAdminUser(req.session?.user)) {
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
    // 각 테이블의 최근 활동 데이터 조회 (login_id 포함)
    const [liveBidUsers] = await connection.query(`
      SELECT lb.user_id, lb.updated_at, u.login_id
      FROM live_bids lb
      LEFT JOIN users u ON lb.user_id = u.id
      ORDER BY lb.updated_at DESC
    `);

    const [directBidUsers] = await connection.query(`
      SELECT db.user_id, db.updated_at, u.login_id
      FROM direct_bids db
      LEFT JOIN users u ON db.user_id = u.id
      ORDER BY db.updated_at DESC
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
          login_id: activity.login_id,
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
          login_id: activity.login_id,
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

// CEO 대시보드 요약 (완료 매출/VIP/이탈위험)
router.get("/executive-summary", isAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  const revenueStatuses = "'completed','shipped'";
  const targetYear = 2026;

  try {
    const calcBusinessDays = (dateValue) => {
      if (!dateValue) return 0;
      const start = new Date(dateValue);
      if (Number.isNaN(start.getTime())) return 0;
      start.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (start >= today) return 0;
      let days = 0;
      const cursor = new Date(start);
      while (cursor < today) {
        const day = cursor.getDay();
        if (day !== 0 && day !== 6) days += 1;
        cursor.setDate(cursor.getDate() + 1);
      }
      return days;
    };

    const [countsRows] = await connection.query(`
      SELECT
        SUM(CASE WHEN src = 'live' THEN 1 ELSE 0 END) AS liveCount,
        SUM(CASE WHEN src = 'direct' THEN 1 ELSE 0 END) AS directCount,
        COUNT(*) AS totalCount
      FROM (
        SELECT 'live' AS src, COALESCE(l.completed_at, l.updated_at, l.created_at) AS event_at
        FROM live_bids l
        WHERE l.status IN (${revenueStatuses})
          AND CAST(REPLACE(l.winning_price, ',', '') AS DECIMAL(18,2)) > 0
          AND YEAR(COALESCE(l.completed_at, l.updated_at, l.created_at)) = ?
        UNION ALL
        SELECT 'direct' AS src, COALESCE(d.completed_at, d.updated_at, d.created_at) AS event_at
        FROM direct_bids d
        WHERE d.status IN (${revenueStatuses})
          AND CAST(REPLACE(d.winning_price, ',', '') AS DECIMAL(18,2)) > 0
          AND YEAR(COALESCE(d.completed_at, d.updated_at, d.created_at)) = ?
      ) t
    `, [targetYear, targetYear]);

    const [settlementYearRows] = await connection.query(`
      SELECT
        COALESCE(SUM(ds.total_amount), 0) AS yearRevenueKrw,
        COALESCE(MIN(ds.settlement_date), NULL) AS periodStart,
        COALESCE(MAX(ds.settlement_date), NULL) AS periodEnd
      FROM daily_settlements ds
      WHERE YEAR(ds.settlement_date) = ?
        AND ds.total_amount > 0
    `, [targetYear]);

    const [settlementCurrentMonthRows] = await connection.query(`
      SELECT
        COALESCE(SUM(ds.total_amount), 0) AS monthRevenueKrw
      FROM daily_settlements ds
      WHERE YEAR(ds.settlement_date) = YEAR(CURDATE())
        AND MONTH(ds.settlement_date) = MONTH(CURDATE())
        AND ds.total_amount > 0
    `);

    const [monthlyCountRows] = await connection.query(`
      SELECT
        COUNT(*) AS monthlyCompletedCount
      FROM (
        SELECT COALESCE(l.completed_at, l.updated_at, l.created_at) AS event_at
        FROM live_bids l
        WHERE l.status IN (${revenueStatuses})
          AND CAST(REPLACE(l.winning_price, ',', '') AS DECIMAL(18,2)) > 0
        UNION ALL
        SELECT COALESCE(d.completed_at, d.updated_at, d.created_at) AS event_at
        FROM direct_bids d
        WHERE d.status IN (${revenueStatuses})
          AND CAST(REPLACE(d.winning_price, ',', '') AS DECIMAL(18,2)) > 0
      ) x
      WHERE x.event_at >= DATE_SUB(NOW(), INTERVAL 1 MONTH)
    `);

    const [noBidRows] = await connection.query(`
      SELECT
        u.id AS user_id,
        COALESCE(u.login_id, CONCAT('user#', u.id)) AS login_id,
        COALESCE(u.company_name, '-') AS company_name,
        DATE_FORMAT(u.created_at, '%Y-%m-%d') AS joined_at
      FROM users u
      LEFT JOIN (
        SELECT DISTINCT user_id FROM live_bids WHERE user_id IS NOT NULL
        UNION
        SELECT DISTINCT user_id FROM direct_bids WHERE user_id IS NOT NULL
      ) b ON b.user_id = u.id
      WHERE u.role = 'normal'
        AND u.created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
        AND b.user_id IS NULL
      ORDER BY u.created_at ASC
      LIMIT 200
    `);
    const [vipRows] = await connection.query(`
      SELECT
        ds.user_id,
        COALESCE(u.login_id, CONCAT('user#', ds.user_id)) AS login_id,
        COALESCE(u.company_name, '-') AS company_name,
        COUNT(*) AS completedCount,
        COALESCE(SUM(ds.total_amount), 0) AS totalRevenueKrw
      FROM daily_settlements ds
      LEFT JOIN users u ON u.id = ds.user_id
      WHERE ds.settlement_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        AND ds.total_amount > 0
      GROUP BY ds.user_id, u.login_id, u.company_name
      ORDER BY totalRevenueKrw DESC
      LIMIT 10
    `);

    const [sixMonthRows] = await connection.query(`
      SELECT
        DATE_FORMAT(ds.settlement_date, '%Y-%m') AS ym,
        COALESCE(SUM(ds.total_amount), 0) AS revenueKrw
      FROM daily_settlements ds
      WHERE ds.settlement_date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01')
      GROUP BY DATE_FORMAT(ds.settlement_date, '%Y-%m')
      ORDER BY ym ASC
    `);

    const [pendingDomesticRows] = await connection.query(`
      SELECT
        DATE(z.completed_at) AS completed_date,
        z.auc_num,
        COUNT(*) AS item_count,
        MAX(z.completed_at) AS completed_at
      FROM (
        SELECT
          'live' AS bid_type,
          l.id AS bid_id,
          l.item_id,
          i.auc_num,
          COALESCE(l.completed_at, l.updated_at, l.created_at) AS completed_at
        FROM live_bids l
        LEFT JOIN crawled_items i
          ON CONVERT(i.item_id USING utf8mb4) =
             CONVERT(l.item_id USING utf8mb4)
        WHERE l.status = 'completed'
        UNION ALL
        SELECT
          'direct' AS bid_type,
          d.id AS bid_id,
          d.item_id,
          i.auc_num,
          COALESCE(d.completed_at, d.updated_at, d.created_at) AS completed_at
        FROM direct_bids d
        LEFT JOIN crawled_items i
          ON CONVERT(i.item_id USING utf8mb4) =
             CONVERT(d.item_id USING utf8mb4)
        WHERE d.status = 'completed'
      ) z
      LEFT JOIN bid_workflow_stages bws
        ON bws.bid_type = z.bid_type
       AND bws.bid_id = z.bid_id
      WHERE z.completed_at IS NOT NULL
        AND (
          bws.bid_id IS NULL
          OR bws.stage NOT IN ('domestic_arrived', 'processing', 'shipped')
        )
      GROUP BY DATE(z.completed_at), z.auc_num
      ORDER BY completed_date DESC, z.auc_num ASC
      LIMIT 200
    `);

    const formatDate = (d) => {
      if (!d) return null;
      const date = new Date(d);
      if (Number.isNaN(date.getTime())) return null;
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
        date.getDate(),
      ).padStart(2, "0")}`;
    };

    const yearRevenueKrw = Number(settlementYearRows[0]?.yearRevenueKrw || 0);
    const monthlyRevenueKrw = Number(settlementCurrentMonthRows[0]?.monthRevenueKrw || 0);
    const completedCount = Number(countsRows[0]?.totalCount || 0);
    const liveCount = Number(countsRows[0]?.liveCount || 0);
    const directCount = Number(countsRows[0]?.directCount || 0);
    const totalCountForSplit = completedCount > 0 ? completedCount : 1;
    const liveRevenueEstimate = Math.round((yearRevenueKrw * liveCount) / totalCountForSplit);
    const directRevenueEstimate = Math.max(0, Math.round(yearRevenueKrw - liveRevenueEstimate));

    const sixMonthMap = new Map((sixMonthRows || []).map((r) => [r.ym, Number(r.revenueKrw || 0)]));
    const sixMonthRevenue = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      sixMonthRevenue.push({
        month: ym,
        monthLabel: `${String(d.getMonth() + 1).padStart(2, "0")}월`,
        revenueKrw: Number(sixMonthMap.get(ym) || 0),
      });
    }

    const pendingDomestic = (pendingDomesticRows || []).map((row) => {
      const completedDate = formatDate(row.completed_date || row.completed_at);
      return {
        aucNum: row.auc_num || "-",
        itemCount: Number(row.item_count || 0),
        completedAt: row.completed_at,
        completedDate,
        businessDaysElapsed: calcBusinessDays(row.completed_at),
      };
    });

    res.status(200).json({
      completedCount,
      totalRevenueKrw: yearRevenueKrw,
      targetYear,
      yearCompletedCount: completedCount,
      yearRevenueKrw,
      monthlyCompletedCount: Number(monthlyCountRows[0]?.monthlyCompletedCount || 0),
      monthlyRevenueKrw,
      periodStart: formatDate(settlementYearRows[0]?.periodStart),
      periodEnd: formatDate(settlementYearRows[0]?.periodEnd),
      atRiskCount: noBidRows.length,
      atRiskUsers: noBidRows,
      vipTop5: (vipRows || []).slice(0, 5),
      vipTop10: vipRows || [],
      sixMonthRevenue,
      pendingDomesticCount: pendingDomestic.length,
      pendingDomestic,
      sourceBreakdown: {
        live: {
          count: liveCount,
          revenueKrw: liveRevenueEstimate,
        },
        direct: {
          count: directCount,
          revenueKrw: directRevenueEstimate,
        },
      },
    });
  } catch (err) {
    console.error("Error fetching executive summary:", err);
    res.status(500).json({ message: "Error fetching executive summary" });
  } finally {
    connection.release();
  }
});

module.exports = router;
