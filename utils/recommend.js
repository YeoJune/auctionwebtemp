// utils/recommend.js
const { pool } = require("./DB");

async function getRecommendSettings() {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(`
      SELECT id, rule_name, conditions, recommend_score, is_enabled 
      FROM recommend_settings 
      ORDER BY recommend_score DESC
    `);
    return rows;
  } catch (error) {
    console.error("Error getting recommend settings:", error);
    throw error;
  } finally {
    conn.release();
  }
}

async function addRecommendSetting(ruleName, conditions, recommendScore) {
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `INSERT INTO recommend_settings (rule_name, conditions, recommend_score, is_enabled)
       VALUES (?, ?, ?, 1)`,
      [ruleName, JSON.stringify(conditions), recommendScore]
    );
    return { ruleName, conditions, recommendScore };
  } catch (error) {
    console.error("Error adding recommend setting:", error);
    throw error;
  } finally {
    conn.release();
  }
}

async function updateRecommendSetting(
  id,
  ruleName,
  conditions,
  recommendScore,
  isEnabled
) {
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `UPDATE recommend_settings 
       SET rule_name = ?, conditions = ?, recommend_score = ?, is_enabled = ?
       WHERE id = ?`,
      [ruleName, JSON.stringify(conditions), recommendScore, isEnabled, id]
    );
    return { id, ruleName, conditions, recommendScore, isEnabled };
  } catch (error) {
    console.error("Error updating recommend setting:", error);
    throw error;
  } finally {
    conn.release();
  }
}

async function deleteRecommendSetting(id) {
  const conn = await pool.getConnection();
  try {
    const [result] = await conn.query(
      `DELETE FROM recommend_settings WHERE id = ?`,
      [id]
    );
    return result.affectedRows > 0;
  } catch (error) {
    console.error("Error deleting recommend setting:", error);
    throw error;
  } finally {
    conn.release();
  }
}

// 배치로 추천 설정 업데이트
async function updateRecommendSettingsBatch(settings) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const results = [];
    for (const setting of settings) {
      const { id, ruleName, conditions, recommendScore, isEnabled } = setting;

      const [result] = await conn.query(
        `UPDATE recommend_settings 
         SET rule_name = ?, conditions = ?, recommend_score = ?, is_enabled = ?
         WHERE id = ?`,
        [ruleName, JSON.stringify(conditions), recommendScore, isEnabled, id]
      );

      if (result.affectedRows > 0) {
        results.push({ id, updated: true });
      } else {
        results.push({ id, updated: false, error: "Rule not found" });
      }
    }

    await conn.commit();
    return results;
  } catch (error) {
    await conn.rollback();
    console.error("Error batch updating recommend settings:", error);
    throw error;
  } finally {
    conn.release();
  }
}

// JSON 조건을 SQL WHERE 조건으로 변환
function buildRecommendWhereClause(conditions) {
  const whereClauses = [];
  const params = [];

  for (const [field, condition] of Object.entries(conditions)) {
    switch (condition.operator) {
      case "IN":
        if (condition.values && condition.values.length > 0) {
          whereClauses.push(
            `ci.${field} IN (${condition.values.map(() => "?").join(",")})`
          );
          params.push(...condition.values);
        }
        break;

      case "BETWEEN":
        if (field === "starting_price") {
          whereClauses.push(`(ci.${field} + 0) BETWEEN ? AND ?`);
          params.push(condition.min, condition.max);
        } else if (field === "scheduled_date") {
          whereClauses.push(`DATE(ci.${field}) BETWEEN ? AND ?`);
          params.push(condition.start, condition.end);
        }
        break;

      case "CONTAINS":
        if (condition.keywords && condition.keywords.length > 0) {
          const keywordClauses = condition.keywords.map(
            () => `ci.${field} LIKE ?`
          );
          whereClauses.push(`(${keywordClauses.join(" OR ")})`);
          condition.keywords.forEach((keyword) => {
            params.push(`%${keyword}%`);
          });
        }
        break;
    }
  }

  return { whereClause: whereClauses.join(" AND "), params };
}

module.exports = {
  getRecommendSettings,
  addRecommendSetting,
  updateRecommendSetting,
  updateRecommendSettingsBatch,
  deleteRecommendSetting,
  buildRecommendWhereClause,
};
