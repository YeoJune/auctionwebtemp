// crawlers/ecoAuc.js
const cheerio = require("cheerio");
const { AxiosCrawler, Crawler } = require("./baseCrawler");
const { processImagesInChunks } = require("../utils/processImage");

const ecoAucConfig = {
  name: "EcoAuc",
  baseUrl: "https://www.ecoauc.com",
  loginCheckUrl: "https://www.ecoauc.com/client/users",
  loginPageUrl: "https://www.ecoauc.com/client/users/sign-in",
  loginPostUrl: "https://www.ecoauc.com/client/users/post-sign-in",
  searchUrl: "https://www.ecoauc.com/client/auctions/inspect",
  loginData: {
    userId: process.env.CRAWLER_EMAIL1,
    password: process.env.CRAWLER_PASSWORD1,
  },
  categoryIds: ["1", "2", "3", "4", "5", "8", "9", "27"],
  categoryTable: {
    1: "시계",
    2: "가방",
    3: "귀금속",
    4: "악세서리",
    5: "소품",
    8: "의류",
    9: "신발",
    27: "기타",
  },
  signinSelectors: {
    userId: 'input[name="email_address"]',
    password: 'input[name="password"]',
    loginButton: 'button.btn-signin[type="submit"]',
    csrfToken: 'input[name="_csrfToken"]',
  },
  crawlSelectors: {
    paginationLast: ".last a",
    itemContainer: ".col-sm-6.col-md-4.col-lg-3.mb-grid-card",
    id: "[data-auction-item-id]",
    title: ".card b",
    brand: "small.show-case-bland",
    rank: ".canopy.canopy-3.text-default > li:nth-child(1)",
    startingPrice: ".canopy.canopy-3.text-default > li:nth-child(2) big",
    image: ".pc-image-area img",
    scheduledDate: "span.market-title",
  },
  crawlDetailSelectors: {
    images: ".item-thumbnail",
    description: ".item-info.view-form",
    binder: ".col-md-8.col-lg-7 .dl-horizontal",
  },
  searchParams: (categoryId, page) =>
    `?limit=200&sortKey=1&tableType=grid&master_item_categories[0]=${categoryId}&page=${page}`,
  detailUrl: (itemId, bidType) => {
    if (bidType === "direct") {
      return `https://www.ecoauc.com/client/auction-items/view/${itemId}/TimelimitAuctions`;
    } else {
      return `https://www.ecoauc.com/client/auction-items/view/${itemId}/Auctions/inspect`;
    }
  },
};

const ecoAucValueConfig = {
  name: "EcoAucValue",
  baseUrl: "https://www.ecoauc.com",
  loginCheckUrl: "https://www.ecoauc.com/client/users",
  accountUrl: "https://www.ecoauc.com/client/users",
  loginPageUrl: "https://www.ecoauc.com/client/users/sign-in",
  loginPostUrl: "https://www.ecoauc.com/client/users/post-sign-in",
  searchUrl: "https://www.ecoauc.com/client/market-prices",
  loginData: {
    userId: process.env.CRAWLER_EMAIL1,
    password: process.env.CRAWLER_PASSWORD1,
  },
  categoryIds: ["1", "2", "3", "4", "5", "8", "9", "27"],
  categoryTable: {
    1: "시계",
    2: "가방",
    3: "귀금속",
    4: "악세서리",
    5: "소품",
    8: "의류",
    9: "신발",
    27: "기타",
  },
  signinSelectors: {
    userId: 'input[name="email_address"]',
    password: 'input[name="password"]',
    loginButton: 'button.btn-signin[type="submit"]',
    csrfToken: 'input[name="_csrfToken"]',
  },
  crawlSelectors: {
    paginationLast: ".last a",
    itemContainer: ".col-sm-6.col-md-4.col-lg-3",
    id: "a",
    title: "b",
    brand: "small.show-case-bland",
    rank: ".canopy-rank",
    finalPrice: ".pull-right.show-value",
    image: ".pc-image-area img",
    scheduledDate: ".show-case-daily",
  },
  crawlDetailSelectors: {
    images: ".item-thumbnail",
    description: ".item-info.view-form",
    binder: ".col-md-8.col-lg-7 .dl-horizontal",
  },
  searchParams: (categoryId, page, months = 3) => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    return `?limit=200&sortKey=1&tableType=grid&master_item_categories[0]=${categoryId}&page=${page}&target_start_year=${startDate.getFullYear()}&target_start_month=${
      startDate.getMonth() + 1
    }&target_end_year=${endDate.getFullYear()}&target_end_month=${
      endDate.getMonth() + 1
    }&`;
  },
  detailUrl: (itemId) =>
    `https://www.ecoauc.com/client/auction-items/view/${itemId}`,
};

