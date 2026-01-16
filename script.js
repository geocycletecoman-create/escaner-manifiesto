
const LISTA_MAESTRA = [
    { generador: "SYNTHON MEXICO SA DE CV", residuos: ["MEDICAMENTO CADUCO Y OBSOLETO Y EMPAQUE PRIMARIO"], estado: "requiere_permiso_especial", motivo: "Ingreso aceptable" },
    { generador: "RELLENO VILLA DE ALVAREZ", residuos: ["RSU", "Llantas Usadas"], estado: "requiere_permiso_especial", motivo: "Ingreso aceptable" },
    { generador: "LABORATORIOS PISA S.A. DE C.V. (TLAJOMULCO)", residuos: ["BASURA INDUSTRIAL CONTAMINADA"], estado: "requiere_permiso_especial", motivo: "Ingreso aceptable" },
    { generador: "NISSAN MEXICANA, S.A. DE C.V.", residuos: ["reactivos experimentales"], estado: "requiere_revision", motivo: "Requiere revisión de documentación adicional" },
    { generador: "NISSAN MEXICANA, S.A. DE C.V.", residuos: ["INFLAMABLES"], estado: "rechazado_automatico", motivo: "Residuos de inflamables peligrosos no autorizados" }
];

const PALABRAS_PELIGROSAS = [
    "material radiactivo", "infectante", "biológico peligroso", "corrosivo",
    "inflamable", "explosivo", "reactivo", "tóxico", "mutagénico",
    "cancerígeno", "ecotóxico"
];

// ============================================
// VARIABLES GLOBALES
// ============================================
let currentImage = null;       // File/Blob
let tesseractWorker = null;    // global worker
let cameraStream = null;
let ultimoResultado = null;
let historialIncidencias = [];

// ============================================
// UTIL: Normalización para comparación (quita acentos/puntuación y pasa a mayúsculas)
// ============================================
function normalizeForCompare(s) {
    if (!s) return '';
    // quitar diacríticos
    let r = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // reemplazar caracteres no alfanuméricos por espacio
    r = r.replace(/[^A-Za-z0-9\s]/g, ' ');
    // múltiples espacios -> uno, trim y uppercase
    r = r.replace(/\s+/g, ' ').trim().toUpperCase();
    return r;
}

// ============================================
// CAPTURA DE IMAGEN (cámara/archivo)
// ============================================
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
        alert('No se pudo acceder a la cámara. Use carga de archivo.');
        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.click();
    }
}

