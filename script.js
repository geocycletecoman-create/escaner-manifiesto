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

// -------------------- GLOBALES --------------------
let currentImage = null;
let tesseractWorker = null;
let cameraStream = null;
let ultimoResultado = null;
let historialIncidencias = [];

// -------------------- UTIL: normalizar para comparar --------------------
function normalizeForCompare(s) {
    if (!s) return '';
    let r = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    r = r.replace(/[^A-Za-z0-9\s]/g, ' ');
    r = r.replace(/\s+/g, ' ').trim().toUpperCase();
    return r;
}

// -------------------- TESSERACT init y OCR --------------------
async function inicializarTesseract() {
    if (typeof Tesseract === 'undefined') throw new Error('Tesseract.js no encontrado');
    tesseractWorker = await Tesseract.createWorker({ logger: m => console.log('Tesseract:', m) });
    await tesseractWorker.loadLanguage('spa');
    await tesseractWorker.initialize('spa');
    try { await tesseractWorker.setParameters({ tessedit_pageseg_mode: '6' }); } catch(e) {}
    console.log('Tesseract inicializado');
}

async function ejecutarOCR(imagen) {
    if (!imagen) throw new Error('No hay imagen para OCR');
    if (!tesseractWorker) await inicializarTesseract();
    const result = await tesseractWorker.recognize(imagen);
    return result; // objeto completo: result.data.text, result.data.words, result.data.lines ...
}

