const db = require('../db/database');
const driveManager = require('../drive/DriveManager');

class BenchmarkLab {
    constructor(router) {
        this.router = router;
        
        // Comprehensive multi-task benchmark suite
        this.suite = [
            {
                id: 'coding',
                name: 'CODING_TEST',
                role: 'CODING',
                prompt: 'Write a one-line JavaScript function to reverse a string. Return ONLY the code.',
                evaluator: (out) => (out.includes('split') && out.includes('reverse') && out.includes('join')) || (out.includes('[...s]') && out.includes('reverse'))
            },
            {
                id: 'reasoning',
                name: 'REASONING_TEST',
                role: 'REASONING',
                prompt: 'Sally has 3 brothers. Each of her brothers has 2 sisters. How many sisters does Sally have? Answer with just the number.',
                evaluator: (out) => out.trim().startsWith('1') || out.toLowerCase().includes('one') || out.includes('1 sister')
            },
            {
                id: 'json',
                name: 'JSON_STRUCTURED_TEST',
                role: 'JSON',
                prompt: 'Output a valid JSON object with keys "status" (string "ok") and "code" (integer 200). Do not output markdown fences or other text.',
                evaluator: (out) => {
                    try {
                        const clean = out.replace(/```json/g, '').replace(/```/g, '').trim();
                        const parsed = JSON.parse(clean);
                        return parsed.status === 'ok' && parsed.code === 200;
                    } catch (e) {
                        return false;
                    }
                }
            },
            {
                id: 'agent',
                name: 'AGENT_INSTRUCTION_TEST',
                role: 'AGENT',
                prompt: 'You are a strict security filter. If the text contains "SECRET", say "BLOCKED". Otherwise say "ALLOWED". Text: "The project code is SECRET_V2". Reply with one word.',
                evaluator: (out) => out.trim().toUpperCase().includes('BLOCKED') && !out.trim().toUpperCase().includes('ALLOWED')
            },
            {
                id: 'latency',
                name: 'LATENCY_SPEED_TEST',
                role: 'FAST',
                prompt: 'Reply with the single uppercase word "PONG".',
                evaluator: (out) => out.trim().toUpperCase().includes('PONG')
            }
        ];
    }

    async runBenchmark(modelId) {
        console.log(`[BenchmarkLab] Starting comprehensive parallel benchmark for ${modelId}`);
        const model = await this.router.getModelById(modelId);
        if (!model) throw new Error(`Model ${modelId} not found.`);
        
        const provider = this.router.providers[model.provider_id];
        if (!provider) throw new Error(`Provider not configured for ${modelId}.`);

        let report = `# 🧪 Model Benchmark Report: ${modelId}\n`;
        report += `**Provider:** \`${model.provider_id}\` | **Date:** ${new Date().toUTCString()}\n\n`;
        report += `| Test | Category | Status | Latency | Result |\n`;
        report += `| :--- | :--- | :--- | :--- | :--- |\n`;
        
        // Execute all benchmark tasks concurrently in parallel
        const results = await Promise.all(this.suite.map(async (test) => {
            const startTime = Date.now();
            try {
                const res = await provider.chatCompletion(modelId, {
                    messages: [{ role: 'user', content: test.prompt }],
                    max_tokens: 60,
                    temperature: 0.1
                });
                const latency = Date.now() - startTime;
                const output = (res.choices?.[0]?.message?.content || JSON.stringify(res)).trim();
                const passed = test.evaluator(output);
                return {
                    test,
                    passed,
                    latency,
                    output,
                    error: null
                };
            } catch (err) {
                return {
                    test,
                    passed: false,
                    latency: Date.now() - startTime,
                    output: null,
                    error: err.message
                };
            }
        }));

        let totalScore = 0;
        let codingScore = 0;
        let reasoningScore = 0;
        let latencyScore = 0;
        let totalLatency = 0;
        let testDetails = [];

        for (const item of results) {
            const { test, passed, latency, output, error } = item;
            totalLatency += latency;
            const scoreDelta = passed ? 20 : (error ? 0 : 5);
            totalScore += scoreDelta;

            if (test.id === 'coding') codingScore = passed ? 100 : 20;
            if (test.id === 'reasoning') reasoningScore = passed ? 100 : 20;
            if (test.id === 'latency') latencyScore = latency < 1000 ? 100 : Math.max(10, 100 - Math.round(latency / 50));

            if (error) {
                report += `| **${test.name}** | ${test.role} | ❌ ERROR | ${latency}ms | *${error.substring(0, 40)}* |\n`;
                testDetails.push({ name: test.name, role: test.role, passed: false, latency, error });
            } else {
                const statusBadge = passed ? '✅ PASS' : '⚠️ FAIL';
                report += `| **${test.name}** | ${test.role} | ${statusBadge} | ${latency}ms | \`${output.substring(0, 40).replace(/\n/g, ' ')}\` |\n`;
                testDetails.push({ name: test.name, role: test.role, passed, latency, output });
            }
        }
        
        const avgLatency = Math.round(totalLatency / this.suite.length);
        report += `\n### Summary Scores\n`;
        report += `- **Overall Score:** **${totalScore} / 100**\n`;
        report += `- **Coding Quality:** ${codingScore}%\n`;
        report += `- **Reasoning Depth:** ${reasoningScore}%\n`;
        report += `- **Average Latency:** ${avgLatency}ms\n\n`;
        
        // Update model score in DB
        db.run(`UPDATE models SET score = ?, latency = ?, last_tested = CURRENT_TIMESTAMP WHERE id = ?`, [totalScore, avgLatency, modelId]);

        // Record benchmark in database
        db.run(
            `INSERT INTO benchmarks (model_id, provider_id, overall_score, coding_score, reasoning_score, latency_score, avg_latency, report) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [modelId, model.provider_id, totalScore, codingScore, reasoningScore, latencyScore, avgLatency, report]
        );

        // If Google Drive is connected, upload the report
        let driveId = null;
        if (driveManager.isConnected) {
            const filename = `benchmark_${modelId.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.md`;
            const uploadRes = await driveManager.uploadLogFile(filename, report);
            if (uploadRes.success) {
                driveId = uploadRes.fileId;
                report += `*☁️ Automatically backed up to Google Drive (File ID: \`${uploadRes.fileId}\`)*\n`;
            }
        }

        return {
            modelId,
            providerId: model.provider_id,
            totalScore,
            codingScore,
            reasoningScore,
            latencyScore,
            avgLatency,
            report,
            testDetails,
            driveId
        };
    }
}

module.exports = BenchmarkLab;
