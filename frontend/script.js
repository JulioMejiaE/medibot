// Configuración de PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

// Importar el cliente API
import MediBotAPI from './api-client.js';

// Variables globales
let loadedDocuments = [];
let isConnected = false;
const api = new MediBotAPI();

// Inicialización
document.addEventListener('DOMContentLoaded', function () {
  // Manejar la tecla Enter en el input
  document.getElementById('user-input').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
      sendMessage();
    }
  });

  // Manejar subida de archivos
  document.getElementById('pdf-file').addEventListener('change', handleFileUpload);

  // Intentar conectar con el backend
  connectToBackend();

  // Cargar lista de documentos del servidor
  loadDocumentsList();
});

// Conectar al backend
function connectToBackend() {
  const statusIndicator = document.getElementById('status-indicator');

  // Intentar verificar la conexión haciendo una petición a /documents
  api.getDocuments()
    .then(response => {
      if (response.status === 'success') {
        isConnected = true;
        statusIndicator.textContent = 'Conectado';
        statusIndicator.classList.add('connected');

        // Enviar mensaje de conexión exitosa
        addMessage('Conexión establecida con la base de datos. Listo para procesar documentos y responder consultas.', 'bot');
      }
    })
    .catch(error => {
      statusIndicator.textContent = 'Desconectado';
      statusIndicator.classList.remove('connected');
      addMessage('No se pudo conectar al servidor. Funcionando en modo local.', 'bot');
      console.error('Error de conexión:', error);
    });
}

// Cargar documentos desde el servidor
function loadDocumentsList() {
  if (!isConnected) return;

  api.getDocuments()
    .then(response => {
      if (response.status === 'success') {
        // Actualizar la lista global de documentos
        loadedDocuments = response.documents.map(doc => ({
          id: doc.id,
          name: doc.filename,
          date: doc.date
        }));

        // Actualizar la interfaz
        updateDocumentsList();
      }
    })
    .catch(error => {
      console.error('Error cargando documentos:', error);
    });
}

// Enviar mensaje
function sendMessage() {
  const input = document.getElementById('user-input');
  const message = input.value.trim();

  if (message === "") return;

  // Añadir mensaje del usuario al chat
  addMessage(message, 'user');
  input.value = "";

  // Verificar si hay documentos cargados
  if (loadedDocuments.length === 0) {
    addMessage('Por favor, sube al menos un documento PDF para poder responder tus consultas.', 'bot');
    return;
  }

  // Mostrar indicador de "pensando"
  const thinkingIndicator = document.createElement('div');
  thinkingIndicator.className = 'chat-message bot';
  thinkingIndicator.id = 'thinking-indicator';

  const thinkingContent = document.createElement('div');
  thinkingContent.className = 'thinking';
  thinkingContent.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';

  thinkingIndicator.appendChild(thinkingContent);
  document.getElementById('chat-box').appendChild(thinkingIndicator);

  // Intentar usar la API si está conectada
  if (isConnected) {
    api.sendQuery(message)
      .then(response => {
        // Remover indicador de "pensando"
        document.getElementById('thinking-indicator').remove();

        if (response.status === 'success') {
          // Formatear respuesta con los resultados del servidor
          const bestMatch = response.results[0];
          const respuesta = `Según la información en "${bestMatch.source}":\n\n${bestMatch.content}`;
          addMessage(respuesta, 'bot');
        } else if (response.status === 'no_results') {
          addMessage('No encontré información específica sobre tu consulta en los documentos cargados. ¿Podrías reformular tu pregunta?', 'bot');
        } else {
          addMessage('Lo siento, ocurrió un error al procesar tu consulta.', 'bot');
        }
      })
      .catch(error => {
        // Remover indicador de "pensando"
        if (document.getElementById('thinking-indicator')) {
          document.getElementById('thinking-indicator').remove();
        }

        console.error('Error procesando consulta:', error);
        addMessage('Error de comunicación con el servidor. Funcionando en modo local.', 'bot');

        // Usar la búsqueda local como fallback
        const respuesta = buscarRespuesta(message);
        addMessage(respuesta, 'bot');
      });
  } else {
    // Usar la función de búsqueda local
    setTimeout(() => {
      // Remover indicador de "pensando"
      document.getElementById('thinking-indicator').remove();

      const respuesta = buscarRespuesta(message);
      addMessage(respuesta, 'bot');
    }, 1000);
  }
}

// Manejar subida de archivos PDF
function handleFileUpload(event) {
  const files = event.target.files;
  const uploadStatus = document.getElementById('upload-status');

  if (files.length === 0) return;

  uploadStatus.textContent = `Procesando ${files.length} archivo(s)...`;

  // Si estamos conectados, intentar subir al servidor
  if (isConnected) {
    uploadToServer(files);
  } else {
    // Si no hay conexión, procesar localmente
    uploadLocally(files);
  }

  // Limpiar el input de archivos para permitir cargar el mismo archivo nuevamente
  event.target.value = '';
}

