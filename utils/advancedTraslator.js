// utils/advancedTranslator.js
const { TranslateClient, TranslateTextCommand } = require("@aws-sdk/client-translate");
const pool = require('./DB')

class AdvancedTranslator {
  constructor(region, expireDays = 3) {
    this.translate = new TranslateClient({ region });
    this.expireDays = expireDays;
    this.lastCallTime = Date.now();
    this.callInterval = 50; // Minimum time between API calls in milliseconds
    this.maxRetries = 1; // Maximum number of retries for API calls
    this.retryDelay = 1000; // Delay between retries in milliseconds
    this.TRANS_COUNT = 0;
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async rawTranslate(text, retries = 0) {
    const now = Date.now();
    if (now - this.lastCallTime < this.callInterval) {
      await this.delay(this.callInterval - (now - this.lastCallTime));
    }
    this.lastCallTime = Date.now();

    const params = {
      Text: text,
      SourceLanguageCode: 'ja',
      TargetLanguageCode: 'ko'
    };
    const command = new TranslateTextCommand(params);
    try {
      this.TRANS_COUNT += text.length;
      const result = await this.translate.send(command);
      return result.TranslatedText;
    } catch (error) {
      if (error.name === 'ThrottlingException' && retries < this.maxRetries) {
        console.log(`API call throttled. Retrying in ${this.retryDelay}ms...`);
        await this.delay(this.retryDelay);
        return this.rawTranslate(text, retries + 1);
      }
      console.error('Translation error:', error.message);
      return text;
    }
  }
  async wordTranslate(text) {
    const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]+/g;
    
    const matches = [...text.matchAll(japaneseRegex)];
    if (!matches.length) return text;
    
    const translations = await Promise.all(
      matches.map(match => this.translateWord(match[0]))
    );
    let result = text;
    for (let i = 0; i < matches.length; i++) {
      result = result.replace(matches[i][0], translations[i]);
    }

    return result;
  }
  async translateWord(word) {
    console.log(word);
    let conn;
    try {
      conn = await pool.getConnection();
      const [rows] = await conn.query('SELECT translation FROM translations WHERE word = ?', [word]);
      
      if (rows.length > 0) {
        await conn.query('UPDATE translations SET last_used = ? WHERE word = ?', [new Date(), word]);
        return rows[0].translation;
      } else {
        const translation = await this.rawTranslate(word);
        await conn.query('INSERT INTO translations (word, translation, last_used) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE translation = ?, last_used = ?',
          [word, translation, new Date(), translation, new Date()]);
        return translation;
      }
    } catch (error) {
      console.error('Database error:', error);
      return word;
    } finally {
      if (conn) conn.release();
    }
  }

  async cleanupCache() {
    let conn;
    try {
      conn = await pool.getConnection();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.expireDays);
      await conn.query('DELETE FROM translations WHERE last_used < ?', [cutoffDate]);
    } catch (error) {
      console.error('Cleanup error:', error);
    } finally {
      if (conn) conn.release();
    }
  }
}

const translator= new AdvancedTranslator('ap-northeast-2');

module.exports = translator;