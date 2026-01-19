// ==================== LISTA MAESTRA ====================
const LISTA_MAESTRA = [
    { generador: "SYNTHON SA DE VC", residuos: ["MEDICAMENTO CADUCO Y OBSOLETO Y EMPAQUE PRIMARIO"], estado: "requiere_permiso_especial", motivo: "Ingreso aceptable" },
    { generador: "SYNTHON MEXICO SA DE CV", residuos: ["MEDICAMENTO CADUCO Y OBSOLETO Y EMPAQUE PRIMARIO"], estado: "requiere_permiso_especial", motivo: "Ingreso aceptable" },
    { generador: "RELLENO VILLA DE ALVAREZ", residuos: ["RSU", "Llantas Usadas"], estado: "requiere_permiso_especial", motivo: "Ingreso aceptable" },
    { generador: "LABORATORIOS PISA S.A. DE C.V. (TLAJOMULCO)", residuos: ["BASURA INDUSTRIAL CONTAMINADA"], estado: "requiere_permiso_especial", motivo: "Ingreso aceptable" },
    { generador: "NISSAN MEXICANA, S.A. DE C.V.", residuos: ["reactivos experimentales"], estado: "requiere_revision", motivo: "Requiere revisión de documentación adicional" },
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
function truncate(v){ return Math.max(0, Math.min(255, v)); }
function safeMostrarError(mensaje) {
    if (typeof mostrarError === 'function') {
        try { mostrarError(mensaje); } catch (e) { console.error('mostrarError fallo:', e); alert(mensaje); }
    } else {
        alert(mensaje);
    }
}

// Levenshtein + similarity
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

// Encuentra la mejor coincidencia en la lista maestra para normalizar el nombre de empresa
function matchCompanyToMaster(candidate) {
    if (!candidate) return '';
    const candNorm = normalizeForCompare(candidate);
    let best = { score: 0, name: '' };
    for (const it of LISTA_MAESTRA) {
        const genNorm = normalizeForCompare(it.generador || '');
        const sim = similarityNormalized(candNorm, genNorm);
        if (sim > best.score) { best = { score: sim, name: it.generador }; }
    }
    // umbral: si es bastante similar (>0.78) asumimos correspondencia y retornamos la forma canónica
    if (best.score >= 0.78) return best.name;
    return candidate.trim();
}

// ==================== TESSERACT ====================
async function inicializarTesseract() {
    try {
        if (typeof Tesseract === 'undefined') throw new Error('Tesseract.js no encontrado');
        tesseractWorker = await Tesseract.createWorker({ logger: m => {/*console.log('Tesseract:', m)*/} });
        await tesseractWorker.loadLanguage('spa');
        await tesseractWorker.initialize('spa');
        try { await tesseractWorker.setParameters({ tessedit_pageseg_mode: '6' }); } catch (e) {}
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

// DEFAULT RECTS (ajusta si necesitas calibrar)
const DEFAULT_RECTS = {
    razonRect: { x: 0.05, y: 0.18, w: 0.90, h: 0.09 },
    descrRect: { x: 0.05, y: 0.30, w: 0.80, h: 0.20 }
};

// ==================== AGRUPADO DE PALABRAS EN FILAS ====================
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

// ==================== EXTRACCION: toma línea inmediata para campo 5 y busca "4.-" en todo el texto para empresa ====
async function extractFieldsByCrop(file) {
    // Primero intentamos obtener palabras con bounding boxes y agrupar
    let razon = '', descripcion = '', fullText = '';
    try {
        if (!tesseractWorker) await inicializarTesseract();
        await tesseractWorker.setParameters({ tessedit_pageseg_mode: '6' });
        const resWords = await tesseractWorker.recognize(file);
        const wordsRaw = (resWords && resWords.data && resWords.data.words) ? resWords.data.words : [];
        fullText = (resWords && resWords.data && resWords.data.text) ? resWords.data.text : '';
        // normalizar words
        const words = wordsRaw.map(w => {
            let x0=0,y0=0,x1=0,y1=0;
            if (w.bbox && typeof w.bbox === 'object') {
                x0 = w.bbox.x0 || w.bbox.x || w.bbox.left || 0;
                y0 = w.bbox.y0 || w.bbox.y || w.bbox.top || 0;
                x1 = w.bbox.x1 || w.bbox.x1 || (w.bbox.x || 0);
                y1 = w.bbox.y1 || w.bbox.y1 || (w.bbox.y || 0);
            } else {
                x0 = w.x0 || w.left || 0;
                y0 = w.y0 || w.top || 0;
                x1 = w.x1 || (w.left ? w.left + (w.width || 0) : x0 + (w.width || 0));
                y1 = w.y1 || (w.top ? w.top + (w.height || 0) : y0 + (w.height || 0));
            }
            if (x1 < x0) { const t=x0; x0=x1; x1=t; }
            if (y1 < y0) { const t=y0; y0=y1; y1=t; }
            const text = (w.text || w.word || '').toString().trim();
            return { text, x0, y0, x1, y1, cx:(x0+x1)/2, cy:(y0+y1)/2, w:Math.max(1,x1-x0), h:Math.max(1,y1-y0) };
        }).filter(w => w.text && w.text.length>0);

        const rows = groupWordsIntoRows(words);
        console.log('DEBUG rowsPreview:', rows.slice(0,20).map(r => r.words.map(w=>w.text).join(' | ')));

        // --- RAZÓN SOCIAL: buscamos primero un patrón global '4.-' o 'RAZON SOCIAL' dentro del fullText
        // esto ayuda cuando OCR separa palabras o hay saltos de linea
        const fullUpper = (fullText || '').replace(/\r/g,'\n');
        let companyFound = '';
        // regex que busca "4.- ... RAZON SOCIAL ... : <valor>" o "RAZON SOCIAL ... : valor"
        let m = fullUpper.match(/4\W{0,3}[-\.\)]?\s*RAZON\s+SOCIAL[^\n\r]*[:\-\s]{1,}\s*([^\n\r]+)/i);
        if (m && m[1] && m[1].trim().length>2) {
            companyFound = m[1].trim();
        } else {
            // intentar buscar "RAZON SOCIAL" y tomar lo que venga a su derecha en la misma línea o en la siguiente
            m = fullUpper.match(/RAZON\s+SOCIAL[^\n\r]*[:\-\s]{0,}\s*([^\n\r]*)/i);
            if (m && m[1] && m[1].trim().length>2) {
                companyFound = m[1].trim();
            } else {
                // si no, buscar la línea que contenga "RAZON" en rows y tomar palabras a la derecha
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
                    // encontrar palabra SOCIAL si existe y empezar después
                    let startIdx = razonWordIdx;
                    for (let k = razonWordIdx; k<row.words.length; k++) {
                        const tt = row.words[k].text.replace(/[^\wÁÉÍÓÚÑáéíóúñ]/g,' ').toUpperCase();
                        if (/\bSOCIAL\b/.test(tt)) { startIdx = k; break; }
                    }
                    // tomar palabras a la derecha
                    const labelRight = row.words[startIdx].x1;
                    const rightWords = row.words.filter(w => w.cx > labelRight - 2);
                    companyFound = rightWords.map(w=>w.text).join(' ').trim();
                    if (!companyFound && row.words.length > startIdx+1) companyFound = row.words.slice(startIdx+1).map(w=>w.text).join(' ').trim();
                }
            }
        }
        // fallback: si aún no, buscar "4.-" en el texto completo y tomar lo que sigue (hasta salto de línea)
        if (!companyFound) {
            m = fullUpper.match(/4\W{0,3}[-\.\)]?\s*[:\-]?\s*([^\n\r]+)/i);
            if (m && m[1]) companyFound = m[1].trim();
        }

        // --- DESCRIPCION (campo 5): buscar '5.-' o 'DESCRIPCION' y tomar la línea inmediatamente debajo ---
        let descFound = '';
        // buscamos patrón global
        let mm = fullUpper.match(/5\W{0,3}[-\.\)]?\s*DESCRIPCION[^\n\r]*[:\-\s]{0,}\s*([^\n\r]*)/i);
        if (mm && mm[1] && mm[1].trim().length>3) {
            // si hay texto en la misma línea luego de la etiqueta, pero en muchos formularios el nombre aparece en la siguiente línea
            // preferimos tomar la siguiente línea si la misma contiene solo encabezado
            const lineAfter = (fullUpper.split('\n')[fullUpper.split('\n').findIndex(l=>/DESCRIPCION/i.test(l))+1] || '').trim();
            if (lineAfter && lineAfter.length>3) descFound = lineAfter.trim();
            else descFound = mm[1].trim();
        } else {
            // buscar la línea que contiene DESCRIPCION en rows
            let descrRowIdx = -1;
            for (let i=0;i<rows.length;i++){
                for (let j=0;j<rows[i].words.length;j++){
                    const t = rows[i].words[j].text.replace(/[^\wÁÉÍÓÚÑáéíóúñ]/g,' ').toUpperCase();
                    if (/\bDESCRIPCION\b/.test(t) || /\bDESCRIPCIÓN\b/.test(t) || /^\s*5\s*$/.test(t)) { descrRowIdx = i; break; }
                }
                if (descrRowIdx>=0) break;
            }
            if (descrRowIdx>=0) {
                // tomar la fila siguiente válida (saltando encabezados)
                const stopHeaders = ['CONTENEDOR','CAPACIDAD','TIPO','CANTIDAD','UNIDAD','VOLUMEN','PESO','CAPACIDADDE'];
                let candidateIdx = descrRowIdx + 1;
                while (candidateIdx < rows.length) {
                    const lineText = rows[candidateIdx].words.map(w=>w.text).join(' ').trim();
                    const norm = lineText.replace(/[^\wÁÉÍÓÚÑáéíóúñ]/g,' ').toUpperCase();
                    if (stopHeaders.some(h => norm.includes(h))) { candidateIdx++; continue; }
                    if (/^[\d\W]+$/.test(lineText)) { candidateIdx++; continue; }
                    // if line appears to be a header or other, skip
                    if (/RAZON\s+SOCIAL|MANIFIESTO|REGISTRO AMBIENTAL|NO\.\s*DE\s*MANIFIESTO/i.test(lineText)) { candidateIdx++; continue; }
                    descFound = lineText;
                    // si corta, juntar siguiente
                    if (descFound.length < 6 && (candidateIdx + 1) < rows.length) {
                        const nextLine = rows[candidateIdx+1].words.map(w=>w.text).join(' ').trim();
                        if (nextLine && !stopHeaders.some(h => nextLine.replace(/[^\wÁÉÍÓÚÑáéíóúñ]/g,' ').toUpperCase().includes(h))) {
                            descFound = (descFound + ' ' + nextLine).trim();
                        }
                    }
                    break;
                }
            }
        }

        // Si companyFound vacío, usar fallback por recorte/regex
        if (!companyFound || companyFound.length < 3) {
            // fallback: recortar razonRect y OCR
            try {
                const razonCrop = await ocrCrop(file, DEFAULT_RECTS.razonRect, '7');
                if (razonCrop && razonCrop.trim().length>2) companyFound = razonCrop.replace(/RAZON\s+SOCIAL.*?:?/i,'').trim();
            } catch (e) { console.warn('fallback razonCrop fail', e); }
        }

        // Si descFound vacío, fallback por recorte
        if (!descFound || descFound.length < 3) {
            try {
                const descrCrop = await ocrCrop(file, DEFAULT_RECTS.descrRect, '6');
                if (descrCrop && descrCrop.trim().length>2) {
                    // limpiar encabezado si viene junto
                    descFound = descrCrop.replace(/DESCRIPCION.*?:?/i,'').split(/\n/).map(l=>l.trim()).filter(Boolean)[0] || descrCrop.trim();
                }
            } catch (e) { console.warn('fallback descrCrop fail', e); }
        }

        // final cleaning
        const cleanCompany = (companyFound || '').replace(/\s{2,}/g,' ').replace(/^[\-\:\.]+/,'').trim();
        const cleanDesc = (descFound || '').replace(/\s{2,}/g,' ').replace(/^[\-\:\.]+/,'').trim();

        // map to master list if close
        const finalCompany = matchCompanyToMaster(cleanCompany) || cleanCompany || 'Desconocido';
        const finalDesc = (cleanDesc && cleanDesc.length>0) ? cleanDesc : 'Desconocido';

        console.log('DEBUG extracted raw company:', companyFound);
        console.log('DEBUG extracted raw desc:', descFound);
        console.log('DEBUG finalCompany (after mapping):', finalCompany);
        console.log('DEBUG finalDesc:', finalDesc);

        return { razonSocial: finalCompany, descripcionResiduo: finalDesc, textoOCRCompleto: fullText || '' };

    } catch (err) {
        console.warn('extractFieldsByCrop error, fallback to full OCR', err);
        // fallback completo
        try {
            const fullRes = await ejecutarOCR(file);
            const fullText = (fullRes && fullRes.data && fullRes.data.text) ? fullRes.data.text : '';
            // aplicar heurística sobre texto completo
            const { razonSocial, descripcionResiduo } = extractFieldsFromFullText(fullText);
            const finalCompany = matchCompanyToMaster(razonSocial) || razonSocial || 'Desconocido';
            const finalDesc = descripcionResiduo || 'Desconocido';
            console.log('DEBUG fallback fullText razon:', razonSocial, 'desc:', descripcionResiduo);
            return { razonSocial: finalCompany, descripcionResiduo: finalDesc, textoOCRCompleto: fullText };
        } catch (e2) {
            console.error('Fallback OCR also failed', e2);
            return { razonSocial: 'Desconocido', descripcionResiduo: 'Desconocido', textoOCRCompleto: '' };
        }
    }
}

