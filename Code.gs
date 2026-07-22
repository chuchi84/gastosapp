// ═══════════════════════════════════════════════════════════════════════
//  ITControl Pro — Google Apps Script Backend v2.0
//  Sheet: 1MXWlVfOETOXvaqxI7evb3_ic0v3w0d4s0udogUhJdkU
//  Cambios v2.0: agrega Bajas, Mantenimiento, Soporte, Inventario, Accesorios
// ═══════════════════════════════════════════════════════════════════════

const SHEET_ID = '1MXWlVfOETOXvaqxI7evb3_ic0v3w0d4s0udogUhJdkU';

// ID de cliente OAuth de Google — DEBE coincidir con el del frontend.
// El backend rechaza cualquier token cuyo 'aud' no sea este valor.
const GOOGLE_CLIENT_ID = '821988684861-hoepbnaqu7uopknatvasbajrhqa93eoa.apps.googleusercontent.com';

// Jerarquía de roles. Se aceptan los nombres de ambas hojas (Acceso usa 'titular';
// Usuarios usa 'super_admin' / 'admin_empresa' / 'tecnico' / 'lectura_empresa').
const ROLE_LEVEL = {
  titular:          100,   // superadmin global (todas las empresas)
  super_admin:      100,
  admin:             60,
  admin_empresa:     60,   // administra SU empresa (crea/edita/borra dentro de ella)
  tecnico:           40,   // crea/edita dentro de su empresa
  lector:            20,
  lectura:           20,
  lectura_empresa:   20,   // solo lectura
};
function roleLevel(rol) { return ROLE_LEVEL[(rol || '').toLowerCase().trim()] || 0; }
// ¿Es superadmin global? (ve todas las empresas)
function isSuperRole(rol) {
  const r = (rol || '').toLowerCase().trim();
  return r === 'titular' || r === 'super_admin';
}

// Nivel mínimo por acción. Lo no listado requiere el default (escritura básica = técnico).
const DEFAULT_MIN_ROLE = 'tecnico';
const ACTION_MIN_ROLE = {
  // Lectura: cualquier usuario autorizado
  'load':               'lector',
  'log_add':            'lector',
  'email_notify':       'lector',
  'ia_scan':            'lector',
  'adjunto_download':   'lector',
  // adjunto_upload / adjunto_delete usan el default 'tecnico' (escritura)
  // Administración de la propia empresa: borrar y editar empresa
  'empresa_save':       'admin_empresa',
  'equipo_del':         'admin_empresa',
  'compra_del':         'admin_empresa',
  'asignacion_del':     'admin_empresa',
  'tarea_del':          'admin_empresa',
  'licencia_del':       'admin_empresa',
  'historial_del':      'admin_empresa',
  'programa_mant_del':  'admin_empresa',
  'accesorio_del':      'admin_empresa',
  // Gestión de usuarios: admin de empresa o superior
  'usuario_add':        'admin_empresa',
  'usuario_edit':       'admin_empresa',
  'usuario_del':        'admin_empresa',
  // 'save' (guardado masivo) se restringe además a superadmin dentro de saveConfig.
  'save':               'admin_empresa',
};

const HOJAS = {
  empresas:      'Empresas',
  equipos:       'Equipos',
  compras:       'Compras',
  historial:     'Historial',
  asignaciones:  'Asignaciones',
  licencias:     'Licencias',
  tareas:        'Tareas',
  usuarios:      'Usuarios',
  log:           'Log',
  acceso:        'Acceso',
  bajas:         'Bajas',
  programas_mant:'ProgramasMantenimiento',
  solicitudes_soporte: 'SolicitudesSoporte',
  sesiones_inventario: 'SesionesInventario',
  accesorios:    'Accesorios',
};

const COLS = {
  empresas:     ['id','name','rut','prefix','counter','giro','contacto','email','tel','dir','sedes'],
  equipos:      ['id','co','local_id','area','compra_id','tipo','marca','modelo','serie','estado','specs','campos','software','comentarios','garantia','baja_id','baja_fecha','baja_motivo'],
  compras:      ['id','co','local_id','proveedor','rut_prov','tipo_doc','num_doc','fecha','financiador','quien_pago','forma_pago','monto','estado_pago','metodo_pago','fecha_pago','cobrado_cliente','descripcion','area','equipos_ids','adjunto','adjunto_nombre'],
  historial:    ['id','eq_id','co','local_id','tipo','fecha','tecnico','costo','desc','prox'],
  asignaciones: ['id','eq_id','co','sede_id','ubicacion','persona','cargo','fecha','fecha_dev','estado','obs','firma'],
  licencias:    ['id','co','soft','tipo','prov','n','costo','vence','auto','eqs'],
  tareas:       ['id','co','titulo','desc','cat','prio','estado','asig','limite'],
  usuarios:     ['id','co','nombre','email','rol','password','activo'],
  log:          ['id','co','usuario','accion','modulo','detalle','fecha'],
  acceso:       ['email','nombre','rol','fecha_agregado'],
  bajas:        ['id','eq_id','co','marca','modelo','tipo','serie','motivo','fecha','destino','autoriza','estado_anterior','registrado_en'],
  programas_mant:['id','co','eq_id','tipo_mant','frecuencia','ultima','proxima','notas','creado'],
  solicitudes_soporte:['id','co','nombre','email','equipo_id','titulo','prioridad','desc','estado','fecha','respuesta','tomado_en','resuelto_en','tarea_id'],
  sesiones_inventario:['id','co','fecha','estado','sede_filtro','area_filtro','total','eq_scope','encontrados','discrepancias','no_encontrados','iniciado_en','cerrado_en'],
  accesorios:   ['id','eq_padre','co','tipo','marca','modelo','serie','estado','notas','creado'],
};

