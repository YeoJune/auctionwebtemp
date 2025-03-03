// crawlers/brandAuc.js
const cheerio = require("cheerio");
const { AxiosCrawler } = require("./baseCrawler");
const { processImagesInChunks } = require("../utils/processImage");

const brandAucConfig = {
  name: "BrandAuc",
  baseUrl: "https://member.brand-auc.com",
  loginCheckUrl: "https://u.brand-auc.com/configuration",
  loginPageUrl: "https://member.brand-auc.com/login",
  loginPostUrl: "https://member.brand-auc.com/login.php",
  previewItemsApiUrl:
    "https://u.brand-auc.com/api/v1/auction/previewItems/list",
  detailItemApiUrl:
    "https://u.brand-auc.com/api/v1/auction/auctionItems/bag/1/",
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
};

const brandAucValueConfig = {
  name: "BrandAucValue",
  baseUrl: "https://e-auc.brand-auc.com",
  loginCheckUrl: "https://e-auc.brand-auc.com/main",
  loginPageUrl: "https://member.brand-auc.com/loginEauc",
  loginPostUrl: "https://member.brand-auc.com/login",
  marketPriceApiUrl:
    "https://e-auc.brand-auc.com/api/v1/marketprice/marketpriceItems/list",
  detailItemApiUrl:
    "https://e-auc.brand-auc.com/api/v1/marketprice/marketpriceItems/detail",
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
};

class BrandAucCrawler extends AxiosCrawler {
  constructor(config) {
    super(config);
    this.currentLocale = "en"; // 언어 설정(영어)
  }

