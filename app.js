/**
 * LearnFlow Phase 2B.1: Hardened Source Block Pipeline
 * VERSION: 0.3.2-STABLE
 */

const { useState } = React;

const APP_VERSION = "VERSION: SOURCE BLOCK PIPELINE v0.3.2-STABLE";

function App() {
  const [text, setText] = useState("");
  const [blocks, setBlocks] = useState([]);
  const [globalTopic, setGlobalTopic] = useState("Chemistry");
  const [mode, setMode] = useState(null);
  const [index, setIndex] = useState(0);

  // ===============================
  // 1. FILE INGESTION
  // ===============================
  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (typeof mammoth === "undefined") {
      alert("Mammoth.js not loaded.");
      return;
    }

    const buffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    setText(result.value || "");
  }

  // ===============================
  // 2. UTILITIES
  // ===============================
  const normalize = (l) => String(l || "").replace(/\s+/g, " ").trim();

  const isNoise = (line) => {
    const lower = normalize(line).toLowerCase();
    return (
      lower.includes("scantron") ||
      lower.includes("class set") ||
      lower.includes("do not write") ||
      /^name\s*:/.test(lower) ||
      /^date\s*:/.test(lower) ||
      /^class\s*:/.test(lower)
    );
  };

  const isQuestionStart = (line) => /^\s*\d{1,3}[.)]\s+\S+/.test(line);

  const getNumber = (line) => line.match(/^\s*(\d{1,3})[.)]/)?.[1] || "?";

  const stripNumber = (line) => line.replace(/^\s*\d{1,3}[.)]\s*/, "");

  // ===============================
  // 3. ANSWER KEY STRIPPER (Stability Hardening)
  // ===============================
  function extractAnswerKey(text) {
    const lines = text.split("\n");
    const clean = [];
    const key = {};
    let inKey = false;

    for (let line of lines) {
      const l = normalize(line).toLowerCase();

      // Check for start of answer key
      if (!inKey && (l === "answer key" || l === "answers" || l.includes("answer key:"))) {
        inKey = true;
        continue;
      }

      if (inKey) {
        // Simple map of 1. A or 1) B
        const m = line.match(/^(\d+).*?([A-E])\b/i);
        if (m) key[m[1]] = m[2].toUpperCase();
        continue;
      }

      clean.push(line);
    }

    return { cleaned: clean.join("\n"), answerKey: key };
  }

  // ===============================
  // 4. DETECTION ENGINE
  // ===============================
  function detectChoices(raw) {
    const matches = [...raw.matchAll(/[A-Ea-e][.)]+\s*/g)];
    const glued = /[A-Za-z0-9)](?=[B-Eb-e][.)])/.test(raw);

    return {
      count: matches.length,
      glued
    };
  }

  function detectAnswer(raw, external) {
    if (external) return external;

    const answerLine = raw.match(/answer\s*[:\-]?\s*([A-E])\b/i);
    if (answerLine) return answerLine[1].toUpperCase();

    const star = raw.match(/\b([A-Ea-e])[.)]?[^\n]*\*{2,3}/);
    if (star) return star[1].toUpperCase();

    return null;
  }

  function detectType(raw, choiceCount) {
    const lower = raw.toLowerCase();

    // Aggressive visual check to prevent false negatives
    if (/graph|figure|diagram|chart|image|insert graphic|look at the graph|based on this graph/i.test(raw)) {
      return "VISUAL_REQUIRED";
    }

    if (/\bselect\s+(two|three|all|multiple)\b/i.test(lower)) {
      return "MULTI_SELECT";
    }

    if (/drag|move|token|blank|_{3,}/i.test(lower)) {
      return "INTERACTIVE";
    }

    if (/matching|column a|column b/i.test(lower)) {
      return "MATCHING";
    }

    if (/write|explain|essay|draw|free response/i.test(lower)) {
      return "FREE_RESPONSE";
    }

    if (choiceCount === 0) return "FREE_RESPONSE";

    return "MULTIPLE_CHOICE";
  }

  function buildPrompt(lines) {
    const first = stripNumber(lines[0]);
    const extra = [];

    for (let l of lines.slice(1)) {
      const clean = normalize(l);

      if (!clean) continue;
      if (/^[A-Ea-e][.)]/.test(clean)) break;
      if (/^answer/i.test(clean)) break;

      extra.push(clean);
      if (extra.length >= 2) break;
    }

    return [first, ...extra].join(" ").trim();
  }

  function confidenceLogic(prompt, type, choiceCount, answer, raw, glued) {
    if (!prompt || prompt.length < 8) return "LOW";

    if (type !== "MULTIPLE_CHOICE") {
      return prompt.length > 15 ? "HIGH" : "MEDIUM";
    }

    if (choiceCount >= 3 && answer) return "HIGH";
    if (choiceCount >= 3) return "HIGH";
    if (glued) return "MEDIUM";
    if (raw.length > 60) return "MEDIUM";

    return "LOW";
  }

  function statusLogic(type, confidence, duplicate) {
    if (duplicate) return "DUPLICATE";
    if (type === "VISUAL_REQUIRED") return "NEEDS_GRAPHIC";
    if (confidence === "LOW") return "NEEDS_TEACHER_REVIEW";
    return "READY_TO_MIRROR";
  }

  // ===============================
  // 5. MAIN PIPELINE
  // ===============================
  function harvest() {
    const base = extractAnswerKey(text);
    const rawLines = base.cleaned.split("\n").map(l => l.trim()).filter(l => l);

    const groups = [];
    let current = null;

    rawLines.forEach(line => {
      if (isQuestionStart(line)) {
        if (current) groups.push(current);
        current = [line];
      } else if (current) {
        current.push(line);
      }
    });

    if (current) groups.push(current);

    const seen = new Set();

    const result = groups.map(lines => {
      const raw = lines.join("\n");
      const num = getNumber(lines[0]);
      const duplicate = seen.has(num);
      seen.add(num);

      const choices = detectChoices(raw);
      const answer = detectAnswer(raw, base.answerKey[num]);
      const type = detectType(raw, choices.count);
      const prompt = buildPrompt(lines);

      const confidence = confidenceLogic(
        prompt,
        type,
        choices.count,
        answer,
        raw,
        choices.glued
      );

      const status = statusLogic(type, confidence, duplicate);

      const cleaned = lines.filter(l => !isNoise(l)).join("\n");

      return {
        sourceNumber: num,
        detectedType: type,
        confidence,
        status,
        prompt,
        rawText: raw,
        cleanedSource: cleaned,
        answerHint: answer,
        choiceCount: choices.count,
        mirrorPayload: {
          topicHint: globalTopic,
          source: cleaned,
          rawBackup: raw,
          type,
          answerHint: answer
        }
      };
    });

    setBlocks(result);
    setMode("Dashboard");
  }

  // ===============================
  // UI COMPONENTS
  // ===============================
  const current = blocks[index];

  return React.createElement("div", { style: { padding: 30, fontFamily: "sans-serif" } },

    React.createElement("h1", { style: { margin: 0 } }, "LearnFlow"),
    React.createElement("p", { style: { color: "#666", fontWeight: "bold" } }, APP_VERSION),

    !mode && React.createElement("div", null,
      React.createElement("div", { style: { marginBottom: 20 } },
        React.createElement("label", null, "Topic: "),
        React.createElement("input", {
          value: globalTopic,
          onChange: e => setGlobalTopic(e.target.value),
          style: { padding: 5 }
        })
      ),
      React.createElement("input", { type: "file", onChange: handleFileUpload, style: { marginBottom: 10 } }),
      React.createElement("textarea", {
        value: text,
        onChange: e => setText(e.target.value),
        placeholder: "Paste or upload DocX content...",
        style: { width: "100%", height: 300, display: "block", marginBottom: 10 }
      }),
      React.createElement("button", { onClick: harvest, style: { padding: "10px 20px" } }, "Analyze Document")
    ),

    mode === "Dashboard" && React.createElement("div", null,
      React.createElement("button", { onClick: () => setMode(null) }, "Restart"),
      React.createElement("table", { style: { width: "100%", marginTop: 20, borderCollapse: "collapse" } },
        React.createElement("thead", null,
          React.createElement("tr", { style: { background: "#eee", textAlign: "left" } },
            ["#", "Type", "Status", "Confidence", "Action"].map(h => React.createElement("th", { key: h, style: { padding: 10 } }, h))
          )
        ),
        React.createElement("tbody", null,
          blocks.map((b, i) =>
            React.createElement("tr", { key: i, style: { borderBottom: "1px solid #ddd" } },
              React.createElement("td", { style: { padding: 10 } }, b.sourceNumber),
              React.createElement("td", { style: { padding: 10 } }, b.detectedType),
              React.createElement("td", { style: { padding: 10, fontWeight: "bold" } }, b.status),
              React.createElement("td", { style: { padding: 10 } }, b.confidence),
              React.createElement("td", { style: { padding: 10 } },
                React.createElement("button", {
                  onClick: () => { setIndex(i); setMode("Editor"); }
                }, "Inspect")
              )
            )
          )
        )
      )
    ),

    mode === "Editor" && current && React.createElement("div", null,
      React.createElement("button", { onClick: () => setMode("Dashboard") }, "← Back"),
      React.createElement("h2", null, `Question ${current.sourceNumber}`),
      React.createElement("div", { style: { display: "flex", gap: 20 } },
        React.createElement("div", { style: { flex: 1 } },
          React.createElement("h4", null, "Cleaned Source"),
          React.createElement("pre", { style: { background: "#f9f9f9", padding: 10 } }, current.cleanedSource)
        ),
        React.createElement("div", { style: { flex: 1 } },
          React.createElement("h4", null, "Mirror Payload"),
          React.createElement("pre", { style: { background: "#eef7ff", padding: 10 } }, JSON.stringify(current.mirrorPayload, null, 2))
        )
      )
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(App)
);
