// utils/message.js
const axios = require("axios");
const { pool } = require("./DB");
const cron = require("node-cron");
require("dotenv").config();

const MAX_PARAM_LENGTH = 40;
const ACCOUNT_TEXT = `Íµ???Ä??024801-04-544857
?©Ïäπ??ÍπåÏÇ¨?åÎû´??`;

// ?†Ï? ?ÑÌôîÎ≤àÌò∏ Ï°∞Ìöå ?®Ïàò
async function getUsersWithPhone(userIds) {
  if (!userIds || userIds.length === 0) return [];

  const connection = await pool.getConnection();
  try {
    const placeholders = userIds.map(() => "?").join(",");
    const [users] = await connection.query(
      `SELECT id, phone FROM users WHERE id IN (${placeholders}) AND phone IS NOT NULL AND phone != ''`,
      userIds
    );
    return users;
  } catch (error) {
    console.error("Error fetching users with phone:", error);
    return [];
  } finally {
    connection.release();
  }
}

// ?àÏ†Ñ??Î©îÏãúÏßÄ Î∞úÏÜ° ?®Ïàò
async function safeSendMessage(messageService, method, messages, context = "") {
  if (!messages || messages.length === 0) {
    console.log(`No messages to send for ${context}`);
    return;
  }

  try {
    const result = await messageService[method](messages);
    console.log(`${context} message result:`, {
      success: result.success,
      successCount: result.successCount,
      errorCount: result.errorCount,
    });
    return result;
  } catch (error) {
    console.error(`Error sending ${context} message:`, error);
    return { success: false, error: error.message };
  }
}

class MessageService {
  constructor({ apiKey, userId, sender, senderKey }) {
    this.apiKey = apiKey;
    this.userId = userId;
    this.sender = sender;
    this.senderKey = senderKey;
    this.baseUrl = "https://kakaoapi.aligo.in/akv10/alimtalk/send/";
  }

  formatMessage(template, params) {
    let message = template;
    Object.entries(params).forEach(([key, value]) => {
      const truncatedValue =
        value && value.length > MAX_PARAM_LENGTH
          ? value.substring(0, MAX_PARAM_LENGTH) + "..."
          : value;
      message = message.replace(`#{${key}}`, truncatedValue);
    });
    return message;
  }

