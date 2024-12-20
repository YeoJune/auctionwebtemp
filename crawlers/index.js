// crawlers/index.js
const { ecoAucCrawler, ecoAucValueCrawler } = require("./ecoAuc");
const { brandAucCrawler, brandAucValueCrawler } = require("./brandAuc");
const { starAucCrawler } = require("./starAuc");

module.exports = {
  ecoAucCrawler,
  brandAucCrawler,
  ecoAucValueCrawler,
  brandAucValueCrawler,
  starAucCrawler,
};
