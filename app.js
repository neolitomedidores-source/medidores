/* App de campo – cambio de medidores. Ver LEEME.md */
'use strict';

/* ------------------------------------------------------------------ utilidades */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const dig = s => String(s == null ? '' : s).replace(/\D/g, '');
const norm = s => String(s == null ? '' : s).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
const ahora = () => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), ms);
}

function confirmar(texto, si = 'Sí', no = 'No') {
  return new Promise(res => {
    const d = $('#dlgConfirm');
    $('#cfTexto').textContent = texto;
    $('#cfSi').textContent = si;
    $('#cfNo').textContent = no;
    const fin = v => { d.close(); $('#cfSi').onclick = $('#cfNo').onclick = null; res(v); };
    $('#cfSi').onclick = () => fin(true);
    $('#cfNo').onclick = () => fin(false);
    d.showModal();
  });
}

/* ------------------------------------------------------------------ almacenamiento local (IndexedDB) */
const DB = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('medidores', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('cola', { keyPath: 'uid' });
        r.result.createObjectStore('kv');
      };
      r.onsuccess = () => { this._db = r.result; res(r.result); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(store, modo, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, modo);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('Sin espacio en el teléfono'));
    });
  },
  get: (k) => DB.tx('kv', 'readonly', s => s.get(k)),
  set: (k, v) => DB.tx('kv', 'readwrite', s => s.put(v, k)),
  del: (k) => DB.tx('kv', 'readwrite', s => s.delete(k)),
  colaTodos: () => DB.tx('cola', 'readonly', s => s.getAll()),
  colaPoner: (it) => DB.tx('cola', 'readwrite', s => s.put(it)),
  colaQuitar: (id) => DB.tx('cola', 'readwrite', s => s.delete(id))
};

/* ------------------------------------------------------------------ sesión y servidor */
const S = JSON.parse(localStorage.getItem('med_sesion') || '{}');
const guardarSesion = () => localStorage.setItem('med_sesion', JSON.stringify(S));

function apiUrl() {
  const q = new URLSearchParams(location.search).get('api');
  if (q) { S.api = q; guardarSesion(); }
  const u = S.api || window.API_URL || '';
  return /^https:\/\//.test(u) ? u : '';
}

async function api(action, datos = {}, ms = 90000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    let r;
    try {
      r = await fetch(apiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action, token: S.token }, datos)),
        signal: ctrl.signal,
        redirect: 'follow'
      });
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'el servidor tardó más de ' + Math.round(ms / 1000) + ' s' : 'no hubo conexión con el servidor');
    }
    const txt = await r.text();
    let j;
    try { j = JSON.parse(txt); } catch (e) {
      const m = txt.match(/<title>([^<]*)<\/title>/i) || txt.match(/(Exception|Error)[^<]{0,120}/);
      throw new Error('el servidor respondió con un error (HTTP ' + r.status + (m ? ': ' + (m[1] || m[0]).trim() : '') + ')');
    }
    if (j.error === 'SESION') {
      S.token = null; guardarSesion();
      toast(j.mensaje || 'Vuelve a entrar');
      ir('login');
    }
    return j;
  } finally {
    clearTimeout(t);
  }
}

/* ------------------------------------------------------------------ navegación */
let pantalla = '';
function ir(p) {
  pantalla = p;
  $$('main > section').forEach(s => s.classList.toggle('on', s.id === 's-' + p));
  $('#titulo').textContent = S.cuadrilla && p !== 'login' ? S.cuadrilla : 'Medidores · Campo';
  window.scrollTo(0, 0);
  actualizarPie();
  if (p === 'inicio') pintarInicio();
  if (p === 'login') cargarCuadrillas();
}
$$('[data-ir]').forEach(b => b.addEventListener('click', () => ir(b.dataset.ir)));

/* ------------------------------------------------------------------ base de cuentas */
let BASE = { filas: [] };

async function cargarBaseLocal() {
  BASE = (await DB.get('base')) || { filas: [] };
}

async function actualizarBase(silencioso) {
  if (!navigator.onLine || !S.token) { if (!silencioso) toast('Sin señal: se usa la base guardada'); return; }
  try {
    if (!silencioso) $('#txtBase').innerHTML = '<span class="spinner"></span>Actualizando…';
    const r = await api('base');
    if (r.ok) {
      BASE = { archivo: r.archivo, actualizado: r.actualizado, descargada: ahora(), filas: r.filas };
      await DB.set('base', BASE);
      if (!silencioso) toast('Base actualizada: ' + r.filas.length + ' cuentas');
    } else if (!silencioso) toast('No se pudo actualizar: ' + (r.error || ''));
  } catch (e) {
    if (!silencioso) toast('No se pudo actualizar la base');
  }
  if (pantalla === 'inicio') pintarInicio();
}

function domicilio(f) {
  const num = [f.ext, f.int].filter(Boolean).join(' ');
  return `${f.calle}${num ? ' #' + num : ''}${f.colonia ? ', COL. ' + f.colonia : ''}`;
}

/** Búsqueda solo por número de cuenta (también acepta los últimos dígitos). */
function buscar(q) {
  const dq = dig(q);
  if (dq.length < 3) return [];
  return BASE.filas
    .filter(f => dig(f.cuenta).includes(dq))
    .map(f => ({ f, o: dig(f.cuenta) === dq ? 0 : dig(f.cuenta).startsWith(dq) ? 1 : 2 }))
    .sort((x, y) => x.o - y.o)
    .map(x => x.f)
    .slice(0, 25);
}

/** Busca en la base la fila que corresponde a lo leído de la orden. */
function encontrarPorOrden(l) {
  const c = dig(l.cuenta) || dig(l.cuenta_completa).slice(-6);
  const fo = dig(l.folio), ma = dig(l.medidor_actual), mn = dig(l.medidor_nuevo);
  let mejor = null;
  for (const f of BASE.filas) {
    const coin = [];
    if (c && dig(f.cuenta) === c) coin.push('cuenta');
    if (fo && dig(f.folio) === fo) coin.push('folio');
    if (ma && dig(f.mActual) === ma) coin.push('medidor');
    if (mn && dig(f.mNuevo) === mn) coin.push('medidor nuevo');
    const pts = coin.length;
    if (pts && (!mejor || pts > mejor.pts)) mejor = { fila: f, pts, coin };
  }
  return mejor;
}

