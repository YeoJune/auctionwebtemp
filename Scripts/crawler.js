// Scripts/crawler.js
const dotenv = require('dotenv');
const puppeteer = require('puppeteer');
const { TranslateClient, TranslateTextCommand } = require("@aws-sdk/client-translate");
const translate = new TranslateClient({ region: "ap-northeast-2" });
const { processImagesInChunks } = require('../utils/processImage');

const wordDictionary = require('../utils/wordDictionary');

let pLimit;
(async () => {
  pLimit = (await import('p-limit')).default;
})();

dotenv.config();

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
let TRANS_COUNT = 0;

const ecoAucConfig = {
  name: 'EcoAuc',
  baseUrl: 'https://www.ecoauc.com',
  accountUrl: 'https://www.ecoauc.com/client/users',
  loginPageUrl: 'https://www.ecoauc.com/client/users/sign-in',
  searchUrl: 'https://www.ecoauc.com/client/auctions/inspect',
  loginData: {
    'userId': process.env.CRAWLER_EMAIL1,
    'password': process.env.CRAWLER_PASSWORD1,
  },
  categoryIds: ['1', '2', '3', '4', '5', '8', '9', '27'],
  categoryTable: {1: "시계", 2: "가방", 3: "귀금속", 4: "악세서리", 5: "소품", 8: "의류", 9: "신발", 27: "기타"},
  signinSelectors: {
    userId: 'input[name="email_address"]',
    password: 'input[name="password"]',
    loginButton: 'button.btn-signin[type="submit"]',
  },
  crawlSelectors: {
    paginationLast: '.last a',
    itemContainer: '.col-sm-6.col-md-4.col-lg-3.mb-grid-card',
    id: '.fa.fa-times.view-current',
    title: '.card b',
    brand: 'small.show-case-bland',
    rank: '.canopy.canopy-3.text-default > li:nth-child(1)',
    startingPrice: '.canopy.canopy-3.text-default > li:nth-child(2) big',
    image: '.pc-image-area img',
    scheduledDate: 'span.market-title',
  },
  crawlDetailSelectors: {
    images: '.item-thumbnail',
    description: '.item-info.view-form',
    binder: '.col-md-8.col-lg-7 .dl-horizontal',
  },
  searchParams: (categoryId, page) => `?limit=200&sortKey=1&tableType=grid&master_item_categories[0]=${categoryId}&page=${page}`,
  detailUrl: (itemId) => `https://www.ecoauc.com/client/auction-items/view/${itemId}`,
};
const brandAuctionConfig = {
  name: 'Brand Auction',
  baseUrl: 'https://member.brand-auc.com',
  accountUrl: 'https://u.brand-auc.com/configuration',
  loginPageUrl: 'https://member.brand-auc.com/login',
  searchUrl: 'https://u.brand-auc.com/previewSearch',
  loginData: {
    userId: process.env.CRAWLER_EMAIL2,
    password: process.env.CRAWLER_PASSWORD2,
  },
  signinSelectors: {
    userId: 'input[name="username"]',
    password: 'input[name="password"]',
    loginButton: '#pcLoginButton',
  },
  crawlSelectors: {
    searchButton: '.main_action_button button',
    itemsPerPageSelect: '.view_count_select select',
    itemsPerPageSelecter: '.view_count_select  option:nth-child(3)',
    totalPagesSpan: '.now_page span',
    pageSelect: '.now_page .select_box select',
    resetButton: '#search_times button',
    search1: 'input[name=uketsukeNoFrom]',
    search2: 'input[name=uketsukeNoTo]',
    itemContainer: '#item_list_area > li',
    id: '.receipt_number_header',
    title: '.item_date .item_name_header',
    brand: '.item_date .maker_header',
    rank: '.appraisal',
    startingPrice: '.price',
    image: '.thumbnail img',
    scheduledDate: '.held_date div:last-child span',
    category: '.genre_type_date .genre_header',
    status: '.state_content',
  },
  crawlDetailSelectors: {
    images: '.other_images img',
    description: '.tokki',
    codeParent: '#detail_date'
  },
  searchParams: (categoryId, page = 1) => `?kaijoKbn=0&genre_select=${categoryId}&page=${page}`,
};

