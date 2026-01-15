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
// FUNCIONES DE CAPTURA DE IMAGEN (CÁMERA/ARCHIVO)
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
        
        cameraStreamElement.srcObject = cameraStream;
        cameraView.style.display = 'block';
        imagePreview.style.display = 'none';
        
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
        document.getElementById('fileInput').click();
    }
}

function handleFileSelect(event) {
    console.log('📄 Archivo seleccionado');
    
    const file = event.target.files[0];
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
    
    document.getElementById('processBtn').disabled = false;
    
    console.log('✅ Imagen cargada correctamente');
}

function mostrarImagenPrevia(imageUrl) {
    const imagePreview = document.getElementById('imagePreview');
    imagePreview.innerHTML = `
        <img src="${imageUrl}" alt="Manifiesto cargado" style="max-width: 100%; max-height: 380px;">
        <button id="removeImage" class="btn btn-danger" style="margin-top: 20px;">
            <i class="bi bi-trash"></i> Eliminar Imagen
        </button>
    `;
    
    setTimeout(() => {
        document.getElementById('removeImage').addEventListener('click', function() {
            imagePreview.innerHTML = `
                <p><i class="bi bi-image" style="font-size: 3rem; color: #ccc;"></i></p>
                <p>No hay imagen seleccionada</p>
            `;
            currentImage = null;
            document.getElementById('processBtn').disabled = true;
        });
    }, 100);
}

function captureFromCamera() {
    console.log('📸 Capturando foto desde cámara...');
    
    const cameraStreamElement = document.getElementById('cameraStream');
    if (!cameraStreamElement) return;
    
    const canvas = document.createElement('canvas');
    const video = cameraStreamElement;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    canvas.toBlob(function(blob) {
        if (!blob) return;
        
        const file = new File([blob], 'captura_manifiesto.jpg', { type: 'image/jpeg' });
        mostrarImagenPrevia(URL.createObjectURL(file));
        currentImage = file;
        
        closeCamera();
        document.getElementById('processBtn').disabled = false;
        
        console.log('✅ Foto capturada correctamente');
    }, 'image/jpeg', 0.9);
}

