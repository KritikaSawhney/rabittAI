/* ─────────────────────────────────────────────────────────────────────────────
   Talking Rabbitt — App Logic
   Local NLP Analytics Engine (no API key needed) + optional Gemini fallback
───────────────────────────────────────────────────────────────────────────── */

const API_BASE = window.location.origin;

/* ── STATE ──────────────────────────────────────────────────────────────────── */
let appState = {
  records: null, headers: [], stats: {},
  fileName: '', rowCount: 0,
  chartInstance: null, currentChartData: null,
  sessionApiKey: null, isQuerying: false
};

/* ── DOM REFS ────────────────────────────────────────────────────────────────── */
const uploadZone     = document.getElementById('uploadZone');
const uploadInner    = document.getElementById('uploadInner');
const fileInput      = document.getElementById('fileInput');
const loadSampleBtn  = document.getElementById('loadSampleBtn');
const dataCard       = document.getElementById('dataCard');
const dataFileName   = document.getElementById('dataFileName');
const statRows       = document.getElementById('statRows');
const statCols       = document.getElementById('statCols');
const columnsList    = document.getElementById('columnsList');
const chartContainer  = document.getElementById('chartContainer');
const chartPlaceholder= document.getElementById('chartPlaceholder');
const mainChartCanvas = document.getElementById('mainChart');
const chartToolbar   = document.getElementById('chartToolbar');
const chartMeta      = document.getElementById('chartMeta');
const chartMetaTitle = document.getElementById('chartMetaTitle');
const chatWindow     = document.getElementById('chatWindow');
const chatInput      = document.getElementById('chatInput');
const sendBtn        = document.getElementById('sendBtn');
const statusBadge    = document.getElementById('statusBadge');
const apiBadge       = document.getElementById('apiBadge');
const apiKeyLink     = document.getElementById('apiKeyLink');
const downloadChartBtn = document.getElementById('downloadChartBtn');

/* ── SAMPLE CSV ──────────────────────────────────────────────────────────────── */
const SAMPLE_CSV = `Order ID,Region,Product,Category,Sales Rep,Month,Revenue,Units Sold,Cost,Profit
1001,North,Laptop Pro,Electronics,Alice,January,85000,12,60000,25000
1002,South,Wireless Mouse,Electronics,Bob,January,12000,240,6000,6000
1003,East,Office Chair,Furniture,Carol,January,45000,30,28000,17000
1004,West,Monitor 4K,Electronics,Dave,January,62000,40,38000,24000
1005,North,Desk Lamp,Furniture,Alice,January,8500,170,4000,4500
1006,South,Laptop Pro,Electronics,Eve,February,91000,13,65000,26000
1007,East,Keyboard,Electronics,Frank,February,15000,300,7500,7500
1008,West,Office Chair,Furniture,Grace,February,52000,35,32000,20000
1009,North,Monitor 4K,Electronics,Alice,February,58000,38,35000,23000
1010,South,Desk Lamp,Furniture,Bob,February,9200,184,4300,4900
1011,East,Laptop Pro,Electronics,Carol,March,97000,14,68000,29000
1012,West,Wireless Mouse,Electronics,Dave,March,14000,280,7000,7000
1013,North,Office Chair,Furniture,Alice,March,48000,32,29500,18500
1014,South,Monitor 4K,Electronics,Eve,March,71000,46,43000,28000
1015,East,Desk Lamp,Furniture,Frank,March,7800,156,3700,4100
1016,West,Laptop Pro,Electronics,Grace,April,88000,12,62000,26000
1017,North,Keyboard,Electronics,Alice,April,16500,330,8000,8500
1018,South,Office Chair,Furniture,Bob,April,55000,38,33000,22000
1019,East,Monitor 4K,Electronics,Carol,April,64000,42,39000,25000
1020,West,Wireless Mouse,Electronics,Dave,April,13500,270,6700,6800
1021,North,Laptop Pro,Electronics,Alice,May,93000,13,66000,27000
1022,South,Desk Lamp,Furniture,Eve,May,10200,204,4800,5400
1023,East,Keyboard,Electronics,Frank,May,17000,340,8200,8800
1024,West,Office Chair,Furniture,Grace,May,60000,40,36500,23500
1025,North,Monitor 4K,Electronics,Alice,May,67000,44,41000,26000
1026,South,Laptop Pro,Electronics,Bob,June,102000,15,72000,30000
1027,East,Wireless Mouse,Electronics,Carol,June,16000,320,8000,8000
1028,West,Office Chair,Furniture,Dave,June,58000,39,35000,23000
1029,North,Desk Lamp,Furniture,Alice,June,9500,190,4500,5000
1030,South,Monitor 4K,Electronics,Eve,June,75000,50,46000,29000`;

