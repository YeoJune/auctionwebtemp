// routes/data.js
const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const router = express.Router();
const axios = require("axios");
const { pool } = require("../utils/DB");
const { processItem } = require("../utils/processItem");
const {
  getRecommendSettings,
  buildRecommendWhereClause,
} = require("../utils/recommend");

let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

const apiUrl = `https://api.currencyfreaks.com/v2.0/rates/latest?apikey=${process.env.CURRENCY_API_KEY}`;

// ===== 캐싱 관련 설정 =====
const FILTER_CACHE_DURATION = 5 * 60 * 1000; // 필터 동기화: 5분
const RECOMMEND_CACHE_DURATION = 10 * 60 * 1000; // 추천 동기화: 10분
const STATS_CACHE_DURATION = 5 * 60 * 1000; // 통계 캐시: 5분
const EXCHANGE_CACHE_DURATION = 60 * 60 * 1000; // 환율 캐시: 1시간

const cache = {
  exchange: {
    data: null,
    lastFetched: null,
  },
  sync: {
    lastSynced: null,
  },
  recommendSync: {
    lastSynced: null,
  },
  filters: {
    withStats: {
      brands: { data: null, lastFetched: null },
      dates: { data: null, lastFetched: null },
      aucNums: { data: null, lastFetched: null },
      ranks: { data: null, lastFetched: null },
      auctionTypes: { data: null, lastFetched: null },
    },
  },
};

const normalizeString = (str) => {
  if (!str) return "";
  return str
    .normalize("NFD") // 'è' 같은 문자를 'e'와 '`'로 분리
    .replace(/[\u0300-\u036f]/g, "") // 악센트 기호(결합 문자) 제거
    .toLowerCase(); // 소문자로 변환
};

// ===== 캐시 헬퍼 함수들 =====
function isCacheValid(cacheItem, duration) {
  const currentTime = new Date().getTime();

  if (cacheItem.lastSynced !== undefined) {
    return (
      cacheItem.lastSynced !== null &&
      currentTime - cacheItem.lastSynced < duration
    );
  } else {
    return (
      cacheItem.data !== null &&
      cacheItem.lastFetched !== null &&
      currentTime - cacheItem.lastFetched < duration
    );
  }
}

function updateCache(cacheItem, data) {
  if (cacheItem.lastSynced !== undefined) {
    cacheItem.lastSynced = new Date().getTime();
  } else {
    cacheItem.data = data;
    cacheItem.lastFetched = new Date().getTime();
  }
}

function invalidateCache(type, subType = null) {
  if (type === "all") {
    Object.keys(cache).forEach((key) => {
      if (typeof cache[key] === "object") {
        if (cache[key].lastSynced !== undefined) {
          cache[key].lastSynced = null;
        } else if (cache[key].data !== undefined) {
          cache[key].data = null;
          cache[key].lastFetched = null;
        } else {
          Object.keys(cache[key]).forEach((subKey) => {
            Object.keys(cache[key][subKey]).forEach((item) => {
              cache[key][subKey][item].data = null;
              cache[key][subKey][item].lastFetched = null;
            });
          });
        }
      }
    });
  } else if (type === "sync") {
    cache.sync.lastSynced = null;
  } else if (type === "recommendSync") {
    cache.recommendSync.lastSynced = null;
  } else if (type === "filters") {
    if (subType) {
      if (cache.filters.withStats[subType]) {
        cache.filters.withStats[subType].data = null;
        cache.filters.withStats[subType].lastFetched = null;
      }
    } else {
      Object.keys(cache.filters.withStats).forEach((item) => {
        cache.filters.withStats[item].data = null;
        cache.filters.withStats[item].lastFetched = null;
      });
    }
  } else if (type === "exchange") {
    cache.exchange.data = null;
    cache.exchange.lastFetched = null;
  }
}

