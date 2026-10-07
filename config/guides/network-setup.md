# 외부 접속 설정 가이드

사용자가 "외부에서 접속하고 싶어", "도메인 연결해줘" 등을 요청하면 이 가이드를 따라 설정합니다.

---

## 방식 선택

| 방식 | 장점 | 단점 | 비용 | 추천 |
|------|------|------|------|------|
| **ngrok** | 설치 간편, 5분 완료 | 무료 플랜 요청 제한 | 무료 | **초보자 추천** |
| **SSH 터널 (EC2)** | 안정적, 요청 제한 없음, 자체 도메인 | EC2 운영 필요 | EC2 과금 | 고급 사용자 |

사용자가 EC2/서버를 이미 보유하고 있다면 A(SSH 터널), 그 외에는 B(ngrok)를 추천하세요.
사용자가 "잘 모르겠어", "쉬운 거" 등으로 답하면 ngrok(B)으로 진행하세요.

---

## A. SSH 터널 (EC2 + 도메인)

### 사전 준비 (사용자가 직접)

1. AWS EC2 인스턴스 (Ubuntu, t2.micro 무료 티어 가능)
2. 도메인 (서브도메인 OK, 예: genie.example.com)
3. 도메인 DNS A 레코드 → EC2 공인 IP
4. EC2 SSH 키 파일 (.pem)을 Mac에 저장

### 설정 절차 (마이크루가 수행)

#### 1단계: EC2 기본 설정

```bash
# EC2 접속
ssh -i {KEY_PATH} ubuntu@{EC2_IP}

# nginx 설치
sudo apt update && sudo apt install -y nginx

# Let's Encrypt SSL 설치
sudo apt install -y certbot python3-certbot-nginx
```

#### 2단계: nginx 설정

```bash
sudo tee /etc/nginx/sites-enabled/{DOMAIN} << 'EOF'
limit_req_zone $binary_remote_addr zone=mycrew:10m rate=10r/s;

server {
    server_name {DOMAIN};

    auth_basic "mycrew";
    auth_basic_user_file /etc/nginx/.htpasswd;

    limit_req zone=mycrew burst=20 nodelay;
    limit_req_status 429;

    location / {
        proxy_pass http://127.0.0.1:{TUNNEL_REMOTE_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;

        # SSE 버퍼링 방지
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        proxy_set_header X-Accel-Buffering no;
    }

    # 향후 외부 API (Basic Auth 제외)
    location /api/external/ {
        auth_basic off;
        proxy_pass http://127.0.0.1:{TUNNEL_REMOTE_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    listen 80;
}
EOF
```

#### 3단계: SSL 인증서

```bash
sudo certbot --nginx -d {DOMAIN}
```

#### 4단계: Basic Auth

```bash
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd {USERNAME}
# 사용자에게 비밀번호 입력 요청
```

#### 5단계: Fail2ban

```bash
sudo apt install -y fail2ban
sudo tee /etc/fail2ban/jail.local << 'EOF'
[nginx-http-auth]
enabled = true
port = http,https
logpath = /var/log/nginx/error.log
maxretry = 5
bantime = 3600
findtime = 600
EOF
sudo systemctl restart fail2ban
```

#### 6단계: nginx 적용

```bash
sudo nginx -t && sudo systemctl reload nginx
```

#### 7단계: .env 설정 (로컬 Mac)

```bash
# .env에 추가
TUNNEL_HOST={EC2_IP}
TUNNEL_KEY={KEY_PATH}
TUNNEL_REMOTE_PORT={TUNNEL_REMOTE_PORT}
TUNNEL_URL=https://{DOMAIN}
```

#### 8단계: 서버 재시작

서버 재시작하면 SSH 터널이 자동 연결됩니다.

#### 9단계: 확인

```bash
# 인증 없이 → 401
curl -sf -o /dev/null -w "%{http_code}" https://{DOMAIN}/

# 인증 있으면 → 200
curl -sf -o /dev/null -w "%{http_code}" -u {USERNAME}:{PASSWORD} https://{DOMAIN}/
```

