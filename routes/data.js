// routes/data.js
const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const router = express.Router();
const axios = require("axios");
const { pool } = require("../utils/DB");
const { processItem } = require("../utils/processItem");

let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

const apiUrl = `https://api.currencyfreaks.com/v2.0/rates/latest?apikey=${process.env.CURRENCY_API_KEY}`;

// ===== 캐싱 관련 설정 =====
const CACHE_DURATION = 60 * 60 * 1000;

const cache = {
  exchange: {
    data: null,
    lastFetched: null,
  },
  filters: {
    enabled: { data: null, lastFetched: null },
    withStats: {
      brands: { data: null, lastFetched: null },
      dates: { data: null, lastFetched: null },
      aucNums: { data: null, lastFetched: null },
      ranks: { data: null, lastFetched: null },
      auctionTypes: { data: null, lastFetched: null },
    },
  },
};

// ===== 캐시 헬퍼 함수들 =====
function isCacheValid(cacheItem) {
  const currentTime = new Date().getTime();
  return (
    cacheItem.data !== null &&
    cacheItem.lastFetched !== null &&
    currentTime - cacheItem.lastFetched < CACHE_DURATION
  );
}

function updateCache(cacheItem, data) {
  cacheItem.data = data;
  cacheItem.lastFetched = new Date().getTime();
}

