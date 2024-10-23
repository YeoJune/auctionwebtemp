// Scripts/crawler.js
const dotenv = require('dotenv');
const puppeteer = require('puppeteer');
const translator = require('../utils/advancedTraslator');
const { processImagesInChunks } = require('../utils/processImage');

const myTranslator = new translator('ap-northeast-2');

let pLimit;
(async () => {
  pLimit = (await import('p-limit')).default;
})();

dotenv.config();

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

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
  categoryIds: ['1'],//, '2', '3', '4', '5', '8', '9', '27'],
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
  constructor(config) {
    this.config = config;
    this.maxRetries = 3;
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
          console.log(`Operation failed after ${maxRetries} attempts:`, error);
          return null;
        }
        console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
        await this.sleep(delay);
      }
    }
  }

  formatExecutionTime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    const remainingMinutes = minutes % 60;
    const remainingSeconds = seconds % 60;

    let timeString = '';
    if (hours > 0) {
      timeString += `${hours}h `;
    }
    if (remainingMinutes > 0 || hours > 0) {
      timeString += `${remainingMinutes}m `;
    }
    timeString += `${remainingSeconds}s`;

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
  isCollectionDay(date) {
    if (!date) return true;
    const day = new Date(date).getDay();
    return ![2, 4].includes(day);
  }
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  async initPage(page) {
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const blockResources = ['image', 'stylesheet', 'font', 'media'];
      
      if (blockResources.includes(request.resourceType())) {
        request.abort();
      } else {
        request.continue();
      }
    });
    await page.setViewport({
      width: 1920,
      height: 1080
    });
  }
  async initializeDetails() {
    const detailInitPromises = Array(this.detailMulti).fill().map(() => this.initializeCrawler());
    const detailResults = await Promise.all(detailInitPromises);

    this.detailBrowsers = detailResults.map(result => result.browser);
    this.detailPages = detailResults.map(result => result.page);

    console.log('complete to initialize details!');
  }
  async initializeCrawler() {
    const browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium-browser',
      headless: 'true',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--single-process',
        '--no-zygote',
        '--no-first-run',
        `--window-size=1280,800`,
        '--window-position=0,0',
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-skip-list',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--hide-scrollbars',
        '--disable-notifications',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-component-extensions-with-background-pages',
        '--disable-extensions',
        '--disable-features=TranslateUI,BlinkGenPropertyTrees',
        '--disable-ipc-flooding-protection',
        '--disable-renderer-backgrounding',
        '--enable-features=NetworkService,NetworkServiceInProcess',
        '--force-color-profile=srgb',
        '--metrics-recording-only',
        '--mute-audio',
        `--user-agent=${USER_AGENT}`,],
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

  async login(page) {
    return this.retryOperation(async () => {
      await page.goto(this.config.loginPageUrl, { waitUntil: 'networkidle0', timeout: this.pageTimeout });
      await Promise.all([
        await page.type(this.config.signinSelectors.userId, this.config.loginData.userId),
        await page.type(this.config.signinSelectors.password, this.config.loginData.password),
      ]);
      await page.click(this.config.signinSelectors.loginButton);
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: this.pageTimeout });
    });
  }
  async loginCheckCrawler() {
    if (!this.crawlerBrowser || !this.crawlerPage) {
      const result = await this.initializeCrawler();
      this.crawlerBrowser = result.browser;
      this.crawlerPage = result.page;
      console.log('complete to crawler init!');
    }
    await this.login(this.crawlerPage);
    console.log('complete to crawler login!');
  }
  async loginCheckDetails() {
    if (!this.detailBrowsers.length || !this.detailPages.length) {
      await this.initializeDetails();
      console.log('complete to details init!');
    }
    const loginTasks = [];
  
    if (!this.isDetailLogins) {
      const detailLoginTasks = this.detailPages.map(page => this.login(page));
      loginTasks.push(...detailLoginTasks);
    }
  
    if (loginTasks.length > 0) {
      await Promise.all(loginTasks);
      this.isDetailLogins = true;
      console.log('complete to login details!');
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

    myTranslator.TRANS_COUNT = 0;
    const startTime = Date.now();
    
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
    console.log(`translate count: ${myTranslator.TRANS_COUNT}`);

    const endTime = Date.now();
    const executionTime = endTime - startTime;
    console.log(`Refresh operation completed in ${this.formatExecutionTime(executionTime)}`);

    return allCrawledItems;
  }

  async filterHandles(handles, existingIds) {
    const limit = pLimit(20);
    const filterPromises = handles.map(handle => 
      limit(async () => await this.filterHandle(handle, existingIds))
    );
    const items = await Promise.all(filterPromises);
    let filteredHandles = [], filteredItems = [], remainItems = [];
    for(let i = 0; i < items.length; i++) {
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
      const scheduledDate = el.querySelector(config.crawlSelectors.scheduledDate);
      return {
        item_id: id ? id.getAttribute('data-auction-item-id') : null,
        scheduled_date: scheduledDate ? scheduledDate.textContent.trim() : null,
      };
    }, this.config);
    item.scheduled_date = this.extractDate(item.scheduled_date);
    if (!this.isCollectionDay(item.scheduled_date)) return null;
    if (existingIds.has(item.item_id)) return {item_id: item.item_id};
    else return item;
  }

  async crawlPage(categoryId, page, existingIds) {
    return this.retryOperation(async () => {
      console.log(`Crawling page ${page} in category ${categoryId}...`);
      const url = this.config.searchUrl + this.config.searchParams(categoryId, page);
      
      await this.crawlerPage.goto(url, { waitUntil: 'domcontentloaded', timeout: this.pageTimeout });

      const itemHandles = await this.crawlerPage.$$(this.config.crawlSelectors.itemContainer);
      const [filteredHandles, filteredItems, remainItems]= await this.filterHandles(itemHandles, existingIds);
      const limit = pLimit(5);

      const pageItemsPromises = [];
      for(let i = 0; i < filteredItems.length; i++) {
        pageItemsPromises.push(limit(async () => {
          const item = await this.extractItemInfo(filteredHandles[i], filteredItems[i]);
          filteredHandles[i].dispose();
          return item;
        }));
      }

      const pageItems = await Promise.all(pageItemsPromises);

      const filteredPageItems = pageItems.filter(item => item !== null);

      console.log(`Crawled ${filteredPageItems.length} items from page ${page}`);

      return [...filteredPageItems, ...remainItems];
    });
  }

  async extractItemInfo(itemHandle, item0) {
    const item = await itemHandle.evaluate((el, config) => {
      const title = el.querySelector(config.crawlSelectors.title);
      const brand = el.querySelector(config.crawlSelectors.brand);
      const rankParent = el.querySelector(config.crawlSelectors.rank);
      const rank = rankParent ? rankParent.childNodes[4] : null;
      const startingPrice = el.querySelector(config.crawlSelectors.startingPrice);
      const image = el.querySelector(config.crawlSelectors.image);
      return {
        japanese_title: title ? title.textContent.trim() : null,
        brand: brand ? brand.textContent.trim() : null,
        rank: rank ? rank.textContent.trim() : null,
        starting_price: startingPrice ? startingPrice.textContent.trim() : null,
        image: image ? image.src.replace(/\?.*$/, '') + '?w=520&h=390' : null,
        category: config.categoryTable[config.currentCategoryId],
      };
    }, this.config);

    [item.korean_title, item.brand] = await Promise.all([
      await myTranslator.wordTranslate(item.japanese_title),
      await myTranslator.wordTranslate(item.brand)
    ]);
    item.starting_price = this.currencyToInt(item.starting_price);
    item.auc_num = '1'

    return Object.assign(item0, item);
  }

  async crawlItemDetails(idx, itemId) {
    await this.loginCheckDetails();
  
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
              images.push(imageUrl + '?w=520&h=390');
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
      item.description = await myTranslator.rawTranslate(item.description);
      item.accessory_code = await myTranslator.wordTranslate(item.accessory_code);
      if (!item.description) item.description = '-';

      return item;
    });
  }
}

