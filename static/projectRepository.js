const STORAGE_KEY = 'ia.lowcode.projects.v1';
const MAX_RECENT_PROJECTS = 24;
const DEMO_WORKFLOW_PROJECT_ID = 'workflow-demo-smart-agriculture';
const DEMO_SCREEN_PROJECT_ID = 'screen-demo-smart-agriculture';
const DEMO_VERSION = 3;

export const DEMO_PROJECT_IDS = Object.freeze({
    workflow: DEMO_WORKFLOW_PROJECT_ID,
    screen: DEMO_SCREEN_PROJECT_ID
});

function getNowIso() {
    return new Date().toISOString();
}

function buildEmptyStore() {
    return {
        projects: [],
        version: 1
    };
}

function normalizeProjectRecord(record) {
    if (!record || typeof record !== 'object') return null;

    return {
        id: String(record.id || ''),
        type: record.type === 'screen' ? 'screen' : 'workflow',
        name: String(record.name || '未命名项目'),
        data: record.data && typeof record.data === 'object' ? record.data : {},
        cloudProjectId: record.cloudProjectId == null || record.cloudProjectId === ''
            ? ''
            : String(record.cloudProjectId),
        cloudUpdatedAt: String(record.cloudUpdatedAt || ''),
        createdAt: String(record.createdAt || getNowIso()),
        updatedAt: String(record.updatedAt || record.createdAt || getNowIso()),
        lastOpenedAt: String(record.lastOpenedAt || record.updatedAt || record.createdAt || getNowIso())
    };
}

function loadStore() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return buildEmptyStore();

        const parsed = JSON.parse(raw);
        const projects = Array.isArray(parsed?.projects)
            ? parsed.projects.map(normalizeProjectRecord).filter(Boolean)
            : [];

        return {
            version: 1,
            projects
        };
    } catch (error) {
        return buildEmptyStore();
    }
}

function saveStore(store) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        projects: Array.isArray(store?.projects) ? store.projects.slice(0, MAX_RECENT_PROJECTS * 8) : []
    }));
}

function upsertProjectRecord(nextRecord) {
    const store = loadStore();
    const normalized = normalizeProjectRecord(nextRecord);
    if (!normalized || !normalized.id) return null;

    const index = store.projects.findIndex(project => project.id === normalized.id);
    if (index >= 0) store.projects[index] = normalized;
    else store.projects.push(normalized);

    saveStore(store);
    return normalized;
}

function createProjectId(type) {
    const randomPart = Math.random().toString(36).slice(2, 8);
    return `${type}-${Date.now()}-${randomPart}`;
}

function buildDemoNarrativeText() {
    return [
        '本演示将“数据采集、分析建模、低代码编排、大屏展示”四条主线串成一套完整闭环。',
        '工作流部分覆盖开始、打印、顺序、循环、分支、传感器读取、SQL 查询、分析摘要、抽象模型、输出端口等全部核心节点。',
        '大屏部分同时展示文本、现场抓拍、柱状图、折线图、饼图、传感器卡、模型卡、气候卡、产量卡、决策卡与天气卡。',
        '即使没有真实设备在线，系统也能自动回退到内置演示数据，保证评审、答辩和汇报现场稳定演示。'
    ].join('\n');
}

function buildDemoCameraSnapshotUrl() {
    return '/api/agriculture/camera/snapshot';
}

function buildDemoLatestSensorCsv() {
    return [
        'sensor,current_value,unit,status',
        '温度,24.6,°C,正常',
        '空气湿度,68,%,正常',
        '光照强度,18500,Lux,正常',
        '土壤湿度,45,%,预警',
        'PM2.5,26,μg/m³,正常'
    ].join('\n');
}

function buildDemoHistoryTrendCsv() {
    return [
        'time,temperature,humidity,soil_humidity,light_lux',
        '06:00,21.8,74,51,6200',
        '08:00,23.2,71,49,12800',
        '10:00,24.6,68,46,18500',
        '12:00,25.4,66,44,21600',
        '14:00,26.1,63,42,23100',
        '16:00,25.3,65,43,20500',
        '18:00,24.0,69,45,13200'
    ].join('\n');
}

function buildDemoRiskDistributionCsv() {
    return [
        'level,count',
        '正常,14',
        '关注,6',
        '预警,3',
        '高风险,1'
    ].join('\n');
}

function buildDemoModelDefaultValue() {
    return JSON.stringify({
        status: 'ok',
        model_id: 'demo-agri-twin-default',
        model_name: '智慧农业抽象数据模型',
        screen_contract: {
            overview: {
                title: '智慧农业抽象数据模型',
                summary: '默认模型样例已就绪。运行工作流后，这里会切换为基于实时与历史传感器数据生成的农业环境抽象模型。',
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
                    { label: '光照活跃度', score: 72.5, level: '良好' }
                ]
            },
            decision_support: {
                risk_score: 68.5,
                yield_index: 76.4,
                decision_summary: '当前最优先动作为“择时补水”，以缓解土壤湿度未来 6 小时内持续下滑的风险。',
                top_decision: {
                    module: 'irrigation-controller',
                    action: '择时补水',
                    priority: 'P1',
                    score: 81.2,
                    reason: '预计未来 6 小时土壤湿度将降至 43.9%，需要提前干预。'
                },
                modules: [
                    {
                        module: 'irrigation-controller',
                        action: '择时补水',
                        priority: 'P1',
                        score: 81.2,
                        reason: '预计未来 6 小时土壤湿度将降至 43.9%，需要提前干预。'
                    },
                    {
                        module: 'ventilation-controller',
                        action: '保持低频通风',
                        priority: 'P2',
                        score: 54.6,
                        reason: '温度略有上行，但仍处于适生区间。'
                    },
                    {
                        module: 'disease-risk-evaluator',
                        action: '维持常规巡检',
                        priority: 'P2',
                        score: 42.8,
                        reason: '湿度较平稳，病害风险可控。'
                    }
                ]
            }
        }
    });
}

