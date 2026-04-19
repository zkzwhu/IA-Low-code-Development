let dialogState = null;

function ensureDialog() {
    if (dialogState) return dialogState;

    const mask = document.createElement('div');
    mask.className = 'shared-dialog-mask';
    mask.innerHTML = `
        <div class="shared-dialog" role="dialog" aria-modal="true" aria-labelledby="sharedDialogTitle">
            <div class="shared-dialog-header">
                <div>
                    <div class="shared-dialog-title" id="sharedDialogTitle">提示</div>
                    <div class="shared-dialog-subtitle" id="sharedDialogSubtitle" style="display:none;"></div>
                </div>
                <button type="button" class="shared-dialog-close" id="sharedDialogCloseBtn" aria-label="关闭">×</button>
            </div>
            <div class="shared-dialog-body">
                <div class="shared-dialog-message" id="sharedDialogMessage"></div>
                <div id="sharedDialogBody"></div>
            </div>
            <div class="shared-dialog-actions">
                <button type="button" class="shared-dialog-btn" id="sharedDialogCancelBtn">取消</button>
                <button type="button" class="shared-dialog-btn primary" id="sharedDialogConfirmBtn">确定</button>
            </div>
        </div>
    `;
    document.body.appendChild(mask);

    dialogState = {
        mask,
        titleEl: mask.querySelector('#sharedDialogTitle'),
        subtitleEl: mask.querySelector('#sharedDialogSubtitle'),
        messageEl: mask.querySelector('#sharedDialogMessage'),
        bodyEl: mask.querySelector('#sharedDialogBody'),
        closeBtn: mask.querySelector('#sharedDialogCloseBtn'),
        cancelBtn: mask.querySelector('#sharedDialogCancelBtn'),
        confirmBtn: mask.querySelector('#sharedDialogConfirmBtn'),
        cleanup: null,
        resolve: null
    };

    return dialogState;
}

function setDialogMessage(text = '', tone = 'error') {
    const refs = ensureDialog();
    const nextText = String(text || '').trim();
    refs.messageEl.className = 'shared-dialog-message';
    refs.messageEl.textContent = '';
    if (!nextText) return;
    refs.messageEl.classList.add(tone === 'success' ? 'success' : 'error');
    refs.messageEl.textContent = nextText;
}

function closeDialog(value = null) {
    const refs = ensureDialog();
    refs.mask.style.display = 'none';
    refs.bodyEl.innerHTML = '';
    setDialogMessage('');
    refs.confirmBtn.disabled = false;
    refs.cancelBtn.disabled = false;
    refs.closeBtn.disabled = false;

    if (typeof refs.cleanup === 'function') {
        refs.cleanup();
    }
    refs.cleanup = null;

    const resolve = refs.resolve;
    refs.resolve = null;
    if (resolve) resolve(value);
}

export function showSharedDialog({
    title = '提示',
    subtitle = '',
    bodyHtml = '',
    confirmText = '确定',
    cancelText = '取消',
    showCancel = true,
    onConfirm = null,
    onOpen = null
} = {}) {
    const refs = ensureDialog();
    refs.titleEl.textContent = title;
    refs.subtitleEl.textContent = subtitle || '';
    refs.subtitleEl.style.display = subtitle ? '' : 'none';
    refs.bodyEl.innerHTML = bodyHtml || '';
    refs.confirmBtn.textContent = confirmText;
    refs.cancelBtn.textContent = cancelText;
    refs.cancelBtn.style.display = showCancel ? '' : 'none';
    setDialogMessage('');

    return new Promise((resolve) => {
        refs.resolve = resolve;

        const setPending = (pending) => {
            const nextPending = Boolean(pending);
            refs.confirmBtn.disabled = nextPending;
            refs.cancelBtn.disabled = nextPending;
            refs.closeBtn.disabled = nextPending;
        };

        const api = {
            bodyEl: refs.bodyEl,
            close: closeDialog,
            setMessage: setDialogMessage,
            clearMessage: () => setDialogMessage(''),
            setPending,
            confirmBtn: refs.confirmBtn,
            cancelBtn: refs.cancelBtn,
            titleEl: refs.titleEl,
            subtitleEl: refs.subtitleEl
        };

        const handleCancel = () => closeDialog(null);
        const handleMaskClick = (event) => {
            if (event.target === refs.mask) handleCancel();
        };
        const handleConfirm = async () => {
            setDialogMessage('');
            if (!onConfirm) {
                closeDialog(true);
                return;
            }

            try {
                setPending(true);
                const result = await onConfirm(api);
                if (result !== false) {
                    closeDialog(result ?? true);
                    return;
                }
            } catch (error) {
                setDialogMessage(error?.message || '操作失败，请稍后重试。', 'error');
            } finally {
                setPending(false);
            }
        };

        refs.closeBtn.onclick = handleCancel;
        refs.cancelBtn.onclick = handleCancel;
        refs.confirmBtn.onclick = handleConfirm;
        refs.mask.onclick = handleMaskClick;
        refs.cleanup = () => {
            refs.closeBtn.onclick = null;
            refs.cancelBtn.onclick = null;
            refs.confirmBtn.onclick = null;
            refs.mask.onclick = null;
        };

        refs.mask.style.display = 'flex';

        if (typeof onOpen === 'function') {
            onOpen(api);
        }
    });
}

export function closeSharedDialog(value = null) {
    closeDialog(value);
}