class BrandAuctionCrawler extends Crawler {
  async waitForLoading(page, timeout = 30 * 1000) {
    const loadingElements = await page.$$('app-loading');
    for (const e of loadingElements) {
      if (e) {
        await page.waitForFunction((e) => {
          return e && e.children.length == 0;
        }, {timeout: timeout}, e);
      }
      e.dispose();
    }
  }

  async filterHandle(itemHandle, existingIds) {
    const item = await itemHandle.evaluate((el, config) => {
      const id = el.querySelector(config.crawlSelectors.id);
      const status = el.querySelector(config.crawlSelectors.status);
      const scheduledDate = el.querySelector(config.crawlSelectors.scheduledDate);
      return {
        item_id: id ? id.textContent.trim() : null,
        status: status ? status.textContent.trim() : null,
        scheduled_date: scheduledDate ? scheduledDate.textContent.trim() : null,
      };
    }, this.config);
    item.scheduled_date = this.extractDate(item.scheduled_date);
    if (item.status == '保留成約' || item.status == '成約') return null;
    delete item.status;
    if (existingIds.has(item.item_id)) return {item_id: item.item_id};
    else return item;
  }

  async crawlAllItems(existingIds) {
    await this.closeDetailBrowsers();
    await this.loginCheckCrawler();
    const startTime = Date.now();
    myTranslator.TRANS_COUNT = 0;

    return this.retryOperation(async () => {
      await this.crawlerPage.goto(this.config.searchUrl, { waitUntil: 'networkidle0', timeout: this.pageTimeout });
      await this.crawlerPage.click(this.config.crawlSelectors.searchButton);
      await this.waitForLoading(this.crawlerPage);

      await this.crawlerPage.$eval(this.config.crawlSelectors.itemsPerPageSelecter, el => el.value = '500');
      await this.crawlerPage.select(this.config.crawlSelectors.itemsPerPageSelect, '500');
      await this.waitForLoading(this.crawlerPage);
      await this.sleep(3000);

      const totalPageText = await this.crawlerPage.$eval(this.config.crawlSelectors.totalPagesSpan, el => el.textContent);
      const totalPages = 5;//parseInt(totalPageText.match(/\d+/g).join(''));

      const allItems = [];
      console.log(`Crawling for total page ${totalPages}`);
      let itemHandles, filteredHandles, filteredItems, remainItems, pageItemsPromises, pageItems, filteredPageItems;      
      const limit = pLimit(5);

      for (let page = 1; page <= totalPages; page++) {
        console.log(`Crawling page ${page} of ${totalPages}`);

        await this.crawlerPage.select(this.config.crawlSelectors.pageSelect, page.toString());
        await this.waitForLoading(this.crawlerPage);
        
        itemHandles = await this.crawlerPage.$$(this.config.crawlSelectors.itemContainer);
        [filteredHandles, filteredItems, remainItems]= await this.filterHandles(itemHandles, existingIds);
        pageItemsPromises = [];
        for(let i = 0; i < filteredItems.length; i++) {
          pageItemsPromises.push(limit(async () => {
            const item = await this.extractItemInfo(filteredHandles[i], filteredItems[i]);
            filteredHandles[i].dispose();
            return item;
          }));
        }

        pageItems = await Promise.all(pageItemsPromises);

        filteredPageItems = pageItems.filter(item => item !== null);

        console.log(`Crawled ${filteredPageItems.length} items from page ${page}`);

        allItems.push(...filteredPageItems, ...remainItems);
      }

      this.closeCrawlerBrowser();

      console.log(`Total items crawled: ${allItems.length}`);
      console.log(`translate count: ${myTranslator.TRANS_COUNT}`);
      
      const endTime = Date.now();
      const executionTime = endTime - startTime;
      console.log(`Refresh operation completed in ${this.formatExecutionTime(executionTime)}`);

      return allItems;
    });
  }