// ── ENTRY POINT ──────────────────────────────────────────────────────
function doGet(e)  { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

function handleRequest(e) {
  try {
    const params = e.parameter || {};
    let body = {};
    if (e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); } catch(pe) {}
    } else if (params.body) {
      try { body = JSON.parse(params.body); } catch(pe) {}
    }

    const action = params.action || body.action;
    const token  = params.token  || body.token;
    Logger.log('ITControl action: ' + action);

    // Ping — sin auth
    if (action === 'ping') return jsonResponse({ ok: true, version: '2.0', app: 'ITControl Pro' });

    // Acceso — solo necesita token
    if (action === 'acceso') return jsonResponse(getAcceso(token));

    // Portal público de soporte — sin auth (cualquiera puede crear una solicitud)
    if (action === 'solicitud_publica') {
      return jsonResponse(handlePublicRequest(action, body));
    }

    // Todo lo demás requiere auth
    const user = getUserFromToken(token);
    if (!user) return jsonResponse({ ok: false, error: 'No autorizado' });

    // Control de roles: cada acción exige un nivel mínimo.
    const minRole = ACTION_MIN_ROLE[action] || DEFAULT_MIN_ROLE;
    if (roleLevel(user.rol) < roleLevel(minRole)) {
      return jsonResponse({
        ok: false,
        error: 'Permiso insuficiente para "' + action + '" (requiere rol ' + minRole + ', tu rol: ' + (user.rol || 'ninguno') + ')'
      });
    }

    switch (action) {

      case 'load':
        return jsonResponse(loadAll(user));

      case 'save':
        return jsonResponse(saveConfig(body.data, user));

      // ── EQUIPOS ──
      case 'equipo_add':
        return jsonResponse(addRow(HOJAS.equipos, COLS.equipos, body.equipo, user));
      case 'equipo_edit':
        return jsonResponse(editRow(HOJAS.equipos, COLS.equipos, body.equipo, user));
      case 'equipo_del':
        return jsonResponse(delRow(HOJAS.equipos, COLS.equipos, body.id, user));

      // ── COMPRAS ──
      case 'compra_add':
        return jsonResponse(addRow(HOJAS.compras, COLS.compras, body.compra, user));
      case 'compra_edit':
        return jsonResponse(editRow(HOJAS.compras, COLS.compras, body.compra, user));
      case 'compra_del':
        return jsonResponse(delRow(HOJAS.compras, COLS.compras, body.id, user));

      // ── HISTORIAL ──
      case 'historial_add':
        return jsonResponse(addRow(HOJAS.historial, COLS.historial, body.evento, user));
      case 'historial_del':
        return jsonResponse(delRow(HOJAS.historial, COLS.historial, body.id, user));

      // ── ASIGNACIONES ──
      case 'asignacion_add':
        return jsonResponse(addRow(HOJAS.asignaciones, COLS.asignaciones, body.asignacion, user));
      case 'asignacion_edit':
        return jsonResponse(editRow(HOJAS.asignaciones, COLS.asignaciones, body.asignacion, user));
      case 'asignacion_del':
        return jsonResponse(delRow(HOJAS.asignaciones, COLS.asignaciones, body.id, user));

      // ── EMPRESAS ──
      case 'empresa_save':
        return jsonResponse(saveEmpresa(body.empresa, user));

      // ── TAREAS ──
      case 'tarea_add':
        return jsonResponse(addRow(HOJAS.tareas, COLS.tareas, body.tarea, user));
      case 'tarea_edit':
        return jsonResponse(editRow(HOJAS.tareas, COLS.tareas, body.tarea, user));
      case 'tarea_del':
        return jsonResponse(delRow(HOJAS.tareas, COLS.tareas, body.id, user));

      // ── LICENCIAS ──
      case 'licencia_add':
        return jsonResponse(addRow(HOJAS.licencias, COLS.licencias, body.licencia, user));
      case 'licencia_edit':
        return jsonResponse(editRow(HOJAS.licencias, COLS.licencias, body.licencia, user));
      case 'licencia_del':
        return jsonResponse(delRow(HOJAS.licencias, COLS.licencias, body.id, user));

      // ── BAJAS ──
      case 'baja_add':
        return jsonResponse(addRow(HOJAS.bajas, COLS.bajas, body.baja, user));

      // ── MANTENIMIENTO PREVENTIVO ──
      case 'programa_mant_add':
        return jsonResponse(addRow(HOJAS.programas_mant, COLS.programas_mant, body.programa, user));
      case 'programa_mant_edit':
        return jsonResponse(editRow(HOJAS.programas_mant, COLS.programas_mant, body.programa, user));
      case 'programa_mant_del':
        return jsonResponse(delRow(HOJAS.programas_mant, COLS.programas_mant, body.id, user));

      // ── SOPORTE EXTERNO ──
      // NOTA: solicitud_add NO requiere auth normalmente (viene del portal público)
      // pero aquí queda protegida; el portal público debe usar 'solicitud_publica'
      case 'solicitud_add':
        return jsonResponse(addRow(HOJAS.solicitudes_soporte, COLS.solicitudes_soporte, body.solicitud, user));
      case 'solicitud_edit':
        return jsonResponse(editRow(HOJAS.solicitudes_soporte, COLS.solicitudes_soporte, body.solicitud, user));

      // ── INVENTARIO FÍSICO ──
      case 'sesion_inv_add':
        return jsonResponse(addRow(HOJAS.sesiones_inventario, COLS.sesiones_inventario, body.sesion, user));
      case 'sesion_inv_edit':
        return jsonResponse(editRow(HOJAS.sesiones_inventario, COLS.sesiones_inventario, body.sesion, user));

      // ── ACCESORIOS ──
      case 'accesorio_add':
        return jsonResponse(addRow(HOJAS.accesorios, COLS.accesorios, body.accesorio, user));
      case 'accesorio_del':
        return jsonResponse(delRow(HOJAS.accesorios, COLS.accesorios, body.id, user));

      // ── NOTIFICACIONES EMAIL ──
      case 'email_notify':
        return jsonResponse(enviarEmailNotificacion(body.tipo, body.datos, user));

      // ── PROXY IA (scanner de documentos / QR) ──
      case 'ia_scan':
        return jsonResponse(iaScan(body, user));

      // ── ADJUNTOS (Google Drive) ──
      case 'adjunto_upload':
        return jsonResponse(subirAdjunto(body, user));
      case 'adjunto_download':
        return jsonResponse(descargarAdjunto(body, user));
      case 'adjunto_delete':
        return jsonResponse(borrarAdjunto(body, user));

      // ── LOG ──
      case 'log_add':
        return jsonResponse(addLog(body.entrada, user));

      // ── GESTIÓN DE USUARIOS (por empresa) ──
      case 'usuario_add':
        return jsonResponse(usuarioAdd(body.usuario, user));
      case 'usuario_edit':
        return jsonResponse(usuarioEdit(body.usuario, user));
      case 'usuario_del':
        return jsonResponse(usuarioDel(body.id, user));

      default:
        return jsonResponse({ ok: false, error: 'Acción desconocida: ' + action });
    }
  } catch(err) {
    Logger.log('Error: ' + err.message + '\n' + err.stack);
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ── PORTAL PÚBLICO DE SOPORTE (sin auth) ──────────────────────────────
// Acción especial fuera del switch principal porque no requiere login
function handlePublicRequest(action, body) {
  if (action === 'solicitud_publica') {
    return withLock(function() {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sh = getOrCreateSheet(ss, HOJAS.solicitudes_soporte, COLS.solicitudes_soporte);
    const solic = body.solicitud;
    if (!solic || !solic.nombre || !solic.email) {
      return { ok: false, error: 'Datos incompletos' };
    }
    // Validación básica de email
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(solic.email))) {
      return { ok: false, error: 'Email inválido' };
    }
    // Límites de longitud (anti-spam / anti-payload). El cliente además escapa al mostrar.
    const cap = (v, n) => String(v == null ? '' : v).slice(0, n);
    solic.nombre    = cap(solic.nombre, 120);
    solic.email     = cap(solic.email, 160);
    solic.titulo    = cap(solic.titulo, 200);
    solic.desc      = cap(solic.desc, 4000);
    solic.equipo_id = cap(solic.equipo_id, 60);
    solic.prioridad = ['alta','media','baja'].indexOf(solic.prioridad) >= 0 ? solic.prioridad : 'media';
    // Ignorar cualquier campo de estado/respuesta que venga del cliente público
    delete solic.respuesta; delete solic.tarea_id; delete solic.tomado_en; delete solic.resuelto_en;
    // El id lo genera el servidor (evita colisiones/spoofing)
    solic.id = 'S-' + Date.now() + '-' + Math.floor(Math.random()*1000);
    solic.estado = 'pendiente';
    solic.fecha = solic.fecha || new Date().toISOString();
    const row = COLS.solicitudes_soporte.map(col => {
      const v = solic[col];
      return Array.isArray(v) ? JSON.stringify(v) : (v !== undefined ? v : '');
    });
    ensureRows(sh, 50);
    sh.appendRow(row);
    return { ok: true, id: solic.id };
    }); // withLock
  }
  return { ok: false, error: 'Acción pública desconocida' };
}