function buildDemoWorkflowProject() {
    const variableStoryId = 'demo-variable-story';
    const variableFeatureCountId = 'demo-variable-feature-count';
    const variableImageId = 'demo-variable-image';
    const variableLatestCsvId = 'demo-variable-latest-csv';
    const variableTrendCsvId = 'demo-variable-trend-csv';
    const variableRiskCsvId = 'demo-variable-risk-csv';
    const variableOverviewJsonId = 'demo-variable-overview-json';
    const variableAlertsJsonId = 'demo-variable-alerts-json';
    const variableRecommendationsJsonId = 'demo-variable-recommendations-json';
    const variableModelId = 'demo-variable-model';

    return {
        id: DEMO_WORKFLOW_PROJECT_ID,
        type: 'workflow',
        name: '智慧农业演示工程-工作流',
        data: {
            demoVersion: DEMO_VERSION,
            nodes: [
                {
                    id: 100,
                    type: 'start',
                    x: 80,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '开始',
                        nextNodeId: 101,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 101,
                    type: 'print',
                    x: 300,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '演示开场说明',
                        messageSource: 'manual',
                        message: '系统演示开始：将依次执行数据读取、SQL 查询、分析摘要、抽象建模与端口输出。',
                        variableId: null,
                        nextNodeId: 102,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 102,
                    type: 'sequence',
                    x: 520,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '演示链路编排',
                        comment: '串联全部核心节点，保证展示路径清晰。',
                        nextNodeId: 103,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 103,
                    type: 'loop',
                    x: 760,
                    y: 80,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '演示预热循环',
                        loopConditionType: 'count',
                        loopCount: 2,
                        loopConditionExpr: '',
                        bodyNodeIds: [130, 131],
                        nextNodeId: 104,
                        portPositions: {},
                        breakpoint: false,
                        headerHeight: 54,
                        minWidth: 280,
                        minHeight: 210
                    }
                },
                {
                    id: 104,
                    type: 'branch',
                    x: 1100,
                    y: 80,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '演示路径分支',
                        branchCondition: true,
                        trueBranchId: null,
                        falseBranchId: null,
                        trueBodyNodeIds: [132],
                        falseBodyNodeIds: [133],
                        nextNodeId: 105,
                        portPositions: {},
                        breakpoint: false,
                        headerHeight: 54,
                        minWidth: 340,
                        minHeight: 220
                    }
                },
                {
                    id: 105,
                    type: 'get_sensor_info',
                    x: 1480,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '读取最新传感器数据',
                        source: 'latest_data',
                        deviceId: 'SmartAgriculture_thermometer',
                        limit: 8,
                        targetVariableId: variableLatestCsvId,
                        nextNodeId: 106,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 106,
                    type: 'db_query',
                    x: 1730,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '查询历史趋势数据',
                        sql: 'SELECT substr(timestamp, 12, 5) AS time, temperature, humidity, soil_humidity, light_lux FROM (SELECT timestamp, temperature, humidity, soil_humidity, light_lux FROM sensor_data WHERE device_id = "SmartAgriculture_thermometer" ORDER BY timestamp DESC LIMIT 12) ORDER BY timestamp ASC',
                        targetVariableId: variableTrendCsvId,
                        nextNodeId: 107,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 107,
                    type: 'analytics_summary',
                    x: 1980,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '总览分析摘要',
                        analysisType: 'overview',
                        deviceId: 'SmartAgriculture_thermometer',
                        hours: 48,
                        limit: 8,
                        targetVariableId: variableOverviewJsonId,
                        nextNodeId: 108,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 108,
                    type: 'analytics_summary',
                    x: 2230,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '告警分析摘要',
                        analysisType: 'alerts',
                        deviceId: 'SmartAgriculture_thermometer',
                        hours: 48,
                        limit: 8,
                        targetVariableId: variableAlertsJsonId,
                        nextNodeId: 109,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 109,
                    type: 'analytics_summary',
                    x: 2480,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '辅助决策摘要',
                        analysisType: 'recommendations',
                        deviceId: 'SmartAgriculture_thermometer',
                        hours: 48,
                        limit: 8,
                        targetVariableId: variableRecommendationsJsonId,
                        nextNodeId: 110,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 110,
                    type: 'print',
                    x: 2730,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '打印总览结果',
                        messageSource: 'variable',
                        message: '',
                        variableId: variableOverviewJsonId,
                        nextNodeId: 111,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 111,
                    type: 'abstract_data_model',
                    x: 2980,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '构建农业环境抽象模型',
                        deviceId: 'SmartAgriculture_thermometer',
                        hours: 168,
                        minPoints: 24,
                        targetVariableId: variableModelId,
                        nextNodeId: 112,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 112,
                    type: 'output',
                    x: 2980,
                    y: 300,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '输出农业模型',
                        variableId: variableModelId,
                        nextNodeId: 113,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 113,
                    type: 'output',
                    x: 3220,
                    y: 300,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '输出项目亮点文案',
                        variableId: variableStoryId,
                        nextNodeId: 114,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 114,
                    type: 'output',
                    x: 3460,
                    y: 300,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '输出功能模块数量',
                        variableId: variableFeatureCountId,
                        nextNodeId: 115,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 115,
                    type: 'output',
                    x: 3700,
                    y: 300,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '输出现场抓拍地址',
                        variableId: variableImageId,
                        nextNodeId: 116,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 116,
                    type: 'output',
                    x: 3940,
                    y: 300,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '输出实时传感器CSV',
                        variableId: variableLatestCsvId,
                        nextNodeId: 117,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 117,
                    type: 'output',
                    x: 4180,
                    y: 300,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '输出历史趋势CSV',
                        variableId: variableTrendCsvId,
                        nextNodeId: 118,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 118,
                    type: 'output',
                    x: 4420,
                    y: 300,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '输出风险分布CSV',
                        variableId: variableRiskCsvId,
                        nextNodeId: null,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 130,
                    type: 'print',
                    x: 0,
                    y: 0,
                    parentId: 103,
                    localX: 18,
                    localY: 18,
                    properties: {
                        name: '循环-检查采集链路',
                        messageSource: 'manual',
                        message: '循环体：检查设备接入、演示数据与端口映射。',
                        variableId: null,
                        nextNodeId: null,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 131,
                    type: 'print',
                    x: 0,
                    y: 0,
                    parentId: 103,
                    localX: 18,
                    localY: 118,
                    properties: {
                        name: '循环-确认可视化输出',
                        messageSource: 'manual',
                        message: '循环体：准备文本、图表、图片与建模结果的联动输出。',
                        variableId: null,
                        nextNodeId: null,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 132,
                    type: 'print',
                    x: 0,
                    y: 0,
                    parentId: 104,
                    localX: 18,
                    localY: 18,
                    properties: {
                        name: '真分支-进入全链路展示',
                        messageSource: 'manual',
                        message: '分支命中：执行完整的智慧农业全功能演示路径。',
                        variableId: null,
                        nextNodeId: null,
                        portPositions: {},
                        breakpoint: false,
                        branchSide: 'true'
                    }
                },
                {
                    id: 133,
                    type: 'print',
                    x: 0,
                    y: 0,
                    parentId: 104,
                    localX: 18,
                    localY: 18,
                    properties: {
                        name: '假分支-保底说明',
                        messageSource: 'manual',
                        message: '分支未命中时将回退到保底演示数据，保证汇报现场稳定。',
                        variableId: null,
                        nextNodeId: null,
                        portPositions: {},
                        breakpoint: false,
                        branchSide: 'false'
                    }
                }
            ],
            next_id: 4430,
            workflow_variables: [
                {
                    id: variableStoryId,
                    name: '项目亮点文案',
                    dataType: 'string',
                    defaultValue: buildDemoNarrativeText()
                },
                {
                    id: variableFeatureCountId,
                    name: '展示功能总数',
                    dataType: 'int',
                    defaultValue: 11
                },
                {
                    id: variableImageId,
                    name: '现场抓拍地址',
                    dataType: 'string',
                    defaultValue: buildDemoCameraSnapshotUrl()
                },
                {
                    id: variableLatestCsvId,
                    name: '实时传感器CSV',
                    dataType: 'csv',
                    defaultValue: buildDemoLatestSensorCsv()
                },
                {
                    id: variableTrendCsvId,
                    name: '历史趋势CSV',
                    dataType: 'csv',
                    defaultValue: buildDemoHistoryTrendCsv()
                },
                {
                    id: variableRiskCsvId,
                    name: '风险分布CSV',
                    dataType: 'csv',
                    defaultValue: buildDemoRiskDistributionCsv()
                },
                {
                    id: variableOverviewJsonId,
                    name: '总览分析结果JSON',
                    dataType: 'string',
                    defaultValue: '{}'
                },
                {
                    id: variableAlertsJsonId,
                    name: '告警分析结果JSON',
                    dataType: 'string',
                    defaultValue: '[]'
                },
                {
                    id: variableRecommendationsJsonId,
                    name: '建议分析结果JSON',
                    dataType: 'string',
                    defaultValue: '[]'
                },
                {
                    id: variableModelId,
                    name: '农业环境抽象模型JSON',
                    dataType: 'string',
                    defaultValue: buildDemoModelDefaultValue()
                }
            ],
            workflow_ports: [
                {
                    id: 'demo-port-model',
                    name: 'agriTwinModel',
                    dataType: 'string',
                    nodeId: 112,
                    field: 'outputValue'
                },
                {
                    id: 'demo-port-story',
                    name: 'projectHighlights',
                    dataType: 'string',
                    nodeId: 113,
                    field: 'outputValue'
                },
                {
                    id: 'demo-port-feature-count',
                    name: 'featureCount',
                    dataType: 'int',
                    nodeId: 114,
                    field: 'outputValue'
                },
                {
                    id: 'demo-port-image',
                    name: 'cameraSnapshotUrl',
                    dataType: 'string',
                    nodeId: 115,
                    field: 'outputValue'
                },
                {
                    id: 'demo-port-sensor-csv',
                    name: 'sensorMetricsCsv',
                    dataType: 'csv',
                    nodeId: 116,
                    field: 'outputValue'
                },
                {
                    id: 'demo-port-trend-csv',
                    name: 'sensorTrendCsv',
                    dataType: 'csv',
                    nodeId: 117,
                    field: 'outputValue'
                },
                {
                    id: 'demo-port-risk-csv',
                    name: 'riskDistributionCsv',
                    dataType: 'csv',
                    nodeId: 118,
                    field: 'outputValue'
                }
            ]
        }
    };
}

