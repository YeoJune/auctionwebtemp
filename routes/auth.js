// routes/auth.js
const express = require("express");
const router = express.Router();
const { pool } = require("../utils/DB");
const crypto = require("crypto");

function hashPassword(password) {
  if (!password) return "";
  else return crypto.createHash("sha256").update(password).digest("hex");
}

router.post("/login", async (req, res) => {
  let conn;
  try {
    const { id, password } = req.body;

    conn = await pool.getConnection();
    const hashedPassword = hashPassword(password);

    // Check user in DB
    const [users] = await conn.query(
      "SELECT id, email, is_active, password FROM users WHERE id = ?",
      [id]
    );

    if (users.length === 0) {
      return res.status(401).json({
        message: "접근 권한이 없습니다. 010-2894-8502를 통해 문의주세요.",
      });
    } else if (users[0].password != hashedPassword) {
      return res.status(401).json({
        message: "비밀번호가 다릅니다.",
      });
    }

    const user = users[0];

    if (!user.is_active) {
      return res.status(403).json({
        message:
          "서비스 기간이 만기되었습니다. 010-2894-8502를 통해 문의주세요.",
      });
    }

    // 로그인 성공
    req.session.user = {
      id: user.id,
      email: user.email,
    };

    res.json({ message: "로그인 성공", user: req.session.user });
  } catch (err) {
    console.error("로그인 중 오류 발생:", err);
    res.status(500).json({ message: "로그인 처리 중 오류가 발생했습니다." });
  } finally {
    if (conn) conn.release();
  }
});

router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("로그아웃 중 오류 발생:", err);
      return res
        .status(500)
        .json({ message: "로그아웃 처리 중 오류가 발생했습니다." });
    }
    res.json({ message: "로그아웃 성공" });
  });
});

router.get("/user", (req, res) => {
  if (req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.status(401).json({ message: "인증되지 않은 사용자입니다." });
  }
});

// Add this route to your routes/auth.js file
router.get("/preview", async (req, res) => {
  res.redirect("/productPage");
});

module.exports = router;
