# 선택적 모델·법령 서비스 연결

기본 실행에는 외부 서비스, API 키, GPU가 필요하지 않습니다. 로컬 지식그래프·변경 영향도·검토 문서 패키지는 외부 연결 없이 작동합니다. 입안은 템플릿 기반이며, 이미지 OCR과 국가법령 검색은 아래 설정을 제공한 경우에만 실행됩니다.

환경 변수는 백엔드 또는 MCP 서버를 시작하는 프로세스에 주입합니다. 키를 저장소에 커밋하거나 프런트엔드 환경 변수에 넣지 마세요.

| 기능 | 환경 변수 | 연결 규약 |
| --- | --- | --- |
| 모델 입안 | `RULECRAFT_LLM_BASE_URL`, `RULECRAFT_LLM_MODEL` | OpenAI 호환 `/chat/completions`. BASE_URL에 `/v1`이 필요한 서버는 경로를 포함합니다. |
| 모델 인증 | `RULECRAFT_LLM_API_KEY` | 선택적 Bearer 인증 키 |
| 이미지 서식 인식 | `RULECRAFT_OLLAMA_BASE_URL` | Ollama `/api/generate` |
| Vision 모델 | `RULECRAFT_VISION_MODEL` | 기본값 `llava`; 모델은 Ollama 서버에 별도 설치해야 합니다. |
| 국가법령 검색 | `RULECRAFT_LAW_OC` | 국가법령정보 공동활용 API의 이용자 식별 값 |
| 국가법령 API 주소 | `RULECRAFT_LAW_BASE_URL` | 기본값 `https://www.law.go.kr/DRF` |

로컬 모델 서버 예시:

```bash
export RULECRAFT_LLM_BASE_URL=http://127.0.0.1:8001/v1
export RULECRAFT_LLM_MODEL=your-local-model
export RULECRAFT_OLLAMA_BASE_URL=http://127.0.0.1:11434
export RULECRAFT_VISION_MODEL=llava
```

외부 모델 서버는 HTTPS를 사용해야 합니다. URL에 키, 사용자명, 암호를 포함하지 마세요. 기관 데이터 반출 정책에 맞는 서버를 사용하고 방화벽 및 환경 설정에 필요한 목적지를 추가하세요.

설정 상태는 실제 연결 성공을 의미하지 않습니다. 첫 요청에서 연결 실패 또는 유효하지 않은 응답을 확인하면 오류를 반환합니다. 생성된 조문은 그래프의 인용 검사와 담당자 검토를 거쳐야 하며, OCR 결과는 원본과 대조해야 합니다. 검색 결과를 자동으로 지식 저장소에 반영하지 않습니다.
