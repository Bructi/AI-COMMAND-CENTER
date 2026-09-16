require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('./db/database');
const GenericProvider = require('./providers/GenericProvider');
const Router = require('./routing/Router');
const BenchmarkLab = require('./benchmarks/BenchmarkLab');
const driveManager = require('./drive/DriveManager');
const ragEngine = require('./rag/RagEngine');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

const PORT = process.env.PORT || 3000;

// Initialize Providers dynamically
let providers = {};
const router = new Router(providers);
const benchmarkLab = new BenchmarkLab(router);

function loadProviders() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM providers WHERE enabled = 1`, [], (err, rows) => {
            if (err) {
                console.error("Failed to load providers:", err.message);
                return reject(err);
            }
            providers = {};
            for (const row of rows) {
                const key = row.api_key || process.env[`${row.id.toUpperCase()}_API_KEY`] || '';
                providers[row.id] = new GenericProvider(row.id, row.name, row.base_url, key);
            }
            console.log(`[System] Loaded ${Object.keys(providers).length} active providers.`);
            router.providers = providers;
            resolve(providers);
        });
    });
}

// -------------------------------------------------------------
// PROVIDER MANAGEMENT
// -------------------------------------------------------------

app.get('/api/providers', (req, res) => {
    const query = `
        SELECT 
            p.id, 
            p.name, 
            p.base_url, 
            p.enabled, 
            (p.api_key IS NOT NULL AND p.api_key != '') OR 
            (CASE WHEN p.id = 'openrouter' THEN (COALESCE('${process.env.OPENROUTER_API_KEY || ''}', '') != '')
                  WHEN p.id = 'cerebras' THEN (COALESCE('${process.env.CEREBRAS_API_KEY || ''}', '') != '')
                  WHEN p.id = 'groq' THEN (COALESCE('${process.env.GROQ_API_KEY || ''}', '') != '')
                  WHEN p.id = 'mistral' THEN (COALESCE('${process.env.MISTRAL_API_KEY || ''}', '') != '')
                  WHEN p.id = 'huggingface' THEN (COALESCE('${process.env.HUGGINGFACE_API_KEY || ''}', '') != '')
                  WHEN p.id = 'together' THEN (COALESCE('${process.env.TOGETHER_API_KEY || ''}', '') != '')
                  WHEN p.id = 'google' THEN (COALESCE('${process.env.GOOGLE_API_KEY || ''}', '') != '')
                  ELSE 0 END) AS has_key,
            COUNT(m.id) AS total_models,
            SUM(CASE WHEN m.status = '🟢 HEALTHY' THEN 1 ELSE 0 END) AS healthy_models,
            SUM(CASE WHEN m.status = '🔴 FAILED' THEN 1 ELSE 0 END) AS failed_models,
            ROUND(AVG(CASE WHEN m.latency IS NOT NULL THEN m.latency ELSE NULL END)) AS avg_latency
        FROM providers p
        LEFT JOIN models m ON p.id = m.provider_id
        GROUP BY p.id, p.name, p.base_url, p.enabled
    `;

    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/providers', (req, res) => {
    const { id, name, base_url, api_key } = req.body;
    if (!id || !name || !base_url) {
        return res.status(400).json({ error: "id, name, and base_url are required." });
    }

    db.run(
        `INSERT INTO providers (id, name, base_url, api_key, enabled) VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(id) DO UPDATE SET 
            name = excluded.name, 
            base_url = excluded.base_url, 
            api_key = CASE WHEN excluded.api_key IS NOT NULL AND excluded.api_key != '' THEN excluded.api_key ELSE providers.api_key END`,
        [id.toLowerCase().trim(), name.trim(), base_url.trim(), api_key ? api_key.trim() : null],
        async (err) => {
            if (err) return res.status(500).json({ error: err.message });
            await loadProviders();
            res.json({ success: true, message: `Provider '${name}' saved successfully.` });
        }
    );
});

app.post('/api/providers/:id/toggle', (req, res) => {
    const { enabled } = req.body;
    db.run(`UPDATE providers SET enabled = ? WHERE id = ?`, [enabled ? 1 : 0, req.params.id], async (err) => {
        if (err) return res.status(500).json({ error: err.message });
        await loadProviders();
        res.json({ success: true, enabled: !!enabled });
    });
});

app.post('/api/providers/:id/test', async (req, res) => {
    const providerId = req.params.id;
    db.get(`SELECT * FROM providers WHERE id = ?`, [providerId], async (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: `Provider ${providerId} not found` });

        const key = row.api_key || process.env[`${row.id.toUpperCase()}_API_KEY`] || '';
        const tempProvider = new GenericProvider(row.id, row.name, row.base_url, key);
        const result = await tempProvider.testConnection();
        res.json(result);
    });
});

app.post('/api/providers/:id/discover', async (req, res) => {
    const providerId = req.params.id;
    await loadProviders();
    const provider = providers[providerId];
    if (!provider) {
        return res.status(400).json({ error: `Provider '${providerId}' is disabled or has no active instance.` });
    }
    const result = await provider.discoverModels();
    res.json(result);
});

app.delete('/api/providers/:id', (req, res) => {
    const providerId = req.params.id;
    db.serialize(() => {
        db.run(`DELETE FROM models WHERE provider_id = ?`, [providerId]);
        db.run(`DELETE FROM providers WHERE id = ?`, [providerId], async (err) => {
            if (err) return res.status(500).json({ error: err.message });
            await loadProviders();
            res.json({ success: true, message: `Provider '${providerId}' deleted.` });
        });
    });
});

// -------------------------------------------------------------
// MODEL REGISTRY & HEALTH ENGINE
// -------------------------------------------------------------

app.get('/api/models', (req, res) => {
    db.all(`SELECT * FROM models ORDER BY score DESC, latency ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ count: rows.length, models: rows });
    });
});

