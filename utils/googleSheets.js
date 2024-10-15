const { google } = require('googleapis');
const path = require('path');

class GoogleSheetsManager {
  constructor() {
    this.CREDENTIALS_PATH = path.join('./service-account-key.json');
    this.spreadsheetId = process.env.GOOGLE_SHEET_ID;
    this.auth = null;
    this.sheets = null;

    this.authorize();
  }

  async authorize() {
    try {
      this.auth = new google.auth.GoogleAuth({
        keyFile: this.CREDENTIALS_PATH,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const client = await this.auth.getClient();
      this.sheets = google.sheets({ version: 'v4', auth: client });
      
      console.log('Authorization successful');
    } catch (err) {
      console.error('Error in authorization:', err);
      throw err;
    }
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
      const values = response?.data?.values?[0]?.map((e) => e.replace(/\D/g, ''));

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
}

const MyGoogleSheetsManager = new GoogleSheetsManager();

module.exports = MyGoogleSheetsManager;