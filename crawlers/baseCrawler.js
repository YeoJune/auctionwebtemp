// crawlers/baseCrawler.js
const dotenv = require("dotenv");
const axios = require("axios");
const tough = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");
const { ProxyManager } = require("../utils/proxy");
const fs = require("fs");
const path = require("path");

let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

dotenv.config();

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

class AxiosCrawler {
  constructor(config, proxyManager = null) {
    this.config = config;

    // 쿠키 저장 디렉토리 설정
    this.cookieDir = path.join(process.cwd(), ".cookies");
    this.ensureCookieDir();

    // 프록시 매니저 의존성 주입
    this.proxyManager =
      proxyManager ||
      new ProxyManager({
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
          "Accept-Language": "en-US,en;q=0.9",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        timeout: 30 * 1000,
        maxRedirects: 5,
      });

    // 다중 클라이언트 사용 여부
    this.useMultipleClients = config.useMultipleClients || false;
    this.clients = [];
    this.currentClientIndex = 0;

    // 로그인 관련 상태 변수들
    this.isLoggedIn = false;
    this.loginTime = null;
    this.sessionTimeout = 1000 * 60 * 60 * 8; // 8시간
    this.maxRetries = 3;
    this.retryDelay = 1000;

    // 로그인 중복 방지를 위한 변수들 (단일 클라이언트용)
    this.loginInProgress = false;
    this.loginPromise = null;

    // 다중 클라이언트용 로그인 관리 변수들
    this.clientLoginPromises = new Map();
    this.clientLoginInProgress = new Map();
    this.clientLastLoginCheck = new Map();
    this.clientLastLoginCheckResult = new Map();

    // 로그인 체크 캐싱을 위한 변수
    this.loginCheckInterval = 1000 * 60 * 5; // 5분

    if (this.useMultipleClients) {
      this.initializeClients();
    } else {
      // 단일 클라이언트: 저장된 쿠키 복원 시도
      this.initializeSingleClient();
    }
  }

  // 쿠키 디렉토리 생성
  ensureCookieDir() {
    if (!fs.existsSync(this.cookieDir)) {
      fs.mkdirSync(this.cookieDir, { recursive: true });
      console.log(`📁 쿠키 디렉토리 생성: ${this.cookieDir}`);
    }
  }

  // 쿠키 파일 경로 생성
  getCookieFilePath(clientIndex = 0) {
    const siteName = this.config.siteName || "default";
    return path.join(this.cookieDir, `${siteName}_client_${clientIndex}.json`);
  }

  // 단일 클라이언트 초기화 (쿠키 복원 포함)
  async initializeSingleClient() {
    const cookiePath = this.getCookieFilePath(0);

    if (fs.existsSync(cookiePath)) {
      console.log(`🔄 저장된 세션 복원 시도: ${cookiePath}`);
      try {
        const cookieData = fs.readFileSync(cookiePath, "utf8");
        const cookieJson = JSON.parse(cookieData);

        // CookieJar 복원
        this.cookieJar = tough.CookieJar.deserializeSync(cookieJson);
        this.initializeAxiosClient();

        // 세션 유효성 검증
        const isValid = await this.validateRestoredSession();

        if (isValid) {
          this.isLoggedIn = true;
          this.loginTime = Date.now();
          console.log(`✅ 저장된 세션 복원 성공`);
          return;
        } else {
          console.log(`⚠️ 저장된 세션 만료됨`);
        }
      } catch (error) {
        console.log(`⚠️ 세션 복원 실패: ${error.message}`);
      }
    }

    // 복원 실패 시 새로 생성
    console.log(`🆕 새 세션 생성`);
    this.cookieJar = new tough.CookieJar();
    this.initializeAxiosClient();
  }

  // 복원된 세션 검증
  async validateRestoredSession() {
    if (
      !this.config.loginCheckUrls ||
      this.config.loginCheckUrls.length === 0
    ) {
      return true; // 검증 URL이 없으면 통과
    }

    try {
      const responses = await Promise.all(
        this.config.loginCheckUrls.map((url) =>
          this.client.get(url, { timeout: 5000 })
        )
      );
      return responses.every((response) => response.status === 200);
    } catch (error) {
      return false;
    }
  }

