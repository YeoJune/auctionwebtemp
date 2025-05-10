# 최종 백엔드 API 문서 (완성본)

## 1. API 엔드포인트 개요

### 인증(Auth) API

| 메서드 | 엔드포인트         | 설명                      | 인증 필요 |
| ------ | ------------------ | ------------------------- | --------- |
| POST   | `/api/auth/login`  | 로그인                    | 아니오    |
| POST   | `/api/auth/logout` | 로그아웃                  | 예        |
| GET    | `/api/auth/user`   | 현재 로그인한 사용자 정보 | 예        |

### 감정(Appraisals) API

| 메서드 | 엔드포인트                            | 설명                                  | 인증 필요   |
| ------ | ------------------------------------- | ------------------------------------- | ----------- |
| POST   | `/api/appraisals/request`             | 감정 신청 (모든 유형)                 | 예          |
| GET    | `/api/appraisals`                     | 사용자의 감정 신청 목록 조회          | 예          |
| GET    | `/api/appraisals/:appraisalId`        | 특정 감정 신청 상세 조회              | 예          |
| PUT    | `/api/appraisals/:appraisalId/result` | (관리자용) 감정 결과 및 상태 업데이트 | 예 (관리자) |
| GET    | `/api/appraisals/stats`               | (선택) 감정 통계 (총 건수, 오늘 건수) | 아니오      |

### 감정서(Certificates) API

| 메서드 | 엔드포인트                                        | 설명                                           | 인증 필요 |
| ------ | ------------------------------------------------- | ---------------------------------------------- | --------- |
| POST   | `/api/certificates/issue`                         | 감정서 발급 신청                               | 예        |
| GET    | `/api/certificates`                               | 사용자의 감정서 목록 조회                      | 예        |
| GET    | `/api/certificates/:certificateNumber`            | 감정서 정보 조회 (공개)                        | 아니오    |
| PUT    | `/api/certificates/:certificateNumber/completion` | 감정서 발급 완료 처리 (배송/결제정보 업데이트) | 예        |
| GET    | `/api/certificates/:certificateNumber/download`   | PDF 감정서 다운로드                            | 예        |
| GET    | `/api/certificates/:certificateNumber/qrcode`     | 감정서 QR코드 이미지 제공                      | 아니오    |

### 복원(Restoration) API

| 메서드            | 엔드포인트                             | 설명                         | 인증 필요   |
| ----------------- | -------------------------------------- | ---------------------------- | ----------- |
| GET               | `/api/restoration/services`            | 복원 서비스 목록 조회        | 아니오      |
| POST              | `/api/restoration/requests`            | 복원 서비스 신청             | 예          |
| GET               | `/api/restoration/requests`            | 사용자의 복원 요청 목록 조회 | 예          |
| GET               | `/api/restoration/requests/:requestId` | 복원 요청 상세 정보 조회     | 예          |
| (관리자용) POST   | `/api/restoration/services`            | (관리자) 복원 서비스 추가    | 예 (관리자) |
| (관리자용) PUT    | `/api/restoration/services/:serviceId` | (관리자) 복원 서비스 수정    | 예 (관리자) |
| (관리자용) DELETE | `/api/restoration/services/:serviceId` | (관리자) 복원 서비스 삭제    | 예 (관리자) |

## 2. 데이터베이스 스키마

**2.1. `users` 테이블**

