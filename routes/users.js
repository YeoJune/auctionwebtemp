// routes/users.js
const express = require("express");
const router = express.Router();
const { pool } = require("../utils/DB");
const crypto = require("crypto");
const GoogleSheetsManager = require("../utils/googleSheets");

// 비밀번호 해싱 함수
function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

// 인증 미들웨어 - normal 권한 사용자만 접근 가능하도록
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }

  // normal role 체크 추가
  if (req.session.user.role !== "normal") {
    return res.status(403).json({ message: "접근 권한이 없습니다." });
  }

  next();
};

router.get("/current", requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const userId = req.session.user.id; // 세션에서 사용자 ID 가져오기

    // 사용자 정보 조회 - normal 사용자만
    const [users] = await conn.query(
      `SELECT id, login_id, registration_date, email, business_number, company_name, 
       phone, address, is_active, created_at, commission_rate 
       FROM users WHERE id = ? AND role = 'normal'`,
      [userId],
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

// 회원 목록 조회 - normal 사용자만
router.get("/", requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();

    // 회원 목록 조회 - normal 사용자만, 예치금/한도 + 최근 입찰/누적 입찰 통계 포함
    const [users] = await conn.query(
      `SELECT u.id, u.login_id, u.registration_date, u.email, u.business_number, u.company_name, 
       u.phone, u.address, u.created_at, u.is_active, u.commission_rate,
       ua.account_type, ua.deposit_balance, ua.daily_limit, ua.daily_used,
       COALESCE(bt.total_bid_count, 0) AS total_bid_count,
       COALESCE(bt.total_bid_jpy, 0) AS total_bid_jpy,
       lb.last_bid_at,
       lb.last_bid_type,
       lb.last_bid_id,
       lb.last_bid_item_id,
       CASE
         WHEN u.company_name REGEXP '-[A-Za-z0-9]+$' THEN 1
         ELSE 0
       END AS company_has_code,
       CASE
         WHEN u.company_name REGEXP '-[A-Za-z0-9]+$'
           THEN SUBSTRING_INDEX(u.company_name, '-', -1)
         ELSE NULL
       END AS company_code,
       CASE
         WHEN u.company_name REGEXP '-[A-Za-z0-9]+$'
           THEN SUBSTRING(
             u.company_name,
             1,
             CHAR_LENGTH(u.company_name) - CHAR_LENGTH(SUBSTRING_INDEX(u.company_name, '-', -1)) - 1
           )
         ELSE u.company_name
       END AS company_base_name,
       CASE
         WHEN lb.last_bid_at IS NOT NULL THEN TIMESTAMPDIFF(DAY, lb.last_bid_at, NOW())
         ELSE TIMESTAMPDIFF(DAY, COALESCE(u.registration_date, u.created_at), NOW())
       END AS no_bid_days,
       CASE
         WHEN u.is_active = 1
           AND (
             (lb.last_bid_at IS NOT NULL AND TIMESTAMPDIFF(DAY, lb.last_bid_at, NOW()) >= 50)
             OR
             (lb.last_bid_at IS NULL AND TIMESTAMPDIFF(DAY, COALESCE(u.registration_date, u.created_at), NOW()) >= 50)
           )
         THEN 1
         ELSE 0
       END AS deactivate_candidate,
       CASE
         WHEN lb.last_bid_at IS NULL
           THEN CONCAT('가입 후 ', TIMESTAMPDIFF(DAY, COALESCE(u.registration_date, u.created_at), NOW()), '일 무입찰')
         ELSE CONCAT('최근 입찰 후 ', TIMESTAMPDIFF(DAY, lb.last_bid_at, NOW()), '일 경과')
       END AS deactivate_reason,
       CASE
         WHEN YEAR(COALESCE(u.registration_date, u.created_at)) <= 2025
           THEN '주의: 구회원(보증금 환불/비활성 처리 여부 확인 필요)'
         ELSE ''
       END AS deactivate_note
       FROM users u
       LEFT JOIN user_accounts ua ON u.id = ua.user_id
       LEFT JOIN (
         SELECT
           user_id,
           COUNT(*) AS total_bid_count,
           COALESCE(SUM(amount_jpy), 0) AS total_bid_jpy
         FROM (
           SELECT
             user_id,
             COALESCE(
               CAST(REPLACE(COALESCE(winning_price, final_price, second_price, first_price), ',', '') AS DECIMAL(18,2)),
               0
             ) AS amount_jpy
           FROM live_bids
           WHERE user_id IS NOT NULL
             AND status IN ('completed', 'domestic_arrived', 'processing', 'shipped')
           UNION ALL
           SELECT
             user_id,
             COALESCE(
               CAST(REPLACE(COALESCE(winning_price, current_price), ',', '') AS DECIMAL(18,2)),
               0
             ) AS amount_jpy
           FROM direct_bids
           WHERE user_id IS NOT NULL
             AND status IN ('completed', 'domestic_arrived', 'processing', 'shipped')
         ) t
         GROUP BY user_id
       ) bt ON bt.user_id = u.id
       LEFT JOIN (
         SELECT
           t.user_id,
           MAX(t.bid_at) AS last_bid_at,
           SUBSTRING_INDEX(
             GROUP_CONCAT(t.bid_type ORDER BY t.bid_at DESC, t.bid_id DESC SEPARATOR ','),
             ',',
             1
           ) AS last_bid_type,
           SUBSTRING_INDEX(
             GROUP_CONCAT(t.bid_id ORDER BY t.bid_at DESC, t.bid_id DESC SEPARATOR ','),
             ',',
             1
           ) AS last_bid_id,
           SUBSTRING_INDEX(
             GROUP_CONCAT(t.item_id ORDER BY t.bid_at DESC, t.bid_id DESC SEPARATOR ','),
             ',',
             1
           ) AS last_bid_item_id
         FROM (
           SELECT user_id, 'live' AS bid_type, id AS bid_id, item_id, created_at AS bid_at
           FROM live_bids
           WHERE user_id IS NOT NULL
           UNION ALL
           SELECT user_id, 'direct' AS bid_type, id AS bid_id, item_id, created_at AS bid_at
           FROM direct_bids
           WHERE user_id IS NOT NULL
         ) t
         GROUP BY t.user_id
       ) lb ON lb.user_id = u.id
       WHERE u.role = 'normal' 
       ORDER BY u.created_at DESC`,
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

// 특정 회원 입찰 내역 조회
router.get("/:id/bid-history", requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const userId = req.params.id;

    const [userRows] = await conn.query(
      `SELECT id, login_id, company_name
       FROM users
       WHERE id = ? AND role = 'normal'
       LIMIT 1`,
      [userId],
    );

    if (!userRows.length) {
      return res.status(404).json({ message: "회원을 찾을 수 없습니다." });
    }

    const [summaryRows] = await conn.query(
      `
      SELECT
        COUNT(*) AS total_bid_count,
        COALESCE(SUM(t.bid_price_jpy), 0) AS total_bid_jpy,
        COALESCE(
          SUM(
            CASE
              WHEN t.status IN ('completed', 'domestic_arrived', 'processing', 'shipped') THEN 1
              ELSE 0
            END
          ),
          0
        ) AS completed_count
      FROM (
        SELECT
          l.status,
          COALESCE(
            CAST(REPLACE(COALESCE(l.winning_price, l.final_price, l.second_price, l.first_price), ',', '') AS DECIMAL(18,2)),
            0
          ) AS bid_price_jpy
        FROM live_bids l
        WHERE l.user_id = ?
          AND l.status IN ('completed', 'domestic_arrived', 'processing', 'shipped')
        UNION ALL
        SELECT
          d.status,
          COALESCE(
            CAST(REPLACE(COALESCE(d.winning_price, d.current_price), ',', '') AS DECIMAL(18,2)),
            0
          ) AS bid_price_jpy
        FROM direct_bids d
        WHERE d.user_id = ?
          AND d.status IN ('completed', 'domestic_arrived', 'processing', 'shipped')
      ) t
      `,
      [userId, userId],
    );

    const [historyRows] = await conn.query(
      `
      SELECT *
      FROM (
        SELECT
          'live' AS bid_type,
          l.id AS bid_id,
          l.item_id,
          COALESCE(ci.original_title, ci.title) AS item_title,
          ci.auc_num,
          l.status,
          COALESCE(
            CAST(REPLACE(COALESCE(l.winning_price, l.final_price, l.second_price, l.first_price), ',', '') AS DECIMAL(18,2)),
            0
          ) AS bid_price_jpy,
          COALESCE(l.completed_at, l.updated_at, l.created_at) AS bid_at
        FROM live_bids l
        LEFT JOIN crawled_items ci
          ON CONVERT(ci.item_id USING utf8mb4) = CONVERT(l.item_id USING utf8mb4)
        WHERE l.user_id = ?
          AND l.status IN ('completed', 'domestic_arrived', 'processing', 'shipped')
        UNION ALL
        SELECT
          'direct' AS bid_type,
          d.id AS bid_id,
          d.item_id,
          COALESCE(ci.original_title, ci.title) AS item_title,
          ci.auc_num,
          d.status,
          COALESCE(
            CAST(REPLACE(COALESCE(d.winning_price, d.current_price), ',', '') AS DECIMAL(18,2)),
            0
          ) AS bid_price_jpy,
          COALESCE(d.completed_at, d.updated_at, d.created_at) AS bid_at
        FROM direct_bids d
        LEFT JOIN crawled_items ci
          ON CONVERT(ci.item_id USING utf8mb4) = CONVERT(d.item_id USING utf8mb4)
        WHERE d.user_id = ?
          AND d.status IN ('completed', 'domestic_arrived', 'processing', 'shipped')
      ) h
      ORDER BY h.bid_at DESC, h.bid_id DESC
      LIMIT 200
      `,
      [userId, userId],
    );

    const summary = summaryRows[0] || {
      total_bid_count: 0,
      total_bid_jpy: 0,
      completed_count: 0,
    };

    res.json({
      user: userRows[0],
      summary: {
        totalBidCount: Number(summary.total_bid_count || 0),
        totalBidJpy: Number(summary.total_bid_jpy || 0),
        completedCount: Number(summary.completed_count || 0),
      },
      history: historyRows || [],
    });
  } catch (error) {
    console.error("회원 입찰 내역 조회 오류:", error);
    res.status(500).json({ message: "회원 입찰 내역 조회 중 오류가 발생했습니다." });
  } finally {
    if (conn) conn.release();
  }
});

// 특정 회원 조회 - normal 사용자만
router.get("/:id", requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const id = req.params.id;

    // 회원 정보 조회 - normal 사용자만
    const [users] = await conn.query(
      `SELECT id, login_id, registration_date, email, business_number, company_name, 
       phone, address, is_active, created_at, commission_rate 
       FROM users WHERE id = ? AND role = 'normal'`,
      [id],
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

// 회원 추가 - normal 사용자로 등록
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
      commission_rate,
    } = req.body;

    // 필수 필드 검증
    if (!id || !password) {
      return res
        .status(400)
        .json({ message: "아이디와 비밀번호는 필수 입력 항목입니다." });
    }

    // 중복 아이디 확인 - login_id로 체크
    const [existing] = await conn.query(
      "SELECT id FROM users WHERE login_id = ?",
      [id],
    );
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

    // 회원 추가 - normal role로 설정, login_id 사용
    const [result] = await conn.query(
      `INSERT INTO users (
        login_id, 
        registration_date,
        password, 
        email, 
        business_number,
        company_name,
        phone,
        address,
        is_active,
        commission_rate,
        role
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        commission_rate || null,
        "normal", // normal role로 설정
      ],
    );

    // 생성된 사용자의 auto-increment ID 반환
    const newUserId = result.insertId;

    res.status(201).json({
      message: "회원이 등록되었습니다.",
      userId: newUserId,
    });
  } catch (error) {
    console.error("회원 추가 오류:", error);
    res.status(500).json({ message: "회원 등록 중 오류가 발생했습니다." });
  } finally {
    if (conn) conn.release();
  }
});

// 회원 수정 - normal 사용자만
router.put("/:id", requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const id = req.params.id;
    const {
      new_login_id,
      email,
      password,
      is_active,
      registration_date,
      business_number,
      company_name,
      phone,
      address,
      commission_rate,
    } = req.body;

    // 회원 존재 확인 - normal 사용자만
    const [existing] = await conn.query(
      "SELECT id FROM users WHERE id = ? AND role = 'normal'",
      [id],
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: "회원을 찾을 수 없습니다." });
    }

    // login_id 변경 시 중복 확인
    if (new_login_id !== undefined) {
      const [duplicateCheck] = await conn.query(
        "SELECT id FROM users WHERE login_id = ? AND id != ?",
        [new_login_id, id],
      );
      if (duplicateCheck.length > 0) {
        return res
          .status(400)
          .json({ message: "이미 사용 중인 아이디입니다." });
      }
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

    if (new_login_id !== undefined) {
      updateFields.push("login_id = ?");
      updateValues.push(new_login_id);
    }

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

    if (commission_rate !== undefined) {
      updateFields.push("commission_rate = ?");
      updateValues.push(commission_rate);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ message: "수정할 정보가 없습니다." });
    }

    // 회원 정보 업데이트 - normal 사용자만
    await conn.query(
      `UPDATE users SET ${updateFields.join(
        ", ",
      )} WHERE id = ? AND role = 'normal'`,
      [...updateValues, id],
    );

    res.json({ message: "회원 정보가 수정되었습니다." });
  } catch (error) {
    console.error("회원 수정 오류:", error);
    res.status(500).json({ message: "회원 정보 수정 중 오류가 발생했습니다." });
  } finally {
    if (conn) conn.release();
  }
});

// 회원 삭제 - normal 사용자만
router.delete("/:id", requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const id = req.params.id;

    // 회원 존재 확인 - normal 사용자만
    const [existing] = await conn.query(
      "SELECT id FROM users WHERE id = ? AND role = 'normal'",
      [id],
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: "회원을 찾을 수 없습니다." });
    }

    // 회원 삭제 - normal 사용자만
    await conn.query("DELETE FROM users WHERE id = ? AND role = 'normal'", [
      id,
    ]);

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
