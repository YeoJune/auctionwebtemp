// utils/filterDB.js
const { pool } = require("./DB");

async function getFilterSettings() {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(`
      SELECT filter_type, filter_value, is_enabled 
      FROM filter_settings 
      ORDER BY filter_type, filter_value
    `);
    return rows;
  } catch (error) {
    console.error("Error getting filter settings:", error);
    throw error;
  } finally {
    conn.release();
  }
}

async function getEnabledFilters(filterType) {
  const conn = await pool.getConnection();
  try {
    const [enabled] = await conn.query(
      `
      SELECT filter_value 
      FROM filter_settings 
      WHERE filter_type = ? AND is_enabled = TRUE
    `,
      [filterType]
    );
    return enabled.map((item) => item.filter_value);
  } catch (error) {
    console.error("Error getting enabled filters:", error);
    return []; // 에러가 발생하거나 설정이 없으면 빈 배열 반환
  } finally {
    conn.release();
  }
}

async function updateFilterSetting(filterType, filterValue, isEnabled) {
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `
      INSERT INTO filter_settings (filter_type, filter_value, is_enabled)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE is_enabled = ?
    `,
      [filterType, filterValue, isEnabled, isEnabled]
    );

    return { filterType, filterValue, isEnabled };
  } catch (error) {
    console.error("Error updating filter setting:", error);
    throw error;
  } finally {
    conn.release();
  }
}
async function initializeFilterSettings() {
  const conn = await pool.getConnection();
  try {
    // 1. 현재 DB에 있는 모든 값들을 가져옴
    const [dates] = await conn.query(`
      SELECT DISTINCT DATE(scheduled_date) as value 
      FROM crawled_items 
      WHERE scheduled_date IS NOT NULL
      ORDER BY value
    `);
    const [brands] = await conn.query(`
      SELECT DISTINCT brand as value 
      FROM crawled_items 
      WHERE brand IS NOT NULL AND brand != ''
      ORDER BY value
    `);
    const [categories] = await conn.query(`
      SELECT DISTINCT category as value 
      FROM crawled_items 
      WHERE category IS NOT NULL AND category != ''
      ORDER BY value
    `);

    // 2. 현재 필터 설정을 가져옴
    const [currentSettings] = await conn.query(`
      SELECT filter_type, filter_value, is_enabled
      FROM filter_settings
    `);

    // 3. 현재 값들을 타입별로 맵으로 변환 (빠른 검색을 위해)
    const currentSettingsMap = new Map();
    currentSettings.forEach((setting) => {
      currentSettingsMap.set(
        `${setting.filter_type}:${setting.filter_value}`,
        setting.is_enabled
      );
    });

    // 4. DB에서 가져온 현재 값들의 집합 생성
    const newValuesSet = new Set([
      ...dates.map((d) => `date:${d.value}`),
      ...brands.map((b) => `brand:${b.value}`),
      ...categories.map((c) => `category:${c.value}`),
    ]);

    // 5. 더 이상 DB에 없는 값들을 필터 설정에서 제거
    const outdatedSettings = Array.from(currentSettingsMap.keys()).filter(
      (key) => !newValuesSet.has(key)
    );

    if (outdatedSettings.length > 0) {
      const deletePromises = outdatedSettings.map((key) => {
        const [type, value] = key.split(":");
        return conn.query(
          "DELETE FROM filter_settings WHERE filter_type = ? AND filter_value = ?",
          [type, value]
        );
      });
      await Promise.all(deletePromises);
    }

    // 6. 새로운 값들 추가 (기존 값은 유지)
    const insertPromises = [];
    const processNewValue = (type, value) => {
      const key = `${type}:${value}`;
      if (!currentSettingsMap.has(key)) {
        insertPromises.push(
          conn.query(
            `
            INSERT IGNORE INTO filter_settings (filter_type, filter_value, is_enabled)
            VALUES (?, ?, TRUE)
          `,
            [type, value]
          )
        );
      }
    };

    dates.forEach((d) => processNewValue("date", d.value));
    brands.forEach((b) => processNewValue("brand", b.value));
    categories.forEach((c) => processNewValue("category", c.value));

    if (insertPromises.length > 0) {
      await Promise.all(insertPromises);
    }

    // 오늘 이전의 날짜 필터 삭제
    await conn.query(`
      DELETE FROM filter_settings
      WHERE filter_type = 'date'
      AND filter_value < CURDATE()
    `);

    // 7. 변경 사항 요약 반환
    return {
      added: insertPromises.length,
      removed: outdatedSettings.length,
      maintained: currentSettings.length - outdatedSettings.length,
    };
  } catch (error) {
    console.error("Error initializing filter settings:", error);
    throw error;
  } finally {
    conn.release();
  }
}

// 필터 설정 즉시 동기화
async function syncFilterSettingsToItems() {
  console.log("Syncing crawled_items.is_enabled with filter_settings...");

  const conn = await pool.getConnection();
  try {
    await conn.query(`
      UPDATE crawled_items ci
      SET is_enabled = CASE 
        WHEN EXISTS (
          SELECT 1 FROM filter_settings fs1 
          WHERE fs1.filter_type = 'brand' 
          AND fs1.filter_value = ci.brand 
          AND fs1.is_enabled = 1
        )
        AND EXISTS (
          SELECT 1 FROM filter_settings fs2 
          WHERE fs2.filter_type = 'category' 
          AND fs2.filter_value = ci.category 
          AND fs2.is_enabled = 1
        )
        AND EXISTS (
          SELECT 1 FROM filter_settings fs3 
          WHERE fs3.filter_type = 'date' 
          AND fs3.filter_value = DATE(ci.scheduled_date)
          AND fs3.is_enabled = 1
        )
        THEN 1 
        ELSE 0 
      END
    `);

    console.log("Filter sync completed successfully");
    return { success: true };
  } catch (error) {
    console.error("Error during filter sync:", error);
    throw error;
  } finally {
    conn.release();
  }
}

syncFilterSettingsToItems(); // 모듈 로드 시 즉시 동기화

module.exports = {
  getFilterSettings,
  getEnabledFilters,
  updateFilterSetting,
  initializeFilterSettings,
  syncFilterSettingsToItems,
};
