/* ============================================================
   个人中控台 · 共享数据层
   - 13 个数据 key 与原站 cc_state 完全一致
   - 默认本机存储（localStorage），可切换到云端同步
   - 云端同步：Supabase / 自定义 JSON 端点（GET+PUT），按键级时间戳合并
   ============================================================ */
window.HUB = (function () {
  'use strict';

  var KEYS = ['quotes','memos','cards','insts','repay_records','funds','visits',
              'shopping','news','news_saved','news_cols','news_crowd','auto_memo_ids','offers'];

  var NAME = {
    cards:'信用卡', memos:'备忘提醒', insts:'分期记录', repay_records:'还款记录',
    auto_memo_ids:'自动提醒标记', quotes:'弱智吧', funds:'指数 / 基金观察',
    shopping:'购物计价', visits:'客户拜访', news:'资讯镜像', news_saved:'资讯收藏',
    news_cols:'资讯栏目', news_crowd:'拥挤度历史', offers:'信用卡优惠'
  };

  var PRECOMPUTED = {};          // key -> value 缓存
  var META = {};                // key -> 本地更新时间戳（ms）
  var DIRTY = {};               // 待推送标记
  var LS = 'hub_v1_';
  var cfg = { mode:'local', url:'', anonKey:'', device:'' };
  var pushTimer = null, pushPending = false, pulling = false, lastStatus = 'local';

  /* ---------------- 基础工具 ---------------- */
  function pad2(n){ return String(n).padStart(2,'0'); }
  function nowStamp(d){ d = d || new Date();
    return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate())+' '+pad2(d.getHours())+':'+pad2(d.getMinutes()); }
  function todayStr(d){ d = d || new Date();
    return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()); }
  function uid(p){ return (p||'x') + Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function fmtMoney(n){ return '¥' + (Number(n)||0).toLocaleString('zh-CN',{maximumFractionDigits:2}); }
  function clone(o){ return JSON.parse(JSON.stringify(o)); }

  function storeOk(){ try { localStorage.setItem('__hub_t__','1'); localStorage.removeItem('__hub_t__'); return true; } catch(e){ return false; } }
  var HAS_LS = storeOk();
  var MEM = {};
  function rawGet(k){ if(!HAS_LS) return MEM[k]; try{ return localStorage.getItem(k); }catch(e){ return MEM[k]; } }
  function rawSet(k,v){ if(!HAS_LS){ MEM[k]=v; return; } try{ localStorage.setItem(k,v); }catch(e){ MEM[k]=v; } }

  /* ---------------- 读写 ---------------- */
  function loadMeta(){ try { META = JSON.parse(rawGet(LS+'meta')||'{}')||{}; } catch(e){ META={}; } }
  function saveMeta(){ rawSet(LS+'meta', JSON.stringify(META)); }

  function read(key){
    if (PRECOMPUTED[key] !== undefined) return PRECOMPUTED[key].v;
    var s = rawGet(LS+key);
    if (s == null) { PRECOMPUTED[key] = { v:null }; return null; }
    try { var v = JSON.parse(s); PRECOMPUTED[key] = { v:v }; return v; }
    catch(e){ PRECOMPUTED[key] = { v:null }; return null; }
  }
  function write(key, val, opts){
    opts = opts || {};
    PRECOMPUTED[key] = { v: val };
    rawSet(LS+key, JSON.stringify(val));
    META[key] = Date.now();
    saveMeta();
    if (!opts.silent) {
      DIRTY[key] = true;
      schedulePush();
      try { window.dispatchEvent(new CustomEvent('hub:local', { detail:{key:key} })); } catch(e){}
      maybeBackup(key);
    }
  }
  function get(key, fallback){
    var v = read(key);
    return (v === null || v === undefined) ? (fallback === undefined ? null : fallback) : v;
  }
  function set(key, val){ write(key, val); }

  /* ---------------- 初始化 ---------------- */
  function seedInit(){
    var S = window.HUB_SEED || {};
    var did = false;
    KEYS.forEach(function(k){
      if (rawGet(LS+k) != null) return;
      var sv = S[k];
      if (k === 'offers' && S.offers) sv = S.offers;
      if (sv === undefined) return;
      rawSet(LS+k, JSON.stringify(sv));
      META[k] = Date.now();
      did = true;
    });
    if (did) saveMeta();
    rawSet(LS+'init','1');
  }
  function loadConfig(){
    try { var c = JSON.parse(rawGet(LS+'cfg')||'{}'); if (c && c.mode) cfg = Object.assign(cfg, c); } catch(e){}
    if (!cfg.device) { cfg.device = 'dev_'+Math.random().toString(36).slice(2,8); saveConfig(); }
  }
  function saveConfig(){ rawSet(LS+'cfg', JSON.stringify(cfg)); }

  /* ---------------- 云端同步 ---------------- */
  function cloudOn(){ return cfg.mode !== 'local' && !!cfg.url; }

  function snapshot(){
    var data = {};
    KEYS.forEach(function(k){
      var v = read(k);
      if (v !== null && v !== undefined) data[k] = { t: (DIRTY[k] ? Math.max(META[k]||0, Date.now()) : (META[k]||0)), v: v };
    });
    return { schema:1, app:'个人中控台', device:cfg.device, updatedAt:new Date().toISOString(), data:data };
  }

  function headers(){
    if (cfg.mode === 'supabase') {
      return { 'Content-Type':'application/json', 'apikey':cfg.anonKey, 'Authorization':'Bearer '+cfg.anonKey };
    }
    return { 'Content-Type':'application/json' };
  }

  function cloudGet(){
    if (cfg.mode === 'supabase') {
      return fetch(cfg.url.replace(/\/+$/,'') + '/rest/v1/hub_state?id=eq.main&select=payload',
        { headers: headers(), cache:'no-store' })
        .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
        .then(function(rows){ return (rows && rows[0] && rows[0].payload) ? rows[0].payload : null; });
    }
    return fetch(cfg.url, { headers: headers(), cache:'no-store' })
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function(d){ return (d && d.data) ? d : (d && d.schema ? d : null); });
  }

  function cloudPut(doc){
    if (cfg.mode === 'supabase') {
      var h = headers(); h['Prefer'] = 'resolution=merge-duplicates';
      return fetch(cfg.url.replace(/\/+$/,'') + '/rest/v1/hub_state', {
        method:'POST', headers:h,
        body: JSON.stringify([{ id:'main', payload:doc, updated_at:new Date().toISOString() }])
      }).then(function(r){ if(!r.ok) return r.text().then(function(t){ throw new Error('HTTP '+r.status+' '+(t||'').slice(0,120)); }); });
    }
    return fetch(cfg.url, { method:'PUT', headers: headers(), body: JSON.stringify(doc) })
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); });
  }

  function applyRemote(doc, opts){
    opts = opts || {};
    var changed = [];
    if (!doc || !doc.data) return changed;
    Object.keys(doc.data).forEach(function(k){
      var rec = doc.data[k]; if (!rec) return;
      /* 本机有还没推上去的改动时，不能被一次拉取悄悄盖掉（这是之前账单被回滚的根因） */
      if (DIRTY[k] && !opts.force) return;
      var rt = Number(rec.t)||0, lt = Number(META[k])||0;
      if (opts.force || rt > lt + 500) {
        PRECOMPUTED[k] = { v: rec.v };
        rawSet(LS+k, JSON.stringify(rec.v));
        META[k] = rt;
        changed.push(k);
      }
    });
    if (changed.length) { saveMeta(); try { window.dispatchEvent(new CustomEvent('hub:remote', { detail:{keys:changed} })); } catch(e){} }
    return changed;
  }

  function pull(manual, force){
    if (!cloudOn() || pulling) return Promise.resolve([]);
    pulling = true; setStatus('busy','☁️ 同步中…');
    return cloudGet().then(function(doc){
      var ch = applyRemote(doc, { force: !!force });
      setStatus('ok','☁️ 已同步');
      pulling = false;
      return ch;
    }).catch(function(e){
      pulling = false;
      setStatus('off','⚠️ 云端连接失败，暂存本机');
      if (manual) toast('云端连接失败：' + e.message);
      return [];
    });
  }

  /* 弱智吧是只增不删的主数据（删除由乐享表格侧决定），推送时按 ID 并集，
     防止旧设备拿 24 条覆盖掉已经扩到 85 条的云端版本 */
  function mergeQuotes(remote, local){
    try {
      var rq = remote && remote.data && remote.data.quotes;
      var lq = local.data.quotes;
      if (!rq || !Array.isArray(rq.v) || !lq || !Array.isArray(lq.v)) return local;
      var by = {}, order = [];
      function stamp(x){ return String(x && (x.updatedAt || x.createdAt || '')).slice(0,16); }
      rq.v.forEach(function(x){ if (!x || !x.id) return; by[x.id] = x; order.push(x.id); });
      lq.v.forEach(function(x){
        if (!x || !x.id) return;
        var cur = by[x.id];
        if (!cur){ by[x.id] = x; order.push(x.id); return; }
        if (stamp(x) > stamp(cur)) by[x.id] = x;
      });
      local.data.quotes = { t: Math.max(Number(rq.t)||0, Number(lq.t)||0), v: order.map(function(id){ return by[id]; }) };
      return local;
    } catch(e){ return local; }
  }

  function pushNow(){
    if (!cloudOn() || pushPending) return Promise.resolve();
    pushPending = true;
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    setStatus('busy','☁️ 同步中…');
    // 先拉后推：把别的设备写入、本机没有的 key 合并进来，避免互相覆盖
    return cloudGet().catch(function(){ return null; }).then(function(remote){
      if (remote) applyRemote(remote);
      var doc = mergeQuotes(remote, snapshot());
      return cloudPut(doc).then(function(){
        Object.keys(doc.data).forEach(function(k){ META[k] = doc.data[k].t; });
        saveMeta();
      });
    }).then(function(){
      DIRTY = {};
      pushPending = false;
      setStatus('ok','☁️ 已同步 · ' + nowStamp());
    }).catch(function(e){
      pushPending = false;
      setStatus('off','⚠️ 云端连接失败，暂存本机');
    });
  }

  function schedulePush(){
    if (!cloudOn()) return;
    DIRTY.__dirty = true;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function(){ pushTimer=null; pushNow(); }, 800);
  }

  function setStatus(cls, text){
    lastStatus = cls;
    var els = document.querySelectorAll('[data-sync-badge]');
    for (var i=0;i<els.length;i++){
      els[i].className = 'sync ' + cls;
      els[i].innerHTML = '<span class="dot"></span>' + text;
      els[i].title = cloudOn() ? '点击可查看/修改同步设置' : '当前为本机存储，点击可开启多设备同步';
      els[i].onclick = openSyncDialog;
    }
    if (cls === 'ok' && !text.includes('·')) { /* keep */ }
  }
  function refreshStatus(){
    if (!cloudOn()) { setStatus('ok','💾 本机存储 · 点击开启同步'); return; }
    pull(false).then(function(){ /* status set inside */ });
  }

  /* ---------------- 同步设置弹窗 ---------------- */
  function openSyncDialog(){
    var dlg = document.createElement('div');
    dlg.className = 'mask';
    dlg.innerHTML = ''
      + '<div class="dlg" style="max-width:620px">'
      + '  <h3>多设备同步设置</h3>'
      + '  <p class="dlg-sub">手机、电脑打开同一份网页时，改动会互相同步。同步依赖一个你选的云端存储，本页只保存配置，不上传任何账号密码。</p>'
      + '  <div class="form-grid one">'
      + '    <div><label class="f">同步方式</label>'
      + '      <select id="syMode">'
      + '        <option value="local">仅本机（不联网，数据只在这台设备）</option>'
      + '        <option value="supabase">Supabase（免费、推荐，可真正多设备同步）</option>'
      + '        <option value="endpoint">自定义 JSON 端点（支持 GET/PUT 的任意地址）</option>'
      + '      </select></div>'
      + '    <div id="syUrlBox" hidden><label class="f" id="syUrlLabel">服务地址</label>'
      + '      <input type="text" id="syUrl" placeholder="https://xxxx.supabase.co"></div>'
      + '    <div id="syKeyBox" hidden><label class="f">Supabase anon key（公开密钥，非服务端密钥）</label>'
      + '      <input type="text" id="syKey" placeholder="eyJhbGciOi..."></div>'
      + '    <div class="hint" id="syHelp"></div>'
      + '  </div>'
      + '  <div style="display:flex;gap:8px;margin:10px 0 2px">'
      + '    <button class="btn ghost" id="syForcePull">↓ 用云端覆盖本机</button>'
      + '    <button class="btn ghost" id="syForcePush">↑ 把本机推上云端</button>'
      + '  </div>'
      + '  <div class="dlg-foot">'
      + '    <button class="btn gray" id="syClose">取消</button>'
      + '    <button class="btn ghost" id="syTest">测试连接</button>'
      + '    <button class="btn" id="sySave">保存并立即同步</button>'
      + '  </div>'
      + '</div>';
    document.body.appendChild(dlg);

    var mode = dlg.querySelector('#syMode'), urlBox = dlg.querySelector('#syUrlBox'),
        keyBox = dlg.querySelector('#syKeyBox'), help = dlg.querySelector('#syHelp'),
        url = dlg.querySelector('#syUrl'), key = dlg.querySelector('#syKey'),
        urlLabel = dlg.querySelector('#syUrlLabel');

    var HELP = {
      local: '数据只保存在本机浏览器里。换设备或换浏览器都看不到，适合先用起来。',
      supabase: '在 supabase.com 免费建一个项目，SQL 里执行：<br>'
        + '<code style="font-size:11px;background:#f4f7fb;padding:6px;display:block;border-radius:6px;line-height:1.7;white-space:pre-wrap">create table if not exists hub_state (\n  id text primary key,\n  payload jsonb,\n  updated_at timestamptz default now()\n);\nalter table hub_state enable row level security;\ncreate policy "hub_all" on hub_state for all\n  using (true) with check (true);</code>'
        + '然后把项目 URL 和 anon public key 填进来。同一套配置在手机、电脑上都填一次，就互通了。',
      endpoint: '任意支持 GET 读取、PUT 写入同一地址的 JSON 存储都行（例如自己搭的一个接口，或 jsonblob.com 生成的地址）。读取要返回整份文档 {schema,data:{key:{t,v}}}。'
    };

    function syncModeUI(){
      var m = mode.value;
      urlBox.hidden = (m === 'local'); keyBox.hidden = (m !== 'supabase');
      urlLabel.textContent = (m === 'supabase') ? '项目 URL（如 https://abcd.supabase.co）' : 'JSON 存储地址（GET/PUT 同一个 URL）';
      url.placeholder = (m === 'supabase') ? 'https://abcd.supabase.co' : 'https://example.com/api/hub.json';
      help.innerHTML = HELP[m] || '';
      url.value = (cfg.mode === m) ? cfg.url : '';
      key.value = (cfg.mode === m) ? cfg.anonKey : '';
    }
    mode.value = cfg.mode; syncModeUI();
    mode.onchange = syncModeUI;

    function collect(){ return { mode: mode.value, url: url.value.trim(), anonKey: key.value.trim() }; }
    function apply(c){ cfg.mode = c.mode; cfg.url = c.url; cfg.anonKey = c.anonKey; saveConfig(); }

    dlg.querySelector('#syTest').onclick = function(){
      var c = collect();
      if (c.mode === 'local') { toast('当前为仅本机模式，无需测试'); return; }
      if (!c.url) { toast('请先填写地址'); return; }
      var bak = { mode:cfg.mode, url:cfg.url, anonKey:cfg.anonKey };
      apply(c);
      cloudGet().then(function(doc){
        apply(bak); syncModeUI();
        toast(doc ? '连接成功，云端已有数据' : '连接成功，云端还没有数据（保存后会上传本机数据）');
      }).catch(function(e){
        apply(bak); syncModeUI();
        toast('连接失败：' + e.message);
      });
    };

    dlg.querySelector('#syForcePull').onclick = function(){
      if (!cloudOn()) { toast('当前是仅本机模式'); return; }
      if (!confirm('用云端数据覆盖这台设备？本机还没上传的改动会丢掉。')) return;
      pull(true, true).then(function(ch){ toast(ch.length ? '已用云端覆盖本机（' + ch.length + ' 类）' : '云端与本机一致'); });
    };
    dlg.querySelector('#syForcePush').onclick = function(){
      if (!cloudOn()) { toast('当前是仅本机模式'); return; }
      if (!confirm('把这台设备的数据推到云端？其他设备还没同步的改动会被覆盖。')) return;
      KEYS.forEach(function(k){ DIRTY[k] = true; });
      DIRTY.__dirty = true;
      pushNow().then(function(){ toast('已把本机数据推上云端'); });
    };

    dlg.querySelector('#sySave').onclick = function(){
      var c = collect();
      if (c.mode !== 'local' && !c.url) { toast('请填写地址'); return; }
      if (c.mode === 'supabase' && !c.anonKey) { toast('请填写 anon key'); return; }
      apply(c); dlg.remove();
      if (c.mode === 'local') { setStatus('ok','💾 本机存储 · 点击开启同步'); toast('已切换为仅本机存储'); return; }
      toast('已保存，正在同步…');
      pull(true).then(function(ch){
        var doc = snapshot();
        return cloudPut(doc).then(function(){ return ch; });
      }).then(function(ch){
        setStatus('ok','☁️ 已同步 · ' + nowStamp());
        toast('同步已开启' + (ch.length ? '，已合并云端 '+ch.length+' 类数据' : ''));
        try { window.dispatchEvent(new CustomEvent('hub:remote', { detail:{keys:KEYS} })); } catch(e){}
      }).catch(function(e){
        setStatus('off','⚠️ 云端连接失败，暂存本机');
        toast('同步失败：' + e.message);
      });
    };
    dlg.querySelector('#syClose').onclick = function(){ dlg.remove(); };
    dlg.addEventListener('click', function(e){ if (e.target === dlg) dlg.remove(); });
  }

  /* ---------------- 云端自动备份（Supabase 两行：bak_memo / bak_auto） ---------------- */
  var BAK_MEMO = 'bak_memo', BAK_AUTO = 'bak_auto';
  var MEMO_KEEP_MS = 3 * 24 * 3600 * 1000, MEMO_SLOTS = 90, AUTO_SLOTS = 7;

  function rowGet(id){
    if (cfg.mode !== 'supabase' || !cfg.url) return Promise.resolve(null);
    var u = cfg.url.replace(/\/+$/,'') + '/rest/v1/hub_state?id=eq.' + encodeURIComponent(id) + '&select=payload';
    return fetch(u, { headers: headers(), cache:'no-store' })
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function(rows){ return (rows && rows[0] && rows[0].payload) ? rows[0].payload : null; });
  }
  function rowPut(id, payload){
    if (cfg.mode !== 'supabase' || !cfg.url) return Promise.reject(new Error('还没开启 Supabase 同步'));
    var h = headers(); h['Prefer'] = 'resolution=merge-duplicates';
    return fetch(cfg.url.replace(/\/+$/,'') + '/rest/v1/hub_state', {
      method:'POST', headers:h,
      body: JSON.stringify([{ id:id, payload:payload, updated_at:new Date().toISOString() }])
    }).then(function(r){ if(!r.ok) return r.text().then(function(t){ throw new Error('HTTP '+r.status+' '+(t||'').slice(0,120)); }); });
  }

  function bkMeta(){ try { return JSON.parse(rawGet(LS+'bakmeta')||'{}') || {}; } catch(e){ return {}; } }
  function saveBkMeta(m){ rawSet(LS+'bakmeta', JSON.stringify(m)); }

  function dataOf(keys){
    var data = {};
    keys.forEach(function(k){ var v = read(k); if (v != null) data[k] = { t:(META[k]||0), v:v }; });
    return data;
  }

  /* 备忘：有修改就备，同一小时最多一份，保留 3 天 */
  function backupMemoRing(){
    if (cfg.mode !== 'supabase' || !cfg.url) return Promise.reject(new Error('还没开启 Supabase 同步'));
    return rowGet(BAK_MEMO).catch(function(){ return null; }).then(function(p){
      var ring = (p && Array.isArray(p.items)) ? p : { schema:1, kind:'memo', keepDays:3, items:[] };
      var now = Date.now(), hour = nowStamp().slice(0,13);
      ring.items = (ring.items || []).filter(function(x){
        if (!x || !x.at) return false;
        var t = Date.parse(x.at);
        if (isNaN(t)) return false;
        if (now - t > MEMO_KEEP_MS) return false;   /* 超过 3 天丢掉 */
        return x.hour !== hour;                     /* 同一小时只留一份 */
      });
      ring.items.push({ at:new Date().toISOString(), hour:hour, label:nowStamp(), data:dataOf(['memos']) });
      ring.items.sort(function(a,b){ return Date.parse(b.at) - Date.parse(a.at); });
      ring.items = ring.items.slice(0, MEMO_SLOTS);
      return rowPut(BAK_MEMO, ring).then(function(){ return ring.items.length; });
    });
  }

  /* 其他数据：每天一份，保留 7 天 */
  function backupDailyRing(){
    if (cfg.mode !== 'supabase' || !cfg.url) return Promise.reject(new Error('还没开启 Supabase 同步'));
    return rowGet(BAK_AUTO).catch(function(){ return null; }).then(function(p){
      var ring = (p && Array.isArray(p.items)) ? p : { schema:1, kind:'auto', keepDays:7, items:[] };
      var day = todayStr();
      var keys = KEYS.filter(function(k){ return k !== 'memos'; });
      ring.items = (ring.items || []).filter(function(x){ return x && x.day && x.day !== day; });
      ring.items.push({ at:new Date().toISOString(), day:day, label:nowStamp(), data:dataOf(keys) });
      ring.items.sort(function(a,b){ return Date.parse(b.at) - Date.parse(a.at); });
      ring.items = ring.items.slice(0, AUTO_SLOTS);
      return rowPut(BAK_AUTO, ring).then(function(){ return ring.items.length; });
    });
  }

  /* 写入时自动触发：备忘走小时闸门，其他走天闸门 */
  function maybeBackup(key){
    if (cfg.mode !== 'supabase' || !cfg.url) return;
    var m = bkMeta();
    if (key === 'memos'){
      var hour = nowStamp().slice(0,13);
      if (m.memoHour === hour) return;
      m.memoHour = hour; saveBkMeta(m);
      backupMemoRing().catch(function(){ m.memoHour = ''; saveBkMeta(m); });
    } else {
      var day = todayStr();
      if (m.autoDay === day) return;
      m.autoDay = day; saveBkMeta(m);
      backupDailyRing().catch(function(){ m.autoDay = ''; saveBkMeta(m); });
    }
  }

  function cloudBackups(kind){
    var id = kind === 'memo' ? BAK_MEMO : BAK_AUTO;
    return rowGet(id).then(function(p){ return (p && Array.isArray(p.items)) ? p.items : []; });
  }

  function restoreBackup(kind, at){
    var id = kind === 'memo' ? BAK_MEMO : BAK_AUTO;
    return rowGet(id).then(function(p){
      var e = ((p && p.items) || []).filter(function(x){ return x.at === at; })[0];
      if (!e || !e.data) throw new Error('没找到这份备份');
      var keys = Object.keys(e.data), n = 0;
      keys.forEach(function(k){
        if (KEYS.indexOf(k) < 0) return;
        write(k, e.data[k].v, { silent:true, skipBackup:true });
        META[k] = e.data[k].t || Date.now(); n++;
      });
      saveMeta();
      if (cloudOn()) { KEYS.forEach(function(k){ DIRTY[k] = true; }); schedulePush(); }
      try { window.dispatchEvent(new CustomEvent('hub:remote', { detail:{keys:keys} })); } catch(err){}
      return n;
    });
  }

  /* ---------------- 整份备份 ---------------- */
  function exportDoc(){
    return {
      app:'个人中控台门户', schema:1, backupDate: todayStr(),
      createdAt: new Date().toISOString(), source:'manual-export',
      counts: KEYS.reduce(function(o,k){ var v=read(k); o[k] = (v==null?0:(Array.isArray(v)?v.length:(typeof v==='object'?Object.keys(v).length:1))); return o; }, {}),
      data: KEYS.reduce(function(o,k){ var v=read(k); if(v!=null) o[k]=v; return o; }, {})
    };
  }
  function importDoc(obj){
    var src = obj && obj.data ? obj.data : obj;
    if (!src || typeof src !== 'object') throw new Error('不是有效的备份文件');
    var n = 0, keys = [];
    Object.keys(src).forEach(function(k){
      if (KEYS.indexOf(k) < 0) return;
      write(k, src[k], { silent:true });
      n++; keys.push(k);
    });
    if (!keys.length) throw new Error('备份里没有可用数据');
    if (cloudOn()) { KEYS.forEach(function(k){ DIRTY[k]=true; }); schedulePush(); }
    try { window.dispatchEvent(new CustomEvent('hub:remote', { detail:{keys:keys} })); } catch(e){}
    return n;
  }

  function resetToSeed(){
    KEYS.forEach(function(k){ try{ rawSet(LS+k, null); localStorage.removeItem(LS+k); }catch(e){} });
    PRECOMPUTED = {}; META = {}; saveMeta();
    seedInit();
    try { window.dispatchEvent(new CustomEvent('hub:remote', { detail:{keys:KEYS} })); } catch(e){}
  }

  /* ---------------- 通用 UI ---------------- */
  var toastEl = null;
  function toast(msg, ms){
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.id='toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function(){ toastEl.classList.remove('show'); }, ms || 2400);
  }

  function bindSyncBadges(){ refreshStatus(); }

  /* ---------------- 启动 ---------------- */
  function boot(){
    loadConfig();
    if (rawGet(LS+'init') == null) seedInit();
    loadMeta();
    if (cloudOn()) setTimeout(function(){ pull(false); maybeBackup('__boot'); }, 300);
    else setStatus('ok','💾 本机存储 · 点击开启同步');
    setInterval(function(){
      if (!cloudOn()) return;
      if (document.hidden) return;
      /* 有没推上去的改动就重试，推不上去时不会一直卡在本机旧数据 */
      if (DIRTY.__dirty) { if (!pushPending) pushNow(); return; }
      pull(false);
    }, 20000);
    document.addEventListener('visibilitychange', function(){
      if (!cloudOn()) return;
      if (document.hidden) { if (DIRTY.__dirty) pushNow(); return; }
      pull(false);  /* 切回前台立刻拉一次，补上后台期间的变化 */
    });
    window.addEventListener('beforeunload', function(){ if (cloudOn() && DIRTY.__dirty) { try{ navigator.sendBeacon && null; }catch(e){} } });
    document.addEventListener('DOMContentLoaded', bindSyncBadges);
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(bindSyncBadges, 0);
  }

  boot();

  return {
    KEYS: KEYS, NAME: NAME,
    get: get, set: set, write: write, read: read,
    clone: clone, uid: uid, esc: esc,
    pad2: pad2, nowStamp: nowStamp, todayStr: todayStr, fmtMoney: fmtMoney,
    toast: toast, openSyncDialog: openSyncDialog,
    exportDoc: exportDoc, importDoc: importDoc, resetToSeed: resetToSeed,
    pull: pull, pushNow: pushNow, cloudOn: cloudOn,
    config: function(){ return cfg; },
    setBadge: function(){ refreshStatus(); },
    onRemote: function(cb){ window.addEventListener('hub:remote', function(e){ cb(e.detail.keys); }); },
    onLocal: function(cb){ window.addEventListener('hub:local', function(e){ cb(e.detail.key); }); },
    storeOk: function(){ return HAS_LS; },
    shapeName: function(k){ return NAME[k] || k; },
    cloudBackups: cloudBackups,
    restoreBackup: restoreBackup,
    backupNow: function(kind){ return kind === 'memo' ? backupMemoRing() : backupDailyRing(); },
    backupMarks: bkMeta
  };
})();
