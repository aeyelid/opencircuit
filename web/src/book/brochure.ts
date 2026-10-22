/** 위케이션 브로슈어에서 읽은 원고. 쉬운 글 칸은 비워 둔다. */

import type { Book, ImageBlock, ParagraphBlock, Sentence } from "./model.ts";
import { brochureImageData } from "./brochure-images.ts";

export const BROCHURE_SOURCE_FILE_NAME = "위케이션 브로슈어(한글)-압축됨.pdf".normalize("NFC");

function sentence(id: string, text: string): Sentence {
  return {
    id,
    text: text.normalize("NFC"),
    easyText: "",
    audioName: null,
    audioDataUrl: null,
  };
}

function paragraph(id: string, lines: Array<[string, string]>): ParagraphBlock {
  return {
    id,
    kind: "paragraph",
    sentences: lines.map(([sid, text]) => sentence(sid, text)),
  };
}

function image(id: string, key: keyof typeof brochureImageData, alt: string): ImageBlock {
  const file = brochureImageData[key];
  return {
    id,
    kind: "image",
    fileName: file.fileName.normalize("NFC"),
    alt: alt.normalize("NFC"),
    easyAlt: "",
    dataUrl: file.dataUrl,
  };
}

const book: Book = {
  id: "wecation-brochure",
  title: "위케이션 WECATION",
  sourceFileName: BROCHURE_SOURCE_FILE_NAME,
  updatedAt: "2026-10-12T11:59:25.000Z",
  chapters: [
    {
      id: "wec-ch-company",
      title: "위케이션",
      blocks: [
        paragraph("wec-p-company", [
          ["wec-s-name", "위케이션 WECATION."],
          ["wec-s-co", "주식회사 위케이션, wecation co,. ltd."],
          ["wec-s-ceo", "대표 오정민, 예술가·기획자."],
          ["wec-s-web", "홈페이지는 wecation.kr입니다."],
          ["wec-s-ig", "인스타그램은 @wecation_입니다."],
          ["wec-s-friends", "모두는 모두와 친구야."],
        ]),
        image(
          "wec-img-heart",
          "heart",
          "분홍 하트 몸에 둥근 눈과 작은 팔다리가 있고, 뒤로 빨간 불꽃이 있는 캐릭터입니다.",
        ),
        image("wec-img-cat", "cat", "옆으로 엎드린 회색 고양이 그림입니다."),
        image(
          "wec-img-qr-home",
          "qrHome",
          "홈페이지라고 적힌 자리의 흑백 QR 코드입니다. 코드의 주소는 https://m.site.naver.com/2ipzz 입니다.",
        ),
        image(
          "wec-img-qr-ig",
          "qrInsta",
          "인스타그램이라고 적힌 자리의 흑백 QR 코드입니다. 코드의 주소는 https://m.site.naver.com/28B0C 입니다.",
        ),
      ],
    },
    {
      id: "wec-ch-scenes",
      title: "현장의 장면",
      blocks: [
        image(
          "wec-img-survey",
          "survey",
          "주황빛 실내에서 짧은 머리의 남성이 옆모습으로 유리면을 보고 있습니다. 유리에는 얼굴이 비치고, 남색 겉옷과 가방끈이 보입니다.",
        ),
        paragraph("wec-p-survey", [
          [
            "wec-s-anger",
            "지역 문화예술공간 접근성 정보 수집 및 국가폭력 생존자 아카이빙 사업, 분노(2025).",
          ],
          ["wec-s-kim", "영화숙재생원 생존자 김흥성 전시장소 관람 접근성 조사장면."],
        ]),
        image(
          "wec-img-stage",
          "stage",
          "공연장 조명 아래에서 남색 조끼를 입은 남성이 한 손을 배에 대고 서 있습니다. 뒤에는 얼굴이 인쇄된 세로 천과 다른 사람, 벽에 작은 그림이 있습니다.",
        ),
        paragraph("wec-p-stage", [
          ["wec-s-monster", "공연형 전시, 부산에 괴물이 산다(2025)."],
          ["wec-s-yoon", "형제복지원 생존자 윤영두 공연 장면."],
        ]),
      ],
    },
    {
      id: "wec-ch-way",
      title: "예술이 사람과 지역을 만나는 방식",
      blocks: [
        paragraph("wec-p-way", [
          ["wec-s-way", "예술이 사람과 지역을 만나는 방식을 기획합니다."],
          ["wec-s-choice", "문화·예술 경험을, 누구나 스스로 선택할 수 있도록."],
          ["wec-s-fields", "기획, 제작, 문화접근성, 출판, 아트상품."],
        ]),
      ],
    },
    {
      id: "wec-ch-next",
      title: "다음 프로젝트",
      blocks: [
        paragraph("wec-p-next", [
          ["wec-s-next", "다음 프로젝트를 위케이션과 함께 만드세요."],
          ["wec-s-who", "위케이션은 무엇을 만들지와 함께, 누가 어떻게 경험할지를 고민합니다."],
        ]),
      ],
    },
    {
      id: "wec-ch-making",
      title: "기획부터 관람까지",
      blocks: [
        paragraph("wec-p-making", [
          ["wec-s-together-work", "기획부터 관람까지, 함께 만들 수 있는 일."],
          [
            "wec-s-access-info",
            "실제 관람 경험과 필요한 지원을 정보로 정리하고, 접근성 정보를 제공합니다.",
          ],
          ["wec-s-consult", "공간의 이용 경험을 살피는 컨설팅."],
          [
            "wec-s-offer",
            "방문 전 안내와 감상 콘텐츠 제작, 전시·공연 기획을 제안합니다.",
          ],
        ]),
      ],
    },
    {
      id: "wec-ch-with",
      title: "모두가 함께하는 문화·예술 경험",
      blocks: [
        paragraph("wec-p-with", [
          ["wec-s-with", "모두가 함께하는 문화·예술 경험."],
          ["wec-s-people", "장애인, 고령자, 비전공자."],
          ["wec-s-joy", "모두가 즐거운 경험을 만들기 위한 정보를 제공합니다."],
          ["wec-s-support", "장애 유형별 지원."],
        ]),
      ],
    },
    {
      id: "wec-ch-works",
      title: "작업 사례",
      blocks: [
        image(
          "wec-img-workshop",
          "workshop",
          "실내에서 줄무늬 옷을 입은 사람이 조리대를 가리키고, 앞에는 머리띠를 한 사람이 그릇을 들고 있습니다. 뒤에서도 사람들이 음식을 다루고 있습니다.",
        ),
        paragraph("wec-p-workshop", [
          ["wec-s-opencode", "워크숍 강연 프로젝트, 오픈코드(2024)."],
          ["wec-s-busan", "부산문화재단 문화교육팀 협력사업."],
        ]),
        image(
          "wec-img-exhibit",
          "exhibit",
          "흰 벽의 전시장에 그림 세 점이 있습니다. 왼쪽 큰 그림에는 알록달록한 사물과 파란 꽃병이 있고, 오른쪽에는 작은 그림 두 점이 위아래로 있습니다.",
        ),
        paragraph("wec-p-exhibit", [
          ["wec-s-loop", "전시, 루프 오프(2025)."],
          ["wec-s-yoonjin", "자폐스펙트럼 창작자 윤진석 개인전 기획·운영·접근성지원."],
        ]),
        image(
          "wec-img-cards",
          "cards",
          "야외에서 두 손이 여러 색의 그림 카드를 펼치고 있습니다. 아래에는 그림이 인쇄된 종이가 놓여 있습니다.",
        ),
        paragraph("wec-p-cards", [
          ["wec-s-moon", "프로젝트, 달의 예언, 일곱가지 이야기(2026)."],
          ["wec-s-shin-goods", "자폐스펙트럼 창작자 신현채 기획 프로젝트와 아트상품."],
        ]),
        image(
          "wec-img-archive",
          "archive",
          "두 손이 초록색 표지의 책을 들고 있습니다. 표지에는 집, 달, 하트와 불꽃, 팔레트, 꽃, 별, 회색 네모 기기 그림이 있고, 미리보기와 O JUNG MIN이라는 글자가 보입니다. 집 모양 칸에는 2025. 8. 31.부터 10. 19.까지라고 적혀 있습니다.",
        ),
        paragraph("wec-p-archive", [
          ["wec-s-bulbul", "프로젝트, 불불가능(2026)."],
          ["wec-s-archive-book", "장애인구 밀집지 문화소외지역에서의 아카이빙북 발간."],
          ["wec-s-ai-label", "이 사진 위에는 AI 이미지라고 적혀 있습니다."],
        ]),
      ],
    },
    {
      id: "wec-ch-01",
      title: "전시·공연·축제·행사 기획과 제작",
      blocks: [
        paragraph("wec-p-01", [
          ["wec-s-01", "01 전시·공연·축제·행사 기획과 제작."],
          ["wec-s-inclusive", "포용적인 기획."],
          ["wec-s-local", "로컬 & 사회적 의제 기반 기획."],
          [
            "wec-s-curate",
            "사회적 의제와 작가의 이야기를 바탕으로 큐레이팅, 공간·전시디자인.",
          ],
        ]),
      ],
    },
    {
      id: "wec-ch-02",
      title: "문화접근성 콘텐츠와 디자인",
      blocks: [
        paragraph("wec-p-02", [
          ["wec-s-02", "02 문화접근성 콘텐츠와 디자인."],
          ["wec-s-universal", "유니버설 디자인."],
          ["wec-s-tarot-2", "신현채 작가의 타로카드."],
          [
            "wec-s-aac",
            "수어통역, 음성해설, 촉각감상물, 쉬운 글·큰 글씨 홍보물, AAC(보완대체의사소통).",
          ],
        ]),
      ],
    },
    {
      id: "wec-ch-03",
      title: "아티스트 협업과 상품 개발",
      blocks: [
        paragraph("wec-p-03", [
          ["wec-s-03", "03 아티스트 협업과 상품 개발."],
          ["wec-s-artgoods", "자폐장애 창작자와의 아트상품."],
          ["wec-s-tarot-3", "신현채 작가의 타로카드."],
          [
            "wec-s-collab",
            "장애 창작자와 공동창작 프로젝트를 기획·운영하고, 작품을 아트상품으로.",
          ],
        ]),
      ],
    },
    {
      id: "wec-ch-04",
      title: "출판과 기록",
      blocks: [
        paragraph("wec-p-04", [
          ["wec-s-04", "04 출판과 기록."],
          ["wec-s-press", "출판사 석굴앎."],
          ["wec-s-isbn", "출판 항목에 ISBN이라고 적혀 있습니다."],
          ["wec-s-bind", "작품과 삶의 이야기, 프로젝트의 과정을 책으로 엮습니다."],
        ]),
      ],
    },
  ],
};

export function brochureBook(): Book {
  return structuredClone(book);
}
