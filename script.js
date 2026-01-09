// Variables globales
let currentImage = null;
let tesseractWorker = null;
let deferredPrompt = null;

// Elementos del DOM
const elements = {
    cameraBtn: document.getElementById('cameraBtn'),
    uploadBtn: document.getElementById('uploadBtn'),
    fileInput: document.getElementById('fileInput'),
    cameraView: document.getElementById('cameraView'),
    cameraStream: document.getElementById('cameraStream'),
    captureBtn: document.getElementById('captureBtn'),
    cancelCameraBtn: document.getElementById('cancelCameraBtn'),
    imagePreview: document.getElementById('imagePreview'),
    processBtn: document.getElementById('processBtn'),
    loading: document.getElementById('loading'),
    results: document.getElementById('results'),
    resultStatus: document.getElementById('resultStatus'),
    detectedText: document.getElementById('detectedText'),
    foundTerms: document.getElementById('foundTerms'),
    downloadBtn: document.getElementById('downloadBtn'),
    resetBtn: document.getElementById('resetBtn'),
    rejectedWords: document.getElementById('rejectedWords'),
    requiredWords: document.getElementById('requiredWords'),
    caseSensitive: document.getElementById('caseSensitive'),
    progressBar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText'),
    installBtn: document.getElementById('installBtn')
};

// Inicializar la aplicación
function initApp() {
    setupEventListeners();
    setupPWA();
    checkServiceWorker();
}

// Configurar event listeners
function setupEventListeners() {
    // Botón para abrir cámara
    elements.cameraBtn.addEventListener('click', openCamera);
    
    // Botón para subir archivo
    elements.uploadBtn.addEventListener('click', () => elements.fileInput.click());
    
    // Selección de archivo
    elements.fileInput.addEventListener('change', handleFileSelect);
    
    // Capturar foto desde cámara
    elements.captureBtn.addEventListener('click', captureFromCamera);
    
    // Cancelar cámara
    elements.cancelCameraBtn.addEventListener('click', closeCamera);
    
    // Procesar documento
    elements.processBtn.addEventListener('click', processDocument);
    
    // Descargar resultado
    elements.downloadBtn.addEventListener('click', downloadResult);
    
    // Reiniciar escaneo
    elements.resetBtn.addEventListener('click', resetScanner);
    
    // Instalar PWA
    if (elements.installBtn) {
        elements.installBtn.addEventListener('click', installPWA);
    }
}

// Configurar PWA
function setupPWA() {
    // Detectar si se puede instalar
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (elements.installBtn) {
            elements.installBtn.style.display = 'inline-block';
        }
    });
}

// Verificar Service Worker
async function checkServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('sw.js');
            console.log('Service Worker registrado');
        } catch (error) {
            console.log('Service Worker no registrado:', error);
        }
    }
}

// Instalar PWA
async function installPWA() {
    if (!deferredPrompt) return;
    
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
        console.log('Usuario aceptó la instalación');
        if (elements.installBtn) {
            elements.installBtn.style.display = 'none';
        }
    }
    
    deferredPrompt = null;
}

// Abrir cámara
async function openCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            } 
        });
        
        elements.cameraStream.srcObject = stream;
        elements.cameraView.style.display = 'block';
        elements.imagePreview.style.display = 'none';
        
    } catch (error) {
        alert('Error al acceder a la cámara: ' + error.message);
        console.error('Error cámara:', error);
    }
}

// Cerrar cámara
function closeCamera() {
    const stream = elements.cameraStream.srcObject;
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    elements.cameraView.style.display = 'none';
    elements.imagePreview.style.display = 'flex';
}

// Capturar desde cámara
function captureFromCamera() {
    const canvas = document.createElement('canvas');
    const video = elements.cameraStream;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    canvas.toBlob(blob => {
        const file = new File([blob], 'captura.jpg', { type: 'image/jpeg' });
        displayImage(URL.createObjectURL(file));
        currentImage = file;
        closeCamera();
    }, 'image/jpeg', 0.9);
}

// Manejar selección de archivo
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
        displayImage(URL.createObjectURL(file));
        currentImage = file;
        elements.fileInput.value = '';
    }
}

// Mostrar imagen
function displayImage(imageUrl) {
    elements.imagePreview.innerHTML = `
        <img src="${imageUrl}" alt="Documento escaneado">
        <button id="removeImage" class="btn btn-danger" style="margin-top: 15px;">
            <i class="bi bi-trash"></i> Eliminar
        </button>
    `;
    
    document.getElementById('removeImage').addEventListener('click', () => {
        elements.imagePreview.innerHTML = '<p>No hay imagen seleccionada</p>';
        currentImage = null;
        elements.processBtn.disabled = true;
    });
    
    elements.processBtn.disabled = false;
}

// Procesar documento con OCR
async function processDocument() {
    if (!currentImage) return;
    
    // Mostrar carga
    elements.loading.style.display = 'block';
    elements.results.style.display = 'none';
    elements.processBtn.disabled = true;
    
    // Obtener términos de búsqueda
    const rejectedTerms = getTermsArray(elements.rejectedWords.value);
    const requiredTerms = getTermsArray(elements.requiredWords.value);
    const caseSensitive = elements.caseSensitive.checked;
    
    try {
        // Inicializar Tesseract
        if (!tesseractWorker) {
            tesseractWorker = await Tesseract.createWorker();
            await tesseractWorker.loadLanguage('spa');
            await tesseractWorker.initialize('spa');
        }
        
        // Configurar progreso
        const progressCallback = (progress) => {
            const percentage = Math.round(progress.progress * 100);
            elements.progressBar.style.width = ${percentage}%;
            elements.progressText.textContent = Progreso: ${percentage}%;
        };
        
        // Procesar imagen
        const result = await tesseractWorker.recognize(currentImage, {
            logger: progressCallback
        });
        
        const extractedText = result.data.text;
        
        // Analizar texto
        const analysis = analyzeText(extractedText, rejectedTerms, requiredTerms, caseSensitive);
        
        // Mostrar resultados
        showResults(analysis, extractedText);
        
    } catch (error) {
        console.error('Error en OCR:', error);
        showError('Error al procesar el documento: ' + error.message);
    } finally {
        elements.loading.style.display = 'none';
        elements.processBtn.disabled = false;
    }
}