// ===== 필터 동기화 함수 =====
async function syncItemsWithFilterSettings() {
  if (isCacheValid(cache.sync, FILTER_CACHE_DURATION)) {
    return; // 5분 이내면 스킵
  }

  console.log("Syncing crawled_items.is_enabled with filter_settings...");

  try {
    await pool.query(`
      UPDATE crawled_items ci
      SET is_enabled = CASE 
        WHEN EXISTS (
          SELECT 1 FROM filter_settings fs1 
          WHERE fs1.filter_type = 'brand' 
          AND fs1.filter_value = ci.brand 
          AND fs1.is_enabled = 1
        )
        AND EXISTS (
          SELECT 1 FROM filter_settings fs2 
          WHERE fs2.filter_type = 'category' 
          AND fs2.filter_value = ci.category 
          AND fs2.is_enabled = 1
        )
        AND EXISTS (
          SELECT 1 FROM filter_settings fs3 
          WHERE fs3.filter_type = 'date' 
          AND fs3.filter_value = DATE(ci.scheduled_date)
          AND fs3.is_enabled = 1
        )
        THEN 1 
        ELSE 0 
      END
    `);

    updateCache(cache.sync, true);
    console.log("Filter sync completed successfully");
  } catch (error) {
    console.error("Error during filter sync:", error);
  }
}

// ===== 추천 동기화 함수 =====
async function syncItemsWithRecommendSettings() {
  if (isCacheValid(cache.recommendSync, RECOMMEND_CACHE_DURATION)) {
    return; // 10분 이내면 스킵
  }

  console.log("Syncing crawled_items.recommend with recommend_settings...");

  try {
    // 모든 아이템을 0으로 초기화
    await pool.query(`UPDATE crawled_items SET recommend = 0`);

    // 활성화된 추천 규칙들을 점수 순으로 조회 (높은 점수부터)
    const recommendSettings = await getRecommendSettings();

    // 각 규칙을 순차적으로 적용 (MAX 로직)
    for (const setting of recommendSettings) {
      const conditions = JSON.parse(setting.conditions);
      const { whereClause, params } = buildRecommendWhereClause(conditions);

      if (whereClause) {
        // 현재 점수보다 높은 경우만 업데이트 (MAX 로직)
        await pool.query(
          `
          UPDATE crawled_items ci
          SET recommend = ?
          WHERE (${whereClause}) AND recommend < ?
        `,
          [setting.recommend_score, ...params, setting.recommend_score]
        );
      }
    }

    updateCache(cache.recommendSync, true);
    console.log("Recommend sync completed successfully");
  } catch (error) {
    console.error("Error during recommend sync:", error);
  }
}

// ===== 기본 필터 조건 (단순화) =====
async function buildBaseFilterConditions() {
  return {
    conditions: ["ci.is_enabled = 1"],
    queryParams: [],
  };
}