class EcoAucCrawler extends AxiosCrawler {
  constructor(config) {
    super(config);
    this.config.currentCategoryId = null; // 현재 크롤링 중인 카테고리 ID
  }

  async login() {
    // 부모 클래스(AxiosCrawler)의 login 메서드 호출
    // 이미 로그인 되어있는지, 다른 로그인 진행중인지 등을 체크
    const shouldContinue = await super.login();

    // 부모 메서드에서 이미 로그인 되어있다고 판단되면 종료
    if (shouldContinue === true) {
      return true;
    }

    // 다른 로그인 진행중이면 해당 Promise를 반환
    if (shouldContinue instanceof Promise) {
      return shouldContinue;
    }

    // 실제 로그인 로직 구현
    this.loginPromise = this.retryOperation(async () => {
      try {
        console.log("Logging in to Eco Auction...");

        // 로그인 페이지 가져오기
        const response = await this.client.get(this.config.loginPageUrl);

        // CSRF 토큰 추출
        const $ = cheerio.load(response.data);
        const csrfToken = $(this.config.signinSelectors.csrfToken).val();

        if (!csrfToken) {
          throw new Error("CSRF token not found");
        }

        // 폼 데이터 준비
        const formData = new URLSearchParams();
        formData.append("email_address", this.config.loginData.userId);
        formData.append("password", this.config.loginData.password);
        formData.append("_csrfToken", csrfToken);

        // 로그인 요청
        const loginResponse = await this.client.post(
          this.config.loginPostUrl,
          formData,
          {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Referer: this.config.loginPostUrl,
            },
            maxRedirects: 5,
            validateStatus: function (status) {
              return status >= 200 && status < 400; // 300-399 리다이렉트 허용
            },
          }
        );

        // 로그인 후 검증
        if (loginResponse.status === 200 && (await this.loginCheck())) {
          console.log("Login successful");
          this.isLoggedIn = true;
          this.loginTime = Date.now();
          return true;
        } else {
          throw new Error("Login failed");
        }
      } finally {
        // 성공 또는 실패 상관없이 로그인 Lock 해제
        this.loginInProgress = false;
      }
    });

