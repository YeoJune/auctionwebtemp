// routes/crawler.js
const express = require("express");
const router = express.Router();
const {
  ecoAucCrawler,
  ecoAucValueCrawler,
  brandAucCrawler,
  brandAucValueCrawler,
  starAucCrawler,
  starAucValueCrawler,
} = require("../crawlers/index");
const DBManager = require("../utils/DBManager");
const pool = require("../utils/DB");
const cron = require("node-cron");
const { getAdminSettings } = require("../utils/adminDB");
const { initializeFilterSettings } = require("../utils/filterDB");
const dotenv = require("dotenv");

dotenv.config();

let isCrawling = false;
let isValueCrawling = false;
let isUpdateCrawling = false;

const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.id === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Access denied. Admin only." });
  }
};

async function loginAll() {
  const crawlers = [
    ecoAucCrawler,
    ecoAucValueCrawler,
    brandAucCrawler,
    brandAucValueCrawler,
    starAucCrawler,
    starAucValueCrawler,
  ];

  await Promise.all(crawlers.map((crawler) => crawler.login()));
}

async function crawlAll() {
  if (isCrawling) {
    throw new Error("already crawling");
  } else {
    try {
      const [existingItems] = await pool.query(
        "SELECT item_id, auc_num FROM crawled_items"
      );
      const existingEcoAucIds = new Set(
        existingItems
          .filter((item) => item.auc_num == 1)
          .map((item) => item.item_id)
      );
      const existingBrandAuctionIds = new Set(
        existingItems
          .filter((item) => item.auc_num == 2)
          .map((item) => item.item_id)
      );
      const existingStarAucIds = new Set(
        existingItems
          .filter((item) => item.auc_num == 3)
          .map((item) => item.item_id)
      );

      isCrawling = true;
      let ecoAucItems = await ecoAucCrawler.crawlAllItems(existingEcoAucIds);
      let brandAucItems = await brandAucCrawler.crawlAllItems(
        existingBrandAuctionIds
      );
      let starAucItems = await starAucCrawler.crawlAllItems(existingStarAucIds);

      if (!ecoAucItems) ecoAucItems = [];
      if (!brandAucItems) brandAucItems = [];
      if (!starAucItems) starAucItems = [];

      const allItems = [...ecoAucItems, ...brandAucItems, ...starAucItems];
      await DBManager.saveItems(allItems, "crawled_items");
      await DBManager.deleteItemsWithout(
        allItems.map((item) => item.item_id),
        "crawled_items"
      );
      await DBManager.cleanupUnusedImages("products");
      await initializeFilterSettings();
    } catch (error) {
      throw error;
    } finally {
      isCrawling = false;
      await loginAll();
    }
  }
}

