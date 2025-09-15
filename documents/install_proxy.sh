#!/bin/bash

# Squid 프록시 자동 설치 스크립트
# Usage: ./install_proxy.sh <허용할_IP주소>

set -e  # 에러 발생 시 스크립트 종료

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 로그 함수
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
}

# 파라미터 확인
if [ $# -eq 0 ]; then
    error "사용법: $0 <허용할_IP주소>"
    echo "예시: $0 123.456.789.012"
    exit 1
fi

ALLOWED_IP=$1

# IP 주소 형식 검증 (간단한 체크)
if [[ ! $ALLOWED_IP =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
    error "올바른 IP 주소 형식이 아닙니다: $ALLOWED_IP"
    exit 1
fi

log "Squid 프록시 설치를 시작합니다..."
log "허용할 IP 주소: $ALLOWED_IP"

# 1. 시스템 업데이트 및 Squid 설치
log "시스템 패키지 업데이트 중..."
sudo apt update -y

log "Squid 설치 중..."
sudo apt install squid -y

# 2. 파일 디스크립터 제한 설정
log "파일 디스크립터 제한 설정 중..."

# 시스템 전체 제한 변경
sudo bash -c 'cat >> /etc/security/limits.conf << EOF

# Squid 프록시를 위한 파일 디스크립터 제한 증가
* soft nofile 65535
* hard nofile 65535
EOF'

# Squid 서비스 제한 변경
sudo mkdir -p /etc/systemd/system/squid.service.d
sudo bash -c 'cat > /etc/systemd/system/squid.service.d/override.conf << EOF
[Service]
LimitNOFILE=65535
EOF'

# 3. Squid 설정 파일 생성
log "Squid 설정 파일 생성 중..."
sudo bash -c "cat > /etc/squid/squid.conf << EOF
# Squid 프록시 설정 (보안 강화 버전)
http_port 3128

# 허용할 IP 주소 설정
acl localnet src $ALLOWED_IP

# 접근 제어
http_access allow localnet
http_access deny all

# 성능 최적화 설정
max_filedescriptors 65535
client_idle_pconn_timeout 30 seconds
pipeline_prefetch off

# 로그 설정
access_log /var/log/squid/access.log squid

# 캐시 비활성화 (프록시로만 사용)
cache deny all

# DNS 설정
dns_nameservers 8.8.8.8 1.1.1.1

# 기본 포트 설정
http_port 3128
EOF"

# 4. 시스템 서비스 재시작
log "시스템 서비스 재구성 중..."
sudo systemctl daemon-reexec
sudo systemctl daemon-reload

log "Squid 서비스 재시작 중..."
sudo systemctl restart squid
sudo systemctl enable squid

# 5. 설치 확인
log "설치 상태 확인 중..."
sleep 3

if sudo systemctl is-active --quiet squid; then
    log "✅ Squid 서비스가 정상적으로 실행 중입니다!"
else
    error "❌ Squid 서비스 실행에 실패했습니다."
    sudo systemctl status squid
    exit 1
fi

# 6. 현재 설정 정보 출력
EC2_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "EC2_IP를 확인하세요")

echo
echo "========================================="
log "🎉 Squid 프록시 설치 완료!"
echo "========================================="
echo
echo "📋 설정 정보:"
echo "  • 프록시 서버: $EC2_IP:3128"
echo "  • 허용 IP: $ALLOWED_IP"
echo "  • 설정 파일: /etc/squid/squid.conf"
echo "  • 로그 파일: /var/log/squid/access.log"
echo
echo "🧪 테스트 방법:"
echo "  허용된 IP에서 테스트:"
echo "    curl -x http://$EC2_IP:3128 http://example.com"
echo
echo "📊 모니터링 명령어:"
echo "  서비스 상태: sudo systemctl status squid"
echo "  로그 확인: sudo tail -f /var/log/squid/access.log"
echo "  연결 수 확인: sudo lsof -p \$(pidof squid) | wc -l"
echo
echo "🔄 서비스 재시작: sudo systemctl restart squid"
echo "========================================="