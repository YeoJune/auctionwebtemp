const Crawler = require("./baseCrawler");
const { processImagesInChunks } = require("../utils/processImage");

let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

const starAucConfig = {
  name: "StarAuc",
  baseUrl: "https://www.starbuyers-global-auction.com",
  loginPageUrl: "https://www.starbuyers-global-auction.com/login",
  searchUrl: "https://www.starbuyers-global-auction.com/item",
  loginData: {
    userId: process.env.CRAWLER_EMAIL3,
    password: process.env.CRAWLER_PASSWORD3,
  },
  categoryIds: [1, 2, 3, 5, 6, 7, 8],
  categoryTable: {
    1: "시계",
    2: "귀금속",
    3: "귀금속",
    5: "가방",
    6: "악세서리",
    7: "의류",
    8: "신발",
  },

  signinSelectors: {
    userId: "#email",
    password: "#password",
    loginButton: 'button[type="submit"]',
  },

  crawlSelectors: {
    paginationLast: ".p-pagination__item:nth-last-child(2) a",
    itemContainer: ".p-item-list__body",
    id: "a[href]",
    title: ".p-text-link",
    image: ".p-item-list__body__cell.-image img",
    rank: ".rank .icon",
    startingPrice: "tbody tr:nth-child(1) td:nth-child(2)",
    endedAt: ".ended-at",
  },

  crawlDetailSelectors: {
    images: ".p-item-image__thumb__item img",
    description: ".p-def-list",
    brand: ".p-def-list__desc",
    lotNo: ".p-def-list__desc",
    notes: "dt.p-def-list__term",
  },

  searchParams: (categoryId, page) =>
    `?sub_categories%5B0%5D=${categoryId}&limit=100&page=${page}`,

  detailUrl: (itemId) =>
    `https://www.starbuyers-global-auction.com/item/${itemId}`,
};

class StarAucCrawler extends Crawler {
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
        const lastPageNumber = await this.crawlerPage.$eval(
          this.config.crawlSelectors.paginationLast,
          (el) => parseInt(el.textContent)
        );
        return lastPageNumber;
      } else {
        const itemExists = await this.crawlerPage.$(
          this.config.crawlSelectors.itemContainer
        );
        return itemExists ? 1 : 0;
      }
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
      const link = el.querySelector(config.crawlSelectors.id);
      const endedAt = el.querySelector(config.crawlSelectors.endedAt);

      const href = link?.getAttribute("href");
      const itemId = href ? href.split("/").pop() : null;

      return {
        item_id: itemId,
        scheduled_date: endedAt ? endedAt.textContent.trim() : null,
      };
    }, this.config);

    item.scheduled_date = this.extractDate(item.scheduled_date);
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

  async extractItemInfo(itemHandle) {
    const item = await itemHandle.evaluate((el, config) => {
      const link = el.querySelector(config.crawlSelectors.id);
      const title = el.querySelector(config.crawlSelectors.title);
      const rank = el.querySelector(config.crawlSelectors.rank);
      const startingPrice = el.querySelector(
        config.crawlSelectors.startingPrice
      );
      const image = el.querySelector(config.crawlSelectors.image);
      const endedAt = el.querySelector(config.crawlSelectors.endedAt);

      // Extract item_id from href URL
      const href = link?.getAttribute("href");
      const itemId = href ? href.split("/").pop() : null;

      // Get title text
      const titleText = title?.textContent.trim() || "";
      // Extract brand from first word of title
      const brand = titleText.split(" ")[0];

      return {
        item_id: itemId,
        japanese_title: titleText,
        brand: brand,
        rank: rank?.getAttribute("data-rank")?.trim() || null,
        starting_price: startingPrice?.textContent.trim() || null,
        image: image?.src || null,
        scheduled_date: endedAt?.textContent.trim() || null,
      };
    }, this.config);

    item.korean_title = item.japanese_title;
    item.starting_price = this.currencyToInt(item.starting_price);
    item.scheduled_date = this.extractDate(item.scheduled_date);
    item.category = this.config.categoryTable[this.config.currentCategoryId];
    item.auc_num = "3";

    return item;
  }

  async crawlItemDetails(idx, itemId) {
    await this.loginCheckDetails();

    return this.retryOperation(async () => {
      const page = this.detailPages[idx];
      await page.goto(this.config.detailUrl(itemId), {
        waitUntil: "networkidle0",
        timeout: this.pageTimeout,
      });

      const item = await page.evaluate((config) => {
        const images = Array.from(
          document.querySelectorAll(config.crawlDetailSelectors.images)
        ).map((img) => img.src);

        let brand = "";
        let lotNo = "";
        let notes = ""; // 기본값 설정
        let accs = "";

        const terms = document.querySelectorAll(
          config.crawlDetailSelectors.description + " dt"
        );
        const descs = document.querySelectorAll(
          config.crawlDetailSelectors.description + " dd"
        );

        for (let i = 0; i < terms.length; i++) {
          const termText = terms[i].textContent.trim();
          if (termText === "Brand") {
            brand = descs[i].textContent.trim();
          }
          if (termText === "Lot Number") {
            lotNo = descs[i].textContent.trim();
          }
          if (termText === "Windshield") {
            notes += descs[i].textContent.trim();
          }
          if (termText === "Other Condition1") {
            notes += descs[i].textContent.trim();
          }
          if (termText === "Other Condition2") {
            notes += descs[i].textContent.trim();
          }
          if (termText === "Accessories") {
            accs = descs[i].textContent.trim();
          }
        }

        return {
          additional_images: JSON.stringify(images),
          brand: brand,
          description: notes || "-",
          accessory_code: accs || "",
        };
      }, this.config);

      if (!item.description) item.description = "-";
      return item;
    });
  }
}

const starAucCrawler = new StarAucCrawler(starAucConfig);

module.exports = { starAucCrawler };