// -------------------- EXTRACCIÓN POR BOUNDING BOXES (CAMPO 4 y 5) --------------------
function extractFieldsFromBBoxes(tesseractResult) {
    // Retorno por defecto
    const salida = { razonSocial: 'Desconocido', descripcionResiduo: 'Desconocido', fechaManifiesto: '', folio: '' };
    if (!tesseractResult || !tesseractResult.data) return salida;

    // Obtener palabras (o fallback a símbolos)
    const rawWords = Array.isArray(tesseractResult.data.words) && tesseractResult.data.words.length > 0
        ? tesseractResult.data.words
        : (Array.isArray(tesseractResult.data.symbols) ? tesseractResult.data.symbols : []);

    // Mapear a formato uniforme: text, x0,y0,x1,y1, cx, cy, h
    const words = rawWords.map(w => {
        const text = (w.text || w.word || '').replace(/\t/g,'').trim();
        // bbox en distintas versiones puede ser .bbox {x0,y0,x1,y1} o props x0,y0,x1,y1
        const bbox = w.bbox || {};
        const x0 = bbox.x0 != null ? bbox.x0 : (w.x0 != null ? w.x0 : (w.x != null ? w.x : 0));
        const y0 = bbox.y0 != null ? bbox.y0 : (w.y0 != null ? w.y0 : (w.y != null ? w.y : 0));
        const x1 = bbox.x1 != null ? bbox.x1 : (w.x1 != null ? w.x1 : (w.x2 != null ? w.x2 : x0 + (w.width || 0)));
        const y1 = bbox.y1 != null ? bbox.y1 : (w.y1 != null ? w.y1 : (w.y2 != null ? w.y2 : y0 + (w.height || 0)));
        const cx = (x0 + x1)/2;
        const cy = (y0 + y1)/2;
        const h = Math.max(1, y1 - y0);
        return { text, x0, y0, x1, y1, cx, cy, h };
    }).filter(w => w.text && w.text.trim().length > 0);

    if (words.length === 0) {
        console.log('No se detectaron palabras con bbox. Fallback a texto completo.');
        const full = tesseractResult.data.text || '';
        // fallback sencillo: buscar con regex en texto el "4." y "5."
        const fallback = extractFieldsFallback(full);
        return fallback;
    }

    // Clusterizar palabras por línea según cy (distancia menor a un factor de altura media)
    const avgH = words.reduce((s,w) => s + w.h, 0) / words.length;
    const rowThreshold = Math.max(8, avgH * 0.6);

    // ordenar por cy y luego agrupar
    words.sort((a,b) => a.cy - b.cy || a.x0 - b.x0);
    const rows = [];
    let currentRow = { y: words[0].cy, words: [words[0]] };
    for (let i = 1; i < words.length; i++) {
        const w = words[i];
        if (Math.abs(w.cy - currentRow.y) <= rowThreshold) {
            currentRow.words.push(w);
            currentRow.y = (currentRow.y * (currentRow.words.length -1) + w.cy) / currentRow.words.length;
        } else {
            rows.push(currentRow);
            currentRow = { y: w.cy, words: [w] };
        }
    }
    rows.push(currentRow);

    // Normalizar texto por fila (ordenando palabras por x)
    const rowsText = rows.map(r => {
        const ws = r.words.slice().sort((a,b) => a.x0 - b.x0);
        const text = ws.map(w => w.text).join(' ');
        return { y: r.y, words: ws, text };
    });

    console.log('DEBUG rowsText (primeras 30):', rowsText.slice(0,30).map(r=>r.text));

    // Función para detectar fila que contiene numeración o etiqueta
    function findRowIndexForNumber(num, keywords = []) {
        const rxStart = new RegExp(`^\\s*${num}\\s*[\\.\\-\\)\\:]?\\b`, 'i');
        for (let i = 0; i < rowsText.length; i++) {
            const t = rowsText[i].text;
            if (rxStart.test(t)) return i;
            // si la numeración quedó separada en una palabra y la etiqueta en otra fila,
            // buscar patrón: palabra "4" por sí sola en fila previa a etiqueta
            // además respaldo: si fila contiene labelKeywords
            if (keywords.some(k => new RegExp(`\\b${k}\\b`, 'i').test(t))) return i;
        }
        // respaldo: buscar palabra exactamente "4" o "4.-" entre todas las palabras, devolver su fila
        for (let i = 0; i < rows.length; i++) {
            const found = rows[i].words.find(w => /^4$|^4[.\-)]$|^4[-\.]?$/.test(w.text));
            if (found) return i;
        }
        return -1;
    }

    // Extraer contenido a la derecha de la numeración:
    function extractRightContentFromRow(rowIndex) {
        if (rowIndex < 0 || rowIndex >= rows.length) return null;
        const row = rows[rowIndex];
        // encontrar la palabra que contiene el "4" o "5" dentro de la fila (buscar la palabra con regex)
        let labelWordIndex = row.words.findIndex(w => /^4$|^4[.\-)]$|^4[-\.]?$|^5$|^5[.\-)]$|^5[-\.]?$/.test(w.text));
        if (labelWordIndex === -1) {
            // quizá el número y la etiqueta están juntos (ej. "4.-RAZON" o "4.- RAZON")
            labelWordIndex = row.words.findIndex(w => /^\d+\W/.test(w.text));
        }
        // si no encontramos la palabra numerada, usar toda la fila menos primeras 1-2 palabras (intentar)
        let contentWords = [];
        if (labelWordIndex >= 0) {
            // tomar todas las palabras a la derecha del labelWord (x0 mayor)
            const xLabelEnd = row.words[labelWordIndex].x1;
            contentWords = row.words.filter(w => w.x0 > xLabelEnd + 2); // pequeño margen
            // si está vacio, tomar las palabras a la derecha por posición: palabras con x0 > median x0
            if (contentWords.length === 0) {
                contentWords = row.words.slice(labelWordIndex+1);
            }
        } else {
            // fallback: tomar todo el texto de la fila excepto primeras 1-2 tokens
            contentWords = row.words.slice(1);
        }
        return (contentWords.map(w => w.text).join(' ')).trim();
    }

    // Buscar campo 4 (razon social)
    let idx4 = findRowIndexForNumber(4, ['RAZON SOCIAL','RAZÓN SOCIAL','RAZON']);
    let razon = '';
    if (idx4 !== -1) {
        razon = extractRightContentFromRow(idx4);
        // si lo que hay en la misma línea es etiqueta (p. ej. "4.- RAZON SOCIAL ...") y no hay valor,
        // intentar tomar la siguiente fila completa
        if (!razon || razon.length < 3) {
            if (idx4 + 1 < rowsText.length) razon = rowsText[idx4+1].text;
        }
    }

    // Buscar campo 5 (descripcion). Puede ser multi-línea: tomamos la fila y siguientes hasta parar en numeración siguiente o hasta 4 filas
    let idx5 = findRowIndexForNumber(5, ['DESCRIPCION','DESCRIPCIÓN','DESCRIPCION (Nombre']);
    let descripcion = '';
    if (idx5 !== -1) {
        // extraer contenido en la fila 5 a la derecha del label
        const firstLine = extractRightContentFromRow(idx5);
        const parts = [];
        if (firstLine && firstLine.length >= 1) parts.push(firstLine);
        // concatenar siguientes filas hasta encontrar numeración o headers (p. ej. 'CONTENEDOR', 'CAPACIDAD')
        const stopKeywords = ['CONTENEDOR','CAPACIDAD','CANTIDAD','UNIDAD','TIPO','INSTRUCCIONES'];
        for (let j = idx5 + 1; j < Math.min(rowsText.length, idx5 + 6); j++) {
            const t = rowsText[j].text;
            if (/^\s*\d+\s*[\.:\-)]/.test(t)) break;
            if (stopKeywords.some(k => new RegExp(`\\b${k}\\b`, 'i').test(t))) break;
            parts.push(t);
        }
        descripcion = parts.join(' ').trim();
    }

    // Fallbacks: si no encontramos por boxes, intentar buscar en text completo por regex (como último recurso)
    const fullText = (tesseractResult.data && tesseractResult.data.text) ? tesseractResult.data.text : '';
    if ((!razon || razon.length < 2) && /raz[oó]n social/i.test(fullText)) {
        const m = fullText.match(/raz[oó]n social(?: de la empresa generadora)?[:\-\s]*([^\n]{3,200})/i);
        if (m && m[1]) razon = m[1].trim();
    }
    if ((!descripcion || descripcion.length < 2) && /descripci[oó]n/i.test(fullText)) {
        const m = fullText.match(/descripci[oó]n(?:.*?residuo)?[:\-\s]*([^\n]{3,500})/i);
        if (m && m[1]) descripcion = m[1].trim();
    }

    // extraer fecha/folio si están en fullText
    const fechaMatch = fullText.match(/(\b\d{2}[\/\-]\d{2}[\/\-]\d{2,4}\b)/) || fullText.match(/(\b\d{4}[\/\-]\d{2}[\/\-]\d{2}\b)/);
    if (fechaMatch) salida.fechaManifiesto = fechaMatch[1];
    const folioMatch = fullText.match(/\bFOLIO[:\s\-]*([A-Z0-9\-]{3,})\b/i) || fullText.match(/\bNo\.?\s*[:\s\-]*([A-Z0-9\-]{3,})\b/i);
    if (folioMatch) salida.folio = folioMatch[1];

    salida.razonSocial = (razon || salida.razonSocial).replace(/^[\d\.\-\)\:\s]+/, '').trim();
    salida.descripcionResiduo = (descripcion || salida.descripcionResiduo).replace(/^[\d\.\-\)\:\s]+/, '').trim();

    // DEBUG: mostrar filas y resultado
    console.log('DEBUG filas detectadas (primeras 30):', rowsText.slice(0,30).map(r => r.text));
    console.log('DEBUG EXTRAIDO -> RAZON:', salida.razonSocial);
    console.log('DEBUG EXTRAIDO -> DESCRIPCION:', salida.descripcionResiduo);

    return salida;
}

