// public/js/calculate-fee.js

let EXCHANGE_RATE = 0.9; // 환율

// 환율 가져오기
async function fetchExchangeRate() {
  try {
    const response = await fetch("/api/data/exchange-rate");
    const data = await response.json();
    EXCHANGE_RATE = data.rate;
    return data.rate;
  } catch (error) {
    console.error("Error fetching exchange rate:", error);
    return EXCHANGE_RATE; // 기본값 반환
  }
}

/**
 * 현지 수수료 계산 함수
 * @param {number} price - 상품 가격 (P291)
 * @param {number} auctionId - 플랫폼 구분 (1: ecoauc, 2: brand, 3: starbuyers)
 * @param {string} category - 상품 카테고리
 * @returns {number} 계산된 현지 수수료
 */
function calculateLocalFee(price, auctionId, category) {
  if (!price) return 0;
  price = Number(price);

  // ecoauc (auctionId: 1)
  if (auctionId == 1) {
    if (price < 10000) return 1800;
    if (price < 50000) return 2800;
    if (price < 100000) return 4800;
    if (price < 1000000) return 8800;
    return 10800;
  }

  // brand auction (auctionId: 2)
  if (auctionId == 2) {
    if (price < 100000) {
      return Math.round(price * 0.11 + 1990);
    }
    return Math.round(price * 0.077 + 1990);
  }

  // starbuyers (auctionId: 3)
  if (auctionId == 3) {
    // 1. 기본 수수료 계산
    const baseFee = price * 0.05;
    const vat = baseFee * 0.1;
    const insurance = (baseFee + vat) * 0.005;

    // 2. 카테고리별 추가 수수료
    let categoryFee = 0;
    switch (category) {
      case "가방":
        categoryFee = 2900;
        break;
      case "시계":
        categoryFee = 2700;
        break;
      case "쥬얼리":
      case "보석":
        categoryFee = 500 + price * 0.05;
        break;
      case "악세서리":
      case "의류":
        categoryFee = 2000 + price * 0.05;
        break;
    }

    // 3. 최종 수수료 (전체 합계 + 10%)
    return Math.round((baseFee + vat + insurance + categoryFee) * 1.1);
  }

  return 0;
}

/**
 * 관세 계산 함수 (부가세 제외)
 * @param {number} amountKRW - 원화 금액 (R291)
 * @param {string} category - 상품 카테고리
 * @returns {number} 계산된 관세 (부가세 제외)
 */
function calculateCustomsDuty(amountKRW, category) {
  if (!amountKRW || !category) return 0;

  // 의류/신발: 23% 관세
  if (["의류", "신발"].includes(category)) {
    return Math.round(amountKRW * 0.23);
  }

  // 그 외 카테고리 (가방/악세서리/소품/귀금속/시계 등)
  if (amountKRW <= 2000000) {
    // 200만원 이하: 8% 관세
    return Math.round(amountKRW * 0.08);
  } else if (amountKRW < 1000000000) {
    // 200만원 초과 10억 미만에 대한 복합 관세 계산
    const baseCustoms = amountKRW * 0.08; // 기본 관세 8%
    const amount = amountKRW; // 원금
    const excess = (baseCustoms + amount - 2000000) * 0.2; // 200만원 초과분에 대한 20%
    const superExcess = excess * 0.3; // 추가세에 대한 30%

    // (기본관세 + 원금 + 추가세 + 할증) * 1.1 - 원금
    return Math.round(
      (baseCustoms + amount + excess + superExcess) * 1.1 - amount
    );
  }

  return 0; // 10억 이상
}

/**
 * 최종 가격 계산 함수 (관부가세 포함)
 * @param {number} price - 상품 가격
 * @param {number} auctionId - 플랫폼 구분 (1: ecoauc, 2: brand, 3: starbuyers)
 * @param {string} category - 상품 카테고리
 * @returns {number} 최종 계산된 가격 (관부가세 포함)
 */
function calculateTotalPrice(price, auctionId, category) {
  price = parseFloat(price) || 0;

  // 1. 현지 수수료 계산
  const localFee = calculateLocalFee(price, auctionId, category);

  // 2. 원화 환산 (현지가격 + 현지수수료)
  const totalAmountKRW = (price + localFee) * EXCHANGE_RATE;

  // 3. 관세 계산 (부가세 제외)
  const customsDuty = calculateCustomsDuty(totalAmountKRW, category);

  // 4. 최종 금액 반환 (반올림)
  return Math.round(totalAmountKRW + customsDuty);
}

/**
 * 입찰금액 기준 수수료 계산 함수
 * @param {number} price - 입찰 금액
 * @returns {number|string} 계산된 수수료 또는 "별도 협의" 문자열
 */
function calculateFee(price) {
  if (!price) return 0;
  price = Number(price);

  // 숫자가 아닌 경우 0 반환
  if (isNaN(price)) return 0;

  let fee = 0;

  // 5,000,000원 이하: 10%
  if (price <= 5000000) {
    fee = price * 0.1;
  } else {
    fee = 5000000 * 0.1; // 5,000,000원까지 10%
    price -= 5000000;

    // 5,000,000원 ~ 10,000,000원 구간: 7%
    if (price <= 5000000) {
      fee += price * 0.07;
    } else {
      fee += 5000000 * 0.07; // 5,000,000원까지 7%
      price -= 5000000;

      // 10,000,000원 ~ 50,000,000원 구간: 5%
      if (price <= 40000000) {
        fee += price * 0.05;
      } else {
        fee += 40000000 * 0.05; // 40,000,000원까지 5%
        // 50,000,000원 이상은 별도 협의
        return "별도 협의";
      }
    }
  }

  return Math.round(fee);
}

// DOM 로드 시 환율 정보 가져오기
document.addEventListener("DOMContentLoaded", function () {
  fetchExchangeRate().then((rate) => {
    console.log("Exchange rate loaded:", rate);
  });
});
