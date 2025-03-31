const pool = require("./DB");
const { ecoAucCrawler, brandAucCrawler } = require("../crawlers/index");

/**
 * Submit a bid to the appropriate auction platform
 * @param {Object} bidData - The bid data containing bid_id and price
 * @returns {Promise<Object>} The result of the bid submission
 */
async function submitBid(bidData) {
  const { bid_id, price } = bidData;

  if (!bid_id || !price) {
    return {
      success: false,
      message: "Missing required parameters: bid_id and price are required",
      statusCode: 400,
    };
  }

  // 입찰 정보 확인
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. 입찰 정보 조회
    const [bids] = await connection.query(
      "SELECT * FROM direct_bids WHERE id = ?",
      [bid_id]
    );

    if (bids.length === 0) {
      await connection.rollback();
      return {
        success: false,
        message: "Bid not found",
        statusCode: 404,
      };
    }

    const bid = bids[0];

    // 이미 플랫폼에 반영된 입찰인지 확인
    if (bid.submitted_to_platform) {
      await connection.rollback();
      return {
        success: false,
        message: "Bid has already been submitted to the platform",
        statusCode: 400,
      };
    }

    // 2. 아이템 정보 조회
    const [items] = await connection.query(
      "SELECT * FROM crawled_items WHERE item_id = ?",
      [bid.item_id]
    );

    if (items.length === 0) {
      await connection.rollback();
      return {
        success: false,
        message: "Item not found",
        statusCode: 404,
      };
    }

    const item = items[0];

    // 3. 플랫폼에 입찰 제출
    let bidResult;

    try {
      if (item.auc_num == 1) {
        // EcoAuc 경매
        bidResult = await ecoAucCrawler.directBid(item.item_id, price);
      } else if (item.auc_num == 2) {
        // 임시 (구현 전에만 이걸 해)
        await connection.rollback();
        return {
          success: false,
          message: "Unsupported auction platform",
          statusCode: 400,
        };
        // BrandAuc 경매
        // bidResult = await brandAucCrawler.directBid(item.item_id, price);
      } else {
        await connection.rollback();
        return {
          success: false,
          message: "Unsupported auction platform",
          statusCode: 400,
        };
      }
    } catch (crawlerError) {
      // 크롤러에서 예외 발생시 명시적으로 submitted_to_platform = false 유지
      await connection.rollback();
      return {
        success: false,
        message: "Error in crawler during bid submission",
        error: crawlerError.message,
        statusCode: 500,
      };
    }

    // 4. 입찰 결과 처리
    if (bidResult && bidResult.success) {
      // 성공 시 submitted_to_platform 상태 변경
      await connection.query(
        "UPDATE direct_bids SET submitted_to_platform = TRUE WHERE id = ?",
        [bid_id]
      );

      await connection.commit();

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
      await connection.rollback();
      return {
        success: false,
        message: "Failed to submit bid to platform",
        error: bidResult ? bidResult.message : "Unknown error",
        statusCode: 500,
      };
    }
  } catch (error) {
    // 전체 프로세스 오류 시 명시적으로 submitted_to_platform = false 유지
    await connection.rollback();
    return {
      success: false,
      message: "Error during bid submission",
      error: error.message,
      statusCode: 500,
    };
  } finally {
    connection.release();
  }
}

module.exports = submitBid;
