import { ensureDemoProjects, listProjectsByType, listRecentProjects } from './projectRepository.js';
import { attachAuthControls } from './authService.js';

const IMPORT_STORAGE_KEY = 'ia-editor-import-payload';
const editorEntries = window.editorEntries || {
    workflow: '/workflow-editor',
    screen: '/screen-editor'
};

const refs = {
    recentList: document.getElementById('recentProjectsList'),
    refreshBtn: document.getElementById('refreshRecentBtn'),
    modalMask: document.getElementById('homeModalMask'),
    modalBody: document.getElementById('homeModalBody'),
    modalTitle: document.getElementById('homeModalTitle'),
    modalTag: document.getElementById('homeModalTag'),
    modalCloseBtn: document.getElementById('homeModalCloseBtn')
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
        next_id: Number.isFinite(Number(rawData.next_id)) ? Number(rawData.next_id) : 100,
        workflow_ports: Array.isArray(rawData.workflow_ports) ? rawData.workflow_ports : []
    };
}

function getProjectTypeLabel(projectType) {
    return projectType === 'screen' ? '大屏应用' : '智能工作流';
}

function formatTimeLabel(isoText) {
    const date = new Date(isoText || '');
    if (Number.isNaN(date.getTime())) return '时间未知';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function buildEditorUrl(projectType, query = {}) {
    const entryUrl = editorEntries[projectType] || editorEntries.workflow;
    const targetUrl = new URL(entryUrl, window.location.origin);
    Object.entries(query).forEach(([key, value]) => {
        if (value != null && value !== '') targetUrl.searchParams.set(key, value);
    });
    return targetUrl.toString();
}

function openProjectRecord(project) {
    if (!project?.id || !project?.type) return;
    window.location.href = buildEditorUrl(project.type, { projectId: project.id });
}

function goToEditor(projectType, entryType = 'create') {
    window.location.href = buildEditorUrl(projectType, { entry: entryType, mode: projectType });
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

            closeHomeModal();
            goToEditor(projectType, 'import');
        } catch (error) {
            window.alert(`导入失败：${error.message}`);
        }
    });

    input.click();
}

function renderRecentProjects() {
    const projects = listRecentProjects(8);
    if (!projects.length) {
        refs.recentList.innerHTML = '<div class="recent-empty">最近还没有项目记录。保存或编辑过工作流项目后，这里会按时间倒序展示。</div>';
        return;
    }

    refs.recentList.innerHTML = projects.map(project => `
        <button class="recent-item" type="button" data-open-project-id="${project.id}">
            <strong>${project.name}</strong>
            <span class="recent-meta">${getProjectTypeLabel(project.type)} · 最近活动 ${formatTimeLabel(project.lastOpenedAt || project.updatedAt)}</span>
        </button>
    `).join('');

    refs.recentList.querySelectorAll('[data-open-project-id]').forEach(button => {
        button.addEventListener('click', () => {
            const projectId = button.getAttribute('data-open-project-id');
            const project = listRecentProjects(24).find(item => item.id === projectId);
            if (project) openProjectRecord(project);
        });
    });
}

function closeHomeModal() {
    refs.modalMask.style.display = 'none';
    refs.modalBody.innerHTML = '';
}

function openHomeModal({ projectType, bodyHtml, title }) {
    refs.modalTag.textContent = getProjectTypeLabel(projectType);
    refs.modalTitle.textContent = title;
    refs.modalBody.innerHTML = bodyHtml;
    refs.modalMask.style.display = 'flex';
}

function renderProjectActionModal(projectType) {
    const projectLabel = getProjectTypeLabel(projectType);
    const savedProjects = listProjectsByType(projectType);

    const bodyHtml = `
        <div class="modal-section-title">项目操作</div>
        <button class="modal-action-item" type="button" data-modal-action="create" data-project="${projectType}">
            <strong>创建${projectLabel}</strong>
            <span>进入新的${projectLabel}编辑界面。</span>
        </button>
        <button class="modal-action-item" type="button" data-modal-action="open" data-project="${projectType}">
            <strong>打开${projectLabel}</strong>
            <span>查看本地已保存项目并直接进入编辑器。</span>
        </button>
        <button class="modal-action-item" type="button" data-modal-action="import" data-project="${projectType}">
            <strong>导入${projectLabel}</strong>
            <span>从本地 JSON 文件导入后继续编辑。</span>
        </button>
        <div class="modal-section-title">本地项目</div>
        ${savedProjects.length ? savedProjects.slice(0, 8).map(project => `
            <button class="modal-project-item" type="button" data-modal-project-id="${project.id}">
                <strong>${project.name}</strong>
                <span>最近活动 ${formatTimeLabel(project.lastOpenedAt || project.updatedAt)}</span>
            </button>
        `).join('') : `<div class="modal-empty">当前还没有保存过${projectLabel}项目。</div>`}
    `;

    openHomeModal({
        projectType,
        title: `${projectLabel}入口`,
        bodyHtml
    });

    const openProjectListModal = () => {
        openHomeModal({
            projectType,
            title: `打开${projectLabel}`,
            bodyHtml: savedProjects.length
                ? savedProjects.map(project => `
                    <button class="modal-project-item" type="button" data-modal-project-id="${project.id}">
                        <strong>${project.name}</strong>
                        <span>最近活动 ${formatTimeLabel(project.lastOpenedAt || project.updatedAt)}</span>
                    </button>
                `).join('')
                : `<div class="modal-empty">当前还没有保存过${projectLabel}项目。</div>`
        });

        refs.modalBody.querySelectorAll('[data-modal-project-id]').forEach(button => {
            button.addEventListener('click', () => {
                const projectId = button.getAttribute('data-modal-project-id');
                const project = savedProjects.find(item => item.id === projectId);
                if (!project) return;
                closeHomeModal();
                openProjectRecord(project);
            });
        });
    };

    refs.modalBody.querySelectorAll('[data-modal-action]').forEach(button => {
        button.addEventListener('click', () => {
            const action = button.getAttribute('data-modal-action');
            if (action === 'create') {
                closeHomeModal();
                goToEditor(projectType, 'create');
                return;
            }
            if (action === 'import') {
                importProject(projectType);
                return;
            }
            if (action === 'open') {
                openProjectListModal();
            }
        });
    });

    refs.modalBody.querySelectorAll('[data-modal-project-id]').forEach(button => {
        button.addEventListener('click', () => {
            const projectId = button.getAttribute('data-modal-project-id');
            const project = savedProjects.find(item => item.id === projectId);
            if (!project) return;
            closeHomeModal();
            openProjectRecord(project);
        });
    });
}

function bindHomeActions() {
    document.querySelectorAll('[data-entry-project]').forEach(button => {
        button.addEventListener('click', () => {
            const projectType = button.getAttribute('data-entry-project') || 'workflow';
            renderProjectActionModal(projectType);
        });
    });

    refs.refreshBtn.addEventListener('click', renderRecentProjects);
    refs.modalCloseBtn.addEventListener('click', closeHomeModal);
    refs.modalMask.addEventListener('click', (event) => {
        if (event.target === refs.modalMask) closeHomeModal();
    });
}

ensureDemoProjects();
attachAuthControls(document.getElementById('homeAccountControls'), {
    anonymousLabel: '未登录',
    loginText: '登录',
    logoutText: '退出',
    buttonVariant: 'secondary',
    formatUserLabel: (user) => `当前用户：${user.display_name || user.username}`,
});
bindHomeActions();
renderRecentProjects();
