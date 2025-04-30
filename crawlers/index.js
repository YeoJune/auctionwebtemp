// crawlers/index.js
const { ecoAucCrawler, ecoAucValueCrawler } = require("./ecoAuc");
const { brandAucCrawler, brandAucValueCrawler } = require("./brandAuc");
const { starAucCrawler, starAucValueCrawler } = require("./starAuc");

module.exports = {
  ecoAucCrawler,
  ecoAucValueCrawler,
  brandAucCrawler,
  brandAucValueCrawler,
  starAucCrawler,
  starAucValueCrawler,
};
