// routes/users.js
const express = require("express");
const router = express.Router();
const pool = require("../utils/DB");
const crypto = require("crypto");
const GoogleSheetsManager = require("../utils/googleSheets");

// 비밀번호 해싱 함수
function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

// 인증 미들웨어 - 관리자만 접근 가능하도록
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  next();
};

// 회원 목록 조회
router.get("/", requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();

    // 회원 목록 조회
    const [users] = await conn.query(
      "SELECT id, email, created_at, is_active FROM users ORDER BY created_at DESC"
    );

    res.json(users);
  } catch (error) {
    console.error("회원 목록 조회 오류:", error);
    res
      .status(500)
      .json({ message: "회원 목록을 불러오는 중 오류가 발생했습니다." });
  } finally {
    if (conn) conn.release();
  }
});

// 회원 추가
router.post("/", requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const { id, password, email, is_active } = req.body;

    // 필수 필드 검증
    if (!id || !password) {
      return res
        .status(400)
        .json({ message: "아이디와 비밀번호는 필수 입력 항목입니다." });
    }

    // 중복 아이디 확인
    const [existing] = await conn.query("SELECT id FROM users WHERE id = ?", [
      id,
    ]);
    if (existing.length > 0) {
      return res.status(400).json({ message: "이미 사용 중인 아이디입니다." });
    }

    // 비밀번호 해싱
    const hashedPassword = hashPassword(password);

    // 회원 추가
    await conn.query(
      "INSERT INTO users (id, password, email, is_active) VALUES (?, ?, ?, ?)",
      [id, hashedPassword, email || null, is_active === false ? 0 : 1]
    );

    res.status(201).json({ message: "회원이 등록되었습니다." });
  } catch (error) {
    console.error("회원 추가 오류:", error);
    res.status(500).json({ message: "회원 등록 중 오류가 발생했습니다." });
  } finally {
    if (conn) conn.release();
  }
});

// 회원 수정
router.put("/:id", requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const id = req.params.id;
    const { email, password, is_active } = req.body;

    // 회원 존재 확인
    const [existing] = await conn.query("SELECT id FROM users WHERE id = ?", [
      id,
    ]);
    if (existing.length === 0) {
      return res.status(404).json({ message: "회원을 찾을 수 없습니다." });
    }

    // 업데이트할 필드 설정
    const updateFields = [];
    const updateValues = [];

    if (email !== undefined) {
      updateFields.push("email = ?");
      updateValues.push(email);
    }

    if (password) {
      updateFields.push("password = ?");
      updateValues.push(hashPassword(password));
    }

    if (is_active !== undefined) {
      updateFields.push("is_active = ?");
      updateValues.push(is_active ? 1 : 0);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ message: "수정할 정보가 없습니다." });
    }

    // 회원 정보 업데이트
    await conn.query(
      `UPDATE users SET ${updateFields.join(", ")} WHERE id = ?`,
      [...updateValues, id]
    );

    res.json({ message: "회원 정보가 수정되었습니다." });
  } catch (error) {
    console.error("회원 수정 오류:", error);
    res.status(500).json({ message: "회원 정보 수정 중 오류가 발생했습니다." });
  } finally {
    if (conn) conn.release();
  }
});

// 회원 삭제
router.delete("/:id", requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const id = req.params.id;

    // 회원 존재 확인
    const [existing] = await conn.query("SELECT id FROM users WHERE id = ?", [
      id,
    ]);
    if (existing.length === 0) {
      return res.status(404).json({ message: "회원을 찾을 수 없습니다." });
    }

    // 회원 삭제
    await conn.query("DELETE FROM users WHERE id = ?", [id]);

    res.json({ message: "회원이 삭제되었습니다." });
  } catch (error) {
    console.error("회원 삭제 오류:", error);
    res.status(500).json({ message: "회원 삭제 중 오류가 발생했습니다." });
  } finally {
    if (conn) conn.release();
  }
});

// 스프레드시트와 동기화
router.post("/sync", requireAuth, async (req, res) => {
  try {
    await GoogleSheetsManager.syncUsersWithDB();
    res.json({ message: "동기화가 완료되었습니다." });
  } catch (error) {
    console.error("동기화 오류:", error);
    res.status(500).json({ message: "동기화 중 오류가 발생했습니다." });
  }
});

module.exports = router;
