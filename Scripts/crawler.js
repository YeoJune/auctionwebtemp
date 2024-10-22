// Scripts/crawler.js
const dotenv = require('dotenv');
const { chromium } = require('playwright');
const { processImagesInChunks } = require('../utils/processImage');
const AdvancedTranslator = require('../utils/advancedTraslator');

const translator = new AdvancedTranslator('ap-northeast-2');

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

    this.crawlerContext = null;
    this.crawlerPage = null;
    this.isCrawlerLogin = false;

    this.detailContexts = [];
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

  async initPage(page) {
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.endsWith('.png') || url.endsWith('.jpg') || url.endsWith('.jpeg') || url.endsWith('.gif') || url.endsWith('.svg') ||
        url.endsWith('.css') || url.endsWith('.woff') || url.endsWith('.woff2') || url.endsWith('.ttf')) {
        route.abort();
      } else {
        route.continue();
      }
    });
  }

  async initializeCrawler() {
    this.crawlerContext = await chromium.launchPersistentContext('', {
      headless: true,
      args: [
        '--js-flags=--max-old-space-size=4096',
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        `--user-agent=${USER_AGENT}`, 
        '--disable-gl-drawing-for-tests',
        '--disable-dev-shm-usage', 
        '--disable-background-timer-throttling', 
        '--disable-backgrounding-occluded-windows', 
        '--disable-renderer-backgrounding', 
        '--disable-features=IsolateOrigins,site-per-process'
      ],
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    this.crawlerPage = await this.crawlerContext.newPage();

    await this.initPage(this.crawlerPage);

    console.log('complete to initialize crawler!');
  }

  async initializeDetails() {
    const detailInitPromises = Array(this.detailMulti).fill().map(() => this.initializeDetail());
    const detailResults = await Promise.all(detailInitPromises);

    this.detailContexts = detailResults.map(result => result.context);
    this.detailPages = detailResults.map(result => result.page);

    console.log('complete to initialize details!');
  }

  async initializeDetail() {
    const context = await chromium.launchPersistentContext('', {
      headless: true,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        `--user-agent=${USER_AGENT}`, 
        '--disable-gl-drawing-for-tests',
        '--disable-dev-shm-usage', 
        '--disable-background-timer-throttling', 
        '--disable-backgrounding-occluded-windows', 
        '--disable-renderer-backgrounding', 
        '--disable-features=IsolateOrigins,site-per-process'
      ],
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    
    await this.initPage(page);

    return { context, page };
  }
  
  async closeCrawlerBrowser() {
    if (this.crawlerContext) {
      await this.crawlerContext.close();
      this.crawlerContext = null;
      this.crawlerPage = null;
    }

    this.isCrawlerLogin = false;
  
    console.log('Crawler have been closed.');
  }

  async closeDetailBrowsers() {
    for (const context of this.detailContexts) {
      if (context) {
        await context.close();
      }
    }
    this.detailContexts = [];
    this.detailPages = [];

    this.isDetailLogins = false;
    
    console.log('Detail have been closed.');
  }

  async login(page) {
    return this.retryOperation(async () => {
      await page.goto(this.config.loginPageUrl, { waitUntil: 'networkidle', timeout: this.pageTimeout });
      await page.fill(this.config.signinSelectors.userId, this.config.loginData.userId);
      await page.fill(this.config.signinSelectors.password, this.config.loginData.password);
      await Promise.all([
        page.click(this.config.signinSelectors.loginButton),
        page.waitForLoadState('domcontentloaded'),
      ]);
    });
  }

  async loginCheckCrawler() {
    if (!this.crawlerContext || !this.crawlerPage) {
      await this.initializeCrawler();
    }

    await this.login(this.crawlerPage);
  }
  
  async loginCheckBrowsers() {
    if (!this.detailContexts.length || !this.detailPages.length) {
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
  
      const paginationExists = await this.crawlerPage.locator(this.config.crawlSelectors.paginationLast).count() > 0;
      
      if (paginationExists) {
        const href = await this.crawlerPage.locator(this.config.crawlSelectors.paginationLast).first().getAttribute('href');
        const match = href.match(/page=(\d+)/);
        if (match) {
          return parseInt(match[1], 10);
        }
      } else {
        const itemExists = await this.crawlerPage.locator(this.config.crawlSelectors.itemContainer).count() > 0;
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

      let totalPages = await this.getTotalPages(categoryId);
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
    translator.cleanupCache();

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
    try {
      const id = await itemHandle.$eval(this.config.crawlSelectors.id, el => el.getAttribute('data-auction-item-id'));  
      if (existingIds.has(id)) {
        return {item_id: id};
      }

      const [japaneseTitle, brand, rank, startingPrice, image, scheduledDate] = await Promise.all([
        itemHandle.$eval(this.config.crawlSelectors.title, el => el.textContent) || '',
        itemHandle.$eval(this.config.crawlSelectors.brand, el => el.textContent) || '',
        itemHandle.$eval(this.config.crawlSelectors.rank, el => el.textContent) || '',
        itemHandle.$eval(this.config.crawlSelectors.startingPrice, el => el.textContent) || '',
        itemHandle.$eval(this.config.crawlSelectors.image, el => el.getAttribute('src')) || null,
        itemHandle.$eval(this.config.crawlSelectors.scheduledDate, el => el.textContent) || '',
      ]);
  
      const item = {
        item_id: id,
        japanese_title: japaneseTitle,
        brand: brand,
        rank: rank,
        starting_price: startingPrice,
        image: image,
        scheduled_date: scheduledDate,
        category: this.config.categoryTable[this.config.currentCategoryId] || '',
      };

      if (!this.isCollectionDay(item.scheduled_date)) return null;
      if (item.image) item.image = item.image.replace(/\?.*$/, '') + '?w=300&h=300';
      if (item.rank) item.rank = item.rank.replace(/ランク/, '');

      for(const key in item) item[key] = item[key].trim();
      
      item.scheduled_date = this.extractDate(item.scheduled_date);
      item.korean_title = await translator.wordTranslate(item.japanese_title);
      item.brand = await translator.wordTranslate(item.brand);
      item.starting_price = this.currencyToInt(item.starting_price);
      item.auc_num = '1'
      
      return item;
    } catch (error) {
      console.error('Error in extractItemInfo:', error);
      return null;
    }
  }
  async crawlItemDetails(idx, itemId) {
    await this.loginCheckBrowsers();
  
    return this.retryOperation(async () => {
      const page = this.detailPages[idx];
      await page.goto(this.config.detailUrl(itemId), {
        waitUntil: 'domcontentloaded',
        timeout: this.pageTimeout
      });
  
      const images = [];
      const imageElements = await page.$$(this.config.crawlDetailSelectors.images);
      for (let i = 0; i < imageElements.length; i += 3) {
        const style = (await imageElements[i].getAttribute('style')).replace(/[\'\"]/g, '') || '';
        const urlMatch = style.match(/url\((.*?)\)/);
        if (urlMatch) {
          const imageUrl = urlMatch[1].replace(/&quot;/g, '').split('?')[0].trim();
          images.push(imageUrl + '?w=300&h=300');
        }
      }
  
      const binder = await page.$(this.config.crawlDetailSelectors.binder);
      
      const item = {
        image: images[0] || null,
        additional_images: JSON.stringify(images),
        scheduled_date: binder ? await binder.$eval(':nth-child(6)', el => el.textContent.trim()) : '',
        description: await page.locator(this.config.crawlDetailSelectors.description + ' > :nth-child(4)').textContent() || '-',
        accessory_code: binder ? await binder.$eval(':nth-child(14)', el => el.textContent.trim()) : '',
      };
  
      item.scheduled_date = this.extractDate(item.scheduled_date);
      item.description = await translator.rawTranslate(item.description?.trim());
      item.accessory_code = await translator.wordTranslate(item.accessory_code);
  
      return item;
    });
  }
}

class BrandAuctionCrawler extends Crawler {
  async waitForLoading(page, timeout = 30 * 1000) {
    await page.waitForFunction(() => {
      const loadingElements = document.querySelectorAll('app-loading');
      return Array.from(loadingElements).every(el => el.children.length === 0);
    }, { timeout: timeout });
  }

  async crawlAllItems(existingIds) {
    await this.closeDetailBrowsers();
    await this.loginCheckCrawler();
    const startTime = Date.now();
    TRANS_COUNT = 0;

    return this.retryOperation(async () => {
      await this.crawlerPage.goto(this.config.searchUrl, { waitUntil: 'networkidle', timeout: this.pageTimeout });
      await this.crawlerPage.click(this.config.crawlSelectors.searchButton);

      await this.waitForLoading(this.crawlerPage);
      await this.crawlerPage.$eval(this.config.crawlSelectors.itemsPerPageSelecter, el => el.value = '500');
      await this.crawlerPage.selectOption(this.config.crawlSelectors.itemsPerPageSelect, '500');
      await this.waitForLoading(this.crawlerPage);

      const totalPageText = await this.crawlerPage.$eval(this.config.crawlSelectors.totalPagesSpan, el => el.textContent);
      const totalPages = parseInt(totalPageText.match(/\d+/g).join(''));

      const allItems = [];
      console.log(`Crawling for total page ${totalPages}`);
      
      for (let page = 1; page <= totalPages; page++) {
        this.retryOperation(async () => {
          console.log(`Crawling page ${page} of ${totalPages}`);

          await this.crawlerPage.selectOption(this.config.crawlSelectors.pageSelect, page.toString());
          await this.waitForLoading(this.crawlerPage);
          await this.sleep(5000);
          
          const itemHandles = await this.crawlerPage.$$(this.config.crawlSelectors.itemContainer);
          const limit = pLimit(5);

          const pageItems = await Promise.all(itemHandles.map(handle => 
            limit(async () => {
              const item = await this.extractItemInfo(handle, existingIds);
              handle.dispose();
              return item;
            })
          ));
          const filteredPageItems = pageItems.filter((e) => e && e.item_id);
          const processedItems = await processImagesInChunks(filteredPageItems);
          
          allItems.push(...processedItems);
        });
      }

      this.closeCrawlerBrowser();
      translator.cleanupCache();

      console.log(`Total items crawled: ${allItems.length}`);
      console.log(`translate count: ${TRANS_COUNT}`);
      
      const endTime = Date.now();
      const executionTime = endTime - startTime;
      console.log(`Refresh operation completed in ${this.formatExecutionTime(executionTime)}`);

      return allItems;
    });
  }
  async extractItemInfo(itemHandle, existingIds) {
    try {
      const status = await itemHandle.$eval(this.config.crawlSelectors.status, el => el.textContent?.trim());
      if (status === '保留成約' || status === '成約') {
        return { status: status };
      }
  
      const id = await itemHandle.$eval(this.config.crawlSelectors.id, el => el.textContent?.trim());
      if (existingIds.has(id)) {
        return { item_id: id };
      }

      const [japaneseTitle, brand, rank, startingPrice, image, scheduledDate, category] = await Promise.all([
        itemHandle.$eval(this.config.crawlSelectors.title, el => el.textContent || ''),
        itemHandle.$eval(this.config.crawlSelectors.brand, el => el.textContent || ''),
        itemHandle.$eval(this.config.crawlSelectors.rank, el => el.textContent || ''),
        itemHandle.$eval(this.config.crawlSelectors.startingPrice, el => el.textContent || ''),
        itemHandle.$eval(this.config.crawlSelectors.image, el => el.getAttribute('src')),
        itemHandle.$eval(this.config.crawlSelectors.scheduledDate, el => el.textContent || ''),
        itemHandle.$eval(this.config.crawlSelectors.category, el => el.textContent || ''),
      ]);
  
      const item = {
        item_id: id,
        japanese_title: japaneseTitle.trim(),
        brand: brand.trim(),
        rank: rank.trim(),
        starting_price: startingPrice.trim(),
        image: image,
        scheduled_date: scheduledDate.trim(),
        category: category.trim(),
      };

      for (const key in item) {
        if (typeof item[key] === 'string') {
          item[key] = item[key].trim();
        }
      }
  
      if (item.image) {
        item.image = image.startsWith('http') ? image.replace(/(brand_img\/)(\d+)/, '$16') : '';
      }
      
      item.korean_title = await translator.wordTranslate(this.convertFullWidthToAscii(item.japanese_title));
      item.brand = await translator.wordTranslate(this.convertFullWidthToAscii(item.brand));
      item.starting_price = this.currencyToInt(item.starting_price);
      item.scheduled_date = this.extractDate(item.scheduled_date);
      item.category = await translator.wordTranslate(item.category);
      item.auc_num = '2';
  
      return item;
    } catch (error) {
      console.error('Error in extractItemInfo:', error);
      return null;
    }
  }
  
  async crawlItemDetails(idx, itemId) {
    await this.loginCheckBrowsers();
  
    const startTime = Date.now();
    return this.retryOperation(async () => {
      const context = this.detailContexts[idx];
      const page = this.detailPages[idx];
      await page.goto(this.config.searchUrl, { waitUntil: 'domcontentloaded', timeout: this.pageTimeout });

      await Promise.all([
        page.click(this.config.crawlSelectors.resetButton),
        page.fill(this.config.crawlSelectors.search1, itemId),
        page.fill(this.config.crawlSelectors.search2, itemId)
      ]);
      await page.click(this.config.crawlSelectors.searchButton);
      
      const newPagePromise = context.waitForEvent('page');
      await page.click(this.config.crawlSelectors.itemContainer);
      const newPage = await newPagePromise;
      await this.initPage(newPage);
      
      const currentUrl = newPage.url();
      await newPage.goto(currentUrl, { waitUntil: 'domcontentloaded' });
      await this.waitForLoading(newPage, 10000);

      let item;
      try {
        const images = await newPage.$$eval(this.config.crawlDetailSelectors.images, imgs => 
          imgs.map(img => {
            const src = img.getAttribute('src');
            return src && src.startsWith('http') ? src.replace(/(brand_img\/)(\d+)/, '$16') : null;
          }).filter(Boolean)
        );
  
        item = {
          image: images[0] || null,
          additional_images: JSON.stringify(images),
          description: await newPage.$(this.config.crawlDetailSelectors.description).then(el => el?.textContent()) || '',
          accessory_code: await newPage.$(`${this.config.crawlDetailSelectors.codeParent} > :nth-child(7) > :nth-child(3) > :nth-child(2)`).then(el => el?.textContent()) || '',
        };
  
        item.description = item.description.trim().replace(/\s{2,}/g, '\t');
        item.accessory_code = item.accessory_code.trim();
  
      } catch (error) {
        console.error('Error in crawlItemDetails:', error);
        throw error;
      } finally {
        await newPage.close();
        await page.click(this.config.crawlSelectors.resetButton);
      }
  
      item.description = await translator.rawTranslate(item.description);
      item.accessory_code = await translator.wordTranslate(item.accessory_code);
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

module.exports = { ecoAucCrawler, brandAuctionCrawler };