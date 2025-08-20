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

    // Check user in DB - role 필드도 조회
    const [users] = await conn.query(
      "SELECT id, email, is_active, password, role FROM users WHERE id = ?",
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

    // 로그인 성공 - role 정보도 세션에 저장
    req.session.user = {
      id: user.id,
      email: user.email,
      role: user.role,
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

// 회원가입 API - appr 사용자용
router.post("/register", async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const { id, password, email, company_name, phone } = req.body;

    // 필수 필드 검증
    if (!id || !password || !email) {
      return res.status(400).json({
        success: false,
        message: "아이디, 비밀번호, 이메일은 필수 입력 항목입니다.",
      });
    }

    // 아이디 형식 검증
    if (!/^[a-zA-Z0-9]{3,20}$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: "아이디는 영문, 숫자만 사용하여 3-20자로 입력해주세요.",
      });
    }

    // 비밀번호 길이 검증
    if (password.length < 4) {
      return res.status(400).json({
        success: false,
        message: "비밀번호는 최소 4자 이상 입력해주세요.",
      });
    }

    // 이메일 형식 검증
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "올바른 이메일 형식을 입력해주세요.",
      });
    }

    // 중복 아이디 확인
    const [existingUser] = await conn.query(
      "SELECT id FROM users WHERE id = ?",
      [id]
    );

    if (existingUser.length > 0) {
      return res.status(400).json({
        success: false,
        message: "이미 사용 중인 아이디입니다.",
      });
    }

    // 중복 이메일 확인
    const [existingEmail] = await conn.query(
      "SELECT email FROM users WHERE email = ?",
      [email]
    );

    if (existingEmail.length > 0) {
      return res.status(400).json({
        success: false,
        message: "이미 사용 중인 이메일입니다.",
      });
    }

    // 전화번호 형식 정규화
    let normalizedPhone = null;
    if (phone) {
      normalizedPhone = phone.replace(/[^0-9]/g, "");
      if (normalizedPhone.startsWith("10")) {
        normalizedPhone = "0" + normalizedPhone;
      }
    }

    // 비밀번호 해싱
    const hashedPassword = hashPassword(password);

    // 회원 정보 저장 - role을 'appr'로 설정
    await conn.query(
      `INSERT INTO users (
        id, password, email, company_name, phone, 
        is_active, registration_date, role
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        hashedPassword,
        email,
        company_name || null,
        normalizedPhone || null,
        0, // appr 사용자는 비활성으로 저장 (normal 사이트용)
        new Date().toISOString().split("T")[0], // 오늘 날짜
        "appr", // appr 사용자로 설정
      ]
    );

    res.status(201).json({
      success: true,
      message: "회원가입이 완료되었습니다. 로그인해주세요.",
    });
  } catch (error) {
    console.error("회원가입 오류:", error);
    res.status(500).json({
      success: false,
      message: "회원가입 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// Add this route to your routes/auth.js file
router.get("/preview", async (req, res) => {
  res.redirect("/productPage");
});

module.exports = router;
