(function (global) {
  'use strict';

  const DEFAULT_MODEL = 'gemini-4-hydrogen';

  const MODEL_LABELS = {
    'gemini-4-hydrogen': 'Gemini 4 Hydrogen',
    'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
  };

  function getModelLabel(modelId) {
    return MODEL_LABELS[modelId] || modelId;
  }

  function parseDataUrl(dataUrl) {
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
    if (!match) return null;
    return {
      mimeType: match[1],
      data: match[2],
    };
  }

  async function analyzeWrongProblem({ apiKey, model, subject, examSource, questionText, imageDataUrl, userChoice, confusionReason, existingSubtopics = [] }) {
    const targetModel = (model && model.trim()) || DEFAULT_MODEL;
    if (!apiKey || !apiKey.trim()) {
      throw new Error('Gemini API Key가 설정되지 않았습니다. 상단 [API 설정] 버튼에서 키를 입력해 주세요.');
    }

    if (!questionText && !imageDataUrl) {
      throw new Error('문제 캡처 이미지 또는 문제 텍스트 중 하나 이상을 입력해 주세요.');
    }

    const subtopicHint = Array.isArray(existingSubtopics) && existingSubtopics.length > 0
      ? `[기존 등록 세부 단원 목록 (${subject} 우선)]: ${existingSubtopics.join(', ')}`
      : '';

    const promptText = [
      '당신은 대한민국 5급 공채(행정고시) PSAT(언어논리·자료해석·상황판단), 헌법, 행정학, 행정법 전문 수험 코치입니다.',
      '사용자가 틀린 문제 정보와 오답 메모를 바탕으로 아래 JSON 스키마에 맞춰 약점을 정확히 분석하세요.',
      '',
      `[대상 과목]: ${subject}`,
      examSource ? `[출처]: ${examSource}` : '',
      subtopicHint,
      questionText ? `[문제 텍스트]:\n${questionText}` : '[문제 텍스트]: (첨부 이미지 참고)',
      userChoice ? `[사용자가 고른 오답 선지]: ${userChoice}` : '',
      confusionReason ? `[사용자가 남긴 헷갈린 이유]: ${confusionReason}` : '',
      '',
      '작성 규칙:',
      '1. subtopic: 반드시 "과목명-세부단원" 형식으로 간결하고 표준화된 명칭을 쓰세요. 특히 위 [기존 등록 세부 단원 목록] 중 같은 영역·단원에 해당하는 항목이 있다면 표현을 변형하지 말고 기존 명칭을 그대로 재사용하세요. 목록에 맞는 단원이 없을 때만 새 명칭을 만드세요. (예: "자료해석-비율/증감 비교", "행정법-행정행위의 부관", "헌법-기본권 제한", "언어논리-논증의 강화와 약화", "상황판단-법조문 적용", "행정학-행정이론과 거버넌스")',
      '2. questionType: 대표적인 문제 유형 1가지를 고르세요. (예: 일치부합, 강화약화, 법조문 적용, 판례 비교, 계산형, 논리퀴즈, 자료해석 함정, 개념/학설 비교, 사례 포섭)',
      '3. weaknessPoint: 수험생이 왜 이 문제를 틀렸는지 핵심 약점 포인트를 한국어 1~2문장으로 명확히 요약하세요.',
      '4. actionTip: 다음 실전에서 같은 실수를 막을 구체적이고 실천 가능한 행동 교정 팁을 한국어 1~2문장으로 제시하세요.',
      '5. tags: 복습 필터링에 유용한 짧은 핵심 키워드 태그 2~4개를 배열로 반환하세요. (예: ["분모혼동", "단위착각"])',
    ]
      .filter(Boolean)
      .join('\n');

    const parts = [{ text: promptText }];
    if (imageDataUrl) {
      const parsedImg = parseDataUrl(imageDataUrl);
      if (parsedImg) {
        parts.push({
          inlineData: {
            mimeType: parsedImg.mimeType,
            data: parsedImg.data,
          },
        });
      }
    }

    const responseSchema = {
      type: 'OBJECT',
      properties: {
        subtopic: { type: 'STRING' },
        questionType: { type: 'STRING' },
        weaknessPoint: { type: 'STRING' },
        actionTip: { type: 'STRING' },
        tags: {
          type: 'ARRAY',
          items: { type: 'STRING' },
        },
      },
      required: ['subtopic', 'questionType', 'weaknessPoint', 'actionTip', 'tags'],
    };

    const parsed = await callGeminiJson({
      apiKey,
      model: targetModel,
      parts,
      responseSchema,
      temperature: 0.2,
    });

    return {
      subtopic: String(parsed.subtopic || `${subject}-기타`).trim(),
      questionType: String(parsed.questionType || '기타').trim(),
      weaknessPoint: String(parsed.weaknessPoint || '').trim(),
      actionTip: String(parsed.actionTip || '').trim(),
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.map((t) => String(t).replace(/^#/, '').trim()).filter(Boolean)
        : [],
    };
  }

  async function callGeminiJson({ apiKey, model, parts, responseSchema, temperature = 0.2 }) {
    const targetModel = (model && model.trim()) || DEFAULT_MODEL;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature,
        responseMimeType: 'application/json',
        responseSchema,
      },
    };

    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (_) {
      throw new Error('네트워크 오류로 Gemini API에 연결하지 못했습니다. 인터넷 연결 상태를 확인해 주세요.');
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = payload?.error?.message || `HTTP ${response.status}`;
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        throw new Error(`Gemini API 인증/요청 오류: ${msg}. API Key가 올바른지 설정에서 확인해 주세요.`);
      }
      if (response.status === 429) {
        throw new Error('Gemini API 호출 한도(Rate Limit)를 초과했습니다. 잠시 후 다시 시도해 주세요.');
      }
      throw new Error(`Gemini API 오류: ${msg}`);
    }

    const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      throw new Error('Gemini API 응답에서 분석 결과를 찾을 수 없습니다.');
    }

    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch (_) {
      throw new Error('AI 응답을 JSON으로 파싱하는 데 실패했습니다. 다시 시도해 주세요.');
    }
  }

  async function generateWeaknessBriefing({ apiKey, model, subjectLabel, notes }) {
    if (!apiKey || !apiKey.trim()) {
      throw new Error('Gemini API Key가 설정되지 않았습니다. 상단 [API 설정]에서 키를 입력해 주세요.');
    }
    if (!Array.isArray(notes) || notes.length === 0) {
      throw new Error('브리핑을 생성할 누적 오답 데이터가 없습니다.');
    }

    const sampleNotes = [...notes]
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, 30);

    const digestLines = sampleNotes.map((n, idx) => {
      const tagsStr = Array.isArray(n.tags) && n.tags.length ? n.tags.map((t) => `#${t}`).join(' ') : '';
      return `${idx + 1}. [${n.subject} | ${n.subtopic} | ${n.questionType}] 오답선택:${n.userChoice || '-'} / 메모:${n.confusionReason || '-'} / 약점:${n.weaknessPoint || '-'} / 팁:${n.actionTip || '-'} ${tagsStr}`;
    });

    const promptText = [
      '당신은 대한민국 5급 공채(행정고시) 수험생의 누적 오답 데이터를 종합 진단하는 수석 코치입니다.',
      `아래는 수험생의 [${subjectLabel}] 영역 최근 오답 기록 ${sampleNotes.length}건 요약입니다.`,
      '시험 직전 1페이지로 인쇄해 들고 갈 수 있도록 가장 반복되는 약점 패턴과 실전 행동 수칙을 구조화된 JSON으로 작성하세요.',
      '',
      digestLines.join('\n'),
      '',
      '작성 규칙:',
      '1. title: 예) "자료해석 시험 직전 1페이지 약점 브리핑" 또는 "전체 과목 시험 직전 약점 브리핑"',
      '2. topTraps: 가장 자주 빠지는 함정 패턴 TOP 3 배열. 각 항목은 name(함정명), frequencyHint(예: "전체 12건 중 4건 반복" 등), description(왜 틀리는지와 즉각 판별법 1~2문장)을 포함.',
      '3. examDayChecklist: 시험장 들어가기 전 3분 행동 수칙 체크리스트 4~6개 (짧고 명령형/실전형 문장).',
      '4. studyPrescription: 앞으로 1주일간의 핵심 보완 학습 처방 (2~3문장).',
      '5. mantra: 시험지 여백 맨 위에 적어둘 핵심 한 줄 키워드/다짐.',
    ].join('\n');

    const responseSchema = {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        topTraps: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              name: { type: 'STRING' },
              frequencyHint: { type: 'STRING' },
              description: { type: 'STRING' },
            },
            required: ['name', 'frequencyHint', 'description'],
          },
        },
        examDayChecklist: {
          type: 'ARRAY',
          items: { type: 'STRING' },
        },
        studyPrescription: { type: 'STRING' },
        mantra: { type: 'STRING' },
      },
      required: ['title', 'topTraps', 'examDayChecklist', 'studyPrescription', 'mantra'],
    };

    const parsed = await callGeminiJson({
      apiKey,
      model,
      parts: [{ text: promptText }],
      responseSchema,
      temperature: 0.3,
    });

    return {
      title: String(parsed.title || `${subjectLabel} 시험 직전 약점 브리핑`).trim(),
      topTraps: Array.isArray(parsed.topTraps) ? parsed.topTraps.slice(0, 3) : [],
      examDayChecklist: Array.isArray(parsed.examDayChecklist) ? parsed.examDayChecklist.map(String) : [],
      studyPrescription: String(parsed.studyPrescription || '').trim(),
      mantra: String(parsed.mantra || '').trim(),
      noteCount: sampleNotes.length,
      generatedAt: new Date().toISOString(),
      modelUsed: getModelLabel((model && model.trim()) || DEFAULT_MODEL),
    };
  }

  global.ExamGemini = {
    DEFAULT_MODEL,
    getModelLabel,
    analyzeWrongProblem,
    generateWeaknessBriefing,
  };
})(window);