// Heurística robusta sobre texto completo
function extractFieldsFromFullText(fullText) {
    const salida = { razonSocial: '', descripcionResiduo: '' };
    if (!fullText) return salida;
    const lines = fullText.replace(/\r/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);

    // buscar 4.- RAZON SOCIAL
    for (let i=0;i<lines.length;i++) {
        const ln = lines[i];
        if (/^\s*4\W|RAZON\s+SOCIAL/i.test(ln)) {
            // si la misma línea tiene texto después de ':' lo tomamos; si no, la siguiente línea
            let after = ln.replace(/^\s*4\W*|RAZON\s+SOCIAL.*?:?/i,'').trim();
            if (after && after.length>2) salida.razonSocial = after;
            else if (lines[i+1]) salida.razonSocial = lines[i+1].trim();
            break;
        }
    }

    // buscar 5.- DESCRIPCION
    for (let i=0;i<lines.length;i++) {
        const ln = lines[i];
        if (/^\s*5\W|DESCRIPCION/i.test(ln)) {
            let collected = [];
            let j = i+1;
            while (j < lines.length) {
                const l2 = lines[j];
                if (/CONTENEDOR|CAPACIDAD|TIPO|CANTIDAD|UNIDAD|VOLUMEN|PESO/i.test(l2)) break;
                if (!/^[\d\W]{1,}$/.test(l2)) collected.push(l2);
                if (collected.length >= 3) break;
                j++;
            }
            if (collected.length) salida.descripcionResiduo = collected[0].replace(/^[\-\:\.\s\d]+/,'').trim();
            else {
                let after = ln.replace(/^\s*5\W*|DESCRIPCION.*?:?/i,'').trim();
                salida.descripcionResiduo = after || '';
            }
            break;
        }
    }

    salida.razonSocial = (salida.razonSocial || '').replace(/\s{2,}/g,' ').trim();
    salida.descripcionResiduo = (salida.descripcionResiduo || '').replace(/\s{2,}/g,' ').replace(/^[\d\.,]+\s*(KGS|KG|LTS|M3|M³)?/i,'').trim();
    return salida;
}

