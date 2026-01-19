// ==================== LISTA MAESTRA y CONFIGS ====================
const LISTA_MAESTRA = [
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
let currentImage = null;       // File/Blob actual
let tesseractWorker = null;    // worker global
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

// ==================== CAPTURA IMAGEN (CÁMARA / ARCHIVO) ====================
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
        safeMostrarError('No se pudo acceder a la cámara. Use carga de archivo.');
        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.click();
    }
}

function handleFileSelect(event) {
    const file = (event.target && event.target.files && event.target.files[0]) || null;
    if (!file) return;
    if (!file.type.match('image.*')) {
        safeMostrarError('Seleccione una imagen válida (JPEG/PNG).');
        return;
    }
    currentImage = file;
    mostrarImagenPrevia(URL.createObjectURL(file));
    const processBtn = document.getElementById('processBtn');
    if (processBtn) processBtn.disabled = false;
}

function mostrarImagenPrevia(url) {
    const imagePreview = document.getElementById('imagePreview');
    if (!imagePreview) return;
    imagePreview.innerHTML = `
        <img src="${url}" alt="Manifiesto" style="max-width:100%; max-height:380px;" id="previewImg">
        <button id="removeImage" class="btn btn-danger" style="margin-top:10px;">Eliminar Imagen</button>
    `;
    setTimeout(() => {
        const btn = document.getElementById('removeImage');
        if (btn) btn.addEventListener('click', () => {
            imagePreview.innerHTML = `<p><i class="bi bi-image" style="font-size:3rem;color:#ccc"></i></p><p>No hay imagen seleccionada</p>`;
            currentImage = null;
            const processBtn = document.getElementById('processBtn');
            if (processBtn) processBtn.disabled = true;
        });
    }, 50);
}

function captureFromCamera() {
    const video = document.getElementById('cameraStream');
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
        if (!blob) return;
        const file = new File([blob], 'captura.jpg', { type: 'image/jpeg' });
        currentImage = file;
        mostrarImagenPrevia(URL.createObjectURL(file));
        closeCamera();
        const processBtn = document.getElementById('processBtn');
        if (processBtn) processBtn.disabled = false;
    }, 'image/jpeg', 0.9);
}

function closeCamera() {
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
    const cameraView = document.getElementById('cameraView');
    const imagePreview = document.getElementById('imagePreview');
    if (cameraView) cameraView.style.display = 'none';
    if (imagePreview) imagePreview.style.display = 'flex';
}

// ==================== TESSERACT: inicializar y ejecutar ====================
async function inicializarTesseract() {
    try {
        if (typeof Tesseract === 'undefined') throw new Error('Tesseract.js no encontrado');
        tesseractWorker = await Tesseract.createWorker({ logger: m => console.log('Tesseract:', m) });
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
    try {
        const result = await tesseractWorker.recognize(imagen);
        return result; // objeto completo
    } catch (e) {
        console.error('Error en ejecutarOCR', e);
        throw e;
    }
}

// ==================== HELPERS: file->image y crop -> blob ====================
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
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return new Promise((resolve) => {
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
    });
}
async function ocrCrop(fileOrBlob, rectPercent, psm = '6') {
    if (!fileOrBlob) throw new Error('No hay imagen para OCR por región');
    if (!tesseractWorker) await inicializarTesseract();
    const img = await fileToImage(fileOrBlob);
    const cropBlob = await cropImageToBlob(img, rectPercent, 0.95);
    if (!cropBlob) return '';
    try { await tesseractWorker.setParameters({ tessedit_pageseg_mode: psm }); } catch (e) {}
    const result = await tesseractWorker.recognize(cropBlob);
    return (result && result.data && result.data.text) ? result.data.text.trim() : '';
}

// ==================== DEFAULT RECTS (fallback) ====================
const DEFAULT_RECTS = {
    razonRect: { x: 0.05, y: 0.18, w: 0.90, h: 0.09 },
    descrRect: { x: 0.05, y: 0.30, w: 0.80, h: 0.20 }
};

