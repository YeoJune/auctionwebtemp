// routes/admin.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const { getAdminSettings, updateAdminSettings, getNotices, addNotice, updateNotice, deleteNotice } = require('../utils/adminDB');

// Multer configuration for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/images/notices/')
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname))
  }
});

const upload = multer({ storage: storage });

// Middleware to check if user is admin (unchanged)
const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.id === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied. Admin only.' });
  }
};

router.get('/', isAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../admin.html'));
});

// Route to upload logo
router.post('/upload-logo', isAdmin, upload.single('logo'), (req, res) => {
  if (req.file) {
    res.json({ message: 'Logo uploaded successfully' });
  } else {
    res.status(400).json({ message: 'Logo upload failed' });
  }
});

// Route to get admin settings
router.get('/settings', async (req, res) => {
  try {
    const settings = await getAdminSettings();
    res.json(settings);
  } catch (error) {
    logger.error('Error getting admin settings:', error);
    res.status(500).json({ message: 'Error getting admin settings' });
  }
});

router.post('/settings', isAdmin, async (req, res) => {
  try {
    const settings = {};
    if (req.body.crawlSchedule !== undefined) settings.crawlSchedule = req.body.crawlSchedule;
    
    await updateAdminSettings(settings);
    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    logger.error('Error updating admin settings:', error);
    res.status(500).json({ message: 'Error updating admin settings' });
  }
});

// Updated routes for notice board functionality
router.get('/notices', async (req, res) => {
  try {
    const notices = await getNotices();
    res.json(notices);
  } catch (error) {
    logger.error('Error getting notices:', error);
    res.status(500).json({ message: 'Error getting notices' });
  }
});

router.post('/notices', isAdmin, upload.array('images', 5), async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title || !content) {
      return res.status(400).json({ message: 'Title and content are required' });
    }
    const imageUrls = req.files.map(file => `/images/notices/${file.filename}`);
    const newNotice = await addNotice(title, content, imageUrls);
    res.status(201).json(newNotice);
  } catch (error) {
    logger.error('Error adding notice:', error);
    res.status(500).json({ message: 'Error adding notice' });
  }
});

router.put('/notices/:id', isAdmin, upload.array('images', 5), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, existingImageUrls } = req.body;
    if (!title || !content) {
      return res.status(400).json({ message: 'Title and content are required' });
    }
    const newImageUrls = req.files.map(file => `/images/notices/${file.filename}`);
    const imageUrls = [...JSON.parse(existingImageUrls), ...newImageUrls];
    const updatedNotice = await updateNotice(id, title, content, imageUrls);
    if (!updatedNotice) {
      return res.status(404).json({ message: 'Notice not found' });
    }
    res.json(updatedNotice);
  } catch (error) {
    logger.error('Error updating notice:', error);
    res.status(500).json({ message: 'Error updating notice' });
  }
});

router.delete('/notices/:id', isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await deleteNotice(id);
    if (!result) {
      return res.status(404).json({ message: 'Notice not found' });
    }
    res.json({ message: 'Notice deleted successfully' });
  } catch (error) {
    logger.error('Error deleting notice:', error);
    res.status(500).json({ message: 'Error deleting notice' });
  }
});
router.get('/filter-settings', isAdmin, async (req, res) => {
  try {
    const settings = await getFilterSettings();
    res.json(settings);
  } catch (error) {
    logger.error('Error getting filter settings:', error);
    res.status(500).json({ message: 'Error getting filter settings' });
  }
});

router.post('/filter-settings', isAdmin, async (req, res) => {
  try {
    const { brandFilters, categoryFilters, dateFilters } = req.body;
    await updateFilterSettings(brandFilters, categoryFilters, dateFilters);
    res.json({ message: 'Filter settings updated successfully' });
  } catch (error) {
    logger.error('Error updating filter settings:', error);
    res.status(500).json({ message: 'Error updating filter settings' });
  }
});
module.exports = router;