// ==================== Comparación vs LISTA_MAESTRA (igual que antes) ====================
function tokenizeWords(s) {
    if (!s) return [];
    return s.toUpperCase().replace(/[^A-Z0-9ÑÁÉÍÓÚ\s]/g, ' ').split(/\s+/).filter(Boolean);
}
function tokenIntersectionScore(a,b) { if (!a.length||!b.length) return 0; const sb=new Set(b); let c=0; for(const t of a) if(sb.has(t)) c++; return c/Math.max(a.length,b.length); }
function containsAsWord(targetNorm, candidateNorm) {
    if (!targetNorm || !candidateNorm) return false;
    const esc = candidateNorm.replace(/[-\/\\^$*+?.()|[\]{}]/g,'\\$&');
    const rx = new RegExp('\\b'+esc+'\\b','i');
    return rx.test(targetNorm);
}
function matchResiduoHeuristic(resTarget, residuoMaster) {
    if (!resTarget || !residuoMaster) return false;
    if (containsAsWord(resTarget, residuoMaster)) return true;
    if (resTarget.includes(residuoMaster) || residuoMaster.includes(resTarget)) return true;
    const tA = tokenizeWords(resTarget), tB = tokenizeWords(residuoMaster);
    if (tokenIntersectionScore(tA,tB) >= 0.45) return true;
    if (similarityNormalized(resTarget, residuoMaster) >= 0.72) return true;
    return false;
}
function normForMatching(s) { return normalizeForCompare(s || '').toUpperCase(); }

