// routes/data.js - MariaDB 호환 버전
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

// ===== 캐시 설정 =====
const CACHE_DURATION = 60 * 60 * 1000; // 1시간

const cache = {
  exchange: { data: null, lastFetched: null },
  enabledFilters: { data: null, lastFetched: null },
  stats: {
    brands: { data: null, lastFetched: null },
    dates: { data: null, lastFetched: null },
    aucNums: { data: null, lastFetched: null },
    ranks: { data: null, lastFetched: null },
    auctionTypes: { data: null, lastFetched: null },
  },
};

// ===== 캐시 헬퍼 함수 =====
function isCacheValid(cacheItem) {
  return (
    cacheItem.data !== null &&
    cacheItem.lastFetched !== null &&
    Date.now() - cacheItem.lastFetched < CACHE_DURATION
  );
}

function updateCache(cacheItem, data) {
  cacheItem.data = data;
  cacheItem.lastFetched = Date.now();
}

function invalidateAllCache() {
  Object.keys(cache).forEach((key) => {
    if (cache[key].data !== undefined) {
      cache[key].data = null;
      cache[key].lastFetched = null;
    } else {
      Object.keys(cache[key]).forEach((subKey) => {
        cache[key][subKey].data = null;
        cache[key][subKey].lastFetched = null;
      });
    }
  });
}

// ===== 활성화된 필터 조회 =====
async function getEnabledFilters() {
  if (isCacheValid(cache.enabledFilters)) {
    return cache.enabledFilters.data;
  }

  const [results] = await pool.query(`
    SELECT filter_type, GROUP_CONCAT(filter_value) as values
    FROM filter_settings 
    WHERE is_enabled = 1
    GROUP BY filter_type
  `);

  const enabledFilters = {
    brand: [],
    category: [],
    date: [],
  };

  results.forEach((row) => {
    if (row.values) {
      enabledFilters[row.filter_type] = row.values.split(",");
    }
  });

  updateCache(cache.enabledFilters, enabledFilters);
  return enabledFilters;
}