/* ------------------------------------------------------------------ fotos */
async function decodificar(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    return await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('No se pudo abrir la foto'));
      img.src = URL.createObjectURL(file);
    });
  }
}

function redimensionar(img, maxLado, calidad) {
  const w = img.width, h = img.height;
  const k = Math.min(1, maxLado / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', calidad));
}

/** Copia los metadatos EXIF (fecha, cámara, GPS si los trae) de la foto original a la reducida. */
async function conExif(original, nueva) {
  try {
    const o = new Uint8Array(await original.arrayBuffer());
    if (o[0] !== 0xFF || o[1] !== 0xD8) return nueva;
    let i = 2, app1 = null;
    while (i + 4 < o.length && o[i] === 0xFF) {
      const m = o[i + 1], len = (o[i + 2] << 8) | o[i + 3];
      if (m === 0xE1 && o[i + 4] === 0x45 && o[i + 5] === 0x78 && o[i + 6] === 0x69 && o[i + 7] === 0x66) {
        app1 = o.slice(i, i + 2 + len); break;
      }
      if (m === 0xDA) break;
      i += 2 + len;
    }
    if (!app1) return nueva;
    // La foto nueva ya va derecha: poner Orientación = 1.
    const T = 10, le = app1[T] === 0x49;
    const r16 = p => le ? app1[p] | (app1[p + 1] << 8) : (app1[p] << 8) | app1[p + 1];
    const r32 = p => le ? (app1[p] | (app1[p + 1] << 8) | (app1[p + 2] << 16) | (app1[p + 3] << 24)) >>> 0
      : ((app1[p] << 24) | (app1[p + 1] << 16) | (app1[p + 2] << 8) | app1[p + 3]) >>> 0;
    const ifd = T + r32(T + 4), n = r16(ifd);
    for (let k = 0; k < n; k++) {
      const e = ifd + 2 + k * 12;
      if (r16(e) === 0x0112) { if (le) { app1[e + 8] = 1; app1[e + 9] = 0; } else { app1[e + 8] = 0; app1[e + 9] = 1; } }
    }
    const b = new Uint8Array(await nueva.arrayBuffer());
    let resto = 2;
    if (b[2] === 0xFF && b[3] === 0xE0) resto = 4 + ((b[4] << 8) | b[5]); // quita JFIF
    return new Blob([b.slice(0, 2), app1, b.slice(resto)], { type: 'image/jpeg' });
  } catch (e) {
    return nueva;
  }
}

function aBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

/** Devuelve { blob: foto para Drive, ia: base64 reducido para la IA } */
async function procesarFoto(file) {
  const img = await decodificar(file);
  const max = Number(window.FOTO_MAX_PX || 0);
  const lado = Math.max(img.width, img.height);
  let blob;
  if (file.type === 'image/jpeg' && (!max || lado <= max)) blob = file;
  else blob = await conExif(file, await redimensionar(img, max || lado, 0.9));
  const ia = await aBase64(await redimensionar(img, 1600, 0.8));
  if (img.close) img.close();
  return { blob, ia };
}

let camDestino = null;
$$('[data-cam]').forEach(b => b.addEventListener('click', () => {
  camDestino = b.dataset.cam;
  $('#cam').value = '';
  $('#cam').click();
}));
$('#cam').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  if (!file || !T) return;
  const destino = camDestino;
  let foto;
  try {
    foto = await procesarFoto(file);
  } catch (err) {
    toast('No se pudo procesar la foto: ' + err.message);
    return;
  }
  foto.hora = ahora();
  foto.id = uid();
  if (destino === 'orden') fotoOrden(foto);
  else if (destino === 'piz') fotoPizarron(foto);
  else if (destino === 'extra') { T.fotos.extras.push(foto); pintarFinal(); }
  else if (destino === 'noinst') { T.fotos.noinst = foto; mostrarImg('#imgNoInst', foto.blob); }
  guardarT();
});

function mostrarImg(sel, blob) {
  const im = $(sel);
  if (im.src) URL.revokeObjectURL(im.src);
  if (!blob) { im.removeAttribute('src'); im.classList.add('hidden'); return; }
  im.src = URL.createObjectURL(blob);
  im.classList.remove('hidden');
}

/* ------------------------------------------------------------------ GPS */
let gpsWatch = null;
function iniciarGPS() {
  if (!navigator.geolocation || gpsWatch != null) return;
  gpsWatch = navigator.geolocation.watchPosition(p => {
    if (!T) return;
    const c = p.coords;
    if (!T.gps || c.accuracy <= T.gps.acc || Date.now() - T.gps.t > 120000) {
      T.gps = { lat: +c.latitude.toFixed(6), lng: +c.longitude.toFixed(6), acc: Math.round(c.accuracy), t: Date.now() };
    }
  }, () => {}, { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 });
}
function detenerGPS() {
  if (gpsWatch != null) navigator.geolocation.clearWatch(gpsWatch);
  gpsWatch = null;
}

/* ------------------------------------------------------------------ trabajo actual */
let T = null;   // cambio en captura
let etapa = 'antes';

function nuevoT() {
  return {
    uid: uid(), inicio: ahora(), fila: null, cuentaCompleta: '',
    fotos: { orden: null, antes: null, despues: null, extras: [], noinst: null },
    rev: { antes: null, despues: null },
    lectura: { antes: '', despues: '0' }, sello: '', obs: '', gps: null
  };
}
async function guardarT() { if (T) await DB.set('actual', T); }

$('#btnNuevo').addEventListener('click', () => {
  T = nuevoT();
  guardarT();
  iniciarGPS();
  limpiarOrden();
  ir('orden');
  setTimeout(() => $('#busca').focus(), 50);
});