async function crawlAllValues(options = {}) {
  const { aucNums = [], months = [] } = options;

  // 선택된 크롤러가 없으면 모두 실행
  const runAll = aucNums.length === 0;

  // 각 크롤러 실행 여부 결정
  const runEcoAuc = runAll || aucNums.includes(1);
  const runBrandAuc = runAll || aucNums.includes(2);
  const runStarAuc = runAll || aucNums.includes(3);

  // 각 크롤러별 개월 수 매핑 (기본값: 3개월)
  const monthsMap = {
    1: 3, // EcoAuc
    2: 3, // BrandAuc
    3: 3, // StarAuc
  };

  // 입력받은 months 배열이 있으면, aucNums와 매핑하여 설정
  if (aucNums.length > 0 && months.length > 0) {
    for (let i = 0; i < Math.min(aucNums.length, months.length); i++) {
      monthsMap[aucNums[i]] = months[i];
    }
  }

  if (isValueCrawling) {
    throw new Error("Value crawling already in progress");
  } else {
    try {
      const [existingItems] = await pool.query(
        "SELECT item_id, auc_num FROM values_items"
      );

      const existingEcoAucIds = new Set(
        existingItems
          .filter((item) => item.auc_num == 1)
          .map((item) => item.item_id)
      );
      const existingBrandAuctionIds = new Set(
        existingItems
          .filter((item) => item.auc_num == 2)
          .map((item) => item.item_id)
      );
      const existingStarAucIds = new Set(
        existingItems
          .filter((item) => item.auc_num == 3)
          .map((item) => item.item_id)
      );

      isValueCrawling = true;
      console.log("Starting value crawling with options:", {
        aucNums: aucNums.length > 0 ? aucNums : "all",
        months: monthsMap,
        runEcoAuc,
        runBrandAuc,
        runStarAuc,
      });

      // 직렬 처리를 위한 결과 객체
      const crawlResults = {
        ecoAucItems: [],
        brandAucItems: [],
        starAucItems: [],
      };

      // 각 크롤러 순차적 실행
      if (runEcoAuc) {
        console.log(`Running EcoAuc value crawler for ${monthsMap[1]} months`);
        crawlResults.ecoAucItems =
          (await ecoAucValueCrawler.crawlAllItems(
            existingEcoAucIds,
            monthsMap[1]
          )) || [];
      }

      if (runBrandAuc) {
        console.log(
          `Running BrandAuc value crawler for ${monthsMap[2]} months`
        );
        crawlResults.brandAucItems =
          (await brandAucValueCrawler.crawlAllItems(
            existingBrandAuctionIds,
            monthsMap[2]
          )) || [];
      }

      if (runStarAuc) {
        console.log(`Running StarAuc value crawler for ${monthsMap[3]} months`);
        crawlResults.starAucItems =
          (await starAucValueCrawler.crawlAllItems(
            existingStarAucIds,
            monthsMap[3]
          )) || [];
      }

      // 결과 집계
      const allItems = [
        ...crawlResults.ecoAucItems,
        ...crawlResults.brandAucItems,
        ...crawlResults.starAucItems,
      ];

      console.log(
        `Value crawling completed. Total items found: ${allItems.length}`
      );

      // DB에 저장
      await DBManager.saveItems(allItems, "values_items");
      await DBManager.cleanupOldValueItems(365);

      return {
        settings: {
          aucNums: aucNums.length > 0 ? aucNums : [1, 2, 3],
          months: monthsMap,
        },
        results: {
          ecoAucCount: crawlResults.ecoAucItems.length,
          brandAucCount: crawlResults.brandAucItems.length,
          starAucCount: crawlResults.starAucItems.length,
          totalCount: allItems.length,
        },
      };
    } catch (error) {
      console.error("Value crawling failed:", error);
      throw error;
    } finally {
      isValueCrawling = false;
    }
  }
}

async function crawlAllUpdates() {
  if (isUpdateCrawling || isCrawling || isValueCrawling) {
    throw new Error("update crawling already in progress");
  } else {
    isUpdateCrawling = true;
    const startTime = Date.now();
    console.log(`Starting update crawl at ${new Date().toISOString()}`);

    try {
      // 웹에서 데이터 크롤링 (기존과 동일)
      let ecoAucUpdates = await ecoAucCrawler.crawlUpdates();
      let brandAucUpdates = await brandAucCrawler.crawlUpdates();

      if (!ecoAucUpdates) ecoAucUpdates = [];
      if (!brandAucUpdates) brandAucUpdates = [];

      const allUpdates = [...ecoAucUpdates, ...brandAucUpdates];

      // DB에서 기존 데이터 가져오기
      const itemIds = allUpdates.map((item) => item.item_id);
      const [existingItems] = await pool.query(
        "SELECT item_id, scheduled_date, starting_price FROM crawled_items WHERE item_id IN (?) AND bid_type = 'direct'",
        [itemIds]
      );

      // 변경된 항목만 필터링 (scheduled_date 또는 starting_price가 변경된 것)
      const changedItems = allUpdates.filter((newItem) => {
        const existingItem = existingItems.find(
          (item) => item.item_id === newItem.item_id
        );
        if (!existingItem) return true; // 새 아이템이면 포함

        // scheduled_date 또는 starting_price가 변경되었는지 확인
        return (
          (newItem.scheduled_date &&
            newItem.scheduled_date !== existingItem.scheduled_date) ||
          (newItem.starting_price &&
            newItem.starting_price !== existingItem.starting_price)
        );
      });

      // 변경된 아이템이 있으면 DB 업데이트 비동기로 실행
      if (changedItems.length > 0) {
        // await 제거하여 비동기로 DB 업데이트 처리
        DBManager.updateItems(changedItems, "crawled_items");

        // 가격 변경된 아이템에 대한 입찰 취소 처리
        processChangedBids(changedItems);
      }

      // 만료된 일정에 대한 입찰 처리는 별도로 처리
      processExpiredBids();

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      console.log(
        `Update crawl operation completed in ${formatExecutionTime(
          executionTime
        )}`
      );

      return {
        ecoAucCount: ecoAucUpdates.length,
        brandAucCount: brandAucUpdates.length,
        changedItemsCount: changedItems.length,
        executionTime: formatExecutionTime(executionTime),
      };
    } catch (error) {
      console.error("Update crawl failed:", error);
      throw error;
    } finally {
      isUpdateCrawling = false;
    }
  }
}

