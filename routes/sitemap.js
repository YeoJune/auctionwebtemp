// routes/sitemap.js - 간단한 자동 사이트맵 생성기
const express = require("express");
const router = express.Router();

// Express 앱에서 GET 라우트만 추출
function extractGetRoutes(app) {
  const routes = [];

  function scan(stack, prefix = "") {
    stack.forEach((layer) => {
      if (layer.route && layer.route.methods.get) {
        // 일반 GET 라우트
        routes.push(prefix + layer.route.path);
      } else if (layer.name === "router" && layer.handle?.stack) {
        // 중첩 라우터 - 단순하게 처리
        scan(layer.handle.stack, prefix);
      }
    });
  }

  if (app._router?.stack) {
    scan(app._router.stack);
  }

  return routes;
}

// 사이트맵에 포함할 페이지만 필터링
function filterPages(routes) {
  return routes.filter((path) => {
    // API 제외
    if (path.startsWith("/api")) return false;

    // 관리자 페이지 제외
    if (path.includes("/admin")) return false;

    // 동적 라우트 제외
    if (path.includes(":")) return false;

    // 시스템 페이지 제외
    if (
      path.includes("sitemap") ||
      path.includes("robots") ||
      path.includes("debug")
    )
      return false;

    // 인증 필요 페이지 제외
    const authPages = [
      "/valuesPage",
      "/bidResultsPage",
      "/bidProductsPage",
      "/appr/mypage",
    ];
    if (authPages.includes(path)) return false;

    return true;
  });
}

// XML 사이트맵 생성
function createSitemap(baseUrl, paths) {
  const now = new Date().toISOString().split("T")[0];

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  paths.forEach((path) => {
    const priority = path === "/" ? "1.0" : "0.5";
    const changefreq = path === "/" ? "daily" : "weekly";

    xml += "  <url>\n";
    xml += `    <loc>${baseUrl}${path}</loc>\n`;
    xml += `    <lastmod>${now}</lastmod>\n`;
    xml += `    <changefreq>${changefreq}</changefreq>\n`;
    xml += `    <priority>${priority}</priority>\n`;
    xml += "  </url>\n";
  });

  xml += "</urlset>";
  return xml;
}

// 사이트맵 라우트
router.get("/sitemap.xml", (req, res) => {
  try {
    const host = req.headers.host;
    const protocol = req.secure ? "https" : "http";
    const baseUrl = `${protocol}://${host}`;

    // 1. 모든 GET 라우트 추출
    const allRoutes = extractGetRoutes(req.app);

    // 2. 페이지만 필터링
    let pageRoutes = filterPages(allRoutes);

    // 3. 도메인별 필터링
    if (host === "cassystem.com" || host === "www.cassystem.com") {
      // 감정 시스템만
      pageRoutes = pageRoutes.filter(
        (path) => path.startsWith("/appr") || path === "/"
      );
    } else if (host === "casastrade.com" || host === "www.casastrade.com") {
      // 메인 서비스만
      pageRoutes = pageRoutes.filter((path) => !path.startsWith("/appr"));
    }

    // 4. XML 생성
    const sitemap = createSitemap(baseUrl, pageRoutes);

    res.set("Content-Type", "application/xml");
    res.send(sitemap);
  } catch (error) {
    console.error("Sitemap error:", error);
    res.status(500).send("Error generating sitemap");
  }
});

// robots.txt
router.get("/robots.txt", (req, res) => {
  const host = req.headers.host;
  const protocol = req.secure ? "https" : "http";
  const baseUrl = `${protocol}://${host}`;

  const robots = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/
Disallow: /appr/admin
Disallow: /valuesPage
Disallow: /bidResultsPage
Disallow: /bidProductsPage
Disallow: /appr/mypage

Sitemap: ${baseUrl}/sitemap.xml`;

  res.set("Content-Type", "text/plain");
  res.send(robots);
});

// 디버그용 (개발시에만)
router.get("/debug/routes", (req, res) => {
  const allRoutes = extractGetRoutes(req.app);
  const pageRoutes = filterPages(allRoutes);

  res.json({
    all: allRoutes,
    pages: pageRoutes,
  });
});

module.exports = router;