// ==================== Detección y agrupado de palabras (helpers) ====================
function groupWordsIntoRows(words) {
    if (!Array.isArray(words) || words.length === 0) return [];
    const sorted = words.slice().sort((a, b) => a.cy - b.cy || a.cx - b.cx);
    const rows = [];
    const TH = 14; // umbral vertical px
    for (const w of sorted) {
        let placed = false;
        for (const r of rows) {
            if (Math.abs(r.y - w.cy) <= TH) {
                r.words.push(w);
                r.y = (r.y * (r.words.length - 1) + w.cy) / r.words.length;
                placed = true;
                break;
            }
        }
        if (!placed) {
            rows.push({ y: w.cy, words: [Object.assign({}, w)] });
        }
    }
    for (const r of rows) r.words.sort((a, b) => a.x0 - b.x0);
    return rows;
}

// ==================== Extracción usando palabras y bounding boxes ====================
async function extractFieldsFromWords(file) {
    if (!file) return { razonSocial: '', descripcionResiduo: '', debug: {} };
    if (!tesseractWorker) await inicializarTesseract();

    try { await tesseractWorker.setParameters({ tessedit_pageseg_mode: '6' }); } catch (e) {}
    const res = await tesseractWorker.recognize(file);
    const wordsRaw = (res && res.data && res.data.words) ? res.data.words : [];
    if (!wordsRaw || !wordsRaw.length) return { razonSocial: '', descripcionResiduo: '', debug: { error: 'no-words' } };

    const words = wordsRaw.map(w => {
        let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
        if (w.bbox && typeof w.bbox === 'object') {
            x0 = w.bbox.x0 || w.bbox.x || w.bbox.left || 0;
            y0 = w.bbox.y0 || w.bbox.y || w.bbox.top || 0;
            x1 = w.bbox.x1 || (w.bbox.x0 ? w.bbox.x1 : (w.bbox.x || 0));
            y1 = w.bbox.y1 || (w.bbox.y0 ? w.bbox.y1 : (w.bbox.y || 0));
        } else {
            x0 = w.x0 || w.left || 0;
            y0 = w.y0 || w.top || 0;
            x1 = w.x1 || (w.left ? w.left + (w.width || 0) : x0 + (w.width || 0));
            y1 = w.y1 || (w.top ? w.top + (w.height || 0) : y0 + (w.height || 0));
        }
        if (x1 < x0) { const t = x0; x0 = x1; x1 = t; }
        if (y1 < y0) { const t = y0; y0 = y1; y1 = t; }
        const text = (w.text || w.word || '').toString().trim();
        return { text, x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
    }).filter(w => w.text && w.text.length > 0);

    if (!words.length) return { razonSocial: '', descripcionResiduo: '', debug: { error: 'no-words-normalized' } };

    const rows = groupWordsIntoRows(words);
    const normalizeText = s => (s || '').replace(/[^\wÁÉÍÓÚÑáéíóúñ]/g, ' ').trim().toUpperCase();

    // RAZON SOCIAL
    let razonRowIdx = -1, razonWordIdx = -1;
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        for (let j = 0; j < r.words.length; j++) {
            const t = normalizeText(r.words[j].text);
            if (/\bRAZON\b/.test(t) || /\bRAZÓN\b/.test(t) || /RAZON\s+SOCIAL/.test(t)) {
                razonRowIdx = i; razonWordIdx = j; break;
            }
        }
        if (razonRowIdx >= 0) break;
    }

    let razonSocial = '';
    if (razonRowIdx >= 0) {
        const row = rows[razonRowIdx];
        let startIndex = razonWordIdx;
        for (let k = razonWordIdx; k < row.words.length; k++) {
            const t = normalizeText(row.words[k].text);
            if (/\bSOCIAL\b/.test(t)) { startIndex = k; break; }
        }
        const labelRight = row.words[startIndex].x1;
        const rightWords = row.words.filter(w => w.cx > labelRight - 2);
        const filtered = rightWords.map(w => w.text).filter(tt => !/^\-+$/.test(tt) && !/^(DOMICILIO|C\.P|TEL|MUNICIPIO|EDO|CP)$/i.test(tt));
        razonSocial = filtered.join(' ').trim();
        if (!razonSocial && row.words.length > startIndex + 1) {
            razonSocial = row.words.slice(startIndex + 1).map(w => w.text).join(' ').trim();
        }
    }

    // DESCRIPCION
    let descrRowIdx = -1;
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        for (let j = 0; j < r.words.length; j++) {
            const t = normalizeText(r.words[j].text);
            if (/\bDESCRIPCION\b/.test(t) || /\bDESCRIPCIÓN\b/.test(t) || /^\s*5\s*$/.test(t)) {
                descrRowIdx = i; break;
            }
        }
        if (descrRowIdx >= 0) break;
    }

    let descripcionResiduo = '';
    if (descrRowIdx >= 0) {
        const blockLines = [];
        const stopHeaders = ['CONTENEDOR','CAPACIDAD','TIPO','CANTIDAD','UNIDAD','VOLUMEN','PESO','CAPACIDAD','CAPACIDAD DE RESIDUO'];
        for (let r = descrRowIdx + 1; r < Math.min(rows.length, descrRowIdx + 6); r++) {
            const lineText = rows[r].words.map(w => w.text).join(' ').trim();
            const norm = normalizeText(lineText);
            if (stopHeaders.some(h => norm.includes(h.replace(/\s+/g,'')) || norm.includes(h))) break;
            if (/^[\d\W]+$/.test(lineText)) continue;
            blockLines.push(lineText);
            if (/MEDICAMENT|RESIDUO|CADUCO|OBSOLETO|EMP[AÁ]QUE|SUSTANCIA|REACTIVO/i.test(lineText)) {
                if (blockLines.length >= 1) break;
            }
        }
        if (blockLines.length) {
            descripcionResiduo = blockLines[0];
            descripcionResiduo = descripcionResiduo.replace(/\b\d+(\.\d+)?\s*(KGS|KGS\.?|KGS:?)\b/ig,'').trim();
            descripcionResiduo = descripcionResiduo.replace(/[_|~\[\]\{\}]+/g,' ').replace(/\s{2,}/g,' ').trim();
        }
    }

    return {
        razonSocial: razonSocial || '',
        descripcionResiduo: descripcionResiduo || '',
        debug: { rowsCount: rows.length, razonRowIdx, descrRowIdx, rowsPreview: rows.slice(0,10).map(r => r.words.map(w => w.text).join(' | ')) }
    };
}

