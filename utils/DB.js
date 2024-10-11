// utils/DB.js
require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME,
  connectionLimit: 5,
  charset: 'utf8mb4',
  connectTimeout: 120000, // 120초
});

// test 쿼리
async function testConnection() {
  let conn;
  try {
    conn = await pool.getConnection();
    console.log('Successfully connected to the database');
    
    const [rows, fields] = await conn.query(`
      SELECT * FROM bids
    `);
    console.log('Query executed successfully. Result:', rows);

  } catch (err) {
    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('Invalid credentials:', err.message);
    } else if (err.code === 'ECONNREFUSED') {
      console.error('Connection refused:', err.message);
    } else {
      console.error('Database connection or query error:', err.message);
    }
  } finally {
    if (conn) {
      conn.release();
      console.log('Database connection released');
    }
  }
}

//testConnection();

module.exports = pool;
