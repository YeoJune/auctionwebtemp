// routes/values.js
const express = require("express");
const router = express.Router();
const pool = require("../utils/DB");
const { processItem } = require("../utils/processItem");

let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

// ===== 캐싱 관련 설정 =====
// 기본 캐시 만료 시간: 1시간
const CACHE_DURATION = 60 * 60 * 1000;

// 캐시 저장소
const cache = {
  // 필터 데이터 캐시
  filters: {
    // 단순 목록 캐시
    lists: {
      brands: { data: null, lastFetched: null },
      categories: { data: null, lastFetched: null },
    },
    // 통계 정보가 포함된 필터 캐시
    withStats: {
      brands: { data: null, lastFetched: null },
      dates: { data: null, lastFetched: null },
      aucNums: { data: null, lastFetched: null },
      ranks: { data: null, lastFetched: null },
    },
  },
};

// 캐시 유효성 검사 함수
function isCacheValid(cacheItem) {
  const currentTime = new Date().getTime();
  return (
    cacheItem.data !== null &&
    cacheItem.lastFetched !== null &&
    currentTime - cacheItem.lastFetched < CACHE_DURATION
  );
}

// 캐시 업데이트 함수
function updateCache(cacheItem, data) {
  cacheItem.data = data;
  cacheItem.lastFetched = new Date().getTime();
}