// ==================== Extracción principal (combina palabras + crops + fallback) ====================
async function extractFieldsByCrop(file) {
    // 1) intentar extracción por palabras
    let fromWords = { razonSocial: '', descripcionResiduo: '', debug: {} };
    try {
        fromWords = await extractFieldsFromWords(file);
        console.log('DEBUG extractFieldsFromWords:', fromWords.debug);
    } catch (e) {
        console.warn('extractFieldsFromWords fallo:', e);
        fromWords = { razonSocial: '', descripcionResiduo: '', debug: { error: e && e.message } };
    }

    const okRazon = fromWords.razonSocial && fromWords.razonSocial.trim().length > 3;
    const okDesc = fromWords.descripcionResiduo && fromWords.descripcionResiduo.trim().length > 4;

    if (okRazon && okDesc) {
        return {
            razonSocial: fromWords.razonSocial.trim(),
            descripcionResiduo: fromWords.descripcionResiduo.trim(),
            textoOCRCompleto: ''
        };
    }

    // 2) fallback con recortes
    const { razonRect: defaultRazon, descrRect: defaultDescr } = DEFAULT_RECTS;
    let razonText = '', descrText = '', fullResult = null;

    try {
        razonText = await ocrCrop(file, defaultRazon, '7');
        console.log('ocrCrop fallback razonText:', razonText);
    } catch (e) { console.warn('ocrCrop razon fallback error', e); }

    try {
        descrText = await ocrCrop(file, defaultDescr, '6');
        console.log('ocrCrop fallback descrText:', descrText);
    } catch (e) { console.warn('ocrCrop descr fallback error', e); }

    const needFull = (!okRazon && (!razonText || razonText.trim().length < 4)) ||
                     (!okDesc && (!descrText || descrText.trim().length < 6));

    if (needFull) {
        try {
            fullResult = await ejecutarOCR(file);
            const fullText = (fullResult && fullResult.data && fullResult.data.text) ? fullResult.data.text : '';
            console.log('OCR completo (fallback) texto inicial:', (fullText || '').slice(0,800));
            const fallback = extractFieldsFromFullText(fullText);
            razonText = razonText && razonText.trim().length ? razonText : (fallback.razonSocial || '');
            descrText = descrText && descrText.trim().length ? descrText : (fallback.descripcionResiduo || '');
        } catch (e) {
            console.warn('OCR completo fallback fallo:', e);
        }
    }

    const razonFinal = (fromWords.razonSocial && fromWords.razonSocial.trim().length > 2) ? fromWords.razonSocial.trim()
                      : (razonText ? razonText.replace(/RAZON\s+SOCIAL.*?:?/i,'').trim() : 'Desconocido');

    let descripcionFinal = (fromWords.descripcionResiduo && fromWords.descripcionResiduo.trim().length > 3) ? fromWords.descripcionResiduo.trim()
                           : (descrText ? descrText.replace(/DESCRIPCION.*?:?/i,'').trim() : 'Desconocido');

    descripcionFinal = descripcionFinal.split(/CONTENEDOR|CAPACIDAD|TIPO|CANTIDAD|UNIDAD|VOLUMEN|PESO/i)[0].trim();
    descripcionFinal = descripcionFinal.replace(/^\s*[\d\.,]+\s*(KGS|KG|LTS|M3|M³)?\b/i,'').trim();

    return {
        razonSocial: razonFinal || 'Desconocido',
        descripcionResiduo: descripcionFinal || 'Desconocido',
        textoOCRCompleto: (fullResult && fullResult.data && fullResult.data.text) ? fullResult.data.text : ''
    };
}

