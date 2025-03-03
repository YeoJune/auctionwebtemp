const express = require("express");
const router = express.Router();
const { processItem } = require("../utils/processItem");

router.post("/item-details/:itemId", (req, res) => {
  const { itemId } = req.params;
  processItem(itemId, false, res);
});

router.post("/value-details/:itemId", (req, res) => {
  const { itemId } = req.params;
  processItem(itemId, true, res);
});

module.exports = router;
