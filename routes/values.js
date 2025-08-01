// routes/values.js
const express = require("express");
const router = express.Router();
const { pool } = require("../utils/DB");
const { processItem } = require("../utils/processItem");

let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

// ===== 캐시 설정 =====
const CACHE_DURATION = 60 * 60 * 1000; // 1시간

const cache = {
  filters: {
    brands: { data: null, lastFetched: null },
    categories: { data: null, lastFetched: null },
  },
  stats: {
    brands: { data: null, lastFetched: null },
    dates: { data: null, lastFetched: null },
    aucNums: { data: null, lastFetched: null },
    ranks: { data: null, lastFetched: null },
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
  Object.keys(cache).forEach((category) => {
    Object.keys(cache[category]).forEach((item) => {
      cache[category][item].data = null;
      cache[category][item].lastFetched = null;
    });
  });
}

// ===== 메인 데이터 조회 =====
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

  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    // 쿼리 구성
    let query = "SELECT * FROM values_items";
    const conditions = [];
    const params = [];

    // 검색 조건
    if (search && search.trim()) {
      const searchTerms = search.trim().split(/\s+/);
      conditions.push(
        `(${searchTerms.map(() => "title LIKE ?").join(" AND ")})`
      );
      searchTerms.forEach((term) => params.push(`%${term}%`));
    }

    // 등급 필터
    if (ranks) {
      const rankList = ranks.split(",").filter((r) => r.trim());
      if (rankList.length > 0) {
        conditions.push(`rank IN (${rankList.map(() => "?").join(",")})`);
        params.push(...rankList);
      }
    }

    // 브랜드 필터
    if (brands) {
      const brandList = brands.split(",").filter((b) => b.trim());
      if (brandList.length > 0) {
        conditions.push(`brand IN (${brandList.map(() => "?").join(",")})`);
        params.push(...brandList);
      }
    }

    // 카테고리 필터
    if (categories) {
      const categoryList = categories.split(",").filter((c) => c.trim());
      if (categoryList.length > 0) {
        conditions.push(
          `category IN (${categoryList.map(() => "?").join(",")})`
        );
        params.push(...categoryList);
      }
    }

    // 날짜 필터
    if (scheduledDates) {
      const dateList = scheduledDates.split(",").filter((d) => d.trim());
      if (dateList.length > 0) {
        conditions.push(
          `DATE(scheduled_date) IN (${dateList.map(() => "?").join(",")})`
        );
        params.push(...dateList);
      }
    }

    // 경매번호 필터
    if (aucNums) {
      const aucNumList = aucNums.split(",").filter((a) => a.trim());
      if (aucNumList.length > 0) {
        conditions.push(`auc_num IN (${aucNumList.map(() => "?").join(",")})`);
        params.push(...aucNumList);
      }
    }

    // WHERE 절 추가
    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    // 정렬
    let orderBy = "scheduled_date";
    switch (sortBy) {
      case "title":
        orderBy = "title";
        break;
      case "rank":
        orderBy =
          "FIELD(rank, 'N', 'S', 'A', 'AB', 'B', 'BC', 'C', 'D', 'E', 'F')";
        break;
      case "starting_price":
      case "final_price":
        orderBy = "final_price + 0";
        break;
      default:
        orderBy = "scheduled_date";
    }

    const direction = sortOrder.toLowerCase() === "desc" ? "DESC" : "ASC";
    query += ` ORDER BY ${orderBy} ${direction}`;

    // 보조 정렬 (동일한 값일 때 item_id로 정렬)
    if (orderBy !== "item_id") {
      query += ", item_id DESC";
    }

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

    // 상세 정보 처리 (필요시)
    let finalItems = items;
    if (withDetails === "true") {
      const processingLimit = pLimit(3); // 대용량 데이터이므로 3으로 제한

      const processPromises = items.map((item) =>
        processingLimit(() => processItem(item.item_id, true, null, true, 2))
      );

      const processedItems = await Promise.all(processPromises);
      finalItems = processedItems.filter((item) => item !== null);
    }

    res.json({
      data: finalItems,
      page: parseInt(page),
      limit: parseInt(limit),
      totalItems,
      totalPages,
    });
  } catch (error) {
    console.error("Error fetching values data:", error);
    res.status(500).json({ message: "데이터 조회 중 오류가 발생했습니다." });
  }
});

