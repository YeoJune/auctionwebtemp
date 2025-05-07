// routes/data.js
const dotenv = require("dotenv");
const express = require("express");
const router = express.Router();
const axios = require("axios");
const pool = require("../utils/DB");
const { processItem } = require("../utils/processItem");

let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

const apiUrl = `https://api.currencyfreaks.com/v2.0/rates/latest?apikey=${process.env.CURRENCY_API_KEY}`;

dotenv.config();

// ===== 캐싱 관련 설정 =====
// 기본 캐시 만료 시간: 1시간
const CACHE_DURATION = 60 * 60 * 1000;

// 캐시 저장소
const cache = {
  // 환율 캐시
  exchange: {
    data: null,
    lastFetched: null,
  },
  // 필터 데이터 캐시
  filters: {
    // enabled 필터 캐시
    enabled: {
      brands: { data: null, lastFetched: null },
      categories: { data: null, lastFetched: null },
      dates: { data: null, lastFetched: null },
    },
    // 통계 정보가 포함된 필터 캐시
    withStats: {
      brands: { data: null, lastFetched: null },
      dates: { data: null, lastFetched: null },
      aucNums: { data: null, lastFetched: null },
      ranks: { data: null, lastFetched: null },
      auctionTypes: { data: null, lastFetched: null },
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
    if (subType === null) {
      // 모든 필터 캐시 초기화
      Object.keys(cache.filters).forEach((category) => {
        Object.keys(cache.filters[category]).forEach((item) => {
          cache.filters[category][item].data = null;
          cache.filters[category][item].lastFetched = null;
        });
      });
    } else if (cache.filters.enabled[subType]) {
      // 특정 필터의 enabled 캐시만 초기화
      cache.filters.enabled[subType].data = null;
      cache.filters.enabled[subType].lastFetched = null;

      // 관련 통계 캐시도 초기화
      if (cache.filters.withStats[subType]) {
        cache.filters.withStats[subType].data = null;
        cache.filters.withStats[subType].lastFetched = null;
      }
    }
  } else if (type === "exchange") {
    // 환율 캐시 초기화
    cache.exchange.data = null;
    cache.exchange.lastFetched = null;
  }
}

function formatDate(dateString) {
  const date = new Date(dateString);
  // UTC 시간에 9시간(KST)을 더함
  const kstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kstDate.toISOString().split("T")[0];
}

// 캐싱을 적용한 필터 조회 함수
async function getEnabledFilters(filterType) {
  // 캐시 맵핑
  const cacheMapping = {
    brand: cache.filters.enabled.brands,
    category: cache.filters.enabled.categories,
    date: cache.filters.enabled.dates,
  };

  const cacheItem = cacheMapping[filterType];

  // 캐시가 유효한 경우 캐시된 데이터 반환
  if (cacheItem && isCacheValid(cacheItem)) {
    return cacheItem.data;
  }

  // 캐시가 없거나 만료된 경우 DB에서 조회
  const [enabled] = await pool.query(
    `
    SELECT filter_value 
    FROM filter_settings 
    WHERE filter_type = ? AND is_enabled = TRUE
    `,
    [filterType]
  );

  const result = enabled.map((item) => item.filter_value);

  // 캐시 업데이트
  if (cacheItem) {
    updateCache(cacheItem, result);
  }

  return result;
}

router.get("/", async (req, res) => {
  const {
    page = 1,
    limit = 20,
    brands,
    categories,
    scheduledDates,
    favoriteNumbers, // 위시리스트 번호 파라미터
    aucNums,
    search,
    ranks,
    auctionTypes,
    withDetails = "false",
    bidsOnly = "false", // 입찰한 상품만 표시하는 플래그 추가
    sortBy = "scheduled_date", // 정렬 기준 필드 (기본값: 제목)
    sortOrder = "asc", // 정렬 방향 (기본값: 오름차순)
  } = req.query;
  const offset = (page - 1) * limit;
  const userId = req.session.user?.id;

  try {
    // Get enabled filters
    const [enabledBrands, enabledCategories, enabledDates] = await Promise.all([
      getEnabledFilters("brand"),
      getEnabledFilters("category"),
      getEnabledFilters("date"),
    ]);

    // 사용자의 입찰 데이터 가져오기 (bidsOnly를 위해 쿼리 앞부분으로 이동)
    let bidData = [];
    let userBidItemIds = [];

    if (userId) {
      // live_bids 테이블에서 데이터 가져오기
      const [liveBids] = await pool.query(
        `
        SELECT 
          'live' as bid_type,
          lb.id, 
          lb.item_id, 
          lb.first_price, 
          lb.second_price, 
          lb.final_price,
          lb.status
        FROM live_bids lb
        WHERE lb.user_id = ?
        `,
        [userId]
      );

      // direct_bids 테이블에서 데이터 가져오기
      const [directBids] = await pool.query(
        `
        SELECT 
          'direct' as bid_type,
          db.id, 
          db.item_id, 
          db.current_price,
          db.status
        FROM direct_bids db
        WHERE db.user_id = ?
        `,
        [userId]
      );

      // 두 결과 병합
      bidData = [...liveBids, ...directBids];

      // bidsOnly 플래그가 true일 경우 사용할 item_id 목록 생성
      if (bidsOnly === "true") {
        userBidItemIds = bidData.map((bid) => bid.item_id);
      }
    }

    let query = "SELECT ci.* FROM crawled_items ci";
    const queryParams = [];
    let conditions = []; // conditions 배열 추가

    // 위시리스트 필터링
    if (favoriteNumbers && userId) {
      const favoriteNumbersList = favoriteNumbers.split(",").map(Number);
      if (favoriteNumbersList.length > 0) {
        query +=
          " INNER JOIN wishlists w ON ci.item_id = w.item_id AND w.user_id = ?";
        queryParams.push(userId);
        query += ` AND w.favorite_number IN (${favoriteNumbersList
          .map(() => "?")
          .join(",")})`;
        queryParams.push(...favoriteNumbersList);
      }
    } else {
      query += " WHERE 1=1";
    }

    // bidsOnly 필터링 추가
    if (bidsOnly === "true" && userId) {
      if (userBidItemIds.length > 0) {
        conditions.push(
          `ci.item_id IN (${userBidItemIds.map(() => "?").join(",")})`
        );
        queryParams.push(...userBidItemIds);
      } else {
        // 사용자의 입찰이 없는 경우 빈 결과 반환을 위한 조건
        conditions.push("1=0");
      }
    }

    // 검색어 처리
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

    // 랭크 필터 처리 - LIKE 문 제거하고 직접 비교로 변경
    if (ranks) {
      const rankList = ranks.split(",");
      if (rankList.length > 0) {
        const rankConditions = rankList.map((rank) => {
          switch (rank) {
            case "N":
              return "ci.rank = 'N'";
            case "S":
              return "ci.rank = 'S'";
            case "AB":
              return "ci.rank = 'AB'";
            case "A":
              return "ci.rank = 'A'";
            case "BC":
              return "ci.rank = 'BC'";
            case "B":
              return "ci.rank = 'B'";
            case "C":
              return "ci.rank = 'C'";
            case "D":
              return "ci.rank = 'D'";
            case "E":
              return "ci.rank = 'E'";
            case "F":
              return "ci.rank = 'F'";
            default:
              return `ci.rank = '${rank}'`;
          }
        });
        conditions.push(`(${rankConditions.join(" OR ")})`);
      }
    }

    // 경매 타입 필터 처리
    if (auctionTypes) {
      const auctionTypeList = auctionTypes.split(",");
      if (auctionTypeList.length > 0) {
        conditions.push(
          `ci.bid_type IN (${auctionTypeList.map(() => "?").join(",")})`
        );
        queryParams.push(...auctionTypeList);
      }
    }

    // Apply enabled filter restrictions
    if (enabledBrands.length > 0) {
      conditions.push(
        "ci.brand IN (" + enabledBrands.map(() => "?").join(",") + ")"
      );
      queryParams.push(...enabledBrands);
    } else {
      conditions.push("1=0");
    }

    if (enabledCategories.length > 0) {
      conditions.push(
        "ci.category IN (" + enabledCategories.map(() => "?").join(",") + ")"
      );
      queryParams.push(...enabledCategories);
    } else {
      conditions.push("1=0");
    }

    if (enabledDates.length > 0) {
      conditions.push(
        "DATE(ci.scheduled_date) IN (" +
          enabledDates.map(() => "?").join(",") +
          ")"
      );
      queryParams.push(...enabledDates);
    }

    // Apply user-selected filters
    if (brands) {
      const brandList = brands
        .split(",")
        .filter((brand) => enabledBrands.includes(brand));
      if (brandList.length > 0) {
        conditions.push(
          "ci.brand IN (" + brandList.map(() => "?").join(",") + ")"
        );
        queryParams.push(...brandList);
      }
    }

    if (categories) {
      const categoryList = categories
        .split(",")
        .filter((category) => enabledCategories.includes(category));
      if (categoryList.length > 0) {
        conditions.push(
          "ci.category IN (" + categoryList.map(() => "?").join(",") + ")"
        );
        queryParams.push(...categoryList);
      }
    }

    if (scheduledDates) {
      const dateList = scheduledDates.split(",");
      if (dateList.length > 0) {
        const dateConds = [];
        const validDates = [];
        dateList.forEach((date) => {
          if (date == "null") {
            dateConds.push("ci.scheduled_date IS NULL");
            validDates.push(date);
          } else {
            const kstDate = formatDate(date) + " 00:00:00.000";
            if (enabledDates.includes(kstDate)) {
              dateConds.push(
                "(ci.scheduled_date >= ? AND ci.scheduled_date < ?)"
              );
              const startDate = new Date(kstDate);
              const endDate = new Date(startDate);
              endDate.setDate(endDate.getDate() + 1);
              queryParams.push(startDate, endDate);
              validDates.push(date);
            }
          }
        });
        if (dateConds.length > 0) {
          conditions.push(`(${dateConds.join(" OR ")})`);
        } else {
          conditions.push("1=0");
        }
      }
    }

    if (aucNums) {
      const aucNumList = aucNums.split(",");
      if (aucNumList.length > 0) {
        conditions.push(
          `ci.auc_num IN (${aucNumList.map(() => "?").join(",")})`
        );
        queryParams.push(...aucNumList);
      }
    }

    // Add all conditions to the query
    if (conditions.length > 0) {
      query += " AND " + conditions.join(" AND ");
    }

    // 정렬 처리
    let orderByClause = "";
    switch (sortBy) {
      case "title":
        orderByClause = "ci.title";
        break;
      case "rank":
        orderByClause = "ci.rank";
        break;
      case "scheduled_date":
        orderByClause = "ci.scheduled_date";
        break;
      case "starting_price":
        orderByClause = "ci.starting_price + 0";
        break;
      default:
        orderByClause = "ci.title";
    }

    // 정렬 방향 설정
    const sortDirection = sortOrder.toLowerCase() === "desc" ? "DESC" : "ASC";
    query += ` ORDER BY ${orderByClause} ${sortDirection}`;

    query += " LIMIT ? OFFSET ?";
    queryParams.push(parseInt(limit), offset);

    const countQuery = `SELECT COUNT(*) as total FROM (${
      query.split("ORDER BY")[0]
    }) as subquery`;

    const [items] = await pool.query(query, queryParams);
    const [countResult] = await pool.query(
      countQuery,
      queryParams.slice(0, -2)
    );
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    let wishlist = [];
    if (userId) {
      // 위시리스트 쿼리 수정: 아이템 ID와 즐겨찾기 번호 함께 반환
      [wishlist] = await pool.query(
        "SELECT item_id, favorite_number FROM wishlists WHERE user_id = ?",
        [userId]
      );
    }

    // 아이템별 입찰 데이터 매핑
    const itemBidMap = {};
    if (bidData.length > 0) {
      for (const bid of bidData) {
        // 각 아이템 ID에 대한 해당 타입의 입찰 데이터 저장
        if (!itemBidMap[bid.item_id]) {
          itemBidMap[bid.item_id] = {};
        }
        itemBidMap[bid.item_id][bid.bid_type] = bid;
      }
    }

    if (withDetails === "true") {
      // p-limit 적용하여 5개씩 처리하도록 수정
      const limit = pLimit(5); // 최대 5개의 동시 요청만 허용

      // 아이템을 5개씩 처리하는 함수
      const processItemsInBatches = async (items) => {
        const results = [];

        // Promise.all 대신 p-limit으로 제한된 요청 생성
        const promises = items.map((item) =>
          limit(() => processItem(item.item_id, false, null, true, 2))
        );

        // 모든 처리가 완료될 때까지 기다림
        const processedItems = await Promise.all(promises);

        // null이 아닌 아이템만 필터링
        return processedItems.filter((item) => item !== null);
      };

      const detailedItems = await processItemsInBatches(items);

      // 각 아이템에 bid 정보 추가
      const itemsWithBids = detailedItems.map((item) => {
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
    } else {
      // 각 아이템에 bid 정보 추가
      const itemsWithBids = items.map((item) => {
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

    const enabledBrands = await getEnabledFilters("brand");
    if (enabledBrands.length === 0) {
      return res.json([]);
    }

    const placeholders = enabledBrands.map(() => "?").join(",");
    const [results] = await pool.query(
      `
      SELECT brand, COUNT(*) as count
      FROM crawled_items
      WHERE brand IN (${placeholders})
      GROUP BY brand
      ORDER BY count DESC, brand ASC
    `,
      enabledBrands
    );

    // 캐시 업데이트
    updateCache(cache.filters.withStats.brands, results);

    res.json(results);
  } catch (error) {
    console.error("Error fetching brands with count:", error);
    res.status(500).json({ message: "Error fetching brands with count" });
  }
});

// 캐싱 적용된 auction-types 엔드포인트
router.get("/auction-types", async (req, res) => {
  try {
    // 캐시 확인
    if (isCacheValid(cache.filters.withStats.auctionTypes)) {
      return res.json(cache.filters.withStats.auctionTypes.data);
    }

    const [results] = await pool.query(`
      SELECT bid_type, COUNT(*) as count
      FROM crawled_items
      WHERE bid_type IS NOT NULL
      GROUP BY bid_type
      ORDER BY count DESC
    `);

    // 캐시 업데이트
    updateCache(cache.filters.withStats.auctionTypes, results);

    res.json(results);
  } catch (error) {
    console.error("Error fetching auction types:", error);
    res.status(500).json({ message: "Error fetching auction types" });
  }
});

// 캐싱 적용된 scheduled-dates-with-count 엔드포인트
router.get("/scheduled-dates-with-count", async (req, res) => {
  try {
    // 캐시 확인
    if (isCacheValid(cache.filters.withStats.dates)) {
      return res.json(cache.filters.withStats.dates.data);
    }

    const enabledDates = await getEnabledFilters("date");
    if (enabledDates.length === 0) {
      return res.json([]);
    }

    const placeholders = enabledDates.map(() => "?").join(",");
    const [results] = await pool.query(
      `
      SELECT DATE(scheduled_date) as Date, COUNT(*) as count
      FROM crawled_items
      WHERE DATE(scheduled_date) IN (${placeholders})
      GROUP BY DATE(scheduled_date)
      ORDER BY Date ASC
    `,
      enabledDates
    );

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
    const enabledBrands = await getEnabledFilters("brand");
    res.json(enabledBrands);
  } catch (error) {
    console.error("Error fetching brands:", error);
    res.status(500).json({ message: "Error fetching brands" });
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
      FROM crawled_items
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

// 캐싱 적용된 categories 엔드포인트
router.get("/categories", async (req, res) => {
  try {
    const enabledCategories = await getEnabledFilters("category");
    res.json(enabledCategories);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ message: "Error fetching categories" });
  }
});

// 환율 캐싱 개선
router.get("/exchange-rate", async (req, res) => {
  try {
    // 캐시 확인
    if (isCacheValid(cache.exchange)) {
      return res.json({ rate: cache.exchange.data });
    }

    const response = await axios.get(apiUrl);
    const rate = response.data.rates.KRW / response.data.rates.JPY;

    // 캐시 업데이트
    updateCache(cache.exchange, rate);

    res.json({ rate });
  } catch (error) {
    console.error("Error fetching exchange rate:", error);

    // 캐시된 데이터가 있으면 오류 시 캐시 반환
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
      FROM crawled_items
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
