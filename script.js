const LISTA_MAESTRA = [
    {
        generador: "SYNTHON MEXICO SA DE CV",
        residuos: ["MEDICAMENTO CADUCO Y OBSOLETO Y EMPAQUE PRIMARIO"],
        estado: "requiere_permiso_especial",
        motivo: "Ingreso aceptable"
    },
    {
        generador: "RELLENO VILLA DE ALVAREZ",
        residuos: ["RSU", "Llantas Usadas"],
        estado: "requiere_permiso_especial",
        motivo: "Ingreso aceptable"
    },
    {
        generador: "LABORATORIOS PISA S.A. DE C.V. (TLAJOMULCO)",
        residuos: ["BASURA INDUSTRIAL CONTAMINADA"],
        estado: "requiere_permiso_especial",
        motivo: "Ingreso aceptable"
    },
    {
        generador: "NISSAN MEXICANA, S.A. DE C.V.",
        residuos: ["reactivos experimentales"],
        estado: "requiere_revision",
        motivo: "Requiere revisión de documentación adicional"
    },
    {
        generador: "NISSAN MEXICANA, S.A. DE C.V.",
        residuos: ["INFLAMABLES"],
        estado: "rechazado_automatico",
        motivo: "Residuos de inflamables peligrosos no autorizados"
    }
];

const PALABRAS_PELIGROSAS = [
    "material radiactivo", "infectante", "biológico peligroso", "corrosivo",
    "inflamable", "explosivo", "reactivo", "tóxico", "mutagénico",
    "cancerígeno", "ecotóxico"
];

// ============================================
// VARIABLES GLOBALES
// ============================================
let currentImage = null;
let tesseractWorker = null;
let cameraStream = null;
let ultimoResultado = null;
let historialIncidencias = [];

// ============================================
// UTIL: NORMALIZACIÓN PARA COMPARAR (quita acentos, puntuación, uppercase)
// ============================================
function normalizeForCompare(s) {
    if (!s) return '';
    // Normalizar Unicode y quitar diacríticos
    let r = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // Reemplazar caracteres no alfanuméricos por espacio
    r = r.replace(/[^A-Za-z0-9\s]/g, ' ');
    // Multiples espacios -> uno, trim y uppercase
    r = r.replace(/\s+/g, ' ').trim().toUpperCase();
    return r;
}

// ============================================
// FUNCIONES DE CAPTURA DE IMAGEN (CÁMARA/ARCHIVO)
// ============================================
async function openCamera() {
    console.log('📷 Intentando abrir cámara...');
    try {
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
        }

        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: false
        });

        console.log('✅ Cámara accedida exitosamente');

        const cameraView = document.getElementById('cameraView');
        const cameraStreamElement = document.getElementById('cameraStream');
        const imagePreview = document.getElementById('imagePreview');

        if (cameraStreamElement) cameraStreamElement.srcObject = cameraStream;
        if (cameraView) cameraView.style.display = 'block';
        if (imagePreview) imagePreview.style.display = 'none';

    } catch (error) {
        console.error('❌ Error al acceder a la cámara:', error);
        let mensajeError = 'No se pudo acceder a la cámara. ';
        if (error.name === 'NotAllowedError') {
            mensajeError += 'Permiso denegado. Por favor, permite el acceso a la cámara.';
        } else if (error.name === 'NotFoundError') {
            mensajeError += 'No se encontró cámara disponible.';
        } else {
            mensajeError += error.message;
        }
        alert(mensajeError);
        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.click();
    }
}

function handleFileSelect(event) {
    console.log('📄 Archivo seleccionado');
    const file = event.target.files ? event.target.files[0] : null;
    if (!file) {
        console.log('⚠️ No se seleccionó archivo');
        return;
    }
    if (!file.type.match('image.*')) {
        alert('❌ Por favor, selecciona una imagen (JPEG, PNG, etc.)');
        return;
    }
    const imageUrl = URL.createObjectURL(file);
    mostrarImagenPrevia(imageUrl);
    currentImage = file;
    const processBtn = document.getElementById('processBtn');
    if (processBtn) processBtn.disabled = false;
    console.log('✅ Imagen cargada correctamente');
}

