// utils/middleware.js
const isAuthenticated = (req, res, next) => {
  if (req.session.user && req.session.user.id) {
    next();
  } else {
    res.status(401).json({
      success: false,
      message: "로그인이 필요합니다.",
      code: "UNAUTHENTICATED",
    });
  }
};

const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.id === "admin") {
    next();
  } else {
    res.status(403).json({
      success: false,
      message: "관리자 권한이 필요합니다.",
      code: "FORBIDDEN_ADMIN",
    });
  }
};

module.exports = { isAuthenticated, isAdmin };
