// routes/values.js
const express = require("express");
const router = express.Router();
const { pool } = require("../utils/DB");
const { processItem } = require("../utils/processItem");

let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

// ===== 캐싱 관련 설정 =====
const CACHE_DURATION = 60 * 60 * 1000;

const cache = {
  filters: {
    enabled: { data: null, lastFetched: null },
    withStats: {
      brands: { data: null, lastFetched: null },
      dates: { data: null, lastFetched: null },
      aucNums: { data: null, lastFetched: null },
      ranks: { data: null, lastFetched: null },
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
    Object.keys(cache.filters).forEach((key) => {
      if (typeof cache.filters[key] === "object") {
        if (cache.filters[key].data !== undefined) {
          cache.filters[key].data = null;
          cache.filters[key].lastFetched = null;
        } else {
          Object.keys(cache.filters[key]).forEach((item) => {
            cache.filters[key][item].data = null;
            cache.filters[key][item].lastFetched = null;
          });
        }
      }
    });
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
  }
}

// ===== 메인 데이터 조회 라우터 (최적화) =====
router.get("/", async (req, res) => {
  const {
    page = 1,
    limit = 20,
    brands,
    categories,
    scheduledDates,
    aucNums,
    search,
    ranks,
    withDetails = "false",
    sortBy = "scheduled_date",
    sortOrder = "asc",
  } = req.query;

  const offset = (page - 1) * limit;

  try {
    // 쿼리 구성
    let baseQuery = "SELECT * FROM values_items";
    const conditions = [];
    const queryParams = [];

    // 검색 조건
    if (search && search.trim()) {
      const searchTerms = search.trim().split(/\s+/);
      const searchConditions = searchTerms
        .map(() => "title LIKE ?")
        .join(" AND ");
      conditions.push(`(${searchConditions})`);
      searchTerms.forEach((term) => {
        queryParams.push(`%${term}%`);
      });
    }

    // 등급 필터 (간단한 IN 절로 변경)
    if (ranks) {
      const rankList = ranks.split(",");
      conditions.push(`rank IN (${rankList.map(() => "?").join(",")})`);
      queryParams.push(...rankList);
    }

    // 브랜드 필터
    if (brands) {
      const brandList = brands.split(",");
      conditions.push(`brand IN (${brandList.map(() => "?").join(",")})`);
      queryParams.push(...brandList);
    }

    // 카테고리 필터
    if (categories) {
      const categoryList = categories.split(",");
      conditions.push(`category IN (${categoryList.map(() => "?").join(",")})`);
      queryParams.push(...categoryList);
    }

    // 날짜 필터
    if (scheduledDates) {
      const dateList = scheduledDates.split(",");
      conditions.push(
        `DATE(scheduled_date) IN (${dateList.map(() => "?").join(",")})`
      );
      queryParams.push(...dateList);
    }

    // 경매번호 필터
    if (aucNums) {
      const aucNumList = aucNums.split(",");
      conditions.push(`auc_num IN (${aucNumList.map(() => "?").join(",")})`);
      queryParams.push(...aucNumList);
    }

    // WHERE 절 추가
    if (conditions.length > 0) {
      baseQuery += " WHERE " + conditions.join(" AND ");
    }

    // 카운트 쿼리
    const countQuery = `SELECT COUNT(*) as total FROM (${baseQuery}) as subquery`;

    // 정렬
    let orderByClause;
    switch (sortBy) {
      case "title":
        orderByClause = "title";
        break;
      case "rank":
        orderByClause =
          "FIELD(rank, 'N', 'S', 'A', 'AB', 'B', 'BC', 'C', 'D', 'E', 'F')";
        break;
      case "scheduled_date":
        orderByClause = "scheduled_date";
        break;
      case "starting_price":
      case "final_price":
        orderByClause = "CAST(final_price AS DECIMAL(20,2))";
        break;
      default:
        orderByClause = "scheduled_date";
    }

    const sortDirection = sortOrder.toLowerCase() === "desc" ? "DESC" : "ASC";
    baseQuery += ` ORDER BY ${orderByClause} ${sortDirection}`;

    // 페이징
    baseQuery += " LIMIT ? OFFSET ?";
    queryParams.push(parseInt(limit), offset);

    // 쿼리 실행
    const [items] = await pool.query(baseQuery, queryParams);
    const [countResult] = await pool.query(
      countQuery,
      queryParams.slice(0, -2)
    );

    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    // 상세 정보 처리 (필요시)
    let finalItems = items;
    if (withDetails === "true") {
      const limit = pLimit(3); // 대용량 데이터이므로 동시 처리 수 줄임

      const processItemsInBatches = async (items) => {
        const promises = items.map((item) =>
          limit(() => processItem(item.item_id, true, null, true, 2))
        );
        const processedItems = await Promise.all(promises);
        return processedItems.filter((item) => item !== null);
      };

      finalItems = await processItemsInBatches(items);
    }

    res.json({
      data: finalItems,
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

// ===== 통계 쿼리들 (최적화) =====
router.get("/brands-with-count", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.withStats.brands)) {
      return res.json(cache.filters.withStats.brands.data);
    }

    const [results] = await pool.query(`
      SELECT brand, COUNT(*) as count
      FROM values_items
      WHERE brand IS NOT NULL
      GROUP BY brand
      ORDER BY count DESC, brand ASC
    `);

    updateCache(cache.filters.withStats.brands, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching brands with count:", error);
    res.status(500).json({ message: "Error fetching brands with count" });
  }
});

router.get("/scheduled-dates-with-count", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.withStats.dates)) {
      return res.json(cache.filters.withStats.dates.data);
    }

    const [results] = await pool.query(`
      SELECT DATE(CONVERT_TZ(scheduled_date, '+00:00', '+09:00')) as Date, COUNT(*) as count
      FROM values_items
      WHERE scheduled_date IS NOT NULL
      GROUP BY DATE(CONVERT_TZ(scheduled_date, '+00:00', '+09:00'))
      ORDER BY Date ASC
    `);

    updateCache(cache.filters.withStats.dates, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching scheduled dates with count:", error);
    res
      .status(500)
      .json({ message: "Error fetching scheduled dates with count" });
  }
});