function mostrarImagenPrevia(imageUrl) {
    const imagePreview = document.getElementById('imagePreview');
    if (!imagePreview) return;
    imagePreview.innerHTML = `
        <img src="${imageUrl}" alt="Manifiesto cargado" style="max-width: 100%; max-height: 380px;">
        <button id="removeImage" class="btn btn-danger" style="margin-top: 20px;">
            <i class="bi bi-trash"></i> Eliminar Imagen
        </button>
    `;
    setTimeout(() => {
        const btn = document.getElementById('removeImage');
        if (!btn) return;
        btn.addEventListener('click', function () {
            imagePreview.innerHTML = `
                <p><i class="bi bi-image" style="font-size: 3rem; color: #ccc;"></i></p>
                <p>No hay imagen seleccionada</p>
            `;
            currentImage = null;
            const processBtn = document.getElementById('processBtn');
            if (processBtn) processBtn.disabled = true;
        });
    }, 100);
}

function captureFromCamera() {
    console.log('📸 Capturando foto desde cámara...');
    const cameraStreamElement = document.getElementById('cameraStream');
    if (!cameraStreamElement) return;

    const canvas = document.createElement('canvas');
    const video = cameraStreamElement;

    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(function (blob) {
        if (!blob) return;
        const file = new File([blob], 'captura_manifiesto.jpg', { type: 'image/jpeg' });
        mostrarImagenPrevia(URL.createObjectURL(file));
        currentImage = file;
        closeCamera();
        const processBtn = document.getElementById('processBtn');
        if (processBtn) processBtn.disabled = false;
        console.log('✅ Foto capturada correctamente');
    }, 'image/jpeg', 0.9);
}

function closeCamera() {
    console.log('🛑 Cerrando cámara...');
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    const cameraView = document.getElementById('cameraView');
    const imagePreview = document.getElementById('imagePreview');
    if (cameraView) cameraView.style.display = 'none';
    if (imagePreview) imagePreview.style.display = 'flex';
}

// ============================================
// FUNCIÓN PRINCIPAL DE ANÁLISIS
// ============================================
async function iniciarAnalisis() {
    console.log('🚀 Iniciando análisis de manifiesto...');
    if (!currentImage) {
        alert('⚠️ Por favor, capture o suba una imagen del manifiesto primero.');
        return;
    }

    // Ocultar sección de captura, mostrar procesamiento
    const firstCard = document.querySelector('.card:first-of-type');
    if (firstCard) firstCard.style.display = 'none';
    const processingCard = document.querySelector('.processing-card');
    if (processingCard) processingCard.style.display = 'block';
    const resultsCard = document.querySelector('.results-card');
    if (resultsCard) resultsCard.style.display = 'none';

    // Actualizar texto de progreso
    const progressText = document.getElementById('progressText');
    const progressBar = document.getElementById('progressBar');
    if (progressText) progressText.textContent = 'Extrayendo texto del manifiesto...';
    if (progressBar) progressBar.style.width = '25%';

    try {
        // 1. EJECUTAR OCR (devuelve el objeto completo de Tesseract)
        const ocrResult = await ejecutarOCR(currentImage);
        if (progressBar) progressBar.style.width = '50%';
        if (progressText) progressText.textContent = 'Analizando datos extraídos...';

        // 2. EXTRAER DATOS CLAVE DEL MANIFIESTO (usa numeración 4 y 5)
        const datosExtraidos = extraerDatosManifiesto(ocrResult);
        if (progressBar) progressBar.style.width = '75%';
        if (progressText) progressText.textContent = 'Verificando contra lista maestra...';

        // 3. VERIFICAR CONTRA LISTA MAESTRA (usa comparación tolerante)
        const resultadoVerificacion = verificarContraListaMaestra(
            datosExtraidos.razonSocial,
            datosExtraidos.descripcionResiduo
        );
        if (progressBar) progressBar.style.width = '100%';
        if (progressText) progressText.textContent = 'Generando resultados...';

        // 4. COMBINAR RESULTADOS
        ultimoResultado = {
            ...datosExtraidos,
            ...resultadoVerificacion,
            textoOriginal: (ocrResult && ocrResult.data && ocrResult.data.text) ? ocrResult.data.text : (typeof ocrResult === 'string' ? ocrResult : ''),
            fechaAnalisis: new Date().toISOString(),
            idAnalisis: 'ANL-' + Date.now().toString().slice(-8)
        };

        // 5. MOSTRAR RESULTADOS
        setTimeout(() => {
            const processingCard = document.querySelector('.processing-card');
            if (processingCard) processingCard.style.display = 'none';
            const resultsCard = document.querySelector('.results-card');
            if (resultsCard) resultsCard.style.display = 'block';
            mostrarResultadosEnInterfaz(ultimoResultado);
            console.log('✅ Análisis completado exitosamente');
        }, 500);

    } catch (error) {
        console.error('❌ Error en el análisis:', error);
        mostrarError('Error al procesar el manifiesto: ' + (error && error.message ? error.message : error));
        // Restaurar vista
        const processingCard = document.querySelector('.processing-card');
        if (processingCard) processingCard.style.display = 'none';
        const firstCard = document.querySelector('.card:first-of-type');
        if (firstCard) firstCard.style.display = 'block';
    }
}