app.post('/api/models/:id/test', async (req, res) => {
    const modelId = decodeURIComponent(req.params.id);
    db.get(`SELECT * FROM models WHERE id = ?`, [modelId], async (err, model) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!model) return res.status(404).json({ error: `Model '${modelId}' not found.` });

        const provider = providers[model.provider_id];
        if (!provider) {
            return res.status(400).json({ error: `Provider '${model.provider_id}' is disabled or not configured.` });
        }

        const result = await provider.healthCheck(modelId);
        res.json(result);
    });
});

app.post('/api/models/:id/roles', (req, res) => {
    const modelId = decodeURIComponent(req.params.id);
    const { roles, is_free, score } = req.body;
    db.run(
        `UPDATE models SET roles = COALESCE(?, roles), is_free = COALESCE(?, is_free), score = COALESCE(?, score) WHERE id = ?`,
        [roles, is_free !== undefined ? (is_free ? 1 : 0) : null, score, modelId],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: `Model '${modelId}' updated.` });
        }
    );
});

app.delete('/api/models/:id', (req, res) => {
    const modelId = decodeURIComponent(req.params.id);
    db.run(`DELETE FROM models WHERE id = ?`, [modelId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: `Model '${modelId}' removed.` });
    });
});

// Batch Model Discovery
app.post('/api/admin/discover', async (req, res) => {
    await loadProviders();
    const results = {};
    for (const [id, provider] of Object.entries(providers)) {
        if (provider.apiKey) {
            results[id] = await provider.discoverModels();
        } else {
            results[id] = { success: false, error: "Missing API Key" };
        }
    }
    res.json({ message: "Discovery complete", results });
});

// Batch Model Health Testing State
let activeHealthJob = {
    running: false,
    total: 0,
    tested: 0,
    healthy: 0,
    degraded: 0,
    failed: 0,
    currentModel: '',
    startedAt: null,
    completedAt: null
};

app.get('/api/admin/health/status', (req, res) => {
    res.json(activeHealthJob);
});

