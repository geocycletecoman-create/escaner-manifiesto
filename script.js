// ==================== LISTA MAESTRA ====================
const LISTA_MAESTRA = [
  { generador: "SYNTHON SA DE CV", residuos: ["MEDICAMENTO CADUCO Y OBSOLETO Y EMPAQUE PRIMARIO"], estado: "ingreso_aceptable", motivo: "Residuo permitido" },
  { generador: "SYNTHON MEXICO SA DE CV", residuos: ["MEDICAMENTO CADUCO Y OBSOLETO Y EMPAQUE PRIMARIO"], estado: "ingreso_aceptable", motivo: "Residuo permitido" },
  { generador: "RELLENO VILLA DE ALVAREZ", residuos: ["RSU", "LLANTAS USADAS", "LLANTAS"], estado: "requiere_permiso_especial", motivo: "Requiere permiso especial" },
  { generador: "LABORATORIOS PISA S.A. DE C.V. (TLAJOMULCO)", residuos: ["BASURA INDUSTRIAL CONTAMINADA"], estado: "requiere_permiso_especial", motivo: "Requiere permiso especial" },
  { generador: "NISSAN MEXICANA, S.A. DE C.V.", residuos: ["REACTIVOS EXPERIMENTALES"], estado: "requiere_revision", motivo: "Requiere revisión de documentación adicional" },
  { generador: "NISSAN MEXICANA, S.A. DE C.V.", residuos: ["INFLAMABLES"], estado: "rechazado_automatico", motivo: "Residuos de inflamables peligrosos no autorizados" }
];

const PALABRAS_PELIGROSAS = [
  "material radiactivo","infectante","biológico peligroso","corrosivo",
  "inflamable","explosivo","reactivo","tóxico","mutagénico","cancerígeno","ecotóxico"
];

// ==================== GLOBALES ====================
let currentImage = null;
let tesseractWorker = null;
let cameraStream = null;
let ultimoResultado = null;
let historialIncidencias = [];

// ==================== UTILIDADES ====================
function normalizeForCompare(s) {
  if (!s) return '';
  let r = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  r = r.replace(/[^A-Za-z0-9\s]/g, ' ');
  r = r.replace(/\s+/g, ' ').trim().toUpperCase();
  return r;
}
function safeMostrarError(mensaje) {
  if (typeof mostrarError === 'function') {
    try { mostrarError(mensaje); } catch (e) { console.error('mostrarError fallo:', e); alert(mensaje); }
  } else {
    alert(mensaje);
  }
}
function levenshtein(a, b) {
  a = a || ''; b = b || '';
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    let cur = [i];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[bl];
}
function similarityNormalized(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - (dist / maxLen);
}
function tokenizeWordsForMatch(s) {
  if (!s) return [];
  return s.toUpperCase().replace(/[^A-Z0-9ÑÁÉÍÓÚ\s]/g, ' ').split(/\s+/).filter(Boolean);
}
function tokenIntersectionScore(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const setB = new Set(tokensB);
  let common = 0;
  for (const t of tokensA) if (setB.has(t)) common++;
  return common / Math.max(tokensA.length, tokensB.length);
}
function containsAsWord(targetNorm, candidateNorm) {
  if (!targetNorm || !candidateNorm) return false;
  const esc = candidateNorm.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const rx = new RegExp('\\b' + esc + '\\b', 'i');
  return rx.test(targetNorm);
}
function matchResiduoHeuristic(resTarget, residuoMaster) {
  if (!resTarget || !residuoMaster) return false;
  if (containsAsWord(resTarget, residuoMaster)) return true;
  if (resTarget.includes(residuoMaster) || residuoMaster.includes(resTarget)) return true;
  const tA = tokenizeWordsForMatch(resTarget);
  const tB = tokenizeWordsForMatch(residuoMaster);
  const tokenScore = tokenIntersectionScore(tA, tB);
  if (tokenScore >= 0.45) return true;
  const sim = similarityNormalized(resTarget, residuoMaster);
  if (sim >= 0.72) return true;
  return false;
}
function normForMatching(s) { return normalizeForCompare(s || '').toUpperCase(); }
function matchCompanyToMaster(candidate) {
  if (!candidate) return '';
  const candNorm = normalizeForCompare(candidate);
  let best = { score: 0, name: '' };
  for (const it of LISTA_MAESTRA) {
    const genNorm = normalizeForCompare(it.generador || '');
    const sim = similarityNormalized(candNorm, genNorm);
    if (sim > best.score) { best = { score: sim, name: it.generador }; }
  }
  if (best.score >= 0.78) return best.name;
  return candidate.trim();
}

