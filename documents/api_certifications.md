# 감정서 관련 기능 백엔드 문서

## 1. API 엔드포인트 개요

### 인증(Auth) API

| 메서드 | 엔드포인트         | 설명                      | 인증 필요 |
| ------ | ------------------ | ------------------------- | --------- |
| POST   | `/api/auth/login`  | 로그인                    | 아니오    |
| POST   | `/api/auth/logout` | 로그아웃                  | 예        |
| GET    | `/api/auth/user`   | 현재 로그인한 사용자 정보 | 예        |

### 감정서(Certificate) API

| 메서드 | 엔드포인트                                     | 설명                      | 인증 필요 |
| ------ | ---------------------------------------------- | ------------------------- | --------- |
| GET    | `/api/certificate/:certificateNumber`          | 감정서 정보 조회          | 아니오    |
| POST   | `/api/certificate/issue`                       | 감정서 발급 신청          | 예        |
| GET    | `/api/certificate/user`                        | 사용자의 감정서 목록 조회 | 예        |
| GET    | `/api/certificate/:certificateNumber/download` | PDF 감정서 다운로드       | 예        |
| GET    | `/api/certificate/:certificateNumber/qrcode`   | 감정서 QR코드 이미지 제공 | 아니오    |

### 복원(Restoration) API

| 메서드 | 엔드포인트                    | 설명                         | 인증 필요 |
| ------ | ----------------------------- | ---------------------------- | --------- |
| GET    | `/api/restoration/services`   | 복원 서비스 목록 조회        | 아니오    |
| POST   | `/api/restoration/request`    | 복원 서비스 신청             | 예        |
| GET    | `/api/restoration/user`       | 사용자의 복원 요청 목록 조회 | 예        |
| GET    | `/api/restoration/:requestId` | 복원 요청 상세 정보 조회     | 예        |

## 2. API 상세 명세

### 2.0 인증 API

#### 2.0.1 로그인

```
POST /api/auth/login
```

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
    "email": "user@example.com"
  }
}
```

**응답 예시 (실패):**

```json
{
  "message": "접근 권한이 없습니다. 010-2894-8502를 통해 문의주세요."
}
```

또는

```json
{
  "message": "비밀번호가 다릅니다."
}
```

#### 2.0.2 로그아웃

```
POST /api/auth/logout
```

**응답 예시:**

```json
{
  "message": "로그아웃 성공"
}
```

#### 2.0.3 사용자 정보 조회

```
GET /api/auth/user
```

**응답 예시 (성공):**

```json
{
  "user": {
    "id": "사용자ID",
    "email": "user@example.com"
  }
}
```

**응답 예시 (실패):**

```json
{
  "message": "인증되지 않은 사용자입니다."
}
```

### 2.1 감정서 API

#### 2.1.1 감정서 정보 조회

```
GET /api/certificate/:certificateNumber
```

**응답 예시:**

```json
{
  "success": true,
  "certificate": {
    "certificate_number": "CAS-LV24-0001",
    "appraisal_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "type": "pdf",
    "status": "issued",
    "issued_date": "2025-05-01T09:00:00Z",
    "appraisal": {
      "brand": "루이비통",
      "model": "네버풀 MM",
      "category": "가방",
      "result": "정품",
      "photos": [
        "/images/appraisals/photo1.jpg",
        "/images/appraisals/photo2.jpg"
      ]
    }
  }
}
```

#### 2.1.2 감정서 발급 신청

```
POST /api/certificate/issue
```

**요청 본문:**

```json
{
  "appraisal_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "type": "physical",
  "delivery_info": {
    "name": "홍길동",
    "phone": "010-1234-5678",
    "zipcode": "12345",
    "address1": "서울시 강남구",
    "address2": "역삼동 123-45"
  },
  "payment_info": {
    "method": "card",
    "amount": 10000
  }
}
```

**응답 예시:**

```json
{
  "success": true,
  "message": "감정서 발급 신청이 완료되었습니다.",
  "certificate": {
    "id": "f1e2d3c4-b5a6-7890-abcd-ef1234567890",
    "certificate_number": "CAS-LV24-0002",
    "status": "pending",
    "type": "physical"
  }
}
```

#### 2.1.3 사용자의 감정서 목록 조회

```
GET /api/certificate/user
```

**응답 예시:**

```json
{
  "success": true,
  "certificates": [
    {
      "id": "f1e2d3c4-b5a6-7890-abcd-ef1234567890",
      "certificate_number": "CAS-LV24-0002",
      "type": "physical",
      "status": "pending",
      "appraisal": {
        "brand": "루이비통",
        "model": "네버풀 MM",
        "category": "가방",
        "result": "정품"
      },
      "created_at": "2025-05-01T09:00:00Z"
    }
  ]
}
```

#### 2.1.4 PDF 감정서 다운로드

```
GET /api/certificate/:certificateNumber/download
```

**응답:**
PDF 파일 스트림 (application/pdf)

#### 2.1.5 감정서 QR코드 이미지 제공

```
GET /api/certificate/:certificateNumber/qrcode
```

**응답:**
PNG 이미지 스트림 (image/png)

### 2.2 복원 API

#### 2.2.1 복원 서비스 목록 조회

```
GET /api/restoration/services
```

**응답 예시:**

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
      "before_image": "/images/restoration/corner_before.jpg",
      "after_image": "/images/restoration/corner_after.jpg"
    },
    {
      "id": "m1e2t3a4-l5g6o7l8-9012-abcd-ef1234567890",
      "name": "금속 도금 벗겨짐",
      "description": "하드웨어의 도금이 벗겨진 부분을 원래 상태로 복원하여 광택을 되살립니다.",
      "price": 30000,
      "estimated_days": 5,
      "before_image": "/images/restoration/metal_before.jpg",
      "after_image": "/images/restoration/metal_after.jpg"
    }
  ]
}
```