/* ── UTILS ───────────────────────────────────────────────────────────────────── */
function showToast(message, type = 'info', duration = 3000) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}
function setStatus(text, type = 'ready') {
  statusBadge.textContent = `● ${text}`;
  statusBadge.style.color = type === 'ready' ? 'var(--green)' : type === 'loading' ? 'var(--orange)' : 'var(--red)';
}
function formatNum(n) {
  if (isNaN(n)) return n;
  if (Math.abs(n) >= 1e7) return (n/1e7).toFixed(2) + 'Cr';
  if (Math.abs(n) >= 1e5) return (n/1e5).toFixed(2) + 'L';
  if (Math.abs(n) >= 1000) return (n/1000).toFixed(1) + 'K';
  return n.toLocaleString('en-IN', {maximumFractionDigits: 2});
}
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ══════════════════════════════════════════════════════════════════════════════
   LOCAL NLP ANALYTICS ENGINE — answers questions directly from CSV data
══════════════════════════════════════════════════════════════════════════════ */

/** Fuzzy-find which column header best matches a keyword */
function findColumn(keyword, headers) {
  if (!keyword) return null;
  const kw = keyword.toLowerCase().replace(/[^a-z0-9]/g,' ').trim();
  // Exact match first
  let match = headers.find(h => h.toLowerCase() === kw);
  if (match) return match;
  // Partial match
  match = headers.find(h => h.toLowerCase().includes(kw) || kw.includes(h.toLowerCase()));
  if (match) return match;
  // Word-level match
  const kwWords = kw.split(/\s+/);
  match = headers.find(h => {
    const hw = h.toLowerCase().split(/[_\s]+/);
    return kwWords.some(w => hw.some(hw2 => hw2.startsWith(w) || w.startsWith(hw2)));
  });
  return match || null;
}

/** Identify numeric columns */
function numericCols(stats) {
  return Object.entries(stats).filter(([,v]) => v.type === 'numeric').map(([k]) => k);
}
/** Identify categorical columns */
function catCols(stats) {
  return Object.entries(stats).filter(([,v]) => v.type === 'categorical').map(([k]) => k);
}

/** Aggregate: group records by catCol, sum/avg/count numCol */
function aggregate(records, catCol, numCol, method = 'sum') {
  const agg = {};
  records.forEach(r => {
    const key = String(r[catCol] ?? 'Unknown');
    const val = parseFloat(r[numCol]) || 0;
    if (!agg[key]) agg[key] = { sum: 0, count: 0 };
    agg[key].sum += val;
    agg[key].count += 1;
  });
  return Object.entries(agg).map(([k, v]) => ({
    label: k,
    value: method === 'avg' ? v.sum / v.count : method === 'count' ? v.count : v.sum
  })).sort((a, b) => b.value - a.value);
}

