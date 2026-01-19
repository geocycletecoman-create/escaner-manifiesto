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
function escapeRegExp(str) {
    if (!str) return '';
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
        tesseractWorker = await Tesseract.createWorker({ logger: m => { /* opcional: mostrar progreso */ } });
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

// ==================== OCR SOBRE CROPS ====================
async function ocrCrop(fileOrBlob, rectPercent, psm = '6') {
    if (!fileOrBlob) throw new Error('No hay imagen para OCR por región');
    if (!tesseractWorker) await inicializarTesseract();

    const img = await fileToImage(fileOrBlob);
    const cropBlob = await cropImageToBlob(img, rectPercent, 0.95);
    if (!cropBlob) return '';

    try {
        try { await tesseractWorker.setParameters({ tessedit_pageseg_mode: psm }); } catch (e) {}
    } catch (e) {}

    const result = await tesseractWorker.recognize(cropBlob);
    return (result && result.data && result.data.text) ? result.data.text.trim() : '';
}

// ==================== DEFAULT RECTS (fallback si no detecta etiquetas) ====================
const DEFAULT_RECTS = {
    // Estos valores son aproximados; si tienes formato fijo los ajustamos.
    razonRect: { x: 0.06, y: 0.20, w: 0.88, h: 0.06 }, // línea donde suele estar campo 4
    descrRect: { x: 0.05, y: 0.32, w: 0.7, h: 0.16 }   // bloque donde suele estar campo 5
};

// ==================== DETECCIÓN AUTOMÁTICA DE ETIQUETAS (USANDO WORD BBOX) ====================
async function detectLabelRectsUsingWords(file) {
    if (!file) return null;
    if (!tesseractWorker) await inicializarTesseract();

    try {
        // Pedimos reconocimiento completo pero nos quedamos con words + bbox
        try { await tesseractWorker.setParameters({ tessedit_pageseg_mode: '6' }); } catch (e) {}
        const res = await tesseractWorker.recognize(file);
        const wordsRaw = (res && res.data && res.data.words) ? res.data.words : [];
        if (!wordsRaw.length) return null;

        // Normalizamos cada palabra y extraemos bbox en px (varios formatos)
        const words = wordsRaw.map(w => {
            let x0 = w.bbox && w.bbox.x0 ? w.bbox.x0 : (w.x0 || w.left || 0);
            let y0 = w.bbox && w.bbox.y0 ? w.bbox.y0 : (w.y0 || w.top || 0);
            let x1 = w.bbox && w.bbox.x1 ? w.bbox.x1 : (w.x1 || (w.left ? w.left + (w.width || 0) : x0 + (w.width || 0)));
            let y1 = w.bbox && w.bbox.y1 ? w.bbox.y1 : (w.y1 || (w.top ? w.top + (w.height || 0) : y0 + (w.height || 0)));
            if (x1 < x0) { const t = x0; x0 = x1; x1 = t; }
            if (y1 < y0) { const t = y0; y0 = y1; y1 = t; }
            const text = (w.text || w.word || '').toString().trim();
            return { text, x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
        }).filter(w => w.text && w.text.length > 0);

        if (!words.length) return null;

        // Obtener dimensiones de la imagen
        const img = await fileToImage(file);
        const imgW = img.naturalWidth || img.width || 1;
        const imgH = img.naturalHeight || img.height || 1;

        const normalize = s => (s || '').replace(/[^\wÁÉÍÓÚÑáéíóúñ]/g, ' ').trim().toUpperCase();

        // Buscar palabras que formen la etiqueta "RAZON SOCIAL"
        let razonLabelBox = null;
        for (let i = 0; i < words.length; i++) {
            const t = normalize(words[i].text);
            if (t.includes('RAZON') || t.includes('RAZÓN')) {
                // buscar "SOCIAL" en la misma línea (cy similar)
                const lineY = words[i].cy;
                const nearby = words.filter(w => Math.abs(w.cy - lineY) < Math.max(14, w.h));
                const social = nearby.find(n => normalize(n.text).includes('SOCIAL'));
                if (social) {
                    razonLabelBox = {
                        x0: Math.min(words[i].x0, social.x0),
                        y0: Math.min(words[i].y0, social.y0),
                        x1: Math.max(words[i].x1, social.x1),
                        y1: Math.max(words[i].y1, social.y1)
                    };
                } else {
                    razonLabelBox = { x0: words[i].x0, y0: words[i].y0, x1: words[i].x1, y1: words[i].y1 };
                }
                break;
            }
        }

        // Buscar etiqueta "DESCRIPCION" o "DESCRIPCIÓN"
        let descrLabelBox = null;
        for (let i = 0; i < words.length; i++) {
            const t = normalize(words[i].text);
            if (t.includes('DESCRIPCION') || t.includes('DESCRIPCIÓN') || (t === '5')) {
                const lineY = words[i].cy;
                const nearby = words.filter(w => Math.abs(w.cy - lineY) < Math.max(14, w.h));
                // Unión de palabras cercanas que componen la etiqueta
                let minx = words[i].x0, miny = words[i].y0, maxx = words[i].x1, maxy = words[i].y1;
                nearby.forEach(n => {
                    const nt = normalize(n.text);
                    if (nt && (nt.includes('DESCRIP') || nt.includes('NOMBRE') || nt.includes('RESIDUO') || nt.includes('CARACTER') || nt === 'DEL' || nt === '5')) {
                        minx = Math.min(minx, n.x0);
                        miny = Math.min(miny, n.y0);
                        maxx = Math.max(maxx, n.x1);
                        maxy = Math.max(maxy, n.y1);
                    }
                });
                descrLabelBox = { x0: minx, y0: miny, x1: maxx, y1: maxy };
                break;
            }
        }

        // Si no se detecta ninguna etiqueta, devolvemos null (fallback posterior a DEFAULT_RECTS)
        if (!razonLabelBox && !descrLabelBox) return null;

        // Construir rects de VALOR a partir de label boxes (heurística):
        // RAZON: la información suele estar a la derecha en la misma línea -> tomamos desde label.x1 hasta margen derecho
        // DESCRIPCION: bloque debajo (y/o a la derecha) de la etiqueta -> tomamos desde label.y1 hacia abajo una altura grande

        const padX = Math.round(imgW * 0.01);
        const padY = Math.round(imgH * 0.01);

        let razonRect = null;
        if (razonLabelBox) {
            const rx0 = Math.max(0, razonLabelBox.x1 - padX); // empezamos justo después de la etiqueta
            const rx1 = Math.min(imgW, imgW - Math.round(imgW * 0.03)); // dejar pequeño margen derecho
            const ry0 = Math.max(0, razonLabelBox.y0 - padY);
            const ry1 = Math.min(imgH, razonLabelBox.y1 + Math.round(razonLabelBox.h * 1.2) + padY);
            razonRect = { x: rx0 / imgW, y: ry0 / imgH, w: (rx1 - rx0) / imgW, h: (ry1 - ry0) / imgH };
        }

        let descrRect = null;
        if (descrLabelBox) {
            // bloque que empieza justo debajo de la etiqueta y se extiende a la derecha
            const dx0 = Math.max(0, descrLabelBox.x0 - padX);
            const dx1 = Math.min(imgW, dx0 + Math.round(imgW * 0.80));
            const dy0 = Math.max(0, descrLabelBox.y1 - Math.round(descrLabelBox.h * 0.3));
            const dy1 = Math.min(imgH, dy0 + Math.round(imgH * 0.20)); // altura inicial grande
            descrRect = { x: dx0 / imgW, y: dy0 / imgH, w: (dx1 - dx0) / imgW, h: (dy1 - dy0) / imgH };
        }

        // Si no hay descrRect pero sí razon, adivinar descrRect más abajo (fallback)
        if (!descrRect && razonLabelBox) {
            const guessY = Math.min(0.9, (razonLabelBox.y1 / imgH) + 0.07);
            descrRect = { x: 0.05, y: guessY, w: 0.8, h: 0.18 };
        }

        // clamp
        function clampRect(r) {
            if (!r) return r;
            return {
                x: Math.max(0, Math.min(1, r.x)),
                y: Math.max(0, Math.min(1, r.y)),
                w: Math.max(0.01, Math.min(1, r.w)),
                h: Math.max(0.01, Math.min(1, r.h))
            };
        }

        return { razonRect: clampRect(razonRect), descrRect: clampRect(descrRect) };

    } catch (e) {
        console.warn('detectLabelRectsUsingWords fallo:', e);
        return null;
    }
}

// ==================== EXTRAER MEDIANTE DETECCIÓN+ CROPS (PRINCIPAL) ====================
async function extractFieldsByCrop(file) {
    // Intentar detectar etiquetas y rects
    let rects = null;
    try {
        rects = await detectLabelRectsUsingWords(file);
    } catch (e) {
        console.warn('Detección de etiquetas falló:', e);
    }

    const { razonRect: defaultRazon, descrRect: defaultDescr } = DEFAULT_RECTS;
    const razonRect = (rects && rects.razonRect) ? rects.razonRect : defaultRazon;
    const descrRect = (rects && rects.descrRect) ? rects.descrRect : defaultDescr;

    let razonText = '';
    let descrText = '';
    let fullResult = null;

    // OCR de RAZON (modo single line preferente)
    try {
        razonText = await ocrCrop(file, razonRect, '7');
    } catch (e) {
        console.warn('ocrCrop razon fallo:', e);
    }

    // intentar recortar header pequeño en descripcion y detectar si etiqueta está dentro
    let headerText = '';
    try {
        const headerFrac = Math.min(0.08, descrRect.h || 0.06);
        const headerRect = { x: descrRect.x, y: descrRect.y, w: descrRect.w, h: headerFrac };
        headerText = await ocrCrop(file, headerRect, '6');
    } catch (e) {
        headerText = '';
    }

    const hasHeaderLabel = /DESCRIPCION|DESCRIPCIÓN|DESCRIPCION\s*\(Nombre/i.test(headerText || '');
    let actualDescrRect = descrRect;
    if (hasHeaderLabel) {
        const headerH = Math.min((descrRect.h || 0.06), 0.08);
        const newY = descrRect.y + headerH;
        const newH = Math.max(0.04, (descrRect.h || 0.15) - headerH);
        actualDescrRect = { x: descrRect.x, y: newY, w: descrRect.w, h: newH };
    } else {
        actualDescrRect = { ...descrRect };
    }

    // OCR de DESCRIPCION
    try {
        descrText = await ocrCrop(file, actualDescrRect, '6');
    } catch (e) {
        console.warn('ocrCrop descripcion fallo:', e);
    }

    // Fallback OCR completo si textos demasiado cortos
    if ((!razonText || razonText.length < 3) || (!descrText || descrText.length < 3)) {
        try {
            fullResult = await ejecutarOCR(file);
            const fallback = extraerCamposNumeradosFromFull(fullResult);
            if (!razonText || razonText.length < 3) razonText = fallback.razonSocial || '';
            if (!descrText || descrText.length < 3) descrText = fallback.descripcionResiduo || '';
        } catch (e) {
            console.warn('OCR completo fallback fallo:', e);
        }
    }

    // limpieza y normalización básica
    function cleanLines(raw) {
        if (!raw) return '';
        return raw.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean).join(' ');
    }

    const descripcionFinal = (cleanLines(descrText) || '').replace(/^(DESCRIPCION|DESCRIPCIÓN)[\:\-\s]*/i, '').trim();
    const razonFinal = (razonText || '').replace(/^\s*4[\.\-\)\:\s]*/i, '').replace(/RAZON SOCIAL.*?:?/i, '').trim();

    console.log('DEBUG used rects:', { razonRect, descrRect, actualDescrRect });
    console.log('DEBUG razonRaw:', razonText, 'descRaw:', descrText);

    return {
        razonSocial: razonFinal || 'Desconocido',
        descripcionResiduo: descripcionFinal || 'Desconocido',
        fechaManifiesto: (fullResult && fullResult.data && fullResult.data.text) ? (
            (fullResult.data.text.match(/(\b\d{2}[\/\-]\d{2}[\/\-]\d{2,4}\b)/) || [])[1] || ''
        ) : '',
        folio: (fullResult && fullResult.data && fullResult.data.text) ? (
            ((fullResult.data.text.match(/\bFOLIO[:\s\-]*([A-Z0-9\-]{3,})\b/i) || [])[1]) || ''
        ) : ''
    };
}

function extraerCamposNumeradosFromFull(tesseractResult) {
    const salida = { razonSocial: '', descripcionResiduo: '' };
    if (!tesseractResult || !tesseractResult.data) return salida;
    const fullText = tesseractResult.data.text || '';
    const lines = fullText.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        if (/^\s*4\s*[\.:\-)]/.test(ln) || /RAZON SOCIAL/i.test(ln)) {
            const rest = ln.replace(/^\s*4\s*[\.:\-)]/, '').replace(/RAZON SOCIAL.*[:\-]?/i, '').trim();
            salida.razonSocial = rest || (lines[i + 1] || '');
        }
        if (/^\s*5\s*[\.:\-)]/.test(ln) || /DESCRIPCION/i.test(ln)) {
            let rest = ln.replace(/^\s*5\s*[\.:\-)]/, '').replace(/DESCRIPCION.*[:\-]?/i, '').trim();
            if (!rest) rest = (lines[i + 1] || '') + ' ' + (lines[i + 2] || '');
            salida.descripcionResiduo = rest.trim();
        }
    }
    return salida;
}

