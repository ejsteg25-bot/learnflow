/**
 * LearnFlow Phase 3: Single-Question AI Mirroring Layer
 * VERSION: SOURCE BLOCK PIPELINE v0.5.5-BETA-COMPLETE
 * 
 * STATUS: 
 * - UNVERIFIED — NOT CONFIRMED STABLE.
 * 
 * FIXES:
 * - Completes the truncated isHeader and harvest logic.
 * - Restores all UI inputs (Topic, DOCX, Textarea).
 * - Implements the non-restrictive Q1 Gate to ensure Q1 is captured.
 */

const { useState } = React;

const APP_VERSION = "VERSION: SOURCE BLOCK PIPELINE v0.5.5-BETA-COMPLETE";

function App() {
  const [text, setText] = useState("");
  const [blocks, setBlocks] = useState([]);
  const [globalTopic, setGlobalTopic] = useState("Chemistry");
  const [mode, setMode] = useState(null);
  const [index, setIndex] = useState(0);
  const [diagnostics, setDiagnostics] = useState("");

  const normalize = (line) => String(line || "").replace(/\s+/g, " ").trim();

  function cleanText(value) {
    return String(value || "")
      .replace(/\r/g, "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (typeof mammoth === "undefined") {
      setDiagnostics("DOCX load failed: Mammoth.js not detected.");
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      setText(result.value || "");
      setDiagnostics("DOCX loaded. Raw characters: " + String(result.value || "").length);
    } catch (err) {
      setDiagnostics("DOCX parse failed: " + err.message);
    }
  }

  function extractAnswerKey(value) {
    const lines = value.split("\n");
    const clean = [];
    const key = {};
    let inKey = false;

    for (const line of lines) {
      const lower = normalize(line).toLowerCase();
      if (!inKey && (lower === "answer key" || lower === "answers" || lower.startsWith("answer key:") || lower.startsWith("key:"))) {
        inKey = true;
        continue;
      }
      if (inKey) {
        const match = normalize(line).match(/^(\d{1,3})[.)]?\s*[-: ]?\s*([A-Ea-e*]{1,3})\b/);
        if (match) key[match[1]] = match[2].replace(/\*/g, "").toUpperCase();
        continue;
      }
      clean.push(line);
    }
    return { cleaned: clean.join("\n"), answerKey: key };
  }

  function isHeader(line) {
    const clean = normalize(line);
    if (/^\s*\d{1,3}[.)]\s+/.test(clean)) return false;
    return (
      /^part\s+(\d+|[ivx]+)\s*:/i.test(clean) || 
      /^section\s+([a-z]|\d+)\s*:/i.test(clean)
    );
  }

  function trimBeforeAssessmentStart(lines) {
    const partIndex = lines.findIndex(line => /^part\s+(\d+|[ivx]+)\s*:/i.test(normalize(line)));
    return partIndex >= 0 ? lines.slice(partIndex + 1) : lines;
  }

  function isLikelyAnswerGridStart(lines, startIndex) {
    const window = lines.slice(startIndex, startIndex + 15).map(normalize);
    if (window.length < 6) return false;
    const shortLines = window.filter(line => line.length <= 4).length;
    const scantronTokens = window.filter(line => /^\d{1,3}[.)]?$/.test(line) || /^[A-E]$/i.test(line)).length;
    const hasSentence = window.some(line => line.length > 20 && /\s/.test(line));
    return (scantronTokens >= 4 && shortLines >= window.length * 0.65 && !hasSentence);
  }

  function detectEndLineAnswer(rawText) {
    const clean = normalize(rawText);
    const match = clean.match(/^\d{1,3}[.)]\s+(.+?)\s+([A-Ea-e])$/);
    if (!match) return null;
    return match[1].trim().length >= 2 ? { stem: match[1].trim(), answer: match[2].toUpperCase() } : null;
  }

  function hasChoiceMarker(value) {
    return /(^|\s)[A-Ea-e][.)](\s|$)/.test(value);
  }

  function detectChoiceCount(rawText) {
    const matches = rawText.match(/(^|\s)[A-Ea-e][.)](\s|$)/g);
    return matches ? matches.length : 0;
  }

  function isQuestionStart(lines, i, started) {
    const line = lines[i];
    if (!/^\s*\d{1,3}[.)]\s+\S+/.test(line)) return false;
    if (isHeader(line)) return false;
    if (isLikelyAnswerGridStart(lines, i)) return false;
    
    // First valid numbered item found is Q1
    if (!started) return true;
    
    // Subsequent numbered items are accepted
    return true;
  }

  function detectType(rawText, choiceCount) {
    const lower = rawText.toLowerCase();
    if (/\b(graph|figure|diagram|image|chart|heating curve|cooling curve)\b/i.test(lower) || /\bwhich segment\b/i.test(lower)) return "VISUAL_REQUIRED";
    if (/\bselect\s+(all|multiple|two|three|four)\b/i.test(lower)) return "MULTI_SELECT";
    if (/drag|move|blank|_{3,}|☐|token bank|drop zone/i.test(lower)) return "INTERACTIVE";
    if (/matching|match each|column a|column b/i.test(lower)) return "MATCHING";
    if (detectEndLineAnswer(rawText) && choiceCount === 0) return "MATCHING";
    return choiceCount === 0 ? "FREE_RESPONSE" : "MULTIPLE_CHOICE";
  }

  function harvest() {
    try {
      const cleanedInput = cleanText(text);
      if (!cleanedInput) return alert("No text loaded.");

      const base = extractAnswerKey(cleanedInput);
      const allLines = base.cleaned.split("\n").map(line => line.trim()).filter(Boolean);
      const assessmentLines = trimBeforeAssessmentStart(allLines);

      const groups = [];
      let current = null;
      let started = false;
      let stoppedAtGrid = false;

      for (let i = 0; i < assessmentLines.length; i++) {
        const line = assessmentLines[i];
        if (isLikelyAnswerGridStart(assessmentLines, i)) {
          stoppedAtGrid = true;
          break;
        }
        if (isHeader(line)) {
          if (current) groups.push(current);
          current = null;
          continue;
        }
        if (isQuestionStart(assessmentLines, i, started)) {
          started = true;
          if (current) groups.push(current);
          current = [line];
        } else if (current) {
          current.push(line);
        }
      }
      if (current) groups.push(current);

      const seen = new Set();
      const processed = groups.map(lines => {
        const rawText = lines.join("\n");
        const sourceNumber = String(lines[0] || "").match(/^\s*(\d{1,3})[.)]/)?.[1] || "?";
        const duplicate = seen.has(sourceNumber);
        seen.add(sourceNumber);

        const choiceCount = detectChoiceCount(rawText);
        const detectedType = detectType(rawText, choiceCount);
        const endLineAnswer = detectEndLineAnswer(rawText);
        const answerHint = base.answerKey[sourceNumber] || endLineAnswer?.answer || null;

        return {
          sourceNumber,
          detectedType,
          status: duplicate ? "DUPLICATE" : (detectedType === "VISUAL_REQUIRED" ? "NEEDS_GRAPHIC" : "READY_TO_MIRROR"),
          rawText,
          answerHint,
          mirrorPayload: {
            intent: "Mirror assessment item",
            topicHint: globalTopic,
            source: rawText,
            originalNumber: sourceNumber,
            originalType: detectedType,
            answerHint,
            constraints: { preserveConcept: true, preserveDOK: true, preserveQuestionType: true, cleanStudentReady: true }
          }
        };
      });

      setBlocks(processed);
      setIndex(0);
      setMode("Dashboard");
      setDiagnostics(`Raw: ${allLines.length} | Assess: ${assessmentLines.length} | Blocks: ${processed.length} | Grid Stopped: ${stoppedAtGrid ? "yes" : "no"}`);
    } catch (err) {
      setDiagnostics("Harvest failed: " + err.message);
    }
  }

  function generateMirrorPrompt(block) {
    const payload = block.mirrorPayload;
    return `ROLE: Expert assessment designer.\nTASK: Mirror item Q${payload.originalNumber}.\nTYPE: ${payload.originalType}.\nPAYLOAD:\n${JSON.stringify(payload, null, 2)}`.trim();
  }

  const active = blocks[index];

  return React.createElement("div", { style: { padding: "40px", fontFamily: "sans-serif", maxWidth: "1100px", margin: "auto" } },
    React.createElement("h1", { style: { color: "#007bff" } }, "LearnFlow Phase 3"),
    React.createElement("p", { style: { fontSize: "0.8rem", color: "#666" } }, APP_VERSION),
    diagnostics && React.createElement("div", { style: { background: "#fff8e1", border: "1px solid #f0c36d", padding: "10px", marginBottom: "15px" } }, diagnostics),

    !mode && React.createElement("div", null,
      React.createElement("input", { value: globalTopic, onChange: e => setGlobalTopic(e.target.value), style: { width: "100%", padding: "10px", marginBottom: "10px" }, placeholder: "Topic Hint" }),
      React.createElement("input", { type: "file", accept: ".docx", onChange: handleFileUpload, style: { display: "block", marginBottom: "10px" } }),
      React.createElement("textarea", { value: text, onChange: e => setText(e.target.value), style: { width: "100%", height: "300px", padding: "10px" }, placeholder: "Paste content..." }),
      React.createElement("button", { onClick: harvest, style: { marginTop: "10px", padding: "10px 20px", background: "#007bff", color: "white", border: "none" } }, "Harvest Source")
    ),

    mode === "Dashboard" && React.createElement("div", null,
      React.createElement("button", { onClick: () => setMode(null), style: { marginBottom: "20px" } }, "Back to Editor"),
      blocks.map((block, i) => React.createElement("div", { key: i, style: { borderBottom: "1px solid #eee", padding: "10px", display: "flex", justifyContent: "space-between", alignItems: "center" } },
        React.createElement("span", null, `Q${block.sourceNumber} | ${block.detectedType} | `, React.createElement("b", { style: { color: block.status === "READY_TO_MIRROR" ? "green" : "red" } }, block.status)),
        React.createElement("button", { onClick: () => { setIndex(i); setMode("Review"); } }, "Review & Mirror")
      ))
    ),

    mode === "Review" && active && React.createElement("div", null,
      React.createElement("button", { onClick: () => setMode("Dashboard"), style: { marginBottom: "20px" } }, "Back to Dashboard"),
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" } },
        React.createElement("div", null,
          React.createElement("h3", null, `Source Q${active.sourceNumber}`),
          React.createElement("pre", { style: { background: "#f8f9fa", padding: "15px", whiteSpace: "pre-wrap", border: "1px solid #ddd" } }, active.rawText)
        ),
        React.createElement("div", null,
          React.createElement("h3", null, "Mirror Prompt Preview"),
          React.createElement("pre", { style: { background: "#f5fff5", padding: "15px", whiteSpace: "pre-wrap", border: "1px solid #b5ddb5" } }, generateMirrorPrompt(active))
        )
      )
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