- `id` (VARCHAR(36), PK): 사용자 ID
- `password` (VARCHAR(255)): 해시된 비밀번호
- `email` (VARCHAR(100), UNIQUE): 이메일
- `name` (VARCHAR(50)): 사용자 이름
- `phone` (VARCHAR(20)): 연락처
- `is_active` (BOOLEAN, DEFAULT TRUE): 계정 활성 여부
- `created_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)

**2.2. `appraisals` 테이블**

- `id` (VARCHAR(36), PK): 감정 요청 ID (UUID v4 추천)
- `user_id` (VARCHAR(36), FK, REFERENCES `users(id)`): 신청 사용자 ID
- `appraisal_type` (ENUM('quicklink', 'online_photo', 'offline_physical')): 감정 유형
- `status` (ENUM('pending_payment', 'pending_review', 'in_review', 'completed', 'cancelled'), DEFAULT 'pending_review'): 감정 진행 상태
- `brand` (VARCHAR(100)): 브랜드명
- `model_name` (VARCHAR(100)): 모델명
- `category` (VARCHAR(50)): 카테고리
- `purchase_year` (VARCHAR(10), NULL): 구매 연도
- `components_included` (JSON, NULL): 보유 구성품 (예: `["box", "dustbag"]`)
- `product_link` (TEXT, NULL): 퀵링크 감정 시 상품 URL
- `platform` (VARCHAR(50), NULL): 퀵링크 감정 시 거래 플랫폼
- `remarks` (TEXT, NULL): 특이사항 또는 추가 문의사항
- `images` (JSON, NULL): 온라인 사진 감정 시 업로드된 이미지 경로들 (예: `["/uploads/img1.jpg", "/uploads/img2.jpg"]`)
- `result` (ENUM('authentic', 'fake', 'uncertain', 'pending'), DEFAULT 'pending'): 감정 결과
- `result_notes` (TEXT, NULL): 감정 결과 상세 설명, 판별 포인트
- `appraiser_id` (VARCHAR(36), NULL): 감정사 ID (관리자 계정 ID 등)
- `appraised_at` (DATETIME, NULL): 감정 완료 일시
- `delivery_info_for_offline` (JSON, NULL): 오프라인 감정 시 상품 반송받을 주소
- `payment_info` (JSON, NULL): 감정 비용 결제 정보
- `created_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)

**2.3. `certificates` 테이블**

- `id` (VARCHAR(36), PK): 감정서 ID (UUID v4 추천)
- `appraisal_id` (VARCHAR(36), FK, REFERENCES `appraisals(id)`): 어떤 감정에 대한 감정서인지 연결
- `certificate_number` (VARCHAR(50), UNIQUE): 감정서 번호 (생성 규칙 필요, 예: `CAS-L24-0001`)
- `user_id` (VARCHAR(36), FK, REFERENCES `users(id)`): 감정서 소유자 ID
- `type` (ENUM('pdf', 'physical')): 감정서 유형
- `status` (ENUM('pending_payment', 'pending_issuance', 'issued', 'shipped', 'delivered'), DEFAULT 'pending_payment'): 감정서 발급 상태
- `verification_code` (VARCHAR(50), UNIQUE, NULL): (선택) 외부 검증용 코드
- `issued_date` (DATETIME, NULL): 감정서 발급(완료) 일자
- `delivery_info` (JSON, NULL): 실물 감정서 배송 정보
- `payment_info` (JSON, NULL): 감정서 발급 비용 결제 정보
- `created_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)

**2.4. `restoration_services` 테이블**

- `id` (VARCHAR(36), PK): 복원 서비스 고유 ID (UUID v4 추천)
- `name` (VARCHAR(100)): 서비스명
- `description` (TEXT): 서비스 상세 설명
- `price` (DECIMAL(10, 2)): 기본 가격
- `estimated_days` (INT): 예상 소요일
- `before_image` (VARCHAR(255), NULL): 복원 전 대표 이미지 경로
- `after_image` (VARCHAR(255), NULL): 복원 후 대표 이미지 경로
- `is_active` (BOOLEAN, DEFAULT TRUE): 서비스 활성 여부
- `created_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)

**2.5. `restoration_requests` 테이블**

- `id` (VARCHAR(36), PK): 복원 요청 ID (UUID v4 추천)
- `appraisal_id` (VARCHAR(36), FK, REFERENCES `appraisals(id)`): 어떤 감정 건에 대한 복원 요청인지 연결
- `user_id` (VARCHAR(36), FK, REFERENCES `users(id)`): 복원 요청 사용자 ID
- `items` (JSON): 신청한 복원 서비스 항목들. 각 항목은 `service_id`, `service_name`, 신청 당시의 `price`, 개별 `status` 포함.
  ```json
  [
    {
      "service_id": "s1e2...",
      "service_name": "모서리 까짐",
      "price": 20000,
      "status": "pending"
    }
  ]
  ```