/* ---------- Paso 1: orden */
function limpiarOrden() {
  mostrarImg('#imgOrden', T && T.fotos.orden ? T.fotos.orden.blob : null);
  $('#ordenEstado').innerHTML = '';
  $('#cardMatch').style.display = 'none';
  $('#busca').value = '';
  $('#resBusca').innerHTML = '';
}

async function fotoOrden(foto) {
  T.fotos.orden = foto;
  mostrarImg('#imgOrden', foto.blob);
  if ($('#cardMatch').style.display !== 'none') {
    $('#ordenEstado').innerHTML = '<div class="aviso ok">✔ Foto de la orden guardada.</div>';
    return;
  }
  if (!navigator.onLine) {
    $('#ordenEstado').innerHTML = '<div class="aviso info">Sin señal: escribe la cuenta arriba. La foto se sube después.</div>';
    return;
  }
  $('#ordenEstado').innerHTML = '<div class="aviso info"><span class="spinner"></span>Leyendo la orden…</div>';
  try {
    const r = await api('leerOrden', { imagen: foto.ia }, 100000);
    if (!r.ok) {
      $('#ordenEstado').innerHTML = `<div class="aviso info">${esc(r.sinIA ? 'Lectura automática no activada.' : 'No se pudo leer: ' + (r.error || ''))} Escribe la cuenta arriba.</div>`;
      return;
    }
    const l = r.leido || {};
    const m = encontrarPorOrden(l);
    if (m && m.pts >= 1) {
      $('#ordenEstado').innerHTML = '';
      pintarMatch(m.fila, l, m.coin);
    } else {
      const c = dig(l.cuenta) || dig(l.cuenta_completa).slice(-6);
      $('#ordenEstado').innerHTML = `<div class="aviso mal">Leí cuenta <b>${esc(c || '¿?')}</b>, folio <b>${esc(l.folio || '¿?')}</b>, pero no está en la base. Revisa y escríbela arriba.</div>`;
      if (c) { $('#busca').value = c; pintarBusqueda(); }
    }
  } catch (e) {
    $('#ordenEstado').innerHTML = `<div class="aviso info">No se pudo leer: ${esc(e.message)}. Escribe la cuenta arriba.</div>`;
  }
}

function badgeFila(f) {
  if (ABIERTOS.some(t => t.fila && t.fila.cuenta === f.cuenta)) return '<span class="badge app">FALTA MEDIDOR NUEVO</span>';
  if (f.app) return '<span class="badge app">YA CAPTURADA EN APP</span>';
  if (f.estatus === 'INSTALADO') return '<span class="badge inst">INSTALADO</span>';
  return '';
}

function pintarMatch(f, l, coin) {
  const avisos = [];
  if (l && l.medidor_nuevo && dig(l.medidor_nuevo) !== dig(f.mNuevo)) {
    avisos.push(`El medidor nuevo de la orden (<b>${esc(l.medidor_nuevo)}</b>) no es el del Excel (<b>${esc(f.mNuevo)}</b>).`);
  }
  if (l && l.medidor_actual && dig(l.medidor_actual) !== dig(f.mActual)) {
    avisos.push(`El medidor existente de la orden (<b>${esc(l.medidor_actual)}</b>) no es el del Excel (<b>${esc(f.mActual)}</b>).`);
  }
  const card = $('#cardMatch');
  card.style.display = 'block';
  card.innerHTML = `
    <div class="aviso ok" style="margin-top:0">✔ Encontrada en la base${coin ? ' (coincide: ' + esc(coin.join(', ')) + ')' : ''}</div>
    <dl class="datos">
      <dt>Cuenta</dt><dd class="num">${esc(f.cuenta)} ${badgeFila(f)}</dd>
      <dt>Folio</dt><dd>${esc(f.folio)}</dd>
      <dt>Domicilio</dt><dd>${esc(domicilio(f))}</dd>
      <dt>Med. actual</dt><dd>${esc(f.mActual)}</dd>
      <dt>Med. nuevo</dt><dd>${esc(f.mNuevo)}</dd>
    </dl>
    ${avisos.map(a => `<div class="aviso mal">${a}</div>`).join('')}
    <button class="bverde grande" id="btnEsEsta">Sí, es esta cuenta</button>`;
  $('#btnEsEsta').onclick = () => seleccionar(f, l);
}

function pintarBusqueda() {
  const res = buscar($('#busca').value);
  $('#resBusca').innerHTML = res.length
    ? res.map((f, i) => `<div class="res" data-i="${i}"><div class="t">${esc(f.cuenta)} · Folio ${esc(f.folio)} ${badgeFila(f)}</div><div class="muted">${esc(domicilio(f))}<br>Med. ${esc(f.mActual)} → ${esc(f.mNuevo)}</div></div>`).join('')
    : ($('#busca').value.length >= 3 ? `<p class="muted">Sin resultados${BASE.filas.length ? '' : ' (la base está vacía: actualízala con señal)'}.</p>` : '');
  const elegir = f => { $('#resBusca').innerHTML = ''; $('#busca').blur(); pintarMatch(f, null, null); };
  $$('#resBusca .res').forEach(el => el.onclick = () => elegir(res[+el.dataset.i]));
  const q = dig($('#busca').value);
  const exacta = res.filter(f => dig(f.cuenta) === q);
  if (exacta.length === 1 && q.length >= 6) {
    if (T && ABIERTOS.some(t => t.fila && t.fila.cuenta === exacta[0].cuenta)) { $('#resBusca').innerHTML = ''; $('#busca').blur(); seleccionar(exacta[0], null); }
    else elegir(exacta[0]);
  }
  else $('#cardMatch').style.display = 'none';
}
$('#busca').addEventListener('input', e => { e.target.value = dig(e.target.value); pintarBusqueda(); });