  // 쿠키 저장
  saveCookies(clientIndex = 0, cookieJar = this.cookieJar) {
    try {
      const cookiePath = this.getCookieFilePath(clientIndex);
      const cookieJson = cookieJar.serializeSync();
      fs.writeFileSync(cookiePath, JSON.stringify(cookieJson, null, 2));
      console.log(`💾 쿠키 저장 완료: ${cookiePath}`);
    } catch (error) {
      console.error(`❌ 쿠키 저장 실패:`, error.message);
    }
  }

  // 다중 클라이언트 초기화
  initializeClients() {
    this.clients = this.proxyManager.createAllClients();

    // 각 클라이언트의 저장된 쿠키 복원 시도
    this.clients.forEach((clientInfo, index) => {
      const cookiePath = this.getCookieFilePath(index);

      if (fs.existsSync(cookiePath)) {
        try {
          const cookieData = fs.readFileSync(cookiePath, "utf8");
          const cookieJson = JSON.parse(cookieData);
          clientInfo.cookieJar = tough.CookieJar.deserializeSync(cookieJson);

          // 클라이언트 재생성 (복원된 쿠키 사용)
          clientInfo.client = wrapper(
            axios.create({
              jar: clientInfo.cookieJar,
              withCredentials: true,
              headers: clientInfo.headers || {
                "User-Agent": USER_AGENT,
                "Accept-Language": "en-US,en;q=0.9",
              },
              maxRedirects: 5,
              ...(clientInfo.proxy && { proxy: clientInfo.proxy }),
            })
          );

          console.log(`🔄 ${clientInfo.name} 쿠키 복원 완료`);
        } catch (error) {
          console.log(`⚠️ ${clientInfo.name} 쿠키 복원 실패: ${error.message}`);
        }
      }
    });

    console.log(
      `${
        this.clients.length
      }개 클라이언트 초기화 완료 (직접 1개 + 프록시 ${this.proxyManager.getAvailableProxyCount()}개)`
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
      return this.clients[0];
    } else {
      return {
        client: this.client,
        name: "직접연결",
        cookieJar: this.cookieJar,
      };
    }
  }

