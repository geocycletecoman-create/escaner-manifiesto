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
let currentImage = null;       // File/Blob
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

// Escape text before inserting into RegExp
function escapeRegExp(str) {
    if (!str) return '';
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Safe mostrarError wrapper (fallback to alert)
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
        <img src="${url}" alt="Manifiesto" style="max-width:100%; max-height:380px;">
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

// ==================== EXTRACCIÓN POR BOUNDING BOXES (campos 4 y 5) ====================
function extractFieldsFromBBoxes(tesseractResult) {
    const salida = { razonSocial: 'Desconocido', descripcionResiduo: 'Desconocido', fechaManifiesto: '', folio: '' };
    if (!tesseractResult || !tesseractResult.data) return salida;

    const rawWords = Array.isArray(tesseractResult.data.words) && tesseractResult.data.words.length > 0
        ? tesseractResult.data.words
        : (Array.isArray(tesseractResult.data.symbols) ? tesseractResult.data.symbols : []);

    const words = rawWords.map(w => {
        const text = (w.text || w.word || '').replace(/\t/g, '').trim();
        const bbox = w.bbox || {};
        const x0 = bbox.x0 != null ? bbox.x0 : (w.x0 != null ? w.x0 : (w.x != null ? w.x : 0));
        const y0 = bbox.y0 != null ? bbox.y0 : (w.y0 != null ? w.y0 : (w.y != null ? w.y : 0));
        const x1 = bbox.x1 != null ? bbox.x1 : (w.x1 != null ? w.x1 : (w.x2 != null ? w.x2 : x0 + (w.width || 0)));
        const y1 = bbox.y1 != null ? bbox.y1 : (w.y1 != null ? w.y1 : (w.y2 != null ? w.y2 : y0 + (w.height || 0)));
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        const h = Math.max(1, y1 - y0);
        return { text, x0, y0, x1, y1, cx, cy, h };
    }).filter(w => w.text && w.text.trim().length > 0);

    if (words.length === 0) {
        console.log('No se detectaron palabras con bbox. Usando fallback de texto completo.');
        return extractFieldsFallback(tesseractResult.data.text || '');
    }

    // Agrupar por fila usando cy y altura media
    const avgH = words.reduce((s, w) => s + w.h, 0) / words.length;
    const rowThreshold = Math.max(8, avgH * 0.6);

    words.sort((a, b) => a.cy - b.cy || a.x0 - b.x0);
    const rows = [];
    let currentRow = { y: words[0].cy, words: [words[0]] };
    for (let i = 1; i < words.length; i++) {
        const w = words[i];
        if (Math.abs(w.cy - currentRow.y) <= rowThreshold) {
            currentRow.words.push(w);
            currentRow.y = (currentRow.y * (currentRow.words.length - 1) + w.cy) / currentRow.words.length;
        } else {
            rows.push(currentRow);
            currentRow = { y: w.cy, words: [w] };
        }
    }
    rows.push(currentRow);

    const rowsText = rows.map(r => {
        const ws = r.words.slice().sort((a, b) => a.x0 - b.x0);
        const text = ws.map(w => w.text).join(' ');
        return { y: r.y, words: ws, text };
    });

    console.log('DEBUG rowsText (primeras 30):', rowsText.slice(0, 30).map(r => r.text));

    // Helpers: detectar fila por numeración o labelKeywords (escapando keywords)
    function findRowIndexForNumber(num, keywords = []) {
        const rxStart = new RegExp(`^\\s*${num}\\s*[\\.\\-\\)\\:]?\\b`, 'i');
        for (let i = 0; i < rowsText.length; i++) {
            const t = rowsText[i].text;
            if (rxStart.test(t)) return i;
            // respaldo: buscar keywords (escape)
            for (const kw of keywords) {
                const safeKw = escapeRegExp(kw);
                if (new RegExp(`\\b${safeKw}\\b`, 'i').test(t)) return i;
            }
        }
        // respaldo adicional: buscar palabra exactamente "4" o "5" entre filas
        for (let i = 0; i < rows.length; i++) {
            const found = rows[i].words.find(w => /^4$|^4[.\-)]$|^4[-\.]?$/.test(w.text));
            if (found) return i;
        }
        return -1;
    }

    function extractRightContentFromRow(rowIndex, numberTokens = ['4', '5']) {
        if (rowIndex < 0 || rowIndex >= rows.length) return null;
        const row = rows[rowIndex];
        // Buscar índice de la palabra numerada (4 o 5)
        let labelWordIndex = row.words.findIndex(w => numberTokens.some(tok => new RegExp(`^${escapeRegExp(tok)}$|^${escapeRegExp(tok)}[.\\-)]$`, 'i').test(w.text)));
        if (labelWordIndex === -1) {
            labelWordIndex = row.words.findIndex(w => /^\d+\W/.test(w.text));
        }
        let contentWords = [];
        if (labelWordIndex >= 0) {
            const xLabelEnd = row.words[labelWordIndex].x1;
            contentWords = row.words.filter(w => w.x0 > xLabelEnd + 2);
            if (contentWords.length === 0) {
                contentWords = row.words.slice(labelWordIndex + 1);
            }
        } else {
            contentWords = row.words.slice(1);
        }
        return contentWords.map(w => w.text).join(' ').trim();
    }

    // Extraer RAZON (campo 4)
    const razonIdx = findRowIndexForNumber(4, ['RAZON SOCIAL', 'RAZÓN SOCIAL', 'RAZON SOCIAL DE LA EMPRESA']);
    let razon = '';
    if (razonIdx !== -1) {
        razon = extractRightContentFromRow(razonIdx, ['4']);
        if (!razon || razon.length < 3) {
            if (razonIdx + 1 < rowsText.length) razon = rowsText[razonIdx + 1].text;
        }
    }

    // Extraer DESCRIPCION (campo 5) - multiline
    const descrIdx = findRowIndexForNumber(5, ['DESCRIPCION', 'DESCRIPCIÓN', 'DESCRIPCION (Nombre']);
    let descripcion = '';
    if (descrIdx !== -1) {
        const firstLine = extractRightContentFromRow(descrIdx, ['5']);
        const parts = [];
        if (firstLine && firstLine.length > 0) parts.push(firstLine);
        const stopKeywords = ['CONTENEDOR', 'CAPACIDAD', 'CANTIDAD', 'UNIDAD', 'TIPO', 'INSTRUCCIONES'];
        for (let j = descrIdx + 1; j < Math.min(rowsText.length, descrIdx + 6); j++) {
            const t = rowsText[j].text;
            if (/^\s*\d+\s*[\.:\-)]/.test(t)) break;
            if (stopKeywords.some(k => new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i').test(t))) break;
            parts.push(t);
        }
        descripcion = parts.join(' ').trim();
    }

    // Fallbacks si no encontrado
    const fullText = (tesseractResult.data && tesseractResult.data.text) ? tesseractResult.data.text : '';
    if ((!razon || razon.length < 2) && /raz[oó]n social/i.test(fullText)) {
        const m = fullText.match(/raz[oó]n social(?: de la empresa generadora)?[:\-\s]*([^\n]{3,200})/i);
        if (m && m[1]) razon = m[1].trim();
    }
    if ((!descripcion || descripcion.length < 2) && /descripci[oó]n/i.test(fullText)) {
        const m = fullText.match(/descripci[oó]n(?:.*?residuo)?[:\-\s]*([^\n]{3,500})/i);
        if (m && m[1]) descripcion = m[1].trim();
    }

    // fecha y folio
    const fechaMatch = fullText.match(/(\b\d{2}[\/\-]\d{2}[\/\-]\d{2,4}\b)/) || fullText.match(/(\b\d{4}[\/\-]\d{2}[\/\-]\d{2}\b)/);
    if (fechaMatch) salida.fechaManifiesto = fechaMatch[1];
    const folioMatch = fullText.match(/\bFOLIO[:\s\-]*([A-Z0-9\-]{3,})\b/i) || fullText.match(/\bNo\.?\s*[:\s\-]*([A-Z0-9\-]{3,})\b/i);
    if (folioMatch) salida.folio = folioMatch[1];

    salida.razonSocial = (razon || salida.razonSocial).replace(/^[\d\.\-\)\:\s]+/, '').trim();
    salida.descripcionResiduo = (descripcion || salida.descripcionResiduo).replace(/^[\d\.\-\)\:\s]+/, '').trim();

    console.log('DEBUG filas detectadas (primeras 30):', rowsText.slice(0, 30).map(r => r.text));
    console.log('DEBUG EXTRAIDO -> RAZON:', salida.razonSocial);
    console.log('DEBUG EXTRAIDO -> DESCRIPCION:', salida.descripcionResiduo);

    return salida;
}