function closeCamera() {
    console.log('🛑 Cerrando cámara...');
    
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    
    document.getElementById('cameraView').style.display = 'none';
    document.getElementById('imagePreview').style.display = 'flex';
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
    document.querySelector('.card:first-of-type').style.display = 'none';
    document.querySelector('.processing-card').style.display = 'block';
    document.querySelector('.results-card').style.display = 'none';
    
    // Actualizar texto de progreso
    document.getElementById('progressText').textContent = 'Extrayendo texto del manifiesto...';
    document.getElementById('progressBar').style.width = '25%';
    
    try {
       function extraerDatosManifiesto(texto) {
    const resultado = {
        razonSocial: 'Desconocido',
        descripcionResiduo: 'Desconocido',
        fechaManifiesto: 'Desconocido',
        folio: 'Desconocido'
    };

    if (!texto || typeof texto !== 'string') return resultado;

    // Normalizar y dividir en líneas
    const textoNorm = texto.replace(/\t/g, ' ');
    const lines = textoNorm.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    // Buscar folio (varios patrones)
    const folioRegexes = [
        /\bFOLIO[:\s\-]*([A-Z0-9\-]{3,})\b/i,
        /\bNo\.?\s*[:\s\-]*([A-Z0-9\-]{3,})\b/i,
        /\bFolio[:\s\-]*([^\s]+)/i
    ];
    for (const rx of folioRegexes) {
        const m = texto.match(rx);
        if (m) {
            resultado.folio = m[1].trim();
            break;
        }
    }

    // Buscar fecha (dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd)
    const fechaMatch = texto.match(/(\b\d{2}[\/\-]\d{2}[\/\-]\d{2,4}\b)/) ||
                       texto.match(/(\b\d{4}[\/\-]\d{2}[\/\-]\d{2}\b)/);
    if (fechaMatch) resultado.fechaManifiesto = fechaMatch[1];

    // Heurística para razón social: buscar línea en mayúsculas o con clave empresarial
    for (let i = 0; i < Math.min(lines.length, 12); i++) {
        const ln = lines[i];
        const uppercaseRatio = (ln.replace(/[^A-ZÁÉÍÓÚÑ]/g, '').length) / Math.max(1, ln.length);
        if (ln.length > 6 && (/[A-ZÁÉÍÓÚÑ]/.test(ln) && uppercaseRatio > 0.3)) {
            resultado.razonSocial = ln;
            break;
        }
    }

    // Buscar descripción de residuo por etiquetas comunes
    const residuoRx = /(RESIDUO(?:S)?[:\s\-]+(.+))/i;
    const descrRx = /(DESCRIPCI[oó]N(?: DEL)? RESIDUO[:\s\-]+(.+))/i;
    const tipoRx = /(TIPO DE RESIDUO[:\s\-]+(.+))/i;
    let m = texto.match(descrRx) || texto.match(residuoRx) || texto.match(tipoRx);
    if (m) {
        resultado.descripcionResiduo = (m[2] || m[1]).trim();
    } else {
        const candidate = lines.find(l => /residuo|residuos|basura|residuo peligroso|infectante|inflamable|reactivo|residuo industrial/i.test(l));
        if (candidate) resultado.descripcionResiduo = candidate;
    }

    return resultado;
}

function verificarContraListaMaestra(razonSocial, descripcionResiduo) {
    const resultado = {
        esAceptable: true,
        coincidencias: [],
        motivo: '',
        nivelRiesgo: 'bajo',
        accionesRecomendadas: []
    };

    const razonLower = (razonSocial || '').toLowerCase();
    const residuoLower = (descripcionResiduo || '').toLowerCase();

    // 1) Revisar generadores y residuos específicos en LISTA_MAESTRA
    for (const item of LISTA_MAESTRA) {
        const genLower = (item.generador || '').toLowerCase();

        if (genLower && (razonLower.includes(genLower) || genLower === razonLower)) {
            resultado.coincidencias.push({
                tipo: 'generador',
                valor: item.generador,
                estado: item.estado,
                motivo: item.motivo
            });

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

        // coincidencia por residuo específico
        if (Array.isArray(item.residuos)) {
            for (const res of item.residuos) {
                const resLower = (res || '').toLowerCase();
                if (resLower && (residuoLower.includes(resLower) || resLower === residuoLower)) {
                    resultado.coincidencias.push({
                        tipo: 'residuo_especifico',
                        valor: res,
                        estado: item.estado,
                        motivo: item.motivo
                    });

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

    // 2) Buscar palabras peligrosas si aún aceptable
    if (resultado.esAceptable) {
        for (const palabra of PALABRAS_PELIGROSAS) {
            if (!palabra) continue;
            const p = palabra.toLowerCase();
            if (residuoLower.includes(p) || razonLower.includes(p)) {
                resultado.coincidencias.push({
                    tipo: 'palabra_clave_peligrosa',
                    valor: palabra,
                    estado: 'revision_requerida',
                    motivo: 'Contiene término de material peligroso'
                });

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

    // 3) Si no hay coincidencias
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
    
    // 1. Mostrar datos extraídos
    document.getElementById('detectedCompany').textContent = resultado.razonSocial;
    document.getElementById('detectedWaste').textContent = resultado.descripcionResiduo;
    document.getElementById('detectedDate').textContent = resultado.fechaManifiesto;
    document.getElementById('detectedFolio').textContent = resultado.folio;
    
    // 2. Mostrar veredicto principal
    const resultStatus = document.getElementById('resultStatus');
    const isAcceptable = resultado.esAceptable;
    
    // CORREGIDO: Faltaban las backticks (`)
    resultStatus.className = `result-status ${isAcceptable ? 'acceptable' : 'not-acceptable'}`;
    resultStatus.innerHTML = `
        <i class="bi ${isAcceptable ? 'bi-check-circle' : 'bi-x-circle'}"></i>
        <h2>${isAcceptable ? '✅ MANIFIESTO ACEPTADO' : '❌ MANIFIESTO RECHAZADO'}</h2>
        <p><strong>${resultado.motivo}</strong></p>
        <p class="risk-level">Nivel de riesgo: <span class="risk-badge ${resultado.nivelRiesgo.replace('-', '_')}">${resultado.nivelRiesgo.toUpperCase().replace('-', ' ')}</span></p>
    `;
    
    // 3. Mostrar detalles de verificación
    const verificationContent = document.getElementById('verificationContent');
    let detallesHTML = '';
    
    if (resultado.coincidencias.length > 0) {
        detallesHTML += `<div class="matches-found">`;
        detallesHTML += `<p><strong>Coincidencias encontradas en listas reguladas:</strong></p>`;
        detallesHTML += `<ul class="matches-list">`;
        
        resultado.coincidencias.forEach(coinc => {
            let icono = '';
            let clase = '';
            
            if (coinc.tipo === 'generador') icono = '<i class="bi bi-building"></i>';
            else if (coinc.tipo === 'residuo_especifico') icono = '<i class="bi bi-droplet"></i>';
            else icono = '<i class="bi bi-exclamation-triangle"></i>';
            
            if (coinc.estado.includes('rechazado')) clase = 'match-rejected';
            else if (coinc.estado.includes('requiere')) clase = 'match-requires';
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
        
        if (resultado.accionesRecomendadas.length > 0) {
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
    
    verificationContent.innerHTML = detallesHTML;
    
    // 4. Mostrar/ocultar sección de incidencias si es RECHAZADO
    const incidenceSection = document.getElementById('incidenceSection');
    const incidenceForm = document.querySelector('.incidence-form');
    const incidenceConfirmation = document.getElementById('incidenceConfirmation');
    
    if (!isAcceptable) {
        incidenceSection.style.display = 'block';
        incidenceForm.style.display = 'block';
        incidenceConfirmation.style.display = 'none';
        
        // Pre-llenar el textarea con el motivo del rechazo
        document.getElementById('incidenceNotes').value = `MOTIVO DEL RECHAZO AUTOMÁTICO:\n${resultado.motivo}\n\nDATOS DEL MANIFIESTO:\nGenerador: ${resultado.razonSocial}\nResiduo: ${resultado.descripcionResiduo}\n\nOBSERVACIONES ADICIONALES:\n`;
        
        // Enfocar el campo de observaciones
        setTimeout(() => {
            document.getElementById('incidenceNotes').focus();
        }, 300);
        
    } else {
        incidenceSection.style.display = 'none';
    }
    
    // 5. Desplazar suavemente a los resultados
    setTimeout(() => {
        document.querySelector('.results-card').scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start' 
        });
    }, 100);
    
    console.log('✅ Resultados mostrados correctamente');
}

// ============================================
// FUNCIONES DE GESTIÓN DE INCIDENCIAS
// ============================================

function registrarIncidencia() {
    console.log('📝 Registrando incidencia...');
    
    if (!ultimoResultado) {
        alert('⚠️ No hay resultados de análisis para registrar incidencia.');
        return;
    }
    
    const notas = document.getElementById('incidenceNotes').value.trim();
    const asignadoA = document.getElementById('assignedTo').value.trim() || 'No asignado';
    
    if (!notas) {
        alert('⚠️ Por favor, ingrese observaciones para la incidencia.');
        document.getElementById('incidenceNotes').focus();
        return;
    }
    
    // Generar ID único para la incidencia
    const incidenciaId = 'INC-' + Date.now().toString().slice(-8);
    
    // Crear objeto de incidencia
    const incidencia = {
        id: incidenciaId,
        fecha: new Date().toLocaleString(),
        notas: notas,
        asignadoA: asignadoA,
        resultadoAnalisis: ultimoResultado,
        estado: 'registrada',
        prioridad: ultimoResultado.nivelRiesgo === 'alto' ? 'alta' : 'media'
    };
    
    // Guardar en historial
    historialIncidencias.push(incidencia);
    console.log('✅ Incidencia registrada:', incidencia);
    
    // Mostrar confirmación
    document.querySelector('.incidence-form').style.display = 'none';
    const confirmationDiv = document.getElementById('incidenceConfirmation');
    document.getElementById('confirmationMessage').innerHTML = 
        `La incidencia ha sido registrada con el ID <strong>${incidenciaId}</strong>.<br>
         Prioridad: <strong>${incidencia.prioridad.toUpperCase()}</strong><br>
         Asignada a: <strong>${asignadoA}</strong>`;
    confirmationDiv.style.display = 'block';
    
    // Guardar en localStorage (persistencia simple)
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
    const resultado = incidencia.resultadoAnalisis;
    
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
Generador:           ${resultado.razonSocial}
Residuo:             ${resultado.descripcionResiduo}
Fecha Manifiesto:    ${resultado.fechaManifiesto}
Folio:               ${resultado.folio}
ID del Análisis:     ${resultado.idAnalisis}

VEREDICTO DEL SISTEMA:
----------------------
${resultado.motivo}

Nivel de Riesgo:     ${resultado.nivelRiesgo.toUpperCase()}

COINCIDENCIAS ENCONTRADAS:
--------------------------
${resultado.coincidencias.map(c => `• ${c.tipo}: ${c.valor} (${c.estado})`).join('\n')}

ACCIONES RECOMENDADAS POR EL SISTEMA:
--------------------------------------
${resultado.accionesRecomendadas.map((a, i) => `${i+1}. ${a}`).join('\n')}

OBSERVACIONES REGISTRADAS:
--------------------------
${incidencia.notas}

TEXTO EXTRAÍDO DEL MANIFIESTO (PRIMERAS 500 CARACTERES):
--------------------------------------------------------
${resultado.textoOriginal.substring(0, 500)}...

================================================================
SISTEMA DE VALIDACIÓN DE MANIFIESTO DE RESIDUOS PELIGROSOS
Versión 2.0 | Análisis automatizado
================================================================
`;
}

// ============================================
// FUNCIONES AUXILIARES
// ============================================

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
${resultado.coincidencias.length > 0 ? 
    resultado.coincidencias.map(c => `• ${c.tipo}: ${c.valor} (${c.estado})`).join('\n') : 
    'No se encontraron coincidencias en listas reguladas.'}

ACCIONES RECOMENDADAS:
----------------------
${resultado.accionesRecomendadas.length > 0 ? 
    resultado.accionesRecomendadas.map((a, i) => `${i+1}. ${a}`).join('\n') : 
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
    
    // Resetear variables
    currentImage = null;
    ultimoResultado = null;
    
    // Resetear interfaz
    document.getElementById('imagePreview').innerHTML = `
        <p><i class="bi bi-image" style="font-size: 3rem; color: #ccc;"></i></p>
        <p>No hay imagen seleccionada</p>
    `;
    
    document.getElementById('processBtn').disabled = true;
    document.querySelector('.processing-card').style.display = 'none';
    document.querySelector('.results-card').style.display = 'none';
    document.querySelector('.card:first-of-type').style.display = 'block';
    
    // Resetear formulario de incidencia
    document.getElementById('incidenceNotes').value = '';
    document.getElementById('assignedTo').value = '';
    document.querySelector('.incidence-form').style.display = 'block';
    document.getElementById('incidenceConfirmation').style.display = 'none';
    document.getElementById('incidenceSection').style.display = 'none';
    
    // Cerrar cámara si está activa
    closeCamera();
    
    // Desplazar al inicio
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
        document.querySelector('.results-card').style.display = 'block';
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
    
    // Eventos de captura de imagen
    document.getElementById('cameraBtn').addEventListener('click', openCamera);
    document.getElementById('uploadBtn').addEventListener('click', () => {
        console.log('📤 Botón subir clickeado');
        document.getElementById('fileInput').click();
    });
    document.getElementById('fileInput').addEventListener('change', handleFileSelect);
    document.getElementById('captureBtn').addEventListener('click', captureFromCamera);
    document.getElementById('cancelCameraBtn').addEventListener('click', closeCamera);
    
    // Evento principal de análisis
    document.getElementById('processBtn').addEventListener('click', iniciarAnalisis);
    
    // Eventos de resultados
    document.getElementById('newScanBtn').addEventListener('click', reiniciarEscaneo);
    document.getElementById('downloadReportBtn').addEventListener('click', descargarReporteCompleto);
    
    // Eventos de incidencias
    document.getElementById('registerIncidenceBtn').addEventListener('click', registrarIncidencia);
    document.getElementById('skipIncidenceBtn').addEventListener('click', omitirIncidencia);
    document.getElementById('downloadIncidenceReport').addEventListener('click', descargarReporteIncidencia);
    document.getElementById('newScanAfterIncidence').addEventListener('click', reiniciarEscaneo);
}

// ============================================
// INICIALIZACIÓN DE TESSERACT
// ============================================

async function inicializarTesseract() {
    try {
        console.log('🔄 Inicializando Tesseract.js...');
        tesseractWorker = await Tesseract.createWorker();
        await tesseractWorker.loadLanguage('spa');
        await tesseractWorker.initialize('spa');
        console.log('✅ Tesseract.js inicializado correctamente para español');
    } catch (error) {
        console.error('❌ Error al inicializar Tesseract:', error);
        mostrarErrorSistema('No se pudo inicializar el sistema de OCR.');
    }
}

// ============================================
// INICIALIZACIÓN DE LA APLICACIÓN
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('✅ Sistema de Validación de Manifiestos - Inicializado');
    console.log('📋 Lista maestra cargada:', LISTA_MAESTRA.length, 'generadores configurados');
    
    // Verificar si Tesseract está disponible
    if (typeof Tesseract === 'undefined') {
        console.error('❌ Tesseract.js no se cargó correctamente');
        mostrarErrorSistema('La biblioteca de OCR no se cargó. Por favor, recarga la página.');
        return;
    }
    
    setupEventListeners();
    inicializarTesseract();
});

// ============================================
// MANEJO DE CIERRE Y LIMPIEZA
// ============================================

window.addEventListener('beforeunload', function() {
    console.log('🛑 Limpiando recursos antes de cerrar...');
    
    // Terminar worker de Tesseract si existe
    if (tesseractWorker) {
        tesseractWorker.terminate();
    }
    
    // Detener cámara si está activa
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
    }
});

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

console.log('🎯 Sistema listo para validar manifiestos');        
}      
}  