// ==================== TESSERACT ====================
async function inicializarTesseract() {
  try {
    if (typeof Tesseract === 'undefined') throw new Error('Tesseract.js no encontrado');
    tesseractWorker = await Tesseract.createWorker({ logger: m => {/* optional */} });
    await tesseractWorker.loadLanguage('spa');
    await tesseractWorker.initialize('spa');
    try { await tesseractWorker.setParameters({ tessedit_pageseg_mode: '6' }); } catch (e) {}
    console.log('Tesseract inicializado');
  } catch (e) {
    console.error('Error inicializando Tesseract', e);
    safeMostrarError('No fue posible inicializar OCR (Tesseract).');
  }
}
async function ejecutarOCR(imagen) {
  if (!imagen) throw new Error('No hay imagen para OCR');
  if (!tesseractWorker) await inicializarTesseract();
  return await tesseractWorker.recognize(imagen);
}

// ==================== HELPERS IMAGEN/CROP ====================
function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
function cropImageToBlob(img, rect, quality = 0.95) {
  const canvas = document.createElement('canvas');
  const sx = Math.round(rect.x * img.naturalWidth);
  const sy = Math.round(rect.y * img.naturalHeight);
  const sw = Math.max(1, Math.round(rect.w * img.naturalWidth));
  const sh = Math.max(1, Math.round(rect.h * img.naturalHeight));
  canvas.width = sw; canvas.height = sh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', quality));
}
async function ocrCrop(fileOrBlob, rectPercent, psm = '6') {
  if (!fileOrBlob) throw new Error('No hay imagen para OCR por región');
  if (!tesseractWorker) await inicializarTesseract();
  const img = await fileToImage(fileOrBlob);
  const blob = await cropImageToBlob(img, rectPercent, 0.95);
  if (!blob) return '';
  try { await tesseractWorker.setParameters({ tessedit_pageseg_mode: psm }); } catch (e) {}
  const { data } = await tesseractWorker.recognize(blob);
  return data && data.text ? data.text.trim() : '';
}

// DEFAULT RECTS (ajustables)
const DEFAULT_RECTS = {
  razonRect: { x: 0.05, y: 0.18, w: 0.90, h: 0.09 },
  descrRect: { x: 0.05, y: 0.30, w: 0.80, h: 0.20 }
};

// ==================== AGRUPAR PALABRAS EN FILAS ====================
function groupWordsIntoRows(words) {
  if (!Array.isArray(words) || words.length === 0) return [];
  const sorted = words.slice().sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const rows = [];
  const TH = 14;
  for (const w of sorted) {
    let placed = false;
    for (const r of rows) {
      if (Math.abs(r.y - w.cy) <= TH) {
        r.words.push(w);
        r.y = (r.y * (r.words.length - 1) + w.cy) / r.words.length;
        placed = true; break;
      }
    }
    if (!placed) rows.push({ y: w.cy, words: [Object.assign({}, w)] });
  }
  for (const r of rows) r.words.sort((a, b) => a.x0 - b.x0);
  return rows;
}

// ==================== DETECTAR SI CADENA PARECE DIRECCIÓN O MANIFIESTO ====================
function looksLikeAddressOrManifest(s) {
  if (!s) return false;
  const up = s.toUpperCase();
  if (/\bDOMICILIO\b|\bC\.P\b|\bCP\b|\bTEL\b|\bTEL\.?\b|\bAVENIDA\b|\bAV\.?\b|\bPERIFERICO\b|\bCOL\b|\bCALLE\b|\bCP\./.test(up)) return true;
  if (/EV[-\s]?\d+|NO\.\s*DE\s*MANIFIESTO|N[ÚU]M\.?\s*DE\s*REGISTRO|^\d{2}\/\d{2}\/\d{2,4}/.test(up)) return true;
  const letters = (s.match(/[A-ZÁÉÍÓÚÑ]/gi) || []).length;
  const digits = (s.match(/\d/g) || []).length;
  if (digits > letters && digits > 2) return true;
  return false;
}

