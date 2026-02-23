#!/usr/bin/env node
/**
 * 회원 그룹 테이블 마이그레이션
 * 실행: node scripts/migrate-member-groups.js
 */
const path = require("path");
const { pool } = require(path.join(__dirname, "..", "utils", "DB"));

async function migrate() {
  let conn;
  try {
    conn = await pool.getConnection();

    await conn.query(`
      CREATE TABLE IF NOT EXISTS member_groups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("member_groups 테이블 생성/확인 완료");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS user_member_groups (
        user_id INT NOT NULL,
        group_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, group_id),
        KEY idx_umg_group_id (group_id),
        CONSTRAINT fk_umg_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_umg_group_id FOREIGN KEY (group_id) REFERENCES member_groups (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("user_member_groups 테이블 생성/확인 완료");

    const [existing] = await conn.query(
      "SELECT id FROM member_groups WHERE name IN ('artecasa', 'doyakcasa')"
    );
    if (existing.length === 0) {
      await conn.query(
        "INSERT INTO member_groups (name, sort_order) VALUES ('artecasa', 1), ('doyakcasa', 2)"
      );
      console.log("기본 그룹(artecasa, doyakcasa) 생성 완료");
    }

    console.log("마이그레이션 완료");
  } catch (err) {
    console.error("마이그레이션 실패:", err);
    process.exit(1);
  } finally {
    if (conn) conn.release();
    process.exit(0);
  }
}

migrate();
