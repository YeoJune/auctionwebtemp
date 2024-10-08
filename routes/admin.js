const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const { getAdminSettings, updateAdminSettings } = require('../utils/adminDB');

// Multer configuration for logo upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/images/')
  },
  filename: function (req, file, cb) {
    cb(null, 'logo.png')
  }
});

const upload = multer({ storage: storage });

// Middleware to check if user is admin
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
    if (req.body.notice !== undefined) settings.notice = req.body.notice;

    await updateAdminSettings(settings);
    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    logger.error('Error updating admin settings:', error);
    res.status(500).json({ message: 'Error updating admin settings' });
  }
});

module.exports = router;