// ===== 메인 데이터 조회 라우터 =====
router.get("/", async (req, res) => {
  const {
    page = 1,
    limit = 20,
    brands,
    categories,
    scheduledDates,
    favoriteNumbers,
    aucNums,
    search,
    ranks,
    auctionTypes,
    withDetails = "false",
    bidsOnly = "false",
    sortBy = "scheduled_date",
    sortOrder = "asc",
    excludeExpired = "true",
    minRecommend = 0,
  } = req.query;

  const offset = (page - 1) * limit;
  const userId = req.session.user?.id;

  try {
    // 1. Lazy 동기화들 (각각 다른 주기)
    await syncItemsWithFilterSettings();
    await syncItemsWithRecommendSettings();

    // 2. 사용자 입찰 데이터 조회 (통합 쿼리)
    let bidData = [];
    let userBidItemIds = [];

    if (userId) {
      const [userLiveBids] = await pool.query(
        `
        SELECT 'live' as bid_type, item_id, first_price, second_price, final_price, status, id
        FROM live_bids WHERE user_id = ?
      `,
        [userId]
      );

      const [userDirectBids] = await pool.query(
        `
        SELECT 'direct' as bid_type, item_id, current_price, status, id
        FROM direct_bids WHERE user_id = ?
      `,
        [userId]
      );

      bidData = [...userLiveBids, ...userDirectBids];
      if (bidsOnly === "true") {
        userBidItemIds = bidData.map((bid) => bid.item_id);
      }
    }

    // 3. 쿼리 구성 시작
    let baseQuery = "SELECT ci.* FROM crawled_items ci";
    const joins = [];
    const conditions = ["ci.is_enabled = 1"]; // 기본 조건: 활성화된 아이템만
    const queryParams = [];

    // 4. 추천 점수 필터
    if (minRecommend && parseInt(minRecommend) > 0) {
      conditions.push("ci.recommend >= ?");
      queryParams.push(parseInt(minRecommend));
    }

    // 5. 즐겨찾기 필터
    if (favoriteNumbers && userId) {
      const favoriteNumbersList = favoriteNumbers.split(",").map(Number);
      if (favoriteNumbersList.length > 0) {
        conditions.push(
          `ci.item_id IN (SELECT DISTINCT item_id FROM wishlists WHERE user_id = ? AND favorite_number IN (${favoriteNumbersList
            .map(() => "?")
            .join(",")}))`
        );
        queryParams.push(userId, ...favoriteNumbersList);
      }
    }

    // 6. 기본 조건들
    if (excludeExpired === "true") {
      conditions.push(`
      (
        (ci.bid_type = 'direct' AND ci.scheduled_date > NOW()) OR
        (ci.bid_type = 'live' AND
          (ci.scheduled_date > NOW() OR DATE(ci.scheduled_date) = DATE(NOW()))
        )
      )
      `);
    }

    // 입찰한 아이템만 보기
    if (bidsOnly === "true" && userId) {
      if (userBidItemIds.length > 0) {
        conditions.push(
          `ci.item_id IN (${userBidItemIds.map(() => "?").join(",")})`
        );
        queryParams.push(...userBidItemIds);
      } else {
        return res.json({
          data: [],
          wishlist: [],
          page: parseInt(page),
          limit: parseInt(limit),
          totalItems: 0,
          totalPages: 0,
        });
      }
    }

    // 7. 검색 조건
    if (search && search.trim()) {
      const searchTerms = search.trim().split(/\s+/);
      const searchConditions = searchTerms
        .map(() => "ci.title LIKE ?")
        .join(" AND ");
      conditions.push(`(${searchConditions})`);
      searchTerms.forEach((term) => {
        queryParams.push(`%${term}%`);
      });
    }

    // 8. 사용자 선택 필터들 (단순화)
    if (brands) {
      const brandList = brands.split(",");
      conditions.push(`ci.brand IN (${brandList.map(() => "?").join(",")})`);
      queryParams.push(...brandList);
    }

    if (categories) {
      const categoryList = categories.split(",");
      conditions.push(
        `ci.category IN (${categoryList.map(() => "?").join(",")})`
      );
      queryParams.push(...categoryList);
    }

    if (scheduledDates) {
      const dateList = scheduledDates.split(",");
      const dateConds = [];
      dateList.forEach((date) => {
        if (date === "null") {
          dateConds.push("ci.scheduled_date IS NULL");
        } else {
          dateConds.push(`DATE(ci.scheduled_date) = ?`);
          queryParams.push(date);
        }
      });
      conditions.push(`(${dateConds.join(" OR ")})`);
    }

    if (ranks) {
      const rankList = ranks.split(",");
      conditions.push(`ci.rank IN (${rankList.map(() => "?").join(",")})`);
      queryParams.push(...rankList);
    }

    if (auctionTypes) {
      const auctionTypeList = auctionTypes.split(",");
      conditions.push(
        `ci.bid_type IN (${auctionTypeList.map(() => "?").join(",")})`
      );
      queryParams.push(...auctionTypeList);
    }

    if (aucNums) {
      const aucNumList = aucNums.split(",");
      conditions.push(`ci.auc_num IN (${aucNumList.map(() => "?").join(",")})`);
      queryParams.push(...aucNumList);
    }

    // 9. 최종 쿼리 조립
    let finalQuery = baseQuery;

    if (joins.length > 0) {
      finalQuery += " " + joins.join(" ");
    }

    if (conditions.length > 0) {
      finalQuery += " WHERE " + conditions.join(" AND ");
    }

    // 10. 정렬 (추천 점수 포함)
    let orderByClause;
    switch (sortBy) {
      case "recommend":
        orderByClause = "ci.recommend";
        break;
      case "title":
        orderByClause = "ci.title";
        break;
      case "rank":
        // MariaDB 호환 FIELD 사용
        orderByClause =
          "FIELD(ci.rank, 'N', 'S', 'A', 'AB', 'B', 'BC', 'C', 'D', 'E', 'F')";
        break;
      case "scheduled_date":
        orderByClause = "ci.scheduled_date";
        break;
      case "starting_price":
        // MariaDB 호환 숫자 변환
        orderByClause = "ci.starting_price + 0";
        break;
      case "brand":
        orderByClause = "ci.brand";
        break;
      default:
        orderByClause = "ci.scheduled_date";
    }

    const sortDirection = sortOrder.toLowerCase() === "desc" ? "DESC" : "ASC";
    finalQuery += ` ORDER BY ${orderByClause} ${sortDirection}`;

    // 11. 카운트 쿼리 (LIMIT 전에)
    const countQuery = `SELECT COUNT(*) as total FROM (${finalQuery}) as subquery`;

    // 12. 페이징 추가
    finalQuery += " LIMIT ? OFFSET ?";
    queryParams.push(parseInt(limit), offset);

    // 13. 쿼리 실행
    const [items] = await pool.query(finalQuery, queryParams);
    const [countResult] = await pool.query(
      countQuery,
      queryParams.slice(0, -2)
    );

    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    // 14. 위시리스트 조회
    let wishlist = [];
    if (userId) {
      [wishlist] = await pool.query(
        "SELECT item_id, favorite_number FROM wishlists WHERE user_id = ?",
        [userId]
      );
    }

    // 15. 입찰 정보 매핑
    const itemBidMap = {};
    bidData.forEach((bid) => {
      if (!itemBidMap[bid.item_id]) {
        itemBidMap[bid.item_id] = {};
      }
      itemBidMap[bid.item_id][bid.bid_type] = bid;
    });

    // 16. 상세 정보 처리 (필요시)
    let finalItems = items;
    if (withDetails === "true") {
      const limit = pLimit(5);
      const processItemsInBatches = async (items) => {
        const promises = items.map((item) =>
          limit(() => processItem(item.item_id, false, null, true, 2))
        );
        const processedItems = await Promise.all(promises);
        return processedItems.filter((item) => item !== null);
      };
      finalItems = await processItemsInBatches(items);
    }

    // 17. 최종 응답 구성
    const itemsWithBids = finalItems.map((item) => {
      const itemBids = itemBidMap[item.item_id] || {};
      return {
        ...item,
        bids: {
          live: itemBids.live || null,
          direct: itemBids.direct || null,
        },
      };
    });

    res.json({
      data: itemsWithBids,
      wishlist,
      page: parseInt(page),
      limit: parseInt(limit),
      totalItems,
      totalPages,
    });
  } catch (error) {
    console.error("Error fetching data from database:", error);
    res.status(500).json({ message: "Error fetching data" });
  }
});