function verificarContraListaMaestra(razonSocial, descripcionResiduo) {
    const resultado = { esAceptable: true, coincidencias: [], motivo:'', nivelRiesgo:'bajo', accionesRecomendadas: [] };
    const genTargetNorm = normForMatching(razonSocial);
    const resTargetNorm = normForMatching(descripcionResiduo);
    function pushCoin(tipo, valor, estado, motivo) { resultado.coincidencias.push({ tipo, valor, estado, motivo }); }

    // palabras peligrosas
    if (descripcionResiduo) {
        const descTokens = tokenizeWords(descripcionResiduo);
        for (const p of PALABRAS_PELIGROSAS) {
            const pNorm = normForMatching(p);
            if (resTargetNorm && containsAsWord(resTargetNorm, pNorm)) {
                resultado.esAceptable=false;
                resultado.motivo=`❌ RECHAZADO: Se detectó término peligroso "${p}" en la descripción.`;
                resultado.nivelRiesgo='alto';
                resultado.coincidencias.push({ tipo:'palabra_peligrosa', valor:p, estado:'rechazado_automatico', motivo:'Palabra peligrosa detectada' });
                resultado.accionesRecomendadas=['No aceptar ingreso. Revisar clasificaciones.'];
            } else {
                const tP = tokenizeWords(p);
                if (tokenIntersectionScore(descTokens,tP)>=0.7) {
                    resultado.esAceptable=false;
                    resultado.motivo=`❌ RECHAZADO: Posible término peligroso detectado ("${p}").`;
                    resultado.nivelRiesgo='alto';
                    resultado.coincidencias.push({ tipo:'palabra_peligrosa', valor:p, estado:'rechazado_automatico', motivo:'Coincidencia tokenizada' });
                    resultado.accionesRecomendadas=['No aceptar ingreso. Revisar clasificaciones.'];
                }
            }
        }
    }

    for (const item of LISTA_MAESTRA) {
        const genNorm = normForMatching(item.generador || '');
        if (genNorm && genTargetNorm) {
            if (genTargetNorm.includes(genNorm) || genNorm.includes(genTargetNorm) || genTargetNorm === genNorm || similarityNormalized(genTargetNorm, genNorm) > 0.82) {
                pushCoin('generador', item.generador, item.estado, item.motivo);
                if (item.estado.includes('rechaz')) {
                    resultado.esAceptable=false;
                    resultado.motivo=`❌ RECHAZADO: Generador identificado en lista maestra (${item.generador})`;
                    resultado.nivelRiesgo='alto';
                    resultado.accionesRecomendadas=['No aceptar ingreso. Contactar con coordinador ambiental.'];
                } else if (item.estado.includes('requiere')) {
                    resultado.esAceptable=false;
                    resultado.motivo=`⚠️ REQUIERE REVISIÓN: Generador identificado (${item.generador})`;
                    resultado.nivelRiesgo='medio';
                    resultado.accionesRecomendadas=['Revisión de documentación adicional.'];
                }
            }
        }
        const residuos = Array.isArray(item.residuos) ? item.residuos : [item.residuos];
        for (const res of residuos) {
            if (!res) continue;
            const resNorm = normForMatching(res);
            if (!resNorm) continue;
            if (matchResiduoHeuristic(resTargetNorm, resNorm)) {
                pushCoin('residuo_especifico', res, item.estado, item.motivo);
                if (item.estado.includes('rechaz')) {
                    resultado.esAceptable=false;
                    resultado.motivo=`❌ RECHAZADO: Residuo (${res}) no autorizado.`;
                    resultado.nivelRiesgo='alto';
                    resultado.accionesRecomendadas=['No aceptar ingreso. Revisar normativa.'];
                } else if (item.estado.includes('requiere')) {
                    resultado.esAceptable=false;
                    resultado.motivo=`⚠️ REQUIERE REVISIÓN: Residuo (${res}) requiere documentación adicional.`;
                    resultado.nivelRiesgo='medio';
                    resultado.accionesRecomendadas=['Solicitar documentación adicional.'];
                }
            }
        }
    }

    if (resultado.esAceptable) resultado.motivo = '✅ Documento aceptado: Generador y residuo no encontrados en listas reguladas.';
    return resultado;
}

