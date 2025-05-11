// server.js
require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const bodyParser = require("body-parser");

// routes
const authRoutes = require("./routes/auth");
const wishlistRoutes = require("./routes/wishlist");
const dataRoutes = require("./routes/data");
const { router: crawlerRoutes, initializeSocket } = require("./routes/crawler");
const bidRoutes = require("./routes/bid");
const adminRoutes = require("./routes/admin");
const valuesRoutes = require("./routes/values");
const detailRoutes = require("./routes/detail");
const liveBidsRoutes = require("./routes/live-bids");
const directBidsRoutes = require("./routes/direct-bids");
const userRoutes = require("./routes/users");
const appraisalRoutes = require("./routes/appraisal"); // 실제 파일은 appraisal.js 일 수 있음
const certificateRoutes = require("./routes/certificate"); // 실제 파일은 certificate.js 일 수 있음
const restorationRoutes = require("./routes/restoration"); // 실제 파일은 restoration.js 일 수 있음

// utils
const pool = require("./utils/DB");
const metricsModule = require("./utils/metrics");
const dashboardRoutes = require("./routes/dashboard");

// init
const app = express();
const server = http.createServer(app);

global.io = initializeSocket(server);

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

// 메트릭스 트래킹 미들웨어 추가
app.use(metricsModule.metricsMiddleware);

// 메트릭스 조회 엔드포인트
app.get("/api/metrics", metricsModule.getMetrics);
app.post("/api/metrics/reset", metricsModule.resetMetrics);

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
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/appraisals", appraisalRoutes);
app.use("/api/certificates", certificateRoutes);
app.use("/api/restoration", restorationRoutes);

// 정적 파일 서빙
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.redirect("/productPage");
});
app.get("/productPage", (req, res) => {
  res.sendFile(__dirname + "/pages/product.html");
});
app.get("/signinPage", (req, res) => {
  res.sendFile(__dirname + "/public/pages/signin.html");
});
app.get("/valuesPage", (req, res) => {
  if (req.session.user) res.sendFile(__dirname + "/pages/values.html");
  else res.redirect("/signinPage");
});
app.get("/bidResultsPage", (req, res) => {
  if (req.session.user) res.sendFile(__dirname + "/pages/bid-results.html");
  else res.redirect("/signinPage");
});
app.get("/bidProductsPage", (req, res) => {
  if (req.session.user) res.sendFile(__dirname + "/pages/bid-products.html");
  else res.redirect("/signinPage");
});

app.get("/inquiryPage", (req, res) => {
  res.sendFile(__dirname + "/pages/inquiry.html");
});

app.get("/guidePage", (req, res) => {
  res.sendFile(__dirname + "/pages/guide.html");
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

// 감정 시스템 관련 페이지 라우트
app.get("/appr", (req, res) => {
  res.sendFile(__dirname + "/pages/appr/index.html");
});

app.get("/appr/signin", (req, res) => {
  if (req.session.user) {
    res.redirect("/appr");
  } else {
    res.sendFile(__dirname + "/pages/appr/signin.html");
  }
});

app.get("/appr/request", (req, res) => {
  res.sendFile(__dirname + "/pages/appr/request.html");
});

app.get("/appr/result", (req, res) => {
  res.sendFile(__dirname + "/pages/appr/result.html");
});

app.get("/appr/result-detail/:certificateNumber", (req, res) => {
  res.sendFile(__dirname + "/pages/appr/result-detail.html");
});

app.get("/appr/quick-result/:requestId", (req, res) => {
  res.sendFile(__dirname + "/pages/appr/quick-result.html");
});

app.get("/appr/repair", (req, res) => {
  res.sendFile(__dirname + "/pages/appr/repair.html");
});

app.get("/appr/authenticity", (req, res) => {
  res.sendFile(__dirname + "/pages/appr/authenticity.html");
});

app.get("/appr/issue/:certificateNumber", (req, res) => {
  res.sendFile(__dirname + "/pages/appr/issue.html");
});

// 에러 핸들링 미들웨어
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong!" });
});

// 메트릭스 정기 작업 설정
metricsModule.setupMetricsJobs();

// 서버 시작
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on ${PORT}`);
});