// ==================== EXTRACCIÓN: prioridad palabras + mejoras ====================
async function extractFieldsByCrop(file) {
  if (!file) return { razonSocial: 'Desconocido', descripcionResiduo: 'Desconocido', textoOCRCompleto: '' };
  try {
    if (!tesseractWorker) await inicializarTesseract();
    await tesseractWorker.setParameters({ tessedit_pageseg_mode: '6' });
    const resWords = await tesseractWorker.recognize(file);
    const wordsRaw = (resWords && resWords.data && resWords.data.words) ? resWords.data.words : [];
    const fullText = (resWords && resWords.data && resWords.data.text) ? resWords.data.text : '';

    const words = wordsRaw.map(w => {
      let x0=0,y0=0,x1=0,y1=0;
      if (w.bbox && typeof w.bbox === 'object') {
        x0 = w.bbox.x0 || w.bbox.x || w.bbox.left || 0;
        y0 = w.bbox.y0 || w.bbox.y || w.bbox.top || 0;
        x1 = w.bbox.x1 || (w.bbox.x || 0);
        y1 = w.bbox.y1 || (w.bbox.y || 0);
      } else {
        x0 = w.x0 || w.left || 0;
        y0 = w.y0 || w.top || 0;
        x1 = w.x1 || (w.left ? w.left + (w.width || 0) : x0 + (w.width || 0));
        y1 = w.y1 || (w.top ? w.top + (w.height || 0) : y0 + (w.height || 0));
      }
      if (x1 < x0) { const t = x0; x0 = x1; x1 = t; }
      if (y1 < y0) { const t = y0; y0 = y1; y1 = t; }
      const text = (w.text || w.word || '').toString().trim();
      return { text, x0, y0, x1, y1, cx:(x0+x1)/2, cy:(y0+y1)/2, w:Math.max(1,x1-x0), h:Math.max(1,y1-y0) };
    }).filter(w => w.text && w.text.length > 0);

    const rows = groupWordsIntoRows(words);
    console.log('DEBUG rowsPreview:', rows.slice(0,20).map(r => r.words.map(w=>w.text).join(' | ')));

    // RAZÓN SOCIAL
    let companyFound = '';
    const fullUpper = (fullText || '').replace(/\r/g,'\n');

    let m = fullUpper.match(/4\W{0,3}[-\.\)]?\s*RAZON\s+SOCIAL(?:\s+DE\s+LA\s+EMPRESA)?[^\n\r]*[:\-\s]{1,}\s*([^\n\r]+)/i);
    if (m && m[1] && m[1].trim().length>2 && !looksLikeAddressOrManifest(m[1])) {
      companyFound = m[1].trim();
    } else {
      const lines = fullUpper.split('\n');
      for (let i=0;i<lines.length;i++) {
        if (/RAZON\s+SOCIAL/i.test(lines[i])) {
          const after = lines[i].replace(/RAZON\s+SOCIAL(?:\s+DE\s+LA\s+EMPRESA)?/i,'').replace(/^[\:\-\.\s]+/,'').trim();
          if (after && !looksLikeAddressOrManifest(after) && after.length>2) { companyFound = after; break; }
          for (let j=i+1;j<=Math.min(i+3,lines.length-1);j++) {
            const cand = lines[j].trim();
            if (!cand) continue;
            if (!looksLikeAddressOrManifest(cand)) { companyFound = cand; break; }
          }
          if (companyFound) break;
        }
      }
      if (!companyFound) {
        const normFull = normalizeForCompare(fullUpper);
        for (const item of LISTA_MAESTRA) {
          const genNorm = normalizeForCompare(item.generador || '');
          if (genNorm && normFull.includes(genNorm)) {
            companyFound = item.generador;
            break;
          }
        }
      }
      if (!companyFound) {
        let razonRowIdx = -1, razonWordIdx = -1;
        for (let i=0;i<rows.length;i++) {
          for (let j=0;j<rows[i].words.length;j++) {
            const t = rows[i].words[j].text.replace(/[^\wÁÉÍÓÚÑáéíóúñ]/g,' ').toUpperCase();
            if (/\bRAZON\b/.test(t) || /\bRAZÓN\b/.test(t) || /RAZON\s+SOCIAL/.test(t)) { razonRowIdx=i; razonWordIdx=j; break; }
          }
          if (razonRowIdx>=0) break;
        }
        if (razonRowIdx>=0) {
          const row = rows[razonRowIdx];
          let startIdx = razonWordIdx;
          for (let k = razonWordIdx; k<row.words.length; k++) {
            const tt = row.words[k].text.replace(/[^\wÁÉÍÓÚÑáéíóúñ]/g,' ').toUpperCase();
            if (/\bSOCIAL\b/.test(tt)) { startIdx = k; break; }
          }
          const labelRight = row.words[startIdx].x1;
          const rightWords = row.words.filter(w => w.cx > labelRight - 2);
          const candidate = rightWords.map(w=>w.text).join(' ').trim();
          if (candidate && !looksLikeAddressOrManifest(candidate)) companyFound = candidate;
        }
      }
    }

    if (companyFound && looksLikeAddressOrManifest(companyFound)) {
      const parts = fullUpper.split('\n');
      const idx = parts.findIndex(p => /RAZON\s+SOCIAL/i.test(p));
      if (idx >= 0 && parts[idx+1] && !looksLikeAddressOrManifest(parts[idx+1])) {
        companyFound = parts[idx+1].trim();
      }
    }

    const cleanCompany = (companyFound || '').replace(/\s{2,}/g,' ').replace(/^[\-\:\.]+/,'').trim();
    const finalCompany = matchCompanyToMaster(cleanCompany) || cleanCompany || 'Desconocido';

    // DESCRIPCION
    let descFound = '';
    let mm = fullUpper.match(/5\W{0,3}[-\.\)]?\s*DESCRIPCION[^\n\r]*[:\-\s]{0,}\s*([^\n\r]*)/i);
    if (mm && mm[1] && mm[1].trim().length>3) {
      const parts = fullUpper.split('\n');
      const idx = parts.findIndex(p => /DESCRIPCION/i.test(p));
      if (idx >= 0 && parts[idx+1]) descFound = parts[idx+1].trim();
      else descFound = mm[1].trim();
    } else {
      let descrRowIdx = -1;
      for (let i=0;i<rows.length;i++){
        for (let j=0;j<rows[i].words.length;j++){
          const t = rows[i].words[j].text.replace(/[^\wÁÉÍÓÚÑáéíóúñ]/g,' ').toUpperCase();
          if (/\bDESCRIPCION\b/.test(t) || /\bDESCRIPCIÓN\b/.test(t) || /^\s*5\s*$/.test(t)) { descrRowIdx = i; break; }
        }
        if (descrRowIdx>=0) break;
      }
      if (descrRowIdx>=0) {
        const stopHeaders = ['CONTENEDOR','CAPACIDAD','TIPO','CANTIDAD','UNIDAD','VOLUMEN','PESO','CAPACIDADDE'];
        let candidateIdx = descrRowIdx + 1;
        while (candidateIdx < rows.length) {
          const lineText = rows[candidateIdx].words.map(w=>w.text).join(' ').trim();
          const norm = lineText.replace(/[^\wÁÉÍÓÚÑáéíóúñ]/g,' ').toUpperCase();
          if (stopHeaders.some(h => norm.includes(h))) { candidateIdx++; continue; }
          if (/^[\d\W]+$/.test(lineText)) { candidateIdx++; continue; }
          if (/RAZON\s+SOCIAL|MANIFIESTO|REGISTRO AMBIENTAL|NO\.\s*DE\s*MANIFIESTO/i.test(lineText)) { candidateIdx++; continue; }
          descFound = lineText;
          break;
        }
      }
    }

    if (descFound) {
      let frag = descFound.split(/[\|\–\—\-]{2,}|\||\t/)[0].trim();
      frag = frag.split(/CAPACIDAD|CONTENEDOR|TIPO|CANTIDAD|UNIDAD|VOLUMEN|PESO/i)[0].trim();
      frag = frag.replace(/(^[\d\.,\s]*[KkGgSsLlmM3\/\s\(\)]{0,})/,'').trim();
      frag = frag.replace(/[_\[\]\{\}]+/g,' ').replace(/\s{2,}/g,' ').trim();
      descFound = frag;
    }

    if (!descFound || descFound.length < 3) {
      try {
        const descrCrop = await ocrCrop(file, DEFAULT_RECTS.descrRect, '6');
        if (descrCrop && descrCrop.trim().length>2) {
          descFound = descrCrop.replace(/DESCRIPCION.*?:?/i,'').split(/\n/).map(l=>l.trim()).filter(Boolean)[0] || descrCrop.trim();
          descFound = descFound.split(/[\|\–\—\-]{2,}|\||\t/)[0].trim();
          descFound = descFound.split(/CAPACIDAD|CONTENEDOR|TIPO|CANTIDAD|UNIDAD|VOLUMEN|PESO/i)[0].trim();
          descFound = descFound.replace(/^\s*[\d\.,]+\s*(KGS|KG|LTS|M3|M³)?\b/i,'').trim();
        }
      } catch (e) { console.warn('fallback descrCrop fail', e); }
    }

    const finalDesc = (descFound && descFound.length>0) ? descFound : 'Desconocido';
    return { razonSocial: finalCompany || 'Desconocido', descripcionResiduo: finalDesc || 'Desconocido', textoOCRCompleto: fullText || '' };
  } catch (err) {
    console.error('extractFieldsByCrop error', err);
    return { razonSocial: 'Desconocido', descripcionResiduo: 'Desconocido', textoOCRCompleto: '' };
  }
}