async function seleccionar(f, leido) {
  const abierto = ABIERTOS.find(t => t.fila && t.fila.cuenta === f.cuenta);
  if (abierto) {
    // Ya tiene la foto del medidor retirado: ir directo al medidor nuevo para cerrar el ciclo.
    toast('Cuenta ' + f.cuenta + ': medidor retirado ya capturado (' + (abierto.fotos.antes ? abierto.fotos.antes.hora : abierto.inicio) + '). Sigue el medidor nuevo.', 4000);
    reanudar(abierto);
    return;
  }
  if (f.app || f.estatus === 'INSTALADO') {
    const ok = await confirmar(`La cuenta ${f.cuenta} ya aparece como ${f.app ? 'capturada en la app (' + f.app + ')' : 'INSTALADA en el Excel'}. ¿Continuar de todos modos?`, 'Continuar', 'Cancelar');
    if (!ok) return;
  }
  T.fila = f;
  const cc = leido && leido.cuenta_completa;
  T.cuentaCompleta = cc && dig(cc).endsWith(dig(f.cuenta)) ? cc.toUpperCase().replace(/\s+/g, ' ').trim() : f.cuenta;
  guardarT();
  irPizarron('antes');
}

/* ---------- Pasos 2 y 3: pizarrón */
function medidorDe(et) {
  const cual = (window.NDM_PIZARRON || {})[et] || (et === 'antes' ? 'actual' : 'nuevo');
  return cual === 'nuevo' ? T.fila.mNuevo : T.fila.mActual;
}

function irPizarron(et) {
  etapa = et;
  const f = T.fila;
  const antes = et === 'antes';
  $('#pzPaso').textContent = antes ? 'Paso 2 de 3' : 'Paso 3 de 3';
  $('#pzTitulo').textContent = antes ? 'Medidor retirado (viejo)' : 'Medidor nuevo instalado';
  $('#pzGuia').innerHTML = `
    <div class="l"><span class="k">CUENTA:</span><span class="v">${esc(T.cuentaCompleta || f.cuenta)}</span></div>
    <div class="l"><span class="k">DOMICILIO:</span><span class="v dom">${esc(domicilio(f))}</span></div>
    <div class="l${antes ? '' : ' cambia'}"><span class="k">NDM:</span><span class="v">${esc(medidorDe(et))}</span></div>
    <div class="l${antes ? '' : ' cambia'}"><span class="k">LECTURA:</span><span class="v">${antes ? '<span style="color:#888;font-size:16px">la que marca el medidor</span>' : '<span style="color:#888;font-size:16px">borrar, dejar vacía</span>'}</span></div>
    ${antes ? '' : `<div class="l cambia"><span class="k">SELLO:</span><span class="v">${T.sinSello ? 'SIN SELLO' : T.sello ? esc(T.sello) : '<span style="color:#888;font-size:16px">el número del sello colocado</span>'}</span></div>`}`;
  $('#pzNota').textContent = antes ? 'Escribe en el pizarrón, a mano:' : 'Mismo pizarrón: cambia el NDM, borra la lectura y anota el sello:';
  $('#pzLectLabel').textContent = antes ? 'Lectura del medidor retirado' : 'Lectura inicial del medidor nuevo';
  $('#pzLectura').value = T.lectura[et] || '';
  $('#pzLectLabel').classList.toggle('hidden', !antes);
  $('#pzLectura').classList.toggle('hidden', !antes);
  $('#pzSelloBox').classList.toggle('hidden', antes);
  $('#pzSello').value = T.sello || '';
  pintarSinSello();
  const foto = T.fotos[et];
  mostrarImg('#imgPiz', foto ? foto.blob : null);
  pintarRevision();
  ir('piz');
}

$('#pzLectura').addEventListener('input', e => {
  T.lectura[etapa] = dig(e.target.value); e.target.value = T.lectura[etapa];
  const r = T.rev[etapa];
  if (r && r.leido) { T.rev[etapa] = compararPizarron(r.leido, etapa); pintarRevision(); }
  actualizarPie(); guardarT();
});
$('#pzSello').addEventListener('input', e => {
  T.sello = dig(e.target.value); e.target.value = T.sello;
  const r = T.rev.despues;
  if (r && r.leido) { T.rev.despues = compararPizarron(r.leido, 'despues'); pintarRevision(); }
  actualizarPie(); guardarT();
});
function pintarSinSello() {
  $('#pzSinSello').checked = !!T.sinSello;
  $('#pzSinSelloBox').classList.toggle('hidden', !T.sinSello);
  $('#pzSello').disabled = !!T.sinSello;
  if (T.motivoSello) $('#pzMotivoSello').value = T.motivoSello;
}
$('#pzSinSello').addEventListener('change', e => {
  T.sinSello = e.target.checked;
  if (T.sinSello) { T.sello = ''; $('#pzSello').value = ''; T.motivoSello = $('#pzMotivoSello').value; }
  pintarSinSello();
  const r = T.rev.despues;
  if (r && r.leido) { T.rev.despues = compararPizarron(r.leido, 'despues'); pintarRevision(); }
  irPizarronGuia();
  actualizarPie(); guardarT();
});
$('#pzMotivoSello').addEventListener('change', e => { T.motivoSello = e.target.value; guardarT(); });
function irPizarronGuia() { if (pantalla === 'piz' && etapa === 'despues') { const y = window.scrollY; irPizarron('despues'); window.scrollTo(0, y); } }
$('#pzAtras').addEventListener('click', () => etapa === 'despues' ? irPizarron('antes') : ir('orden'));

async function fotoPizarron(foto) {
  const et = etapa;
  T.fotos[et] = foto;
  T.rev[et] = null;
  mostrarImg('#imgPiz', foto.blob);
  actualizarPie();
  if (!navigator.onLine) {
    T.rev[et] = { estado: 'SIN VERIFICAR', items: [], nota: 'Sin señal al tomar la foto' };
    pintarRevision();
    return;
  }
  $('#pzRevision').innerHTML = '<div class="aviso info"><span class="spinner"></span>Revisando lo escrito en el pizarrón…</div>';
  try {
    const r = await api('leerPizarron', { imagen: foto.ia }, 100000);
    if (T.fotos[et] !== foto) return; // ya tomaron otra
    if (!r.ok) {
      T.rev[et] = { estado: 'SIN VERIFICAR', items: [], nota: r.sinIA ? 'Revisión automática no activada' : (r.error || '') };
    } else {
      const l = r.leido || {};
      const lect = dig(l.lectura), sello = dig(l.sello);
      if (et === 'antes' && lect && !T.lectura.antes) T.lectura.antes = lect;
      if (et === 'despues' && sello && !T.sello && !T.sinSello) T.sello = sello;
      T.rev[et] = compararPizarron(l, et);
    }
  } catch (e) {
    T.rev[et] = { estado: 'SIN VERIFICAR', items: [], nota: e.message };
  }
  guardarT();
  if (pantalla === 'piz' && etapa === et) {
    $('#pzLectura').value = T.lectura[et] || '';
    $('#pzSello').value = T.sello || '';
    pintarRevision();
    actualizarPie();
  }
}

