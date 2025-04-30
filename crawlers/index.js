// crawlers/index.js
const { ecoAucCrawler, ecoAucValueCrawler } = require("./ecoAuc");
const { brandAucCrawler, brandAucValueCrawler } = require("./brandAuc");
const { starAucCrawler, starAucValueCrawler } = require("./starAuc");

// 테스트 코드
async function testInvoiceCrawlers() {
  console.log("테스트 시작: 청구서 크롤링");

  try {
    // EcoAuc 테스트
    console.log("\n===== EcoAuc 청구서 크롤링 =====");
    const ecoInvoices = await ecoAucCrawler.crawlInvoices();
    console.log(`결과: ${ecoInvoices.length}개 항목 찾음`);
    console.log(ecoInvoices.slice(0, 2));

    // BrandAuc 테스트
    console.log("\n===== BrandAuc 청구서 크롤링 =====");
    const brandInvoices = await brandAucCrawler.crawlInvoices();
    console.log(`결과: ${brandInvoices.length}개 항목 찾음`);
    console.log(brandInvoices.slice(0, 2));

    // StarAuc 테스트
    console.log("\n===== StarAuc 청구서 크롤링 =====");
    const starInvoices = await starAucCrawler.crawlInvoices();
    console.log(`결과: ${starInvoices.length}개 항목 찾음`);
    console.log(starInvoices.slice(0, 2));

    console.log("\n테스트 완료");
  } catch (error) {
    console.error("테스트 중 오류 발생:", error);
  }
}

// 커맨드 라인에서 직접 실행할 경우 테스트 실행
if (require.main === module) {
  testInvoiceCrawlers();
}

module.exports = {
  ecoAucCrawler,
  ecoAucValueCrawler,
  brandAucCrawler,
  brandAucValueCrawler,
  starAucCrawler,
  starAucValueCrawler,
};
