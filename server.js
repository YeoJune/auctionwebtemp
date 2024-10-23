require('dotenv').config();
const express = require('express');
const cors = require("cors");
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const bodyParser = require('body-parser');
const authRoutes = require('./routes/auth');
const wishlistRoutes = require('./routes/wishlist');
const dataRoutes = require('./routes/data');
const crawlerRoutes = require('./routes/crawler');
const bidRoutes = require('./routes/bid');
const adminRoutes = require('./routes/admin');
const valuesRoutes = require('./routes/values');
const pool = require('./utils/DB');

const app = express();

// 프록시 설정
app.set('trust proxy', 1);

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS.split(','),
  credentials: true
}));

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

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
  //console.debug('Session ID:', req.sessionID);
  //console.debug('Session Data:', req.session);
  next();
});

// 라우트
app.use('/api/auth', authRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/crawler', crawlerRoutes);
app.use('/api/bid', bidRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/values', valuesRoutes);

// 정적 파일 서빙
app.use(express.static('public'));

app.get('/', (req, res) => {
  if (req.session.user) res.sendFile(__dirname + '/public/pages/index.html');
  else res.redirect('/signinPage');
});
app.get('/signinPage', (req, res) => {
  res.sendFile(__dirname + '/public/pages/signin.html');
});

// 에러 핸들링 미들웨어
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on ${PORT}`);
});