/** Main NLP engine — parses question and returns {answer, labels, values, chartType, chartTitle} */
function localAnalytics(question, records, headers, stats) {
  const q = question.toLowerCase();

  const nums = numericCols(stats);
  const cats = catCols(stats);

  // ── Intent detection ──────────────────────────────────────────────────────
  const isTotal   = /\b(total|sum|overall|combined|aggregate)\b/.test(q);
  const isAvg     = /\b(average|avg|mean|per)\b/.test(q);
  const isMax     = /\b(highest|most|top|maximum|max|best|largest|greatest|leader|leading)\b/.test(q);
  const isMin     = /\b(lowest|least|minimum|min|worst|smallest|bottom|fewest)\b/.test(q);
  const isTrend   = /\b(trend|over time|growth|change|progress|month|quarter|year|period)\b/.test(q);
  const isCount   = /\b(count|how many|number of|frequency)\b/.test(q);
  const isCompare = /\b(compare|vs|versus|difference|between|breakdown)\b/.test(q);
  const isTop     = /\btop\s*(\d+)\b/.exec(q);
  const topN      = isTop ? parseInt(isTop[1]) : null;
  const isAll     = /\beach|every|all|each|list|show\b/.test(q);

  // ── Column detection ──────────────────────────────────────────────────────
  // Try to find which numeric column is mentioned
  let numCol = null;
  for (const col of nums) {
    const words = col.toLowerCase().replace(/_/g,' ');
    if (q.includes(words) || words.split(' ').some(w => q.includes(w))) { numCol = col; break; }
  }
  if (!numCol && nums.length > 0) numCol = nums[0]; // fallback to first numeric

  // Try to find which categorical column to group by
  let catCol = null;
  // Look for "by X", "per X", "for each X", "for X"
  const byMatch = /\b(?:by|per|for each|for|across|each)\s+([a-z_\s]+?)(?:\s*\?|$|\s+in\b|\s+and\b|\s+with\b)/.exec(q);
  if (byMatch) {
    catCol = findColumn(byMatch[1].trim(), headers);
  }
  // If not found, look for any cat column keyword in the question
  if (!catCol) {
    for (const col of cats) {
      const words = col.toLowerCase().replace(/_/g,' ');
      if (q.includes(words) || words.split(' ').some(w => w.length > 3 && q.includes(w))) {
        catCol = col; break;
      }
    }
  }

  // Try to find trend/time column
  let timeCol = null;
  if (isTrend) {
    const timeCandidates = ['quarter','month','year','date','period','week','time'];
    for (const tc of timeCandidates) {
      timeCol = findColumn(tc, headers);
      if (timeCol) break;
    }
    if (!timeCol && cats.length > 0) timeCol = cats[cats.length - 1]; // last cat col usually time
  }

  // ── Answer generation ─────────────────────────────────────────────────────
  let answer = '';
  let labels = [];
  let values = [];
  let chartType = 'bar';
  let chartTitle = '';

  // TREND ANALYSIS
  if (isTrend && timeCol && numCol) {
    const grouped = aggregate(records, timeCol, numCol, 'sum');
    // Try to keep chronological order
    const order = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec','q1','q2','q3','q4'];
    grouped.sort((a,b) => {
      const ai = order.findIndex(o => a.label.toLowerCase().startsWith(o));
      const bi = order.findIndex(o => b.label.toLowerCase().startsWith(o));
      if (ai !== -1 && bi !== -1) return ai - bi;
      return a.label.localeCompare(b.label);
    });
    labels = grouped.map(g => g.label);
    values = grouped.map(g => Math.round(g.value));
    chartType = 'line';
    chartTitle = `${numCol} Trend by ${timeCol}`;
    const peak = grouped.reduce((a,b) => a.value > b.value ? a : b);
    answer = `📈 <strong>${numCol} Trend by ${timeCol}:</strong><br/><br/>`;
    grouped.forEach(g => { answer += `• <strong>${g.label}</strong>: ${formatNum(g.value)}<br/>`; });
    answer += `<br/>📌 Peak: <strong>${peak.label}</strong> with ${formatNum(peak.value)}`;
  }

  // GROUP BY (total/sum/avg X by Y)
  else if (catCol && numCol && !isCount) {
    const method = isAvg ? 'avg' : 'sum';
    const methodLabel = isAvg ? 'Average' : 'Total';
    const grouped = aggregate(records, catCol, numCol, method);
    const display = topN ? grouped.slice(0, topN) : (isMax ? [grouped[0]] : (isMin ? [grouped[grouped.length-1]] : grouped));
    labels = display.map(g => g.label);
    values = display.map(g => Math.round(g.value * 100) / 100);
    chartType = display.length <= 5 ? 'bar' : 'bar';
    chartTitle = `${methodLabel} ${numCol} by ${catCol}`;

    if (isMax && !topN) {
      const winner = grouped[0];
      answer = `🏆 <strong>Highest ${numCol}</strong> is from <strong>${winner.label}</strong> with <strong>${formatNum(winner.value)}</strong>.<br/><br/>`;
      answer += `Full breakdown:<br/>`;
      grouped.forEach((g,i) => { answer += `${i+1}. <strong>${g.label}</strong>: ${formatNum(g.value)}<br/>`; });
    } else if (isMin && !topN) {
      const loser = grouped[grouped.length-1];
      answer = `📉 <strong>Lowest ${numCol}</strong> is from <strong>${loser.label}</strong> with <strong>${formatNum(loser.value)}</strong>.<br/><br/>`;
      grouped.forEach((g,i) => { answer += `${i+1}. <strong>${g.label}</strong>: ${formatNum(g.value)}<br/>`; });
    } else {
      answer = `📊 <strong>${methodLabel} ${numCol} by ${catCol}:</strong><br/><br/>`;
      display.forEach((g,i) => { answer += `${i+1}. <strong>${g.label}</strong>: ${formatNum(g.value)}<br/>`; });
      const total = grouped.reduce((s,g) => s + g.value, 0);
      if (!isAvg) answer += `<br/>📌 Grand Total: <strong>${formatNum(total)}</strong>`;
    }
  }

  // COUNT by category
  else if (isCount && catCol) {
    const grouped = aggregate(records, catCol, catCol, 'count');
    labels = grouped.map(g => g.label);
    values = grouped.map(g => g.value);
    chartType = 'bar';
    chartTitle = `Count by ${catCol}`;
    answer = `🔢 <strong>Count by ${catCol}:</strong><br/><br/>`;
    grouped.forEach((g,i) => { answer += `${i+1}. <strong>${g.label}</strong>: ${g.value} records<br/>`; });
    answer += `<br/>📌 Total records: <strong>${records.length}</strong>`;
  }

  // SINGLE NUMERIC — overall stats
  else if (numCol && !catCol) {
    const s = stats[numCol];
    const col2 = cats[0];
    if (col2 && !isCount) {
      // Default: aggregate by first cat column
      const grouped = aggregate(records, col2, numCol, 'sum');
      labels = grouped.map(g => g.label);
      values = grouped.map(g => Math.round(g.value));
      chartType = 'bar';
      chartTitle = `Total ${numCol} by ${col2}`;
      answer = `📊 <strong>${numCol} Summary:</strong><br/><br/>`;
      grouped.forEach((g,i) => { answer += `${i+1}. <strong>${g.label}</strong>: ${formatNum(g.value)}<br/>`; });
      if (s) answer += `<br/>📌 Overall Total: <strong>${formatNum(s.sum)}</strong> | Average: <strong>${formatNum(s.avg)}</strong>`;
    } else if (s) {
      answer = `📊 <strong>${numCol} Statistics:</strong><br/><br/>
      • Total: <strong>${formatNum(s.sum)}</strong><br/>
      • Average: <strong>${formatNum(s.avg)}</strong><br/>
      • Highest: <strong>${formatNum(s.max)}</strong><br/>
      • Lowest: <strong>${formatNum(s.min)}</strong><br/>
      • Records: <strong>${s.count}</strong>`;
      labels = ['Total','Average','Max','Min'];
      values = [s.sum, s.avg, s.max, s.min].map(v => Math.round(v*100)/100);
      chartType = 'bar';
      chartTitle = `${numCol} Overview`;
    }
  }

  // OVERVIEW / GENERAL
  else {
    // Give a smart dataset summary
    const mainCat = cats[0];
    const mainNum = nums[0];
    if (mainCat && mainNum) {
      const grouped = aggregate(records, mainCat, mainNum, 'sum');
      labels = grouped.map(g => g.label);
      values = grouped.map(g => Math.round(g.value));
      chartType = 'bar';
      chartTitle = `${mainNum} by ${mainCat}`;
      const top = grouped[0];
      const total = grouped.reduce((s,g) => s+g.value, 0);
      answer = `📋 <strong>Dataset Overview</strong><br/><br/>
      • <strong>${records.length}</strong> records across <strong>${headers.length}</strong> columns<br/>
      • Columns: ${headers.map(h => `<em>${h}</em>`).join(', ')}<br/><br/>
      <strong>Top ${mainCat} by ${mainNum}:</strong><br/>`;
      grouped.slice(0,5).forEach((g,i) => { answer += `${i+1}. <strong>${g.label}</strong>: ${formatNum(g.value)}<br/>`; });
      answer += `<br/>📌 Grand Total ${mainNum}: <strong>${formatNum(total)}</strong>`;
    } else {
      answer = `📋 Your dataset has <strong>${records.length} rows</strong> and <strong>${headers.length} columns</strong>: ${headers.map(h=>`<em>${h}</em>`).join(', ')}.<br/><br/>Try asking:<br/>• "Total revenue by region"<br/>• "Which product has the highest sales?"<br/>• "Show me average units by quarter"`;
    }
  }

  return { answer, labels, values, chartType, chartTitle };
}

