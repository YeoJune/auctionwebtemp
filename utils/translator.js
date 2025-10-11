// utils/translator.js

class Translator {
  constructor(config = {}) {
    this.translate = new TranslateClient({
      region: config.region || "ap-northeast-2",
    });

    // 설정값
    this.callInterval = config.callInterval || 100;
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 1000;
    this.maxCacheSize = config.maxCacheSize || 10000;
    this.cacheExpireDays = config.cacheExpireDays || 30;

    // 상태
    this.lastCallTime = Date.now();
  }

  async translate(text) {
    // 1. 캐시 확인
    const cached = await this.getFromCache(text);
    if (cached) return cached;

    // 2. API 호출
    const translated = await this.callAPI(text);

    // 3. 캐시 저장
    await this.saveToCache(text, translated);

    return translated;
  }

  async callAPI(text, retries = 0) {
    // 인터벌 체크
    const now = Date.now();
    if (now - this.lastCallTime < this.callInterval) {
      await this.delay(this.callInterval - (now - this.lastCallTime));
    }
    this.lastCallTime = Date.now();

    const params = {
      Text: text,
      SourceLanguageCode: "ja", // 일본어
      TargetLanguageCode: "en", // 영어 ✅
    };

    const command = new TranslateTextCommand(params);

    try {
      const result = await this.translate.send(command);
      return result.TranslatedText;
    } catch (error) {
      if (error.name === "ThrottlingException" && retries < this.maxRetries) {
        console.log(
          `Throttled. Retrying in ${this.retryDelay}ms... (${retries + 1}/${
            this.maxRetries
          })`
        );
        await this.delay(this.retryDelay);
        return this.callAPI(text, retries + 1);
      }
      console.error("Translation error:", error.message);
      throw error;
    }
  }

  async getFromCache(text) {
    let conn;
    try {
      conn = await pool.getConnection();
      const [rows] = await conn.query(
        "SELECT translated_text FROM translation_cache WHERE source_text = ?",
        [text]
      );

      if (rows.length > 0) {
        // updated_at 갱신
        await conn.query(
          "UPDATE translation_cache SET updated_at = NOW() WHERE source_text = ?",
          [text]
        );
        return rows[0].translated_text;
      }

      return null;
    } catch (error) {
      console.error("Cache read error:", error);
      return null;
    } finally {
      if (conn) conn.release();
    }
  }

  async saveToCache(sourceText, translatedText) {
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.query(
        "INSERT INTO translation_cache (source_text, translated_text) VALUES (?, ?) " +
          "ON DUPLICATE KEY UPDATE translated_text = VALUES(translated_text), updated_at = NOW()",
        [sourceText, translatedText]
      );
    } catch (error) {
      console.error("Cache save error:", error);
    } finally {
      if (conn) conn.release();
    }
  }

  async cleanupCache() {
    let conn;
    try {
      conn = await pool.getConnection();

      // 1. 전체 개수 확인
      const [countRows] = await conn.query(
        "SELECT COUNT(*) as count FROM translation_cache"
      );
      const count = countRows[0].count;

      // 2. 최대 개수 초과 시 오래된 것부터 삭제
      if (count > this.maxCacheSize) {
        const deleteCount = count - this.maxCacheSize;
        await conn.query(
          "DELETE FROM translation_cache ORDER BY updated_at ASC LIMIT ?",
          [deleteCount]
        );
        console.log(`Cleaned up ${deleteCount} old cache entries (size limit)`);
      }

      // 3. 만료된 캐시 삭제
      const [result] = await conn.query(
        "DELETE FROM translation_cache WHERE updated_at < DATE_SUB(NOW(), INTERVAL ? DAY)",
        [this.cacheExpireDays]
      );

      if (result.affectedRows > 0) {
        console.log(`Cleaned up ${result.affectedRows} expired cache entries`);
      }
    } catch (error) {
      console.error("Cleanup error:", error);
    } finally {
      if (conn) conn.release();
    }
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

const translator = new Translator({
  region: "ap-northeast-2",
  callInterval: 50,
  maxRetries: 2,
  retryDelay: 500,
  maxCacheSize: 50000,
  cacheExpireDays: 365,
});

module.exports = translator;