// ==================== mostrarResultadosEnInterfaz ====================
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
            <div style="padding:10px;background:#e6fffa;border-radius:6px;border:1px solid #b2f5ea">
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

    console.log('Resultado mostrado en UI:', resultado);
}

// ==================== flujo iniciarAnalisis ====================
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

// ==================== eventos e inicialización ====================
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

function setupEventListeners() {
    const cameraBtn = document.getElementById('cameraBtn');
    const uploadBtn = document.getElementById('uploadBtn');
    const fileInput = document.getElementById('fileInput');
    const captureBtn = document.getElementById('captureBtn');
    const cancelCameraBtn = document.getElementById('cancelCameraBtn');
    const processBtn = document.getElementById('processBtn');
    const newScanBtn = document.getElementById('newScanBtn');
    const downloadReportBtn = document.getElementById('downloadReportBtn');

    if (cameraBtn) cameraBtn.addEventListener('click', openCamera);
    if (uploadBtn) uploadBtn.addEventListener('click', () => fileInput.click());
    if (fileInput) fileInput.addEventListener('change', handleFileSelect);
    if (processBtn) processBtn.addEventListener('click', iniciarAnalisis);
}

document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    try { await inicializarTesseract(); } catch (e) { console.warn('Tesseract init error', e); }
});

window.addEventListener('beforeunload', () => {
    try { if (tesseractWorker && typeof tesseractWorker.terminate === 'function') tesseractWorker.terminate(); } catch (e) {}
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
});

console.log('Script cargado: listo para validar manifiestos');
           