// ── AUTH ─────────────────────────────────────────────────
// Verifica el ID token de Google del lado servidor: Google valida la firma
// y la expiración en su endpoint tokeninfo. Nosotros además exigimos que:
//   - aud coincida con nuestro GOOGLE_CLIENT_ID
//   - el email esté verificado
//   - el token no esté expirado
// Nunca se confía en un JWT decodificado sin verificar (eso permitía suplantación).
function getEmailFromToken(token) {
  if (!token) return null;
  try {
    const res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) {
      Logger.log('tokeninfo status ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
      return null;
    }
    const info = JSON.parse(res.getContentText());

    // 1) Audience: el token debe haber sido emitido para NUESTRA app.
    if (info.aud !== GOOGLE_CLIENT_ID) {
      Logger.log('aud inválido: ' + info.aud);
      return null;
    }
    // 2) Emisor debe ser Google.
    if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') {
      Logger.log('iss inválido: ' + info.iss);
      return null;
    }
    // 3) Expiración (tokeninfo ya la valida, pero reforzamos).
    if (info.exp && (parseInt(info.exp, 10) * 1000) < Date.now()) {
      Logger.log('token expirado');
      return null;
    }
    // 4) Email verificado.
    if (!info.email || String(info.email_verified) !== 'true') {
      Logger.log('email no verificado');
      return null;
    }
    return info.email;
  } catch (e) {
    Logger.log('tokeninfo error: ' + e.message);
    return null;
  }
}

function getUserFromToken(token) {
  const email = getEmailFromToken(token);
  if (!email) return null;
  return resolveUser(email);
}

// Resuelve el usuario combinando la hoja Acceso (allow-list + rol base) y
// la hoja Usuarios (perfil + empresa asignada). Devuelve el alcance de empresas:
//   scopeAll = true  → ve TODAS las empresas (superadmin/titular)
//   co       = 'cX'  → ve SOLO esa empresa
function resolveUser(email) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const key = (email || '').toLowerCase().trim();

  // 1) Acceso: allow-list + rol base
  let base = null;
  const shA = ss.getSheetByName(HOJAS.acceso);
  if (shA) {
    const rows = shA.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || '').toLowerCase().trim() === key) {
        base = { email: rows[i][0], nombre: rows[i][1], rol: rows[i][2] };
        break;
      }
    }
  }

  // 2) Usuarios: perfil + empresa
  let perfil = null;
  const shU = ss.getSheetByName(HOJAS.usuarios);
  if (shU && shU.getLastRow() > 1) {
    const idx = {}; COLS.usuarios.forEach((c, i) => idx[c] = i);
    const rows = shU.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][idx.email] || '').toLowerCase().trim() === key) {
        perfil = {
          id:     rows[i][idx.id],
          co:     rows[i][idx.co],
          nombre: rows[i][idx.nombre],
          rol:    rows[i][idx.rol],
          activo: rows[i][idx.activo],
        };
        break;
      }
    }
  }

  // No autorizado si no aparece en ninguna hoja
  if (!base && !perfil) return null;
  // Usuario explícitamente desactivado
  if (perfil && String(perfil.activo).toLowerCase() === 'false') return null;

  const rol    = (perfil && perfil.rol) || (base && base.rol) || 'lectura_empresa';
  const nombre = (perfil && perfil.nombre) || (base && base.nombre) || email;

  // Alcance de empresas
  let scopeAll = false;
  let co = null;
  if (isSuperRole(rol)) {
    scopeAll = true;
  } else if (perfil) {
    if (String(perfil.co).toLowerCase().trim() === 'todas') scopeAll = true;
    else co = perfil.co ? String(perfil.co) : null;
  }
  // Si está en Acceso pero sin perfil y no es superadmin → sin empresa (no ve datos)

  return { email: (base && base.email) || email, nombre, rol, co, scopeAll,
           usuario_id: perfil && perfil.id };
}

// ¿El usuario puede acceder a registros de esta empresa?
function canAccessCo(user, co) {
  if (!user) return false;
  if (user.scopeAll) return true;
  return user.co != null && String(co).trim() === String(user.co).trim();
}