// 가격 변경에 따른 입찰 취소 처리
async function processChangedBids(changedItems) {
  // 처리할 것이 없으면 빠르게 종료
  if (!changedItems || changedItems.length === 0) return;

  // 가격이 변경된 아이템만 필터링
  const priceChangedItems = changedItems.filter((item) => item.starting_price);
  if (priceChangedItems.length === 0) return;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 가격이 변경된 아이템 ID 추출
    const itemIds = priceChangedItems.map((item) => item.item_id);

    // 관련된 모든 active 입찰 조회
    const [activeBids] = await conn.query(
      "SELECT db.id, db.item_id, db.current_price, ci.starting_price " +
        "FROM direct_bids db " +
        "JOIN crawled_items ci ON db.item_id = ci.item_id " +
        "WHERE db.item_id IN (?) AND db.status = 'active'",
      [itemIds]
    );

    // 취소해야 할 입찰 ID 찾기
    const bidsToCancel = activeBids
      .filter(
        (bid) => parseFloat(bid.current_price) < parseFloat(bid.starting_price)
      )
      .map((bid) => bid.id);

    // 취소 처리 - 100개씩 배치 처리
    for (let i = 0; i < bidsToCancel.length; i += 100) {
      const batch = bidsToCancel.slice(i, i + 100);
      if (batch.length > 0) {
        await conn.query(
          "UPDATE direct_bids SET status = 'cancelled' WHERE id IN (?) AND status = 'active'",
          [batch]
        );

        console.log(
          `Cancelled batch ${Math.floor(i / 100) + 1}: ${
            batch.length
          } bids due to price changes`
        );
      }
    }

    await conn.commit();
    console.log(
      `Total cancelled due to price changes: ${bidsToCancel.length} bids`
    );
  } catch (error) {
    await conn.rollback();
    console.error("Error cancelling bids:", error);
  } finally {
    conn.release();
  }
}

