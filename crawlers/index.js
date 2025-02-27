// crawlers/index.js
const { ecoAucCrawler } = require("./ecoAuc");
//const { brandAucCrawler, brandAucValueCrawler } = require("./brandAuc");
const { starAucCrawler } = require("./starAuc");

module.exports = {
  ecoAucCrawler,
  starAucCrawler,
};
