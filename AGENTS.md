# AGENTS.md - rebo

## 기본 원칙
- 항상 Local 모드 기준으로 작업한다.
- 하드코딩 비밀키를 코드에 넣지 않는다.
- 환경변수만 사용한다.

## 검증 루틴 (항상 수행)
1. `npm install`
2. `npm start` (또는 `node server.js`)
3. 서버가 `http://localhost:4173`에서 뜨는지 확인
4. `GET /api/books/search?q=해리포터` 호출
5. 검색 결과 없음과 API 실패를 구분해 확인
6. 검증 실패 시 실패한 명령과 원인을 보고

## 상태값 규칙
- to-read
- reading
- done

## MVP 저장소
- data/bookshelf.json 파일을 단일 저장소로 사용
