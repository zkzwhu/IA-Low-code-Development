const STORAGE_KEY = 'ia.lowcode.workflow.runtime.v1';

function buildEmptyStore() {
    return {
        version: 1,
        records: {}
    };
}

function getNowIso() {
    return new Date().toISOString();
}

function normalizePrimitiveValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') return value;
    if (value == null) return '';
    return String(value);
}

function normalizeValueMap(values) {
    const normalized = {};
    if (!values || typeof values !== 'object') return normalized;

    Object.entries(values).forEach(([key, value]) => {
        const normalizedKey = String(key || '').trim();
        if (!normalizedKey) return;
        normalized[normalizedKey] = normalizePrimitiveValue(value);
    });

    return normalized;
}

function normalizeRuntimeRecord(projectId, record) {
    if (!projectId || !record || typeof record !== 'object') return null;
    return {
        projectId: String(projectId),
        updatedAt: String(record.updatedAt || getNowIso()),
        portValuesById: normalizeValueMap(record.portValuesById),
        portValuesByName: normalizeValueMap(record.portValuesByName)
    };
}

function loadStore() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return buildEmptyStore();

        const parsed = JSON.parse(raw);
        const next = buildEmptyStore();
        if (parsed?.records && typeof parsed.records === 'object') {
            Object.entries(parsed.records).forEach(([projectId, record]) => {
                const normalized = normalizeRuntimeRecord(projectId, record);
                if (normalized) next.records[normalized.projectId] = normalized;
            });
        }
        return next;
    } catch (error) {
        return buildEmptyStore();
    }
}

function saveStore(store) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        records: store?.records && typeof store.records === 'object' ? store.records : {}
    }));
}

export function getWorkflowRuntime(projectId) {
    if (!projectId) return null;
    return loadStore().records[String(projectId)] || null;
}

export function saveWorkflowRuntime(projectId, { portValuesById = {}, portValuesByName = {} } = {}) {
    if (!projectId) return null;

    const store = loadStore();
    const normalized = normalizeRuntimeRecord(projectId, {
        updatedAt: getNowIso(),
        portValuesById,
        portValuesByName
    });
    if (!normalized) return null;

    store.records[normalized.projectId] = normalized;
    saveStore(store);
    return normalized;
}

export function clearWorkflowRuntime(projectId) {
    if (!projectId) return;
    const store = loadStore();
    delete store.records[String(projectId)];
    saveStore(store);
}
