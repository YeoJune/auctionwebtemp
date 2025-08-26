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
        testMode: "N",
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
            name: "입ㅊㅏㄺ",
            linkType: "WL",
            linkTypeName: "웹링크",
            linkPc:
              "https://casastrade.com/bidProductsPage?bidType=live&itemsPerPage=10",
            linkMo:
              "https://casastrade.com/bidProductsPage?bidType=live&itemsPerPage=10",
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
        testMode: "N",
      });

      messages.forEach(({ phone, params }, index) => {
        const num = index + 1;
        const emtitleTemplate = "최종금액 입찰 요청";
        const messageTemplate = `#{고객명}님 입찰하신 현장경매 모든상품에 대한 제안금액이 업데이트 되었습니다.

입찰하실 상품에 한하여 최종입찰 부탁드립니다:)
감사합니다:)
해당 제안 금액 업데이트 알림 메시지는 고객님의 알림 신청에 의해 발송됩니다.
채널 추가하고 이 채널의 광고와 마케팅 메시지를 카카오톡으로 받기`;
        const fsubjectTemplate = `2차제안금액`;
        const fmessageTemplate = `2차 제안가 등록 완료
최종금액 입찰 요청

#{고객명}님 입찰하신 현장경매 모든상품에 대한 제안금액이 업데이트 되었습니다.

입찰하실 상품에 한하여 최종입찰 부탁드립니다:)
감사합니다:)

해당 제안 금액 업데이트 알림 메시지는 고객님의 알림 신청에 의해 발송됩니다.`;

        formData.append(`receiver_${num}`, phone);
        formData.append(`subject_${num}`, "2차제안금액");
        formData.append(
          `emtitle_${num}`,
          this.formatMessage(emtitleTemplate, params)
        );
        formData.append(
          `message_${num}`,
          this.formatMessage(messageTemplate, params)
        );
        formData.append(
          `fsubject_${num}`,
          this.formatMessage(fsubjectTemplate, params)
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
        testMode: "N",
      });

      messages.forEach(({ phone, params }, index) => {
        const num = index + 1;
        const emtitleTemplate = "#{상품명}";
        const messageTemplate = `입찰하신 #{상품명}에 입찰하신 금액보다 높은 입찰이 발생하였습니다.`;

        formData.append(`receiver_${num}`, phone);
        formData.append(`subject_${num}`, "더높은입찰");
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

// 테스트 데이터 생성
function generateTestData() {
  return {
    sendKakao1: [
      {
        phone: "01051341771",
        params: {
          날짜: "2024-12-26",
          고객명: "홍길동",
          건수: "3",
          금액: "1,500,000",
        },
      },
    ],
    sendKakao2: [
      {
        phone: "01051341771",
        params: { 고객명: "홍길동" },
      },
    ],
    sendKakao3: [
      {
        phone: "01051341771",
        params: { 상품명: "샤넬 클래식 플랩백" },
      },
    ],
  };
}

// 메시지 서비스 인스턴스 생성
function createMessageService() {
  return new MessageService({
    apiKey: process.env.SMS_API_KEY,
    userId: process.env.SMS_USER_ID,
    sender: process.env.SMS_SENDER,
    senderKey: process.env.CASATRADE_SENDER_KEY,
  });
}

// 결과 출력
function printResult(result, messageType) {
  console.log(`\n=== ${messageType} 결과 ===`);
  if (result.success) {
    console.log("✅ 메시지 전송 성공!");
    console.log(`성공: ${result.successCount}건, 실패: ${result.errorCount}건`);
  } else {
    console.log("❌ 메시지 전송 실패:", result.error);
  }
}

// 통합 테스트 함수
async function runTests(testType = "all") {
  const messageService = createMessageService();
  const testData = generateTestData();
  const testConfig = {
    sendKakao2: { name: "최종 입찰 요청 메시지", method: "sendKakao2" },
  };

  try {
    console.log("=== 카카오톡 메시지 전송 테스트 시작 ===\n");

    const results = [];
    const testsToRun =
      testType === "all" ? Object.keys(testConfig) : [testType];

    for (let i = 0; i < testsToRun.length; i++) {
      const testKey = testsToRun[i];
      const config = testConfig[testKey];

      console.log(`${i + 1}. ${config.name} 전송 중...`);
      const result = await messageService[config.method](testData[testKey]);
      console.log(result);
      printResult(result, config.name);
      results.push(result);
    }

    if (testType === "all") {
      const totalSuccess = results.reduce(
        (sum, r) => sum + (r.successCount || 0),
        0
      );
      const totalError = results.reduce(
        (sum, r) => sum + (r.errorCount || 0),
        0
      );
      console.log("\n=== 전체 테스트 완료 ===");
      console.log(`총 성공: ${totalSuccess}건, 총 실패: ${totalError}건`);
    }
  } catch (error) {
    console.error("❌ 테스트 실행 중 에러 발생:", error.message);
  }
}

// 실행
runTests(); // 전체 테스트
