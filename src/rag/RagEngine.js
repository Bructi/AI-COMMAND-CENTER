const db = require('../db/database');
const { v4: uuidv4 } = require('uuid');
const { PDFParse } = require('pdf-parse');

class RagEngine {
    constructor() {
        this.stopWords = new Set([
            'a', 'an', 'the', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
            'from', 'about', 'into', 'over', 'after', 'and', 'or', 'not', 'it', 'this', 'that', 'what', 'how',
            'why', 'which', 'who', 'when', 'where', 'can', 'could', 'should', 'would', 'do', 'does', 'did', 'be'
        ]);
    }

    async extractTextFromBuffer(filename, buffer) {
        if (!buffer || buffer.length === 0) return '';
        const ext = filename.split('.').pop().toLowerCase();

        // 1. PDF Parsing via pdf-parse
        if (ext === 'pdf') {
            try {
                const parser = new PDFParse({ data: buffer });
                const result = await parser.getText();
                const text = (result && (result.text || (typeof result === 'string' ? result : ''))) || '';
                if (text.trim().length > 0) {
                    return text;
                }
            } catch (err) {
                console.error(`[RAG Engine] PDF parser warning for '${filename}':`, err.message);
            }
        }

        // 2. Plain Text / Code / Markdown / JSON / CSV / HTML / Configs
        try {
            return buffer.toString('utf-8');
        } catch {
            return buffer.toString('latin1');
        }
    }

    chunkText(text, chunkSize = 500, overlap = 80) {
        if (!text || text.trim().length === 0) return [];
        const cleanText = text.replace(/\r\n/g, '\n').trim();
        const chunks = [];

        // Paragraph-based splitting first
        const paragraphs = cleanText.split(/\n{2,}/);
        let currentChunk = '';

        for (const para of paragraphs) {
            const p = para.trim();
            if (!p) continue;

            if ((currentChunk + '\n\n' + p).length <= chunkSize) {
                currentChunk = currentChunk ? currentChunk + '\n\n' + p : p;
            } else {
                if (currentChunk) chunks.push(currentChunk);
                if (p.length > chunkSize) {
                    // Split long paragraph by sliding window
                    let start = 0;
                    while (start < p.length) {
                        const end = Math.min(start + chunkSize, p.length);
                        chunks.push(p.substring(start, end).trim());
                        start += (chunkSize - overlap);
                    }
                    currentChunk = '';
                } else {
                    currentChunk = p;
                }
            }
        }

        if (currentChunk) chunks.push(currentChunk);
        return chunks.filter(c => c && c.trim().length > 10);
    }

    async indexDocument(docId, filename, buffer) {
        const text = await this.extractTextFromBuffer(filename, buffer);
        if (!text || text.trim().length === 0) {
            return { success: false, chunkCount: 0, message: "No extractable text found in file." };
        }

        const chunks = this.chunkText(text);
        if (chunks.length === 0) {
            return { success: false, chunkCount: 0, message: "File text too short for chunking." };
        }

        // Remove any prior chunks for this doc
        await this.deleteDocumentChunks(docId);

        return new Promise((resolve, reject) => {
            db.serialize(() => {
                const stmt = db.prepare(`INSERT INTO document_chunks (id, doc_id, filename, chunk_index, content) VALUES (?, ?, ?, ?, ?)`);
                chunks.forEach((chunk, idx) => {
                    const chunkId = uuidv4();
                    stmt.run(chunkId, docId, filename, idx, chunk);
                });
                stmt.finalize((err) => {
                    if (err) return reject(err);
                    console.log(`[RAG Engine] Successfully indexed ${chunks.length} chunks for '${filename}' (${text.length} chars)`);
                    resolve({ success: true, chunkCount: chunks.length, totalCharacters: text.length });
                });
            });
        });
    }

    tokenize(text) {
        return (text || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s_-]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length > 0 && !this.stopWords.has(t));
    }

    async searchChunks(query, docId = null, topK = 4) {
        const queryClean = (query || '').trim();
        if (!queryClean) return [];

        const queryTokens = this.tokenize(queryClean);
        const queryLower = queryClean.toLowerCase();

        return new Promise((resolve, reject) => {
            let sql = `SELECT id, doc_id, filename, chunk_index, content FROM document_chunks`;
            const params = [];

            if (docId && docId !== 'ALL') {
                sql += ` WHERE doc_id = ?`;
                params.push(docId);
            }

            db.all(sql, params, (err, rows) => {
                if (err) return reject(err);
                if (!rows || rows.length === 0) return resolve([]);

                const scored = rows.map(chunk => {
                    const contentLower = (chunk.content || '').toLowerCase();
                    const filenameLower = (chunk.filename || '').toLowerCase();
                    const chunkTokens = this.tokenize(chunk.content);
                    const chunkTokenSet = new Set(chunkTokens);
                    const fnTokens = this.tokenize(chunk.filename);
                    const fnTokenSet = new Set(fnTokens);

                    let score = 0;
                    let matches = 0;

                    // 1. Exact phrase match in content
                    if (contentLower.includes(queryLower)) {
                        score += 40;
                        matches += queryTokens.length;
                    }

                    // 2. Token overlap in content
                    queryTokens.forEach(token => {
                        if (chunkTokenSet.has(token)) {
                            matches++;
                            const count = (contentLower.match(new RegExp('\\b' + token + '\\b', 'g')) || []).length;
                            score += 15 + Math.min(count * 4, 20);
                        } else if (contentLower.includes(token)) {
                            // Substring match in content
                            matches += 0.5;
                            score += 10;
                        }

                        // 3. Filename match bonus
                        if (fnTokenSet.has(token) || filenameLower.includes(token)) {
                            score += 25;
                            matches = Math.max(matches, 1);
                        }
                    });

                    // 4. Coverage ratio bonus
                    const matchRatio = queryTokens.length > 0 ? Math.min(1, matches / queryTokens.length) : 0;
                    score += Math.round(matchRatio * 30);

                    const confidence = Math.min(99, Math.max(25, Math.round(score)));

                    return {
                        id: chunk.id,
                        docId: chunk.doc_id,
                        filename: chunk.filename,
                        chunkIndex: chunk.chunk_index,
                        content: chunk.content,
                        score,
                        confidence
                    };
                });

                // Filter out non-matching chunks and sort descending
                const results = scored
                    .filter(c => c.score >= 10)
                    .sort((a, b) => b.score - a.score)
                    .slice(0, topK);

                resolve(results);
            });
        });
    }

    buildRagContext(chunks) {
        if (!chunks || chunks.length === 0) return '';
        let context = "### RETRIEVED KNOWLEDGE BASE EXCERPTS (RAG CONTEXT):\n\n";
        chunks.forEach((c, idx) => {
            context += `[Source ${idx + 1}: ${c.filename} | Relevance: ${c.confidence}%]\n`;
            context += `"""\n${c.content.trim()}\n"""\n\n`;
        });
        context += "--------------------------------------------------------\n";
        context += "INSTRUCTIONS: Answer the user query using the above retrieved document excerpts. Cite the source document name when providing factual details. If the excerpts do not contain the answer, answer based on your knowledge and clearly mention that it was not found in the uploaded documents.";
        return context;
    }

    async deleteDocumentChunks(docId) {
        return new Promise((resolve) => {
            db.run(`DELETE FROM document_chunks WHERE doc_id = ?`, [docId], (err) => {
                resolve(!err);
            });
        });
    }
}

module.exports = new RagEngine();