function getAcceso(token) {
  try {
    const email = getEmailFromToken(token);
    if (!email) return { ok: false, error: 'No se pudo obtener email del token' };
    const user = resolveUser(email);
    if (!user) return { ok: false, error: 'Email no autorizado: ' + email };
    // Nunca devolver datos internos de más; solo lo que el frontend necesita.
    return { ok: true, user: {
      email: user.email, nombre: user.nombre, rol: user.rol,
      co: user.co, scopeAll: user.scopeAll
    }};
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ── LOAD ALL ─────────────────────────────────────────────────────────
function loadAll(user) {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // Filtro por empresa: solo filas de las empresas que el usuario puede ver.
  const scope = (arr) => user.scopeAll ? arr : arr.filter(r => canAccessCo(user, r.co));

  // Empresas visibles: todas (superadmin) o solo la propia.
  const todasEmpresas = loadEmpresas(ss);
  let empresas;
  if (user.scopeAll) {
    empresas = todasEmpresas;
  } else {
    empresas = {};
    if (user.co && todasEmpresas[user.co]) empresas[user.co] = todasEmpresas[user.co];
  }

  // Usuarios: solo los de la misma empresa, y NUNCA con contraseña.
  const usuarios = scope(sheetToArray(ss, HOJAS.usuarios, COLS.usuarios))
    .map(u => { const c = Object.assign({}, u); delete c.password; return c; });

  // Auditoría: filtrada por empresa y acotada a los últimos 300 registros.
  const logAll = scope(sheetToArray(ss, HOJAS.log, COLS.log));
  const log = logAll.slice(-300).reverse(); // más reciente primero

  return {
    ok:           true,
    user:         { email:user.email, nombre:user.nombre, rol:user.rol, co:user.co, scopeAll:user.scopeAll },
    empresas:     empresas,
    equipos:      scope(sheetToArray(ss, HOJAS.equipos,      COLS.equipos)),
    compras:      scope(sheetToArray(ss, HOJAS.compras,      COLS.compras)),
    historial:    scope(sheetToArray(ss, HOJAS.historial,    COLS.historial)),
    asignaciones: scope(sheetToArray(ss, HOJAS.asignaciones, COLS.asignaciones)),
    licencias:    scope(sheetToArray(ss, HOJAS.licencias,    COLS.licencias)),
    tareas:       scope(sheetToArray(ss, HOJAS.tareas,       COLS.tareas)),
    usuarios:     usuarios,
    bajas:                scope(sheetToArray(ss, HOJAS.bajas,                COLS.bajas)),
    programas_mant:       scope(sheetToArray(ss, HOJAS.programas_mant,       COLS.programas_mant)),
    solicitudes_soporte:  scope(sheetToArray(ss, HOJAS.solicitudes_soporte,  COLS.solicitudes_soporte)),
    sesiones_inventario:  scope(sheetToArray(ss, HOJAS.sesiones_inventario,  COLS.sesiones_inventario)),
    accesorios:           scope(sheetToArray(ss, HOJAS.accesorios,           COLS.accesorios)),
    log:                  log,
  };
}

// ── SAVE CONFIG ───────────────────────────────────────────────────────
// Guardado masivo: reescribe hojas completas, así que SOLO el superadmin/titular
// puede usarlo. Un admin de empresa usa las acciones granulares (equipo_add, etc.)
// que sí respetan el aislamiento por empresa.
function saveConfig(data, user) {
  return withLock(function() {
  if (!data) return { ok: false, error: 'Sin datos' };
  if (!user.scopeAll) {
    return { ok: false, error: 'Guardado masivo restringido al titular. Usa las acciones por registro.' };
  }
  const ss = SpreadsheetApp.openById(SHEET_ID);
  if (data.empresas)  saveEmpresas(ss, data.empresas);
  if (data.licencias) arrayToSheet(ss, HOJAS.licencias, COLS.licencias, data.licencias);
  if (data.tareas)    arrayToSheet(ss, HOJAS.tareas,    COLS.tareas,    data.tareas);
  if (data.usuarios) {
    // Preservar el password existente cuando el cliente no lo envía
    // (nunca se envía al cliente, así que sin esto se borraría).
    const prev = sheetToArray(ss, HOJAS.usuarios, COLS.usuarios);
    const prevById = {};
    prev.forEach(u => { if (u.id) prevById[String(u.id)] = u; });
    const merged = data.usuarios.map(u => {
      const anterior = prevById[String(u.id)];
      if ((u.password === undefined || u.password === '') && anterior && anterior.password) {
        return Object.assign({}, u, { password: anterior.password });
      }
      return u;
    });
    arrayToSheet(ss, HOJAS.usuarios, COLS.usuarios, merged);
  }
  return { ok: true };
  }); // withLock
}

// ── EMPRESA OPS ───────────────────────────────────────────────────────
function loadEmpresas(ss) {
  const sh = ss.getSheetByName(HOJAS.empresas);
  if (!sh || sh.getLastRow() <= 1) return {};
  const obj = {};
  sh.getDataRange().getValues().slice(1)
    .filter(r => r[0])
    .forEach(r => {
      const emp = {};
      COLS.empresas.forEach((col, i) => {
        let v = r[i];
        if (col === 'sedes' || col === 'specs' || col === 'campos') {
          if (typeof v === 'string' && v) { try { v = JSON.parse(v); } catch(e) { v = []; } }
          else v = [];
        }
        emp[col] = v;
      });
      if (!Array.isArray(emp.sedes)) emp.sedes = [];
      obj[emp.id] = emp;
    });
  return obj;
}

function saveEmpresas(ss, empresas) {
  const sh = getOrCreateSheet(ss, HOJAS.empresas, COLS.empresas);
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  const rows = Object.values(empresas).map(emp =>
    COLS.empresas.map(col => {
      const v = emp[col];
      if (col === 'sedes') return JSON.stringify(v || []);
      return v !== undefined ? v : '';
    })
  );
  if (rows.length) {
    ensureRows(sh, rows.length + 50);
    sh.getRange(2, 1, rows.length, COLS.empresas.length).setValues(rows);
  }
}

function saveEmpresa(empresa, user) {
  return withLock(function() {
  if (!empresa || !empresa.id) return { ok: false, error: 'Sin ID' };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const empresas = loadEmpresas(ss);
  const yaExiste = !!empresas[empresa.id];

  if (!user.scopeAll) {
    // Un admin de empresa solo puede editar SU empresa; no crear otras.
    if (!yaExiste) return { ok: false, error: 'Solo el titular puede crear nuevas empresas' };
    if (!canAccessCo(user, empresa.id)) return { ok: false, error: 'Sin permiso sobre esta empresa' };
  }

  empresas[empresa.id] = empresa;
  saveEmpresas(ss, empresas);
  _auditInterno(user, 'Empresas', yaExiste ? 'editar' : 'crear', empresa.id, empresa.id);
  return { ok: true };
  }); // withLock
}

// ── CONCURRENCIA Y VALIDACIÓN ─────────────────────────────────────────
// Serializa las escrituras para que dos usuarios simultáneos no corrompan filas.
function withLock(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000); // hasta 15s esperando el turno
  } catch (e) {
    return { ok: false, error: 'Sistema ocupado, reintenta en unos segundos' };
  }
  try {
    return fn();
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// Validación/normalización básica del lado servidor. Devuelve {ok} o {ok:false,error}.
// No confía en el cliente: coacciona números, recorta strings y valida formatos.
function validarYNormalizar(hoja, data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'Datos inválidos' };
  const cap = (v, n) => (v == null ? v : String(v).slice(0, n));
  const num = (v) => {
    if (v === '' || v === null || v === undefined) return v;
    const n = Number(String(v).replace(/[^\d.-]/g, ''));
    return isNaN(n) ? 0 : n;
  };
  // Campos monetarios / numéricos comunes
  ['monto', 'costo'].forEach(k => { if (data[k] !== undefined) data[k] = num(data[k]); });
  // Email si viene
  if (data.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(data.email))) {
    return { ok: false, error: 'Email inválido' };
  }
  // Límites de longitud defensivos en campos de texto libre habituales
  ['nombre','titulo','desc','descripcion','comentarios','notas','motivo','obs','persona','proveedor']
    .forEach(k => { if (data[k] !== undefined) data[k] = cap(data[k], 5000); });
  return { ok: true };
}

