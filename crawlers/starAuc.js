const cheerio = require("cheerio");
const { AxiosCrawler } = require("./baseCrawler");
const { processImagesInChunks } = require("../utils/processImage");

const starAucConfig = {
  name: "StarAuc",
  baseUrl: "https://www.starbuyers-global-auction.com",
  loginCheckUrl: "https://www.starbuyers-global-auction.com/home", // 로그인 체크 URL
  loginPageUrl: "https://www.starbuyers-global-auction.com/login",
  loginPostUrl: "https://www.starbuyers-global-auction.com/login", // POST 요청 URL
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
  searchParams: (categoryId, page) =>
    `?sub_categories%5B0%5D=${categoryId}&limit=100&page=${page}`,
  detailUrl: (itemId) =>
    `https://www.starbuyers-global-auction.com/item/${itemId}`,
};

const starAucValueConfig = {
  name: "StarAucValue",
  baseUrl: "https://www.starbuyers-global-auction.com",
  loginCheckUrl: "https://www.starbuyers-global-auction.com/home", // 로그인 체크 URL
  loginPageUrl: "https://www.starbuyers-global-auction.com/login",
  loginPostUrl: "https://www.starbuyers-global-auction.com/login", // POST 요청 URL
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
  searchParams: (categoryId, page) =>
    `?sub_categories%5B0%5D=${categoryId}&limit=100&page=${page}`,
  detailUrl: (itemId) =>
    `https://www.starbuyers-global-auction.com/item/${itemId}`,
};

class StarAucCrawler extends AxiosCrawler {
  constructor(config) {
    super(config);
    this.config.currentCategoryId = null; // 현재 크롤링 중인 카테고리 ID
    this.currentBidType = "live"; // StarAuc는 전체가 'live'
  }

  async login() {
    // 부모 클래스(AxiosCrawler)의 login 메서드 호출
    // 이미 로그인 되어있는지, 다른 로그인 진행중인지 등을 체크
    const shouldContinue = await super.login();

    // 부모 메서드에서 이미 로그인 되어있다고 판단되면 종료
    if (shouldContinue === true) {
      return true;
    }

    // 다른 로그인 진행중이면 해당 Promise를 반환
    if (shouldContinue instanceof Promise) {
      return shouldContinue;
    }

    // 실제 로그인 로직 구현
    this.loginPromise = this.retryOperation(async () => {
      try {
        console.log("Logging in to Star Auction...");

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
              return status >= 200 && status < 400; // 300-399 리다이렉트 허용
            },
          }
        );

        // 로그인 후 검증
        if (loginResponse.status === 200 && (await this.loginCheck())) {
          console.log("Login successful");
          this.isLoggedIn = true;
          this.loginTime = Date.now();
          return true;
        } else {
          throw new Error("Login failed");
        }
      } finally {
        // 성공 또는 실패 상관없이 로그인 Lock 해제
        this.loginInProgress = false;
      }
    });

    return this.loginPromise;
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
          // 이스케이프된 문자 한번에 처리
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

  async getTotalPages(categoryId) {
    return this.retryOperation(async () => {
      const url =
        this.config.searchUrl + this.config.searchParams(categoryId, 1);

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

      // 방법 2: 스크립트 데이터에서 총 페이지 수 가져오기
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

      // 페이지 정보를 찾지 못한 경우, 아이템이 있으면 최소 1페이지로 계산
      const itemExists = $(this.config.crawlSelectors.itemContainer).length > 0;
      return itemExists ? 1 : 0;
    });
  }

  filterHandles($, scriptItems, existingIds) {
    // 스크립트 데이터에서 아이템 ID와 날짜 추출
    const filteredScriptItems = [];
    const remainItems = [];

    if (!scriptItems || !scriptItems.data || !Array.isArray(scriptItems.data)) {
      console.error("스크립트 아이템 데이터가 유효하지 않음");
      return [[], [], []];
    }

    for (const item of scriptItems.data) {
      const itemId = item.id.toString();

      // 스크립트에서 날짜 정보 가져오기 (endAt 또는 ended_at 필드)
      const scheduledDate = item.endAt || item.ended_at || null;
      const parsedDate = this.extractDate(scheduledDate);

      if (existingIds.has(itemId)) {
        remainItems.push({ item_id: itemId });
      } else {
        filteredScriptItems.push({
          item_id: itemId,
          scheduled_date: parsedDate,
          scriptData: item, // 스크립트 데이터 전체 보존
        });
      }
    }
    return [filteredScriptItems, remainItems];
  }

  async crawlPage(categoryId, page, existingIds = new Set()) {
    return this.retryOperation(async () => {
      console.log(`Crawling page ${page} in category ${categoryId}...`);
      const url =
        this.config.searchUrl + this.config.searchParams(categoryId, page);

      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);

      // 스크립트 데이터에서 아이템 정보 추출
      const scriptData = await this.parseScriptData(
        response.data,
        this.config.crawlSelectors.scriptData
      );

      if (!scriptData) {
        console.error("페이지에서 스크립트 데이터를 추출할 수 없음");
        return [];
      }

      // 필터링 - 이미 존재하는 아이템 제외
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

      console.log(`${pageItems.length}개 아이템 추출 완료, 페이지 ${page}`);

      const processedItems = await processImagesInChunks(pageItems);

      return [...processedItems, ...remainItems];
    });
  }

  extractItemInfo($, item) {
    const scriptData = item.scriptData;
    const title = this.removeLeadingBrackets(scriptData.name);

    // 원래 날짜 정보 보존
    const original_scheduled_date = item.scheduled_date;

    // live 경매에 맞게 전날 18:00로 설정
    const scheduled_date = this.getPreviousDayAt18(original_scheduled_date);

    // 이미 지난 경매는 필터링
    if (!this.isAuctionTimeValid(scheduled_date)) {
      return null;
    }

    // 기본 정보 추출
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
      bid_type: this.currentBidType, // 'live'로 고정
      auc_num: "3",
      lotNo: scriptData.lotNo,

      kaijoCd: 0,
      kaisaiKaisu: 0,
    };

    // 현재 입찰가가 있으면 추가
    if (scriptData.currentBiddingPrice) {
      result.current_price = parseInt(scriptData.currentBiddingPrice, 10);
    }

    return result;
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

      if (!scriptData) {
        console.error("상세 페이지에서 스크립트 데이터를 추출할 수 없음");
        return { description: "-" };
      }

      // image_urls 필드 처리
      let images = [];
      if (scriptData.image_urls) {
        // 이미 파싱된 배열인 경우
        if (Array.isArray(scriptData.image_urls)) {
          images = scriptData.image_urls;
        }
      }

      // 백업: 이미지를 찾지 못한 경우 HTML에서 추출
      if (images.length === 0) {
        $(this.config.crawlDetailSelectors.images).each((i, element) => {
          const src = $(element).attr("src");
          if (src) images.push(src);
        });
      }

      // 브랜드 추출
      const brand =
        $(this.config.crawlDetailSelectors.brand).text().trim() ||
        (scriptData.name ? scriptData.name.split(" ")[0] : "");

      // 부속품 정보 추출
      const accessories = $(this.config.crawlDetailSelectors.accessories)
        .text()
        .trim();

      // 세부 설명 추출 - 모든 설명 항목을 수집
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

      // 로그인
      await this.login();

      const allCrawledItems = [];

      // 모든 카테고리 순회
      for (const categoryId of this.config.categoryIds) {
        const categoryItems = [];

        console.log(`Starting crawl for category ${categoryId}`);
        this.config.currentCategoryId = categoryId;

        const totalPages = await this.getTotalPages(categoryId);
        console.log(`Total pages in category ${categoryId}: ${totalPages}`);

        // 모든 페이지 크롤링
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
}