// Subir archivos al servidor
function uploadToServer(files) {
  const uploadStatus = document.getElementById('upload-status');
  let uploadedCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (file.type !== 'application/pdf') {
      addMessage(`⚠️ "${file.name}" no es un PDF. Se omitirá.`, 'bot');
      continue;
    }

    // Mostrar mensaje de carga
    addMessage(`📤 Subiendo "${file.name}" al servidor...`, 'bot', 'processing-message');

    api.uploadPDF(file)
      .then(response => {
        if (response.status === 'success') {
          addMessage(`✅ Documento "${file.name}" procesado y almacenado en el servidor.`, 'bot');
          uploadedCount++;
          uploadStatus.textContent = `${uploadedCount} de ${files.length} archivos subidos`;

          // Actualizar la lista de documentos
          loadDocumentsList();
        } else {
          addMessage(`❌ Error al procesar "${file.name}": ${response.message}`, 'bot');
        }
      })
      .catch(error => {
        console.error('Error al subir archivo:', error);
        addMessage(`❌ Error al subir "${file.name}". Intentando procesarlo localmente...`, 'bot');

        // Intentar procesar localmente como fallback
        processPDF(file)
          .then(content => {
            const docId = 'local_' + Date.now() + '_' + i;
            const docInfo = {
              id: docId,
              name: file.name,
              content: content
            };

            loadedDocuments.push(docInfo);
            updateDocumentsList();
            addMessage(`✅ Documento "${file.name}" procesado localmente.`, 'bot');
          })
          .catch(err => {
            addMessage(`❌ No se pudo procesar "${file.name}": ${err.message}`, 'bot');
          });
      });
  }
}

// Procesar archivos localmente
function uploadLocally(files) {
  const uploadStatus = document.getElementById('upload-status');
  let processedCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (file.type !== 'application/pdf') {
      addMessage(`⚠️ "${file.name}" no es un PDF. Se omitirá.`, 'bot');
      continue;
    }

    // Mostrar mensaje de procesamiento
    addMessage(`📄 Procesando documento: ${file.name}`, 'bot', 'processing-message');

    // Leer el contenido del PDF
    processPDF(file)
      .then(content => {
        // Añadir a la lista de documentos
        const docId = 'local_' + Date.now() + '_' + i;
        const docInfo = {
          id: docId,
          name: file.name,
          content: content
        };

        loadedDocuments.push(docInfo);

        // Actualizar la lista visual de documentos
        updateDocumentsList();
        processedCount++;

        // Confirmar procesamiento exitoso
        addMessage(`✅ Documento "${file.name}" procesado. Contiene ${content.length} caracteres de texto.`, 'bot');

        // Actualizar estado de la subida
        uploadStatus.textContent = `${processedCount} de ${files.length} documentos procesados`;
      })
      .catch(error => {
        console.error('Error al procesar el PDF:', error);
        addMessage(`❌ Error al procesar "${file.name}": ${error.message}`, 'bot');
      });
  }
}

// Procesar un archivo PDF y extraer su texto
async function processPDF(file) {
  return new Promise((resolve, reject) => {
    const fileReader = new FileReader();

    fileReader.onload = async function () {
      try {
        const typedArray = new Uint8Array(this.result);
        const pdf = await pdfjsLib.getDocument(typedArray).promise;
        let fullText = '';

        // Extraer texto de cada página
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => item.str).join(' ');
          fullText += pageText + '\n';
        }

        resolve(fullText);
      } catch (error) {
        reject(error);
      }
    };

    fileReader.onerror = reject;
    fileReader.readAsArrayBuffer(file);
  });
}

// Actualizar la lista visual de documentos
function updateDocumentsList() {
  const pdfsList = document.getElementById('pdfs-list');
  pdfsList.innerHTML = '';

  if (loadedDocuments.length === 0) {
    const emptyItem = document.createElement('li');
    emptyItem.className = 'empty-list';
    emptyItem.textContent = 'No hay documentos cargados';
    pdfsList.appendChild(emptyItem);
    return;
  }

  loadedDocuments.forEach(doc => {
    const listItem = document.createElement('li');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'pdf-name';
    nameSpan.textContent = doc.name;

    const removeBtn = document.createElement('span');
    removeBtn.className = 'pdf-remove';
    removeBtn.textContent = '×';
    removeBtn.onclick = function () {
      removeDocument(doc.id);
    };

    listItem.appendChild(nameSpan);
    listItem.appendChild(removeBtn);
    pdfsList.appendChild(listItem);
  });
}

