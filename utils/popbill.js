// utils/popbill.js
const popbill = require("popbill");
const { pool } = require("./DB");

// 팝빌 SDK 초기화
popbill.config({
  LinkID: process.env.POPBILL_LINKID,
  SecretKey: process.env.POPBILL_SECRET_KEY,
  IsTest: process.env.POPBILL_IS_TEST === "true",
  IPRestrictOnOff: true,
  UseStaticIP: false,
  UseLocalTimeYN: true,
  defaultErrorHandler: function (error) {
    console.error("Popbill Default Error:", error.code, error.message);
  },
});

const bankService = popbill.EasyFinBankService();
const taxService = popbill.TaxinvoiceService();
const cashService = popbill.CashbillService();

class PopbillService {
  constructor() {
    this.CORP_NUM = process.env.POPBILL_CORP_NUM;
    this.BANK_CODE = process.env.COMPANY_BANK_CODE;
    this.ACCOUNT_NUMBER = process.env.COMPANY_ACCOUNT_NUMBER;
  }

  /**
   * 입금 확인 (계좌조회 API) - deposit & settlement 통합
   * @param {Object} data - { amount/final_amount, depositor_name, company_name }
   * @param {String} type - 'deposit' 또는 'settlement'
   * @returns {Object|null} 매칭된 거래 또는 null
   */
  async checkTransaction(data, type) {
    try {
      // 동적 날짜 계산: 하루 전부터 오늘까지
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const start = this.formatDate(yesterday);
      const end = this.formatDate(today);

      // 금액 및 입금자명 추출 (type에 따라)
      const amount = type === "deposit" ? data.amount : data.final_amount;
      const depositorName =
        type === "deposit"
          ? data.depositor_name && data.depositor_name.trim()
          : (data.depositor_name && data.depositor_name.trim()) ||
            (data.company_name && data.company_name.trim());

      console.log(
        `\n[${type === "deposit" ? "예치금" : "정산"} 입금 확인 시작]`,
      );
      console.log("- 금액:", amount);
      console.log("- 입금자명:", depositorName);
      console.log("- 조회 기간:", start, "~", end);

      // 입금자명 체크
      if (!depositorName) {
        console.log("❌ 입금자명이 없어서 매칭 불가");
        return null;
      }

      // 1. 계좌조회 요청
      const jobID = await this.requestBankJobHardcoded(start, end);
      console.log("- JobID:", jobID);

      // 2. 완료 대기
      await this.waitJob(jobID);
      console.log("- 수집 완료");

      // 3. 거래내역 조회
      const transactions = await this.getTransactions(jobID);
      console.log("- 거래내역 수:", transactions.length, "건");

      // 4. 매칭 (적요 또는 예금주와 비교)
      console.log("\n[매칭 시도]");
      console.log("찾는 금액:", Number(amount));
      console.log("찾는 입금자명:", depositorName);

      const matched = transactions.find((t) => {
        const amountMatch = Number(t.accIn) === Number(amount);
        const name1Match = this.nameMatch(depositorName, t.remark1);
        const name2Match = this.nameMatch(depositorName, t.remark2);
        const nameMatch = name1Match || name2Match;

        // 모든 거래 디버그
        console.log(`\n거래 TID=${t.tid}:`);
        console.log(
          `  입금액: ${t.accIn} vs ${amount} → ${amountMatch ? "✅" : "❌"}`,
        );
        console.log(
          `  적요: "${t.remark1}" vs "${depositorName}" → ${name1Match ? "✅" : "❌"}`,
        );
        console.log(
          `  예금주: "${t.remark2}" vs "${depositorName}" → ${name2Match ? "✅" : "❌"}`,
        );

        return amountMatch && nameMatch;
      });

      if (matched) {
        console.log("✅ 매칭 성공!");
        console.log("- TID:", matched.tid);
        console.log("- 거래일시:", matched.trdt);
        console.log("- 금액:", matched.accIn);
        console.log("- 적요:", matched.remark1);
        console.log("- 예금주:", matched.remark2);
      } else {
        console.log("❌ 매칭 실패 (거래내역 없음)");
      }

      return matched || null;
    } catch (error) {
      console.error(`❌ [${type} 입금 확인 오류]`, error.message);
      throw error;
    }
  }

  // 하위 호환성을 위한 alias
  async checkPayment(transaction, startDate) {
    return this.checkTransaction(transaction, "deposit");
  }

  async checkSettlement(settlement, startDate) {
    return this.checkTransaction(settlement, "settlement");
  }

