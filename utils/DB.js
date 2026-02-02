// utils/DB.js
require("dotenv").config();
const mysql = require("mysql2/promise");

// 메인 애플리케이션용 연결 풀
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME,
  connectionLimit: 100,
  charset: "utf8mb4",
  connectTimeout: 10000,
  // 추가 안정성 설정
  idleTimeout: 300000, // 5분 후 유휴 연결 해제
  maxIdle: 40, // 최대 유휴 연결 수
});

// 세션 스토어 전용 연결 풀 (별도 관리)
const sessionPool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME,
  connectionLimit: 20, // 세션용 전용 연결
  charset: "utf8mb4",
  connectTimeout: 10000,
  idleTimeout: 120000, // 2분 후 유휴 연결 해제
  maxIdle: 8,
});

// 연결 상태 모니터링 함수
async function monitorConnections() {
  try {
    const [maxConn] = await pool.query("SHOW VARIABLES LIKE 'max_connections'");
    const [currentConn] = await pool.query(
      "SHOW STATUS LIKE 'Threads_connected'",
    );

    console.log(`MySQL Max Connections: ${maxConn[0].Value}`);
    console.log(`Current Active Connections: ${currentConn[0].Value}`);
    console.log(
      `Pool Status - Active: ${pool.pool._allConnections.length}, Free: ${pool.pool._freeConnections.length}`,
    );
  } catch (err) {
    console.error("Connection monitoring error:", err);
  }
}

