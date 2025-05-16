# CAS 명품감정시스템 API 및 데이터베이스 명세 최종본

## 1. API 요약

### 1.1 인증(Auth) API - 기존 코드 사용

| 메서드 | 엔드포인트         | 설명                      |
| ------ | ------------------ | ------------------------- |
| POST   | `/api/auth/login`  | 로그인                    |
| POST   | `/api/auth/logout` | 로그아웃                  |
| GET    | `/api/auth/user`   | 현재 로그인한 사용자 정보 |

### 1.2 감정(Appraisals) API

| 메서드 | 엔드포인트                                                     | 설명                         |
| ------ | -------------------------------------------------------------- | ---------------------------- |
| POST   | `/api/appr/appraisals`                                         | 감정 신청 (퀵링크/오프라인)  |
| GET    | `/api/appr/appraisals`                                         | 사용자의 감정 신청 목록 조회 |
| GET    | `/api/appr/appraisals/:id`                                     | 특정 감정 신청 상세 조회     |
| GET    | `/api/appr/appraisals/my`                                      | 마이페이지 종합 정보         |
| GET    | `/api/appr/appraisals/certificate/:certificateNumber`          | 감정서 정보 조회             |
| GET    | `/api/appr/appraisals/certificate/:certificateNumber/download` | PDF 감정서 다운로드          |
| GET    | `/api/appr/appraisals/certificate/:certificateNumber/qrcode`   | 감정서 QR코드 이미지 제공    |

### 1.3 복원(Restorations) API

| 메서드 | 엔드포인트                        | 설명                         |
| ------ | --------------------------------- | ---------------------------- |
| GET    | `/api/appr/restorations/services` | 복원 서비스 목록 조회        |
| POST   | `/api/appr/restorations`          | 복원 서비스 신청             |
| GET    | `/api/appr/restorations`          | 사용자의 복원 요청 목록 조회 |
| GET    | `/api/appr/restorations/:id`      | 복원 요청 상세 정보 조회     |

### 1.4 사용자(Users) API

| 메서드 | 엔드포인트                     | 설명                                   |
| ------ | ------------------------------ | -------------------------------------- |
| GET    | `/api/appr/users/profile`      | 감정원 관련 프로필 및 멤버십 정보 조회 |
| GET    | `/api/appr/users/subscription` | 구독 정보 조회                         |
| POST   | `/api/appr/users/subscription` | 구독 신청/갱신                         |

### 1.5 결제(Payments) API

| 메서드 | 엔드포인트                    | 설명           |
| ------ | ----------------------------- | -------------- |
| POST   | `/api/appr/payments/prepare`  | 결제 준비      |
| POST   | `/api/appr/payments/approve`  | 결제 승인 요청 |
| GET    | `/api/appr/payments/:orderId` | 결제 정보 조회 |
| POST   | `/api/appr/payments/webhook`  | 결제 웹훅 처리 |
| GET    | `/api/appr/payments/history`  | 결제 내역 조회 |

### 1.6 관리자(Admin) API 요약

| 메서드 | 엔드포인트                                 | 설명                                    |
| ------ | ------------------------------------------ | --------------------------------------- |
| GET    | `/api/appr/admin/users`                    | 회원 목록 조회                          |
| PUT    | `/api/appr/admin/users/:id`                | 회원 정보 수정                          |
| GET    | `/api/appr/admin/appraisals`               | 전체 감정 목록 조회                     |
| GET    | `/api/appr/admin/appraisals/:id`           | 감정 상세 정보 조회                     |
| PUT    | `/api/appr/admin/appraisals/:id`           | 감정 결과 및 상태 업데이트 (통합 API)   |
| GET    | `/api/appr/admin/restoration-services`     | 복원 서비스 목록 조회                   |
| POST   | `/api/appr/admin/restoration-services`     | 복원 서비스 추가                        |
| PUT    | `/api/appr/admin/restoration-services/:id` | 복원 서비스 수정                        |
| DELETE | `/api/appr/admin/restoration-services/:id` | 복원 서비스 비활성화                    |
| GET    | `/api/appr/admin/restorations`             | 전체 복원 요청 목록 조회                |
| GET    | `/api/appr/admin/restorations/:id`         | 복원 요청 상세 정보 조회                |
| PUT    | `/api/appr/admin/restorations/:id`         | 복원 상태 및 이미지 업데이트 (통합 API) |
| GET    | `/api/appr/admin/payments`                 | 결제 내역 조회                          |
| GET    | `/api/appr/admin/payments/:id`             | 결제 상세 정보 조회                     |