// ==================== MATCHING AVANZADO (helpers) ====================
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
function tokenizeWords(s) {
    if (!s) return [];
    return s
        .toUpperCase()
        .replace(/[^A-Z0-9ÑÁÉÍÓÚ\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
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
    const tA = tokenizeWords(resTarget);
    const tB = tokenizeWords(residuoMaster);
    const tokenScore = tokenIntersectionScore(tA, tB);
    if (tokenScore >= 0.45) return true;
    const sim = similarityNormalized(resTarget, residuoMaster);
    if (sim >= 0.72) return true;
    return false;
}
function normForMatching(s) { return normalizeForCompare(s || '').toUpperCase(); }

// ==================== FUNCION MEJORADA verificarContraListaMaestra ====================
function verificarContraListaMaestra(razonSocial, descripcionResiduo) {
    const resultado = { esAceptable: true, coincidencias: [], motivo: '', nivelRiesgo: 'bajo', accionesRecomendadas: [] };
    const genTargetNorm = normForMatching(razonSocial);
    const resTargetNorm = normForMatching(descripcionResiduo);

    function pushCoin(tipo, valor, estado, motivo) {
        resultado.coincidencias.push({ tipo, valor, estado, motivo });
    }

    // palabras peligrosas
    if (descripcionResiduo) {
        const descTokens = tokenizeWords(descripcionResiduo);
        for (const p of PALABRAS_PELIGROSAS) {
            const pNorm = normForMatching(p);
            if (resTargetNorm && containsAsWord(resTargetNorm, pNorm)) {
                resultado.esAceptable = false;
                resultado.motivo = `❌ RECHAZADO: Se detectó término peligroso "${p}" en la descripción.`;
                resultado.nivelRiesgo = 'alto';
                resultado.coincidencias.push({ tipo: 'palabra_peligrosa', valor: p, estado: 'rechazado_automatico', motivo: 'Palabra peligrosa detectada' });
                resultado.accionesRecomendadas = ['No aceptar ingreso. Revisar clasificaciones.'];
            } else {
                const tP = tokenizeWords(p);
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
            textoOriginal: '',
            fechaAnalisis: new Date().toISOString(),
            idAnalisis: 'ANL-' + Date.now().toString().slice(-8)
        };

        if (progressBar) progressBar.style.width = '100%';
        if (progressText) progressText.textContent = 'Generando resultados...';

        setTimeout(() => {
            if (processingCard) processingCard.style.display = 'none';
            if (resultsCard) resultsCard.style.display = 'block';
            mostrarResultadosEnInterfaz(ultimoResultado);
            console.log('Análisis completado');
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

    console.log('mostrarResultadosEnInterfaz: company=', company, 'waste=', waste);
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
