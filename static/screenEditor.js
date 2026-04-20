
import { getProjectById, listProjectsByType, touchProject } from './projectRepository.js';
import { createProjectRecord, findProjectByCloudId, saveProjectData } from './projectRepository.js';
import { attachAuthControls, requireAuthenticated } from './authService.js';
import { getUserProject, listUserProjects, saveUserProject } from './cloudProjectService.js';
import { showSharedDialog } from './dialogService.js';
import { downloadCloudProjectToLocalFile } from './projectDownloadService.js';
import { getWorkflowRuntime } from './workflowRuntimeStore.js';

const IMPORT_STORAGE_KEY = 'ia-editor-import-payload';
const SOURCE_MODE_MANUAL = 'manual';
const SOURCE_MODE_WORKFLOW_PORT = 'workflow-port';
const AGRI_DATA_MODE_API = 'api';
const WEATHER_DATA_MODE_API = 'api';
const DEFAULT_PAGE = { width: 1440, height: 900, background: '#f5f7fb' };
const MIN_CANVAS_ZOOM = 0.5;
const MAX_CANVAS_ZOOM = 2;
const CANVAS_TOOL_MOVE = 'move';
const CANVAS_TOOL_RESIZE = 'resize';
const RESIZE_HANDLE_DIRECTIONS = ['nw', 'ne', 'sw', 'se'];
const CHART_DATA_LAYOUT_WIDE = 'wide';
const CHART_DATA_LAYOUT_LONG = 'long';
const CHART_SERIES_MODE_SINGLE = 'single';
const CHART_SERIES_MODE_DOUBLE = 'double';
const CHART_SERIES_MODE_MULTI = 'multi';
const DEFAULT_CHART_AGGREGATION_LIMIT = 60;
const MIN_CHART_AGGREGATION_LIMIT = 8;
const MAX_CHART_AGGREGATION_LIMIT = 240;
const CHART_COLORS = ['#2f80ed', '#56ccf2', '#6fcf97', '#f2c94c', '#f2994a', '#eb5757', '#9b51e0', '#27ae60'];

const COMPONENT_LIBRARY = [
    {
        type: 'text',
        icon: '📝',
        title: '文本展示',
        description: '显示固定文本，或绑定已有工作流中的字符串/整型端口。'
    },
    {
        type: 'image',
        icon: '🖼️',
        title: '图片展示',
        description: '上传图片，或绑定已有工作流中的字符串端口作为图片地址。'
    },
    {
        type: 'chart-bar',
        icon: '📊',
        title: '柱状图表',
        description: '导入 CSV 数据，支持单柱、双柱、多柱对比与自动聚合。'
    },
    {
        type: 'chart-line',
        icon: '📈',
        title: '折线图表',
        description: '导入 CSV 数据，支持单折线、双折线、多折线与自动聚合。'
    },
    {
        type: 'chart-pie',
        icon: '🥧',
        title: '饼图表',
        description: '导入 CSV 数据并显示分类占比，不包含柱状/折线切换项。'
    },
    {
        type: 'agri-sensor',
        icon: '📏',
        title: '传感器数据',
        description: '展示各类传感器的数据，包括温度、湿度、光照等。'
    },
    {
        type: 'agri-model',
        icon: '🧠',
        title: '环境抽象模型',
        description: '展示农业环境抽象模型、主导维度、风险分数与模型摘要。'
    },
    {
        type: 'agri-climate',
        icon: '🌦️',
        title: '气候预测卡',
        description: '展示未来气候趋势、微气候状态与关键环境预测。'
    },
    {
        type: 'agri-yield',
        icon: '🌾',
        title: '产量预测卡',
        description: '展示产量指数、亩产估算与影响因子评分。'
    },
    {
        type: 'agri-decision',
        icon: '🧭',
        title: '辅助决策卡',
        description: '展示优先决策动作、风险说明与模块建议列表。'
    },
    {
        type: 'agri-summary',
        icon: '🧾',
        title: '分析摘要卡',
        description: '专门解析农业分析摘要节点输出，自动去掉原始 JSON、英文键名和多余括号。'
    },
    {
        type: 'weather',
        icon: '🌤️',
        title: '天气信息',
        description: '通过 Open-Meteo 或自定义接口获取实时天气并展示。'
    }
];

const state = {
    components: new Map(),
    nextId: 1,
    selectedId: null,
    selectedIds: new Set(),
    page: { ...DEFAULT_PAGE },
    zoom: 1,
    activeCanvasTool: CANVAS_TOOL_MOVE
};

const refs = {
    library: document.getElementById('screenComponentLibrary'),
    canvasArea: document.getElementById('screenCanvasArea'),
    viewport: document.getElementById('screenViewport'),
    stage: document.getElementById('screenStage'),
    propContent: document.getElementById('screenPropContent'),
    openLocalBtn: document.getElementById('openScreenLocalBtn'),
    saveLocalBtn: document.getElementById('saveScreenLocalBtn'),
    saveCloudBtn: document.getElementById('saveScreenCloudBtn'),
    downloadCloudBtn: document.getElementById('downloadScreenCloudBtn'),
    importBtn: document.getElementById('importScreenBtn'),
    exportBtn: document.getElementById('exportScreenBtn'),
    runBtn: document.getElementById('runScreenBtn'),
    importInput: document.getElementById('screenImportInput'),
    projectBadge: document.getElementById('screenProjectBadge'),
    accountControls: document.getElementById('screenAccountControls'),
    selectAllBtn: document.getElementById('screenSelectAllBtn'),
    copyBtn: document.getElementById('screenCopyBtn'),
    cutBtn: document.getElementById('screenCutBtn'),
    pasteBtn: document.getElementById('screenPasteBtn'),
    duplicateBtn: document.getElementById('screenDuplicateBtn'),
    resizeModeBtn: document.getElementById('screenResizeModeBtn'),
    bringToFrontBtn: document.getElementById('screenBringToFrontBtn'),
    deleteBtn: document.getElementById('screenDeleteBtn'),
    toolModeLabel: document.getElementById('screenToolModeLabel'),
    zoomOutBtn: document.getElementById('screenZoomOutBtn'),
    zoomResetBtn: document.getElementById('screenZoomResetBtn'),
    zoomInBtn: document.getElementById('screenZoomInBtn'),
    zoomLabel: document.getElementById('screenZoomLabel')
};

let dragState = null;
let isBoxSelecting = false;
let boxSelectStartPoint = null;
let boxSelectCurrentPoint = null;
let boxSelectBaseSelection = [];
let didBoxSelectMove = false;
let boxSelectionOverlay = null;
let componentClipboardPayload = null;
let componentClipboardPasteCount = 0;
let currentScreenProject = null;

function formatDatePart(value) {
    return String(value).padStart(2, '0');
}

function buildDefaultScreenProjectName() {
    const now = new Date();
    return `大屏项目 ${now.getFullYear()}-${formatDatePart(now.getMonth() + 1)}-${formatDatePart(now.getDate())} ${formatDatePart(now.getHours())}:${formatDatePart(now.getMinutes())}`;
}

function formatProjectTime(value) {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) return '时间未知';
    return `${date.getFullYear()}-${formatDatePart(date.getMonth() + 1)}-${formatDatePart(date.getDate())} ${formatDatePart(date.getHours())}:${formatDatePart(date.getMinutes())}`;
}

function setCurrentScreenProject(project) {
    currentScreenProject = project && typeof project === 'object'
        ? { ...project }
        : null;
    updateScreenProjectBadge();
}

function updateScreenProjectBadge() {
    if (!refs.projectBadge) return;
    refs.projectBadge.textContent = currentScreenProject?.name || '未命名大屏项目';
    refs.projectBadge.title = currentScreenProject?.name || '未命名大屏项目';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function cloneData(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function clampCanvasZoom(value) {
    return clamp(Number(value) || 1, MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM);
}

function getTextJustifyContent(textAlign) {
    if (textAlign === 'center') return 'center';
    if (textAlign === 'right') return 'flex-end';
    return 'flex-start';
}

function getQuery() {
    const params = new URLSearchParams(window.location.search);
    return {
        entry: params.get('entry') || '',
        projectId: params.get('projectId') || ''
    };
}

function resolveBackendOrigin() {
    const fromMeta = document.querySelector('meta[name="ia-backend-origin"]')?.getAttribute('content')?.trim();
    if (fromMeta) return fromMeta.replace(/\/+$/, '');
    if (window.location.origin) return window.location.origin;
    return `${window.location.protocol}//${window.location.host}`;
}

function getSelectedComponent() {
    if (state.selectedId != null && state.selectedIds.has(state.selectedId)) {
        return state.components.get(state.selectedId) || null;
    }
    const [firstId] = state.selectedIds;
    return firstId != null ? state.components.get(firstId) || null : null;
}

function getSelectedComponents() {
    return Array.from(state.selectedIds)
        .map(id => state.components.get(id))
        .filter(Boolean);
}

function hasSelection() {
    return state.selectedIds.size > 0;
}

function hasSingleSelection() {
    return state.selectedIds.size === 1 && Boolean(getSelectedComponent());
}

function isResizeToolActive() {
    return state.activeCanvasTool === CANVAS_TOOL_RESIZE;
}

function setActiveCanvasTool(tool) {
    state.activeCanvasTool = tool === CANVAS_TOOL_RESIZE ? CANVAS_TOOL_RESIZE : CANVAS_TOOL_MOVE;
    updateCanvasStatusBar();
    renderStage();
}

function toggleResizeCanvasTool() {
    setActiveCanvasTool(isResizeToolActive() ? CANVAS_TOOL_MOVE : CANVAS_TOOL_RESIZE);
}

function isComponentSelected(componentId) {
    return state.selectedIds.has(componentId);
}

function isComponentResizeReady(componentId) {
    return hasSingleSelection() && state.selectedId === componentId;
}

function getResizeHandleMarkup(componentId) {
    if (!isComponentResizeReady(componentId)) return '';
    return RESIZE_HANDLE_DIRECTIONS.map(direction => `
        <button
            type="button"
            class="screen-resize-handle screen-resize-handle-${direction}"
            data-resize-handle="${direction}"
            tabindex="-1"
            aria-hidden="true"
        ></button>
    `).join('');
}

function getStageComponentClassNames(componentId) {
    const classNames = ['screen-component'];
    if (isComponentSelected(componentId)) classNames.push('selected');
    if (isResizeToolActive() && isComponentResizeReady(componentId)) classNames.push('resize-ready');
    if (dragState?.interaction && dragState.componentId === componentId && dragState.interaction !== 'move') {
        classNames.push('is-resizing');
    }
    return classNames.join(' ');
}

function clearSelectedComponents() {
    state.selectedIds.clear();
    state.selectedId = null;
}

function setSelectedComponents(componentIds, primaryId = null) {
    const validIds = componentIds
        .map(id => Number(id))
        .filter(id => state.components.has(id));

    state.selectedIds = new Set(validIds);
    if (!validIds.length) {
        state.selectedId = null;
        return;
    }

    const preferredId = Number(primaryId);
    state.selectedId = validIds.includes(preferredId) ? preferredId : validIds[validIds.length - 1];
}

function toggleComponentSelection(componentId) {
    const nextIds = new Set(state.selectedIds);
    if (nextIds.has(componentId)) nextIds.delete(componentId);
    else nextIds.add(componentId);
    setSelectedComponents(Array.from(nextIds), componentId);
}

function getComponentTypeLabel(componentType) {
    const labels = {
        text: '文本展示',
        image: '图片展示',
        chart: '图表展示',
        'chart-bar': '柱状图表',
        'chart-line': '折线图表',
        'chart-pie': '饼图表',
        weather: '天气信息',
        'agri-model': '环境抽象模型',
        'agri-climate': '气候预测卡',
        'agri-yield': '产量预测卡',
        'agri-decision': '辅助决策卡',
        'agri-summary': '分析摘要卡',
        'agri-system': '系统数据卡',
        'agri-environment': '环境监测卡',
        'agri-communication': '通讯状态卡'
    };
    return labels[componentType] || componentType;
}

function summarizeComponentProps(component) {
    if (!component) return '';
    if (component.type === 'text') return `文本：${component.props.text || ''}`;
    if (component.type === 'image') return `图片说明：${component.props.alt || '未设置'}`;
    if (component.type === 'chart') {
        const chartType = component.props.chartType === 'line' ? 'line' : component.props.chartType === 'pie' ? 'pie' : 'bar';
        if (chartType === 'pie') return '图表组件：饼图';
        return `图表模式：${getChartSeriesModeLabel(chartType, component.props.seriesMode || CHART_SERIES_MODE_MULTI)}`;
    }
    if (component.type === 'weather') return `地点：${component.props.subtitle || '未命名'} · ${getWeatherDataMode(component) === WEATHER_DATA_MODE_API ? 'API' : '手动'}`;
    if (component.type === 'agri-sensor') return `传感器数量：${component.props.sensors?.length || 0}`;
    if (component.type === 'agri-summary') {
        return `数据模式：${normalizeSource(component.props.source).mode === SOURCE_MODE_WORKFLOW_PORT ? '工作流端口' : '手动内容'}`;
    }
    if (component.type === 'agri-model' || component.type === 'agri-climate' || component.type === 'agri-yield' || component.type === 'agri-decision') {
        return `数据模式：${normalizeSource(component.props.source).mode === SOURCE_MODE_WORKFLOW_PORT ? '工作流端口' : '手动 JSON'}`;
    }
    return '';
}

function createDefaultSource() {
    return {
        mode: SOURCE_MODE_MANUAL,
        workflowProjectId: '',
        workflowPortId: ''
    };
}

function normalizeSource(rawSource) {
    return {
        mode: rawSource?.mode === SOURCE_MODE_WORKFLOW_PORT ? SOURCE_MODE_WORKFLOW_PORT : SOURCE_MODE_MANUAL,
        workflowProjectId: typeof rawSource?.workflowProjectId === 'string' ? rawSource.workflowProjectId : '',
        workflowPortId: typeof rawSource?.workflowPortId === 'string' ? rawSource.workflowPortId : ''
    };
}

function buildSampleAgriTwinPayload() {
    return {
        status: 'ok',
        model_id: 'demo-agri-twin',
        model_name: '智慧农业抽象数据模型',
        screen_contract: {
            overview: {
                title: '智慧农业抽象数据模型',
                summary: '样例模型已完成对温湿光土等环境变量的抽象建模，可直接驱动大屏中的建模、预测与决策组件。',
                sample_count: 192,
                updated_at: '2026-04-19 09:30:00',
                climate_archetype: '稳定适生型',
                risk_score: 68.5,
                confidence: 84.2,
                dominant_dimension: { label: '水分供给度', score: 82.4 },
                weakest_dimension: { label: '空气洁净度', score: 61.8 },
                latest_reading: {
                    temperature: 24.6,
                    humidity: 68.0,
                    soil_humidity: 46.3,
                    light_lux: 18600,
                    timestamp: '2026-04-19 09:30:00'
                },
                dimension_bars: [
                    { label: '温热稳定度', score: 78.4, state: 'high', level: '良好' },
                    { label: '水分供给度', score: 82.4, state: 'high', level: '优秀' },
                    { label: '光照活跃度', score: 75.8, state: 'high', level: '良好' },
                    { label: '空气洁净度', score: 61.8, state: 'medium', level: '中等' },
                    { label: '生长韧性', score: 73.5, state: 'medium', level: '良好' }
                ]
            },
            climate_forecast: {
                microclimate_state: '稳定适生型',
                weather_summary: '未来 6 小时棚内温度小幅上升，空气湿度总体平稳，土壤湿度略有回落。',
                confidence: 84.2,
                cards: [
                    { key: 'temperature', label: '未来6小时温度', value: 25.8, unit: '°C', trend: '上升' },
                    { key: 'humidity', label: '未来6小时湿度', value: 67.0, unit: '%', trend: '平稳' },
                    { key: 'soil_humidity', label: '未来6小时土壤湿度', value: 43.9, unit: '%', trend: '下降' },
                    { key: 'light_lux', label: '未来6小时光照', value: 20400, unit: 'Lux', trend: '上升' }
                ]
            },
            yield_forecast: {
                yield_index: 76.4,
                estimated_yield_kg_per_mu: 470.8,
                yield_grade: '稳产潜力',
                narrative: '当前环境条件总体适宜，若继续维持灌溉与通风协同策略，产量仍有提升空间。',
                factor_bars: [
                    { label: '热环境适配', score: 78.2, level: '良好' },
                    { label: '空气湿度适配', score: 74.1, level: '良好' },
                    { label: '土壤供水能力', score: 81.6, level: '优秀' },
                    { label: '光照活跃度', score: 72.5, level: '良好' },
                    { label: '环境稳定性', score: 70.8, level: '良好' }
                ]
            },
            decision_support: {
                risk_score: 68.5,
                yield_index: 76.4,
                decision_summary: '当前最优先动作为“择时补水”，以缓解土壤湿度未来 6 小时内继续下滑的风险。',
                top_decision: {
                    module: 'irrigation-controller',
                    action: '择时补水',
                    priority: 'P1',
                    score: 81.2,
                    reason: '预计未来 6 小时土壤湿度降至 43.9%，需要提前干预。'
                },
                modules: [
                    { module: 'irrigation-controller', action: '择时补水', priority: 'P1', score: 81.2, reason: '预计未来 6 小时土壤湿度降至 43.9%，需要提前干预。' },
                    { module: 'ventilation-controller', action: '保持低频通风', priority: 'P2', score: 54.6, reason: '温度略有上行，但仍处于适生区间。' },
                    { module: 'disease-risk-evaluator', action: '维持常规巡检', priority: 'P2', score: 42.8, reason: '湿度较平稳，病害风险可控。' }
                ]
            }
        }
    };
}

function buildSampleAgriTwinJson() {
    return JSON.stringify(buildSampleAgriTwinPayload(), null, 2);
}

function buildDefaultChartCsv(chartType = 'bar') {
    if (chartType === 'pie') {
        return '状态,占比\n正常,68\n预警,21\n异常,11';
    }
    return [
        'time,device_id,value',
        '08:00,A-01,23.8',
        '08:00,B-02,24.3',
        '09:00,A-01,24.4',
        '09:00,B-02,25.1',
        '10:00,A-01,25.0',
        '10:00,B-02,25.8',
        '11:00,A-01,25.5',
        '11:00,B-02,26.2'
    ].join('\n');
}

function createChartProps(chartType = 'bar') {
    const normalizedType = chartType === 'line' || chartType === 'pie' ? chartType : 'bar';
    return {
        title: '',
        chartType: normalizedType,
        csvText: buildDefaultChartCsv(normalizedType),
        labelColumn: '',
        valueColumn: '',
        valueColumns: [],
        seriesColumn: '',
        seriesMode: normalizedType === 'pie' ? CHART_SERIES_MODE_SINGLE : CHART_SERIES_MODE_DOUBLE,
        selectedSeriesKeys: [],
        dataLayout: normalizedType === 'pie' ? CHART_DATA_LAYOUT_WIDE : CHART_DATA_LAYOUT_LONG,
        enableAggregation: true,
        aggregationLimit: DEFAULT_CHART_AGGREGATION_LIMIT,
        source: createDefaultSource()
    };
}

function normalizeChartProps(rawProps, chartType = 'bar') {
    const defaults = createChartProps(chartType);
    const merged = {
        ...defaults,
        ...(rawProps || {})
    };
    const normalizedType = merged.chartType === 'line' || merged.chartType === 'pie' ? merged.chartType : 'bar';
    const normalizedSeriesMode = normalizedType === 'pie'
        ? CHART_SERIES_MODE_SINGLE
        : merged.seriesMode === CHART_SERIES_MODE_SINGLE || merged.seriesMode === CHART_SERIES_MODE_DOUBLE
            ? merged.seriesMode
            : CHART_SERIES_MODE_MULTI;
    const seriesLimit = normalizedSeriesMode === CHART_SERIES_MODE_SINGLE
        ? 1
        : normalizedSeriesMode === CHART_SERIES_MODE_DOUBLE
            ? 2
            : Number.MAX_SAFE_INTEGER;

    return {
        ...merged,
        chartType: normalizedType,
        csvText: typeof merged.csvText === 'string' ? merged.csvText : defaults.csvText,
        labelColumn: typeof merged.labelColumn === 'string' ? merged.labelColumn : '',
        valueColumn: typeof merged.valueColumn === 'string' ? merged.valueColumn : '',
        seriesColumn: typeof merged.seriesColumn === 'string' ? merged.seriesColumn : '',
        valueColumns: Array.isArray(merged.valueColumns)
            ? merged.valueColumns.filter(item => typeof item === 'string').slice(0, seriesLimit)
            : typeof merged.valueColumn === 'string' && merged.valueColumn
                ? [merged.valueColumn]
                : [],
        seriesMode: normalizedSeriesMode,
        selectedSeriesKeys: Array.isArray(merged.selectedSeriesKeys)
            ? merged.selectedSeriesKeys.filter(item => typeof item === 'string').slice(0, seriesLimit)
            : [],
        dataLayout: normalizedType === 'pie'
            ? CHART_DATA_LAYOUT_WIDE
            : merged.dataLayout === CHART_DATA_LAYOUT_WIDE
                ? CHART_DATA_LAYOUT_WIDE
                : CHART_DATA_LAYOUT_LONG,
        enableAggregation: merged.enableAggregation !== false,
        aggregationLimit: clamp(
            Number(merged.aggregationLimit) || DEFAULT_CHART_AGGREGATION_LIMIT,
            MIN_CHART_AGGREGATION_LIMIT,
            MAX_CHART_AGGREGATION_LIMIT
        ),
        source: normalizeSource(merged.source)
    };
}

function updateChartProps(component, partialProps = {}) {
    component.props = normalizeChartProps({
        ...component.props,
        ...partialProps
    }, partialProps.chartType || component.props.chartType || 'bar');
}

function createTextComponent(x, y) {
    return {
        id: state.nextId++,
        type: 'text',
        x,
        y,
        width: 300,
        height: 96,
        props: {
            text: '新建文本组件',
            fontSize: 34,
            color: '#1f2937',
            fontWeight: '700',
            textAlign: 'left',
            backgroundColor: 'transparent',
            source: createDefaultSource()
        }
    };
}

function createImageComponent(x, y) {
    return {
        id: state.nextId++,
        type: 'image',
        x,
        y,
        width: 320,
        height: 220,
        props: {
            src: '',
            alt: '图片展示组件',
            objectFit: 'cover',
            borderRadius: 20,
            autoRefresh: false,
            refreshInterval: 5,
            source: createDefaultSource()
        }
    };
}

function createChartComponent(x, y, chartType = 'bar') {
    return {
        id: state.nextId++,
        type: 'chart',
        x,
        y,
        width: 520,
        height: 320,
        props: createChartProps(chartType)
    };
}

function createWeatherComponent(x, y) {
    return {
        id: state.nextId++,
        type: 'weather',
        x,
        y,
        width: 380,
        height: 300,
        props: {
            title: '天气预报',
            subtitle: '北京',
            dataMode: SOURCE_MODE_MANUAL,
            latitude: 39.9042,
            longitude: 116.4074,
            customApiUrl: '',
            refreshInterval: 600,
            conditionText: '晴',
            tempC: '22',
            humidity: '65',
            windKmh: '12',
            updatedAt: '手动预览'
        }
    };
}

function createSensorComponent(x, y) {
    return {
        id: state.nextId++,
        type: 'agri-sensor',
        x,
        y,
        width: 430,
        height: 400,
        props: {
            title: '传感器数据',
            dataMode: SOURCE_MODE_MANUAL,
            apiPath: '/api/agriculture/sensor',
            refreshInterval: 30,
            sensors: [
                { name: '温度传感器', value: '24.6 °C', unit: '°C', status: '正常' },
                { name: '湿度传感器', value: '68', unit: '%', status: '正常' },
                { name: '光照传感器', value: '18500', unit: 'Lux', status: '正常' },
                { name: '土壤湿度', value: '45', unit: '%', status: '正常' }
            ]
        }
    };
}

function createAgriModelComponent(x, y) {
    return {
        id: state.nextId++,
        type: 'agri-model',
        x,
        y,
        width: 460,
        height: 320,
        props: {
            title: '农业环境抽象模型',
            jsonText: buildSampleAgriTwinJson(),
            source: createDefaultSource()
        }
    };
}

function createAgriClimateComponent(x, y) {
    return {
        id: state.nextId++,
        type: 'agri-climate',
        x,
        y,
        width: 420,
        height: 300,
        props: {
            title: '气候趋势预测',
            jsonText: buildSampleAgriTwinJson(),
            source: createDefaultSource()
        }
    };
}

function createAgriYieldComponent(x, y) {
    return {
        id: state.nextId++,
        type: 'agri-yield',
        x,
        y,
        width: 400,
        height: 320,
        props: {
            title: '产量预测',
            jsonText: buildSampleAgriTwinJson(),
            source: createDefaultSource()
        }
    };
}

function createAgriDecisionComponent(x, y) {
    return {
        id: state.nextId++,
        type: 'agri-decision',
        x,
        y,
        width: 460,
        height: 340,
        props: {
            title: '辅助决策',
            jsonText: buildSampleAgriTwinJson(),
            source: createDefaultSource()
        }
    };
}

function buildSampleAgriSummaryPayload() {
    return {
        overview: {
            device_name: '示范温室 1 号设备',
            location: '武汉示范农田 A 区',
            work_status: '正常',
            risk_score: 68,
            alert_count: 2,
            observation: '近 24 小时棚内环境整体可控，但土壤湿度已出现回落，当前更适合提前补水而不是被动等待告警扩大。'
        },
        alerts: [
            {
                level: 'high',
                metric: 'soil_humidity',
                message: '土壤湿度偏低，存在缺水风险。',
                suggestion: '建议在未来 2 小时内分区补水，并持续观察回升速度。'
            },
            {
                level: 'medium',
                metric: 'temperature',
                message: '棚内温度有轻微上升趋势。',
                suggestion: '建议保持低频通风，避免午后热负荷继续抬升。'
            }
        ],
        recommendations: [
            {
                priority: 'P1',
                title: '择时补水',
                detail: '根据当前土壤湿度走势优先执行补水动作，降低未来 6 小时的缺水波动。',
                expected_effect: '缓解根系水分压力，稳定植株生长节奏。'
            },
            {
                priority: 'P2',
                title: '保持低频通风',
                detail: '在温度继续抬升前预留通风窗口，减少棚内闷热堆积。',
                expected_effect: '维持温湿环境稳定，降低病害压力。'
            }
        ]
    };
}

function buildSampleAgriSummaryJson() {
    return JSON.stringify(buildSampleAgriSummaryPayload(), null, 2);
}

function createAgriSummaryComponent(x, y) {
    return {
        id: state.nextId++,
        type: 'agri-summary',
        x,
        y,
        width: 460,
        height: 340,
        props: {
            title: '农业分析摘要',
            jsonText: buildSampleAgriSummaryJson(),
            source: createDefaultSource()
        }
    };
}

function createComponent(type, x, y) {
    if (type === 'text') return createTextComponent(x, y);
    if (type === 'image') return createImageComponent(x, y);
    if (type === 'chart-bar') return createChartComponent(x, y, 'bar');
    if (type === 'chart-line') return createChartComponent(x, y, 'line');
    if (type === 'chart-pie') return createChartComponent(x, y, 'pie');
    if (type === 'chart') return createChartComponent(x, y);
    if (type === 'agri-sensor') return createSensorComponent(x, y);
    if (type === 'agri-model') return createAgriModelComponent(x, y);
    if (type === 'agri-climate') return createAgriClimateComponent(x, y);
    if (type === 'agri-yield') return createAgriYieldComponent(x, y);
    if (type === 'agri-decision') return createAgriDecisionComponent(x, y);
    if (type === 'agri-summary') return createAgriSummaryComponent(x, y);
    if (type === 'weather') return createWeatherComponent(x, y);
    return null;
}

function normalizeComponent(rawComponent) {
    const baseId = Number.isFinite(Number(rawComponent?.id)) ? Number(rawComponent.id) : state.nextId++;
    const rawType = String(rawComponent?.type || 'text');
    const type = rawType === 'image'
        ? 'image'
        : rawType === 'chart' || rawType === 'chart-bar' || rawType === 'chart-line' || rawType === 'chart-pie'
            ? 'chart'
            : rawType === 'agri-sensor'
                ? 'agri-sensor'
                : rawType === 'agri-model'
                    ? 'agri-model'
                    : rawType === 'agri-climate'
                        ? 'agri-climate'
                        : rawType === 'agri-yield'
                            ? 'agri-yield'
                            : rawType === 'agri-decision'
                                ? 'agri-decision'
                                : rawType === 'agri-summary'
                                    ? 'agri-summary'
                : rawType === 'weather'
                    ? 'weather'
                : 'text';
    const chartType = rawType === 'chart-line' ? 'line' : rawType === 'chart-pie' ? 'pie' : 'bar';
    const component = type === 'image'
        ? createImageComponent(80, 80)
        : type === 'chart'
            ? createChartComponent(80, 80, rawComponent?.props?.chartType || chartType)
            : type === 'agri-sensor'
                ? createSensorComponent(80, 80)
                : type === 'agri-model'
                    ? createAgriModelComponent(80, 80)
                    : type === 'agri-climate'
                        ? createAgriClimateComponent(80, 80)
                        : type === 'agri-yield'
                            ? createAgriYieldComponent(80, 80)
                            : type === 'agri-decision'
                                ? createAgriDecisionComponent(80, 80)
                                : type === 'agri-summary'
                                    ? createAgriSummaryComponent(80, 80)
                : type === 'weather'
                    ? createWeatherComponent(80, 80)
                : createTextComponent(80, 80);

    component.id = baseId;
    component.x = Number.isFinite(Number(rawComponent?.x)) ? Number(rawComponent.x) : component.x;
    component.y = Number.isFinite(Number(rawComponent?.y)) ? Number(rawComponent.y) : component.y;
    component.width = Number.isFinite(Number(rawComponent?.width)) ? Number(rawComponent.width) : component.width;
    component.height = Number.isFinite(Number(rawComponent?.height)) ? Number(rawComponent.height) : component.height;
    const mergedProps = {
        ...component.props,
        ...(rawComponent?.props || {})
    };
    component.props = type === 'chart'
        ? normalizeChartProps(mergedProps, mergedProps.chartType || chartType)
        : {
            ...mergedProps,
            source: normalizeSource(rawComponent?.props?.source)
        };
    return component;
}

function isAgricultureComponentType(type) {
    return type === 'agri-sensor'
        || type === 'agri-model'
        || type === 'agri-climate'
        || type === 'agri-yield'
        || type === 'agri-decision'
        || type === 'agri-summary';
}

function isAgriInsightComponentType(type) {
    return type === 'agri-model'
        || type === 'agri-climate'
        || type === 'agri-yield'
        || type === 'agri-decision';
}

function isWeatherComponentType(type) {
    return type === 'weather';
}

function getWeatherDataMode(component) {
    return component?.props?.dataMode === WEATHER_DATA_MODE_API ? WEATHER_DATA_MODE_API : SOURCE_MODE_MANUAL;
}

const WEATHER_REFRESH_MIN_SEC = 10;
const WEATHER_REFRESH_MAX_SEC = 86400;

function getWeatherRefreshInterval(component) {
    return clamp(Number(component?.props?.refreshInterval) || 600, WEATHER_REFRESH_MIN_SEC, WEATHER_REFRESH_MAX_SEC);
}

function weatherFetchUsesBackendProxy(component) {
    const custom = String(component?.props?.customApiUrl || '').trim();
    if (!custom) return true;
    return /open-meteo\.com/i.test(custom);
}

function buildWeatherApiRequestUrlForEditor(component) {
    const lat = Number.isFinite(Number(component?.props?.latitude)) ? Number(component.props.latitude) : 30.5928;
    const lon = Number.isFinite(Number(component?.props?.longitude)) ? Number(component.props.longitude) : 114.3055;
    if (weatherFetchUsesBackendProxy(component)) {
        const base = resolveBackendOrigin().replace(/\/+$/, '');
        const qs = new URLSearchParams();
        qs.set('latitude', String(lat));
        qs.set('longitude', String(lon));
        return `${base}/api/weather/forecast?${qs.toString()}`;
    }
    const custom = String(component?.props?.customApiUrl || '').trim();
    if (!custom) return '';
    return custom.startsWith('http://') || custom.startsWith('https://')
        ? custom
        : new URL(custom, resolveBackendOrigin()).toString();
}

function wmoWeatherCodeToLabel(code) {
    const map = {
        0: '晴', 1: '大部晴朗', 2: '多云', 3: '阴',
        51: '毛毛雨', 61: '小雨', 63: '中雨', 65: '大雨',
        71: '小雪', 73: '中雪', 80: '阵雨', 95: '雷暴'
    };
    const n = Number(code);
    if (!Number.isFinite(n)) return '天气';
    return map[n] || '天气';
}

function applyOpenMeteoPayloadToWeatherProps(props, json) {
    const current = json?.current;
    if (!current || typeof current !== 'object') return false;
    props.tempC = Number.isFinite(Number(current.temperature_2m)) ? String(Number(current.temperature_2m).toFixed(1)) : '—';
    props.humidity = Number.isFinite(Number(current.relative_humidity_2m)) ? String(Math.round(Number(current.relative_humidity_2m))) : '—';
    props.windKmh = Number.isFinite(Number(current.wind_speed_10m)) ? String(Number(current.wind_speed_10m).toFixed(1)) : '—';
    props.conditionText = wmoWeatherCodeToLabel(current.weather_code);
    props.updatedAt = current.time ? `观测时间 ${current.time}` : '已更新';
    return true;
}

async function syncWeatherFromApiForComponent(component) {
    if (!component || component.type !== 'weather' || getWeatherDataMode(component) !== WEATHER_DATA_MODE_API) return;
    if (component._weatherFetching) return;
    const url = buildWeatherApiRequestUrlForEditor(component);
    if (!url) return;
    component._weatherFetching = true;
    component._weatherLastFetchAt = Date.now();
    try {
        const response = await fetch(url, { cache: 'no-store' });
        const text = await response.text();
        if (!response.ok || !text.trim()) {
            component.props.updatedAt = `加载失败: HTTP ${response.status}`;
            renderStage();
            return;
        }
        const json = JSON.parse(text);
        const payload = json?.data && !json?.current ? json.data : json;
        if (applyOpenMeteoPayloadToWeatherProps(component.props, payload)) {
            renderStage();
            return;
        }
        if (payload && typeof payload === 'object') {
            if (payload.tempC != null) component.props.tempC = String(payload.tempC);
            if (payload.humidity != null) component.props.humidity = String(payload.humidity);
            if (payload.windKmh != null) component.props.windKmh = String(payload.windKmh);
            if (payload.conditionText != null) component.props.conditionText = String(payload.conditionText);
            if (payload.updatedAt != null) component.props.updatedAt = String(payload.updatedAt);
        }
        renderStage();
    } catch (error) {
        component.props.updatedAt = `加载失败: ${error?.message || '网络错误'}`;
        renderStage();
    } finally {
        component._weatherFetching = false;
    }
}

function tickEditorWeatherSync() {
    const now = Date.now();
    for (const component of state.components.values()) {
        if (!isWeatherComponentType(component.type) || getWeatherDataMode(component) !== WEATHER_DATA_MODE_API) continue;
        const intervalMs = getWeatherRefreshInterval(component) * 1000;
        const last = component._weatherLastFetchAt || 0;
        if (last > 0 && now - last < intervalMs) continue;
        syncWeatherFromApiForComponent(component);
    }
}

function usesWorkflowSource(type) {
    return type === 'text'
        || type === 'image'
        || type === 'chart'
        || type === 'agri-model'
        || type === 'agri-climate'
        || type === 'agri-yield'
        || type === 'agri-decision'
        || type === 'agri-summary';
}

function getSupportedPortTypes(componentType) {
    if (componentType === 'image') return ['string'];
    if (componentType === 'agri-summary') return ['string'];
    if (isAgriInsightComponentType(componentType)) return ['string', 'csv'];
    if (componentType === 'chart') return ['string', 'csv'];
    return ['string', 'int'];
}

function getPortTypeLabel(dataType) {
    if (dataType === 'int') return '整型';
    if (dataType === 'csv') return 'CSV';
    return '字符串';
}

function normalizeWorkflowDataType(dataType) {
    return dataType === 'int' ? 'int' : (dataType === 'csv' ? 'csv' : 'string');
}

function buildWorkflowVariableMapFromList(variables) {
    const variableMap = new Map();
    (Array.isArray(variables) ? variables : []).forEach((variable, index) => {
        const variableId = String(variable?.id || `workflow-variable-${index}`);
        if (!variableId) return;
        const dataType = normalizeWorkflowDataType(variable?.dataType);
        variableMap.set(variableId, {
            id: variableId,
            name: String(variable?.name || variableId),
            dataType,
            defaultValue: dataType === 'int'
                ? (Number.isFinite(Number(variable?.defaultValue)) ? Number(variable.defaultValue) : 0)
                : String(variable?.defaultValue ?? '')
        });
    });
    return variableMap;
}

function deriveWorkflowPortDataType(port, nodesById, variableMap) {
    const node = nodesById.get(Number(port?.nodeId));
    if (node?.type === 'output' && String(port?.field || '') === 'outputValue') {
        const variable = variableMap.get(String(node?.properties?.variableId || ''));
        if (variable) return variable.dataType;
    }
    return normalizeWorkflowDataType(port?.dataType);
}

function normalizeWorkflowProjectPort(port, index, nodesById, variableMap) {
    return {
        id: String(port?.id || `workflow-port-${index}`),
        name: String(port?.name || `端口${index + 1}`),
        dataType: deriveWorkflowPortDataType(port, nodesById, variableMap),
        nodeId: Number.isFinite(Number(port?.nodeId)) ? Number(port.nodeId) : null,
        field: typeof port?.field === 'string' ? port.field : ''
    };
}

function getWorkflowPortsForProject(projectId) {
    const project = getProjectById(projectId);
    if (!project || project.type !== 'workflow') return [];
    const nodes = Array.isArray(project.data?.nodes) ? project.data.nodes : [];
    const variables = Array.isArray(project.data?.workflow_variables) ? project.data.workflow_variables : [];
    const ports = Array.isArray(project.data?.workflow_ports) ? project.data.workflow_ports : [];
    const nodesById = new Map(nodes.map(node => [Number(node?.id), node]));
    const variableMap = buildWorkflowVariableMapFromList(variables);

    return ports.map((port, index) => {
        const normalized = normalizeWorkflowProjectPort(port, index, nodesById, variableMap);
        return {
            id: normalized.id,
            name: normalized.name,
            dataType: normalized.dataType
        };
    });
}

function getWorkflowProjectRuntimeContext(projectId) {
    const project = getProjectById(projectId);
    if (!project || project.type !== 'workflow') return null;

    const nodes = Array.isArray(project.data?.nodes) ? project.data.nodes : [];
    const variables = Array.isArray(project.data?.workflow_variables) ? project.data.workflow_variables : [];
    const ports = Array.isArray(project.data?.workflow_ports) ? project.data.workflow_ports : [];

    const nodesById = new Map(nodes.map(node => [Number(node?.id), node]));
    const variableMap = buildWorkflowVariableMapFromList(variables);
    const normalizedPorts = ports.map((port, index) => normalizeWorkflowProjectPort(port, index, nodesById, variableMap));

    return {
        project,
        nodesById,
        ports: normalizedPorts,
        variableMap
    };
}

function resolveVariableDefaultValue(variable) {
    if (!variable) return '';
    return variable.dataType === 'int'
        ? (Number.isFinite(Number(variable.defaultValue)) ? Number(variable.defaultValue) : 0)
        : String(variable.defaultValue ?? '');
}

function resolveWorkflowPortRuntimeValue(projectId, portId) {
    const context = getWorkflowProjectRuntimeContext(projectId);
    if (!context) return { ok: false, reason: 'missing-project' };

    const port = context.ports.find(item => String(item?.id || '') === String(portId));
    if (!port) return { ok: false, reason: 'missing-port', project: context.project };

    const runtime = getWorkflowRuntime(projectId);
    const runtimeById = runtime?.portValuesById && typeof runtime.portValuesById === 'object'
        ? runtime.portValuesById
        : null;
    const runtimeByName = runtime?.portValuesByName && typeof runtime.portValuesByName === 'object'
        ? runtime.portValuesByName
        : null;
    const portIdKey = String(port.id || '');
    const portNameKey = String(port.name || '').trim();

    if (runtimeById && Object.prototype.hasOwnProperty.call(runtimeById, portIdKey)) {
        return {
            ok: true,
            value: runtimeById[portIdKey],
            source: 'runtime',
            updatedAt: runtime.updatedAt,
            project: context.project,
            port
        };
    }

    if (runtimeByName && portNameKey && Object.prototype.hasOwnProperty.call(runtimeByName, portNameKey)) {
        return {
            ok: true,
            value: runtimeByName[portNameKey],
            source: 'runtime',
            updatedAt: runtime.updatedAt,
            project: context.project,
            port
        };
    }

    const nodeId = Number(port?.nodeId);
    const node = context.nodesById.get(nodeId);
    if (!node) {
        return { ok: false, reason: 'missing-node', project: context.project, port };
    }

    const field = String(port?.field || '');
    if (field === 'outputValue') {
        const variableId = node?.properties?.variableId;
        const variable = context.variableMap.get(String(variableId || ''));
        if (!variable) {
            return { ok: false, reason: 'missing-variable', project: context.project, port, node };
        }

        return {
            ok: true,
            value: resolveVariableDefaultValue(variable),
            source: 'variable-default',
            project: context.project,
            port,
            node,
            variable
        };
    }

    return {
        ok: true,
        value: node?.properties?.[field] ?? '',
        source: 'node-property',
        project: context.project,
        port,
        node
    };
}

function getCompatibleWorkflowPorts(componentType, projectId) {
    const supported = new Set(getSupportedPortTypes(componentType));
    return getWorkflowPortsForProject(projectId).filter(port => supported.has(port.dataType));
}

function ensureComponentSource(component) {
    const normalized = normalizeSource(component?.props?.source);
    component.props.source = normalized;
    return normalized;
}

function primeWorkflowSource(component) {
    const source = ensureComponentSource(component);
    const projects = listProjectsByType('workflow');
    if (!projects.length) {
        source.workflowProjectId = '';
        source.workflowPortId = '';
        return source;
    }

    if (!projects.some(project => project.id === source.workflowProjectId)) {
        source.workflowProjectId = projects[0].id;
    }

    const compatiblePorts = getCompatibleWorkflowPorts(component.type, source.workflowProjectId);
    if (!compatiblePorts.some(port => port.id === source.workflowPortId)) {
        source.workflowPortId = compatiblePorts[0]?.id || '';
    }

    return source;
}
function resolveWorkflowBinding(component) {
    const source = normalizeSource(component?.props?.source);
    if (source.mode !== SOURCE_MODE_WORKFLOW_PORT) {
        return { mode: SOURCE_MODE_MANUAL, valid: false, source };
    }

    const project = getProjectById(source.workflowProjectId);
    if (!project || project.type !== 'workflow') {
        return { mode: SOURCE_MODE_WORKFLOW_PORT, valid: false, reason: 'missing-project', source };
    }

    const port = getWorkflowPortsForProject(project.id).find(item => item.id === source.workflowPortId) || null;
    if (!port) {
        return { mode: SOURCE_MODE_WORKFLOW_PORT, valid: false, reason: 'missing-port', project, source };
    }

    if (!getSupportedPortTypes(component.type).includes(port.dataType)) {
        return { mode: SOURCE_MODE_WORKFLOW_PORT, valid: false, reason: 'unsupported-type', project, port, source };
    }

    const runtimeValue = resolveWorkflowPortRuntimeValue(project.id, port.id);

    return {
        mode: SOURCE_MODE_WORKFLOW_PORT,
        valid: true,
        project,
        port,
        source,
        label: `${project.name} / ${port.name}`,
        token: `{{${project.name}.${port.name}}}`,
        runtimeValue
    };
}

function getSourceStatusText(component) {
    const binding = resolveWorkflowBinding(component);
    if (binding.mode !== SOURCE_MODE_WORKFLOW_PORT) return '当前使用组件内手动填写的内容。';
    if (binding.valid) {
        const typeHint = `当前端口类型：${getPortTypeLabel(binding.port.dataType)}。`;
        let runtimeHint = ' 当前还无法解析出端口值，请检查工作流中的输出节点与变量绑定。';
        if (binding.runtimeValue?.ok) {
            const rawText = normalizeSourcePayloadText(binding.runtimeValue.value);
            const valueText = rawText.length > 120 ? `${rawText.slice(0, 117)}...` : (rawText || '空值');
            runtimeHint = binding.runtimeValue.source === 'runtime'
                ? ` 当前显示最近一次运行值：${valueText}。`
                : ` 当前显示默认值：${valueText}。`;
        }
        if (component.type === 'image') {
            return `${typeHint}${runtimeHint} 运行生成网页时会把该字符串端口值视为图片 URL 或 Base64 地址。`;
        }
        if (component.type === 'chart') {
            return `${typeHint}${runtimeHint} 运行生成网页时会把该端口值视为 CSV 文本，用于绘制图表。`;
        }
        if (isAgriInsightComponentType(component.type)) {
            return `${typeHint}${runtimeHint} 该组件会把文本端口值解析为农业模型 JSON，并按模型概览、气候预测、产量预测或辅助决策视图进行渲染。`;
        }
        if (component.type === 'agri-summary') {
            return `${typeHint}${runtimeHint} 该组件会优先解析分析摘要节点返回的 JSON 文本，并自动整理为可直接上屏的中文摘要卡。`;
        }
        return `${typeHint}${runtimeHint} 文本组件支持字符串与整型端口。`;
    }
    if (binding.reason === 'missing-project') return '绑定的工作流项目不存在，请重新选择。';
    if (binding.reason === 'missing-port') return '绑定的工作流端口不存在，请重新选择。';
    if (binding.reason === 'unsupported-type') return `当前组件不支持 ${getPortTypeLabel(binding.port?.dataType)} 端口，请重新选择。`;
    return '请先选择一个有效的工作流端口。';
}

function getTextRenderState(component) {
    const binding = resolveWorkflowBinding(component);
    if (binding.valid) {
        return {
            text: binding.runtimeValue?.ok ? String(binding.runtimeValue.value ?? '') : binding.token,
            note: `${binding.label} · ${getPortTypeLabel(binding.port.dataType)}`
        };
    }

    if (binding.mode === SOURCE_MODE_WORKFLOW_PORT) {
        return {
            text: '请选择可用的工作流端口',
            note: '仅支持字符串 / 整型端口'
        };
    }

    return { text: component.props.text || '', note: '' };
}

function getImageRenderState(component) {
    const binding = resolveWorkflowBinding(component);
    if (binding.valid) {
        if (binding.runtimeValue?.ok && String(binding.runtimeValue.value ?? '').trim()) {
            const extracted = extractImageSourceFromStructuredValue(binding.runtimeValue.value);
            if (extracted.ok) {
                return {
                    kind: 'image',
                    src: extracted.src,
                    note: `${binding.label} · ${getPortTypeLabel(binding.port.dataType)}`
                };
            }
            return {
                kind: 'binding',
                title: '当前端口不是图片数据',
                note: extracted.reason === 'structured-non-image'
                    ? `${binding.label} · 当前端口输出为结构化分析结果，请改绑图片 URL 端口，或改用图表 / 农业专题组件。`
                    : `${binding.label} · 当前端口值不是可用的图片地址或 Base64。`
            };
        }
        return {
            kind: 'binding',
            title: '已绑定工作流图片源',
            note: binding.runtimeValue?.ok
                ? `${binding.label} · 当前值为空`
                : `${binding.label} · 当前无法解析端口值`
        };
    }

    if (binding.mode === SOURCE_MODE_WORKFLOW_PORT) {
        return {
            kind: 'binding',
            title: '请选择字符串端口',
            note: '图片组件仅支持字符串端口作为图片地址'
        };
    }

    if (component.props.src) {
        const refreshEnabled = component.props.autoRefresh === true;
        const refreshSeconds = clamp(Number(component.props.refreshInterval) || 5, 1, 3600);
        const src = refreshEnabled
            ? appendTimestampQuery(String(component.props.src), '__ts', Date.now())
            : component.props.src;
        return { kind: 'image', src, autoRefresh: refreshEnabled, refreshInterval: refreshSeconds };
    }

    return {
        kind: 'placeholder',
        title: '上传图片',
        note: '或切换为工作流端口作为图片源'
    };
}

function parseCsvLine(line) {
    const cells = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') {
            if (inQuotes && line[index + 1] === '"') {
                current += '"';
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === ',' && !inQuotes) {
            cells.push(current.trim());
            current = '';
            continue;
        }

        current += char;
    }

    cells.push(current.trim());
    return cells.map(cell => cell.replace(/^"|"$/g, ''));
}

function parseCsvText(text) {
    const lines = String(text || '').trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length < 2) {
        return { error: 'CSV 内容至少需要两行，第一行为列名，第二行为数据。' };
    }

    const headers = parseCsvLine(lines[0]);
    if (headers.length < 2) {
        return { error: 'CSV 头部至少需要两列。' };
    }

    const records = [];
    for (let i = 1; i < lines.length; i += 1) {
        const row = parseCsvLine(lines[i]);
        if (row.length < 2) {
            return { error: `第 ${i + 1} 行数据不完整，至少需要两列。` };
        }

        const record = {};
        headers.forEach((header, index) => {
            record[header] = row[index] ?? '';
        });
        records.push(record);
    }

    if (!records.length) {
        return { error: 'CSV 中未解析到有效数据行。' };
    }

    return { headers, records };
}

