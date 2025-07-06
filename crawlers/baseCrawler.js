// baseCrawler.js
const dotenv = require("dotenv");
const puppeteer = require("puppeteer");
const axios = require("axios");
const cheerio = require("cheerio");
const tough = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");
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

    // 디테일 브라우저 세션 관리를 위한 변수들
    this.sessionTimeout = 1000 * 60 * 60 * 3; // 3시간
    this.detailLoginTime = null; // 디테일 브라우저들의 공통 로그인 시간

    this.crawlerBrowser = null;
    this.crawlerPage = null;
    this.isCrawlerLogin = false;

    this.detailBrowsers = [];
    this.detailPages = [];
    this.isDetailLogins = false;
  }

  isSessionValid(loginTime) {
    if (!loginTime) return false;
    const currentTime = Date.now();
    return currentTime - loginTime < this.sessionTimeout;
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

  convertToKST(utcString) {
    const date = new Date(utcString);
    // 한국 표준시는 UTC+9
    const offset = 9 * 60; // 분 단위
    const kstDate = new Date(date.getTime() + offset * 60 * 1000);
    return kstDate.toISOString().replace("Z", "+09:00");
  }

  extractDate(text) {
    const regex1 = /(\d{4}).?(\d{2}).?(\d{2})/;
    const match1 = text?.match(regex1);
    const regex2 = /(\d{4}).?(\d{2}).?(\d{2}).*?(\d{2})\s*?：\s*(\d{2})/;
    const match2 = text?.match(regex2);
    if (match2)
      return (
        `${match2[1]}-${match2[2]}-${match2[3]}` +
        (match2[4] && match2[5] ? ` ${match2[4]}:${match2[5]}:00` : "00:00:00")
      );
    else if (match1) return `${match1[1]}-${match1[2]}-${match1[3]} 00:00:00`;
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
    this.detailLoginTime = null;

    console.log("Detail have been closed.");
  }

  async login(page) {
    return this.retryOperation(async () => {
      const response = await page.goto(this.config.loginPageUrl, {
        waitUntil: "networkidle0",
        timeout: this.pageTimeout,
      });

      const finalUrl = page.url();
      if (finalUrl !== this.config.loginPageUrl) {
        console.log(
          "Already logged in, skipping login process",
          this.config.name
        );
        return;
      }
      await page.type(
        this.config.signinSelectors.userId,
        this.config.loginData.userId
      );
      await page.type(
        this.config.signinSelectors.password,
        this.config.loginData.password
      );
      await Promise.all([
        page.click(this.config.signinSelectors.loginButton),
        page.waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: this.pageTimeout,
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
    // 세션이 만료되었거나 브라우저가 없는 경우
    if (
      !this.isSessionValid(this.detailLoginTime) ||
      !this.detailBrowsers.length ||
      !this.detailPages.length
    ) {
      // 기존 브라우저들 닫기
      await this.closeDetailBrowsers();

      await this.initializeDetails();
      console.log("complete to details init!", this.config.name);

      const loginTasks = this.detailPages.map((page) => this.login(page));
      await Promise.all(loginTasks);

      this.detailLoginTime = Date.now(); // 모든 디테일 브라우저의 로그인 시간을 동일하게 설정
      this.isDetailLogins = true;
      console.log("complete to login details!", this.config.name);
    }
  }
}

class AxiosCrawler {
  constructor(config) {
    this.config = config;
    this.cookieJar = new tough.CookieJar();

    // axios 인스턴스 설정
    this.client = wrapper(
      axios.create({
        jar: this.cookieJar,
        withCredentials: true,
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "en-US,en;q=0.9",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        },
        maxRedirects: 5,
      })
    );

    this.isLoggedIn = false;
    this.loginTime = null;
    this.sessionTimeout = 1000 * 60 * 60 * 3;
    this.maxRetries = 3;
    this.retryDelay = 1000;

    // 로그인 중복 방지를 위한 변수들 추가
    this.loginInProgress = false;
    this.loginPromise = null;

    // 로그인 체크 캐싱을 위한 변수 추가
    this.lastLoginCheck = null;
    this.lastLoginCheckResult = false;
    this.loginCheckInterval = 1000 * 60 * 5; // 5분
  }

  isSessionValid() {
    if (!this.loginTime) return false;
    return Date.now() - this.loginTime < this.sessionTimeout;
  }

  // 로그인 체크 기본 메서드 (각 크롤러에서 오버라이드)
  async loginCheck() {
    // 세션이 만료된 경우 무조건 false 반환
    if (!this.isSessionValid()) {
      console.log("Session expired, forcing logout");
      this.lastLoginCheck = Date.now();
      this.lastLoginCheckResult = false;
      this.isLoggedIn = false;
      return false;
    }

    // 마지막 로그인 체크 시간이 5분 이내면 캐시된 결과 반환
    if (
      this.lastLoginCheck &&
      Date.now() - this.lastLoginCheck < this.loginCheckInterval &&
      this.lastLoginCheckResult !== false
    ) {
      console.log("Using cached login check result");
      return this.lastLoginCheckResult;
    }

    // 5분이 지났거나 처음 체크하는 경우, 실제 체크 수행
    return this.retryOperation(async () => {
      try {
        // this.config.loginCheckUrls에서 하나씩
        const responses = await Promise.all(
          this.config.loginCheckUrls.map((url) => this.client.get(url))
        );

        // 결과 캐싱
        this.lastLoginCheck = Date.now();
        // responses의 status가 모두 200일 때만 true
        this.lastLoginCheckResult = responses.every(
          (response) => response.status === 200
        );

        return this.lastLoginCheckResult;
      } catch (error) {
        // 에러 발생시 캐싱 업데이트
        this.lastLoginCheck = Date.now();
        this.lastLoginCheckResult = false;
        return false;
      }
    });
  }

  async login() {
    // 이미 로그인되어 있고, 세션이 유효하면 재로그인 안함
    if ((await this.loginCheck()) && this.isSessionValid()) {
      console.log("Already logged in, session is valid");
      this.isLoggedIn = true;
      return true;
    }

    // 이미 로그인 중이면 진행 중인 로그인 Promise 반환
    if (this.loginInProgress && this.loginPromise) {
      console.log("Login already in progress, waiting for completion");
      return this.loginPromise;
    }

    // 에러를 발생시키지 않고 false 반환
    // 자식 클래스에서 이 반환값을 확인하고 로그인 로직 실행
    return false;
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
          console.error(
            `Operation failed after ${maxRetries} attempts:`,
            error.message
          );
          throw error;
        }
        console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
        await this.sleep(delay);
      }
    }
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  removeLeadingBrackets(title) {
    // 앞쪽의 대괄호와 소괄호 제거
    return title.replace(/^[\[\(][^\]\)]*[\]\)]\s*/, "");
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
    return null;
  }

  convertToKST(utcString) {
    const date = new Date(utcString);
    // 한국 표준시는 UTC+9
    const offset = 9 * 60; // 분 단위
    const kstDate = new Date(date.getTime() + offset * 60 * 1000);
    return kstDate.toISOString().replace("Z", "+09:00");
  }

  extractDate(text) {
    if (!text) return null;

    // 월 이름과 숫자 매핑
    const monthNames = {
      jan: "01",
      january: "01",
      feb: "02",
      february: "02",
      mar: "03",
      march: "03",
      apr: "04",
      april: "04",
      may: "05",
      jun: "06",
      june: "06",
      jul: "07",
      july: "07",
      aug: "08",
      august: "08",
      sep: "09",
      september: "09",
      oct: "10",
      october: "10",
      nov: "11",
      november: "11",
      dec: "12",
      december: "12",
    };

    // 텍스트 전처리: 모든 문자를 소문자로 변환
    const lowerText = text.toLowerCase();

    // 패턴 1: 영문 월 + 일 + 연도 + 시간 (예: May 14, 2025 18:00)
    const pattern1 =
      /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)[,\s.-]*(\d{1,2})[,\s.-]*(\d{4}).*?(\d{1,2})[：:\s]*(\d{2})/i;
    const match1 = lowerText.match(pattern1);

    if (match1) {
      const month = monthNames[match1[1]];
      const day = match1[2].padStart(2, "0");
      const year = match1[3];
      const hour = match1[4].padStart(2, "0");
      const minute = match1[5].padStart(2, "0");
      return `${year}-${month}-${day} ${hour}:${minute}:00`;
    }

    // 패턴 2: 영문 월 + 일 + 연도 (시간 없음) (예: May 14, 2025)
    const pattern2 =
      /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)[,\s.-]*(\d{1,2})[,\s.-]*(\d{4})/i;
    const match2 = lowerText.match(pattern2);

    if (match2) {
      const month = monthNames[match2[1]];
      const day = match2[2].padStart(2, "0");
      const year = match2[3];
      return `${year}-${month}-${day} 00:00:00`;
    }

    // 패턴 3: YYYY-MM-DD HH:MM 형식 (예: 2025-05-14 18:00)
    const pattern3 =
      /(\d{4})[-./](\d{1,2})[-./](\d{1,2}).*?(\d{1,2})[：:\s]*(\d{2})/;
    const match3 = text.match(pattern3);

    if (match3) {
      const year = match3[1];
      const month = match3[2].padStart(2, "0");
      const day = match3[3].padStart(2, "0");
      const hour = match3[4].padStart(2, "0");
      const minute = match3[5].padStart(2, "0");
      return `${year}-${month}-${day} ${hour}:${minute}:00`;
    }

    // 패턴 4: YYYY-MM-DD 형식 (시간 없음) (예: 2025-05-14)
    const pattern4 = /(\d{4})[-./](\d{1,2})[-./](\d{1,2})/;
    const match4 = text.match(pattern4);

    if (match4) {
      const year = match4[1];
      const month = match4[2].padStart(2, "0");
      const day = match4[3].padStart(2, "0");
      return `${year}-${month}-${day} 00:00:00`;
    }

    // 패턴 5: MM/DD/YYYY HH:MM 형식 (미국식) (예: 05/14/2025 18:00)
    const pattern5 =
      /(\d{1,2})[-./](\d{1,2})[-./](\d{4}).*?(\d{1,2})[：:\s]*(\d{2})/;
    const match5 = text.match(pattern5);

    if (match5) {
      // 미국식(MM/DD/YYYY)으로 가정
      const month = match5[1].padStart(2, "0");
      const day = match5[2].padStart(2, "0");
      const year = match5[3];
      const hour = match5[4].padStart(2, "0");
      const minute = match5[5].padStart(2, "0");
      return `${year}-${month}-${day} ${hour}:${minute}:00`;
    }

    // 패턴 6: MM/DD/YYYY 형식 (시간 없음) (예: 05/14/2025)
    const pattern6 = /(\d{1,2})[-./](\d{1,2})[-./](\d{4})/;
    const match6 = text.match(pattern6);

    if (match6) {
      // 미국식(MM/DD/YYYY)으로 가정
      const month = match6[1].padStart(2, "0");
      const day = match6[2].padStart(2, "0");
      const year = match6[3];
      return `${year}-${month}-${day} 00:00:00`;
    }

    return null;
  }

  isCollectionDay(date) {
    if (!date) return true;
    const day = new Date(date).getDay();
    return ![2, 4].includes(day); // 화요일, 목요일 제외
  }

  convertFullWidthToAscii(str) {
    return str
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (s) {
        return String.fromCharCode(s.charCodeAt(0) - 0xfee0);
      })
      .replace(/　/g, " ");
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

  getPreviousDayAt18(scheduledDate) {
    // scheduledDate를 기준으로 전날 18시를 계산
    const scheduleDate = new Date(scheduledDate);
    const previousDay = new Date(scheduleDate);
    previousDay.setDate(previousDay.getDate() - 1);
    previousDay.setHours(18, 0, 0, 0);
    return this.extractDate(this.convertToKST(previousDay.toISOString()));
  }

  // 경매 시간이 이미 지났는지 확인
  isAuctionTimeValid(scheduledDate) {
    if (!scheduledDate) return false;
    const auctionDate = new Date(scheduledDate + "+09:00");
    const now = new Date();
    return auctionDate > now;
  }
}

module.exports = { Crawler, AxiosCrawler };
