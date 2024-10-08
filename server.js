require('dotenv').config();
const express = require('express');
const cors = require("cors");
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const cron = require('node-cron');
const authRoutes = require('./routes/auth');
const wishlistRoutes = require('./routes/wishlist');
const dataRoutes = require('./routes/data');
const crawlerRoutes = require('./routes/crawler');
const bidRoutes = require('./routes/bid');
const adminRoutes = require('./routes/admin');
const logger = require('./utils/logger');
const {ecoAucCrawler, brandAuctionCrawler} = require('./Scripts/crawler');
const DBManager = require('./Scripts/crawler');
const { getAdminSettings, updateAdminSettings } = require('./utils/adminDB');
const pool = require('./utils/DB');

const app = express();

// 프록시 설정
app.set('trust proxy', 1);

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS.split(','),
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 세션 스토어 설정
const sessionStore = new MySQLStore({
  checkExpirationInterval: 900000,
  expiration: 86400000,
  createDatabaseTable: false,
  schema: {
    tableName: 'sessions',
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data'
    }
  }
}, pool);

// 세션 미들웨어 설정
app.use(session({
  key: 'session_cookie_name',
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// 세션 디버깅을 위한 미들웨어
app.use((req, res, next) => {
  logger.debug('Session ID:', req.sessionID);
  logger.debug('Session Data:', req.session);
  next();
});

// 라우트
app.use('/api/auth', authRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/crawler', crawlerRoutes);
app.use('/api/bid', bidRoutes);
app.use('/api/admin', adminRoutes);

// 정적 파일 서빙
app.use(express.static('public'));

app.get('/', (req, res) => {
  if (req.session.user) res.sendFile(__dirname + '/public/pages/index.html');
  else res.redirect('/signinPage');
});
app.get('/signinPage', (req, res) => {
  res.sendFile(__dirname + '/public/pages/signin.html');
});

const scheduleCrawling = async () => {
  const settings = await getAdminSettings();
  if (settings && settings.crawlSchedule) {
    const [hours, minutes] = settings.crawlSchedule.split(':');
    cron.schedule(`${minutes} ${hours} * * *`, async () => {
      logger.info('Running scheduled crawling task');
      try {
        let ecoAucItems = await ecoAucCrawler.refresh();
        let brandAuctionItems = await brandAuctionCrawler.refresh();
        if (!ecoAucItems) ecoAucItems = [];
        if (!brandAuctionItems) brandAuctionItems = [];

        await DBManager.saveData([...ecoAucItems, ...brandAuctionItems]);
        logger.info('Scheduled crawling completed successfully');
      } catch (error) {
        logger.error('Scheduled crawling error:', error);
      }
    }, {
      scheduled: true,
      timezone: "Asia/Seoul"
    });
  }
};

scheduleCrawling();

// 에러 핸들링 미들웨어
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server is running on ${PORT}`);
});
