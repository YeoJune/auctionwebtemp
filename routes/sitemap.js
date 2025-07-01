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
      } else if (
        layer.name === "router" &&
        layer.handle &&
        layer.handle.stack
      ) {
        // 서브 라우터 - 정규식 파싱을 더 안전하게
        let subPath = "";
        try {
          const regexpSource = layer.regexp.source;
          // 복잡한 정규식 파싱 대신 간단한 매칭만 사용
          if (regexpSource.includes("api")) {
            subPath = "/api"; // API 라우터는 무시
            return; // API 라우터는 건너뛰기
          }
          // 다른 서브패스 처리도 안전하게
          const matches = regexpSource.match(/^\\\/([\w-]+)/);
          if (matches) {
            subPath = "/" + matches[1];
          }
        } catch (e) {
          console.warn("라우트 파싱 에러:", e);
          return; // 파싱 실패시 건너뛰기
        }

        extractFromStack(layer.handle.stack, basePath + subPath);
      }
    });
  }

  try {
    extractFromStack(app._router.stack);
  } catch (error) {
    console.warn("라우트 추출 중 에러:", error);
    return []; // 에러 발생시 빈 배열 반환
  }

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

    // 안전한 방법: 허용할 페이지만 명시적으로 정의
    const allowedRoutes = [
      "/",
      "/productPage",
      "/signinPage",
      "/inquiryPage",
      "/guidePage",
      "/appr",
      "/appr/signin",
      "/appr/request",
      "/appr/result",
      "/appr/repair",
      "/appr/authenticity",
    ];

    // 호스트별 필터링
    let pageRoutes;
    if (host === "cassystem.com" || host === "www.cassystem.com") {
      // 감정 시스템 페이지만
      pageRoutes = allowedRoutes.filter(
        (route) => route.startsWith("/appr") || route === "/"
      );
    } else if (host === "casastrade.com" || host === "www.casastrade.com") {
      // 메인 서비스 페이지만 (감정 시스템 제외)
      pageRoutes = allowedRoutes.filter((route) => !route.startsWith("/appr"));
    } else {
      // 개발/기타 도메인: 자동 추출 방식 사용
      const allRoutes = extractRoutes(app);
      const filteredRoutes = filterPageRoutes(allRoutes);
      pageRoutes = filteredRoutes.map((route) => route.path);
    }

    // 라우트 객체로 변환
    const routesWithMeta = pageRoutes.map((path) => ({
      path: path,
      priority: getPriority(path),
      changefreq: getChangeFreq(path),
      lastmod: new Date().toISOString().split("T")[0],
    }));

    // XML 생성
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

// 우선순위 할당 함수
function getPriority(path) {
  if (path === "/" || path === "/productPage" || path === "/appr") {
    return "1.0";
  } else if (path.includes("signin") || path.includes("guide")) {
    return "0.8";
  } else if (path.includes("inquiry") || path.includes("repair")) {
    return "0.7";
  }
  return "0.5";
}

// 변경 빈도 할당 함수
function getChangeFreq(path) {
  if (path === "/" || path === "/productPage" || path === "/appr") {
    return "daily";
  } else if (path.includes("signin") || path.includes("guide")) {
    return "monthly";
  }
  return "weekly";
}

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