// ===== 추천 아이템 조회 라우터 =====
router.get("/recommended", async (req, res) => {
  const { limit = 10, minScore = 1 } = req.query;

  try {
    await syncItemsWithRecommendSettings();

    const [items] = await pool.query(
      `
      SELECT ci.* FROM crawled_items ci
      WHERE ci.is_enabled = 1 AND ci.recommend >= ?
      ORDER BY ci.recommend DESC, ci.scheduled_date ASC
      LIMIT ?
    `,
      [parseInt(minScore), parseInt(limit)]
    );

    res.json(items);
  } catch (error) {
    console.error("Error fetching recommended items:", error);
    res.status(500).json({ message: "Error fetching recommended items" });
  }
});

// ===== 통계와 함께 브랜드 조회 =====
router.get("/brands-with-count", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.withStats.brands, STATS_CACHE_DURATION)) {
      return res.json(cache.filters.withStats.brands.data);
    }

    const { conditions, queryParams } = await buildBaseFilterConditions();

    const [results] = await pool.query(
      `SELECT ci.brand, COUNT(*) as count
       FROM crawled_items ci
       WHERE ${conditions.join(" AND ")}
       GROUP BY ci.brand
       ORDER BY count DESC, ci.brand ASC`,
      queryParams
    );

    updateCache(cache.filters.withStats.brands, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching brands with count:", error);
    res.status(500).json({ message: "Error fetching brands with count" });
  }
});

// ===== 경매 타입 조회 =====
router.get("/auction-types", async (req, res) => {
  try {
    if (
      isCacheValid(cache.filters.withStats.auctionTypes, STATS_CACHE_DURATION)
    ) {
      return res.json(cache.filters.withStats.auctionTypes.data);
    }

    const { conditions, queryParams } = await buildBaseFilterConditions();

    const [results] = await pool.query(
      `SELECT ci.bid_type, COUNT(*) as count
       FROM crawled_items ci
       WHERE ${conditions.join(" AND ")} AND ci.bid_type IS NOT NULL
       GROUP BY ci.bid_type
       ORDER BY count DESC`,
      queryParams
    );

    updateCache(cache.filters.withStats.auctionTypes, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching auction types:", error);
    res.status(500).json({ message: "Error fetching auction types" });
  }
});

// ===== 통계와 함께 날짜 조회 =====
router.get("/scheduled-dates-with-count", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.withStats.dates, STATS_CACHE_DURATION)) {
      return res.json(cache.filters.withStats.dates.data);
    }

    const { conditions, queryParams } = await buildBaseFilterConditions();

    const [results] = await pool.query(
      `SELECT DATE(ci.scheduled_date) as Date, COUNT(*) as count
       FROM crawled_items ci
       WHERE ${conditions.join(" AND ")}
       GROUP BY DATE(ci.scheduled_date)
       ORDER BY Date ASC`,
      queryParams
    );

    updateCache(cache.filters.withStats.dates, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching scheduled dates with count:", error);
    res
      .status(500)
      .json({ message: "Error fetching scheduled dates with count" });
  }
});

