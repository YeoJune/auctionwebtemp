const axios = require("axios");
require("dotenv").config();

class MessageService {
  constructor({ apiKey, userId, sender, senderKey }) {
    this.apiKey = apiKey;
    this.userId = userId;
    this.sender = sender;
    this.senderKey = senderKey;
  }

  formatMessage(template, params) {
    let message = template;
    Object.entries(params).forEach(([key, value]) => {
      message = message.replace(`#{${key}}`, value);
    });
    return message;
  }

  async sendKakao1(messages) {
    try {
      const buttonJson = {
        button: [
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

      const formData = new URLSearchParams({
        apikey: this.apiKey,
        userid: this.userId,
        senderkey: this.senderKey,
        tpl_code: "UB_8485",
        sender: this.sender,
        failover: "N",
        testMode: "Y",
      });

      messages.forEach(({ phone, params }, index) => {
        const num = index + 1;
        const emtitleTemplate = "#{날짜} 경매 #{건수}건 낙찰";
        const messageTemplate = `#{고객명}님 #{날짜}입찰하신 상품중 #{건수}건 낙찰되었습니다.

금액 : #{금액}원

국민은행 792002 01 202171
황승하(까사부티크)`;
        const fmessageTemplate = `#{날짜} 경매 #{건수}건 낙찰

#{고객명}님 #{날짜}입찰하신 상품중 #{건수}건 낙찰되었습니다.

금액 : #{금액}원

국민은행 792002 01 202171
황승하(까사부티크)`;

        formData.append(`receiver_${num}`, phone);
        formData.append(`subject_${num}`, "낙찰완료");
        formData.append(
          `emtitle_${num}`,
          this.formatMessage(emtitleTemplate, params)
        );
        formData.append(
          `message_${num}`,
          this.formatMessage(messageTemplate, params)
        );
        formData.append(
          `fmessage_${num}`,
          this.formatMessage(fmessageTemplate, params)
        );
        formData.append(`button_${num}`, JSON.stringify(buttonJson));
      });

      const response = await axios.post(
        "https://kakaoapi.aligo.in/akv10/alimtalk/send/",
        formData.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      console.log(response);

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

  async sendKakao2(messages) {
    try {
      const buttonJson = {
        button: [
          {
            name: "채널추가",
            linkType: "AC",
            linkTypeName: "채널 추가",
          },
          {
            name: "입찰항목 페이지",
            linkType: "WL",
            linkTypeName: "웹링크",
            linkPc: "https://casastrade.com/bidProductsPage?",
            linkMo: "https://casastrade.com/bidProductsPage?",
          },
        ],
      };

      const formData = new URLSearchParams({
        apikey: this.apiKey,
        userid: this.userId,
        senderkey: this.senderKey,
        tpl_code: "UB_8487",
        sender: this.sender,
        failover: "N",
        testMode: "Y",
      });

      messages.forEach(({ phone, params }, index) => {
        const num = index + 1;
        const emtitleTemplate = "최종금액 입찰 요청";
        const messageTemplate = `#{고객명}님 입찰하신 현장경매 모든상품에 대한 제안금액이 업데이트 되었습니다.

입찰하실 상품에 한하여 최종입찰 부탁드립니다:)
감사합니다:)`;
        const fmessageTemplate = `2차 제안가 등록 완료
최종금액 입찰 요청

#{고객명}님 입찰하신 현장경매 모든상품에 대한 제안금액이 업데이트 되었습니다.

입찰하실 상품에 한하여 최종입찰 부탁드립니다:)
감사합니다:)

해당 제안 금액 업데이트 알림 메시지는 고객님의 알림 신청에 의해 발송됩니다.`;

        formData.append(`receiver_${num}`, phone);
        formData.append(`subject_${num}`, "2차금액 제안완료");
        formData.append(
          `emtitle_${num}`,
          this.formatMessage(emtitleTemplate, params)
        );
        formData.append(
          `message_${num}`,
          this.formatMessage(messageTemplate, params)
        );
        formData.append(
          `fmessage_${num}`,
          this.formatMessage(fmessageTemplate, params)
        );
        formData.append(`button_${num}`, JSON.stringify(buttonJson));
      });

      const response = await axios.post(
        "https://kakaoapi.aligo.in/akv10/alimtalk/send/",
        formData.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      console.log(response);

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

  async sendKakao3(messages) {
    try {
      const buttonJson = {
        button: [
          {
            name: "입찰 항목",
            linkType: "WL",
            linkTypeName: "웹링크",
            linkPc: "https://casastrade.com/bidProductsPage",
            linkMo: "https://casastrade.com/bidProductsPage",
          },
        ],
      };

      const formData = new URLSearchParams({
        apikey: this.apiKey,
        userid: this.userId,
        senderkey: this.senderKey,
        tpl_code: "UB_8489",
        sender: this.sender,
        failover: "N",
        testMode: "Y",
      });

      messages.forEach(({ phone, params }, index) => {
        const num = index + 1;
        const emtitleTemplate = "#{상품명}";
        const messageTemplate = `입찰하신 #{상품명}에 입찰하신 금액보다 높은 입찰이 발생하였습니다.`;

        formData.append(`receiver_${num}`, phone);
        formData.append(`subject_${num}`, "더 높은 입찰 발생");
        formData.append(
          `emtitle_${num}`,
          this.formatMessage(emtitleTemplate, params)
        );
        formData.append(
          `message_${num}`,
          this.formatMessage(messageTemplate, params)
        );
        formData.append(`button_${num}`, JSON.stringify(buttonJson));
      });

      const response = await axios.post(
        "https://kakaoapi.aligo.in/akv10/alimtalk/send/",
        formData.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      console.log(response);

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
}

// 테스트 실행
async function testKakao() {
  const messageService = new MessageService({
    apiKey: process.env.SMS_API_KEY,
    userId: process.env.SMS_USER_ID,
    sender: process.env.SMS_SENDER,
    senderKey: process.env.CASATRADE_SENDER_KEY,
  });

  // 테스트 메시지 데이터
  const testMessages = [
    {
      phone: "01051341771", // 받을 사람 번호
      params: {
        고객명: "홍길동",
        날짜: "2025-08-21",
        건수: "3",
        금액: "150,000",
      },
    },
  ];

  try {
    console.log("카카오톡 메시지 전송 중...");
    const result1 = await messageService.sendKakao1(testMessages);
    const result2 = await messageService.sendKakao2(testMessages);
    const result3 = await messageService.sendKakao3(testMessages);

    console.log("전송 결과:", result1, result2, result3);

    if (result1.success) {
      console.log("✅ 메시지 전송 성공!");
      console.log(
        `성공: ${result1.successCount}건, 실패: ${result1.errorCount}건`
      );
    } else {
      console.log("❌ 메시지 전송 실패:", result1.error);
    }
    if (result2.success) {
      console.log("✅ 메시지 전송 성공!");
      console.log(
        `성공: ${result2.successCount}건, 실패: ${result2.errorCount}건`
      );
    } else {
      console.log("❌ 메시지 전송 실패:", result2.error);
    }
    if (result3.success) {
      console.log("✅ 메시지 전송 성공!");
      console.log(
        `성공: ${result3.successCount}건, 실패: ${result3.errorCount}건`
      );
    } else {
      console.log("❌ 메시지 전송 실패:", result3.error);
    }
  } catch (error) {
    console.error("에러 발생:", error.message);
  }
}

// 테스트 실행
testKakao();
