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
    enabled: {
      brands: { data: null, lastFetched: null },
      categories: { data: null, lastFetched: null },
      dates: { data: null, lastFetched: null },
    },
    withStats: {
      brands: { data: null, lastFetched: null },
      dates: { data: null, lastFetched: null },
      aucNums: { data: null, lastFetched: null },
      ranks: { data: null, lastFetched: null },
      auctionTypes: { data: null, lastFetched: null },
    },
  },
};

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
    if (subType === null) {
      Object.keys(cache.filters).forEach((category) => {
        Object.keys(cache.filters[category]).forEach((item) => {
          cache.filters[category][item].data = null;
          cache.filters[category][item].lastFetched = null;
        });
      });
    } else if (cache.filters.enabled[subType]) {
      cache.filters.enabled[subType].data = null;
      cache.filters.enabled[subType].lastFetched = null;

      if (cache.filters.withStats[subType]) {
        cache.filters.withStats[subType].data = null;
        cache.filters.withStats[subType].lastFetched = null;
      }
    }
  } else if (type === "exchange") {
    cache.exchange.data = null;
    cache.exchange.lastFetched = null;
  }
}

async function getEnabledFilters(filterType) {
  const cacheMapping = {
    brand: cache.filters.enabled.brands,
    category: cache.filters.enabled.categories,
    date: cache.filters.enabled.dates,
  };

  const cacheItem = cacheMapping[filterType];

  if (cacheItem && isCacheValid(cacheItem)) {
    return cacheItem.data;
  }

  const [enabled] = await pool.query(
    `SELECT filter_value FROM filter_settings WHERE filter_type = ? AND is_enabled = TRUE`,
    [filterType]
  );

  const result = enabled.map((item) => item.filter_value);

  if (cacheItem) {
    updateCache(cacheItem, result);
  }

  return result;
}

