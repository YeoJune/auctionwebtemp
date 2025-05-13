# CAS 명품감정시스템 API 문서 (vFINAL)

## 1. API 엔드포인트 개요

### 1.1. 인증(Auth) API (`/api/auth`)

- 기존 시스템의 인증 방식을 사용합니다. (`routes/auth.js` 기반)

| 메서드 | 엔드포인트 | 설명                      | 인증 필요 |
| ------ | ---------- | ------------------------- | --------- |
| POST   | `/login`   | 로그인                    | 아니오    |
| POST   | `/logout`  | 로그아웃                  | 예        |
| GET    | `/user`    | 현재 로그인한 사용자 정보 | 예        |

### 1.2. 감정(Appraisals) API (`/api/appr/appraisals`)

| 메서드 | 엔드포인트             | 설명                                                              | 인증 필요        |
| ------ | ---------------------- | ----------------------------------------------------------------- | ---------------- |
| GET    | `/my`                  | 마이페이지 종합 정보 조회 (프로필, 멤버십/크레딧, 최근 감정 목록) | 예               |
| POST   | `/request`             | 감정 신청 (모든 유형)                                             | 예               |
| GET    | `/`                    | 사용자의 감정 신청 목록 조회                                      | 예               |
| GET    | `/:appraisalId`        | 특정 감정 신청 상세 조회 (본인 또는 관리자)                       | 예               |
| GET    | `/stats/all`           | 감정 통계 (총 건수, 오늘 건수)                                    | 아니오           |
| PUT    | `/:appraisalId/result` | **(관리자 API)** 감정 결과 및 상태 업데이트 (크레딧 차감 포함)    | 예 (관리자 권한) |

### 1.3. 감정서(Certificates) API (`/api/appr/certificates`)

| 메서드 | 엔드포인트                       | 설명                                                      | 인증 필요        |
| ------ | -------------------------------- | --------------------------------------------------------- | ---------------- |
| POST   | `/issue`                         | 감정서 발급 신청                                          | 예               |
| GET    | `/`                              | 사용자의 감정서 목록 조회                                 | 예               |
| GET    | `/:certificateNumber`            | 감정서 정보 조회 (공개)                                   | 아니오           |
| PUT    | `/:certificateNumber/completion` | 감정서 발급 완료/상태 변경 처리 (결제/배송 정보 업데이트) | 예 (본인/관리자) |
| GET    | `/:certificateNumber/download`   | PDF 감정서 다운로드                                       | 예 (본인/관리자) |
| GET    | `/:certificateNumber/qrcode`     | 감정서 QR코드 이미지 제공                                 | 아니오           |

### 1.4. 복원(Restoration) API (`/api/appr/restoration`)

| 메서드 | 엔드포인트             | 설명                                  | 인증 필요        |
| ------ | ---------------------- | ------------------------------------- | ---------------- |
| GET    | `/services`            | 복원 서비스 목록 조회                 | 아니오           |
| POST   | `/requests`            | 복원 서비스 신청                      | 예               |
| GET    | `/requests`            | 사용자의 복원 요청 목록 조회          | 예               |
| GET    | `/requests/:requestId` | 복원 요청 상세 정보 조회              | 예 (본인/관리자) |
| POST   | `/services`            | **(관리자 API)** 복원 서비스 추가     | 예 (관리자 권한) |
| PUT    | `/services/:serviceId` | **(관리자 API)** 복원 서비스 수정     | 예 (관리자 권한) |
| DELETE | `/services/:serviceId` | **(관리자 API)** 복원 서비스 비활성화 | 예 (관리자 권한) |

### 1.5. 결제(Payment) API (`/api/appr/payments`)

| 메서드 | 엔드포인트                  | 설명                                                        | 인증 필요   |
| ------ | --------------------------- | ----------------------------------------------------------- | ----------- |
| POST   | `/nicepay/prepare-payment`  | 나이스페이 결제 준비 (주문 생성 및 JS SDK 파라미터 반환)    | 예          |
| POST   | `/nicepay/request-approval` | 나이스페이 결제 최종 승인 요청 (서버 승인, Basic 인증 사용) | 예          |
| POST   | `/nicepay/vbank-noti`       | 나이스페이 가상계좌 입금 통보 (Webhook)                     | (PG사 요청) |

### 1.6. 감정 시스템 관리자(Admin) API (`/api/appr-admin`)

모든 엔드포인트는 `isAuthenticated` 및 `isAdmin` 미들웨어로 보호됩니다.

