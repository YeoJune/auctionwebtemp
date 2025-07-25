const cheerio = require("cheerio");
const { AxiosCrawler } = require("./baseCrawler");
const { processImagesInChunks } = require("../utils/processImage");
const FormData = require("form-data");
const tough = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");
const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { HttpProxyAgent } = require("http-proxy-agent");

let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

const starAucConfig = {
  name: "StarAuc",
  baseUrl: "https://www.starbuyers-global-auction.com",
  loginCheckUrls: ["https://www.starbuyers-global-auction.com/home"],
  loginPageUrl: "https://www.starbuyers-global-auction.com/login",
  loginPostUrl: "https://www.starbuyers-global-auction.com/login",
  searchUrl: "https://www.starbuyers-global-auction.com/item",
  loginData: {
    userId: process.env.CRAWLER_EMAIL3,
    password: process.env.CRAWLER_PASSWORD3,
  },
  categoryIds: [1, 2, 3, 5, 6, 7, 8, 9],
  categoryTable: {
    1: "시계",
    2: "귀금속",
    3: "귀금속",
    5: "가방",
    6: "악세서리",
    7: "의류",
    8: "신발",
    9: "기타",
  },
  signinSelectors: {
    userId: "#email",
    password: "#password",
    loginButton: 'button[type="submit"]',
    csrfToken: '[name="csrf-token"]',
  },
  crawlSelectors: {
    paginationLast: ".p-pagination__item:nth-last-child(2) a",
    itemContainer: ".p-item-list__body",
    id: "a[href]",
    title: ".p-text-link",
    image: ".p-item-list__body__cell.-image img",
    rank: ".rank .icon",
    scriptData: "script:contains(window.items)",
  },
  crawlDetailSelectors: {
    images: ".p-item-image__thumb__item img",
    description: ".p-def-list",
    brand: ".p-def-list dt:contains('Brand') + dd",
    lotNo: ".p-def-list dt:contains('Lot Number') + dd",
    accessories: ".p-def-list dt:contains('Accessories') + dd",
    scriptData: "script:contains(window.item_data)",
  },
  searchParams: (categoryId, page) => {
    if (!categoryId) return `?limit=100&page=${page}`;
    else return `?sub_categories%5B0%5D=${categoryId}&limit=100&page=${page}`;
  },
  detailUrl: (itemId) =>
    `https://www.starbuyers-global-auction.com/item/${itemId}`,
};

const starAucValueConfig = {
  name: "StarAucValue",
  baseUrl: "https://www.starbuyers-global-auction.com",
  loginCheckUrls: ["https://www.starbuyers-global-auction.com/home"],
  loginPageUrl: "https://www.starbuyers-global-auction.com/login",
  loginPostUrl: "https://www.starbuyers-global-auction.com/login",
  searchUrl: "https://www.starbuyers-global-auction.com/market_price",
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
    csrfToken: '[name="csrf-token"]',
  },
  crawlSelectors: {
    paginationLast: ".p-pagination__item:nth-last-child(2) a",
    itemContainer: ".p-item-list__body",
    id: "a.p-text-link",
    title: ".p-text-link",
    brand: ".p-text-link",
    rank: ".rank .icon",
    image: ".-image img",
    scheduledDate: "[data-head='Auction Date'] strong",
    finalPrice: "[data-head='Successful bid price'] strong",
    lotNo: ".u-font-size-small:first-child",
    accessoryInfo: "[data-head='Accessories'] .u-font-size-small",
  },
  crawlDetailSelectors: {
    images: ".p-item-image__thumb__item img",
    description: ".p-def-list",
    brand: ".p-def-list dt:contains('Brand') + dd",
    lotNo: ".p-def-list dt:contains('Lot Number') + dd",
    accessories: ".p-def-list dt:contains('Accessories') + dd",
    scriptData: "script:contains(window.item_data)",
  },
  searchParams: (categoryId, page, months = 3) => {
    const today = new Date();
    const pastDate = new Date();
    pastDate.setMonth(today.getMonth() - months);

    const fromDate = pastDate.toISOString().split("T")[0];

    return `?sort=exhibit_date&direction=desc&limit=100&item_category=${categoryId}&page=${page}&exhibit_date_from=${fromDate}`;
  },
  detailUrl: (itemId) =>
    `https://www.starbuyers-global-auction.com/market_price/${itemId}`,
};

