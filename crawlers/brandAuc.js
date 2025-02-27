// crawlers/brandAuc.js
const { Crawler } = require("./baseCrawler");
const { processImagesInChunks } = require("../utils/processImage");

let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

const brandAucConfig = {
  name: "BrandAuc",
  baseUrl: "https://member.brand-auc.com",
  accountUrl: "https://u.brand-auc.com/configuration",
  loginPageUrl: "https://member.brand-auc.com/login",
  searchUrl: "https://u.brand-auc.com/previewSearch",
  loginData: {
    userId: process.env.CRAWLER_EMAIL2,
    password: process.env.CRAWLER_PASSWORD2,
  },
  categoryTable: {
    Watch: "시계",
    Bag: "가방",
    "Precious metal": "귀금속",
    Clothing: "의류",
    Accessories: "악세서리",
    Tableware: "식기",
    Variety: "기타",
    "Painting･Art": "회화·미술품",
    Coin: "코인",
  },
  signinSelectors: {
    userId: 'input[name="username"]',
    password: 'input[name="password"]',
    loginButton: "#pcLoginButton",
  },
  crawlSelectors: {
    languageSelect: ".languageselect select",
    searchButton: ".main_action_button button",
    itemsPerPageSelect: ".view_count_select select",
    itemsPerPageSelecter: ".view_count_select option:nth-child(3)",
    totalPagesSpan: ".now_page span",
    pageSelect: ".now_page .select_box select",
    resetButton: "#search_times button",
    search1: "input[name=uketsukeNoFrom]",
    search2: "input[name=uketsukeNoTo]",
    itemContainer: "#item_list_area > li",
    id: ".receipt_number_header",
    title: ".item_date .item_name_header",
    brand: ".item_date .maker_header",
    rank: ".appraisal",
    startingPrice: ".price",
    image: ".thumbnail img",
    scheduledDate: ".held_date div:last-child span",
    category: ".genre_type_date .genre_header",
    status: ".state_content",
  },
  crawlDetailSelectors: {
    images: ".other_images img",
    description: ".tokki",
    codeParent: "#detail_date",
  },
};

const brandAucValueConfig = {
  name: "BrandAucValue",
  baseUrl: "https://member.brand-auc.com",
  accountUrl: "https://u.brand-auc.com/configuration",
  loginPageUrl: "https://member.brand-auc.com/login",
  searchUrl: "https://e-auc.brand-auc.com/marketPriceItems",
  loginData: {
    userId: process.env.CRAWLER_EMAIL2,
    password: process.env.CRAWLER_PASSWORD2,
  },
  categoryTable: {
    Watch: "시계",
    Bag: "가방",
    "Precious metal": "귀금속",
    Clothing: "의류",
    Accessories: "악세서리",
    Tableware: "식기",
    Variety: "기타",
    "Painting･Art": "회화·미술품",
    Coin: "코인",
  },
  signinSelectors: {
    userId: 'input[name="username"]',
    password: 'input[name="password"]',
    loginButton: "#pcLoginButton",
  },
  crawlSelectors: {
    languageSelect: ".languageselect select",
    searchButton: ".main_action_button button",
    itemsPerPageSelect: ".view_count_select select",
    itemsPerPageSelecter: ".view_count_select option:nth-child(3)",
    totalPagesSpan: ".now_page span",
    pageSelect: ".now_page .select_box select",
    resetButton: "#search_times button",
    search1: "input[name=uketsukeNoFrom]",
    search2: "input[name=uketsukeNoTo]",
    itemContainer: "#item_list_area > li",
    id: ".receipt_number_header",
    title: ".item_date .item_name_header",
    brand: ".item_date .maker_header",
    rank: ".appraisal",
    finalPrice: ".price",
    image: ".thumbnail img",
    scheduledDate: ".held_date div:last-child span",
    category: ".genre_type_date .genre_header",
    status: ".state_content",
  },
  crawlDetailSelectors: {
    images: ".other_images img",
    description: ".tokki",
    codeParent: "#detail_date",
  },
};

