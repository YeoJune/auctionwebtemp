# 경매 시스템 업그레이드 요청사항 문서

## 목차

1. [프로젝트 개요](#프로젝트-개요)
2. [관리자 페이지 개선사항](#관리자-페이지-개선사항)
3. [경매 기능 개선사항](#경매-기능-개선사항)
4. [페이지 디자인 및 새 페이지](#페이지-디자인-및-새-페이지)
5. [알림톡 기능 추가](#알림톡-기능-추가)
6. [사이트 개선사항](#사이트-개선사항)
7. [개발 우선순위 및 일정](#개발-우선순위-및-일정)

## 프로젝트 개요

본 프로젝트는 기존의 경매 시스템을 업그레이드하여 관리자 기능 강화, 경매 프로세스 개선, 사용자 경험 향상을 목표로 합니다. 주요 변경사항은 관리자 인보이스 시스템 구축, 고객 관리 기능 개선, 수수료 관리 인터페이스 개발, 마감 경매 기능 추가, 알림톡 연동 등입니다.

## 관리자 페이지 개선사항

### 1. 관리자 인보이스 시스템 개발

#### 1.1 인보이스 프론트엔드 제작

- **현재 상태**: 시트 기반의 기본적인 관리 기능만 있음
- **요구사항**: 별도의 인보이스 프론트엔드를 통한 고객 요청 관리
- **구현 방안**:
  - 새로운 인보이스 UI 개발
  - 인보이스 데이터 관리 백엔드 구현
- **필요한 변경 파일**:
  - 신규 `pages/admin-invoice.html` 생성
  - `public/js/admin-invoice.js` 신규 개발
  - `routes/admin.js`에 인보이스 관련 API 추가
  - 인보이스 데이터 저장용 DB 테이블 생성

#### 1.2 견적서 시트 저장 기능

- **현재 상태**: 입찰 정보만 저장되고 견적서가 생성되지 않음
- **요구사항**: 최종 견적서만 시트에 저장
- **구현 방안**:
  - 견적서 템플릿 설계
  - 최종 데이터만 시트에 저장하는 기능 구현
- **필요한 변경 파일**:
  - `utils/googleSheets.js`: 견적서 저장 메소드 추가
  - `routes/admin.js`: 견적서 생성 API 추가
  - `public/js/admin-invoice.js`: 견적서 생성 기능 구현

### 2. 고객 관리 시스템 개발

#### 2.1 독립적인 고객 관리 페이지

- **현재 상태**: 기본적인 사용자 관리 기능만 있음
- **요구사항**: 시트 연동 없이 별도 페이지에서 고객 정보 관리
- **구현 방안**:
  - 고객 관리 페이지 디자인 및 개발
  - 고객 CRUD 기능 구현
- **필요한 변경 파일**:
  - 신규 `pages/customer-management.html` 생성
  - `public/js/customer-management.js` 개발
  - `routes/admin.js`: 고객 관리 API 추가
  - 고객 정보 저장용 DB 테이블 확장

### 3. 수수료 관리 인터페이스 개발

- **현재 상태**: 하드코딩된 수수료 로직
- **요구사항**: 엑셀 수식처럼 관리자가 수수료 계산 방식을 변경 가능하도록 함
- **구현 방안**:
  - 수수료 설정 인터페이스 개발
  - 동적 수수료 계산 로직 구현
- **필요한 변경 파일**:
  - `routes/admin.js`: 수수료 설정 API 추가
  - `pages/admin.html` 또는 별도 페이지에 수수료 설정 UI 추가
  - `public/js/admin.js`: 수수료 설정 기능 구현
  - DB에 수수료 설정 테이블 추가

### 4. 입찰 상태 관리 기능

- **현재 상태**: 입찰 상태 변경 불가
- **요구사항**: 관리자 인보이스 시스템에서 입찰 상태 관리 (경매중, 협상중 등)
- **구현 방안**:
  - 인보이스 시스템에 입찰 상태 관리 UI 통합
  - 상태 변경 API 개발
- **필요한 변경 파일**:
  - `routes/admin.js`: 입찰 상태 변경 API 추가
  - `pages/admin-invoice.html`: 입찰 상태 관리 UI 추가
  - `public/js/admin-invoice.js`: 입찰 상태 관리 기능 구현
  - DB의 bids 테이블에 status 필드 추가

## 경매 기능 개선사항

### 1. 실시간 경매 (협상 경매)

- **현재 상태**: 기본적인 입찰 기능 존재
- **요구사항**: 기존 경매 시스템 유지 (1차, 2차, 최종 입찰 프로세스)
- **구현 방안**:
  - 기존 시스템 유지 및 안정화
- **필요한 변경 파일**:
  - 기존 `routes/bid.js` 최적화

### 2. 마감 경매 (직접 경매) 신규 개발

#### 2.1 실시간 금액/시간 업데이트 시스템

- **현재 상태**: 실시간 업데이트 기능 없음
- **요구사항**: 실시간으로 금액/시간 업데이트되는 경매 시스템, 고객이 여러 번 입찰 가능
- **구현 방안**:
  - 실시간 업데이트 위한 웹소켓 구현
  - 반복 입찰 기능 개발
  - 백엔드 크롤링 로직 개발
- **필요한 변경 파일**:
  - 신규 `routes/auction.js` 개발
  - 실시간 업데이트 위한 웹소켓 서버 구현
  - `public/js/auction.js` 개발
  - 크롤링 모듈 확장

#### 2.2 입찰 단위 설정

- **현재 상태**: 자유롭게 입력 가능
- **요구사항**: 실제 경매처럼 입력 단위 미리 세팅하여 반영
- **구현 방안**:
  - 입찰 단위 설정 UI 개발
  - 입찰 시 단위 적용 로직 구현
- **필요한 변경 파일**:
  - `routes/admin.js`: 입찰 단위 설정 API 추가
  - `pages/admin.html`: 입찰 단위 설정 UI 추가
  - `public/js/auction.js`: 입찰 시 단위 적용 기능

#### 2.3 자동 입찰 기능 (향후 개발)

- **현재 상태**: 수동 입찰만 가능
- **요구사항**: Puppeteer 기반 자동 입찰 크롤링 (우선순위 낮음)
- **구현 방안**:
  - 향후 Puppeteer 기반 크롤러 개발
- **필요한 변경 파일**:
  - 신규 자동 입찰 크롤링 모듈 (추후 개발)

## 페이지 디자인 및 새 페이지

### 1. 페이지 디자인 변경

- **현재 상태**: 기존 디자인
- **요구사항**: 제공된 시안 기반으로 디자인 변경
- **구현 방안**:
  - 시안 기반 CSS 변경
  - 반응형 디자인 적용
- **필요한 변경 파일**:
  - `public/styles/common.css`
  - `public/styles/main.css`
  - `public/styles/admin.css`

### 2. 고객 정보 페이지 제작

- **현재 상태**: 고객 정보 페이지 없음
- **요구사항**: 고객이 입찰 내역과 계정 정보 확인 가능한 페이지
- **구현 방안**:
  - 고객 정보 페이지 디자인 및 개발
  - 입찰 내역, 계정 상태 표시 기능 구현
- **필요한 변경 파일**:
  - 신규 `pages/user-dashboard.html` 생성
  - `public/js/user-dashboard.js` 개발
  - `routes/user.js`: 고객 정보 API 개발

## 알림톡 기능 추가

### 1. 알리고 연동

- **현재 상태**: 알림 기능 없음
- **요구사항**: 알리고 서비스 연동 (알림톡 당 8원, 사전 세팅 필요)
- **구현 방안**:
  - 알리고 API 연동
  - 알림톡 발송 모듈 개발
- **필요한 변경 파일**:
  - 신규 `utils/alimtalk.js` 모듈 개발
  - 환경 설정에 알리고 API 키 추가

### 2. 알림톡 발송 시나리오

- **현재 상태**: 알림 기능 없음
- **요구사항**:
  - 실시간경매 2차 제안 완료 시 알림톡 발송
  - 마감 경매 10분전 알림톡 발송
  - 입찰 상태 실시간 전달 (협상 중, 낙찰 등)
- **구현 방안**:
  - 각 시나리오별 알림톡 템플릿 설계
  - 알림톡 발송 트리거 구현
- **필요한 변경 파일**:
  - `routes/bid.js`: 알림톡 발송 트리거 추가
  - `routes/auction.js`: 알림톡 발송 트리거 추가
  - `utils/alimtalk.js`: 템플릿별 발송 함수 구현

## 사이트 개선사항

### 1. 기존 개선사항 (완료된 작업)

- ~~URL에서 불필요한 숫자 제거~~ (이미 완료됨)
- ~~사이트 속도 개선 (크롤링 속도)~~ (이미 완료됨)
- ~~3번 사이트에 시세표 추가~~ (이미 완료됨)
- ~~시세표 데이터 업데이트 (24년 1월부터)~~ (이미 완료됨)

### 2. 4번 사이트 추가 (추후 진행)

- **현재 상태**: 3개 사이트 운영 중
- **요구사항**: 4번 사이트 추가 예정 (우선순위 낮음)
- **구현 방안**:
  - 추후 논의 후 결정

## 개발 우선순위 및 일정

1. **1단계 (즉시 적용)**

   - 관리자 인보이스 시스템 개발
   - 수수료 관리 인터페이스 개발
   - 알림톡 기본 연동

2. **2단계 (중기)**

   - 마감 경매 (직접 경매) 기능 개발
   - 고객 정보 페이지 제작
   - 고객 관리 시스템 개발

3. **3단계 (장기)**
   - 페이지 디자인 변경 (시안 기반)
   - 자동 입찰 기능 구현 (Puppeteer 기반)
   - 4번 사이트 추가 (추후 결정)
