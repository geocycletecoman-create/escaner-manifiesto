// ==================== LISTA MAESTRA ====================
const LISTA_MAESTRA = [
  { generador: "SYNTHON SA DE CV", residuos: ["MEDICAMENTO CADUCO Y OBSOLETO Y EMPAQUE PRIMARIO"], estado: "ingreso_aceptable", motivo: "Residuo permitido" },
  { generador: "SYNTHON MEXICO SA DE CV", residuos: ["MEDICAMENTO CADUCO Y OBSOLETO Y EMPAQUE PRIMARIO"], estado: "ingreso_aceptable", motivo: "Residuo permitido" },
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
function safeMostrarError(mensaje) {
  if (typeof mostrarError === 'function') {
    try { mostrarError(mensaje); } catch (e) { console.error('mostrarError fallo:', e); alert(mensaje); }
  } else {
    alert(mensaje);
  }
}
// ... (mantenidas tus utilidades: levenshtein, similarityNormalized, tokenizeWordsForMatch, tokenIntersectionScore, containsAsWord, matchResiduoHeuristic, normForMatching, matchCompanyToMaster) ...

// Copio aquí las utilidades necesarias (omitidas en este fragmento por brevedad)
// Asegúrate de que en tu archivo están incluidas tal como antes (levenshtein, similarityNormalized, tokenizeWordsForMatch, etc.)

// ==================== TESSERACT, OCR, CROP, GROUPING, EXTRACT ... ====================
// (Mantén todas las funciones que ya tenías: inicializarTesseract, ejecutarOCR, fileToImage, cropImageToBlob,
// ocrCrop, groupWordsIntoRows, looksLikeAddressOrManifest, extractFieldsByCrop, extractFieldsFromFullText, etc.)
// Para no duplicar aquí todo tu código te indico puntos concretos donde se integran las novedades:
//
// 1) modificar mostrarResultadosEnInterfaz para mostrar sección de incidencia cuando sea rechazado
// 2) añadir registrarIncidencia, generarReporteIncidencia, descargarIncidencia, y listeners en setupEventListeners
//
// A continuación el resto del script con esas funciones integradas.

// ---------- (reincorporar aquí todas tus funciones existentes extractFieldsByCrop, etc.) ----------
// Para mantener la respuesta compacta incluyo a continuación únicamente las partes nuevas y las modificaciones
// mínimas al flujo. Si prefieres, te devuelvo el archivo completo con todo el contenido tal como lo tenías más las nuevas funciones.

// ==================== FUNCIONES NUEVAS: gestión de incidencias ====================

function generarIdIncidencia() {
  return 'INC-' + Date.now().toString().slice(-8);
}

function generarReporteIncidencia(incidencia) {
  const r = incidencia.resultadoAnalisis || {};
  return [
    `REPORTE DE INCIDENCIA`,
    `ID: ${incidencia.id}`,
    `Fecha: ${incidencia.fecha}`,
    `Generador: ${r.razonSocial || ''}`,
    `Residuo: ${r.descripcionResiduo || ''}`,
    `Motivo análisis: ${r.motivo || ''}`,
    `Nivel de riesgo: ${r.nivelRiesgo || ''}`,
    `Notas de incidencia:`,
    incidencia.notas || '',
    '',
    `Texto OCR:`,
    (r.textoOriginal || '').slice(0, 5000)
  ].join('\n');
}

function descargarReporteIncidencia(incidencia) {
  const contenido = generarReporteIncidencia(incidencia);
  const blob = new Blob([contenido], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `incidencia_${incidencia.id}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function mostrarConfirmacionIncidencia(incidencia) {
  // Si el HTML tiene un contenedor de confirmación predefinido úsalo; si no, lo creamos debajo de incidenceSection
  const incidenceSection = document.getElementById('incidenceSection');
  if (!incidenceSection) {
    console.warn('No existe #incidenceSection en el DOM');
    return;
  }

  // Ocultar el formulario y mostrar confirmación
  incidenceSection.innerHTML = `
    <div id="incidenceConfirmation" style="padding:12px;border-radius:8px;background:#f7fafc">
      <div style="display:flex;gap:12px;align-items:center">
        <i class="bi bi-check-circle-fill" style="font-size:1.5rem;color:#38a169"></i>
        <div>
          <strong>Incidencia registrada: ${incidencia.id}</strong>
          <div style="margin-top:6px;color:#4a5568">Se ha creado la incidencia y puede descargar el reporte o iniciar un nuevo escaneo.</div>
        </div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button id="downloadIncidenceReport" class="btn" style="background:#38a169"><i class="bi bi-download"></i> Descargar Reporte</button>
        <button id="newScanAfterIncidence" class="btn btn-outline">Nuevo Escaneo</button>
      </div>
    </div>
  `;

  // Wire buttons
  const dlBtn = document.getElementById('downloadIncidenceReport');
  if (dlBtn) dlBtn.addEventListener('click', () => descargarReporteIncidencia(incidencia));
  const nsBtn = document.getElementById('newScanAfterIncidence');
  if (nsBtn) nsBtn.addEventListener('click', () => {
    reiniciarEscaneo();
    // además ocultar sección de incidencia si se muestra
    const incSec = document.getElementById('incidenceSection');
    if (incSec) incSec.style.display = 'none';
  });
}

// Registrar incidencia: lee campo de notas y asignado, valida, guarda y muestra confirmación
function registrarIncidencia() {
  if (!ultimoResultado) { alert('No hay resultado para registrar.'); return; }
  const notesEl = document.getElementById('incidenceNotes');
  const assignedEl = document.getElementById('assignedTo');
  const notes = notesEl ? notesEl.value.trim() : '';
  const assignedTo = assignedEl ? assignedEl.value.trim() : 'No asignado';

  if (!notes) { alert('Por favor ingrese las observaciones de la incidencia.'); if (notesEl) notesEl.focus(); return; }

  const incidenciaId = generarIdIncidencia();
  const incidencia = {
    id: incidenciaId,
    fecha: new Date().toLocaleString(),
    notas: notes,
    asignadoA: assignedTo,
    resultadoAnalisis: ultimoResultado,
    estado: 'registrada'
  };

  historialIncidencias.push(incidencia);
  try { localStorage.setItem('historialIncidencias', JSON.stringify(historialIncidencias)); } catch (e) { console.warn('No se pudo guardar historialIncidencias:', e); }

  // Mostrar confirmación y opciones
  mostrarConfirmacionIncidencia(incidencia);

  console.log('Incidencia registrada:', incidencia);
}

// Omitir incidencia: simplemente reiniciar escaneo o ocultar sección
function omitirIncidencia() {
  if (!confirm('¿Desea omitir registrar la incidencia y continuar?')) return;
  const incidenceSection = document.getElementById('incidenceSection');
  if (incidenceSection) incidenceSection.style.display = 'none';
  reiniciarEscaneo();
}

// ==================== MODIFICACIÓN: mostrarResultadosEnInterfaz ahora muestra sección de incidencia si es rechazado ====================
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

  // Mostrar la sección de incidencia solo si el manifiesto NO es aceptable (rechazado / requiere revisión)
  const incidenceSection = document.getElementById('incidenceSection');
  if (incidenceSection) {
    if (!resultado.esAceptable) {
      // resetear el contenido del formulario si existe la estructura original
      // (si tu index contiene campos incidenceNotes / assignedTo ya estarán visibles)
      // Asegúrate de que el HTML contiene los elementos con estos IDs.
      incidenceSection.style.display = 'block';

      // limpiar campos
      const notesEl = document.getElementById('incidenceNotes');
      if (notesEl) notesEl.value = '';
      const assignedEl = document.getElementById('assignedTo');
      if (assignedEl) assignedEl.value = '';

      // si quieres, desplazar la vista al bloque de incidencia
      incidenceSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      incidenceSection.style.display = 'none';
    }
  } else {
    // Si no existe el contenedor, log para que puedas ajustarlo en el HTML
    if (!resultado.esAceptable) console.warn('Incidence section missing in DOM: add an element with id="incidenceSection" to allow registering incidences.');
  }

  // Mostrar registros en consola
  console.log('Resultado mostrado en UI:', resultado);
}

// ==================== Setup event listeners (añado los listeners de incidencia) ====================
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
  if (uploadBtn) uploadBtn.addEventListener('click', () => fileInput && fileInput.click());
  if (fileInput) fileInput.addEventListener('change', handleFileSelect);
  if (captureBtn) captureBtn.addEventListener('click', captureFromCamera);
  if (cancelCameraBtn) cancelCameraBtn.addEventListener('click', closeCamera);
  if (processBtn) processBtn.addEventListener('click', iniciarAnalisis);
  if (newScanBtn) newScanBtn.addEventListener('click', reiniciarEscaneo);
  if (downloadReportBtn) downloadReportBtn.addEventListener('click', descargarReporteCompleto);

  // Incidencia: botones dentro de incidenceSection
  const registerIncidenceBtn = document.getElementById('registerIncidenceBtn');
  const skipIncidenceBtn = document.getElementById('skipIncidenceBtn');
  if (registerIncidenceBtn) registerIncidenceBtn.addEventListener('click', registrarIncidencia);
  if (skipIncidenceBtn) skipIncidenceBtn.addEventListener('click', omitirIncidencia);

  // botones dinámicos que pueden crearse tras registrar la incidencia (seialmente enlazados en mostrarConfirmacionIncidencia)
}

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  // inyectar historialIncidencias desde storage
  try { const saved = localStorage.getItem('historialIncidencias'); if (saved) historialIncidencias = JSON.parse(saved); } catch (e) { console.warn('No se pudo cargar historialIncidencias', e); }
  try { await inicializarTesseract(); } catch (e) { console.warn('Tesseract init error', e); }
});

window.addEventListener('beforeunload', () => {
  try { if (tesseractWorker && typeof tesseractWorker.terminate === 'function') tesseractWorker.terminate(); } catch (e) {}
  if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
});

console.log('Script cargado: listo para validar manifiestos');
