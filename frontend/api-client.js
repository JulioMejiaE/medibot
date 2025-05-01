/**
 * Cliente API para conectarse al backend de MediBot
 */
class MediBotAPI {
    constructor(baseUrl = 'http://localhost:5000/api') {
        this.baseUrl = baseUrl;
    }

    /**
     * Sube un PDF al servidor
     * @param {File} file - Archivo PDF a subir
     * @returns {Promise} - Promesa con la respuesta del servidor
     */
    async uploadPDF(file) {
        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch(`${this.baseUrl}/upload`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Error subiendo PDF:', error);
            throw error;
        }
    }

    /**
     * Envía una consulta al servidor
     * @param {string} query - Consulta del usuario
     * @returns {Promise} - Promesa con la respuesta del servidor
     */
    async sendQuery(query) {
        try {
            const response = await fetch(`${this.baseUrl}/query`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ query })
            });

            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Error enviando consulta:', error);
            throw error;
        }
    }

    /**
     * Obtiene la lista de documentos disponibles
     * @returns {Promise} - Promesa con la lista de documentos
     */
    async getDocuments() {
        try {
            const response = await fetch(`${this.baseUrl}/documents`, {
                method: 'GET'
            });

            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Error obteniendo documentos:', error);
            throw error;
        }
    }

    /**
     * Elimina un documento del servidor
     * @param {string} docId - ID del documento a eliminar
     * @returns {Promise} - Promesa con la respuesta del servidor
     */
    async deleteDocument(docId) {
        try {
            const response = await fetch(`${this.baseUrl}/documents/${docId}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Error eliminando documento:', error);
            throw error;
        }
    }
}

// Exportamos la clase para ser utilizada en otros módulos
export default MediBotAPI;