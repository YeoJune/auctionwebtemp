// routes/data.js
const dotenv = require("dotenv");
const express = require("express");
const router = express.Router();
const axios = require("axios");
const pool = require("../utils/DB");
const { processItem } = require("../utils/processItem");

const apiUrl = `https://api.currencyfreaks.com/v2.0/rates/latest?apikey=${process.env.CURRENCY_API_KEY}`;

dotenv.config();

let cachedRate = null;
let lastFetchedTime = null;
const cacheDuration = 60 * 60 * 1000;

function formatDate(dateString) {
  const date = new Date(dateString);
  // UTC 시간에 9시간(KST)을 더함
  const kstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kstDate.toISOString().split("T")[0];
}

// Helper function to get enabled filter values
async function getEnabledFilters(filterType) {
  const [enabled] = await pool.query(
    `
    SELECT filter_value 
    FROM filter_settings 
    WHERE filter_type = ? AND is_enabled = TRUE
  `,
    [filterType]
  );
  return enabled.map((item) => item.filter_value);
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
          db.current_price as first_price,
          NULL as second_price,
          NULL as final_price,
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

    // 랭크 필터 처리
    if (ranks) {
      const rankList = ranks.split(",");
      if (rankList.length > 0) {
        const rankConditions = rankList.map((rank) => {
          switch (rank) {
            case "AB":
              return "ci.rank LIKE 'AB%'";
            case "A":
              return "ci.rank LIKE 'A%' AND ci.rank NOT LIKE 'AB%'";
            case "BC":
              return "ci.rank LIKE 'BC%'";
            case "B":
              return "ci.rank LIKE 'B%' AND ci.rank NOT LIKE 'BC%'";
            default:
              return `ci.rank LIKE '${rank}%'`;
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

    query += " ORDER BY ci.title ASC";
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
      const processPromises = items.map((item) =>
        processItem(item.item_id, false, null, true)
      );
      const detailedItems = await Promise.all(processPromises);
      const filteredItems = detailedItems.filter((item) => item !== null);

      // 각 아이템에 bid 정보 추가
      const itemsWithBids = filteredItems.map((item) => {
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

router.get("/brands-with-count", async (req, res) => {
  try {
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

    res.json(results);
  } catch (error) {
    console.error("Error fetching brands with count:", error);
    res.status(500).json({ message: "Error fetching brands with count" });
  }
});

router.get("/auction-types", async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT bid_type, COUNT(*) as count
      FROM crawled_items
      WHERE bid_type IS NOT NULL
      GROUP BY bid_type
      ORDER BY count DESC
    `);

    res.json(results);
  } catch (error) {
    console.error("Error fetching auction types:", error);
    res.status(500).json({ message: "Error fetching auction types" });
  }
});

router.get("/scheduled-dates-with-count", async (req, res) => {
  try {
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
    const [results] = await pool.query(`
      SELECT auc_num, COUNT(*) as count
      FROM crawled_items
      WHERE auc_num IS NOT NULL
      GROUP BY auc_num
      ORDER BY auc_num ASC
    `);

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
  const currentTime = new Date().getTime();

  if (
    cachedRate &&
    lastFetchedTime &&
    currentTime - lastFetchedTime < cacheDuration
  ) {
    //console.log('Returning cached data');
    return res.json({ rate: cachedRate });
  }

  try {
    const response = await axios.get(apiUrl);

    cachedRate = response.data.rates.KRW / response.data.rates.JPY;
    lastFetchedTime = currentTime;

    //console.log('Fetched new data from API');
    res.json({ rate: cachedRate });
  } catch (error) {
    console.error("Error fetching exchange rate:", error);
    res.status(500).json({ error: "Failed to fetch exchange rate" });
  }
});

router.get("/ranks", async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT DISTINCT 
        CASE 
          WHEN rank LIKE 'N%' THEN 'N'
          WHEN rank LIKE 'S%' THEN 'S'
          WHEN rank LIKE 'AB%' THEN 'AB'
          WHEN rank LIKE 'A%' AND rank NOT LIKE 'AB%' THEN 'A'
          WHEN rank LIKE 'BC%' THEN 'BC'
          WHEN rank LIKE 'B%' AND rank NOT LIKE 'BC%' THEN 'B'
          WHEN rank LIKE 'C%' THEN 'C'
          WHEN rank LIKE 'D%' THEN 'D'
          WHEN rank LIKE 'E%' THEN 'E'
          WHEN rank LIKE 'F%' THEN 'F'
          ELSE 'N'
        END as rank,
        COUNT(*) as count
      FROM crawled_items
      GROUP BY 
        CASE 
          WHEN rank LIKE 'N%' THEN 'N'
          WHEN rank LIKE 'S%' THEN 'S'
          WHEN rank LIKE 'AB%' THEN 'AB'
          WHEN rank LIKE 'A%' AND rank NOT LIKE 'AB%' THEN 'A'
          WHEN rank LIKE 'BC%' THEN 'BC'
          WHEN rank LIKE 'B%' AND rank NOT LIKE 'BC%' THEN 'B'
          WHEN rank LIKE 'C%' THEN 'C'
          WHEN rank LIKE 'D%' THEN 'D'
          WHEN rank LIKE 'E%' THEN 'E'
          WHEN rank LIKE 'F%' THEN 'F'
          ELSE 'N'
        END
      ORDER BY 
        FIELD(rank, 'N', 'S', 'A', 'AB', 'B', 'BC', 'C', 'D', 'E', 'F')
    `);
    res.json(results);
  } catch (error) {
    console.error("Error fetching ranks:", error);
    res.status(500).json({ message: "Error fetching ranks" });
  }
});

module.exports = router;