async function processExpiredBids() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // JOIN을 사용하여 만료된 아이템과 관련 입찰을 함께 조회
    const [expiredItemBids] = await conn.query(
      "SELECT db.id, db.item_id, db.current_price, ci.starting_price " +
        "FROM direct_bids db " +
        "JOIN crawled_items ci ON ci.item_id = db.item_id " +
        "WHERE ci.scheduled_date < NOW() " +
        "AND ci.bid_type = 'direct' " +
        "AND db.status = 'active' " +
        "ORDER BY db.item_id, db.current_price DESC"
    );

    if (expiredItemBids.length === 0) {
      console.log("No expired scheduled items with active bids found");
      return;
    }

    // 아이템별로 그룹화
    const bidsByItem = {};
    const uniqueItemIds = new Set();

    expiredItemBids.forEach((bid) => {
      if (!bidsByItem[bid.item_id]) {
        bidsByItem[bid.item_id] = [];
        uniqueItemIds.add(bid.item_id);
      }
      bidsByItem[bid.item_id].push(bid);
    });

    console.log(`Found ${uniqueItemIds.size} expired items with active bids`);

    const bidsToComplete = [];
    const bidsToCancel = [];

    // 각 만료된 아이템별로 처리
    Object.keys(bidsByItem).forEach((itemId) => {
      const itemBids = bidsByItem[itemId];
      if (itemBids.length === 0) return;

      // 최고가 입찰
      const highestBid = itemBids[0]; // 이미 DESC로 정렬되어 있음

      // starting_price와 일치하는지 확인
      if (
        parseFloat(highestBid.current_price) >=
        parseFloat(highestBid.starting_price)
      ) {
        // 최고가 입찰은 완료 처리
        bidsToComplete.push(highestBid.id);

        // 나머지 입찰들은 취소 처리
        itemBids.slice(1).forEach((bid) => {
          bidsToCancel.push(bid.id);
        });
      } else {
        // 최고가 입찰이 starting_price보다 낮으면 모두 취소 처리
        itemBids.forEach((bid) => {
          bidsToCancel.push(bid.id);
        });
      }
    });

    // 완료 처리 - 100개씩 배치 처리
    for (let i = 0; i < bidsToComplete.length; i += 100) {
      const batch = bidsToComplete.slice(i, i + 100);
      if (batch.length > 0) {
        await conn.query(
          "UPDATE direct_bids SET status = 'completed' WHERE id IN (?) AND status = 'active'",
          [batch]
        );

        console.log(
          `Completed batch ${Math.floor(i / 100) + 1}: ${
            batch.length
          } bids for expired items`
        );
      }
    }

    // 취소 처리 - 100개씩 배치 처리
    for (let i = 0; i < bidsToCancel.length; i += 100) {
      const batch = bidsToCancel.slice(i, i + 100);
      if (batch.length > 0) {
        await conn.query(
          "UPDATE direct_bids SET status = 'cancelled' WHERE id IN (?) AND status = 'active'",
          [batch]
        );

        console.log(
          `Cancelled batch ${Math.floor(i / 100) + 1}: ${
            batch.length
          } bids for expired items`
        );
      }
    }

    await conn.commit();
    console.log(
      `Expired items processed: ${uniqueItemIds.size}, completed: ${bidsToComplete.length}, cancelled: ${bidsToCancel.length}`
    );
  } catch (error) {
    await conn.rollback();
    console.error("Error processing expired bids:", error);
  } finally {
    conn.release();
  }
}

// 인보이스 크롤링 함수
async function crawlAllInvoices() {
  try {
    console.log(`Starting invoice crawl at ${new Date().toISOString()}`);
    const startTime = Date.now();

    // 세 크롤러에서 청구서 정보 크롤링
    const ecoInvoices = await ecoAucCrawler.crawlInvoices();
    const brandInvoices = await brandAucCrawler.crawlInvoices();
    const starInvoices = await starAucCrawler.crawlInvoices();

    // 결과 합치기
    const allInvoices = [
      ...(ecoInvoices || []),
      ...(brandInvoices || []),
      ...(starInvoices || []),
    ];

    // DB에 저장
    await DBManager.saveItems(allInvoices, "invoices");

    const endTime = Date.now();
    const executionTime = endTime - startTime;

    console.log(
      `Invoice crawl completed in ${formatExecutionTime(executionTime)}`
    );

    return {
      ecoAucCount: ecoInvoices?.length || 0,
      brandAucCount: brandInvoices?.length || 0,
      starAucCount: starInvoices?.length || 0,
      totalCount: allInvoices.length,
      executionTime: formatExecutionTime(executionTime),
    };
  } catch (error) {
    console.error("Invoice crawl failed:", error);
    throw error;
  }
}

// 실행 시간 포맷팅 함수
function formatExecutionTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const remainingMinutes = minutes % 60;
  const remainingSeconds = seconds % 60;

  return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
}

// 라우팅 추가
router.get("/crawl-updates", isAdmin, async (req, res) => {
  try {
    const result = await crawlAllUpdates();

    res.json({
      message: "Update crawling completed successfully",
      stats: result,
    });
  } catch (error) {
    console.error("Update crawling error:", error);
    res.status(500).json({
      message: "Error during update crawling",
      error: error.message,
    });
  }
});