function csvEscapeCell(value) {
    const text = value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsvText(rows) {
    if (!Array.isArray(rows) || !rows.length) return '';
    const headerSet = new Set();
    rows.forEach(row => {
        if (row && typeof row === 'object' && !Array.isArray(row)) {
            Object.keys(row).forEach(key => headerSet.add(String(key)));
        }
    });
    const headers = Array.from(headerSet);
    if (!headers.length) return '';
    const lines = [
        headers.map(csvEscapeCell).join(','),
        ...rows.map(row => headers.map(header => csvEscapeCell(row?.[header])).join(','))
    ];
    return lines.join('\n');
}

function objectToCsvText(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return '';
    const headers = Object.keys(record);
    if (!headers.length) return '';
    return [
        headers.map(csvEscapeCell).join(','),
        headers.map(header => csvEscapeCell(record[header])).join(',')
    ].join('\n');
}

function tryParseJsonValue(value) {
    if (typeof value !== 'string') return { ok: false, value: null };
    const trimmed = value.trim();
    if (!trimmed) return { ok: false, value: null };
    if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return { ok: false, value: null };
    try {
        return { ok: true, value: JSON.parse(trimmed) };
    } catch (error) {
        return { ok: false, value: null };
    }
}

function looksLikeImageSource(value) {
    const text = String(value || '').trim();
    if (!text) return false;
    if (text.startsWith('data:image/')) return true;
    if (text.startsWith('blob:')) return true;
    if (text.startsWith('/') || text.startsWith('./') || text.startsWith('../')) return true;
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(text)) return true;
    if (/\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(text)) return true;
    return false;
}

function extractImageSourceFromStructuredValue(rawValue) {
    if (rawValue == null) return { ok: false, reason: 'empty' };

    if (typeof rawValue === 'string') {
        const text = rawValue.trim();
        if (!text) return { ok: false, reason: 'empty' };
        if (looksLikeImageSource(text)) return { ok: true, src: text, sourceType: 'direct' };

        const parsed = tryParseJsonValue(text);
        if (parsed.ok) return extractImageSourceFromStructuredValue(parsed.value);

        return { ok: false, reason: 'not-image-text', text };
    }

    if (Array.isArray(rawValue)) {
        return { ok: false, reason: 'structured-non-image', value: rawValue };
    }

    if (typeof rawValue !== 'object') {
        const text = String(rawValue || '').trim();
        if (looksLikeImageSource(text)) return { ok: true, src: text, sourceType: 'direct' };
        return { ok: false, reason: 'not-image-text', text };
    }

    const payload = unwrapStructuredPayload(rawValue) || rawValue;
    const fileUrls = payload?.file_urls && typeof payload.file_urls === 'object' ? payload.file_urls : null;
    const directCandidates = [
        payload?.forecast_plot_url,
        payload?.raw_plot_url,
        payload?.feature_importance_plot_url,
        payload?.corr_heatmap_plot_url,
        payload?.anomaly_plot_url,
        payload?.image_url,
        payload?.imageUrl,
        payload?.src,
        payload?.url
    ];
    const nestedCandidates = fileUrls
        ? [
            fileUrls.forecast_plot,
            fileUrls.raw_plot,
            fileUrls.feature_importance_plot,
            fileUrls.corr_heatmap_plot,
            fileUrls.anomaly_plot
        ]
        : [];

    const candidate = [...directCandidates, ...nestedCandidates].find(item => looksLikeImageSource(item));
    if (candidate) return { ok: true, src: String(candidate), sourceType: 'structured-image' };

    return { ok: false, reason: 'structured-non-image', value: payload };
}

function extractCsvFromStructuredValue(rawValue, chartType = 'bar') {
    const parsedValue = typeof rawValue === 'string' ? tryParseJsonValue(rawValue) : { ok: false, value: null };
    const value = parsedValue.ok ? parsedValue.value : rawValue;
    const payload = unwrapStructuredPayload(value);
    const datasets = payload?.screen_contract?.datasets || payload?.datasets || null;

    const preferredCsvCandidates = chartType === 'line'
        ? [
            datasets?.timeline_csv,
            datasets?.dimensions_csv,
            payload?.timeline_csv,
            payload?.dimensions_csv,
            payload?.csvText,
            payload?.csv
        ]
        : [
            datasets?.dimensions_csv,
            datasets?.timeline_csv,
            payload?.dimensions_csv,
            payload?.timeline_csv,
            payload?.csvText,
            payload?.csv
        ];

    const directCsv = preferredCsvCandidates.find(candidate => typeof candidate === 'string' && !parseCsvText(candidate).error);
    if (directCsv) return directCsv;

    const preferredRowCandidates = chartType === 'line'
        ? [
            datasets?.timeline,
            datasets?.dimensions,
            payload?.timeline,
            payload?.rows,
            payload?.records,
            payload?.data
        ]
        : [
            datasets?.dimensions,
            datasets?.timeline,
            payload?.dimensions,
            payload?.rows,
            payload?.records,
            payload?.data
        ];

    const rowCandidate = preferredRowCandidates.find(candidate => Array.isArray(candidate) && candidate.length);
    if (Array.isArray(rowCandidate)) {
        const csvText = rowsToCsvText(rowCandidate);
        if (csvText && !parseCsvText(csvText).error) return csvText;
    }

    if (Array.isArray(payload) && payload.length) {
        const csvText = rowsToCsvText(payload);
        if (csvText && !parseCsvText(csvText).error) return csvText;
    }

    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const csvText = objectToCsvText(payload);
        if (csvText && !parseCsvText(csvText).error) return csvText;
    }

    return '';
}

function extractCsvFromPlainText(rawValue) {
    if (typeof rawValue !== 'string') return '';
    const lines = rawValue
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    if (lines.length < 2) return '';

    const rows = [];
    lines.forEach(line => {
        const match = line.match(/^(.+?)[,:：=，\s]+(-?\d+(?:\.\d+)?)(?:\s*[%A-Za-z°/亩kgKGluxLUX]*)?$/);
        if (!match) return;
        rows.push({
            标签: match[1].trim(),
            值: Number(match[2])
        });
    });

    if (rows.length < 2) return '';
    return rowsToCsvText(rows);
}

function resolveChartWorkflowCsvText(rawValue, chartType = 'bar') {
    if (rawValue == null) return '';
    if (typeof rawValue === 'string') {
        const directText = rawValue.trim();
        if (directText && !parseCsvText(directText).error) return rawValue;
        const extracted = extractCsvFromStructuredValue(rawValue, chartType);
        if (extracted) return extracted;
        const plainTextCsv = extractCsvFromPlainText(rawValue);
        return plainTextCsv || rawValue;
    }
    return extractCsvFromStructuredValue(rawValue, chartType) || String(rawValue);
}

function buildTextPayloadForAgriComponent(componentType, text, title = '') {
    const safeTitle = String(title || '').trim();
    const safeText = String(text || '').trim();
    if (!safeText) return null;

    if (componentType === 'agri-model') {
        return {
            model_name: safeTitle || '农业环境抽象模型',
            screen_contract: {
                overview: {
                    title: safeTitle || '农业环境抽象模型',
                    summary: safeText,
                    climate_archetype: '文本摘要',
                    dimension_bars: []
                }
            }
        };
    }

    if (componentType === 'agri-climate') {
        return {
            screen_contract: {
                climate_forecast: {
                    title: safeTitle || '气候趋势预测',
                    microclimate_state: '文本输入',
                    weather_summary: safeText,
                    cards: []
                }
            }
        };
    }

    if (componentType === 'agri-yield') {
        return {
            screen_contract: {
                yield_forecast: {
                    title: safeTitle || '产量预测',
                    yield_grade: '文本输入',
                    narrative: safeText,
                    factor_bars: []
                }
            }
        };
    }

    if (componentType === 'agri-decision') {
        return {
            screen_contract: {
                decision_support: {
                    title: safeTitle || '辅助决策',
                    decision_summary: safeText,
                    top_decision: {
                        action: safeText,
                        reason: '该内容来自文本工作流端口'
                    },
                    modules: []
                }
            }
        };
    }

    return null;
}

function getNumericChartHeaders(parsed) {
    const headers = Array.isArray(parsed?.headers) ? parsed.headers : [];
    const records = Array.isArray(parsed?.records) ? parsed.records : [];
    return headers.filter(header => records.some(record => Number.isFinite(Number(record?.[header]))));
}

function getChartSeriesModeLimit(seriesMode) {
    if (seriesMode === CHART_SERIES_MODE_SINGLE) return 1;
    if (seriesMode === CHART_SERIES_MODE_DOUBLE) return 2;
    return Number.MAX_SAFE_INTEGER;
}

function applyChartSeriesMode(items, seriesMode) {
    return items.slice(0, getChartSeriesModeLimit(seriesMode));
}

function getChartSeriesModeOptions(chartType) {
    if (chartType === 'line') {
        return [
            { value: CHART_SERIES_MODE_SINGLE, label: '单折线图' },
            { value: CHART_SERIES_MODE_DOUBLE, label: '双折线图' },
            { value: CHART_SERIES_MODE_MULTI, label: '多折线图' }
        ];
    }
    return [
        { value: CHART_SERIES_MODE_SINGLE, label: '单柱状图' },
        { value: CHART_SERIES_MODE_DOUBLE, label: '双柱状图' },
        { value: CHART_SERIES_MODE_MULTI, label: '多柱状图' }
    ];
}

function getChartSeriesModeLabel(chartType, seriesMode) {
    const match = getChartSeriesModeOptions(chartType).find(item => item.value === seriesMode);
    return match?.label || (chartType === 'line' ? '多折线图' : '多柱状图');
}

function averageNumericValues(values) {
    const validValues = values.filter(Number.isFinite);
    if (!validValues.length) return null;
    return validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
}