function compararPizarron(l, et) {
  const items = [];
  const cEsp = dig(T.fila.cuenta), cLei = dig(l.cuenta);
  items.push({ campo: 'Cuenta', leido: l.cuenta || '', est: !cLei ? 'q' : cLei.endsWith(cEsp) ? 'ok' : 'mal' });
  const mEsp = dig(medidorDe(et)), mLei = dig(l.medidor);
  items.push({ campo: 'Medidor (NDM)', leido: l.medidor || '', est: !mLei ? 'q' : mLei === mEsp ? 'ok' : 'mal' });
  const lect = dig(l.lectura);
  if (et === 'despues') items.push({ campo: 'Lectura (vacía)', leido: l.lectura || 'vacía', est: !lect || /^0+$/.test(lect) ? 'ok' : 'mal' });
  else {
    const lE = dig(T.lectura.antes);
    items.push({ campo: 'Lectura', leido: l.lectura || '', est: !lect ? 'q' : !lE || lect === lE ? 'ok' : 'mal' });
  }
  if (et === 'despues') {
    const sL = dig(l.sello), sE = dig(T.sello);
    if (T.sinSello) items.push({ campo: 'Sello (marcado sin sello)', leido: l.sello || 'vacío', est: sL ? 'mal' : 'ok' });
    else items.push({ campo: 'Sello', leido: l.sello || '', est: !sL ? 'q' : !sE || sL === sE ? 'ok' : 'mal' });
  }
  items.push({ campo: 'Domicilio', leido: l.domicilio || '', est: l.domicilio ? 'ok' : 'q' });
  const malos = items.filter(i => i.est === 'mal').map(i => i.campo);
  const dudas = items.filter(i => i.est === 'q').map(i => i.campo);
  let estado = 'OK';
  if (l.legible === false) estado = 'REVISAR: pizarrón no legible';
  else if (malos.length) estado = 'REVISAR: ' + malos.join(', ');
  else if (dudas.length) estado = 'DUDOSO: ' + dudas.join(', ');
  return { estado, items, leido: l };
}

function pintarRevision() {
  const r = T && T.rev[etapa];
  const box = $('#pzRevision');
  if (!r) { box.innerHTML = ''; return; }
  const cls = r.estado === 'OK' ? 'ok' : r.estado.startsWith('REVISAR') ? 'mal' : 'info';
  const titulo = r.estado === 'OK' ? '✔ El pizarrón coincide con la base'
    : r.estado.startsWith('REVISAR') ? '✖ Hay datos que no coinciden. Corrige el pizarrón y repite la foto.'
      : r.estado === 'SIN VERIFICAR' ? 'Sin verificar' + (r.nota ? ' – ' + r.nota : '')
        : '⚠ No se alcanzó a leer todo. Revisa que se vea claro.';
  const sim = { ok: '✔', mal: '✖', q: '?' };
  box.innerHTML = `<div class="aviso ${cls}"><b>${esc(titulo)}</b>${r.items.length ? '<div style="margin-top:6px">' +
    r.items.map(i => `<div class="chk"><span>${esc(i.campo)}: ${esc(i.leido || '—')}</span><b class="${i.est}">${sim[i.est]}</b></div>`).join('') + '</div>' : ''}</div>`;
}

/* ---------- No instalado */
$('#btnNoInst').addEventListener('click', () => {
  $('#niObs').value = '';
  mostrarImg('#imgNoInst', T.fotos.noinst ? T.fotos.noinst.blob : null);
  $('#dlgNoInst').showModal();
});
$('#niCancelar').addEventListener('click', () => $('#dlgNoInst').close());
$('#niGuardar').addEventListener('click', async () => {
  T.motivo = $('#niMotivo').value;
  T.obs = $('#niObs').value.trim();
  if (T.motivo === 'Otro' && !T.obs) { toast('Escribe el motivo en observaciones'); return; }
  $('#dlgNoInst').close();
  await guardarCambio('NO INSTALADO');
});

/* ---------- Final */
function pintarFinal() {
  const f = T.fila;
  const rA = T.rev.antes ? T.rev.antes.estado : 'SIN VERIFICAR';
  const rD = T.rev.despues ? T.rev.despues.estado : 'SIN VERIFICAR';
  $('#resumen').innerHTML = `
    <dt>Cuenta</dt><dd>${esc(T.cuentaCompleta || f.cuenta)}</dd>
    <dt>Folio</dt><dd>${esc(f.folio)}</dd>
    <dt>Domicilio</dt><dd>${esc(domicilio(f))}</dd>
    <dt>Retirado</dt><dd>${esc(f.mActual)} · lectura ${esc(T.lectura.antes)}</dd>
    <dt>Nuevo</dt><dd>${esc(f.mNuevo)} · lectura ${esc(T.lectura.despues)}</dd>
    <dt>Sello</dt><dd>${T.sinSello ? 'SIN SELLO · ' + esc(T.motivoSello || '') : esc(T.sello || '—')}</dd>
    <dt>Pizarrones</dt><dd>Antes: ${esc(rA)}<br>Después: ${esc(rD)}</dd>
    <dt>GPS</dt><dd>${T.gps ? esc(T.gps.lat + ', ' + T.gps.lng + ' (±' + T.gps.acc + ' m)') : 'sin ubicación'}</dd>`;
  const ex = $('#extras');
  $$('#extras img').forEach(i => URL.revokeObjectURL(i.src));
  ex.innerHTML = '';
  T.fotos.extras.forEach(fo => { const im = document.createElement('img'); im.src = URL.createObjectURL(fo.blob); ex.appendChild(im); });
  $('#obs').value = T.obs || '';
}
$('#obs').addEventListener('input', e => { T.obs = e.target.value; guardarT(); });
$('#finAtras').addEventListener('click', () => irPizarron('despues'));

