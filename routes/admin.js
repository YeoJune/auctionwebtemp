const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const { 
  getAdminSettings, 
  updateAdminSettings, 
  getNotices, 
  getNoticeById, 
  addNotice, 
  updateNotice, 
  deleteNotice, 
  getAllFilters, 
  updateFilters,
  incrementFilterUseCount  // New function import
} = require('../utils/adminDB');

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

// Route to upload logo (unchanged)
router.post('/upload-logo', isAdmin, upload.single('logo'), (req, res) => {
  if (req.file) {
    res.json({ message: 'Logo uploaded successfully' });
  } else {
    res.status(400).json({ message: 'Logo upload failed' });
  }
});

// Route to get admin settings (unchanged)
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

router.get('/notices/:id', async (req, res) => {
  try {
    const notice = await getNoticeById(req.params.id);
    if (notice) {
      res.json(notice);
    } else {
      res.status(404).json({ message: 'Notice not found' });
    }
  } catch (error) {
    logger.error('Error getting notice:', error);
    res.status(500).json({ message: 'Error getting notice' });
  }
});

// New route for TinyMCE image upload
router.post('/upload-image', isAdmin, upload.single('file'), (req, res) => {
  if (req.file) {
    res.json({
      location: `/images/notices/${req.file.filename}`
    });
  } else {
    res.status(400).json({ message: 'Image upload failed' });
  }
});

// Updated route for adding notices
router.post('/notices', isAdmin, async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title || !content) {
      return res.status(400).json({ message: 'Title and content are required' });
    }
    const newNotice = await addNotice(title, content);
    res.status(201).json(newNotice);
  } catch (error) {
    logger.error('Error adding notice:', error);
    res.status(500).json({ message: 'Error adding notice' });
  }
});

// Updated route for updating notices
router.put('/notices/:id', isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;
    if (!title || !content) {
      return res.status(400).json({ message: 'Title and content are required' });
    }
    const updatedNotice = await updateNotice(id, title, content);
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
    res.json({ message: 'Notice and associated images deleted successfully' });
  } catch (error) {
    logger.error('Error deleting notice:', error);
    res.status(500).json({ message: 'Error deleting notice and associated images' });
  }
});

// Updated route to get all filters
router.get('/filters', isAdmin, async (req, res) => {
  try {
    const filters = await getAllFilters();
    res.json(filters);
  } catch (error) {
    logger.error('Error fetching filters:', error);
    res.status(500).json({ message: 'Error fetching filters' });
  }
});

// Updated route to update filters
router.post('/update-filters', isAdmin, async (req, res) => {
  try {
    const { changes } = req.body;
    await updateFilters(changes);
    res.json({ message: 'Filters updated successfully' });
  } catch (error) {
    logger.error('Error updating filters:', error);
    res.status(500).json({ message: 'Error updating filters' });
  }
});

// New route to get filter usage statistics
router.get('/filter-stats', isAdmin, async (req, res) => {
  try {
    const stats = await getAllFilters();
    // Sort filters by use_count in descending order
    const sortedStats = Object.keys(stats).reduce((acc, key) => {
      acc[key] = stats[key].sort((a, b) => b.use_count - a.use_count);
      return acc;
    }, {});
    res.json(sortedStats);
  } catch (error) {
    logger.error('Error fetching filter statistics:', error);
    res.status(500).json({ message: 'Error fetching filter statistics' });
  }
});

// New route to increment filter use count
router.post('/increment-filter-use', async (req, res) => {
  try {
    const { type, value } = req.body;
    await incrementFilterUseCount(type, value);
    res.json({ message: 'Filter use count incremented successfully' });
  } catch (error) {
    logger.error('Error incrementing filter use count:', error);
    res.status(500).json({ message: 'Error incrementing filter use count' });
  }
});

module.exports = router;