// Eliminar un documento de la lista
function removeDocument(docId) {
  const index = loadedDocuments.findIndex(doc => doc.id === docId);

  if (index === -1) return;

  const docName = loadedDocuments[index].name;

  // Si el ID comienza con "local_", es un documento procesado localmente
  if (docId.startsWith('local_')) {
    loadedDocuments.splice(index, 1);
    updateDocumentsList();
    addMessage(`🗑️ Documento "${docName}" eliminado.`, 'bot');
  } else if (isConnected) {
    // Intentar eliminar del servidor
    api.deleteDocument(docId)
      .then(response => {
        if (response.status === 'success') {
          loadedDocuments.splice(index, 1);
          updateDocumentsList();
          addMessage(`🗑️ Documento "${docName}" eliminado del servidor.`, 'bot');
        } else {
          addMessage(`❌ Error al eliminar documento: ${response.message}`, 'bot');
        }
      })
      .catch(error => {
        console.error('Error eliminando documento:', error);
        addMessage('Error de comunicación con el servidor.', 'bot');
      });
  }
}

// Añadir mensaje al chat
function addMessage(message, sender, extraClass = '') {
  const chatBox = document.getElementById('chat-box');
  const messageContainer = document.createElement('div');
  messageContainer.classList.add('chat-message', sender);

  if (extraClass) {
    messageContainer.classList.add(extraClass);
  }

  const messageContent = document.createElement('div');
  messageContent.className = 'message-content';
  messageContent.textContent = message;

  messageContainer.appendChild(messageContent);
  chatBox.appendChild(messageContainer);

  // Desplazar hacia abajo para mostrar el mensaje más reciente
  chatBox.scrollTop = chatBox.scrollHeight;
}

// Búsqueda local (para cuando no hay conexión al servidor)
function buscarRespuesta(consulta) {
  if (loadedDocuments.length === 0) {
    return "No tengo información para responder. Por favor, carga algún documento PDF.";
  }

  // Convertir consulta a minúsculas para búsqueda no sensible a mayúsculas
  consulta = consulta.toLowerCase();

  // Palabras clave de la consulta (eliminar palabras comunes)
  const palabrasComunes = ['como', 'cuál', 'donde', 'cuando', 'porque', 'para', 'este', 'esta',
    'que', 'cual', 'quien', 'como', 'de', 'el', 'la', 'los', 'las',
    'un', 'una', 'unos', 'unas', 'y', 'o', 'pero', 'si', 'no', 'con',
    'por', 'su', 'sus', 'al', 'del', 'lo', 'le', 'es', 'son', 'fue',
    'ser', 'estar', 'entre', 'cuando', 'hay', 'haber', 'qué'];

  const keywords = consulta.split(/\s+/)
    .filter(word => word.length > 3 && !palabrasComunes.includes(word));

  if (keywords.length === 0) {
    return "Tu pregunta es demasiado general. Por favor, intenta ser más específico e incluir términos técnicos o más detalles.";
  }

  // Buscar párrafos relevantes
  let relevantParagraphs = [];

  loadedDocuments.forEach(doc => {
    // Si el documento tiene contenido (podría no tenerlo si fue cargado del servidor sin texto)
    if (doc.content) {
      // Dividir el contenido en párrafos
      const paragraphs = doc.content.split(/\n+/);

      paragraphs.forEach(paragraph => {
        // Ignorar párrafos muy cortos
        if (paragraph.trim().length < 20) return;

        // Calcular "relevancia" basada en cuántas palabras clave aparecen
        const paragraphLower = paragraph.toLowerCase();
        let matchCount = 0;

        keywords.forEach(keyword => {
          // Buscar la palabra completa o como parte de una palabra más grande
          const regex = new RegExp('\\b' + keyword + '|' + keyword + '\\b', 'i');
          if (paragraphLower.match(regex)) {
            matchCount++;
          }
        });

        if (matchCount > 0) {
          relevantParagraphs.push({
            text: paragraph.trim(),
            relevance: matchCount,
            docName: doc.name
          });
        }
      });
    }
  });

  // Ordenar por relevancia
  relevantParagraphs.sort((a, b) => b.relevance - a.relevance);

  // Si encontramos párrafos relevantes
  if (relevantParagraphs.length > 0) {
    // Tomar el párrafo más relevante
    const bestMatch = relevantParagraphs[0];

    // Formatear respuesta con citación del documento
    return `Según la información en "${bestMatch.docName}":\n\n${bestMatch.text}`;
  } else {
    // Si no encontramos nada relevante
    return "No encontré información específica sobre tu consulta en los documentos cargados. ¿Podrías reformular tu pregunta o cargar documentos adicionales?";
  }
}