## 2. API별 명세

### 2.1 인증(Auth) API

#### 2.1.1 로그인 - POST `/api/auth/login`

- **요청 본문**:
  ```json
  {
    "id": "string",
    "password": "string"
  }
  ```
- **응답**:
  ```json
  {
    "message": "로그인 성공",
    "user": {
      "id": "string",
      "email": "string"
    }
  }
  ```

#### 2.1.2 로그아웃 - POST `/api/auth/logout`

- **응답**:
  ```json
  {
    "message": "로그아웃 성공"
  }
  ```

#### 2.1.3 사용자 정보 조회 - GET `/api/auth/user`

- **응답**:
  ```json
  {
    "user": {
      "id": "string",
      "email": "string"
    }
  }
  ```

### 2.2 감정(Appraisals) API

#### 2.2.1 감정 신청 - POST `/api/appr/appraisals`

- **요청 본문**:

  ```json
  {
    "appraisal_type": "quicklink" | "offline",

    // 공통 필드
    "brand": "string",
    "model_name": "string",
    "category": "string",
    "remarks": "string",  // 선택사항

    // 퀵링크 감정 전용 필드
    "product_link": "string",  // 퀵링크용
    "platform": "string",      // 선택사항

    // 오프라인 감정 전용 필드
    "purchase_year": "string",  // 선택사항
    "components_included": ["box", "dustbag", "guarantee-card", "receipt", "tag"],  // 선택사항
    "delivery_info": {
      "name": "string",
      "phone": "string",
      "zipcode": "string",
      "address1": "string",
      "address2": "string"
    }
  }
  ```

- **응답**:
  ```json
  {
    "success": true,
    "appraisal": {
      "id": "uuid",
      "appraisal_type": "quicklink" | "offline",
      "status": "pending",
      "created_at": "timestamp"
    }
  }
  ```

#### 2.2.2 감정 목록 조회 - GET `/api/appr/appraisals`

- **쿼리 파라미터**:
  - `page`: 페이지 번호 (기본값: 1)
  - `limit`: 페이지당 항목 수 (기본값: 10)
  - `status`: 상태 필터 (선택사항)
- **응답**:
  ```json
  {
    "success": true,
    "appraisals": [
      {
        "id": "uuid",
        "appraisal_type": "quicklink",
        "brand": "string",
        "model_name": "string",
        "status": "pending",
        "result": "pending",
        "created_at": "timestamp",
        "representative_image": "url"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 5,
      "totalItems": 48,
      "limit": 10
    }
  }
  ```

#### 2.2.3 감정 상세 조회 - GET `/api/appr/appraisals/:id`

- **응답**:
  ```json
  {
    "success": true,
    "appraisal": {
      "id": "uuid",
      "user_id": "string",
      "appraisal_type": "quicklink" | "offline",
      "status": "pending" | "in_review" | "completed" | "cancelled",
      "brand": "string",
      "model_name": "string",
      "category": "string",
      "product_link": "string",
      "platform": "string",
      "purchase_year": "string",
      "components_included": ["string"],
      "delivery_info": {},
      "result": "pending" | "authentic" | "fake" | "uncertain",
      "result_notes": "string",
      "images": ["url"],
      "created_at": "timestamp",
      "appraised_at": "timestamp",
      "certificate_number": "string"
    }
  }
  ```

#### 2.2.4 마이페이지 종합 정보 - GET `/api/appr/appraisals/my`