// 캐시 무효화 함수
function invalidateCache(type, subType = null) {
  if (type === "all") {
    // 모든 캐시 초기화
    Object.keys(cache.filters).forEach((category) => {
      Object.keys(cache.filters[category]).forEach((item) => {
        cache.filters[category][item].data = null;
        cache.filters[category][item].lastFetched = null;
      });
    });
  } else if (type === "filters") {
    if (subType === null) {
      // 모든 필터 캐시 초기화
      Object.keys(cache.filters).forEach((category) => {
        Object.keys(cache.filters[category]).forEach((item) => {
          cache.filters[category][item].data = null;
          cache.filters[category][item].lastFetched = null;
        });
      });
    } else if (cache.filters.lists[subType]) {
      // 특정 목록 필터 캐시 초기화
      cache.filters.lists[subType].data = null;
      cache.filters.lists[subType].lastFetched = null;

      // 관련 통계 캐시도 초기화
      if (cache.filters.withStats[subType]) {
        cache.filters.withStats[subType].data = null;
        cache.filters.withStats[subType].lastFetched = null;
      }
    } else if (cache.filters.withStats[subType]) {
      // 특정 통계 필터 캐시만 초기화
      cache.filters.withStats[subType].data = null;
      cache.filters.withStats[subType].lastFetched = null;
    }
  }
}

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
    sortBy = "scheduled_date", // 정렬 기준 필드 (기본값: 제목)
    sortOrder = "asc", // 정렬 방향 (기본값: 오름차순)
  } = req.query;
  const offset = (page - 1) * limit;

  try {
    let query = "SELECT * FROM values_items";
    const queryParams = [];
    let conditions = [];

    if (search && search.trim()) {
      const searchTerms = search.trim().split(/\s+/);
      const searchConditions = searchTerms.map(() => "title LIKE ?");
      conditions.push(`(${searchConditions.join(" AND ")})`);
      searchTerms.forEach((term) => {
        queryParams.push(`%${term}%`);
      });
    }

    // 랭크 필터 처리 - LIKE 문 제거하고 직접 비교로 변경
    if (ranks) {
      const rankList = ranks.split(",");
      if (rankList.length > 0) {
        const rankConditions = rankList.map((rank) => {
          switch (rank) {
            case "N":
              return "rank = 'N'";
            case "S":
              return "rank = 'S'";
            case "AB":
              return "rank = 'AB'";
            case "A":
              return "rank = 'A'";
            case "BC":
              return "rank = 'BC'";
            case "B":
              return "rank = 'B'";
            case "C":
              return "rank = 'C'";
            case "D":
              return "rank = 'D'";
            case "E":
              return "rank = 'E'";
            case "F":
              return "rank = 'F'";
            default:
              return `rank = '${rank}'`;
          }
        });
        conditions.push(`(${rankConditions.join(" OR ")})`);
      }
    }

    if (brands) {
      const brandList = brands.split(",");
      if (brandList.length > 0) {
        conditions.push(
          "brand IN (" + brandList.map(() => "?").join(",") + ")"
        );
        queryParams.push(...brandList);
      }
    }

    if (categories) {
      const categoryList = categories.split(",");
      if (categoryList.length > 0) {
        conditions.push(
          "category IN (" + categoryList.map(() => "?").join(",") + ")"
        );
        queryParams.push(...categoryList);
      }
    }

    if (scheduledDates) {
      const dateList = scheduledDates.split(",");
      if (dateList.length > 0) {
        const dateConds = [];
        dateList.forEach((date) => {
          const match = date.match(/(\d{4}-\d{2}-\d{2})/);
          if (match) {
            dateConds.push("(scheduled_date >= ? AND scheduled_date < ?)");
            const startDate = new Date(match[0]);
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + 1);
            queryParams.push(startDate, endDate);
          }
        });
        if (dateConds.length > 0) {
          conditions.push(`(${dateConds.join(" OR ")})`);
        }
      }
    }

    if (aucNums) {
      const aucNumList = aucNums.split(",");
      if (aucNumList.length > 0) {
        conditions.push(`auc_num IN (${aucNumList.map(() => "?").join(",")})`);
        queryParams.push(...aucNumList);
      }
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    const countQuery = `SELECT COUNT(*) as total FROM (${query}) as subquery`;

    // 정렬 처리
    let orderByClause = "";
    switch (sortBy) {
      case "title":
        orderByClause = "title";
        break;
      case "rank":
        orderByClause = "rank";
        break;
      case "scheduled_date":
        orderByClause = "scheduled_date";
        break;
      case "starting_price":
      case "final_price":
        orderByClause = "final_price + 0";
        break;
      default:
        orderByClause = "title";
    }

    // 정렬 방향 설정
    const sortDirection = sortOrder.toLowerCase() === "desc" ? "DESC" : "ASC";
    query += ` ORDER BY ${orderByClause} ${sortDirection}`;

    if (orderByClause !== "item_id") {
      query += ", item_id DESC"; // 보조 정렬 기준으로 item_id 추가
    }

    query += " LIMIT ? OFFSET ?";
    queryParams.push(parseInt(limit), offset);

    const [items] = await pool.query(query, queryParams);
    const [countResult] = await pool.query(
      countQuery,
      queryParams.slice(0, -2)
    );
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    if (withDetails === "true") {
      // p-limit 적용하여 5개씩 처리하도록 수정
      const limit = pLimit(10); // 최대 5개의 동시 요청만 허용

      // 아이템을 5개씩 처리하는 함수
      const processItemsInBatches = async (items) => {
        // Promise.all 대신 p-limit으로 제한된 요청 생성
        const promises = items.map((item) =>
          limit(() => processItem(item.item_id, true, null, true))
        );

        // 모든 처리가 완료될 때까지 기다림
        const processedItems = await Promise.all(promises);

        // null이 아닌 아이템만 필터링
        return processedItems.filter((item) => item !== null);
      };

      const detailedItems = await processItemsInBatches(items);

      res.json({
        data: detailedItems.filter((item) => item !== null),
        page: parseInt(page),
        limit: parseInt(limit),
        totalItems,
        totalPages,
      });
    } else {
      res.json({
        data: items,
        page: parseInt(page),
        limit: parseInt(limit),
        totalItems,
        totalPages,
      });
    }
  } catch (error) {
    console.error("Error fetching data from database:", error);
    res.status(500).json({ message: "Error fetching data" });
  }
});

// 캐싱 적용된 brands-with-count 엔드포인트
router.get("/brands-with-count", async (req, res) => {
  try {
    // 캐시 확인
    if (isCacheValid(cache.filters.withStats.brands)) {
      return res.json(cache.filters.withStats.brands.data);
    }

    const [results] = await pool.query(`
      SELECT brand, COUNT(*) as count
      FROM values_items
      GROUP BY brand
      ORDER BY count DESC, brand ASC
    `);

    // 캐시 업데이트
    updateCache(cache.filters.withStats.brands, results);

    res.json(results);
  } catch (error) {
    console.error("Error fetching brands with count:", error);
    res.status(500).json({ message: "Error fetching brands with count" });
  }
});