// Batch Model Health Testing
app.post('/api/admin/health', async (req, res) => {
    const { type = 'all', providerId, concurrency = 8 } = req.body;
    await loadProviders();

    let query = `SELECT m.id, m.provider_id FROM models m JOIN providers p ON m.provider_id = p.id WHERE p.enabled = 1`;
    const params = [];

    if (type === 'free') {
        query += ` AND m.is_free = 1`;
    }
    if (providerId) {
        query += ` AND m.provider_id = ?`;
        params.push(providerId);
    }

    db.all(query, params, async (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!rows || rows.length === 0) {
            return res.status(404).json({ message: "No models found from enabled providers to test." });
        }

        activeHealthJob = {
            running: true,
            total: rows.length,
            tested: 0,
            healthy: 0,
            degraded: 0,
            failed: 0,
            currentModel: 'Initializing worker pool...',
            startedAt: new Date().toISOString(),
            completedAt: null
        };

        res.json({ 
            success: true, 
            count: rows.length, 
            message: `Initiated health check for ${rows.length} models across active providers.` 
        });

        // High-throughput concurrent worker pool
        (async () => {
            let cursor = 0;
            const worker = async () => {
                while (cursor < rows.length) {
                    const idx = cursor++;
                    const row = rows[idx];
                    if (!row) break;

                    activeHealthJob.currentModel = row.id;
                    const provider = providers[row.provider_id];
                    if (provider) {
                        try {
                            const result = await provider.healthCheck(row.id);
                            activeHealthJob.tested++;
                            if (result.status && result.status.includes('HEALTHY')) activeHealthJob.healthy++;
                            else if (result.status && result.status.includes('DEGRADED')) activeHealthJob.degraded++;
                            else activeHealthJob.failed++;
                        } catch (e) {
                            activeHealthJob.tested++;
                            activeHealthJob.failed++;
                        }
                    } else {
                        activeHealthJob.tested++;
                        activeHealthJob.failed++;
                    }
                }
            };

            const pool = [];
            const numWorkers = Math.min(concurrency, rows.length);
            for (let i = 0; i < numWorkers; i++) {
                pool.push(worker());
            }
            await Promise.all(pool);
            activeHealthJob.running = false;
            activeHealthJob.completedAt = new Date().toISOString();
            console.log(`[Health Engine] Complete: Tested ${activeHealthJob.tested}/${activeHealthJob.total} models (${activeHealthJob.healthy} Healthy, ${activeHealthJob.degraded} Degraded, ${activeHealthJob.failed} Failed)`);
        })();
    });
});

// -------------------------------------------------------------
// ROUTING, ALIASES & SIMULATOR
// -------------------------------------------------------------