function buildDemoScreenProject() {
    return {
        id: DEMO_SCREEN_PROJECT_ID,
        type: 'screen',
        name: '智慧农业演示工程-大屏',
        data: {
            demoVersion: DEMO_VERSION,
            page: {
                width: 1600,
                height: 1400,
                background: 'radial-gradient(circle at 18% 18%, rgba(59, 130, 246, 0.18), transparent 24%), radial-gradient(circle at 82% 12%, rgba(16, 185, 129, 0.20), transparent 26%), linear-gradient(145deg, #09131c 0%, #102436 42%, #153b34 100%)'
            },
            components: [
                {
                    id: 1,
                    type: 'text',
                    x: 52,
                    y: 42,
                    width: 760,
                    height: 86,
                    props: {
                        text: '智慧农业低代码全链路演示 Demo',
                        fontSize: 44,
                        color: '#f8fafc',
                        fontWeight: '700',
                        textAlign: 'left',
                        backgroundColor: 'transparent',
                        source: { mode: 'manual', workflowProjectId: '', workflowPortId: '' }
                    }
                },
                {
                    id: 2,
                    type: 'text',
                    x: 56,
                    y: 126,
                    width: 930,
                    height: 132,
                    props: {
                        text: '本页面联动展示项目亮点、数据采集、历史趋势、风险分布、农业环境抽象模型、气候预测、产量预测、辅助决策与天气模块。工作流运行后，图表和模型会同步刷新；未运行时也会使用演示默认值稳定展示。',
                        fontSize: 20,
                        color: '#cbd5e1',
                        fontWeight: '600',
                        textAlign: 'left',
                        backgroundColor: 'rgba(15, 23, 42, 0.34)',
                        source: { mode: 'manual', workflowProjectId: '', workflowPortId: '' }
                    }
                },
                {
                    id: 3,
                    type: 'text',
                    x: 1220,
                    y: 48,
                    width: 170,
                    height: 66,
                    props: {
                        text: '展示模块',
                        fontSize: 18,
                        color: '#93c5fd',
                        fontWeight: '700',
                        textAlign: 'center',
                        backgroundColor: 'rgba(15, 23, 42, 0.38)',
                        source: { mode: 'manual', workflowProjectId: '', workflowPortId: '' }
                    }
                },
                {
                    id: 4,
                    type: 'text',
                    x: 1220,
                    y: 116,
                    width: 170,
                    height: 112,
                    props: {
                        text: '11',
                        fontSize: 58,
                        color: '#f8fafc',
                        fontWeight: '700',
                        textAlign: 'center',
                        backgroundColor: 'rgba(14, 116, 144, 0.42)',
                        source: {
                            mode: 'workflow-port',
                            workflowProjectId: DEMO_WORKFLOW_PROJECT_ID,
                            workflowPortId: 'demo-port-feature-count'
                        }
                    }
                },
                {
                    id: 5,
                    type: 'text',
                    x: 56,
                    y: 276,
                    width: 694,
                    height: 146,
                    props: {
                        text: '项目亮点将在这里显示。',
                        fontSize: 18,
                        color: '#e2e8f0',
                        fontWeight: '600',
                        textAlign: 'left',
                        backgroundColor: 'rgba(15, 23, 42, 0.42)',
                        source: {
                            mode: 'workflow-port',
                            workflowProjectId: DEMO_WORKFLOW_PROJECT_ID,
                            workflowPortId: 'demo-port-story'
                        }
                    }
                },
                {
                    id: 6,
                    type: 'agri-sensor',
                    x: 56,
                    y: 452,
                    width: 300,
                    height: 286,
                    props: {
                        title: '实时传感器总览',
                        dataMode: 'api',
                        apiPath: '/api/agriculture/sensor',
                        refreshInterval: 30,
                        sensors: [
                            { name: '温度传感器', value: '24.6', unit: '°C', status: '正常' },
                            { name: '湿度传感器', value: '68', unit: '%', status: '正常' },
                            { name: '光照传感器', value: '18500', unit: 'Lux', status: '正常' },
                            { name: '土壤湿度', value: '45', unit: '%', status: '正常' }
                        ]
                    }
                },
                {
                    id: 7,
                    type: 'image',
                    x: 376,
                    y: 452,
                    width: 344,
                    height: 286,
                    props: {
                        src: buildDemoCameraSnapshotUrl(),
                        alt: '农业现场抓拍',
                        objectFit: 'cover',
                        borderRadius: 22,
                        autoRefresh: true,
                        refreshInterval: 8,
                        source: { mode: 'manual', workflowProjectId: '', workflowPortId: '' }
                    }
                },
                {
                    id: 8,
                    type: 'weather',
                    x: 740,
                    y: 452,
                    width: 340,
                    height: 286,
                    props: {
                        title: '现场天气',
                        subtitle: '武汉示范农田',
                        dataMode: 'api',
                        latitude: 30.5928,
                        longitude: 114.3055,
                        customApiUrl: '',
                        refreshInterval: 600,
                        conditionText: '晴',
                        tempC: '22',
                        humidity: '65',
                        windKmh: '12',
                        updatedAt: '实时刷新'
                    }
                },
                {
                    id: 9,
                    type: 'chart',
                    x: 1100,
                    y: 452,
                    width: 444,
                    height: 286,
                    props: {
                        title: '风险等级分布',
                        chartType: 'pie',
                        csvText: buildDemoRiskDistributionCsv(),
                        labelColumn: '',
                        valueColumn: '',
                        valueColumns: [],
                        seriesColumn: '',
                        seriesMode: 'single',
                        selectedSeriesKeys: [],
                        dataLayout: 'wide',
                        enableAggregation: false,
                        aggregationLimit: 60,
                        source: {
                            mode: 'workflow-port',
                            workflowProjectId: DEMO_WORKFLOW_PROJECT_ID,
                            workflowPortId: 'demo-port-risk-csv'
                        }
                    }
                },
                {
                    id: 10,
                    type: 'chart',
                    x: 56,
                    y: 768,
                    width: 460,
                    height: 320,
                    props: {
                        title: '实时指标对比',
                        chartType: 'bar',
                        csvText: buildDemoLatestSensorCsv(),
                        labelColumn: '',
                        valueColumn: '',
                        valueColumns: [],
                        seriesColumn: '',
                        seriesMode: 'multi',
                        selectedSeriesKeys: [],
                        dataLayout: 'wide',
                        enableAggregation: false,
                        aggregationLimit: 60,
                        source: {
                            mode: 'workflow-port',
                            workflowProjectId: DEMO_WORKFLOW_PROJECT_ID,
                            workflowPortId: 'demo-port-sensor-csv'
                        }
                    }
                },
                {
                    id: 11,
                    type: 'chart',
                    x: 536,
                    y: 768,
                    width: 500,
                    height: 320,
                    props: {
                        title: '历史趋势跟踪',
                        chartType: 'line',
                        csvText: buildDemoHistoryTrendCsv(),
                        labelColumn: '',
                        valueColumn: '',
                        valueColumns: [],
                        seriesColumn: '',
                        seriesMode: 'multi',
                        selectedSeriesKeys: [],
                        dataLayout: 'wide',
                        enableAggregation: false,
                        aggregationLimit: 60,
                        source: {
                            mode: 'workflow-port',
                            workflowProjectId: DEMO_WORKFLOW_PROJECT_ID,
                            workflowPortId: 'demo-port-trend-csv'
                        }
                    }
                },
                {
                    id: 12,
                    type: 'agri-model',
                    x: 1056,
                    y: 768,
                    width: 488,
                    height: 320,
                    props: {
                        title: '农业环境抽象模型',
                        jsonText: '{"status":"waiting"}',
                        source: {
                            mode: 'workflow-port',
                            workflowProjectId: DEMO_WORKFLOW_PROJECT_ID,
                            workflowPortId: 'demo-port-model'
                        }
                    }
                },
                {
                    id: 13,
                    type: 'agri-climate',
                    x: 56,
                    y: 1110,
                    width: 480,
                    height: 260,
                    props: {
                        title: '气候趋势预测',
                        jsonText: '{"status":"waiting"}',
                        source: {
                            mode: 'workflow-port',
                            workflowProjectId: DEMO_WORKFLOW_PROJECT_ID,
                            workflowPortId: 'demo-port-model'
                        }
                    }
                },
                {
                    id: 14,
                    type: 'agri-yield',
                    x: 556,
                    y: 1110,
                    width: 420,
                    height: 260,
                    props: {
                        title: '产量预测',
                        jsonText: '{"status":"waiting"}',
                        source: {
                            mode: 'workflow-port',
                            workflowProjectId: DEMO_WORKFLOW_PROJECT_ID,
                            workflowPortId: 'demo-port-model'
                        }
                    }
                },
                {
                    id: 15,
                    type: 'agri-decision',
                    x: 996,
                    y: 1110,
                    width: 548,
                    height: 260,
                    props: {
                        title: '辅助决策',
                        jsonText: '{"status":"waiting"}',
                        source: {
                            mode: 'workflow-port',
                            workflowProjectId: DEMO_WORKFLOW_PROJECT_ID,
                            workflowPortId: 'demo-port-model'
                        }
                    }
                }
            ],
            next_id: 16
        }
    };
}