class StarAucCrawler extends AxiosCrawler {
  constructor(config) {
    super(config);
    this.config.currentCategoryId = null;
    this.currentBidType = "direct";

    // 라운드 로빈 프록시 설정
    this.proxyIPs = this.loadProxyIPs();
    this.clients = [];
    this.currentClientIndex = 0;

    this.initializeClients();
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
    // 첫 번째: 직접 연결 (기존 AxiosCrawler 방식)
    this.clients.push({
      index: 0,
      name: "직접연결",
      client: this.client, // 부모 클래스의 client 사용
      cookieJar: this.cookieJar,
      isLoggedIn: false,
      loginTime: null,
      useProxy: false,
    });

    // 나머지: 프록시 클라이언트들 (수동 쿠키 관리)
    this.proxyIPs.forEach((ip, index) => {
      const proxyUrl = `http://${ip}:3128`;

      const proxyClient = axios.create({
        httpsAgent: new HttpsProxyAgent(proxyUrl),
        httpAgent: new HttpProxyAgent(proxyUrl),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
          "Accept-Language": "en-US,en;q=0.9",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        },
        maxRedirects: 5,
        timeout: 30000,
        validateStatus: function (status) {
          return status >= 200 && status < 500;
        },
      });

      const cookies = new Map();

      // 수동 쿠키 관리
      proxyClient.interceptors.response.use((response) => {
        const setCookieHeaders = response.headers["set-cookie"];
        if (setCookieHeaders) {
          setCookieHeaders.forEach((cookieString) => {
            const [cookiePair] = cookieString.split(";");
            const [name, value] = cookiePair.split("=");
            if (name && value) {
              cookies.set(name.trim(), value.trim());
            }
          });
        }
        return response;
      });

      proxyClient.interceptors.request.use((config) => {
        const cookieArray = [];
        for (const [name, value] of cookies) {
          cookieArray.push(`${name}=${value}`);
        }
        if (cookieArray.length > 0) {
          config.headers.Cookie = cookieArray.join("; ");
        }
        return config;
      });

      this.clients.push({
        index: index + 1,
        name: `프록시${index + 1}(${ip})`,
        client: proxyClient,
        cookies: cookies,
        isLoggedIn: false,
        loginTime: null,
        useProxy: true,
      });
    });

