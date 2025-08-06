// baseCrawler.js
const dotenv = require("dotenv");
const puppeteer = require("puppeteer");
const axios = require("axios");
const tough = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");
const fs = require("fs");
const path = require("path");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { HttpProxyAgent } = require("http-proxy-agent");
const {
  HttpCookieAgent,
  HttpsCookieAgent,
  createCookieAgent,
} = require("http-cookie-agent/http");

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

    // 프록시 설정 추가
    this.useMultipleClients = config.useMultipleClients || false;
    this.proxyIPs = this.loadProxyIPs();
    this.clients = [];
    this.currentClientIndex = 0;

    // 로그인 관련 상태 변수들
    this.isLoggedIn = false;
    this.loginTime = null;
    this.sessionTimeout = 1000 * 60 * 60 * 3; // 3시간
    this.maxRetries = 3;
    this.retryDelay = 1000;

    // 로그인 중복 방지를 위한 변수들
    this.loginInProgress = false;
    this.loginPromise = null;

    // 로그인 체크 캐싱을 위한 변수
    this.lastLoginCheck = null;
    this.lastLoginCheckResult = false;
    this.loginCheckInterval = 1000 * 60 * 5; // 5분

    if (this.useMultipleClients) {
      this.initializeClients();
    } else {
      // 기존 단일 클라이언트 초기화
      this.cookieJar = new tough.CookieJar();
      this.initializeAxiosClient();
    }
  }

  loadProxyIPs() {
    const proxyIPsString = process.env.PROXY_IPS;
    if (!proxyIPsString) {
      console.log("No PROXY_IPS found, using direct connection only");
      return [];
    }
    return proxyIPsString.split(",").map((ip) => ip.trim());
  }

  initializeClients() {
    // 첫 번째: 직접 연결 (http-cookie-agent 사용)
    const directCookieJar = new tough.CookieJar();
    const directClient = axios.create({
      httpAgent: new HttpCookieAgent({
        cookies: { jar: directCookieJar },
      }),
      httpsAgent: new HttpsCookieAgent({
        cookies: { jar: directCookieJar },
      }),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
        "Accept-Language": "en-US,en;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      maxRedirects: 5,
      timeout: 30000,
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      },
    });

    this.clients.push({
      index: 0,
      name: "직접연결",
      client: directClient,
      cookieJar: directCookieJar,
      isLoggedIn: false,
      loginTime: null,
      useProxy: false,
    });

    // 나머지: 프록시 클라이언트들
    this.proxyIPs.forEach((ip, index) => {
      const cookieJar = new tough.CookieJar();

      const HttpProxyCookieAgent = createCookieAgent(HttpProxyAgent);
      const HttpsProxyCookieAgent = createCookieAgent(HttpsProxyAgent);

      const proxyClient = axios.create({
        httpAgent: new HttpProxyCookieAgent({
          cookies: { jar: cookieJar },
          host: ip,
          port: 3128,
          protocol: "http:",
        }),
        httpsAgent: new HttpsProxyCookieAgent({
          cookies: { jar: cookieJar },
          host: ip,
          port: 3128,
          protocol: "http:",
        }),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
          "Accept-Language": "en-US,en;q=0.9",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        maxRedirects: 5,
        timeout: 30000,
        validateStatus: function (status) {
          return status >= 200 && status < 500;
        },
      });

      this.clients.push({
        index: index + 1,
        name: `프록시${index + 1}(${ip})`,
        client: proxyClient,
        cookieJar: cookieJar,
        isLoggedIn: false,
        loginTime: null,
        useProxy: true,
      });
    });

    console.log(
      `${this.clients.length}개 클라이언트 초기화 완료 (직접 1개 + 프록시 ${this.proxyIPs.length}개)`
    );
  }

  // 기존 axios 클라이언트 초기화/재초기화
  initializeAxiosClient() {
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
  }

  // 라운드 로빈으로 다음 클라이언트 선택
  getNextClient() {
    const client = this.clients[this.currentClientIndex];
    this.currentClientIndex =
      (this.currentClientIndex + 1) % this.clients.length;
    return client;
  }

  // 클라이언트 선택 메서드 (프록시/단일 클라이언트 통합)
  getClient() {
    if (this.useMultipleClients) {
      return this.getNextClient();
    } else {
      return { client: this.client, name: "직접연결" };
    }
  }

  // 직접 연결 클라이언트 반환 (입찰/결제용)
  getDirectClient() {
    if (this.useMultipleClients) {
      return this.clients[0]; // 첫 번째는 항상 직접 연결
    } else {
      return {
        client: this.client,
        name: "직접연결",
        cookieJar: this.cookieJar,
      };
    }
  }

  // 특정 클라이언트로 로그인 체크
  async loginCheckWithClient(clientInfo) {
    return this.retryOperation(async () => {
      try {
        const responses = await Promise.all(
          this.config.loginCheckUrls.map((url) => clientInfo.client.get(url))
        );
        return responses.every((response) => response.status === 200);
      } catch (error) {
        return false;
      }
    });
  }

  // 특정 클라이언트로 로그인 (자식 클래스에서 구현)
  async performLoginWithClient(clientInfo) {
    throw new Error(
      "performLoginWithClient method must be implemented by child class"
    );
  }

  async loginWithClient(clientInfo) {
    if (clientInfo.isLoggedIn && this.isSessionValid(clientInfo.loginTime)) {
      return true;
    }

    try {
      const result = await this.performLoginWithClient(clientInfo);
      if (result) {
        clientInfo.isLoggedIn = true;
        clientInfo.loginTime = Date.now();
        console.log(`✅ ${clientInfo.name} 로그인 성공`);
      }
      return result;
    } catch (error) {
      console.error(`❌ ${clientInfo.name} 로그인 실패:`, error.message);
      return false;
    }
  }

  // 모든 클라이언트 로그인
  async loginAllClients() {
    console.log("\n=== 모든 클라이언트 로그인 ===");
    for (const clientInfo of this.clients) {
      await this.loginWithClient(clientInfo);
    }
  }

  // 강제 로그아웃 - 모든 세션 정보 초기화
  forceLogout() {
    console.log("Forcing logout and clearing all session data...");

    if (this.useMultipleClients) {
      // 다중 클라이언트의 경우 각각 초기화
      this.clients.forEach((clientInfo) => {
        clientInfo.isLoggedIn = false;
        clientInfo.loginTime = null;
      });
    } else {
      // 단일 클라이언트의 경우 기존 로직
      this.cookieJar = new tough.CookieJar();
      this.initializeAxiosClient();
    }

    // 로그인 상태 초기화
    this.isLoggedIn = false;
    this.loginTime = null;
    this.loginInProgress = false;
    this.loginPromise = null;

    // 로그인 체크 캐시 초기화
    this.lastLoginCheck = null;
    this.lastLoginCheckResult = false;

    console.log("Session data cleared successfully");
  }

  // 세션 유효성 검사 (단일 클라이언트용)
  isSessionValid(loginTime = this.loginTime) {
    if (!loginTime) return false;
    return Date.now() - loginTime < this.sessionTimeout;
  }

  // 로그인 체크 (캐싱 포함) - 단일 클라이언트용
  async loginCheck() {
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
        const responses = await Promise.all(
          this.config.loginCheckUrls.map((url) => this.client.get(url))
        );

        // 결과 캐싱
        this.lastLoginCheck = Date.now();
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

  // 메인 로그인 메서드 - 모든 로직을 부모 클래스에서 처리
  async login(forceLogin = false) {
    try {
      if (this.useMultipleClients) {
        // 다중 클라이언트인 경우 모든 클라이언트 로그인
        await this.loginAllClients();
        return true;
      }

      // 단일 클라이언트인 경우 기존 로직
      if (forceLogin) {
        console.log("Force login requested - clearing session");
        this.forceLogout();
      }

      if (!forceLogin && this.isLoggedIn && this.isSessionValid()) {
        const serverLoginValid = await this.loginCheck();
        if (serverLoginValid) {
          console.log("Already logged in, session is valid");
          return true;
        } else {
          console.log("Server session expired, need to re-login");
          this.forceLogout();
        }
      }

      if (this.loginInProgress && this.loginPromise) {
        console.log("Login already in progress, waiting for completion");
        return await this.loginPromise;
      }

      console.log("Starting login process...");
      this.loginInProgress = true;

      this.loginPromise = this.performLogin();
      const result = await this.loginPromise;

      if (result) {
        this.isLoggedIn = true;
        this.loginTime = Date.now();
        console.log("Login successful - session established");
      } else {
        console.log("Login failed");
        this.forceLogout();
      }

      return result;
    } catch (error) {
      console.error("Login process failed:", error.message);
      this.forceLogout();
      return false;
    } finally {
      this.loginInProgress = false;
      this.loginPromise = null;
    }
  }

  // 실제 로그인 로직 - 자식 클래스에서 오버라이드해야 함
  async performLogin() {
    if (this.useMultipleClients) {
      // 첫 번째 클라이언트(직접 연결)로 로그인
      const directClient = this.clients[0];
      return await this.performLoginWithClient(directClient);
    } else {
      throw new Error("performLogin method must be implemented by child class");
    }
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

  // 나머지 유틸리티 메서드들은 기존과 동일
  removeLeadingBrackets(title) {
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
    const offset = 9 * 60;
    const kstDate = new Date(date.getTime() + offset * 60 * 1000);
    return kstDate.toISOString().replace("Z", "+09:00");
  }

  extractDate(text) {
    if (!text) return null;

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

    const lowerText = text.toLowerCase();

    // 다양한 날짜 패턴 매칭
    const patterns = [
      /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)[,\s.-]*(\d{1,2})[,\s.-]*(\d{4}).*?(\d{1,2})[：:\s]*(\d{2})/i,
      /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)[,\s.-]*(\d{1,2})[,\s.-]*(\d{4})/i,
      /(\d{4})[-./](\d{1,2})[-./](\d{1,2}).*?(\d{1,2})[：:\s]*(\d{2})/,
      /(\d{4})[-./](\d{1,2})[-./](\d{1,2})/,
      /(\d{1,2})[-./](\d{1,2})[-./](\d{4}).*?(\d{1,2})[：:\s]*(\d{2})/,
      /(\d{1,2})[-./](\d{1,2})[-./](\d{4})/,
    ];

    for (const pattern of patterns) {
      const match = (
        pattern.toString().includes("jan|feb") ? lowerText : text
      ).match(pattern);
      if (match) {
        if (pattern.toString().includes("jan|feb")) {
          // 영문 월 패턴
          const month = monthNames[match[1]];
          const day = match[2].padStart(2, "0");
          const year = match[3];
          if (match[4] && match[5]) {
            const hour = match[4].padStart(2, "0");
            const minute = match[5].padStart(2, "0");
            return `${year}-${month}-${day} ${hour}:${minute}:00`;
          } else {
            return `${year}-${month}-${day} 00:00:00`;
          }
        } else if (match[0].includes("-") && match[1].length === 4) {
          // YYYY-MM-DD 패턴
          const year = match[1];
          const month = match[2].padStart(2, "0");
          const day = match[3].padStart(2, "0");
          if (match[4] && match[5]) {
            const hour = match[4].padStart(2, "0");
            const minute = match[5].padStart(2, "0");
            return `${year}-${month}-${day} ${hour}:${minute}:00`;
          } else {
            return `${year}-${month}-${day} 00:00:00`;
          }
        } else {
          // MM/DD/YYYY 패턴 (미국식)
          const month = match[1].padStart(2, "0");
          const day = match[2].padStart(2, "0");
          const year = match[3];
          if (match[4] && match[5]) {
            const hour = match[4].padStart(2, "0");
            const minute = match[5].padStart(2, "0");
            return `${year}-${month}-${day} ${hour}:${minute}:00`;
          } else {
            return `${year}-${month}-${day} 00:00:00`;
          }
        }
      }
    }

    return null;
  }

  isCollectionDay(date) {
    if (!date) return true;
    const day = new Date(date).getDay();
    return ![2, 4].includes(day);
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
    const scheduleDate = new Date(scheduledDate);
    const previousDay = new Date(scheduleDate);
    previousDay.setDate(previousDay.getDate() - 1);
    previousDay.setHours(18, 0, 0, 0);
    return this.extractDate(this.convertToKST(previousDay.toISOString()));
  }

  isAuctionTimeValid(scheduledDate) {
    if (!scheduledDate) return false;
    const auctionDate = new Date(scheduledDate + "+09:00");
    const now = new Date();
    return auctionDate > now;
  }
}

module.exports = { Crawler, AxiosCrawler };
