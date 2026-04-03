const IMPORT_STORAGE_KEY = 'ia-editor-import-payload';
const editorEntries = window.editorEntries || {
    workflow: '/workflow-editor',
    screen: '/screen-editor'
};

function normalizeProjectData(rawData, projectType) {
    if (!rawData || typeof rawData !== 'object') {
        throw new Error('JSON 内容不能为空');
    }

    if (projectType === 'screen') {
        if (!Array.isArray(rawData.components)) {
            throw new Error('JSON 中缺少 components 数组');
        }

        return {
            components: rawData.components,
            next_id: Number.isFinite(Number(rawData.next_id ?? rawData.nextId))
                ? Number(rawData.next_id ?? rawData.nextId)
                : 1,
            page: {
                width: Number.isFinite(Number(rawData.page?.width)) ? Number(rawData.page.width) : 1440,
                height: Number.isFinite(Number(rawData.page?.height)) ? Number(rawData.page.height) : 900,
                background: typeof rawData.page?.background === 'string' ? rawData.page.background : '#f5f7fb'
            }
        };
    }

    if (!Array.isArray(rawData.nodes)) {
        throw new Error('JSON 中缺少 nodes 数组');
    }

    return {
        nodes: rawData.nodes,
        next_id: Number.isFinite(Number(rawData.next_id)) ? Number(rawData.next_id) : 100
    };
}

function goToEditor(projectType, entryType = 'create') {
    const entryUrl = editorEntries[projectType] || editorEntries.workflow;
    const targetUrl = new URL(entryUrl, window.location.origin);
    targetUrl.searchParams.set('mode', projectType);
    targetUrl.searchParams.set('entry', entryType);
    window.location.href = targetUrl.toString();
}

function createJsonInput(onSelect) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
        const [file] = input.files || [];
        if (file) onSelect(file);
    });
    return input;
}

async function importProject(projectType) {
    const input = createJsonInput(async (file) => {
        try {
            const fileText = await file.text();
            const parsedData = JSON.parse(fileText);
            const normalizedData = normalizeProjectData(parsedData, projectType);

            sessionStorage.setItem(IMPORT_STORAGE_KEY, JSON.stringify({
                mode: projectType,
                filename: file.name,
                data: normalizedData
            }));

            goToEditor(projectType, 'import');
        } catch (error) {
            window.alert(`导入失败：${error.message}`);
        }
    });

    input.click();
}

function bindActions() {
    document.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', () => {
            const action = button.getAttribute('data-action');
            const projectType = button.getAttribute('data-project') || 'workflow';

            if (action === 'create') {
                goToEditor(projectType, 'create');
                return;
            }

            if (action === 'import') {
                importProject(projectType);
            }
        });
    });
}

bindActions();
