// WebLLM 웹 워커 — WebGPU 기반 생성 모델을 메인 스레드 밖에서 실행한다.
// web-llm의 표준 워커 핸들러 패턴: 메인 스레드는 CreateWebWorkerMLCEngine(worker, ...)으로 연결.
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();
// onmessage는 핸들러의 this 바인딩이 필요하므로 래핑(직접 대입 금지).
self.onmessage = (event: MessageEvent): void => { handler.onmessage(event); };
