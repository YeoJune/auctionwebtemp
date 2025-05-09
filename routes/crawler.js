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
      // EcoAuc와 BrandAuc의 direct 타입 경매만 업데이트 크롤링
      let ecoAucUpdates = await ecoAucCrawler.crawlUpdates();
      let brandAucUpdates = await brandAucCrawler.crawlUpdates();

      if (!ecoAucUpdates) ecoAucUpdates = [];
      if (!brandAucUpdates) brandAucUpdates = [];

      const allUpdates = [...ecoAucUpdates, ...brandAucUpdates];

      // 업데이트 정보를 DB에 저장
      await DBManager.updateItems(allUpdates, "crawled_items");

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
        totalCount: allUpdates.length,
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
