// routes/data.js - 수정된 부분들

// ===== 캐싱 관련 설정 =====
const CACHE_DURATION = 5 * 60 * 1000; // 5분으로 단축

const cache = {
  exchange: {
    data: null,
    lastFetched: null,
  },
  sync: {
    // 동기화 캐시 추가
    lastSynced: null,
  },
  filters: {
    enabled: { data: null, lastFetched: null }, // 이제 사용 안함 (제거 예정)
    withStats: {
      brands: { data: null, lastFetched: null },
      dates: { data: null, lastFetched: null },
      aucNums: { data: null, lastFetched: null },
      ranks: { data: null, lastFetched: null },
      auctionTypes: { data: null, lastFetched: null },
    },
  },
};

// ===== 동기화 함수 추가 =====
async function syncItemsWithFilterSettings() {
  if (isCacheValid(cache.sync)) {
    return; // 5분 이내면 스킵
  }

  console.log("Syncing crawled_items.is_enabled with filter_settings...");

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
  console.log("Sync completed successfully");
}

// ===== 메인 데이터 조회 라우터 - 대폭 단순화 =====
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
    // 1. Lazy 동기화 (5분마다)
    await syncItemsWithFilterSettings();

    // 2. 사용자 입찰 데이터 조회 (기존과 동일)
    let bidData = [];
    let userBidItemIds = [];

    if (userId) {
      const [userLiveBids] = await pool.query(
        `SELECT 'live' as bid_type, item_id, first_price, second_price, final_price, status, id
         FROM live_bids WHERE user_id = ?`,
        [userId]
      );

      const [userDirectBids] = await pool.query(
        `SELECT 'direct' as bid_type, item_id, current_price, status, id
         FROM direct_bids WHERE user_id = ?`,
        [userId]
      );

      bidData = [...userLiveBids, ...userDirectBids];
      if (bidsOnly === "true") {
        userBidItemIds = bidData.map((bid) => bid.item_id);
      }
    }

    // 3. 쿼리 구성 - 대폭 단순화
    let baseQuery = "SELECT ci.* FROM crawled_items ci";
    const conditions = ["ci.is_enabled = 1"]; // 기본 조건: 활성화된 아이템만
    const queryParams = [];

    // 4. 즐겨찾기 필터
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

    // 5. 기본 조건들
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

    // 6. 입찰한 아이템만 보기
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

    // 8. 사용자 선택 필터들 - 단순화
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

    // 9. 최종 쿼리 조립 (기존과 동일)
    let finalQuery = baseQuery + " WHERE " + conditions.join(" AND ");

    // 정렬 (기존과 동일)
    let orderByClause;
    switch (sortBy) {
      case "title":
        orderByClause = "ci.title";
        break;
      case "rank":
        orderByClause =
          "FIELD(ci.rank, 'N', 'S', 'A', 'AB', 'B', 'BC', 'C', 'D', 'E', 'F')";
        break;
      case "scheduled_date":
        orderByClause = "ci.scheduled_date";
        break;
      case "starting_price":
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

    // 카운트 쿼리
    const countQuery = `SELECT COUNT(*) as total FROM (${finalQuery}) as subquery`;

    // 페이징 추가
    finalQuery += " LIMIT ? OFFSET ?";
    queryParams.push(parseInt(limit), offset);

    // 쿼리 실행 (나머지는 기존과 동일)
    const [items] = await pool.query(finalQuery, queryParams);
    const [countResult] = await pool.query(
      countQuery,
      queryParams.slice(0, -2)
    );

    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    // 위시리스트 조회 (기존과 동일)
    let wishlist = [];
    if (userId) {
      [wishlist] = await pool.query(
        "SELECT item_id, favorite_number FROM wishlists WHERE user_id = ?",
        [userId]
      );
    }

    // 입찰 정보 매핑 (기존과 동일)
    const itemBidMap = {};
    bidData.forEach((bid) => {
      if (!itemBidMap[bid.item_id]) {
        itemBidMap[bid.item_id] = {};
      }
      itemBidMap[bid.item_id][bid.bid_type] = bid;
    });

    // 상세 정보 처리 (기존과 동일)
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

    // 최종 응답 구성 (기존과 동일)
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

// ===== 통계 조회들도 단순화 =====
async function buildBaseFilterConditions() {
  // 이제 단순히 is_enabled = 1 조건만 사용
  return {
    conditions: ["ci.is_enabled = 1"],
    queryParams: [],
  };
}

// ===== 캐시 무효화 업데이트 =====
function invalidateCache(type, subType = null) {
  if (type === "all") {
    Object.keys(cache).forEach((key) => {
      if (typeof cache[key] === "object") {
        if (
          cache[key].data !== undefined ||
          cache[key].lastFetched !== undefined
        ) {
          cache[key].data = null;
          cache[key].lastFetched = null;
          cache[key].lastSynced = null; // sync 캐시도 무효화
        } else {
          Object.keys(cache[key]).forEach((subKey) => {
            if (typeof cache[key][subKey] === "object") {
              Object.keys(cache[key][subKey]).forEach((item) => {
                cache[key][subKey][item].data = null;
                cache[key][subKey][item].lastFetched = null;
              });
            }
          });
        }
      }
    });
  } else if (type === "sync") {
    cache.sync.lastSynced = null;
  } else if (type === "filters") {
    // 통계 캐시만 무효화
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

module.exports = router;