- **응답**:
  ```json
  {
    "success": true,
    "user_info": {
      "id": "string",
      "name": "string",
      "email": "string",
      "phone": "string",
      "created_at": "timestamp"
    },
    "membership_info": {
      "tier": "까사트레이드 회원" | "제휴사 회원" | "일반회원",
      "quick_link_credits_remaining_this_month": 5,
      "quick_link_monthly_limit": 10,
      "subscription_type": "free" | "paid",
      "subscription_expires_at": "date",
      "offline_appraisal_fee": 38000 | 20000 | 12000
    },
    "recent_appraisals": {
      "appraisals": [
        /* 감정 목록 */
      ],
      "pagination": {
        "currentPage": 1,
        "totalPages": 5,
        "totalItems": 48,
        "limit": 10
      }
    }
  }
  ```

#### 2.2.5 감정서 정보 조회 - GET `/api/appr/appraisals/certificate/:certificateNumber`

- **응답**:
  ```json
  {
    "success": true,
    "certificate": {
      "certificate_number": "string",
      "issued_date": "timestamp",
      "verification_code": "string",
      "appraisal": {
        "id": "uuid",
        "brand": "string",
        "model_name": "string",
        "category": "string",
        "appraisal_type": "quicklink" | "offline",
        "result": "authentic" | "fake" | "uncertain",
        "result_notes": "string",
        "images": ["url"],
        "appraised_at": "timestamp"
      }
    }
  }
  ```

#### 2.2.6 PDF 감정서 다운로드 - GET `/api/appr/appraisals/certificate/:certificateNumber/download`

- **응답**: PDF 파일 스트림 (Content-Type: application/pdf)

#### 2.2.7 감정서 QR코드 이미지 - GET `/api/appr/appraisals/certificate/:certificateNumber/qrcode`

- **응답**: 이미지 파일 스트림 (Content-Type: image/png)

### 2.3 복원(Restorations) API

#### 2.3.1 복원 서비스 목록 조회 - GET `/api/appr/restorations/services`

- **응답**:
  ```json
  {
    "success": true,
    "services": [
      {
        "id": "uuid",
        "name": "string",
        "description": "string",
        "price": 50000,
        "estimated_days": 7,
        "before_image": "url",
        "after_image": "url",
        "is_active": true
      }
    ]
  }
  ```

#### 2.3.2 복원 서비스 신청 - POST `/api/appr/restorations`

- **요청 본문**:
  ```json
  {
    "appraisal_id": "uuid",
    "services": [
      {
        "service_id": "uuid",
        "service_name": "string",
        "price": 50000
      }
    ],
    "delivery_info": {
      "name": "string",
      "phone": "string",
      "zipcode": "string",
      "address1": "string",
      "address2": "string"
    },
    "notes": "string"
  }
  ```
- **응답**:
  ```json
  {
    "success": true,
    "restoration": {
      "id": "uuid",
      "appraisal_id": "uuid",
      "status": "pending",
      "total_price": 150000,
      "estimated_completion_date": "date",
      "created_at": "timestamp"
    }
  }
  ```

#### 2.3.3 복원 요청 목록 조회 - GET `/api/appr/restorations`

- **쿼리 파라미터**:
  - `page`: 페이지 번호 (기본값: 1)
  - `limit`: 페이지당 항목 수 (기본값: 10)
  - `status`: 상태 필터 (선택사항)
- **응답**:
  ```json
  {
    "success": true,
    "restorations": [
      {
        "id": "uuid",
        "appraisal_id": "uuid",
        "brand": "string",
        "model_name": "string",
        "status": "pending" | "in_progress" | "completed" | "cancelled",
        "total_price": 150000,
        "created_at": "timestamp",
        "estimated_completion_date": "date",
        "completed_at": "timestamp"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 2,
      "totalItems": 15,
      "limit": 10
    }
  }
  ```

#### 2.3.4 복원 요청 상세 조회 - GET `/api/appr/restorations/:id`

- **응답**:
  ```json
  {
    "success": true,
    "restoration": {
      "id": "uuid",
      "appraisal_id": "uuid",
      "user_id": "string",
      "status": "pending" | "in_progress" | "completed" | "cancelled",
      "services": [
        {
          "service_id": "uuid",
          "service_name": "string",
          "price": 50000,
          "status": "pending" | "in_progress" | "completed"
        }
      ],
      "total_price": 150000,
      "delivery_info": {
        "name": "string",
        "phone": "string",
        "zipcode": "string",
        "address1": "string",
        "address2": "string"
      },
      "notes": "string",
      "estimated_completion_date": "date",
      "completed_at": "timestamp",
      "created_at": "timestamp",
      "appraisal": {
        "id": "uuid",
        "brand": "string",
        "model_name": "string",
        "category": "string",
        "images": ["url"]
      }
    }
  }
  ```