/* ══════════════════════════════════════════════════════════════════════════════
   CHART.JS RENDER
══════════════════════════════════════════════════════════════════════════════ */
const CHART_COLORS = ['#6366f1','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#3b82f6','#84cc16','#f97316'];

function renderChart(type, title, labels, values) {
  if (appState.chartInstance) { appState.chartInstance.destroy(); appState.chartInstance = null; }
  if (!labels || !labels.length) return;

  chartPlaceholder.style.display = 'none';
  mainChartCanvas.style.display = 'block';
  chartMeta.style.display = 'block';
  chartMetaTitle.textContent = title;
  chartToolbar.style.display = 'flex';
  appState.currentChartData = { title, labels, values };

  const isMulti = ['pie','doughnut'].includes(type);
  const data = {
    labels,
    datasets: [{
      data: values,
      backgroundColor: isMulti ? CHART_COLORS : CHART_COLORS[0] + 'cc',
      borderColor: isMulti ? CHART_COLORS : CHART_COLORS[0],
      borderWidth: type === 'line' ? 2.5 : 1,
      borderRadius: type === 'bar' ? 6 : 0,
      fill: type === 'line' ? {target:'origin', above:'rgba(99,102,241,0.08)'} : false,
      tension: 0.4,
      pointBackgroundColor: CHART_COLORS[0],
      pointRadius: type === 'line' ? 4 : 0,
    }]
  };

  const scales = isMulti ? {} : {
    x: { ticks: { color:'#64748b', font:{family:'Inter',size:10}, maxRotation:45 }, grid:{color:'rgba(99,150,255,0.06)'} },
    y: { ticks: { color:'#64748b', font:{family:'Inter',size:10}, callback: v => formatNum(v) }, grid:{color:'rgba(99,150,255,0.06)'} }
  };

  appState.chartInstance = new Chart(mainChartCanvas, {
    type,
    data,
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: isMulti, labels:{color:'#94a3b8', font:{family:'Inter',size:11}, boxWidth:10} },
        tooltip: {
          backgroundColor:'#0d1220', borderColor:'rgba(99,150,255,0.22)', borderWidth:1,
          titleColor:'#f0f4ff', bodyColor:'#94a3b8',
          titleFont:{family:'Inter',size:12,weight:'bold'}, bodyFont:{family:'Inter',size:11}, padding:10,
          callbacks: { label: ctx => ` ${formatNum(ctx.raw)}` }
        }
      },
      scales
    }
  });
}