function invalidateCache(type, subType = null) {
  if (type === "all") {
    Object.keys(cache).forEach((key) => {
      if (typeof cache[key] === "object") {
        if (cache[key].data !== undefined) {
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
  } else if (type === "filters") {
    cache.filters.enabled.data = null;
    cache.filters.enabled.lastFetched = null;

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

// ===== 최적화된 필터 조회 함수 =====
async function getEnabledFilters() {
  if (isCacheValid(cache.filters.enabled)) {
    return cache.filters.enabled.data;
  }

  // GROUP_CONCAT 대신 개별 쿼리로 변경 (MariaDB 호환성)
  const [brandResults] = await pool.query(`
    SELECT filter_value
    FROM filter_settings 
    WHERE filter_type = 'brand' AND is_enabled = 1
  `);

  const [categoryResults] = await pool.query(`
    SELECT filter_value
    FROM filter_settings 
    WHERE filter_type = 'category' AND is_enabled = 1
  `);

  const [dateResults] = await pool.query(`
    SELECT filter_value
    FROM filter_settings 
    WHERE filter_type = 'date' AND is_enabled = 1
  `);

  const enabledMap = {
    brand: brandResults.map((row) => row.filter_value),
    category: categoryResults.map((row) => row.filter_value),
    date: dateResults.map((row) => row.filter_value),
  };

  updateCache(cache.filters.enabled, enabledMap);
  return enabledMap;
}

async function buildBaseFilterConditions() {
  const enabledFilters = await getEnabledFilters();
  const enabledBrands = enabledFilters.brand || [];
  const enabledCategories = enabledFilters.category || [];
  const enabledDates = enabledFilters.date || [];

  const conditions = [];
  const queryParams = [];

  if (enabledBrands.length > 0) {
    conditions.push(`ci.brand IN (${enabledBrands.map(() => "?").join(",")})`);
    queryParams.push(...enabledBrands);
  } else {
    conditions.push("1=0");
  }

  if (enabledCategories.length > 0) {
    conditions.push(
      `ci.category IN (${enabledCategories.map(() => "?").join(",")})`
    );
    queryParams.push(...enabledCategories);
  } else {
    conditions.push("1=0");
  }

  if (enabledDates.length > 0) {
    conditions.push(
      `DATE(ci.scheduled_date) IN (${enabledDates.map(() => "?").join(",")})`
    );
    queryParams.push(...enabledDates);
  }

  return { conditions, queryParams };
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
  } = req.query;

  const offset = (page - 1) * limit;
  const userId = req.session.user?.id;

  try {
    // 1. 활성화된 필터 조회
    const enabledFilters = await getEnabledFilters();
    const enabledBrands = enabledFilters.brand || [];
    const enabledCategories = enabledFilters.category || [];
    const enabledDates = enabledFilters.date || [];

    // 2. 사용자 입찰 데이터 조회 (통합 쿼리)
    let bidData = [];
    let userBidItemIds = [];

    if (userId) {
      const [userBids] = await pool.query(
        `
        SELECT 'live' as bid_type, item_id, first_price, second_price, final_price, status, id
        FROM live_bids WHERE user_id = ?
        UNION ALL
        SELECT 'direct' as bid_type, item_id, current_price as first_price, 
               NULL as second_price, NULL as final_price, status, id
        FROM direct_bids WHERE user_id = ?
      `,
        [userId, userId]
      );

      bidData = userBids;
      if (bidsOnly === "true") {
        userBidItemIds = bidData.map((bid) => bid.item_id);
      }
    }

    // 3. 쿼리 구성 시작
    let baseQuery = "SELECT ci.* FROM crawled_items ci";
    const joins = [];
    const conditions = [];
    const queryParams = [];

    // 4. 즐겨찾기 필터 (JOIN 추가)
    if (favoriteNumbers && userId) {
      const favoriteNumbersList = favoriteNumbers.split(",").map(Number);
      if (favoriteNumbersList.length > 0) {
        joins.push(
          "INNER JOIN wishlists w ON ci.item_id = w.item_id AND w.user_id = ?"
        );
        queryParams.push(userId);
        conditions.push(
          `w.favorite_number IN (${favoriteNumbersList
            .map(() => "?")
            .join(",")})`
        );
        queryParams.push(...favoriteNumbersList);
      }
    }

    // // 5. 기본 조건들
    // if (excludeExpired === "true") {
    //   conditions.push(`
    //     ci.original_scheduled_date > NOW()) OR
    //     (ci.bid_type = 'live' AND
    //     (ci.scheduled_date > NOW() OR
    //       (DATE(ci.scheduled_date) = DATE(NOW()) AND HOUR(NOW()) < 13)))
    //   `);
    // }

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

    // 6. 검색 조건
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

    // 7. 브랜드 필터 (활성화된 브랜드와 사용자 선택의 교집합)
    let effectiveBrands = enabledBrands;
    if (brands) {
      const selectedBrands = brands.split(",");
      effectiveBrands = selectedBrands.filter((brand) =>
        enabledBrands.map((b) => b.toLowerCase()).includes(brand.toLowerCase())
      );
    }

    if (effectiveBrands.length > 0) {
      conditions.push(
        `ci.brand IN (${effectiveBrands.map(() => "?").join(",")})`
      );
      queryParams.push(...effectiveBrands);
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

    // 8. 카테고리 필터
    let effectiveCategories = enabledCategories;
    if (categories) {
      const selectedCategories = categories.split(",");
      effectiveCategories = selectedCategories.filter((cat) =>
        enabledCategories.includes(cat)
      );
    }

    if (effectiveCategories.length > 0) {
      conditions.push(
        `ci.category IN (${effectiveCategories.map(() => "?").join(",")})`
      );
      queryParams.push(...effectiveCategories);
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

    // 9. 날짜 필터
    // 9. 날짜 필터
    let effectiveDates = enabledDates.map((date) => {
      // filter_settings의 datetime을 YYYY-MM-DD 형식으로 변환
      return date.substring(0, 10);
    });

    if (scheduledDates) {
      const selectedDates = scheduledDates.split(",");
      effectiveDates = selectedDates.filter((date) => {
        if (date === "null") {
          return true;
        }
        return effectiveDates.includes(date);
      });
    }

    if (effectiveDates.length > 0) {
      const dateConds = [];
      effectiveDates.forEach((date) => {
        if (date === "null") {
          dateConds.push("ci.scheduled_date IS NULL");
        } else {
          dateConds.push(`DATE(ci.scheduled_date) = ?`);
          queryParams.push(date);
        }
      });
      conditions.push(`(${dateConds.join(" OR ")})`);
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

    // 10. 기타 필터들
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

    // 11. 최종 쿼리 조립
    let finalQuery = baseQuery;

    if (joins.length > 0) {
      finalQuery += " " + joins.join(" ");
    }

    if (conditions.length > 0) {
      finalQuery += " WHERE " + conditions.join(" AND ");
    }

    // 12. 정렬 (MariaDB 호환)
    let orderByClause;
    switch (sortBy) {
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
      default:
        orderByClause = "ci.scheduled_date";
    }

    const sortDirection = sortOrder.toLowerCase() === "desc" ? "DESC" : "ASC";
    finalQuery += ` ORDER BY ${orderByClause} ${sortDirection}`;

    // 13. 카운트 쿼리 (LIMIT 전에)
    const countQuery = `SELECT COUNT(*) as total FROM (${finalQuery}) as subquery`;

    // 14. 페이징 추가
    finalQuery += " LIMIT ? OFFSET ?";
    queryParams.push(parseInt(limit), offset);

    // 15. 쿼리 실행
    const [items] = await pool.query(finalQuery, queryParams);
    const [countResult] = await pool.query(
      countQuery,
      queryParams.slice(0, -2)
    );

    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    // 16. 위시리스트 조회
    let wishlist = [];
    if (userId) {
      [wishlist] = await pool.query(
        "SELECT item_id, favorite_number FROM wishlists WHERE user_id = ?",
        [userId]
      );
    }

    // 17. 입찰 정보 매핑
    const itemBidMap = {};
    bidData.forEach((bid) => {
      if (!itemBidMap[bid.item_id]) {
        itemBidMap[bid.item_id] = {};
      }
      itemBidMap[bid.item_id][bid.bid_type] = bid;
    });

    // 18. 상세 정보 처리 (필요시)
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

    // 19. 최종 응답 구성
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

// ===== 통계와 함께 브랜드 조회 (enabled만) =====
router.get("/brands-with-count", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.withStats.brands)) {
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

// ===== 경매 타입 조회 (enabled만) =====
router.get("/auction-types", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.withStats.auctionTypes)) {
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

// ===== 통계와 함께 날짜 조회 (enabled만) =====
router.get("/scheduled-dates-with-count", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.withStats.dates)) {
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

// ===== 단순 필터 조회 API들 (enabled만) =====
router.get("/brands", async (req, res) => {
  try {
    const enabledFilters = await getEnabledFilters();
    res.json(enabledFilters.brand || []);
  } catch (error) {
    console.error("Error fetching brands:", error);
    res.status(500).json({ message: "Error fetching brands" });
  }
});

router.get("/categories", async (req, res) => {
  try {
    const enabledFilters = await getEnabledFilters();
    res.json(enabledFilters.category || []);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ message: "Error fetching categories" });
  }
});

// ===== 경매번호 조회 (enabled만) =====
router.get("/auc-nums", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.withStats.aucNums)) {
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
    if (isCacheValid(cache.exchange)) {
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

// ===== 등급 조회 (enabled만) =====
router.get("/ranks", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.withStats.ranks)) {
      return res.json(cache.filters.withStats.ranks.data);
    }

    const [results] = await pool.query(
      `SELECT ci.rank, COUNT(*) as count
       FROM crawled_items ci
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
