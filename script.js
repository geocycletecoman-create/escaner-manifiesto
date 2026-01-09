// script.js - Versión Corregida y Funcional
console.log('✅ script.js cargado - Iniciando aplicación...');

let currentImage = null;
let cameraStream = null;

// ====================
// 1. ESPERAR A QUE TODO EL DOM ESTÉ LISTO
// ====================
document.addEventListener('DOMContentLoaded', function() {
    console.log('✅ DOM completamente cargado.');
    initializeApp();
});

// ====================
// 2. INICIALIZAR LA APP
// ====================
function initializeApp() {
    console.log('🔧 Inicializando aplicación...');
    bindEvents();
}

// ====================
// 3. VINCULAR TODOS LOS EVENTOS
// ====================
function bindEvents() {
    console.log('🔗 Vinculando eventos a los botones...');

    // 3.1 BOTÓN "USAR CÁMARA"
    const cameraBtn = document.getElementById('cameraBtn');
    if (cameraBtn) {
        cameraBtn.addEventListener('click', handleCameraClick);
        console.log('   ✅ Evento asignado a: "Usar Cámara"');
    } else {
        console.error('❌ ERROR: No se encontró el botón con id="cameraBtn". Revisa tu HTML.');
    }

    // 3.2 BOTÓN "SUBIR IMAGEN"
    const uploadBtn = document.getElementById('uploadBtn');
    const fileInput = document.getElementById('fileInput');
    
    if (uploadBtn && fileInput) {
        uploadBtn.addEventListener('click', function() {
            console.log('🖼️  Click en "Subir Imagen". Abriendo selector de archivos...');
            fileInput.click();
        });
        console.log('   ✅ Evento asignado a: "Subir Imagen"');
    } else {
        console.error('❌ ERROR: Faltan elementos para subir imagen (uploadBtn o fileInput).');
    }

    // 3.3 CUANDO SE SELECCIONA UN ARCHIVO
    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelect);
        console.log('   ✅ Evento asignado a: input de archivo (change)');
    }

    // 3.4 BOTONES DE LA VISTA DE CÁMARA
    const captureBtn = document.getElementById('captureBtn');
    const cancelCameraBtn = document.getElementById('cancelCameraBtn');

    if (captureBtn) captureBtn.addEventListener('click', captureFromCamera);
    if (cancelCameraBtn) cancelCameraBtn.addEventListener('click', closeCamera);

    // 3.5 BOTÓN "ANALIZAR DOCUMENTO"
    const processBtn = document.getElementById('processBtn');
    if (processBtn) {
        processBtn.addEventListener('click', processDocument);
        console.log('   ✅ Evento asignado a: "Analizar Documento"');
    }
}

// ====================
// 4. FUNCIÓN PARA MANEJAR EL CLICK DE "USAR CÁMARA"
// ====================
async function handleCameraClick() {
    console.log('📸 Botón "Usar Cámara" clickeado.');
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Tu navegador no soporta el acceso a la cámara o estás en un entorno inseguro (HTTP). Prueba con HTTPS o localhost.');
        console.error('❌ API de cámara no disponible.');
        return;
    }

    try {
        console.log('   Solicitando permiso para la cámara...');
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        });

        console.log('   ✅ Permiso de cámara concedido.');

        const cameraView = document.getElementById('cameraView');
        const cameraStreamElement = document.getElementById('cameraStream');
        const imagePreview = document.getElementById('imagePreview');

        if (cameraView && cameraStreamElement) {
            cameraStreamElement.srcObject = cameraStream;
            cameraView.style.display = 'block';
            if (imagePreview) imagePreview.style.display = 'none';
            console.log('   ✅ Vista de cámara activada.');
        }

    } catch (error) {
        console.error('❌ Error al acceder a la cámara:', error);
        
        let userMessage = 'No se pudo acceder a la cámara. ';
        if (error.name === 'NotAllowedError') {
            userMessage += 'Bloqueaste el permiso. Por favor, recarga la página y permite el acceso.';
        } else if (error.name === 'NotFoundError') {
            userMessage += 'No se encontró ninguna cámara conectada.';
        } else if (error.name === 'NotReadableError') {
            userMessage += 'La cámara está siendo usada por otra aplicación.';
        } else {
            userMessage += Error técnico: ${error.message};
        }
        alert(userMessage);
    }
}