    return this.loginPromise;
  }

  async crawlAllItems(existingIds = new Set()) {
    try {
      const startTime = Date.now();
      console.log(`Starting crawl at ${new Date().toISOString()}`);

      // 로그인
      await this.login();

      const allCrawledItems = [];

      // Live와 Direct 경매 URL 구성
      const urlConfigs = [
        { url: "https://www.ecoauc.com/client/auctions/inspect", type: "live" },
        {
          url: "https://www.ecoauc.com/client/timelimit-auctions",
          type: "direct",
        },
      ];

      // 각 URL에 대해 크롤링 수행
      for (const urlConfig of urlConfigs) {
        console.log(`Starting crawl for bid type: ${urlConfig.type}`);

        // 현재 URL과 bid_type 설정
        this.config.searchUrl = urlConfig.url;
        this.currentBidType = urlConfig.type;

        // 모든 카테고리 순회
        for (const categoryId of this.config.categoryIds) {
          const categoryItems = [];

          console.log(
            `Starting crawl for category ${categoryId} with bid type ${urlConfig.type}`
          );
          this.config.currentCategoryId = categoryId;

          const totalPages = await this.getTotalPages(categoryId);
          console.log(`Total pages in category ${categoryId}: ${totalPages}`);

          // 모든 페이지 크롤링
          for (let page = 1; page <= totalPages; page++) {
            const pageItems = await this.crawlPage(
              categoryId,
              page,
              existingIds
            );
            categoryItems.push(...pageItems);
          }

          if (categoryItems && categoryItems.length > 0) {
            allCrawledItems.push(...categoryItems);
            console.log(
              `Completed crawl for category ${categoryId}, bid type ${urlConfig.type}. Items found: ${categoryItems.length}`
            );
          } else {
            console.log(
              `No items found for category ${categoryId}, bid type ${urlConfig.type}`
            );
          }
        }
      }

      if (allCrawledItems.length === 0) {
        console.log("No items were crawled. Aborting save operation.");
        return [];
      }

      console.log(
        `Crawling completed for all categories. Total items: ${allCrawledItems.length}`
      );

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      console.log(
        `Operation completed in ${this.formatExecutionTime(executionTime)}`
      );

      return allCrawledItems;
    } catch (error) {
      console.error("Crawl failed:", error);
      return [];
    }
  }

  async crawlPage(categoryId, page, existingIds = new Set()) {
    return this.retryOperation(async () => {
      console.log(`Crawling page ${page} in category ${categoryId}...`);
      const url =
        this.config.searchUrl + this.config.searchParams(categoryId, page);

      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);

      // 아이템 컨테이너 선택
      const itemElements = $(this.config.crawlSelectors.itemContainer);

      // 원본 로직과 동일하게 필터링 처리
      const [filteredElements, filteredItems, remainItems] = this.filterHandles(
        $,
        itemElements,
        existingIds
      );

      console.log(
        `Filtered to ${filteredElements.length} items for detailed extraction`
      );

      // 필터링된 아이템이 없으면 종료
      if (filteredElements.length === 0) {
        console.log("No items to extract after filtering");
        return remainItems;
      }

      const pageItems = [];
      for (let i = 0; i < filteredItems.length; i++) {
        const item = this.extractItemInfo(
          $,
          $(filteredElements[i]),
          filteredItems[i]
        );
        if (item) pageItems.push(item);
      }

      const processedItems = await processImagesInChunks(
        pageItems,
        "products",
        3
      );

      console.log(`Crawled ${processedItems.length} items from page ${page}`);
      return [...processedItems, ...remainItems];
    });
  }

  async crawlItemDetails(itemId, item0) {
    return this.retryOperation(async () => {
      console.log(`Crawling details for item ${itemId}...`);
      await this.login();

      const bidType = item0?.bid_type || this.currentBidType;
      const url = this.config.detailUrl(itemId, bidType);

      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);

      // 추가 이미지 추출
      const images = [];
      $(this.config.crawlDetailSelectors.images).each((i, element) => {
        if (i % 3 === 0) {
          // 3개 중 1개만 선택 (기존 로직과 일치)
          const style = $(element).attr("style");
          if (style) {
            const urlMatch = style.replace(/[\'\"]/g, "").match(/url\((.*?)\)/);
            if (urlMatch) {
              const imageUrl = urlMatch[1]
                .replace(/&quot;/g, "")
                .split("?")[0]
                .trim();
              images.push(imageUrl + "?w=520&h=390");
            }
          }
        }
      });

      // 설명 추출 - 원본과 동일하게 children[3] 접근
      const $description = $(this.config.crawlDetailSelectors.description);
      const description =
        $description.length > 0
          ? $description.children().eq(3).text().trim()
          : "-";

      // 부속품 코드 추출 - 원본과 동일하게 children[13] 접근
      const $binder = $(this.config.crawlDetailSelectors.binder);
      const accessoryCode =
        $binder.length > 0 ? $binder.children().eq(13).text().trim() : "";

      const item = {
        additional_images: JSON.stringify(images),
        description: description || "-",
        accessory_code: accessoryCode || "",
      };

      // 원본과 동일한 후처리
      if (!item.description) item.description = "-";

      return item;
    });
  }

  async getTotalPages(categoryId) {
    return this.retryOperation(async () => {
      console.log(`Getting total pages for category ${categoryId}...`);
      const url =
        this.config.searchUrl + this.config.searchParams(categoryId, 1);

      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);

      const paginationExists =
        $(this.config.crawlSelectors.paginationLast).length > 0;

      if (paginationExists) {
        const href = $(this.config.crawlSelectors.paginationLast).attr("href");
        const match = href.match(/page=(\d+)/);
        if (match) {
          return parseInt(match[1], 10);
        }
      } else {
        const itemExists =
          $(this.config.crawlSelectors.itemContainer).length > 0;
        return itemExists ? 1 : 0;
      }

      throw new Error("Unable to determine total pages");
    });
  }

  filterHandles($, elements, existingIds) {
    const items = [];
    elements.each((index, element) => {
      items.push(this.filterHandle($, element, existingIds));
    });

    // 필터링 결과에 따라 분류
    let filteredElements = [],
      filteredItems = [],
      remainItems = [];

    for (let i = 0; i < items.length; i++) {
      if (items[i]) {
        if (items[i].scheduled_date) {
          filteredElements.push(elements.get(i));
          filteredItems.push(items[i]);
        } else {
          remainItems.push(items[i]);
        }
      }
    }

    return [filteredElements, filteredItems, remainItems];
  }

  filterHandle($, element, existingIds) {
    const $element = $(element);

    // 아이템 ID 추출 - 다양한 방식으로 시도
    let itemId = null;
    const $id = $element.find(this.config.crawlSelectors.id);

    if ($id.length > 0) {
      itemId = $id.attr("data-auction-item-id");
    }

    // 대체 방법: 직접 선택자로 시도
    if (!itemId) {
      const $altId = $element.find("[data-auction-item-id]");
      if ($altId.length > 0) {
        itemId = $altId.attr("data-auction-item-id");
      }
    }

    // 날짜 추출
    const $scheduledDate = $element.find(
      this.config.crawlSelectors.scheduledDate
    );
    const scheduledDateText =
      $scheduledDate.length > 0 ? $scheduledDate.text().trim() : null;
    const scheduledDate = this.extractDate(scheduledDateText);

    // 원본 로직과 일치하게 필터링
    if (!this.isCollectionDay(scheduledDate)) return null;
    if (existingIds.has(itemId)) return { item_id: itemId };

    return {
      item_id: itemId,
      scheduled_date: scheduledDate,
    };
  }

  extractItemInfo($, element, item0) {
    const $element = element; // 이미 jQuery 객체여야 함

    // 제목 추출
    const $title = $element.find(this.config.crawlSelectors.title);
    const title = $title.length > 0 ? $title.text().trim() : null;

    // 브랜드 추출
    const $brand = $element.find(this.config.crawlSelectors.brand);
    const brand = $brand.length > 0 ? $brand.text().trim() : null;

    // 등급 추출 - 원본에 맞춰 조정
    let rank = null;
    const $rank = $element.find(this.config.crawlSelectors.rank);

    if ($rank.length > 0) {
      try {
        const contentsLength = $rank.contents().length;

        if (contentsLength >= 5) {
          // 5번째 노드가 있으면 해당 노드 사용
          const rankNode = $rank.contents().get(4);
          rank = rankNode ? $(rankNode).text().trim() : null;
        } else {
          // 노드가 부족하면 텍스트만 추출
          rank = $rank.text().trim().split(":")[1]?.trim() || null;
        }
      } catch (err) {
        console.log("등급 추출 오류:", err.message);
        // 대안으로 전체 텍스트에서 추출 시도
        rank = $rank.text().trim();
      }
    }

    // 시작가 추출
    const $startingPrice = $element.find(
      this.config.crawlSelectors.startingPrice
    );
    const startingPriceText =
      $startingPrice.length > 0 ? $startingPrice.text().trim() : null;

    // 이미지 추출
    const $image = $element.find(this.config.crawlSelectors.image);
    const imageSrc = $image.length > 0 ? $image.attr("src") : null;
    const image = imageSrc
      ? imageSrc.replace(/\?.*$/, "") + "?w=520&h=390"
      : null;

    const original_scheduled_date = item0.scheduled_date;
    let scheduled_date = original_scheduled_date;

    // live 경매의 경우 전날 18:00로 설정하고 지난 경매 필터링
    if (this.currentBidType === "live") {
      scheduled_date = this.getPreviousDayAt18(original_scheduled_date);

      // 이미 지난 경매 필터링
      if (!this.isAuctionTimeValid(scheduled_date)) {
        return null;
      }
    }

    const item = {
      item_id: item0.item_id,
      original_title: title,
      title: this.removeLeadingBrackets(title),
      brand: brand,
      rank: rank,
      starting_price: this.currencyToInt(startingPriceText),
      image: image,
      category: this.config.categoryTable[this.config.currentCategoryId],
      bid_type: this.currentBidType,
      original_scheduled_date: original_scheduled_date,
      scheduled_date: scheduled_date,
      auc_num: "1",

      kaijoCd: 0,
      kaisaiKaisu: 0,
    };

    // 원본과 동일하게 객체 병합
    return item;
  }

  async crawlUpdates() {
    try {
      const startTime = Date.now();
      console.log(`Starting updates crawl at ${new Date().toISOString()}`);

      // 로그인
      await this.login();

      const allCrawledItems = [];

      // Direct 경매 URL만 사용
      const urlConfig = {
        url: "https://www.ecoauc.com/client/timelimit-auctions",
        type: "direct",
      };

      console.log(`Starting update crawl for bid type: ${urlConfig.type}`);

      // 현재 URL과 bid_type 설정
      this.config.searchUrl = urlConfig.url;
      this.currentBidType = urlConfig.type;

      // 모든 카테고리 순회
      for (const categoryId of this.config.categoryIds) {
        const categoryItems = [];

        console.log(
          `Starting update crawl for category ${categoryId} with bid type ${urlConfig.type}`
        );
        this.config.currentCategoryId = categoryId;

        const totalPages = await this.getTotalPages(categoryId);
        console.log(`Total pages in category ${categoryId}: ${totalPages}`);

        // 모든 페이지 크롤링
        for (let page = 1; page <= totalPages; page++) {
          const pageItems = await this.crawlUpdatePage(categoryId, page);
          categoryItems.push(...pageItems);
        }

        if (categoryItems && categoryItems.length > 0) {
          allCrawledItems.push(...categoryItems);
          console.log(
            `Completed update crawl for category ${categoryId}, bid type ${urlConfig.type}. Items found: ${categoryItems.length}`
          );
        } else {
          console.log(
            `No update items found for category ${categoryId}, bid type ${urlConfig.type}`
          );
        }
      }

      if (allCrawledItems.length === 0) {
        console.log("No update items were crawled. Aborting operation.");
        return [];
      }

      console.log(
        `Update crawling completed for all categories. Total items: ${allCrawledItems.length}`
      );

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      console.log(
        `Update operation completed in ${this.formatExecutionTime(
          executionTime
        )}`
      );

      return allCrawledItems;
    } catch (error) {
      console.error("Update crawl failed:", error);
      return [];
    }
  }

  async crawlUpdatePage(categoryId, page) {
    return this.retryOperation(async () => {
      console.log(`Crawling update page ${page} in category ${categoryId}...`);
      const url =
        this.config.searchUrl + this.config.searchParams(categoryId, page);

      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);

      // 아이템 컨테이너 선택
      const itemElements = $(this.config.crawlSelectors.itemContainer);
      console.log(`Found ${itemElements.length} items on update page ${page}`);

      if (itemElements.length === 0) {
        return [];
      }

      // 배열로 변환하여 처리
      const pageItems = [];
      itemElements.each((index, element) => {
        const item = this.extractUpdateItemInfo($, $(element));
        if (item) {
          // null이 아닌 유효한 항목만 추가
          pageItems.push(item);
        }
      });

      console.log(`Crawled ${pageItems.length} update items from page ${page}`);
      return pageItems;
    });
  }

  extractUpdateItemInfo($, element) {
    try {
      // 아이템 ID 추출
      const $id = element.find(this.config.crawlSelectors.id);
      let itemId = null;

      if ($id.length > 0) {
        itemId = $id.attr("data-auction-item-id");
      }

      // 대체 방법: 직접 선택자로 시도
      if (!itemId) {
        const $altId = element.find("[data-auction-item-id]");
        if ($altId.length > 0) {
          itemId = $altId.attr("data-auction-item-id");
        }
      }

      if (!itemId) {
        return null;
      }

      // 날짜 추출
      const $scheduledDate = element.find(
        this.config.crawlSelectors.scheduledDate
      );
      const scheduledDateText =
        $scheduledDate.length > 0 ? $scheduledDate.text().trim() : null;
      const scheduledDate = this.extractDate(scheduledDateText);

      // 시작가 추출
      const $startingPrice = element.find(
        this.config.crawlSelectors.startingPrice
      );
      const startingPriceText =
        $startingPrice.length > 0 ? $startingPrice.text().trim() : null;
      const startingPrice = this.currencyToInt(startingPriceText);

      // 경매 날짜가 유효하지 않으면 null 반환
      if (!this.isCollectionDay(scheduledDate)) {
        return null;
      }

      return {
        item_id: itemId,
        scheduled_date: scheduledDate,
        starting_price: startingPrice,
        bid_type: this.currentBidType,
      };
    } catch (error) {
      console.error("Error extracting update item info:", error);
      return null;
    }
  }

  async directBid(item_id, price) {
    try {
      console.log(
        `Placing direct bid for item ${item_id} with price ${price}...`
      );

      // 클라이언트 확인
      if (!this.client) {
        console.log("HTTP client not initialized. Creating new client.");
        this.initializeClient();
      }

      // 로그인 확인
      await this.login();

      // CSRF 토큰 가져오기 - 메인 페이지에서
      const mainPageResponse = await this.client.get(ecoAucConfig.searchUrl);
      const $ = cheerio.load(mainPageResponse.data);
      const csrfToken = $('[name="_csrfToken"]').attr("value");

      if (!csrfToken) {
        console.warn(
          "CSRF token not found on main page. Continuing without it..."
        );
      } else {
        console.log("CSRF token retrieved successfully");
      }

      // POST 요청 데이터 준비
      const userId = process.env.ECO_BID_USER_ID;
      console.log(`Using user ID: ${userId}`);

      const bidData = new URLSearchParams();
      bidData.append("user_id", userId);
      bidData.append("auction_item_id", item_id.toString());
      bidData.append("bid_price", price.toString());

      console.log(`Bid data prepared: ${bidData.toString()}`);

      // 입찰 요청 전송 - 완전한 URL 사용
      const bidUrl = "https://www.ecoauc.com/client/timelimit-auctions/bid";
      console.log(`Sending bid request to: ${bidUrl}`);

      const bidResponse = await this.client.post(bidUrl, bidData, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Referer: "https://www.ecoauc.com/client/timelimit-auctions",
          Origin: "https://www.ecoauc.com",
          ...(csrfToken && { "X-CSRF-Token": csrfToken }),
          "X-Requested-With": "XMLHttpRequest",
        },
      });

      // 응답 확인
      if (bidResponse.status === 200 && bidResponse.data.success) {
        console.log(`Bid successful for item ${item_id} with price ${price}`);
        return {
          success: true,
          message: "Bid placed successfully",
          data: bidResponse.data,
        };
      } else {
        throw new Error(
          `Bid failed for item ${item_id}. with price ${price}.)`
        );
      }
    } catch (err) {
      console.error("Error placing bid:", err.message);
      return {
        success: false,
        message: "Bid failed",
        error: err.message,
      };
    }
  }

  async crawlInvoices() {
    try {
      console.log("Starting to crawl invoices...");

      // 로그인 확인
      await this.login();

      // 청구서 페이지 요청
      const url = "https://www.ecoauc.com/client/bids/bidwin";
      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);

      // 테이블 행 추출
      const rows = $("table.table-striped tbody tr");
      console.log(`Found ${rows.length} invoice records`);

      if (rows.length === 0) {
        console.log("No invoice records found");
        return [];
      }

      const invoices = [];

      // 각 행에서 필요한 정보 추출
      rows.each((index, element) => {
        const $row = $(element);

        // 날짜 추출
        const dateText = $row.find("td:nth-child(1)").text().trim();
        const date = this.extractDate(dateText);

        // auc_num을 1로 고정 (크롤러 간의 식별자)
        const auc_num = "1";

        // 상태 추출
        const statusText = $row.find("td:nth-child(6)").text().trim();
        const status = statusText.includes("Paid") ? "paid" : "unpaid";

        // 금액 추출
        const amountText = $row.find("td:nth-child(5)").text().trim();
        const amount = this.currencyToInt(amountText);

        // 경매 ID 추출 (추가 정보로 유용할 수 있음)
        const auctionIdMatch = $row
          .find("[data-auction-id]")
          .attr("data-auction-id");
        const auction_id = auctionIdMatch || "";

        // 링크 정보 추출 (추가 정보로 유용할 수 있음)
        const invoiceLink = $row
          .find('a[href*="/invoice-download/"]')
          .attr("href");
        const csvLink = $row
          .find('a[href*="/invoice-download/"][href$="/csv"]')
          .attr("href");

        // 낙찰 항목 수 추출
        const winCountText = $row.find("td:nth-child(3) a").text().trim();
        const winCountMatch = winCountText.match(/(\d+)\s+items/);
        const win_count = winCountMatch ? parseInt(winCountMatch[1], 10) : 0;

        // 판매 항목 수 추출
        const sellCountText = $row.find("td:nth-child(4) a").text().trim();
        const sellCountMatch = sellCountText.match(/(\d+)\s+items/);
        const sell_count = sellCountMatch ? parseInt(sellCountMatch[1], 10) : 0;

        // 필수 필드만 포함한 객체 생성 (date, auc_num, status, amount)
        invoices.push({
          date,
          auc_num,
          status,
          amount,
          auction_id, // auction_id는 참조용으로 유지
        });
      });

      console.log(`Successfully crawled ${invoices.length} invoices`);
      return invoices;
    } catch (error) {
      console.error("Error crawling invoices:", error);
      return [];
    }
  }
}