class BrandAucCrawler extends Crawler {
  async waitForLoading(page, timeout = 30 * 1000) {
    const loadingElements = await page.$$("app-loading");
    for (const e of loadingElements) {
      if (e) {
        await page.waitForFunction(
          (e) => {
            return e && e.children.length == 0;
          },
          { timeout: timeout },
          e
        );
      }
      e.dispose();
    }
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
        if (items[i].status) {
          delete items[i].status;
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
      const status = el.querySelector(config.crawlSelectors.status);
      return {
        item_id: id ? id.textContent.trim() : null,
        status: status ? status.textContent.trim() : null,
      };
    }, this.config);
    if (item.status == "SOLD BY HOLD" || item.status == "SOLD") return null;
    if (existingIds.has(item.item_id)) return { item_id: item.item_id };
    else return item;
  }

  async crawlAllItems(existingIds) {
    await this.closeDetailBrowsers();
    await this.loginCheckCrawler();
    const startTime = Date.now();

    return this.retryOperation(async () => {
      await this.crawlerPage.goto(this.config.searchUrl, {
        waitUntil: "networkidle0",
        timeout: this.pageTimeout,
      });
      await this.crawlerPage.select(
        this.config.crawlSelectors.languageSelect,
        "en"
      );
      await this.crawlerPage.click(this.config.crawlSelectors.searchButton);
      await this.waitForLoading(this.crawlerPage);

      await this.crawlerPage.$eval(
        this.config.crawlSelectors.itemsPerPageSelecter,
        (el) => (el.value = "500")
      );
      await this.crawlerPage.select(
        this.config.crawlSelectors.itemsPerPageSelect,
        "500"
      );
      await this.waitForLoading(this.crawlerPage);
      await this.crawlerPage.waitForSelector(
        this.config.crawlSelectors.itemContainer
      );

      const totalPageText = await this.crawlerPage.$eval(
        this.config.crawlSelectors.totalPagesSpan,
        (el) => el.textContent
      );
      const totalPages = parseInt(totalPageText.match(/\d+/g).join(""));

      const allItems = [];
      console.log(`Crawling for total page ${totalPages}`);
      let itemHandles,
        filteredHandles,
        filteredItems,
        remainItems,
        pageItemsPromises,
        pageItems,
        processedItems;
      const limit = pLimit(5);

      for (let page = 1; page <= totalPages; page++) {
        console.log(`Crawling page ${page} of ${totalPages}`);

        await this.crawlerPage.select(
          this.config.crawlSelectors.pageSelect,
          page.toString()
        );
        await this.waitForLoading(this.crawlerPage);
        await this.crawlerPage.waitForSelector(
          this.config.crawlSelectors.itemContainer
        );
        this.sleep(3000);

        itemHandles = await this.crawlerPage.$$(
          this.config.crawlSelectors.itemContainer
        );

        [filteredHandles, filteredItems, remainItems] =
          await this.filterHandles(itemHandles, existingIds);
        pageItemsPromises = [];
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

        pageItems = await Promise.all(pageItemsPromises);

        processedItems = await processImagesInChunks(pageItems);

        console.log(`Crawled ${processedItems.length} items from page ${page}`);

        allItems.push(...processedItems, ...remainItems);
      }

      this.closeCrawlerBrowser();

      console.log(`Total items crawled: ${allItems.length}`);

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      console.log(
        `Refresh operation completed in ${this.formatExecutionTime(
          executionTime
        )}`
      );

      return allItems;
    });
  }

  async extractItemInfo(itemHandle, item0) {
    const item = await itemHandle.evaluate((el, config) => {
      const title = el.querySelector(config.crawlSelectors.title);
      const brand = el.querySelector(config.crawlSelectors.brand);
      const rank = el.querySelector(config.crawlSelectors.rank);
      const startingPrice = el.querySelector(
        config.crawlSelectors.startingPrice
      );
      const image = el.querySelector(config.crawlSelectors.image);
      const category = el.querySelector(config.crawlSelectors.category);
      const scheduledDate = el.querySelector(
        config.crawlSelectors.scheduledDate
      );

      return {
        japanese_title: title ? title.textContent.trim() : null,
        brand: brand ? brand.textContent.trim() : null,
        rank: rank ? rank.textContent.trim() : null,
        starting_price: startingPrice ? startingPrice.textContent.trim() : null,
        image: image ? image.src.replace(/(brand_img\/)(\d+)/, "$16") : null,
        category: category.textContent.trim(),
        scheduled_date: scheduledDate ? scheduledDate.textContent.trim() : null,
      };
    }, this.config);
    item.japanese_title = this.convertFullWidthToAscii(item.japanese_title);
    item.brand = this.convertFullWidthToAscii(item.brand);
    item.category = this.config.categoryTable[item.category];
    item.korean_title = item.japanese_title;
    item.scheduled_date = this.extractDate(item.scheduled_date);
    item.starting_price = this.currencyToInt(item.starting_price);
    item.auc_num = "2";

    return Object.assign(item0, item);
  }
  async crawlItemDetails(idx, itemId) {
    await this.loginCheckDetails();

    const startTime = Date.now();
    return this.retryOperation(async () => {
      const browser = this.detailBrowsers[idx];
      const page = this.detailPages[idx];
      await page.goto(this.config.searchUrl, {
        waitUntil: "networkidle0",
        timeout: this.pageTimeout,
      });
      //console.log("search Url loaded");
      await page.waitForSelector(this.config.crawlSelectors.languageSelect, {
        timeout: 3000,
      });
      await page.select(this.config.crawlSelectors.languageSelect, "en");
      await page.click(this.config.crawlSelectors.resetButton);
      await Promise.all([
        await page.type(this.config.crawlSelectors.search1, itemId),
        await page.type(this.config.crawlSelectors.search2, itemId),
      ]);
      await page.click(this.config.crawlSelectors.searchButton);
      const newPagePromise = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("Timeout waiting for new page"));
        }, 5000);

        browser.once("targetcreated", (target) => {
          clearTimeout(timeoutId);
          resolve(target.page());
        });
      });
      await this.waitForLoading(page);

      await page.click(this.config.crawlSelectors.itemContainer);
      const newPage = await newPagePromise;
      await this.initPage(newPage);
      await this.sleep(1000);
      await this.waitForLoading(newPage, 5000);

      let item;
      try {
        item = await newPage.evaluate((config) => {
          const images = Array.from(
            document.querySelectorAll(config.crawlDetailSelectors.images)
          )
            .map((img) => {
              const src = img.getAttribute("src");
              if (src && src.startsWith("http")) {
                return src.replace(/(brand_img\/)(\d+)/, "$16");
              }
              return null;
            })
            .filter(Boolean);

          const description =
            document
              .querySelector(config.crawlDetailSelectors.description)
              ?.textContent.trim()
              .replace(/\s{2,}/g, "\t") || null;
          const codeParent = document.querySelector(
            config.crawlDetailSelectors.codeParent
          );
          const accessoryCode =
            codeParent?.children[6]?.children[2]?.children[1]?.textContent.trim() ||
            null;

          return {
            additional_images:
              images.length > 0 ? JSON.stringify(images) : null,
            description: description || "",
            accessory_code: accessoryCode || "",
          };
        }, this.config);
      } catch (error) {
        throw error;
      } finally {
        await newPage.close();
        await page.click(this.config.crawlSelectors.resetButton);
      }
      if (!item.description) item.description = "-";

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      //console.log(this.formatExecutionTime(executionTime));
      return item;
    });
  }
}