    console.log(
      `${this.clients.length}개 클라이언트 초기화 완료 (직접 1개 + 프록시 ${this.proxyIPs.length}개)`
    );
  }

  // 라운드 로빈으로 다음 클라이언트 선택
  getNextClient() {
    const client = this.clients[this.currentClientIndex];
    this.currentClientIndex =
      (this.currentClientIndex + 1) % this.clients.length;
    return client;
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

  // 특정 클라이언트로 로그인
  async performLoginWithClient(clientInfo) {
    return this.retryOperation(async () => {
      console.log(`${clientInfo.name} 로그인 중...`);

      // 로그인 페이지 가져오기
      const response = await clientInfo.client.get(this.config.loginPageUrl);

      // CSRF 토큰 추출
      const $ = cheerio.load(response.data);
      const csrfToken = $(this.config.signinSelectors.csrfToken).attr(
        "content"
      );

      if (!csrfToken) {
        throw new Error("CSRF token not found");
      }

      // 폼 데이터 준비
      const formData = new URLSearchParams();
      formData.append("email", this.config.loginData.userId);
      formData.append("password", this.config.loginData.password);
      formData.append("_token", csrfToken);

      // 로그인 요청
      const loginResponse = await clientInfo.client.post(
        this.config.loginPostUrl,
        formData,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: this.config.loginPageUrl,
            "X-CSRF-TOKEN": csrfToken,
          },
          maxRedirects: 5,
          validateStatus: function (status) {
            return status >= 200 && status < 400;
          },
        }
      );

      // 로그인 후 검증
      if (
        loginResponse.status === 200 &&
        (await this.loginCheckWithClient(clientInfo))
      ) {
        return true;
      } else {
        throw new Error("Login verification failed");
      }
    });
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

  isSessionValid(loginTime) {
    if (!loginTime) return false;
    return Date.now() - loginTime < 1000 * 60 * 60 * 3; // 3시간
  }

  // 모든 클라이언트 로그인
  async loginAllClients() {
    console.log("\n=== 모든 클라이언트 로그인 ===");
    for (const clientInfo of this.clients) {
      await this.loginWithClient(clientInfo);
    }
  }

  // 기존 performLogin 오버라이드 (부모 클래스 호환성)
  async performLogin() {
    // 첫 번째 클라이언트(직접 연결)로 로그인
    const directClient = this.clients[0];
    return await this.performLoginWithClient(directClient);
  }

  // Direct bid 메서드 구현 (직접 연결만 사용)
  async directBid(item_id, price) {
    try {
      console.log(
        `Placing direct bid for item ${item_id} with price ${price}...`
      );

      // 로그인 확인 (직접 연결 클라이언트)
      await this.login();

      // 쿠키에서 XSRF 토큰 추출
      const cookies = await this.cookieJar.getCookies(
        "https://www.starbuyers-global-auction.com"
      );
      const xsrfCookie = cookies.find((cookie) => cookie.key === "XSRF-TOKEN");

      if (!xsrfCookie) {
        throw new Error("XSRF token not found in cookies");
      }

      // URL 디코드된 토큰 값 사용
      const xsrfToken = decodeURIComponent(xsrfCookie.value);

      // FormData 생성
      const formData = new FormData();
      formData.append(`bids[${item_id}]`, price.toString());

      // 입찰 요청 (직접 연결 클라이언트 사용)
      const bidResponse = await this.client.post(
        "https://www.starbuyers-global-auction.com/front_api/item/bid",
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            "X-XSRF-TOKEN": xsrfToken,
            Accept: "application/json, text/plain, */*",
            Origin: "https://www.starbuyers-global-auction.com",
            Referer: `https://www.starbuyers-global-auction.com/item/${item_id}`,
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
          },
          validateStatus: function (status) {
            return status >= 200 && status < 400;
          },
        }
      );

      // 응답 처리
      if (bidResponse.status === 200) {
        const responseData = bidResponse.data;

        // 응답 구조 확인
        if (responseData && responseData.status) {
          const result = responseData.results?.find((r) => r.itemId == item_id);

          if (result && !result.isFailed) {
            return {
              success: true,
              message: result.message,
              data: {
                currentBid: result.currentBid,
                highestBid: result.highestBid,
                becameHighestBidder: result.becameHighestBidder,
                endAt: result.endAt,
                timeRemaining: result.timeRemaining,
              },
            };
          } else {
            return {
              success: false,
              message: result?.message || "Bid failed",
              error: result,
            };
          }
        } else {
          console.log("Unexpected response structure:", responseData);
          return {
            success: false,
            message: "Unexpected response format",
            error: responseData,
          };
        }
      } else {
        throw new Error(`Bid request failed with status ${bidResponse.status}`);
      }
    } catch (error) {
      console.error(`Error placing bid for item ${item_id}:`, error.message);

      if (error.response) {
        console.error("Response status:", error.response.status);
        console.error("Response data:", error.response.data);
      }

      return {
        success: false,
        message: "Bid failed",
        error: error.message,
      };
    }
  }

  // 배치 입찰 메서드
  async batchDirectBid(bidItems) {
    try {
      console.log(`Placing batch bid for ${bidItems.length} items...`);

      await this.login();

      const cookies = await this.cookieJar.getCookies(
        "https://www.starbuyers-global-auction.com"
      );
      const xsrfCookie = cookies.find((cookie) => cookie.key === "XSRF-TOKEN");

      if (!xsrfCookie) {
        throw new Error("XSRF token not found in cookies");
      }

      const xsrfToken = decodeURIComponent(xsrfCookie.value);

      // 여러 아이템의 입찰 데이터 생성
      const formData = new FormData();
      bidItems.forEach(({ item_id, price }) => {
        formData.append(`bids[${item_id}]`, price.toString());
      });

      const bidResponse = await this.client.post(
        "https://www.starbuyers-global-auction.com/front_api/item/bid",
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            "X-XSRF-TOKEN": xsrfToken,
            Accept: "application/json, text/plain, */*",
            Origin: "https://www.starbuyers-global-auction.com",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
          },
          validateStatus: function (status) {
            return status >= 200 && status < 400;
          },
        }
      );

      if (bidResponse.status === 200 && bidResponse.data?.status) {
        return {
          success: true,
          results: bidResponse.data.results.map((result) => ({
            item_id: result.itemId,
            success: !result.isFailed,
            message: result.message,
            currentBid: result.currentBid,
            becameHighestBidder: result.becameHighestBidder,
          })),
        };
      } else {
        console.log("Batch bid response:", bidResponse.data);
        return {
          success: false,
          message: "Batch bid failed",
          error: bidResponse.data,
        };
      }
    } catch (error) {
      console.error("Error in batch bid:", error.message);
      if (error.response) {
        console.error("Response status:", error.response.status);
        console.error("Response data:", error.response.data);
      }

      return {
        success: false,
        message: "Batch bid failed",
        error: error.message,
      };
    }
  }

  // 스크립트에서 데이터 파싱
  async parseScriptData(html, selector) {
    const $ = cheerio.load(html);
    const scriptTag = $(selector);

    if (scriptTag.length > 0) {
      try {
        const scriptContent = scriptTag.html();

        // window.items = JSON.parse('...') 패턴 찾기 (목록 페이지)
        let dataMatch = scriptContent.match(
          /window\.items\s*=\s*JSON\.parse\('(.+?)'\)/s
        );

        if (dataMatch && dataMatch[1]) {
          const jsonString = dataMatch[1]
            .replace(/\\u0022/g, '"')
            .replace(/\\\//g, "/")
            .replace(/\\n/g, "\n")
            .replace(/\\'/g, "'")
            .replace(/\\\\/g, "\\");

          try {
            return JSON.parse(jsonString);
          } catch (error) {
            console.error("JSON 파싱 실패:", error);
            return null;
          }
        }

        // window.item_data = {...} 패턴 찾기 (상세 페이지)
        dataMatch = scriptContent.match(
          /window\.item_data\s*=\s*(\{[\s\S]+?\})\s*window\.api/s
        );
        if (!dataMatch) {
          dataMatch = scriptContent.match(
            /window\.item_data\s*=\s*(\{[\s\S]+?\})/s
          );
        }

        if (dataMatch && dataMatch[1]) {
          let objectLiteral = dataMatch[1].trim();

          const jsonParseMatches = objectLiteral.match(
            /JSON\.parse\('(.+?)'\)/g
          );
          if (jsonParseMatches) {
            for (const jsonParseMatch of jsonParseMatches) {
              try {
                const innerMatch = jsonParseMatch.match(
                  /JSON\.parse\('(.+?)'\)/
                );
                if (innerMatch && innerMatch[1]) {
                  const innerJsonString = innerMatch[1]
                    .replace(/\\u0022/g, '"')
                    .replace(/\\\//g, "/")
                    .replace(/\\n/g, "\n")
                    .replace(/\\'/g, "'")
                    .replace(/\\\\/g, "\\");

                  const parsedValue = JSON.parse(innerJsonString);
                  objectLiteral = objectLiteral.replace(
                    jsonParseMatch,
                    JSON.stringify(parsedValue)
                  );
                }
              } catch (error) {
                console.error("중첩 JSON 파싱 실패:", error);
              }
            }
          }

          try {
            objectLiteral = objectLiteral.replace(/`([^`]*)`/g, '""');
            const dataObj = eval(`(${objectLiteral})`);
            return dataObj;
          } catch (error) {
            console.error("객체 리터럴 파싱 실패:", error);
          }
        }
      } catch (error) {
        console.error("스크립트 데이터 파싱 오류:", error);
      }
    } else {
      console.log("스크립트 데이터를 찾을 수 없음:", selector);
    }

    return null;
  }

  async getTotalPages(categoryId) {
    const clientInfo = this.getNextClient();
    await this.loginWithClient(clientInfo);

    return this.retryOperation(async () => {
      const url =
        this.config.searchUrl + this.config.searchParams(categoryId, 1);

      const response = await clientInfo.client.get(url);
      const $ = cheerio.load(response.data);

      const paginationExists =
        $(this.config.crawlSelectors.paginationLast).length > 0;

      if (paginationExists) {
        try {
          const lastPageNumber = $(this.config.crawlSelectors.paginationLast)
            .text()
            .trim();
          return parseInt(lastPageNumber, 10);
        } catch (error) {
          console.error("페이지 번호 추출 실패:", error);
        }
      }

      try {
        const scriptData = await this.parseScriptData(
          response.data,
          this.config.crawlSelectors.scriptData
        );

        if (scriptData && scriptData.last_page) {
          return scriptData.last_page;
        }
      } catch (error) {
        console.error("스크립트에서 페이지 정보 추출 실패:", error);
      }

      const itemExists = $(this.config.crawlSelectors.itemContainer).length > 0;
      return itemExists ? 1 : 0;
    });
  }

  filterHandles($, scriptItems, existingIds) {
    const filteredScriptItems = [];
    const remainItems = [];

    if (!scriptItems || !scriptItems.data || !Array.isArray(scriptItems.data)) {
      console.error("스크립트 아이템 데이터가 유효하지 않음");
      return [[], [], []];
    }

    for (const item of scriptItems.data) {
      const itemId = item.id.toString();
      const scheduledDate = item.endAt || item.ended_at || null;
      const parsedDate = this.extractDate(scheduledDate);

      if (existingIds.has(itemId)) {
        remainItems.push({ item_id: itemId });
      } else {
        filteredScriptItems.push({
          item_id: itemId,
          scheduled_date: parsedDate,
          scriptData: item,
        });
      }
    }
    return [filteredScriptItems, remainItems];
  }

  async crawlPage(categoryId, page, existingIds = new Set()) {
    const clientInfo = this.getNextClient();
    await this.loginWithClient(clientInfo);

    return this.retryOperation(async () => {
      console.log(
        `Crawling page ${page} in category ${categoryId} with ${clientInfo.name}...`
      );
      const url =
        this.config.searchUrl + this.config.searchParams(categoryId, page);

      const response = await clientInfo.client.get(url);
      const $ = cheerio.load(response.data);

      const scriptData = await this.parseScriptData(
        response.data,
        this.config.crawlSelectors.scriptData
      );

      if (!scriptData) {
        console.error("페이지에서 스크립트 데이터를 추출할 수 없음");
        return [];
      }

      const [filteredItems, remainItems] = this.filterHandles(
        $,
        scriptData,
        existingIds
      );

      if (filteredItems.length === 0) {
        console.log("필터링 후 처리할 아이템이 없음");
        return remainItems;
      }

      const pageItems = filteredItems
        .map((item) => this.extractItemInfo($, item))
        .filter((item) => item !== null);

      console.log(
        `${pageItems.length}개 아이템 추출 완료, 페이지 ${page} (${clientInfo.name})`
      );

      const processedItems = await processImagesInChunks(
        pageItems,
        "products",
        3
      );

      return [...processedItems, ...remainItems];
    });
  }

  extractItemInfo($, item) {
    const scriptData = item.scriptData;
    const title = this.removeLeadingBrackets(scriptData.name);
    const original_scheduled_date = item.scheduled_date;
    const scheduled_date = original_scheduled_date;

    const result = {
      item_id: item.item_id,
      original_scheduled_date: original_scheduled_date,
      scheduled_date: scheduled_date,
      original_title: scriptData.name,
      title: title,
      brand: title.split(" ")[0],
      rank: scriptData.fixRank?.replace(/\\uff/g, ""),
      starting_price: parseInt(scriptData.startingPrice, 10),
      image: scriptData.thumbnailUrl,
      category: this.config.categoryTable[this.config.currentCategoryId],
      bid_type: "direct",
      auc_num: "3",
      lotNo: scriptData.lotNo,
      kaijoCd: 0,
      kaisaiKaisu: 0,
    };

    if (scriptData.currentBiddingPrice) {
      result.current_price = parseInt(scriptData.currentBiddingPrice, 10);
    }

    return result;
  }

  async crawlItemDetails(itemId) {
    const clientInfo = this.getNextClient();
    await this.loginWithClient(clientInfo);

    return this.retryOperation(async () => {
      console.log(
        `Crawling details for item ${itemId} with ${clientInfo.name}...`
      );
      const url = this.config.detailUrl(itemId);

      const response = await clientInfo.client.get(url);
      const $ = cheerio.load(response.data);

      const scriptData = await this.parseScriptData(
        response.data,
        this.config.crawlDetailSelectors.scriptData
      );

      if (!scriptData) {
        console.error("상세 페이지에서 스크립트 데이터를 추출할 수 없음");
        return { description: "-" };
      }

      let images = [];
      if (scriptData.image_urls) {
        if (Array.isArray(scriptData.image_urls)) {
          images = scriptData.image_urls;
        }
      }

      if (images.length === 0) {
        $(this.config.crawlDetailSelectors.images).each((i, element) => {
          const src = $(element).attr("src");
          if (src) images.push(src);
        });
      }

      const brand =
        $(this.config.crawlDetailSelectors.brand).text().trim() ||
        (scriptData.name ? scriptData.name.split(" ")[0] : "");

      const accessories = $(this.config.crawlDetailSelectors.accessories)
        .text()
        .trim();

      let description = "";
      const $dl = $(this.config.crawlDetailSelectors.description);

      $dl.each((i, element) => {
        let sectionDesc = "";
        $(element)
          .children()
          .each((j, child) => {
            if ($(child).prop("tagName") === "DT") {
              const term = $(child).text().trim();
              if (
                !term.startsWith("Other Condition") &&
                !term.includes("Brand") &&
                !term.includes("Lot Number") &&
                !term.includes("Accessories")
              ) {
                const descItem = $(child).next("dd").text().trim();
                sectionDesc += `${term}: ${descItem}\n`;
              }
            }
          });

        if (sectionDesc) {
          description += sectionDesc + "\n";
        }
      });

      const result = {
        additional_images: JSON.stringify(images),
        brand: brand || "",
        description: description || "-",
        accessory_code: accessories || "",
        lot_no: scriptData.lot_no || "",
      };

      return result;
    });
  }

  async crawlAllItems(existingIds = new Set()) {
    try {
      const startTime = Date.now();
      console.log(`Starting StarAuc crawl at ${new Date().toISOString()}`);

      await this.loginAllClients();

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
        `Operation completed in ${this.formatExecutionTime(executionTime)}`
      );

      return allCrawledItems;
    } catch (error) {
      console.error("Crawl failed:", error);
      return [];
    }
  }

  async crawlUpdates() {
    try {
      const limit = pLimit(3);
      const startTime = Date.now();
      console.log(
        `Starting StarAuc updates crawl at ${new Date().toISOString()}`
      );

      await this.loginAllClients();

      const allCrawledItems = [];

      console.log(`Starting update crawl for Update`);

      const totalPages = await this.getTotalPages(null);
      console.log(`Total pages: ${totalPages}`);

      const pagePromises = [];
      for (let page = 1; page <= totalPages; page++) {
        pagePromises.push(
          limit(async () => {
            console.log(`Crawling update page ${page} of ${totalPages}`);
            return await this.crawlUpdatePage(page);
          })
        );
      }

      const pageResults = await Promise.all(pagePromises);

      pageResults.forEach((pageItems) => {
        if (pageItems && pageItems.length > 0) {
          allCrawledItems.push(...pageItems);
        }
      });

      console.log(`Total update items processed: ${allCrawledItems.length}`);

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      console.log(
        `StarAuc update crawl operation completed in ${this.formatExecutionTime(
          executionTime
        )}`
      );

      return allCrawledItems;
    } catch (error) {
      console.error("StarAuc update crawl failed:", error.message);
      return [];
    }
  }

  async crawlUpdatePage(page) {
    const clientInfo = this.getNextClient();
    await this.loginWithClient(clientInfo);

    return this.retryOperation(async () => {
      console.log(`Crawling update page ${page} with ${clientInfo.name}`);
      const url = this.config.searchUrl + this.config.searchParams(null, page);

      const response = await clientInfo.client.get(url);

      const scriptData = await this.parseScriptData(
        response.data,
        this.config.crawlSelectors.scriptData
      );

      if (!scriptData || !scriptData.data) {
        console.log(`No script data found on page ${page}`);
        return [];
      }

      const updateItems = [];

      for (const item of scriptData.data) {
        const updateItem = this.extractUpdateItemInfo(item);
        if (updateItem) {
          updateItems.push(updateItem);
        }
      }

      console.log(
        `Processed ${updateItems.length} update items from page ${page} (${clientInfo.name})`
      );
      return updateItems;
    });
  }

  extractUpdateItemInfo(scriptData) {
    try {
      const itemId = scriptData.id.toString();
      const currentPrice =
        scriptData.currentBiddingPrice || scriptData.startingPrice || 0;
      const scheduledDate = this.extractDate(
        scriptData.endAt || scriptData.ended_at
      );

      return {
        item_id: itemId,
        starting_price: parseInt(currentPrice, 10),
        scheduled_date: scheduledDate,
      };
    } catch (error) {
      console.error("Error extracting update item info:", error);
      return null;
    }
  }

  async crawlUpdateWithId(itemId) {
    const clientInfo = this.getNextClient();
    await this.loginWithClient(clientInfo);

    return this.retryOperation(async () => {
      console.log(
        `Crawling update info for item ${itemId} with ${clientInfo.name}...`
      );

      const url = this.config.detailUrl(itemId);
      const response = await clientInfo.client.get(url);

      const scriptData = await this.parseScriptData(
        response.data,
        this.config.crawlDetailSelectors.scriptData
      );

      if (!scriptData) {
        throw new Error(`No script data found for item ${itemId}`);
      }

      let currentPrice = 0;
      if (scriptData.current_bidding_price > currentPrice)
        currentPrice = scriptData.current_bidding_price;
      if (scriptData.starting_price > currentPrice)
        currentPrice = scriptData.starting_price;
      const scheduledDate = this.extractDate(
        scriptData.endAt || scriptData.ended_at
      );

      return {
        item_id: itemId,
        starting_price: parseInt(currentPrice, 10),
        scheduled_date: scheduledDate,
      };
    });
  }

  async crawlUpdateWithIds(itemIds) {
    try {
      console.log(`Starting update crawl for ${itemIds.length} items...`);

      await this.loginAllClients();

      const results = [];
      const limit = pLimit(3);

      const promises = itemIds.map((itemId) =>
        limit(async () => {
          try {
            const result = await this.crawlUpdateWithId(itemId);
            if (result) {
              results.push(result);
            }
            return result;
          } catch (error) {
            console.error(
              `Error crawling update for item ${itemId}:`,
              error.message
            );
            return null;
          }
        })
      );

      await Promise.all(promises);

      console.log(`Update crawl completed for ${results.length} items`);
      return results;
    } catch (error) {
      console.error("Update crawl with IDs failed:", error.message);
      return [];
    }
  }

  async crawlInvoices() {
    try {
      console.log("Starting to crawl Star Auction invoices...");

      await this.login();

      const url = "https://www.starbuyers-global-auction.com/purchase_report";
      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);

      const invoiceElements = $(".p-item-list__body");
      console.log(`Found ${invoiceElements.length} invoice records`);

      if (invoiceElements.length === 0) {
        console.log("No invoice records found");
        return [];
      }

      const invoices = [];

      invoiceElements.each((index, element) => {
        const $element = $(element);

        const issueDateText = $element
          .find('[data-head="Issue date"]')
          .text()
          .trim();
        const date = this.extractDate(issueDateText);

        const billingCategory = $element
          .find('[data-head="Billing category"]')
          .text()
          .trim();

        const amountText = $element
          .find(
            '[data-head="Successful bid total price / Amount"] p:first-child'
          )
          .text()
          .trim();
        const amount = this.currencyToInt(amountText);

        const status = "paid";

        const category = $element.find('[data-head="Category"]').text().trim();

        const detailLink = $element
          .find("a.p-text-link, a.p-button-small")
          .attr("href");
        const reportId = detailLink ? detailLink.split("/").pop() : null;

        const auc_num = "3";

        invoices.push({
          date,
          auc_num,
          status,
          amount,
          category,
          report_id: reportId,
        });
      });

      console.log(`Successfully processed ${invoices.length} invoices`);
      return invoices;
    } catch (error) {
      console.error("Error crawling Star Auction invoices:", error);
      return [];
    }
  }
}

class StarAucValueCrawler extends AxiosCrawler {
  constructor(config) {
    super(config);
    this.config.currentCategoryId = null; // 현재 크롤링 중인 카테고리 ID
  }

  async performLogin() {
    return this.retryOperation(async () => {
      console.log("Logging in to Star Auction Value...");

      // 로그인 페이지 가져오기
      const response = await this.client.get(this.config.loginPageUrl);

      // CSRF 토큰 추출
      const $ = cheerio.load(response.data);
      const csrfToken = $(this.config.signinSelectors.csrfToken).attr(
        "content"
      );

      if (!csrfToken) {
        throw new Error("CSRF token not found");
      }

      // 폼 데이터 준비
      const formData = new URLSearchParams();
      formData.append("email", this.config.loginData.userId);
      formData.append("password", this.config.loginData.password);
      formData.append("_token", csrfToken);

      // 로그인 요청
      const loginResponse = await this.client.post(
        this.config.loginPostUrl,
        formData,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: this.config.loginPageUrl,
            "X-CSRF-TOKEN": csrfToken,
          },
          maxRedirects: 5,
          validateStatus: function (status) {
            return status >= 200 && status < 400;
          },
        }
      );

      // 로그인 후 검증
      if (loginResponse.status === 200 && (await this.loginCheck())) {
        return true;
      } else {
        throw new Error("Login verification failed");
      }
    });
  }

  // 스크립트에서 데이터 파싱
  async parseScriptData(html, selector) {
    const $ = cheerio.load(html);
    const scriptTag = $(selector);

    if (scriptTag.length > 0) {
      try {
        const scriptContent = scriptTag.html();

        // window.item_data = {...} 패턴 찾기 (상세 페이지)
        let dataMatch = scriptContent.match(
          /window\.item_data\s*=\s*(\{[\s\S]+?\})\s*window\.api/s
        );
        if (!dataMatch) {
          dataMatch = scriptContent.match(
            /window\.item_data\s*=\s*(\{[\s\S]+?\})/s
          );
        }

        if (dataMatch && dataMatch[1]) {
          // 객체 리터럴 텍스트에서 중첩된 JSON.parse 처리
          let objectLiteral = dataMatch[1].trim();

          // JSON.parse 문자열 찾아서 처리
          const jsonParseMatches = objectLiteral.match(
            /JSON\.parse\('(.+?)'\)/g
          );
          if (jsonParseMatches) {
            for (const jsonParseMatch of jsonParseMatches) {
              try {
                // 원본 JSON.parse 문자열 추출
                const innerMatch = jsonParseMatch.match(
                  /JSON\.parse\('(.+?)'\)/
                );
                if (innerMatch && innerMatch[1]) {
                  // 이스케이프된 문자 처리
                  const innerJsonString = innerMatch[1]
                    .replace(/\\u0022/g, '"')
                    .replace(/\\\//g, "/")
                    .replace(/\\n/g, "\n")
                    .replace(/\\'/g, "'")
                    .replace(/\\\\/g, "\\");

                  // 중첩된 JSON 파싱
                  const parsedValue = JSON.parse(innerJsonString);
                  // 원본 JSON.parse 문을 파싱된 값의 문자열로 대체
                  objectLiteral = objectLiteral.replace(
                    jsonParseMatch,
                    JSON.stringify(parsedValue)
                  );
                }
              } catch (error) {
                console.error("중첩 JSON 파싱 실패:", error);
              }
            }
          }

          try {
            // 백틱으로 둘러싸인 문자열 처리 (memo 등)
            objectLiteral = objectLiteral.replace(/`([^`]*)`/g, '""');

            // 전체 객체 파싱
            const dataObj = eval(`(${objectLiteral})`);
            return dataObj;
          } catch (error) {
            console.error("객체 리터럴 파싱 실패:", error);
          }
        }
      } catch (error) {
        console.error("스크립트 데이터 파싱 오류:", error);
      }
    } else {
      console.log("스크립트 데이터를 찾을 수 없음:", selector);
    }

    return null;
  }

  async getTotalPages(categoryId, months = 3) {
    return this.retryOperation(async () => {
      const url =
        this.config.searchUrl + this.config.searchParams(categoryId, 1, months);

      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);

      // 방법 1: HTML에서 pagination 요소 찾기
      const paginationExists =
        $(this.config.crawlSelectors.paginationLast).length > 0;

      if (paginationExists) {
        try {
          const lastPageNumber = $(this.config.crawlSelectors.paginationLast)
            .text()
            .trim();
          return parseInt(lastPageNumber, 10);
        } catch (error) {
          console.error("페이지 번호 추출 실패:", error);
        }
      }

      // 페이지 정보를 찾지 못한 경우, 아이템이 있으면 최소 1페이지로 계산
      const itemExists = $(this.config.crawlSelectors.itemContainer).length > 0;
      return itemExists ? 1 : 0;
    });
  }

  async crawlPage(categoryId, page, existingIds = new Set(), months = 3) {
    return this.retryOperation(async () => {
      console.log(`Crawling page ${page} in category ${categoryId}...`);
      const url =
        this.config.searchUrl +
        this.config.searchParams(categoryId, page, months);

      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);

      // 아이템 컨테이너 선택
      const itemElements = $(this.config.crawlSelectors.itemContainer);
      console.log(`Found ${itemElements.length} items on page ${page}`);

      if (itemElements.length === 0) {
        return [];
      }

      // 페이지 아이템 추출
      const pageItems = [];
      itemElements.each((index, element) => {
        const item = this.extractItemInfo($, $(element), existingIds);
        if (item && !existingIds.has(item.item_id)) {
          pageItems.push(item);
        }
      });

      console.log(`Extracted ${pageItems.length} items from page ${page}`);

      // 이미지 처리
      const processedItems = await processImagesInChunks(
        pageItems,
        "values",
        3
      );

      return processedItems;
    });
  }

  extractItemInfo($, element, existingIds) {
    try {
      // 아이템 ID 추출 (URL에서 마지막 부분)
      const $id = element.find(this.config.crawlSelectors.id);
      const href = $id.attr("href") || "";
      const itemId = href.split("/").pop();

      if (!itemId || existingIds.has(itemId)) {
        return null;
      }

      // 제목 추출
      const title = $id.text().trim();

      // 브랜드 추출 (제목의 첫 번째 단어로 추정)
      const brand = title.split(" ")[0];

      // Lot 번호 추출
      const lotNo = element
        .find(this.config.crawlSelectors.lotNo)
        .text()
        .trim();

      // 등급 추출
      const $rank = element.find(this.config.crawlSelectors.rank);
      const rank = $rank.attr("data-rank") || $rank.text().trim();

      // 최종 가격 추출
      const finalPriceText = element
        .find(this.config.crawlSelectors.finalPrice)
        .text()
        .trim();
      const finalPrice = this.currencyToInt(
        finalPriceText.replace("yen", "").trim()
      );

      // 이미지 URL 추출
      const $image = element.find(this.config.crawlSelectors.image);
      const image = $image.attr("src");

      // 경매 날짜 추출
      const scheduledDateText = element
        .find(this.config.crawlSelectors.scheduledDate)
        .text()
        .trim();
      const scheduledDate = this.extractDate(scheduledDateText);

      // 부속품 정보 추출
      const accessoryInfo = element
        .find(this.config.crawlSelectors.accessoryInfo)
        .text()
        .trim();

      // 결과 객체 생성
      return {
        item_id: itemId,
        original_title: title,
        title: this.removeLeadingBrackets(title),
        brand: brand,
        rank: rank,
        lot_no: lotNo,
        final_price: finalPrice,
        image: image,
        scheduled_date: scheduledDate,
        accessory_info: accessoryInfo,
        category: this.config.categoryTable[this.config.currentCategoryId],
        auc_num: "3", // StarAuc 고유 번호
      };
    } catch (error) {
      console.error("아이템 정보 추출 실패:", error);
      return null;
    }
  }

  async crawlItemDetails(itemId) {
    return this.retryOperation(async () => {
      console.log(`Crawling details for item ${itemId}...`);
      await this.login();
      const url = this.config.detailUrl(itemId);

      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);

      // 스크립트 데이터 추출
      const scriptData = await this.parseScriptData(
        response.data,
        this.config.crawlDetailSelectors.scriptData
      );

      // 이미지 추출
      let images = [];

      // 스크립트 데이터에서 이미지 URL 가져오기
      if (
        scriptData &&
        scriptData.image_urls &&
        Array.isArray(scriptData.image_urls)
      ) {
        images = scriptData.image_urls;
      }

      // 스크립트에서 이미지를 가져오지 못한 경우 HTML에서 추출
      if (images.length === 0) {
        $(this.config.crawlDetailSelectors.images).each((i, element) => {
          const src = $(element).attr("src");
          if (src) images.push(src);
        });
      }

      // 브랜드 추출
      const brand = $(this.config.crawlDetailSelectors.brand).text().trim();

      // Lot 번호 추출
      const lotNo = $(this.config.crawlDetailSelectors.lotNo).text().trim();

      // 부속품 정보 추출
      const accessories = $(this.config.crawlDetailSelectors.accessories)
        .text()
        .trim();

      // 상세 설명 추출
      let description = "";
      const $dl = $(this.config.crawlDetailSelectors.description);

      $dl.each((i, element) => {
        $(element)
          .children()
          .each((j, child) => {
            if ($(child).prop("tagName") === "DT") {
              const term = $(child).text().trim();
              if (
                !term.includes("Brand") &&
                !term.includes("Lot Number") &&
                !term.includes("Accessories")
              ) {
                const descItem = $(child).next("dd").text().trim();
                description += `${term}: ${descItem}\n`;
              }
            }
          });
      });

      return {
        additional_images: JSON.stringify(images),
        brand: brand || "",
        description: description || "-",
        accessory_code: accessories || "",
        lot_no: lotNo || "",
      };
    });
  }

  async crawlAllItems(existingIds = new Set(), months = 3) {
    try {
      const startTime = Date.now();
      console.log(`Starting StarAucValue crawl at ${new Date().toISOString()}`);
      console.log(`Crawling data for the last ${months} months`);

      // 로그인
      await this.login();

      const allCrawledItems = [];

      // 모든 카테고리 순회
      for (const categoryId of this.config.categoryIds) {
        const categoryItems = [];

        console.log(`Starting crawl for category ${categoryId}`);
        this.config.currentCategoryId = categoryId;

        const totalPages = await this.getTotalPages(categoryId, months);
        console.log(`Total pages in category ${categoryId}: ${totalPages}`);

        // 모든 페이지 크롤링
        for (let page = 1; page <= totalPages; page++) {
          const pageItems = await this.crawlPage(
            categoryId,
            page,
            existingIds,
            months
          );
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
        `Operation completed in ${this.formatExecutionTime(executionTime)}`
      );

      return allCrawledItems;
    } catch (error) {
      console.error("Crawl failed:", error);
      return [];
    }
  }
}

const starAucCrawler = new StarAucCrawler(starAucConfig);
const starAucValueCrawler = new StarAucValueCrawler(starAucValueConfig);

module.exports = { starAucCrawler, starAucValueCrawler };