// ==================== verificarContraListaMaestra ====================
function verificarContraListaMaestra(razonSocial, descripcionResiduo) {
  const resultado = { esAceptable: true, coincidencias: [], motivo: '', nivelRiesgo: 'bajo', accionesRecomendadas: [] };
  const genTargetNorm = normForMatching(razonSocial);
  const resTargetNorm = normForMatching(descripcionResiduo);
  function pushCoin(tipo, valor, estado, motivo) { resultado.coincidencias.push({ tipo, valor, estado, motivo }); }

  // palabras peligrosas
  if (descripcionResiduo) {
    const descTokens = tokenizeWordsForMatch(descripcionResiduo);
    for (const p of PALABRAS_PELIGROSAS) {
      const pNorm = normForMatching(p);
      if (resTargetNorm && containsAsWord(resTargetNorm, pNorm)) {
        pushCoin('palabra_peligrosa', p, 'rechazado_automatico', 'Palabra peligrosa detectada');
        resultado.esAceptable = false;
        resultado.motivo = `❌ RECHAZADO: Se detectó término peligroso "${p}".`;
        resultado.nivelRiesgo = 'alto';
        resultado.accionesRecomendadas = ['No aceptar ingreso. Revisar clasificaciones.'];
        return resultado;
      } else {
        const tP = tokenizeWordsForMatch(p);
        if (tokenIntersectionScore(descTokens, tP) >= 0.7) {
          pushCoin('palabra_peligrosa', p, 'rechazado_automatico', 'Coincidencia tokenizada');
          resultado.esAceptable = false;
          resultado.motivo = `❌ RECHAZADO: Posible término peligroso detectado ("${p}").`;
          resultado.nivelRiesgo = 'alto';
          resultado.accionesRecomendadas = ['No aceptar ingreso. Revisar clasificaciones.'];
          return resultado;
        }
      }
    }
  }

  for (const item of LISTA_MAESTRA) {
    const genNorm = normForMatching(item.generador || '');
    if (genNorm && genTargetNorm) {
      if (genTargetNorm.includes(genNorm) || genNorm.includes(genTargetNorm) || genTargetNorm === genNorm || similarityNormalized(genTargetNorm, genNorm) > 0.82) {
        pushCoin('generador', item.generador, item.estado, item.motivo);
        if (item.estado === 'rechazado_automatico') {
          resultado.esAceptable = false;
          resultado.motivo = `❌ RECHAZADO: Generador identificado en lista maestra (${item.generador})`;
          resultado.nivelRiesgo = 'alto';
          resultado.accionesRecomendadas = ['No aceptar ingreso. Contactar coordinador ambiental.'];
        } else if (item.estado === 'requiere_permiso_especial' || item.estado === 'requiere_revision') {
          resultado.esAceptable = false;
          resultado.motivo = `⚠️ REQUIERE REVISIÓN: Generador identificado (${item.generador})`;
          resultado.nivelRiesgo = 'medio';
          resultado.accionesRecomendadas = ['Revisión de documentación adicional.'];
        }
      }
    }

    const residuos = Array.isArray(item.residuos) ? item.residuos : [item.residuos];
    for (const res of residuos) {
      if (!res) continue;
      const resNorm = normForMatching(res);
      if (!resNorm || !resTargetNorm) continue;
      if (matchResiduoHeuristic(resTargetNorm, resNorm)) {
        pushCoin('residuo_especifico', res, item.estado, item.motivo);
        if (item.estado === 'rechazado_automatico') {
          resultado.esAceptable = false;
          resultado.motivo = `❌ RECHAZADO: Residuo (${res}) no autorizado.`;
          resultado.nivelRiesgo = 'alto';
          resultado.accionesRecomendadas = ['No aceptar ingreso. Revisar normativa.'];
        } else if (item.estado === 'requiere_permiso_especial' || item.estado === 'requiere_revision') {
          resultado.esAceptable = false;
          resultado.motivo = `⚠️ REQUIERE REVISIÓN: Residuo (${res}) requiere documentación adicional.`;
          resultado.nivelRiesgo = 'medio';
          resultado.accionesRecomendadas = ['Solicitar documentación adicional.'];
        }
      }
    }
  }

  if (resultado.esAceptable) resultado.motivo = '✅ Documento aceptado: Generador y residuo no encontrados en listas reguladas.';
  return resultado;
}