function buildDemoNarrativeText() {
    return [
        '演示工程把数据采集、分析建模、低代码编排、项目端口联动与大屏展示串成一条完整闭环。',
        '工作流会依次经过传感器读取、SQL 查询、总览分析、趋势分析、风险告警、策略建议、气候预测、产量预测、辅助决策、报告摘要与环境抽象建模。',
        '大屏同步展示文本、图片、柱状图、折线图、饼图、天气卡、传感器卡、分析摘要卡、模型卡、气候卡、产量卡和决策卡，完整体现组件库与农业特色。',
        '即使现场没有真实设备在线，系统也会自动使用默认 demo 数据兜底，保证答辩、汇报和联调过程稳定可演示。'
    ].join('\n');
}

function buildDemoLatestSensorCsv() {
    return [
        'bucket,temperature,humidity,soil_humidity,pm25,light_lux',
        '2026-04-19T09:30,24.6,68,45,26,18500'
    ].join('\n');
}

function buildDemoHistoryTrendCsv() {
    return [
        'bucket,temperature,humidity,soil_humidity,pm25,light_lux',
        '2026-04-18T18:00,23.4,72,49,24,12500',
        '2026-04-18T20:00,22.9,73,48,23,8600',
        '2026-04-18T22:00,22.3,74,48,22,3200',
        '2026-04-19T00:00,21.9,75,47,22,900',
        '2026-04-19T02:00,21.6,75,47,21,300',
        '2026-04-19T04:00,21.8,74,46,22,450',
        '2026-04-19T06:00,22.4,72,46,23,6200',
        '2026-04-19T08:00,23.8,70,45,25,14800',
        '2026-04-19T10:00,24.6,68,45,26,18500'
    ].join('\n');
}

function buildDemoRiskDistributionCsv() {
    return [
        'level,count',
        '正常,16',
        '关注,6',
        '预警,3',
        '高风险,1'
    ].join('\n');
}

function buildDemoOverviewSummaryPayload() {
    return {
        device_name: 'SmartAgriculture_thermometer',
        work_status: '在线演示',
        online: true,
        location: '武汉示范温室 A-03',
        risk_score: 68.5,
        alert_count: 2,
        total_records: 192,
        data_freshness_minutes: 6,
        observation: '近 24 小时棚内环境总体可控，但土壤湿度正在缓慢回落，当前更适合提前补水而不是被动等待告警扩大。',
        latest_reading: {
            temperature: 24.6,
            humidity: 68.0,
            soil_humidity: 45.0,
            pm25: 26.0,
            light_lux: 18500,
            timestamp: '2026-04-19 09:30:00'
        }
    };
}

function buildDemoAlertsSummaryPayload() {
    return [
        {
            level: 'high',
            metric: 'soil_humidity',
            value: 45.0,
            timestamp: '2026-04-19 09:30:00',
            message: '土壤湿度持续回落，已接近缺水预警区间。',
            suggestion: '建议在未来 2 小时内执行分区补水，并观察回升速度。'
        },
        {
            level: 'medium',
            metric: 'temperature',
            value: 24.6,
            timestamp: '2026-04-19 09:30:00',
            message: '温度有缓慢抬升趋势，午后热负荷可能继续增加。',
            suggestion: '建议保持低频通风，避免棚内热量持续堆积。'
        }
    ];
}

function buildDemoRecommendationsSummaryPayload() {
    return [
        {
            priority: 'P1',
            title: '择时补水',
            detail: '根据土壤湿度与未来 6 小时趋势，优先安排补水动作以降低根区水分波动。',
            expected_effect: '缓解根系水分压力，稳定植株生长节奏。'
        },
        {
            priority: 'P2',
            title: '低频通风',
            detail: '在午后温度继续上升前预留通风窗口，避免棚内闷热积累。',
            expected_effect: '维持温湿平衡，降低病害环境压力。'
        },
        {
            priority: 'P2',
            title: '继续巡检',
            detail: '维持对温湿光土等关键指标的常规巡检，确保告警闭环可追踪。',
            expected_effect: '为后续策略调整提供更稳定的数据依据。'
        }
    ];
}

function buildDemoForecastSummaryPayload() {
    return {
        microclimate_state: '稳定适生型',
        weather_summary: '未来 6 小时棚内温度小幅上升，空气湿度总体平稳，土壤湿度仍有继续回落的风险。',
        confidence: 84.2,
        sample_count: 192,
        predictions: {
            temperature: { next_6h: 25.8, next_24h: 26.6, trend: '上升' },
            humidity: { next_6h: 67.0, next_24h: 66.2, trend: '平稳' },
            soil_humidity: { next_6h: 43.9, next_24h: 41.8, trend: '下降' },
            light_lux: { next_6h: 20400, next_24h: 18800, trend: '波动上升' }
        }
    };
}

function buildDemoYieldSummaryPayload() {
    return {
        yield_index: 76.4,
        estimated_yield_kg_per_mu: 470.8,
        yield_grade: '稳产潜力',
        narrative: '当前环境总体适宜，只要继续维持补水与通风协同策略，产量仍有进一步抬升空间。',
        factor_bars: [
            { label: '热环境适配', score: 78.2, level: '良好' },
            { label: '空气湿度适配', score: 74.1, level: '良好' },
            { label: '土壤供水能力', score: 81.6, level: '优秀' },
            { label: '光照活跃度', score: 72.5, level: '良好' }
        ]
    };
}