// Registro de auditoría interno (server-side, fuente de verdad). Se llama
// automáticamente desde el CRUD; no depende de que el cliente lo pida.
function _auditInterno(user, modulo, accion, detalle, co) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sh = getOrCreateSheet(ss, HOJAS.log, COLS.log);
    ensureRows(sh, 50);
    const empresa = co != null ? co : (user.scopeAll ? '' : (user.co || ''));
    sh.appendRow([Date.now(), empresa, user.email, accion, modulo, detalle || '', new Date().toISOString()]);
  } catch (e) { Logger.log('audit error: ' + e.message); }
}

// ── CRUD GENÉRICO ─────────────────────────────────────────────────────
function addRow(hoja, cols, data, user) {
  return withLock(function() {
  if (!data) return { ok: false, error: 'Sin datos' };
  const v = validarYNormalizar(hoja, data);
  if (!v.ok) return v;
  const coIdx = cols.indexOf('co');
  if (coIdx >= 0) {
    if (user.scopeAll) {
      if (!data.co) return { ok: false, error: 'Falta empresa (co)' };
    } else {
      if (!user.co) return { ok: false, error: 'Usuario sin empresa asignada' };
      data.co = user.co; // forzar la empresa del usuario, ignorar lo que llegue
    }
  }
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = getOrCreateSheet(ss, hoja, cols);
  if (!data.id) data.id = hoja.slice(0,3).toUpperCase() + '-' + Utilities.getUuid().slice(0,8);
  const row = cols.map(col => {
    const v = data[col];
    return Array.isArray(v) ? JSON.stringify(v) : (v !== undefined ? v : '');
  });
  ensureRows(sh, 100);
  sh.appendRow(row);
  _auditInterno(user, hoja, 'crear', data.id, coIdx >= 0 ? data.co : null);
  return { ok: true, id: data.id };
  }); // withLock
}

function editRow(hoja, cols, data, user) {
  return withLock(function() {
  if (!data || !data.id) return { ok: false, error: 'Sin ID' };
  const v = validarYNormalizar(hoja, data);
  if (!v.ok) return v;
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(hoja);
  if (!sh) return { ok: false, error: 'Registro no encontrado' };
  const rows = sh.getDataRange().getValues();
  const idCol = cols.indexOf('id');
  const coIdx = cols.indexOf('co');
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idCol]) === String(data.id)) {
      // Verificar que el registro existente pertenezca a una empresa accesible.
      if (coIdx >= 0 && !canAccessCo(user, rows[i][coIdx])) {
        return { ok: false, error: 'Sin acceso a este registro' };
      }
      // No permitir mover el registro a otra empresa.
      if (coIdx >= 0) data.co = user.scopeAll ? (data.co || rows[i][coIdx]) : user.co;
      const row = cols.map(col => {
        const v = data[col];
        return Array.isArray(v) ? JSON.stringify(v) : (v !== undefined ? v : '');
      });
      sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
      _auditInterno(user, hoja, 'editar', data.id, coIdx >= 0 ? data.co : null);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Registro no encontrado' };
  }); // withLock
}

function delRow(hoja, cols, id, user) {
  return withLock(function() {
  if (!id) return { ok: false, error: 'Sin ID' };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(hoja);
  if (!sh) return { ok: false, error: 'Hoja no existe' };
  const rows = sh.getDataRange().getValues();
  const idCol = cols.indexOf('id');
  const coIdx = cols.indexOf('co');
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][idCol]) === String(id)) {
      // No permitir borrar registros de otra empresa.
      if (coIdx >= 0 && !canAccessCo(user, rows[i][coIdx])) {
        return { ok: false, error: 'Sin acceso a este registro' };
      }
      sh.deleteRow(i + 1);
      _auditInterno(user, hoja, 'eliminar', id, coIdx >= 0 ? rows[i][coIdx] : null);
      return { ok: true };
    }
  }
  return { ok: false, error: 'No encontrado' };
  }); // withLock
}

function addLog(entrada, user) {
  return withLock(function() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = getOrCreateSheet(ss, HOJAS.log, COLS.log);
  ensureRows(sh, 50);
  // La empresa del log es siempre la del usuario (salvo superadmin que puede indicarla).
  const co = user.scopeAll ? (entrada.co || '') : (user.co || '');
  sh.appendRow([
    Date.now(), co, user.email,
    entrada.accion || '', entrada.modulo || '',
    entrada.detalle || '', new Date().toISOString()
  ]);
  return { ok: true };
  }); // withLock
}

// ── NOTIFICACIONES EMAIL ───────────────────────────────────────────────
function enviarEmailNotificacion(tipo, datos, user) {
  if (!datos || !datos.email) return { ok: false, error: 'Sin email destino' };

  let asunto = '', cuerpo = '';
  const empresa = datos.empresa || '';

  switch (tipo) {
    case 'prueba':
      asunto = '[ITControl Pro] Notificación de prueba — ' + empresa;
      cuerpo = 'Esta es una notificación de prueba desde ITControl Pro.\n\n'
             + 'Empresa: ' + empresa + '\n'
             + 'Enviado por: ' + (user.nombre || user.email) + '\n'
             + 'Fecha: ' + new Date().toLocaleString('es-CL');
      break;

    case 'alertas':
      asunto = '[ITControl Pro] ' + (datos.alertas||[]).length + ' alertas activas — ' + empresa;
      cuerpo = 'Resumen de alertas para ' + empresa + ':\n\n'
             + (datos.alertas||[]).map(a => '• [' + a.nivel.toUpperCase() + '] ' + a.titulo + ' — ' + a.det).join('\n');
      break;

    case 'garantias':
      asunto = '[ITControl Pro] Garantías próximas a vencer — ' + empresa;
      cuerpo = 'Equipos con garantía próxima a vencer en ' + empresa + ':\n\n'
             + (datos.equipos||[]).map(e =>
                 '• ' + e.id + ' — ' + e.marca + ' ' + e.modelo +
                 ' — Vence: ' + e.garantia + ' (' + (e.dias<0?'VENCIDA':e.dias+' días') + ')'
               ).join('\n');
      break;

    case 'mantenimiento':
      asunto = '[ITControl Pro] Mantenciones programadas — ' + empresa;
      cuerpo = 'Programas de mantención preventiva en ' + empresa + ':\n\n'
             + (datos.programas||[]).map(p =>
                 '• ' + p.eq_id + ' — ' + p.tipo_mant + ' — Próxima: ' + (p.proxima||'sin fecha')
               ).join('\n');
      break;

    case 'soporte':
      asunto = '[ITControl Pro] ' + (datos.solicitudes||[]).length + ' solicitudes de soporte pendientes — ' + empresa;
      cuerpo = 'Solicitudes de soporte pendientes en ' + empresa + ':\n\n'
             + (datos.solicitudes||[]).map(s =>
                 '• ' + s.titulo + ' — ' + s.nombre + ' (' + s.email + ') — Prioridad: ' + s.prioridad
               ).join('\n');
      break;

    default:
      return { ok: false, error: 'Tipo de notificación desconocido' };
  }

  try {
    MailApp.sendEmail({
      to: datos.email,
      subject: asunto,
      body: cuerpo,
    });
    return { ok: true };
  } catch(e) {
    Logger.log('Email error: ' + e.message);
    return { ok: false, error: 'Error enviando email: ' + e.message };
  }
}

