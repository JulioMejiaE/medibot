from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3
import os
import uuid
import time
from werkzeug.utils import secure_filename
import PyPDF2
import re
import nltk
from nltk.tokenize import sent_tokenize
from nltk.corpus import stopwords

# Descargar recursos de NLTK necesarios
nltk.download('punkt')
nltk.download('stopwords')

app = Flask(__name__)
CORS(app)  # Habilitar CORS para todas las rutas

# Configuración
UPLOAD_FOLDER = 'uploads'
DB_PATH = 'medibot.db'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

# Inicializar la base de datos
def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Tabla para documentos
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS documents (
        id VARCHAR(36) PRIMARY KEY,
        filename TEXT NOT NULL,
        upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        file_path TEXT NOT NULL
    )
    ''')
    
    # Tabla para contenido extraído de los documentos
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS document_content (
        id INTEGER PRIMARY KEY AUTO_INCREMENT,
        doc_id VARCHAR(36) TEXT NOT NULL,
        page_num INTEGER NOT NULL,
        paragraph_num INTEGER NOT NULL,
        content TEXT NOT NULL,
        FOREIGN KEY (doc_id) REFERENCES documents(id)
    )
    ''')
    
    # Tabla para palabras clave extraídas (para búsqueda más eficiente)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS keywords (
        id INTEGER PRIMARY KEY AUTO_INCREMENT,
        word VARCHAR(250) NOT NULL,
        doc_content_id INTEGER NOT NULL,
        FOREIGN KEY (doc_content_id) REFERENCES document_content(id)
    )
    ''')
    
    conn.commit()
    conn.close()

# Llamar a init_db al iniciar la aplicación
init_db()

# Procesar PDF y extraer texto
def extract_text_from_pdf(file_path):
    try:
        text_by_page = []
        with open(file_path, 'rb') as file:
            pdf_reader = PyPDF2.PdfReader(file)
            for page_num in range(len(pdf_reader.pages)):
                page = pdf_reader.pages[page_num]
                text = page.extract_text()
                text_by_page.append(text)
        return text_by_page
    except Exception as e:
        print(f"Error extracting text from PDF: {e}")
        return []

# Dividir texto en párrafos significativos
def split_into_paragraphs(text):
    # Eliminar saltos de línea excesivos y espacios
    text = re.sub(r'\n+', '\n', text)
    text = re.sub(r' +', ' ', text)
    
    # Dividir por párrafos (saltos de línea)
    paragraphs = text.split('\n')
    
    # Filtrar párrafos vacíos o muy cortos
    return [p.strip() for p in paragraphs if len(p.strip()) > 20]

# Extraer palabras clave de un texto
def extract_keywords(text, language='spanish'):
    # Convertir a minúsculas y eliminar caracteres especiales
    text = text.lower()
    text = re.sub(r'[^\w\s]', '', text)
    
    # Obtener stopwords del idioma especificado
    stop_words = set(stopwords.words(language))
    
    # Dividir en palabras y filtrar stopwords
    words = text.split()
    keywords = [word for word in words if word not in stop_words and len(word) > 3]
    
    return keywords

# Guardar documento y su contenido en la base de datos
def save_document_to_db(doc_id, filename, file_path):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Insertar información del documento
    cursor.execute(
        "INSERT INTO documents (id, filename, file_path) VALUES (?, ?, ?)",
        (doc_id, filename, file_path)
    )
    
    # Procesar el PDF
    pages = extract_text_from_pdf(file_path)
    
    # Para cada página, extraer párrafos y palabras clave
    for page_num, page_text in enumerate(pages):
        paragraphs = split_into_paragraphs(page_text)
        
        for para_num, paragraph in enumerate(paragraphs):
            # Guardar párrafo
            cursor.execute(
                "INSERT INTO document_content (doc_id, page_num, paragraph_num, content) VALUES (?, ?, ?, ?)",
                (doc_id, page_num, para_num, paragraph)
            )
            
            # Obtener ID del párrafo insertado
            doc_content_id = cursor.lastrowid
            
            # Extraer y guardar palabras clave
            keywords = extract_keywords(paragraph)
            for keyword in keywords:
                cursor.execute(
                    "INSERT INTO keywords (word, doc_content_id) VALUES (?, ?)",
                    (keyword, doc_content_id)
                )
    
    conn.commit()
    conn.close()
    
    return True

# Buscar respuesta en la base de datos
def search_query(query):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Extraer palabras clave de la consulta
    keywords = extract_keywords(query)
    
    if not keywords:
        return {"status": "error", "message": "No se pudieron extraer palabras clave de la consulta"}
    
    # Construir consulta SQL para encontrar párrafos relevantes
    # Usamos una subconsulta para contar coincidencias de palabras clave
    sql_query = """
    SELECT d.filename, dc.content, COUNT(DISTINCT k.word) as relevance
    FROM document_content dc
    JOIN documents d ON dc.doc_id = d.id
    JOIN keywords k ON dc.id = k.doc_content_id
    WHERE k.word IN ({})
    GROUP BY dc.id
    ORDER BY relevance DESC
    LIMIT 5
    """.format(','.join(['?'] * len(keywords)))
    
    cursor.execute(sql_query, keywords)
    results = cursor.fetchall()
    conn.close()
    
    if not results:
        return {
            "status": "no_results",
            "message": "No se encontraron resultados para esta consulta"
        }
    
    # Formatear respuesta
    response = {
        "status": "success",
        "results": [
            {
                "source": row[0],  # Nombre del archivo
                "content": row[1],  # Contenido del párrafo
                "relevance": row[2]  # Puntuación de relevancia
            }
            for row in results
        ]
    }
    
    return response

# Rutas de la API
@app.route('/api/query', methods=['POST'])
def process_query():
    data = request.json
    
    if not data or 'query' not in data:
        return jsonify({"status": "error", "message": "No query provided"}), 400
    
    query = data['query']
    
    # Buscar respuesta en la base de datos
    response = search_query(query)
    
    return jsonify(response)

@app.route('/api/documents', methods=['GET'])
def get_documents():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("SELECT id, filename, upload_date FROM documents ORDER BY upload_date DESC")
    documents = [{"id": row[0], "filename": row[1], "date": row[2]} for row in cursor.fetchall()]
    
    conn.close()
    
    return jsonify({
        "status": "success",
        "documents": documents
    })

@app.route('/api/documents/<doc_id>', methods=['DELETE'])
def delete_document(doc_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Obtener ruta del archivo
    cursor.execute("SELECT file_path FROM documents WHERE id = ?", (doc_id,))
    result = cursor.fetchone()
    
    if not result:
        conn.close()
        return jsonify({"status": "error", "message": "Documento no encontrado"}), 404
    
    file_path = result[0]
    
    # Eliminar entradas de la base de datos
    cursor.execute("DELETE FROM keywords WHERE doc_content_id IN (SELECT id FROM document_content WHERE doc_id = ?)", (doc_id,))
    cursor.execute("DELETE FROM document_content WHERE doc_id = ?", (doc_id,))
    cursor.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    
    conn.commit()
    conn.close()
    
    # Eliminar archivo físico
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
    except Exception as e:
        print(f"Error deleting file: {e}")
    
    return jsonify({
        "status": "success",
        "message": "Documento eliminado correctamente"
    })

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"status": "error", "message": "No file part"}), 400

    file = request.files['file']

    if file.filename == '':
        return jsonify({"status": "error", "message": "No selected file"}), 400

    if file and file.filename.endswith('.pdf'):
        # Generar ID único para el documento
        doc_id = str(uuid.uuid4())

        # Guardar archivo
        filename = secure_filename(file.filename)
        file_path = os.path.join(UPLOAD_FOLDER, f"{doc_id}_{filename}")
        file.save(file_path)

        # Procesar y guardar en la base de datos
        save_document_to_db(doc_id, filename, file_path)

        return jsonify({
            "status": "success",
            "message": "Archivo procesado correctamente",
            "doc_id": doc_id,
            "filename": filename
        })

    return jsonify({"status": "error", "message": "Tipo de archivo no permitido"}), 400

# Iniciar la aplicación
if __name__ == '__main__':
    app.run(debug=True)
