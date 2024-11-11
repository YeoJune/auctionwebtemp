const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const { getAdminSettings, updateAdminSettings, getNotices, getNoticeById, addNotice, updateNotice, deleteNotice } = require('../utils/adminDB');
const { getFilterSettings, updateFilterSetting, initializeFilterSettings } = require('../utils/filterDB');

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
const noticeImageStorage = multer.memoryStorage();
const uploadNoticeImage = multer({ 
  storage: noticeImageStorage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Please upload an image.'), false);
    }
  }
});

// Middleware to check if user is admin (unchanged)
const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.id === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied. Admin only.' });
  }
};

// 메트릭스 데이터를 저장할 객체
const metrics = {
  activeUsers: new Set(),
  dailyVisitors: new Set(),
  totalRequests: 0,
  requestsPerEndpoint: {},
  lastReset: new Date().setHours(0, 0, 0, 0) // 오늘 자정
};

// 매일 자정에 일일 방문자 수 초기화
setInterval(() => {
  const now = new Date();
  const midnight = new Date().setHours(0, 0, 0, 0);
  
  if (metrics.lastReset < midnight) {
    metrics.dailyVisitors.clear();
    metrics.lastReset = midnight;
  }
}, 60000); // 1분마다 체크

// 메트릭스 트래킹 미들웨어
router.use((req, res, next) => {
  // 총 요청 수 증가
  metrics.totalRequests++;
  
  // 엔드포인트별 요청 수 트래킹
  const endpoint = req.originalUrl.split('?')[0];
  metrics.requestsPerEndpoint[endpoint] = (metrics.requestsPerEndpoint[endpoint] || 0) + 1;
  
  // 활성 사용자 및 일일 방문자 트래킹
  if (req.session.user) {
    metrics.activeUsers.add(req.session.user.id);
    metrics.dailyVisitors.add(req.session.user.id);
  }
  
  next();
});

// 30분 동안 요청이 없는 사용자는 활성 사용자에서 제외
setInterval(() => {
  const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
  metrics.activeUsers.forEach(userId => {
    const lastActivity = userLastActivity.get(userId) || 0;
    if (lastActivity < thirtyMinutesAgo) {
      metrics.activeUsers.delete(userId);
    }
  });
}, 60000); // 1분마다 체크

// 메트릭스 조회 엔드포인트
router.get('/metrics', isAdmin, (req, res) => {
  const currentMetrics = {
    activeUsers: metrics.activeUsers.size,
    todayVisitors: metrics.dailyVisitors.size,
    totalRequests: metrics.totalRequests,
    requestsPerEndpoint: metrics.requestsPerEndpoint,
    lastUpdated: new Date().toISOString()
  };
  
  res.json(currentMetrics);
});

// 메트릭스 초기화 엔드포인트
router.post('/metrics/reset', isAdmin, (req, res) => {
  metrics.totalRequests = 0;
  metrics.requestsPerEndpoint = {};
  res.json({ message: 'Metrics reset successfully' });
});

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
router.post('/upload-image', isAdmin, uploadNoticeImage.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: 0,
        message: 'No file uploaded' 
      });
    }

    const uniqueSuffix = Date.now() + '-' + uuidv4();
    const filename = `notice-${uniqueSuffix}.webp`;
    const outputPath = path.join(__dirname, '../public/images/notices', filename);

    await sharp(req.file.buffer)
      .webp({ 
        quality: 100,
      })
      .toFile(outputPath);

    res.json({
      success: 1,
      file: {
        url: `/images/notices/${filename}`
      }
    });

  } catch (error) {
    console.error('Error processing notice image:', error);
    res.status(400).json({ 
      success: 0,
      message: 'Image processing failed' 
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

// Filter Settings Routes
router.get('/filter-settings', async (req, res) => {
  try {
    const settings = await getFilterSettings();
    res.json(settings);
  } catch (error) {
    console.error('Error getting filter settings:', error);
    res.status(500).json({ message: 'Error getting filter settings' });
  }
});

router.put('/filter-settings', isAdmin, async (req, res) => {
  try {
    const { filterType, filterValue, isEnabled } = req.body;
    
    if (!filterType || filterValue === undefined || isEnabled === undefined) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    
    if (!['date', 'brand', 'category'].includes(filterType)) {
      return res.status(400).json({ message: 'Invalid filter type' });
    }

    const result = await updateFilterSetting(filterType, filterValue, isEnabled);
    res.json(result);
  } catch (error) {
    console.error('Error updating filter setting:', error);
    res.status(500).json({ message: 'Error updating filter setting' });
  }
});

// Route to initialize all filter settings
router.post('/filter-settings/initialize', isAdmin, async (req, res) => {
  try {
    await initializeFilterSettings();
    res.json({ message: 'Filter settings initialized successfully' });
  } catch (error) {
    console.error('Error initializing filter settings:', error);
    res.status(500).json({ message: 'Error initializing filter settings' });
  }
});

// Batch update filter settings
router.put('/filter-settings/batch', isAdmin, async (req, res) => {
  try {
    const { settings } = req.body;
    
    if (!Array.isArray(settings)) {
      return res.status(400).json({ message: 'Settings must be an array' });
    }

    const results = [];
    for (const setting of settings) {
      const { filterType, filterValue, isEnabled } = setting;
      
      if (!filterType || filterValue === undefined || isEnabled === undefined) {
        continue;
      }
      
      if (!['date', 'brand', 'category'].includes(filterType)) {
        continue;
      }

      const result = await updateFilterSetting(filterType, filterValue, isEnabled);
      results.push(result);
    }

    res.json({ 
      message: 'Batch update completed',
      updated: results
    });
  } catch (error) {
    console.error('Error performing batch update of filter settings:', error);
    res.status(500).json({ message: 'Error updating filter settings' });
  }
});

module.exports = router;