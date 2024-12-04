// crawlers/ecoAuc.js
const { Crawler } = require("./index");
const { processImagesInChunks } = require("../utils/processImage");

const ecoAucConfig = {
  name: "EcoAuc",
  baseUrl: "https://www.ecoauc.com",
  accountUrl: "https://www.ecoauc.com/client/users",
  loginPageUrl: "https://www.ecoauc.com/client/users/sign-in",
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
  },
  crawlSelectors: {
    paginationLast: ".last a",
    itemContainer: ".col-sm-6.col-md-4.col-lg-3.mb-grid-card",
    id: ".fa.fa-times.view-current",
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

class EcoAucCrawler extends Crawler {
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
      let pageItems;

      for (let page = 1; page <= totalPages; page++) {
        pageItems = await this.crawlPage(categoryId, page, existingIds);
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

  async filterHandles(handles, existingIds) {
    const limit = pLimit(20);
    const filterPromises = handles.map((handle) =>
      limit(async () => await this.filterHandle(handle, existingIds))
    );
    const items = await Promise.all(filterPromises);
    let filteredHandles = [],
      filteredItems = [],
      remainItems = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i]) {
        if (items[i].scheduled_date) {
          filteredHandles.push(handles[i]);
          filteredItems.push(items[i]);
        } else {
          handles[i].dispose();
          remainItems.push(items[i]);
        }
      } else {
        handles[i].dispose();
      }
    }
    return [filteredHandles, filteredItems, remainItems];
  }

  async filterHandle(itemHandle, existingIds) {
    const item = await itemHandle.evaluate((el, config) => {
      const id = el.querySelector(config.crawlSelectors.id);
      const scheduledDate = el.querySelector(
        config.crawlSelectors.scheduledDate
      );
      return {
        item_id: id ? id.getAttribute("data-auction-item-id") : null,
        scheduled_date: scheduledDate ? scheduledDate.textContent.trim() : null,
      };
    }, this.config);
    item.scheduled_date = this.extractDate(item.scheduled_date);
    if (!this.isCollectionDay(item.scheduled_date)) return null;
    if (existingIds.has(item.item_id)) return { item_id: item.item_id };
    else return item;
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
      const [filteredHandles, filteredItems, remainItems] =
        await this.filterHandles(itemHandles, existingIds);
      const limit = pLimit(5);

      const pageItemsPromises = [];
      for (let i = 0; i < filteredItems.length; i++) {
        pageItemsPromises.push(
          limit(async () => {
            const item = await this.extractItemInfo(
              filteredHandles[i],
              filteredItems[i]
            );
            filteredHandles[i].dispose();
            return item;
          })
        );
      }

      const pageItems = await Promise.all(pageItemsPromises);

      const processedItems = await processImagesInChunks(pageItems);

      console.log(`Crawled ${processedItems.length} items from page ${page}`);

      return [...processedItems, ...remainItems];
    });
  }

  async extractItemInfo(itemHandle, item0) {
    const item = await itemHandle.evaluate((el, config) => {
      const title = el.querySelector(config.crawlSelectors.title);
      const brand = el.querySelector(config.crawlSelectors.brand);
      const rankParent = el.querySelector(config.crawlSelectors.rank);
      const rank = rankParent ? rankParent.childNodes[4] : null;
      const startingPrice = el.querySelector(
        config.crawlSelectors.startingPrice
      );
      const image = el.querySelector(config.crawlSelectors.image);
      return {
        japanese_title: title ? title.textContent.trim() : null,
        brand: brand ? brand.textContent.trim() : null,
        rank: rank ? rank.textContent.trim() : null,
        starting_price: startingPrice ? startingPrice.textContent.trim() : null,
        image: image ? image.src.replace(/\?.*$/, "") + "?w=520&h=390" : null,
        category: config.categoryTable[config.currentCategoryId],
      };
    }, this.config);

    item.korean_title = item.japanese_title;
    item.starting_price = this.currencyToInt(item.starting_price);
    item.auc_num = "1";

    return Object.assign(item0, item);
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
        const description = document
          .querySelector(config.crawlDetailSelectors.description)
          ?.children[3].textContent.trim();
        const accessoryCode = binder?.children[13]?.textContent.trim();

        return {
          image: images[0],
          additional_images: JSON.stringify(images),
          description: description || "-",
          accessory_code: accessoryCode || "",
        };
      }, this.config);

      if (!item.description) item.description = "-";

      return item;
    });
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
          image: images[0],
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
const ecoAucValueCrawler = new EcoAucValueCrawler(ecoAucValueConfig);

module.exports = { ecoAucCrawler, ecoAucValueCrawler };