### 2.4 사용자(Users) API

#### 2.4.1 회원 프로필 및 멤버십 정보 조회 - GET `/api/appr/users/profile`

- **응답**:
  ```json
  {
    "success": true,
    "user_profile": {
      "id": "string",
      "email": "string",
      "name": "string",
      "phone": "string",
      "address": "string",
      "created_at": "timestamp"
    },
    "membership": {
      "tier": "까사트레이드 회원" | "제휴사 회원" | "일반회원",
      "quick_link_credits_remaining": 5,
      "quick_link_monthly_limit": 10,
      "quick_link_subscription_type": "free" | "paid",
      "quick_link_subscription_expires_at": "date",
      "offline_appraisal_fee": 38000 | 20000 | 12000,
      "last_reset_date": "date"
    }
  }
  ```

#### 2.4.2 구독 정보 조회 - GET `/api/appr/users/subscription`

- **응답**:
  ```json
  {
    "success": true,
    "subscription": {
      "is_subscribed": true,
      "type": "free" | "paid",
      "tier": "까사트레이드 회원" | "제휴사 회원" | "일반회원",
      "credits_remaining": 5,
      "monthly_limit": 10,
      "expires_at": "date",
      "auto_renew": true
    }
  }
  ```

#### 2.4.3 구독 신청/갱신 - POST `/api/appr/users/subscription`

- **요청 본문**:
  ```json
  {
    "subscription_type": "monthly"
  }
  ```
- **응답**:
  ```json
  {
    "success": true,
    "payment_required": true,
    "payment_info": {
      "product_type": "quicklink_subscription",
      "product_name": "퀵링크 월간 구독 (10회)",
      "amount": 29000,
      "redirect_url": "/api/appr/payments/prepare"
    }
  }
  ```

### 2.5 결제(Payments) API

#### 2.5.1 결제 준비 - POST `/api/appr/payments/prepare`

- **요청 본문**:
  ```json
  {
    "product_type": "quicklink_subscription" | "certificate_issue" | "restoration_service",
    "product_name": "string",
    "amount": 29000,
    "related_resource_id": "uuid" // 선택사항 (감정서 ID, 복원 요청 ID 등)
  }
  ```
- **응답**:
  ```json
  {
    "success": true,
    "order_id": "string",
    "paramsForNicePaySDK": {
      // 나이스페이 SDK에 필요한 파라미터
    }
  }
  ```

#### 2.5.2 결제 승인 요청 - POST `/api/appr/payments/approve`

- **요청 본문**:
  ```json
  {
    "orderId": "string"
  }
  ```
- **응답**:
  ```json
  {
    "success": true,
    "message": "결제가 성공적으로 처리되었습니다.",
    "payment": {
      "id": "uuid",
      "order_id": "string",
      "status": "completed",
      "amount": 29000,
      "paid_at": "timestamp"
    }
  }
  ```

#### 2.5.3 결제 정보 조회 - GET `/api/appr/payments/:orderId`

- **응답**:
  ```json
  {
    "success": true,
    "payment": {
      "id": "uuid",
      "user_id": "string",
      "order_id": "string",
      "payment_gateway_transaction_id": "string",
      "product_type": "quicklink_subscription",
      "product_name": "퀵링크 월간 구독 (10회)",
      "amount": 29000,
      "status": "pending" | "completed" | "failed" | "cancelled",
      "payment_method": "string",
      "paid_at": "timestamp",
      "created_at": "timestamp"
    }
  }
  ```

#### 2.5.4 결제 웹훅 처리 - POST `/api/appr/payments/webhook`

- **요청 본문**: PG사(나이스페이)에서 전송하는 형식
- **응답**: `OK`

#### 2.5.5 결제 내역 조회 - GET `/api/appr/payments/history`