/* ---------- Botón inferior */
function actualizarPie() {
  const pie = $('#pie'), b = $('#btnPie');
  if (pantalla === 'piz' && T) {
    pie.classList.remove('hidden');
    b.textContent = etapa === 'antes' ? 'Siguiente: medidor nuevo →' : 'Siguiente: revisar →';
    b.disabled = !T.fotos[etapa] || (etapa === 'antes' ? !T.lectura.antes : !T.sello && !T.sinSello);
    // En el paso del medidor nuevo: salir y dejar la cuenta pendiente para cerrarla después.
    $('#btnPie2').classList.toggle('hidden', etapa !== 'despues');
    $('#btnPie2').disabled = !T.fotos.antes || !T.lectura.antes;
  } else if (pantalla === 'final' && T) {
    pie.classList.remove('hidden');
    $('#btnPie2').classList.add('hidden');
    b.textContent = '✔ Guardar y enviar';
    b.disabled = false;
  } else pie.classList.add('hidden');
}

$('#btnPie2').addEventListener('click', () => dejarPendiente());

$('#btnPie').addEventListener('click', async () => {
  if (pantalla === 'piz') {
    const r = T.rev[etapa];
    if (r && r.estado.startsWith('REVISAR')) {
      const ok = await confirmar('El pizarrón no coincide con la base. Lo recomendable es corregirlo y repetir la foto. ¿Seguir de todos modos?', 'Seguir', 'Repetir foto');
      if (!ok) return;
    }
    if (etapa === 'antes') irPizarron('despues');
    else { ir('final'); pintarFinal(); }
  } else if (pantalla === 'final') {
    await guardarCambio('INSTALADO');
  }
});

/* ------------------------------------------------------------------ guardar en cola y subir */
let ABIERTOS = []; // cambios con foto del medidor retirado, esperando la del nuevo

async function quitarAbierto(id) {
  ABIERTOS = ABIERTOS.filter(t => t.uid !== id);
  await DB.set('abiertos', ABIERTOS);
}

/** Guarda la parte del medidor retirado y deja la cuenta pendiente para tomar después la del nuevo. */
async function dejarPendiente() {
  const f = T.fila, c = dig(f.cuenta) || f.cuenta;
  const carpeta = `${c} - ${f.calle} ${[f.ext, f.int].filter(Boolean).join(' ')}`.trim();
  const gps = T.gps;
  const base = [
    `Cuenta: ${T.cuentaCompleta || f.cuenta}`, `Folio: ${f.folio}`, `Domicilio: ${domicilio(f)}`,
    gps ? `GPS: ${gps.lat},${gps.lng} (±${gps.acc} m)` : 'GPS: sin ubicación'
  ];
  // Las fotos ya tomadas se suben desde ahora, para no depender del teléfono.
  const fotos = [[T.fotos.orden, `${c}_orden.jpg`, 'ORDEN'], [T.fotos.antes, `${c}_antes_01.jpg`, 'ANTES – medidor retirado, lectura ' + (T.lectura.antes || '')]];
  try {
    for (const [foto, nombre, etiqueta] of fotos) {
      if (!foto || foto.qid) continue;
      const id = T.uid + '-' + nombre + (foto.id ? '-' + foto.id : '');
      await DB.colaPoner({
        uid: id, tipo: 'foto', creado: Date.now(), nombre, carpeta, blob: foto.blob,
        descripcion: [`Foto: ${etiqueta}`, `Tomada: ${foto.hora}`].concat(base).join('\n')
      });
      foto.qid = id;
    }
    ABIERTOS = ABIERTOS.filter(t => t.uid !== T.uid && !(t.fila && t.fila.cuenta === f.cuenta));
    ABIERTOS.push(T);
    await DB.set('abiertos', ABIERTOS);
  } catch (e) {
    toast('No hay espacio en el teléfono para guardar las fotos. Libera espacio e intenta de nuevo.', 6000);
    return;
  }
  await DB.del('actual');
  toast('⏸ Cuenta ' + f.cuenta + ' guardada (falta medidor nuevo). Captura la siguiente cuenta.', 4000);
  sincronizar();
  // Empieza de inmediato otra cuenta en la etapa del medidor retirado.
  T = nuevoT();
  guardarT();
  limpiarOrden();
  ir('orden');
  setTimeout(() => $('#busca').focus(), 50);
}

function reanudar(t) {
  T = t;
  guardarT();
  iniciarGPS();
  irPizarron('despues');
}