function buildDemoDecisionSummaryPayload() {
    return {
        risk_score: 68.5,
        yield_index: 76.4,
        decision_summary: '当前最优先动作为“择时补水”，以缓解土壤湿度未来 6 小时内继续下滑的风险。',
        top_decision: {
            module: 'irrigation-controller',
            action: '择时补水',
            priority: 'P1',
            score: 81.2,
            reason: '预测未来 6 小时土壤湿度将下降至 43.9%，需要提前干预。'
        },
        modules: [
            {
                module: 'irrigation-controller',
                action: '择时补水',
                priority: 'P1',
                score: 81.2,
                reason: '预测未来 6 小时土壤湿度将下降至 43.9%，需要提前干预。'
            },
            {
                module: 'ventilation-controller',
                action: '保持低频通风',
                priority: 'P2',
                score: 54.6,
                reason: '温度有轻微上行，但仍处于适生区间。'
            },
            {
                module: 'disease-risk-evaluator',
                action: '维持常规巡检',
                priority: 'P2',
                score: 42.8,
                reason: '空气湿度相对平稳，病害风险总体可控。'
            }
        ]
    };
}

function buildDemoReportSummaryPayload() {
    return {
        summary: '平台将环境感知、低代码编排、农业分析、模型建构与大屏展示串成完整业务闭环，适合答辩演示与后续项目扩展。',
        contest_fit: {
            scenario: '智慧农业环境监测与辅助决策',
            highlights: [
                '工作流节点可复用传感器采集、SQL 查询、分析摘要和建模结果。',
                '农业分析摘要可直接被摘要卡解析成适合大屏展示的中文结构化内容。',
                '系统在无真实设备时仍可使用 demo 数据稳定展示，不会出现空白页面。'
            ]
        },
        report_outline: [
            '数据来源：温湿光土与 PM2.5 等农业环境时序数据',
            '系统链路：采集、存储、分析、建模、决策与大屏展示',
            '核心价值：降低农业场景应用搭建门槛，提升展示与汇报效率'
        ],
        overview: buildDemoOverviewSummaryPayload(),
        alerts: buildDemoAlertsSummaryPayload(),
        recommendations: buildDemoRecommendationsSummaryPayload(),
        trend_summary: {
            timeline_points: 9,
            temperature_change_48h: 1.2,
            soil_humidity_change_48h: -4.0
        }
    };
}