  async sendKakaoMessage(messages, config) {
    try {
      const formData = new URLSearchParams({
        apikey: this.apiKey,
        userid: this.userId,
        senderkey: this.senderKey,
        tpl_code: config.templateCode,
        sender: this.sender,
        failover: "N",
        testMode: "N",
      });

      messages.forEach(({ phone, params }, index) => {
        const num = index + 1;
        formData.append(`receiver_${num}`, phone);
        formData.append(`subject_${num}`, config.subject);
        formData.append(
          `emtitle_${num}`,
          this.formatMessage(config.emtitle, params)
        );
        formData.append(
          `message_${num}`,
          this.formatMessage(config.message, params)
        );

        if (config.fmessage) {
          formData.append(
            `fmessage_${num}`,
            this.formatMessage(config.fmessage, params)
          );
        }

        if (config.buttons) {
          formData.append(
            `button_${num}`,
            JSON.stringify({ button: config.buttons })
          );
        }
      });

      const response = await axios.post(this.baseUrl, formData.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      return {
        success: response.data.code === 0,
        successCount: response.data.info.scnt,
        errorCount: response.data.info.fcnt,
        messages,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        messages,
      };
    }
  }

  // ?ôÏ∞∞ ?ÑÎ£å ?åÎ¶º
  async sendWinningNotification(messages) {
    const config = {
      templateCode: "UC_2621",
      subject: "?ôÏ∞∞?ÑÎ£å",
      emtitle: "#{?†Ïßú} Í≤ΩÎß§ #{Í±¥Ïàò}Í±??ôÏ∞∞",
      message: `#{Í≥†Í∞ùÎ™???#{?†Ïßú}?ÖÏ∞∞?òÏã† ?ÅÌíàÏ§?#{Í±¥Ïàò}Í±??ôÏ∞∞?òÏóà?µÎãà??

#{Í≥ÑÏ¢å?çÏä§??`,
      fmessage: `#{Í≥†Í∞ùÎ™???#{?†Ïßú}?ÖÏ∞∞?òÏã† ?ÅÌíàÏ§?#{Í±¥Ïàò}Í±??ôÏ∞∞?òÏóà?µÎãà??

#{Í≥ÑÏ¢å?çÏä§??`,
      buttons: [
        {
          name: "Ï±ÑÎÑêÏ∂îÍ?",
          linkType: "AC",
          linkTypeName: "Ï±ÑÎÑê Ï∂îÍ?",
        },
        {
          name: "?ÖÏ∞∞Í≤∞Í≥º ?òÏù¥ÏßÄ",
          linkType: "WL",
          linkTypeName: "?πÎßÅ??,
          linkPc: "https://casastrade.com/bidResultsPage",
          linkMo: "https://casastrade.com/bidResultsPage",
        },
      ],
    };

    return this.sendKakaoMessage(messages, config);
  }

  // ÏµúÏ¢Ö ?ÖÏ∞∞ ?îÏ≤≠
  async sendFinalBidRequest(messages) {
    const config = {
      templateCode: "UB_8707",
      subject: "2Ï∞®Ï†ú?àÍ∏à??,
      emtitle: "ÏµúÏ¢ÖÍ∏àÏï° ?ÖÏ∞∞ ?îÏ≤≠",
      message: `#{Í≥†Í∞ùÎ™????ÖÏ∞∞?òÏã† ?ÑÏû•Í≤ΩÎß§ Î™®Îì†?ÅÌíà???Ä???úÏïàÍ∏àÏï°???ÖÎç∞?¥Ìä∏ ?òÏóà?µÎãà??

?ÖÏ∞∞?òÏã§ ?ÅÌíà???úÌïò??ÏµúÏ¢Ö?ÖÏ∞∞ Î∂Ä?ÅÎìúÎ¶ΩÎãà??)
Í∞êÏÇ¨?©Îãà??)`,
      fmessage: `2Ï∞??úÏïàÍ∞Ä ?±Î°ù ?ÑÎ£å
ÏµúÏ¢ÖÍ∏àÏï° ?ÖÏ∞∞ ?îÏ≤≠

#{Í≥†Í∞ùÎ™????ÖÏ∞∞?òÏã† ?ÑÏû•Í≤ΩÎß§ Î™®Îì†?ÅÌíà???Ä???úÏïàÍ∏àÏï°???ÖÎç∞?¥Ìä∏ ?òÏóà?µÎãà??

?ÖÏ∞∞?òÏã§ ?ÅÌíà???úÌïò??ÏµúÏ¢Ö?ÖÏ∞∞ Î∂Ä?ÅÎìúÎ¶ΩÎãà??)
Í∞êÏÇ¨?©Îãà??)

?¥Îãπ ?úÏïà Í∏àÏï° ?ÖÎç∞?¥Ìä∏ ?åÎ¶º Î©îÏãúÏßÄ??Í≥†Í∞ù?òÏùò ?åÎ¶º ?†Ï≤≠???òÌï¥ Î∞úÏÜ°?©Îãà??`,
      buttons: [
        {
          name: "Ï±ÑÎÑêÏ∂îÍ?",
          linkType: "AC",
          linkTypeName: "Ï±ÑÎÑê Ï∂îÍ?",
        },
        {
          name: "?ÖÏ∞∞",
          linkType: "WL",
          linkTypeName: "?πÎßÅ??,
          linkPc: "https://casastrade.com/bidProductsPage?bidType=live",
          linkMo: "https://casastrade.com/bidProductsPage?bidType=live",
        },
      ],
    };

    return this.sendKakaoMessage(messages, config);
  }

  // ???íÏ? ?ÖÏ∞∞ ?åÎ¶º
  async sendHigherBidAlert(messages) {
    const config = {
      templateCode: "UB_8489",
      subject: "?îÎÜí?Ä?ÖÏ∞∞",
      emtitle: "#{?ÅÌíàÎ™?",
      message:
        "?ÖÏ∞∞?òÏã† #{?ÅÌíàÎ™????ÖÏ∞∞?òÏã† Í∏àÏï°Î≥¥Îã§ ?íÏ? ?ÖÏ∞∞??Î∞úÏÉù?òÏ??µÎãà??",
      buttons: [
        {
          name: "?ÖÏ∞∞ ??™©",
          linkType: "WL",
          linkTypeName: "?πÎßÅ??,
          linkPc: "https://casastrade.com/bidProductsPage",
          linkMo: "https://casastrade.com/bidProductsPage",
        },
      ],
    };

    return this.sendKakaoMessage(messages, config);
  }
}

// ?∏Ïä§?¥Ïä§ ?ùÏÑ± ?©ÌÜ†Î¶??®Ïàò
function createMessageService() {
  return new MessageService({
    apiKey: process.env.SMS_API_KEY,
    userId: process.env.SMS_USER_ID,
    sender: process.env.SMS_SENDER,
    senderKey: process.env.CASATRADE_SENDER_KEY,
  });
}

// ÎπÑÏ¶à?àÏä§ Î°úÏßÅÎ≥?Î©îÏãúÏßÄ Î∞úÏÜ° ?®Ïàò??

// ?ôÏ∞∞ ?ÑÎ£å ?åÎ¶º Î∞úÏÜ°
async function sendWinningNotifications(completedBids) {
  const messageService = createMessageService();
  const userIds = [...new Set(completedBids.map((bid) => bid.user_id))];
  const users = await getUsersWithPhone(userIds);

  if (users.length === 0) return;

  const messages = [];

  // ?†Ï?Î≥? ?†ÏßúÎ≥ÑÎ°ú Í∑∏Î£π??
  users.forEach((user) => {
    const userBids = completedBids.filter((bid) => bid.user_id === user.id);

    // ?†ÏßúÎ≥ÑÎ°ú Í∑∏Î£π??
    const bidsByDate = userBids.reduce((acc, bid) => {
      const bidDate = bid.scheduled_date
        ? new Date(bid.scheduled_date).toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0];

      if (!acc[bidDate]) {
        acc[bidDate] = [];
      }
      acc[bidDate].push(bid);
      return acc;
    }, {});

    // Í∞??†ÏßúÎ≥ÑÎ°ú Î©îÏãúÏßÄ ?ùÏÑ±
    Object.entries(bidsByDate).forEach(([date, dateBids]) => {
      const bidCount = dateBids.length;

      messages.push({
        phone: user.phone,
        params: {
          ?†Ïßú: date,
          Í≥†Í∞ùÎ™? user.id,
          Í±¥Ïàò: bidCount.toString(),
          Í≥ÑÏ¢å?çÏä§?? ACCOUNT_TEXT,
        },
      });
    });
  });