function switchChartType(type) {
  if (!appState.currentChartData) return;
  const { title, labels, values } = appState.currentChartData;
  renderChart(type, title, labels, values);
}

/* ══════════════════════════════════════════════════════════════════════════════
   DATA PROCESSING
══════════════════════════════════════════════════════════════════════════════ */
function computeStats(records) {
  if (!records || !records.length) return {};
  const headers = Object.keys(records[0]);
  const stats = {};
  headers.forEach(col => {
    const vals = records.map(r => r[col]).filter(v => v !== undefined && v !== '' && v !== null);
    const nums = vals.map(v => parseFloat(String(v).replace(/,/g,''))).filter(n => !isNaN(n));
    if (nums.length > 0 && nums.length >= vals.length * 0.7) {
      stats[col] = { type:'numeric', min:Math.min(...nums), max:Math.max(...nums), sum:nums.reduce((a,b)=>a+b,0), avg:nums.reduce((a,b)=>a+b,0)/nums.length, count:nums.length };
    } else {
      const freq = {};
      vals.forEach(v => { freq[v] = (freq[v]||0)+1; });
      const sorted = Object.entries(freq).sort((a,b)=>b[1]-a[1]);
      stats[col] = { type:'categorical', uniqueCount:sorted.length, topValues:sorted.slice(0,10).map(([k,v])=>({value:k,count:v})) };
    }
  });
  return stats;
}