- **쿼리 파라미터**:
  - `page`: 페이지 번호 (기본값: 1)
  - `limit`: 페이지당 항목 수 (기본값: 10)
  - `type`: 결제 유형 필터 (선택사항)
- **응답**:
  ```json
  {
    "success": true,
    "payments": [
      {
        "id": "uuid",
        "order_id": "string",
        "product_type": "quicklink_subscription",
        "product_name": "퀵링크 월간 구독 (10회)",
        "amount": 29000,
        "status": "completed",
        "payment_method": "card",
        "paid_at": "timestamp"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 2,
      "totalItems": 15,
      "limit": 10
    }
  }
  ```

## 2.6 관리자(Admin) API

#### 2.6.1 회원 관리

- **GET `/api/appr/admin/users`**: 회원 목록 조회 (페이지네이션, 검색, 필터링)
- **PUT `/api/appr/admin/users/:id`**: 회원 정보 수정 (등급, 크레딧 등)

#### 2.6.2 감정 관리

- **GET `/api/appr/admin/appraisals`**: 전체 감정 목록 조회 (페이지네이션, 검색, 필터링)
- **GET `/api/appr/admin/appraisals/:id`**: 감정 상세 정보 조회
- **PUT `/api/appr/admin/appraisals/:id`**: 감정 결과 및 상태 업데이트 (통합 API)

  - 결과 입력 (authentic/fake/uncertain)
  - 결과 노트 작성
  - 감정서 PDF 업로드
  - 감정서 번호 발급
  - 이미지 업로드
  - 필요한 경우 QR 코드 자동 생성
  - 크레딧 자동 차감 (결과에 따라)

  **요청**: `multipart/form-data`

  ```
  result: "authentic" | "fake" | "uncertain"
  result_notes: "string"
  certificate_number: "string" (선택사항)
  status: "in_review" | "completed" | "cancelled" (선택사항)
  images: 파일[] (선택사항)
  pdf: 파일 (선택사항, 감정서 PDF)
  ```

  **응답**:

  ```json
  {
    "success": true,
    "appraisal": {
      "id": "uuid",
      "status": "completed",
      "result": "authentic",
      "result_notes": "string",
      "images": ["url"],
      "certificate_number": "string",
      "certificate_url": "url",
      "qrcode_url": "url",
      "appraised_at": "timestamp"
    },
    "credit_info": {
      "deducted": true,
      "remaining": 5
    }
  }
  ```

#### 2.6.3 복원 서비스 관리

- **GET `/api/appr/admin/restoration-services`**: 복원 서비스 목록 조회
- **POST `/api/appr/admin/restoration-services`**: 복원 서비스 추가
  - `multipart/form-data` 사용하여 이미지와 데이터 한 번에 전송
  ```
  name: "string"
  description: "string"
  price: 50000
  estimated_days: 7
  before_image: 파일 (선택사항)
  after_image: 파일 (선택사항)
  ```
- **PUT `/api/appr/admin/restoration-services/:id`**: 복원 서비스 수정
  - `multipart/form-data` 사용하여 이미지와 데이터 한 번에 전송
- **DELETE `/api/appr/admin/restoration-services/:id`**: 복원 서비스 비활성화

#### 2.6.4 복원 요청 관리

- **GET `/api/appr/admin/restorations`**: 전체 복원 요청 목록 조회 (페이지네이션, 검색, 필터링)
- **GET `/api/appr/admin/restorations/:id`**: 복원 요청 상세 정보 조회
- **PUT `/api/appr/admin/restorations/:id`**: 복원 상태 및 이미지 업데이트 (통합 API)

  - 상태 업데이트
  - 서비스별 상태 업데이트
  - 작업 이미지 업로드

  **요청**: `multipart/form-data`

  ```
  status: "in_progress" | "completed" | "cancelled"
  estimated_completion_date: "date" (선택사항)
  completed_at: "timestamp" (선택사항)
  services: JSON 문자열 (선택사항) - 서비스별 상태 업데이트
  before_images: 파일[] (선택사항)
  after_images: 파일[] (선택사항)
  progress_images: 파일[] (선택사항)
  ```

  **응답**:

  ```json
  {
    "success": true,
    "restoration": {
      "id": "uuid",
      "status": "in_progress",
      "estimated_completion_date": "date",
      "services": [
        /* 서비스 상태 정보 */
      ],
      "images": {
        "before": ["url"],
        "after": ["url"],
        "progress": ["url"]
      }
    }
  }
  ```

