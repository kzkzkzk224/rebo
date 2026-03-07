# rebo MVP

rebo는 책 검색, 내 서재 저장, 읽기 상태 관리, 한 줄 메모를 제공하는 독서 기록 서비스 MVP입니다.

## 실행

```powershell
$env:ALADIN_TTB_KEY="ttbtldms57702024001"
$env:PORT="4173"
npm install
npm start
```

브라우저: [http://localhost:4173](http://localhost:4173)

## 환경변수
- `ALADIN_TTB_KEY` (필수)
- `NL_API_KEY` (선택, 현재 확장 자리만 준비)
- `PORT` (기본 4173)

## 주요 API
- `GET /api/books/search?q=`
- `GET /api/bookshelf`
- `POST /api/bookshelf`
- `PATCH /api/bookshelf/:id`
- `DELETE /api/bookshelf/:id`

## 구조
- `server.js`
- `services/aladin.js`
- `services/nl.js`
- `services/mergeBooks.js`
- `public/index.html`
- `public/style.css`
- `public/app.js`
- `public/placeholder-cover.svg`
- `data/bookshelf.json`
- `.env.example`
- `AGENTS.md`