function processCSVData(csvText, fileName) {
  const result = Papa.parse(csvText, { header:true, skipEmptyLines:true, dynamicTyping:false });
  if (!result.data.length) { showToast('CSV is empty or invalid', 'error'); return; }
  const records = result.data;
  const headers = result.meta.fields || Object.keys(records[0]);
  const stats = computeStats(records);
  appState.records = records; appState.headers = headers;
  appState.stats = stats; appState.fileName = fileName; appState.rowCount = records.length;
  updateDataUI(fileName, records.length, headers, stats);
  enableChat();
  triggerDefaultChart(records, headers, stats);
  showToast(`✅ Loaded ${records.length} rows`, 'success');
  setStatus('Ready');
  addBotMessage(`I've loaded <strong>${fileName}</strong> — <strong>${records.length} rows</strong>, <strong>${headers.length} columns</strong>: ${headers.map(h=>`<em>${h}</em>`).join(', ')}.<br/><br/>Ask me anything! 🚀`);
}

function updateDataUI(fileName, rowCount, headers, stats) {
  dataFileName.textContent = fileName;
  statRows.textContent = rowCount.toLocaleString();
  statCols.textContent = headers.length;
  columnsList.innerHTML = headers.map(h => {
    const isNum = stats[h] && stats[h].type === 'numeric';
    return `<span class="col-tag ${isNum?'numeric':''}">${h}</span>`;
  }).join('');
  dataCard.style.display = 'block';
  uploadInner.innerHTML = `<div class="upload-icon">✅</div><div class="upload-title">${fileName}</div><div class="upload-sub">${rowCount.toLocaleString()} rows loaded</div><div class="upload-hint">Click or drop to replace</div>`;
  uploadZone.classList.add('has-file');
}

function triggerDefaultChart(records, headers, stats) {
  const nums = numericCols(stats); const cats = catCols(stats);
  if (cats.length > 0 && nums.length > 0) {
    const agg = aggregate(records, cats[0], nums[0], 'sum').slice(0,10);
    renderChart('bar', `Total ${nums[0]} by ${cats[0]}`, agg.map(g=>g.label), agg.map(g=>Math.round(g.value)));
  }
}

/* ── UPLOAD EVENTS ───────────────────────────────────────────────────────────── */
uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault(); uploadZone.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (f && f.name.endsWith('.csv')) handleFileSelect(f);
  else showToast('Please drop a CSV file', 'error');
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFileSelect(fileInput.files[0]); });
function handleFileSelect(file) {
  setStatus('Parsing...','loading');
  const r = new FileReader();
  r.onload = e => processCSVData(e.target.result, file.name);
  r.onerror = () => showToast('Could not read file','error');
  r.readAsText(file);
}
loadSampleBtn.addEventListener('click', () => processCSVData(SAMPLE_CSV, 'sample_sales_data.csv'));

/* ── CHAT ─────────────────────────────────────────────────────────────────────── */
function enableChat() {
  chatInput.disabled = false; sendBtn.disabled = false;
  chatInput.placeholder = 'Ask anything about your data...';
}
function addUserMessage(text) {
  const div = document.createElement('div');
  div.className = 'chat-message user';
  div.innerHTML = `<div class="chat-avatar">U</div><div class="chat-bubble">${escapeHtml(text)}</div>`;
  chatWindow.appendChild(div); scrollChat();
}
function addBotMessage(html, chartInfo = null) {
  const div = document.createElement('div');
  div.className = 'chat-message bot';
  const extra = chartInfo ? `<span class="chart-insight">📈 Chart: ${chartInfo}</span>` : '';
  div.innerHTML = `<div class="chat-avatar">🐇</div><div class="chat-bubble">${html}${extra}</div>`;
  chatWindow.appendChild(div); scrollChat();
}
function addTypingIndicator() {
  const div = document.createElement('div');
  div.className = 'chat-message bot'; div.id = 'typingIndicator';
  div.innerHTML = `<div class="chat-avatar">🐇</div><div class="chat-bubble"><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>`;
  chatWindow.appendChild(div); scrollChat();
}
function removeTypingIndicator() { const el = document.getElementById('typingIndicator'); if (el) el.remove(); }
function scrollChat() { chatWindow.scrollTop = chatWindow.scrollHeight; }

