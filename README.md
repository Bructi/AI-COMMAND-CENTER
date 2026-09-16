<div align="center">

```
   █████╗ ██╗     ██████╗ ██████╗ ███╗   ███╗███╗   ███╗ █████╗ ███╗   ██╗██████╗ 
  ██╔══██╗██║    ██╔════╝██╔═══██╗████╗ ████║████╗ ████║██╔══██╗████╗  ██║██╔══██╗
  ███████║██║    ██║     ██║   ██║██╔████╔██║██╔████╔██║███████║██╔██╗ ██║██║  ██║
  ██╔══██║██║    ██║     ██║   ██║██║╚██╔╝██║██║╚██╔╝██║██╔══██║██║╚██╗██║██║  ██║
  ██║  ██║██║    ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║ ╚═╝ ██║██║  ██║██║ ╚████║██████╔╝
  ╚═╝  ╚═╝╚═╝     ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝ 
                      ⚡ PERSONAL AI INFRASTRUCTURE CORE ⚡
```

# 🚀 AI COMMAND CENTER & INTELLIGENT ROUTER
### *Next-Generation Personal AI Infrastructure, Multi-Provider Auto-Fallback Engine, RAG Knowledge Hub, & Model Benchmark Lab*

[![Express](https://img.shields.io/badge/Express-5.x-blue?style=for-the-badge&logo=express)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-Database-003B57?style=for-the-badge&logo=sqlite)](https://www.sqlite.org/)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI%20Compatible-412991?style=for-the-badge&logo=openai)](https://openai.com/)
[![RAG Engine](https://img.shields.io/badge/RAG-Hybrid%20Search%20%2B%20Citations-10b981?style=for-the-badge)](https://github.com/)
[![Zero Build](https://img.shields.io/badge/Frontend-Vanilla%20%26%20Zero%20Build-f59e0b?style=for-the-badge)](https://developer.mozilla.org/)
[![Google Drive](https://img.shields.io/badge/Cloud%20Storage-Google%20Drive%20OAuth2-4285F4?style=for-the-badge&logo=googledrive)](https://drive.google.com/)

[**Explore Features**](#-key-features--capabilities) • 
[**Quick Start**](#-quick-start-guide) • 
[**RAG System**](#-rag-retrieval-augmented-generation-chatbot) • 
[**API Reference**](#-openai-compatible-api-reference) • 
[**Client Setup**](#-client-integrations-hermes-cursor-python)

---

</div>

## 📌 Executive Summary & Purpose

### The Problem
Developers, students, and autonomous AI agents (Hermes, Cursor, Cline, OpenCode) face recurring friction:
1. **Flaky & Dead Models:** Providers list hundreds of models in `/models`, but many return `404`, `500`, or deprecation errors when actually called.
2. **Rate Limits & Quota Jams:** Free and tiered models frequently hit temporary `429 Rate Limits`.
3. **Fragmented Keys & Endpoints:** Manually juggling endpoints across OpenRouter, Cerebras, Groq, Mistral, Together AI, DeepSeek, and local Ollama is tedious.
4. **Local Hardware Constraints:** Many laptops have limited RAM (e.g. 8 GB) and cannot run heavy local vector databases or large local models.

### The Solution: AI Command Center
**AI Command Center** is a lightweight, high-performance personal AI infrastructure core that sits between your applications and any cloud or local LLM provider. It exposes a single unified **OpenAI-compatible endpoint** (`http://localhost:3000/v1`) with:
- **Intelligent Dynamic Aliases** (`omni-fast`, `omni-code`, `omni-reason`, `omni-vision`, `omni-agent`, `omni-free`, `omni-best`)
- **Automated Fallback Chains & Circuit Breakers**
- **High-Throughput Model Health Testing Engine**
- **Integrated RAG Knowledge Base & Citation Chatbot**
- **5-Task Model Benchmark Lab with Google Drive Auto-Sync**
- **Sleek Cyberpunk HUD with Instant Light & Dark Themes**

---

## 🏛️ System Architecture

```
                                  +---------------------------------------+
                                  |     CLIENTS / AGENTS / DEVELOPERS     |
                                  |   (Hermes, Cursor, Python, cURL)      |
                                  +-------------------+-------------------+
                                                      |
                                                      v  POST /v1/chat/completions (model: omni-code)
                                  +-------------------+-------------------+
                                  |         AI COMMAND CENTER CORE        |
                                  +-------------------+-------------------+
                                                      |
                    +---------------------------------+---------------------------------+
                    |                                 |                                 |
                    v                                 v                                 v
        +-----------------------+         +-----------------------+         +-----------------------+
        |   ROUTING ENGINE      |         |     RAG ENGINE        |         |   HEALTH & DIAGNOSTICS|
        | - Mode: Quality/Fast  |         | - Text/PDF Chunking   |         | - Ping & Concurrency  |
        | - Role: Coding/Reason |         | - Hybrid Search       |         | - Circuit Breaker     |
        | - Dynamic Aliases     |         | - Citation Injection  |         | - Provider Doctor     |
        +-----------+-----------+         +-----------+-----------+         +-----------+-----------+
                    |                                 |                                 |
                    v                                 v                                 v
        +---------------------------------------------------------------------------------------+
        |                               UNIFIED PROVIDER ADAPTERS                               |
        |  OpenRouter • Cerebras • Groq • Mistral • DeepSeek • Google/Antigravity • LM Studio   |
        +-------------------------------------------+-------------------------------------------+
                                                    |
                                                    v
                                  +-----------------+-----------------+
                                  |       DATABASE & CLOUD BACKUP     |
                                  |   SQLite (data.db) + Google Drive |
                                  +-----------------------------------+
```

---

## ✨ Key Features & Capabilities

### 1. 🔀 Intelligent Routing & Virtual Aliases
Never hardcode brittle model names into your agents again. Call universal virtual aliases that dynamically resolve to currently healthy models:

| Virtual Alias | Target Role | Strategy | Automatic Behavior |
|---|---|---|---|
| **`omni-fast`** | Fast Inference | `FAST` | Routes to the lowest-latency healthy provider (e.g. *Codestral / Groq / Cerebras*). |
| **`omni-code`** | Software Dev | `QUALITY` | Resolves to top-scoring coding models with function-calling capabilities. |
| **`omni-reason`** | Deep Reasoning | `QUALITY` | Routes to verified logic, math, and reasoning architectures (*R1 / QwQ / Gemini*). |
| **`omni-vision`** | Multimodal | `BALANCED`| Routes to models with visual recognition and image comprehension. |
| **`omni-agent`** | Autonomous Agent | `QUALITY` | Specialized for multi-step tool use, strict schema outputs, and instruction following. |
| **`omni-free`** | Zero Token Cost | `BALANCED`| Strictly isolates verified free-tier models, preventing unexpected token billing. |
| **`omni-best`** | Top Benchmark Score | `QUALITY` | Routes to the model with the highest aggregate benchmark score in the registry. |

---

### 2. 📚 RAG (Retrieval-Augmented Generation) Chatbot
Upload study notes, project architecture documents, research papers, or API specs (`PDF`, `TXT`, `MD`, `JSON`, `CSV`, code files).
- **Lightweight Document Chunking:** Splits documents into overlapping semantic chunks without heavy dependencies.
- **Hybrid Keyword & N-Gram Search:** Matches queries against document chunks with confidence percentage scores.
- **Grounding & Source Attribution:** Injects context into prompts and returns citation badges showing exact document names and excerpt snippets directly in chat.
- **RAG Sandbox:** Interactive test query search bar in the Knowledge tab to inspect extracted chunks in real time.

---

### 3. 🧪 5-Task Standardized Model Benchmark Lab
Run multi-dimensional evaluations across any model in seconds:
- **`CODING_TEST`**: One-line reverse and functional algorithm test.
- **`REASONING_TEST`**: Logic puzzle and mathematical deductions.
- **`JSON_STRUCTURED_TEST`**: Strict JSON schema adherence without markdown fences.
- **`AGENT_INSTRUCTION_TEST`**: Strict security filter and multi-condition execution.
- **`LATENCY_SPEED_TEST`**: Round-trip response time measurement.
- **Google Drive Auto-Backup:** Generates clean markdown reports and backs them up automatically to your Google Drive.

---

### 4. 🩺 Provider Doctor Diagnostics
A full diagnostic command module that audits:
- API key configuration status for all providers.
- Real network reachability and ping latencies.
- Ratio of healthy vs degraded vs failed models.
- Automatic generation of the **Recommended Active Pool**.

---

### 5. 🎨 Dual-Mode Cyberpunk & Studio Light Themes
- **Obsidian Dark Cockpit:** High-tech glassmorphism with emerald, cyan, and neon accents.
- **Studio Light Mode:** Clean, crisp SaaS aesthetic with high contrast and soft shadows for daytime productivity.
- Remembers your theme preference in `localStorage`.

---

## ⚡ Quick Start Guide

### 1. Prerequisites
- **Node.js** (v18.0.0 or higher)
- **npm** (v9.0.0 or higher)

### 2. Installation
```bash
# Clone or navigate to the repository directory
cd "AI COMMAND CENTER"

# Install lightweight dependencies
npm install
```

### 3. Configure Environment (`.env`)
Create or edit your `.env` file at the root directory:
```ini
PORT=3000
COMMAND_CENTER_API_KEY=your_local_secret_key_here

# Optional: Provider API Keys (or configure directly in the UI dashboard)
OPENROUTER_API_KEY=sk-or-v1-...
CEREBRAS_API_KEY=csk-...
GROQ_API_KEY=gsk_...
MISTRAL_API_KEY=...

# Optional: Google Drive Cloud Integration (for RAG & Benchmark Cloud Backups)
GOOGLE_CLIENT_ID=your_oauth_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_oauth_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
```

### 4. Launch the Command Center
```bash
# Start server in production mode
npm start

# Or start in development mode with auto-reload
npm run dev
```
Open **`http://localhost:3000`** in your browser.

---

## 🛠️ CLI Shortcuts & Standalone Test Utilities

The repository includes standalone CLI testing utilities that can be executed directly in your terminal to verify and audit your AI infrastructure without needing a browser:

| Command | Purpose | How to Run |
|---|---|---|
| `npm start` | Boots the AI Command Center server on `http://localhost:3000`. | `npm start` |
| `npm run dev` | Starts server with `nodemon` for active development. | `npm run dev` |
| **`test-all-models.js`** | **Batch Health Auditor:** Tests all 600+ models concurrently in the terminal with 15 parallel workers, records live statuses into SQLite, and outputs a ranked latency leaderboard. | `npm run health-check`<br>*(or `node test-all-models.js`)* |
| **`test-router.js`** | **Router Smoke Test:** Sends an end-to-end verification prompt to `http://localhost:3000/v1/chat/completions` using the `omni-fast` alias to confirm routing & fallback health. | `node test-router.js`<br>*(run while server is up)* |

---

### 🧪 Detailed Usage of Standalone Test Files

#### 1. `test-all-models.js` — High-Speed Terminal Model Auditor
Use this script whenever you want to perform a deep health check of all models across all enabled providers directly in the terminal.

- **What it does:**
  - Queries all enabled providers and models directly from `data.db`.
  - Spawns a pool of 15 asynchronous workers to probe each model concurrently with a lightweight test prompt.
  - Automatically classifies each model into `🟢 HEALTHY`, `🟡 DEGRADED` (429 Rate Limit), or `🔴 FAILED`.
  - Updates the SQLite database (`data.db`) in real time with exact round-trip latencies.
  - Displays a final terminal audit summary and ranked list of verified working models.

- **How to run:**
  ```bash
  npm run health-check
  # or
  node test-all-models.js
  ```

- **Sample Terminal Output:**
  ```text
  ======================================================
  ⚡ STARTING COMPREHENSIVE MULTI-MODEL HEALTH TEST
  ======================================================

  Found 618 models across enabled providers to test.

  [1/618] 🟢 HEALTHY (981ms): mistral/codestral-latest
  [2/618] 🟢 HEALTHY (1309ms): openrouter/nvidia/nemotron-3-ultra-550b-a55b:free-medium
  [3/618] 🟢 HEALTHY (2087ms): antigravity/gemini-3.5-flash-lite
  ...
  ======================================================
  📊 FINAL HEALTH AUDIT SUMMARY:
  Total Models Tested: 618 / 618
  🟢 HEALTHY Models:   55
  🟡 DEGRADED Models:  27
  🔴 FAILED Models:    536
  ======================================================
  ```

---

#### 2. `test-router.js` — Live Router Smoke Test
Use this script to verify that your local OpenAI-compatible API endpoint is up and resolving requests.

- **What it does:**
  - Sends a test payload to `POST http://localhost:3000/v1/chat/completions`.
  - Uses the virtual alias `omni-fast` and your configured `COMMAND_CENTER_API_KEY`.
  - Verifies that the router selects a healthy model, handles the completion, logs the request, and returns a valid OpenAI-compatible response.

- **How to run:**
  ```bash
  # Step 1: In one terminal, start the server
  npm start

  # Step 2: In another terminal, run the smoke test
  node test-router.js
  ```

- **Sample Terminal Output:**
  ```text
  Sending test request to AI Command Center...
  ✅ Success! Router responded with:
  Hello! 😊 How can I help you today?

  ➡️ Now check your Dashboard in the browser!
  ```

---

## 📡 OpenAI-Compatible API Reference

AI Command Center exposes an OpenAI-compatible API so all existing LLM tooling works out-of-the-box.

### `POST /v1/chat/completions`
Send chat completions using direct model IDs or virtual aliases:

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer your_local_secret_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "omni-code",
    "messages": [
      {"role": "system", "content": "You are an expert software engineer."},
      {"role": "user", "content": "Write an async worker queue in JavaScript."}
    ],
    "temperature": 0.5,
    "max_tokens": 800
  }'
```

### `GET /v1/models`
Returns all currently usable healthy models and virtual aliases.

---

## 🤖 Client Integrations (Hermes, Cursor, Python)

### 1. Hermes AI Agent
Point Hermes to your personal AI Command Center:
```json
{
  "provider": "custom",
  "base_url": "http://localhost:3000/v1",
  "api_key": "YOUR_COMMAND_CENTER_API_KEY",
  "model": "omni-code",
  "fallback_model": "omni-fast"
}
```

### 2. Cursor / Cline / Roo Code / OpenCode
- **API Format:** OpenAI Compatible
- **Base URL:** `http://localhost:3000/v1`
- **API Key:** `none` (or your `COMMAND_CENTER_API_KEY`)
- **Model ID:** `omni-code` or `omni-fast`

### 3. Python (`openai` SDK)
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="your_local_key"
)

response = client.chat.completions.create(
    model="omni-fast",
    messages=[{"role": "user", "content": "Explain binary search trees in 1 sentence."}]
)

print(response.choices[0].message.content)
```

---

## 🗄️ Database Schema & Storage

The system utilizes SQLite (`data.db`) for near-zero memory footprint and zero external database management:

- **`providers`**: Stores provider IDs, display names, base URLs, API keys, and enabled flags.
- **`models`**: Stores model identifiers, provider associations, health status (`🟢 HEALTHY`, `🟡 DEGRADED`, `🔴 FAILED`), latencies, context sizes, roles, and capability scores.
- **`aliases`**: Maps dynamic aliases (`omni-fast`, `omni-code`, etc.) to specific roles and routing algorithms.
- **`documents`**: Metadata for uploaded RAG documents with Google Drive file IDs.
- **`document_chunks`**: Indexed text segments for the RAG search engine.
- **`benchmarks`**: Historical 5-task benchmark results and scoring radar.
- **`personas`**: System prompts for AI roles (Architect, DSA Coach, Debugger, Hermes Agent).
- **`logs`**: Real-time request telemetry, latencies, and circuit-breaker error logs.

---

## 🛡️ Security & Privacy
- **No Secret Leakage:** Provider API keys are never returned in plaintext to the frontend (only a `has_key` boolean indicator is sent).
- **Safe Logging:** Telemetry logs track model identifiers and latencies without persisting raw user prompt payloads by default.
- **Local First:** Everything runs locally on your machine with zero cloud dependency unless Google Drive sync is explicitly authorized.

---

<div align="center">

**⚡ Built for speed, reliability, and precision. Built for developers.**

</div>
