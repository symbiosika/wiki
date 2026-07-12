---
name: apexcharts-vue-standard-charts
description: Create and customize ApexCharts (ApexCharts.js) charts in Vue (Vue 2 + Vue 3) using vue-apexcharts / vue3-apexcharts. Provides correct series schemas and options for common chart types (line, area, bar/column, mixed, rangeArea, rangeBar/timeline, funnel, candlestick, boxPlot, bubble, scatter, heatmap, treemap, pie/donut, radialBar, radar, polarArea) with pattern fills and Vue-friendly reactivity/update guidance.
license: Apache-2.0
compatibility: Vue 3 (vue3-apexcharts) + apexcharts. For Nuxt SSR, use client-only plugin/ClientOnly.
metadata:
  author: generated
  version: "1.0"
---

# ApexCharts for Vue (Standard Charts + Patterns)

## Purpose
Help an agent produce **working Vue chart components** using ApexCharts:
- Correct `series` shape per chart type
- A complete `options` object with sensible defaults
- Accessible differentiation using **pattern fills** (not color-only)
- Vue-specific setup + safe update patterns (reactivity gotchas)

## Trigger phrases
Use this skill when the user mentions:
- "ApexCharts", "apexcharts", "vue apexcharts", "vue3-apexcharts", "vue-apexcharts"
- "chart", "graph", "dashboard", "plot", "timeline", "candlestick", "heatmap", etc.

## What to quickly collect (minimum)
1. Intended chart type OR the story: trend / compare / composition / distribution / relationship / schedule / OHLC / funnel
2. X-axis type: `category` vs `datetime` vs numeric
3. Series count and meaning; stacked vs grouped
4. Formatting: units, currency/percent, decimals, locale/timezone
5. Any constraints: SSR (Nuxt), printing, color-blind friendliness (patterns)

## Output contract (always produce)
1. A short mapping: “data → series schema → chart type”.
2. The **series schema** and a tiny example object.
3. A **Vue Single File Component** (SFC) example:
   - Vue 3 `<script setup>` by default
   - Include Vue 2 Options API variant only if explicitly requested
4. One “gotcha check” (container height, datetime format, reactivity update pattern).

---

# Vue setup (installation + registration)

## Vue 3

Install:

* `bin add apexcharts vue3-apexcharts`

Register globally:

```js
import { createApp } from "vue";
import App from "./App.vue";
import VueApexCharts from "vue3-apexcharts";

createApp(App).use(VueApexCharts).mount("#app");
```

(Plugin registration makes `<apexchart>` available everywhere.) ([ApexCharts.js][2])

## Nuxt SSR

ApexCharts depends on `window`. In SSR environments (Nuxt), register as **client-only** and/or wrap usage in `<ClientOnly>`.

Example Nuxt plugin (client-only file name):

```js
// plugins/apexcharts.client.js (Nuxt 3)
import VueApexCharts from "vue3-apexcharts";
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(VueApexCharts);
});
```

---

# Vue reactivity rules (must follow)

## Updating series/options (safe approach)

The wrapper commonly watches props; to reliably trigger updates, **replace the outermost object/array** when changing nested config (especially in Vue 2, but also a safe habit in Vue 3). ([GitHub][4])

✅ Do:

```js
chartOptions.value = {
  ...chartOptions.value,
  xaxis: { ...chartOptions.value.xaxis, categories: newCats }
};
series.value = [{ ...series.value[0], data: newData }];
```

❌ Avoid mutating only a deep nested key without reassigning the root:

```js
chartOptions.value.xaxis.categories = newCats;
```

---

# Global defaults (merge into most charts)

## Base options

```js
export const baseOptions = {
  chart: {
    animations: { enabled: true },
    toolbar: { show: true },
    zoom: { enabled: false },
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  },
  noData: { text: "No data" },
  grid: { strokeDashArray: 3, padding: { left: 8, right: 8 } },
  legend: { show: true, position: "bottom" },
  dataLabels: { enabled: false },
  tooltip: { shared: true, intersect: false },
  stroke: { width: 2, curve: "straight" },
};
```

---

# Patterns (accessibility + print)

## Pattern fill (recommended for bars/columns/areas, and for pie/donut in print)

ApexCharts supports `fill.type: "pattern"` and these pattern styles:
`verticalLines`, `horizontalLines`, `slantedLines`, `squares`, `circles`. ([ApexCharts.js][5])

```js
export const patternFill = {
  fill: {
    type: "pattern",
    opacity: 1,
    pattern: {
      style: ["circles", "slantedLines", "verticalLines", "horizontalLines"],
      width: 6,
      height: 6,
      strokeWidth: 2,
    },
  },
};
```

## Line differentiation (when no fill)

```js
export const lineDifferentiation = {
  stroke: { width: 3, curve: "straight", dashArray: [0, 6, 2, 10] },
  markers: { size: 4 },
};
```

---