  async login() {
    // 부모 클래스(AxiosCrawler)의 login 메서드 호출
    // 이미 로그인 되어있는지, 다른 로그인 진행중인지 등을 체크
    const shouldContinue = await super.login();

    // 부모 메서드에서 이미 로그인 되어있다고 판단되면 종료
    if (shouldContinue === true) {
      return true;
    }

    // 다른 로그인 진행중이면 해당 Promise를 반환 (이 경우 shouldContinue는 Promise)
    if (shouldContinue instanceof Promise) {
      return shouldContinue;
    }

    // 이제 실제 로그인 로직 구현
    // 여기서는 throw Error로 끝나는 부모의 login() 메서드를 오버라이드
    this.loginPromise = this.retryOperation(async () => {
      try {
        console.log("Logging in to Brand Auction...");

        // 로그인 페이지 가져오기
        const response = await this.client.get(this.config.loginPageUrl);

        // CSRF 토큰 추출
        const $ = cheerio.load(response.data);
        const csrfToken = $('input[name="_csrf"]').val();

        if (!csrfToken) {
          throw new Error("CSRF token not found");
        }

        // Form 데이터 준비
        const formData = new URLSearchParams();
        formData.append("username", this.config.loginData.userId);
        formData.append("password", this.config.loginData.password);
        formData.append("_csrf", csrfToken);
        formData.append("client_id", "brandMember");
        formData.append("loginType", "login");

        // 추가 옵션 (로그인 상태 유지)
        formData.append("asbLogin", "on");

        // 로그인 요청
        const loginResponse = await this.client.post(
          this.config.loginPageUrl, // '/login'이 상대 경로니까 원래 URL 그대로 사용
          formData,
          {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Referer: this.config.loginPageUrl,
            },
            maxRedirects: 5,
            validateStatus: function (status) {
              return status >= 200 && status < 400; // 300-399 리다이렉트 허용
            },
          }
        );

        // 로그인 후 검증
        if (await this.loginCheck()) {
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

  async crawlAllItems(existingIds = new Set()) {
    try {
      const startTime = Date.now();
      console.log(`Starting crawl at ${new Date().toISOString()}`);

      // 로그인
      await this.login();

      const allCrawledItems = [];
      const size = 1000; // 한 페이지당 항목 수 (API 제한에 따라 조정)

      // 첫 페이지 요청으로 총 페이지 수 확인
      const firstPageResponse = await this.client.get(
        this.config.previewItemsApiUrl,
        {
          params: {
            page: 0,
            size: size,
            gamenId: "B02-01",
          },
          headers: {
            Accept: "application/json",
          },
        }
      );

      const totalPages = firstPageResponse.data.totalPages;
      const totalItems = firstPageResponse.data.totalElements;

      console.log(`Found ${totalItems} items across ${totalPages} pages`);

      // 첫 페이지 아이템 처리
      const firstPageItems = await this.processItemsPage(
        firstPageResponse.data.content,
        existingIds
      );
      allCrawledItems.push(...firstPageItems);

      // 나머지 페이지 순차적으로 처리
      for (let page = 1; page < totalPages; page++) {
        console.log(`Crawling page ${page + 1} of ${totalPages}`);

        const response = await this.client.get(this.config.previewItemsApiUrl, {
          params: {
            page: page,
            size: size,
            gamenId: "B02-01",
          },
          headers: {
            Accept: "application/json",
          },
        });

        if (response.data && response.data.content) {
          const pageItems = await this.processItemsPage(
            response.data.content,
            existingIds
          );
          allCrawledItems.push(...pageItems);

          console.log(
            `Processed ${pageItems.length} items from page ${page + 1}`
          );
        }
      }

      console.log(`Total items processed: ${allCrawledItems.length}`);

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      console.log(
        `Crawl operation completed in ${this.formatExecutionTime(
          executionTime
        )}`
      );

      return allCrawledItems;
    } catch (error) {
      console.error("Crawl failed:", error);
      return [];
    }
  }

  async processItemsPage(items, existingIds) {
    // 아이템 필터링
    const filteredItems = [];

    for (const item of items) {
      // 상태가 "SOLD BY HOLD" 또는 "SOLD"인 경우 제외
      if (item.jotai === "SOLD BY HOLD" || item.jotai === "SOLD") {
        continue;
      }

      // 이미 처리된 아이템 제외
      if (existingIds.has(item.uketsukeBng)) {
        filteredItems.push({ item_id: item.uketsukeBng });
        continue;
      }

      // 필터 통과한 아이템 기본 정보 추출
      const processedItem = this.extractBasicItemInfo(item);
      filteredItems.push(processedItem);
    }

    // 필터링된 아이템에 대해 추가 처리 (이미지 처리 등)
    const processedItems = await processImagesInChunks(filteredItems);

    return processedItems;
  }

  extractBasicItemInfo(item) {
    // API 응답에서 필요한 정보 추출
    const category = this.config.categoryTable[item.genreEn] || item.genreEn;
    const scheduledDate =
      this.extractDate(this.convertToKST(item.kaisaiYmd)) || null;

    const original_title = this.convertFullWidthToAscii(item.shohinEn || "");

    return {
      item_id: item.uketsukeBng,
      original_title: original_title,
      title: this.removeLeadingBrackets(original_title),
      brand: this.convertFullWidthToAscii(item.maker || ""),
      rank: item.hyoka || "",
      starting_price: item.startKng || 0,
      image: item.photoUrl
        ? item.photoUrl.replace(/(brand_img\/)(\d+)/, "$16")
        : null,
      category: category,
      scheduled_date: scheduledDate,
      auc_num: "2", // 고정값으로 보임

      // 상세 정보 요청 시 필요한 데이터
      kaijoCd: item.kaijoCd,
      kaisaiKaisu: item.kaisaiKaisu,
    };
  }

  async crawlItemDetails(itemId, item) {
    try {
      await this.login();
      const kaisaiKaisu = item.kaisaiKaisu;
      const kaijoCd = item.kaijoCd || 1;

      // 상세 정보 URL 구성 (올바른 kaisaiKaisu 사용)
      const detailUrl = `https://u.brand-auc.com/api/v1/auction/auctionItems/bag/${kaijoCd}/${kaisaiKaisu}/${itemId}/B02-01`;

      // 상세 정보 요청
      const response = await this.client.get(detailUrl, {
        headers: {
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://u.brand-auc.com/",
          "X-Requested-With": "XMLHttpRequest",
        },
      });

      if (!response.data) {
        throw new Error(`Failed to get details for item ${itemId}`);
      }

      const detail = response.data;

      // 이미지 URL 목록 처리
      const images = detail.fileList || [];
      const formattedImages = images.map((url) =>
        url.replace(/(brand_img\/)(\d+)/, "$16")
      );

      // 상품 상태 메모 처리
      const bikoList = detail.bikoList || [];
      let description = bikoList.join("\n") || "-";

      // 부속품 정보 처리
      const accessoryParts = [];
      if (detail.hosho && detail.hosho !== "なし")
        accessoryParts.push(`보증서: ${detail.hosho}`);
      if (detail.hako && detail.hako !== "なし")
        accessoryParts.push(`상자: ${detail.hako}`);
      if (detail.hozon && detail.hozon !== "なし")
        accessoryParts.push(`보존 케이스: ${detail.hozon}`);
      if (detail.strap && detail.strap !== "なし")
        accessoryParts.push(`스트랩: ${detail.strap}`);
      if (detail.kanadeKey && detail.kanadeKey !== "なし")
        accessoryParts.push(`열쇠: ${detail.kanadeKey}`);
      if (detail.seal && detail.seal !== "なし")
        accessoryParts.push(`태그: ${detail.seal}`);

      const accessoryCode = accessoryParts.join(", ") || "";

      return {
        additional_images:
          formattedImages.length > 0 ? JSON.stringify(formattedImages) : null,
        description: description,
        accessory_code: accessoryCode,
      };
    } catch (error) {
      console.error(
        `Error fetching details for item ${itemId}:`,
        error.message
      );
      return {
        additional_images: null,
        description: "-",
        accessory_code: "",
      };
    }
  }
}

class BrandAucValueCrawler extends AxiosCrawler {
  constructor(config) {
    super(config);
    this.currentLocale = "en"; // 언어 설정(영어)
  }

  async login() {
    // 부모 클래스(AxiosCrawler)의 login 메서드 호출
    // 이미 로그인 되어있는지, 다른 로그인 진행중인지 등을 체크
    const shouldContinue = await super.login();

    // 부모 메서드에서 이미 로그인 되어있다고 판단되면 종료
    if (shouldContinue === true) {
      return true;
    }

    // 다른 로그인 진행중이면 해당 Promise를 반환 (이 경우 shouldContinue는 Promise)
    if (shouldContinue instanceof Promise) {
      return shouldContinue;
    }

    // 이제 실제 로그인 로직 구현
    // 여기서는 throw Error로 끝나는 부모의 login() 메서드를 오버라이드
    this.loginPromise = this.retryOperation(async () => {
      try {
        console.log("Logging in to Brand Auction...");

        // 로그인 페이지 가져오기
        const response = await this.client.get(this.config.loginPageUrl);

        // CSRF 토큰 추출
        const $ = cheerio.load(response.data);
        const csrfToken = $('input[name="_csrf"]').val();

        if (!csrfToken) {
          throw new Error("CSRF token not found");
        }

        // Form 데이터 준비
        const formData = new URLSearchParams();
        formData.append("username", this.config.loginData.userId);
        formData.append("password", this.config.loginData.password);
        formData.append("_csrf", csrfToken);
        formData.append("client_id", "brandEaucMember");
        formData.append("loginType", "eaucLogin");

        // 로그인 요청
        const loginResponse = await this.client.post(
          this.config.loginPostUrl, // '/login'이 상대 경로니까 원래 URL 그대로 사용
          formData,
          {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Referer: this.config.loginPostUrl,
            },
            maxRedirects: 5,
            validateStatus: function (status) {
              return status >= 200 && status < 400; // 300-399 리다이렉트 허용
            },
          }
        );

        // 로그인 후 검증
        if (await this.loginCheck()) {
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

  async crawlAllItems(existingIds = new Set()) {
    try {
      const startTime = Date.now();
      console.log(`Starting value crawl at ${new Date().toISOString()}`);

      // 로그인
      await this.login();

      const allCrawledItems = [];
      const size = 1000; // 한 페이지당 항목 수 (API 제한에 따라 조정)

      // 최근 경매 회차 설정
      const kaisaiKaisuFrom = 796; // 지난 10회 경매 데이터
      const kaisaiKaisuTo = 807; // 현재 경매 회차

      // 첫 페이지 요청으로 총 페이지 수 확인
      const firstPageResponse = await this.client.get(
        this.config.marketPriceApiUrl,
        {
          params: {
            kaisaiKaisuFrom: kaisaiKaisuFrom,
            kaisaiKaisuTo: kaisaiKaisuTo,
            pageNumber: 0,
            page: 0,
            size: size,
            getKbn: 3, // 완료된 경매 결과
            kaijoKbn: 0, // 모든 경매장
          },
        }
      );

      const totalPages = firstPageResponse.data.totalPages;
      const totalItems = firstPageResponse.data.totalElements;

      console.log(
        `Found ${totalItems} market price items across ${totalPages} pages`
      );

      // 첫 페이지 아이템 처리
      const firstPageItems = await this.processItemsPage(
        firstPageResponse.data.content,
        existingIds
      );
      allCrawledItems.push(...firstPageItems);

      let isEnd = false;

      console.log(allCrawledItems[0]);

      // 나머지 페이지 순차적으로 처리
      for (let page = 1; page < totalPages; page++) {
        console.log(`Crawling value page ${page + 1} of ${totalPages}`);

        const response = await this.client.get(this.config.marketPriceApiUrl, {
          params: {
            kaisaiKaisuFrom: kaisaiKaisuFrom,
            kaisaiKaisuTo: kaisaiKaisuTo,
            page: page,
            size: size,
            getKbn: 3,
            kaijoKbn: 0,
          },
          headers: {
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            Referer: "https://e-auc.brand-auc.com/",
            "X-Requested-With": "XMLHttpRequest",
          },
        });

        if (response.data && response.data.content) {
          const pageItems = await this.processItemsPage(
            response.data.content,
            existingIds
          );

          // 영어 제목이 없는 아이템이 있으면 더 이상 크롤링 안함
          for (const item of pageItems) {
            if (item.item_id && !item.title) {
              isEnd = true;
              break;
            }
          }

          allCrawledItems.push(...pageItems);

          console.log(
            `Processed ${pageItems.length} value items from page ${page + 1}`
          );

          if (isEnd) {
            console.log("Found items without English titles, stopping crawl");
            break;
          }
        }
      }

      console.log(`Total value items processed: ${allCrawledItems.length}`);

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      console.log(
        `Value crawl operation completed in ${this.formatExecutionTime(
          executionTime
        )}`
      );

      return allCrawledItems;
    } catch (error) {
      console.error("Value crawl failed:", error);
      return [];
    }
  }

  async processItemsPage(items, existingIds) {
    const filteredItems = [];

    for (const item of items) {
      // 이미 처리된 아이템 제외
      if (existingIds.has(item.uketsukeBng)) {
        filteredItems.push({ item_id: item.uketsukeBng });
        continue;
      }

      // 기본 정보 추출하여 아이템 생성
      const processedItem = this.extractBasicItemInfo(item);
      filteredItems.push(processedItem);
    }

    // 이미지 처리 등 추가 로직
    const processedItems = await processImagesInChunks(filteredItems);

    return processedItems;
  }

  extractBasicItemInfo(item) {
    // API 응답에서 필요한 정보 추출
    const category = this.config.categoryTable[item.genreEn] || item.genreEn;
    const scheduledDate =
      this.extractDate(this.convertToKST(item.kaisaiYmd)) || null;

    const original_title = this.convertFullWidthToAscii(item.shohinEn || "");

    return {
      item_id: item.uketsukeBng,
      original_title: original_title,
      title: this.removeLeadingBrackets(original_title),
      brand: this.convertFullWidthToAscii(item.maker || ""),
      rank: item.hyoka || "",
      final_price: item.kekkaKng || 0,
      image: item.photoUrl
        ? item.photoUrl.replace(/(brand_img\/)(\d+)/, "$16")
        : null,
      category: category,
      scheduled_date: scheduledDate,
      auc_num: "2", // 고정값으로 보임

      // 상세 정보 요청 시 필요한 데이터
      kaijoCd: item.kaijoCd,
      kaisaiKaisu: item.kaisaiKaisu,
    };
  }

  async crawlItemDetails(itemId, item) {
    try {
      await this.login();
      const kaisaiKaisu = item.kaisaiKaisu;
      const kaijoCd = item.kaijoCd || 1;

      // 상세 정보 URL 구성 (올바른 kaisaiKaisu 사용)
      const detailUrl = `https://e-auc.brand-auc.com/api/v1/marketprice/marketpriceItems/detail/${kaijoCd}/${kaisaiKaisu}/${itemId}`;

      // 상세 정보 요청
      const response = await this.client.get(detailUrl, {
        headers: {
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://e-auc.brand-auc.com/",
          "X-Requested-With": "XMLHttpRequest",
        },
      });

      if (!response.data) {
        throw new Error(`Failed to get value details for item ${itemId}`);
      }

      const detail = response.data;

      // 이미지 URL 목록 처리
      const images = detail.fileList || [];
      const formattedImages = images.map((url) =>
        url.replace(/(brand_img\/)(\d+)/, "$16")
      );

      // 상품 상태 메모 처리
      const bikoList = detail.bikoList || [];
      let description = bikoList.join("\n") || "-";

      // 부속품 정보 처리
      const accessoryParts = [];
      if (detail.hosho && detail.hosho !== "なし")
        accessoryParts.push(`보증서: ${detail.hosho}`);
      if (detail.hako && detail.hako !== "なし")
        accessoryParts.push(`상자: ${detail.hako}`);
      if (detail.hozon && detail.hozon !== "なし")
        accessoryParts.push(`보존 케이스: ${detail.hozon}`);
      if (detail.strap && detail.strap !== "なし")
        accessoryParts.push(`스트랩: ${detail.strap}`);
      if (detail.kanadeKey && detail.kanadeKey !== "なし")
        accessoryParts.push(`열쇠: ${detail.kanadeKey}`);
      if (detail.seal && detail.seal !== "なし")
        accessoryParts.push(`태그: ${detail.seal}`);

      const accessoryCode = accessoryParts.join(", ") || "";

      return {
        additional_images:
          formattedImages.length > 0 ? JSON.stringify(formattedImages) : null,
        description: description,
        accessory_code: accessoryCode,
      };
    } catch (error) {
      console.error(
        `Error fetching value details for item ${itemId}:`,
        error.message
      );
      return {
        additional_images: null,
        description: "-",
        accessory_code: "",
      };
    }
  }
}

const brandAucCrawler = new BrandAucCrawler(brandAucConfig);
const brandAucValueCrawler = new BrandAucValueCrawler(brandAucValueConfig);

module.exports = { brandAucCrawler, brandAucValueCrawler };