  return await safeSendMessage(
    messageService,
    "sendWinningNotification",
    messages,
    "winning notification"
  );
}

// ÏµúÏ¢Ö ?ÖÏ∞∞ ?îÏ≤≠ Î∞úÏÜ°
async function sendFinalBidRequests(secondBids) {
  const messageService = createMessageService();
  const userIds = [...new Set(secondBids.map((bid) => bid.user_id))];
  const users = await getUsersWithPhone(userIds);

  if (users.length === 0) return;

  const messages = users.map((user) => ({
    phone: user.phone,
    params: {
      Í≥†Í∞ùÎ™? user.id,
    },
  }));

  return await safeSendMessage(
    messageService,
    "sendFinalBidRequest",
    messages,
    "final bid request"
  );
}

// ???íÏ? ?ÖÏ∞∞ ?åÎ¶º Î∞úÏÜ°
async function sendHigherBidAlerts(cancelledBids) {
  const messageService = createMessageService();
  const userIds = [...new Set(cancelledBids.map((bid) => bid.user_id))];
  const users = await getUsersWithPhone(userIds);

  if (users.length === 0) return;

  const messages = users.map((user) => {
    const userBid = cancelledBids.find((bid) => bid.user_id === user.id);
    return {
      phone: user.phone,
      params: {
        ?ÅÌíàÎ™? userBid.title || userBid.item_id,
      },
    };
  });

  return await safeSendMessage(
    messageService,
    "sendHigherBidAlert",
    messages,
    "higher bid alert"
  );
}

