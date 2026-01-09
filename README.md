# Clasificador de Documentos

Aplicación web gratuita para escanear documentos y detectar automáticamente si son aceptables basándose en términos específicos.

## Características

- 📸 Captura de documentos con cámara o subida de imágenes
- 🔍 OCR en español usando Tesseract.js
- ⚙️ Configuración personalizada de términos aceptables/no aceptables
- 💾 Todo el procesamiento se hace localmente en el navegador
- 📱 Diseño responsive (funciona en móviles y desktop)
- 🚀 Se puede instalar como PWA (Progressive Web App)

## Cómo Usar

1. *Capturar documento*: Usa la cámara o sube una imagen
2. *Configurar términos*:
   - Términos NO aceptables: Si el documento los contiene, será rechazado
   - Términos requeridos (opcional): Si especificas, el documento debe contener al menos uno
3. *Analizar*: Haz clic en "Analizar Documento"
4. *Revisar resultados*: Verifica si es aceptable y el texto extraído

## Instalación en GitHub Pages

### Método 1: Fork del repositorio (Recomendado)

1. Haz clic en "Fork" en GitHub
2. En tu repositorio forkeado, ve a Settings > Pages
3. En "Source", selecciona la rama main
4. Haz clic en Save
5. Tu app estará disponible en: https://tunombre.github.io/escaner-documentos

### Método 2: Subir archivos manualmente

1. Crea un nuevo repositorio en GitHub llamado escaner-documentos
2. Sube todos los archivos de este proyecto
3. Activa GitHub Pages en Settings > Pages
4. Selecciona la rama main como fuente

## Tecnologías Utilizadas

- HTML5, CSS3, JavaScript Vanilla
- Tesseract.js para OCR
- Bootstrap Icons
- Service Workers (PWA)

## Notas Importantes

- La aplicación funciona 100% en el navegador, sin servidores externos
- Los documentos NO se suben a internet, todo queda local
- Requiere conexión a internet solo para cargar Tesseract.js la primera vez
- Luego funciona offline parcialmente gracias al cache

## Licencia

MIT License - Libre para uso personal y comercial