// ── ADJUNTOS EN GOOGLE DRIVE ───────────────────────────────────────────
// Los archivos se guardan PRIVADOS en Drive (carpeta "ITControl Adjuntos").
// En la hoja Compras solo se guarda el fileId (columna adjunto) y el nombre.
// La descarga pasa por el backend y valida que el usuario pertenezca a la
// empresa de la compra, así el aislamiento se mantiene (nadie accede por link).
function _carpetaAdjuntos() {
  const nombre = 'ITControl Adjuntos';
  const it = DriveApp.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : DriveApp.createFolder(nombre);
}

function _buscarCompraRow(ss, compraId) {
  const sh = ss.getSheetByName(HOJAS.compras);
  if (!sh) return null;
  const rows = sh.getDataRange().getValues();
  const idIdx = COLS.compras.indexOf('id');
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idIdx]) === String(compraId)) return { sh, rowNum: i + 1, row: rows[i] };
  }
  return null;
}

function subirAdjunto(body, user) {
  return withLock(function() {
    const { compra_id, filename, mime, data_b64 } = body;
    if (!compra_id || !data_b64) return { ok: false, error: 'Faltan datos del adjunto' };
    if (data_b64.length > 14000000) return { ok: false, error: 'Archivo demasiado grande (máx ~10MB)' };

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const found = _buscarCompraRow(ss, compra_id);
    if (!found) return { ok: false, error: 'Compra no encontrada' };

    const coIdx = COLS.compras.indexOf('co');
    if (!canAccessCo(user, found.row[coIdx])) return { ok: false, error: 'Sin acceso a esta compra' };

    // Borrar adjunto anterior si existía
    const adjIdx = COLS.compras.indexOf('adjunto');
    const anterior = found.row[adjIdx];
    if (anterior) { try { DriveApp.getFileById(anterior).setTrashed(true); } catch (e) {} }

    const nombre = (filename || 'documento').slice(0, 120);
    const blob = Utilities.newBlob(Utilities.base64Decode(data_b64), mime || 'application/octet-stream', nombre);
    const archivo = _carpetaAdjuntos().createFile(blob);
    // Privado por defecto (hereda permisos de la carpeta del dueño). No se comparte por link.

    const nomIdx = COLS.compras.indexOf('adjunto_nombre');
    found.sh.getRange(found.rowNum, adjIdx + 1).setValue(archivo.getId());
    found.sh.getRange(found.rowNum, nomIdx + 1).setValue(nombre);
    return { ok: true, fileId: archivo.getId(), nombre: nombre };
  });
}

function descargarAdjunto(body, user) {
  const compraId = body.compra_id;
  if (!compraId) return { ok: false, error: 'Sin compra' };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const found = _buscarCompraRow(ss, compraId);
  if (!found) return { ok: false, error: 'Compra no encontrada' };
  const coIdx = COLS.compras.indexOf('co');
  if (!canAccessCo(user, found.row[coIdx])) return { ok: false, error: 'Sin acceso a esta compra' };

  const adjIdx = COLS.compras.indexOf('adjunto');
  const fileId = found.row[adjIdx];
  if (!fileId) return { ok: false, error: 'Sin adjunto' };
  try {
    const f = DriveApp.getFileById(fileId);
    const blob = f.getBlob();
    return {
      ok: true,
      filename: f.getName(),
      mime: blob.getContentType(),
      data_b64: Utilities.base64Encode(blob.getBytes()),
    };
  } catch (e) {
    return { ok: false, error: 'No se pudo leer el archivo: ' + e.message };
  }
}

function borrarAdjunto(body, user) {
  return withLock(function() {
    const compraId = body.compra_id;
    if (!compraId) return { ok: false, error: 'Sin compra' };
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const found = _buscarCompraRow(ss, compraId);
    if (!found) return { ok: false, error: 'Compra no encontrada' };
    const coIdx = COLS.compras.indexOf('co');
    if (!canAccessCo(user, found.row[coIdx])) return { ok: false, error: 'Sin acceso a esta compra' };

    const adjIdx = COLS.compras.indexOf('adjunto');
    const nomIdx = COLS.compras.indexOf('adjunto_nombre');
    const fileId = found.row[adjIdx];
    if (fileId) { try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {} }
    found.sh.getRange(found.rowNum, adjIdx + 1).setValue('');
    found.sh.getRange(found.rowNum, nomIdx + 1).setValue('');
    return { ok: true };
  });
}

// ── PROXY IA ───────────────────────────────────────────────────────────
// Llama a la API de Anthropic desde el servidor para que la API key nunca
// viaje al navegador. Configura la key una vez con:
//   Extensiones → Apps Script → Configuración del proyecto → Propiedades del script
//   Propiedad: ANTHROPIC_API_KEY   Valor: sk-ant-...
// body: { image_b64, media_type, prompt }
function iaScan(body, user) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) return { ok: false, error: 'IA no configurada (falta ANTHROPIC_API_KEY en Propiedades del script)' };

  const imageB64 = body.image_b64;
  const mediaType = body.media_type || 'image/jpeg';
  const prompt = body.prompt || 'Describe la imagen.';
  if (!imageB64) return { ok: false, error: 'Sin imagen' };

  try {
    const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      payload: JSON.stringify({
        model: body.model || 'claude-sonnet-4-6',
        max_tokens: body.max_tokens || 600,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageB64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });
    if (res.getResponseCode() !== 200) {
      Logger.log('Anthropic error ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
      return { ok: false, error: 'IA respondió ' + res.getResponseCode() };
    }
    const data = JSON.parse(res.getContentText());
    const txt = (data.content || []).map(b => b.text || '').join('');
    return { ok: true, text: txt };
  } catch (e) {
    Logger.log('iaScan error: ' + e.message);
    return { ok: false, error: 'Error IA: ' + e.message };
  }
}

// ── HELPERS ──────────────────────────────────────────────────────────
function sheetToArray(ss, nombre, cols) {
  const sh = ss.getSheetByName(nombre);
  if (!sh || sh.getLastRow() <= 1) return [];
  return sh.getDataRange().getValues().slice(1)
    .filter(row => row.some(c => c !== '' && c !== null && c !== undefined))
    .map(row => {
      const obj = {};
      cols.forEach((col, i) => {
        let v = row[i];
        if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
          try { v = JSON.parse(v); } catch(e) {}
        }
        obj[col] = v;
      });
      return obj;
    });
}

function arrayToSheet(ss, nombre, cols, data) {
  const sh = getOrCreateSheet(ss, nombre, cols);
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  if (!data || !data.length) return;
  const rows = data.map(obj => cols.map(col => {
    const v = obj[col];
    return Array.isArray(v) ? JSON.stringify(v) : (v !== undefined ? v : '');
  }));
  ensureRows(sh, rows.length + 50);
  sh.getRange(2, 1, rows.length, cols.length).setValues(rows);
}