  // 특정 클라이언트의 로그인 체크 (캐싱 포함)
  async loginCheckWithClient(clientInfo) {
    const clientIndex = clientInfo.index;

    // 마지막 로그인 체크 시간이 5분 이내면 캐시된 결과 반환
    const lastCheck = this.clientLastLoginCheck.get(clientIndex);
    const lastResult = this.clientLastLoginCheckResult.get(clientIndex);

    if (
      lastCheck &&
      Date.now() - lastCheck < this.loginCheckInterval &&
      lastResult !== false
    ) {
      console.log(`Using cached login check result for ${clientInfo.name}`);
      return lastResult;
    }

    // 5분이 지났거나 처음 체크하는 경우, 실제 체크 수행
    return this.retryOperation(async () => {
      try {
        const responses = await Promise.all(
          this.config.loginCheckUrls.map((url) => clientInfo.client.get(url))
        );

        const result = responses.every((response) => response.status === 200);

        // 결과 캐싱
        this.clientLastLoginCheck.set(clientIndex, Date.now());
        this.clientLastLoginCheckResult.set(clientIndex, result);

        return result;
      } catch (error) {
        // 에러 발생시 캐싱 업데이트
        this.clientLastLoginCheck.set(clientIndex, Date.now());
        this.clientLastLoginCheckResult.set(clientIndex, false);
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

  // 개선된 단일 클라이언트 로그인 - 쿠키 자동 저장 포함
  async loginWithClient(clientInfo, forceLogin = false) {
    const clientIndex = clientInfo.index;

    try {
      // 1. 강제 로그인
      if (forceLogin) {
        console.log(`${clientInfo.name} - Force login requested`);
        await this.forceLogoutClient(clientInfo);
      }
      // 2. 첫 로그인
      else if (!clientInfo.isLoggedIn) {
        console.log(`${clientInfo.name} - First time login`);
      }
      // 3. 기존 로그인 상태 체크
      else if (clientInfo.isLoggedIn) {
        // 로컬 세션 체크
        if (!this.isSessionValid(clientInfo.loginTime)) {
          console.log(`${clientInfo.name} - Local session expired`);
          await this.forceLogoutClient(clientInfo);
        }
        // 서버 세션 체크
        else {
          const serverLoginValid = await this.loginCheckWithClient(clientInfo);
          if (serverLoginValid) {
            console.log(`${clientInfo.name} - Session is valid`);
            return true;
          } else {
            console.log(`${clientInfo.name} - Server session expired`);
            await this.forceLogoutClient(clientInfo);
          }
        }
      }

      // 이미 로그인이 진행 중인 경우 기다림
      if (
        this.clientLoginInProgress.get(clientIndex) &&
        this.clientLoginPromises.has(clientIndex)
      ) {
        console.log(
          `${clientInfo.name} - Login already in progress, waiting for completion`
        );
        return await this.clientLoginPromises.get(clientIndex);
      }

      console.log(`${clientInfo.name} - Starting login process...`);
      this.clientLoginInProgress.set(clientIndex, true);

      // 로그인 Promise 생성 및 저장
      const loginPromise = this.performLoginWithClient(clientInfo);
      this.clientLoginPromises.set(clientIndex, loginPromise);

      const result = await loginPromise;

      if (result) {
        clientInfo.isLoggedIn = true;
        clientInfo.loginTime = Date.now();

        // ⭐ 쿠키 저장
        this.saveCookies(clientIndex, clientInfo.cookieJar);

        console.log(`✅ ${clientInfo.name} 로그인 성공`);
      } else {
        console.log(`❌ ${clientInfo.name} 로그인 실패`);
        await this.forceLogoutClient(clientInfo);
      }

      return result;
    } catch (error) {
      console.error(`❌ ${clientInfo.name} 로그인 과정 실패:`, error.message);
      await this.forceLogoutClient(clientInfo);
      return false;
    } finally {
      // 로그인 상태 정리
      this.clientLoginInProgress.set(clientIndex, false);
      this.clientLoginPromises.delete(clientIndex);
    }
  }

  // 특정 클라이언트 강제 로그아웃 - 쿠키 파일도 삭제
  async forceLogoutClient(clientInfo) {
    const clientIndex = clientInfo.index;
    console.log(`Forcing logout for ${clientInfo.name}...`);

    // 기존 상태 초기화
    this.clientLoginInProgress.set(clientIndex, false);
    this.clientLoginPromises.delete(clientIndex);
    this.clientLastLoginCheck.delete(clientIndex);
    this.clientLastLoginCheckResult.delete(clientIndex);

    // 쿠키 파일 삭제
    const cookiePath = this.getCookieFilePath(clientIndex);
    if (fs.existsSync(cookiePath)) {
      fs.unlinkSync(cookiePath);
      console.log(`🗑️ 쿠키 파일 삭제: ${cookiePath}`);
    }

    // 프록시 매니저를 사용하여 클라이언트 재생성 (새로운 cookieJar 포함)
    const newClientConfig = this.proxyManager.recreateClient(clientIndex);

    // 기존 클라이언트 정보를 새로운 설정으로 대체
    Object.assign(clientInfo, newClientConfig);

    console.log(`Complete session reset completed for ${clientInfo.name}`);
  }

  // 모든 클라이언트 로그인 - 동시 실행 지원
  async loginAllClients(forceLogin = false) {
    console.log("\n=== 모든 클라이언트 로그인 ===");

    // 복원된 세션 검증 먼저 수행
    if (!forceLogin) {
      const validationTasks = this.clients.map(async (clientInfo) => {
        if (clientInfo.cookieJar) {
          // 복원된 쿠키가 있는 경우 검증
          const isValid = await this.loginCheckWithClient(clientInfo);
          if (isValid) {
            clientInfo.isLoggedIn = true;
            clientInfo.loginTime = Date.now();
            console.log(`✅ ${clientInfo.name} - 저장된 세션 유효`);
            return true;
          }
        }
        return false;
      });

      await Promise.all(validationTasks);
    }

    // 로그인이 필요한 클라이언트만 로그인
    const loginTasks = this.clients.map((clientInfo) =>
      this.loginWithClient(clientInfo, forceLogin)
    );

    const results = await Promise.all(loginTasks);

    const successCount = results.filter((result) => result).length;
    console.log(`로그인 완료: ${successCount}/${this.clients.length} 성공`);

    return results;
  }

  // 로그인된 클라이언트 반환
  getLoggedInClients() {
    return this.clients.filter(
      (client) => client.isLoggedIn && this.isSessionValid(client.loginTime)
    );
  }

  // 사용 가능한 클라이언트 반환 (로그인 상태 및 세션 유효성 확인)
  async getAvailableClient() {
    const loggedInClients = this.getLoggedInClients();

    if (loggedInClients.length === 0) {
      console.log(
        "No logged in clients available, attempting to login all clients"
      );
      await this.loginAllClients();
      return this.getLoggedInClients()[0] || null;
    }

    // 라운드 로빈으로 선택
    return this.getNextClient();
  }

  // 강제 로그아웃 - 모든 세션 정보 및 쿠키 파일 초기화
  forceLogout() {
    console.log("Forcing logout and clearing all session data...");

    if (this.useMultipleClients) {
      // 모든 맵 초기화
      this.clientLoginPromises.clear();
      this.clientLoginInProgress.clear();
      this.clientLastLoginCheck.clear();
      this.clientLastLoginCheckResult.clear();

      // 모든 쿠키 파일 삭제
      this.clients.forEach((_, index) => {
        const cookiePath = this.getCookieFilePath(index);
        if (fs.existsSync(cookiePath)) {
          fs.unlinkSync(cookiePath);
        }
      });

      // 프록시 매니저를 사용하여 모든 클라이언트 재생성
      this.clients = this.proxyManager.createAllClients();
      this.currentClientIndex = 0;
    } else {
      // 단일 클라이언트 쿠키 파일 삭제
      const cookiePath = this.getCookieFilePath(0);
      if (fs.existsSync(cookiePath)) {
        fs.unlinkSync(cookiePath);
      }

      // 단일 클라이언트 초기화
      this.cookieJar = new tough.CookieJar();
      this.initializeAxiosClient();

      this.isLoggedIn = false;
      this.loginTime = null;
      this.loginInProgress = false;
      this.loginPromise = null;
    }

    console.log("Complete session data cleared and clients reinitialized");
  }

  // 세션 유효성 검사
  isSessionValid(loginTime = this.loginTime) {
    if (!loginTime) return false;
    return Date.now() - loginTime < this.sessionTimeout;
  }

  // 메인 로그인 메서드 - 통합된 로직
  async login(forceLogin = false) {
    if (this.useMultipleClients) {
      const results = await this.loginAllClients(forceLogin);
      return results.some((result) => result);
    } else {
      // 단일 클라이언트를 clientInfo 형태로 감싸서 loginWithClient 재사용
      const singleClientInfo = {
        index: 0,
        client: this.client,
        cookieJar: this.cookieJar,
        name: "직접연결",
        isLoggedIn: this.isLoggedIn,
        loginTime: this.loginTime,
      };

      const result = await this.loginWithClient(singleClientInfo, forceLogin);

      // 단일 클라이언트 상태 동기화
      this.isLoggedIn = singleClientInfo.isLoggedIn;
      this.loginTime = singleClientInfo.loginTime;
      this.client = singleClientInfo.client;
      this.cookieJar = singleClientInfo.cookieJar;

      return result;
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

    const pattern2 =
      /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)[,\s.-]*(\d{1,2})[,\s.-]*(\d{4})/i;
    const match2 = lowerText.match(pattern2);

    if (match2) {
      const month = monthNames[match2[1]];
      const day = match2[2].padStart(2, "0");
      const year = match2[3];
      return `${year}-${month}-${day} 00:00:00`;
    }

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

    const pattern4 = /(\d{4})[-./](\d{1,2})[-./](\d{1,2})/;
    const match4 = text.match(pattern4);

    if (match4) {
      const year = match4[1];
      const month = match4[2].padStart(2, "0");
      const day = match4[3].padStart(2, "0");
      return `${year}-${month}-${day} 00:00:00`;
    }

    const pattern5 =
      /(\d{1,2})[-./](\d{1,2})[-./](\d{4}).*?(\d{1,2})[：:\s]*(\d{2})/;
    const match5 = text.match(pattern5);

    if (match5) {
      const month = match5[1].padStart(2, "0");
      const day = match5[2].padStart(2, "0");
      const year = match5[3];
      const hour = match5[4].padStart(2, "0");
      const minute = match5[5].padStart(2, "0");
      return `${year}-${month}-${day} ${hour}:${minute}:00`;
    }

    const pattern6 = /(\d{1,2})[-./](\d{1,2})[-./](\d{4})/;
    const match6 = text.match(pattern6);

    if (match6) {
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

  // 경매 시간이 이미 지났는지 확인
  isAuctionTimeValid(scheduledDate) {
    if (!scheduledDate) return false;
    const auctionDate = new Date(scheduledDate + "+09:00");
    const now = new Date();
    return auctionDate > now;
  }
}

module.exports = { AxiosCrawler };
