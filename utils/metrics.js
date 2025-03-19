// metrics.js
const fs = require("fs");
const path = require("path");
const url = require("url");

// 메트릭스 데이터 파일 경로
const METRICS_FILE = path.join(__dirname, "data", "metrics.json");
const INACTIVE_TIMEOUT = 30 * 60 * 1000; // 30분

// 초기 메트릭스 객체
const defaultMetrics = {
  memberActiveUsers: new Map(),
  guestActiveUsers: new Map(),
  memberDailyUsers: new Set(),
  guestDailyUsers: new Set(),
  totalRequests: 0,
  lastReset: new Date().setHours(0, 0, 0, 0),
  lastSaved: Date.now(),
};

// 메트릭스 객체 (Map과 Set을 직렬화하기 위해 객체로 변환)
let metrics = { ...defaultMetrics };

// 이미 카운트된 세션 추적을 위한 맵
// 키: 세션ID, 값: { lastPath: 마지막 경로, lastCounted: 마지막 카운트 시간 }
const sessionPathTracker = new Map();

// 데이터 디렉토리 확인 및 생성
function ensureDataDirectory() {
  const dataDir = path.join(__dirname, "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// 메트릭스 데이터 로드
function loadMetrics() {
  if (process.env.NODE_ENV === "development") {
    return;
  }

  ensureDataDirectory();

  try {
    if (fs.existsSync(METRICS_FILE)) {
      const data = JSON.parse(fs.readFileSync(METRICS_FILE, "utf8"));

      // Map과 Set 복원
      metrics.memberActiveUsers = new Map(
        Object.entries(data.memberActiveUsers || {})
      );
      metrics.guestActiveUsers = new Map(
        Object.entries(data.guestActiveUsers || {})
      );
      metrics.memberDailyUsers = new Set(data.memberDailyUsers || []);
      metrics.guestDailyUsers = new Set(data.guestDailyUsers || []);
      metrics.totalRequests = data.totalRequests || 0;
      metrics.lastReset = data.lastReset || new Date().setHours(0, 0, 0, 0);
      metrics.lastSaved = data.lastSaved || Date.now();

      console.log("메트릭스 데이터를 로드했습니다.");
    }
  } catch (error) {
    console.error("메트릭스 데이터 로드 중 오류:", error);
  }
}

// 메트릭스 데이터 저장
function saveMetrics() {
  if (process.env.NODE_ENV === "development") {
    return;
  }

  ensureDataDirectory();

  try {
    // Map과 Set을 직렬화 가능한 형태로 변환
    const dataToSave = {
      memberActiveUsers: Object.fromEntries(metrics.memberActiveUsers),
      guestActiveUsers: Object.fromEntries(metrics.guestActiveUsers),
      memberDailyUsers: Array.from(metrics.memberDailyUsers),
      guestDailyUsers: Array.from(metrics.guestDailyUsers),
      totalRequests: metrics.totalRequests,
      lastReset: metrics.lastReset,
      lastSaved: Date.now(),
    };

    fs.writeFileSync(METRICS_FILE, JSON.stringify(dataToSave, null, 2));
    metrics.lastSaved = Date.now();
  } catch (error) {
    console.error("메트릭스 데이터 저장 중 오류:", error);
  }
}

// 리소스 요청 여부 확인 (JS, CSS, 이미지 등)
function isResourceRequest(req) {
  const parsedUrl = url.parse(req.url);
  const path = parsedUrl.pathname;

  // 정적 리소스 요청인지 확인
  if (path) {
    const ext = path.split(".").pop().toLowerCase();
    const resourceExtensions = [
      "css",
      "js",
      "png",
      "jpg",
      "jpeg",
      "gif",
      "svg",
      "ico",
      "woff",
      "woff2",
      "ttf",
      "eot",
    ];

    // API 요청이거나 정적 리소스면 제외
    if (path.startsWith("/api/") || resourceExtensions.includes(ext)) {
      return true;
    }
  }

  return false;
}

// 메트릭스 미들웨어
function metricsMiddleware(req, res, next) {
  if (process.env.NODE_ENV === "development") {
    return next();
  }

  // 항상 총 요청 수는 증가
  metrics.totalRequests++;

  // 정적 리소스 요청은 사용자 추적에서 제외
  if (isResourceRequest(req)) {
    return next();
  }

  const now = Date.now();
  const currentPath = req.path || req.url;

  // 세션ID 생성 (회원/비회원 구분)
  const sessionId = req.session?.user?.id || req.sessionID;
  const isMember = !!req.session?.user?.id;

  // 같은 세션의 같은 페이지 방문을 필터링
  const sessionInfo = sessionPathTracker.get(sessionId);
  const TEN_SECONDS = 10 * 1000; // 10초 쿨다운

  if (sessionInfo) {
    // 같은 경로에 10초 이내 재접속하는 경우 카운트하지 않음 (새로고침 등)
    if (
      sessionInfo.lastPath === currentPath &&
      now - sessionInfo.lastCounted < TEN_SECONDS
    ) {
      return next();
    }
  }

  // 세션 추적 정보 업데이트
  sessionPathTracker.set(sessionId, {
    lastPath: currentPath,
    lastCounted: now,
  });

  // 회원/비회원 분리하여 추적
  if (isMember) {
    metrics.memberActiveUsers.set(sessionId, now);
    metrics.memberDailyUsers.add(sessionId);
  } else {
    metrics.guestActiveUsers.set(sessionId, now);
    metrics.guestDailyUsers.add(sessionId);
  }

  // 5분마다 파일에 저장 (성능 최적화)
  if (now - metrics.lastSaved > 5 * 60 * 1000) {
    saveMetrics();
  }

  next();
}

// 메트릭스 정기 작업 (비활성 사용자 제거, 일일 리셋, 저장)
function setupMetricsJobs() {
  if (process.env.NODE_ENV === "development") {
    return;
  }

  // 초기 로드
  loadMetrics();

  // 5분마다 실행
  setInterval(() => {
    const now = Date.now();
    const midnight = new Date().setHours(0, 0, 0, 0);

    // 자정 지났으면 일일 사용자 초기화
    if (metrics.lastReset < midnight) {
      metrics.memberDailyUsers.clear();
      metrics.guestDailyUsers.clear();
      metrics.lastReset = midnight;

      // 세션 추적기도 초기화
      sessionPathTracker.clear();
    }

    // 30분 이상 비활성 사용자 제거
    for (const [userId, lastActivity] of metrics.memberActiveUsers) {
      if (now - lastActivity > INACTIVE_TIMEOUT) {
        metrics.memberActiveUsers.delete(userId);
        sessionPathTracker.delete(userId);
      }
    }

    for (const [sessionId, lastActivity] of metrics.guestActiveUsers) {
      if (now - lastActivity > INACTIVE_TIMEOUT) {
        metrics.guestActiveUsers.delete(sessionId);
        sessionPathTracker.delete(sessionId);
      }
    }

    // 메트릭스 저장
    saveMetrics();
  }, 5 * 60 * 1000); // 5분

  // 서버 종료 시 메트릭스 저장
  process.on("SIGINT", () => {
    console.log("서버 종료 중... 메트릭스 데이터 저장");
    saveMetrics();
    process.exit(0);
  });
}

// 메트릭스 조회 엔드포인트 핸들러
function getMetrics(req, res) {
  if (!req.session?.user?.id || req.session.user.id !== "admin") {
    return res.status(403).json({ message: "Unauthorized" });
  }

  const now = Date.now();

  // 활성 사용자 계산 (30분 이내 활동)
  const activeMemberCount = Array.from(
    metrics.memberActiveUsers.values()
  ).filter((lastActivity) => now - lastActivity <= INACTIVE_TIMEOUT).length;

  const activeGuestCount = Array.from(metrics.guestActiveUsers.values()).filter(
    (lastActivity) => now - lastActivity <= INACTIVE_TIMEOUT
  ).length;

  res.json({
    activeMemberUsers: activeMemberCount,
    activeGuestUsers: activeGuestCount,
    totalActiveUsers: activeMemberCount + activeGuestCount,
    dailyMemberUsers: metrics.memberDailyUsers.size,
    dailyGuestUsers: metrics.guestDailyUsers.size,
    totalDailyUsers:
      metrics.memberDailyUsers.size + metrics.guestDailyUsers.size,
    totalRequests: metrics.totalRequests,
    lastReset: new Date(metrics.lastReset).toISOString(),
  });
}

module.exports = {
  metricsMiddleware,
  setupMetricsJobs,
  getMetrics,
};
