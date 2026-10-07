# MyCrew 사진앱 (photos)

마이크루 본체와 완전히 분리된 독립 모듈. 폴더 통째 삭제 = 언인스톨.

## 동작 원리
1. 본체가 manifest.json 존재를 감지 (부팅 + 30s 폴링)
2. 본체 헤더에 [사진] 앱 버튼 자동 표시
3. 진입 시 본체 메인 영역이 127.0.0.1:3201 iframe으로 swap
4. 사진앱 우하단 FAB 클릭 시 본체 ChatPanel이 사진앱 위에 팝업 (관계 역전)

## 격리 원칙
- 본체 코드 import 0
- 본체 DB writePaths 의존 0
- 자체 SQLite, 자체 모델 캐시
- 본체 끄면 사진앱도 의미 없음 (브리지 통신 끊김)
- 사진앱 끄면 본체 버튼 비활성 (다른 기능 0 영향)

## 통신 프로토콜 (WebSocket path=bus)
- host to app: auth.token, theme.sync, lock.state, uninstall.request
- app to host: navigate.home, chat.open, header-badge.set, notify, tool.invoke

## 설치
    cd ~/mycrew-photos
    npm install
    npm start   # :3201

## 제거
    bash ~/mycrew-photos/scripts/uninstall.sh

## 폴더 구조
    ~/mycrew-photos/
      manifest.json
      server/
        index.mjs
        bus.mjs
      client/
        index.html
      scripts/
        uninstall.sh
      data/
      models/
