// utils/DB.js
require("dotenv").config();
const mysql = require("mysql2/promise");

// 메인 애플리케이션용 연결 풀 (AWS RDS max_connections=30 고려)
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME,
  connectionLimit: 15, // 30의 50% (세션 스토어용 여유 확보)
  acquireTimeout: 30000, // 30초 대기 후 타임아웃
  timeout: 30000, // 쿼리 타임아웃
  reconnect: true, // 연결 끊김 시 자동 재연결
  charset: "utf8mb4",
  connectTimeout: 10000,
  // 추가 안정성 설정
  idleTimeout: 300000, // 5분 후 유휴 연결 해제
  maxIdle: 5, // 최대 유휴 연결 수
});

// 세션 스토어 전용 연결 풀 (별도 관리)
const sessionPool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME,
  connectionLimit: 8, // 세션용 전용 연결
  acquireTimeout: 30000,
  timeout: 30000,
  reconnect: true,
  charset: "utf8mb4",
  connectTimeout: 10000,
  idleTimeout: 300000,
  maxIdle: 2,
});

// 연결 상태 모니터링 함수
async function monitorConnections() {
  try {
    const [maxConn] = await pool.query("SHOW VARIABLES LIKE 'max_connections'");
    const [currentConn] = await pool.query(
      "SHOW STATUS LIKE 'Threads_connected'"
    );

    console.log(`MySQL Max Connections: ${maxConn[0].Value}`);
    console.log(`Current Active Connections: ${currentConn[0].Value}`);
    console.log(
      `Pool Status - Active: ${pool.pool._allConnections.length}, Free: ${pool.pool._freeConnections.length}`
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
    conn = await sessionPool.getConnection();
    console.log("Successfully connected to the database");

    // 연결 상태 확인 쿼리들
    const queries = [
      `CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  expires INT(11) UNSIGNED NOT NULL,
  data MEDIUMTEXT COLLATE utf8mb4_bin,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    ];

    // 각 쿼리 순차 실행
    for (const query of queries) {
      const [rows, fields] = await conn.query(query);
      console.log(`Executed: ${query}`);
      if (query.includes("SHOW")) {
        console.log("Result:", rows);
      } else {
        console.log(`Affected rows: ${rows.affectedRows}`);
      }
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
