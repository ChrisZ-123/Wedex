(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const gateKeys = ['persona', 'continuous', 'imageReceive', 'imageSend'];
  const stateLabels = {
    starting: '正在启动', login_required: '需要登录', ready: '已登录',
    unbound: '未绑定', waiting_scan: '等待扫码', need_verifycode: '需要验证码',
    connected: '已连接', reconnecting: '重新连接中', expired: '登录已过期',
    error: '发生错误', running: '运行中', thinking: '思考中', queued: '排队中', pending: '等待处理', processed: '已处理', reset: '上下文已重置',
    completed: '已完成', complete: '已完成', done: '已完成', stopped: '已停止',
    cancelled: '已取消', failed: '失败', sent: '发送接口已确认',
    preparing: '准备中', paused: '已暂停', waiting_login: '等待登录', api_acknowledged: '发送接口已确认', interrupted: '已中断', image_starting: '启动图片任务', image_generating: '正在生成图片', image_completed: '图片已生成', sending_image: '正在发送图片', generating: '正在生成', idle: '当前空闲', sending: '正在发送', uncertain: '结果待核实', unknown: '送达状态未知', received: '收到消息', accepted: '已接受', downloaded: '已下载',
  };
  let token = '';
  let status = null;
  let polling = false;
  let statusRequest = null;
  let loadedStatusRevision = -1;
  let featureRequest = null;
  let loadedFeatureRevision = -1;
  let mutationPending = false;
  let settingsDirty = false;
  let gateDirty = false;
  let settingsRevision = 0;
  let gateRevision = 0;
  let noticeSource = '';
  let statusRevision = 0;
  let modelSignature = '';
  let historySignature = '';
  let models = [];
  const runCards = new Map();
  let features = null;
  let featuresLoading = false;
  let featureSignature = '';
  let memoryEdit = null;
  let roleEdit = null;
  let roleAction = 'create';
  let stickerEdit = null;
  let memoryDraftRevision = 0;
  let roleDraftRevision = 0;
  let stickerDraftRevision = 0;
  let historyOffset = 0;
  let historyQuery = '';
  let historyTotal = 0;
  let historyLoading = false;
  let historyRequest = 0;
  let backupPreview = null;
  let backupFileRevision = 0;
  const previewImages = new Map();

  function initializeToken() {
    const fragment = new URLSearchParams(location.hash.slice(1));
    const supplied = fragment.get('token');
    // Strip the complete fragment before requests, UI updates, or storage access.
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    try {
      if (supplied) sessionStorage.setItem('wechat-codex-token', supplied);
      token = supplied || sessionStorage.getItem('wechat-codex-token') || '';
    } catch {
      token = supplied || '';
    }
    if (!token) {
      showNotice('此页面尚未获得本地访问权限。请通过本地启动器重新打开控制台。', true);
      setBadge($('connection-state'), '请从启动器打开', 'failure');
      $('last-update').textContent = '请重新通过启动器打开';
    }
    updateButtons();
  }

  function showNotice(message, error = false, source = 'action') {
    const notice = $('notice');
    notice.textContent = String(message);
    notice.classList.toggle('failure', error);
    notice.hidden = false;
    noticeSource = source;
    const dialog = document.querySelector('dialog[open]');
    if (dialog) {
      let inline = dialog.querySelector('.action-notice');
      if (!inline) { inline = node('p','action-notice'); inline.setAttribute('role','status'); dialog.querySelector('form').append(inline); }
      inline.textContent = String(message); inline.classList.toggle('error',error);
    }
  }

  function setBadge(node, label, type = '') {
    node.textContent = label;
    node.className = ['badge', type].filter(Boolean).join(' ');
  }

  function label(value) {
    return stateLabels[value] || String(value || '未知');
  }

  function errorText(error) {
    // Never expose request headers, tokens, auth URLs, or raw transport diagnostics.
    const raw = error instanceof Error ? error.message : String(error || '请求失败');
    const safe = token ? raw.split(token).join('[已隐藏]') : raw;
    return safe.replace(/https?:\/\/[^\s]+/g, '[地址已隐藏]').slice(0, 500);
  }

  async function api(path, body) {
    if (!token) throw new Error('此页面尚未获得本地访问权限，请通过本地启动器重新打开控制台。');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const options = { headers, cache: 'no-store', credentials: 'same-origin', signal: controller.signal };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        options.method = 'POST';
        options.body = JSON.stringify(body);
      }
      let response;
      try { response = await fetch(path, options); }
      catch { throw new Error('本地服务暂时无法连接，或请求超时。请检查启动器；操作结果请刷新状态核对，避免重复提交。'); }
      let data;
      try { data = await response.json(); }
      catch { throw new Error('本地服务未返回有效 JSON，请检查服务运行状态。'); }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('当前页面的访问权限已失效，请通过本地启动器重新打开控制台。');
        }
        throw new Error(typeof data.error === 'string' ? data.error : `请求失败（HTTP ${response.status}）`);
      }
      return data;
    } finally { clearTimeout(timeout); }
  }

  function updateButtons() {
    document.querySelectorAll('[data-mutation]').forEach((button) => {
      button.disabled = !token || mutationPending;
    });
    $('refresh-status').disabled = !token || polling;
    $('stop-chat').disabled = !token || mutationPending || !(status?.chat?.running || status?.images?.inFlight || status?.images?.uncertain);
    $('confirm-reset').disabled = !token || mutationPending || Boolean(status?.chat?.running);
    const image = latestReceivedImage(status?.history);
    $('echo-image').disabled = !token || mutationPending || !image || image.status === 'error' || Boolean(status?.chat?.running) || Boolean(status?.chat?.paused) || status?.wechat?.state !== 'connected' || status?.codex?.state !== 'ready';
    const allChecked = gateKeys.every((key) => $('gate-form').elements[key].checked);
    $('confirm-gate').disabled = !token || mutationPending || !allChecked;
    const validModel = models.find((entry) => modelId(entry) === $('model').value);
    $('settings-form').querySelector('button').disabled = !token || mutationPending || !validModel || !$('effort').value;
    runCards.forEach((card) => {
      card.received.disabled = !token || mutationPending || !card.canConfirm;
      card.missing.disabled = !token || mutationPending || !card.canConfirm;
      card.feedbackButtons.forEach((button) => { button.disabled = !token || mutationPending || !features || !card.feedbackEligible; });
    });
    updateFeatureButtons();
  }

  async function mutate(path, body, success, onSuccess) {
    if (mutationPending || !token) return null;
    mutationPending = true;
    updateButtons();
    try {
      const result = await api(path, body);
      statusRevision += 1;
      if (onSuccess) onSuccess(result);
      showNotice(success);
      await refreshStatus();
      if (/^\/api\/(memory|feedback|role|stickers\/|backup\/restore)/.test(path)) await refreshFeatures();
      return result;
    } catch (error) {
      showNotice(errorText(error), true);
      return null;
    } finally {
      mutationPending = false;
      updateButtons();
    }
  }

  async function refreshStatus() {
    if (!token) return;
    if (polling) {
      await statusRequest;
      if (loadedStatusRevision !== statusRevision) return refreshStatus();
      return;
    }
    statusRequest = readStatus();
    return statusRequest;
  }

  async function readStatus() {
    polling = true;
    const requestRevision = statusRevision;
    updateButtons();
    try {
      const data = await api('/api/status');
      if (requestRevision !== statusRevision) return;
      status = data;
      loadedStatusRevision = requestRevision;
      renderStatus(data);
      void refreshFeatures();
      setBadge($('connection-state'), '本地服务已连接');
      $('last-update').textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
      if (noticeSource === 'poll') $('notice').hidden = true;
    } catch (error) {
      loadedStatusRevision = requestRevision;
      setBadge($('connection-state'), '连接失败', 'failure');
      $('last-update').textContent = '等待下一次刷新';
      showNotice(errorText(error), true, 'poll');
      $('qr-box').hidden = true;
      $('qr-image').removeAttribute('src');
    } finally {
      polling = false;
      updateButtons();
    }
  }

  function renderError(node, value) {
    node.textContent = value ? errorText(value) : '';
    node.hidden = !value;
  }

  function renderStatus(data) {
    const codex = data.codex || {};
    const wechat = data.wechat || {};
    const chat = data.chat || {};
    const gate = data.gate || {};
    $('stage').textContent = data.stage === 'chat' ? '完整聊天 · 已开放' : data.stage === 'acceptance' ? '第一阶段 · 私聊验收' : String(data.stage || '等待阶段信息');
    $('gate-state').textContent = gate.confirmed ? '手机收发已确认' : data.stage === 'chat' ? '完整功能已开放 · 手机核对可选' : '尚未通过 · 完整功能待开放';
    setBadge($('gate-badge'), gate.confirmed ? '已确认' : '待手机确认', gate.confirmed ? '' : 'pending');
    $('chat-state').textContent = `${chat.paused ? '已暂停' : '可接收消息'} · ${chat.running ? '正在运行' : '当前空闲'} · 排队 ${Number(chat.pending) || 0}`;
    $('pause-chat').textContent = chat.paused ? '恢复回复' : '暂停回复';
    setBadge($('overview-codex'), 'Codex · ' + label(codex.state), codex.state === 'ready' ? '' : 'pending');
    setBadge($('overview-wechat'), '微信 · ' + label(wechat.state), wechat.state === 'connected' ? '' : 'pending');
    if (codex.state !== 'ready' || wechat.state !== 'connected') $('account-disclosure').open = true;
    setBadge($('codex-state'), label(codex.state), codex.state === 'ready' ? '' : codex.state === 'error' ? 'failure' : 'pending');
    setBadge($('wechat-state'), label(wechat.state), wechat.state === 'connected' ? '' : wechat.state === 'error' ? 'failure' : 'pending');
    $('codex-account').textContent = codex.account ? [codex.account.type, codex.account.planType].filter(Boolean).join(' · ') || '账号已登录' : '等待账号登录';
    $('codex-login-note').textContent = codex.state === 'ready' ? '官方账号已登录。可刷新账号，查看当前模型与额度。' : '使用已有 ChatGPT / Codex 账号，在官方页面完成登录。';
    $('wechat-note').textContent = wechat.login?.note ? String(wechat.login.note) : wechat.state === 'connected' ? '已连接，可在手机私聊' : '登录后扫码绑定私聊账号';
    renderError($('codex-error'), codex.error);
    renderError($('wechat-error'), wechat.error);
    const qr = wechat.login?.qrDataUrl;
    const validQr = typeof qr === 'string' && /^data:image\/(png|jpeg|jpg|gif|webp);base64,[a-zA-Z0-9+/=\r\n]+$/.test(qr);
    // This image comes only from a successfully authenticated status request.
    $('qr-box').hidden = !validQr || wechat.state === 'connected' || wechat.state === 'expired';
    if (!$('qr-box').hidden) {
      if ($('qr-image').getAttribute('src') !== qr) $('qr-image').src = qr;
      $('qr-note').textContent = String(wechat.login?.note || '请使用本人微信扫码，并按官方提示完成绑定。');
    } else $('qr-image').removeAttribute('src');
    $('verify-form').hidden = wechat.login?.state !== 'need_verifycode';
    setAuthLink(codex.state === 'ready' ? null : codex.login?.authUrl);
    renderModels(codex.models, data.settings || {});
    $('rate-limits').textContent = codex.rateLimits == null ? '运行时暂无额度数据' : JSON.stringify(codex.rateLimits, null, 2);
    if (!gateDirty) gateKeys.forEach((key) => { $('gate-form').elements[key].checked = Boolean(gate.checks?.[key]); });
    renderHistory(Array.isArray(data.history) ? data.history : []);
    renderRuns(Array.isArray(data.runs) ? data.runs : []);
    renderMedia(data);
  }

  function latestReceivedImage(historyEntries) {
    if (!Array.isArray(historyEntries)) return null;
    for (let index = historyEntries.length - 1; index >= 0; index -= 1) {
      if (historyEntries[index].kind !== 'user') continue;
      const images = historyEntries[index].images;
      if (!Array.isArray(images)) continue;
      for (let imageIndex = images.length - 1; imageIndex >= 0; imageIndex -= 1) {
        const image = images[imageIndex];
        if (typeof image?.id === 'string' && image.id) return image;
      }
    }
    return null;
  }

  function renderMedia(data) {
    const count = (value) => Number.isInteger(value) && value >= 0 ? value : 0;
    $('image-receive-count').textContent = String(count(data.mediaEvidence?.imageReceive));
    $('image-send-count').textContent = String(count(data.mediaEvidence?.imageSend));
    const native = data.images || {};
    $('native-image-status').textContent = data.capabilities?.nativeImages ? '原生图片：' + label(native.status) + (native.uncertain ? ' · 结果待核实' : '') + (native.error ? ' · ' + errorText(native.error) : '') : '原生图片能力尚未开放。';
    const image = latestReceivedImage(data.history);
    $('image-echo-note').textContent = !image ? '等待手机上传图片。' : image.status === 'error' ? '最近收到的图片处理失败，请在手机重新上传图片。' : data.chat?.running ? '当前正在运行，请完成或停止后回传。' : data.chat?.paused ? '当前已暂停，请恢复回复后回传。' : data.wechat?.state !== 'connected' || data.codex?.state !== 'ready' ? '图片已收到，请先完成微信和 Codex 登录。' : '已有图片可回传。接口结果需结合手机实际显示核对。';
  }

  function officialAuthUrl(value) {
    if (typeof value !== 'string') return null;
    try {
      const parsed = new URL(value);
      const trusted = parsed.hostname === 'openai.com' || parsed.hostname.endsWith('.openai.com');
      return parsed.protocol === 'https:' && trusted && !parsed.username && !parsed.password && !parsed.port ? parsed.href : null;
    } catch { return null; }
  }

  function setAuthLink(value) {
    const link = $('auth-link');
    const url = officialAuthUrl(value);
    link.hidden = !url;
    if (url) link.href = url;
    else link.removeAttribute('href');
  }

  function modelId(model) { return String(model.model || model.id || ''); }
  function optionId(entry, names) {
    if (typeof entry === 'string') return entry;
    for (const name of names) if (entry?.[name] != null) return String(entry[name]);
    return '';
  }
  function populateSelect(select, choices, preferred, placeholder) {
    const seen = new Set();
    const fragment = document.createDocumentFragment();
    for (const choice of choices) {
      if (seen.has(choice.value)) continue;
      seen.add(choice.value);
      const option = document.createElement('option');
      option.value = choice.value;
      option.textContent = choice.label;
      fragment.append(option);
    }
    select.replaceChildren(fragment);
    if (!choices.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = placeholder;
      select.append(option);
      select.disabled = true;
    } else {
      select.disabled = false;
      const desired = preferred == null ? '' : String(preferred);
      if (seen.has(desired)) select.value = desired;
    }
  }

  function renderModels(rawModels, saved) {
    const list = Array.isArray(rawModels) ? rawModels : Array.isArray(rawModels?.data) ? rawModels.data : [];
    const signature = JSON.stringify(list);
    const changed = signature !== modelSignature;
    if (changed) {
      modelSignature = signature;
      models = list.filter((model) => model && !model.hidden && modelId(model));
    }
    if (!settingsDirty || changed) {
      const preferredModel = settingsDirty ? $('model').value : saved.model;
      populateSelect($('model'), models.map((model) => ({ value: modelId(model), label: String(model.displayName || model.name || modelId(model)) })), preferredModel, '登录后获取可用模型');
      populateModelControls(settingsDirty ? { reasoningEffort: $('effort').value, serviceTier: $('service-tier').value } : saved);
    }
    if (!settingsDirty) {
      $('persona').value = String(saved.persona || '');
      $('image-mode').value = ['off', 'requested', 'auto'].includes(saved.imageMode) ? saved.imageMode : 'requested';
      $('settings-state').textContent = '已保存配置';
    }
  }

  function populateModelControls(preferred = {}) {
    const model = models.find((entry) => modelId(entry) === $('model').value);
    if (!model) {
      populateSelect($('effort'), [], null, '等待模型信息');
      populateSelect($('service-tier'), [], null, '等待模型信息');
      $('model-note').textContent = '登录并刷新账号后，读取当前运行时支持的模型与档位。';
      return;
    }
    const efforts = model.supportedReasoningEfforts || model.reasoningEfforts || [];
    const effortChoices = efforts.map((entry) => {
      const value = optionId(entry, ['reasoningEffort', 'effort', 'id', 'value']);
      return { value, label: typeof entry === 'object' ? String(entry.displayName || entry.label || value) : value };
    }).filter((entry) => entry.value);
    populateSelect($('effort'), effortChoices, preferred.reasoningEffort ?? model.defaultReasoningEffort, '运行时未提供推理选项');
    const defaultTier = model.defaultServiceTier == null ? '' : optionId(model.defaultServiceTier, ['serviceTier', 'id', 'value', 'name']);
    const tiers = [...(Array.isArray(model.serviceTiers) ? model.serviceTiers : []), ...(Array.isArray(model.additionalSpeedTiers) ? model.additionalSpeedTiers : [])];
    const tierChoices = [{ value: defaultTier, label: defaultTier ? `${defaultTier}（默认）` : '默认' }];
    tiers.forEach((entry) => {
      const value = optionId(entry, ['serviceTier', 'id', 'value', 'name']);
      if (value === defaultTier) return;
      tierChoices.push({ value, label: typeof entry === 'object' ? String(entry.displayName || entry.label || value || '默认') : value });
    });
    populateSelect($('service-tier'), tierChoices, preferred.serviceTier ?? defaultTier, '等待服务档位');
    $('model-note').textContent = String(model.description || '可用选项来自当前 Codex 运行时。');
  }

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }

  function timeText(value) {
    if (value == null) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
  }

  function deliveryStatus(delivery, fallback) {
    if (Array.isArray(delivery) && delivery.length) {
      const acknowledged = delivery.filter((segment) => segment?.acknowledged === true).length;
      return { value: acknowledged === delivery.length ? 'sent' : 'unknown', text: `${acknowledged}/${delivery.length} 段接口已确认`, type: acknowledged === delivery.length ? '' : 'pending' };
    }
    const raw = typeof delivery === 'string' ? delivery : delivery?.status || delivery?.state || (delivery?.acknowledged === true ? 'sent' : fallback);
    const value = raw || 'unknown';
    return { value, text: label(value), type: value === 'sent' ? '' : ['error', 'failed'].includes(value) ? 'failure' : 'pending' };
  }

  function renderDeliverySegments(container, delivery) {
    const segments = Array.isArray(delivery) ? delivery : [];
    container.hidden = !segments.length;
    const fragment = document.createDocumentFragment();
    segments.forEach((segment, index) => {
      const entry = node('section', 'delivery-segment');
      const head = node('div', 'entry-head');
      const badge = node('span');
      const acknowledged = segment?.acknowledged === true;
      setBadge(badge, acknowledged ? '接口已确认' : '接口未确认', acknowledged ? '' : 'pending');
      const kind = segment?.kind === 'sticker' ? '表情图片' : segment?.kind === 'generated_image' ? '生成图片' : segment?.kind === 'image_echo' ? '图片回传' : '发送内容';
      head.append(node('span', 'entry-title', `第 ${index + 1} 项 · ${kind}`), badge);
      entry.append(head);
      // Only these public identifiers and the sent text belong in delivery evidence.
      // Never serialize the segment object: it may contain transport-only fields.
      const ids = [];
      if (typeof segment?.clientId === 'string' || typeof segment?.clientId === 'number') ids.push(`客户端 ID ${segment.clientId}`);
      if (typeof segment?.messageId === 'string' || typeof segment?.messageId === 'number') ids.push(`消息 ID ${segment.messageId}`);
      if (ids.length) entry.append(node('p', 'entry-meta', ids.join(' · ')));
      if (typeof segment?.text === 'string') entry.append(node('pre', 'message-text', segment.text));
      else entry.append(node('p', 'entry-meta', '此项发送媒体，无文本分段。'));
      if (typeof segment?.stickerId === 'string') entry.append(node('p', 'entry-meta', '表情编号 ' + segment.stickerId));
      fragment.append(entry);
    });
    container.replaceChildren(fragment);
  }

  function renderHistory(entries) {
    $('history-count').textContent = `${entries.length} 条`;
    const signature = JSON.stringify(entries);
    if (signature === historySignature) return;
    historySignature = signature;
    const fragment = document.createDocumentFragment();
    if (!entries.length) fragment.append(node('p', 'empty', '暂无消息。绑定微信后，在手机私聊发送一条测试消息。'));
    [...entries].reverse().forEach((entry) => {
      const card = node('article', 'entry');
      const head = node('div', 'entry-head');
      const kindLabels = { user: '微信来信', incoming: '微信来信', assistant: '助手回复', outgoing: '助手回复', image: '图片消息', system: '系统记录', error: '错误记录' };
      head.append(node('span', 'entry-title', kindLabels[entry.kind] || entry.kind || '消息'));
      if (entry.status || entry.delivery) {
        const badge = node('span');
        const delivery = deliveryStatus(entry.delivery, entry.status);
        setBadge(badge, delivery.text, delivery.type);
        head.append(badge);
      }
      card.append(head, node('p', 'message-text', entry.text || '（无文本内容）'));
      if (Array.isArray(entry.images) && entry.images.length) {
        const imageLabels = entry.images.map((image, index) => `图片 ${index + 1} · ${label(image.status)}${image.mime ? ` · ${String(image.mime)}` : ''}`);
        card.append(node('p', 'entry-meta', imageLabels.join('；')));
      }
      const meta = [timeText(entry.time), entry.runId ? `运行 ${entry.runId}` : '', Array.isArray(entry.sourceMessageIds) && entry.sourceMessageIds.length ? `来源 ${entry.sourceMessageIds.join('、')}` : ''].filter(Boolean).join(' · ');
      if (meta) card.append(node('p', 'entry-meta', meta));
      if (entry.error) card.append(node('p', 'error', errorText(entry.error)));
      fragment.append(card);
    });
    $('history-list').replaceChildren(fragment);
  }

  function buildRunCard(id) {
    const root = node('article', 'entry');
    const head = node('div', 'entry-head');
    const title = node('span', 'entry-title', `运行 ${id}`);
    const badge = node('span');
    const meta = node('p', 'entry-meta');
    const timing = node('p', 'entry-meta');
    const raw = node('pre', 'raw-reply');
    const deliveryBadge = node('span');
    const deliverySegments = node('div', 'delivery-segments');
    const error = node('p', 'error');
    const receipt = node('div', 'receipt');
    const receiptState = node('p', 'receipt-state');
    const noteLabel = node('label', '', '手机验收备注');
    const note = node('input');
    note.type = 'text';
    note.placeholder = '例如：已收到，文字与原始回复一致';
    note.maxLength = 1000;
    // Use a label wrapper rather than external record IDs in DOM attributes.
    noteLabel.append(note);
    const buttons = node('div', 'button-row');
    const received = node('button', 'secondary', '手机完整收到原文');
    const missing = node('button', 'quiet', '未收到 / 内容不一致');
    received.type = missing.type = 'button';
    received.addEventListener('click', () => mutate('/api/acceptance', { runId: id, received: true, note: note.value }, '已记录手机验收确认。'));
    missing.addEventListener('click', () => mutate('/api/acceptance', { runId: id, received: false, note: note.value }, '已记录：手机未收到或内容不一致。'));
    buttons.append(received, missing);
    receipt.append(receiptState, noteLabel, buttons);
    head.append(title, badge);
    const rawLabel = node('p', 'raw-label', 'Codex 原始最终回复');
    const generated = node('div', 'generated-previews');
    const feedback = node('div', 'feedback');
    const feedbackLabel = node('label', '', '表达反馈备注（可选）');
    const feedbackNote = node('input');
    feedbackNote.type = 'text'; feedbackNote.maxLength = 500; feedbackNote.placeholder = '例如：回答可以再短一点';
    feedbackLabel.append(feedbackNote);
    const feedbackRow = node('div', 'button-row');
    const feedbackButtons = [];
    [['good', '合适'], ['long', '太长'], ['redundant', '多余']].forEach(([rating, text]) => {
      const button = actionButton(text, () => mutate('/api/feedback', {action:'add',revision:features.revision,runId:id,rating,note:feedbackNote.value}, '表达反馈已记录，可撤销。'));
      feedbackButtons.push(button); feedbackRow.append(button);
    });
    const feedbackRecords = node('div', 'feedback-records');
    feedback.append(node('p', 'raw-label', '表达反馈'), feedbackLabel, feedbackRow, feedbackRecords);
    root.append(head, meta, timing, rawLabel, raw, generated, node('p', 'raw-label', '发送接口结果'), deliveryBadge, deliverySegments, node('p', 'delivery-note', '发送接口确认仅表示服务端接收；手机收到且内容未改动需由你确认。'), error, receipt, feedback);
    const card = { rawLabel, generated, feedback, feedbackNote, feedbackRecords, feedbackButtons, root, badge, meta, timing, raw, deliveryBadge, deliverySegments, error, receiptState, note, received, missing, hasReply: false, canConfirm: false, feedbackEligible: false };
    runCards.set(id, card);
    return card;
  }

  function duration(value) {
    return typeof value === 'number' && Number.isFinite(value) ? `${value} ms` : '—';
  }

  function renderRuns(entries) {
    const visibleImages = new Set(entries.flatMap(entry => Array.isArray(entry.generatedImages) ? entry.generatedImages.map(image => 'generated:' + image.id) : []));
    for (const [key,value] of previewImages) if (key.startsWith('generated:') && !visibleImages.has(key)) { previewImages.delete(key); value.promise.then(url => URL.revokeObjectURL(url)).catch(() => {}); }
    $('run-count').textContent = `${entries.length} 次`;
    const ids = new Set(entries.map((entry) => String(entry.id)));
    runCards.forEach((card, id) => { if (!ids.has(id)) { card.root.remove(); runCards.delete(id); } });
    if (!entries.length) {
      $('run-list').replaceChildren(node('p', 'empty', '暂无运行。生成回复后，可逐条确认手机是否完整收到原文。'));
      return;
    }
    $('run-list').querySelectorAll('.empty').forEach((empty) => empty.remove());
    [...entries].reverse().forEach((entry, index) => {
      const id = String(entry.id);
      const isNew = !runCards.has(id);
      const card = runCards.get(id) || buildRunCard(id);
      if (isNew && typeof entry.phoneNote === 'string') card.note.value = entry.phoneNote;
      setBadge(card.badge, label(entry.status), ['error', 'failed'].includes(entry.status) ? 'failure' : ['completed','interrupted','stopped','cancelled'].includes(entry.status) ? 'muted' : 'pending');
      const isEcho = entry.kind === 'image_echo';
      card.meta.textContent = isEcho ? '图片传输回传 · 无模型调用' : [entry.model, entry.reasoningEffort, entry.serviceTier || '默认档位'].filter(Boolean).join(' · ');
      card.timing.textContent = isEcho ? `发送 ${duration(entry.sendMs)}` : `排队 ${duration(entry.queueMs)} · 模型 ${duration(entry.modelMs)}${typeof entry.imageMs === 'number' ? ` · 生图 ${duration(entry.imageMs)}` : ''} · 发送 ${duration(entry.sendMs)}`;
      card.hasReply = typeof entry.reply === 'string' && entry.reply.length > 0;
      card.rawLabel.textContent = isEcho ? '图片传输说明' : 'Codex 原始最终回复';
      card.raw.textContent = isEcho ? '回传本人提供的图片，用于核对媒体通道。' : card.hasReply ? entry.reply : '尚无原始最终回复';
      card.canConfirm = entry.status === 'completed' && (isEcho || card.hasReply);
      card.feedbackEligible = !isEcho && entry.status === 'completed' && card.hasReply;
      card.feedback.hidden = !card.feedbackEligible;
      card.received.textContent = isEcho ? '手机完整收到图片' : Array.isArray(entry.generatedImages) && entry.generatedImages.length ? '手机完整收到原文和图片' : '手机完整收到原文';
      renderGeneratedImages(card.generated, entry.generatedImages);
      renderRunFeedback(id, card);
      const delivery = deliveryStatus(entry.delivery);
      setBadge(card.deliveryBadge, delivery.text, delivery.type);
      renderDeliverySegments(card.deliverySegments, isEcho && Array.isArray(entry.delivery) ? entry.delivery.map(segment => ({...segment, kind:'image_echo'})) : entry.delivery);
      renderError(card.error, entry.error);
      const confirmation = entry.phoneConfirmed;
      const confirmedValue = typeof confirmation === 'object' && confirmation !== null ? confirmation.received : confirmation;
      card.receiptState.textContent = confirmedValue === true ? isEcho ? '手机验收：已确认完整收到图片' : '手机验收：已确认完整收到回复' : confirmedValue === false ? '手机验收：未收到 / 内容不一致' : '手机验收：待你核对';
      card.receiptState.style.color = confirmedValue === true ? 'var(--accent)' : 'var(--pending)';
      const current = $('run-list').children[index];
      if (current !== card.root) $('run-list').insertBefore(card.root, current || null);
    });
  }


  function actionButton(text, action, type = 'secondary') {
    const button = node('button', type, text);
    button.type = 'button'; button.setAttribute('data-mutation', '');
    button.addEventListener('click', action); return button;
  }
  function featureAvailable() { return Boolean(token && features && status?.stage === 'chat'); }
  function updateFeatureButtons() {
    const disabled = !featureAvailable() || mutationPending;
    ['memory-add','role-add','role-import','sticker-add','backup-export','backup-preview'].forEach(id => { $(id).disabled = disabled; });
    document.querySelectorAll('[data-feature-control]').forEach(control => { control.disabled = disabled; });
    ['memory-form','role-form','sticker-form'].forEach(id => { $(id).querySelector('button[type="submit"]').disabled = disabled; });
    ['memory-list','role-list','sticker-list'].forEach(id => { $(id).querySelectorAll('button').forEach(button => { button.disabled = disabled; }); });
    $('history-prev').disabled = !token || historyLoading || historyOffset <= 0;
    $('history-next').disabled = !token || historyLoading || historyOffset + 100 >= historyTotal;
    const expired = !backupPreview || Date.now() >= backupPreview.expiresAt;
    const busy = status?.chat?.running || status?.images?.inFlight || status?.images?.uncertain;
    $('backup-restore').disabled = disabled || expired || !status?.chat?.paused || Boolean(busy);
    $('backup-restore-note').textContent = expired ? '请读取备份并重新预览差异。' : !status?.chat?.paused ? '恢复前请在左侧暂停回复。' : busy ? status?.images?.uncertain ? '图片任务结果尚待核实，恢复暂不可用。' : '请等待当前回复和图片任务结束。' : '当前已暂停且无任务运行，可确认恢复。';
    if (backupPreview) $('backup-expiry').textContent = '此预览有效至 ' + timeText(backupPreview.expiresAt) + (expired ? '（已过期）' : '；数据变动后需要重新预览。');
  }
  async function refreshFeatures() {
    if (!token) return;
    if (featuresLoading) {
      await featureRequest;
      if (loadedFeatureRevision !== statusRevision) return refreshFeatures();
      return;
    }
    featureRequest = readFeatures();
    return featureRequest;
  }
  async function readFeatures() {
    if (status?.stage !== 'chat') {
      features = null; $('feature-status').textContent = '完整功能需通过手机收发核对（可选）。';
      updateButtons(); return;
    }
    featuresLoading = true;
    const requestRevision = statusRevision;
    try {
      const result = await api('/api/features');
      if (requestRevision !== statusRevision) return;
      features = result;
      loadedFeatureRevision = requestRevision;
      $('feature-status').textContent = '完整功能已开放 · 记忆、角色和表情修改按版本保存';
      const signature = JSON.stringify(result);
      if (signature !== featureSignature) { featureSignature = signature; renderFeatures(result); }
    } catch (error) {
      loadedFeatureRevision = requestRevision;
      $('feature-status').textContent = '完整功能数据尚不可用：' + errorText(error) + '。连接与聊天状态继续独立更新。';
    } finally { featuresLoading = false; updateButtons(); }
  }
  function renderFeatures(data) {
    $('memory-enabled').checked = data.memory?.enabled === true;
    $('stickers-enabled').checked = data.stickersEnabled === true;
    renderMemories(Array.isArray(data.memory?.entries) ? data.memory.entries : []);
    renderRoles(Array.isArray(data.roles) ? data.roles : []);
    renderStickers(Array.isArray(data.stickers) ? data.stickers : []);
    runCards.forEach((card, id) => renderRunFeedback(id, card));
  }
  function sourceText(source) {
    const names = {manual:'手动', model:'对话学习', restore:'恢复'};
    return [names[source?.type] || '未注明来源', source?.sourceMessageId ? '来源消息 ' + source.sourceMessageId : '', timeText(source?.at)].filter(Boolean).join(' · ');
  }
  function renderMemories(entries) {
    const fragment = document.createDocumentFragment();
    if (!entries.length) fragment.append(node('p', 'empty', '暂无记忆。你可以手动添加，或在微信对话中明确表达需要记住的内容。'));
    [...entries].sort((a,b) => Number(b.pinned) - Number(a.pinned)).forEach(entry => {
      const card = node('article', 'feature-card');
      const head = node('div', 'entry-head');
      head.append(node('strong', 'entry-title', (entry.pinned ? '置顶 · ' : '') + (entry.enabled ? '启用' : '已关闭') + ' · v' + entry.version));
      const buttons = node('div', 'button-row');
      buttons.append(actionButton('编辑', () => openMemory(entry)), actionButton(entry.pinned ? '取消置顶' : '置顶保护', () => editMemoryFlag(entry, 'pinned', !entry.pinned)), actionButton(entry.enabled ? '关闭条目' : '启用条目', () => editMemoryFlag(entry, 'enabled', !entry.enabled)));
      card.append(head, node('p', 'message-text', entry.text), node('p', 'entry-meta', sourceText(entry.source)), buttons);
      const versions = node('details', 'versions');
      versions.append(node('summary', '', '历史版本（' + (entry.versions?.length || 0) + '）'));
      [...(entry.versions || [])].reverse().forEach(version => {
        const item = node('section', 'version');
        item.append(node('p', 'entry-meta', 'v' + version.version + ' · ' + (version.pinned ? '置顶' : '普通') + ' · ' + (version.enabled ? '启用' : '关闭') + ' · ' + sourceText(version.source)), node('p', 'message-text', version.text));
        if (version.version !== entry.version) item.append(actionButton('将此版本恢复为新版本', () => mutate('/api/memory', {action:'restore',revision:features.memory.revision,id:entry.id,version:entry.version,restoreVersion:version.version}, '记忆已恢复为新版本，旧版本仍保留。')));
        versions.append(item);
      });
      card.append(versions); fragment.append(card);
    });
    $('memory-list').replaceChildren(fragment);
  }
  function editMemoryFlag(entry, key, value) {
    mutate('/api/memory', {action:'edit',revision:features.memory.revision,id:entry.id,version:entry.version,text:entry.text,pinned:entry.pinned,enabled:entry.enabled,[key]:value}, '记忆状态已更新。');
  }
  function openMemory(entry = null) {
    if (!featureAvailable()) return;
    memoryEdit = entry ? {id:entry.id,version:entry.version,revision:features.memory.revision} : {revision:features.memory.revision};
    memoryDraftRevision += 1;
    $('memory-dialog-title').textContent = entry ? '编辑记忆 · v' + entry.version : '添加记忆';
    $('memory-text').value = entry?.text || ''; $('memory-pinned').checked = entry?.pinned === true; $('memory-entry-enabled').checked = entry?.enabled !== false;
    $('memory-edit-note').textContent = '保存会保留修订记录；如版本已变化，请先核对最新内容。';
    $('memory-dialog').querySelectorAll('.action-notice').forEach(note => note.remove());
    $('memory-dialog').showModal(); $('memory-text').focus();
  }
  function renderRoles(entries) {
    populateSelect($('role-select'), [{value:'',label:'使用人格指令'},...entries.map(entry => ({value:entry.id,label:entry.name}))], features.selectedRoleId || '', '使用人格指令');
    const fragment = document.createDocumentFragment();
    if (!entries.length) fragment.append(node('p', 'empty', '暂无角色卡。可创建角色，或导入已有的文本角色卡。'));
    entries.forEach(entry => {
      const card = node('article', 'feature-card'); const details = node('details');
      details.append(node('summary', 'entry-title', entry.name + (features.selectedRoleId === entry.id ? ' · 当前使用' : '') + ' · v' + entry.version), node('p', 'message-text', entry.text));
      card.append(details, node('p', 'entry-meta', timeText(entry.at)), actionButton('编辑角色', () => openRole('edit', entry))); fragment.append(card);
    });
    $('role-list').replaceChildren(fragment);
  }
  function openRole(action, entry = null) {
    if (!featureAvailable()) return;
    roleAction = action; roleEdit = {revision:features.revision,...(entry ? {id:entry.id,version:entry.version} : {})}; roleDraftRevision += 1;
    $('role-dialog-title').textContent = action === 'edit' ? '编辑角色 · v' + entry.version : action === 'import' ? '导入 QQ / 文本角色卡' : '创建角色';
    $('role-file-box').hidden = action !== 'import'; $('role-file').value = '';
    $('role-name').value = entry?.name || ''; $('role-text').value = entry?.text || '';
    $('role-edit-note').textContent = '只保存你审核后的角色文本；保存后在角色页选择使用。';
    $('role-dialog').querySelectorAll('.action-notice').forEach(note => note.remove());
    $('role-dialog').showModal(); $('role-name').focus();
  }

  async function authenticatedImage(path) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(path, {headers:{Authorization:'Bearer ' + token},cache:'no-store',credentials:'same-origin',signal:controller.signal});
      if (!response.ok) throw new Error('图片预览读取失败（HTTP ' + response.status + '）');
      const blob = await response.blob();
      if (!['image/png','image/jpeg','image/webp','image/gif'].includes(blob.type)) throw new Error('图片预览格式不受支持');
      return URL.createObjectURL(blob);
    } finally { clearTimeout(timeout); }
  }
  function previewImage(image, path, key) {
    let cached = previewImages.get(key);
    if (!cached) {
      cached = {url:null,promise:null};
      cached.promise = authenticatedImage(path).then(url => { cached.url = url; return url; }).catch(error => { previewImages.delete(key); throw error; });
      previewImages.set(key, cached);
    }
    if (cached.url) image.src = cached.url;
    else cached.promise.then(url => { if (image.isConnected) image.src = url; }).catch(error => { if (image.isConnected) { image.alt = errorText(error); image.classList.add('preview-failed'); } });
  }
  function pruneStickerPreviews(entries) {
    const valid = new Set(entries.map(entry => 'sticker:' + entry.id + ':' + entry.version));
    for (const [key, value] of previewImages) if (key.startsWith('sticker:') && !valid.has(key)) {
      previewImages.delete(key); value.promise.then(url => URL.revokeObjectURL(url)).catch(() => {});
    }
  }
  function renderStickers(entries) {
    pruneStickerPreviews(entries);
    const fragment = document.createDocumentFragment();
    if (!entries.length) fragment.append(node('p', 'empty', '表情库为空。添加图片并开启表情使用后，助手可按语境发送。'));
    entries.forEach(entry => {
      const card = node('article', 'sticker-card'); const image = node('img', 'sticker-preview'); image.alt = entry.name; image.loading = 'lazy';
      previewImage(image, '/api/stickers/image?id=' + encodeURIComponent(entry.id), 'sticker:' + entry.id + ':' + entry.version);
      const buttons = node('div', 'button-row');
      buttons.append(actionButton('编辑备注', () => openSticker(entry)), actionButton(entry.enabled ? '停用' : '启用', () => mutate('/api/stickers/update', {action:'toggle',revision:features.revision,id:entry.id,version:entry.version,enabled:!entry.enabled}, '表情状态已更新。')));
      card.append(image, node('h3', '', entry.name), node('p', 'message-text', entry.note || '尚无语境备注'), node('p', 'entry-meta', (entry.enabled ? '启用' : '停用') + ' · v' + entry.version + ' · ' + (entry.noteSource === 'model' ? '对话学习备注' : '手动备注') + ' · ' + entry.id), buttons); fragment.append(card);
    });
    $('sticker-list').replaceChildren(fragment);
  }
  function updateStickerSource() {
    const received = $('sticker-source').value === 'received'; $('sticker-file').disabled = received;
    $('sticker-source-note').textContent = received ? latestReceivedImage(status?.history) ? '将使用本人最近发来的图片。提交前请核对来源。' : '尚未收到本人图片，请先在手机私聊上传。' : '图片保存至本机表情库。';
  }
  function openSticker(entry = null) {
    if (!featureAvailable()) return;
    stickerEdit = {revision:features.revision,...(entry ? {id:entry.id,version:entry.version} : {})}; stickerDraftRevision += 1;
    $('sticker-dialog-title').textContent = entry ? '编辑表情 · v' + entry.version : '添加表情图片'; $('sticker-source-box').hidden = Boolean(entry);
    $('sticker-source').value = 'file'; $('sticker-file').value = ''; $('sticker-name').value = entry?.name || ''; $('sticker-note').value = entry?.note || '';
    $('sticker-edit-note').textContent = '手动备注保存后，助手不会覆盖已有备注。'; updateStickerSource(); $('sticker-dialog').querySelectorAll('.action-notice').forEach(note => note.remove()); $('sticker-dialog').showModal(); $('sticker-name').focus();
  }
  function renderRunFeedback(id, card) {
    const entries = (features?.feedback || []).filter(entry => entry.runId === id); const signature = JSON.stringify(entries);
    if (signature === card.feedbackSignature) return; card.feedbackSignature = signature;
    const fragment = document.createDocumentFragment(); const names = {good:'合适',long:'太长',redundant:'多余'};
    entries.forEach(entry => {
      const row = node('div', 'feedback-record'); row.append(node('span', 'small', names[entry.rating] + (entry.active ? '' : ' · 已撤销') + (entry.note ? ' · ' + entry.note : '')));
      if (entry.active) row.append(actionButton('撤销', () => mutate('/api/feedback', {action:'undo',revision:features.revision,id:entry.id}, '表达反馈已撤销。'), 'quiet')); fragment.append(row);
    });
    card.feedbackRecords.replaceChildren(fragment);
  }
  function renderGeneratedImages(container, images) {
    const entries = (Array.isArray(images) ? images : []).filter(entry => typeof entry.id === 'string' && /^[0-9a-f-]{36}\.(png|jpg|webp)$/i.test(entry.id) && ['image/png','image/jpeg','image/webp'].includes(entry.mime));
    const signature = JSON.stringify(entries); if (signature === container.dataset.signature) return; container.dataset.signature = signature;
    const fragment = document.createDocumentFragment();
    entries.forEach((entry,index) => {
      const image = node('img', 'generated-preview'); image.alt = '原生生成图片 ' + (index + 1); image.loading = 'lazy';
      previewImage(image, '/api/images/image?id=' + encodeURIComponent(entry.id), 'generated:' + entry.id);
      fragment.append(image, node('p', 'entry-meta', '生成图片 ' + (index + 1) + ' · ' + entry.mime + ' · ' + entry.id));
    }); container.replaceChildren(fragment);
  }
  function historyCard(entry) {
    const card = node('article','entry'); const head = node('div','entry-head'); const kinds = {user:'微信来信',assistant:'助手回复',system:'系统记录',error:'错误记录'};
    head.append(node('strong','entry-title', kinds[entry.kind] || '消息'));
    if (entry.archival) head.append(node('span','badge muted','导入存档'));
    else if (entry.status || entry.delivery) { const badge = node('span'); const delivery = deliveryStatus(entry.delivery, entry.status); setBadge(badge,delivery.text,delivery.type); head.append(badge); }
    card.append(head,node('p','message-text',typeof entry.text === 'string' ? entry.text : '（无文本内容）'));
    card.append(node('p','entry-meta',[timeText(entry.time),entry.runId ? '运行 ' + entry.runId : ''].filter(Boolean).join(' · ')));
    (Array.isArray(entry.images) ? entry.images : []).forEach((image,index) => { card.append(node('p','entry-meta','图片 ' + (index + 1) + ' · ' + label(image.status) + (image.mime ? ' · ' + image.mime : ''))); });
    if (entry.error) card.append(node('p','error',errorText(entry.error))); return card;
  }
  async function loadHistory(offset = 0, query = historyQuery) {
    if (!token) return;
    const request = ++historyRequest; historyLoading = true; historyOffset = offset; historyQuery = query;
    $('history-page-state').textContent = '正在查询…'; updateButtons();
    try {
      const result = await api('/api/history?' + new URLSearchParams({offset:String(offset),limit:'100',q:query}));
      if (request !== historyRequest) return;
      historyTotal = Number(result.total) || 0; const entries = Array.isArray(result.items) ? result.items : []; const fragment = document.createDocumentFragment();
      entries.forEach(entry => fragment.append(historyCard(entry))); if (!entries.length) fragment.append(node('p','empty',query ? '没有匹配的消息。' : '暂无历史消息。'));
      $('full-history-list').replaceChildren(fragment);
      $('history-page-state').textContent = historyTotal ? '共 ' + historyTotal + ' 条 · 第 ' + (offset + 1) + '–' + (offset + entries.length) + ' 条 · 最新在前' : '共 0 条';
    } catch (error) { if (request === historyRequest) $('history-page-state').textContent = '查询失败：' + errorText(error); }
    finally { if (request === historyRequest) { historyLoading = false; updateButtons(); } }
  }
  function activateTab(name, focus = false) {
    document.querySelectorAll('[role="tab"]').forEach(tab => {
      const selected = tab.id === 'tab-' + name; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; $(tab.getAttribute('aria-controls')).hidden = !selected;
      if (selected && focus) tab.focus();
    });
    if (name === 'history') void loadHistory(historyOffset);
    if (name !== 'activity' && name !== 'history') void refreshFeatures();
  }
  function fileAsBase64(file) {
    return new Promise((resolve,reject) => {
      const reader = new FileReader(); reader.onerror = () => reject(new Error('图片文件无法读取'));
      reader.onload = () => { const value = String(reader.result); const comma = value.indexOf(','); if (comma < 0) reject(new Error('图片文件读取格式无效')); else resolve(value.slice(comma + 1)); }; reader.readAsDataURL(file);
    });
  }
  async function readRoleFile() {
    const file = $('role-file').files[0]; if (!file) return; const revision = roleDraftRevision;
    try {
      if (!/\.(md|txt)$/i.test(file.name) || file.size > 80000) throw new Error('角色文件需为 .md / .txt，最大 80 KB。');
      const text = await file.text(); if (revision !== roleDraftRevision || $('role-file').files[0] !== file) return;
      if (text.length > 20000) throw new Error('角色卡文本最多 20000 字符，请审核并精简后导入。');
      $('role-text').value = text; if (!$('role-name').value.trim()) $('role-name').value = file.name.replace(/\.(md|txt)$/i,'').slice(0,80); roleDraftRevision += 1;
      $('role-edit-note').textContent = '文件已读取，审核角色文本后点击保存。';
    } catch (error) { $('role-edit-note').textContent = errorText(error); }
  }
  function renderBackupPreview(result) {
    backupPreview = {id:result.id,expiresAt:Date.now() + Number(result.expiresInSeconds) * 1000}; $('backup-preview-box').hidden = false;
    const summary = result.summary || {};
    $('backup-summary').textContent = '记忆 ' + Number(summary.memory || 0) + ' 条 · 角色 ' + Number(summary.roles || 0) + ' 个 · 表情 ' + Number(summary.stickers || 0) + ' 张 · 历史 ' + Number(summary.history || 0) + ' 条';
    const names = {settings:'模型与人格配置',features:'记忆、角色、表情目录与反馈',stickers:'表情图片',history:'文本消息历史'}; const fragment = document.createDocumentFragment();
    (Array.isArray(result.diff) ? result.diff : []).forEach(entry => { if (Object.hasOwn(names,entry.section)) fragment.append(node('li','',names[entry.section] + '：' + (entry.changed ? '将替换为备份内容' : '内容相同'))); });
    $('backup-diff').replaceChildren(fragment); updateButtons();
  }

  document.querySelectorAll('[role="tab"]').forEach(tab => {
    tab.addEventListener('click', () => activateTab(tab.id.slice(4)));
    tab.addEventListener('keydown', event => {
      const tabs = [...document.querySelectorAll('[role="tab"]')]; const index = tabs.indexOf(tab); let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0; if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); activateTab(tabs[next].id.slice(4),true); }
    });
  });
  document.querySelectorAll('[data-close]').forEach(button => { button.addEventListener('click', () => $(button.getAttribute('data-close')).close()); });
  $('memory-add').addEventListener('click', () => openMemory());
  $('memory-enabled').addEventListener('change', () => { const enabled = $('memory-enabled').checked; $('memory-enabled').checked = features?.memory?.enabled === true; mutate('/api/memory',{action:'toggle',revision:features.memory.revision,enabled},'记忆开关已保存。'); });
  $('memory-form').addEventListener('input', () => { memoryDraftRevision += 1; });
  $('memory-form').addEventListener('submit', event => {
    event.preventDefault(); if (!memoryEdit) return; const revision = memoryDraftRevision;
    mutate('/api/memory',{action:memoryEdit.id ? 'edit' : 'add',...memoryEdit,revision:features.memory.revision,text:$('memory-text').value,pinned:$('memory-pinned').checked,enabled:$('memory-entry-enabled').checked},'记忆已保存。',result => {
      if (revision === memoryDraftRevision) $('memory-dialog').close();
      else { const entry = result.entries?.find(entry => entry.id === memoryEdit.id) || (!memoryEdit.id ? result.entries?.at(-1) : null); if (entry) memoryEdit = {id:entry.id,version:entry.version,revision:result.revision}; $('memory-edit-note').textContent = '提交时的内容已保存；后续输入仍未保存。'; }
    });
  });
  $('role-add').addEventListener('click', () => openRole('create')); $('role-import').addEventListener('click', () => openRole('import'));
  $('role-file').addEventListener('change', readRoleFile); $('role-form').addEventListener('input', () => { roleDraftRevision += 1; });
  $('role-select').addEventListener('change', () => mutate('/api/role',{action:'select',revision:features.revision,id:$('role-select').value || null},'角色选择已保存，请在手机核对语气。'));
  $('role-form').addEventListener('submit', event => {
    event.preventDefault(); if (!roleEdit) return; const revision = roleDraftRevision;
    mutate('/api/role',{action:roleAction,...roleEdit,revision:features.revision,name:$('role-name').value,text:$('role-text').value},'角色卡已保存。',result => {
      if (revision === roleDraftRevision) $('role-dialog').close();
      else { const entry = result.roles?.find(entry => entry.id === roleEdit.id) || (!roleEdit.id ? result.roles?.at(-1) : null); if (entry) {roleEdit = {id:entry.id,version:entry.version,revision:result.revision};roleAction = 'edit';} $('role-edit-note').textContent = '提交时的角色已保存；后续输入仍未保存。'; }
    });
  });
  $('sticker-add').addEventListener('click', () => openSticker()); $('sticker-source').addEventListener('change', updateStickerSource);
  $('stickers-enabled').addEventListener('change', () => { const enabled = $('stickers-enabled').checked; $('stickers-enabled').checked = features?.stickersEnabled === true; mutate('/api/stickers/update',{action:'enable',revision:features.revision,enabled},'表情使用开关已保存。'); });
  $('sticker-form').addEventListener('input', () => { stickerDraftRevision += 1; });
  $('sticker-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!stickerEdit || mutationPending) return; const revision = stickerDraftRevision;
    const body = {...stickerEdit,revision:features.revision,name:$('sticker-name').value,note:$('sticker-note').value}; const editing = Boolean(stickerEdit.id);
    try {
      if (editing) body.action = 'edit';
      else if ($('sticker-source').value === 'received') { const image = latestReceivedImage(status?.history); if (!image || image.status === 'error') throw new Error('尚无可用的本人图片，请先在手机私聊上传。'); body.imageId = image.id; }
      else {
        const file = $('sticker-file').files[0];
        if (!file || !['image/png','image/jpeg','image/webp','image/gif'].includes(file.type) || file.size > 5000000) throw new Error('请选择 PNG、JPEG、WebP 或 GIF 图片，最大 5 MB。');
        body.mime = file.type; body.base64 = await fileAsBase64(file);
        if (revision !== stickerDraftRevision || $('sticker-dialog').open !== true) { $('sticker-edit-note').textContent = '图片读取期间内容发生变化，请核对后重新保存。'; return; }
      }
      await mutate(editing ? '/api/stickers/update' : '/api/stickers/add',body,'表情已保存。',result => {
        if (revision === stickerDraftRevision) $('sticker-dialog').close();
        else { const entry = editing ? result.stickers?.find(entry => entry.id === stickerEdit.id) : result; if (entry?.id) stickerEdit = {id:entry.id,version:entry.version,revision:editing ? result.revision : body.revision + 1}; $('sticker-source-box').hidden = true; $('sticker-edit-note').textContent = '提交时的图片和备注已保存；后续输入仍未保存。'; }
      });
    } catch (error) { showNotice(errorText(error),true); }
  });
  $('history-search').addEventListener('submit', event => { event.preventDefault(); void loadHistory(0,$('history-query').value.trim()); });
  $('history-prev').addEventListener('click', () => { if (!historyLoading && historyOffset > 0) void loadHistory(Math.max(0,historyOffset - 100)); });
  $('history-next').addEventListener('click', () => { if (!historyLoading && historyOffset + 100 < historyTotal) void loadHistory(historyOffset + 100); });
  $('backup-file').addEventListener('change', () => { backupFileRevision += 1; backupPreview = null; $('backup-preview-box').hidden = true; updateButtons(); });
  $('backup-export').addEventListener('click', () => mutate('/api/backup/export',{includeHistory:$('backup-history').checked},'备份已交给浏览器下载。',result => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.data,null,2)],{type:'application/json'}));
    const link = node('a'); link.href = url; link.download = 'webot-backup-' + new Date().toISOString().slice(0,10) + '.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }));
  $('backup-preview').addEventListener('click', async () => {
    const file = $('backup-file').files[0]; const revision = backupFileRevision;
    try {
      if (!file || file.size > 75000000 || !/\.json$/i.test(file.name)) throw new Error('请选择有效 JSON 备份文件，最大 75 MB。');
      let data; try { data = JSON.parse(await file.text()); } catch { throw new Error('备份文件不是有效 JSON。'); }
      if (revision !== backupFileRevision) return;
      await mutate('/api/backup/preview',{data},'备份差异已读取，请核对后再恢复。',result => { if (revision === backupFileRevision) renderBackupPreview(result); });
    } catch (error) { showNotice(errorText(error),true); }
  });
  $('backup-restore').addEventListener('click', () => {
    updateButtons(); if ($('backup-restore').disabled || !backupPreview) return;
    mutate('/api/backup/restore',{id:backupPreview.id},'备份已恢复，并保持暂停。请先核对配置、角色和手机验收。',() => { backupPreview = null; $('backup-preview-box').hidden = true; settingsDirty = false; gateDirty = false; historyOffset = 0; });
  });
  window.addEventListener('pagehide', () => { previewImages.forEach(value => { if (value.url) URL.revokeObjectURL(value.url); }); });



  $('codex-login').addEventListener('click', async () => {
    if (mutationPending || !token) return;
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    let opened = false;
    await mutate('/api/codex/login', {}, '已发起官方登录，请在官方页面完成授权。', (result) => {
      const url = officialAuthUrl(result.authUrl);
      if (!url) throw new Error('服务返回的登录地址不是可信的 OpenAI HTTPS 地址，未打开登录页。');
      setAuthLink(url);
      if (popup) { popup.location.replace(url); opened = true; }
    });
    if (popup && !opened) popup.close();
    if (!popup && !$('auth-link').hidden) showNotice('浏览器拦截了新标签页。请点击“继续官方登录”，在 OpenAI 官方页面完成登录。');
  });
  $('refresh-account').addEventListener('click', () => mutate('/api/codex/refresh', {}, '账号信息已刷新。'));
  $('wechat-login').addEventListener('click', () => mutate('/api/wechat/login', {}, '已请求微信登录，请扫码并按微信提示完成绑定。'));
  $('verify-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const code = $('verify-code').value.trim();
    if (!code) return;
    mutate('/api/wechat/verify', { code }, '验证码已提交，请查看微信连接状态。', () => { $('verify-code').value = ''; });
  });
  $('settings-form').addEventListener('input', () => {
    settingsDirty = true;
    settingsRevision += 1;
    $('settings-state').textContent = '有未保存修改';
  });
  $('model').addEventListener('change', () => { populateModelControls(); updateButtons(); });
  $('settings-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const submittedRevision = settingsRevision;
    mutate('/api/settings', { model: $('model').value, reasoningEffort: $('effort').value, serviceTier: $('service-tier').value || null, persona: $('persona').value, imageMode: $('image-mode').value }, '模型、人格与图片配置已保存，请在手机私聊中验证。', () => { settingsDirty = submittedRevision !== settingsRevision; });
  });
  $('pause-chat').addEventListener('click', () => mutate('/api/chat/pause', { paused: !status?.chat?.paused }, status?.chat?.paused ? '已恢复回复。' : '已暂停回复。'));
  $('stop-chat').addEventListener('click', () => mutate('/api/chat/stop', {}, '已请求停止当前运行，请查看运行状态。'));
  $('reset-chat').addEventListener('click', () => $('reset-dialog').showModal());
  $('confirm-reset').addEventListener('click', () => mutate('/api/chat/reset', {}, '对话上下文已重置。', () => $('reset-dialog').close()));
  $('echo-image').addEventListener('click', () => {
    const image = latestReceivedImage(status?.history);
    if (!image || $('echo-image').disabled) return;
    mutate('/api/acceptance/image', { imageId: image.id }, '图片回传请求已完成，请在手机核对是否收到，再勾选图片发送验收。');
  });
  $('gate-form').addEventListener('change', () => { gateDirty = true; gateRevision += 1; updateButtons(); });
  $('gate-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const checks = Object.fromEntries(gateKeys.map((key) => [key, $('gate-form').elements[key].checked]));
    if (!gateKeys.every((key) => checks[key])) return;
    const submittedRevision = gateRevision;
    mutate('/api/gate', { checks, confirmed: true }, '手机验收确认已提交，请查看阶段门禁状态。', () => { gateDirty = submittedRevision !== gateRevision; });
  });
  $('refresh-status').addEventListener('click', refreshStatus);
  initializeToken();
  refreshStatus();
  setInterval(refreshStatus, 2000);
})();