function ensureRows(sh, minFree) {
  try {
    const free = sh.getMaxRows() - sh.getLastRow();
    if (free < minFree) sh.insertRowsAfter(sh.getMaxRows(), minFree - free + 200);
  } catch(e) { Logger.log('ensureRows error: ' + e.message); }
}

function getOrCreateSheet(ss, nombre, cols) {
  let sh = ss.getSheetByName(nombre);
  if (!sh) {
    sh = ss.insertSheet(nombre);
    sh.appendRow(cols);
    sh.getRange(1, 1, 1, cols.length)
      .setBackground('#1a1a2e').setFontColor('#ffffff').setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── SETUP INICIAL ─────────────────────────────────────────────────────
// Ejecutar una vez para crear todas las hojas y agregar al titular.
// Re-ejecutable: crea hojas nuevas sin afectar las existentes.
function setupInicial() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  Object.entries(COLS).forEach(([nombre, cols]) => {
    const hoja = HOJAS[nombre] || nombre;
    getOrCreateSheet(ss, hoja, cols);
    Logger.log('OK: ' + hoja);
  });
  // Agregar titular (superadmin global)
  const shAcceso = ss.getSheetByName(HOJAS.acceso);
  const email = 'mciappaf@gmail.com';
  const rows = shAcceso.getDataRange().getValues();
  if (!rows.slice(1).some(r => r[0] === email)) {
    shAcceso.appendRow([email, 'Cristóbal', 'titular', new Date().toISOString()]);
    Logger.log('✅ Titular agregado: ' + email);
  }
  Logger.log('✅ ITControl Pro setup completado');
}

// ── RESPALDOS Y TAREAS PROGRAMADAS ────────────────────────────────────
// Ejecuta crearTriggers() UNA vez para activar respaldo y avisos automáticos.
function crearTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (['respaldoDiario','notificacionesDiarias'].indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('respaldoDiario').timeBased().everyDays(1).atHour(3).create();
  ScriptApp.newTrigger('notificacionesDiarias').timeBased().everyDays(1).atHour(8).create();
  Logger.log('✅ Triggers creados: respaldo 03:00, notificaciones 08:00');
}

// Copia el spreadsheet a una carpeta "ITControl Backups" en Drive y conserva
// solo los últimos 30 respaldos.
function respaldoDiario() {
  try {
    const src = DriveApp.getFileById(SHEET_ID);
    const folders = DriveApp.getFoldersByName('ITControl Backups');
    const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('ITControl Backups');
    const fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm');
    src.makeCopy('ITControl_backup_' + fecha, folder);
    const files = [];
    const it = folder.getFiles();
    while (it.hasNext()) files.push(it.next());
    files.sort((a, b) => b.getDateCreated() - a.getDateCreated());
    files.slice(30).forEach(f => folder.removeFile(f));
    Logger.log('✅ Respaldo creado: ' + fecha);
  } catch (e) {
    Logger.log('Error respaldo: ' + e.message);
  }
}

// Envía a cada empresa (a su email de contacto) un resumen de garantías/licencias
// por vencer, mantenciones próximas y solicitudes de soporte pendientes.
function notificacionesDiarias() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const empresas = loadEmpresas(ss);
  const hoy = new Date();
  const enDias = (f) => {
    if (!f) return null;
    const d = new Date(f);
    if (isNaN(d)) return null;
    return Math.round((d - hoy) / 86400000);
  };
  const equipos     = sheetToArray(ss, HOJAS.equipos, COLS.equipos);
  const licencias   = sheetToArray(ss, HOJAS.licencias, COLS.licencias);
  const programas   = sheetToArray(ss, HOJAS.programas_mant, COLS.programas_mant);
  const solicitudes = sheetToArray(ss, HOJAS.solicitudes_soporte, COLS.solicitudes_soporte);

  Object.values(empresas).forEach(emp => {
    if (!emp.email) return;
    const co = emp.id;
    const garant = equipos.filter(e => e.co===co && enDias(e.garantia)!==null && enDias(e.garantia) <= 30);
    const lic    = licencias.filter(l => l.co===co && enDias(l.vence)!==null && enDias(l.vence) <= 30);
    const mant   = programas.filter(p => p.co===co && enDias(p.proxima)!==null && enDias(p.proxima) <= 7);
    const sop    = solicitudes.filter(s => s.co===co && s.estado==='pendiente');
    if (!garant.length && !lic.length && !mant.length && !sop.length) return;

    let cuerpo = 'Resumen diario de ITControl Pro — ' + (emp.name||co) + '\n\n';
    if (garant.length) {
      cuerpo += 'Garantías por vencer (' + garant.length + '):\n'
        + garant.map(e => '  - ' + e.id + ' ' + (e.marca||'') + ' ' + (e.modelo||'')
            + ' — ' + (enDias(e.garantia)<0?'VENCIDA':enDias(e.garantia)+' días')).join('\n') + '\n\n';
    }
    if (lic.length) {
      cuerpo += 'Licencias por vencer (' + lic.length + '):\n'
        + lic.map(l => '  - ' + (l.soft||l.id) + ' — ' + (enDias(l.vence)<0?'VENCIDA':enDias(l.vence)+' días')).join('\n') + '\n\n';
    }
    if (mant.length) {
      cuerpo += 'Mantenciones próximas (' + mant.length + '):\n'
        + mant.map(p => '  - ' + (p.eq_id||'') + ' ' + (p.tipo_mant||'') + ' — ' + (p.proxima||'')).join('\n') + '\n\n';
    }
    if (sop.length) {
      cuerpo += 'Solicitudes de soporte pendientes (' + sop.length + '):\n'
        + sop.map(s => '  - ' + (s.titulo||'') + ' — ' + (s.nombre||'')).join('\n') + '\n\n';
    }
    try {
      MailApp.sendEmail({
        to: emp.email,
        subject: '[ITControl Pro] Resumen diario — ' + (emp.name||co),
        body: cuerpo,
      });
    } catch (e) { Logger.log('Email a ' + emp.email + ' falló: ' + e.message); }
  });
  Logger.log('✅ Notificaciones diarias enviadas');
}

// ── GESTIÓN DE USUARIOS POR EMPRESA (acciones de la app) ──────────────
// Reglas:
//  - Un admin_empresa solo gestiona usuarios de SU empresa (co forzado).
//  - Un admin_empresa NO puede crear/ascender a super_admin (anti-escalada).
//  - El superadmin puede gestionar cualquier empresa y asignar 'todas'.
//  - Nunca se maneja password aquí (el acceso es por Google + hoja Acceso/Usuarios).
const ROLES_ASIGNABLES = ['super_admin','admin_empresa','tecnico','lectura_empresa'];