async function guardarCambio(estatus) {
  const f = T.fila;
  const c = dig(f.cuenta) || f.cuenta;
  const carpeta = `${c} - ${f.calle} ${[f.ext, f.int].filter(Boolean).join(' ')}`.trim();
  const gps = T.gps;
  const base = [
    `Cuenta: ${T.cuentaCompleta || f.cuenta}`, `Folio: ${f.folio}`, `Domicilio: ${domicilio(f)}`,
    gps ? `GPS: ${gps.lat},${gps.lng} (±${gps.acc} m)` : 'GPS: sin ubicación'
  ];
  const fotos = [];
  const agregar = (foto, nombre, etiqueta) => {
    if (!foto) return null;
    if (foto.qid) return foto.qid; // ya se mandó a la cola (cambio que se dejó pendiente)
    const id = T.uid + '-' + nombre + (foto.id ? '-' + foto.id : '');
    fotos.push({
      uid: id, tipo: 'foto', creado: Date.now() + fotos.length, nombre, carpeta, blob: foto.blob,
      descripcion: [`Foto: ${etiqueta}`, `Tomada: ${foto.hora}`].concat(base).join('\n')
    });
    foto.qid = id;
    return id;
  };
  const instalado = estatus === 'INSTALADO';
  const reg = {
    uid: T.uid, fechaCaptura: ahora(), folio: f.folio, cuenta: f.cuenta, cuentaCompleta: T.cuentaCompleta,
    domicilio: domicilio(f), estatus,
    medidorRetirado: instalado ? f.mActual : '', lecturaRetirado: T.lectura.antes || '',
    medidorNuevo: instalado ? f.mNuevo : '', lecturaNuevo: instalado ? (T.lectura.despues || '0') : '',
    sello: T.sinSello ? 'SIN SELLO' : (T.sello || ''), motivo: instalado ? '' : (T.motivo || ''), observaciones: [T.sinSello ? 'Sin sello: ' + (T.motivoSello || '') : '', T.obs || ''].filter(Boolean).join(' · '),
    lat: gps ? gps.lat : '', lng: gps ? gps.lng : '', precision: gps ? gps.acc : '',
    revisionAntes: T.fotos.antes ? (T.rev.antes ? T.rev.antes.estado : 'SIN VERIFICAR') : '',
    revisionDespues: T.fotos.despues ? (T.rev.despues ? T.rev.despues.estado : 'SIN VERIFICAR') : '',
    carpeta,
    refs: {
      fotoOrden: agregar(T.fotos.orden, `${c}_orden.jpg`, 'ORDEN'),
      fotoAntes: agregar(T.fotos.antes, `${c}_antes_01.jpg`, 'ANTES – medidor retirado, lectura ' + (T.lectura.antes || '')),
      fotoDespues: instalado ? agregar(T.fotos.despues, `${c}_despues_02.jpg`, 'DESPUÉS – medidor nuevo instalado, ' + (T.sinSello ? 'SIN SELLO (' + (T.motivoSello || '') + ')' : 'sello ' + (T.sello || ''))) : null,
      fotosExtra: T.fotos.extras.map((fo, i) => agregar(fo, `${c}_extra_${String(i + 3).padStart(2, '0')}.jpg`, 'ADICIONAL'))
        .concat(!instalado && T.fotos.noinst ? [agregar(T.fotos.noinst, `${c}_noinstalado.jpg`, 'NO INSTALADO – evidencia')] : [])
    }
  };
  try {
    for (const it of fotos) await DB.colaPoner(it);
    await DB.colaPoner({ uid: T.uid + '-registro', tipo: 'registro', creado: Date.now() + 1000, registro: reg });
  } catch (e) {
    toast('No hay espacio en el teléfono para guardar las fotos. Libera espacio e intenta de nuevo.', 6000);
    return;
  }
  const hist = (await DB.get('hist')) || [];
  hist.unshift({ uid: T.uid, cuenta: f.cuenta, domicilio: domicilio(f), estatus, fecha: reg.fechaCaptura, subido: false });
  await DB.set('hist', hist.slice(0, 60));
  f.app = `${estatus} · ${S.cuadrilla} · ${reg.fechaCaptura}`;
  await DB.set('base', BASE);
  await DB.del('actual');
  await quitarAbierto(T.uid);
  T = null;
  detenerGPS();
  toast(estatus === 'INSTALADO' ? '✔ Cambio guardado. Se sube en segundo plano.' : '✔ Registrado como no instalado.');
  ir('inicio');
  sincronizar();
}

let sincronizando = false;
async function sincronizar() {
  if (sincronizando || !navigator.onLine || !S.token || !apiUrl()) { pintarCola(); return; }
  sincronizando = true;
  pintarCola();
  try {
    const items = (await DB.colaTodos()).sort((a, b) => a.creado - b.creado);
    for (const it of items) {
      if (!S.token) break;
      if (it.tipo === 'foto') {
        const r = await api('subirFoto', {
          uid: it.uid, nombre: it.nombre, carpeta: it.carpeta, descripcion: it.descripcion,
          mime: 'image/jpeg', data: await aBase64(it.blob)
        }, 180000);
        if (!r.ok) throw new Error(r.error || 'Error al subir foto');
        await DB.set('url:' + it.uid, r.url);
      } else {
        const reg = Object.assign({}, it.registro);
        const url = async id => (id ? (await DB.get('url:' + id)) || '' : '');
        reg.fotoOrden = await url(reg.refs.fotoOrden);
        reg.fotoAntes = await url(reg.refs.fotoAntes);
        reg.fotoDespues = await url(reg.refs.fotoDespues);
        reg.fotosExtra = [];
        for (const id of reg.refs.fotosExtra) reg.fotosExtra.push(await url(id));
        delete reg.refs;
        const r = await api('registrar', { registro: reg });
        if (!r.ok) throw new Error(r.error || 'Error al registrar');
        const hist = (await DB.get('hist')) || [];
        const h = hist.find(x => x.uid === reg.uid);
        if (h) { h.subido = true; await DB.set('hist', hist); }
        for (const id of [it.registro.refs.fotoOrden, it.registro.refs.fotoAntes, it.registro.refs.fotoDespues].concat(it.registro.refs.fotosExtra)) {
          if (id) await DB.del('url:' + id);
        }
      }
      await DB.colaQuitar(it.uid);
      pintarCola();
    }
  } catch (e) {
    console.warn('Sincronización pendiente:', e);
    $('#txtCola') && ($('#txtCola').dataset.error = e.message || 'sin conexión');
  } finally {
    sincronizando = false;
    pintarCola();
    if (pantalla === 'inicio') pintarHist();
  }
}

async function pintarCola() {
  const n = (await DB.colaTodos()).length;
  const chip = $('#chipCola');
  chip.classList.toggle('hidden', !n);
  chip.classList.toggle('pend', !!n);
  chip.textContent = (sincronizando ? '⬆ ' : '⏸ ') + n;
  const t = $('#txtCola');
  const err = t.dataset.error;
  t.innerHTML = !n ? '✔ Todo subido'
    : sincronizando ? `<span class="spinner"></span>Subiendo… faltan ${n}`
      : `${n} pendiente(s)${navigator.onLine ? (err ? ' · último intento: ' + esc(err) : '') : ' · sin señal, se suben solas al volver'}`;
  if (!sincronizando) delete t.dataset.error;
  $('#btnSubir').disabled = !n || sincronizando;
}
$('#btnSubir').addEventListener('click', sincronizar);