// ==================== Mostrar resultados en UI (y mostrar sección incidencia si aplica) ====================
function mostrarResultadosEnInterfaz(resultado) {
  if (!resultado) return;
  function setField(idOrSel, value) {
    if (value === undefined || value === null) value = '';
    const el = document.getElementById(idOrSel) || document.querySelector(idOrSel);
    if (!el) return false;
    if ('value' in el) el.value = value; else el.textContent = value;
    return true;
  }

  setField('detectedCompany', resultado.razonSocial || '');
  setField('detectedWaste', resultado.descripcionResiduo || '');
  setField('detectedDate', resultado.fechaManifiesto || '');
  setField('detectedFolio', resultado.folio || '');

  const resultStatus = document.getElementById('resultStatus');
  if (resultStatus) {
    resultStatus.innerHTML = `
      <div style="padding:10px;background:${resultado.esAceptable ? '#e6fffa' : '#fff5f5'};border-radius:6px;border:1px solid ${resultado.esAceptable ? '#b2f5ea' : '#fed7d7'}">
        <strong>${resultado.esAceptable ? 'MANIFIESTO ACEPTADO' : 'MANIFIESTO RECHAZADO'}</strong>
        <div style="margin-top:6px">${resultado.motivo}</div>
      </div>
    `;
  }

  const verificationContent = document.getElementById('verificationContent');
  if (verificationContent) {
    if (resultado.coincidencias && resultado.coincidencias.length) {
      verificationContent.innerHTML = '<ul>' + resultado.coincidencias.map(c=>`<li>${c.tipo}: ${c.valor} (${c.estado})</li>`).join('') + '</ul>';
    } else verificationContent.innerHTML = '<div>No se encontraron coincidencias.</div>';
  }

  const incidenceSection = document.getElementById('incidenceSection');
  if (incidenceSection) {
    if (!resultado.esAceptable) {
      incidenceSection.style.display = 'block';
      const notesEl = document.getElementById('incidenceNotes'); if (notesEl) notesEl.value = '';
      const assignedEl = document.getElementById('assignedTo'); if (assignedEl) assignedEl.value = '';
      incidenceSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      incidenceSection.style.display = 'none';
    }
  } else {
    if (!resultado.esAceptable) console.warn('No existe #incidenceSection en el DOM');
  }

  console.log('Resultado mostrado en UI:', resultado);
}

