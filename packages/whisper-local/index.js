// 스텁 구현 — 원본 packages/whisper-local 소스가 배포 zip에 포함되지 않음.
// GROQ_API_KEY가 설정돼 있으면 이 경로는 호출되지 않는다(Groq Whisper 1순위).
async function transcribeLocal() {
  throw new Error(
    "[whisper-local stub] 로컬 whisper.cpp 패키지가 이 배포본에 포함되지 않았습니다. " +
    "GROQ_API_KEY를 설정해 Groq Whisper를 사용하거나, 원본 packages/whisper-local을 설치하세요.",
  );
}
module.exports = { transcribeLocal };
