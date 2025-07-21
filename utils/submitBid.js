// utils/submitBid.js
const pool = require("./DB");
const {
  ecoAucCrawler,
  brandAucCrawler,
  starAucCrawler,
} = require("../crawlers/index");

/**
 * 경매장별 입찰가 유효성 검증
 * @param {number} auctionNum - 경매장 번호 (1, 2, 3)
 * @param {number} bidPrice - 입찰 가격
 * @param {number} currentPrice - 현재 최고가
 * @param {boolean} isFirstBid - 첫 입찰 여부
 * @returns {Object} - { valid: boolean, message: string }
 */
function validateBidByAuction(auctionNum, bidPrice, currentPrice, isFirstBid) {
  switch (auctionNum) {
    case "1": // 에코옥션 - 기존 1000원 단위
      if (bidPrice % 1000 !== 0) {
        return {
          valid: false,
          message: "Price must be in units of 1000",
        };
      }
      break;

    case "2": // 브랜드옥션 - 첫 입찰 1000엔 단위, 이후 500엔 단위
      if (isFirstBid) {
        if (bidPrice % 1000 !== 0) {
          return {
            valid: false,
            message: "First bid must be in units of 1000 yen",
          };
        }
      } else {
        if (bidPrice % 500 !== 0) {
          return {
            valid: false,
            message: "Subsequent bids must be in units of 500 yen",
          };
        }
      }
      break;

    case "3": // 스타옥션 - 자동 최소금액 계산
      const getIncrement = (price) => {
        if (price >= 1 && price <= 999) return 100;
        if (price >= 1000 && price <= 9999) return 500;
        if (price >= 10000 && price <= 29999) return 1000;
        if (price >= 30000 && price <= 49999) return 2000;
        if (price >= 50000 && price <= 99999) return 3000;
        if (price >= 100000 && price <= 299999) return 5000;
        if (price >= 300000 && price <= 999999) return 10000;
        return 30000; // 1,000,000엔 이상
      };

      const expectedPrice = currentPrice + getIncrement(currentPrice);
      if (bidPrice !== expectedPrice) {
        return {
          valid: false,
          message: `Bid must be exactly ${expectedPrice} yen (auto-calculated minimum)`,
        };
      }
      break;

    default:
      return {
        valid: false,
        message: "Unknown auction platform",
      };
  }

  return { valid: true };
}

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

  // 경매장별 입찰가 검증 (submitBid에서는 기본적인 검증만 수행)
  // 에코옥션만 1000단위 검증, 브랜드옥션/스타옥션은 클라이언트에서 이미 검증됨
  if (item.auc_num === 1) {
    const validation = validateBidByAuction(
      item.auc_num,
      price,
      item.starting_price,
      false
    );

    if (!validation.valid) {
      console.log(`Bid validation failed: ${validation.message}`);
      return {
        success: false,
        message: validation.message,
        statusCode: 400,
      };
    }
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
  } else if (item.auc_num == 3) {
    // StarAuc 경매
    console.log(
      `Submitting bid to StarAuc platform for item ${item.item_id} with price ${price}`
    );
    bidResult = await starAucCrawler.directBid(item.item_id, price);
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
module.exports.validateBidByAuction = validateBidByAuction;
