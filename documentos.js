/* =====================================================================
   Sira Propiedades: documentos y archivos de cada propiedad
   - carpeta de documentos legales (paso 2 del seguimiento), con casilleros y vigencia
   - repertorio de archivos (contratos, acta de ingreso, otros)
   - expediente de las propiedades vendidas o arrendadas
   - los mismos documentos se ven desde la pestaña Administración
   Todo vive en el almacenamiento PRIVADO "documentos": los archivos se abren
   con enlaces temporales y solo los ve quien tiene permiso (reglas en la base).
   ===================================================================== */
(() => {
const X = window.PANEL; if (!X) return;
const { $, $$, esc, sb } = X;
const yo = () => X.yo();

/* ---------------- lo que se pide en cada operación ---------------- */
/* quien: 'ambos' = lo puede sacar Sira o el propietario · 'propietario' = solo el propietario · '' = no aplica.
   tope: lo máximo que cuesta sacarlo (redondeado hacia arriba); 0 = gratis; null = no tiene costo propio. */
const DOCS = {
  venta: [
    { k:'dominio',      t:'Certificado de dominio vigente',                  d:'Conservador de Bienes Raíces',                quien:'ambos',       tope:10000 },
    { k:'hipotecas',    t:'Certificado de hipotecas y gravámenes',           d:'Conservador de Bienes Raíces',                quien:'ambos',       tope:9000 },
    { k:'recepcion',    t:'Certificado de recepción final',                  d:'Dirección de Obras Municipales',              quien:'ambos',       tope:4000 },
    { k:'noexp_dom',    t:'Certificado de no expropiación (municipal)',      d:'Dirección de Obras Municipales',              quien:'ambos',       tope:9000 },
    { k:'noexp_serviu', t:'Certificado de no expropiación (SERVIU)',         d:'SERVIU',                                      quien:'ambos',       tope:0 },
    { k:'deudas',       t:'Certificado de deudas',                           d:'',                                            quien:'propietario', tope:0 },
    { k:'avaluo',       t:'Certificado de avalúo fiscal',                    d:'Servicio de Impuestos Internos',              quien:'propietario', tope:0 },
    { k:'cip',          t:'Certificado de informaciones previas (CIP)',      d:'Solo terrenos y propiedades comerciales',     quien:'propietario', tope:15000 },
    { k:'estado_civil', t:'Certificado de estado civil',                     d:'Registro Civil',                              quien:'propietario', tope:6000 }
  ],
  arriendo: [
    { k:'dominio',      t:'Certificado de dominio vigente',                  d:'Conservador de Bienes Raíces',                quien:'ambos',       tope:10000 },
    { k:'mandato',      t:'Mandato de arriendo',                             d:'Contrato entre el propietario y Sira que autoriza arrendar. La orden de arriendo se sube aquí como archivo adicional.', quien:'', tope:null }
  ]
};
const CATS = [
  { k:'contrato_arriendo',    t:'Contrato de arriendo',    op:'arriendo' },
  { k:'contrato_compraventa', t:'Contrato de compraventa', op:'venta' },
  { k:'acta_ingreso',         t:'Acta de ingreso' },
  { k:'otros',                t:'Otros' }
];
const LIMITE = 10 * 1024 * 1024;     /* 10 MB por archivo (igual que el límite del almacenamiento) */
const POR_VENCER = 5;                /* días hábiles que faltan para avisar en amarillo */
const TIPOS = {
  pdf:  'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  doc:  'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};
const EXT_DE = m => ({ 'application/pdf':'pdf', 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'application/msword':'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx' }[m] || '');

/* ---------------- fechas (días hábiles: lunes a viernes, sin descontar feriados) ---------------- */
const hoyD = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const deIso = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const fCorta = d => d.toLocaleDateString('es-CL', { day:'numeric', month:'short', year:'numeric' });
function sumarHabiles(desde, n){
  const d = new Date(desde); let k = 0;
  while (k < n){ d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) k++; }
  return d;
}
function habilesHasta(desde, hasta){      /* cuántos días hábiles faltan (contando desde mañana) */
  const d = new Date(desde); let n = 0;
  while (d < hasta){ d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}
const pesos = n => '$' + SIRA.num(n);
const mb = n => n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

/* ---------------- estado ---------------- */
let EST = {}, ARCH = [], OK = true;      /* OK=false: la base todavía no tiene las tablas nuevas */
const CTRS = {};                         /* contratos de Administración que mostraron su carpeta */
let EDIT_VIG = null, CONF = false, EXP = null, SUBIENDO = null;
const ABIERTOS = {};     /* qué bloques están desplegados (por defecto vienen plegados, menos en el expediente) */
const puedeAlgo = () => !!yo() && ['dueno','gerente','corredor','asistente'].includes(yo().rol);
const puedeConf = () => !!yo() && ['dueno','gerente'].includes(yo().rol);
const verProp = (p, via) => {
  const r = yo() && yo().rol;
  if (['dueno','gerente','asistente'].includes(r)) return true;
  if (r === 'corredor') return !!via || !!(p && p.creada_por === yo().id);
  return false;
};
const opDe = p => p && p.operacion === 'Venta' ? 'venta' : p && p.operacion === 'Arriendo' ? 'arriendo' : null;
const vigGeneral = () => { const v = X.config().vigencias; return v && typeof v === 'object' ? v : {}; };
const filaEst = (pid, op, k) => EST[pid + '|' + op + '|' + k];

X.GANCHOS.cargar.push(async () => {
  EST = {}; ARCH = []; OK = true;
  if (!puedeAlgo()) return;
  try{
    const [de, ar] = await Promise.all([
      X.todo(() => sb.from('doc_estado').select('*').order('propiedad_id').order('operacion').order('clave')),
      X.todo(() => sb.from('archivos').select('*').order('subido_en', { ascending:false }).order('id'))
    ]);
    de.forEach(f => EST[f.propiedad_id + '|' + f.operacion + '|' + f.clave] = f);
    ARCH = ar;
  }catch(e){ OK = false; console.warn('Documentos: falta ejecutar la actualización de la base de datos.', e); }
});
X.GANCHOS.refrescar.push(id => { if (id === 'v-exp') pintarExp(); else repintar(); });

/* ---------------- vigencia de cada documento ---------------- */
function vigDe(op, k, fila){
  if (fila && fila.vigencia_dias != null) return fila.vigencia_dias === 0 ? { modo:'nove', puntual:true } : { modo:'dias', dias:fila.vigencia_dias, puntual:true };
  const g = vigGeneral()[k];
  if (g == null || g === '') return { modo:'indef' };
  return +g === 0 ? { modo:'nove' } : { modo:'dias', dias:+g };
}
/* estado de un documento: pendiente, recibido (vigente / por vencer / vencido) o no aplica */
function estadoDoc(op, def, fila){
  const est = fila ? fila.estado : 'pendiente';
  if (est === 'na') return { k:'na', txt:'No aplica', cuenta:false };
  if (est !== 'recibido') return { k:'pend', txt:'Pendiente', cuenta:false };
  const v = vigDe(op, def.k, fila);
  if (v.modo === 'nove') return { k:'ok', txt:'Recibido · No vence', cuenta:true, v };
  if (v.modo === 'indef') return { k:'ok', txt:'Recibido · Define la vigencia', cuenta:true, v, aviso:true };
  const em = deIso(fila && fila.emitido);
  if (!em) return { k:'ok', txt:'Recibido · Falta la fecha de emisión', cuenta:true, v, aviso:true };
  const vence = sumarHabiles(em, v.dias), hoy = hoyD();
  if (hoy > vence) return { k:'venc', txt:'Vencido el ' + fCorta(vence) + ' · volver a sacar', cuenta:false, v, vence };
  const rest = habilesHasta(hoy, vence);
  if (rest <= POR_VENCER) return { k:'pronto', txt:'Vence el ' + fCorta(vence) + (rest ? ' (' + rest + (rest === 1 ? ' día hábil' : ' días hábiles') + ')' : ' (hoy)'), cuenta:true, v, vence };
  return { k:'ok', txt:'Vigente hasta el ' + fCorta(vence), cuenta:true, v, vence };
}
function conteo(pid, op){
  let tot = 0, ok = 0, venc = 0, tope = 0;
  (DOCS[op] || []).forEach(def => {
    const s = estadoDoc(op, def, filaEst(pid, op, def.k));
    if (s.k === 'na') return;
    tot++; if (s.cuenta) ok++; if (s.k === 'venc') venc++;
    if (def.quien === 'ambos' && def.tope) tope += def.tope;
  });
  return { tot, ok, venc, tope };
}
const textoVig = (s, fila) => {
  if (!s.v) return '';
  const o = s.v.puntual ? ' (solo para esta propiedad)' : '';
  return s.v.modo === 'nove' ? 'No vence' + o : s.v.modo === 'dias' ? 'Vigencia: ' + s.v.dias + (s.v.dias === 1 ? ' día hábil' : ' días hábiles') + o : 'Define la vigencia';
};

/* ---------------- guardar casilleros ---------------- */
const GUARDANDO = new Set();
async function guardarEst(pid, op, k, cambios){
  const llave = pid + '|' + op + '|' + k;
  if (GUARDANDO.has(llave)) return;
  GUARDANDO.add(llave);
  const antes = EST[llave] ? { ...EST[llave] } : null;
  EST[llave] = { estado:'pendiente', emitido:null, vigencia_dias:null, ...(antes || {}), propiedad_id:pid, operacion:op, clave:k, ...cambios, actualizada:new Date().toISOString(), actualizada_por:yo().id };
  repintar();
  const fila = { propiedad_id:pid, operacion:op, clave:k, ...cambios };
  const { data, error } = await sb.from('doc_estado').upsert(fila, { onConflict:'propiedad_id,operacion,clave' }).select();
  GUARDANDO.delete(llave);
  if (error || !data || !data.length){
    if (antes) EST[llave] = antes; else delete EST[llave];
    X.toast(X.errTxt(error || new Error('permission denied')), true);
  } else EST[llave] = data[0];
  repintar();
}

/* ---------------- piezas de pantalla ---------------- */
const wrap = (scope, tipo, inner, extra) => `<div class="dc-w" data-dscope="${esc(scope)}" data-dtipo="${tipo}"${extra || ''}>${inner}</div>`;
const AVISO_BD = `<div class="dc-box dc-aviso"><b>Documentos y archivos</b><p>Falta ejecutar la actualización de la base de datos. Abre <i>supabase/actualizacion-documentos-papelera.sql</i>, pégalo en Supabase → SQL Editor y toca Run. Después toca "Actualizar".</p></div>`;
const AVISO_PERM = `<div class="dc-box dc-aviso"><b>Documentos y archivos</b><p>Los documentos de esta propiedad solo los ven quien la creó, el gerente y el dueño.</p></div>`;

function archivosDe(scope, cid){
  const t = scope[0], id = scope.slice(2);
  return ARCH.filter(a => (t === 'p' ? a.propiedad_id === id : a.contrato_id === id) || (cid && a.contrato_id === cid));
}
function itemArchivo(a){
  const mio = yo() && a.subido_por === yo().id, quien = mio ? 'tú' : X.nombreDe(a.subido_por);
  const puedeQuitar = ['dueno','gerente'].includes(yo().rol) || mio;
  return `<li class="dc-f"><button type="button" class="dc-fn" data-d="abrir" data-id="${esc(a.id)}" title="Abrir (el enlace dura 2 minutos)">${esc(a.nombre)}</button>
    <small>${a.etiqueta ? esc(a.etiqueta) + ' · ' : ''}${esc(X.fecha(a.subido_en))}${a.tamano ? ' · ' + mb(a.tamano) : ''}${quien ? ' · ' + esc(quien) : ''}</small>
    ${puedeQuitar ? `<button type="button" class="dc-x" data-d="del-arch" data-id="${esc(a.id)}" aria-label="Quitar ${esc(a.nombre)}" title="Quitar">&times;</button>` : ''}</li>`;
}

/* carpeta de documentos legales */
function carpetaInner(pid, op, o){
  o = o || {};
  const defs = DOCS[op]; if (!defs) return '';
  const c = conteo(pid, op), ro = !!o.lectura;
  const llave = 'car|' + pid + '|' + (o.ctx || 'seg'), ab = llave in ABIERTOS ? ABIERTOS[llave] : !!o.abierto;
  const pct = c.tot ? Math.round(c.ok * 100 / c.tot) : 0;
  const filas = defs.map(def => {
    const f = filaEst(pid, op, def.k), s = estadoDoc(op, def, f);
    const key = pid + '|' + op + '|' + def.k;
    const adj = ARCH.filter(a => a.propiedad_id === pid && a.categoria === 'legal' && a.doc_clave === def.k);
    const costo = def.tope === null ? '' : def.tope === 0 ? 'Gratis' : 'Hasta ' + pesos(def.tope);
    const quien = def.quien === 'ambos' ? 'Lo puede sacar Sira o el propietario' : def.quien === 'propietario' ? 'Solo el propietario' : '';
    const meta = [def.d, quien, costo].filter(Boolean).map(esc).join(' · ');
    const rec = f && f.estado === 'recibido';
    return `<li class="dc-doc ${s.k}" data-dop="${op}" data-dk="${esc(def.k)}">
      <button type="button" class="dc-ck" data-d="ck" ${ro ? 'disabled' : ''} aria-pressed="${rec && s.k !== 'venc'}" aria-label="${esc(def.t)}: ${esc(s.txt)}" title="${ro ? esc(s.txt) : rec ? 'Marcar como pendiente' : 'Marcar como recibido'}">${rec && s.k !== 'venc' ? '&#10003;' : ''}</button>
      <div class="dc-main">
        <div class="dc-t">${esc(def.t)}<span class="dc-b ${s.k}">${esc(s.txt)}</span></div>
        ${meta ? `<div class="dc-m">${meta}</div>` : ''}
        ${rec && !ro ? `<div class="dc-em"><label>Emitido el <input type="date" data-d="emitido" value="${esc(f.emitido || '')}" max="${iso(hoyD())}"></label>
          <span>${esc(textoVig(s, f))}</span> <button type="button" class="dc-l" data-d="vig" title="Cambiar la vigencia solo de este documento">Cambiar</button></div>` : ''}
        ${EDIT_VIG === key && !ro ? `<div class="dc-vig"><label>Días hábiles <input type="number" min="1" max="3650" step="1" data-d-vin value="${f && f.vigencia_dias ? esc(f.vigencia_dias) : ''}"></label>
          <button type="button" class="dc-l" data-d="vig-ok">Guardar</button><button type="button" class="dc-l" data-d="vig-nove">No vence</button>
          <button type="button" class="dc-l" data-d="vig-gen">Usar la general</button><button type="button" class="dc-l" data-d="vig-no">Cancelar</button></div>` : ''}
        ${adj.length ? `<ul class="dc-fs">${adj.map(itemArchivo).join('')}</ul>` : ''}
        ${ro ? '' : `<div class="dc-ac"><button type="button" class="dc-l" data-d="adj" data-cat="legal" data-clave="${esc(def.k)}">+ Adjuntar archivo</button>
          ${s.k === 'venc' ? '<button type="button" class="dc-l" data-d="resacar">Volver a sacar</button>' : ''}
          <button type="button" class="dc-l" data-d="na">${s.k === 'na' ? 'Sí aplica' : 'No aplica'}</button></div>`}
      </div></li>`;
  }).join('');
  const conf = !ro && puedeConf() ? `<button type="button" class="dc-l" data-d="conf">${CONF ? 'Cerrar vigencias' : 'Configurar vigencias'}</button>` : '';
  const todos = [];
  Object.values(DOCS).forEach(l => l.forEach(d => { if (!todos.some(x => x.k === d.k)) todos.push(d); }));
  const panelConf = CONF && !ro && puedeConf() ? `<div class="dc-conf"><p>Vigencia general de cada documento, en <b>días hábiles</b> (lunes a viernes, sin descontar feriados, así que puede quedar 1 o 2 días corto). Déjalo vacío si aún no lo defines y escribe <b>0</b> si no vence. Se aplica a todas las propiedades.</p>
    <div class="dc-cg">${todos.map(d => `<label><span>${esc(d.t)}</span><input type="number" min="0" max="3650" step="1" data-vk="${esc(d.k)}" value="${vigGeneral()[d.k] == null ? '' : esc(vigGeneral()[d.k])}"></label>`).join('')}</div>
    <div class="dc-ac"><button type="button" class="btn sm" data-d="conf-ok">Guardar vigencias</button></div></div>` : '';
  const tag = o.solo ? 'h2' : 'h3';
  return `<section class="${o.solo ? 'box' : 'dc-box'}">
    <div class="dc-h${o.solo ? ' dc-h2' : ''}"><${tag}>Carpeta de documentos${op === 'venta' ? ' de la venta' : ' del arriendo'}</${tag}>
      <span class="dc-c ${c.tot && c.ok === c.tot ? 'full' : ''}">${c.ok} de ${c.tot} ${c.tot === 1 ? 'recibido' : 'recibidos'}</span>
      <button type="button" class="dc-tg" data-d="plegar" data-key="${esc(llave)}" aria-expanded="${ab}">${ab ? 'Ocultar documentos' : 'Ver documentos'}</button></div>
    <div class="dc-bar"><i style="width:${pct}%"></i></div>
    ${c.venc ? `<p class="dc-warn">${c.venc} ${c.venc === 1 ? 'documento vencido: hay que volver a sacarlo' : 'documentos vencidos: hay que volver a sacarlos'} (no cuentan en el avance).</p>` : ''}
    ${ab ? `${c.tope ? `<p class="dc-m">Cotización: los que puede sacar Sira cuestan hasta <b>${pesos(c.tope)}</b> en total.</p>` : ''}
    ${conf ? `<div class="dc-ac" style="margin:0 0 8px">${conf}</div>` : ''}${panelConf}
    <ul class="dc-ds">${filas}</ul>` : ''}</section>`;
}

/* repertorio de archivos */
function archivosInner(scope, o){
  o = o || {};
  const all = archivosDe(scope, o.cid).filter(a => a.categoria !== 'legal'), ro = !!o.lectura;
  const llave = 'arc|' + scope + '|' + (o.ctx || 'seg'), ab = llave in ABIERTOS ? ABIERTOS[llave] : !!o.abierto;
  const cats = CATS.filter(c => !c.op || c.op === o.op || all.some(a => a.categoria === c.k));
  const bloques = cats.map(c => {
    const l = all.filter(a => a.categoria === c.k);
    return `<div class="dc-cat" data-dcat="${c.k}"><div class="dc-ch"><b>${esc(c.t)}</b><span>${l.length ? l.length + (l.length === 1 ? ' archivo' : ' archivos') : 'Sin archivos'}</span></div>
      ${l.length ? `<ul class="dc-fs">${l.map(itemArchivo).join('')}</ul>` : ''}
      ${ro ? '' : `<div class="dc-ac">${c.k === 'otros' ? '<input type="text" maxlength="60" data-d-nom placeholder="Nombre (ej: Certificado de matrimonio)" aria-label="Nombre del archivo de Otros">' : ''}
        <button type="button" class="dc-l" data-d="adj" data-cat="${c.k}">+ Subir archivo</button></div>`}</div>`;
  }).join('');
  return `<section class="box">
    <div class="dc-h2"><h2>${esc(o.titulo || 'Archivos')} <span class="dc-sub">· privado, solo el equipo con permiso</span></h2>
      <span class="dc-c">${all.length} ${all.length === 1 ? 'archivo' : 'archivos'}</span>
      <button type="button" class="dc-tg" data-d="plegar" data-key="${esc(llave)}" aria-expanded="${ab}">${ab ? 'Ocultar archivos' : 'Ver archivos'}</button></div>
    ${ab ? `<p class="hint" style="margin:0 0 12px">PDF, fotos (se achican solas) o Word, de hasta 10 MB cada uno. Se abren con un enlace temporal.</p>${bloques}` : ''}</section>`;
}

function ctrInner(c){
  const scope = c.propiedad_id ? 'p:' + c.propiedad_id : 'c:' + c.id;
  return (c.propiedad_id ? carpetaInner(c.propiedad_id, 'arriendo', { solo:true, ctx:'ctr' }) : '') +
         archivosInner(scope, { op:'arriendo', cid:c.id, titulo:'Archivos del arriendo', ctx:'ctr' });
}

/* expediente de una propiedad cerrada */
function expInner(p){
  const op = opDe(p), sc = 'p:' + p.id;
  const cierre = p.cerrada ? fCorta(new Date(p.cerrada)) : '—';
  const dato = (k, v) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`;
  return `<section class="box"><h2>Datos del cierre</h2>
      <dl class="dc-dl">${dato('Código', p.codigo)}${dato('Operación', p.operacion || '—')}${dato('Estado', (SIRA.ESTADOS[p.estado] || p.estado).replace(' (oculta)', ''))}
      ${dato(p.operacion === 'Venta' ? 'Precio de venta' : 'Precio de arriendo', SIRA.precioTxt(p))}${dato('Fecha de cierre', cierre)}${dato('Ubicación', [p.sector, p.comuna].filter(Boolean).join(', ') || '—')}</dl></section>` +
    archivosInner(sc, { op, titulo:'Contrato firmado, acta de ingreso y otros archivos', ctx:'exp', abierto:true }) +
    (op ? carpetaInner(p.id, op, { solo:true, ctx:'exp', abierto:true }) : '');
}

/* ---------------- piezas públicas para los otros módulos ---------------- */
function carpetaHTML(p){
  if (!puedeAlgo() || !opDe(p)) return '';
  if (!OK) return AVISO_BD;
  if (!verProp(p)) return AVISO_PERM;
  return wrap('p:' + p.id, 'carpeta', carpetaInner(p.id, opDe(p)));
}
function archivosHTML(p){
  if (!puedeAlgo() || !opDe(p)) return '';
  if (!OK) return '';
  if (!verProp(p)) return '';
  return wrap('p:' + p.id, 'arch', archivosInner('p:' + p.id, { op:opDe(p) }));
}
function ctrHTML(c){
  if (!puedeAlgo() || !c || !c.id) return '';
  CTRS[c.id] = c;
  if (!OK) return AVISO_BD;
  return wrap(c.propiedad_id ? 'p:' + c.propiedad_id : 'c:' + c.id, 'ctr', ctrInner(c), ' data-dcid="' + esc(c.id) + '"');
}
function render(w){
  const scope = w.dataset.dscope, id = scope.slice(2), tipo = w.dataset.dtipo;
  if (tipo === 'ctr'){ const c = CTRS[w.dataset.dcid]; return c ? wrap(scope, 'ctr', ctrInner(c), ' data-dcid="' + esc(c.id) + '"') : ''; }
  const p = X.porId(id); if (!p) return w.outerHTML;
  if (tipo === 'carpeta') return carpetaHTML(p);
  if (tipo === 'arch') return archivosHTML(p);
  if (tipo === 'exp') return wrap(scope, 'exp', expInner(p));
  return w.outerHTML;
}
function repintar(){
  $$('.dc-w').forEach(w => {
    /* si la persona está escribiendo en este bloque, no se le pisa el texto */
    if (w.contains(document.activeElement) && document.activeElement.matches('input[type=text], input[type=number]')) return;
    w.outerHTML = render(w);
  });
}

/* ---------------- expediente (pantalla) ---------------- */
function abrirExpediente(p){ EXP = p.id; pintarExp(); X.vista('exp'); }
function pintarExp(){
  const v = $('#v-exp'); if (!v) return;
  const p = EXP && X.porId(EXP);
  if (!p){ X.vista('list'); return; }
  if (!OK){ v.innerHTML = `<a href="#" data-a="volver" style="color:var(--mu);text-decoration:none">&larr; Volver a la lista</a><h1 style="margin-top:10px">Expediente · ${esc(p.codigo)}</h1>${AVISO_BD}`; return; }
  v.innerHTML = `<a href="#" data-a="volver" style="color:var(--mu);text-decoration:none">&larr; Volver a la lista</a>
    <h1 style="margin-top:10px">Expediente · ${esc(p.codigo)}</h1>
    <p class="sub">${esc(SIRA.titulo(p))} · ${esc(p.operacion || '')} · ${esc((SIRA.ESTADOS[p.estado] || p.estado).replace(' (oculta)', ''))}</p>
    ${verProp(p) ? wrap('p:' + p.id, 'exp', expInner(p)) : AVISO_PERM}`;
}
$('#v-exp') && $('#v-exp').addEventListener('click', e => {
  const a = e.target.closest('[data-a=volver]'); if (!a) return;
  e.preventDefault(); EXP = null; X.vista('list');
});

/* ---------------- subir, abrir y quitar archivos ---------------- */
const tipoDe = f => {
  const ext = (String(f.name).split('.').pop() || '').toLowerCase();
  const m = Object.values(TIPOS).includes(f.type) ? f.type : TIPOS[ext];
  return m || '';
};
function comprimir(file){
  return new Promise(ok => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return ok(file);
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 2000 / Math.max(img.width, img.height));
      if (k === 1 && file.size < 900 * 1024){ URL.revokeObjectURL(url); return ok(file); }
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => { URL.revokeObjectURL(url); ok(b && b.size < file.size ? b : file); }, 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); ok(file); };
    img.src = url;
  });
}
async function subir(scope, cat, etiqueta, clave, archivos){
  const t = scope[0], id = scope.slice(2);
  let ok = 0;
  X.overlay(true, 'Subiendo…');
  try{
    for (const f0 of archivos){
      const mime0 = tipoDe(f0);
      if (!mime0){ X.toast('"' + f0.name + '": solo se aceptan PDF, fotos (JPG, PNG, WEBP) o Word.', true); continue; }
      X.overlay(true, 'Subiendo…', f0.name);
      const f = await comprimir(f0.type ? f0 : new File([f0], f0.name, { type:mime0 }));
      const mime = f.type || mime0;
      if (f.size > LIMITE){ X.toast('"' + f0.name + '" pesa ' + mb(f.size) + ' y el máximo es 10 MB.', true); continue; }
      const ruta = t + '/' + id + '/' + X.rid() + '.' + (EXT_DE(mime) || 'bin');
      const up = await sb.storage.from('documentos').upload(ruta, f, { contentType:mime, upsert:false, cacheControl:'3600' });
      if (up.error) throw up.error;
      const fila = { [t === 'p' ? 'propiedad_id' : 'contrato_id']: id, categoria:cat, etiqueta:etiqueta || null, doc_clave:clave || null,
        nombre:f0.name.slice(0, 200), ruta, tamano:f.size, tipo:mime };
      const { data, error } = await sb.from('archivos').insert(fila).select();
      if (error || !data || !data.length){ sb.storage.from('documentos').remove([ruta]).catch(() => {}); throw error || new Error('permission denied'); }
      ARCH.unshift(data[0]); ok++;
    }
    if (ok) X.toast(ok === 1 ? 'Archivo guardado.' : ok + ' archivos guardados.');
  }catch(err){ X.toast(X.errTxt(err), true); }
  finally{ X.overlay(false); repintar(); }
}
async function abrirArchivo(id){
  const a = ARCH.find(x => x.id === id); if (!a) return;
  const w = window.open('', '_blank');
  try{
    const { data, error } = await sb.storage.from('documentos').createSignedUrl(a.ruta, 120);
    if (error || !data) throw error || new Error('No se pudo abrir el archivo.');
    if (w){ w.opener = null; w.location.href = data.signedUrl; } else window.open(data.signedUrl, '_blank', 'noopener');
  }catch(err){ if (w) w.close(); X.toast(X.errTxt(err), true); }
}
async function quitarArchivo(id){
  const a = ARCH.find(x => x.id === id); if (!a) return;
  if (!confirm('¿Quitar "' + a.nombre + '"? Se borra para siempre.')) return;
  X.overlay(true, 'Quitando…');
  try{
    const { data, error } = await sb.from('archivos').delete().eq('id', id).select();
    if (error) throw error; if (!data || !data.length) throw new Error('permission denied');
    ARCH = ARCH.filter(x => x.id !== id);
    sb.storage.from('documentos').remove([a.ruta]).catch(() => {});
    X.toast('Archivo quitado.');
  }catch(err){ X.toast(X.errTxt(err), true); }
  finally{ X.overlay(false); repintar(); }
}

/* para borrar una propiedad o un contrato para siempre: primero se sacan sus archivos del almacenamiento */
async function rutasDe(campo, id){
  try{ const { data } = await sb.from('archivos').select('ruta').eq(campo, id); return (data || []).map(x => x.ruta); }catch(e){ return []; }
}
const quitarRutas = rutas => rutas && rutas.length ? sb.storage.from('documentos').remove(rutas).catch(() => {}) : Promise.resolve();
function resumen(pid){
  return { archivos: ARCH.filter(a => a.propiedad_id === pid).length,
           docs: Object.keys(EST).filter(k => k.startsWith(pid + '|') && EST[k].estado === 'recibido').length };
}

/* ---------------- clics y cambios ---------------- */
const entrada = () => {
  let i = $('#dc-file');
  if (!i){
    i = document.createElement('input'); i.type = 'file'; i.id = 'dc-file'; i.multiple = true; i.hidden = true;
    i.accept = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,application/pdf,image/*';
    i.addEventListener('change', () => {
      const s = SUBIENDO, fs = [...i.files]; i.value = ''; SUBIENDO = null;
      if (s && fs.length) subir(s.scope, s.cat, s.etiqueta, s.clave, fs);
    });
    document.body.appendChild(i);
  }
  return i;
};
document.addEventListener('click', async e => {
  const b = e.target.closest('.dc-w [data-d]'); if (!b) return;
  const w = b.closest('.dc-w'), scope = w.dataset.dscope, pid = scope[0] === 'p' ? scope.slice(2) : null;
  const d = b.dataset.d, li = b.closest('.dc-doc');
  const op = li && li.dataset.dop, k = li && li.dataset.dk;
  if (d === 'plegar'){ ABIERTOS[b.dataset.key] = b.getAttribute('aria-expanded') !== 'true'; return repintar(); }
  if (d === 'abrir') return abrirArchivo(b.dataset.id);
  if (d === 'del-arch') return quitarArchivo(b.dataset.id);
  if (d === 'adj'){
    let et = '';
    if (b.dataset.cat === 'otros'){
      const inp = b.closest('.dc-cat').querySelector('[data-d-nom]'); et = inp ? inp.value.trim() : '';
      if (et.length < 2){ X.toast('Escribe primero el nombre del archivo en "Otros" (ej: Certificado de matrimonio).', true); if (inp) inp.focus(); return; }
    }
    SUBIENDO = { scope, cat:b.dataset.cat, etiqueta:et, clave:b.dataset.clave || '' };
    return entrada().click();
  }
  if (!pid) return;
  const f = op && filaEst(pid, op, k);
  if (d === 'ck'){
    const rec = f && f.estado === 'recibido';
    const s = rec ? estadoDoc(op, { k }, f) : null;
    if (rec && s.k !== 'venc') return guardarEst(pid, op, k, { estado:'pendiente' });
    return guardarEst(pid, op, k, { estado:'recibido', emitido: iso(hoyD()) });
  }
  if (d === 'resacar') return guardarEst(pid, op, k, { estado:'pendiente', emitido:null });
  if (d === 'na') return guardarEst(pid, op, k, { estado: f && f.estado === 'na' ? 'pendiente' : 'na' });
  if (d === 'vig'){ EDIT_VIG = pid + '|' + op + '|' + k; return repintar(); }
  if (d === 'vig-no'){ EDIT_VIG = null; return repintar(); }
  if (d === 'vig-nove'){ EDIT_VIG = null; return guardarEst(pid, op, k, { vigencia_dias:0 }); }
  if (d === 'vig-gen'){ EDIT_VIG = null; return guardarEst(pid, op, k, { vigencia_dias:null }); }
  if (d === 'vig-ok'){
    const n = parseInt(li.querySelector('[data-d-vin]').value, 10);
    if (!(n >= 1 && n <= 3650)){ X.toast('Escribe los días hábiles de vigencia (entre 1 y 3650).', true); return; }
    EDIT_VIG = null; return guardarEst(pid, op, k, { vigencia_dias:n });
  }
  if (d === 'conf'){ CONF = !CONF; return repintar(); }
  if (d === 'conf-ok') return guardarVigencias(w);
});
document.addEventListener('change', e => {
  const i = e.target.closest('.dc-w [data-d=emitido]'); if (!i) return;
  const li = i.closest('.dc-doc'), scope = i.closest('.dc-w').dataset.dscope;
  if (i.value && deIso(i.value) > hoyD()){ X.toast('La fecha de emisión no puede ser futura.', true); repintar(); return; }
  guardarEst(scope.slice(2), li.dataset.dop, li.dataset.dk, { emitido: i.value || null });
});
async function guardarVigencias(w){
  const nuevo = { ...vigGeneral() };
  for (const i of w.querySelectorAll('[data-vk]')){
    const k = i.dataset.vk, v = i.value.trim();
    if (v === ''){ delete nuevo[k]; continue; }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 3650){ X.toast('Las vigencias son números enteros de días hábiles (0 si no vence).', true); i.focus(); return; }
    nuevo[k] = n;
  }
  X.overlay(true, 'Guardando…');
  try{
    const { data, error } = await sb.from('config').update({ valor:nuevo }).eq('clave', 'vigencias').select();
    if (error) throw error; if (!data || !data.length) throw new Error('permission denied');
    X.config().vigencias = nuevo; CONF = false;
    X.toast('Vigencias guardadas. Ya se aplican a todas las propiedades.');
  }catch(err){ X.toast(X.errTxt(err), true); }
  finally{ X.overlay(false); repintar(); }
}

/* ---------------- estilos propios ---------------- */
const css = document.createElement('style');
css.textContent = `
.dc-box{border:1px solid var(--ln);background:#fff;padding:16px 16px 12px;margin-top:16px}
.dc-aviso p{margin:6px 0 0;font-size:14px;color:var(--mu)}
.dc-h{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px}
.dc-h h3{font:700 16px/1.2 'DM Sans';margin:0}
.dc-c{font:700 13px/1 'DM Sans';padding:6px 10px;border-radius:12px;background:#f1ece7;color:var(--tx)}
.dc-c.full{background:#e3f1e4;color:var(--ok)}
.dc-h2{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--ln);padding-bottom:12px;margin-bottom:14px}
.dc-h2 h2{margin:0;padding:0;border:0;flex:1 1 auto}
.dc-h2 .dc-c{flex:none}
.dc-tg{flex:none;border:1.5px solid var(--o);background:#fff;color:var(--o2);border-radius:18px;padding:8px 14px;font:700 13px/1 'DM Sans';cursor:pointer;white-space:nowrap}
.dc-tg::after{content:' ▾'}
.dc-tg[aria-expanded=true]{background:var(--o);color:#fff}
.dc-tg[aria-expanded=true]::after{content:' ▴'}
.dc-tg:hover{background:var(--oh);color:#fff}
.dc-bar{height:6px;background:#eee7e0;margin:10px 0 12px;overflow:hidden}
.dc-bar i{display:block;height:100%;background:var(--ok)}
.dc-warn{font-size:14px;color:var(--bad);font-weight:600;margin:0 0 8px}
.dc-m{font-size:13px;color:var(--mu);margin-top:2px}
.dc-sub{color:var(--mu);letter-spacing:.06em;text-transform:none;font-weight:400}
.dc-ds,.dc-fs{list-style:none;margin:0;padding:0}
.dc-doc{display:flex;gap:12px;padding:12px 0;border-top:1px solid var(--ln)}
.dc-doc:first-child{border-top:0}
.dc-ck{flex:none;width:30px;height:30px;border:2px solid #b9b2aa;background:#fff;border-radius:6px;cursor:pointer;font:700 18px/1 'DM Sans';color:#fff;display:grid;place-items:center}
.dc-ck[aria-pressed=true]{background:var(--ok);border-color:var(--ok)}
.dc-ck:disabled{cursor:default;opacity:.8}
.dc-doc.na .dc-t{color:var(--mu);text-decoration:line-through}
.dc-doc.venc .dc-ck{border-color:var(--bad)}
.dc-main{flex:1;min-width:0}
.dc-t{font-weight:700;line-height:1.3}
.dc-b{display:inline-block;margin-left:8px;padding:3px 8px;border-radius:10px;font:600 12px/1.2 'DM Sans';background:#eee;color:#555;vertical-align:1px}
.dc-b.ok{background:#e3f1e4;color:#1f6b24}
.dc-b.pronto{background:#fff1c9;color:#7a5a00}
.dc-b.venc{background:#fbe0de;color:var(--bad)}
.dc-b.na{background:#eee;color:#777}
.dc-em,.dc-vig,.dc-ac{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin-top:8px;font-size:13.5px}
.dc-em input[type=date],.dc-vig input,.dc-cg input{padding:6px 8px;border:1px solid #cacaca;border-radius:6px;width:auto;font-size:14px}
.dc-vig input{width:90px}
.dc-l{border:0;background:none;color:var(--o2);font:600 13px/1 'DM Sans';cursor:pointer;padding:4px 0;text-decoration:underline}
.dc-l:hover{color:var(--o)}
.dc-fs{margin-top:8px}
.dc-f{display:flex;flex-wrap:wrap;gap:2px 10px;align-items:baseline;padding:5px 0;font-size:14px}
.dc-f small{color:var(--mu);font-size:12.5px;flex:1 1 100%;order:3}
.dc-fn{border:0;background:none;color:var(--o2);font:600 14px/1.3 'DM Sans';cursor:pointer;text-align:left;text-decoration:underline;word-break:break-word}
.dc-x{border:0;background:none;color:var(--mu);font-size:20px;line-height:1;cursor:pointer;margin-left:auto;order:2}
.dc-x:hover{color:var(--bad)}
.dc-conf{background:#faf6f2;border:1px solid var(--ln);padding:12px;margin-bottom:10px;font-size:14px}
.dc-cg{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px 16px;margin-top:10px}
.dc-cg label{display:flex;justify-content:space-between;gap:10px;align-items:center}
.dc-cg input{width:84px}
.dc-cat{padding:12px 0;border-top:1px solid var(--ln)}
.dc-cat:first-of-type{border-top:0}
.dc-ch{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
.dc-ch span{font-size:13px;color:var(--mu)}
.dc-ac input[type=text]{flex:1;min-width:200px;padding:7px 10px;border:1px solid #cacaca;border-radius:6px;font-size:14px}
.dc-dl{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px 20px;margin:0}
.dc-dl dt{font-size:12px;color:var(--mu);letter-spacing:.06em;text-transform:uppercase}
.dc-dl dd{font-weight:700;margin:2px 0 0}
`;
document.head.appendChild(css);

X.docs = { carpetaHTML, archivosHTML, ctrHTML, abrirExpediente, resumen, rutasDe, quitarRutas, repintar, disponible: () => OK };
})();
