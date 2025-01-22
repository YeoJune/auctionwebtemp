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