class BrandAucValueCrawler extends Crawler {
  async waitForLoading(page, timeout = 30 * 1000) {
    const loadingElements = await page.$$("app-loading");
    for (const e of loadingElements) {
      if (e) {
        await page.waitForFunction(
          (e) => {
            return e && e.children.length == 0;
          },
          { timeout: timeout },
          e
        );
      }
      e.dispose();
    }
  }

  async crawlAllItems(existingIds) {
    await this.closeDetailBrowsers();
    await this.loginCheckCrawler();
    const startTime = Date.now();

    return this.retryOperation(async () => {
      await this.crawlerPage.goto(this.config.searchUrl, {
        waitUntil: "networkidle0",
        timeout: this.pageTimeout,
      });
      await this.crawlerPage.select(
        this.config.crawlSelectors.languageSelect,
        "en"
      );
      await this.crawlerPage.click(this.config.crawlSelectors.searchButton);
      await this.waitForLoading(this.crawlerPage);

      await this.crawlerPage.$eval(
        this.config.crawlSelectors.itemsPerPageSelecter,
        (el) => (el.value = "500")
      );
      await this.crawlerPage.select(
        this.config.crawlSelectors.itemsPerPageSelect,
        "500"
      );
      await this.waitForLoading(this.crawlerPage);
      await this.crawlerPage.waitForSelector(
        this.config.crawlSelectors.itemContainer
      );

      const totalPageText = await this.crawlerPage.$eval(
        this.config.crawlSelectors.totalPagesSpan,
        (el) => el.textContent
      );
      const totalPages = parseInt(totalPageText.match(/\d+/g).join(""));

      const allItems = [];
      console.log(`Crawling for total page ${totalPages}`);
      let itemHandles, pageItemsPromises, pageItems, processedItems;
      const limit = pLimit(5);
      let isEnd = false;

      for (let page = 1; page <= totalPages; page++) {
        console.log(`Crawling page ${page} of ${totalPages}`);

        await this.crawlerPage.select(
          this.config.crawlSelectors.pageSelect,
          page.toString()
        );
        await this.waitForLoading(this.crawlerPage);
        await this.crawlerPage.waitForSelector(
          this.config.crawlSelectors.itemContainer
        );
        this.sleep(3000);

        itemHandles = await this.crawlerPage.$$(
          this.config.crawlSelectors.itemContainer
        );
        pageItemsPromises = [];
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

        pageItems = await Promise.all(pageItemsPromises);

        for (let item of pageItems)
          if (item.item_id && !item.japanese_title) isEnd = true;
        processedItems = await processImagesInChunks(pageItems);
        if (isEnd) break;

        console.log(`Crawled ${processedItems.length} items from page ${page}`);

        allItems.push(...processedItems);
      }

      this.closeCrawlerBrowser();

      console.log(`Total items crawled: ${allItems.length}`);

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      console.log(
        `Refresh operation completed in ${this.formatExecutionTime(
          executionTime
        )}`
      );

      return allItems;
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
      const finalPrice = el.querySelectorAll(config.crawlSelectors.finalPrice);
      const image = el.querySelector(config.crawlSelectors.image);
      const category = el.querySelector(config.crawlSelectors.category);

      return {
        item_id: id ? id.textContent.trim() : null,
        scheduled_date: scheduledDate ? scheduledDate.textContent.trim() : null,
        japanese_title: title ? title.textContent.trim() : null,
        brand: brand ? brand.textContent.trim() : null,
        rank: rank ? rank.textContent.trim() : null,
        final_price: finalPrice ? finalPrice[0].textContent.trim() : null,
        image: image ? image.src.replace(/(brand_img\/)(\d+)/, "$16") : null,
        category: category.textContent.trim(),
      };
    }, this.config);

    if (existingIds.has(item.item_id)) return { item_id: item.item_id };
    item.japanese_title = this.convertFullWidthToAscii(item.japanese_title);
    item.category = this.config.categoryTable[item.category];
    item.brand = this.convertFullWidthToAscii(item.brand);
    item.scheduled_date = this.extractDate(item.scheduled_date);
    item.final_price = this.currencyToInt(item.final_price);
    item.auc_num = "2";

    return item;
  }
  async crawlItemDetails(idx, itemId) {
    await this.loginCheckDetails();

    const startTime = Date.now();
    return this.retryOperation(async () => {
      const browser = this.detailBrowsers[idx];
      const page = this.detailPages[idx];
      await page.goto(this.config.searchUrl, {
        waitUntil: "networkidle0",
        timeout: this.pageTimeout,
      });
      //console.log("search Url loaded");
      await page.waitForSelector(this.config.crawlSelectors.languageSelect, {
        timeout: 3000,
      });
      await page.select(this.config.crawlSelectors.languageSelect, "en");
      await page.click(this.config.crawlSelectors.resetButton);
      await Promise.all([
        await page.type(this.config.crawlSelectors.search1, itemId),
        await page.type(this.config.crawlSelectors.search2, itemId),
      ]);
      await page.click(this.config.crawlSelectors.searchButton);
      const newPagePromise = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("Timeout waiting for new page"));
        }, 5000);