| 메서드 | 엔드포인트                        | 설명                                                                                                                                                                          |
| ------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/settings/homepage`              | 홈페이지 콘텐츠 설정 조회 (`appr_admin_settings` 테이블)                                                                                                                      |
| POST   | `/settings/homepage`              | 홈페이지 콘텐츠 설정 업데이트 (이미지 업로드 포함)                                                                                                                            |
| GET    | `/users`                          | 전체 회원 목록 조회 (페이지네이션, 검색, 필터링)                                                                                                                              |
| PUT    | `/users/:userId`                  | 특정 회원 정보 업데이트 (등급, 크레딧 조정, 활성 상태)                                                                                                                        |
| GET    | `/appraisals`                     | 전체 감정 신청 목록 조회 (페이지네이션, 검색, 필터링)                                                                                                                         |
| PUT    | `/appraisals/:appraisalId/result` | 특정 감정 결과 및 상태 업데이트 (크레딧 차감 포함) - **중요: 이 엔드포인트는 `/api/appr/appraisals/:appraisalId/result`와 동일한 기능을 수행하며, 관리자만 호출 가능합니다.** |

## 2. 데이터베이스 스키마 (외래 키 제약 조건 없이 애플리케이션 레벨에서 관리)

**2.1. `users` 테이블**

- `id` (VARCHAR(50), PK)
- `password` (VARCHAR(255), NOT NULL)
- `email` (VARCHAR(100), UNIQUE)
- `name` (VARCHAR(50))
- `phone` (VARCHAR(20))
- `is_active` (BOOLEAN, DEFAULT TRUE)
- `role` (VARCHAR(20), DEFAULT 'user') - 관리자 구분을 위해 필요
- `created_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)

**2.2. `appraisals` 테이블**

- `id` (VARCHAR(36), PK)
- `user_id` (VARCHAR(50), NOT NULL) - `users.id` 참조
- `appraisal_type` (ENUM('quicklink', 'online_photo', 'offline_physical'), NOT NULL)
- `status` (ENUM('pending_payment', 'pending_review', 'in_review', 'completed', 'cancelled'), DEFAULT 'pending_review')
- `brand` (VARCHAR(100), NOT NULL)
- `model_name` (VARCHAR(100), NOT NULL)
- `category` (VARCHAR(50), NOT NULL)
- `purchase_year` (VARCHAR(10), NULL)
- `components_included` (JSON, NULL)
- `product_link` (TEXT, NULL)
- `platform` (VARCHAR(50), NULL)
- `remarks` (TEXT, NULL)
- `images` (JSON, NULL)
- `result` (ENUM('authentic', 'fake', 'uncertain', 'pending'), DEFAULT 'pending')
- `result_notes` (TEXT, NULL)
- `appraiser_id` (VARCHAR(50), NULL) - `users.id` (관리자) 참조
- `appraised_at` (DATETIME, NULL)
- `delivery_info_for_offline` (JSON, NULL)
- `payment_info` (JSON, NULL)
- `created_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)

**2.3. `certificates` 테이블**

- `id` (VARCHAR(36), PK)
- `appraisal_id` (VARCHAR(36), NOT NULL, UNIQUE) - `appraisals.id` 참조
- `certificate_number` (VARCHAR(50), NOT NULL, UNIQUE)
- `user_id` (VARCHAR(50), NOT NULL) - `users.id` 참조
- `type` (ENUM('pdf', 'physical'), NOT NULL)
- `status` (ENUM('pending_payment', 'pending_issuance', 'issued', 'shipped', 'delivered', 'cancelled'), DEFAULT 'pending_payment')
- `verification_code` (VARCHAR(100), UNIQUE, NULL)
- `issued_date` (DATETIME, NULL)
- `delivery_info` (JSON, NULL)
- `payment_info` (JSON, NULL)
- `created_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)

**2.4. `restoration_services` 테이블**

- `id` (VARCHAR(36), PK)
- `name` (VARCHAR(100), NOT NULL)
- `description` (TEXT, NOT NULL)
- `price` (DECIMAL(10, 2), NOT NULL)
- `estimated_days` (INT, NOT NULL)
- `before_image` (VARCHAR(255), NULL)
- `after_image` (VARCHAR(255), NULL)
- `is_active` (BOOLEAN, DEFAULT TRUE)
- `created_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)

**2.5. `restoration_requests` 테이블**

- `id` (VARCHAR(36), PK)
- `appraisal_id` (VARCHAR(36), NOT NULL) - `appraisals.id` 참조
- `user_id` (VARCHAR(50), NOT NULL) - `users.id` 참조
- `items` (JSON, NOT NULL) - `[{ "service_id", "service_name", "price", "status" }]`
- `status` (ENUM('pending_payment', 'pending', 'in_progress', 'completed', 'shipped', 'delivered', 'cancelled'), DEFAULT 'pending')
- `total_price` (DECIMAL(10, 2), NOT NULL)
- `delivery_info` (JSON, NOT NULL)
- `payment_info` (JSON, NULL)
- `estimated_completion_date` (DATETIME, NULL)
- `created_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)

**2.6. `user_memberships` 테이블**

