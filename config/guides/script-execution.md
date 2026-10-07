# SafeBash로 스크립트 실행

`tools/`·`vendor/`의 Node·Python 스크립트를 SafeBash로 돌릴 때의 규칙. 이 문서가 유일한 기준이다.

## 인터프리터는 절대경로로 부른다

SafeBash의 PATH는 로그인 셸과 다르다. `node`·`py`·`python`이 PATH에 없어 그냥 부르면 실패한다 (검증됨). 그래서 인터프리터를 **절대경로로** 지정한다.

현재 설치본의 경로:

| 런타임 | 경로 |
|---|---|
| Node | `node` |
| Python | `python3` |

```
node tools/gemini-search.mjs "검색어"
python3 vendor/last30days/scripts/last30days.py "주제" --days=30 --emit=compact
```

이 값들은 **이 설치본의 예시**다. 다른 머신·OS에서는 다르고, Python 경로에는 사용자명이 박혀 있다. 경로가 틀려서 실패하면 지어내서 고치지 말고 "인터프리터 경로 불일치"로 보고한다.

## 인자 전달

- 복잡한 JSON은 **명령줄 인라인으로 넘기지 않는다.** Windows cmd가 작은따옴표를 처리하지 못해 깨진다 (검증됨). SafeWrite로 파일에 저장하고 **파일 경로**를 넘긴다.
- 긴 작업은 타임아웃을 넉넉히 준다 (엔진류는 180초 권장).

## 실패 처리

- 실행은 **1회**가 원칙. 실패하면 같은 명령을 반복하지 말고 stderr를 읽어 원인을 고친 뒤 1회만 재시도한다.
- 그래도 실패하면 stderr 원문을 그대로 보고한다. 스크립트가 못 가져온 것을 일반 지식으로 채우지 않는다.
- 폴백(WebSearch 등)을 썼으면 보고서에 폴백 사용을 명시한다.