  /**
   * 현금영수증 발행
   * @param {Object} transaction - { id, amount, depositor_name, processed_at }
   * @param {Object} user - { email, phone, company_name }
   * @returns {Object} { confirmNum, tradeDate, mgtKey }
   */
  async issueCashbill(transaction, user) {
    try {
      console.log("\n[현금영수증 발행 시작]");
      console.log("- 금액:", transaction.amount);
      console.log("- 고객명:", user.company_name);

      const mgtKey = `CB-${transaction.id}-${Date.now()}`;

      const data = {
        mgtKey,
        tradeDT: this.formatDateTime(transaction.processed_at || new Date()),
        tradeType: "승인거래",
        tradeUsage: "소득공제용",
        taxationType: "과세",
        totalAmount: transaction.amount.toString(),
        supplyCost: Math.round(transaction.amount / 1.1).toString(),
        tax: Math.round(
          transaction.amount - transaction.amount / 1.1,
        ).toString(),
        serviceFee: "0",
        franchiseCorpNum: this.CORP_NUM,
        franchiseCorpName: process.env.COMPANY_NAME,
        franchiseCEOName: process.env.COMPANY_CEO,
        franchiseAddr: process.env.COMPANY_ADDRESS,
        franchiseTEL: process.env.COMPANY_TEL,
        identityNum: user.phone || "010-0000-0000",
        customerName: user.company_name,
        itemName: "예치금 충전",
        email: user.email,
        hp: user.phone,
        smssendYN: true,
      };

      console.log("- 문서번호:", mgtKey);

      const result = await new Promise((resolve, reject) => {
        cashService.registIssue(this.CORP_NUM, data, null, resolve, reject);
      });

      console.log("✅ 발행 완료!");
      console.log("- 국세청승인번호:", result.confirmNum);
      console.log("- 거래일자:", result.tradeDate);

      return { ...result, mgtKey };
    } catch (error) {
      console.error("❌ [현금영수증 발행 오류]", error.message);
      throw error;
    }
  }

  /**
   * 세금계산서 발행
   * @param {Object} settlement - { id, settlement_date, final_amount, item_count }
   * @param {Object} user - { business_number, company_name, email }
   * @returns {Object} { ntsConfirmNum, issueDT, invoicerMgtKey }
   */
  async issueTaxinvoice(settlement, user) {
    try {
      console.log("\n[세금계산서 발행 시작]");
      console.log("- 금액:", settlement.final_amount);
      console.log("- 공급받는자:", user.company_name);

      if (!user.business_number) {
        throw new Error("사업자등록번호가 없습니다.");
      }

      const mgtKey = `TAX-${settlement.id}-${Date.now()}`;

      const data = {
        issueType: "정발행",
        taxType: "과세",
        chargeDirection: "정과금",
        writeDate: this.formatDate(settlement.settlement_date),
        purposeType: "영수",
        supplyCostTotal: Math.round(settlement.final_amount / 1.1).toString(),
        taxTotal: Math.round(
          settlement.final_amount - settlement.final_amount / 1.1,
        ).toString(),
        totalAmount: settlement.final_amount.toString(),
        invoicerMgtKey: mgtKey,

        // 공급자 (우리 회사)
        invoicerCorpNum: this.CORP_NUM,
        invoicerCorpName: process.env.COMPANY_NAME,
        invoicerCEOName: process.env.COMPANY_CEO,
        invoicerAddr: process.env.COMPANY_ADDRESS,
        invoicerBizType: process.env.COMPANY_BUSINESS_TYPE,
        invoicerBizClass: process.env.COMPANY_BUSINESS_CLASS,
        invoicerTEL: process.env.COMPANY_TEL,

        // 공급받는자 (고객) - 간소화
        invoiceeType: "사업자",
        invoiceeCorpNum: user.business_number,
        invoiceeCorpName: user.company_name,
        invoiceeCEOName: user.company_name, // 대표자명도 company_name 사용
        invoiceeAddr: "",
        invoiceeBizType: "",
        invoiceeBizClass: "",
        invoiceeEmail1: user.email,

        // 품목
        detailList: [
          {
            serialNum: 1,
            purchaseDT: this.formatDate(settlement.settlement_date),
            itemName: "경매 대행 서비스",
            spec: `낙찰 ${settlement.item_count || 1}건`,
            qty: "1",
            supplyCost: Math.round(settlement.final_amount / 1.1).toString(),
            tax: Math.round(
              settlement.final_amount - settlement.final_amount / 1.1,
            ).toString(),
          },
        ],
      };

      console.log("- 문서번호:", mgtKey);

      const result = await new Promise((resolve, reject) => {
        taxService.registIssue(
          this.CORP_NUM,
          data,
          false,
          "",
          false,
          null,
          "",
          null,
          resolve,
          reject,
        );
      });

      console.log("✅ 발행 완료!");
      console.log("- 국세청승인번호:", result.ntsConfirmNum);
      console.log("- 발행일시:", result.issueDT);

      return { ...result, invoicerMgtKey: mgtKey };
    } catch (error) {
      console.error("❌ [세금계산서 발행 오류]", error.message);
      throw error;
    }
  }

  // ===== 내부 헬퍼 함수 =====

