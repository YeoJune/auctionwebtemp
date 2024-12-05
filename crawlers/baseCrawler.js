// crawlers/baseCrawler.js
const dotenv = require("dotenv");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

dotenv.config();

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

class Crawler {
  constructor(config) {
    this.config = config;
    this.maxRetries = 3;
    this.retryDelay = 1000;
    this.pageTimeout = 60000;
    this.detailMulti = 2;

    this.crawlerBrowser = null;
    this.crawlerPage = null;
    this.isCrawlerLogin = false;

    this.detailBrowsers = [];
    this.detailPages = [];
    this.isDetailLogins = false;
  }

  async retryOperation(
    operation,
    maxRetries = this.maxRetries,
    delay = this.retryDelay
  ) {
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

    let timeString = "";
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
    if (currencyString) {
      const cleanString = currencyString.replace(/\D/g, "");

      const number = parseInt(cleanString);

      if (isNaN(number)) {
        throw new Error("Invalid currency string");
      }

      return number;
    }
  }
  extractDate(text) {
    const regex1 = /(\d{4}).?(\d{2}).?(\d{2})/;
    const match1 = text?.match(regex1);
    const regex2 = /(\d{4}).?(\d{2}).?(\d{2}).*?(\d{2})\s*?：\s*(\d{2})/;
    const match2 = text?.match(regex2);
    if (match2)
      return (
        `${match2[1]}-${match2[2]}-${match2[3]}` +
        (match2[4] && match2[5] ? ` ${match2[4]}:${match2[5]}` : "00:00")
      );
    else if (match1) return `${match1[1]}-${match1[2]}-${match1[3]} 00:00`;
    else return null;
  }
  convertFullWidthToAscii(str) {
    return str
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (s) {
        return String.fromCharCode(s.charCodeAt(0) - 0xfee0);
      })
      .replace(/　/g, " ");
  }
  isCollectionDay(date) {
    if (!date) return true;
    const day = new Date(date).getDay();
    return ![2, 4].includes(day);
  }
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async initPage(page) {
    await Promise.all([
      await page.setRequestInterception(true),
      await page.setViewport({
        width: 1920,
        height: 1080,
      }),
      await page.setExtraHTTPHeaders({
        "Accept-Language": "en-US,en;q=0.9",
      }),
    ]);
    page.on("request", (request) => {
      const blockResources = ["stylesheet", "font", "media"];

      if (blockResources.includes(request.resourceType())) {
        request.abort();
      } else {
        request.continue();
      }
    });
  }
  async initializeDetails() {
    let idx = 1;
    const detailInitPromises = Array(this.detailMulti)
      .fill()
      .map(() => this.initializeCrawler(`detail${idx++}`));
    const detailResults = await Promise.all(detailInitPromises);

    this.detailBrowsers = detailResults.map((result) => result.browser);
    this.detailPages = detailResults.map((result) => result.page);

    console.log("complete to initialize details!");
  }
  async initializeCrawler(name = "") {
    const userDataDir = path.join(
      __dirname,
      "..",
      "userData",
      `${this.config.name}_${name}`
    );

    const launchOptions = {
      headless: true,
      userDataDir: userDataDir,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-infobars",
        "--single-process",
        "--no-zygote",
        "--no-first-run",
        `--window-size=1280,800`,
        "--window-position=0,0",
        "--ignore-certificate-errors",
        "--ignore-certificate-errors-skip-list",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--hide-scrollbars",
        "--disable-notifications",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-breakpad",
        "--disable-component-extensions-with-background-pages",
        "--disable-extensions",
        "--disable-features=TranslateUI,BlinkGenPropertyTrees",
        "--disable-ipc-flooding-protection",
        "--disable-renderer-backgrounding",
        "--enable-features=NetworkService,NetworkServiceInProcess",
        "--force-color-profile=srgb",
        "--metrics-recording-only",
        "--mute-audio",
        "--lang=en-US,en",
        `--user-agent=${USER_AGENT}`,
      ],
    };

    if (process.env.ENV !== "development") {
      launchOptions.executablePath = "/usr/bin/chromium-browser";
    } else {
      launchOptions.executablePath =
        "C:\\Users\\joyyo\\.cache\\puppeteer\\chrome\\win64-131.0.6778.85\\chrome-win64\\chrome.exe";
    }

    const browser = await puppeteer.launch(launchOptions);

    browser.on("disconnected", async () => {
      try {
        await this.sleep(1000);
        if (fs.existsSync(userDataDir)) {
          fs.rmSync(userDataDir, { recursive: true, force: true });
        }
      } catch (err) {
        console.error("Failed to remove user data directory:", err);
      }
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

    console.log("Crawler have been closed.");
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

    console.log("Detail have been closed.");
  }
  async login(page) {
    return this.retryOperation(async () => {
      // 페이지 이동 후 최종 URL 확인
      const response = await page.goto(this.config.loginPageUrl, {
        waitUntil: "networkidle0",
        timeout: this.pageTimeout,
      });

      // 최종 URL이 로그인 페이지와 다르다면 이미 로그인된 상태
      const finalUrl = page.url();
      if (finalUrl !== this.config.loginPageUrl) {
        console.log(
          "Already logged in, skipping login process",
          this.config.name
        );
        return;
      }

      // 로그인이 필요한 경우에만 실행
      await Promise.all([
        page.type(
          this.config.signinSelectors.userId,
          this.config.loginData.userId
        ),
        page.type(
          this.config.signinSelectors.password,
          this.config.loginData.password
        ),
      ]);

      await Promise.all([
        page.click(this.config.signinSelectors.loginButton),
        page.waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: 3000,
        }),
      ]);

      await this.sleep(3000);
      const button = await page.$(".common_btn.vivid");
      if (button) {
        await button.click();
        await this.sleep(3000);
      }
    }, 1);
  }
  async loginCheckCrawler() {
    if (!this.crawlerBrowser || !this.crawlerPage) {
      const result = await this.initializeCrawler("crawler");
      this.crawlerBrowser = result.browser;
      this.crawlerPage = result.page;
      console.log("complete to crawler init!", this.config.name);
    }
    await this.login(this.crawlerPage);
    console.log("complete to crawler login!", this.config.name);
  }
  async loginCheckDetails() {
    if (!this.detailBrowsers.length || !this.detailPages.length) {
      await this.initializeDetails();
      console.log("complete to details init!", this.config.name);
    }
    const loginTasks = [];

    if (!this.isDetailLogins) {
      const detailLoginTasks = this.detailPages.map((page) => this.login(page));
      loginTasks.push(...detailLoginTasks);
    }

    if (loginTasks.length > 0) {
      await Promise.all(loginTasks);
      this.isDetailLogins = true;
      console.log("complete to login details!", this.config.name);
    }
  }
}

module.exports = Crawler;