// -------------------- fallback simple (si boxes no disponibles) --------------------
function extractFieldsFallback(fullText) {
    const salida = { razonSocial: 'Desconocido', descripcionResiduo: 'Desconocido', fechaManifiesto: '', folio: '' };
    if (!fullText) return salida;
    const lines = fullText.replace(/\r/g,'').split('\n').map(l => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        if (/^\s*4\s*[\.:\-)]/.test(ln) || /RAZON SOCIAL/i.test(ln)) {
            const rest = ln.replace(/^\s*4\s*[\.:\-)]/, '').replace(/RAZON SOCIAL.*[:\-]?/i, '').trim();
            salida.razonSocial = rest || (lines[i+1] || '');
        }
        if (/^\s*5\s*[\.:\-)]/.test(ln) || /DESCRIPCION/i.test(ln)) {
            let rest = ln.replace(/^\s*5\s*[\.:\-)]/, '').replace(/DESCRIPCION.*[:\-]?/i, '').trim();
            if (!rest) {
                rest = (lines[i+1] || '') + ' ' + (lines[i+2] || '');
            }
            salida.descripcionResiduo = rest.trim();
        }
    }
    const fechaMatch = fullText.match(/(\b\d{2}[\/\-]\d{2}[\/\-]\d{2,4}\b)/);
    if (fechaMatch) salida.fechaManifiesto = fechaMatch[1];
    const folioMatch = fullText.match(/\bFOLIO[:\s\-]*([A-Z0-9\-]{3,})\b/i);
    if (folioMatch) salida.folio = folioMatch[1];
    return salida;
}

