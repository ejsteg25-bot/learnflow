/**
 * LearnFlow Phase 2B.1: Hardened Source Block Pipeline
 * VERSION: 0.3.3-STABLE
 */

const { useState } = React;

const APP_VERSION = "VERSION: SOURCE BLOCK PIPELINE v0.3.3-STABLE";

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

    try {
      const buffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      setText(result.value || "");
    } catch (err) {
      console.error("File processing error:", err);
      alert("Error reading .docx file.");
    }
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
  // 3. ANSWER KEY STRIPPER
  // ===============================
  function extractAnswerKey(text) {
    const lines = text.split("\n");
    const clean = [];
    const key = {};
    let inKey = false;

    for (let line of lines) {
      const l = normalize(line).toLowerCase();
      if (!inKey && (l.includes("answer key") || l === "answers" || l.startsWith("key:"))) {
        inKey = true;
        continue;
      }
      if (inKey) {
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
    return { count: matches.length, glued };
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
    if (/graph|figure|diagram|chart|image|insert graphic|look at the/i.test(raw)) return "VISUAL_REQUIRED";
    if (/\bselect\s+(two|three|all|multiple)\b/i.test(lower)) return "MULTI_SELECT";
    if (/drag|move|token|blank|_{3,}/i.test(lower)) return "INTERACTIVE";
    if (/matching|column a|column b/i.test(lower)) return "MATCHING";
    if (/write|explain|essay|draw|free response|short answer/i.test(lower)) return "FREE_RESPONSE";
    return choiceCount === 0 ? "FREE_RESPONSE" : "MULTIPLE_CHOICE";
  }

  function buildPrompt(lines) {
    const first = stripNumber(lines[0]);
    const extra = [];
    for (let l of lines.slice(1)) {
      const clean = normalize(l);
      if (!clean || /^[A-Ea-e][.)]/.test(clean) || /^answer/i.test(clean)) break;
      extra.push(clean);
      if (extra.length >= 3) break;
    }
    return [first, ...extra].join(" ").trim();
  }

  function confidenceLogic(prompt, type, choiceCount, answer, raw, glued) {
    if (!prompt || prompt.length < 10) return "LOW";
    if (type !== "MULTIPLE_CHOICE") return prompt.length > 20 ? "HIGH" : "MEDIUM";
    if (choiceCount >= 4 && answer) return "HIGH";
    if (choiceCount >= 3 && !glued) return "HIGH";
    if (glued || (choiceCount > 0 && choiceCount < 3)) return "MEDIUM";
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
      const confidence = confidenceLogic(prompt, type, choices.count, answer, raw, choices.glued);
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
        mirrorPayload: {
          topicHint: globalTopic,
          source: cleaned,
          type,
          answerHint: answer,
          metadata: { originalNumber: num, confidence, choiceCount: choices.count }
        }
      };
    });

    setBlocks(result);
    setMode("Dashboard");
  }

  // ===============================
  // 6. UI RENDER
  // ===============================
  const activeBlock = blocks[index];

  return React.createElement("div", { style: { padding: "30px", maxWidth: "1200px", margin: "auto", fontFamily: "system-ui, sans-serif", color: "#2d3436" } },
    React.createElement("header", { style: { borderBottom: "3px solid #0984e3", paddingBottom: "10px", marginBottom: "30px" } },
      React.createElement("h1", { style: { margin: 0, color: "#0984e3" } }, "LearnFlow"),
      React.createElement("span", { style: { fontSize: "0.85rem", color: "#636e72", fontWeight: "bold" } }, APP_VERSION)
    ),

    !mode && React.createElement("div", null,
      React.createElement("div", { style: { marginBottom: "25px", background: "#f1f2f6", padding: "20px", borderRadius: "8px" } },
        React.createElement("label", { style: { display: "block", fontWeight: "bold", marginBottom: "10px" } }, "Course / Unit Context:"),
        React.createElement("input", {
          value: globalTopic,
          onChange: e => setGlobalTopic(e.target.value),
          placeholder: "e.g., Unit 4: Chemical Bonding",
          style: { width: "100%", maxWidth: "400px", padding: "10px", borderRadius: "4px", border: "1px solid #dfe6e9" }
        })
      ),
      React.createElement("input", { type: "file", onChange: handleFileUpload, style: { marginBottom: "20px" } }),
      React.createElement("textarea", {
        value: text,
        onChange: e => setText(e.target.value),
        placeholder: "Paste test content here...",
        style: { width: "100%", height: "350px", padding: "15px", fontSize: "14px", fontFamily: "monospace", borderRadius: "8px", border: "1px solid #dfe6e9" }
      }),
      React.createElement("button", { onClick: harvest, style: { marginTop: "20px", padding: "12px 30px", background: "#0984e3", color: "white", border: "none", cursor: "pointer", borderRadius: "6px", fontSize: "1rem", fontWeight: "bold" } }, "Analyze Document")
    ),

    mode === "Dashboard" && React.createElement("div", null,
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "25px" } },
        React.createElement("h2", null, `Extracted Items: ${blocks.length}`),
        React.createElement("button", { onClick: () => setMode(null), style: { padding: "8px 15px", background: "none", border: "1px solid #d63031", color: "#d63031", borderRadius: "4px", cursor: "pointer" } }, "Clear & Restart")
      ),
      React.createElement("div", { style: { display: "grid", gap: "12px" } },
        blocks.map((b, i) =>
          React.createElement("div", { key: i, style: { padding: "15px", border: "1px solid #dfe6e9", borderRadius: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "white" } },
            React.createElement("div", null,
              React.createElement("b", { style: { fontSize: "1.1rem" } }, `Q${b.sourceNumber}`),
              React.createElement("span", { style: { margin: "0 10px", color: "#b2bec3" } }, "|"),
              React.createElement("span", { style: { background: "#f1f2f6", padding: "2px 8px", borderRadius: "4px", fontSize: "0.85rem" } }, b.detectedType),
              React.createElement("span", { style: { marginLeft: "15px", fontWeight: "bold", color: b.status === "READY_TO_MIRROR" ? "#27ae60" : "#e67e22" } }, b.status)
            ),
            React.createElement("button", { onClick: () => { setIndex(i); setMode("Editor"); }, style: { padding: "6px 12px", background: "#0984e3", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" } }, "Inspect")
          )
        )
      )
    ),

    mode === "Editor" && activeBlock && React.createElement("div", null,
      React.createElement("button", { onClick: () => setMode("Dashboard"), style: { marginBottom: "25px", padding: "8px 15px", background: "#636e72", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" } }, "← Back to Dashboard"),
      React.createElement("div", { style: { display: "flex", gap: "30px" } },
        React.createElement("div", { style: { flex: 1 } },
          React.createElement("h3", null, "Cleaned Source"),
          React.createElement("pre", { style: { whiteSpace: "pre-wrap", background: "#f8f9fa", padding: "20px", border: "1px solid #dfe6e9", borderRadius: "8px", fontSize: "0.95rem", minHeight: "200px" } }, activeBlock.cleanedSource)
        ),
        React.createElement("div", { style: { flex: 1 } },
          React.createElement("h3", null, "Mirror Instruction Payload"),
          React.createElement("pre", { style: { whiteSpace: "pre-wrap", background: "#f1f9ff", padding: "20px", border: "1px solid #0984e3", borderRadius: "8px", fontSize: "0.9rem", color: "#0984e3" } }, JSON.stringify(activeBlock.mirrorPayload, null, 2))
        )
      )
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
