/* BTX Prontuário Premium - Offline PWA (no backend, no login)
   - IndexedDB for state + images
   - Agenda, Patients, Record (entries + radiographs), Documents (print/PDF), Backup export/import
*/
(() => {
  const DB_NAME = "btx_premio_db";
  const DB_VER = 1;
  const STORE_STATE = "state";
  const STORE_IMG = "images";

  const DEFAULT_SETTINGS = {
    appName: "BTX Prontuário",
    appSub: "Premium Offline",
    profName: "Profissional",
    profReg: "",
    profPhone: "",
    profEmail: "",
    profAddr: "",
    place: "Belém – PA",
    dateFmt: "pt"
  };

  const emptyState = () => ({
    meta: { version: "1.0", createdAt: isoNow(), updatedAt: isoNow() },
    settings: { ...DEFAULT_SETTINGS },
    patients: [],   // {id, name, phone, birth, doc, notes, createdAt, updatedAt}
    appts: [],      // {id, date, time, patientId, status, reason, notes, createdAt, updatedAt}
    entries: [],    // {id, patientId, date, type, text, createdAt, updatedAt}
    rx: []          // {id, patientId, name, mime, createdAt} -> blob in STORE_IMG
  });

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));

  // ---------- Utils ----------
  function uid() {
    return (crypto?.randomUUID?.() || (Math.random().toString(16).slice(2) + "-" + Date.now().toString(16)));
  }
  function isoNow(){ return new Date().toISOString(); }
  function todayISO(){ return new Date().toISOString().slice(0,10); }
  function fmtDate(d){
    if(!d) return "";
    if(state.settings.dateFmt === "iso") return d;
    const [y,m,dd] = d.split("-");
    if(!y||!m||!dd) return d;
    return `${dd}/${m}/${y}`;
  }
  function escapeHtml(s){
    return String(s ?? "").replace(/[&<>"']/g, (m)=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;" }[m]));
  }

  // ---------- IndexedDB minimal ----------
  function openDB(){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if(!db.objectStoreNames.contains(STORE_STATE)){
          db.createObjectStore(STORE_STATE);
        }
        if(!db.objectStoreNames.contains(STORE_IMG)){
          db.createObjectStore(STORE_IMG);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(store, key){
    const db = await openDB();
    return new Promise((resolve, reject)=>{
      const tx = db.transaction(store, "readonly");
      const st = tx.objectStore(store);
      const req = st.get(key);
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> reject(req.error);
    });
  }

  async function idbPut(store, key, val){
    const db = await openDB();
    return new Promise((resolve, reject)=>{
      const tx = db.transaction(store, "readwrite");
      const st = tx.objectStore(store);
      const req = st.put(val, key);
      req.onsuccess = ()=> resolve(true);
      req.onerror = ()=> reject(req.error);
    });
  }

  async function idbDel(store, key){
    const db = await openDB();
    return new Promise((resolve, reject)=>{
      const tx = db.transaction(store, "readwrite");
      const st = tx.objectStore(store);
      const req = st.delete(key);
      req.onsuccess = ()=> resolve(true);
      req.onerror = ()=> reject(req.error);
    });
  }

  async function idbKeys(store){
    const db = await openDB();
    return new Promise((resolve, reject)=>{
      const tx = db.transaction(store, "readonly");
      const st = tx.objectStore(store);
      const req = st.getAllKeys();
      req.onsuccess = ()=> resolve(req.result || []);
      req.onerror = ()=> reject(req.error);
    });
  }

  async function blobToDataURL(blob){
    return new Promise((resolve, reject)=>{
      const r = new FileReader();
      r.onload = ()=> resolve(String(r.result));
      r.onerror = ()=> reject(r.error);
      r.readAsDataURL(blob);
    });
  }
  async function dataURLToBlob(dataURL){
    const res = await fetch(dataURL);
    return await res.blob();
  }

  // ---------- State ----------
  let state = emptyState();

  async function load(){
    const saved = await idbGet(STORE_STATE, "state");
    if(saved && typeof saved === "object"){
      state = saved;
      // migrations / guards
      state.settings = { ...DEFAULT_SETTINGS, ...(state.settings||{}) };
      state.patients ??= [];
      state.appts ??= [];
      state.entries ??= [];
      state.rx ??= [];
      state.meta ??= { version:"1.0", createdAt: isoNow(), updatedAt: isoNow() };
    } else {
      state = emptyState();
      await persist();
    }
    applyBrand();
    hydrateUI();
    renderAll();
    updateBackupInfo();
  }

  async function persist(){
    state.meta.updatedAt = isoNow();
    await idbPut(STORE_STATE, "state", state);
    updateBackupInfo();
  }

  // ---------- PWA install + SW ----------
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e)=>{
    e.preventDefault();
    deferredPrompt = e;
    $("btnInstall").hidden = false;
  });
  $("btnInstall")?.addEventListener("click", async ()=>{
    if(!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $("btnInstall").hidden = true;
  });

  if("serviceWorker" in navigator){
    window.addEventListener("load", ()=> navigator.serviceWorker.register("sw.js").catch(()=>{}));
  }

  // ---------- Navigation ----------
  const views = ["agenda","patients","record","docs","backup","settings"];
  function showView(v){
    qsa(".navItem").forEach(b=> b.classList.toggle("active", b.dataset.view===v));
    views.forEach(k=> $("view-"+k).hidden = (k!==v));
    if(v==="agenda") renderAgenda();
    if(v==="patients") renderPatients();
    if(v==="record") renderRecord();
    if(v==="docs") renderDocs();
    if(v==="backup") updateBackupInfo();
  }
  qsa(".navItem").forEach(b=> b.addEventListener("click", ()=> showView(b.dataset.view)));

  // ---------- Brand / Settings ----------
  function applyBrand(){
    $("brandName").textContent = state.settings.appName || "BTX Prontuário";
    $("brandSub").textContent = state.settings.appSub || "Premium Offline";
  }

  function hydrateUI(){
    // Settings
    $("s_appName").value = state.settings.appName || "";
    $("s_appSub").value = state.settings.appSub || "";
    $("s_profName").value = state.settings.profName || "";
    $("s_profReg").value = state.settings.profReg || "";
    $("s_profPhone").value = state.settings.profPhone || "";
    $("s_profEmail").value = state.settings.profEmail || "";
    $("s_profAddr").value = state.settings.profAddr || "";
    $("s_place").value = state.settings.place || "";
    $("s_dateFmt").value = state.settings.dateFmt || "pt";
    // Dates
    $("agendaDate").value = todayISO();
  }

  $("btnSaveSettings")?.addEventListener("click", async ()=>{
    state.settings = {
      appName: $("s_appName").value.trim() || DEFAULT_SETTINGS.appName,
      appSub: $("s_appSub").value.trim() || DEFAULT_SETTINGS.appSub,
      profName: $("s_profName").value.trim() || DEFAULT_SETTINGS.profName,
      profReg: $("s_profReg").value.trim(),
      profPhone: $("s_profPhone").value.trim(),
      profEmail: $("s_profEmail").value.trim(),
      profAddr: $("s_profAddr").value.trim(),
      place: $("s_place").value.trim() || DEFAULT_SETTINGS.place,
      dateFmt: $("s_dateFmt").value
    };
    applyBrand();
    await persist();
    renderDocs();
  });

  // ---------- Patients ----------
  let editingPatientId = null;

  function patientSelectOptions(){
    const list = [...state.patients].sort((a,b)=> (a.name||"").localeCompare(b.name||""));
    return list.map(p => `<option value="${p.id}">${escapeHtml(p.name||"")}</option>`).join("");
  }

  function renderPatients(){
    const q = ($("patientSearch").value||"").trim().toLowerCase();
    const list = [...state.patients]
      .filter(p => !q || (p.name||"").toLowerCase().includes(q) || (p.phone||"").toLowerCase().includes(q))
      .sort((a,b)=> (a.name||"").localeCompare(b.name||""));

    $("patientsList").innerHTML = list.length ? list.map(p=>{
      return `<div class="row">
        <div>
          <div class="cellMain">${escapeHtml(p.name||"")}</div>
          <div class="cellSub">${escapeHtml(p.phone||"")}</div>
        </div>
        <div class="cellMuted">${escapeHtml(p.doc||"")}</div>
        <div class="cellMuted">${escapeHtml(p.birth||"")}</div>
        <div class="cellActions">
          <button class="btn" data-edit-p="${p.id}">Editar</button>
        </div>
      </div>`;
    }).join("") : "";

    qsa("[data-edit-p]").forEach(b=> b.addEventListener("click", ()=> openPatient(b.dataset.editP)));

    // refresh selects
    $("a_patient").innerHTML = patientSelectOptions() || `<option value="">—</option>`;
    $("recordPatient").innerHTML = patientSelectOptions() || `<option value="">—</option>`;
    $("docPatient").innerHTML = patientSelectOptions() || `<option value="">—</option>`;
  }

  $("patientSearch")?.addEventListener("input", renderPatients);

  function openPatient(id=null){
    editingPatientId = id;
    const isEdit = !!id;
    $("patientTitle").textContent = isEdit ? "Editar paciente" : "Novo paciente";
    $("patientDrawer").hidden = false;
    $("btnDeletePatient").hidden = !isEdit;

    const p = isEdit ? state.patients.find(x=>x.id===id) : null;
    $("p_name").value = p?.name || "";
    $("p_phone").value = p?.phone || "";
    $("p_birth").value = p?.birth || "";
    $("p_doc").value = p?.doc || "";
    $("p_notes").value = p?.notes || "";
  }

  function closePatient(){
    $("patientDrawer").hidden = true;
    editingPatientId = null;
  }

  $("btnNewPatient")?.addEventListener("click", ()=> openPatient(null));
  $("btnClosePatient")?.addEventListener("click", closePatient);

  $("btnSavePatient")?.addEventListener("click", async ()=>{
    const name = $("p_name").value.trim();
    if(!name) return;
    const payload = {
      name,
      phone: $("p_phone").value.trim(),
      birth: $("p_birth").value,
      doc: $("p_doc").value.trim(),
      notes: $("p_notes").value.trim()
    };
    if(editingPatientId){
      const idx = state.patients.findIndex(x=>x.id===editingPatientId);
      if(idx>=0) state.patients[idx] = { ...state.patients[idx], ...payload, updatedAt: isoNow() };
    } else {
      state.patients.push({ id: uid(), ...payload, createdAt: isoNow(), updatedAt: isoNow() });
    }
    await persist();
    renderPatients();
    closePatient();
  });

  $("btnDeletePatient")?.addEventListener("click", async ()=>{
    if(!editingPatientId) return;
    const pid = editingPatientId;
    state.patients = state.patients.filter(p=>p.id!==pid);
    state.appts = state.appts.filter(a=>a.patientId!==pid);
    state.entries = state.entries.filter(e=>e.patientId!==pid);

    // remove rx metadata + blobs
    const rxToRemove = state.rx.filter(r=>r.patientId===pid).map(r=>r.id);
    state.rx = state.rx.filter(r=>r.patientId!==pid);
    await persist();
    for(const id of rxToRemove){
      await idbDel(STORE_IMG, id);
    }
    renderAll();
    closePatient();
  });

  // ---------- Agenda ----------
  let editingApptId = null;

  function fillPatientsForAppt(){
    $("a_patient").innerHTML = patientSelectOptions() || `<option value="">—</option>`;
  }

  function renderAgenda(){
    const d = $("agendaDate").value || todayISO();
    const list = state.appts.filter(a=>a.date===d).sort((a,b)=> (a.time||"").localeCompare(b.time||""));

    $("agendaList").innerHTML = list.length ? list.map(a=>{
      const p = state.patients.find(x=>x.id===a.patientId);
      return `<div class="row">
        <div>
          <div class="cellMain">${escapeHtml(a.time||"")}</div>
          <div class="cellSub">${escapeHtml(p?.name || "")}</div>
        </div>
        <div class="cellMuted">${escapeHtml(a.status||"")}</div>
        <div class="cellMuted">${escapeHtml(a.reason||"")}</div>
        <div class="cellActions">
          <button class="btn" data-edit-a="${a.id}">Editar</button>
        </div>
      </div>`;
    }).join("") : "";

    qsa("[data-edit-a]").forEach(b=> b.addEventListener("click", ()=> openAppt(b.dataset.editA)));
    fillPatientsForAppt();
  }

  $("agendaDate")?.addEventListener("change", renderAgenda);

  function openAppt(id=null){
    editingApptId = id;
    const isEdit = !!id;
    $("apptTitle").textContent = isEdit ? "Editar agendamento" : "Novo agendamento";
    $("apptDrawer").hidden = false;
    $("btnDeleteAppt").hidden = !isEdit;

    fillPatientsForAppt();

    const a = isEdit ? state.appts.find(x=>x.id===id) : null;
    $("a_date").value = a?.date || ($("agendaDate").value || todayISO());
    $("a_time").value = a?.time || "08:00";
    $("a_patient").value = a?.patientId || (state.patients[0]?.id || "");
    $("a_status").value = a?.status || "Confirmado";
    $("a_reason").value = a?.reason || "";
    $("a_notes").value = a?.notes || "";
  }

  function closeAppt(){
    $("apptDrawer").hidden = true;
    editingApptId = null;
  }

  $("btnNewAppt")?.addEventListener("click", ()=> openAppt(null));
  $("btnCloseAppt")?.addEventListener("click", closeAppt);

  $("btnSaveAppt")?.addEventListener("click", async ()=>{
    const patientId = $("a_patient").value;
    if(!patientId) return;
    const payload = {
      date: $("a_date").value || todayISO(),
      time: $("a_time").value,
      patientId,
      status: $("a_status").value,
      reason: $("a_reason").value.trim(),
      notes: $("a_notes").value.trim()
    };
    if(editingApptId){
      const idx = state.appts.findIndex(x=>x.id===editingApptId);
      if(idx>=0) state.appts[idx] = { ...state.appts[idx], ...payload, updatedAt: isoNow() };
    } else {
      state.appts.push({ id: uid(), ...payload, createdAt: isoNow(), updatedAt: isoNow() });
    }
    await persist();
    renderAgenda();
    closeAppt();
  });

  $("btnDeleteAppt")?.addEventListener("click", async ()=>{
    if(!editingApptId) return;
    state.appts = state.appts.filter(a=>a.id!==editingApptId);
    await persist();
    renderAgenda();
    closeAppt();
  });

  // ---------- Record (entries + rx) ----------
  let editingEntryId = null;

  function currentPatientId(){
    return $("recordPatient").value || state.patients[0]?.id || "";
  }

  function renderRecord(){
    $("recordPatient").innerHTML = patientSelectOptions() || `<option value="">—</option>`;
    if(!$("recordPatient").value && state.patients[0]) $("recordPatient").value = state.patients[0].id;

    const pid = currentPatientId();
    const list = state.entries.filter(e=>e.patientId===pid).sort((a,b)=> (b.date||"").localeCompare(a.date||"") || (b.updatedAt||"").localeCompare(a.updatedAt||""));

    $("entries").innerHTML = list.length ? list.map(e=>{
      return `<div class="entry">
        <div class="entryTop">
          <div class="entryTag">${escapeHtml(e.type||"")}</div>
          <div class="entryDate">${escapeHtml(fmtDate(e.date||""))}</div>
        </div>
        <div class="entryText">${escapeHtml(e.text||"")}</div>
        <div class="entryActions">
          <button class="btn" data-edit-e="${e.id}">Editar</button>
        </div>
      </div>`;
    }).join("") : "";

    qsa("[data-edit-e]").forEach(b=> b.addEventListener("click", ()=> openEntry(b.dataset.editE)));

    renderRxGallery(pid);
  }

  $("recordPatient")?.addEventListener("change", renderRecord);

  function openEntry(id=null){
    editingEntryId = id;
    const isEdit = !!id;
    $("entryTitle").textContent = isEdit ? "Editar evolução" : "Nova evolução";
    $("entryDrawer").hidden = false;
    $("btnDeleteEntry").hidden = !isEdit;

    const e = isEdit ? state.entries.find(x=>x.id===id) : null;
    $("e_date").value = e?.date || todayISO();
    $("e_type").value = e?.type || "Consulta";
    $("e_text").value = e?.text || "";
  }
  function closeEntry(){ $("entryDrawer").hidden = true; editingEntryId = null; }
  $("btnAddEntry")?.addEventListener("click", ()=> openEntry(null));
  $("btnCloseEntry")?.addEventListener("click", closeEntry);

  $("btnSaveEntry")?.addEventListener("click", async ()=>{
    const pid = currentPatientId();
    if(!pid) return;
    const payload = {
      patientId: pid,
      date: $("e_date").value || todayISO(),
      type: $("e_type").value,
      text: $("e_text").value.trim()
    };
    if(editingEntryId){
      const idx = state.entries.findIndex(x=>x.id===editingEntryId);
      if(idx>=0) state.entries[idx] = { ...state.entries[idx], ...payload, updatedAt: isoNow() };
    } else {
      state.entries.push({ id: uid(), ...payload, createdAt: isoNow(), updatedAt: isoNow() });
    }
    await persist();
    renderRecord();
    closeEntry();
  });

  $("btnDeleteEntry")?.addEventListener("click", async ()=>{
    if(!editingEntryId) return;
    state.entries = state.entries.filter(e=>e.id!==editingEntryId);
    await persist();
    renderRecord();
    closeEntry();
  });

  // Radiographs
  async function addRxFiles(files){
    const pid = currentPatientId();
    if(!pid) return;
    for(const f of files){
      const id = uid();
      await idbPut(STORE_IMG, id, f); // Blob
      state.rx.push({ id, patientId: pid, name: f.name || "imagem", mime: f.type || "image/*", createdAt: isoNow() });
    }
    await persist();
    renderRecord();
  }

  $("rxInput")?.addEventListener("change", async (e)=>{
    const files = Array.from(e.target.files || []);
    if(files.length) await addRxFiles(files);
    e.target.value = "";
  });

  async function renderRxGallery(pid){
    const list = state.rx.filter(r=>r.patientId===pid).sort((a,b)=> (b.createdAt||"").localeCompare(a.createdAt||""));
    if(!list.length){ $("rxGallery").innerHTML = ""; return; }

    // build thumbs with object URLs
    const items = [];
    for(const r of list){
      const blob = await idbGet(STORE_IMG, r.id);
      const url = blob ? URL.createObjectURL(blob) : "";
      items.push({ ...r, url });
    }

    $("rxGallery").innerHTML = items.map(x=>`
      <div class="thumb">
        <img src="${x.url}" alt="${escapeHtml(x.name)}" />
        <div class="tActions">
          <button class="pillBtn" data-open-rx="${x.id}">Abrir</button>
          <button class="pillBtn" data-del-rx="${x.id}">Excluir</button>
        </div>
      </div>
    `).join("");

    qsa("[data-open-rx]").forEach(b=> b.addEventListener("click", async ()=>{
      const id = b.dataset.openRx;
      const meta = state.rx.find(r=>r.id===id);
      const blob = await idbGet(STORE_IMG, id);
      if(!blob) return;
      const url = URL.createObjectURL(blob);
      const w = window.open("");
      if(!w) return;
      w.document.write(`<title>${escapeHtml(meta?.name||"Imagem")}</title><img src="${url}" style="margin:0;max-width:100%;height:auto;display:block"/>`);
    }));

    qsa("[data-del-rx]").forEach(b=> b.addEventListener("click", async ()=>{
      const id = b.dataset.delRx;
      state.rx = state.rx.filter(r=>r.id!==id);
      await persist();
      await idbDel(STORE_IMG, id);
      renderRecord();
    }));
  }

  // ---------- Documents ----------
  let docDraft = {}; // current doc fields
  const DOC_FIELDS = {
    rx: [
      { k:"meds", label:"Medicamentos (um por linha)", type:"textarea", rows:8 },
      { k:"orient", label:"Orientações", type:"textarea", rows:6 }
    ],
    fc: [
      { k:"anam", label:"Anamnese", type:"textarea", rows:6 },
      { k:"exame", label:"Exame clínico", type:"textarea", rows:6 },
      { k:"dx", label:"Hipótese diagnóstica", type:"textarea", rows:4 },
      { k:"cond", label:"Conduta", type:"textarea", rows:6 }
    ],
    at: [
      { k:"dias", label:"Dias de afastamento", type:"text" },
      { k:"cid", label:"CID (opcional)", type:"text" },
      { k:"texto", label:"Texto", type:"textarea", rows:8 }
    ],
    or: [
      { k:"itens", label:"Itens do orçamento (um por linha)", type:"textarea", rows:10 },
      { k:"obs", label:"Observações", type:"textarea", rows:5 }
    ]
  };

  function patientById(id){ return state.patients.find(p=>p.id===id); }

  function renderDocs(){
    $("docPatient").innerHTML = patientSelectOptions() || `<option value="">—</option>`;
    if(!$("docPatient").value && state.patients[0]) $("docPatient").value = state.patients[0].id;
    updatePaperHeader();
    renderDocFields();
    renderPaper();
  }

  function updatePaperHeader(){
    const s = state.settings;
    $("profName").textContent = s.profName || "Profissional";
    const parts = [s.profReg, s.profPhone, s.profEmail].filter(Boolean).join(" • ");
    $("profMeta").textContent = parts || "Registro • Contato";
    $("paperPlace").textContent = s.place || "Belém – PA";
    $("paperDate").textContent = fmtDate(todayISO());
  }

  function renderDocFields(){
    const type = $("docType").value;
    const fields = DOC_FIELDS[type];
    $("docFields").innerHTML = fields.map(f=>{
      if(f.type==="textarea"){
        return `<label class="lbl">${escapeHtml(f.label)}</label>
                <textarea class="field area" id="df_${f.k}" rows="${f.rows||4}"></textarea>`;
      }
      return `<label class="lbl">${escapeHtml(f.label)}</label>
              <input class="field" id="df_${f.k}" />`;
    }).join("");

    // load last draft per type
    docDraft = (state._docDrafts?.[type]) || {};
    fields.forEach(f=>{
      const el = $("df_"+f.k);
      if(el) el.value = docDraft[f.k] || "";
      el?.addEventListener("input", ()=>{
        docDraft[f.k] = el.value;
        renderPaper();
      });
    });
    renderPaper();
  }

  $("docType")?.addEventListener("change", ()=>{
    renderDocFields();
    renderPaper();
  });
  $("docPatient")?.addEventListener("change", renderPaper);

  $("btnSaveDoc")?.addEventListener("click", async ()=>{
    const type = $("docType").value;
    state._docDrafts = state._docDrafts || {};
    state._docDrafts[type] = docDraft;
    await persist();
  });

  function renderPaper(){
    updatePaperHeader();
    const type = $("docType").value;
    const pid = $("docPatient").value;
    const p = patientById(pid);

    const titleMap = { rx:"Receituário", fc:"Ficha Clínica", at:"Atestado", or:"Orçamento" };
    $("paperDocType").textContent = titleMap[type] || "Documento";

    const patientLine = p ? `<div class="box"><b>Paciente:</b> ${escapeHtml(p.name||"")}<br/>
      <span class="mut">Telefone:</span> ${escapeHtml(p.phone||"")} &nbsp; <span class="mut">Documento:</span> ${escapeHtml(p.doc||"")}</div>` : "";

    if(type==="rx"){
      const meds = (docDraft.meds||"").trim();
      const orient = (docDraft.orient||"").trim();
      $("paperBody").innerHTML = `
        ${patientLine}
        <h3>Prescrição</h3>
        <div class="box">${escapeHtml(meds).replace(/\n/g,"<br/>")}</div>
        <h3 style="margin-top:14px">Orientações</h3>
        <div class="box">${escapeHtml(orient).replace(/\n/g,"<br/>")}</div>
      `;
      return;
    }
    if(type==="fc"){
      $("paperBody").innerHTML = `
        ${patientLine}
        <h3>Anamnese</h3><div class="box">${escapeHtml((docDraft.anam||"").trim()).replace(/\n/g,"<br/>")}</div>
        <h3 style="margin-top:14px">Exame clínico</h3><div class="box">${escapeHtml((docDraft.exame||"").trim()).replace(/\n/g,"<br/>")}</div>
        <h3 style="margin-top:14px">Hipótese diagnóstica</h3><div class="box">${escapeHtml((docDraft.dx||"").trim()).replace(/\n/g,"<br/>")}</div>
        <h3 style="margin-top:14px">Conduta</h3><div class="box">${escapeHtml((docDraft.cond||"").trim()).replace(/\n/g,"<br/>")}</div>
      `;
      return;
    }
    if(type==="at"){
      const dias = (docDraft.dias||"").trim();
      const cid = (docDraft.cid||"").trim();
      const texto = (docDraft.texto||"").trim();
      $("paperBody").innerHTML = `
        ${patientLine}
        <h3>Declaração</h3>
        <div class="box">
          Declaro para os devidos fins que o(a) paciente acima foi atendido(a) nesta data, necessitando de afastamento por <b>${escapeHtml(dias||"__")}</b> dia(s).
          ${cid?`<br/><span class="mut">CID:</span> ${escapeHtml(cid)}`:""}
        </div>
        <h3 style="margin-top:14px">Observação</h3>
        <div class="box">${escapeHtml(texto).replace(/\n/g,"<br/>")}</div>
        <div style="margin-top:26px; display:flex; justify-content:flex-end">
          <div style="text-align:center; width:240px">
            <div style="height:1px; background:rgba(0,0,0,.35); margin-bottom:8px"></div>
            <div><b>${escapeHtml(state.settings.profName||"Profissional")}</b></div>
            <div class="mut" style="margin-top:2px">${escapeHtml(state.settings.profReg||"")}</div>
          </div>
        </div>
      `;
      return;
    }
    if(type==="or"){
      const itens = (docDraft.itens||"").trim();
      const obs = (docDraft.obs||"").trim();
      $("paperBody").innerHTML = `
        ${patientLine}
        <h3>Itens</h3>
        <div class="box">${escapeHtml(itens).replace(/\n/g,"<br/>")}</div>
        <h3 style="margin-top:14px">Observações</h3>
        <div class="box">${escapeHtml(obs).replace(/\n/g,"<br/>")}</div>
      `;
      return;
    }
  }

  $("btnPrintDoc")?.addEventListener("click", ()=> window.print());
  $("btnQuickPrint")?.addEventListener("click", ()=> window.print());

  // ---------- Backup ----------
  async function exportBackup(){
    // include images as base64 for portability
    const backup = JSON.parse(JSON.stringify(state));
    backup._images = [];
    for(const rx of state.rx){
      const blob = await idbGet(STORE_IMG, rx.id);
      if(!blob) continue;
      const dataURL = await blobToDataURL(blob);
      backup._images.push({ id: rx.id, dataURL, name: rx.name, mime: rx.mime, patientId: rx.patientId, createdAt: rx.createdAt });
    }
    return backup;
  }

  async function importBackup(obj){
    if(!obj || typeof obj !== "object") return false;

    // basic shape
    obj.settings = { ...DEFAULT_SETTINGS, ...(obj.settings||{}) };
    obj.patients ??= [];
    obj.appts ??= [];
    obj.entries ??= [];
    obj.rx ??= [];
    obj.meta ??= obj.meta || { version:"1.0", createdAt: isoNow(), updatedAt: isoNow() };

    // wipe image store then restore
    const keys = await idbKeys(STORE_IMG);
    for(const k of keys) await idbDel(STORE_IMG, k);

    if(Array.isArray(obj._images)){
      // put blobs
      for(const im of obj._images){
        if(!im?.id || !im?.dataURL) continue;
        const blob = await dataURLToBlob(im.dataURL);
        await idbPut(STORE_IMG, im.id, blob);
      }
    }
    delete obj._images;
    state = obj;
    await persist();
    applyBrand();
    hydrateUI();
    renderAll();
    return true;
  }

  function updateBackupInfo(){
    const stats = {
      pacientes: state.patients.length,
      agenda: state.appts.length,
      evolucoes: state.entries.length,
      imagens: state.rx.length,
      atualizado: state.meta.updatedAt
    };
    $("backupInfo").textContent = JSON.stringify(stats, null, 2);
  }

  $("btnExport")?.addEventListener("click", async ()=>{
    const obj = await exportBackup();
    const blob = new Blob([JSON.stringify(obj)], { type:"application/json" });
    const a = document.createElement("a");
    const ts = isoNow().replace(/[:.]/g,"-");
    a.href = URL.createObjectURL(blob);
    a.download = `BTX-Backup-${ts}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("importFile")?.addEventListener("change", async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    try{
      const text = await file.text();
      const obj = JSON.parse(text);
      await importBackup(obj);
    }catch(_){}
    e.target.value = "";
  });

  $("btnWipe")?.addEventListener("click", async ()=>{
    // wipe state + images
    state = emptyState();
    const keys = await idbKeys(STORE_IMG);
    for(const k of keys) await idbDel(STORE_IMG, k);
    await persist();
    applyBrand();
    hydrateUI();
    renderAll();
  });

  // ---------- Global renders ----------
  function renderAll(){
    renderPatients();
    renderAgenda();
    renderRecord();
    renderDocs();
    updateBackupInfo();
  }

  // ---------- Init ----------
  load();
})();