// ===== 단순 필터 조회 API들 =====
router.get("/brands", async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT DISTINCT ci.brand 
      FROM crawled_items ci 
      WHERE ci.is_enabled = 1 AND ci.brand IS NOT NULL AND ci.brand != ''
      ORDER BY ci.brand
    `);

    res.json(results.map((row) => row.brand));
  } catch (error) {
    console.error("Error fetching brands:", error);
    res.status(500).json({ message: "Error fetching brands" });
  }
});

router.get("/categories", async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT DISTINCT ci.category 
      FROM crawled_items ci 
      WHERE ci.is_enabled = 1 AND ci.category IS NOT NULL AND ci.category != ''
      ORDER BY ci.category
    `);

    res.json(results.map((row) => row.category));
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ message: "Error fetching categories" });
  }
});

// ===== 경매번호 조회 =====
router.get("/auc-nums", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.withStats.aucNums, STATS_CACHE_DURATION)) {
      return res.json(cache.filters.withStats.aucNums.data);
    }

    const { conditions, queryParams } = await buildBaseFilterConditions();

    const [results] = await pool.query(
      `SELECT ci.auc_num, COUNT(*) as count
       FROM crawled_items ci
       WHERE ${conditions.join(" AND ")} AND ci.auc_num IS NOT NULL
       GROUP BY ci.auc_num
       ORDER BY ci.auc_num ASC`,
      queryParams
    );

    updateCache(cache.filters.withStats.aucNums, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching auction numbers:", error);
    res.status(500).json({ message: "Error fetching auction numbers" });
  }
});

// ===== 환율 조회 =====
router.get("/exchange-rate", async (req, res) => {
  try {
    if (isCacheValid(cache.exchange, EXCHANGE_CACHE_DURATION)) {
      return res.json({ rate: cache.exchange.data });
    }

    const response = await axios.get(apiUrl);
    const rate = response.data.rates.KRW / response.data.rates.JPY;

    updateCache(cache.exchange, rate);
    res.json({ rate });
  } catch (error) {
    console.error("Error fetching exchange rate:", error);

    if (cache.exchange.data !== null) {
      return res.json({
        rate: cache.exchange.data,
        cached: true,
        error: "Failed to fetch new exchange rate, using cached data",
      });
    }

    res.status(500).json({ error: "Failed to fetch exchange rate" });
  }
});

// ===== 등급 조회 =====
router.get("/ranks", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.withStats.ranks, STATS_CACHE_DURATION)) {
      return res.json(cache.filters.withStats.ranks.data);
    }

    const [results] = await pool.query(
      `SELECT ci.rank, COUNT(*) as count
       FROM crawled_items ci
       WHERE ci.is_enabled = 1
       GROUP BY ci.rank
       ORDER BY FIELD(ci.rank, 'N', 'S', 'A', 'AB', 'B', 'BC', 'C', 'D', 'E', 'F')`
    );

    updateCache(cache.filters.withStats.ranks, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching ranks:", error);
    res.status(500).json({ message: "Error fetching ranks" });
  }
});

// ===== 캐시 무효화 =====
router.post("/invalidate-cache", (req, res) => {
  try {
    const { type, subType } = req.body;

    if (!req.session.user?.isAdmin) {
      return res
        .status(403)
        .json({ message: "Unauthorized: Admin access required" });
    }

    invalidateCache(type, subType);
    res.json({ message: "Cache invalidated successfully" });
  } catch (error) {
    console.error("Error invalidating cache:", error);
    res.status(500).json({ message: "Error invalidating cache" });
  }
});

module.exports = router;