app.get('/api/aliases', (req, res) => {
    db.all(`SELECT * FROM aliases ORDER BY alias ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/aliases', (req, res) => {
    const { alias, target_model_id, role, routing_mode } = req.body;
    if (!alias) return res.status(400).json({ error: "alias name is required" });

    db.run(
        `INSERT INTO aliases (alias, target_model_id, role, routing_mode) 
         VALUES (?, ?, ?, ?)
         ON CONFLICT(alias) DO UPDATE SET 
            target_model_id = excluded.target_model_id,
            role = excluded.role,
            routing_mode = excluded.routing_mode`,
        [alias.trim(), target_model_id || null, role || null, routing_mode || 'BALANCED'],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: `Alias '${alias}' updated.` });
        }
    );
});

app.delete('/api/aliases/:alias', (req, res) => {
    db.run(`DELETE FROM aliases WHERE alias = ?`, [req.params.alias], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: `Alias '${req.params.alias}' removed.` });
    });
});

app.post('/api/routing/simulate', async (req, res) => {
    const { model = 'omni-fast' } = req.body;
    try {
        const simulation = await router.simulateRoute(model);
        res.json(simulation);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// -------------------------------------------------------------
// PLAYGROUND, ARENA & RAG CHAT
// -------------------------------------------------------------

app.post('/api/playground/chat', async (req, res) => {
    const { 
        model = 'omni-fast', 
        messages = [], 
        systemPrompt = '', 
        temperature = 0.7, 
        max_tokens = 1000,
        useRag = false,
        ragDocId = 'ALL'
    } = req.body;

    let ragSources = [];
    let combinedSystemPrompt = systemPrompt ? systemPrompt.trim() : '';

    // If RAG is enabled, extract the last user message and retrieve relevant chunks
    if (useRag && Array.isArray(messages) && messages.length > 0) {
        const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
        if (lastUserMsg) {
            try {
                ragSources = await ragEngine.searchChunks(lastUserMsg, ragDocId, 4);
                if (ragSources.length > 0) {
                    const ragContext = ragEngine.buildRagContext(ragSources);
                    combinedSystemPrompt = combinedSystemPrompt 
                        ? `${combinedSystemPrompt}\n\n${ragContext}` 
                        : ragContext;
                }
            } catch (e) {
                console.error("[RAG Error] Retrieval failed:", e.message);
            }
        }
    }

    const formattedMessages = [];
    if (combinedSystemPrompt) {
        formattedMessages.push({ role: 'system', content: combinedSystemPrompt });
    }
    if (Array.isArray(messages)) {
        formattedMessages.push(...messages);
    }

    const payload = {
        model,
        messages: formattedMessages,
        temperature: parseFloat(temperature),
        max_tokens: parseInt(max_tokens)
    };

    const startTime = Date.now();
    try {
        const completion = await router.routeRequest(payload, model);
        const duration = Date.now() - startTime;
        res.json({
            success: true,
            duration,
            routedModel: completion.model || model,
            content: completion.choices?.[0]?.message?.content || '',
            ragSources,
            raw: completion
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            error: e.message,
            duration: Date.now() - startTime,
            ragSources
        });
    }
});

// Prompt Optimizer / Enhancer Feature
app.post('/api/playground/optimize-prompt', async (req, res) => {
    const { prompt, style = 'general' } = req.body;
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: "Prompt is required" });

    const optimizerPrompt = `You are a prompt engineering expert. Rewrite and optimize the following prompt to be crystal clear, comprehensive, and structured for maximum AI performance. Retain original intent. Return ONLY the enhanced prompt, nothing else.\n\nOriginal Prompt:\n${prompt}`;

    try {
        const result = await router.routeRequest({
            model: 'omni-fast',
            messages: [{ role: 'user', content: optimizerPrompt }],
            temperature: 0.3,
            max_tokens: 500
        }, 'omni-fast');

        const optimized = result.choices?.[0]?.message?.content?.trim() || prompt;
        res.json({ success: true, optimized });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/playground/compare', async (req, res) => {
    const { modelA, modelB, prompt, systemPrompt, temperature = 0.7, max_tokens = 600 } = req.body;
    if (!modelA || !modelB || !prompt) {
        return res.status(400).json({ error: "modelA, modelB, and prompt are required." });
    }

    const runModel = async (targetModel) => {
        const startTime = Date.now();
        const messages = [];
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
        messages.push({ role: 'user', content: prompt });

        try {
            const completion = await router.routeRequest({
                model: targetModel,
                messages,
                temperature: parseFloat(temperature),
                max_tokens: parseInt(max_tokens)
            }, targetModel);
            return {
                success: true,
                model: targetModel,
                routedModel: completion.model || targetModel,
                duration: Date.now() - startTime,
                content: completion.choices?.[0]?.message?.content || ''
            };
        } catch (e) {
            return {
                success: false,
                model: targetModel,
                duration: Date.now() - startTime,
                error: e.message
            };
        }
    };

    const [resA, resB] = await Promise.all([runModel(modelA), runModel(modelB)]);
    res.json({ modelA: resA, modelB: resB });
});

// -------------------------------------------------------------
// BENCHMARK LAB
// -------------------------------------------------------------

app.post('/api/admin/benchmark', async (req, res) => {
    const { modelId } = req.body;
    if (!modelId) return res.status(400).json({ error: "modelId required" });

    try {
        const result = await benchmarkLab.runBenchmark(modelId);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/benchmarks/history', (req, res) => {
    db.all(`SELECT * FROM benchmarks ORDER BY created_at DESC LIMIT 50`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// -------------------------------------------------------------
// TEACH / PERSONAS
// -------------------------------------------------------------

app.get('/api/teach/personas', (req, res) => {
    db.all(`SELECT * FROM personas ORDER BY created_at DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/teach/personas', (req, res) => {
    const { name, prompt, description } = req.body;
    if (!name || !prompt) return res.status(400).json({ error: "name and prompt are required" });

    const id = uuidv4();
    db.run(
        `INSERT INTO personas (id, name, prompt, description) VALUES (?, ?, ?, ?)`,
        [id, name.trim(), prompt.trim(), description ? description.trim() : ''],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id, message: "Persona saved successfully" });
        }
    );
});

