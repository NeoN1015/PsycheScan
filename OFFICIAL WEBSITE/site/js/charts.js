/* Chart.js charts: four small sensor charts, the combined timeline, and the emotion chart. */

// Smallest vertical range per sensor chart, so jitter (e.g. a DS18B20 flicking between
// 34.2 and 34.4 °C) isn't stretched to fill the whole chart.
const SENSOR_CHART_MIN_SPAN = { hr: 20, gsr: 0.5, temp: 1, motion: 0.1 };
const SENSOR_COLORS = { hr: "--accent", gsr: "--accent-2", temp: "#f59e0b", motion: "#22c55e" };
const SENSOR_CHART_IDS = { hr: "sensorHrChart", gsr: "sensorGsrChart", temp: "sensorTempChart", motion: "sensorMotionChart" };
const EMOTION_COLORS = ["#64748b", "#f59e0b", "#38bdf8", "#ef4444", "#8b5cf6", "#14b8a6", "#ec4899"];

function cssColor(token) {
  return token.startsWith("--") ? getComputedStyle(document.body).getPropertyValue(token).trim() : token;
}

function minSpanYAxis(span) {
  return {
    afterDataLimits(scale) {
      const range = scale.max - scale.min;
      if (!Number.isFinite(range) || range >= span) return;
      const nonNegative = scale.min >= 0;
      const mid = (scale.max + scale.min) / 2;
      scale.min = mid - span / 2;
      scale.max = mid + span / 2;
      if (nonNegative && scale.min < 0) {
        scale.min = 0;
        scale.max = span;
      }
    }
  };
}

function seriesPoints(log, select, now) {
  const cutoff = now - CONFIG.runtime.chartWindowSec * 1000;
  return log.filter(entry => entry.t >= cutoff && Number.isFinite(select(entry)))
    .map(entry => ({ x: (entry.t - now) / 1000, y: select(entry) }));
}

function buildCharts() {
  if (!window.Chart) return;
  Object.values(state.charts).forEach(chart => chart?.destroy());
  state.charts = {};

  const text = cssColor("--text");
  const soft = cssColor("--text-soft");
  const line = cssColor("--line");
  const base = {
    responsive: true,
    maintainAspectRatio: false,
    // Streaming charts redraw every second; animation made new points rise from the axis.
    animation: false,
    plugins: { legend: { labels: { color: text } } },
    scales: {
      x: { type: "linear", min: -CONFIG.runtime.chartWindowSec, max: 0, ticks: { callback: value => `${value}s`, color: soft }, grid: { color: line } },
      y: { ticks: { color: soft }, grid: { color: line } }
    }
  };
  const lineDataset = (label, color, extra = {}) => ({ label, data: [], borderColor: cssColor(color), tension: 0.3, pointRadius: 0, spanGaps: false, ...extra });

  const liveCanvas = $("liveChart");
  if (liveCanvas) {
    state.charts.live = new Chart(liveCanvas, {
      type: "line",
      data: { datasets: SENSOR_KEYS.map(key => lineDataset(`${CONFIG.sensors[key].channel} (${CONFIG.sensors[key].unit})`, SENSOR_COLORS[key])) },
      options: base
    });
  }

  const compactTicks = { font: { size: 10 }, maxTicksLimit: 4 };
  SENSOR_KEYS.forEach(key => {
    const canvas = $(SENSOR_CHART_IDS[key]);
    if (!canvas) return;
    state.charts[key] = new Chart(canvas, {
      type: "line",
      data: { datasets: [lineDataset(CONFIG.sensors[key].channel, SENSOR_COLORS[key])] },
      options: {
        ...base,
        plugins: { legend: { display: false } },
        scales: {
          x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, ...compactTicks } },
          y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, ...compactTicks }, ...minSpanYAxis(SENSOR_CHART_MIN_SPAN[key]) }
        }
      }
    });
  });

  const emotionCanvas = $("emotionChart");
  if (emotionCanvas) {
    state.charts.emotion = new Chart(emotionCanvas, {
      type: "line",
      data: {
        datasets: EMOTIONS.map((emotion, index) => lineDataset(capitalize(emotion), EMOTION_COLORS[index], { pointRadius: 2, pointHoverRadius: 5, borderWidth: 2 }))
      },
      options: {
        ...base,
        plugins: {
          legend: { labels: { color: text, usePointStyle: true, pointStyle: "circle", boxWidth: 8, boxHeight: 8, padding: 10, font: { size: 11 } } }
        },
        scales: { ...base.scales, y: { ...base.scales.y, min: 0, max: 1 } }
      }
    });
  }
  updateCharts();
}

function updateCharts() {
  const now = Date.now();
  SENSOR_KEYS.forEach((key, index) => {
    const points = seriesPoints(state.sensorLog, entry => entry[key], now);
    if (state.charts[key]) {
      state.charts[key].data.datasets[0].data = points;
      state.charts[key].update();
    }
    if (state.charts.live) state.charts.live.data.datasets[index].data = points;
  });
  state.charts.live?.update();

  if (state.charts.emotion) {
    const faceSamples = state.faceLog.filter(sample => sample.faceDetected);
    EMOTIONS.forEach((emotion, index) => {
      state.charts.emotion.data.datasets[index].data = seriesPoints(faceSamples, sample => sample.emotions[emotion], now);
    });
    state.charts.emotion.update();
    const empty = $("emotionChartEmptyState");
    if (empty) empty.hidden = faceSamples.some(sample => sample.t >= now - CONFIG.runtime.chartWindowSec * 1000);
  }
}