        browser.once("targetcreated", (target) => {
          clearTimeout(timeoutId);
          resolve(target.page());
        });
      });
      await this.waitForLoading(page);

      await page.click(this.config.crawlSelectors.itemContainer);
      const newPage = await newPagePromise;
      await this.initPage(newPage);
      await this.sleep(1000);
      await this.waitForLoading(newPage, 5000);

      let item;
      try {
        item = await newPage.evaluate((config) => {
          const images = Array.from(
            document.querySelectorAll(config.crawlDetailSelectors.images)
          )
            .map((img) => {
              const src = img.getAttribute("src");
              if (src && src.startsWith("http")) {
                return src.replace(/(brand_img\/)(\d+)/, "$16");
              }
              return null;
            })
            .filter(Boolean);

          const description =
            document
              .querySelector(config.crawlDetailSelectors.description)
              ?.textContent.trim()
              .replace(/\s{2,}/g, "\t") || null;
          const codeParent = document.querySelector(
            config.crawlDetailSelectors.codeParent
          );
          const accessoryCode =
            codeParent?.children[6]?.children[2]?.children[1]?.textContent.trim() ||
            null;

          return {
            additional_images:
              images.length > 0 ? JSON.stringify(images) : null,
            description: description || "",
            accessory_code: accessoryCode || "",
          };
        }, this.config);
      } catch (error) {
        throw error;
      } finally {
        await newPage.close();
        await page.click(this.config.crawlSelectors.resetButton);
      }
      if (!item.description) item.description = "-";

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      //console.log(this.formatExecutionTime(executionTime));
      return item;
    });
  }
}

const brandAucCrawler = new BrandAucCrawler(brandAucConfig);
const brandAucValueCrawler = new BrandAucValueCrawler(brandAucValueConfig);

module.exports = { brandAucCrawler, brandAucValueCrawler };