// ==================== iniciarAnalisis ====================
async function iniciarAnalisis() {
  if (!currentImage) { safeMostrarError('Sube o captura la imagen primero.'); return; }
  const processingCard = document.querySelector('.processing-card');
  const firstCard = document.querySelector('.card:first-of-type');
  const resultsCard = document.querySelector('.results-card');
  const progressText = document.getElementById('progressText');
  const progressBar = document.getElementById('progressBar');
  if (firstCard) firstCard.style.display = 'none';
  if (processingCard) processingCard.style.display = 'block';
  if (resultsCard) resultsCard.style.display = 'none';
  if (progressText) progressText.textContent = 'Detectando campos y ejecutando OCR...';
  if (progressBar) progressBar.style.width = '10%';

  try {
    const datos = await extractFieldsByCrop(currentImage);

    if (progressBar) progressBar.style.width = '60%';
    if (progressText) progressText.textContent = 'Verificando contra lista maestra...';

    const verif = verificarContraListaMaestra(datos.razonSocial, datos.descripcionResiduo);
    if (progressBar) progressBar.style.width = '90%';

    ultimoResultado = {
      ...datos,
      ...verif,
      textoOriginal: datos.textoOCRCompleto || '',
      fechaAnalisis: new Date().toISOString(),
      idAnalisis: 'ANL-' + Date.now().toString().slice(-8)
    };

    if (progressBar) progressBar.style.width = '100%';
    if (progressText) progressText.textContent = 'Generando resultados...';

    setTimeout(() => {
      if (processingCard) processingCard.style.display = 'none';
      if (resultsCard) resultsCard.style.display = 'block';
      mostrarResultadosEnInterfaz(ultimoResultado);
      console.log('Análisis completado:', ultimoResultado);
    }, 300);

  } catch (err) {
    console.error('Error en iniciarAnalisis:', err);
    safeMostrarError('Error al procesar el manifiesto: ' + (err && err.message ? err.message : err));
    if (processingCard) processingCard.style.display = 'none';
    if (firstCard) firstCard.style.display = 'block';
  }
}

// ==================== CAMARA / CAPTURA / FILE HANDLERS ====================
async function openCamera() {
  try {
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    const cameraStreamElement = document.getElementById('cameraStream');
    const cameraView = document.getElementById('cameraView');
    const imagePreview = document.getElementById('imagePreview');
    if (cameraStreamElement) cameraStreamElement.srcObject = cameraStream;
    if (cameraView) cameraView.style.display = 'block';
    if (imagePreview) imagePreview.style.display = 'none';
    console.log('Cámara abierta');
  } catch (err) {
    console.error('Error abriendo cámara', err);
    const fileInput = document.getElementById('fileInput');
    if (fileInput) fileInput.click();
  }
}

function captureFromCamera() {
  const video = document.getElementById('cameraStream');
  if (!video) { const fileInput = document.getElementById('fileInput'); if (fileInput) fileInput.click(); return; }
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  canvas.toBlob(blob => {
    if (!blob) return;
    const file = new File([blob], 'captura.jpg', { type: 'image/jpeg' });
    currentImage = file;
    const imagePreview = document.getElementById('imagePreview');
    if (imagePreview) imagePreview.innerHTML = `<img src="${URL.createObjectURL(file)}" style="max-width:100%;max-height:380px;">`;
    closeCamera();
    const processBtn = document.getElementById('processBtn');
    if (processBtn) processBtn.disabled = false;
  }, 'image/jpeg', 0.9);
}

function closeCamera() {
  try { if (cameraStream) cameraStream.getTracks().forEach(t => t.stop()); } catch (e) {}
  cameraStream = null;
  const cameraView = document.getElementById('cameraView');
  const imagePreview = document.getElementById('imagePreview');
  if (cameraView) cameraView.style.display = 'none';
  if (imagePreview) imagePreview.style.display = 'flex';
}