function resolveChartConfig(parsed, component) {
    const headers = Array.isArray(parsed?.headers) ? parsed.headers : [];
    const records = Array.isArray(parsed?.records) ? parsed.records : [];
    const numericHeaders = getNumericChartHeaders(parsed);
    const chartType = component.props.chartType === 'line' || component.props.chartType === 'pie'
        ? component.props.chartType
        : 'bar';
    const seriesMode = chartType === 'pie'
        ? CHART_SERIES_MODE_SINGLE
        : component.props.seriesMode === CHART_SERIES_MODE_SINGLE || component.props.seriesMode === CHART_SERIES_MODE_DOUBLE
            ? component.props.seriesMode
            : CHART_SERIES_MODE_MULTI;
    const fallbackLabelColumn = headers[0] || '';
    const labelColumn = headers.includes(component.props.labelColumn)
        ? component.props.labelColumn
        : fallbackLabelColumn;
    const numericValueCandidates = numericHeaders.filter(header => header !== labelColumn);
    const fallbackValueColumn = numericValueCandidates[0] || numericHeaders[0] || headers.find(header => header !== labelColumn) || '';
    const valueColumn = headers.includes(component.props.valueColumn)
        ? component.props.valueColumn
        : fallbackValueColumn;
    const fallbackSeriesColumn = headers.find(header => header !== labelColumn && header !== valueColumn)
        || headers.find(header => header !== labelColumn)
        || '';
    const seriesColumn = headers.includes(component.props.seriesColumn) && component.props.seriesColumn !== labelColumn
        ? component.props.seriesColumn
        : fallbackSeriesColumn;
    let valueColumns = Array.isArray(component.props.valueColumns)
        ? component.props.valueColumns.filter(header => numericHeaders.includes(header) && header !== labelColumn)
        : [];

    if (!valueColumns.length && valueColumn && numericHeaders.includes(valueColumn) && valueColumn !== labelColumn) {
        valueColumns = [valueColumn];
    }
    if (!valueColumns.length) {
        valueColumns = numericValueCandidates.slice();
    }
    valueColumns = applyChartSeriesMode(valueColumns, seriesMode);

    const requestedLayout = component.props.dataLayout === CHART_DATA_LAYOUT_WIDE
        ? CHART_DATA_LAYOUT_WIDE
        : CHART_DATA_LAYOUT_LONG;
    const uniqueSeriesCount = new Set(
        records
            .map(record => String(record?.[seriesColumn] ?? '').trim())
            .filter(Boolean)
    ).size;
    const hasSeriesRepeats = uniqueSeriesCount > 0 && uniqueSeriesCount < records.length;
    const supportsLongLayout = headers.length >= 3
        && Boolean(labelColumn)
        && Boolean(seriesColumn)
        && Boolean(valueColumn)
        && seriesColumn !== labelColumn
        && seriesColumn !== valueColumn
        && (!numericHeaders.includes(seriesColumn) || hasSeriesRepeats)
        && numericHeaders.includes(valueColumn);
    const seriesOptions = seriesColumn
        ? Array.from(new Set(
            records
                .map(record => String(record?.[seriesColumn] ?? '').trim())
                .filter(Boolean)
        ))
        : [];
    const selectedSeriesKeys = applyChartSeriesMode(
        Array.isArray(component.props.selectedSeriesKeys)
            ? component.props.selectedSeriesKeys.filter(key => seriesOptions.includes(key))
            : [],
        seriesMode
    );

    return {
        chartType,
        labelColumn,
        valueColumn,
        valueColumns,
        seriesColumn,
        seriesMode,
        seriesOptions,
        selectedSeriesKeys,
        dataLayout: chartType === 'pie'
            ? CHART_DATA_LAYOUT_WIDE
            : requestedLayout === CHART_DATA_LAYOUT_WIDE
                ? CHART_DATA_LAYOUT_WIDE
                : supportsLongLayout
                    ? CHART_DATA_LAYOUT_LONG
                    : CHART_DATA_LAYOUT_WIDE,
        enableAggregation: component.props.enableAggregation !== false,
        aggregationLimit: clamp(
            Number(component.props.aggregationLimit) || DEFAULT_CHART_AGGREGATION_LIMIT,
            MIN_CHART_AGGREGATION_LIMIT,
            MAX_CHART_AGGREGATION_LIMIT
        ),
        headers,
        numericHeaders
    };
}

function buildWideChartData(parsed, config) {
    const records = Array.isArray(parsed?.records) ? parsed.records : [];
    if (!config.valueColumns.length) {
        return { error: '宽表模式下至少需要选择一个数值列。' };
    }

    const labels = [];
    const series = config.valueColumns.map(column => ({
        key: column,
        label: column,
        values: []
    }));

    records.forEach((record, index) => {
        const labelText = String(record?.[config.labelColumn] ?? '').trim();
        labels.push(labelText || `行 ${index + 1}`);
        config.valueColumns.forEach((column, seriesIndex) => {
            const value = Number(record?.[column]);
            series[seriesIndex].values.push(Number.isFinite(value) ? value : null);
        });
    });

    const validSeries = series.filter(item => item.values.some(Number.isFinite));
    if (!labels.length || !validSeries.length) {
        return { error: 'CSV 中未解析到有效的宽表图表数据。' };
    }

    return {
        kind: 'series',
        labels,
        series: validSeries,
        pointCount: labels.length,
        seriesCount: validSeries.length,
        layout: CHART_DATA_LAYOUT_WIDE,
        aggregated: false,
        originalPointCount: labels.length,
        aggregationGroupSize: 1
    };
}

function buildLongChartData(parsed, config) {
    const records = Array.isArray(parsed?.records) ? parsed.records : [];
    if (!config.labelColumn || !config.seriesColumn || !config.valueColumn) {
        return { error: '长表模式需要同时指定时间/标签列、系列列和数值列。' };
    }

    const labelBuckets = new Map();
    const labelOrder = [];
    const seriesOrder = [];
    const seriesSeen = new Set();
    let validCount = 0;

    records.forEach((record, index) => {
        const labelText = String(record?.[config.labelColumn] ?? '').trim() || `行 ${index + 1}`;
        const seriesName = String(record?.[config.seriesColumn] ?? '').trim() || '默认系列';
        const value = Number(record?.[config.valueColumn]);

        if (!labelBuckets.has(labelText)) {
            labelBuckets.set(labelText, new Map());
            labelOrder.push(labelText);
        }
        if (!seriesSeen.has(seriesName)) {
            seriesSeen.add(seriesName);
            seriesOrder.push(seriesName);
        }
        if (!Number.isFinite(value)) return;

        validCount += 1;
        const seriesMap = labelBuckets.get(labelText);
        const bucket = seriesMap.get(seriesName) || [];
        bucket.push(value);
        seriesMap.set(seriesName, bucket);
    });

    if (!validCount || !labelOrder.length || !seriesOrder.length) {
        return { error: 'CSV 中未解析到有效的长表图表数据。' };
    }

    const visibleSeriesOrder = config.selectedSeriesKeys.length
        ? config.selectedSeriesKeys.filter(seriesName => seriesOrder.includes(seriesName))
        : applyChartSeriesMode(seriesOrder, config.seriesMode);
    const series = visibleSeriesOrder.map(seriesName => ({
        key: seriesName,
        label: seriesName,
        values: labelOrder.map(label => {
            const values = labelBuckets.get(label)?.get(seriesName) || [];
            return averageNumericValues(values);
        })
    })).filter(item => item.values.some(Number.isFinite));

    if (!series.length) {
        return { error: '按系列分组后未得到可绘制的数据。' };
    }

    return {
        kind: 'series',
        labels: labelOrder,
        series,
        pointCount: labelOrder.length,
        seriesCount: series.length,
        layout: CHART_DATA_LAYOUT_LONG,
        aggregated: false,
        originalPointCount: labelOrder.length,
        aggregationGroupSize: 1
    };
}

function aggregateChartSeriesData(data, aggregationLimit) {
    if (!data || data.kind !== 'series') return data;
    if (!data.labels.length || data.labels.length <= aggregationLimit) return data;

    const groupSize = Math.ceil(data.labels.length / aggregationLimit);
    const aggregatedLabels = [];
    const aggregatedSeries = data.series.map(item => ({
        ...item,
        values: []
    }));

    for (let startIndex = 0; startIndex < data.labels.length; startIndex += groupSize) {
        const endIndex = Math.min(startIndex + groupSize, data.labels.length);
        const labelSlice = data.labels.slice(startIndex, endIndex);
        const firstLabel = labelSlice[0] || '';
        const lastLabel = labelSlice[labelSlice.length - 1] || '';
        aggregatedLabels.push(firstLabel === lastLabel ? firstLabel : `${firstLabel} ~ ${lastLabel}`);

        data.series.forEach((item, seriesIndex) => {
            const values = item.values.slice(startIndex, endIndex);
            aggregatedSeries[seriesIndex].values.push(averageNumericValues(values));
        });
    }

    return {
        ...data,
        labels: aggregatedLabels,
        series: aggregatedSeries,
        pointCount: aggregatedLabels.length,
        aggregated: true,
        originalPointCount: data.labels.length,
        aggregationGroupSize: groupSize
    };
}

function buildPieChartData(parsed, config) {
    const records = Array.isArray(parsed?.records) ? parsed.records : [];
    if (!config.labelColumn || !config.valueColumn) {
        return { error: '饼图需要同时指定标签列和数值列。' };
    }

    const rows = records.map((record, index) => {
        const labelText = String(record?.[config.labelColumn] ?? '').trim();
        const value = Number(record?.[config.valueColumn]);
        return {
            label: labelText || `项 ${index + 1}`,
            value: Number.isFinite(value) ? value : null
        };
    }).filter(item => Number.isFinite(item.value));

    if (!rows.length) {
        return { error: '饼图未解析到有效数值。' };
    }

    return {
        kind: 'pie',
        rows,
        pointCount: rows.length,
        seriesCount: 1
    };
}

function buildChartData(parsed, config) {
    if (config.chartType === 'pie') {
        return buildPieChartData(parsed, config);
    }

    const baseData = config.dataLayout === CHART_DATA_LAYOUT_LONG
        ? buildLongChartData(parsed, config)
        : buildWideChartData(parsed, config);

    if (baseData?.error) return baseData;
    if (!config.enableAggregation) return baseData;
    return aggregateChartSeriesData(baseData, config.aggregationLimit);
}

function getChartRenderState(component) {
    const binding = resolveWorkflowBinding(component);
    let csvText = component.props.csvText || '';
    let sourceNote = '';
    const chartType = component.props.chartType === 'line' || component.props.chartType === 'pie'
        ? component.props.chartType
        : 'bar';

    if (binding.valid) {
        if (binding.runtimeValue?.ok && String(binding.runtimeValue.value ?? '').trim()) {
            csvText = resolveChartWorkflowCsvText(binding.runtimeValue.value, chartType);
            const extractedFromStructured = typeof binding.runtimeValue.value !== 'string'
                || parseCsvText(String(binding.runtimeValue.value ?? '')).error;
            sourceNote = `${binding.label} · ${getPortTypeLabel(binding.port.dataType)}${extractedFromStructured && !parseCsvText(csvText).error ? ' · 已自动提取图表数据' : ''}`;
        } else {
            return {
                chartType,
                csvText: '',
                parsed: { error: '当前工作流端口无可用 CSV 数据。' },
                sourceNote,
                binding,
                config: resolveChartConfig({ headers: [], records: [] }, component)
            };
        }
    }

    const parsed = parseCsvText(csvText);
    if (parsed.error) {
        const fallbackError = binding?.valid && binding.runtimeValue?.source !== 'runtime'
            ? '当前工作流端口返回的是普通文本说明，尚未形成可绘图的表格数据。请先运行工作流，或让端口输出 CSV / 可转换的数值文本。'
            : parsed.error;
        return {
            chartType,
            csvText,
            parsed: { error: fallbackError },
            sourceNote,
            binding,
            config: resolveChartConfig({ headers: [], records: [] }, component)
        };
    }

    const config = resolveChartConfig(parsed, component);
    const chartData = buildChartData(parsed, config);
    return {
        chartType: config.chartType,
        csvText,
        parsed,
        config,
        chartData,
        binding,
        sourceNote
    };
}

function formatChartNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    return new Intl.NumberFormat('zh-CN', {
        maximumFractionDigits: 2
    }).format(number);
}