/* ── ASK QUESTION ─────────────────────────────────────────────────────────────── */
async function askQuestion(question) {
  if (!appState.records || appState.isQuerying) return;
  appState.isQuerying = true;
  setStatus('Analyzing...','loading');
  sendBtn.disabled = true;
  addUserMessage(question);
  addTypingIndicator();

  // Small delay for UX (feels like thinking)
  await new Promise(r => setTimeout(r, 400));

  try {
    // ── LOCAL ENGINE (primary — always works, no API needed) ──
    const result = localAnalytics(question, appState.records, appState.headers, appState.stats);

    removeTypingIndicator();

    if (result.labels && result.labels.length > 0) {
      renderChart(result.chartType, result.chartTitle, result.labels, result.values);
      addBotMessage(result.answer, result.chartTitle);
    } else {
      addBotMessage(result.answer);
    }

    setStatus('Ready');
  } catch (err) {
    removeTypingIndicator();
    addBotMessage(`❌ Error: ${err.message}`);
    setStatus('Error','error');
  } finally {
    appState.isQuerying = false;
    sendBtn.disabled = false;
    chatInput.focus();
  }
}

sendBtn.addEventListener('click', () => { const q = chatInput.value.trim(); if (q) { chatInput.value = ''; askQuestion(q); } });
chatInput.addEventListener('keypress', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const q = chatInput.value.trim(); if (q) { chatInput.value = ''; askQuestion(q); } }
});

/* ── SUGGESTION CHIPS ─────────────────────────────────────────────────────────── */
document.querySelectorAll('.suggestion-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    if (!appState.records) { showToast('Upload a CSV file first!','error'); return; }
    askQuestion(chip.dataset.q);
  });
});

/* ── CHART TYPE SWITCHER ──────────────────────────────────────────────────────── */
document.querySelectorAll('.chart-type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chart-type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    switchChartType(btn.dataset.type);
  });
});

/* ── DOWNLOAD CHART ───────────────────────────────────────────────────────────── */
downloadChartBtn.addEventListener('click', () => {
  if (!appState.chartInstance) return;
  const a = document.createElement('a');
  a.href = mainChartCanvas.toDataURL('image/png');
  a.download = 'talking-rabbitt-chart.png';
  a.click();
  showToast('Chart exported!','success');
});

/* ── API KEY MODAL (optional — no longer required) ────────────────────────────── */
const apiModal = document.getElementById('apiModal');
const modalClose = document.getElementById('modalClose');
const modalCancel = document.getElementById('modalCancel');
const saveApiKey = document.getElementById('saveApiKey');
const apiKeyInput = document.getElementById('apiKeyInput');

apiKeyLink.addEventListener('click', e => { e.preventDefault(); apiModal.style.display = 'flex'; });
apiBadge.addEventListener('click', () => apiModal.style.display = 'flex');
modalClose.addEventListener('click', () => apiModal.style.display = 'none');
modalCancel.addEventListener('click', () => apiModal.style.display = 'none');
apiModal.addEventListener('click', e => { if (e.target === apiModal) apiModal.style.display = 'none'; });
saveApiKey.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (key && key.length > 10) {
    appState.sessionApiKey = key;
    apiBadge.textContent = '✓ API: Enhanced';
    apiBadge.classList.add('active');
    apiModal.style.display = 'none';
    showToast('API key saved!','success');
  } else {
    showToast('Please enter a valid API key','error');
  }
});

/* ── TABLE MODAL ─────────────────────────────────────────────────────────────── */
const tableModal = document.getElementById('tableModal');
const tableModalClose = document.getElementById('tableModalClose');
const tableWrapper = document.getElementById('tableWrapper');
tableModalClose.addEventListener('click', () => tableModal.style.display = 'none');
tableModal.addEventListener('click', e => { if (e.target === tableModal) tableModal.style.display = 'none'; });
dataCard.addEventListener('click', () => {
  if (!appState.records) return;
  const ths = appState.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
  const trs = appState.records.slice(0,50).map(r =>
    `<tr>${appState.headers.map(h => `<td>${escapeHtml(String(r[h]??''))}</td>`).join('')}</tr>`
  ).join('');
  tableWrapper.innerHTML = `<table class="data-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table><p style="font-size:11px;color:var(--text3);margin-top:10px;text-align:center">Showing first 50 of ${appState.rowCount.toLocaleString()} rows</p>`;
  tableModal.style.display = 'flex';
});

/* ── INIT ─────────────────────────────────────────────────────────────────────── */
setStatus('Ready');
apiBadge.textContent = 'Demo API';
apiBadge.style.background = 'rgba(99,102,241,0.15)';
apiBadge.style.color = 'var(--accent3)';
apiBadge.style.borderColor = 'rgba(99,102,241,0.3)';
