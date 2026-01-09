// scripts/indexElasticsearch.js
require("dotenv").config();
const { pool } = require("../utils/DB");
const esManager = require("../utils/elasticsearch");

async function indexAllData() {
  try {
    console.log("Starting initial indexing...");

    // ES 연결
    const connected = await esManager.connect();
    if (!connected) {
      console.error("Failed to connect to Elasticsearch");
      process.exit(1);
    }

    // crawled_items 인덱싱
    console.log("Indexing crawled_items...");
    const [crawledItems] = await pool.query(`
      SELECT 
        item_id, title, brand, category, 
        auc_num, scheduled_date
      FROM crawled_items 
      WHERE is_enabled = 1 AND title IS NOT NULL
    `);

    if (crawledItems.length > 0) {
      const result = await esManager.bulkIndex("crawled_items", crawledItems);
      console.log(
        `✓ Indexed ${result.indexed} crawled_items (errors: ${result.errors})`
      );
    } else {
      console.log("No crawled_items to index");
    }

    // values_items 인덱싱
    console.log("Indexing values_items...");
    const [valuesItems] = await pool.query(`
      SELECT 
        item_id, title, brand, category, 
        auc_num, scheduled_date
      FROM values_items
      WHERE title IS NOT NULL
    `);

    if (valuesItems.length > 0) {
      const result = await esManager.bulkIndex("values_items", valuesItems);
      console.log(
        `✓ Indexed ${result.indexed} values_items (errors: ${result.errors})`
      );
    } else {
      console.log("No values_items to index");
    }

    console.log("✓ Initial indexing complete!");
    process.exit(0);
  } catch (error) {
    console.error("✗ Indexing failed:", error);
    process.exit(1);
  }
}

indexAllData();
