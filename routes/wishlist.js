// routes/wishlist.js
const express = require('express');
const router = express.Router();
const pool = require('../utils/DB');

// Add item to wishlist
router.post('/', async (req, res) => {
  const { itemId } = req.body;

  if (!itemId) {
    return res.status(400).json({ message: 'Item ID is required' });
  }

  try {
    const userId = req.session.user.id;
    // Check if item exists
    const [items] = await pool.query('SELECT item_id FROM crawled_items WHERE item_id = ?', [itemId]);
    if (items.length === 0) {
      return res.status(404).json({ message: 'Item not found' });
    }

    // Check if item is already in wishlist
    const [existingItems] = await pool.query('SELECT * FROM wishlists WHERE user_id = ? AND item_id = ?', [userId, itemId]);
    if (existingItems.length > 0) {
      return res.status(400).json({ message: 'Item already in wishlist' });
    }

    // Add to wishlist
    await pool.query('INSERT INTO wishlists (user_id, item_id) VALUES (?, ?)', [userId, itemId]);
    res.status(201).json({ message: 'Item added to wishlist' });
  } catch (err) {
    console.error('Error adding to wishlist:', err);
    res.status(500).json({ message: 'Error adding to wishlist' });
  }
});

// Get wishlist
router.get('/', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [wishlist] = await pool.query(`
      SELECT ci.* 
      FROM wishlists w
      JOIN crawled_items ci ON w.item_id = ci.item_id
      WHERE w.user_id = ?
    `, [userId]);

    res.json(wishlist);
  } catch (err) {
    console.error('Error fetching wishlist:', err);
    res.status(500).json({ message: 'Error fetching wishlist' });
  }
});

// Remove item from wishlist
router.delete('/', async (req, res) => {
  const { itemId } = req.body;

  if (!itemId) {
    return res.status(400).json({ message: 'Item ID is required' });
  }

  try {
    const userId = req.session.user.id;
    await pool.query('DELETE FROM wishlists WHERE user_id = ? AND item_id = ?', [userId, itemId]);
    res.json({ message: 'Item removed from wishlist' });
  } catch (err) {
    console.error('Error removing from wishlist:', err);
    res.status(500).json({ message: 'Error removing from wishlist' });
  }
});

module.exports = router;