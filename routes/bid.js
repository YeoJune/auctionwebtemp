const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const MyGoogleSheetsManager = require('../utils/googleSheets');
const pool = require('../utils/DB');

router.post('/place-reservation', async (req, res) => {
  const { itemId, bidAmount, isFinalBid } = req.body;
  const linkFunc = {1:(itemId) => `https://www.ecoauc.com/client/auction-items/view/${itemId}`, 2:(itemId) => itemId};

  if (!itemId || !bidAmount) {
    return res.status(400).json({ message: 'Item ID, bid amount are required' });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    if (!req.session.user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let bid = null;
    if (isFinalBid) {
      const [bids] = await connection.query('SELECT * FROM bids WHERE item_id = ? AND user_id = ?', [itemId, req.session.user.id]);
      bid = bids[0];

      if (!bid) {
        await connection.rollback();
        return res.status(404).json({ message: 'Bid not found' });
      }
      await MyGoogleSheetsManager.updateFinalBidAmount(bid.id, bidAmount);
      bid.final_price = bidAmount;
    } else {
      const [items] = await connection.query('SELECT * FROM crawled_items WHERE item_id = ?', [itemId]);
      const item = items[0];

      if (!item) {
        await connection.rollback();
        return res.status(404).json({ message: 'Item not found' });
      }
      
      const [result] = await connection.query(
        'INSERT INTO bids (item_id, user_id, first_price, image) VALUES (?, ?, ?, ?)',
        [itemId, req.session.user.id, bidAmount, item.image]
      );
      const bidData = [
        result.insertId + '',
        req.session.user.email,
        req.session.user.id,
        item.scheduled_date ? item.scheduled_date : "",
        linkFunc[item.auc_num](item.item_id),
        item.category,
        item.brand,
        item.korean_title,
        item.rank,
        item.starting_price,
        `=IMAGE("http://casastrade.com/${item.image}")`,
        bidAmount,
      ];
      bid = {
        item_id: itemId,
        user_id: req.session.user.id,
        first_price: bidAmount,
      };
      await MyGoogleSheetsManager.appendToSpreadsheet(bidData);
    }

    await connection.commit();

    res.status(201).json({ 
      message: 'Bid reservation placed successfully',
      bidInfo: bid
    });
  } catch (err) {
    await connection.rollback();
    logger.error('Error placing bid reservation:', err);

    if (!isFinalBid && bid) {
      try {
        await connection.query('DELETE FROM bids WHERE item_id = ? AND user_id = ?', [itemId, req.session.user.id]);
        logger.info('Rolled back bid insertion due to error');
      } catch (deleteErr) {
        logger.error('Error deleting bid after rollback:', deleteErr);
      }
    }

    res.status(500).json({ message: 'Error placing bid reservation' });
  } finally {
    connection.release();
  }
});

module.exports = router;