app.delete('/api/teach/personas/:id', (req, res) => {
    db.run(`DELETE FROM personas WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: "Persona deleted" });
    });
});

// -------------------------------------------------------------
// GOOGLE DRIVE & KNOWLEDGE (RAG)
// -------------------------------------------------------------

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.get('/api/drive/status', (req, res) => {
    res.json({ 
        isConnected: driveManager.isConnected, 
        hasCredentials: !!process.env.GOOGLE_CLIENT_ID 
    });
});

app.get('/api/drive/auth', (req, res) => {
    if (!process.env.GOOGLE_CLIENT_ID) {
        return res.status(400).send("Google Client ID not configured in .env");
    }
    res.redirect(driveManager.getAuthUrl());
});

app.get('/api/auth/google/callback', async (req, res) => {
    const code = req.query.code;
    if (code) {
        const success = await driveManager.authenticate(code);
        if (success) {
            return res.send(`
                <html>
                <body style="font-family:sans-serif; background:#0f172a; color:#f8fafc; display:flex; align-items:center; justify-content:center; height:100vh; margin:0;">
                <div style="background:#1e293b; padding:40px; border-radius:12px; text-align:center; border:1px solid #334155;">
                    <h2 style="color:#10b981; margin-top:0;">☁️ Google Drive Connected!</h2>
                    <p style="color:#94a3b8;">Authentication complete. You can close this tab and return to Command Center.</p>
                    <script>setTimeout(() => window.close(), 2500);</script>
                </div>
                </body></html>
            `);
        }
    }
    res.status(400).send("Authentication failed.");
});

app.post('/api/knowledge/upload', upload.single('document'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const filename = req.file.originalname;
    const buffer = req.file.buffer;
    const mimeType = req.file.mimetype;
    const size = req.file.size;
    const docId = uuidv4();

    try {
        let driveId = null;
        if (driveManager.isConnected) {
            const uploadRes = await driveManager.uploadBuffer(filename, buffer, mimeType);
            if (uploadRes.success) driveId = uploadRes.fileId;
        }

        db.run(
            `INSERT INTO documents (id, filename, drive_id, size) VALUES (?, ?, ?, ?)`,
            [docId, filename, driveId, size],
            async (err) => {
                if (err) return res.status(500).json({ error: err.message });
                
                // Automatically chunk & index into RAG vector/text store
                const indexResult = await ragEngine.indexDocument(docId, filename, buffer);

                res.json({ 
                    success: true, 
                    docId, 
                    driveId, 
                    chunksIndexed: indexResult.chunkCount,
                    message: `Document saved & indexed into ${indexResult.chunkCount} RAG chunks.` 
                });
            }
        );
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/knowledge/documents', (req, res) => {
    const query = `
        SELECT d.id, d.filename, d.drive_id, d.size, d.uploaded_at, COUNT(c.id) AS chunk_count 
        FROM documents d 
        LEFT JOIN document_chunks c ON d.id = c.doc_id 
        GROUP BY d.id, d.filename, d.drive_id, d.size, d.uploaded_at 
        ORDER BY d.uploaded_at DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.delete('/api/knowledge/documents/:id', async (req, res) => {
    const docId = req.params.id;
    await ragEngine.deleteDocumentChunks(docId);
    db.run(`DELETE FROM documents WHERE id = ?`, [docId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: "Document and indexed RAG chunks removed." });
    });
});

// Dedicated RAG Semantic / Keyword Search Endpoint
app.post('/api/knowledge/rag-search', async (req, res) => {
    const { query, docId = 'ALL', topK = 4 } = req.body;
    if (!query) return res.status(400).json({ error: "Query is required" });

    try {
        const matches = await ragEngine.searchChunks(query, docId, parseInt(topK));
        res.json({ query, matchCount: matches.length, matches });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// System State JSON Export & Backup
app.get('/api/admin/export', (req, res) => {
    const data = { exportedAt: new Date().toISOString() };
    db.serialize(() => {
        db.all(`SELECT id, name, base_url, enabled FROM providers`, [], (err, provs) => {
            data.providers = provs || [];
            db.all(`SELECT id, provider_id, status, latency, score, roles, is_free FROM models`, [], (err, mods) => {
                data.models = mods || [];
                db.all(`SELECT * FROM aliases`, [], (err, aliases) => {
                    data.aliases = aliases || [];
                    db.all(`SELECT id, name, prompt, description FROM personas`, [], (err, personas) => {
                        data.personas = personas || [];
                        db.all(`SELECT id, filename, size, uploaded_at FROM documents`, [], (err, docs) => {
                            data.documents = docs || [];
                            res.setHeader('Content-Disposition', 'attachment; filename="ai-command-center-backup.json"');
                            res.setHeader('Content-Type', 'application/json');
                            res.json(data);
                        });
                    });
                });
            });
        });
    });
});

// -------------------------------------------------------------
// PROVIDER DOCTOR & DIAGNOSTICS
// -------------------------------------------------------------

app.get('/api/admin/doctor', async (req, res) => {
    try {
        await loadProviders();
        
        // 1. Check all providers
        const providerReport = [];
        const activeProviders = Object.keys(providers);

        for (const [id, prov] of Object.entries(providers)) {
            const conn = await prov.testConnection();
            providerReport.push({
                id,
                name: prov.name,
                hasKey: !!prov.apiKey,
                reachable: conn.success,
                latency: conn.latency,
                modelsFound: conn.modelCount || 0,
                error: conn.error || null
            });
        }

        // 2. Query model stats
        db.all(`SELECT provider_id, status, is_free, latency, score FROM models`, [], (err, models) => {
            if (err) return res.status(500).json({ error: err.message });

            const totalModels = models.length;
            const healthyModels = models.filter(m => m.status.includes('HEALTHY')).length;
            const degradedModels = models.filter(m => m.status.includes('DEGRADED')).length;
            const failedModels = models.filter(m => m.status.includes('FAILED')).length;
            const freeModels = models.filter(m => m.is_free === 1).length;

            // 3. Recommended Pool Selection
            const recommendedPool = models
                .filter(m => m.status.includes('HEALTHY'))
                .sort((a, b) => (b.score || 0) - (a.score || 0))
                .slice(0, 5);

            res.json({
                timestamp: new Date().toISOString(),
                overallStatus: healthyModels > 0 ? '🟢 OPERATIONAL' : '🟡 ATTENTION REQUIRED',
                providers: providerReport,
                stats: {
                    totalProviders: activeProviders.length,
                    totalModels,
                    healthyModels,
                    degradedModels,
                    failedModels,
                    freeModels,
                    healthyRatio: totalModels > 0 ? Math.round((healthyModels / totalModels) * 100) : 0
                },
                recommendedPool,
                driveConnected: driveManager.isConnected,
                mcpConfigured: true
            });
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// -------------------------------------------------------------
// DASHBOARD STATS & TELEMETRY LOGS
// -------------------------------------------------------------

app.get('/api/admin/stats', (req, res) => {
    const stats = {};
    db.serialize(() => {
        db.get(`SELECT COUNT(*) as total FROM logs`, (err, totalRow) => {
            stats.totalRequests = totalRow ? totalRow.total : 0;
            
            db.get(`SELECT COUNT(*) as success FROM logs WHERE status = 'SUCCESS'`, (err, succRow) => {
                stats.successCount = succRow ? succRow.success : 0;
                
                db.get(`SELECT AVG(latency) as avgLatency, MIN(latency) as minLatency, MAX(latency) as maxLatency FROM logs WHERE status = 'SUCCESS'`, (err, latRow) => {
                    stats.avgLatency = latRow && latRow.avgLatency ? Math.round(latRow.avgLatency) : 0;
                    stats.minLatency = latRow && latRow.minLatency ? latRow.minLatency : 0;
                    stats.maxLatency = latRow && latRow.maxLatency ? latRow.maxLatency : 0;

                    db.all(`SELECT status, COUNT(*) as count FROM logs GROUP BY status`, [], (err, statusRows) => {
                        stats.statusBreakdown = statusRows || [];

                        db.all(`SELECT routed_model, COUNT(*) as count, AVG(latency) as avg_latency FROM logs WHERE routed_model IS NOT NULL GROUP BY routed_model ORDER BY count DESC LIMIT 5`, [], (err, topModels) => {
                            stats.topModels = topModels || [];
                            res.json(stats);
                        });
                    });
                });
            });
        });
    });
});

app.get('/api/admin/logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const status = req.query.status;
    let query = `SELECT * FROM logs`;
    const params = [];

    if (status && status !== 'ALL') {
        query += ` WHERE status = ?`;
        params.push(status);
    }
    query += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/admin/logs/clear', (req, res) => {
    db.run(`DELETE FROM logs`, [], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: "Logs cleared" });
    });
});

// -------------------------------------------------------------
// OPENAI COMPATIBLE API (/v1/chat/completions, /v1/models)
// -------------------------------------------------------------

const authenticateClient = (req, res, next) => {
    const expectedKey = process.env.COMMAND_CENTER_API_KEY;
    if (!expectedKey) return next();
    
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: "Unauthorized: Missing Bearer Token" });
    }
    
    const token = authHeader.split(' ')[1];
    if (token !== expectedKey) {
        return res.status(401).json({ error: "Unauthorized: Invalid API Key" });
    }
    
    next();
};

app.use('/v1', authenticateClient);

// Usable healthy & active models list
app.get('/v1/models', (req, res) => {
    db.all(`SELECT id, provider_id, score, roles, is_free FROM models WHERE status = '🟢 HEALTHY' OR status = '⚪ UNKNOWN'`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const data = (rows || []).map(r => ({
            id: r.id,
            object: "model",
            created: Math.floor(Date.now() / 1000),
            owned_by: r.provider_id || "ai-command-center"
        }));
        
        // Virtual Aliases
        data.push(
            { id: 'omni-fast', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'system' },
            { id: 'omni-code', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'system' },
            { id: 'omni-reason', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'system' },
            { id: 'omni-vision', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'system' },
            { id: 'omni-agent', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'system' },
            { id: 'omni-free', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'system' },
            { id: 'omni-best', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'system' }
        );

        res.json({ object: "list", data });
    });
});

// Admin All Models list
app.get('/v1/models/all', (req, res) => {
    db.all(`SELECT * FROM models`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ object: "list", data: rows });
    });
});