사용자에게 접속 URL과 아이디/비밀번호를 안내합니다.

---

## B. ngrok (간편, 5분 완료)

### 설정 절차 (마이크루가 자동 진행 — 사용자에게는 최소한만 요청)

#### 1단계: ngrok 설치 확인 및 자동 설치

```bash
# 설치 확인
which ngrok

# 미설치 시 자동 설치
brew install ngrok
```

사용자에게 알림: "네트워크 설정을 위해 ngrok을 설치할게요." (brew 없으면 brew부터 설치)

#### 2단계: ngrok 인증 + 도메인 확인 (사용자 액션 필요)

사용자에게 안내:
> "외부 접속을 위해 ngrok 설정이 필요해요. 간단해요!
> 1. https://dashboard.ngrok.com 에 로그인하세요 (계정이 없으면 무료 가입 — 구글 로그인 가능)
> 2. https://dashboard.ngrok.com/get-started/your-authtoken 에서 토큰을 복사해주세요
> 3. https://dashboard.ngrok.com/domains 에서 고정 도메인을 확인하거나, 없으면 '+ New Domain'으로 발급해주세요
> 4. 토큰과 도메인을 알려주세요"

사용자가 토큰과 도메인을 제공하면 (기존 설정이 있어도 항상 최신 토큰으로 덮어씀):
```bash
ngrok config add-authtoken {TOKEN}
```

**중요**: 도메인은 `xxx.ngrok-free.app` 전체가 필요. 사용자가 `https://`를 포함하거나 subdomain만 주면 보정:
- `https://xxx.ngrok-free.app` → `xxx.ngrok-free.app` (https:// 제거)
- `xxx` (subdomain만) → `xxx.ngrok-free.app` (.ngrok-free.app 추가)

#### 3단계: .env 설정 + 서버 재시작 (마이크루 자동)

사용자가 도메인을 알려주면 마이크루가 자동으로:
1. `.env` 파일에 `NGROK_URL={도메인}` 추가 (SafeWrite 또는 SafeBash)
2. 서버 재시작 (`<!--RESTART-->`)

#### 4단계: 확인

재시작 후 시스템 메시지에 `ngrok(고정): https://{도메인}`이 표시되면 성공.
사용자에게 외부 접속 주소를 안내하고, 친구 기능도 사용 가능하다고 알려주세요.

#### 참고: ngrok 무료 플랜 제한
- 월 20,000 요청 (API 호출 + 대시보드 접속 포함)
- 동시 터널 1개
- 제한 초과 시 일시적으로 접속 불가 (다음 달 초기화)
- 일반적인 개인 사용에는 충분하지만, 동료와 메시지를 빈번하게 주고받으면 초과할 수 있음
- 제한이 부족하면 유료 플랜 또는 SSH 터널(A 방식)을 안내하세요.

---

## 플레이스홀더

| 변수 | 설명 | 예시 |
|------|------|------|
| `{EC2_IP}` | EC2 공인 IP | 52.78.56.239 |
| `{KEY_PATH}` | SSH 키 Mac 경로 | ~/.ssh/mykey.pem |
| `{DOMAIN}` | 사용자 도메인 | genie.example.com |
| `{TUNNEL_REMOTE_PORT}` | EC2 터널 포트 | 8080 |
| `{USERNAME}` | Basic Auth 아이디 | 사용자 지정 |
| `{PASSWORD}` | Basic Auth 비밀번호 | 사용자 입력 |
| `{TOKEN}` | ngrok authtoken | 대시보드에서 발급 |

---

## 주의사항

- EC2 보안 그룹에서 80, 443 포트 인바운드 허용 필요
- SSL 인증서는 90일마다 자동 갱신 (certbot cron)
- Basic Auth 비밀번호 변경: `sudo htpasswd /etc/nginx/.htpasswd {USERNAME}`
- SSH 터널은 서버 시작 시 자동 연결 + 끊기면 자동 재연결 (tunnel.ts)
