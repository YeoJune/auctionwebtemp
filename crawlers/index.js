// crawlers/index.js
const { ecoAucCrawler, ecoAucValueCrawler } = require("./ecoAuc");
const { brandAucCrawler, brandAucValueCrawler } = require("./brandAuc");

module.exports = {
  ecoAucCrawler,
  brandAucCrawler,
  ecoAucValueCrawler,
  brandAucValueCrawler,
};