function buildDemoWorkflowProject() {
    const variableStoryId = 'demo-variable-story';
    const variableFeatureCountId = 'demo-variable-feature-count';
    const variableImageId = 'demo-variable-image';
    const variableLatestCsvId = 'demo-variable-latest-csv';
    const variableTrendCsvId = 'demo-variable-trend-csv';
    const variableRiskCsvId = 'demo-variable-risk-csv';
    const variableOverviewJsonId = 'demo-variable-overview-json';
    const variableAlertsJsonId = 'demo-variable-alerts-json';
    const variableRecommendationsJsonId = 'demo-variable-recommendations-json';
    const variableForecastJsonId = 'demo-variable-forecast-json';
    const variableYieldJsonId = 'demo-variable-yield-json';
    const variableDecisionJsonId = 'demo-variable-decision-json';
    const variableReportJsonId = 'demo-variable-report-json';
    const variableModelId = 'demo-variable-model';

    const createOutputNode = (id, x, y, name, variableId, nextNodeId = null) => ({
        id,
        type: 'output',
        x,
        y,
        parentId: null,
        localX: 0,
        localY: 0,
        properties: {
            name,
            variableId,
            nextNodeId,
            portPositions: {},
            breakpoint: false
        }
    });

    return {
        id: DEMO_WORKFLOW_PROJECT_ID,
        type: 'workflow',
        name: '智慧农业演示工程-工作流',
        data: {
            demoVersion: DEMO_VERSION,
            nodes: [
                {
                    id: 100,
                    type: 'start',
                    x: 80,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '开始',
                        nextNodeId: 101,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 101,
                    type: 'print',
                    x: 300,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '演示开场说明',
                        messageSource: 'manual',
                        message: '系统演示开始：将依次执行采集、查询、分析摘要、预测建模与端口输出。',
                        variableId: null,
                        nextNodeId: 102,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 102,
                    type: 'sequence',
                    x: 520,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '全功能演示链路',
                        comment: '覆盖核心节点类型、分析能力、项目端口与大屏联动。',
                        nextNodeId: 103,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 103,
                    type: 'loop',
                    x: 780,
                    y: 80,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '演示预热循环',
                        loopConditionType: 'count',
                        loopCount: 2,
                        loopConditionExpr: '',
                        bodyNodeIds: [150, 151],
                        nextNodeId: 104,
                        portPositions: {},
                        breakpoint: false,
                        headerHeight: 54,
                        minWidth: 280,
                        minHeight: 210
                    }
                },
                {
                    id: 104,
                    type: 'branch',
                    x: 1120,
                    y: 80,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '演示路径分支',
                        branchCondition: true,
                        trueBranchId: null,
                        falseBranchId: null,
                        trueBodyNodeIds: [152],
                        falseBodyNodeIds: [153],
                        nextNodeId: 105,
                        portPositions: {},
                        breakpoint: false,
                        headerHeight: 54,
                        minWidth: 340,
                        minHeight: 220
                    }
                },
                {
                    id: 105,
                    type: 'get_sensor_info',
                    x: 1500,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '读取最新环境采样',
                        source: 'latest_data',
                        deviceId: 'SmartAgriculture_thermometer',
                        limit: 1,
                        targetVariableId: variableLatestCsvId,
                        nextNodeId: 106,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 106,
                    type: 'db_query',
                    x: 1750,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '查询风险分布 SQL',
                        sql: `SELECT level, COUNT(*) AS count
FROM (
    SELECT CASE
        WHEN soil_humidity <= 35 OR temperature >= 30 THEN '高风险'
        WHEN soil_humidity <= 42 OR temperature >= 27 THEN '预警'
        WHEN soil_humidity <= 48 OR temperature >= 25 THEN '关注'
        ELSE '正常'
    END AS level
    FROM sensor_data
    WHERE device_id = 'SmartAgriculture_thermometer'
    ORDER BY timestamp DESC
    LIMIT 96
) grouped
GROUP BY level
ORDER BY CASE level
    WHEN '正常' THEN 1
    WHEN '关注' THEN 2
    WHEN '预警' THEN 3
    ELSE 4
END`,
                        targetVariableId: variableRiskCsvId,
                        nextNodeId: 107,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 107,
                    type: 'analytics_summary',
                    x: 2000,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '趋势时序分析',
                        analysisType: 'timeline',
                        deviceId: 'SmartAgriculture_thermometer',
                        hours: 48,
                        limit: 12,
                        targetVariableId: variableTrendCsvId,
                        nextNodeId: 108,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 108,
                    type: 'analytics_summary',
                    x: 2250,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '总览分析摘要',
                        analysisType: 'overview',
                        deviceId: 'SmartAgriculture_thermometer',
                        hours: 48,
                        limit: 8,
                        targetVariableId: variableOverviewJsonId,
                        nextNodeId: 109,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 109,
                    type: 'analytics_summary',
                    x: 2500,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '风险告警摘要',
                        analysisType: 'alerts',
                        deviceId: 'SmartAgriculture_thermometer',
                        hours: 48,
                        limit: 8,
                        targetVariableId: variableAlertsJsonId,
                        nextNodeId: 110,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 110,
                    type: 'analytics_summary',
                    x: 2750,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '策略建议摘要',
                        analysisType: 'recommendations',
                        deviceId: 'SmartAgriculture_thermometer',
                        hours: 48,
                        limit: 8,
                        targetVariableId: variableRecommendationsJsonId,
                        nextNodeId: 111,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 111,
                    type: 'analytics_summary',
                    x: 3000,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '气候预测摘要',
                        analysisType: 'forecast',
                        deviceId: 'SmartAgriculture_thermometer',
                        hours: 48,
                        limit: 8,
                        targetVariableId: variableForecastJsonId,
                        nextNodeId: 112,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 112,
                    type: 'analytics_summary',
                    x: 3250,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '产量预测摘要',
                        analysisType: 'yield',
                        deviceId: 'SmartAgriculture_thermometer',
                        hours: 72,
                        limit: 8,
                        targetVariableId: variableYieldJsonId,
                        nextNodeId: 113,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 113,
                    type: 'analytics_summary',
                    x: 3500,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '辅助决策摘要',
                        analysisType: 'decision',
                        deviceId: 'SmartAgriculture_thermometer',
                        hours: 48,
                        limit: 8,
                        targetVariableId: variableDecisionJsonId,
                        nextNodeId: 114,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 114,
                    type: 'analytics_summary',
                    x: 3750,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '报告摘要输出',
                        analysisType: 'report',
                        deviceId: 'SmartAgriculture_thermometer',
                        hours: 48,
                        limit: 8,
                        targetVariableId: variableReportJsonId,
                        nextNodeId: 115,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 115,
                    type: 'print',
                    x: 4000,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '打印报告摘要',
                        messageSource: 'variable',
                        message: '',
                        variableId: variableReportJsonId,
                        nextNodeId: 116,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 116,
                    type: 'abstract_data_model',
                    x: 4250,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '构建农业环境抽象模型',
                        deviceId: 'SmartAgriculture_thermometer',
                        hours: 168,
                        minPoints: 24,
                        targetVariableId: variableModelId,
                        nextNodeId: 117,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                createOutputNode(117, 4250, 320, '输出农业模型', variableModelId, 118),
                createOutputNode(118, 4480, 320, '输出项目亮点文案', variableStoryId, 119),
                createOutputNode(119, 4710, 320, '输出核心能力数量', variableFeatureCountId, 120),
                createOutputNode(120, 4940, 320, '输出现场抓拍地址', variableImageId, 121),
                createOutputNode(121, 5170, 320, '输出最新环境 CSV', variableLatestCsvId, 122),
                createOutputNode(122, 5400, 320, '输出趋势时序 CSV', variableTrendCsvId, 123),
                createOutputNode(123, 5630, 320, '输出风险分布 CSV', variableRiskCsvId, 124),
                createOutputNode(124, 5860, 320, '输出总览摘要', variableOverviewJsonId, 125),
                createOutputNode(125, 6090, 320, '输出告警摘要', variableAlertsJsonId, 126),
                createOutputNode(126, 6320, 320, '输出建议摘要', variableRecommendationsJsonId, 127),
                createOutputNode(127, 6550, 320, '输出预测摘要', variableForecastJsonId, 128),
                createOutputNode(128, 6780, 320, '输出产量摘要', variableYieldJsonId, 129),
                createOutputNode(129, 7010, 320, '输出决策摘要', variableDecisionJsonId, 130),
                createOutputNode(130, 7240, 320, '输出报告摘要', variableReportJsonId, null),
                {
                    id: 150,
                    type: 'print',
                    x: 0,
                    y: 0,
                    parentId: 103,
                    localX: 18,
                    localY: 18,
                    properties: {
                        name: '循环-校验采集链路',
                        messageSource: 'manual',
                        message: '循环体：检查设备接入、演示数据与工作流变量映射。',
                        variableId: null,
                        nextNodeId: null,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 151,
                    type: 'print',
                    x: 0,
                    y: 0,
                    parentId: 103,
                    localX: 18,
                    localY: 118,
                    properties: {
                        name: '循环-确认可视化输出',
                        messageSource: 'manual',
                        message: '循环体：准备文本、图表、摘要卡与建模结果的大屏联动输出。',
                        variableId: null,
                        nextNodeId: null,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 152,
                    type: 'print',
                    x: 0,
                    y: 0,
                    parentId: 104,
                    localX: 18,
                    localY: 18,
                    properties: {
                        name: '真分支-进入完整演示',
                        messageSource: 'manual',
                        message: '分支命中：执行完整的智慧农业全功能演示路径。',
                        variableId: null,
                        nextNodeId: null,
                        portPositions: {},
                        breakpoint: false,
                        branchSide: 'true'
                    }
                },
                {
                    id: 153,
                    type: 'print',
                    x: 0,
                    y: 0,
                    parentId: 104,
                    localX: 18,
                    localY: 18,
                    properties: {
                        name: '假分支-兜底说明',
                        messageSource: 'manual',
                        message: '分支未命中时将回退到保底 demo 数据，保证汇报现场稳定。',
                        variableId: null,
                        nextNodeId: null,
                        portPositions: {},
                        breakpoint: false,
                        branchSide: 'false'
                    }
                }
            ],
            next_id: 8000,
            workflow_variables: [
                {
                    id: variableStoryId,
                    name: '项目亮点文案',
                    dataType: 'string',
                    defaultValue: buildDemoNarrativeText()
                },
                {
                    id: variableFeatureCountId,
                    name: '核心能力数量',
                    dataType: 'int',
                    defaultValue: 16
                },
                {
                    id: variableImageId,
                    name: '现场抓拍地址',
                    dataType: 'string',
                    defaultValue: buildDemoCameraSnapshotUrl()
                },
                {
                    id: variableLatestCsvId,
                    name: '最新环境 CSV',
                    dataType: 'csv',
                    defaultValue: buildDemoLatestSensorCsv()
                },
                {
                    id: variableTrendCsvId,
                    name: '趋势时序 CSV',
                    dataType: 'csv',
                    defaultValue: buildDemoHistoryTrendCsv()
                },
                {
                    id: variableRiskCsvId,
                    name: '风险分布 CSV',
                    dataType: 'csv',
                    defaultValue: buildDemoRiskDistributionCsv()
                },
                {
                    id: variableOverviewJsonId,
                    name: '总览分析结果 JSON',
                    dataType: 'string',
                    defaultValue: JSON.stringify(buildDemoOverviewSummaryPayload(), null, 2)
                },
                {
                    id: variableAlertsJsonId,
                    name: '告警分析结果 JSON',
                    dataType: 'string',
                    defaultValue: JSON.stringify(buildDemoAlertsSummaryPayload(), null, 2)
                },
                {
                    id: variableRecommendationsJsonId,
                    name: '建议分析结果 JSON',
                    dataType: 'string',
                    defaultValue: JSON.stringify(buildDemoRecommendationsSummaryPayload(), null, 2)
                },
                {
                    id: variableForecastJsonId,
                    name: '气候预测结果 JSON',
                    dataType: 'string',
                    defaultValue: JSON.stringify(buildDemoForecastSummaryPayload(), null, 2)
                },
                {
                    id: variableYieldJsonId,
                    name: '产量预测结果 JSON',
                    dataType: 'string',
                    defaultValue: JSON.stringify(buildDemoYieldSummaryPayload(), null, 2)
                },
                {
                    id: variableDecisionJsonId,
                    name: '辅助决策结果 JSON',
                    dataType: 'string',
                    defaultValue: JSON.stringify(buildDemoDecisionSummaryPayload(), null, 2)
                },
                {
                    id: variableReportJsonId,
                    name: '报告摘要结果 JSON',
                    dataType: 'string',
                    defaultValue: JSON.stringify(buildDemoReportSummaryPayload(), null, 2)
                },
                {
                    id: variableModelId,
                    name: '农业环境抽象模型 JSON',
                    dataType: 'string',
                    defaultValue: buildDemoModelDefaultValue()
                }
            ],
            workflow_ports: [
                {
                    id: 'demo-port-model',
                    name: 'agriTwinModel',
                    dataType: 'string',
                    nodeId: 117,
                    field: 'outputValue'
                },
                {
                    id: 'demo-port-story',
                    name: 'projectHighlights',
                    dataType: 'string',
                    nodeId: 118,
                    field: 'outputValue'
                },
                {
                    id: 'demo-port-feature-count',
                    name: 'featureCount',
                    dataType: 'int',
                    nodeId: 119,
                    field: 'outputValue'
                },
                {
                    id: 'demo-port-image',
                    name: 'cameraSnapshotUrl',
                    dataType: 'string',
                    nodeId: 120,
                    field: 'outputValue'
                },
                {
                    id: 'demo-port-sensor-csv',
                    name: 'latestEnvironmentCsv',
                    dataType: 'csv',
                    nodeId: 121,
                    field: 'outputValue'
                },
                {
                    id: 'demo-port-trend-csv',
                    name: 'timelineTrendCsv',
                    dataType: 'csv',
                    nodeId: 122,
                    field: 'outputValue'
                },
                {
                    id: 'demo-port-risk-csv',
                    name: 'riskDistributionCsv',
                    dataType: 'csv',
                    nodeId: 123,
                    field: 'outputValue'
                },
                {
                    id: 'demo-port-overview-summary',
                    name: 'overviewSummaryJson',
                    dataType: 'string',
                    nodeId: 124,
                    field: 'outputValue'
                },
                {
                    id: 'demo-port-alerts-summary',
                    name: 'alertsSummaryJson',
                    dataType: 'string',
                    nodeId: 125,
                    field: 'outputValue'
                },
                {
                    id: 'demo-port-recommendations-summary',
                    name: 'recommendationsSummaryJson',
                    dataType: 'string',
                    nodeId: 126,
                    field: 'outputValue'
                },
                {
                    id: 'demo-port-forecast-summary',
                    name: 'forecastSummaryJson',
                    dataType: 'string',
                    nodeId: 127,
                    field: 'outputValue'
                },
                {
                    id: 'demo-port-yield-summary',
                    name: 'yieldSummaryJson',
                    dataType: 'string',
                    nodeId: 128,
                    field: 'outputValue'
                },
                {
                    id: 'demo-port-decision-summary',
                    name: 'decisionSummaryJson',
                    dataType: 'string',
                    nodeId: 129,
                    field: 'outputValue'
                },
                {
                    id: 'demo-port-report-summary',
                    name: 'reportSummaryJson',
                    dataType: 'string',
                    nodeId: 130,
                    field: 'outputValue'
                }
            ]
        }
    };
}

function buildDemoScreenProject() {
    const portSource = (workflowPortId) => ({
        mode: 'workflow-port',
        workflowProjectId: DEMO_WORKFLOW_PROJECT_ID,
        workflowPortId
    });

    const manualSource = () => ({
        mode: 'manual',
        workflowProjectId: '',
        workflowPortId: ''
    });

    const createSummaryComponent = (id, x, y, width, height, title, workflowPortId, fallbackPayload) => ({
        id,
        type: 'agri-summary',
        x,
        y,
        width,
        height,
        props: {
            title,
            jsonText: JSON.stringify(fallbackPayload, null, 2),
            source: portSource(workflowPortId)
        }
    });

    return {
        id: DEMO_SCREEN_PROJECT_ID,
        type: 'screen',
        name: '智慧农业演示工程-大屏',
        data: {
            demoVersion: DEMO_VERSION,
            page: {
                width: 1600,
                height: 1960,
                background: 'radial-gradient(circle at 18% 18%, rgba(59, 130, 246, 0.18), transparent 24%), radial-gradient(circle at 82% 12%, rgba(16, 185, 129, 0.20), transparent 26%), linear-gradient(145deg, #09131c 0%, #102436 42%, #153b34 100%)'
            },
            components: [
                {
                    id: 1,
                    type: 'text',
                    x: 52,
                    y: 38,
                    width: 980,
                    height: 76,
                    props: {
                        text: '智慧农业低代码全功能演示工程',
                        fontSize: 44,
                        color: '#f8fafc',
                        fontWeight: '700',
                        textAlign: 'left',
                        backgroundColor: 'transparent',
                        source: manualSource()
                    }
                },
                {
                    id: 2,
                    type: 'text',
                    x: 56,
                    y: 116,
                    width: 1010,
                    height: 104,
                    props: {
                        text: '同一张大屏内同时展示工作流摘要解析、农业建模结果、图表组件、图片抓拍、实时天气和传感器卡，完整体现系统的通用能力与农业场景特殊性。',
                        fontSize: 20,
                        color: '#cbd5e1',
                        fontWeight: '600',
                        textAlign: 'left',
                        backgroundColor: 'rgba(15, 23, 42, 0.34)',
                        source: manualSource()
                    }
                },
                {
                    id: 3,
                    type: 'text',
                    x: 1218,
                    y: 46,
                    width: 180,
                    height: 62,
                    props: {
                        text: '核心能力',
                        fontSize: 18,
                        color: '#93c5fd',
                        fontWeight: '700',
                        textAlign: 'center',
                        backgroundColor: 'rgba(15, 23, 42, 0.38)',
                        source: manualSource()
                    }
                },
                {
                    id: 4,
                    type: 'text',
                    x: 1218,
                    y: 110,
                    width: 180,
                    height: 110,
                    props: {
                        text: '16',
                        fontSize: 56,
                        color: '#f8fafc',
                        fontWeight: '700',
                        textAlign: 'center',
                        backgroundColor: 'rgba(14, 116, 144, 0.42)',
                        source: portSource('demo-port-feature-count')
                    }
                },
                {
                    id: 5,
                    type: 'text',
                    x: 56,
                    y: 244,
                    width: 1488,
                    height: 112,
                    props: {
                        text: buildDemoNarrativeText(),
                        fontSize: 17,
                        color: '#e2e8f0',
                        fontWeight: '600',
                        textAlign: 'left',
                        backgroundColor: 'rgba(15, 23, 42, 0.42)',
                        source: portSource('demo-port-story')
                    }
                },
                {
                    id: 6,
                    type: 'agri-sensor',
                    x: 56,
                    y: 384,
                    width: 300,
                    height: 286,
                    props: {
                        title: '实时传感器总览',
                        dataMode: 'api',
                        apiPath: '/api/agriculture/sensor',
                        refreshInterval: 30,
                        sensors: [
                            { name: '温度传感器', value: '24.6', unit: '°C', status: '正常' },
                            { name: '湿度传感器', value: '68', unit: '%', status: '正常' },
                            { name: '光照传感器', value: '18500', unit: 'Lux', status: '正常' },
                            { name: '土壤湿度', value: '45', unit: '%', status: '正常' }
                        ]
                    }
                },
                {
                    id: 7,
                    type: 'image',
                    x: 376,
                    y: 384,
                    width: 344,
                    height: 286,
                    props: {
                        src: buildDemoCameraSnapshotUrl(),
                        alt: '农业现场抓拍',
                        objectFit: 'cover',
                        borderRadius: 22,
                        autoRefresh: true,
                        refreshInterval: 8,
                        source: portSource('demo-port-image')
                    }
                },
                {
                    id: 8,
                    type: 'weather',
                    x: 740,
                    y: 384,
                    width: 340,
                    height: 286,
                    props: {
                        title: '现场天气',
                        subtitle: '武汉示范温室',
                        dataMode: 'api',
                        latitude: 30.5928,
                        longitude: 114.3055,
                        customApiUrl: '',
                        refreshInterval: 600,
                        conditionText: '晴',
                        tempC: '22',
                        humidity: '65',
                        windKmh: '12',
                        updatedAt: '实时刷新'
                    }
                },
                {
                    id: 9,
                    type: 'chart',
                    x: 1100,
                    y: 384,
                    width: 444,
                    height: 286,
                    props: {
                        title: '风险等级分布',
                        chartType: 'pie',
                        csvText: buildDemoRiskDistributionCsv(),
                        labelColumn: '',
                        valueColumn: '',
                        valueColumns: [],
                        seriesColumn: '',
                        seriesMode: 'single',
                        selectedSeriesKeys: [],
                        dataLayout: 'wide',
                        enableAggregation: false,
                        aggregationLimit: 60,
                        source: portSource('demo-port-risk-csv')
                    }
                },
                {
                    id: 10,
                    type: 'chart',
                    x: 56,
                    y: 700,
                    width: 460,
                    height: 320,
                    props: {
                        title: '最新环境指标',
                        chartType: 'bar',
                        csvText: buildDemoLatestSensorCsv(),
                        labelColumn: '',
                        valueColumn: '',
                        valueColumns: [],
                        seriesColumn: '',
                        seriesMode: 'multi',
                        selectedSeriesKeys: [],
                        dataLayout: 'wide',
                        enableAggregation: false,
                        aggregationLimit: 60,
                        source: portSource('demo-port-sensor-csv')
                    }
                },
                {
                    id: 11,
                    type: 'chart',
                    x: 536,
                    y: 700,
                    width: 500,
                    height: 320,
                    props: {
                        title: '48 小时趋势时序',
                        chartType: 'line',
                        csvText: buildDemoHistoryTrendCsv(),
                        labelColumn: '',
                        valueColumn: '',
                        valueColumns: [],
                        seriesColumn: '',
                        seriesMode: 'multi',
                        selectedSeriesKeys: [],
                        dataLayout: 'wide',
                        enableAggregation: false,
                        aggregationLimit: 60,
                        source: portSource('demo-port-trend-csv')
                    }
                },
                {
                    id: 12,
                    type: 'agri-model',
                    x: 1056,
                    y: 700,
                    width: 488,
                    height: 320,
                    props: {
                        title: '农业环境抽象模型',
                        jsonText: buildDemoModelDefaultValue(),
                        source: portSource('demo-port-model')
                    }
                },
                {
                    id: 13,
                    type: 'agri-climate',
                    x: 56,
                    y: 1044,
                    width: 480,
                    height: 260,
                    props: {
                        title: '气候趋势预测',
                        jsonText: buildDemoModelDefaultValue(),
                        source: portSource('demo-port-model')
                    }
                },
                {
                    id: 14,
                    type: 'agri-yield',
                    x: 556,
                    y: 1044,
                    width: 420,
                    height: 260,
                    props: {
                        title: '产量预测',
                        jsonText: buildDemoModelDefaultValue(),
                        source: portSource('demo-port-model')
                    }
                },
                {
                    id: 15,
                    type: 'agri-decision',
                    x: 996,
                    y: 1044,
                    width: 548,
                    height: 260,
                    props: {
                        title: '辅助决策',
                        jsonText: buildDemoModelDefaultValue(),
                        source: portSource('demo-port-model')
                    }
                },
                createSummaryComponent(16, 56, 1332, 360, 280, '总览摘要卡', 'demo-port-overview-summary', buildDemoOverviewSummaryPayload()),
                createSummaryComponent(17, 434, 1332, 360, 280, '告警摘要卡', 'demo-port-alerts-summary', buildDemoAlertsSummaryPayload()),
                createSummaryComponent(18, 812, 1332, 360, 280, '建议摘要卡', 'demo-port-recommendations-summary', buildDemoRecommendationsSummaryPayload()),
                createSummaryComponent(19, 1190, 1332, 354, 280, '报告摘要卡', 'demo-port-report-summary', buildDemoReportSummaryPayload()),
                createSummaryComponent(20, 56, 1636, 476, 280, '气候预测摘要卡', 'demo-port-forecast-summary', buildDemoForecastSummaryPayload()),
                createSummaryComponent(21, 548, 1636, 476, 280, '产量预测摘要卡', 'demo-port-yield-summary', buildDemoYieldSummaryPayload()),
                createSummaryComponent(22, 1040, 1636, 504, 280, '决策摘要卡', 'demo-port-decision-summary', buildDemoDecisionSummaryPayload())
            ],
            next_id: 23
        }
    };
}

function getRecentSortValue(project) {
    return Math.max(
        Date.parse(project?.lastOpenedAt || '') || 0,
        Date.parse(project?.updatedAt || '') || 0,
        Date.parse(project?.createdAt || '') || 0
    );
}

export function createProjectRecord({ type = 'workflow', name = '未命名项目', data = {} } = {}) {
    const now = getNowIso();
    const cloudProjectId = arguments[0]?.cloudProjectId;
    const cloudUpdatedAt = arguments[0]?.cloudUpdatedAt;

    return upsertProjectRecord({
        id: createProjectId(type),
        type,
        name,
        data,
        cloudProjectId: cloudProjectId == null ? '' : String(cloudProjectId),
        cloudUpdatedAt: String(cloudUpdatedAt || ''),
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now
    });
}

export function getProjectById(projectId) {
    if (!projectId) return null;
    return loadStore().projects.find(project => project.id === String(projectId)) || null;
}

export function findProjectByCloudId(type, cloudProjectId) {
    const normalizedCloudId = cloudProjectId == null || cloudProjectId === ''
        ? ''
        : String(cloudProjectId);
    if (!normalizedCloudId) return null;

    return loadStore().projects.find(project => (
        project.type === (type === 'screen' ? 'screen' : 'workflow')
        && String(project.cloudProjectId || '') === normalizedCloudId
    )) || null;
}

export function saveProjectData(projectId, { name, data, touchOpen = true } = {}) {
    const existing = getProjectById(projectId);
    if (!existing) return null;

    const now = getNowIso();
    const cloudProjectId = arguments[1]?.cloudProjectId;
    const cloudUpdatedAt = arguments[1]?.cloudUpdatedAt;

    return upsertProjectRecord({
        ...existing,
        name: typeof name === 'string' && name.trim() ? name.trim() : existing.name,
        data: data && typeof data === 'object' ? data : existing.data,
        cloudProjectId: cloudProjectId === undefined
            ? existing.cloudProjectId
            : (cloudProjectId == null ? '' : String(cloudProjectId)),
        cloudUpdatedAt: cloudUpdatedAt === undefined
            ? existing.cloudUpdatedAt
            : String(cloudUpdatedAt || ''),
        updatedAt: now,
        lastOpenedAt: touchOpen ? now : existing.lastOpenedAt
    });
}

export function touchProject(projectId) {
    const existing = getProjectById(projectId);
    if (!existing) return null;

    return upsertProjectRecord({
        ...existing,
        lastOpenedAt: getNowIso()
    });
}

export function listProjectsByType(type) {
    return loadStore().projects
        .filter(project => project.type === type)
        .sort((a, b) => getRecentSortValue(b) - getRecentSortValue(a));
}

export function listRecentProjects(limit = 8) {
    return loadStore().projects
        .sort((a, b) => getRecentSortValue(b) - getRecentSortValue(a))
        .slice(0, Math.max(1, limit));
}

export function removeProject(projectId) {
    const store = loadStore();
    store.projects = store.projects.filter(project => project.id !== String(projectId));
    saveStore(store);
}

export function renameProject(projectId, nextName) {
    const existing = getProjectById(projectId);
    if (!existing) return null;

    return upsertProjectRecord({
        ...existing,
        name: String(nextName || existing.name).trim() || existing.name,
        updatedAt: getNowIso()
    });
}

export function ensureDemoProjects() {
    const workflowProject = getProjectById(DEMO_WORKFLOW_PROJECT_ID);
    if (!workflowProject || Number(workflowProject.data?.demoVersion || 0) < DEMO_VERSION) {
        upsertProjectRecord({
            ...buildDemoWorkflowProject(),
            createdAt: workflowProject?.createdAt || getNowIso(),
            updatedAt: getNowIso(),
            lastOpenedAt: workflowProject?.lastOpenedAt || getNowIso()
        });
    }

    const screenProject = getProjectById(DEMO_SCREEN_PROJECT_ID);
    if (!screenProject || Number(screenProject.data?.demoVersion || 0) < DEMO_VERSION) {
        upsertProjectRecord({
            ...buildDemoScreenProject(),
            createdAt: screenProject?.createdAt || getNowIso(),
            updatedAt: getNowIso(),
            lastOpenedAt: screenProject?.lastOpenedAt || getNowIso()
        });
    }
}
