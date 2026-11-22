(function (global) {
  'use strict';

  const STORAGE_KEYS = {
    SCORES: 'examTracker_scores_v1',
    WRONG_NOTES: 'examTracker_wrongNotes_v1',
    SETTINGS: 'examTracker_settings_v1',
    BRIEFINGS: 'examTracker_briefings_v1',
    META: 'examTracker_meta_v1',
  };

  const IDB_NAME = 'examTracker_media_v1';
  const IDB_STORE = 'images';
  const imageCache = new Map();
  let idbAvailable = typeof indexedDB !== 'undefined';
  let idbPromise = null;

  const SUBJECTS = [
    { id: '언어논리', label: '언어논리', group: 'PSAT', color: '#3b82f6', darkColor: '#60a5fa' },
    { id: '자료해석', label: '자료해석', group: 'PSAT', color: '#10b981', darkColor: '#34d399' },
    { id: '상황판단', label: '상황판단', group: 'PSAT', color: '#f59e0b', darkColor: '#fbbf24' },
    { id: '헌법', label: '헌법', group: '1차(P/F)', color: '#8b5cf6', darkColor: '#a78bfa' },
    { id: '행정학', label: '행정학', group: '2차', color: '#ef4444', darkColor: '#f87171' },
    { id: '행정법', label: '행정법', group: '2차', color: '#06b6d4', darkColor: '#22d3ee' },
  ];

  const PSAT_IDS = ['언어논리', '자료해석', '상황판단'];

  function getSubjectMeta(subjectId) {
    return SUBJECTS.find((s) => s.id === subjectId) || {
      id: subjectId,
      label: subjectId,
      group: '',
      color: '#64748b',
      darkColor: '#94a3b8',
    };
  }

  function getSubjectColor(subjectId, theme) {
    const meta = getSubjectMeta(subjectId);
    return theme === 'dark' ? meta.darkColor : meta.color;
  }

  function generateId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function safeParse(raw, fallback) {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function loadSettings() {
    const parsed = safeParse(localStorage.getItem(STORAGE_KEYS.SETTINGS), {});
    const psatTarget = Number(parsed.psatTargetScore);
    const secondTarget = Number(parsed.secondTargetScore);
    return {
      theme: parsed.theme === 'dark' ? 'dark' : 'light',
      geminiApiKey: typeof parsed.geminiApiKey === 'string' ? parsed.geminiApiKey : '',
      geminiModel: typeof parsed.geminiModel === 'string' && parsed.geminiModel ? parsed.geminiModel : 'gemini-4-hydrogen',
      psatTargetScore: !Number.isNaN(psatTarget) && psatTarget > 0 && psatTarget <= 100 ? psatTarget : 80,
      secondTargetScore: !Number.isNaN(secondTarget) && secondTarget > 0 && secondTarget <= 100 ? secondTarget : 65,
    };
  }

  function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  }

  function loadScores() {
    const arr = safeParse(localStorage.getItem(STORAGE_KEYS.SCORES), []);
    return Array.isArray(arr) ? arr : [];
  }

  function saveScores(scores) {
    localStorage.setItem(STORAGE_KEYS.SCORES, JSON.stringify(scores));
  }

  function loadWrongNotes() {
    const arr = safeParse(localStorage.getItem(STORAGE_KEYS.WRONG_NOTES), []);
    if (!Array.isArray(arr)) return [];
    return arr.map((n) => ({
      ...n,
      reviewStatus: n.reviewStatus || 'new',
      reviewCount: typeof n.reviewCount === 'number' ? n.reviewCount : 0,
      nextReviewDate: n.nextReviewDate || n.date || new Date().toISOString().slice(0, 10),
      lastReviewedAt: n.lastReviewedAt || null,
    }));
  }

  function loadBriefings() {
    const obj = safeParse(localStorage.getItem(STORAGE_KEYS.BRIEFINGS), {});
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  }

  function saveBriefings(briefings) {
    localStorage.setItem(STORAGE_KEYS.BRIEFINGS, JSON.stringify(briefings));
  }

  function loadMeta() {
    const parsed = safeParse(localStorage.getItem(STORAGE_KEYS.META), {});
    const changes = Number(parsed.changesSinceBackup);
    return {
      lastBackupAt: typeof parsed.lastBackupAt === 'string' ? parsed.lastBackupAt : null,
      changesSinceBackup: !Number.isNaN(changes) && changes >= 0 ? changes : 0,
    };
  }

  function saveMeta(meta) {
    localStorage.setItem(STORAGE_KEYS.META, JSON.stringify(meta));
  }

  function markDataChanged(count = 1) {
    const meta = loadMeta();
    meta.changesSinceBackup = (meta.changesSinceBackup || 0) + count;
    saveMeta(meta);
    return meta;
  }

  function markBackupCompleted() {
    const meta = {
      lastBackupAt: new Date().toISOString(),
      changesSinceBackup: 0,
    };
    saveMeta(meta);
    return meta;
  }

  function openImageDb() {
    if (!idbAvailable) return Promise.resolve(null);
    if (idbPromise) return idbPromise;
    idbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          idbAvailable = false;
          resolve(null);
        };
      } catch (_) {
        idbAvailable = false;
        resolve(null);
      }
    });
    return idbPromise;
  }

  async function saveImage(noteId, dataUrl) {
    if (!noteId || !dataUrl) return;
    imageCache.set(noteId, dataUrl);
    const db = await openImageDb();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put({
          id: noteId,
          dataUrl,
          bytes: dataUrl.length,
          updatedAt: new Date().toISOString(),
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) {
        resolve(false);
      }
    });
  }

  async function deleteImage(noteId) {
    if (!noteId) return;
    imageCache.delete(noteId);
    const db = await openImageDb();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(noteId);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) {
        resolve(false);
      }
    });
  }

  async function clearAllImages() {
    imageCache.clear();
    const db = await openImageDb();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) {
        resolve(false);
      }
    });
  }

  async function hydrateAllImages(notes) {
    const db = await openImageDb();
    if (db) {
      await new Promise((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE, 'readonly');
          const req = tx.objectStore(IDB_STORE).getAll();
          req.onsuccess = () => {
            const rows = req.result || [];
            rows.forEach((row) => {
              if (row && row.id && row.dataUrl) {
                imageCache.set(row.id, row.dataUrl);
              }
            });
            resolve();
          };
          req.onerror = () => resolve();
        } catch (_) {
          resolve();
        }
      });
    }

    // Migrate any inline imageDataUrl stored in LocalStorage into IndexedDB
    let migrated = false;
    if (Array.isArray(notes) && db) {
      for (const n of notes) {
        if (n && n.imageDataUrl && typeof n.imageDataUrl === 'string') {
          await saveImage(n.id, n.imageDataUrl);
          n.hasImage = true;
          delete n.imageDataUrl;
          migrated = true;
        } else if (n && imageCache.has(n.id)) {
          n.hasImage = true;
        }
      }
      if (migrated) {
        saveWrongNotes(notes);
      }
    } else if (Array.isArray(notes)) {
      notes.forEach((n) => {
        if (n && n.imageDataUrl) {
          imageCache.set(n.id, n.imageDataUrl);
          n.hasImage = true;
        }
      });
    }
    return { idbAvailable: Boolean(db), migrated };
  }

  function getNoteImageUrl(note) {
    if (!note) return null;
    return imageCache.get(note.id) || note.imageDataUrl || null;
  }

  function getStorageStats() {
    let localStorageChars = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('examTracker_')) {
          const val = localStorage.getItem(key) || '';
          localStorageChars += key.length + val.length;
        }
      }
    } catch (_) {
      // ignore
    }
    const localStorageBytes = localStorageChars * 2;
    const localStorageLimitBytes = 5 * 1024 * 1024;
    const localStoragePct = Math.min(100, (localStorageBytes / localStorageLimitBytes) * 100);

    let imageBytes = 0;
    imageCache.forEach((dataUrl) => {
      if (typeof dataUrl === 'string') {
        const commaIdx = dataUrl.indexOf(',');
        const b64Len = commaIdx >= 0 ? dataUrl.length - commaIdx - 1 : dataUrl.length;
        imageBytes += Math.round((b64Len * 3) / 4);
      }
    });

    return {
      localStorageBytes,
      localStorageLimitBytes,
      localStoragePct,
      imageCount: imageCache.size,
      imageBytes,
      idbAvailable,
      meta: loadMeta(),
    };
  }

  function saveWrongNotes(notes) {
    try {
      const payload = idbAvailable
        ? notes.map((n) => {
            const copy = { ...n };
            if (copy.imageDataUrl || imageCache.has(copy.id)) {
              copy.hasImage = true;
            }
            delete copy.imageDataUrl;
            return copy;
          })
        : notes;
      localStorage.setItem(STORAGE_KEYS.WRONG_NOTES, JSON.stringify(payload));
      return true;
    } catch (err) {
      if (err && err.name === 'QuotaExceededError') {
        throw new Error('브라우저 저장 용량(LocalStorage)이 부족합니다. 기존 데이터를 JSON으로 백업한 뒤 정리해 주세요.');
      }
      throw err;
    }
  }

  function compressImageFile(file, maxDim = 1280, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('이미지 파일을 읽을 수 없습니다.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('유효한 이미지 형식이 아닙니다.'));
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width >= height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrl);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // CSV Helpers (RFC 4180 compliant)
  function escapeCsvCell(val) {
    const str = val == null ? '' : String(val);
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  function parseCsv(text) {
    const clean = text.replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      const next = clean[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cell += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          row.push(cell);
          cell = '';
        } else if (ch === '\r' && next === '\n') {
          row.push(cell);
          rows.push(row);
          row = [];
          cell = '';
          i++;
        } else if (ch === '\n' || ch === '\r') {
          row.push(cell);
          rows.push(row);
          row = [];
          cell = '';
        } else {
          cell += ch;
        }
      }
    }
    if (cell.length > 0 || row.length > 0) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  function exportJsonBackup(scores, wrongNotes, briefings) {
    const notesWithImages = wrongNotes.map((n) => {
      const img = getNoteImageUrl(n);
      const copy = { ...n };
      if (img) {
        copy.imageDataUrl = img;
        copy.hasImage = true;
      }
      return copy;
    });
    return JSON.stringify(
      {
        version: 2,
        exportedAt: new Date().toISOString(),
        scores,
        wrongNotes: notesWithImages,
        briefings: briefings || {},
      },
      null,
      2
    );
  }

  function exportScoresCsv(scores) {
    const headers = ['id', 'date', 'examType', 'subject', 'score', 'durationMinutes', 'memo', 'createdAt'];
    const lines = [headers.join(',')];
    scores.forEach((s) => {
      lines.push(
        [
          s.id,
          s.date,
          s.examType,
          s.subject,
          s.score,
          s.durationMinutes != null ? s.durationMinutes : '',
          s.memo || '',
          s.createdAt || '',
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    });
    return '\uFEFF' + lines.join('\r\n');
  }

  function exportWrongNotesCsv(notes) {
    const headers = [
      'id',
      'date',
      'subject',
      'examSource',
      'userChoice',
      'confusionReason',
      'subtopic',
      'questionType',
      'weaknessPoint',
      'actionTip',
      'tags',
      'questionText',
      'aiAnalyzed',
      'reviewStatus',
      'reviewCount',
      'nextReviewDate',
      'createdAt',
    ];
    const lines = [headers.join(',')];
    notes.forEach((n) => {
      lines.push(
        [
          n.id,
          n.date,
          n.subject,
          n.examSource || '',
          n.userChoice || '',
          n.confusionReason || '',
          n.subtopic || '',
          n.questionType || '',
          n.weaknessPoint || '',
          n.actionTip || '',
          Array.isArray(n.tags) ? n.tags.join('|') : '',
          n.questionText || '',
          n.aiAnalyzed ? 'true' : 'false',
          n.reviewStatus || 'new',
          typeof n.reviewCount === 'number' ? n.reviewCount : 0,
          n.nextReviewDate || n.date || '',
          n.createdAt || '',
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    });
    return '\uFEFF' + lines.join('\r\n');
  }

  function normalizeScoreItem(item) {
    if (!item || !item.date || !item.subject || item.score === undefined || item.score === '') return null;
    const num = Number(item.score);
    if (Number.isNaN(num) || num < 0 || num > 100) return null;
    const durRaw = item.durationMinutes !== undefined && item.durationMinutes !== '' && item.durationMinutes !== null
      ? Number(item.durationMinutes)
      : null;
    const durationMinutes = durRaw !== null && !Number.isNaN(durRaw) && durRaw > 0 ? Math.round(durRaw) : null;
    return {
      id: item.id || generateId('sc'),
      date: String(item.date).slice(0, 10),
      examType: String(item.examType || '기출/모의고사').trim(),
      subject: String(item.subject).trim(),
      score: Math.round(num * 10) / 10,
      durationMinutes,
      memo: String(item.memo || '').trim(),
      createdAt: item.createdAt || new Date().toISOString(),
    };
  }

  function normalizeWrongNoteItem(item) {
    if (!item || !item.subject) return null;
    const tags = Array.isArray(item.tags)
      ? item.tags.map((t) => String(t).trim()).filter(Boolean)
      : typeof item.tags === 'string'
      ? item.tags
          .split('|')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
    const dateStr = String(item.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const validStatuses = ['new', 'reviewing', 'mastered'];
    const reviewStatus = validStatuses.includes(item.reviewStatus) ? item.reviewStatus : 'new';
    const rc = Number(item.reviewCount);
    return {
      id: item.id || generateId('wn'),
      date: dateStr,
      subject: String(item.subject).trim(),
      examSource: String(item.examSource || '').trim(),
      questionText: String(item.questionText || '').trim(),
      imageDataUrl: typeof item.imageDataUrl === 'string' && item.imageDataUrl.startsWith('data:image/') ? item.imageDataUrl : null,
      userChoice: String(item.userChoice || '').trim(),
      confusionReason: String(item.confusionReason || '').trim(),
      subtopic: String(item.subtopic || '미분류').trim(),
      questionType: String(item.questionType || '기타').trim(),
      weaknessPoint: String(item.weaknessPoint || '').trim(),
      actionTip: String(item.actionTip || '').trim(),
      tags,
      aiAnalyzed: item.aiAnalyzed === true || item.aiAnalyzed === 'true',
      reviewStatus,
      reviewCount: !Number.isNaN(rc) && rc >= 0 ? Math.round(rc) : 0,
      nextReviewDate: item.nextReviewDate ? String(item.nextReviewDate).slice(0, 10) : dateStr,
      lastReviewedAt: item.lastReviewedAt || null,
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || new Date().toISOString(),
    };
  }

  function importDataFromFileText(fileName, content, mode, currentScores, currentNotes, currentBriefings) {
    const isJson = fileName.toLowerCase().endsWith('.json') || content.trim().startsWith('{') || content.trim().startsWith('[');
    let importedScores = [];
    let importedNotes = [];
    let importedBriefings = {};

    if (isJson) {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        // guess based on fields
        parsed.forEach((row) => {
          if (row && row.score !== undefined) {
            const s = normalizeScoreItem(row);
            if (s) importedScores.push(s);
          } else {
            const n = normalizeWrongNoteItem(row);
            if (n) importedNotes.push(n);
          }
        });
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.scores)) {
          importedScores = parsed.scores.map(normalizeScoreItem).filter(Boolean);
        }
        if (Array.isArray(parsed.wrongNotes)) {
          importedNotes = parsed.wrongNotes.map(normalizeWrongNoteItem).filter(Boolean);
        }
        if (parsed.briefings && typeof parsed.briefings === 'object') {
          importedBriefings = parsed.briefings;
        }
      }
    } else {
      const rows = parseCsv(content);
      if (rows.length < 2) {
        throw new Error('CSV 파일에 헤더와 데이터가 없습니다.');
      }
      const headers = rows[0].map((h) => h.trim());
      const records = rows.slice(1).map((cols) => {
        const obj = {};
        headers.forEach((h, idx) => {
          obj[h] = cols[idx] !== undefined ? cols[idx] : '';
        });
        return obj;
      });
      if (headers.includes('score') && headers.includes('examType')) {
        importedScores = records.map(normalizeScoreItem).filter(Boolean);
      } else if (headers.includes('subtopic') || headers.includes('questionType')) {
        importedNotes = records.map(normalizeWrongNoteItem).filter(Boolean);
      } else {
        throw new Error('지원되지 않는 CSV 컬럼 형식입니다. 내보내기한 CSV 형식을 사용해 주세요.');
      }
    }

    let nextScores = mode === 'replace' ? [] : [...currentScores];
    let nextNotes = mode === 'replace' ? [] : [...currentNotes];

    const existingScoreIds = new Set(nextScores.map((s) => s.id));
    let addedScores = 0;
    importedScores.forEach((s) => {
      if (!existingScoreIds.has(s.id)) {
        nextScores.push(s);
        existingScoreIds.add(s.id);
        addedScores++;
      }
    });

    const existingNoteIds = new Set(nextNotes.map((n) => n.id));
    let addedNotes = 0;
    const importedImages = [];
    importedNotes.forEach((n) => {
      if (!existingNoteIds.has(n.id)) {
        if (n.imageDataUrl) {
          importedImages.push({ id: n.id, dataUrl: n.imageDataUrl });
          n.hasImage = true;
        }
        nextNotes.push(n);
        existingNoteIds.add(n.id);
        addedNotes++;
      }
    });

    const nextBriefings = mode === 'replace'
      ? { ...importedBriefings }
      : { ...(currentBriefings || {}), ...importedBriefings };

    return {
      scores: nextScores,
      wrongNotes: nextNotes,
      briefings: nextBriefings,
      importedImages,
      addedScores,
      addedNotes,
    };
  }

  function downloadTextFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function getSampleData() {
    const today = new Date().toISOString().slice(0, 10);
    const scores = [
      { id: 'smp_s1', date: '2026-09-12', examType: '2024 5급 기출', subject: '언어논리', score: 75.0, durationMinutes: 89, memo: '과학 지문 시간 소요', createdAt: '2026-09-12T10:00:00Z' },
      { id: 'smp_s2', date: '2026-09-12', examType: '2024 5급 기출', subject: '자료해석', score: 72.5, durationMinutes: 90, memo: '비율 계산 실수 2개', createdAt: '2026-09-12T12:00:00Z' },
      { id: 'smp_s3', date: '2026-09-12', examType: '2024 5급 기출', subject: '상황판단', score: 70.0, durationMinutes: 90, memo: '퀴즈 1세트 넘김', createdAt: '2026-09-12T15:00:00Z' },
      { id: 'smp_s4', date: '2026-09-12', examType: '2024 5급 기출', subject: '헌법', score: 76.0, durationMinutes: 23, memo: '통치구조 조문 점검 필요', createdAt: '2026-09-12T16:00:00Z' },

      { id: 'smp_s5', date: '2026-09-26', examType: '메가PSAT 모의 1회', subject: '언어논리', score: 80.0, durationMinutes: 86, memo: '선지 소거 속도 개선', createdAt: '2026-09-26T10:00:00Z' },
      { id: 'smp_s6', date: '2026-09-26', examType: '메가PSAT 모의 1회', subject: '자료해석', score: 77.5, durationMinutes: 88, memo: '가중평균 문제 해결', createdAt: '2026-09-26T12:00:00Z' },
      { id: 'smp_s7', date: '2026-09-26', examType: '메가PSAT 모의 1회', subject: '상황판단', score: 75.0, durationMinutes: 87, memo: '법조문 정확도 상승', createdAt: '2026-09-26T15:00:00Z' },
      { id: 'smp_s8', date: '2026-09-26', examType: '메가PSAT 모의 1회', subject: '헌법', score: 84.0, durationMinutes: 21, memo: '기본권 판례 안정적', createdAt: '2026-09-26T16:00:00Z' },

      { id: 'smp_s9', date: '2026-10-10', examType: '2025 5급 기출', subject: '언어논리', score: 82.5, durationMinutes: 84, memo: '강화약화 1문제 실수', createdAt: '2026-10-10T10:00:00Z' },
      { id: 'smp_s10', date: '2026-10-10', examType: '2025 5급 기출', subject: '자료해석', score: 85.0, durationMinutes: 85, memo: '어림산 정확도 향상', createdAt: '2026-10-10T12:00:00Z' },
      { id: 'smp_s11', date: '2026-10-10', examType: '2025 5급 기출', subject: '상황판단', score: 80.0, durationMinutes: 86, memo: '후반부 집중력 유지', createdAt: '2026-10-10T15:00:00Z' },
      { id: 'smp_s12', date: '2026-10-10', examType: '2025 5급 기출', subject: '헌법', score: 88.0, durationMinutes: 19, memo: '안정권 진입', createdAt: '2026-10-10T16:00:00Z' },

      { id: 'smp_s13', date: '2026-10-18', examType: '2차 순환 모의 1회', subject: '행정학', score: 62.0, durationMinutes: 118, memo: '신제도주의 사례 연결 부족', createdAt: '2026-10-18T14:00:00Z' },
      { id: 'smp_s14', date: '2026-10-18', examType: '2차 순환 모의 1회', subject: '행정법', score: 65.5, durationMinutes: 115, memo: '부관 독립쟁송가능성 논점 누락', createdAt: '2026-10-18T17:00:00Z' },
      { id: 'smp_s15', date: '2026-11-01', examType: '2차 순환 모의 2회', subject: '행정학', score: 68.5, durationMinutes: 114, memo: '성과관리론 목차 구조화 호평', createdAt: '2026-11-01T14:00:00Z' },
      { id: 'smp_s16', date: '2026-11-01', examType: '2차 순환 모의 2회', subject: '행정법', score: 71.0, durationMinutes: 112, memo: '처분성 판례 포섭 구체화', createdAt: '2026-11-01T17:00:00Z' },
    ];

    const wrongNotes = [
      {
        id: 'smp_w1',
        date: '2026-10-10',
        subject: '자료해석',
        examSource: '2025 5급 기출 14번',
        questionText: '2020~2024년 지역별 친환경차 보급 대수 및 전년 대비 증가율 표에서, 2023년 B지역의 보급 비중이 전체의 25% 이상인지 판단하는 선지.',
        imageDataUrl: null,
        userChoice: '3번 (틀린 선지)',
        confusionReason: '증가율(%p) 변화와 전체 대비 비중(%)의 분모 기준을 헷갈림',
        subtopic: '자료해석-비율/증감 비교',
        questionType: '계산형',
        weaknessPoint: '증감률과 구성비의 분모(전년 수치 vs 당해 전체 합계)를 혼동하는 경향이 있음.',
        actionTip: '비율 선지를 볼 때 분모가 "전년"인지 "전체 합계"인지 표 제목과 각주를 먼저 동그라미 친 뒤 어림산하세요.',
        tags: ['분모혼동', '단위착각'],
        aiAnalyzed: true,
        reviewStatus: 'new',
        reviewCount: 0,
        nextReviewDate: today,
        lastReviewedAt: null,
        createdAt: '2026-10-10T18:00:00Z',
        updatedAt: '2026-10-10T18:00:00Z',
      },
      {
        id: 'smp_w2',
        date: '2026-10-12',
        subject: '자료해석',
        examSource: '메가PSAT 모의 22번',
        questionText: 'A기업과 B기업의 매출액 대비 연구개발비 비중 추이 그래프에서 3개년 누적 증가폭 비교.',
        imageDataUrl: null,
        userChoice: '4번',
        confusionReason: '비중이 증가했으니 절대액도 증가했다고 성급히 추론함',
        subtopic: '자료해석-비율/증감 비교',
        questionType: '일치부합',
        weaknessPoint: '비율(%)의 증가를 분자 절대값의 증가로 자동 치환하는 함정에 노출됨.',
        actionTip: '비중 선지에서 전체 규모(분모)가 주어지지 않았으면 절대값 비교는 판단 불가임을 즉시 의심하세요.',
        tags: ['절대값함정', '선지소거미흡'],
        aiAnalyzed: true,
        createdAt: '2026-10-12T11:00:00Z',
        updatedAt: '2026-10-12T11:00:00Z',
      },
      {
        id: 'smp_w3',
        date: '2026-10-14',
        subject: '언어논리',
        examSource: '2025 5급 기출 28번',
        questionText: '도시 열섬 현상 완화 정책의 실효성에 관한 갑의 주장을 가장 적절히 약화하는 사례를 고르는 문제.',
        imageDataUrl: null,
        userChoice: '2번',
        confusionReason: '배경 설명과 직접적 반례(대안 가설)를 구분하지 못하고 상관관계 언급 선지를 선택',
        subtopic: '언어논리-논증의 강화와 약화',
        questionType: '강화약화',
        weaknessPoint: '결론의 인과 고리를 끊는 대안 원인 제시보다 단순 현상 부연 선지에 현혹됨.',
        actionTip: '약화 문제는 지문 속 "원인 → 결과" 화살표를 먼저 도식화하고, 원인이 있어도 결과가 안 나오거나 다른 원인이 개입한 선지를 찾으세요.',
        tags: ['인과혼동', '강화약화'],
        aiAnalyzed: true,
        createdAt: '2026-10-14T15:00:00Z',
        updatedAt: '2026-10-14T15:00:00Z',
      },
      {
        id: 'smp_w4',
        date: '2026-10-16',
        subject: '상황판단',
        examSource: '2024 5급 기출 9번',
        questionText: '보조금 지급 요건 단서 조항("다만, 직전 연도 지원 대상자는 제외하되 제3호에 해당하는 경우는 그러하지 아니하다") 적용 사례 판단.',
        imageDataUrl: null,
        userChoice: '5번',
        confusionReason: '이중 부정("제외하되 ~ 그러하지 아니하다") 해석을 반대로 처리함',
        subtopic: '상황판단-법조문/규정 적용',
        questionType: '법조문 적용',
        weaknessPoint: '본문-단서-재예외로 이어지는 3단계 조건문에서 예외의 예외 부호를 반대로 처리함.',
        actionTip: '법조문 단서의 "제외하되~그러하지 아니하다"는 여백에 [O/X 포함] 화살표로 치환해 메모한 뒤 선지에 대입하세요.',
        tags: ['이중부정', '단서조항'],
        aiAnalyzed: true,
        createdAt: '2026-10-16T09:30:00Z',
        updatedAt: '2026-10-16T09:30:00Z',
      },
      {
        id: 'smp_w5',
        date: '2026-10-20',
        subject: '헌법',
        examSource: '기출문제집 기본권 42번',
        questionText: '과잉금지원칙 심사 시 직업수행의 자유와 직업선택의 자유에 대한 위헌심사 기준 강도 비교 판례.',
        imageDataUrl: null,
        userChoice: '1번',
        confusionReason: '직업수행의 자유 제한에 대해서도 엄격한 비례심사가 적용된 예외 판례를 일반 원칙과 혼동',
        subtopic: '헌법-기본권 제한과 한계',
        questionType: '판례 비교',
        weaknessPoint: '직업의 자유 단계이론에서 원칙적 완화심사 대상과 예외적 엄격심사 판례 구분이 불명확함.',
        actionTip: '판례 결론만 외우지 말고 "직업선택 vs 수행" 중 무엇을 제한했는지 + 입법목적 공익의 비중을 키워드로 묶어 비교하세요.',
        tags: ['판례혼동', '과잉금지원칙'],
        aiAnalyzed: true,
        reviewStatus: 'reviewing',
        reviewCount: 1,
        nextReviewDate: today,
        lastReviewedAt: '2026-11-11T10:00:00Z',
        createdAt: '2026-10-20T13:00:00Z',
        updatedAt: '2026-10-20T13:00:00Z',
      },
      {
        id: 'smp_w6',
        date: '2026-10-25',
        subject: '행정법',
        examSource: '2차 사례연습 3문',
        questionText: '기부채납 부담이 부가된 건축허가에서 부담만을 독립하여 취소소송의 대상으로 삼을 수 있는지 여부 및 제소기간 도과 시 하자승계.',
        imageDataUrl: null,
        userChoice: '기속행위 부관 허용 여부만 서술하고 독립쟁송가능성 누락',
        confusionReason: '부담과 기타 부관(조건·기한·철회권유보)의 처분성 차이 서술 순서를 빠뜨림',
        subtopic: '행정법-행정행위의 부관',
        questionType: '판례 비교',
        weaknessPoint: '부관 사례에서 "가능성 → 한계 → 하자 → 쟁송" 4단계 목차 중 독립쟁송·독립취소 논점을 자주 누락함.',
        actionTip: '사례 문제에서 "부관" 키워드가 보이면 문제지 옆에 [부종/가능/한계/쟁송(부담만 처분성)] 4단 체크리스트를 먼저 적으세요.',
        tags: ['목차누락', '부담처분성'],
        aiAnalyzed: true,
        createdAt: '2026-10-25T16:20:00Z',
        updatedAt: '2026-10-25T16:20:00Z',
      },
      {
        id: 'smp_w7',
        date: '2026-11-01',
        subject: '행정학',
        examSource: '2차 순환 모의 2회 2문',
        questionText: '신공공관리론(NPM)과 뉴거버넌스(New Governance)의 조정 메커니즘 및 관료제 통제 방식 비교.',
        imageDataUrl: null,
        userChoice: '두 이론 모두 시장 경쟁을 강조한다고 서술',
        confusionReason: '뉴거버넌스의 네트워크·신뢰 기반 조정과 NPM의 시장·경쟁 기제를 혼용해 서술함',
        subtopic: '행정학-행정이론과 거버넌스',
        questionType: '개념/학설 비교',
        weaknessPoint: 'NPM(시장·성과)과 뉴거버넌스(네트워크·협력)의 핵심 작동 원리를 명확히 대비시키지 못함.',
        actionTip: '비교 논술에서는 표(가치/조정기제/관료역할/한계)로 핵심 대립축 3가지를 먼저 고정한 뒤 문장을 전개하세요.',
        tags: ['개념혼동', '이론비교'],
        aiAnalyzed: true,
        reviewStatus: 'mastered',
        reviewCount: 3,
        nextReviewDate: '2026-12-30',
        lastReviewedAt: '2026-11-10T10:00:00Z',
        createdAt: '2026-11-01T19:00:00Z',
        updatedAt: '2026-11-01T19:00:00Z',
      },
    ];

    return { scores, wrongNotes: wrongNotes.map((n) => normalizeWrongNoteItem(n)) };
  }

  global.ExamStorage = {
    SUBJECTS,
    PSAT_IDS,
    getSubjectMeta,
    getSubjectColor,
    generateId,
    loadSettings,
    saveSettings,
    loadMeta,
    saveMeta,
    markDataChanged,
    markBackupCompleted,
    loadScores,
    saveScores,
    loadWrongNotes,
    saveWrongNotes,
    hydrateAllImages,
    saveImage,
    deleteImage,
    clearAllImages,
    getNoteImageUrl,
    getStorageStats,
    loadBriefings,
    saveBriefings,
    compressImageFile,
    exportJsonBackup,
    exportScoresCsv,
    exportWrongNotesCsv,
    importDataFromFileText,
    downloadTextFile,
    getSampleData,
  };
})(window);
