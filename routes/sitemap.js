// routes/sitemap.js
const express = require("express");
const router = express.Router();

// Express 앱에서 라우트를 자동 추출하는 함수
function extractRoutes(app) {
  const routes = [];

  // Express 앱의 모든 라우터 스택을 순회
  function extractFromStack(stack, basePath = "") {
    stack.forEach((layer) => {
      if (layer.route) {
        // 일반 라우트
        const path = basePath + layer.route.path;
        const methods = Object.keys(layer.route.methods);

        if (methods.includes("get")) {
          routes.push({
            path: path,
            method: "GET",
          });
        }
      } else if (layer.name === "router") {
        // 서브 라우터
        const subPath = layer.regexp.source
          .replace("\\/?", "")
          .replace("(?=\\/|$)", "")
          .replace(/\\\//g, "/")
          .replace(/\$.*/, "");

        if (layer.handle && layer.handle.stack) {
          extractFromStack(layer.handle.stack, basePath + subPath);
        }
      }
    });
  }

  extractFromStack(app._router.stack);
  return routes;
}

// 페이지 라우트만 필터링 (API 제외)
function filterPageRoutes(routes) {
  return routes.filter((route) => {
    const path = route.path;

    // 제외할 패턴들
    const excludePatterns = [
      /^\/api/, // API 라우트 (모든 하위 경로 포함)
      /^\/admin(?!$)/, // 관리자 하위 페이지 (/admin은 포함, /admin/xxx는 제외)
      /^\/appr\/admin/, // 감정 시스템 관리자
      /\/payment-processing/, // 결제 처리 페이지
      /\/:[\w]+/, // 파라미터가 있는 동적 라우트
      /^\/(sitemap|robots)/, // 사이트맵, robots.txt
      /^\/debug/, // 디버그 라우트
    ];

    // 빈 경로나 undefined 제외
    if (!path || path === "") {
      return false;
    }

    // 제외 패턴에 매치되는지 확인
    const shouldExclude = excludePatterns.some((pattern) => pattern.test(path));

    // 로그인이 필요한 페이지들 (SEO상 제외하는 것이 좋음)
    const authRequiredPages = [
      "/valuesPage",
      "/bidResultsPage",
      "/bidProductsPage",
      "/appr/mypage",
    ];

    // 인증 필요 페이지도 제외 (선택적)
    const isAuthRequired = authRequiredPages.includes(path);

    return !shouldExclude && !isAuthRequired;
  });
}

// 라우트에 SEO 메타데이터 자동 할당
function assignSEOMetadata(routes) {
  return routes.map((route) => {
    const path = route.path;

    // 우선순위 자동 할당
    let priority = "0.5";
    let changefreq = "weekly";

    if (path === "/" || path === "/productPage" || path === "/appr") {
      priority = "1.0";
      changefreq = "daily";
    } else if (path.includes("bid") || path.includes("values")) {
      priority = "0.9";
      changefreq = "daily";
    } else if (path.includes("signin") || path.includes("guide")) {
      priority = "0.8";
      changefreq = "monthly";
    } else if (path.includes("inquiry") || path.includes("repair")) {
      priority = "0.7";
      changefreq = "monthly";
    }

    return {
      ...route,
      priority,
      changefreq,
      lastmod: new Date().toISOString().split("T")[0],
    };
  });
}

// 사이트맵 XML 생성
function generateSitemap(baseUrl, routes) {
  let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

  routes.forEach((route) => {
    // 동적 라우트는 예시 URL로 변환 (선택사항)
    let url = route.path;
    if (url.includes(":")) {
      // 동적 파라미터가 있는 경우 건너뛰거나 예시값 사용
      return;
    }

    sitemap += `
  <url>
    <loc>${baseUrl}${url}</loc>
    <lastmod>${route.lastmod}</lastmod>
    <changefreq>${route.changefreq}</changefreq>
    <priority>${route.priority}</priority>
  </url>`;
  });

  sitemap += `
</urlset>`;
  return sitemap;
}

// 자동 사이트맵 생성 라우트
router.get("/sitemap.xml", (req, res) => {
  try {
    const app = req.app; // Express 앱 인스턴스
    const host = req.headers.host;
    const protocol =
      req.secure || req.headers["x-forwarded-proto"] === "https"
        ? "https"
        : "http";
    const baseUrl = `${protocol}://${host}`;

    // 1. 앱에서 모든 라우트 추출
    const allRoutes = extractRoutes(app);

    // 2. 페이지 라우트만 필터링
    let pageRoutes = filterPageRoutes(allRoutes);

    // 3. 호스트별 필터링
    if (host === "cassystem.com" || host === "www.cassystem.com") {
      // 감정 시스템 페이지만
      pageRoutes = pageRoutes.filter(
        (route) => route.path.startsWith("/appr") || route.path === "/"
      );
    } else if (host === "casastrade.com" || host === "www.casastrade.com") {
      // 메인 서비스 페이지만 (감정 시스템 제외)
      pageRoutes = pageRoutes.filter(
        (route) => !route.path.startsWith("/appr")
      );
    } else {
      // 개발/기타 도메인: 모든 페이지 포함
      // 필요시 여기서 필터링 로직 추가
    }

    // 4. SEO 메타데이터 할당
    const routesWithMeta = assignSEOMetadata(pageRoutes);

    // 5. XML 생성
    const sitemap = generateSitemap(baseUrl, routesWithMeta);

    res.set("Content-Type", "application/xml");
    res.send(sitemap);

    // 디버깅용 로그
    console.log(
      `Generated sitemap for ${host} with ${routesWithMeta.length} routes`
    );
  } catch (error) {
    console.error("Auto sitemap generation error:", error);
    res.status(500).send("Internal Server Error");
  }
});

// 디버깅용: 감지된 모든 라우트 보기
router.get("/debug/routes", (req, res) => {
  try {
    const app = req.app;
    const allRoutes = extractRoutes(app);
    const pageRoutes = filterPageRoutes(allRoutes);

    res.json({
      total: allRoutes.length,
      pages: pageRoutes.length,
      allRoutes: allRoutes,
      pageRoutes: pageRoutes,
    });
  } catch (error) {
    console.error("Route debug error:", error);
    res.status(500).json({ error: "Failed to extract routes" });
  }
});

// robots.txt (기존과 동일)
router.get("/robots.txt", (req, res) => {
  try {
    const host = req.headers.host;
    const protocol =
      req.secure || req.headers["x-forwarded-proto"] === "https"
        ? "https"
        : "http";
    const baseUrl = `${protocol}://${host}`;

    const robotsTxt = `User-agent: *
Allow: /

# 관리자 페이지는 크롤링 금지
Disallow: /admin
Disallow: /appr/admin
Disallow: /api/

# 로그인이 필요한 페이지
Disallow: /valuesPage
Disallow: /bidResultsPage
Disallow: /bidProductsPage
Disallow: /appr/mypage
Disallow: /appr/payment-processing.html

# 사이트맵 위치
Sitemap: ${baseUrl}/sitemap.xml`;

    res.set("Content-Type", "text/plain");
    res.send(robotsTxt);
  } catch (error) {
    console.error("Robots.txt generation error:", error);
    res.status(500).send("Internal Server Error");
  }
});

module.exports = router;
