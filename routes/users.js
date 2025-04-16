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

router.get("/current", requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const userId = req.session.user.id; // 세션에서 사용자 ID 가져오기

    // 사용자 정보 조회
    const [users] = await conn.query(
      `SELECT id, registration_date, email, business_number, company_name, 
       phone, address, is_active, created_at, commission_rate 
       FROM users WHERE id = ?`,
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: "회원을 찾을 수 없습니다." });
    }

    res.json(users[0]);
  } catch (error) {
    console.error("현재 사용자 정보 조회 오류:", error);
    res
      .status(500)
      .json({ message: "사용자 정보를 불러오는 중 오류가 발생했습니다." });
  } finally {
    if (conn) conn.release();
  }
});

// 회원 목록 조회
router.get("/", requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();

    // 회원 목록 조회 - 수수료율 필드 추가
    const [users] = await conn.query(
      `SELECT id, registration_date, email, business_number, company_name, 
       phone, address, created_at, is_active, commission_rate 
       FROM users ORDER BY created_at DESC`
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

// 특정 회원 조회
router.get("/:id", requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const id = req.params.id;

    // 회원 정보 조회 - 수수료율 필드 추가
    const [users] = await conn.query(
      `SELECT id, registration_date, email, business_number, company_name, 
       phone, address, is_active, created_at, commission_rate 
       FROM users WHERE id = ?`,
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: "회원을 찾을 수 없습니다." });
    }

    res.json(users[0]);
  } catch (error) {
    console.error("회원 조회 오류:", error);
    res
      .status(500)
      .json({ message: "회원 정보를 불러오는 중 오류가 발생했습니다." });
  } finally {
    if (conn) conn.release();
  }
});

// 회원 추가
router.post("/", requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const {
      id,
      password,
      email,
      is_active,
      registration_date,
      business_number,
      company_name,
      phone,
      address,
      commission_rate, // 수수료율 필드 추가
    } = req.body;

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

    // 날짜 형식 변환
    const formattedDate = registration_date
      ? formatDateString(registration_date)
      : null;

    // 전화번호 형식 정규화
    let normalizedPhone = phone ? phone.replace(/[^0-9]/g, "") : null;
    if (normalizedPhone) {
      // 10으로 시작하면 010으로 변경
      if (normalizedPhone.startsWith("10")) {
        normalizedPhone = "0" + normalizedPhone;
      }
    }

    // 비밀번호 해싱
    const hashedPassword = hashPassword(password);

    // 회원 추가 - 수수료율 필드 추가
    await conn.query(
      `INSERT INTO users (
        id, 
        registration_date,
        password, 
        email, 
        business_number,
        company_name,
        phone,
        address,
        is_active,
        commission_rate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        formattedDate,
        hashedPassword,
        email || null,
        business_number || null,
        company_name || null,
        normalizedPhone || null,
        address || null,
        is_active === false ? 0 : 1,
        commission_rate || null, // 수수료율 기본값 null
      ]
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
    const {
      email,
      password,
      is_active,
      registration_date,
      business_number,
      company_name,
      phone,
      address,
      commission_rate, // 수수료율 필드 추가
    } = req.body;

    // 회원 존재 확인
    const [existing] = await conn.query("SELECT id FROM users WHERE id = ?", [
      id,
    ]);
    if (existing.length === 0) {
      return res.status(404).json({ message: "회원을 찾을 수 없습니다." });
    }

    // 날짜 형식 변환
    const formattedDate = registration_date
      ? formatDateString(registration_date)
      : null;

    // 전화번호 형식 정규화
    let normalizedPhone = null;
    if (phone !== undefined) {
      normalizedPhone = phone ? phone.replace(/[^0-9]/g, "") : null;
      if (normalizedPhone && normalizedPhone.startsWith("10")) {
        normalizedPhone = "0" + normalizedPhone;
      }
    }

    // 업데이트할 필드 설정
    const updateFields = [];
    const updateValues = [];

    if (registration_date !== undefined) {
      updateFields.push("registration_date = ?");
      updateValues.push(formattedDate);
    }

    if (email !== undefined) {
      updateFields.push("email = ?");
      updateValues.push(email);
    }

    if (password) {
      updateFields.push("password = ?");
      updateValues.push(hashPassword(password));
    }

    if (business_number !== undefined) {
      updateFields.push("business_number = ?");
      updateValues.push(business_number);
    }

    if (company_name !== undefined) {
      updateFields.push("company_name = ?");
      updateValues.push(company_name);
    }

    if (phone !== undefined) {
      updateFields.push("phone = ?");
      updateValues.push(normalizedPhone);
    }

    if (address !== undefined) {
      updateFields.push("address = ?");
      updateValues.push(address);
    }

    if (is_active !== undefined) {
      updateFields.push("is_active = ?");
      updateValues.push(is_active ? 1 : 0);
    }

    // 수수료율 필드 업데이트 처리
    if (commission_rate !== undefined) {
      updateFields.push("commission_rate = ?");
      updateValues.push(commission_rate);
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

// 스프레드시트와 동기화 - DB 우선으로 변경
router.post("/sync", requireAuth, async (req, res) => {
  try {
    // DB 정보를 우선으로 하는 동기화 메서드 호출
    await GoogleSheetsManager.syncUsersWithDB();
    res.json({ message: "DB에서 스프레드시트로 동기화가 완료되었습니다." });
  } catch (error) {
    console.error("동기화 오류:", error);
    res.status(500).json({ message: "동기화 중 오류가 발생했습니다." });
  }
});

/**
 * 다양한 형식의 날짜 문자열을 YYYY-MM-DD 형식으로 변환
 */
function formatDateString(dateStr) {
  // 입력이 없거나 null이면 null 반환
  if (!dateStr) return null;

  // 이미 YYYY-MM-DD 형식이면 그대로 반환
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // YYYY.MM.DD 또는 YYYY.M.D 형식 처리
  const dotFormat = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/;
  if (dotFormat.test(dateStr)) {
    const matches = dateStr.match(dotFormat);
    const year = matches[1];
    const month = matches[2].padStart(2, "0");
    const day = matches[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // YYYY/MM/DD 또는 YYYY/M/D 형식 처리
  const slashFormat = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
  if (slashFormat.test(dateStr)) {
    const matches = dateStr.match(slashFormat);
    const year = matches[1];
    const month = matches[2].padStart(2, "0");
    const day = matches[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // YY.MM.DD 또는 YY.M.D 형식 처리 (20xx년으로 간주)
  const shortYearFormat = /^(\d{2})\.(\d{1,2})\.(\d{1,2})$/;
  if (shortYearFormat.test(dateStr)) {
    const matches = dateStr.match(shortYearFormat);
    const year = `20${matches[1]}`; // 20xx년으로 가정 (21세기)
    const month = matches[2].padStart(2, "0");
    const day = matches[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // 그 외 형식은 Date 객체로 파싱 시도
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return null; // 유효하지 않은 날짜
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  } catch (e) {
    return null; // 파싱 실패
  }
}

module.exports = router;
