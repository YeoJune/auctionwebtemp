// crawlers/ecoAuc.js
const cheerio = require("cheerio");
const { AxiosCrawler, Crawler } = require("./baseCrawler");
const { processImagesInChunks } = require("../utils/processImage");

let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

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
    `?limit=20&sortKey=1&tableType=grid&master_item_categories[0]=${categoryId}&page=${page}`,
  detailUrl: (itemId) =>
    `https://www.ecoauc.com/client/auction-items/view/${itemId}`,
};

const ecoAucValueConfig = {
  name: "EcoAucValue",
  baseUrl: "https://www.ecoauc.com",
  accountUrl: "https://www.ecoauc.com/client/users",
  loginPageUrl: "https://www.ecoauc.com/client/users/sign-in",
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
    scheduledDate: "span.market-title",
  },
  crawlDetailSelectors: {
    images: ".item-thumbnail",
    description: ".item-info.view-form",
    binder: ".col-md-8.col-lg-7 .dl-horizontal",
  },
  searchParams: (categoryId, page) => {
    const date = new Date();
    return `?limit=200&sortKey=1&tableType=grid&master_item_categories[0]=${categoryId}&page=${page}&target_start_year=${date.getFullYear()}&target_start_month=${date.getMonth()}&target_end_year=${date.getFullYear()}&target_end_month=${
      date.getMonth() + 1
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

  async loginCheck() {
    // this.config.loginCheckUrl에서 200을 받으면 성공
    return this.retryOperation(async () => {
      const response = await this.client.get(this.config.loginCheckUrl);
      if (response.status === 200) {
        return true;
      } else {
        return false;
      }
    });
  }

  async login() {
    // 이미 로그인되어 있고 세션이 유효하면 재로그인 안함
    if ((await this.loginCheck()) && this.isSessionValid()) {
      console.log("Already logged in, session is valid");
      return;
    }

    return this.retryOperation(async () => {
      console.log("Logging in eco...");
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

      if (loginResponse.status === 200 && (await this.loginCheck())) {
        console.log("Login successful");
      } else {
        throw new Error("Login failed");
      }
    });
  }

  async crawlAllItems(existingIds = new Set()) {
    try {
      const startTime = Date.now();
      console.log(`Starting crawl at ${new Date().toISOString()}`);

      // 로그인
      await this.login();

      const allCrawledItems = [];

      // 모든 카테고리 순회
      for (const categoryId of this.config.categoryIds) {
        const categoryItems = [];

        console.log(`Starting crawl for category ${categoryId}`);
        this.config.currentCategoryId = categoryId;

        const totalPages = await this.getTotalPages(categoryId);
        console.log(`Total pages in category ${categoryId}: ${totalPages}`);

        // 모든 페이지 크롤링
        for (let page = 1; page <= totalPages; page++) {
          const pageItems = await this.crawlPage(categoryId, page, existingIds);
          categoryItems.push(...pageItems);
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
        pageItems.push(item);
      }

      const processedItems = await processImagesInChunks(pageItems);

      console.log(`Crawled ${processedItems.length} items from page ${page}`);
      return [...processedItems, ...remainItems];
    });
  }

  async crawlItemDetails(itemId) {
    return this.retryOperation(async () => {
      console.log(`Crawling details for item ${itemId}...`);
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

    const item = {
      original_title: title,
      title: this.removeLeadingBrackets(title),
      brand: brand,
      rank: rank,
      starting_price: this.currencyToInt(startingPriceText),
      image: image,
      category: this.config.categoryTable[this.config.currentCategoryId],
      auc_num: "1",
    };

    // 원본과 동일하게 객체 병합
    return Object.assign({}, item0, item);
  }
}

class EcoAucValueCrawler extends Crawler {
  async getTotalPages(categoryId) {
    return this.retryOperation(async () => {
      const url =
        this.config.searchUrl + this.config.searchParams(categoryId, 1);
      await this.crawlerPage.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.pageTimeout,
      });

      const paginationExists = await this.crawlerPage.$(
        this.config.crawlSelectors.paginationLast
      );

      if (paginationExists) {
        const href = await this.crawlerPage.$eval(
          this.config.crawlSelectors.paginationLast,
          (el) => el.getAttribute("href")
        );
        const match = href.match(/page=(\d+)/);
        if (match) {
          return parseInt(match[1], 10);
        }
      } else {
        const itemExists = await this.crawlerPage.$(
          this.config.crawlSelectors.itemContainer
        );
        return itemExists ? 1 : 0;
      }
      throw new Error("Unable to determine total pages");
    });
  }
  async crawlAllItems(existingIds) {
    await this.closeDetailBrowsers();
    await this.loginCheckCrawler();

    const startTime = Date.now();

    const allCrawledItems = [];
    for (const categoryId of this.config.categoryIds) {
      const categoryItems = [];

      console.log(`Starting crawl for category ${categoryId}`);
      this.config.currentCategoryId = categoryId;

      const totalPages = await this.getTotalPages(categoryId);
      console.log(`Total pages in category ${categoryId}: ${totalPages}`);
      let pageItems,
        isEnd = false;

      for (let page = 1; page <= totalPages; page++) {
        pageItems = await this.crawlPage(categoryId, page, existingIds);

        for (let item of pageItems)
          if (item.item_id && !item.japanese_title) isEnd = true;
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

    this.closeCrawlerBrowser();

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
      `Refresh operation completed in ${this.formatExecutionTime(
        executionTime
      )}`
    );

    return allCrawledItems;
  }

  async crawlPage(categoryId, page, existingIds) {
    return this.retryOperation(async () => {
      console.log(`Crawling page ${page} in category ${categoryId}...`);
      const url =
        this.config.searchUrl + this.config.searchParams(categoryId, page);

      await this.crawlerPage.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.pageTimeout,
      });

      const itemHandles = await this.crawlerPage.$$(
        this.config.crawlSelectors.itemContainer
      );
      const limit = pLimit(5);
      const pageItemsPromises = [];
      for (let i = 0; i < itemHandles.length; i++) {
        pageItemsPromises.push(
          limit(async () => {
            const item = await this.extractItemInfo(
              itemHandles[i],
              existingIds
            );
            itemHandles[i].dispose();
            return item;
          })
        );
      }
      const pageItems = await Promise.all(pageItemsPromises);
      const processedItems = await processImagesInChunks(pageItems);

      console.log(`Crawled ${processedItems.length} items from page ${page}`);

      return processedItems;
    });
  }

  async extractItemInfo(itemHandle, existingIds) {
    const item = await itemHandle.evaluate((el, config) => {
      const id = el.querySelector(config.crawlSelectors.id);
      const scheduledDate = el.querySelector(
        config.crawlSelectors.scheduledDate
      );
      const title = el.querySelector(config.crawlSelectors.title);
      const brand = el.querySelector(config.crawlSelectors.brand);
      const rank = el.querySelector(config.crawlSelectors.rank);
      const finalPrice = el.querySelector(config.crawlSelectors.finalPrice);
      const image = el.querySelector(config.crawlSelectors.image);
      return {
        item_id: id ? id.href.match(/[^/]+$/)[0] : null,
        scheduled_date: scheduledDate ? scheduledDate.textContent.trim() : null,
        japanese_title: title ? title.textContent.trim() : null,
        brand: brand ? brand.textContent.trim() : null,
        rank: rank ? rank.textContent.trim() : null,
        final_price: finalPrice ? finalPrice.textContent.trim() : null,
        image: image ? image.src.replace(/\?.*$/, "") + "?w=520&h=390" : null,
        category: config.categoryTable[config.currentCategoryId],
      };
    }, this.config);

    item.scheduled_date = this.extractDate(item.scheduled_date);
    if (existingIds.has(item.item_id)) return { item_id: item.item_id };
    item.final_price = this.currencyToInt(item.final_price);
    item.auc_num = "1";

    return item;
  }

  async crawlItemDetails(idx, itemId) {
    await this.loginCheckDetails();

    return this.retryOperation(async () => {
      const page = this.detailPages[idx];
      await page.goto(this.config.detailUrl(itemId), {
        waitUntil: "domcontentloaded",
        timeout: this.pageTimeout,
      });

      const item = await page.evaluate((config) => {
        const images = [];
        const imageElements = document.querySelectorAll(
          config.crawlDetailSelectors.images
        );

        imageElements.forEach((e, i) => {
          if (i % 3 === 0) {
            const style = e.getAttribute("style").replace(/[\'\"]/g, "");
            const urlMatch = style.match(/url\((.*?)\)/);
            if (urlMatch) {
              const imageUrl = urlMatch[1]
                .replace(/&quot;/g, "")
                .split("?")[0]
                .trim();
              images.push(imageUrl + "?w=520&h=390");
            }
          }
        });

        const binder = document.querySelector(
          config.crawlDetailSelectors.binder
        );
        const scheduledDate = binder?.children[5]?.textContent.trim();
        const description = document
          .querySelector(config.crawlDetailSelectors.description)
          ?.children[3].textContent.trim();
        const accessoryCode = binder?.children[13]?.textContent.trim();

        return {
          additional_images: JSON.stringify(images),
          scheduled_date: scheduledDate || "",
          description: description || "-",
          accessory_code: accessoryCode || "",
        };
      }, this.config);
      item.scheduled_date = this.extractDate(item.scheduled_date);
      if (!item.description) item.description = "-";

      return item;
    });
  }
}

const ecoAucCrawler = new EcoAucCrawler(ecoAucConfig);
//const ecoAucValueCrawler = new EcoAucValueCrawler(ecoAucValueConfig);

module.exports = { ecoAucCrawler };