class StarAucValueCrawler extends AxiosCrawler {
  constructor(config) {
    super(config);
    this.config.currentCategoryId = null; // 현재 크롤링 중인 카테고리 ID
  }

  async login() {
    // 부모 클래스(AxiosCrawler)의 login 메서드 호출
    // 이미 로그인 되어있는지, 다른 로그인 진행중인지 등을 체크
    const shouldContinue = await super.login();

    // 부모 메서드에서 이미 로그인 되어있다고 판단되면 종료
    if (shouldContinue === true) {
      return true;
    }

    // 다른 로그인 진행중이면 해당 Promise를 반환
    if (shouldContinue instanceof Promise) {
      return shouldContinue;
    }

    // 실제 로그인 로직 구현
    this.loginPromise = this.retryOperation(async () => {
      try {
        console.log("Logging in to Star Auction...");

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
              return status >= 200 && status < 400; // 300-399 리다이렉트 허용
            },
          }
        );

        // 로그인 후 검증
        if (loginResponse.status === 200 && (await this.loginCheck())) {
          console.log("Login successful");
          this.isLoggedIn = true;
          this.loginTime = Date.now();
          return true;
        } else {
          throw new Error("Login failed");
        }
      } finally {
        // 성공 또는 실패 상관없이 로그인 Lock 해제
        this.loginInProgress = false;
      }
    });

    return this.loginPromise;
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
          // 이스케이프된 문자 한번에 처리
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

  async getTotalPages(categoryId) {
    return this.retryOperation(async () => {
      const url =
        this.config.searchUrl + this.config.searchParams(categoryId, 1);

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

      // 방법 2: 스크립트 데이터에서 총 페이지 수 가져오기
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

      // 페이지 정보를 찾지 못한 경우, 아이템이 있으면 최소 1페이지로 계산
      const itemExists = $(this.config.crawlSelectors.itemContainer).length > 0;
      return itemExists ? 1 : 0;
    });
  }

  filterHandles($, scriptItems, existingIds) {
    // 스크립트 데이터에서 아이템 ID와 날짜 추출
    const filteredScriptItems = [];
    const remainItems = [];

    if (!scriptItems || !scriptItems.data || !Array.isArray(scriptItems.data)) {
      console.error("스크립트 아이템 데이터가 유효하지 않음");
      return [[], [], []];
    }

    for (const item of scriptItems.data) {
      const itemId = item.id.toString();

      // 스크립트에서 날짜 정보 가져오기 (endAt 또는 ended_at 필드)
      const scheduledDate = item.endAt || item.ended_at || null;
      const parsedDate = this.extractDate(scheduledDate);

      if (existingIds.has(itemId)) {
        remainItems.push({ item_id: itemId });
      } else {
        filteredScriptItems.push({
          item_id: itemId,
          scheduled_date: parsedDate,
          scriptData: item, // 스크립트 데이터 전체 보존
        });
      }
    }
    return [filteredScriptItems, remainItems];
  }

  async crawlPage(categoryId, page, existingIds = new Set()) {
    return this.retryOperation(async () => {
      console.log(`Crawling page ${page} in category ${categoryId}...`);
      const url =
        this.config.searchUrl + this.config.searchParams(categoryId, page);

      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);

      // 스크립트 데이터에서 아이템 정보 추출
      const scriptData = await this.parseScriptData(
        response.data,
        this.config.crawlSelectors.scriptData
      );

      if (!scriptData) {
        console.error("페이지에서 스크립트 데이터를 추출할 수 없음");
        return [];
      }

      // 필터링 - 이미 존재하는 아이템 제외
      const [filteredItems, remainItems] = this.filterHandles(
        $,
        scriptData,
        existingIds
      );

      if (filteredItems.length === 0) {
        console.log("필터링 후 처리할 아이템이 없음");
        return remainItems;
      }

      const pageItems = filteredItems.map((item) =>
        this.extractItemInfo($, item)
      );

      console.log(`${pageItems.length}개 아이템 추출 완료, 페이지 ${page}`);

      const processedItems = await processImagesInChunks(pageItems);

      return [...processedItems, ...remainItems];
    });
  }

  extractItemInfo($, item) {
    const scriptData = item.scriptData;
    const title = this.removeLeadingBrackets(scriptData.name);

    // 기본 정보 추출
    const result = {
      item_id: item.item_id,
      scheduled_date: item.scheduled_date,
      original_title: scriptData.name,
      title: title, // 동일하게 처리
      brand: title.split(" ")[0], // 첫 단어를 브랜드로 가정
      rank: scriptData.fixRank?.replace(/\\uff/g, ""), // 등급 정보 추출 (이스케이프 문자 처리)
      starting_price: parseInt(scriptData.startingPrice, 10),
      image: scriptData.thumbnailUrl,
      category: this.config.categoryTable[this.config.currentCategoryId],
      auc_num: "3", // StarAuc 식별자
      lotNo: scriptData.lotNo,
    };

    // 현재 입찰가가 있으면 추가
    if (scriptData.currentBiddingPrice) {
      result.current_price = parseInt(scriptData.currentBiddingPrice, 10);
    }

    return result;
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

      if (!scriptData) {
        console.error("상세 페이지에서 스크립트 데이터를 추출할 수 없음");
        return { description: "-" };
      }

      // image_urls 필드 처리
      let images = [];
      if (scriptData.image_urls) {
        // 이미 파싱된 배열인 경우
        if (Array.isArray(scriptData.image_urls)) {
          images = scriptData.image_urls;
        }
      }

      // 백업: 이미지를 찾지 못한 경우 HTML에서 추출
      if (images.length === 0) {
        $(this.config.crawlDetailSelectors.images).each((i, element) => {
          const src = $(element).attr("src");
          if (src) images.push(src);
        });
      }

      // 브랜드 추출
      const brand =
        $(this.config.crawlDetailSelectors.brand).text().trim() ||
        (scriptData.name ? scriptData.name.split(" ")[0] : "");

      // 부속품 정보 추출
      const accessories = $(this.config.crawlDetailSelectors.accessories)
        .text()
        .trim();

      // 세부 설명 추출 - 모든 설명 항목을 수집
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

      // 로그인
      await this.login();

      const allCrawledItems = [];

      // 모든 카테고리 순회
      for (const categoryId of this.config.categoryIds) {
        const categoryItems = [];

        console.log(`Starting crawl for category ${categoryId}`);
        this.config.currentCategoryId = categoryId;

        const totalPages = await this.getTotalPages(categoryId);
        console.log(`Total pages in category ${categoryId}: ${totalPages}`);

        // 모든 페이지 크롤링
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
}

const starAucCrawler = new StarAucCrawler(starAucConfig);
const starAucValueCrawler = new StarAucValueCrawler(starAucValueConfig);

module.exports = { starAucCrawler, starAucValueCrawler };