// OpenAI Chat Completions Endpoint with Fallback & Circuit Breaker
app.post('/v1/chat/completions', async (req, res) => {
    const requestedModel = req.body.model || 'omni-fast';
    
    try {
        const response = await router.routeRequest(req.body, requestedModel);
        res.json(response);
    } catch (error) {
        console.error("[API Error] Routing failed:", error.message);
        res.status(500).json({
            error: {
                message: error.message,
                type: "routing_error",
                param: requestedModel,
                code: "all_fallbacks_failed"
            }
        });
    }
});

// -------------------------------------------------------------
// SERVER INITIALIZATION & DEFAULT SEEDING
// -------------------------------------------------------------

app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 AI COMMAND CENTER ONLINE: http://localhost:${PORT}`);
    console.log(`📡 OpenAI-Compatible API Endpoint: http://localhost:${PORT}/v1`);
    console.log(`======================================================\n`);
    
    const defaultProviders = [
        ['openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1'],
        ['cerebras', 'Cerebras', 'https://api.cerebras.ai/v1'],
        ['groq', 'Groq', 'https://api.groq.com/openai/v1'],
        ['mistral', 'Mistral', 'https://api.mistral.ai/v1'],
        ['huggingface', 'HuggingFace', 'https://api-inference.huggingface.co/models'],
        ['together', 'Together AI', 'https://api.together.xyz/v1'],
        ['google', 'Google / Antigravity', 'https://generativelanguage.googleapis.com/v1beta/openai'],
        ['deepseek', 'DeepSeek', 'https://api.deepseek.com/v1'],
        ['ollama', 'Ollama (Local)', 'http://localhost:11434/v1'],
        ['lmstudio', 'LM Studio (Local)', 'http://localhost:1234/v1']
    ];

    const defaultAliases = [
        ['omni-fast', null, 'FAST', 'FAST'],
        ['omni-code', null, 'CODING', 'QUALITY'],
        ['omni-reason', null, 'REASONING', 'QUALITY'],
        ['omni-vision', null, 'VISION', 'BALANCED'],
        ['omni-agent', null, 'AGENT', 'QUALITY'],
        ['omni-free', null, null, 'BALANCED'],
        ['omni-best', null, null, 'QUALITY']
    ];

    const defaultPersonas = [
        ['p1', '⚡ Senior Systems Architect', 'You are a pragmatic, world-class Senior Systems Architect and Full-Stack Polyglot. You provide robust, scalable, elegant code solutions with zero fluff and maximum precision.', 'Production-grade code & architecture advisor'],
        ['p2', '🧠 Competitive DSA Master', 'You are a LeetCode Grandmaster and Algorithms Professor. Explain optimal time/space complexity, intuition, edge cases, and provide clear code with comments.', 'Algorithms, time complexity & interview prep'],
        ['p3', '🛡️ Security & Debugging Detective', 'You are a hyper-critical cybersecurity researcher and senior debugger. Identify vulnerabilities, race conditions, edge-case failures, and fix broken code instantly.', 'Deep debugging, root-cause diagnosis & security audit'],
        ['p4', '🤖 Hermes Agent Persona', 'You are Hermes AI, an autonomous software engineering engine. You think step-by-step, verify all assumptions, and provide end-to-end executable artifacts.', 'Autonomous agentic workflow executor']
    ];

    db.serialize(() => {
        // Seed Providers
        const provStmt = db.prepare(`INSERT OR IGNORE INTO providers (id, name, base_url, enabled) VALUES (?, ?, ?, 0)`);
        for (const p of defaultProviders) {
            provStmt.run(p[0], p[1], p[2]);
        }
        provStmt.finalize();

        // Seed Aliases
        const aliasStmt = db.prepare(`INSERT OR IGNORE INTO aliases (alias, target_model_id, role, routing_mode) VALUES (?, ?, ?, ?)`);
        for (const a of defaultAliases) {
            aliasStmt.run(a[0], a[1], a[2], a[3]);
        }
        aliasStmt.finalize();

        // Seed Personas
        const personaStmt = db.prepare(`INSERT OR IGNORE INTO personas (id, name, prompt, description) VALUES (?, ?, ?, ?)`);
        for (const pr of defaultPersonas) {
            personaStmt.run(pr[0], pr[1], pr[2], pr[3]);
        }
        personaStmt.finalize();
        
        // Auto-enable providers that have environment variables set
        if (process.env.OPENROUTER_API_KEY) {
            db.run(`UPDATE providers SET enabled = 1 WHERE id = 'openrouter'`);
        }
        if (process.env.CEREBRAS_API_KEY) {
            db.run(`UPDATE providers SET enabled = 1 WHERE id = 'cerebras'`);
        }
        if (process.env.GROQ_API_KEY) {
            db.run(`UPDATE providers SET enabled = 1 WHERE id = 'groq'`);
        }
        if (process.env.MISTRAL_API_KEY) {
            db.run(`UPDATE providers SET enabled = 1 WHERE id = 'mistral'`);
        }

        loadProviders();
    });
});