// -------------------- verificar contra lista maestra (igual que antes) --------------------
function verificarContraListaMaestra(razonSocial, descripcionResiduo) {
    const resultado = { esAceptable: true, coincidencias: [], motivo: '', nivelRiesgo: 'bajo', accionesRecomendadas: [] };
    const genTargetNorm = normalizeForCompare(razonSocial);
    const resTargetNorm = normalizeForCompare(descripcionResiduo);
    function pushCoin(tipo, valor, estado, motivo) {
        resultado.coincidencias.push({ tipo, valor, estado, motivo });
    }
    for (const item of LISTA_MAESTRA) {
        const genNorm = normalizeForCompare(item.generador || '');
        if (genNorm && (genTargetNorm.includes(genNorm) || genNorm.includes(genTargetNorm) || genNorm === genTargetNorm)) {
            pushCoin('generador', item.generador, item.estado, item.motivo);
            if (item.estado.includes('rechaz')) { resultado.esAceptable = false; resultado.motivo = `❌ RECHAZADO: Generador identificado (${item.generador})`; resultado.nivelRiesgo='alto'; resultado.accionesRecomendadas=['No aceptar ingreso.']; }
            else if (item.estado.includes('requiere')) { resultado.esAceptable = false; resultado.motivo = `⚠️ REQUIERE REVISIÓN: Generador identificado (${item.generador})`; resultado.nivelRiesgo='medio'; resultado.accionesRecomendadas=['Revisión de documentación']; }
        }
        if (Array.isArray(item.residuos)) {
            for (const res of item.residuos) {
                const resNorm = normalizeForCompare(res || '');
                if (!resNorm) continue;
                if ((resTargetNorm && (resTargetNorm.includes(resNorm) || resNorm.includes(resTargetNorm)))) {
                    pushCoin('residuo_especifico', res, item.estado, item.motivo);
                    if (item.estado.includes('rechaz')) { resultado.esAceptable=false; resultado.motivo=`❌ RECHAZADO: Residuo (${res})`; resultado.nivelRiesgo='alto'; resultado.accionesRecomendadas=['No aceptar ingreso.']; }
                    else if (item.estado.includes('requiere')) { resultado.esAceptable=false; resultado.motivo=`⚠️ REQUIERE REVISIÓN: Residuo (${res})`; resultado.nivelRiesgo='medio'; resultado.accionesRecomendadas=['Solicitar documentación adicional.']; }
                }
            }
        }
    }
    if (resultado.esAceptable) resultado.motivo = '✅ Documento aceptado: Generador y residuo no encontrados en listas reguladas.';
    return resultado;
}

// -------------------- iniciarAnalisis (usa extractFieldsFromBBoxes) --------------------
async function iniciarAnalisis() {
    if (!currentImage) { alert('Sube o captura la imagen primero.'); return; }
    // UI: mostrar processing...
    const processingCard = document.querySelector('.processing-card');
    const firstCard = document.querySelector('.card:first-of-type');
    const resultsCard = document.querySelector('.results-card');
    if (firstCard) firstCard.style.display = 'none';
    if (processingCard) processingCard.style.display = 'block';
    if (resultsCard) resultsCard.style.display = 'none';

    try {
        const ocrResult = await ejecutarOCR(currentImage);
        // DEBUG: muestra texto completo y palabras detectadas (en consola)
        console.log('OCR completo (primeras 1200 chars):', (ocrResult && ocrResult.data && ocrResult.data.text) ? (ocrResult.data.text.substring(0,1200)) : '');
        if (ocrResult && ocrResult.data && Array.isArray(ocrResult.data.words)) {
            console.log('OCR palabras (primeras 60):', ocrResult.data.words.slice(0,60).map(w => w.text));
        }

        const datos = extractFieldsFromBBoxes(ocrResult);

        const verif = verificarContraListaMaestra(datos.razonSocial, datos.descripcionResiduo);

        ultimoResultado = {
            ...datos,
            ...verif,
            textoOriginal: (ocrResult && ocrResult.data && ocrResult.data.text) ? ocrResult.data.text : '',
            fechaAnalisis: new Date().toISOString(),
            idAnalisis: 'ANL-' + Date.now().toString().slice(-8)
        };

        // mostrar resultados en UI (tu implementación)
        if (processingCard) processingCard.style.display = 'none';
        if (resultsCard) resultsCard.style.display = 'block';
        mostrarResultadosEnInterfaz(ultimoResultado);
    } catch (err) {
        console.error('Error en iniciarAnalisis:', err);
        mostrarError('Error al procesar imagen: ' + (err && err.message ? err.message : err));
        if (firstCard) firstCard.style.display = 'block';
        const processingCard = document.querySelector('.processing-card');
        if (processingCard) processingCard.style.display = 'none';
    }
}