function handleFileSelect(event) {
    const file = (event.target && event.target.files && event.target.files[0]) || null;
    if (!file) return;
    if (!file.type.match('image.*')) {
        alert('Seleccione una imagen válida (JPEG/PNG).');
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

// ============================================
// TESSERACT: inicializar worker global y función que devuelve objeto completo
// ============================================
async function inicializarTesseract() {
    try {
        if (typeof Tesseract === 'undefined') throw new Error('Tesseract.js no encontrado');
        tesseractWorker = await Tesseract.createWorker({ logger: m => console.log('Tesseract:', m) });
        await tesseractWorker.loadLanguage('spa');
        await tesseractWorker.initialize('spa');
        // sugerencia psm por defecto para formularios; se puede ajustar
        try { await tesseractWorker.setParameters({ tessedit_pageseg_mode: '6' }); } catch (e) {}
        console.log('Tesseract inicializado');
    } catch (e) {
        console.error('Error inicializando Tesseract', e);
        mostrarErrorSistema('No fue posible inicializar OCR (Tesseract).');
    }
}

async function ejecutarOCR(imagen) {
    if (!imagen) throw new Error('No hay imagen para OCR');
    if (!tesseractWorker) await inicializarTesseract();
    try {
        // reconocer y devolver objeto completo (result)
        const result = await tesseractWorker.recognize(imagen);
        return result;
    } catch (e) {
        console.error('Error en ejecutarOCR', e);
        throw e;
    }
}

// ============================================
// EXTRAER CAMPOS NUMERADOS 4 y 5 desde result.data.lines
// ============================================
function extraerCamposNumerados(tesseractResult) {
    const salida = { razonSocial: 'Desconocido', descripcionResiduo: 'Desconocido', fechaManifiesto: '', folio: '' };
    if (!tesseractResult || !tesseractResult.data) return salida;

    // obtener líneas (cada item puede ser { text, ... })
    let lines = [];
    if (Array.isArray(tesseractResult.data.lines)) {
        lines = tesseractResult.data.lines.map(l => (l.text || '').replace(/\u00A0/g, ' ').trim());
    } else {
        const txt = tesseractResult.data.text || '';
        lines = txt.replace(/\r/g, '').split('\n').map(l => l.trim());
    }
    // limpiar líneas vacías
    const cleanLines = lines.map(l => l.replace(/\t/g, ' ').trim()).filter(Boolean);

    // regex para detectar inicio numerado
    const reNumStart = num => new RegExp(`^\\s*${num}\\s*[\\.\\-\\)\\:]?\\s*(.*)`, 'i');
    const reAnyNumStart = /^\s*\d+\s*[\.\-\)\:]/;

    function extractByNumber(num, labelKeywords = []) {
        const rx = reNumStart(num);
        for (let i = 0; i < cleanLines.length; i++) {
            const line = cleanLines[i];
            const m = line.match(rx);
            if (m) {
                let content = (m[1] || '').trim();
                const looksLikeLabelOnly = !content || labelKeywords.some(k => new RegExp(k, 'i').test(content)) || content.length < 3;
                if (looksLikeLabelOnly) {
                    const parts = [];
                    let j = i + 1;
                    while (j < cleanLines.length && !reAnyNumStart.test(cleanLines[j]) && parts.length < 6) {
                        parts.push(cleanLines[j]);
                        j++;
                    }
                    content = (parts.join(' ')).trim() || content;
                }
                return content.replace(/^[\:\-\s]+/, '').trim();
            }
            // respaldo por etiqueta textual
            for (const kw of labelKeywords) {
                if (new RegExp(`\\b${kw}\\b`, 'i').test(line)) {
                    const after = line.split(new RegExp(kw, 'i'))[1] || '';
                    let content = after.replace(/^[\:\-\s]+/, '').trim();
                    if (!content || content.length < 3) {
                        const parts = [];
                        let j = i + 1;
                        while (j < cleanLines.length && !reAnyNumStart.test(cleanLines[j]) && parts.length < 6) {
                            parts.push(cleanLines[j]);
                            j++;
                        }
                        content = (parts.join(' ')).trim() || content;
                    }
                    return content;
                }
            }
        }
        return null;
    }

    const razon = extractByNumber(4, ['RAZON SOCIAL', 'RAZÓN SOCIAL', 'RAZON SOCIAL DE LA EMPRESA']);
    const descripcion = extractByNumber(5, ['DESCRIPCION', 'DESCRIPCIÓN', 'DESCRIPCION \\(Nombre']);

    if (razon && razon.length > 0) salida.razonSocial = razon;
    if (descripcion && descripcion.length > 0) salida.descripcionResiduo = descripcion;

    // extraer folio y fecha desde full text (opcional)
    const fullText = tesseractResult.data.text || '';
    const fechaMatch = fullText.match(/(\b\d{2}[\/\-]\d{2}[\/\-]\d{2,4}\b)/) || fullText.match(/(\b\d{4}[\/\-]\d{2}[\/\-]\d{2}\b)/);
    if (fechaMatch) salida.fechaManifiesto = fechaMatch[1];
    const folioMatch = fullText.match(/\bFOLIO[:\s\-]*([A-Z0-9\-]{3,})\b/i) || fullText.match(/\bNo\.?\s*[:\s\-]*([A-Z0-9\-]{3,})\b/i);
    if (folioMatch) salida.folio = folioMatch[1];

    // limpieza final
    salida.razonSocial = salida.razonSocial.replace(/^[\d\.\-\)\:\s]+/, '').replace(/[:\-]$/,'').trim();
    salida.descripcionResiduo = salida.descripcionResiduo.replace(/^[\d\.\-\)\:\s]+/, '').replace(/[:\-]$/,'').trim();

    console.log('EXTRAIDO campo 4 (RAZON SOCIAL):', salida.razonSocial);
    console.log('EXTRAIDO campo 5 (DESCRIPCION):', salida.descripcionResiduo);
    return salida;
}