class EcoAucValueCrawler extends AxiosCrawler {
  constructor(config) {
    super(config);
    this.config.currentCategoryId = null; // 현재 크롤링 중인 카테고리 ID
  }

  async login() {
    // 부모 클래스(AxiosCrawler)의 login 메서드 호출
    // 이미 로그인 되어있는지, 다른 로그인 진행중인지 등을 체크
    const shouldContinue = await super.login();

    // 부모 메서드에서 이미 로그인 되어있다고 판단되면 종료
    if (shouldContinue === true) {
      return true;
    }

    // 다른 로그인 진행중이면 해당 Promise를 반환
    if (shouldContinue instanceof Promise) {
      return shouldContinue;
    }

    // 실제 로그인 로직 구현
    this.loginPromise = this.retryOperation(async () => {
      try {
        console.log("Logging in to Eco Auction...");

        // 로그인 페이지 가져오기
        const response = await this.client.get(this.config.loginPageUrl);

        // CSRF 토큰 추출
        const $ = cheerio.load(response.data);
        const csrfToken = $(this.config.signinSelectors.csrfToken).val();

        if (!csrfToken) {
          throw new Error("CSRF token not found");
        }

        // 폼 데이터 준비
        const formData = new URLSearchParams();
        formData.append("email_address", this.config.loginData.userId);
        formData.append("password", this.config.loginData.password);
        formData.append("_csrfToken", csrfToken);

        // 로그인 요청
        const loginResponse = await this.client.post(
          this.config.loginPostUrl,
          formData,
          {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Referer: this.config.loginPostUrl,
            },
            maxRedirects: 5,
            validateStatus: function (status) {
              return status >= 200 && status < 400; // 300-399 리다이렉트 허용
            },
          }
        );

        // 로그인 후 검증
        if (loginResponse.status === 200 && (await this.loginCheck())) {
          console.log("Login successful");
          this.isLoggedIn = true;
          this.loginTime = Date.now();
          return true;
        } else {
          throw new Error("Login failed");
        }
      } finally {
        // 성공 또는 실패 상관없이 로그인 Lock 해제
        this.loginInProgress = false;
      }
    });

