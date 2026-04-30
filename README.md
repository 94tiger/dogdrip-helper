# dogdrip-helper

dogdrip.net 사용에 도움되는 Chrome 확장 프로그램입니다.

## 기능

### 읽음 동기화
- 읽은 게시물을 Google Drive에 저장하여 여러 기기에서 동기화
- 기기를 바꿔도 읽은 게시물이 흐리게 표시됨
- 동기화 주기: 1분
- 유지 기간 설정 가능 (7일 / 14일 / 30일 / 90일 / 무제한)

### 회원 차단
- 댓글 작성자 클릭 → 팝업에서 차단 버튼
- 차단된 회원의 댓글은 "차단된 사용자의 댓글입니다." 로 대체
- 클릭하면 확인 후 원본 댓글 표시
- 차단 목록 관리 (해제 가능)

## 설치

[Chrome 웹 스토어](#) 에서 설치

## 구조

```
dogdrip-helper/
├── manifest.json
├── background.js      # 서비스 워커 (Drive 동기화, 차단 관리)
├── content.js         # 페이지 스크립트 (읽음 감지, 차단 적용)
├── config.js          # CLIENT_ID (gitignore됨)
├── config.example.js  # config.js 템플릿
└── popup/
    ├── popup.html
    └── popup.js
```

## 데이터 저장

- 읽음 기록: 사용자 본인의 Google Drive `appDataFolder`
- 차단 목록: 기기 로컬 스토리지
- 개발자 서버 없음, 제3자 전송 없음

## 라이센스

MIT