// ============================================
// FUNCIÓN OCR (devuelve objeto completo de Tesseract)
// ============================================
async function ejecutarOCR(imagen) {
    console.log('🔄 [OCR] Iniciando proceso...');
    if (!imagen) throw new Error('No hay imagen para procesar');

    const progressText = document.getElementById('progressText');
    const progressBar = document.getElementById('progressBar');

    if (progressText) progressText.textContent = 'Preparando OCR...';
    if (progressBar) progressBar.style.width = '10%';

    let workerLocal = null;
    const useGlobal = Boolean(tesseractWorker);

    try {
        if (useGlobal) {
            workerLocal = tesseractWorker;
        } else {
            if (typeof Tesseract === 'undefined') {
                throw new Error('Tesseract no está disponible en el entorno');
            }
            const { createWorker } = Tesseract;
            workerLocal = await createWorker({
                logger: m => {
                    console.log('📊 Progreso OCR (temp):', m);
                    if (m.status === 'recognizing text') {
                        if (progressText) progressText.textContent = `Procesando: ${Math.round(m.progress * 100)}%`;
                        if (progressBar) progressBar.style.width = `${10 + (m.progress * 60)}%`;
                    }
                }
            });
            await workerLocal.loadLanguage('spa');
            await workerLocal.initialize('spa');
            // Opcional: ajustar psm para formularios (puedes probar '6' o '4')
            try { await workerLocal.setParameters({ tessedit_pageseg_mode: '6' }); } catch (e) { /* no crítico */ }
        }

        if (progressBar) progressBar.style.width = '70%';
        if (progressText) progressText.textContent = 'Extrayendo texto...';

        // Ejecutar reconocimiento - devolvemos el result completo para análisis por líneas
        const result = await workerLocal.recognize(imagen);

        if (progressBar) progressBar.style.width = '100%';
        if (progressText) progressText.textContent = '¡Texto extraído!';

        // Si creamos worker local temporal, terminarlo (si no usamos el global)
        if (!useGlobal && workerLocal && typeof workerLocal.terminate === 'function') {
            await workerLocal.terminate();
        }

        console.log('✅ [OCR] Proceso completado exitosamente');
        return result; // objeto con result.data.text, result.data.lines, result.data.words, etc.

    } catch (error) {
        console.error('❌ [OCR] Error detallado:', error);
        let mensajeError = 'Error en OCR: ' + (error && error.message ? error.message : error);
        if (progressText) progressText.textContent = `Error: ${mensajeError}`;
        throw new Error(mensajeError);
    }
}

