// utils/submitBid.js
const pool = require("./DB");
const { ecoAucCrawler, brandAucCrawler } = require("../crawlers/index");

/**
 * Submit a bid to the appropriate auction platform
 * @param {Object} bidData - The bid data containing bid_id and price
 * @returns {Promise<Object>} The result of the bid submission
 */
async function submitBid(bidData, item) {
  const { bid_id, price } = bidData;

  console.log(
    `Preparing bid submission for bid ID ${bid_id} with price ${price}...`
  );

  if (!bid_id || !price) {
    console.log("Missing required parameters: bid_id and price are required");
    return {
      success: false,
      message: "Missing required parameters: bid_id and price are required",
      statusCode: 400,
    };
  }

  // 가격이 1000단위인지 확인
  if (price % 1000 !== 0) {
    console.log(`Invalid price: ${price}. Price must be in units of 1000`);
    return {
      success: false,
      message: "Price must be in units of 1000",
      statusCode: 400,
    };
  }

  const connection = await pool.getConnection();
  await connection.beginTransaction();

  // 3. 플랫폼에 입찰 제출
  let bidResult;

  if (item.auc_num == 1) {
    // EcoAuc 경매
    console.log(
      `Submitting bid to EcoAuc platform for item ${item.item_id} with price ${price}`
    );
    bidResult = await ecoAucCrawler.directBid(item.item_id, price);
  } else if (item.auc_num == 2) {
    // BrandAuc 경매
    console.log(
      `Submitting bid to BrandAuc platform for item ${item.item_id} with price ${price}`
    );
    bidResult = await brandAucCrawler.directBid(item.item_id, price);
  } else {
    console.log(`Unknown auction platform: ${item.auc_num}`);
    await connection.rollback();
    connection.release();
    return {
      success: false,
      message: "Unsupported auction platform",
      statusCode: 400,
    };
  }

  // 4. 입찰 결과 처리
  if (bidResult && bidResult.success) {
    // 성공 시 submitted_to_platform 상태 변경
    console.log(`Bid successful for item ${item.item_id} with price ${price}`);
    await connection.query(
      "UPDATE direct_bids SET submitted_to_platform = TRUE WHERE id = ?",
      [bid_id]
    );
    console.log(
      `Updated bid ID ${bid_id} status to submitted_to_platform = TRUE`
    );

    await connection.commit();
    connection.release();

    return {
      success: true,
      message: "Bid successfully submitted to platform",
      bid_id: bid_id,
      item_id: item.item_id,
      platform_response: bidResult.data,
      statusCode: 200,
    };
  } else {
    // 실패 시 오류 반환 및 명시적으로 submitted_to_platform = false 유지
    console.error(
      `Bid failed for item ${item.item_id} with price ${price}: ${
        bidResult ? bidResult.message : "Unknown error"
      }`
    );
    await connection.rollback();
    connection.release();

    return {
      success: false,
      message: "Failed to submit bid to platform",
      error: bidResult ? bidResult.message : "Unknown error",
      statusCode: 500,
    };
  }
}

module.exports = submitBid;