  async extractItemInfo(itemHandle, item0) {
    const item = await itemHandle.evaluate((el, config) => {
      const title = el.querySelector(config.crawlSelectors.title);
      const brand = el.querySelector(config.crawlSelectors.brand);
      const rank = el.querySelector(config.crawlSelectors.rank);
      const startingPrice = el.querySelector(config.crawlSelectors.startingPrice);
      const image = el.querySelector(config.crawlSelectors.image);
      const category = el.querySelector(config.crawlSelectors.category);

      return {
        japanese_title: title ? title.textContent.trim() : null,
        brand: brand ? brand.textContent.trim() : null,
        rank: rank ? rank.textContent.trim() : null,
        starting_price: startingPrice ? startingPrice.textContent.trim() : null,
        image: image ? image.src.replace(/(brand_img\/)(\d+)/, '$16') : null,
        category: category.textContent.trim(),
      };
    }, this.config);
    [item.korean_title, item.brand, item.category] = await Promise.all([
      await myTranslator.wordTranslate(this.convertFullWidthToAscii(item.japanese_title)),
      await myTranslator.wordTranslate(this.convertFullWidthToAscii(item.brand)),
      await myTranslator.wordTranslate(item.category),
    ]);
    item.starting_price = this.currencyToInt(item.starting_price);
    item.auc_num = '2';

    return Object.assign(item0, item);
  }
  async crawlItemDetails(idx, itemId) {
    await this.loginCheckDetails();
  
    const startTime = Date.now();
    return this.retryOperation(async () => {
      const browser = this.detailBrowsers[idx];
      const page = this.detailPages[idx];
      await page.goto(this.config.searchUrl, { waitUntil: 'networkidle0', timeout: this.pageTimeout });
      console.log('search Url loaded');
      await page.click(this.config.crawlSelectors.resetButton);
      await Promise.all([
        await page.type(this.config.crawlSelectors.search1, itemId),
        await page.type(this.config.crawlSelectors.search2, itemId),
      ]);
      await page.click(this.config.crawlSelectors.searchButton);
      const newPagePromise = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Timeout waiting for new page'));
        }, 5000);
  
        browser.once('targetcreated', (target) => {
          clearTimeout(timeoutId);
          resolve(target.page());
        });
      });
      await this.waitForLoading(page);
      
      await page.click(this.config.crawlSelectors.itemContainer);
      const newPage = await newPagePromise;
      await this.initPage(newPage);
      await this.sleep(500);
      await this.waitForLoading(newPage, 5000);

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
      [item.description, item.accessory_code] = await Promise.all([
        await myTranslator.rawTranslate(item.description),
        await myTranslator.wordTranslate(item.accessory_code),
      ]);
      if (!item.description) item.description = '-';

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      console.log(this.formatExecutionTime(executionTime));
      return item;
    });
  }
}

const ecoAucCrawler = new Crawler(ecoAucConfig);
const brandAuctionCrawler = new BrandAuctionCrawler(brandAuctionConfig);

brandAuctionCrawler.crawlItemDetails(0, '730-12861').then((data) => {console.log(data)});

module.exports = { ecoAucCrawler, brandAuctionCrawler };