#### 2.6.5 결제 관리

- **GET `/api/appr/admin/payments`**: 결제 내역 조회 (페이지네이션, 검색, 필터링)
- **GET `/api/appr/admin/payments/:id`**: 결제 상세 정보 조회

## 3. 데이터베이스 구조

### 3.1 users 테이블 (기존 테이블 활용)

```sql
CREATE TABLE users (
  id VARCHAR(50) PRIMARY KEY,
  password VARCHAR(64),
  email VARCHAR(100),
  business_number VARCHAR(20),
  company_name VARCHAR(100),
  phone VARCHAR(20),
  address TEXT,
  is_active TINYINT(1),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  commission_rate DECIMAL(5,2),
  registration_date DATE
)
```

### 3.2 appr_users 테이블 (감정원 사용자 데이터)

```sql
CREATE TABLE appr_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL UNIQUE,         -- users 테이블의 id 참조
  tier ENUM('까사트레이드 회원', '제휴사 회원', '일반회원') NOT NULL DEFAULT '일반회원',

  -- 퀵링크 크레딧 관련
  quick_link_credits_remaining INT DEFAULT 0,  -- 현재 남은 크레딧
  quick_link_monthly_limit INT NOT NULL DEFAULT 0, -- 월 이용 제한량
  quick_link_subscription_type ENUM('free', 'paid') DEFAULT 'free',
  quick_link_subscription_expires_at DATE NULL, -- 구독 만료일(일반회원용)

  -- 오프라인 감정 할인
  offline_appraisal_fee INT NOT NULL DEFAULT 38000, -- 사용자 등급별 할인된 가격

  -- 주소 정보 (배송용)
  zipcode VARCHAR(10) NULL,
  address1 VARCHAR(255) NULL,
  address2 VARCHAR(255) NULL,

  -- 갱신 정보
  last_reset_date DATE NULL,                   -- 마지막 크레딧 리셋 날짜
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
```

### 3.3 appraisals 테이블 (감정 신청 및 결과)

```sql
CREATE TABLE appraisals (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL,                -- users 테이블의 id 참조
  appraisal_type ENUM('quicklink', 'offline') NOT NULL,
  status ENUM('pending', 'in_review', 'completed', 'cancelled') DEFAULT 'pending',

  -- 신청자 정보
  applicant_name VARCHAR(50),
  applicant_phone VARCHAR(20),
  applicant_email VARCHAR(100),

  -- 상품 정보 (공통)
  brand VARCHAR(100) NOT NULL,
  model_name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  remarks TEXT NULL,

  -- 퀵링크 감정 정보
  product_link TEXT NULL,                      -- 퀵링크용 상품 URL
  platform VARCHAR(50) NULL,                   -- 퀵링크용 거래 플랫폼

  -- 오프라인 감정 정보
  purchase_year VARCHAR(10) NULL,
  components_included JSON NULL,               -- ["box", "dustbag", "guarantee-card", "receipt", "tag"]

  -- 오프라인 배송 정보
  delivery_info JSON NULL,                     -- { name, phone, zipcode, address1, address2 }

  -- 감정 결과
  result ENUM('authentic', 'fake', 'uncertain', 'pending') DEFAULT 'pending',
  result_notes TEXT NULL,                      -- 감정 결과 내용 (결과에 대한 텍스트)
  images JSON NULL,                            -- 이미지 URL 배열

  -- 감정서 관련
  certificate_number VARCHAR(50) NULL,         -- 감정서 번호
  certificate_url VARCHAR(255) NULL,           -- 감정서 PDF URL
  qrcode_url VARCHAR(255) NULL,                -- QR코드 이미지 URL

  -- 크레딧 관련
  credit_deducted BOOLEAN DEFAULT FALSE,       -- 크레딧 차감 여부

  -- 시간 정보
  appraised_at DATETIME NULL,                  -- 감정 완료 시간
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
```

