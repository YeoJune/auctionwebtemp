// server.js
require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const bodyParser = require("body-parser");
const authRoutes = require("./routes/auth");
const wishlistRoutes = require("./routes/wishlist");
const dataRoutes = require("./routes/data");
const crawlerRoutes = require("./routes/crawler");
const bidRoutes = require("./routes/bid");
const adminRoutes = require("./routes/admin");
const valuesRoutes = require("./routes/values");
const detailRoutes = require("./routes/detail");
const liveBidsRoutes = require("./routes/live-bids");
const directBidsRoutes = require("./routes/direct-bids");
const userRoutes = require("./routes/users");
const pool = require("./utils/DB");

const app = express();
const server = http.createServer(app);

const metrics = {
  activeUsers: new Map(),
  dailyUsers: new Set(),
  totalRequests: 0,
  lastReset: new Date().setHours(0, 0, 0, 0),
};

// 설정값
const INACTIVE_TIMEOUT = 30 * 60 * 1000; // 30분

// 프록시 설정
app.set("trust proxy", 1);

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS.split(","),
    credentials: true,
  })
);

app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

// 세션 스토어 설정
const sessionStore = new MySQLStore(
  {
    checkExpirationInterval: 900000,
    expiration: 86400000,
    createDatabaseTable: false,
    schema: {
      tableName: "sessions",
      columnNames: {
        session_id: "session_id",
        expires: "expires",
        data: "data",
      },
    },
  },
  pool
);

// 세션 미들웨어 설정
const sessionMiddleware = session({
  key: "session_cookie_name",
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 1일
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
  },
});

app.use(sessionMiddleware);

// 세션 디버깅을 위한 미들웨어
app.use((req, res, next) => {
  //console.debug('Session ID:', req.sessionID);
  //console.debug('Session Data:', req.session);
  next();
});

// 메트릭스 트래킹 미들웨어
app.use((req, res, next) => {
  metrics.totalRequests++;

  if (req.session?.user?.id) {
    const userId = req.session.user.id;
    metrics.activeUsers.set(userId, Date.now());
    metrics.dailyUsers.add(userId);
  }
  next();
});

app.get("/api/metrics", (req, res) => {
  if (!req.session?.user?.id === "admin") {
    return res.status(403).json({ message: "Unauthorized" });
  }

  const now = Date.now();
  const activeCount = Array.from(metrics.activeUsers.values()).filter(
    (lastActivity) => now - lastActivity <= INACTIVE_TIMEOUT
  ).length;

  res.json({
    activeUsers: activeCount,
    dailyUsers: metrics.dailyUsers.size,
    totalRequests: metrics.totalRequests,
  });
});

// 정기적인 작업 수행
setInterval(() => {
  const now = Date.now();
  const midnight = new Date().setHours(0, 0, 0, 0);

  // 자정 지났으면 일일 사용자 초기화
  if (metrics.lastReset < midnight) {
    metrics.dailyUsers.clear();
    metrics.lastReset = midnight;
  }

  // 30분 이상 비활성 사용자 제거
  for (const [userId, lastActivity] of metrics.activeUsers) {
    if (now - lastActivity > INACTIVE_TIMEOUT) {
      metrics.activeUsers.delete(userId);
    }
  }
}, 300000); // 5분

// 라우트
app.use("/api/auth", authRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/data", dataRoutes);
app.use("/api/crawler", crawlerRoutes);
app.use("/api/bid", bidRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/values", valuesRoutes);
app.use("/api/detail", detailRoutes);
app.use("/api/live-bids", liveBidsRoutes);
app.use("/api/direct-bids", directBidsRoutes);
app.use("/api/users", userRoutes);

// 정적 파일 서빙
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/pages/intro.html");
});
app.get("/productPage", (req, res) => {
  if (req.session.user) res.sendFile(__dirname + "/pages/product.html");
  else res.redirect("/signinPage");
});
app.get("/signinPage", (req, res) => {
  if (req.session.user) res.redirect("/productPage");
  else res.sendFile(__dirname + "/public/pages/signin.html");
});
app.get("/valuesPage", (req, res) => {
  if (req.session.user) res.sendFile(__dirname + "/pages/values.html");
  else res.redirect("/signinPage");
});

// 관리자 페이지 라우트
app.get("/admin", (req, res) => {
  if (req.session.user && req.session.user.id === "admin") {
    res.sendFile(__dirname + "/pages/admin/index.html");
  } else {
    res.redirect("/signinPage");
  }
});

app.get("/admin/live-bids", (req, res) => {
  if (req.session.user && req.session.user.id === "admin") {
    res.sendFile(__dirname + "/pages/admin/live-bids.html");
  } else {
    res.redirect("/signinPage");
  }
});

app.get("/admin/direct-bids", (req, res) => {
  if (req.session.user && req.session.user.id === "admin") {
    res.sendFile(__dirname + "/pages/admin/direct-bids.html");
  } else {
    res.redirect("/signinPage");
  }
});

app.get("/admin/invoices", (req, res) => {
  if (req.session.user && req.session.user.id === "admin") {
    res.sendFile(__dirname + "/pages/admin/invoices.html");
  } else {
    res.redirect("/signinPage");
  }
});

app.get("/admin/settings", (req, res) => {
  if (req.session.user && req.session.user.id === "admin") {
    res.sendFile(__dirname + "/pages/admin/settings.html");
  } else {
    res.redirect("/signinPage");
  }
});

app.get("/admin/users", (req, res) => {
  if (req.session.user && req.session.user.id === "admin") {
    res.sendFile(__dirname + "/pages/admin/users.html");
  } else {
    res.redirect("/signinPage");
  }
});

// 에러 핸들링 미들웨어
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong!" });
});

// 서버 시작
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on ${PORT}`);
});