function handleFileSelect(event) {
  const file = (event.target && event.target.files && event.target.files[0]) || null;
  if (!file) return;
  if (!file.type.match('image.*')) {
    safeMostrarError('Seleccione una imagen válida (JPEG/PNG).');
    return;
  }
  currentImage = file;
  const imagePreview = document.getElementById('imagePreview');
  if (imagePreview) imagePreview.innerHTML = `<img src="${URL.createObjectURL(file)}" style="max-width:100%;max-height:380px;">`;
  const processBtn = document.getElementById('processBtn');
  if (processBtn) processBtn.disabled = false;
}

// ==================== REINICIAR ESCANEO ====================
function reiniciarEscaneo() {
  currentImage = null; ultimoResultado = null;
  const imagePreview = document.getElementById('imagePreview');
  if (imagePreview) imagePreview.innerHTML = `<p style="color:#94a3b8"><i class="bi bi-image" style="font-size:2rem"></i> No hay imagen seleccionada</p>`;
  const processBtn = document.getElementById('processBtn'); if (processBtn) processBtn.disabled = true;
  const processingCard = document.querySelector('.processing-card'); if (processingCard) processingCard.style.display = 'none';
  const resultsCard = document.querySelector('.results-card'); if (resultsCard) resultsCard.style.display = 'none';
  const firstCard = document.querySelector('.card:first-of-type'); if (firstCard) firstCard.style.display = 'block';
  closeCamera();
  console.log('reiniciarEscaneo ejecutado');
}

// ==================== REPORTES : TXT y PDF para incidencias ====================
function generarReporteIncidencia(incidencia) {
  const r = incidencia.resultadoAnalisis || {};
  return [
    `REPORTE DE INCIDENCIA`,
    `ID: ${incidencia.id}`,
    `Fecha: ${incidencia.fecha}`,
    `Generador: ${r.razonSocial || ''}`,
    `Residuo: ${r.descripcionResiduo || ''}`,
    `Motivo del análisis: ${r.motivo || ''}`,
    `Nivel de riesgo: ${r.nivelRiesgo || ''}`,
    `Asignado a: ${incidencia.asignadoA || 'No asignado'}`,
    ``,
    `Observaciones:`,
    incidencia.notas || '',
    ``,
    `Texto OCR:`,
    (r.textoOriginal || r.textoOCRCompleto || '').slice(0, 10000)
  ].join('\n');
}

