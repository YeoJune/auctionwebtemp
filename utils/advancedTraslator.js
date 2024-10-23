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
    
    // Extract unique words to translate
    const uniqueWords = [...new Set(matches.map(match => match[0]))];
    
    // Get translations for all unique words at once
    const translations = await this.translateWords(uniqueWords);
    
    // Create a map of original words to their translations
    const translationMap = Object.fromEntries(
      uniqueWords.map((word, index) => [word, translations[index]])
    );
    
    // Replace all occurrences using the translation map
    let result = text;
    for (const [word, translation] of Object.entries(translationMap)) {
      result = result.replace(new RegExp(word, 'g'), translation);
    }

    return result;
  }

  async translateWords(words) {
    if (!words.length) return [];
    
    let conn;
    try {
      conn = await pool.getConnection();
      
      // Get existing translations from database
      const [rows] = await conn.query(
        'SELECT word, translation FROM translations WHERE word IN (?)',
        [words]
      );
      
      // Create a map of existing translations
      const existingTranslations = new Map(
        rows.map(row => [row.word, row.translation])
      );
      
      // Find words that need new translations
      const wordsToTranslate = words.filter(word => !existingTranslations.has(word));
      
      // Translate new words
      const newTranslations = await Promise.all(
        wordsToTranslate.map(word => this.rawTranslate(word))
      );
      
      // Prepare batch insert/update for new translations
      if (wordsToTranslate.length > 0) {
        const values = wordsToTranslate.map((word, index) => [
          word,
          newTranslations[index],
          new Date()
        ]);
        
        await conn.query(
          'INSERT INTO translations (word, translation, last_used) VALUES ? ' +
          'ON DUPLICATE KEY UPDATE translation = VALUES(translation), last_used = VALUES(last_used)',
          [values]
        );
      }
      
      // Update last_used timestamp for existing translations
      if (rows.length > 0) {
        const existingWords = rows.map(row => row.word);
        await conn.query(
          'UPDATE translations SET last_used = ? WHERE word IN (?)',
          [new Date(), existingWords]
        );
      }
      
      // Return translations in the same order as input words
      return words.map(word => 
        existingTranslations.get(word) || 
        newTranslations[wordsToTranslate.indexOf(word)]
      );
      
    } catch (error) {
      console.error('Database error:', error);
      return words;
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

const translator = new AdvancedTranslator('ap-northeast-2');

module.exports = translator;