// Convertir texto a array de términos
function getTermsArray(text) {
    return text
        .split('\n')
        .map(term => term.trim())
        .filter(term => term.length > 0);
}

// Analizar texto
function analyzeText(text, rejectedTerms, requiredTerms, caseSensitive) {
    const textToSearch = caseSensitive ? text : text.toLowerCase();
    const foundRejected = [];
    const foundRequired = [];
    
    // Buscar términos rechazados
    rejectedTerms.forEach(term => {
        const searchTerm = caseSensitive ? term : term.toLowerCase();
        if (textToSearch.includes(searchTerm)) {
            foundRejected.push(term);
        }
    });
    
    // Buscar términos requeridos
    requiredTerms.forEach(term => {
        const searchTerm = caseSensitive ? term : term.toLowerCase();
        if (textToSearch.includes(searchTerm)) {
            foundRequired.push(term);
        }
    });
    
    // Determinar resultado
    let isAcceptable = true;
    let reason = '';
    
    if (foundRejected.length > 0) {
        isAcceptable = false;
        reason = Contiene ${foundRejected.length} término(s) no aceptable(s);
    } else if (requiredTerms.length > 0 && foundRequired.length === 0) {
        isAcceptable = false;
        reason = 'No contiene ningún término requerido';
    } else if (requiredTerms.length > 0 && foundRequired.length > 0) {
        isAcceptable = true;
        reason = Contiene ${foundRequired.length} término(s) requerido(s);
    } else {
        isAcceptable = true;
        reason = 'No contiene términos no aceptables';
    }
    
    return {
        isAcceptable,
        reason,
        foundRejected,
        foundRequired,
        text
    };
}

// Mostrar resultados
function showResults(analysis, extractedText) {
    // Configurar estado
    elements.resultStatus.className = result-status ${analysis.isAcceptable ? 'acceptable' : 'not-acceptable'};
    elements.resultStatus.innerHTML = `
        <i class="bi ${analysis.isAcceptable ? 'bi-check-circle' : 'bi-x-circle'}"></i>
        <h2>${analysis.isAcceptable ? '✅ DOCUMENTO ACEPTABLE' : '❌ DOCUMENTO NO ACEPTABLE'}</h2>
        <p>${analysis.reason}</p>
    `;
    
    // Mostrar texto extraído
    elements.detectedText.textContent = extractedText || '(No se detectó texto)';
    
    // Mostrar términos encontrados
    elements.foundTerms.innerHTML = '';
    
    if (analysis.foundRejected.length > 0) {
        analysis.foundRejected.forEach(term => {
            const badge = document.createElement('span');
            badge.className = 'term-badge rejected';
            badge.textContent = ❌ ${term};
            elements.foundTerms.appendChild(badge);
        });
    }
    
    if (analysis.foundRequired.length > 0) {
        analysis.foundRequired.forEach(term => {
            const badge = document.createElement('span');
            badge.className = 'term-badge required';
            badge.textContent = ✅ ${term};
            elements.foundTerms.appendChild(badge);
        });
    }
    
    if (analysis.foundRejected.length === 0 && analysis.foundRequired.length === 0) {
        elements.foundTerms.innerHTML = '<p>No se encontraron términos de búsqueda</p>';
    }
    
    // Mostrar resultados
    elements.results.style.display = 'block';
    elements.results.scrollIntoView({ behavior: 'smooth' });
    
    // Guardar resultado para descarga
    window.lastResult = analysis;
}

// Mostrar error
function showError(message) {
    elements.resultStatus.className = 'result-status not-acceptable';
    elements.resultStatus.innerHTML = `
        <i class="bi bi-exclamation-triangle"></i>
        <h2>Error</h2>
        <p>${message}</p>
    `;
    elements.results.style.display = 'block';
}

// Descargar resultado
function downloadResult() {
    if (!window.lastResult) return;
    
    const analysis = window.lastResult;
    const content = `
RESULTADO DEL ANÁLISIS DE DOCUMENTO
====================================

FECHA: ${new Date().toLocaleString()}
ESTADO: ${analysis.isAcceptable ? 'ACEPTABLE' : 'NO ACEPTABLE'}
RAZÓN: ${analysis.reason}

TÉRMINOS NO ACEPTABLES ENCONTRADOS:
${analysis.foundRejected.map(term => `  - ${term}`).join('\n') || '  Ninguno'}

TÉRMINOS REQUERIDOS ENCONTRADOS:
${analysis.foundRequired.map(term => `  - ${term}`).join('\n') || '  Ninguno'}

TEXTO EXTRAÍDO DEL DOCUMENTO:
====================================
${analysis.text}
====================================
    `;
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = resultado_analisis_${Date.now()}.txt;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Reiniciar escáner
function resetScanner() {
    elements.imagePreview.innerHTML = '<p>No hay imagen seleccionada</p>';
    elements.results.style.display = 'none';
    currentImage = null;
    elements.processBtn.disabled = true;
    
    // Si hay cámara activa, cerrarla
    closeCamera();
}

// Limpiar recursos al cerrar
window.addEventListener('beforeunload', () => {
    if (tesseractWorker) {
        tesseractWorker.terminate();
    }
    closeCamera();
});

// Inicializar aplicación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', initApp);