// ===== 메인 데이터 조회 =====
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

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const userId = req.session.user?.id;

  try {
    // 활성화된 필터 조회
    const enabledFilters = await getEnabledFilters();

    // 사용자 입찰 데이터 조회
    let userBidItemIds = [];
    let bidDataMap = {};

    if (userId) {
      const [bidResults] = await pool.query(
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

      bidResults.forEach((bid) => {
        if (!bidDataMap[bid.item_id]) {
          bidDataMap[bid.item_id] = {};
        }
        bidDataMap[bid.item_id][bid.bid_type] = bid;
        userBidItemIds.push(bid.item_id);
      });
    }

    // 쿼리 구성
    let query = "SELECT ci.* FROM crawled_items ci";
    const joins = [];
    const conditions = [];
    const params = [];

    // 즐겨찾기 JOIN
    if (favoriteNumbers && userId) {
      const favNumbers = favoriteNumbers
        .split(",")
        .map((n) => parseInt(n))
        .filter((n) => !isNaN(n));
      if (favNumbers.length > 0) {
        joins.push("INNER JOIN wishlists w ON ci.item_id = w.item_id");
        conditions.push("w.user_id = ?");
        conditions.push(
          `w.favorite_number IN (${favNumbers.map(() => "?").join(",")})`
        );
        params.push(userId, ...favNumbers);
      }
    }

    // 기본 조건들
    if (excludeExpired === "true") {
      conditions.push(`(
        (ci.bid_type = 'direct' AND ci.scheduled_date > NOW()) OR
        (ci.bid_type = 'live' AND (
          ci.scheduled_date > NOW() OR 
          (DATE(ci.scheduled_date) = CURDATE() AND HOUR(NOW()) < 13)
        ))
      )`);
    }

    // 입찰한 아이템만
    if (bidsOnly === "true" && userId) {
      if (userBidItemIds.length > 0) {
        const uniqueItemIds = [...new Set(userBidItemIds)];
        conditions.push(
          `ci.item_id IN (${uniqueItemIds.map(() => "?").join(",")})`
        );
        params.push(...uniqueItemIds);
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

    // 검색
    if (search && search.trim()) {
      const searchTerms = search.trim().split(/\s+/);
      conditions.push(
        `(${searchTerms.map(() => "ci.title LIKE ?").join(" AND ")})`
      );
      searchTerms.forEach((term) => params.push(`%${term}%`));
    }

    // 브랜드 필터
    let effectiveBrands = enabledFilters.brand;
    if (brands) {
      const selectedBrands = brands.split(",");
      effectiveBrands = selectedBrands.filter((b) =>
        enabledFilters.brand.includes(b)
      );
    }
    if (effectiveBrands.length > 0) {
      conditions.push(
        `ci.brand IN (${effectiveBrands.map(() => "?").join(",")})`
      );
      params.push(...effectiveBrands);
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

    // 카테고리 필터
    let effectiveCategories = enabledFilters.category;
    if (categories) {
      const selectedCategories = categories.split(",");
      effectiveCategories = selectedCategories.filter((c) =>
        enabledFilters.category.includes(c)
      );
    }
    if (effectiveCategories.length > 0) {
      conditions.push(
        `ci.category IN (${effectiveCategories.map(() => "?").join(",")})`
      );
      params.push(...effectiveCategories);
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

    // 날짜 필터
    if (scheduledDates) {
      const dateList = scheduledDates.split(",");
      const hasNull = dateList.includes("null");
      const actualDates = dateList.filter((d) => d !== "null");

      if (hasNull && actualDates.length > 0) {
        const validDates = actualDates.filter((d) =>
          enabledFilters.date.includes(d)
        );
        if (validDates.length > 0) {
          conditions.push(
            `(ci.scheduled_date IS NULL OR DATE(ci.scheduled_date) IN (${validDates
              .map(() => "?")
              .join(",")}))`
          );
          params.push(...validDates);
        } else {
          conditions.push("ci.scheduled_date IS NULL");
        }
      } else if (hasNull) {
        conditions.push("ci.scheduled_date IS NULL");
      } else if (actualDates.length > 0) {
        const validDates = actualDates.filter((d) =>
          enabledFilters.date.includes(d)
        );
        if (validDates.length > 0) {
          conditions.push(
            `DATE(ci.scheduled_date) IN (${validDates
              .map(() => "?")
              .join(",")})`
          );
          params.push(...validDates);
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
    } else if (enabledFilters.date.length > 0) {
      conditions.push(
        `DATE(ci.scheduled_date) IN (${enabledFilters.date
          .map(() => "?")
          .join(",")})`
      );
      params.push(...enabledFilters.date);
    }

    // 기타 필터들
    if (ranks) {
      const rankList = ranks.split(",");
      conditions.push(`ci.rank IN (${rankList.map(() => "?").join(",")})`);
      params.push(...rankList);
    }

    if (auctionTypes) {
      const typeList = auctionTypes.split(",");
      conditions.push(`ci.bid_type IN (${typeList.map(() => "?").join(",")})`);
      params.push(...typeList);
    }

    if (aucNums) {
      const numList = aucNums.split(",");
      conditions.push(`ci.auc_num IN (${numList.map(() => "?").join(",")})`);
      params.push(...numList);
    }

    // 쿼리 완성
    if (joins.length > 0) {
      query += " " + joins.join(" ");
    }
    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    // 정렬
    let orderBy = "ci.scheduled_date";
    switch (sortBy) {
      case "title":
        orderBy = "ci.title";
        break;
      case "rank":
        orderBy =
          "FIELD(ci.rank, 'N', 'S', 'A', 'AB', 'B', 'BC', 'C', 'D', 'E', 'F')";
        break;
      case "starting_price":
        orderBy = "ci.starting_price + 0";
        break;
      default:
        orderBy = "ci.scheduled_date";
    }

    const direction = sortOrder.toLowerCase() === "desc" ? "DESC" : "ASC";
    query += ` ORDER BY ${orderBy} ${direction}`;

    // 총 개수 쿼리
    const countQuery = `SELECT COUNT(*) as total FROM (${query}) as subquery`;

    // 페이징
    query += " LIMIT ? OFFSET ?";
    params.push(parseInt(limit), offset);

    // 쿼리 실행
    const [items] = await pool.query(query, params);
    const [countResult] = await pool.query(countQuery, params.slice(0, -2));

    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / parseInt(limit));

    // 위시리스트 조회
    let wishlist = [];
    if (userId) {
      [wishlist] = await pool.query(
        "SELECT item_id, favorite_number FROM wishlists WHERE user_id = ?",
        [userId]
      );
    }

    // 상세 정보 처리
    let finalItems = items;
    if (withDetails === "true") {
      const processingLimit = pLimit(5);
      const processPromises = items.map((item) =>
        processingLimit(() => processItem(item.item_id, false, null, true, 2))
      );
      const processedItems = await Promise.all(processPromises);
      finalItems = processedItems.filter((item) => item !== null);
    }

    // 입찰 정보 추가
    const itemsWithBids = finalItems.map((item) => ({
      ...item,
      bids: {
        live: bidDataMap[item.item_id]?.live || null,
        direct: bidDataMap[item.item_id]?.direct || null,
      },
    }));

    res.json({
      data: itemsWithBids,
      wishlist,
      page: parseInt(page),
      limit: parseInt(limit),
      totalItems,
      totalPages,
    });
  } catch (error) {
    console.error("Error fetching data:", error);
    res.status(500).json({ message: "데이터 조회 중 오류가 발생했습니다." });
  }
});

// ===== 통계 API들 =====
router.get("/brands-with-count", async (req, res) => {
  try {
    if (isCacheValid(cache.stats.brands)) {
      return res.json(cache.stats.brands.data);
    }

    const enabledFilters = await getEnabledFilters();
    const conditions = [];
    const params = [];

    if (enabledFilters.brand.length > 0) {
      conditions.push(
        `ci.brand IN (${enabledFilters.brand.map(() => "?").join(",")})`
      );
      params.push(...enabledFilters.brand);
    }
    if (enabledFilters.category.length > 0) {
      conditions.push(
        `ci.category IN (${enabledFilters.category.map(() => "?").join(",")})`
      );
      params.push(...enabledFilters.category);
    }
    if (enabledFilters.date.length > 0) {
      conditions.push(
        `DATE(ci.scheduled_date) IN (${enabledFilters.date
          .map(() => "?")
          .join(",")})`
      );
      params.push(...enabledFilters.date);
    }

    const whereClause =
      conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    const [results] = await pool.query(
      `
      SELECT ci.brand, COUNT(*) as count
      FROM crawled_items ci
      ${whereClause}
      GROUP BY ci.brand
      ORDER BY count DESC, ci.brand ASC
    `,
      params
    );

    updateCache(cache.stats.brands, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching brands with count:", error);
    res
      .status(500)
      .json({ message: "브랜드 통계 조회 중 오류가 발생했습니다." });
  }
});

router.get("/auction-types", async (req, res) => {
  try {
    if (isCacheValid(cache.stats.auctionTypes)) {
      return res.json(cache.stats.auctionTypes.data);
    }

    const [results] = await pool.query(`
      SELECT ci.bid_type, COUNT(*) as count
      FROM crawled_items ci
      WHERE ci.bid_type IS NOT NULL
      GROUP BY ci.bid_type
      ORDER BY count DESC
    `);

    updateCache(cache.stats.auctionTypes, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching auction types:", error);
    res.status(500).json({ message: "경매 타입 조회 중 오류가 발생했습니다." });
  }
});

router.get("/scheduled-dates-with-count", async (req, res) => {
  try {
    if (isCacheValid(cache.stats.dates)) {
      return res.json(cache.stats.dates.data);
    }

    const [results] = await pool.query(`
      SELECT DATE(ci.scheduled_date) as Date, COUNT(*) as count
      FROM crawled_items ci
      WHERE ci.scheduled_date IS NOT NULL
      GROUP BY DATE(ci.scheduled_date)
      ORDER BY Date ASC
    `);

    updateCache(cache.stats.dates, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching dates with count:", error);
    res.status(500).json({ message: "날짜 통계 조회 중 오류가 발생했습니다." });
  }
});

router.get("/brands", async (req, res) => {
  try {
    const enabledFilters = await getEnabledFilters();
    res.json(enabledFilters.brand);
  } catch (error) {
    console.error("Error fetching brands:", error);
    res
      .status(500)
      .json({ message: "브랜드 목록 조회 중 오류가 발생했습니다." });
  }
});

router.get("/categories", async (req, res) => {
  try {
    const enabledFilters = await getEnabledFilters();
    res.json(enabledFilters.category);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res
      .status(500)
      .json({ message: "카테고리 목록 조회 중 오류가 발생했습니다." });
  }
});

router.get("/auc-nums", async (req, res) => {
  try {
    if (isCacheValid(cache.stats.aucNums)) {
      return res.json(cache.stats.aucNums.data);
    }

    const [results] = await pool.query(`
      SELECT ci.auc_num, COUNT(*) as count
      FROM crawled_items ci
      WHERE ci.auc_num IS NOT NULL
      GROUP BY ci.auc_num
      ORDER BY ci.auc_num ASC
    `);

    updateCache(cache.stats.aucNums, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching auction numbers:", error);
    res.status(500).json({ message: "경매번호 조회 중 오류가 발생했습니다." });
  }
});

router.get("/ranks", async (req, res) => {
  try {
    if (isCacheValid(cache.stats.ranks)) {
      return res.json(cache.stats.ranks.data);
    }

    const [results] = await pool.query(`
      SELECT ci.rank, COUNT(*) as count
      FROM crawled_items ci
      WHERE ci.rank IS NOT NULL
      GROUP BY ci.rank
      ORDER BY FIELD(ci.rank, 'N', 'S', 'A', 'AB', 'B', 'BC', 'C', 'D', 'E', 'F')
    `);

    updateCache(cache.stats.ranks, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching ranks:", error);
    res.status(500).json({ message: "등급 통계 조회 중 오류가 발생했습니다." });
  }
});

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
        error: "최신 환율을 가져올 수 없어 캐시된 데이터를 사용합니다.",
      });
    }

    res.status(500).json({ error: "환율 조회에 실패했습니다." });
  }
});

router.post("/invalidate-cache", (req, res) => {
  try {
    if (!req.session.user?.isAdmin) {
      return res.status(403).json({ message: "관리자 권한이 필요합니다." });
    }

    invalidateAllCache();
    res.json({ message: "캐시가 성공적으로 무효화되었습니다." });
  } catch (error) {
    console.error("Error invalidating cache:", error);
    res.status(500).json({ message: "캐시 무효화 중 오류가 발생했습니다." });
  }
});

module.exports = router;
