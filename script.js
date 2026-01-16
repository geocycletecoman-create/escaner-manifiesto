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

// ==================== HELPERS: convertir file a image y crop -> blob ====================
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
    const sw = Math.round(rect.w * img.naturalWidth);
    const sh = Math.round(rect.h * img.naturalHeight);
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
        // ajustar psm para esta tarea
        try { await tesseractWorker.setParameters({ tessedit_pageseg_mode: psm }); } catch (e) {}
    } catch (e) {
        // ignore
    }

    const result = await tesseractWorker.recognize(cropBlob);
    return (result && result.data && result.data.text) ? result.data.text.trim() : '';
}

// ==================== EXTRAER MEDIANTE CROPS (campos 4 y 5) ====================
// Aquí definimos las coordenadas relativas (x,y,w,h) en fracciones [0..1].
// Estas coordenadas están calculadas a partir de tus imágenes de ejemplo y pueden requerir
// pequeños ajustes si los escaneos varían (rotación/escala/márgenes).
//
// RECOMENDACIÓN: si tus manifiestos siempre tienen el mismo layout, estos rects funcionarán bien.
// Si ves desplazamientos, házmelo saber y te doy valores afinados.
//
// Valores iniciales (ajustables):
// - razonRect: recorta la franja donde normalmente aparece "4.- RAZON SOCIAL ..."
// - descrRect: recorta el bloque donde aparece "5.- DESCRIPCION" y las líneas de texto a la izquierda de la tabla
const DEFAULT_RECTS = {
    // Ajusta estos valores si el recorte no queda centrado:
    // x: distancia desde la izquierda (0..1), y: desde arriba, w: ancho, h: altura
    // Estos valores son aproximados para la imagen de ejemplo; ajústalos en caso de variación.
    razonRect: { x: 0.05, y: 0.20, w: 0.90, h: 0.07 },   // línea de razón social (4)
    descrRect:  { x: 0.05, y: 0.30, w: 0.70, h: 0.20 }    // bloque de descripción (5) - NOTA: w < total para evitar tabla
};

async function extractFieldsByCrop(file) {
    // Usa los rects por defecto; puedes exponer UI para ajustarlos si lo necesitas
    const { razonRect, descrRect } = DEFAULT_RECTS;

    // 1) OCR en razón social (psm=7 -> single line)
    let razonText = '';
    try {
        razonText = await ocrCrop(file, razonRect, '7');
    } catch (e) {
        console.warn('ocrCrop razon fallo:', e);
        razonText = '';
    }

    // 2) OCR en descripción (psm=6 -> auto para párrafos)
    let descrText = '';
    try {
        descrText = await ocrCrop(file, descrRect, '6');
    } catch (e) {
        console.warn('ocrCrop descripcion fallo:', e);
        descrText = '';
    }

    // 3) Si crop devolvió poco (ej. OCR falló), fallback: OCR completo y extraer por numeración
    let fullResult = null;
    if ((!razonText || razonText.length < 3) || (!descrText || descrText.length < 3)) {
        try {
            fullResult = await ejecutarOCR(file);
            // usar fallback heurístico similar a antes
            const fallback = extraerCamposNumeradosFromFull(fullResult);
            if (!razonText || razonText.length < 3) razonText = fallback.razonSocial;
            if (!descrText || descrText.length < 3) descrText = fallback.descripcionResiduo;
        } catch (e) {
            console.warn('OCR completo fallback fallo:', e);
        }
    }

    // limpieza
    razonText = (razonText || '').replace(/^\s*4[\.\-\)\:\s]*/i, '').replace(/RAZON SOCIAL.*?:?/i, '').trim();
    descrText = (descrText || '').replace(/^\s*5[\.\-\)\:\s]*/i, '').replace(/DESCRIPCION.*?:?/i, '').trim();

    console.log('DEBUG CROP -> RAZON:', razonText);
    console.log('DEBUG CROP -> DESCRIPCION:', descrText);

    return {
        razonSocial: razonText || 'Desconocido',
        descripcionResiduo: descrText || 'Desconocido',
        fechaManifiesto: (fullResult && fullResult.data && fullResult.data.text) ? (
            (fullResult.data.text.match(/(\b\d{2}[\/\-]\d{2}[\/\-]\d{2,4}\b)/) || [])[1] || ''
        ) : '',
        folio: (fullResult && fullResult.data && fullResult.data.text) ? (
            ((fullResult.data.text.match(/\bFOLIO[:\s\-]*([A-Z0-9\-]{3,})\b/i) || [])[1]) || ''
        ) : ''
    };
}

// Helper de fallback: extrae campos 4 y 5 del texto completo (similar a extraerCamposNumerados)
function extraerCamposNumeradosFromFull(tesseractResult) {
    const salida = { razonSocial: 'Desconocido', descripcionResiduo: 'Desconocido' };
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

// ==================== FUNCIÓN PRINCIPAL: iniciarAnalisis (usa recorte fijo) ====================
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
    if (progressText) progressText.textContent = 'Ejecutando OCR por recortes...';
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
            textoOriginal: '', // ya almacenado en datos si se usó fallback
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
