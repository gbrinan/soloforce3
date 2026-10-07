// 디자인 AI 프롬프트 빌더 — DesignRunRequest를 claude CLI용 system/user 쌍으로 변환.
import type { DesignRunRequest } from "../design/types";

// Shared DesignOp/Shape schema spec — reused by run/clone/critique prompts.
export const OPS_SCHEMA_SPEC = `연산(DesignOp) 스키마:
- op: "add" | "update" | "delete"
- add: { "op":"add", "shape": <전체 Shape, id 생략 가능> }
- update: { "op":"update", "id": "<대상 id>", "shape": <변경할 필드만 부분> }
- delete: { "op":"delete", "id": "<대상 id>" }

Shape 스키마 (모든 type 공통 BaseShape 필드 + type별 추가 필드):
공통: id(string), type, name(string), x, y, width, height(number), rotation(deg), opacity(0..1), fill(#RRGGBB 또는 "none"), stroke(#RRGGBB 또는 "none"), strokeWidth(number), radius(number, rect 코너 반경), visible(bool), locked(bool), parentId(string|null, frame 중첩; null=페이지 루트)
type: "rect" | "ellipse" | "frame" | "text" | "path" | "image" | "line"
- text: text(string), fontSize(number), fontFamily(string), fontWeight(number), align("left"|"center"|"right"), color(#RRGGBB 텍스트색)
- path: d(string, SVG path data, shape-local 좌표, viewBox=width/height)
- image: href(string, data: URL 또는 절대 src), alt?(string), sourcePrompt?(string), generatedAt?(ISO string)
- line: x2(number), y2(number) — 두 번째 끝점(절대 좌표)`;

const SYSTEM = `너는 Penpot/Figma 계열 벡터 디자인 편집 어시스턴트다. 입력 디자인 문서(JSON)와 선택된 요소 id, 사용자 의도를 받아, 적용할 연산(ops) 배열만 JSON으로 출력한다. 출력은 반드시 {"ops":[...],"message":"..."} 형식의 순수 JSON. 좌표는 캔버스 픽셀(좌상단 0,0), 회전은 degrees, 색은 반드시 #RRGGBB 또는 "none"이다. 새 요소 add 시 id는 생략 가능(클라이언트가 부여).

${OPS_SCHEMA_SPEC}

규칙:
- 출력은 JSON 단일 객체만. 설명 문장·코드펜스 금지.
- 수정이 불필요하거나 불가능하면 {"ops":[],"message":"<사유>"}.
- selectedIds가 비어있지 않으면 update/delete는 반드시 selectedIds 내부 id에만 적용한다. selectedIds 밖 요소를 재배치·삭제·색상변경하지 않는다.
- selectedIds가 비어있고 사용자가 "전체", "모두"를 명시하지 않았다면 기존 요소의 대량 변경보다 새 요소 추가 또는 국소 변경을 우선한다.
- locked=true 또는 visible=false 요소는 명시 요청이 없으면 수정하지 않는다.
- parentId는 기존 프레임 안에 추가해야 할 때만 해당 frame id를 사용하고, 아니면 null을 사용한다. 존재하지 않는 parentId 금지.
- add shape는 BaseShape 공통 필드를 모두 채운다: type, name, x, y, width, height, rotation, opacity, fill, stroke, strokeWidth, radius, visible, locked, parentId.
- 좌표·크기는 정수 픽셀 권장. width/height는 1 이상, opacity는 0~1로 제한한다.
- 캔버스 밖으로 완전히 벗어나는 shape를 만들지 않는다. 기본 여백 24px 이상을 선호한다.
- 텍스트는 요청 언어를 유지한다. fontFamily 기본값은 "Inter, system-ui, sans-serif", fontWeight는 400/500/600/700 중 하나를 쓴다.
- 이미지 생성 자체는 이 서버가 별도로 처리한다. "이미지를 만들어줘/생성해줘" 같은 요청에는 placeholder image href를 만들지 말고, 벡터 보조 요소가 필요한 경우에만 ops를 반환한다.`;

export function buildDesignPrompt(req: DesignRunRequest): {
  system: string;
  user: string;
} {
  const page = req.doc.pages.find((p) => p.id === req.pageId);
  const shapes = page ? page.shapes : [];
  const pageName = page ? page.name : "(알 수 없는 페이지)";

  const docMeta = {
    docId: req.doc.id,
    docName: req.doc.name,
    canvasWidth: req.doc.width,
    canvasHeight: req.doc.height,
    pageId: req.pageId,
    pageName,
  };

  const selected = req.selectedIds ?? [];

  const user = [
    "# 디자인 문서 메타",
    JSON.stringify(docMeta, null, 2),
    "",
    `# 현재 페이지(${pageName})의 요소들 (shapes)`,
    JSON.stringify(shapes, null, 2),
    "",
    "# 선택된 요소 id (selectedIds)",
    selected.length > 0
      ? `${JSON.stringify(selected)}\n주의: update/delete는 위 id만 허용된다.`
      : "(없음 — 선택된 요소가 없으므로 의도에 맞게 페이지 전체를 대상으로 판단한다)",
    "",
    "# 사용자 의도 (intent)",
    req.intent ?? "",
    "",
    '위 정보를 바탕으로 적용할 ops 배열을 {"ops":[...],"message":"..."} 형식의 순수 JSON으로만 출력하라.',
  ].join("\n");

  return { system: SYSTEM, user };
}