router.get("/crawl", isAdmin, async (req, res) => {
  try {
    await crawlAll();

    res.json({
      message: "Crawling and image processing completed successfully",
    });
  } catch (error) {
    console.error("Crawling error:", error);
    res.status(500).json({ message: "Error during crawling" });
  }
});

router.get("/crawl-values", isAdmin, async (req, res) => {
  try {
    // auc_num 파라미터 파싱 (auc_num=1,2,3 형태로 받음)
    const aucNums = req.query.auc_num
      ? req.query.auc_num.split(",").map((num) => parseInt(num.trim()))
      : [];

    // months 파라미터 파싱 (months=3,6,12 형태로 받음)
    const monthsInput = req.query.months
      ? req.query.months.split(",").map((m) => parseInt(m.trim()))
      : [];

    // 결과 및 실행 정보
    const result = await crawlAllValues({
      aucNums,
      months: monthsInput,
    });

    res.json({
      message: "Value crawling completed successfully",
      result,
    });
  } catch (error) {
    console.error("Value crawling error:", error);
    res
      .status(500)
      .json({ message: "Error during value crawling", error: error.message });
  }
});

router.get("/crawl-status", isAdmin, (req, res) => {
  try {
    res.json({
      isCrawling,
      isValueCrawling,
      isUpdateCrawling,
      updateInterval: process.env.UPDATE_INTERVAL || "3600",
    });
  } catch (error) {
    console.error("Crawling status error:", error);
    res.status(500).json({ message: "Error getting crawling status" });
  }
});

// 인보이스 크롤링 라우팅 추가
router.get("/crawl-invoices", isAdmin, async (req, res) => {
  try {
    const result = await crawlAllInvoices();

    res.json({
      message: "Invoice crawling completed successfully",
      stats: result,
    });
  } catch (error) {
    console.error("Invoice crawling error:", error);
    res.status(500).json({
      message: "Error during invoice crawling",
      error: error.message,
    });
  }
});

const scheduleCrawling = async () => {
  const settings = await getAdminSettings();

  console.log(`Crawling schedule: ${settings.crawlSchedule}`);

  if (settings && settings.crawlSchedule) {
    const [hours, minutes] = settings.crawlSchedule.split(":");
    cron.schedule(
      `${minutes} ${hours} * * *`,
      async () => {
        console.log("Running scheduled crawling task");
        try {
          // 기본 상품 크롤링 실행
          await crawlAll();

          // 현재 요일 확인 (0: 일요일, 1: 월요일, ...)
          const currentDay = new Date().getDay();

          // 일요일이면 시세표 크롤링도 실행
          if (currentDay === 0) {
            console.log("Sunday detected - running value crawling as well");
            await crawlAllValues();
          }

          // 매일 인보이스 크롤링도 실행
          console.log("Running invoice crawling");
          await crawlAllInvoices();

          console.log("Scheduled crawling completed successfully");
        } catch (error) {
          console.error("Scheduled crawling error:", error);
        }
      },
      {
        scheduled: true,
        timezone: "Asia/Seoul",
      }
    );
  }
};

const scheduleUpdateCrawling = () => {
  const updateInterval = parseInt(process.env.UPDATE_INTERVAL, 10) || 3600; // 기본값은 1시간(3600초)

  console.log(
    `Scheduling update crawling to run every ${updateInterval} seconds`
  );

  // 밀리초 단위로 변환하여 setInterval 설정
  setInterval(async () => {
    console.log("Running scheduled update crawling task");
    try {
      if (!isCrawling && !isUpdateCrawling && !isValueCrawling) {
        const result = await crawlAllUpdates();
        console.log("Scheduled update crawling completed successfully", {
          ecoAucCount: result.ecoAucCount,
          brandAucCount: result.brandAucCount,
          totalCount: result.totalCount,
          executionTime: result.executionTime,
        });
      } else {
        console.log(
          "Skipping scheduled update crawling - another crawling process is active"
        );
      }
    } catch (error) {
      console.error("Scheduled update crawling error:", error);
    }
  }, updateInterval * 1000);
};

if (process.env.ENV === "development") {
  console.log("development env");
} else {
  console.log("product env");
  scheduleCrawling();
  scheduleUpdateCrawling();
  loginAll();
}

module.exports = router;
