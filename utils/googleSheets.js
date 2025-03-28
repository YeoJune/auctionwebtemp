// utils/googleSheets.js
const { google } = require("googleapis");
const path = require("path");
const pool = require("./DB");
const crypto = require("crypto");

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

class GoogleSheetsManager {
  constructor() {
    this.CREDENTIALS_PATH = path.join("./service-account-key.json");
    this.spreadsheetId = process.env.GOOGLE_SHEET_ID;
    this.auth = null;
    this.sheets = null;
    this.drive = null;
    this.lastModifiedTime = null;
    this.checkInterval = null;

    this.authorize();
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async authorize() {
    try {
      this.auth = new google.auth.GoogleAuth({
        keyFile: this.CREDENTIALS_PATH,
        scopes: [
          "https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/drive.readonly",
        ],
      });

      const client = await this.auth.getClient();
      this.sheets = google.sheets({ version: "v4", auth: client });
      this.drive = google.drive({ version: "v3", auth: client });

      console.log("Authorization successful");
      this.startModificationCheck();
    } catch (err) {
      console.error("Error in authorization:", err);
      throw err;
    }
  }

  async checkLastModified() {
    try {
      const response = await this.drive.files.get({
        fileId: this.spreadsheetId,
        fields: "modifiedTime",
      });

      const currentModifiedTime = new Date(response.data.modifiedTime);

      if (!this.lastModifiedTime) {
        this.lastModifiedTime = currentModifiedTime;
      } else if (currentModifiedTime > this.lastModifiedTime) {
        console.log("Spreadsheet was modified. Running refresh...");
        await this.refreshAllBidInfo();
        await this.syncUsersWithDB();
        this.lastModifiedTime = currentModifiedTime;
      }
    } catch (error) {
      console.error("Error checking last modified time:", error);
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
      const nextRow = await this.findFinal("Main Sheet", "A");
      const range = `Main Sheet!A${nextRow}:N${nextRow}`;

      const response = await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        resource: {
          values: [bidData],
        },
      });
      console.log("Bid reservation successfully added to the spreadsheet");
      return response;
    } catch (err) {
      console.error("The API returned an error: " + err);
      throw err;
    }
  }

  async findUser(userId) {
    try {
      const sheetRow = (await this.findRows("회원목록", "C", [userId]))[0];
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
      console.error("Error fetching user data:", err.message);
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

      const rowIndices = keys.map((key) => {
        const rowIndex = keyColumn.findIndex((row) => row[0] == key);
        return rowIndex === -1 ? null : rowIndex + 1;
      });

      return rowIndices;
    } catch (err) {
      console.error("Error finding rows by keys:", err.message);
      return null;
    }
  }

  async getBidInfos(bidids) {
    const sheetRows = await this.findRows("Main Sheet", "A", bidids);
    const results = [];
    for (const row of sheetRows) {
      results.push(await this.getBidInfo(row));
      await this.sleep(100);
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
      const values = response.data.values[0].map((e) => e.replace(/\D/g, ""));

      if (values) {
        return {
          first_price: values[0] || null,
          second_price: values[1] || null,
          final_price: values[2] || null,
        };
      }

      return null;
    } catch (err) {
      console.error("Error fetching bid information:", err);
      return null;
    }
  }

  async updateFinalBidAmount(bidId, finalBidAmount) {
    try {
      const sheetRow = (await this.findRows("Main Sheet", "A", [bidId]))[0];
      if (!sheetRow) return null;
      const range = `Main Sheet!N${sheetRow}`;
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        resource: {
          values: [[finalBidAmount]],
        },
      });
      console.log("Final bid amount updated successfully");
    } catch (err) {
      console.error("The API returned an error: " + err);
      throw err;
    }
  }

  async refreshAllBidInfo() {
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();

      // 1. DB에서 모든 입찰 ID 가져오기
      const [allBids] = await conn.query(`SELECT id, item_id FROM bids`);
      const allBidIds = allBids.map((bid) => bid.id);

      // 2. 구글 시트에서 모든 입찰 ID 가져오기
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: "Main Sheet!A:A",
      });
      const sheetBidIds = response.data.values
        ?.slice(1) // 헤더 제외
        .filter((row) => row[0]) // 빈 행 제외
        .map((row) => row[0]); // ID만 추출

      if (!sheetBidIds) {
        throw new Error("Failed to fetch bid IDs from Google Sheet");
      }

      // 3. 구글 시트에 없는 입찰 ID 찾기
      const bidsToDelete = allBidIds.filter(
        (id) => !sheetBidIds.includes(id.toString())
      );

      // 4. 구글 시트에 없는 입찰 삭제
      if (bidsToDelete.length > 0) {
        await conn.query(
          `
          DELETE FROM bids 
          WHERE id IN (?)
        `,
          [bidsToDelete]
        );
        console.log(
          `Deleted bids not in Google Sheet: ${bidsToDelete.join(", ")}`
        );
      }

      // 5. 구글 시트에 있는 입찰 정보 업데이트
      const [bidsToUpdate] = await conn.query(`
        SELECT id, item_id
        FROM bids 
        WHERE second_price IS NULL OR final_price IS NULL
      `);

      // Get valid item IDs from crawled_items
      const [validItems] = await conn.query(`
        SELECT item_id FROM crawled_items
      `);
      const validItemIds = new Set(validItems.map((item) => item.item_id));

      const bidIdsToUpdate = bidsToUpdate
        .filter((bid) => validItemIds.has(bid.item_id))
        .map((bid) => bid.id);

      if (bidIdsToUpdate.length > 0) {
        const bidInfos = await this.getBidInfos(bidIdsToUpdate);

        for (let i = 0; i < bidIdsToUpdate.length; i++) {
          if (bidInfos[i]) {
            const updateFields = [];
            const updateValues = [];

            if (bidInfos[i].second_price !== undefined) {
              updateFields.push("second_price = ?");
              updateValues.push(bidInfos[i].second_price);
            }
            if (bidInfos[i].final_price !== undefined) {
              updateFields.push("final_price = ?");
              updateValues.push(bidInfos[i].final_price);
            }

            if (updateFields.length > 0) {
              const updateQuery = `
                UPDATE bids 
                SET ${updateFields.join(", ")}
                WHERE id = ?
              `;

              try {
                await conn.query(updateQuery, [
                  ...updateValues,
                  bidIdsToUpdate[i],
                ]);
              } catch (error) {
                console.error(
                  `Failed to update bid ${bidIdsToUpdate[i]}:`,
                  error
                );
                throw error;
              }
            }
          }
        }

        console.log(
          `Updated bids ${bidIdsToUpdate
            .filter((_, i) => bidInfos[i])
            .join(", ")} with new values`
        );
      }

      await conn.commit();
    } catch (error) {
      if (conn) await conn.rollback();
      console.error("Error in refreshAllBidInfo:", error);
      throw error;
    } finally {
      if (conn) conn.release();
    }
  }
  async syncUsersWithDB() {
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();

      // 1. Get all users from Google Sheets
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: "회원목록!C2:M",
      });
      const users = response.data.values || [];

      // 2. Create users table if not exists
      await conn.query(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(50) PRIMARY KEY,
          password VARCHAR(64),
          email VARCHAR(100),
          is_active BOOLEAN,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);

      // Get all user IDs from Google Sheets
      const sheetUserIds = users.map((user) => user[0]);

      // Get all user IDs from DB
      const [dbUsers] = await conn.query("SELECT id FROM users");
      const dbUserIds = dbUsers.map((user) => user.id);

      // Find users to delete (in DB but not in sheet)
      const userIdsToDelete = dbUserIds.filter(
        (id) => !sheetUserIds.includes(id)
      );

      // Delete users not in sheet
      if (userIdsToDelete.length > 0) {
        await conn.query("DELETE FROM users WHERE id IN (?)", [
          userIdsToDelete,
        ]);
        console.log(
          `Deleted users not in Google Sheet: ${userIdsToDelete.join(", ")}`
        );
      }

      // 3. Sync each user
      for (const user of users) {
        const [userId, password, _2, _3, _4, email, _5, _6, _7, _8, isActive] =
          user;

        const hashedPassword = hashPassword(password);

        await conn.query(
          `
          INSERT INTO users (id, password, email, is_active) 
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE 
            password = ?,
            email = ?,
            is_active = ?
        `,
          [
            userId,
            hashedPassword,
            email,
            isActive === "TRUE",
            hashedPassword,
            email,
            isActive === "TRUE",
          ]
        );
      }

      await conn.commit();
      console.log("Users synced successfully with DB");
    } catch (error) {
      if (conn) await conn.rollback();
      console.error("Error syncing users with DB:", error);
      throw error;
    } finally {
      if (conn) conn.release();
    }
  }
}

const MyGoogleSheetsManager = new GoogleSheetsManager();

module.exports = MyGoogleSheetsManager;