# Vue 3 SFC templates (copy/paste)

## Template: standard

```vue
<template>
  <apexchart :type="type" :height="height" :options="chartOptions" :series="series" />
</template>

<script setup>
import { ref } from "vue";

const type = "line";
const height = 320;

const series = ref([{ name: "Series 1", data: [10, 20, 15] }]);
const chartOptions = ref({
  chart: { id: "example" },
  xaxis: { categories: ["A", "B", "C"] },
});
</script>
```

(`type`, `series`, `width/height`, `options` are the core props.) ([ApexCharts.js][2])

---

# Chart recipes (series schema + Vue example)

## 1) Line (trend)

**Series schema:** `[{ name, data: number[] | {x,y}[] }]`

```vue
<template>
  <apexchart type="line" height="320" :options="options" :series="series" />
</template>

<script setup>
import { ref } from "vue";
import { baseOptions, lineDifferentiation } from "./apexDefaults";

const series = ref([
  { name: "Sales", data: [{ x: "2025-01-01", y: 42 }, { x: "2025-01-02", y: 55 }] },
]);

const options = ref({
  ...baseOptions,
  ...lineDifferentiation,
  chart: { ...baseOptions.chart, type: "line", zoom: { enabled: true } },
  xaxis: { type: "datetime" },
});
</script>
```

Gotcha: For `datetime`, keep x-values consistent (ISO strings OR timestamps).

---

## 2) Area (trend + magnitude)

**Series schema:** same as line.

Use gradient or patterns:

```js
options.value = {
  ...options.value,
  chart: { ...options.value.chart, type: "area" },
  // either gradient or patternFill
  fill: { type: "gradient" },
};
```

---

## 3) Column (vertical bars)

ApexCharts uses `type: "bar"` + `plotOptions.bar.horizontal=false`. ([ApexCharts.js][6])

**Series schema:** `[{ name, data: number[] }]`

```vue
<template>
  <apexchart type="bar" height="320" :options="options" :series="series" />
</template>

<script setup>
import { ref } from "vue";
import { baseOptions, patternFill } from "./apexDefaults";

const series = ref([{ name: "Count", data: [10, 22, 13] }]);

const options = ref({
  ...baseOptions,
  ...patternFill,
  chart: { ...baseOptions.chart, type: "bar" },
  plotOptions: { bar: { horizontal: false, columnWidth: "55%" } },
  xaxis: { categories: ["A", "B", "C"] },
});
</script>
```

---

## 4) Bar (horizontal)

```js
options.value = {
  ...options.value,
  plotOptions: { bar: { horizontal: true, barHeight: "65%" } },
};
```

---

## 5) Mixed / Combo (line + column)

**Series schema:** each series may specify `type`.

```js
series.value = [
  { name: "Revenue", type: "column", data: [44, 55, 41] },
  { name: "Profit", type: "line", data: [11, 32, 45] },
];
options.value = {
  ...baseOptions,
  chart: { ...baseOptions.chart, type: "line" },
  xaxis: { categories: ["Jan", "Feb", "Mar"] },
};
```

Tip: Add `yaxis: [{...}, { opposite: true }]` when units differ.

---

## 6) Range Area (min/max band)

Chart type: `rangeArea`. ([ApexCharts.js][6])
**Series schema:** `y: [low, high]`

```js
series.value = [{
  name: "Range",
  data: [
    { x: "2025-01-01", y: [12, 18] },
    { x: "2025-01-02", y: [10, 17] },
  ]
}];

options.value = {
  ...baseOptions,
  ...patternFill,
  chart: { ...baseOptions.chart, type: "rangeArea" },
  xaxis: { type: "datetime" },
};
```

---

## 7) Timeline / RangeBar (schedule)

Chart type: `rangeBar`. ([ApexCharts.js][7])
**Series schema:** `y: [startMs, endMs]`

```js
series.value = [{
  name: "Team A",
  data: [
    { x: "Task 1", y: [Date.parse("2025-01-01"), Date.parse("2025-01-05")] },
    { x: "Task 2", y: [Date.parse("2025-01-06"), Date.parse("2025-01-09")] },
  ]
}];

options.value = {
  ...baseOptions,
  chart: { ...baseOptions.chart, type: "rangeBar" },
  plotOptions: { bar: { horizontal: true } },
  xaxis: { type: "datetime" },
};
```

---

## 8) Funnel (conversion stages)

**Series schema:** `[{ name, data: number[] }]` + `labels`.

```js
series.value = [{ name: "Users", data: [1000, 650, 320, 120] }];
options.value = {
  ...baseOptions,
  ...patternFill,
  chart: { ...baseOptions.chart, type: "funnel" },
  labels: ["Visited", "Signed Up", "Activated", "Paid"],
};
```

---

## 9) Candlestick (OHLC)

Chart type: `candlestick`. ([ApexCharts.js][6])
**Series schema:** `data: [[timestamp, [open, high, low, close]], ...]`