- `user_id` (VARCHAR(50), PK) - `users.id` 참조
- `tier` (ENUM('까사트레이드 회원', '제휴사 회원', '일반회원'), NOT NULL)
- `quick_link_allowance` (INT, DEFAULT 0) - 현재 사용 가능한 퀵링크 횟수
- `quick_link_allowance_type` (ENUM('monthly_free', 'paid_subscription'), NULL)
- `quick_link_monthly_limit` (INT, DEFAULT 0) - 월간/구독 제공 한도
- `subscription_expires_at` (DATETIME, NULL) - 유료 구독 만료일
- `offline_appraisal_fee_override` (DECIMAL(10, 2), NULL)
- `last_reset_date_for_monthly_allowance` (DATE, NULL)
- `created_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)

**2.7. `payments` 테이블**

- `id` (VARCHAR(36), PK)
- `user_id` (VARCHAR(50), NOT NULL) - `users.id` 참조
- `order_id` (VARCHAR(100), NOT NULL, UNIQUE) - PG사 주문번호 (`Moid`)
- `payment_gateway_transaction_id` (VARCHAR(100), NULL) - PG사 거래번호 (`TID`)
- `product_name` (VARCHAR(255), NOT NULL)
- `amount` (DECIMAL(10, 2), NOT NULL)
- `status` (ENUM('pending', 'completed', 'failed', 'cancelled', 'auth_failed', 'auth_signature_mismatch', 'approval_signature_mismatch', 'server_error', 'approval_api_failed'), DEFAULT 'pending')
- `payment_method` (VARCHAR(50), NULL)
- `paid_at` (DATETIME, NULL)
- `raw_response_data` (JSON, NULL)
- `created_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)

**2.8. `credit_transactions` 테이블**

- `id` (VARCHAR(36), PK)
- `user_id` (VARCHAR(50), NOT NULL) - `users.id` 참조
- `transaction_type` (ENUM('purchase', 'usage_quicklink_free', 'usage_quicklink_paid', 'admin_adjustment', 'subscription_fee'), NOT NULL)
- `amount` (INT, NOT NULL) - 변동량 (+/-)
- `balance_after_transaction` (INT, NOT NULL) - 거래 후 `user_memberships.quick_link_allowance` 기준 잔액
- `description` (TEXT, NULL)
- `related_appraisal_id` (VARCHAR(36), NULL) - `appraisals.id` 참조
- `related_payment_id` (VARCHAR(36), NULL) - `payments.id` 참조
- `created_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP)

**2.9. `appr_admin_settings` 테이블**

- `setting_key` (VARCHAR(100), PK)
- `setting_value` (TEXT)
- `updated_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)

## 3. API 상세 명세

(이전 답변의 "CAS 명품감정시스템 API 문서 (v4 - 최종)"의 상세 명세 부분을 여기에 그대로 사용합니다. 주요 내용은 엔드포인트별 요청/응답 형식, 인증 필요 여부 등입니다. 중복을 피하기 위해 여기서는 생략합니다.)

### **중요 참고사항 (API 상세 명세 공통):**

- **인증:** "예"로 표시된 API는 요청 헤더에 유효한 세션 쿠키가 포함되어야 합니다. "관리자"는 `req.session.user.id === 'admin'` (또는 `role === 'admin'`) 조건을 만족해야 합니다.
- **JSON 필드:** DB 스키마에서 `JSON` 타입으로 명시된 필드 (예: `components_included`, `images`, `items`, `delivery_info`, `payment_info`, `raw_response_data`)는 API 요청/응답 시 JSON 문자열 또는 파싱된 객체/배열 형태로 처리됩니다.
- **페이지네이션:** 목록 조회 API는 일반적으로 다음과 같은 `pagination` 객체를 응답에 포함합니다:
  ```json
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalItems": 48,
    "limit": 10 // 요청된 limit 값
  }
  ```
- **나이스페이 연동:**
  - `/nicepay/prepare-payment`는 프론트엔드가 NicePay JS SDK 호출 **전**에 서버에 주문을 기록하고 SDK 파라미터를 받기 위해 호출합니다.
  - `/nicepay/request-approval`은 NicePay JS SDK의 `returnUrl`로 지정된 **프론트엔드 페이지**에서 인증 성공 후, 해당 페이지의 JavaScript가 서버로 최종 승인을 요청하기 위해 호출합니다.
  - **모든 Signature 검증 로직은 NicePay 최신 매뉴얼을 기준으로 서버에서 철저히 구현되어야 합니다.**

## 4. 오류 코드 및 응답

(이전 답변의 "오류 코드 및 응답" 섹션 내용을 여기에 그대로 사용합니다. HTTP 상태 코드별 일반적인 메시지 예시입니다.)

```json
{
  "success": false,
  "message": "오류 메시지",
  "code": "오류 코드(선택)" // 예: "INVALID_INPUT", "NOT_FOUND", "UNAUTHORIZED_ADMIN"
}
```

| 상태 코드 | 일반적 설명                                      |
| --------- | ------------------------------------------------ |
| 200/201   | 요청 성공                                        |
| 400       | 잘못된 요청 (형식, 필수 필드 누락 등)            |
| 401       | 인증 실패 (로그인 필요)                          |
| 402       | 결제 필요 (예: 크레딧 부족)                      |
| 403       | 접근 거부 (권한 부족, 예: 관리자 전용)           |
| 404       | 요청한 리소스를 찾을 수 없음                     |
| 409       | 리소스 충돌 (예: 이미 존재하는 데이터 생성 시도) |
| 500       | 서버 내부 오류                                   |

---