#### 2.2.2 복원 서비스 신청

```
POST /api/restoration/request
```

**요청 본문:**

```json
{
  "appraisal_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "items": [
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
    "name": "홍길동",
    "phone": "010-1234-5678",
    "zipcode": "12345",
    "address1": "서울시 강남구",
    "address2": "역삼동 123-45"
  },
  "payment_info": {
    "method": "card",
    "amount": 50000
  }
}
```

**응답 예시:**

```json
{
  "success": true,
  "message": "복원 서비스 신청이 완료되었습니다.",
  "request": {
    "id": "r1e2q3u4-e5s6t7-8901-abcd-ef1234567890",
    "status": "pending",
    "total_price": 50000,
    "estimated_completion_date": "2025-05-06T09:00:00Z"
  }
}
```

#### 2.2.3 사용자의 복원 요청 목록 조회

```
GET /api/restoration/user
```

**응답 예시:**

```json
{
  "success": true,
  "requests": [
    {
      "id": "r1e2q3u4-e5s6t7-8901-abcd-ef1234567890",
      "status": "pending",
      "total_price": 50000,
      "appraisal": {
        "brand": "루이비통",
        "model": "네버풀 MM",
        "category": "가방"
      },
      "items": [
        {
          "service_name": "모서리 까짐",
          "price": 20000
        },
        {
          "service_name": "금속 도금 벗겨짐",
          "price": 30000
        }
      ],
      "created_at": "2025-05-01T09:00:00Z"
    }
  ]
}
```

#### 2.2.4 복원 요청 상세 정보 조회

```
GET /api/restoration/:requestId
```

**응답 예시:**

```json
{
  "success": true,
  "request": {
    "id": "r1e2q3u4-e5s6t7-8901-abcd-ef1234567890",
    "status": "in_progress",
    "total_price": 50000,
    "appraisal": {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "brand": "루이비통",
      "model": "네버풀 MM",
      "category": "가방",
      "photos": [
        "/images/appraisals/photo1.jpg",
        "/images/appraisals/photo2.jpg"
      ]
    },
    "items": [
      {
        "service_id": "s1e2r3v4-i5c6e7-8901-abcd-ef1234567890",
        "service_name": "모서리 까짐",
        "price": 20000,
        "status": "completed"
      },
      {
        "service_id": "m1e2t3a4-l5g6o7l8-9012-abcd-ef1234567890",
        "service_name": "금속 도금 벗겨짐",
        "price": 30000,
        "status": "in_progress"
      }
    ],
    "delivery_info": {
      "name": "홍길동",
      "phone": "010-1234-5678",
      "zipcode": "12345",
      "address1": "서울시 강남구",
      "address2": "역삼동 123-45"
    },
    "created_at": "2025-05-01T09:00:00Z",
    "estimated_completion_date": "2025-05-06T09:00:00Z"
  }
}
```

## 3. 데이터베이스 스키마

### 3.1 certificates 테이블

```sql
CREATE TABLE certificates (
    id VARCHAR(36) PRIMARY KEY,
    certificate_number VARCHAR(50) NOT NULL UNIQUE,
    appraisal_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    type ENUM('pdf', 'physical') NOT NULL,
    status ENUM('pending', 'issued', 'shipped', 'delivered') NOT NULL,
    verification_code VARCHAR(50) NOT NULL UNIQUE,
    issued_date DATETIME,
    delivery_info JSON NULL,
    payment_info JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 3.2 restoration_requests 테이블

```sql
CREATE TABLE restoration_requests (
    id VARCHAR(36) PRIMARY KEY,
    appraisal_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    items JSON NOT NULL,
    status ENUM('pending', 'in_progress', 'completed', 'shipped', 'delivered') NOT NULL,
    total_price DECIMAL(10, 2) NOT NULL,
    delivery_info JSON NULL,
    payment_info JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 3.3 restoration_services 테이블

```sql
CREATE TABLE restoration_services (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    estimated_days INT NOT NULL,
    before_image VARCHAR(255),
    after_image VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## 4. 오류 코드 및 응답

| 상태 코드 | 메시지       | 설명                                        |
| --------- | ------------ | ------------------------------------------- |
| 200       | 성공         | 요청이 성공적으로 처리됨                    |
| 400       | 잘못된 요청  | 요청 형식이 잘못되었거나 필수 필드가 누락됨 |
| 401       | 인증 실패    | 인증이 필요하거나 인증 정보가 유효하지 않음 |
| 403       | 접근 거부    | 요청한 리소스에 대한 접근 권한이 없음       |
| 404       | 찾을 수 없음 | 요청한 리소스를 찾을 수 없음                |
| 500       | 서버 오류    | 서버 내부 오류 발생                         |

모든 오류 응답은 다음 형식을 따릅니다:

```json
{
  "success": false,
  "message": "오류 메시지",
  "code": "오류 코드(선택)"
}
```