function truncateChartAxisLabel(label, maxLength = 10) {
    const text = String(label ?? '');
    return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function getChartAxisLabelStep(count) {
    return Math.max(1, Math.ceil(count / 8));
}

function renderChartLegend(items) {
    if (!items.length) return '';
    const markup = items.map(item => `
        <div class="chart-legend-item"><span style="background:${item.color}"></span>${escapeHtml(item.label)}</div>
    `).join('');
    return `<div class="chart-legend">${markup}</div>`;
}

function renderPieChartSvg(data, width, height) {
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    if (!rows.length) {
        return `<div class="chart-error">无有效数据</div>`;
    }

    const padding = 20;
    const innerWidth = Math.max(width - padding * 2, 120);
    const innerHeight = Math.max(height - padding * 2, 120);
    const total = rows.reduce((sum, item) => sum + Math.max(0, Number(item.value) || 0), 0) || 1;
    const radius = Math.min(innerWidth, innerHeight) * 0.35;
    const centerX = width / 2;
    const centerY = height / 2;
    let startAngle = -Math.PI / 2;
    const slices = rows.map((item, index) => {
        const value = Math.max(0, Number(item.value) || 0);
        const angle = (value / total) * Math.PI * 2;
        const endAngle = startAngle + angle;
        const x1 = centerX + radius * Math.cos(startAngle);
        const y1 = centerY + radius * Math.sin(startAngle);
        const x2 = centerX + radius * Math.cos(endAngle);
        const y2 = centerY + radius * Math.sin(endAngle);
        const largeArc = angle > Math.PI ? 1 : 0;
        const path = `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
        startAngle = endAngle;
        return `<path d="${path}" fill="${CHART_COLORS[index % CHART_COLORS.length]}" />`;
    }).join('');

    const legend = renderChartLegend(rows.slice(0, 12).map((item, index) => ({
        label: `${item.label} (${formatChartNumber(item.value)})`,
        color: CHART_COLORS[index % CHART_COLORS.length]
    })));

    return `
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="饼图">
            ${slices}
        </svg>
        ${legend}
    `;
}

function renderSeriesChartSvg(chartType, data, width, height) {
    const labels = Array.isArray(data?.labels) ? data.labels : [];
    const series = Array.isArray(data?.series) ? data.series : [];
    const validValues = series.flatMap(item => item.values.filter(Number.isFinite));

    if (!labels.length || !series.length || !validValues.length) {
        return `<div class="chart-error">无有效数据</div>`;
    }

    const paddingLeft = 46;
    const paddingRight = 18;
    const paddingTop = 18;
    const paddingBottom = 30;
    const innerWidth = Math.max(width - paddingLeft - paddingRight, 120);
    const innerHeight = Math.max(height - paddingTop - paddingBottom, 120);
    const rawMin = Math.min(...validValues, 0);
    const rawMax = Math.max(...validValues, 0);
    const minValue = rawMin > 0 ? 0 : rawMin;
    const maxValue = rawMax < 0 ? 0 : rawMax;
    const valueRange = maxValue - minValue || 1;
    const zeroY = paddingTop + ((maxValue - 0) / valueRange) * innerHeight;
    const axisLabelStep = getChartAxisLabelStep(labels.length);
    const gridCount = 4;
    const axisY = minValue < 0 ? zeroY : paddingTop + innerHeight;
    const legend = series.length > 1
        ? renderChartLegend(series.map((item, index) => ({
            label: item.label,
            color: CHART_COLORS[index % CHART_COLORS.length]
        })))
        : '';
    const gridLines = Array.from({ length: gridCount + 1 }, (_, index) => {
        const ratio = index / gridCount;
        const value = maxValue - ratio * (maxValue - minValue);
        const y = paddingTop + ratio * innerHeight;
        return `
            <line x1="${paddingLeft}" y1="${y}" x2="${paddingLeft + innerWidth}" y2="${y}" stroke="#d7e2ea" stroke-width="1" stroke-dasharray="3 4" />
            <text x="${paddingLeft - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#6b7d8c">${escapeHtml(formatChartNumber(value))}</text>
        `;
    }).join('');

    if (chartType === 'line') {
        const getX = (index) => labels.length === 1
            ? paddingLeft + innerWidth / 2
            : paddingLeft + (index * innerWidth) / Math.max(labels.length - 1, 1);
        const labelsMarkup = labels.map((label, index) => {
            if (index % axisLabelStep !== 0 && index !== labels.length - 1) return '';
            return `
                <text x="${getX(index)}" y="${height - 8}" text-anchor="middle" font-size="10" fill="#475569">${escapeHtml(truncateChartAxisLabel(label))}</text>
            `;
        }).join('');
        const lines = series.map((item, seriesIndex) => {
            const color = CHART_COLORS[seriesIndex % CHART_COLORS.length];
            let pathD = '';
            let pathOpen = false;
            const circles = item.values.map((value, index) => {
                if (!Number.isFinite(value)) {
                    pathOpen = false;
                    return '';
                }
                const x = getX(index);
                const y = paddingTop + ((maxValue - value) / valueRange) * innerHeight;
                pathD += `${pathOpen ? 'L' : 'M'} ${x} ${y} `;
                pathOpen = true;
                return `<circle cx="${x}" cy="${y}" r="3.5" fill="${color}" />`;
            }).join('');
            return `
                <path d="${pathD.trim()}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
                ${circles}
            `;
        }).join('');

        return `
            <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="折线图">
                ${gridLines}
                <line x1="${paddingLeft}" y1="${axisY}" x2="${paddingLeft + innerWidth}" y2="${axisY}" stroke="#9fb3c4" stroke-width="1.2" />
                ${lines}
                ${labelsMarkup}
            </svg>
            ${legend}
        `;
    }

    const categoryWidth = innerWidth / Math.max(labels.length, 1);
    const groupWidth = Math.max(categoryWidth * 0.78, 8);
    const barGap = Math.min(groupWidth * 0.12, 4);
    const barWidth = Math.max((groupWidth - barGap * Math.max(series.length - 1, 0)) / Math.max(series.length, 1), 4);
    const showValueLabels = labels.length <= 12 && series.length <= 2;
    const labelsMarkup = labels.map((label, index) => {
        if (index % axisLabelStep !== 0 && index !== labels.length - 1) return '';
        const x = paddingLeft + categoryWidth * index + categoryWidth / 2;
        return `
            <text x="${x}" y="${height - 8}" text-anchor="middle" font-size="10" fill="#475569">${escapeHtml(truncateChartAxisLabel(label))}</text>
        `;
    }).join('');
    const bars = labels.map((label, labelIndex) => {
        const centerX = paddingLeft + categoryWidth * labelIndex + categoryWidth / 2;
        const groupStart = centerX - groupWidth / 2;
        return series.map((item, seriesIndex) => {
            const value = item.values[labelIndex];
            if (!Number.isFinite(value)) return '';

            const color = CHART_COLORS[seriesIndex % CHART_COLORS.length];
            const x = groupStart + seriesIndex * (barWidth + barGap);
            const y = paddingTop + ((maxValue - Math.max(value, 0)) / valueRange) * innerHeight;
            const yForValue = paddingTop + ((maxValue - value) / valueRange) * innerHeight;
            const barY = value >= 0 ? yForValue : zeroY;
            const barHeight = Math.max(Math.abs(zeroY - yForValue), 1);
            return `
                <rect x="${x}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="${Math.min(4, barWidth / 2)}" fill="${color}" />
                ${showValueLabels ? `<text x="${x + barWidth / 2}" y="${barY - 6}" text-anchor="middle" font-size="10" fill="#102a43">${escapeHtml(formatChartNumber(value))}</text>` : ''}
            `;
        }).join('');
    }).join('');

    return `
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="柱状图">
            ${gridLines}
            <line x1="${paddingLeft}" y1="${axisY}" x2="${paddingLeft + innerWidth}" y2="${axisY}" stroke="#9fb3c4" stroke-width="1.2" />
            ${bars}
            ${labelsMarkup}
        </svg>
        ${legend}
    `;
}

function renderChartSvg(chartState, width, height) {
    if (chartState.chartData?.error) {
        return `<div class="chart-error">${escapeHtml(chartState.chartData.error)}</div>`;
    }
    if (chartState.chartType === 'pie') {
        return renderPieChartSvg(chartState.chartData, width, height);
    }
    return renderSeriesChartSvg(chartState.chartType, chartState.chartData, width, height);
}

function getChartProcessNote(chartState) {
    const chartData = chartState.chartData;
    if (!chartData || chartData.error) return '';

    if (chartState.chartType === 'pie') {
        return `饼图 · ${chartData.pointCount} 个分类项`;
    }

    const modeLabel = getChartSeriesModeLabel(chartState.chartType, chartState.config?.seriesMode || CHART_SERIES_MODE_MULTI);
    const actualSeriesLabel = chartData.seriesCount <= 1
        ? '当前显示 1 个系列'
        : `当前显示 ${chartData.seriesCount} 个系列`;
    const layoutLabel = chartState.config?.dataLayout === CHART_DATA_LAYOUT_LONG ? '长表布局' : '宽表布局';
    if (chartData.aggregated) {
        return `${modeLabel} · ${layoutLabel} · ${actualSeriesLabel} · 已按相邻 ${chartData.aggregationGroupSize} 条平均聚合 ${chartData.originalPointCount} -> ${chartData.pointCount}`;
    }
    return `${modeLabel} · ${layoutLabel} · ${actualSeriesLabel} · ${chartData.pointCount} 个点`;
}

function getChartPreviewHtml(component) {
    const chartState = getChartRenderState(component);
    if (chartState.parsed?.error) {
        return `<div class="chart-error">${escapeHtml(chartState.parsed.error)}</div>`;
    }
    if (chartState.chartData?.error) {
        return `<div class="chart-error">${escapeHtml(chartState.chartData.error)}</div>`;
    }

    const title = component.props.title || '';
    const processNote = getChartProcessNote(chartState);
    const showLegend = chartState.chartType === 'pie' || (chartState.chartData?.seriesCount || 0) > 1;
    const infoBlockCount = [title, chartState.sourceNote, processNote].filter(Boolean).length;
    const width = Math.max(component.width - 24, 160);
    const height = Math.max(component.height - 24 - infoBlockCount * 34 - (showLegend ? 54 : 0), 120);

    return `
        <div class="chart-wrapper">
            ${title ? `<div class="chart-title">${escapeHtml(title)}</div>` : ''}
            ${chartState.sourceNote ? `<div class="chart-source-note">${escapeHtml(chartState.sourceNote)}</div>` : ''}
            ${processNote ? `<div class="chart-process-note">${escapeHtml(processNote)}</div>` : ''}
            ${renderChartSvg(chartState, width, height)}
        </div>
    `;
}

function parseStructuredJson(text) {
    try {
        return { ok: true, value: JSON.parse(String(text || '').trim() || '{}') };
    } catch (error) {
        return { ok: false, error: error?.message || 'JSON 解析失败' };
    }
}

function unwrapStructuredPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (payload.data && typeof payload.data === 'object') return payload.data;
    if (payload.prediction && typeof payload.prediction === 'object' && !payload.screen_contract) return payload.prediction;
    return payload;
}

function normalizeSourcePayloadText(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch (error) {
        return String(value);
    }
}

function getStructuredAgriRenderState(component) {
    const binding = resolveWorkflowBinding(component);
    let jsonText = component?.props?.jsonText || '';
    let sourceNote = '';

    if (binding.valid) {
        if (binding.runtimeValue?.ok) {
            jsonText = normalizeSourcePayloadText(binding.runtimeValue.value);
            sourceNote = `${binding.label} · ${getPortTypeLabel(binding.port.dataType)}`;
        } else {
            return {
                error: '当前工作流端口暂无可用模型数据。',
                sourceNote: `${binding.label} · 端口值不可用`,
                payload: null
            };
        }
    } else if (binding.mode === SOURCE_MODE_WORKFLOW_PORT) {
        return {
            error: '请选择一个有效的文本工作流端口。',
            sourceNote: '',
            payload: null
        };
    }

    const parsed = parseStructuredJson(jsonText);
    if (!parsed.ok) {
        const textPayload = buildTextPayloadForAgriComponent(component?.type, jsonText, component?.props?.title);
        if (textPayload) {
            return {
                payload: textPayload,
                sourceNote: sourceNote ? `${sourceNote} · 已按文本摘要渲染` : '已按文本摘要渲染',
                error: ''
            };
        }
        return {
            error: `JSON 解析失败：${parsed.error}`,
            sourceNote,
            payload: null
        };
    }

    const payload = unwrapStructuredPayload(parsed.value);
    if (!payload) {
        return {
            error: '未解析到可用的结构化数据对象。',
            sourceNote,
            payload: null
        };
    }

    return {
        payload,
        sourceNote,
        error: ''
    };
}

function formatMetricValue(value, unit = '', digits = 1) {
    if (!Number.isFinite(Number(value))) return `--${unit ? ` ${unit}` : ''}`;
    const numeric = Number(value);
    const text = digits === 0 ? String(Math.round(numeric)) : numeric.toFixed(digits);
    return `${text}${unit ? ` ${unit}` : ''}`;
}

function renderInsightBars(items = [], valueSuffix = '') {
    return (Array.isArray(items) ? items : []).slice(0, 6).map(item => {
        const score = Math.max(0, Math.min(100, Number(item?.score) || 0));
        return `
            <div class="agri-bar-item">
                <div class="agri-bar-head">
                    <span>${escapeHtml(String(item?.label || item?.key || '指标'))}</span>
                    <strong>${escapeHtml(`${score.toFixed(1)}${valueSuffix}`)}</strong>
                </div>
                <div class="agri-bar-track"><span style="width:${score}%"></span></div>
                ${item?.level ? `<div class="agri-bar-meta">${escapeHtml(String(item.level))}</div>` : ''}
            </div>
        `;
    }).join('');
}

function getAgriModelView(payload) {
    const contract = payload?.screen_contract || {};
    const overview = contract.overview || {};
    const latentState = payload?.latent_state || {};
    const datasetProfile = payload?.dataset_profile || {};
    return {
        title: overview.title || payload?.model_name || '农业环境抽象模型',
        summary: overview.summary || payload?.external_view?.summary || '暂无模型摘要。',
        climateArchetype: overview.climate_archetype || latentState.climate_archetype || '未识别',
        riskScore: overview.risk_score,
        confidence: overview.confidence,
        sampleCount: overview.sample_count || datasetProfile.sample_count,
        dominant: overview.dominant_dimension || latentState.dominant_dimension || {},
        weakest: overview.weakest_dimension || latentState.weakest_dimension || {},
        updatedAt: overview.updated_at || datasetProfile.time_end || '',
        dimensionBars: overview.dimension_bars || contract.datasets?.dimensions || []
    };
}

function getAgriClimateView(payload) {
    const contract = payload?.screen_contract || {};
    const climate = contract.climate_forecast || payload?.predictions?.microclimate_forecast || payload;
    const predictions = climate?.predictions || {};
    const cards = Array.isArray(climate?.cards) && climate.cards.length
        ? climate.cards
        : [
            {
                label: '未来6小时温度',
                value: predictions?.temperature?.next_6h,
                unit: '°C',
                trend: predictions?.temperature?.trend || '未知'
            },
            {
                label: '未来6小时湿度',
                value: predictions?.humidity?.next_6h,
                unit: '%',
                trend: predictions?.humidity?.trend || '未知'
            },
            {
                label: '未来6小时土壤湿度',
                value: predictions?.soil_humidity?.next_6h,
                unit: '%',
                trend: predictions?.soil_humidity?.trend || '未知'
            }
        ];
    return {
        title: climate?.title || '气候趋势预测',
        microclimateState: climate?.microclimate_state || payload?.latent_state?.climate_archetype || '未识别',
        summary: climate?.weather_summary || payload?.predictions?.weather_tendency?.summary || '暂无气候趋势描述。',
        confidence: climate?.confidence,
        cards
    };
}

function getAgriYieldView(payload) {
    const contract = payload?.screen_contract || {};
    const yieldForecast = contract.yield_forecast || payload?.predictions?.yield_projection || payload;
    return {
        title: yieldForecast?.title || '产量预测',
        yieldIndex: yieldForecast?.yield_index,
        estimatedYield: yieldForecast?.estimated_yield_kg_per_mu,
        grade: yieldForecast?.yield_grade || '待评估',
        narrative: yieldForecast?.narrative || '暂无产量说明。',
        factors: yieldForecast?.factor_bars || []
    };
}

function getAgriDecisionView(payload) {
    const contract = payload?.screen_contract || {};
    const decision = contract.decision_support || payload?.decision_outputs || payload;
    return {
        title: decision?.title || '辅助决策',
        summary: decision?.decision_summary || '暂无决策摘要。',
        topDecision: decision?.top_decision || {},
        riskScore: decision?.risk_score,
        modules: Array.isArray(decision?.modules) ? decision.modules : []
    };
}

function cleanAgriSummaryText(text) {
    let next = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!next) return '';
    next = next.replace(/^[`"'“”]+|[`"'“”]+$/g, '');
    next = next.replace(/[【】]/g, ' ');
    next = next.replace(/[{}\[\]]/g, ' ');
    next = next.replace(/[ \t]{2,}/g, ' ');
    next = next.replace(/\n{3,}/g, '\n\n');
    return next.trim();
}

function isMeaningfulAgriSummaryText(text) {
    const next = cleanAgriSummaryText(text);
    if (!next) return false;
    const lowered = next.toLowerCase();
    return lowered !== 'ok' && lowered !== 'null' && lowered !== 'undefined' && lowered !== 'waiting';
}

function collectAgriSummaryTexts(items = [], limit = 6) {
    const result = [];
    const seen = new Set();

    for (const item of items) {
        const text = cleanAgriSummaryText(item);
        if (!isMeaningfulAgriSummaryText(text)) continue;
        if (seen.has(text)) continue;
        seen.add(text);
        result.push(text);
        if (result.length >= limit) break;
    }

    return result;
}

function pickFirstAgriSummaryText(items = []) {
    return collectAgriSummaryTexts(items, 1)[0] || '';
}

function mapAgriSummaryMetricName(key) {
    const labels = {
        temperature: '温度',
        humidity: '空气湿度',
        soil_humidity: '土壤湿度',
        pm25: 'PM2.5',
        light_lux: '光照',
        work_status: '运行状态',
        risk_score: '风险分数',
        alert_count: '告警数量',
        sample_count: '样本量',
        confidence: '置信度',
        yield_index: '产量指数',
        estimated_yield_kg_per_mu: '亩产估算',
        data_freshness_minutes: '数据新鲜度',
        timeline_points: '趋势点数',
        priority: '优先级'
    };
    return labels[key] || cleanAgriSummaryText(key);
}

function mapAgriAlertLevel(level) {
    const normalized = String(level || '').trim().toLowerCase();
    if (normalized === 'high') return '高风险';
    if (normalized === 'medium') return '中风险';
    if (normalized === 'low') return '低风险';
    return cleanAgriSummaryText(level) || '风险提示';
}

function mapAgriPriorityLabel(priority) {
    const normalized = String(priority || '').trim().toUpperCase();
    if (!normalized) return '待定';
    return normalized;
}

function mapAgriMetricLabel(metric) {
    return mapAgriSummaryMetricName(metric);
}

function formatAgriSummaryMetricValue(key, value) {
    if (value == null || value === '') return '';
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (!Number.isFinite(Number(value))) return cleanAgriSummaryText(value);

    const numeric = Number(value);
    if (key === 'temperature' || key === 'avg_temperature_24h') return `${numeric.toFixed(1)} °C`;
    if (key === 'humidity' || key === 'avg_humidity_24h' || key === 'soil_humidity' || key === 'avg_soil_humidity_24h') return `${numeric.toFixed(1)} %`;
    if (key === 'pm25' || key === 'avg_pm25_24h') return `${numeric.toFixed(1)} ug/m3`;
    if (key === 'light_lux' || key === 'max_light_24h') return `${Math.round(numeric)} Lux`;
    if (key === 'estimated_yield_kg_per_mu') return `${numeric.toFixed(1)} kg/亩`;
    if (key === 'data_freshness_minutes') return `${numeric.toFixed(1)} 分钟`;
    if (key === 'confidence') return `${numeric.toFixed(1)} %`;
    if (Number.isInteger(numeric)) return String(numeric);
    return numeric.toFixed(1);
}

function pushAgriSummaryMetric(metrics, label, value) {
    const safeLabel = cleanAgriSummaryText(label);
    const safeValue = cleanAgriSummaryText(value);
    if (!safeLabel || !safeValue) return;
    metrics.push({ label: safeLabel, value: safeValue });
}

function pushAgriSummarySection(sections, title, items, limit = 4) {
    const safeItems = collectAgriSummaryTexts(items, limit);
    if (!safeItems.length) return;
    sections.push({
        title: cleanAgriSummaryText(title) || '摘要内容',
        items: safeItems.slice(0, limit)
    });
}

function buildAgriLatestReadingText(reading) {
    if (!reading || typeof reading !== 'object') return '';
    const parts = [];
    if (reading.temperature != null) parts.push(`温度 ${formatAgriSummaryMetricValue('temperature', reading.temperature)}`);
    if (reading.humidity != null) parts.push(`空气湿度 ${formatAgriSummaryMetricValue('humidity', reading.humidity)}`);
    if (reading.soil_humidity != null) parts.push(`土壤湿度 ${formatAgriSummaryMetricValue('soil_humidity', reading.soil_humidity)}`);
    if (reading.pm25 != null) parts.push(`PM2.5 ${formatAgriSummaryMetricValue('pm25', reading.pm25)}`);
    if (reading.light_lux != null) parts.push(`光照 ${formatAgriSummaryMetricValue('light_lux', reading.light_lux)}`);
    const suffix = cleanAgriSummaryText(reading.timestamp) ? `，采集时间 ${cleanAgriSummaryText(reading.timestamp)}` : '';
    return parts.length ? `${parts.join('，')}${suffix}` : '';
}

function buildAgriAlertLine(item) {
    if (!item || typeof item !== 'object') return cleanAgriSummaryText(item);
    const head = `[${mapAgriAlertLevel(item.level)}] ${cleanAgriSummaryText(item.message) || cleanAgriSummaryText(item.metric) || '存在风险提示'}`;
    const suggestion = cleanAgriSummaryText(item.suggestion);
    return suggestion ? `${head} 建议：${suggestion}` : head;
}

function buildAgriRecommendationLine(item) {
    if (!item || typeof item !== 'object') return cleanAgriSummaryText(item);
    const priority = mapAgriPriorityLabel(item.priority);
    const title = cleanAgriSummaryText(item.title) || cleanAgriSummaryText(item.action) || '建议项';
    const detail = cleanAgriSummaryText(item.detail) || cleanAgriSummaryText(item.reason);
    const effect = cleanAgriSummaryText(item.expected_effect);
    const base = `[${priority}] ${title}${detail ? `：${detail}` : ''}`;
    return effect ? `${base} 预期效果：${effect}` : base;
}

function buildAgriDecisionLine(item) {
    if (!item || typeof item !== 'object') return cleanAgriSummaryText(item);
    const module = cleanAgriSummaryText(item.module);
    const action = cleanAgriSummaryText(item.action) || '待执行';
    const reason = cleanAgriSummaryText(item.reason);
    const priority = mapAgriPriorityLabel(item.priority);
    const score = item.score != null ? ` · 评分 ${formatAgriSummaryMetricValue('score', item.score)}` : '';
    const prefix = module ? `[${priority}] ${module} / ${action}` : `[${priority}] ${action}`;
    return `${prefix}${score}${reason ? `：${reason}` : ''}`;
}

function buildAgriFactorLine(item) {
    if (!item || typeof item !== 'object') return cleanAgriSummaryText(item);
    const label = cleanAgriSummaryText(item.label) || cleanAgriSummaryText(item.key) || '影响因子';
    const score = item.score != null ? formatAgriSummaryMetricValue('score', item.score) : '';
    const level = cleanAgriSummaryText(item.level);
    return `${label}${score ? `：${score}` : ''}${level ? `（${level}）` : ''}`;
}

function buildGenericAgriSummaryLine(item) {
    if (item == null) return '';
    if (typeof item !== 'object') return cleanAgriSummaryText(item);
    if (item.message || item.suggestion) return buildAgriAlertLine(item);
    if (item.title || item.detail || item.expected_effect) return buildAgriRecommendationLine(item);
    if (item.action || item.reason || item.module) return buildAgriDecisionLine(item);
    if (item.label || item.score != null) return buildAgriFactorLine(item);

    const parts = [];
    Object.entries(item).forEach(([key, value]) => {
        if (value == null || value === '' || typeof value === 'object') return;
        parts.push(`${mapAgriSummaryMetricName(key)}：${cleanAgriSummaryText(value)}`);
    });
    return cleanAgriSummaryText(parts.join('，'));
}

function getAgriSummaryPayloadValue(rawValue) {
    if (rawValue == null) return { type: 'text', value: '' };
    if (Array.isArray(rawValue)) return { type: 'structured', value: rawValue };
    if (typeof rawValue === 'object') return { type: 'structured', value: unwrapStructuredPayload(rawValue) || rawValue };
    const text = String(rawValue || '').trim();
    if (!text) return { type: 'text', value: '' };
    const parsed = parseStructuredJson(text);
    if (parsed.ok) {
        return {
            type: 'structured',
            value: unwrapStructuredPayload(parsed.value) || parsed.value
        };
    }
    return { type: 'text', value: text };
}

function buildAgriSummaryTextView(text, title = '') {
    const safeTitle = cleanAgriSummaryText(title) || '农业分析摘要';
    const normalizedText = cleanAgriSummaryText(text);
    const sentences = collectAgriSummaryTexts(
        normalizedText
            .split(/\n+|[。！？；]+/u)
            .map(item => item.trim()),
        6
    );
    const lead = sentences[0] || normalizedText || '暂无摘要内容。';
    const secondary = sentences[1] || '';
    const sections = [];
    pushAgriSummarySection(sections, '摘要内容', sentences.slice(1), 4);

    return {
        title: safeTitle,
        chip: '文本摘要',
        lead,
        secondary,
        metrics: [],
        sections
    };
}

function buildAgriOverviewSummaryView(payload, title = '') {
    const safeTitle = cleanAgriSummaryText(title) || '总览分析摘要';
    const metrics = [];
    const sections = [];

    pushAgriSummaryMetric(metrics, '设备', cleanAgriSummaryText(payload.device_name));
    pushAgriSummaryMetric(metrics, '运行状态', cleanAgriSummaryText(payload.work_status || (payload.online ? '在线' : payload.online === false ? '离线' : '')));
    pushAgriSummaryMetric(metrics, '风险分数', formatAgriSummaryMetricValue('risk_score', payload.risk_score));
    pushAgriSummaryMetric(metrics, '告警数量', formatAgriSummaryMetricValue('alert_count', payload.alert_count));

    const lead = pickFirstAgriSummaryText([
        payload.observation,
        payload.summary,
        payload.message
    ]) || '当前暂无可读的总览结论。';

    const secondary = pickFirstAgriSummaryText([
        buildAgriLatestReadingText(payload.latest_reading),
        payload.location ? `监测位置：${cleanAgriSummaryText(payload.location)}` : '',
        payload.data_freshness_minutes != null ? `数据距今约 ${formatAgriSummaryMetricValue('data_freshness_minutes', payload.data_freshness_minutes)}` : ''
    ]);

    pushAgriSummarySection(sections, '最新观测', [
        buildAgriLatestReadingText(payload.latest_reading)
    ], 1);

    pushAgriSummarySection(sections, '运行信息', [
        payload.location ? `监测位置：${cleanAgriSummaryText(payload.location)}` : '',
        payload.total_records != null ? `历史记录 ${formatAgriSummaryMetricValue('total_records', payload.total_records)} 条` : '',
        payload.data_freshness_minutes != null ? `数据距今约 ${formatAgriSummaryMetricValue('data_freshness_minutes', payload.data_freshness_minutes)}` : ''
    ], 3);

    return {
        title: safeTitle,
        chip: '总览概况',
        lead,
        secondary,
        metrics: metrics.slice(0, 4),
        sections
    };
}

function buildAgriAlertsSummaryView(payload, title = '') {
    const items = Array.isArray(payload) ? payload : (Array.isArray(payload.alerts) ? payload.alerts : []);
    const safeTitle = cleanAgriSummaryText(title) || '告警分析摘要';
    const highCount = items.filter(item => String(item?.level || '').toLowerCase() === 'high').length;
    const metrics = [];
    const sections = [];

    pushAgriSummaryMetric(metrics, '告警数量', String(items.length));
    pushAgriSummaryMetric(metrics, '高风险', String(highCount));
    pushAgriSummaryMetric(metrics, '重点指标', mapAgriMetricLabel(items[0]?.metric));

    const lead = pickFirstAgriSummaryText(items.map(item => item?.message))
        || `当前共识别 ${items.length} 条风险告警。`;
    const secondary = pickFirstAgriSummaryText(items.map(item => item?.suggestion ? `建议：${item.suggestion}` : ''));

    pushAgriSummarySection(sections, '风险告警', items.map(buildAgriAlertLine), 4);
    pushAgriSummarySection(sections, '处置建议', items.map(item => item?.suggestion), 4);

    return {
        title: safeTitle,
        chip: '风险告警',
        lead,
        secondary,
        metrics,
        sections
    };
}

function buildAgriRecommendationsSummaryView(payload, title = '') {
    const items = Array.isArray(payload) ? payload : (Array.isArray(payload.recommendations) ? payload.recommendations : []);
    const safeTitle = cleanAgriSummaryText(title) || '决策建议摘要';
    const topPriority = items
        .map(item => mapAgriPriorityLabel(item?.priority))
        .sort()[0] || '';
    const metrics = [];
    const sections = [];

    pushAgriSummaryMetric(metrics, '建议数量', String(items.length));
    pushAgriSummaryMetric(metrics, '最高优先级', topPriority);

    const lead = pickFirstAgriSummaryText([
        ...items.map(item => item?.detail),
        ...items.map(item => item?.title)
    ]) || `当前共生成 ${items.length} 条处置建议。`;
    const secondary = pickFirstAgriSummaryText(items.map(item => item?.expected_effect ? `预期效果：${item.expected_effect}` : ''));

    pushAgriSummarySection(sections, '处置建议', items.map(buildAgriRecommendationLine), 4);
    pushAgriSummarySection(sections, '预期效果', items.map(item => item?.expected_effect), 3);

    return {
        title: safeTitle,
        chip: '策略建议',
        lead,
        secondary,
        metrics,
        sections
    };
}

function buildAgriDecisionSummaryView(payload, title = '') {
    const safeTitle = cleanAgriSummaryText(title) || '辅助决策摘要';
    const topDecision = payload?.top_decision || {};
    const modules = Array.isArray(payload?.modules) ? payload.modules : [];
    const metrics = [];
    const sections = [];

    pushAgriSummaryMetric(metrics, '风险分数', formatAgriSummaryMetricValue('risk_score', payload?.risk_score));
    pushAgriSummaryMetric(metrics, '产量指数', formatAgriSummaryMetricValue('yield_index', payload?.yield_index));
    pushAgriSummaryMetric(metrics, '优先级', mapAgriPriorityLabel(topDecision.priority));

    const lead = pickFirstAgriSummaryText([
        payload?.decision_summary,
        topDecision?.action
    ]) || '当前暂无可读的决策摘要。';
    const secondary = pickFirstAgriSummaryText([topDecision?.reason]);

    pushAgriSummarySection(sections, '执行建议', modules.map(buildAgriDecisionLine), 4);

    return {
        title: safeTitle,
        chip: '辅助决策',
        lead,
        secondary,
        metrics,
        sections
    };
}

function buildAgriForecastSummaryView(payload, title = '') {
    const safeTitle = cleanAgriSummaryText(title) || '气候趋势摘要';
    const predictions = payload?.predictions || {};
    const metrics = [];
    const sections = [];

    pushAgriSummaryMetric(metrics, '置信度', formatAgriSummaryMetricValue('confidence', payload?.confidence));
    pushAgriSummaryMetric(metrics, '样本量', formatAgriSummaryMetricValue('sample_count', payload?.sample_count));
    pushAgriSummaryMetric(metrics, '微气候', cleanAgriSummaryText(payload?.microclimate_state));

    const lead = pickFirstAgriSummaryText([
        payload?.weather_summary,
        payload?.summary
    ]) || '当前暂无可读的气候趋势说明。';

    pushAgriSummarySection(sections, '预测指标', [
        predictions?.temperature?.next_6h != null ? `未来 6 小时温度 ${formatAgriSummaryMetricValue('temperature', predictions.temperature.next_6h)}，趋势 ${cleanAgriSummaryText(predictions.temperature?.trend)}` : '',
        predictions?.humidity?.next_6h != null ? `未来 6 小时空气湿度 ${formatAgriSummaryMetricValue('humidity', predictions.humidity.next_6h)}，趋势 ${cleanAgriSummaryText(predictions.humidity?.trend)}` : '',
        predictions?.soil_humidity?.next_6h != null ? `未来 6 小时土壤湿度 ${formatAgriSummaryMetricValue('soil_humidity', predictions.soil_humidity.next_6h)}，趋势 ${cleanAgriSummaryText(predictions.soil_humidity?.trend)}` : ''
    ], 3);

    return {
        title: safeTitle,
        chip: '气候预测',
        lead,
        secondary: '',
        metrics,
        sections
    };
}

function buildAgriYieldSummaryView(payload, title = '') {
    const safeTitle = cleanAgriSummaryText(title) || '产量预测摘要';
    const factors = Array.isArray(payload?.factor_bars)
        ? payload.factor_bars
        : Array.isArray(payload?.factors)
            ? payload.factors
            : Object.entries(payload?.factors || {}).map(([key, value]) => ({ label: mapAgriSummaryMetricName(key), score: value }));
    const metrics = [];
    const sections = [];

    pushAgriSummaryMetric(metrics, '产量指数', formatAgriSummaryMetricValue('yield_index', payload?.yield_index));
    pushAgriSummaryMetric(metrics, '亩产估算', formatAgriSummaryMetricValue('estimated_yield_kg_per_mu', payload?.estimated_yield_kg_per_mu));
    pushAgriSummaryMetric(metrics, '等级', cleanAgriSummaryText(payload?.yield_grade));

    const lead = pickFirstAgriSummaryText([
        payload?.narrative,
        payload?.summary
    ]) || '当前暂无可读的产量预测说明。';

    pushAgriSummarySection(sections, '影响因子', factors.map(buildAgriFactorLine), 4);

    return {
        title: safeTitle,
        chip: '产量预测',
        lead,
        secondary: '',
        metrics,
        sections
    };
}

function buildAgriReportSummaryView(payload, title = '') {
    const safeTitle = cleanAgriSummaryText(title) || '农业分析报告';
    const overview = payload?.overview && typeof payload.overview === 'object' ? payload.overview : {};
    const alerts = Array.isArray(payload?.alerts) ? payload.alerts : [];
    const recommendations = Array.isArray(payload?.recommendations) ? payload.recommendations : [];
    const highlights = Array.isArray(payload?.contest_fit?.highlights) ? payload.contest_fit.highlights : [];
    const outline = Array.isArray(payload?.report_outline) ? payload.report_outline : [];
    const metrics = [];
    const sections = [];

    pushAgriSummaryMetric(metrics, '风险分数', formatAgriSummaryMetricValue('risk_score', overview?.risk_score));
    pushAgriSummaryMetric(metrics, '告警数量', formatAgriSummaryMetricValue('alert_count', overview?.alert_count));
    pushAgriSummaryMetric(metrics, '趋势点数', formatAgriSummaryMetricValue('timeline_points', payload?.trend_summary?.timeline_points));

    const lead = pickFirstAgriSummaryText([
        overview?.observation,
        payload?.summary,
        payload?.contest_fit?.scenario,
        highlights[0]
    ]) || '当前暂无可读的报告摘要。';
    const secondary = pickFirstAgriSummaryText([
        overview?.location ? `监测位置：${overview.location}` : '',
        buildAgriLatestReadingText(overview?.latest_reading)
    ]);

    pushAgriSummarySection(sections, '关键亮点', highlights, 3);
    pushAgriSummarySection(sections, '报告提纲', outline, 3);
    pushAgriSummarySection(
        sections,
        alerts.length >= recommendations.length ? '风险告警' : '处置建议',
        alerts.length >= recommendations.length ? alerts.map(buildAgriAlertLine) : recommendations.map(buildAgriRecommendationLine),
        3
    );

    return {
        title: safeTitle,
        chip: '报告摘要',
        lead,
        secondary,
        metrics,
        sections
    };
}

function buildGenericAgriObjectSummaryView(payload, title = '') {
    const safeTitle = cleanAgriSummaryText(title) || '农业分析摘要';
    const metrics = [];
    const sections = [];
    const primitiveTexts = [];

    Object.entries(payload || {}).forEach(([key, value]) => {
        if (value == null || value === '') return;
        if (Array.isArray(value)) {
            pushAgriSummarySection(sections, mapAgriSummaryMetricName(key), value.map(buildGenericAgriSummaryLine), 3);
            return;
        }
        if (typeof value === 'object') return;
        const label = mapAgriSummaryMetricName(key);
        const formattedValue = formatAgriSummaryMetricValue(key, value) || cleanAgriSummaryText(value);
        if (metrics.length < 4) pushAgriSummaryMetric(metrics, label, formattedValue);
        primitiveTexts.push(`${label}：${formattedValue}`);
    });

    const lead = pickFirstAgriSummaryText(primitiveTexts) || '当前暂无可读的结构化摘要。';

    return {
        title: safeTitle,
        chip: '结构化摘要',
        lead,
        secondary: '',
        metrics,
        sections
    };
}

function buildGenericAgriListSummaryView(items, title = '') {
    const safeTitle = cleanAgriSummaryText(title) || '农业分析摘要';
    const lines = collectAgriSummaryTexts((Array.isArray(items) ? items : []).map(buildGenericAgriSummaryLine), 6);
    const metrics = [];
    const sections = [];

    pushAgriSummaryMetric(metrics, '条目数', String(Array.isArray(items) ? items.length : 0));
    pushAgriSummarySection(sections, '摘要条目', lines.slice(1), 4);

    return {
        title: safeTitle,
        chip: '列表摘要',
        lead: lines[0] || '暂无可读的列表摘要。',
        secondary: lines[1] || '',
        metrics,
        sections
    };
}

function buildAgriSummaryView(payloadValue, title = '') {
    if (Array.isArray(payloadValue)) {
        if (payloadValue.some(item => item && typeof item === 'object' && (item.message || item.suggestion))) {
            return buildAgriAlertsSummaryView(payloadValue, title);
        }
        if (payloadValue.some(item => item && typeof item === 'object' && (item.title || item.detail || item.expected_effect))) {
            return buildAgriRecommendationsSummaryView(payloadValue, title);
        }
        return buildGenericAgriListSummaryView(payloadValue, title);
    }

    if (payloadValue && typeof payloadValue === 'object') {
        if (payloadValue.contest_fit || payloadValue.report_outline || payloadValue.overview || payloadValue.alerts || payloadValue.recommendations) {
            return buildAgriReportSummaryView(payloadValue, title);
        }
        if (payloadValue.decision_summary || payloadValue.top_decision || payloadValue.modules) {
            return buildAgriDecisionSummaryView(payloadValue, title);
        }
        if (payloadValue.weather_summary || payloadValue.microclimate_state || payloadValue.predictions) {
            return buildAgriForecastSummaryView(payloadValue, title);
        }
        if (payloadValue.yield_index != null || payloadValue.estimated_yield_kg_per_mu != null || payloadValue.yield_grade || payloadValue.narrative) {
            return buildAgriYieldSummaryView(payloadValue, title);
        }
        if (payloadValue.observation || payloadValue.latest_reading || payloadValue.risk_score != null || payloadValue.alert_count != null || payloadValue.device_name) {
            return buildAgriOverviewSummaryView(payloadValue, title);
        }
        if (payloadValue.status || payloadValue.message) {
            return buildAgriSummaryTextView(payloadValue.message || `当前状态：${payloadValue.status}`, title);
        }
        return buildGenericAgriObjectSummaryView(payloadValue, title);
    }

    return buildAgriSummaryTextView(payloadValue, title);
}

function getAgriSummaryRenderState(component) {
    const binding = resolveWorkflowBinding(component);
    let rawValue = component?.props?.jsonText || '';
    let sourceNote = '';

    if (binding.valid) {
        if (binding.runtimeValue?.ok) {
            rawValue = binding.runtimeValue.value;
            sourceNote = `${binding.label} · ${getPortTypeLabel(binding.port.dataType)}`;
        } else {
            return {
                error: '当前工作流端口暂无可用摘要数据。',
                sourceNote: `${binding.label} · 端口值不可用`,
                view: null
            };
        }
    } else if (binding.mode === SOURCE_MODE_WORKFLOW_PORT) {
        return {
            error: '请选择一个有效的分析摘要工作流端口。',
            sourceNote: '',
            view: null
        };
    }

    const payload = getAgriSummaryPayloadValue(rawValue);
    const view = buildAgriSummaryView(payload.value, component?.props?.title);
    if (!view || (!view.lead && !view.sections?.length && !view.metrics?.length)) {
        return {
            error: '暂无可显示的摘要内容。',
            sourceNote,
            view: null
        };
    }

    return {
        error: '',
        sourceNote,
        view
    };
}

function renderAgriModelMarkup(component) {
    const state = getStructuredAgriRenderState(component);
    if (state.error) {
        return `<div class="chart-error">${escapeHtml(state.error)}</div>`;
    }
    const view = getAgriModelView(state.payload);
    return `
        <div class="agri-panel agri-model-panel">
            <div class="agri-panel-head">
                <div>
                    <div class="agri-panel-eyebrow">Agri Twin / Model</div>
                    <div class="agri-panel-title">${escapeHtml(component.props.title || view.title)}</div>
                </div>
                <div class="agri-mode-chip">${escapeHtml(String(view.climateArchetype || '未识别'))}</div>
            </div>
            ${state.sourceNote ? `<div class="chart-source-note">${escapeHtml(state.sourceNote)}</div>` : ''}
            <div class="agri-model-summary">${escapeHtml(view.summary || '暂无模型摘要。')}</div>
            <div class="agri-kpi-grid">
                <div class="agri-kpi-card"><span class="agri-kpi-label">样本量</span><span class="agri-kpi-value">${escapeHtml(String(view.sampleCount ?? '--'))}</span></div>
                <div class="agri-kpi-card"><span class="agri-kpi-label">风险分数</span><span class="agri-kpi-value">${escapeHtml(formatMetricValue(view.riskScore, '', 1))}</span></div>
                <div class="agri-kpi-card"><span class="agri-kpi-label">主导维度</span><span class="agri-kpi-value agri-kpi-small">${escapeHtml(String(view.dominant?.label || '--'))}</span></div>
                <div class="agri-kpi-card"><span class="agri-kpi-label">薄弱维度</span><span class="agri-kpi-value agri-kpi-small">${escapeHtml(String(view.weakest?.label || '--'))}</span></div>
            </div>
            <div class="agri-bar-list">${renderInsightBars(view.dimensionBars, '')}</div>
            <div class="agri-panel-footer">更新时间：${escapeHtml(String(view.updatedAt || '--'))} · 预测置信度 ${escapeHtml(formatMetricValue(view.confidence, '%', 1))}</div>
        </div>
    `;
}

function renderAgriClimateMarkup(component) {
    const state = getStructuredAgriRenderState(component);
    if (state.error) {
        return `<div class="chart-error">${escapeHtml(state.error)}</div>`;
    }
    const view = getAgriClimateView(state.payload);
    const cardsHtml = (view.cards || []).slice(0, 4).map(card => `
        <div class="agri-kpi-card">
            <span class="agri-kpi-label">${escapeHtml(String(card.label || '指标'))}</span>
            <span class="agri-kpi-value">${escapeHtml(formatMetricValue(card.value, card.unit || '', (card.unit || '').toLowerCase() === 'lux' ? 0 : 1))}</span>
            <span class="agri-kpi-meta">${escapeHtml(String(card.trend || '未知'))}</span>
        </div>
    `).join('');
    return `
        <div class="agri-panel agri-climate-panel">
            <div class="agri-panel-head">
                <div>
                    <div class="agri-panel-eyebrow">Climate / Forecast</div>
                    <div class="agri-panel-title">${escapeHtml(component.props.title || view.title)}</div>
                </div>
                <div class="agri-mode-chip">${escapeHtml(String(view.microclimateState || '未识别'))}</div>
            </div>
            ${state.sourceNote ? `<div class="chart-source-note">${escapeHtml(state.sourceNote)}</div>` : ''}
            <div class="agri-climate-summary">${escapeHtml(view.summary || '暂无气候趋势说明。')}</div>
            <div class="agri-kpi-grid agri-kpi-grid-three">${cardsHtml}</div>
            <div class="agri-panel-footer">预测置信度 ${escapeHtml(formatMetricValue(view.confidence, '%', 1))}</div>
        </div>
    `;
}

function renderAgriYieldMarkup(component) {
    const state = getStructuredAgriRenderState(component);
    if (state.error) {
        return `<div class="chart-error">${escapeHtml(state.error)}</div>`;
    }
    const view = getAgriYieldView(state.payload);
    return `
        <div class="agri-panel agri-yield-panel">
            <div class="agri-panel-head">
                <div>
                    <div class="agri-panel-eyebrow">Yield / Forecast</div>
                    <div class="agri-panel-title">${escapeHtml(component.props.title || view.title)}</div>
                </div>
                <div class="agri-mode-chip">${escapeHtml(String(view.grade || '待评估'))}</div>
            </div>
            ${state.sourceNote ? `<div class="chart-source-note">${escapeHtml(state.sourceNote)}</div>` : ''}
            <div class="agri-kpi-grid">
                <div class="agri-kpi-card"><span class="agri-kpi-label">产量指数</span><span class="agri-kpi-value">${escapeHtml(formatMetricValue(view.yieldIndex, '', 1))}</span></div>
                <div class="agri-kpi-card"><span class="agri-kpi-label">亩产估算</span><span class="agri-kpi-value">${escapeHtml(formatMetricValue(view.estimatedYield, 'kg/亩', 1))}</span></div>
            </div>
            <div class="agri-yield-narrative">${escapeHtml(view.narrative || '暂无产量描述。')}</div>
            <div class="agri-bar-list">${renderInsightBars(view.factors, '')}</div>
        </div>
    `;
}

function renderAgriDecisionMarkup(component) {
    const state = getStructuredAgriRenderState(component);
    if (state.error) {
        return `<div class="chart-error">${escapeHtml(state.error)}</div>`;
    }
    const view = getAgriDecisionView(state.payload);
    const top = view.topDecision || {};
    const modulesHtml = (view.modules || []).slice(0, 4).map(item => `
        <div class="agri-decision-item">
            <div class="agri-decision-item-head">
                <span>${escapeHtml(String(item.module || 'module'))}</span>
                <strong>${escapeHtml(String(item.priority || 'P2'))} · ${escapeHtml(formatMetricValue(item.score, '', 1))}</strong>
            </div>
            <div class="agri-decision-item-action">${escapeHtml(String(item.action || '--'))}</div>
            <div class="agri-decision-item-reason">${escapeHtml(String(item.reason || ''))}</div>
        </div>
    `).join('');
    return `
        <div class="agri-panel agri-decision-panel">
            <div class="agri-panel-head">
                <div>
                    <div class="agri-panel-eyebrow">Decision / Assist</div>
                    <div class="agri-panel-title">${escapeHtml(component.props.title || view.title)}</div>
                </div>
                <div class="agri-mode-chip">${escapeHtml(String(top.priority || 'P2'))}</div>
            </div>
            ${state.sourceNote ? `<div class="chart-source-note">${escapeHtml(state.sourceNote)}</div>` : ''}
            <div class="agri-decision-top">
                <div class="agri-decision-top-label">优先动作</div>
                <div class="agri-decision-top-action">${escapeHtml(String(top.action || '--'))}</div>
                <div class="agri-decision-top-reason">${escapeHtml(String(view.summary || top.reason || '暂无决策说明。'))}</div>
            </div>
            <div class="agri-panel-footer">风险分数 ${escapeHtml(formatMetricValue(view.riskScore, '', 1))}</div>
            <div class="agri-decision-list">${modulesHtml}</div>
        </div>
    `;
}

function renderAgriSummaryMarkup(component) {
    const state = getAgriSummaryRenderState(component);
    if (state.error) {
        return `<div class="chart-error">${escapeHtml(state.error)}</div>`;
    }

    const view = state.view || {};
    const metricsHtml = (Array.isArray(view.metrics) ? view.metrics : []).slice(0, 4).map(metric => `
        <div class="agri-summary-metric-card">
            <span class="agri-summary-metric-label">${escapeHtml(String(metric.label || '指标'))}</span>
            <span class="agri-summary-metric-value">${escapeHtml(String(metric.value || '--'))}</span>
        </div>
    `).join('');
    const sectionsHtml = (Array.isArray(view.sections) ? view.sections : []).slice(0, 3).map(section => `
        <div class="agri-summary-section">
            <div class="agri-summary-section-title">${escapeHtml(String(section.title || '摘要内容'))}</div>
            <div class="agri-summary-item-list">
                ${(Array.isArray(section.items) ? section.items : []).slice(0, 4).map(item => `
                    <div class="agri-summary-item">${escapeHtml(String(item || ''))}</div>
                `).join('')}
            </div>
        </div>
    `).join('');

    return `
        <div class="agri-panel agri-summary-panel">
            <div class="agri-panel-head">
                <div>
                    <div class="agri-panel-eyebrow">Analysis / Summary</div>
                    <div class="agri-panel-title">${escapeHtml(component.props.title || view.title || '农业分析摘要')}</div>
                </div>
                <div class="agri-mode-chip">${escapeHtml(String(view.chip || '摘要'))}</div>
            </div>
            ${state.sourceNote ? `<div class="chart-source-note">${escapeHtml(state.sourceNote)}</div>` : ''}
            <div class="agri-summary-lead">${escapeHtml(String(view.lead || '暂无摘要说明。'))}</div>
            ${view.secondary ? `<div class="agri-summary-secondary">${escapeHtml(String(view.secondary))}</div>` : ''}
            ${metricsHtml ? `<div class="agri-summary-metric-grid">${metricsHtml}</div>` : ''}
            ${sectionsHtml ? `<div class="agri-summary-sections">${sectionsHtml}</div>` : ''}
        </div>
    `;
}

function getAgricultureDataMode(component) {
    return component?.props?.dataMode === AGRI_DATA_MODE_API ? AGRI_DATA_MODE_API : SOURCE_MODE_MANUAL;
}

function getAgricultureRefreshInterval(component) {
    return clamp(Number(component?.props?.refreshInterval) || 30, 5, 3600);
}

function renderSensorMarkup(component, preview = false) {
    const modeLabel = getAgricultureDataMode(component) === AGRI_DATA_MODE_API ? 'API' : '手动';
    const rootAttrs = preview
        ? ` data-agri-component="agri-sensor" data-agri-mode="${escapeHtml(getAgricultureDataMode(component))}" data-api-path="${escapeHtml(component.props.apiPath || '')}" data-refresh-interval="${getAgricultureRefreshInterval(component)}"`
        : '';

    const sensors = Array.isArray(component.props.sensors) ? component.props.sensors : [];
    const sensorRows = sensors.map(sensor => `
        <div class="agri-sensor-row">
            <span class="agri-sensor-name">${escapeHtml(sensor.name || '')}</span>
            <span class="agri-sensor-value">${escapeHtml(sensor.value || '')} ${escapeHtml(sensor.unit || '')}</span>
            <span class="agri-sensor-status" data-status="${sensor.status === '正常' ? 'normal' : 'warning'}">${escapeHtml(sensor.status || '')}</span>
        </div>
    `).join('');

    return `
        <div class="agri-panel agri-sensor-panel"${rootAttrs}>
            <div class="agri-panel-head">
                <div>
                    <div class="agri-panel-eyebrow">Sensors / Data</div>
                    <div class="agri-panel-title" data-field="title">${escapeHtml(component.props.title || '传感器数据')}</div>
                </div>
                <div class="agri-mode-chip">${modeLabel}</div>
            </div>
            <div class="agri-sensor-list">
                ${sensorRows}
            </div>
        </div>
    `;
}

function renderWeatherMarkup(component, preview = false) {
    const mode = getWeatherDataMode(component);
    const modeLabel = mode === WEATHER_DATA_MODE_API ? '外部 API' : '手动';
    const lat = Number.isFinite(Number(component.props.latitude)) ? Number(component.props.latitude) : 39.9042;
    const lon = Number.isFinite(Number(component.props.longitude)) ? Number(component.props.longitude) : 116.4074;
    const customUrl = typeof component.props.customApiUrl === 'string' ? component.props.customApiUrl.trim() : '';
    const rootAttrs = preview
        ? ` data-weather-card="1" data-weather-mode="${escapeHtml(mode)}" data-latitude="${lat}" data-longitude="${lon}" data-custom-api-url="${escapeHtml(customUrl)}" data-refresh-interval="${getWeatherRefreshInterval(component)}"`
        : '';
    const p = component.props || {};
    return `
        <div class="weather-panel"${rootAttrs}>
            <div class="weather-panel-head">
                <div>
                    <div class="weather-panel-eyebrow">Weather</div>
                    <div class="weather-panel-title" data-field="title">${escapeHtml(p.title || '天气预报')}</div>
                    <div class="weather-panel-subtitle" data-field="subtitle">${escapeHtml(p.subtitle || '')}</div>
                </div>
                <div class="weather-mode-chip">${escapeHtml(modeLabel)}</div>
            </div>
            <div class="weather-panel-body">
                <div class="weather-temp-block">
                    <span class="weather-temp-value" data-field="tempC">${escapeHtml(String(p.tempC ?? ''))}</span>
                    <span class="weather-temp-unit">°C</span>
                </div>
                <div class="weather-meta-grid">
                    <div class="weather-meta-item"><span class="weather-meta-label">天气</span><span class="weather-meta-value" data-field="conditionText">${escapeHtml(String(p.conditionText ?? ''))}</span></div>
                    <div class="weather-meta-item"><span class="weather-meta-label">湿度</span><span><span data-field="humidity">${escapeHtml(String(p.humidity ?? ''))}</span>%</span></div>
                    <div class="weather-meta-item"><span class="weather-meta-label">风速</span><span><span data-field="windKmh">${escapeHtml(String(p.windKmh ?? ''))}</span> km/h</span></div>
                </div>
            </div>
            <div class="weather-panel-foot"><span data-field="updatedAt">${escapeHtml(String(p.updatedAt ?? ''))}</span></div>
        </div>
    `;
}

function renderAgricultureComponentMarkup(component, preview = false) {
    if (component.type === 'agri-sensor') return renderSensorMarkup(component, preview);
    if (component.type === 'agri-model') return renderAgriModelMarkup(component, preview);
    if (component.type === 'agri-climate') return renderAgriClimateMarkup(component, preview);
    if (component.type === 'agri-yield') return renderAgriYieldMarkup(component, preview);
    if (component.type === 'agri-decision') return renderAgriDecisionMarkup(component, preview);
    if (component.type === 'agri-summary') return renderAgriSummaryMarkup(component, preview);
    return '';
}

function getPreviewDataAttributes(component) {
    const binding = resolveWorkflowBinding(component);
    if (!binding.valid) return '';

    return [
        `data-source-mode="${SOURCE_MODE_WORKFLOW_PORT}"`,
        `data-workflow-project-id="${escapeHtml(binding.project.id)}"`,
        `data-workflow-project-name="${escapeHtml(binding.project.name)}"`,
        `data-workflow-port-id="${escapeHtml(binding.port.id)}"`,
        `data-workflow-port-name="${escapeHtml(binding.port.name)}"`,
        `data-workflow-port-type="${escapeHtml(binding.port.dataType)}"`
    ].join(' ');
}

function loadScreenData(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.components)) {
        throw new Error('无效的大屏应用数据');
    }

    state.components.clear();
    state.nextId = 1;
    state.page = {
        width: Number.isFinite(Number(data.page?.width)) ? Number(data.page.width) : DEFAULT_PAGE.width,
        height: Number.isFinite(Number(data.page?.height)) ? Number(data.page.height) : DEFAULT_PAGE.height,
        background: typeof data.page?.background === 'string' ? data.page.background : DEFAULT_PAGE.background
    };

    let maxId = 0;
    for (const rawComponent of data.components) {
        const component = normalizeComponent(rawComponent);
        maxId = Math.max(maxId, component.id);
        state.components.set(component.id, component);
    }

    state.nextId = Number.isFinite(Number(data.next_id ?? data.nextId))
        ? Number(data.next_id ?? data.nextId)
        : (maxId + 1 || 1);

    if (state.nextId <= maxId) {
        state.nextId = maxId + 1;
    }

    clearSelectedComponents();
}

function exportScreenData() {
    return {
        page: { ...state.page },
        components: Array.from(state.components.values()).map(component => ({
            id: component.id,
            type: component.type,
            x: component.x,
            y: component.y,
            width: component.width,
            height: component.height,
            props: {
                ...component.props,
                source: normalizeSource(component.props.source)
            }
        })),
        next_id: state.nextId
    };
}

function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function upsertCurrentScreenProject({
    name = null,
    cloudProjectId,
    cloudUpdatedAt
} = {}) {
    const payload = exportScreenData();
    const nextName = typeof name === 'string' && name.trim()
        ? name.trim()
        : (currentScreenProject?.name || buildDefaultScreenProjectName());
    let record = currentScreenProject?.id ? getProjectById(currentScreenProject.id) : null;

    if (!record || record.type !== 'screen') {
        record = createProjectRecord({
            type: 'screen',
            name: nextName,
            data: payload,
            cloudProjectId,
            cloudUpdatedAt
        });
    } else {
        record = saveProjectData(record.id, {
            name: nextName,
            data: payload,
            touchOpen: true,
            cloudProjectId,
            cloudUpdatedAt
        });
    }

    if (record) setCurrentScreenProject(record);
    return record;
}

function syncScreenProjectFromCloud(cloudProject) {
    const existing = findProjectByCloudId('screen', cloudProject?.id);
    const record = existing
        ? saveProjectData(existing.id, {
            name: typeof cloudProject?.name === 'string' && cloudProject.name.trim()
                ? cloudProject.name.trim()
                : existing.name,
            data: cloudProject?.data && typeof cloudProject.data === 'object' ? cloudProject.data : exportScreenData(),
            touchOpen: true,
            cloudProjectId: cloudProject?.id,
            cloudUpdatedAt: cloudProject?.updatedAt || ''
        })
        : createProjectRecord({
            type: 'screen',
            name: typeof cloudProject?.name === 'string' && cloudProject.name.trim()
                ? cloudProject.name.trim()
                : buildDefaultScreenProjectName(),
            data: cloudProject?.data && typeof cloudProject.data === 'object' ? cloudProject.data : {},
            cloudProjectId: cloudProject?.id,
            cloudUpdatedAt: cloudProject?.updatedAt || ''
        });

    if (!record) return null;
    loadScreenData(record.data);
    setCurrentScreenProject(record);
    renderAll();
    return record;
}

async function promptScreenProjectName({
    title,
    confirmText,
    defaultValue = '',
    subtitle = ''
} = {}) {
    return showSharedDialog({
        title,
        subtitle,
        bodyHtml: `
            <div class="shared-form-grid">
                <div class="shared-field">
                    <label for="screenProjectNameInput">项目名称</label>
                    <input class="shared-input" id="screenProjectNameInput" value="${escapeHtml(defaultValue)}" placeholder="请输入项目名称">
                </div>
            </div>
        `,
        confirmText,
        cancelText: '取消',
        onOpen: ({ bodyEl }) => {
            bodyEl.querySelector('#screenProjectNameInput')?.focus();
        },
        onConfirm: ({ bodyEl, setMessage }) => {
            const input = bodyEl.querySelector('#screenProjectNameInput');
            const nextName = String(input?.value || '').trim();
            if (!nextName) {
                setMessage('请输入项目名称。', 'error');
                return false;
            }
            return nextName;
        }
    });
}

async function openLocalScreenProjectPicker() {
    const projects = listProjectsByType('screen');
    await showSharedDialog({
        title: '打开本地大屏项目',
        subtitle: '从本地项目仓库中选择一个大屏项目继续编辑。',
        bodyHtml: projects.length
            ? `<div class="shared-choice-list">${projects.map(project => `
                <button class="shared-choice-item" type="button" data-open-screen-project="${project.id}">
                    <strong>${escapeHtml(project.name)}</strong>
                    <span>最近活动：${escapeHtml(formatProjectTime(project.lastOpenedAt || project.updatedAt))}</span>
                </button>
            `).join('')}</div>`
            : '<div class="shared-empty">当前还没有保存过本地大屏项目。</div>',
        confirmText: '关闭',
        showCancel: false,
        onOpen: ({ bodyEl, close }) => {
            bodyEl.querySelectorAll('[data-open-screen-project]').forEach((button) => {
                button.addEventListener('click', () => {
                    const projectId = button.getAttribute('data-open-screen-project');
                    const project = getProjectById(projectId);
                    if (!project || project.type !== 'screen') return;
                    touchProject(project.id);
                    loadScreenData(project.data);
                    setCurrentScreenProject(getProjectById(project.id) || project);
                    renderAll();
                    close(true);
                });
            });
        }
    });
}

async function saveScreenProjectLocally() {
    const nextName = await promptScreenProjectName({
        title: '保存本地大屏项目',
        confirmText: '保存',
        defaultValue: currentScreenProject?.name || ''
    });
    if (!nextName) return;
    upsertCurrentScreenProject({ name: nextName });
}

async function saveScreenProjectToCloud() {
    const auth = await requireAuthenticated('保存大屏项目到数据库需要先登录。');
    if (!auth) return;

    const nextName = await promptScreenProjectName({
        title: '保存大屏项目到数据库',
        confirmText: '保存到数据库',
        defaultValue: currentScreenProject?.name || '',
        subtitle: '未登录时仍可继续编辑，只有保存到数据库或从数据库下载时需要先登录。'
    });
    if (!nextName) return;

    const payload = exportScreenData();
    let projectId = currentScreenProject?.cloudProjectId || null;
    let cloudProject = null;

    try {
        cloudProject = await saveUserProject({
            projectId,
            projectType: 'screen',
            name: nextName,
            data: payload
        });
    } catch (error) {
        if (projectId && error?.code === 'PROJECT_NOT_FOUND') {
            cloudProject = await saveUserProject({
                projectType: 'screen',
                name: nextName,
                data: payload
            });
        } else {
            throw error;
        }
    }

    syncScreenProjectFromCloud({
        ...cloudProject,
        data: payload
    });
}

async function downloadScreenProjectFromCloud() {
    const auth = await requireAuthenticated('下载数据库中的大屏项目文件前需要先登录。');
    if (!auth) return;

    const projects = await listUserProjects('screen');
    await showSharedDialog({
        title: '下载数据库项目文件',
        subtitle: '选择一个数据库项目后，系统会把项目导出为 JSON 文件，并保存到你选择的本地目录。',
        bodyHtml: projects.length
            ? `<div class="shared-choice-list">${projects.map(project => `
                <button class="shared-choice-item" type="button" data-download-screen-project="${project.id}" data-download-screen-project-name="${escapeHtml(project.name)}">
                    <strong>${escapeHtml(project.name)}</strong>
                    <span>更新时间：${escapeHtml(formatProjectTime(project.updatedAt))}</span>
                </button>
            `).join('')}</div>`
            : '<div class="shared-empty">当前数据库中还没有可下载的大屏项目。</div>',
        confirmText: '关闭',
        showCancel: false,
        onOpen: ({ bodyEl, close }) => {
            bodyEl.querySelectorAll('[data-download-screen-project]').forEach((button) => {
                button.addEventListener('click', async () => {
                    try {
                        const projectId = button.getAttribute('data-download-screen-project');
                        const projectName = button.getAttribute('data-download-screen-project-name') || 'screen-project';
                        close(true);
                        const result = await downloadCloudProjectToLocalFile({
                            projectId,
                            projectType: 'screen',
                            projectName,
                            loadProject: getUserProject
                        });
                        if (result?.ok) {
                            window.alert(`下载完成：${result.targetLabel}`);
                        }
                    } catch (error) {
                        window.alert(error?.message || '下载项目文件失败。');
                    }
                });
            });
        }
    });
}

function addComponentAt(type, x, y) {
    const component = createComponent(type, x, y);
    if (!component) return;
    state.components.set(component.id, component);
    setSelectedComponents([component.id], component.id);
    renderAll();
}

function removeSelectedComponent() {
    if (!hasSelection()) return;
    Array.from(state.selectedIds).forEach(id => {
        state.components.delete(id);
    });
    clearSelectedComponents();
    renderAll();
}

function getClipboardSelectedComponents() {
    return getSelectedComponents().map(component => ({
        type: component.type,
        x: component.x,
        y: component.y,
        width: component.width,
        height: component.height,
        props: cloneData(component.props)
    }));
}

function copySelectedComponents() {
    const snapshots = getClipboardSelectedComponents();
    if (!snapshots.length) return false;
    componentClipboardPayload = snapshots;
    componentClipboardPasteCount = 0;
    updateCanvasStatusBar();
    return true;
}

function cutSelectedComponents() {
    if (!copySelectedComponents()) return false;
    removeSelectedComponent();
    return true;
}

function pasteComponentSnapshots(snapshots) {
    const validSnapshots = Array.isArray(snapshots) ? snapshots : [];
    if (!validSnapshots.length) return false;

    const minX = Math.min(...validSnapshots.map(item => Number(item.x) || 0));
    const minY = Math.min(...validSnapshots.map(item => Number(item.y) || 0));
    const offset = 24 * (componentClipboardPasteCount + 1);
    const nextIds = [];

    validSnapshots.forEach(snapshot => {
        const component = normalizeComponent({
            ...snapshot,
            id: state.nextId++,
            x: clamp((Number(snapshot.x) || 0) - minX + minX + offset, 0, state.page.width - 40),
            y: clamp((Number(snapshot.y) || 0) - minY + minY + offset, 0, state.page.height - 40)
        });
        constrainComponentToStage(component);
        state.components.set(component.id, component);
        nextIds.push(component.id);
    });

    componentClipboardPasteCount += 1;
    setSelectedComponents(nextIds, nextIds[nextIds.length - 1] ?? null);
    renderAll();
    return true;
}

function pasteClipboardComponents() {
    if (!componentClipboardPayload || !componentClipboardPayload.length) return false;
    return pasteComponentSnapshots(componentClipboardPayload.map(item => cloneData(item)));
}

function duplicateSelectedComponents() {
    const snapshots = getClipboardSelectedComponents();
    if (!snapshots.length) return false;
    return pasteComponentSnapshots(snapshots);
}

function selectAllComponents() {
    const allIds = Array.from(state.components.keys());
    setSelectedComponents(allIds, allIds[allIds.length - 1] ?? null);
    renderAll();
}

function bringSelectedComponentsToFront() {
    const selectedComponents = getSelectedComponents();
    if (!selectedComponents.length) return false;

    selectedComponents.forEach(component => {
        state.components.delete(component.id);
    });
    selectedComponents.forEach(component => {
        state.components.set(component.id, component);
    });

    renderStage();
    updateCanvasStatusBar();
    return true;
}

function updateStageAppearance() {
    const zoom = clampCanvasZoom(state.zoom);
    refs.stage.style.width = `${state.page.width}px`;
    refs.stage.style.height = `${state.page.height}px`;
    refs.stage.style.background = state.page.background;
    refs.stage.style.transform = `scale(${zoom})`;
    refs.viewport.style.width = `${state.page.width * zoom}px`;
    refs.viewport.style.height = `${state.page.height * zoom}px`;
}

function updateCanvasStatusBar() {
    const zoomPercent = Math.round(clampCanvasZoom(state.zoom) * 100);
    const hasClipboard = Boolean(componentClipboardPayload && componentClipboardPayload.length);
    const selectedCount = state.selectedIds.size;
    const resizeToolActive = isResizeToolActive();
    if (refs.zoomLabel) refs.zoomLabel.textContent = `缩放 ${zoomPercent}%`;
    if (refs.zoomResetBtn) refs.zoomResetBtn.textContent = `${zoomPercent}%`;
    if (refs.selectAllBtn) refs.selectAllBtn.disabled = state.components.size === 0;
    if (refs.copyBtn) refs.copyBtn.disabled = selectedCount === 0;
    if (refs.cutBtn) refs.cutBtn.disabled = selectedCount === 0;
    if (refs.pasteBtn) refs.pasteBtn.disabled = !hasClipboard;
    if (refs.duplicateBtn) refs.duplicateBtn.disabled = selectedCount === 0;
    if (refs.bringToFrontBtn) refs.bringToFrontBtn.disabled = selectedCount === 0;
    if (refs.deleteBtn) refs.deleteBtn.disabled = selectedCount === 0;
    if (refs.resizeModeBtn) {
        refs.resizeModeBtn.classList.toggle('active', resizeToolActive);
        refs.resizeModeBtn.setAttribute('aria-pressed', resizeToolActive ? 'true' : 'false');
        refs.resizeModeBtn.title = resizeToolActive
            ? '当前已切换为组件缩放模式，拖动选中组件可直接调整尺寸。'
            : '切换到组件缩放模式后，在画布中拖动选中组件即可调整尺寸。';
    }
    if (refs.toolModeLabel) {
        refs.toolModeLabel.textContent = resizeToolActive ? '当前：组件缩放' : '当前：移动组件';
    }
    refs.canvasArea?.classList.toggle('resize-mode', resizeToolActive);
    refs.stage?.classList.toggle('resize-mode', resizeToolActive);
}

function setCanvasZoom(nextZoom, options = {}) {
    const previousZoom = clampCanvasZoom(state.zoom);
    const targetZoom = clampCanvasZoom(nextZoom);
    if (Math.abs(previousZoom - targetZoom) < 0.001) return;

    const areaRect = refs.canvasArea.getBoundingClientRect();
    const anchorClientX = Number.isFinite(options.clientX) ? options.clientX : areaRect.left + areaRect.width / 2;
    const anchorClientY = Number.isFinite(options.clientY) ? options.clientY : areaRect.top + areaRect.height / 2;
    const localClientX = anchorClientX - areaRect.left;
    const localClientY = anchorClientY - areaRect.top;
    const logicalX = (refs.canvasArea.scrollLeft + localClientX) / previousZoom;
    const logicalY = (refs.canvasArea.scrollTop + localClientY) / previousZoom;

    state.zoom = targetZoom;
    updateStageAppearance();
    updateCanvasStatusBar();

    refs.canvasArea.scrollLeft = Math.max(0, logicalX * targetZoom - localClientX);
    refs.canvasArea.scrollTop = Math.max(0, logicalY * targetZoom - localClientY);
}

function resetCanvasZoom() {
    setCanvasZoom(1);
}

function renderLibrary() {
    refs.library.innerHTML = COMPONENT_LIBRARY.map(item => `
        <article class="component-card" draggable="true" data-component-type="${item.type}">
            <div class="component-card-head">
                <span class="component-card-icon">${escapeHtml(item.icon || '◻')}</span>
                <strong>${escapeHtml(item.title)}</strong>
            </div>
            <p>${escapeHtml(item.description)}</p>
        </article>
    `).join('');
}
function renderStage() {
    updateStageAppearance();

    const markup = Array.from(state.components.values()).map(component => {
        const commonStyle = [
            `left:${component.x}px`,
            `top:${component.y}px`,
            `width:${component.width}px`,
            `height:${component.height}px`
        ].join(';');
        const componentClassNames = getStageComponentClassNames(component.id);
        const resizeHandles = getResizeHandleMarkup(component.id);

        if (component.type === 'image') {
            const imageState = getImageRenderState(component);
            const resolvedImageSrc = imageState.kind === 'image' ? toAbsoluteUrl(imageState.src) : '';
            const imageHtml = imageState.kind === 'image'
                ? `<img class="image-fill" src="${escapeHtml(resolvedImageSrc)}" alt="${escapeHtml(component.props.alt || '')}" style="object-fit:${escapeHtml(component.props.objectFit || 'cover')}; border-radius:${Number(component.props.borderRadius) || 0}px;">`
                : `
                    <div class="image-placeholder">
                        <div>
                            <div class="image-placeholder-title">${escapeHtml(imageState.title)}</div>
                            <div class="image-placeholder-note">${escapeHtml(imageState.note || '')}</div>
                        </div>
                    </div>
                `;

            return `
                <div class="${componentClassNames} image-component" data-component-id="${component.id}" style="${commonStyle}">
                    ${imageHtml}
                    ${resizeHandles}
                </div>
            `;
        }

        if (component.type === 'chart') {
            const chartHtml = getChartPreviewHtml(component);
            return `
                <div class="${componentClassNames} chart-component" data-component-id="${component.id}" style="${commonStyle};padding:12px;overflow:hidden;background:#fff;">
                    ${chartHtml}
                    ${resizeHandles}
                </div>
            `;
        }

        if (isAgricultureComponentType(component.type)) {
            const previewDataAttrs = usesWorkflowSource(component.type) ? getPreviewDataAttributes(component) : '';
            return `
                <div class="${componentClassNames} agriculture-component" data-component-id="${component.id}" ${previewDataAttrs} style="${commonStyle};padding:14px;overflow:hidden;">
                    ${renderAgricultureComponentMarkup(component)}
                    ${resizeHandles}
                </div>
            `;
        }

        if (isWeatherComponentType(component.type)) {
            return `
                <div class="${componentClassNames} weather-component" data-component-id="${component.id}" style="${commonStyle};padding:14px;overflow:hidden;">
                    ${renderWeatherMarkup(component)}
                    ${resizeHandles}
                </div>
            `;
        }

        const textState = getTextRenderState(component);
        const textStyle = [
            `font-size:${Number(component.props.fontSize) || 32}px`,
            `color:${component.props.color || '#1f2937'}`,
            `font-weight:${component.props.fontWeight || '700'}`,
            `background:${component.props.backgroundColor || 'transparent'}`,
            `justify-content:${getTextJustifyContent(component.props.textAlign)}`,
            `text-align:${component.props.textAlign || 'left'}`
        ].join(';');

        return `
            <div class="${componentClassNames} text-component" data-component-id="${component.id}" style="${commonStyle};${textStyle}">
                <div class="text-component-content">
                    <div class="text-main-content">${escapeHtml(textState.text)}</div>
                    ${textState.note ? `<div class="text-source-note">${escapeHtml(textState.note)}</div>` : ''}
                </div>
                ${resizeHandles}
            </div>
        `;
    }).join('');

    refs.stage.innerHTML = markup;
}

function renderSourceSection(component) {
    const source = normalizeSource(component.props.source);
    const workflowProjects = listProjectsByType('workflow');
    const compatiblePorts = source.workflowProjectId
        ? getCompatibleWorkflowPorts(component.type, source.workflowProjectId)
        : [];
    const binding = resolveWorkflowBinding(component);
    const supportedTypesLabel = getSupportedPortTypes(component.type).map(getPortTypeLabel).join(' / ');

    return `
        <section class="prop-section">
            <h3>数据源</h3>
            <div>
                <label class="prop-label" for="sourceModeInput">来源类型</label>
                <select class="prop-select" id="sourceModeInput">
                    <option value="${SOURCE_MODE_MANUAL}" ${source.mode === SOURCE_MODE_MANUAL ? 'selected' : ''}>手动输入</option>
                    <option value="${SOURCE_MODE_WORKFLOW_PORT}" ${source.mode === SOURCE_MODE_WORKFLOW_PORT ? 'selected' : ''}>工作流端口</option>
                </select>
            </div>
            ${source.mode === SOURCE_MODE_WORKFLOW_PORT ? `
                <div class="prop-grid">
                    <div>
                        <label class="prop-label" for="sourceWorkflowProjectInput">工作流项目</label>
                        <select class="prop-select" id="sourceWorkflowProjectInput" ${workflowProjects.length ? '' : 'disabled'}>
                            ${workflowProjects.length
                                ? workflowProjects.map(project => `<option value="${project.id}" ${project.id === source.workflowProjectId ? 'selected' : ''}>${escapeHtml(project.name)}</option>`).join('')
                                : '<option value="">暂无已保存工作流</option>'}
                        </select>
                    </div>
                    <div>
                        <label class="prop-label" for="sourceWorkflowPortInput">项目端口</label>
                        <select class="prop-select" id="sourceWorkflowPortInput" ${(compatiblePorts.length && workflowProjects.length) ? '' : 'disabled'}>
                            ${compatiblePorts.length
                                ? compatiblePorts.map(port => `<option value="${port.id}" ${port.id === source.workflowPortId ? 'selected' : ''}>${escapeHtml(port.name)} · ${getPortTypeLabel(port.dataType)}</option>`).join('')
                                : '<option value="">暂无可用端口</option>'}
                        </select>
                    </div>
                </div>
                <p class="prop-hint">${escapeHtml(getSourceStatusText(component))}</p>
                <div class="source-summary">
                    <span class="source-summary-label">支持类型</span>
                    <span>${escapeHtml(supportedTypesLabel)}</span>
                    ${binding.valid ? `<span class="source-summary-chip">${escapeHtml(binding.label)}</span>` : ''}
                </div>
            ` : `
                <p class="prop-hint">当前使用组件内手动填写的内容，切换到工作流端口后可直接绑定已有工作流项目端口。</p>
            `}
        </section>
    `;
}

function renderTextSettings(component) {
    const source = normalizeSource(component.props.source);
    const textState = getTextRenderState(component);

    return `
        <section class="prop-section">
            <h3>文本设置</h3>
            ${source.mode === SOURCE_MODE_MANUAL ? `
                <div>
                    <label class="prop-label" for="textValueInput">显示文本</label>
                    <textarea class="prop-textarea" id="textValueInput">${escapeHtml(component.props.text || '')}</textarea>
                </div>
            ` : `
                <div>
                    <label class="prop-label">绑定预览</label>
                    <div class="source-preview-box">${escapeHtml(textState.text)}</div>
                </div>
            `}
            <div class="prop-grid">
                <div>
                    <label class="prop-label" for="textFontSizeInput">字号</label>
                    <input class="prop-input" id="textFontSizeInput" type="number" min="12" max="160" value="${Number(component.props.fontSize) || 32}">
                </div>
                <div>
                    <label class="prop-label" for="textFontWeightInput">字重</label>
                    <select class="prop-select" id="textFontWeightInput">
                        <option value="400" ${String(component.props.fontWeight) === '400' ? 'selected' : ''}>常规</option>
                        <option value="600" ${String(component.props.fontWeight) === '600' ? 'selected' : ''}>中等</option>
                        <option value="700" ${String(component.props.fontWeight) === '700' ? 'selected' : ''}>加粗</option>
                    </select>
                </div>
                <div>
                    <label class="prop-label" for="textColorInput">文字颜色</label>
                    <input class="prop-input" id="textColorInput" type="color" value="${component.props.color || '#1f2937'}">
                </div>
                <div>
                    <label class="prop-label" for="textAlignInput">对齐方式</label>
                    <select class="prop-select" id="textAlignInput">
                        <option value="left" ${component.props.textAlign === 'left' ? 'selected' : ''}>左对齐</option>
                        <option value="center" ${component.props.textAlign === 'center' ? 'selected' : ''}>居中</option>
                        <option value="right" ${component.props.textAlign === 'right' ? 'selected' : ''}>右对齐</option>
                    </select>
                </div>
            </div>
            <div>
                <label class="prop-label" for="textBackgroundInput">背景颜色</label>
                <input class="prop-input" id="textBackgroundInput" type="color" value="${normalizeColorValue(component.props.backgroundColor)}">
            </div>
        </section>
    `;
}

function renderImageSettings(component) {
    const source = normalizeSource(component.props.source);
    const refreshEnabled = component.props.autoRefresh === true;
    const refreshInterval = clamp(Number(component.props.refreshInterval) || 5, 1, 3600);

    return `
        <section class="prop-section">
            <h3>图片设置</h3>
            ${source.mode === SOURCE_MODE_MANUAL ? `
                <div>
                    <label class="prop-label" for="imageUploadInput">上传图片</label>
                    <input class="prop-input" id="imageUploadInput" type="file" accept="image/*">
                </div>
                <div>
                    <label class="prop-label" for="imageSrcInput">图片地址</label>
                    <input class="prop-input" id="imageSrcInput" type="text" value="${escapeHtml(component.props.src || '')}" placeholder="/api/agriculture/camera/snapshot">
                </div>
                <div class="prop-grid">
                    <div>
                        <label class="prop-label" for="imageAutoRefreshInput">定时抓拍</label>
                        <select class="prop-select" id="imageAutoRefreshInput">
                            <option value="false" ${refreshEnabled ? '' : 'selected'}>关闭</option>
                            <option value="true" ${refreshEnabled ? 'selected' : ''}>开启</option>
                        </select>
                    </div>
                    <div>
                        <label class="prop-label" for="imageRefreshIntervalInput">抓拍间隔(秒)</label>
                        <input class="prop-input" id="imageRefreshIntervalInput" type="number" min="1" max="3600" value="${refreshInterval}">
                    </div>
                </div>
                <p class="prop-hint">把图片地址设置为本地接口，例如 /api/agriculture/camera/snapshot，开启后会自动追加时间戳参数定时刷新。</p>
            ` : `
                <p class="prop-hint">当前图片来自工作流端口，端口值会在运行生成网页时作为图片 URL 或 Base64 地址使用。</p>
            `}
            <div>
                <label class="prop-label" for="imageAltInput">图片说明</label>
                <input class="prop-input" id="imageAltInput" type="text" value="${escapeHtml(component.props.alt || '')}">
            </div>
            <div class="prop-grid">
                <div>
                    <label class="prop-label" for="imageFitInput">填充方式</label>
                    <select class="prop-select" id="imageFitInput">
                        <option value="cover" ${component.props.objectFit === 'cover' ? 'selected' : ''}>cover</option>
                        <option value="contain" ${component.props.objectFit === 'contain' ? 'selected' : ''}>contain</option>
                        <option value="fill" ${component.props.objectFit === 'fill' ? 'selected' : ''}>fill</option>
                    </select>
                </div>
                <div>
                    <label class="prop-label" for="imageRadiusInput">圆角</label>
                    <input class="prop-input" id="imageRadiusInput" type="number" min="0" max="80" value="${Number(component.props.borderRadius) || 0}">
                </div>
            </div>
            ${source.mode === SOURCE_MODE_MANUAL && component.props.src ? `<img class="preview-thumb" src="${appendTimestampQuery(component.props.src, '__preview', Date.now())}" alt="${escapeHtml(component.props.alt || '')}">` : ''}
        </section>
    `;
}

function renderChartSettings(component) {
    const source = normalizeSource(component.props.source);
    const chartState = getChartRenderState(component);
    const headers = chartState.config?.headers || [];
    const numericHeaders = chartState.config?.numericHeaders || [];
    const seriesOptions = chartState.config?.seriesOptions || [];
    const rowCount = Array.isArray(chartState.parsed?.records) ? chartState.parsed.records.length : 0;
    const isPieChart = chartState.chartType === 'pie';
    const valueColumnCandidates = numericHeaders.filter(header => header !== chartState.config?.labelColumn);
    const selectableValueColumns = valueColumnCandidates.length ? valueColumnCandidates : numericHeaders;
    const processNote = getChartProcessNote(chartState);
    const csvPreview = chartState.parsed?.error
        ? `<div class="chart-error">${escapeHtml(chartState.parsed.error)}</div>`
        : chartState.sourceNote
            ? `<div class="source-preview-box">${escapeHtml(chartState.sourceNote)}</div>`
            : '';
    const usageHint = isPieChart
        ? '饼图适合使用“标签列 + 数值列”的分类统计数据。'
        : chartState.config?.dataLayout === CHART_DATA_LAYOUT_LONG
            ? '长表布局适合展示不同设备 ID 在同一时间轴上的检测值变化，例如：time, device_id, value。'
            : '宽表布局适合一行一个时间点、多列表示多个设备或多个指标的对比数据。';
    const seriesModeOptions = getChartSeriesModeOptions(chartState.chartType);

    return `
        <section class="prop-section">
            <h3>图表设置</h3>
            <div class="prop-grid">
                <div>
                    <label class="prop-label" for="chartTitleInput">图表标题</label>
                    <input class="prop-input" id="chartTitleInput" type="text" value="${escapeHtml(component.props.title || '')}" placeholder="输入图表标题">
                </div>
                ${isPieChart ? '' : `
                    <div>
                        <label class="prop-label" for="chartSeriesModeInput">图表模式</label>
                        <select class="prop-select" id="chartSeriesModeInput">
                            ${seriesModeOptions.map(item => `<option value="${item.value}" ${item.value === chartState.config?.seriesMode ? 'selected' : ''}>${item.label}</option>`).join('')}
                        </select>
                    </div>
                `}
                <div>
                    <label class="prop-label">数据来源</label>
                    <div class="source-preview-box">${source.mode === SOURCE_MODE_MANUAL ? '手动 CSV 导入' : '工作流端口绑定'}</div>
                </div>
            </div>
            ${source.mode === SOURCE_MODE_MANUAL ? `
                <div>
                    <label class="prop-label" for="chartCsvUploadInput">导入 CSV 文件</label>
                    <input class="prop-input" id="chartCsvUploadInput" type="file" accept=".csv,text/csv">
                </div>
                <div>
                    <label class="prop-label" for="chartCsvTextInput">CSV 文本</label>
                    <textarea class="prop-textarea" id="chartCsvTextInput" spellcheck="false">${escapeHtml(component.props.csvText || '')}</textarea>
                </div>
                ${csvPreview}
            ` : `
                <p class="prop-hint">当前图表将使用工作流端口返回的 CSV 字符串数据。</p>
                ${csvPreview}
            `}
            ${headers.length ? `
                <div class="prop-grid">
                    <div>
                        <label class="prop-label" for="chartLabelColumnInput">标签列</label>
                        <select class="prop-select" id="chartLabelColumnInput">
                            ${headers.map(header => `<option value="${escapeHtml(header)}" ${header === chartState.config?.labelColumn ? 'selected' : ''}>${escapeHtml(header)}</option>`).join('')}
                        </select>
                    </div>
                    ${isPieChart ? `
                        <div>
                            <label class="prop-label" for="chartValueColumnInput">数值列</label>
                            <select class="prop-select" id="chartValueColumnInput">
                                ${numericHeaders.map(header => `<option value="${escapeHtml(header)}" ${header === chartState.config?.valueColumn ? 'selected' : ''}>${escapeHtml(header)}</option>`).join('')}
                            </select>
                        </div>
                    ` : `
                        <div>
                            <label class="prop-label" for="chartDataLayoutInput">数据布局</label>
                            <select class="prop-select" id="chartDataLayoutInput">
                                <option value="${CHART_DATA_LAYOUT_LONG}" ${chartState.config?.dataLayout === CHART_DATA_LAYOUT_LONG ? 'selected' : ''}>长表布局</option>
                                <option value="${CHART_DATA_LAYOUT_WIDE}" ${chartState.config?.dataLayout === CHART_DATA_LAYOUT_WIDE ? 'selected' : ''}>宽表布局</option>
                            </select>
                        </div>
                    `}
                </div>
                ${!isPieChart && chartState.config?.dataLayout === CHART_DATA_LAYOUT_LONG ? `
                    <div class="prop-grid">
                        <div>
                            <label class="prop-label" for="chartSeriesColumnInput">系列列</label>
                            <select class="prop-select" id="chartSeriesColumnInput">
                                ${headers.map(header => `<option value="${escapeHtml(header)}" ${header === chartState.config?.seriesColumn ? 'selected' : ''}>${escapeHtml(header)}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label class="prop-label" for="chartValueColumnInput">数值列</label>
                            <select class="prop-select" id="chartValueColumnInput">
                                ${numericHeaders.map(header => `<option value="${escapeHtml(header)}" ${header === chartState.config?.valueColumn ? 'selected' : ''}>${escapeHtml(header)}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    ${seriesOptions.length ? `
                        <div>
                            <label class="prop-label">显示系列</label>
                            <div class="chart-column-checklist">
                                ${seriesOptions.map(seriesName => `
                                    <label class="chart-column-option">
                                        <input type="checkbox" data-chart-series-key="${escapeHtml(seriesName)}" ${chartState.config?.selectedSeriesKeys?.includes(seriesName) || (!chartState.config?.selectedSeriesKeys?.length && chartState.chartData?.series?.some(item => item.key === seriesName)) ? 'checked' : ''}>
                                        <span>${escapeHtml(seriesName)}</span>
                                    </label>
                                `).join('')}
                            </div>
                            <p class="prop-hint">当前模式为 ${escapeHtml(getChartSeriesModeLabel(chartState.chartType, chartState.config?.seriesMode))}，勾选过多时会自动保留前面的 ${getChartSeriesModeLimit(chartState.config?.seriesMode || CHART_SERIES_MODE_MULTI) >= Number.MAX_SAFE_INTEGER ? '所有' : getChartSeriesModeLimit(chartState.config?.seriesMode || CHART_SERIES_MODE_MULTI)} 个系列。</p>
                        </div>
                    ` : ''}
                ` : ''}
                ${!isPieChart && chartState.config?.dataLayout === CHART_DATA_LAYOUT_WIDE ? `
                    <div>
                        <label class="prop-label">系列数值列</label>
                        ${selectableValueColumns.length ? `
                            <div class="chart-column-checklist">
                                ${selectableValueColumns.map(header => `
                                    <label class="chart-column-option">
                                        <input type="checkbox" data-chart-value-column="${escapeHtml(header)}" ${chartState.config?.valueColumns?.includes(header) ? 'checked' : ''}>
                                        <span>${escapeHtml(header)}</span>
                                    </label>
                                `).join('')}
                            </div>
                            <p class="prop-hint">当前模式为 ${escapeHtml(getChartSeriesModeLabel(chartState.chartType, chartState.config?.seriesMode))}，若勾选超过模式上限，将自动保留前面的系列。</p>
                        ` : '<div class="source-preview-box">当前 CSV 中暂无可用数值列。</div>'}
                    </div>
                ` : ''}
                ${!isPieChart ? `
                    <div class="prop-grid">
                        <div>
                            <label class="prop-label">数据处理</label>
                            <label class="prop-toggle">
                                <input id="chartAggregationEnabledInput" type="checkbox" ${component.props.enableAggregation === false ? '' : 'checked'}>
                                <span>超出容量后自动按相邻数据平均整合</span>
                            </label>
                        </div>
                        <div>
                            <label class="prop-label" for="chartAggregationLimitInput">最大显示点数</label>
                            <input class="prop-input" id="chartAggregationLimitInput" type="number" min="${MIN_CHART_AGGREGATION_LIMIT}" max="${MAX_CHART_AGGREGATION_LIMIT}" value="${chartState.config?.aggregationLimit || DEFAULT_CHART_AGGREGATION_LIMIT}">
                        </div>
                    </div>
                ` : ''}
            ` : ''}
            <p class="prop-hint">
                ${chartState.parsed?.error
                    ? '请检查 CSV 格式是否正确。'
                    : chartState.chartData?.error
                        ? escapeHtml(chartState.chartData.error)
                        : `已解析 ${rowCount} 行数据。${processNote ? `${escapeHtml(processNote)}。` : ''}${usageHint}`}
            </p>
        </section>
    `;
}

function renderAgricultureDataSourceSection(component) {
    return `
        <section class="prop-section">
            <h3>数据接入</h3>
            <div class="prop-grid">
                <div>
                    <label class="prop-label" for="agriDataModeInput">数据模式</label>
                    <select class="prop-select" id="agriDataModeInput">
                        <option value="${SOURCE_MODE_MANUAL}" ${getAgricultureDataMode(component) === SOURCE_MODE_MANUAL ? 'selected' : ''}>手动模拟</option>
                        <option value="${AGRI_DATA_MODE_API}" ${getAgricultureDataMode(component) === AGRI_DATA_MODE_API ? 'selected' : ''}>后端接口</option>
                    </select>
                </div>
                <div>
                    <label class="prop-label" for="agriRefreshIntervalInput">刷新间隔(秒)</label>
                    <input class="prop-input" id="agriRefreshIntervalInput" type="number" min="5" max="3600" value="${getAgricultureRefreshInterval(component)}">
                </div>
            </div>
            <div>
                <label class="prop-label" for="agriApiPathInput">接口路径</label>
                <input class="prop-input" id="agriApiPathInput" type="text" value="${escapeHtml(component.props.apiPath || '')}" placeholder="/api/agriculture/sensor">
            </div>
            <p class="prop-hint">切换到“后端接口”后，运行生成网页时会按设定间隔轮询该接口，并用返回数据覆盖当前卡片展示内容。</p>
        </section>
    `;
}

function renderWeatherDataSourceSection(component) {
    const p = component.props || {};
    return `
        <section class="prop-section">
            <h3>外部天气数据</h3>
            <div class="prop-grid">
                <div>
                    <label class="prop-label" for="weatherTitleInput">标题</label>
                    <input class="prop-input" id="weatherTitleInput" type="text" value="${escapeHtml(p.title || '')}">
                </div>
                <div>
                    <label class="prop-label" for="weatherSubtitleInput">地点</label>
                    <input class="prop-input" id="weatherSubtitleInput" type="text" value="${escapeHtml(p.subtitle || '')}" placeholder="如：上海浦东">
                </div>
            </div>
            <div class="prop-grid">
                <div>
                    <label class="prop-label" for="weatherDataModeInput">数据模式</label>
                    <select class="prop-select" id="weatherDataModeInput">
                        <option value="${SOURCE_MODE_MANUAL}" ${getWeatherDataMode(component) === SOURCE_MODE_MANUAL ? 'selected' : ''}>手动模拟</option>
                        <option value="${WEATHER_DATA_MODE_API}" ${getWeatherDataMode(component) === WEATHER_DATA_MODE_API ? 'selected' : ''}>外部 API</option>
                    </select>
                </div>
                <div>
                    <label class="prop-label" for="weatherRefreshIntervalInput">刷新间隔(秒)</label>
                    <input class="prop-input" id="weatherRefreshIntervalInput" type="number" min="${WEATHER_REFRESH_MIN_SEC}" max="${WEATHER_REFRESH_MAX_SEC}" value="${getWeatherRefreshInterval(component)}">
                </div>
            </div>
            <div class="prop-grid">
                <div>
                    <label class="prop-label" for="weatherLatitudeInput">纬度</label>
                    <input class="prop-input" id="weatherLatitudeInput" type="number" step="0.0001" value="${Number.isFinite(Number(component.props.latitude)) ? Number(component.props.latitude) : 39.9042}">
                </div>
                <div>
                    <label class="prop-label" for="weatherLongitudeInput">经度</label>
                    <input class="prop-input" id="weatherLongitudeInput" type="number" step="0.0001" value="${Number.isFinite(Number(component.props.longitude)) ? Number(component.props.longitude) : 116.4074}">
                </div>
            </div>
            <div>
                <label class="prop-label" for="weatherCustomApiUrlInput">自定义接口 URL（可选）</label>
                <input class="prop-input" id="weatherCustomApiUrlInput" type="url" value="${escapeHtml(component.props.customApiUrl || '')}" placeholder="留空则使用 Open-Meteo（根据经纬度）">
            </div>
            <p class="prop-hint">API 模式下，编辑器和预览页都会按照刷新间隔请求天气接口并更新卡片。</p>
        </section>
    `;
}

function renderWeatherSettings(component) {
    const p = component.props || {};
    return `
        <section class="prop-section">
            <h3>天气展示内容</h3>
            <div class="prop-grid">
                <div>
                    <label class="prop-label" for="weatherConditionInput">天气描述</label>
                    <input class="prop-input" id="weatherConditionInput" type="text" value="${escapeHtml(p.conditionText || '')}">
                </div>
                <div>
                    <label class="prop-label" for="weatherTempInput">温度(°C)</label>
                    <input class="prop-input" id="weatherTempInput" type="text" value="${escapeHtml(String(p.tempC ?? ''))}">
                </div>
            </div>
            <div class="prop-grid">
                <div>
                    <label class="prop-label" for="weatherHumidityInput">湿度(%)</label>
                    <input class="prop-input" id="weatherHumidityInput" type="text" value="${escapeHtml(String(p.humidity ?? ''))}">
                </div>
                <div>
                    <label class="prop-label" for="weatherWindInput">风速(km/h)</label>
                    <input class="prop-input" id="weatherWindInput" type="text" value="${escapeHtml(String(p.windKmh ?? ''))}">
                </div>
            </div>
            <div>
                <label class="prop-label" for="weatherUpdatedAtInput">更新时间文本</label>
                <input class="prop-input" id="weatherUpdatedAtInput" type="text" value="${escapeHtml(String(p.updatedAt ?? ''))}">
            </div>
        </section>
    `;
}

function renderSensorSettings(component) {
    return `
        <section class="prop-section">
            <h3>传感器数据内容</h3>
            <div>
                <label class="prop-label" for="sensorTitleInput">标题</label>
                <input class="prop-input" id="sensorTitleInput" type="text" value="${escapeHtml(component.props.title || '')}">
            </div>
            <div>
                <label class="prop-label">传感器列表</label>
                <div id="sensorListContainer">
                    ${Array.isArray(component.props.sensors) ? component.props.sensors.map((sensor, index) => `
                        <div class="sensor-item" data-index="${index}">
                            <input class="prop-input sensor-name" type="text" value="${escapeHtml(sensor.name || '')}" placeholder="传感器名称">
                            <input class="prop-input sensor-value" type="text" value="${escapeHtml(sensor.value || '')}" placeholder="数值">
                            <input class="prop-input sensor-unit" type="text" value="${escapeHtml(sensor.unit || '')}" placeholder="单位">
                            <select class="prop-select sensor-status">
                                <option value="正常" ${sensor.status === '正常' ? 'selected' : ''}>正常</option>
                                <option value="异常" ${sensor.status === '异常' ? 'selected' : ''}>异常</option>
                            </select>
                            <button class="prop-btn danger remove-sensor-btn">删除</button>
                        </div>
                    `).join('') : ''}
                </div>
                <button class="prop-btn" id="addSensorBtn">添加传感器</button>
            </div>
        </section>
    `;
}

function renderAgriInsightSettings(component) {
    const source = normalizeSource(component.props.source);
    const state = getStructuredAgriRenderState(component);
    const hints = {
        'agri-model': '推荐绑定 abstract_data_model 节点输出，组件会自动读取 screen_contract.overview 与维度条形数据。',
        'agri-climate': '可绑定 abstract_data_model、forecast 或 climate 类字符串端口，组件会自动寻找气候预测字段。',
        'agri-yield': '可绑定 abstract_data_model、yield 或产量预测类字符串端口，组件会自动寻找 yield_index 与 factor_bars。',
        'agri-decision': '可绑定 abstract_data_model、decision 或辅助决策类字符串端口，组件会自动寻找 top_decision 与 modules 列表。'
    };

    return `
        <section class="prop-section">
            <h3>组件内容</h3>
            <div>
                <label class="prop-label" for="agriInsightTitleInput">标题</label>
                <input class="prop-input" id="agriInsightTitleInput" type="text" value="${escapeHtml(component.props.title || '')}">
            </div>
            ${source.mode === SOURCE_MODE_MANUAL ? `
                <div>
                    <label class="prop-label" for="agriInsightJsonInput">手动 JSON</label>
                    <textarea class="prop-textarea" id="agriInsightJsonInput" spellcheck="false">${escapeHtml(component.props.jsonText || '')}</textarea>
                </div>
            ` : `
                <div>
                    <label class="prop-label">当前绑定</label>
                    <div class="source-preview-box">${escapeHtml(state.sourceNote || '工作流端口')}</div>
                </div>
            `}
            <p class="prop-hint">${escapeHtml(hints[component.type] || '该组件会自动解析农业模型 JSON。')}</p>
            ${state.error ? `<div class="chart-error">${escapeHtml(state.error)}</div>` : ''}
        </section>
    `;
}

function renderAgriSummarySettings(component) {
    const source = normalizeSource(component.props.source);
    const state = getAgriSummaryRenderState(component);
    const previewText = state.view
        ? [state.view.lead, state.view.secondary].filter(Boolean).join('\n')
        : '';

    return `
        <section class="prop-section">
            <h3>组件内容</h3>
            <div>
                <label class="prop-label" for="agriSummaryTitleInput">标题</label>
                <input class="prop-input" id="agriSummaryTitleInput" type="text" value="${escapeHtml(component.props.title || '')}">
            </div>
            ${source.mode === SOURCE_MODE_MANUAL ? `
                <div>
                    <label class="prop-label" for="agriSummaryTextInput">手动内容</label>
                    <textarea class="prop-textarea" id="agriSummaryTextInput" spellcheck="false">${escapeHtml(component.props.jsonText || '')}</textarea>
                </div>
            ` : `
                <div>
                    <label class="prop-label">当前绑定</label>
                    <div class="source-preview-box">${escapeHtml(state.sourceNote || '工作流端口')}</div>
                </div>
            `}
            <p class="prop-hint">推荐绑定 analytics_summary 节点输出的字符串端口。组件会自动解析 JSON，去除多余的花括号、方括号和书名号，并提取结论、告警和建议。</p>
            ${previewText ? `
                <div>
                    <label class="prop-label">摘要预览</label>
                    <div class="source-preview-box">${escapeHtml(previewText)}</div>
                </div>
            ` : ''}
            ${state.error ? `<div class="chart-error">${escapeHtml(state.error)}</div>` : ''}
        </section>
    `;
}

function renderComponentDataSection(component) {
    if (usesWorkflowSource(component.type)) return renderSourceSection(component);
    if (isAgricultureComponentType(component.type)) return renderAgricultureDataSourceSection(component);
    if (isWeatherComponentType(component.type)) return renderWeatherDataSourceSection(component);
    return '';
}

function renderComponentSettingsSection(component) {
    if (component.type === 'text') return renderTextSettings(component);
    if (component.type === 'image') return renderImageSettings(component);
    if (component.type === 'chart') return renderChartSettings(component);
    if (component.type === 'agri-sensor') return renderSensorSettings(component);
    if (isAgriInsightComponentType(component.type)) return renderAgriInsightSettings(component);
    if (component.type === 'agri-summary') return renderAgriSummarySettings(component);
    if (component.type === 'weather') return renderWeatherSettings(component);
    return '';
}

function renderMultiSelectionProperties(components) {
    const cards = components.map(component => `
        <section class="prop-section">
            <h3>${escapeHtml(getComponentTypeLabel(component.type))} #${component.id}</h3>
            <p class="prop-hint">${escapeHtml(summarizeComponentProps(component) || '该组件包含更多属性，请单独选中后编辑。')}</p>
            <div class="prop-grid">
                <div>
                    <label class="prop-label" for="multiCompXInput-${component.id}">X</label>
                    <input class="prop-input" id="multiCompXInput-${component.id}" type="number" value="${component.x}">
                </div>
                <div>
                    <label class="prop-label" for="multiCompYInput-${component.id}">Y</label>
                    <input class="prop-input" id="multiCompYInput-${component.id}" type="number" value="${component.y}">
                </div>
                <div>
                    <label class="prop-label" for="multiCompWidthInput-${component.id}">宽度</label>
                    <input class="prop-input" id="multiCompWidthInput-${component.id}" type="number" min="40" value="${component.width}">
                </div>
                <div>
                    <label class="prop-label" for="multiCompHeightInput-${component.id}">高度</label>
                    <input class="prop-input" id="multiCompHeightInput-${component.id}" type="number" min="40" value="${component.height}">
                </div>
            </div>
            <div>
                <label class="prop-label">完整属性</label>
                <pre class="multi-prop-json">${escapeHtml(JSON.stringify(component.props, null, 2))}</pre>
            </div>
        </section>
    `).join('');

    return `
        <section class="prop-section">
            <h3>多选组件</h3>
            <p class="prop-hint">当前选中 ${components.length} 个组件。可继续按住 Ctrl 点击增减选择，或在空白区域按住左键拖动进行框选。</p>
            <div class="source-summary">
                ${components.map(component => `<span class="source-summary-chip">${escapeHtml(getComponentTypeLabel(component.type))} #${component.id}</span>`).join('')}
            </div>
        </section>
        ${cards}
        <section class="prop-section">
            <h3>组件操作</h3>
            <button class="danger-btn" id="deleteComponentBtn" type="button">删除当前选中组件</button>
        </section>
    `;
}

function renderProperties() {
    const selectedComponents = getSelectedComponents();
    const component = getSelectedComponent();

    if (!selectedComponents.length) {
        refs.propContent.innerHTML = `
            <section class="prop-section">
                <h3>页面设置</h3>
                <p class="prop-hint">未选中组件时，可以直接配置大屏页面尺寸与背景颜色。</p>
                <div class="prop-grid">
                    <div>
                        <label class="prop-label" for="pageWidthInput">画布宽度</label>
                        <input class="prop-input" id="pageWidthInput" type="number" min="320" max="3840" value="${state.page.width}">
                    </div>
                    <div>
                        <label class="prop-label" for="pageHeightInput">画布高度</label>
                        <input class="prop-input" id="pageHeightInput" type="number" min="240" max="2160" value="${state.page.height}">
                    </div>
                </div>
                <div>
                    <label class="prop-label" for="pageBackgroundInput">背景颜色</label>
                    <input class="prop-input" id="pageBackgroundInput" type="color" value="${state.page.background}">
                </div>
            </section>
            <section class="prop-section">
                <h3>使用方式</h3>
                <p class="prop-hint">从左侧拖拽组件到画布中。支持 Ctrl+点击多选组件，也支持在空白区域按住左键拖动进行框选；多选时右侧会显示所有选中组件的属性。单选组件后可直接拖动四角控制点缩放，也可以通过顶部“组件缩放”按钮切换缩放模式后在画布中拖动调整尺寸。除了文本、图片和图表外，还支持智慧农业专用的传感器、环境抽象模型、气候预测、产量预测和辅助决策组件。</p>
            </section>
        `;
        bindPagePropertyInputs();
        return;
    }

    if (selectedComponents.length > 1) {
        refs.propContent.innerHTML = renderMultiSelectionProperties(selectedComponents);
        bindComponentPropertyInputs(null, selectedComponents);
        return;
    }

    refs.propContent.innerHTML = `
        <section class="prop-section">
            <h3>位置与尺寸</h3>
            <div class="prop-grid">
                <div>
                    <label class="prop-label" for="compXInput">X</label>
                    <input class="prop-input" id="compXInput" type="number" value="${component.x}">
                </div>
                <div>
                    <label class="prop-label" for="compYInput">Y</label>
                    <input class="prop-input" id="compYInput" type="number" value="${component.y}">
                </div>
                <div>
                    <label class="prop-label" for="compWidthInput">宽度</label>
                    <input class="prop-input" id="compWidthInput" type="number" min="40" value="${component.width}">
                </div>
                <div>
                    <label class="prop-label" for="compHeightInput">高度</label>
                    <input class="prop-input" id="compHeightInput" type="number" min="40" value="${component.height}">
                </div>
            </div>
        </section>
        ${renderComponentDataSection(component)}
        ${renderComponentSettingsSection(component)}
        <section class="prop-section">
            <h3>组件操作</h3>
            <button class="danger-btn" id="deleteComponentBtn" type="button">删除当前组件</button>
        </section>
    `;

    bindComponentPropertyInputs(component);
}

function normalizeColorValue(color) {
    if (!color || color === 'transparent') return '#ffffff';
    return color;
}

function bindPagePropertyInputs() {
    const widthInput = document.getElementById('pageWidthInput');
    const heightInput = document.getElementById('pageHeightInput');
    const backgroundInput = document.getElementById('pageBackgroundInput');

    if (widthInput) {
        widthInput.addEventListener('input', () => {
            state.page.width = clamp(Number(widthInput.value) || DEFAULT_PAGE.width, 320, 3840);
            renderStage();
        });
        widthInput.addEventListener('change', renderProperties);
    }

    if (heightInput) {
        heightInput.addEventListener('input', () => {
            state.page.height = clamp(Number(heightInput.value) || DEFAULT_PAGE.height, 240, 2160);
            renderStage();
        });
        heightInput.addEventListener('change', renderProperties);
    }

    if (backgroundInput) {
        backgroundInput.addEventListener('input', () => {
            state.page.background = backgroundInput.value || DEFAULT_PAGE.background;
            renderStage();
        });
        backgroundInput.addEventListener('change', renderProperties);
    }
}

function bindComponentPropertyInputs(component, multiComponents = []) {
    if (!component && multiComponents.length) {
        multiComponents.forEach(item => {
            const bindMultiNumeric = (id, targetKey, minValue, maxValue = Number.MAX_SAFE_INTEGER) => {
                const element = document.getElementById(id);
                if (!element) return;
                element.addEventListener('input', () => {
                    item[targetKey] = clamp(Number(element.value) || 0, minValue, maxValue);
                    constrainComponentToStage(item);
                    renderStage();
                });
                element.addEventListener('change', renderProperties);
            };

            bindMultiNumeric(`multiCompXInput-${item.id}`, 'x', 0, state.page.width);
            bindMultiNumeric(`multiCompYInput-${item.id}`, 'y', 0, state.page.height);
            bindMultiNumeric(`multiCompWidthInput-${item.id}`, 'width', 40, state.page.width);
            bindMultiNumeric(`multiCompHeightInput-${item.id}`, 'height', 40, state.page.height);
        });

        const deleteBtn = document.getElementById('deleteComponentBtn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', removeSelectedComponent);
        }
        return;
    }

    if (!component) return;

    const bindNumeric = (id, targetKey, minValue, maxValue = Number.MAX_SAFE_INTEGER) => {
        const element = document.getElementById(id);
        if (!element) return;
        element.addEventListener('input', () => {
            component[targetKey] = clamp(Number(element.value) || 0, minValue, maxValue);
            constrainComponentToStage(component);
            renderStage();
        });
        element.addEventListener('change', renderProperties);
    };

    bindNumeric('compXInput', 'x', 0, state.page.width);
    bindNumeric('compYInput', 'y', 0, state.page.height);
    bindNumeric('compWidthInput', 'width', 40, state.page.width);
    bindNumeric('compHeightInput', 'height', 40, state.page.height);

    const deleteBtn = document.getElementById('deleteComponentBtn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', removeSelectedComponent);
    }

    if (usesWorkflowSource(component.type)) {
        const source = ensureComponentSource(component);
        const sourceModeInput = document.getElementById('sourceModeInput');
        const projectInput = document.getElementById('sourceWorkflowProjectInput');
        const portInput = document.getElementById('sourceWorkflowPortInput');

        if (sourceModeInput) {
            sourceModeInput.addEventListener('change', () => {
                source.mode = sourceModeInput.value === SOURCE_MODE_WORKFLOW_PORT ? SOURCE_MODE_WORKFLOW_PORT : SOURCE_MODE_MANUAL;
                if (source.mode === SOURCE_MODE_WORKFLOW_PORT) {
                    primeWorkflowSource(component);
                }
                renderAll();
            });
        }

        if (projectInput) {
            projectInput.addEventListener('change', () => {
                source.workflowProjectId = projectInput.value;
                source.workflowPortId = '';
                primeWorkflowSource(component);
                renderAll();
            });
        }

        if (portInput) {
            portInput.addEventListener('change', () => {
                source.workflowPortId = portInput.value;
                renderAll();
            });
        }
    }

    if (component.type === 'text') {
        const textInput = document.getElementById('textValueInput');
        const fontSizeInput = document.getElementById('textFontSizeInput');
        const fontWeightInput = document.getElementById('textFontWeightInput');
        const colorInput = document.getElementById('textColorInput');
        const alignInput = document.getElementById('textAlignInput');
        const backgroundInput = document.getElementById('textBackgroundInput');

        if (textInput) {
            textInput.addEventListener('input', () => {
                component.props.text = textInput.value;
                renderStage();
            });
        }
        if (fontSizeInput) {
            fontSizeInput.addEventListener('input', () => {
                component.props.fontSize = clamp(Number(fontSizeInput.value) || 32, 12, 160);
                renderStage();
            });
        }
        if (fontWeightInput) {
            fontWeightInput.addEventListener('change', () => {
                component.props.fontWeight = fontWeightInput.value;
                renderStage();
            });
        }
        if (colorInput) {
            colorInput.addEventListener('input', () => {
                component.props.color = colorInput.value;
                renderStage();
            });
        }
        if (alignInput) {
            alignInput.addEventListener('change', () => {
                component.props.textAlign = alignInput.value;
                renderStage();
            });
        }
        if (backgroundInput) {
            backgroundInput.addEventListener('input', () => {
                component.props.backgroundColor = backgroundInput.value;
                renderStage();
            });
        }
        return;
    }

    if (component.type === 'chart') {
        const chartTitleInput = document.getElementById('chartTitleInput');
        const chartSeriesModeInput = document.getElementById('chartSeriesModeInput');
        const csvUploadInput = document.getElementById('chartCsvUploadInput');
        const csvTextInput = document.getElementById('chartCsvTextInput');
        const chartDataLayoutInput = document.getElementById('chartDataLayoutInput');
        const chartSeriesColumnInput = document.getElementById('chartSeriesColumnInput');
        const chartLabelColumnInput = document.getElementById('chartLabelColumnInput');
        const chartValueColumnInput = document.getElementById('chartValueColumnInput');
        const chartAggregationEnabledInput = document.getElementById('chartAggregationEnabledInput');
        const chartAggregationLimitInput = document.getElementById('chartAggregationLimitInput');
        const chartValueColumnChecks = Array.from(document.querySelectorAll('[data-chart-value-column]'));
        const chartSeriesKeyChecks = Array.from(document.querySelectorAll('[data-chart-series-key]'));

        if (chartTitleInput) {
            chartTitleInput.addEventListener('input', () => {
                component.props.title = chartTitleInput.value;
                renderStage();
            });
        }
        if (chartSeriesModeInput) {
            chartSeriesModeInput.addEventListener('change', () => {
                const nextMode = chartSeriesModeInput.value === CHART_SERIES_MODE_SINGLE || chartSeriesModeInput.value === CHART_SERIES_MODE_DOUBLE
                    ? chartSeriesModeInput.value
                    : CHART_SERIES_MODE_MULTI;
                updateChartProps(component, {
                    seriesMode: nextMode
                });
                renderAll();
            });
        }
        if (csvUploadInput) {
            csvUploadInput.addEventListener('change', async () => {
                const [file] = csvUploadInput.files || [];
                if (!file) return;
                updateChartProps(component, {
                    csvText: await readFileAsText(file),
                    labelColumn: '',
                    valueColumn: '',
                    valueColumns: [],
                    seriesColumn: '',
                    selectedSeriesKeys: []
                });
                renderAll();
            });
        }
        if (csvTextInput) {
            csvTextInput.addEventListener('input', () => {
                updateChartProps(component, {
                    csvText: csvTextInput.value,
                    labelColumn: '',
                    valueColumn: '',
                    valueColumns: [],
                    seriesColumn: '',
                    selectedSeriesKeys: []
                });
                renderAll();
            });
        }
        if (chartDataLayoutInput) {
            chartDataLayoutInput.addEventListener('change', () => {
                updateChartProps(component, {
                    dataLayout: chartDataLayoutInput.value === CHART_DATA_LAYOUT_WIDE
                        ? CHART_DATA_LAYOUT_WIDE
                        : CHART_DATA_LAYOUT_LONG
                });
                renderAll();
            });
        }
        if (chartSeriesColumnInput) {
            chartSeriesColumnInput.addEventListener('change', () => {
                updateChartProps(component, {
                    seriesColumn: chartSeriesColumnInput.value,
                    selectedSeriesKeys: []
                });
                renderAll();
            });
        }
        if (chartLabelColumnInput) {
            chartLabelColumnInput.addEventListener('change', () => {
                updateChartProps(component, {
                    labelColumn: chartLabelColumnInput.value
                });
                renderAll();
            });
        }
        if (chartValueColumnInput) {
            chartValueColumnInput.addEventListener('change', () => {
                updateChartProps(component, {
                    valueColumn: chartValueColumnInput.value
                });
                renderAll();
            });
        }
        if (chartValueColumnChecks.length) {
            chartValueColumnChecks.forEach(input => {
                input.addEventListener('change', () => {
                    const nextValueColumns = applyChartSeriesMode(chartValueColumnChecks
                        .filter(item => item.checked)
                        .map(item => String(item.getAttribute('data-chart-value-column') || '').trim())
                        .filter(Boolean), component.props.seriesMode || CHART_SERIES_MODE_MULTI);
                    updateChartProps(component, {
                        valueColumns: nextValueColumns
                    });
                    renderAll();
                });
            });
        }
        if (chartSeriesKeyChecks.length) {
            chartSeriesKeyChecks.forEach(input => {
                input.addEventListener('change', () => {
                    const nextSeriesKeys = applyChartSeriesMode(chartSeriesKeyChecks
                        .filter(item => item.checked)
                        .map(item => String(item.getAttribute('data-chart-series-key') || '').trim())
                        .filter(Boolean), component.props.seriesMode || CHART_SERIES_MODE_MULTI);
                    updateChartProps(component, {
                        selectedSeriesKeys: nextSeriesKeys
                    });
                    renderAll();
                });
            });
        }
        if (chartAggregationEnabledInput) {
            chartAggregationEnabledInput.addEventListener('change', () => {
                updateChartProps(component, {
                    enableAggregation: chartAggregationEnabledInput.checked
                });
                renderAll();
            });
        }
        if (chartAggregationLimitInput) {
            chartAggregationLimitInput.addEventListener('input', () => {
                updateChartProps(component, {
                    aggregationLimit: chartAggregationLimitInput.value
                });
                renderAll();
            });
        }
        return;
    }

    if (isAgriInsightComponentType(component.type)) {
        const titleInput = document.getElementById('agriInsightTitleInput');
        const jsonInput = document.getElementById('agriInsightJsonInput');

        if (titleInput) {
            titleInput.addEventListener('input', () => {
                component.props.title = titleInput.value;
                renderStage();
            });
        }

        if (jsonInput) {
            jsonInput.addEventListener('input', () => {
                component.props.jsonText = jsonInput.value;
                renderAll();
            });
        }
        return;
    }

    if (component.type === 'agri-summary') {
        const titleInput = document.getElementById('agriSummaryTitleInput');
        const textInput = document.getElementById('agriSummaryTextInput');

        if (titleInput) {
            titleInput.addEventListener('input', () => {
                component.props.title = titleInput.value;
                renderStage();
            });
        }

        if (textInput) {
            textInput.addEventListener('input', () => {
                component.props.jsonText = textInput.value;
                renderAll();
            });
        }
        return;
    }

    if (component.type === 'agri-sensor') {
        const titleInput = document.getElementById('sensorTitleInput');
        const dataModeInput = document.getElementById('agriDataModeInput');
        const apiPathInput = document.getElementById('agriApiPathInput');
        const refreshInput = document.getElementById('agriRefreshIntervalInput');
        const addSensorBtn = document.getElementById('addSensorBtn');

        if (titleInput) {
            titleInput.addEventListener('input', () => {
                component.props.title = titleInput.value;
                renderStage();
            });
        }
        if (dataModeInput) {
            dataModeInput.addEventListener('change', () => {
                component.props.dataMode = dataModeInput.value === AGRI_DATA_MODE_API ? AGRI_DATA_MODE_API : SOURCE_MODE_MANUAL;
                renderStage();
            });
        }
        if (apiPathInput) {
            apiPathInput.addEventListener('input', () => {
                component.props.apiPath = apiPathInput.value;
            });
        }
        if (refreshInput) {
            refreshInput.addEventListener('input', () => {
                component.props.refreshInterval = clamp(Number(refreshInput.value) || 30, 5, 3600);
            });
        }

        document.querySelectorAll('#sensorListContainer .sensor-item').forEach((row, index) => {
            const sensor = Array.isArray(component.props.sensors) ? component.props.sensors[index] : null;
            if (!sensor) return;

            row.querySelector('.sensor-name')?.addEventListener('input', (event) => {
                sensor.name = event.target.value;
                renderStage();
            });
            row.querySelector('.sensor-value')?.addEventListener('input', (event) => {
                sensor.value = event.target.value;
                renderStage();
            });
            row.querySelector('.sensor-unit')?.addEventListener('input', (event) => {
                sensor.unit = event.target.value;
                renderStage();
            });
            row.querySelector('.sensor-status')?.addEventListener('change', (event) => {
                sensor.status = event.target.value;
                renderStage();
            });
            row.querySelector('.remove-sensor-btn')?.addEventListener('click', () => {
                component.props.sensors.splice(index, 1);
                renderAll();
            });
        });

        if (addSensorBtn) {
            addSensorBtn.addEventListener('click', () => {
                if (!Array.isArray(component.props.sensors)) component.props.sensors = [];
                component.props.sensors.push({
                    name: '新传感器',
                    value: '--',
                    unit: '',
                    status: '正常'
                });
                renderAll();
            });
        }
        return;
    }

    if (component.type === 'weather') {
        const bindWeatherText = (id, prop) => {
            const element = document.getElementById(id);
            if (!element) return;
            element.addEventListener('input', () => {
                component.props[prop] = element.value;
                renderStage();
            });
        };

        const weatherDataModeInput = document.getElementById('weatherDataModeInput');
        const weatherRefreshIntervalInput = document.getElementById('weatherRefreshIntervalInput');
        const weatherLatitudeInput = document.getElementById('weatherLatitudeInput');
        const weatherLongitudeInput = document.getElementById('weatherLongitudeInput');
        const weatherCustomApiUrlInput = document.getElementById('weatherCustomApiUrlInput');

        bindWeatherText('weatherTitleInput', 'title');
        bindWeatherText('weatherSubtitleInput', 'subtitle');
        bindWeatherText('weatherConditionInput', 'conditionText');
        bindWeatherText('weatherTempInput', 'tempC');
        bindWeatherText('weatherHumidityInput', 'humidity');
        bindWeatherText('weatherWindInput', 'windKmh');
        bindWeatherText('weatherUpdatedAtInput', 'updatedAt');

        if (weatherDataModeInput) {
            weatherDataModeInput.addEventListener('change', () => {
                component.props.dataMode = weatherDataModeInput.value === WEATHER_DATA_MODE_API ? WEATHER_DATA_MODE_API : SOURCE_MODE_MANUAL;
                component._weatherLastFetchAt = 0;
                renderAll();
                tickEditorWeatherSync();
            });
        }
        if (weatherRefreshIntervalInput) {
            weatherRefreshIntervalInput.addEventListener('input', () => {
                component.props.refreshInterval = clamp(Number(weatherRefreshIntervalInput.value) || 600, WEATHER_REFRESH_MIN_SEC, WEATHER_REFRESH_MAX_SEC);
            });
        }
        if (weatherLatitudeInput) {
            weatherLatitudeInput.addEventListener('input', () => {
                component.props.latitude = Number(weatherLatitudeInput.value);
            });
        }
        if (weatherLongitudeInput) {
            weatherLongitudeInput.addEventListener('input', () => {
                component.props.longitude = Number(weatherLongitudeInput.value);
            });
        }
        if (weatherCustomApiUrlInput) {
            weatherCustomApiUrlInput.addEventListener('input', () => {
                component.props.customApiUrl = weatherCustomApiUrlInput.value;
            });
        }
        return;
    }

    if (component.type === 'agri-system' || component.type === 'agri-environment' || component.type === 'agri-communication') {
        const bindTextProp = (id, propName, rerenderAll = false) => {
            const element = document.getElementById(id);
            if (!element) return;
            element.addEventListener('input', () => {
                component.props[propName] = element.value;
                if (rerenderAll) renderAll();
                else renderStage();
            });
        };

        const dataModeInput = document.getElementById('agriDataModeInput');
        const apiPathInput = document.getElementById('agriApiPathInput');
        const refreshInput = document.getElementById('agriRefreshIntervalInput');

        if (dataModeInput) {
            dataModeInput.addEventListener('change', () => {
                component.props.dataMode = dataModeInput.value === AGRI_DATA_MODE_API ? AGRI_DATA_MODE_API : SOURCE_MODE_MANUAL;
                renderStage();
            });
        }
        if (apiPathInput) {
            apiPathInput.addEventListener('input', () => {
                component.props.apiPath = apiPathInput.value;
            });
        }
        if (refreshInput) {
            refreshInput.addEventListener('input', () => {
                component.props.refreshInterval = clamp(Number(refreshInput.value) || 30, 5, 3600);
            });
        }

        if (component.type === 'agri-system') {
            bindTextProp('agriSystemTitleInput', 'title');
            bindTextProp('agriOnlineDevicesInput', 'onlineDevices');
            bindTextProp('agriTodayDataInput', 'todayData');
            bindTextProp('agriRunTimeInput', 'runTime');
            bindTextProp('agriSystemFooterInput', 'footer');
            return;
        }

        if (component.type === 'agri-environment') {
            bindTextProp('agriEnvironmentTitleInput', 'title');
            bindTextProp('agriTemperatureInput', 'temperature');
            bindTextProp('agriHumidityInput', 'humidity');
            bindTextProp('agriPm25Input', 'pm25');
            bindTextProp('agriLightInput', 'light');
            bindTextProp('agriEnvironmentUpdatedAtInput', 'updatedAt');
            return;
        }

        bindTextProp('agriCommunicationTitleInput', 'title');
        bindTextProp('agriBrokerInput', 'broker');
        bindTextProp('agriMqttStatusInput', 'mqttStatus');
        bindTextProp('agriIntegrityInput', 'dataIntegrity');
        bindTextProp('agriMessageRateInput', 'messageRate');
        bindTextProp('agriLatencyInput', 'latency');
        bindTextProp('agriLastSyncInput', 'lastSync');
        return;
    }

    const uploadInput = document.getElementById('imageUploadInput');
    const srcInput = document.getElementById('imageSrcInput');
    const autoRefreshInput = document.getElementById('imageAutoRefreshInput');
    const refreshIntervalInput = document.getElementById('imageRefreshIntervalInput');
    const altInput = document.getElementById('imageAltInput');
    const fitInput = document.getElementById('imageFitInput');
    const radiusInput = document.getElementById('imageRadiusInput');

    if (uploadInput) {
        uploadInput.addEventListener('change', async () => {
            const [file] = uploadInput.files || [];
            if (!file) return;
            component.props.src = await readFileAsDataUrl(file);
            component.props.autoRefresh = false;
            renderAll();
        });
    }
    if (srcInput) {
        srcInput.addEventListener('input', () => {
            component.props.src = srcInput.value.trim();
            renderStage();
        });
    }
    if (autoRefreshInput) {
        autoRefreshInput.addEventListener('change', () => {
            component.props.autoRefresh = autoRefreshInput.value === 'true';
            renderAll();
        });
    }
    if (refreshIntervalInput) {
        refreshIntervalInput.addEventListener('input', () => {
            component.props.refreshInterval = clamp(Number(refreshIntervalInput.value) || 5, 1, 3600);
        });
    }
    if (altInput) {
        altInput.addEventListener('input', () => {
            component.props.alt = altInput.value;
            renderStage();
        });
    }
    if (fitInput) {
        fitInput.addEventListener('change', () => {
            component.props.objectFit = fitInput.value;
            renderStage();
        });
    }
    if (radiusInput) {
        radiusInput.addEventListener('input', () => {
            component.props.borderRadius = clamp(Number(radiusInput.value) || 0, 0, 80);
            renderStage();
        });
    }
}

function constrainComponentToStage(component) {
    component.width = clamp(component.width, 40, state.page.width);
    component.height = clamp(component.height, 40, state.page.height);
    component.x = clamp(component.x, 0, Math.max(0, state.page.width - component.width));
    component.y = clamp(component.y, 0, Math.max(0, state.page.height - component.height));
}

function beginMoveDrag(selectedComponents, point) {
    if (!selectedComponents.length) return;
    const rightMost = Math.max(...selectedComponents.map(item => item.x + item.width));
    const bottomMost = Math.max(...selectedComponents.map(item => item.y + item.height));
    dragState = {
        interaction: 'move',
        ids: selectedComponents.map(item => item.id),
        startX: point.x,
        startY: point.y,
        originalById: new Map(selectedComponents.map(item => [item.id, { x: item.x, y: item.y }])),
        minX: Math.min(...selectedComponents.map(item => item.x)),
        minY: Math.min(...selectedComponents.map(item => item.y)),
        maxX: rightMost,
        maxY: bottomMost
    };
}

function beginResizeDrag(component, point, handle = '') {
    if (!component) return;
    dragState = {
        interaction: handle ? 'resize-handle' : 'resize-tool',
        componentId: component.id,
        handle,
        startX: point.x,
        startY: point.y,
        original: {
            x: component.x,
            y: component.y,
            width: component.width,
            height: component.height
        }
    };
}

function applyMoveDrag(point) {
    if (!dragState || dragState.interaction !== 'move') return;

    const deltaX = clamp(point.x - dragState.startX, -dragState.minX, state.page.width - dragState.maxX);
    const deltaY = clamp(point.y - dragState.startY, -dragState.minY, state.page.height - dragState.maxY);

    dragState.ids.forEach(id => {
        const component = state.components.get(id);
        const original = dragState.originalById.get(id);
        if (!component || !original) return;
        component.x = original.x + deltaX;
        component.y = original.y + deltaY;
        constrainComponentToStage(component);
    });
}

function applyHandleResize(component, point) {
    if (!dragState || dragState.interaction !== 'resize-handle' || !component) return;

    const minimumSize = 40;
    const original = dragState.original;
    const originalRight = original.x + original.width;
    const originalBottom = original.y + original.height;

    let left = original.x;
    let right = originalRight;
    let top = original.y;
    let bottom = originalBottom;

    if (dragState.handle.includes('w')) {
        left = clamp(point.x, 0, originalRight - minimumSize);
    }
    if (dragState.handle.includes('e')) {
        right = clamp(point.x, original.x + minimumSize, state.page.width);
    }
    if (dragState.handle.includes('n')) {
        top = clamp(point.y, 0, originalBottom - minimumSize);
    }
    if (dragState.handle.includes('s')) {
        bottom = clamp(point.y, original.y + minimumSize, state.page.height);
    }

    component.x = left;
    component.y = top;
    component.width = right - left;
    component.height = bottom - top;
    constrainComponentToStage(component);
}

function applyResizeToolDrag(component, point) {
    if (!dragState || dragState.interaction !== 'resize-tool' || !component) return;

    const original = dragState.original;
    component.width = clamp(original.width + (point.x - dragState.startX), 40, state.page.width - original.x);
    component.height = clamp(original.height + (point.y - dragState.startY), 40, state.page.height - original.y);
    component.x = original.x;
    component.y = original.y;
    constrainComponentToStage(component);
}

function renderAll() {
    renderStage();
    renderProperties();
    updateCanvasStatusBar();
}

function getPointInStage(clientX, clientY) {
    const rect = refs.stage.getBoundingClientRect();
    const zoom = clampCanvasZoom(state.zoom);
    return {
        x: clamp((clientX - rect.left) / zoom, 0, state.page.width),
        y: clamp((clientY - rect.top) / zoom, 0, state.page.height)
    };
}

function getSelectionRect(startPoint, currentPoint) {
    const x = Math.min(startPoint.x, currentPoint.x);
    const y = Math.min(startPoint.y, currentPoint.y);
    const width = Math.abs(currentPoint.x - startPoint.x);
    const height = Math.abs(currentPoint.y - startPoint.y);
    return { x, y, width, height };
}

function getComponentsInSelectionRect(rect) {
    return Array.from(state.components.values())
        .filter(component => {
            const componentRight = component.x + component.width;
            const componentBottom = component.y + component.height;
            const rectRight = rect.x + rect.width;
            const rectBottom = rect.y + rect.height;
            return !(componentRight < rect.x || component.x > rectRight || componentBottom < rect.y || component.y > rectBottom);
        })
        .map(component => component.id);
}

function ensureBoxSelectionOverlay() {
    if (!refs.stage) return null;
    if (!boxSelectionOverlay || !refs.stage.contains(boxSelectionOverlay)) {
        boxSelectionOverlay = document.createElement('div');
        boxSelectionOverlay.className = 'screen-selection-box';
        refs.stage.appendChild(boxSelectionOverlay);
    }
    return boxSelectionOverlay;
}

function hideBoxSelectionOverlay() {
    if (boxSelectionOverlay) {
        boxSelectionOverlay.remove();
        boxSelectionOverlay = null;
    }
}

function updateBoxSelectionOverlay() {
    if (!boxSelectStartPoint || !boxSelectCurrentPoint) return;
    const overlay = ensureBoxSelectionOverlay();
    if (!overlay) return;

    const rect = getSelectionRect(boxSelectStartPoint, boxSelectCurrentPoint);
    overlay.style.left = `${rect.x}px`;
    overlay.style.top = `${rect.y}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
}

function applyBoxSelection() {
    if (!boxSelectStartPoint || !boxSelectCurrentPoint) return;

    const rect = getSelectionRect(boxSelectStartPoint, boxSelectCurrentPoint);
    const hitIds = getComponentsInSelectionRect(rect);
    const mergedIds = Array.from(new Set([...(boxSelectBaseSelection || []), ...hitIds]));
    const primaryId = mergedIds[mergedIds.length - 1] ?? null;
    setSelectedComponents(mergedIds, primaryId);
    renderStage();
    renderProperties();
    if (didBoxSelectMove) {
        updateBoxSelectionOverlay();
    }
}

function beginBoxSelection(event) {
    if (event.button !== 0) return false;
    isBoxSelecting = true;
    boxSelectStartPoint = getPointInStage(event.clientX, event.clientY);
    boxSelectCurrentPoint = boxSelectStartPoint;
    boxSelectBaseSelection = (event.ctrlKey || event.metaKey) ? Array.from(state.selectedIds) : [];
    didBoxSelectMove = false;
    hideBoxSelectionOverlay();
    return true;
}

function finishBoxSelection() {
    isBoxSelecting = false;
    boxSelectStartPoint = null;
    boxSelectCurrentPoint = null;
    boxSelectBaseSelection = [];
    didBoxSelectMove = false;
    hideBoxSelectionOverlay();
}

function bindCanvasStatusBar() {
    if (refs.selectAllBtn) {
        refs.selectAllBtn.addEventListener('click', selectAllComponents);
    }
    if (refs.copyBtn) {
        refs.copyBtn.addEventListener('click', copySelectedComponents);
    }
    if (refs.cutBtn) {
        refs.cutBtn.addEventListener('click', cutSelectedComponents);
    }
    if (refs.pasteBtn) {
        refs.pasteBtn.addEventListener('click', pasteClipboardComponents);
    }
    if (refs.duplicateBtn) {
        refs.duplicateBtn.addEventListener('click', duplicateSelectedComponents);
    }
    if (refs.resizeModeBtn) {
        refs.resizeModeBtn.addEventListener('click', toggleResizeCanvasTool);
    }
    if (refs.bringToFrontBtn) {
        refs.bringToFrontBtn.addEventListener('click', bringSelectedComponentsToFront);
    }
    if (refs.deleteBtn) {
        refs.deleteBtn.addEventListener('click', removeSelectedComponent);
    }

    if (refs.zoomOutBtn) {
        refs.zoomOutBtn.addEventListener('click', () => {
            setCanvasZoom(clampCanvasZoom(state.zoom - 0.1));
        });
    }

    if (refs.zoomInBtn) {
        refs.zoomInBtn.addEventListener('click', () => {
            setCanvasZoom(clampCanvasZoom(state.zoom + 0.1));
        });
    }

    if (refs.zoomResetBtn) {
        refs.zoomResetBtn.addEventListener('click', resetCanvasZoom);
    }

    refs.canvasArea.addEventListener('wheel', (event) => {
        if (!(event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        const delta = event.deltaY < 0 ? 0.1 : -0.1;
        setCanvasZoom(clampCanvasZoom(state.zoom + delta), {
            clientX: event.clientX,
            clientY: event.clientY
        });
    }, { passive: false });
}

function bindLibraryDragAndDrop() {
    refs.library.addEventListener('dragstart', (event) => {
        const card = event.target.closest('[data-component-type]');
        if (!card) return;
        event.dataTransfer.setData('text/plain', card.getAttribute('data-component-type') || '');
        event.dataTransfer.effectAllowed = 'copy';
    });

    refs.canvasArea.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    });

    refs.canvasArea.addEventListener('drop', (event) => {
        event.preventDefault();
        const type = event.dataTransfer.getData('text/plain');
        if (!type) return;
        const point = getPointInStage(event.clientX, event.clientY);
        addComponentAt(type, clamp(point.x - 80, 0, state.page.width - 40), clamp(point.y - 40, 0, state.page.height - 40));
    });
}

function bindStageInteractions() {
    refs.canvasArea.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        if (event.target.closest('[data-component-id]')) return;
        if (event.target.closest('.screen-stage')) return;
        if (!(event.ctrlKey || event.metaKey)) {
            clearSelectedComponents();
            renderAll();
        }
    });

    refs.stage.addEventListener('mousedown', (event) => {
        const isToggleSelection = event.ctrlKey || event.metaKey;
        const componentEl = event.target.closest('[data-component-id]');
        const resizeHandleEl = event.target.closest('[data-resize-handle]');
        if (!componentEl) {
            if (event.button === 0) {
                if (isResizeToolActive() && hasSingleSelection()) {
                    beginResizeDrag(getSelectedComponent(), getPointInStage(event.clientX, event.clientY));
                    event.preventDefault();
                    return;
                }
                if (beginBoxSelection(event)) {
                    event.preventDefault();
                }
            }
            return;
        }

        const componentId = Number(componentEl.getAttribute('data-component-id'));
        const component = state.components.get(componentId);
        if (!component) return;

        if (event.button !== 0) return;

        if (resizeHandleEl) {
            setSelectedComponents([componentId], componentId);
            renderAll();
            beginResizeDrag(component, getPointInStage(event.clientX, event.clientY), String(resizeHandleEl.getAttribute('data-resize-handle') || ''));
            event.preventDefault();
            return;
        }

        if (isToggleSelection) {
            toggleComponentSelection(componentId);
            renderAll();
            event.preventDefault();
            return;
        }

        if (isResizeToolActive()) {
            setSelectedComponents([componentId], componentId);
            renderAll();
            beginResizeDrag(component, getPointInStage(event.clientX, event.clientY));
            event.preventDefault();
            return;
        }

        if (!isComponentSelected(componentId)) {
            setSelectedComponents([componentId], componentId);
        } else if (!hasSelection()) {
            setSelectedComponents([componentId], componentId);
        } else {
            state.selectedId = componentId;
        }
        renderAll();

        const point = getPointInStage(event.clientX, event.clientY);
        const selectedIds = isComponentSelected(componentId) ? Array.from(state.selectedIds) : [componentId];
        const selectedComponents = selectedIds
            .map(id => state.components.get(id))
            .filter(Boolean);
        beginMoveDrag(selectedComponents, point);

        event.preventDefault();
    });

    document.addEventListener('mousemove', (event) => {
        if (isBoxSelecting) {
            boxSelectCurrentPoint = getPointInStage(event.clientX, event.clientY);
            const dx = Math.abs(boxSelectCurrentPoint.x - boxSelectStartPoint.x);
            const dy = Math.abs(boxSelectCurrentPoint.y - boxSelectStartPoint.y);
            if (!didBoxSelectMove && (dx >= 6 || dy >= 6)) {
                didBoxSelectMove = true;
            }
            if (didBoxSelectMove) {
                updateBoxSelectionOverlay();
                applyBoxSelection();
            }
            return;
        }

        if (!dragState) return;

        const point = getPointInStage(event.clientX, event.clientY);
        if (dragState.interaction === 'move') {
            applyMoveDrag(point);
        } else {
            const component = state.components.get(dragState.componentId);
            if (dragState.interaction === 'resize-handle') {
                applyHandleResize(component, point);
            } else if (dragState.interaction === 'resize-tool') {
                applyResizeToolDrag(component, point);
            }
        }
        renderStage();
    });

    document.addEventListener('mouseup', (event) => {
        if (isBoxSelecting) {
            if (didBoxSelectMove) {
                applyBoxSelection();
            } else if (!(event.ctrlKey || event.metaKey)) {
                clearSelectedComponents();
                renderAll();
            }
            finishBoxSelection();
            return;
        }
        const shouldRefreshProps = Boolean(dragState);
        dragState = null;
        if (shouldRefreshProps) {
            renderProperties();
        }
    });

    document.addEventListener('keydown', (event) => {
        const target = event.target;
        const isEditingField = target && (
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable
        );

        if ((event.ctrlKey || event.metaKey) && !isEditingField) {
            const key = event.key.toLowerCase();
            if (key === 'a') {
                event.preventDefault();
                selectAllComponents();
                return;
            }
            if (key === 'c') {
                event.preventDefault();
                copySelectedComponents();
                return;
            }
            if (key === 'x') {
                event.preventDefault();
                cutSelectedComponents();
                return;
            }
            if (key === 'v') {
                event.preventDefault();
                pasteClipboardComponents();
                return;
            }
            if (key === 'd') {
                event.preventDefault();
                duplicateSelectedComponents();
                return;
            }
        }

        if ((event.key === 'Delete' || event.key === 'Backspace') && hasSelection()) {
            if (isEditingField) return;
            event.preventDefault();
            removeSelectedComponent();
        }
    });
}

function buildPreviewHtml() {
    const componentHtml = Array.from(state.components.values()).map(component => {
        if (component.type === 'image') {
            const imageState = getImageRenderState(component);
            const previewDataAttrs = getPreviewDataAttributes(component);
            const previewBaseSrc = component.props.src ? toAbsoluteUrl(component.props.src) : '';
            const previewImageSrc = imageState.kind === 'image' ? toAbsoluteUrl(imageState.src) : '';
            const refreshAttrs = imageState.autoRefresh ? ` data-image-refresh="${imageState.refreshInterval}" data-image-base-src="${escapeHtml(previewBaseSrc)}"` : '';
            const captureBadge = imageState.autoRefresh
                ? `<div data-capture-time-badge style="position:absolute;right:12px;bottom:12px;padding:6px 10px;border-radius:999px;background:rgba(15,23,42,0.72);backdrop-filter:blur(8px);color:#f8fafc;font:600 12px/1.2 'Segoe UI',sans-serif;letter-spacing:0.02em;box-shadow:0 10px 24px rgba(15,23,42,0.22);pointer-events:none;">当前抓拍时间 --:--:--</div>`
                : '';
            const imageContent = imageState.kind === 'image'
                ? `<img src="${escapeHtml(previewImageSrc)}" alt="${escapeHtml(component.props.alt || '')}"${refreshAttrs} style="width:100%;height:100%;object-fit:${escapeHtml(component.props.objectFit || 'cover')};border-radius:${Number(component.props.borderRadius) || 0}px;">${captureBadge}`
                : `
                    <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:18px;background:linear-gradient(145deg,#edf4f8 0%,#e4edf4 100%);color:#66788a;text-align:center;font:16px/1.6 Segoe UI,sans-serif;">
                        <div>
                            <div style="font-weight:700;margin-bottom:8px;">${escapeHtml(imageState.title)}</div>
                        </div>
                    </div>
                `;

            return `
                <div ${previewDataAttrs} style="position:absolute;left:${component.x}px;top:${component.y}px;width:${component.width}px;height:${component.height}px;overflow:hidden;">
                    ${imageContent}
                </div>
            `;
        }

        if (component.type === 'chart') {
            const previewDataAttrs = getPreviewDataAttributes(component);
            const chartHtml = getChartPreviewHtml(component);
            return `
                <div ${previewDataAttrs} style="position:absolute;left:${component.x}px;top:${component.y}px;width:${component.width}px;height:${component.height}px;overflow:hidden;background:#fff;padding:12px;">
                    ${chartHtml}
                </div>
            `;
        }

        if (isAgricultureComponentType(component.type)) {
            const previewDataAttrs = usesWorkflowSource(component.type) ? getPreviewDataAttributes(component) : '';
            return `
                <div ${previewDataAttrs} style="position:absolute;left:${component.x}px;top:${component.y}px;width:${component.width}px;height:${component.height}px;overflow:hidden;padding:14px;">
                    ${renderAgricultureComponentMarkup(component, true)}
                </div>
            `;
        }

        if (isWeatherComponentType(component.type)) {
            return `
                <div style="position:absolute;left:${component.x}px;top:${component.y}px;width:${component.width}px;height:${component.height}px;overflow:hidden;padding:14px;">
                    ${renderWeatherMarkup(component, true)}
                </div>
            `;
        }

        const textState = getTextRenderState(component);
        const previewDataAttrs = getPreviewDataAttributes(component);
        return `
            <div ${previewDataAttrs} style="position:absolute;left:${component.x}px;top:${component.y}px;width:${component.width}px;height:${component.height}px;display:flex;align-items:center;justify-content:${getTextJustifyContent(component.props.textAlign)};padding:14px 18px;line-height:1.5;font-size:${Number(component.props.fontSize) || 32}px;color:${component.props.color || '#1f2937'};font-weight:${component.props.fontWeight || '700'};text-align:${component.props.textAlign || 'left'};background:${component.props.backgroundColor || 'transparent'};">
                <div style="width:100%;white-space:pre-wrap;word-break:break-word;">
                    <div>${escapeHtml(textState.text)}</div>
                </div>
            </div>
        `;
    }).join('');

    const backendOrigin = resolveBackendOrigin();
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>大屏应用预览</title>
    <style>
        * { box-sizing: border-box; }
        body {
            margin: 0;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            padding: 24px;
            background: linear-gradient(160deg, #eaf1f5 0%, #f8fbfd 100%);
            font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        .screen-page {
            position: relative;
            width: ${state.page.width}px;
            height: ${state.page.height}px;
            background: ${state.page.background};
            overflow: hidden;
            box-shadow: 0 24px 60px rgba(19, 31, 43, 0.18);
            border-radius: 24px;
        }
        .chart-wrapper {
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .chart-title {
            font-size: 16px;
            font-weight: 800;
            color: #1a202c;
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .chart-source-note {
            align-self: flex-start;
            padding: 6px 10px;
            border-radius: 999px;
            background: rgba(36, 90, 115, 0.10);
            color: #245a73;
            font-size: 11px;
            font-weight: 700;
        }
        .chart-process-note {
            align-self: flex-start;
            padding: 6px 10px;
            border-radius: 999px;
            background: rgba(47, 128, 237, 0.10);
            color: #245a73;
            font-size: 11px;
            font-weight: 700;
        }
        .chart-legend {
            display: grid;
            gap: 6px;
            margin-top: 8px;
            font-size: 11px;
            color: #475569;
        }
        .chart-legend-item {
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .chart-legend-item span {
            width: 14px;
            height: 14px;
            border-radius: 4px;
            display: inline-block;
        }
        .chart-error {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 14px;
            color: #b91c1c;
            background: rgba(254, 226, 226, 0.7);
            border-radius: 14px;
            text-align: center;
            font-size: 13px;
        }
        .agri-panel {
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 14px 16px;
            border-radius: 20px;
            border: 1px solid rgba(36, 90, 115, 0.12);
            background: linear-gradient(160deg, rgba(7, 35, 49, 0.96), rgba(18, 74, 93, 0.92));
            color: #f8fcff;
            box-shadow: inset 0 0 0 1px rgba(165, 215, 228, 0.08);
            overflow: hidden;
        }
        .agri-panel-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
        }
        .agri-panel-eyebrow {
            color: rgba(194, 236, 229, 0.82);
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            margin-bottom: 4px;
        }
        .agri-panel-title {
            font-size: 20px;
            font-weight: 800;
            line-height: 1.2;
        }
        .agri-mode-chip {
            padding: 6px 10px;
            border-radius: 999px;
            background: rgba(194, 236, 229, 0.14);
            color: #c2ece5;
            font-size: 11px;
            font-weight: 700;
        }
        .agri-kpi-grid,
        .agri-sensor-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
        }
        .agri-kpi-card,
        .agri-sensor-card {
            display: flex;
            flex-direction: column;
            gap: 5px;
            padding: 12px;
            border-radius: 16px;
            background: rgba(230, 249, 242, 0.08);
            border: 1px solid rgba(194, 236, 229, 0.10);
        }
        .agri-kpi-card.wide {
            grid-column: span 2;
        }
        .agri-kpi-label,
        .agri-sensor-label {
            color: rgba(219, 243, 248, 0.76);
            font-size: 11px;
        }
        .agri-kpi-value,
        .agri-sensor-value {
            font-size: 22px;
            font-weight: 800;
            line-height: 1.15;
            word-break: break-word;
        }
        .agri-panel-footer {
            margin-top: auto;
            color: rgba(226, 242, 247, 0.84);
            font-size: 11px;
            line-height: 1.5;
        }
        .agri-model-summary,
        .agri-climate-summary,
        .agri-yield-narrative {
            color: rgba(234, 248, 252, 0.88);
            font-size: 12px;
            line-height: 1.6;
        }
        .agri-summary-lead {
            padding: 14px 16px;
            border-radius: 16px;
            background: rgba(230, 249, 242, 0.10);
            border: 1px solid rgba(194, 236, 229, 0.10);
            color: #ffffff;
            font-size: 15px;
            font-weight: 700;
            line-height: 1.7;
        }
        .agri-summary-secondary {
            color: rgba(229, 246, 249, 0.86);
            font-size: 12px;
            line-height: 1.6;
        }
        .agri-summary-metric-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
        }
        .agri-summary-metric-card {
            display: flex;
            flex-direction: column;
            gap: 5px;
            padding: 12px;
            border-radius: 16px;
            background: rgba(230, 249, 242, 0.08);
            border: 1px solid rgba(194, 236, 229, 0.10);
        }
        .agri-summary-metric-label {
            color: rgba(219, 243, 248, 0.76);
            font-size: 11px;
        }
        .agri-summary-metric-value {
            color: #ffffff;
            font-size: 19px;
            font-weight: 800;
            line-height: 1.3;
            word-break: break-word;
        }
        .agri-summary-sections { display: grid; gap: 10px; }
        .agri-summary-section {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 12px;
            border-radius: 16px;
            background: rgba(230, 249, 242, 0.06);
            border: 1px solid rgba(194, 236, 229, 0.08);
        }
        .agri-summary-section-title {
            color: #c2ece5;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.04em;
        }
        .agri-summary-item-list { display: grid; gap: 8px; }
        .agri-summary-item {
            position: relative;
            padding-left: 14px;
            color: rgba(234, 248, 252, 0.88);
            font-size: 12px;
            line-height: 1.6;
        }
        .agri-summary-item::before {
            content: '';
            position: absolute;
            left: 0;
            top: 0.7em;
            width: 6px;
            height: 6px;
            border-radius: 999px;
            background: linear-gradient(90deg, #34d399 0%, #38bdf8 100%);
            transform: translateY(-50%);
        }
        .agri-kpi-value.agri-kpi-small { font-size: 16px; }
        .agri-kpi-meta { color: rgba(201, 233, 240, 0.82); font-size: 11px; }
        .agri-kpi-grid.agri-kpi-grid-three { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .agri-bar-list { display: grid; gap: 8px; }
        .agri-bar-item {
            display: flex;
            flex-direction: column;
            gap: 5px;
            padding: 8px 10px;
            border-radius: 14px;
            background: rgba(230, 249, 242, 0.06);
            border: 1px solid rgba(194, 236, 229, 0.08);
        }
        .agri-bar-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            font-size: 11px;
            color: rgba(229, 246, 249, 0.88);
        }
        .agri-bar-head strong { font-size: 12px; color: #ffffff; }
        .agri-bar-track {
            width: 100%;
            height: 8px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.10);
            overflow: hidden;
        }
        .agri-bar-track span {
            display: block;
            height: 100%;
            border-radius: inherit;
            background: linear-gradient(90deg, #34d399 0%, #38bdf8 100%);
        }
        .agri-bar-meta { color: rgba(194, 236, 229, 0.78); font-size: 10px; }
        .agri-decision-top {
            padding: 12px 14px;
            border-radius: 16px;
            background: rgba(230, 249, 242, 0.08);
            border: 1px solid rgba(194, 236, 229, 0.10);
        }
        .agri-decision-top-label { color: rgba(194, 236, 229, 0.82); font-size: 11px; margin-bottom: 6px; }
        .agri-decision-top-action { font-size: 22px; font-weight: 800; line-height: 1.2; color: #ffffff; }
        .agri-decision-top-reason { margin-top: 8px; color: rgba(229, 246, 249, 0.86); font-size: 12px; line-height: 1.6; }
        .agri-decision-list { display: grid; gap: 8px; }
        .agri-decision-item {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 10px 12px;
            border-radius: 14px;
            background: rgba(230, 249, 242, 0.06);
            border: 1px solid rgba(194, 236, 229, 0.08);
        }
        .agri-decision-item-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            font-size: 11px;
            color: rgba(201, 233, 240, 0.82);
        }
        .agri-decision-item-head strong { color: #ffffff; font-size: 11px; }
        .agri-decision-item-action { font-size: 15px; font-weight: 700; color: #ffffff; }
        .agri-decision-item-reason { color: rgba(229, 246, 249, 0.80); font-size: 11px; line-height: 1.5; }
        .agri-status-pill {
            padding: 7px 12px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 800;
            color: #0f172a;
            background: #cbd5e1;
            white-space: nowrap;
        }
        .agri-status-pill[data-status="online"] {
            background: #86efac;
            color: #14532d;
        }
        .agri-status-pill[data-status="warn"] {
            background: #fde68a;
            color: #854d0e;
        }
        .agri-status-pill[data-status="offline"] {
            background: #fca5a5;
            color: #7f1d1d;
        }
        .agri-comm-broker {
            padding: 10px 12px;
            border-radius: 14px;
            background: rgba(230, 249, 242, 0.08);
            color: rgba(237, 251, 255, 0.88);
            font-size: 11px;
            line-height: 1.5;
            word-break: break-all;
        }
        .agri-comm-list {
            display: grid;
            gap: 8px;
        }
        .agri-comm-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 14px;
            padding: 9px 11px;
            border-radius: 14px;
            background: rgba(230, 249, 242, 0.08);
            font-size: 12px;
        }
        .agri-comm-row span {
            color: rgba(219, 243, 248, 0.76);
        }
        .agri-comm-row strong {
            color: #ffffff;
            font-size: 13px;
            text-align: right;
            word-break: break-word;
        }
        .weather-panel {
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 14px 16px;
            border-radius: 20px;
            border: 1px solid rgba(56, 189, 248, 0.22);
            background: linear-gradient(155deg, rgba(15, 23, 42, 0.97), rgba(30, 58, 95, 0.94));
            color: #f0f9ff;
            box-shadow: inset 0 0 0 1px rgba(125, 211, 252, 0.08);
            overflow: hidden;
        }
        .weather-panel-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
        }
        .weather-panel-eyebrow { color: rgba(125, 211, 252, 0.85); font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 4px; }
        .weather-panel-title { font-size: 20px; font-weight: 800; line-height: 1.2; }
        .weather-panel-subtitle { margin-top: 4px; font-size: 13px; color: rgba(224, 242, 254, 0.82); }
        .weather-mode-chip { padding: 6px 10px; border-radius: 999px; background: rgba(56, 189, 248, 0.16); color: #bae6fd; font-size: 11px; font-weight: 700; white-space: nowrap; }
        .weather-panel-body { display: flex; flex-wrap: wrap; align-items: center; gap: 16px 24px; flex: 1; min-height: 0; }
        .weather-temp-block { display: flex; align-items: flex-start; gap: 2px; }
        .weather-temp-value { font-size: 44px; font-weight: 800; line-height: 1; letter-spacing: -0.02em; }
        .weather-temp-unit { font-size: 18px; font-weight: 700; margin-top: 6px; color: rgba(224, 242, 254, 0.75); }
        .weather-meta-grid { display: grid; gap: 8px; font-size: 13px; }
        .weather-meta-item { display: flex; align-items: baseline; gap: 10px; }
        .weather-meta-label { color: rgba(186, 230, 253, 0.65); min-width: 36px; }
        .weather-meta-value { font-weight: 700; }
        .weather-panel-foot { margin-top: auto; font-size: 11px; color: rgba(224, 242, 254, 0.72); }
    </style>
</head>
<body>
    <div class="screen-page">${componentHtml}</div>
    <script>
        const AGRI_API_ORIGIN = ${JSON.stringify(backendOrigin)};
        const WEATHER_FORECAST_ENDPOINT = ${JSON.stringify(`${backendOrigin}/api/weather/forecast`)};

        function appendPreviewTimestamp(url, key = '__ts', value = Date.now()) {
            const text = String(url || '').trim();
            if (!text) return '';
            const joiner = text.includes('?') ? '&' : '?';
            return text + joiner + encodeURIComponent(key) + '=' + encodeURIComponent(String(value));
        }

        function getStatusTone(value) {
            const text = String(value || '').trim().toLowerCase();
            if (!text) return 'neutral';
            if (text.includes('离线') || text.includes('中断') || text.includes('异常')) return 'offline';
            if (text.includes('告警') || text.includes('波动') || text.includes('延迟')) return 'warn';
            if (text.includes('在线') || text.includes('正常') || text.includes('已连接')) return 'online';
            return 'neutral';
        }

        function setAgricultureField(root, key, value) {
            if (value == null) return;
            const target = root.querySelector('[data-field="' + key + '"]');
            if (!target) return;
            target.textContent = String(value);
            if (key === 'mqttStatus') {
                target.setAttribute('data-status', getStatusTone(value));
            }
        }

        async function refreshAgricultureCard(root) {
            const apiPath = root.getAttribute('data-api-path') || '';
            if (!apiPath) return;

            try {
                const response = await fetch(new URL(apiPath, AGRI_API_ORIGIN).toString(), { cache: 'no-store' });
                if (!response.ok) return;
                const result = await response.json();
                const data = result && typeof result === 'object' && result.data && typeof result.data === 'object'
                    ? result.data
                    : result;

                if (!data || typeof data !== 'object') return;
                Object.keys(data).forEach(key => setAgricultureField(root, key, data[key]));
            } catch (error) {
                console.warn('农业组件接口刷新失败', apiPath, error);
            }
        }

        function weatherCodeToLabel(code) {
            const n = Number(code);
            const map = { 0: '晴', 1: '大部晴朗', 2: '多云', 3: '阴', 61: '小雨', 63: '中雨', 65: '大雨', 71: '小雪', 80: '阵雨', 95: '雷暴' };
            if (!Number.isFinite(n)) return '天气';
            return map[n] || '天气';
        }

        async function refreshWeatherCard(root) {
            const mode = String(root.getAttribute('data-weather-mode') || 'manual');
            if (mode !== 'api') return;
            const lat = Number(root.getAttribute('data-latitude'));
            const lon = Number(root.getAttribute('data-longitude'));
            const customApiUrl = String(root.getAttribute('data-custom-api-url') || '').trim();
            const endpoint = customApiUrl || (WEATHER_FORECAST_ENDPOINT + '?latitude=' + encodeURIComponent(String(lat)) + '&longitude=' + encodeURIComponent(String(lon)));
            try {
                const response = await fetch(endpoint, { cache: 'no-store' });
                if (!response.ok) return;
                const result = await response.json();
                const payload = result && result.data && !result.current ? result.data : result;
                const current = payload?.current || payload;
                if (!current || typeof current !== 'object') return;
                const temp = root.querySelector('[data-field="tempC"]');
                const humidity = root.querySelector('[data-field="humidity"]');
                const wind = root.querySelector('[data-field="windKmh"]');
                const condition = root.querySelector('[data-field="conditionText"]');
                const updated = root.querySelector('[data-field="updatedAt"]');
                if (temp && Number.isFinite(Number(current.temperature_2m))) temp.textContent = String(Number(current.temperature_2m).toFixed(1));
                if (humidity && Number.isFinite(Number(current.relative_humidity_2m))) humidity.textContent = String(Math.round(Number(current.relative_humidity_2m)));
                if (wind && Number.isFinite(Number(current.wind_speed_10m))) wind.textContent = String(Number(current.wind_speed_10m).toFixed(1));
                if (condition) condition.textContent = weatherCodeToLabel(current.weather_code);
                if (updated) updated.textContent = current.time ? ('观测时间 ' + current.time) : '已更新';
            } catch (error) {
                console.warn('天气组件接口刷新失败', endpoint, error);
            }
        }

        function refreshSnapshotImage(image) {
            const baseSrc = image.getAttribute('data-image-base-src') || '';
            const refreshSeconds = Math.max(1, Number(image.getAttribute('data-image-refresh')) || 5);
            if (!baseSrc) return;
            const container = image.parentElement;
            const badge = container ? container.querySelector('[data-capture-time-badge]') : null;
            const updateBadge = () => {
                if (!badge) return;
                const stamp = new Date();
                badge.textContent = '当前抓拍时间 ' + stamp.toLocaleTimeString('zh-CN', { hour12: false });
            };
            const nextSrc = () => new URL(appendPreviewTimestamp(baseSrc, '__ts', Date.now()), AGRI_API_ORIGIN).toString();
            image.src = nextSrc();
            updateBadge();
            window.setInterval(() => {
                image.src = nextSrc();
                updateBadge();
            }, refreshSeconds * 1000);
        }

        const snapshotImages = Array.from(document.querySelectorAll('[data-image-refresh][data-image-base-src]'));
        snapshotImages.forEach(refreshSnapshotImage);

        const agriCards = Array.from(document.querySelectorAll('[data-agri-component][data-agri-mode="api"]'));
        agriCards.forEach(card => {
            refreshAgricultureCard(card);
            const seconds = Math.max(5, Number(card.getAttribute('data-refresh-interval')) || 30);
            window.setInterval(() => refreshAgricultureCard(card), seconds * 1000);
        });

        const weatherCards = Array.from(document.querySelectorAll('[data-weather-card="1"][data-weather-mode="api"]'));
        weatherCards.forEach(card => {
            refreshWeatherCard(card);
            const seconds = Math.max(10, Number(card.getAttribute('data-refresh-interval')) || 600);
            window.setInterval(() => refreshWeatherCard(card), seconds * 1000);
        });
    </script>
</body>
</html>`;
}

function runPreview() {
    const html = buildPreviewHtml();
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function appendTimestampQuery(url, key = '__ts', value = Date.now()) {
    const text = String(url || '').trim();
    if (!text) return '';
    const joiner = text.includes('?') ? '&' : '?';
    return `${text}${joiner}${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
}

function toAbsoluteUrl(url) {
    const text = String(url || '').trim();
    if (!text) return '';
    if (text.startsWith('data:')) return text;
    return new URL(text, window.location.origin).toString();
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsDataURL(file);
    });
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsText(file, 'utf-8');
    });
}

async function importFromFile(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    loadScreenData(data);
    setCurrentScreenProject(null);
    renderAll();
}
function loadImportedProjectFromSession() {
    const payloadText = sessionStorage.getItem(IMPORT_STORAGE_KEY);
    if (!payloadText) return false;

    sessionStorage.removeItem(IMPORT_STORAGE_KEY);

    try {
        const payload = JSON.parse(payloadText);
        const data = payload?.data;
        if (!data || !Array.isArray(data.components)) {
            return false;
        }
        loadScreenData(data);
        setCurrentScreenProject(null);
        return true;
    } catch (error) {
        return false;
    }
}

function seedDemoProject() {
    state.components.clear();
    state.nextId = 1;
    state.page = { ...DEFAULT_PAGE };
    clearSelectedComponents();

    const title = createTextComponent(88, 72);
    title.width = 460;
    title.height = 110;
    title.props.text = '低代码大屏应用';
    title.props.fontSize = 42;
    title.props.fontWeight = '700';
    title.props.color = '#123b54';

    const subtitle = createTextComponent(92, 180);
    subtitle.width = 540;
    subtitle.height = 96;
    subtitle.props.text = '从左侧拖入组件，编辑属性后点击右上角运行生成网页。也可以将组件绑定到已有工作流端口。';
    subtitle.props.fontSize = 24;
    subtitle.props.fontWeight = '600';
    subtitle.props.color = '#486070';

    const sensor = createSensorComponent(70, 320);
    sensor.width = 400;
    sensor.height = 400;

    const chart = createChartComponent(520, 320);
    chart.width = 850;
    chart.height = 180;
    chart.props.csvText = [
        'time,device_id,value',
        '08:00,A-01,24.6',
        '08:00,B-02,25.1',
        '09:00,A-01,24.9',
        '09:00,B-02,25.6',
        '10:00,A-01,25.2',
        '10:00,B-02,26.0',
        '11:00,A-01,25.4',
        '11:00,B-02,26.3'
    ].join('\n');
    chart.props.dataLayout = CHART_DATA_LAYOUT_LONG;

    state.components.set(title.id, title);
    state.components.set(subtitle.id, subtitle);
    state.components.set(sensor.id, sensor);
    state.components.set(chart.id, chart);
}

function initializeProject() {
    const { entry, projectId } = getQuery();
    if (loadImportedProjectFromSession()) return;

    if (projectId) {
        const project = getProjectById(projectId);
        if (project?.type === 'screen' && Array.isArray(project.data?.components)) {
            touchProject(project.id);
            loadScreenData(project.data);
            setCurrentScreenProject(getProjectById(project.id) || project);
            return;
        }
    }

    if (entry === 'create') {
        state.components.clear();
        state.nextId = 1;
        state.page = { ...DEFAULT_PAGE };
        clearSelectedComponents();
        setCurrentScreenProject(null);
        return;
    }

    seedDemoProject();
    setCurrentScreenProject(null);
}

function bindTopbarActions() {
    refs.openLocalBtn?.addEventListener('click', () => {
        openLocalScreenProjectPicker().catch((error) => {
            window.alert(error?.message || '打开本地项目失败。');
        });
    });

    refs.saveLocalBtn?.addEventListener('click', () => {
        saveScreenProjectLocally().catch((error) => {
            window.alert(error?.message || '保存本地项目失败。');
        });
    });

    refs.saveCloudBtn?.addEventListener('click', () => {
        saveScreenProjectToCloud().catch((error) => {
            window.alert(error?.message || '保存到数据库失败。');
        });
    });

    refs.downloadCloudBtn?.addEventListener('click', () => {
        downloadScreenProjectFromCloud().catch((error) => {
            window.alert(error?.message || '从数据库下载失败。');
        });
    });

    refs.importBtn.addEventListener('click', () => {
        refs.importInput.click();
    });

    refs.importInput.addEventListener('change', async () => {
        const [file] = refs.importInput.files || [];
        if (!file) return;

        try {
            await importFromFile(file);
        } catch (error) {
            window.alert(`导入失败：${error.message}`);
        } finally {
            refs.importInput.value = '';
        }
    });

    refs.exportBtn.addEventListener('click', () => {
        downloadJson('screen_app.json', exportScreenData());
    });

    refs.runBtn.addEventListener('click', runPreview);

    attachAuthControls(refs.accountControls, {
        anonymousLabel: '未登录',
        loginText: '登录',
        logoutText: '退出',
        buttonVariant: 'secondary',
        formatUserLabel: (user) => `当前用户：${user.display_name || user.username}`
    });
}

function bindExternalRefresh() {
    window.addEventListener('focus', renderAll);
    window.addEventListener('storage', (event) => {
        if (event.key === 'ia.lowcode.workflow.runtime.v1' || event.key === 'ia.lowcode.projects.v1') {
            renderAll();
        }
    });
    window.setInterval(tickEditorWeatherSync, 1000);
    tickEditorWeatherSync();
}

function init() {
    renderLibrary();
    initializeProject();
    updateScreenProjectBadge();
    bindLibraryDragAndDrop();
    bindCanvasStatusBar();
    bindStageInteractions();
    bindTopbarActions();
    bindExternalRefresh();
    renderAll();
}

init();
