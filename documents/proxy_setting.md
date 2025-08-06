# ✅ EC2 프라이빗 Squid 프록시 세팅 가이드 (인증 제거 버전)

## 1️⃣ EC2 생성

- 인스턴스: `t4g.small` (ARM)
- AMI: Ubuntu 22.04 LTS
- 보안 그룹:

  - **인바운드**: `TCP 3128` → 본인 IP만 허용
  - **아웃바운드**: 전체 허용

---

## 2️⃣ Squid 설치

```bash
sudo apt update
sudo apt install squid -y
```

---

## 3️⃣ 파일 디스크립터 제한

시스템 전체 제한 변경:

```bash
sudo nano /etc/security/limits.conf
```

다음 추가:

```
* soft nofile 65535
* hard nofile 65535
```

Squid 서비스 제한 변경:

```bash
sudo mkdir -p /etc/systemd/system/squid.service.d
sudo nano /etc/systemd/system/squid.service.d/override.conf
```

```ini
[Service]
LimitNOFILE=65535
```

적용:

```bash
sudo systemctl daemon-reexec

ulimit -n
```

---

## 4️⃣ Squid 보안 설정

```bash
sudo rm /etc/squid/squid.conf
sudo nano /etc/squid/squid.conf
```

### 설정 예시:

```conf
http_port 3128
acl localnet src <내_공인_IP>
http_access allow localnet
http_access deny all

# 파일 디스크립터 충분히 사용
max_filedescriptors 65535

# 불필요한 연결 제한 (CPU 부담 줄이기)
client_idle_pconn_timeout 30 seconds
pipeline_prefetch off
```

> `<내_공인_IP>` 자리에 본인 PC의 공인 IP를 입력

---

## 5️⃣ Squid 재시작

```bash
sudo systemctl daemon-reload
sudo systemctl restart squid
sudo systemctl enable squid
```

상태 확인:

```bash
sudo systemctl status squid
```

---

## 6️⃣ 테스트

외부 IP (차단 확인):

```bash
curl -x http://<EC2_IP>:3128 http://example.com
# ERR_ACCESS_DENIED 나오면 정상
```

본인 IP (허용 확인):

```bash
curl -x http://<EC2_IP>:3128 http://example.com
# 정상 응답 시 성공
```

---

## 7️⃣ 모니터링

파일 디스크립터 확인:

```bash
sudo lsof -p $(pidof squid) | wc -l
```

로그 확인:

```bash
sudo tail -f /var/log/squid/access.log
```