// ============================================
// VERIFICAR CONTRA LISTA MAESTRA (comparación tolerante)
// ============================================
function verificarContraListaMaestra(razonSocial, descripcionResiduo) {
    const resultado = { esAceptable: true, coincidencias: [], motivo: '', nivelRiesgo: 'bajo', accionesRecomendadas: [] };
    const genTargetNorm = normalizeForCompare(razonSocial);
    const resTargetNorm = normalizeForCompare(descripcionResiduo);

    function pushCoincidence(tipo, valorOriginal, estado, motivo) {
        resultado.coincidencias.push({ tipo, valor: valorOriginal, estado, motivo });
    }

    for (const item of LISTA_MAESTRA) {
        const genNorm = normalizeForCompare(item.generador || '');
        if (genNorm && (genTargetNorm.includes(genNorm) || genNorm.includes(genTargetNorm) || genNorm === genTargetNorm)) {
            pushCoincidence('generador', item.generador, item.estado, item.motivo);
            if (item.estado && item.estado.includes('rechaz')) {
                resultado.esAceptable = false;
                resultado.motivo = `❌ RECHAZADO: Generador identificado en lista maestra (${item.generador})`;
                resultado.nivelRiesgo = 'alto';
                resultado.accionesRecomendadas = ['No aceptar ingreso. Contactar con coordinador ambiental.'];
            } else if (item.estado && item.estado.includes('requiere')) {
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
                if ((resTargetNorm && (resTargetNorm.includes(resNorm) || resNorm.includes(resTargetNorm))) ||
                    (genTargetNorm && (genTargetNorm.includes(resNorm) || resNorm.includes(genTargetNorm)))) {
                    pushCoincidence('residuo_especifico', res, item.estado, item.motivo);
                    if (item.estado && item.estado.includes('rechaz')) {
                        resultado.esAceptable = false;
                        resultado.motivo = `❌ RECHAZADO: Residuo (${res}) no autorizado.`;
                        resultado.nivelRiesgo = 'alto';
                        resultado.accionesRecomendadas = ['No aceptar ingreso. Revisar normativa.'];
                    } else if (item.estado && item.estado.includes('requiere')) {
                        resultado.esAceptable = false;
                        resultado.motivo = `⚠️ REQUIERE REVISIÓN: Residuo (${res}) requiere documentación adicional.`;
                        resultado.nivelRiesgo = 'medio';
                        resultado.accionesRecomendadas = ['Solicitar documentación adicional.'];
                    }
                }
            }
        }
    }

    // palabras peligrosas
    if (resultado.esAceptable) {
        for (const palabra of PALABRAS_PELIGROSAS) {
            if (!palabra) continue;
            const p = normalizeForCompare(palabra);
            if ((resTargetNorm && resTargetNorm.includes(p)) || (genTargetNorm && genTargetNorm.includes(p))) {
                pushCoincidence('palabra_clave_peligrosa', palabra, 'revision_requerida', 'Contiene término de material peligroso');
                resultado.esAceptable = false;
                resultado.motivo = `⚠️ REQUIERE REVISIÓN: Se detectó término peligroso: "${palabra}".`;
                resultado.nivelRiesgo = 'medio';
                resultado.accionesRecomendadas = ['Revisión manual por responsable ambiental.', 'Solicitar hoja de seguridad del material.'];
                break;
            }
        }
    }

    if (resultado.coincidencias.length === 0) {
        resultado.motivo = '✅ Documento aceptado: Generador y residuo no encontrados en listas reguladas.';
        resultado.accionesRecomendadas = ['Archivar según procedimiento estándar.'];
    }

    return resultado;
}

// ============================================
// FUNCIÓN PRINCIPAL: iniciarAnalisis
// ============================================
async function iniciarAnalisis() {
    console.log('Iniciando análisis...');
    if (!currentImage) { alert('Capture o suba una imagen del manifiesto.'); return; }

    // UI: mostrar processing...
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
        // 1) ejecutar OCR (devuelve objeto completo)
        const ocrResult = await ejecutarOCR(currentImage);
        if (progressBar) progressBar.style.width = '40%';
        if (progressText) progressText.textContent = 'Extrayendo campos numerados (4 y 5)...';

        // 2) extraer campos 4 y 5 usando lines
        const datos = extraerCamposNumerados(ocrResult);

        if (progressBar) progressBar.style.width = '60%';
        if (progressText) progressText.textContent = 'Verificando contra lista maestra...';

        // 3) verificar
        const verif = verificarContraListaMaestra(datos.razonSocial, datos.descripcionResiduo);
        if (progressBar) progressBar.style.width = '90%';

        // 4) combinar
        ultimoResultado = {
            ...datos,
            ...verif,
            textoOriginal: (ocrResult && ocrResult.data && ocrResult.data.text) ? ocrResult.data.text : '',
            fechaAnalisis: new Date().toISOString(),
            idAnalisis: 'ANL-' + Date.now().toString().slice(-8)
        };

        if (progressBar) progressBar.style.width = '100%';
        if (progressText) progressText.textContent = 'Generando resultados...';

        // 5) mostrar resultados
        setTimeout(() => {
            if (processingCard) processingCard.style.display = 'none';
            if (resultsCard) resultsCard.style.display = 'block';
            mostrarResultadosEnInterfaz(ultimoResultado);
            console.log('Análisis completado');
        }, 300);

    } catch (err) {
        console.error('Error en análisis:', err);
        mostrarError('Error al procesar el manifiesto: ' + (err && err.message ? err.message : err));
        if (processingCard) processingCard.style.display = 'none';
        if (firstCard) firstCard.style.display = 'block';
    }
}