router.get("/brands", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.enabled)) {
      return res.json(cache.filters.enabled.data?.brands || []);
    }

    const [results] = await pool.query(`
      SELECT DISTINCT brand 
      FROM values_items 
      WHERE brand IS NOT NULL
      ORDER BY brand ASC
    `);

    const brandsList = results.map((row) => row.brand);

    // 캐시에 brands만 저장하지 말고 전체 필터 구조로 저장
    const cacheData = cache.filters.enabled.data || {};
    cacheData.brands = brandsList;
    updateCache(cache.filters.enabled, cacheData);

    res.json(brandsList);
  } catch (error) {
    console.error("Error fetching brands:", error);
    res.status(500).json({ message: "Error fetching brands" });
  }
});

router.get("/categories", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.enabled)) {
      return res.json(cache.filters.enabled.data?.categories || []);
    }

    const [results] = await pool.query(`
      SELECT DISTINCT category 
      FROM values_items 
      WHERE category IS NOT NULL
      ORDER BY category ASC
    `);

    const categoriesList = results.map((row) => row.category);

    const cacheData = cache.filters.enabled.data || {};
    cacheData.categories = categoriesList;
    updateCache(cache.filters.enabled, cacheData);

    res.json(categoriesList);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ message: "Error fetching categories" });
  }
});

router.get("/ranks", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.withStats.ranks)) {
      return res.json(cache.filters.withStats.ranks.data);
    }

    const [results] = await pool.query(`
      SELECT rank, COUNT(*) as count
      FROM values_items
      WHERE rank IS NOT NULL
      GROUP BY rank
      ORDER BY FIELD(rank, 'N', 'S', 'A', 'AB', 'B', 'BC', 'C', 'D', 'E', 'F')
    `);

    updateCache(cache.filters.withStats.ranks, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching ranks:", error);
    res.status(500).json({ message: "Error fetching ranks" });
  }
});

router.get("/auc-nums", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.withStats.aucNums)) {
      return res.json(cache.filters.withStats.aucNums.data);
    }

    const [results] = await pool.query(`
      SELECT auc_num, COUNT(*) as count
      FROM values_items
      WHERE auc_num IS NOT NULL
      GROUP BY auc_num
      ORDER BY auc_num ASC
    `);

    updateCache(cache.filters.withStats.aucNums, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching auction numbers:", error);
    res.status(500).json({ message: "Error fetching auction numbers" });
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