  requestBankJob(startDate) {
    return new Promise((resolve, reject) => {
      bankService.requestJob(
        this.CORP_NUM,
        this.BANK_CODE,
        this.ACCOUNT_NUMBER,
        this.formatDate(startDate),
        this.formatDate(new Date()),
        null,
        (jobID) => {
          console.log("- 계좌조회 요청 성공");
          resolve(jobID);
        },
        (error) => {
          console.error("- 계좌조회 요청 실패:", error.message);
          reject(error);
        },
      );
    });
  }

  requestBankJobHardcoded(startDate, endDate) {
    return new Promise((resolve, reject) => {
      bankService.requestJob(
        this.CORP_NUM,
        this.BANK_CODE,
        this.ACCOUNT_NUMBER,
        startDate,
        endDate,
        null,
        (jobID) => {
          console.log("- 계좌조회 요청 성공");
          resolve(jobID);
        },
        (error) => {
          console.error("- 계좌조회 요청 실패:", error.message);
          reject(error);
        },
      );
    });
  }

  async waitJob(jobID) {
    for (let i = 0; i < 20; i++) {
      const state = await new Promise((resolve, reject) => {
        bankService.getJobState(this.CORP_NUM, jobID, null, resolve, reject);
      });

      console.log(`- 수집 상태 확인 (${i + 1}/20): jobState=${state.jobState}`);

      if (state.jobState === 3) {
        return; // 완료
      }

      if (state.errorCode) {
        throw new Error(`팝빌 작업 오류: ${state.errorReason}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error("팝빌 작업 타임아웃 (10초 초과)");
  }

  getTransactions(jobID) {
    return new Promise((resolve, reject) => {
      bankService.search(
        this.CORP_NUM,
        jobID,
        [], // 모든 거래 조회 (한글 필터는 URL 인코딩 오류 발생)
        "", // 검색어 없음
        1, // 페이지
        500, // 최대 500건
        "D", // 내림차순
        null,
        (result) => {
          console.log("- 거래내역 조회 성공");

          // 디버깅: 전체 거래내역 출력
          console.log("\n[전체 거래내역]");
          (result.list || []).forEach((t, idx) => {
            console.log(`\n${idx + 1}. ${t.trtype || "타입없음"}`);
            console.log(`   - TID: ${t.tid}`);
            console.log(`   - 일시: ${t.trdt}`);
            console.log(`   - 입금액: ${t.accIn}원`);
            console.log(`   - 출금액: ${t.accOut}원`);
            console.log(`   - 잔액: ${t.balance}원`);
            console.log(`   - 적요: ${t.remark1 || "-"}`);
            console.log(`   - 예금주: ${t.remark2 || "-"}`);
          });
          console.log("\n");

          // 입금만 필터링 (trtype이 없는 경우 accIn > 0이면 입금)
          const deposits = (result.list || []).filter(
            (t) => t.trtype === "입금" || (Number(t.accIn) > 0 && !t.trtype),
          );
          console.log(
            `- 입금 거래: ${deposits.length}건 (전체 ${result.list?.length || 0}건)`,
          );
          resolve(deposits);
        },
        (error) => {
          console.error("- 거래내역 조회 실패:", error.message);
          reject(error);
        },
      );
    });
  }

  nameMatch(inputName, bankName) {
    // null, undefined, 빈 문자열 체크
    if (
      !inputName ||
      !bankName ||
      inputName.trim() === "" ||
      bankName.trim() === ""
    ) {
      return false;
    }

    const normalize = (str) =>
      str.replace(/[\s\-()주식회사유한회사]/g, "").toLowerCase();

    const a = normalize(inputName);
    const b = normalize(bankName);

    const result = a.includes(b) || b.includes(a);

    console.log(
      `- 예금주명 비교: "${inputName}" vs "${bankName}" → ${result ? "일치" : "불일치"}`,
    );

    return result;
  }

  /**
   * 중복 매칭 방지 - TID가 이미 사용되었는지 확인
   */
  async isTransactionUsed(tid) {
    const [rows] = await pool.query(
      "SELECT id FROM used_bank_transactions WHERE tid = ?",
      [tid],
    );
    return rows.length > 0;
  }

  /**
   * 사용된 거래 기록
   */
  async markTransactionUsed(tid, tradeData, usedByType, usedById) {
    await pool.query(
      `INSERT INTO used_bank_transactions (tid, trade_dt, trade_amount, account_name, used_by_type, used_by_id) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        tid,
        tradeData.trdt,
        tradeData.accIn,
        tradeData.remark2 || tradeData.remark1,
        usedByType,
        usedById,
      ],
    );
  }

  formatDate(date) {
    return new Date(date).toISOString().slice(0, 10).replace(/-/g, "");
  }

  formatDateTime(date) {
    return new Date(date)
      .toISOString()
      .slice(0, 19)
      .replace(/[-:T]/g, "")
      .slice(0, 14);
  }
}

module.exports = new PopbillService();