// ==================== Extracción por texto completo (fallback heurístico) ====================
function extractFieldsFromFullText(fullText) {
    const salida = { razonSocial: '', descripcionResiduo: '' };
    if (!fullText) return salida;
    const lines = fullText.replace(/\r/g,'\n').split('\n').map(l => l.trim()).filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        if (/^\s*4\W|RAZON\s+SOCIAL/i.test(ln)) {
            let after = ln.replace(/^\s*4\W*|RAZON\s+SOCIAL.*?:?/i,'').trim();
            if (after && after.length > 2) salida.razonSocial = after;
            else if (lines[i+1]) salida.razonSocial = lines[i+1].trim();
            break;
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        if (/^\s*5\W|DESCRIPCION/i.test(ln)) {
            let collected = [];
            let j = i + 1;
            while (j < lines.length) {
                const l2 = lines[j];
                if (/CONTENEDOR|CAPACIDAD|TIPO|CANTIDAD|UNIDAD|VOLUMEN|PESO/i.test(l2)) break;
                if (!/^[\d\W]{1,}$/.test(l2)) collected.push(l2);
                if (collected.length >= 3) break;
                j++;
            }
            if (collected.length) salida.descripcionResiduo = collected[0].replace(/^\s*[\-\–\:\.0-9]+/,'').trim();
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

// ==================== Matching avanzado (helpers) ====================
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

// ==================== verificarContraListaMaestra (mejorada) ====================
function verificarContraListaMaestra(razonSocial, descripcionResiduo) {
    const resultado = { esAceptable: true, coincidencias: [], motivo: '', nivelRiesgo: 'bajo', accionesRecomendadas: [] };
    const genTargetNorm = normForMatching(razonSocial);
    const resTargetNorm = normForMatching(descripcionResiduo);

    function pushCoin(tipo, valor, estado, motivo) {
        resultado.coincidencias.push({ tipo, valor, estado, motivo });
    }

    // palabras peligrosas
    if (descripcionResiduo) {
        const descTokens = tokenizeWordsForMatch(descripcionResiduo);
        for (const p of PALABRAS_PELIGROSAS) {
            const pNorm = normForMatching(p);
            if (resTargetNorm && containsAsWord(resTargetNorm, pNorm)) {
                resultado.esAceptable = false;
                resultado.motivo = `❌ RECHAZADO: Se detectó término peligroso "${p}" en la descripción.`;
                resultado.nivelRiesgo = 'alto';
                resultado.coincidencias.push({ tipo: 'palabra_peligrosa', valor: p, estado: 'rechazado_automatico', motivo: 'Palabra peligrosa detectada' });
                resultado.accionesRecomendadas = ['No aceptar ingreso. Revisar clasificaciones.'];
            } else {
                const tP = tokenizeWordsForMatch(p);
                if (tokenIntersectionScore(descTokens, tP) >= 0.7) {
                    resultado.esAceptable = false;
                    resultado.motivo = `❌ RECHAZADO: Posible término peligroso detectado ("${p}").`;
                    resultado.nivelRiesgo = 'alto';
                    resultado.coincidencias.push({ tipo: 'palabra_peligrosa', valor: p, estado: 'rechazado_automatico', motivo: 'Coincidencia tokenizada' });
                    resultado.accionesRecomendadas = ['No aceptar ingreso. Revisar clasificaciones.'];
                }
            }
        }
    }

    for (const item of LISTA_MAESTRA) {
        const genNorm = normForMatching(item.generador || '');
        if (genNorm) {
            if (genTargetNorm && (genTargetNorm.includes(genNorm) || genNorm.includes(genTargetNorm) || genTargetNorm === genNorm || similarityNormalized(genTargetNorm, genNorm) > 0.82)) {
                pushCoin('generador', item.generador, item.estado, item.motivo);
                if (item.estado.includes('rechaz')) {
                    resultado.esAceptable = false;
                    resultado.motivo = `❌ RECHAZADO: Generador identificado en lista maestra (${item.generador})`;
                    resultado.nivelRiesgo = 'alto';
                    resultado.accionesRecomendadas = ['No aceptar ingreso. Contactar con coordinador ambiental.'];
                } else if (item.estado.includes('requiere')) {
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
            if (!resNorm) continue;
            if (matchResiduoHeuristic(resTargetNorm, resNorm)) {
                pushCoin('residuo_especifico', res, item.estado, item.motivo);
                if (item.estado.includes('rechaz')) {
                    resultado.esAceptable = false;
                    resultado.motivo = `❌ RECHAZADO: Residuo (${res}) no autorizado.`;
                    resultado.nivelRiesgo = 'alto';
                    resultado.accionesRecomendadas = ['No aceptar ingreso. Revisar normativa.'];
                } else if (item.estado.includes('requiere')) {
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

// ==================== FUNCIÓN PRINCIPAL: iniciarAnalisis ====================
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

// ==================== mostrarResultadosEnInterfaz (robusto) ====================
function mostrarResultadosEnInterfaz(resultado) {
    if (!resultado) return;
    function setField(selectorOrId, value) {
        if (value === undefined || value === null) value = '';
        const byId = document.getElementById(selectorOrId);
        if (byId) {
            if ('value' in byId) byId.value = value;
            byId.textContent = value;
            byId.innerText = value;
            return true;
        }
        const bySel = document.querySelector(selectorOrId);
        if (bySel) {
            if ('value' in bySel) bySel.value = value;
            bySel.textContent = value;
            bySel.innerText = value;
            return true;
        }
        return false;
    }

    const company = resultado.razonSocial || '';
    const waste = resultado.descripcionResiduo || '';
    const date = resultado.fechaManifiesto || '';
    const folio = resultado.folio || '';

    setField('detectedCompany', company);
    setField('#detectedCompany', company);
    setField('input[name="razonSocial"]', company);
    setField('#razonSocial', company);
    setField('.detected-company', company);

    setField('detectedWaste', waste);
    setField('#detectedWaste', waste);
    setField('textarea[name="descripcionResiduo"]', waste);
    setField('#descripcionResiduo', waste);
    setField('.detected-waste', waste);

    setField('detectedDate', date);
    setField('#detectedDate', date);

    setField('detectedFolio', folio);
    setField('#detectedFolio', folio);

    const resultStatus = document.getElementById('resultStatus');
    const isAcceptable = resultado.esAceptable;
    if (resultStatus) {
        resultStatus.className = `result-status ${isAcceptable ? 'acceptable' : 'not-acceptable'}`;
        resultStatus.innerHTML = `
            <i class="bi ${isAcceptable ? 'bi-check-circle' : 'bi-x-circle'}"></i>
            <h2>${isAcceptable ? '✅ MANIFIESTO ACEPTADO' : '❌ MANIFIESTO RECHAZADO'}</h2>
            <p><strong>${resultado.motivo}</strong></p>
            <p class="risk-level">Nivel de riesgo: <span class="risk-badge ${resultado.nivelRiesgo.replace('-', '_')}">${resultado.nivelRiesgo.toUpperCase().replace('-', ' ')}</span></p>
        `;
    }

    const verificationContent = document.getElementById('verificationContent');
    let detallesHTML = '';
    if (resultado.coincidencias && resultado.coincidencias.length > 0) {
        detallesHTML += `<div class="matches-found"><p><strong>Coincidencias encontradas:</strong></p><ul class="matches-list">`;
        resultado.coincidencias.forEach(coinc => {
            const icono = coinc.tipo === 'generador' ? '<i class="bi bi-building"></i>' : (coinc.tipo === 'residuo_especifico' ? '<i class="bi bi-droplet"></i>' : '<i class="bi bi-exclamation-triangle"></i>');
            detallesHTML += `<li>${icono} <span class="match-value">${coinc.valor}</span> <span class="match-state">(${coinc.estado})</span></li>`;
        });
        detallesHTML += `</ul></div>`;
    } else {
        detallesHTML += `<div class="no-matches"><i class="bi bi-check-circle-fill" style="color:#38a169;font-size:2rem"></i><p>No se encontraron coincidencias en listas reguladas.</p></div>`;
    }
    if (verificationContent) verificationContent.innerHTML = detallesHTML;

    console.log('Texto OCR completo (primera 1000 chars):', (resultado.textoOriginal || '').slice(0, 1000));
}

// ==================== Incidencias, reportes y utilidades (resumidas) ====================
function registrarIncidencia() {
    if (!ultimoResultado) { alert('No hay resultado para registrar.'); return; }
    const notasEl = document.getElementById('incidenceNotes');
    const assignedEl = document.getElementById('assignedTo');
    const notas = notasEl ? notasEl.value.trim() : '';
    const asignadoA = assignedEl ? assignedEl.value.trim() : 'No asignado';
    if (!notas) { alert('Ingrese observaciones.'); if (notasEl) notasEl.focus(); return; }
    const incidenciaId = 'INC-' + Date.now().toString().slice(-8);
    const incidencia = { id: incidenciaId, fecha: new Date().toLocaleString(), notas, asignadoA, resultadoAnalisis: ultimoResultado, estado: 'registrada', prioridad: (ultimoResultado && ultimoResultado.nivelRiesgo === 'alto') ? 'alta' : 'media' };
    historialIncidencias.push(incidencia);
    try { localStorage.setItem('historialIncidencias', JSON.stringify(historialIncidencias)); } catch (e) { console.warn('No se pudo guardar historial', e); }
    const form = document.querySelector('.incidence-form'); if (form) form.style.display = 'none';
    const confirmationDiv = document.getElementById('incidenceConfirmation'); const confirmationMessage = document.getElementById('confirmationMessage');
    if (confirmationMessage) confirmationMessage.innerHTML = `Incidencia registrada: <strong>${incidenciaId}</strong>`;
    if (confirmationDiv) confirmationDiv.style.display = 'block';
}
function omitirIncidencia() { if (confirm('¿Seguro desea omitir?')) reiniciarEscaneo(); }
function descargarReporteIncidencia() { if (historialIncidencias.length === 0) { alert('No hay incidencias.'); return; } const ultima = historialIncidencias[historialIncidencias.length - 1]; const contenido = generarReporteIncidencia(ultima); descargarArchivo(contenido, `incidencia_${ultima.id}.txt`, 'text/plain'); }
function generarReporteIncidencia(incidencia) { const r = incidencia.resultadoAnalisis || {}; return `REPORTE INCIDENCIA\nID: ${incidencia.id}\nFecha: ${incidencia.fecha}\nGenerador: ${r.razonSocial || ''}\nResiduo: ${r.descripcionResiduo || ''}\nMotivo: ${r.motivo || ''}\nNotas:\n${incidencia.notas}\n`; }
function descargarReporteCompleto() { if (!ultimoResultado) { alert('No hay resultado para descargar.'); return; } const contenido = generarReporteCompleto(ultimoResultado); descargarArchivo(contenido, `reporte_manifiesto_${ultimoResultado.idAnalisis}.txt`, 'text/plain'); }
function generarReporteCompleto(resultado) { return `REPORTE ANALISIS\nID: ${resultado.idAnalisis}\nGenerador: ${resultado.razonSocial}\nResiduo: ${resultado.descripcionResiduo}\nMotivo: ${resultado.motivo}\nTexto OCR:\n${resultado.textoOriginal}\n`; }
function descargarArchivo(contenido, nombre, tipo) { const blob = new Blob([contenido], { type: tipo }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); }
function reiniciarEscaneo() { currentImage = null; ultimoResultado = null; const imagePreview = document.getElementById('imagePreview'); if (imagePreview) imagePreview.innerHTML = `<p><i class="bi bi-image" style="font-size:3rem;color:#ccc"></i></p><p>No hay imagen seleccionada</p>`; const processBtn = document.getElementById('processBtn'); if (processBtn) processBtn.disabled = true; const processingCard = document.querySelector('.processing-card'); if (processingCard) processingCard.style.display = 'none'; const resultsCard = document.querySelector('.results-card'); if (resultsCard) resultsCard.style.display = 'none'; const firstCard = document.querySelector('.card:first-of-type'); if (firstCard) firstCard.style.display = 'block'; closeCamera(); }

// ==================== EVENTOS E INICIALIZACIÓN ====================
function setupEventListeners() {
    const cameraBtn = document.getElementById('cameraBtn');
    const uploadBtn = document.getElementById('uploadBtn');
    const fileInput = document.getElementById('fileInput');
    const captureBtn = document.getElementById('captureBtn');
    const cancelCameraBtn = document.getElementById('cancelCameraBtn');
    const processBtn = document.getElementById('processBtn');
    const newScanBtn = document.getElementById('newScanBtn');
    const downloadReportBtn = document.getElementById('downloadReportBtn');
    const registerIncidenceBtn = document.getElementById('registerIncidenceBtn');
    const skipIncidenceBtn = document.getElementById('skipIncidenceBtn');
    const downloadIncidenceReport = document.getElementById('downloadIncidenceReport');
    const newScanAfterIncidence = document.getElementById('newScanAfterIncidence');

    if (cameraBtn) cameraBtn.addEventListener('click', openCamera);
    if (uploadBtn) uploadBtn.addEventListener('click', () => { if (fileInput) fileInput.click(); });
    if (fileInput) fileInput.addEventListener('change', handleFileSelect);
    if (captureBtn) captureBtn.addEventListener('click', captureFromCamera);
    if (cancelCameraBtn) cancelCameraBtn.addEventListener('click', closeCamera);
    if (processBtn) processBtn.addEventListener('click', iniciarAnalisis);
    if (newScanBtn) newScanBtn.addEventListener('click', reiniciarEscaneo);
    if (downloadReportBtn) downloadReportBtn.addEventListener('click', descargarReporteCompleto);
    if (registerIncidenceBtn) registerIncidenceBtn.addEventListener('click', registrarIncidencia);
    if (skipIncidenceBtn) skipIncidenceBtn.addEventListener('click', omitirIncidencia);
    if (downloadIncidenceReport) downloadIncidenceReport.addEventListener('click', descargarReporteIncidencia);
    if (newScanAfterIncidence) newScanAfterIncidence.addEventListener('click', reiniciarEscaneo);
}

document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    try { await inicializarTesseract(); } catch (e) { console.warn('Tesseract init error', e); }
    try { const saved = localStorage.getItem('historialIncidencias'); if (saved) historialIncidencias = JSON.parse(saved); } catch (e) { console.warn('No se pudo cargar historial', e); }
});

window.addEventListener('beforeunload', () => {
    try { if (tesseractWorker && typeof tesseractWorker.terminate === 'function') tesseractWorker.terminate(); } catch (e) {}
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
});

console.log('Script cargado: listo para validar manifiestos');
