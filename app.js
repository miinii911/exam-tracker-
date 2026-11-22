(function () {
  'use strict';

  const S = window.ExamStorage;
  const C = window.ExamCharts;
  const G = window.ExamGemini;

  const SPACED_INTERVALS = [1, 3, 7, 14, 30];

  const state = {
    activeTab: 'dashboard',
    settings: S.loadSettings(),
    scores: S.loadScores(),
    wrongNotes: S.loadWrongNotes(),
    briefings: S.loadBriefings(),
    // Dashboard state
    scoreFilter: 'ALL',
    chartMode: 'aggregate', // 'aggregate' | 'average' | 'compare'
    scoreSearch: '',
    // Analyzer state
    pendingImageDataUrl: null,
    editingWrongId: null,
    editingTags: [],
    wrongFilterSubject: 'ALL',
    wrongSearch: '',
    // Report state
    reportSubjectFilter: 'ALL',
    reportDrilldown: null, // { type: 'subtopic' | 'questionType' | 'tag', value: string }
    mergePanelOpen: false,
    // Review state
    reviewSubjectFilter: 'ALL',
    reviewMode: 'due', // 'due' | 'unmastered' | 'all'
    reviewIndex: 0,
    reviewRevealed: false,
  };

  function todayStr() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function addDays(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1);
    dt.setDate(dt.getDate() + days);
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function showToast(message, isError = false) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast${isError ? ' error' : ''}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 3400);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const sun = document.getElementById('icon-sun');
    const moon = document.getElementById('icon-moon');
    const metaTheme = document.getElementById('meta-theme-color');
    if (theme === 'dark') {
      sun.classList.add('hidden');
      moon.classList.remove('hidden');
      if (metaTheme) metaTheme.setAttribute('content', '#171e27');
    } else {
      sun.classList.remove('hidden');
      moon.classList.add('hidden');
      if (metaTheme) metaTheme.setAttribute('content', '#315efb');
    }
  }

  function openSettingsModal(focusKey = false) {
    document.getElementById('select-gemini-model').value = state.settings.geminiModel || G.DEFAULT_MODEL;
    document.getElementById('input-gemini-key').value = state.settings.geminiApiKey || '';
    document.getElementById('modal-settings').classList.remove('hidden');
    if (focusKey) {
      document.getElementById('input-gemini-key').focus();
    }
  }

  function updateApiStatusUI() {
    const hasKey = Boolean(state.settings.geminiApiKey && state.settings.geminiApiKey.trim());
    const dot = document.getElementById('api-status-dot');
    const label = document.getElementById('api-status-label');
    const badge = document.getElementById('analyzer-model-badge');
    if (badge) {
      badge.textContent = G.getModelLabel(state.settings.geminiModel);
    }
    if (hasKey) {
      dot.classList.add('connected');
      label.textContent = 'API 연결됨';
    } else {
      dot.classList.remove('connected');
      label.textContent = 'API 설정';
    }
  }

  function isNoteDueToday(note, today = todayStr()) {
    if (note.reviewStatus === 'mastered') return false;
    const due = note.nextReviewDate || note.date || today;
    return due <= today;
  }

  function updateReviewBadge() {
    const today = todayStr();
    const dueCount = state.wrongNotes.filter((n) => isNoteDueToday(n, today)).length;
    const badge = document.getElementById('review-due-badge');
    if (badge) {
      badge.textContent = String(dueCount);
      badge.classList.toggle('hidden', dueCount === 0);
    }
    const mobileBadge = document.getElementById('mobile-review-due-badge');
    if (mobileBadge) {
      mobileBadge.textContent = String(dueCount);
      mobileBadge.classList.toggle('hidden', dueCount === 0);
    }
  }

  function formatMb(bytes) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function updateBackupReminderUI() {
    const dot = document.getElementById('backup-reminder-dot');
    if (!dot) return;
    const stats = S.getStorageStats();
    const { lastBackupAt, changesSinceBackup } = stats.meta;
    const hasData = state.scores.length > 0 || state.wrongNotes.length > 0;
    let daysSince = 0;
    if (lastBackupAt) {
      daysSince = Math.floor((Date.now() - new Date(lastBackupAt).getTime()) / (1000 * 60 * 60 * 24));
    }
    const shouldRemind = hasData && (changesSinceBackup >= 5 || (lastBackupAt && daysSince >= 7 && changesSinceBackup > 0) || (!lastBackupAt && changesSinceBackup >= 3));
    dot.classList.toggle('hidden', !shouldRemind);
  }

  function renderStorageStats() {
    const stats = S.getStorageStats();
    const lsTextEl = document.getElementById('ls-usage-text');
    const lsBarEl = document.getElementById('ls-usage-bar');
    const idbTextEl = document.getElementById('idb-usage-text');
    const backupTextEl = document.getElementById('backup-reminder-text');
    if (!lsTextEl) return;

    lsTextEl.textContent = `${formatMb(stats.localStorageBytes)} / ${formatMb(stats.localStorageLimitBytes)} (${stats.localStoragePct.toFixed(1)}%)`;
    lsBarEl.style.width = `${Math.max(2, Math.round(stats.localStoragePct))}%`;
    lsBarEl.classList.remove('warn', 'danger');
    if (stats.localStoragePct >= 80) {
      lsBarEl.classList.add('danger');
    } else if (stats.localStoragePct >= 55) {
      lsBarEl.classList.add('warn');
    }

    if (stats.idbAvailable) {
      idbTextEl.textContent = `이미지 저장소(IndexedDB): ${stats.imageCount}장 · ${formatMb(stats.imageBytes)}`;
    } else {
      idbTextEl.textContent = '이미지 저장소: IndexedDB 미지원 (LocalStorage 사용 중)';
    }

    const { lastBackupAt, changesSinceBackup } = stats.meta;
    if (lastBackupAt) {
      const dateStr = lastBackupAt.slice(0, 10);
      backupTextEl.textContent = `마지막 백업: ${dateStr} · 미백업 변경 ${changesSinceBackup}건`;
      backupTextEl.className = changesSinceBackup >= 5 ? 'small danger-text' : 'small muted';
    } else {
      backupTextEl.textContent = `백업 기록 없음 · 변경 ${changesSinceBackup}건`;
      backupTextEl.className = changesSinceBackup >= 3 ? 'small danger-text' : 'small muted';
    }
  }

  function noteDataChanged() {
    S.markDataChanged(1);
    updateBackupReminderUI();
  }

  function switchTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll('.nav-tab, .mobile-nav-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `tab-${tabName}`);
    });
    if (window.innerWidth <= 768) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (tabName === 'dashboard') {
      renderDashboard();
    } else if (tabName === 'analyzer') {
      renderWrongNotesList();
    } else if (tabName === 'report') {
      renderReport();
    } else if (tabName === 'review') {
      renderReviewTab();
    }
  }

  function matchesSubjectFilter(subject, filter) {
    if (filter === 'ALL') return true;
    if (filter === 'PSAT') return S.PSAT_IDS.includes(subject);
    return subject === filter;
  }

  // ==================== DASHBOARD ====================
  function getFilteredScores() {
    return state.scores
      .filter((s) => matchesSubjectFilter(s.subject, state.scoreFilter))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || ''));
  }

  function buildSessions(scores) {
    const map = new Map();
    scores.forEach((s) => {
      const key = `${s.date}||${s.examType}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          date: s.date,
          examType: s.examType,
          items: [],
          total: 0,
        });
      }
      const group = map.get(key);
      group.items.push(s);
      group.total += Number(s.score);
    });
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date) || a.examType.localeCompare(b.examType));
  }

  function renderDashboardKPIs(filtered) {
    const avgEl = document.getElementById('kpi-avg');
    const avgMeta = document.getElementById('kpi-avg-meta');
    const maxEl = document.getElementById('kpi-max');
    const maxMeta = document.getElementById('kpi-max-meta');
    const minEl = document.getElementById('kpi-min');
    const minMeta = document.getElementById('kpi-min-meta');
    const totalLabel = document.getElementById('kpi-total-label');
    const totalEl = document.getElementById('kpi-total');
    const totalMeta = document.getElementById('kpi-total-meta');

    if (filtered.length === 0) {
      avgEl.textContent = '-';
      avgMeta.textContent = '기록된 성적이 없습니다';
      maxEl.textContent = '-';
      maxMeta.textContent = '-';
      minEl.textContent = '-';
      minMeta.textContent = '-';
      totalEl.textContent = '-';
      totalMeta.textContent = '-';
      return;
    }

    const nums = filtered.map((s) => Number(s.score));
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    const maxItem = filtered.reduce((best, cur) => (cur.score > best.score ? cur : best), filtered[0]);
    const minItem = filtered.reduce((best, cur) => (cur.score < best.score ? cur : best), filtered[0]);

    const durations = filtered.map((s) => s.durationMinutes).filter((d) => typeof d === 'number' && d > 0);
    const avgDurText = durations.length > 0
      ? ` · 평균 ${(durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(0)}분`
      : '';

    avgEl.textContent = `${avg.toFixed(1)}점`;
    avgMeta.textContent = `총 ${filtered.length}개 성적 기록 평균${avgDurText}`;

    maxEl.textContent = `${Number(maxItem.score).toFixed(1)}점`;
    maxMeta.textContent = `${maxItem.subject} · ${maxItem.examType} (${maxItem.date})`;

    minEl.textContent = `${Number(minItem.score).toFixed(1)}점`;
    minMeta.textContent = `${minItem.subject} · ${minItem.examType} (${minItem.date})`;

    if (state.scoreFilter === 'ALL' || state.scoreFilter === 'PSAT') {
      const sessions = buildSessions(filtered);
      const bestSession = sessions.reduce((best, cur) => (cur.total > best.total ? cur : best), sessions[0]);
      const latestSession = sessions[sessions.length - 1];
      if (state.scoreFilter === 'PSAT') {
        totalLabel.textContent = 'PSAT 목표선 대비 평균';
        const diffTarget = avg - state.settings.psatTargetScore;
        const sign = diffTarget >= 0 ? '+' : '';
        totalEl.textContent = `${sign}${diffTarget.toFixed(1)}점`;
        totalMeta.textContent = `목표 ${state.settings.psatTargetScore}점 기준 · 최고 합산 ${bestSession.total.toFixed(1)}점`;
      } else {
        totalLabel.textContent = '회차 합산 최고 점수';
        totalEl.textContent = `${bestSession.total.toFixed(1)}점`;
        totalMeta.textContent = `최고: ${bestSession.examType} (${bestSession.items.length}과목) · 최근: ${latestSession.total.toFixed(1)}점`;
      }
    } else if (state.scoreFilter === '헌법') {
      totalLabel.textContent = '헌법 Pass 달성 현황 (60점↑)';
      const passCount = filtered.filter((s) => Number(s.score) >= 60).length;
      const latest = filtered[filtered.length - 1];
      totalEl.textContent = `${passCount} / ${filtered.length}회 Pass`;
      totalMeta.textContent = `최근 ${latest.score}점 (${latest.score >= 60 ? 'Pass' : '과락 주의'})`;
    } else {
      totalLabel.textContent = '최근 점수 & 직전 대비';
      const latest = filtered[filtered.length - 1];
      const prev = filtered.length > 1 ? filtered[filtered.length - 2] : null;
      totalEl.textContent = `${Number(latest.score).toFixed(1)}점`;
      if (prev) {
        const diff = latest.score - prev.score;
        const sign = diff > 0 ? '+' : '';
        totalMeta.textContent = `직전(${prev.examType}) 대비 ${sign}${diff.toFixed(1)}점`;
      } else {
        totalMeta.textContent = `${latest.examType} (${latest.date})`;
      }
    }
  }

  function getReferenceLinesForFilter() {
    const f = state.scoreFilter;
    const isDark = state.settings.theme === 'dark';
    const psatColor = isDark ? '#60a5fa' : '#2563eb';
    const passColor = isDark ? '#3dd5a3' : '#16805b';
    const secondColor = isDark ? '#f5b942' : '#d97706';

    if (f === 'PSAT') {
      if (state.chartMode === 'aggregate') {
        return [{ value: state.settings.psatTargetScore * 3, label: 'PSAT 3과목 목표 합산', color: psatColor }];
      }
      return [{ value: state.settings.psatTargetScore, label: 'PSAT 목표선', color: psatColor }];
    }
    if (S.PSAT_IDS.includes(f)) {
      return [{ value: state.settings.psatTargetScore, label: 'PSAT 목표선', color: psatColor }];
    }
    if (f === '헌법') {
      return [{ value: 60, label: '헌법 Pass 기준', color: passColor }];
    }
    if (f === '행정학' || f === '행정법') {
      return [{ value: state.settings.secondTargetScore, label: '2차 목표선', color: secondColor }];
    }
    return [];
  }

  function updateChartTargetControls() {
    const f = state.scoreFilter;
    const isPsat = f === 'PSAT' || S.PSAT_IDS.includes(f);
    const isConst = f === '헌법';
    const isSecond = f === '행정학' || f === '행정법';

    document.getElementById('target-psat-wrap').classList.toggle('hidden', !isPsat);
    document.getElementById('target-const-badge').classList.toggle('hidden', !isConst);
    document.getElementById('target-second-wrap').classList.toggle('hidden', !isSecond);

    document.getElementById('input-psat-target').value = state.settings.psatTargetScore;
    document.getElementById('input-second-target').value = state.settings.secondTargetScore;
  }

  function renderDashboardChart(filtered) {
    const chartContainer = document.getElementById('score-chart-container');
    const legendEl = document.getElementById('score-chart-legend');
    const modeToggle = document.getElementById('chart-mode-toggle');
    const titleEl = document.getElementById('score-chart-title');
    const subEl = document.getElementById('score-chart-subtitle');

    const isMultiSubjectFilter = state.scoreFilter === 'ALL' || state.scoreFilter === 'PSAT';
    modeToggle.classList.toggle('hidden', !isMultiSubjectFilter);
    updateChartTargetControls();

    const sessions = buildSessions(filtered);
    const xLabels = sessions.map((s) => s.date);
    const xSubLabels = sessions.map((s) => s.examType);
    const referenceLines = getReferenceLinesForFilter();

    if (isMultiSubjectFilter && state.chartMode === 'aggregate') {
      titleEl.textContent = state.scoreFilter === 'PSAT' ? 'PSAT 3과목 합산 추이' : '전체 과목 회차별 합산 추이';
      subEl.textContent = '같은 날짜·시험 종류의 점수를 합산하여 전체 성적 흐름을 확인합니다.';

      const series = [
        {
          id: 'TOTAL',
          label: state.scoreFilter === 'PSAT' ? 'PSAT 합산 점수' : '전체 과목 합산 점수',
          color: state.settings.theme === 'dark' ? '#6b93ff' : '#315efb',
          points: sessions.map((sess, idx) => ({
            xIndex: idx,
            xLabel: sess.date,
            subLabel: sess.examType,
            value: Math.round(sess.total * 10) / 10,
            meta: `${sess.items.length}과목 응시 (평균 ${(sess.total / sess.items.length).toFixed(1)}점)`,
          })),
        },
      ];

      C.renderLineChart(chartContainer, legendEl, {
        xLabels,
        xSubLabels,
        series,
        referenceLines,
        yUnit: '점',
        emptyMessage: '성적을 입력하면 회차별 합산 성적 그래프가 표시됩니다.',
      });
      return;
    }

    if (isMultiSubjectFilter && state.chartMode === 'average') {
      titleEl.textContent = state.scoreFilter === 'PSAT' ? 'PSAT 회차 평균 점수 추이' : '전체 과목 회차별 평균 추이';
      subEl.textContent = '회차별 평균 점수(0~100점)와 목표선 대비 추이를 확인합니다.';

      const series = [
        {
          id: 'AVG',
          label: state.scoreFilter === 'PSAT' ? 'PSAT 평균 점수' : '회차 평균 점수',
          color: state.settings.theme === 'dark' ? '#3dd5a3' : '#16805b',
          points: sessions.map((sess, idx) => ({
            xIndex: idx,
            xLabel: sess.date,
            subLabel: sess.examType,
            value: Math.round((sess.total / sess.items.length) * 10) / 10,
            meta: `${sess.items.length}과목 합산 ${sess.total.toFixed(1)}점`,
          })),
        },
      ];

      C.renderLineChart(chartContainer, legendEl, {
        xLabels,
        xSubLabels,
        series,
        referenceLines,
        yUnit: '점',
        fixedMax: 100,
        emptyMessage: '성적을 입력하면 회차별 평균 추이 그래프가 표시됩니다.',
      });
      return;
    }

    if (isMultiSubjectFilter && state.chartMode === 'compare') {
      titleEl.textContent = '과목별 성적 변화 비교 그래프';
      subEl.textContent = '범례를 클릭하면 특정 과목 선을 켜거나 끌 수 있습니다.';

      const targetSubjects = state.scoreFilter === 'PSAT'
        ? S.SUBJECTS.filter((s) => S.PSAT_IDS.includes(s.id))
        : S.SUBJECTS;

      const series = targetSubjects
        .map((subj) => {
          const pts = [];
          sessions.forEach((sess, idx) => {
            const match = sess.items.filter((it) => it.subject === subj.id);
            if (match.length > 0) {
              const avgVal = match.reduce((a, b) => a + Number(b.score), 0) / match.length;
              const lastMatch = match[match.length - 1];
              const durTxt = lastMatch.durationMinutes ? `${lastMatch.durationMinutes}분` : '';
              const metaTxt = [durTxt, lastMatch.memo].filter(Boolean).join(' · ');
              pts.push({
                xIndex: idx,
                xLabel: sess.date,
                subLabel: sess.examType,
                value: Math.round(avgVal * 10) / 10,
                meta: metaTxt,
              });
            }
          });
          return {
            id: subj.id,
            label: subj.label,
            color: S.getSubjectColor(subj.id, state.settings.theme),
            points: pts,
          };
        })
        .filter((s) => s.points.length > 0);

      C.renderLineChart(chartContainer, legendEl, {
        xLabels,
        xSubLabels,
        series,
        referenceLines,
        yUnit: '점',
        fixedMax: 100,
        emptyMessage: '성적을 입력하면 과목별 추이 그래프가 표시됩니다.',
      });
      return;
    }

    // Single Subject Mode
    titleEl.textContent = `${state.scoreFilter} 성적 추이 그래프`;
    subEl.textContent = `${state.scoreFilter} 과목의 날짜·시험별 점수 변화입니다.`;
    const subjColor = S.getSubjectColor(state.scoreFilter, state.settings.theme);

    const singleSeries = [
      {
        id: state.scoreFilter,
        label: state.scoreFilter,
        color: subjColor,
        points: filtered.map((item, idx) => {
          const durTxt = item.durationMinutes ? `소요 ${item.durationMinutes}분` : '';
          const metaTxt = [durTxt, item.memo].filter(Boolean).join(' · ');
          return {
            xIndex: idx,
            xLabel: item.date,
            subLabel: item.examType,
            value: Number(item.score),
            meta: metaTxt,
          };
        }),
      },
    ];

    C.renderLineChart(chartContainer, legendEl, {
      xLabels: filtered.map((i) => i.date),
      xSubLabels: filtered.map((i) => i.examType),
      series: singleSeries,
      referenceLines,
      yUnit: '점',
      fixedMax: 100,
      emptyMessage: `${state.scoreFilter} 성적을 입력하면 추이 그래프가 표시됩니다.`,
    });
  }

  function renderScoreTable(filtered) {
    const tbody = document.getElementById('score-table-body');
    const countEl = document.getElementById('score-table-count');
    const query = state.scoreSearch.trim().toLowerCase();

    const rows = [...filtered]
      .reverse()
      .filter((s) => {
        if (!query) return true;
        return (
          s.examType.toLowerCase().includes(query) ||
          s.subject.toLowerCase().includes(query) ||
          (s.memo || '').toLowerCase().includes(query) ||
          s.date.includes(query)
        );
      });

    countEl.textContent = String(rows.length);
    tbody.innerHTML = '';

    if (rows.length === 0) {
      const tr = document.createElement('tr');
      tr.className = 'score-empty-row';
      tr.innerHTML = `<td colspan="7" class="muted" style="text-align:center;padding:24px;">조건에 맞는 성적 기록이 없습니다.</td>`;
      tbody.appendChild(tr);
      return;
    }

    rows.forEach((item) => {
      const color = S.getSubjectColor(item.subject, state.settings.theme);
      const durText = item.durationMinutes ? `${item.durationMinutes}분` : '-';
      const hasDur = Boolean(item.durationMinutes);
      const hasMemo = Boolean(item.memo && item.memo.trim());
      const tr = document.createElement('tr');
      tr.className = 'score-row';
      tr.innerHTML = `
        <td class="td-date" data-label="날짜">${C.escapeHtml(item.date)}</td>
        <td class="td-exam" data-label="시험"><strong>${C.escapeHtml(item.examType)}</strong></td>
        <td class="td-subject" data-label="과목">
          <span class="subject-badge">
            <span class="subject-dot" style="background:${color}"></span>
            ${C.escapeHtml(item.subject)}
          </span>
        </td>
        <td class="td-score" data-label="점수"><strong>${Number(item.score).toFixed(1)}</strong><span class="score-unit">점</span></td>
        <td class="td-duration muted${hasDur ? '' : ' is-empty'}" data-label="소요">${C.escapeHtml(durText)}</td>
        <td class="td-memo muted${hasMemo ? '' : ' is-empty'}" data-label="메모">${C.escapeHtml(item.memo || '-')}</td>
        <td class="col-actions td-actions">
          <div class="table-actions">
            <button type="button" class="btn btn-ghost btn-sm btn-edit-score" data-id="${C.escapeHtml(item.id)}">수정</button>
            <button type="button" class="btn btn-ghost btn-sm danger-text btn-del-score" data-id="${C.escapeHtml(item.id)}">삭제</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderDashboard() {
    const filtered = getFilteredScores();
    renderDashboardKPIs(filtered);
    renderDashboardChart(filtered);
    renderScoreTable(filtered);
  }

  function resetScoreForm() {
    document.getElementById('score-edit-id').value = '';
    document.getElementById('score-form-mode').textContent = '신규 등록';
    document.getElementById('btn-save-score').textContent = '점수 저장';
    document.getElementById('btn-cancel-score-edit').classList.add('hidden');
    document.getElementById('score-value').value = '';
    document.getElementById('score-duration').value = '';
    document.getElementById('score-memo').value = '';
  }

  // ==================== WRONG PROBLEM ANALYZER ====================
  function setPendingImage(dataUrl) {
    state.pendingImageDataUrl = dataUrl;
    const placeholder = document.getElementById('dropzone-placeholder');
    const previewWrap = document.getElementById('dropzone-preview');
    const previewImg = document.getElementById('wrong-image-preview');
    if (dataUrl) {
      previewImg.src = dataUrl;
      placeholder.classList.add('hidden');
      previewWrap.classList.remove('hidden');
    } else {
      previewImg.src = '';
      placeholder.classList.remove('hidden');
      previewWrap.classList.add('hidden');
      document.getElementById('wrong-image-input').value = '';
    }
  }

  async function handleImageFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      showToast('이미지 파일만 업로드할 수 있습니다.', true);
      return;
    }
    try {
      const compressed = await S.compressImageFile(file);
      setPendingImage(compressed);
    } catch (err) {
      showToast(err.message || '이미지 처리에 실패했습니다.', true);
    }
  }

  function openNoteInEditor(noteId) {
    const note = state.wrongNotes.find((n) => n.id === noteId);
    if (!note) return;
    state.editingWrongId = note.id;
    state.editingTags = [...(note.tags || [])];

    document.getElementById('editor-empty').classList.add('hidden');
    document.getElementById('wrong-edit-form').classList.remove('hidden');
    document.getElementById('edit-wrong-id').value = note.id;
    document.getElementById('edit-subtopic').value = note.subtopic || '';
    document.getElementById('edit-qtype').value = note.questionType || '';
    document.getElementById('edit-weakness').value = note.weaknessPoint || '';
    document.getElementById('edit-tip').value = note.actionTip || '';
    document.getElementById('editor-badge').textContent = note.aiAnalyzed ? 'AI 분석됨 · 수정 가능' : '직접 입력';
    document.getElementById('editor-card-subtitle').textContent = `${note.subject} · ${note.examSource || note.date}`;

    renderEditorTags();
    document.getElementById('extraction-editor-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeEditor() {
    state.editingWrongId = null;
    state.editingTags = [];
    document.getElementById('editor-empty').classList.remove('hidden');
    document.getElementById('wrong-edit-form').classList.add('hidden');
    document.getElementById('editor-badge').textContent = '대기 중';
  }

  function renderEditorTags() {
    const list = document.getElementById('edit-tags-list');
    list.innerHTML = '';
    state.editingTags.forEach((tag, idx) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.innerHTML = `#${C.escapeHtml(tag)} <button type="button" data-idx="${idx}" aria-label="태그 삭제">&times;</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        state.editingTags.splice(idx, 1);
        renderEditorTags();
      });
      list.appendChild(chip);
    });
  }

  function addTagFromInput() {
    const input = document.getElementById('edit-tag-input');
    const raw = input.value.replace(/^#/, '').trim();
    if (!raw) return;
    raw
      .split(',')
      .map((t) => t.replace(/^#/, '').trim())
      .filter(Boolean)
      .forEach((tag) => {
        if (!state.editingTags.includes(tag)) {
          state.editingTags.push(tag);
        }
      });
    input.value = '';
    renderEditorTags();
  }

  function createWrongNoteCardElement(note, showJumpToEdit = false) {
    const color = S.getSubjectColor(note.subject, state.settings.theme);
    const card = document.createElement('div');
    card.className = 'note-card';

    const tagsHtml = (note.tags || [])
      .map((t) => `<span class="tag-chip">#${C.escapeHtml(t)}</span>`)
      .join('');

    const noteImageUrl = S.getNoteImageUrl(note);
    const imgHtml = noteImageUrl
      ? `<div><img class="note-thumb" src="${noteImageUrl}" alt="오답 문제 캡처" /></div>`
      : '';

    const questionHtml = note.questionText
      ? `<div class="note-question-preview">${C.escapeHtml(note.questionText)}</div>`
      : '';

    const choiceMemoParts = [];
    if (note.userChoice) choiceMemoParts.push(`선택 오답: ${C.escapeHtml(note.userChoice)}`);
    if (note.confusionReason) choiceMemoParts.push(`메모: ${C.escapeHtml(note.confusionReason)}`);

    const today = todayStr();
    let reviewBadgeHtml = '<span class="review-status-pill due">오늘 복습 예정</span>';
    if (note.reviewStatus === 'mastered') {
      reviewBadgeHtml = '<span class="review-status-pill mastered">마스터 완료</span>';
    } else if (!isNoteDueToday(note, today)) {
      reviewBadgeHtml = `<span class="review-status-pill">복습 ${note.reviewCount || 0}회 · 다음 ${C.escapeHtml(note.nextReviewDate)}</span>`;
    } else if (note.reviewCount > 0) {
      reviewBadgeHtml = `<span class="review-status-pill due">복습 ${note.reviewCount}회 · 오늘 예정</span>`;
    }

    card.innerHTML = `
      <div class="note-card-top">
        <div class="note-meta-left">
          <span class="subject-badge">
            <span class="subject-dot" style="background:${color}"></span>
            ${C.escapeHtml(note.subject)}
          </span>
          <span class="note-pill">${C.escapeHtml(note.subtopic || '미분류')}</span>
          <span class="note-pill type-pill">${C.escapeHtml(note.questionType || '기타')}</span>
          ${reviewBadgeHtml}
          <span class="muted small">${C.escapeHtml(note.date)}${note.examSource ? ' · ' + C.escapeHtml(note.examSource) : ''}</span>
        </div>
        <div class="table-actions">
          <button type="button" class="btn btn-ghost btn-sm btn-note-edit" data-id="${C.escapeHtml(note.id)}">${showJumpToEdit ? '수정/태그' : '편집'}</button>
          <button type="button" class="btn btn-ghost btn-sm danger-text btn-note-del" data-id="${C.escapeHtml(note.id)}">삭제</button>
        </div>
      </div>
      <div class="note-body">
        ${choiceMemoParts.length ? `<div class="small muted">${choiceMemoParts.join(' · ')}</div>` : ''}
        <div class="note-ai-box">
          <p><strong>핵심 약점:</strong> ${C.escapeHtml(note.weaknessPoint || '(입력 필요)')}</p>
          <p><strong>교정 팁:</strong> ${C.escapeHtml(note.actionTip || '(입력 필요)')}</p>
        </div>
        ${questionHtml}
        ${imgHtml}
        ${tagsHtml ? `<div class="tag-list">${tagsHtml}</div>` : ''}
      </div>
    `;

    const thumb = card.querySelector('.note-thumb');
    if (thumb && noteImageUrl) {
      thumb.addEventListener('click', () => {
        document.getElementById('lightbox-img').src = noteImageUrl;
        document.getElementById('modal-lightbox').classList.remove('hidden');
      });
    }

    card.querySelector('.btn-note-edit').addEventListener('click', () => {
      if (showJumpToEdit) {
        switchTab('analyzer');
      }
      openNoteInEditor(note.id);
    });

    card.querySelector('.btn-note-del').addEventListener('click', async () => {
      if (!confirm('이 오답 노트를 삭제할까요?')) return;
      state.wrongNotes = state.wrongNotes.filter((n) => n.id !== note.id);
      S.saveWrongNotes(state.wrongNotes);
      await S.deleteImage(note.id);
      noteDataChanged();
      updateReviewBadge();
      if (state.editingWrongId === note.id) closeEditor();
      renderWrongNotesList();
      if (state.activeTab === 'report') renderReport();
      if (state.activeTab === 'review') renderReviewTab();
      showToast('오답 노트를 삭제했습니다.');
    });

    return card;
  }

  function renderWrongNotesList() {
    const listEl = document.getElementById('wrong-notes-list');
    const countEl = document.getElementById('wrong-list-count');
    const query = state.wrongSearch.trim().toLowerCase();

    const filtered = [...state.wrongNotes]
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''))
      .filter((n) => {
        if (state.wrongFilterSubject !== 'ALL' && n.subject !== state.wrongFilterSubject) return false;
        if (!query) return true;
        const hay = [
          n.subject,
          n.examSource,
          n.subtopic,
          n.questionType,
          n.weaknessPoint,
          n.actionTip,
          n.questionText,
          n.confusionReason,
          ...(n.tags || []),
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(query);
      });

    countEl.textContent = String(filtered.length);
    listEl.innerHTML = '';

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="empty-inline">등록된 오답 노트가 없습니다. 왼쪽 양식에서 틀린 문제를 등록해 보세요.</div>';
      return;
    }

    filtered.forEach((note) => {
      listEl.appendChild(createWrongNoteCardElement(note, false));
    });
  }

  async function submitWrongNote({ useAi }) {
    const subject = document.getElementById('wrong-subject').value;
    const date = document.getElementById('wrong-date').value || todayStr();
    const examSource = document.getElementById('wrong-source').value.trim();
    const questionText = document.getElementById('wrong-text').value.trim();
    const userChoice = document.getElementById('wrong-choice').value.trim();
    const confusionReason = document.getElementById('wrong-reason').value.trim();
    const imageDataUrl = state.pendingImageDataUrl;
    const statusEl = document.getElementById('analyze-status');

    if (!questionText && !imageDataUrl) {
      showToast('문제 이미지 또는 문제 텍스트를 입력해 주세요.', true);
      return;
    }

    let analysis = {
      subtopic: `${subject}-미분류`,
      questionType: '직접입력',
      weaknessPoint: confusionReason || '오른쪽 편집 패널에서 핵심 약점 포인트를 정리해 주세요.',
      actionTip: '오른쪽 편집 패널에서 행동 교정 팁을 입력하고 저장하세요.',
      tags: [],
    };
    let aiAnalyzed = false;

    const btnAi = document.getElementById('btn-analyze-save');
    const btnManual = document.getElementById('btn-manual-save');

    if (useAi) {
      if (!state.settings.geminiApiKey || !state.settings.geminiApiKey.trim()) {
        statusEl.textContent = 'Gemini API Key가 필요합니다. 상단 [API 설정]을 확인하세요.';
        statusEl.className = 'status-text error';
        openSettingsModal(true);
        return;
      }

      btnAi.disabled = true;
      btnManual.disabled = true;
      const modelLabel = G.getModelLabel(state.settings.geminiModel);
      statusEl.textContent = `${modelLabel}로 오답 약점 분석 중...`;
      statusEl.className = 'status-text';

      try {
        const subjectSubtopics = Array.from(
          new Set(
            state.wrongNotes
              .filter((n) => n.subject === subject && n.subtopic)
              .map((n) => n.subtopic.trim())
          )
        );
        const otherSubtopics = Array.from(
          new Set(
            state.wrongNotes
              .filter((n) => n.subject !== subject && n.subtopic)
              .map((n) => n.subtopic.trim())
          )
        );
        const existingSubtopics = [...subjectSubtopics, ...otherSubtopics].slice(0, 40);

        analysis = await G.analyzeWrongProblem({
          apiKey: state.settings.geminiApiKey,
          model: state.settings.geminiModel,
          subject,
          examSource,
          questionText,
          imageDataUrl,
          userChoice,
          confusionReason,
          existingSubtopics,
        });
        aiAnalyzed = true;
        statusEl.textContent = 'AI 분석 및 저장 완료!';
        statusEl.className = 'status-text success';
      } catch (err) {
        statusEl.textContent = err.message || 'AI 분석 실패';
        statusEl.className = 'status-text error';
        showToast(err.message || 'AI 분석에 실패했습니다.', true);
        btnAi.disabled = false;
        btnManual.disabled = false;
        return;
      } finally {
        btnAi.disabled = false;
        btnManual.disabled = false;
      }
    } else {
      statusEl.textContent = '직접 입력으로 저장했습니다. 오른쪽에서 세부 내용을 다듬어 보세요.';
      statusEl.className = 'status-text success';
    }

    const now = new Date().toISOString();
    const noteId = S.generateId('wn');
    if (imageDataUrl) {
      await S.saveImage(noteId, imageDataUrl);
    }

    const newNote = {
      id: noteId,
      date,
      subject,
      examSource,
      questionText,
      hasImage: Boolean(imageDataUrl),
      userChoice,
      confusionReason,
      subtopic: analysis.subtopic,
      questionType: analysis.questionType,
      weaknessPoint: analysis.weaknessPoint,
      actionTip: analysis.actionTip,
      tags: analysis.tags,
      aiAnalyzed,
      reviewStatus: 'new',
      reviewCount: 0,
      nextReviewDate: date,
      lastReviewedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      state.wrongNotes.push(newNote);
      S.saveWrongNotes(state.wrongNotes);
      noteDataChanged();
    } catch (err) {
      state.wrongNotes.pop();
      if (imageDataUrl) await S.deleteImage(noteId);
      showToast(err.message, true);
      return;
    }

    // Reset inputs for next entry
    document.getElementById('wrong-source').value = '';
    document.getElementById('wrong-text').value = '';
    document.getElementById('wrong-choice').value = '';
    document.getElementById('wrong-reason').value = '';
    setPendingImage(null);

    updateReviewBadge();
    renderWrongNotesList();
    openNoteInEditor(newNote.id);
    showToast(aiAnalyzed ? 'AI 약점 분석 결과를 저장했습니다.' : '오답 노트를 저장했습니다.');
  }

  // ==================== CUMULATIVE WEAKNESS REPORT ====================
  function toggleDrilldown(type, value) {
    if (state.reportDrilldown && state.reportDrilldown.type === type && state.reportDrilldown.value === value) {
      state.reportDrilldown = null;
    } else {
      state.reportDrilldown = { type, value };
    }
    renderReport();
  }

  function renderReport() {
    const subjectNotes = state.wrongNotes.filter((n) => matchesSubjectFilter(n.subject, state.reportSubjectFilter));
    document.getElementById('report-total-notes').textContent = `${subjectNotes.length}건 누적`;

    // 1. Top 5 Subtopics
    const subtopicCounts = new Map();
    subjectNotes.forEach((n) => {
      const key = (n.subtopic || '미분류').trim();
      subtopicCounts.set(key, (subtopicCounts.get(key) || 0) + 1);
    });
    const topSubtopics = Array.from(subtopicCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5);

    const topContainer = document.getElementById('top-subtopics-container');
    topContainer.innerHTML = '';

    if (topSubtopics.length === 0) {
      topContainer.innerHTML = '<div class="empty-inline">해당 과목의 누적 오답 데이터가 아직 없습니다.</div>';
    } else {
      const maxCount = topSubtopics[0][1];
      topSubtopics.forEach(([subtopic, count], idx) => {
        const pct = ((count / subjectNotes.length) * 100).toFixed(1);
        const widthPct = Math.max(8, Math.round((count / maxCount) * 100));
        const isSelected = state.reportDrilldown?.type === 'subtopic' && state.reportDrilldown.value === subtopic;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `top-bar-item${isSelected ? ' selected' : ''}`;
        btn.innerHTML = `
          <div class="top-bar-row">
            <span>${idx + 1}. ${C.escapeHtml(subtopic)}</span>
            <span class="muted">${count}건 (${pct}%)</span>
          </div>
          <div class="top-bar-track">
            <div class="top-bar-fill" style="width:${widthPct}%"></div>
          </div>
        `;
        btn.addEventListener('click', () => toggleDrilldown('subtopic', subtopic));
        topContainer.appendChild(btn);
      });
    }

    // 2. Question Type Doughnut Chart
    const typeCounts = new Map();
    subjectNotes.forEach((n) => {
      const key = (n.questionType || '기타').trim();
      typeCounts.set(key, (typeCounts.get(key) || 0) + 1);
    });
    const typeItems = Array.from(typeCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label, count], idx) => ({
        key: label,
        label,
        count,
        color: C.PALETTE[idx % C.PALETTE.length],
      }));

    const selectedType = state.reportDrilldown?.type === 'questionType' ? state.reportDrilldown.value : null;
    C.renderDoughnutChart(
      document.getElementById('type-donut-container'),
      document.getElementById('type-donut-legend'),
      typeItems,
      selectedType,
      (key) => toggleDrilldown('questionType', key)
    );

    // 3. Tag Cloud
    const tagCounts = new Map();
    subjectNotes.forEach((n) => {
      (n.tags || []).forEach((tag) => {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      });
    });
    const sortedTags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const tagCloudEl = document.getElementById('report-tag-cloud');
    tagCloudEl.innerHTML = '';
    if (sortedTags.length === 0) {
      tagCloudEl.innerHTML = '<span class="muted small">등록된 약점 태그가 아직 없습니다.</span>';
    } else {
      sortedTags.forEach(([tag, count]) => {
        const isSelected = state.reportDrilldown?.type === 'tag' && state.reportDrilldown.value === tag;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `tag-filter-btn${isSelected ? ' selected' : ''}`;
        btn.textContent = `#${tag} (${count})`;
        btn.addEventListener('click', () => toggleDrilldown('tag', tag));
        tagCloudEl.appendChild(btn);
      });
    }

    // 4. Drill-down Filtered List
    let drilldownNotes = [...subjectNotes].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const chipEl = document.getElementById('active-drilldown-chip');
    const chipLabel = document.getElementById('active-drilldown-label');
    const resetBtn = document.getElementById('btn-reset-report-filter');

    if (state.reportDrilldown) {
      const { type, value } = state.reportDrilldown;
      const typeLabelMap = { subtopic: '단원', questionType: '유형', tag: '태그' };
      chipLabel.textContent = `${typeLabelMap[type]}: ${value}`;
      chipEl.classList.remove('hidden');
      resetBtn.classList.remove('hidden');

      drilldownNotes = drilldownNotes.filter((n) => {
        if (type === 'subtopic') return (n.subtopic || '미분류').trim() === value;
        if (type === 'questionType') return (n.questionType || '기타').trim() === value;
        if (type === 'tag') return Array.isArray(n.tags) && n.tags.includes(value);
        return true;
      });
    } else {
      chipEl.classList.add('hidden');
      resetBtn.classList.add('hidden');
    }

    document.getElementById('drilldown-count').textContent = String(drilldownNotes.length);
    const listEl = document.getElementById('report-drilldown-list');
    listEl.innerHTML = '';

    if (drilldownNotes.length === 0) {
      listEl.innerHTML = '<div class="empty-inline">선택한 조건에 해당하는 오답 노트가 없습니다.</div>';
    } else {
      drilldownNotes.forEach((note) => {
        listEl.appendChild(createWrongNoteCardElement(note, true));
      });
    }

    renderBriefingCard();
    renderMergePanel();
  }

  // ==================== SUBTOPIC MERGE TOOL ====================
  function renderMergePanel() {
    const panel = document.getElementById('subtopic-merge-panel');
    if (!panel) return;
    panel.classList.toggle('hidden', !state.mergePanelOpen);
    if (!state.mergePanelOpen) return;

    const subjectNotes = state.wrongNotes.filter((n) => matchesSubjectFilter(n.subject, state.reportSubjectFilter));
    const counts = new Map();
    subjectNotes.forEach((n) => {
      const key = (n.subtopic || '미분류').trim();
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const sourceListEl = document.getElementById('merge-source-list');
    const datalistEl = document.getElementById('merge-subtopic-datalist');
    sourceListEl.innerHTML = '';
    datalistEl.innerHTML = '';

    if (entries.length === 0) {
      sourceListEl.innerHTML = '<span class="small muted">병합할 세부 단원이 없습니다.</span>';
      return;
    }

    entries.forEach(([subtopic, cnt]) => {
      const label = document.createElement('label');
      label.className = 'merge-check-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = subtopic;
      cb.addEventListener('change', () => {
        const targetInp = document.getElementById('merge-target-subtopic');
        if (cb.checked && !targetInp.value.trim()) {
          targetInp.value = subtopic;
        }
      });
      const txt = document.createElement('span');
      txt.textContent = `${subtopic} (${cnt}건)`;
      label.appendChild(cb);
      label.appendChild(txt);
      sourceListEl.appendChild(label);

      const opt = document.createElement('option');
      opt.value = subtopic;
      datalistEl.appendChild(opt);
    });
  }

  function executeSubtopicMerge() {
    const checked = Array.from(document.querySelectorAll('#merge-source-list input[type="checkbox"]:checked')).map((el) => el.value);
    const targetName = document.getElementById('merge-target-subtopic').value.trim();

    if (checked.length === 0) {
      showToast('합칠 원본 단원을 1개 이상 선택해 주세요.', true);
      return;
    }
    if (!targetName) {
      showToast('통합할 목표 단원명을 입력하거나 선택해 주세요.', true);
      return;
    }

    const sourceSet = new Set(checked);
    const now = new Date().toISOString();
    let updatedCount = 0;

    state.wrongNotes.forEach((n) => {
      if (!matchesSubjectFilter(n.subject, state.reportSubjectFilter)) return;
      const cur = (n.subtopic || '미분류').trim();
      if (sourceSet.has(cur) && cur !== targetName) {
        n.subtopic = targetName;
        n.updatedAt = now;
        updatedCount++;
      }
    });

    if (updatedCount === 0) {
      showToast('변경된 오답 항목이 없습니다. 다른 단원을 선택하거나 새 이름을 입력하세요.', true);
      return;
    }

    S.saveWrongNotes(state.wrongNotes);
    noteDataChanged();

    if (state.reportDrilldown && state.reportDrilldown.type === 'subtopic' && sourceSet.has(state.reportDrilldown.value)) {
      state.reportDrilldown.value = targetName;
    }
    document.getElementById('merge-target-subtopic').value = '';
    state.mergePanelOpen = false;
    renderReport();
    renderWrongNotesList();
    if (state.activeTab === 'review') renderReviewTab();
    showToast(`${updatedCount}건의 오답 단원을 "${targetName}"(으)로 합쳤습니다.`);
  }

  // ==================== 1-PAGE EXAM BRIEFING ====================
  function getReportSubjectLabel() {
    if (state.reportSubjectFilter === 'ALL') return '전체 과목';
    if (state.reportSubjectFilter === 'PSAT') return 'PSAT 전체 (언·자·상)';
    return state.reportSubjectFilter;
  }

  function renderBriefingCard() {
    const bodyEl = document.getElementById('briefing-body');
    const printBtn = document.getElementById('btn-print-briefing');
    const statusEl = document.getElementById('briefing-status');
    const briefing = state.briefings[state.reportSubjectFilter];
    statusEl.textContent = '';

    if (!briefing) {
      printBtn.classList.add('hidden');
      bodyEl.innerHTML = `<div class="empty-inline">상단에서 과목(<strong>${C.escapeHtml(getReportSubjectLabel())}</strong>)을 고른 뒤 <strong>[AI 직전 브리핑 생성]</strong>을 누르면 시험장 직전용 1페이지 요약본이 여기에 생성됩니다.</div>`;
      return;
    }

    printBtn.classList.remove('hidden');
    const trapsHtml = (briefing.topTraps || [])
      .map(
        (trap, idx) => `
          <div class="trap-box">
            <div class="trap-box-title">${idx + 1}. ${C.escapeHtml(trap.name)}</div>
            <div class="trap-box-freq">${C.escapeHtml(trap.frequencyHint || '')}</div>
            <p>${C.escapeHtml(trap.description || '')}</p>
          </div>
        `
      )
      .join('');

    const checklistHtml = (briefing.examDayChecklist || [])
      .map((item) => `<li><input type="checkbox" /> <span>${C.escapeHtml(item)}</span></li>`)
      .join('');

    const generatedDate = briefing.generatedAt ? briefing.generatedAt.slice(0, 10) : '';

    bodyEl.innerHTML = `
      <div class="briefing-sheet">
        <div class="briefing-sheet-head">
          <div>
            <h4>${C.escapeHtml(briefing.title)}</h4>
            <span class="muted small">분석 기준: ${C.escapeHtml(getReportSubjectLabel())} 최근 오답 ${briefing.noteCount || 0}건 · ${C.escapeHtml(briefing.modelUsed || '')} · ${C.escapeHtml(generatedDate)}</span>
          </div>
        </div>
        <div class="briefing-mantra">시험지 여백 다짐: "${C.escapeHtml(briefing.mantra || '')}"</div>
        <div class="briefing-traps-grid">${trapsHtml}</div>
        <div class="briefing-two-col">
          <div class="briefing-subbox">
            <h5>시험 직전 3분 행동 수칙 체크리스트</h5>
            <ul class="briefing-checklist">${checklistHtml}</ul>
          </div>
          <div class="briefing-subbox">
            <h5>다음 1주 집중 보완 처방</h5>
            <p class="small" style="margin:0;line-height:1.65;">${C.escapeHtml(briefing.studyPrescription || '')}</p>
          </div>
        </div>
      </div>
    `;
  }

  async function handleGenerateBriefing() {
    const subjectNotes = state.wrongNotes.filter((n) => matchesSubjectFilter(n.subject, state.reportSubjectFilter));
    const statusEl = document.getElementById('briefing-status');
    const btn = document.getElementById('btn-generate-briefing');

    if (subjectNotes.length === 0) {
      showToast('선택한 과목에 누적된 오답이 없어 브리핑을 만들 수 없습니다.', true);
      return;
    }

    if (!state.settings.geminiApiKey || !state.settings.geminiApiKey.trim()) {
      statusEl.textContent = 'Gemini API Key가 필요합니다. 상단 [API 설정]을 확인하세요.';
      statusEl.className = 'status-text error';
      openSettingsModal(true);
      return;
    }

    btn.disabled = true;
    const modelLabel = G.getModelLabel(state.settings.geminiModel);
    statusEl.textContent = `${modelLabel}로 시험 직전 1페이지 약점 브리핑 생성 중...`;
    statusEl.className = 'status-text';

    try {
      const briefing = await G.generateWeaknessBriefing({
        apiKey: state.settings.geminiApiKey,
        model: state.settings.geminiModel,
        subjectLabel: getReportSubjectLabel(),
        notes: subjectNotes,
      });
      state.briefings[state.reportSubjectFilter] = briefing;
      S.saveBriefings(state.briefings);
      renderBriefingCard();
      statusEl.textContent = '시험 직전 1페이지 브리핑 생성 완료!';
      statusEl.className = 'status-text success';
      showToast('AI 직전 약점 브리핑을 생성했습니다.');
    } catch (err) {
      statusEl.textContent = err.message || '브리핑 생성 실패';
      statusEl.className = 'status-text error';
      showToast(err.message || '브리핑 생성에 실패했습니다.', true);
    } finally {
      btn.disabled = false;
    }
  }

  // ==================== TODAY'S REVIEW QUEUE (SPACED REPETITION) ====================
  function getReviewQueueNotes() {
    const today = todayStr();
    const subjectFiltered = state.wrongNotes.filter((n) => matchesSubjectFilter(n.subject, state.reviewSubjectFilter));
    let filtered;
    if (state.reviewMode === 'due') {
      filtered = subjectFiltered.filter((n) => isNoteDueToday(n, today));
    } else if (state.reviewMode === 'unmastered') {
      filtered = subjectFiltered.filter((n) => n.reviewStatus !== 'mastered');
    } else {
      filtered = [...subjectFiltered];
    }
    return filtered.sort((a, b) => (a.nextReviewDate || a.date || '').localeCompare(b.nextReviewDate || b.date || ''));
  }

  function renderReviewTab() {
    const today = todayStr();
    const subjectNotes = state.wrongNotes.filter((n) => matchesSubjectFilter(n.subject, state.reviewSubjectFilter));
    const dueCount = subjectNotes.filter((n) => isNoteDueToday(n, today)).length;
    const activeCount = subjectNotes.filter((n) => n.reviewStatus !== 'mastered').length;
    const masteredCount = subjectNotes.filter((n) => n.reviewStatus === 'mastered').length;

    document.getElementById('rev-kpi-due').textContent = `${dueCount}건`;
    document.getElementById('rev-kpi-active').textContent = `${activeCount}건`;
    document.getElementById('rev-kpi-mastered').textContent = `${masteredCount}건`;

    const queue = getReviewQueueNotes();
    document.getElementById('review-queue-count').textContent = String(queue.length);

    if (state.reviewIndex >= queue.length) {
      state.reviewIndex = Math.max(0, queue.length - 1);
    }

    const emptyEl = document.getElementById('review-empty-state');
    const activeEl = document.getElementById('review-active-card');
    const progressEl = document.getElementById('review-progress-badge');
    const subjBadgeEl = document.getElementById('review-subject-badge');
    const dateSrcEl = document.getElementById('review-date-source');

    if (queue.length === 0) {
      emptyEl.classList.remove('hidden');
      activeEl.classList.add('hidden');
      progressEl.textContent = '0 / 0';
      subjBadgeEl.innerHTML = '';
      dateSrcEl.textContent = '';
    } else {
      emptyEl.classList.add('hidden');
      activeEl.classList.remove('hidden');
      const current = queue[state.reviewIndex];
      const color = S.getSubjectColor(current.subject, state.settings.theme);

      progressEl.textContent = `${state.reviewIndex + 1} / ${queue.length}`;
      subjBadgeEl.innerHTML = `<span class="subject-badge"><span class="subject-dot" style="background:${color}"></span>${C.escapeHtml(current.subject)}</span>`;
      dateSrcEl.textContent = `${current.date}${current.examSource ? ' · ' + current.examSource : ''} · 복습 ${current.reviewCount || 0}회`;

      document.getElementById('review-question-text').textContent =
        current.questionText || '(텍스트 없이 이미지만 첨부된 문제입니다. 아래 이미지를 확인하세요.)';

      const imgWrap = document.getElementById('review-question-image-wrap');
      const imgEl = document.getElementById('review-question-image');
      const revImgUrl = S.getNoteImageUrl(current);
      if (revImgUrl) {
        imgEl.src = revImgUrl;
        imgWrap.classList.remove('hidden');
      } else {
        imgEl.src = '';
        imgWrap.classList.add('hidden');
      }

      // Curtain state
      document.getElementById('review-curtain').classList.toggle('hidden', state.reviewRevealed);
      document.getElementById('review-back').classList.toggle('hidden', !state.reviewRevealed);

      document.getElementById('review-subtopic').textContent = current.subtopic || '미분류';
      document.getElementById('review-qtype').textContent = current.questionType || '기타';
      const memoParts = [];
      if (current.userChoice) memoParts.push(`선택한 오답: ${current.userChoice}`);
      if (current.confusionReason) memoParts.push(`헷갈린 이유: ${current.confusionReason}`);
      document.getElementById('review-user-memo').textContent = memoParts.join(' · ') || '기록된 오답 선지 메모 없음';
      document.getElementById('review-weakness').textContent = current.weaknessPoint || '(미입력)';
      document.getElementById('review-tip').textContent = current.actionTip || '(미입력)';

      const tagsEl = document.getElementById('review-tags');
      tagsEl.innerHTML = (current.tags || []).map((t) => `<span class="tag-chip">#${C.escapeHtml(t)}</span>`).join('');
    }

    // Render queue list
    const queueEl = document.getElementById('review-queue-list');
    queueEl.innerHTML = '';
    if (queue.length === 0) {
      queueEl.innerHTML = '<div class="empty-inline">대기열이 비어 있습니다.</div>';
    } else {
      queue.forEach((item, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `review-queue-item${idx === state.reviewIndex ? ' current' : ''}`;
        const statusTxt = item.reviewStatus === 'mastered'
          ? '마스터'
          : isNoteDueToday(item, today)
          ? '오늘 예정'
          : `예정 ${item.nextReviewDate}`;
        btn.innerHTML = `
          <div class="review-queue-top">
            <span>${C.escapeHtml(item.subject)} · ${C.escapeHtml(item.subtopic || '미분류')}</span>
            <span class="muted">${C.escapeHtml(statusTxt)}</span>
          </div>
          <span class="small muted">${C.escapeHtml((item.questionText || item.examSource || '이미지 문제').slice(0, 44))}</span>
        `;
        btn.addEventListener('click', () => {
          state.reviewIndex = idx;
          state.reviewRevealed = false;
          renderReviewTab();
        });
        queueEl.appendChild(btn);
      });
    }
  }

  function gradeCurrentReview(grade) {
    const queue = getReviewQueueNotes();
    if (queue.length === 0) return;
    const current = queue[state.reviewIndex];
    const targetIdx = state.wrongNotes.findIndex((n) => n.id === current.id);
    if (targetIdx === -1) return;

    const today = todayStr();
    const note = { ...state.wrongNotes[targetIdx] };
    note.lastReviewedAt = new Date().toISOString();

    if (grade === 'again') {
      note.reviewStatus = 'reviewing';
      note.reviewCount = 0;
      note.nextReviewDate = addDays(today, 1);
      showToast('내일 다시 복습하도록 예약했습니다 (+1일).');
    } else if (grade === 'good') {
      const nextCount = (note.reviewCount || 0) + 1;
      const intervalDays = SPACED_INTERVALS[Math.min(nextCount - 1, SPACED_INTERVALS.length - 1)];
      note.reviewStatus = 'reviewing';
      note.reviewCount = nextCount;
      note.nextReviewDate = addDays(today, intervalDays);
      showToast(`${intervalDays}일 뒤(${note.nextReviewDate})에 다시 복습합니다.`);
    } else if (grade === 'master') {
      note.reviewStatus = 'mastered';
      note.reviewCount = (note.reviewCount || 0) + 1;
      note.nextReviewDate = addDays(today, 60);
      showToast('완전 해결(마스터) 처리했습니다!');
    }

    state.wrongNotes[targetIdx] = note;
    S.saveWrongNotes(state.wrongNotes);
    updateReviewBadge();
    state.reviewRevealed = false;
    if (state.reviewMode === 'all' || (state.reviewMode === 'unmastered' && grade !== 'master')) {
      state.reviewIndex = Math.min(state.reviewIndex + 1, Math.max(0, queue.length - 1));
    }
    renderReviewTab();
  }

  // ==================== EVENT WIRING ====================
  function initEvents() {
    // Tabs (Desktop & Mobile Bottom Nav)
    document.querySelectorAll('.nav-tab, .mobile-nav-tab').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Theme Toggle
    document.getElementById('btn-theme').addEventListener('click', () => {
      state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
      S.saveSettings(state.settings);
      applyTheme(state.settings.theme);
      if (state.activeTab === 'dashboard') renderDashboard();
      if (state.activeTab === 'report') renderReport();
    });

    // Modals open/close
    document.getElementById('btn-settings').addEventListener('click', () => {
      openSettingsModal(false);
    });

    document.getElementById('btn-backup').addEventListener('click', () => {
      document.getElementById('import-status').textContent = '';
      renderStorageStats();
      document.getElementById('modal-backup').classList.remove('hidden');
    });

    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById(btn.dataset.closeModal).classList.add('hidden');
      });
    });

    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) backdrop.classList.add('hidden');
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.add('hidden'));
      }
    });

    // Settings Modal actions
    document.getElementById('btn-toggle-key-vis').addEventListener('click', () => {
      const inp = document.getElementById('input-gemini-key');
      const btn = document.getElementById('btn-toggle-key-vis');
      if (inp.type === 'password') {
        inp.type = 'text';
        btn.textContent = '숨김';
      } else {
        inp.type = 'password';
        btn.textContent = '표시';
      }
    });

    document.getElementById('btn-save-key').addEventListener('click', () => {
      state.settings.geminiModel = document.getElementById('select-gemini-model').value || G.DEFAULT_MODEL;
      state.settings.geminiApiKey = document.getElementById('input-gemini-key').value.trim();
      S.saveSettings(state.settings);
      updateApiStatusUI();
      document.getElementById('modal-settings').classList.add('hidden');
      showToast(`${G.getModelLabel(state.settings.geminiModel)} 설정을 저장했습니다.`);
    });

    document.getElementById('btn-clear-key').addEventListener('click', () => {
      state.settings.geminiApiKey = '';
      S.saveSettings(state.settings);
      document.getElementById('input-gemini-key').value = '';
      updateApiStatusUI();
      showToast('저장된 API Key를 삭제했습니다.');
    });

    // Backup / Restore Modal actions
    document.getElementById('btn-export-json').addEventListener('click', () => {
      const content = S.exportJsonBackup(state.scores, state.wrongNotes, state.briefings);
      S.downloadTextFile(`exam-tracker-backup-${todayStr()}.json`, content, 'application/json;charset=utf-8');
      S.markBackupCompleted();
      updateBackupReminderUI();
      renderStorageStats();
      showToast('전체 JSON 백업 파일을 다운로드했습니다.');
    });

    document.getElementById('btn-export-scores-csv').addEventListener('click', () => {
      const content = S.exportScoresCsv(state.scores);
      S.downloadTextFile(`exam-scores-${todayStr()}.csv`, content, 'text/csv;charset=utf-8');
      showToast('성적 CSV 파일을 다운로드했습니다.');
    });

    document.getElementById('btn-export-wrong-csv').addEventListener('click', () => {
      const content = S.exportWrongNotesCsv(state.wrongNotes);
      S.downloadTextFile(`exam-wrong-notes-${todayStr()}.csv`, content, 'text/csv;charset=utf-8');
      showToast('오답 노트 CSV 파일을 다운로드했습니다.');
    });

    document.getElementById('btn-import-file').addEventListener('click', () => {
      document.getElementById('import-file-input').click();
    });

    document.getElementById('import-file-input').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const mode = document.querySelector('input[name="import-mode"]:checked')?.value || 'merge';
      const statusEl = document.getElementById('import-status');
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const result = S.importDataFromFileText(file.name, String(reader.result || ''), mode, state.scores, state.wrongNotes, state.briefings);
          if (mode === 'replace') {
            await S.clearAllImages();
          }
          if (Array.isArray(result.importedImages)) {
            for (const img of result.importedImages) {
              await S.saveImage(img.id, img.dataUrl);
            }
          }
          state.scores = result.scores;
          state.wrongNotes = result.wrongNotes;
          state.briefings = result.briefings || {};
          S.saveScores(state.scores);
          S.saveWrongNotes(state.wrongNotes);
          S.saveBriefings(state.briefings);
          updateReviewBadge();
          updateBackupReminderUI();
          renderStorageStats();
          statusEl.textContent = `복원 완료: 성적 ${result.addedScores}건, 오답 ${result.addedNotes}건 반영됨`;
          statusEl.className = 'status-text success';
          renderDashboard();
          renderWrongNotesList();
          renderReport();
          if (state.activeTab === 'review') renderReviewTab();
          showToast('파일에서 데이터를 성공적으로 불러왔습니다.');
        } catch (err) {
          statusEl.textContent = err.message || '파일 불러오기 실패';
          statusEl.className = 'status-text error';
          showToast(err.message || '파일을 읽을 수 없습니다.', true);
        } finally {
          e.target.value = '';
        }
      };
      reader.readAsText(file, 'utf-8');
    });

    document.getElementById('btn-load-sample').addEventListener('click', () => {
      const sample = S.getSampleData();
      const existingS = new Set(state.scores.map((s) => s.id));
      const existingW = new Set(state.wrongNotes.map((w) => w.id));
      sample.scores.forEach((s) => {
        if (!existingS.has(s.id)) state.scores.push(s);
      });
      sample.wrongNotes.forEach((w) => {
        if (!existingW.has(w.id)) state.wrongNotes.push(w);
      });
      S.saveScores(state.scores);
      S.saveWrongNotes(state.wrongNotes);
      updateReviewBadge();
      updateBackupReminderUI();
      renderStorageStats();
      renderDashboard();
      renderWrongNotesList();
      renderReport();
      if (state.activeTab === 'review') renderReviewTab();
      document.getElementById('modal-backup').classList.add('hidden');
      showToast('가상 성적 및 샘플 오답 데이터를 채웠습니다.');
    });

    document.getElementById('btn-clear-all').addEventListener('click', async () => {
      if (!confirm('저장된 모든 성적과 오답 데이터를 삭제할까요? (API Key는 유지됩니다)')) return;
      state.scores = [];
      state.wrongNotes = [];
      state.briefings = {};
      S.saveScores([]);
      S.saveWrongNotes([]);
      S.saveBriefings({});
      await S.clearAllImages();
      S.markBackupCompleted();
      updateReviewBadge();
      updateBackupReminderUI();
      renderStorageStats();
      closeEditor();
      renderDashboard();
      renderWrongNotesList();
      renderReport();
      if (state.activeTab === 'review') renderReviewTab();
      document.getElementById('modal-backup').classList.add('hidden');
      showToast('모든 학습 데이터를 초기화했습니다.');
    });

    // Dashboard filter pills
    document.getElementById('score-subject-filters').addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-pill');
      if (!btn) return;
      state.scoreFilter = btn.dataset.subject;
      document.querySelectorAll('#score-subject-filters .filter-pill').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      renderDashboard();
    });

    // Chart mode toggle
    document.getElementById('chart-mode-toggle').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      state.chartMode = btn.dataset.mode;
      document.querySelectorAll('#chart-mode-toggle .seg-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      renderDashboardChart(getFilteredScores());
    });

    // Target Score inline inputs
    document.getElementById('input-psat-target').addEventListener('change', (e) => {
      const val = Number(e.target.value);
      if (!Number.isNaN(val) && val >= 40 && val <= 100) {
        state.settings.psatTargetScore = Math.round(val * 10) / 10;
        S.saveSettings(state.settings);
        renderDashboard();
      }
    });
    document.getElementById('input-second-target').addEventListener('change', (e) => {
      const val = Number(e.target.value);
      if (!Number.isNaN(val) && val >= 40 && val <= 100) {
        state.settings.secondTargetScore = Math.round(val * 10) / 10;
        S.saveSettings(state.settings);
        renderDashboard();
      }
    });

    // Score search
    document.getElementById('score-search').addEventListener('input', (e) => {
      state.scoreSearch = e.target.value;
      renderScoreTable(getFilteredScores());
    });

    // Score Form submit
    document.getElementById('score-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const editId = document.getElementById('score-edit-id').value;
      const date = document.getElementById('score-date').value;
      const subject = document.getElementById('score-subject').value;
      const examType = document.getElementById('score-exam').value.trim();
      const scoreNum = Number(document.getElementById('score-value').value);
      const durVal = document.getElementById('score-duration').value.trim();
      const durationMinutes = durVal !== '' && !Number.isNaN(Number(durVal)) && Number(durVal) > 0 ? Math.round(Number(durVal)) : null;
      const memo = document.getElementById('score-memo').value.trim();

      if (!date || !examType || Number.isNaN(scoreNum) || scoreNum < 0 || scoreNum > 100) {
        showToast('날짜, 시험 종류, 0~100 사이의 점수를 정확히 입력해 주세요.', true);
        return;
      }

      const rounded = Math.round(scoreNum * 10) / 10;
      if (editId) {
        const idx = state.scores.findIndex((s) => s.id === editId);
        if (idx !== -1) {
          state.scores[idx] = { ...state.scores[idx], date, subject, examType, score: rounded, durationMinutes, memo };
        }
        showToast('성적 기록을 수정했습니다.');
      } else {
        state.scores.push({
          id: S.generateId('sc'),
          date,
          subject,
          examType,
          score: rounded,
          durationMinutes,
          memo,
          createdAt: new Date().toISOString(),
        });
        showToast(`${subject} ${rounded}점을 저장했습니다.`);
      }

      S.saveScores(state.scores);
      noteDataChanged();
      resetScoreForm();
      renderDashboard();
    });

    document.getElementById('btn-cancel-score-edit').addEventListener('click', resetScoreForm);

    // Score Table Edit / Delete delegation
    document.getElementById('score-table-body').addEventListener('click', (e) => {
      const editBtn = e.target.closest('.btn-edit-score');
      if (editBtn) {
        const item = state.scores.find((s) => s.id === editBtn.dataset.id);
        if (!item) return;
        document.getElementById('score-edit-id').value = item.id;
        document.getElementById('score-date').value = item.date;
        document.getElementById('score-subject').value = item.subject;
        document.getElementById('score-exam').value = item.examType;
        document.getElementById('score-value').value = item.score;
        document.getElementById('score-duration').value = item.durationMinutes || '';
        document.getElementById('score-memo').value = item.memo || '';
        document.getElementById('score-form-mode').textContent = '기록 수정 중';
        document.getElementById('btn-save-score').textContent = '수정 저장';
        document.getElementById('btn-cancel-score-edit').classList.remove('hidden');
        return;
      }

      const delBtn = e.target.closest('.btn-del-score');
      if (delBtn) {
        if (!confirm('이 성적 기록을 삭제할까요?')) return;
        state.scores = state.scores.filter((s) => s.id !== delBtn.dataset.id);
        S.saveScores(state.scores);
        noteDataChanged();
        if (document.getElementById('score-edit-id').value === delBtn.dataset.id) {
          resetScoreForm();
        }
        renderDashboard();
        showToast('성적 기록을 삭제했습니다.');
      }
    });

    // Image Dropzone
    const dropzone = document.getElementById('image-dropzone');
    const fileInput = document.getElementById('wrong-image-input');

    dropzone.addEventListener('click', (e) => {
      if (e.target.id === 'btn-remove-image') return;
      fileInput.click();
    });
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleImageFile(file);
    });
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) handleImageFile(file);
    });
    document.getElementById('btn-remove-image').addEventListener('click', (e) => {
      e.stopPropagation();
      setPendingImage(null);
      const camInp = document.getElementById('wrong-camera-input');
      if (camInp) camInp.value = '';
    });

    // Mobile direct camera capture
    const mobileCamBtn = document.getElementById('btn-mobile-camera');
    const mobileCamInput = document.getElementById('wrong-camera-input');
    if (mobileCamBtn && mobileCamInput) {
      mobileCamBtn.addEventListener('click', () => mobileCamInput.click());
      mobileCamInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) handleImageFile(file);
      });
    }

    // Clipboard image paste support when on Analyzer tab
    document.addEventListener('paste', (e) => {
      if (state.activeTab !== 'analyzer') return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleImageFile(file);
            showToast('클립보드 캡처 이미지를 불러왔습니다.');
            break;
          }
        }
      }
    });

    // Wrong note submission
    document.getElementById('wrong-form').addEventListener('submit', (e) => {
      e.preventDefault();
      submitWrongNote({ useAi: true });
    });

    document.getElementById('btn-manual-save').addEventListener('click', () => {
      submitWrongNote({ useAi: false });
    });

    // Editor form & tags
    document.getElementById('btn-add-tag').addEventListener('click', addTagFromInput);
    document.getElementById('edit-tag-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTagFromInput();
      }
    });

    document.getElementById('wrong-edit-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const id = document.getElementById('edit-wrong-id').value;
      const idx = state.wrongNotes.findIndex((n) => n.id === id);
      if (idx === -1) return;

      // Also flush any unadded tag text
      addTagFromInput();

      state.wrongNotes[idx] = {
        ...state.wrongNotes[idx],
        subtopic: document.getElementById('edit-subtopic').value.trim() || '미분류',
        questionType: document.getElementById('edit-qtype').value.trim() || '기타',
        weaknessPoint: document.getElementById('edit-weakness').value.trim(),
        actionTip: document.getElementById('edit-tip').value.trim(),
        tags: [...state.editingTags],
        updatedAt: new Date().toISOString(),
      };
      S.saveWrongNotes(state.wrongNotes);
      noteDataChanged();
      renderWrongNotesList();
      if (state.activeTab === 'report') renderReport();
      showToast('오답 분석 및 태그 수정 내용을 저장했습니다.');
    });

    document.getElementById('btn-close-editor').addEventListener('click', closeEditor);

    // Wrong list filters
    document.getElementById('wrong-filter-subject').addEventListener('change', (e) => {
      state.wrongFilterSubject = e.target.value;
      renderWrongNotesList();
    });
    document.getElementById('wrong-search').addEventListener('input', (e) => {
      state.wrongSearch = e.target.value;
      renderWrongNotesList();
    });

    // Report filters
    document.getElementById('report-subject-filters').addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-pill');
      if (!btn) return;
      state.reportSubjectFilter = btn.dataset.subject;
      state.reportDrilldown = null;
      document.querySelectorAll('#report-subject-filters .filter-pill').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      renderReport();
    });

    document.getElementById('btn-clear-drilldown').addEventListener('click', () => {
      state.reportDrilldown = null;
      renderReport();
    });
    document.getElementById('btn-reset-report-filter').addEventListener('click', () => {
      state.reportDrilldown = null;
      renderReport();
    });

    // Briefing actions
    document.getElementById('btn-generate-briefing').addEventListener('click', handleGenerateBriefing);
    document.getElementById('btn-print-briefing').addEventListener('click', () => {
      window.print();
    });

    // Subtopic merge panel actions
    document.getElementById('btn-toggle-subtopic-merge').addEventListener('click', () => {
      state.mergePanelOpen = !state.mergePanelOpen;
      renderMergePanel();
    });
    document.getElementById('btn-cancel-subtopic-merge').addEventListener('click', () => {
      state.mergePanelOpen = false;
      renderMergePanel();
    });
    document.getElementById('btn-execute-subtopic-merge').addEventListener('click', executeSubtopicMerge);

    // Review tab filters & flashcard actions
    document.getElementById('review-subject-filters').addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-pill');
      if (!btn) return;
      state.reviewSubjectFilter = btn.dataset.subject;
      state.reviewIndex = 0;
      state.reviewRevealed = false;
      document.querySelectorAll('#review-subject-filters .filter-pill').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      renderReviewTab();
    });

    document.getElementById('review-mode-toggle').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      state.reviewMode = btn.dataset.mode;
      state.reviewIndex = 0;
      state.reviewRevealed = false;
      document.querySelectorAll('#review-mode-toggle .seg-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      renderReviewTab();
    });

    document.getElementById('btn-reveal-answer').addEventListener('click', () => {
      state.reviewRevealed = true;
      renderReviewTab();
    });

    document.getElementById('review-question-image').addEventListener('click', (e) => {
      if (!e.target.src) return;
      document.getElementById('lightbox-img').src = e.target.src;
      document.getElementById('modal-lightbox').classList.remove('hidden');
    });

    document.getElementById('btn-review-prev').addEventListener('click', () => {
      const queue = getReviewQueueNotes();
      if (queue.length === 0) return;
      state.reviewIndex = (state.reviewIndex - 1 + queue.length) % queue.length;
      state.reviewRevealed = false;
      renderReviewTab();
    });

    document.getElementById('btn-review-next').addEventListener('click', () => {
      const queue = getReviewQueueNotes();
      if (queue.length === 0) return;
      state.reviewIndex = (state.reviewIndex + 1) % queue.length;
      state.reviewRevealed = false;
      renderReviewTab();
    });

    document.getElementById('btn-grade-again').addEventListener('click', () => gradeCurrentReview('again'));
    document.getElementById('btn-grade-good').addEventListener('click', () => gradeCurrentReview('good'));
    document.getElementById('btn-grade-master').addEventListener('click', () => gradeCurrentReview('master'));

    // Responsive chart redraw on resize
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (state.activeTab === 'dashboard') {
          renderDashboardChart(getFilteredScores());
        }
      }, 150);
    });
  }

  async function init() {
    applyTheme(state.settings.theme);
    updateApiStatusUI();
    updateReviewBadge();
    updateBackupReminderUI();
    document.getElementById('score-date').value = todayStr();
    document.getElementById('wrong-date').value = todayStr();
    initEvents();
    renderDashboard();
    renderWrongNotesList();
    renderReport();
    renderReviewTab();

    // Hydrate and migrate images into IndexedDB
    await S.hydrateAllImages(state.wrongNotes);
    updateBackupReminderUI();
    renderWrongNotesList();
    renderReport();
    renderReviewTab();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