function pintarRed() {
  const c = $('#chipRed');
  c.textContent = navigator.onLine ? 'En línea' : 'Sin señal';
  c.style.background = navigator.onLine ? '' : '#b3261e';
}
window.addEventListener('online', () => { pintarRed(); sincronizar(); });
window.addEventListener('offline', pintarRed);
setInterval(() => { if (navigator.onLine) sincronizar(); }, 60000);

/* ------------------------------------------------------------------ inicio */
async function pintarHist() {
  const hist = (await DB.get('hist')) || [];
  $('#listaHist').innerHTML = hist.length
    ? hist.slice(0, 20).map(h => `<div class="hist"><span><b>${esc(h.cuenta)}</b> · ${esc(h.domicilio)}<br><span class="muted">${esc(h.fecha)} · ${esc(h.estatus)}</span></span><span>${h.subido ? '✔' : '⏸'}</span></div>`).join('')
    : 'Ninguno todavía.';
}

function pintarAbiertos() {
  $('#cardAbiertos').classList.toggle('hidden', !ABIERTOS.length);
  $('#listaAbiertos').innerHTML = ABIERTOS.map((t, i) => `<div class="res" data-i="${i}"><div class="t">${esc(t.fila.cuenta)} <span class="badge app">MEDIDOR NUEVO</span></div><div class="muted">${esc(domicilio(t.fila))}<br>Retirado: ${esc(t.fila.mActual)} · lectura ${esc(t.lectura.antes)} · ${esc(t.fotos.antes ? t.fotos.antes.hora : t.inicio)}</div></div>`).join('');
  $$('#listaAbiertos .res').forEach(el => el.onclick = () => reanudar(ABIERTOS[+el.dataset.i]));
}

function pintarInicio() {
  pintarAbiertos();
  pintarCola();
  pintarHist();
  const n = BASE.filas.length;
  const pend = BASE.filas.filter(f => f.estatus !== 'INSTALADO' && !f.app).length;
  $('#txtBase').innerHTML = n
    ? `${esc(BASE.archivo || '')}<br>${n} cuentas · ${pend} pendientes · descargada ${esc(BASE.descargada || '')}`
    : 'Sin base. Actualízala con señal.';
}
$('#btnBase').addEventListener('click', () => actualizarBase(false));
$('#btnSalir').addEventListener('click', async () => {
  const n = (await DB.colaTodos()).length;
  if (n && !(await confirmar(`Hay ${n} pendiente(s) por subir. Se subirán cuando vuelva a entrar una cuadrilla. ¿Salir?`))) return;
  S.token = null; S.cuadrilla = null; guardarSesion();
  ir('login');
});

/* ------------------------------------------------------------------ login */
async function cargarCuadrillas() {
  const sel = $('#lgCuadrilla');
  const pinta = lista => {
    sel.innerHTML = '<option value="">Elige tu cuadrilla</option>' + lista.map(c => `<option${c === S.ultima ? ' selected' : ''}>${esc(c)}</option>`).join('');
  };
  if (S.cuadrillas) pinta(S.cuadrillas);
  try {
    const r = await api('cuadrillas', {}, 20000);
    if (r.ok) { S.cuadrillas = r.cuadrillas; guardarSesion(); pinta(r.cuadrillas); }
  } catch (e) {
    if (!S.cuadrillas) sel.innerHTML = '<option value="">Sin conexión con el servidor</option>';
  }
}

$('#lgEntrar').addEventListener('click', async () => {
  const cuadrilla = $('#lgCuadrilla').value, password = $('#lgPass').value.trim();
  if (!cuadrilla || !password) { $('#lgMsg').innerHTML = '<div class="aviso mal">Elige cuadrilla y escribe la contraseña.</div>'; return; }
  $('#lgMsg').innerHTML = '<div class="aviso info"><span class="spinner"></span>Entrando…</div>';
  try {
    const r = await api('login', { cuadrilla, password }, 30000);
    if (!r.ok) { $('#lgMsg').innerHTML = `<div class="aviso mal">${esc(r.error)}</div>`; return; }
    S.token = r.token; S.cuadrilla = r.cuadrilla; S.ultima = r.cuadrilla; guardarSesion();
    $('#lgPass').value = ''; $('#lgMsg').innerHTML = '';
    ir('inicio');
    actualizarBase(false);
    sincronizar();
  } catch (e) {
    $('#lgMsg').innerHTML = '<div class="aviso mal">No hay conexión con el servidor.</div>';
  }
});

$('#cfgGuardar').addEventListener('click', () => {
  const u = $('#cfgUrl').value.trim();
  if (!/^https:\/\/script\.google\.com\/.+\/exec/.test(u)) { toast('La URL debe ser de script.google.com y terminar en /exec'); return; }
  S.api = u; guardarSesion(); ir('login');
});

/* ------------------------------------------------------------------ arranque */
(async function arrancar() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  pintarRed();
  await cargarBaseLocal();
  ABIERTOS = (await DB.get('abiertos')) || [];
  if (!apiUrl()) { ir('config'); return; }
  if (!S.token) { ir('login'); return; }
  ir('inicio');
  const pendiente = await DB.get('actual');
  if (pendiente && pendiente.fila) {
    const ok = await confirmar(`Tienes un cambio sin terminar (cuenta ${pendiente.fila.cuenta}). ¿Continuar con él?`, 'Continuar', 'Descartar');
    if (ok) {
      T = pendiente; iniciarGPS();
      if (T.fotos.despues || T.fotos.antes) irPizarron(T.fotos.antes && T.lectura.antes ? 'despues' : 'antes');
      else irPizarron('antes');
    } else await DB.del('actual');
  } else if (pendiente) await DB.del('actual');
  actualizarBase(true);
  sincronizar();
})();