// 캐싱 적용된 scheduled-dates-with-count 엔드포인트
router.get("/scheduled-dates-with-count", async (req, res) => {
  try {
    // 캐시 확인
    if (isCacheValid(cache.filters.withStats.dates)) {
      return res.json(cache.filters.withStats.dates.data);
    }

    const [results] = await pool.query(`
      SELECT DATE(scheduled_date) as Date, COUNT(*) as count
      FROM values_items
      GROUP BY DATE(scheduled_date)
      ORDER BY Date ASC
    `);

    // 캐시 업데이트
    updateCache(cache.filters.withStats.dates, results);

    res.json(results);
  } catch (error) {
    console.error("Error fetching scheduled dates with count:", error);
    res
      .status(500)
      .json({ message: "Error fetching scheduled dates with count" });
  }
});

// 캐싱 적용된 brands 엔드포인트
router.get("/brands", async (req, res) => {
  try {
    // 캐시 확인
    if (isCacheValid(cache.filters.lists.brands)) {
      return res.json(cache.filters.lists.brands.data);
    }

    const [results] = await pool.query(`
      SELECT DISTINCT brand 
      FROM values_items 
      ORDER BY brand ASC
    `);

    const brandsList = results.map((row) => row.brand);

    // 캐시 업데이트
    updateCache(cache.filters.lists.brands, brandsList);

    res.json(brandsList);
  } catch (error) {
    console.error("Error fetching brands:", error);
    res.status(500).json({ message: "Error fetching brands" });
  }
});

// 캐싱 적용된 categories 엔드포인트
router.get("/categories", async (req, res) => {
  try {
    // 캐시 확인
    if (isCacheValid(cache.filters.lists.categories)) {
      return res.json(cache.filters.lists.categories.data);
    }

    const [results] = await pool.query(`
      SELECT DISTINCT category 
      FROM values_items 
      ORDER BY category ASC
    `);

    const categoriesList = results.map((row) => row.category);

    // 캐시 업데이트
    updateCache(cache.filters.lists.categories, categoriesList);

    res.json(categoriesList);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ message: "Error fetching categories" });
  }
});

// 캐싱 적용된 ranks 엔드포인트
router.get("/ranks", async (req, res) => {
  try {
    // 캐시 확인
    if (isCacheValid(cache.filters.withStats.ranks)) {
      return res.json(cache.filters.withStats.ranks.data);
    }

    const [results] = await pool.query(`
      SELECT DISTINCT 
        CASE 
          WHEN rank = 'N' THEN 'N'
          WHEN rank = 'S' THEN 'S'
          WHEN rank = 'AB' THEN 'AB'
          WHEN rank = 'A' THEN 'A'
          WHEN rank = 'BC' THEN 'BC'
          WHEN rank = 'B' THEN 'B'
          WHEN rank = 'C' THEN 'C'
          WHEN rank = 'D' THEN 'D'
          WHEN rank = 'E' THEN 'E'
          WHEN rank = 'F' THEN 'F'
          ELSE 'N'
        END as rank,
        COUNT(*) as count
      FROM values_items
      GROUP BY 
        CASE 
          WHEN rank = 'N' THEN 'N'
          WHEN rank = 'S' THEN 'S'
          WHEN rank = 'AB' THEN 'AB'
          WHEN rank = 'A' THEN 'A'
          WHEN rank = 'BC' THEN 'BC'
          WHEN rank = 'B' THEN 'B'
          WHEN rank = 'C' THEN 'C'
          WHEN rank = 'D' THEN 'D'
          WHEN rank = 'E' THEN 'E'
          WHEN rank = 'F' THEN 'F'
          ELSE 'N'
        END
      ORDER BY 
        FIELD(rank, 'N', 'S', 'A', 'AB', 'B', 'BC', 'C', 'D', 'E', 'F')
    `);

    // 캐시 업데이트
    updateCache(cache.filters.withStats.ranks, results);

    res.json(results);
  } catch (error) {
    console.error("Error fetching ranks:", error);
    res.status(500).json({ message: "Error fetching ranks" });
  }
});

// 캐싱 적용된 auc-nums 엔드포인트
router.get("/auc-nums", async (req, res) => {
  try {
    // 캐시 확인
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

    // 캐시 업데이트
    updateCache(cache.filters.withStats.aucNums, results);

    res.json(results);
  } catch (error) {
    console.error("Error fetching auction numbers:", error);
    res.status(500).json({ message: "Error fetching auction numbers" });
  }
});

// 캐시 무효화 엔드포인트 (관리자용)
router.post("/invalidate-cache", (req, res) => {
  try {
    const { type, subType } = req.body;

    // 관리자 권한 확인
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
