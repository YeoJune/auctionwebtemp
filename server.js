// server.js
require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const bodyParser = require("body-parser");
const path = require("path");
const pool = require("./utils/DB"); // DB 연결 풀
const fs = require("fs");
const { isAuthenticated } = require("./utils/middleware"); // 인증 미들웨어

// --- 사이트맵 라우트 ---
const sitemapRoutes = require("./routes/sitemap");

// --- 기존 서비스 라우트 ---
const authRoutes = require("./routes/auth");
const wishlistRoutes = require("./routes/wishlist");
const dataRoutes = require("./routes/data");
const { router: crawlerRoutes, initializeSocket } = require("./routes/crawler");
const bidRoutes = require("./routes/bid");
const adminMainRoutes = require("./routes/admin"); // 기존 메인 서비스 관리자 API (admin.js)
const valuesRoutes = require("./routes/values");
const detailRoutes = require("./routes/detail");
const liveBidsRoutes = require("./routes/live-bids");
const directBidsRoutes = require("./routes/direct-bids");
const userRoutes = require("./routes/users");
const dashboardRoutes = require("./routes/dashboard");

// --- 감정 시스템 관련 라우트 ---
const appraisalsApprRoutes = require("./routes/appr/appraisals");
const restorationsApprRoutes = require("./routes/appr/restorations");
const paymentsApprRoutes = require("./routes/appr/payments");
const usersApprRoutes = require("./routes/appr/users");
const adminApiApprRoutes = require("./routes/appr/admin"); // 감정 시스템 관리자용 API

// utils
const metricsModule = require("./utils/metrics");

// init
const app = express();
const server = http.createServer(app);
global.io = initializeSocket(server);

app.set("trust proxy", 1);
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : true,
    credentials: true,
  })
);
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

app.use("/favicon.ico", (req, res) => {
  const host = req.headers.host;
  let faviconPath;

  if (host === "cassystem.com" || host === "www.cassystem.com") {
    faviconPath = path.join(
      __dirname,
      "public",
      "images",
      "favicon-cassystem.png"
    );
  } else {
    faviconPath = path.join(
      __dirname,
      "public",
      "images",
      "favicon-casastrade.png"
    );
  }

  // favicon 파일이 존재하는지 확인
  if (fs.existsSync(faviconPath)) {
    res.sendFile(faviconPath);
  } else {
    // 파일이 없으면 기본 favicon 사용
    res.sendFile(path.join(__dirname, "public", "images", "favicon.png"));
  }
});

const sessionStore = new MySQLStore(
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    clearExpired: true,
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

const sessionMiddleware = session({
  key: "session_cookie_name",
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
  },
});
app.use(sessionMiddleware);

app.use(metricsModule.metricsMiddleware);

// --- API 라우트 마운트 ---
app.use("/api/auth", authRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/data", dataRoutes);
app.use("/api/crawler", crawlerRoutes);
app.use("/api/bid", bidRoutes);
app.use("/api/admin", adminMainRoutes); // 기존 메인 서비스 관리자 API
app.use("/api/values", valuesRoutes);
app.use("/api/detail", detailRoutes);
app.use("/api/live-bids", liveBidsRoutes);
app.use("/api/direct-bids", directBidsRoutes);
app.use("/api/users", userRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.get("/api/metrics", metricsModule.getMetrics);
app.post("/api/metrics/reset", metricsModule.resetMetrics);

app.use("/api/appr/appraisals", appraisalsApprRoutes);
app.use("/api/appr/restorations", restorationsApprRoutes);
app.use("/api/appr/payments", paymentsApprRoutes);
app.use("/api/appr/users", usersApprRoutes);
app.use("/api/appr/admin", adminApiApprRoutes);

// --- 정적 파일 및 HTML 페이지 서빙 ---
const publicPath = path.join(__dirname, "public");
const mainPagesPath = path.join(__dirname, "pages");
const apprPagesPath = path.join(__dirname, "pages", "appr");

app.use(express.static(publicPath));

// 메인 서비스 페이지
app.use((req, res, next) => {
  const host = req.headers.host;
  if (host === "cassystem.com" || host === "www.cassystem.com") {
    if (
      !req.path.startsWith("/appr") &&
      !req.path.startsWith("/api") &&
      !req.path.startsWith("/sitemap") &&
      !req.path.startsWith("/robots")
    ) {
      req.url = "/appr" + req.url;
    }
  }
  next();
});

app.use(sitemapRoutes);

app.get("/naver113e5904aa2153fc24ab52f90746a797.html", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "naver113e5904aa2153fc24ab52f90746a797.html")
  );
});

app.get("/", (req, res) => {
  res.redirect("/productPage");
});

app.get("/productPage", (req, res) => {
  res.sendFile(path.join(mainPagesPath, "product.html"));
});
app.get("/signinPage", (req, res) => {
  res.sendFile(path.join(mainPagesPath, "signin.html"));
}); // 경로 통일
app.get("/valuesPage", (req, res) => {
  if (req.session.user) res.sendFile(path.join(mainPagesPath, "values.html"));
  else res.redirect("/signinPage");
});
app.get("/bidResultsPage", (req, res) => {
  if (req.session.user)
    res.sendFile(path.join(mainPagesPath, "bid-results.html"));
  else res.redirect("/signinPage");
});
app.get("/bidProductsPage", (req, res) => {
  if (req.session.user)
    res.sendFile(path.join(mainPagesPath, "bid-products.html"));
  else res.redirect("/signinPage");
});
app.get("/inquiryPage", (req, res) => {
  res.sendFile(path.join(mainPagesPath, "inquiry.html"));
});
app.get("/guidePage", (req, res) => {
  res.sendFile(path.join(mainPagesPath, "guide.html"));
});