// 안전한 쿼리 실행 함수
async function safeQuery(query, params = []) {
  let conn;
  try {
    conn = await pool.getConnection();
    const [rows] = await conn.query(query, params);
    return rows;
  } catch (error) {
    console.error("Query error:", error);
    throw error;
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

// 연결 풀 상태 체크 (개발 환경에서만)
if (process.env.NODE_ENV !== "production") {
  setInterval(monitorConnections, 60000); // 1분마다 모니터링
}

// test 쿼리 (수정됨)
async function testConnection() {
  let conn;
  try {
    conn = await pool.getConnection();
    console.log("Successfully connected to the database");
    const queries1 = [``];
    const queries = [
      // ========================================
      // 1. users 테이블 구조 확인
      // ========================================
      `DESCRIBE users`,
      `SELECT id, login_id, email, role FROM users LIMIT 5`,
      `SELECT COUNT(*) as total_users FROM users`,

      // ========================================
      // 2. 각 테이블의 user_id 타입 확인
      // ========================================
      `SELECT 
    TABLE_NAME,
    COLUMN_NAME,
    COLUMN_TYPE,
    IS_NULLABLE,
    COLUMN_KEY
   FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
   AND COLUMN_NAME = 'user_id'
   ORDER BY TABLE_NAME`,

      // ========================================
      // 3. 각 테이블의 데이터 샘플 확인
      // ========================================
      `SELECT 'appraisals' as table_name, COUNT(*) as count, 
   MIN(user_id) as min_id, MAX(user_id) as max_id FROM appraisals`,

      `SELECT 'appr_users' as table_name, COUNT(*) as count, 
   MIN(user_id) as min_id, MAX(user_id) as max_id FROM appr_users`,

      `SELECT 'bids' as table_name, COUNT(*) as count, 
   MIN(user_id) as min_id, MAX(user_id) as max_id FROM bids`,

      `SELECT 'daily_settlements' as table_name, COUNT(*) as count, 
   MIN(user_id) as min_id, MAX(user_id) as max_id FROM daily_settlements`,

      `SELECT 'deposit_transactions' as table_name, COUNT(*) as count, 
   MIN(user_id) as min_id, MAX(user_id) as max_id FROM deposit_transactions`,

      `SELECT 'direct_bids' as table_name, COUNT(*) as count, 
   MIN(user_id) as min_id, MAX(user_id) as max_id FROM direct_bids`,

      `SELECT 'live_bids' as table_name, COUNT(*) as count, 
   MIN(user_id) as min_id, MAX(user_id) as max_id FROM live_bids`,

      `SELECT 'payments' as table_name, COUNT(*) as count, 
   MIN(user_id) as min_id, MAX(user_id) as max_id FROM payments`,

      `SELECT 'restoration_requests' as table_name, COUNT(*) as count, 
   MIN(user_id) as min_id, MAX(user_id) as max_id FROM restoration_requests`,

      `SELECT 'user_accounts' as table_name, COUNT(*) as count, 
   MIN(user_id) as min_id, MAX(user_id) as max_id FROM user_accounts`,

      `SELECT 'wishlists' as table_name, COUNT(*) as count, 
   MIN(user_id) as min_id, MAX(user_id) as max_id FROM wishlists`,

      // ========================================
      // 4. JOIN 테스트 - 매핑이 제대로 되는지 확인
      // ========================================
      `SELECT u.id, u.login_id, ua.account_type, ua.deposit_balance
   FROM users u
   JOIN user_accounts ua ON u.id = ua.user_id
   LIMIT 5`,

      `SELECT u.id, u.login_id, COUNT(d.id) as direct_bid_count
   FROM users u
   LEFT JOIN direct_bids d ON u.id = d.user_id
   GROUP BY u.id
   HAVING direct_bid_count > 0
   LIMIT 5`,

      `SELECT u.id, u.login_id, COUNT(l.id) as live_bid_count
   FROM users u
   LEFT JOIN live_bids l ON u.id = l.user_id
   GROUP BY u.id
   HAVING live_bid_count > 0
   LIMIT 5`,

      // ========================================
      // 5. NULL 체크 - user_id가 NULL인 레코드 확인
      // ========================================
      `SELECT COUNT(*) as null_count FROM appraisals WHERE user_id IS NULL`,
      `SELECT COUNT(*) as null_count FROM bids WHERE user_id IS NULL`,
      `SELECT COUNT(*) as null_count FROM daily_settlements WHERE user_id IS NULL`,
      `SELECT COUNT(*) as null_count FROM deposit_transactions WHERE user_id IS NULL`,
      `SELECT COUNT(*) as null_count FROM direct_bids WHERE user_id IS NULL`,
      `SELECT COUNT(*) as null_count FROM live_bids WHERE user_id IS NULL`,
      `SELECT COUNT(*) as null_count FROM payments WHERE user_id IS NULL`,
      `SELECT COUNT(*) as null_count FROM restoration_requests WHERE user_id IS NULL`,
      `SELECT COUNT(*) as null_count FROM user_accounts WHERE user_id IS NULL`,
      `SELECT COUNT(*) as null_count FROM wishlists WHERE user_id IS NULL`,

      // ========================================
      // 6. 인덱스 확인
      // ========================================
      `SHOW INDEX FROM users WHERE Key_name = 'PRIMARY'`,
      `SHOW INDEX FROM users WHERE Column_name = 'login_id'`,
      `SHOW INDEX FROM user_accounts WHERE Key_name = 'PRIMARY'`,

      // ========================================
      // 7. 백업 테이블 존재 확인
      // ========================================
      `SHOW TABLES LIKE '%_backup'`,
    ];

    // 각 쿼리 순차 실행
    for (const query of queries) {
      const [rows, fields] = await conn.query(query);
      console.log(`Executed: ${query}`);
      console.log("Result:", rows);
      console.log(`Affected rows: ${rows.affectedRows}`);
    }
  } catch (err) {
    if (err.code === "ER_ACCESS_DENIED_ERROR") {
      console.error("Invalid credentials:", err.message);
    } else if (err.code === "ECONNREFUSED") {
      console.error("Connection refused:", err.message);
    } else if (err.code === "ER_CON_COUNT_ERROR") {
      console.error("Too many connections:", err.message);
    } else {
      console.error("Database connection or query error:", err.message);
    }
  } finally {
    if (conn) {
      conn.release();
      console.log("Database connection released");
    }
  }
}

// 개발용 실행
if (require.main === module) {
  testConnection();
}

module.exports = { pool, sessionPool, safeQuery, monitorConnections };