async function sendDailyWinningNotifications() {
  const connection = await pool.getConnection();

  try {
    // Î∞úÏÜ°?òÏ? ?äÏ? ?ÑÎ£å??live ?ÖÏ∞∞??Ï°∞Ìöå
    const [liveBids] = await connection.query(`
      SELECT 'live' as bid_type, l.id as bid_id, l.user_id, 
             i.title, i.scheduled_date
      FROM live_bids l
      JOIN crawled_items i ON l.item_id = i.item_id
      WHERE l.status = 'completed'
        AND l.notification_sent_at IS NULL
        AND COALESCE(l.winning_price, l.final_price) > 0
    `);

    // Î∞úÏÜ°?òÏ? ?äÏ? ?ÑÎ£å??direct ?ÖÏ∞∞??Ï°∞Ìöå
    const [directBids] = await connection.query(`
      SELECT 'direct' as bid_type, d.id as bid_id, d.user_id,
             i.title, i.scheduled_date
      FROM direct_bids d
      JOIN crawled_items i ON d.item_id = i.item_id
      WHERE d.status = 'completed'
        AND d.notification_sent_at IS NULL
        AND d.winning_price > 0
    `);

    const completedBids = [...liveBids, ...directBids];

    if (completedBids.length === 0) {
      console.log("No completed bids to notify");
      return;
    }

    // Í∏∞Ï°¥ sendWinningNotifications ?®Ïàò ?¨ÏÇ¨??(?ÑÎìúÎ™??µÏùº???∞Ïù¥?∞Î°ú)
    const result = await sendWinningNotifications(completedBids);

    if (result && result.success) {
      // Î∞úÏÜ° ?ÑÎ£å ?åÎûòÍ∑??ÖÎç∞?¥Ìä∏ (?¥Î??ÅÏúºÎ°?live/direct Íµ¨Î∂Ñ)
      await updateNotificationTimestamp(connection, completedBids);
    }
  } catch (error) {
    console.error("Error in daily winning notifications:", error);
  } finally {
    connection.release();
  }
}

async function updateNotificationTimestamp(connection, bids) {
  const now = new Date();

  const liveBids = bids.filter((b) => b.bid_type === "live");
  const directBids = bids.filter((b) => b.bid_type === "direct");

  if (liveBids.length > 0) {
    const liveIds = liveBids.map((b) => b.bid_id);
    const placeholders = liveIds.map(() => "?").join(",");
    await connection.query(
      `UPDATE live_bids SET notification_sent_at = ? WHERE id IN (${placeholders})`,
      [now, ...liveIds]
    );
  }

  if (directBids.length > 0) {
    const directIds = directBids.map((b) => b.bid_id);
    const placeholders = directIds.map(() => "?").join(",");
    await connection.query(
      `UPDATE direct_bids SET notification_sent_at = ? WHERE id IN (${placeholders})`,
      [now, ...directIds]
    );
  }

  console.log(`Updated notification timestamp for ${bids.length} bids`);
}

async function sendDailyFinalBidReminders() {
  const connection = await pool.getConnection();

  try {
    // ?¥Ïùº Í≤ΩÎß§?∏Îç∞ ?ÑÏßÅ final_priceÍ∞Ä ?ÜÎäî second ?ÅÌÉú ?ÖÏ∞∞??Ï°∞Ìöå
    const [secondBids] = await connection.query(`
      SELECT l.id as bid_id, l.user_id
      FROM live_bids l
      JOIN crawled_items i ON l.item_id = i.item_id
      WHERE l.status = 'second'
        AND l.request_sent_at IS NULL
        AND DATE(i.scheduled_date) <= DATE(DATE_ADD(NOW(), INTERVAL 1 DAY))
        AND DATE(i.scheduled_date) >= DATE(NOW())
    `);

    if (secondBids.length === 0) {
      console.log("No second bids to remind for tomorrow's auction");
      return;
    }

    // Í∏∞Ï°¥ sendFinalBidRequests ?®Ïàò ?¨ÏÇ¨??
    const result = await sendFinalBidRequests(secondBids);

    if (result && result.success) {
      // Î∞úÏÜ° ?ÑÎ£å ?åÎûòÍ∑??ÖÎç∞?¥Ìä∏
      const bidIds = secondBids.map((b) => b.bid_id);
      const placeholders = bidIds.map(() => "?").join(",");
      const now = new Date();

      await connection.query(
        `UPDATE live_bids SET request_sent_at = ? WHERE id IN (${placeholders})`,
        [now, ...bidIds]
      );

      console.log(`Updated request_sent_at for ${bidIds.length} second bids`);
    }
  } catch (error) {
    console.error("Error in daily final bid reminders:", error);
  } finally {
    connection.release();
  }
}

// ?âÏùº(??Í∏? 16?úÏóê ?§Ìñâ
cron.schedule("0 16 * * 1-5", async () => {
  console.log("Starting daily winning notifications...");
  await sendDailyWinningNotifications();
});

// Îß§Ïùº 18?úÏóê ?§Ìñâ
cron.schedule("0 18 * * *", async () => {
  console.log("Starting daily final bid reminders...");
  await sendDailyFinalBidReminders();
});

module.exports = {
  MessageService,
  createMessageService,
  sendWinningNotifications,
  sendFinalBidRequests,
  sendHigherBidAlerts,
};