// ============================================
// EXTRAER DATOS (busca explícitamente campos 4 y 5)
// ============================================
function extraerDatosManifiesto(ocrResult) {
    // ocrResult puede ser el objeto devuelto por Tesseract o un string
    let fullText = '';
    let lines = [];

    if (ocrResult && typeof ocrResult === 'object' && ocrResult.data) {
        fullText = ocrResult.data.text || '';
        // data.lines puede ser array de objetos con .text
        if (Array.isArray(ocrResult.data.lines)) {
            lines = ocrResult.data.lines.map(l => (l.text || '').trim()).filter(Boolean);
        } else {
            lines = fullText.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
        }
    } else if (typeof ocrResult === 'string') {
        fullText = ocrResult;
        lines = fullText.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
    } else {
        return { razonSocial: 'Desconocido', descripcionResiduo: 'Desconocido', fechaManifiesto: 'Desconocido', folio: 'Desconocido' };
    }

    const resultado = {
        razonSocial: 'Desconocido',
        descripcionResiduo: 'Desconocido',
        fechaManifiesto: 'Desconocido',
        folio: 'Desconocido'
    };

    function findNumberedField(num, labelKeywords = []) {
        const reNum = new RegExp(`^\\s*${num}\\s*[\\.\\-\\)\\:]?\\s*(.*)`, 'i');
        const reAnyNumStart = /^\s*\d+\s*[\.\-\)\:]/;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const m = line.match(reNum);
            if (m) {
                let content = (m[1] || '').trim();
                const looksLikeLabelOnly = !content || labelKeywords.some(k => new RegExp(k, 'i').test(content)) || content.length < 3;
                if (looksLikeLabelOnly) {
                    const parts = [];
                    let j = i + 1;
                    while (j < lines.length && !reAnyNumStart.test(lines[j]) && parts.length < 4) {
                        parts.push(lines[j]);
                        j++;
                    }
                    content = (parts.join(' ')).trim() || content;
                }
                return content.replace(/^[\:\-\s]+/, '').trim();
            }
            // búsqueda por etiqueta textual en la misma línea
            for (const kw of labelKeywords) {
                if (new RegExp(kw, 'i').test(line)) {
                    const after = line.split(new RegExp(kw, 'i'))[1] || '';
                    let content = after.replace(/^[\:\-\s]+/, '').trim();
                    if (!content || content.length < 3) {
                        const parts = [];
                        let j = i + 1;
                        while (j < lines.length && !reAnyNumStart.test(lines[j]) && parts.length < 4) {
                            parts.push(lines[j]);
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

    const razon = findNumberedField(4, ['RAZON SOCIAL', 'RAZÓN SOCIAL', 'RAZON SOCIAL DE LA EMPRESA']);
    const descr = findNumberedField(5, ['DESCRIPCION', 'DESCRIPCIÓN', 'DESCRIPCION \\(Nombre del residuo', 'DESCRIPCION \\(Nombre']);

    if (razon && razon.length > 0) resultado.razonSocial = razon;
    if (descr && descr.length > 0) resultado.descripcionResiduo = descr;

    // Fallbacks por regex en texto completo
    if ((!razon || razon.length === 0) && /raz[oó]n social/i.test(fullText)) {
        const m = fullText.match(/raz[oó]n social(?: de la empresa generadora)?[:\-\s]*([^\n]{3,200})/i);
        if (m && m[1]) resultado.razonSocial = m[1].trim();
    }
    if ((!descr || descr.length === 0) && /descripci[oó]n/i.test(fullText)) {
        const m = fullText.match(/descripci[oó]n(?:.*?residuo)?[:\-\s]*([^\n]{3,500})/i);
        if (m && m[1]) resultado.descripcionResiduo = m[1].trim();
    }

    // folio y fecha
    const folioRegexes = [
        /\bFOLIO[:\s\-]*([A-Z0-9\-]{3,})\b/i,
        /\bNo\.?\s*[:\s\-]*([A-Z0-9\-]{3,})\b/i,
        /\bFolio[:\s\-]*([^\s]+)/i
    ];
    for (const rx of folioRegexes) {
        const m = fullText.match(rx);
        if (m) {
            resultado.folio = (m[1] || '').trim();
            break;
        }
    }
    const fechaMatch = fullText.match(/(\b\d{2}[\/\-]\d{2}[\/\-]\d{2,4}\b)/) || fullText.match(/(\b\d{4}[\/\-]\d{2}[\/\-]\d{2}\b)/);
    if (fechaMatch) resultado.fechaManifiesto = fechaMatch[1];

    // limpieza final
    resultado.razonSocial = resultado.razonSocial.replace(/^[\d\.\-\)\:\s]+/, '').replace(/[:\-]$/,'').trim();
    resultado.descripcionResiduo = resultado.descripcionResiduo.replace(/^[\d\.\-\)\:\s]+/, '').replace(/[:\-]$/,'').trim();

    console.log('DEBUG extraerDatosManifiesto -> razonSocial:', resultado.razonSocial);
    console.log('DEBUG extraerDatosManifiesto -> descripcionResiduo:', resultado.descripcionResiduo);

    return resultado;
}

// ============================================
// VERIFICAR CONTRA LISTA MAESTRA (comparación tolerante)
// ============================================
function verificarContraListaMaestra(razonSocial, descripcionResiduo) {
    const resultado = {
        esAceptable: true,
        coincidencias: [],
        motivo: '',
        nivelRiesgo: 'bajo',
        accionesRecomendadas: []
    };

    const genTargetNorm = normalizeForCompare(razonSocial);
    const resTargetNorm = normalizeForCompare(descripcionResiduo);

    // función auxiliar para marcar coincidencia
    function pushCoincidence(tipo, valorOriginal, estado, motivo) {
        resultado.coincidencias.push({
            tipo,
            valor: valorOriginal,
            estado,
            motivo
        });
    }

    // 1) buscar coincidencias por generador y residuos asociados
    for (const item of LISTA_MAESTRA) {
        const genNorm = normalizeForCompare(item.generador || '');
        // coincidencia por generador (tolerante)
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

        // coincidencia por residuo específico (tolerante)
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

    // 2) palabras peligrosas (si aún aceptable)
    if (resultado.esAceptable) {
        for (const palabra of PALABRAS_PELIGROSAS) {
            if (!palabra) continue;
            const p = normalizeForCompare(palabra);
            if ((resTargetNorm && resTargetNorm.includes(p)) || (genTargetNorm && genTargetNorm.includes(p))) {
                pushCoincidence('palabra_clave_peligrosa', palabra, 'revision_requerida', 'Contiene término de material peligroso');
                resultado.esAceptable = false;
                resultado.motivo = `⚠️ REQUIERE REVISIÓN: Se detectó término peligroso: "${palabra}".`;
                resultado.nivelRiesgo = 'medio';
                resultado.accionesRecomendadas = [
                    'Revisión manual por responsable ambiental.',
                    'Solicitar hoja de seguridad del material.',
                    'Validar clasificación del residuo.'
                ];
                break;
            }
        }
    }

    // 3) si no hay coincidencias
    if (resultado.coincidencias.length === 0) {
        resultado.motivo = '✅ Documento aceptado: Generador y residuo no encontrados en listas reguladas.';
        resultado.accionesRecomendadas = ['Archivar según procedimiento estándar.'];
    }

    return resultado;
}

// ============================================
// FUNCIONES DE INTERFAZ DE RESULTADOS
// ============================================
function mostrarResultadosEnInterfaz(resultado) {
    console.log('🖥️ Mostrando resultados en interfaz...');
    if (!resultado) return;

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value || '';
    };
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
        detallesHTML += `<div class="matches-found">`;
        detallesHTML += `<p><strong>Coincidencias encontradas en listas reguladas:</strong></p>`;
        detallesHTML += `<ul class="matches-list">`;

        resultado.coincidencias.forEach(coinc => {
            let icono = '';
            let clase = '';

            if (coinc.tipo === 'generador') icono = '<i class="bi bi-building"></i>';
            else if (coinc.tipo === 'residuo_especifico') icono = '<i class="bi bi-droplet"></i>';
            else icono = '<i class="bi bi-exclamation-triangle"></i>';

            if ((coinc.estado || '').includes('rechaz')) clase = 'match-rejected';
            else if ((coinc.estado || '').includes('requiere')) clase = 'match-requires';
            else clase = 'match-warning';

            detallesHTML += `
                <li class="${clase}">
                    ${icono}
                    <span class="match-type">${coinc.tipo.replace('_', ' ')}</span>
                    <span class="match-value">${coinc.valor}</span>
                    <span class="match-state">(${coinc.estado})</span>
                </li>
            `;
        });

        detallesHTML += `</ul>`;

        if (resultado.accionesRecomendadas && resultado.accionesRecomendadas.length > 0) {
            detallesHTML += `<div class="recommended-actions">`;
            detallesHTML += `<p><strong>Acciones recomendadas:</strong></p>`;
            detallesHTML += `<ol>`;
            resultado.accionesRecomendadas.forEach(accion => {
                detallesHTML += `<li>${accion}</li>`;
            });
            detallesHTML += `</ol>`;
            detallesHTML += `</div>`;
        }

        detallesHTML += `</div>`;
    } else {
        detallesHTML += `
            <div class="no-matches">
                <i class="bi bi-check-circle-fill" style="color: #38a169; font-size: 2rem;"></i>
                <p>No se encontraron coincidencias en listas reguladas.</p>
                <p class="subtext">El generador y residuo no están registrados como problemáticos.</p>
            </div>
        `;
    }

    if (verificationContent) verificationContent.innerHTML = detallesHTML;

    const incidenceSection = document.getElementById('incidenceSection');
    const incidenceForm = document.querySelector('.incidence-form');
    const incidenceConfirmation = document.getElementById('incidenceConfirmation');

    if (!isAcceptable) {
        if (incidenceSection) incidenceSection.style.display = 'block';
        if (incidenceForm) incidenceForm.style.display = 'block';
        if (incidenceConfirmation) incidenceConfirmation.style.display = 'none';

        const incidenceNotes = document.getElementById('incidenceNotes');
        if (incidenceNotes) {
            incidenceNotes.value = `MOTIVO DEL RECHAZO AUTOMÁTICO:\n${resultado.motivo}\n\nDATOS DEL MANIFIESTO:\nGenerador: ${resultado.razonSocial}\nResiduo: ${resultado.descripcionResiduo}\n\nOBSERVACIONES ADICIONALES:\n`;
            setTimeout(() => incidenceNotes.focus(), 300);
        }
    } else {
        if (incidenceSection) incidenceSection.style.display = 'none';
    }

    setTimeout(() => {
        const resultsCard = document.querySelector('.results-card');
        if (resultsCard) resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    console.log('✅ Resultados mostrados correctamente');
}

// ============================================
// GESTIÓN DE INCIDENCIAS, REPORTES Y AUXILIARES (sin cambios importantes)
// ============================================
function registrarIncidencia() {
    console.log('📝 Registrando incidencia...');
    if (!ultimoResultado) {
        alert('⚠️ No hay resultados de análisis para registrar incidencia.');
        return;
    }

    const notasEl = document.getElementById('incidenceNotes');
    const assignedEl = document.getElementById('assignedTo');
    const notas = notasEl ? notasEl.value.trim() : '';
    const asignadoA = assignedEl ? assignedEl.value.trim() : 'No asignado';

    if (!notas) {
        alert('⚠️ Por favor, ingrese observaciones para la incidencia.');
        if (notasEl) notasEl.focus();
        return;
    }

    const incidenciaId = 'INC-' + Date.now().toString().slice(-8);

    const incidencia = {
        id: incidenciaId,
        fecha: new Date().toLocaleString(),
        notas: notas,
        asignadoA: asignadoA || 'No asignado',
        resultadoAnalisis: ultimoResultado,
        estado: 'registrada',
        prioridad: (ultimoResultado && ultimoResultado.nivelRiesgo === 'alto') ? 'alta' : 'media'
    };

    historialIncidencias.push(incidencia);
    console.log('✅ Incidencia registrada:', incidencia);

    const form = document.querySelector('.incidence-form');
    if (form) form.style.display = 'none';
    const confirmationDiv = document.getElementById('incidenceConfirmation');
    const confirmationMessage = document.getElementById('confirmationMessage');
    if (confirmationMessage) {
        confirmationMessage.innerHTML =
            `La incidencia ha sido registrada con el ID <strong>${incidenciaId}</strong>.<br>
             Prioridad: <strong>${incidencia.prioridad.toUpperCase()}</strong><br>
             Asignada a: <strong>${incidencia.asignadoA}</strong>`;
    }
    if (confirmationDiv) confirmationDiv.style.display = 'block';

    try {
        localStorage.setItem('historialIncidencias', JSON.stringify(historialIncidencias));
    } catch (e) {
        console.warn('No se pudo guardar en localStorage:', e);
    }
}

function omitirIncidencia() {
    console.log('⏭️ Omitiendo registro de incidencia');
    const confirmacion = confirm('¿Está seguro de omitir el registro de incidencia? El rechazo no será registrado para seguimiento.');
    if (confirmacion) {
        alert('Incidencia omitida. Puede continuar con nuevo escaneo.');
        reiniciarEscaneo();
    }
}

function descargarReporteIncidencia() {
    if (historialIncidencias.length === 0) {
        alert('⚠️ No hay incidencias registradas para descargar.');
        return;
    }
    const ultimaIncidencia = historialIncidencias[historialIncidencias.length - 1];
    const contenido = generarReporteIncidencia(ultimaIncidencia);
    descargarArchivo(contenido, `incidencia_${ultimaIncidencia.id}.txt`, 'text/plain');
    console.log('📥 Reporte de incidencia descargado');
}

function generarReporteIncidencia(incidencia) {
    const resultado = incidencia.resultadoAnalisis || {};
    return `
================================================================
       REPORTE DE INCIDENCIA - MANIFIESTO RECHAZADO
================================================================

INFORMACIÓN DE LA INCIDENCIA:
-----------------------------
ID de Incidencia:    ${incidencia.id}
Fecha y Hora:        ${incidencia.fecha}
Estado:              ${incidencia.estado}
Prioridad:           ${incidencia.prioridad.toUpperCase()}
Asignado a:          ${incidencia.asignadoA}

DATOS DEL MANIFIESTO RECHAZADO:
-------------------------------
Generador:           ${resultado.razonSocial || ''}
Residuo:             ${resultado.descripcionResiduo || ''}
Fecha Manifiesto:    ${resultado.fechaManifiesto || ''}
Folio:               ${resultado.folio || ''}
ID del Análisis:     ${resultado.idAnalisis || ''}

VEREDICTO DEL SISTEMA:
----------------------
${resultado.motivo || ''}

Nivel de Riesgo:     ${(resultado.nivelRiesgo || '').toUpperCase()}

COINCIDENCIAS ENCONTRADAS:
--------------------------
${(resultado.coincidencias || []).map(c => `• ${c.tipo}: ${c.valor} (${c.estado})`).join('\n')}

ACCIONES RECOMENDADAS POR EL SISTEMA:
--------------------------------------
${(resultado.accionesRecomendadas || []).map((a, i) => `${i + 1}. ${a}`).join('\n')}

OBSERVACIONES REGISTRADAS:
--------------------------
${incidencia.notas || ''}

TEXTO EXTRAÍDO DEL MANIFIESTO (PRIMERAS 500 CARACTERES):
--------------------------------------------------------
${(resultado.textoOriginal || '').substring(0, 500)}...

================================================================
SISTEMA DE VALIDACIÓN DE MANIFIESTO DE RESIDUOS PELIGROSOS
Versión 2.0 | Análisis automatizado
================================================================
`;
}

function descargarReporteCompleto() {
    if (!ultimoResultado) {
        alert('⚠️ No hay resultados para descargar.');
        return;
    }
    const contenido = generarReporteCompleto(ultimoResultado);
    descargarArchivo(contenido, `reporte_manifiesto_${ultimoResultado.idAnalisis}.txt`, 'text/plain');
    console.log('📥 Reporte completo descargado');
}

function generarReporteCompleto(resultado) {
    return `
REPORTE COMPLETO DE ANÁLISIS DE MANIFIESTO
==========================================

INFORMACIÓN DEL ANÁLISIS:
-------------------------
Fecha de Análisis:   ${new Date(resultado.fechaAnalisis).toLocaleString()}
ID del Análisis:     ${resultado.idAnalisis}
Resultado:           ${resultado.esAceptable ? 'ACEPTADO' : 'RECHAZADO'}
Nivel de Riesgo:     ${resultado.nivelRiesgo.toUpperCase()}

DATOS EXTRAÍDOS DEL MANIFIESTO:
-------------------------------
Razón Social:        ${resultado.razonSocial}
Descripción Residuo: ${resultado.descripcionResiduo}
Fecha del Manifiesto: ${resultado.fechaManifiesto}
Folio/Número:        ${resultado.folio}

VEREDICTO DEL SISTEMA:
----------------------
${resultado.motivo}

COINCIDENCIAS ENCONTRADAS:
--------------------------
${resultado.coincidencias && resultado.coincidencias.length > 0 ?
        resultado.coincidencias.map(c => `• ${c.tipo}: ${c.valor} (${c.estado})`).join('\n') :
        'No se encontraron coincidencias en listas reguladas.'}

ACCIONES RECOMENDADAS:
----------------------
${resultado.accionesRecomendadas && resultado.accionesRecomendadas.length > 0 ?
        resultado.accionesRecomendadas.map((a, i) => `${i + 1}. ${a}`).join('\n') :
        'Ninguna acción requerida.'}

LISTA MAESTRA CONSULTADA:
-------------------------
Total de generadores configurados: ${LISTA_MAESTRA.length}
${LISTA_MAESTRA.map(g => `• ${g.generador} (${g.residuos.length} residuos)`).join('\n')}

TEXTO COMPLETO EXTRAÍDO (OCR):
------------------------------
${resultado.textoOriginal}

================================================================
SISTEMA DE VALIDACIÓN AUTOMÁTICA DE MANIFIESTO
Análisis realizado localmente | Sin envío a servidores externos
================================================================
`;
}

function descargarArchivo(contenido, nombre, tipo) {
    const blob = new Blob([contenido], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function reiniciarEscaneo() {
    console.log('🔄 Reiniciando escaneo...');
    currentImage = null;
    ultimoResultado = null;

    const imagePreview = document.getElementById('imagePreview');
    if (imagePreview) imagePreview.innerHTML = `
        <p><i class="bi bi-image" style="font-size: 3rem; color: #ccc;"></i></p>
        <p>No hay imagen seleccionada</p>
    `;

    const processBtn = document.getElementById('processBtn');
    if (processBtn) processBtn.disabled = true;

    const processingCard = document.querySelector('.processing-card');
    if (processingCard) processingCard.style.display = 'none';
    const resultsCard = document.querySelector('.results-card');
    if (resultsCard) resultsCard.style.display = 'none';
    const firstCard = document.querySelector('.card:first-of-type');
    if (firstCard) firstCard.style.display = 'block';

    const incidenceNotes = document.getElementById('incidenceNotes');
    const assignedTo = document.getElementById('assignedTo');
    if (incidenceNotes) incidenceNotes.value = '';
    if (assignedTo) assignedTo.value = '';
    const incidenceForm = document.querySelector('.incidence-form');
    if (incidenceForm) incidenceForm.style.display = 'block';
    const incidenceConfirmation = document.getElementById('incidenceConfirmation');
    if (incidenceConfirmation) incidenceConfirmation.style.display = 'none';
    const incidenceSection = document.getElementById('incidenceSection');
    if (incidenceSection) incidenceSection.style.display = 'none';

    closeCamera();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    console.log('✅ Escaneo reiniciado correctamente');
}

function mostrarError(mensaje) {
    const resultStatus = document.getElementById('resultStatus');
    if (resultStatus) {
        resultStatus.className = 'result-status not-acceptable';
        resultStatus.innerHTML = `
            <i class="bi bi-exclamation-triangle"></i>
            <h2>Error en el Análisis</h2>
            <p>${mensaje}</p>
            <button onclick="reiniciarEscaneo()" class="btn btn-primary" style="margin-top: 15px;">
                <i class="bi bi-arrow-repeat"></i> Intentar Nuevamente
            </button>
        `;
        const resultsCard = document.querySelector('.results-card');
        if (resultsCard) resultsCard.style.display = 'block';
    } else {
        alert(mensaje);
    }
}

function mostrarErrorSistema(mensaje) {
    alert(`❌ ERROR DEL SISTEMA:\n\n${mensaje}\n\nPor favor, recarga la página o contacta al soporte técnico.`);
}

// ============================================
// CONFIGURACIÓN DE EVENTOS
// ============================================
function setupEventListeners() {
    console.log('🔧 Configurando eventos...');
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
    if (uploadBtn) uploadBtn.addEventListener('click', () => { console.log('📤 Botón subir clickeado'); if (fileInput) fileInput.click(); });
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

// ============================================
// INICIALIZACIÓN DE TESSERACT
// ============================================
async function inicializarTesseract() {
    try {
        console.log('🔄 Inicializando Tesseract.js...');
        if (typeof Tesseract === 'undefined') {
            throw new Error('Tesseract.js no encontrado en el entorno.');
        }
        tesseractWorker = await Tesseract.createWorker({
            logger: m => { /* opcional: mostrar progreso */ }
        });
        await tesseractWorker.loadLanguage('spa');
        await tesseractWorker.initialize('spa');
        try { await tesseractWorker.setParameters({ tessedit_pageseg_mode: '6' }); } catch (e) { /* opcional */ }
        console.log('✅ Tesseract.js inicializado correctamente para español (worker global)');
    } catch (error) {
        console.error('❌ Error al inicializar Tesseract:', error);
        mostrarErrorSistema('No se pudo inicializar el sistema de OCR.');
    }
}

// ============================================
// INICIALIZACIÓN DE LA APLICACIÓN
// ============================================
document.addEventListener('DOMContentLoaded', function () {
    console.log('✅ Sistema de Validación de Manifiestos - Inicializado');
    console.log('📋 Lista maestra cargada:', LISTA_MAESTRA.length, 'generadores configurados');

    if (typeof Tesseract === 'undefined') {
        console.error('❌ Tesseract.js no se cargó correctamente');
        mostrarErrorSistema('La biblioteca de OCR no se cargó. Por favor, recarga la página.');
        return;
    }

    setupEventListeners();
    inicializarTesseract();

    // Cargar historial de incidencias desde localStorage al iniciar
    try {
        const historialGuardado = localStorage.getItem('historialIncidencias');
        if (historialGuardado) {
            historialIncidencias = JSON.parse(historialGuardado);
            console.log(`📚 Historial cargado: ${historialIncidencias.length} incidencias previas`);
        }
    } catch (e) {
        console.warn('No se pudo cargar historial de incidencias:', e);
    }
});

// ============================================
// MANEJO DE CIERRE Y LIMPIEZA
// ============================================
window.addEventListener('beforeunload', function () {
    console.log('🛑 Limpiando recursos antes de cerrar...');
    try {
        if (tesseractWorker && typeof tesseractWorker.terminate === 'function') {
            tesseractWorker.terminate();
        }
    } catch (e) { /* ignore */ }

    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
    }
});

console.log('🎯 Sistema listo para validar manifiestos');