// ====================
// 5. FUNCIÓN PARA MANEJAR LA SELECCIÓN DE ARCHIVOS
// ====================
function handleFileSelect(event) {
    console.log('📄 Selector de archivos abierto. Archivo seleccionado.');
    const file = event.target.files[0];

    if (!file) {
        console.log('   (El usuario canceló la selección)');
        return;
    }

    if (!file.type.startsWith('image/')) {
        alert('Por favor, selecciona un archivo de imagen (JPG, PNG, etc.).');
        return;
    }

    console.log(`   ✅ Imagen válida seleccionada: ${file.name} (${file.type})`);

    const imageUrl = URL.createObjectURL(file);
    displayImage(imageUrl);
    currentImage = file;

    const processBtn = document.getElementById('processBtn');
    if (processBtn) processBtn.disabled = false;
}

// ====================
// 6. FUNCIÓN PARA MOSTRAR LA IMAGEN EN PANTALLA
// ====================
function displayImage(imageUrl) {
    const imagePreview = document.getElementById('imagePreview');
    if (!imagePreview) return;

    imagePreview.innerHTML = `
        <img src="${imageUrl}" alt="Documento cargado" style="max-width:100%; border-radius:5px;">
        <button id="removeImageBtn" class="btn btn-danger" style="margin-top:15px;">
            <i class="bi bi-trash"></i> Eliminar Imagen
        </button>
    `;
    imagePreview.style.display = 'flex';

    const removeBtn = document.getElementById('removeImageBtn');
    if (removeBtn) {
        removeBtn.addEventListener('click', function() {
            imagePreview.innerHTML = '<p>No hay imagen seleccionada</p>';
            currentImage = null;
            document.getElementById('processBtn').disabled = true;
            console.log('🗑️  Imagen eliminada.');
        });
    }
}

// ====================
// 7. FUNCIÓN PARA CAPTURAR DESDE LA CÁMARA
// ====================
function captureFromCamera() {
    console.log('⏺️  Capturando foto desde la cámara...');
    const video = document.getElementById('cameraStream');
    if (!video || !cameraStream) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(function(blob) {
        const file = new File([blob], 'captura_camara.jpg', { type: 'image/jpeg' });
        displayImage(URL.createObjectURL(file));
        currentImage = file;
        closeCamera();
        document.getElementById('processBtn').disabled = false;
        console.log('   ✅ Foto capturada y guardada.');
    }, 'image/jpeg', 0.9);
}

// ====================
// 8. FUNCIÓN PARA CERRAR LA CÁMARA
// ====================
function closeCamera() {
    console.log('📵 Cerrando cámara...');
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    const cameraView = document.getElementById('cameraView');
    if (cameraView) cameraView.style.display = 'none';
    
    const imagePreview = document.getElementById('imagePreview');
    if (imagePreview) imagePreview.style.display = 'flex';
}

// ====================
// 9. FUNCIÓN PARA PROCESAR EL DOCUMENTO (OCR)
// ====================
async function processDocument() {
    console.log('🔍 Iniciando procesamiento OCR...');
    if (!currentImage) {
        alert('Por favor, selecciona o captura una imagen primero.');
        return;
    }
    
    const processBtn = document.getElementById('processBtn');
    const loading = document.getElementById('loading');
    
    if (processBtn) processBtn.disabled = true;
    if (loading) loading.style.display = 'block';
    
    try {
        alert('La función OCR está lista. En una implementación completa, aquí se analizaría la imagen con Tesseract.js.');
        // Para una implementación real, aquí iría el código de Tesseract.js
    } catch (error) {
        console.error('Error en OCR:', error);
        alert('Ocurrió un error al procesar el documento.');
    } finally {
        if (processBtn) processBtn.disabled = false;
        if (loading) loading.style.display = 'none';
    }
}

// ====================
// FIN DEL SCRIPT
// ====================
console.log('🎯 Script listo. Los eventos se vincularán cuando el DOM cargue.');
