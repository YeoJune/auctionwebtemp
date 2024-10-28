// utils/googleSheets.js
const { google } = require('googleapis');
const path = require('path');
const pool = require('./DB');

class GoogleSheetsManager {
  constructor() {
    this.CREDENTIALS_PATH = path.join('./service-account-key.json');
    this.spreadsheetId = process.env.GOOGLE_SHEET_ID;
    this.auth = null;
    this.sheets = null;
    this.drive = null;
    this.lastModifiedTime = null;
    this.checkInterval = null;

    this.authorize();
  }

  async authorize() {
    try {
      this.auth = new google.auth.GoogleAuth({
        keyFile: this.CREDENTIALS_PATH,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive.readonly',
        ],
      });

      const client = await this.auth.getClient();
      this.sheets = google.sheets({ version: 'v4', auth: client });
      this.drive = google.drive({ version: 'v3', auth: client });
      
      console.log('Authorization successful');
      this.startModificationCheck();
    } catch (err) {
      console.error('Error in authorization:', err);
      throw err;
    }
  }

  async checkLastModified() {
    try {
      const response = await this.drive.files.get({
        fileId: this.spreadsheetId,
        fields: 'modifiedTime'
      });

      const currentModifiedTime = new Date(response.data.modifiedTime);

      if (!this.lastModifiedTime) {
        this.lastModifiedTime = currentModifiedTime;
      } else if (currentModifiedTime > this.lastModifiedTime) {
        console.log('Spreadsheet was modified. Running refresh...');
        await this.refreshAllBidInfo();
        this.lastModifiedTime = currentModifiedTime;
      }
    } catch (error) {
      console.error('Error checking last modified time:', error);
    }
  }

  startModificationCheck() {
    // 기존 인터벌이 있다면 제거
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    // 1분마다 체크
    this.checkInterval = setInterval(() => {
      this.checkLastModified();
    }, 60 * 1000); // 60000ms = 1분
  }

  async findFinal(sheetName, column) {
    const searchResponse = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!${column}1:${column}`,
    });
    const keyColumn = searchResponse.data.values;
    if (!keyColumn) return 1;
    
    for (let i = 0; i < keyColumn.length; i++) {
      if (!keyColumn[i] || !keyColumn[i][0]) {
        return i + 1;
      }
    }
    
    return keyColumn.length + 1;
  }
  async appendToSpreadsheet(bidData) {
    try {
      const nextRow = await this.findFinal('Main Sheet', 'A');
      const range = `Main Sheet!A${nextRow}:N${nextRow}`;
  
      const response = await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [bidData],
        },
      });
      console.log('Bid reservation successfully added to the spreadsheet');
      return response;
    } catch (err) {
      console.error('The API returned an error: ' + err);
      throw err;
    }
  }

  async findUser(userId) {
    try {
      const sheetRow = (await this.findRows('회원목록', 'C', [userId]))[0];
      if (!sheetRow) {
        console.log(`User with ID ${userId} not found.`);
        return []; 
      }
      const range = `회원목록!A${sheetRow}:M${sheetRow}`;
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range,
      });
      return response.data.values;
    } catch (err) {
      console.error('Error fetching user data:', err.message);
      throw err;
    }
  }
  
  async findRows(sheetName, column, keys) {
    try {
      const searchResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!${column}1:${column}`,
      });
      const keyColumn = searchResponse.data.values;
  
      const rowIndices = keys.map(key => {
        const rowIndex = keyColumn.findIndex(row => row[0] == key);
        return rowIndex === -1 ? null : rowIndex + 1;
      });
  
      return rowIndices;
    } catch (err) {
      console.error('Error finding rows by keys:', err.message);
      return null;
    }
  }

  async getBidInfos(bidids) {
    const sheetRows = (await this.findRows('Main Sheet', 'A', bidids));
    const results = [];
    for(const row of sheetRows) {
      results.push(await this.getBidInfo(row));
    }
    return results;
  }

  async getBidInfo(sheetRow) {
    try {
      if (!sheetRow) {
        return null;
      }

      const range = `Main Sheet!L${sheetRow}:N${sheetRow}`;

      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range,
      });
      if (!response.data.values) return null;
      const values = response.data.values[0].map((e) => e.replace(/\D/g, ''));

      if (values) {
        return {
          first_price: values[0] || null,
          second_price: values[1] || null,
          final_price: values[2] || null,
        };
      }

      return null;
    } catch (err) {
      console.error('Error fetching bid information:', err);
      return null;
    }
  }

  async updateFinalBidAmount(bidId, finalBidAmount) {
    try {
      const sheetRow = (await this.findRows('Main Sheet', 'A', [bidId]))[0];
      if (!sheetRow) return null;
      const range = `Main Sheet!N${sheetRow}`;
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[finalBidAmount]]
        }
      });
      console.log('Final bid amount updated successfully');
    } catch (err) {
      console.error('The API returned an error: ' + err);
      throw err;
    }
  }

  async refreshAllBidInfo() {
    try {
      const [bids] = await pool.query(`SELECT id FROM bids WHERE second_price IS NULL`);
      const bidIds = bids.map((bid) => bid.id);
      if (bidIds.length > 0) {
        const bidInfos = await this.getBidInfos(bidIds);
        for (let i = 0; i < bidIds.length; i++) {
          const bidIndex = bids.findIndex(bid => bid.id === bidIds[i]);
          if (bidIndex !== -1 && bidInfos[i]) {
            Object.assign(bids[bidIndex], bidInfos[i]);
            
            const updateFields = [];
            const updateValues = [];
            
            if (bidInfos[i].second_price !== undefined) {
              updateFields.push('second_price = ?');
              updateValues.push(bidInfos[i].second_price);
            }
            if (bidInfos[i].final_price !== undefined) {
              updateFields.push('final_price = ?');
              updateValues.push(bidInfos[i].final_price);
            }
            
            if (updateFields.length > 0) {
              const updateQuery = `
                UPDATE bids 
                SET ${updateFields.join(', ')}
                WHERE id = ?
              `;
              
              try {
                await pool.query(updateQuery, [...updateValues, bidIds[i]]);
              } catch (error) {
                console.error(`Failed to update bid ${bidIds[i]}:`, error);
              }
            }
          }
        }
        console.log(`Updated bid ${bids.filter((bid) => bid.second_price).join(', ')} with new values`);
      }
    } catch (error) {
      console.error('Error in refreshAllBidInfo:', error);
    }
  }
}
const MyGoogleSheetsManager = new GoogleSheetsManager();

module.exports = MyGoogleSheetsManager;