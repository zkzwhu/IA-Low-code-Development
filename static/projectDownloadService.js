import { showSharedDialog } from './dialogService.js';

function sanitizeFileName(name, fallback = 'project') {
    const normalized = String(name || '')
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
        .replace(/\s+/g, ' ');
    return normalized || fallback;
}

function buildProjectFileName(projectName, projectType) {
    const fallback = projectType === 'screen' ? 'screen-project' : 'workflow-project';
    return `${sanitizeFileName(projectName, fallback)}.json`;
}

function isAbortError(error) {
    return error?.name === 'AbortError';
}

function createProgressBody() {
    return `
        <div class="shared-progress-card">
            <div class="shared-progress-track">
                <div class="shared-progress-fill" id="projectDownloadProgressFill"></div>
            </div>
            <div class="shared-progress-meta">
                <strong id="projectDownloadProgressValue">0%</strong>
                <span id="projectDownloadProgressPhase">准备中</span>
            </div>
            <div class="shared-progress-status" id="projectDownloadProgressStatus">正在准备下载任务...</div>
        </div>
    `;
}

function updateProgressUi(api, progress, phase, status) {
    const bodyEl = api.bodyEl;
    const fillEl = bodyEl.querySelector('#projectDownloadProgressFill');
    const valueEl = bodyEl.querySelector('#projectDownloadProgressValue');
    const phaseEl = bodyEl.querySelector('#projectDownloadProgressPhase');
    const statusEl = bodyEl.querySelector('#projectDownloadProgressStatus');
    const normalizedProgress = Math.max(0, Math.min(100, Number(progress) || 0));

    if (fillEl) fillEl.style.width = `${normalizedProgress}%`;
    if (valueEl) valueEl.textContent = `${Math.round(normalizedProgress)}%`;
    if (phaseEl) phaseEl.textContent = phase || '';
    if (statusEl) statusEl.textContent = status || '';
}

async function writeTextByChunks(fileHandle, text, onProgress) {
    const writable = await fileHandle.createWritable();
    const bytes = new TextEncoder().encode(text);
    const chunkSize = 64 * 1024;
    let offset = 0;

    while (offset < bytes.length) {
        const chunk = bytes.slice(offset, offset + chunkSize);
        await writable.write(chunk);
        offset += chunk.length;
        if (typeof onProgress === 'function') {
            const ratio = bytes.length > 0 ? offset / bytes.length : 1;
            onProgress(Math.max(0, Math.min(1, ratio)));
        }
    }

    await writable.close();
}

async function createWriteTarget(fileName, api) {
    if (typeof window.showDirectoryPicker === 'function') {
        updateProgressUi(api, 20, '选择目录', '请选择要保存下载项目的本地目录。');
        const directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
        return {
            targetLabel: `${directoryHandle.name}/${fileName}`,
            async writeText(text, onProgress) {
                await writeTextByChunks(fileHandle, text, onProgress);
            }
        };
    }

    if (typeof window.showSaveFilePicker === 'function') {
        updateProgressUi(api, 20, '选择位置', '当前浏览器不支持目录选择，将打开“另存为”窗口。');
        const fileHandle = await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [{
                description: 'JSON 文件',
                accept: { 'application/json': ['.json'] }
            }]
        });
        return {
            targetLabel: fileName,
            async writeText(text, onProgress) {
                await writeTextByChunks(fileHandle, text, onProgress);
            }
        };
    }

    updateProgressUi(api, 20, '浏览器下载', '当前浏览器不支持目录选择，将使用浏览器默认下载方式。');
    return {
        targetLabel: fileName,
        async writeText(text, onProgress) {
            const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            link.click();
            if (typeof onProgress === 'function') onProgress(1);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        }
    };
}

export async function downloadCloudProjectToLocalFile({
    projectId,
    projectType = 'workflow',
    projectName = '',
    loadProject
} = {}) {
    let dialogApi = null;
    const dialogPromise = showSharedDialog({
        title: '下载项目文件',
        subtitle: '系统会把数据库中的项目内容导出为 JSON 文件，并保存到你选择的本地目录。',
        bodyHtml: createProgressBody(),
        confirmText: '关闭',
        cancelText: '取消',
        showCancel: false,
        onOpen: (api) => {
            dialogApi = api;
            api.confirmBtn.style.display = 'none';
            updateProgressUi(api, 5, '准备中', '正在初始化下载流程...');
        }
    });
    const api = dialogApi;
    if (!api) {
        throw new Error('下载进度窗口初始化失败，请稍后重试。');
    }
    if (typeof loadProject !== 'function') {
        throw new Error('缺少项目下载方法。');
    }
    const fileName = buildProjectFileName(projectName, projectType);

    try {
        updateProgressUi(api, 12, '准备中', `即将下载项目文件：${fileName}`);
        const writeTarget = await createWriteTarget(fileName, api);

        updateProgressUi(api, 48, '读取项目', '正在从数据库读取项目内容...');
        const project = await loadProject(projectId);
        const payload = project?.data && typeof project.data === 'object' ? project.data : {};

        updateProgressUi(api, 72, '生成文件', '正在生成 JSON 文件内容...');
        const text = JSON.stringify(payload, null, 2);

        updateProgressUi(api, 82, '写入本地', '正在将项目文件写入你选择的目录...');
        await writeTarget.writeText(text, (ratio) => {
            updateProgressUi(
                api,
                82 + (Math.max(0, Math.min(1, Number(ratio) || 0)) * 16),
                '写入本地',
                '正在写入项目文件，请稍候...'
            );
        });

        updateProgressUi(api, 100, '下载完成', `项目文件已保存到本地：${writeTarget.targetLabel}`);
        api.setMessage(`下载完成：${writeTarget.targetLabel}`, 'success');
        api.confirmBtn.style.display = '';
        await new Promise(resolve => setTimeout(resolve, 900));
        api.close({
            ok: true,
            targetLabel: writeTarget.targetLabel,
            fileName,
            project
        });
    } catch (error) {
        if (isAbortError(error)) {
            updateProgressUi(api, 0, '已取消', '你已取消本地目录或文件位置的选择，下载未执行。');
            api.setMessage('下载已取消。', 'error');
            api.confirmBtn.style.display = '';
            api.close({ ok: false, cancelled: true });
        } else {
            updateProgressUi(api, 0, '下载失败', error?.message || '下载项目文件失败，请稍后重试。');
            api.setMessage(error?.message || '下载项目文件失败，请稍后重试。', 'error');
            api.confirmBtn.style.display = '';
            api.confirmBtn.textContent = '关闭';
        }
    }

    return dialogPromise;
}