// ============================================
// INTERFAZ: mostrarResultadosEnInterfaz (mantener consistencia con UI)
// ============================================
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
            let icono = coinc.tipo === 'generador' ? '<i class="bi bi-building"></i>' : (coinc.tipo === 'residuo_especifico' ? '<i class="bi bi-droplet"></i>' : '<i class="bi bi-exclamation-triangle"></i>');
            let clase = (coinc.estado || '').includes('rechaz') ? 'match-rejected' : ((coinc.estado || '').includes('requiere') ? 'match-requires' : 'match-warning');
            detallesHTML += `<li class="${clase}">${icono} <span class="match-value">${coinc.valor}</span> <span class="match-state">(${coinc.estado})</span></li>`;
        });
        detallesHTML += `</ul>`;
        if (resultado.accionesRecomendadas && resultado.accionesRecomendadas.length > 0) {
            detallesHTML += `<div class="recommended-actions"><p><strong>Acciones recomendadas:</strong></p><ol>`;
            resultado.accionesRecomendadas.forEach(a => detallesHTML += `<li>${a}</li>`);
            detallesHTML += `</ol></div>`;
        }
        detallesHTML += `</div>`;
    } else {
        detallesHTML += `<div class="no-matches"><i class="bi bi-check-circle-fill" style="color:#38a169;font-size:2rem"></i><p>No se encontraron coincidencias en listas reguladas.</p></div>`;
    }
    if (verificationContent) verificationContent.innerHTML = detallesHTML;

    // incidencias
    const incidenceSection = document.getElementById('incidenceSection');
    if (!isAcceptable) {
        if (incidenceSection) incidenceSection.style.display = 'block';
        const incidenceNotes = document.getElementById('incidenceNotes');
        if (incidenceNotes) incidenceNotes.value = `MOTIVO DEL RECHAZO AUTOMÁTICO:\n${resultado.motivo}\n\nDATOS DEL MANIFIESTO:\nGenerador: ${resultado.razonSocial}\nResiduo: ${resultado.descripcionResiduo}\n\nOBSERVACIONES:\n`;
    } else {
        if (incidenceSection) incidenceSection.style.display = 'none';
    }

    setTimeout(() => {
        const resultsCard = document.querySelector('.results-card');
        if (resultsCard) resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
}

// ============================================
// INCIDENCIAS, REPORTES Y UTILIDADES (resumen / reutilizables)
// ============================================
function registrarIncidencia() {
    if (!ultimoResultado) { alert('No hay resultado para registrar.'); return; }
    const notasEl = document.getElementById('incidenceNotes');
    const assignedEl = document.getElementById('assignedTo');
    const notas = notasEl ? notasEl.value.trim() : '';
    const asignadoA = assignedEl ? assignedEl.value.trim() : 'No asignado';
    if (!notas) { alert('Ingrese observaciones.'); if (notasEl) notasEl.focus(); return; }
    const incidenciaId = 'INC-' + Date.now().toString().slice(-8);
    const incidencia = { id: incidenciaId, fecha: new Date().toLocaleString(), notas, asignadoA, resultadoAnalisis: ultimoResultado, estado: 'registrada', prioridad: (ultimoResultado.nivelRiesgo === 'alto') ? 'alta' : 'media' };
    historialIncidencias.push(incidencia);
    try { localStorage.setItem('historialIncidencias', JSON.stringify(historialIncidencias)); } catch (e) { console.warn('No se pudo guardar historial', e); }
    const form = document.querySelector('.incidence-form'); if (form) form.style.display = 'none';
    const confirmationDiv = document.getElementById('incidenceConfirmation'); const confirmationMessage = document.getElementById('confirmationMessage');
    if (confirmationMessage) confirmationMessage.innerHTML = `Incidencia registrada: <strong>${incidenciaId}</strong><br>Prioridad: <strong>${incidencia.prioridad.toUpperCase()}</strong>`;
    if (confirmationDiv) confirmationDiv.style.display = 'block';
}

function omitirIncidencia() {
    if (confirm('¿Está seguro de omitir el registro de incidencia?')) reiniciarEscaneo();
}

function descargarReporteIncidencia() {
    if (historialIncidencias.length === 0) { alert('No hay incidencias.'); return; }
    const ultima = historialIncidencias[historialIncidencias.length - 1];
    const contenido = generarReporteIncidencia(ultima);
    descargarArchivo(contenido, `incidencia_${ultima.id}.txt`, 'text/plain');
}

function generarReporteIncidencia(incidencia) {
    const r = incidencia.resultadoAnalisis || {};
    return `REPORTE INCIDENCIA\nID: ${incidencia.id}\nFecha: ${incidencia.fecha}\nGenerador: ${r.razonSocial || ''}\nResiduo: ${r.descripcionResiduo || ''}\nMotivo: ${r.motivo || ''}\nNotas:\n${incidencia.notas}\n`;
}

function descargarReporteCompleto() {
    if (!ultimoResultado) { alert('No hay resultado para descargar.'); return; }
    const contenido = generarReporteCompleto(ultimoResultado);
    descargarArchivo(contenido, `reporte_manifiesto_${ultimoResultado.idAnalisis}.txt`, 'text/plain');
}

function generarReporteCompleto(resultado) {
    return `REPORTE ANALISIS\nID: ${resultado.idAnalisis}\nGenerador: ${resultado.razonSocial}\nResiduo: ${resultado.descripcionResiduo}\nMotivo: ${resultado.motivo}\nTexto OCR:\n${resultado.textoOriginal}\n`;
}

function descargarArchivo(contenido, nombre, tipo) {
    const blob = new Blob([contenido], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

function reiniciarEscaneo() {
    currentImage = null; ultimoResultado = null;
    const imagePreview = document.getElementById('imagePreview');
    if (imagePreview) imagePreview.innerHTML = `<p><i class="bi bi-image" style="font-size:3rem;color:#ccc"></i></p><p>No hay imagen seleccionada</p>`;
    const processBtn = document.getElementById('processBtn'); if (processBtn) processBtn.disabled = true;
    const processingCard = document.querySelector('.processing-card'); if (processingCard) processingCard.style.display = 'none';
    const resultsCard = document.querySelector('.results-card'); if (resultsCard) resultsCard.style.display = 'none';
    const firstCard = document.querySelector('.card:first-of-type'); if (firstCard) firstCard.style.display = 'block';
    closeCamera();
}

// ============================================
// ERRORES UI
// ============================================
function mostrarError(mensaje) {
    const resultStatus = document.getElementById('resultStatus');
    if (resultStatus) {
        resultStatus.className = 'result-status not-acceptable';
        resultStatus.innerHTML = `<i class="bi bi-exclamation-triangle"></i><h2>Error</h2><p>${mensaje}</p>
            <button onclick="reiniciarEscaneo()" class="btn btn-primary">Intentar nuevamente</button>`;
        const resultsCard = document.querySelector('.results-card'); if (resultsCard) resultsCard.style.display = 'block';
    } else {
        alert(mensaje);
    }
}

function mostrarErrorSistema(mensaje) {
    alert(`ERROR DEL SISTEMA:\n\n${mensaje}`);
}

// ============================================
// EVENTOS e INICIALIZACIÓN
// ============================================
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
    // cargar historial de incidencias
    try {
        const saved = localStorage.getItem('historialIncidencias');
        if (saved) { historialIncidencias = JSON.parse(saved); console.log('Historial cargado', historialIncidencias.length); }
    } catch (e) { console.warn('No se pudo cargar historial', e); }
});

window.addEventListener('beforeunload', () => {
    try { if (tesseractWorker && typeof tesseractWorker.terminate === 'function') tesseractWorker.terminate(); } catch (e) {}
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
});

console.log('Script cargado: listo para validar manifiestos');
