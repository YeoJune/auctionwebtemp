// utils/message.js
const axios = require("axios");
const { pool } = require("./DB");
require("dotenv").config();

// 유저 전화번호 조회 함수
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

// 안전한 메시지 발송 함수
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
      message = message.replace(`#{${key}}`, value);
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

  // 낙찰 완료 알림
  async sendWinningNotification(messages) {
    const config = {
      templateCode: "UB_8485",
      subject: "낙찰완료",
      emtitle: "#{날짜} 경매 #{건수}건 낙찰",
      message: `#{고객명}님 #{날짜}입찰하신 상품중 #{건수}건 낙찰되었습니다.

금액 : #{금액}원

국민은행 792002 01 202171
황승하(까사부티크)`,
      fmessage: `#{날짜} 경매 #{건수}건 낙찰

#{고객명}님 #{날짜}입찰하신 상품중 #{건수}건 낙찰되었습니다.

금액 : #{금액}원

국민은행 792002 01 202171
황승하(까사부티크)`,
      buttons: [
        {
          name: "채널추가",
          linkType: "AC",
          linkTypeName: "채널 추가",
        },
        {
          name: "입찰결과 페이지",
          linkType: "WL",
          linkTypeName: "웹링크",
          linkPc: "https://casastrade.com/bidResultsPage",
          linkMo: "https://casastrade.com/bidResultsPage",
        },
      ],
    };

    return this.sendKakaoMessage(messages, config);
  }

  // 최종 입찰 요청
  async sendFinalBidRequest(messages) {
    const config = {
      templateCode: "UB_8707",
      subject: "2차제안금액",
      emtitle: "최종금액 입찰 요청",
      message: `#{고객명}님 입찰하신 현장경매 모든상품에 대한 제안금액이 업데이트 되었습니다.

입찰하실 상품에 한하여 최종입찰 부탁드립니다:)
감사합니다:)`,
      fmessage: `2차 제안가 등록 완료
최종금액 입찰 요청

#{고객명}님 입찰하신 현장경매 모든상품에 대한 제안금액이 업데이트 되었습니다.

입찰하실 상품에 한하여 최종입찰 부탁드립니다:)
감사합니다:)

해당 제안 금액 업데이트 알림 메시지는 고객님의 알림 신청에 의해 발송됩니다.`,
      buttons: [
        {
          name: "채널추가",
          linkType: "AC",
          linkTypeName: "채널 추가",
        },
        {
          name: "입찰",
          linkType: "WL",
          linkTypeName: "웹링크",
          linkPc: "https://casastrade.com/bidProductsPage?bidType=live",
          linkMo: "https://casastrade.com/bidProductsPage?bidType=live",
        },
      ],
    };

    return this.sendKakaoMessage(messages, config);
  }

  // 더 높은 입찰 알림
  async sendHigherBidAlert(messages) {
    const config = {
      templateCode: "UB_8489",
      subject: "더높은입찰",
      emtitle: "#{상품명}",
      message:
        "입찰하신 #{상품명}에 입찰하신 금액보다 높은 입찰이 발생하였습니다.",
      buttons: [
        {
          name: "입찰 항목",
          linkType: "WL",
          linkTypeName: "웹링크",
          linkPc: "https://casastrade.com/bidProductsPage",
          linkMo: "https://casastrade.com/bidProductsPage",
        },
      ],
    };

    return this.sendKakaoMessage(messages, config);
  }
}

// 인스턴스 생성 팩토리 함수
function createMessageService() {
  return new MessageService({
    apiKey: process.env.SMS_API_KEY,
    userId: process.env.SMS_USER_ID,
    sender: process.env.SMS_SENDER,
    senderKey: process.env.CASATRADE_SENDER_KEY,
  });
}

// 비즈니스 로직별 메시지 발송 함수들

// 낙찰 완료 알림 발송
async function sendWinningNotifications(completedBids) {
  const messageService = createMessageService();
  const userIds = [...new Set(completedBids.map((bid) => bid.user_id))];
  const users = await getUsersWithPhone(userIds);

  if (users.length === 0) return;

  const messages = users.map((user) => {
    const userBids = completedBids.filter((bid) => bid.user_id === user.id);
    const totalAmount = userBids.reduce(
      (sum, bid) =>
        sum +
        parseFloat(bid.winning_price || bid.final_price || bid.current_price),
      0
    );
    const bidCount = userBids.length;

    // scheduled_date가 있으면 사용, 없으면 현재 날짜
    const bidDate = userBids[0]?.scheduled_date
      ? new Date(userBids[0].scheduled_date).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0];

    return {
      phone: user.phone,
      params: {
        날짜: bidDate,
        고객명: user.id,
        건수: bidCount.toString(),
        금액: totalAmount.toLocaleString("ko-KR"),
      },
    };
  });

  return await safeSendMessage(
    messageService,
    "sendWinningNotification",
    messages,
    "winning notification"
  );
}

// 최종 입찰 요청 발송
async function sendFinalBidRequests(secondBids) {
  const messageService = createMessageService();
  const userIds = [...new Set(secondBids.map((bid) => bid.user_id))];
  const users = await getUsersWithPhone(userIds);

  if (users.length === 0) return;

  const messages = users.map((user) => ({
    phone: user.phone,
    params: {
      고객명: user.id,
    },
  }));

  return await safeSendMessage(
    messageService,
    "sendFinalBidRequest",
    messages,
    "final bid request"
  );
}

// 더 높은 입찰 알림 발송
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
        상품명: userBid.title || userBid.item_id,
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

module.exports = {
  MessageService,
  createMessageService,
  sendWinningNotifications,
  sendFinalBidRequests,
  sendHigherBidAlerts,
};

// sendHigherBidAlert 테스트 함수
async function testSendHigherBidAlert() {
  const messageService = createMessageService();

  const testMessages = [
    {
      phone: "01051341771", // 테스트할 전화번호
      params: {
        상품명: "상품명 테스트!", // 테스트할 상품명
      },
    },
  ];

  return await safeSendMessage(
    messageService,
    "sendHigherBidAlert",
    testMessages,
    "higher bid alert test"
  );
}

if (require.main === module) {
  testSendHigherBidAlert();
}