function _usuarioValidar(u, user, existente) {
  if (!u || !u.email || !u.nombre) return 'Nombre y email son obligatorios';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(u.email))) return 'Email inválido';
  const rol = (u.rol || 'lectura_empresa').toLowerCase().trim();
  if (ROLES_ASIGNABLES.indexOf(rol) < 0) return 'Rol inválido';
  // Anti-escalada: solo superadmin puede crear/ascender superadmins o asignar 'todas'.
  if (!user.scopeAll) {
    if (isSuperRole(rol)) return 'No puedes asignar el rol super admin';
    if (String(u.co).toLowerCase().trim() === 'todas') return 'No puedes asignar la empresa "todas"';
  }
  return null;
}

function usuarioAdd(u, user) {
  return withLock(function() {
    const err = _usuarioValidar(u, user);
    if (err) return { ok: false, error: err };
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sh = getOrCreateSheet(ss, HOJAS.usuarios, COLS.usuarios);
    const idx = {}; COLS.usuarios.forEach((c, i) => idx[c] = i);

    // Empresa: forzada para admin de empresa
    u.co = user.scopeAll ? (u.co || '') : user.co;
    if (!u.co) return { ok: false, error: 'Falta empresa' };

    // Email único
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][idx.email]||'').toLowerCase().trim() === String(u.email).toLowerCase().trim()) {
        return { ok: false, error: 'Ya existe un usuario con ese email' };
      }
    }
    const id = u.id || ('U-' + Utilities.getUuid().slice(0,8));
    const fila = COLS.usuarios.map(c => {
      if (c === 'id') return id;
      if (c === 'password') return '';           // el acceso es por Google
      if (c === 'activo') return u.activo === undefined ? true : u.activo;
      return u[c] !== undefined ? u[c] : '';
    });
    ensureRows(sh, 50);
    sh.appendRow(fila);
    _auditInterno(user, 'Usuarios', 'crear', u.email + ' (' + u.rol + ')', u.co);
    return { ok: true, id: id };
  });
}

function usuarioEdit(u, user) {
  return withLock(function() {
    if (!u || !u.id) return { ok: false, error: 'Sin ID' };
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sh = ss.getSheetByName(HOJAS.usuarios);
    if (!sh) return { ok: false, error: 'No hay usuarios' };
    const idx = {}; COLS.usuarios.forEach((c, i) => idx[c] = i);
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][idx.id]) === String(u.id)) {
        const coActual = rows[i][idx.co];
        // Debe pertenecer a una empresa accesible
        if (!canAccessCo(user, coActual)) return { ok: false, error: 'Sin acceso a este usuario' };
        const err = _usuarioValidar(u, user, rows[i]);
        if (err) return { ok: false, error: err };
        // No mover de empresa salvo superadmin
        u.co = user.scopeAll ? (u.co || coActual) : user.co;
        const fila = COLS.usuarios.map(c => {
          if (c === 'password') return rows[i][idx.password] || ''; // preservar
          if (c === 'id') return u.id;
          return u[c] !== undefined ? u[c] : rows[i][idx[c]];
        });
        sh.getRange(i + 1, 1, 1, fila.length).setValues([fila]);
        _auditInterno(user, 'Usuarios', 'editar', u.email + ' (' + u.rol + ')', u.co);
        return { ok: true };
      }
    }
    return { ok: false, error: 'Usuario no encontrado' };
  });
}

function usuarioDel(id, user) {
  return withLock(function() {
    if (!id) return { ok: false, error: 'Sin ID' };
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sh = ss.getSheetByName(HOJAS.usuarios);
    if (!sh) return { ok: false, error: 'No hay usuarios' };
    const idx = {}; COLS.usuarios.forEach((c, i) => idx[c] = i);
    const rows = sh.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (String(rows[i][idx.id]) === String(id)) {
        if (!canAccessCo(user, rows[i][idx.co])) return { ok: false, error: 'Sin acceso a este usuario' };
        // No permitir borrarse a sí mismo
        if (String(rows[i][idx.email]||'').toLowerCase().trim() === String(user.email).toLowerCase().trim()) {
          return { ok: false, error: 'No puedes eliminar tu propio usuario' };
        }
        sh.deleteRow(i + 1);
        _auditInterno(user, 'Usuarios', 'eliminar', rows[i][idx.email], rows[i][idx.co]);
        return { ok: true };
      }
    }
    return { ok: false, error: 'Usuario no encontrado' };
  });
}

// ── GESTIÓN DE USUARIOS / PERFILES (setup manual) ─────────────────────
// MODELO DE AISLAMIENTO POR EMPRESA
// ---------------------------------------------------------------------
// Cada usuario pertenece a UNA empresa (columna `co` en la hoja Usuarios) o a
// 'todas' (superadmin). Al iniciar sesión, el backend resuelve su alcance y
// filtra TODO por su empresa: solo ve, crea, edita y borra registros de la suya.
// No sabe que existen otras empresas.
//
// PERFILES (columna `rol`):
//   super_admin      → ve todas las empresas (equivale a 'titular' en Acceso)
//   admin_empresa    → administra SU empresa (crea/edita/borra dentro de ella)
//   tecnico          → crea/edita dentro de su empresa (no borra)
//   lectura_empresa  → solo lectura de su empresa
//
// Para AUTORIZAR y ASIGNAR un usuario a una empresa, agrega una fila en la hoja
// Usuarios con: email, co (id de la empresa, ej. 'c1'), rol y activo=true.
// (El titular/superadmin va en la hoja Acceso con rol 'titular'.)
//
// Helper para agregar/actualizar un usuario de empresa desde el editor de Apps Script:
function agregarUsuarioEmpresa(email, nombre, co, rol) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = getOrCreateSheet(ss, HOJAS.usuarios, COLS.usuarios);
  const rolesValidos = ['super_admin','admin_empresa','tecnico','lectura_empresa'];
  if (rolesValidos.indexOf(rol) < 0) { Logger.log('Rol inválido: ' + rol); return; }
  const idx = {}; COLS.usuarios.forEach((c,i)=>idx[c]=i);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idx.email]||'').toLowerCase().trim() === email.toLowerCase().trim()) {
      sh.getRange(i+1, idx.co+1).setValue(co);
      sh.getRange(i+1, idx.rol+1).setValue(rol);
      sh.getRange(i+1, idx.nombre+1).setValue(nombre);
      sh.getRange(i+1, idx.activo+1).setValue(true);
      Logger.log('✅ Usuario actualizado: ' + email + ' → ' + co + ' (' + rol + ')');
      return;
    }
  }
  const fila = COLS.usuarios.map(c => {
    if (c==='id') return 'U-' + Utilities.getUuid().slice(0,8);
    if (c==='co') return co;
    if (c==='nombre') return nombre;
    if (c==='email') return email;
    if (c==='rol') return rol;
    if (c==='activo') return true;
    return '';
  });
  ensureRows(sh, 50);
  sh.appendRow(fila);
  Logger.log('✅ Usuario creado: ' + email + ' → ' + co + ' (' + rol + ')');
}