// ===== 브랜드 통계 =====
router.get("/brands-with-count", async (req, res) => {
  try {
    if (isCacheValid(cache.stats.brands)) {
      return res.json(cache.stats.brands.data);
    }

    const [results] = await pool.query(`
      SELECT brand, COUNT(*) as count
      FROM values_items
      WHERE brand IS NOT NULL
      GROUP BY brand
      ORDER BY count DESC, brand ASC
    `);

    updateCache(cache.stats.brands, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching brands with count:", error);
    res
      .status(500)
      .json({ message: "브랜드 통계 조회 중 오류가 발생했습니다." });
  }
});

// ===== 날짜 통계 =====
router.get("/scheduled-dates-with-count", async (req, res) => {
  try {
    if (isCacheValid(cache.stats.dates)) {
      return res.json(cache.stats.dates.data);
    }

    const [results] = await pool.query(`
      SELECT DATE(scheduled_date) as Date, COUNT(*) as count
      FROM values_items
      WHERE scheduled_date IS NOT NULL
      GROUP BY DATE(scheduled_date)
      ORDER BY Date ASC
    `);

    updateCache(cache.stats.dates, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching dates with count:", error);
    res.status(500).json({ message: "날짜 통계 조회 중 오류가 발생했습니다." });
  }
});

// ===== 브랜드 목록 =====
router.get("/brands", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.brands)) {
      return res.json(cache.filters.brands.data);
    }

    const [results] = await pool.query(`
      SELECT DISTINCT brand 
      FROM values_items 
      WHERE brand IS NOT NULL
      ORDER BY brand ASC
    `);

    const brandsList = results.map((row) => row.brand);
    updateCache(cache.filters.brands, brandsList);
    res.json(brandsList);
  } catch (error) {
    console.error("Error fetching brands:", error);
    res
      .status(500)
      .json({ message: "브랜드 목록 조회 중 오류가 발생했습니다." });
  }
});

// ===== 카테고리 목록 =====
router.get("/categories", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.categories)) {
      return res.json(cache.filters.categories.data);
    }

    const [results] = await pool.query(`
      SELECT DISTINCT category 
      FROM values_items 
      WHERE category IS NOT NULL
      ORDER BY category ASC
    `);

    const categoriesList = results.map((row) => row.category);
    updateCache(cache.filters.categories, categoriesList);
    res.json(categoriesList);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res
      .status(500)
      .json({ message: "카테고리 목록 조회 중 오류가 발생했습니다." });
  }
});

// ===== 등급 통계 =====
router.get("/ranks", async (req, res) => {
  try {
    if (isCacheValid(cache.stats.ranks)) {
      return res.json(cache.stats.ranks.data);
    }

    const [results] = await pool.query(`
      SELECT rank, COUNT(*) as count
      FROM values_items
      WHERE rank IS NOT NULL
      GROUP BY rank
      ORDER BY FIELD(rank, 'N', 'S', 'A', 'AB', 'B', 'BC', 'C', 'D', 'E', 'F')
    `);

    updateCache(cache.stats.ranks, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching ranks:", error);
    res.status(500).json({ message: "등급 통계 조회 중 오류가 발생했습니다." });
  }
});

// ===== 경매번호 통계 =====
router.get("/auc-nums", async (req, res) => {
  try {
    if (isCacheValid(cache.stats.aucNums)) {
      return res.json(cache.stats.aucNums.data);
    }

    const [results] = await pool.query(`
      SELECT auc_num, COUNT(*) as count
      FROM values_items
      WHERE auc_num IS NOT NULL
      GROUP BY auc_num
      ORDER BY auc_num ASC
    `);

    updateCache(cache.stats.aucNums, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching auction numbers:", error);
    res.status(500).json({ message: "경매번호 조회 중 오류가 발생했습니다." });
  }
});

// ===== 캐시 무효화 =====
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