- `status` (ENUM('pending_payment', 'pending', 'in_progress', 'completed', 'shipped', 'delivered'), DEFAULT 'pending'): 전체 복원 요청 진행 상태
- `total_price` (DECIMAL(10, 2)): 총 복원 비용
- `delivery_info` (JSON): 복원품 수령/발송 주소
- `payment_info` (JSON, NULL): 복원 비용 결제 정보
- `estimated_completion_date` (DATETIME, NULL): 예상 완료일
- `created_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)

## 3. API 상세 명세

### 3.0 인증 API

#### 3.0.1 로그인

`POST /api/auth/login`
**인증 필요: 아니오**
**요청 본문:**

```json
{
  "id": "사용자ID",
  "password": "비밀번호"
}
```

**응답 예시 (성공):**

```json
{
  "message": "로그인 성공",
  "user": {
    "id": "사용자ID",
    "email": "user@example.com",
    "name": "홍길동"
  }
}
```

**응답 예시 (실패 - 자격 증명 오류):**

```json
{
  "message": "비밀번호가 다릅니다." // 또는 "접근 권한이 없습니다. ..."
}
```

**응답 예시 (실패 - 비활성 계정):**

```json
{
  "message": "서비스 기간이 만기되었습니다. 010-2894-8502를 통해 문의주세요."
}
```

#### 3.0.2 로그아웃

`POST /api/auth/logout`
**인증 필요: 예**
**응답 예시 (성공):**

```json
{
  "message": "로그아웃 성공"
}
```

**응답 예시 (실패):**

```json
{
  "message": "로그아웃 처리 중 오류가 발생했습니다."
}
```

#### 3.0.3 사용자 정보 조회

`GET /api/auth/user`
**인증 필요: 예**
**응답 예시 (성공):**

```json
{
  "user": {
    "id": "사용자ID",
    "email": "user@example.com",
    "name": "홍길동",
    "phone": "010-1234-5678"
  }
}
```

**응답 예시 (실패 - 미인증):**

```json
{
  "message": "인증되지 않은 사용자입니다."
}
```

### 3.1 감정(Appraisals) API

#### 3.1.1 감정 신청

`POST /api/appraisals/request`

- **인증 필요:** 예
- **요청 본문 (예시 - `appraisal_type`에 따라 필요한 필드가 달라짐):**
  - **공통:**
    - `appraisal_type`: "quicklink" | "online_photo" | "offline_physical" (필수)
    - `brand`: "브랜드명" (필수)
    - `model_name`: "모델명" (필수)
    - `category`: "카테고리" (필수)
    - `remarks`: "추가 문의사항" (선택)
    - `payment_info`: (결제 정보 객체 - 감정 비용) (선택, 결제 방식에 따라)
      ```json
      { "method": "card", "amount": 15000, "transaction_id": "pay_appr_xxx" }
      ```
  - **`appraisal_type: "quicklink"` 시 추가:**
    - `product_link`: "상품 URL" (필수)
    - `platform`: "거래 플랫폼" (선택, 예: "당근마켓")
  - **`appraisal_type: "online_photo"` 시 추가:**
    - `images`: `["/uploads/image1.jpg", "/uploads/image2.jpg"]` (업로드된 이미지 경로 배열, 최소 1개 필수)
    - `purchase_year`: "구매 연도" (선택, 예: "2022")
    - `components_included`: `["box", "receipt"]` (선택, 보유 구성품 배열)
  - **`appraisal_type: "offline_physical"` 시 추가:**
    - `delivery_info_for_offline`: (상품 반송받을 주소 정보 객체) (필수)
      ```json
      {
        "name": "홍길동",
        "phone": "010-1234-5678",
        "zipcode": "12345",
        "address1": "서울시 강남구",
        "address2": "역삼동 123-45"
      }
      ```
    - `purchase_year`: "구매 연도" (선택)
    - `components_included`: `["box", "receipt"]` (선택)
- **응답 예시 (성공):**
  ```json
  {
    "success": true,
    "message": "감정 신청이 접수되었습니다.",
    "appraisal": {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890", // 생성된 감정 ID
      "status": "pending_review", // 초기 상태 (또는 pending_payment)
      "appraisal_type": "online_photo"
    }
  }
  ```
- **응답 예시 (실패):**
  ```json
  {
    "success": false,
    "message": "필수 정보가 누락되었습니다: [누락된 필드명]"
  }
  ```

#### 3.1.2 사용자의 감정 신청 목록 조회

`GET /api/appraisals`

- **인증 필요:** 예
- **쿼리 파라미터 (선택):**
  - `status`: `pending_review` | `in_review` | `completed` | `cancelled` (필터링)
  - `page`: 페이지 번호 (기본값 1)
  - `limit`: 페이지 당 항목 수 (기본값 10)
- **응답 예시 (성공):**
  ```json
  {
    "success": true,
    "appraisals": [
      {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "brand": "루이비통",
        "model_name": "네버풀 MM",
        "appraisal_type": "online_photo",
        "status": "completed",
        "result": "authentic",
        "created_at": "2025-05-01T09:00:00Z",
        "representative_image": "/uploads/image1.jpg" // images 중 대표 이미지 하나
      },
      {
        "id": "x1y2z3w4-v5u6-7890-abcd-ef1234567890",
        "brand": "샤넬",
        "model_name": "클래식 플랩백",
        "appraisal_type": "offline_physical",
        "status": "in_review",
        "result": "pending",
        "created_at": "2025-05-03T14:30:00Z",
        "representative_image": null // 오프라인의 경우 이미지가 없을 수 있음
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 5,
      "totalItems": 48
    }
  }
  ```

#### 3.1.3 특정 감정 신청 상세 조회

`GET /api/appraisals/:appraisalId`

- **인증 필요:** 예 (본인 또는 관리자)
- **응답 예시 (성공):**
  ```json
  {
    "success": true,
    "appraisal": {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "user_id": "user123",
      "appraisal_type": "online_photo",
      "status": "completed",
      "brand": "루이비통",
      "model_name": "네버풀 MM",
      "category": "가방",
      "purchase_year": "2022",
      "components_included": ["dustbag"],
      "product_link": null,
      "platform": null,
      "remarks": "모서리 부분 약간의 사용감 있음",
      "images": ["/uploads/lv_neverfull_1.jpg", "/uploads/lv_neverfull_2.jpg"],
      "result": "authentic",
      "result_notes": "로고 및 TC코드 확인 결과 정품으로 판단됩니다. 모서리 가죽 마모 상태는 B급입니다.",
      "appraiser_id": "admin_user",
      "appraised_at": "2025-05-02T11:00:00Z",
      "delivery_info_for_offline": null,
      "payment_info": {
        "method": "card",
        "amount": 15000,
        "transaction_id": "pay_appr_xxx"
      },
      "created_at": "2025-05-01T09:00:00Z",
      "updated_at": "2025-05-02T11:00:00Z",
      "certificate": {
        // 만약 이 감정에 대해 발급된 감정서가 있다면
        "certificate_number": "CAS-LV24-0001",
        "status": "issued",
        "type": "pdf"
      }
    }
  }
  ```
- **응답 예시 (실패 - 찾을 수 없음 또는 권한 없음):**
  ```json
  {
    "success": false,
    "message": "감정 정보를 찾을 수 없거나 접근 권한이 없습니다."
  }
  ```

#### 3.1.4 (관리자용) 감정 결과 및 상태 업데이트

`PUT /api/appraisals/:appraisalId/result`

- **인증 필요:** 예 (관리자)
- **요청 본문:**
  ```json
  {
    "status": "completed", // 필수 (예: "in_review", "completed", "cancelled")
    "result": "authentic", // "completed" 상태일 때 필수 ("authentic", "fake", "uncertain")
    "result_notes": "로고, 스티치, TC코드 등 주요 포인트 확인 결과 정품입니다.", // "completed" 상태일 때 필수
    "appraiser_id": "admin_user_id" // (선택) 감정사 ID
  }
  ```
- **응답 예시 (성공):**
  ```json
  {
    "success": true,
    "message": "감정 결과가 업데이트되었습니다.",
    "appraisal": {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "status": "completed",
      "result": "authentic"
    }
  }
  ```

#### 3.1.5 (선택) 감정 통계

`GET /api/appraisals/stats`

- **인증 필요:** 아니오
- **응답 예시 (성공):**
  ```json
  {
    "success": true,
    "stats": {
      "total_appraisals": 10250, // appraisals 테이블의 총 row 수
      "today_appraisals": 15 // 오늘 created_at 기준 row 수
    }
  }
  ```

### 3.2 감정서(Certificates) API

#### 3.2.1 감정서 발급 신청

`POST /api/certificates/issue`

- **인증 필요:** 예
- **요청 본문:**
  ```json
  {
    "appraisal_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890", // 필수
    "type": "physical", // "pdf" 또는 "physical" (필수)
    "delivery_info": {
      // type이 "physical"일 경우 필수
      "name": "홍길동",
      "phone": "010-1234-5678",
      "zipcode": "12345",
      "address1": "서울시 강남구",
      "address2": "역삼동 123-45"
    },
    "payment_info": {
      // (선택) 발급 비용 결제 정보
      "method": "card",
      "amount": 10000,
      "transaction_id": "pay_cert_yyy"
    }
  }
  ```
- **응답 예시 (성공):**
  ```json
  {
    "success": true,
    "message": "감정서 발급 신청이 완료되었습니다. 결제 확인 후 발급이 진행됩니다.",
    "certificate": {
      "id": "c1e2r3t4-i5f6-7890-abcd-ef1234567890",
      "certificate_number": "CAS-LV25-0001",
      "appraisal_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "type": "physical",
      "status": "pending_payment" // 또는 "pending_issuance"
    }
  }
  ```
  **주의:** 이 API는 해당 `appraisal_id`의 `appraisals.result`가 'authentic', 'fake' 등 확정된 상태일 때만 성공해야 합니다. ('pending'이거나 'uncertain'이면 발급 불가)

#### 3.2.2 사용자의 감정서 목록 조회

`GET /api/certificates`

- **인증 필요:** 예
- **쿼리 파라미터 (선택):**
  - `status`: `pending_payment` | `issued` | `shipped` 등 (필터링)
  - `page`, `limit`
- **응답 예시 (성공):**
  ```json
  {
    "success": true,
    "certificates": [
      {
        "id": "c1e2r3t4-i5f6-7890-abcd-ef1234567890",
        "certificate_number": "CAS-LV25-0001",
        "type": "physical",
        "status": "issued",
        "issued_date": "2025-05-10T10:00:00Z",
        "appraisal": {
          // appraisals 테이블 JOIN 결과
          "brand": "루이비통",
          "model_name": "네버풀 MM",
          "result": "authentic",
          "representative_image": "/uploads/lv_neverfull_1.jpg"
        },
        "created_at": "2025-05-09T15:00:00Z"
      }
    ],
    "pagination": {
      /* ... */
    }
  }
  ```

#### 3.2.3 감정서 정보 조회 (공개)

`GET /api/certificates/:certificateNumber`

- **인증 필요:** 아니오
- **응답 예시 (성공):**
  ```json
  {
    "success": true,
    "certificate": {
      "certificate_number": "CAS-LV25-0001",
      "type": "physical",
      "status": "issued", // 감정서 발급 상태
      "issued_date": "2025-05-10T10:00:00Z",
      "appraisal": {
        // appraisals 테이블 JOIN 결과
        "appraisal_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "brand": "루이비통",
        "model_name": "네버풀 MM",
        "category": "가방",
        "result": "authentic", // 감정 결과
        "images": [
          "/uploads/lv_neverfull_1.jpg",
          "/uploads/lv_neverfull_2.jpg"
        ], // appraisals.images
        "result_notes": "로고 및 TC코드 확인 결과 정품으로 판단됩니다." // appraisals.result_notes
      }
      // "verification_code": "abcdef123456" // 필요시 포함
    }
  }
  ```

#### 3.2.4 감정서 발급 완료 처리 (배송/결제정보 업데이트)

`PUT /api/certificates/:certificateNumber/completion`

- **인증 필요:** 예 (본인 또는 관리자)
- **목적:** 사용자가 마이페이지 등에서 `pending_payment` 또는 `pending_issuance` 상태의 감정서를 선택하여, 배송지 정보를 입력/수정하고 최종 결제를 완료한 후 호출.
- **요청 본문:**
  ```json
  {
    "delivery_info": {
      // type이 "physical"이고, 수정 또는 최초 입력 시
      "name": "홍길동",
      "phone": "010-1234-5678",
      "zipcode": "12345",
      "address1": "서울시 강남구",
      "address2": "역삼동 123-45"
    },
    "payment_info": {
      // (필수) 감정서 발급 비용 최종 결제 정보
      "method": "card",
      "amount": 10000,
      "transaction_id": "final_pay_cert_zzz"
    },
    "status_to_update": "issued" // (선택) 관리자가 직접 상태 변경 시. 사용자는 주로 결제 완료로 인한 자동 상태 변경 기대.
    // 일반 사용자는 이 필드 없이 요청, 서버에서 결제 완료 후 'issued'로 변경.
  }
  ```
- **응답 예시 (성공):**
  ```json
  {
    "success": true,
    "message": "감정서 발급 처리가 완료되었습니다.",
    "certificate": {
      "certificate_number": "CAS-LV25-0001",
      "status": "issued", // 업데이트된 상태
      "delivery_info_updated": true
    }
  }
  ```

#### 3.2.5 PDF 감정서 다운로드

`GET /api/certificates/:certificateNumber/download`

- **인증 필요:** 예
- **응답:** PDF 파일 스트림 (`application/pdf`)
  - PDF 내용은 해당 `:certificateNumber`로 `certificates` 및 `appraisals` 테이블을 JOIN 하여 관련 정보(브랜드, 모델, 감정결과, 감정사 노트, 대표 이미지, QR코드 등)를 포함하여 동적으로 생성.

#### 3.2.6 감정서 QR코드 이미지 제공

`GET /api/certificates/:certificateNumber/qrcode`

- **인증 필요:** 아니오
- **응답:** PNG 이미지 스트림 (`image/png`)
  - QR코드는 공개 감정서 조회 페이지 (`GET /api/certificates/:certificateNumber` 또는 해당 프론트엔드 상세 페이지 URL)로 연결되도록 생성.

### 3.3 복원(Restoration) API

#### 3.3.1 복원 서비스 목록 조회

`GET /api/restoration/services`

- **인증 필요:** 아니오
- **응답 예시 (성공):**
  ```json
  {
    "success": true,
    "services": [
      {
        "id": "s1e2r3v4-i5c6e7-8901-abcd-ef1234567890",
        "name": "모서리 까짐",
        "description": "가방 모서리의 파손이나 마모된 부분을 전문 기술로 복원합니다.",
        "price": 20000,
        "estimated_days": 3,
        "before_image": "/images/restoration_static/corner_before.jpg", // DB의 경로 또는 정적 경로
        "after_image": "/images/restoration_static/corner_after.jpg",
        "is_active": true
      },
      {
        "id": "m1e2t3a4-l5g6o7l8-9012-abcd-ef1234567890",
        "name": "금속 도금 벗겨짐",
        "description": "하드웨어의 도금이 벗겨진 부분을 원래 상태로 복원하여 광택을 되살립니다.",
        "price": 30000,
        "estimated_days": 5,
        "before_image": "/images/restoration_static/metal_before.jpg",
        "after_image": "/images/restoration_static/metal_after.jpg",
        "is_active": true
      }
    ]
  }
  ```

#### 3.3.2 복원 서비스 신청

`POST /api/restoration/requests`

- **인증 필요:** 예
- **요청 본문:**
  ```json
  {
    "appraisal_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890", // 필수
    "items": [
      // 필수, 최소 1개
      // service_id는 GET /services에서 받은 id, price도 해당 id의 price와 일치해야 함 (서버측 검증)
      {
        "service_id": "s1e2r3v4-i5c6e7-8901-abcd-ef1234567890",
        "price": 20000
      },
      {
        "service_id": "m1e2t3a4-l5g6o7l8-9012-abcd-ef1234567890",
        "price": 30000
      }
    ],
    "delivery_info": {
      // 복원품 수령/발송 주소 (필수)
      "name": "홍길동",
      "phone": "010-1234-5678",
      "zipcode": "12345",
      "address1": "서울시 강남구",
      "address2": "역삼동 123-45"
    },
    "payment_info": {
      // (선택) 복원 비용 결제 정보
      "method": "card",
      "amount": 50000,
      "transaction_id": "pay_resto_abc"
    }
  }
  ```
- **응답 예시 (성공):**
  ```json
  {
    "success": true,
    "message": "복원 서비스 신청이 완료되었습니다.",
    "request": {
      "id": "r1e2q3u4-e5s6t7-8901-abcd-ef1234567890", // 생성된 복원 요청 ID
      "status": "pending", // 초기 상태 (또는 pending_payment)
      "total_price": 50000,
      "estimated_completion_date": "2025-05-15T09:00:00Z" // 서버에서 계산
    }
  }
  ```

#### 3.3.3 사용자의 복원 요청 목록 조회

`GET /api/restoration/requests`

- **인증 필요:** 예
- **쿼리 파라미터 (선택):**
  - `status`: `pending` | `in_progress` | `completed` 등 (필터링)
  - `page`, `limit`
- **응답 예시 (성공):**
  ```json
  {
    "success": true,
    "requests": [
      {
        "id": "r1e2q3u4-e5s6t7-8901-abcd-ef1234567890",
        "status": "in_progress",
        "total_price": 50000,
        "estimated_completion_date": "2025-05-15T09:00:00Z",
        "appraisal": {
          // appraisals 테이블 JOIN 결과
          "brand": "루이비통",
          "model_name": "네버풀 MM",
          "representative_image": "/uploads/lv_neverfull_1.jpg"
        },
        "items": [
          // restoration_requests.items JSON 필드 내용 (service_name은 신청 시점의 값)
          {
            "service_id": "s1e2...",
            "service_name": "모서리 까짐",
            "price": 20000,
            "status": "in_progress"
          },
          {
            "service_id": "m1e2...",
            "service_name": "금속 도금 벗겨짐",
            "price": 30000,
            "status": "pending"
          }
        ],
        "created_at": "2025-05-08T10:00:00Z"
      }
    ],
    "pagination": {
      /* ... */
    }
  }
  ```

#### 3.3.4 복원 요청 상세 정보 조회

`GET /api/restoration/requests/:requestId`

- **인증 필요:** 예 (본인 또는 관리자)
- **응답 예시 (성공):**
  ```json
  {
    "success": true,
    "request": {
      "id": "r1e2q3u4-e5s6t7-8901-abcd-ef1234567890",
      "status": "in_progress",
      "total_price": 50000,
      "appraisal": {
        // appraisals 테이블 JOIN 결과
        "appraisal_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "brand": "루이비통",
        "model_name": "네버풀 MM",
        "category": "가방",
        "images": ["/uploads/lv_neverfull_1.jpg", "/uploads/lv_neverfull_2.jpg"] // appraisals.images
      },
      "items": [
        // restoration_requests.items JSON 필드 내용
        {
          "service_id": "s1e2r3v4-i5c6e7-8901-abcd-ef1234567890",
          "service_name": "모서리 까짐",
          "price": 20000,
          "status": "completed" // 각 아이템별 진행 상태
        },
        {
          "service_id": "m1e2t3a4-l5g6o7l8-9012-abcd-ef1234567890",
          "service_name": "금속 도금 벗겨짐",
          "price": 30000,
          "status": "in_progress"
        }
      ],
      "delivery_info": {
        /* 배송 정보 */
      },
      "payment_info": {
        /* 결제 정보 */
      },
      "created_at": "2025-05-08T10:00:00Z",
      "updated_at": "2025-05-09T11:00:00Z",
      "estimated_completion_date": "2025-05-15T09:00:00Z"
    }
  }
  ```

#### 3.3.5 (관리자용) 복원 서비스 추가

`POST /api/restoration/services`

- **인증 필요:** 예 (관리자)
- **요청 본문:**
  ```json
  {
    "name": "가죽 클리닝 및 영양 공급", // 필수
    "description": "오염된 가죽 표면을 클리닝하고...", // 필수
    "price": 25000, // 필수
    "estimated_days": 2, // 필수
    "before_image": "/images/restoration_static/cleaning_before.jpg", // 선택
    "after_image": "/images/restoration_static/cleaning_after.jpg", // 선택
    "is_active": true // 선택 (기본값 true)
  }
  ```
- **응답 예시 (성공):**
  ```json
  {
    "success": true,
    "message": "복원 서비스가 성공적으로 추가되었습니다.",
    "service": {
      "id": "newly-generated-uuid", // 생성된 서비스 ID
      "name": "가죽 클리닝 및 영양 공급",
      "price": 25000
      // ... 나머지 정보
    }
  }
  ```

#### 3.3.6 (관리자용) 복원 서비스 수정

`PUT /api/restoration/services/:serviceId`

- **인증 필요:** 예 (관리자)
- **요청 본문:** (수정할 필드만 포함)
  ```json
  {
    "price": 22000,
    "description": "업데이트된 설명입니다. 더욱 강화된 클리닝!",
    "is_active": false
  }
  ```
- **응답 예시 (성공):**
  ```json
  {
    "success": true,
    "message": "복원 서비스가 성공적으로 수정되었습니다.",
    "service": {
      "id": "해당-serviceId",
      "name": "기존 서비스명", // 수정 안됐으면 기존 값
      "price": 22000,
      "description": "업데이트된 설명입니다. 더욱 강화된 클리닝!",
      "is_active": false
      // ...
    }
  }
  ```

#### 3.3.7 (관리자용) 복원 서비스 삭제

`DELETE /api/restoration/services/:serviceId`

- **인증 필요:** 예 (관리자)
- **응답 예시 (성공):**
  ```json
  {
    "success": true,
    "message": "복원 서비스가 성공적으로 삭제되었습니다."
  }
  ```
  **주의:** 실제 운영 시에는 데이터를 직접 삭제하기보다는 `is_active = false`로 설정하는 소프트 삭제(soft delete)를 권장합니다.

## 4. 오류 코드 및 응답

모든 오류 응답은 다음 형식을 따릅니다:

```json
{
  "success": false,
  "message": "오류 메시지",
  "code": "오류 코드(선택)" // 예: "INVALID_INPUT", "NOT_FOUND", "UNAUTHORIZED"
}
```

| 상태 코드 | 메시지 예시                                  | 일반적 설명                                          |
| --------- | -------------------------------------------- | ---------------------------------------------------- |
| 200/201   | (각 API 성공 메시지 참조)                    | 요청 성공                                            |
| 400       | "필수 정보가 누락되었습니다: [필드명]"       | 잘못된 요청 (요청 형식, 필수 필드 누락 등)           |
| 401       | "인증되지 않은 사용자입니다."                | 인증 실패 (로그인 필요 또는 유효하지 않은 토큰/세션) |
| 403       | "요청한 리소스에 대한 접근 권한이 없습니다." | 접근 거부 (권한 부족)                                |
| 404       | "해당 감정 정보를 찾을 수 없습니다."         | 요청한 리소스를 찾을 수 없음                         |
| 409       | "이미 존재하는 감정서 번호입니다."           | 리소스 충돌 (중복 데이터 생성 시도 등)               |
| 500       | "서버 내부 오류가 발생했습니다."             | 서버 측 오류                                         |

---