// 메인 서비스 관리자 페이지 (제공해주신 원본 코드의 라우트들)
app.get("/admin", (req, res) => {
  if (req.session.user && req.session.user.id === "admin") {
    res.sendFile(path.join(mainPagesPath, "admin", "index.html"));
  } else {
    res.redirect("/signinPage");
  }
});
app.get("/admin/live-bids", (req, res) => {
  if (req.session.user && req.session.user.id === "admin") {
    res.sendFile(path.join(mainPagesPath, "admin", "live-bids.html"));
  } else {
    res.redirect("/signinPage");
  }
});
app.get("/admin/direct-bids", (req, res) => {
  if (req.session.user && req.session.user.id === "admin") {
    res.sendFile(path.join(mainPagesPath, "admin", "direct-bids.html"));
  } else {
    res.redirect("/signinPage");
  }
});
app.get("/admin/invoices", (req, res) => {
  if (req.session.user && req.session.user.id === "admin") {
    res.sendFile(path.join(mainPagesPath, "admin", "invoices.html"));
  } else {
    res.redirect("/signinPage");
  }
});
app.get("/admin/settings", (req, res) => {
  if (req.session.user && req.session.user.id === "admin") {
    res.sendFile(path.join(mainPagesPath, "admin", "settings.html"));
  } else {
    res.redirect("/signinPage");
  }
});
app.get("/admin/users", (req, res) => {
  if (req.session.user && req.session.user.id === "admin") {
    res.sendFile(path.join(mainPagesPath, "admin", "users.html"));
  } else {
    res.redirect("/signinPage");
  }
});

// 감정 시스템 페이지
app.get("/appr", (req, res) => {
  res.sendFile(path.join(apprPagesPath, "index.html"));
});
app.get("/appr/signin", (req, res) => {
  if (req.session.user) {
    res.redirect("/appr");
  } else {
    res.sendFile(path.join(apprPagesPath, "signin.html"));
  }
});
app.get("/appr/request", (req, res) => {
  res.sendFile(path.join(apprPagesPath, "request.html"));
});
app.get("/appr/request-repair/:certificateNumber", (req, res) => {
  res.sendFile(path.join(apprPagesPath, "request-repair.html"));
});
// 감정번호 조회 페이지
app.get("/appr/result", (req, res) => {
  res.sendFile(path.join(apprPagesPath, "result.html"));
});
// 감정서 조회 통합 라우트 (공개 조회)
app.get("/appr/result/:certificateNumber", async (req, res) => {
  try {
    const certificateNumber = req.params.certificateNumber;

    // DB 연결
    const conn = await pool.getConnection();

    try {
      // 먼저 감정서 번호로 조회
      const [appraisal] = await conn.query(
        `SELECT appraisal_type, certificate_number FROM appraisals WHERE certificate_number = ?`,
        [certificateNumber]
      );

      if (appraisal.length > 0) {
        // 본인의 감정서인 경우: 감정 유형에 따라 상세 페이지로
        if (appraisal[0].appraisal_type === "quicklink") {
          return res.sendFile(path.join(apprPagesPath, "quick-result.html"));
        } else {
          return res.sendFile(path.join(apprPagesPath, "result-detail.html"));
        }
      } else {
        // 감정서 번호로 찾을 수 없는 경우, 감정 ID로 시도
        const [appraisalById] = await conn.query(
          `SELECT appraisal_type, certificate_number FROM appraisals WHERE id = ?`,
          [certificateNumber]
        );

        if (appraisalById.length > 0) {
          // 감정번호로 리다이렉션
          return res.redirect(
            `/appr/result/${appraisalById[0].certificate_number}`
          );
        } else {
          // 찾을 수 없는 경우 감정번호 조회 페이지로 리다이렉션
          return res.redirect(
            `/appr/result?error=not_found&id=${encodeURIComponent(
              certificateNumber
            )}`
          );
        }
      }
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error("감정서 조회 중 오류:", error);
    // 오류 발생 시 감정번호 조회 페이지로 리다이렉션
    return res.redirect(`/appr/result?error=server_error`);
  }
});
app.get("/appr/repair", (req, res) => {
  res.sendFile(path.join(apprPagesPath, "repair.html"));
});
app.get("/appr/authenticity", (req, res) => {
  res.sendFile(path.join(apprPagesPath, "authenticity.html"));
});
app.get("/appr/issue/:appraisalId", (req, res) => {
  res.sendFile(path.join(apprPagesPath, "issue.html"));
});
app.get("/appr/mypage", (req, res) => {
  if (req.session.user) {
    res.sendFile(path.join(apprPagesPath, "mypage.html"));
  } else {
    res.redirect("/appr/signin");
  }
});
app.get("/appr/admin", (req, res) => {
  // 감정 시스템 관리자 HTML 페이지
  if (req.session.user && req.session.user.id === "admin") {
    res.sendFile(path.join(apprPagesPath, "admin.html")); // pages/appr/admin.html
  } else {
    res.redirect(req.session.user ? "/appr" : "/appr/signin");
  }
});
// 나이스페이 결제 완료 후 돌아올 프론트엔드 페이지 (이 페이지에서 서버 API 호출)
app.get("/appr/payment-processing.html", isAuthenticated, (req, res) => {
  // 이 페이지는 서버로부터 리다이렉션될 때 orderId를 쿼리 파라미터로 받게 됩니다.
  res.sendFile(path.join(apprPagesPath, "payment-processing.html"));
});

// 최하단 에러 핸들링 미들웨어
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err.stack || err);
  if (!res.headersSent) {
    res.status(500).json({ message: "서버 내부 오류가 발생했습니다." });
  }
});

metricsModule.setupMetricsJobs();
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Frontend URL for QR/Links: ${process.env.FRONTEND_URL}`);
});
