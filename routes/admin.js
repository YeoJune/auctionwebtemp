const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { getAdminSettings, updateAdminSettings, getNotices, getNoticeById, addNotice, updateNotice, deleteNotice, getFilterSettings, updateFilterSettings } = require('../utils/adminDB');

// Multer configuration for image uploads
const logoStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/images/')
  },
  filename: function (req, file, cb) {
    cb(null, 'logo.png')
  }
});

const uploadLogo = multer({ storage: logoStorage });

// Multer configuration for notice image uploads
const noticeImageStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/images/notices/')
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
  }
});

const uploadNoticeImage = multer({ storage: noticeImageStorage });

// Middleware to check if user is admin (unchanged)
const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.id === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied. Admin only.' });
  }
};

router.get('/', isAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/admin.html'));
});

// Route to upload logo (unchanged)
router.post('/upload-logo', isAdmin, uploadLogo.single('logo'), (req, res) => {
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
    console.error('Error getting admin settings:', error);
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
    console.error('Error updating admin settings:', error);
    res.status(500).json({ message: 'Error updating admin settings' });
  }
});

// Updated routes for notice board functionality
router.get('/notices', async (req, res) => {
  try {
    const notices = await getNotices();
    res.json(notices);
  } catch (error) {
    console.error('Error getting notices:', error);
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
    console.error('Error getting notice:', error);
    res.status(500).json({ message: 'Error getting notice' });
  }
});

// New route for TinyMCE image upload
router.post('/upload-image', isAdmin, uploadNoticeImage.single('image'), (req, res) => {
  if (req.file) {
    res.json({
      success: 1,
      file: {
        url: `/images/notices/${req.file.filename}`
      }
    });
  } else {
    res.status(400).json({ 
      success: 0,
      message: 'Image upload failed' 
    });
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
    console.error('Error adding notice:', error);
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
    console.error('Error updating notice:', error);
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
    console.error('Error deleting notice:', error);
    res.status(500).json({ message: 'Error deleting notice and associated images' });
  }
});

// Filter settings routes (unchanged)
router.get('/filter-settings', isAdmin, async (req, res) => {
  try {
    const settings = await getFilterSettings();
    res.json(settings);
  } catch (error) {
    console.error('Error getting filter settings:', error);
    res.status(500).json({ message: 'Error getting filter settings' });
  }
});

router.post('/filter-settings', isAdmin, async (req, res) => {
  try {
    const { brandFilters, categoryFilters, dateFilters } = req.body;
    await updateFilterSettings(brandFilters, categoryFilters, dateFilters);
    res.json({ message: 'Filter settings updated successfully' });
  } catch (error) {
    console.error('Error updating filter settings:', error);
    res.status(500).json({ message: 'Error updating filter settings' });
  }
});

module.exports = router;