// -------------------- mostrarResultadosEnInterfaz (mínimo) --------------------
function mostrarResultadosEnInterfaz(resultado) {
    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || ''; };
    setText('detectedCompany', resultado.razonSocial);
    setText('detectedWaste', resultado.descripcionResiduo);
    setText('detectedDate', resultado.fechaManifiesto);
    setText('detectedFolio', resultado.folio);
    // adicional: llenar UI de verificación (igual que en tu versión)
    console.log('RESULTADO FINAL:', resultado);
}

// -------------------- Resto de utilidades / eventos (igual que antes) --------------------
function setupEventListeners() {
    const fileInput = document.getElementById('fileInput');
    const processBtn = document.getElementById('processBtn');
    const uploadBtn = document.getElementById('uploadBtn');
    const cameraBtn = document.getElementById('cameraBtn');
    const captureBtn = document.getElementById('captureBtn');
    const cancelCameraBtn = document.getElementById('cancelCameraBtn');
    if (fileInput) fileInput.addEventListener('change', handleFileSelect);
    if (processBtn) processBtn.addEventListener('click', iniciarAnalisis);
    if (uploadBtn) uploadBtn.addEventListener('click', () => fileInput && fileInput.click());
    if (cameraBtn) cameraBtn.addEventListener('click', openCamera);
    if (captureBtn) captureBtn.addEventListener('click', captureFromCamera);
    if (cancelCameraBtn) cancelCameraBtn.addEventListener('click', closeCamera);
}
function handleFileSelect(e) { const f = e.target.files[0]; if (!f) return; currentImage = f; mostrarPreviewFile(f); const btn = document.getElementById('processBtn'); if (btn) btn.disabled = false; }
function mostrarPreviewFile(file) { const url = URL.createObjectURL(file); const ip = document.getElementById('imagePreview'); if (ip) ip.innerHTML = `<img src="${url}" style="max-width:100%;max-height:380px;">`; }
async function openCamera() { try { if (cameraStream) cameraStream.getTracks().forEach(t=>t.stop()); cameraStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}, audio:false}); const v = document.getElementById('cameraStream'); if (v) v.srcObject = cameraStream; } catch(e) { console.error(e); alert('No se pudo abrir cámara'); } }
function captureFromCamera() { const v = document.getElementById('cameraStream'); if (!v) return; const c = document.createElement('canvas'); c.width = v.videoWidth || 1280; c.height = v.videoHeight || 720; c.getContext('2d').drawImage(v,0,0,c.width,c.height); c.toBlob(b => { currentImage = new File([b],'capture.jpg',{type:'image/jpeg'}); mostrarPreviewFile(currentImage); const btn=document.getElementById('processBtn'); if (btn) btn.disabled=false; }, 'image/jpeg', 0.9); }
function closeCamera(){ if (cameraStream) cameraStream.getTracks().forEach(t=>t.stop()); cameraStream=null; }

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    try { await inicializarTesseract(); } catch(e) { console.warn('Tesseract init error', e); }
    try { const saved = localStorage.getItem('historialIncidencias'); if (saved) historialIncidencias = JSON.parse(saved); } catch(e){}
});