async function buildBaseFilterConditions() {
  const [enabledBrands, enabledCategories, enabledDates] = await Promise.all([
    getEnabledFilters("brand"),
    getEnabledFilters("category"),
    getEnabledFilters("date"),
  ]);

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
    const [enabledBrands, enabledCategories, enabledDates] = await Promise.all([
      getEnabledFilters("brand"),
      getEnabledFilters("category"),
      getEnabledFilters("date"),
    ]);

    let bidData = [];
    let userBidItemIds = [];

    if (userId) {
      const [liveBids] = await pool.query(
        `SELECT 'live' as bid_type, lb.id, lb.item_id, lb.first_price, lb.second_price, lb.final_price, lb.status
         FROM live_bids lb WHERE lb.user_id = ?`,
        [userId]
      );

      const [directBids] = await pool.query(
        `SELECT 'direct' as bid_type, db.id, db.item_id, db.current_price, db.status
         FROM direct_bids db WHERE db.user_id = ?`,
        [userId]
      );

      bidData = [...liveBids, ...directBids];

      if (bidsOnly === "true") {
        userBidItemIds = bidData.map((bid) => bid.item_id);
      }
    }

    let query = "SELECT ci.* FROM crawled_items ci";
    const queryParams = [];
    let conditions = [];

    // if (excludeExpired === "true") {
    //   if (userId) {
    //     // 사용자별 현장경매 입찰 상태를 JOIN으로 가져와서 조건 적용
    //     query = `
    //     SELECT ci.*, lb.first_price, lb.final_price
    //     FROM crawled_items ci
    //     LEFT JOIN live_bids lb ON ci.item_id = lb.item_id AND lb.user_id = ?
    //   `;
    //     queryParams.push(userId);

    //     conditions.push(`
    //     (ci.bid_type = 'direct' AND ci.scheduled_date > NOW()) OR
    //     (ci.bid_type = 'live' AND (
    //       (lb.first_price IS NULL AND ci.scheduled_date > NOW()) OR
    //       (lb.first_price IS NOT NULL AND lb.final_price IS NULL AND 
    //        (ci.scheduled_date > NOW() OR 
    //         (DATE(ci.scheduled_date) = DATE(NOW()) AND HOUR(NOW()) < 13))) OR
    //       (lb.final_price IS NOT NULL AND FALSE)
    //     ))
    //   `);
    //   } else {
    //     // 비로그인 사용자는 1차 입찰 단계로 간주
    //     conditions.push(`
    //     (ci.bid_type = 'direct' AND ci.scheduled_date > NOW()) OR
    //     (ci.bid_type = 'live' AND ci.scheduled_date > NOW())
    //   `);
    //   }
    // }

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

    if (bidsOnly === "true" && userId) {
      if (userBidItemIds.length > 0) {
        conditions.push(
          `ci.item_id IN (${userBidItemIds.map(() => "?").join(",")})`
        );
        queryParams.push(...userBidItemIds);
      } else {
        conditions.push("1=0");
      }
    }

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

    if (auctionTypes) {
      const auctionTypeList = auctionTypes.split(",");
      if (auctionTypeList.length > 0) {
        conditions.push(
          `ci.bid_type IN (${auctionTypeList.map(() => "?").join(",")})`
        );
        queryParams.push(...auctionTypeList);
      }
    }

    if (enabledBrands.length > 0) {
      conditions.push(
        `ci.brand IN (${enabledBrands.map(() => "?").join(",")})`
      );
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

    if (brands) {
      const brandList = brands
        .split(",")
        .filter((brand) => enabledBrands.includes(brand));
      if (brandList.length > 0) {
        conditions.push(`ci.brand IN (${brandList.map(() => "?").join(",")})`);
        queryParams.push(...brandList);
      }
    }

    if (categories) {
      const categoryList = categories
        .split(",")
        .filter((category) => enabledCategories.includes(category));
      if (categoryList.length > 0) {
        conditions.push(
          `ci.category IN (${categoryList.map(() => "?").join(",")})`
        );
        queryParams.push(...categoryList);
      }
    }

    if (scheduledDates) {
      const dateList = scheduledDates.split(",");
      if (dateList.length > 0) {
        const dateConds = [];
        dateList.forEach((date) => {
          if (date == "null") {
            dateConds.push("ci.scheduled_date IS NULL");
          } else {
            dateConds.push(`DATE(ci.scheduled_date) = ?`);
            queryParams.push(date);
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
        conditions.push(
          `ci.auc_num IN (${aucNumList.map(() => "?").join(",")})`
        );
        queryParams.push(...aucNumList);
      }
    }

    if (conditions.length > 0) {
      query += " AND " + conditions.join(" AND ");
    }

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
      [wishlist] = await pool.query(
        "SELECT item_id, favorite_number FROM wishlists WHERE user_id = ?",
        [userId]
      );
    }

    const itemBidMap = {};
    if (bidData.length > 0) {
      for (const bid of bidData) {
        if (!itemBidMap[bid.item_id]) {
          itemBidMap[bid.item_id] = {};
        }
        itemBidMap[bid.item_id][bid.bid_type] = bid;
      }
    }

    if (withDetails === "true") {
      const limit = pLimit(5);
      const processItemsInBatches = async (items) => {
        const promises = items.map((item) =>
          limit(() => processItem(item.item_id, false, null, true, 2))
        );
        const processedItems = await Promise.all(promises);
        return processedItems.filter((item) => item !== null);
      };

      const detailedItems = await processItemsInBatches(items);
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

router.get("/scheduled-dates-with-count", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.withStats.dates)) {
      return res.json(cache.filters.withStats.dates.data);
    }

    const { conditions, queryParams } = await buildBaseFilterConditions();

    const [results] = await pool.query(
      `SELECT DATE(CONVERT_TZ(ci.scheduled_date, '+00:00', '+09:00')) as Date, COUNT(*) as count
       FROM crawled_items ci
       WHERE ${conditions.join(" AND ")}
       GROUP BY DATE(CONVERT_TZ(ci.scheduled_date, '+00:00', '+09:00'))
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

router.get("/brands", async (req, res) => {
  try {
    const enabledBrands = await getEnabledFilters("brand");
    res.json(enabledBrands);
  } catch (error) {
    console.error("Error fetching brands:", error);
    res.status(500).json({ message: "Error fetching brands" });
  }
});

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

router.get("/categories", async (req, res) => {
  try {
    const enabledCategories = await getEnabledFilters("category");
    res.json(enabledCategories);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ message: "Error fetching categories" });
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
        error: "Failed to fetch new exchange rate, using cached data",
      });
    }

    res.status(500).json({ error: "Failed to fetch exchange rate" });
  }
});

router.get("/ranks", async (req, res) => {
  try {
    if (isCacheValid(cache.filters.withStats.ranks)) {
      return res.json(cache.filters.withStats.ranks.data);
    }

    const { conditions, queryParams } = await buildBaseFilterConditions();

    const [results] = await pool.query(
      `SELECT DISTINCT 
         CASE 
           WHEN ci.rank = 'N' THEN 'N'
           WHEN ci.rank = 'S' THEN 'S'
           WHEN ci.rank = 'AB' THEN 'AB'
           WHEN ci.rank = 'A' THEN 'A'
           WHEN ci.rank = 'BC' THEN 'BC'
           WHEN ci.rank = 'B' THEN 'B'
           WHEN ci.rank = 'C' THEN 'C'
           WHEN ci.rank = 'D' THEN 'D'
           WHEN ci.rank = 'E' THEN 'E'
           WHEN ci.rank = 'F' THEN 'F'
           ELSE 'N'
         END as rank,
         COUNT(*) as count
       FROM crawled_items ci
       WHERE ${conditions.join(" AND ")}
       GROUP BY 
         CASE 
           WHEN ci.rank = 'N' THEN 'N'
           WHEN ci.rank = 'S' THEN 'S'
           WHEN ci.rank = 'AB' THEN 'AB'
           WHEN ci.rank = 'A' THEN 'A'
           WHEN ci.rank = 'BC' THEN 'BC'
           WHEN ci.rank = 'B' THEN 'B'
           WHEN ci.rank = 'C' THEN 'C'
           WHEN ci.rank = 'D' THEN 'D'
           WHEN ci.rank = 'E' THEN 'E'
           WHEN ci.rank = 'F' THEN 'F'
           ELSE 'N'
         END
       ORDER BY 
         FIELD(rank, 'N', 'S', 'A', 'AB', 'B', 'BC', 'C', 'D', 'E', 'F')`,
      queryParams
    );

    updateCache(cache.filters.withStats.ranks, results);
    res.json(results);
  } catch (error) {
    console.error("Error fetching ranks:", error);
    res.status(500).json({ message: "Error fetching ranks" });
  }
});

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