    return this.loginPromise;
  }

  async getTotalPages(categoryId, months = 3) {
    return this.retryOperation(async () => {
      console.log(`Getting total pages for category ${categoryId}...`);
      const url =
        this.config.searchUrl + this.config.searchParams(categoryId, 1, months);

      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);

      const paginationExists =
        $(this.config.crawlSelectors.paginationLast).length > 0;

      if (paginationExists) {
        const href = $(this.config.crawlSelectors.paginationLast).attr("href");
        const match = href.match(/page=(\d+)/);
        if (match) {
          return parseInt(match[1], 10);
        }
      } else {
        const itemExists =
          $(this.config.crawlSelectors.itemContainer).length > 0;
        return itemExists ? 1 : 0;
      }

      throw new Error("Unable to determine total pages");
    });
  }

  async crawlAllItems(existingIds = new Set(), months = 3) {
    try {
      const startTime = Date.now();
      console.log(`Starting value crawl at ${new Date().toISOString()}`);
      console.log(`Crawling data for the last ${months} months`);

      // 로그인
      await this.login();

      const allCrawledItems = [];

      // 모든 카테고리 순회
      for (const categoryId of this.config.categoryIds) {
        const categoryItems = [];

        console.log(`Starting crawl for category ${categoryId}`);
        this.config.currentCategoryId = categoryId;

        const totalPages = await this.getTotalPages(categoryId, months);
        console.log(`Total pages in category ${categoryId}: ${totalPages}`);

        let isEnd = false;
        // 모든 페이지 크롤링
        for (let page = 1; page <= totalPages; page++) {
          const pageItems = await this.crawlPage(
            categoryId,
            page,
            existingIds,
            months
          );

          categoryItems.push(...pageItems);
          if (isEnd) break;
        }

        if (categoryItems && categoryItems.length > 0) {
          allCrawledItems.push(...categoryItems);
          console.log(
            `Completed crawl for category ${categoryId}. Items found: ${categoryItems.length}`
          );
        } else {
          console.log(`No items found for category ${categoryId}`);
        }
      }

      if (allCrawledItems.length === 0) {
        console.log("No items were crawled. Aborting save operation.");
        return [];
      }

      console.log(
        `Crawling completed for all categories. Total items: ${allCrawledItems.length}`
      );

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      console.log(
        `Operation completed in ${this.formatExecutionTime(executionTime)}`
      );

      return allCrawledItems;
    } catch (error) {
      console.error("Value crawl failed:", error);
      return [];
    }
  }

  async crawlPage(categoryId, page, existingIds = new Set(), months = 3) {
    return this.retryOperation(async () => {
      console.log(`Crawling page ${page} in category ${categoryId}...`);
      const url =
        this.config.searchUrl +
        this.config.searchParams(categoryId, page, months);

      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);

      // 아이템 컨테이너 선택
      const itemElements = $(this.config.crawlSelectors.itemContainer);
      console.log(`Found ${itemElements.length} items on page ${page}`);

      if (itemElements.length === 0) {
        return [];
      }

      // 배열로 변환하여 처리
      const pageItems = [];
      itemElements.each((index, element) => {
        const item = this.extractItemInfo($, $(element), existingIds);
        if (item) {
          // null이 아닌 유효한 항목만 추가
          pageItems.push(item);
        }
      });

      const processedItems = await processImagesInChunks(
        pageItems,
        "values",
        3
      );
      console.log(`Crawled ${processedItems.length} items from page ${page}`);

      return processedItems;
    });
  }

  extractItemInfo($, element, existingIds) {
    try {
      // 아이템 ID 추출
      const $id = element.find(this.config.crawlSelectors.id);
      const hrefValue = $id.attr("href") || "";
      const itemId = hrefValue.match(/[^/]+$/)?.[0] || null;

      // 이미 처리된 항목인지 확인
      if (existingIds.has(itemId)) {
        return { item_id: itemId };
      }

      // 날짜 추출
      const $scheduledDate = element.find(
        this.config.crawlSelectors.scheduledDate
      );
      const scheduledDateText = $scheduledDate.text().trim();
      const scheduledDate = this.extractDate(scheduledDateText);

      // 제목 추출
      const $title = element.find(this.config.crawlSelectors.title);
      const title = $title.text().trim();

      // 브랜드 추출
      const $brand = element.find(this.config.crawlSelectors.brand);
      const brand = $brand.text().trim();

      // 등급 추출
      const $rank = element.find(this.config.crawlSelectors.rank);
      const rank = $rank.text().trim();

      // 최종 가격 추출
      const $finalPrice = element.find(this.config.crawlSelectors.finalPrice);
      const finalPriceText = $finalPrice.text().trim();
      const finalPrice = this.currencyToInt(finalPriceText);

      // 이미지 추출
      const $image = element.find(this.config.crawlSelectors.image);
      const imageSrc = $image.attr("src") || "";
      const image = imageSrc
        ? imageSrc.replace(/\?.*$/, "") + "?w=520&h=390"
        : null;

      return {
        item_id: itemId,
        scheduled_date: scheduledDate,
        original_title: title,
        title: this.removeLeadingBrackets(title),
        brand: brand,
        rank: rank,
        final_price: finalPrice,
        image: image,
        category: this.config.categoryTable[this.config.currentCategoryId],
        auc_num: "1",
      };
    } catch (error) {
      console.error("Error extracting item info:", error);
      return null;
    }
  }

  async crawlItemDetails(itemId) {
    return this.retryOperation(async () => {
      console.log(`Crawling details for item ${itemId}...`);
      await this.login();
      const url = this.config.detailUrl(itemId);

      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);

      // 추가 이미지 추출
      const images = [];
      $(this.config.crawlDetailSelectors.images).each((i, element) => {
        if (i % 3 === 0) {
          // 3개 중 1개만 선택 (기존 로직과 일치)
          const style = $(element).attr("style");
          if (style) {
            const urlMatch = style.replace(/[\'\"]/g, "").match(/url\((.*?)\)/);
            if (urlMatch) {
              const imageUrl = urlMatch[1]
                .replace(/&quot;/g, "")
                .split("?")[0]
                .trim();
              images.push(imageUrl + "?w=520&h=390");
            }
          }
        }
      });

      // 바인더에서 날짜 추출
      const $binder = $(this.config.crawlDetailSelectors.binder);
      const scheduledDateText = $binder.children().eq(5).text().trim();
      const scheduledDate = this.extractDate(scheduledDateText);

      // 설명 추출
      const $description = $(this.config.crawlDetailSelectors.description);
      const description = $description.children().eq(3).text().trim() || "-";

      // 부속품 코드 추출
      const accessoryCode = $binder.children().eq(13).text().trim() || "";

      const item = {
        additional_images: JSON.stringify(images),
        scheduled_date: scheduledDate,
        description: description,
        accessory_code: accessoryCode,
      };

      return item;
    });
  }
}

const ecoAucCrawler = new EcoAucCrawler(ecoAucConfig);
const ecoAucValueCrawler = new EcoAucValueCrawler(ecoAucValueConfig);

module.exports = { ecoAucCrawler, ecoAucValueCrawler };