```js
series.value = [{
  name: "Price",
  data: [
    [Date.parse("2025-01-01"), [6593.34, 6600, 6582.63, 6600]],
    [Date.parse("2025-01-02"), [6600.00, 6625, 6570.10, 6588.42]],
  ]
}];

options.value = {
  ...baseOptions,
  chart: { ...baseOptions.chart, type: "candlestick" },
  xaxis: { type: "datetime" },
};
```

---

## 10) BoxPlot (distribution)

Chart type: `boxPlot`. ([ApexCharts.js][6])
**Series schema:** `y: [min, q1, median, q3, max]`

```js
series.value = [{
  name: "Distribution",
  data: [
    { x: "Group A", y: [54, 66, 69, 75, 88] },
    { x: "Group B", y: [43, 52, 57, 65, 80] },
  ]
}];

options.value = { ...baseOptions, chart: { ...baseOptions.chart, type: "boxPlot" } };
```

---

## 11) Bubble (x/y + size)

Chart type: `bubble`. ([ApexCharts.js][6])
**Series schema:** points `{ x, y, z }`

```js
series.value = [{
  name: "Products",
  data: [{ x: 10, y: 20, z: 15 }, { x: 15, y: 35, z: 10 }]
}];

options.value = { ...baseOptions, chart: { ...baseOptions.chart, type: "bubble" }, xaxis: { type: "numeric" } };
```

---

## 12) Scatter (relationship)

Chart type: `scatter`. ([ApexCharts.js][6])
**Series schema:** points `{ x, y }`

```js
series.value = [{ name: "Samples", data: [{ x: 1.2, y: 3.4 }, { x: 2.0, y: 2.7 }] }];

options.value = {
  ...baseOptions,
  chart: { ...baseOptions.chart, type: "scatter", zoom: { enabled: true, type: "xy" } },
  xaxis: { type: "numeric" },
};
```

---

## 13) Heatmap (intensity matrix)

Chart type: `heatmap`. ([ApexCharts.js][6])
**Series schema:** multiple rows; each row has `{ x, y }` cells.

```js
series.value = [
  { name: "Mon", data: [{ x: "W1", y: 10 }, { x: "W2", y: 22 }] },
  { name: "Tue", data: [{ x: "W1", y: 5 }, { x: "W2", y: 18 }] },
];

options.value = { ...baseOptions, chart: { ...baseOptions.chart, type: "heatmap" } };
```

---

## 14) Treemap (composition many categories)

Chart type: `treemap`. ([ApexCharts.js][6])
**Series schema:** `[{ data: [{ x, y }, ...] }]`

```js
series.value = [{ data: [{ x: "A", y: 40 }, { x: "B", y: 25 }, { x: "C", y: 15 }] }];

options.value = { ...baseOptions, ...patternFill, chart: { ...baseOptions.chart, type: "treemap" } };
```

---

## 15) Pie / Donut (composition)

Chart type: `pie` or `donut`. ([ApexCharts.js][6])
**Series schema:** `number[]` + `labels[]`

```js
const series = ref([44, 55, 13, 43]);
const options = ref({
  chart: { type: "donut" },
  labels: ["A", "B", "C", "D"],
  ...patternFill,
});
```

---

## 16) RadialBar (single or multiple progress)

Chart type: `radialBar`. ([ApexCharts.js][6])

```js
const series = ref([67]);
const options = ref({
  chart: { type: "radialBar" },
  labels: ["Progress"],
  plotOptions: { radialBar: { dataLabels: { name: { show: true }, value: { show: true } } } },
});
```

---

## 17) Radar (multi-metric comparison)

Chart type: `radar`. ([ApexCharts.js][6])

```js
series.value = [
  { name: "Product A", data: [80, 50, 70, 60] },
  { name: "Product B", data: [60, 80, 65, 50] },
];

options.value = {
  ...baseOptions,
  chart: { ...baseOptions.chart, type: "radar" },
  xaxis: { categories: ["Speed", "Reliability", "UX", "Cost"] },
  fill: { opacity: 0.25 },
};
```

---

## 18) PolarArea (composition variant)

Chart type: `polarArea`. ([ApexCharts.js][6])

```js
const series = ref([14, 23, 21, 17]);
const options = ref({
  chart: { type: "polarArea" },
  labels: ["A", "B", "C", "D"],
  ...patternFill,
});
```

---

# Dashboards (multi-chart layout)

Principles:

* Share `baseOptions`, override per chart.
* Keep axis/formatting consistent across related charts.
* For linked interactions, use `chart.group` and unique `chart.id` per chart.

---

# Troubleshooting checklist (include one per answer)

* Blank chart: container height is 0 → set `height` prop or CSS.
* Datetime weirdness: mixed x formats → use ISO strings OR timestamps consistently.
* Vue updates not reflected: replace outermost `options/series` objects (don’t only mutate deep keys).

---