### 3.4 restoration_services 테이블 (복원 서비스 종류)

```sql
CREATE TABLE restoration_services (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,                  -- 서비스명 (예: '가방 내부 안감 교체')
  description TEXT NOT NULL,                   -- 서비스 설명
  price DECIMAL(10, 2) NOT NULL,               -- 서비스 가격
  estimated_days INT NOT NULL,                 -- 예상 소요일
  before_image VARCHAR(255) NULL,              -- 복원 전 이미지 URL
  after_image VARCHAR(255) NULL,               -- 복원 후 이미지 URL
  is_active BOOLEAN DEFAULT TRUE,              -- 서비스 활성화 여부
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
```

### 3.5 restoration_requests 테이블 (복원 신청)

```sql
CREATE TABLE restoration_requests (
  id VARCHAR(36) PRIMARY KEY,
  appraisal_id VARCHAR(36) NOT NULL,           -- appraisals.id 참조
  user_id VARCHAR(50) NOT NULL,                -- users 테이블의 id 참조

  -- 복원 서비스 정보
  services JSON NOT NULL,                      -- [{ service_id, service_name, price, status }]
  status ENUM('pending', 'in_progress', 'completed', 'cancelled') DEFAULT 'pending',
  total_price DECIMAL(10, 2) NOT NULL,

  -- 배송 정보 (복원 완료 후 배송용)
  delivery_info JSON NOT NULL,                 -- { name, phone, zipcode, address1, address2 }

  -- 복원 상태 정보
  notes TEXT NULL,                             -- 복원 관련 특이사항/요청사항
  images JSON NULL,                            -- { before: [], after: [], progress: [] }
  estimated_completion_date DATE NULL,
  completed_at DATETIME NULL,                  -- 복원 완료 시간
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
```

### 3.6 payments 테이블 (결제 내역)

```sql
CREATE TABLE payments (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL,                -- users 테이블의 id 참조
  order_id VARCHAR(100) NOT NULL UNIQUE,       -- PG사 주문번호 (`Moid`)
  payment_gateway_transaction_id VARCHAR(100) NULL, -- PG사 거래번호 (`TID`)
  product_type ENUM('quicklink_subscription', 'certificate_issue', 'restoration_service') NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status ENUM('pending', 'completed', 'failed', 'cancelled', 'auth_failed', 'auth_signature_mismatch', 'approval_signature_mismatch', 'server_error', 'approval_api_failed') DEFAULT 'pending',
  payment_method VARCHAR(50) NULL,
  raw_response_data JSON NULL,                 -- PG사 응답 원본 데이터
  related_resource_id VARCHAR(36) NULL,        -- 연관 리소스 ID (appraisal_id, restoration_request_id)
  related_resource_type VARCHAR(50) NULL,      -- 연관 리소스 타입 (appraisal, restoration)
  paid_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
```

1. **기존 users 테이블 활용**: 기존 인증 시스템의 users 테이블을 그대로 유지하고, 감정원 시스템을 위한 추가 정보는 appr_users 테이블에 저장합니다.

2. **JSON 활용**: 여러 구성 항목이나 복잡한 정보는 JSON 형태로 저장하여 스키마 유연성을 확보합니다.

   - `appraisals.components_included`: 보유 구성품 목록
   - `appraisals.delivery_info`, `restoration_requests.delivery_info`: 배송 정보
   - `appraisals.images`, `restoration_requests.images`: 이미지 URL 배열
   - `restoration_requests.services`: 선택한 복원 서비스 정보
   - `payments.raw_response_data`: PG사 응답 데이터

3. **통합 테이블 구조**:

   - `appraisals` 테이블은 감정 신청과 결과를 통합하여 관리합니다.
   - `restoration_requests` 테이블은 복원 신청과 작업 상태를 통합하여 관리합니다.

4. **명확한 참조 관계**:
   - `appr_users.user_id` → `users.id`
   - `appraisals.user_id` → `users.id`
   - `restoration_requests.appraisal_id` → `appraisals.id`
   - `restoration_requests.user_id` → `users.id`
   - `payments.user_id` → `users.id`
   - `payments.related_resource_id` → `appraisals.id` 또는 `restoration_requests.id`