// Fallback simple si boxes no disponibles
function extractFieldsFallback(fullText) {
    const salida = { razonSocial: 'Desconocido', descripcionResiduo: 'Desconocido', fechaManifiesto: '', folio: '' };
    if (!fullText) return salida;
    const lines = fullText.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        if (/^\s*4\s*[\.:\-)]/.test(ln) || /RAZON SOCIAL/i.test(ln)) {
            const rest = ln.replace(/^\s*4\s*[\.:\-)]/, '').replace(/RAZON SOCIAL.*[:\-]?/i, '').trim();
            salida.razonSocial = rest || (lines[i + 1] || '');
        }
        if (/^\s*5\s*[\.:\-)]/.test(ln) || /DESCRIPCION/i.test(ln)) {
            let rest = ln.replace(/^\s*5\s*[\.:\-)]/, '').replace(/DESCRIPCION.*[:\-]?/i, '').trim();
            if (!rest) {
                rest = (lines[i + 1] || '') + ' ' + (lines[i + 2] || '');
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

// ==================== VERIFICAR CONTRA LISTA MAESTRA ====================
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

        if (Array.isArray(item.residuos)) {
            for (const res of item.residuos) {
                const resNorm = normalizeForCompare(res || '');
                if (!resNorm) continue;
                if ((resTargetNorm && (resTargetNorm.includes(resNorm) || resNorm.includes(resTargetNorm)))) {
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
    if (progressText) progressText.textContent = 'Ejecutando OCR...';
    if (progressBar) progressBar.style.width = '10%';

    try {
        const ocrResult = await ejecutarOCR(currentImage);
        if (progressBar) progressBar.style.width = '40%';
        if (progressText) progressText.textContent = 'Extrayendo campos numerados (4 y 5)...';

        console.log('OCR completo (primeras 1200 chars):', (ocrResult && ocrResult.data && ocrResult.data.text) ? (ocrResult.data.text.substring(0, 1200)) : '');
        if (ocrResult && ocrResult.data && Array.isArray(ocrResult.data.words)) {
            console.log('OCR palabras (primeras 60):', ocrResult.data.words.slice(0, 60).map(w => w.text));
        }

        const datos = extractFieldsFromBBoxes(ocrResult);

        if (progressBar) progressBar.style.width = '60%';
        if (progressText) progressText.textContent = 'Verificando contra lista maestra...';

        const verif = verificarContraListaMaestra(datos.razonSocial, datos.descripcionResiduo);
        if (progressBar) progressBar.style.width = '90%';

        ultimoResultado = {
            ...datos,
            ...verif,
            textoOriginal: (ocrResult && ocrResult.data && ocrResult.data.text) ? ocrResult.data.text : '',
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

// ==================== mostrarResultadosEnInterfaz (simple) ====================
function mostrarResultadosEnInterfaz(resultado) {
    if (!resultado) return;
    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value || ''; };
    setText('detectedCompany', resultado.razonSocial);
    setText('detectedWaste', resultado.descripcionResiduo);
    setText('detectedDate', resultado.fechaManifiesto);
    setText('detectedFolio', resultado.folio);

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

    // mostrar coincidencias en verificationContent si aplica
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