function descargarReporteIncidenciaTxt(incidencia) {
  const contenido = generarReporteIncidencia(incidencia);
  const blob = new Blob([contenido], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `incidencia_${incidencia.id}.txt`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

function descargarReporteIncidenciaPDF(incidencia) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert('jsPDF no está cargado. Asegúrese de incluir el CDN antes de script.js');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 40;
  const maxW = doc.internal.pageSize.getWidth() - margin * 2;
  let y = margin;

  doc.setFontSize(18);
  doc.setTextColor(15, 41, 77);
  doc.text('REPORTE DE INCIDENCIA', margin, y);
  y += 26;

  doc.setFontSize(11);
  doc.setTextColor(33, 47, 61);

  const push = (title, text) => {
    doc.setFont(undefined, 'bold'); doc.text(title, margin, y); y += 14;
    doc.setFont(undefined, 'normal');
    const lines = doc.splitTextToSize(text || '', maxW);
    doc.text(lines, margin, y);
    y += lines.length * 14 + 10;
    if (y > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin; }
  };

  push('ID:', incidencia.id);
  push('Fecha:', incidencia.fecha);
  push('Generador:', (incidencia.resultadoAnalisis && incidencia.resultadoAnalisis.razonSocial) || '');
  push('Residuo:', (incidencia.resultadoAnalisis && incidencia.resultadoAnalisis.descripcionResiduo) || '');
  push('Motivo análisis:', (incidencia.resultadoAnalisis && incidencia.resultadoAnalisis.motivo) || '');
  push('Nivel de riesgo:', (incidencia.resultadoAnalisis && incidencia.resultadoAnalisis.nivelRiesgo) || '');
  push('Asignado a:', incidencia.asignadoA || 'No asignado');
  push('Observaciones:', incidencia.notas || '');
  push('Texto OCR:', (incidencia.resultadoAnalisis && (incidencia.resultadoAnalisis.textoOriginal || incidencia.resultadoAnalisis.textoOCRCompleto)) || '');

  doc.save(`incidencia_${incidencia.id}.pdf`);
}

// ==================== INCIDENCIAS: registro y UI ====================
function generarIdIncidencia() { return 'INC-' + Date.now().toString().slice(-8); }

function mostrarConfirmacionIncidencia(incidencia) {
  const incidenceSection = document.getElementById('incidenceSection');
  if (!incidenceSection) return;
  incidenceSection.innerHTML = `
    <div id="incidenceConfirmation" style="padding:12px;border-radius:8px;background:#f7fafc">
      <div style="display:flex;gap:12px;align-items:center">
        <i class="bi bi-check-circle-fill" style="font-size:1.5rem;color:#38a169"></i>
        <div>
          <strong>Incidencia registrada: ${incidencia.id}</strong>
          <div style="margin-top:6px;color:#4a5568">Asignado a: <strong>${incidencia.asignadoA || 'No asignado'}</strong></div>
        </div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button id="downloadIncidencePdf" class="btn" style="background:#2b6cb0"><i class="bi bi-file-earmark-pdf"></i> Descargar PDF</button>
        <button id="downloadIncidenceTxt" class="btn" style="background:#38a169"><i class="bi bi-download"></i> Descargar TXT</button>
        <button id="newScanAfterIncidence" class="btn btn-outline">Nuevo Escaneo</button>
      </div>
    </div>
  `;
  const pdfBtn = document.getElementById('downloadIncidencePdf');
  const txtBtn = document.getElementById('downloadIncidenceTxt');
  const nsBtn = document.getElementById('newScanAfterIncidence');
  if (pdfBtn) pdfBtn.addEventListener('click', () => descargarReporteIncidenciaPDF(incidencia));
  if (txtBtn) txtBtn.addEventListener('click', () => descargarReporteIncidenciaTxt(incidencia));
  if (nsBtn) nsBtn.addEventListener('click', () => { reiniciarEscaneo(); const incSec = document.getElementById('incidenceSection'); if (incSec) incSec.style.display = 'none'; });
}

function registrarIncidencia() {
  if (!ultimoResultado) { alert('No hay resultado para registrar.'); return; }
  const notesEl = document.getElementById('incidenceNotes');
  const assignedEl = document.getElementById('assignedTo');
  const notes = notesEl ? notesEl.value.trim() : '';
  const assignedTo = assignedEl ? assignedEl.value.trim() : 'No asignado';
  if (!notes) { alert('Ingrese observaciones para la incidencia.'); if (notesEl) notesEl.focus(); return; }
  const incidencia = { id: generarIdIncidencia(), fecha: new Date().toLocaleString(), notas: notes, asignadoA: assignedTo, resultadoAnalisis: ultimoResultado, estado: 'registrada' };
  historialIncidencias.push(incidencia);
  try { localStorage.setItem('historialIncidencias', JSON.stringify(historialIncidencias)); } catch (e) { console.warn('No se pudo guardar historialIncidencias', e); }
  mostrarConfirmacionIncidencia(incidencia);
}

function omitirIncidencia() {
  if (!confirm('¿Omitir registro de incidencia?')) return;
  const incidenceSection = document.getElementById('incidenceSection');
  if (incidenceSection) incidenceSection.style.display = 'none';
  reiniciarEscaneo();
}

// ==================== setupEventListeners (seguro con typeof) ====================
function setupEventListeners() {
  const cameraBtn = document.getElementById('cameraBtn');
  const uploadBtn = document.getElementById('uploadBtn');
  const fileInput = document.getElementById('fileInput');
  const captureBtn = document.getElementById('captureBtn');
  const cancelCameraBtn = document.getElementById('cancelCameraBtn');
  const processBtn = document.getElementById('processBtn');
  const newScanBtn = document.getElementById('newScanBtn');
  const downloadReportBtn = document.getElementById('downloadReportBtn');

  if (cameraBtn && typeof openCamera === 'function') cameraBtn.addEventListener('click', openCamera);
  if (uploadBtn) uploadBtn.addEventListener('click', () => fileInput && fileInput.click());
  if (fileInput) fileInput.addEventListener('change', handleFileSelect);
  if (captureBtn && typeof captureFromCamera === 'function') captureBtn.addEventListener('click', captureFromCamera);
  if (cancelCameraBtn && typeof closeCamera === 'function') cancelCameraBtn.addEventListener('click', closeCamera);
  if (processBtn) processBtn.addEventListener('click', iniciarAnalisis);
  if (newScanBtn) newScanBtn.addEventListener('click', reiniciarEscaneo);
  if (downloadReportBtn) downloadReportBtn.addEventListener('click', descargarReporteCompleto);

  const registerIncidenceBtn = document.getElementById('registerIncidenceBtn');
  const skipIncidenceBtn = document.getElementById('skipIncidenceBtn');
  if (registerIncidenceBtn) registerIncidenceBtn.addEventListener('click', registrarIncidencia);
  if (skipIncidenceBtn) skipIncidenceBtn.addEventListener('click', omitirIncidencia);
}

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  try { const saved = localStorage.getItem('historialIncidencias'); if (saved) historialIncidencias = JSON.parse(saved); } catch (e) { console.warn('No se pudo cargar historialIncidencias', e); }
  try { await inicializarTesseract(); } catch (e) { console.warn('Tesseract init error', e); }
});

// cleanup
window.addEventListener('beforeunload', () => {
  try { if (tesseractWorker && typeof tesseractWorker.terminate === 'function') tesseractWorker.terminate(); } catch (e) {}
  if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
});

console.log('Script cargado: listo para validar manifiestos');