class Crawler {
  constructor(siteConfig) {
    this.config = siteConfig;
    this.maxRetries = 1;
    this.retryDelay = 1000;
    this.pageTimeout = 60000;
    this.isRefreshing = false;
    this.detailMulti = 2;

    this.crawlerBrowser = null;
    this.crawlerPage = null;
    this.isCrawlerLogin = false;

    this.detailBrowsers = [];
    this.detailPages = [];
    this.isDetailLogins = false;
  }

  async retryOperation(operation, maxRetries = this.maxRetries, delay = this.retryDelay) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === maxRetries) {
          console.error(`Operation failed after ${maxRetries} attempts:`, error);
          return null;
        }
        console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
        await this.sleep(delay);
      }
    }
  }

  async rawTranslate(text) {
    return this.retryOperation(async () => {
      TRANS_COUNT += text.length;
      try {
        const params = {
          Text: text,
          SourceLanguageCode: 'ja',
          TargetLanguageCode: 'ko'
        };
        const command = new TranslateTextCommand(params);
        const result = await translate.send(command);
        return result.TranslatedText;
      } catch (error) {
        console.error('Translation error:', error.message);
        return text;
      }
    });
  }

  preTranslate(text) {
    return text.split(' ').map(word => wordDictionary[word] || word).join(' ');
  }
  
  async translate(text) {
    return this.retryOperation(async () => {
      try {
        text = this.preTranslate(text);
        const japaneseRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;
  
        const startIndex = text.search(japaneseRegex);
        if (startIndex === -1) {
          return text;
        }
  
        const endIndex = text.split('').reverse().join('').search(japaneseRegex);
        const lastIndex = text.length - endIndex;
  
        const prefix = text.slice(0, startIndex);
        const japaneseText = text.slice(startIndex, lastIndex);
        const suffix = text.slice(lastIndex);
  
        const translatedJapaneseText = await this.rawTranslate(japaneseText);
  
        return prefix + translatedJapaneseText + suffix;
      } catch (error) {
        console.error('Translation error:', error.message);
        return text;
      }
    });
  }
  formatExecutionTime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    const remainingMinutes = minutes % 60;
    const remainingSeconds = seconds % 60;

    let timeString = '';
    if (hours > 0) {
      timeString += `${hours}시간 `;
    }
    if (remainingMinutes > 0 || hours > 0) {
      timeString += `${remainingMinutes}분 `;
    }
    timeString += `${remainingSeconds}초`;

    return timeString;
  }
  currencyToInt(currencyString) {
    const cleanString = currencyString.replace(/\D/g, '');
    
    const number = parseInt(cleanString);
  
    if (isNaN(number)) {
      throw new Error('Invalid currency string');
    }
  
    return number;
  }
  extractDate(text) {
    const regex1 = /(\d{4}).?(\d{2}).?(\d{2})/;
    const match1 = text?.match(regex1);
    const regex2 = /(\d{4}).?(\d{2}).?(\d{2}).*?(\d{2})\s*?：\s*(\d{2})/;
    const match2 = text?.match(regex2);
    if (match2) return `${match2[1]}-${match2[2]}-${match2[3]}` + ((match2[4] && match2[5]) ? ` ${match2[4]}:${match2[5]}` : '00:00');
    else if (match1) return `${match1[1]}-${match1[2]}-${match1[3]} 00:00`;
    else return null;
  }
  convertFullWidthToAscii(str) {
    return str.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(s) {
      return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
    }).replace(/　/g, ' ');
  }
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  async initPage(page) {
    await page.setViewport({
      width: 1920,
      height: 1080
    });
  }

  async initializeCrawler() {
    this.crawlerBrowser = await puppeteer.launch({
      headless: 'shell',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080', 
        `--user-agent=${USER_AGENT}`, '--use-gl=angle', '--enable-unsafe-webgpu',],
    });
    this.crawlerPage = (await this.crawlerBrowser.pages())[0];

    await this.initPage(this.crawlerPage);
    
    console.log('complete to initialize crawler!');
  }
  async initializeDetails() {
    const detailInitPromises = Array(this.detailMulti).fill().map(() => this.initializeDetail());
    const detailResults = await Promise.all(detailInitPromises);

    this.detailBrowsers = detailResults.map(result => result.browser);
    this.detailPages = detailResults.map(result => result.page);

    console.log('complete to initialize details!');
  }
  async initializeDetail() {
    const browser = await puppeteer.launch({
      headless: 'shell',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080', 
        `--user-agent=${USER_AGENT}`, '--use-gl=angle', '--enable-unsafe-webgpu',],
    });
    const page = (await browser.pages())[0];
    await this.initPage(page);
    return { browser, page };
  }
  async closeCrawlerBrowser() {
    if (this.crawlerBrowser) {
      await this.crawlerBrowser.close();
      this.crawlerBrowser = null;
      this.crawlerPage = null;
    }

    this.isCrawlerLogin = false;
  
    console.log('Crawler have been closed.');
  }
  async closeDetailBrowsers() {
    for (const browser of this.detailBrowsers) {
      if (browser) {
        await browser.close();
      }
    }
    this.detailBrowsers = [];
    this.detailPages = [];

    this.isDetailLogins = false;
    
    console.log('Detail have been closed.');
  }

  isCollectionDay(date) {
    if (!date) return true;
    const day = new Date(date).getDay();
    return ![2, 4].includes(day);
  }

  async login(page) {
    return this.retryOperation(async () => {
      await page.goto(this.config.loginPageUrl, { waitUntil: 'networkidle0', timeout: this.pageTimeout });
      await page.type(this.config.signinSelectors.userId, this.config.loginData.userId);
      await page.type(this.config.signinSelectors.password, this.config.loginData.password);
      await Promise.all([
        page.click(this.config.signinSelectors.loginButton),
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: this.pageTimeout }),
      ]);
    });
  }
  async loginCheckCrawler() {
    if (!this.crawlerBrowser || !this.crawlerPage) {
      await this.initializeCrawler();
    }

    await this.login(this.crawlerPage);
  }
  async loginCheckBrowsers() {
    if (!this.detailBrowsers.length || !this.detailPages.length) {
      await this.initializeDetails();
    }
    const loginTasks = [];
  
    if (!this.isDetailLogins) {
      const detailLoginTasks = this.detailPages.map(page => this.login(page));
      loginTasks.push(...detailLoginTasks);
    }
  
    if (loginTasks.length > 0) {
      await Promise.all(loginTasks);
      this.isDetailLogins = true;
      console.log('complete to login all!');
    }
  }

  async getTotalPages(categoryId) {
    return this.retryOperation(async () => {
      const url = this.config.searchUrl + this.config.searchParams(categoryId, 1);
      await this.crawlerPage.goto(url, { waitUntil: 'domcontentloaded', timeout: this.pageTimeout });
  
      const paginationExists = await this.crawlerPage.$(this.config.crawlSelectors.paginationLast);
      
      if (paginationExists) {
        const href = await this.crawlerPage.$eval(this.config.crawlSelectors.paginationLast, el => el.getAttribute('href'));
        const match = href.match(/page=(\d+)/);
        if (match) {
          return parseInt(match[1], 10);
        }
      } else {
        const itemExists = await this.crawlerPage.$(this.config.crawlSelectors.itemContainer);
        return itemExists ? 1 : 0;
      }
      throw new Error('Unable to determine total pages');
    });
  }
  async crawlAllItems(existingIds) {
    await this.closeDetailBrowsers();
    await this.loginCheckCrawler();
    const startTime = Date.now();
    TRANS_COUNT = 0;
    
    const allCrawledItems = [];
    for (const categoryId of this.config.categoryIds) {
      const categoryItems = [];

      console.log(`Starting crawl for category ${categoryId}`);
      this.config.currentCategoryId = categoryId;

      const totalPages = await this.getTotalPages(categoryId);
      console.log(`Total pages in category ${categoryId}: ${totalPages}`);
      let pageItems, processedItems;

      for (let page = 1; page <= totalPages; page++) {
        pageItems = await this.crawlPage(categoryId, page, existingIds);
        processedItems = await processImagesInChunks(pageItems);
        categoryItems.push(...processedItems);
      }

      if (categoryItems && categoryItems.length > 0) {
        allCrawledItems.push(...categoryItems);
        console.log(`Completed crawl for category ${categoryId}. Items found: ${categoryItems.length}`);
      } else {
        console.log(`No items found for category ${categoryId}`);
      }
    }

    if (allCrawledItems.length === 0) {
      console.log('No items were crawled. Aborting save operation.');
      return [];
    }

    this.closeCrawlerBrowser();

    console.log(`Crawling completed for all categories. Total items: ${allCrawledItems.length}`);
    console.log(`translate count: ${TRANS_COUNT}`);

    const endTime = Date.now();
    const executionTime = endTime - startTime;
    console.log(`Refresh operation completed in ${this.formatExecutionTime(executionTime)}`);

    return allCrawledItems;
  }

  async crawlPage(categoryId, page, existingIds) {
    return this.retryOperation(async () => {
      console.log(`Crawling page ${page} in category ${categoryId}...`);
      const url = this.config.searchUrl + this.config.searchParams(categoryId, page);
      
      await this.crawlerPage.goto(url, { waitUntil: 'domcontentloaded', timeout: this.pageTimeout });

      const itemHandles = await this.crawlerPage.$$(this.config.crawlSelectors.itemContainer);
      const limit = pLimit(5);

      const pageItemsPromises = itemHandles.map(handle => 
        limit(async () => {
          const item = await this.extractItemInfo(handle, existingIds);
          handle.dispose();
          return item;
        })
      );

      const pageItems = await Promise.all(pageItemsPromises);

      const filteredPageItems = pageItems.filter(item => item !== null);

      console.log(`Crawled ${filteredPageItems.length} items from page ${page}`);

      return filteredPageItems;
    });
  }

  async extractItemInfo(itemHandle, existingIds) {
    const id = await itemHandle.$eval(this.config.crawlSelectors.id, el => el.getAttribute('data-auction-item-id'));
    if (existingIds.has(id)) {
      return {item_id: id};
    }
    const item = await itemHandle.evaluate((el, config) => {
      const id = el.querySelector(config.crawlSelectors.id);
      const title = el.querySelector(config.crawlSelectors.title);
      const brand = el.querySelector(config.crawlSelectors.brand);
      const rankParent = el.querySelector(config.crawlSelectors.rank);
      const rank = rankParent ? rankParent.childNodes[4] : null;
      const startingPrice = el.querySelector(config.crawlSelectors.startingPrice);
      const image = el.querySelector(config.crawlSelectors.image);
      const scheduledDate = el.querySelector(config.crawlSelectors.scheduledDate);
      return {
        item_id: id ? id.getAttribute('data-auction-item-id') : null,
        japanese_title: title ? title.textContent.trim() : null,
        brand: brand ? brand.textContent.trim() : null,
        rank: rank ? rank.textContent.trim() : null,
        starting_price: startingPrice ? startingPrice.textContent.trim() : null,
        image: image ? image.src.replace(/\?.*$/, '') + '?w=300&h=300' : null,
        scheduled_date: scheduledDate ? scheduledDate.textContent.trim() : null,
        category: config.categoryTable[config.currentCategoryId],
      };
    }, this.config);

    item.scheduled_date = this.extractDate(item.scheduled_date);
    if (!this.isCollectionDay(item.scheduledDate)) return null;
    item.korean_title = await this.translate(item.japanese_title);
    item.brand = await this.translate(item.brand);
    item.starting_price = this.currencyToInt(item.starting_price);
    item.auc_num = '1'


    return item;
  }

  async crawlItemDetails(idx, itemId) {
    await this.loginCheckBrowsers();
  
    return this.retryOperation(async () => {
      const page = this.detailPages[idx];
      await page.goto(this.config.detailUrl(itemId), {
        waitUntil: 'domcontentloaded',
        timeout: this.pageTimeout
      });

      const item = await page.evaluate((config) => {
        const images = [];
        const imageElements = document.querySelectorAll(config.crawlDetailSelectors.images);
  
        imageElements.forEach((e, i) => {
          if (i % 3 === 0) {
            const style = e.getAttribute('style').replace(/[\'\"]/g, '');
            const urlMatch = style.match(/url\((.*?)\)/);
            if (urlMatch) {
              const imageUrl = urlMatch[1].replace(/&quot;/g, '').split('?')[0].trim();
              images.push(imageUrl + '?w=300&h=300');
            }
          }
        });
  
        const binder = document.querySelector(config.crawlDetailSelectors.binder);
        const scheduledDate = binder?.children[5]?.textContent.trim();
        const description = document.querySelector(config.crawlDetailSelectors.description)?.children[3].textContent.trim();
        const accessoryCode = binder?.children[13]?.textContent.trim();
  
        return {
          image: images[0],
          additional_images: JSON.stringify(images),
          scheduled_date: scheduledDate || '',
          description: description || '-',
          accessory_code: accessoryCode || '',
        };
      }, this.config);

      item.scheduled_date = this.extractDate(item.scheduled_date);
      item.description = await this.translate(item.description);
      item.accessory_code = await this.translate(item.accessory_code);
      if (!item.description) item.description = '-';

      return item;
    });
  }
}

class BrandAuctionCrawler extends Crawler {
  async waitForLoading(page) {
    const loadingElements = await page.$$('app-loading');
    for (const e of loadingElements) {
      if (e) {
        await page.waitForFunction((e) => {
          return e && e.children.length == 0;
        }, {timeout: 30000}, e);
      }
    }
  }
  async crawlAllItems(existingIds) {
    await this.closeDetailBrowsers();
    await this.loginCheckCrawler();
    const startTime = Date.now();
    TRANS_COUNT = 0;

    return this.retryOperation(async () => {
      await this.crawlerPage.goto(this.config.searchUrl, { waitUntil: 'networkidle0', timeout: this.pageTimeout });
      await this.crawlerPage.click(this.config.crawlSelectors.searchButton);

      await this.waitForLoading(this.crawlerPage);
      await this.crawlerPage.$eval(this.config.crawlSelectors.itemsPerPageSelecter, el => el.value = '500');
      await this.crawlerPage.select(this.config.crawlSelectors.itemsPerPageSelect, '500');
      await this.waitForLoading(this.crawlerPage);

      const totalPageText = await this.crawlerPage.$eval(this.config.crawlSelectors.totalPagesSpan, el => el.textContent);
      const totalPages = parseInt(totalPageText.match(/\d+/g).join(''));

      const allItems = [];
      console.log(`Crawling for total page ${totalPages}`);
      let itemHandles, limit, pageItemsPromises, pageItems;
      
      for (let page = 1; page <= totalPages; page++) {
        console.log(`Crawling page ${page} of ${totalPages}`);

        await this.crawlerPage.select(this.config.crawlSelectors.pageSelect, page.toString());
        await this.waitForLoading(this.crawlerPage);
        await this.sleep(3000);
        
        itemHandles = await this.crawlerPage.$$(this.config.crawlSelectors.itemContainer);
        limit = pLimit(5); // 동시에 처리할 아이템 수 제한

        pageItemsPromises = itemHandles.map(handle => 
          limit(async () => {
            const item = await this.extractItemInfo(handle, existingIds);
            handle.dispose();
            return item;
          })
        );

        pageItems = await Promise.all(pageItemsPromises);
        pageItems = pageItems.filter((e) => e.item_id);

        pageItems = await processImagesInChunks(pageItems);
        
        allItems.push(...pageItems);
      }

      this.closeCrawlerBrowser();

      console.log(`Total items crawled: ${allItems.length}`);
      console.log(`translate count: ${TRANS_COUNT}`);
      
      const endTime = Date.now();
      const executionTime = endTime - startTime;
      console.log(`Refresh operation completed in ${this.formatExecutionTime(executionTime)}`);

      return allItems;
    });
  }

  async extractItemInfo(itemHandle, existingIds) {
    const status = await itemHandle.$eval(this.config.crawlSelectors.status, el => el.textContent.trim());
    if (status == '保留成約' || status == '成約') {
      return {status: status};
    }
    const id = await itemHandle.$eval(this.config.crawlSelectors.id, el => el.textContent.trim());
    if (existingIds.has(id)) {
      return {item_id: id};
    }
    const item = await itemHandle.evaluate((el, config) => {
      const id = el.querySelector(config.crawlSelectors.id);
      const title = el.querySelector(config.crawlSelectors.title);
      const brand = el.querySelector(config.crawlSelectors.brand);
      const rank = el.querySelector(config.crawlSelectors.rank);
      const startingPrice = el.querySelector(config.crawlSelectors.startingPrice);
      const image = el.querySelector(config.crawlSelectors.image);
      const scheduledDate = el.querySelector(config.crawlSelectors.scheduledDate);
      const category = el.querySelector(config.crawlSelectors.category);

      return {
        item_id: id ? id.textContent.trim() : null,
        japanese_title: title ? title.textContent.trim() : null,
        brand: brand ? brand.textContent.trim() : null,
        rank: rank ? rank.textContent.trim() : null,
        starting_price: startingPrice ? startingPrice.textContent.trim() : null,
        image: image ? image.src.replace(/(brand_img\/)(\d+)/, '$16') : null,
        scheduled_date: scheduledDate ? scheduledDate.textContent.trim() : null,
        category: category.textContent.trim(),
      };
    }, this.config);
    
    item.korean_title = await this.translate(this.convertFullWidthToAscii(item.japanese_title));
    item.brand = await this.translate(this.convertFullWidthToAscii(item.brand));
    item.starting_price = this.currencyToInt(item.starting_price);
    item.scheduled_date = this.extractDate(item.scheduled_date);
    item.category = await this.translate(item.category);
    item.auc_num = '2';

    return item;
  }
  async crawlItemDetails(idx, itemId) {
    await this.loginCheckBrowsers();
  
    const startTime = Date.now();
    return this.retryOperation(async () => {
      const browser = this.detailBrowsers[idx];
      const page = this.detailPages[idx];
      await page.goto(this.config.searchUrl, { waitUntil: 'networkidle0', timeout: this.pageTimeout });
      console.log('search Url loaded');
      
      await page.click(this.config.crawlSelectors.resetButton);
  
      await page.type(this.config.crawlSelectors.search1, itemId);
      await page.type(this.config.crawlSelectors.search2, itemId);
      await page.click(this.config.crawlSelectors.searchButton);
      await this.waitForLoading(page);

      const newPagePromise = new Promise(resolve => browser.once('targetcreated', target => resolve(target.page())));
      await page.click(this.config.crawlSelectors.itemContainer);
      const newPage = await newPagePromise;
      await this.initPage(newPage);
      await this.sleep(500);
      await this.waitForLoading(newPage);

      let item;
      try {
        item = await newPage.evaluate((config) => {
          const images = Array.from(document.querySelectorAll(config.crawlDetailSelectors.images))
            .map(img => {
              const src = img.getAttribute('src');
              if (src && src.startsWith('http')) {
                return src.replace(/(brand_img\/)(\d+)/, '$16');
              }
              return null;
            })
            .filter(Boolean);
    
          const description = document.querySelector(config.crawlDetailSelectors.description)?.textContent.trim().replace(/\s{2,}/g, '\t') || null;
          const codeParent = document.querySelector(config.crawlDetailSelectors.codeParent);
          const accessoryCode = codeParent?.children[6]?.children[2]?.children[1]?.textContent.trim() || null;
    
          return {
            image: images[0],
            additional_images: images.length > 0 ? JSON.stringify(images) : null,
            description: description || '',
            accessory_code: accessoryCode || '',
          };
        }, this.config);
      } catch (error) {
        throw(error);
      } finally {
        await newPage.close();
        await page.click(this.config.crawlSelectors.resetButton);
      }
      item.description = await this.translate(item.description);
      item.accessory_code = await this.translate(item.accessory_code);
      if (!item.description) item.description = '-';

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      console.log(executionTime);
      return item;
    });
  }
}

const ecoAucCrawler = new Crawler(ecoAucConfig);
const brandAuctionCrawler = new BrandAuctionCrawler(brandAuctionConfig);

module.exports = { ecoAucCrawler, brandAuctionCrawler };